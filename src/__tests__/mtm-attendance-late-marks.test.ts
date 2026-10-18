import { describe, expect, it } from "vitest"
import { attendanceCorrectionAfterFacts } from "@/lib/mtm/attendance-time-correction"
import { clipWorkdayPauseIntervals, replayWorkforceWorkdayFacts } from "@/lib/workforce/workday-facts-replay"

/**
 * Owner, 2026-10-18: «Да, разреши: отметки после указанного окончания не
 * считаются рабочим временем, но остаются в истории дня.»
 *
 * The journal below is the shape of the 13 October test day on the owner's
 * phone (UTC; Baku is +4): started 10:21, closed at 10:56 and returned at 13:16,
 * closed at 20:39 and returned at 21:53, a break pressed and lifted at 22:18.
 * The employee's day is 09:00–18:00; until this change no finish before 22:19
 * could be approved.
 */
const workdayId = "fixture-day"
const event = (id: string, type: string, occurredAt: string, appliedAt = occurredAt) => ({ id, type, occurredAt, appliedAt, clientEventId: id })
const journal = [
  event("start", "START", "2026-10-13T06:21:58.533Z"),
  event("finish-1", "FINISH", "2026-10-13T06:56:04.415Z"),
  event("reopen:1", "REOPEN", "2026-10-13T06:56:04.415Z", "2026-10-13T09:16:15.236Z"),
  event("resume-1", "RESUME", "2026-10-13T09:16:15.236Z"),
  event("finish-2", "FINISH", "2026-10-13T16:39:14.252Z"),
  event("reopen:2", "REOPEN", "2026-10-13T16:39:14.252Z", "2026-10-13T17:53:53.513Z"),
  event("resume-2", "RESUME", "2026-10-13T17:53:53.513Z"),
  event("pause-3", "PAUSE", "2026-10-13T18:18:51.143Z"),
  event("resume-3", "RESUME", "2026-10-13T18:18:57.116Z"),
] as Parameters<typeof replayWorkforceWorkdayFacts>[0]["events"]

describe("a corrected day keeps only the marks inside its start and finish", () => {
  const open = replayWorkforceWorkdayFacts({ workdayId, events: journal })
  const before = { id: workdayId, workDate: "2026-10-13", status: open.status, startedAt: open.startedAt, pausedAt: open.pausedAt, completedAt: open.completedAt, totalPausedSeconds: open.totalPausedSeconds }

  it("is the open day production had: three breaks, 12 894 seconds", () => {
    expect(open).toMatchObject({ status: "STARTED", totalPausedSeconds: 12894 })
    expect(open.pauseIntervals).toHaveLength(3)
  })

  it("closes at 18:00 (Baku): the evening marks stay in the journal and out of the day", () => {
    const after = attendanceCorrectionAfterFacts({
      workdayId, workDate: "2026-10-13", start: new Date("2026-10-13T06:21:00.000Z"), end: new Date("2026-10-13T14:00:00.000Z"), pauseIntervals: open.pauseIntervals,
    })
    // Only the 10:56–13:16 away time is inside 10:21–18:00.
    expect(after).toMatchObject({ status: "COMPLETED", completedAt: "2026-10-13T14:00:00.000Z", pausedAt: null, totalPausedSeconds: 8410 })
    const corrected = replayWorkforceWorkdayFacts({ workdayId, events: journal, corrections: [{ id: "correction", beforeFacts: before, afterFacts: after }] })
    expect(corrected).toMatchObject({ status: "COMPLETED", completedAt: "2026-10-13T14:00:00.000Z", totalPausedSeconds: 8410 })
    expect(corrected.pauseIntervals).toEqual([{ startedAt: "2026-10-13T06:56:04.415Z", endedAt: "2026-10-13T09:16:15.236Z" }])
    // Nothing of the journal is dropped: every event still replays.
    expect(corrected.eventIds).toHaveLength(journal.length)
  })

  it("leaves a day whose breaks are all inside exactly as before", () => {
    const after = attendanceCorrectionAfterFacts({
      workdayId, workDate: "2026-10-13", start: new Date("2026-10-13T06:21:00.000Z"), end: new Date("2026-10-13T18:19:00.000Z"), pauseIntervals: open.pauseIntervals,
    })
    expect(after.totalPausedSeconds).toBe(12894)
    const corrected = replayWorkforceWorkdayFacts({ workdayId, events: journal, corrections: [{ id: "correction", beforeFacts: before, afterFacts: after }] })
    expect(corrected.pauseIntervals).toEqual(open.pauseIntervals)
  })

  it("counts a break that crosses the finish only up to the finish, and closes an open break at it", () => {
    expect(clipWorkdayPauseIntervals([
      { startedAt: "2026-10-13T13:30:00.000Z", endedAt: "2026-10-13T14:30:00.000Z" },
      { startedAt: "2026-10-13T15:00:00.000Z", endedAt: "2026-10-13T15:10:00.000Z" },
    ], "2026-10-13T05:00:00.000Z", "2026-10-13T14:00:00.000Z")).toEqual([{ startedAt: "2026-10-13T13:30:00.000Z", endedAt: "2026-10-13T14:00:00.000Z" }])
    const paused = attendanceCorrectionAfterFacts({
      workdayId, workDate: "2026-10-13", start: new Date("2026-10-13T05:00:00.000Z"), end: new Date("2026-10-13T14:00:00.000Z"),
      pauseIntervals: [{ startedAt: "2026-10-13T12:00:00.000Z", endedAt: null }],
    })
    expect(paused.totalPausedSeconds).toBe(7200)
  })
})
