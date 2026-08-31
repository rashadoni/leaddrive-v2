import { describe, expect, it } from "vitest"
import {
  WORKFORCE_EXCEPTION_INTAKE_BASELINE_V1,
  WorkforceExceptionIntakeError,
  WORKFORCE_NO_SHOW_DETECTOR_VERSION,
  createWorkforceNoShowExceptionCaseDraft,
  intakeMaterializedWorkforceException,
  proposeWorkforceMissedFinishAction,
  proposeWorkforceNoShowReview,
  proposeWorkforceNoShowReviewFromResolvedConfiguration,
  resolvePublishedWorkforceNoShowExpectedSchedule,
} from "@/lib/workforce/exception-intake"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"

const SHIFT_DEFINITION = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: "Asia/Baku",
  daysOfWeek: [1, 2, 3, 4, 5],
}
const POLICY_DEFINITION = {
  expectedWorkSeconds: 8 * 60 * 60,
  lateGraceSeconds: 15 * 60,
  undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0,
  longPauseThresholdSeconds: 60 * 60,
}

const EXPECTED_START = "2026-08-31T05:00:00.000Z" // 09:00 Asia/Baku

function noShowInput(overrides: Partial<Parameters<typeof proposeWorkforceNoShowReview>[0]> = {}) {
  return {
    asOf: "2026-08-31T05:15:00.000Z",
    expectedSchedule: {
      publication: "PUBLISHED" as const,
      expectedStartAt: EXPECTED_START,
      graceSeconds: 900,
    },
    calendar: {
      attendanceExpected: true,
      noShowEligible: true,
      excused: false,
    },
    workdayObservation: "COMPLETE_SEARCH_NO_WORKDAY" as const,
    ...overrides,
  }
}

function resolvedNoShowConfiguration(overrides: Record<string, unknown> = {}) {
  const shift = {
    id: "shift-1",
    teamId: null,
    isDefault: true,
    version: 1,
    status: "ACTIVE",
    timezone: "Asia/Baku",
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    retiredAt: null,
    definition: SHIFT_DEFINITION,
    definitionHash: workforceShiftDefinitionHash(SHIFT_DEFINITION),
    scope: "ORGANIZATION",
    assignmentId: null,
    defaultAssignmentId: "default-assignment-1",
    teamMembershipId: "membership-1",
    teamIdAtWorkday: "team-1",
    schedule: {
      workDate: "2026-08-31",
      timezone: "Asia/Baku",
      plannedStartAt: EXPECTED_START,
      plannedEndAt: "2026-08-31T14:00:00.000Z",
    },
  }
  const policy = {
    id: "policy-1",
    teamId: null,
    version: 1,
    status: "ACTIVE",
    name: "Baku standard",
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveTo: null,
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    retiredAt: null,
    definition: POLICY_DEFINITION,
    definitionHash: workforcePolicyDefinitionHash(POLICY_DEFINITION),
    scope: "ORGANIZATION",
    teamMembershipId: "membership-1",
    teamIdAtWorkday: "team-1",
  }
  return {
    workDate: "2026-08-31",
    policy,
    shift,
    ...overrides,
  }
}

