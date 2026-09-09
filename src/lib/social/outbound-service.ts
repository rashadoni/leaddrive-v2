import crypto from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { classifySocialAiTopic, isHardBlockedSocialReplyTopic } from "@/lib/social/ai-reply-policy"
import {
  isSocialBrandProtectionOnly,
  SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE,
  SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_MESSAGE,
} from "@/lib/social/brand-protection"
import { hasApprovedProviderReplyCapability } from "@/lib/social/provider-reply"
import { isOwnedSocialContent } from "@/lib/social/reply-brand-integrity"

const APPROVER_ROLES = new Set(["admin", "manager"])
const TERMINAL_INVALIDATION_REASONS = new Set([
  "approval_missing",
  "approval_hash_mismatch",
  "content_version_changed",
  "draft_changed_after_approval",
  "source_content_deleted",
  "legal_review_required",
  "forbidden_topic",
  "sender_identity_revoked",
  "source_reply_capability_changed",
  SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE,
])

export type SocialReplyEnqueueRequest = {
  organizationId: string
  mentionId: string
  draftId?: string | null
  requestedBy: string
  replyText: string
  platform: string
  externalId: string
  sourceType: string
  sourceProvider: string
  sourceMetadata: unknown
}

export type SocialReplyEnqueueResult =
  | { ok: true; status: 201 | 200; code: "outbound_pending_approval" | "outbound_already_exists"; data: { id: string; state: string } }
  | { ok: false; status: 400 | 403 | 404 | 409; code: string; error: string }

export type OutboundGateDecision = {
  allowed: boolean
  reason: string
  retryable: boolean
  terminal: boolean
  snapshot: Record<string, unknown>
}

export async function getOrCreateSocialOutboundPolicy(organizationId: string) {
  return prisma.socialOutboundPolicy.upsert({
    where: { organizationId },
    create: {
      organizationId,
      liveEnabled: false,
      emergencyStopped: true,
      allowedPlatforms: [],
      maxPerHour: 10,
      requireSeparateApprover: true,
    },
    update: {},
  })
}

