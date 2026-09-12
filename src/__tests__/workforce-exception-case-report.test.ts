import { describe, expect, it } from "vitest"
import {
  buildWorkforceExceptionCaseReport,
  WorkforceExceptionCaseReportError,
} from "@/lib/workforce/exception-case-report"

describe("Workforce exception-case aggregate report", () => {
  it("aggregates persisted review states without returning people, cases or proof", () => {
    const report = buildWorkforceExceptionCaseReport({
      cases: [
        { agentId: "agent-1", kind: "NO_SHOW", decisionCodes: [], decisionHistoryTruncated: false, recordedEmployeeResponseCount: 0 },
        { agentId: "agent-1", kind: "NO_SHOW", decisionCodes: ["ACKNOWLEDGE"], decisionHistoryTruncated: false, recordedEmployeeResponseCount: 0 },
        { agentId: "agent-2", kind: "LATE_START", decisionCodes: ["ACKNOWLEDGE", "REQUEST_EMPLOYEE_RESPONSE"], decisionHistoryTruncated: false, recordedEmployeeResponseCount: 1 },
        { agentId: "agent-3", kind: "LATE_START", decisionCodes: ["ACKNOWLEDGE", "RESOLVE_NO_CHANGE"], decisionHistoryTruncated: false, recordedEmployeeResponseCount: 0 },
        { agentId: "agent-4", kind: "DEVICE_SECURITY_REVIEW", decisionCodes: ["UNRECOGNISED"], decisionHistoryTruncated: false, recordedEmployeeResponseCount: 0 },
      ],
    })

    expect(report).toEqual({
      source: "APPEND_ONLY_EXCEPTION_CASES",
      summary: {
        employees: 4,
        cases: 5,
        open: 1,
        awaitingEmployeeResponse: 1,
        hrReview: 1,
        resolved: 1,
        dataIntegrityReview: 1,
        employeeResponsesReceived: 1,
      },
      byType: [
        {
          type: "LATE_START",
          triageSeverity: "ROUTINE_REVIEW",
          cases: 2,
          open: 0,
          awaitingEmployeeResponse: 1,
          hrReview: 0,
          resolved: 1,
          dataIntegrityReview: 0,
          employeeResponsesReceived: 1,
        },
        {
          type: "NO_SHOW",
          triageSeverity: "ATTENTION_REVIEW",
          cases: 2,
          open: 1,
          awaitingEmployeeResponse: 0,
          hrReview: 1,
          resolved: 0,
          dataIntegrityReview: 0,
          employeeResponsesReceived: 0,
        },
        {
          type: "DEVICE_SECURITY_REVIEW",
          triageSeverity: "ATTENTION_REVIEW",
          cases: 1,
          open: 0,
          awaitingEmployeeResponse: 0,
          hrReview: 0,
          resolved: 0,
          dataIntegrityReview: 1,
          employeeResponsesReceived: 0,
        },
      ],
      unavailable: {
        employeeDetails: "EXCLUDED_FROM_AGGREGATE",
        caseReferences: "EXCLUDED_FROM_AGGREGATE",
        rawEvidence: "EXCLUDED_FROM_AGGREGATE",
        decisionReasons: "EXCLUDED_FROM_AGGREGATE",
        attendanceConclusion: "CASE_COUNTS_ARE_NOT_PRESENCE_OR_DISCIPLINARY_CONCLUSIONS",
      },
    })
    expect(JSON.stringify(report)).not.toMatch(/agent-|UNRECOGNISED/)
  })

  it("fails closed when a stored case is outside the approved generic taxonomy", () => {
    expect(() => buildWorkforceExceptionCaseReport({
      cases: [{ agentId: "agent-1", kind: "UNSAFE_NEW_CASE", decisionCodes: [], decisionHistoryTruncated: false, recordedEmployeeResponseCount: 0 }],
    })).toThrow(expect.objectContaining({
      code: "WORKFORCE_EXCEPTION_CASE_REPORT_INPUT_INVALID",
    } satisfies Partial<WorkforceExceptionCaseReportError>))
  })

  it("marks a bounded, incomplete decision ledger for integrity review", () => {
    const report = buildWorkforceExceptionCaseReport({
      cases: [{
        agentId: "agent-1",
        kind: "NO_SHOW",
        decisionCodes: ["ACKNOWLEDGE", "RESOLVE_NO_CHANGE"],
        decisionHistoryTruncated: true,
        recordedEmployeeResponseCount: 0,
      }],
    })
    expect(report.summary).toMatchObject({ dataIntegrityReview: 1, resolved: 0 })
  })
})
