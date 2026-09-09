/**
 * CDP Calculated Insights — daily KPI snapshot cron.
 *
 * POST /api/cron/customer-insights-snapshot
 *
 * Writes ONE CustomerInsightsSnapshot row per active org per calendar day,
 * capturing the 4 headline KPIs (totalProfiles, dominantLtv, highRiskCount,
 * avgEngagement) via the shared computeOrgInsights() — the SAME path the read
 * API uses, so each KPI card's trend matches its live value. These snapshots
 * are what the slice-2 sparkline / delta read from; there is no historical
 * backfill, so the trend fills in as days accumulate.
 *
 * Idempotent per day via a deterministic id `${orgId}:${YYYY-MM-DD}` — the PK
 * enforces one snapshot per org per day, and the write is an upsert, so even
 * two CONCURRENT ticks dedupe atomically on the PK (no duplicate, no error).
 * A findUnique fast-path skips the recompute when the day's row already exists.
 * Per-org failures are isolated — one tenant's error never aborts the rest.
 *
 * Recommended schedule: once daily (re-runs / overlaps are safe).
 *
 * External cron:
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/customer-insights-snapshot \
 *        -H "x-cron-secret: $CRON_SECRET"
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { computeOrgInsights } from "@/lib/calculated-insights/compute-org-insights"
import { runWithRlsBypass } from "@/lib/rls-context"

// Match the UI's default page size so snapshot aggregates equal the live KPIs
// (highRiskCount / avgEngagement / dominantLtv are computed over the top-N cohort).
const SNAPSHOT_LIMIT = 50

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const startedAt = Date.now()

  // Deterministic per-day id (UTC). The PK itself enforces one snapshot per org
  // per day, so a concurrent double-run can't duplicate — the upsert below
  // dedupes on the PK atomically. No expression index / schema drift needed.
  const day = new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)

  try {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    let created = 0
    let skipped = 0
    const errors: Array<{ organizationId: string; error: string }> = []

    for (const org of orgs) {
      try {
        const id = `${org.id}:${day}`
        // Fast path: today's snapshot already there → skip the recompute.
        const existing = await prisma.customerInsightsSnapshot.findUnique({
          where: { id },
          select: { id: true },
        })
        if (existing) {
          skipped++
          continue
        }

        const data = await computeOrgInsights(org.id, { limit: SNAPSHOT_LIMIT })

        // upsert (not create) so two ticks racing past the findUnique above
        // both resolve to the same row instead of erroring / duplicating.
        await prisma.customerInsightsSnapshot.upsert({
          where: { id },
          update: {}, // keep the first snapshot of the day
          create: {
            id,
            organizationId: org.id,
            totalProfiles: data.totalProfiles,
            highRiskCount: data.highRiskCount,
            avgEngagement: data.avgEngagement,
            dominantLtv: data.dominantLtv.total,
            dominantCurrency: data.dominantLtv.currency,
            capturedBy: null,
            metadata: { limit: SNAPSHOT_LIMIT, truncated: data.truncated },
          },
        })
        created++
      } catch (err) {
        errors.push({
          organizationId: org.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({
      ok: true,
      orgs: orgs.length,
      created,
      skipped,
      errors,
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    console.error("[customer-insights-snapshot] cron error:", err)
    return NextResponse.json(
      { error: "Failed to snapshot customer insights" },
      { status: 500 },
    )
  }
  })
}