export async function enqueueOutboundSocialReply(request: SocialReplyEnqueueRequest): Promise<SocialReplyEnqueueResult> {
  const replyText = request.replyText.trim()
  if (!replyText || replyText.length > 2000) {
    return { ok: false, status: 400, code: "invalid_reply_text", error: "Reply text must contain 1–2000 characters." }
  }
  if (await isSocialBrandProtectionOnly(request.organizationId)) {
    return {
      ok: false,
      status: 403,
      code: SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE,
      error: SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_MESSAGE,
    }
  }

  const mention = await prisma.socialMention.findFirst({
    where: { organizationId: request.organizationId, id: request.mentionId },
    include: {
      subjectMatches: {
        where: { status: "MATCHED" },
        include: {
          subject: {
            select: { id: true, name: true },
          },
        },
        orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
        take: 1,
      },
    },
  })
  if (!mention) return { ok: false, status: 404, code: "mention_not_found", error: "Mention not found." }
  if (mention.platform !== request.platform || mention.externalId !== request.externalId) {
    return { ok: false, status: 409, code: "stale_request_target", error: "The reply target changed. Reload before continuing." }
  }
  if (mention.deletedAtSource || mention.purgedAt) {
    return { ok: false, status: 409, code: "source_content_deleted", error: "The source content is no longer available." }
  }

  const subjectMatch = mention.subjectMatches[0]
  const subject = subjectMatch?.subject
  if (!subject) {
    return { ok: false, status: 409, code: "subject_missing", error: "No matched monitoring subject was found for this material." }
  }

  const channel = await prisma.socialReplyChannelSetting.findFirst({
    where: { organizationId: request.organizationId, platform: mention.platform.toLowerCase() },
    include: { senderAccount: true },
  })
  if (!channel?.senderAccountId || !channel.senderAccount?.isActive) {
    return { ok: false, status: 409, code: "sender_account_missing", error: "Select a sender account for this platform first." }
  }
  if (isOwnedSocialContent({
    accountId: mention.accountId,
    contentKind: mention.contentKind,
    sourceType: mention.sourceType,
    sourceMetadata: mention.sourceMetadata,
    replyIdentityAccountIds: [channel.senderAccountId],
  })) {
    return {
      ok: false,
      status: 409,
      code: "owned_source_not_reply_target",
      error: "Replies are allowed only on external material, not on the tenant's own content.",
    }
  }
  const identity = await prisma.socialReplyIdentity.findFirst({
    where: {
      organizationId: request.organizationId,
      platform: mention.platform.toLowerCase(),
      socialAccountId: channel.senderAccountId,
      status: "active",
    },
    include: { socialAccount: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  })
  if (!identity) {
    return {
      ok: false,
      status: 409,
      code: "sender_identity_missing",
      error: "The selected official sender has no active reply authorization for this platform.",
    }
  }

  const adapterType = resolveAdapterType({
    platform: mention.platform,
    sourceProvider: mention.sourceProvider,
    sourceMetadata: mention.sourceMetadata,
    accountId: mention.accountId,
    senderAccountId: channel.senderAccountId,
    allowOwnedReply: identity.allowOwnedReply,
    allowExternalReply: identity.allowExternalReply,
  })
  if (!adapterType) {
    return { ok: false, status: 409, code: "manual_engagement_required", error: "No approved direct or provider reply capability. Use the manual interaction task." }
  }

  let draft: Awaited<ReturnType<typeof prisma.socialMentionAiDraft.findFirst>> = null
  if (request.draftId) {
    draft = await prisma.socialMentionAiDraft.findFirst({
      where: { organizationId: request.organizationId, id: request.draftId, mentionId: mention.id },
    })
    if (!draft) return { ok: false, status: 404, code: "draft_not_found", error: "Approved draft not found." }
    if (draft.subjectId !== subject.id) {
      return { ok: false, status: 409, code: "draft_subject_mismatch", error: "The approved draft belongs to a different monitored brand." }
    }
    if (draft.status !== "approved" || !draft.approvedBy || !draft.approvedAt) {
      return { ok: false, status: 409, code: "draft_not_approved", error: "The AI draft requires human approval first." }
    }
    if (draft.replyText !== replyText || draft.mentionContentVersion !== mention.contentVersion) {
      return { ok: false, status: 409, code: "draft_changed_after_approval", error: "The approved draft or source content changed. Approve a new version." }
    }
  }

  const replyTextSha256 = sha256(replyText)
  const idempotencyKey = sha256([
    request.organizationId,
    mention.id,
    String(mention.contentVersion),
    identity.id,
    replyTextSha256,
  ].join(":"))
  const existing = await prisma.outboundSocialReply.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: request.organizationId, idempotencyKey } },
  })
  if (existing) {
    return { ok: true, status: 200, code: "outbound_already_exists", data: { id: existing.id, state: existing.state } }
  }

  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.outboundSocialReply.create({
        data: {
          organizationId: request.organizationId,
          mentionId: mention.id,
          draftId: draft?.id ?? null,
          subjectId: subject.id,
          replyIdentityId: identity.id,
          senderAccountId: identity.socialAccountId,
          platform: mention.platform,
          adapterType,
          targetExternalId: mention.externalId,
          targetContentVersion: mention.contentVersion,
          replyText,
          replyTextSha256,
          idempotencyKey,
          state: "PENDING",
          requestedBy: request.requestedBy,
          approvalSnapshot: {
            draftId: draft?.id ?? null,
            draftApprovedBy: draft?.approvedBy ?? null,
            draftApprovedAt: draft?.approvedAt ?? null,
            subjectMatchId: subjectMatch.id,
            replyIdentityId: identity.id,
            adapterType,
          },
        },
      })
      await tx.outboundSocialReplyEvent.create({
        data: {
          organizationId: request.organizationId,
          outboundReplyId: row.id,
          eventType: "OUTBOUND_REQUESTED",
          toState: "PENDING",
          actorType: "USER",
          actorId: request.requestedBy,
          payload: { replyTextSha256, idempotencyKey, adapterType },
        },
      })
      return row
    })
    return { ok: true, status: 201, code: "outbound_pending_approval", data: { id: created.id, state: created.state } }
  } catch (error) {
    if (isUniqueViolation(error)) {
      const duplicate = await prisma.outboundSocialReply.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: request.organizationId, idempotencyKey } },
      })
      if (duplicate) return { ok: true, status: 200, code: "outbound_already_exists", data: { id: duplicate.id, state: duplicate.state } }
    }
    throw error
  }
}

