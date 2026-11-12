/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Remember me" on /login, through the real Auth.js callbacks.
 *
 * Owner 2026-11-12: clients typed their login every morning, because a session
 * ended after 8 idle hours. Ticked, the box keeps a session for 30 days from
 * the last visit; left empty, the 8 idle hours stay exactly as they were.
 * Only Prisma and the framework wrapper are stubbed; the provider's
 * `authorize` and the jwt callback are the ones production runs.
 */
import { readLegacyCrmCredentialBoundary } from "@/lib/identity/legacy-crm-boundary"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

import { IDLE_SESSION_SECONDS, REMEMBERED_SESSION_SECONDS, startSessionLifetime } from "@/lib/auth-session-lifetime"

const jwt = (input: any) => (authCapture.config.callbacks.jwt as (input: any) => Promise<any>)(input)
const authorize = (credentials: Record<string, unknown>) => authCapture.config.providers[0].authorize(credentials)

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const START = new Date("2026-11-12T08:00:00.000Z").getTime()

function at(ms: number) { vi.setSystemTime(new Date(ms)) }

/** Signing in through the real provider, then the token Auth.js would mint. */
async function signIn(rememberMe?: string) {
  at(START)
  const user = await authorize({
    email: USER.email,
    password: "Fictional-Crm-Pass-2026!",
    ...(rememberMe === undefined ? {} : { rememberMe }),
  })
  expect(user).not.toBeNull()
  const token = await jwt({ token: { sub: USER.id, email: USER.email }, user, account: { provider: "credentials" } })
  expect(token).not.toBeNull()
  return token
}

/** A later request: Auth.js decodes the cookie and runs the callback again. */
async function visit(token: any, ms: number) {
  at(ms)
  return jwt({ token: { ...token }, user: undefined })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.mocked(readLegacyCrmCredentialBoundary).mockResolvedValue("LEGACY")
  prismaMock.user.findUnique.mockResolvedValue(USER)
  prismaMock.user.findMany.mockResolvedValue([USER])
  prismaMock.user.update.mockResolvedValue(USER)
  prismaMock.organization.findUnique.mockResolvedValue({ ...USER.organization, id: USER.organizationId })
})

afterEach(() => { vi.useRealTimers() })

describe("Remember me on /login", () => {
  it("the cookie can live 30 days — the remembered length", () => {
    expect(authCapture.config.session.maxAge).toBe(REMEMBERED_SESSION_SECONDS)
    expect(REMEMBERED_SESSION_SECONDS).toBe(30 * 24 * 60 * 60)
  })

  it("ticked: still signed in the next morning and after three weeks away", async () => {
    const token = await signIn("1")
    const nextMorning = await visit(token, START + 24 * HOUR)
    expect(nextMorning).not.toBeNull()
    expect(nextMorning.sub).toBe(USER.id)
    const afterHoliday = await visit(nextMorning, START + 24 * HOUR + 21 * DAY)
    expect(afterHoliday).not.toBeNull()
  })

  it("left empty: as before — fine within 8 idle hours, signed out after them", async () => {
    const token = await signIn("0")
    const afternoon = await visit(token, START + 7 * HOUR)
    expect(afternoon).not.toBeNull()
    // Activity moves the 8 hours: 7 h after the afternoon visit is still in.
    const evening = await visit(afternoon, START + 14 * HOUR)
    expect(evening).not.toBeNull()

    prismaMock.user.findUnique.mockClear()
    const nextMorning = await visit(evening, START + 14 * HOUR + IDLE_SESSION_SECONDS * 1000 + 1000)
    expect(nextMorning).toBeNull()
    // Dropped before touching the database.
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
  })

  it("an old form that does not send the box is treated as not ticked", async () => {
    const token = await signIn(undefined)
    expect(await visit(token, START + 9 * HOUR)).toBeNull()
  })

  it("a cookie issued before the box existed keeps its 8 idle hours, counted from iat", async () => {
    const iat = Math.floor((START - 9 * HOUR) / 1000)
    const sessionFingerprint = createSessionFingerprint({
      principalId: USER.id, passwordHash: USER.passwordHash, passwordChangedAt: USER.passwordChangedAt, secret: AUTH_SECRET,
    })
    const legacy = { sub: USER.id, email: USER.email, sessionFingerprint, iat }
    expect(await visit(legacy, START)).toBeNull()
    expect(await visit({ ...legacy, iat: Math.floor((START - HOUR) / 1000) }, START)).not.toBeNull()
  })

  it("remembering does not outlive a password change", async () => {
    const token = await signIn("1")
    prismaMock.user.findUnique.mockResolvedValue({
      ...USER,
      passwordHash: "$2b$12$after-password-change",
      passwordChangedAt: new Date("2026-11-12T09:00:00.000Z"),
    })
    expect(await visit(token, START + 2 * DAY)).toBeNull()
  })

  it("an outside reviewer is never remembered", () => {
    const token: Record<string, unknown> = {}
    startSessionLifetime(token, { rememberMe: true, role: "reviewer", nowSeconds: 1 })
    expect(token.rememberMe).toBeUndefined()
    startSessionLifetime(token, { rememberMe: true, role: "manager", nowSeconds: 1 })
    expect(token.rememberMe).toBe(true)
  })
})
