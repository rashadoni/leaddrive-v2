import { calculateDistance } from "@/lib/geo-utils"
import { prepareHistoryPoints, type HistoryLocationPoint } from "@/lib/mtm/location-history"
import { dateInputValueInTimezone, localDateTimeToUtc } from "@/lib/timezone"

/**
 * What one field agent did over a period, day by day.
 *
 * Owner 2026-09-25: «a manager wants to see what an agent was doing over a
 * period — here there is only a week, not intuitive, not interactive»; the
 * first attempt listed only the days with something in them, so a day off and
 * a day the agent never showed up looked the same: absent. Every day of the
 * period is a row now, with a verdict a manager reads at a glance.
 */
export const AGENT_PERIOD_MAX_DAYS = 31

/**
 * Prod 2026-09-26, the owner's own phone: a shift opened on 20.09 and never
 * closed, GPS moving every day after — and every day read «day off», with
 * 5 810 km of flights counted as driving. Two verdicts cover what the data
 * actually says: the shift was left open from an earlier day (SHIFT_OPEN), or
 * the phone moved with no shift and no visit (GPS_ONLY).
 */
export type AgentPeriodDayStatus = "FULL" | "PARTIAL" | "NOT_WORKED" | "UNPLANNED" | "DAY_OFF" | "UPCOMING" | "SHIFT_OPEN" | "GPS_ONLY"

export type AgentPeriodDay = {
  date: string
  workday: { startedAt: string; completedAt: string | null; carriedOver: boolean } | null
  fieldSeconds: number
  visits: number
  /**
   * Owner 2026-09-26: «no information whom he met on which date and how long
   * he spent — too few details». Each visit of the day, in time order.
   */
  visitList: AgentPeriodVisit[]
  /** First and last GPS fix of the day, when the phone reported at all. */
  firstPointAt: string | null
  lastPointAt: string | null
  planned: number
  visitedPoints: number
  distanceMeters: number
  status: AgentPeriodDayStatus
  remaining: number
}

export type AgentPeriod = {
  days: AgentPeriodDay[]
  summary: {
    workedDays: number
    plannedDays: number
    fieldSeconds: number
    visits: number
    planned: number
    visitedPoints: number
    distanceMeters: number
  }
}

export type AgentPeriodVisit = {
  id: string
  customerName: string
  contactName: string | null
  checkInAt: string
  checkOutAt: string | null
  durationSeconds: number | null
  status: string
}

type Workday = { workDate: Date; startedAt: Date; completedAt: Date | null; totalPausedSeconds: number }
type Visit = {
  id?: string
  checkInAt: Date
  checkOutAt?: Date | null
  status: string
  customer?: { name: string } | null
  contact?: { displayName: string | null } | null
}
type Route = { date: Date; status: string; totalPoints: number; visitedPoints: number }

export function periodDays(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to && days.length < AGENT_PERIOD_MAX_DAYS; ) {
    days.push(day)
    const next = new Date(`${day}T00:00:00.000Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    day = next.toISOString().slice(0, 10)
  }
  return days
}

function dayEnd(day: string, timezone: string): number {
  const next = new Date(`${day}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return localDateTimeToUtc(`${next.toISOString().slice(0, 10)}T00:00`, timezone).getTime()
}

/**
 * Driving distance: only steps a vehicle can make. A step across a silence
 * longer than ten minutes is unknown travel, and one faster than 180 km/h is a
 * flight or a GPS jump — neither is road the agent drove.
 */
export const DRIVING_MAX_STEP_SECONDS = 10 * 60
export const DRIVING_MAX_SPEED_KMH = 180

export function drivingDistanceMeters(points: readonly HistoryLocationPoint[]): number {
  let meters = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const seconds = (current.recordedAt.getTime() - previous.recordedAt.getTime()) / 1_000
    if (seconds <= 0 || seconds > DRIVING_MAX_STEP_SECONDS) continue
    const step = calculateDistance(previous.latitude, previous.longitude, current.latitude, current.longitude)
    if ((step / seconds) * 3.6 > DRIVING_MAX_SPEED_KMH) continue
    meters += step
  }
  return Math.round(meters)
}

