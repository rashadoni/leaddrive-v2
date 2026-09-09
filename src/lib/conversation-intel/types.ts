/**
 * Conversation Intelligence types — A7 Phase 3.
 *
 * Salesforce Einstein Conversation Insights analogue: post-call analysis
 * of a Whisper-produced transcript. Extracts sentiment, topics, action
 * items, competitor mentions, and coaching hints.
 *
 * Slice 1 ships the pure extractors + LLM-DI orchestrator. Whisper
 * transcription pipeline (audio URL → transcript) lands in slice 2.
 */

export type Sentiment = "very_positive" | "positive" | "neutral" | "negative" | "very_negative"

export interface ActionItem {
  /** Free-form description of the commitment. */
  text: string
  /** Best-effort attribution — "agent" | "customer" | null. */
  owner: "agent" | "customer" | null
  /** Optional due-by phrase from transcript ("by Friday", "next week"). */
  dueDateHint: string | null
}

export interface CompetitorMention {
  /** Competitor name as matched (preserves source casing for display). */
  name: string
  /** Excerpt of the surrounding utterance for context. */
  context: string
  /** Times the name appeared. */
  count: number
}

export interface CoachingHint {
  /** Stable key for the rule that fired — e.g. `missed_value_prop`. */
  rule: string
  /** Human-readable advice surfaced to the rep's coach. */
  message: string
  /** Severity guides UI: info / warning / critical. */
  severity: "info" | "warning" | "critical"
}

/**
 * Final analysis payload persisted into `CallLog.insights`. Schema
 * versioned so future fields can be added without breaking older rows.
 */
export interface ConversationInsight {
  version: 1
  /** Overall conversation sentiment. */
  sentiment: Sentiment
  /** Numeric sentiment 0-1 from LLM (driver-side). */
  sentimentScore: number
  /** 1-2 sentence summary suitable for activity timeline. */
  summary: string
  /** Topics discussed in the call (3-7 short phrases). */
  topics: string[]
  /** Commitments captured during the call. */
  actionItems: ActionItem[]
  /** Competitors named — derived from regex match against a registry. */
  competitorMentions: CompetitorMention[]
  /** Coaching feedback for the rep. */
  coachingHints: CoachingHint[]
  /** Cost + latency for audit. */
  costUsd?: number
  latencyMs?: number
  /** Model + provider identifier — slice 2 hits multiple Claude tiers. */
  model?: string
}

/* ─── LLM client interface (DI for testability) ───────────────────────── */

export interface AnalyzerLLMResponse {
  sentiment: Sentiment
  sentimentScore: number
  summary: string
  topics: string[]
  actionItems: ActionItem[]
  /** Cost + latency reported by the LLM driver. */
  costUsd?: number
  latencyMs?: number
  model?: string
}

export interface AnalyzerLLMClient {
  /** Analyze a transcript and return the LLM-produced subset. Pure helpers
   * fill in the rule-based fields (competitorMentions, coachingHints). */
  analyzeTranscript(input: AnalyzerInput): Promise<AnalyzerLLMResponse>
}

export interface AnalyzerInput {
  transcript: string
  /** Optional value-prop talking points the rep is expected to mention.
   * Used by the coaching rule that fires when none are detected. */
  expectedValueProps?: string[]
  /** Optional org-specific tone (e.g. "B2B SaaS sales") to nudge the LLM. */
  context?: string
}
