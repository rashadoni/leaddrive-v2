import type { Prisma } from "@prisma/client"

export const SOCIAL_REPORT_EXCLUDED_FEEDBACK_TYPES = [
  "NOT_RELEVANT",
  "WRONG_SUBJECT",
  "DUPLICATE",
] as const

type ReportSubjectVisibilityOptions = {
  organizationId: string
  subjectIds: string[]
  matchStatuses?: string[]
  excludeParentPostMatch?: boolean
}

/** Operator-level ignore is terminal for every client-facing report. */
export function socialReportVisibleMentionWhere(): Prisma.SocialMentionWhereInput {
  return { status: { not: "ignored" } }
}

/**
 * A relevance decision is scoped to one mention/subject pair. Build one branch
 * per requested subject so rejecting brand A cannot hide the same mention from
 * brand B when both brands are selected in a report.
 */
export function socialReportEffectiveSubjectWhere({
  organizationId,
  subjectIds,
  matchStatuses = ["MATCHED"],
  excludeParentPostMatch = true,
}: ReportSubjectVisibilityOptions): Prisma.SocialMentionWhereInput {
  return {
    OR: subjectIds.map(subjectId => ({
      subjectMatches: {
        some: {
          organizationId,
          subjectId,
          status: { in: matchStatuses },
          ...(excludeParentPostMatch ? { reason: { not: "parent_post_match" } } : {}),
        },
      },
      relevanceFeedback: {
        none: {
          organizationId,
          subjectId,
          feedbackType: { in: [...SOCIAL_REPORT_EXCLUDED_FEEDBACK_TYPES] },
        },
      },
    })),
  }
}

export function socialReportExcludedFeedbackSubjectIds(
  feedback: Array<{ subjectId: string; feedbackType: string }> | null | undefined,
): Set<string> {
  const excludedTypes = new Set<string>(SOCIAL_REPORT_EXCLUDED_FEEDBACK_TYPES)
  return new Set(
    (feedback ?? [])
      .filter(item => excludedTypes.has(item.feedbackType))
      .map(item => item.subjectId),
  )
}
