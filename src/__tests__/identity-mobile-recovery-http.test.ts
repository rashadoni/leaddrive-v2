import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
const m = vi.hoisted(() => ({ org: vi.fn(), limit: vi.fn(), issue: vi.fn(), verify: vi.fn(), finish: vi.fn(), holder: vi.fn(), sender: vi.fn(), send: vi.fn(), oldSetup: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (work: () => unknown) => work(), runWithTenant: (_org: string, work: () => unknown) => work() }))
vi.mock("@/lib/identity/time-enrollment", () => ({ enrollExistingIdentityInTimeInTransaction: vi.fn() }))
vi.mock("@/lib/identity/mobile-recovery-runtime", () => ({ requestIdentityMobileRecovery: m.issue, verifyIdentityMobileRecovery: m.verify, finishIdentityMobileRecovery: m.finish }))
vi.mock("@/lib/mtm/mobile-login-code-flow", async importOriginal => ({ ...await importOriginal<object>(), companyBySlug: m.org, codeFlowRateLimit: m.limit, codeHolder: m.holder }))
vi.mock("@/lib/mtm/whatsapp-login-code", () => ({ loginCodeSender: m.sender, loginCodeTemporarilyUnavailable: () => false, sendLoginCodeToWhatsApp: m.send }))
vi.mock("@/lib/mtm/mobile-login-session", () => ({ readPasswordSetupToken: m.oldSetup, mobileAppRefusal: vi.fn(), legacyMobileMaySignIn: vi.fn(), signPasswordSetupToken: vi.fn() }))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn() }))
import { POST as request } from "@/app/api/v1/mtm/mobile/auth/code/route"
import { POST as verify } from "@/app/api/v1/mtm/mobile/auth/code/verify/route"
import { POST as finish } from "@/app/api/v1/mtm/mobile/auth/password/route"
const challengeId = "f45ee508-374f-44ea-a2a1-c095898493b6"
const input = { organizationSlug: "fixture-company", phone: "+994507770012", application: "TIME" }
const call = (route: typeof request, body: unknown) => route(new NextRequest("https://fixture.invalid/api/v1/mtm/mobile/auth/code", { method: "POST", body: JSON.stringify(body) }))
beforeEach(() => {
  vi.resetAllMocks()
  m.org.mockResolvedValue({ id: "server-tenant", name: "Fictional Company" })
  m.limit.mockResolvedValue(null); m.sender.mockResolvedValue({ phoneNumberId: "fixture", accessToken: "fictional-not-a-secret" })
  m.issue.mockResolvedValue({ status: "HANDLED", challengeId })
  m.verify.mockResolvedValue({ status: "CONFIRMED", setupToken: ["lds3", "fixture"].join("."), name: "Fictional Person" })
  m.finish.mockResolvedValue({ status: "AUTHENTICATED", data: { application: "TIME", token: "fixture-session", agent: { id: "time-card" } } })
})
describe("public common-password recovery composition", () => {
  it("rate limits before resolving company and issuing a purpose-bound challenge", async () => {
    const response = await call(request, input)
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ sent: true, resendAfterSeconds: 60, expiresInSeconds: 600, challengeId })
    expect(m.limit.mock.invocationCallOrder[0]).toBeLessThan(m.org.mock.invocationCallOrder[0])
    expect(m.issue).toHaveBeenCalledWith(expect.anything(), "server-tenant", { phone: input.phone, application: "TIME" }, expect.any(Function))
    expect(m.holder).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
  it("keeps unknown and legacy request response shapes identical for new clients", async () => {
    m.issue.mockResolvedValue({ status: "LEGACY" }); m.holder.mockResolvedValue({ kind: "nobody", reason: "no_card" })
    const response = await call(request, input), data = (await response.json()).data
    expect(data).toEqual({ sent: true, resendAfterSeconds: 60, expiresInSeconds: 600, challengeId: expect.any(String) })
    expect(m.send).not.toHaveBeenCalled()
  })
  it("confirms against the server-selected tenant and challenge without legacy lookup", async () => {
    const response = await call(verify, { ...input, challengeId, code: "123456" })
    expect(response.status).toBe(200)
    expect(m.verify).toHaveBeenCalledWith(expect.anything(), "server-tenant", { phone: input.phone, application: "TIME", challengeId, code: "123456" })
    expect(m.holder).not.toHaveBeenCalled()
  })
  it("does not fall back after canonical refusal", async () => {
    m.verify.mockResolvedValue({ status: "DENIED" })
    expect((await call(verify, { ...input, challengeId, code: "123456" })).status).toBe(400)
    expect(m.holder).not.toHaveBeenCalled()
  })
  it.each([["lds2", "fixture"].join("."), ["lds3", "fixture"].join(".")])("sets the shared password only through the selected application: %s", async setupToken => {
    const response = await call(finish, { organizationSlug: input.organizationSlug, application: "TIME", setupToken, password: "Fictional!Recovered482" })
    expect(response.status).toBe(200)
    expect(m.finish).toHaveBeenCalledWith(expect.anything(), "server-tenant", { application: "TIME", setupToken, password: "Fictional!Recovered482" }, expect.any(Function), expect.any(Function))
    expect(m.oldSetup).not.toHaveBeenCalled()
  })
  it.each([{}, { organizationSlug: input.organizationSlug }, { application: "TIME" }])("refuses canonical setup missing company/application: %j", async scope => {
    expect((await call(finish, { ...scope, setupToken: ["lds3", "fixture"].join("."), password: "Fictional!Recovered482" })).status).toBe(401)
    expect(m.finish).not.toHaveBeenCalled(); expect(m.oldSetup).not.toHaveBeenCalled()
  })
  it.each([request, verify, finish])("stops all processing when the distributed limit refuses", async route => {
    m.limit.mockResolvedValue(new Response(null, { status: 429 }))
    const body = route === request ? input : route === verify ? { ...input, code: "123456" } : { setupToken: ["lds3", "fixture"].join("."), password: "Fictional!Recovered482" }
    expect((await call(route, body)).status).toBe(429)
    expect(m.org).not.toHaveBeenCalled(); expect(m.issue).not.toHaveBeenCalled(); expect(m.verify).not.toHaveBeenCalled(); expect(m.finish).not.toHaveBeenCalled()
  })
  it("rejects caller-supplied tenant IDs and CRM selection", async () => {
    expect((await call(request, { ...input, organizationId: "foreign" })).status).toBe(400)
    expect((await call(request, { ...input, application: "CRM" })).status).toBe(400)
    expect(m.issue).not.toHaveBeenCalled()
  })
})
