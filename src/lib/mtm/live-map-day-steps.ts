import { MTM_ROUTE_TIMING_TOLERANCE_MINUTES, type MtmRoutePointExecution } from "./route-point-execution"

/**
 * The selected employee's day as steps, for the live map.
 *
 * Owner, 2026-10-08, after a survey of some fifty transport and field-sales
 * products: «по карте думаю нужно больше интерактивности». What every one of
 * them has and this map did not is one linked screen — pick a person on the
 * map or in the list, see the day in order, press a step, and the map goes
 * there. The steps are the stops of today's route with what actually happened
 * at each; this module decides what each step is, the page and the map only
 * draw it.
 *
 * Pure: no React, no fetch.
 */

export type LiveMapDayStepState = "VISITED" | "IN_VISIT" | "NEXT" | "PLANNED" | "SKIPPED"

export interface LiveMapDayStepPoint {
  id: string
  orderIndex: number
  status: string
  plannedTime?: string | Date | null
  customer?: { name?: string | null; latitude?: number | null; longitude?: number | null } | null
}

export interface LiveMapDayStep {
  pointId: string
  orderIndex: number
  /** 1-based position in the plan — the number on the map pin. */
  sequence: number
  name: string
  state: LiveMapDayStepState
  /** The stop has coordinates, so the map can show it. */
  onMap: boolean
  plannedTime: string | null
  checkInAt: string | null
  checkOutAt: string | null
  durationMinutes: number | null
  /** The visit began later than planned, beyond the tolerance. */
  startedLateMinutes: number | null
  /** Not begun, and the planned time passed this many minutes ago. */
  overdueMinutes: number | null
  visitId: string | null
}

function instant(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function usableCoordinates(customer: LiveMapDayStepPoint["customer"]): boolean {
  const latitude = customer?.latitude
  const longitude = customer?.longitude
  return typeof latitude === "number" && typeof longitude === "number" &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 &&
    // Null Island is not a client's address.
    !(latitude === 0 && longitude === 0)
}

export function liveMapDaySteps(
  points: readonly LiveMapDayStepPoint[],
  executions: readonly MtmRoutePointExecution[],
  nowMs: number,
  toleranceMinutes: number = MTM_ROUTE_TIMING_TOLERANCE_MINUTES,
): LiveMapDayStep[] {
  const ordered = [...points].sort((left, right) => left.orderIndex - right.orderIndex)
  const facts = new Map(executions.map((fact) => [fact.pointId, fact]))
  let nextTaken = false
  return ordered.map((point, index) => {
    const fact = facts.get(point.id)
    // A visit that is open is open: the agent is there now, whatever the stop's own status says.
    const inVisit = Boolean(fact?.visit && fact.checkInAt && !fact.checkOutAt)
    let state: LiveMapDayStepState
    if (point.status === "SKIPPED") state = "SKIPPED"
    else if (inVisit) state = "IN_VISIT"
    else if (point.status === "VISITED" || fact?.checkInAt) state = "VISITED"
    else if (!nextTaken) {
      state = "NEXT"
      nextTaken = true
    } else state = "PLANNED"

    const plannedAt = instant(point.plannedTime)
    const waiting = state === "NEXT" || state === "PLANNED"
    const overdue = waiting && plannedAt !== null ? Math.round((nowMs - plannedAt) / 60_000) : null
    return {
      pointId: point.id,
      orderIndex: point.orderIndex,
      sequence: fact?.plannedSequence ?? index + 1,
      name: point.customer?.name?.trim() || "",
      state,
      onMap: usableCoordinates(point.customer),
      plannedTime: plannedAt === null ? null : new Date(plannedAt).toISOString(),
      checkInAt: fact?.checkInAt ?? null,
      // Without visit facts the summary puts «visited at» into checkOutAt; that is a closing time only.
      checkOutAt: fact?.checkOutAt ?? null,
      durationMinutes: fact?.durationMinutes ?? null,
      startedLateMinutes: fact?.timing === "LATE" ? fact.delayMinutes : null,
      overdueMinutes: overdue !== null && overdue > toleranceMinutes ? overdue : null,
      visitId: fact?.visit?.id ?? null,
    }
  })
}

/** «2 of 4»: stops the employee has been to or is at, out of the day's stops. Skipped stops are not counted as done. */
export function liveMapDayProgress(steps: readonly LiveMapDayStep[]): { done: number; total: number } {
  return {
    done: steps.filter((step) => step.state === "VISITED" || step.state === "IN_VISIT").length,
    total: steps.length,
  }
}
