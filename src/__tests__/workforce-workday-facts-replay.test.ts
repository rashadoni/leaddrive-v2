import { describe, expect, it } from "vitest"
import { calculateWorkforceTimesheetDay } from "@/lib/workforce/timesheet-calculation"
import {
  replayWorkforceWorkdayFacts,
  WORKFORCE_WORKDAY_JOURNAL_ORDER,
  WorkforceWorkdayFactsReplayError,
} from "@/lib/workforce/workday-facts-replay"

const WORKDAY_ID = "workday-1"

function calculate(events: Parameters<typeof replayWorkforceWorkdayFacts>[0]["events"]) {
  return calculateWorkforceTimesheetDay({
    asOf: "2026-08-28T18:00:00.000Z",
    schedule: {
      shiftSnapshotId: "shift-snapshot-v1",
      workDate: "2026-08-28",
      timezone: "Asia/Baku",
      plannedStartAt: "2026-08-28T09:00:00.000Z",
      plannedEndAt: "2026-08-28T18:00:00.000Z",
    },
    policySnapshot: {
      snapshotId: "policy-snapshot-v1",
      expectedWorkSeconds: 8 * 60 * 60,
      lateGraceSeconds: 5 * 60,
      undertimeToleranceSeconds: 5 * 60,
      overtimeThresholdSeconds: 15 * 60,
      longPauseThresholdSeconds: 60 * 60,
    },
    facts: replayWorkforceWorkdayFacts({ workdayId: WORKDAY_ID, events }),
  })
}

