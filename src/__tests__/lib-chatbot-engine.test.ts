import { describe, it, expect } from "vitest"
import {
  matchChatbotRule, isChatbotTriggerType, isChatbotStatus, isChatbotChannel,
  isChatbotChannelEnabled, normalizeChatbotText, triggerNeedsValue, type ChatbotRuleLike,
} from "@/lib/chatbot-engine"

// Phase 7 slice-1 — inbound auto-reply rule matching (pure).
const rule = (over: Partial<ChatbotRuleLike>): ChatbotRuleLike => ({
  id: "r", status: "active", channelTypes: [], triggerType: "contains",
  triggerValue: "hello", responseText: "hi", priority: 0, createdAt: "2025-01-01", ...over,
})

describe("matchChatbotRule — triggers", () => {
  it("contains matches when text includes the term (case-insensitive)", () => {
    expect(matchChatbotRule([rule({ triggerValue: "refund" })], { channelType: "sms", text: "I want a REFUND please" })?.id).toBe("r")
  })
  it("contains supports comma-separated ANY-term", () => {
    const r = rule({ triggerValue: "price, cost, quote" })
    expect(matchChatbotRule([r], { channelType: "sms", text: "what is the cost?" })).toBeTruthy()
    expect(matchChatbotRule([r], { channelType: "sms", text: "hello there" })).toBeNull()
  })
  it("contains understands Azerbaijani diacritics and common chat transliteration", () => {
    const size = rule({ triggerValue: "ölçü" })
    expect(matchChatbotRule([size], { channelType: "whatsapp", text: "Olcu var?" })).toBeTruthy()
    expect(matchChatbotRule([size], { channelType: "whatsapp", text: "olchu necedir?" })).toBeTruthy()
  })
  it("contains tolerates a small typo in a meaningful word but fails closed for unrelated text", () => {
    const price = rule({ triggerValue: "qiymət" })
    expect(matchChatbotRule([price], { channelType: "whatsapp", text: "qiymet necedir?" })).toBeTruthy()
    expect(matchChatbotRule([price], { channelType: "whatsapp", text: "qiymt necedir?" })).toBeTruthy()
    expect(matchChatbotRule([price], { channelType: "whatsapp", text: "catdirilma necedir?" })).toBeNull()
  })
  it("exact requires the whole trimmed text to equal", () => {
    const r = rule({ triggerType: "exact", triggerValue: "hi" })
    expect(matchChatbotRule([r], { channelType: "sms", text: "  Hi  " })).toBeTruthy()
    expect(matchChatbotRule([r], { channelType: "sms", text: "hi there" })).toBeNull()
  })
  it("starts_with matches only at the beginning", () => {
    const r = rule({ triggerType: "starts_with", triggerValue: "stop" })
    expect(matchChatbotRule([r], { channelType: "sms", text: "STOP texting me" })).toBeTruthy()
    expect(matchChatbotRule([r], { channelType: "sms", text: "please stop" })).toBeNull()
  })
  it("always matches any non-empty text", () => {
    expect(matchChatbotRule([rule({ triggerType: "always", triggerValue: null })], { channelType: "sms", text: "anything" })).toBeTruthy()
  })
  it("unknown triggerType never fires (fail-closed)", () => {
    expect(matchChatbotRule([rule({ triggerType: "regex", triggerValue: ".*" })], { channelType: "sms", text: "x" })).toBeNull()
  })
})

