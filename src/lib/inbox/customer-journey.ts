/**
 * «Müştəri yolu» — the customer's path across channels, for the inbox panel (owner, 2026-11-15:
 * the dense-inbox mock-up, list approved «Давай»).
 *
 * A step is one stretch of talk in one conversation — the messages of that conversation with no
 * pause longer than SESSION_GAP_MS between them — or one call. It names the channel, when, the last
 * thing said and who said it; a call names its length. No amounts: nothing extracts a price from a
 * message, and a figure in the mock-up was made up (owner: «Суммы в шагах не извлекаются — не
 * выдумывать»).
 *
 * Which conversations are «the same customer» is `SocialConversation.contactId` — WhatsApp sets it
 * from the phone, Instagram and Messenger once a manager links them (lib/inbox/contact-link). A
 * channel hidden from the person (lib/inbox/channel-access) is not in his path.
 */

import { messageAuthor } from "@/lib/inbox/message-author"

export const SESSION_GAP_MS = 6 * 60 * 60 * 1000
export const JOURNEY_STEPS = 4

export type JourneyMessage = {
  id: string
  conversationId: string
  direction: string
  body: string
  messageType: string
  createdAt: Date
  metadata: unknown
}

export type JourneyCall = {
  id: string
  conversationId: string | null
  direction: string
  status: string
  provider: string
  duration: number | null
  startedAt: Date | null
  createdAt: Date
}

export type JourneyAuthor = "customer" | "operator" | "ai" | "bot"

export type JourneyStep =
  | {
      kind: "chat"
      key: string
      conversationId: string
      channel: string
      startedAt: string
      at: string
      messages: number
      /** The last words of the stretch; null when it ended on a photo, a voice note, a file. */
      quote: string | null
      /** What the last message was when it had no words: image, audio, video, document… */
      media: string | null
      author: JourneyAuthor
      authorName: string | null
      current: boolean
    }
  | {
      kind: "call"
      key: string
      conversationId: string | null
      channel: "whatsapp" | "voip"
      at: string
      direction: string
      status: string
      durationSec: number | null
      current: boolean
    }

export type JourneyResult = { steps: JourneyStep[]; total: number; beyondCurrent: boolean }

const QUOTE_MAX = 90

function meta(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Who wrote a message, by the same reading as the badge under it in the thread (message-author). */
export function journeyAuthor(
  message: Pick<JourneyMessage, "direction" | "metadata">,
  channel: string,
): { author: JourneyAuthor; name: string | null } {
  if (message.direction !== "outbound") return { author: "customer", name: null }
  const m = meta(message.metadata)
  if (m.bookingAgent === true) return { author: "ai", name: null }
  const who = messageAuthor(m, channel)
  switch (who.kind) {
    case "ai": return { author: "ai", name: null }
    case "person": return { author: "operator", name: who.name }
    case "app": return { author: "operator", name: who.app || null }
    case "operator": return { author: "operator", name: null }
    default: return m.autoReply === true ? { author: "bot", name: null } : { author: "operator", name: null }
  }
}

function quoteOf(body: string): string | null {
  const text = body.replace(/\s+/g, " ").trim()
  if (!text) return null
  return text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1).trimEnd()}…` : text
}

/**
 * Steps, oldest first, the last `limit` of them, and how many there were in all. `channelOf` names
 * the channel of a conversation; `currentConversationId` marks the steps of the open thread.
 */
export function buildJourney(input: {
  messages: JourneyMessage[]
  calls: JourneyCall[]
  channelOf: (conversationId: string) => string
  currentConversationId: string
  limit?: number
}): JourneyResult {
  const steps: JourneyStep[] = []
  const open = new Map<string, Extract<JourneyStep, { kind: "chat" }> & { lastAtMs: number }>()

  const chronological = [...input.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  for (const message of chronological) {
    const at = message.createdAt.getTime()
    let step = open.get(message.conversationId)
    if (!step || at - step.lastAtMs > SESSION_GAP_MS) {
      step = {
        kind: "chat",
        key: `chat:${message.id}`,
        conversationId: message.conversationId,
        channel: input.channelOf(message.conversationId),
        startedAt: message.createdAt.toISOString(),
        at: message.createdAt.toISOString(),
        messages: 0,
        quote: null,
        media: null,
        author: "customer",
        authorName: null,
        current: message.conversationId === input.currentConversationId,
        lastAtMs: at,
      }
      open.set(message.conversationId, step)
      steps.push(step)
    }
    const who = journeyAuthor(message, step.channel)
    const quote = quoteOf(message.body)
    step.messages += 1
    step.at = message.createdAt.toISOString()
    step.lastAtMs = at
    step.quote = quote
    step.media = quote ? null : (message.messageType && message.messageType !== "text" ? message.messageType : null)
    step.author = who.author
    step.authorName = who.name
  }

  for (const call of input.calls) {
    const when = call.startedAt ?? call.createdAt
    steps.push({
      kind: "call",
      key: `call:${call.id}`,
      conversationId: call.conversationId,
      channel: call.provider === "whatsapp" ? "whatsapp" : "voip",
      at: when.toISOString(),
      direction: call.direction,
      status: call.status,
      durationSec: typeof call.duration === "number" && call.duration > 0 ? call.duration : null,
      current: call.conversationId !== null && call.conversationId === input.currentConversationId,
    })
  }

  // A chat step's time is its last message — where it stands in the path.
  const ordered = steps
    .map((step) => {
      if (step.kind !== "chat") return step
      const { lastAtMs: _lastAtMs, ...rest } = step as typeof step & { lastAtMs?: number }
      return rest
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.key.localeCompare(b.key))

  const limit = Math.max(1, input.limit ?? JOURNEY_STEPS)
  return {
    steps: ordered.slice(-limit),
    total: ordered.length,
    // Worth a card only when it shows more than the open thread itself: another conversation, or a call.
    beyondCurrent: ordered.some((step) => step.kind === "call" || !step.current),
  }
}
