import { beforeEach, describe, expect, it, vi } from "vitest"

const { draftSocialReply, withTenantFence } = vi.hoisted(() => ({
  draftSocialReply: vi.fn(async () => ({
    reply: "Thanks for the kind words.",
    tone: "grateful",
    reasoning: "Short positive reply.",
    snapshot: {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.4,
      promptVersion: "social-reply-v4-tenant-responder",
      maskedPromptSha256: "abc123",
      inputTokens: 10,
      outputTokens: 5,
    },
  })),
  withTenantFence: vi.fn(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true as const, value: await collect() })),
}))

vi.mock("@/lib/ai/social-reply", () => ({ draftSocialReply }))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: withTenantFence,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: {
      findMany: vi.fn(),
    },
    socialMentionAiDraft: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(async ({ data }) => ({ id: "draft-1", ...data })),
    },
    aiAgentConfig: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    socialReplyChannelSetting: {
      findFirst: vi.fn(async () => ({
        senderAccountId: "official-account",
        senderAccount: {
          id: "official-account",
          handle: "official-brand",
          displayName: "Official Brand",
        },
      })),
    },
    socialMentionSubjectMatch: {
      findFirst: vi.fn(async () => null),
    },
    monitoringSubject: {
      findMany: vi.fn(async () => []),
    },
    manualEngagementTask: {
      upsert: vi.fn(async ({ create }) => ({ id: "task-1", ...create })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}))

import { prisma } from "@/lib/prisma"
import {
  createScenarioSocialMentionAiDraft,
  createSocialMentionAiDraft,
  findMentionsForSocialAiDraft,
  resolveEngagementMode,
} from "@/lib/social/ai-draft-service"
import { assessManualEngagementRisk } from "@/lib/social/manual-engagement-policy"

const findMentions = vi.mocked(prisma.socialMention.findMany)
const findDrafts = vi.mocked(prisma.socialMentionAiDraft.findMany)
const findDraft = vi.mocked(prisma.socialMentionAiDraft.findFirst)
const createDraft = vi.mocked(prisma.socialMentionAiDraft.create)
const findSubjectMatch = vi.mocked(prisma.socialMentionSubjectMatch.findFirst)
const findSubjects = vi.mocked(prisma.monitoringSubject.findMany)
const findAgent = vi.mocked(prisma.aiAgentConfig.findFirst)

beforeEach(() => {
  vi.clearAllMocks()
  findDraft.mockResolvedValue(null)
  findSubjectMatch.mockResolvedValue(null)
  findSubjects.mockResolvedValue([])
})