export async function reviewOutboundSocialReply(input: {
  organizationId: string
  outboundReplyId: string
  reviewerId: string
  reviewerRole: string
  decision: "APPROVED" | "REJECTED"
}) {
  if (!APPROVER_ROLES.has(input.reviewerRole)) throw new OutboundReviewError("approver_role_required", 403)
  const outbound = await prisma.outboundSocialReply.findFirst({
    where: { organizationId: input.organizationId, id: input.outboundReplyId },
    include: { approval: true },
  })
  if (!outbound) throw new OutboundReviewError("outbound_not_found", 404)
  if (outbound.state !== "PENDING" || outbound.approval) throw new OutboundReviewError("outbound_already_reviewed", 409)
  if (outbound.requestedBy === input.reviewerId) throw new OutboundReviewError("separate_approver_required", 409)

  if (input.decision === "APPROVED") {
    const gate = await evaluateOutboundReplyGates(input.organizationId, outbound.id, new Date(), {
      prospectiveApproval: { approvedBy: input.reviewerId, contentSha256: outbound.replyTextSha256 },
    })
    if (!gate.allowed) throw new OutboundReviewError(gate.reason, 409, gate.snapshot)
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const approval = await tx.outboundSocialReplyApproval.create({
      data: {
        organizationId: input.organizationId,
        outboundReplyId: outbound.id,
        decision: input.decision,
        contentSha256: outbound.replyTextSha256,
        policySnapshot: { separateApprover: true, reviewerRole: input.reviewerRole },
        approvedBy: input.reviewerId,
        approverRole: input.reviewerRole,
      },
    })
    const intermediate = await tx.outboundSocialReply.updateMany({
      where: { organizationId: input.organizationId, id: outbound.id, state: "PENDING" },
      data: {
        state: input.decision === "APPROVED" ? "APPROVED" : "CANCELED",
        approvedBy: input.reviewerId,
        approvedAt: new Date(),
        canceledAt: input.decision === "REJECTED" ? new Date() : null,
      },
    })
    if (intermediate.count !== 1) throw new OutboundReviewError("outbound_review_conflict", 409)
    let state = input.decision === "APPROVED" ? "APPROVED" : "CANCELED"
    if (input.decision === "APPROVED") {
      const queued = await tx.outboundSocialReply.updateMany({
        where: { organizationId: input.organizationId, id: outbound.id, state: "APPROVED" },
        data: { state: "QUEUED", nextAttemptAt: new Date() },
      })
      if (queued.count !== 1) throw new OutboundReviewError("outbound_queue_conflict", 409)
      state = "QUEUED"
    }
    await tx.outboundSocialReplyEvent.create({
      data: {
        organizationId: input.organizationId,
        outboundReplyId: outbound.id,
        eventType: input.decision === "APPROVED" ? "OUTBOUND_APPROVED_AND_QUEUED" : "OUTBOUND_REJECTED",
        fromState: "PENDING",
        toState: state,
        actorType: "USER",
        actorId: input.reviewerId,
        payload: { approvalId: approval.id, decision: input.decision, contentSha256: outbound.replyTextSha256 },
      },
    })
    return { approval, state }
  })
}

