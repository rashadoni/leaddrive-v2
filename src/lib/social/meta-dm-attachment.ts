/**
 * Sending a file in an Instagram Direct or Messenger conversation.
 *
 * Meta takes an attachment by URL: the send call names an address and Meta downloads the file from
 * it. The address comes from lib/inbox/outbound-media-link. Text cannot ride in the same call as an
 * attachment on Instagram, so a caption is a second message — the caller sends it.
 *
 * Returns Meta's message id: the echo of this send comes back to the webhook, and the id is how
 * lib/inbox/meta-dm-app-echo knows the echo is ours and writes no second row.
 */
import { redactOAuthProviderText } from "@/lib/oauth-redaction"

const IG_GRAPH = "https://graph.instagram.com/v21.0"
const FB_GRAPH = "https://graph.facebook.com/v20.0"
/** Meta downloads the file before it answers, so this waits longer than a text send. */
const SEND_TIMEOUT_MS = 45_000

export type MetaDmAttachmentType = "image" | "video" | "audio" | "file"
export type MetaDmSendResult = { ok: boolean; messageId: string | null; error: string | null }

/**
 * How Meta wants this file named, or null when the platform does not carry it.
 *
 * Messenger carries any file. Instagram carries pictures, video, audio and PDF; an office document
 * sent there is refused by Meta with an error nobody can read, so it is refused here in words.
 */
export function metaDmAttachmentType(platform: "instagram" | "facebook", mime: string): MetaDmAttachmentType | null {
  const type = (mime || "").toLowerCase()
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("video/")) return "video"
  if (type.startsWith("audio/")) return "audio"
  if (platform === "facebook") return "file"
  return type === "application/pdf" ? "file" : null
}

async function post(params: {
  igLogin: boolean
  token: string
  payload: Record<string, unknown>
  timeoutMs: number
}): Promise<MetaDmSendResult> {
  const { igLogin, token, payload, timeoutMs } = params
  try {
    const res = await fetch(
      igLogin ? `${IG_GRAPH}/me/messages?access_token=${encodeURIComponent(token)}` : `${FB_GRAPH}/me/messages`,
      {
        signal: AbortSignal.timeout(timeoutMs),
        method: "POST",
        headers: { "Content-Type": "application/json", ...(igLogin ? {} : { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify(payload),
      },
    )
    const raw = await res.text()
    if (!res.ok) {
      const safe = redactOAuthProviderText(raw)
      console.error(`[meta-dm] send failed (${res.status}):`, safe)
      let reason: string | null = null
      try {
        reason = (JSON.parse(raw) as { error?: { message?: string } })?.error?.message ?? null
      } catch { /* not JSON */ }
      return { ok: false, messageId: null, error: reason ? redactOAuthProviderText(reason) : `HTTP ${res.status}` }
    }
    let messageId: string | null = null
    try {
      const id = (JSON.parse(raw) as { message_id?: unknown }).message_id
      messageId = typeof id === "string" && id ? id : null
    } catch { /* a 2xx without a body is still a send */ }
    return { ok: true, messageId, error: null }
  } catch (e) {
    const text = redactOAuthProviderText(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    console.error("[meta-dm] send error:", text)
    return { ok: false, messageId: null, error: "send error" }
  }
}

/** One attachment, by URL. `igLogin` picks graph.instagram.com (Instagram-Login token) over graph.facebook.com. */
export function sendMetaDmAttachment(params: {
  igLogin: boolean
  recipientId: string
  token: string
  type: MetaDmAttachmentType
  url: string
}): Promise<MetaDmSendResult> {
  const { igLogin, recipientId, token, type, url } = params
  if (!recipientId || !token || !url) return Promise.resolve({ ok: false, messageId: null, error: "not configured" })
  return post({
    igLogin,
    token,
    timeoutMs: SEND_TIMEOUT_MS,
    payload: { recipient: { id: recipientId }, message: { attachment: { type, payload: { url } } } },
  })
}

/** The caption that follows an attachment — same transport, and it reports its message id too. */
export function sendMetaDmText(params: {
  igLogin: boolean
  recipientId: string
  token: string
  text: string
}): Promise<MetaDmSendResult> {
  const { igLogin, recipientId, token, text } = params
  if (!recipientId || !token || !text) return Promise.resolve({ ok: false, messageId: null, error: "not configured" })
  return post({ igLogin, token, timeoutMs: 15_000, payload: { recipient: { id: recipientId }, message: { text } } })
}