export function buildAgentPeriod(input: {
  from: string
  to: string
  timezone: string
  now: Date
  maxAccuracyMeters: number
  workdays: readonly Workday[]
  visits: readonly Visit[]
  routes: readonly Route[]
  points: readonly HistoryLocationPoint[]
}): AgentPeriod {
  const { timezone } = input
  const today = dateInputValueInTimezone(input.now, timezone)
  const keyOf = (value: Date) => dateInputValueInTimezone(value, timezone)
  const pointsByDay = new Map<string, HistoryLocationPoint[]>()
  for (const point of input.points) {
    const key = keyOf(point.recordedAt)
    if (!pointsByDay.has(key)) pointsByDay.set(key, [])
    pointsByDay.get(key)!.push(point)
  }

  const days = periodDays(input.from, input.to).map((date): AgentPeriodDay => {
    const own = input.workdays.find((row) => row.workDate.toISOString().slice(0, 10) === date) ?? null
    const dayStart = localDateTimeToUtc(`${date}T00:00`, timezone).getTime()
    // A shift opened on an earlier date and not closed before this day began.
    const carried = own ? null : input.workdays.find((row) => {
      const rowDate = row.workDate.toISOString().slice(0, 10)
      return rowDate < date && row.startedAt.getTime() < dayEnd(date, timezone)
        && (!row.completedAt || row.completedAt.getTime() >= dayStart)
    }) ?? null
    const workday = own ?? carried
    const dayPoints = pointsByDay.get(date) ?? []
    // Published plans only: a draft never reached the agent, a cancelled one was withdrawn.
    const routes = input.routes.filter((route) => route.date.toISOString().slice(0, 10) === date && route.status !== "DRAFT" && route.status !== "CANCELLED")
    const planned = routes.reduce((sum, route) => sum + route.totalPoints, 0)
    const visitedPoints = routes.reduce((sum, route) => sum + route.visitedPoints, 0)
    const dayVisits = input.visits
      .filter((visit) => visit.status !== "CANCELLED" && keyOf(visit.checkInAt) === date)
      .sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime())
    const visits = dayVisits.length
    const visitList: AgentPeriodVisit[] = dayVisits.map((visit) => ({
      id: visit.id ?? "",
      customerName: visit.customer?.name ?? "—",
      contactName: visit.contact?.displayName ?? null,
      checkInAt: visit.checkInAt.toISOString(),
      checkOutAt: visit.checkOutAt?.toISOString() ?? null,
      durationSeconds: visit.checkOutAt ? Math.max(0, Math.round((visit.checkOutAt.getTime() - visit.checkInAt.getTime()) / 1_000)) : null,
      status: visit.status,
    }))
    const distanceMeters = dayPoints.length > 1
      ? drivingDistanceMeters(prepareHistoryPoints([...dayPoints], input.maxAccuracyMeters).points)
      : 0

    // Time in the field: the workday on its own date. One left open (the
    // owner's own test shift ran for days) ends at its last fix that day —
    // never at "now" days later.
    let fieldSeconds = 0
    if (carried) {
      // A shift left open for days is not days of work — the owner's phone
      // reports around the clock, and «in the field 24 h» every day would be
      // a lie. Nobody opened a shift that day: no field time.
      fieldSeconds = 0
    } else if (workday) {
      const lastPoint = dayPoints.reduce((latest, point) => Math.max(latest, point.recordedAt.getTime()), 0)
      const end = Math.min(
        workday.completedAt?.getTime() ?? (lastPoint || workday.startedAt.getTime()),
        dayEnd(date, timezone),
        input.now.getTime(),
      )
      fieldSeconds = Math.max(0, Math.round((end - workday.startedAt.getTime()) / 1_000) - workday.totalPausedSeconds)
    }

    const worked = Boolean(own) || visits > 0
    const status: AgentPeriodDayStatus = date > today
      ? "UPCOMING"
      : worked
        ? planned === 0 ? "UNPLANNED" : visitedPoints < planned ? "PARTIAL" : "FULL"
        : carried
          ? "SHIFT_OPEN"
          : distanceMeters > 0
            ? "GPS_ONLY"
            : planned > 0 ? "NOT_WORKED" : "DAY_OFF"

    return {
      date,
      workday: workday ? { startedAt: workday.startedAt.toISOString(), completedAt: workday.completedAt?.toISOString() ?? null, carriedOver: Boolean(carried) } : null,
      fieldSeconds,
      visits,
      visitList,
      firstPointAt: dayPoints.length ? new Date(Math.min(...dayPoints.map((point) => point.recordedAt.getTime()))).toISOString() : null,
      lastPointAt: dayPoints.length ? new Date(Math.max(...dayPoints.map((point) => point.recordedAt.getTime()))).toISOString() : null,
      planned,
      visitedPoints,
      distanceMeters,
      status,
      remaining: Math.max(0, planned - visitedPoints),
    }
  })

  const past = days.filter((day) => day.status !== "UPCOMING")
  return {
    days,
    summary: {
      workedDays: past.filter((day) => (day.workday && !day.workday.carriedOver) || day.visits > 0).length,
      plannedDays: past.filter((day) => day.planned > 0).length,
      fieldSeconds: past.reduce((sum, day) => sum + day.fieldSeconds, 0),
      visits: past.reduce((sum, day) => sum + day.visits, 0),
      planned: past.reduce((sum, day) => sum + day.planned, 0),
      visitedPoints: past.reduce((sum, day) => sum + day.visitedPoints, 0),
      distanceMeters: past.reduce((sum, day) => sum + day.distanceMeters, 0),
    },
  }
}
