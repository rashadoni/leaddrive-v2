import { readLegacyCrmCredentialBoundary } from "@/lib/identity/legacy-crm-boundary"
import { beforeEach, describe, expect, it, vi } from "vitest"

const authCapture = vi.hoisted(() => ({ config: null as any }))
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  organization: { findUnique: vi.fn() },
}))

vi.mock("@/lib/identity/legacy-crm-boundary", () => ({ readLegacyCrmCredentialBoundary: vi.fn().mockResolvedValue("LEGACY") }))
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn().mockResolvedValue(true) } }))

vi.mock("next-auth", () => ({
  default: vi.fn((config: unknown) => {
    authCapture.config = config
    return {
      handlers: {},
      signIn: vi.fn(),
      signOut: vi.fn(),
      auth: vi.fn(),
    }
  }),
}))

vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn((config: unknown) => config) }))
vi.mock("next-auth/providers/google", () => ({ default: vi.fn((config: unknown) => config) }))
vi.mock("next-auth/providers/microsoft-entra-id", () => ({ default: vi.fn((config: unknown) => config) }))
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: vi.fn(async (fn: () => unknown) => fn()),
  runWithTenant: vi.fn(async (_orgId: string, fn: () => unknown) => fn()),
}))
vi.mock("@/lib/modules", () => ({
  moduleRecordFromOrgFields: vi.fn(() => ({})),
}))
vi.mock("@/lib/tenant-landing", () => ({ readTenantLandingPath: vi.fn(() => undefined) }))
vi.mock("@/lib/two-factor-nonce", () => ({
  applyVerifiedTwoFactorSessionUpdate: vi.fn(async () => undefined),
}))
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async () => "rate-key"),
  RATE_LIMIT_CONFIG: { authPrincipal: { maxRequests: 5, windowMs: 60_000 } },
}))

import "@/lib/auth"
import bcrypt from "bcryptjs"
import { createSessionFingerprint } from "@/lib/session-invalidation"

const AUTH_SECRET = process.env.NEXTAUTH_SECRET!

const USER = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  role: "admin",
  organizationId: "org-1",
  passwordHash: "$2b$12$before-password-change",
  passwordChangedAt: new Date("2026-08-11T12:00:00.100Z"),
  isActive: true,
  totpEnabled: false,
  smsAuthEnabled: false,
  require2fa: false,
  verifiedPhone: null,
  organization: {
    isActive: true,
    slug: "acme",
    name: "Acme",
    plan: "starter",
    addons: [],
    features: [],
    modules: {},
    settings: {},
  },
}

function jwtCallback() {
  return authCapture.config.callbacks.jwt as (input: any) => Promise<any>
}

function sessionCallback() {
  return authCapture.config.callbacks.session as (input: any) => Promise<any>
}

function authorizedFingerprint(user = USER) {
  return createSessionFingerprint({
    principalId: user.id,
    passwordHash: user.passwordHash,
    passwordChangedAt: user.passwordChangedAt,
    secret: AUTH_SECRET,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readLegacyCrmCredentialBoundary).mockResolvedValue("LEGACY")
  prismaMock.user.findUnique.mockResolvedValue(USER)
  prismaMock.user.findMany.mockResolvedValue([USER])
  prismaMock.user.update.mockResolvedValue(USER)
  prismaMock.organization.findUnique.mockResolvedValue({ ...USER.organization, id: USER.organizationId })
})

