import { prisma } from "@/lib/prisma"
import { liveMapAdmissibleLocationWhere, liveMapWorkdayOf, liveMapWorkdayRead } from "@/lib/mtm/live-location"
import { MTM_WORKDAY_PAUSE_EVENT_TYPES, mtmWorkdayPauses, type MtmWorkdayPauseEvent } from "@/lib/mtm/workday-pauses"
import {
  locationShareLinkMaxAccuracyMeters,
  locationShareLinkPointsSince,
  locationShareLinkPositionFor,
  locationShareLinkShiftStartedAt,
  locationShareLinkTimezone,
  locationShareLinkTodayWorkDate,
  type LocationShareLinkCandidate,
  type LocationShareLinkPosition,
  type LocationShareLinkThresholds,
  type LocationShareLinkWorkday,
} from "@/lib/mtm/location-share-link"

/**
 * What a «ссылка на местоположение» to this employee shows at this moment —
 * the reads and the rule together, for the two places that ask:
 *
 *   - the public answer (/api/v1/public/location-share/[token]), which hands
 *     the point to whoever holds a link;
 *   - the managers' list (GET /api/v1/mtm/locations/share-links), which tells
 *     the manager whether a link shows anything right now, so that he is not
 *     left guessing why his client sees «сейчас недоступно».
 *
 * One function, so the manager is never told «показывается» about an
 * employee the outsider is shown nothing of. The rule itself is
 * locationShareLinkPositionFor (location-share-link.ts); nothing is decided
 * here — this only reads what the rule is asked about:
 *
 *   - his workdays, as the live roster reads them: the same rows, the same
 *     choice between them;
 *   - only while he is on shift — the breaks of that shift, from its own
 *     journal, with the reader GPS ingestion uses (workday-pauses.ts);
 *   - only then — the newest point the roster itself would draw, recorded
 *     since the shift began or his last break ended, and not after `now`.
 *     Always the raw points, never the latest-position row: a vague point
 *     advances that one.
 *
 * Called INSIDE the organization's scope (runWithTenant / the route wrapper),
 * and every statement names the organization itself. Whether the caller may
 * ask at all — the link, the organization's switch, the employee, the field
 * product — is the caller's to settle first; none of that is looked at here.
 *
 * Server only: it reads the database.
 */
export async function readLocationShareLinkPosition(input: {
  organizationId: string
  agentId: string
  /** The organization's MTM settings, as getMtmSettings read them. */
  settings: LocationShareLinkThresholds & { timezone: unknown }
  now: Date
}): Promise<{ position: LocationShareLinkPosition; timezone: string }> {
  const { organizationId, agentId, settings, now } = input
  const timezone = locationShareLinkTimezone(settings.timezone)
  const today = locationShareLinkTodayWorkDate(now, timezone)

  const workdayRead = liveMapWorkdayRead(today)
  // The rows are typed where they are read: the database client is untyped
  // here, and a helper handed its rows would otherwise guess their shape.
  const workdays: ShiftRow[] = await prisma.mtmAgentWorkday.findMany({
    ...workdayRead,
    where: { organizationId, agentId, ...workdayRead.where },
    select: { id: true, status: true, workDate: true, startedAt: true },
  })
  const workday = liveMapWorkdayOf<ShiftRow>(workdays, today).effective ?? null

  const shiftStartedAt = locationShareLinkShiftStartedAt(workday, now, timezone)
  const breakEvents: MtmWorkdayPauseEvent[] = workday && shiftStartedAt
    ? await prisma.mtmAgentWorkdayEvent.findMany({
        where: { organizationId, agentId, workdayId: workday.id, type: { in: [...MTM_WORKDAY_PAUSE_EVENT_TYPES] } },
        orderBy: { occurredAt: "asc" },
        select: { type: true, occurredAt: true, appliedAt: true },
      })
    : []
  const breaks = mtmWorkdayPauses(breakEvents)

  const pointsSince = locationShareLinkPointsSince(shiftStartedAt, breaks)
  const location: LocationShareLinkCandidate | null = pointsSince
    ? await prisma.mtmAgentLocation.findFirst({
        where: {
          organizationId,
          agentId,
          recordedAt: { gte: pointsSince, lte: now },
          ...liveMapAdmissibleLocationWhere(locationShareLinkMaxAccuracyMeters(settings.historyMaxAccuracyMeters)),
        },
        orderBy: { recordedAt: "desc" },
        select: { latitude: true, longitude: true, accuracy: true, recordedAt: true },
      })
    : null

  // The rule decides, and checks everything again: how old the point is,
  // which is not the organization's to stretch, is asked only there.
  return { position: locationShareLinkPositionFor({ workday, breaks, location, settings, now, timezone }), timezone }
}

/** A row of mtm_agent_workdays as it is read here: what the rule reads, and the id his breaks are found by. */
interface ShiftRow extends LocationShareLinkWorkday {
  id: string
}
