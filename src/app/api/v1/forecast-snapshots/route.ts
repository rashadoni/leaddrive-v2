/**
 * A12 Forecast Snapshots — slice-2 API route.
 *
 * GET  /api/v1/forecast-snapshots — list snapshots (paginated)
 * POST /api/v1/forecast-snapshots — take a new snapshot NOW
 *
 * Slice-2 minimum: org-scope snapshots only (scope=org, scopeRef=null).
 * Slice-3 will add scope=pipeline + scope=user with target selectors.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { buildForecastSnapshot } from "@/lib/revenue-intelligence/forecast-snapshot-builder"
import {
  DEFAULT_STAGE_PROBABILITIES,
  type DealForSnapshot,
} from "@/lib/revenue-intelligence/types"
import { decimalToNumber, normalizeForecastSnapshotRow } from "@/lib/prisma-decimal"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

const takeSnapshotSchema = z.object({
  /** Period start (ISO). Defaults to start of current quarter. */
  periodStart: z.string().optional(),
  /** Period end (ISO). Defaults to end of current quarter. */
  periodEnd: z.string().optional(),
  /** Reporting currency. Defaults to USD. */
  currency: z.string().optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  // Defensive parse: ?page=abc → NaN → fallback. Architect pass-1 fix.
  const rawPage = parseInt(searchParams.get("page") || "1", 10)
  const rawLimit = parseInt(searchParams.get("limit") || "20", 10)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(rawLimit, 100)
      : 20

  try {
    const where = { organizationId: orgId }
    const [snapshots, total] = await Promise.all([
      prisma.forecastSnapshot.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { snapshotDate: "desc" },
      }),
      prisma.forecastSnapshot.count({ where }),
    ])
    return NextResponse.json({
      snapshots: snapshots.map(normalizeForecastSnapshotRow),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    console.error("[forecast-snapshots] GET error:", err)
    return NextResponse.json(
      { error: "Failed to fetch snapshots" },
      { status: 500 },
    )
  }
})

export const POST = withRls(async (req, { orgId, session }) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const parsed = takeSnapshotSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // Default period = current quarter
  const now = new Date()
  const quarter = Math.floor(now.getMonth() / 3)
  const defaultStart = new Date(now.getFullYear(), quarter * 3, 1)
  const defaultEnd = new Date(now.getFullYear(), (quarter + 1) * 3, 0, 23, 59, 59)

  const periodStart = parsed.data.periodStart
    ? new Date(parsed.data.periodStart)
    : defaultStart
  const periodEnd = parsed.data.periodEnd
    ? new Date(parsed.data.periodEnd)
    : defaultEnd

  if (periodStart >= periodEnd) {
    return NextResponse.json(
      { error: "periodStart must be before periodEnd" },
      { status: 400 },
    )
  }

  const currency = parsed.data.currency || "USD"

  try {
    // Closed means every spelling of closed this org stores, not two literals.
    const { closedStages } = await orgStageVocabulary(orgId)

    // Fetch active deals for the org. Use existing Deal model's `stage`
    // + `valueAmount` (per A12 plan, A12 uses existing CRM deals).
    const deals = await prisma.deal.findMany({
      where: {
        organizationId: orgId,
        // Exclude already-closed deals; only OPEN pipeline.
        stage: { notIn: closedStages },
      },
      select: {
        id: true,
        valueAmount: true,
        stage: true,
        expectedClose: true,
      },
    })

    const dealsForSnapshot: DealForSnapshot[] = deals.map(
      (d: { id: string; valueAmount: unknown; stage: string; expectedClose: Date | null }) => ({
        dealId: d.id,
        amount: decimalToNumber(d.valueAmount),
        stage: d.stage,
        expectedCloseAt: d.expectedClose,
      }),
    )

    const result = buildForecastSnapshot({
      deals: dealsForSnapshot,
      stageProbabilities: DEFAULT_STAGE_PROBABILITIES,
      periodStart,
      periodEnd,
    })

    // Get the user who triggered the snapshot (from the withRls-passed session).
    const capturedBy = session?.userId ?? null

    const snapshot = await prisma.forecastSnapshot.create({
      data: {
        organizationId: orgId,
        snapshotDate: new Date(),
        scope: "org",
        scopeRef: null,
        periodStart,
        periodEnd,
        committedAmount: result.committedAmount,
        bestCaseAmount: result.bestCaseAmount,
        forecastAmount: result.forecastAmount,
        dealsCommitted: result.dealsCommitted,
        dealsBestCase: result.dealsBestCase,
        dealsTotal: result.dealsTotal,
        currency,
        capturedBy,
        metadata: {
          dealsExcluded: result.dealsExcluded,
          source: "manual_ui",
        },
      },
    })

    return NextResponse.json({ snapshot: normalizeForecastSnapshotRow(snapshot) }, { status: 201 })
  } catch (err) {
    console.error("[forecast-snapshots] POST error:", err)
    return NextResponse.json(
      { error: "Failed to take snapshot" },
      { status: 500 },
    )
  }
})
