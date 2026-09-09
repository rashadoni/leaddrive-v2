import { describe, expect, it } from "vitest"
import {
  isDuringMtmWorkdayPause,
  mtmWorkdayPauses,
  serializeMtmWorkdayPauses,
} from "@/lib/mtm/workday-pauses"

const at = (hhmm: string) => new Date(`2026-09-08T${hhmm}:00.000Z`)

describe("workday pauses (field UX audit A7)", () => {
  it("turns one break into one closed interval", () => {
    expect(
      mtmWorkdayPauses([
        { type: "START", occurredAt: at("08:00") },
        { type: "PAUSE", occurredAt: at("13:05") },
        { type: "RESUME", occurredAt: at("13:40") },
      ]),
    ).toEqual([{ from: at("13:05"), to: at("13:40") }])
  })

  it("leaves the current break open", () => {
    expect(
      mtmWorkdayPauses([
        { type: "START", occurredAt: at("08:00") },
        { type: "PAUSE", occurredAt: at("13:05") },
      ]),
    ).toEqual([{ from: at("13:05"), to: null }])
  })

  it("closes an open break at FINISH", () => {
    // A shift finished from the paused state: applyMtmWorkdayEvent banks the
    // same interval into totalPausedSeconds, so the timeline must agree.
    expect(
      mtmWorkdayPauses([
        { type: "PAUSE", occurredAt: at("17:00") },
        { type: "FINISH", occurredAt: at("18:24") },
      ]),
    ).toEqual([{ from: at("17:00"), to: at("18:24") }])
  })

  it("keeps the first moment when PAUSE arrives twice", () => {
    // A retried request or an offline replay. The break began at the first
    // one; treating the second as a new break would erase the minutes between.
    expect(
      mtmWorkdayPauses([
        { type: "PAUSE", occurredAt: at("13:05") },
        { type: "PAUSE", occurredAt: at("13:07") },
        { type: "RESUME", occurredAt: at("13:40") },
      ]),
    ).toEqual([{ from: at("13:05"), to: at("13:40") }])
  })

  it("ignores a RESUME with no break before it", () => {
    expect(mtmWorkdayPauses([{ type: "RESUME", occurredAt: at("13:40") }])).toEqual([])
  })

  it("drops a zero-length break", () => {
    expect(
      mtmWorkdayPauses([
        { type: "PAUSE", occurredAt: at("13:05") },
        { type: "RESUME", occurredAt: at("13:05") },
      ]),
    ).toEqual([])
  })

  it("orders events by when they happened, not by how they arrived", () => {
    // The offline queue uploads in whatever order it drained.
    expect(
      mtmWorkdayPauses([
        { type: "RESUME", occurredAt: at("13:40") },
        { type: "PAUSE", occurredAt: at("13:05") },
      ]),
    ).toEqual([{ from: at("13:05"), to: at("13:40") }])
  })

  it("skips an event whose timestamp cannot be read", () => {
    expect(
      mtmWorkdayPauses([
        { type: "PAUSE", occurredAt: "not a date" },
        { type: "PAUSE", occurredAt: at("13:05") },
        { type: "RESUME", occurredAt: at("13:40") },
      ]),
    ).toEqual([{ from: at("13:05"), to: at("13:40") }])
  })

  describe("was the agent on a break at this moment", () => {
    const pauses = mtmWorkdayPauses([
      { type: "PAUSE", occurredAt: at("13:05") },
      { type: "RESUME", occurredAt: at("13:40") },
    ])

    it("says yes inside the break", () => {
      expect(isDuringMtmWorkdayPause(at("13:20"), pauses)).toBe(true)
    })

    it("says no before and after it", () => {
      expect(isDuringMtmWorkdayPause(at("12:59"), pauses)).toBe(false)
      expect(isDuringMtmWorkdayPause(at("13:41"), pauses)).toBe(false)
    })

    it("gives both boundaries to work", () => {
      // The point taken at the second of PAUSE was captured before the agent
      // stopped; the one at RESUME is the first of the new leg. Refusing them
      // would drop real work over a rounding coincidence.
      expect(isDuringMtmWorkdayPause(at("13:05"), pauses)).toBe(false)
      expect(isDuringMtmWorkdayPause(at("13:40"), pauses)).toBe(false)
    })

    it("treats everything after an open break as a break", () => {
      const open = mtmWorkdayPauses([{ type: "PAUSE", occurredAt: at("13:05") }])
      expect(isDuringMtmWorkdayPause(at("13:06"), open)).toBe(true)
      expect(isDuringMtmWorkdayPause(at("19:00"), open)).toBe(true)
      expect(isDuringMtmWorkdayPause(at("13:04"), open)).toBe(false)
    })
  })

  it("serialises to ISO strings with an open end as null", () => {
    expect(
      serializeMtmWorkdayPauses([
        { from: at("13:05"), to: at("13:40") },
        { from: at("17:00"), to: null },
      ]),
    ).toEqual([
      { from: "2026-09-08T13:05:00.000Z", to: "2026-09-08T13:40:00.000Z" },
      { from: "2026-09-08T17:00:00.000Z", to: null },
    ])
  })
})
