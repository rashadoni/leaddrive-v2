/**
 * D8 Loyalty Phase E — Points expiry cron endpoint.
 *
 * POST /api/cron/loyalty-expiry
 *
 * Runs once per day (recommended: 02:00 UTC).
 * Finds all organisations with `loyaltyPointsExpiryDays` set in
 * Organization.settings, then calls `runLoyaltyExpiry` for each.
 *
 * External cron:
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/loyalty-expiry \
 *        -H "x-cron-secret: $CRON_SECRET"
 *
 * Per-tenant config is stored in Organization.settings JSON:
 *   { "loyaltyPointsExpiryDays": 365 }   // null / absent = no expiry
 *
 * Setting loyaltyPointsExpiryDays does NOT retroactively expire old
 * earn rows that predate the configuration — only earn rows created
 * AFTER the storefront earn route starts stamping expiresAt will be
 * swept (i.e., earn rows with expiresAt IS NULL are always skipped).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runLoyaltyExpiry, type ExpiryPrismaClient } from "@/lib/loyalty/expiry-cron"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const now = new Date()

  try {
    // Find all active orgs that have loyaltyPointsExpiryDays configured.
    // Cast settings to any — we read a single key from an opaque JSONB.
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true, settings: true },
    })

    const eligibleOrgs = orgs.filter((o: (typeof orgs)[number]) => {
      const s = o.settings as Record<string, unknown>
      const days = s?.loyaltyPointsExpiryDays
      return typeof days === "number" && days > 0
    })

    if (eligibleOrgs.length === 0) {
      return NextResponse.json({
        ok: true,
        orgsProcessed: 0,
        message: "No orgs with loyaltyPointsExpiryDays configured",
      })
    }

    let totalOrgsExpired = 0
    let totalPointsExpired = 0
    const perOrg: Record<string, { earnRowsFound: number; accountsExpired: number; totalPointsExpired: number }> = {}

    for (const org of eligibleOrgs) {
      try {
        const result = await runLoyaltyExpiry(prisma as unknown as ExpiryPrismaClient, org.id, now)
        perOrg[org.id] = {
          earnRowsFound: result.earnRowsFound,
          accountsExpired: result.accountsExpired,
          totalPointsExpired: result.totalPointsExpired,
        }
        if (result.accountsExpired > 0 || result.earnRowsFound > 0) {
          totalOrgsExpired++
        }
        totalPointsExpired += result.totalPointsExpired
      } catch (e) {
        console.error(`[cron/loyalty-expiry] org ${org.id} failed:`, e)
        perOrg[org.id] = { earnRowsFound: 0, accountsExpired: 0, totalPointsExpired: 0 }
      }
    }

    return NextResponse.json({
      ok: true,
      orgsChecked: eligibleOrgs.length,
      orgsWithExpiry: totalOrgsExpired,
      totalPointsExpired,
      perOrg,
      runAt: now.toISOString(),
    })
  } catch (e) {
    console.error("[cron/loyalty-expiry] fatal error:", e)
    return NextResponse.json({ error: "Expiry cron failed" }, { status: 500 })
  }
  })
}
