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
