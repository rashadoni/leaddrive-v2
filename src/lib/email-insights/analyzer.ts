/**
 * Email-analysis orchestrator — H6 Phase 3 slice 1.
 *
 * Compose deterministic signal detection with an LLM-supplied
 * sentiment/intent/urgency/summary into one `EmailInsight` payload.
 *
 * The LLM client is dependency-injected so the route can wire a real
 * Anthropic client and tests can wire a deterministic mock. Slice 1's
 * route ships a PLACEHOLDER_LLM sentinel — slice 2 connects the SDK.
 */
import { detectEmailSignals, reconcileUrgency } from "./signal-detectors"
import type {
  EmailAnalyzerLLMClient,
  EmailInsight,
  EmailSignal,
} from "./types"

export interface AnalyzeEmailInput {
  llm: EmailAnalyzerLLMClient
  subject: string
  body: string
  /** Optional free-form context for the LLM. */
  context?: string
  /** Optional org-specific tone hints. */
  toneHints?: string[]
}

/**
 * Run the full email-analysis pipeline. Returns a versioned insight
 * suitable for persisting onto `EmailLog.insights`.
 *
 * Skips the LLM call entirely when both subject and body are empty —
 * keeps cost predictable when a webhook delivers an empty payload.
 */
export async function analyzeEmail(input: AnalyzeEmailInput): Promise<EmailInsight> {
  const subject = (input.subject ?? "").trim()
  const body = (input.body ?? "").trim()

  if (!subject && !body) {
    return {
      version: 1,
      sentiment: "neutral",
      sentimentScore: 0.5,
      intent: "other",
      urgency: "low",
      summary: "(empty email)",
      topics: [],
      signals: [],
      suggestedActions: [],
    }
  }

  const signals: EmailSignal[] = detectEmailSignals(subject, body)

  const llmResult = await input.llm.analyzeEmail({
    subject,
    body,
    context: input.context,
    toneHints: input.toneHints,
  })

  const urgency = reconcileUrgency(llmResult.urgency, signals)

  return {
    version: 1,
    sentiment: llmResult.sentiment,
    sentimentScore: llmResult.sentimentScore,
    intent: llmResult.intent,
    urgency,
    summary: llmResult.summary,
    topics: llmResult.topics,
    signals,
    suggestedActions: llmResult.suggestedActions,
    costUsd: llmResult.costUsd,
    latencyMs: llmResult.latencyMs,
    model: llmResult.model,
  }
}
