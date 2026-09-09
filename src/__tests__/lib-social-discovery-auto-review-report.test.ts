import { describe, expect, it } from "vitest"
import {
  buildDiscoveryAutoReviewReport,
  type DiscoveryAutoReviewCandidate,
  type DiscoveryAutoReviewSubject,
} from "@/lib/social/discovery-auto-review-report"

const subject: DiscoveryAutoReviewSubject = {
  id: "subject-1",
  name: "Baku Electronics",
  aliases: [
    { kind: "NAME", value: "Baku Electronics", isNegative: false },
    { kind: "DOMAIN", value: "bakuelectronics.az", isNegative: false },
    { kind: "CONTEXT", value: "electronics", isNegative: false },
    { kind: "NEGATIVE", value: "unrelated", isNegative: true },
  ],
  sources: [
    {
      relationType: "OFFICIAL",
      source: { url: "https://shop.bakuelectronics.az" },
    },
    {
      relationType: "OFFICIAL",
      source: { url: "https://facebook.com/bakuelectronics" },
    },
  ],
}

const providerInputSnapshot = {
  leadDriveProviderWindow: {
    since: "2026-07-16T12:00:00.000Z",
    until: "2026-07-23T12:00:00.000Z",
  },
}

function candidate(
  id: string,
  overrides: Partial<DiscoveryAutoReviewCandidate> = {},
): DiscoveryAutoReviewCandidate {
  return {
    id,
    url: `https://news.example/posts/${id}`,
    canonicalUrl: null,
    publishedAt: "2026-07-22T12:00:00.000Z",
    relevanceReason: "discovery_snippet_only_match",
    rawPayload: { title: "Baku Electronics campaign" },
    policySnapshot: {},
    providerInputSnapshot,
    subjectDecision: {
      status: "ACCEPTED",
      reason: "subject_alias_match",
      confidence: 1,
      matches: [
        {
          subjectId: "subject-1",
          status: "MATCHED",
          reason: "subject_alias_match",
          confidence: 1,
        },
      ],
    },
    contentHmac: `hmac-${id}`,
    updatedAt: "2026-07-23T15:00:00.000Z",
    purgeAt: "2026-07-30T15:00:00.000Z",
    relevanceConfidence: 0.4,
    decidedAt: "2026-07-23T12:00:00.000Z",
    matchedSubjectIds: ["subject-1"],
    priorAutoReviewState: null,
    ...overrides,
  }
}

