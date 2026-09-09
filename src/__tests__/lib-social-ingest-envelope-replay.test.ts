import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  executeRaw: vi.fn(),
  findMonitoringSubjects: vi.fn(),
  parentMatchContextsForComments: vi.fn(),
  registerTikTokPublicationRevisit: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  auditCreate: vi.fn(),
  runWithTenant: vi.fn((_org: string, fn: () => unknown) => fn()),
  withTenantFence: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ingestEnvelope: {
      findFirst: deps.findFirst,
      updateMany: deps.updateMany,
    },
    monitoringSubject: {
      findMany: deps.findMonitoringSubjects,
    },
    auditLog: { create: deps.auditCreate },
    $executeRaw: deps.executeRaw,
  },
}))

vi.mock("@/lib/social/parent-match-context", () => ({
  parentMatchContextsForComments: deps.parentMatchContextsForComments,
}))

vi.mock("@/lib/social/tiktok-publication-revisit-repo", () => ({
  registerTikTokPublicationRevisit: deps.registerTikTokPublicationRevisit,
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  ingestMentionWithResult: deps.ingestMentionWithResult,
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: deps.runWithTenant,
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: deps.withTenantFence,
}))

import {
  AUTOMATIC_REVIEW_AI_VERSION,
  AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE,
  AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
  AUTOMATIC_REVIEW_DISCOVERY_IDENTITY_REJECTION_REASON,
  AUTOMATIC_REVIEW_DISCOVERY_MISSING_DATE_REJECTION_REASON,
  AUTOMATIC_REVIEW_RULES_VERSION,
  AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
  AUTOMATIC_REVIEW_TRIAGE_VERSION,
  AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY,
  AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_VERSION,
  AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
  AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
} from "@/lib/social/automatic-review-triage"
import { replayIngestEnvelope } from "@/lib/social/ingest-envelope-replay"

const replayNow = new Date("2026-07-23T12:00:00.000Z")
const suppressedDecisionGuard = {
  none: { state: "SUPPRESSED" },
}

const autoReviewDecision = {
  runId: "auto-review-run-1",
  decisionId: "auto-review-decision-1",
  subjectId: "subject-1",
  expectedContentHmac: "content-hmac-1",
  expectedUpdatedAt: new Date("2026-07-23T11:00:00.000Z"),
  expectedPurgeAt: new Date("2099-07-13T10:00:00.000Z"),
}

const automaticTriageExpectedSnapshot = {
  contentHmac: "content-hmac-1",
  updatedAt: new Date("2026-07-23T11:00:00.000Z"),
  purgeAt: new Date("2099-07-13T10:00:00.000Z"),
  relevanceReason: "comment_on_verified_brand_parent",
}

function automaticTriageProvenance(input: {
  status: "ACCEPTED" | "REVIEW" | "REJECTED"
  reason: string
  classification: "positive" | "neutral" | "negative" | "irrelevant" | "unknown"
  sentiment: "positive" | "neutral" | "negative" | "unknown"
  source?: "RULES" | "AI" | "PROVIDED"
  evidence?: string
  originalReason?: string
}) {
  return {
    version: AUTOMATIC_REVIEW_TRIAGE_VERSION,
    resolved: input.status !== "REVIEW",
    originalReason: input.originalReason ?? "comment_on_verified_brand_parent",
    decisionStatus: input.status,
    decisionReason: input.reason,
    classification: input.classification,
    sentiment: input.sentiment,
    classifierSource: input.source ?? "AI",
    classifierVersion: input.source === "RULES"
      ? AUTOMATIC_REVIEW_RULES_VERSION
      : AUTOMATIC_REVIEW_AI_VERSION,
    classifierEvidence: input.evidence ?? "ai_classification",
    providerFetchPerformed: false as const,
  }
}

function legacyAmbiguousEmojiPolicySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    policyVersion: "v1",
    automaticReviewTriage: {
      version: AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_VERSION,
      resolved: false,
      originalReason: "comment_on_verified_brand_parent",
      decisionStatus: "REVIEW",
      decisionReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      classification: "unknown",
      sentiment: "unknown",
      classifierSource: "AI",
      classifierVersion: AUTOMATIC_REVIEW_AI_VERSION,
      classifierEvidence: AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE,
      providerFetchPerformed: false,
      attemptedAt: "2026-08-02T06:30:00.000Z",
    },
    replayResolution: {
      version: "stored-envelope-replay-v1",
      action: "automatic_review_unresolved",
      originalRelevance: {
        status: "REVIEW",
        reason: "comment_on_verified_brand_parent",
        confidence: 0.98,
      },
      resolvedAt: "2026-08-02T06:30:00.000Z",
      providerFetchPerformed: false,
    },
    ...overrides,
  }
}

function v3DiscoveryTechnicalPolicySnapshot(input: {
  originalReason?: "discovery_missing_published_at" | "discovery_snippet_only_match"
  classifierSource?: "AI" | "RULES"
  overrides?: Record<string, unknown>
} = {}) {
  const originalReason = input.originalReason ?? "discovery_snippet_only_match"
  const classifierSource = input.classifierSource ?? "AI"
  return {
    policyVersion: "v1",
    automaticReviewTriage: {
      version: AUTOMATIC_REVIEW_TRIAGE_VERSION,
      resolved: false,
      originalReason,
      decisionStatus: "REVIEW",
      decisionReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      classification: "unknown",
      sentiment: "unknown",
      classifierSource,
      classifierVersion: classifierSource === "AI"
        ? AUTOMATIC_REVIEW_AI_VERSION
        : AUTOMATIC_REVIEW_RULES_VERSION,
      classifierEvidence: "technical_evidence_unresolved",
      providerFetchPerformed: false,
      attemptedAt: "2026-08-02T08:30:00.000Z",
    },
    replayResolution: {
      version: "stored-envelope-replay-v1",
      action: "automatic_review_unresolved",
      originalRelevance: {
        status: "REVIEW",
        reason: originalReason,
        confidence: 0,
      },
      resolvedAt: "2026-08-02T08:30:00.000Z",
      providerFetchPerformed: false,
    },
    ...(input.overrides ?? {}),
  }
}

const autoReviewSuppressionGuards = [
  {
    discoveryAutoReviewDecisions: {
      some: {
        id: "auto-review-decision-1",
        runId: "auto-review-run-1",
        state: "SUPPRESSED",
        action: "RELEASE_TO_NORMAL_PIPELINE",
        run: {
          subjectId: "subject-1",
          state: "APPLIED",
        },
      },
    },
  },
  {
    discoveryAutoReviewDecisions: {
      none: {
        state: "SUPPRESSED",
        id: { not: "auto-review-decision-1" },
      },
    },
  },
]

