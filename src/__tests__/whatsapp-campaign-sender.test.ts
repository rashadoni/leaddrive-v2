import { beforeEach, describe, expect, it, vi } from "vitest"
const db = vi.hoisted(() => ({ channels: vi.fn(), resolve: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { channelConfig: { findMany: db.channels } } }))
vi.mock("@/lib/whatsapp", () => ({ resolveWhatsAppConfig: db.resolve }))
import { resolveWhatsAppCampaignConfig } from "@/lib/campaigns/whatsapp-config"
beforeEach(() => { vi.resetAllMocks(); db.resolve.mockImplementation(async (orgId, { channelConfigId }) => ({ organizationId: orgId, id: channelConfigId })) })
describe("campaign sending number", () => {
  it("does not guess between two active business numbers", async () => {
    db.channels.mockResolvedValue([{ id: "first" }, { id: "second" }])
    expect(await resolveWhatsAppCampaignConfig("org1", {})).toBeNull()
    expect(db.resolve).not.toHaveBeenCalled()
  })
  it("binds the explicitly selected sender to its tenant without a fallback", async () => {
    expect(await resolveWhatsAppCampaignConfig("org1", { whatsappChannelConfigId: "second" })).toEqual({ organizationId: "org1", id: "second" })
    db.resolve.mockResolvedValue(null)
    expect(await resolveWhatsAppCampaignConfig("org1", { whatsappChannelConfigId: "deleted-or-foreign" })).toBeNull()
    expect(db.channels).not.toHaveBeenCalled()
  })
  it("allows an older draft only when its tenant has exactly one active number", async () => {
    db.channels.mockResolvedValue([{ id: "only" }])
    expect(await resolveWhatsAppCampaignConfig("org1", null)).toEqual({ organizationId: "org1", id: "only" })
    expect(db.channels).toHaveBeenCalledWith({ where: { organizationId: "org1", channelType: "whatsapp", isActive: true }, select: { id: true }, take: 2 })
    db.channels.mockResolvedValue([])
    expect(await resolveWhatsAppCampaignConfig("org1", null)).toBeNull()
  })
})
