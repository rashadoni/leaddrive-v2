import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  appendAuthorizedWorkforceExceptionDecision,
  appendAuthorizedPolicyWorkforceExceptionDecision,
  persistAuthorizedWorkforceExceptionCase,
  WorkforceExceptionCaseWriterError,
} from "@/lib/workforce/exception-case-writer"
import {
  createWorkforceExceptionCaseDraft,
  createWorkforceExceptionDecisionDraft,
} from "@/lib/workforce/exception-case-ledger"

const caseDraft = createWorkforceExceptionCaseDraft({
  organizationId: "org-1",
  agentId: "agent-1",
  kind: "DELAYED_CLAIM",
  detectorVersion: "c1-delay-review-v1",
  links: { workdayId: "day-1", workdayEventId: "event-1", evidenceId: "evidence-1", segmentId: "segment-1" },
})

const decisionDraft = createWorkforceExceptionDecisionDraft({
  organizationId: "org-1",
  caseId: "case-1",
  operationId: "decision-op-1",
  decisionCode: "ACKNOWLEDGED",
  reason: "Confirmed after review.",
  actorUserId: "user-1",
})

const caseWriteData = {
  organizationId: caseDraft.organizationId,
  agentId: caseDraft.agentId,
  kind: caseDraft.kind,
  detectorVersion: caseDraft.detectorVersion,
  deduplicationKey: caseDraft.deduplicationKey,
  ...caseDraft.links,
}

const db = {
  $executeRaw: vi.fn().mockResolvedValue(undefined),
  workforceExceptionCase: { create: vi.fn(), findFirst: vi.fn() },
  workforceExceptionDecision: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  workforceExceptionCaseLookup: { findFirst: vi.fn() },
  mtmAuditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
}

const allow = vi.fn().mockResolvedValue(true)

beforeEach(() => vi.clearAllMocks())

