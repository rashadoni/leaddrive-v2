import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { IdentityRegistryError, assertIdentityScope } from "./contract"
import { parseIdentityCrmClaims, readIdentityCrmAuthorityInTransaction } from "./crm-session"
import type { IdentityAdministrator } from "./administrator"

/** Frozen server authority. It is never accepted from an HTTP request. The
 * credential/lifecycle digest invalidates delayed invitations after logout,
 * password or MFA policy changes without storing those fields in the proof. */
export type IdentityProofAuthority = { version: 2; administrator: IdentityAdministrator; lifecycleDigest: string }
export function parseIdentityProofAuthority(value: unknown): IdentityProofAuthority | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 3 || row.version !== 2 || typeof row.lifecycleDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.lifecycleDigest)) return null
  const admin = row.administrator
  if (!admin || typeof admin !== "object" || Array.isArray(admin)) return null
  const candidate = admin as Record<string, unknown>
  if (typeof candidate.organizationId !== "string" || typeof candidate.userId !== "string") return null
  try { assertIdentityScope(candidate.organizationId, candidate.userId) } catch { return null }
  const scope = { organizationId: candidate.organizationId, userId: candidate.userId }
  let administrator: IdentityAdministrator
  if (candidate.mode === "CANONICAL" && Object.keys(candidate).length === 4) {
    const claims = parseIdentityCrmClaims(candidate.claims)
    if (!claims || claims.userId !== scope.userId || claims.organizationId !== scope.organizationId) return null
    administrator = { ...scope, mode: "CANONICAL", claims }
  } else return null
  return { version: 2, administrator, lifecycleDigest: row.lifecycleDigest }
}
export function identityProofAuthorityHash(value: IdentityProofAuthority): string {
  const parsed = parseIdentityProofAuthority(value)
  if (!parsed) throw new IdentityRegistryError("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
  const actor = parsed.administrator
  return createHash("sha256").update(JSON.stringify([2, actor.organizationId, actor.userId, actor.mode,
    actor.mode === "CANONICAL" ? [actor.claims.claimId, actor.claims.credentialEpoch, actor.claims.grantVersion] : null, parsed.lifecycleDigest])).digest("hex")
}

/** Caller owns the tenant writer fence. Taking User/account/claim/grant locks
 * orders direct issuer revocation with confirmation and delivery admission. */
export async function freezeIdentityProofAuthority(tx: Prisma.TransactionClient, actor: IdentityAdministrator): Promise<IdentityProofAuthority> {
  assertIdentityScope(actor.organizationId, actor.userId)
  await tx.$queryRaw`SELECT id FROM users WHERE "organizationId"=${actor.organizationId} AND id=${actor.userId} FOR SHARE`
  const user = await tx.user.findFirst({ where: { organizationId: actor.organizationId, id: actor.userId, isActive: true, anonymizedAt: null },
    select: { role: true, passwordHash: true, passwordChangedAt: true, require2fa: true, totpEnabled: true, totpSecret: true, smsAuthEnabled: true, verifiedPhone: true } })
  if (!user) throw new IdentityRegistryError("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
  const [account] = await tx.$queryRaw<Array<{ cutoverAt: Date | null }>>`SELECT "cutoverAt" FROM identity_accounts WHERE "organizationId"=${actor.organizationId} AND "userId"=${actor.userId} FOR SHARE`
  if (actor.mode === "CANONICAL" && account?.cutoverAt) {
    await tx.$queryRaw`SELECT id FROM identity_phone_claims WHERE "organizationId"=${actor.organizationId} AND "userId"=${actor.userId} FOR SHARE`
    await tx.$queryRaw`SELECT version FROM identity_application_grants WHERE "organizationId"=${actor.organizationId} AND "userId"=${actor.userId} AND application='CRM' FOR SHARE`
    const authority = await readIdentityCrmAuthorityInTransaction(tx, actor.organizationId, actor.userId)
    const claims = parseIdentityCrmClaims(actor.claims)
    if (!authority || authority.role !== "admin" || !claims || claims.organizationId !== actor.organizationId || claims.userId !== actor.userId
      || claims.claimId !== authority.claims.claimId || claims.credentialEpoch !== authority.claims.credentialEpoch || claims.grantVersion !== authority.claims.grantVersion) throw new IdentityRegistryError("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
  } else throw new IdentityRegistryError("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
  const lifecycleDigest = createHash("sha256").update(JSON.stringify([user.passwordHash, user.passwordChangedAt?.toISOString() ?? null,
    user.require2fa, user.totpEnabled, user.totpSecret, user.smsAuthEnabled, user.verifiedPhone])).digest("hex")
  return { version: 2, administrator: actor, lifecycleDigest }
}
export async function revalidateIdentityProofAuthority(tx: Prisma.TransactionClient, value: unknown, organizationId: string, issuedByUserId: string) {
  const frozen = parseIdentityProofAuthority(value)
  if (!frozen || frozen.administrator.organizationId !== organizationId || frozen.administrator.userId !== issuedByUserId) throw new IdentityRegistryError("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
  const current = await freezeIdentityProofAuthority(tx, frozen.administrator)
  if (identityProofAuthorityHash(current) !== identityProofAuthorityHash(frozen)) throw new IdentityRegistryError("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
  return frozen
}
