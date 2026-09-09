import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  executeWorkflows,
  classifySentiment,
  crudeSentiment,
  createLegalCandidate,
  getOrCreateLegalPolicy,
} = vi.hoisted(() => ({
  executeWorkflows: vi.fn(async () => undefined),
  classifySentiment: vi.fn(async () => "neutral"),
  crudeSentiment: vi.fn(() => "neutral"),
  createLegalCandidate: vi.fn(async () => ({ id: "candidate-1" })),
  getOrCreateLegalPolicy: vi.fn(async () => ({
    enabled: true,
    allowedCategories: [
      "insult",
      "defamation",
      "false_accusation",
      "threat",
      "complaint",
      "reputation_risk",
    ],
  })),
}))

vi.mock("@/lib/workflow-engine", () => ({
  executeWorkflows,
}))

vi.mock("@/lib/sentiment", () => ({ classifySentiment, crudeSentiment }))

vi.mock("@/lib/social/legal-workflow", () => ({
  createLegalCandidate,
  getOrCreateLegalPolicy,
}))

vi.mock("@/lib/prisma", () => {
  const client = {
    socialMention: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    socialMentionVersion: {
      create: vi.fn(),
    },
    mentionCluster: {
      upsert: vi.fn(),
    },
    ingestEnvelope: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    rejectedObservationFingerprint: {
      upsert: vi.fn(),
    },
    channelConfig: {
      findFirst: vi.fn(),
    },
    monitoringSubject: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    socialMentionSubjectMatch: {
      create: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
  }
  return {
    prisma: {
      ...client,
      $transaction: vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client)),
    },
  }
})

import { prisma } from "@/lib/prisma"
import { ingestMention, ingestMentionWithResult, normalizeMentionUrl } from "@/lib/social/ingest-mention"
import {
  AUTOMATIC_REVIEW_AI_VERSION,
  AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
} from "@/lib/social/automatic-review-triage"
import { SOCIAL_SCENARIO_MATCH_VERSION } from "@/lib/social/monitoring-scenarios"

const findUnique = vi.mocked(prisma.socialMention.findUnique)
const findFirst = vi.mocked(prisma.socialMention.findFirst)
const findMany = vi.mocked(prisma.socialMention.findMany)
const update = vi.mocked(prisma.socialMention.update)
const markDeleted = vi.mocked(prisma.socialMention.updateMany)
const create = vi.mocked(prisma.socialMention.create)
const upsertCluster = vi.mocked(prisma.mentionCluster.upsert)
const createVersion = vi.mocked(prisma.socialMentionVersion.create)
const findScenarioConfig = vi.mocked(prisma.channelConfig.findFirst)
const upsertEnvelope = vi.mocked(prisma.ingestEnvelope.upsert)
const updateEnvelope = vi.mocked(prisma.ingestEnvelope.updateMany)
const findEnvelope = vi.mocked(prisma.ingestEnvelope.findFirst)
const upsertRejectedFingerprint = vi.mocked(prisma.rejectedObservationFingerprint.upsert)
const findMonitoringSubjects = vi.mocked(prisma.monitoringSubject.findMany)
const createSubjectMatch = vi.mocked(prisma.socialMentionSubjectMatch.create)
const upsertSubjectMatch = vi.mocked(prisma.socialMentionSubjectMatch.upsert)
const updateSubjectMatch = vi.mocked(prisma.socialMentionSubjectMatch.updateMany)

const input = {
  organizationId: "org-1",
  accountId: null,
  platform: "tiktok",
  externalId: "cw-555",
  sourceType: "comment",
  sourceProvider: "chatwoot",
  sourceMetadata: { chatwootConversationId: "42" },
  text: "Salam, elaqe ucun +994501112233",
  sentiment: "neutral" as const,
  sentimentClassification: {
    source: "AI" as const,
    version: "ai_sentiment_v1",
  },
  matchedTerm: "elaqe",
  engagement: 1,
  reach: 0,
  url: "https://www.tiktok.com/@brand/video/1",
  authorName: "Aysel",
  authorHandle: "aysel",
  authorAvatar: "https://cdn.example/avatar.jpg",
  publishedAt: new Date("2026-06-29T10:00:00.000Z"),
}

function monitoringSubject(id: string, name: string, weight = 1) {
  return {
    id,
    organizationId: "org-1",
    type: "BRAND",
    name,
    status: "active",
    requiredContext: [],
    exclusions: [],
    aliases: [{
      id: `alias-${id}`,
      subjectId: id,
      organizationId: "org-1",
      kind: "NAME",
      value: name,
      normalizedValue: name.toLocaleLowerCase(),
      language: null,
      weight,
      isNegative: false,
      isAmbiguous: false,
    }],
    sources: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  executeWorkflows.mockResolvedValue(undefined)
  createLegalCandidate.mockResolvedValue({ id: "candidate-1" })
  getOrCreateLegalPolicy.mockResolvedValue({
    enabled: true,
    allowedCategories: [
      "insult",
      "defamation",
      "false_accusation",
      "threat",
      "complaint",
      "reputation_risk",
    ],
  })
  create.mockReset()
  findUnique.mockResolvedValue(null)
  findMany.mockResolvedValue([])
  findFirst.mockResolvedValue(null)
  createVersion.mockResolvedValue({ id: "version-2" } as never)
  findScenarioConfig.mockResolvedValue(null as never)
  findMonitoringSubjects.mockResolvedValue([] as never)
  upsertCluster.mockResolvedValue({ id: "cluster-1" } as never)
  update.mockResolvedValue({ id: "m-updated" })
  upsertEnvelope.mockResolvedValue({ id: "env-1", acceptedMentionId: null, relevanceStatus: "ACCEPTED" } as never)
  updateEnvelope.mockResolvedValue({ count: 1 } as never)
  findEnvelope.mockResolvedValue(null)
  createSubjectMatch.mockResolvedValue({ id: "subject-match-1" } as never)
  upsertSubjectMatch.mockResolvedValue({ id: "subject-match-1" } as never)
  updateSubjectMatch.mockResolvedValue({ count: 0 } as never)
})

