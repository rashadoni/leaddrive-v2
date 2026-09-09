import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { SUBJECT_MATCHER_VERSION } from "@/lib/social/subject-relevance"

export const SOCIAL_RELEVANCE_FEEDBACK_TYPES = [
  "RELEVANT",
  "NOT_RELEVANT",
  "DUPLICATE",
  "WRONG_SUBJECT",
  "MISSED_RISK",
] as const

export type SocialRelevanceFeedbackType = typeof SOCIAL_RELEVANCE_FEEDBACK_TYPES[number]

const RELEVANCE_STATUSES = new Set([
  "PENDING",
  "ACCEPTED",
  "REVIEW",
  "REJECTED",
  "POLICY_DENIED",
  "DELETED_AT_SOURCE",
  "PURGED",
])

type RecordFeedbackInput = {
  mentionId: string
  subjectId: string
  feedbackType: SocialRelevanceFeedbackType
}

type WeeklyQualityRow = {
  weekStart: Date | string
  subjectId: string
  subjectName: string
  platform: string
  relevanceStatus: string
  total: bigint | number
  relevant: bigint | number
  notRelevant: bigint | number
  duplicate: bigint | number
  wrongSubject: bigint | number
  missedRisk: bigint | number
}

function integer(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value
}

function relevanceStatus(envelopeStatus: string | null | undefined, matchStatus: string | null | undefined): string {
  if (envelopeStatus && RELEVANCE_STATUSES.has(envelopeStatus)) return envelopeStatus
  return matchStatus === "REVIEW" ? "REVIEW" : "ACCEPTED"
}

export async function recordSocialRelevanceFeedback(
  organizationId: string,
  decidedBy: string,
  input: RecordFeedbackInput,
) {
  const [mention, subject] = await Promise.all([
    prisma.socialMention.findFirst({
      where: { organizationId, id: input.mentionId },
      select: {
        id: true,
        platform: true,
        subjectMatches: {
          where: { subjectId: input.subjectId },
          select: { status: true, matcherVersion: true },
          orderBy: { decidedAt: "desc" },
          take: 1,
        },
        ingestEnvelopes: {
          select: { relevanceStatus: true },
          orderBy: { decidedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.monitoringSubject.findFirst({
      where: { organizationId, id: input.subjectId, status: { not: "archived" } },
      select: { id: true },
    }),
  ])
  if (!mention) throw new Error("Social mention not found")
  if (!subject) throw new Error("Monitoring subject not found")

  const match = mention.subjectMatches[0]
  const envelope = mention.ingestEnvelopes[0]
  const snapshot = {
    organizationId,
    mentionId: mention.id,
    subjectId: subject.id,
    feedbackType: input.feedbackType,
    relevanceStatus: relevanceStatus(envelope?.relevanceStatus, match?.status),
    matcherVersion: match?.matcherVersion || SUBJECT_MATCHER_VERSION,
    platform: mention.platform,
    decidedBy,
  }

  return prisma.socialRelevanceFeedback.upsert({
    where: {
      organizationId_mentionId_subjectId: {
        organizationId,
        mentionId: mention.id,
        subjectId: subject.id,
      },
    },
    create: snapshot,
    update: {
      feedbackType: snapshot.feedbackType,
      relevanceStatus: snapshot.relevanceStatus,
      matcherVersion: snapshot.matcherVersion,
      platform: snapshot.platform,
      decidedBy: snapshot.decidedBy,
    },
  })
}

export async function getWeeklySocialRelevanceQualityReport(
  organizationId: string,
  since: Date,
  filters: { subjectId?: string; platform?: string } = {},
) {
  const queryRaw = prisma.$queryRaw.bind(prisma) as <T>(query: Prisma.Sql) => Promise<T>
  const rows = await queryRaw<WeeklyQualityRow[]>(Prisma.sql`
    SELECT
      date_trunc('week', feedback."updatedAt") AS "weekStart",
      feedback."subjectId" AS "subjectId",
      subject.name AS "subjectName",
      feedback.platform,
      feedback."relevanceStatus" AS "relevanceStatus",
      COUNT(*)::BIGINT AS total,
      COUNT(*) FILTER (WHERE feedback."feedbackType" = 'RELEVANT')::BIGINT AS relevant,
      COUNT(*) FILTER (WHERE feedback."feedbackType" = 'NOT_RELEVANT')::BIGINT AS "notRelevant",
      COUNT(*) FILTER (WHERE feedback."feedbackType" = 'DUPLICATE')::BIGINT AS duplicate,
      COUNT(*) FILTER (WHERE feedback."feedbackType" = 'WRONG_SUBJECT')::BIGINT AS "wrongSubject",
      COUNT(*) FILTER (WHERE feedback."feedbackType" = 'MISSED_RISK')::BIGINT AS "missedRisk"
    FROM "social_relevance_feedback" feedback
    JOIN "monitoring_subjects" subject
      ON subject."organizationId" = feedback."organizationId"
      AND subject.id = feedback."subjectId"
    WHERE feedback."organizationId" = ${organizationId}
      AND feedback."updatedAt" >= ${since}
      ${filters.subjectId ? Prisma.sql`AND feedback."subjectId" = ${filters.subjectId}` : Prisma.sql``}
      ${filters.platform ? Prisma.sql`AND feedback.platform = ${filters.platform}` : Prisma.sql``}
    GROUP BY 1, feedback."subjectId", subject.name, feedback.platform, feedback."relevanceStatus"
    ORDER BY 1 DESC, subject.name, feedback.platform, feedback."relevanceStatus"
  `)

  const byWeek = rows.map(row => ({
    weekStart: new Date(row.weekStart).toISOString(),
    subjectId: row.subjectId,
    subjectName: row.subjectName,
    platform: row.platform,
    relevanceStatus: row.relevanceStatus,
    total: integer(row.total),
    relevant: integer(row.relevant),
    notRelevant: integer(row.notRelevant),
    duplicate: integer(row.duplicate),
    wrongSubject: integer(row.wrongSubject),
    missedRisk: integer(row.missedRisk),
  }))
  const totals = byWeek.reduce((sum, row) => ({
    total: sum.total + row.total,
    relevant: sum.relevant + row.relevant,
    notRelevant: sum.notRelevant + row.notRelevant,
    duplicate: sum.duplicate + row.duplicate,
    wrongSubject: sum.wrongSubject + row.wrongSubject,
    missedRisk: sum.missedRisk + row.missedRisk,
  }), { total: 0, relevant: 0, notRelevant: 0, duplicate: 0, wrongSubject: 0, missedRisk: 0 })
  const relevanceDecisions = totals.relevant + totals.notRelevant + totals.wrongSubject

  return {
    since: since.toISOString(),
    filters: { subjectId: filters.subjectId ?? null, platform: filters.platform ?? null },
    totals: {
      ...totals,
      confirmedRelevantRate: relevanceDecisions > 0
        ? Number((totals.relevant / relevanceDecisions).toFixed(6))
        : null,
      falsePositiveRate: relevanceDecisions > 0
        ? Number(((totals.notRelevant + totals.wrongSubject) / relevanceDecisions).toFixed(6))
        : null,
      duplicateRate: totals.total > 0 ? Number((totals.duplicate / totals.total).toFixed(6)) : null,
      missedRiskRate: totals.total > 0 ? Number((totals.missedRisk / totals.total).toFixed(6)) : null,
    },
    byWeek,
  }
}
