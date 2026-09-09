/**
 * A12 Deal Velocity — slice-2 API.
 *
 * GET /api/v1/deal-velocity?periodKey=last_30d&pipelineId=<optional>
 *
 * Reads `pipeline_stage_transitions` for the chosen window, groups by
 * (pipelineId, stage), runs slice-1 `aggregateVelocity` per group →
 * returns per-stage duration percentiles + bottleneck flags.
 *
 * Note: this is a live aggregator over raw transitions (not the
 * `deal_velocity_metrics` table). Slice-3 will swap to the materialized
 * table once the slice-2 cron worker exists.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { aggregateVelocity } from "@/lib/revenue-intelligence/velocity-aggregator"
import {
  VELOCITY_PERIOD_DAYS,
  type StageDurationSample,
  type VelocityPeriodKey,
} from "@/lib/revenue-intelligence/types"

interface TransitionRow {
  dealId: string
  fromStage: string | null
  pipelineId: string | null
  transitionType: string
  durationInPrevStageSeconds: number | null
  transitionedAt: Date
}

export const GET = withRls(async (req, { orgId, session }) => {

  const { searchParams } = new URL(req.url)
  const periodKey = (searchParams.get("periodKey") || "last_30d") as VelocityPeriodKey
  if (!Object.prototype.hasOwnProperty.call(VELOCITY_PERIOD_DAYS, periodKey)) {
    return NextResponse.json(
      { error: "Invalid periodKey", validKeys: Object.keys(VELOCITY_PERIOD_DAYS) },
      { status: 400 },
    )
  }
  const pipelineId = searchParams.get("pipelineId") || undefined

  const days = VELOCITY_PERIOD_DAYS[periodKey]
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000)

  try {
    const where: {
      organizationId: string
      transitionedAt: { gte: Date; lte: Date }
      pipelineId?: string
      fromStage?: { not: null }
      OR?: Array<{ reason: null } | { reason: { not: string } }>
    } = {
      organizationId: orgId,
      transitionedAt: { gte: periodStart, lte: periodEnd },
      fromStage: { not: null }, // 'created' transitions don't have fromStage
      // Exclude reconstructed backfill rows: they carry a fabricated fromStage
      // and null duration, so they'd inflate dealsEntered + skew conversionRate
      // without contributing real velocity timing. Null-safe (real transitions
      // have reason=null) — keeps every genuine event.
      // NOTE: exclude-by-known-tag. Any FUTURE non-null reason (e.g. a new
      // backfill/correction tag) would pass this filter and re-pollute velocity
      // — revisit this predicate whenever a new `reason` value is introduced.
      OR: [{ reason: null }, { reason: { not: "backfill:v1" } }],
    }
    if (pipelineId) where.pipelineId = pipelineId

    const rows = (await prisma.pipelineStageTransition.findMany({
      where,
      select: {
        dealId: true,
        fromStage: true,
        pipelineId: true,
        transitionType: true,
        durationInPrevStageSeconds: true,
        transitionedAt: true,
      },
    })) as TransitionRow[]

    const transitionedDealIds = [...new Set(rows.map((row) => row.dealId))]
    let visibleDealsWhere: any = {
      organizationId: orgId,
      id: { in: transitionedDealIds },
    }
    visibleDealsWhere = await applyRecordFilter(
      orgId,
      session?.userId || "",
      session?.role || "admin",
      "deal",
      visibleDealsWhere,
    )
    const visibleDeals = await prisma.deal.findMany({
      where: visibleDealsWhere,
      select: {
        id: true,
        name: true,
        assignedTo: true,
        valueAmount: true,
        currency: true,
        stage: true,
      },
    })
    const ownerIds = [...new Set(
      visibleDeals.map((deal) => deal.assignedTo).filter((id): id is string => Boolean(id)),
    )]
    const owners = ownerIds.length > 0
      ? await prisma.user.findMany({
          where: { organizationId: orgId, id: { in: ownerIds } },
          select: { id: true, name: true },
        })
      : []
    const ownerNameById = new Map(owners.map((owner) => [owner.id, owner.name]))
    const dealById = new Map(visibleDeals.map((deal) => [deal.id, deal]))

    // Group transitions by (pipelineId, fromStage). fromStage = where the
    // deal exited from = the stage whose velocity we're measuring.
    const groups = new Map<string, TransitionRow[]>()
    for (const row of rows) {
      if (!row.fromStage) continue
      const key = `${row.pipelineId ?? "__nopipeline"}::${row.fromStage}`
      const arr = groups.get(key) ?? []
      arr.push(row)
      groups.set(key, arr)
    }

    const results = Array.from(groups.entries()).map(([key, transitions]) => {
      const [pipelineKey, stage] = key.split("::")
      const samples: StageDurationSample[] = transitions
        .filter((t) => t.durationInPrevStageSeconds !== null)
        .map((t) => ({
          durationSeconds: t.durationInPrevStageSeconds!,
          advanced: t.transitionType === "advanced",
          regressed: t.transitionType === "regressed",
          lost: t.transitionType === "lost",
          won: t.transitionType === "won",
        }))
      // dealsEntered approximation: count distinct deals that transitioned
      // OUT of this stage (slice-2 simplification — slice-3 will track
      // entries-vs-exits separately via the dedicated metric table).
      const dealsEntered = transitions.length
      const slowestTransitionByDeal = new Map<string, TransitionRow>()
      for (const transition of transitions) {
        if (transition.durationInPrevStageSeconds === null || !dealById.has(transition.dealId)) continue
        const existing = slowestTransitionByDeal.get(transition.dealId)
        if (
          !existing
          || (transition.durationInPrevStageSeconds ?? 0) > (existing.durationInPrevStageSeconds ?? 0)
        ) {
          slowestTransitionByDeal.set(transition.dealId, transition)
        }
      }
      const detailDeals = [...slowestTransitionByDeal.values()]
        .sort((a, b) => (b.durationInPrevStageSeconds ?? 0) - (a.durationInPrevStageSeconds ?? 0))
        .slice(0, 10)
        .map((transition) => {
          const deal = dealById.get(transition.dealId)!
          return {
            id: deal.id,
            name: deal.name,
            ownerName: deal.assignedTo ? ownerNameById.get(deal.assignedTo) ?? null : null,
            valueAmount: Number(deal.valueAmount),
            currency: deal.currency,
            currentStage: deal.stage,
            durationSeconds: transition.durationInPrevStageSeconds!,
            transitionType: transition.transitionType,
            transitionedAt: transition.transitionedAt,
          }
        })
      return {
        ...aggregateVelocity({
        pipelineId: pipelineKey === "__nopipeline" ? "" : pipelineKey,
        stage,
        periodKey,
        samples,
        dealsEntered,
        }),
        detailDeals,
      }
    })

    // Sort: bottlenecks first, then by p90 desc.
    results.sort((a, b) => {
      if (a.isBottleneck !== b.isBottleneck) return a.isBottleneck ? -1 : 1
      return (b.p90DurationSeconds ?? 0) - (a.p90DurationSeconds ?? 0)
    })

    return NextResponse.json({
      periodKey,
      periodStart,
      periodEnd,
      pipelineId: pipelineId ?? null,
      stages: results,
      totalStages: results.length,
      bottleneckCount: results.filter((r) => r.isBottleneck).length,
    })
  } catch (err) {
    console.error("[deal-velocity] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load velocity" },
      { status: 500 },
    )
  }
})
