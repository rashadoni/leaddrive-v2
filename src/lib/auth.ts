import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "./prisma"
import { runWithRlsBypass, runWithTenant } from "./rls-context"
import {
  loginSchema,
  buildLoginUserWhere,
  buildTenantLoginUserWhere,
  buildJwtRefreshWhere,
  maskLegacyAuthEmail,
  pickCandidateByPassword,
} from "./auth-credentials"
import {
  createSessionFingerprint,
  hasCurrentSessionFingerprint,
} from "./session-invalidation"
import { requireAuthSecret } from "./auth-secret"
import { moduleRecordFromOrgFields } from "./modules"
import { readTenantLandingPath } from "./tenant-landing"
import { applyVerifiedTwoFactorSessionUpdate } from "./two-factor-nonce"
import { requiresTwoFactorSetup, resolveTwoFactorMethod } from "./two-factor-policy"
import { checkRateLimit, hashForRateLimit, RATE_LIMIT_CONFIG } from "./rate-limit"

const AUTH_SECRET = requireAuthSecret()

/**
 * RLS: NextAuth's PrismaAdapter queries users/accounts/sessions during OAuth
 * flows with no tenant context (it runs BEFORE any guard). Wrap every adapter
 * method in a cross-tenant bypass scope so those bootstrap queries don't fail
 * closed once RLS policies land on users/accounts.
 */
