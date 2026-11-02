import { describe, expect, it } from "vitest"
import { dayTimeOf } from "@/lib/mtm/day-time"

/**
 * The «ring of the day» (owner, 2026-11-02, variant «C. Кольцо дня»): where an
 * agent's day went — with clients, on a break, and the rest on the way.
 */
const at = (time: string) => new Date(`2026-11-02T${time}:00.000Z`)

describe("where an agent's day went", () => {
  it("splits the day so far into clients, break and the way, adding up to the whole", () => {
    const day = dayTimeOf({
      startedAt: at("05:10"),
      completedAt: null,
      pauses: [{ from: at("08:00"), to: at("08:25") }],
      visits: [
        { checkInAt: at("05:30"), checkOutAt: at("06:10") },
        { checkInAt: at("06:40"), checkOutAt: at("07:52") },
      ],
      now: at("08:58"),
    })
    expect(day).toEqual({ startedAt: at("05:10").toISOString(), totalMinutes: 228, visitMinutes: 112, breakMinutes: 25, travelMinutes: 91 })
  })

  it("counts an open visit and an open break to now", () => {
    const visiting = dayTimeOf({ startedAt: at("05:00"), completedAt: null, pauses: [], visits: [{ checkInAt: at("06:00"), checkOutAt: null }], now: at("06:48") })
    expect(visiting.visitMinutes).toBe(48)
    const resting = dayTimeOf({ startedAt: at("05:00"), completedAt: null, pauses: [{ from: at("06:30"), to: null }], visits: [], now: at("06:45") })
    expect(resting.breakMinutes).toBe(15)
  })

  it("ends a closed day at its end, not at now", () => {
    const day = dayTimeOf({ startedAt: at("05:00"), completedAt: at("13:00"), pauses: [], visits: [{ checkInAt: at("12:30"), checkOutAt: null }], now: at("20:00") })
    expect(day.totalMinutes).toBe(480)
    expect(day.visitMinutes).toBe(30)
  })

  it("does not count a visit twice, nor a visit's minutes that fall in a break, nor time outside the day", () => {
    const day = dayTimeOf({
      startedAt: at("05:00"),
      completedAt: null,
      pauses: [{ from: at("06:00"), to: at("06:30") }],
      visits: [
        { checkInAt: at("04:30"), checkOutAt: at("05:20") },
        { checkInAt: at("05:50"), checkOutAt: at("06:40") },
        { checkInAt: at("06:20"), checkOutAt: at("06:50") },
      ],
      now: at("07:00"),
    })
    // 05:00–05:20 = 20, 05:50–06:50 minus the break 06:00–06:30 = 30.
    expect(day.visitMinutes).toBe(50)
    expect(day.breakMinutes).toBe(30)
    expect(day.visitMinutes + day.breakMinutes + day.travelMinutes).toBe(day.totalMinutes)
  })
})
