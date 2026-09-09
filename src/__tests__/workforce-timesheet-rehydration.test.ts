import { describe, expect, it } from "vitest"
import {
  rehydrateWorkforceTimesheetDay,
  WorkforceTimesheetRehydrationError,
} from "@/lib/workforce/timesheet-rehydration"

const WORKDAY_ID = "workday-1"
const AGENT_ID = "agent-1"

const events = [
  { id: "event-start", type: "START" as const, occurredAt: "2026-08-28T09:00:00.000Z" },
  { id: "event-pause", type: "PAUSE" as const, occurredAt: "2026-08-28T12:00:00.000Z" },
  { id: "event-resume", type: "RESUME" as const, occurredAt: "2026-08-28T13:00:00.000Z" },
  { id: "event-finish", type: "FINISH" as const, occurredAt: "2026-08-28T18:00:00.000Z" },
]

const base = {
  asOf: new Date("2026-08-28T18:00:00.000Z"),
  workday: {
    id: WORKDAY_ID,
    agentId: AGENT_ID,
    workDate: new Date("2026-08-28T00:00:00.000Z"),
    status: "COMPLETED",
    startedAt: new Date("2026-08-28T09:00:00.000Z"),
    pausedAt: null,
    completedAt: new Date("2026-08-28T18:00:00.000Z"),
    totalPausedSeconds: 60 * 60,
  },
  policySnapshot: {
    id: "policy-snapshot-1",
    workdayId: WORKDAY_ID,
    agentId: AGENT_ID,
    workDate: new Date("2026-08-28T00:00:00.000Z"),
    expectedWorkSeconds: 8 * 60 * 60,
    lateGraceSeconds: 5 * 60,
    undertimeToleranceSeconds: 5 * 60,
    overtimeThresholdSeconds: 15 * 60,
    longPauseThresholdSeconds: 60 * 60,
  },
  shiftSnapshot: {
    id: "shift-snapshot-1",
    workdayId: WORKDAY_ID,
    agentId: AGENT_ID,
    workDate: new Date("2026-08-28T00:00:00.000Z"),
    timezone: "Asia/Baku",
    plannedStartAt: new Date("2026-08-28T09:00:00.000Z"),
    plannedEndAt: new Date("2026-08-28T18:00:00.000Z"),
  },
  events,
}

describe("rehydrateWorkforceTimesheetDay", () => {
  it("calculates only from snapshots and a journal that matches the current projection", () => {
    const result = rehydrateWorkforceTimesheetDay(base)

    expect(result.facts).toMatchObject({
      workdayId: WORKDAY_ID,
      correctionIds: [],
      totalPausedSeconds: 60 * 60,
    })
    expect(result.calculation).toMatchObject({
      calculationVersion: 1,
      policySnapshotId: "policy-snapshot-1",
      shiftSnapshotId: "shift-snapshot-1",
      status: "COMPLETED",
      isFinal: true,
      fact: { workedSeconds: 8 * 60 * 60, pausedSeconds: 60 * 60 },
    })
  })

  it("uses the immutable correction chain instead of adding a synthetic workday event", () => {
    const beforeFacts = {
      id: WORKDAY_ID,
      workDate: "2026-08-28",
      status: "COMPLETED" as const,
      startedAt: "2026-08-28T09:00:00.000Z",
      pausedAt: null,
      completedAt: "2026-08-28T18:00:00.000Z",
      totalPausedSeconds: 60 * 60,
    }
    const result = rehydrateWorkforceTimesheetDay({
      ...base,
      asOf: new Date("2026-08-28T18:01:00.000Z"),
      workday: {
        ...base.workday,
        startedAt: new Date("2026-08-28T08:45:00.000Z"),
        completedAt: new Date("2026-08-28T17:45:00.000Z"),
      },
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

    expect(result.facts.correctionIds).toEqual(["correction-1"])
    expect(result.calculation.fact).toMatchObject({
      startedAt: "2026-08-28T08:45:00.000Z",
      completedAt: "2026-08-28T17:45:00.000Z",
    })
  })

  it("fails closed when the mutable projection no longer matches immutable history", () => {
    expect(() => rehydrateWorkforceTimesheetDay({
      ...base,
      workday: { ...base.workday, completedAt: new Date("2026-08-28T17:30:00.000Z") },
    })).toThrow("Immutable workday journal does not match the current workday projection")
  })

  it("fails closed when a supplied snapshot belongs to another employee or date", () => {
    expect(() => rehydrateWorkforceTimesheetDay({
      ...base,
      policySnapshot: { ...base.policySnapshot, agentId: "agent-2" },
    })).toThrow(WorkforceTimesheetRehydrationError)
    expect(() => rehydrateWorkforceTimesheetDay({
      ...base,
      shiftSnapshot: {
        ...base.shiftSnapshot,
        workDate: new Date("2026-08-29T00:00:00.000Z"),
      },
    })).toThrow("shift snapshot does not belong to this workday date")
  })
})
