import { describe, expect, it } from "vitest"
import {
  createWorkforceExceptionEmployeeResponseDraft,
  WorkforceExceptionEmployeeResponseError,
} from "@/lib/workforce/exception-employee-response"

const BASE = {
  organizationId: "org-1",
  caseId: "case-1",
  agentId: "agent-1",
  workdayId: "workday-1",
  segmentId: "segment-1",
  clientResponseId: "employee-response-001",
  actorUserId: "user-1",
}

describe("Workforce immutable employee exception response draft", () => {
  it("creates a minimal acknowledgement with no correction or employee text", () => {
    const response = createWorkforceExceptionEmployeeResponseDraft({
      ...BASE,
      responseCode: "ACKNOWLEDGED",
    })

    expect(response).toEqual({
      ...BASE,
      correctionRequestId: null,
      responseCode: "ACKNOWLEDGED",
    })
    expect(JSON.stringify(response)).not.toMatch(/reason|explanation|latitude|longitude|qr|device/i)
  })

  it("links a correction response only by the existing protected request id", () => {
    expect(createWorkforceExceptionEmployeeResponseDraft({
      ...BASE,
      segmentId: undefined,
      responseCode: "CORRECTION_REQUESTED",
      correctionRequestId: "request-1",
    })).toMatchObject({
      segmentId: null,
      correctionRequestId: "request-1",
      responseCode: "CORRECTION_REQUESTED",
    })
  })

  it("rejects an invalid code, an unpaired correction reference and unsafe identifiers", () => {
    for (const input of [
      { ...BASE, responseCode: "RESOLVED" },
      { ...BASE, responseCode: "ACKNOWLEDGED", correctionRequestId: "request-1" },
      { ...BASE, responseCode: "CORRECTION_REQUESTED" },
      { ...BASE, responseCode: "ACKNOWLEDGED", clientResponseId: "bad\nresponse" },
    ]) {
      expect(() => createWorkforceExceptionEmployeeResponseDraft(input))
        .toThrow(expect.objectContaining({
          code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_INPUT_INVALID",
        } satisfies Partial<WorkforceExceptionEmployeeResponseError>))
    }
  })
})
