/**
 * The pieces of «one customer, one feed» that decide without a database: which conversations a thread is
 * made of, where a reply goes by default, which numbers a customer wrote, and what the switcher shows.
 */
import { describe, expect, it } from "vitest"
import {
  defaultReplyTarget,
  replyTargetsOf,
  summarizeThreadConversations,
  threadConversationIds,
} from "@/lib/inbox/thread-conversations"
import { identifiersInTexts, phoneKey } from "@/lib/inbox/contact-link"
import { inThreadFeed, threadFeedChannels } from "@/components/inbox/thread-channel-switcher"

const message = (conversationId: string | null, channelType: string, direction: "inbound" | "outbound", at: string, extra: Record<string, unknown> = {}) =>
  ({ conversationId, channelType, direction, createdAt: at, status: "delivered", channelConfigId: `cfg-${channelType}`, ...extra })

describe("a customer's thread and its conversations", () => {
  // Newest first, like the list: he wrote on Instagram today, we answered on WhatsApp after that.
  const messages = [
    message("conv-wa", "whatsapp", "outbound", "2026-11-15T12:00:00Z"),
    message("conv-ig", "instagram", "inbound", "2026-11-15T11:00:00Z"),
    message("conv-wa", "whatsapp", "inbound", "2026-11-13T11:05:00Z", { status: "read" }),
    message(null, "email", "inbound", "2026-11-01T09:00:00Z"),
  ]

  it("lists one entry per conversation and channel, most recently active first", () => {
    const summary = summarizeThreadConversations(messages)
    expect(summary.map((c) => [c.key, c.messageCount, c.unreadCount])).toEqual([
      ["conv-wa|whatsapp", 2, 0],
      ["conv-ig|instagram", 1, 1],
    ])
    expect(summary[0].lastInboundAt).toBe("2026-11-13T11:05:00.000Z")
  })

  it("keeps e-mail and Telegram apart when one contact shell holds both", () => {
    const summary = summarizeThreadConversations([
      message("shell", "email", "inbound", "2026-11-02T09:00:00Z"),
      message("shell", "telegram", "inbound", "2026-11-03T09:00:00Z"),
    ])
    expect(summary.map((c) => c.key)).toEqual(["shell|telegram", "shell|email"])
    expect(threadConversationIds({ socialConversationId: "shell", threadConversations: summary })).toEqual(["shell"])
  })

  it("answers where the customer wrote last, not where we wrote last", () => {
    const thread = { channels: ["whatsapp", "instagram", "email"], lastChannel: "whatsapp", socialConversationId: "conv-wa", threadConversations: summarizeThreadConversations(messages) }
    const targets = replyTargetsOf(thread)
    expect(targets.map((t) => [t.channel, t.conversationId])).toEqual([
      ["whatsapp", "conv-wa"],
      ["instagram", "conv-ig"],
      ["email", null], // an e-mail of his that no conversation holds — still a place to answer
    ])
    expect(defaultReplyTarget(targets, thread.lastChannel)?.conversationId).toBe("conv-ig")
  })

  it("keeps the one target a thread without conversations always had", () => {
    const targets = replyTargetsOf({ channels: ["web-chat"], lastChannel: "web-chat", socialConversationId: "scid-w" })
    expect(targets).toEqual([expect.objectContaining({ channel: "web-chat", conversationId: "scid-w" })])
  })
})

describe("numbers and e-mails a customer wrote", () => {
  it("reads every spelling of one Azerbaijani number as the same number", () => {
    for (const spelling of ["+994 50 111 22 33", "050 111 22 33", "994501112233", "(050) 111-22-33", "501112233"]) {
      expect(phoneKey(spelling)).toBe("994501112233")
    }
    expect(phoneKey("+49 151 1234 5678")).toBe("4915112345678")
    expect(phoneKey("42")).toBeNull()
    expect(phoneKey("0000000000")).toBeNull()
  })

  it("finds them in the chat, each once, and not a size or a price", () => {
    expect(identifiersInTexts([
      "Salam, 42 ölçü var? 89 ₼?",
      "Nömrəm 050 111 22 33, poçt Anar.MM@Example.com",
      "yenə: +994501112233",
    ])).toEqual({ phones: ["994501112233"], emails: ["anar.mm@example.com"] })
  })
})

describe("the channel switcher above the feed", () => {
  it("counts each channel's messages", () => {
    expect(threadFeedChannels([{ channelType: "instagram" }, { channelType: "whatsapp" }, { channelType: "instagram" }])).toEqual([
      { channel: "instagram", count: 2 },
      { channel: "whatsapp", count: 1 },
    ])
  })

  it("shows one channel's messages, or only the calls, or everything", () => {
    expect(inThreadFeed("instagram", { kind: "message", channel: "instagram" })).toBe(true)
    expect(inThreadFeed("instagram", { kind: "message", channel: "whatsapp" })).toBe(false)
    expect(inThreadFeed("instagram", { kind: "call" })).toBe(false)
    expect(inThreadFeed("calls", { kind: "call" })).toBe(true)
    expect(inThreadFeed("calls", { kind: "message", channel: "whatsapp" })).toBe(false)
    expect(inThreadFeed("all", { kind: "call" })).toBe(true)
  })
})
