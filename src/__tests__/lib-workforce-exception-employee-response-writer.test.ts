import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  appendAuthorizedWorkforceExceptionEmployeeResponse,
  appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse,
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

const acknowledgementDraft = createWorkforceExceptionEmployeeResponseDraft({
  organizationId: "org-1",
  caseId: "case-1",
  agentId: "agent-1",
  workdayId: "workday-1",
  segmentId: "segment-1",
  responseCode: "ACKNOWLEDGED",
  correctionRequestId: null,
  clientResponseId: "11111111-1111-4111-8111-111111111111",
  actorUserId: "user-1",
})

const db = {
  $executeRaw: vi.fn().mockResolvedValue(undefined),
  workforceExceptionDecision: { findMany: vi.fn().mockResolvedValue([]) },
  workforceExceptionEmployeeResponse: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  },
  mtmHrmRequest: { findFirst: vi.fn().mockResolvedValue({ id: "request-1" }) },
  mtmAuditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
}

const allow = vi.fn().mockResolvedValue(true)

beforeEach(() => {
  vi.clearAllMocks()
  db.workforceExceptionDecision.findMany.mockResolvedValue([])
  db.workforceExceptionEmployeeResponse.findFirst.mockResolvedValue(null)
  db.workforceExceptionEmployeeResponse.findMany.mockResolvedValue([])
})

