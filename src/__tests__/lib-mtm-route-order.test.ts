/**
 * «Есть порядок объезда лучше» (owner, 2026-11-01, mockup «MTM: порядок
 * объезда лучше»): the order of the day's visits that drives less and keeps
 * more visits on their time, judged against the same times by position.
 */
import { describe, expect, it } from "vitest"

import {
  bestRouteOrder,
  readRouteOrder,
  routeOrderClock,
  routeOrderIsBetter,
  routeOrderMinutes,
  routeOrderReason,
  type RouteOrderRoads,
} from "@/lib/mtm/route-order"

/** Stops on a line, a kilometre apart, driven at 30 km/h: two minutes a kilometre. */
function lineRoads(positions: number[]): RouteOrderRoads {
  const metres = positions.map((from) => positions.map((to) => Math.abs(from - to) * 1_000))
  return { metres, seconds: metres.map((row) => row.map((value) => value * 0.12)) }
}

describe("reading one order", () => {
  it("starts at the first time, drives along the roads, waits for a visit's time and is late only past ten minutes", () => {
    const roads = lineRoads([0, 5, 10])
    const reading = readRouteOrder([0, 1, 2], [570, 600, 615], roads)!
    // 09:30 visit, 30 min, 10 min to the next: 10:10, ten minutes after its 10:00 — still on time.
    expect(reading.arrivals).toEqual([570, 610, 650])
    expect(reading.lateMinutes).toEqual([0, 0, 35])
    expect(reading).toMatchObject({ driveSeconds: 1_200, metres: 10_000, onTime: 2, endMinutes: 680 })
  })

  it("says nothing when two stops have no road between them", () => {
    const roads = lineRoads([0, 1, 2])
    roads.seconds[0] = [0, null, 240]
    expect(readRouteOrder([0, 1, 2], [570, 630, 690], roads)).toBeNull()
  })
})

describe("the best order", () => {
  it("drives the line once instead of zigzagging along it", () => {
    // Stops at 0, 8, 2, 6, 4 km — in that order the agent drives 20 km.
    const positions = [0, 8, 2, 6, 4]
    const roads = lineRoads(positions)
    const times = [570, 630, 690, 750, 810]
    const best = bestRouteOrder(times, roads)
    expect(best.map((index) => positions[index])).toEqual([0, 2, 4, 6, 8])
    const current = readRouteOrder([0, 1, 2, 3, 4], times, roads)!
    const proposed = readRouteOrder(best, times, roads)!
    expect([current.metres, proposed.metres]).toEqual([20_000, 8_000])
    expect(routeOrderIsBetter(current, proposed)).toBe(true)
    expect(routeOrderReason(current, proposed)).toEqual({ kind: "SHORTER", metres: 12_000, seconds: 1_440 })
  })

  it("keeps the order a route already has when nothing is better", () => {
    const roads = lineRoads([0, 1, 2, 3])
    expect(bestRouteOrder([570, 630, 690, 750], roads)).toEqual([0, 1, 2, 3])
  })

  it("finds the same answer by local search when there are too many stops to try every order", () => {
    const positions = [0, 9, 1, 8, 2, 7, 3, 6, 4, 5, 10, 11]
    const roads = lineRoads(positions)
    const times = positions.map((_, index) => 540 + index * 45)
    const best = bestRouteOrder(times, roads)
    expect(new Set(best).size).toBe(positions.length)
    expect(readRouteOrder(best, times, roads)!.metres).toBe(11_000)
  })

  it("puts a late visit back on its time, choosing among orders that drive about the same", () => {
    // A and C a kilometre apart, B twenty away; visits at 09:00, 10:00, 11:00.
    const metres = [[0, 1_000, 20_000], [1_000, 0, 20_500], [20_000, 20_500, 0]]
    const roads: RouteOrderRoads = { metres, seconds: metres.map((row) => row.map((value) => value * 0.12)) }
    const times = [540, 600, 660]
    // A, C, then B: forty-one minutes from C, eleven minutes past 11:00.
    const current = readRouteOrder([0, 1, 2], times, roads)!
    expect(current.lateMinutes).toEqual([0, 0, 11])
    // Starting at B, or reaching it straight from A: everybody on time, a minute less at the wheel.
    const best = bestRouteOrder(times, roads)
    const proposed = readRouteOrder(best, times, roads)!
    expect(proposed.lateMinutes).toEqual([0, 0, 0])
    expect(proposed.driveSeconds).toBe(2_520)
    expect(routeOrderIsBetter(current, proposed)).toBe(true)
    expect(routeOrderReason(current, proposed)).toEqual({ kind: "LATE_FIXED", stop: 2, lateMinutes: 11 })
  })

  it("offers nothing for a minute saved: a shuffle that small is noise", () => {
    const current = readRouteOrder([0, 1, 2], [570, 630, 690], lineRoads([0, 5, 10]))!
    const almost = { ...current, driveSeconds: current.driveSeconds - 60 }
    expect(routeOrderIsBetter(current, almost)).toBe(false)
    expect(routeOrderIsBetter(current, { ...current, onTime: current.onTime + 1 })).toBe(true)
  })

  it("names the visit that becomes on time before the road saved", () => {
    const current = { order: [0, 1, 2], arrivals: [570, 640, 745], lateMinutes: [0, 0, 25], driveSeconds: 2_700, metres: 12_400, onTime: 2, endMinutes: 760 }
    const proposed = { order: [2, 0, 1], arrivals: [570, 625, 690], lateMinutes: [0, 0, 0], driveSeconds: 1_500, metres: 7_200, onTime: 3, endMinutes: 705 }
    expect(routeOrderReason(current, proposed)).toEqual({ kind: "LATE_FIXED", stop: 2, lateMinutes: 25 })
  })
})

describe("the clock", () => {
  it("reads and writes the planner's times", () => {
    expect([routeOrderMinutes("09:30"), routeOrderMinutes("24:00"), routeOrderMinutes("9:30"), routeOrderMinutes(null)]).toEqual([570, null, null, null])
    expect([routeOrderClock(570), routeOrderClock(745.4)]).toEqual(["09:30", "12:25"])
  })
})
