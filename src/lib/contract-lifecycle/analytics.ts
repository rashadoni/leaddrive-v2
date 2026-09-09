/**
 * CLM Slice 7b — Shared contract analytics computation.
 *
 * `computeContractAnalytics(orgId, opts?)` runs all 11 Prisma queries in
 * parallel and returns the same shape as the GET /api/v1/contract-analytics
 * response object (minus the wrapping NextResponse). The analytics route and
 * the new XLSX export route both call this function — single source of truth,
 * no drift.
 *
 * Money / float guard:
 *   Total value sums use Prisma aggregate({ _sum: { valueAmount: true } }) →
 *   Prisma.Decimal → serialised as .toFixed(2) string. MRR is computed in
 *   integer cents per-contract and only divided at the end.
 */

import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"

// Statuses treated as "live" (currently in force or in an active renewal flow).
// `approved` is awaiting signature/activation, so it is not live value.
const LIVE_STATUSES = ["active", "renewing"]

// Statuses considered "final" for renewal-rate denominator
// (used implicitly via renewedCount + expiredCount)

export interface ComputeAnalyticsOptions {
  /** ISO-8601 string — filter createdAt >= from */
  from?: Date
  /** ISO-8601 string — filter createdAt <= to */
  to?: Date
}

export interface AnalyticsSummary {
  liveCount: number
  totalValue: string   // decimal string, e.g. "99999.99"
  mrr: number
  avgCycleTimeDays: number | null
  renewalRate: number | null // 0–100, null when no final-state contracts
  expiringSoon: number
  openDeviations: number
  renewedCount: number
  expiredCount: number
}

export interface ByTypeRow {
  type: string
  count: number
  totalValue: string // decimal string
}

export interface CohortRow {
  period: string // e.g. "2026-Q3"
  count: number
  value: number
}

export interface ApprovalFlowRow {
  status: string
  count: number
}

export interface DeviationRiskRow {
  severity: string
  count: number
}

export interface ContractAnalyticsResult {
  summary: AnalyticsSummary
  byType: ByTypeRow[]
  cohorts: CohortRow[]
  approvalFlow: ApprovalFlowRow[]
  deviationRisk: DeviationRiskRow[]
  generatedAt: string // ISO-8601
}

const FUNNEL_ORDER = [
  "draft",
  "pending_approval",
  "approved",
  "active",
  "renewing",
  "renewed",
  "expired",
  "terminated",
  "rejected",
  "cancelled",
]

const SEVERITY_ORDER = ["critical", "warning", "info"]

