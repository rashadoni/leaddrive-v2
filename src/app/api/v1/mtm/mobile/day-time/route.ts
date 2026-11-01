import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { loadDayTimes } from "@/lib/mtm/day-time"

/**
 * GET /api/v1/mtm/mobile/day-time — where the agent's own day of today went:
 * with clients, on a break, on the way (the «ring of the day» on «Bu gün»,
 * owner 2026-11-02). The same reckoning as his manager's «Komanda» card.
 * `dayTime: null` before the day is started, and for a shift left open
 * since an earlier day.
 */
export const GET = withMobileRls(async (_req, auth) => {
  const forbidden = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (forbidden) return forbidden
  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const now = new Date()
  const todayKey = currentDateKey(now, timezone)
  const day = await prisma.mtmAgentWorkday.findFirst({
    where: { organizationId: auth.orgId, agentId: auth.agentId, workDate: new Date(`${todayKey}T00:00:00.000Z`) },
    select: { id: true, startedAt: true, completedAt: true },
  })
  if (!day || currentDateKey(day.startedAt, timezone) !== todayKey) {
    return NextResponse.json({ success: true, data: { dayTime: null } })
  }
  const times = await loadDayTimes(prisma, auth.orgId, [{ ...day, agentId: auth.agentId }], now)
  return NextResponse.json({ success: true, data: { dayTime: times.get(auth.agentId) ?? null } })
})
