/**
 * "How many leads do we have?" is a question about NOW, not about a period.
 *
 * The verified-analytics detector reads "сколько" + "лид" and forces
 * `get_crm_period_report`, whose guard then refuses the call because the
 * message carries no period — `matchesExpectedPeriod` returns false when the
 * server could not parse one, deliberately, so the model can never invent a
 * window and present the result as verified. The consequence, measured in
 * production on 2026-08-20 ("yeni neçə lid var"), is that the single most
 * natural question a manager asks is a guaranteed dead end: the reply is
 * replaced with "I could not verify the CRM data" and a failed-search card.
 *
 * The tool that answers it already exists. `get_leads_summary` and its
 * siblings are state snapshots — current totals, current status buckets — and
 * they are already exposed to chat, executed by the same shared executor under
 * the same RLS, role and module gates. This module recognises the state
 * question and names the read tool the first model round must observe.
 *
 * Like `chat-advisory`, it deliberately maps to the voice read tools and NOT to
 * CHAT_ANALYTICS_TOOLS: an analytics call hands the answer to the deterministic
 * renderer, which is right for "how many deals in July" and wrong for a
 * snapshot the model should describe in the user's own words.
 *
 * What it must never capture: rankings (who sold most), anything with a real
 * period, and event questions (created, won, completed, resolved). An event
 * without a window genuinely is ambiguous, and reinterpreting it as a current
 * total would answer a different question than the one asked.
 */

import { messageCarriesExplicitPeriod, analyticsMatchText } from "@/lib/ai/chat-analytics-tools"
import type { VoiceToolName } from "@/lib/ai/voice/read-tools"

export type CurrentStateGrounding = {
  /** The read tool the first round is forced onto. */
  tool: VoiceToolName
  /** Arguments the model must reproduce exactly, when the tool takes any. */
  expectedInput?: Record<string, string>
}

/** Counting or reporting intent — the question asks for a figure, not advice. */
const COUNT_INTENT = new RegExp(
  [
    "сколько", "количеств", "скольк", "число\\s", "сводк", "отч[её]т", "статистик",
    "how\\s+many", "\\bcount\\b", "number\\s+of", "\\btotal\\b", "summary", "report", "overview",
    "neçe", "nece", "\\bsay[ıi]\\b", "cemi", "umumi", "xulase", "icmal", "hesabat", "statistika",
  ].join("|"),
  "iu",
)

/** A ranking belongs to get_crm_ranking, which has its own verified path. */
const RANKING_INTENT = new RegExp(
  [
    "\\bкто\\b", "у\\s+кого", "наибольш", "наименьш", "топ\\b", "рейтинг", "лидер",
    "\\bwho\\b", "\\btop\\b", "\\bbest\\b", "\\bworst\\b", "ranking",
    "\\bkim\\b", "reytinq", "en\\s+(?:cox|az)",
  ].join("|"),
  "iu",
)

/**
 * Past events need a window. "Сколько лидов создали" is not "сколько лидов" —
 * the first counts a flow, the second a stock, and only the second is a state.
 */
const EVENT_INTENT = new RegExp(
  [
    "создан", "создал", "завед[её]н", "поступил", "пришл[ои]", "закрыл", "выигра", "продал",
    "выполнил", "заверш", "отправл", "решил", "обработал", "получен",
    "creat(?:ed|e)", "\\bwon\\b", "\\bwin\\b", "\\bwins\\b", "did\\s+we", "\\bclosed\\b",
    "complet", "resolv", "\\bsent\\b", "receiv",
    "yarad", "bagla", "qazan", "tamamla", "gonderil", "hell\\s*ed",
  ].join("|"),
  "iu",
)

/** Overdue is a state, and it has its own cross-entity snapshot tool. */
const OVERDUE_INTENT = /(?:просроч|overdue|past\s+due|gecikm|vaxti\s*ke[cç])/u

type EntityRule = { pattern: RegExp; grounding: CurrentStateGrounding }

/**
 * Order matters: a board question mentioning tasks must land on the board
 * snapshot, so boards are tested before the plain task wording.
 */
