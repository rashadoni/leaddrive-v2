import { beforeEach, describe, expect, it, vi } from "vitest"

const { draftSocialReply, withTenantCollectionFence } = vi.hoisted(() => ({
  draftSocialReply: vi.fn(async () => ({
    reply: "Thanks for mentioning us.",
    tone: "official",
    reasoning: "Scenario draft reply.",
    snapshot: {
      model: "test-model",
      temperature: 0.2,
      promptVersion: "social-reply-v4-tenant-responder",
      maskedPromptSha256: "test-prompt-sha",
      inputTokens: 10,
      outputTokens: 5,
    },
  })),
  withTenantCollectionFence: vi.fn(),
}))

vi.mock("@/lib/ai/social-reply", () => ({ draftSocialReply }))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: withTenantCollectionFence,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
    socialMention: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    aiShadowAction: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    aiAlert: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    socialMentionAiDraft: {
      findFirst: vi.fn(),
      create: vi.fn(async ({ data }) => ({ id: "draft-1", ...data })),
    },
    socialMentionSubjectMatch: {
      findFirst: vi.fn(async () => null),
    },
    monitoringSubject: {
      findMany: vi.fn(async () => []),
    },
    manualEngagementTask: {
      upsert: vi.fn(async ({ create }) => ({ id: "manual-task-1", ...create })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    aiAgentConfig: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    socialReplyChannelSetting: {
      findFirst: vi.fn(async () => null),
    },
  },
}))

import { prisma } from "@/lib/prisma"
import {
  SOCIAL_TRIAGE_ALERT_TYPE,
  SOCIAL_TRIAGE_FEATURE_NAME,
  runSocialTriageForOrganization,
  scoreSocialMentionForTriage,
} from "@/lib/social/ai-triage"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"

const findOrganization = vi.mocked(prisma.organization.findUnique)
const findMentions = vi.mocked(prisma.socialMention.findMany)
const updateMention = vi.mocked(prisma.socialMention.update)
const findShadowAction = vi.mocked(prisma.aiShadowAction.findFirst)
const createShadowAction = vi.mocked(prisma.aiShadowAction.create)
const findAlert = vi.mocked(prisma.aiAlert.findFirst)
const createAlert = vi.mocked(prisma.aiAlert.create)
const findDraft = vi.mocked(prisma.socialMentionAiDraft.findFirst)
const createDraft = vi.mocked(prisma.socialMentionAiDraft.create)

beforeEach(() => {
  vi.clearAllMocks()
  withTenantCollectionFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true, value: await collect() }))
  findOrganization.mockResolvedValue({ name: "LeadDrive" })
  findShadowAction.mockResolvedValue(null)
  createShadowAction.mockResolvedValue({ id: "shadow-1" })
  findAlert.mockResolvedValue(null)
  createAlert.mockResolvedValue({ id: "alert-1" })
  findDraft.mockResolvedValue(null)
  updateMention.mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({ id: args.where.id, ...args.data }))
})

function scenarioMetadata(action: string, sentiments: string[] = ["positive"]) {
  return {
    socialScenario: {
      version: "social_scenario_match_v1",
      matches: [{
        scenarioId: "scn-1",
        scenarioName: "Nokaut scenario",
        action,
        sentiments,
        minConfidence: 80,
        matchedConfidence: 90,
      }],
      liveSendAllowed: false,
    },
  }
}

