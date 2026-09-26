/**
 * The demo field day, as pure arithmetic.
 *
 * Owner decision 2026-09-22: the LeadDrive Inc. demo organization is shown to
 * prospects, and its seeded field data stopped on 9 August — every Panel read
 * «В поле 0 · планов на сегодня нет». The demo pulse (demo-pulse.ts) gives a
 * handful of demo agents an ordinary working day, every day, as it unfolds:
 * a published route in the morning, a shift, visits that start and end at
 * their times, a moving dot on the map.
 *
 * This module only decides WHEN things happen for one agent on one day. It is
 * deterministic in (agentId, dayKey): every tick recomputes the same plan, so
 * the executor can create whatever the clock has already passed and nothing
 * twice.
 */

export const MTM_DEMO_PULSE_FEATURE = "mtm-demo-pulse"

/** Stops per demo day: enough to move the map, few enough to finish by evening. */
export const MTM_DEMO_PULSE_STOPS = 5

/** Local hour at which the day's route appears, before anyone starts. */
export const MTM_DEMO_PULSE_ROUTE_PUBLISH_MINUTE = 7 * 60

export type DemoPulseOutcome = "SUCCESSFUL" | "PARTIAL" | "NO_CONTACT"

export type DemoPulseStop = {
  customerId: string
  orderIndex: number
  plannedAt: Date
  checkInAt: Date
  checkOutAt: Date
  durationMinutes: number
  outcome: DemoPulseOutcome
}

export type DemoPulseDay = {
  dayKey: string
  routePublishAt: Date
  shiftStartAt: Date
  shiftEndAt: Date
  stops: DemoPulseStop[]
}

/** 32-bit FNV-1a: a stable seed from the agent and the day. */
function seedOf(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: small, fast and the same on every runtime. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function between(next: () => number, min: number, max: number): number {
  return min + Math.floor(next() * (max - min + 1))
}

/** Day of week of a YYYY-MM-DD key: 0 = Sunday. The key is a calendar date, not an instant. */
export function dayKeyWeekday(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00.000Z`).getUTCDay()
}

/**
 * The agent's day, or null on Sunday — field teams here work Monday to
 * Saturday, and a demo that works seven days a week looks like a demo.
 *
 * @param localMidnight the organization-local midnight of `dayKey` as an instant
 * @param customerIds the agent's customers; the day visits up to five of them
 */
export function planDemoPulseDay(input: {
  agentId: string
  dayKey: string
  localMidnight: Date
  customerIds: readonly string[]
}): DemoPulseDay | null {
  if (dayKeyWeekday(input.dayKey) === 0) return null
  const customers = [...new Set(input.customerIds)].sort()
  if (customers.length === 0) return null

  const next = random(seedOf(`${input.agentId}:${input.dayKey}`))
  const at = (minutes: number) => new Date(input.localMidnight.getTime() + minutes * 60_000)

  // Seeded Fisher–Yates: a different handful of the agent's customers each day.
  for (let index = customers.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1))
    ;[customers[index], customers[other]] = [customers[other], customers[index]]
  }
  const chosen = customers.slice(0, MTM_DEMO_PULSE_STOPS)

  const shiftStart = 9 * 60 + between(next, 0, 25)
  let cursor = shiftStart + between(next, 20, 40)
  const stops: DemoPulseStop[] = chosen.map((customerId, orderIndex) => {
    // The plan is the round number a manager would write; the visit drifts
    // around it the way real ones do.
    const planned = Math.round(cursor / 15) * 15
    const checkIn = cursor
    const duration = between(next, 15, 40)
    const roll = next()
    const outcome: DemoPulseOutcome = roll < 0.8 ? "SUCCESSFUL" : roll < 0.95 ? "PARTIAL" : "NO_CONTACT"
    cursor = checkIn + duration + between(next, 20, 45)
    // A lunch break after the second stop.
    if (orderIndex === 1) cursor += between(next, 35, 60)
    return {
      customerId,
      orderIndex,
      plannedAt: at(planned),
      checkInAt: at(checkIn),
      checkOutAt: at(checkIn + duration),
      durationMinutes: duration,
      outcome,
    }
  })
  const lastCheckOut = stops[stops.length - 1].checkOutAt.getTime()
  const shiftEndAt = new Date(lastCheckOut + between(next, 25, 55) * 60_000)

  return {
    dayKey: input.dayKey,
    routePublishAt: at(MTM_DEMO_PULSE_ROUTE_PUBLISH_MINUTE),
    shiftStartAt: at(shiftStart),
    shiftEndAt,
    stops,
  }
}

/**
 * Where the agent is at `now` during the shift: at the customer during a
 * visit, otherwise on the straight line between the last stop and the next.
 * Null outside the shift. `positions` maps customerId → coordinates.
 */
export function demoPulsePosition(
  day: DemoPulseDay,
  positions: ReadonlyMap<string, { latitude: number; longitude: number }>,
  now: Date,
): { latitude: number; longitude: number; isMoving: boolean } | null {
  const time = now.getTime()
  if (time < day.shiftStartAt.getTime() || time >= day.shiftEndAt.getTime()) return null
  const pointOf = (stop: DemoPulseStop | undefined) => (stop ? positions.get(stop.customerId) ?? null : null)

  for (let index = 0; index < day.stops.length; index += 1) {
    const stop = day.stops[index]
    if (time < stop.checkInAt.getTime()) {
      const previous = index > 0 ? day.stops[index - 1] : null
      const from = pointOf(previous ?? undefined) ?? pointOf(stop)
      const to = pointOf(stop)
      if (!from || !to) return null
      const leftAt = previous ? previous.checkOutAt.getTime() : day.shiftStartAt.getTime()
      const span = Math.max(1, stop.checkInAt.getTime() - leftAt)
      const share = Math.min(1, Math.max(0, (time - leftAt) / span))
      return {
        latitude: from.latitude + (to.latitude - from.latitude) * share,
        longitude: from.longitude + (to.longitude - from.longitude) * share,
        isMoving: previous !== null,
      }
    }
    if (time < stop.checkOutAt.getTime()) {
      const here = pointOf(stop)
      return here ? { ...here, isMoving: false } : null
    }
  }
  const last = pointOf(day.stops[day.stops.length - 1])
  return last ? { ...last, isMoving: true } : null
}
