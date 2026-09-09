/**
 * CLM Slice 5c — Contract Analytics API (refactored for Slice 7b).
 *
 * GET /api/v1/contract-analytics
 *
 * Thin wrapper — all computation delegated to
 * `src/lib/contract-lifecycle/analytics.ts::computeContractAnalytics`.
 * Response shape is IDENTICAL to the pre-refactor version.
 *
 * Sections returned:
 *   summary        — live count, total value, MRR, avg cycle time, renewal rate,
 *                    expiring-soon count, open deviation count
 *   byType         — count + total value grouped by contract type (live only)
 *   cohorts        — total value + count grouped by expiry quarter (next 12mo)
 *   approvalFlow   — contract counts by status (funnel view)
 *   deviationRisk  — open flags grouped by severity
 *
 * Money / float guard:
 *   All value sums use Prisma aggregate({ _sum: { valueAmount: true } }) which
 *   returns a Prisma.Decimal. Serialised via .toFixed(2) → string that
 *   downstream JSON.parse can handle without float drift.
 *
 * Optional query params:
 *   from=ISO8601   — filter createdAt ≥ from
 *   to=ISO8601     — filter createdAt ≤ to
 */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { computeContractAnalytics } from "@/lib/contract-lifecycle/analytics"

function parseOptionalDate(v: string | null): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d
}

export const GET = withRlsAuth("contracts", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const from = parseOptionalDate(searchParams.get("from"))
  const to = parseOptionalDate(searchParams.get("to"))

  try {
    const result = await computeContractAnalytics(orgId, { from, to })
    return NextResponse.json(result)
  } catch (err) {
    console.error("[contract-analytics] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load contract analytics" },
      { status: 500 },
    )
  }
})
