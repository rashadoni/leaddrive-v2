import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  replayIngestEnvelope: vi.fn(),
  aiSentimentDetailed: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { ingestEnvelope: { findMany: deps.findMany, updateMany: deps.updateMany } },
}))
vi.mock("@/lib/social/ingest-envelope-replay", () => ({
  replayIngestEnvelope: deps.replayIngestEnvelope,
}))
vi.mock("@/lib/sentiment", () => ({ aiSentimentDetailed: deps.aiSentimentDetailed }))

import { autoTriageStoredReviewEnvelopes } from "@/lib/social/automatic-review-backfill"
import {
  AUTOMATIC_REVIEW_AI_VERSION,
  AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE,
  AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
  AUTOMATIC_REVIEW_DISCOVERY_REASONS,
  AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
  AUTOMATIC_REVIEW_TRIAGE_VERSION,
  AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY,
  AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_VERSION,
  AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
  AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
} from "@/lib/social/automatic-review-triage"

const now = new Date("2026-08-02T09:00:00.000Z")
const purgeAt = new Date("2026-08-09T09:00:00.000Z")

function candidate(id: string, text: string, organizationId = "org-1") {
  return {
    id,
    organizationId,
    text,
    contentHmac: `hmac-${id}`,
    updatedAt: new Date("2026-08-02T08:00:00.000Z"),
    purgeAt,
    relevanceReason: "comment_on_verified_brand_parent",
    contentKind: "COMMENT",
    policySnapshot: {},
  }
}

function recoverableTechnicalPolicySnapshot(extra: Record<string, unknown> = {}) {
  return {
    automaticReviewTriage: {
      version: AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_VERSION,
      resolved: false,
      originalReason: "comment_on_verified_brand_parent",
      decisionReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      classifierSource: "AI",
      classifierVersion: AUTOMATIC_REVIEW_AI_VERSION,
      classifierEvidence: AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE,
      attemptedAt: "2026-08-02T08:30:00.000Z",
    },
    replayResolution: {
      action: "automatic_review_unresolved",
      originalRelevance: {
        reason: "comment_on_verified_brand_parent",
      },
    },
    ...extra,
  }
}

function recoverableV3DiscoveryPolicySnapshot(extra: Record<string, unknown> = {}) {
  return {
    automaticReviewTriage: {
      version: AUTOMATIC_REVIEW_TRIAGE_VERSION,
      resolved: false,
      originalReason: "discovery_snippet_only_match",
      decisionStatus: "REVIEW",
      decisionReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      classification: "unknown",
      sentiment: "unknown",
      classifierSource: "AI",
      classifierVersion: AUTOMATIC_REVIEW_AI_VERSION,
      classifierEvidence: "technical_evidence_unresolved",
      providerFetchPerformed: false,
      attemptedAt: "2026-08-02T08:30:00.000Z",
    },
    replayResolution: {
      version: "stored-envelope-replay-v1",
      action: "automatic_review_unresolved",
      originalRelevance: {
        status: "REVIEW",
        reason: "discovery_snippet_only_match",
      },
      providerFetchPerformed: false,
    },
    ...extra,
  }
}

const recoverableTechnicalWhere = {
  relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
  contentKind: { in: ["COMMENT", "REPLY"] },
  AND: [
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "version"],
        equals: AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_VERSION,
      },
    },
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "resolved"],
        equals: false,
      },
    },
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "decisionReason"],
        equals: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      },
    },
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "classifierSource"],
        equals: "AI",
      },
    },
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "classifierVersion"],
        equals: AUTOMATIC_REVIEW_AI_VERSION,
      },
    },
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "classifierEvidence"],
        equals: AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE,
      },
    },
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "originalReason"],
        equals: "comment_on_verified_brand_parent",
      },
    },
    {
      policySnapshot: {
        path: ["replayResolution", "action"],
        equals: "automatic_review_unresolved",
      },
    },
    {
      policySnapshot: {
        path: ["replayResolution", "originalRelevance", "reason"],
        equals: "comment_on_verified_brand_parent",
      },
    },
  ],
}

