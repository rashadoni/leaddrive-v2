import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { getMtmSettings } from "@/lib/mtm-settings"
import { withJobLease } from "@/lib/cron/job-lease"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"

/**
 * Close the day on routes nobody finished (field UX audit 2026-09-05, task A3).
 *
 * A route only ever left PLANNED or IN_PROGRESS when a person finished or
 * cancelled it, so an ordinary interrupted day stayed "in progress" for ever.
 * On prod the web list "Davam edir" held fourteen August routes beside today's,
 * and the agent's week screen still offered to continue them. This job moves
 * routes of past days to INCOMPLETE, keeping every trace of what was done:
 * visitedPoints, startedAt, the visits themselves. `completedAt` stays null —
 * the day was not completed, and writing a completion stamp here would make the
 * KPI "completed routes" count days that nobody finished.
 *
 * DRAFT and CANCELLED are left alone on purpose. A draft was never published,
 * so it is a plan somebody abandoned, not a day that failed; a cancelled route
 * already has its explanation.
 */

/** Statuses that still mean "this day is open". */
export const MTM_ROUTE_OPEN_STATUSES = ["PLANNED", "IN_PROGRESS"] as const

/**
 * Routes closed per tenant per tick. The first run after deploy is also the
 * backfill of everything that accumulated before this job existed, and an
 * unbounded sweep there would be the one run nobody is watching. What does not
 * fit is picked up an hour later.
 */
export const MTM_ROUTE_DAY_CLOSE_BATCH = 500

/**
 * Hours after local midnight before yesterday is treated as closed. An agent
 * finishing a late visit at 23:50 posts the check-out a few minutes into the
 * next day, and an offline phone can push it later still; closing the route out
 * from under that would turn a completed day into an incomplete one.
 */
export const MTM_ROUTE_DAY_CLOSE_GRACE_HOURS = 3

export interface MtmRouteDayCloseOrganizationResult {
  organizationId: string
  timezone: string
  /** The first day that is still open — every route strictly before it closes. */
  closingBefore: string
  closed: number
  /** True when the batch cap was reached and more routes are waiting. */
  morePending: boolean
}

export interface MtmRouteDayCloseSummary {
  organizationsScanned: number
  routesClosed: number
  organizations: MtmRouteDayCloseOrganizationResult[]
}

/**
 * The first day that is still open for an organization: the local calendar day
 * of `now` minus the grace window. Everything strictly before it is over.
 *
 * Only ever asks Intl for a calendar date, never for an offset, so a DST shift
 * inside the grace window cannot move the boundary by an hour.
 *
 * Returns "" for a timezone this runtime does not know. `dateInputValueInTimezone`
 * would quietly answer in UTC instead, which for a tenant four hours east means
 * closing the day while an agent is still driving it. A stalled sweep is a
 * logged configuration bug; a route closed under a working agent is not
 * recoverable from the app.
 */
export function firstOpenDayKey(
  now: Date,
  timezone: string,
  graceHours: number = MTM_ROUTE_DAY_CLOSE_GRACE_HOURS,
): string {
  if (!isValidTimezone(timezone)) return ""
  const graceApplied = new Date(now.getTime() - graceHours * 3_600_000)
  return dateInputValueInTimezone(graceApplied, timezone)
}

/**
 * `MtmRoute.date` is a Postgres DATE, which Prisma reads and writes as UTC
 * midnight of that calendar day. Comparing against UTC midnight of the local
 * day key therefore compares calendar days, not instants.
 */
export function dayKeyToUtcMidnight(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`)
}

export async function executeMtmRouteDayCloseJob(
  now: Date = new Date(),
): Promise<MtmRouteDayCloseSummary> {
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  const organizations: MtmRouteDayCloseOrganizationResult[] = []
  let routesClosed = 0

  for (const org of orgs) {
    let timezone: string
    try {
      timezone = (await getMtmSettings(org.id)).timezone
    } catch (error) {
      // One tenant's unreadable settings must not stop the sweep for the rest.
      console.warn(`[MTM Cron] route-day-close: settings unavailable for ${org.id}`, error)
      continue
    }

    const closingBefore = firstOpenDayKey(now, timezone)
    // An unknown timezone yields "". Guessing UTC here would close a day early
    // for tenants east of it, so skip the tenant and say so.
    if (!closingBefore) {
      console.warn(`[MTM Cron] route-day-close: unusable timezone for ${org.id}: ${timezone}`)
      continue
    }

    const candidates = await prisma.mtmRoute.findMany({
      where: {
        organizationId: org.id,
        deletedAt: null,
        status: { in: [...MTM_ROUTE_OPEN_STATUSES] },
        date: { lt: dayKeyToUtcMidnight(closingBefore) },
        // Never close a route somebody is standing in the middle of. A visit
        // left open across the boundary means the agent is still working, and
        // closing under them would reject the check-out they are about to send.
        visits: { none: { status: "CHECKED_IN", deletedAt: null } },
      },
      select: { id: true, agentId: true, status: true, date: true, totalPoints: true, visitedPoints: true },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: MTM_ROUTE_DAY_CLOSE_BATCH + 1,
    })

    const batch = candidates.slice(0, MTM_ROUTE_DAY_CLOSE_BATCH)
    const morePending = candidates.length > MTM_ROUTE_DAY_CLOSE_BATCH
    const auditRows: Array<{
      organizationId: string
      agentId: string | null
      action: string
      entity: string
      entityId: string
      metadataKind: string
      oldData: { status: string }
      newData: { status: string; closingBefore: string; timezone: string; visitedPoints: number; totalPoints: number }
    }> = []
    let closed = 0

    for (const route of batch) {
      // Re-assert the open status inside the write: between the read and here a
      // person may have finished the route, and an audit row for a close that
      // did not happen is worse than a route closed an hour later.
      const updated = await prisma.mtmRoute.updateMany({
        where: { id: route.id, organizationId: org.id, status: { in: [...MTM_ROUTE_OPEN_STATUSES] } },
        // `version` is deliberately not bumped: it tracks published content, and
        // an increment here would mark a closed route as edited since publish.
        data: { status: "INCOMPLETE" },
      })
      if (updated.count === 0) continue
      closed += 1
      auditRows.push({
        organizationId: org.id,
        agentId: route.agentId,
        action: MTM_ROUTE_AUDIT_ACTION.ROUTE_DAY_CLOSE,
        entity: "MtmRoute",
        entityId: route.id,
        metadataKind: "route_day_close",
        oldData: { status: route.status },
        newData: {
          status: "INCOMPLETE",
          closingBefore,
          timezone,
          visitedPoints: route.visitedPoints,
          totalPoints: route.totalPoints,
        },
      })
    }

    if (auditRows.length > 0) {
      // The transition is unattended and one-way, so it has to leave a trace
      // that names what was changed, from what, and on whose authority.
      await prisma.mtmAuditLog.createMany({ data: auditRows })
    }

    routesClosed += closed
    organizations.push({ organizationId: org.id, timezone, closingBefore, closed, morePending })
  }

  if (routesClosed > 0) {
    console.log(`[MTM Cron] route-day-close: closed ${routesClosed} unfinished route(s)`)
  }
  return { organizationsScanned: orgs.length, routesClosed, organizations }
}

export function runMtmRouteDayCloseJob(now?: Date) {
  return runWithRlsBypass(() =>
    withJobLease(
      { name: "mtm-route-day-close", ttlMs: 10 * 60_000 },
      () => executeMtmRouteDayCloseJob(now),
    ),
  )
}
