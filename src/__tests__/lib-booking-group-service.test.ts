import { describe, it, expect } from "vitest"
import { isGroupService, MAX_CAPACITY, seatsByStart, seatsLeft, serviceCapacity } from "@/lib/booking/group-service"

/**
 * A class is one time and several customers — and one master. The arithmetic
 * here decides whether a time is still offered, so «unreadable» has to mean
 * «one at a time»: a service that accidentally reads as a class would let the
 * salon sell the same chair eight times.
 */
describe("how many people a service takes at once", () => {
  it("reads one where nothing says otherwise", () => {
    expect(serviceCapacity({})).toBe(1)
    expect(serviceCapacity({ capacity: null })).toBe(1)
    expect(serviceCapacity({ capacity: 0 })).toBe(1)
    expect(serviceCapacity({ capacity: -4 })).toBe(1)
    expect(serviceCapacity({ capacity: 1.7 })).toBe(1)
    expect(isGroupService({ capacity: 1 })).toBe(false)
  })

  it("reads a class where it is one, and never a hall", () => {
    expect(serviceCapacity({ capacity: 8 })).toBe(8)
    expect(isGroupService({ capacity: 8 })).toBe(true)
    expect(serviceCapacity({ capacity: 5000 })).toBe(MAX_CAPACITY)
  })

  it("counts seats left, and a full class stays full", () => {
    expect(seatsLeft({ capacity: 8 }, 3)).toBe(5)
    expect(seatsLeft({ capacity: 8 }, 8)).toBe(0)
    // An overbooked class is full, not negative.
    expect(seatsLeft({ capacity: 8 }, 11)).toBe(0)
    expect(seatsLeft({ capacity: 1 }, 0)).toBe(1)
  })

  it("counts the seats of each class by the instant it starts", () => {
    const seats = seatsByStart([
      { startsAt: new Date("2026-11-09T06:00:00.000Z") },
      { startsAt: new Date("2026-11-09T06:00:00.000Z") },
      { startsAt: new Date("2026-11-09T07:00:00.000Z") },
    ])
    expect(seats.get("2026-11-09T06:00:00.000Z")).toBe(2)
    expect(seats.get("2026-11-09T07:00:00.000Z")).toBe(1)
    expect(seats.get("2026-11-09T08:00:00.000Z")).toBeUndefined()
  })

  it("keys the seats by the instant, so an hour that happens twice is two classes", () => {
    // The night the clocks go back, 01:30 local happens twice; as instants
    // they are an hour apart and must not share their seats.
    const seats = seatsByStart([
      { startsAt: new Date("2026-10-25T00:30:00.000Z") },
      { startsAt: new Date("2026-10-25T01:30:00.000Z") },
    ])
    expect([...seats.values()]).toEqual([1, 1])
  })
})
