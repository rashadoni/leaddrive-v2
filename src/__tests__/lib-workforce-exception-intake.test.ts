import { describe, expect, it } from "vitest"
import {
  WORKFORCE_EXCEPTION_INTAKE_BASELINE_V1,
  WorkforceExceptionIntakeError,
  intakeMaterializedWorkforceException,
  proposeWorkforceMissedFinishAction,
  proposeWorkforceNoShowReview,
} from "@/lib/workforce/exception-intake"

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
