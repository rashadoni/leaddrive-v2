import { describe, expect, it, vi } from "vitest"
import {
  loadWorkforceEmployeeToday,
  workforceEmployeeSegmentTransition,
  workforceEmployeeTodayProjection,
  workforceEmployeeTodayServerOutcome,
} from "@/lib/workforce/employee-today"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"

const assignment = {
  state: "ASSIGNED" as const,
  templateName: "Baku standard",
  timezone: "Asia/Baku",
  plannedStartAt: "2026-09-14T05:00:00.000Z",
  plannedEndAt: "2026-09-14T14:00:00.000Z",
  segments: [{
    sequence: 1,
    mode: "SITE",
    startTime: "09:00",
    endTime: "18:00",
    siteName: "Baku HQ",
    transition: { state: "NOT_RECORDED" as const, arrivalAt: null, departureAt: null },
  }],
}

function project(overrides: Partial<Parameters<typeof workforceEmployeeTodayProjection>[0]> = {}) {
  return workforceEmployeeTodayProjection({
    status: "NOT_STARTED",
    previousOpen: false,
    calendar: { attendanceExpected: true },
    assignment,
    policyDefinition: { expectedWorkSeconds: 28_800 },
    policyUnavailable: false,
    serverOutcome: null,
    now: new Date("2026-09-14T05:30:00.000Z"),
    ...overrides,
  })
}

