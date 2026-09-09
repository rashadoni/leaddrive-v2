/**
 * CDP — Identity Resolution fuzzy duplicate-scan cron.
 *
 * POST /api/cron/cdp-identity-scan
 *
 * Daily sweep that surfaces *similar* (fuzzy) duplicate profile pairs into the
 * /cdp/merge-queue operator queue. Complements the hourly cdp-profile-refresh
 * cron: refresh BUILDS profiles (and auto-merges exact identity collisions);
 * this scan finds the near-duplicates an exact match misses. It never merges —
 * every hit is queued `pending` for human review (see fuzzy-duplicate-scan.ts).
 *
 * Recommended schedule: daily (the O(n²) sweep is heavier than the refresh; one
 * pass per day is plenty for surfacing review candidates).
 *
 * External cron:
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/cdp-identity-scan \
 *        -H "x-cron-secret: $CRON_SECRET"
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import {
  scanFuzzyDuplicatesForOrg,
  type FuzzyScanResult,
} from "@/lib/identity-resolution/fuzzy-duplicate-scan"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const startedAt = Date.now()

  try {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    const perOrg: Array<
      { organizationId: string } & (FuzzyScanResult | { error: string })
    > = []
    const totals = {
      profilesScanned: 0,
      comparisons: 0,
      candidatesCreated: 0,
      skippedExisting: 0,
      truncatedOrgs: 0,
    }

    // Per-org isolation: one tenant's failure must not abort the rest.
    for (const org of orgs) {
      try {
        const res = await scanFuzzyDuplicatesForOrg(prisma, org.id)
        perOrg.push({ organizationId: org.id, ...res })
        totals.profilesScanned += res.profilesScanned
        totals.comparisons += res.comparisons
        totals.candidatesCreated += res.candidatesCreated
        totals.skippedExisting += res.skippedExisting
        if (res.truncated) totals.truncatedOrgs++
      } catch (e) {
        console.error(`[cdp-identity-scan] org ${org.id} failed:`, e)
        perOrg.push({ organizationId: org.id, error: (e as Error).message })
      }
    }

    // 207 (not 200) when any org errored, so the shell wrapper's HTTP != 200
    // check flags it instead of reporting false-green.
    const errorCount = perOrg.filter((o) => "error" in o).length
    return NextResponse.json(
      {
        ok: errorCount === 0,
        orgsProcessed: orgs.length,
        errorCount,
        totals,
        perOrg,
        tookMs: Date.now() - startedAt,
      },
      { status: errorCount === 0 ? 200 : 207 },
    )
  } catch (e) {
    console.error("[cdp-identity-scan] fatal:", e)
    return NextResponse.json({ error: "Identity scan failed" }, { status: 500 })
  }
  })
}
