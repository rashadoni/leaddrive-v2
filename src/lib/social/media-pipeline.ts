import crypto from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { resolveTranscriptionClient } from "@/lib/transcription/transcribe"
import { resolveVisionOcrClient } from "@/lib/vision/resolve"
import { evaluateSubjectRelevance, persistSubjectMatches } from "@/lib/social/subject-relevance"
import { planMediaCascade, type MediaDescriptor, type MediaStagePlan } from "@/lib/social/media-cascade"
import { getOrCreateMediaPolicy } from "@/lib/social/media-observations"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"
import { latestMonitoringResetBudgetCarryForward } from "@/lib/social/paid-provider-run-scope"

type ClaimedObservation = { id: string; organizationId: string; claimToken: string; claimVersion: number }
type MediaObservationCandidate = Pick<ClaimedObservation, "id" | "organizationId">
type PlanSnapshot = { frameUrls?: unknown; stages?: unknown }
type ProcessStatus = "completed" | "partial" | "blocked"
type ProcessingObservation = Prisma.MediaObservationGetPayload<{
  include: { discoveryLead: true; mention: { select: { id: true; matchedTerm: true } } }
}>
type SpendingRow = {
  observationId: string
  createdAt: Date
  reservedCostUsd: Prisma.Decimal
  actualCostUsd: Prisma.Decimal | null
}

export async function processMediaQueue(limit = 20) {
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
  const result = { claimed: 0, completed: 0, partial: 0, blocked: 0, failed: 0, signals: 0, promoted: 0 }
  for (let index = 0; index < boundedLimit; index += 1) {
    const candidate = await nextMediaObservationCandidate()
    if (!candidate) break
    const fenced = await withSocialMonitoringTenantCollectionFence(
      candidate.organizationId,
      async () => {
        const claim = await claimMediaObservation(
          candidate.organizationId,
          candidate.id,
          ["QUEUED"],
        )
        if (!claim) return { claimed: false as const }
        try {
          return {
            claimed: true as const,
            processed: await processClaimedObservation(claim),
          }
        } catch (error) {
          await finishObservation(claim, "FAILED", errorMessage(error))
          return { claimed: true as const, failed: true as const }
        }
      },
    )
    if (!fenced.allowed) {
      // The candidate query is only an optimization. This authoritative fence
      // runs before the claim write, so a clean-slate reset cannot be raced.
      result.blocked += 1
      continue
    }
    if (!fenced.value.claimed) continue
    result.claimed += 1
    if ("failed" in fenced.value) {
      result.failed += 1
      continue
    }
    const processed = fenced.value.processed
    result[processed.status as ProcessStatus] += 1
    result.signals += processed.signals
    result.promoted += processed.promoted
  }
  return result
}

export async function processMediaObservation(organizationId: string, observationId: string) {
  const fenced = await withSocialMonitoringTenantCollectionFence(
    organizationId,
    async () => {
      const claim = await claimMediaObservation(
        organizationId,
        observationId,
        ["QUEUED", "PARTIAL", "FAILED", "BLOCKED"],
      )
      if (!claim) throw new Error("Media observation is already claimed or unavailable")
      return processClaimedObservation(claim)
    },
  )
  if (!fenced.allowed) {
    throw new Error("Social Monitoring collection is blocked for clean-slate reset")
  }
  return fenced.value
}

async function nextMediaObservationCandidate(): Promise<MediaObservationCandidate | null> {
  const queryRaw = prisma.$queryRaw.bind(prisma) as <T>(query: Prisma.Sql) => Promise<T>
  const rows = await queryRaw<MediaObservationCandidate[]>(Prisma.sql`
    SELECT observation.id, observation."organizationId"
    FROM "media_observations" AS observation
    JOIN "organizations" AS organization
      ON organization.id = observation."organizationId"
    WHERE observation.status = 'QUEUED'
      AND observation."purgedAt" IS NULL
      AND (
        observation."claimExpiresAt" IS NULL
        OR observation."claimExpiresAt" < NOW()
      )
      AND COALESCE(
        organization.settings->'socialMonitoringCleanSlate'->>'collectionBlocked',
        'false'
      ) <> 'true'
    ORDER BY observation.priority ASC, observation."createdAt" ASC
    LIMIT 1
  `)
  return rows[0] ?? null
}

