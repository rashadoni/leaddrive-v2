import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hmacToken } from "@/lib/secure-token"
import {
  canonicalizeMediaUrl,
  extractMediaDescriptor,
  planMediaCascade,
  type MediaDescriptor,
} from "@/lib/social/media-cascade"
import { isValidPublicMediaUrl } from "@/lib/vision/types"
import { normalizeSubjectTerm } from "@/lib/social/monitoring-subjects"
import type { IngestInput } from "@/lib/social/ingest-mention"
import type { ProviderMediaRecord } from "@/lib/social/provider-capability-contract"
import { getMediaProviderReadiness, resolveSocialMediaAssets } from "@/lib/social/social-media-assets"
import { groupMediaDashboardObservations } from "@/lib/social/media-observation-groups"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"

const DAY_MS = 86_400_000

export type DiscoveryLeadInput = {
  subjectId?: string | null
  sourceId?: string | null
  leadType?: "MANUAL_URL" | "IMAGE_SEARCH_RESULT" | "MANUAL_UPLOAD"
  submittedUrl: string
  platformHint?: string | null
  mediaType?: "AUTO" | "IMAGE" | "VIDEO" | "AUDIO"
  title?: string | null
  thumbnailUrl?: string | null
  notes?: string | null
}

export type MediaPolicyInput = {
  enabled?: boolean
  coverOcrEnabled?: boolean
  frameOcrEnabled?: boolean
  asrEnabled?: boolean
  multimodalEnabled?: boolean
  preferPlatformTranscript?: boolean
  dailyBudgetUsd?: number
  monthlyBudgetUsd?: number
  perObservationBudgetUsd?: number
  maxFramesPerVideo?: number
  frameCandidatePercent?: number
  asrCandidatePercent?: number
  multimodalCandidatePercent?: number
  mediaRetentionDays?: number
  signalRetentionDays?: number
}

export type MediaDashboardSentiment = "negative" | "neutral" | "positive" | "unknown"

export type MediaDashboardFilters = {
  sentiment?: MediaDashboardSentiment
}

export function mediaDashboardObservationWhere(
  organizationId: string,
  filters: MediaDashboardFilters = {},
): Prisma.MediaObservationWhereInput {
  const mentionRiskScope: Prisma.MediaObservationWhereInput = {
    OR: [
      { mention: { is: null } },
      { mention: { is: riskRelevantMentionWhere() } },
    ],
  }
  const base: Prisma.MediaObservationWhereInput = {
    organizationId,
    purgedAt: null,
    AND: [mentionRiskScope],
  }
  if (!filters.sentiment) return base
  if (filters.sentiment === "unknown") {
    return {
      ...base,
      AND: [
        mentionRiskScope,
        {
          OR: [
            { mention: { is: null } },
            { mention: { is: { sentiment: null } } },
          ],
        },
      ],
    }
  }
  return {
    ...base,
    AND: [
      mentionRiskScope,
      { mention: { is: { sentiment: filters.sentiment } } },
    ],
  }
}

export async function getOrCreateMediaPolicy(organizationId: string) {
  return prisma.mediaProcessingPolicy.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  })
}