describe("buildDiscoveryAutoReviewReport", () => {
  it("keeps the plan fingerprint stable as the preview clock advances", () => {
    const candidates = [
      candidate("stale", {
        publishedAt: "2026-07-01T00:00:00.000Z",
        relevanceReason: "discovery_outside_lookback_window",
      }),
    ]
    const first = buildDiscoveryAutoReviewReport({
      subject,
      candidates,
      generatedAt: new Date("2026-07-23T16:00:00.000Z"),
    })
    const second = buildDiscoveryAutoReviewReport({
      subject,
      candidates,
      generatedAt: new Date("2026-07-23T16:01:00.000Z"),
    })

    expect(second.apply.rollbackUntil).not.toBe(first.apply.rollbackUntil)
    expect(second.apply.planFingerprint).toBe(first.apply.planFingerprint)
  })

  it("groups canonical duplicates and reports one deterministic decision per candidate", () => {
    const report = buildDiscoveryAutoReviewReport({
      subject,
      generatedAt: new Date("2026-07-23T16:00:00.000Z"),
      candidates: [
        candidate("fresh"),
        candidate("stale", {
          url: "https://old.example/posts/baku",
          publishedAt: "2026-07-01T00:00:00.000Z",
          relevanceReason: "discovery_outside_lookback_window",
        }),
        candidate("duplicate-stale", {
          url: "https://old.example/posts/baku?utm_source=search",
          publishedAt: "2026-07-01T00:00:00.000Z",
          relevanceReason: "discovery_outside_lookback_window",
        }),
        candidate("profile", {
          url: "https://instagram.com/bakuelectronics",
        }),
        candidate("uncertain", {
          url: "https://news.example/posts/unknown-date",
          publishedAt: null,
          relevanceReason: "discovery_missing_published_at",
        }),
      ],
    })

    expect(report).toMatchObject({
      resolverVersion: "discovery_auto_review_v1",
      subjectId: "subject-1",
      totalRows: 5,
      uniqueCandidates: 4,
      duplicateRows: 1,
      decisions: {
        reject: 2,
        release: 1,
        review: 1,
      },
      reasonBreakdown: [
        { reason: "discovery_auto_review_outside_provider_window", count: 1 },
        { reason: "discovery_auto_review_profile_or_channel", count: 1 },
        { reason: "discovery_auto_review_fresh_independent_identity", count: 1 },
        { reason: "discovery_auto_review_missing_publish_date", count: 1 },
      ].sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
      apply: {
        mode: "REJECT_ONLY",
        eligibleLinks: 2,
        eligibleRows: 3,
        protectedSharedLinks: 0,
        protectedSharedRows: 0,
        protectedPreviousDecisionLinks: 0,
        protectedPreviousDecisionRows: 0,
        protectedRetentionLinks: 0,
        protectedRetentionRows: 0,
        rollbackUntil: "2026-07-24T16:00:00.000Z",
      },
      safeApply: {
        mode: "SAFE_RESOLVE",
        eligibleLinks: 3,
        eligibleRows: 4,
        rejectLinks: 2,
        rejectRows: 3,
        releaseLinks: 1,
        releaseRows: 1,
        protectedMixedLinks: 0,
        protectedMixedRows: 0,
        protectedSharedLinks: 0,
        protectedSharedRows: 0,
        protectedStoredDecisionLinks: 0,
        protectedStoredDecisionRows: 0,
        protectedPreviousDecisionLinks: 0,
        protectedPreviousDecisionRows: 0,
        protectedRetentionLinks: 0,
        protectedRetentionRows: 0,
        rollbackUntil: "2026-07-24T16:00:00.000Z",
      },
      generatedAt: "2026-07-23T16:00:00.000Z",
    })
    expect(report.apply.planFingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(report.safeApply.planFingerprint).toBe(report.apply.planFingerprint)
    expect(
      report.decisions.reject + report.decisions.release + report.decisions.review,
    ).toBe(report.uniqueCandidates)
  })

  it("keeps a duplicate group in review when one copy remains uncertain", () => {
    const report = buildDiscoveryAutoReviewReport({
      subject,
      candidates: [
        candidate("stale", {
          url: "https://news.example/posts/same",
          publishedAt: "2026-07-01T00:00:00.000Z",
          relevanceReason: "discovery_outside_lookback_window",
        }),
        candidate("unknown", {
          url: "https://news.example/posts/same?fbclid=tracking",
          publishedAt: null,
          relevanceReason: "discovery_missing_published_at",
        }),
      ],
    })

    expect(report).toMatchObject({
      totalRows: 2,
      uniqueCandidates: 1,
      duplicateRows: 1,
      decisions: { reject: 0, release: 0, review: 1 },
      reasonBreakdown: [
        { reason: "discovery_auto_review_missing_publish_date", count: 1 },
      ],
      safeApply: {
        eligibleLinks: 0,
        eligibleRows: 0,
        protectedMixedLinks: 1,
        protectedMixedRows: 2,
      },
    })
  })

  it("preserves the same story at different URLs as separate distribution signals", () => {
    const report = buildDiscoveryAutoReviewReport({
      subject,
      candidates: [
        candidate("publisher-a", {
          url: "https://publisher-a.example/news/baku-electronics-campaign",
          canonicalUrl: "https://wire.example/original/baku-electronics-campaign",
          rawPayload: { title: "Baku Electronics opens a new store" },
        }),
        candidate("publisher-b", {
          url: "https://publisher-b.example/shared/baku-electronics-campaign",
          canonicalUrl: "https://wire.example/original/baku-electronics-campaign",
          rawPayload: { title: "Baku Electronics opens a new store" },
        }),
      ],
    })

    expect(report).toMatchObject({
      totalRows: 2,
      uniqueCandidates: 2,
      duplicateRows: 0,
      decisions: { reject: 0, release: 2, review: 0 },
      safeApply: {
        releaseLinks: 2,
        releaseRows: 2,
      },
    })
  })

  it("fails closed when the frozen provider window is unavailable", () => {
    const report = buildDiscoveryAutoReviewReport({
      subject,
      candidates: [
        candidate("missing-window", {
          providerInputSnapshot: {},
          policySnapshot: {},
        }),
      ],
    })

    expect(report).toMatchObject({
      decisions: { reject: 0, release: 0, review: 1 },
      reasonBreakdown: [
        { reason: "discovery_auto_review_invalid_provider_window", count: 1 },
      ],
    })
  })

  it("treats configured owned domains as non-independent evidence", () => {
    const report = buildDiscoveryAutoReviewReport({
      subject,
      candidates: [
        candidate("owned", {
          url: "https://news.shop.bakuelectronics.az/releases/new-store",
        }),
      ],
    })

    expect(report).toMatchObject({
      decisions: { reject: 1, release: 0, review: 0 },
      reasonBreakdown: [
        { reason: "discovery_auto_review_official_domain", count: 1 },
      ],
    })
  })

  it("does not treat an entire shared social platform as an official host", () => {
    const report = buildDiscoveryAutoReviewReport({
      subject,
      candidates: [
        candidate("external-facebook-post", {
          url: "https://facebook.com/independent.publisher/posts/123",
        }),
      ],
    })

    expect(report).toMatchObject({
      decisions: { reject: 0, release: 1, review: 0 },
    })
  })

  it("protects a globally shared envelope from subject-scoped rejection", () => {
    const report = buildDiscoveryAutoReviewReport({
      subject,
      candidates: [
        candidate("shared-stale", {
          publishedAt: "2026-07-01T00:00:00.000Z",
          relevanceReason: "discovery_outside_lookback_window",
          matchedSubjectIds: ["subject-1", "subject-2"],
        }),
      ],
    })

    expect(report).toMatchObject({
      decisions: { reject: 1, release: 0, review: 0 },
      apply: {
        eligibleLinks: 0,
        eligibleRows: 0,
        protectedSharedLinks: 1,
        protectedSharedRows: 1,
      },
      safeApply: {
        eligibleLinks: 0,
        eligibleRows: 0,
        protectedSharedLinks: 1,
        protectedSharedRows: 1,
      },
    })
  })

  it("keeps an operator-rolled-back decision in review for the same resolver version", () => {
    const report = buildDiscoveryAutoReviewReport({
      subject,
      candidates: [
        candidate("rolled-back-stale", {
          publishedAt: "2026-07-01T00:00:00.000Z",
          relevanceReason: "discovery_outside_lookback_window",
          priorAutoReviewState: "ROLLED_BACK",
        }),
      ],
    })

    expect(report).toMatchObject({
      decisions: { reject: 0, release: 0, review: 1 },
      reasonBreakdown: [
        { reason: "discovery_auto_review_previous_decision", count: 1 },
      ],
      apply: {
        eligibleLinks: 0,
        eligibleRows: 0,
        protectedPreviousDecisionLinks: 1,
        protectedPreviousDecisionRows: 1,
      },
      safeApply: {
        eligibleLinks: 0,
        eligibleRows: 0,
        protectedPreviousDecisionLinks: 1,
        protectedPreviousDecisionRows: 1,
      },
    })
  })

  it("does not offer apply when retention cannot preserve a meaningful rollback window", () => {
    const report = buildDiscoveryAutoReviewReport({
      subject,
      generatedAt: new Date("2026-07-23T16:00:00.000Z"),
      candidates: [
        candidate("expiring-stale", {
          publishedAt: "2026-07-01T00:00:00.000Z",
          relevanceReason: "discovery_outside_lookback_window",
          purgeAt: "2026-07-23T16:10:00.000Z",
        }),
      ],
    })

    expect(report).toMatchObject({
      decisions: { reject: 1, release: 0, review: 0 },
      apply: {
        eligibleLinks: 0,
        eligibleRows: 0,
        protectedRetentionLinks: 1,
        protectedRetentionRows: 1,
        rollbackUntil: null,
      },
      safeApply: {
        eligibleLinks: 0,
        eligibleRows: 0,
        protectedRetentionLinks: 1,
        protectedRetentionRows: 1,
        rollbackUntil: null,
      },
    })
  })
})
