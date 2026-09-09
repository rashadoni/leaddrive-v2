import { classifyAutomaticReviewText } from "@/lib/social/automatic-review-triage"

export type ReviewQueueSentiment = "positive" | "neutral" | "negative" | "unknown"

/**
 * REVIEW envelopes predate the accepted SocialMention row, so they do not yet
 * have a persisted sentiment column. Classify their stored, sanitized text
 * deterministically so the operator's sentiment filter applies to the entire
 * visible worklist without calling an external AI/provider.
 */
export function reviewQueueSentiment(text: unknown): ReviewQueueSentiment {
  if (typeof text !== "string") return "unknown"
  const result = classifyAutomaticReviewText(text, null)
  return result.classification === "irrelevant" ? "unknown" : result.sentiment
}