describe("employee Workforce Today projection", () => {
  it("summarizes append-only segment claims without claiming physical presence", () => {
    const arrival = {
      segmentId: "segment-a",
      kind: "ARRIVAL" as const,
      claimedAt: new Date("2026-09-14T05:01:00.000Z"),
      attendanceReviewState: "NOT_REQUIRED" as const,
    }
    expect(workforceEmployeeSegmentTransition("segment-a", [arrival])).toEqual({
      state: "ARRIVED",
      arrivalAt: "2026-09-14T05:01:00.000Z",
      departureAt: null,
    })
    expect(workforceEmployeeSegmentTransition("segment-a", [
      arrival,
      {
        segmentId: "segment-a",
        kind: "DEPARTURE",
        claimedAt: new Date("2026-09-14T09:00:00.000Z"),
        attendanceReviewState: "PENDING_REVIEW",
      },
    ])).toEqual({
      state: "PENDING_REVIEW",
      arrivalAt: "2026-09-14T05:01:00.000Z",
      departureAt: "2026-09-14T09:00:00.000Z",
    })
    expect(workforceEmployeeSegmentTransition("segment-b", [arrival])).toEqual({
      state: "NOT_RECORDED",
      arrivalAt: null,
      departureAt: null,
    })
  })

  it("offers exactly one server-valid START for an assigned ordinary day", () => {
    const result = project()
    expect(result.action).toEqual({
      primary: "START",
      endpoint: "/api/v1/workforce/today/action",
      enabled: true,
      blockedReason: null,
    })
    expect(result.evidence).toEqual({ state: "NOT_REQUIRED", methods: [] })
  })

  it("selects PAUSE before planned end and FINISH at planned end", () => {
    expect(project({ status: "STARTED" }).action.primary).toBe("PAUSE")
    expect(project({
      status: "STARTED",
      now: new Date("2026-09-14T14:00:00.000Z"),
    }).action.primary).toBe("FINISH")
  })

  it("selects RESUME for a paused workday before planned end", () => {
    expect(project({ status: "PAUSED" }).action).toMatchObject({ primary: "RESUME", enabled: true })
  })

  it("keeps a legacy active day closable when its assignment snapshot is unavailable", () => {
    expect(project({
      status: "STARTED",
      assignment: { ...assignment, state: "UNAVAILABLE", plannedStartAt: null, plannedEndAt: null, segments: [] },
    }).action).toMatchObject({ primary: "FINISH", enabled: true, blockedReason: null })
  })

  it("fails closed when the next action requires QR or device evidence", () => {
    const result = project({
      policyDefinition: {
        attendance: {
          enforcementVersion: 1,
          qr: { requiredActions: ["START"] },
          deviceTrust: { requiredActions: ["START"] },
        },
      },
    })
    expect(result.evidence).toEqual({ state: "REQUIRED", methods: ["QR", "TRUSTED_DEVICE"] })
    expect(result.action).toMatchObject({ primary: "START", enabled: false, blockedReason: "WEB_PROOF_REQUIRED" })
  })

  it("does not start while a prior day is still open", () => {
    expect(project({ previousOpen: true }).action).toMatchObject({
      primary: "START",
      enabled: false,
      blockedReason: "PREVIOUS_WORKDAY_OPEN",
    })
  })

  it("does not manufacture attendance on a non-working day or missing assignment", () => {
    expect(project({ calendar: { attendanceExpected: false } }).action.blockedReason).toBe("NON_WORKING_DAY")
    expect(project({ assignment: { ...assignment, state: "UNAVAILABLE" } }).action.blockedReason).toBe("ASSIGNMENT_UNAVAILABLE")
  })

  it("shows a receipt only for the employee's own last action, never for a manager reopen", () => {
    const applied = {
      type: "FINISH",
      attendanceReviewState: "NOT_REQUIRED",
      serverReceivedAt: new Date("2026-09-14T14:00:01.000Z"),
      appliedAt: new Date("2026-09-14T14:00:01.100Z"),
    }

    expect(workforceEmployeeTodayServerOutcome(applied)).toEqual({
      state: "APPLIED",
      action: "FINISH",
      serverReceivedAt: "2026-09-14T14:00:01.000Z",
      appliedAt: "2026-09-14T14:00:01.100Z",
    })
    expect(workforceEmployeeTodayServerOutcome({ ...applied, attendanceReviewState: "LEGACY_UNKNOWN" })?.state)
      .toBe("LEGACY_APPLIED")
    // After a reopen the day is paused again; "your FINISH was applied" would
    // contradict it, and the REOPEN itself is not the employee's action.
    expect(workforceEmployeeTodayServerOutcome({ ...applied, type: "REOPEN" })).toBeNull()
    // The manager's undo of a reopen is a FINISH, but not the employee's: the
    // day reads as finished from its status, with no receipt in their name.
    expect(workforceEmployeeTodayServerOutcome({ ...applied, clientEventId: "reopen-undo:operation-1" })).toBeNull()
    expect(workforceEmployeeTodayServerOutcome({ ...applied, clientEventId: "finish-from-phone" })?.action).toBe("FINISH")
    expect(workforceEmployeeTodayServerOutcome({ ...applied, serverReceivedAt: null })).toBeNull()
    expect(workforceEmployeeTodayServerOutcome(null)).toBeNull()
  })

  it("keeps the server receipt distinct from a pending human review", () => {
    const result = project({
      serverOutcome: {
        state: "PENDING_REVIEW",
        action: "START",
        serverReceivedAt: "2026-09-14T05:30:01.000Z",
        appliedAt: "2026-09-14T05:30:01.100Z",
      },
    })
    expect(result.serverOutcome?.state).toBe("PENDING_REVIEW")
    expect(result.action.enabled).toBe(true)
  })

  it("uses the manager plan's exact scope for self assignment and policy", async () => {
    const shiftDefinition = {
      startTime: "09:00", endTime: "18:00", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5],
    }
    const policyDefinition = { expectedWorkSeconds: 28_800 }
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{
        id: "membership-a", teamId: "team-a", effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      }]),
      mtmAgent: { findFirst: vi.fn().mockResolvedValue({ id: "agent-1" }) },
      workforceShiftAssignment: { findMany: vi.fn() },
      workforceShiftDefaultAssignment: { findMany: vi.fn() },
      workforceShiftTeamDefaultAssignment: { findMany: vi.fn() },
      workforceShiftTemplate: { findFirst: vi.fn().mockResolvedValue({
        id: "team-a-day", name: "Team A day", teamId: "team-a", isDefault: false,
        version: 1, status: "ACTIVE", timezone: "UTC",
        activatedAt: new Date("2026-01-01T00:00:00.000Z"), retiredAt: null,
        definition: shiftDefinition, definitionHash: workforceShiftDefinitionHash(shiftDefinition),
      }) },
      workforceShiftSegment: { findMany: vi.fn().mockResolvedValue([]) },
      workforcePolicy: { findMany: vi.fn().mockResolvedValue([{
        id: "team-a-policy", teamId: "team-a", version: 1, status: "ACTIVE", name: "Team A",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null,
        activatedAt: new Date("2026-01-01T00:00:00.000Z"), retiredAt: null,
        definition: policyDefinition, definitionHash: workforcePolicyDefinitionHash(policyDefinition),
      }]) },
    }
    const scopeInstant = new Date("2026-08-31T09:00:00.000Z")
    const result = await loadWorkforceEmployeeToday(db as never, {
      organizationId: "org-workforce",
      agentId: "agent-1",
      date: "2026-08-31",
      timezone: "UTC",
      status: "NOT_STARTED",
      workday: null,
      previousOpen: false,
      calendar: { attendanceExpected: true },
      plannedContext: {
        templateId: "team-a-day",
        calendarTeamId: "team-a",
        scopeInstant,
        plan: {
          state: "ASSIGNED",
          templateName: "Team A day",
          timezone: "UTC",
          plannedStartAt: "2026-08-31T09:00:00.000Z",
          plannedEndAt: "2026-08-31T18:00:00.000Z",
        },
      },
      now: new Date("2026-08-31T12:00:00.000Z"),
    })

    expect(result.assignment).toMatchObject({
      state: "ASSIGNED",
      templateName: "Team A day",
      plannedStartAt: "2026-08-31T09:00:00.000Z",
    })
    expect(result.action).toMatchObject({ primary: "START", enabled: true, blockedReason: null })
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it("fails self assignment closed when the authoritative team context no longer verifies", async () => {
    const shiftDefinition = {
      startTime: "09:00", endTime: "18:00", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5],
    }
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{
        id: "membership-b", teamId: "team-b", effectiveAt: new Date("2026-08-31T10:00:00.000Z"),
      }]),
      mtmAgent: { findFirst: vi.fn().mockResolvedValue({ id: "agent-1" }) },
      workforceShiftAssignment: { findMany: vi.fn() },
      workforceShiftDefaultAssignment: { findMany: vi.fn() },
      workforceShiftTeamDefaultAssignment: { findMany: vi.fn() },
      workforceShiftTemplate: { findFirst: vi.fn().mockResolvedValue({
        id: "team-a-day", name: "Team A day", teamId: "team-a", isDefault: false,
        version: 1, status: "ACTIVE", timezone: "UTC",
        activatedAt: new Date("2026-01-01T00:00:00.000Z"), retiredAt: null,
        definition: shiftDefinition, definitionHash: workforceShiftDefinitionHash(shiftDefinition),
      }) },
      workforceShiftSegment: { findMany: vi.fn() },
      workforcePolicy: { findMany: vi.fn() },
    }
    const result = await loadWorkforceEmployeeToday(db as never, {
      organizationId: "org-workforce",
      agentId: "agent-1",
      date: "2026-08-31",
      timezone: "UTC",
      status: "NOT_STARTED",
      workday: null,
      previousOpen: false,
      calendar: { attendanceExpected: true },
      plannedContext: {
        templateId: "team-a-day",
        calendarTeamId: "team-a",
        scopeInstant: new Date("2026-08-31T09:00:00.000Z"),
        plan: {
          state: "ASSIGNED",
          templateName: "Team A day",
          timezone: "UTC",
          plannedStartAt: "2026-08-31T09:00:00.000Z",
          plannedEndAt: "2026-08-31T18:00:00.000Z",
        },
      },
      now: new Date("2026-08-31T12:00:00.000Z"),
    })

    expect(result.assignment.state).toBe("UNAVAILABLE")
    expect(result.action).toMatchObject({ enabled: false, blockedReason: "ASSIGNMENT_UNAVAILABLE" })
    expect(db.workforcePolicy.findMany).not.toHaveBeenCalled()
  })
})
