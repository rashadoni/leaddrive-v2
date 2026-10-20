import { describe, expect, it } from "vitest"
import {
  isDuringMtmWorkdayPause,
  MTM_WORKDAY_PAUSE_EVENT_TYPES,
  mtmLastBreakEndedAt,
  mtmWorkdayPauses,
  mtmWorkdayPausesBetween,
  mtmWorkdayPausesByShift,
  serializeMtmWorkdayPauses,
} from "@/lib/mtm/workday-pauses"
import { detectHistoryGaps, type HistoryLocationPoint } from "@/lib/mtm/location-history"

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

  describe("a day a manager reopened after it was finished", () => {
    // A REOPEN is recorded at the instant of the FINISH it reopens; the moment
    // the manager acted is its server application time.
    const applied = (hhmm: string) => at(hhmm)

    it("asks the journal for REOPEN along with the break events", () => {
      expect(MTM_WORKDAY_PAUSE_EVENT_TYPES).toEqual(["PAUSE", "RESUME", "FINISH", "REOPEN"])
    })

    it("treats the time from the finish to RESUME as a break", () => {
      // The workday row banks exactly this gap into totalPausedSeconds on
      // RESUME, so a point captured at 14:10 is not work either.
      const pauses = mtmWorkdayPauses([
        { type: "START", occurredAt: at("08:00"), appliedAt: applied("08:00") },
        { type: "FINISH", occurredAt: at("14:00"), appliedAt: applied("14:00") },
        { type: "REOPEN", occurredAt: at("14:00"), appliedAt: applied("14:30") },
        { type: "RESUME", occurredAt: at("15:00"), appliedAt: applied("15:00") },
        { type: "FINISH", occurredAt: at("18:00"), appliedAt: applied("18:00") },
      ])

      expect(pauses).toEqual([{ from: at("14:00"), to: at("15:00") }])
      expect(isDuringMtmWorkdayPause(at("14:10"), pauses)).toBe(true)
      expect(isDuringMtmWorkdayPause(at("15:30"), pauses)).toBe(false)
    })

    it("keeps the break open while the reopened day waits for the agent", () => {
      expect(mtmWorkdayPauses([
        { type: "FINISH", occurredAt: at("14:00"), appliedAt: applied("14:00") },
        { type: "REOPEN", occurredAt: at("14:00"), appliedAt: applied("14:30") },
      ])).toEqual([{ from: at("14:00"), to: null }])
    })

    it("puts the FINISH before its REOPEN by application time, whatever order the rows arrive in", () => {
      expect(mtmWorkdayPauses([
        { type: "REOPEN", occurredAt: at("14:00"), appliedAt: applied("14:30") },
        { type: "FINISH", occurredAt: at("14:00"), appliedAt: applied("14:00") },
      ])).toEqual([{ from: at("14:00"), to: null }])
    })

    it("continues a break the first finish closed instead of splitting it at the finish", () => {
      expect(mtmWorkdayPauses([
        { type: "PAUSE", occurredAt: at("13:00"), appliedAt: applied("13:00") },
        { type: "FINISH", occurredAt: at("14:00"), appliedAt: applied("14:00") },
        { type: "REOPEN", occurredAt: at("14:00"), appliedAt: applied("14:30") },
        { type: "RESUME", occurredAt: at("15:00"), appliedAt: applied("15:00") },
      ])).toEqual([{ from: at("13:00"), to: at("15:00") }])
    })

    it("leaves the day's breaks exactly as before when the reopen is undone", () => {
      // Undo is a FINISH at the reopened instant, applied after the REOPEN.
      expect(mtmWorkdayPauses([
        { type: "FINISH", occurredAt: at("14:00"), appliedAt: applied("14:00") },
        { type: "REOPEN", occurredAt: at("14:00"), appliedAt: applied("14:30") },
        { type: "FINISH", occurredAt: at("14:00"), appliedAt: applied("14:35") },
      ])).toEqual([])
      expect(mtmWorkdayPauses([
        { type: "PAUSE", occurredAt: at("13:00"), appliedAt: applied("13:00") },
        { type: "FINISH", occurredAt: at("14:00"), appliedAt: applied("14:00") },
        { type: "REOPEN", occurredAt: at("14:00"), appliedAt: applied("14:30") },
        { type: "FINISH", occurredAt: at("14:00"), appliedAt: applied("14:35") },
      ])).toEqual([{ from: at("13:00"), to: at("14:00") }])
    })

    it("handles a second reopen of the same day", () => {
      expect(mtmWorkdayPauses([
        { type: "FINISH", occurredAt: at("12:00"), appliedAt: applied("12:00") },
        { type: "REOPEN", occurredAt: at("12:00"), appliedAt: applied("12:10") },
        { type: "RESUME", occurredAt: at("12:20"), appliedAt: applied("12:20") },
        { type: "FINISH", occurredAt: at("16:00"), appliedAt: applied("16:00") },
        { type: "REOPEN", occurredAt: at("16:00"), appliedAt: applied("16:05") },
        { type: "RESUME", occurredAt: at("16:30"), appliedAt: applied("16:30") },
      ])).toEqual([
        { from: at("12:00"), to: at("12:20") },
        { from: at("16:00"), to: at("16:30") },
      ])
    })
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

// From when a point is again a position at work: the live roster calls the
// point he left before a break the last known one until a fix after it.
describe("when the latest break ended", () => {
  it("is the latest end among the breaks that are over, a reopened finish included", () => {
    expect(mtmLastBreakEndedAt(mtmWorkdayPauses([
      { type: "PAUSE", occurredAt: at("13:05") },
      { type: "RESUME", occurredAt: at("13:40") },
      { type: "FINISH", occurredAt: at("17:00"), appliedAt: at("17:00") },
      { type: "REOPEN", occurredAt: at("17:00"), appliedAt: at("17:10") },
      { type: "RESUME", occurredAt: at("17:20") },
    ]))).toEqual(at("17:20"))
  })

  it("is none while the only break is still running, or when there was none", () => {
    expect(mtmLastBreakEndedAt(mtmWorkdayPauses([{ type: "PAUSE", occurredAt: at("13:05") }]))).toBeNull()
    expect(mtmLastBreakEndedAt(mtmWorkdayPauses([{ type: "START", occurredAt: at("08:00") }]))).toBeNull()
    // A running break after one that is over: the one that is over.
    expect(mtmLastBreakEndedAt(mtmWorkdayPauses([
      { type: "PAUSE", occurredAt: at("12:00") },
      { type: "RESUME", occurredAt: at("12:30") },
      { type: "PAUSE", occurredAt: at("15:00") },
    ]))).toEqual(at("12:30"))
  })
})

describe("the breaks of several shifts", () => {
  it("read each shift's journal on its own, in order of start", () => {
    const events = [
      // The 20th was finished from a break; the 21st has its own lunch.
      { workdayId: "w21", type: "PAUSE", occurredAt: new Date("2026-09-21T08:00:00.000Z") },
      { workdayId: "w20", type: "PAUSE", occurredAt: new Date("2026-09-20T11:00:00.000Z") },
      { workdayId: "w20", type: "FINISH", occurredAt: new Date("2026-09-20T11:20:00.000Z") },
      { workdayId: "w21", type: "RESUME", occurredAt: new Date("2026-09-21T08:40:00.000Z") },
    ]
    expect(serializeMtmWorkdayPauses(mtmWorkdayPausesByShift(events))).toEqual([
      { from: "2026-09-20T11:00:00.000Z", to: "2026-09-20T11:20:00.000Z" },
      { from: "2026-09-21T08:00:00.000Z", to: "2026-09-21T08:40:00.000Z" },
    ])
    // One shift's RESUME never closes another shift's break (read as one
    // journal, these two would make a ten-minute break).
    expect(mtmWorkdayPausesByShift([
      { workdayId: "w1", type: "PAUSE", occurredAt: new Date("2026-09-20T11:00:00.000Z") },
      { workdayId: "w2", type: "RESUME", occurredAt: new Date("2026-09-20T11:10:00.000Z") },
    ])).toEqual([{ from: new Date("2026-09-20T11:00:00.000Z"), to: null }])
  })
})

// The day's path is cut at every break taken between two fixes, however short
// (verification of 2026-10-20: a four-minute break was no gap at all).
describe("the breaks between two fixes", () => {
  const second = (hhmmss: string) => new Date(`2026-09-08T${hhmmss}.000Z`)
  const lunch = { from: second("13:05:05"), to: second("13:08:55") }

  it("are those begun at or after the earlier fix and over by the later — the edges are work", () => {
    expect(mtmWorkdayPausesBetween(second("13:05:00"), second("13:09:00"), [lunch])).toEqual([lunch])
    // A fix at the very second of PAUSE, and one at RESUME: still between them.
    expect(mtmWorkdayPausesBetween(second("13:05:05"), second("13:08:55"), [lunch])).toEqual([lunch])
    // A fix inside the break (data from before such fixes were refused): not between.
    expect(mtmWorkdayPausesBetween(second("13:05:00"), second("13:07:00"), [lunch])).toEqual([])
    expect(mtmWorkdayPausesBetween(second("13:07:00"), second("13:09:00"), [lunch])).toEqual([])
    // A break still running has nothing after it.
    expect(mtmWorkdayPausesBetween(second("13:05:00"), second("13:09:00"), [{ from: lunch.from, to: null }])).toEqual([])
    expect(mtmWorkdayPausesBetween(second("13:09:00"), second("13:05:00"), [lunch])).toEqual([])
  })

  describe("as the day's gaps", () => {
    let sequence = 0
    const fix = (hhmmss: string): HistoryLocationPoint => ({
      id: `p${sequence++}`, latitude: 40.4 + sequence * 0.001, longitude: 49.8, accuracy: 8, speed: null, heading: null,
      battery: 80, isMoving: true, recordedAt: second(hhmmss), workdayId: "w1",
    })
    const pause = (from: string, to: string) => ({ startedAt: second(from), endedAt: second(to) })
    const said = (points: HistoryLocationPoint[], pauses: Array<{ startedAt: Date; endedAt: Date | null }>) =>
      detectHistoryGaps(points, 300, pauses).map((gap) => [gap.reason, gap.durationSeconds])
    const clock = (value: Date) => value.toISOString().slice(11, 19)
    const told = (points: HistoryLocationPoint[], pauses: Array<{ startedAt: Date; endedAt: Date | null }>) =>
      detectHistoryGaps(points, 300, pauses).map((gap) =>
        [gap.reason, clock(gap.startedAt), clock(gap.endedAt), gap.durationSeconds, gap.besideBreak ?? false])

    it("make a four-minute break a gap of its own, under the five minutes that make a silence one", () => {
      // Fixes right before «Перерыв» and right after «Продолжить»: the break is the journal's 3 min 50 s.
      expect(told([fix("13:04:30"), fix("13:05:00"), fix("13:09:00"), fix("13:09:30")], [pause("13:05:05", "13:08:55")]))
        .toEqual([["WORKDAY_PAUSED", "13:05:05", "13:08:55", 230, false]])
      // The same silence with no break pressed is no gap, as before.
      expect(said([fix("13:04:30"), fix("13:05:00"), fix("13:09:00"), fix("13:09:30")], [])).toEqual([])
    })

    // Verification of 2026-10-20: the whole silence took one name. A break
    // swallowed up to the threshold of lost signal around it (a one-minute
    // break read «Перерыв 6 мин»), or a few seconds too many of lost signal
    // swallowed the break. The break is now the journal's length, and each
    // side of it is told as any silence is.
    it("are exactly as long as the journal says, however long the silence around them", () => {
      // A one-minute break in six minutes without a fix (a tunnel, then the break).
      expect(told([fix("09:26:00"), fix("09:32:00")], [pause("09:30:30", "09:31:30")]))
        .toEqual([["WORKDAY_PAUSED", "09:30:30", "09:31:30", 60, false]])
      // Four minutes of break in six minutes without a fix.
      expect(said([fix("13:00:00"), fix("13:06:00")], [pause("13:01:00", "13:05:00")])).toEqual([["WORKDAY_PAUSED", 240]])
    })

    it("leave on either side a lost signal only where that side alone is longer than the threshold", () => {
      // 115 s of break with 305 s left over: 5 s before it, 300 s after — neither side a lost signal.
      expect(told([fix("09:30:00"), fix("09:37:00")], [pause("09:30:05", "09:32:00")]))
        .toEqual([["WORKDAY_PAUSED", "09:30:05", "09:32:00", 115, false]])
      // A second more after it is one.
      expect(told([fix("09:30:00"), fix("09:37:01")], [pause("09:30:05", "09:32:00")])).toEqual([
        ["WORKDAY_PAUSED", "09:30:05", "09:32:00", 115, false],
        ["TELEMETRY_GAP", "09:32:00", "09:37:01", 301, true],
      ])
      // An hour without a fix around a four-minute break: a lost signal, the break, a lost signal.
      expect(told([fix("13:00:00"), fix("14:00:00")], [pause("13:30:00", "13:34:00")])).toEqual([
        ["TELEMETRY_GAP", "13:00:00", "13:30:00", 1_800, true],
        ["WORKDAY_PAUSED", "13:30:00", "13:34:00", 240, false],
        ["TELEMETRY_GAP", "13:34:00", "14:00:00", 1_560, true],
      ])
    })

    it("give a lost signal beside a break only the fix it has: no line from it crosses the break", () => {
      const before = fix("13:00:00")
      const after = fix("14:00:00")
      const [lostBefore, lunch, lostAfter] = detectHistoryGaps([before, after], 300, [pause("13:30:00", "13:34:00")])
      expect([lostBefore.startLatitude, lostBefore.endLatitude]).toEqual([before.latitude, before.latitude])
      expect([lostAfter.startLatitude, lostAfter.endLatitude]).toEqual([after.latitude, after.latitude])
      // The break keeps the fixes either side of the silence; the map draws nothing for it.
      expect([lunch.startLatitude, lunch.endLatitude]).toEqual([before.latitude, after.latitude])
      expect(lunch.id).toBe(`gap-${before.id}-${after.id}`)
    })

    // Verification of 2026-10-20: data from before such fixes were refused
    // (2026-10-11) has fixes inside a break. They used to decide it: its edges
    // moved to them and it split at each — History counted 14 minutes of a
    // 38-minute lunch. The journal decides it now.
    it("are the journal's breaks, also with fixes recorded inside them", () => {
      // Every half minute, through the break: the break is still its 100 s, and no lost signal.
      const through = ["13:04:30", "13:05:00", "13:05:30", "13:06:00", "13:06:30", "13:07:00"].map(fix)
      expect(told(through, [pause("13:05:10", "13:06:50")])).toEqual([["WORKDAY_PAUSED", "13:05:10", "13:06:50", 100, false]])
      // A lunch at a cafe with a dozing phone: two fixes inside it, one just after.
      const lunch = [fix("12:25:30"), fix("12:40:00"), fix("12:55:00"), fix("13:05:00")]
      expect(told(lunch, [pause("12:26:00", "13:04:00")])).toEqual([["WORKDAY_PAUSED", "12:26:00", "13:04:00", 2_280, false]])
      // A break still running is no gap; the silence around it is told as any silence.
      expect(told([fix("12:25:30"), fix("12:40:00")], [{ startedAt: second("12:26:00"), endedAt: null }]))
        .toEqual([["TELEMETRY_GAP", "12:25:30", "12:40:00", 870, false]])
    })

    it("are there before the day's first fix and after its last: the journal has them", () => {
      // Finished from a break, the phone silent since «Перерыв».
      const day = [fix("12:25:00"), fix("12:25:30")]
      const [lunch, ...rest] = detectHistoryGaps(day, 300, [pause("12:26:00", "13:00:00")])
      expect(rest).toEqual([])
      expect(lunch).toMatchObject({ id: `gap-${day[1].id}-end`, reason: "WORKDAY_PAUSED", durationSeconds: 34 * 60 })
      expect([lunch.startLatitude, lunch.endLatitude]).toEqual([day[1].latitude, day[1].latitude])
      // Paused at once after «Начать», the first fix after «Продолжить».
      const later = [fix("09:31:00"), fix("09:31:30")]
      expect(detectHistoryGaps(later, 300, [pause("09:00:30", "09:30:00")]))
        .toMatchObject([{ id: `gap-start-${later[0].id}`, reason: "WORKDAY_PAUSED", durationSeconds: 1_770 }])
      // No fix at all: no path to cut and no silence to explain.
      expect(detectHistoryGaps([], 300, [pause("09:00:30", "09:30:00")])).toEqual([])
    })
  })
})
