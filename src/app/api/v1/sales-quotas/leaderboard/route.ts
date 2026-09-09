/**
 * GET /api/v1/sales-quotas/leaderboard?year=&quarter=
 *
 * Returns reps ranked by attainment percent for the given quarter. Drives the
 * sales-team leaderboard widget on the forecast dashboard.
 *
 * Response: { period: {year, quarter}, leaderboard: LeaderboardEntry[], totals }
 *
 * Defaults: current year + current quarter when query params omitted.
 *
 * Part of A4 Quota Management deep + leaderboards.
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { buildLeaderboard, quarterBoundaries } from "@/lib/quota-engine"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

/**
 * Shape of `salesQuota.findMany({ include: { user: ... } })` result.
 * Prisma's generated types are loose at the include seam (tsc widens to
 * `any` without an explicit annotation), so we declare what we need locally.
 */
type QuotaWithUser = {
  id: string
  userId: string
  year: number
  quarter: number
  amount: number
  currency: string
  user: { id: string; name: string; isActive: boolean }
}

function currentQuarter(now: Date = new Date()): number {
  return Math.floor(now.getMonth() / 3) + 1
}

export const GET = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const now = new Date()
  const year = parseInt(req.nextUrl.searchParams.get("year") || String(now.getFullYear()), 10)
  const quarter = parseInt(req.nextUrl.searchParams.get("quarter") || String(currentQuarter(now)), 10)

  // Guard NaN explicitly — `NaN < 1` and `NaN > 4` are both false, slipping past
  // a naive range check. Year bounded 1970-2200 (reasonable business window).
  if (
    !Number.isFinite(year) || year < 1970 || year > 2200 ||
    !Number.isFinite(quarter) || quarter < 1 || quarter > 4
  ) {
    return NextResponse.json({ error: "Invalid year or quarter" }, { status: 400 })
  }

  // Pull every quota for the period + the user behind it
  const quotas: QuotaWithUser[] = await prisma.salesQuota.findMany({
    where: { organizationId: orgId, year, quarter },
    include: { user: { select: { id: true, name: true, isActive: true } } },
  })

  if (quotas.length === 0) {
    return NextResponse.json({
      period: { year, quarter },
      leaderboard: [],
      totals: { quotaSum: 0, actualSum: 0, attainmentPercent: 0 },
    })
  }

  // Aggregate won deals per user in this quarter — single grouped query
  const { start, end } = quarterBoundaries(year, quarter)
  // KNOWN PRE-EXISTING BUG (mirrored from src/app/api/v1/sales-quotas/route.ts:28):
  // Bucketing won-deals by `updatedAt` causes any edit to a closed deal months
  // later to silently re-bucket it into a new quarter. The Deal model has a
  // dedicated `stageChangedAt` field (schema.prisma:403) that should be used
  // here. Slice 2 fix: replace `updatedAt` → `stageChangedAt` across both
  // routes + backfill historic deals.
  /*
   * Written-down stage spellings, not the literal "WON": `Deal.stage` is a free
   * string and production holds `CLOSED_WON` beside `WON`, so a literal filter
   * credits that deal to nobody.
   */
  const { wonStages } = await orgStageVocabulary(orgId)
  const wonGroups = await prisma.deal.groupBy({
    by: ["assignedTo"],
    where: {
      organizationId: orgId,
      stage: { in: wonStages },
      assignedTo: { in: quotas.map(q => q.userId) },
      updatedAt: { gte: start, lte: end },
    },
    _sum: { valueAmount: true },
  })
  const actualsByUser = new Map<string, number>()
  for (const g of wonGroups) {
    if (g.assignedTo) actualsByUser.set(g.assignedTo, decimalToNumber(g._sum.valueAmount))
  }

  const leaderboard = buildLeaderboard(
    quotas.map(q => ({
      quota: {
        id: q.id,
        userId: q.userId,
        year: q.year,
        quarter: q.quarter,
        amount: q.amount,
        currency: q.currency,
      },
      actualAmount: actualsByUser.get(q.userId) ?? 0,
      userName: q.user.name,
    })),
    now
  )

  const quotaSum = quotas.reduce((s, q) => s + q.amount, 0)
  const actualSum = Array.from(actualsByUser.values()).reduce((s, v) => s + v, 0)
  const attainmentPercent = quotaSum > 0
    ? Math.round((actualSum / quotaSum) * 1000) / 10
    : 0

  return NextResponse.json({
    period: { year, quarter },
    leaderboard,
    totals: { quotaSum, actualSum, attainmentPercent },
  })
})