describe("Workforce immutable exception-case writer", () => {
  it("persists one canonical raw-proof-free case and treats an exact unique-key retry as idempotent", async () => {
    db.workforceExceptionCase.create.mockResolvedValueOnce({ id: "case-1" })
    await expect(persistAuthorizedWorkforceExceptionCase({ db, draft: caseDraft, authorize: allow }))
      .resolves.toEqual({ caseId: "case-1", idempotent: false })
    expect(allow).toHaveBeenCalledWith({ operation: "CASE_CREATE", organizationId: "org-1", agentId: "agent-1" })
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(db.workforceExceptionCase.create).toHaveBeenCalledWith({ data: caseWriteData })
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_EXCEPTION_CASE_RECORDED",
        entityId: "case-1",
        newData: expect.objectContaining({ kind: "DELAYED_CLAIM" }),
      }),
    }))

    db.workforceExceptionCase.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionCase.findFirst.mockResolvedValueOnce({ id: "case-1", ...caseWriteData })
    await expect(persistAuthorizedWorkforceExceptionCase({ db, draft: caseDraft, authorize: allow }))
      .resolves.toEqual({ caseId: "case-1", idempotent: true })
    expect(db.workforceExceptionCase.create).toHaveBeenCalledTimes(1)
    expect(db.mtmAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("never turns an unauthorized case request into a lock or database write", async () => {
    await expect(persistAuthorizedWorkforceExceptionCase({
      db,
      draft: caseDraft,
      authorize: async () => false,
    })).rejects.toMatchObject<Partial<WorkforceExceptionCaseWriterError>>({
      code: "WORKFORCE_EXCEPTION_CASE_NOT_AUTHORIZED",
    })
    expect(db.$executeRaw).not.toHaveBeenCalled()
    expect(db.workforceExceptionCase.create).not.toHaveBeenCalled()
  })

  it("does not convert a unique-key collision into an idempotent success when immutable case fields differ", async () => {
    db.workforceExceptionCase.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionCase.findFirst.mockResolvedValueOnce({
      id: "case-other",
      ...caseWriteData,
      kind: "NO_SHOW",
    })
    await expect(persistAuthorizedWorkforceExceptionCase({ db, draft: caseDraft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceExceptionCaseWriterError>>({
      code: "WORKFORCE_EXCEPTION_CASE_WRITE_CONFLICT",
    })
  })

  it("normalizes a Prisma DATE value when recognizing an exact no-show retry", async () => {
    const noShow = createWorkforceExceptionCaseDraft({
      organizationId: "org-1", agentId: "agent-1", kind: "NO_SHOW", detectorVersion: "workforce-no-show-v1",
      links: { segmentId: "segment-1", expectedWorkDate: "2026-09-01" },
    })
    db.workforceExceptionCase.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionCase.findFirst.mockResolvedValueOnce({
      id: "case-no-show", organizationId: noShow.organizationId, agentId: noShow.agentId,
      kind: noShow.kind, detectorVersion: noShow.detectorVersion, deduplicationKey: noShow.deduplicationKey,
      workdayId: null, workdayEventId: null, evidenceId: null, segmentId: "segment-1",
      expectedWorkDate: new Date("2026-09-01T00:00:00.000Z"),
    })
    await expect(persistAuthorizedWorkforceExceptionCase({ db, draft: noShow, authorize: allow }))
      .resolves.toEqual({ caseId: "case-no-show", idempotent: true })
  })

  it("requires a tenant-scoped case and appends only an exact replayable decision envelope", async () => {
    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce(null)
    await expect(appendAuthorizedWorkforceExceptionDecision({ db, draft: decisionDraft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceExceptionCaseWriterError>>({
      code: "WORKFORCE_EXCEPTION_DECISION_CASE_NOT_FOUND",
    })

    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce({ id: "case-1" })
    db.workforceExceptionDecision.create.mockResolvedValueOnce({ id: "decision-1" })
    await expect(appendAuthorizedWorkforceExceptionDecision({ db, draft: decisionDraft, authorize: allow }))
      .resolves.toEqual({ decisionId: "decision-1", idempotent: false })
    expect(allow).toHaveBeenCalledWith({
      operation: "DECISION_APPEND", organizationId: "org-1", caseId: "case-1", actorUserId: "user-1",
    })
    expect(db.workforceExceptionDecision.create).toHaveBeenCalledWith({ data: decisionDraft })
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_EXCEPTION_DECISION_RECORDED",
        entityId: "decision-1",
        newData: expect.objectContaining({ decisionCode: "ACKNOWLEDGED" }),
      }),
    }))

    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce({ id: "case-1" })
    db.workforceExceptionDecision.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionDecision.findFirst.mockResolvedValueOnce({ id: "decision-1", ...decisionDraft })
    await expect(appendAuthorizedWorkforceExceptionDecision({ db, draft: decisionDraft, authorize: allow }))
      .resolves.toEqual({ decisionId: "decision-1", idempotent: true })
  })

  it("does not accept a changed decision under a replayed operation id", async () => {
    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce({ id: "case-1" })
    db.workforceExceptionDecision.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionDecision.findFirst.mockResolvedValueOnce({
      id: "decision-1",
      ...decisionDraft,
      decisionCode: "REJECTED",
    })
    await expect(appendAuthorizedWorkforceExceptionDecision({ db, draft: decisionDraft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceExceptionCaseWriterError>>({
      code: "WORKFORCE_EXCEPTION_DECISION_WRITE_CONFLICT",
    })
  })

  it("serializes lifecycle evaluation after the case lock and keeps a completed decision retry idempotent", async () => {
    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce({ id: "case-1" })
    db.workforceExceptionDecision.findFirst.mockResolvedValueOnce(null)
    db.workforceExceptionDecision.findMany.mockResolvedValueOnce([
      { decisionCode: "ACKNOWLEDGE" },
    ])
    db.workforceExceptionDecision.create.mockResolvedValueOnce({ id: "decision-resolved" })
    await expect(appendAuthorizedPolicyWorkforceExceptionDecision({
      db,
      draft: { ...decisionDraft, operationId: "decision-resolve-1", decisionCode: "RESOLVE_NO_CHANGE" },
      authorize: allow,
    })).resolves.toEqual({ decisionId: "decision-resolved", idempotent: false })
    expect(db.workforceExceptionDecision.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", caseId: "case-1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { decisionCode: true },
    })
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ newData: expect.objectContaining({ policyMode: "REVIEWED_V1" }) }),
    }))

    const replay = { id: "decision-resolved", ...decisionDraft, operationId: "decision-resolve-1", decisionCode: "RESOLVE_NO_CHANGE" }
    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce({ id: "case-1" })
    db.workforceExceptionDecision.findFirst.mockResolvedValueOnce(replay)
    await expect(appendAuthorizedPolicyWorkforceExceptionDecision({
      db,
      draft: { ...decisionDraft, operationId: "decision-resolve-1", decisionCode: "RESOLVE_NO_CHANGE" },
      authorize: allow,
    })).resolves.toEqual({ decisionId: "decision-resolved", idempotent: true })
    expect(db.workforceExceptionDecision.findMany).toHaveBeenCalledTimes(1)
  })

  it("refuses an invalid next lifecycle transition without a decision write", async () => {
    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce({ id: "case-1" })
    db.workforceExceptionDecision.findFirst.mockResolvedValueOnce(null)
    db.workforceExceptionDecision.findMany.mockResolvedValueOnce([
      { decisionCode: "RESOLVE_NO_CHANGE" },
    ])
    await expect(appendAuthorizedPolicyWorkforceExceptionDecision({
      db,
      draft: { ...decisionDraft, operationId: "decision-invalid-1", decisionCode: "ACKNOWLEDGE" },
      authorize: allow,
    })).rejects.toMatchObject({ code: "WORKFORCE_EXCEPTION_DECISION_LIFECYCLE_INVALID" })
    expect(db.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })
})
