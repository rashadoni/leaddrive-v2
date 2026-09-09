import type { Prisma } from "@prisma/client"
import {
  aiSentimentDetailed,
  type AiSentimentErrorClass,
} from "@/lib/sentiment"
import { prisma } from "@/lib/prisma"
import {
  AUTOMATIC_REVIEW_AI_VERSION,
  AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE,
  AUTOMATIC_REVIEW_DISCOVERY_REASONS,
  AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
  AUTOMATIC_REVIEW_TRIAGE_VERSION,
  AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY,
  AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_VERSION,
  AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
  AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
  classifyAutomaticReviewText,
  recoverableAutomaticReviewOriginalReason,
  recoverableAutomaticReviewV3DiscoveryOriginalReason,
} from "@/lib/social/automatic-review-triage"
import {
  replayIngestEnvelope,
  type AutomaticTriageReplayClassification,
} from "@/lib/social/ingest-envelope-replay"

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50
const DEFAULT_AI_TIMEOUT_MS = 8_000
const MAX_AI_ATTEMPTS = 3
const MAX_SCAN_ROWS = 1_000
const COMMENT_CONTENT_KINDS = ["COMMENT", "REPLY"] as const
const INTERNAL_REVIEW_CONTEXT_REASON = "thread_context_for_actionable_descendant"
const AUTOMATIC_REVIEW_SENTIMENT_UNRESOLVED_REASON = "automatic_review_sentiment_unresolved"
const TERMINAL_COMMENT_REVIEW_REASONS = [
  INTERNAL_REVIEW_CONTEXT_REASON,
  AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
  AUTOMATIC_REVIEW_SENTIMENT_UNRESOLVED_REASON,
] as const
// Only publication-shaped observations are eligible for discovery recovery.
// ARTICLE and technical/communication kinds intentionally remain outside this
// worker until their replay contracts are explicitly supported.
const DISCOVERY_PUBLICATION_CONTENT_KINDS = [
  "POST",
  "MENTION",
  "VIDEO",
  "IMAGE",
  "AUDIO",
] as const

export type AutomaticReviewBackfillResult = {
  selected: number
  accepted: number
  acceptedNegative: number
  acceptedNeutral: number
  rejected: number
  rejectedPositive: number
  rejectedIrrelevant: number
  rejectedOther: number
  unresolved: number
  aiAttempted: number
  aiUnavailable: number
  aiMissingKey: number
  aiTimeout: number
  aiRateLimited: number
  aiAuthenticationFailure: number
  aiUpstreamFailure: number
  aiInvalidResponse: number
  aiOtherFailure: number
  aiRetriesScheduled: number
  aiTerminalPending: number
  skipped: number
  deferred: number
  failures: number
  deadlineReached: boolean
}