describe("ingestMentionWithResult", () => {
  it("normalizes URLs for fallback duplicate matching", () => {
    expect(normalizeMentionUrl("https://www.instagram.com/p/ABC/?utm_source=x&b=2&a=1#frag")).toBe("https://instagram.com/p/ABC?a=1&b=2")
  })

  it.each(["COMMENT", "REPLY"] as const)(
    "rejects a positive direct %s before creating a feed mention",
    async contentKind => {
      upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
        id: `env-positive-${contentKind.toLowerCase()}`,
        acceptedMentionId: null,
        relevanceStatus: args.create.relevanceStatus,
        reviewMutationKey: args.create.reviewMutationKey,
      }) as never)

      await expect(ingestMentionWithResult({
        ...input,
        externalId: `positive-${contentKind.toLowerCase()}`,
        contentKind,
        sourceType: contentKind === "REPLY" ? "reply" : "comment",
        text: "Excellent service, thank you",
        sentiment: "positive",
        sentimentClassification: {
          source: "AI",
          version: AUTOMATIC_REVIEW_AI_VERSION,
        },
      })).resolves.toMatchObject({
        accepted: false,
        relevanceStatus: "REJECTED",
        relevanceReason: "automatic_review_positive_comment",
      })

      expect(create).not.toHaveBeenCalled()
      expect(upsertEnvelope).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          relevanceStatus: "REJECTED",
          relevanceReason: "automatic_review_positive_comment",
        }),
      }))
    },
  )

  // #646: текст отклонённых записей рождался вычищенным и жил сутки, поэтому
  // ИИ-судье было нечего читать — а это крупнейший класс потерь (прод: 9570
  // записей за шесть дней). Кандидаты судьи теперь сохраняются.
  it("retains the text of a record rejected for having no subject match", async () => {
    // Объект мониторинга есть, но в тексте его нет: именно так и рождается
    // no_monitoring_subject_match.
    findMonitoringSubjects.mockResolvedValue([
      monitoringSubject("subject-judge", "Acme Robotics"),
    ] as never)
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-judge-candidate",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
      reviewMutationKey: args.create.reviewMutationKey,
    }) as never)

    await expect(ingestMentionWithResult({
      ...input,
      externalId: "judge-candidate",
      contentKind: "POST",
      sourceType: "mention",
      text: "заказ так и не привезли, третий день жду",
    })).resolves.toMatchObject({
      accepted: false,
      relevanceStatus: "REJECTED",
      relevanceReason: "no_monitoring_subject_match",
    })

    const created = upsertEnvelope.mock.calls.at(-1)?.[0]?.create as Record<string, unknown>
    expect(created).toMatchObject({
      relevanceReason: "no_monitoring_subject_match",
      text: "заказ так и не привезли, третий день жду",
      authorName: input.authorName,
    })
    // Судье нужен текст, но не аватар живого человека и не сырой ответ
    // провайдера — они остаются невычищенными только у настоящих находок.
    expect(created.authorAvatar).toBeNull()
    expect(created.rawPayload).toEqual({})
    // Срок хранения дольше суток: иначе судить будет нечего.
    expect((created.purgeAt as Date).getTime())
      .toBeGreaterThan(Date.now() + 7 * 86_400_000)
  })

  it("does not let UNKNOWN contentKind bypass a comment sourceType policy", async () => {
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-positive-unknown-kind",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
      reviewMutationKey: args.create.reviewMutationKey,
    }) as never)

    await expect(ingestMentionWithResult({
      ...input,
      externalId: "positive-unknown-kind",
      contentKind: "UNKNOWN",
      sourceType: "comment",
      text: "Excellent service, thank you",
      sentiment: "positive",
      sentimentClassification: {
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
      },
    })).resolves.toMatchObject({
      accepted: false,
      relevanceStatus: "REJECTED",
      relevanceReason: "automatic_review_positive_comment",
    })
    expect(upsertEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ contentKind: "COMMENT" }),
    }))
    expect(create).not.toHaveBeenCalled()
  })

  it("queues an unknown direct comment instead of admitting it optimistically", async () => {
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-direct-comment-awaiting-ai",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
      reviewMutationKey: args.create.reviewMutationKey,
    }) as never)

    await expect(ingestMentionWithResult({
      ...input,
      externalId: "direct-comment-awaiting-ai",
      contentKind: "COMMENT",
      sourceType: "comment",
      text: "The store closes at 22:00",
      sentiment: null,
      sentimentClassification: undefined,
    })).resolves.toMatchObject({
      accepted: false,
      relevanceStatus: "REVIEW",
      relevanceReason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
      automaticReviewTriage: expect.objectContaining({
        classification: "unknown",
        classifierEvidence: "semantic_text_requires_ai",
      }),
    })

    expect(create).not.toHaveBeenCalled()
  })

  it("creates a new mention and fires social_mention workflows", async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({ id: "m-new", ...input })

    const result = await ingestMentionWithResult(input)

    expect(result).toEqual({ id: "m-new", created: true })
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        accountId: null,
        platform: "tiktok",
        externalId: "cw-555",
        sourceType: "comment",
        contentKind: "COMMENT",
        sourceProvider: "chatwoot",
        sourceMetadata: expect.objectContaining({ chatwootConversationId: "42" }),
        authorAvatar: "https://cdn.example/avatar.jpg",
        publishedAt: new Date("2026-06-29T10:00:00.000Z"),
      }),
    })
    const createData = create.mock.calls[0]?.[0].data
    expect(createData.versions).toEqual({
      create: expect.objectContaining({
        publishedAt: new Date("2026-06-29T10:00:00.000Z"),
      }),
    })
    expect(createData.versions.create).not.toHaveProperty("organizationId")
    expect(upsertCluster).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        organizationId: "org-1",
        primaryMentionId: "m-new",
        mentionCount: 1,
      }),
      update: expect.objectContaining({
        mentionCount: { increment: 1 },
      }),
    }))
    expect(update).toHaveBeenCalledWith({
      where: { organizationId_id: { organizationId: "org-1", id: "m-new" } },
      data: { clusterId: "cluster-1" },
    })
    expect(executeWorkflows).toHaveBeenCalledWith(
      "org-1",
      "social_mention",
      "created",
      expect.objectContaining({ id: "m-new", platform: "tiktok" }),
    )
  })

  it("opens automatic legal intake for a newly created risky mention", async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({
      id: "m-new-risk",
      ...input,
      text: "This brand is a scammer",
    })

    await ingestMentionWithResult({
      ...input,
      text: "This brand is a scammer",
    })

    expect(getOrCreateLegalPolicy).toHaveBeenCalledWith("org-1")
    expect(createLegalCandidate).toHaveBeenCalledWith({
      organizationId: "org-1",
      mentionId: "m-new-risk",
      runAi: false,
    })
  })

  it("does not reopen automatic legal intake for an existing risky mention", async () => {
    findUnique.mockResolvedValue({
      id: "m-existing-risk",
      matchedTerm: input.matchedTerm,
      sourceMetadata: input.sourceMetadata,
    } as never)

    await expect(ingestMentionWithResult({
      ...input,
      text: "This brand is a scammer",
    })).resolves.toEqual({ id: "m-existing-risk", created: false })

    expect(getOrCreateLegalPolicy).not.toHaveBeenCalled()
    expect(createLegalCandidate).not.toHaveBeenCalled()
  })

  it("waits for social_mention workflows before completing ingestion", async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({ id: "m-new", ...input })

    let releaseWorkflow!: () => void
    const workflowPending = new Promise<void>((resolve) => {
      releaseWorkflow = resolve
    })
    executeWorkflows.mockReturnValueOnce(workflowPending)

    let settled = false
    const ingestion = ingestMentionWithResult(input).then((result) => {
      settled = true
      return result
    })

    await vi.waitFor(() => expect(executeWorkflows).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseWorkflow()
    await expect(ingestion).resolves.toEqual({ id: "m-new", created: true })
  })

  it("creates rejected observations already scrubbed and never persists them as mentions", async () => {
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-rejected",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
    }) as never)
    upsertRejectedFingerprint.mockResolvedValue({ id: "fingerprint-1" } as never)

    const result = await ingestMentionWithResult({
      ...input,
      text: "Completely unrelated comment",
      sentiment: "neutral",
      matchedTerm: null,
      observation: {
        sourceId: "source-1",
        routePlanId: "route-1",
        adapterKey: "APIFY_ASYNC",
        providerKey: "APIFY",
        providerItemId: "provider-item-1",
        acquisitionMode: "APIFY_FALLBACK",
        requireMatchedTerm: true,
        rawPayload: { text: "Completely unrelated comment", username: "raw-user", url: "https://example.com/raw" },
      },
    })

    expect(result).toMatchObject({ id: "env-rejected", created: false, accepted: false })
    expect(upsertEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        relevanceStatus: "REJECTED",
        relevanceReason: "external_comment_has_no_own_subject_match",
        text: null,
        authorName: null,
        authorHandle: null,
        authorAvatar: null,
        url: null,
        canonicalUrl: null,
        parentPostUrl: null,
        rawPayload: {},
      }),
    }))
    expect(upsertRejectedFingerprint).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ adapterKey: "APIFY_ASYNC", providerKey: "APIFY", reasonCode: "external_comment_has_no_own_subject_match" }),
    }))
    expect(create).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
    expect(classifySentiment).not.toHaveBeenCalled()
  })

  it("marks an existing tenant comment source-deleted without recreating analytics", async () => {
    const deletedAtSource = new Date("2026-07-18T12:00:00Z")
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-deleted", acceptedMentionId: null, relevanceStatus: args.create.relevanceStatus,
    }) as never)
    markDeleted.mockResolvedValue({ count: 1 })

    await expect(ingestMentionWithResult({
      ...input,
      deletedAtSource,
      observation: { adapterKey: "BRIGHT_DATA_TIKTOK_COMMENTS", providerKey: "bright-data" },
    })).resolves.toMatchObject({ accepted: false, envelopeId: "env-deleted" })

    expect(markDeleted).toHaveBeenCalledWith({
      where: { organizationId: "org-1", platform: "tiktok", externalId: input.externalId, deletedAtSource: null },
      data: { deletedAtSource, status: "ignored" },
    })
    expect(create).not.toHaveBeenCalled()
  })

  it("archives official posts without sentiment, workflows, or matched client status", async () => {
    findMonitoringSubjects.mockResolvedValue([{
      id: "subject-bravo",
      organizationId: "org-1",
      name: "Bravo Supermarket",
      requiredContext: [],
      exclusions: [],
      aliases: [],
      sources: [{
        id: "link-official",
        sourceId: "source-official",
        relationType: "OFFICIAL",
        trustWeight: 1,
        source: {
          id: "source-official",
          platform: "instagram",
          sourceType: "profile",
          handle: "bravosupermarketaz",
          url: "https://instagram.com/bravosupermarketaz",
        },
      }],
    }] as never)
    create.mockResolvedValue({
      id: "m-official",
      ...input,
      platform: "instagram",
      externalId: "official-1",
      sourceType: "post",
      authorHandle: "bravosupermarketaz",
      sentiment: null,
    })
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-official",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
    }) as never)

    const result = await ingestMentionWithResult({
      ...input,
      platform: "instagram",
      externalId: "official-1",
      sourceType: "post",
      contentKind: "POST",
      text: "Bravo Supermarket endirimləri",
      authorHandle: "bravosupermarketaz",
      sentiment: null,
      matchedTerm: null,
      sourceProvider: "official_discovery",
    })

    expect(result).toEqual({
      id: "m-official",
      created: true,
      accepted: false,
      envelopeId: "env-official",
      relevanceStatus: "REJECTED",
    })
    expect(upsertEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        relevanceStatus: "REJECTED",
        relevanceReason: "official_author",
        text: "Bravo Supermarket endirimləri",
        authorHandle: "bravosupermarketaz",
        url: input.url,
      }),
    }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceMetadata: expect.objectContaining({ officialArchive: true }),
        sentiment: null,
      }),
    }))
    expect(createSubjectMatch).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        subjectId: "subject-bravo",
        status: "REJECTED",
        reason: "official_author",
      }),
    }))
    expect(updateEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ acceptedMentionId: "m-official" }),
    }))
    expect(classifySentiment).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
    expect(upsertRejectedFingerprint).not.toHaveBeenCalled()
  })

  it("retains thread context durably without creating an analytics mention", async () => {
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-context",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
    }) as never)

    const result = await ingestMentionWithResult({
      ...input,
      externalId: "context-comment-1",
      matchedTerm: null,
      observation: {
        adapterKey: "BRIGHT_DATA_TIKTOK_COMMENTS",
        providerKey: "bright-data",
        relevanceStatus: "REVIEW",
        relevanceReason: "thread_context_for_actionable_descendant",
        relevanceConfidence: 1,
        rawPayload: { retainedForThreadContext: true },
      },
    })

    expect(result).toEqual({
      id: "env-context",
      created: false,
      accepted: false,
      envelopeId: "env-context",
      relevanceStatus: "REVIEW",
      relevanceReason: "thread_context_for_actionable_descendant",
    })
    expect(upsertEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        relevanceStatus: "REVIEW",
        relevanceReason: "thread_context_for_actionable_descendant",
        text: input.text,
        rawPayload: { retainedForThreadContext: true },
      }),
    }))
    expect(create).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
  })

  it("promotes collector review to an accepted comment under a matched negative parent", async () => {
    findMonitoringSubjects.mockResolvedValue([
      monitoringSubject("subject-target", "Acme Robotics"),
    ] as never)
    create.mockResolvedValue({
      id: "mention-negative-parent-comment",
      ...input,
      externalId: "negative-parent-comment",
      text: "Store closes at 22:00",
      sentiment: "neutral",
      matchedTerm: null,
    })
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-negative-parent-comment",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
      reviewMutationKey: args.create.reviewMutationKey,
    }) as never)

    await expect(ingestMentionWithResult({
      ...input,
      externalId: "negative-parent-comment",
      contentKind: "COMMENT",
      sourceType: "comment",
      sourceProvider: "provider_api",
      text: "Store closes at 22:00",
      sentiment: "neutral",
      sentimentClassification: {
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
      },
      matchedTerm: null,
      parentMatchContext: {
        parentMentionId: "negative-parent",
        matchedTerm: "Acme Robotics",
        subjectIds: ["subject-target"],
        parentSentiment: "negative",
        inheritAllCommentSubjectIds: ["subject-target"],
      },
      observation: {
        adapterKey: "APIFY_ASYNC",
        relevanceStatus: "REVIEW",
        relevanceReason: "comment_on_verified_brand_parent",
        relevanceConfidence: 0.4,
        requireMatchedTerm: true,
      },
    })).resolves.toMatchObject({ id: "mention-negative-parent-comment", created: true })

    expect(upsertEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        relevanceStatus: "ACCEPTED",
        relevanceReason: "negative_parent_post_inheritance",
        relevanceConfidence: 1,
      }),
    }))
    expect(createSubjectMatch).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        subjectId: "subject-target",
        status: "MATCHED",
        reason: "negative_parent_post_inheritance",
        confidence: 1,
        contextSignals: expect.objectContaining({
          parentMentionId: "negative-parent",
          inheritancePolicy: "all_comments_v1",
        }),
      }),
    }))
    expect(classifySentiment).not.toHaveBeenCalled()
    expect(crudeSentiment).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
    expect(createLegalCandidate).not.toHaveBeenCalled()
  })

  it("keeps a negative inherited comment actionable while suppressing neutral thread context", async () => {
    findMonitoringSubjects.mockResolvedValue([
      monitoringSubject("subject-target", "Acme Robotics"),
    ] as never)
    create.mockResolvedValue({
      id: "mention-negative-inherited-comment",
      ...input,
      externalId: "negative-inherited-comment",
      contentKind: "COMMENT",
      text: "This service is terrible",
      sentiment: "negative",
      matchedTerm: null,
    })
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-negative-inherited-comment",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
      reviewMutationKey: args.create.reviewMutationKey,
    }) as never)

    await ingestMentionWithResult({
      ...input,
      externalId: "negative-inherited-comment",
      contentKind: "COMMENT",
      sourceType: "comment",
      sourceProvider: "provider_api",
      text: "This service is terrible",
      sentiment: null,
      matchedTerm: null,
      parentMatchContext: {
        parentMentionId: "negative-parent",
        matchedTerm: "Acme Robotics",
        subjectIds: ["subject-target"],
        parentSentiment: "negative",
        inheritAllCommentSubjectIds: ["subject-target"],
      },
      observation: {
        adapterKey: "APIFY_ASYNC",
        relevanceStatus: "REVIEW",
        relevanceReason: "comment_on_verified_brand_parent",
        relevanceConfidence: 0.4,
        requireMatchedTerm: true,
      },
    })

    expect(executeWorkflows).toHaveBeenCalledOnce()
  })

  it.each([
    ["COMMENT", "positive", "Excellent service, thank you", false, "automatic_review_positive_parent_comment"],
    ["COMMENT", "negative", "Empty shelves again", true, "negative_parent_post_inheritance"],
    ["COMMENT", "neutral", "The store closes at 22:00", true, "negative_parent_post_inheritance"],
    ["REPLY", "positive", "Excellent service, thank you", false, "automatic_review_positive_parent_comment"],
    ["REPLY", "negative", "Empty shelves again", true, "negative_parent_post_inheritance"],
    ["REPLY", "neutral", "The store closes at 22:00", true, "negative_parent_post_inheritance"],
  ] as const)(
    "persists only negative/neutral %s rows inherited from a negative parent (%s)",
    async (contentKind, sentiment, text, shouldPersist, expectedReason) => {
      findMonitoringSubjects.mockResolvedValue([
        monitoringSubject("subject-target", "Acme Robotics"),
      ] as never)
      const externalId = `${contentKind.toLowerCase()}-${sentiment}-under-negative-parent`
      create.mockResolvedValue({
        id: `mention-${externalId}`,
        ...input,
        externalId,
        contentKind,
        text,
        sentiment,
        ...(sentiment !== "positive" ? {
          sentimentClassification: {
            source: "AI" as const,
            version: AUTOMATIC_REVIEW_AI_VERSION,
          },
        } : {}),
        matchedTerm: null,
      })
      upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
        id: `env-${externalId}`,
        acceptedMentionId: null,
        relevanceStatus: args.create.relevanceStatus,
        reviewMutationKey: args.create.reviewMutationKey,
      }) as never)

      const result = await ingestMentionWithResult({
        ...input,
        externalId,
        contentKind,
        sourceType: contentKind === "REPLY" ? "reply" : "comment",
        sourceProvider: "provider_api",
        text,
        sentiment,
        ...(sentiment !== "positive" ? {
          sentimentClassification: {
            source: "AI" as const,
            version: AUTOMATIC_REVIEW_AI_VERSION,
          },
        } : {}),
        matchedTerm: null,
        ...(contentKind === "REPLY" ? {
          parentExternalId: "comment-parent-1",
          replyToExternalId: "comment-parent-1",
          depth: 1,
        } : {}),
        parentMatchContext: {
          parentMentionId: "negative-parent",
          matchedTerm: "Acme Robotics",
          subjectIds: ["subject-target"],
          parentSentiment: "negative",
          inheritAllCommentSubjectIds: ["subject-target"],
        },
        observation: {
          adapterKey: "APIFY_ASYNC",
          relevanceStatus: "REVIEW",
          relevanceReason: "comment_on_verified_brand_parent",
          relevanceConfidence: 0.4,
          requireMatchedTerm: true,
        },
      })

      expect(upsertEnvelope).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          relevanceStatus: shouldPersist ? "ACCEPTED" : "REJECTED",
          relevanceReason: expectedReason,
          policySnapshot: expect.objectContaining({
            automaticReviewTriage: expect.objectContaining({
              sentiment,
              classifierSource: sentiment === "positive" ? "RULES" : "AI",
              providerFetchPerformed: false,
            }),
          }),
        }),
      }))
      expect(classifySentiment).not.toHaveBeenCalled()

      if (shouldPersist) {
        expect(result).toMatchObject({ id: `mention-${externalId}`, created: true })
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({
            sentiment,
            policySnapshot: expect.objectContaining({
              automaticReviewTriage: expect.objectContaining({
                sentiment,
                classifierSource: "AI",
                providerFetchPerformed: false,
              }),
            }),
          }),
        }))
      } else {
        expect(result).toMatchObject({
          id: `env-${externalId}`,
          accepted: false,
          relevanceStatus: "REJECTED",
          relevanceReason: expectedReason,
        })
        expect(create).not.toHaveBeenCalled()
      }
    },
  )

  it("keeps an undecidable inherited comment in REVIEW until the bounded AI worker runs", async () => {
    findMonitoringSubjects.mockResolvedValue([
      monitoringSubject("subject-target", "Acme Robotics"),
    ] as never)
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-parent-comment-awaiting-ai",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
      reviewMutationKey: args.create.reviewMutationKey,
    }) as never)

    await expect(ingestMentionWithResult({
      ...input,
      externalId: "parent-comment-awaiting-ai",
      contentKind: "COMMENT",
      sourceType: "comment",
      sourceProvider: "provider_api",
      text: "The store closes at 22:00",
      sentiment: null,
      matchedTerm: null,
      parentMatchContext: {
        parentMentionId: "negative-parent",
        matchedTerm: "Acme Robotics",
        subjectIds: ["subject-target"],
        parentSentiment: "negative",
        inheritAllCommentSubjectIds: ["subject-target"],
      },
      observation: {
        adapterKey: "APIFY_ASYNC",
        relevanceStatus: "REVIEW",
        relevanceReason: "comment_on_verified_brand_parent",
        relevanceConfidence: 0.4,
        requireMatchedTerm: true,
      },
    })).resolves.toMatchObject({
      id: "env-parent-comment-awaiting-ai",
      accepted: false,
      relevanceStatus: "REVIEW",
      relevanceReason: "negative_parent_post_inheritance",
      automaticReviewTriage: expect.objectContaining({
        resolved: false,
        classification: "unknown",
        sentiment: "unknown",
        classifierSource: "RULES",
        classifierEvidence: "semantic_text_requires_ai",
      }),
    })

    expect(create).not.toHaveBeenCalled()
    expect(classifySentiment).not.toHaveBeenCalled()
  })

  it("does not let negative-parent inheritance override an explicit collector rejection", async () => {
    findMonitoringSubjects.mockResolvedValue([
      monitoringSubject("subject-target", "Acme Robotics"),
    ] as never)
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-explicit-reject",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
    }) as never)

    await expect(ingestMentionWithResult({
      ...input,
      externalId: "explicitly-rejected-comment",
      contentKind: "COMMENT",
      sourceType: "comment",
      text: "Old comment",
      matchedTerm: null,
      parentMatchContext: {
        parentMentionId: "negative-parent",
        matchedTerm: "Acme Robotics",
        subjectIds: ["subject-target"],
        parentSentiment: "negative",
        inheritAllCommentSubjectIds: ["subject-target"],
      },
      observation: {
        relevanceStatus: "REJECTED",
        relevanceReason: "outside_collection_window",
        relevanceConfidence: 1,
      },
    })).resolves.toMatchObject({ accepted: false, relevanceStatus: "REJECTED" })

    expect(create).not.toHaveBeenCalled()
    expect(classifySentiment).not.toHaveBeenCalled()
  })

  it("terminally rejects a low-confidence comment instead of creating manual work", async () => {
    upsertEnvelope.mockImplementationOnce(async (args: { create: Record<string, unknown> }) => ({
      id: "env-review",
      acceptedMentionId: null,
      relevanceStatus: args.create.relevanceStatus,
    }) as never)

    const result = await ingestMentionWithResult({
      ...input,
      observation: {
        adapterKey: "BRIGHT_DATA_SNAPSHOT",
        providerKey: "bright-data",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "provider_match",
        relevanceConfidence: 0.69,
      },
    })

    expect(result).toEqual({
      id: "env-review",
      created: false,
      accepted: false,
      envelopeId: "env-review",
      relevanceStatus: "REJECTED",
      relevanceReason: "automatic_review_comment_subject_unresolved",
    })
    expect(upsertEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        relevanceStatus: "REJECTED",
        relevanceReason: "automatic_review_comment_subject_unresolved",
        relevanceConfidence: 1,
        policySnapshot: expect.objectContaining({
          relevanceConfidencePolicy: expect.objectContaining({
            version: "relevance-confidence-v1",
            minAutoAcceptConfidence: 0.7,
            reviewRetentionDays: 7,
          }),
        }),
      }),
    }))
    expect(create).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
  })

  it.each([
    { contentKind: "COMMENT" as const, sourceType: "comment" },
    { contentKind: "REPLY" as const, sourceType: "reply" },
  ])("persists a manually accepted $contentKind for its validated subject even when the matcher rejects it", async ({ contentKind, sourceType }) => {
    const publishedAt = new Date("2026-07-17T17:04:00.000Z")
    findMonitoringSubjects.mockResolvedValue([
      monitoringSubject("subject-target", "Acme Robotics"),
    ] as never)
    create.mockResolvedValue({
      id: "mention-manual-review",
      ...input,
      externalId: "comment-manual-review",
      contentKind,
      sourceType,
      text: "Expired food again",
      matchedTerm: null,
      publishedAt,
    })
    upsertEnvelope.mockResolvedValueOnce({
      id: "envelope-manual-review",
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      reviewMutationKey: "borrowed-review-lease",
      reviewMutationUntil: new Date("2026-07-23T12:15:00.000Z"),
    } as never)

    await expect(ingestMentionWithResult({
      ...input,
      externalId: "comment-manual-review",
      contentKind,
      sourceType,
      sourceProvider: "provider_api",
      sourceMetadata: {
        reviewOverride: true,
        replayedFromEnvelopeId: "envelope-manual-review",
        targetSubjectId: "subject-target",
      },
      text: "Completely unrelated words",
      matchedTerm: null,
      publishedAt,
      observation: {
        adapterKey: "APIFY_ASYNC",
        idempotencyKey: "envelope-manual-review",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "operator_review_accept",
        relevanceConfidence: 1,
      },
    }, {
      envelopeMutationKey: "borrowed-review-lease",
      operatorReviewDecision: {
        envelopeId: "envelope-manual-review",
        subjectId: "subject-target",
        actorId: "user-1",
      },
    })).resolves.toMatchObject({ id: "mention-manual-review", created: true })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contentKind,
        sourceType,
        publishedAt,
        versions: {
          create: expect.objectContaining({ publishedAt }),
        },
      }),
    }))
    expect(upsertSubjectMatch).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        organizationId: "org-1",
        mentionId: "mention-manual-review",
        subjectId: "subject-target",
        status: "MATCHED",
        reason: "operator_review_accept",
        confidence: 1,
        contextSignals: expect.objectContaining({
          operatorReviewOverride: true,
          envelopeId: "envelope-manual-review",
          actorId: "user-1",
          currentRelevanceStatus: "REJECTED",
        }),
      }),
    }))
    expect(updateEnvelope).not.toHaveBeenCalled()
  })

  it("stamps a detected language on accepted web articles (AI-триаж web не покрывает)", async () => {
    findUnique.mockResolvedValue(null)
    const webInput = {
      ...input,
      platform: "web",
      sourceType: "mention",
      externalId: "web-1",
      url: "https://news.example.az/article",
      sourceMetadata: { contentKind: "ARTICLE" },
      text: "Bakıda yeni layihə təqdim olundu və şirkət bildirib",
    }
    create.mockResolvedValue({ id: "m-web", ...webInput })

    await ingestMentionWithResult(webInput)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceMetadata: expect.objectContaining({
          socialTriage: expect.objectContaining({ language: "az" }),
        }),
      }),
    }))
  })

  // Языковой фильтр ленты прячет находку без socialTriage.language, а на проде
  // языка не было у 927 находок из 941 — соцсети его тоже не получали.
  it("проставляет язык и в соцсетях, а не только в веб-статьях", async () => {
    findUnique.mockResolvedValue(null)
    const socialInput = {
      ...input,
      platform: "instagram",
      externalId: "ig-lang-1",
      text: "Məhsul çox pisdir və dəstək cavab vermir",
    }
    create.mockResolvedValue({ id: "m-ig-lang", ...socialInput })

    await ingestMentionWithResult(socialInput)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceMetadata: expect.objectContaining({
          socialTriage: expect.objectContaining({ language: "az", languageSource: "heuristic" }),
        }),
      }),
    }))
  })

  it("не перезаписывает уже проставленный язык", async () => {
    findUnique.mockResolvedValue(null)
    const socialInput = {
      ...input,
      platform: "instagram",
      externalId: "ig-lang-2",
      // Текст азербайджанский, но язык уже проставлен: эвристика обязана
      // уступить — иначе она затрёт более точную метку AI-триажа.
      text: "Məhsul çox pisdir və dəstək cavab vermir",
      sourceMetadata: { socialTriage: { language: "ru" } },
    }
    create.mockResolvedValue({ id: "m-ig-lang-2", ...socialInput })

    await ingestMentionWithResult(socialInput)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceMetadata: expect.objectContaining({
          socialTriage: expect.objectContaining({ language: "ru" }),
        }),
      }),
    }))
  })

  it("оставляет язык пустым, когда детектор не уверен", async () => {
    findUnique.mockResolvedValue(null)
    const socialInput = {
      ...input,
      platform: "instagram",
      externalId: "ig-lang-3",
      // Ложная метка хуже отсутствующей: она спрячет находку из-под фильтра.
      text: "👍👍👍",
    }
    create.mockResolvedValue({ id: "m-ig-lang-3", ...socialInput })

    await ingestMentionWithResult(socialInput)

    const call = create.mock.calls.at(-1)?.[0] as { data?: { sourceMetadata?: Record<string, unknown> } }
    const triage = (call?.data?.sourceMetadata?.socialTriage ?? {}) as Record<string, unknown>
    expect(triage.language).toBeUndefined()
  })

  it("runs sentiment enrichment only after an observation is accepted", async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({
      id: "m-accepted",
      ...input,
      sourceType: "post",
      contentKind: "POST",
      sentiment: "neutral",
    })

    await ingestMentionWithResult({
      ...input,
      sourceType: "post",
      contentKind: "POST",
      sentiment: null,
      sentimentClassification: undefined,
    })

    expect(classifySentiment).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sentiment: "neutral" }) }))
  })

  it.each([
    {
      name: "the target subject is no longer active",
      subjects: [],
    },
    {
      name: "only a different active subject matches",
      subjects: [monitoringSubject("subject-other", "Acme Robotics")],
    },
    {
      name: "the target match is below the automatic acceptance threshold",
      subjects: [monitoringSubject("subject-target", "Acme Robotics", 0.69)],
    },
    {
      name: "the target and another active subject both match",
      subjects: [
        monitoringSubject("subject-target", "Acme Robotics"),
        monitoringSubject("subject-other", "Acme Robotics"),
      ],
    },
  ])("fails a SAFE_RESOLVE release closed when $name", async ({ subjects }) => {
    findMonitoringSubjects.mockResolvedValue(subjects as never)
    upsertEnvelope.mockResolvedValueOnce({
      id: "env-auto-review",
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      reviewMutationKey: "borrowed-review-lease",
      reviewMutationUntil: new Date("2026-07-23T12:15:00.000Z"),
    } as never)

    await expect(ingestMentionWithResult({
      ...input,
      sourceType: "post",
      contentKind: "POST",
      text: "Acme Robotics customer report",
      observation: {
        adapterKey: "APIFY_ASYNC",
        idempotencyKey: "env-auto-review",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "auto_review_release",
        relevanceConfidence: 1,
      },
    }, {
      envelopeMutationKey: "borrowed-review-lease",
      autoReviewDecision: {
        runId: "run-1",
        decisionId: "decision-1",
        subjectId: "subject-target",
      },
      suppressWorkflows: true,
      suppressMediaScheduling: true,
    })).resolves.toMatchObject({
      id: "env-auto-review",
      accepted: false,
      relevanceStatus: "REJECTED",
    })

    expect(create).not.toHaveBeenCalled()
    expect(upsertSubjectMatch).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
  })

  it("does not mutate envelope snapshots when persistence fails under a borrowed auto-review lease", async () => {
    findMonitoringSubjects.mockResolvedValue([
      monitoringSubject("subject-target", "Acme Robotics"),
    ] as never)
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({
      id: "mention-partial",
      ...input,
      text: "Acme Robotics customer report",
    })
    upsertEnvelope.mockResolvedValueOnce({
      id: "env-auto-review",
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      reviewMutationKey: "borrowed-review-lease",
      reviewMutationUntil: new Date("2026-07-23T12:15:00.000Z"),
    } as never)
    createSubjectMatch.mockRejectedValueOnce(new Error("subject match persistence failed"))

    await expect(ingestMentionWithResult({
      ...input,
      sourceType: "post",
      contentKind: "POST",
      text: "Acme Robotics customer report",
      observation: {
        adapterKey: "APIFY_ASYNC",
        idempotencyKey: "env-auto-review",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "auto_review_release",
        relevanceConfidence: 1,
      },
    }, {
      envelopeMutationKey: "borrowed-review-lease",
      autoReviewDecision: {
        runId: "run-1",
        decisionId: "decision-1",
        subjectId: "subject-target",
      },
      suppressWorkflows: true,
      suppressMediaScheduling: true,
    })).rejects.toThrow("subject match persistence failed")

    expect(create).toHaveBeenCalledOnce()
    expect(updateEnvelope).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
  })

  it("returns the linked accepted mention on an idempotent provider redelivery", async () => {
    upsertEnvelope.mockResolvedValueOnce({ id: "env-existing", acceptedMentionId: "mention-existing", relevanceStatus: "ACCEPTED" } as never)

    await expect(ingestMentionWithResult({
      ...input,
      observation: { adapterKey: "META_GRAPH", idempotencyKey: "delivery-1" },
    })).resolves.toEqual({ id: "mention-existing", created: false, envelopeId: "env-existing" })
    expect(findUnique).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("does not persist a reevaluated accepted observation when the existing review envelope is suppressed", async () => {
    upsertEnvelope.mockResolvedValueOnce({
      id: "env-suppressed",
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      reviewMutationKey: "other-review-action",
      reviewMutationUntil: new Date("2099-01-01T00:00:00.000Z"),
    } as never)
    updateEnvelope.mockResolvedValueOnce({ count: 0 } as never)
    // Захват двухшаговый: живое окно, затем продление просроченного.
    updateEnvelope.mockResolvedValueOnce({ count: 0 } as never)
    findEnvelope.mockResolvedValueOnce({
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      purgedAt: null,
      discoveryAutoReviewDecisions: [{ id: "decision-suppressed" }],
    } as never)

    await expect(ingestMentionWithResult({
      ...input,
      observation: {
        adapterKey: "APIFY_ASYNC",
        providerKey: "APIFY",
        idempotencyKey: "redelivery-suppressed",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "provider_match",
        relevanceConfidence: 0.99,
      },
    })).resolves.toEqual({
      id: "env-suppressed",
      created: false,
      accepted: false,
      envelopeId: "env-suppressed",
      relevanceStatus: "REVIEW",
    })

    expect(updateEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "env-suppressed",
        organizationId: "org-1",
        AND: expect.arrayContaining([{
          discoveryAutoReviewDecisions: {
            none: { state: "SUPPRESSED" },
          },
        }]),
      }),
    }))
    expect(findEnvelope).toHaveBeenCalledWith({
      where: {
        id: "env-suppressed",
        organizationId: "org-1",
      },
      select: {
        acceptedMentionId: true,
        relevanceStatus: true,
        purgedAt: true,
        reviewMutationUntil: true,
        discoveryAutoReviewDecisions: {
          where: { state: "SUPPRESSED" },
          select: { id: true },
          take: 1,
        },
      },
    })
    expect(findUnique).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
  })

  it("claims and clears an accepted persistence lease before writing a mention", async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({ id: "m-leased", ...input })
    upsertEnvelope.mockResolvedValueOnce({
      id: "env-leased",
      acceptedMentionId: null,
      relevanceStatus: "ACCEPTED",
      reviewMutationKey: null,
      reviewMutationUntil: null,
    } as never)
    updateEnvelope
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)

    await expect(ingestMentionWithResult({
      ...input,
      observation: {
        adapterKey: "META_GRAPH",
        idempotencyKey: "accepted-redelivery",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "subject_match",
        relevanceConfidence: 1,
      },
    })).resolves.toEqual({ id: "m-leased", created: true })

    expect(updateEnvelope).toHaveBeenCalledTimes(2)
    const envelopeCreate = upsertEnvelope.mock.calls[0][0].create
    const persistenceMutationKey = envelopeCreate.reviewMutationKey
    const persistenceMutationUntil = envelopeCreate.reviewMutationUntil
    expect(persistenceMutationKey).toEqual(expect.any(String))
    expect(persistenceMutationUntil).toBeInstanceOf(Date)
    expect(updateEnvelope.mock.calls[0][0]).toEqual({
      where: {
        id: "env-leased",
        organizationId: "org-1",
        acceptedMentionId: null,
        purgedAt: null,
        purgeAt: { gt: persistenceMutationUntil },
        AND: [
          {
            discoveryAutoReviewDecisions: {
              none: { state: "SUPPRESSED" },
            },
          },
          {
            OR: [
              { reviewMutationUntil: null },
              { reviewMutationUntil: { lte: expect.any(Date) } },
            ],
          },
        ],
      },
      data: {
        reviewMutationKey: persistenceMutationKey,
        reviewMutationUntil: persistenceMutationUntil,
      },
    })
    expect(updateEnvelope.mock.calls[1][0]).toEqual({
      where: {
        id: "env-leased",
        organizationId: "org-1",
        reviewMutationKey: persistenceMutationKey,
        AND: expect.arrayContaining([{
          discoveryAutoReviewDecisions: {
            none: { state: "SUPPRESSED" },
          },
        }]),
      },
      data: {
        acceptedMentionId: "m-leased",
        acceptedAt: expect.any(Date),
        reviewMutationKey: null,
        reviewMutationUntil: null,
      },
    })
    expect(updateEnvelope.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0],
    )
    expect(executeWorkflows).toHaveBeenCalledTimes(1)
  })

  it("uses the same suppression guard for workflow-free official archive persistence", async () => {
    findMonitoringSubjects.mockResolvedValue([{
      id: "subject-bravo",
      organizationId: "org-1",
      name: "Bravo Supermarket",
      requiredContext: [],
      exclusions: [],
      aliases: [],
      sources: [{
        id: "link-official",
        sourceId: "source-official",
        relationType: "OFFICIAL",
        trustWeight: 1,
        source: {
          id: "source-official",
          platform: "instagram",
          sourceType: "profile",
          handle: "bravosupermarketaz",
          url: "https://instagram.com/bravosupermarketaz",
        },
      }],
    }] as never)
    create.mockResolvedValue({
      id: "m-official-guarded",
      ...input,
      sentiment: null,
    })
    upsertEnvelope.mockResolvedValueOnce({
      id: "env-official-guarded",
      acceptedMentionId: null,
      relevanceStatus: "REJECTED",
      reviewMutationKey: null,
      reviewMutationUntil: null,
    } as never)

    await expect(ingestMentionWithResult({
      ...input,
      platform: "instagram",
      externalId: "official-guarded",
      sourceType: "post",
      contentKind: "POST",
      text: "Bravo Supermarket endirimləri",
      authorHandle: "bravosupermarketaz",
      sentiment: null,
      matchedTerm: null,
      sourceProvider: "official_discovery",
    })).resolves.toMatchObject({
      id: "m-official-guarded",
      accepted: false,
      relevanceStatus: "REJECTED",
    })

    const persistenceMutationKey =
      upsertEnvelope.mock.calls[0][0].create.reviewMutationKey
    expect(updateEnvelope.mock.calls[0][0]).toMatchObject({
      where: {
        id: "env-official-guarded",
        organizationId: "org-1",
        AND: expect.arrayContaining([{
          discoveryAutoReviewDecisions: {
            none: { state: "SUPPRESSED" },
          },
        }]),
      },
      data: {
        reviewMutationKey: persistenceMutationKey,
      },
    })
    expect(updateEnvelope.mock.calls[1][0]).toEqual({
      where: {
        id: "env-official-guarded",
        organizationId: "org-1",
        reviewMutationKey: persistenceMutationKey,
        AND: [{
          discoveryAutoReviewDecisions: {
            none: { state: "SUPPRESSED" },
          },
        }],
      },
      data: {
        acceptedMentionId: "m-official-guarded",
        acceptedAt: expect.any(Date),
        reviewMutationKey: null,
        reviewMutationUntil: null,
      },
    })
    expect(updateEnvelope.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0],
    )
    expect(executeWorkflows).not.toHaveBeenCalled()
  })

  // Прод, 2026-08-01: 1185 из 1308 отклонённых конвертов имели просроченное
  // окно хранения (отклонённый живёт 24 часа, а его ключ идемпотентности —
  // вечно). Прежде окно было УСЛОВИЕМ захвата, поэтому повторная доставка
  // через сутки срывалась и объявлялась «уже пишется» — навсегда, вместе с
  // очередью массового запуска.
  it("продлевает просроченное окно вторым захватом, не укорачивая живое", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/social/ingest-mention.ts"), "utf8")
    const claim = source.slice(source.indexOf("const claimGuards = {"))
    const claimBlock = claim.slice(0, claim.indexOf("persistenceClaimed ="))

    // Живой конверт захватывается как раньше и окно НЕ трогает: конверт в
    // очереди оператора живёт дольше суток, укорачивать его нельзя.
    expect(claimBlock).toContain("purgeAt: { gt: persistenceMutationUntil }")
    // Истёкшее окно продлевается вторым атомарным апдейтом.
    expect(claimBlock).toContain("purgeAt: { lte: persistenceMutationUntil }")
    expect(claimBlock).toContain("purgeAt,")

    // Чистка перепроверяет срок на своей атомарной фазе: её список кандидатов
    // мог устареть, пока повторная доставка продлевала окно.
    const retention = readFileSync(join(process.cwd(), "src/lib/social/observation-retention.ts"), "utf8")
    expect(retention).toContain("purgeAt: { lte: now },")
  })

  it("fails an accepted redelivery with another active persistence lease before mention persistence", async () => {
    upsertEnvelope.mockResolvedValueOnce({
      id: "env-busy",
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      reviewMutationKey: "other-persistence-worker",
      reviewMutationUntil: new Date("2099-01-01T00:00:00.000Z"),
    } as never)
    updateEnvelope.mockResolvedValueOnce({ count: 0 } as never)
    // Захват двухшаговый: живое окно, затем продление просроченного.
    updateEnvelope.mockResolvedValueOnce({ count: 0 } as never)
    findEnvelope.mockResolvedValueOnce({
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      purgedAt: null,
      // Живая аренда — единственное, что означает «пишется прямо сейчас».
      reviewMutationUntil: new Date("2099-01-01T00:00:00.000Z"),
      discoveryAutoReviewDecisions: [],
    } as never)

    await expect(ingestMentionWithResult({
      ...input,
      observation: {
        adapterKey: "META_GRAPH",
        idempotencyKey: "busy-redelivery",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "subject_match",
        relevanceConfidence: 1,
      },
    })).rejects.toThrow(
      "Ingest envelope persistence is already in progress",
    )

    // Два шага захвата: живое окно, затем попытка продлить просроченное.
    expect(updateEnvelope).toHaveBeenCalledTimes(2)
    expect(updateEnvelope.mock.calls[0][0]).toMatchObject({
      where: {
        id: "env-busy",
        organizationId: "org-1",
        AND: expect.arrayContaining([
          {
            discoveryAutoReviewDecisions: {
              none: { state: "SUPPRESSED" },
            },
          },
          {
            OR: [
              { reviewMutationUntil: null },
              { reviewMutationUntil: { lte: expect.any(Date) } },
            ],
          },
        ]),
      },
    })
    expect(findUnique).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
  })

  it("enriches incoming mentions with matching monitoring scenario metadata", async () => {
    findScenarioConfig.mockResolvedValue({
      id: "cfg-scenarios",
      settings: {
        scenarios: [{
          id: "scn-1",
          name: "Patrulaz mentions",
          status: "active",
          platforms: ["instagram"],
          search: {
            topics: ["Patrulaz"],
            keywords: [],
            hashtags: ["patrulaz"],
            handles: [],
            urls: ["https://www.instagram.com/patrulaz/"],
            useHashtagFallback: true,
            includeOwnedComments: true,
          },
          ai: {
            sentiments: ["negative", "lead"],
            minConfidence: 80,
            action: "create_lead",
          },
          reply: {
            identityId: "identity-1",
            identityLabel: "Nokaut.az",
            mode: "manual_approval",
            autoReplyEnabled: false,
            liveSendAllowed: false,
          },
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        }],
      },
    } as never)
    findUnique.mockResolvedValue(null)
    create.mockImplementationOnce(async (args: { data: Record<string, unknown> }) => ({ id: "m-new", ...args.data }))

    const result = await ingestMentionWithResult({
      ...input,
      platform: "instagram",
      sourceProvider: "search_index",
      sourceMetadata: { searchProvider: "manual-index" },
      text: "Patrulaz haqqında pis rəy #patrulaz",
      sentiment: "negative",
      matchedTerm: null,
      url: "https://www.instagram.com/patrulaz/p/ABC123/",
    })

    expect(result).toEqual({ id: "m-new", created: true })
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        platform: "instagram",
        matchedTerm: "Patrulaz",
        sourceMetadata: expect.objectContaining({
          searchProvider: "manual-index",
          socialScenario: expect.objectContaining({
            version: SOCIAL_SCENARIO_MATCH_VERSION,
            primaryScenarioId: "scn-1",
            primaryScenarioName: "Patrulaz mentions",
            primaryAction: "create_lead",
            liveSendAllowed: false,
            matches: [expect.objectContaining({
              scenarioId: "scn-1",
              action: "create_lead",
              minConfidence: 80,
              matchedConfidence: 90,
            })],
          }),
        }),
      }),
    })
    expect(executeWorkflows).toHaveBeenCalledWith(
      "org-1",
      "social_mention",
      "created",
      expect.objectContaining({
        platform: "instagram",
        sourceMetadata: expect.objectContaining({
          socialScenario: expect.objectContaining({ primaryScenarioId: "scn-1" }),
        }),
      }),
    )
  })

  it("updates duplicate mentions without firing create workflows", async () => {
    findUnique.mockResolvedValue({ id: "m-existing" })

    const result = await ingestMentionWithResult({ ...input, text: "Updated" })

    expect(result).toEqual({ id: "m-existing", created: false })
    expect(update).toHaveBeenCalledWith({
      where: { organizationId_id: { organizationId: "org-1", id: "m-existing" } },
      data: expect.objectContaining({
        text: "Updated",
        sourceType: "comment",
        sourceProvider: "chatwoot",
        sourceMetadata: expect.objectContaining({ chatwootConversationId: "42" }),
        authorAvatar: "https://cdn.example/avatar.jpg",
      }),
    })
    expect(update).toHaveBeenCalledWith({
      where: { organizationId_id: { organizationId: "org-1", id: "m-existing" } },
      data: { clusterId: "cluster-1" },
    })
    expect(create).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
  })

  it("records an immutable next version when provider text changes", async () => {
    findUnique.mockResolvedValue({
      id: "m-existing",
      text: "Original text",
      contentVersion: 1,
      matchedTerm: "elaqe",
      sourceMetadata: { postId: "post-1" },
    } as never)

    await ingestMentionWithResult({ ...input, text: "Edited provider text", editedAt: new Date("2026-06-29T11:00:00.000Z") })

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_id: { organizationId: "org-1", id: "m-existing" } },
      data: expect.objectContaining({ contentVersion: 2, text: "Edited provider text" }),
    }))
    expect(createVersion).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        mentionId: "m-existing",
        version: 2,
        text: "Edited provider text",
      }),
    })
  })

  it("dedupes cross-source mentions by normalized URL before creating a second row", async () => {
    findUnique.mockResolvedValue(null)
    findMany.mockResolvedValueOnce([
      {
        id: "m-url-duplicate",
        clusterId: "cluster-existing",
        url: "https://instagram.com/p/ABC?a=1&b=2",
      },
    ] as never)

    const result = await ingestMentionWithResult({
      ...input,
      sourceType: "mention", // URL dedupe applies to posts/mentions only
      platform: "instagram",
      externalId: "provider:other-id",
      sourceProvider: "provider_api",
      url: "https://www.instagram.com/p/ABC/?utm_source=newsletter&b=2&a=1#comments",
    })

    expect(result).toEqual({ id: "m-url-duplicate", created: false })
    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_id: { organizationId: "org-1", id: "m-url-duplicate" } },
      data: expect.objectContaining({
        sourceProvider: "provider_api",
      }),
    }))
    expect(executeWorkflows).not.toHaveBeenCalled()
  })

  it("dedupes one post across Bright Data and Apify while preserving both provider envelopes", async () => {
    findUnique.mockResolvedValue(null)
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "m-shared-provider-post",
        clusterId: "cluster-existing",
        matchedTerm: "leaddrive",
        sourceMetadata: { provider: "BRIGHT_DATA" },
        url: "https://instagram.com/p/SHARED",
      }] as never)
    create.mockResolvedValue({
      id: "m-shared-provider-post",
      ...input,
      sourceType: "post",
      contentKind: "POST",
      platform: "instagram",
      externalId: "bright-post-1",
      url: "https://instagram.com/p/SHARED",
    })
    upsertEnvelope
      .mockResolvedValueOnce({ id: "env-bright", acceptedMentionId: null, relevanceStatus: "ACCEPTED" } as never)
      .mockResolvedValueOnce({ id: "env-apify", acceptedMentionId: null, relevanceStatus: "ACCEPTED" } as never)

    const bright = await ingestMentionWithResult({
      ...input,
      sourceType: "post",
      contentKind: "POST",
      platform: "instagram",
      externalId: "bright-post-1",
      sourceProvider: "provider_api",
      sourceMetadata: { provider: "BRIGHT_DATA" },
      url: "https://www.instagram.com/p/SHARED/?utm_source=bright",
      observation: {
        adapterKey: "BRIGHT_DATA_INSTAGRAM_POST",
        providerKey: "BRIGHT_DATA",
        providerItemId: "bright-item-1",
        acquisitionMode: "LICENSED_PROVIDER",
      },
    })
    const apify = await ingestMentionWithResult({
      ...input,
      sourceType: "post",
      contentKind: "POST",
      platform: "instagram",
      externalId: "apify-post-1",
      sourceProvider: "search_index",
      sourceMetadata: { provider: "APIFY" },
      url: "https://instagram.com/p/SHARED/#comments",
      observation: {
        adapterKey: "APIFY_ASYNC",
        providerKey: "APIFY",
        providerItemId: "apify-item-1",
        acquisitionMode: "APIFY_FALLBACK",
      },
    })

    expect(bright).toEqual({ id: "m-shared-provider-post", created: true })
    expect(apify).toEqual({ id: "m-shared-provider-post", created: false })
    expect(create).toHaveBeenCalledTimes(1)
    expect(upsertEnvelope).toHaveBeenCalledTimes(2)
    const brightEnvelope = upsertEnvelope.mock.calls[0]?.[0].create
    const apifyEnvelope = upsertEnvelope.mock.calls[1]?.[0].create
    expect(brightEnvelope).toMatchObject({ providerKey: "BRIGHT_DATA", adapterKey: "BRIGHT_DATA_INSTAGRAM_POST" })
    expect(apifyEnvelope).toMatchObject({ providerKey: "APIFY", adapterKey: "APIFY_ASYNC" })
    expect(brightEnvelope.idempotencyKey).not.toBe(apifyEnvelope.idempotencyKey)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_id: { organizationId: "org-1", id: "m-shared-provider-post" } },
    }))
  })

  it("does NOT URL-dedupe comments — two comments under the same post coexist", async () => {
    // Comments store the parent post's permalink as url; URL dedupe would collapse
    // every comment under a post into one row (at most one comment per post survives).
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({ id: "m-second-comment", ...input })

    const result = await ingestMentionWithResult({
      ...input, // sourceType: "comment"
      externalId: "c:second-comment",
      text: "Another totally different comment on the same post",
      authorName: "Someone Else",
      authorHandle: "someone_else",
    })

    expect(result).toEqual({ id: "m-second-comment", created: true })
    expect(create).toHaveBeenCalled()
    expect(findMany).not.toHaveBeenCalled()
  })

  it("does not mislabel a parent post permalink as the comment canonical URL", async () => {
    findUnique.mockResolvedValue(null)
    create.mockImplementationOnce(async (args: { data: Record<string, unknown> }) => ({ id: "m-comment", ...args.data }))

    await ingestMentionWithResult({
      ...input,
      externalId: "c:canonical-fields",
      url: "https://www.tiktok.com/@brand/video/1",
      sourceMetadata: { permalink: "https://www.tiktok.com/@brand/video/1" },
    })

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contentKind: "COMMENT",
        canonicalUrl: null,
        parentPostUrl: "https://tiktok.com/@brand/video/1",
      }),
    })
  })

  it("dedupes a comment only when an adapter supplies an explicit comment permalink", async () => {
    findUnique.mockResolvedValue(null)
    findMany.mockResolvedValueOnce([{
      id: "m-comment-url",
      canonicalUrl: "https://facebook.com/post/1?comment_id=99",
    }] as never)

    const result = await ingestMentionWithResult({
      ...input,
      platform: "facebook",
      externalId: "provider-alias:99",
      sourceMetadata: { commentPermalink: "https://www.facebook.com/post/1?comment_id=99&utm_source=collector" },
    })

    expect(result).toEqual({ id: "m-comment-url", created: false })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        platform: "facebook",
        canonicalUrl: { not: null },
        contentKind: { in: ["COMMENT", "REPLY"] },
      }),
    }))
    expect(create).not.toHaveBeenCalled()
  })

  it("backfills matchedTerm on update only when the existing row has none", async () => {
    // Existing row without a matched term gains one (self-healing into the search stream)
    findUnique.mockResolvedValue({ id: "m-existing", matchedTerm: null } as never)
    await ingestMentionWithResult({ ...input, matchedTerm: "brandname" })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_id: { organizationId: "org-1", id: "m-existing" } },
      data: expect.objectContaining({ matchedTerm: "brandname" }),
    }))

    vi.clearAllMocks()
    upsertCluster.mockResolvedValue({ id: "cluster-1" } as never)
    findScenarioConfig.mockResolvedValue(null as never)
    findMany.mockResolvedValue([])
    update.mockResolvedValue({ id: "m-updated" })

    // Existing matched term is never overwritten — it's what scenarios acted on
    findUnique.mockResolvedValue({ id: "m-existing", matchedTerm: "original" } as never)
    await ingestMentionWithResult({ ...input, matchedTerm: "different" })
    const dataArg = update.mock.calls.find(
      (c: [{ where?: { organizationId_id?: { id?: string } }; data?: unknown }]) =>
        c[0]?.where?.organizationId_id?.id === "m-existing",
    )?.[0]?.data as Record<string, unknown>
    expect(dataArg).toBeDefined()
    expect(dataArg).not.toHaveProperty("matchedTerm")
  })

  it("clusters same-author repeated text in the same day without hard-deduping it", async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({ id: "m-repeated", ...input, externalId: "search:different" })

    const result = await ingestMentionWithResult({
      ...input,
      externalId: "search:different",
      url: null,
      publishedAt: new Date("2026-06-29T20:00:00.000Z"),
    })

    expect(result).toEqual({ id: "m-repeated", created: true })
    expect(create).toHaveBeenCalled()
    expect(upsertCluster).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId_clusterKey: expect.objectContaining({ organizationId: "org-1" }) }),
    }))
    expect(executeWorkflows).toHaveBeenCalled()
  })

  it("keeps the legacy boolean wrapper for existing pollers", async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({ id: "m-new", ...input })

    await expect(ingestMention(input)).resolves.toBe(true)
  })

  it("update preserves fields the source doesn't carry and MERGES sourceMetadata", async () => {
    // Webhook redelivery scenario: no url/engagement/reach, minimal metadata — must not
    // null the permalink/likes the poller stored, nor erase socialTriage stamps.
    findUnique.mockResolvedValue({
      id: "m-existing",
      matchedTerm: "elaqe",
      sourceMetadata: { socialTriage: { approvalRequired: false }, postId: "p1" },
    } as never)

    await ingestMentionWithResult({
      ...input,
      url: null,
      engagement: undefined,
      reach: undefined,
      authorAvatar: null,
      sourceMetadata: { redelivered: true },
    })

    const dataArg = update.mock.calls[0][0].data as Record<string, unknown>
    expect(dataArg).not.toHaveProperty("url")
    expect(dataArg).not.toHaveProperty("engagement")
    expect(dataArg).not.toHaveProperty("reach")
    expect(dataArg).not.toHaveProperty("authorAvatar")
    expect(dataArg).not.toHaveProperty("matchedTerm") // existing term never overwritten
    expect(dataArg.sourceMetadata).toEqual({
      socialTriage: { approvalRequired: false },
      postId: "p1",
      redelivered: true,
      automaticReviewSentiment: {
        sentiment: "neutral",
        classification: "neutral",
        source: "AI",
        classifierVersion: AUTOMATIC_REVIEW_AI_VERSION,
      },
    })
  })

  it("post/mention inputs never URL-match comment rows (tier-2 excludes comments)", async () => {
    findUnique.mockResolvedValue(null)
    findMany.mockResolvedValue([] as never)
    create.mockResolvedValue({ id: "m-post", ...input })

    await ingestMentionWithResult({ ...input, sourceType: "post", externalId: "post-1" })

    const tier2Call = findMany.mock.calls.find(
      (c: [{ where?: Record<string, unknown> }]) => c[0]?.where && "url" in (c[0].where as object),
    )
    expect(tier2Call).toBeDefined()
    expect((tier2Call![0].where as Record<string, unknown>).contentKind).toEqual({ notIn: ["COMMENT", "REPLY"] })
  })

  it("create race (P2002) falls back to the update path instead of failing the item", async () => {
    findUnique.mockResolvedValueOnce(null) // tier-1 miss before create
    create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
    findUnique.mockResolvedValueOnce({ id: "m-raced", matchedTerm: null, sourceMetadata: {} } as never)

    const result = await ingestMentionWithResult(input)

    expect(result).toEqual({ id: "m-raced", created: false })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_id: { organizationId: "org-1", id: "m-raced" } },
    }))
    expect(executeWorkflows).not.toHaveBeenCalled()
  })
})