function bypassAdapter<A extends object>(adapter: A): A {
  const wrapped: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(adapter)) {
    wrapped[k] = typeof v === "function" ? (...args: unknown[]) => runWithRlsBypass(() => (v as (...a: unknown[]) => unknown)(...args)) : v
  }
  return wrapped as A
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: AUTH_SECRET,
  adapter: bypassAdapter(PrismaAdapter(prisma)),
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        organizationSlug: { label: "Organization", type: "text" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) {
          console.warn("[Auth] credentials_rejected reason=schema_invalid")
          return null
        }

        try {
          // The middleware supplies a coarse per-IP bucket. This principal
          // bucket closes the rotating-IP gap for one CRM account within the
          // current process; a distributed store remains the next deployment
          // step when the topology grows beyond the single PM2 fork.
          const principalHash = await hashForRateLimit(
            `crm-login:${parsed.data.organizationSlug || "legacy"}:${parsed.data.email.toLowerCase()}`,
          )
          if (!checkRateLimit(`auth-principal:${principalHash}`, RATE_LIMIT_CONFIG.authPrincipal)) {
            console.warn("[Auth] credentials_rejected reason=principal_rate_limited")
            return null
          }

          // F-36 — tenant-scoped lookup when slug is provided; legacy
          // email-only path otherwise. Where-builder + masked log live in
          // ./auth-credentials so the regression tests assert against the
          // same code paths the credentials provider uses.
          //
          // Operators can flip `REQUIRE_TENANT_SLUG=1` once all clients
          // pass a slug; this returns null (→ 401 from NextAuth) for
          // legacy submits instead of running the deprecated path.
          if (!parsed.data.organizationSlug && process.env.REQUIRE_TENANT_SLUG === "1") {
            console.warn("[Auth] rejecting legacy email-only login — REQUIRE_TENANT_SLUG=1")
            return null
          }
          const legacyWhere = buildLoginUserWhere(parsed.data)
          if (!parsed.data.organizationSlug) {
            console.warn(
              `[Auth] legacy email-only lookup (F-36 deprecated path) — email=${maskLegacyAuthEmail(parsed.data.email)}`
            )
          }

          // Tenant-host login should stay on the tenant-scoped RLS path. Resolve
          // the non-RLS organization row first, then scope the user query by the
          // immutable id. The bypass path remains only for legacy clients that
          // do not send an organization slug and may legitimately match users
          // across tenants before bcrypt selects the correct row.
          const candidates = parsed.data.organizationSlug
            ? await (async () => {
                const organization = await prisma.organization.findUnique({
                  where: { slug: parsed.data.organizationSlug },
                  select: { id: true, slug: true, name: true, plan: true, isActive: true },
                })
                if (!organization) {
                  console.warn("[Auth] credentials_rejected reason=organization_not_found")
                  return []
                }
                const users = await runWithTenant(organization.id, () => prisma.user.findMany({
                  where: buildTenantLoginUserWhere(parsed.data.email, organization.id),
                }))
                // Prisma is intentionally loaded through a runtime fallback in
                // `lib/prisma.ts` when the generated client is unavailable
                // (e.g. the lightweight typecheck fixture), so this callback
                // can otherwise be inferred as `any`. Keep the candidate shape
                // unchanged while making the annotation explicit.
                return users.map((user: (typeof users)[number]) => ({ ...user, organization }))
              })()
            : await runWithRlsBypass(() => prisma.user.findMany({
                where: legacyWhere,
                include: { organization: true },
              }))

          if (candidates.length === 0) {
            console.warn(`[Auth] credentials_rejected reason=no_candidates scope=${parsed.data.organizationSlug ? "tenant" : "legacy"}`)
            return null
          }

          const user = await pickCandidateByPassword<typeof candidates[number]>(candidates, parsed.data.password)
          if (!user) {
            console.warn(`[Auth] credentials_rejected reason=password_mismatch candidates=${candidates.length}`)
            return null
          }

          // Check if organization is active (tenant deactivation)
          if (!user.organization.isActive && user.role !== "superadmin") {
            console.warn("[Auth] credentials_rejected reason=organization_inactive")
            return null
          }

          // Update last login
          await runWithTenant(user.organizationId, () => prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date(), loginCount: { increment: 1 } },
          })).catch(() => {}) // Non-critical

          // Determine 2FA method. TOTP wins when both flags are set —
          // it's instant and free, while SMS costs money and takes seconds.
          const twoFactorMethod = resolveTwoFactorMethod(user)

          // If SMS 2FA is active, fire off a code right after password check
          // so it's already in transit by the time the UI lands on the verify page.
          // Done dynamically to avoid a startup-time import of sms.ts into auth.ts.
          if (twoFactorMethod === "sms" && user.verifiedPhone) {
            try {
              const { sendOtp } = await import("@/lib/sms")
              // sendOtp does updateMany+create on otp_codes — both hit RLS once it's
              // enabled. The org is known here (logged-in user), so mirror the send
              // route's org-present branch: write under runWithTenant so the OTP row
              // (organizationId = user.organizationId) passes WITH CHECK with RLS
              // still enforced, instead of bypassing. Without this wrapper the 2FA
              // code dispatch fail-closes and the catch below silently swallows it.
              await runWithTenant(user.organizationId, () => sendOtp({
                phone: user.verifiedPhone!,
                purpose: "2fa",
                organizationId: user.organizationId,
                userId: user.id,
              }))
            } catch (e) {
              console.error("[Auth] SMS 2FA code dispatch failed:", e)
              // Don't block login — user can request a resend on the verify page.
            }
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            // Bind the successful bcrypt comparison to the exact DB credential
            // state it verified. The JWT callback re-fetches the row and rejects
            // if a concurrent password change landed between authorize() and
            // token issuance.
            sessionFingerprint: createSessionFingerprint({
              principalId: user.id,
              passwordHash: user.passwordHash,
              passwordChangedAt: user.passwordChangedAt,
              secret: AUTH_SECRET,
            }),
            organizationId: user.organizationId,
            organizationSlug: user.organization.slug,
            organizationName: user.organization.name,
            plan: user.organization.plan,
            // 2FA flags
            needs2fa: twoFactorMethod ? true : undefined,
            twoFactorMethod: twoFactorMethod || undefined,
            needsSetup2fa: requiresTwoFactorSetup(user) ? true : undefined,
          }
        } catch (err) {
          console.error("[Auth] Login error:", err)
          return null
        }
      },
    }),
    // Google and Microsoft sign-in were removed deliberately. They were an
    // early idea that never became a supported way in, nobody used Microsoft
    // at all, and the two linked Google identities were the owner's own and
    // already had passwords. Keeping them meant keeping a first-login branch
    // that minted an organization and an admin account for any federated
    // identity that appeared. Password login is now the only method.
  ],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8 hours
  // Every page Auth.js can render is pointed at our own /login. Any entry left
  // undefined here falls back to the framework's stock, unbranded page, which
  // the 2026-08 penetration re-test reported as authentication metadata
  // exposure: GET /api/auth/signout served an 8 KB Auth.js default sign-out
  // form, and GET /api/auth/verify-request advertised an email magic-link flow
  // this product does not even have (credentials is the only provider, above).
  //
  // `signOut` is consumed only by the GET render path in @auth/core; the actual
  // logout is a POST handled by `actions.signOut`, so redirecting the page does
  // not touch logout itself.
  pages: {
    signIn: "/login",
    signOut: "/login",
    error: "/login",
    verifyRequest: "/login",
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        domain: process.env.COOKIE_DOMAIN || undefined,
      },
    },
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Allow cross-subdomain redirects within *.leaddrivecrm.org
      try {
        const target = new URL(url, baseUrl)
        const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org"
        if (target.hostname === baseDomain || target.hostname.endsWith(`.${baseDomain}`)) {
          return target.toString()
        }
        // Same origin as baseUrl — trivially trusted, and the only way an
        // absolute callbackUrl survives outside the prod base domain (dev on
        // localhost, preview hosts). Without this the absolute URLs that
        // `signOutCallbackUrl()` produces would fall through to `baseUrl` and
        // drop the requested path.
        if (target.origin === new URL(baseUrl).origin) {
          return target.toString()
        }
      } catch {}
      // Default: allow relative URLs, block external
      if (url.startsWith("/")) return `${baseUrl}${url}`
      return baseUrl
    },
    async signIn({ account }) {
      // Password login is the only supported method. Every account is created
      // deliberately by an administrator, so there is no find-or-create branch
      // here: a federated identity arriving at this callback would previously
      // have been handed a brand-new organization with an admin role and an
      // empty password. Refuse anything that is not the credentials provider.
      if (account && account.provider !== "credentials") return false
      return true // Credentials — already authorized in authorize()
    },
    async jwt({ token, user, account, trigger, session: updateData }) {
      if (user) {
        // F-36: use the resolved user id from authorize() rather than re-
        // querying by email. authorize() already picked the correct org-
        // scoped row; a second `findFirst({email})` would silently drop
        // back to first-match-wins across tenants and undo the fix.
        // RLS: jwt callback runs on session resolution, before any guard —
        // bypass-wrapped or every authed request fails closed once `users`
        // gets policies.
        const dbUser = await runWithRlsBypass(() => prisma.user.findUnique({
          where: { id: user.id as string },
          include: { organization: true },
        }))
        if (!dbUser) {
          return null
        }
        // JWT issuance is itself an authorization boundary. Credentials login
        // filters inactive users earlier, but OAuth and adapter flows arrive
        // here directly, so repeat both revocation checks against fresh rows.
        if (!dbUser.isActive) {
          return null
        }
        // Preserve the existing, explicit superadmin exception used by
        // credentials auth and resolveCookieSession: a platform superadmin may
        // administer tenants even when their home/system org is inactive.
        if (dbUser.role !== "superadmin" && dbUser.organization?.isActive !== true) {
          return null
        }
        // Exact, opaque credential epoch. This is intentionally derived from
        // the DB password state instead of JWT `iat` (seconds precision), so
        // a password change and a token issue in the same second cannot race.
        const currentSessionFingerprint = createSessionFingerprint({
          principalId: dbUser.id,
          passwordHash: dbUser.passwordHash,
          passwordChangedAt: dbUser.passwordChangedAt,
          secret: AUTH_SECRET,
        })
        const authorizedSessionFingerprint = (user as { sessionFingerprint?: unknown }).sessionFingerprint
        if (account?.provider === "credentials" || authorizedSessionFingerprint !== undefined) {
          if (!hasCurrentSessionFingerprint(authorizedSessionFingerprint, currentSessionFingerprint)) {
            return null
          }
        }
        token.sessionFingerprint = currentSessionFingerprint
        token.name = dbUser.name
        token.role = dbUser.role
        token.organizationId = dbUser.organizationId
        token.organizationSlug = dbUser.organization?.slug || ""
        token.organizationName = dbUser.organization?.name || ""
        token.plan = dbUser.organization?.plan || "starter"
        token.addons = dbUser.organization?.addons || []
        // Convert features array to modules Record for hasModule() compatibility.
        // ALWAYS set token.modules — even from an empty array — so the new
        // authoritative-modules branch in `hasModule` can distinguish
        // "admin saved features=[]" (Clear All in admin UI → org.modules={})
        // from "JWT predates the column" (org.modules=undefined). Without
        // this, Clear All in /admin/tenants/<id>/edit would silently re-
        // enable every base module via the untouched-tenant fallback.
        token.modules = moduleRecordFromOrgFields({
          features: dbUser.organization?.features,
          modules: dbUser.organization?.modules,
        })
        // Стартовая страница тенанта: корень «/» ведёт сюда (см. proxy.ts).
        // Кладём в токен, чтобы Edge-прокси не ходил в БД ради редиректа.
        token.landingPath = readTenantLandingPath(dbUser.organization?.settings)

        // Enforce the same MFA policy for OAuth users as for credentials
        // users. The provider's own MFA posture is not an assurance claim
        // LeadDrive can safely infer from the OAuth profile alone.
        const dbTwoFactorMethod = resolveTwoFactorMethod(dbUser)
        if (dbTwoFactorMethod) {
          token.needs2fa = true
          token.twoFactorMethod = dbTwoFactorMethod
        } else if (requiresTwoFactorSetup(dbUser)) {
          token.needsSetup2fa = true
        }
        // Propagate 2FA flags from authorize return
        if ((user as any).needs2fa) token.needs2fa = true
        if ((user as any).twoFactorMethod) token.twoFactorMethod = (user as any).twoFactorMethod
        if ((user as any).needsSetup2fa) token.needsSetup2fa = true
      }
      // Refresh name + org module state from DB on every session resolution.
      // Also backfills organizationSlug for JWTs issued before the
      // field existed, AND re-materialises `token.modules` from
      // `Organization.features` so an admin's toggle in /admin/tenants/<id>/edit
      // takes effect on the next token rotation rather than waiting for the
      // user to sign out + back in.
      if (!user) {
        try {
          // F-36: refresh by the JWT subject id, not by email. A missing
          // `token.sub` is rejected instead of falling back to an ambiguous
          // cross-tenant email lookup.
          const refreshWhere = buildJwtRefreshWhere({ sub: token.sub as string | undefined })
          // RLS: token-rotation refresh also precedes any tenant context — bypass-wrapped.
          if (!refreshWhere) {
            return null
          }
          const freshUser = await runWithRlsBypass(() => prisma.user.findUnique({
            where: refreshWhere,
            select: {
              id: true,
              name: true,
              role: true,
              isActive: true,
              passwordHash: true,
              // Keep long-lived JWTs in sync when an administrator disables
              // 2FA after the token was issued. Without these fields a stale
              // needsSetup2fa/needs2fa claim could strand the user on setup.
              totpEnabled: true,
              smsAuthEnabled: true,
              verifiedPhone: true,
              require2fa: true,
              organizationId: true,
              // Part of the exact session fingerprint below; logout-all
              // advances it without changing the password hash.
              passwordChangedAt: true,
              organization: {
                select: { isActive: true, slug: true, plan: true, addons: true, features: true, modules: true, settings: true },
              },
            },
          }))
          // Fail CLOSED for a deleted user: the token names a `sub` but no row
          // exists → invalidate rather than let a stale
          // role/org token keep working until 8h expiry. (Codex review.)
          if (!freshUser) {
            return null
          }
          // Fail CLOSED for a deactivated user — org-deactivation is caught in
          // requireAuth, but per-user isActive=false was not enforced here.
          if (!freshUser.isActive) {
            return null
          }
          // Tenant suspension revokes ordinary Auth.js sessions immediately,
          // including routes that call auth() directly instead of requireAuth.
          // The superadmin exception is deliberate and mirrors authorize() and
          // resolveCookieSession rather than being inferred from a stale token.
          if (freshUser.role !== "superadmin" && freshUser.organization?.isActive !== true) {
            return null
          }
          const currentSessionFingerprint = createSessionFingerprint({
            principalId: freshUser.id,
            passwordHash: freshUser.passwordHash,
            passwordChangedAt: freshUser.passwordChangedAt,
            secret: AUTH_SECRET,
          })
          if (!hasCurrentSessionFingerprint(token.sessionFingerprint, currentSessionFingerprint)) {
            return null
          }

          token.name = freshUser.name
          token.role = freshUser.role
          if (freshUser.organizationId) token.organizationId = freshUser.organizationId
          if (freshUser.organization?.slug) token.organizationSlug = freshUser.organization.slug
          if (freshUser.organization?.plan) token.plan = freshUser.organization.plan
          if (freshUser.organization?.addons) token.addons = freshUser.organization.addons
          // Re-materialise modules from features array — same logic as initial
          // sign-in. Always set (even when empty) so Clear All survives a
          // refresh.
          token.modules = moduleRecordFromOrgFields({
            features: freshUser.organization?.features,
            modules: freshUser.organization?.modules,
          })
          token.landingPath = readTenantLandingPath(freshUser.organization?.settings)

          // Re-arm setup (but not a factor challenge) when the fresh user row
          // explicitly requires MFA and has no usable method. This repairs
          // legacy cookies whose setup claim was cleared by older code, while
          // avoiding a loop after a valid TOTP/SMS nonce clears needs2fa for a
          // configured factor.
          const freshTwoFactorMethod = resolveTwoFactorMethod(freshUser)
          if (requiresTwoFactorSetup(freshUser)) {
            token.needs2fa = undefined
            token.twoFactorMethod = undefined
            token.needsSetup2fa = true
          } else if (!freshTwoFactorMethod) {
            token.needs2fa = undefined
            token.twoFactorMethod = undefined
            token.needsSetup2fa = undefined
          } else if (token.needsSetup2fa) {
            // A factor may have been enrolled by another fresh session after
            // this cookie was issued. It no longer needs setup, but this stale
            // cookie has not proved the configured factor and must not inherit
            // access merely because the database now contains one.
            token.needsSetup2fa = undefined
            token.needs2fa = true
            token.twoFactorMethod = freshTwoFactorMethod
          }
        } catch (error) {
          // Credential/session validation is security-critical. A transient DB
          // or fingerprint error must deny the token, never preserve stale
          // claims until the database/cache recovers.
          console.warn("[Auth] session validation failed closed", error)
          return null
        }
      }
      // Handle session.update() only after an existing token passed the fresh,
      // fail-closed credential check above. Otherwise a revoked cookie could
      // consume a valid 2FA nonce before ultimately being rejected.
      if (trigger === "update" && updateData) {
        // `updateData` is supplied by the browser and must not be trusted to
        // clear a security claim. Only a fresh, DB-bound, one-time nonce issued
        // after successful TOTP/SMS verification can clear either flag.
        await applyVerifiedTwoFactorSessionUpdate(token, updateData)
        if (updateData.name) token.name = updateData.name
      }
      return token
    },
    async session({ session, token }) {
      // Defense-in-depth: Auth.js' default JWT session currently exposes only
      // name/email/image, but explicitly strip internal credential material so
      // a future adapter/provider change cannot serialize it into
      // /api/auth/session.
      const publicSession = { ...session } as typeof session & Record<string, unknown>
      const publicUser = { ...session.user } as typeof session.user & Record<string, unknown>
      delete publicSession.sessionFingerprint
      delete publicSession.passwordHash
      delete publicUser.sessionFingerprint
      delete publicUser.passwordHash

      return {
        ...publicSession,
        // Preserve the existing public response shape. Revocation no longer
        // relies on this seconds-precision value.
        iat: token.iat as number | undefined,
        user: {
          ...publicUser,
          id: token.sub as string,
          name: token.name as string,
          role: token.role as string,
          organizationId: token.organizationId as string,
          organizationSlug: (token.organizationSlug as string) || "",
          organizationName: token.organizationName as string,
          plan: token.plan as string,
          addons: (token.addons as string[]) || [],
          modules: (token.modules as Record<string, boolean>) || undefined,
          landingPath: (token.landingPath as string | undefined) || undefined,
          needs2fa: token.needs2fa as boolean | undefined,
          twoFactorMethod: token.twoFactorMethod as "totp" | "sms" | undefined,
          needsSetup2fa: token.needsSetup2fa as boolean | undefined,
        },
      }
    },
  },
})
