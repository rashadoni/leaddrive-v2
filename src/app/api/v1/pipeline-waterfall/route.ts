/**
 * A12 Pipeline Waterfall — slice-2 API route.
 *
 * GET /api/v1/pipeline-waterfall?days=30&pipelineId=<optional>
 *
 * Reads `pipeline_stage_transitions` for the given period, runs the
 * slice-1 `analyzeWaterfall` helper, returns bucketed analysis.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import {
  analyzeWaterfall,
  topMovingBuckets,
} from "@/lib/revenue-intelligence/waterfall-analyzer"
import type { WaterfallTransition } from "@/lib/revenue-intelligence/types"
import { decimalToNumber, decimalToNumberNullable } from "@/lib/prisma-decimal"

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)

  // Defensive parse — ?days=abc would crash without this.
  // `days=all` → all-time window (shows every recorded transition, incl.
  // backfilled historical outcomes whose real date predates 180d).
  const rawDaysParam = searchParams.get("days") || "30"
  const allTime = rawDaysParam === "all"
  const rawDays = parseInt(rawDaysParam, 10)
  const days =
    Number.isFinite(rawDays) && rawDays >= 1 && rawDays <= 365 ? rawDays : 30

  const pipelineId = searchParams.get("pipelineId") || undefined

  const periodEnd = new Date()
  const periodStart = allTime
    ? new Date(0) // epoch — no lower bound
    : new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000)

  try {
    const where: {
      organizationId: string
      transitionedAt: { gte: Date; lte: Date }
      pipelineId?: string
    } = {
      organizationId: orgId,
      transitionedAt: { gte: periodStart, lte: periodEnd },
    }
    if (pipelineId) where.pipelineId = pipelineId

    const rows = await prisma.pipelineStageTransition.findMany({
      where,
      select: {
        id: true,
        dealId: true,
        fromStage: true,
        toStage: true,
        fromAmount: true,
        toAmount: true,
        transitionType: true,
        transitionedAt: true,
        durationInPrevStageSeconds: true,
      },
      orderBy: { transitionedAt: "asc" },
    })

    const transitions: WaterfallTransition[] = rows.map(
      (r: {
        id: string
        dealId: string
        fromStage: string | null
        toStage: string
        fromAmount: unknown
        toAmount: unknown
        transitionType: string
        transitionedAt: Date
        durationInPrevStageSeconds: number | null
      }) => ({
        transitionId: r.id,
        dealId: r.dealId,
        fromStage: r.fromStage,
        toStage: r.toStage,
        fromAmount: decimalToNumberNullable(r.fromAmount),
        toAmount: decimalToNumber(r.toAmount),
        transitionType: r.transitionType as WaterfallTransition["transitionType"],
        transitionedAt: r.transitionedAt,
        durationInPrevStageSeconds: r.durationInPrevStageSeconds,
      }),
    )

    const analysis = analyzeWaterfall({ transitions, periodStart, periodEnd })
    const top = topMovingBuckets(analysis, 3)

    return NextResponse.json({
      periodStart,
      periodEnd,
      days: allTime ? "all" : days,
      pipelineId: pipelineId ?? null,
      analysis,
      topMovers: top,
    })
  } catch (err) {
    console.error("[pipeline-waterfall] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load waterfall" },
      { status: 500 },
    )
  }
})
