import { beforeEach, describe, expect, it, vi } from "vitest"

// Instagram replies from the inbox composer: the token stored on the channel decides which Graph
// host accepts it. A Facebook-Login page token works only on graph.facebook.com; an Instagram-Login
// token (settings.igLogin=true) only on graph.instagram.com. Sending either through the other host
// fails, so the reply helper must pick by the channel that received the thread.

const mocks = vi.hoisted(() => ({
  findConfig: vi.fn(),
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
  sendInstagramMessage: vi.fn(),
  sendInstagramLoginMessage: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: { findFirst: mocks.findConfig },
    channelMessage: { create: mocks.createMessage },
    socialConversation: { updateMany: mocks.updateConversation },
    contact: { updateMany: vi.fn() },
  },
}))
vi.mock("@/lib/facebook", () => ({
  sendFacebookMessage: vi.fn(),
  sendInstagramMessage: mocks.sendInstagramMessage,
}))
vi.mock("@/lib/social/instagram-login", () => ({ sendInstagramLoginMessage: mocks.sendInstagramLoginMessage }))
vi.mock("@/lib/chatwoot", () => ({ sendChatwootMessage: vi.fn() }))
vi.mock("@/lib/channels/platform-connections", () => ({ resolveChannelConnection: vi.fn() }))
vi.mock("@/lib/channels/reply-routing", () => ({ resolveReplyRoute: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(), sendWhatsAppMedia: vi.fn() }))
vi.mock("@/lib/telegram", () => ({ resolveTelegramSendTarget: vi.fn(), sendTelegramText: vi.fn() }))
vi.mock("@/lib/telegram-media", () => ({ sendTelegramMedia: vi.fn() }))
vi.mock("@/lib/vkontakte", () => ({ sendVkMessage: vi.fn() }))
vi.mock("@/lib/inbox-ensure-conversation", () => ({ ensureConversation: vi.fn() }))
vi.mock("@/lib/inbox-attachment", () => ({ isImageMime: vi.fn(() => false) }))

import { sendConversationReply } from "@/lib/inbox/send-conversation-reply"

const reply = {
  organizationId: "org-fanumsec",
  channel: "instagram" as const,
  to: "1318586653085202",
  body: "sizin əlaqə nömrənizi götürə bilərəm?",
  conversationId: "conv-1",
  channelConfigId: "cfg-ig",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createMessage.mockImplementation(async ({ data }: { data: { status: string } }) => ({ id: "msg-1", status: data.status }))
  mocks.updateConversation.mockResolvedValue({ count: 1 })
  mocks.sendInstagramMessage.mockResolvedValue(true)
  mocks.sendInstagramLoginMessage.mockResolvedValue(true)
})

describe("sendConversationReply — Instagram", () => {
  it("sends through the Facebook-Login page token of the channel that received the thread", async () => {
    mocks.findConfig.mockResolvedValue({ apiKey: "page-token", settings: {} })

    const result = await sendConversationReply(reply)

    expect(result.success).toBe(true)
    expect(mocks.findConfig).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cfg-ig", organizationId: "org-fanumsec", channelType: "instagram", isActive: true },
    }))
    expect(mocks.sendInstagramMessage).toHaveBeenCalledWith("1318586653085202", reply.body, "page-token", "org-fanumsec")
    expect(mocks.sendInstagramLoginMessage).not.toHaveBeenCalled()
  })

  it("sends an Instagram-Login channel's reply through graph.instagram.com", async () => {
    mocks.findConfig.mockResolvedValue({ apiKey: "ig-login-token", settings: { igLogin: true } })

    const result = await sendConversationReply(reply)

    expect(result.success).toBe(true)
    expect(mocks.sendInstagramLoginMessage).toHaveBeenCalledWith("1318586653085202", reply.body, "ig-login-token")
    expect(mocks.sendInstagramMessage).not.toHaveBeenCalled()
  })

  it("records a failed outbound row and reports failure when Meta refuses", async () => {
    mocks.findConfig.mockResolvedValue({ apiKey: "page-token", settings: {} })
    mocks.sendInstagramMessage.mockResolvedValue(false)

    const result = await sendConversationReply(reply)

    expect(result.success).toBe(false)
    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", channelType: "instagram", to: "1318586653085202" }),
    }))
    expect(mocks.updateConversation).not.toHaveBeenCalled()
  })
})
