import { randomUUID } from "node:crypto"
import type { IngestEnvelope, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  ingestMentionWithResult,
  type IngestAutoReviewDecisionContext,
  type IngestAutomaticReviewTriageProvenance,
  type IngestInput,
  type IngestOperatorReviewDecisionContext,
  type ParentMatchContext,
} from "@/lib/social/ingest-mention"
import {
  AUTOMATIC_REVIEW_AI_VERSION,
  AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
  AUTOMATIC_REVIEW_RULES_VERSION,
  AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
  AUTOMATIC_REVIEW_TRIAGE_VERSION,
  AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY,
  AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
  AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
  recoverableAutomaticReviewOriginalReason,
  recoverableAutomaticReviewV3DiscoveryOriginalReason,
} from "@/lib/social/automatic-review-triage"
import { runWithTenant } from "@/lib/rls-context"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"
import { parentMatchContextsForComments } from "@/lib/social/parent-match-context"
import { detectSocialReplyLanguage } from "@/lib/social/ai-reply-policy"
import { registerTikTokPublicationRevisit } from "@/lib/social/tiktok-publication-revisit-repo"

const REVIEW_MUTATION_LEASE_MS = 15 * 60_000

export type AutoReviewReplayContext = IngestAutoReviewDecisionContext & {
  expectedContentHmac: string
  expectedUpdatedAt: Date
  expectedPurgeAt: Date
}

