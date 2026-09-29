import { describe, expect, it, vi } from "vitest"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"
import { workforceWorkdayScheduleSnapshotHash } from "@/lib/workforce/snapshot-writer"
import {
  buildWorkforceManagerTodayRow,
  resolveWorkforceManagerTodayPlanContexts,
  resolveWorkforceManagerTodayPlans,
  workforceManagerTodayCalendarFromSnapshot,
  workforceManagerTodayPlanContextFromNoShowCase,
  workforceManagerTodayPlanFromSnapshot,
} from "@/lib/workforce/manager-today"

const WORK_DATE = "2026-08-31"
const RESOLUTION_AT = new Date("2026-08-31T12:00:00.000Z")

function definition(startTime = "09:00", endTime = "18:00") {
  return { startTime, endTime, timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5] }
}

function template(id: string, teamId: string | null, startTime = "09:00", endTime = "18:00") {
  const value = definition(startTime, endTime)
  return {
    id,
    name: id,
    teamId,
    isDefault: false,
    version: 1,
    status: "ACTIVE",
    timezone: "UTC",
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    retiredAt: null,
    definition: value,
    definitionHash: workforceShiftDefinitionHash(value),
  }
}

function calendar(attendanceExpected = true) {
  return {
    date: WORK_DATE,
    calendarKind: attendanceExpected ? "WORKING_DAY" as const : "WEEKEND" as const,
    state: attendanceExpected ? "SCHEDULED" as const : "NON_WORKING" as const,
    attendanceExpected,
    noShowEligible: attendanceExpected,
    excused: false,
    source: null,
    overrideId: null,
  }
}

