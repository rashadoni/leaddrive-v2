import { beforeEach, describe, expect, it, vi } from "vitest"
const db = vi.hoisted(() => ({ contact: { findFirst: vi.fn() }, channelPreference: { upsert: vi.fn() }, socialConversation: { findFirst: vi.fn(), updateMany: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
import { isWhatsAppOptOut, recordWhatsAppOptOut, recordWhatsAppConversationOptOut } from "@/lib/inbox/whatsapp-opt-out"

beforeEach(() => vi.resetAllMocks())
describe("WhatsApp unsubscribe", () => {
  it.each([" STOP ", "unsubscribe", "ОТПИСКА!", "stop."])("recognizes exact command %s", (text) => expect(isWhatsAppOptOut(text)).toBe(true))
  it.each(["don't stop", "how to unsubscribe?", "Salam", "start"])("does not change consent for %s", (text) => expect(isWhatsAppOptOut(text)).toBe(false))
  it("persists contact opt-out only within the verified tenant", async () => {
    db.contact.findFirst.mockResolvedValue({ id: "contact" })
    await recordWhatsAppOptOut("tenant", "contact")
    expect(db.contact.findFirst).toHaveBeenCalledWith({ where: { id: "contact", organizationId: "tenant" }, select: { id: true } })
    expect(db.channelPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { contactId_channel: { contactId: "contact", channel: "whatsapp" } },
      create: expect.objectContaining({ organizationId: "tenant", isOptedIn: false }),
      update: expect.objectContaining({ isOptedIn: false, optOutReason: "whatsapp_inbound_stop" }),
    }))
  })
  it("never writes a foreign contact preference", async () => {
    db.contact.findFirst.mockResolvedValue(null)
    await recordWhatsAppOptOut("tenant", "foreign-contact")
    expect(db.channelPreference.upsert).not.toHaveBeenCalled()
  })
  it("persists lead-only number suppression without clobbering other conversation metadata", async () => {
    db.socialConversation.findFirst.mockResolvedValue({ metadata: { handoff: { reason: "existing" } } })
    await recordWhatsAppConversationOptOut("tenant", "conversation")
    expect(db.socialConversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conversation", organizationId: "tenant" },
      data: { metadata: { handoff: { reason: "existing" }, whatsappOptedOut: true } },
    })
  })
})