const ENTITY_RULES: EntityRule[] = [
  {
    // Boards are Kanban task boards — "доска", "lövhə", "kanban".
    pattern: /(?:доск[аиеу]\p{L}*|канбан|\bboard\b|\bboards\b|kanban|lovhe\p{L}*|taxta)/u,
    grounding: { tool: "get_boards_summary" },
  },
  {
    pattern: /(?:лид\p{L}*|\blead\b|\bleads\b|\blid\b|lidler\p{L}*)/u,
    grounding: { tool: "get_leads_summary" },
  },
  {
    pattern: /(?:сделк\p{L}*|сделок|воронк\p{L}*|\bdeal\b|\bdeals\b|opportunit\p{L}*|pipeline|sovdeles\p{L}*|satis\s*bacas\p{L}*)/u,
    grounding: { tool: "get_pipeline_by_stage" },
  },
  {
    pattern: /(?:коммерческ\p{L}*\s+предложен\p{L}*|\bкп\b|котировк\p{L}*|\bquote\b|\bquotes\b|proposal\p{L}*|teklif\p{L}*)/u,
    grounding: { tool: "get_quotes_summary" },
  },
  {
    pattern: /(?:задач\p{L}*|\btask\b|\btasks\b|tapsir\p{L}*)/u,
    grounding: { tool: "get_boards_summary" },
  },
  {
    pattern: /(?:тикет\p{L}*|обращен\p{L}*|\bticket\b|\btickets\b|\bbilet\b|muraciet\p{L}*)/u,
    grounding: { tool: "describe_section", expectedInput: { section: "tickets" } },
  },
  {
    pattern: /(?:входящ\p{L}*\s+сообщен\p{L}*|переписк\p{L}*|\binbox\b|gelen\s+qutu\p{L}*)/u,
    grounding: { tool: "get_inbox_summary" },
  },
]

/**
 * The read tool a current-state question grounds on, or null when the message
 * is a ranking, carries a real period, asks about a past event, or names no
 * entity this CRM can snapshot.
 */
export function currentStateGrounding(message: string): CurrentStateGrounding | null {
  const text = analyticsMatchText(message)
  if (!COUNT_INTENT.test(text)) return null
  if (RANKING_INTENT.test(text)) return null
  if (messageCarriesExplicitPeriod(message)) return null
  if (EVENT_INTENT.test(text)) return null

  const entity = ENTITY_RULES.find((rule) => rule.pattern.test(text))
  if (!entity) return null
  // Overdue cuts across entities and has a single verified snapshot; prefer it
  // over the per-entity summary, which does not carry an overdue figure.
  if (OVERDUE_INTENT.test(text)) return { tool: "get_overdue" }
  return entity.grounding
}

/** True when the model reproduced the arguments the grounded question fixes. */
export function currentStateInputMatches(
  grounding: CurrentStateGrounding,
  input: unknown,
): boolean {
  if (!grounding.expectedInput) return true
  const value = (input ?? {}) as Record<string, unknown>
  // A period argument would turn the snapshot into a different question.
  if ("period" in value && value.period !== undefined) return false
  // The model writes the section as it pleases — "Tickets", "support/tickets".
  // Only the identity matters, not its spelling.
  const identity = (input: unknown) => String(input ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  return Object.entries(grounding.expectedInput)
    .every(([key, expected]) => identity(value[key]).endsWith(identity(expected)))
}

/** Prompt rules that keep a snapshot answer tied to the snapshot it observed. */
export const CURRENT_STATE_GROUNDING_RULES = `
CURRENT-STATE QUESTIONS - answer from the snapshot you just read:
- "How many leads/deals/tasks/quotes do we have" is a question about the CURRENT state, not about a period. Read the matching snapshot tool first and answer from its numbers.
- Say plainly that the figure is the current state ("сейчас", "hazırda", "currently"). Never present it as a period result and never add a period the user did not ask for.
- If the user asked about one slice (new leads, a named board), report that slice from the breakdown the tool returned, and give the total beside it.
- If the tool returned an error or no breakdown, say so. Do not estimate.`
