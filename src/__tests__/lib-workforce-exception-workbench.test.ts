import { describe, expect, it } from "vitest"
import {
  evaluateWorkforceExceptionWorkbenchContext,
  MAX_WORKFORCE_EXCEPTION_DECISIONS,
  projectWorkforceExceptionSelfResponseState,
} from "@/lib/workforce/exception-workbench"

function evaluate(overrides: Partial<Parameters<typeof evaluateWorkforceExceptionWorkbenchContext>[0]> = {}) {
  return evaluateWorkforceExceptionWorkbenchContext({
    kind: "LATE_START",
    workdayId: "workday_1",
    priorDecisions: [],
    decisionHistoryComplete: true,
    employeeResponses: [],
    correctionRequests: [],
    correctionContextComplete: true,
    ...overrides,
  })
}

function projectSelfResponse(
  overrides: Partial<Parameters<typeof projectWorkforceExceptionSelfResponseState>[0]> = {},
) {
  return projectWorkforceExceptionSelfResponseState({
    workdayId: "workday_1",
    priorDecisions: [],
    decisionHistoryComplete: true,
    employeeResponses: [],
    ...overrides,
  })
}

describe("Workforce exception workbench context", () => {
  it("offers only non-terminal exact actions in this concurrency-safe slice", () => {
    expect(evaluate()).toMatchObject({ stage: "OPEN", availableDecisions: ["ACKNOWLEDGE"] })
    expect(evaluate({
      priorDecisions: [{ decisionCode: "ACKNOWLEDGE", caseRevision: 1 }],
    })).toMatchObject({
      stage: "HR_REVIEW",
      correctionState: "NOT_REQUESTED",
      availableDecisions: ["REQUEST_EMPLOYEE_RESPONSE", "REQUEST_TIME_CORRECTION"],
    })
  })

  it("accepts existing escalation history without offering escalation in v1", () => {
    expect(evaluate({
      priorDecisions: [{ decisionCode: "ESCALATE_TO_HR", caseRevision: 1 }],
    })).toMatchObject({
      stage: "HR_REVIEW",
      availableDecisions: ["REQUEST_EMPLOYEE_RESPONSE", "REQUEST_TIME_CORRECTION"],
    })
  })

  it("treats an exact linked correction request as the current employee-response signal", () => {
    expect(evaluate({
      priorDecisions: [{ decisionCode: "REQUEST_TIME_CORRECTION", caseRevision: 1 }],
      correctionRequests: [{
        type: "TIME_CORRECTION",
        status: "PENDING",
        exceptionCaseRevision: 1,
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
        { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
        { decisionCode: "RESOLVE_NO_CHANGE", caseRevision: 2 },
        { decisionCode: "REOPEN_FOR_REVIEW", caseRevision: 3 },
      ],
      employeeResponses: [{ observedCaseRevision: 2 }],
    })).toMatchObject({
      stage: "HR_REVIEW",
      employeeVisibility: "NOT_RECORDED",
    })
  })

  it("recognizes exact applied-correction proof but keeps terminal resolution unavailable", () => {
    expect(evaluate({
      priorDecisions: [{ decisionCode: "ACKNOWLEDGE", caseRevision: 1 }],
      correctionRequests: [{
        type: "TIME_CORRECTION",
        status: "APPROVED",
        exceptionCaseRevision: 1,
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
      priorDecisions: [{ decisionCode: "ACKNOWLEDGE", caseRevision: 1 }],
    })).toMatchObject({ stage: "HR_REVIEW", availableDecisions: [] })
  })

  it("keeps a complete 64-decision history readable but offers no 65th append", () => {
    expect(evaluate({
      priorDecisions: Array.from({ length: MAX_WORKFORCE_EXCEPTION_DECISIONS }, (_, index) => ({
        decisionCode: "ACKNOWLEDGE",
        caseRevision: index + 1,
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
        exceptionCaseRevision: 0,
        appliedCorrectionCount: 0,
      }],
    })).toMatchObject({ stage: "DATA_INTEGRITY_REVIEW", availableDecisions: [] })
  })

  it("uses lock-observed revisions instead of client or transaction timestamps", () => {
    const priorDecisions = [
      { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
      { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 2 },
    ]
    expect(evaluate({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: 1 }],
    })).toMatchObject({ employeeVisibility: "NOT_RECORDED", availableDecisions: [] })
    expect(evaluate({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: 2 }],
    })).toMatchObject({ employeeVisibility: "RECORDED", availableDecisions: ["ACKNOWLEDGE"] })
  })

  it("never treats legacy or impossible signal revisions as current-cycle proof", () => {
    const priorDecisions = [{ decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 1 }]
    expect(evaluate({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: null }],
      correctionRequests: [{
        type: "TIME_CORRECTION",
        status: "PENDING",
        exceptionCaseRevision: null,
        appliedCorrectionCount: 0,
      }],
    })).toMatchObject({ employeeVisibility: "NOT_RECORDED", availableDecisions: [] })
    expect(evaluate({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: 2 }],
    })).toMatchObject({ stage: "DATA_INTEGRITY_REVIEW", availableDecisions: [] })
  })

  it("fails closed on a non-contiguous revision stream", () => {
    expect(evaluate({
      priorDecisions: [
        { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
        { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 3 },
      ],
    })).toMatchObject({ stage: "DATA_INTEGRITY_REVIEW", availableDecisions: [] })
  })
})

