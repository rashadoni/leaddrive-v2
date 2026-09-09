import { prisma } from "@/lib/prisma"
import { draftSocialReply } from "@/lib/ai/social-reply"
import { getSubjectSocialAgentPersona } from "@/lib/ai/social-agent"
import {
  type SocialAiRegenerateReason,
  canDraftSocialReplyForHumanReview,
  classifySocialAiTopic,
  detectSocialReplyLanguage,
  isHardBlockedSocialReplyTopic,
  shouldDryRunAutoSendSocialReply,
} from "@/lib/social/ai-reply-policy"
import {
  isExternalCommentOrReply,
  isOwnedSocialContent,
  TENANT_RESPONDER_REPLY_PROMPT_VERSION,
} from "@/lib/social/reply-brand-integrity"
import { isManualEngagementRiskCandidate } from "@/lib/social/manual-engagement-policy"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

export interface SocialMentionForAiDraft {
  id: string
  organizationId: string
  platform: string
  text: string
  authorName: string | null
  authorHandle: string | null
  sentiment: string | null
  externalId: string
  accountId?: string | null
  contentVersion?: number
  sourceType?: string | null
  contentKind?: string | null
  sourceProvider?: string | null
  sourceMetadata?: unknown
  url?: string | null
}

export interface ScenarioDraftContext {
  scenarioId: string | null
  scenarioName: string | null
  action: "draft_reply"
}

export function socialAiDryRunResult(action: "auto_positive" | "approved_send") {
  return {
    mode: "dry_run",
    action,
    skippedExternalSend: true,
    requiresLiveConfirmation: true,
  }
}

export async function findMentionsForSocialAiDraft(orgId: string, now: Date): Promise<SocialMentionForAiDraft[]> {
  const recent = new Date(now.getTime() - 7 * 24 * 3600000)
  const mentions: SocialMentionForAiDraft[] = await prisma.socialMention.findMany({
    where: {
      organizationId: orgId,
      status: "new",
      createdAt: { gte: recent },
      // Совпадает с гейтом в createSocialMentionAiDraft; фильтр здесь — чтобы
      // не тащить из базы то, что всё равно будет отброшено.
      sentiment: "negative",
      OR: [
        { contentKind: { in: ["POST", "COMMENT", "REPLY"] } },
        { sourceType: { in: ["post", "comment", "reply"] } },
      ],
      platform: { in: ["twitter", "facebook", "instagram", "tiktok"] },
    },
    select: {
      id: true,
      organizationId: true,
      platform: true,
      text: true,
      authorName: true,
      authorHandle: true,
      sentiment: true,
      externalId: true,
      accountId: true,
      contentVersion: true,
      sourceType: true,
      contentKind: true,
      sourceProvider: true,
      sourceMetadata: true,
      url: true,
    },
    take: 100,
    orderBy: { createdAt: "desc" },
  })
  if (mentions.length === 0) return []

  const existing: Array<{ mentionId: string }> = await prisma.socialMentionAiDraft.findMany({
    where: {
      organizationId: orgId,
      mentionId: { in: mentions.map(m => m.id) },
    },
    select: { mentionId: true },
  })
  const skip = new Set(existing.map(d => d.mentionId))
  return mentions.filter(m => !skip.has(m.id))
}

/**
 * Кто заказал черновик.
 *
 * `automatic` — крон и триаж сценария: им разрешены ТОЛЬКО негативные находки.
 * `operator` — человек нажал «ИИ-черновик» в карточке; его решение мы не
 * переспрашиваем.
 *
 * Поле обязательное и без значения по умолчанию: новый вызов обязан объявить
 * свою природу, иначе правило тихо разъедется по копиям — ровно так и живут
 * дыры в проверках.
 */
export type SocialAiDraftOrigin = "automatic" | "operator"

/** Ответы генерируем только на негатив — одно определение на весь модуль. */
export function isNegativeSocialMention(sentiment: string | null | undefined): boolean {
  return sentiment?.trim().toLowerCase() === "negative"
}

type CreateSocialMentionAiDraftInput = {
  organizationId: string
  mention: SocialMentionForAiDraft
  orgName: string
  origin: SocialAiDraftOrigin
  regenerateReason?: SocialAiRegenerateReason
  sourceDraftId?: string
  autoSendPositive?: boolean
  draftContext?: Record<string, unknown>
  now?: Date
}

export async function createSocialMentionAiDraft(input: CreateSocialMentionAiDraftInput) {
  // Отбор кандидатов в кроне уже фильтрует по негативу, но фильтр в выборке —
  // не гарантия: до 31 июля его не было, и в очереди осело 167 черновиков на
  // положительные и нейтральные находки. Гейт стоит в единственной точке
  // создания, поэтому новый вызывающий не может его обойти, забыв про фильтр.
  if (input.origin === "automatic" && !isNegativeSocialMention(input.mention.sentiment)) return null
  const fenced = await withSocialMonitoringTenantCollectionFence(
    input.organizationId,
    () => createSocialMentionAiDraftWithinFence(input),
  )
  if (!fenced.allowed) return null
  return fenced.value
}