describe("Auth.js password-session invalidation", () => {
  it.each(["MIGRATED", "UNAVAILABLE"] as const)("refuses %s credentials before bcrypt and last-login writes", async boundary => {
    vi.mocked(readLegacyCrmCredentialBoundary).mockResolvedValue(boundary)
    const user = await authCapture.config.providers[0].authorize({ email: USER.email, password: "Fictional-Crm-Pass-2026!" })
    expect(user).toBeNull()
    expect(readLegacyCrmCredentialBoundary).toHaveBeenCalledWith(prismaMock, USER.organizationId, USER.id)
    expect(bcrypt.compare).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it("keeps unconverted credentials on the existing password and MFA flow", async () => {
    const user = await authCapture.config.providers[0].authorize({ email: USER.email, password: "Fictional-Crm-Pass-2026!" })
    expect(user).toMatchObject({ id: USER.id, role: USER.role })
    expect(bcrypt.compare).toHaveBeenCalledWith("Fictional-Crm-Pass-2026!", USER.passwordHash)
  })

  it.each(["MIGRATED", "UNAVAILABLE"] as const)("refuses %s initial and existing browser JWTs despite unchanged old fingerprints", async boundary => {
    vi.mocked(readLegacyCrmCredentialBoundary).mockResolvedValue(boundary)
    expect(await jwtCallback()({ token: { sub: USER.id },
      user: { id: USER.id, sessionFingerprint: authorizedFingerprint() }, account: { provider: "credentials" } })).toBeNull()
    expect(await jwtCallback()({ token: { sub: USER.id, role: "superadmin", organizationId: USER.organizationId,
      sessionFingerprint: authorizedFingerprint() }, user: undefined })).toBeNull()
  })

  it("rejects initial JWT issuance for an inactive user", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...USER, isActive: false })

    const token = await jwtCallback()({
      token: { sub: USER.id, email: USER.email },
      user: { id: USER.id, sessionFingerprint: authorizedFingerprint() },
      account: { provider: "credentials" },
    })

    expect(token).toBeNull()
  })

  it("rejects initial and refreshed ordinary-user JWTs for an inactive organization", async () => {
    const inactiveOrgUser = {
      ...USER,
      organization: { ...USER.organization, isActive: false },
    }
    prismaMock.user.findUnique.mockResolvedValue(inactiveOrgUser)

    const initial = await jwtCallback()({
      token: { sub: USER.id, email: USER.email },
      user: { id: USER.id, sessionFingerprint: authorizedFingerprint() },
      account: { provider: "credentials" },
    })
    const refreshed = await jwtCallback()({
      token: {
        sub: USER.id,
        email: USER.email,
        sessionFingerprint: authorizedFingerprint(),
      },
      user: undefined,
    })

    expect(initial).toBeNull()
    expect(refreshed).toBeNull()
  })

  it("preserves the explicit inactive-home-org exception for a fresh superadmin row", async () => {
    const superadmin = {
      ...USER,
      role: "superadmin",
      organization: { ...USER.organization, isActive: false },
    }
    prismaMock.user.findUnique.mockResolvedValue(superadmin)
    const fingerprint = authorizedFingerprint(superadmin)

    const token = await jwtCallback()({
      token: { sub: superadmin.id, email: superadmin.email },
      user: { id: superadmin.id, sessionFingerprint: fingerprint },
      account: { provider: "credentials" },
    })
    const refreshed = await jwtCallback()({ token, user: undefined })

    expect(token?.role).toBe("superadmin")
    expect(refreshed?.role).toBe("superadmin")
  })

  it("mints an opaque fingerprint from fresh DB credential state", async () => {
    const token = await jwtCallback()({
      token: { sub: USER.id, email: USER.email },
      user: { id: USER.id, sessionFingerprint: authorizedFingerprint() },
      account: { provider: "credentials" },
    })

    expect(token.sessionFingerprint).toEqual(expect.any(String))
    expect(token.sessionFingerprint).not.toContain(USER.passwordHash)
  })

  it("keeps a cookie whose fingerprint still matches fresh DB state", async () => {
    const token = await jwtCallback()({
      token: { sub: USER.id, email: USER.email },
      user: { id: USER.id, sessionFingerprint: authorizedFingerprint() },
      account: { provider: "credentials" },
    })

    const refreshed = await jwtCallback()({ token, user: undefined })

    expect(refreshed?.sessionFingerprint).toBe(token.sessionFingerprint)
  })

  it.each(["admin", "superadmin"] as const)(
    "does not infer an MFA requirement from the %s role and clears stale claims",
    async (role) => {
      const privilegedUser = { ...USER, role }
      prismaMock.user.findUnique.mockResolvedValue(privilegedUser)
      const fingerprint = authorizedFingerprint(privilegedUser)

      const token = await jwtCallback()({
        token: { sub: privilegedUser.id, email: privilegedUser.email },
        user: { id: privilegedUser.id, sessionFingerprint: fingerprint },
        account: { provider: "credentials" },
      })

      const refreshed = await jwtCallback()({
        token: {
          ...token,
          needs2fa: true,
          needsSetup2fa: true,
          twoFactorMethod: "totp",
        },
        user: undefined,
      })

      expect(token?.needsSetup2fa).toBeUndefined()
      expect(refreshed?.needs2fa).toBeUndefined()
      expect(refreshed?.needsSetup2fa).toBeUndefined()
      expect(refreshed?.twoFactorMethod).toBeUndefined()
    },
  )

  it("requires setup when the per-user policy is enabled and SMS is unusable", async () => {
    const incompleteSmsUser = { ...USER, require2fa: true, smsAuthEnabled: true, verifiedPhone: null }
    prismaMock.user.findUnique.mockResolvedValue(incompleteSmsUser)
    const fingerprint = authorizedFingerprint(incompleteSmsUser)

    const token = await jwtCallback()({
      token: { sub: incompleteSmsUser.id, email: incompleteSmsUser.email },
      user: { id: incompleteSmsUser.id, sessionFingerprint: fingerprint },
      account: { provider: "credentials" },
    })
    const refreshed = await jwtCallback()({ token, user: undefined })

    expect(token?.needsSetup2fa).toBe(true)
    expect(token?.needs2fa).toBeUndefined()
    expect(token?.twoFactorMethod).toBeUndefined()
    expect(refreshed?.needsSetup2fa).toBe(true)
  })

  it.each([
    { method: "totp" as const, user: { ...USER, totpEnabled: true } },
    {
      method: "sms" as const,
      user: { ...USER, smsAuthEnabled: true, verifiedPhone: "+994000000000" },
    },
  ])("keeps a voluntarily enrolled $method factor active", async ({ method, user }) => {
    prismaMock.user.findUnique.mockResolvedValue(user)
    const fingerprint = authorizedFingerprint(user)

    const token = await jwtCallback()({
      token: { sub: user.id, email: user.email },
      user: { id: user.id, sessionFingerprint: fingerprint },
      account: { provider: "credentials" },
    })
    const refreshed = await jwtCallback()({ token, user: undefined })

    expect(token?.needsSetup2fa).toBeUndefined()
    expect(token?.needs2fa).toBe(true)
    expect(token?.twoFactorMethod).toBe(method)
    expect(refreshed?.needsSetup2fa).toBeUndefined()
    expect(refreshed?.needs2fa).toBe(true)
    expect(refreshed?.twoFactorMethod).toBe(method)
  })

  it("clears stale MFA claims for an ordinary user whose requirement was removed", async () => {
    const ordinaryUser = { ...USER, role: "viewer" }
    prismaMock.user.findUnique.mockResolvedValue(ordinaryUser)
    const fingerprint = authorizedFingerprint(ordinaryUser)

    const refreshed = await jwtCallback()({
      token: {
        sub: ordinaryUser.id,
        email: ordinaryUser.email,
        sessionFingerprint: fingerprint,
        needs2fa: true,
        needsSetup2fa: true,
        twoFactorMethod: "totp",
      },
      user: undefined,
    })

    expect(refreshed?.needs2fa).toBeUndefined()
    expect(refreshed?.needsSetup2fa).toBeUndefined()
    expect(refreshed?.twoFactorMethod).toBeUndefined()
  })

  it("turns a stale setup cookie into a factor challenge after another session enrolls TOTP", async () => {
    const userWithTotp = { ...USER, totpEnabled: true }
    prismaMock.user.findUnique.mockResolvedValue(userWithTotp)
    const fingerprint = authorizedFingerprint(userWithTotp)

    const refreshed = await jwtCallback()({
      token: {
        sub: userWithTotp.id,
        email: userWithTotp.email,
        sessionFingerprint: fingerprint,
        needsSetup2fa: true,
      },
      user: undefined,
    })

    expect(refreshed?.needsSetup2fa).toBeUndefined()
    expect(refreshed?.needs2fa).toBe(true)
    expect(refreshed?.twoFactorMethod).toBe("totp")
  })

  it("supports an OAuth user whose local password hash is empty", async () => {
    const oauthUser = { ...USER, passwordHash: "", passwordChangedAt: null }
    prismaMock.user.findUnique.mockResolvedValue(oauthUser)

    const token = await jwtCallback()({
      token: { sub: oauthUser.id, email: oauthUser.email },
      user: { id: oauthUser.id },
      account: { provider: "google" },
    })
    const refreshed = await jwtCallback()({ token, user: undefined })

    expect(token.sessionFingerprint).toEqual(expect.any(String))
    expect(refreshed?.sessionFingerprint).toBe(token.sessionFingerprint)
  })

  it("never exposes password material or the fingerprint in the session response", async () => {
    const fingerprint = authorizedFingerprint()
    const session = await sessionCallback()({
      session: {
        sessionFingerprint: fingerprint,
        identityCrm: { credentialEpoch: 9 },
        passwordHash: USER.passwordHash,
        user: {
          email: USER.email,
          name: USER.name,
          sessionFingerprint: fingerprint,
          identityCrm: { credentialEpoch: 9 },
          passwordHash: USER.passwordHash,
        },
      },
      token: {
        sub: USER.id,
        email: USER.email,
        name: USER.name,
        role: USER.role,
        organizationId: USER.organizationId,
        organizationSlug: USER.organization.slug,
        organizationName: USER.organization.name,
        plan: USER.organization.plan,
        sessionFingerprint: fingerprint,
        identityCrm: { credentialEpoch: 9 },
      },
    })
    const serialized = JSON.stringify(session)

    expect(session.sessionFingerprint).toBeUndefined()
    expect(session.user.sessionFingerprint).toBeUndefined()
    expect(session.user.passwordHash).toBeUndefined()
    expect(session.identityCrm).toBeUndefined()
    expect(session.user.identityCrm).toBeUndefined()
    expect(serialized).not.toContain("credentialEpoch")
    expect(serialized).not.toContain(fingerprint)
    expect(serialized).not.toContain(USER.passwordHash)
  })

  it("rejects every pre-change cookie even when issue/change share one second", async () => {
    const token = await jwtCallback()({
      token: { sub: USER.id, email: USER.email, iat: 1_786_449_600 },
      user: { id: USER.id, sessionFingerprint: authorizedFingerprint() },
      account: { provider: "credentials" },
    })
    prismaMock.user.findUnique.mockResolvedValue({
      ...USER,
      passwordHash: "$2b$12$after-password-change",
      passwordChangedAt: new Date("2026-08-11T12:00:00.900Z"),
    })

    const refreshed = await jwtCallback()({ token, user: undefined })

    expect(refreshed).toBeNull()
  })

  it("rejects every cookie after logout-all without changing the password hash", async () => {
    const token = await jwtCallback()({
      token: { sub: USER.id, email: USER.email },
      user: { id: USER.id, sessionFingerprint: authorizedFingerprint() },
      account: { provider: "credentials" },
    })
    prismaMock.user.findUnique.mockResolvedValue({
      ...USER,
      passwordChangedAt: new Date("2026-08-11T12:00:00.101Z"),
    })

    expect(await jwtCallback()({ token, user: undefined })).toBeNull()
  })

  it("rejects a login raced by a password change after bcrypt verification", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...USER,
      passwordHash: "$2b$12$concurrently-changed",
      passwordChangedAt: new Date("2026-08-11T12:00:00.900Z"),
    })

    const token = await jwtCallback()({
      token: { sub: USER.id, email: USER.email },
      user: { id: USER.id, sessionFingerprint: authorizedFingerprint() },
      account: { provider: "credentials" },
    })

    expect(token).toBeNull()
  })

  it("rejects legacy cookies that do not carry a fingerprint", async () => {
    const refreshed = await jwtCallback()({
      token: { sub: USER.id, email: USER.email, iat: 1_786_449_600 },
      user: undefined,
    })

    expect(refreshed).toBeNull()
  })

  it("fails closed when fresh DB validation is unavailable", async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("db down"))

    const refreshed = await jwtCallback()({
      token: { sub: USER.id, email: USER.email, sessionFingerprint: "stale" },
      user: undefined,
    })

    expect(refreshed).toBeNull()
  })
})

