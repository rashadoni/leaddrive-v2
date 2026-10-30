import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
const m = vi.hoisted(() => ({ admin: vi.fn(), limit: vi.fn(), review: vi.fn(), request: vi.fn(), confirm: vi.fn(), finish: vi.fn(), send: vi.fn(), sender: vi.fn(), dispatch: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_org: string, work: () => unknown) => work() }))
vi.mock("@/lib/identity/administrator-request", () => ({ requireIdentityAdministrator: m.admin }))
vi.mock("@/lib/identity/self-bootstrap", async original => ({ ...await original<typeof import("@/lib/identity/self-bootstrap")>(),
  reviewIdentitySelfBootstrap: m.review, requestIdentitySelfBootstrap: m.request, confirmIdentitySelfBootstrap: m.confirm, finishIdentitySelfBootstrap: m.finish }))
vi.mock("@/lib/identity/runtime-keys", () => ({ identityRuntimeKeys: () => ({ proof: { active: {}, resolve: () => null }, mobile: {} }) }))
vi.mock("@/lib/identity/phone-proof-dispatch", () => ({ dispatchStagedPhoneProof: m.dispatch }))
vi.mock("@/lib/mtm/mobile-login-code-flow", () => ({ codeFlowRateLimit: m.limit }))
vi.mock("@/lib/mtm/whatsapp-login-code", () => ({ loginCodeSender: m.sender, loginCodeTemporarilyUnavailable: () => false, sendLoginCodeToWhatsApp: m.send }))
import { POST } from "@/app/api/v1/identity/self-bootstrap/route"
import { IdentitySelfBootstrapConflictError } from "@/lib/identity/self-bootstrap"
const actor = { organizationId: "fixture-org", userId: "fixture-admin", mode: "LEGACY" }
const request = { action: "request", phone: "+994507770099", sourceRevision: "a".repeat(64), requestId: "87f4a730-a185-4771-9532-2f37ab37acdd", language: "ru" }
const call = (data: unknown) => POST(new NextRequest("https://fixture.example/api/v1/identity/self-bootstrap", { method: "POST", body: JSON.stringify(data) }))
beforeEach(() => {
  vi.resetAllMocks(); m.admin.mockResolvedValue(actor); m.limit.mockResolvedValue(null); m.sender.mockResolvedValue({}); m.request.mockResolvedValue({ proofId: "fixture-proof", expiresAt: "2026-10-25T12:10:00Z" })
  m.dispatch.mockResolvedValue({ status: "SENT" }); m.review.mockResolvedValue({ name: "Fixture admin" })
  m.confirm.mockResolvedValue({ status: "CONFIRMED", setupToken: ["lds1", "fixture"].join(".") }); m.finish.mockResolvedValue({ status: "ACTIVE" })
})
describe("live administrator self-bootstrap HTTP boundary", () => {
  it("returns bounded private conflict details only from the administrator review", async () => {
    const conflicts = [{ id: "fixture-card", kind: "field" as const, name: "Fictional field card", active: false, ownerName: null }]
    m.review.mockRejectedValue(new IdentitySelfBootstrapConflictError(conflicts))
    const response = await call({ action: "review", phone: request.phone })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "IDENTITY_SELF_BOOTSTRAP_PHONE_CONFLICT", conflicts })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(m.request).not.toHaveBeenCalled(); expect(m.sender).not.toHaveBeenCalled(); expect(m.dispatch).not.toHaveBeenCalled()
    m.request.mockRejectedValue(new IdentitySelfBootstrapConflictError(conflicts))
    expect(await (await call(request)).json()).toEqual({ error: "IDENTITY_SELF_BOOTSTRAP_PHONE_CONFLICT" })
  })
  it.each([401, 403])("retains current cookie/MFA refusal %s", async status => {
    m.admin.mockResolvedValue(NextResponse.json({ error: "denied" }, { status }))
    expect((await call(request)).status).toBe(status); expect(m.request).not.toHaveBeenCalled(); expect(m.sender).not.toHaveBeenCalled()
  })
  it("does not reinterpret a canonical administrator as a legacy self-review", async () => {
    m.admin.mockResolvedValue({ ...actor, mode: "CANONICAL" })
    expect((await call(request)).status).toBe(409); expect(m.request).not.toHaveBeenCalled()
  })
  it.each(["userId", "organizationId", "applications", "issuerAuthority", "artifactSha"])("rejects caller-supplied %s", async field => {
    expect((await call({ ...request, [field]: "forged" })).status).toBe(400); expect(m.request).not.toHaveBeenCalled()
  })
  it("checks distributed limits before proof or provider operations", async () => {
    m.limit.mockResolvedValue(NextResponse.json({}, { status: 429 }))
    expect((await call(request)).status).toBe(429); expect(m.request).not.toHaveBeenCalled(); expect(m.sender).not.toHaveBeenCalled()
  })
  it("does not stage a proof when no approved sender is configured", async () => {
    m.sender.mockResolvedValue(null)
    expect((await call(request)).status).toBe(409); expect(m.request).not.toHaveBeenCalled()
  })
  it("uses only server administrator authority and bounded shared dispatch", async () => {
    expect((await call(request)).status).toBe(200)
    const review = { phone: request.phone, sourceRevision: request.sourceRevision, requestId: request.requestId }
    expect(m.request).toHaveBeenCalledWith({}, actor, review, {})
    expect(m.dispatch).toHaveBeenCalledWith(actor.organizationId, "fixture-proof", expect.objectContaining({ send: expect.any(Function) }))
    expect(m.send).not.toHaveBeenCalled()
  })
  it("returns only setup capability after confirmation, never account revisions", async () => {
    const response = await call({ action: "confirm", proofId: "fixture-proof", code: "123456" })
    expect(await response.json()).toEqual({ success: true, data: { setupToken: ["lds1", "fixture"].join(".") } })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it("requires fresh sign-in after completion and does not mint a cookie", async () => {
    const response = await call({ action: "finish", setupToken: ["lds1", "fixture"].join("."), password: "Fictional!Admin482" })
    expect(await response.json()).toEqual({ success: true, data: { signInRequired: true } })
    expect(response.headers.get("set-cookie")).toBeNull()
  })
})