describe("Workforce manager Today read model", () => {
  it("accepts only a hash-verified immutable snapshot for an existing workday", () => {
    const shift = definition()
    const snapshot = {
      workDate: new Date("2026-08-31T00:00:00.000Z"),
      timezone: "UTC",
      definition: shift,
      definitionHash: workforceShiftDefinitionHash(shift),
      plannedStartAt: new Date("2026-08-31T09:00:00.000Z"),
      plannedEndAt: new Date("2026-08-31T18:00:00.000Z"),
      template: { name: "Published day" },
    }
    expect(workforceManagerTodayPlanFromSnapshot({ workDate: WORK_DATE, snapshot })).toEqual({
      state: "ASSIGNED",
      source: "IMMUTABLE_WORKDAY_SNAPSHOT",
      templateName: "Published day",
      timezone: "UTC",
      plannedStartAt: "2026-08-31T09:00:00.000Z",
      plannedEndAt: "2026-08-31T18:00:00.000Z",
    })
    expect(workforceManagerTodayPlanFromSnapshot({
      workDate: WORK_DATE,
      snapshot: { ...snapshot, definitionHash: "0".repeat(64) },
    }).state).toBe("UNAVAILABLE")
  })

  it("uses only a hash-verified immutable calendar for an existing workday", () => {
    const shift = definition()
    const calendarSnapshot = {
      date: WORK_DATE,
      state: "SCHEDULED",
      calendarKind: "WORKING_DAY",
      attendanceExpected: true,
      noShowEligible: true,
      excused: false,
      source: null,
      overrideId: null,
      teamMembership: { id: "membership-a", teamId: "team-a" },
    }
    const payload = {
      schemaVersion: 2,
      calendar: calendarSnapshot,
      segments: [],
      sites: [],
      policySnapshotId: "policy-snapshot-1",
      shiftSnapshotId: "shift-snapshot-1",
    }
    const scheduleSnapshot = {
      id: "schedule-snapshot-1",
      workdayId: "workday-1",
      agentId: "agent-1",
      workDate: new Date(`${WORK_DATE}T00:00:00.000Z`),
      policySnapshotId: payload.policySnapshotId,
      shiftSnapshotId: payload.shiftSnapshotId,
      schemaVersion: 2,
      calendarState: "SCHEDULED",
      calendarSnapshot,
      segments: [],
      sites: [],
      snapshotHash: workforceWorkdayScheduleSnapshotHash(payload),
    }
    const input = {
      workDate: WORK_DATE,
      workdayId: "workday-1",
      agentId: "agent-1",
      policySnapshot: { id: payload.policySnapshotId, definitionHash: "a".repeat(64) },
      shiftSnapshot: {
        id: payload.shiftSnapshotId,
        definition: shift,
        definitionHash: workforceShiftDefinitionHash(shift),
      },
      scheduleSnapshot,
    }

    expect(workforceManagerTodayCalendarFromSnapshot(input)).toEqual({
      state: "SCHEDULED",
      attendanceExpected: true,
      noShowEligible: true,
      excused: false,
    })
    expect(workforceManagerTodayCalendarFromSnapshot({
      ...input,
      scheduleSnapshot: { ...scheduleSnapshot, snapshotHash: "0".repeat(64) },
    }).state).toBe("UNAVAILABLE")
  })

  it("shows no-show only from an authorized persisted case", () => {
    expect(buildWorkforceManagerTodayRow({
      workdayStatus: null,
      plan: {
        state: "ASSIGNED", source: "EFFECTIVE_PUBLISHED_SCHEDULE", templateName: "Day",
        timezone: "UTC", plannedStartAt: "2026-08-31T09:00:00.000Z", plannedEndAt: "2026-08-31T18:00:00.000Z",
      },
      calendar: calendar(),
      exceptions: [{ type: "NO_SHOW", status: "OPEN" }],
    }).attendance.state).toBe("NO_SHOW")
    expect(buildWorkforceManagerTodayRow({
      workdayStatus: null,
      plan: {
        state: "ASSIGNED", source: "EFFECTIVE_PUBLISHED_SCHEDULE", templateName: "Day",
        timezone: "UTC", plannedStartAt: "2026-08-31T09:00:00.000Z", plannedEndAt: "2026-08-31T18:00:00.000Z",
      },
      calendar: calendar(),
      exceptions: null,
    }).attendance.state).toBe("SCHEDULED_NOT_STARTED")
  })

  it("does not let ambiguous lower-priority defaults invalidate a personal assignment", async () => {
    const personal = template("personal", null)
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ requestId: "agent-1", teamId: null }]),
      workforceShiftAssignment: { findMany: vi.fn().mockResolvedValue([{ id: "assignment-1", agentId: "agent-1", template: personal }]) },
      workforceShiftDefaultAssignment: { findMany: vi.fn().mockResolvedValue([
        { id: "org-1", template: template("org-1", null) },
        { id: "org-2", template: template("org-2", null) },
      ]) },
      workforceShiftTeamDefaultAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      workforceShiftTemplate: { findMany: vi.fn().mockResolvedValue([
        { ...template("legacy-1", null), isDefault: true },
        { ...template("legacy-2", null), isDefault: true },
      ]) },
    }

    const plans = await resolveWorkforceManagerTodayPlans(db as never, {
      organizationId: "org-workforce",
      agentIds: ["agent-1"],
      workDate: WORK_DATE,
      resolutionAt: RESOLUTION_AT,
    })

    expect(plans.get("agent-1")).toMatchObject({
      state: "ASSIGNED",
      templateName: "personal",
      plannedStartAt: "2026-08-31T09:00:00.000Z",
    })
  })

  it("uses one explicit append-only membership-at-read-time context for an unfactored live row", async () => {
    const teamB = template("team-b-day", "team-b", "10:00", "19:00")
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ requestId: "agent-1", teamId: "team-b" }]),
      workforceShiftAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      workforceShiftDefaultAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      workforceShiftTeamDefaultAssignment: { findMany: vi.fn().mockResolvedValue([
        { id: "default-b", teamId: "team-b", template: teamB },
      ]) },
      workforceShiftTemplate: { findMany: vi.fn().mockResolvedValue([]) },
    }

    const contexts = await resolveWorkforceManagerTodayPlanContexts(db as never, {
      organizationId: "org-workforce",
      agentIds: ["agent-1"],
      workDate: WORK_DATE,
      resolutionAt: RESOLUTION_AT,
    })

    expect(contexts.get("agent-1")).toMatchObject({
      calendarTeamId: "team-b",
      templateId: "team-b-day",
      scopeInstant: RESOLUTION_AT,
      plan: {
        state: "ASSIGNED",
        templateName: "team-b-day",
        plannedStartAt: "2026-08-31T10:00:00.000Z",
      },
    })
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("reconstructs a persisted no-show plan only from its validated case scope", () => {
    expect(workforceManagerTodayPlanContextFromNoShowCase({
      workDate: WORK_DATE,
      calendarTeamId: "team-a",
      templateId: "team-a-day",
      templateName: "Team A day",
      timezone: "UTC",
      plannedStartAt: "2026-08-31T09:00:00.000Z",
      plannedEndAt: "2026-08-31T18:00:00.000Z",
    })).toMatchObject({
      calendarTeamId: "team-a",
      templateId: "team-a-day",
      scopeInstant: new Date("2026-08-31T09:00:00.000Z"),
      plan: {
        state: "ASSIGNED",
        source: "PERSISTED_NO_SHOW_CASE",
        templateName: "Team A day",
        plannedStartAt: "2026-08-31T09:00:00.000Z",
      },
    })
  })
})
