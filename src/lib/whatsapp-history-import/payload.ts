/**
 * What Meta sends for a coexistence number's one-shot sync, read without touching the database.
 *
 * Three webhooks, all documented on Meta's «Onboarding WhatsApp Business app users» page and its
 * webhook references (checked 2026-11-15):
 *
 *   • `smb_app_state_sync` — the app's address book: `state_sync[] → { type: "contact",
 *     contact: { full_name, first_name, phone_number, user_id }, action: add | remove,
 *     metadata: { timestamp } }`.
 *   • `history` — the chats: `history[] → { metadata: { phase, chunk_order, progress },
 *     threads[] → { id (the customer's phone), context: { wa_id, user_id, username },
 *     messages[] } }`. A message the business sent carries `from` = the business number and no
 *     `from_user_id`; a customer's carries `from_user_id`. Media come as `media_placeholder`. If the
 *     business turned history sharing off, the item is `{ errors: [{ code: 2593109, … }] }`.
 *   • a `history` webhook with plain `messages[]` (no `history` wrapper): the real media of the last
 *     two weeks, sent after the placeholders.
 *
 * Every reader here is total: an unexpected shape becomes "skipped", never an exception, because a
 * chunk that throws is a chunk that is never imported — and Meta will not send it again.
 */
import { createHash } from "crypto"
import { describeWaMessage, type WaMessageTextPayload } from "@/lib/whatsapp-message-text"

type Rec = Record<string, unknown>

/** Meta's code for «History sync is turned off by the business from the WhatsApp Business App». */
export const HISTORY_SHARING_DECLINED = 2593109

export function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/** Bare digits, the shape every WhatsApp row in this database is keyed by. */
export function digits(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const clean = String(value).replace(/\D/g, "")
  return clean || null
}

