import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { canonicalProviderUrl } from "@/lib/social/provider-capability-contract"
import { registerTikTokPublicationRevisit } from "@/lib/social/tiktok-publication-revisit-repo"
import { normalizeSubjectTerm } from "@/lib/social/monitoring-subjects"

export const TIKTOK_PUBLICATION_GATE_VERSION = "tiktok-publication-gate-v1"
export type TikTokPublicationDecisionStatus = "MATCHED" | "PROBABLE" | "REVIEW" | "REJECTED"
export type TikTokPublicationReasonCode =
  | "DETERMINISTIC_TERM_MATCH"
  | "AI_CONTEXT_PROBABLE"
  | "NEGATIVE_TERM"
  | "STALE_PUBLICATION"
  | "MISSING_PUBLISHED_AT"
  | "AMBIGUOUS_EVIDENCE"
  | "INSUFFICIENT_EVIDENCE"

export interface TikTokPublicationDecision {
  status: TikTokPublicationDecisionStatus
  reasonCode: TikTokPublicationReasonCode
  matchedTerms: string[]
  scenarioIds: string[]
  query: string
  provider: string
  observedAt: string
  policySnapshot: {
    version: typeof TIKTOK_PUBLICATION_GATE_VERSION
    probableOptIn: boolean
    minProbableConfidence: number
    candidateOnly: true
    liveRoutingAllowed: false
  }
}

function corpus(values: Array<string | null | undefined>): string {
  return normalizeSubjectTerm(values.filter((value): value is string => Boolean(value)).join(" \n "))
}

function matchesTerm(text: string, term: string): boolean {
  const value = normalizeSubjectTerm(term)
  if (!value) return false
  return text.includes(value)
}

export function decideTikTokPublication(input: {
  query: string
  scenarioIds: string[]
  provider: string
  observedAt: Date
  publishedAt: Date | null
  freshnessSince: Date
  caption?: string | null
  hashtags?: string[]
  mentionedAccounts?: string[]
  creator?: string | null
  transcript?: string | null
  positiveTerms: string[]
  negativeTerms: string[]
  ambiguous?: boolean
  aiConfidence?: number | null
  probableOptIn?: boolean
  minProbableConfidence?: number
}): TikTokPublicationDecision {
  const minProbableConfidence = input.minProbableConfidence ?? 0.8
  const probableOptIn = input.probableOptIn === true
  const text = corpus([input.caption, ...(input.hashtags ?? []), ...(input.mentionedAccounts ?? []), input.creator, input.transcript])
  const matchedTerms = Array.from(new Set(input.positiveTerms.filter(term => matchesTerm(text, term)))).sort()
  const negative = input.negativeTerms.find(term => matchesTerm(text, term))
  let status: TikTokPublicationDecisionStatus
  let reasonCode: TikTokPublicationReasonCode
  if (negative) {
    status = "REJECTED"; reasonCode = "NEGATIVE_TERM"
  } else if (!input.publishedAt) {
    status = "REVIEW"; reasonCode = "MISSING_PUBLISHED_AT"
  } else if (input.publishedAt.getTime() < input.freshnessSince.getTime() || input.publishedAt.getTime() > input.observedAt.getTime() + 5 * 60_000) {
    status = "REJECTED"; reasonCode = "STALE_PUBLICATION"
  } else if (matchedTerms.length > 0 && input.ambiguous !== true) {
    status = "MATCHED"; reasonCode = "DETERMINISTIC_TERM_MATCH"
  } else if ((input.aiConfidence ?? 0) >= minProbableConfidence) {
    status = "PROBABLE"; reasonCode = "AI_CONTEXT_PROBABLE"
  } else if (input.ambiguous === true || matchedTerms.length > 0) {
    status = "REVIEW"; reasonCode = "AMBIGUOUS_EVIDENCE"
  } else {
    status = "REJECTED"; reasonCode = "INSUFFICIENT_EVIDENCE"
  }
  return {
    status,
    reasonCode,
    matchedTerms,
    scenarioIds: Array.from(new Set(input.scenarioIds)).sort(),
    query: input.query,
    provider: input.provider,
    observedAt: input.observedAt.toISOString(),
    policySnapshot: { version: TIKTOK_PUBLICATION_GATE_VERSION, probableOptIn, minProbableConfidence, candidateOnly: true, liveRoutingAllowed: false },
  }
}

export function isTikTokPublicationEligibleForComments(decision: TikTokPublicationDecision): boolean {
  return decision.status === "MATCHED" || (decision.status === "PROBABLE" && decision.policySnapshot.probableOptIn)
}

export type TikTokPublicationPersistResult = "applied" | "skipped_terminal" | "failed"

