import { describe, expect, it } from "vitest"
import {
  rehydrateWorkforceTimesheetDay,
  WorkforceTimesheetRehydrationError,
} from "@/lib/workforce/timesheet-rehydration"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"
import { workforceWorkdayScheduleSnapshotHash } from "@/lib/workforce/snapshot-writer"

const WORKDAY_ID = "workday-1"
const AGENT_ID = "agent-1"

const policyDefinition = {
  expectedWorkSeconds: 8 * 60 * 60,
  lateGraceSeconds: 5 * 60,
  undertimeToleranceSeconds: 5 * 60,
  overtimeThresholdSeconds: 15 * 60,
  longPauseThresholdSeconds: 60 * 60,
}

const shiftDefinition = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: "UTC",
  daysOfWeek: [1, 2, 3, 4, 5],
  plannedBreaks: [{ startTime: "12:00", endTime: "13:00" }],
}

function scheduleSnapshot(overrides: Partial<{
  calendarSnapshot: unknown
  segments: unknown
  sites: unknown
  snapshotHash: string
}> = {}) {
  const calendarSnapshot = overrides.calendarSnapshot ?? {
    date: "2026-08-28",
    state: "SCHEDULED",
    calendarKind: "WORKING_DAY",
    attendanceExpected: true,
    noShowEligible: true,
    excused: false,
    source: null,
    overrideId: null,
    teamMembership: { id: null, teamId: null },
  }
  const segments = overrides.segments ?? []
  const sites = overrides.sites ?? []
  const payload = {
    schemaVersion: 2,
    calendar: calendarSnapshot,
    segments,
    sites,
    policySnapshotId: "policy-snapshot-1",
    shiftSnapshotId: "shift-snapshot-1",
  }
  return {
    id: "schedule-snapshot-1",
    workdayId: WORKDAY_ID,
    agentId: AGENT_ID,
    workDate: new Date("2026-08-28T00:00:00.000Z"),
    policySnapshotId: payload.policySnapshotId,
    shiftSnapshotId: payload.shiftSnapshotId,
    schemaVersion: payload.schemaVersion,
    calendarState: "SCHEDULED",
    calendarSnapshot,
    segments,
    sites,
    snapshotHash: overrides.snapshotHash ?? workforceWorkdayScheduleSnapshotHash(payload),
  }
}

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
    definition: policyDefinition,
    definitionHash: workforcePolicyDefinitionHash(policyDefinition),
    ...policyDefinition,
  },
  shiftSnapshot: {
    id: "shift-snapshot-1",
    workdayId: WORKDAY_ID,
    agentId: AGENT_ID,
    workDate: new Date("2026-08-28T00:00:00.000Z"),
    definition: shiftDefinition,
    definitionHash: workforceShiftDefinitionHash(shiftDefinition),
    timezone: "UTC",
    plannedStartAt: new Date("2026-08-28T09:00:00.000Z"),
    plannedEndAt: new Date("2026-08-28T18:00:00.000Z"),
  },
  scheduleSnapshot: scheduleSnapshot(),
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
      calculationVersion: 2,
      coreCalculationVersion: 1,
      policySnapshotId: "policy-snapshot-1",
      shiftSnapshotId: "shift-snapshot-1",
      status: "COMPLETED",
      isFinal: true,
      fact: { workedSeconds: 8 * 60 * 60, pausedSeconds: 60 * 60 },
      immutableSchedule: {
        scheduleSnapshotId: "schedule-snapshot-1",
        segmentCount: 0,
        plannedBreakCount: 1,
        breakTreatment: "ACTUAL_PAUSE_EVENTS_ONLY",
        travelTreatment: "NON_PAYROLL_NO_AUTOMATIC_ADJUSTMENT",
      },
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
    expect(() => rehydrateWorkforceTimesheetDay({
      ...base,
      scheduleSnapshot: { ...base.scheduleSnapshot, agentId: "agent-2" },
    })).toThrow("schedule snapshot does not belong to this workday and employee")
  })

  it("fails closed on altered definitions, denormalized values or schedule hashes", () => {
    expect(() => rehydrateWorkforceTimesheetDay({
      ...base,
      policySnapshot: { ...base.policySnapshot, expectedWorkSeconds: 7 * 60 * 60 },
    })).toThrow("Policy snapshot values do not match its immutable definition")
    expect(() => rehydrateWorkforceTimesheetDay({
      ...base,
      shiftSnapshot: { ...base.shiftSnapshot, plannedEndAt: new Date("2026-08-28T17:00:00.000Z") },
    })).toThrow("Shift snapshot values do not match its immutable definition")
    expect(() => rehydrateWorkforceTimesheetDay({
      ...base,
      scheduleSnapshot: { ...base.scheduleSnapshot, snapshotHash: "0".repeat(64) },
    })).toThrow("Schedule snapshot does not match its immutable hash")
  })

  it("binds ordered segments and travel without inventing paid time or leaking site details", () => {
    const segments = [
      {
        id: "segment-site-a", sequence: 1, mode: "SITE", siteId: "site-a",
        startTime: "09:00", endTime: "12:00", lateGraceSeconds: 0, proofPolicyReference: null,
      },
      {
        id: "segment-travel", sequence: 2, mode: "TRAVEL", siteId: null,
        startTime: "13:00", endTime: "14:00", lateGraceSeconds: 0, proofPolicyReference: null,
      },
      {
        id: "segment-site-b", sequence: 3, mode: "SITE", siteId: "site-b",
        startTime: "14:00", endTime: "18:00", lateGraceSeconds: 0, proofPolicyReference: null,
      },
    ]
    const result = rehydrateWorkforceTimesheetDay({
      ...base,
      scheduleSnapshot: scheduleSnapshot({
        segments,
        sites: [
          { id: "site-a", addressLabel: "private-a", centerLatitude: 40.4 },
          { id: "site-b", addressLabel: "private-b", centerLatitude: 40.5 },
        ],
      }),
    })

    expect(result.calculation.fact.workedSeconds).toBe(8 * 60 * 60)
    expect(result.calculation.immutableSchedule).toMatchObject({
      segmentCount: 3,
      segmentModes: ["SITE", "TRAVEL", "SITE"],
      travelTreatment: "NON_PAYROLL_NO_AUTOMATIC_ADJUSTMENT",
    })
    expect(JSON.stringify(result.calculation)).not.toContain("private-a")
    expect(JSON.stringify(result.calculation)).not.toContain("centerLatitude")
  })
})
