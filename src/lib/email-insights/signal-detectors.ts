/**
 * Pure email-signal detectors — H6 Phase 3 slice 1.
 *
 * Three deterministic regex sweeps that produce auditable signals
 * regardless of LLM availability. Composed with the LLM-supplied
 * urgency/intent to produce the final insight in `analyzer.ts`.
 *
 * Lists are intentionally narrow — easier to add a keyword than to
 * untangle a too-broad rule that fires on benign phrasing. Adding
 * locale-specific lists (RU, AZ) is a slice-2 task.
 */
import type { EmailSignal, EmailUrgency } from "./types"

/**
 * Whole-word urgency keywords — case-insensitive. Intentionally narrow:
 * we'd rather miss a borderline signal than false-positive on business
 * metaphor (slice 2 will add locale-specific lists). "fire" was
 * considered but rejected — fires on "fire up the campaign" /
 * "fire away with questions" / "fire alarm drill" too often to earn
 * its place at this severity.
 */
const URGENCY_KEYWORDS: readonly string[] = [
  "urgent",
  "asap",
  "emergency",
  "immediately",
  "critical",
  "blocker",
  "outage",
  "down",
  "broken",
  "showstopper",
]

/**
 * Deadline-style phrasing. These are looser than urgency keywords —
 * "by EOD" alone shouldn't escalate to critical, but stacked with
 * "asap" it should.
 */
const DEADLINE_PHRASES: readonly RegExp[] = [
  /\bby\s+(?:eod|end\s+of\s+day|noon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|this\s+week|next\s+week)\b/gi,
  /\bbefore\s+(?:eod|noon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight)\b/gi,
  /\bdue\s+(?:today|tomorrow|tonight|this\s+week|next\s+week|monday|tuesday|wednesday|thursday|friday)\b/gi,
  /\bdeadline\b/gi,
  /\bno\s+later\s+than\b/gi,
]

/**
 * Negative-indicator vocabulary — case-insensitive whole words. "cancel"
 * is intentionally kept despite firing on benign appointment-rescheduling
 * ("can we cancel and reschedule?") — it's strongly correlated with churn
 * signals when stacked with "refund" or sentiment≤negative. Slice 2 will
 * move it to a co-occurrence-weighted list rather than a flat keyword
 * sweep.
 */
const NEGATIVE_INDICATORS: readonly string[] = [
  "frustrated",
  "disappointed",
  "unacceptable",
  "angry",
  "complaint",
  "refund",
  "cancel",
  "terrible",
  "horrible",
  "broken",
  "useless",
  "wasted",
]

/**
 * Cap on persisted signals — JSONB column on EmailLog shouldn't accept
 * a 100-entry array from a pathological transcript. 20 is enough to
 * convey "this email is loaded" without blowing up storage or UI.
 */
export const MAX_SIGNALS = 20

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Whole-word case-insensitive match using lookaround on `\w` so names
 * with non-word edges still anchor correctly (same idiom as the
 * conversation-intel competitor extractor — keep semantics aligned).
 */
function buildWordRegex(words: readonly string[]): RegExp {
  const alt = words.map(escapeRegex).join("|")
  return new RegExp(`(?<!\\w)(?:${alt})(?!\\w)`, "gi")
}

function excerptAround(text: string, match: string, idx: number, radius = 60): string {
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + match.length + radius)
  let out = text.slice(start, end).replace(/\s+/g, " ").trim()
  if (start > 0) out = "…" + out
  if (end < text.length) out = out + "…"
  return out
}

function sweepRegex(
  regex: RegExp,
  kind: EmailSignal["kind"],
  source: EmailSignal["source"],
  text: string
): EmailSignal[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: EmailSignal[] = []
  for (const m of text.matchAll(regex)) {
    const matched = m[0]
    const key = matched.toLowerCase()
    if (seen.has(key)) continue // dedupe — surface each phrase once per source
    seen.add(key)
    out.push({
      kind,
      match: matched,
      excerpt: excerptAround(text, matched, m.index ?? 0),
      source,
    })
  }
  return out
}

/**
 * Detect all signals in a subject + body pair. Returns a deterministic
 * order: urgent_keyword → deadline_phrase → negative_indicator, subject
 * before body within each kind.
 */
export function detectEmailSignals(subject: string, body: string): EmailSignal[] {
  const urgencyRe = buildWordRegex(URGENCY_KEYWORDS)
  const negativeRe = buildWordRegex(NEGATIVE_INDICATORS)

  const urgentSubject = sweepRegex(urgencyRe, "urgent_keyword", "subject", subject)
  const urgentBody = sweepRegex(urgencyRe, "urgent_keyword", "body", body)

  // Deadline regexes have the `g` flag — they're stateful across calls.
  // Clone via source+flags so consecutive scans don't share state.
  const deadlineSubject: EmailSignal[] = []
  const deadlineBody: EmailSignal[] = []
  for (const proto of DEADLINE_PHRASES) {
    deadlineSubject.push(
      ...sweepRegex(new RegExp(proto.source, proto.flags), "deadline_phrase", "subject", subject)
    )
    deadlineBody.push(
      ...sweepRegex(new RegExp(proto.source, proto.flags), "deadline_phrase", "body", body)
    )
  }

  const negativeSubject = sweepRegex(negativeRe, "negative_indicator", "subject", subject)
  const negativeBody = sweepRegex(negativeRe, "negative_indicator", "body", body)

  // Truncate to MAX_SIGNALS — preserves the urgent → deadline → negative
  // priority order so the most actionable kinds survive the cap.
  return [
    ...urgentSubject,
    ...urgentBody,
    ...deadlineSubject,
    ...deadlineBody,
    ...negativeSubject,
    ...negativeBody,
  ].slice(0, MAX_SIGNALS)
}

const URGENCY_ORDER: Record<EmailUrgency, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
}

/**
 * Combine the LLM-suggested urgency with deterministic signals. The
 * caller's LLM picks a baseline; signals can only escalate, never
 * de-escalate — keeps the model honest when a customer literally
 * writes "URGENT: production is down" but the LLM mislabels it.
 *
 * Escalation rules:
 *   ≥2 urgent_keywords + any deadline_phrase  → critical
 *   ≥1 urgent_keyword AND ≥1 negative_indicator → at least high
 *   ≥1 urgent_keyword                          → at least high
 *   ≥1 deadline_phrase                         → at least normal
 */
export function reconcileUrgency(
  llmUrgency: EmailUrgency,
  signals: readonly EmailSignal[]
): EmailUrgency {
  let floor: EmailUrgency = llmUrgency
  const urgent = signals.filter(s => s.kind === "urgent_keyword").length
  const deadline = signals.filter(s => s.kind === "deadline_phrase").length
  const negative = signals.filter(s => s.kind === "negative_indicator").length

  // Each branch goes through `max(floor, X)` so `floor` is monotone-up
  // from `llmUrgency`. Critical-branch goes through `max` too — keeps
  // the rule future-proof if a band is ever inserted above "critical".
  if (urgent >= 2 && deadline >= 1) floor = max(floor, "critical")
  else if (urgent >= 1 && negative >= 1) floor = max(floor, "high")
  else if (urgent >= 1) floor = max(floor, "high")
  else if (deadline >= 1) floor = max(floor, "normal")

  return floor
}

function max(a: EmailUrgency, b: EmailUrgency): EmailUrgency {
  return URGENCY_ORDER[a] >= URGENCY_ORDER[b] ? a : b
}
