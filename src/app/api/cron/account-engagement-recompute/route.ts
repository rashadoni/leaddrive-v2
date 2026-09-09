/**
 * C5 Account Engagement — Phase 3: score/grade recompute cron.
 *
 * Recomputes every MarketingAccount's engagementScore (time-decayed intent
 * signals) and fit grade, persists them, and writes one AccountScoreSnapshot
 * per account so the trend is preserved. Closes the loop: Phase 1 creates
 * accounts, Phase 2 ingests signals, this turns signals into the score the
 * HeatMap / CompanyTree read.
 *
 * Schedule via scripts/install-engagement-crons.sh (daily). Triggerable
 * manually post-deploy with the CRON_SECRET to populate scores immediately.
 *
 * Batched (500) + per-org grade-weight cache; signals loaded once per batch.
 * Idempotent in effect — same signals + config → same score/grade (re-runs
 * just append another snapshot point).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import {
  recomputeAccount,
  type RecomputeSignal,
} from "@/lib/account-engagement/recompute-account-score"
import {
  loadAccountGradeWeights,
  type AccountGradeWeights,
} from "@/lib/account-engagement/config-loader"

const BATCH_SIZE = 500
/** Signals older than this can't contribute (calculator drops > 5×halfLife ≈ 70d). */
const SIGNAL_WINDOW_DAYS = 90

type AccountRow = {
  id: string
  organizationId: string
  icpTier: string
  employeeBand: string | null
  industrySlug: string | null
  annualRevenueUsd: bigint | null
  lifecycleStage: string
}
type SignalRow = {
  marketingAccountId: string
  signalKind: string
  weight: number
  occurredAt: Date
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    try {
      const asOf = new Date()
      const since = new Date(asOf.getTime() - SIGNAL_WINDOW_DAYS * 86_400_000)
      const weightsByOrg = new Map<string, AccountGradeWeights>()
      let skip = 0
      let accountsUpdated = 0
      let snapshotsWritten = 0

      while (true) {
        const accounts = (await prisma.marketingAccount.findMany({
          select: {
            id: true,
            organizationId: true,
            icpTier: true,
            employeeBand: true,
            industrySlug: true,
            annualRevenueUsd: true,
            lifecycleStage: true,
          },
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
          skip,
        })) as AccountRow[]

        if (accounts.length === 0) break

        const accountIds = accounts.map((a) => a.id)
        const signals = (await prisma.accountIntentSignal.findMany({
          where: {
            marketingAccountId: { in: accountIds },
            occurredAt: { gte: since },
          },
          select: {
            marketingAccountId: true,
            signalKind: true,
            weight: true,
            occurredAt: true,
          },
        })) as SignalRow[]

        const signalsByAccount = new Map<string, RecomputeSignal[]>()
        for (const s of signals) {
          const list = signalsByAccount.get(s.marketingAccountId)
          const sig: RecomputeSignal = {
            signalKind: s.signalKind,
            weight: s.weight,
            occurredAt: s.occurredAt,
          }
          if (list) list.push(sig)
          else signalsByAccount.set(s.marketingAccountId, [sig])
        }

        const updates: Prisma.PrismaPromise<unknown>[] = []
        const snapshotRows: Prisma.AccountScoreSnapshotCreateManyInput[] = []

        for (const a of accounts) {
          let weights = weightsByOrg.get(a.organizationId)
          if (!weights) {
            weights = await loadAccountGradeWeights(a.organizationId)
            weightsByOrg.set(a.organizationId, weights)
          }

          const result = recomputeAccount(
            {
              icpTier: a.icpTier,
              employeeBand: a.employeeBand,
              industrySlug: a.industrySlug,
              annualRevenueUsd:
                a.annualRevenueUsd != null ? Number(a.annualRevenueUsd) : null,
            },
            signalsByAccount.get(a.id) ?? [],
            weights,
            asOf,
          )

          updates.push(
            prisma.marketingAccount.update({
              where: { id: a.id },
              data: {
                engagementScore: result.engagementScore,
                grade: result.grade,
                ...(result.lastSignalAt ? { lastSignalAt: result.lastSignalAt } : {}),
              },
            }),
          )
          snapshotRows.push({
            organizationId: a.organizationId,
            marketingAccountId: a.id,
            snapshotAt: asOf,
            engagementScore: result.engagementScore,
            grade: result.grade,
            icpTier: a.icpTier,
            lifecycleStage: a.lifecycleStage,
            signalCounts: result.signalCounts as Prisma.InputJsonValue,
            rationale: result.rationale,
          })
          accountsUpdated++
        }

        if (updates.length > 0) await prisma.$transaction(updates)
        if (snapshotRows.length > 0) {
          await prisma.accountScoreSnapshot.createMany({ data: snapshotRows })
          snapshotsWritten += snapshotRows.length
        }

        skip += BATCH_SIZE
        if (accounts.length < BATCH_SIZE) break
      }

      return NextResponse.json({
        success: true,
        data: { accountsUpdated, snapshotsWritten },
      })
    } catch (error) {
      console.error("[Cron] account-engagement-recompute error:", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}
