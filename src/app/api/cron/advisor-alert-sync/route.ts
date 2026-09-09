/**
 * POST /api/cron/advisor-alert-sync
 *
 * Explicitly syncs high/critical Advisor signals into ProactiveAlert.
 * Advisor read APIs stay side-effect free; this cron is the observable
 * operational path for alert mutation.
 *
 * Auth: x-cron-secret header OR Authorization: Bearer <secret>.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { getAdvisorPayload } from "@/lib/ai/advisor/service"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    const startedAt = Date.now()
    const orgId = req.nextUrl.searchParams.get("organizationId") || undefined
    const orgs = await prisma.organization.findMany({
      where: { isActive: true, ...(orgId ? { id: orgId } : {}) },
      select: { id: true },
      take: orgId ? 1 : 100,
    })

    const results: Array<{ organizationId: string; ok: boolean; signals?: number; alerts?: number; error?: string }> = []
    for (const org of orgs) {
      try {
        const payload = await getAdvisorPayload(org.id, undefined, undefined, { syncAlerts: true })
        const alertSignals = payload.signals.filter((signal) => signal.severity === "critical" || signal.severity === "high")
        results.push({
          organizationId: org.id,
          ok: true,
          signals: payload.signals.length,
          alerts: Math.min(alertSignals.length, 20),
        })
      } catch (error) {
        results.push({
          organizationId: org.id,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown Advisor alert sync error",
        })
      }
    }

    return NextResponse.json({
      ok: results.every((item) => item.ok),
      scannedOrganizations: orgs.length,
      results,
      durationMs: Date.now() - startedAt,
    }, { status: results.some((item) => !item.ok) ? 207 : 200 })
  })
}
