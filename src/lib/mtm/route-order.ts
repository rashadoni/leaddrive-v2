/**
 * «Есть порядок объезда лучше» (owner, 2026-11-01, mockup «MTM: порядок
 * объезда лучше», approved with «Давай, начинай»): the order of a day's visits
 * that drives less and keeps more visits on their time, read along the roads.
 *
 * The planner keeps the times with the positions — a stop moved to second
 * place takes the second time of the day — so an order is judged against the
 * same times: the first visit starts at the first time, each next one at its
 * own time or as soon as the agent can get there, whichever is later. A visit
 * is late when he arrives more than a few minutes after its time.
 *
 * The roads are a matrix of seconds and metres between the stops (OSRM's
 * table, road-router.ts); the start is wherever the order begins and the day
 * ends at the last visit — where the agent sleeps is not known.
 *
 * A place's «часы приёма» (customer-hours.ts) bind too, when the planner
 * knows them: before opening or in the lunch the agent waits for the door, and
 * a place closed by then — or not working that day — cannot be visited. Both
 * weigh in the choice of order; a place nobody gave hours for binds nothing.
 *
 * Pure: no network, no clock.
 */
import { arrivalVerdict, type MtmDayHours } from "@/lib/mtm/customer-hours"

/** How long a visit lasts when the planner says nothing else. */
export const MTM_ROUTE_ORDER_VISIT_MINUTES = 30
/** Arriving up to this much after the time is still on time. */
export const MTM_ROUTE_ORDER_LATE_AFTER_MINUTES = 10
/** Every exact order is tried up to this many stops; beyond it, a local search. */
const EXACT_UP_TO = 8
/** A minute late weighs as much as this many minutes at the wheel. */
const LATE_WEIGHT = 10
/** A minute waiting at a closed door weighs as much as a minute at the wheel. */
const WAIT_WEIGHT = 1
/** A visit that cannot happen — the place is closed — weighs as a long detour. */
const CLOSED_WEIGHT = 600
/** Less waiting worth showing an order for, when nothing else changes. */
const WAIT_SAVED_WORTH = 15

export interface RouteOrderRoads {
  /** seconds[from][to] along the roads; null where no road joins them. */
  seconds: ReadonlyArray<ReadonlyArray<number | null>>
  metres: ReadonlyArray<ReadonlyArray<number | null>>
}

export interface RouteOrderReading {
  /** Stop indices in the order read. */
  order: number[]
  /** Minutes after midnight he arrives at each position. */
  arrivals: number[]
  /** Minutes late at each position, 0 when on time. */
  lateMinutes: number[]
  /** Minutes waiting for the door (before opening, the lunch) at each position. */
  waitMinutes: number[]
  /** Whether the place at each position is closed by then or that day. */
  closed: boolean[]
  /** How many of the stops have hours at all. */
  hoursKnown: number
  /** Stops with hours visited without waiting and not closed. */
  inHours: number
  driveSeconds: number
  metres: number
  onTime: number
  /** Minutes after midnight the last visit ends. */
  endMinutes: number
}

/** «09:30» → 570; anything else → null. */
export function routeOrderMinutes(time: string | null | undefined): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time ?? "")
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/** 570 → «09:30». */
export function routeOrderClock(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes))
  return `${String(Math.floor(whole / 60) % 24).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`
}

/**
 * Reads one order against the day's times, held by position: `times[i]` is
 * the time of the i-th visit, whichever stop is there.
 */
