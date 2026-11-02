import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), remove: vi.fn(), deliveries: vi.fn(), count: vi.fn(), skip: vi.fn(), progress: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: {
  campaign: { findFirst: mocks.find, updateMany: mocks.update, deleteMany: mocks.remove },
  whatsAppCampaignDelivery: { findMany: mocks.deliveries, count: mocks.count, updateMany: mocks.skip },
} }))
vi.mock("@/lib/campaigns/whatsapp-dispatch", () => ({ getWhatsAppCampaignProgress: mocks.progress }))
vi.mock("@/lib/with-rls", () => ({ withRlsAuth: (_module: string, _permission: string, handler: (req: NextRequest, auth: { orgId: string }, params: unknown) => unknown) =>
  (req: NextRequest, params: unknown) => handler(req, { orgId: "org1" }, params),
}))
import { GET, PUT, DELETE } from "@/app/api/v1/campaigns/[id]/route"
import { GET as DELIVERIES } from "@/app/api/v1/campaigns/[id]/deliveries/route"
const params = { params: Promise.resolve({ id: "campaign1" }) }
const req = (method = "GET", body?: unknown, query = "") => new NextRequest(`https://example.com/api/v1/campaigns/campaign1${query}`, {
  method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.find.mockResolvedValue({ id: "campaign1", organizationId: "org1", type: "whatsapp", status: "sending" })
  mocks.update.mockResolvedValue({ count: 1 }); mocks.remove.mockResolvedValue({ count: 1 }); mocks.skip.mockResolvedValue({ count: 3 })
  mocks.deliveries.mockResolvedValue([]); mocks.count.mockResolvedValue(0); mocks.progress.mockResolvedValue({ pending: 3, accepted: 1 })
})

describe("WhatsApp campaign history and cancellation", () => {
  it("includes recipient progress in the tenant-bound campaign", async () => {
    const response = await GET(req(), params)
    expect((await response.json()).data.whatsappDelivery).toEqual({ pending: 3, accepted: 1 })
    expect(mocks.progress).toHaveBeenCalledWith("org1", "campaign1")
  })
  it("does not read another tenant's campaign or delivery history", async () => {
    mocks.find.mockResolvedValue(null)
    expect((await GET(req(), params)).status).toBe(404)
    expect((await DELIVERIES(req(), params)).status).toBe(404)
    expect(mocks.find).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "campaign1", organizationId: "org1", type: "whatsapp" } }))
    expect(mocks.progress).not.toHaveBeenCalled(); expect(mocks.deliveries).not.toHaveBeenCalled()
  })
  it.each(["sending", "sent", "failed", "cancelled"])("prevents %s campaigns from being reset and resent", async status => {
    mocks.find.mockResolvedValue({ type: "whatsapp", status })
    expect((await PUT(req("PUT", { status: "draft", subject: "edited" }), params)).status).toBe(409)
    expect(mocks.update).not.toHaveBeenCalled()
    expect((await DELETE(req("DELETE"), params)).status).toBe(409)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it("cancels pending recipients only, preserving in-flight messages and history", async () => {
    expect((await PUT(req("PUT", { status: "cancelled" }), params)).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "campaign1", organizationId: "org1", type: "whatsapp", status: "sending" } }))
    expect(mocks.skip).toHaveBeenCalledWith({ where: { organizationId: "org1", campaignId: "campaign1", status: "pending" }, data: { status: "skipped", errorCode: "campaign_cancelled" } })
  })
  it("does not mix an edit into cancellation or skip rows when the state changed", async () => {
    expect((await PUT(req("PUT", { status: "cancelled", subject: "changed" }), params)).status).toBe(409)
    mocks.update.mockResolvedValue({ count: 0 })
    expect((await PUT(req("PUT", { status: "cancelled" }), params)).status).toBe(409)
    expect(mocks.skip).not.toHaveBeenCalled()
  })
  it("protects a draft deletion against a concurrent send", async () => {
    mocks.find.mockResolvedValue({ type: "whatsapp", status: "draft" }); mocks.remove.mockResolvedValue({ count: 0 })
    expect((await DELETE(req("DELETE"), params)).status).toBe(404)
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "campaign1", organizationId: "org1", status: { in: ["draft", "scheduled"] } } })
  })
  it("requires the send action to dispatch a draft", async () => {
    mocks.find.mockResolvedValue({ type: "whatsapp", status: "draft" })
    expect((await PUT(req("PUT", { status: "sending" }), params)).status).toBe(422)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("pages/filter receipts without returning message payloads or provider credentials", async () => {
    expect((await DELIVERIES(req("GET", undefined, "?page=2&status=failed"), params)).status).toBe(200)
    expect(mocks.deliveries).toHaveBeenCalledWith({ where: { organizationId: "org1", campaignId: "campaign1", status: "failed" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: 50, take: 50,
      select: { id: true, recipientPhone: true, status: true, errorCode: true },
    })
  })
  it.each(["?page=1.5", "?status=secret"])("rejects invalid query %s", async query => {
    expect((await DELIVERIES(req("GET", undefined, query), params)).status).toBe(400)
    expect(mocks.deliveries).not.toHaveBeenCalled()
  })
})
