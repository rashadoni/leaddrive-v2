/**
 * G3 Calculated Insights — slice-2 read API.
 *
 * GET /api/v1/calculated-insights?limit=50
 *
 * Lists UnifiedProfile rows + runs slice-1 calculators (LTV / churn risk /
 * engagement / days-since-last-purchase) on-the-fly via the shared
 * computeOrgInsights() — the SAME path the daily snapshot cron uses, so the
 * KPI trend on each card stays consistent with its live value.
 *
 * Sort: stale-priority first (high LTV + high churn risk). Within tier,
 * by LTV desc.
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import {
  computeOrgInsights,
  readInsightsTrends,
  FETCH_CAP,
  STALE_PRIORITY_LTV_FLOOR,
  STALE_PRIORITY_CHURN_FLOOR,
} from "@/lib/calculated-insights/compute-org-insights"

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const limitRaw = parseInt(searchParams.get("limit") || "50", 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), FETCH_CAP) : 50

  try {
    // Independent reads — compute the live cohort + read the snapshot history
    // for the KPI trends in parallel.
    const [data, trends] = await Promise.all([
      computeOrgInsights(orgId, { limit }),
      readInsightsTrends(orgId),
    ])
    return NextResponse.json({
      ...data,
      trends,
      fetchCap: FETCH_CAP,
      limit,
      stalePriorityLtvFloor: STALE_PRIORITY_LTV_FLOOR,
      stalePriorityChurnFloor: STALE_PRIORITY_CHURN_FLOOR,
    })
  } catch (err) {
    console.error("[calculated-insights] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load calculated insights" },
      { status: 500 },
    )
  }
})
