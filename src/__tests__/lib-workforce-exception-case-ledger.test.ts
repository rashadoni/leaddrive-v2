import { describe, expect, it } from "vitest"
import {
  WorkforceExceptionCaseLedgerError,
  createWorkforceExceptionCaseDraft,
  createDraftPolicyWorkforceExceptionDecisionDraft,
  createWorkforceExceptionDecisionDraft,
  workforceExceptionCaseDeduplicationKey,
} from "@/lib/workforce/exception-case-ledger"

const CASE = {
  organizationId: "org-1",
  agentId: "agent-1",
  kind: "DELAYED_CLAIM",
  detectorVersion: "c1-delay-review-v1",
  links: {
    workdayId: "day-1",
    workdayEventId: "event-1",
    evidenceId: "evidence-1",
    segmentId: "segment-1",
  },
}

describe("Workforce exception case ledger drafts", () => {
  it("has one stable, raw-proof-free key for the same detector subject", () => {
    const original = createWorkforceExceptionCaseDraft(CASE)
    const retry = workforceExceptionCaseDeduplicationKey({
      ...CASE,
      links: { segmentId: "segment-1", evidenceId: "evidence-1", workdayEventId: "event-1", workdayId: "day-1" },
    })

    expect(original).toMatchObject({
      kind: "DELAYED_CLAIM",
      deduplicationKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      links: CASE.links,
    })
    expect(retry).toBe(original.deduplicationKey)
    expect(JSON.stringify(original)).not.toMatch(/latitude|longitude|qr|device|reason/i)
  })

  it("changes the deduplication subject for a new linked event but not a retry", () => {
    const first = workforceExceptionCaseDeduplicationKey(CASE)
    const changed = workforceExceptionCaseDeduplicationKey({
      ...CASE,
      links: { ...CASE.links, workdayEventId: "event-2" },
    })
    expect(changed).not.toBe(first)
  })

  it("uses an exact expected work date only for a segment-only scheduled subject", () => {
    const firstDay = createWorkforceExceptionCaseDraft({
      organizationId: "org-1",
      agentId: "agent-1",
      kind: "NO_SHOW",
      detectorVersion: "workforce-no-show-v1",
      links: { segmentId: "segment-1", expectedWorkDate: "2026-08-31" },
    })
    const nextDay = createWorkforceExceptionCaseDraft({
      organizationId: "org-1",
      agentId: "agent-1",
      kind: "NO_SHOW",
      detectorVersion: "workforce-no-show-v1",
      links: { segmentId: "segment-1", expectedWorkDate: "2026-09-01" },
    })
    expect(nextDay.deduplicationKey).not.toBe(firstDay.deduplicationKey)
    expect(() => createWorkforceExceptionCaseDraft({
      organizationId: "org-1", agentId: "agent-1", kind: "NO_SHOW", detectorVersion: "workforce-no-show-v1",
      links: { segmentId: "segment-1" },
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID" }))
    expect(() => createWorkforceExceptionCaseDraft({
      organizationId: "org-1", agentId: "agent-1", kind: "DELAYED_CLAIM", detectorVersion: "delay-v1",
      links: { segmentId: "segment-1", expectedWorkDate: "2026-08-31" },
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID" }))
    expect(() => createWorkforceExceptionCaseDraft({
      ...CASE,
      links: { workdayId: "day-1", segmentId: "segment-1", expectedWorkDate: "2026-08-31" },
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID" }))
    expect(() => createWorkforceExceptionCaseDraft({
      ...CASE,
      links: { expectedWorkDate: "2026-08-31" },
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID" }))
    expect(() => createWorkforceExceptionCaseDraft({
      ...CASE,
      links: { segmentId: "segment-1", evidenceId: "evidence-1", expectedWorkDate: "2026-08-31" },
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID" }))
  })

  it("rejects an unscoped evidence-only case and invalid policy codes", () => {
    expect(() => createWorkforceExceptionCaseDraft({
      ...CASE,
      links: { evidenceId: "evidence-1" },
    })).toThrow(expect.objectContaining({
      code: "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID",
    } satisfies Partial<WorkforceExceptionCaseLedgerError>))
    expect(() => createWorkforceExceptionCaseDraft({ ...CASE, kind: "late start" }))
      .toThrow(expect.objectContaining({ code: "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID" }))
  })

  it("requires an accountable, bounded append-only decision envelope", () => {
    expect(createWorkforceExceptionDecisionDraft({
      organizationId: "org-1",
      caseId: "case-1",
      operationId: "decision-op-1",
      decisionCode: "ACKNOWLEDGED",
      reason: "  Confirmed after review.  ",
      actorUserId: "user-1",
    })).toEqual({
      organizationId: "org-1",
      caseId: "case-1",
      operationId: "decision-op-1",
      decisionCode: "ACKNOWLEDGED",
      reason: "Confirmed after review.",
      actorUserId: "user-1",
    })
    expect(() => createWorkforceExceptionDecisionDraft({
      organizationId: "org-1", caseId: "case-1", operationId: "decision-op-1",
      decisionCode: "ACKNOWLEDGED", reason: " ", actorUserId: "user-1",
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_EXCEPTION_DECISION_INPUT_INVALID" }))
  })

  it("offers a policy-aware draft path without changing the generic legacy-compatible envelope", () => {
    expect(createDraftPolicyWorkforceExceptionDecisionDraft({
      organizationId: "org-1",
      caseId: "case-1",
      operationId: "decision-op-policy-1",
      decisionCode: "RESOLVE_NO_CHANGE",
      reason: "No correction is required after review.",
      actorUserId: "user-1",
      priorDecisionCodes: ["ACKNOWLEDGE"],
    })).toMatchObject({ decisionCode: "RESOLVE_NO_CHANGE", caseId: "case-1" })
    expect(() => createDraftPolicyWorkforceExceptionDecisionDraft({
      organizationId: "org-1",
      caseId: "case-1",
      operationId: "decision-op-policy-2",
      decisionCode: "RESOLVE_NO_CHANGE",
      reason: "A decision cannot be automatic.",
      actorUserId: "user-1",
      priorDecisionCodes: [],
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_EXCEPTION_DECISION_LIFECYCLE_INVALID" }))
  })
})
