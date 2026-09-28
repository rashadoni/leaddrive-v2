import { describe, expect, it } from "vitest"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"
import { workforceWorkdayScheduleSnapshotHash } from "@/lib/workforce/snapshot-writer"
import { rehydrateWorkforceTimesheetDay } from "@/lib/workforce/timesheet-rehydration"

const WORK_DATE = "2026-08-28"
const WORKDAY_ID = "workday-property"
const AGENT_ID = "agent-property"

const POLICY = {
  expectedWorkSeconds: 8 * 60 * 60,
  lateGraceSeconds: 5 * 60,
  undertimeToleranceSeconds: 5 * 60,
  overtimeThresholdSeconds: 15 * 60,
  longPauseThresholdSeconds: 60 * 60,
}

const SHIFT = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: "UTC",
  daysOfWeek: [1, 2, 3, 4, 5],
}

const CALENDAR = {
  date: WORK_DATE,
  state: "SCHEDULED",
  calendarKind: "WORKING_DAY",
  attendanceExpected: true,
  noShowEligible: true,
  excused: false,
  source: null,
  overrideId: null,
  teamMembership: { id: null, teamId: null },
}

const SEGMENT_CASES = [
  { segments: [], sites: [] },
  {
    segments: [{
      id: "travel-1", sequence: 1, mode: "TRAVEL", siteId: null,
      startTime: "10:00", endTime: "11:00", lateGraceSeconds: 0, proofPolicyReference: null,
    }],
    sites: [],
  },
  {
    segments: [
      {
        id: "site-a-segment", sequence: 1, mode: "SITE", siteId: "site-a",
        startTime: "09:00", endTime: "10:00", lateGraceSeconds: 0, proofPolicyReference: null,
      },
      {
        id: "travel-2", sequence: 2, mode: "TRAVEL", siteId: null,
        startTime: "10:00", endTime: "11:00", lateGraceSeconds: 0, proofPolicyReference: null,
      },
      {
        id: "site-b-segment", sequence: 3, mode: "SITE", siteId: "site-b",
        startTime: "11:00", endTime: "12:00", lateGraceSeconds: 0, proofPolicyReference: null,
      },
    ],
    sites: [
      { id: "site-a", addressLabel: "must-not-leak-a", geofenceRevision: { centerLatitude: 40.4 } },
      { id: "site-b", addressLabel: "must-not-leak-b", geofenceRevision: { centerLatitude: 40.5 } },
    ],
  },
] as const

function fixture(input: {
  pauseSeconds: number
  segments: readonly unknown[]
  sites: readonly unknown[]
}) {
  const pauseStartMs = Date.parse("2026-08-28T12:00:00.000Z")
  const events = input.pauseSeconds === 0
    ? [
        { id: "start", type: "START" as const, occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "finish", type: "FINISH" as const, occurredAt: "2026-08-28T18:00:00.000Z" },
      ]
    : [
        { id: "start", type: "START" as const, occurredAt: "2026-08-28T09:00:00.000Z" },
        { id: "pause", type: "PAUSE" as const, occurredAt: new Date(pauseStartMs).toISOString() },
        { id: "resume", type: "RESUME" as const, occurredAt: new Date(pauseStartMs + input.pauseSeconds * 1000).toISOString() },
        { id: "finish", type: "FINISH" as const, occurredAt: "2026-08-28T18:00:00.000Z" },
      ]
  const payload = {
    schemaVersion: 2,
    calendar: CALENDAR,
    segments: input.segments,
    sites: input.sites,
    policySnapshotId: "policy-property",
    shiftSnapshotId: "shift-property",
  }
  return {
    asOf: new Date("2026-08-28T18:00:00.000Z"),
    workday: {
      id: WORKDAY_ID,
      agentId: AGENT_ID,
      workDate: new Date(`${WORK_DATE}T00:00:00.000Z`),
      status: "COMPLETED",
      startedAt: new Date("2026-08-28T09:00:00.000Z"),
      pausedAt: null,
      completedAt: new Date("2026-08-28T18:00:00.000Z"),
      totalPausedSeconds: input.pauseSeconds,
    },
    policySnapshot: {
      id: payload.policySnapshotId,
      workdayId: WORKDAY_ID,
      agentId: AGENT_ID,
      workDate: new Date(`${WORK_DATE}T00:00:00.000Z`),
      definition: POLICY,
      definitionHash: workforcePolicyDefinitionHash(POLICY),
      ...POLICY,
    },
    shiftSnapshot: {
      id: payload.shiftSnapshotId,
      workdayId: WORKDAY_ID,
      agentId: AGENT_ID,
      workDate: new Date(`${WORK_DATE}T00:00:00.000Z`),
      definition: SHIFT,
      definitionHash: workforceShiftDefinitionHash(SHIFT),
      timezone: "UTC",
      plannedStartAt: new Date("2026-08-28T09:00:00.000Z"),
      plannedEndAt: new Date("2026-08-28T18:00:00.000Z"),
    },
    scheduleSnapshot: {
      id: "schedule-property",
      workdayId: WORKDAY_ID,
      agentId: AGENT_ID,
      workDate: new Date(`${WORK_DATE}T00:00:00.000Z`),
      policySnapshotId: payload.policySnapshotId,
      shiftSnapshotId: payload.shiftSnapshotId,
      schemaVersion: 2,
      calendarState: "SCHEDULED",
      calendarSnapshot: CALENDAR,
      segments: input.segments,
      sites: input.sites,
      snapshotHash: workforceWorkdayScheduleSnapshotHash(payload),
    },
    events,
  }
}