describe("social AI draft service", () => {
  it("routes external Meta/TikTok comments to manual work and owned account matches to direct mode", () => {
    expect(resolveEngagementMode({ platform: "instagram", accountId: null, sourceType: "comment" })).toBe("MANUAL_EXTERNAL")
    expect(resolveEngagementMode({ platform: "instagram", accountId: null, contentKind: "POST" })).toBe("MANUAL_REVIEW")
    expect(resolveEngagementMode({
      platform: "tiktok",
      accountId: "official-account",
      senderAccountId: "official-account",
    })).toBe("OWNED_DIRECT")
    expect(resolveEngagementMode({ platform: "facebook", blocked: true })).toBe("NO_REPLY")
  })

  it("does not call the model or persist a draft while clean-slate collection is blocked", async () => {
    withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    const result = await createSocialMentionAiDraft({
      organizationId: "org-1",
      mention: {
        id: "m-blocked",
        organizationId: "org-1",
        platform: "facebook",
        text: "Please reply",
        authorName: "Aysel",
        authorHandle: "aysel",
        sentiment: "neutral",
        externalId: "comment-1",
      },
      orgName: "Official Brand",
      origin: "operator",
    })

    expect(result).toBeNull()
    expect(draftSocialReply).not.toHaveBeenCalled()
    expect(createDraft).not.toHaveBeenCalled()
  })

  it("selects only negative post/comment/reply candidates from a seven-day, 100-item window", async () => {
    findMentions.mockResolvedValue([
      {
        id: "m-negative",
        organizationId: "org-1",
        platform: "tiktok",
        text: "This was not helpful",
        authorName: "Aysel",
        authorHandle: "aysel",
        sentiment: "negative",
        externalId: "cw-1",
      },
      {
        id: "m-existing",
        organizationId: "org-1",
        platform: "tiktok",
        text: "This was not helpful",
        authorName: "Rauf",
        authorHandle: "rauf",
        sentiment: "negative",
        externalId: "cw-2",
      },
    ])
    findDrafts.mockResolvedValue([{ mentionId: "m-existing" }])

    const result = await findMentionsForSocialAiDraft("org-1", new Date("2026-06-29T10:00:00.000Z"))

    expect(result.map(m => m.id)).toEqual(["m-negative"])
    expect(findMentions).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        platform: { in: ["twitter", "facebook", "instagram", "tiktok"] },
        sentiment: "negative",
        createdAt: { gte: new Date("2026-06-22T10:00:00.000Z") },
        OR: [
          { contentKind: { in: ["POST", "COMMENT", "REPLY"] } },
          { sourceType: { in: ["post", "comment", "reply"] } },
        ],
      }),
      take: 100,
    }))
    expect(findDrafts).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        mentionId: { in: ["m-negative", "m-existing"] },
      },
    }))
  })

  it("binds generation to the subject-assigned agent instead of the organization default", async () => {
    findSubjectMatch.mockResolvedValue({
      id: "match-1",
      confidence: 0.98,
      subject: { id: "subject-1", name: "Araz", assignedAgentId: "agent-araz", replyPolicy: {} },
    } as never)
    findAgent.mockResolvedValue({
      id: "agent-araz", version: 4, systemPrompt: "Araz-specific voice", model: "model-1", temperature: 0.2,
    } as never)

    const draft = await createSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      mention: {
        id: "m-araz", organizationId: "org-1", platform: "facebook", text: "Bad service",
        authorName: "Customer", authorHandle: null, sentiment: "negative", externalId: "post-1", contentKind: "POST",
      },
    })

    expect(findAgent).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "agent-araz", organizationId: "org-1" }),
    }))
    expect(draft).toMatchObject({
      agentSnapshot: expect.objectContaining({ id: "agent-araz", version: 4, binding: "SUBJECT" }),
    })
  })

  it("keeps positive drafts approval-only without adding them to the risk queue", async () => {
    findSubjectMatch.mockResolvedValue({
      id: "match-1",
      confidence: 0.98,
      subject: {
        id: "subject-1",
        name: "Baku Electronics",
        assignedAgentId: null,
        replyPolicy: {},
        replyIdentities: [],
      },
    } as never)
    findSubjects.mockResolvedValue([
      { name: "Baku Electronics" },
      { name: "PharmaStore" },
    ] as never)
    const draft = await createSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      mention: {
        id: "m-positive",
        organizationId: "org-1",
        platform: "tiktok",
        text: "Great service",
        authorName: "Aysel",
        authorHandle: "aysel",
        sentiment: "positive",
        externalId: "cw-1",
        sourceType: "comment",
        contentKind: "COMMENT",
      },
      now: new Date("2026-06-29T10:00:00.000Z"),
    })

    expect(draft).toMatchObject({
      status: "needs_approval",
      approvedBy: null,
      approvedAt: null,
      sentAt: null,
      sendMode: "dry_run",
      engagementMode: "MANUAL_EXTERNAL",
      agentSnapshot: expect.objectContaining({ binding: "SAFE_DEFAULT" }),
      sendResult: expect.objectContaining({ skippedExternalSend: true, requiresApproval: true, liveSendAllowed: false }),
    })
    expect(draftSocialReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m-positive" }),
      "Official Brand",
      "en",
      null,
      "Baku Electronics",
      ["PharmaStore"],
    )
    expect(createDraft).toHaveBeenCalled()
    expect(prisma.aiAgentConfig.findMany).not.toHaveBeenCalled()
    expect(findAgent).not.toHaveBeenCalled()
    expect(prisma.manualEngagementTask.upsert).not.toHaveBeenCalled()
  })

  it("adds a negative external comment to the manual risk queue", async () => {
    findSubjectMatch.mockResolvedValue({
      id: "match-1",
      confidence: 0.98,
      subject: {
        id: "subject-1",
        name: "Baku Electronics",
        assignedAgentId: null,
        replyPolicy: {},
        replyIdentities: [],
      },
    } as never)
    findSubjects.mockResolvedValue([{ name: "Baku Electronics" }] as never)

    await createSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      mention: {
        id: "m-negative",
        organizationId: "org-1",
        platform: "facebook",
        text: "I am disappointed",
        authorName: "Customer",
        authorHandle: "customer",
        sentiment: "negative",
        externalId: "comment-1",
        sourceType: "comment",
        contentKind: "COMMENT",
      },
    })

    expect(prisma.manualEngagementTask.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        mentionId: "m-negative",
        engagementMode: "MANUAL_EXTERNAL",
      }),
    }))
  })

  it("creates a human-review-only complaint draft and keeps it in the manual risk queue", async () => {
    findSubjectMatch.mockResolvedValue({
      id: "match-1",
      confidence: 0.98,
      subject: {
        id: "subject-1",
        name: "Baku Electronics",
        assignedAgentId: null,
        replyPolicy: {},
        replyIdentities: [],
      },
    } as never)
    findSubjects.mockResolvedValue([{ name: "Baku Electronics" }] as never)

    const draft = await createSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      mention: {
        id: "m-complaint",
        organizationId: "org-1",
        platform: "instagram",
        text: "This is a complaint: the device is not working",
        authorName: "Customer",
        authorHandle: "customer",
        sentiment: "neutral",
        externalId: "comment-2",
        sourceType: "comment",
        contentKind: "COMMENT",
        // Providers may inherit official-post metadata onto a customer
        // comment. The comment must remain actionable.
        sourceMetadata: {
          officialArchive: true,
          relevanceReason: "official_author",
        },
      },
    })

    expect(draft).toMatchObject({
      status: "needs_approval",
      engagementMode: "MANUAL_EXTERNAL",
      forbiddenReason: "complaint",
      policySnapshot: expect.objectContaining({ humanReviewOnly: true }),
    })
    expect(draftSocialReply).toHaveBeenCalled()
    expect(prisma.manualEngagementTask.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        mentionId: "m-complaint",
        engagementMode: "MANUAL_EXTERNAL",
      }),
    }))
  })

  it("does not create a manual external task for a post", async () => {
    findSubjectMatch.mockResolvedValue({
      id: "match-1",
      confidence: 0.98,
      subject: {
        id: "subject-1",
        name: "Baku Electronics",
        assignedAgentId: null,
        replyPolicy: {},
        replyIdentities: [],
      },
    } as never)
    findSubjects.mockResolvedValue([{ name: "Baku Electronics" }] as never)

    const draft = await createSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      mention: {
        id: "m-post",
        organizationId: "org-1",
        platform: "tiktok",
        text: "New product video",
        authorName: "Publisher",
        authorHandle: "publisher",
        sentiment: "neutral",
        externalId: "post-1",
        sourceType: "post",
        contentKind: "POST",
      },
    })

    expect(draft).toMatchObject({ engagementMode: "MANUAL_REVIEW" })
    expect(prisma.manualEngagementTask.upsert).not.toHaveBeenCalled()
  })

  it("adds a harmful video publication to the manual risk-review queue", async () => {
    findSubjectMatch.mockResolvedValue({
      id: "match-1",
      confidence: 0.98,
      subject: {
        id: "subject-1",
        name: "Baku Electronics",
        assignedAgentId: null,
        replyPolicy: {},
        replyIdentities: [],
      },
    } as never)
    findSubjects.mockResolvedValue([{ name: "Baku Electronics" }] as never)

    await createSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      mention: {
        id: "m-risk-video",
        organizationId: "org-1",
        platform: "facebook",
        text: "Baku Electronics-dən aldığı iPhone 17 Pro-da donma problemi olduğunu iddia edir.",
        authorName: "Publisher",
        authorHandle: "publisher",
        sentiment: "negative",
        externalId: "video-1",
        sourceType: "post",
        contentKind: "VIDEO",
      },
    })

    expect(prisma.manualEngagementTask.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        mentionId: "m-risk-video",
        engagementMode: "MANUAL_REVIEW",
        reason: "brand_risk_review_required",
      }),
    }))
  })

  it("does not add an archived official direct publication to the manual risk queue", async () => {
    findSubjectMatch.mockResolvedValue({
      id: "match-1",
      confidence: 0.98,
      subject: {
        id: "subject-1",
        name: "Baku Electronics",
        assignedAgentId: null,
        replyPolicy: {},
        replyIdentities: [],
      },
    } as never)
    findSubjects.mockResolvedValue([{ name: "Baku Electronics" }] as never)

    const officialRiskMention = {
      id: "m-official-archive-video",
      organizationId: "org-1",
      platform: "tiktok",
      text: "Baku Electronics sifaris gecikib deyə rəsmi məlumat paylaşdı.",
      authorName: "Baku Electronics",
      authorHandle: "bakuelectronics",
      sentiment: "negative",
      externalId: "official-video-1",
      sourceType: "post",
      contentKind: "VIDEO",
      sourceMetadata: {
        officialArchive: true,
        relevanceReason: "official_author",
      },
    }
    expect(assessManualEngagementRisk(officialRiskMention).eligible).toBe(true)

    await createSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      mention: officialRiskMention,
    })

    expect(prisma.manualEngagementTask.upsert).not.toHaveBeenCalled()
  })

  it("never adds the brand's own harmful content to the external reply queue", async () => {
    findSubjectMatch.mockResolvedValue({
      id: "match-1",
      confidence: 0.98,
      subject: {
        id: "subject-1",
        name: "Baku Electronics",
        assignedAgentId: null,
        replyPolicy: {},
        replyIdentities: [{
          socialAccountId: "account-owned",
          allowOwnedReply: true,
          allowExternalReply: false,
        }],
      },
    } as never)
    findSubjects.mockResolvedValue([{ name: "Baku Electronics" }] as never)

    await createSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      mention: {
        id: "m-owned-video",
        organizationId: "org-1",
        platform: "facebook",
        accountId: "account-owned",
        text: "Baku Electronics cihazında problem barədə rəsmi məlumat.",
        authorName: "Baku Electronics",
        authorHandle: "baku-electronics",
        sentiment: "negative",
        externalId: "video-owned-1",
        sourceType: "post",
        contentKind: "VIDEO",
        sourceMetadata: { ownership: "owned" },
      },
    })

    expect(prisma.manualEngagementTask.upsert).not.toHaveBeenCalled()
  })

  it("creates negative scenario drafts as approval-only dry-run records", async () => {
    const draft = await createScenarioSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      scenario: {
        scenarioId: "scn-1",
        scenarioName: "Patrul monitoring",
        action: "draft_reply",
      },
      mention: {
        id: "m-scenario",
        organizationId: "org-1",
        platform: "instagram",
        text: "Hava proqnozu haqqında post",
        authorName: "Publisher",
        authorHandle: "publisher",
        sentiment: "negative",
        contentKind: "POST",
        externalId: "ig-1",
      },
      now: new Date("2026-07-06T00:24:00.000Z"),
    })

    expect(findDraft).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        mentionId: "m-scenario",
      }),
    }))
    expect(draft).toMatchObject({
      id: "draft-1",
      status: "needs_approval",
      approvedBy: null,
      approvedAt: null,
      sentAt: null,
      sendMode: "dry_run",
      sendResult: expect.objectContaining({
        mode: "draft_only",
        source: "scenario_triage",
        scenarioId: "scn-1",
        scenarioName: "Patrul monitoring",
        action: "draft_reply",
        requiresApproval: true,
        liveSendAllowed: false,
      }),
    })
  })

  it("does not create scenario drafts for neutral content", async () => {
    const draft = await createScenarioSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      scenario: { scenarioId: "scn-1", scenarioName: "Patrul monitoring", action: "draft_reply" },
      mention: {
        id: "m-neutral", organizationId: "org-1", platform: "instagram", text: "Neutral post",
        authorName: "Publisher", authorHandle: null, sentiment: "neutral", externalId: "ig-neutral", contentKind: "POST",
      },
    })

    expect(draft).toBeNull()
    expect(findDraft).not.toHaveBeenCalled()
    expect(createDraft).not.toHaveBeenCalled()
  })

  it("skips scenario drafts whenever a draft already exists", async () => {
    findDraft.mockResolvedValueOnce({ id: "draft-existing" })

    const draft = await createScenarioSocialMentionAiDraft({
      organizationId: "org-1",
      orgName: "LeadDrive",
      origin: "operator",
      scenario: {
        scenarioId: "scn-1",
        scenarioName: "Patrul monitoring",
        action: "draft_reply",
      },
      mention: {
        id: "m-existing",
        organizationId: "org-1",
        platform: "instagram",
        sentiment: "negative",
        contentKind: "COMMENT",
        text: "Hava proqnozu haqqında post",
        authorName: "Publisher",
        authorHandle: "publisher",
        externalId: "ig-1",
      },
      now: new Date("2026-07-06T00:24:00.000Z"),
    })

    expect(draft).toBeNull()
    expect(createDraft).not.toHaveBeenCalled()
  })

  // Прод: до 31 июля отбор кандидатов не фильтровал по тональности, и в очереди
  // осело 167 черновиков на положительные и нейтральные находки. Гейт стоит в
  // единственной точке создания, а не только в выборке крона.
  it.each([
    ["positive"],
    ["neutral"],
    ["unknown"],
    [null],
  ])("refuses an automatic draft for a %s finding", async (sentiment) => {
    const draft = await createSocialMentionAiDraft({
      organizationId: "org-1",
      mention: {
        id: "m-not-negative",
        organizationId: "org-1",
        platform: "instagram",
        text: "Çox sağ olun, əla xidmət",
        authorName: "Aysel",
        authorHandle: "aysel",
        sentiment,
        externalId: "comment-praise",
        contentKind: "COMMENT",
      },
      orgName: "LeadDrive",
      origin: "automatic",
    })

    expect(draft).toBeNull()
    expect(draftSocialReply).not.toHaveBeenCalled()
    expect(createDraft).not.toHaveBeenCalled()
    // Гейт срабатывает до конверта сбора: на не-негатив не тратится ни модель,
    // ни попытка взять аренду.
    expect(withTenantFence).not.toHaveBeenCalled()
  })

  it("still drafts automatically for a negative finding", async () => {
    const draft = await createSocialMentionAiDraft({
      organizationId: "org-1",
      mention: {
        id: "m-negative",
        organizationId: "org-1",
        platform: "instagram",
        text: "Məhsulun vaxtı keçmişdi",
        authorName: "Aysel",
        authorHandle: "aysel",
        sentiment: "negative",
        externalId: "comment-complaint",
        contentKind: "COMMENT",
      },
      orgName: "LeadDrive",
      origin: "automatic",
    })

    expect(draft).not.toBeNull()
    expect(draftSocialReply).toHaveBeenCalled()
  })

  it("lets an operator draft a reply to a finding the automation would skip", async () => {
    const draft = await createSocialMentionAiDraft({
      organizationId: "org-1",
      mention: {
        id: "m-operator",
        organizationId: "org-1",
        platform: "instagram",
        text: "Çox sağ olun",
        authorName: "Aysel",
        authorHandle: "aysel",
        sentiment: "positive",
        externalId: "comment-praise-2",
        contentKind: "COMMENT",
      },
      orgName: "LeadDrive",
      origin: "operator",
    })

    expect(draft).not.toBeNull()
  })
})
