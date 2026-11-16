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
/**
 * `outsideWindow` — Meta refused because the customer last wrote too long ago (code 10; subcode
 * 2534022 on Instagram, 2018278 on Messenger). Its own text comes in the language of the token's
 * owner — Zeytun got «Сообщение отправлено за пределами допустимого окна» on an Azerbaijani screen —
 * so the caller decides from this flag, not from the words.
 */
export type MetaDmSendResult = { ok: boolean; messageId: string | null; error: string | null; outsideWindow?: true }

const OUTSIDE_WINDOW_SUBCODES = new Set([2534022, 2018278])

/**
 * A message a person typed may go out up to 7 days after the customer's last one with Meta's
 * HUMAN_AGENT tag — the only tag Instagram has. Never on an automated send: Meta allows it for a
 * human answering a question only, and an app that tags robots loses messaging. It works only once
 * Meta has approved the app's «Human Agent» feature; until then Meta refuses the tagged send too.
 */
const HUMAN_AGENT_TAG = { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } as const

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
      let outsideWindow = false
      try {
        const err = (JSON.parse(raw) as { error?: { message?: string; code?: unknown; error_subcode?: unknown } })?.error
        reason = err?.message ?? null
        outsideWindow = err?.code === 10 && typeof err.error_subcode === "number" && OUTSIDE_WINDOW_SUBCODES.has(err.error_subcode)
      } catch { /* not JSON */ }
      return {
        ok: false,
        messageId: null,
        error: reason ? redactOAuthProviderText(reason) : `HTTP ${res.status}`,
        ...(outsideWindow ? { outsideWindow: true as const } : {}),
      }
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
  /** A person sends it: see HUMAN_AGENT_TAG. */
  humanAgent?: boolean
}): Promise<MetaDmSendResult> {
  const { igLogin, recipientId, token, type, url, humanAgent } = params
  if (!recipientId || !token || !url) return Promise.resolve({ ok: false, messageId: null, error: "not configured" })
  return post({
    igLogin,
    token,
    timeoutMs: SEND_TIMEOUT_MS,
    payload: {
      recipient: { id: recipientId },
      message: { attachment: { type, payload: { url } } },
      ...(humanAgent ? HUMAN_AGENT_TAG : {}),
    },
  })
}

/** The caption that follows an attachment — same transport, and it reports its message id too. */
export function sendMetaDmText(params: {
  igLogin: boolean
  recipientId: string
  token: string
  text: string
  /** A person sends it: see HUMAN_AGENT_TAG. */
  humanAgent?: boolean
}): Promise<MetaDmSendResult> {
  const { igLogin, recipientId, token, text, humanAgent } = params
  if (!recipientId || !token || !text) return Promise.resolve({ ok: false, messageId: null, error: "not configured" })
  return post({
    igLogin,
    token,
    timeoutMs: 15_000,
    payload: { recipient: { id: recipientId }, message: { text }, ...(humanAgent ? HUMAN_AGENT_TAG : {}) },
  })
}

/**
 * A private reply to an Instagram comment: lands in the commenter's Direct, tied to the comment.
 * Meta takes one per comment, within 7 days of it, whether or not the person ever wrote in Direct
 * (lib/social/instagram-comments). Same transport and the same message id for the echo as a text.
 */
export function sendMetaCommentPrivateReply(params: {
  igLogin: boolean
  commentId: string
  token: string
  text: string
}): Promise<MetaDmSendResult> {
  const { igLogin, commentId, token, text } = params
  if (!commentId || !token || !text) return Promise.resolve({ ok: false, messageId: null, error: "not configured" })
  return post({
    igLogin,
    token,
    timeoutMs: 15_000,
    payload: { recipient: { comment_id: commentId }, message: { text } },
  })
}

/**
 * Send as usual; if Meta says the customer's window has closed and a person wrote this, send it
 * once more tagged HUMAN_AGENT. Inside the 24 hours nothing changes — no tag, one call. The result
 * keeps `outsideWindow` when the second try did not go either, so the screen can say why.
 */
export async function sendMetaDmAsPerson(
  send: (humanAgent: boolean) => Promise<MetaDmSendResult>,
  byPerson: boolean,
): Promise<MetaDmSendResult> {
  const first = await send(false)
  if (first.ok || !first.outsideWindow || !byPerson) return first
  const tagged = await send(true)
  if (tagged.ok) return tagged
  console.error(`[meta-dm] HUMAN_AGENT send refused too: ${tagged.error ?? "no reason"}`)
  return { ...tagged, outsideWindow: true }
}
