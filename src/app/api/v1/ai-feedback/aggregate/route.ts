import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { aggregateFeedback, type FeedbackRow } from "@/lib/adaptive-ai/feedback-aggregator"
import { PREDICTION_TYPES, type PredictionType } from "@/lib/adaptive-ai/types"
import { withRls } from "@/lib/with-rls"

/**
 * A9 Adaptive AI Models — slice-2 aggregate read.
 *
 * GET /api/v1/ai-feedback/aggregate?type=<predictionType>&since=<iso>&targetId=<id>
 *
 *   Returns FeedbackAggregateResult — sample size, vote counts,
 *   avgRating, approvalRate, adjustmentFactor. Used by:
 *     - Admin "model quality" dashboard (manager-facing UI in slice-2)
 *     - Slice-3 adaptive cron (cron path will read this directly via
 *       Prisma, not HTTP; the route is only for the UI)
 *
 *   Params:
 *     type       — required, must be one of PREDICTION_TYPES
 *     since      — optional ISO timestamp; if set, only feedbacks from
 *                  that moment forward are aggregated (slice-3 cron
 *                  uses last-run timestamp here)
 *     targetId   — optional; aggregate just feedback for a specific
 *                  prediction target (e.g. one deal's win-probability)
 *
 * Auth: session-only (same rationale as POST).
 */

export const GET = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const predictionType = searchParams.get("type")
  const sinceParam = searchParams.get("since")
  const targetId = searchParams.get("targetId") || undefined

  if (!predictionType) {
    return NextResponse.json({ error: "type query parameter is required" }, { status: 400 })
  }
  if (!PREDICTION_TYPES.includes(predictionType as PredictionType)) {
    return NextResponse.json(
      { error: `Unknown predictionType "${predictionType}"` },
      { status: 400 },
    )
  }

  let since: Date | undefined
  if (sinceParam) {
    const parsed = new Date(sinceParam)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "since must be a valid ISO timestamp" },
        { status: 400 },
      )
    }
    since = parsed
  }

  try {
    const rows: { rating: number; predictionValue: string | null }[] = await prisma.aiFeedback.findMany({
      where: {
        organizationId: orgId,
        predictionType: predictionType as PredictionType,
        ...(targetId ? { predictionTargetId: targetId } : {}),
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      select: { rating: true, predictionValue: true },
      // Defensive ceiling: aggregation is O(n) and the typical cron
      // window keeps rows bounded, but a UI client that calls without
      // `since` against a high-traffic tenant could otherwise load
      // tens of thousands of rows into RAM. 10k samples is more than
      // enough to saturate the confidence-credit dampening, so the
      // truncation here doesn't meaningfully bias adjustmentFactor.
      take: 10_000,
      orderBy: { createdAt: "desc" },
    })

    const feedbacks: FeedbackRow[] = rows.map((r) => ({
      rating: r.rating,
      predictionValue: r.predictionValue,
    }))

    const result = aggregateFeedback(feedbacks)
    return NextResponse.json({
      success: true,
      data: { predictionType, since: sinceParam || null, targetId: targetId || null, ...result },
    })
  } catch (e) {
    console.error("[ai-feedback/aggregate] GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