/**
 * Прод 2026-08-04. Владелец менял негатив на нейтрал, а метка возвращалась:
 * обновление существующей находки писало тональность безусловно, поэтому
 * очередной сбор той же записи затирал правку. Рядом в том же блоке уже стояло
 * правило «источник не должен стирать поля, которых не знает» — тональность из
 * него выпадала.
 */
describe("правка тональности оператором при повторном сборе", () => {
  const existingMention = (socialTriage: Record<string, unknown>) => ({
    id: "m-existing",
    clusterId: null,
    matchedTerm: "elaqe",
    sourceMetadata: { chatwootConversationId: "42", socialTriage },
    url: input.url,
    canonicalUrl: input.url,
    text: input.text,
    authorName: "Aysel",
    authorHandle: "aysel",
    publishedAt: input.publishedAt,
    createdAt: input.publishedAt,
    contentVersion: 1,
  })

  // Сбор снова принёс негатив — именно он и затирал правку.
  const reIngest = () => ingestMentionWithResult({ ...input, sentiment: "negative" as const })

  const updateDataForExistingRow = () => update.mock.calls
    .map(call => call[0])
    .filter(call => call?.where?.organizationId_id?.id === "m-existing")
    .map(call => call.data as Record<string, unknown>)
    .find(data => data && !("clusterId" in data && Object.keys(data).length === 1))

  it("не переписывает тональность, закреплённую человеком", async () => {
    findUnique.mockResolvedValue(existingMention({
      language: "az",
      sentimentSource: "operator",
      sentimentAfter: "neutral",
    }) as never)

    await reIngest()

    const data = updateDataForExistingRow()
    expect(data).toBeDefined()
    expect(data).not.toHaveProperty("sentiment")
  })

  it("обычную находку по-прежнему обновляет", async () => {
    findUnique.mockResolvedValue(existingMention({ language: "az" }) as never)

    await reIngest()

    expect(updateDataForExistingRow()).toMatchObject({ sentiment: "negative" })
  })
})
