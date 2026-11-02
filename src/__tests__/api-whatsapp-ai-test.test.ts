import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
const state = vi.hoisted(() => ({ role: "admin", session: true }))
const start = vi.hoisted(() => vi.fn())
const stop = vi.hoisted(() => vi.fn())
const find = vi.hoisted(() => vi.fn())
const audit = vi.hoisted(() => vi.fn())
vi.mock("@/lib/prisma", () => ({ prisma: { channelConfig: { findFirst: find } }, logAudit: audit }))
vi.mock("@/lib/inbox/whatsapp-ai-test", () => ({ startWhatsAppAiTest: start, stopWhatsAppAiTest: stop, aiTestView: () => ({ recipientLast4: "1001", maxAttempts: 3 }) }))
vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(), getOrgId: vi.fn(), requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(async () => state.session ? { orgId: "org", userId: "user", role: state.role, email: "admin@example.test", name: "Admin" } : NextResponse.json({ error: "Unauthorized" }, { status: 401 })),
  isAuthError: (v: unknown) => v instanceof Response,
}))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_o: string, fn: () => unknown) => fn(), runWithRlsBypass: (fn: () => unknown) => fn(), enterTenantContext: vi.fn() }))
import { DELETE, GET, POST } from "@/app/api/v1/whatsapp/ai-test/route"
const payload = { channelConfigId: "channel", conversationId: "owner", phone: "+15550001001" }
function req(method: string, body?: unknown) { return new NextRequest("http://localhost/api/v1/whatsapp/ai-test?channelConfigId=channel", { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }) }
beforeEach(() => { vi.clearAllMocks(); state.role = "admin"; state.session = true; start.mockResolvedValue({ runId: "run", recipientLast4: "1001", maxAttempts: 3 }); stop.mockResolvedValue(undefined); find.mockResolvedValue({ settings: { replyMode: "agent", accessToken: "private" } }) })
describe("WhatsApp AI test admin session API", () => {
  it.each(["viewer", "sales", "ticketing"])("denies %s without reads or writes", async (role) => {
    state.role = role
    expect((await GET(req("GET"))).status).toBe(403)
    expect((await POST(req("POST", payload))).status).toBe(403)
    expect((await DELETE(req("DELETE", { channelConfigId: "channel" }))).status).toBe(403)
    expect(start).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(find).not.toHaveBeenCalled()
  })
  it("does not accept an API key without a browser session", async () => {
    state.session = false
    expect((await POST(req("POST", payload))).status).toBe(401)
    expect(start).not.toHaveBeenCalled()
  })
  it("uses the authenticated org, not a supplied tenant; rejects unknown overrides", async () => {
    expect((await POST(req("POST", { ...payload, organizationId: "foreign" }))).status).toBe(400)
    expect((await POST(req("POST", { ...payload, maxAttempts: 999 }))).status).toBe(400)
    expect((await POST(req("POST", payload))).status).toBe(200)
    expect(start).toHaveBeenCalledWith({ ...payload, organizationId: "org" })
    expect(audit).toHaveBeenCalledWith("org", "whatsapp_ai_test_started", "channelConfig", "channel", "WhatsApp AI test", expect.objectContaining({ userId: "user" }))
  })
  it("limits request size and rejects malformed input before activation", async () => {
    expect((await POST(req("POST", { ...payload, phone: "x".repeat(3000) }))).status).toBe(413)
    expect((await POST(new NextRequest("http://localhost/api/v1/whatsapp/ai-test", { method: "POST", body: "{" }))).status).toBe(400)
    expect(start).not.toHaveBeenCalled()
  })
  it("GET is scoped to an active WhatsApp channel and returns no settings or full phone", async () => {
    const response = await GET(req("GET"))
    expect(find).toHaveBeenCalledWith({ where: { id: "channel", organizationId: "org", channelType: "whatsapp", isActive: true }, select: { settings: true } })
    const body = JSON.stringify(await response.json())
    expect(body).not.toContain("private"); expect(body).not.toContain("15550001001")
    find.mockResolvedValue(null)
    expect((await GET(req("GET"))).status).toBe(404)
  })
  it("stops only the scoped channel; never sends or enables global AI", async () => {
    expect((await DELETE(req("DELETE", { channelConfigId: "channel" }))).status).toBe(200)
    expect(stop).toHaveBeenCalledWith({ channelConfigId: "channel", organizationId: "org" })
  })
  it("reports an uncertain/conflicting write without leaking DB details", async () => {
    start.mockRejectedValue(new Error("database secret"))
    const res = await POST(req("POST", payload))
    expect(res.status).toBe(409)
    expect(JSON.stringify(await res.json())).not.toContain("database secret")
  })
})
