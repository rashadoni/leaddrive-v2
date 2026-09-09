import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    chatbotRule: { findMany: vi.fn(), update: vi.fn() },
    channelMessage: { findMany: vi.fn(), create: vi.fn() },
    channelConfig: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock("@/lib/facebook", () => ({ sendFacebookMessage: vi.fn(), sendInstagramMessage: vi.fn() }))
vi.mock("@/lib/vkontakte", () => ({ sendVkMessage: vi.fn() }))
vi.mock("@/lib/chatwoot", () => ({ sendChatwootMessage: vi.fn() }))
vi.mock("@/lib/inbox/send-conversation-reply", () => ({ sendConversationReply: vi.fn() }))

import { isAutoReply, shouldAutoReply, maybeAutoReply, sendChannelReply, chatbotTookOwnership } from "@/lib/chatbot-autoreply"
import { prisma } from "@/lib/prisma"
import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { sendFacebookMessage, sendInstagramMessage } from "@/lib/facebook"
import { sendVkMessage } from "@/lib/vkontakte"
import { sendChatwootMessage } from "@/lib/chatwoot"
import { sendConversationReply } from "@/lib/inbox/send-conversation-reply"

const fn = (x: unknown) => x as ReturnType<typeof vi.fn>
const NOW = 1_000_000_000

describe("isAutoReply", () => {
  it("true only when metadata.autoReply === true", () => {
    expect(isAutoReply({ autoReply: true })).toBe(true)
    expect(isAutoReply({ autoReply: false })).toBe(false)
    expect(isAutoReply({})).toBe(false)
    expect(isAutoReply(null)).toBe(false)
    expect(isAutoReply("x")).toBe(false)
  })
})

describe("shouldAutoReply (rate-limit / loop-guard)", () => {
  it("allows when no recent auto-reply (empty, or only non-auto-reply outbounds)", () => {
    expect(shouldAutoReply([], NOW, 1000)).toBe(true)
    expect(shouldAutoReply([{ metadata: {}, createdAt: new Date(NOW) }], NOW, 1000)).toBe(true)
  })
  it("blocks when an auto-reply landed within the cooldown", () => {
    expect(shouldAutoReply([{ metadata: { autoReply: true }, createdAt: new Date(NOW - 500) }], NOW, 1000)).toBe(false)
  })
  it("allows when the last auto-reply is older than the cooldown", () => {
    expect(shouldAutoReply([{ metadata: { autoReply: true }, createdAt: new Date(NOW - 2000) }], NOW, 1000)).toBe(true)
  })
})

