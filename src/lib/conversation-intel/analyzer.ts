/**
 * Conversation Intelligence orchestrator — A7 Phase 3.
 *
 * `analyzeTranscript({ llm, transcript, competitors, valueProps, ... })`
 * runs the DI'd LLM client for the bulk of the analysis (sentiment,
 * summary, topics, action items), then merges deterministic rule-based
 * extractors for competitor mentions and coaching hints.
 *
 * Pure async — no Prisma here. Caller fetches transcript + competitors
 * from the DB and persists the result into `CallLog.insights`.
 */
import {
  extractCompetitorMentions,
  evaluateCoachingHints,
} from "./extractors"
import type {
  AnalyzerLLMClient,
  ConversationInsight,
} from "./types"

export interface AnalyzeInput {
  llm: AnalyzerLLMClient
  transcript: string
  /** Known competitor names — typically loaded from Organization.settings. */
  competitors?: string[]
  /** Value-prop talking points the rep was expected to mention. */
  expectedValueProps?: string[]
  /** Call duration in seconds — used by coaching rules. */
  durationSeconds?: number
  /** Org-specific tone hint passed through to the LLM. */
  context?: string
}

export async function analyzeTranscript(input: AnalyzeInput): Promise<ConversationInsight> {
  if (!input.transcript || input.transcript.trim().length === 0) {
    // Empty transcript — return a minimal sentinel insight so caller can
    // distinguish "never analysed" (null) from "analysed but nothing to
    // analyse" (this).
    return {
      version: 1,
      sentiment: "neutral",
      sentimentScore: 0.5,
      summary: "(empty transcript)",
      topics: [],
      actionItems: [],
      competitorMentions: [],
      coachingHints: [],
    }
  }

  // 1. Hit the LLM for the parts that need natural-language understanding.
  const llmResult = await input.llm.analyzeTranscript({
    transcript: input.transcript,
    expectedValueProps: input.expectedValueProps,
    context: input.context,
  })

  // 2. Run deterministic extractors on the same transcript.
  const competitorMentions = extractCompetitorMentions(
    input.transcript,
    input.competitors ?? []
  )
  const coachingHints = evaluateCoachingHints({
    transcript: input.transcript,
    sentiment: llmResult.sentiment,
    expectedValueProps: input.expectedValueProps,
    durationSeconds: input.durationSeconds,
    competitorMentionCount: competitorMentions.length,
  })

  return {
    version: 1,
    sentiment: llmResult.sentiment,
    sentimentScore: llmResult.sentimentScore,
    summary: llmResult.summary,
    topics: llmResult.topics,
    actionItems: llmResult.actionItems,
    competitorMentions,
    coachingHints,
    costUsd: llmResult.costUsd,
    latencyMs: llmResult.latencyMs,
    model: llmResult.model,
  }
}