export async function evaluateOutboundReplyGates(
  organizationId: string,
  outboundReplyId: string,
  now = new Date(),
  options?: { prospectiveApproval?: { approvedBy: string; contentSha256: string } },
): Promise<OutboundGateDecision> {
  const outbound = await prisma.outboundSocialReply.findFirst({
    where: { organizationId, id: outboundReplyId },
    include: {
      approval: true,
      draft: true,
      replyIdentity: true,
      senderAccount: true,
      mention: {
        include: {
          legalCases: { where: { status: { in: ["open", "included"] } }, select: { id: true }, take: 1 },
          legalCandidates: { where: { status: { in: ["NEW", "AI_REVIEWED", "HUMAN_REVIEW", "PROMOTED"] } }, select: { id: true }, take: 1 },
        },
      },
    },
  })
  if (!outbound) return denied("outbound_not_found", false, true)
  const providerKey = providerKeyFromMetadata(outbound.mention.sourceMetadata)
  const [policy, channel, providerProof, brandProtectionOnly] = await Promise.all([
    getOrCreateSocialOutboundPolicy(organizationId),
    prisma.socialReplyChannelSetting.findFirst({ where: { organizationId, platform: outbound.platform } }),
    outbound.adapterType === "PROVIDER" && providerKey
      ? prisma.socialProviderCapabilityProof.findFirst({
          where: {
            organizationId,
            platform: outbound.platform,
            providerKey,
            capability: { in: ["REPLY_EXTERNAL", "REPLY_OWNED"] },
            status: "VERIFIED",
            replyAllowed: true,
            sandboxVerifiedAt: { not: null },
            expiresAt: { gt: now },
          },
          select: { id: true, providerKey: true, contractVersion: true, expiresAt: true },
        })
      : Promise.resolve(null),
    isSocialBrandProtectionOnly(organizationId),
  ])
  const approval = outbound.approval ?? (options?.prospectiveApproval ? {
    decision: "APPROVED",
    approvedBy: options.prospectiveApproval.approvedBy,
    contentSha256: options.prospectiveApproval.contentSha256,
    approverRole: "prospective",
  } : null)
  const snapshot: Record<string, unknown> = {
    evaluatedAt: now.toISOString(),
    policyVersion: policy.policyVersion,
    globalEnabled: process.env.SOCIAL_OUTBOUND_LIVE_ENABLED === "1",
    globalKillSwitch: process.env.SOCIAL_OUTBOUND_KILL_SWITCH === "1",
    tenantLiveEnabled: policy.liveEnabled,
    tenantEmergencyStopped: policy.emergencyStopped,
    brandProtectionOnly,
    platform: outbound.platform,
    channelLiveEnabled: channel?.liveEnabled ?? false,
    senderAccountId: outbound.senderAccountId,
    senderOutboundLiveEnabled: outbound.senderAccount.outboundLiveEnabled,
    senderEmergencyStopped: outbound.senderAccount.outboundEmergencyStopped,
    adapterType: outbound.adapterType,
    providerCapabilityProofId: providerProof?.id ?? null,
    contentVersion: outbound.mention.contentVersion,
    approvedContentVersion: outbound.targetContentVersion,
  }

  if (brandProtectionOnly) {
    return denied(SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE, false, true, snapshot)
  }
  if (process.env.SOCIAL_OUTBOUND_KILL_SWITCH === "1") return denied("global_kill_switch", true, false, snapshot)
  if (process.env.SOCIAL_OUTBOUND_LIVE_ENABLED !== "1") return denied("global_live_send_disabled", true, false, snapshot)
  if (!policy.liveEnabled || policy.emergencyStopped || !policy.releaseReviewedAt) return denied("tenant_live_send_disabled", true, false, snapshot)
  if (!policy.allowedPlatforms.includes(outbound.platform)) return denied("platform_not_released", true, false, snapshot)
  if (!channel?.liveEnabled || channel.sendMode !== "approval" || channel.senderAccountId !== outbound.senderAccountId) {
    return denied("channel_live_send_disabled", true, false, snapshot)
  }
  if (!outbound.senderAccount.isActive || !outbound.senderAccount.outboundLiveEnabled || outbound.senderAccount.outboundEmergencyStopped) {
    return denied("connection_live_send_disabled", true, false, snapshot)
  }
  if (!outbound.senderAccount.outboundVerifiedAt || outbound.senderAccount.outboundCapability !== outbound.adapterType) {
    return denied("connection_capability_unverified", true, false, snapshot)
  }
  if (outbound.adapterType === "PROVIDER" && !providerProof) return denied("provider_reply_proof_missing", true, false, snapshot)
  if (outbound.senderAccount.tokenExpiresAt && outbound.senderAccount.tokenExpiresAt.getTime() <= now.getTime() + 300_000) {
    return denied("sender_token_expired", true, false, snapshot)
  }
  if (outbound.adapterType === "DIRECT" && !outbound.senderAccount.accessToken) return denied("sender_token_missing", true, false, snapshot)
  if (outbound.replyIdentity.status !== "active" || outbound.replyIdentity.socialAccountId !== outbound.senderAccountId) {
    return denied("sender_identity_revoked", false, true, snapshot)
  }
  const mentionMetadata = asRecord(outbound.mention.sourceMetadata)
  const youtubeExternalIdentityAllowed = outbound.platform === "youtube" && outbound.replyIdentity.allowExternalReply
  const youtubeExternalReplyAllowed = youtubeExternalIdentityAllowed && mentionMetadata.youtubeCanReply === true
  if (outbound.adapterType === "DIRECT" && !outbound.replyIdentity.allowOwnedReply && !youtubeExternalIdentityAllowed) {
    return denied("sender_identity_revoked", false, true, snapshot)
  }
  if (outbound.adapterType === "PROVIDER" && !outbound.replyIdentity.allowExternalReply) return denied("sender_identity_revoked", false, true, snapshot)
  if (
    outbound.adapterType === "DIRECT" &&
    outbound.mention.accountId !== outbound.senderAccountId &&
    mentionMetadata.ownership !== "owned" &&
    !youtubeExternalReplyAllowed
  ) return denied("source_reply_capability_changed", false, true, snapshot)
  if (outbound.adapterType === "PROVIDER" && !hasApprovedProviderReplyCapability(outbound.mention.sourceMetadata)) {
    return denied("source_reply_capability_changed", false, true, snapshot)
  }
  if (!approval || approval.decision !== "APPROVED") return denied("approval_missing", false, true, snapshot)
  if (policy.requireSeparateApprover && approval.approvedBy === outbound.requestedBy) return denied("separate_approver_required", false, true, snapshot)
  if (approval.contentSha256 !== outbound.replyTextSha256 || sha256(outbound.replyText) !== outbound.replyTextSha256) {
    return denied("approval_hash_mismatch", false, true, snapshot)
  }
  if (outbound.mention.contentVersion !== outbound.targetContentVersion) return denied("content_version_changed", false, true, snapshot)
  if (outbound.mention.deletedAtSource || outbound.mention.purgedAt || !outbound.targetExternalId) return denied("source_content_deleted", false, true, snapshot)
  if (outbound.draft && (
    outbound.draft.status !== "approved" ||
    outbound.draft.replyText !== outbound.replyText ||
    outbound.draft.mentionContentVersion !== outbound.mention.contentVersion
  )) return denied("draft_changed_after_approval", false, true, snapshot)
  if (outbound.mention.legalCases.length > 0 || outbound.mention.legalCandidates.length > 0) return denied("legal_review_required", false, true, snapshot)
  if (isHardBlockedSocialReplyTopic(classifySocialAiTopic(outbound.mention.text))) {
    return denied("forbidden_topic", false, true, snapshot)
  }
  if (isQuietHour(now, policy.timeZone, policy.quietHoursStart, policy.quietHoursEnd)) return denied("quiet_hours", true, false, snapshot)

  const sentLastHour = await prisma.outboundSocialReply.count({
    where: {
      organizationId,
      id: { not: outbound.id },
      state: { in: ["SENDING", "SENT"] },
      updatedAt: { gte: new Date(now.getTime() - 3_600_000) },
    },
  })
  if (sentLastHour >= policy.maxPerHour) return denied("tenant_rate_limit", true, false, { ...snapshot, sentLastHour, maxPerHour: policy.maxPerHour })
  return { allowed: true, reason: "allowed", retryable: false, terminal: false, snapshot: { ...snapshot, sentLastHour, maxPerHour: policy.maxPerHour } }
}

