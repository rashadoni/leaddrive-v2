/**
 * Inbox AI training (owner 2026-11-15) — the pure part: what is an answer by a person, which
 * question it answered, which answers get a silent AI draft, and how ready the AI is.
 *
 * «режим обучения… При включении для какого-то канала он изучал, как переписывается клиент, на
 * основе этого заполнял характер и базу знаний ИИ… и показывал во время обучения, на сколько
 * процентов… ИИ обучен». The figure he chose (option «В» on the approved mock-up): large — on how
 * many of the latest questions the AI would have answered as the person did; below — how many of the
 * frequent topics it knows.
 *
 * No database and no model here, so the screen can import the constants and the tests can run the
 * rules on plain rows.
 */

/** Knowledge an AI may state, by kind. A price or a discount waits for a person's «Подтвердить». */
export const KNOWLEDGE_TYPES = ["price", "discount", "service", "qa", "place", "hours", "rule", "other"] as const
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number]
export const MONEY_TYPES: ReadonlySet<string> = new Set(["price", "discount"])

/** Character, one row each. */
export const TRAIT_TYPES = ["tone", "address", "length", "language", "emoji", "phrases", "avoid"] as const
export type TraitType = (typeof TRAIT_TYPES)[number]

/** The latest compared questions the readiness figure is read over. */
export const READINESS_WINDOW = 50
/** Below this many compared questions the figure means nothing and is not shown. */
export const READINESS_MIN_QUESTIONS = 30
/** Where the screen says «можно передавать ИИ». A recommendation; the owner decides. */
export const READINESS_TARGET = 80
/** How many frequent topics the second figure counts. */
export const TOPICS_SHOWN = 13
/** Days of history a channel reads when training starts. */
export const LEARNING_BACKFILL_DAYS = 7

/** Verdicts that come from comparing an AI draft with the person's answer. */
export const COMPARED_VERDICTS = ["same", "almost", "different", "handoff"] as const
export type ComparedVerdict = (typeof COMPARED_VERDICTS)[number]
export type SampleVerdict = ComparedVerdict | "skipped" | "no_question" | "failed"

export const DIFF_REASONS = ["no_knowledge", "pending_price", "wrong_fact", "promise", "tone", "other"] as const
export type DiffReason = (typeof DIFF_REASONS)[number]

/**
 * Whether an outbound message was written by a person — in the CRM or in the platform's own app —
 * by the same marks the thread shows under it (lib/inbox/message-author). Only a positive mark
 * counts: an unmarked outbound message may be an automation's, and the AI must not learn from a bot,
 * from itself, or from its own draft a person merely approved.
 */
export function isPersonAnswer(message: { direction: string; body: string | null; metadata: unknown }): boolean {
  if (message.direction !== "outbound") return false
  if (!message.body || !message.body.trim()) return false
  const meta = (message.metadata && typeof message.metadata === "object" ? message.metadata : {}) as Record<string, unknown>
  if (meta.autoReply === true || meta.aiAutoReply === true || meta.aiGenerated === true) return false
  if (meta.authorType === "ai" || meta.aiDraftApproved === true) return false
  // A reply imported from the WhatsApp Business app's history (lib/whatsapp-history-import) is a
  // person's, but the import must set nothing in motion — training spends the AI budget.
  if (meta.historyImport === true) return false
  if (meta.sentFromBusinessApp === true || meta.source === "business_app") return true
  if (typeof meta.authorName === "string" && meta.authorName.trim()) return true
  return meta.authorType === "operator"
}

export type ThreadMessage = {
  id: string
  direction: string
  body: string | null
  metadata: unknown
  createdAt: Date
}

export type AnswerTurn = {
  /** The customer's messages since the previous reply, joined — what the person answered. */
  question: string
  questionMessageId: string
  /** The conversation before the question, as alternating turns ending on the question. */
  history: Array<{ role: "user" | "assistant"; content: string }>
}

const HISTORY_TURNS = 20

/**
 * The question a person's answer replied to: the customer's messages after the last reply (anyone's)
 * and before the answer. Null when the person wrote first — nothing to compare there.
 */
export function answerTurn(thread: readonly ThreadMessage[], answerId: string): AnswerTurn | null {
  const ordered = [...thread].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  const at = ordered.findIndex((m) => m.id === answerId)
  if (at <= 0) return null
  const before = ordered.slice(0, at)
  let start = before.length
  while (start > 0 && before[start - 1].direction === "inbound") start--
  const asked = before.slice(start).filter((m) => (m.body ?? "").trim())
  if (asked.length === 0) return null
  const question = asked.map((m) => (m.body ?? "").trim()).join("\n\n")

  const turns: Array<{ role: "user" | "assistant"; content: string }> = []
  for (const m of before.slice(0, start)) {
    const content = (m.body ?? "").trim()
    if (!content) continue
    const role = m.direction === "inbound" ? "user" : "assistant"
    const last = turns.at(-1)
    if (last?.role === role) last.content = `${last.content}\n\n${content}`
    else turns.push({ role, content })
  }
  turns.push({ role: "user", content: question })
  while (turns[0]?.role === "assistant") turns.shift()
  return { question, questionMessageId: asked.at(-1)!.id, history: turns.slice(-HISTORY_TURNS) }
}

/**
 * The person's whole answer: the message and the ones the same side sent right after it, before the
 * customer wrote again — people often answer in two or three messages.
 */
