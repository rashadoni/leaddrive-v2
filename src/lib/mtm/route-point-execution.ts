/**
 * Plan versus fact for the stops of one route.
 *
 * Prod audit 2026-09-14, route of 14 September with two stops:
 * #1 planned 09:00, visited 18:49–18:53; #2 planned 09:30, visited 16:46–17:09.
 * The route dialog showed one time per stop (the check-out, labelled as if it
 * were the visit) and nothing else — not that both visits were eight hours
 * late, not that they were made in reverse order, not how long each lasted.
 * Every one of those facts is in the visit rows; this module derives them in
 * one place so the dialog, the week grid and the live map agree.
 */

export interface MtmRoutePointVisitFact {
  id: string
  status: string
  checkInAt: string | Date | null
  checkOutAt?: string | Date | null
  checkInLat?: number | null
  checkInLng?: number | null
  checkOutLat?: number | null
  checkOutLng?: number | null
  /** Route detail: coordinates were withheld (co-participant outside the reader's scope), not missing. */
  locationHidden?: boolean | null
  photoCount?: number | null
  hasSignature?: boolean | null
  hasNote?: boolean | null
}

export interface MtmRoutePointExecutionInput {
  id: string
  orderIndex: number
  status: string
  plannedTime?: string | Date | null
  visitedAt?: string | Date | null
  visits?: MtmRoutePointVisitFact[] | null
}

export type MtmRoutePointTiming = "ON_TIME" | "LATE" | "EARLY" | "NOT_PLANNED" | "NOT_VISITED"

export interface MtmRoutePointExecution {
  pointId: string
  /** 1-based position in the plan. */
  plannedSequence: number
  /** 1-based position among visited stops by check-in time; null when not visited. */
  actualSequence: number | null
  /** Visited in a different position than planned, among the visited stops. */
  outOfOrder: boolean
  visit: MtmRoutePointVisitFact | null
  checkInAt: string | null
  checkOutAt: string | null
  durationMinutes: number | null
  /** Check-in minus planned time, whole minutes; negative = early. */
  delayMinutes: number | null
  timing: MtmRoutePointTiming
}

export interface MtmRouteExecutionSummary {
  points: MtmRoutePointExecution[]
  visitedCount: number
  totalCount: number
  firstCheckInAt: string | null
  lastCheckOutAt: string | null
  lateCount: number
  outOfOrderCount: number
}

export const MTM_ROUTE_TIMING_TOLERANCE_MINUTES = 15

function instant(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

/** The visit that stands for the stop: the earliest one that was not cancelled. */
function primaryVisit(visits: MtmRoutePointVisitFact[] | null | undefined): MtmRoutePointVisitFact | null {
  const usable = (visits ?? []).filter((visit) => visit.status !== "CANCELLED" && instant(visit.checkInAt) !== null)
  usable.sort((a, b) => (instant(a.checkInAt) ?? 0) - (instant(b.checkInAt) ?? 0))
  return usable[0] ?? null
}

export function summarizeMtmRouteExecution(
  points: MtmRoutePointExecutionInput[],
  options: { toleranceMinutes?: number } = {},
): MtmRouteExecutionSummary {
  const tolerance = options.toleranceMinutes ?? MTM_ROUTE_TIMING_TOLERANCE_MINUTES
  const planned = [...points].sort((a, b) => a.orderIndex - b.orderIndex)

  const rows = planned.map((point, index) => {
    const visit = primaryVisit(point.visits)
    const checkIn = instant(visit?.checkInAt)
    // A list payload without visits still knows when the stop was closed.
    const checkOut = instant(visit ? visit.checkOutAt : point.visitedAt)
    const plannedAt = instant(point.plannedTime)
    const durationMinutes = checkIn !== null && checkOut !== null && checkOut >= checkIn
      ? Math.round((checkOut - checkIn) / 60_000)
      : null
    const delayMinutes = checkIn !== null && plannedAt !== null ? Math.round((checkIn - plannedAt) / 60_000) : null
    const timing: MtmRoutePointTiming = checkIn === null
      ? "NOT_VISITED"
      : delayMinutes === null
        ? "NOT_PLANNED"
        : delayMinutes > tolerance
          ? "LATE"
          : delayMinutes < -tolerance
            ? "EARLY"
            : "ON_TIME"
    return { point, index, visit, checkIn, checkOut, durationMinutes, delayMinutes, timing }
  })

  const visitedInPlanOrder = rows.filter((row) => row.checkIn !== null)
  const visitedInFactOrder = [...visitedInPlanOrder].sort((a, b) =>
    (a.checkIn! - b.checkIn!) || (a.point.orderIndex - b.point.orderIndex))
  const actualRank = new Map(visitedInFactOrder.map((row, rank) => [row.point.id, rank]))
  const plannedRank = new Map(visitedInPlanOrder.map((row, rank) => [row.point.id, rank]))

  const executions: MtmRoutePointExecution[] = rows.map((row) => {
    const actual = actualRank.get(row.point.id)
    return {
      pointId: row.point.id,
      plannedSequence: row.index + 1,
      actualSequence: actual === undefined ? null : actual + 1,
      outOfOrder: actual !== undefined && actual !== plannedRank.get(row.point.id),
      visit: row.visit,
      checkInAt: isoOrNull(row.checkIn),
      checkOutAt: isoOrNull(row.checkOut),
      durationMinutes: row.durationMinutes,
      delayMinutes: row.delayMinutes,
      timing: row.timing,
    }
  })

  const checkIns = rows.flatMap((row) => row.checkIn === null ? [] : [row.checkIn])
  const checkOuts = rows.flatMap((row) => row.checkOut === null ? [] : [row.checkOut])
  return {
    points: executions,
    visitedCount: rows.filter((row) => row.checkIn !== null || row.point.status === "VISITED").length,
    totalCount: rows.length,
    firstCheckInAt: checkIns.length ? isoOrNull(Math.min(...checkIns)) : null,
    lastCheckOutAt: checkOuts.length ? isoOrNull(Math.max(...checkOuts)) : null,
    lateCount: executions.filter((row) => row.timing === "LATE").length,
    outOfOrderCount: executions.filter((row) => row.outOfOrder).length,
  }
}

/** 203 → { hours: 3, minutes: 23 }; rendered as «3 saat 23 dəq» by the caller. */
export function mtmDurationParts(totalMinutes: number): { hours: number; minutes: number } {
  const safe = Math.max(0, Math.round(totalMinutes))
  return { hours: Math.floor(safe / 60), minutes: safe % 60 }
}
