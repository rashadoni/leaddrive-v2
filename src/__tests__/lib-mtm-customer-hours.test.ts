/**
 * «Часы приёма» of an MTM place (owner, 2026-11-02, mockup «MTM: часы приёма
 * клиентов»): what a valid week is, when a place is open, and how a visit
 * waits for the door or cannot happen — alone and inside the order of a day.
 */
import { describe, expect, it } from "vitest"

import {
  arrivalVerdict,
  hoursOfDay,
  MtmWorkingHoursSchema,
  normalizeWorkingHours,
  openStateAt,
  readWorkingHours,
  weekdayOfDateKey,
  type MtmDayHours,
} from "@/lib/mtm/customer-hours"
import {
  bestRouteOrder,
  readRouteOrder,
  routeOrderIsBetter,
  routeOrderReason,
  totalWait,
  type RouteOrderRoads,
} from "@/lib/mtm/route-order"

const pharmacy: MtmDayHours = { open: "09:00", close: "20:00", breakFrom: "13:00", breakTo: "14:00" }
const week = {
  1: pharmacy, 2: pharmacy, 3: pharmacy, 4: pharmacy, 5: pharmacy,
  6: { open: "10:00", close: "16:00" },
  7: null,
}

describe("a week of hours", () => {
  it("accepts seven days with lunches inside them and a day off", () => {
    const parsed = MtmWorkingHoursSchema.safeParse(week)
    expect(parsed.success).toBe(true)
    const normalized = normalizeWorkingHours(parsed.success ? parsed.data : (null as never))
    expect(normalized[6]).toEqual({ open: "10:00", close: "16:00" })
    expect(normalized[7]).toBeNull()
  })

  it("refuses a day that closes before it opens, half a lunch, a lunch outside the day and a week with no working day", () => {
    expect(MtmWorkingHoursSchema.safeParse({ ...week, 1: { open: "18:00", close: "09:00" } }).success).toBe(false)
    expect(MtmWorkingHoursSchema.safeParse({ ...week, 1: { open: "09:00", close: "18:00", breakFrom: "13:00" } }).success).toBe(false)
    expect(MtmWorkingHoursSchema.safeParse({ ...week, 1: { open: "09:00", close: "18:00", breakFrom: "08:00", breakTo: "09:30" } }).success).toBe(false)
    expect(MtmWorkingHoursSchema.safeParse({ 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null }).success).toBe(false)
    expect(MtmWorkingHoursSchema.safeParse({ ...week, 1: { open: "9:00", close: "18:00" } }).success).toBe(false)
  })

  it("reads anything that is not a valid week as «не указаны», never as a guess", () => {
    expect(readWorkingHours(null)).toBeNull()
    expect(readWorkingHours({ 1: { open: "09:00" } })).toBeNull()
    expect(readWorkingHours("09-18")).toBeNull()
    expect(readWorkingHours(JSON.parse(JSON.stringify(week)))?.[1]).toEqual(pharmacy)
  })

  it("finds the weekday of a date key, Monday first", () => {
    expect(weekdayOfDateKey("2026-11-02")).toBe(1)
    expect(weekdayOfDateKey("2026-11-05")).toBe(4)
    expect(weekdayOfDateKey("2026-11-08")).toBe(7)
    expect(hoursOfDay(readWorkingHours(week), 7)).toBeNull()
    expect(hoursOfDay(null, 1)).toBeUndefined()
  })
})

