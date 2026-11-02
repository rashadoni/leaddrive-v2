import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RegistryClient } from "./registry"
const m = vi.hoisted(() => ({ onboardingIssue: vi.fn(), onboardingConfirm: vi.fn(), onboardingFinish: vi.fn(), intent: vi.fn(), snapshot: vi.fn(), claim: vi.fn(), proof: vi.fn(), keys: vi.fn(), issue: vi.fn(), confirm: vi.fn(), reset: vi.fn(), login: vi.fn(), dispatch: vi.fn() }))
vi.mock("./mobile-session-resolver", () => ({ withIdentityMobileReadSnapshot: m.snapshot }))
vi.mock("./runtime-keys", () => ({ identityRuntimeKeys: m.keys }))
vi.mock("./onboarding", () => ({ issueIdentityOnboardingProof: m.onboardingIssue, confirmIdentityOnboardingProof: m.onboardingConfirm, finishIdentityOnboarding: m.onboardingFinish }))
vi.mock("./canonical-recovery", () => ({ issueCanonicalRecovery: m.issue, confirmCanonicalRecovery: m.confirm, resetCanonicalPassword: m.reset }))
vi.mock("./mobile-login-runtime", () => ({ identityMobileLogin: m.login }))
vi.mock("./phone-proof-dispatch", () => ({ dispatchStagedPhoneProof: m.dispatch }))
import { requestIdentityMobileRecovery as request, verifyIdentityMobileRecovery as verify, finishIdentityMobileRecovery as finish } from "./mobile-recovery-runtime"
const client = {} as RegistryClient, input = { phone: "+994507770014", application: "TIME" as const }, send = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  m.snapshot.mockImplementation(async (_client, _org, work) => ({ value: await work({ identityPhoneClaim: { findUnique: m.claim }, identityPhoneProof: { findFirst: m.proof }, identityOnboardingIntent: { findFirst: m.intent } }) }))
  m.intent.mockResolvedValue(null)
  m.claim.mockResolvedValue({ account: { cutoverAt: new Date() } }); m.proof.mockResolvedValue(null)
  m.keys.mockReturnValue({ proof: { active: { id: "fixture", material: new Uint8Array(32).fill(71) }, resolve: vi.fn() }, mobile: {} })
  m.issue.mockResolvedValue({ proofId: "challenge", expiresAt: new Date().toISOString() })
  m.dispatch.mockResolvedValue({ status: "SENT" })
})
describe("mobile recovery runtime refuses legacy fallback", () => {
  it("selects only a canonical phone within the trusted company before issuing", async () => {
    expect(await request(client, "tenant-a", input, send)).toEqual({ status: "HANDLED", challengeId: "challenge" })
    expect(m.claim).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId_normalizedPhone: { organizationId: "tenant-a", normalizedPhone: input.phone } } }))
    expect(m.dispatch).toHaveBeenCalledOnce()
  })
  it("returns legacy only after a successful read proves there is no cutover", async () => {
    m.claim.mockResolvedValue(null)
    expect(await request(client, "tenant-a", input, send)).toEqual({ status: "LEGACY" })
    expect(m.issue).not.toHaveBeenCalled(); expect(m.dispatch).not.toHaveBeenCalled()
  })
  it.each(["key", "authority", "delivery", "database"])("keeps %s failure private and never falls back", async mode => {
    if (mode === "key") m.keys.mockReturnValue({ proof: null, mobile: null })
    if (mode === "authority") m.issue.mockRejectedValue(new Error("private-fixture-payload"))
    if (mode === "delivery") m.dispatch.mockRejectedValue(new Error("private-fixture-payload"))
    if (mode === "database") m.snapshot.mockRejectedValue(new Error("private-fixture-payload"))
    const result = await request(client, "tenant-a", input, send)
    expect(result).toEqual({ status: "HANDLED", challengeId: expect.any(String) })
    expect(JSON.stringify(result)).not.toContain("private")
  })
  it("uses only the stored onboarding review for a staged number", async () => {
    m.claim.mockResolvedValue({ account: { cutoverAt: null } }); m.intent.mockResolvedValue({ id: "review", application: "TIME" })
    m.onboardingIssue.mockResolvedValue({ proofId: "first-login-proof" })
    expect(await request(client, "tenant-a", input, send)).toEqual({ status: "HANDLED", challengeId: "first-login-proof" })
    expect(m.issue).not.toHaveBeenCalled()
    expect(m.onboardingIssue).toHaveBeenCalledWith(client, "tenant-a", { ...input, requestId: expect.any(String) }, expect.anything())
  })
  it("never tries recovery or legacy when a stored first-login invitation refuses", async () => {
    m.claim.mockResolvedValue(null); m.intent.mockResolvedValue({ id: "review", application: "ROUTE_FIELD" })
    m.onboardingIssue.mockResolvedValue(null)
    expect(await request(client, "tenant-a", input, send)).toEqual({ status: "HANDLED", challengeId: expect.any(String) })
    expect(m.issue).not.toHaveBeenCalled(); expect(m.dispatch).not.toHaveBeenCalled()
  })
  it("does not reinterpret a manually staged v2 proof as public onboarding", async () => {
    m.claim.mockResolvedValue(null); m.proof.mockResolvedValue({ contextVersion: 2, normalizedPhone: input.phone, onboardingIntentId: null })
    expect(await verify(client, "tenant-a", { ...input, challengeId: "manual-proof", code: "123456" })).toEqual({ status: "DENIED" })
    expect(m.onboardingConfirm).not.toHaveBeenCalled(); expect(m.confirm).not.toHaveBeenCalled()
  })
  it("requires a challenge for the canonical number", async () => {
    expect(await verify(client, "tenant-a", { ...input, code: "123456" })).toEqual({ status: "DENIED" })
    expect(m.confirm).not.toHaveBeenCalled()
  })
  it("does not reinterpret a retained canonical challenge after phone ownership changes", async () => {
    m.claim.mockResolvedValue(null)
    m.proof.mockResolvedValue({ contextVersion: 3, normalizedPhone: "+994507770099" })
    expect(await verify(client, "tenant-a", { ...input, challengeId: "old-proof", code: "123456" })).toEqual({ status: "DENIED" })
    expect(m.confirm).not.toHaveBeenCalled()
  })
  it("does not issue a session when setup or key validation fails", async () => {
    expect(await finish(client, "tenant-a", { setupToken: "legacy-fixture", password: "Fictional!482", application: "TIME" }, () => null)).toEqual({ status: "DENIED" })
    expect(m.reset).not.toHaveBeenCalled(); expect(m.login).not.toHaveBeenCalled()
  })
})
