import { calculateHistoryDistance, prepareHistoryPoints, type HistoryLocationPoint } from "@/lib/mtm/location-history"
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

export type AgentPeriodDayStatus = "FULL" | "PARTIAL" | "NOT_WORKED" | "UNPLANNED" | "DAY_OFF" | "UPCOMING"

export type AgentPeriodDay = {
  date: string
  workday: { startedAt: string; completedAt: string | null } | null
  fieldSeconds: number
  visits: number
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

type Workday = { workDate: Date; startedAt: Date; completedAt: Date | null; totalPausedSeconds: number }
type Visit = { checkInAt: Date; status: string }
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
    const workday = input.workdays.find((row) => row.workDate.toISOString().slice(0, 10) === date) ?? null
    const dayPoints = pointsByDay.get(date) ?? []
    // Published plans only: a draft never reached the agent, a cancelled one was withdrawn.
    const routes = input.routes.filter((route) => route.date.toISOString().slice(0, 10) === date && route.status !== "DRAFT" && route.status !== "CANCELLED")
    const planned = routes.reduce((sum, route) => sum + route.totalPoints, 0)
    const visitedPoints = routes.reduce((sum, route) => sum + route.visitedPoints, 0)
    const visits = input.visits.filter((visit) => visit.status !== "CANCELLED" && keyOf(visit.checkInAt) === date).length
    const distanceMeters = dayPoints.length > 1
      ? calculateHistoryDistance(prepareHistoryPoints([...dayPoints], input.maxAccuracyMeters).points)
      : 0

    // Time in the field: the workday on its own date. One left open (the
    // owner's own test shift ran for days) ends at its last fix that day —
    // never at "now" days later.
    let fieldSeconds = 0
    if (workday) {
      const lastPoint = dayPoints.reduce((latest, point) => Math.max(latest, point.recordedAt.getTime()), 0)
      const end = Math.min(
        workday.completedAt?.getTime() ?? (lastPoint || workday.startedAt.getTime()),
        dayEnd(date, timezone),
        input.now.getTime(),
      )
      fieldSeconds = Math.max(0, Math.round((end - workday.startedAt.getTime()) / 1_000) - workday.totalPausedSeconds)
    }

    const worked = Boolean(workday) || visits > 0
    const status: AgentPeriodDayStatus = date > today
      ? "UPCOMING"
      : !worked
        ? planned > 0 ? "NOT_WORKED" : "DAY_OFF"
        : planned === 0
          ? "UNPLANNED"
          : visitedPoints < planned ? "PARTIAL" : "FULL"

    return {
      date,
      workday: workday ? { startedAt: workday.startedAt.toISOString(), completedAt: workday.completedAt?.toISOString() ?? null } : null,
      fieldSeconds,
      visits,
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
      workedDays: past.filter((day) => day.workday || day.visits > 0).length,
      plannedDays: past.filter((day) => day.planned > 0).length,
      fieldSeconds: past.reduce((sum, day) => sum + day.fieldSeconds, 0),
      visits: past.reduce((sum, day) => sum + day.visits, 0),
      planned: past.reduce((sum, day) => sum + day.planned, 0),
      visitedPoints: past.reduce((sum, day) => sum + day.visitedPoints, 0),
      distanceMeters: past.reduce((sum, day) => sum + day.distanceMeters, 0),
    },
  }
}