describe("Workforce exception intake", () => {
  it("keeps calculation deviations review-only and labels overtime non-payable", () => {
    expect(intakeMaterializedWorkforceException("LATE_START")).toEqual({
      kind: "MATERIALIZED_DEVIATION",
      type: "LATE_START",
      policy: WORKFORCE_EXCEPTION_INTAKE_BASELINE_V1,
      operationalLabel: "ATTENDANCE_DEVIATION",
    })
    expect(intakeMaterializedWorkforceException("OVERTIME")).toMatchObject({
      operationalLabel: "NON_PAYABLE_OVERTIME_DEVIATION",
      policy: {
        assignment: "UNASSIGNED_PENDING_TENANT_POLICY",
        severity: null,
        slaSeconds: null,
        automaticOutcome: "NONE",
        employeeVisibility: "REQUIRED_BEFORE_HR_DECISION",
      },
    })
  })

  it("proposes a review only after a published, eligible schedule has passed its grace", () => {
    expect(proposeWorkforceNoShowReview(noShowInput())).toEqual({
      outcome: "PROPOSE_REVIEW_CASE",
      code: "WORKFORCE_NO_SHOW_PUBLISHED_EXPECTATION_MISSED",
      policy: WORKFORCE_EXCEPTION_INTAKE_BASELINE_V1,
    })
  })

  it("derives the no-show schedule and grace only from matching published server configuration", () => {
    const configuration = resolvedNoShowConfiguration()
    expect(resolvePublishedWorkforceNoShowExpectedSchedule(configuration)).toEqual({
      publication: "PUBLISHED",
      expectedStartAt: EXPECTED_START,
      graceSeconds: 900,
    })
    expect(proposeWorkforceNoShowReviewFromResolvedConfiguration({
      asOf: "2026-08-31T05:15:00.000Z",
      configuration,
      calendar: { attendanceExpected: true, noShowEligible: true, excused: false },
      workdayObservation: "COMPLETE_SEARCH_NO_WORKDAY",
    })).toMatchObject({ code: "WORKFORCE_NO_SHOW_PUBLISHED_EXPECTATION_MISSED" })
  })

  it("binds a scheduled no-show case to both its published segment and exact expected day", () => {
    const proposal = proposeWorkforceNoShowReview(noShowInput())
    const firstDay = createWorkforceNoShowExceptionCaseDraft({
      organizationId: "org-1",
      agentId: "agent-1",
      segmentId: "segment-1",
      expectedWorkDate: "2026-08-31",
      proposal,
    })
    const nextDay = createWorkforceNoShowExceptionCaseDraft({
      organizationId: "org-1",
      agentId: "agent-1",
      segmentId: "segment-1",
      expectedWorkDate: "2026-09-01",
      proposal,
    })

    expect(firstDay).toMatchObject({
      kind: "NO_SHOW",
      detectorVersion: WORKFORCE_NO_SHOW_DETECTOR_VERSION,
      links: {
        workdayId: null,
        workdayEventId: null,
        evidenceId: null,
        segmentId: "segment-1",
        expectedWorkDate: "2026-08-31",
      },
    })
    expect(nextDay?.deduplicationKey).not.toBe(firstDay?.deduplicationKey)
    expect(createWorkforceNoShowExceptionCaseDraft({
      organizationId: "org-1",
      agentId: "agent-1",
      segmentId: "segment-1",
      expectedWorkDate: "2026-08-31",
      proposal: proposeWorkforceNoShowReview(noShowInput({
        workdayObservation: "WORKDAY_EXISTS",
      })),
    })).toBeNull()
  })

  it("fails closed when resolved configuration is tampered, mismatched or was not active at expected start", () => {
    const scheduleMismatch = resolvedNoShowConfiguration({
      shift: { ...resolvedNoShowConfiguration().shift, schedule: null },
    })
    expect(() => resolvePublishedWorkforceNoShowExpectedSchedule(scheduleMismatch)).toThrow(expect.objectContaining({
      code: "WORKFORCE_NO_SHOW_INPUT_INVALID",
    } satisfies Partial<WorkforceExceptionIntakeError>))

    const teamMismatch = resolvedNoShowConfiguration({
      policy: { ...resolvedNoShowConfiguration().policy, teamMembershipId: "membership-other" },
    })
    expect(() => resolvePublishedWorkforceNoShowExpectedSchedule(teamMismatch)).toThrow(expect.objectContaining({
      code: "WORKFORCE_NO_SHOW_INPUT_INVALID",
    } satisfies Partial<WorkforceExceptionIntakeError>))

    const futureShift = resolvedNoShowConfiguration({
      shift: {
        ...resolvedNoShowConfiguration().shift,
        activatedAt: new Date("2026-08-31T06:00:00.000Z"),
      },
    })
    expect(() => resolvePublishedWorkforceNoShowExpectedSchedule(futureShift)).toThrow(expect.objectContaining({
      code: "WORKFORCE_NO_SHOW_INPUT_INVALID",
    } satisfies Partial<WorkforceExceptionIntakeError>))
  })

  it("refuses every unsafe no-show shortcut", () => {
    expect(proposeWorkforceNoShowReview(noShowInput({
      expectedSchedule: { publication: "DRAFT", expectedStartAt: EXPECTED_START, graceSeconds: 900 },
    }))).toMatchObject({ code: "WORKFORCE_NO_SHOW_SCHEDULE_NOT_PUBLISHED" })
    expect(proposeWorkforceNoShowReview(noShowInput({
      calendar: { attendanceExpected: false, noShowEligible: false, excused: false },
    }))).toMatchObject({ code: "WORKFORCE_NO_SHOW_CALENDAR_NOT_ELIGIBLE" })
    expect(proposeWorkforceNoShowReview(noShowInput({
      calendar: { attendanceExpected: true, noShowEligible: false, excused: true },
    }))).toMatchObject({ code: "WORKFORCE_NO_SHOW_EXCUSED" })
    expect(proposeWorkforceNoShowReview(noShowInput({
      workdayObservation: "INCOMPLETE_SEARCH",
    }))).toMatchObject({ code: "WORKFORCE_NO_SHOW_OBSERVATION_INCOMPLETE" })
    expect(proposeWorkforceNoShowReview(noShowInput({
      workdayObservation: "WORKDAY_EXISTS",
    }))).toMatchObject({ code: "WORKFORCE_NO_SHOW_WORKDAY_EXISTS" })
    expect(proposeWorkforceNoShowReview(noShowInput({
      asOf: "2026-08-31T05:14:59.999Z",
    }))).toMatchObject({ code: "WORKFORCE_NO_SHOW_GRACE_NOT_EXPIRED" })
  })

  it("rejects non-canonical clock input rather than silently applying a grace period", () => {
    expect(() => proposeWorkforceNoShowReview(noShowInput({
      asOf: "2026-08-31T05:15:00Z",
    }))).toThrow(expect.objectContaining({
      code: "WORKFORCE_NO_SHOW_INPUT_INVALID",
    } satisfies Partial<WorkforceExceptionIntakeError>))
  })
})