function activeSuppressionGuards(
  autoReviewDecision: AutoReviewReplayContext | undefined,
): Prisma.IngestEnvelopeWhereInput[] {
  if (!autoReviewDecision) {
    return [{
      discoveryAutoReviewDecisions: {
        none: { state: "SUPPRESSED" },
      },
    }]
  }
  return [
    {
      discoveryAutoReviewDecisions: {
        some: {
          id: autoReviewDecision.decisionId,
          runId: autoReviewDecision.runId,
          state: "SUPPRESSED",
          action: "RELEASE_TO_NORMAL_PIPELINE",
          run: {
            subjectId: autoReviewDecision.subjectId,
            state: "APPLIED",
          },
        },
      },
    },
    {
      discoveryAutoReviewDecisions: {
        none: {
          state: "SUPPRESSED",
          id: { not: autoReviewDecision.decisionId },
        },
      },
    },
  ]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function stringValues(value: unknown): string[] {
  const scalar = stringValue(value)
  if (scalar) return [scalar]
  if (!Array.isArray(value)) return []
  return value.map(stringValue).filter((item): item is string => Boolean(item))
}

function queuedOperatorReviewDecision(
  envelope: Pick<IngestEnvelope, "id" | "policySnapshot">,
): IngestOperatorReviewDecisionContext | null {
  const queued = record(record(envelope.policySnapshot).queuedOperatorReview)
  const envelopeId = stringValue(queued.envelopeId)
  const subjectId = stringValue(queued.subjectId)
  if (envelopeId !== envelope.id || !subjectId) return null
  const actorId = stringValue(queued.actorId)
  return {
    envelopeId,
    subjectId,
    ...(actorId ? { actorId } : {}),
  }
}

function replayAuthorProfileUrl(platform: string, rawPayload: unknown): string | null {
  const payload = record(rawPayload)
  const authorMeta = record(payload.authorMeta)
  const author = record(payload.author)
  const explicitUrl = stringValue(authorMeta.profileUrl)
    ?? stringValue(payload.authorProfileUrl)
    ?? stringValue(payload.authorUrl)
    ?? stringValue(payload.profileUrl)
    ?? stringValue(author.profileUrl)
    ?? stringValue(author.url)
  if (explicitUrl) return explicitUrl
  if (platform.toLowerCase() !== "facebook") return null
  const profileId = stringValue(payload.profileId)
    ?? stringValue(authorMeta.id)
    ?? stringValue(author.id)
  return profileId && /^\d{1,30}$/.test(profileId)
    ? `https://www.facebook.com/profile.php?id=${profileId}`
    : null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function sourceProvider(acquisitionMode: string): string {
  if (acquisitionMode === "OFFICIAL_API" || acquisitionMode === "CONNECTED_ACCOUNT") return "native"
  if (acquisitionMode === "LICENSED_PROVIDER") return "provider_api"
  if (acquisitionMode === "APIFY_FALLBACK") return "search_index"
  if (acquisitionMode === "NEWS_INDEX") return "search_index"
  return "manual"
}

function sourceType(contentKind: string): string {
  if (contentKind === "COMMENT") return "comment"
  if (contentKind === "REPLY") return "reply"
  if (contentKind === "POST") return "post"
  if (contentKind === "DM") return "dm"
  if (contentKind === "MENTION") return "mention"
  return "unknown"
}

const replayEnvelopeInclude = {
  source: {
    select: {
      settings: true,
      subjectSources: {
        select: {
          subjectId: true,
          scenarioId: true,
        },
      },
    },
  },
  routePlan: { select: { scenarioId: true } },
  providerRun: {
    select: {
      inputSnapshot: true,
      routePlan: { select: { scenarioId: true } },
    },
  },
} satisfies Prisma.IngestEnvelopeInclude

type ReplayEnvelope = Prisma.IngestEnvelopeGetPayload<{
  include: typeof replayEnvelopeInclude
}>

type V3DiscoveryRecoveryContext = {
  capability: typeof AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY
  originalReason: string
}

function effectiveReplayPolicySnapshot(envelope: ReplayEnvelope): Record<string, unknown> {
  const policy = record(envelope.policySnapshot)
  const providerInput = record(envelope.providerRun?.inputSnapshot)
  return {
    ...policy,
    // Provider dispatch owns the immutable scan window for older APIFY rows.
    // Preserve it when replay terminalizes a row so later audit/recovery does
    // not lose the evidence merely because the original envelope snapshot
    // predates propagation of this field.
    ...(!policy.leadDriveProviderWindow && providerInput.leadDriveProviderWindow
      ? { leadDriveProviderWindow: providerInput.leadDriveProviderWindow }
      : {}),
  }
}

function subjectIdsFromDecision(value: unknown): string[] {
  const matches = record(value).matches
  if (!Array.isArray(matches)) return []
  return uniqueStrings(matches.map(match => stringValue(record(match).subjectId)))
}

async function resolveOperatorReviewSubjectId(
  envelope: ReplayEnvelope,
  requestedSubjectId?: string,
  contextualSubjectIds: string[] = [],
): Promise<string> {
  const providerInput = record(envelope.providerRun?.inputSnapshot)
  const subjectDecision = record(envelope.subjectDecision)
  const policySnapshot = record(envelope.policySnapshot)
  const sourceSettings = record(envelope.source?.settings)
  const scenarioLinks = Array.isArray(sourceSettings.scenarioLinks)
    ? sourceSettings.scenarioLinks.map(record)
    : []
  const scenarioIds = uniqueStrings([
    ...stringValues(subjectDecision.scenarioIds),
    stringValue(subjectDecision.scenarioId),
    ...stringValues(policySnapshot.scenarioIds),
    stringValue(policySnapshot.scenarioId),
    stringValue(providerInput.leadDriveTargetScenarioId),
    envelope.routePlan?.scenarioId,
    envelope.providerRun?.routePlan?.scenarioId,
    stringValue(sourceSettings.scenarioId),
  ])
  const providerTargetSubjectIds = uniqueStrings([
    stringValue(providerInput.leadDriveTargetSubjectId),
    stringValue(policySnapshot.targetSubjectId),
  ])
  const verifiedContextSubjectIds = uniqueStrings(contextualSubjectIds)
  const decisionSubjectIds = subjectIdsFromDecision(envelope.subjectDecision)
  const scenarioSubjectIds = uniqueStrings([
    ...(envelope.source?.subjectSources ?? []).flatMap(link => (
      link.scenarioId && scenarioIds.includes(link.scenarioId) ? [link.subjectId] : []
    )),
    ...scenarioLinks.flatMap(link => (
      scenarioIds.includes(stringValue(link.scenarioId) ?? "")
        ? [stringValue(link.subjectId)]
        : []
    )),
  ])
  const sourceSubjectIds = uniqueStrings([
    ...(envelope.source?.subjectSources ?? []).map(link => link.subjectId),
    ...scenarioLinks.map(link => stringValue(link.subjectId)),
  ])
  const candidateIds = uniqueStrings([
    ...verifiedContextSubjectIds,
    ...providerTargetSubjectIds,
    ...decisionSubjectIds,
    ...scenarioSubjectIds,
    ...sourceSubjectIds,
  ])
  if (candidateIds.length === 0 && scenarioIds.length === 0) {
    throw new Error("Review envelope has no linked monitoring subject")
  }
  const activeSubjects = await prisma.monitoringSubject.findMany({
    where: {
      organizationId: envelope.organizationId,
      status: "active",
      OR: [
        ...(candidateIds.length > 0 ? [{ id: { in: candidateIds } }] : []),
        ...(scenarioIds.length > 0 ? [{ legacyScenarioId: { in: scenarioIds } }] : []),
      ],
    },
    select: { id: true, legacyScenarioId: true },
  })
  const activeIds = new Set(activeSubjects.map(subject => subject.id))
  const legacyScenarioSubjectIds = scenarioIds.length > 0
    ? activeSubjects.flatMap(subject => (
        subject.legacyScenarioId && scenarioIds.includes(subject.legacyScenarioId)
          ? [subject.id]
          : []
      ))
    : []
  const tiers = [
    verifiedContextSubjectIds,
    providerTargetSubjectIds,
    decisionSubjectIds,
    uniqueStrings([...scenarioSubjectIds, ...legacyScenarioSubjectIds]),
    sourceSubjectIds,
  ]
  const authoritativeTier = tiers.find(tier => tier.length > 0) ?? []
  const activeTier = authoritativeTier.filter(subjectId => activeIds.has(subjectId))

  if (requestedSubjectId) {
    if (!activeTier.includes(requestedSubjectId)) {
      throw new Error("Review subject is not an active subject linked to this envelope")
    }
    return requestedSubjectId
  }
  if (activeTier.length === 0) {
    throw new Error("Review envelope has no active linked monitoring subject")
  }
  if (activeTier.length > 1) {
    throw new Error("Review envelope is linked to multiple monitoring subjects")
  }
  return activeTier[0]
}

async function replayParentMatchContext(envelope: ReplayEnvelope): Promise<ParentMatchContext | null> {
  if (!["COMMENT", "REPLY"].includes(envelope.contentKind)) return null
  const parentPostUrls = envelope.parentPostUrl ? [envelope.parentPostUrl] : []
  const parentExternalIds = envelope.postExternalId ? [envelope.postExternalId] : []
  if (parentPostUrls.length === 0 && parentExternalIds.length === 0) return null
  const contexts = await parentMatchContextsForComments(
    envelope.organizationId,
    envelope.platform,
    parentPostUrls,
    parentExternalIds,
  )
  return (envelope.postExternalId ? contexts.get(envelope.postExternalId) : null)
    ?? (envelope.parentPostUrl ? contexts.get(envelope.parentPostUrl) : null)
    ?? null
}

function isTikTokPublicationEnvelope(envelope: Pick<IngestEnvelope, "platform" | "contentKind">): boolean {
  return envelope.platform.toLowerCase() === "tiktok"
    && ["POST", "VIDEO"].includes(envelope.contentKind)
}

async function registerAcceptedTikTokPublication(
  envelope: Pick<IngestEnvelope, "id" | "organizationId" | "platform" | "contentKind">,
): Promise<void> {
  if (!isTikTokPublicationEnvelope(envelope)) return
  const registered = await registerTikTokPublicationRevisit({
    organizationId: envelope.organizationId,
    envelopeId: envelope.id,
  })
  if (!registered) {
    // The envelope acceptance is already durable at this point. Surface the
    // incomplete follow-up so a retry reaches the ALREADY_ACCEPTED branch and
    // retries the idempotent revisit upsert instead of silently losing comments.
    throw new Error("Accepted TikTok publication could not be registered for comment collection")
  }
}

async function finalizeAcceptedEnvelope(
  envelope: ReplayEnvelope,
  mentionId: string,
  resolution: "REPLAY" | "OPERATOR_ACCEPT" | "AUTO_REVIEW_RELEASE" | "AUTOMATIC_TRIAGE",
  reviewMutationKey: string | null,
  autoReviewDecision?: AutoReviewReplayContext,
  operatorReviewDecision?: IngestOperatorReviewDecisionContext,
  automaticTriage?: IngestAutomaticReviewTriageProvenance,
) {
  const resolvedAt = new Date()
  const originalRelevance = {
    status: envelope.relevanceStatus,
    reason: envelope.relevanceReason,
    confidence: envelope.relevanceConfidence,
  }
  const policySnapshot = {
    ...effectiveReplayPolicySnapshot(envelope),
    ...(automaticTriage ? { automaticReviewTriage: automaticTriage } : {}),
    replayResolution: {
      version: "stored-envelope-replay-v1",
      action: resolution === "AUTO_REVIEW_RELEASE"
        ? "auto_review_release"
        : resolution === "OPERATOR_ACCEPT"
          ? "operator_review_accept"
          : resolution === "AUTOMATIC_TRIAGE"
            ? "automatic_review_negative_or_neutral"
            : "replay",
      originalRelevance,
      resolvedAt: resolvedAt.toISOString(),
      providerFetchPerformed: false,
      ...(automaticTriage ? {
        automaticReviewTriage: {
          version: automaticTriage.version,
          decisionReason: automaticTriage.decisionReason,
          classification: automaticTriage.classification,
          sentiment: automaticTriage.sentiment,
          classifierSource: automaticTriage.classifierSource,
          classifierVersion: automaticTriage.classifierVersion,
        },
      } : {}),
      ...(autoReviewDecision ? {
        autoReviewRunId: autoReviewDecision.runId,
        autoReviewDecisionId: autoReviewDecision.decisionId,
      } : {}),
      ...(operatorReviewDecision ? {
        operatorReviewSubjectId: operatorReviewDecision.subjectId,
        ...(operatorReviewDecision.actorId
          ? { operatorReviewActorId: operatorReviewDecision.actorId }
          : {}),
      } : {}),
    },
  } as Prisma.InputJsonValue

  // CAS the link and decision together. ingestMentionWithResult persists the
  // mention first; this single write is the authoritative envelope end-state.
  // The original status in the predicate prevents a concurrent purge/reject
  // from being silently overwritten.
  const transition = await prisma.ingestEnvelope.updateMany({
    where: {
      organizationId: envelope.organizationId,
      id: envelope.id,
      relevanceStatus: envelope.relevanceStatus,
      purgedAt: null,
      OR: [
        { acceptedMentionId: null },
        { acceptedMentionId: mentionId },
      ],
      AND: activeSuppressionGuards(autoReviewDecision),
      ...(reviewMutationKey
        ? {
            reviewMutationKey,
            reviewMutationUntil: { gt: resolvedAt },
          }
        : { purgeAt: { gt: resolvedAt } }),
    },
    data: {
      acceptedMentionId: mentionId,
      acceptedAt: resolvedAt,
      relevanceStatus: "ACCEPTED",
      relevanceReason: resolution === "AUTO_REVIEW_RELEASE"
        ? "auto_review_release"
        : resolution === "OPERATOR_ACCEPT"
          ? "operator_review_accept"
          : resolution === "AUTOMATIC_TRIAGE"
            ? automaticTriage?.decisionReason ?? "automatic_review_triage_accepted"
        : envelope.relevanceStatus === "ACCEPTED"
          ? envelope.relevanceReason
          : "ingest_envelope_replay",
      decidedAt: resolvedAt,
      policySnapshot,
      ...(reviewMutationKey
        ? { reviewMutationKey: null, reviewMutationUntil: null }
        : {}),
    },
  })
  if (transition.count > 0) {
    if (resolution === "AUTOMATIC_TRIAGE") {
      await prisma.auditLog.create({
        data: {
          organizationId: envelope.organizationId,
          action: "social_review_automatic_accept",
          entityType: "ingest_envelope",
          entityId: envelope.id,
          entityName: automaticTriage?.decisionReason ?? "automatic_review_triage_accepted",
          newValue: {
            mentionId,
            classification: automaticTriage?.classification ?? "unknown",
            sentiment: automaticTriage?.sentiment ?? "unknown",
            classifierSource: automaticTriage?.classifierSource ?? null,
            classifierVersion: automaticTriage?.classifierVersion ?? null,
            providerFetchPerformed: false,
          },
        },
      }).catch(error => console.error("[social-automatic-review] accept audit failed", error))
    }
    return
  }

  // A concurrent identical accept is idempotent. Any other state change must
  // win instead of being overwritten by this replay.
  const current = await prisma.ingestEnvelope.findFirst({
    where: { organizationId: envelope.organizationId, id: envelope.id },
    select: {
      acceptedMentionId: true,
      relevanceStatus: true,
      purgedAt: true,
    },
  })
  if (current?.acceptedMentionId === mentionId && current.relevanceStatus === "ACCEPTED") return
  if (current?.purgedAt || current?.relevanceStatus === "PURGED") {
    throw new Error("Ingest envelope payload has been purged")
  }
  throw new Error("Ingest envelope changed during replay")
}

async function finalizeAutomaticallyRejectedEnvelope(
  envelope: ReplayEnvelope,
  reviewMutationKey: string,
  reason: string,
  automaticTriage?: IngestAutomaticReviewTriageProvenance,
  v3DiscoveryRecovery?: V3DiscoveryRecoveryContext,
): Promise<boolean> {
  const now = new Date()
  const priorAutomaticTriage = record(record(envelope.policySnapshot).automaticReviewTriage)
  const priorClassifierSource = stringValue(priorAutomaticTriage.classifierSource)
  const priorClassifierVersion = stringValue(priorAutomaticTriage.classifierVersion)
  const priorClassifierEvidence = stringValue(priorAutomaticTriage.classifierEvidence)
  const priorAttemptedAt = stringValue(priorAutomaticTriage.attemptedAt)
  const rejected = await prisma.ingestEnvelope.updateMany({
    where: {
      organizationId: envelope.organizationId,
      id: envelope.id,
      relevanceStatus: "REVIEW",
      acceptedMentionId: null,
      purgedAt: null,
      purgeAt: { gt: now },
      reviewMutationKey,
      reviewMutationUntil: { gt: now },
      discoveryAutoReviewDecisions: {
        none: { state: "SUPPRESSED" },
      },
    },
    data: {
      relevanceStatus: "REJECTED",
      relevanceReason: reason,
      relevanceConfidence: 1,
      decidedAt: now,
      policySnapshot: {
        ...effectiveReplayPolicySnapshot(envelope),
        ...(automaticTriage ? { automaticReviewTriage: automaticTriage } : {}),
        ...(v3DiscoveryRecovery ? {
          automaticReviewRecovery: {
            version: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
            capability: v3DiscoveryRecovery.capability,
            originalReason: v3DiscoveryRecovery.originalReason,
            decisionStatus: "REJECTED",
            decisionReason: reason,
            providerFetchPerformed: false,
            resolvedAt: now.toISOString(),
            ...(priorClassifierSource ? { priorClassifierSource } : {}),
            ...(priorClassifierVersion ? { priorClassifierVersion } : {}),
            ...(priorClassifierEvidence ? { priorClassifierEvidence } : {}),
            ...(priorAttemptedAt ? { priorAttemptedAt } : {}),
          },
        } : {}),
        replayResolution: {
          version: "stored-envelope-replay-v1",
          action: "automatic_review_reject",
          originalRelevance: {
            status: envelope.relevanceStatus,
            reason: envelope.relevanceReason,
            confidence: envelope.relevanceConfidence,
          },
          resolvedAt: now.toISOString(),
          providerFetchPerformed: false,
          ...(v3DiscoveryRecovery ? {
            automaticTriageRecovery: v3DiscoveryRecovery.capability,
            recoveredOriginalReason: v3DiscoveryRecovery.originalReason,
          } : {}),
        },
      } as Prisma.InputJsonValue,
      purgeAt: new Date(now.getTime() + 24 * 3_600_000),
      text: null,
      authorName: null,
      authorHandle: null,
      authorAvatar: null,
      url: null,
      canonicalUrl: null,
      parentPostUrl: null,
      rawPayload: {},
      reviewMutationKey: null,
      reviewMutationUntil: null,
    },
  })
  if (rejected.count === 1) {
    await prisma.auditLog.create({
      data: {
        organizationId: envelope.organizationId,
        action: "social_review_automatic_reject",
        entityType: "ingest_envelope",
        entityId: envelope.id,
        entityName: reason,
        newValue: {
          relevanceStatus: "REJECTED",
          relevanceReason: reason,
          classification: automaticTriage?.classification ?? "unknown",
          sentiment: automaticTriage?.sentiment ?? "unknown",
          classifierSource: automaticTriage?.classifierSource
            ?? (v3DiscoveryRecovery ? priorClassifierSource : null),
          classifierVersion: automaticTriage?.classifierVersion
            ?? (v3DiscoveryRecovery ? priorClassifierVersion : null),
          classifierEvidence: automaticTriage?.classifierEvidence
            ?? (v3DiscoveryRecovery ? priorClassifierEvidence : null),
          providerFetchPerformed: false,
          ...(v3DiscoveryRecovery ? {
            automaticTriageRecovery: v3DiscoveryRecovery.capability,
            recoveredOriginalReason: v3DiscoveryRecovery.originalReason,
          } : {}),
        },
      },
    }).catch(error => console.error("[social-automatic-review] reject audit failed", error))
  }
  return rejected.count === 1
}

async function finalizeAutomaticallyUnresolvedEnvelope(
  envelope: ReplayEnvelope,
  reviewMutationKey: string,
  classification: AutomaticTriageReplayClassification | undefined,
  triage: IngestAutomaticReviewTriageProvenance | undefined,
  operatorReviewDecision?: IngestOperatorReviewDecisionContext,
  v3DiscoveryRecovery?: V3DiscoveryRecoveryContext,
): Promise<boolean> {
  const now = new Date()
  const priorAutomaticTriage = record(record(envelope.policySnapshot).automaticReviewTriage)
  const priorClassifierSource = stringValue(priorAutomaticTriage.classifierSource)
  const priorClassifierVersion = stringValue(priorAutomaticTriage.classifierVersion)
  const priorClassifierEvidence = stringValue(priorAutomaticTriage.classifierEvidence)
  const priorAttemptedAt = stringValue(priorAutomaticTriage.attemptedAt)
  const aiUnavailable = classification?.sentiment === null
  const commentSentimentQueued = classification === undefined
    && triage?.decisionStatus === "REVIEW"
    && triage.decisionReason === AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON
  const reason = commentSentimentQueued
    ? AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON
    : aiUnavailable
      ? "automatic_review_sentiment_unresolved"
      : "automatic_review_technical_unresolved"
  const automaticReviewTriage = {
    version: v3DiscoveryRecovery
      ? AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION
      : AUTOMATIC_REVIEW_TRIAGE_VERSION,
    resolved: false,
    originalReason: v3DiscoveryRecovery?.originalReason
      ?? envelope.relevanceReason
      ?? "unknown",
    decisionStatus: "REVIEW",
    decisionReason: reason,
    classification: "unknown",
    sentiment: "unknown",
    classifierSource: classification?.source
      ?? triage?.classifierSource
      ?? (v3DiscoveryRecovery ? priorClassifierSource : null)
      ?? "RULES",
    classifierVersion: classification?.version
      ?? triage?.classifierVersion
      ?? (v3DiscoveryRecovery ? priorClassifierVersion : null)
      ?? AUTOMATIC_REVIEW_RULES_VERSION,
    classifierEvidence: aiUnavailable
      ? `ai_${(classification?.errorClass ?? "UNKNOWN").toLocaleLowerCase()}`
      : triage?.classifierEvidence
        ?? (v3DiscoveryRecovery
          ? "technical_evidence_unresolved_after_v3_discovery_recovery"
          : "technical_evidence_unresolved"),
    providerFetchPerformed: false,
    attemptedAt: classification?.attemptedAt.toISOString()
      ?? (v3DiscoveryRecovery ? priorAttemptedAt : null)
      ?? now.toISOString(),
  }
  const transition = await prisma.ingestEnvelope.updateMany({
    where: {
      organizationId: envelope.organizationId,
      id: envelope.id,
      relevanceStatus: "REVIEW",
      acceptedMentionId: null,
      purgedAt: null,
      purgeAt: { gt: now },
      reviewMutationKey,
      reviewMutationUntil: { gt: now },
      discoveryAutoReviewDecisions: { none: { state: "SUPPRESSED" } },
    },
    data: {
      relevanceReason: reason,
      relevanceConfidence: 0,
      decidedAt: now,
      policySnapshot: {
        ...effectiveReplayPolicySnapshot(envelope),
        automaticReviewTriage,
        ...(v3DiscoveryRecovery ? {
          automaticReviewRecovery: {
            version: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
            capability: v3DiscoveryRecovery.capability,
            originalReason: v3DiscoveryRecovery.originalReason,
            decisionStatus: "REVIEW",
            decisionReason: reason,
            providerFetchPerformed: false,
            resolvedAt: now.toISOString(),
            ...(priorClassifierSource ? { priorClassifierSource } : {}),
            ...(priorClassifierVersion ? { priorClassifierVersion } : {}),
            ...(priorClassifierEvidence ? { priorClassifierEvidence } : {}),
            ...(priorAttemptedAt ? { priorAttemptedAt } : {}),
          },
        } : {}),
        ...(operatorReviewDecision ? {
          queuedOperatorReview: {
            version: "queued-operator-comment-review-v1",
            envelopeId: operatorReviewDecision.envelopeId,
            subjectId: operatorReviewDecision.subjectId,
            ...(operatorReviewDecision.actorId
              ? { actorId: operatorReviewDecision.actorId }
              : {}),
            queuedAt: now.toISOString(),
          },
        } : {}),
        replayResolution: {
          version: "stored-envelope-replay-v1",
          action: "automatic_review_unresolved",
          originalRelevance: {
            status: envelope.relevanceStatus,
            reason: envelope.relevanceReason,
            confidence: envelope.relevanceConfidence,
          },
          resolvedAt: now.toISOString(),
          providerFetchPerformed: false,
          ...(v3DiscoveryRecovery ? {
            automaticTriageRecovery: v3DiscoveryRecovery.capability,
            recoveredOriginalReason: v3DiscoveryRecovery.originalReason,
          } : {}),
        },
      } as Prisma.InputJsonValue,
      reviewMutationKey: null,
      reviewMutationUntil: null,
    },
  })
  if (transition.count === 1) {
    await prisma.auditLog.create({
      data: {
        organizationId: envelope.organizationId,
        action: "social_review_automatic_unresolved",
        entityType: "ingest_envelope",
        entityId: envelope.id,
        entityName: reason,
        newValue: {
          relevanceStatus: "REVIEW",
          relevanceReason: reason,
          classifierSource: automaticReviewTriage.classifierSource,
          classifierVersion: automaticReviewTriage.classifierVersion,
          classifierEvidence: automaticReviewTriage.classifierEvidence,
          providerFetchPerformed: false,
          ...(v3DiscoveryRecovery ? {
            automaticTriageRecovery: v3DiscoveryRecovery.capability,
            recoveredOriginalReason: v3DiscoveryRecovery.originalReason,
          } : {}),
        },
      },
    }).catch(error => console.error("[social-automatic-review] unresolved audit failed", error))
  }
  return transition.count === 1
}

export type AutomaticTriageReplayClassification = {
  sentiment: "positive" | "neutral" | "negative" | null
  source: "AI"
  version: string
  attemptedAt: Date
  errorClass?:
    | "UNAVAILABLE"
    | "MISSING_KEY"
    | "INVALID_INPUT"
    | "TIMEOUT"
    | "RATE_LIMIT"
    | "AUTHENTICATION"
    | "UPSTREAM"
    | "INVALID_RESPONSE"
    | "UNKNOWN"
}

export type AutomaticTriageExpectedSnapshot = {
  contentHmac: string
  updatedAt: Date
  purgeAt: Date
  relevanceReason: string | null
}

export type ReplayIngestEnvelopeOptions = {
  reviewOverride?: boolean
  /** Re-evaluate a stored REVIEW row locally; never fetches provider data. */
  automaticTriage?: boolean
  /** Frozen AI result computed outside the tenant advisory transaction. */
  automaticTriageClassification?: AutomaticTriageReplayClassification
  /** Explicit capability for a narrowly provenance-gated replay recovery. */
  automaticTriageRecovery?:
    | typeof AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY
    | typeof AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY
  /** Immutable pre-AI snapshot; the lease claim fails if the row changed. */
  automaticTriageExpectedSnapshot?: AutomaticTriageExpectedSnapshot
  reviewSubjectId?: string
  reviewActorId?: string
  autoReviewDecision?: AutoReviewReplayContext
  suppressWorkflows?: boolean
  suppressMediaScheduling?: boolean
}

export async function replayIngestEnvelope(
  organizationId: string,
  envelopeId: string,
  options: ReplayIngestEnvelopeOptions = {},
) {
  return runWithTenant(organizationId, async () => {
    const fenced = await withSocialMonitoringTenantCollectionFence(
      organizationId,
      () => replayIngestEnvelopeWithinFence(organizationId, envelopeId, options),
    )
    if (!fenced.allowed) throw new Error(fenced.reason)
    return fenced.value
  })
}

async function replayIngestEnvelopeWithinFence(
  organizationId: string,
  envelopeId: string,
  options: ReplayIngestEnvelopeOptions,
) {
  const autoReviewDecision = options.autoReviewDecision
  const automaticTriageRequested = options.automaticTriage === true
  const v2AutomaticTriageRecoveryRequested =
    options.automaticTriageRecovery === AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY
  const v3DiscoveryRecoveryRequested =
    options.automaticTriageRecovery === AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY
  const automaticTriageRecoveryRequested =
    v2AutomaticTriageRecoveryRequested || v3DiscoveryRecoveryRequested
  if (
    options.automaticTriageRecovery
    && !automaticTriageRecoveryRequested
  ) {
    throw new Error("Unsupported automatic triage recovery mode")
  }
  if (
    (options.automaticTriageClassification
      || options.automaticTriageExpectedSnapshot
      || options.automaticTriageRecovery)
    && !automaticTriageRequested
  ) {
    throw new Error("Automatic triage classification requires automaticTriage")
  }
  if (options.automaticTriageClassification && !options.automaticTriageExpectedSnapshot) {
    throw new Error("Automatic triage classification requires an immutable envelope snapshot")
  }
  if (
    v2AutomaticTriageRecoveryRequested
    && (
      Boolean(autoReviewDecision)
      || options.reviewOverride === true
      || !options.automaticTriageClassification?.sentiment
      || options.automaticTriageClassification.version !== AUTOMATIC_REVIEW_AI_VERSION
      || !options.automaticTriageExpectedSnapshot
      || options.automaticTriageExpectedSnapshot.relevanceReason
        !== AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON
    )
  ) {
    throw new Error("Automatic triage recovery requires an isolated resolved v1 AI classification and technical envelope snapshot")
  }
  if (
    v3DiscoveryRecoveryRequested
    && (
      Boolean(autoReviewDecision)
      || options.reviewOverride === true
      || Boolean(options.automaticTriageClassification)
      || !options.automaticTriageExpectedSnapshot
      || options.automaticTriageExpectedSnapshot.relevanceReason
        !== AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON
    )
  ) {
    throw new Error("V3 discovery recovery requires an isolated technical envelope snapshot without a sentiment override")
  }
  const reviewOverrideRequested =
    options.reviewOverride === true || automaticTriageRequested || Boolean(autoReviewDecision)
  const claimStartedAt = new Date()
  const reviewMutationKey = reviewOverrideRequested ? randomUUID() : null
  const reviewMutationUntil = new Date(
    claimStartedAt.getTime() + REVIEW_MUTATION_LEASE_MS,
  )
  let reviewClaimed = false
  if (reviewMutationKey && autoReviewDecision) {
    // Keep updatedAt byte-for-byte stable while taking the replay lease. The
    // apply-time snapshot remains a valid compare-and-set boundary on retries.
    const claimed = await prisma.$executeRaw`
      UPDATE ingest_envelopes AS envelope
      SET
        "reviewMutationKey" = ${reviewMutationKey},
        "reviewMutationUntil" = ${reviewMutationUntil}
      WHERE envelope."organizationId" = ${organizationId}
        AND envelope.id = ${envelopeId}
        AND envelope."relevanceStatus" = 'REVIEW'
        AND envelope."purgedAt" IS NULL
        AND envelope."purgeAt" > ${reviewMutationUntil}
        AND envelope."contentHmac" = ${autoReviewDecision.expectedContentHmac}
        AND envelope."purgeAt" = ${autoReviewDecision.expectedPurgeAt}
        AND (
          (
            envelope."acceptedMentionId" IS NULL
            AND envelope."updatedAt" = ${autoReviewDecision.expectedUpdatedAt}
          )
          OR envelope."acceptedMentionId" IS NOT NULL
        )
        AND (
          envelope."reviewMutationUntil" IS NULL
          OR envelope."reviewMutationUntil" <= ${claimStartedAt}
        )
        AND EXISTS (
          SELECT 1
          FROM discovery_auto_review_decisions decision
          INNER JOIN discovery_auto_review_runs review_run
            ON review_run."organizationId" = decision."organizationId"
            AND review_run.id = decision."runId"
          WHERE decision."organizationId" = envelope."organizationId"
            AND decision."envelopeId" = envelope.id
            AND decision.id = ${autoReviewDecision.decisionId}
            AND decision."runId" = ${autoReviewDecision.runId}
            AND decision.state = 'SUPPRESSED'
            AND decision.action = 'RELEASE_TO_NORMAL_PIPELINE'
            AND review_run."subjectId" = ${autoReviewDecision.subjectId}
            AND review_run.state = 'APPLIED'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM discovery_auto_review_decisions other_decision
          WHERE other_decision."organizationId" = envelope."organizationId"
            AND other_decision."envelopeId" = envelope.id
            AND other_decision.state = 'SUPPRESSED'
            AND other_decision.id <> ${autoReviewDecision.decisionId}
        )
    `
    reviewClaimed = claimed === 1
  } else if (reviewMutationKey) {
    const claimed = await prisma.ingestEnvelope.updateMany({
      where: {
        organizationId,
        id: envelopeId,
        relevanceStatus: "REVIEW",
        acceptedMentionId: null,
        purgedAt: null,
        // The raw payload must remain available for the full review lease.
        // Retention also excludes this active lease, closing the narrow
        // "mention persisted, envelope purged before CAS" race.
        purgeAt: { gt: reviewMutationUntil },
        discoveryAutoReviewDecisions: {
          none: { state: "SUPPRESSED" },
        },
        ...(options.automaticTriageExpectedSnapshot ? {
          contentHmac: options.automaticTriageExpectedSnapshot.contentHmac,
          updatedAt: options.automaticTriageExpectedSnapshot.updatedAt,
          purgeAt: options.automaticTriageExpectedSnapshot.purgeAt,
          relevanceReason: options.automaticTriageExpectedSnapshot.relevanceReason,
        } : {}),
        OR: [
          { reviewMutationUntil: null },
          { reviewMutationUntil: { lte: claimStartedAt } },
        ],
      },
      data: {
        reviewMutationKey,
        reviewMutationUntil,
      },
    })
    reviewClaimed = claimed.count === 1
  }

  try {
    if (autoReviewDecision && !reviewClaimed) {
      // A failed raw UPDATE has two materially different meanings. Another
      // worker holding the same valid snapshot is retryable; every other miss
      // is permanent apply-time CAS/current-state divergence and must let the
      // caller durably SUPERSEDE the ledger row instead of retrying forever.
      const current = await prisma.ingestEnvelope.findFirst({
        where: {
          organizationId,
          id: envelopeId,
        },
      })
      const snapshotStillValid = Boolean(
        current
        && current.relevanceStatus === "REVIEW"
        && !current.purgedAt
        && current.purgeAt.getTime() > reviewMutationUntil.getTime()
        && current.contentHmac === autoReviewDecision.expectedContentHmac
        && current.purgeAt.getTime() === autoReviewDecision.expectedPurgeAt.getTime()
        && (
          Boolean(current.acceptedMentionId)
          || current.updatedAt.getTime() === autoReviewDecision.expectedUpdatedAt.getTime()
        ),
      )
      const competingLease = Boolean(
        snapshotStillValid
        && current?.reviewMutationUntil
        && current.reviewMutationUntil.getTime() > claimStartedAt.getTime(),
      )
      if (competingLease) {
        throw new Error("Ingest envelope review action is already in progress")
      }
      return {
        status: "SUPERSEDED" as const,
        envelopeId,
        mentionId: null,
        created: false,
      }
    }
    if (
      automaticTriageRequested
      && options.automaticTriageExpectedSnapshot
      && !reviewClaimed
    ) {
      // The immutable pre-classification snapshot is stale or another actor
      // owns the row. Manual review, redelivery and clean-slate changes win.
      return {
        status: "SUPERSEDED" as const,
        envelopeId,
        mentionId: null,
        created: false,
      }
    }

    const envelope = await prisma.ingestEnvelope.findFirst({
      where: {
        organizationId,
        id: envelopeId,
        AND: activeSuppressionGuards(autoReviewDecision),
        ...(reviewClaimed ? { reviewMutationKey } : {}),
      },
      include: replayEnvelopeInclude,
    })
    if (!envelope) throw new Error("Ingest envelope not found")
    if (envelope.purgedAt || envelope.relevanceStatus === "PURGED") {
      throw new Error("Ingest envelope payload has been purged")
    }
    if (envelope.purgeAt <= new Date()) {
      throw new Error("Ingest envelope payload has expired")
    }
    if (envelope.acceptedMentionId) {
      // acceptedMentionId is also used by the workflow-free official-author
      // archive. It is only proof of an accepted operator decision when the
      // envelope end-state itself is ACCEPTED.
      if (
        envelope.relevanceStatus === "REVIEW"
        && autoReviewDecision
        && reviewClaimed
      ) {
        await finalizeAcceptedEnvelope(
          envelope,
          envelope.acceptedMentionId,
          "AUTO_REVIEW_RELEASE",
          reviewMutationKey,
          autoReviewDecision,
        )
      } else if (
        envelope.relevanceStatus === "REVIEW"
        && automaticTriageRequested
        && reviewClaimed
      ) {
        // A REVIEW row linked by an older persistence path has contradictory
        // state. Do not bless it without re-running the semantic decision.
        throw new Error("Linked review envelope requires explicit reconciliation")
      } else if (envelope.relevanceStatus !== "ACCEPTED") {
        throw new Error("Ingest envelope linked mention is not accepted")
      }
      const priorReplayResolution = record(record(envelope.policySnapshot).replayResolution)
      const priorOperatorSubjectId = envelope.relevanceReason === "operator_review_accept"
        ? stringValue(priorReplayResolution.operatorReviewSubjectId)
        : null
      if (["operator_review_accept", "auto_review_release"].includes(envelope.relevanceReason ?? "")) {
        await registerAcceptedTikTokPublication(envelope)
      }
      return {
        status: "ALREADY_ACCEPTED" as const,
        envelopeId: envelope.id,
        mentionId: envelope.acceptedMentionId,
        created: false,
        ...(priorOperatorSubjectId ? { reviewSubjectId: priorOperatorSubjectId } : {}),
      }
    }
    if (reviewOverrideRequested && !reviewClaimed) {
      throw new Error("Ingest envelope review action is already in progress")
    }
    // Each resolution mode is explicit. AUTOMATIC_TRIAGE reuses the original
    // REVIEW evidence; it is never an operator override and cannot force an
    // ambiguous/technical row into ACCEPTED.
    const automaticTriage = automaticTriageRequested
      && reviewClaimed
      && envelope.relevanceStatus === "REVIEW"
    const operatorReviewOverride = options.reviewOverride === true
      && !autoReviewDecision
      && !automaticTriage
      && reviewClaimed
      && envelope.relevanceStatus === "REVIEW"
    const reviewResolution = Boolean(autoReviewDecision)
      || automaticTriage
      || operatorReviewOverride
    const recoveredAutomaticTriageReason = v2AutomaticTriageRecoveryRequested
      ? recoverableAutomaticReviewOriginalReason(envelope)
      : v3DiscoveryRecoveryRequested
        ? recoverableAutomaticReviewV3DiscoveryOriginalReason(envelope)
        : null
    if (automaticTriageRecoveryRequested && !recoveredAutomaticTriageReason) {
      throw new Error("Automatic triage recovery provenance no longer matches")
    }
    const v3DiscoveryRecovery: V3DiscoveryRecoveryContext | undefined =
      v3DiscoveryRecoveryRequested && recoveredAutomaticTriageReason
        ? {
            capability: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
            originalReason: recoveredAutomaticTriageReason,
          }
        : undefined
    const automaticTriageReason = recoveredAutomaticTriageReason ?? envelope.relevanceReason
    const retryablePersistenceFailure = envelope.relevanceReason === "mention_persistence_failed"
    if (envelope.relevanceStatus !== "ACCEPTED" && !retryablePersistenceFailure && !reviewResolution) {
      throw new Error("Ingest envelope is not eligible for replay")
    }
    if (!envelope.externalId || envelope.text === null) {
      throw new Error("Ingest envelope payload is incomplete")
    }

    const parentMatchContext = await replayParentMatchContext(envelope)
    const operatorReviewSubjectId = operatorReviewOverride
      ? await resolveOperatorReviewSubjectId(envelope, options.reviewSubjectId)
      : null
    const storedQueuedOperatorReview = automaticTriage
      && automaticTriageReason === AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON
      ? queuedOperatorReviewDecision(envelope)
      : null
    let automaticTriageSubjectId: string | null = null
    let automaticTriageParentMatchContext = parentMatchContext
    if (automaticTriage) {
      const parentScopedReason = [
        "comment_on_verified_brand_parent",
        "negative_parent_post_inheritance",
      ].includes(automaticTriageReason ?? "")
      if (parentScopedReason) {
        const parentSubjectIds = uniqueStrings(
          automaticTriageReason === "negative_parent_post_inheritance"
            ? parentMatchContext?.inheritAllCommentSubjectIds ?? []
            : parentMatchContext?.subjectIds ?? [],
        )
        if (parentSubjectIds.length === 1) {
          let envelopeSubjectId: string | null = null
          try {
            envelopeSubjectId = await resolveOperatorReviewSubjectId(envelope)
          } catch {
            // Some legacy verified-parent rows have no direct alias/source
            // subject. Their tenant-scoped parent match is authoritative.
          }
          if (envelopeSubjectId && envelopeSubjectId !== parentSubjectIds[0]) {
            automaticTriageParentMatchContext = null
          } else {
            try {
              automaticTriageSubjectId = await resolveOperatorReviewSubjectId(
                envelope,
                parentSubjectIds[0],
                parentSubjectIds,
              )
            } catch {
              automaticTriageParentMatchContext = null
            }
          }
        } else {
          automaticTriageParentMatchContext = null
        }
      } else {
        try {
          automaticTriageSubjectId = await resolveOperatorReviewSubjectId(
            envelope,
            storedQueuedOperatorReview?.subjectId,
          )
        } catch {
          // Fresh subject evaluation remains authoritative; unresolved rows
          // stay in REVIEW rather than being forced to an arbitrary subject.
        }
      }
    }
    if (
      automaticTriage
      && storedQueuedOperatorReview
      && !automaticTriageSubjectId
      && reviewMutationKey
    ) {
      // The operator-selected subject is authoritative. If it was archived or
      // unlinked after the click, never let fresh matching silently attach the
      // comment to another subject in a multi-brand tenant.
      const finalized = await finalizeAutomaticallyUnresolvedEnvelope(
        envelope,
        reviewMutationKey,
        options.automaticTriageClassification,
        undefined,
      )
      if (!finalized) throw new Error("Ingest envelope changed while revalidating the operator subject")
      return {
        status: "REVIEW_UNRESOLVED" as const,
        envelopeId: envelope.id,
        mentionId: null,
        created: false,
        relevanceReason: "automatic_review_technical_unresolved",
      }
    }
    const operatorReviewLanguage = operatorReviewSubjectId
      && ["COMMENT", "REPLY"].includes(envelope.contentKind)
      ? detectSocialReplyLanguage(envelope.text)
      : null
    const authorProfileUrl = replayAuthorProfileUrl(envelope.platform, envelope.rawPayload)
    const operatorReviewDecision: IngestOperatorReviewDecisionContext | undefined = operatorReviewSubjectId
      ? {
          envelopeId: envelope.id,
          subjectId: operatorReviewSubjectId,
          ...(options.reviewActorId ? { actorId: options.reviewActorId } : {}),
        }
      : automaticTriageSubjectId
        && storedQueuedOperatorReview?.subjectId === automaticTriageSubjectId
        ? storedQueuedOperatorReview
        : undefined
    const replayPolicySnapshot = effectiveReplayPolicySnapshot(envelope)

    const input: IngestInput = {
      organizationId,
      platform: envelope.platform,
      externalId: envelope.externalId,
      sourceType: sourceType(envelope.contentKind),
      contentKind: envelope.contentKind,
      postExternalId: envelope.postExternalId,
      parentExternalId: envelope.parentExternalId,
      threadExternalId: envelope.threadExternalId,
      replyToExternalId: envelope.replyToExternalId,
      depth: envelope.depth,
      canonicalUrl: envelope.canonicalUrl,
      parentPostUrl: envelope.parentPostUrl,
      editedAt: envelope.editedAt,
      deletedAtSource: envelope.deletedAtSource,
      sourceProvider: sourceProvider(envelope.acquisitionMode),
      sourceMetadata: {
        replayedFromEnvelopeId: envelope.id,
        replayedWithoutProviderFetch: true,
        ...(authorProfileUrl ? {
          authorUrl: authorProfileUrl,
          profileUrl: authorProfileUrl,
        } : {}),
        ...(operatorReviewSubjectId || automaticTriageSubjectId ? {
          targetSubjectId: operatorReviewSubjectId ?? automaticTriageSubjectId,
          ...(operatorReviewLanguage ? {
            socialTriage: { language: operatorReviewLanguage },
          } : {}),
        } : {}),
        ...(operatorReviewDecision || autoReviewDecision ? {
          reviewOverride: true,
          ...(storedQueuedOperatorReview ? { queuedOperatorReview: true } : {}),
          ...(autoReviewDecision ? {
            autoReviewRunId: autoReviewDecision.runId,
            autoReviewDecisionId: autoReviewDecision.decisionId,
          } : {}),
        } : {}),
      },
      text: envelope.text,
      // Let the shared accepted-ingest path classify sentiment. The tiny local
      // lexicon used for REVIEW filtering misses common Azerbaijani complaints;
      // forcing its neutral fallback here would prevent a manually accepted
      // negative parent from ever activating complete-thread collection.
      sentiment: options.automaticTriageClassification?.sentiment ?? null,
      ...(options.automaticTriageClassification?.sentiment ? {
        sentimentClassification: {
          source: options.automaticTriageClassification.source,
          version: options.automaticTriageClassification.version,
        },
      } : {}),
      matchedTerm: envelope.matchedTerms[0] ?? null,
      url: envelope.url,
      authorName: envelope.authorName,
      authorHandle: envelope.authorHandle,
      authorAvatar: envelope.authorAvatar,
      publishedAt: envelope.publishedAt,
      ...(automaticTriage
        ? automaticTriageParentMatchContext
          ? { parentMatchContext: automaticTriageParentMatchContext }
          : {}
        : parentMatchContext
          ? { parentMatchContext }
          : {}),
      observation: {
        sourceId: envelope.sourceId,
        collectorRunId: envelope.collectorRunId,
        routePlanId: envelope.routePlanId,
        providerRunId: envelope.providerRunId,
        adapterKey: envelope.adapterKey,
        providerKey: envelope.providerKey,
        providerItemId: envelope.providerItemId,
        idempotencyKey: envelope.idempotencyKey,
        acquisitionMode: envelope.acquisitionMode,
        rawPayload: record(envelope.rawPayload),
        policySnapshot: {
          ...replayPolicySnapshot,
          replayedFromEnvelopeId: envelope.id,
          replayedWithoutProviderFetch: true,
          ...(reviewResolution ? {
            originalRelevanceStatus: envelope.relevanceStatus,
            originalRelevanceReason: envelope.relevanceReason,
            ...(automaticTriage ? { automaticTriage: true } : {}),
            ...(automaticTriageRecoveryRequested ? {
              automaticTriageRecovery: options.automaticTriageRecovery,
            } : {}),
            ...(operatorReviewOverride || autoReviewDecision ? { reviewOverride: true } : {}),
            ...(autoReviewDecision ? {
              autoReviewRunId: autoReviewDecision.runId,
              autoReviewDecisionId: autoReviewDecision.decisionId,
            } : {}),
          } : {}),
        },
        relevanceStatus: automaticTriage ? "REVIEW" : "ACCEPTED",
        relevanceReason: automaticTriage
          ? automaticTriageReason ?? "automatic_review_unknown_reason"
          : autoReviewDecision
            ? "auto_review_release"
            : operatorReviewOverride
              ? "operator_review_accept"
              : "ingest_envelope_replay",
        relevanceConfidence: envelope.relevanceConfidence ?? 1,
        matchedTerms: envelope.matchedTerms,
      },
    }

    const result = await ingestMentionWithResult(input, {
      envelopeMutationKey: reviewMutationKey ?? undefined,
      ...(autoReviewDecision ? { autoReviewDecision } : {}),
      ...(operatorReviewDecision ? { operatorReviewDecision } : {}),
      ...(options.suppressWorkflows !== undefined
        ? { suppressWorkflows: options.suppressWorkflows }
        : {}),
      ...(options.suppressMediaScheduling !== undefined
        ? { suppressMediaScheduling: options.suppressMediaScheduling }
        : {}),
    })
    if (result.accepted !== false) {
      await finalizeAcceptedEnvelope(
        envelope,
        result.id,
        autoReviewDecision
          ? "AUTO_REVIEW_RELEASE"
          : operatorReviewOverride
            ? "OPERATOR_ACCEPT"
            : automaticTriage
              ? "AUTOMATIC_TRIAGE"
              : "REPLAY",
        reviewMutationKey,
        autoReviewDecision,
        operatorReviewDecision,
        result.automaticReviewTriage,
      )
      if (reviewResolution) {
        await registerAcceptedTikTokPublication(envelope)
      }
    } else if (automaticTriage && result.relevanceStatus === "REJECTED" && reviewMutationKey) {
      const finalized = await finalizeAutomaticallyRejectedEnvelope(
        envelope,
        reviewMutationKey,
        result.relevanceReason ?? "automatic_review_rejected",
        result.automaticReviewTriage,
        v3DiscoveryRecovery,
      )
      if (!finalized) throw new Error("Ingest envelope changed during automatic triage")
    } else if (automaticTriage && result.relevanceStatus === "REVIEW" && reviewMutationKey) {
      const finalized = await finalizeAutomaticallyUnresolvedEnvelope(
        envelope,
        reviewMutationKey,
        options.automaticTriageClassification,
        result.automaticReviewTriage,
        undefined,
        v3DiscoveryRecovery,
      )
      if (!finalized) throw new Error("Ingest envelope changed during automatic triage")
    } else if (operatorReviewOverride && result.relevanceStatus === "REJECTED" && reviewMutationKey) {
      const finalized = await finalizeAutomaticallyRejectedEnvelope(
        envelope,
        reviewMutationKey,
        result.relevanceReason ?? "automatic_review_positive_comment",
        result.automaticReviewTriage,
      )
      if (!finalized) throw new Error("Ingest envelope changed during comment policy rejection")
    } else if (
      operatorReviewOverride
      && result.relevanceStatus === "REVIEW"
      && result.relevanceReason === AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON
      && reviewMutationKey
    ) {
      const finalized = await finalizeAutomaticallyUnresolvedEnvelope(
        envelope,
        reviewMutationKey,
        undefined,
        result.automaticReviewTriage,
        operatorReviewDecision,
      )
      if (!finalized) throw new Error("Ingest envelope changed while queueing comment sentiment")
    }
    return {
      status: result.accepted === false
        ? automaticTriage && result.relevanceStatus === "REJECTED"
          ? "AUTO_TRIAGED_REJECTED" as const
          : automaticTriage && result.relevanceStatus === "REVIEW"
            ? "REVIEW_UNRESOLVED" as const
            : operatorReviewOverride && result.relevanceStatus === "REJECTED"
              ? "REJECTED_BY_COMMENT_POLICY" as const
              : operatorReviewOverride
                && result.relevanceStatus === "REVIEW"
                && result.relevanceReason === AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON
                ? "QUEUED_FOR_AUTOMATIC_TRIAGE" as const
            : "REJECTED_BY_CURRENT_RELEVANCE" as const
        : automaticTriage
          ? "AUTO_TRIAGED_ACCEPTED" as const
          : "REPLAYED" as const,
      envelopeId: envelope.id,
      mentionId: result.accepted === false ? null : result.id,
      created: result.accepted === false ? false : result.created,
      ...(result.automaticReviewTriage
        ? { automaticReviewTriage: result.automaticReviewTriage }
        : {}),
      ...(result.accepted === false && result.relevanceReason
        ? { relevanceReason: result.relevanceReason }
        : {}),
      ...(result.accepted !== false && operatorReviewSubjectId
        ? { reviewSubjectId: operatorReviewSubjectId }
        : {}),
    }
  } finally {
    if (reviewClaimed && reviewMutationKey && autoReviewDecision) {
      await prisma.$executeRaw`
        UPDATE ingest_envelopes
        SET
          "reviewMutationKey" = NULL,
          "reviewMutationUntil" = NULL
        WHERE "organizationId" = ${organizationId}
          AND id = ${envelopeId}
          AND "reviewMutationKey" = ${reviewMutationKey}
      `.catch(() => {})
    } else if (reviewClaimed && reviewMutationKey) {
      await prisma.ingestEnvelope.updateMany({
        where: {
          organizationId,
          id: envelopeId,
          reviewMutationKey,
        },
        data: {
          reviewMutationKey: null,
          reviewMutationUntil: null,
        },
      }).catch(() => {})
    }
  }
}
