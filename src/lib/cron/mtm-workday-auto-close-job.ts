import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { getMtmSettings } from "@/lib/mtm-settings"
import { withJobLease } from "@/lib/cron/job-lease"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { notifyAgents } from "@/lib/mtm/push-notify"
import { isValidTimezone } from "@/lib/timezone"
import {
  closeMtmWorkdayIfDue,
  WORKDAY_AUTO_CLOSE_ENABLED_KEY,
  WORKDAY_AUTO_CLOSE_SINCE_KEY,
  type WorkdayAutoCloseNotice,
} from "@/lib/mtm/workday-auto-close"

export interface MtmWorkdayAutoCloseSummary {
  organizations: number
  openDays: number
  closed: number
  failed: number
}

/** Bounds one pass; whatever is left is picked up five minutes later. */
const MAX_DAYS_PER_ORGANIZATION = 500

export async function executeMtmWorkdayAutoCloseJob(
  now = new Date(),
  deliver: (organizationId: string, notice: WorkdayAutoCloseNotice) => Promise<unknown> = deliverNotice,
): Promise<MtmWorkdayAutoCloseSummary> {
  const rows = await prisma.mtmSetting.findMany({
    where: { key: { in: [WORKDAY_AUTO_CLOSE_ENABLED_KEY, WORKDAY_AUTO_CLOSE_SINCE_KEY] } },
    select: { organizationId: true, key: true, value: true },
  }) as Array<{ organizationId: string; key: string; value: unknown }>
  const summary: MtmWorkdayAutoCloseSummary = { organizations: 0, openDays: 0, closed: 0, failed: 0 }

  for (const organizationId of new Set(rows.map((row) => row.organizationId))) {
    const value = (key: string) => rows.find((row) => row.organizationId === organizationId && row.key === key)?.value
    if (value(WORKDAY_AUTO_CLOSE_ENABLED_KEY) !== true) continue
    // Without the moment it was switched on there is no telling which days
    // came before it, and those are not to be touched.
    const since = value(WORKDAY_AUTO_CLOSE_SINCE_KEY)
    const enabledAt = typeof since === "string" ? new Date(since) : null
    if (!enabledAt || !Number.isFinite(enabledAt.getTime())) {
      console.warn("[mtm/workday-auto-close] enabled without a start moment; skipped")
      continue
    }
    const settings = await getMtmSettings(organizationId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    summary.organizations += 1

    const days = await prisma.mtmAgentWorkday.findMany({
      where: {
        organizationId,
        status: { in: ["STARTED", "PAUSED"] },
        workDate: { gte: new Date(`${currentDateKey(enabledAt, timezone)}T00:00:00.000Z`) },
        agent: { role: { not: "EMPLOYEE" }, attendanceParticipant: false },
      },
      orderBy: { workDate: "asc" },
      take: MAX_DAYS_PER_ORGANIZATION,
      select: { id: true, agentId: true },
    }) as Array<{ id: string; agentId: string }>
    summary.openDays += days.length

    for (const day of days) {
      let notice: WorkdayAutoCloseNotice | null
      try {
        notice = await prisma.$transaction((tx: Prisma.TransactionClient) => closeMtmWorkdayIfDue(tx, {
          organizationId,
          agentId: day.agentId,
          workdayId: day.id,
          timezone,
          hour: settings.workdayAutoCloseHour,
          enabledAt,
          now,
        }))
      } catch (error) {
        // One bad day must not keep the others open.
        summary.failed += 1
        console.error("[mtm/workday-auto-close] failed:", error instanceof Error ? error.name : "unknown")
        continue
      }
      if (!notice) continue
      summary.closed += 1
      // After the commit, and never able to undo it.
      await deliver(organizationId, notice).catch(() => {})
    }
  }
  if (summary.closed > 0) console.log(`[mtm/workday-auto-close] closed ${summary.closed} day(s)`)
  return summary
}

function deliverNotice(organizationId: string, notice: WorkdayAutoCloseNotice) {
  return notifyAgents({
    client: prisma,
    organizationId,
    agentIds: [notice.agentId],
    title: notice.title,
    body: notice.body,
    // Data-only: the app's own service must receive it in the background to
    // stop GPS. An app without that code still draws the title and body.
    dataOnly: true,
    data: { event: "workday_closed", workdayId: notice.workdayId },
  })
}

export function runMtmWorkdayAutoCloseJob() {
  return runWithRlsBypass(() =>
    withJobLease(
      { name: "mtm-workday-auto-close", ttlMs: 10 * 60_000 },
      () => executeMtmWorkdayAutoCloseJob(),
    ),
  )
}