function sqlParts(args: unknown[]): { text: string; values: unknown[] } {
  const strings = args[0]
  return {
    text: Array.isArray(strings) ? strings.join("?") : "",
    values: args.slice(1),
  }
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    id: "envelope-1",
    organizationId: "org-1",
    sourceId: "source-1",
    collectorRunId: "collector-run-1",
    routePlanId: "route-plan-1",
    providerRunId: "provider-run-1",
    acceptedMentionId: null,
    adapterKey: "LICENSED_PROVIDER",
    providerKey: "provider-1",
    providerItemId: "provider-item-1",
    idempotencyKey: "ingest:provider:item:1",
    acquisitionMode: "LICENSED_PROVIDER",
    contentKind: "COMMENT",
    platform: "instagram",
    externalId: "comment-1",
    postExternalId: "post-1",
    parentExternalId: null,
    threadExternalId: "thread-1",
    replyToExternalId: null,
    depth: 0,
    url: "https://instagram.com/p/post-1?comment=comment-1",
    canonicalUrl: "https://instagram.com/p/post-1?comment=comment-1",
    parentPostUrl: "https://instagram.com/p/post-1",
    authorName: "Customer",
    authorHandle: "customer",
    authorAvatar: "https://cdn.example/avatar.jpg",
    text: "Acme Robotics mentioned in this comment",
    rawPayload: { providerEvidence: "stored" },
    policySnapshot: { policyVersion: "v1" },
    subjectDecision: {
      matches: [{ subjectId: "subject-1", status: "MATCHED" }],
    },
    source: {
      settings: {},
      subjectSources: [{ subjectId: "subject-1", scenarioId: "scenario-1" }],
    },
    routePlan: { scenarioId: "scenario-1" },
    providerRun: {
      inputSnapshot: {
        leadDriveTargetScenarioId: "scenario-1",
        leadDriveTargetSubjectId: "subject-1",
      },
      routePlan: { scenarioId: "scenario-1" },
    },
    contentHmac: "content-hmac-1",
    updatedAt: new Date("2026-07-23T11:00:00.000Z"),
    publishedAt: new Date("2026-07-10T10:00:00.000Z"),
    editedAt: null,
    deletedAtSource: null,
    relevanceStatus: "ACCEPTED",
    relevanceReason: "subject_match",
    relevanceConfidence: 0.98,
    matchedTerms: ["Acme Robotics"],
    purgeAt: new Date("2099-07-13T10:00:00.000Z"),
    purgedAt: null,
    reviewMutationKey: null,
    reviewMutationUntil: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(replayNow)
  vi.clearAllMocks()
  deps.findFirst.mockResolvedValue(envelope())
  deps.updateMany.mockResolvedValue({ count: 1 })
  deps.executeRaw.mockResolvedValue(1)
  deps.findMonitoringSubjects.mockResolvedValue([{ id: "subject-1", legacyScenarioId: "scenario-1" }])
  deps.parentMatchContextsForComments.mockResolvedValue(new Map())
  deps.registerTikTokPublicationRevisit.mockResolvedValue(true)
  deps.ingestMentionWithResult.mockResolvedValue({ id: "mention-1", created: true })
  deps.auditCreate.mockResolvedValue({ id: "audit-1" })
  deps.withTenantFence.mockImplementation(async (
    _organizationId: string,
    replay: () => Promise<unknown>,
  ) => ({ allowed: true, value: await replay() }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("replayIngestEnvelope", () => {
  it("requires an immutable envelope snapshot for an out-of-fence AI classification", async () => {
    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageClassification: {
        sentiment: "negative",
        source: "AI",
        version: "ai_sentiment_v1",
        attemptedAt: replayNow,
      },
    })).rejects.toThrow("snapshot")
    expect(deps.findFirst).not.toHaveBeenCalled()
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("does not combine legacy automatic recovery with an operator override", async () => {
    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      reviewOverride: true,
      automaticTriageRecovery: AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY,
      automaticTriageClassification: {
        sentiment: "negative",
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
        attemptedAt: replayNow,
      },
      automaticTriageExpectedSnapshot: {
        ...automaticTriageExpectedSnapshot,
        relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      },
    })).rejects.toThrow("isolated")

    expect(deps.findFirst).not.toHaveBeenCalled()
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("does not load or replay an envelope when clean-slate collection is blocked", async () => {
    deps.withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1"))
      .rejects.toThrow("social_monitoring_collection_blocked")
    expect(deps.runWithTenant).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(deps.findFirst).not.toHaveBeenCalled()
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("replays stored evidence in the tenant without a provider fetch", async () => {
    const result = await replayIngestEnvelope("org-1", "envelope-1")

    expect(deps.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        AND: [{
          discoveryAutoReviewDecisions: suppressedDecisionGuard,
        }],
      },
      include: expect.any(Object),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledOnce()
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        externalId: "comment-1",
        contentKind: "COMMENT",
        sourceProvider: "provider_api",
        sentiment: null,
        matchedTerm: "Acme Robotics",
        observation: expect.objectContaining({
          sourceId: "source-1",
          collectorRunId: "collector-run-1",
          routePlanId: "route-plan-1",
          providerRunId: "provider-run-1",
          providerItemId: "provider-item-1",
          idempotencyKey: "ingest:provider:item:1",
          rawPayload: { providerEvidence: "stored" },
          policySnapshot: expect.objectContaining({
            policyVersion: "v1",
            replayedFromEnvelopeId: "envelope-1",
            replayedWithoutProviderFetch: true,
          }),
        }),
      }),
      expect.objectContaining({ envelopeMutationKey: undefined }),
    )
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        id: "envelope-1",
        relevanceStatus: "ACCEPTED",
        purgedAt: null,
        AND: [{
          discoveryAutoReviewDecisions: suppressedDecisionGuard,
        }],
        purgeAt: { gt: replayNow },
      }),
      data: expect.objectContaining({
        acceptedMentionId: "mention-1",
        relevanceStatus: "ACCEPTED",
      }),
    }))
    expect(result).toEqual({
      status: "REPLAYED",
      envelopeId: "envelope-1",
      mentionId: "mention-1",
      created: true,
    })
  })

  it("returns the prior mention without ingesting an already accepted envelope", async () => {
    deps.findFirst.mockResolvedValue(envelope({ acceptedMentionId: "mention-existing" }))

    await expect(replayIngestEnvelope("org-1", "envelope-1")).resolves.toEqual({
      status: "ALREADY_ACCEPTED",
      envelopeId: "envelope-1",
      mentionId: "mention-existing",
      created: false,
    })
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(deps.updateMany).not.toHaveBeenCalled()
  })

  it("reports only the durable operator subject on an idempotent accept", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      acceptedMentionId: "mention-existing",
      relevanceStatus: "ACCEPTED",
      relevanceReason: "operator_review_accept",
      policySnapshot: {
        replayResolution: {
          action: "operator_review_accept",
          operatorReviewSubjectId: "subject-1",
        },
      },
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      reviewOverride: true,
      reviewSubjectId: "subject-foreign",
    })).resolves.toEqual({
      status: "ALREADY_ACCEPTED",
      envelopeId: "envelope-1",
      mentionId: "mention-existing",
      created: false,
      reviewSubjectId: "subject-1",
    })
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("allows retry of a persistence failure but not an ordinary review decision", async () => {
    deps.findFirst.mockResolvedValueOnce(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "mention_persistence_failed",
    }))
    await expect(replayIngestEnvelope("org-1", "envelope-1")).resolves.toMatchObject({ status: "REPLAYED" })

    deps.findFirst.mockResolvedValueOnce(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "ambiguous_subject_context",
    }))
    await expect(replayIngestEnvelope("org-1", "envelope-1")).rejects.toThrow(
      "Ingest envelope is not eligible for replay",
    )
  })

  it.each([
    [{ purgedAt: new Date(), relevanceStatus: "PURGED" }, "payload has been purged"],
    [{ purgeAt: new Date("2000-01-01T00:00:00.000Z") }, "payload has expired"],
    [{ externalId: null }, "payload is incomplete"],
    [{ text: null }, "payload is incomplete"],
  ])("rejects an unusable stored envelope", async (overrides, message) => {
    deps.findFirst.mockResolvedValue(envelope(overrides))
    await expect(replayIngestEnvelope("org-1", "envelope-1")).rejects.toThrow(message)
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("reports rejection when the current subject policy no longer accepts the evidence", async () => {
    deps.ingestMentionWithResult.mockResolvedValue({
      id: "new-review-envelope",
      envelopeId: "new-review-envelope",
      created: false,
      accepted: false,
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1")).resolves.toEqual({
      status: "REJECTED_BY_CURRENT_RELEVANCE",
      envelopeId: "envelope-1",
      mentionId: null,
      created: false,
    })
    expect(deps.updateMany).not.toHaveBeenCalled()
  })

  it("does not disclose another tenant's envelope", async () => {
    deps.findFirst.mockResolvedValue(null)
    await expect(replayIngestEnvelope("org-other", "envelope-1")).rejects.toThrow("Ingest envelope not found")
  })

  it("accepts a REVIEW envelope only under the explicit operator review override", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_missing_published_at",
      rawPayload: {
        providerEvidence: "stored",
        authorMeta: { profileUrl: "https://instagram.com/customer" },
      },
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1")).rejects.toThrow(
      "Ingest envelope is not eligible for replay",
    )

    const result = await replayIngestEnvelope("org-1", "envelope-1", {
      reviewOverride: true,
      reviewActorId: "user-1",
    })
    expect(result).toMatchObject({ status: "REPLAYED" })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        contentKind: "COMMENT",
        sourceType: "comment",
        publishedAt: new Date("2026-07-10T10:00:00.000Z"),
        sourceMetadata: expect.objectContaining({
          reviewOverride: true,
          authorUrl: "https://instagram.com/customer",
          profileUrl: "https://instagram.com/customer",
          socialTriage: { language: "en" },
        }),
        observation: expect.objectContaining({
          relevanceStatus: "ACCEPTED",
          relevanceReason: "operator_review_accept",
          policySnapshot: expect.objectContaining({
            reviewOverride: true,
            originalRelevanceStatus: "REVIEW",
            originalRelevanceReason: "discovery_missing_published_at",
          }),
        }),
      }),
      expect.objectContaining({
        envelopeMutationKey: expect.any(String),
        operatorReviewDecision: {
          envelopeId: "envelope-1",
          subjectId: "subject-1",
          actorId: "user-1",
        },
      }),
    )
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        id: "envelope-1",
        relevanceStatus: "REVIEW",
        purgedAt: null,
        AND: [{
          discoveryAutoReviewDecisions: suppressedDecisionGuard,
        }],
      }),
      data: expect.objectContaining({
        acceptedMentionId: "mention-1",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "operator_review_accept",
        policySnapshot: expect.objectContaining({
          policyVersion: "v1",
          replayResolution: expect.objectContaining({
            action: "operator_review_accept",
            providerFetchPerformed: false,
            operatorReviewSubjectId: "subject-1",
            operatorReviewActorId: "user-1",
            originalRelevance: {
              status: "REVIEW",
              reason: "discovery_missing_published_at",
              confidence: 0.98,
            },
          }),
        }),
      }),
    }))
  })

  it("terminally rejects a positive comment even when an operator clicks accept", async () => {
    const provenance = automaticTriageProvenance({
      status: "REJECTED",
      reason: "automatic_review_positive_comment",
      classification: "positive",
      sentiment: "positive",
      source: "RULES",
      evidence: "explicit_positive",
      originalReason: "operator_review_accept",
    })
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_missing_published_at",
      text: "Excellent service, thank you",
    }))
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "envelope-1",
      created: false,
      accepted: false,
      relevanceStatus: "REJECTED",
      relevanceReason: "automatic_review_positive_comment",
      automaticReviewTriage: provenance,
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      reviewOverride: true,
      reviewSubjectId: "subject-1",
      reviewActorId: "user-1",
    })).resolves.toMatchObject({
      status: "REJECTED_BY_COMMENT_POLICY",
      mentionId: null,
      relevanceReason: "automatic_review_positive_comment",
    })

    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      data: expect.objectContaining({
        relevanceStatus: "REJECTED",
        relevanceReason: "automatic_review_positive_comment",
        text: null,
        rawPayload: {},
      }),
    })
    expect(deps.updateMany.mock.calls[1][0].data.policySnapshot).toMatchObject({
      automaticReviewTriage: provenance,
    })
  })

  it("queues an undecidable comment for automatic AI instead of force-accepting it", async () => {
    const provenance = automaticTriageProvenance({
      status: "REVIEW",
      reason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
      classification: "unknown",
      sentiment: "unknown",
      source: "RULES",
      evidence: "semantic_text_requires_ai",
      originalReason: "operator_review_accept",
    })
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_missing_published_at",
      text: "The store closes at 22:00",
    }))
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "envelope-1",
      created: false,
      accepted: false,
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
      automaticReviewTriage: provenance,
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      reviewOverride: true,
      reviewSubjectId: "subject-1",
      reviewActorId: "user-1",
    })).resolves.toMatchObject({
      status: "QUEUED_FOR_AUTOMATIC_TRIAGE",
      mentionId: null,
      relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
    })

    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      data: expect.objectContaining({
        relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
        relevanceConfidence: 0,
        policySnapshot: expect.objectContaining({
          automaticReviewTriage: expect.objectContaining({
            version: AUTOMATIC_REVIEW_TRIAGE_VERSION,
            decisionReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
            classifierEvidence: "semantic_text_requires_ai",
          }),
          queuedOperatorReview: expect.objectContaining({
            version: "queued-operator-comment-review-v1",
            envelopeId: "envelope-1",
            subjectId: "subject-1",
            actorId: "user-1",
          }),
        }),
      }),
    })
  })

  it("reuses the exact operator-selected subject when AI resolves a multi-subject comment", async () => {
    const queuedPolicySnapshot = {
      policyVersion: "v1",
      queuedOperatorReview: {
        version: "queued-operator-comment-review-v1",
        envelopeId: "envelope-1",
        subjectId: "subject-2",
        actorId: "user-1",
        queuedAt: "2026-07-23T11:30:00.000Z",
      },
    }
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
      policySnapshot: queuedPolicySnapshot,
      subjectDecision: {
        matches: [
          { subjectId: "subject-1", status: "MATCHED" },
          { subjectId: "subject-2", status: "MATCHED" },
        ],
      },
      source: {
        settings: {},
        subjectSources: [
          { subjectId: "subject-1", scenarioId: null },
          { subjectId: "subject-2", scenarioId: null },
        ],
      },
      routePlan: null,
      providerRun: { inputSnapshot: {}, routePlan: null },
    }))
    deps.findMonitoringSubjects.mockResolvedValue([
      { id: "subject-1", legacyScenarioId: null },
      { id: "subject-2", legacyScenarioId: null },
    ])
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "mention-1",
      created: true,
      automaticReviewTriage: automaticTriageProvenance({
        status: "ACCEPTED",
        reason: "automatic_review_comment_negative",
        classification: "negative",
        sentiment: "negative",
        originalReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
      }),
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageClassification: {
        sentiment: "negative",
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
        attemptedAt: replayNow,
      },
      automaticTriageExpectedSnapshot: {
        ...automaticTriageExpectedSnapshot,
        relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
      },
    })).resolves.toMatchObject({ status: "AUTO_TRIAGED_ACCEPTED" })

    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        sentiment: "negative",
        sourceMetadata: expect.objectContaining({
          targetSubjectId: "subject-2",
          reviewOverride: true,
          queuedOperatorReview: true,
        }),
        observation: expect.objectContaining({
          relevanceStatus: "REVIEW",
          relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
        }),
      }),
      expect.objectContaining({
        operatorReviewDecision: {
          envelopeId: "envelope-1",
          subjectId: "subject-2",
          actorId: "user-1",
        },
      }),
    )
  })

  it("fails closed when the queued operator subject is no longer linked", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
      policySnapshot: {
        policyVersion: "v1",
        queuedOperatorReview: {
          version: "queued-operator-comment-review-v1",
          envelopeId: "envelope-1",
          subjectId: "subject-2",
          actorId: "user-1",
        },
      },
      subjectDecision: {
        matches: [{ subjectId: "subject-1", status: "MATCHED" }],
      },
    }))
    deps.findMonitoringSubjects.mockResolvedValue([
      { id: "subject-1", legacyScenarioId: "scenario-1" },
    ])

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageClassification: {
        sentiment: "negative",
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
        attemptedAt: replayNow,
      },
      automaticTriageExpectedSnapshot: {
        ...automaticTriageExpectedSnapshot,
        relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
      },
    })).resolves.toMatchObject({
      status: "REVIEW_UNRESOLVED",
      relevanceReason: "automatic_review_technical_unresolved",
    })

    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      data: expect.objectContaining({
        relevanceReason: "automatic_review_technical_unresolved",
        relevanceConfidence: 0,
      }),
    })
  })

  it("CAS-triages a stored parent-context review without a provider fetch", async () => {
    const provenance = automaticTriageProvenance({
      status: "ACCEPTED",
      reason: "automatic_review_parent_context_negative",
      classification: "negative",
      sentiment: "negative",
    })
    const parentContext = {
      parentMentionId: "parent-mention-1",
      matchedTerm: "Acme Robotics",
      subjectIds: ["subject-1"],
    }
    deps.parentMatchContextsForComments.mockResolvedValueOnce(new Map([
      ["https://instagram.com/p/post-1", parentContext],
    ]))
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "comment_on_verified_brand_parent",
      policySnapshot: { policyVersion: "v1" },
      providerRun: {
        inputSnapshot: {
          leadDriveTargetScenarioId: "scenario-1",
          leadDriveTargetSubjectId: "subject-1",
          leadDriveProviderWindow: {
            since: "2026-07-01T00:00:00.000Z",
            until: "2026-08-01T00:00:00.000Z",
          },
        },
        routePlan: { scenarioId: "scenario-1" },
      },
    }))
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "mention-1",
      created: true,
      automaticReviewTriage: provenance,
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageClassification: {
        sentiment: "negative",
        source: "AI",
        version: "ai_sentiment_v1",
        attemptedAt: replayNow,
      },
      automaticTriageExpectedSnapshot,
      suppressWorkflows: true,
      suppressMediaScheduling: true,
    })).resolves.toMatchObject({
      status: "AUTO_TRIAGED_ACCEPTED",
      envelopeId: "envelope-1",
      mentionId: "mention-1",
      created: true,
      automaticReviewTriage: provenance,
    })

    expect(deps.updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        relevanceStatus: "REVIEW",
        acceptedMentionId: null,
        contentHmac: automaticTriageExpectedSnapshot.contentHmac,
        updatedAt: automaticTriageExpectedSnapshot.updatedAt,
        purgeAt: automaticTriageExpectedSnapshot.purgeAt,
        relevanceReason: automaticTriageExpectedSnapshot.relevanceReason,
      },
      data: {
        reviewMutationKey: expect.any(String),
        reviewMutationUntil: expect.any(Date),
      },
    })
    const mutationKey = deps.updateMany.mock.calls[0][0].data.reviewMutationKey
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        parentMatchContext: parentContext,
        sentiment: "negative",
        sentimentClassification: {
          source: "AI",
          version: "ai_sentiment_v1",
        },
        sourceMetadata: expect.objectContaining({
          targetSubjectId: "subject-1",
          replayedWithoutProviderFetch: true,
        }),
        observation: expect.objectContaining({
          relevanceStatus: "REVIEW",
          relevanceReason: "comment_on_verified_brand_parent",
          policySnapshot: expect.objectContaining({
            automaticTriage: true,
            leadDriveProviderWindow: {
              since: "2026-07-01T00:00:00.000Z",
              until: "2026-08-01T00:00:00.000Z",
            },
          }),
        }),
      }),
      {
        envelopeMutationKey: mutationKey,
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      },
    )
    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        relevanceStatus: "REVIEW",
        reviewMutationKey: mutationKey,
      },
      data: expect.objectContaining({
        acceptedMentionId: "mention-1",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "automatic_review_parent_context_negative",
        policySnapshot: expect.objectContaining({
          automaticReviewTriage: provenance,
          replayResolution: expect.objectContaining({
            action: "automatic_review_negative_or_neutral",
            automaticReviewTriage: expect.objectContaining({
              decisionReason: "automatic_review_parent_context_negative",
              sentiment: "negative",
              classifierSource: "AI",
            }),
          }),
        }),
      }),
    })
    expect(deps.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        action: "social_review_automatic_accept",
        entityId: "envelope-1",
        entityName: "automatic_review_parent_context_negative",
        newValue: expect.objectContaining({
          sentiment: "negative",
          classifierSource: "AI",
          providerFetchPerformed: false,
        }),
      }),
    })
  })

  it("replays a generic queued comment through the same positive rejection gate", async () => {
    const provenance = automaticTriageProvenance({
      status: "REJECTED",
      reason: "automatic_review_positive_comment",
      classification: "positive",
      sentiment: "positive",
      originalReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
    })
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
      text: "Əla xidmətdir",
    }))
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "envelope-1",
      created: false,
      accepted: false,
      relevanceStatus: "REJECTED",
      relevanceReason: "automatic_review_positive_comment",
      automaticReviewTriage: provenance,
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageClassification: {
        sentiment: "positive",
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
        attemptedAt: replayNow,
      },
      automaticTriageExpectedSnapshot: {
        ...automaticTriageExpectedSnapshot,
        relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
      },
    })).resolves.toMatchObject({
      status: "AUTO_TRIAGED_REJECTED",
      automaticReviewTriage: provenance,
    })

    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        sentiment: "positive",
        sourceMetadata: expect.objectContaining({ targetSubjectId: "subject-1" }),
        observation: expect.objectContaining({
          relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
        }),
      }),
      expect.any(Object),
    )
  })

  it("explicitly recovers only the legacy v2 ambiguous-emoji terminal state", async () => {
    const provenance = automaticTriageProvenance({
      status: "ACCEPTED",
      reason: "automatic_review_parent_context_negative",
      classification: "negative",
      sentiment: "negative",
    })
    const parentContext = {
      parentMentionId: "parent-mention-1",
      matchedTerm: "Acme Robotics",
      subjectIds: ["subject-1"],
    }
    deps.parentMatchContextsForComments.mockResolvedValueOnce(new Map([
      ["https://instagram.com/p/post-1", parentContext],
    ]))
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      text: "🙄",
      policySnapshot: legacyAmbiguousEmojiPolicySnapshot(),
    }))
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "mention-1",
      created: true,
      automaticReviewTriage: provenance,
    })
    const recoverySnapshot = {
      ...automaticTriageExpectedSnapshot,
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
    }

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageRecovery: AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY,
      automaticTriageClassification: {
        sentiment: "negative",
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
        attemptedAt: replayNow,
      },
      automaticTriageExpectedSnapshot: recoverySnapshot,
    })).resolves.toMatchObject({
      status: "AUTO_TRIAGED_ACCEPTED",
      automaticReviewTriage: provenance,
    })

    expect(deps.updateMany.mock.calls[0][0]).toMatchObject({
      where: expect.objectContaining({
        relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        parentMatchContext: parentContext,
        sentiment: "negative",
        observation: expect.objectContaining({
          relevanceReason: "comment_on_verified_brand_parent",
        }),
      }),
      expect.any(Object),
    )
  })

  it.each([
    [
      "discovery_snippet_only_match",
      AUTOMATIC_REVIEW_DISCOVERY_IDENTITY_REJECTION_REASON,
    ],
    [
      "discovery_missing_published_at",
      AUTOMATIC_REVIEW_DISCOVERY_MISSING_DATE_REJECTION_REASON,
    ],
  ] as const)("terminally rejects exact v3 recovery evidence for %s", async (
    originalReason,
    terminalReason,
  ) => {
    const providerWindow = {
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-07-31T23:59:59.000Z",
    }
    const technicalPolicy = v3DiscoveryTechnicalPolicySnapshot({ originalReason })
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      relevanceConfidence: 0,
      contentKind: "VIDEO",
      platform: "web",
      externalId: "web-video-1",
      postExternalId: "web-video-1",
      parentExternalId: null,
      threadExternalId: null,
      url: "https://independent.example/video/1",
      canonicalUrl: "https://independent.example/video/1",
      parentPostUrl: null,
      policySnapshot: technicalPolicy,
      providerRun: {
        inputSnapshot: {
          leadDriveTargetScenarioId: "scenario-1",
          leadDriveTargetSubjectId: "subject-1",
          leadDriveProviderWindow: providerWindow,
        },
        routePlan: { scenarioId: "scenario-1" },
      },
    }))
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "envelope-1",
      created: false,
      accepted: false,
      relevanceStatus: "REJECTED",
      relevanceReason: terminalReason,
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageRecovery: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
      automaticTriageExpectedSnapshot: {
        ...automaticTriageExpectedSnapshot,
        relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      },
      suppressWorkflows: true,
      suppressMediaScheduling: true,
    })).resolves.toMatchObject({
      status: "AUTO_TRIAGED_REJECTED",
      mentionId: null,
      relevanceReason: terminalReason,
    })

    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        contentKind: "VIDEO",
        sentiment: null,
        observation: expect.objectContaining({
          relevanceStatus: "REVIEW",
          relevanceReason: originalReason,
          policySnapshot: expect.objectContaining({
            automaticTriageRecovery: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
            leadDriveProviderWindow: providerWindow,
          }),
        }),
      }),
      expect.objectContaining({
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      }),
    )
    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      data: expect.objectContaining({
        relevanceStatus: "REJECTED",
        relevanceReason: terminalReason,
        text: null,
        rawPayload: {},
        policySnapshot: expect.objectContaining({
          leadDriveProviderWindow: providerWindow,
          automaticReviewTriage: technicalPolicy.automaticReviewTriage,
          automaticReviewRecovery: expect.objectContaining({
            version: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
            capability: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
            originalReason,
            decisionStatus: "REJECTED",
            decisionReason: terminalReason,
            priorClassifierSource: "AI",
            priorClassifierVersion: AUTOMATIC_REVIEW_AI_VERSION,
            priorClassifierEvidence: "technical_evidence_unresolved",
            priorAttemptedAt: "2026-08-02T08:30:00.000Z",
          }),
          replayResolution: expect.objectContaining({
            action: "automatic_review_reject",
            automaticTriageRecovery: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
            recoveredOriginalReason: originalReason,
          }),
        }),
      }),
    })
    expect(deps.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "social_review_automatic_reject",
        entityName: terminalReason,
        newValue: expect.objectContaining({
          automaticTriageRecovery: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
          recoveredOriginalReason: originalReason,
          classifierSource: "AI",
          classifierVersion: AUTOMATIC_REVIEW_AI_VERSION,
          classifierEvidence: "technical_evidence_unresolved",
        }),
      }),
    })
  })

  it("fails closed when v3 discovery recovery provenance changed", async () => {
    const policySnapshot = v3DiscoveryTechnicalPolicySnapshot({
      overrides: {
        replayResolution: {
          version: "stored-envelope-replay-v1",
          action: "automatic_review_unresolved",
          originalRelevance: {
            status: "REVIEW",
            reason: "discovery_missing_published_at",
          },
          providerFetchPerformed: false,
        },
      },
    })
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      contentKind: "POST",
      policySnapshot,
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageRecovery: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
      automaticTriageExpectedSnapshot: {
        ...automaticTriageExpectedSnapshot,
        relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      },
    })).rejects.toThrow("provenance")
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(deps.updateMany).toHaveBeenLastCalledWith({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        reviewMutationKey: expect.any(String),
      },
      data: {
        reviewMutationKey: null,
        reviewMutationUntil: null,
      },
    })
  })

  it("stamps a failed v3 recovery so the backfill selector cannot hot-loop it", async () => {
    const policySnapshot = v3DiscoveryTechnicalPolicySnapshot()
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      contentKind: "POST",
      policySnapshot,
    }))
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "envelope-1",
      created: false,
      accepted: false,
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageRecovery: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
      automaticTriageExpectedSnapshot: {
        ...automaticTriageExpectedSnapshot,
        relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      },
    })).resolves.toMatchObject({ status: "REVIEW_UNRESOLVED" })

    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      data: {
        relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
        policySnapshot: expect.objectContaining({
          automaticReviewTriage: expect.objectContaining({
            version: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
            originalReason: "discovery_snippet_only_match",
            classifierEvidence: "technical_evidence_unresolved_after_v3_discovery_recovery",
          }),
          automaticReviewRecovery: expect.objectContaining({
            capability: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
            decisionStatus: "REVIEW",
          }),
        }),
      },
    })
  })

  it("fails closed when legacy ambiguous-emoji recovery provenance changed", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      text: "🙄",
      policySnapshot: legacyAmbiguousEmojiPolicySnapshot({
        replayResolution: {
          action: "automatic_review_unresolved",
          originalRelevance: { reason: "different_reason" },
        },
      }),
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageRecovery: AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY,
      automaticTriageClassification: {
        sentiment: "negative",
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
        attemptedAt: replayNow,
      },
      automaticTriageExpectedSnapshot: {
        ...automaticTriageExpectedSnapshot,
        relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      },
    })).rejects.toThrow("provenance")

    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(deps.updateMany).toHaveBeenLastCalledWith({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        reviewMutationKey: expect.any(String),
      },
      data: {
        reviewMutationKey: null,
        reviewMutationUntil: null,
      },
    })
  })

  it("terminalizes a recovered row with new non-recoverable evidence when parent context is gone", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      text: "🙄",
      policySnapshot: legacyAmbiguousEmojiPolicySnapshot(),
    }))
    deps.parentMatchContextsForComments.mockResolvedValueOnce(new Map())
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "envelope-1",
      created: false,
      accepted: false,
      relevanceStatus: "REVIEW",
      relevanceReason: "comment_on_verified_brand_parent",
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageRecovery: AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY,
      automaticTriageClassification: {
        sentiment: "negative",
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
        attemptedAt: replayNow,
      },
      automaticTriageExpectedSnapshot: {
        ...automaticTriageExpectedSnapshot,
        relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      },
    })).resolves.toMatchObject({ status: "REVIEW_UNRESOLVED" })

    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      data: {
        relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
        policySnapshot: expect.objectContaining({
          automaticReviewTriage: expect.objectContaining({
            version: AUTOMATIC_REVIEW_TRIAGE_VERSION,
            originalReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
            classifierEvidence: "technical_evidence_unresolved",
          }),
          replayResolution: expect.objectContaining({
            action: "automatic_review_unresolved",
            originalRelevance: expect.objectContaining({
              reason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
            }),
          }),
        }),
      },
    })
  })

  it("CAS-scrubs a positive stored review and terminalizes unavailable AI as REVIEW", async () => {
    const positiveProvenance = automaticTriageProvenance({
      status: "REJECTED",
      reason: "automatic_review_positive_parent_comment",
      classification: "positive",
      sentiment: "positive",
    })
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "comment_on_verified_brand_parent",
    }))
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "envelope-1",
      created: false,
      accepted: false,
      relevanceStatus: "REJECTED",
      relevanceReason: "automatic_review_positive_parent_comment",
      automaticReviewTriage: positiveProvenance,
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageClassification: {
        sentiment: "positive",
        source: "AI",
        version: "ai_sentiment_v1",
        attemptedAt: replayNow,
      },
      automaticTriageExpectedSnapshot,
      suppressWorkflows: true,
      suppressMediaScheduling: true,
    })).resolves.toMatchObject({ status: "AUTO_TRIAGED_REJECTED" })
    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        relevanceStatus: "REVIEW",
        acceptedMentionId: null,
        reviewMutationKey: expect.any(String),
      },
      data: expect.objectContaining({
        relevanceStatus: "REJECTED",
        relevanceReason: "automatic_review_positive_parent_comment",
        policySnapshot: expect.objectContaining({
          automaticReviewTriage: positiveProvenance,
        }),
        text: null,
        rawPayload: {},
        reviewMutationKey: null,
      }),
    })
    expect(deps.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "social_review_automatic_reject" }),
    })

    vi.clearAllMocks()
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "comment_on_verified_brand_parent",
    }))
    deps.updateMany.mockResolvedValue({ count: 1 })
    deps.findMonitoringSubjects.mockResolvedValue([{ id: "subject-1", legacyScenarioId: "scenario-1" }])
    deps.parentMatchContextsForComments.mockResolvedValue(new Map())
    deps.ingestMentionWithResult.mockResolvedValue({
      id: "envelope-1",
      created: false,
      accepted: false,
      relevanceStatus: "REVIEW",
      relevanceReason: "comment_on_verified_brand_parent",
      automaticReviewTriage: automaticTriageProvenance({
        status: "REVIEW",
        reason: "comment_on_verified_brand_parent",
        classification: "unknown",
        sentiment: "unknown",
        source: "RULES",
        evidence: "semantic_text_requires_ai",
      }),
    })
    deps.withTenantFence.mockImplementation(async (
      _organizationId: string,
      replay: () => Promise<unknown>,
    ) => ({ allowed: true, value: await replay() }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageClassification: {
        sentiment: null,
        source: "AI",
        version: "ai_sentiment_v1",
        attemptedAt: replayNow,
        errorClass: "UNAVAILABLE",
      },
      automaticTriageExpectedSnapshot,
    })).resolves.toMatchObject({ status: "REVIEW_UNRESOLVED" })
    expect(deps.updateMany).toHaveBeenCalledTimes(3)
    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        relevanceStatus: "REVIEW",
        reviewMutationKey: expect.any(String),
      },
      data: {
        relevanceReason: "automatic_review_sentiment_unresolved",
        relevanceConfidence: 0,
        policySnapshot: expect.objectContaining({
          automaticReviewTriage: expect.objectContaining({
            resolved: false,
            decisionReason: "automatic_review_sentiment_unresolved",
            sentiment: "unknown",
            classifierSource: "AI",
            classifierVersion: "ai_sentiment_v1",
            classifierEvidence: "ai_unavailable",
          }),
        }),
        reviewMutationKey: null,
        reviewMutationUntil: null,
      },
    })
    expect(deps.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "social_review_automatic_unresolved",
        entityName: "automatic_review_sentiment_unresolved",
      }),
    })
  })

  it("keeps a verified-parent row in REVIEW when parent and envelope subjects disagree", async () => {
    deps.parentMatchContextsForComments.mockResolvedValueOnce(new Map([
      ["https://instagram.com/p/post-1", {
        parentMentionId: "parent-mention-other",
        matchedTerm: "Other Brand",
        subjectIds: ["subject-other"],
      }],
    ]))
    deps.findMonitoringSubjects.mockResolvedValue([
      { id: "subject-1", legacyScenarioId: "scenario-1" },
      { id: "subject-other", legacyScenarioId: null },
    ])
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "comment_on_verified_brand_parent",
    }))
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "envelope-1",
      created: false,
      accepted: false,
      relevanceStatus: "REVIEW",
      relevanceReason: "comment_on_verified_brand_parent",
    })

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      automaticTriage: true,
      automaticTriageClassification: {
        sentiment: "negative",
        source: "AI",
        version: "ai_sentiment_v1",
        attemptedAt: replayNow,
      },
      automaticTriageExpectedSnapshot,
    })).resolves.toMatchObject({ status: "REVIEW_UNRESOLVED" })

    const replayInput = deps.ingestMentionWithResult.mock.calls[0][0]
    expect(replayInput).not.toHaveProperty("parentMatchContext")
    expect(replayInput.sourceMetadata).not.toHaveProperty("targetSubjectId")
    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      data: {
        relevanceReason: "automatic_review_technical_unresolved",
        policySnapshot: expect.objectContaining({
          automaticReviewTriage: expect.objectContaining({
            decisionReason: "automatic_review_technical_unresolved",
            classifierSource: "AI",
          }),
        }),
      },
    })
  })

  it.each(["POST", "VIDEO"])(
    "registers a manually accepted TikTok %s for immediate comment revisits after durable acceptance",
    async contentKind => {
      deps.findFirst.mockResolvedValue(envelope({
        relevanceStatus: "REVIEW",
        relevanceReason: "discovery_missing_published_at",
        platform: "tiktok",
        contentKind,
        externalId: "tiktok-video-1",
        postExternalId: "tiktok-video-1",
        url: "https://www.tiktok.com/@creator/video/tiktok-video-1",
        canonicalUrl: "https://www.tiktok.com/@creator/video/tiktok-video-1",
        parentPostUrl: null,
      }))

      await expect(replayIngestEnvelope("org-1", "envelope-1", {
        reviewOverride: true,
      })).resolves.toMatchObject({ status: "REPLAYED" })

      expect(deps.registerTikTokPublicationRevisit).toHaveBeenCalledOnce()
      expect(deps.registerTikTokPublicationRevisit).toHaveBeenCalledWith({
        organizationId: "org-1",
        envelopeId: "envelope-1",
      })
      expect(deps.updateMany.mock.invocationCallOrder[1]).toBeLessThan(
        deps.registerTikTokPublicationRevisit.mock.invocationCallOrder[0],
      )
      expect(deps.registerTikTokPublicationRevisit.mock.invocationCallOrder[0]).toBeLessThan(
        deps.updateMany.mock.invocationCallOrder[2],
      )
    },
  )

  it("registers an auto-review released TikTok video after durable acceptance", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_snippet_only_match",
      platform: "tiktok",
      contentKind: "VIDEO",
      externalId: "tiktok-auto-video",
      postExternalId: "tiktok-auto-video",
      url: "https://www.tiktok.com/@creator/video/tiktok-auto-video",
      canonicalUrl: "https://www.tiktok.com/@creator/video/tiktok-auto-video",
      parentPostUrl: null,
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      autoReviewDecision,
      suppressWorkflows: true,
      suppressMediaScheduling: true,
    })).resolves.toMatchObject({ status: "REPLAYED" })

    expect(deps.registerTikTokPublicationRevisit).toHaveBeenCalledWith({
      organizationId: "org-1",
      envelopeId: "envelope-1",
    })
    expect(deps.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      deps.registerTikTokPublicationRevisit.mock.invocationCallOrder[0],
    )
  })

  it("retries the idempotent TikTok revisit registration for an already accepted operator decision", async () => {
    deps.updateMany.mockResolvedValueOnce({ count: 0 })
    deps.findFirst.mockResolvedValue(envelope({
      acceptedMentionId: "mention-existing",
      relevanceStatus: "ACCEPTED",
      relevanceReason: "operator_review_accept",
      platform: "tiktok",
      contentKind: "VIDEO",
      externalId: "tiktok-video-1",
      postExternalId: "tiktok-video-1",
      url: "https://www.tiktok.com/@creator/video/tiktok-video-1",
      canonicalUrl: "https://www.tiktok.com/@creator/video/tiktok-video-1",
      parentPostUrl: null,
      policySnapshot: {
        replayResolution: {
          action: "operator_review_accept",
          operatorReviewSubjectId: "subject-1",
        },
      },
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      reviewOverride: true,
    })).resolves.toEqual({
      status: "ALREADY_ACCEPTED",
      envelopeId: "envelope-1",
      mentionId: "mention-existing",
      created: false,
      reviewSubjectId: "subject-1",
    })

    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(deps.registerTikTokPublicationRevisit).toHaveBeenCalledOnce()
    expect(deps.registerTikTokPublicationRevisit).toHaveBeenCalledWith({
      organizationId: "org-1",
      envelopeId: "envelope-1",
    })
  })

  it.each(["COMMENT", "REPLY"])(
    "does not register a manually accepted TikTok %s as a publication revisit",
    async contentKind => {
      deps.findFirst.mockResolvedValue(envelope({
        relevanceStatus: "REVIEW",
        relevanceReason: "comment_on_verified_brand_parent",
        platform: "tiktok",
        contentKind,
      }))

      await expect(replayIngestEnvelope("org-1", "envelope-1", {
        reviewOverride: true,
      })).resolves.toMatchObject({ status: "REPLAYED" })

      expect(deps.registerTikTokPublicationRevisit).not.toHaveBeenCalled()
    },
  )

  it("keeps a durable TikTok acceptance retryable when revisit registration fails", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_missing_published_at",
      platform: "tiktok",
      contentKind: "VIDEO",
      externalId: "tiktok-video-1",
      postExternalId: "tiktok-video-1",
      url: "https://www.tiktok.com/@creator/video/tiktok-video-1",
      canonicalUrl: "https://www.tiktok.com/@creator/video/tiktok-video-1",
      parentPostUrl: null,
    }))
    deps.registerTikTokPublicationRevisit.mockResolvedValueOnce(false)

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      reviewOverride: true,
    })).rejects.toThrow("could not be registered for comment collection")

    expect(deps.updateMany.mock.invocationCallOrder[1]).toBeLessThan(
      deps.registerTikTokPublicationRevisit.mock.invocationCallOrder[0],
    )
    expect(deps.registerTikTokPublicationRevisit).toHaveBeenCalledOnce()
  })

  it("preserves reply classification, lineage, parent context, and source date on manual accept", async () => {
    const parentContext = {
      parentMentionId: "parent-mention-1",
      matchedTerm: "Acme Robotics",
      subjectIds: ["subject-1"],
    }
    deps.parentMatchContextsForComments.mockResolvedValueOnce(new Map([
      ["https://instagram.com/p/post-1", parentContext],
    ]))
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "comment_on_verified_brand_parent",
      platform: "facebook",
      contentKind: "REPLY",
      text: "Bu corekler sehv etmiremse 72 saat saxlamaga icazesi var",
      rawPayload: { profileId: "100012345678901" },
      parentExternalId: "comment-parent-1",
      replyToExternalId: "comment-parent-1",
      depth: 1,
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      reviewOverride: true,
      reviewSubjectId: "subject-1",
    })).resolves.toMatchObject({ status: "REPLAYED" })

    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        contentKind: "REPLY",
        sourceType: "reply",
        parentExternalId: "comment-parent-1",
        replyToExternalId: "comment-parent-1",
        depth: 1,
        publishedAt: new Date("2026-07-10T10:00:00.000Z"),
        parentMatchContext: parentContext,
        sourceMetadata: expect.objectContaining({
          socialTriage: { language: "az" },
          authorUrl: "https://www.facebook.com/profile.php?id=100012345678901",
          profileUrl: "https://www.facebook.com/profile.php?id=100012345678901",
        }),
      }),
      expect.objectContaining({
        operatorReviewDecision: {
          envelopeId: "envelope-1",
          subjectId: "subject-1",
        },
      }),
    )
  })

  it("restores parent context by post external ID when a replayed comment has no parent URL", async () => {
    const parentContext = {
      parentMentionId: "parent-mention-by-id",
      matchedTerm: "Acme Robotics",
      subjectIds: ["subject-1"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-1"],
    }
    deps.parentMatchContextsForComments.mockResolvedValueOnce(new Map([
      ["post-1", parentContext],
    ]))
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "comment_on_verified_brand_parent",
      parentPostUrl: null,
      postExternalId: "post-1",
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      reviewOverride: true,
      reviewSubjectId: "subject-1",
    })).resolves.toMatchObject({ status: "REPLAYED" })

    expect(deps.parentMatchContextsForComments).toHaveBeenCalledWith(
      "org-1",
      "instagram",
      [],
      ["post-1"],
    )
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({ parentMatchContext: parentContext }),
      expect.any(Object),
    )
  })

  it("fails manual accept closed when the requested subject is not active envelope provenance", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "comment_on_verified_brand_parent",
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      reviewOverride: true,
      reviewSubjectId: "subject-other",
    })).rejects.toThrow("Review subject is not an active subject linked to this envelope")

    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("keeps an unknown source date null instead of replacing it with the acceptance time", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_missing_published_at",
      publishedAt: null,
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", {
      reviewOverride: true,
    })).resolves.toMatchObject({ status: "REPLAYED" })

    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({ publishedAt: null }),
      expect.objectContaining({
        operatorReviewDecision: {
          envelopeId: "envelope-1",
          subjectId: "subject-1",
        },
      }),
    )
  })

  it("CAS-claims a suppressed release and replays it without workflow or media side effects", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_snippet_only_match",
    }))

    await expect(replayIngestEnvelope(
      "org-1",
      "envelope-1",
      {
        autoReviewDecision,
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      },
    )).resolves.toEqual({
      status: "REPLAYED",
      envelopeId: "envelope-1",
      mentionId: "mention-1",
      created: true,
    })

    expect(deps.executeRaw).toHaveBeenCalledTimes(2)
    const claim = sqlParts(deps.executeRaw.mock.calls[0])
    expect(claim.text).toContain("UPDATE ingest_envelopes AS envelope")
    expect(claim.text).toContain("decision.state = 'SUPPRESSED'")
    expect(claim.text).toContain("decision.action = 'RELEASE_TO_NORMAL_PIPELINE'")
    expect(claim.text).toContain('review_run."subjectId" =')
    expect(claim.text).toContain("review_run.state = 'APPLIED'")
    expect(claim.text).toContain("AND NOT EXISTS")
    expect(claim.text).toContain('envelope."contentHmac" =')
    expect(claim.text).toContain('envelope."updatedAt" =')
    expect(claim.values).toEqual(expect.arrayContaining([
      "org-1",
      "envelope-1",
      "content-hmac-1",
      autoReviewDecision.expectedUpdatedAt,
      autoReviewDecision.expectedPurgeAt,
      "auto-review-decision-1",
      "auto-review-run-1",
      "subject-1",
    ]))

    const reviewMutationKey = claim.values[0]
    expect(reviewMutationKey).toEqual(expect.any(String))
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        sourceMetadata: expect.objectContaining({
          replayedWithoutProviderFetch: true,
          reviewOverride: true,
          autoReviewRunId: "auto-review-run-1",
          autoReviewDecisionId: "auto-review-decision-1",
        }),
        observation: expect.objectContaining({
          relevanceStatus: "ACCEPTED",
          relevanceReason: "auto_review_release",
          policySnapshot: expect.objectContaining({
            replayedWithoutProviderFetch: true,
            autoReviewRunId: "auto-review-run-1",
            autoReviewDecisionId: "auto-review-decision-1",
          }),
        }),
      }),
      {
        envelopeMutationKey: reviewMutationKey,
        autoReviewDecision,
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      },
    )
    expect(deps.updateMany).toHaveBeenCalledOnce()
    expect(deps.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        id: "envelope-1",
        relevanceStatus: "REVIEW",
        purgedAt: null,
        reviewMutationKey,
        AND: autoReviewSuppressionGuards,
      }),
      data: expect.objectContaining({
        acceptedMentionId: "mention-1",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "auto_review_release",
        reviewMutationKey: null,
        reviewMutationUntil: null,
        policySnapshot: expect.objectContaining({
          replayResolution: expect.objectContaining({
            action: "auto_review_release",
            providerFetchPerformed: false,
            autoReviewRunId: "auto-review-run-1",
            autoReviewDecisionId: "auto-review-decision-1",
          }),
        }),
      }),
    })
    const release = sqlParts(deps.executeRaw.mock.calls[1])
    expect(release.text).toContain('"reviewMutationKey" = NULL')
    expect(release.values).toEqual([
      "org-1",
      "envelope-1",
      reviewMutationKey,
    ])
  })

  it("keeps current relevance authoritative and releases the auto-review lease", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_snippet_only_match",
    }))
    deps.ingestMentionWithResult.mockResolvedValueOnce({
      id: "new-review-envelope",
      envelopeId: "new-review-envelope",
      created: false,
      accepted: false,
    })

    await expect(replayIngestEnvelope(
      "org-1",
      "envelope-1",
      {
        autoReviewDecision,
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      },
    )).resolves.toEqual({
      status: "REJECTED_BY_CURRENT_RELEVANCE",
      envelopeId: "envelope-1",
      mentionId: null,
      created: false,
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        autoReviewDecision,
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      }),
    )
    expect(deps.updateMany).not.toHaveBeenCalled()
    expect(deps.executeRaw).toHaveBeenCalledTimes(2)
    expect(sqlParts(deps.executeRaw.mock.calls[1]).text).toContain(
      '"reviewMutationKey" = NULL',
    )
  })

  it.each([
    {
      name: "the current decision is no longer REVIEW",
      overrides: {
        relevanceStatus: "REJECTED",
        relevanceReason: "operator_review_reject",
      },
    },
    {
      name: "the apply-time updatedAt snapshot changed",
      overrides: {
        relevanceStatus: "REVIEW",
        updatedAt: new Date("2026-07-23T11:01:00.000Z"),
      },
    },
  ])("returns a terminal SUPERSEDED result when $name", async ({ overrides }) => {
    deps.executeRaw.mockResolvedValueOnce(0)
    deps.findFirst.mockResolvedValueOnce(envelope(overrides))

    await expect(replayIngestEnvelope(
      "org-1",
      "envelope-1",
      {
        autoReviewDecision,
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      },
    )).resolves.toEqual({
      status: "SUPERSEDED",
      envelopeId: "envelope-1",
      mentionId: null,
      created: false,
    })

    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(deps.updateMany).not.toHaveBeenCalled()
    expect(deps.executeRaw).toHaveBeenCalledOnce()
  })

  it("keeps a competing valid auto-review lease retryable", async () => {
    deps.executeRaw.mockResolvedValueOnce(0)
    deps.findFirst.mockResolvedValueOnce(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_snippet_only_match",
      reviewMutationKey: "other-worker",
      reviewMutationUntil: new Date("2026-07-23T12:10:00.000Z"),
    }))

    await expect(replayIngestEnvelope(
      "org-1",
      "envelope-1",
      {
        autoReviewDecision,
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      },
    )).rejects.toThrow("review action is already in progress")

    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(deps.updateMany).not.toHaveBeenCalled()
    expect(deps.executeRaw).toHaveBeenCalledOnce()
  })

  it("borrows one review lease through nested ingest, outer finalize CAS, and release", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_missing_published_at",
    }))

    await expect(replayIngestEnvelope(
      "org-1",
      "envelope-1",
      { reviewOverride: true },
    )).resolves.toMatchObject({ status: "REPLAYED" })

    expect(deps.updateMany).toHaveBeenCalledTimes(3)
    const claim = deps.updateMany.mock.calls[0][0]
    const reviewMutationKey = claim.data.reviewMutationKey
    const reviewMutationUntil = new Date(replayNow.getTime() + 15 * 60_000)
    expect(reviewMutationKey).toEqual(expect.any(String))
    expect(claim).toEqual({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        relevanceStatus: "REVIEW",
        acceptedMentionId: null,
        purgedAt: null,
        purgeAt: { gt: reviewMutationUntil },
        discoveryAutoReviewDecisions: suppressedDecisionGuard,
        OR: [
          { reviewMutationUntil: null },
          { reviewMutationUntil: { lte: replayNow } },
        ],
      },
      data: {
        reviewMutationKey,
        reviewMutationUntil,
      },
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledOnce()
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        observation: expect.objectContaining({
          relevanceStatus: "ACCEPTED",
          relevanceReason: "operator_review_accept",
        }),
      }),
      expect.objectContaining({
        envelopeMutationKey: reviewMutationKey,
        operatorReviewDecision: {
          envelopeId: "envelope-1",
          subjectId: "subject-1",
        },
      }),
    )
    expect(deps.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        AND: [{
          discoveryAutoReviewDecisions: suppressedDecisionGuard,
        }],
        reviewMutationKey,
      },
      include: expect.any(Object),
    })
    expect(deps.updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        relevanceStatus: "REVIEW",
        purgedAt: null,
        AND: [{
          discoveryAutoReviewDecisions: suppressedDecisionGuard,
        }],
        reviewMutationKey,
        reviewMutationUntil: { gt: replayNow },
      },
      data: {
        acceptedMentionId: "mention-1",
        relevanceStatus: "ACCEPTED",
        reviewMutationKey: null,
        reviewMutationUntil: null,
      },
    })
    expect(deps.updateMany.mock.calls[2][0]).toEqual({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        reviewMutationKey,
      },
      data: {
        reviewMutationKey: null,
        reviewMutationUntil: null,
      },
    })
    expect(deps.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      deps.ingestMentionWithResult.mock.invocationCallOrder[0],
    )
  })

  it("releases a claimed review lease in finally when ingest persistence fails", async () => {
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_missing_published_at",
    }))
    deps.ingestMentionWithResult.mockRejectedValueOnce(
      new Error("mention persistence failed"),
    )

    await expect(replayIngestEnvelope(
      "org-1",
      "envelope-1",
      { reviewOverride: true },
    )).rejects.toThrow("mention persistence failed")

    expect(deps.updateMany).toHaveBeenCalledTimes(2)
    const reviewMutationKey = deps.updateMany.mock.calls[0][0]
      .data.reviewMutationKey
    expect(deps.updateMany.mock.calls[1][0]).toEqual({
      where: {
        organizationId: "org-1",
        id: "envelope-1",
        reviewMutationKey,
      },
      data: {
        reviewMutationKey: null,
        reviewMutationUntil: null,
      },
    })
  })

  it("releases a claimed auto-review lease in finally when nested ingest fails", async () => {
    deps.executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
    deps.findFirst.mockResolvedValue(envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_missing_published_at",
    }))
    deps.ingestMentionWithResult.mockRejectedValueOnce(
      new Error("nested mention persistence failed"),
    )

    await expect(replayIngestEnvelope(
      "org-1",
      "envelope-1",
      {
        autoReviewDecision,
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      },
    )).rejects.toThrow("nested mention persistence failed")

    expect(deps.executeRaw).toHaveBeenCalledTimes(2)
    const claim = sqlParts(deps.executeRaw.mock.calls[0])
    const release = sqlParts(deps.executeRaw.mock.calls[1])
    expect(claim.text).toContain('"reviewMutationKey" =')
    expect(release.text).toContain('"reviewMutationKey" = NULL')
    expect(release.values).toEqual(expect.arrayContaining([
      "org-1",
      "envelope-1",
    ]))
    expect(deps.updateMany).not.toHaveBeenCalled()
  })

  it("does not promote an official-archive-like REVIEW envelope merely because it has a mention link", async () => {
    deps.updateMany.mockResolvedValueOnce({ count: 0 })
    deps.findFirst.mockResolvedValue(envelope({
      acceptedMentionId: "mention-existing",
      relevanceStatus: "REVIEW",
      relevanceReason: "official_author",
    }))

    await expect(replayIngestEnvelope("org-1", "envelope-1", { reviewOverride: true })).rejects.toThrow(
      "linked mention is not accepted",
    )
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(deps.updateMany).toHaveBeenCalledTimes(1)
  })

  it("treats a concurrent identical accept as idempotent", async () => {
    const awaitingReview = envelope({
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_missing_published_at",
    })
    deps.findFirst
      .mockResolvedValueOnce(awaitingReview)
      .mockResolvedValueOnce({
        acceptedMentionId: "mention-1",
        relevanceStatus: "ACCEPTED",
        purgedAt: null,
      })
    deps.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    await expect(replayIngestEnvelope("org-1", "envelope-1", { reviewOverride: true })).resolves.toMatchObject({
      status: "REPLAYED",
      mentionId: "mention-1",
    })
  })

  it("checks purge/expiry before honoring an existing mention link", async () => {
    deps.updateMany.mockResolvedValueOnce({ count: 0 })
    deps.findFirst.mockResolvedValueOnce(envelope({
      acceptedMentionId: "mention-existing",
      purgedAt: new Date(),
      relevanceStatus: "PURGED",
    }))
    await expect(replayIngestEnvelope("org-1", "envelope-1", { reviewOverride: true })).rejects.toThrow(
      "payload has been purged",
    )

    deps.updateMany.mockResolvedValueOnce({ count: 0 })
    deps.findFirst.mockResolvedValueOnce(envelope({
      acceptedMentionId: "mention-existing",
      purgeAt: new Date("2000-01-01T00:00:00.000Z"),
    }))
    await expect(replayIngestEnvelope("org-1", "envelope-1", { reviewOverride: true })).rejects.toThrow(
      "payload has expired",
    )
    expect(deps.updateMany).toHaveBeenCalledTimes(2)
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("does not let the review override widen replay to rejected or purged envelopes", async () => {
    deps.findFirst.mockResolvedValueOnce(envelope({ relevanceStatus: "REJECTED" }))
    await expect(replayIngestEnvelope("org-1", "envelope-1", { reviewOverride: true })).rejects.toThrow(
      "Ingest envelope is not eligible for replay",
    )

    deps.findFirst.mockResolvedValueOnce(envelope({ purgedAt: new Date(), relevanceStatus: "PURGED" }))
    await expect(replayIngestEnvelope("org-1", "envelope-1", { reviewOverride: true })).rejects.toThrow(
      "payload has been purged",
    )
  })
})