export async function persistTikTokPublicationDecision(input: {
  organizationId: string
  envelopeId: string
  decision: TikTokPublicationDecision
}, dependencies: {
  registerRevisit: typeof registerTikTokPublicationRevisit
} = { registerRevisit: registerTikTokPublicationRevisit }): Promise<TikTokPublicationPersistResult> {
  const eligible = isTikTokPublicationEligibleForComments(input.decision)
  const result = await prisma.ingestEnvelope.updateMany({
    where: {
      id: input.envelopeId,
      organizationId: input.organizationId,
      platform: "tiktok",
      // Subject matching may accept the envelope before the TikTok-specific
      // publication gate runs. An eligible gate decision must still be able to
      // attach its policy snapshot and register the first comments revisit.
      // Ineligible decisions never downgrade a previously accepted envelope.
      relevanceStatus: { in: eligible ? ["PENDING", "REVIEW", "ACCEPTED"] : ["PENDING", "REVIEW"] },
    },
    data: {
      relevanceStatus: eligible ? "ACCEPTED" : input.decision.status,
      relevanceReason: input.decision.reasonCode,
      matchedTerms: input.decision.matchedTerms,
      subjectDecision: input.decision as unknown as Prisma.InputJsonValue,
      policySnapshot: input.decision.policySnapshot as Prisma.InputJsonValue,
      decidedAt: new Date(input.decision.observedAt),
    },
  })
  if (result.count === 1) {
    if (eligible) {
      await dependencies.registerRevisit({ organizationId: input.organizationId, envelopeId: input.envelopeId })
    }
    return "applied"
  }
  // Конверт уже терминально отклонён (прошлым прогоном или другим правилом).
  // Продвигать его этот гейт не вправе, и ревизита у отклонённой записи быть
  // не может — значит регистрировать нечего. Это НЕ сбой записи: отличать их
  // обязательно, иначе одна повторно встреченная отклонённая запись роняет
  // импорт всего набора (#657, прод: 100 записей встали на девятой).
  const terminal = await prisma.ingestEnvelope.findFirst({
    where: {
      id: input.envelopeId,
      organizationId: input.organizationId,
      relevanceStatus: { in: ["REJECTED", "POLICY_DENIED", "DELETED_AT_SOURCE", "PURGED"] },
    },
    select: { id: true },
  })
  return terminal ? "skipped_terminal" : "failed"
}

function parseDecision(value: unknown): TikTokPublicationDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const decision = value as Partial<TikTokPublicationDecision>
  if (!decision.status || !decision.policySnapshot || typeof decision.policySnapshot !== "object") return null
  return decision as TikTokPublicationDecision
}

export async function approvedTikTokCandidateParents(input: {
  organizationId: string
  sourceId: string
  providerRunId: string
  limit: number
}): Promise<Array<{ canonicalUrl: string; videoId: string | null; decision: TikTokPublicationDecision }>> {
  const rows = await prisma.ingestEnvelope.findMany({
    where: { organizationId: input.organizationId, sourceId: input.sourceId, providerRunId: input.providerRunId, platform: "tiktok", relevanceStatus: "ACCEPTED" },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(input.limit, 1), 50),
    select: { canonicalUrl: true, url: true, externalId: true, postExternalId: true, subjectDecision: true },
  })
  return rows.flatMap((row: { canonicalUrl: string | null; url: string | null; externalId: string | null; postExternalId: string | null; subjectDecision: unknown }) => {
    const decision = parseDecision(row.subjectDecision)
    const url = row.canonicalUrl || row.url
    if (!decision || !url || !isTikTokPublicationEligibleForComments(decision)) return []
    return [{ canonicalUrl: canonicalProviderUrl(url), videoId: row.postExternalId || row.externalId, decision }]
  })
}

export function buildTikTokApprovedParentDispatch(input: {
  organizationId: string
  parent: { canonicalUrl: string; videoId: string | null; decision: TikTokPublicationDecision }
  maxItems: number
}): {
  postURLs: string[]
  commentsPerPost: number
  maxRepliesPerComment: number
  maxItems: number
  leadDrivePolicy: Record<string, unknown>
} {
  if (!isTikTokPublicationEligibleForComments(input.parent.decision)) throw new Error("TikTok comments require an approved publication")
  const maxItems = Math.min(Math.max(Math.trunc(input.maxItems), 1), 1000)
  return {
    postURLs: [canonicalProviderUrl(input.parent.canonicalUrl)],
    commentsPerPost: maxItems,
    maxRepliesPerComment: maxItems,
    maxItems,
    leadDrivePolicy: {
      organizationId: input.organizationId,
      canonicalVideoUrl: canonicalProviderUrl(input.parent.canonicalUrl),
      videoId: input.parent.videoId,
      decision: input.parent.decision.status,
      reasonCode: input.parent.decision.reasonCode,
      scenarioIds: input.parent.decision.scenarioIds,
      policySnapshot: input.parent.decision.policySnapshot,
      liveReplies: false,
    },
  }
}
