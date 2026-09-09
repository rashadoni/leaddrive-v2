/**
 * C5 Account Engagement — slice-2 API.
 *
 * GET /api/v1/account-engagement?stage=<lifecycleStage>&limit=<n>
 *
 * Lists MarketingAccount rows for the tenant, joined with last-30d intent
 * signal count. Sorted by engagementScore DESC, then grade ASC (A first).
 *
 * Hot-account heuristic: tier_1/tier_2 ICP with low engagementScore (<25)
 * AND zero recent signals → "stale-priority" flag. Bubbles to top so
 * marketing can re-engage their best-fit accounts that have gone quiet.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import {
  ACCOUNT_LIFECYCLE_STAGES,
  STALE_PRIORITY_SCORE_THRESHOLD,
} from "@/lib/account-engagement/types"

const VALID_STAGES = new Set<string>(ACCOUNT_LIFECYCLE_STAGES)

interface AccountRow {
  id: string
  accountName: string
  lifecycleStage: string
  icpTier: string
  engagementScore: number
  grade: string
  industrySlug: string | null
  employeeBand: string | null
  annualRevenueUsd: bigint | null
  lastSignalAt: Date | null
  updatedAt: Date
}

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const stage = searchParams.get("stage") || undefined
  if (stage && !VALID_STAGES.has(stage)) {
    return NextResponse.json(
      { error: "Invalid stage", validStages: Array.from(VALID_STAGES) },
      { status: 400 },
    )
  }
  const limitRaw = parseInt(searchParams.get("limit") || "50", 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50

  try {
    const where: { organizationId: string; lifecycleStage?: string } = {
      organizationId: orgId,
    }
    if (stage) where.lifecycleStage = stage

    const accounts = (await prisma.marketingAccount.findMany({
      where,
      select: {
        id: true,
        accountName: true,
        lifecycleStage: true,
        icpTier: true,
        engagementScore: true,
        grade: true,
        industrySlug: true,
        employeeBand: true,
        annualRevenueUsd: true,
        lastSignalAt: true,
        updatedAt: true,
      },
      orderBy: [{ engagementScore: "desc" }, { grade: "asc" }],
      take: limit,
    })) as AccountRow[]

    // Last-30d intent signal counts (grouped query — one round trip).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const accountIds = accounts.map((a) => a.id)
    const signalCounts = accountIds.length
      ? await prisma.accountIntentSignal.groupBy({
          by: ["marketingAccountId"],
          where: {
            organizationId: orgId,
            marketingAccountId: { in: accountIds },
            occurredAt: { gte: thirtyDaysAgo },
          },
          _count: { _all: true },
        })
      : []

    const signalsByAccount = new Map<string, number>()
    for (const row of signalCounts) {
      signalsByAccount.set(row.marketingAccountId, row._count._all)
    }

    // Per-stage totals (for filter chips with counts).
    // Intentionally ignores the active `stage` filter — chips need to show
    // ALL stage counts so a user can see what's in the buckets they're not
    // looking at right now and switch over.
    const stageTotals = await prisma.marketingAccount.groupBy({
      by: ["lifecycleStage"],
      where: { organizationId: orgId },
      _count: { _all: true },
    })

    const stageCounts: Record<string, number> = {}
    for (const s of ACCOUNT_LIFECYCLE_STAGES) stageCounts[s] = 0
    for (const row of stageTotals) {
      if (row.lifecycleStage in stageCounts) {
        stageCounts[row.lifecycleStage] = row._count._all
      }
    }

    const enriched = accounts.map((a) => {
      const recentSignals30d = signalsByAccount.get(a.id) ?? 0
      const isHighFit = a.icpTier === "tier_1" || a.icpTier === "tier_2"
      // Stale-priority: high-fit ICP, low score, no recent signals.
      // Marketing should re-engage these before chasing lukewarm tier_3+.
      const isStalePriority =
        isHighFit &&
        a.engagementScore < STALE_PRIORITY_SCORE_THRESHOLD &&
        recentSignals30d === 0
      return {
        id: a.id,
        accountName: a.accountName,
        lifecycleStage: a.lifecycleStage,
        icpTier: a.icpTier,
        engagementScore: a.engagementScore,
        grade: a.grade,
        industrySlug: a.industrySlug,
        employeeBand: a.employeeBand,
        annualRevenueUsd: a.annualRevenueUsd?.toString() ?? null,
        lastSignalAt: a.lastSignalAt,
        updatedAt: a.updatedAt,
        recentSignals30d,
        isStalePriority,
      }
    })

    // Stale-priority bubbles to top; then engagementScore desc; then
    // grade asc as deterministic tiebreaker (without this, equal-score
    // rows have Prisma's row-order — unstable across runs).
    enriched.sort((a, b) => {
      if (a.isStalePriority !== b.isStalePriority) return a.isStalePriority ? -1 : 1
      if (b.engagementScore !== a.engagementScore) {
        return b.engagementScore - a.engagementScore
      }
      return a.grade.localeCompare(b.grade)
    })

    return NextResponse.json({
      accounts: enriched,
      totalAccounts: enriched.length,
      stalePriorityCount: enriched.filter((a) => a.isStalePriority).length,
      stageCounts,
      filterStage: stage ?? null,
    })
  } catch (err) {
    console.error("[account-engagement] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load accounts" },
      { status: 500 },
    )
  }
})