export async function updateMediaPolicy(organizationId: string, userId: string | undefined, input: MediaPolicyInput) {
  const data = {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.coverOcrEnabled !== undefined ? { coverOcrEnabled: input.coverOcrEnabled } : {}),
    ...(input.frameOcrEnabled !== undefined ? { frameOcrEnabled: input.frameOcrEnabled } : {}),
    ...(input.asrEnabled !== undefined ? { asrEnabled: input.asrEnabled } : {}),
    ...(input.multimodalEnabled !== undefined ? { multimodalEnabled: input.multimodalEnabled } : {}),
    ...(input.preferPlatformTranscript !== undefined ? { preferPlatformTranscript: input.preferPlatformTranscript } : {}),
    ...(input.dailyBudgetUsd !== undefined ? { dailyBudgetUsd: bounded(input.dailyBudgetUsd, 0, 100_000) } : {}),
    ...(input.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: bounded(input.monthlyBudgetUsd, 0, 1_000_000) } : {}),
    ...(input.perObservationBudgetUsd !== undefined ? { perObservationBudgetUsd: bounded(input.perObservationBudgetUsd, 0, 1_000) } : {}),
    ...(input.maxFramesPerVideo !== undefined ? { maxFramesPerVideo: Math.trunc(bounded(input.maxFramesPerVideo, 1, 24)) } : {}),
    ...(input.frameCandidatePercent !== undefined ? { frameCandidatePercent: bounded(input.frameCandidatePercent, 0, 100) } : {}),
    ...(input.asrCandidatePercent !== undefined ? { asrCandidatePercent: bounded(input.asrCandidatePercent, 0, 100) } : {}),
    ...(input.multimodalCandidatePercent !== undefined ? { multimodalCandidatePercent: bounded(input.multimodalCandidatePercent, 0, 100) } : {}),
    ...(input.mediaRetentionDays !== undefined ? { mediaRetentionDays: Math.trunc(bounded(input.mediaRetentionDays, 1, 180)) } : {}),
    ...(input.signalRetentionDays !== undefined ? { signalRetentionDays: Math.trunc(bounded(input.signalRetentionDays, 1, 730)) } : {}),
    updatedBy: userId,
    policyVersion: { increment: 1 },
  }
  return prisma.mediaProcessingPolicy.upsert({
    where: { organizationId },
    create: { organizationId, ...withoutIncrement(data), policyVersion: 1 },
    update: data,
  })
}

export async function submitDiscoveryLead(
  organizationId: string,
  userId: string | undefined,
  input: DiscoveryLeadInput,
) {
  const fenced = await withSocialMonitoringTenantCollectionFence(
    organizationId,
    () => submitDiscoveryLeadWithinFence(organizationId, userId, input),
  )
  if (!fenced.allowed) {
    throw new Error("Social Monitoring collection is blocked for clean-slate reset")
  }
  return fenced.value
}

async function submitDiscoveryLeadWithinFence(
  organizationId: string,
  userId: string | undefined,
  input: DiscoveryLeadInput,
) {
  const submittedUrl = input.submittedUrl.trim()
  if (!isValidPublicMediaUrl(submittedUrl)) throw new Error("Discovery URL must be a public HTTP(S) URL")
  if (input.thumbnailUrl && !isValidPublicMediaUrl(input.thumbnailUrl)) throw new Error("Thumbnail URL must be public")
  await validateLeadLinks(organizationId, input.subjectId ?? null, input.sourceId ?? null)
  const canonicalUrl = canonicalizeMediaUrl(submittedUrl)
  const resolution = await resolveSocialMediaAssets({
    submittedUrl,
    platformHint: input.platformHint,
    mediaType: input.mediaType,
  })
  const resolvedThumbnail = input.thumbnailUrl?.trim() || resolution.thumbnailUrl || undefined
  const resolvedPlatform = input.platformHint?.trim().toLowerCase() || resolution.platform
  const resolvedType = input.mediaType && input.mediaType !== "AUTO" ? input.mediaType : resolution.mediaType
  const candidateMetadata = {
    mediaUrl: resolution.mediaUrl || submittedUrl,
    mediaType: resolvedType,
    thumbnailUrl: resolvedThumbnail,
    audioUrl: resolution.audioUrl || undefined,
    frameUrls: resolution.frameUrls,
    platformTranscript: resolution.platformTranscript || undefined,
    language: resolution.language || undefined,
    durationMs: resolution.durationMs ?? undefined,
    title: input.title?.trim() || resolution.title || undefined,
    authorName: resolution.authorName || undefined,
    platform: resolvedPlatform,
    assetResolution: resolution,
  }
  const policy = await getOrCreateMediaPolicy(organizationId)
  const lead = await prisma.discoveryLead.upsert({
    where: { organizationId_canonicalUrl: { organizationId, canonicalUrl } },
    create: {
      organizationId,
      subjectId: input.subjectId ?? null,
      sourceId: input.sourceId ?? null,
      leadType: input.leadType ?? "MANUAL_URL",
      submittedUrl,
      canonicalUrl,
      platformHint: resolvedPlatform,
      mediaType: resolvedType,
      title: input.title?.trim() || resolution.title || null,
      thumbnailUrl: resolvedThumbnail ?? null,
      notes: input.notes?.trim() || null,
      status: "VALIDATED",
      policySnapshot: policySnapshot(policy),
      candidateMetadata,
      createdBy: userId,
      purgeAt: new Date(Date.now() + policy.mediaRetentionDays * DAY_MS),
    },
    update: {
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      platformHint: resolvedPlatform,
      mediaType: resolvedType,
      title: input.title?.trim() || resolution.title || undefined,
      thumbnailUrl: resolvedThumbnail,
      notes: input.notes?.trim() || undefined,
      candidateMetadata,
      purgeAt: new Date(Date.now() + policy.mediaRetentionDays * DAY_MS),
      policySnapshot: policySnapshot(policy),
      status: "VALIDATED",
      decisionReason: null,
    },
  })
  const descriptor = extractMediaDescriptor(candidateMetadata, submittedUrl)
  if (!descriptor) throw new Error("Discovery lead does not contain processable media")
  const observation = await upsertMediaObservation({
    organizationId,
    descriptor,
    discoveryLeadId: lead.id,
    subjectId: input.subjectId ?? null,
    platform: resolvedPlatform,
    relevanceScore: 0.5,
    policy,
  })
  await prisma.discoveryLead.update({
    where: { organizationId_id: { organizationId, id: lead.id } },
    data: { status: observation.status === "BLOCKED" ? "VALIDATED" : "QUEUED" },
  })
  return { lead, observation, resolution }
}

