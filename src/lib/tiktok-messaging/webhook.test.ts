import { nativeTikTokReplyTarget } from "./identity"
import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { messagingConversationKey, parseMessagingInbound, verifyMessagingWebhook } from "./webhook"

const now = 1_800_000_000_000
const secret = "fixture-webhook-secret"
const inner = { from: "customer", conversation_id: "opaque+conversation=", message_id: "m1", timestamp: now,
  from_user: { role: "personal_account", id: "person1" }, to_user: { role: "business_account", id: "business1" }, type: "text", text: { body: "Hello" } }
const envelope = { client_key: "app1", event: "im_receive_msg", user_openid: "business1", content: JSON.stringify(inner) }
const signature = (value: unknown, timestamp = now / 1000) => `t=${timestamp},s=${createHmac("sha256", secret).update(`${timestamp}.${JSON.stringify(value)}`).digest("hex")}`

describe("TikTok Messaging webhook authentication and decoding", () => {
  it("accepts documented JSON serialization, including insignificant transport whitespace", () => {
    expect(verifyMessagingWebhook(JSON.stringify(envelope, null, 2), signature(envelope), secret, now)).toEqual(envelope)
  })
  it("rejects tampering, wrong secrets, malformed signatures and replay timestamps", () => {
    expect(verifyMessagingWebhook(JSON.stringify({ ...envelope, user_openid: "another" }), signature(envelope), secret, now)).toBeNull()
    expect(verifyMessagingWebhook(JSON.stringify(envelope), signature(envelope), "wrong", now)).toBeNull()
    for (const header of [null, "t=1,s=aa", signature(envelope) + ",s=abcd", signature(envelope, now / 1000 - 301), signature(envelope, now / 1000 + 301)]) {
      expect(verifyMessagingWebhook(JSON.stringify(envelope), header, secret, now)).toBeNull()
    }
    expect(verifyMessagingWebhook("x".repeat(1_048_577), signature(envelope), secret, now)).toBeNull()
  })
  it("binds recipient to signed business ID and preserves opaque identifiers", () => {
    expect(parseMessagingInbound(envelope, "app1", now)).toMatchObject({ businessId: "business1", conversationId: "opaque+conversation=", body: "Hello", senderId: "person1" })
    expect(parseMessagingInbound(envelope, "another-app", now)).toBeNull()
    expect(parseMessagingInbound({ ...envelope, user_openid: "another-account" }, "app1", now)).toBeNull()
    expect(parseMessagingInbound({ ...envelope, content: inner }, "app1", now)).toBeNull()
  })
  it("does not fabricate messages for echoes, EU notices, reactions or malformed timestamps", () => {
    for (const event of ["im_send_msg", "im_receive_msg_eu", "im_mark_read_msg"]) expect(parseMessagingInbound({ ...envelope, event }, "app1", now)).toBeNull()
    for (const patch of [{ type: "reaction" }, { timestamp: now + 301_000 }, { from_user: { role: "business_account", id: "business1" } }]) {
      expect(parseMessagingInbound({ ...envelope, content: JSON.stringify({ ...inner, ...patch }) }, "app1", now)).toBeNull()
    }
  })
  it("uses collision-free native thread IDs and explicitly labels unsupported attachments", () => {
    expect(messagingConversationKey("a:b", "c")).not.toEqual(messagingConversationKey("a", "b:c"))
    expect(parseMessagingInbound({ ...envelope, content: JSON.stringify({ ...inner, type: "image" }) }, "app1", now)).toMatchObject({ messageType: "unsupported", body: "Image received in TikTok" })
  })
})


it("resolves the native composer recipient without borrowing a legacy Chatwoot target", () => {
  expect(nativeTikTokReplyTarget([{ metadata: { chatwootConversationId: "42" } }])).toBeNull()
  expect(nativeTikTokReplyTarget([{ metadata: { provider: "tiktok_messaging", businessId: "business", providerConversationId: "opaque+id=" } }])).toBe("tiktok-messaging:business:opaque%2Bid%3D")
})