export function isTerminalOutboundInvalidation(reason: string) {
  return TERMINAL_INVALIDATION_REASONS.has(reason)
}

export class OutboundReviewError extends Error {
  constructor(public code: string, public status: number, public details?: Record<string, unknown>) {
    super(code)
  }
}

function resolveAdapterType(input: {
  platform: string
  sourceProvider: string
  sourceMetadata: unknown
  accountId: string | null
  senderAccountId: string
  allowOwnedReply: boolean
  allowExternalReply: boolean
}): "DIRECT" | "PROVIDER" | null {
  if (
    input.sourceProvider === "provider_api" &&
    input.allowExternalReply &&
    hasApprovedProviderReplyCapability(input.sourceMetadata) &&
    providerKeyFromMetadata(input.sourceMetadata)
  ) return "PROVIDER"
  const metadata = asRecord(input.sourceMetadata)
  const owned = input.accountId === input.senderAccountId || metadata.ownership === "owned"
  const youtubeExternal = input.platform === "youtube"
    && input.allowExternalReply
    && metadata.youtubeCanReply === true
    && ["native", "official_api", "poller"].includes(input.sourceProvider)
  return (owned && input.allowOwnedReply) || youtubeExternal ? "DIRECT" : null
}

function denied(reason: string, retryable: boolean, terminal: boolean, snapshot: Record<string, unknown> = {}): OutboundGateDecision {
  return { allowed: false, reason, retryable, terminal, snapshot: { ...snapshot, reason } }
}

function isQuietHour(now: Date, timeZone: string, start: number | null, end: number | null) {
  if (start === null || end === null || start === end) return false
  let hour: number
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now))
  } catch {
    return true
  }
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function providerKeyFromMetadata(value: unknown) {
  const metadata = asRecord(value)
  const capability = Object.keys(asRecord(metadata.replyCapability)).length
    ? asRecord(metadata.replyCapability)
    : asRecord(metadata.providerReply)
  return typeof capability.provider === "string" && capability.provider.trim() ? capability.provider.trim() : null
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}