export async function scheduleMentionMedia(
  input: IngestInput,
  mentionId: string,
  subjectId?: string | null,
) {
  const descriptor = extractMediaDescriptor(input.sourceMetadata)
  if (!descriptor) return null
  const policy = await getOrCreateMediaPolicy(input.organizationId)
  return upsertMediaObservation({
    organizationId: input.organizationId,
    descriptor,
    mentionId,
    subjectId: subjectId ?? null,
    platform: input.platform,
    relevanceScore: input.observation?.relevanceConfidence ?? 0.75,
    policy,
  })
}

export function providerMediaDescriptor(record: ProviderMediaRecord): MediaDescriptor | null {
  return extractMediaDescriptor({
    mediaUrl: record.url,
    mediaType: record.mediaKind === "THUMBNAIL" ? "IMAGE" : record.mediaKind,
    thumbnailUrl: record.thumbnailUrl ?? undefined,
    durationSeconds: record.durationSeconds ?? undefined,
  })
}

export async function scheduleProviderMediaRecord(
  context: {
    organizationId: string
    mentionId: string
    subjectId?: string | null
    relevanceScore?: number
  },
  record: ProviderMediaRecord,
) {
  const descriptor = providerMediaDescriptor(record)
  if (!descriptor) return null
  const policy = await getOrCreateMediaPolicy(context.organizationId)
  return upsertMediaObservation({
    organizationId: context.organizationId,
    descriptor,
    mentionId: context.mentionId,
    subjectId: context.subjectId ?? null,
    platform: record.platform,
    relevanceScore: context.relevanceScore ?? 0.75,
    policy,
  })
}

export async function scheduleRejectedMediaCandidate(input: IngestInput, sourceId: string | null) {
  const fenced = await withSocialMonitoringTenantCollectionFence(
    input.organizationId,
    () => scheduleRejectedMediaCandidateWithinFence(input, sourceId),
  )
  if (!fenced.allowed) return null
  return fenced.value
}

