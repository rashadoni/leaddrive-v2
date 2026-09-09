import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hmacToken } from "@/lib/secure-token"
import { finalizeDueDiscoveryAutoReviewRuns } from "@/lib/social/discovery-auto-review-apply"
import { deleteSocialMediaPreviewCache } from "@/lib/social/media-preview-cache"

export interface ObservationPurgeResult {
  autoReviewRunsFinalized: number
  autoReviewRowsFinalized: number
  autoReviewRowsSuperseded: number
  envelopesPurged: number
  fingerprintsDeleted: number
  providerRunsScrubbed: number
  providerDatasetsQueued: number
  mentionEvidencePurged: number
  mentionsPurged: number
  mentionVersionsDeleted: number
  aiDraftsDeleted: number
  mediaObservationsPurged: number
  mediaSignalsPurged: number
  discoveryLeadsPurged: number
  mediaRunsScrubbed: number
  failures: number
}

function ledgerIdentity(organizationId: string, targetType: string, targetKey: string) {
  const targetKeyHmac = hmacToken(targetKey, `social-deletion:${organizationId}`)
  return {
    targetKeyHmac,
    idempotencyKey: `${targetType}:${targetKeyHmac}`,
  }
}

async function recordCompletedDbDeletion(input: {
  organizationId: string
  targetType: string
  targetKey: string
  reason: string
  metadata?: Prisma.InputJsonValue
  now: Date
}) {
  const identity = ledgerIdentity(input.organizationId, input.targetType, input.targetKey)
  await prisma.socialDeletionLedgerEntry.upsert({
    where: {
      organizationId_idempotencyKey: {
        organizationId: input.organizationId,
        idempotencyKey: identity.idempotencyKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      idempotencyKey: identity.idempotencyKey,
      targetType: input.targetType,
      targetKeyHmac: identity.targetKeyHmac,
      storageScope: "DATABASE",
      reason: input.reason,
      status: "COMPLETED",
      attempts: 1,
      requestedAt: input.now,
      dueAt: input.now,
      lastAttemptAt: input.now,
      completedAt: input.now,
      metadata: input.metadata ?? {},
    },
    update: {
      status: "COMPLETED",
      lastAttemptAt: input.now,
      completedAt: input.now,
      lastError: null,
    },
  })
}

async function queueProviderDatasetDeletion(input: {
  organizationId: string
  providerRunId: string
  providerKey: string
  datasetId: string
  now: Date
}) {
  const identity = ledgerIdentity(input.organizationId, "PROVIDER_DATASET", `${input.providerKey}:${input.datasetId}`)
  await prisma.socialDeletionLedgerEntry.upsert({
    where: {
      organizationId_idempotencyKey: {
        organizationId: input.organizationId,
        idempotencyKey: identity.idempotencyKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      idempotencyKey: identity.idempotencyKey,
      targetType: "PROVIDER_DATASET",
      targetKeyHmac: identity.targetKeyHmac,
      storageScope: input.providerKey,
      reason: "provider_transit_retention_expired",
      status: "PENDING",
      requestedAt: input.now,
      dueAt: input.now,
      nextRetryAt: input.now,
      metadata: {
        providerRunId: input.providerRunId,
        providerKey: input.providerKey,
        datasetId: input.datasetId,
      },
    },
    // Never pull a failed deletion forward: the deletion worker owns retry
    // state/backoff after the first queue insertion.
    update: {},
  })
}

/**
 * Purges raw/transit observation material. Normalized accepted SocialMention
 * retention is deliberately handled in PR3, where subject/legal policies are
 * available; this PR2 job only removes the temporary buffer and provider data.
 */
export async function purgeSocialObservationData(options: {
  organizationId?: string
  now?: Date
  limit?: number
} = {}): Promise<ObservationPurgeResult> {
  const now = options.now ?? new Date()
  const limit = Math.max(1, Math.min(options.limit ?? 250, 1000))
  const result: ObservationPurgeResult = {
    autoReviewRunsFinalized: 0,
    autoReviewRowsFinalized: 0,
    autoReviewRowsSuperseded: 0,
    envelopesPurged: 0,
    fingerprintsDeleted: 0,
    providerRunsScrubbed: 0,
    providerDatasetsQueued: 0,
    mentionEvidencePurged: 0,
    mentionsPurged: 0,
    mentionVersionsDeleted: 0,
    aiDraftsDeleted: 0,
    mediaObservationsPurged: 0,
    mediaSignalsPurged: 0,
    discoveryLeadsPurged: 0,
    mediaRunsScrubbed: 0,
    failures: 0,
  }

  try {
    const finalized = await finalizeDueDiscoveryAutoReviewRuns({
      organizationId: options.organizationId,
      now,
      limit,
    })
    result.autoReviewRunsFinalized = finalized.runsFinalized
    result.autoReviewRowsFinalized = finalized.rowsFinalized
    result.autoReviewRowsSuperseded = finalized.rowsSuperseded
    result.failures += finalized.failures
  } catch {
    result.failures += 1
  }

  const envelopes = await prisma.ingestEnvelope.findMany({
    where: {
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      purgeAt: { lte: now },
      purgedAt: null,
      discoveryAutoReviewDecisions: {
        none: { state: "SUPPRESSED" },
      },
      AND: [
        {
          OR: [
            { reviewMutationUntil: null },
            { reviewMutationUntil: { lte: now } },
          ],
        },
      ],
    },
    orderBy: { purgeAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true, relevanceStatus: true },
  })
  for (const envelope of envelopes) {
    try {
      const updated = await prisma.ingestEnvelope.updateMany({
        where: {
          id: envelope.id,
          organizationId: envelope.organizationId,
          purgedAt: null,
          // Список кандидатов отобран раньше и мог устареть: повторная
          // доставка того же элемента продлевает окно хранения. Перепроверяем
          // срок здесь, иначе чистка сотрёт конверт, окно которого только что
          // установлено на сутки или на 180 дней.
          purgeAt: { lte: now },
          discoveryAutoReviewDecisions: {
            none: { state: "SUPPRESSED" },
          },
          AND: [
            {
              OR: [
                { reviewMutationUntil: null },
                { reviewMutationUntil: { lte: now } },
              ],
            },
          ],
        },
        data: {
          text: null,
          authorName: null,
          authorHandle: null,
          authorAvatar: null,
          url: null,
          canonicalUrl: null,
          parentPostUrl: null,
          rawPayload: {},
          relevanceStatus: "PURGED",
          purgedAt: now,
        },
      })
      if (updated.count === 1) {
        await recordCompletedDbDeletion({
          organizationId: envelope.organizationId,
          targetType: "INGEST_ENVELOPE_RAW",
          targetKey: envelope.id,
          reason: "observation_transit_retention_expired",
          metadata: { priorStatus: envelope.relevanceStatus },
          now,
        })
        result.envelopesPurged += 1
      }
    } catch {
      result.failures += 1
    }
  }

  const fingerprints = await prisma.rejectedObservationFingerprint.findMany({
    where: {
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      expiresAt: { lte: now },
    },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true, fingerprintHmac: true },
  })
  for (const fingerprint of fingerprints) {
    try {
      const deleted = await prisma.rejectedObservationFingerprint.deleteMany({
        where: { id: fingerprint.id, organizationId: fingerprint.organizationId, expiresAt: { lte: now } },
      })
      if (deleted.count === 1) {
        await recordCompletedDbDeletion({
          organizationId: fingerprint.organizationId,
          targetType: "REJECTED_OBSERVATION_FINGERPRINT",
          targetKey: fingerprint.fingerprintHmac,
          reason: "rejected_fingerprint_retention_expired",
          now,
        })
        result.fingerprintsDeleted += 1
      }
    } catch {
      result.failures += 1
    }
  }

  const providerRuns = await prisma.socialProviderRun.findMany({
    where: {
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      purgeAt: { lte: now },
      purgedAt: null,
    },
    orderBy: { purgeAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true, providerKey: true, datasetId: true },
  })
  for (const run of providerRuns) {
    try {
      if (run.datasetId) {
        await queueProviderDatasetDeletion({
          organizationId: run.organizationId,
          providerRunId: run.id,
          providerKey: run.providerKey,
          datasetId: run.datasetId,
          now,
        })
        result.providerDatasetsQueued += 1
      }
      await prisma.socialProviderRun.updateMany({
        where: { id: run.id, organizationId: run.organizationId, purgedAt: null },
        data: {
          inputSnapshot: {},
          purgedAt: now,
          ...(run.datasetId ? {} : { status: "PURGED" }),
        },
      })
      await recordCompletedDbDeletion({
        organizationId: run.organizationId,
        targetType: "PROVIDER_RUN_TRANSIT",
        targetKey: run.id,
        reason: "provider_transit_retention_expired",
        metadata: run.datasetId ? { externalDatasetDeletionPending: true } : {},
        now,
      })
      result.providerRunsScrubbed += 1
    } catch {
      result.failures += 1
    }
  }

  // Evidence payload is shorter-lived than the normalized mention. Identity
  // and trust metadata remain for audit/coverage, while raw snippets and URLs
  // are scrubbed after 30 days.
  const evidenceCutoff = new Date(now.getTime() - 30 * 86_400_000)
  const evidences = await prisma.mentionEvidence.findMany({
    where: {
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      capturedAt: { lte: evidenceCutoff },
      purgedAt: null,
    },
    orderBy: { capturedAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true },
  })
  for (const evidence of evidences) {
    try {
      const updated = await prisma.mentionEvidence.updateMany({
        where: { id: evidence.id, organizationId: evidence.organizationId, purgedAt: null },
        data: { permalink: null, screenshotUrl: null, rawSnippet: null, rawPayload: {}, purgedAt: now },
      })
      if (updated.count === 1) {
        await recordCompletedDbDeletion({
          organizationId: evidence.organizationId,
          targetType: "MENTION_EVIDENCE_RAW",
          targetKey: evidence.id,
          reason: "accepted_evidence_raw_retention_expired",
          now,
        })
        result.mentionEvidencePurged += 1
      }
    } catch {
      result.failures += 1
    }
  }

  const mediaSignalDelegate = (prisma as unknown as { mediaSignal?: typeof prisma.mediaSignal }).mediaSignal
  if (mediaSignalDelegate?.findMany) {
    const signals = await mediaSignalDelegate.findMany({
      where: {
        ...(options.organizationId ? { organizationId: options.organizationId } : {}),
        purgeAt: { lte: now },
        purgedAt: null,
      },
      orderBy: { purgeAt: "asc" },
      take: limit,
      select: { id: true, organizationId: true },
    })
    for (const signal of signals) {
      try {
        const updated = await mediaSignalDelegate.updateMany({
          where: { id: signal.id, organizationId: signal.organizationId, purgedAt: null },
          data: { text: null, matchedTerms: [], metadata: {}, retentionClass: "PURGED_TOMBSTONE", purgedAt: now },
        })
        if (updated.count === 1) {
          await recordCompletedDbDeletion({
            organizationId: signal.organizationId,
            targetType: "MEDIA_SIGNAL_CONTENT",
            targetKey: signal.id,
            reason: "media_signal_retention_expired",
            now,
          })
          result.mediaSignalsPurged += 1
        }
      } catch {
        result.failures += 1
      }
    }
  }

  const mediaObservationDelegate = (prisma as unknown as { mediaObservation?: typeof prisma.mediaObservation }).mediaObservation
  if (mediaObservationDelegate?.findMany) {
    const observations = await mediaObservationDelegate.findMany({
      where: {
        ...(options.organizationId ? { organizationId: options.organizationId } : {}),
        purgeAt: { lte: now },
        purgedAt: null,
      },
      orderBy: { purgeAt: "asc" },
      take: limit,
      select: { id: true, organizationId: true, contentHmac: true },
    })
    for (const observation of observations) {
      try {
        await deleteSocialMediaPreviewCache({
          organizationId: observation.organizationId,
          observationId: observation.id,
        })
        const purgeResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const runs = await tx.mediaProcessingRun.updateMany({
            where: { organizationId: observation.organizationId, observationId: observation.id },
            data: { inputSnapshot: {}, outputSummary: {} },
          })
          const updated = await tx.mediaObservation.updateMany({
            where: { id: observation.id, organizationId: observation.organizationId, purgedAt: null },
            data: {
              sourceUrl: "",
              canonicalMediaUrl: `purged:${observation.contentHmac}`,
              thumbnailUrl: null,
              audioUrl: null,
              platformTranscript: null,
              extractionPlan: {},
              policySnapshot: {},
              status: "PURGED",
              currentStage: "PURGED",
              retentionClass: "PURGED_TOMBSTONE",
              claimToken: null,
              claimExpiresAt: null,
              lastError: null,
              purgedAt: now,
            },
          })
          return { updated: updated.count, runs: runs.count }
        })
        if (purgeResult.updated === 1) {
          // Close the race with a preview request that passed authorization
          // before the DB tombstone and completed its write after the first
          // cache deletion. The loader also rechecks DB freshness around each
          // write, so one of these two sides always removes the late file.
          await deleteSocialMediaPreviewCache({
            organizationId: observation.organizationId,
            observationId: observation.id,
          })
          await recordCompletedDbDeletion({
            organizationId: observation.organizationId,
            targetType: "MEDIA_OBSERVATION_CONTENT",
            targetKey: observation.id,
            reason: "media_retention_expired",
            now,
          })
          result.mediaObservationsPurged += 1
          result.mediaRunsScrubbed += purgeResult.runs
        }
      } catch {
        result.failures += 1
      }
    }
  }

  const discoveryLeadDelegate = (prisma as unknown as { discoveryLead?: typeof prisma.discoveryLead }).discoveryLead
  if (discoveryLeadDelegate?.findMany) {
    const leads = await discoveryLeadDelegate.findMany({
      where: {
        ...(options.organizationId ? { organizationId: options.organizationId } : {}),
        purgeAt: { lte: now },
        purgedAt: null,
      },
      orderBy: { purgeAt: "asc" },
      take: limit,
      select: { id: true, organizationId: true, canonicalUrl: true },
    })
    for (const lead of leads) {
      try {
        const tombstone = hmacToken(lead.canonicalUrl, `discovery-lead:${lead.organizationId}`)
        const updated = await discoveryLeadDelegate.updateMany({
          where: { id: lead.id, organizationId: lead.organizationId, purgedAt: null },
          data: {
            submittedUrl: "",
            canonicalUrl: `purged:${tombstone}`,
            thumbnailUrl: null,
            title: null,
            notes: null,
            candidateMetadata: {},
            policySnapshot: {},
            status: "PURGED",
            purgedAt: now,
          },
        })
        if (updated.count === 1) {
          await recordCompletedDbDeletion({
            organizationId: lead.organizationId,
            targetType: "DISCOVERY_LEAD_CONTENT",
            targetKey: lead.id,
            reason: "discovery_lead_retention_expired",
            now,
          })
          result.discoveryLeadsPurged += 1
        }
      } catch {
        result.failures += 1
      }
    }
  }

  // Operational mentions become content-free tombstones after 180 days. An
  // active legal candidate or open case defers this transition so a reviewer
  // never opens a queue item whose source content was already erased. A
  // platform deletion signal still wins; the immutable legal evidence snapshot
  // is retained separately from the operational mention.
  const mentions = await prisma.socialMention.findMany({
    where: {
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      purgeAt: { lte: now },
      purgedAt: null,
    },
    orderBy: { purgeAt: "asc" },
    take: limit,
    select: {
      id: true,
      organizationId: true,
      platform: true,
      externalId: true,
      deletedAtSource: true,
      legalCandidates: {
        where: { status: { in: ["NEW", "AI_REVIEWED", "HUMAN_REVIEW", "PROMOTED"] } },
        select: { id: true },
        take: 1,
      },
      legalCases: { where: { status: { in: ["open", "included"] } }, select: { id: true }, take: 1 },
    },
  })
  for (const mention of mentions) {
    if (((mention.legalCandidates?.length ?? 0) > 0 || mention.legalCases.length > 0) && !mention.deletedAtSource) continue
    try {
      const tombstoneId = `purged:${hmacToken(`${mention.platform}:${mention.externalId}`, `social-mention:${mention.organizationId}`).slice(0, 32)}`
      const purgeResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const versions = await tx.socialMentionVersion.deleteMany({ where: { organizationId: mention.organizationId, mentionId: mention.id } })
        const drafts = await tx.socialMentionAiDraft.deleteMany({ where: { organizationId: mention.organizationId, mentionId: mention.id } })
        await tx.mentionEvidence.updateMany({
          where: { organizationId: mention.organizationId, mentionId: mention.id },
          data: { permalink: null, screenshotUrl: null, rawSnippet: null, rawPayload: {}, purgedAt: now },
        })
        const updated = await tx.socialMention.updateMany({
          where: { id: mention.id, organizationId: mention.organizationId, purgedAt: null },
          data: {
            accountId: null,
            externalId: tombstoneId,
            postExternalId: null,
            parentExternalId: null,
            threadExternalId: null,
            replyToExternalId: null,
            canonicalUrl: null,
            parentPostUrl: null,
            authorName: null,
            authorHandle: null,
            authorAvatar: null,
            text: "",
            sentiment: null,
            matchedTerm: null,
            url: null,
            sourceMetadata: {},
            policySnapshot: {},
            status: "ignored",
            retentionClass: "PURGED_TOMBSTONE",
            purgedAt: now,
          },
        })
        return { updated: updated.count, versions: versions.count, drafts: drafts.count }
      })
      if (purgeResult.updated === 1) {
        await recordCompletedDbDeletion({
          organizationId: mention.organizationId,
          targetType: "SOCIAL_MENTION_OPERATIONAL_CONTENT",
          targetKey: mention.id,
          reason: mention.deletedAtSource ? "platform_deletion_signal" : "operational_retention_expired",
          now,
        })
        result.mentionsPurged += 1
        result.mentionVersionsDeleted += purgeResult.versions
        result.aiDraftsDeleted += purgeResult.drafts
      }
    } catch {
      result.failures += 1
    }
  }

  return result
}
