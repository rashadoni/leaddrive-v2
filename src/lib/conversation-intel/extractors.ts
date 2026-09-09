/**
 * Conversation Intelligence pure extractors — A7 Phase 3.
 *
 * Rule-based companions to the LLM analyzer. These run deterministically
 * over the transcript so the LLM call doesn't have to do everything; the
 * resulting facts are merged into the final `ConversationInsight`.
 *
 * Pure, synchronous, no I/O. Two extractors:
 *   1. `extractCompetitorMentions(transcript, registry)` — case-insensitive
 *      whole-word matches against a known competitor name list.
 *   2. `evaluateCoachingHints({ transcript, valueProps, sentiment, ... })`
 *      — produces actionable rep coaching tips (missed value prop,
 *      negative customer reaction, dead-air gap, etc.).
 */
import type { CoachingHint, CompetitorMention, Sentiment } from "./types"

/* ─── Competitor mentions ─────────────────────────────────────────────── */

export function extractCompetitorMentions(
  transcript: string,
  competitors: string[]
): CompetitorMention[] {
  if (!transcript || competitors.length === 0) return []

  const result: CompetitorMention[] = []
  for (const raw of competitors) {
    const name = raw.trim()
    if (!name) continue

    // Whole-word match, case-insensitive, escapes special chars.
    // Use lookaround on \w so non-word boundaries on the name itself
    // (e.g. names with trailing ")") still anchor correctly — \b alone
    // fails when the surrounding char and the name's edge are both non-word.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const re = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "gi")

    const matches = [...transcript.matchAll(re)]
    if (matches.length === 0) continue

    // Build context excerpt from first match.
    const first = matches[0]
    const idx = first.index ?? 0
    const start = Math.max(0, idx - 60)
    const end = Math.min(transcript.length, idx + name.length + 60)
    let context = transcript.slice(start, end).replace(/\s+/g, " ").trim()
    if (start > 0) context = "…" + context
    if (end < transcript.length) context = context + "…"

    result.push({
      name,
      context,
      count: matches.length,
    })
  }
  return result
}

/**
 * Whole-word case-insensitive containment check — same boundary semantics
 * as `extractCompetitorMentions`, exposed so coaching rules don't fall
 * back to naive substring matching (e.g. "AI" in "available").
 */
function transcriptMentions(transcript: string, phrase: string): boolean {
  const trimmed = phrase.trim()
  if (!trimmed) return false
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "i").test(transcript)
}

/* ─── Coaching hints ──────────────────────────────────────────────────── */

export interface CoachingEvaluationInput {
  transcript: string
  sentiment: Sentiment
  /** Value-prop phrases the rep was expected to mention. Empty disables rule. */
  expectedValueProps?: string[]
  /** Total call duration in seconds, if known. */
  durationSeconds?: number
  /** Number of competitor mentions surfaced by `extractCompetitorMentions`. */
  competitorMentionCount?: number
}

const DEFAULT_MIN_REP_DURATION = 60 // calls shorter than this skip "no value prop" rule

/**
 * Apply rule-based coaching heuristics. Each rule is intentionally narrow —
 * easier to add new rules than tune broad ones. Returns a stable order.
 */
export function evaluateCoachingHints(input: CoachingEvaluationInput): CoachingHint[] {
  const hints: CoachingHint[] = []
  const transcript = input.transcript ?? ""

  // Rule 1: rep failed to mention any expected value prop on a non-trivial call.
  if (
    Array.isArray(input.expectedValueProps) &&
    input.expectedValueProps.length > 0 &&
    (input.durationSeconds ?? Infinity) >= DEFAULT_MIN_REP_DURATION
  ) {
    // Whole-word match per `transcriptMentions` — prevents "AI" → "available"
    // false positives that would silently suppress the coaching hint.
    const missing = input.expectedValueProps.filter(vp =>
      !transcriptMentions(transcript, vp)
    )
    if (missing.length === input.expectedValueProps.length) {
      hints.push({
        rule: "missed_value_prop",
        message: `None of the ${missing.length} expected value props were mentioned: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`,
        severity: "warning",
      })
    } else if (missing.length > 0) {
      hints.push({
        rule: "partial_value_prop",
        message: `Missed ${missing.length} value prop(s): ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`,
        severity: "info",
      })
    }
  }

  // Rule 2: very negative customer sentiment → manager attention.
  if (input.sentiment === "very_negative") {
    hints.push({
      rule: "negative_sentiment",
      message: "Customer sentiment was very negative — consider escalation or follow-up call.",
      severity: "critical",
    })
  } else if (input.sentiment === "negative") {
    hints.push({
      rule: "negative_sentiment",
      message: "Customer sentiment leaned negative — review next-step plan.",
      severity: "warning",
    })
  }

  // Rule 3: competitor mentioned → loop in product marketing battlecards.
  if ((input.competitorMentionCount ?? 0) > 0) {
    hints.push({
      rule: "competitor_mentioned",
      message: `Customer brought up ${input.competitorMentionCount} competitor mention(s) — pull the relevant battlecard for next-step talk.`,
      severity: "info",
    })
  }

  // Rule 4: extremely short call duration — likely cut off or wrong number.
  if ((input.durationSeconds ?? Infinity) < 30 && transcript.length < 200) {
    hints.push({
      rule: "short_call",
      message: "Call < 30s with minimal transcript — verify wasn't a wrong number or dropped connection.",
      severity: "info",
    })
  }

  return hints
}
