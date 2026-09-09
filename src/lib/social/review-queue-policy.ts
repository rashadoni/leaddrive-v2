import type { Prisma } from "@prisma/client"
import {
  AUTOMATIC_REVIEW_DISCOVERY_REASONS,
  AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
} from "@/lib/social/automatic-review-triage"

export const INTERNAL_REVIEW_CONTEXT_REASON = "thread_context_for_actionable_descendant"
export const AUTOMATIC_REVIEW_SENTIMENT_UNRESOLVED_REASON = "automatic_review_sentiment_unresolved"

/**
 * These rows belong to the automatic review worker, not an operator. They may
 * exist briefly between scheduler ticks, or remain as a technical quarantine
 * record for audit, but neither state is useful manual work.
 */
export const AUTOMATIC_REVIEW_COMMENT_CONTENT_KINDS = ["COMMENT", "REPLY"] as const
export const AUTOMATIC_REVIEW_DISCOVERY_CONTENT_KINDS = [
  "POST",
  "MENTION",
  "VIDEO",
  "IMAGE",
  "AUDIO",
] as const
export const TERMINAL_REVIEW_QUARANTINE_REASONS = [
  AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
  AUTOMATIC_REVIEW_SENTIMENT_UNRESOLVED_REASON,
] as const

const AUTOMATIC_REVIEW_DISCOVERY_REASON_SET = new Set<string>(AUTOMATIC_REVIEW_DISCOVERY_REASONS)
const AUTOMATIC_REVIEW_COMMENT_KIND_SET = new Set<string>(AUTOMATIC_REVIEW_COMMENT_CONTENT_KINDS)
const AUTOMATIC_REVIEW_DISCOVERY_KIND_SET = new Set<string>(AUTOMATIC_REVIEW_DISCOVERY_CONTENT_KINDS)
const TERMINAL_REVIEW_QUARANTINE_REASON_SET = new Set<string>(TERMINAL_REVIEW_QUARANTINE_REASONS)

export function isOperatorActionableReviewEnvelope(input: {
  relevanceReason: string | null | undefined
  contentKind: string | null | undefined
}): boolean {
  const reason = input.relevanceReason
  // Keep this exact-value comparison aligned with the worker selector and the
  // Prisma/raw-SQL queue predicates. Malformed legacy values stay actionable
  // instead of being hidden from operators without a worker that can own them.
  const contentKind = input.contentKind ?? ""
  // Every normalized comment/reply is owned by the automatic risk gate. It
  // rejects praise, admits relevant negative/neutral text, and terminally
  // suppresses unresolved subject evidence; operators never need to triage it.
  if (AUTOMATIC_REVIEW_COMMENT_KIND_SET.has(contentKind)) return false
  if (reason === INTERNAL_REVIEW_CONTEXT_REASON) return false
  if (TERMINAL_REVIEW_QUARANTINE_REASON_SET.has(reason ?? "")) return false
  if (
    AUTOMATIC_REVIEW_DISCOVERY_REASON_SET.has(reason ?? "")
    && AUTOMATIC_REVIEW_DISCOVERY_KIND_SET.has(contentKind)
  ) return false
  return true
}

export function operatorActionableReviewReasonWhere(): Prisma.IngestEnvelopeWhereInput {
  return {
    AND: [
      { NOT: { contentKind: { in: [...AUTOMATIC_REVIEW_COMMENT_CONTENT_KINDS] } } },
      {
        // SQL's three-valued logic makes NOT(comparison) false-ish for NULL.
        // Preserve reason-less non-comment legacy rows as operator work.
        OR: [
          { relevanceReason: null },
          {
            relevanceReason: { not: null },
            NOT: {
              OR: [
                { relevanceReason: INTERNAL_REVIEW_CONTEXT_REASON },
                { relevanceReason: { in: [...TERMINAL_REVIEW_QUARANTINE_REASONS] } },
                {
                  relevanceReason: { in: [...AUTOMATIC_REVIEW_DISCOVERY_REASONS] },
                  contentKind: { in: [...AUTOMATIC_REVIEW_DISCOVERY_CONTENT_KINDS] },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}
