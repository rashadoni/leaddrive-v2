import { describe, expect, it } from "vitest"
import {
  captureWorkforceSelfRequestSubmissionAttempt,
  readWorkforceSelfRequestSubmissionReply,
  retainWorkforceSelfRequestSubmissionAfterFailure,
  WorkforceSelfRequestSubmissionError,
  type WorkforceSelfRequestSubmissionInput,
} from "@/lib/workforce/self-request-submission-attempt"

const original = (): WorkforceSelfRequestSubmissionInput => ({
  clientRequestId: "original-client-key",
  type: "TIME_CORRECTION",
  startDate: "2026-10-01",
  endDate: "2026-10-01",
  reason: "Original request",
  correctionWorkdayId: "original-workday",
  exceptionCaseId: "original-case",
  requestedStartLocal: "2026-10-01T09:00",
})

function failure(status: number, body: unknown): WorkforceSelfRequestSubmissionError {
  try { readWorkforceSelfRequestSubmissionReply(status, body, "Unavailable") } catch (error) {
    expect(error).toBeInstanceOf(WorkforceSelfRequestSubmissionError)
    return error as WorkforceSelfRequestSubmissionError
  }
  throw new Error("Expected a refusal or uncertain reply")
}

describe("Workforce self-request unknown submission outcome", () => {
  it("captures an immutable copy so later draft, day and source changes cannot change a retry", () => {
    const input = original(), attempt = captureWorkforceSelfRequestSubmissionAttempt(input)
    input.reason = "Edited request"
    input.type = "LEAVE"
    input.startDate = input.endDate = "2026-10-02"
    input.correctionWorkdayId = "different-workday"
    delete input.exceptionCaseId
    expect(attempt.input).toEqual(original())
    expect(Object.isFrozen(attempt)).toBe(true)
    expect(Object.isFrozen(attempt.input)).toBe(true)
  })

  it.each([false, true])("accepts only the canonical committed reply (idempotent=%s)", (idempotent) => {
    expect(readWorkforceSelfRequestSubmissionReply(idempotent ? 200 : 201, {
      success: true, idempotent, data: { id: "committed-request" },
    }, "Unavailable")).toEqual({ idempotent })
  })

  it.each([
    [400, "WORKFORCE_SELF_REQUEST_INVALID"],
    [403, "WORKFORCE_SCOPE_DENIED"],
    [404, "WORKFORCE_SELF_REQUEST_WORKDAY_NOT_FOUND"],
    [409, "WORKFORCE_SELF_REQUEST_WORKDAY_NOT_FOUND"],
    [409, "WORKFORCE_SELF_REQUEST_OVERLAP"],
    [409, "WORKFORCE_SELF_REQUEST_LOCAL_TIME_INVALID"],
    [409, "WORKFORCE_SELF_REQUEST_TIME_RANGE_INVALID"],
    [409, "WORKFORCE_EXCEPTION_LINKED_MUTATION_RESOLVED"],
    [409, "WORKFORCE_EXCEPTION_LINKED_MUTATION_HISTORY_INVALID"],
    [401, "session_expired"],
  ])("allows editing after an initial canonical refusal %s/%s", (status, code) => {
    const error = failure(Number(status), { code, error: "Refused" })
    expect(error.definitivelyRejected).toBe(true)
    expect(retainWorkforceSelfRequestSubmissionAfterFailure(captureWorkforceSelfRequestSubmissionAttempt(original()), error)).toBeNull()
  })

  it.each([
    [500, { code: "WORKFORCE_SELF_REQUEST_INVALID", error: "Failed" }],
    [409, { code: "WORKFORCE_SELF_REQUEST_IDEMPOTENCY_MISMATCH", error: "Different details" }],
    [409, { code: "UNKNOWN_CONFLICT", error: "Unknown" }],
    [400, { code: "__proto__", error: "Unknown" }],
    [400, {}],
    [200, { success: true }],
    [201, { success: true, idempotent: false, data: {} }],
    [200, { success: true, idempotent: false, data: { id: "request" } }],
    [201, { success: true, idempotent: true, data: { id: "request" } }],
    [400, { success: true, code: "WORKFORCE_SELF_REQUEST_INVALID", error: "Contradictory" }],
    [401, "Invalid JSON"],
  ])("keeps the original attempt when reply %s cannot establish a rejection", (status, body) => {
    const attempt = captureWorkforceSelfRequestSubmissionAttempt(original())
    const error = failure(Number(status), body)
    expect(error.definitivelyRejected).toBe(false)
    const retained = retainWorkforceSelfRequestSubmissionAfterFailure(attempt, error)
    expect(retained?.uncertain).toBe(true)
    expect(retained?.input).toBe(attempt.input)
  })

  it("retains the original body and key after transport loss and a subsequently refused retry", () => {
    const attempt = captureWorkforceSelfRequestSubmissionAttempt(original())
    const unknown = retainWorkforceSelfRequestSubmissionAfterFailure(attempt, new TypeError("Failed to fetch"))!
    for (const error of [failure(400, { code: "WORKFORCE_SELF_REQUEST_INVALID", error: "Refused" }), failure(401, { code: "session_expired", error: "Unauthorized" })]) {
      const retry = retainWorkforceSelfRequestSubmissionAfterFailure(unknown, error)
      expect(retry?.uncertain).toBe(true)
      expect(retry?.input).toBe(attempt.input)
      expect(retry?.input).toEqual(original())
    }
  })
})
