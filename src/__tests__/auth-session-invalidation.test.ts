import { beforeEach, describe, expect, it, vi } from "vitest"

const authCapture = vi.hoisted(() => ({ config: null as any }))
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}))

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
  prismaMock.user.findUnique.mockResolvedValue(USER)
})

describe("Auth.js password-session invalidation", () => {
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
        passwordHash: USER.passwordHash,
        user: {
          email: USER.email,
          name: USER.name,
          sessionFingerprint: fingerprint,
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
      },
    })
    const serialized = JSON.stringify(session)

    expect(session.sessionFingerprint).toBeUndefined()
    expect(session.user.sessionFingerprint).toBeUndefined()
    expect(session.user.passwordHash).toBeUndefined()
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
