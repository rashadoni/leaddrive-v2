/**
 * A message with no words is stored with a placeholder body: «[media]» (the Meta webhooks and the
 * app echo), «[attachment]» / «[unsupported attachment]» (Chatwoot — TikTok — and VK), «[Видео]»,
 * «[Стикер]», «[Документ: x.pdf]», «[template:name]», «[Форма: …]» (WhatsApp, Telegram, template
 * sends). The placeholder is for the database and the AI — the AI reads it as history, and
 * lib/whatsapp-message-text keeps it the SAME text whoever received the message — never for a
 * person: shown as it is, the inbox printed «[media]», «[unsupported attachment]» and Russian
 * words in an Azerbaijani screen (owner, 2026-11-15: «опять media», «исправил всё? уверен?»).
 *
 * So the stored text stays, and the screen reads it through here. Only the known vocabulary is a
 * placeholder: a customer who writes «[Urgent]» keeps his words.
 *
 * Client-safe: the inbox page imports it.
 */

export type PlaceholderKind =
  | "media"
  | "image"
  | "video"
  | "videoNote"
  | "audio"
  | "voice"
  | "sticker"
  | "gif"
  | "document"
  | "location"
  | "contact"
  | "reaction"
  | "button"
  | "interactive"
  | "form"
  | "template"
  | "unsupported"

export type Placeholder = { kind: PlaceholderKind; detail?: string }

const EXACT: Record<string, PlaceholderKind> = {
  media: "media",
  attachment: "media",
  "вложение": "media",
  "изображение": "image",
  "фото": "image",
  image: "image",
  photo: "image",
  "видео": "video",
  video: "video",
  "видео-сообщение": "videoNote",
  "аудио сообщение": "audio",
  "аудио": "audio",
  audio: "audio",
  "голосовое сообщение": "voice",
  voice: "voice",
  "стикер": "sticker",
  sticker: "sticker",
  gif: "gif",
  "контакт": "contact",
  contacts: "contact",
  "кнопка": "button",
  "интерактив": "interactive",
  interactive: "interactive",
  "форма": "form",
  unsupported: "unsupported",
  "unsupported attachment": "unsupported",
  unknown: "unsupported",
}

/** «[Документ: x.pdf]», «[Локация: 40.4, 49.8]», «[Реакция: 👍]», «[Форма: Rəşad]», «[template:name]». */
const WITH_DETAIL: Array<[RegExp, PlaceholderKind]> = [
  [/^документ:\s*(.+)$/i, "document"],
  [/^локация:\s*(.+)$/i, "location"],
  [/^реакция:\s*(.*)$/i, "reaction"],
  [/^форма:\s*(.+)$/i, "form"],
  [/^template:\s*(.+)$/i, "template"],
  [/^стикер\s+(.+)$/i, "sticker"],
]

export function parsePlaceholder(body: string | null | undefined): Placeholder | null {
  if (typeof body !== "string") return null
  const match = /^\[([^\[\]]{1,200})\]$/.exec(body.trim())
  if (!match) return null
  const inner = match[1].trim()
  const exact = EXACT[inner.toLowerCase()]
  if (exact) return { kind: exact }
  for (const [re, kind] of WITH_DETAIL) {
    const m = re.exec(inner)
    if (m) {
      const detail = m[1].trim()
      return detail ? { kind, detail } : { kind }
    }
  }
  return null
}

export function isMediaPlaceholder(body: string | null | undefined): boolean {
  return parsePlaceholder(body) !== null
}

/** A placeholder that only says «a file is here»: under the file itself it says nothing. */
const FILE_KINDS = new Set<PlaceholderKind>(["media", "image", "video", "videoNote", "audio", "voice", "sticker", "gif", "document"])

/** The app a message can still be seen in when its content did not reach the CRM. */
const APP_BY_CHANNEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Messenger",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
}

/** Meta's «[media]» with no file: an empty message, as Graph returns it too. */
const META_APPS = new Set(["Instagram", "Messenger"])

/** A translation key in the `inboxV2` namespace and its values. */
export type PlaceholderLabel = { key: string; values?: Record<string, string> }

