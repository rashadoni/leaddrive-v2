import { createHmac, timingSafeEqual } from "node:crypto"
import { record } from "./config"

const MAX_BODY_BYTES = 1_048_576
const MAX_CLOCK_SKEW_SECONDS = 300

/** Implements API for Business's documented JSON.stringify(body) signature. */
export function verifyMessagingWebhook(raw: string, signature: string | null, secret: string, now = Date.now()): Record<string, unknown> | null {
  if (!secret || !signature || Buffer.byteLength(raw) > MAX_BODY_BYTES) return null
  const parts = signature.split(",").map(part => part.trim())
  if (parts.length !== 2) return null
  const time = parts.find(part => /^t=\d{1,12}$/.test(part))?.slice(2)
  const digest = parts.find(part => /^s=[a-fA-F0-9]{64}$/.test(part))?.slice(2)
  if (!time || !digest || Math.abs(now / 1000 - Number(time)) > MAX_CLOCK_SKEW_SECONDS) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const expected = createHmac("sha256", secret).update(`${time}.${JSON.stringify(parsed)}`).digest()
    return timingSafeEqual(expected, Buffer.from(digest, "hex")) ? record(parsed) : null
  } catch { return null }
}

export type MessagingInbound = {
  businessId: string; conversationId: string; messageId: string; senderId: string
  senderName: string; body: string; messageType: string; timestamp: number
}
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024

export function parseMessagingInbound(envelope: Record<string, unknown>, appId: string, now = Date.now()): MessagingInbound | null {
  // Restricted EU notices, echoes, read receipts and reactions are not text DMs.
  if (envelope.client_key !== appId || envelope.event !== "im_receive_msg"
    || !id(envelope.user_openid) || typeof envelope.content !== "string") return null
  let content: Record<string, unknown>
  try { content = record(JSON.parse(envelope.content)) } catch { return null }
  const from = record(content.from_user), to = record(content.to_user)
  if (from.role !== "personal_account" || to.role !== "business_account"
    || to.id !== envelope.user_openid || !id(from.id)
    || !id(content.conversation_id) || !id(content.message_id)
    || typeof content.timestamp !== "number" || !Number.isSafeInteger(content.timestamp)
    || content.timestamp <= 0 || content.timestamp > now + 300_000) return null
  const media: Record<string, string> = {
    image: "Image received in TikTok", video: "Video received in TikTok", share_post: "Post shared in TikTok",
    emoji: "Emoji received in TikTok", sticker: "Sticker received in TikTok", template: "Template received in TikTok",
  }
  const kind = typeof content.type === "string" ? content.type : ""
  const text = record(content.text).body
  const body = kind === "text" ? text : media[kind]
  if (typeof body !== "string" || !body || body.length > 24_000) return null
  return {
    businessId: envelope.user_openid, conversationId: content.conversation_id, messageId: content.message_id,
    senderId: from.id, senderName: typeof content.from === "string" ? content.from.slice(0, 200) : "TikTok user",
    body, messageType: kind === "text" ? "text" : "unsupported", timestamp: content.timestamp,
  }
}

// Encode opaque components to prevent ambiguous concatenations or legacy collisions.
export { messagingConversationKey, messagingMessageKey } from "./identity"
