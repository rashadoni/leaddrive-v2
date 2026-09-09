/**
 * C5 Account Engagement — Phase 3: score-snapshot history read.
 *
 * GET /api/v1/account-score-snapshots?marketingAccountId=<id>&limit=<n>
 *
 * Returns the time-ordered engagement-score / grade snapshots the recompute
 * cron writes — the data behind an account's score trend / sparkline. Scoped
 * to one account when `marketingAccountId` is given, else the whole tenant.
 * Tenant-scoped. RBAC: account-engagement:read.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const MAX_LIMIT = 200

export const GET = withRlsAuth(
  "account-engagement",
  "read",
  async (req: NextRequest, auth) => {
    const orgId = auth.orgId
    const { searchParams } = new URL(req.url)
    const marketingAccountId = searchParams.get("marketingAccountId") || undefined

    const limitRaw = parseInt(searchParams.get("limit") || "50", 10)
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
      : 50

    try {
      const where: { organizationId: string; marketingAccountId?: string } = {
        organizationId: orgId,
      }
      if (marketingAccountId) where.marketingAccountId = marketingAccountId

      const snapshots = await prisma.accountScoreSnapshot.findMany({
        where,
        orderBy: { snapshotAt: "desc" },
        take: limit,
        select: {
          id: true,
          marketingAccountId: true,
          snapshotAt: true,
          engagementScore: true,
          grade: true,
          icpTier: true,
          lifecycleStage: true,
          signalCounts: true,
          rationale: true,
        },
      })

      return NextResponse.json({
        snapshots,
        count: snapshots.length,
        marketingAccountId: marketingAccountId ?? null,
      })
    } catch (err) {
      console.error("[account-score-snapshots] GET error:", err)
      return NextResponse.json(
        { error: "Failed to load score snapshots" },
        { status: 500 },
      )
    }
  },
)