export function readRouteOrder(
  order: readonly number[],
  times: readonly number[],
  roads: RouteOrderRoads,
  visitMinutes = MTM_ROUTE_ORDER_VISIT_MINUTES,
  hours?: ReadonlyArray<MtmDayHours | null | undefined>,
): RouteOrderReading | null {
  const arrivals: number[] = []
  const lateMinutes: number[] = []
  const waitMinutes: number[] = []
  const closed: boolean[] = []
  let hoursKnown = 0
  let inHours = 0
  let driveSeconds = 0
  let metres = 0
  let free = times[0] ?? 0
  for (let position = 0; position < order.length; position += 1) {
    let arrival = free
    if (position > 0) {
      const seconds = roads.seconds[order[position - 1]]?.[order[position]]
      const length = roads.metres[order[position - 1]]?.[order[position]]
      if (seconds == null || length == null) return null
      driveSeconds += seconds
      metres += length
      arrival = free + seconds / 60
    }
    const time = times[position] ?? arrival
    arrivals.push(arrival)
    const late = arrival - time
    lateMinutes.push(late > MTM_ROUTE_ORDER_LATE_AFTER_MINUTES ? Math.round(late) : 0)
    const ready = Math.max(arrival, time)
    const day = hours?.[order[position]]
    if (day !== undefined) hoursKnown += 1
    const verdict = arrivalVerdict(day, ready)
    if (verdict.kind === "closed") {
      // No visit: he moves on from the closed door.
      waitMinutes.push(0)
      closed.push(true)
      free = ready
      continue
    }
    const wait = verdict.kind === "wait" ? verdict.waitMinutes : 0
    if (verdict.kind === "ok") inHours += 1
    waitMinutes.push(wait)
    closed.push(false)
    free = verdict.start + visitMinutes
  }
  return {
    order: [...order],
    arrivals,
    lateMinutes,
    waitMinutes,
    closed,
    hoursKnown,
    inHours,
    driveSeconds,
    metres,
    onTime: lateMinutes.filter((late, position) => late === 0 && !closed[position]).length,
    endMinutes: free,
  }
}

function cost(reading: RouteOrderReading | null): number {
  if (!reading) return Number.POSITIVE_INFINITY
  return reading.driveSeconds / 60
    + LATE_WEIGHT * reading.lateMinutes.reduce((sum, late) => sum + late, 0)
    + WAIT_WEIGHT * totalWait(reading)
    + CLOSED_WEIGHT * closedCount(reading)
}

/** Minutes waiting at closed doors over the whole day. */
export function totalWait(reading: RouteOrderReading): number {
  return reading.waitMinutes.reduce((sum, wait) => sum + wait, 0)
}

/** Visits that cannot happen: closed by then or that day. */
export function closedCount(reading: RouteOrderReading): number {
  return reading.closed.filter(Boolean).length
}

function permutations(count: number, visit: (order: number[]) => void) {
  const order = Array.from({ length: count }, (_, index) => index)
  const swap = (a: number, b: number) => { const keep = order[a]; order[a] = order[b]; order[b] = keep }
  const walk = (from: number) => {
    if (from === count) return visit(order)
    for (let index = from; index < count; index += 1) {
      swap(from, index)
      walk(from + 1)
      swap(from, index)
    }
  }
  walk(0)
}

/** Each start, the nearest next stop; then moving and reversing pieces while it helps. */
function localSearch(count: number, judge: (order: number[]) => number, roads: RouteOrderRoads): number[] {
  let best: number[] = []
  let bestCost = Number.POSITIVE_INFINITY
  for (let start = 0; start < count; start += 1) {
    const order = [start]
    const left = new Set(Array.from({ length: count }, (_, index) => index).filter((index) => index !== start))
    while (left.size) {
      const from = order[order.length - 1]
      let next = -1
      for (const candidate of left) {
        const seconds = roads.seconds[from]?.[candidate] ?? Number.POSITIVE_INFINITY
        if (next < 0 || seconds < (roads.seconds[from]?.[next] ?? Number.POSITIVE_INFINITY)) next = candidate
      }
      order.push(next)
      left.delete(next)
    }
    let current = judge(order)
    for (let improved = true, rounds = 0; improved && rounds < 50; rounds += 1) {
      improved = false
      // Reverse a piece.
      for (let a = 0; a < count - 1; a += 1) {
        for (let b = a + 1; b < count; b += 1) {
          const trial = [...order.slice(0, a), ...order.slice(a, b + 1).reverse(), ...order.slice(b + 1)]
          const trialCost = judge(trial)
          if (trialCost + 1e-9 < current) { order.splice(0, count, ...trial); current = trialCost; improved = true }
        }
      }
      // Move one stop elsewhere.
      for (let from = 0; from < count; from += 1) {
        for (let to = 0; to < count; to += 1) {
          if (from === to) continue
          const trial = [...order]
          const [moved] = trial.splice(from, 1)
          trial.splice(to, 0, moved)
          const trialCost = judge(trial)
          if (trialCost + 1e-9 < current) { order.splice(0, count, ...trial); current = trialCost; improved = true }
        }
      }
    }
    if (current < bestCost) { best = [...order]; bestCost = current }
  }
  return best
}

