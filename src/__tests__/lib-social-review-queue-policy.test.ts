import { describe, expect, it } from "vitest"
import {
  AUTOMATIC_REVIEW_COMMENT_CONTENT_KINDS,
  AUTOMATIC_REVIEW_DISCOVERY_CONTENT_KINDS,
  AUTOMATIC_REVIEW_SENTIMENT_UNRESOLVED_REASON,
  INTERNAL_REVIEW_CONTEXT_REASON,
  isOperatorActionableReviewEnvelope,
  operatorActionableReviewReasonWhere,
} from "@/lib/social/review-queue-policy"
import {
  AUTOMATIC_REVIEW_COMMENT_REASONS,
  AUTOMATIC_REVIEW_DISCOVERY_REASONS,
  AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
} from "@/lib/social/automatic-review-triage"

describe("social review queue policy", () => {
  it("keeps worker-owned reason and content-kind shapes out of the operator queue", () => {
    for (const reason of AUTOMATIC_REVIEW_COMMENT_REASONS) {
      for (const contentKind of AUTOMATIC_REVIEW_COMMENT_CONTENT_KINDS) {
        expect(isOperatorActionableReviewEnvelope({ relevanceReason: reason, contentKind })).toBe(false)
      }
    }
    for (const reason of AUTOMATIC_REVIEW_DISCOVERY_REASONS) {
      for (const contentKind of AUTOMATIC_REVIEW_DISCOVERY_CONTENT_KINDS) {
        expect(isOperatorActionableReviewEnvelope({ relevanceReason: reason, contentKind })).toBe(false)
      }
    }
    expect(isOperatorActionableReviewEnvelope({
      relevanceReason: INTERNAL_REVIEW_CONTEXT_REASON,
      contentKind: "COMMENT",
    })).toBe(false)
    expect(isOperatorActionableReviewEnvelope({
      relevanceReason: AUTOMATIC_REVIEW_SENTIMENT_UNRESOLVED_REASON,
      contentKind: "VIDEO",
    })).toBe(false)
    expect(operatorActionableReviewReasonWhere()).toEqual(expect.objectContaining({
      AND: [
        { NOT: { contentKind: { in: [...AUTOMATIC_REVIEW_COMMENT_CONTENT_KINDS] } } },
        expect.objectContaining({
          OR: [
            { relevanceReason: null },
            expect.objectContaining({
              relevanceReason: { not: null },
              NOT: expect.objectContaining({ OR: expect.any(Array) }),
            }),
          ],
        }),
      ],
    }))
  })

  it("retains manual and unsupported worker shapes while quarantining technical rows", () => {
    expect(isOperatorActionableReviewEnvelope({ relevanceReason: null, contentKind: "POST" })).toBe(true)
    expect(isOperatorActionableReviewEnvelope({
      relevanceReason: "manual_review_required",
      contentKind: "POST",
    })).toBe(true)
    expect(isOperatorActionableReviewEnvelope({
      relevanceReason: "manual_review_required",
      contentKind: "COMMENT",
    })).toBe(false)
    expect(isOperatorActionableReviewEnvelope({
      relevanceReason: "manual_review_required",
      contentKind: "comment",
    })).toBe(true)
    expect(isOperatorActionableReviewEnvelope({
      relevanceReason: "discovery_snippet_only_match",
      contentKind: "ARTICLE",
    })).toBe(true)
    expect(isOperatorActionableReviewEnvelope({
      relevanceReason: "comment_sentiment_requires_review",
      contentKind: "POST",
    })).toBe(true)
    expect(isOperatorActionableReviewEnvelope({
      relevanceReason: "discovery_snippet_only_match",
      contentKind: "post",
    })).toBe(true)
    expect(isOperatorActionableReviewEnvelope({
      relevanceReason: "discovery_snippet_only_match",
      contentKind: " POST ",
    })).toBe(true)
    expect(isOperatorActionableReviewEnvelope({
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      contentKind: "COMMENT",
    })).toBe(false)
  })
})
