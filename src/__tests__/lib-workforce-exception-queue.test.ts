import { describe, expect, it } from "vitest"
import {
  projectWorkforceExceptionQueueItem,
  WorkforceExceptionQueueError,
  workforceExceptionQueueEmployeeResponseState,
} from "@/lib/workforce/exception-queue"

const BASE = {
  displayReference: "WF-CASE-2026-0001",
  employeeDisplayName: "A. Employee",
  type: "NO_SHOW",
  createdAt: new Date("2026-09-01T09:00:00.000Z"),
  evidenceState: "NOT_REQUIRED",
  employeeResponse: "NOT_REQUESTED",
  now: new Date("2026-09-01T10:30:45.000Z"),
}

describe("Workforce raw-proof-free exception queue projection", () => {
  it("projects only safe review fields and an explicit human next action", () => {
    expect(projectWorkforceExceptionQueueItem({ ...BASE, decisionCodes: ["ACKNOWLEDGE"] })).toEqual({
      displayReference: "WF-CASE-2026-0001",
      employeeDisplayName: "A. Employee",
      type: "NO_SHOW",
      triageSeverity: "ATTENTION_REVIEW",
      ageSeconds: 5445,
      stage: "HR_REVIEW",
      evidenceState: "NOT_REQUIRED",
      employeeResponse: "NOT_REQUESTED",
      nextAction: "HUMAN_REVIEW_REQUIRED",
    })
  })

  it("makes an employee response visible without automatically resolving a case", () => {
    expect(projectWorkforceExceptionQueueItem({
      ...BASE,
      type: "LATE_START",
      evidenceState: "LINKED_RESTRICTED",
      employeeResponse: "RECEIVED",
      decisionCodes: ["ACKNOWLEDGE", "REQUEST_EMPLOYEE_RESPONSE"],
    })).toMatchObject({
      stage: "AWAITING_EMPLOYEE_RESPONSE",
      nextAction: "ACKNOWLEDGE_HR_REVIEW",
      evidenceState: "LINKED_RESTRICTED",
    })
  })

  it("routes malformed lifecycle data to integrity review rather than a false resolution", () => {
    expect(projectWorkforceExceptionQueueItem({ ...BASE, decisionCodes: ["AUTO_PAYROLL"] }))
      .toMatchObject({ stage: "DATA_INTEGRITY_REVIEW", nextAction: "ESCALATE_DATA_INTEGRITY_REVIEW" })
  })

  it("fails closed for an unknown taxonomy type or impossible clock", () => {
    expect(() => projectWorkforceExceptionQueueItem({ ...BASE, type: "UNKNOWN", decisionCodes: [] }))
      .toThrow(expect.objectContaining({ code: "WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID" } satisfies Partial<WorkforceExceptionQueueError>))
    expect(() => projectWorkforceExceptionQueueItem({
      ...BASE,
      decisionCodes: [],
      now: new Date("2026-09-01T08:59:59.000Z"),
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID" }))
  })
})

describe("workforceExceptionQueueEmployeeResponseState", () => {
  it("uses only lifecycle and receipt existence, never employee content", () => {
    expect(workforceExceptionQueueEmployeeResponseState({
      decisionCodes: ["ACKNOWLEDGE", "REQUEST_EMPLOYEE_RESPONSE"],
      recordedResponseCount: 0,
    })).toBe("PENDING")
    expect(workforceExceptionQueueEmployeeResponseState({
      decisionCodes: ["ACKNOWLEDGE", "REQUEST_EMPLOYEE_RESPONSE"],
      recordedResponseCount: 1,
    })).toBe("RECEIVED")
    expect(workforceExceptionQueueEmployeeResponseState({
      decisionCodes: ["ACKNOWLEDGE"],
      recordedResponseCount: 0,
    })).toBe("NOT_REQUESTED")
  })
})