function missedFinishInput(overrides: Partial<Parameters<typeof proposeWorkforceMissedFinishAction>[0]> = {}) {
  return {
    asOf: "2026-08-31T14:30:00.000Z", // 18:30 Asia/Baku
    workday: {
      status: "STARTED" as const,
      scheduleSnapshot: "IMMUTABLE" as const,
      expectedFinishAt: "2026-08-31T14:00:00.000Z", // 18:00 Asia/Baku
    },
    observation: "COMPLETE" as const,
    timing: { privateReminderAfterSeconds: 900, reviewAfterSeconds: 7_200 },
    ...overrides,
  }
}

describe("Workforce missed-finish intake", () => {
  it("proposes a generic private reminder without fabricating a finish", () => {
    expect(proposeWorkforceMissedFinishAction(missedFinishInput())).toEqual({
      outcome: "PROPOSE_PRIVATE_REMINDER",
      code: "WORKFORCE_MISSED_FINISH_REMINDER_DUE",
      notificationPayload: "GENERIC_OPEN_WORKDAY_REMINDER",
    })
  })

  it("escalates only stale, complete observations to reviewed manual correction", () => {
    expect(proposeWorkforceMissedFinishAction(missedFinishInput({
      asOf: "2026-08-31T16:00:00.000Z",
    }))).toEqual({
      outcome: "PROPOSE_REVIEW_CASE",
      code: "WORKFORCE_MISSED_FINISH_STALE_OPEN_WORKDAY",
      policy: WORKFORCE_EXCEPTION_INTAKE_BASELINE_V1,
      automaticFinish: "FORBIDDEN",
      correction: "REQUIRES_HUMAN_REVIEW",
    })
  })

  it("does not notify or create a case from incomplete, ambiguous, early or completed state", () => {
    expect(proposeWorkforceMissedFinishAction(missedFinishInput({
      observation: "INCOMPLETE",
    }))).toMatchObject({ code: "WORKFORCE_MISSED_FINISH_OBSERVATION_INCOMPLETE" })
    expect(proposeWorkforceMissedFinishAction(missedFinishInput({
      workday: { status: "STARTED", scheduleSnapshot: "MISSING_OR_AMBIGUOUS", expectedFinishAt: "2026-08-31T14:00:00.000Z" },
    }))).toMatchObject({ code: "WORKFORCE_MISSED_FINISH_SNAPSHOT_UNAVAILABLE" })
    expect(proposeWorkforceMissedFinishAction(missedFinishInput({
      asOf: "2026-08-31T14:14:59.999Z",
    }))).toMatchObject({ code: "WORKFORCE_MISSED_FINISH_GRACE_NOT_EXPIRED" })
    expect(proposeWorkforceMissedFinishAction(missedFinishInput({
      workday: { status: "COMPLETED", scheduleSnapshot: "IMMUTABLE", expectedFinishAt: "2026-08-31T14:00:00.000Z" },
    }))).toMatchObject({ code: "WORKFORCE_MISSED_FINISH_WORKDAY_NOT_OPEN" })
  })

  it("rejects inverted reminder and review thresholds", () => {
    expect(() => proposeWorkforceMissedFinishAction(missedFinishInput({
      timing: { privateReminderAfterSeconds: 7_200, reviewAfterSeconds: 900 },
    }))).toThrow(expect.objectContaining({
      code: "WORKFORCE_NO_SHOW_INPUT_INVALID",
    } satisfies Partial<WorkforceExceptionIntakeError>))
  })
})
