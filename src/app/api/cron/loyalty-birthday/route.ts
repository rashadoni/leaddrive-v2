/**
 * D8 Loyalty — birthday auto-earn cron endpoint.
 *
 * POST /api/cron/loyalty-birthday
 *
 * Runs once per day (recommended: 06:00 UTC — early enough that members see
 * the bonus on their birthday morning). Finds every org with the auto-earn
 * master switch on AND an active `birthday` earn rule, then awards each org's
 * today's-birthday members via `runLoyaltyBirthday`.
 *
 * External cron:
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/loyalty-birthday \
 *        -H "x-cron-secret: $CRON_SECRET"
 *
 * Idempotent: referenceId `birthday:<contactId>:<year>` + the partial unique
 * index mean re-running the same day never double-awards.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runLoyaltyBirthday, type BirthdayCronResult } from "@/lib/loyalty/birthday-cron"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    const now = new Date()

    try {
      // Active orgs with the auto-earn master switch on (settings.loyaltyAutoEarn).
      const orgs = await prisma.organization.findMany({
        where: { isActive: true },
        select: { id: true, settings: true },
      })
      const autoEarnOrgIds = orgs
        .filter((o: (typeof orgs)[number]) => (o.settings as Record<string, unknown>)?.loyaltyAutoEarn === true)
        .map((o: (typeof orgs)[number]) => o.id)

      if (autoEarnOrgIds.length === 0) {
        return NextResponse.json({ ok: true, orgsChecked: 0, message: "No orgs with auto-earn enabled" })
      }

      // …that ALSO have at least one active birthday rule (skip a contact scan
      // for orgs that can't award anyway).
      const ruleRows = await prisma.loyaltyEarnRule.findMany({
        where: { organizationId: { in: autoEarnOrgIds }, isActive: true, trigger: "birthday" },
        select: { organizationId: true },
        distinct: ["organizationId"],
      })
      const eligibleOrgIds = ruleRows.map((r: (typeof ruleRows)[number]) => r.organizationId)

      if (eligibleOrgIds.length === 0) {
        return NextResponse.json({ ok: true, orgsChecked: 0, message: "No orgs with an active birthday rule" })
      }

      let totalAwarded = 0
      let totalPoints = 0
      const perOrg: Record<string, BirthdayCronResult> = {}

      for (const orgId of eligibleOrgIds) {
        try {
          const r = await runLoyaltyBirthday(prisma, orgId, now)
          perOrg[orgId] = r
          totalAwarded += r.awarded
          totalPoints += r.totalPoints
        } catch (e) {
          console.error(`[cron/loyalty-birthday] org ${orgId} failed:`, e)
        }
      }

      return NextResponse.json({
        ok: true,
        orgsChecked: eligibleOrgIds.length,
        totalAwarded,
        totalPoints,
        perOrg,
        runAt: now.toISOString(),
      })
    } catch (e) {
      console.error("[cron/loyalty-birthday] fatal error:", e)
      return NextResponse.json({ error: "Birthday cron failed" }, { status: 500 })
    }
  })
}
