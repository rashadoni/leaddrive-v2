import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { canonicalProviderUrl } from "@/lib/social/provider-capability-contract"
import { planTikTokPublicationRevisit } from "@/lib/social/tiktok-publication-revisit"

const TIKTOK_WRAPPED_EXTERNAL_ID_PREFIXES = ["apify:", "provider:"] as const

const TIKTOK_REVISIT_POST_ID_SQL = Prisma.sql`COALESCE(
  NULLIF(BTRIM(e."postExternalId"), ''),
  NULLIF(SUBSTRING(NULLIF(BTRIM(e."canonicalUrl"), '') FROM '/video/([^/?#]+)'), ''),
  NULLIF(SUBSTRING(NULLIF(BTRIM(e."url"), '') FROM '/video/([^/?#]+)'), ''),
  CASE
    WHEN BTRIM(e."externalId") LIKE 'apify:%'
      THEN NULLIF(SUBSTRING(BTRIM(e."externalId") FROM 7), '')
    WHEN BTRIM(e."externalId") LIKE 'provider:%'
      THEN NULLIF(SUBSTRING(BTRIM(e."externalId") FROM 10), '')
    ELSE NULLIF(BTRIM(e."externalId"), '')
  END
)`

type TikTokPublicationIdentity = {
  postExternalId: string | null
  externalId: string | null
  canonicalUrl: string | null
  url: string | null
}

