/**
 * CDP — UnifiedProfile refresh cron.
 *
 * POST /api/cron/cdp-profile-refresh
 *
 * Rebuilds + re-aggregates every tenant's UnifiedProfile rows from their
 * source records (Contacts; slice-2 adds Lead / MtmCustomer / WebChatSession)
 * and paid invoices. Idempotent — a run doubles as the one-time backfill of
 * existing data, so there's no separate backfill script: the first run
 * populates, subsequent runs converge.
 *
 * Recommended schedule: hourly (cheap; full recompute is fine at hundreds of
 * profiles per tenant). Real-time freshness for individual contacts/invoices
 * is handled by slice-3 write-hooks; this cron is the safety net + backfill.
 *
 * External cron:
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/cdp-profile-refresh \
 *        -H "x-cron-secret: $CRON_SECRET"
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { buildProfilesForOrg, type BuildResult } from "@/lib/unified-profile/profile-builder"
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

    const perOrg: Array<{ organizationId: string } & (BuildResult | { error: string })> = []
    const totals: BuildResult = {
      profilesCreated: 0,
      profilesUpdated: 0,
      sourcesLinked: 0,
      mergeCandidates: 0,
      rejected: 0,
    }

    // One timestamp for the whole run so every tenant's lastRefreshedAt is uniform.
    const now = new Date()

    // Per-org isolation: one tenant's failure must not abort the rest.
    for (const org of orgs) {
      try {
        const res = await buildProfilesForOrg(prisma, org.id, { now })
        perOrg.push({ organizationId: org.id, ...res })
        totals.profilesCreated += res.profilesCreated
        totals.profilesUpdated += res.profilesUpdated
        totals.sourcesLinked += res.sourcesLinked
        totals.mergeCandidates += res.mergeCandidates
        totals.rejected += res.rejected
      } catch (e) {
        console.error(`[cdp-profile-refresh] org ${org.id} failed:`, e)
        perOrg.push({ organizationId: org.id, error: (e as Error).message })
      }
    }

    // Surface per-tenant failures: 207 (not 200) when any org errored, so the
    // shell wrapper's `HTTP != 200` check + any monitor flags it instead of
    // reporting false-green while a tenant's CDP is silently broken.
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
    console.error("[cdp-profile-refresh] fatal:", e)
    return NextResponse.json({ error: "Profile refresh failed" }, { status: 500 })
  }
  })
}
