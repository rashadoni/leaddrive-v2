/**
 * Tests for `pickInviteChannel` — shared closed-loop channel-routing helper
 * (B9 slice 1). Used by both `triggerSurveysOnTicketResolved` (immediate
 * path) and the catch-up cron.
 */
import { describe, it, expect } from "vitest"
import { pickInviteChannel } from "@/lib/survey-triggers"

describe("B9 — pickInviteChannel", () => {
  it("whatsapp source + phone → whatsapp", () => {
    expect(pickInviteChannel({
      source: "whatsapp",
      sourceMeta: null,
      contact: { email: null, phone: "+1234567890" },
    })).toEqual({ channel: "whatsapp", webChatSessionId: null })
  })

  it("whatsapp source but skipWhatsApp=true → falls through to email", () => {
    expect(pickInviteChannel({
      source: "whatsapp",
      sourceMeta: null,
      contact: { email: "a@b.com", phone: "+123" },
      skipWhatsApp: true,
    })).toEqual({ channel: "email", webChatSessionId: null })
  })

  it("whatsapp source but no phone → falls through to email", () => {
    expect(pickInviteChannel({
      source: "whatsapp",
      sourceMeta: null,
      contact: { email: "a@b.com", phone: null },
    })).toEqual({ channel: "email", webChatSessionId: null })
  })

  it("web_chat source + sessionId in sourceMeta → web_chat", () => {
    expect(pickInviteChannel({
      source: "web_chat",
      sourceMeta: { sessionId: "sess_123" },
      contact: { email: "a@b.com", phone: null },
    })).toEqual({ channel: "web_chat", webChatSessionId: "sess_123" })
  })

  it("web_chat source but malformed sourceMeta → falls through to email", () => {
    expect(pickInviteChannel({
      source: "web_chat",
      sourceMeta: { foo: "bar" },
      contact: { email: "a@b.com", phone: null },
    })).toEqual({ channel: "email", webChatSessionId: null })
  })

  it("web_chat source with null sourceMeta → falls through", () => {
    expect(pickInviteChannel({
      source: "web_chat",
      sourceMeta: null,
      contact: { email: "a@b.com", phone: null },
    })).toEqual({ channel: "email", webChatSessionId: null })
  })

  it("web_chat source with empty-string sessionId → falls through", () => {
    expect(pickInviteChannel({
      source: "web_chat",
      sourceMeta: { sessionId: "" },
      contact: { email: "a@b.com", phone: null },
    })).toEqual({ channel: "email", webChatSessionId: null })
  })

  it("unknown source + email → email", () => {
    expect(pickInviteChannel({
      source: "linkedin",
      sourceMeta: null,
      contact: { email: "a@b.com", phone: null },
    })).toEqual({ channel: "email", webChatSessionId: null })
  })

  it("unknown source + only phone → sms", () => {
    expect(pickInviteChannel({
      source: "facebook",
      sourceMeta: null,
      contact: { email: null, phone: "+123" },
    })).toEqual({ channel: "sms", webChatSessionId: null })
  })

  it("no email and no phone → null (nothing we can do)", () => {
    expect(pickInviteChannel({
      source: "linkedin",
      sourceMeta: null,
      contact: { email: null, phone: null },
    })).toBeNull()
  })

  it("email source defaults to email even with phone available", () => {
    expect(pickInviteChannel({
      source: "email",
      sourceMeta: null,
      contact: { email: "a@b.com", phone: "+123" },
    })).toEqual({ channel: "email", webChatSessionId: null })
  })

  it("type-guard ignores non-object sourceMeta", () => {
    expect(pickInviteChannel({
      source: "web_chat",
      sourceMeta: "garbage" as unknown,
      contact: { email: "a@b.com", phone: null },
    })).toEqual({ channel: "email", webChatSessionId: null })
  })
})