async function createSocialMentionAiDraftWithinFence(input: CreateSocialMentionAiDraftInput) {
  const language = detectSocialReplyLanguage(input.mention.text)
  const topic = classifySocialAiTopic(input.mention.text)
  const draftAllowed = canDraftSocialReplyForHumanReview(topic)
  const hardBlocked = isHardBlockedSocialReplyTopic(topic)
  const autoSend = input.autoSendPositive !== false && shouldDryRunAutoSendSocialReply(input.mention.sentiment, topic)

  const subjectMatch = await prisma.socialMentionSubjectMatch.findFirst({
    where: {
      organizationId: input.organizationId,
      mentionId: input.mention.id,
      status: "MATCHED",
    },
    include: {
      subject: true,
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
  })
  const subject = subjectMatch?.subject ?? null
  const [persona, replyChannel, organizationSubjects] = await Promise.all([
    getSubjectSocialAgentPersona(input.organizationId, subject?.assignedAgentId),
    prisma.socialReplyChannelSetting.findFirst({
      where: {
        organizationId: input.organizationId,
        platform: input.mention.platform.toLowerCase(),
      },
      include: {
        senderAccount: {
          select: {
            id: true,
            handle: true,
            displayName: true,
          },
        },
      },
    }),
    prisma.monitoringSubject.findMany({
      where: { organizationId: input.organizationId, status: { not: "deleted" } },
      select: { name: true },
      take: 100,
    }),
  ])
  const senderAccount = replyChannel?.senderAccount ?? null
  const responderName = senderAccount?.displayName?.trim()
    || senderAccount?.handle?.trim()
    || input.orgName.trim()
    || "the company"
  const engagementMode = resolveEngagementMode({
    platform: input.mention.platform,
    accountId: input.mention.accountId,
    contentKind: input.mention.contentKind,
    sourceType: input.mention.sourceType,
    sourceMetadata: input.mention.sourceMetadata,
    senderAccountId: senderAccount?.id ?? null,
    blocked: hardBlocked,
  })

  let draft: Awaited<ReturnType<typeof draftSocialReply>> = null
  if (draftAllowed) {
    draft = await draftSocialReply(
      input.mention,
      responderName,
      language,
      persona,
      subject?.name ?? null,
      organizationSubjects
        .map(item => item.name)
        .filter(name => name !== subject?.name),
    )
    if (!draft) return null
  }

  const routingRecommendation = hardBlocked
    ? "NO_REPLY"
    : engagementMode === "MANUAL_EXTERNAL"
      ? "MANUAL_ENGAGEMENT"
      : "HUMAN_REVIEW"
  const created = await prisma.socialMentionAiDraft.create({
    data: {
      organizationId: input.organizationId,
      mentionId: input.mention.id,
      subjectId: subject?.id ?? null,
      agentConfigId: persona?.id ?? null,
      mentionContentVersion: input.mention.contentVersion ?? 1,
      engagementMode,
      routingRecommendation,
      replyOptions: hardBlocked ? [
        { type: "NO_REPLY", recommended: true, reason: topic.reason },
        { type: "ROUTE_HUMAN", recommended: false },
      ] : [
        { type: "REPLY", text: draft?.reply, recommended: engagementMode !== "MANUAL_EXTERNAL" },
        { type: "NO_REPLY", recommended: false },
        { type: "ROUTE_HUMAN", recommended: engagementMode === "MANUAL_EXTERNAL" },
      ],
      agentSnapshot: persona ? {
        id: persona.id,
        name: persona.configName,
        version: persona.version,
        model: persona.model,
        temperature: persona.temperature,
        systemPrompt: persona.systemPrompt,
        binding: "SUBJECT",
      } : {
        binding: "SAFE_DEFAULT",
        version: TENANT_RESPONDER_REPLY_PROMPT_VERSION,
      },
      modelSnapshot: draft?.snapshot ?? { model: persona?.model ?? null, skipped: hardBlocked },
      promptSnapshot: {
        version: draft?.snapshot.promptVersion ?? TENANT_RESPONDER_REPLY_PROMPT_VERSION,
        maskedPromptSha256: draft?.snapshot.maskedPromptSha256 ?? null,
        language,
        subjectId: subject?.id ?? null,
        monitoredSubjectName: subject?.name ?? null,
        senderAccountId: senderAccount?.id ?? null,
        responderName,
        mentionContentVersion: input.mention.contentVersion ?? 1,
      },
      knowledgeSnapshot: { used: false, articleIds: [], reason: "knowledge_retrieval_not_configured" },
      policySnapshot: {
        externalSendAllowed: false,
        requiresApproval: true,
        humanReviewOnly: topic.blocked && !hardBlocked,
        topic,
        replyPolicy: subject?.replyPolicy ?? {},
        subjectMatchId: subjectMatch?.id ?? null,
        subjectMatchConfidence: subjectMatch?.confidence ?? null,
      },
      status: hardBlocked ? "blocked" : "needs_approval",
      sentiment: input.mention.sentiment,
      language,
      tone: draft?.tone || "official",
      replyText: draft?.reply ?? null,
      reasoning: draft?.reasoning ?? null,
      regenerateReason: input.regenerateReason ?? null,
      sourceDraftId: input.sourceDraftId ?? null,
      forbiddenReason: topic.reason,
      approvedBy: null,
      approvedAt: null,
      sentAt: null,
      sendMode: "dry_run",
      sendResult: {
        ...(input.draftContext ?? {}),
        mode: "draft_only",
        autoRecommendation: autoSend ? "reply" : "review",
        skippedExternalSend: true,
        requiresApproval: true,
        liveSendAllowed: false,
      },
    },
  })
  const ownedContent = isOwnedSocialContent({
    accountId: input.mention.accountId,
    contentKind: input.mention.contentKind,
    sourceType: input.mention.sourceType,
    sourceMetadata: input.mention.sourceMetadata,
    replyIdentityAccountIds: senderAccount?.id ? [senderAccount.id] : [],
  })
  if (subject && !ownedContent && isManualEngagementRiskCandidate(input.mention)) {
    const isCommentOrReply = isExternalCommentOrReply(input.mention)
    const manualEngagementMode = isCommentOrReply ? "MANUAL_EXTERNAL" : "MANUAL_REVIEW"
    const manualReason = isCommentOrReply
      ? "external_comment_reply_capability_unavailable"
      : "brand_risk_review_required"
    const manualInstructions = isCommentOrReply
      ? "Open the source comment, verify the current content, then reply manually from an authorized brand identity."
      : "Open the source publication, verify its brand relevance and current content, then assess impact and escalate or record the response."
    const manualTask = await prisma.manualEngagementTask.upsert({
      where: {
        organizationId_mentionId_draftId: {
          organizationId: input.organizationId,
          mentionId: input.mention.id,
          draftId: created.id,
        },
      },
      create: {
        organizationId: input.organizationId,
        mentionId: input.mention.id,
        subjectId: subject?.id ?? null,
        draftId: created.id,
        platform: input.mention.platform,
        engagementMode: manualEngagementMode,
        reason: manualReason,
        targetUrl: input.mention.url ?? null,
        instructions: manualInstructions,
      },
      update: {
        status: "OPEN",
        targetUrl: input.mention.url ?? null,
        engagementMode: manualEngagementMode,
        reason: manualReason,
        instructions: manualInstructions,
      },
    })
    await prisma.manualEngagementTask.updateMany({
      where: {
        organizationId: input.organizationId,
        mentionId: input.mention.id,
        status: "OPEN",
        id: { not: manualTask.id },
      },
      data: { status: "CANCELLED" },
    })
  }
  return created
}

export function resolveEngagementMode(input: {
  platform: string
  accountId?: string | null
  contentKind?: string | null
  sourceType?: string | null
  sourceMetadata?: unknown
  senderAccountId?: string | null
  blocked?: boolean
}) {
  if (input.blocked) return "NO_REPLY"
  const metadata = input.sourceMetadata && typeof input.sourceMetadata === "object" && !Array.isArray(input.sourceMetadata)
    ? input.sourceMetadata as Record<string, unknown>
    : {}
  if (
    !isExternalCommentOrReply(input)
    && input.senderAccountId
    && (input.senderAccountId === input.accountId || metadata.ownership === "owned")
  ) return "OWNED_DIRECT"
  if (
    ["facebook", "instagram", "tiktok"].includes(input.platform.toLowerCase())
    && isExternalCommentOrReply(input)
  ) return "MANUAL_EXTERNAL"
  return "MANUAL_REVIEW"
}

export async function createScenarioSocialMentionAiDraft(input: {
  organizationId: string
  mention: SocialMentionForAiDraft
  orgName: string
  scenario: ScenarioDraftContext
  now?: Date
}) {
  const now = input.now || new Date()
  const contentKind = input.mention.contentKind?.toUpperCase() ?? ""
  const sourceType = input.mention.sourceType?.toLowerCase() ?? ""
  if (
    !isNegativeSocialMention(input.mention.sentiment)
    || (!["POST", "COMMENT", "REPLY"].includes(contentKind) && !["post", "comment", "reply"].includes(sourceType))
  ) return null
  const existing = await prisma.socialMentionAiDraft.findFirst({
    where: {
      organizationId: input.organizationId,
      mentionId: input.mention.id,
    },
    select: { id: true },
  })
  if (existing) return null

  return createSocialMentionAiDraft({
    organizationId: input.organizationId,
    mention: input.mention,
    orgName: input.orgName,
    origin: "automatic",
    autoSendPositive: false,
    now,
    draftContext: {
      mode: "draft_only",
      source: "scenario_triage",
      scenarioId: input.scenario.scenarioId,
      scenarioName: input.scenario.scenarioName,
      action: input.scenario.action,
      requiresApproval: true,
      liveSendAllowed: false,
    },
  })
}