const automaticCommentWhere = {
  contentKind: { in: ["COMMENT", "REPLY"] },
  OR: [
    { relevanceReason: null },
    {
      relevanceReason: {
        notIn: [
          "thread_context_for_actionable_descendant",
          AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
          "automatic_review_sentiment_unresolved",
        ],
      },
    },
  ],
}

const recoverableV3DiscoveryWhere = {
  relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
  contentKind: { in: ["POST", "MENTION", "VIDEO", "IMAGE", "AUDIO"] },
  AND: [
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "version"],
        equals: AUTOMATIC_REVIEW_TRIAGE_VERSION,
      },
    },
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "resolved"],
        equals: false,
      },
    },
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "decisionReason"],
        equals: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      },
    },
    {
      policySnapshot: {
        path: ["automaticReviewTriage", "classifierEvidence"],
        equals: "technical_evidence_unresolved",
      },
    },
  ],
}

function emptyMetrics() {
  return {
    selected: 0,
    accepted: 0,
    acceptedNegative: 0,
    acceptedNeutral: 0,
    rejected: 0,
    rejectedPositive: 0,
    rejectedIrrelevant: 0,
    rejectedOther: 0,
    unresolved: 0,
    aiAttempted: 0,
    aiUnavailable: 0,
    aiMissingKey: 0,
    aiTimeout: 0,
    aiRateLimited: 0,
    aiAuthenticationFailure: 0,
    aiUpstreamFailure: 0,
    aiInvalidResponse: 0,
    aiOtherFailure: 0,
    aiRetriesScheduled: 0,
    aiTerminalPending: 0,
    skipped: 0,
    deferred: 0,
    failures: 0,
    deadlineReached: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.findMany.mockResolvedValue([])
  deps.updateMany.mockResolvedValue({ count: 1 })
  deps.aiSentimentDetailed.mockResolvedValue({ sentiment: null, errorClass: "UNKNOWN" })
})