describe("open or not", () => {
  it("names the state of the door at a minute of the day", () => {
    expect(openStateAt(pharmacy, 8 * 60)).toEqual({ kind: "beforeOpen", opensAt: "09:00" })
    expect(openStateAt(pharmacy, 11 * 60)).toEqual({ kind: "open", closesAt: "20:00", breakFrom: "13:00" })
    expect(openStateAt(pharmacy, 13 * 60 + 20)).toEqual({ kind: "lunch", reopensAt: "14:00" })
    expect(openStateAt(pharmacy, 15 * 60)).toEqual({ kind: "open", closesAt: "20:00", breakFrom: null })
    expect(openStateAt(pharmacy, 20 * 60)).toEqual({ kind: "closed" })
    expect(openStateAt(null, 11 * 60)).toEqual({ kind: "dayOff" })
    expect(openStateAt(undefined, 11 * 60)).toEqual({ kind: "unknown" })
  })

  it("waits for the door before opening and through the lunch, and gives up on a closed place", () => {
    expect(arrivalVerdict(pharmacy, 8 * 60 + 40)).toEqual({ kind: "wait", start: 540, waitMinutes: 20, reason: "beforeOpen" })
    expect(arrivalVerdict(pharmacy, 13 * 60 + 10)).toEqual({ kind: "wait", start: 840, waitMinutes: 50, reason: "lunch" })
    expect(arrivalVerdict(pharmacy, 11 * 60)).toEqual({ kind: "ok", start: 660 })
    expect(arrivalVerdict(pharmacy, 20 * 60 + 5)).toEqual({ kind: "closed", reason: "afterClose" })
    expect(arrivalVerdict(null, 11 * 60)).toEqual({ kind: "closed", reason: "dayOff" })
    expect(arrivalVerdict(undefined, 13 * 60 + 10)).toEqual({ kind: "unknown", start: 790 })
  })
})

/** Stops on a line, a kilometre apart, two minutes a kilometre. */
function lineRoads(positions: number[]): RouteOrderRoads {
  const metres = positions.map((from) => positions.map((to) => Math.abs(from - to) * 1_000))
  return { metres, seconds: metres.map((row) => row.map((value) => value * 0.12)) }
}

describe("hours in the order of a day", () => {
  it("reads the same as before when no place has hours", () => {
    const roads = lineRoads([0, 5, 10])
    const reading = readRouteOrder([0, 1, 2], [570, 600, 615], roads, undefined, [undefined, undefined, undefined])!
    expect(reading).toMatchObject({ arrivals: [570, 610, 650], lateMinutes: [0, 0, 35], onTime: 2, endMinutes: 680, hoursKnown: 0 })
    expect(totalWait(reading)).toBe(0)
  })

  it("waits through the lunch and counts the wait", () => {
    const roads = lineRoads([0, 2])
    const reading = readRouteOrder([0, 1], [540, 780], roads, undefined, [undefined, pharmacy])!
    expect(reading.waitMinutes).toEqual([0, 60])
    expect(reading.closed).toEqual([false, false])
    expect(reading).toMatchObject({ hoursKnown: 1, inHours: 0, endMinutes: 870 })
  })

  it("puts a clinic that closes at 10:30 before it closes, and says why", () => {
    const clinic: MtmDayHours = { open: "08:00", close: "10:30" }
    const roads = lineRoads([0, 2, 4])
    const slots = [540, 600, 660]
    const hours = [undefined, undefined, clinic]
    const current = readRouteOrder([0, 1, 2], slots, roads, undefined, hours)!
    expect(current.closed).toEqual([false, false, true])
    expect(current.onTime).toBe(2)
    const best = bestRouteOrder(slots, roads, undefined, hours)
    const proposed = readRouteOrder(best, slots, roads, undefined, hours)!
    expect(proposed.closed.every((closed) => !closed)).toBe(true)
    expect(best.indexOf(2)).toBeLessThan(2)
    expect(routeOrderIsBetter(current, proposed)).toBe(true)
    expect(routeOrderReason(current, proposed)).toEqual({ kind: "CLOSED_FIXED", stop: 2 })
  })

  it("offers to swap even two stops when the swap spares a lunch wait", () => {
    const roads = lineRoads([0, 1])
    const slots = [780, 840]
    const hours = [pharmacy, undefined]
    const current = readRouteOrder([0, 1], slots, roads, undefined, hours)!
    expect(current.waitMinutes[0]).toBe(60)
    const best = bestRouteOrder(slots, roads, undefined, hours)
    expect(best).toEqual([1, 0])
    const proposed = readRouteOrder(best, slots, roads, undefined, hours)!
    expect(totalWait(proposed)).toBe(0)
    expect(routeOrderReason(current, proposed)).toEqual({ kind: "WAIT_FIXED", stop: 0, waitMinutes: 60 })
  })

  it("cannot fix a place that does not work that day — every order leaves it closed", () => {
    const roads = lineRoads([0, 1, 2])
    const hours = [undefined, null, undefined]
    const best = bestRouteOrder([540, 600, 660], roads, undefined, hours)
    const proposed = readRouteOrder(best, [540, 600, 660], roads, undefined, hours)!
    expect(proposed.closed.filter(Boolean)).toHaveLength(1)
  })
})
