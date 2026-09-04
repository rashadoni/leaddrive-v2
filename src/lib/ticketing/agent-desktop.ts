export const AGENT_DESKTOP_PERIOD_DAYS = 30

export const TERMINAL_TICKET_STATUSES = ["resolved", "closed"] as const

export type AgentDesktopMetricRow = {
  createdAt: Date
  firstResponseAt: Date | null
  resolvedAt: Date | null
  slaFirstResponseDueAt: Date | null
  slaDueAt: Date | null
  satisfactionRating: number | null
}

export type AgentDesktopQueueRow = {
  priority: string
  createdAt: Date
  slaFirstResponseDueAt: Date | null
  slaDueAt: Date | null
  firstResponseAt: Date | null
}

export type AgentDesktopMetrics = {
  averageFirstResponseSeconds: number | null
  firstResponseSample: number
  averageResolutionSeconds: number | null
  resolutionSample: number
  resolutionRatePct: number | null
  resolutionRateSample: number
  slaCompliancePct: number | null
  slaObligationSample: number
  csatAverage: number | null
  csatSample: number
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function percentage(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

/**
 * All rate numerators are strict subsets of their denominators. The cohort is
 * tickets assigned to the current agent and created in one rolling 30-day
 * window; callers provide that already-scoped cohort.
 */
export function calculateAgentDesktopMetrics(
  rows: AgentDesktopMetricRow[],
  now: Date,
): AgentDesktopMetrics {
  const firstResponseSeconds = rows.flatMap((row) => {
    if (!row.firstResponseAt) return []
    const seconds = Math.round((row.firstResponseAt.getTime() - row.createdAt.getTime()) / 1000)
    return seconds >= 0 ? [seconds] : []
  })

  const resolutionSeconds = rows.flatMap((row) => {
    if (!row.resolvedAt) return []
    const seconds = Math.round((row.resolvedAt.getTime() - row.createdAt.getTime()) / 1000)
    return seconds >= 0 ? [seconds] : []
  })

  let evaluatedSlaObligations = 0
  let metSlaObligations = 0
  for (const row of rows) {
    if (
      row.slaFirstResponseDueAt &&
      (row.firstResponseAt || row.slaFirstResponseDueAt.getTime() <= now.getTime())
    ) {
      evaluatedSlaObligations += 1
      if (row.firstResponseAt && row.firstResponseAt <= row.slaFirstResponseDueAt) {
        metSlaObligations += 1
      }
    }

    if (row.slaDueAt && (row.resolvedAt || row.slaDueAt.getTime() <= now.getTime())) {
      evaluatedSlaObligations += 1
      if (row.resolvedAt && row.resolvedAt <= row.slaDueAt) metSlaObligations += 1
    }
  }

  const ratings = rows.flatMap((row) =>
    row.satisfactionRating != null && row.satisfactionRating >= 1 && row.satisfactionRating <= 5
      ? [row.satisfactionRating]
      : [],
  )
  const csatAverage = ratings.length
    ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10
    : null

  return {
    averageFirstResponseSeconds: average(firstResponseSeconds),
    firstResponseSample: firstResponseSeconds.length,
    averageResolutionSeconds: average(resolutionSeconds),
    resolutionSample: resolutionSeconds.length,
    resolutionRatePct: percentage(resolutionSeconds.length, rows.length),
    resolutionRateSample: rows.length,
    slaCompliancePct: percentage(metSlaObligations, evaluatedSlaObligations),
    slaObligationSample: evaluatedSlaObligations,
    csatAverage,
    csatSample: ratings.length,
  }
}

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function actionableDueAt(row: AgentDesktopQueueRow): number {
  const dueAt = !row.firstResponseAt && row.slaFirstResponseDueAt
    ? row.slaFirstResponseDueAt
    : row.slaDueAt
  return dueAt?.getTime() ?? Number.POSITIVE_INFINITY
}

/** Earliest actionable SLA first, then business priority and age. */
export function compareAgentQueueRows(a: AgentDesktopQueueRow, b: AgentDesktopQueueRow): number {
  const dueDifference = actionableDueAt(a) - actionableDueAt(b)
  if (Number.isFinite(dueDifference) && dueDifference !== 0) return dueDifference
  if (Number.isFinite(actionableDueAt(a)) !== Number.isFinite(actionableDueAt(b))) {
    return Number.isFinite(actionableDueAt(a)) ? -1 : 1
  }

  const priorityDifference = (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4)
  if (priorityDifference !== 0) return priorityDifference
  return a.createdAt.getTime() - b.createdAt.getTime()
}

export function agentDesktopPeriod(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - AGENT_DESKTOP_PERIOD_DAYS * 24 * 60 * 60 * 1000),
    to: now,
  }
}
