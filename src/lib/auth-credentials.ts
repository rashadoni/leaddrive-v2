import { z } from "zod"
import bcrypt from "bcryptjs"

/**
 * Credentials-provider login schema. Shared between `src/lib/auth.ts`
 * (the NextAuth `authorize()` callback) and the F-36 regression tests
 * in `src/__tests__/lib-auth-tenant-scope.test.ts`. Keeping it here
 * lets the test assert against the real shape — bumping `password.min`
 * in prod now fails any test that still uses an old short password.
 *
 * Field semantics:
 *   • `organizationSlug` is OPTIONAL (legacy clients pre-F-36) — when
 *     present, the lookup is tenant-scoped via `buildLoginUserWhere()`.
 *     Empty string is rejected so we don't accidentally search for
 *     `{organization: {slug: ""}}` which matches zero rows.
 */
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  organizationSlug: z.string().min(1).max(80).optional(),
})

export type LoginInput = z.infer<typeof loginSchema>

/**
 * Build the Prisma `where` clause used by `authorize()` (and mirrored by
 * the JWT-refresh helper below). The presence of `organizationSlug`
 * decides whether the lookup joins on the org table for tenant scope.
 *
 * If you change this, both the credentials provider AND the regression
 * suite update together — that's the whole point of extracting.
 */
export function buildLoginUserWhere(parsed: LoginInput) {
  const where: { email: string; isActive: true; organization?: { slug: string } } = {
    email: parsed.email,
    isActive: true,
  }
  if (parsed.organizationSlug) {
    where.organization = { slug: parsed.organizationSlug }
  }
  return where
}

/**
 * Once the tenant slug has been resolved to its immutable organization id,
 * keep the credentials lookup on the tenant RLS path. The scalar
 * organizationId predicate also avoids relying on a relation join while the
 * database session is being scoped for login.
 */
export function buildTenantLoginUserWhere(email: string, organizationId: string) {
  return {
    email,
    isActive: true as const,
    organizationId,
  }
}

/**
 * Build the where clause for refreshing a JWT mid-session (NextAuth's
 * `jwt({ trigger: "update" })` path). The architect found a regression
 * last turn where this code used `findFirst({email: token.email})`,
 * silently rebinding consultants to whichever tenant Prisma returned
 * first. Always look up by `token.sub` (the user id).
 *
 * Returns null when no subject is present — caller must skip the
 * refresh rather than fall back to email (that would undo the fix).
 */
export function buildJwtRefreshWhere(token: { sub?: string | null }) {
  if (!token.sub) return null
  return { id: token.sub }
}

/**
 * Pick the user candidate whose `passwordHash` matches the plaintext
 * password — used by the legacy `authorize()` fallback when more than
 * one user shares the same email across tenants. F-36 narrows the
 * candidate set via `buildLoginUserWhere`, but the bcrypt loop itself
 * lives here so the regression test asserts against the real call
 * path, not a duplicate.
 *
 * Iterates in input order (whichever order Prisma returned) and stops
 * at the first match. OAuth-only candidates (passwordHash null/empty)
 * are skipped. Returns null when no candidate matches.
 */
export async function pickCandidateByPassword<T extends { passwordHash: string | null }>(
  candidates: T[],
  plaintext: string
): Promise<T | null> {
  for (const c of candidates) {
    if (!c.passwordHash) continue
    if (await bcrypt.compare(plaintext, c.passwordHash)) return c
  }
  return null
}

/**
 * F-36 deprecation: server-log message for legacy logins that didn't
 * pass `organizationSlug`. Returns a PII-masked summary so prod logs
 * don't carry full emails — operators still get enough to spot rollout
 * patterns without a privacy footprint.
 *
 * Defensive on weird inputs: missing local-part or missing domain both
 * fall back to `?` so the call never throws.
 */
export function maskLegacyAuthEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@")
  const localMask = local.length > 0 ? local.slice(0, 3) : "?"
  const domainMask = domain.length > 0 ? domain.slice(0, 1) : "?"
  return `${localMask}…@${domainMask}…`
}
