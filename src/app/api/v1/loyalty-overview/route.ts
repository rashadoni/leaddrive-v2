/**
 * D8 Loyalty — slice-2 API.
 *
 * GET /api/v1/loyalty-overview
 *
 * Three streams:
 *   1. Tier distribution (count of accounts per tier + null/unassigned)
 *   2. Top 10 accounts by lifetime points (joined to contact for display)
 *   3. Last-30d transaction summary: earn total, redeem total, expire,
 *      adjustment net; and last 20 transaction rows.
 *
 * Sort: top accounts by lifetimePoints DESC, recent transactions by
 * createdAt DESC.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

interface AccountRow {
  id: string
  contactId: string
  points: number
  lifetimePoints: number
  tier: string | null
  tierUpgradedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface TxnRow {
  id: string
  loyaltyAccountId: string
  type: string
  delta: number
  createdAt: Date
}

const FETCH_CAP_TXNS = 500
const TOP_N = 10
const RECENT_TX_COUNT = 20
const THIRTY_DAYS_MS = 30 * 86_400_000

export const GET = withRls(async (_req, { orgId }) => {

  try {
    // Tier distribution — single groupBy.
    interface TierGroupRow {
      tier: string | null
      _count: { _all: number }
      _sum: { points: number | null; lifetimePoints: number | null }
    }
    const tierCounts = (await prisma.loyaltyAccount.groupBy({
      by: ["tier"],
      where: { organizationId: orgId },
      _count: { _all: true },
      _sum: { points: true, lifetimePoints: true },
    })) as TierGroupRow[]
    interface TierBucket {
      tier: string
      accountCount: number
      totalPoints: number
      totalLifetimePoints: number
    }
    const tierDistribution: TierBucket[] = tierCounts.map((row) => ({
      tier: row.tier ?? "unassigned",
      accountCount: row._count._all,
      totalPoints: row._sum.points ?? 0,
      totalLifetimePoints: row._sum.lifetimePoints ?? 0,
    }))
    tierDistribution.sort(
      (a: TierBucket, b: TierBucket) =>
        b.totalLifetimePoints - a.totalLifetimePoints ||
        a.tier.localeCompare(b.tier),
    )

    // Top accounts by lifetime points.
    const topAccounts = (await prisma.loyaltyAccount.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        contactId: true,
        points: true,
        lifetimePoints: true,
        tier: true,
        tierUpgradedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      // Deterministic tiebreaker: when two accounts have identical
      // lifetimePoints + points, order by createdAt asc so the top-10
      // list is stable across reloads (Prisma row-order otherwise).
      orderBy: [
        { lifetimePoints: "desc" },
        { points: "desc" },
        { createdAt: "asc" },
      ],
      take: TOP_N,
    })) as AccountRow[]
    const contactIds = topAccounts.map((a) => a.contactId)
    const contacts =
      contactIds.length > 0
        ? await prisma.contact.findMany({
            where: { organizationId: orgId, id: { in: contactIds } },
            select: { id: true, fullName: true, email: true },
          })
        : []
    const contactById = new Map<
      string,
      { fullName: string | null; email: string | null }
    >()
    for (const c of contacts) {
      contactById.set(c.id, {
        fullName: c.fullName,
        email: c.email,
      })
    }
    const topAccountsOut = topAccounts.map((a) => {
      const c = contactById.get(a.contactId)
      const name = c ? c.fullName?.trim() || c.email || null : null
      return {
        id: a.id,
        contactId: a.contactId,
        contactName: name,
        contactEmail: c?.email ?? null,
        points: a.points,
        lifetimePoints: a.lifetimePoints,
        tier: a.tier,
        tierUpgradedAt: a.tierUpgradedAt,
      }
    })

    // Total account count (separate small query — groupBy returned at most
    // a handful of rows, so we don't double-count from there).
    const totalAccounts = await prisma.loyaltyAccount.count({
      where: { organizationId: orgId },
    })

    // 30-day transaction summary.
    // Get the true tx count first — the capped findMany below would
    // mis-report `totalTransactions` when > FETCH_CAP_TXNS rows exist.
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS)
    const total30dTxns = await prisma.loyaltyTransaction.count({
      where: { organizationId: orgId, createdAt: { gte: cutoff } },
    })
    const txns = (await prisma.loyaltyTransaction.findMany({
      where: {
        organizationId: orgId,
        createdAt: { gte: cutoff },
      },
      select: {
        id: true,
        loyaltyAccountId: true,
        type: true,
        delta: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: FETCH_CAP_TXNS + 1,
    })) as TxnRow[]
    const txnsTruncated = txns.length > FETCH_CAP_TXNS
    if (txnsTruncated) txns.length = FETCH_CAP_TXNS

    // Sign convention: redeem/expire/adjustment_debit deltas are
    // already negative in the DB. Report all category totals as
    // POSITIVE magnitudes (absolute values) so the dashboard reads
    // "Earned: +5000 / Redeemed: 2000" instead of "+5000 / -2000".
    // Adjustment is reported as a signed net since credit/debit cancel.
    const totals = {
      earn: 0,
      redeem: 0,
      expire: 0,
      adjustmentNet: 0,
      totalTransactions: total30dTxns,
    }
    for (const t of txns) {
      if (t.type === "earn") totals.earn += Math.abs(t.delta)
      else if (t.type === "redeem") totals.redeem += Math.abs(t.delta)
      else if (t.type === "expire") totals.expire += Math.abs(t.delta)
      else if (
        t.type === "adjustment_credit" ||
        t.type === "adjustment_debit"
      ) {
        totals.adjustmentNet += t.delta
      }
    }

    const recentTxns = txns.slice(0, RECENT_TX_COUNT)

    return NextResponse.json({
      totalAccounts,
      tierDistribution,
      topAccounts: topAccountsOut,
      thirtyDayTotals: totals,
      recentTransactions: recentTxns,
      txnsTruncated,
      fetchCap: FETCH_CAP_TXNS,
    })
  } catch (err) {
    console.error("[loyalty-overview] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load loyalty overview" },
      { status: 500 },
    )
  }
})