describe("Workforce workday fact replay", () => {
  it("reconstructs completed facts from the canonical workday journal", () => {
    const events = [
      { id: "event-1", type: "START" as const, occurredAt: "2026-08-28T09:00:00.000Z" },
      { id: "event-2", type: "PAUSE" as const, occurredAt: "2026-08-28T12:00:00.000Z" },
      { id: "event-3", type: "RESUME" as const, occurredAt: "2026-08-28T13:00:00.000Z" },
      { id: "event-4", type: "FINISH" as const, occurredAt: "2026-08-28T18:00:00.000Z" },
    ]

    const facts = replayWorkforceWorkdayFacts({ workdayId: WORKDAY_ID, events })

    expect(facts).toEqual({
      workdayId: WORKDAY_ID,
      status: "COMPLETED",
      startedAt: "2026-08-28T09:00:00.000Z",
      pausedAt: null,
      completedAt: "2026-08-28T18:00:00.000Z",
      totalPausedSeconds: 60 * 60,
      pauseIntervals: [{ startedAt: "2026-08-28T12:00:00.000Z", endedAt: "2026-08-28T13:00:00.000Z" }],
      eventIds: ["event-1", "event-2", "event-3", "event-4"],
      correctionIds: [],
    })
    expect(calculate(events).fact).toMatchObject({ workedSeconds: 8 * 60 * 60, pausedSeconds: 60 * 60 })
  })

  it("keeps an open pause explicit for a paused workday", () => {
    const facts = replayWorkforceWorkdayFacts({
      workdayId: WORKDAY_ID,
      events: [
        { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "event-2", type: "PAUSE", occurredAt: "2026-08-28T12:00:00.000Z" },
      ],
    })

    expect(facts).toMatchObject({
      status: "PAUSED",
      completedAt: null,
      pauseIntervals: [{ startedAt: "2026-08-28T12:00:00.000Z", endedAt: null }],
    })
  })

  it("replays a manager correction ledger chain without forging another legacy event", () => {
    const events = [
      { id: "event-1", type: "START" as const, occurredAt: "2026-08-28T09:00:00.000Z" },
      { id: "event-2", type: "PAUSE" as const, occurredAt: "2026-08-28T12:00:00.000Z" },
      { id: "event-3", type: "RESUME" as const, occurredAt: "2026-08-28T13:00:00.000Z" },
      { id: "event-4", type: "FINISH" as const, occurredAt: "2026-08-28T18:00:00.000Z" },
    ]
    const beforeFacts = {
      id: WORKDAY_ID,
      workDate: "2026-08-28",
      status: "COMPLETED",
      startedAt: "2026-08-28T09:00:00.000Z",
      pausedAt: null,
      completedAt: "2026-08-28T18:00:00.000Z",
      totalPausedSeconds: 60 * 60,
    }

    const facts = replayWorkforceWorkdayFacts({
      workdayId: WORKDAY_ID,
      events,
      corrections: [{
        id: "correction-1",
        beforeFacts,
        afterFacts: {
          ...beforeFacts,
          startedAt: "2026-08-28T08:45:00.000Z",
          completedAt: "2026-08-28T17:45:00.000Z",
        },
      }],
    })

    expect(facts).toMatchObject({
      status: "COMPLETED",
      startedAt: "2026-08-28T08:45:00.000Z",
      completedAt: "2026-08-28T17:45:00.000Z",
      eventIds: events.map((event) => event.id),
      correctionIds: ["correction-1"],
    })
    expect(calculateWorkforceTimesheetDay({
      asOf: "2026-08-28T18:00:00.000Z",
      schedule: {
        shiftSnapshotId: "shift-snapshot-v1",
        workDate: "2026-08-28",
        timezone: "Asia/Baku",
        plannedStartAt: "2026-08-28T09:00:00.000Z",
        plannedEndAt: "2026-08-28T18:00:00.000Z",
      },
      policySnapshot: {
        snapshotId: "policy-snapshot-v1",
        expectedWorkSeconds: 8 * 60 * 60,
        lateGraceSeconds: 5 * 60,
        undertimeToleranceSeconds: 5 * 60,
        overtimeThresholdSeconds: 15 * 60,
        longPauseThresholdSeconds: 60 * 60,
      },
      facts,
    }).fact).toMatchObject({ workedSeconds: 8 * 60 * 60 })
  })

  it("supports the state machine's finish-from-paused transition", () => {
    const facts = replayWorkforceWorkdayFacts({
      workdayId: WORKDAY_ID,
      events: [
        { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "event-2", type: "PAUSE", occurredAt: "2026-08-28T12:00:00.000Z" },
        { id: "event-3", type: "FINISH", occurredAt: "2026-08-28T18:00:00.000Z" },
      ],
    })

    expect(facts).toMatchObject({
      status: "COMPLETED",
      completedAt: "2026-08-28T18:00:00.000Z",
      pauseIntervals: [{ startedAt: "2026-08-28T12:00:00.000Z", endedAt: "2026-08-28T18:00:00.000Z" }],
    })
  })

  it("fails closed instead of guessing which duplicated START is a historical correction", () => {
    expect(() => replayWorkforceWorkdayFacts({
      workdayId: WORKDAY_ID,
      events: [
        { id: "correction-start", type: "START", occurredAt: "2026-08-28T08:55:00.000Z" },
        { id: "original-start", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "event-3", type: "FINISH", occurredAt: "2026-08-28T18:00:00.000Z" },
      ],
    })).toThrow("START is only valid for a not-started workday")
  })

  describe("manager reopen of a finished day", () => {
    it("reads the journal by instant, then by server application order", () => {
      expect(WORKFORCE_WORKDAY_JOURNAL_ORDER).toEqual([
        { occurredAt: "asc" },
        { appliedAt: { sort: "asc", nulls: "first" } },
        { id: "asc" },
      ])
    })

    it("counts the gap between the first finish and RESUME as pause, never as work", () => {
      const events = [
        { id: "event-1", type: "START" as const, occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "event-2", type: "FINISH" as const, occurredAt: "2026-08-28T12:00:00.000Z" },
        // Recorded at the instant of the finish it reopens, whenever the
        // manager acted.
        { id: "event-3", type: "REOPEN" as const, occurredAt: "2026-08-28T12:00:00.000Z" },
        { id: "event-4", type: "RESUME" as const, occurredAt: "2026-08-28T13:00:00.000Z" },
        { id: "event-5", type: "FINISH" as const, occurredAt: "2026-08-28T18:00:00.000Z" },
      ]

      const facts = replayWorkforceWorkdayFacts({ workdayId: WORKDAY_ID, events })

      expect(facts).toEqual({
        workdayId: WORKDAY_ID,
        status: "COMPLETED",
        startedAt: "2026-08-28T09:00:00.000Z",
        pausedAt: null,
        completedAt: "2026-08-28T18:00:00.000Z",
        totalPausedSeconds: 60 * 60,
        pauseIntervals: [{ startedAt: "2026-08-28T12:00:00.000Z", endedAt: "2026-08-28T13:00:00.000Z" }],
        eventIds: events.map((event) => event.id),
        correctionIds: [],
      })
      expect(calculate(events).fact).toMatchObject({ workedSeconds: 8 * 60 * 60, pausedSeconds: 60 * 60 })
    })

    it("leaves a reopened day paused at its previous finish until the employee acts", () => {
      expect(replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-2", type: "FINISH", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-3", type: "REOPEN", occurredAt: "2026-08-28T12:00:00.000Z" },
        ],
      })).toMatchObject({
        status: "PAUSED",
        pausedAt: "2026-08-28T12:00:00.000Z",
        completedAt: null,
        totalPausedSeconds: 0,
        pauseIntervals: [{ startedAt: "2026-08-28T12:00:00.000Z", endedAt: null }],
      })
    })

    it("keeps the earlier break separate and banks a finish straight from the reopened pause", () => {
      const facts = replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-2", type: "PAUSE", occurredAt: "2026-08-28T11:00:00.000Z" },
          { id: "event-3", type: "FINISH", occurredAt: "2026-08-28T11:30:00.000Z" },
          { id: "event-4", type: "REOPEN", occurredAt: "2026-08-28T11:30:00.000Z" },
          { id: "event-5", type: "FINISH", occurredAt: "2026-08-28T12:00:00.000Z" },
        ],
      })

      expect(facts).toMatchObject({
        status: "COMPLETED",
        completedAt: "2026-08-28T12:00:00.000Z",
        totalPausedSeconds: 60 * 60,
        pauseIntervals: [
          { startedAt: "2026-08-28T11:00:00.000Z", endedAt: "2026-08-28T11:30:00.000Z" },
          { startedAt: "2026-08-28T11:30:00.000Z", endedAt: "2026-08-28T12:00:00.000Z" },
        ],
      })
    })

    it("supports a second reopen of the same day", () => {
      expect(replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-2", type: "FINISH", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-3", type: "REOPEN", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-4", type: "RESUME", occurredAt: "2026-08-28T12:30:00.000Z" },
          { id: "event-5", type: "FINISH", occurredAt: "2026-08-28T15:00:00.000Z" },
          { id: "event-6", type: "REOPEN", occurredAt: "2026-08-28T15:00:00.000Z" },
          { id: "event-7", type: "RESUME", occurredAt: "2026-08-28T15:15:00.000Z" },
          { id: "event-8", type: "FINISH", occurredAt: "2026-08-28T18:00:00.000Z" },
        ],
      })).toMatchObject({ status: "COMPLETED", totalPausedSeconds: 45 * 60 })
    })

    it("restores the finished day exactly when the reopen is undone at the same instant", () => {
      const finished = replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-2", type: "PAUSE", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-3", type: "FINISH", occurredAt: "2026-08-28T12:40:00.000Z" },
        ],
      })

      const undone = replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-2", type: "PAUSE", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-3", type: "FINISH", occurredAt: "2026-08-28T12:40:00.000Z" },
          { id: "event-4", type: "REOPEN", occurredAt: "2026-08-28T12:40:00.000Z" },
          { id: "event-5", type: "FINISH", occurredAt: "2026-08-28T12:40:00.000Z" },
        ],
      })

      expect({ ...undone, eventIds: finished.eventIds }).toEqual(finished)
      expect(undone.eventIds).toEqual(["event-1", "event-2", "event-3", "event-4", "event-5"])
      // …and the undone day can be reopened again from the same instant.
      expect(replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-3", type: "FINISH", occurredAt: "2026-08-28T12:40:00.000Z" },
          { id: "event-4", type: "REOPEN", occurredAt: "2026-08-28T12:40:00.000Z" },
          { id: "event-5", type: "FINISH", occurredAt: "2026-08-28T12:40:00.000Z" },
          { id: "event-6", type: "REOPEN", occurredAt: "2026-08-28T12:40:00.000Z" },
          { id: "event-7", type: "RESUME", occurredAt: "2026-08-28T13:00:00.000Z" },
        ],
      })).toMatchObject({ status: "STARTED", totalPausedSeconds: 20 * 60 })
    })

    it("accepts a RESUME at the very instant of the reopened finish without inventing a pause", () => {
      expect(replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-2", type: "FINISH", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-3", type: "REOPEN", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-4", type: "RESUME", occurredAt: "2026-08-28T12:00:00.000Z" },
        ],
      })).toMatchObject({ status: "STARTED", totalPausedSeconds: 0, pauseIntervals: [] })
    })

    it.each([
      ["a running day", [
        { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "event-2", type: "REOPEN", occurredAt: "2026-08-28T12:00:00.000Z" },
      ]],
      ["a paused day", [
        { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "event-2", type: "PAUSE", occurredAt: "2026-08-28T11:00:00.000Z" },
        { id: "event-3", type: "REOPEN", occurredAt: "2026-08-28T12:00:00.000Z" },
      ]],
      ["an already reopened day", [
        { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "event-2", type: "FINISH", occurredAt: "2026-08-28T11:00:00.000Z" },
        { id: "event-3", type: "REOPEN", occurredAt: "2026-08-28T11:00:00.000Z" },
        { id: "event-4", type: "REOPEN", occurredAt: "2026-08-28T11:20:00.000Z" },
      ]],
      ["a day that never started", [
        { id: "event-1", type: "REOPEN", occurredAt: "2026-08-28T12:00:00.000Z" },
      ]],
      ["a journal that lists the REOPEN before its FINISH at the same instant", [
        { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "event-3", type: "REOPEN", occurredAt: "2026-08-28T12:00:00.000Z" },
        { id: "event-2", type: "FINISH", occurredAt: "2026-08-28T12:00:00.000Z" },
      ]],
    ] as const)("refuses REOPEN on %s", (_label, events) => {
      expect(() => replayWorkforceWorkdayFacts({ workdayId: WORKDAY_ID, events })).toThrow(
        "REOPEN is only valid for a completed workday",
      )
    })

    it("refuses a REOPEN recorded at any instant other than the finish it reopens", () => {
      expect(() => replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-2", type: "FINISH", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-3", type: "REOPEN", occurredAt: "2026-08-28T12:20:00.000Z" },
        ],
      })).toThrow("REOPEN must be recorded at the finish it reopens")
      expect(() => replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-2", type: "FINISH", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-3", type: "REOPEN", occurredAt: "2026-08-28T11:59:59.999Z" },
        ],
      })).toThrow("workday events must be in strict chronological order")
    })

    it("allows a shared instant only around a REOPEN", () => {
      expect(() => replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-2", type: "PAUSE", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-3", type: "RESUME", occurredAt: "2026-08-28T12:00:00.000Z" },
        ],
      })).toThrow("workday events must be in strict chronological order")
      expect(() => replayWorkforceWorkdayFacts({
        workdayId: WORKDAY_ID,
        events: [
          { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
          { id: "event-2", type: "FINISH", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-3", type: "REOPEN", occurredAt: "2026-08-28T12:00:00.000Z" },
          { id: "event-4", type: "RESUME", occurredAt: "2026-08-28T12:30:00.000Z" },
          { id: "event-5", type: "PAUSE", occurredAt: "2026-08-28T12:30:00.000Z" },
        ],
      })).toThrow("workday events must be in strict chronological order")
    })
  })

  it("rejects ambiguous or impossible journals rather than normalizing them", () => {
    expect(() => replayWorkforceWorkdayFacts({
      workdayId: WORKDAY_ID,
      events: [
        { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "event-2", type: "PAUSE", occurredAt: "2026-08-28T12:00:00.000Z" },
        { id: "event-3", type: "PAUSE", occurredAt: "2026-08-28T12:30:00.000Z" },
      ],
    })).toThrow(WorkforceWorkdayFactsReplayError)

    expect(() => replayWorkforceWorkdayFacts({
      workdayId: WORKDAY_ID,
      events: [
        { id: "event-1", type: "START", occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "event-2", type: "FINISH", occurredAt: "2026-08-28T09:00:00.000Z" },
      ],
    })).toThrow("workday events must be in strict chronological order")
  })
})
