import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
type Config = { providers: Array<{ authorize: (input: Record<string, string>) => Promise<Record<string, unknown> | null> }>; callbacks: { jwt: (input: { token: { sub: string }; user?: undefined }) => Promise<unknown> } }
const state = vi.hoisted(() => ({ config: undefined as Config | undefined, findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), sendOtp: vi.fn(), compare: vi.fn() }))
vi.mock("next-auth", () => ({ default: (config: Config) => { state.config = config; return {} } }))
vi.mock("next-auth/providers/credentials", () => ({ default: (config: unknown) => config }))
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }))
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: state.findMany, findUnique: state.findUnique, update: state.update } } }))
vi.mock("bcryptjs", () => ({ default: { compare: state.compare } }))
vi.mock("@/lib/sms", () => ({ sendOtp: state.sendOtp }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, hashForRateLimit: async () => "synthetic", RATE_LIMIT_CONFIG: { authPrincipal: {} } }))
import "@/lib/auth"
const CANARY = "PRIVATE_SYNTHETIC_person@example.invalid"
const credentials = { email: CANARY, password: "synthetic-private-password" }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("REQUIRE_TENANT_SLUG", "0"); state.update.mockResolvedValue({}); state.compare.mockResolvedValue(true) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
describe("actual Auth.js callback privacy", () => {
  it("legacy lookup and rejected login log neither a masked identity nor the raw provider error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    state.findMany.mockRejectedValue(new Error(CANARY, { cause: { password: credentials.password } }))
    expect(await state.config!.providers[0].authorize(credentials)).toBeNull()
    expect(warn.mock.calls).toEqual([["[Auth] legacy email-only lookup (F-36 deprecated path)"]])
    expect(error.mock.calls).toEqual([["[application] operation failed", { operation: "auth-login" }]])
  })
  it("session refresh still fails closed on database failure with a finite warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    state.findUnique.mockRejectedValue(new Error(CANARY))
    expect(await state.config!.callbacks.jwt({ token: { sub: CANARY } })).toBeNull()
    expect(warn.mock.calls).toEqual([["[application] operation failed", { operation: "auth-session-validation" }]])
  })
  it("SMS failure retains authenticated setup flow and sends no phone, principal or provider error to console", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    state.findMany.mockResolvedValue([{ id: CANARY, email: CANARY, name: CANARY, role: "admin", organizationId: CANARY, passwordHash: "synthetic-hash", totpEnabled: false, smsAuthEnabled: true, verifiedPhone: "+10000000001", organization: { isActive: true, slug: "synthetic", name: CANARY, plan: "starter" } }])
    state.sendOtp.mockRejectedValue(new Error(CANARY))
    expect(await state.config!.providers[0].authorize(credentials)).toMatchObject({ id: CANARY, needs2fa: true, twoFactorMethod: "sms" })
    expect(state.sendOtp).toHaveBeenCalledOnce()
    expect(error.mock.calls).toEqual([["[application] operation failed", { operation: "auth-sms-dispatch" }]])
  })
})
