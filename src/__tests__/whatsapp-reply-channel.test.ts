import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ latest: vi.fn(), channels: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {
  channelMessage: { findFirst: db.latest }, channelConfig: { findMany: db.channels },
} }))
import { checkWhatsAppReplyChannel, whatsappThreadReplyBinding } from "@/lib/inbox/whatsapp-reply-channel"

beforeEach(() => {
  vi.resetAllMocks()
  db.latest.mockResolvedValue(null)
  db.channels.mockResolvedValue([{ id: "A" }])
})

describe("WhatsApp reply channel binding", () => {
  it("blocks the contact thread when unbound B is newer than canonical A", () => {
    expect(whatsappThreadReplyBinding([
      { channelType: "whatsapp", channelConfigId: "B", conversationId: null },
      { channelType: "whatsapp", channelConfigId: "A", conversationId: "conv-A" },
    ])).toEqual({ whatsappReplyBlocked: true })
  })

  it("keeps a single-number conversation available, including older unbound messages", () => {
    expect(whatsappThreadReplyBinding([
      { channelType: "whatsapp", channelConfigId: "A", conversationId: null },
      { channelType: "whatsapp", channelConfigId: "A", conversationId: "conv-A" },
    ])).toEqual({ whatsappReplyBlocked: false })
  })

  it("rechecks stale A against the latest B using the full phone and tenant", async () => {
    db.latest.mockResolvedValue({ channelConfigId: "B" })
    expect(await checkWhatsAppReplyChannel({ organizationId: "org-1", to: "+994 50 123 45 67", channelConfigId: "A" }))
      .toEqual({ allowed: false, channelConfigId: "A" })
    expect(db.latest).toHaveBeenCalledWith({
      where: { organizationId: "org-1", channelType: "whatsapp", OR: [
        { from: { in: ["994501234567", "+994501234567"] } },
        { to: { in: ["994501234567", "+994501234567"] } },
        { metadata: { path: ["waPhone"], equals: "994501234567" } },
        { metadata: { path: ["waPhone"], equals: "+994501234567" } },
      ] }, orderBy: { createdAt: "desc" }, select: { channelConfigId: true },
    })
    expect(db.channels).not.toHaveBeenCalled()
  })

  it("does not guess the sender when an unbound reply has two active channels", async () => {
    db.channels.mockResolvedValue([{ id: "A" }, { id: "B" }])
    expect(await checkWhatsAppReplyChannel({ organizationId: "org-1", to: "994501234567" })).toEqual({ allowed: false })
    expect(db.channels).toHaveBeenCalledWith({ where: { organizationId: "org-1", channelType: "whatsapp", isActive: true }, select: { id: true }, take: 2 })
    expect(db.latest).not.toHaveBeenCalled()
  })

  it("preserves an unbound single-number reply and passes its explicit binding", async () => {
    db.latest.mockResolvedValue({ channelConfigId: "A" })
    expect(await checkWhatsAppReplyChannel({ organizationId: "org-1", to: "994501234567" }))
      .toEqual({ allowed: true, channelConfigId: "A" })
  })
})