describe("Workforce immutable employee exception response writer", () => {
  it("writes one authorized raw-proof-free response and metadata-only audit", async () => {
    db.workforceExceptionEmployeeResponse.create.mockResolvedValue({
      id: "response-1", ...draft, observedCaseRevision: 0,
    })

    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .resolves.toEqual({ responseId: "response-1", idempotent: false })

    expect(allow).toHaveBeenCalledWith({
      operation: "EMPLOYEE_RESPONSE_APPEND", organizationId: "org-1", caseId: "case-1", agentId: "agent-1", actorUserId: "user-1",
    })
    expect(db.$executeRaw).toHaveBeenCalledTimes(2)
    expect(db.workforceExceptionEmployeeResponse.create).toHaveBeenCalledWith({
      data: { ...draft, observedCaseRevision: 0 },
    })
    expect(db.mtmHrmRequest.findFirst).toHaveBeenCalledWith({
      where: {
        id: "request-1",
        organizationId: "org-1",
        agentId: "agent-1",
        type: "TIME_CORRECTION",
        correctionWorkdayId: "workday-1",
        exceptionCaseId: "case-1",
      },
      select: { id: true },
    })
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RECORDED",
        newData: {
          caseId: "case-1",
          workdayId: "workday-1",
          observedCaseRevision: 0,
          segmentLinked: true,
          correctionRequested: true,
        },
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
    db.workforceExceptionEmployeeResponse.findFirst.mockResolvedValueOnce({ id: "response-1", ...draft })

    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .resolves.toEqual({ responseId: "response-1", idempotent: true })
    expect(db.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
      "workforce-exception-decision:org-1:case-1",
      "workforce-exception-employee-response:org-1:agent-1:employee-response-001",
    ])
    expect(db.workforceExceptionEmployeeResponse.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()

    db.workforceExceptionEmployeeResponse.findFirst.mockResolvedValueOnce({
      id: "response-1", ...draft, caseId: "case-other",
    })
    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
        code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT",
      })
  })

  it("rejects a cross-case response-id collision after both global-key locks", async () => {
    db.workforceExceptionEmployeeResponse.findFirst.mockResolvedValueOnce({
      id: "response-other-case", ...draft, caseId: "case-other",
    })

    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
        code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT",
      })

    expect(db.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
      "workforce-exception-decision:org-1:case-1",
      "workforce-exception-employee-response:org-1:agent-1:employee-response-001",
    ])
    expect(db.workforceExceptionEmployeeResponse.create).not.toHaveBeenCalled()
  })

  it("does not query an aborted transaction after a residual unique violation", async () => {
    db.workforceExceptionEmployeeResponse.create.mockRejectedValueOnce({ code: "P2002" })

    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
        code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT",
      })

    expect(db.workforceExceptionEmployeeResponse.findFirst).toHaveBeenCalledTimes(1)
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("rejects a new response after resolution but preserves an exact completed replay", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValue([
      { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
      { decisionCode: "RESOLVE_NO_CHANGE", caseRevision: 2 },
    ])

    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
        code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CASE_UNAVAILABLE",
      })
    expect(db.workforceExceptionEmployeeResponse.create).not.toHaveBeenCalled()

    db.workforceExceptionEmployeeResponse.findFirst.mockResolvedValueOnce({ id: "response-1", ...draft })
    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .resolves.toEqual({ responseId: "response-1", idempotent: true })
    expect(db.workforceExceptionDecision.findMany).toHaveBeenCalledTimes(1)
  })

  it("records the exact revision observed after the case lock", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValueOnce([
      { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
      { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 2 },
    ])
    db.workforceExceptionEmployeeResponse.create.mockResolvedValueOnce({
      id: "response-2", ...draft, observedCaseRevision: 2,
    })

    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .resolves.toEqual({ responseId: "response-2", idempotent: false })
    expect(db.workforceExceptionEmployeeResponse.create).toHaveBeenCalledWith({
      data: { ...draft, observedCaseRevision: 2 },
    })
  })

  it("rejects a response when the locked decision revisions are non-contiguous", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValueOnce([
      { decisionCode: "ACKNOWLEDGE", caseRevision: 2 },
    ])

    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
        code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CASE_UNAVAILABLE",
      })
    expect(db.workforceExceptionEmployeeResponse.create).not.toHaveBeenCalled()
  })

  it("rejects a correction response whose request is unlinked or belongs to another case", async () => {
    db.mtmHrmRequest.findFirst.mockResolvedValueOnce(null)

    await expect(appendAuthorizedWorkforceExceptionEmployeeResponse({ db, draft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
        code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CASE_UNAVAILABLE",
      })
    expect(db.mtmHrmRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ exceptionCaseId: "case-1" }),
    }))
    expect(db.workforceExceptionEmployeeResponse.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("writes a revision-bound acknowledgement only at the locked expected revision", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValueOnce([
      { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
      { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 2 },
    ])
    db.workforceExceptionEmployeeResponse.create.mockResolvedValueOnce({
      id: "response-mobile-1",
      ...acknowledgementDraft,
      observedCaseRevision: 2,
    })

    await expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse({
      db,
      draft: acknowledgementDraft,
      expectedCaseRevision: 2,
      authorize: allow,
    })).resolves.toEqual({ responseId: "response-mobile-1", idempotent: false })

    expect(db.workforceExceptionEmployeeResponse.create).toHaveBeenCalledWith({
      data: { ...acknowledgementDraft, observedCaseRevision: 2 },
    })
  })

  it("rejects a stale displayed revision after locking without a response or audit write", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValueOnce([
      { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 1 },
    ])

    await expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse({
      db,
      draft: acknowledgementDraft,
      expectedCaseRevision: 0,
      authorize: allow,
    })).rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
      code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_REVISION_CONFLICT",
    })

    expect(db.workforceExceptionEmployeeResponse.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("replays only the exact stored revision even after the case is resolved", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValue([
      { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 1 },
      { decisionCode: "RESOLVE_NO_CHANGE", caseRevision: 2 },
    ])
    db.workforceExceptionEmployeeResponse.findFirst.mockResolvedValue({
      id: "response-mobile-1",
      ...acknowledgementDraft,
      observedCaseRevision: 1,
    })

    await expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse({
      db,
      draft: acknowledgementDraft,
      expectedCaseRevision: 1,
      authorize: allow,
    })).resolves.toEqual({ responseId: "response-mobile-1", idempotent: true })
    expect(db.workforceExceptionDecision.findMany).not.toHaveBeenCalled()
    expect(db.workforceExceptionEmployeeResponse.findMany).not.toHaveBeenCalled()
    expect(db.workforceExceptionEmployeeResponse.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()

    await expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse({
      db,
      draft: acknowledgementDraft,
      expectedCaseRevision: 2,
      authorize: allow,
    })).rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
      code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT",
    })
    expect(db.workforceExceptionDecision.findMany).not.toHaveBeenCalled()
  })

  it("rejects a different operation for the same locked response cycle", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValueOnce([
      { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 1 },
    ])
    db.workforceExceptionEmployeeResponse.findMany.mockResolvedValueOnce([
      { id: "response-from-other-operation" },
    ])

    await expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse({
      db,
      draft: acknowledgementDraft,
      expectedCaseRevision: 1,
      authorize: allow,
    })).rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
      code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_REVISION_CONFLICT",
    })

    expect(db.workforceExceptionEmployeeResponse.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        caseId: "case-1",
        observedCaseRevision: 1,
      },
      select: { id: true },
      take: 1,
    })
    expect(db.workforceExceptionEmployeeResponse.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("allows a new operation after the case advances to a new response cycle", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValueOnce([
      { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 1 },
      { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 2 },
    ])
    db.workforceExceptionEmployeeResponse.create.mockResolvedValueOnce({
      id: "response-new-cycle",
      ...acknowledgementDraft,
      observedCaseRevision: 2,
    })

    await expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse({
      db,
      draft: acknowledgementDraft,
      expectedCaseRevision: 2,
      authorize: allow,
    })).resolves.toEqual({ responseId: "response-new-cycle", idempotent: false })

    expect(db.workforceExceptionEmployeeResponse.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        caseId: "case-1",
        observedCaseRevision: 2,
      },
      select: { id: true },
      take: 1,
    })
    expect(db.workforceExceptionEmployeeResponse.create).toHaveBeenCalledWith({
      data: { ...acknowledgementDraft, observedCaseRevision: 2 },
    })
  })

  it("rejects an invalid revision before authorization or locking", async () => {
    await expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse({
      db,
      draft: acknowledgementDraft,
      expectedCaseRevision: -1,
      authorize: allow,
    })).rejects.toMatchObject<Partial<WorkforceExceptionEmployeeResponseWriterError>>({
      code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_REVISION_CONFLICT",
    })

    expect(allow).not.toHaveBeenCalled()
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })
})