export async function computeContractAnalytics(
  orgId: string,
  opts: ComputeAnalyticsOptions = {},
): Promise<ContractAnalyticsResult> {
  const { from, to } = opts

  const dateFilter =
    from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}

  const now = new Date()
  const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const [
    liveAgg,
    liveContracts,
    signedCycleSample,
    renewedCount,
    expiredCount,
    expiringSoonCount,
    openDeviationCount,
    byTypeGroups,
    statusGroups,
    deviationRiskGroups,
    cohortRaw,
  ] = await Promise.all([
    // 1. Total value of live contracts (Prisma _sum → Decimal — safe)
    prisma.contract.aggregate({
      where: { organizationId: orgId, status: { in: LIVE_STATUSES }, ...dateFilter },
      _sum: { valueAmount: true },
      _count: { id: true },
    }),

    // 2. Live contracts with startDate + endDate + valueAmount for MRR calc
    prisma.contract.findMany({
      where: { organizationId: orgId, status: { in: LIVE_STATUSES } },
      select: { startDate: true, endDate: true, valueAmount: true, currency: true },
    }),

    // 3. Signed contracts' (createdAt, signedAt) for avg cycle time
    prisma.contract.findMany({
      where: {
        organizationId: orgId,
        signedAt: { not: null },
        ...dateFilter,
      },
      select: { createdAt: true, signedAt: true },
      take: 500, // cap sample size — avg is stable well before 500
    }),

    // 4. Renewed contracts count (renewal-rate numerator)
    prisma.contract.count({
      where: { organizationId: orgId, status: "renewed", ...dateFilter },
    }),

    // 5. Expired contracts count (renewal-rate denominator complement)
    prisma.contract.count({
      where: { organizationId: orgId, status: "expired", ...dateFilter },
    }),

    // 6. Live contracts expiring within 30 days
    prisma.contract.count({
      where: {
        organizationId: orgId,
        status: { in: LIVE_STATUSES },
        endDate: { gte: now, lte: thirtyDaysAhead },
      },
    }),

    // 7. Open deviation flags (status = "flagged")
    prisma.contractDeviationFlag.count({
      where: { organizationId: orgId, status: "flagged" },
    }),

    // 8. by-type: count + value for live contracts
    prisma.contract.groupBy({
      by: ["type"],
      where: { organizationId: orgId, status: { in: LIVE_STATUSES } },
      _count: { id: true },
      _sum: { valueAmount: true },
      orderBy: { _count: { id: "desc" } },
    }),

    // 9. Approval funnel: count by status
    prisma.contract.groupBy({
      by: ["status"],
      where: { organizationId: orgId, ...dateFilter },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),

    // 10. Deviation risk: open flags by severity
    prisma.contractDeviationFlag.groupBy({
      by: ["severity"],
      where: { organizationId: orgId, status: "flagged" },
      _count: { id: true },
    }),

    // 11. Expiry cohorts: contracts expiring in next 12 months
    prisma.contract.findMany({
      where: {
        organizationId: orgId,
        endDate: {
          gte: now,
          lte: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
        },
      },
      select: { endDate: true, valueAmount: true },
    }),
  ])

  // ── Summary ──────────────────────────────────────────────────────────────────
  const liveCount = liveAgg._count.id

  const totalValueDecimal = liveAgg._sum.valueAmount
  const totalValueStr =
    totalValueDecimal != null
      ? (totalValueDecimal as unknown as { toFixed(n: number): string }).toFixed(2)
      : "0.00"

  // MRR: per-contract monthly value in integer cents
  let mrrCents = 0
  for (const c of liveContracts) {
    if (!c.valueAmount) continue
    const amountCents = Math.round(decimalToNumber(c.valueAmount) * 100)
    let months = 1
    if (c.startDate && c.endDate) {
      const ms = c.endDate.getTime() - c.startDate.getTime()
      months = Math.max(1, ms / (30.44 * 24 * 60 * 60 * 1000))
    }
    mrrCents += Math.round(amountCents / months)
  }
  const mrr = Math.round((mrrCents / 100) * 100) / 100

  // Avg cycle time in days (createdAt → signedAt)
  let avgCycleTimeDays: number | null = null
  if (signedCycleSample.length > 0) {
    const totalMs = signedCycleSample.reduce(
      (acc: number, c: { createdAt: Date; signedAt: Date | null }) => {
        const ms =
          (c.signedAt?.getTime() ?? c.createdAt.getTime()) - c.createdAt.getTime()
        return acc + Math.max(0, ms)
      },
      0,
    )
    avgCycleTimeDays = Math.round(totalMs / signedCycleSample.length / 86_400_000)
  }

  // Renewal rate: renewed / (renewed + expired)
  const denominator = renewedCount + expiredCount
  const renewalRate: number | null =
    denominator > 0 ? Math.round((renewedCount / denominator) * 1000) / 10 : null

  const summary: AnalyticsSummary = {
    liveCount,
    totalValue: totalValueStr,
    mrr,
    avgCycleTimeDays,
    renewalRate,
    expiringSoon: expiringSoonCount,
    openDeviations: openDeviationCount,
    renewedCount,
    expiredCount,
  }

  // ── By-type ──────────────────────────────────────────────────────────────────
  type ByTypeGroup = {
    type: string
    _count: { id: number }
    _sum: { valueAmount: unknown }
  }
  const byType: ByTypeRow[] = (byTypeGroups as ByTypeGroup[]).map((g) => ({
    type: g.type ?? "unknown",
    count: g._count.id,
    totalValue:
      g._sum.valueAmount != null
        ? (g._sum.valueAmount as { toFixed(n: number): string }).toFixed(2)
        : "0.00",
  }))

  // ── Expiry cohorts — bucket by calendar quarter (YYYY-Qn) ───────────────────
  const cohortMap: Record<string, { count: number; valueCents: number }> = {}
  for (const c of cohortRaw) {
    if (!c.endDate) continue
    const d = c.endDate
    const q = Math.floor(d.getMonth() / 3) + 1
    const key = `${d.getFullYear()}-Q${q}`
    if (!cohortMap[key]) cohortMap[key] = { count: 0, valueCents: 0 }
    cohortMap[key].count++
    if (c.valueAmount) {
      cohortMap[key].valueCents += Math.round(decimalToNumber(c.valueAmount) * 100)
    }
  }
  const cohorts: CohortRow[] = Object.entries(cohortMap)
    .map(([period, v]) => ({
      period,
      count: v.count,
      value: Math.round(v.valueCents) / 100,
    }))
    .sort((a, b) => a.period.localeCompare(b.period))

  // ── Approval funnel — counts by status ──────────────────────────────────────
  const statusCountMap: Record<string, number> = {}
  for (const g of statusGroups) {
    statusCountMap[g.status] = g._count.id
  }
  const approvalFlow: ApprovalFlowRow[] = FUNNEL_ORDER.map((status) => ({
    status,
    count: statusCountMap[status] ?? 0,
  })).filter((s) => s.count > 0)

  // ── Deviation risk — open flags by severity ──────────────────────────────────
  const sevCountMap: Record<string, number> = {}
  for (const g of deviationRiskGroups) {
    sevCountMap[g.severity] = g._count.id
  }
  const deviationRisk: DeviationRiskRow[] = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: sevCountMap[severity] ?? 0,
  }))

  return {
    summary,
    byType,
    cohorts,
    approvalFlow,
    deviationRisk,
    generatedAt: now.toISOString(),
  }
}