describe("maybeAutoReply", () => {
  const rule = (over = {}) => ({
    id: "r1", status: "active", channelTypes: [], triggerType: "always",
    triggerValue: null, responseText: "Hi!", priority: 0, createdAt: "2025-01-01", ...over,
  })
  // Organization.features is a string[] of enabled flags — enable = array contains the flag.
  const enable = (on: boolean) =>
    fn(prisma.organization.findUnique).mockResolvedValue({ features: on ? ["chatbotAutoReply"] : [] })
  const call = (over = {}) =>
    maybeAutoReply({ orgId: "o1", channelType: "whatsapp", conversationId: "c1", inboundText: "hello", to: "+994", nowMs: NOW, ...over })

  beforeEach(() => {
    vi.clearAllMocks()
    fn(prisma.channelMessage.findMany).mockResolvedValue([])
    fn(prisma.channelMessage.create).mockResolvedValue({})
    fn(prisma.chatbotRule.update).mockResolvedValue({})
    fn(sendConversationReply).mockResolvedValue({
      success: true,
      statusCode: 201,
      data: { id: "out-1", status: "delivered" },
    })
  })

  it("OFF by default → disabled; never queries rules or sends", async () => {
    enable(false)
    expect(await call()).toMatchObject({ matched: false, sent: false, skipped: "disabled" })
    expect(prisma.chatbotRule.findMany).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it("enable reads the features ARRAY, not an object property (regression guard)", async () => {
    fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])
    // object-shaped features (the old buggy assumption) must NOT enable
    fn(prisma.organization.findUnique).mockResolvedValue({ features: { chatbotAutoReply: true } })
    expect((await call()).skipped).toBe("disabled")
    // array WITHOUT the flag → disabled
    fn(prisma.organization.findUnique).mockResolvedValue({ features: ["whatsapp", "ai"] })
    expect((await call()).skipped).toBe("disabled")
    // array WITH the flag → proceeds past the enable gate (matches the rule)
    fn(prisma.organization.findUnique).mockResolvedValue({ features: ["whatsapp", "chatbotAutoReply"] })
    fn(sendWhatsAppMessage).mockResolvedValue({ success: true })
    expect((await call()).skipped).not.toBe("disabled")
  })

  it("enabled but no active rules → no-rule, no send", async () => {
    enable(true); fn(prisma.chatbotRule.findMany).mockResolvedValue([])
    expect((await call()).skipped).toBe("no-rule")
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it("channel-specific off switch disables only that channel", async () => {
    fn(prisma.organization.findUnique).mockResolvedValue({
      features: ["chatbotAutoReply", "chatbotAutoReplyDisabled:whatsapp"],
    })
    fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])
    expect(await call()).toMatchObject({ matched: false, sent: false, skipped: "disabled" })
    expect(prisma.chatbotRule.findMany).not.toHaveBeenCalled()
  })

  it("no rule matches the text → no-rule, no send", async () => {
    enable(true); fn(prisma.chatbotRule.findMany).mockResolvedValue([rule({ triggerType: "contains", triggerValue: "refund" })])
    expect(await call()).toMatchObject({ matched: false, skipped: "no-rule" })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it("rate-limited (recent auto-reply in window) → matched, NOT sent, no send call", async () => {
    enable(true); fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])
    fn(prisma.channelMessage.findMany).mockResolvedValue([{ metadata: { autoReply: true }, createdAt: new Date(NOW - 1000) }])
    expect(await call()).toMatchObject({ matched: true, sent: false, skipped: "rate-limited", ruleId: "r1" })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it("happy path → sends, records outbound w/ autoReply meta, bumps matchCount", async () => {
    enable(true); fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])
    fn(sendWhatsAppMessage).mockResolvedValue({ success: true })
    expect(await call({ contactId: "ct1" })).toMatchObject({ matched: true, sent: true, ruleId: "r1" })
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+994", message: "Hi!", organizationId: "o1", forceText: true, skipLog: true }),
    )
    expect(prisma.channelMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ direction: "outbound", metadata: { autoReply: true, chatbotRuleId: "r1" } }) }),
    )
    expect(prisma.chatbotRule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1" }, data: { matchCount: { increment: 1 } } }),
    )
  })

  it("send failure → matched, NOT sent, skipped send-failed, nothing recorded", async () => {
    enable(true); fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])
    fn(sendWhatsAppMessage).mockResolvedValue({ success: false, error: "window closed" })
    expect(await call()).toMatchObject({ matched: true, sent: false, skipped: "send-failed" })
    expect(prisma.channelMessage.create).not.toHaveBeenCalled()
  })

  it("TikTok keyword reply uses an inbound-bound durable Chatwoot claim", async () => {
    enable(true); fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])

    const result = await call({
      channelType: "tiktok",
      to: "cw-42",
      channelConfigId: "cfg-cw",
      inboundMessageId: "inbound-42",
    })

    expect(result).toMatchObject({ matched: true, sent: true, ruleId: "r1" })
    expect(sendConversationReply).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "o1",
      channel: "tiktok",
      to: "cw-42",
      body: "Hi!",
      conversationId: "c1",
      channelConfigId: "cfg-cw",
      extraMetadata: expect.objectContaining({
        autoReply: true,
        keywordAutoReply: true,
        chatbotRuleId: "r1",
        chatbotInboundMessageId: "inbound-42",
      }),
      deliveryIdempotency: {
        source: "chatbot",
        key: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      chatwootAutoReplyClaim: {
        inboundMessageId: "inbound-42",
        cooldownMs: 300_000,
        nowMs: NOW,
      },
    }))
    expect(sendChatwootMessage).not.toHaveBeenCalled()
    expect(prisma.channelMessage.create).not.toHaveBeenCalled()
  })

  it("ambiguous TikTok delivery takes ownership so AI cannot retry or fall back", async () => {
    enable(true); fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])
    fn(prisma.channelMessage.findMany).mockResolvedValue([
      { metadata: { autoReply: true, deliveryUnknown: true }, createdAt: new Date(NOW - 1000) },
    ])
    fn(sendConversationReply).mockResolvedValue({
      success: false,
      statusCode: 409,
      error: "verify in Chatwoot",
      deliveryUnknown: true,
      attemptId: "out-pending",
    })

    const result = await call({ channelType: "tiktok", to: "cw-42", inboundMessageId: "inbound-42" })

    expect(result).toMatchObject({ matched: true, sent: false, skipped: "send-unknown" })
    expect(chatbotTookOwnership(result)).toBe(true)
    expect(prisma.channelMessage.findMany).not.toHaveBeenCalled()
    expect(sendChatwootMessage).not.toHaveBeenCalled()
    expect(prisma.channelMessage.create).not.toHaveBeenCalled()
  })

  it("TikTok refuses to call Chatwoot when the inbound message claim is unavailable", async () => {
    enable(true); fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])

    const result = await call({ channelType: "tiktok", to: "cw-42", inboundMessageId: null })

    expect(result).toMatchObject({ matched: true, sent: false, skipped: "send-failed" })
    expect(sendConversationReply).not.toHaveBeenCalled()
    expect(sendChatwootMessage).not.toHaveBeenCalled()
  })

  it("no conversationId → declines to send (can't loop-guard), no send call", async () => {
    enable(true); fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])
    expect(await call({ conversationId: null })).toMatchObject({ matched: true, sent: false, skipped: "no-conversation" })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})

