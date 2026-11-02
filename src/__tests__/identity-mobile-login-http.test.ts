import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
const mocks = vi.hoisted(() => ({ org: vi.fn(), legacy: vi.fn(), canonical: vi.fn(), limit: vi.fn(), audit: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUnique: mocks.org }, mtmAgent: { findFirst: mocks.legacy } } }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (work: () => unknown) => work(), runWithTenant: (_org: string, work: () => unknown) => work() }))
vi.mock("@/lib/identity/mobile-login-runtime", () => ({ identityMobileLogin: mocks.canonical }))
vi.mock("@/lib/public-abuse-guard", () => ({ consumePublicRateLimit: mocks.limit }))
vi.mock("@/lib/request-ip", () => ({ clientIp: () => "127.0.0.1" }))
vi.mock("@/lib/rate-limit", () => ({ hashForRateLimit: async () => "fixture-rate-hash" }))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: mocks.audit }))
vi.mock("@/lib/mtm/mobile-login-session", () => ({ linkedUserCredentials: vi.fn(), mobileAppRefusal: vi.fn(), mobileLoginSuccess: vi.fn(), legacyMobileMaySignIn: vi.fn(), legacyLinkedUserMaySignIn: vi.fn() }))
import { POST } from "@/app/api/v1/mtm/mobile/auth/route"
const data = { application: "TIME", organizationSlug: "fixture-company", phone: "+994507770014", password: "Fictional!482" }
const request = (body: unknown = data) => POST(new NextRequest("https://fixture.invalid/api/v1/mtm/mobile/auth", { method: "POST", body: JSON.stringify(body) }))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.org.mockResolvedValue({ id: "server-selected-tenant", isActive: true, name: "Fictional" })
  mocks.limit.mockResolvedValue({ allowed: true, unavailable: false, retryAfterSeconds: 0 })
  mocks.canonical.mockResolvedValue({ status: "AUTHENTICATED", data: { application: "TIME", token: "fictional-session", agent: { id: "time-actor" } } })
  mocks.audit.mockResolvedValue(undefined)
})
describe("canonical phone login through the real mobile HTTP entry point", () => {
  it("uses the server-resolved tenant after both limits and never searches a legacy card", async () => {
    const response = await request({ ...data, organizationId: "foreign-tenant", userId: "foreign-user" })
    expect(response.status).toBe(200)
    expect(mocks.limit).toHaveBeenCalledTimes(2)
    expect(mocks.canonical).toHaveBeenCalledWith(expect.anything(), "server-selected-tenant", { phone: data.phone, password: data.password, application: "TIME" })
    expect(mocks.legacy).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "server-selected-tenant", agentId: "time-actor", action: "MOBILE_LOGIN" }))
    expect(response.headers.get("cache-control")).toContain("no-store")
  })
  it.each([["DENIED", 401], ["UNAVAILABLE", 503]] as const)("does not try old credentials after canonical %s", async (status, code) => {
    mocks.canonical.mockResolvedValue({ status })
    expect((await request()).status).toBe(code)
    expect(mocks.legacy).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it("fails closed when the distributed limiter is unavailable", async () => {
    mocks.limit.mockResolvedValue({ allowed: false, unavailable: true, retryAfterSeconds: 1 })
    expect((await request()).status).toBe(503)
    expect(mocks.canonical).not.toHaveBeenCalled()
    expect(mocks.org).not.toHaveBeenCalled()
  })
  it.each([{ ...data, application: "CRM" }, { ...data, organizationSlug: "" }])("refuses an invalid application or missing tenant", async value => {
    expect((await request(value)).status).toBe(400)
    expect(mocks.canonical).not.toHaveBeenCalled()
  })
})
