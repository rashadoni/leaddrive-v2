import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
const state = vi.hoisted(() => ({ role: "admin", findOrg: vi.fn(), update: vi.fn(), audit: vi.fn() }))
vi.mock("@/lib/with-rls", () => ({ withRlsSessionAuth: (fn: (req: NextRequest, auth: { orgId: string; userId: string; role: string }) => Promise<Response>) => (req: NextRequest) => fn(req, { orgId: "org1", userId: "u1", role: state.role }) }))
vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUnique: state.findOrg }, $executeRaw: state.update }, logAudit: state.audit }))
import { GET, PATCH } from "@/app/api/v1/settings/customer-phone-privacy/route"
const req = (body?: unknown) => new NextRequest("https://app.test/api/v1/settings/customer-phone-privacy", { method: body ? "PATCH" : "GET", ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) })
beforeEach(() => { vi.clearAllMocks(); state.role = "admin"; state.findOrg.mockResolvedValue({ settings: {} }); state.update.mockResolvedValue(1) })
describe("customer phone privacy configuration", () => {
  it("is disabled until the administrator explicitly saves", async () => {
    expect(await (await GET(req())).json()).toEqual({ data: { enabled: false } })
    expect(state.update).not.toHaveBeenCalled()
  })
  it("atomically updates only its JSON key in the authenticated tenant", async () => {
    expect((await PATCH(req({ enabled: true, organizationId: "other" }))).status).toBe(200)
    const [strings, value, tenant] = state.update.mock.calls[0]
    expect(strings.join("?")).toContain("jsonb_set(COALESCE(settings")
    expect(strings.join("?")).toContain("{hideCustomerPhoneForOperators}")
    expect(value).toBe("true")
    expect(tenant).toBe("org1")
    expect(state.audit).toHaveBeenCalledWith("org1", "update", "organization", "org1", expect.any(String), expect.objectContaining({ userId: "u1" }))
  })
  it.each(["support", "sales", "manager", "viewer"])("refuses read and mutation for %s", async role => {
    state.role = role
    expect((await GET(req())).status).toBe(403)
    expect((await PATCH(req({ enabled: true }))).status).toBe(403)
    expect(state.update).not.toHaveBeenCalled()
  })
  it("does not accept a truthy string", async () => {
    expect((await PATCH(req({ enabled: "true" }))).status).toBe(400)
    expect(state.update).not.toHaveBeenCalled()
  })
})