describe("social AI triage", () => {
  it("selects only active risk-relevant findings for triage", async () => {
    findMentions.mockResolvedValue([])

    await runSocialTriageForOrganization("org-1")

    expect(findMentions).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        purgedAt: null,
        deletedAtSource: null,
        AND: [riskRelevantMentionWhere()],
      }),
    }))
  })

  it("returns a zero result without reading or mutating mentions when collection is blocked", async () => {
    withTenantCollectionFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    await expect(runSocialTriageForOrganization("org-1")).resolves.toEqual({
      scanned: 0,
      updated: 0,
      queued: 0,
      alerts: 0,
      hiddenNoise: 0,
    })
    expect(withTenantCollectionFence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(findMentions).not.toHaveBeenCalled()
    expect(findOrganization).not.toHaveBeenCalled()
    expect(updateMention).not.toHaveBeenCalled()
    expect(createShadowAction).not.toHaveBeenCalled()
    expect(createAlert).not.toHaveBeenCalled()
    expect(createDraft).not.toHaveBeenCalled()
  })

  it("hides low-relevance noise by default and recommends ignoring it", () => {
    const result = scoreSocialMentionForTriage({
      platform: "instagram",
      sourceProvider: "search_index",
      text: "nice",
      sentiment: "neutral",
      reach: 0,
      engagement: 0,
    })

    expect(result).toMatchObject({
      language: "en",
      hiddenNoise: true,
      recommendedAction: "ignore_noise",
      draftAllowed: true,
      queuedAction: false,
      alertCreated: false,
    })
    expect(result.relevanceScore).toBeLessThan(30)
    expect(result.reasons).toContain("hidden_noise")
  })

  it("routes matched monitoring scenario actions even when the text is otherwise low-signal", () => {
    const result = scoreSocialMentionForTriage({
      platform: "instagram",
      sourceProvider: "search_index",
      sourceMetadata: scenarioMetadata("create_lead", ["positive"]),
      text: "nice",
      sentiment: "positive",
      reach: 0,
      engagement: 0,
    })

    expect(result.hiddenNoise).toBe(false)
    expect(result.recommendedAction).toBe("create_lead")
    expect(result.approvalRequired).toBe(true)
    expect(result.reasons).toEqual(expect.arrayContaining([
      "scenario_match",
      "scenario_trigger",
      "scenario_action_create_lead",
      "approval_required",
    ]))
  })

  it("detects Azerbaijani lead intent and keeps it as a human action", () => {
    const result = scoreSocialMentionForTriage({
      platform: "tiktok",
      sourceProvider: "browser_capture",
      text: "Salam, qiymət necədir? WhatsApp nömrə göndərin",
      sentiment: "neutral",
      matchedTerm: "qiymət",
    })

    expect(result.language).toBe("az")
    expect(result.leadIntent).toBe(true)
    expect(result.recommendedAction).toBe("create_lead")
    expect(result.approvalRequired).toBe(true)
    expect(result.forbiddenReason).toBe("price_dispute")
    expect(result.draftAllowed).toBe(false)
  })

  it("escalates high-reach complaints and blocks auto draft topics", () => {
    const result = scoreSocialMentionForTriage({
      platform: "facebook",
      sourceProvider: "native",
      text: "Это жалоба, сервис ужасный и не работает",
      sentiment: "negative",
      reach: 8000,
      engagement: 160,
      cluster: { mentionCount: 4 },
    })

    expect(result.language).toBe("ru")
    expect(result.complaint).toBe(true)
    expect(result.prRisk).toBe("high")
    expect(result.recommendedAction).toBe("escalate")
    expect(result.approvalRequired).toBe(true)
    expect(result.draftAllowed).toBe(false)
    expect(result.forbiddenReason).toBe("complaint")
  })

  it("updates triage metadata and queues high-risk mentions without external send", async () => {
    findMentions.mockResolvedValue([
      {
        id: "mention-1",
        organizationId: "org-1",
        platform: "facebook",
        sourceType: "mention",
        sourceProvider: "native",
        sourceMetadata: { existing: true },
        text: "This is a complaint, the product is broken and support is terrible",
        authorName: "Customer",
        authorHandle: "customer",
        sentiment: "negative",
        externalId: "fb-1",
        matchedTerm: "product",
        reach: 9000,
        engagement: 180,
        url: "https://facebook.test/post/1",
        cluster: { mentionCount: 3, riskLevel: "high", topic: "broken product" },
      },
    ])

    const result = await runSocialTriageForOrganization("org-1", {
      now: new Date("2026-07-05T10:00:00.000Z"),
    })

    expect(result).toEqual({ scanned: 1, updated: 1, queued: 1, alerts: 1, hiddenNoise: 0 })
    expect(createShadowAction).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        featureName: SOCIAL_TRIAGE_FEATURE_NAME,
        actionType: "create_task",
        entityType: "social_mention",
        entityId: "mention-1",
        approved: null,
        payload: expect.objectContaining({
          recommendedAction: "escalate",
          triage: expect.objectContaining({
            queuedAction: false,
            alertCreated: false,
          }),
        }),
      }),
    }))
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        type: SOCIAL_TRIAGE_ALERT_TYPE,
        metadata: expect.objectContaining({ mentionId: "mention-1" }),
      }),
    }))
    expect(updateMention).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "mention-1" },
      data: expect.objectContaining({
        sourceMetadata: expect.objectContaining({
          existing: true,
          socialTriage: expect.objectContaining({
            recommendedAction: "escalate",
            queuedAction: true,
            alertCreated: true,
            triagedAt: "2026-07-05T10:00:00.000Z",
          }),
        }),
      }),
    }))
  })

  it("creates scenario alerts without sending or queueing external replies", async () => {
    findMentions.mockResolvedValue([
      {
        id: "mention-scenario-alert",
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "mention",
        sourceProvider: "search_index",
        sourceMetadata: scenarioMetadata("alert", ["neutral"]),
        text: "Neutral brand update from public post",
        authorName: "Publisher",
        authorHandle: "publisher",
        sentiment: "neutral",
        externalId: "ig-alert-1",
        matchedTerm: null,
        reach: 0,
        engagement: 0,
        url: "https://instagram.test/p/1",
        cluster: { mentionCount: 1, riskLevel: null, topic: null },
      },
    ])

    const result = await runSocialTriageForOrganization("org-1", {
      now: new Date("2026-07-05T10:00:00.000Z"),
    })

    expect(result).toEqual({ scanned: 1, updated: 1, queued: 0, alerts: 1, hiddenNoise: 0 })
    expect(createShadowAction).not.toHaveBeenCalled()
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        type: SOCIAL_TRIAGE_ALERT_TYPE,
        metadata: expect.objectContaining({
          mentionId: "mention-scenario-alert",
          triage: expect.objectContaining({
            reasons: expect.arrayContaining(["scenario_action_alert"]),
            approvalRequired: true,
            alertCreated: false,
          }),
        }),
      }),
    }))
    expect(updateMention).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "mention-scenario-alert" },
      data: expect.objectContaining({
        sourceMetadata: expect.objectContaining({
          socialScenario: expect.any(Object),
          socialTriage: expect.objectContaining({
            alertCreated: true,
            queuedAction: false,
            approvalRequired: true,
          }),
        }),
      }),
    }))
  })

  it("creates scenario reply drafts immediately without sending live replies", async () => {
    findMentions.mockResolvedValue([
      {
        id: "mention-scenario-draft",
        organizationId: "org-1",
        platform: "instagram",
        accountId: "account-1",
        sourceType: "post",
        contentKind: "VIDEO",
        contentVersion: 3,
        sourceProvider: "search_index",
        sourceMetadata: {
          ...scenarioMetadata("draft_reply", ["negative"]),
          ownership: "external",
          providerItemId: "provider-item-1",
        },
        text: "Negative public mention about hava service",
        authorName: "Publisher",
        authorHandle: "publisher",
        sentiment: "negative",
        externalId: "ig-draft-1",
        matchedTerm: "hava",
        reach: 0,
        engagement: 0,
        url: "https://instagram.test/p/2",
        cluster: { mentionCount: 1, riskLevel: null, topic: null },
      },
    ])

    const result = await runSocialTriageForOrganization("org-1", {
      now: new Date("2026-07-06T00:24:00.000Z"),
    })

    expect(result).toEqual({ scanned: 1, updated: 1, queued: 0, alerts: 0, hiddenNoise: 0 })
    expect(createShadowAction).not.toHaveBeenCalled()
    expect(createAlert).not.toHaveBeenCalled()
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        mentionId: "mention-scenario-draft",
        status: "needs_approval",
        sentiment: "negative",
        approvedBy: null,
        approvedAt: null,
        sentAt: null,
        sendMode: "dry_run",
        sendResult: expect.objectContaining({
          mode: "draft_only",
          source: "scenario_triage",
          scenarioId: "scn-1",
          scenarioName: "Nokaut scenario",
          action: "draft_reply",
          requiresApproval: true,
          liveSendAllowed: false,
        }),
      }),
    }))
    expect(draftSocialReply).toHaveBeenCalledWith(expect.objectContaining({
      id: "mention-scenario-draft",
      accountId: "account-1",
      contentKind: "VIDEO",
      contentVersion: 3,
      sourceType: "post",
      sourceProvider: "search_index",
      sourceMetadata: expect.objectContaining({
        ownership: "external",
        providerItemId: "provider-item-1",
      }),
      externalId: "ig-draft-1",
      authorName: "Publisher",
      authorHandle: "publisher",
      url: "https://instagram.test/p/2",
    }), "LeadDrive", "en", null, null, [])
    expect(updateMention).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "mention-scenario-draft" },
      data: expect.objectContaining({
        sourceMetadata: expect.objectContaining({
          socialTriage: expect.objectContaining({
            recommendedAction: "draft_reply",
            queuedAction: false,
            alertCreated: false,
            draftCreated: true,
            draftId: "draft-1",
            draftSkippedReason: null,
            reasons: expect.arrayContaining(["scenario_action_draft_reply"]),
          }),
        }),
      }),
    }))
  })

  it("creates scenario reply drafts for COMMENT mentions — the 'AI drafts a reply' rule reaches comments", async () => {
    findMentions.mockResolvedValue([
      {
        id: "mention-comment-draft",
        organizationId: "org-1",
        platform: "facebook",
        sourceType: "comment",
        sourceProvider: "native",
        sourceMetadata: { ...scenarioMetadata("draft_reply", ["negative"]), postId: "post-1" },
        text: "Negative comment about hava delivery options",
        authorName: "Commenter",
        authorHandle: "commenter",
        sentiment: "negative",
        externalId: "c:555_777",
        matchedTerm: "hava",
        reach: 0,
        engagement: 0,
        url: "https://facebook.test/p/1",
        cluster: { mentionCount: 1, riskLevel: null, topic: null },
      },
    ])

    const result = await runSocialTriageForOrganization("org-1", {
      now: new Date("2026-07-06T00:24:00.000Z"),
    })

    expect(result.updated).toBe(1)
    // Drafts-only, human sends: needs_approval + dry_run, never live.
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mentionId: "mention-comment-draft",
        status: "needs_approval",
        sendMode: "dry_run",
        sendResult: expect.objectContaining({ source: "scenario_triage", liveSendAllowed: false }),
      }),
    }))
  })

  it("does NOT create a draft for comments when the scenario rule is manual (show_only)", async () => {
    findMentions.mockResolvedValue([
      {
        id: "mention-comment-manual",
        organizationId: "org-1",
        platform: "facebook",
        sourceType: "comment",
        sourceProvider: "native",
        sourceMetadata: scenarioMetadata("show_only", ["neutral"]),
        text: "Neutral comment asking about hava delivery options",
        authorName: "Commenter",
        authorHandle: "commenter",
        sentiment: "neutral",
        externalId: "c:555_778",
        matchedTerm: "hava",
        reach: 0,
        engagement: 0,
        url: "https://facebook.test/p/1",
        cluster: { mentionCount: 1, riskLevel: null, topic: null },
      },
    ])

    await runSocialTriageForOrganization("org-1", { now: new Date("2026-07-06T00:24:00.000Z") })

    expect(createDraft).not.toHaveBeenCalled()
  })

  it("does not create duplicate queue items or alerts for recent triage", async () => {
    findMentions.mockResolvedValue([
      {
        id: "mention-1",
        organizationId: "org-1",
        platform: "facebook",
        sourceType: "mention",
        sourceProvider: "native",
        sourceMetadata: {},
        text: "This is a complaint and support is terrible",
        authorName: null,
        authorHandle: null,
        sentiment: "negative",
        externalId: "fb-duplicate-1",
        matchedTerm: "support",
        reach: 9000,
        engagement: 180,
        url: null,
        cluster: { mentionCount: 1, riskLevel: null, topic: null },
      },
    ])
    findShadowAction.mockResolvedValueOnce({ id: "shadow-existing" })
    findAlert.mockResolvedValueOnce({ id: "alert-existing" })

    const result = await runSocialTriageForOrganization("org-1", {
      now: new Date("2026-07-05T10:00:00.000Z"),
    })

    expect(result).toEqual({ scanned: 1, updated: 1, queued: 0, alerts: 0, hiddenNoise: 0 })
    expect(createShadowAction).not.toHaveBeenCalled()
    expect(createAlert).not.toHaveBeenCalled()
  })
})
