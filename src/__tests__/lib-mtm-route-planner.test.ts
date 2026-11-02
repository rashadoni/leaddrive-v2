import { describe, expect, it } from "vitest"
import {
  routePlannerDayMinutes,
  routePlannerDistanceKm,
  routePlannerLengthKm,
  routePlannerNextSlot,
  routePlannerPlaces,
  suggestRoutePlannerStops,
  type RoutePlannerCandidate,
} from "@/lib/mtm/route-planner"

/** About this many metres north / east of a point in Baku. */
const BAKU = { latitude: 40.3988, longitude: 49.8301 }
const north = (meters: number) => BAKU.latitude + meters / 111_195
const east = (meters: number) => BAKU.longitude + meters / 84_900

const org = (id: string, over: Partial<RoutePlannerCandidate> = {}): RoutePlannerCandidate => ({
  key: id, customerId: id, contactId: null, name: `Clinic ${id}`, placeName: `Clinic ${id}`, address: null, specialtyName: null,
  category: "B", latitude: BAKU.latitude, longitude: BAKU.longitude, lastVisitAt: null, monthlyVisitCount: 0, ...over,
})
const doctor = (customerId: string, contactId: string, over: Partial<RoutePlannerCandidate> = {}): RoutePlannerCandidate => ({
  ...org(customerId), key: `${customerId}:${contactId}`, contactId, name: `Dr ${contactId}`, ...over,
})
const at = (metersNorth: number, metersEast = 0) => ({ latitude: north(metersNorth), longitude: east(metersEast) })

describe("the route planner's map", () => {
  it("draws one point per organization, with its doctors under it — never one without a place", () => {
    const places = routePlannerPlaces([
      doctor("c1", "d2"), org("c1"), doctor("c1", "d1", { monthlyVisitCount: 2 }),
      org("c2", { latitude: null, longitude: null }),
      org("c3", { latitude: 0, longitude: 0 }),
    ])
    expect(places.map((place) => place.customerId)).toEqual(["c1"])
    // The organization itself first, then its doctors by name.
    expect(places[0].candidates.map((candidate) => candidate.key)).toEqual(["c1", "c1:d1", "c1:d2"])
    expect(places[0].dueThisMonth).toBe(true)
    expect(routePlannerPlaces([org("c4", { monthlyVisitCount: 1 })])[0].dueThisMonth).toBe(false)
  })

  it("measures the route stop to stop, in its order, skipping a stop without a place", () => {
    expect(routePlannerDistanceKm(at(0), at(1_000))).toBeCloseTo(1, 2)
    expect(routePlannerLengthKm([at(0), { latitude: null, longitude: null }, at(1_000), at(1_000, 1_000)])).toBeCloseTo(2, 1)
  })

  it("puts each new stop an hour after the last, on a half-hour slot, starting at 09:30", () => {
    expect(routePlannerNextSlot(null)).toBe("09:30")
    expect(routePlannerNextSlot("09:30")).toBe("10:30")
    expect(routePlannerNextSlot("23:30")).toBe("23:30")
    // A time off the slots is not a time to count from.
    expect(routePlannerNextSlot("10:15")).toBe("09:30")
    expect(routePlannerDayMinutes(["09:30", "10:30", "13:30"])).toBe(5 * 60)
    expect(routePlannerDayMinutes([])).toBeNull()
  })
})

describe("«Предложить маршрут»", () => {
  it("starts where most due clients are close together and walks to the nearest one each time", () => {
    const candidates = [
      // A far one, alone.
      org("far", at(9_000)),
      // Three close together, and one a little apart.
      org("a", at(0)), org("b", at(300)), org("c", at(600)), org("d", at(2_500)),
      // Visited this month: never offered.
      org("visited", at(150, 50)),
    ]
    candidates[5].monthlyVisitCount = 3

    const picked = suggestRoutePlannerStops({ candidates, route: [], maxStops: 4 })

    // a, b and c each have the other two within 1.5 km; on a tie, the first by name.
    expect(picked.map((candidate) => candidate.key)).toEqual(["a", "b", "c", "d"])
  })

  it("goes on from the route's last stop and offers nothing already in it", () => {
    const candidates = [org("a", at(0)), org("b", at(400)), org("c", at(5_000))]
    const route = [{ customerId: "b", latitude: north(400), longitude: east(0) }]

    expect(suggestRoutePlannerStops({ candidates, route, maxStops: 2 }).map((candidate) => candidate.key)).toEqual(["a"])
    expect(suggestRoutePlannerStops({ candidates, route: [...route, { customerId: "a", latitude: north(0), longitude: east(0) }], maxStops: 2 })).toEqual([])
  })

  it("visits the doctors where there are doctors, the organization only where there are none", () => {
    const candidates = [
      org("hospital", at(0)), doctor("hospital", "d1", at(0)), doctor("hospital", "d2", at(0)),
      doctor("hospital", "seen", { ...at(0), monthlyVisitCount: 1 }),
      org("pharmacy", at(200)),
    ]

    expect(suggestRoutePlannerStops({ candidates, route: [], maxStops: 6 }).map((candidate) => candidate.key))
      .toEqual(["hospital:d1", "hospital:d2", "pharmacy"])
  })

  it("offers nothing when everybody was visited this month", () => {
    expect(suggestRoutePlannerStops({ candidates: [org("a", { monthlyVisitCount: 1 })], route: [] })).toEqual([])
  })
})
