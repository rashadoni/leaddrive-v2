/**
 * Phase 7 (inbox redesign) — inbound auto-reply rule matching. Pure + server-safe
 * (NO React/Prisma imports — the API routes + a later webhook-wiring slice import this).
 *
 * slice-1 = match an inbound message to a rule + define the reply text. WIRING the
 * matcher into the webhook ingest and actually SENDING the reply is slice-2 (it
 * touches the shared ingest/send paths), so this module deliberately stops at
 * "which rule fires" — it never sends anything.
 */
import { featureFlagsToArray } from "@/lib/modules"

export const CHATBOT_TRIGGER_TYPES = ["contains", "exact", "starts_with", "always"] as const
export type ChatbotTriggerType = (typeof CHATBOT_TRIGGER_TYPES)[number]

export const CHATBOT_STATUSES = ["draft", "active", "paused"] as const
export type ChatbotStatus = (typeof CHATBOT_STATUSES)[number]
export const CHATBOT_CHANNEL_DISABLED_PREFIX = "chatbotAutoReplyDisabled:"
export const INBOX_QUALIFICATION_FLAG = "inboxLeadQualification"
export const INBOX_QUALIFICATION_BOARD_PREFIX = "inboxLeadQualificationBoard:"

export function isChatbotChannelEnabled(features: unknown, channelType: string): boolean {
  // Флаги могут прийти запакованными в строку — узкая проверка тихо
  // выключала бы канал целиком (см. featureFlagsToArray).
  const flags = featureFlagsToArray(features)
  return flags.includes("chatbotAutoReply")
    && !flags.includes(`${CHATBOT_CHANNEL_DISABLED_PREFIX}${channelType}`)
}

/** Channels a rule may target (server-safe copy; mirrors the inbox channel keys). */
export const CHATBOT_CHANNELS = [
  "email", "telegram", "sms", "whatsapp", "facebook", "instagram", "vkontakte", "tiktok",
] as const

export interface ChatbotRuleLike {
  id: string
  status: string
  channelTypes: string[] // empty = all channels
  triggerType: string
  triggerValue: string | null
  responseText: string
  priority: number
  createdAt: string | Date
}

export interface InboundContext {
  channelType: string
  text: string
}

export function isChatbotTriggerType(v: unknown): v is ChatbotTriggerType {
  return typeof v === "string" && (CHATBOT_TRIGGER_TYPES as readonly string[]).includes(v)
}
export function isChatbotStatus(v: unknown): v is ChatbotStatus {
  return typeof v === "string" && (CHATBOT_STATUSES as readonly string[]).includes(v)
}
export function isChatbotChannel(v: unknown): v is (typeof CHATBOT_CHANNELS)[number] {
  return typeof v === "string" && (CHATBOT_CHANNELS as readonly string[]).includes(v)
}

/** A trigger type other than "always" needs a non-empty triggerValue to mean anything. */
export function triggerNeedsValue(triggerType: string): boolean {
  return triggerType !== "always"
}

/**
 * Search normalization for Azerbaijani/Russian/Latin customer text.
 * Besides case/diacritics it understands the common keyboard transliterations
 * used in chats: ölçü → olcu and olchu → olcu, ş/sh → s, ğ/gh → g.
 */
export function normalizeChatbotText(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase("az")
    .replace(/ə/g, "e")
    .replace(/ı/g, "i")
    .replace(/ç/g, "c")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ch/g, "c")
    .replace(/sh/g, "s")
    .replace(/gh/g, "g")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = next
  }
  return prev[b.length]
}

function fuzzyTokenMatch(term: string, text: string): boolean {
  if (text.includes(term)) return true
  const termTokens = term.split(" ").filter(Boolean)
  const textTokens = text.split(" ").filter(Boolean)
  return termTokens.every((wanted) => textTokens.some((actual) => {
    if (wanted === actual) return true
    // Short words are too collision-prone for fuzzy matching. Longer words may
    // tolerate one typo, or two once they are eight characters long.
    const allowance = wanted.length >= 8 ? 2 : wanted.length >= 4 ? 1 : 0
    return allowance > 0 && Math.abs(wanted.length - actual.length) <= allowance
      && editDistance(wanted, actual) <= allowance
  }))
}

/** Whether one rule's trigger fires for the given (already-normalized) inbound text. */
function triggerFires(rule: ChatbotRuleLike, normText: string): boolean {
  switch (rule.triggerType) {
    case "always":
      return true
    case "exact":
      return normText === normalizeChatbotText(rule.triggerValue ?? "")
    case "starts_with": {
      const v = normalizeChatbotText(rule.triggerValue ?? "")
      return v.length > 0 && normText.startsWith(v)
    }
    case "contains": {
      // comma-separated terms — fire if ANY non-empty term is contained.
      const terms = (rule.triggerValue ?? "")
        .split(",")
        .map(normalizeChatbotText)
        .filter((t) => t.length > 0)
      return terms.some((t) => fuzzyTokenMatch(t, normText))
    }
    default:
      return false // unknown triggerType never fires (fail-closed)
  }
}

/**
 * The first ACTIVE rule whose channel + trigger match the inbound message, or null.
 *
 * Evaluation order is FULLY deterministic and never falls back to the input array
 * order: priority DESC, then createdAt ASC, then `id` ASC as the ultimate stable
 * tiebreak. A corrupt/unparseable createdAt sorts LAST (treated as +Infinity) instead
 * of poisoning the comparator with NaN. This matters because slice-2 feeds rules from
 * a DB read whose ORDER BY isn't guaranteed to break a (priority, createdAt) tie.
 * Only status==="active" rules are considered (draft/paused never fire). A rule with
 * an empty channelTypes matches every channel; otherwise the inbound channel must be
 * listed. Empty/whitespace inbound text (e.g. a media-only message) never matches —
 * slice-1 auto-replies to text only.
 */
export function matchChatbotRule(rules: ChatbotRuleLike[], ctx: InboundContext): ChatbotRuleLike | null {
  const normText = normalizeChatbotText(ctx.text)
  if (!normText) return null
  const candidates = rules
    .filter((r) => r.status === "active")
    .filter((r) => r.channelTypes.length === 0 || r.channelTypes.includes(ctx.channelType))
    .slice()
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      const at = new Date(a.createdAt).getTime()
      const bt = new Date(b.createdAt).getTime()
      const av = Number.isNaN(at) ? Infinity : at // corrupt date sorts last, deterministically
      const bv = Number.isNaN(bt) ? Infinity : bt
      if (av !== bv) return av - bv
      return a.id.localeCompare(b.id) // ultimate stable tiebreak — never input order
    })
  return candidates.find((r) => triggerFires(r, normText)) ?? null
}