describe("Workforce employee self-response projection", () => {
  it("requires a response at or after the latest employee-response request", () => {
    const priorDecisions = [
      { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
      { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 2 },
    ]
    expect(projectSelfResponse({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: 1 }],
    })).toBe("NOT_ACKNOWLEDGED")
    expect(projectSelfResponse({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: 2 }],
    })).toBe("ACKNOWLEDGED")
  })

  it("does not reuse a response from before the latest reopen", () => {
    const priorDecisions = [
      { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
      { decisionCode: "RESOLVE_NO_CHANGE", caseRevision: 2 },
      { decisionCode: "REOPEN_FOR_REVIEW", caseRevision: 3 },
    ]
    expect(projectSelfResponse({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: 2 }],
    })).toBe("NOT_ACKNOWLEDGED")
    expect(projectSelfResponse({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: 3 }],
    })).toBe("ACKNOWLEDGED")
  })

  it("keeps non-workday and resolved cases unavailable", () => {
    expect(projectSelfResponse({ workdayId: null })).toBe("UNAVAILABLE")
    expect(projectSelfResponse({
      priorDecisions: [
        { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
        { decisionCode: "RESOLVE_NO_CHANGE", caseRevision: 2 },
      ],
      employeeResponses: [{ observedCaseRevision: 2 }],
    })).toBe("UNAVAILABLE")
  })

  it("fails closed on incomplete, non-contiguous or invalid decision history", () => {
    expect(projectSelfResponse({ decisionHistoryComplete: false })).toBe("UNAVAILABLE")
    expect(projectSelfResponse({
      priorDecisions: [
        { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
        { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 3 },
      ],
    })).toBe("UNAVAILABLE")
    expect(projectSelfResponse({
      priorDecisions: [{ decisionCode: "RESOLVE_NO_CHANGE", caseRevision: 1 }],
    })).toBe("UNAVAILABLE")
    expect(projectSelfResponse({
      priorDecisions: [{ decisionCode: "FUTURE_DECISION", caseRevision: 1 }],
    })).toBe("UNAVAILABLE")
  })

  it("fails closed on impossible response revisions and ignores legacy NULL", () => {
    const priorDecisions = [{ decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 1 }]
    expect(projectSelfResponse({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: 2 }],
    })).toBe("UNAVAILABLE")
    expect(projectSelfResponse({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: null }],
    })).toBe("NOT_ACKNOWLEDGED")
  })

  it("keeps a current response readable at capacity but offers no fresh response", () => {
    const priorDecisions = Array.from({ length: MAX_WORKFORCE_EXCEPTION_DECISIONS }, (_, index) => ({
      decisionCode: "ACKNOWLEDGE",
      caseRevision: index + 1,
    }))
    expect(projectSelfResponse({ priorDecisions })).toBe("UNAVAILABLE")
    expect(projectSelfResponse({
      priorDecisions,
      employeeResponses: [{ observedCaseRevision: MAX_WORKFORCE_EXCEPTION_DECISIONS }],
    })).toBe("ACKNOWLEDGED")
    expect(projectSelfResponse({
      priorDecisions: [...priorDecisions, {
        decisionCode: "ACKNOWLEDGE",
        caseRevision: MAX_WORKFORCE_EXCEPTION_DECISIONS + 1,
      }],
    })).toBe("UNAVAILABLE")
  })
})