export function answerText(thread: readonly ThreadMessage[], answerId: string): string {
  const ordered = [...thread].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  const at = ordered.findIndex((m) => m.id === answerId)
  if (at < 0) return ""
  const parts: string[] = []
  for (const m of ordered.slice(at)) {
    if (m.direction !== "outbound") break
    if (m.id !== answerId && !isPersonAnswer(m)) break
    const text = (m.body ?? "").trim()
    if (text) parts.push(text)
  }
  return parts.join("\n")
}

/**
 * «Через один» (owner 2026-11-15, after the price of a silent draft was explained): the AI tries every
 * second question. The first question a channel ever sees is tried. A failed attempt counts as tried,
 * so a model outage does not turn the next question into a second try in a row.
 */
export function shouldDraft(previous: SampleVerdict | null | undefined): boolean {
  return previous == null || previous === "skipped"
}

export type ReadinessSample = {
  verdict: string
  resolution: string | null
  topic: string | null
  reason: string | null
  createdAt: Date
}

export type TopicState = "ok" | "wait" | "no"
export type Readiness = {
  compared: number
  same: number
  almost: number
  different: number
  handoff: number
  /** null until READINESS_MIN_QUESTIONS answers are compared. */
  percent: number | null
  /** The percent at the end of each of the last days that had enough compared answers. */
  trend: Array<{ day: string; percent: number }>
  topics: Array<{ name: string; state: TopicState; count: number }>
  topicsKnown: number
  topicPercent: number | null
}

/**
 * A person's «Ответ ИИ тоже подходит» or «Запомнить ответ сотрудника» makes the answer count as the same.
 * «Пропустить — не учить» (dismissed) takes it out of the figure altogether: the person's answer was no
 * yardstick (a joke, a one-off), so neither «the same» nor «differently» would be true.
 */
export function effectiveVerdict(sample: Pick<ReadinessSample, "verdict" | "resolution">): string {
  return sample.resolution === "accepted" || sample.resolution === "taught" ? "same" : sample.verdict
}

const isCompared = (verdict: string) => (COMPARED_VERDICTS as readonly string[]).includes(verdict)
/** A sample the readiness figure and its topics count. */
export const countsForReadiness = (s: Pick<ReadinessSample, "verdict" | "resolution">) => isCompared(s.verdict) && s.resolution !== "dismissed"

function tally(window: readonly ReadinessSample[]) {
  const counts = { same: 0, almost: 0, different: 0, handoff: 0 }
  for (const s of window) {
    const v = effectiveVerdict(s) as ComparedVerdict
    if (v in counts) counts[v]++
  }
  return counts
}

const dayKey = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)

/**
 * The readiness of one channel from its samples. «Так же» is the figure: an answer «почти так же»
 * is shown but not counted, and a hand-off to a person is shown apart — right on a complaint, but
 * still not an answer the AI gave.
 */
export function computeReadiness(samples: readonly ReadinessSample[], opts: { timeZone?: string; trendDays?: number } = {}): Readiness {
  const timeZone = opts.timeZone || "Asia/Baku"
  const compared = samples
    .filter(countsForReadiness)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const window = compared.slice(0, READINESS_WINDOW)
  const counts = tally(window)
  const percent = window.length >= READINESS_MIN_QUESTIONS ? Math.round((counts.same / window.length) * 100) : null

  // Trend: for each recent day, the figure as it stood at that day's end.
  const trend: Readiness["trend"] = []
  const days = [...new Set(compared.map((s) => dayKey(s.createdAt, timeZone)))].sort().slice(-(opts.trendDays ?? 7))
  for (const day of days) {
    const upTo = compared.filter((s) => dayKey(s.createdAt, timeZone) <= day).slice(0, READINESS_WINDOW)
    if (upTo.length < READINESS_MIN_QUESTIONS) continue
    trend.push({ day, percent: Math.round((tally(upTo).same / upTo.length) * 100) })
  }

  // Topics: the most frequent questions, by the topic the comparison named. Known when the latest
  // answer on it was the same; waiting when the AI held back a price the owner has not confirmed.
  const byTopic = new Map<string, { name: string; count: number; latest: ReadinessSample }>()
  for (const s of compared) {
    const name = (s.topic ?? "").trim()
    if (!name) continue
    const key = name.toLocaleLowerCase()
    const seen = byTopic.get(key)
    if (seen) seen.count++
    else byTopic.set(key, { name, count: 1, latest: s })
  }
  const topics = [...byTopic.values()]
    .sort((a, b) => b.count - a.count || b.latest.createdAt.getTime() - a.latest.createdAt.getTime())
    .slice(0, TOPICS_SHOWN)
    .map(({ name, count, latest }) => {
      const v = effectiveVerdict(latest)
      const state: TopicState = v === "same" || v === "almost" ? "ok" : latest.reason === "pending_price" ? "wait" : "no"
      return { name, state, count }
    })
  const topicsKnown = topics.filter((t) => t.state === "ok").length
  return {
    compared: window.length,
    ...counts,
    percent,
    trend,
    topics,
    topicsKnown,
    topicPercent: percent === null || topics.length === 0 ? null : Math.round((topicsKnown / topics.length) * 100),
  }
}

/** Fold a title for matching: case, Azerbaijani letters and punctuation do not make two topics. */
export function foldTitle(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[əә]/g, "e").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

export function sameAnswer(a: string, b: string): boolean {
  return foldTitle(a) === foldTitle(b)
}

// Re-exported for the screen: a learned row's money-ness decides whether it waits for «Подтвердить».
export const isMoneyType = (type: string) => MONEY_TYPES.has(type)