export function placeholderLabel(p: Placeholder): PlaceholderLabel {
  switch (p.kind) {
    case "media": return { key: "mediaPreview" }
    case "image": return { key: "placeholderImage" }
    case "video": return { key: "placeholderVideo" }
    case "videoNote": return { key: "placeholderVideoNote" }
    case "audio": return { key: "placeholderAudio" }
    case "voice": return { key: "placeholderVoice" }
    case "sticker": return p.detail ? { key: "placeholderStickerEmoji", values: { emoji: p.detail } } : { key: "placeholderSticker" }
    case "gif": return { key: "placeholderGif" }
    case "document": return p.detail ? { key: "placeholderDocumentNamed", values: { name: p.detail } } : { key: "placeholderDocument" }
    case "location": return p.detail ? { key: "placeholderLocationAt", values: { place: p.detail } } : { key: "placeholderLocation" }
    case "contact": return { key: "placeholderContact" }
    case "reaction": return p.detail ? { key: "placeholderReactionEmoji", values: { emoji: p.detail } } : { key: "placeholderReaction" }
    case "button": return { key: "placeholderButton" }
    case "interactive": return { key: "placeholderInteractive" }
    case "form": return p.detail ? { key: "placeholderFormNamed", values: { name: p.detail } } : { key: "placeholderForm" }
    case "template": return p.detail ? { key: "placeholderTemplateNamed", values: { name: p.detail } } : { key: "placeholderTemplate" }
    case "unsupported": return { key: "placeholderUnsupported" }
  }
}

/**
 * What a message in the thread shows instead of its stored body.
 *
 *   - `body` — not a placeholder: the words.
 *   - `hide` — the file itself is on screen; the placeholder under it says nothing. A document
 *     gives its file name to the link instead.
 *   - `withheld` — the platform delivered the message without the content we could keep (Meta's
 *     «[media]» with no file: Graph returns the same empty message; «[unsupported]»): it is only in
 *     the app. `buttons` — Meta's empty message, and the screen says what it usually is: the
 *     buttons of another business's auto-reply (@avtorental 2026-11-15: «написать в WhatsApp»,
 *     confirmed by the owner in the app) and some stickers.
 *   - `unavailable` — a «[media]» on a channel without an app to point at.
 *   - `label` — a readable name for what the message was; `noFile` when a file was expected and
 *     did not reach the CRM.
 */
export type PlaceholderView =
  | { kind: "body" }
  | { kind: "hide"; fileName?: string }
  | { kind: "withheld"; app: string; buttons?: true }
  | { kind: "unavailable" }
  | { kind: "label"; label: PlaceholderLabel; noFile: boolean }

export function placeholderView(message: {
  body: string | null | undefined
  mediaUrl?: string | null
  channelType?: string | null
}): PlaceholderView {
  const p = parsePlaceholder(message.body)
  if (!p) return { kind: "body" }
  const hasFile = typeof message.mediaUrl === "string" && message.mediaUrl.trim() !== ""
  if (hasFile && FILE_KINDS.has(p.kind)) {
    return p.kind === "document" && p.detail ? { kind: "hide", fileName: p.detail } : { kind: "hide" }
  }
  const app = APP_BY_CHANNEL[(message.channelType ?? "").toLowerCase()]
  if (p.kind === "media" || p.kind === "unsupported") {
    if (!app) return { kind: "unavailable" }
    return p.kind === "media" && META_APPS.has(app) ? { kind: "withheld", app, buttons: true } : { kind: "withheld", app }
  }
  return { kind: "label", label: placeholderLabel(p), noFile: !hasFile && FILE_KINDS.has(p.kind) }
}

/** The line under a conversation in the list. `null` — show the stored text as it is. */
export function placeholderPreview(lastMessage: string | null | undefined): PlaceholderLabel | null {
  const p = parsePlaceholder(lastMessage)
  return p ? placeholderLabel(p) : null
}

/**
 * «[Səsli mesaj] <words>» — a voice note with its transcript (lib/inbox/inbound-voice-transcript,
 * VOICE_MESSAGE_PREFIX). The prefix is Azerbaijani in every language of the screen; the screen
 * names it itself and keeps the words.
 */
const VOICE_TRANSCRIPT_PREFIX = "[Səsli mesaj]"

export function voiceTranscript(body: string | null | undefined): string | null {
  if (typeof body !== "string") return null
  const trimmed = body.trimStart()
  if (!trimmed.startsWith(VOICE_TRANSCRIPT_PREFIX)) return null
  const rest = trimmed.slice(VOICE_TRANSCRIPT_PREFIX.length).trim()
  return rest || null
}
