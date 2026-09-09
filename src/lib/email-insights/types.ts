/**
 * Email Insights types — H6 Phase 3 slice 1.
 *
 * Salesforce Einstein Email Insights analogue: per-incoming-email
 * analysis producing sentiment, intent, urgency, and a coaching-style
 * list of detected signals (urgent keywords, deadline phrases, negative
 * indicators). Routes use this to auto-prioritise the inbox and the
 * downstream agent framework consumes the structured fields directly.
 *
 * Slice 1 ships pure deterministic signal detectors + an LLM-DI
 * orchestrator. Slice 2 wires the Anthropic SDK + IMAP-receive webhook.
 */

export type Sentiment = "very_positive" | "positive" | "neutral" | "negative" | "very_negative"

/** Coarse classification of the email's primary purpose. */
export type EmailIntent =
  | "request"        // asking us to do something
  | "question"       // asking for information
  | "complaint"      // dissatisfaction expressed
  | "update"         // FYI / no action expected
  | "appointment"    // scheduling / meeting request
  | "other"

/** Urgency band — drives inbox sorting. */
export type EmailUrgency = "critical" | "high" | "normal" | "low"

/** A deterministic signal pulled from regex sweeps over subject + body. */
export interface EmailSignal {
  /** Stable kind for UI styling: urgent_keyword | deadline_phrase | negative_indicator. */
  kind: "urgent_keyword" | "deadline_phrase" | "negative_indicator"
  /** The matched phrase as it appeared in the email (preserves case). */
  match: string
  /** Short surrounding excerpt for inline display. */
  excerpt: string
  /** Where the match was found. */
  source: "subject" | "body"
}

/** Optional commitment/action surfaced by the LLM. */
export interface SuggestedAction {
  /** Free-form description ("Reply by EOD", "Forward to billing"). */
  text: string
  /** Coarse priority — "high" surfaces as a callout in the UI. */
  priority: "high" | "normal" | "low"
}

/**
 * Final analysis payload persisted onto `EmailLog.insights`. Schema-
 * versioned so older rows survive new fields.
 */
export interface EmailInsight {
  version: 1
  sentiment: Sentiment
  /** Numeric sentiment 0..1 (LLM-supplied for the gauge UI). */
  sentimentScore: number
  intent: EmailIntent
  urgency: EmailUrgency
  /** 1-sentence summary suitable for inbox preview. */
  summary: string
  /** Topics / entities the LLM surfaced (products, places, people). */
  topics: string[]
  /** Deterministic signals merged from rule-based detectors. */
  signals: EmailSignal[]
  /** Action items suggested by the LLM (deduped, max ~5). */
  suggestedActions: SuggestedAction[]
  /** Cost + latency for audit. */
  costUsd?: number
  latencyMs?: number
  /** Model + provider identifier — slice 2 hits multiple Claude tiers. */
  model?: string
}

/* ─── LLM client interface (DI for testability) ───────────────────────── */

export interface EmailAnalyzerInput {
  subject: string
  body: string
  /** Free-form context (e.g. "B2B SaaS — incoming support email"). */
  context?: string
  /**
   * Optional org-specific tone hint that helps the LLM grade urgency
   * (e.g. "internal IT helpdesk — escalate any prod outage mention").
   */
  toneHints?: string[]
}

export interface EmailAnalyzerLLMResponse {
  sentiment: Sentiment
  sentimentScore: number
  intent: EmailIntent
  urgency: EmailUrgency
  summary: string
  topics: string[]
  suggestedActions: SuggestedAction[]
  costUsd?: number
  latencyMs?: number
  model?: string
}

export interface EmailAnalyzerLLMClient {
  /** Analyze an email and return the LLM-produced subset. Pure helpers
   * fill in rule-based signals (deterministic urgency keywords,
   * deadline phrases, negative indicators). */
  analyzeEmail(input: EmailAnalyzerInput): Promise<EmailAnalyzerLLMResponse>
}
