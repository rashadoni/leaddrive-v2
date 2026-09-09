/**
 * Professional Services Cloud — utilization engine.
 *
 * Computes the canonical metric for a services-firm operator: how much of
 * each consultant's available capacity went to billable client work. Pure
 * functional — caller fetches `ProjectMember` rows + per-user weekly capacity,
 * engine returns the utilization summary.
 *
 * Definitions (matching Salesforce PSA / Mavenlink conventions):
 *   - capacity_hours   = working hours available in the period (e.g. 40/week)
 *   - billable_hours   = hours logged against billable projects
 *   - utilization      = billable_hours / capacity_hours  (0-1.0+, can exceed)
 *   - non_billable     = hours logged on internal / unbillable projects
 *   - bench            = capacity_hours − total_logged   (capacity unused)
 *
 * Part of R12 Professional Services Cloud (Phase 2 roadmap slice 1).
 */

export interface UserCapacity {
  userId: string
  /** Weekly working hours target (e.g. 40 for full-time, 20 for half-time). */
  weeklyHours: number
}

export interface ProjectMemberHoursRow {
  userId: string
  projectId: string
  hoursLogged: number
  hourlyRate: number | null
  /** When false, project is internal — hours don't count as billable. */
  isBillable: boolean
}

export interface UtilizationSummary {
  userId: string
  capacityHours: number
  billableHours: number
  nonBillableHours: number
  totalLoggedHours: number
  /** billable / capacity. >1.0 = over-utilised (red flag in healthy firms). */
  utilization: number
  /** capacity − total. Positive = bench, negative = overtime. */
  benchHours: number
  /** Revenue generated this period in currency-neutral units. */
  billableRevenue: number
}

export interface UtilizationStatus {
  userId: string
  utilization: number
  /** Salesforce-PSA-style status badge. */
  status: "underutilized" | "healthy" | "high" | "over_utilized" | "bench"
}

/**
 * Aggregate one period of `ProjectMember.hoursLogged` rows into a per-user
 * utilization summary. Caller is responsible for already filtering rows to
 * the target period (e.g. weekly window from a TimeEntry table — slice 2;
 * for slice 1 we use the cumulative hoursLogged + a periodWeeks divisor).
 *
 * `periodWeeks` is multiplied with each user's `weeklyHours` to derive total
 * capacity for the window. Pass `1` for one-week, `13` for one-quarter, etc.
 */
export function computeUtilization(
  capacities: UserCapacity[],
  rows: ProjectMemberHoursRow[],
  periodWeeks: number = 1
): UtilizationSummary[] {
  const byUser = new Map<string, { billable: number; nonBillable: number; revenue: number }>()

  for (const row of rows) {
    const bucket = byUser.get(row.userId) ?? { billable: 0, nonBillable: 0, revenue: 0 }
    if (row.isBillable) {
      bucket.billable += row.hoursLogged
      bucket.revenue += row.hoursLogged * (row.hourlyRate ?? 0)
    } else {
      bucket.nonBillable += row.hoursLogged
    }
    byUser.set(row.userId, bucket)
  }

  return capacities.map(cap => {
    const bucket = byUser.get(cap.userId) ?? { billable: 0, nonBillable: 0, revenue: 0 }
    const capacityHours = cap.weeklyHours * periodWeeks
    const totalLogged = bucket.billable + bucket.nonBillable
    const utilization = capacityHours > 0 ? bucket.billable / capacityHours : 0
    return {
      userId: cap.userId,
      capacityHours,
      billableHours: round2(bucket.billable),
      nonBillableHours: round2(bucket.nonBillable),
      totalLoggedHours: round2(totalLogged),
      utilization: round3(utilization),
      benchHours: round2(capacityHours - totalLogged),
      billableRevenue: round2(bucket.revenue),
    }
  })
}

/**
 * Status banding tuned for B2B services firms (matches Accenture / Deloitte
 * industry bands — 90% is target, not red):
 *   - <40%      under-utilised — too much bench, sales gap risk
 *   - 40-85%    healthy
 *   - 85-100%   high — target band for senior consultants
 *   - >100%     over-utilised — sustained overtime, burnout risk
 *   - 0 hours logged → bench
 */
export function classifyUtilization(summary: UtilizationSummary): UtilizationStatus {
  if (summary.totalLoggedHours === 0) {
    return { userId: summary.userId, utilization: summary.utilization, status: "bench" }
  }
  const u = summary.utilization
  let status: UtilizationStatus["status"]
  if (u > 1.0) status = "over_utilized"
  else if (u >= 0.85) status = "high"
  else if (u >= 0.4) status = "healthy"
  else status = "underutilized"
  return { userId: summary.userId, utilization: u, status }
}

/**
 * Aggregate firm-level metrics from per-user summaries. Used by exec
 * dashboard widgets in slice 2.
 */
export interface FirmUtilizationRollup {
  totalCapacityHours: number
  totalBillableHours: number
  totalNonBillableHours: number
  totalBenchHours: number
  totalBillableRevenue: number
  /** Weighted average utilization across all users (billable / capacity). */
  averageUtilization: number
  userCount: number
}

export function rollupFirm(summaries: UtilizationSummary[]): FirmUtilizationRollup {
  // Note: inputs are already round2'd per-user (computeUtilization); rounding
  // again here is a one-step precision loss. For tiny test inputs this is
  // invisible; only relevant when summing thousands of users — single round
  // at the final step keeps cumulative drift below half a cent per metric.
  const totals = summaries.reduce(
    (acc, s) => ({
      capacity: acc.capacity + s.capacityHours,
      billable: acc.billable + s.billableHours,
      nonBillable: acc.nonBillable + s.nonBillableHours,
      bench: acc.bench + s.benchHours,
      revenue: acc.revenue + s.billableRevenue,
    }),
    { capacity: 0, billable: 0, nonBillable: 0, bench: 0, revenue: 0 }
  )
  return {
    totalCapacityHours: round2(totals.capacity),
    totalBillableHours: round2(totals.billable),
    totalNonBillableHours: round2(totals.nonBillable),
    totalBenchHours: round2(totals.bench),
    totalBillableRevenue: round2(totals.revenue),
    averageUtilization: totals.capacity > 0 ? round3(totals.billable / totals.capacity) : 0,
    userCount: summaries.length,
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
function round3(n: number): number { return Math.round(n * 1000) / 1000 }