async function claimMediaObservation(
  organizationId: string,
  observationId: string,
  statuses: string[],
): Promise<ClaimedObservation | null> {
  const token = crypto.randomUUID()
  const now = new Date()
  const claimed = await prisma.mediaObservation.updateMany({
    where: {
      organizationId,
      id: observationId,
      status: { in: statuses },
      purgedAt: null,
      OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lt: now } }],
    },
    data: {
      status: "PROCESSING",
      claimToken: token,
      claimVersion: { increment: 1 },
      claimExpiresAt: new Date(now.getTime() + 5 * 60_000),
      lastError: null,
    },
  })
  if (claimed.count !== 1) return null
  const row = await prisma.mediaObservation.findUniqueOrThrow({
    where: { organizationId_id: { organizationId, id: observationId } },
    select: { claimVersion: true },
  })
  return {
    id: observationId,
    organizationId,
    claimToken: token,
    claimVersion: row.claimVersion,
  }
}

async function processClaimedObservation(claim: ClaimedObservation) {
  const observation = await prisma.mediaObservation.findUniqueOrThrow({
    where: { organizationId_id: { organizationId: claim.organizationId, id: claim.id } },
    include: {
      discoveryLead: true,
      mention: { select: { id: true, matchedTerm: true } },
    },
  })
  assertClaim(observation, claim)
  const policy = await getOrCreateMediaPolicy(claim.organizationId)
  const planSnapshot = asRecord(observation.extractionPlan) as PlanSnapshot
  const descriptor: MediaDescriptor = {
    mediaType: observation.mediaType as MediaDescriptor["mediaType"],
    sourceUrl: observation.sourceUrl,
    canonicalMediaUrl: observation.canonicalMediaUrl,
    thumbnailUrl: observation.thumbnailUrl ?? undefined,
    audioUrl: observation.audioUrl ?? undefined,
    platformTranscript: observation.platformTranscript ?? undefined,
    language: observation.language ?? undefined,
    durationMs: observation.durationMs ?? undefined,
    frameUrls: stringArray(planSnapshot.frameUrls),
  }
  const stages = planMediaCascade(policy, descriptor, observation.relevanceScore, observation.idempotencyKey)
  const enabledStages = stages.filter(item => item.enabled)
  if (enabledStages.length === 0) {
    await finishObservation(claim, "BLOCKED", "no media processing stage is enabled")
    return { status: "blocked" as const, signals: 0, promoted: 0 }
  }
  let signals = 0
  let promoted = 0
  let failures = 0
  let budgetBlocks = 0

  for (const stage of enabledStages) {
    const reservation = await reserveRun(claim.organizationId, observation.id, stage, policy)
    if (reservation.status === "BLOCKED_BUDGET") {
      budgetBlocks += 1
      continue
    }
    if (["SUCCEEDED", "PARTIAL"].includes(reservation.status)) continue
    try {
      const result = await executeStage(observation, descriptor, stage, reservation.id, policy.signalRetentionDays)
      signals += result.signals
      promoted += result.promoted
      await prisma.mediaProcessingRun.update({
        where: { organizationId_id: { organizationId: claim.organizationId, id: reservation.id } },
        data: {
          status: "SUCCEEDED",
          actualCostUsd: stage.estimatedCostUsd,
          outputSummary: result.summary as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      })
    } catch (error) {
      failures += 1
      await prisma.mediaProcessingRun.update({
        where: { organizationId_id: { organizationId: claim.organizationId, id: reservation.id } },
        data: { status: "FAILED", actualCostUsd: 0, lastError: errorMessage(error), finishedAt: new Date() },
      })
    }
  }

  const status = failures > 0 ? "partial" : budgetBlocks > 0 && signals === 0 ? "blocked" : "completed"
  if (observation.discoveryLead && promoted === 0 && status === "completed") {
    await prisma.discoveryLead.update({
      where: {
        organizationId_id: {
          organizationId: observation.organizationId,
          id: observation.discoveryLead.id,
        },
      },
      data: {
        status: "VALIDATED",
        decisionReason: "no_subject_match_after_media_processing",
      },
    })
  }
  await finishObservation(
    claim,
    status === "completed" ? "COMPLETE" : status === "partial" ? "PARTIAL" : "BLOCKED",
    failures > 0 ? `${failures} media stage(s) failed` : budgetBlocks > 0 ? "media budget exhausted or disabled" : null,
  )
  return { status, signals, promoted }
}

async function reserveRun(
  organizationId: string,
  observationId: string,
  stage: MediaStagePlan,
  policy: Awaited<ReturnType<typeof getOrCreateMediaPolicy>>,
) {
  const idempotencyKey = `media-run:${observationId}:${stage.stage}:${stage.modelVersion}`
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`media-budget:${organizationId}`}))`)
    const existing = await tx.mediaProcessingRun.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    })
    if (existing) return existing
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const spending = await tx.mediaProcessingRun.findMany({
      where: {
        organizationId,
        createdAt: { gte: monthStart },
        status: { in: ["QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL"] },
      },
      select: { observationId: true, createdAt: true, reservedCostUsd: true, actualCostUsd: true },
    })
    const amount = stage.estimatedCostUsd
    const used = (rows: SpendingRow[]) => rows.reduce((sum: number, row: SpendingRow) => sum + Number(row.actualCostUsd ?? row.reservedCostUsd), 0)
    const resetCarry = amount > 0
      ? await latestMonitoringResetBudgetCarryForward(tx, organizationId)
      : null
    const monthlyCarry = resetCarry
      && resetCarry.utcMonthStart.getTime() === monthStart.getTime()
      && resetCarry.capturedAt.getTime() >= monthStart.getTime()
      ? resetCarry.media.monthCostUsd
      : 0
    const dailyCarry = resetCarry
      && resetCarry.utcDayStart.getTime() === dayStart.getTime()
      && resetCarry.capturedAt.getTime() >= dayStart.getTime()
      ? resetCarry.media.dayCostUsd
      : 0
    const monthlyUsed = monthlyCarry + used(spending)
    const dailyUsed = dailyCarry + used((spending as SpendingRow[]).filter((row: SpendingRow) => row.createdAt >= dayStart))
    const observationUsed = used((spending as SpendingRow[]).filter((row: SpendingRow) => row.observationId === observationId))
    const withinBudget = canReserveMediaBudget({
      amount,
      dailyUsed,
      monthlyUsed,
      observationUsed,
      dailyLimit: Number(policy.dailyBudgetUsd),
      monthlyLimit: Number(policy.monthlyBudgetUsd),
      observationLimit: Number(policy.perObservationBudgetUsd),
    })
    return tx.mediaProcessingRun.create({
      data: {
        organizationId,
        observationId,
        stage: stage.stage,
        provider: stage.provider,
        modelVersion: stage.modelVersion,
        status: withinBudget ? "QUEUED" : "BLOCKED_BUDGET",
        idempotencyKey,
        frameCount: stage.frameCount,
        estimatedCostUsd: amount,
        reservedCostUsd: withinBudget ? amount : 0,
        inputSnapshot: { reason: stage.reason },
        ...(withinBudget ? {} : { lastError: "tenant media budget would be exceeded", finishedAt: now }),
      },
    })
  }, { isolationLevel: "Serializable" })
}

export function canReserveMediaBudget(input: {
  amount: number
  dailyUsed: number
  monthlyUsed: number
  observationUsed: number
  dailyLimit: number
  monthlyLimit: number
  observationLimit: number
}) {
  if (input.amount === 0) return true
  if (input.amount < 0) return false
  return input.dailyLimit > 0 && input.dailyUsed + input.amount <= input.dailyLimit
    && input.monthlyLimit > 0 && input.monthlyUsed + input.amount <= input.monthlyLimit
    && input.observationLimit > 0 && input.observationUsed + input.amount <= input.observationLimit
}

async function executeStage(
  observation: ProcessingObservation,
  descriptor: MediaDescriptor,
  stage: MediaStagePlan,
  runId: string,
  signalRetentionDays: number,
) {
  await prisma.mediaProcessingRun.update({
    where: { organizationId_id: { organizationId: observation.organizationId, id: runId } },
    data: { status: "RUNNING", startedAt: new Date() },
  })
  if (stage.stage === "PLATFORM_TRANSCRIPT") {
    return persistDetectedText(observation, "PLATFORM_CAPTION", descriptor.platformTranscript ?? "", "platform", stage.modelVersion, 1, signalRetentionDays)
  }
  if (stage.stage === "COVER_OCR") {
    const client = resolveVisionOcrClient()
    if (!client) throw new Error("Vision OCR provider is not configured")
    const imageUrl = descriptor.thumbnailUrl ?? (descriptor.mediaType === "IMAGE" ? descriptor.sourceUrl : null)
    if (!imageUrl) throw new Error("Cover image is unavailable")
    const result = await client.detectText({ imageUrl, languageHints: descriptor.language ? [descriptor.language] : undefined })
    const confidence = result.blocks.length > 0
      ? result.blocks.reduce((sum, block) => sum + block.confidence, 0) / result.blocks.length
      : 0.8
    return persistDetectedText(observation, "COVER_OCR", result.fullText, result.provider, result.modelVersion, confidence, signalRetentionDays)
  }
  if (stage.stage === "FRAME_SAMPLE") {
    if (descriptor.frameUrls.length === 0) throw new Error("Frame extraction provider is not configured")
    return {
      signals: 0,
      promoted: 0,
      summary: { suppliedFrameCount: Math.min(descriptor.frameUrls.length, stage.frameCount) },
    }
  }
  if (stage.stage === "FRAME_OCR") {
    const client = resolveVisionOcrClient()
    if (!client) throw new Error("Vision OCR provider is not configured")
    let signals = 0
    let promoted = 0
    const summaries: unknown[] = []
    for (const [frameIndex, imageUrl] of descriptor.frameUrls.slice(0, stage.frameCount).entries()) {
      const result = await client.detectText({ imageUrl, languageHints: descriptor.language ? [descriptor.language] : undefined })
      const persisted = await persistDetectedText(observation, "FRAME_OCR", result.fullText, result.provider, result.modelVersion, 0.8, signalRetentionDays, { frameIndex })
      signals += persisted.signals
      promoted += persisted.promoted
      summaries.push(persisted.summary)
    }
    return { signals, promoted, summary: { frames: summaries } }
  }
  if (stage.stage === "ASR") {
    const client = resolveTranscriptionClient()
    if (!client) throw new Error("ASR provider is not configured")
    if (!descriptor.audioUrl) throw new Error("Audio URL is unavailable")
    const result = await client.transcribe({ audioUrl: descriptor.audioUrl, language: descriptor.language })
    return persistDetectedText(observation, "ASR", result.transcript, result.provider, "whisper-1", 0.85, signalRetentionDays)
  }
  throw new Error(`${stage.stage} provider is not configured`)
}

async function persistDetectedText(
  observation: ProcessingObservation,
  signalType: "COVER_OCR" | "FRAME_OCR" | "ASR" | "PLATFORM_CAPTION",
  text: string,
  provider: string,
  modelVersion: string,
  confidence: number,
  retentionDays: number,
  location: { frameIndex?: number; startMs?: number; endMs?: number } = {},
) {
  const normalizedText = text.trim()
  if (!normalizedText) return { signals: 0, promoted: 0, summary: { empty: true } }
  const decision = await evaluateSubjectRelevance({
    organizationId: observation.organizationId,
    platform: observation.platform ?? "manual",
    externalId: `media:${observation.id}:${signalType}`,
    sourceType: "manual",
    contentKind: "MENTION",
    sourceProvider: "media_pipeline",
    sourceMetadata: { title: normalizedText.slice(0, 500) },
    text: normalizedText,
    sentiment: null,
    matchedTerm: null,
    url: observation.discoveryLead?.submittedUrl ?? observation.sourceUrl,
  })
  const matches = decision?.matches ?? []
  const acceptedMatches = matches.filter(match => match.status === "MATCHED" && match.confidence >= 0.7)
  const signalSubjects = acceptedMatches.length > 0 ? acceptedMatches : [null]
  const purgeAt = new Date(Date.now() + (acceptedMatches.length > 0 ? retentionDays : Math.min(7, retentionDays)) * 86_400_000)
  for (const match of signalSubjects) {
    await prisma.mediaSignal.create({
      data: {
        organizationId: observation.organizationId,
        observationId: observation.id,
        subjectId: match?.subjectId ?? null,
        signalType,
        text: normalizedText,
        confidence: Math.max(0, Math.min(1, match ? Math.min(confidence, match.confidence) : confidence)),
        provider,
        modelVersion,
        language: observation.language,
        matchedTerms: match?.matchedTerms ?? [],
        metadata: { matcherReason: match?.reason ?? decision?.reason ?? "no_subject_match", ...location },
        frameIndex: location.frameIndex,
        startMs: location.startMs,
        endMs: location.endMs,
        purgeAt,
      },
    })
  }
  let promoted = 0
  if (acceptedMatches.length > 0) {
    if (observation.mentionId) {
      await persistSubjectMatches(observation.organizationId, observation.mentionId, acceptedMatches)
      await prisma.socialMention.updateMany({
        where: { organizationId: observation.organizationId, id: observation.mentionId, matchedTerm: null },
        data: { matchedTerm: acceptedMatches[0].matchedTerms[0] ?? normalizedText.slice(0, 120) },
      })
    } else if (observation.discoveryLead) {
      promoted = await promoteDiscoveryLead(observation, normalizedText, acceptedMatches)
    }
  }
  return {
    signals: signalSubjects.length,
    promoted,
    summary: {
      textLength: normalizedText.length,
      matchedSubjectIds: acceptedMatches.map(match => match.subjectId),
      matchedTerms: Array.from(new Set(acceptedMatches.flatMap(match => match.matchedTerms))),
    },
  }
}

async function promoteDiscoveryLead(
  observation: ProcessingObservation,
  text: string,
  matches: Array<{ subjectId: string; matchedTerms: string[] }>,
) {
  if (!observation.discoveryLead) return 0
  const metadata = asRecord(observation.discoveryLead.candidateMetadata)
  const originalExternalId = stringValue(metadata.originalExternalId) ?? observation.discoveryLead.id
  const { ingestMentionWithResult } = await import("@/lib/social/ingest-mention")
  const result = await ingestMentionWithResult({
    organizationId: observation.organizationId,
    platform: stringValue(metadata.platform) ?? observation.platform ?? "manual",
    externalId: `${originalExternalId}:media-signal`,
    sourceType: stringValue(metadata.sourceType) ?? "mention",
    contentKind: "MENTION",
    sourceProvider: "media_pipeline",
    sourceMetadata: {
      mediaObservationId: observation.id,
      mediaSignalPromotion: true,
      originalExternalId,
    },
    text,
    sentiment: null,
    matchedTerm: matches[0].matchedTerms[0] ?? null,
    url: observation.discoveryLead.submittedUrl,
    authorName: stringValue(metadata.authorName),
    authorHandle: stringValue(metadata.authorHandle),
    observation: {
      sourceId: observation.discoveryLead.sourceId,
      adapterKey: "MEDIA_SIGNAL_PROMOTION",
      acquisitionMode: "MANUAL_URL",
      relevanceStatus: "ACCEPTED",
      relevanceReason: "media_subject_match",
      relevanceConfidence: 0.85,
      matchedTerms: Array.from(new Set(matches.flatMap(match => match.matchedTerms))),
      policySnapshot: { source: "media_pipeline", mediaObservationId: observation.id },
    },
  })
  if (result.accepted === false) return 0
  await prisma.$transaction([
    prisma.mediaObservation.update({
      where: { organizationId_id: { organizationId: observation.organizationId, id: observation.id } },
      data: { mentionId: result.id },
    }),
    prisma.discoveryLead.update({
      where: { organizationId_id: { organizationId: observation.organizationId, id: observation.discoveryLead.id } },
      data: { status: "INGESTED", decisionReason: "media_subject_match" },
    }),
  ])
  return 1
}

async function finishObservation(claim: ClaimedObservation, status: string, lastError: string | null) {
  const result = await prisma.mediaObservation.updateMany({
    where: {
      organizationId: claim.organizationId,
      id: claim.id,
      claimToken: claim.claimToken,
      claimVersion: claim.claimVersion,
    },
    data: {
      status,
      currentStage: status === "COMPLETE" ? "COMPLETE" : "PAUSED",
      claimToken: null,
      claimExpiresAt: null,
      lastError,
    },
  })
  if (result.count !== 1) throw new Error("Media observation claim was lost")
}

function assertClaim(
  observation: { claimToken: string | null; claimVersion: number },
  claim: ClaimedObservation,
) {
  if (observation.claimToken !== claim.claimToken || observation.claimVersion !== claim.claimVersion) {
    throw new Error("Media observation claim was lost")
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000)
}
