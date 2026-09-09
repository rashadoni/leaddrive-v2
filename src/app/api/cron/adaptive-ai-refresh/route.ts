import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { aggregateFeedback, type FeedbackRow } from "@/lib/adaptive-ai/feedback-aggregator"
import { PREDICTION_TYPES, type PredictionType } from "@/lib/adaptive-ai/types"

/**
 * A9 Adaptive AI Models — slice-3 refresh cron.
 *
 * For every (org × predictionType) walks the AiFeedback rows and
 * runs `aggregateFeedback`. The result is upserted into
 * `ai_prediction_adjustments` keyed on (organizationId, predictionType).
 *
 * Read by prediction engines via `getAdjustment` /
 * `applyAdjustment` (see `src/lib/adaptive-ai/adjustments.ts`).
 *
 * Auth: `x-cron-secret` / `Authorization: Bearer <secret>` against
 * `CRON_SECRET` env var — mirrors content-perf-refresh + proactive-refresh.
 *
 * Cadence: external scheduler. Recommended hourly or daily depending on
 * tenant feedback volume. Idempotent — the upsert preserves the row
 * identity but refreshes every metric column.
 *
 * Cost model: O(orgs × predictionTypes × feedbackRowsPerOrg). The
 * underlying findMany hits the `(organizationId, predictionType,
 * createdAt)` index so the per-(org, type) scan is fast even at high
 * cardinality; the 10k take cap inside the aggregator's row query
 * mirrors the slice-2 aggregate route ceiling.
 */

const AGGREGATE_TAKE_CEILING = 10_000

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const startedAt = Date.now()
  const summary = {
    organizationsScanned: 0,
    adjustmentsUpserted: 0,
    skippedNoFeedback: 0,
    errors: [] as string[],
  }

  try {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    for (const org of orgs) {
      summary.organizationsScanned++
      for (const predictionType of PREDICTION_TYPES) {
        try {
          await processOrgAndType(org.id, predictionType, summary)
        } catch (e) {
          summary.errors.push(
            `${org.id}/${predictionType}: ${(e as Error).message}`,
          )
        }
      }
    }

    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startedAt,
      summary: { ...summary, errors: summary.errors.slice(0, 20) },
    })
  } catch (e) {
    console.error("[adaptive-ai-refresh] cron error:", e)
    return NextResponse.json(
      { error: "Internal server error", message: (e as Error).message },
      { status: 500 },
    )
  }
  })
}

type Summary = {
  organizationsScanned: number
  adjustmentsUpserted: number
  skippedNoFeedback: number
  errors: string[]
}

async function processOrgAndType(
  orgId: string,
  predictionType: PredictionType,
  summary: Summary,
) {
  const rows: { rating: number; predictionValue: string | null }[] = await prisma.aiFeedback.findMany({
    where: { organizationId: orgId, predictionType },
    select: { rating: true, predictionValue: true },
    take: AGGREGATE_TAKE_CEILING,
    orderBy: { createdAt: "desc" },
  })

  if (rows.length === 0) {
    summary.skippedNoFeedback++
    return
  }

  const feedbacks: FeedbackRow[] = rows.map((r) => ({
    rating: r.rating,
    predictionValue: r.predictionValue,
  }))
  const result = aggregateFeedback(feedbacks)

  await prisma.aiPredictionAdjustment.upsert({
    where: {
      organizationId_predictionType: { organizationId: orgId, predictionType },
    },
    create: {
      organizationId: orgId,
      predictionType,
      adjustmentFactor: result.adjustmentFactor,
      sampleSize: result.sampleSize,
      avgRating: result.avgRating,
      approvalRate: result.approvalRate,
      lastComputedAt: new Date(),
    },
    update: {
      adjustmentFactor: result.adjustmentFactor,
      sampleSize: result.sampleSize,
      avgRating: result.avgRating,
      approvalRate: result.approvalRate,
      lastComputedAt: new Date(),
    },
  })
  summary.adjustmentsUpserted++
}
