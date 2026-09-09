import { describe, expect, it } from "vitest"
import {
  applyRelevanceConfidencePolicy,
  assertValidRelevanceConfidencePolicy,
  DEFAULT_RELEVANCE_CONFIDENCE_POLICY,
  RELEVANCE_CONFIDENCE_POLICY_VERSION,
} from "@/lib/social/relevance-confidence-policy"

const accepted = (confidence: number) => ({
  status: "ACCEPTED" as const,
  reason: "provider_match",
  confidence,
  matchedTerms: ["brand"],
})

describe("relevance confidence policy", () => {
  it("keeps a decision at the auto-accept boundary", () => {
    expect(DEFAULT_RELEVANCE_CONFIDENCE_POLICY).toEqual({
      version: RELEVANCE_CONFIDENCE_POLICY_VERSION,
      minAutoAcceptConfidence: 0.7,
      reviewRetentionDays: 7,
      // Текст отклонённых кандидатов для ИИ-судьи хранится дольше суток, но
      // не бессрочно: срок — настройка, а не константа (#646).
      subjectMatchCandidateRetentionDays: 30,
    })
    expect(applyRelevanceConfidencePolicy(accepted(0.7))).toMatchObject({ status: "ACCEPTED" })
  })

  it("routes low or invalid confidence to review", () => {
    expect(applyRelevanceConfidencePolicy(accepted(0.69))).toMatchObject({
      status: "REVIEW",
      reason: "confidence_below_auto_accept_threshold",
      confidence: 0.69,
    })
    expect(applyRelevanceConfidencePolicy(accepted(Number.NaN))).toMatchObject({
      status: "REVIEW",
      reason: "confidence_invalid",
      confidence: 0,
    })
  })

  it("rejects invalid thresholds instead of silently accepting everything", () => {
    expect(() => assertValidRelevanceConfidencePolicy({
      version: "bad",
      minAutoAcceptConfidence: 1.1,
      reviewRetentionDays: 7,
    })).toThrow("between 0 and 1")
  })
})
