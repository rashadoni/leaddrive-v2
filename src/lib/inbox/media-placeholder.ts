/**
 * A message with no words is stored with a placeholder body — "[media]" (the Meta webhooks, the app
 * echo), "[attachment]", "[вложение]". The placeholder is for the database and the AI, never for a
 * person: shown as it is, the inbox printed a bare «[media]» bubble and a «[media]» preview in the
 * list of conversations (owner, 2026-11-15: «опять media»).
 *
 * Client-safe: the inbox page imports it.
 */
const PLACEHOLDER_RE = /^\[(media|attachment|вложение)\]$/i

export function isMediaPlaceholder(body: string | null | undefined): boolean {
  return typeof body === "string" && PLACEHOLDER_RE.test(body.trim())
}

/**
 * What a placeholder message shows instead of its body.
 *
 *   - `hide` — the file itself is on screen (picture, video, player, link); the placeholder under it
 *     says nothing.
 *   - `withheld` — Meta delivered the message with no text and no file it would hand over (a shared
 *     post it does not expose, a sticker, a template card, `is_unsupported`). Asking the Graph API
 *     for that message returns the same empty body, so the only place to see it is the app.
 *   - `unavailable` — any other channel: the file was not received.
 *   - `body` — not a placeholder: show the words.
 */
export type PlaceholderView =
  | { kind: "body" }
  | { kind: "hide" }
  | { kind: "withheld"; app: string }
  | { kind: "unavailable" }

const APP_WITHHOLDING_CONTENT: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Messenger",
}

export function placeholderView(message: {
  body: string | null | undefined
  mediaUrl?: string | null
  channelType?: string | null
}): PlaceholderView {
  if (!isMediaPlaceholder(message.body)) return { kind: "body" }
  if (typeof message.mediaUrl === "string" && message.mediaUrl.trim()) return { kind: "hide" }
  const app = APP_WITHHOLDING_CONTENT[(message.channelType ?? "").toLowerCase()]
  return app ? { kind: "withheld", app } : { kind: "unavailable" }
}