function tiktokVideoIdFromUrl(value: string | null): string | null {
  const match = value?.trim().match(/\/video\/([^/?#]+)/)
  return match?.[1]?.trim() || null
}

function normalizedTikTokPostExternalId(value: TikTokPublicationIdentity): string | null {
  const explicitPostId = value.postExternalId?.trim()
  if (explicitPostId) return explicitPostId

  const urlPostId = tiktokVideoIdFromUrl(value.canonicalUrl)
    ?? tiktokVideoIdFromUrl(value.url)
  if (urlPostId) return urlPostId

  const externalId = value.externalId?.trim()
  if (!externalId) return null
  for (const prefix of TIKTOK_WRAPPED_EXTERNAL_ID_PREFIXES) {
    if (!externalId.startsWith(prefix)) continue
    return externalId.slice(prefix.length).trim() || null
  }
  return externalId
}

export interface TikTokPublicationRevisitStore {
  findApprovedEnvelope(input: { organizationId: string; envelopeId: string }): Promise<{ id: string; postExternalId: string | null; externalId: string | null; canonicalUrl: string | null; url: string | null; decidedAt: Date | null } | null>
  findActiveSourceSubjectIds(input: { organizationId: string; sourceId: string; candidateSubjectIds: string[] }): Promise<Array<{ id: string }>>
  findApprovedPublicationsWithoutRevisit(input: { organizationId: string; subjectIds: string[]; limit: number }): Promise<Array<{
    id: string
    postExternalId: string | null
    externalId: string | null
    canonicalUrl: string | null
    url: string | null
    decidedAt: Date | null
    acceptedAt: Date | null
    createdAt: Date
  }>>
  createMany(input: Record<string, unknown>): Promise<{ count: number }>
  upsert(input: Record<string, unknown>): Promise<unknown>
  findDue(input: { organizationId: string; now: Date; limit: number }): Promise<unknown[]>
  findStateByPost(input: { organizationId: string; postExternalId: string }): Promise<{ id: string } | null>
  findState(input: { organizationId: string; id: string }): Promise<{ id: string; approvedAt: Date; lastActivityAt: Date; lastCheckedAt: Date | null; status: string; reactivationGeneration: number; lastSeenCommentCount: number } | null>
  update(input: Record<string, unknown>): Promise<unknown>
  reactivate(input: { organizationId: string; id: string; now: Date }): Promise<number>
}

const defaultStore: TikTokPublicationRevisitStore = {
  findApprovedEnvelope: input => prisma.ingestEnvelope.findFirst({
    where: { id: input.envelopeId, organizationId: input.organizationId, platform: "tiktok", relevanceStatus: "ACCEPTED" },
    select: { id: true, postExternalId: true, externalId: true, canonicalUrl: true, url: true, decidedAt: true },
  }),
  findActiveSourceSubjectIds: input => prisma.monitoringSubject.findMany({
    where: {
      organizationId: input.organizationId,
      status: "active",
      OR: [
        { sources: { some: { sourceId: input.sourceId } } },
        ...(input.candidateSubjectIds.length > 0
          ? [{ id: { in: input.candidateSubjectIds } }]
          : []),
      ],
    },
    select: { id: true },
  }),
  findApprovedPublicationsWithoutRevisit: input => prisma.$queryRaw<Array<{
    id: string
    postExternalId: string | null
    externalId: string | null
    canonicalUrl: string | null
    url: string | null
    decidedAt: Date | null
    acceptedAt: Date | null
    createdAt: Date
  }>>(Prisma.sql`
    SELECT candidate."id",
           candidate."postExternalId",
           candidate."externalId",
           candidate."canonicalUrl",
           candidate."url",
           candidate."decidedAt",
           candidate."acceptedAt",
           candidate."createdAt"
    FROM (
      SELECT DISTINCT ON (${TIKTOK_REVISIT_POST_ID_SQL})
             e."id",
             ${TIKTOK_REVISIT_POST_ID_SQL} AS "postExternalId",
             e."externalId",
             e."canonicalUrl",
             e."url",
             e."decidedAt",
             e."acceptedAt",
             e."createdAt"
      FROM "ingest_envelopes" AS e
      JOIN "social_mentions" AS m
        ON m."organizationId" = e."organizationId"
       AND m."id" = e."acceptedMentionId"
      WHERE e."organizationId" = ${input.organizationId}
        AND e."platform" = 'tiktok'
        AND e."relevanceStatus" = 'ACCEPTED'
        AND e."acceptedMentionId" IS NOT NULL
        AND e."contentKind" IN ('POST', 'VIDEO')
        AND e."deletedAtSource" IS NULL
        AND e."purgedAt" IS NULL
        AND (e."canonicalUrl" IS NOT NULL OR e."url" IS NOT NULL)
        AND ${TIKTOK_REVISIT_POST_ID_SQL} IS NOT NULL
        AND LOWER(BTRIM(COALESCE(m."sentiment", ''))) = 'negative'
        AND m."deletedAtSource" IS NULL
        AND m."purgedAt" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "social_mention_subject_matches" AS msm
          WHERE msm."organizationId" = e."organizationId"
            AND msm."mentionId" = e."acceptedMentionId"
            AND msm."status" = 'MATCHED'
            AND msm."subjectId" IN (${Prisma.join(input.subjectIds)})
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "tiktok_publication_revisits" AS revisit
          WHERE revisit."organizationId" = e."organizationId"
            AND revisit."postExternalId" = ${TIKTOK_REVISIT_POST_ID_SQL}
        )
      ORDER BY
        ${TIKTOK_REVISIT_POST_ID_SQL} ASC,
        COALESCE(e."decidedAt", e."acceptedAt", e."createdAt") ASC,
        e."id" ASC
    ) AS candidate
    ORDER BY COALESCE(candidate."decidedAt", candidate."acceptedAt", candidate."createdAt") ASC,
             candidate."id" ASC
    LIMIT ${input.limit}
  `),
  createMany: input => prisma.tikTokPublicationRevisit.createMany(input as never),
  upsert: input => prisma.tikTokPublicationRevisit.upsert(input as never),
  findDue: input => prisma.tikTokPublicationRevisit.findMany({
    where: { organizationId: input.organizationId, status: "ACTIVE", nextDueAt: { lte: input.now } },
    orderBy: [{ nextDueAt: "asc" }, { id: "asc" }], take: Math.min(Math.max(input.limit, 1), 100),
  }),
  findStateByPost: input => prisma.tikTokPublicationRevisit.findUnique({
    where: { organizationId_postExternalId: { organizationId: input.organizationId, postExternalId: input.postExternalId } },
    select: { id: true },
  }),
  findState: input => prisma.tikTokPublicationRevisit.findUnique({
    where: { organizationId_id: { organizationId: input.organizationId, id: input.id } },
    select: { id: true, approvedAt: true, lastActivityAt: true, lastCheckedAt: true, status: true, reactivationGeneration: true, lastSeenCommentCount: true },
  }),
  update: input => prisma.tikTokPublicationRevisit.update(input as never),
  reactivate: async input => (await prisma.tikTokPublicationRevisit.updateMany({
    where: { organizationId: input.organizationId, id: input.id },
    data: { status: "ACTIVE", nextDueAt: input.now, lastActivityAt: input.now, reactivationGeneration: { increment: 1 } },
  })).count,
}

/**
 * Repairs the durable revisit queue for accepted TikTok publications created
 * before the publication-gate hook existed. The scan is tenant/subject scoped,
 * negative-only, bounded, and add-only; database uniqueness keeps concurrent
 * runs idempotent.
 */
export async function reconcileTikTokPublicationRevisits(input: {
  organizationId: string
  subjectIds: string[]
  now?: Date
  limit?: number
}, store: TikTokPublicationRevisitStore = defaultStore): Promise<{ examined: number; created: number }> {
  const now = input.now ?? new Date()
  const subjectIds = Array.from(new Set(input.subjectIds.map(value => value.trim()).filter(Boolean)))
  if (subjectIds.length === 0) return { examined: 0, created: 0 }
  const rows = await store.findApprovedPublicationsWithoutRevisit({
    organizationId: input.organizationId,
    subjectIds,
    limit: Math.min(Math.max(Math.trunc(input.limit ?? 25), 1), 100),
  })
  const seenPostIds = new Set<string>()
  const data = rows.flatMap(row => {
    const postExternalId = normalizedTikTokPostExternalId(row)
    const url = row.canonicalUrl || row.url
    if (!postExternalId || !url || seenPostIds.has(postExternalId)) return []
    seenPostIds.add(postExternalId)
    const approvedAt = row.decidedAt ?? row.acceptedAt ?? row.createdAt
    return [{
      organizationId: input.organizationId,
      ingestEnvelopeId: row.id,
      postExternalId,
      canonicalUrl: canonicalProviderUrl(url),
      approvedAt,
      lastActivityAt: approvedAt,
      // Reconciliation is a repair path: make the first extraction due now,
      // then let the normal adaptive revisit planner control future cadence.
      nextDueAt: now,
      status: "ACTIVE",
    }]
  })
  if (data.length === 0) return { examined: rows.length, created: 0 }
  const created = await store.createMany({ data, skipDuplicates: true })
  return { examined: rows.length, created: created.count }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * Resolves the active subject lineage of a current route, then repairs negative
 * accepted publications from any legacy source linked to those same subjects.
 */
export async function reconcileTikTokPublicationRevisitsForSource(input: {
  organizationId: string
  sourceId: string
  sourceSettings: unknown
  targetSubjectId?: string | null
  now?: Date
  limit?: number
}, store: TikTokPublicationRevisitStore = defaultStore): Promise<{
  subjectIds: string[]
  examined: number
  created: number
}> {
  const settings = record(input.sourceSettings)
  const scenarioLinks = Array.isArray(settings.scenarioLinks)
    ? settings.scenarioLinks.map(record)
    : []
  const candidateSubjectIds = Array.from(new Set([
    stringValue(input.targetSubjectId),
    stringValue(settings.subjectId),
    stringValue(settings.targetSubjectId),
    ...scenarioLinks.map(link => stringValue(link.subjectId)),
  ].filter((value): value is string => Boolean(value))))
  const activeSubjects = await store.findActiveSourceSubjectIds({
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    candidateSubjectIds,
  })
  const subjectIds = Array.from(new Set(activeSubjects.map(subject => subject.id))).sort()
  const reconciled = await reconcileTikTokPublicationRevisits({
    organizationId: input.organizationId,
    subjectIds,
    now: input.now,
    limit: input.limit,
  }, store)
  return { subjectIds, ...reconciled }
}

export async function registerTikTokPublicationRevisit(input: {
  organizationId: string
  envelopeId: string
  now?: Date
}, store: TikTokPublicationRevisitStore = defaultStore): Promise<boolean> {
  const envelope = await store.findApprovedEnvelope(input)
  if (!envelope) return false
  const postExternalId = normalizedTikTokPostExternalId(envelope)
  const url = envelope.canonicalUrl || envelope.url
  if (!postExternalId || !url) return false
  const approvedAt = envelope.decidedAt ?? input.now ?? new Date()
  await store.upsert({
    where: { organizationId_postExternalId: { organizationId: input.organizationId, postExternalId } },
    create: {
      organizationId: input.organizationId, ingestEnvelopeId: envelope.id, postExternalId,
      canonicalUrl: canonicalProviderUrl(url), approvedAt, lastActivityAt: approvedAt,
      // The first comment extraction is due immediately. Adaptive cadence is
      // applied only after that first provider result is recorded.
      nextDueAt: approvedAt, status: "ACTIVE",
    },
    update: {},
  })
  return true
}

export function dueTikTokPublicationRevisits(
  organizationId: string,
  now: Date,
  limit = 25,
  store: TikTokPublicationRevisitStore = defaultStore,
): Promise<unknown[]> {
  return store.findDue({ organizationId, now, limit: Math.min(Math.max(limit, 1), 100) })
}

export async function recordTikTokPublicationRevisit(input: {
  organizationId: string
  id: string
  observedCommentCount: number
  coverageClass: string
  activityDetected?: boolean
  now: Date
}, store: TikTokPublicationRevisitStore = defaultStore): Promise<boolean> {
  if (!Number.isInteger(input.observedCommentCount) || input.observedCommentCount < 0) throw new Error("TikTok revisit comment count must be non-negative")
  const current = await store.findState(input)
  if (!current) return false
  const lastActivityAt = input.activityDetected || input.observedCommentCount > current.lastSeenCommentCount ? input.now : current.lastActivityAt
  const plan = planTikTokPublicationRevisit({
    state: {
      approvedAt: current.approvedAt, lastActivityAt, lastCheckedAt: input.now,
      status: current.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", reactivationGeneration: current.reactivationGeneration,
    },
    now: input.now,
  })
  await store.update({
    where: { organizationId_id: { organizationId: input.organizationId, id: input.id } },
    data: {
      lastActivityAt, lastCheckedAt: input.now, nextDueAt: plan.nextDueAt, status: plan.status,
      lastSeenCommentCount: Math.max(current.lastSeenCommentCount, input.observedCommentCount), coverageClass: input.coverageClass,
    },
  })
  return true
}

export async function reactivateTikTokPublication(input: {
  organizationId: string
  id: string
  now: Date
}, store: TikTokPublicationRevisitStore = defaultStore): Promise<boolean> {
  return (await store.reactivate(input)) === 1
}

export async function recordTikTokPublicationRevisitByPost(input: { organizationId: string; postExternalId: string; observedCommentCount: number; coverageClass: string; activityDetected?: boolean; now: Date }, store: TikTokPublicationRevisitStore = defaultStore): Promise<boolean> {
  const row = await store.findStateByPost({ organizationId: input.organizationId, postExternalId: input.postExternalId })
  return row ? recordTikTokPublicationRevisit({ ...input, id: row.id }, store) : false
}
