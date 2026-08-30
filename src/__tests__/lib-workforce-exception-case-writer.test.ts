import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  appendWorkforceExceptionDecision,
  persistWorkforceExceptionCase,
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
  workforceExceptionCase: { create: vi.fn(), findFirst: vi.fn() },
  workforceExceptionDecision: { create: vi.fn(), findFirst: vi.fn() },
  workforceExceptionCaseLookup: { findFirst: vi.fn() },
}

beforeEach(() => vi.clearAllMocks())

describe("Workforce immutable exception-case writer", () => {
  it("persists one canonical raw-proof-free case and treats an exact unique-key retry as idempotent", async () => {
    db.workforceExceptionCase.create.mockResolvedValueOnce({ id: "case-1" })
    await expect(persistWorkforceExceptionCase(db, caseDraft)).resolves.toEqual({ caseId: "case-1", idempotent: false })
    expect(db.workforceExceptionCase.create).toHaveBeenCalledWith({ data: caseWriteData })

    db.workforceExceptionCase.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionCase.findFirst.mockResolvedValueOnce({ id: "case-1", ...caseWriteData })
    await expect(persistWorkforceExceptionCase(db, caseDraft)).resolves.toEqual({ caseId: "case-1", idempotent: true })
  })

  it("does not convert a unique-key collision into an idempotent success when immutable case fields differ", async () => {
    db.workforceExceptionCase.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionCase.findFirst.mockResolvedValueOnce({
      id: "case-other",
      ...caseWriteData,
      kind: "NO_SHOW",
    })
    await expect(persistWorkforceExceptionCase(db, caseDraft)).rejects.toMatchObject<Partial<WorkforceExceptionCaseWriterError>>({
      code: "WORKFORCE_EXCEPTION_CASE_WRITE_CONFLICT",
    })
  })

  it("requires a tenant-scoped case and appends only an exact replayable decision envelope", async () => {
    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce(null)
    await expect(appendWorkforceExceptionDecision(db, decisionDraft)).rejects.toMatchObject<Partial<WorkforceExceptionCaseWriterError>>({
      code: "WORKFORCE_EXCEPTION_DECISION_CASE_NOT_FOUND",
    })

    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce({ id: "case-1" })
    db.workforceExceptionDecision.create.mockResolvedValueOnce({ id: "decision-1" })
    await expect(appendWorkforceExceptionDecision(db, decisionDraft)).resolves.toEqual({ decisionId: "decision-1", idempotent: false })
    expect(db.workforceExceptionDecision.create).toHaveBeenCalledWith({ data: decisionDraft })

    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce({ id: "case-1" })
    db.workforceExceptionDecision.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionDecision.findFirst.mockResolvedValueOnce({ id: "decision-1", ...decisionDraft })
    await expect(appendWorkforceExceptionDecision(db, decisionDraft)).resolves.toEqual({ decisionId: "decision-1", idempotent: true })
  })

  it("does not accept a changed decision under a replayed operation id", async () => {
    db.workforceExceptionCaseLookup.findFirst.mockResolvedValueOnce({ id: "case-1" })
    db.workforceExceptionDecision.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceExceptionDecision.findFirst.mockResolvedValueOnce({
      id: "decision-1",
      ...decisionDraft,
      decisionCode: "REJECTED",
    })
    await expect(appendWorkforceExceptionDecision(db, decisionDraft)).rejects.toMatchObject<Partial<WorkforceExceptionCaseWriterError>>({
      code: "WORKFORCE_EXCEPTION_DECISION_WRITE_CONFLICT",
    })
  })
})