async function scheduleRejectedMediaCandidateWithinFence(
  input: IngestInput,
  sourceId: string | null,
) {
  if (!sourceId) return null
  const descriptor = extractMediaDescriptor(input.sourceMetadata)
  if (!descriptor) return null
  const policy = await getOrCreateMediaPolicy(input.organizationId)
  if (!policy.enabled && !descriptor.platformTranscript) return null
  const link = await prisma.monitoringSubjectSource.findFirst({
    where: {
      organizationId: input.organizationId,
      sourceId,
      subject: { status: "active" },
    },
    include: { subject: { include: { aliases: true } } },
    orderBy: { trustWeight: "desc" },
  })
  if (!link || excludedForSubject(input, link.subject.exclusions, link.subject.aliases)) return null
  const canonicalUrl = canonicalizeMediaUrl(input.url ?? descriptor.sourceUrl)
  const candidateMetadata = {
    mediaUrl: descriptor.sourceUrl,
    mediaType: descriptor.mediaType,
    thumbnailUrl: descriptor.thumbnailUrl,
    audioUrl: descriptor.audioUrl,
    platformTranscript: descriptor.platformTranscript,
    frameUrls: descriptor.frameUrls,
    language: descriptor.language,
    durationMs: descriptor.durationMs,
    platform: input.platform,
    originalExternalId: input.externalId,
    authorName: input.authorName,
    authorHandle: input.authorHandle,
    sourceType: input.sourceType,
    sourceProvider: input.sourceProvider,
  }
  const lead = await prisma.discoveryLead.upsert({
    where: { organizationId_canonicalUrl: { organizationId: input.organizationId, canonicalUrl } },
    create: {
      organizationId: input.organizationId,
      subjectId: link.subjectId,
      sourceId,
      leadType: "MANUAL_URL",
      submittedUrl: input.url ?? descriptor.sourceUrl,
      canonicalUrl,
      platformHint: input.platform,
      mediaType: descriptor.mediaType,
      title: typeof input.sourceMetadata?.title === "string" ? input.sourceMetadata.title.slice(0, 500) : null,
      thumbnailUrl: descriptor.thumbnailUrl ?? null,
      status: "QUEUED",
      decisionReason: "text_missing_subject_match_media_pending",
      policySnapshot: policySnapshot(policy),
      candidateMetadata,
      purgeAt: new Date(Date.now() + policy.mediaRetentionDays * DAY_MS),
    },
    update: {
      subjectId: link.subjectId,
      sourceId,
      status: "QUEUED",
      decisionReason: "text_missing_subject_match_media_pending",
      policySnapshot: policySnapshot(policy),
      candidateMetadata,
      purgeAt: new Date(Date.now() + policy.mediaRetentionDays * DAY_MS),
    },
  })
  return upsertMediaObservation({
    organizationId: input.organizationId,
    descriptor,
    discoveryLeadId: lead.id,
    subjectId: link.subjectId,
    platform: input.platform,
    relevanceScore: 0.45,
    policy,
  })
}

