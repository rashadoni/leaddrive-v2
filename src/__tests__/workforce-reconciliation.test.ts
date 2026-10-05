import { describe, expect, it } from "vitest"
import { buildWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-approval"
import type { WorkforceTimesheetCalculation } from "@/lib/workforce/timesheet-calculation"
import {
  reconcileWorkforceSnapshot,
  type WorkforceReconciliationSnapshot,
} from "@/lib/workforce/reconciliation"

const calculation: WorkforceTimesheetCalculation = {
  calculationVersion: 1,
  policySnapshotId: "policy-snapshot",
  shiftSnapshotId: "shift-snapshot",
  status: "COMPLETED",
  isFinal: true,
  plan: {
    plannedStartAt: "2026-09-12T05:00:00.000Z",
    plannedEndAt: "2026-09-12T14:00:00.000Z",
    expectedWorkSeconds: 28_800,
    workDate: "2026-09-12",
    timezone: "Asia/Baku",
  },
  fact: {
    workdayId: "workday-1",
    startedAt: "2026-09-12T05:00:00.000Z",
    completedAt: "2026-09-12T14:00:00.000Z",
    workedSeconds: 28_800,
    pausedSeconds: 3_600,
    longestPauseSeconds: 3_600,
  },
  deviations: {
    lateStartSeconds: 0,
    undertimeSeconds: 0,
    overtimeSeconds: 0,
    longPauseSeconds: 0,
  },
  exceptions: [],
}

function coherentSnapshot(): WorkforceReconciliationSnapshot {
  const payload = buildWorkforceTimesheetApproval({
    periodStart: "2026-09-12",
    periodEnd: "2026-09-12",
    agentId: "agent-1",
    rows: [{
      workdayId: "workday-1",
      agentId: "agent-1",
      workDate: "2026-09-12",
      calculationVersion: 1,
      calculation,
    }],
  })
  return {
    workdays: [{ id: "workday-1", organizationId: "org-1", agentId: "agent-1" }],
    events: [{ id: "event-1", organizationId: "org-1", agentId: "agent-1", workdayId: "workday-1" }],
    transitions: [{ id: "transition-1", organizationId: "org-1", agentId: "agent-1", workdayId: "workday-1" }],
    evidence: [
      { id: "evidence-event", organizationId: "org-1", workdayEventId: "event-1", siteTransitionId: null },
      { id: "evidence-transition", organizationId: "org-1", workdayEventId: null, siteTransitionId: "transition-1" },
    ],
    assessments: [{ id: "assessment-1", organizationId: "org-1", evidenceId: "evidence-event" }],
    exceptions: [{
      id: "exception-1",
      organizationId: "org-1",
      agentId: "agent-1",
      workdayId: "workday-1",
      workdayEventId: "event-1",
      evidenceId: "evidence-event",
      segmentId: null,
      expectedWorkDate: null,
    }],
    approvals: [{
      id: "approval-1",
      organizationId: "org-1",
      agentId: "agent-1",
      periodStart: new Date("2026-09-12T00:00:00.000Z"),
      periodEnd: new Date("2026-09-12T00:00:00.000Z"),
      recordKind: "APPROVAL",
      revision: 1,
      supersedesId: null,
      calculationVersion: payload.calculationVersion,
      rowsHash: payload.rowsHash,
      factsHash: payload.factsHash,
      rows: payload.rows,
      approvedAt: new Date("2026-09-13T00:00:00.000Z"),
    }],
    exports: [{
      approvalId: "approval-1",
      organizationId: "org-1",
      agentId: "agent-1",
      approvalRowsHash: payload.rowsHash,
      approvalFactsHash: payload.factsHash,
    }],
  }
}

describe("Workforce reconciliation", () => {
  it("accepts a coherent claim-to-export chain without returning identifiers", () => {
    const result = reconcileWorkforceSnapshot(coherentSnapshot())
    expect(result).toEqual({
      status: "MATCHED",
      examined: {
        workdays: 1, events: 1, transitions: 1, evidence: 2,
        assessments: 1, exceptions: 1, approvals: 1, exports: 1,
      },
      mismatchCounts: {},
      mismatchTotal: 0,
      repair: "NONE",
    })
    expect(JSON.stringify(result)).not.toMatch(/org-1|agent-1|workday-1|event-1/)
  })

  it("reports bounded mismatch codes without repairing or echoing corrupt rows", () => {
    const source = coherentSnapshot()
    const result = reconcileWorkforceSnapshot({
      ...source,
      events: [{ ...source.events[0], organizationId: "org-2" }],
      evidence: [{ id: "bad-proof", organizationId: "org-1", workdayEventId: null, siteTransitionId: null }],
      assessments: [{ id: "bad-assessment", organizationId: "org-1", evidenceId: "missing" }],
      exceptions: [{ id: "bad-case", organizationId: "org-1", agentId: "agent-private", workdayId: null, workdayEventId: null, evidenceId: null, segmentId: null, expectedWorkDate: null }],
      approvals: [{ ...source.approvals[0], revision: 2, rowsHash: "0".repeat(64) }],
      exports: [{ ...source.exports[0], approvalFactsHash: "1".repeat(64) }],
    })
    expect(result).toMatchObject({
      status: "MISMATCH",
      mismatchCounts: {
        WORKDAY_EVENT_SCOPE_MISMATCH: 1,
        EVIDENCE_SUBJECT_INVALID: 1,
        ASSESSMENT_EVIDENCE_MISMATCH: 1,
        EXCEPTION_SUBJECT_INVALID: 1,
        APPROVAL_REVISION_INVALID: 1,
        APPROVAL_HASH_INVALID: 1,
        EXPORT_APPROVAL_MISMATCH: 1,
      },
      mismatchTotal: 7,
      repair: "NONE",
    })
    expect(JSON.stringify(result)).not.toContain("agent-private")
  })

  it.each([
    { workdayId: "missing-workday", organizationId: "org-1", agentId: "agent-1" },
    { workdayId: "workday-1", organizationId: "org-other", agentId: "agent-1" },
    { workdayId: "workday-1", organizationId: "org-1", agentId: "agent-other" },
  ])("rejects a transition with an absent or different parent scope: %o", (invalid) => {
    const source = coherentSnapshot()
    const result = reconcileWorkforceSnapshot({ ...source, transitions: [{ id: "transition-1", ...invalid }] })
    expect(result).toMatchObject({ status: "MISMATCH", repair: "NONE", mismatchCounts: { WORKDAY_TRANSITION_SCOPE_MISMATCH: 1 } })
    expect(JSON.stringify(result)).not.toMatch(/missing-workday|org-other|agent-other|transition-1/)
  })

  it.each(["evidence-event", "evidence-transition"])("binds exception employee through %s without adding an evidence employee field", (evidenceId) => {
    const source = coherentSnapshot()
    const subject = { ...source.exceptions[0], workdayId: null, workdayEventId: null, evidenceId }
    expect(reconcileWorkforceSnapshot({ ...source, exceptions: [subject] }).status).toBe("MATCHED")
    const result = reconcileWorkforceSnapshot({ ...source, exceptions: [{ ...subject, agentId: "agent-other" }] })
    expect(result).toMatchObject({ status: "MISMATCH", mismatchTotal: 1, repair: "NONE", mismatchCounts: { EXCEPTION_SUBJECT_SCOPE_MISMATCH: 1 } })
    expect(JSON.stringify(result)).not.toMatch(/agent-other|evidence-event|evidence-transition/)
  })

  it.each([
    { workdayEventId: null, siteTransitionId: null },
    { workdayEventId: "event-1", siteTransitionId: "transition-1" },
    { workdayEventId: "missing-event", siteTransitionId: null },
    { workdayEventId: null, siteTransitionId: "missing-transition" },
  ])("rejects an exception whose evidence subject cannot be resolved uniquely: %o", (subject) => {
    const source = coherentSnapshot()
    const result = reconcileWorkforceSnapshot({
      ...source,
      evidence: [{ id: "evidence-event", organizationId: "org-1", ...subject }],
      exceptions: [{ ...source.exceptions[0], workdayId: null, workdayEventId: null }],
    })
    expect(result.status).toBe("MISMATCH")
    expect(result.mismatchCounts.EXCEPTION_SUBJECT_SCOPE_MISMATCH).toBe(1)
    expect(result.repair).toBe("NONE")
  })

  it.each([
    { segmentId: null, expectedWorkDate: "2028-02-29" },
    { segmentId: "segment-private", expectedWorkDate: null },
    { segmentId: "", expectedWorkDate: "2028-02-29" },
    { segmentId: "  \t", expectedWorkDate: "2028-02-29" },
    { segmentId: "segment-private", expectedWorkDate: "2026-02-29" },
    { segmentId: "segment-private", expectedWorkDate: "2026-04-31" },
    { segmentId: "segment-private", expectedWorkDate: "2028-2-29" },
    { segmentId: "segment-private", expectedWorkDate: "2028-02-29T00:00:00Z" },
    { segmentId: "segment-private", expectedWorkDate: " 2028-02-29" },
  ])("rejects an incomplete or noncanonical schedule-only subject: %o", (subject) => {
    const source = coherentSnapshot()
    const result = reconcileWorkforceSnapshot({
      ...source,
      exceptions: [{ ...source.exceptions[0], workdayId: null, workdayEventId: null, evidenceId: null, ...subject }],
    })
    expect(result).toMatchObject({ status: "MISMATCH", mismatchCounts: { EXCEPTION_SUBJECT_INVALID: 1 }, mismatchTotal: 1, repair: "NONE" })
    expect(JSON.stringify(result)).not.toContain("segment-private")
  })

  it("accepts a canonical leap-day schedule-only subject without inventing workday or START facts", () => {
    const source = coherentSnapshot()
    const result = reconcileWorkforceSnapshot({
      workdays: [], events: [], transitions: [], evidence: [], assessments: [], approvals: [], exports: [],
      exceptions: [{ ...source.exceptions[0], workdayId: null, workdayEventId: null, evidenceId: null, segmentId: "segment-private", expectedWorkDate: "2028-02-29" }],
    })
    expect(result).toMatchObject({ status: "MATCHED", mismatchTotal: 0, repair: "NONE", examined: { workdays: 0, events: 0, transitions: 0, exceptions: 1 } })
    expect(JSON.stringify(result)).not.toMatch(/segment-private|2028-02-29|agent-1/)
  })

  it("leaves the complete frozen input unchanged when reconciling", () => {
    const source = coherentSnapshot()
    const original = JSON.stringify(source)
    function freeze(value: unknown): void {
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) freeze(child)
        Object.freeze(value)
      }
    }
    freeze(source)
    expect(reconcileWorkforceSnapshot(source).status).toBe("MATCHED")
    expect(JSON.stringify(source)).toBe(original)
  })

  it("fails closed before processing an unbounded kind", () => {
    const source = coherentSnapshot()
    expect(() => reconcileWorkforceSnapshot({
      ...source,
      events: Array.from({ length: 1_001 }, (_, index) => ({
        id: `event-${index}`,
        organizationId: "org-1",
        agentId: "agent-1",
        workdayId: "workday-1",
      })),
    })).toThrow("WORKFORCE_RECONCILIATION_BATCH_INVALID:events")
  })
})
