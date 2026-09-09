import { describe, expect, it } from "vitest"
import {
  calculateWorkforceTimesheetDay,
  WorkforceTimesheetCalculationError,
  type WorkforceTimesheetCalculationInput,
} from "@/lib/workforce/timesheet-calculation"

const base: WorkforceTimesheetCalculationInput = {
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
  facts: {
    workdayId: "workday-1",
    status: "COMPLETED",
    startedAt: "2026-08-28T09:00:00.000Z",
    completedAt: "2026-08-28T18:00:00.000Z",
    pauseIntervals: [{
      startedAt: "2026-08-28T12:00:00.000Z",
      endedAt: "2026-08-28T13:00:00.000Z",
    }],
  },
}

describe("workforce timesheet calculation", () => {
  it("replays an exact completed shift from its immutable snapshot", () => {
    const result = calculateWorkforceTimesheetDay(base)

    expect(result.policySnapshotId).toBe("policy-snapshot-v1")
    expect(result.shiftSnapshotId).toBe("shift-snapshot-v1")
    expect(result.calculationVersion).toBe(1)
    expect(result.isFinal).toBe(true)
    expect(result.fact.workedSeconds).toBe(8 * 60 * 60)
    expect(result.fact.pausedSeconds).toBe(60 * 60)
    expect(result.fact.longestPauseSeconds).toBe(60 * 60)
    expect(result.deviations).toEqual({
      lateStartSeconds: 0,
      undertimeSeconds: 0,
      overtimeSeconds: 0,
      longPauseSeconds: 0,
    })
    expect(result.exceptions).toEqual([])
  })

  it("reports late start and final undertime without hiding policy thresholds", () => {
    const result = calculateWorkforceTimesheetDay({
      ...base,
      facts: {
        ...base.facts!,
        startedAt: "2026-08-28T09:12:00.000Z",
        completedAt: "2026-08-28T18:00:00.000Z",
      },
    })

    expect(result.deviations.lateStartSeconds).toBe(12 * 60)
    expect(result.deviations.undertimeSeconds).toBe(12 * 60)
    expect(result.exceptions).toEqual([
      { type: "LATE_START", valueSeconds: 12 * 60, thresholdSeconds: 5 * 60, excessSeconds: 7 * 60, provisional: false },
      { type: "UNDERTIME", valueSeconds: 12 * 60, thresholdSeconds: 5 * 60, excessSeconds: 7 * 60, provisional: false },
    ])
  })

  it("derives the open current pause at the explicit asOf instant", () => {
    const result = calculateWorkforceTimesheetDay({
      ...base,
      asOf: "2026-08-28T13:30:00.000Z",
      facts: {
        workdayId: "workday-1",
        status: "PAUSED",
        startedAt: "2026-08-28T09:00:00.000Z",
        completedAt: null,
        pauseIntervals: [
          { startedAt: "2026-08-28T10:00:00.000Z", endedAt: "2026-08-28T10:10:00.000Z" },
          { startedAt: "2026-08-28T12:00:00.000Z", endedAt: null },
        ],
      },
    })

    expect(result.fact.pausedSeconds).toBe(100 * 60)
    expect(result.fact.longestPauseSeconds).toBe(90 * 60)
    expect(result.fact.workedSeconds).toBe(170 * 60)
    expect(result.deviations.undertimeSeconds).toBe(0)
    expect(result.exceptions).toContainEqual({
      type: "LONG_PAUSE",
      valueSeconds: 90 * 60,
      thresholdSeconds: 60 * 60,
      excessSeconds: 30 * 60,
      provisional: true,
    })
  })

  it("marks a missing start as provisional and assesses under-time after shift end", () => {
    const duringShift = calculateWorkforceTimesheetDay({ ...base, asOf: "2026-08-28T09:10:00.000Z", facts: null })
    expect(duringShift.status).toBe("NOT_STARTED")
    expect(duringShift.deviations.undertimeSeconds).toBe(0)
    expect(duringShift.exceptions).toEqual([
      { type: "LATE_START", valueSeconds: 10 * 60, thresholdSeconds: 5 * 60, excessSeconds: 5 * 60, provisional: true },
    ])

    const afterShift = calculateWorkforceTimesheetDay({ ...base, asOf: "2026-08-28T18:01:00.000Z", facts: null })
    expect(afterShift.deviations.lateStartSeconds).toBe(9 * 60 * 60)
    expect(afterShift.deviations.undertimeSeconds).toBe(8 * 60 * 60)
    expect(afterShift.exceptions.map((item) => item.type)).toEqual(["LATE_START", "UNDERTIME"])
    expect(afterShift.exceptions.every((item) => item.provisional)).toBe(true)
  })

  it("reports overtime only after the configured threshold", () => {
    const belowThreshold = calculateWorkforceTimesheetDay({
      ...base,
      asOf: "2026-08-28T18:10:00.000Z",
      facts: { ...base.facts!, completedAt: "2026-08-28T18:10:00.000Z" },
    })
    expect(belowThreshold.deviations.overtimeSeconds).toBe(10 * 60)
    expect(belowThreshold.exceptions).toEqual([])

    const atThreshold = calculateWorkforceTimesheetDay({
      ...base,
      asOf: "2026-08-28T18:15:00.000Z",
      facts: { ...base.facts!, completedAt: "2026-08-28T18:15:00.000Z" },
    })
    expect(atThreshold.deviations.overtimeSeconds).toBe(15 * 60)
    expect(atThreshold.exceptions).toEqual([])

    const aboveThreshold = calculateWorkforceTimesheetDay({
      ...base,
      asOf: "2026-08-28T18:15:01.000Z",
      facts: { ...base.facts!, completedAt: "2026-08-28T18:15:01.000Z" },
    })
    expect(aboveThreshold.exceptions).toContainEqual({
      type: "OVERTIME",
      valueSeconds: 15 * 60 + 1,
      thresholdSeconds: 15 * 60,
      excessSeconds: 1,
      provisional: false,
    })
  })

  it("does not merge several short pauses into one long pause", () => {
    const result = calculateWorkforceTimesheetDay({
      ...base,
      policySnapshot: { ...base.policySnapshot, expectedWorkSeconds: 7 * 60 * 60 },
      facts: {
        ...base.facts!,
        pauseIntervals: Array.from({ length: 6 }, (_, index) => ({
          startedAt: new Date(Date.parse("2026-08-28T10:00:00.000Z") + index * 60 * 60 * 1000).toISOString(),
          endedAt: new Date(Date.parse("2026-08-28T10:11:00.000Z") + index * 60 * 60 * 1000).toISOString(),
        })),
      },
    })

    expect(result.fact.pausedSeconds).toBe(66 * 60)
    expect(result.fact.longestPauseSeconds).toBe(11 * 60)
    expect(result.exceptions.find((item) => item.type === "LONG_PAUSE")).toBeUndefined()
  })

  it("is invariant for completed facts when asOf advances", () => {
    const first = calculateWorkforceTimesheetDay(base)
    const later = calculateWorkforceTimesheetDay({ ...base, asOf: "2026-09-01T00:00:00.000Z" })
    expect(later).toEqual(first)
  })

  it("rejects timezone-dependent timestamps without a UTC suffix", () => {
    expect(() => calculateWorkforceTimesheetDay({
      ...base,
      asOf: "2026-08-28T18:00:00",
    })).toThrow("asOf must be a canonical UTC timestamp")
  })

  it("keeps contractual expected time independent from a DST-shortened UTC span", () => {
    const result = calculateWorkforceTimesheetDay({
      ...base,
      asOf: "2026-03-29T07:00:00.000Z",
      schedule: {
        shiftSnapshotId: "shift-snapshot-dst",
        workDate: "2026-03-29",
        timezone: "Europe/Berlin",
        plannedStartAt: "2026-03-29T00:00:00.000Z",
        plannedEndAt: "2026-03-29T07:00:00.000Z",
      },
      facts: {
        workdayId: "workday-dst",
        status: "COMPLETED",
        startedAt: "2026-03-29T00:00:00.000Z",
        completedAt: "2026-03-29T07:00:00.000Z",
        pauseIntervals: [],
      },
    })

    expect(result.plan.expectedWorkSeconds).toBe(8 * 60 * 60)
    expect(result.deviations.undertimeSeconds).toBe(60 * 60)
  })

  it("rejects impossible audit metadata", () => {
    expect(() => calculateWorkforceTimesheetDay({
      ...base,
      schedule: { ...base.schedule, workDate: "2026-02-31" },
    })).toThrow("workDate must be YYYY-MM-DD")
    expect(() => calculateWorkforceTimesheetDay({
      ...base,
      schedule: { ...base.schedule, timezone: "Mars/Olympus" },
    })).toThrow("timezone audit metadata must be a valid IANA timezone")
  })

  it("rejects impossible facts instead of normalizing attendance history", () => {
    expect(() => calculateWorkforceTimesheetDay({
      ...base,
      facts: {
        ...base.facts!,
        pauseIntervals: [
          { startedAt: "2026-08-28T12:00:00.000Z", endedAt: "2026-08-28T13:00:00.000Z" },
          { startedAt: "2026-08-28T12:30:00.000Z", endedAt: "2026-08-28T13:30:00.000Z" },
        ],
      },
    })).toThrow(WorkforceTimesheetCalculationError)

    expect(() => calculateWorkforceTimesheetDay({
      ...base,
      schedule: { ...base.schedule, plannedEndAt: base.schedule.plannedStartAt },
    })).toThrow("plannedEndAt must be after plannedStartAt")
  })
})