describe("chatbotTookOwnership", () => {
  it("takes ownership only after a reply was actually sent", () => {
    expect(chatbotTookOwnership({ matched: true, sent: true })).toBe(true)
    expect(chatbotTookOwnership({ matched: true, sent: false, skipped: "rate-limited" })).toBe(false)
    expect(chatbotTookOwnership({ matched: false, sent: false, skipped: "disabled" })).toBe(false)
    expect(chatbotTookOwnership({ matched: false, sent: false, skipped: "no-rule" })).toBe(false)
    expect(chatbotTookOwnership({ matched: true, sent: false, skipped: "no-conversation" })).toBe(false)
    expect(chatbotTookOwnership({ matched: true, sent: false, skipped: "send-failed" })).toBe(false)
    expect(chatbotTookOwnership({ matched: true, sent: false, skipped: "send-unknown" })).toBe(true)
  })
})

describe("sendChannelReply", () => {
  beforeEach(() => vi.clearAllMocks())

  it("unsupported channel → ok:false", async () => {
    expect((await sendChannelReply({ orgId: "o1", channelType: "sms", to: "x", text: "hi" })).ok).toBe(false)
  })

  it("tiktok: sends via Chatwoot transport using the conversation id as `to`", async () => {
    fn(sendChatwootMessage).mockResolvedValue({ success: true })
    const r = await sendChannelReply({ orgId: "o1", channelType: "tiktok", to: "cw_conv_77", text: "hi" })
    expect(r.ok).toBe(true)
    expect(sendChatwootMessage).toHaveBeenCalledWith({
      conversationId: "cw_conv_77",
      content: "hi",
      organizationId: "o1",
      channelConfigId: null,
    })
  })

  it("tiktok: forwards the caller's channelConfigId so a two-account org replies on the right one", async () => {
    // The org's other Chatwoot account is also active. Dropping this field here
    // sent the customer's answer out through whichever config the sender's
    // unordered `findFirst` happened to return — see lib-chatwoot-send CWL-9.
    fn(sendChatwootMessage).mockResolvedValue({ success: true })

    await sendChannelReply({
      orgId: "o1",
      channelType: "tiktok",
      to: "cw_conv_77",
      text: "hi",
      channelConfigId: "cfg_b",
    })

    expect(sendChatwootMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelConfigId: "cfg_b" }),
    )
  })

  it("tiktok: Chatwoot send failure → ok:false", async () => {
    fn(sendChatwootMessage).mockResolvedValue({ success: false })
    const r = await sendChannelReply({ orgId: "o1", channelType: "tiktok", to: "cw_conv_77", text: "hi" })
    expect(r.ok).toBe(false)
  })

  it("tiktok: preserves an ambiguous Chatwoot delivery outcome", async () => {
    fn(sendChatwootMessage).mockResolvedValue({ success: false, error: "timeout", deliveryUnknown: true })
    const result = await sendChannelReply({ orgId: "o1", channelType: "tiktok", to: "cw_conv_77", text: "hi" })
    expect(result).toEqual({ ok: false, error: "timeout", deliveryUnknown: true })
  })

  it("telegram with no active bot → ok:false", async () => {
    fn(prisma.channelConfig.findFirst).mockResolvedValue(null)
    const r = await sendChannelReply({ orgId: "o1", channelType: "telegram", to: "123", text: "hi" })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/telegram bot/)
  })

  it("telegram success posts to the Bot API with the chat_id", async () => {
    fn(prisma.channelConfig.findFirst).mockResolvedValue({ botToken: "TOK" })
    const origFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) }) as unknown as typeof fetch
    try {
      const r = await sendChannelReply({ orgId: "o1", channelType: "telegram", to: "123", text: "hi" })
      expect(r.ok).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("api.telegram.org/botTOK/sendMessage"),
        expect.objectContaining({ method: "POST" }),
      )
    } finally {
      global.fetch = origFetch
    }
  })

  it("facebook: sends via Graph using channel.apiKey (positional args)", async () => {
    fn(prisma.channelConfig.findFirst).mockResolvedValue({ apiKey: "PAGE_TOK" })
    fn(sendFacebookMessage).mockResolvedValue(true)
    const r = await sendChannelReply({ orgId: "o1", channelType: "facebook", to: "psid_9", text: "hi" })
    expect(r.ok).toBe(true)
    expect(sendFacebookMessage).toHaveBeenCalledWith("psid_9", "hi", "PAGE_TOK", "o1")
  })

  it("instagram: sends via sendInstagramMessage", async () => {
    fn(prisma.channelConfig.findFirst).mockResolvedValue({ apiKey: "PAGE_TOK" })
    fn(sendInstagramMessage).mockResolvedValue(true)
    const r = await sendChannelReply({ orgId: "o1", channelType: "instagram", to: "igsid_9", text: "hi" })
    expect(r.ok).toBe(true)
    expect(sendInstagramMessage).toHaveBeenCalledWith("igsid_9", "hi", "PAGE_TOK", "o1")
  })

  it("facebook with no apiKey config → ok:false, no send", async () => {
    fn(prisma.channelConfig.findFirst).mockResolvedValue(null)
    const r = await sendChannelReply({ orgId: "o1", channelType: "facebook", to: "psid_9", text: "hi" })
    expect(r.ok).toBe(false)
    expect(sendFacebookMessage).not.toHaveBeenCalled()
  })

  it("vkontakte: sends via sendVkMessage with channel.apiKey", async () => {
    fn(prisma.channelConfig.findFirst).mockResolvedValue({ apiKey: "VK_TOK" })
    fn(sendVkMessage).mockResolvedValue(true)
    const r = await sendChannelReply({ orgId: "o1", channelType: "vkontakte", to: "vk_42", text: "hi" })
    expect(r.ok).toBe(true)
    expect(sendVkMessage).toHaveBeenCalledWith("vk_42", "hi", "VK_TOK")
  })

  it("a provider returning false → ok:false", async () => {
    fn(prisma.channelConfig.findFirst).mockResolvedValue({ apiKey: "VK_TOK" })
    fn(sendVkMessage).mockResolvedValue(false)
    expect((await sendChannelReply({ orgId: "o1", channelType: "vkontakte", to: "vk_42", text: "hi" })).ok).toBe(false)
  })
})
