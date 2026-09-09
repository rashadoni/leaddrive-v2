import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = {
  outboundSocialReply: { create: vi.fn(), updateMany: vi.fn() },
  outboundSocialReplyApproval: { create: vi.fn() },
  outboundSocialReplyEvent: { create: vi.fn() },
}

const mockPrisma = vi.hoisted(() => ({
  organization: { findUnique: vi.fn() },
  socialMention: { findFirst: vi.fn() },
  socialMentionAiDraft: { findFirst: vi.fn() },
  socialReplyChannelSetting: { findFirst: vi.fn() },
  socialReplyIdentity: { findFirst: vi.fn() },
  socialOutboundPolicy: { upsert: vi.fn() },
  socialProviderCapabilityProof: { findFirst: vi.fn() },
  outboundSocialReply: { findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

import { enqueueOutboundSocialReply, evaluateOutboundReplyGates, reviewOutboundSocialReply } from "@/lib/social/outbound-service"

const account = {
  id: "account-1",
  platform: "instagram",
  handle: "brand",
  displayName: "Brand",
  accessToken: "encrypted",
  // Заведомо далёкий срок: раньше стояло 2026-08-01, и в день наступления этой
  // даты проверки ниже начали падать на `sender_token_expired` вместо своих
  // гейтов. Фикстура не должна зависеть от календаря прогона.
  tokenExpiresAt: new Date("2030-01-01T00:00:00Z"),
  isActive: true,
  outboundLiveEnabled: true,
  outboundEmergencyStopped: false,
  outboundCapability: "DIRECT",
  outboundVerifiedAt: new Date("2026-07-12T00:00:00Z"),
}

const identity = {
  id: "identity-1",
  socialAccountId: "account-1",
  allowOwnedReply: true,
  allowExternalReply: false,
  status: "active",
  socialAccount: account,
}

const mention = {
  id: "mention-1",
  organizationId: "org-1",
  accountId: "account-1",
  platform: "instagram",
  externalId: "comment-1",
  sourceType: "comment",
  sourceProvider: "native",
  sourceMetadata: { ownership: "external" },
  text: "Thanks for the service",
  contentVersion: 2,
  deletedAtSource: null,
  purgedAt: null,
  subjectMatches: [{
    id: "match-1",
    subject: { id: "subject-1", replyIdentities: [identity] },
  }],
}

const outbound = {
  id: "outbound-1",
  organizationId: "org-1",
  mentionId: "mention-1",
  draftId: null,
  subjectId: "subject-1",
  replyIdentityId: "identity-1",
  senderAccountId: "account-1",
  platform: "instagram",
  adapterType: "DIRECT",
  targetExternalId: "comment-1",
  targetContentVersion: 2,
  replyText: "Thank you",
  replyTextSha256: "268bc1833e83306f48ae6203eefb86e7a39dedb1d3d6df99c18ef70aa61ef84d",
  requestedBy: "requester-1",
  state: "PENDING",
  approval: {
    decision: "APPROVED",
    approvedBy: "reviewer-1",
    contentSha256: "268bc1833e83306f48ae6203eefb86e7a39dedb1d3d6df99c18ef70aa61ef84d",
  },
  draft: null,
  replyIdentity: identity,
  senderAccount: account,
  mention: { ...mention, legalCases: [], legalCandidates: [] },
}

const policy = {
  id: "policy-1",
  organizationId: "org-1",
  liveEnabled: true,
  emergencyStopped: false,
  allowedPlatforms: ["instagram"],
  maxPerHour: 10,
  quietHoursStart: null,
  quietHoursEnd: null,
  timeZone: "UTC",
  requireSeparateApprover: true,
  policyVersion: 2,
  releaseReviewedAt: new Date("2026-07-12T00:00:00Z"),
  releaseReviewedBy: "admin-1",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv("SOCIAL_OUTBOUND_LIVE_ENABLED", "1")
  vi.stubEnv("SOCIAL_OUTBOUND_KILL_SWITCH", "0")
  mockPrisma.organization.findUnique.mockResolvedValue({ features: [] })
  mockPrisma.socialMention.findFirst.mockResolvedValue(mention)
  mockPrisma.socialReplyChannelSetting.findFirst.mockResolvedValue({
    senderAccountId: "account-1",
    senderAccount: account,
    liveEnabled: true,
    sendMode: "approval",
  })
  mockPrisma.socialReplyIdentity.findFirst.mockResolvedValue(identity)
  mockPrisma.socialOutboundPolicy.upsert.mockResolvedValue(policy)
  mockPrisma.outboundSocialReply.findUnique.mockResolvedValue(null)
  mockPrisma.outboundSocialReply.findFirst.mockResolvedValue(outbound)
  mockPrisma.outboundSocialReply.count.mockResolvedValue(0)
  tx.outboundSocialReply.create.mockResolvedValue({ id: "outbound-1", state: "PENDING" })
  tx.outboundSocialReply.updateMany.mockResolvedValue({ count: 1 })
  tx.outboundSocialReplyApproval.create.mockResolvedValue({ id: "approval-1" })
  tx.outboundSocialReplyEvent.create.mockResolvedValue({})
  mockPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))
})

describe("social outbound service", () => {
  it("rejects enqueue before creating an outbox row in Brand Protection mode", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ features: ["social_brand_protection_only"] })

    const result = await enqueueOutboundSocialReply({
      organizationId: "org-1",
      mentionId: "mention-1",
      requestedBy: "requester-1",
      replyText: "Thank you",
      platform: "instagram",
      externalId: "comment-1",
      sourceType: "comment",
      sourceProvider: "native",
      sourceMetadata: { ownership: "external" },
    })

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: "brand_protection_only",
    })
    expect(mockPrisma.socialMention.findFirst).not.toHaveBeenCalled()
    expect(tx.outboundSocialReply.create).not.toHaveBeenCalled()
  })

  it("creates only a PENDING outbox row and never calls a publisher", async () => {
    const result = await enqueueOutboundSocialReply({
      organizationId: "org-1",
      mentionId: "mention-1",
      requestedBy: "requester-1",
      replyText: "Thank you",
      platform: "instagram",
      externalId: "comment-1",
      sourceType: "comment",
      sourceProvider: "native",
      sourceMetadata: { ownership: "external" },
    })

    expect(result).toMatchObject({ ok: true, status: 201, data: { state: "PENDING" } })
    expect(tx.outboundSocialReply.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "PENDING", adapterType: "DIRECT", replyIdentityId: "identity-1" }),
    }))
    expect(tx.outboundSocialReplyEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "OUTBOUND_REQUESTED", actorType: "USER" }),
    }))
  })

  it("collapses a duplicate request by deterministic idempotency key", async () => {
    mockPrisma.outboundSocialReply.findUnique.mockResolvedValue({ id: "existing-1", state: "PENDING" })

    const result = await enqueueOutboundSocialReply({
      organizationId: "org-1",
      mentionId: "mention-1",
      requestedBy: "requester-1",
      replyText: "Thank you",
      platform: "instagram",
      externalId: "comment-1",
      sourceType: "comment",
      sourceProvider: "native",
      sourceMetadata: {},
    })

    expect(result).toMatchObject({ ok: true, code: "outbound_already_exists", data: { id: "existing-1" } })
    expect(tx.outboundSocialReply.create).not.toHaveBeenCalled()
  })

  it("rejects an approved draft bound to another monitored brand", async () => {
    mockPrisma.socialMentionAiDraft.findFirst.mockResolvedValue({
      id: "draft-other-brand",
      subjectId: "subject-other",
      status: "approved",
      approvedBy: "manager-1",
      approvedAt: new Date("2026-07-12T09:00:00Z"),
      replyText: "Thank you",
      mentionContentVersion: 2,
    })

    const result = await enqueueOutboundSocialReply({
      organizationId: "org-1",
      mentionId: "mention-1",
      draftId: "draft-other-brand",
      requestedBy: "requester-1",
      replyText: "Thank you",
      platform: "instagram",
      externalId: "comment-1",
      sourceType: "comment",
      sourceProvider: "native",
      sourceMetadata: { ownership: "external" },
    })

    expect(result).toMatchObject({ ok: false, code: "draft_subject_mismatch" })
    expect(tx.outboundSocialReply.create).not.toHaveBeenCalled()
  })

  it("does not create a provider outbox item when the source lacks an exact provider identity", async () => {
    mockPrisma.socialMention.findFirst.mockResolvedValue({
      ...mention,
      accountId: null,
      sourceProvider: "provider_api",
      sourceMetadata: {
        replyCapability: {
          approved: true,
          endpoint: "https://reply.example.com/comments/reply",
          targetId: "comment-1",
        },
      },
      subjectMatches: [{
        id: "match-1",
        subject: {
          id: "subject-1",
          replyIdentities: [{ ...identity, allowOwnedReply: false, allowExternalReply: true }],
        },
      }],
    })
    mockPrisma.socialReplyIdentity.findFirst.mockResolvedValue({
      ...identity,
      allowOwnedReply: false,
      allowExternalReply: true,
    })

    const result = await enqueueOutboundSocialReply({
      organizationId: "org-1",
      mentionId: "mention-1",
      requestedBy: "requester-1",
      replyText: "Thank you",
      platform: "instagram",
      externalId: "comment-1",
      sourceType: "comment",
      sourceProvider: "provider_api",
      sourceMetadata: {},
    })

    expect(result).toMatchObject({ ok: false, code: "manual_engagement_required" })
    expect(tx.outboundSocialReply.create).not.toHaveBeenCalled()
  })

  it("allows an explicitly approved YouTube identity to queue a canReply external thread", async () => {
    const youtubeIdentity = { ...identity, allowOwnedReply: false, allowExternalReply: true }
    mockPrisma.socialReplyIdentity.findFirst.mockResolvedValue(youtubeIdentity)
    mockPrisma.socialMention.findFirst.mockResolvedValue({
      ...mention,
      platform: "youtube",
      accountId: null,
      sourceProvider: "native",
      sourceMetadata: { ownership: "external", youtubeCanReply: true, topLevelCommentId: "comment-1" },
      subjectMatches: [{ id: "match-1", subject: { id: "subject-1", replyIdentities: [youtubeIdentity] } }],
    })

    const result = await enqueueOutboundSocialReply({
      organizationId: "org-1",
      mentionId: "mention-1",
      requestedBy: "requester-1",
      replyText: "Thank you",
      platform: "youtube",
      externalId: "comment-1",
      sourceType: "comment",
      sourceProvider: "native",
      sourceMetadata: { ownership: "external", youtubeCanReply: true },
    })

    expect(result).toMatchObject({ ok: true, status: 201 })
    expect(tx.outboundSocialReply.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ platform: "youtube", adapterType: "DIRECT" }),
    }))
  })

  it("allows a fully released, separately approved, unchanged reply", async () => {
    await expect(evaluateOutboundReplyGates("org-1", "outbound-1", new Date("2026-07-12T10:00:00Z")))
      .resolves.toMatchObject({ allowed: true, reason: "allowed" })
  })

  it("terminally blocks an already queued reply when Brand Protection mode is active", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ features: ["social_brand_protection_only"] })

    await expect(evaluateOutboundReplyGates("org-1", "outbound-1", new Date("2026-07-12T10:00:00Z")))
      .resolves.toMatchObject({
        allowed: false,
        reason: "brand_protection_only",
        retryable: false,
        terminal: true,
        snapshot: { brandProtectionOnly: true },
      })
    expect(mockPrisma.outboundSocialReply.count).not.toHaveBeenCalled()
  })

  it("keeps external YouTube replies behind identity and canReply gates", async () => {
    mockPrisma.socialOutboundPolicy.upsert.mockResolvedValue({ ...policy, allowedPlatforms: ["youtube"] })
    mockPrisma.outboundSocialReply.findFirst.mockResolvedValue({
      ...outbound,
      platform: "youtube",
      senderAccount: { ...account, platform: "youtube" },
      replyIdentity: { ...identity, allowOwnedReply: false, allowExternalReply: true },
      mention: {
        ...outbound.mention,
        platform: "youtube",
        accountId: null,
        sourceMetadata: { ownership: "external", youtubeCanReply: true, topLevelCommentId: "comment-1" },
      },
    })

    await expect(evaluateOutboundReplyGates("org-1", "outbound-1", new Date("2026-07-12T10:00:00Z")))
      .resolves.toMatchObject({ allowed: true, reason: "allowed" })

    mockPrisma.outboundSocialReply.findFirst.mockResolvedValue({
      ...outbound,
      platform: "youtube",
      senderAccount: { ...account, platform: "youtube" },
      replyIdentity: { ...identity, allowOwnedReply: false, allowExternalReply: true },
      mention: { ...outbound.mention, platform: "youtube", accountId: null, sourceMetadata: { ownership: "external", youtubeCanReply: false } },
    })
    await expect(evaluateOutboundReplyGates("org-1", "outbound-1", new Date("2026-07-12T10:00:00Z")))
      .resolves.toMatchObject({ allowed: false, reason: "source_reply_capability_changed", terminal: true })
  })

  it("invalidates approval when source content version changes", async () => {
    mockPrisma.outboundSocialReply.findFirst.mockResolvedValue({
      ...outbound,
      mention: { ...outbound.mention, contentVersion: 3 },
    })

    await expect(evaluateOutboundReplyGates("org-1", "outbound-1", new Date("2026-07-12T10:00:00Z")))
      .resolves.toMatchObject({ allowed: false, reason: "content_version_changed", terminal: true })
  })

  it("blocks a source-deleted mention from outbound delivery", async () => {
    mockPrisma.outboundSocialReply.findFirst.mockResolvedValue({
      ...outbound,
      mention: { ...outbound.mention, deletedAtSource: new Date("2026-07-18T12:00:00Z") },
    })

    await expect(evaluateOutboundReplyGates("org-1", "outbound-1", new Date("2026-07-12T10:00:00Z")))
      .resolves.toMatchObject({ allowed: false, reason: "source_content_deleted", terminal: true })
  })

  it("fails closed when the global kill switch is active", async () => {
    vi.stubEnv("SOCIAL_OUTBOUND_KILL_SWITCH", "1")

    await expect(evaluateOutboundReplyGates("org-1", "outbound-1", new Date("2026-07-12T10:00:00Z")))
      .resolves.toMatchObject({ allowed: false, reason: "global_kill_switch", retryable: true })
  })

  it("requires a different human reviewer", async () => {
    mockPrisma.outboundSocialReply.findFirst.mockResolvedValueOnce({ ...outbound, approval: null })
    await expect(reviewOutboundSocialReply({
      organizationId: "org-1",
      outboundReplyId: "outbound-1",
      reviewerId: "requester-1",
      reviewerRole: "admin",
      decision: "APPROVED",
    })).rejects.toMatchObject({ code: "separate_approver_required", status: 409 })
    expect(tx.outboundSocialReplyApproval.create).not.toHaveBeenCalled()
  })

  it("writes one immutable approval then queues through CAS transitions", async () => {
    mockPrisma.outboundSocialReply.findFirst
      .mockResolvedValueOnce({ ...outbound, approval: null })
      .mockResolvedValueOnce({ ...outbound, approval: null })
    const result = await reviewOutboundSocialReply({
      organizationId: "org-1",
      outboundReplyId: "outbound-1",
      reviewerId: "reviewer-1",
      reviewerRole: "manager",
      decision: "APPROVED",
    })

    expect(result).toMatchObject({ state: "QUEUED", approval: { id: "approval-1" } })
    expect(tx.outboundSocialReplyApproval.create).toHaveBeenCalledTimes(1)
    expect(tx.outboundSocialReply.updateMany).toHaveBeenCalledTimes(2)
    expect(tx.outboundSocialReplyEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "OUTBOUND_APPROVED_AND_QUEUED", fromState: "PENDING", toState: "QUEUED" }),
    }))
  })
})