describe("immutable Workforce timesheet rehydration properties", () => {
  it("keeps arithmetic a function of actual facts across the bounded segment/travel matrix", () => {
    for (const pauseSeconds of [0, 5 * 60, 30 * 60, 60 * 60]) {
      for (const segmentCase of SEGMENT_CASES) {
        const input = fixture({ pauseSeconds, ...segmentCase })
        const first = rehydrateWorkforceTimesheetDay(input)
        const later = rehydrateWorkforceTimesheetDay({
          ...input,
          asOf: new Date("2026-09-30T00:00:00.000Z"),
        })

        expect(later).toEqual(first)
        expect(first.calculation.fact.workedSeconds).toBe(9 * 60 * 60 - pauseSeconds)
        expect(first.calculation.fact.pausedSeconds).toBe(pauseSeconds)
        expect(first.calculation.immutableSchedule.segmentModes).toEqual(
          segmentCase.segments.map((segment) => segment.mode),
        )
        expect(first.calculation.immutableSchedule.travelTreatment)
          .toBe("NON_PAYROLL_NO_AUTOMATIC_ADJUSTMENT")
        expect(JSON.stringify(first)).not.toContain("must-not-leak")
        expect(JSON.stringify(first)).not.toContain("centerLatitude")
      }
    }
  })

  it("is invariant to JSON object key insertion order while retaining exact immutable hashes", () => {
    const input = fixture({ pauseSeconds: 30 * 60, ...SEGMENT_CASES[1] })
    const reorderedPolicy = {
      longPauseThresholdSeconds: POLICY.longPauseThresholdSeconds,
      overtimeThresholdSeconds: POLICY.overtimeThresholdSeconds,
      undertimeToleranceSeconds: POLICY.undertimeToleranceSeconds,
      lateGraceSeconds: POLICY.lateGraceSeconds,
      expectedWorkSeconds: POLICY.expectedWorkSeconds,
    }
    const reorderedShift = {
      daysOfWeek: SHIFT.daysOfWeek,
      timezone: SHIFT.timezone,
      endTime: SHIFT.endTime,
      startTime: SHIFT.startTime,
    }
    const reorderedCalendar = {
      teamMembership: CALENDAR.teamMembership,
      overrideId: CALENDAR.overrideId,
      source: CALENDAR.source,
      excused: CALENDAR.excused,
      noShowEligible: CALENDAR.noShowEligible,
      attendanceExpected: CALENDAR.attendanceExpected,
      calendarKind: CALENDAR.calendarKind,
      state: CALENDAR.state,
      date: CALENDAR.date,
    }
    const schedulePayload = {
      schemaVersion: 2,
      calendar: reorderedCalendar,
      segments: input.scheduleSnapshot.segments,
      sites: input.scheduleSnapshot.sites,
      policySnapshotId: input.scheduleSnapshot.policySnapshotId,
      shiftSnapshotId: input.scheduleSnapshot.shiftSnapshotId,
    }
    const reordered = rehydrateWorkforceTimesheetDay({
      ...input,
      policySnapshot: {
        ...input.policySnapshot,
        definition: reorderedPolicy,
        definitionHash: workforcePolicyDefinitionHash(reorderedPolicy),
      },
      shiftSnapshot: {
        ...input.shiftSnapshot,
        definition: reorderedShift,
        definitionHash: workforceShiftDefinitionHash(reorderedShift),
      },
      scheduleSnapshot: {
        ...input.scheduleSnapshot,
        calendarSnapshot: reorderedCalendar,
        snapshotHash: workforceWorkdayScheduleSnapshotHash(schedulePayload),
      },
    })

    expect(reordered).toEqual(rehydrateWorkforceTimesheetDay(input))
  })

  it("keeps expected work pinned across a DST-shortened immutable schedule", () => {
    const workDate = "2026-03-29"
    const shift = {
      startTime: "01:00", endTime: "09:00", timezone: "Europe/Berlin", daysOfWeek: [7],
    }
    const calendar = { ...CALENDAR, date: workDate }
    const payload = {
      schemaVersion: 2, calendar, segments: [], sites: [],
      policySnapshotId: "policy-dst", shiftSnapshotId: "shift-dst",
    }
    const result = rehydrateWorkforceTimesheetDay({
      asOf: new Date("2026-03-29T07:00:00.000Z"),
      workday: {
        id: "workday-dst", agentId: AGENT_ID, workDate: new Date(`${workDate}T00:00:00.000Z`),
        status: "COMPLETED", startedAt: new Date("2026-03-29T00:00:00.000Z"), pausedAt: null,
        completedAt: new Date("2026-03-29T07:00:00.000Z"), totalPausedSeconds: 0,
      },
      policySnapshot: {
        id: "policy-dst", workdayId: "workday-dst", agentId: AGENT_ID,
        workDate: new Date(`${workDate}T00:00:00.000Z`), definition: POLICY,
        definitionHash: workforcePolicyDefinitionHash(POLICY), ...POLICY,
      },
      shiftSnapshot: {
        id: "shift-dst", workdayId: "workday-dst", agentId: AGENT_ID,
        workDate: new Date(`${workDate}T00:00:00.000Z`), definition: shift,
        definitionHash: workforceShiftDefinitionHash(shift), timezone: shift.timezone,
        plannedStartAt: new Date("2026-03-29T00:00:00.000Z"),
        plannedEndAt: new Date("2026-03-29T07:00:00.000Z"),
      },
      scheduleSnapshot: {
        id: "schedule-dst", workdayId: "workday-dst", agentId: AGENT_ID,
        workDate: new Date(`${workDate}T00:00:00.000Z`),
        policySnapshotId: payload.policySnapshotId, shiftSnapshotId: payload.shiftSnapshotId,
        schemaVersion: 2, calendarState: "SCHEDULED", calendarSnapshot: calendar,
        segments: [], sites: [], snapshotHash: workforceWorkdayScheduleSnapshotHash(payload),
      },
      events: [
        { id: "start-dst", type: "START", occurredAt: "2026-03-29T00:00:00.000Z" },
        { id: "finish-dst", type: "FINISH", occurredAt: "2026-03-29T07:00:00.000Z" },
      ],
    })

    expect(result.calculation.plan.expectedWorkSeconds).toBe(8 * 60 * 60)
    expect(result.calculation.fact.workedSeconds).toBe(7 * 60 * 60)
    expect(result.calculation.deviations.undertimeSeconds).toBe(60 * 60)
  })
})