function emptyResult(): AutomaticReviewBackfillResult {
  return {
    selected: 0,
    accepted: 0,
    acceptedNegative: 0,
    acceptedNeutral: 0,
    rejected: 0,
    rejectedPositive: 0,
    rejectedIrrelevant: 0,
    rejectedOther: 0,
    unresolved: 0,
    aiAttempted: 0,
    aiUnavailable: 0,
    aiMissingKey: 0,
    aiTimeout: 0,
    aiRateLimited: 0,
    aiAuthenticationFailure: 0,
    aiUpstreamFailure: 0,
    aiInvalidResponse: 0,
    aiOtherFailure: 0,
    aiRetriesScheduled: 0,
    aiTerminalPending: 0,
    skipped: 0,
    deferred: 0,
    failures: 0,
    deadlineReached: false,
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

type AutomaticReviewRetryState = {
  attempts: number
  lastErrorClass: AiSentimentErrorClass | null
  lastAttemptAt: Date | null
  nextAttemptAt: Date | null
}

const AI_ERROR_CLASSES = new Set<AiSentimentErrorClass>([
  "MISSING_KEY",
  "INVALID_INPUT",
  "TIMEOUT",
  "RATE_LIMIT",
  "AUTHENTICATION",
  "UPSTREAM",
  "INVALID_RESPONSE",
  "UNKNOWN",
])

function retryState(policySnapshot: unknown): AutomaticReviewRetryState {
  const retry = record(record(policySnapshot).automaticReviewRetry)
  const attempts = typeof retry.attempts === "number" && Number.isInteger(retry.attempts)
    ? Math.max(0, retry.attempts)
    : 0
  const errorClass = typeof retry.lastErrorClass === "string"
    && AI_ERROR_CLASSES.has(retry.lastErrorClass as AiSentimentErrorClass)
    ? retry.lastErrorClass as AiSentimentErrorClass
    : null
  const parsedDate = (value: unknown) => {
    if (typeof value !== "string") return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return {
    attempts,
    lastErrorClass: errorClass,
    lastAttemptAt: parsedDate(retry.lastAttemptAt),
    nextAttemptAt: parsedDate(retry.nextAttemptAt),
  }
}

function retryDelayMs(errorClass: AiSentimentErrorClass, attempts: number): number {
  const base = errorClass === "MISSING_KEY" || errorClass === "AUTHENTICATION"
    ? 15 * 60_000
    : errorClass === "RATE_LIMIT" || errorClass === "UPSTREAM"
      ? 5 * 60_000
      : 60_000
  return Math.min(base * (2 ** Math.max(0, attempts - 1)), 30 * 60_000)
}

function countAiFailure(result: AutomaticReviewBackfillResult, errorClass: AiSentimentErrorClass) {
  result.aiUnavailable += 1
  if (errorClass === "MISSING_KEY") result.aiMissingKey += 1
  else if (errorClass === "TIMEOUT") result.aiTimeout += 1
  else if (errorClass === "RATE_LIMIT") result.aiRateLimited += 1
  else if (errorClass === "AUTHENTICATION") result.aiAuthenticationFailure += 1
  else if (errorClass === "UPSTREAM") result.aiUpstreamFailure += 1
  else if (errorClass === "INVALID_RESPONSE") result.aiInvalidResponse += 1
  else result.aiOtherFailure += 1
}

async function persistAutomaticReviewRetry(
  candidate: {
    id: string
    organizationId: string
    contentHmac: string
    updatedAt: Date
    purgeAt: Date
    relevanceReason: string | null
    policySnapshot: unknown
  },
  attempts: number,
  errorClass: AiSentimentErrorClass,
  attemptedAt: Date,
): Promise<boolean> {
  const terminalPending = attempts >= MAX_AI_ATTEMPTS
  const nextAttemptAt = terminalPending
    ? attemptedAt
    : new Date(attemptedAt.getTime() + retryDelayMs(errorClass, attempts))
  const changed = await prisma.ingestEnvelope.updateMany({
    where: {
      id: candidate.id,
      organizationId: candidate.organizationId,
      relevanceStatus: "REVIEW",
      relevanceReason: candidate.relevanceReason,
      acceptedMentionId: null,
      purgedAt: null,
      deletedAtSource: null,
      contentHmac: candidate.contentHmac,
      updatedAt: candidate.updatedAt,
      purgeAt: candidate.purgeAt,
      discoveryAutoReviewDecisions: { none: { state: "SUPPRESSED" } },
      OR: [
        { reviewMutationUntil: null },
        { reviewMutationUntil: { lte: attemptedAt } },
      ],
    },
    data: {
      // Keep retry ordering deterministic even if a future Prisma version
      // changes how @updatedAt is applied to updateMany.
      updatedAt: attemptedAt,
      policySnapshot: {
        ...record(candidate.policySnapshot),
        automaticReviewRetry: {
          version: "automatic_review_retry_v1",
          attempts,
          maxAttempts: MAX_AI_ATTEMPTS,
          lastErrorClass: errorClass,
          lastAttemptAt: attemptedAt.toISOString(),
          nextAttemptAt: nextAttemptAt.toISOString(),
          terminalPending,
        },
      } as Prisma.InputJsonValue,
    },
  })
  return changed.count === 1
}

async function quarantineIneligibleV3DiscoveryRecovery(
  candidate: {
    id: string
    organizationId: string
    contentHmac: string
    updatedAt: Date
    purgeAt: Date
    relevanceReason: string | null
    contentKind: string
    policySnapshot: unknown
  },
  attemptedAt: Date,
): Promise<boolean> {
  const policySnapshot = record(candidate.policySnapshot)
  const automaticReviewTriage = record(policySnapshot.automaticReviewTriage)
  const changed = await prisma.ingestEnvelope.updateMany({
    where: {
      id: candidate.id,
      organizationId: candidate.organizationId,
      relevanceStatus: "REVIEW",
      relevanceReason: candidate.relevanceReason,
      contentKind: candidate.contentKind,
      acceptedMentionId: null,
      purgedAt: null,
      deletedAtSource: null,
      contentHmac: candidate.contentHmac,
      updatedAt: candidate.updatedAt,
      purgeAt: candidate.purgeAt,
      discoveryAutoReviewDecisions: { none: { state: "SUPPRESSED" } },
      OR: [
        { reviewMutationUntil: null },
        { reviewMutationUntil: { lte: attemptedAt } },
      ],
    },
    data: {
      updatedAt: attemptedAt,
      policySnapshot: {
        ...policySnapshot,
        automaticReviewTriage: {
          ...automaticReviewTriage,
          // The v3 selector requires its original version. Advancing the
          // version records that this malformed row was examined and prevents
          // it from monopolising every subsequent scheduler page.
          version: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
        },
        automaticReviewRecovery: {
          version: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION,
          capability: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
          decisionStatus: "REVIEW",
          decisionReason: "automatic_review_recovery_provenance_mismatch",
          providerFetchPerformed: false,
          attemptedAt: attemptedAt.toISOString(),
        },
      } as Prisma.InputJsonValue,
    },
  })
  return changed.count === 1
}

/**
 * Bounded automatic recovery for stored REVIEW rows.
 *
 * The semantic call is deliberately made before replay acquires the tenant
 * advisory fence. Replay then compares the immutable pre-AI content snapshot
 * before taking its CAS lease, so a manual decision, clean-slate purge or
 * redelivery that changed the row always wins. No social provider is fetched.
 */
export async function autoTriageStoredReviewEnvelopes(options: {
  organizationId?: string
  providerRunId?: string
  now?: Date
  deadlineAt?: Date
  limit?: number
  aiLimit?: number
  aiTimeoutMs?: number
} = {}): Promise<AutomaticReviewBackfillResult> {
  const now = options.now ?? new Date()
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
  const aiLimit = Math.max(0, Math.min(options.aiLimit ?? DEFAULT_LIMIT, limit))
  const aiTimeoutMs = Math.max(1_000, Math.min(options.aiTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS, 30_000))
  const minimumPurgeAt = new Date(now.getTime() + 20 * 60_000)
  const result = emptyResult()
  const candidates: Array<{
    id: string
    organizationId: string
    text: string | null
    contentHmac: string
    updatedAt: Date
    purgeAt: Date
    relevanceReason: string | null
    contentKind: string
    policySnapshot: unknown
  }> = []
  let cursorId: string | null = null
  let scanned = 0
  while (candidates.length < limit && scanned < MAX_SCAN_ROWS) {
    const pageSize = Math.min(limit, MAX_SCAN_ROWS - scanned)
    const page = await prisma.ingestEnvelope.findMany({
      where: {
        ...(options.organizationId ? { organizationId: options.organizationId } : {}),
        ...(options.providerRunId ? { providerRunId: options.providerRunId } : {}),
        relevanceStatus: "REVIEW",
        OR: [
          {
            contentKind: { in: [...COMMENT_CONTENT_KINDS] },
            OR: [
              { relevanceReason: null },
              { relevanceReason: { notIn: [...TERMINAL_COMMENT_REVIEW_REASONS] } },
            ],
          },
          {
            relevanceReason: { in: [...AUTOMATIC_REVIEW_DISCOVERY_REASONS] },
            contentKind: { in: [...DISCOVERY_PUBLICATION_CONTENT_KINDS] },
          },
          {
            relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
            contentKind: { in: [...COMMENT_CONTENT_KINDS] },
            AND: [
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "version"],
                  equals: AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_VERSION,
                },
              },
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "resolved"],
                  equals: false,
                },
              },
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "decisionReason"],
                  equals: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
                },
              },
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "classifierSource"],
                  equals: "AI",
                },
              },
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "classifierVersion"],
                  equals: AUTOMATIC_REVIEW_AI_VERSION,
                },
              },
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "classifierEvidence"],
                  equals: AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE,
                },
              },
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "originalReason"],
                  equals: "comment_on_verified_brand_parent",
                },
              },
              {
                policySnapshot: {
                  path: ["replayResolution", "action"],
                  equals: "automatic_review_unresolved",
                },
              },
              {
                policySnapshot: {
                  path: ["replayResolution", "originalRelevance", "reason"],
                  equals: "comment_on_verified_brand_parent",
                },
              },
            ],
          },
          {
            // The first v3 unattended discovery pass preserved resolver
            // KEEP_REVIEW as a generic technical row. Select only that frozen
            // shape here; the full cross-field provenance contract is checked
            // again in memory before replay acquires a mutation lease.
            relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
            contentKind: { in: [...DISCOVERY_PUBLICATION_CONTENT_KINDS] },
            AND: [
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "version"],
                  equals: AUTOMATIC_REVIEW_TRIAGE_VERSION,
                },
              },
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "resolved"],
                  equals: false,
                },
              },
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "decisionReason"],
                  equals: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
                },
              },
              {
                policySnapshot: {
                  path: ["automaticReviewTriage", "classifierEvidence"],
                  equals: "technical_evidence_unresolved",
                },
              },
            ],
          },
        ],
        acceptedMentionId: null,
        purgedAt: null,
        deletedAtSource: null,
        purgeAt: { gt: minimumPurgeAt },
        discoveryAutoReviewDecisions: { none: { state: "SUPPRESSED" } },
        AND: [{
          OR: [
            { reviewMutationUntil: null },
            { reviewMutationUntil: { lte: now } },
          ],
        }],
      },
      // A terminal unresolved result leaves this allow-list, while successful
      // rows leave REVIEW. Cursor paging prevents rows in future AI backoff
      // from hiding due or deterministic rows behind the first page.
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: pageSize,
      select: {
        id: true,
        organizationId: true,
        text: true,
        contentHmac: true,
        updatedAt: true,
        purgeAt: true,
        relevanceReason: true,
        contentKind: true,
        policySnapshot: true,
      },
    })
    result.selected += page.length
    scanned += page.length
    for (const candidate of page) {
      const storedRetry = retryState(candidate.policySnapshot)
      const deterministic = classifyAutomaticReviewText(candidate.text ?? "", null)
      const selectedTechnicalPublication =
        candidate.relevanceReason === AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON
        && DISCOVERY_PUBLICATION_CONTENT_KINDS.includes(
          candidate.contentKind as typeof DISCOVERY_PUBLICATION_CONTENT_KINDS[number],
        )
      const futureBackoff = !selectedTechnicalPublication
        && deterministic.classification === "unknown"
        && storedRetry.attempts < MAX_AI_ATTEMPTS
        && storedRetry.nextAttemptAt
        && storedRetry.nextAttemptAt.getTime() > now.getTime()
      if (futureBackoff) result.deferred += 1
      else if (candidates.length < limit) candidates.push(candidate)
    }
    if (page.length < pageSize) break
    cursorId = page.at(-1)?.id ?? null
    if (!cursorId) break
  }

  // Sequential processing keeps the AI and database footprint bounded. The
  // one-minute scheduler supplies a small limit and a wall-clock deadline.
  for (const [index, candidate] of candidates.entries()) {
    if (options.deadlineAt && Date.now() >= options.deadlineAt.getTime()) {
      result.deadlineReached = true
      result.deferred += candidates.length - index
      break
    }

    try {
      const selectedTechnical =
        candidate.relevanceReason === AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON
      const v2RecoveryOriginalReason = recoverableAutomaticReviewOriginalReason(candidate)
      const v3DiscoveryRecoveryOriginalReason =
        recoverableAutomaticReviewV3DiscoveryOriginalReason(candidate)
      const selectedTechnicalPublication = selectedTechnical
        && DISCOVERY_PUBLICATION_CONTENT_KINDS.includes(
          candidate.contentKind as typeof DISCOVERY_PUBLICATION_CONTENT_KINDS[number],
        )
      if (selectedTechnicalPublication && !v3DiscoveryRecoveryOriginalReason) {
        // The database predicate is only a scan accelerator. The complete
        // cross-field provenance contract remains authoritative here. Advance
        // malformed rows out of the selector with a CAS marker so they cannot
        // hot-loop or starve valid recovery candidates.
        await quarantineIneligibleV3DiscoveryRecovery(
          candidate,
          options.now ?? new Date(),
        )
        result.skipped += 1
        continue
      }
      const storedRetry = retryState(candidate.policySnapshot)
      const rules = classifyAutomaticReviewText(candidate.text ?? "", null)
      let automaticTriageClassification: AutomaticTriageReplayClassification | undefined
      if (
        rules.classification === "unknown"
        && (!selectedTechnical || Boolean(v2RecoveryOriginalReason))
      ) {
        const attemptClock = options.now ?? new Date()
        if (storedRetry.attempts >= MAX_AI_ATTEMPTS) {
          automaticTriageClassification = {
            sentiment: null,
            source: "AI",
            version: AUTOMATIC_REVIEW_AI_VERSION,
            attemptedAt: storedRetry.lastAttemptAt ?? attemptClock,
            errorClass: storedRetry.lastErrorClass ?? "UNKNOWN",
          }
        } else if (result.aiAttempted >= aiLimit) {
          result.deferred += 1
          continue
        } else {
          result.aiAttempted += 1
          const attemptedAt = options.now ?? new Date()
          const ai = await aiSentimentDetailed(candidate.text ?? "", {
            logErrors: false,
            timeoutMs: aiTimeoutMs,
          })
          if (!ai.sentiment) {
            const errorClass = ai.errorClass ?? "UNKNOWN"
            countAiFailure(result, errorClass)
            const attempts = storedRetry.attempts + 1
            const persisted = await persistAutomaticReviewRetry(
              candidate,
              attempts,
              errorClass,
              attemptedAt,
            )
            if (persisted) {
              result.deferred += 1
              if (attempts >= MAX_AI_ATTEMPTS) result.aiTerminalPending += 1
              else result.aiRetriesScheduled += 1
            } else {
              result.skipped += 1
            }
            continue
          }
          automaticTriageClassification = {
            sentiment: ai.sentiment,
            source: "AI",
            version: AUTOMATIC_REVIEW_AI_VERSION,
            attemptedAt,
          }
        }
      }
      const automaticTriageRecovery = v3DiscoveryRecoveryOriginalReason
        ? AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY
        : v2RecoveryOriginalReason && Boolean(automaticTriageClassification?.sentiment)
          ? AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY
          : undefined

      const replay = await replayIngestEnvelope(candidate.organizationId, candidate.id, {
        automaticTriage: true,
        ...(automaticTriageRecovery ? { automaticTriageRecovery } : {}),
        ...(automaticTriageClassification ? { automaticTriageClassification } : {}),
        automaticTriageExpectedSnapshot: {
          contentHmac: candidate.contentHmac,
          updatedAt: candidate.updatedAt,
          purgeAt: candidate.purgeAt,
          relevanceReason: candidate.relevanceReason,
        },
        suppressWorkflows: true,
        // Stored replay intentionally avoids reconstructing media descriptors
        // from raw provider payloads. An accepted observation and its original
        // URL remain durable; media scheduling stays a live-ingest
        // responsibility, so no detached positive-comment media can be born.
        suppressMediaScheduling: true,
      })
      const classification = replay.automaticReviewTriage?.classification
      if (replay.status === "AUTO_TRIAGED_ACCEPTED") {
        result.accepted += 1
        if (classification === "negative") result.acceptedNegative += 1
        else if (classification === "neutral") result.acceptedNeutral += 1
      } else if (replay.status === "AUTO_TRIAGED_REJECTED") {
        result.rejected += 1
        if (classification === "positive") result.rejectedPositive += 1
        else if (classification === "irrelevant") result.rejectedIrrelevant += 1
        else result.rejectedOther += 1
      } else if (replay.status === "REVIEW_UNRESOLVED") {
        result.unresolved += 1
      } else {
        result.skipped += 1
      }
    } catch {
      result.failures += 1
      // IDs are stable operational identifiers; never log observation text,
      // URLs, author data, model responses or raw external error objects.
      console.error("[social-automatic-review] envelope_failed", {
        organizationId: candidate.organizationId,
        envelopeId: candidate.id,
        code: "AUTOMATIC_REVIEW_REPLAY_FAILED",
      })
    }
  }
  return result
}