/**
 * The proxy resolving an API call defers the database refresh to the route, which resolves the
 * session again (lib/auth-refresh-scope; 2026-11-12, ~80 ms of database work per API request saved).
 * Outside that scope the refresh — and every refusal — is exactly as before.
 */
describe("session refresh deferred to the route for API calls", () => {
  const existing = () => ({ token: { sub: USER.id, role: USER.role, organizationId: USER.organizationId, sessionFingerprint: authorizedFingerprint() }, user: undefined })

  it("inside the proxy's API scope the cookie's claims pass without a database read", async () => {
    const { withSessionRefreshDeferred } = await import("@/lib/auth-refresh-scope")
    const token = await withSessionRefreshDeferred(() => jwtCallback()(existing()))
    expect(token).toMatchObject({ sub: USER.id, role: USER.role })
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    expect(readLegacyCrmCredentialBoundary).not.toHaveBeenCalled()
  })

  it("the route's own resolution still refuses a deactivated person on the next request", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...USER, isActive: false })
    expect(await jwtCallback()(existing())).toBeNull()
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1)
  })

  it("a session update is never deferred", async () => {
    const { withSessionRefreshDeferred } = await import("@/lib/auth-refresh-scope")
    await withSessionRefreshDeferred(() => jwtCallback()({ ...existing(), trigger: "update", session: { name: "X" } }))
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1)
  })

  it("the proxy defers only for API calls, never for pages or the auth endpoints", async () => {
    const { proxyDefersSessionRefresh } = await import("@/lib/auth-refresh-scope")
    expect(proxyDefersSessionRefresh("/api/v1/task-types")).toBe(true)
    expect(proxyDefersSessionRefresh("/api/v1/notifications")).toBe(true)
    for (const path of ["/dashboard", "/boards/x", "/api/auth/session", "/api/auth/callback/credentials", "/api/v1/auth/2fa/verify", "/api/v1/auth"]) {
      expect(proxyDefersSessionRefresh(path)).toBe(false)
    }
  })
})

