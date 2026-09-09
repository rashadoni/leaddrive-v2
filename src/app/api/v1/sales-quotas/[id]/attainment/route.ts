/**
 * GET /api/v1/sales-quotas/[id]/attainment
 *
 * Single quota with computed attainment + pacing. Powers the per-rep
 * "Quota Card" widget in the dashboard.
 *
 * Response: { quota, attainment, pacing }
 *
 * Part of A4 Quota Management deep.
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import {
  computeAttainment,
  computePacing,
  quarterBoundaries,
} from "@/lib/quota-engine"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const quota = await prisma.salesQuota.findFirst({
    where: { id, organizationId: orgId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  if (!quota) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Aggregate won deals for this user in this quarter.
  // KNOWN PRE-EXISTING BUG (mirrors sales-quotas/route.ts:28 and the leaderboard route):
  // Bucketing by `updatedAt` re-buckets WON deals on subsequent edits. Use
  // `Deal.stageChangedAt` (schema.prisma:403) instead — fixed across both new
  // routes + the sibling route in slice 2 along with a historic backfill.
  const { start, end } = quarterBoundaries(quota.year, quota.quarter)
  /*
   * Written-down stage spellings, not the literal "WON": `Deal.stage` is a free
   * string and production holds `CLOSED_WON` beside `WON`, so a literal filter
   * credits that deal to nobody.
   */
  const { wonStages } = await orgStageVocabulary(orgId)
  const wonAgg = await prisma.deal.aggregate({
    where: {
      organizationId: orgId,
      stage: { in: wonStages },
      assignedTo: quota.userId,
      updatedAt: { gte: start, lte: end },
    },
    _sum: { valueAmount: true },
  })

  const actualAmount = decimalToNumber(wonAgg._sum.valueAmount)
  const attainment = computeAttainment(
    { id: quota.id, userId: quota.userId, year: quota.year, quarter: quota.quarter, amount: quota.amount, currency: quota.currency },
    actualAmount
  )
  const pacing = computePacing(
    { id: quota.id, userId: quota.userId, year: quota.year, quarter: quota.quarter, amount: quota.amount, currency: quota.currency },
    actualAmount
  )

  return NextResponse.json({
    quota: {
      id: quota.id,
      userId: quota.userId,
      userName: quota.user.name,
      year: quota.year,
      quarter: quota.quarter,
      amount: quota.amount,
      currency: quota.currency,
    },
    attainment,
    pacing,
  })
})
