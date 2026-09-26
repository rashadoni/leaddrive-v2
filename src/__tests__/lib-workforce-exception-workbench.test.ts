import { describe, expect, it } from "vitest"
import {
  evaluateWorkforceExceptionWorkbenchContext,
  MAX_WORKFORCE_EXCEPTION_DECISIONS,
} from "@/lib/workforce/exception-workbench"

const T0 = new Date("2026-09-26T09:00:00.000Z")
const T1 = new Date("2026-09-26T10:00:00.000Z")
const T2 = new Date("2026-09-26T11:00:00.000Z")
const T3 = new Date("2026-09-26T12:00:00.000Z")

function evaluate(overrides: Partial<Parameters<typeof evaluateWorkforceExceptionWorkbenchContext>[0]> = {}) {
  return evaluateWorkforceExceptionWorkbenchContext({
    kind: "LATE_START",
    workdayId: "workday_1",
    priorDecisions: [],
    decisionHistoryComplete: true,
    employeeResponseInstants: [],
    correctionRequests: [],
    correctionContextComplete: true,
    ...overrides,
  })
}

describe("Workforce exception workbench context", () => {
  it("offers only non-terminal exact actions in this concurrency-safe slice", () => {
    expect(evaluate()).toMatchObject({ stage: "OPEN", availableDecisions: ["ACKNOWLEDGE"] })
    expect(evaluate({
      priorDecisions: [{ decisionCode: "ACKNOWLEDGE", createdAt: T0 }],
    })).toMatchObject({
      stage: "HR_REVIEW",
      correctionState: "NOT_REQUESTED",
      availableDecisions: ["REQUEST_EMPLOYEE_RESPONSE", "REQUEST_TIME_CORRECTION"],
    })
  })

  it("accepts existing escalation history without offering escalation in v1", () => {
    expect(evaluate({
      priorDecisions: [{ decisionCode: "ESCALATE_TO_HR", createdAt: T0 }],
    })).toMatchObject({
      stage: "HR_REVIEW",
      availableDecisions: ["REQUEST_EMPLOYEE_RESPONSE", "REQUEST_TIME_CORRECTION"],
    })
  })

  it("treats an exact linked correction request as the current employee-response signal", () => {
    expect(evaluate({
      priorDecisions: [{ decisionCode: "REQUEST_TIME_CORRECTION", createdAt: T1 }],
      correctionRequests: [{
        type: "TIME_CORRECTION",
        status: "PENDING",
        submittedAt: T2,
        appliedCorrectionCount: 0,
      }],
    })).toMatchObject({
      stage: "AWAITING_EMPLOYEE_RESPONSE",
      correctionState: "PENDING",
      employeeVisibility: "RECORDED",
      availableDecisions: ["ACKNOWLEDGE"],
    })
  })

  it("does not reuse an employee response recorded before the latest reopen cycle", () => {
    expect(evaluate({
      priorDecisions: [
        { decisionCode: "ACKNOWLEDGE", createdAt: T0 },
        { decisionCode: "RESOLVE_NO_CHANGE", createdAt: T1 },
        { decisionCode: "REOPEN_FOR_REVIEW", createdAt: T2 },
      ],
      employeeResponseInstants: [T1],
    })).toMatchObject({
      stage: "HR_REVIEW",
      employeeVisibility: "NOT_RECORDED",
    })
  })

  it("recognizes exact applied-correction proof but keeps resolution unavailable until shared locking", () => {
    expect(evaluate({
      priorDecisions: [{ decisionCode: "ACKNOWLEDGE", createdAt: T0 }],
      correctionRequests: [{
        type: "TIME_CORRECTION",
        status: "APPROVED",
        submittedAt: T1,
        appliedCorrectionCount: 1,
      }],
    })).toMatchObject({
      correctionState: "APPLIED",
      employeeVisibility: "RECORDED",
      availableDecisions: [],
    })
  })

  it("keeps schedule-only no-show on acknowledge-only review", () => {
    expect(evaluate({ kind: "NO_SHOW", workdayId: null })).toMatchObject({
      stage: "OPEN",
      correctionState: "NOT_REQUESTED",
      availableDecisions: ["ACKNOWLEDGE"],
    })
    expect(evaluate({
      kind: "NO_SHOW",
      workdayId: null,
      priorDecisions: [{ decisionCode: "ACKNOWLEDGE", createdAt: T0 }],
    })).toMatchObject({ stage: "HR_REVIEW", availableDecisions: [] })
  })

  it("keeps a complete 64-decision history readable but offers no 65th append", () => {
    expect(evaluate({
      priorDecisions: Array.from({ length: MAX_WORKFORCE_EXCEPTION_DECISIONS }, (_, index) => ({
        decisionCode: "ACKNOWLEDGE",
        createdAt: new Date(T0.getTime() + index),
      })),
    })).toMatchObject({
      stage: "HR_REVIEW",
      correctionState: "NOT_REQUESTED",
      availableDecisions: [],
    })
  })

  it("fails closed on truncated or inconsistent correction history", () => {
    expect(evaluate({ decisionHistoryComplete: false })).toMatchObject({
      stage: "DATA_INTEGRITY_REVIEW",
      availableDecisions: [],
    })
    expect(evaluate({
      correctionRequests: [{
        type: "TIME_CORRECTION",
        status: "APPROVED",
        submittedAt: T3,
        appliedCorrectionCount: 0,
      }],
    })).toMatchObject({ stage: "DATA_INTEGRITY_REVIEW", availableDecisions: [] })
  })
})