function int(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function rec(value: unknown): Rec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Rec : null
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Meta's timestamps are unix seconds as strings. Anything else — or a date in the future — is no time. */
export function unixDate(value: unknown, now: Date = new Date()): Date | null {
  const n = int(value)
  if (n === null || n <= 0) return null
  const at = new Date(n * 1000)
  // A device clock a few minutes ahead is normal; a year ahead is not a message time.
  return at.getTime() > now.getTime() + 24 * 3600_000 ? null : at
}

/** Same webhook, same row: Meta redelivers a payload it did not get a prompt 2xx for. */
export function fingerprintOf(phoneNumberId: string, kind: string, part: unknown): string {
  return createHash("sha256").update(`${phoneNumberId}\n${kind}\n${JSON.stringify(part)}`).digest("hex")
}

export type CapturedChunk = {
  kind: "contacts" | "history" | "media"
  fingerprint: string
  phase: number | null
  chunkOrder: number | null
  progress: number | null
  errorCode: number | null
  /** Messages or contacts in the chunk — what the progress screen counts before importing. */
  items: number
  /** What the importer needs; null when there is nothing to import (a refusal). */
  payload: Rec | null
}

/**
 * Split one change `value` into the rows the webhook stores.
 *
 * A `history` value can hold several items, each with its own phase and chunk order, so each is its
 * own row; the business number travels with it because a thread's messages are told apart by it.
 */
export function chunksOf(field: "history" | "smb_app_state_sync", value: Rec, phoneNumberId: string): CapturedChunk[] {
  const metadata = rec(value.metadata)
  const businessPhone = digits(metadata?.display_phone_number)

  if (field === "smb_app_state_sync") {
    const items = list(value.state_sync)
    if (items.length === 0) return []
    return [{
      kind: "contacts",
      fingerprint: fingerprintOf(phoneNumberId, "contacts", items),
      phase: null,
      chunkOrder: null,
      progress: null,
      errorCode: null,
      items: items.length,
      payload: { state_sync: items },
    }]
  }

  // The media follow-up: real files for the placeholders of the last two weeks.
  if (!Array.isArray(value.history) && Array.isArray(value.messages)) {
    const messages = list(value.messages)
    if (messages.length === 0) return []
    return [{
      kind: "media",
      fingerprint: fingerprintOf(phoneNumberId, "media", messages),
      phase: null,
      chunkOrder: null,
      progress: null,
      errorCode: null,
      items: messages.length,
      payload: { businessPhone, phoneNumberId, messages },
    }]
  }

  const out: CapturedChunk[] = []
  for (const raw of list(value.history)) {
    const item = rec(raw)
    if (!item) continue
    const meta = rec(item.metadata)
    const errors = list(item.errors).map(rec).filter((e): e is Rec => !!e)
    const errorCode = errors.length > 0 ? int(errors[0].code) ?? -1 : null
    const threads = list(item.threads)
    const messages = threads.reduce<number>((sum, thread) => sum + list(rec(thread)?.messages).length, 0)
    out.push({
      kind: "history",
      fingerprint: fingerprintOf(phoneNumberId, "history", item),
      phase: int(meta?.phase),
      chunkOrder: int(meta?.chunk_order),
      progress: int(meta?.progress),
      errorCode,
      items: messages,
      payload: errorCode === null ? { businessPhone, phoneNumberId, item } : null,
    })
  }
  return out
}

export type HistoryMessage = {
  wamid: string
  direction: "inbound" | "outbound"
  at: Date
  text: string
  messageType: string
  /** Meta's delivery state on the phone, lower-cased (`read`, `delivered`, …). */
  historyStatus: string | null
}

export type HistoryThread = {
  /** The conversation key: the customer's phone digits, or their business-scoped user id. */
  threadKey: string
  phone: string | null
  userId: string | null
  username: string | null
  messages: HistoryMessage[]
  skipped: number
}

/** Types that are not a line in a chat: a reaction, a deletion, an edit of another message. */
const NOT_A_LINE = new Set(["reaction", "revoke", "edit", "unsupported", "system", "ephemeral"])

function messageDirection(msg: Rec, businessPhone: string | null, threadPhone: string | null): "inbound" | "outbound" | null {
  // Meta: `from_user_id` is present only when the WhatsApp user sent the message.
  if (str(msg.from_user_id) || str(msg.from_parent_user_id)) return "inbound"
  const from = digits(msg.from)
  if (!from) return null
  if (businessPhone && from === businessPhone) return "outbound"
  if (threadPhone && from === threadPhone) return "inbound"
  // Not the business, so the customer — whatever spelling of their number this is.
  if (businessPhone) return "inbound"
  return null
}

/** The threads of one history chunk, ready to write. */
export function threadsOf(item: Rec, businessPhone: string | null, now: Date = new Date()): HistoryThread[] {
  const out: HistoryThread[] = []
  for (const raw of list(item.threads)) {
    const thread = rec(raw)
    if (!thread) continue
    const context = rec(thread.context)
    const phone = digits(thread.id) ?? digits(context?.wa_id)
    const userId = str(context?.user_id)
    const threadKey = phone ?? userId
    const messages = list(thread.messages)
    if (!threadKey) continue
    const parsed: HistoryMessage[] = []
    let skipped = 0
    for (const rawMsg of messages) {
      const msg = rec(rawMsg)
      const wamid = str(msg?.id)
      const at = msg ? unixDate(msg.timestamp, now) : null
      const type = str(msg?.type) ?? "text"
      const direction = msg ? messageDirection(msg, businessPhone, phone) : null
      if (!msg || !wamid || !at || !direction || NOT_A_LINE.has(type)) {
        skipped += 1
        continue
      }
      const { text, messageType } = describeWaMessage(msg as WaMessageTextPayload)
      const historyStatus = str(rec(msg.history_context)?.status)?.toLowerCase() ?? null
      parsed.push({ wamid, direction, at, text, messageType, historyStatus })
    }
    out.push({ threadKey, phone, userId, username: str(context?.username), messages: parsed, skipped })
  }
  return out
}

/** Our status for a message the business sent from the app. `sent` unless Meta says otherwise. */
export function outboundStatus(historyStatus: string | null): string {
  switch (historyStatus) {
    case "read":
    case "played":
      return "read"
    case "delivered":
      return "delivered"
    case "error":
      return "failed"
    default:
      return "sent"
  }
}

export type AddressBookEntry = {
  action: "add" | "remove"
  phone: string | null
  fullName: string | null
  at: Date | null
}

/** The address book entries of one `smb_app_state_sync` chunk. */
export function addressBookOf(payload: Rec, now: Date = new Date()): AddressBookEntry[] {
  const out: AddressBookEntry[] = []
  for (const raw of list(payload.state_sync)) {
    const item = rec(raw)
    if (!item || (str(item.type) ?? "contact") !== "contact") continue
    const contact = rec(item.contact)
    const action = str(item.action) === "remove" ? "remove" : "add"
    const fullName = (str(contact?.full_name) ?? str(contact?.first_name))?.trim() || null
    out.push({
      action,
      phone: digits(contact?.phone_number),
      fullName,
      at: unixDate(rec(item.metadata)?.timestamp, now),
    })
  }
  return out
}

export type HistoryMedia = {
  wamid: string
  type: string
  mediaId: string | null
  caption: string | null
}

/** The media follow-up's messages: which placeholder gets which file. */
export function mediaOf(payload: Rec): HistoryMedia[] {
  const out: HistoryMedia[] = []
  for (const raw of list(payload.messages)) {
    const msg = rec(raw)
    const wamid = str(msg?.id)
    const type = str(msg?.type)
    if (!msg || !wamid || !type) continue
    const body = rec(msg[type])
    out.push({ wamid, type, mediaId: str(body?.id), caption: str(body?.caption) })
  }
  return out
}