describe("matchChatbotRule — gating + ordering", () => {
  it("only ACTIVE rules fire (draft/paused ignored)", () => {
    expect(matchChatbotRule([rule({ status: "draft", triggerType: "always" })], { channelType: "sms", text: "x" })).toBeNull()
    expect(matchChatbotRule([rule({ status: "paused", triggerType: "always" })], { channelType: "sms", text: "x" })).toBeNull()
  })
  it("channel filter: empty channelTypes = all; else the channel must be listed", () => {
    expect(matchChatbotRule([rule({ channelTypes: ["whatsapp"], triggerType: "always" })], { channelType: "sms", text: "x" })).toBeNull()
    expect(matchChatbotRule([rule({ channelTypes: ["sms"], triggerType: "always" })], { channelType: "sms", text: "x" })).toBeTruthy()
    expect(matchChatbotRule([rule({ channelTypes: [], triggerType: "always" })], { channelType: "sms", text: "x" })).toBeTruthy()
  })
  it("priority DESC wins; createdAt ASC breaks ties", () => {
    const low = rule({ id: "low", triggerType: "always", priority: 1, createdAt: "2025-01-01" })
    const high = rule({ id: "high", triggerType: "always", priority: 5, createdAt: "2025-02-01" })
    expect(matchChatbotRule([low, high], { channelType: "sms", text: "x" })?.id).toBe("high")
    const a = rule({ id: "a", triggerType: "always", priority: 1, createdAt: "2025-01-01" })
    const b = rule({ id: "b", triggerType: "always", priority: 1, createdAt: "2025-02-01" })
    expect(matchChatbotRule([b, a], { channelType: "sms", text: "x" })?.id).toBe("a")
  })

  it("equal priority AND createdAt → deterministic by id ASC, NOT input order", () => {
    const a = rule({ id: "aaa", triggerType: "always", priority: 1, createdAt: "2025-01-01" })
    const b = rule({ id: "bbb", triggerType: "always", priority: 1, createdAt: "2025-01-01" })
    expect(matchChatbotRule([a, b], { channelType: "sms", text: "x" })?.id).toBe("aaa")
    expect(matchChatbotRule([b, a], { channelType: "sms", text: "x" })?.id).toBe("aaa") // array order irrelevant
  })

  it("a corrupt createdAt sorts last (no NaN poisoning), deterministically", () => {
    const good = rule({ id: "good", triggerType: "always", priority: 1, createdAt: "2025-01-01" })
    const bad = rule({ id: "bad", triggerType: "always", priority: 1, createdAt: "not-a-date" })
    expect(matchChatbotRule([bad, good], { channelType: "sms", text: "x" })?.id).toBe("good")
    expect(matchChatbotRule([good, bad], { channelType: "sms", text: "x" })?.id).toBe("good")
  })
  it("empty/whitespace inbound text never matches (media-only message)", () => {
    expect(matchChatbotRule([rule({ triggerType: "always" })], { channelType: "sms", text: "   " })).toBeNull()
  })
  it("does not mutate the caller's array (sort is on a copy)", () => {
    const arr = [rule({ id: "a", priority: 1 }), rule({ id: "b", priority: 9 })]
    const snapshot = arr.map((r) => r.id)
    matchChatbotRule(arr, { channelType: "sms", text: "hello" })
    expect(arr.map((r) => r.id)).toEqual(snapshot)
  })
})

describe("validators", () => {
  it("isChatbotTriggerType", () => {
    expect(isChatbotTriggerType("contains")).toBe(true)
    expect(isChatbotTriggerType("regex")).toBe(false)
  })
  it("isChatbotStatus", () => {
    expect(isChatbotStatus("active")).toBe(true)
    expect(isChatbotStatus("live")).toBe(false)
  })
  it("isChatbotChannel", () => {
    expect(isChatbotChannel("whatsapp")).toBe(true)
    expect(isChatbotChannel("carrier-pigeon")).toBe(false)
  })
  it("triggerNeedsValue is false only for always", () => {
    expect(triggerNeedsValue("always")).toBe(false)
    expect(triggerNeedsValue("contains")).toBe(true)
    expect(triggerNeedsValue("exact")).toBe(true)
  })
  it("normalizes Azerbaijani and transliterated spellings to the same searchable form", () => {
    expect(normalizeChatbotText("ÖLÇÜ")).toBe("olcu")
    expect(normalizeChatbotText("olchu")).toBe("olcu")
  })
  it("honors the master flag and a channel-specific off switch", () => {
    expect(isChatbotChannelEnabled(["chatbotAutoReply"], "whatsapp")).toBe(true)
    expect(isChatbotChannelEnabled([
      "chatbotAutoReply",
      "chatbotAutoReplyDisabled:whatsapp",
    ], "whatsapp")).toBe(false)
    expect(isChatbotChannelEnabled([], "whatsapp")).toBe(false)
  })
})