/**
 * The best order the roads allow, against the same times by position. Ties
 * keep the order the planner already has, so a route that cannot be bettered
 * is offered nothing.
 */
export function bestRouteOrder(
  times: readonly number[],
  roads: RouteOrderRoads,
  visitMinutes = MTM_ROUTE_ORDER_VISIT_MINUTES,
  hours?: ReadonlyArray<MtmDayHours | null | undefined>,
): number[] {
  const count = times.length
  const identity = Array.from({ length: count }, (_, index) => index)
  // Two stops have an order worth weighing only when a door binds them.
  if (count < (hours?.some((day) => day !== undefined) ? 2 : 3)) return identity
  const judge = (order: number[]) => cost(readRouteOrder(order, times, roads, visitMinutes, hours))
  let best = identity
  let bestCost = judge(identity)
  const consider = (order: number[]) => {
    const trialCost = judge(order)
    if (trialCost + 1e-9 < bestCost) { best = [...order]; bestCost = trialCost }
  }
  if (count <= EXACT_UP_TO) permutations(count, consider)
  else consider(localSearch(count, judge, roads))
  return best
}

/**
 * Whether the better order is worth showing: a few minutes and a few per cent
 * less at the wheel, or a visit more on its time. A shuffle that saves a
 * minute is noise in a manager's day.
 */
export function routeOrderIsBetter(current: RouteOrderReading, proposed: RouteOrderReading): boolean {
  if (closedCount(proposed) < closedCount(current)) return true
  if (closedCount(proposed) > closedCount(current)) return false
  if (proposed.onTime > current.onTime) return true
  if (proposed.onTime < current.onTime) return false
  if (totalWait(current) - totalWait(proposed) >= WAIT_SAVED_WORTH) return true
  if (totalWait(proposed) > totalWait(current)) return false
  const saved = current.driveSeconds - proposed.driveSeconds
  return saved >= 180 && saved >= current.driveSeconds * 0.05
}

/**
 * The one reason a person reads first: a visit that becomes on time, else the
 * road saved. Positions are 0-based stop indices.
 */
export function routeOrderReason(
  current: RouteOrderReading,
  proposed: RouteOrderReading,
):
  | { kind: "CLOSED_FIXED"; stop: number }
  | { kind: "WAIT_FIXED"; stop: number; waitMinutes: number }
  | { kind: "LATE_FIXED"; stop: number; lateMinutes: number }
  | { kind: "SHORTER"; metres: number; seconds: number } {
  const proposedAt = (stop: number) => proposed.order.indexOf(stop)
  for (let position = 0; position < current.order.length; position += 1) {
    const stop = current.order[position]
    if (current.closed[position] && !proposed.closed[proposedAt(stop)]) return { kind: "CLOSED_FIXED", stop }
  }
  for (let position = 0; position < current.order.length; position += 1) {
    const stop = current.order[position]
    const wait = current.waitMinutes[position]
    if (wait >= WAIT_SAVED_WORTH && proposed.waitMinutes[proposedAt(stop)] === 0) return { kind: "WAIT_FIXED", stop, waitMinutes: wait }
  }
  for (let position = 0; position < current.order.length; position += 1) {
    const stop = current.order[position]
    const late = current.lateMinutes[position]
    if (late > 0 && proposed.lateMinutes[proposed.order.indexOf(stop)] === 0) return { kind: "LATE_FIXED", stop, lateMinutes: late }
  }
  return { kind: "SHORTER", metres: Math.max(0, current.metres - proposed.metres), seconds: Math.max(0, current.driveSeconds - proposed.driveSeconds) }
}