describe("automatic stored REVIEW backfill", () => {
  it("uses strong rules first and sends only semantic UNKNOWN to AI before snapshot replay", async () => {
    deps.findMany.mockResolvedValue([
      candidate("env-negative", "Məhsulun vaxtı keçmişdi"),
      candidate("env-positive", "Əla xidmət, təşəkkür edirəm"),
      candidate("env-neutral", "Mağaza saat 22:00-da bağlanır"),
      candidate("env-noise", "@arazsupermarket"),
    ])
    deps.aiSentimentDetailed.mockResolvedValueOnce({ sentiment: "neutral", errorClass: null })
    deps.replayIngestEnvelope
      .mockResolvedValueOnce({
        status: "AUTO_TRIAGED_ACCEPTED",
        automaticReviewTriage: { classification: "negative" },
      })
      .mockResolvedValueOnce({
        status: "AUTO_TRIAGED_REJECTED",
        automaticReviewTriage: { classification: "positive" },
      })
      .mockResolvedValueOnce({
        status: "AUTO_TRIAGED_ACCEPTED",
        automaticReviewTriage: { classification: "neutral" },
      })
      .mockResolvedValueOnce({
        status: "AUTO_TRIAGED_REJECTED",
        automaticReviewTriage: { classification: "irrelevant" },
      })

    await expect(autoTriageStoredReviewEnvelopes({ now, limit: 1_000 }))
      .resolves.toEqual({
        ...emptyMetrics(),
        selected: 4,
        accepted: 2,
        acceptedNegative: 1,
        acceptedNeutral: 1,
        rejected: 2,
        rejectedPositive: 1,
        rejectedIrrelevant: 1,
        aiAttempted: 1,
      })

    expect(deps.aiSentimentDetailed).toHaveBeenCalledOnce()
    expect(deps.aiSentimentDetailed).toHaveBeenCalledWith(
      "Mağaza saat 22:00-da bağlanır",
      { logErrors: false, timeoutMs: 8_000 },
    )
    expect(deps.findMany).toHaveBeenCalledWith({
      where: {
        relevanceStatus: "REVIEW",
        OR: [
          automaticCommentWhere,
          {
            relevanceReason: { in: [...AUTOMATIC_REVIEW_DISCOVERY_REASONS] },
            contentKind: { in: ["POST", "MENTION", "VIDEO", "IMAGE", "AUDIO"] },
          },
          recoverableTechnicalWhere,
          recoverableV3DiscoveryWhere,
        ],
        acceptedMentionId: null,
        purgedAt: null,
        deletedAtSource: null,
        purgeAt: { gt: new Date("2026-08-02T09:20:00.000Z") },
        discoveryAutoReviewDecisions: { none: { state: "SUPPRESSED" } },
        AND: [{ OR: [
          { reviewMutationUntil: null },
          { reviewMutationUntil: { lte: now } },
        ] }],
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 50,
      select: {
        id: true,
        organizationId: true,
        text: true,
        contentHmac: true,
        updatedAt: true,
        purgeAt: true,
        relevanceReason: true,
        contentKind: true,
        policySnapshot: true,
      },
    })
    expect(deps.replayIngestEnvelope).toHaveBeenNthCalledWith(
      3,
      "org-1",
      "env-neutral",
      expect.objectContaining({
        automaticTriage: true,
        automaticTriageClassification: expect.objectContaining({
          sentiment: "neutral",
          source: "AI",
          version: "ai_sentiment_v1",
        }),
        automaticTriageExpectedSnapshot: {
          contentHmac: "hmac-env-neutral",
          updatedAt: new Date("2026-08-02T08:00:00.000Z"),
          purgeAt,
          relevanceReason: "comment_on_verified_brand_parent",
        },
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      }),
    )
    expect(deps.aiSentimentDetailed.mock.invocationCallOrder[0])
      .toBeLessThan(deps.replayIngestEnvelope.mock.invocationCallOrder[2])
  })

  it("selects all non-terminal comments and only supported discovery publications", async () => {
    await autoTriageStoredReviewEnvelopes({ now })

    const where = deps.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([
      automaticCommentWhere,
      {
        relevanceReason: { in: [...AUTOMATIC_REVIEW_DISCOVERY_REASONS] },
        contentKind: { in: ["POST", "MENTION", "VIDEO", "IMAGE", "AUDIO"] },
      },
      recoverableTechnicalWhere,
      recoverableV3DiscoveryWhere,
    ])
    expect(JSON.stringify(where.OR)).toContain("thread_context_for_actionable_descendant")
    expect(JSON.stringify(where.OR)).not.toContain("ARTICLE")
    expect(JSON.stringify(where.OR)).not.toContain("DM")
  })

  it("replays a stored discovery video through the same negative-neutral gate", async () => {
    deps.findMany.mockResolvedValue([{
      ...candidate("env-video", "Video mağazanın bu gün açıq olduğunu göstərir"),
      contentKind: "VIDEO",
      relevanceReason: "discovery_snippet_only_match",
    }])
    deps.aiSentimentDetailed.mockResolvedValueOnce({ sentiment: "neutral", errorClass: null })
    deps.replayIngestEnvelope.mockResolvedValueOnce({
      status: "AUTO_TRIAGED_ACCEPTED",
      automaticReviewTriage: { classification: "neutral" },
    })

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toMatchObject({
      selected: 1,
      accepted: 1,
      acceptedNeutral: 1,
      aiAttempted: 1,
    })
    expect(deps.replayIngestEnvelope).toHaveBeenCalledWith(
      "org-1",
      "env-video",
      expect.objectContaining({
        automaticTriage: true,
        automaticTriageClassification: expect.objectContaining({ sentiment: "neutral" }),
        automaticTriageExpectedSnapshot: expect.objectContaining({
          relevanceReason: "discovery_snippet_only_match",
        }),
      }),
    )
  })

  it("AI-rejects a positive direct comment queued by the central gate", async () => {
    deps.findMany.mockResolvedValue([{
      ...candidate("env-direct-positive", "Xidmət haqqında müştəri rəyi"),
      relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
    }])
    deps.aiSentimentDetailed.mockResolvedValueOnce({ sentiment: "positive", errorClass: null })
    deps.replayIngestEnvelope.mockResolvedValueOnce({
      status: "AUTO_TRIAGED_REJECTED",
      automaticReviewTriage: { classification: "positive" },
    })

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toMatchObject({
      selected: 1,
      rejected: 1,
      rejectedPositive: 1,
      aiAttempted: 1,
    })
    expect(deps.replayIngestEnvelope).toHaveBeenCalledWith(
      "org-1",
      "env-direct-positive",
      expect.objectContaining({
        automaticTriageClassification: expect.objectContaining({ sentiment: "positive" }),
        automaticTriageExpectedSnapshot: expect.objectContaining({
          relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
        }),
      }),
    )
  })

  it("narrowly rechecks v2 ambiguous-emoji rows terminalized by the replay bug", async () => {
    deps.findMany.mockResolvedValue([{
      ...candidate("env-emoji-recovery", "🙄"),
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      policySnapshot: recoverableTechnicalPolicySnapshot(),
    }])
    deps.aiSentimentDetailed.mockResolvedValueOnce({ sentiment: "negative", errorClass: null })
    deps.replayIngestEnvelope.mockResolvedValueOnce({
      status: "AUTO_TRIAGED_ACCEPTED",
      automaticReviewTriage: { classification: "negative" },
    })

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toMatchObject({
      selected: 1,
      accepted: 1,
      acceptedNegative: 1,
      aiAttempted: 1,
      unresolved: 0,
    })
    expect(deps.aiSentimentDetailed).toHaveBeenCalledWith("🙄", {
      logErrors: false,
      timeoutMs: 8_000,
    })
    expect(deps.replayIngestEnvelope).toHaveBeenCalledWith(
      "org-1",
      "env-emoji-recovery",
      expect.objectContaining({
        automaticTriageRecovery: AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY,
        automaticTriageClassification: expect.objectContaining({ sentiment: "negative" }),
        automaticTriageExpectedSnapshot: expect.objectContaining({
          relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
        }),
      }),
    )
  })

  it("terminally replays exact v3 discovery technical rows without spending AI budget", async () => {
    deps.findMany.mockResolvedValue([{
      ...candidate("env-v3-discovery", "Search result snippet about the monitored subject"),
      contentKind: "VIDEO",
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      policySnapshot: recoverableV3DiscoveryPolicySnapshot(),
    }])
    deps.replayIngestEnvelope.mockResolvedValueOnce({
      status: "AUTO_TRIAGED_REJECTED",
    })

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toMatchObject({
      selected: 1,
      rejected: 1,
      rejectedOther: 1,
      accepted: 0,
      aiAttempted: 0,
      unresolved: 0,
    })
    expect(deps.aiSentimentDetailed).not.toHaveBeenCalled()
    expect(deps.replayIngestEnvelope).toHaveBeenCalledWith(
      "org-1",
      "env-v3-discovery",
      expect.objectContaining({
        automaticTriage: true,
        automaticTriageRecovery: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
        automaticTriageExpectedSnapshot: expect.objectContaining({
          relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
        }),
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      }),
    )
    expect(deps.replayIngestEnvelope.mock.calls[0][2])
      .not.toHaveProperty("automaticTriageClassification")
  })

  it("does not replay a v3-shaped discovery row whose cross-field provenance disagrees", async () => {
    const policySnapshot = recoverableV3DiscoveryPolicySnapshot()
    deps.findMany.mockResolvedValue([{
      ...candidate("env-v3-mismatch", "Search result snippet about the monitored subject"),
      contentKind: "POST",
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      policySnapshot: {
        ...policySnapshot,
        replayResolution: {
          ...policySnapshot.replayResolution,
          originalRelevance: {
            status: "REVIEW",
            reason: "discovery_missing_published_at",
          },
        },
      },
    }])

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toMatchObject({
      selected: 1,
      skipped: 1,
      accepted: 0,
      rejected: 0,
      unresolved: 0,
    })
    expect(deps.aiSentimentDetailed).not.toHaveBeenCalled()
    expect(deps.replayIngestEnvelope).not.toHaveBeenCalled()
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "env-v3-mismatch",
        contentHmac: "hmac-env-v3-mismatch",
        contentKind: "POST",
        updatedAt: new Date("2026-08-02T08:00:00.000Z"),
      }),
      data: expect.objectContaining({
        updatedAt: now,
        policySnapshot: expect.objectContaining({
          automaticReviewTriage: expect.objectContaining({
            version: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
          }),
          automaticReviewRecovery: expect.objectContaining({
            capability: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
            decisionReason: "automatic_review_recovery_provenance_mismatch",
          }),
        }),
      }),
    }))
  })

  it("terminalizes an exhausted legacy recovery without hot-looping the recovery mode", async () => {
    deps.findMany.mockResolvedValue([{
      ...candidate("env-emoji-capped", "🙄"),
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      policySnapshot: recoverableTechnicalPolicySnapshot({
        automaticReviewRetry: {
          attempts: 3,
          lastErrorClass: "TIMEOUT",
          lastAttemptAt: "2026-08-02T08:59:00.000Z",
          nextAttemptAt: "2026-08-02T08:59:00.000Z",
        },
      }),
    }])
    deps.replayIngestEnvelope.mockResolvedValueOnce({ status: "REVIEW_UNRESOLVED" })

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toMatchObject({
      selected: 1,
      unresolved: 1,
      aiAttempted: 0,
      failures: 0,
    })
    expect(deps.aiSentimentDetailed).not.toHaveBeenCalled()
    const replayOptions = deps.replayIngestEnvelope.mock.calls[0][2]
    expect(replayOptions).not.toHaveProperty("automaticTriageRecovery")
    expect(replayOptions).toMatchObject({
      automaticTriageClassification: {
        sentiment: null,
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
        attemptedAt: new Date("2026-08-02T08:59:00.000Z"),
        errorClass: "TIMEOUT",
      },
      automaticTriageExpectedSnapshot: {
        relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      },
    })
  })

  it("quarantines malformed legacy recovery evidence without spending AI budget", async () => {
    const malformed = recoverableTechnicalPolicySnapshot()
    const triage = malformed.automaticReviewTriage
    deps.findMany.mockResolvedValue([{
      ...candidate("env-emoji-malformed", "🙄"),
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      policySnapshot: {
        ...malformed,
        automaticReviewTriage: { ...triage, attemptedAt: "not-a-date" },
      },
    }])
    deps.replayIngestEnvelope.mockResolvedValueOnce({ status: "REVIEW_UNRESOLVED" })

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toMatchObject({
      selected: 1,
      unresolved: 1,
      aiAttempted: 0,
    })
    expect(deps.aiSentimentDetailed).not.toHaveBeenCalled()
    expect(deps.replayIngestEnvelope.mock.calls[0][2])
      .not.toHaveProperty("automaticTriageRecovery")
  })

  it("persists typed AI failures with backoff instead of terminalizing a transient error", async () => {
    deps.findMany.mockResolvedValue([candidate("env-unknown", "Mağaza bu gün açıqdır")])
    deps.aiSentimentDetailed.mockResolvedValue({ sentiment: null, errorClass: "RATE_LIMIT" })

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toEqual({
      ...emptyMetrics(),
      selected: 1,
      deferred: 1,
      aiAttempted: 1,
      aiUnavailable: 1,
      aiRateLimited: 1,
      aiRetriesScheduled: 1,
    })
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "env-unknown",
        organizationId: "org-1",
        contentHmac: "hmac-env-unknown",
        updatedAt: new Date("2026-08-02T08:00:00.000Z"),
        relevanceReason: "comment_on_verified_brand_parent",
      }),
      data: expect.objectContaining({
        policySnapshot: expect.objectContaining({
          automaticReviewRetry: expect.objectContaining({
            attempts: 1,
            lastErrorClass: "RATE_LIMIT",
            nextAttemptAt: "2026-08-02T09:05:00.000Z",
            terminalPending: false,
          }),
        }),
      }),
    }))
    expect(deps.replayIngestEnvelope).not.toHaveBeenCalled()
  })

  it("terminalizes a row after the persisted AI attempt cap without another provider call", async () => {
    deps.findMany.mockResolvedValue([{
      ...candidate("env-capped", "Mağaza bu gün açıqdır"),
      policySnapshot: {
        automaticReviewRetry: {
          attempts: 3,
          lastErrorClass: "TIMEOUT",
          lastAttemptAt: "2026-08-02T08:59:00.000Z",
          nextAttemptAt: "2026-08-02T08:59:00.000Z",
        },
      },
    }])
    deps.replayIngestEnvelope.mockResolvedValue({ status: "REVIEW_UNRESOLVED" })

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toEqual({
      ...emptyMetrics(),
      selected: 1,
      unresolved: 1,
    })
    expect(deps.aiSentimentDetailed).not.toHaveBeenCalled()
    expect(deps.replayIngestEnvelope).toHaveBeenCalledWith(
      "org-1",
      "env-capped",
      expect.objectContaining({
        automaticTriageClassification: {
          sentiment: null,
          source: "AI",
          version: "ai_sentiment_v1",
          attemptedAt: new Date("2026-08-02T08:59:00.000Z"),
          errorClass: "TIMEOUT",
        },
      }),
    )
  })

  it("defers rows without replay when the AI or wall-clock budget is exhausted", async () => {
    deps.findMany.mockResolvedValue([
      candidate("env-1", "Mağaza bu gün açıqdır"),
      candidate("env-2", "Mağaza sabah açıqdır"),
    ])
    deps.aiSentimentDetailed.mockResolvedValue({ sentiment: "neutral", errorClass: null })
    deps.replayIngestEnvelope.mockResolvedValue({
      status: "AUTO_TRIAGED_ACCEPTED",
      automaticReviewTriage: { classification: "neutral" },
    })

    await expect(autoTriageStoredReviewEnvelopes({ now, aiLimit: 1 }))
      .resolves.toMatchObject({ selected: 2, accepted: 1, deferred: 1, aiAttempted: 1 })
    expect(deps.aiSentimentDetailed).toHaveBeenCalledOnce()
    expect(deps.replayIngestEnvelope).toHaveBeenCalledOnce()

    deps.replayIngestEnvelope.mockClear()
    await expect(autoTriageStoredReviewEnvelopes({
      now,
      deadlineAt: new Date(0),
    })).resolves.toMatchObject({ selected: 2, deferred: 2, deadlineReached: true })
    expect(deps.replayIngestEnvelope).not.toHaveBeenCalled()
  })

  it("does not call AI again before a persisted retry becomes due", async () => {
    deps.findMany.mockResolvedValue([{
      ...candidate("env-backoff", "Mağaza bu gün açıqdır"),
      policySnapshot: {
        automaticReviewRetry: {
          attempts: 1,
          lastErrorClass: "RATE_LIMIT",
          lastAttemptAt: "2026-08-02T08:59:00.000Z",
          nextAttemptAt: "2026-08-02T09:04:00.000Z",
        },
      },
    }])

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toMatchObject({
      selected: 1,
      deferred: 1,
      aiAttempted: 0,
    })
    expect(deps.aiSentimentDetailed).not.toHaveBeenCalled()
    expect(deps.updateMany).not.toHaveBeenCalled()
    expect(deps.replayIngestEnvelope).not.toHaveBeenCalled()
  })

  it("pages past rows in future backoff so they cannot starve due work", async () => {
    const futureRetry = {
      automaticReviewRetry: {
        attempts: 1,
        lastErrorClass: "RATE_LIMIT",
        lastAttemptAt: "2026-08-02T08:59:00.000Z",
        nextAttemptAt: "2026-08-02T09:04:00.000Z",
      },
    }
    deps.findMany
      .mockResolvedValueOnce([
        { ...candidate("env-backoff-1", "Mağaza açıqdır"), policySnapshot: futureRetry },
        { ...candidate("env-backoff-2", "Mağaza bağlıdır"), policySnapshot: futureRetry },
      ])
      .mockResolvedValueOnce([
        candidate("env-due-1", "Mağaza saat 21:00-da bağlanır"),
        candidate("env-due-2", "Mağaza saat 22:00-da bağlanır"),
      ])
    deps.aiSentimentDetailed.mockResolvedValue({ sentiment: "neutral", errorClass: null })
    deps.replayIngestEnvelope.mockResolvedValue({
      status: "AUTO_TRIAGED_ACCEPTED",
      automaticReviewTriage: { classification: "neutral" },
    })

    await expect(autoTriageStoredReviewEnvelopes({ now, limit: 2, aiLimit: 2 }))
      .resolves.toMatchObject({
        selected: 4,
        deferred: 2,
        accepted: 2,
        acceptedNeutral: 2,
        aiAttempted: 2,
      })
    expect(deps.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: { id: "env-backoff-2" },
      skip: 1,
      take: 2,
    }))
    expect(deps.replayIngestEnvelope).toHaveBeenCalledTimes(2)
  })

  it("marks the third failed attempt terminal-pending without exceeding the AI cap", async () => {
    deps.findMany.mockResolvedValue([{
      ...candidate("env-third", "Mağaza bu gün açıqdır"),
      policySnapshot: {
        automaticReviewRetry: {
          attempts: 2,
          lastErrorClass: "TIMEOUT",
          lastAttemptAt: "2026-08-02T08:50:00.000Z",
          nextAttemptAt: "2026-08-02T08:55:00.000Z",
        },
      },
    }])
    deps.aiSentimentDetailed.mockResolvedValue({ sentiment: null, errorClass: "TIMEOUT" })

    await expect(autoTriageStoredReviewEnvelopes({ now })).resolves.toMatchObject({
      selected: 1,
      deferred: 1,
      aiAttempted: 1,
      aiUnavailable: 1,
      aiTimeout: 1,
      aiTerminalPending: 1,
    })
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        policySnapshot: expect.objectContaining({
          automaticReviewRetry: expect.objectContaining({
            attempts: 3,
            terminalPending: true,
          }),
        }),
      }),
    }))
    expect(deps.replayIngestEnvelope).not.toHaveBeenCalled()
  })

  it("is idempotent when the next bounded pass has no eligible rows", async () => {
    deps.findMany.mockResolvedValue([])
    await expect(autoTriageStoredReviewEnvelopes({
      organizationId: "org-1",
      providerRunId: "provider-run-1",
      now,
      limit: 25,
    })).resolves.toEqual(emptyMetrics())
    expect(deps.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        providerRunId: "provider-run-1",
      }),
      take: 25,
    }))
  })

  it("isolates failures and logs no observation content or raw error", async () => {
    deps.findMany.mockResolvedValue([candidate("env-fails", "Məhsul xarabdır")])
    deps.replayIngestEnvelope.mockRejectedValue(new Error("raw provider details"))
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    await expect(autoTriageStoredReviewEnvelopes({ now }))
      .resolves.toMatchObject({ selected: 1, failures: 1 })
    expect(consoleSpy).toHaveBeenCalledWith(
      "[social-automatic-review] envelope_failed",
      {
        organizationId: "org-1",
        envelopeId: "env-fails",
        code: "AUTOMATIC_REVIEW_REPLAY_FAILED",
      },
    )
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("raw provider details")
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("Məhsul xarabdır")
    consoleSpy.mockRestore()
  })
})