export async function listMediaDashboard(organizationId: string, filters: MediaDashboardFilters = {}) {
  const [policy, leads, observations, runCosts] = await Promise.all([
    getOrCreateMediaPolicy(organizationId),
    prisma.discoveryLead.findMany({
      where: { organizationId, status: { not: "PURGED" } },
      include: { subject: { select: { id: true, name: true, type: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.mediaObservation.findMany({
      // Apply sentiment before the result cap. Client-only filtering hid older
      // negative observations whenever the latest 100 happened to be positive.
      where: mediaDashboardObservationWhere(organizationId, filters),
      include: {
        subject: { select: { id: true, name: true, type: true } },
        // The dashboard titles rows by the post, not the raw CDN asset url —
        // sourceUrl is often a short-lived scontent link that reads like noise.
        mention: {
          select: {
            id: true,
            url: true,
            canonicalUrl: true,
            text: true,
            authorHandle: true,
            platform: true,
            sentiment: true,
            matchedTerm: true,
            subjectMatches: {
              where: { status: "MATCHED" },
              orderBy: { confidence: "desc" },
              select: {
                status: true,
                subjectId: true,
                subject: { select: { id: true, name: true, type: true } },
              },
            },
          },
        },
        signals: { where: { purgedAt: null }, orderBy: { createdAt: "desc" }, take: 20 },
        runs: { orderBy: { createdAt: "desc" }, take: 20 },
      },
      orderBy: { createdAt: "desc" },
      // Fetch enough raw assets to return 100 distinct post-oriented cards.
      // One post can legitimately have many rows (video, cover, audio, carousel).
      take: 500,
    }),
    prisma.mediaProcessingRun.findMany({
      where: { organizationId, createdAt: { gte: startOfMonth(new Date()) } },
      select: { stage: true, status: true, reservedCostUsd: true, actualCostUsd: true },
    }),
  ])
  return {
    policy,
    leads,
    observations: groupMediaDashboardObservations(observations).slice(0, 100),
    providerReadiness: getMediaProviderReadiness(),
    costs: (runCosts as Array<{ stage: string; status: string; reservedCostUsd: Prisma.Decimal; actualCostUsd: Prisma.Decimal | null }>).reduce((acc, run) => {
      const amount = Number(run.actualCostUsd ?? run.reservedCostUsd)
      acc.totalUsd += amount
      acc.byStage[run.stage] = (acc.byStage[run.stage] ?? 0) + amount
      acc.byStatus[run.status] = (acc.byStatus[run.status] ?? 0) + 1
      return acc
    }, { totalUsd: 0, byStage: {} as Record<string, number>, byStatus: {} as Record<string, number> }),
  }
}

export async function listVisualReferences(organizationId: string) {
  return prisma.visualReference.findMany({
    where: { organizationId, status: { not: "archived" } },
    include: { subject: { select: { id: true, name: true, type: true } } },
    orderBy: [{ subject: { name: "asc" } }, { label: "asc" }],
  })
}

export async function createVisualReference(
  organizationId: string,
  userId: string | undefined,
  input: { subjectId: string; referenceType: string; label: string; imageUrl: string; notes?: string | null },
) {
  if (!isValidPublicMediaUrl(input.imageUrl)) throw new Error("Reference image URL must be public")
  await validateLeadLinks(organizationId, input.subjectId, null)
  const contentHmac = hmacToken(canonicalizeMediaUrl(input.imageUrl), `visual-reference:${organizationId}`)
  return prisma.visualReference.upsert({
    where: { organizationId_subjectId_contentHmac: { organizationId, subjectId: input.subjectId, contentHmac } },
    create: {
      organizationId,
      subjectId: input.subjectId,
      referenceType: input.referenceType,
      label: input.label.trim(),
      imageUrl: input.imageUrl.trim(),
      contentHmac,
      notes: input.notes?.trim() || null,
      createdBy: userId,
    },
    update: {
      referenceType: input.referenceType,
      label: input.label.trim(),
      imageUrl: input.imageUrl.trim(),
      notes: input.notes?.trim() || null,
      status: "active",
    },
  })
}

export async function archiveVisualReference(organizationId: string, id: string) {
  const result = await prisma.visualReference.updateMany({
    where: { organizationId, id },
    data: { status: "archived" },
  })
  if (result.count !== 1) throw new Error("Visual reference not found")
}

async function upsertMediaObservation(input: {
  organizationId: string
  descriptor: MediaDescriptor
  mentionId?: string | null
  discoveryLeadId?: string | null
  subjectId?: string | null
  platform?: string | null
  relevanceScore: number
  policy: Awaited<ReturnType<typeof getOrCreateMediaPolicy>>
}) {
  const fenced = await withSocialMonitoringTenantCollectionFence(
    input.organizationId,
    () => upsertMediaObservationWithinFence(input),
  )
  if (!fenced.allowed) {
    throw new Error("Social Monitoring collection is blocked for clean-slate reset")
  }
  return fenced.value
}

async function upsertMediaObservationWithinFence(input: {
  organizationId: string
  descriptor: MediaDescriptor
  mentionId?: string | null
  discoveryLeadId?: string | null
  subjectId?: string | null
  platform?: string | null
  relevanceScore: number
  policy: Awaited<ReturnType<typeof getOrCreateMediaPolicy>>
}) {
  const idempotencyKey = `media:${hmacToken(input.descriptor.canonicalMediaUrl, `media-observation:${input.organizationId}`)}`
  const plan = planMediaCascade(input.policy, input.descriptor, input.relevanceScore, idempotencyKey)
  const processable = plan.some(stage => stage.enabled)
  const now = new Date()
  return prisma.mediaObservation.upsert({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    create: {
      organizationId: input.organizationId,
      mentionId: input.mentionId ?? null,
      discoveryLeadId: input.discoveryLeadId ?? null,
      subjectId: input.subjectId ?? null,
      idempotencyKey,
      platform: input.platform?.toLowerCase() || null,
      mediaType: input.descriptor.mediaType,
      sourceUrl: input.descriptor.sourceUrl,
      canonicalMediaUrl: input.descriptor.canonicalMediaUrl,
      thumbnailUrl: input.descriptor.thumbnailUrl ?? null,
      audioUrl: input.descriptor.audioUrl ?? null,
      platformTranscript: input.descriptor.platformTranscript ?? null,
      language: input.descriptor.language ?? null,
      durationMs: input.descriptor.durationMs ?? null,
      status: processable ? "QUEUED" : "BLOCKED",
      currentStage: "METADATA",
      relevanceScore: bounded(input.relevanceScore, 0, 1),
      priority: Math.max(1, 100 - Math.round(bounded(input.relevanceScore, 0, 1) * 80)),
      extractionPlan: { stages: plan, frameUrls: input.descriptor.frameUrls },
      policySnapshot: policySnapshot(input.policy),
      contentHmac: hmacToken(JSON.stringify(input.descriptor), `media-content:${input.organizationId}`),
      purgeAt: new Date(now.getTime() + input.policy.mediaRetentionDays * DAY_MS),
      lastError: processable ? null : "media_processing_disabled_or_no_available_stage",
    },
    update: {
      ...(input.mentionId ? { mentionId: input.mentionId } : {}),
      ...(input.discoveryLeadId ? { discoveryLeadId: input.discoveryLeadId } : {}),
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
      platform: input.platform?.toLowerCase() || null,
      mediaType: input.descriptor.mediaType,
      sourceUrl: input.descriptor.sourceUrl,
      canonicalMediaUrl: input.descriptor.canonicalMediaUrl,
      thumbnailUrl: input.descriptor.thumbnailUrl ?? null,
      audioUrl: input.descriptor.audioUrl ?? null,
      platformTranscript: input.descriptor.platformTranscript ?? null,
      language: input.descriptor.language ?? null,
      durationMs: input.descriptor.durationMs ?? null,
      extractionPlan: { stages: plan, frameUrls: input.descriptor.frameUrls },
      policySnapshot: policySnapshot(input.policy),
      relevanceScore: { set: bounded(input.relevanceScore, 0, 1) },
      ...(processable ? { status: "QUEUED", lastError: null } : {}),
    },
  })
}

async function validateLeadLinks(organizationId: string, subjectId: string | null, sourceId: string | null) {
  const [subjectCount, sourceCount] = await Promise.all([
    subjectId ? prisma.monitoringSubject.count({ where: { organizationId, id: subjectId, status: { not: "archived" } } }) : 1,
    sourceId ? prisma.monitoringSource.count({ where: { organizationId, id: sourceId } }) : 1,
  ])
  if (subjectCount !== 1) throw new Error("Monitoring subject not found")
  if (sourceCount !== 1) throw new Error("Monitoring source not found")
}

function excludedForSubject(
  input: IngestInput,
  exclusions: string[],
  aliases: Array<{ value: string; isNegative: boolean; kind: string }>,
) {
  const corpus = normalizeSubjectTerm([
    input.text,
    input.authorName,
    input.authorHandle,
    typeof input.sourceMetadata?.title === "string" ? input.sourceMetadata.title : null,
    typeof input.sourceMetadata?.caption === "string" ? input.sourceMetadata.caption : null,
  ].filter(Boolean).join(" "))
  const blockedTerms = [
    ...exclusions,
    ...aliases.filter(alias => alias.isNegative || alias.kind === "NEGATIVE").map(alias => alias.value),
  ]
  return blockedTerms.some(term => corpus.includes(normalizeSubjectTerm(term)))
}

function policySnapshot(policy: Awaited<ReturnType<typeof getOrCreateMediaPolicy>>): Prisma.InputJsonValue {
  return {
    version: policy.policyVersion,
    enabled: policy.enabled,
    coverOcrEnabled: policy.coverOcrEnabled,
    frameOcrEnabled: policy.frameOcrEnabled,
    asrEnabled: policy.asrEnabled,
    multimodalEnabled: policy.multimodalEnabled,
    preferPlatformTranscript: policy.preferPlatformTranscript,
    dailyBudgetUsd: Number(policy.dailyBudgetUsd),
    monthlyBudgetUsd: Number(policy.monthlyBudgetUsd),
    perObservationBudgetUsd: Number(policy.perObservationBudgetUsd),
    maxFramesPerVideo: policy.maxFramesPerVideo,
    frameCandidatePercent: policy.frameCandidatePercent,
    asrCandidatePercent: policy.asrCandidatePercent,
    multimodalCandidatePercent: policy.multimodalCandidatePercent,
    mediaRetentionDays: policy.mediaRetentionDays,
    signalRetentionDays: policy.signalRetentionDays,
    faceMatching: "FORBIDDEN",
  }
}

function withoutIncrement(data: Record<string, unknown>) {
  const result = { ...data }
  delete result.policyVersion
  return result
}

function bounded(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function startOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1))
}