/**
 * Opening a page sends dozens of API requests at once; each used to read the person, their
 * company and their CRM eligibility for itself. Requests whose reads overlap now share one
 * (lib/auth-refresh-flight). Nothing is kept once the read settles: the next request reads again.
 */
describe("requests that arrive together share one read of the person", () => {
  const existing = (user = USER) => ({ token: { sub: user.id, role: user.role, organizationId: user.organizationId, sessionFingerprint: authorizedFingerprint(user) }, user: undefined })
  /** A database read that answers only when the test says so. */
  function heldRead() {
    let answer!: (row: unknown) => void
    let fail!: (error: Error) => void
    const pending = new Promise((resolve, reject) => { answer = resolve; fail = reject })
    return { pending, answer, fail }
  }

  it("two requests in flight read the database once, and each gets its own session", async () => {
    const read = heldRead()
    prismaMock.user.findUnique.mockReturnValueOnce(read.pending)
    const first = jwtCallback()(existing())
    await vi.waitFor(() => expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1))
    const second = jwtCallback()(existing())
    await Promise.resolve()
    read.answer({ ...USER })
    const [a, b] = await Promise.all([first, second])

    expect(a).toMatchObject({ sub: USER.id, role: USER.role, organizationId: USER.organizationId })
    expect(b).toMatchObject({ sub: USER.id, role: USER.role, organizationId: USER.organizationId })
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1)
    expect(readLegacyCrmCredentialBoundary).toHaveBeenCalledTimes(1)
    // Two sessions, not one object handed to both requests.
    expect(a).not.toBe(b)
    expect(a.modules).not.toBe(b.modules)
  })

  it("keeps nothing: the request after a shared read is refused once the person is deactivated", async () => {
    const read = heldRead()
    prismaMock.user.findUnique.mockReturnValueOnce(read.pending)
    const first = jwtCallback()(existing())
    await vi.waitFor(() => expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1))
    const second = jwtCallback()(existing())
    read.answer({ ...USER })
    expect(await first).not.toBeNull()
    expect(await second).not.toBeNull()

    prismaMock.user.findUnique.mockResolvedValue({ ...USER, isActive: false })
    expect(await jwtCallback()(existing())).toBeNull()
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2)
    const { sessionReadsInFlight } = await import("@/lib/auth-refresh-flight")
    expect(sessionReadsInFlight()).toBe(0)
  })

  it("a refusal is shared too: everyone waiting on the read of a deactivated person is refused", async () => {
    const read = heldRead()
    prismaMock.user.findUnique.mockReturnValueOnce(read.pending)
    const first = jwtCallback()(existing())
    await vi.waitFor(() => expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1))
    const second = jwtCallback()(existing())
    read.answer({ ...USER, isActive: false })
    expect(await Promise.all([first, second])).toEqual([null, null])
  })

  it("a failed read denies everyone who shared it and is not remembered", async () => {
    const read = heldRead()
    prismaMock.user.findUnique.mockReturnValueOnce(read.pending)
    const first = jwtCallback()(existing())
    await vi.waitFor(() => expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1))
    const second = jwtCallback()(existing())
    read.fail(new Error("db down"))
    expect(await Promise.all([first, second])).toEqual([null, null])

    prismaMock.user.findUnique.mockResolvedValue({ ...USER })
    expect(await jwtCallback()(existing())).toMatchObject({ sub: USER.id })
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2)
  })

  it("each request still answers for its own cookie: a stale fingerprint is refused on a shared read", async () => {
    const read = heldRead()
    prismaMock.user.findUnique.mockReturnValueOnce(read.pending)
    const current = jwtCallback()(existing())
    await vi.waitFor(() => expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1))
    const stale = jwtCallback()({ token: { ...existing().token, sessionFingerprint: "issued-before-the-password-change" }, user: undefined })
    read.answer({ ...USER })
    expect(await current).toMatchObject({ sub: USER.id })
    expect(await stale).toBeNull()
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1)
  })

  it("another person's read is never shared", async () => {
    const OTHER = { ...USER, id: "user-2", email: "other@example.com", name: "Other", role: "viewer" }
    const read = heldRead()
    prismaMock.user.findUnique.mockReturnValueOnce(read.pending).mockResolvedValueOnce({ ...OTHER })
    const first = jwtCallback()(existing())
    await vi.waitFor(() => expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1))
    const other = await jwtCallback()(existing(OTHER))
    read.answer({ ...USER })

    expect(other).toMatchObject({ sub: OTHER.id, role: "viewer", name: "Other" })
    expect(await first).toMatchObject({ sub: USER.id, role: USER.role, name: USER.name })
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2)
    expect(prismaMock.user.findUnique.mock.calls.map(([args]: any[]) => args.where)).toEqual([{ id: USER.id }, { id: OTHER.id }])
  })

  it("a session update reads for itself even while another read is running", async () => {
    const read = heldRead()
    prismaMock.user.findUnique.mockReturnValueOnce(read.pending).mockResolvedValueOnce({ ...USER })
    const first = jwtCallback()(existing())
    await vi.waitFor(() => expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1))
    await jwtCallback()({ ...existing(), trigger: "update", session: { name: "X" } })
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2)
    read.answer({ ...USER })
    await first
  })
})
