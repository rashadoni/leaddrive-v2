/**
 * Two kinds of Instagram Direct / Messenger message that arrived with no `text` and no file, and
 * were stored as a bare «[media]» — found 2026-11-16 by the shape log (lib/social/meta-message-shape):
 *
 *   - a CARD (`attachments: [{ type: "template", payload: { generic: … } }]`): another business's
 *     auto-reply with buttons (@avtorental 2026-11-15: «write on WhatsApp»), and the card Instagram
 *     itself adds a second after a customer types a phone number (Zeytun, @sbhnbyrmv and
 *     @nuriyeva.alisa 2026-11-16). Its title, subtitle and button names are words — kept as the body.
 *   - an UNSEND (`{ mid, is_deleted: true }`): the customer deleted a message they had sent. It is
 *     not a new message; the one it names is marked, and the inbox stops showing it — Instagram does.
 *
 * Meta does not document the inbound card, so it is read loosely: whatever carries a title, a
 * subtitle, a text or buttons, under `generic`, `elements` or the payload itself. When nothing
 * readable is found the message stays «[media]» and the shape log names the nested keys.
 */
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { UNSENT_PREVIEW } from "@/lib/inbox/media-placeholder"

type Rec = Record<string, unknown>

function record(value: unknown): Rec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null
}

const MAX_CARDS = 10
const MAX_BUTTONS = 3
const MAX_FIELD = 300

function field(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.replace(/\s+/g, " ").trim()
  return text ? text.slice(0, MAX_FIELD) : null
}

export type MetaCard = { title: string | null; subtitle: string | null; buttons: string[] }

function isCard(r: Rec): boolean {
  return typeof r.title === "string" || typeof r.subtitle === "string" || typeof r.text === "string" || Array.isArray(r.buttons)
}

/** The cards of every `template` attachment, in order. */
export function readMetaTemplateCards(attachments: unknown): MetaCard[] {
  if (!Array.isArray(attachments)) return []
  const found: Rec[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || found.length >= MAX_CARDS) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    const r = record(value)
    if (!r) return
    if (isCard(r)) {
      found.push(r)
      return
    }
    for (const key of ["generic", "elements", "cards", "template"]) {
      if (key in r) visit(r[key], depth + 1)
    }
  }
  for (const raw of attachments) {
    const a = record(raw)
    if (!a || typeof a.type !== "string" || a.type.toLowerCase() !== "template") continue
    visit(a.payload, 0)
  }
  return found
    .map((r) => ({
      title: field(r.title) ?? field(r.text),
      subtitle: field(r.subtitle),
      buttons: (Array.isArray(r.buttons) ? r.buttons : [])
        .map((b) => field(record(b)?.title))
        .filter((t): t is string => t !== null)
        .slice(0, MAX_BUTTONS),
    }))
    .filter((c) => c.title || c.subtitle || c.buttons.length)
}

/** The cards as the message body: title, subtitle, then one line per button. Null — nothing readable. */
export function metaCardsText(cards: readonly MetaCard[]): string | null {
  const blocks = cards.map((c) =>
    [c.title, c.subtitle, ...c.buttons.map((b) => `▸ ${b}`)].filter((line): line is string => !!line).join("\n"),
  ).filter(Boolean)
  return blocks.length ? blocks.join("\n\n") : null
}

/** What a Meta inbound message says in words: its text, else its cards, else null. */
export function metaInboundText(message: { text?: unknown; attachments?: unknown } | null | undefined): string | null {
  const text = typeof message?.text === "string" && message.text.trim() ? message.text : null
  return text ?? metaCardsText(readMetaTemplateCards(message?.attachments))
}

export function isMetaUnsend(message: { is_deleted?: unknown } | null | undefined): boolean {
  return message?.is_deleted === true
}

/**
 * Mark the inbound message `mid` as deleted by the customer. Its row stays — the words are history
 * the business already received — but the inbox shows that it was deleted, and the conversation
 * preview stops quoting it when it was the latest. `false` — no such message here.
 */
export async function markMetaDmUnsent(input: {
  organizationId: string
  channelType: "instagram" | "facebook"
  mid: string
  at?: Date
}): Promise<boolean> {
  const row = await prisma.channelMessage.findFirst({
    where: { organizationId: input.organizationId, channelType: input.channelType, direction: "inbound", externalId: input.mid },
    select: { id: true, metadata: true, conversationId: true, createdAt: true },
  })
  if (!row) return false
  const metadata = record(row.metadata) ?? {}
  if (metadata.unsentByCustomer === true) return true
  await prisma.channelMessage.update({
    where: { id: row.id },
    data: { metadata: { ...metadata, unsentByCustomer: true, unsentAt: (input.at ?? new Date()).toISOString() } as Prisma.InputJsonValue },
  })
  if (row.conversationId) {
    const newer = await prisma.channelMessage.findFirst({
      where: { organizationId: input.organizationId, conversationId: row.conversationId, createdAt: { gt: row.createdAt } },
      select: { id: true },
    })
    if (!newer) {
      await prisma.socialConversation.updateMany({
        where: { id: row.conversationId, organizationId: input.organizationId },
        data: { lastMessage: UNSENT_PREVIEW },
      })
    }
  }
  return true
}
