import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  appendAuthorizedWorkforceExceptionEmployeeResponse,
  WorkforceExceptionEmployeeResponseWriterError,
} from "@/lib/workforce/exception-employee-response-writer"
import { createWorkforceExceptionEmployeeResponseDraft } from "@/lib/workforce/exception-employee-response"

const draft = createWorkforceExceptionEmployeeResponseDraft({
  organizationId: "org-1",
  caseId: "case-1",
  agentId: "agent-1",
  workdayId: "workday-1",
  segmentId: "segment-1",
  responseCode: "CORRECTION_REQUESTED",
  correctionRequestId: "request-1",
  clientResponseId: "employee-response-001",
  actorUserId: "user-1",
})

const db = {
  $executeRaw: vi.fn().mockResolvedValue(undefined),
  workforceExceptionEmployeeResponse: { create: vi.fn(), findFirst: vi.fn() },
  mtmAuditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
}

const allow = vi.fn().mockResolvedValue(true)

beforeEach(() => vi.clearAllMocks())

describe("Workforce immutable employee exception response writer", () => {
  it("writes one authorized raw-proof-free response and metadata-only audit", async () => {
    db.workforceExceptionEmployeeResponse.create.mockResolvedValue({ id: "response-1", ...draft })

    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .resolves.toEqual({ responseId: "response-1", idempotent: false })

    expect(allow).toHaveBeenCalledWith({
      operation: "EMPLOYEE_RESPONSE_APPEND", organizationId: "org-1", caseId: "case-1", agentId: "agent-1", actorUserId: "user-1",
    })
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(db.workforceExceptionEmployeeResponse.create).toHaveBeenCalledWith({ data: draft })
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RECORDED",
        newData: { caseId: "case-1", workdayId: "workday-1", segmentLinked: true, correctionRequested: true },
      }),
    }))
    expect(JSON.stringify(db.mtmAuditLog.create.mock.calls)).not.toMatch(/reason|latitude|longitude|qr|device/i)
  })

  it("authorizes before the lock or database write", async () => {
    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({
      db,
      draft,
      authorize: async () => false,
    })).rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
      code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_NOT_AUTHORIZED",
    })

    expect(db.$executeRaw).not.toHaveBeenCalled()
    expect(db.workforceExceptionEmployeeResponse.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("treats an exact unique-key replay as idempotent but rejects changed content", async () => {
    db.workforceExceptionEmployeeResponse.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionEmployeeResponse.findFirst.mockResolvedValueOnce({ id: "response-1", ...draft })

    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .resolves.toEqual({ responseId: "response-1", idempotent: true })
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()

    db.workforceExceptionEmployeeResponse.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionEmployeeResponse.findFirst.mockResolvedValueOnce({
      id: "response-1", ...draft, caseId: "case-other",
    })
    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
        code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT",
      })
  })
})
