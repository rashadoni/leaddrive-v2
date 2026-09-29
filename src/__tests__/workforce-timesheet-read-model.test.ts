import { describe, expect, it } from "vitest"
import { buildWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-approval"
import type { WorkforceTimesheetCalculation } from "@/lib/workforce/timesheet-calculation"
import {
  buildWorkforceTimesheetReadModel,
  projectWorkforceTimesheetEvidenceReview,
  projectWorkforceTimesheetExceptions,
  summarizeWorkforceTimesheetApprovalRevisions,
  WORKFORCE_TIMESHEET_READ_MODEL_LIMITS,
  WorkforceTimesheetReadModelError,
  type WorkforceTimesheetApprovalRevisionReadInput,
} from "@/lib/workforce/timesheet-read-model"

const calculationV1: WorkforceTimesheetCalculation = {
  calculationVersion: 1,
  policySnapshotId: "policy-private",
  shiftSnapshotId: "shift-private",
  status: "COMPLETED",
  isFinal: true,
  plan: {
    plannedStartAt: "2026-09-29T09:00:00.000Z",
    plannedEndAt: "2026-09-29T18:00:00.000Z",
    expectedWorkSeconds: 28_800,
    workDate: "2026-09-29",
    timezone: "UTC",
  },
  fact: {
    workdayId: "workday-private",
    startedAt: "2026-09-29T09:00:00.000Z",
    completedAt: "2026-09-29T18:00:00.000Z",
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

const calculationV2: WorkforceTimesheetCalculation = {
  ...calculationV1,
  calculationVersion: 2,
  coreCalculationVersion: 1,
  fact: { ...calculationV1.fact, workedSeconds: 28_200 },
  immutableSchedule: {
    scheduleSnapshotId: "schedule-private",
    scheduleSnapshotHash: "a".repeat(64),
    policyDefinitionHash: "b".repeat(64),
    shiftDefinitionHash: "c".repeat(64),
    calendarState: "SCHEDULED",
    segmentCount: 1,
    segmentModes: ["SITE"],
    plannedBreakCount: 1,
    breakTreatment: "ACTUAL_PAUSE_EVENTS_ONLY",
    travelTreatment: "NON_PAYROLL_NO_AUTOMATIC_ADJUSTMENT",
    calendarTreatment: "PINNED_EXPECTED_WORKDAY",
    exceptionTreatment: "RESOLUTION_REQUIRED_BEFORE_APPROVAL",
    correctionTreatment: "IMMUTABLE_LEDGER_REPLAY",
  },
}

function approvalRevision(input: {
  id: string
  recordKind: "APPROVAL" | "CORRECTION"
  revision: number
  supersedesId: string | null
  calculation: WorkforceTimesheetCalculation
}): WorkforceTimesheetApprovalRevisionReadInput {
  const rows = [{
    workdayId: "workday-private",
    agentId: "agent-private",
    workDate: "2026-09-29",
    calculationVersion: input.calculation.calculationVersion,
    calculation: input.calculation,
  }]
  const payload = buildWorkforceTimesheetApproval({
    periodStart: "2026-09-29",
    periodEnd: "2026-09-29",
    agentId: "agent-private",
    rows,
  })
  return {
    id: input.id,
    agentId: "agent-private",
    periodStart: new Date("2026-09-29T00:00:00.000Z"),
    periodEnd: new Date("2026-09-29T00:00:00.000Z"),
    recordKind: input.recordKind,
    revision: input.revision,
    supersedesId: input.supersedesId,
    calculationVersion: input.calculation.calculationVersion,
    rowsHash: payload.rowsHash,
    factsHash: payload.factsHash,
    rows,
  }
}

describe("Workforce timesheet read model", () => {
  it("projects finite event and transition review states with fail-closed precedence", () => {
    expect(projectWorkforceTimesheetEvidenceReview({ events: [], transitions: [] })).toEqual({
      state: "NOT_RECORDED",
      events: "NOT_RECORDED",
      transitions: "NOT_RECORDED",
    })
    expect(projectWorkforceTimesheetEvidenceReview({
      events: [{ attendanceReviewState: "NOT_REQUIRED" }],
      transitions: [{ attendanceReviewState: "LEGACY_UNKNOWN" }],
    })).toEqual({
      state: "LEGACY_UNKNOWN",
      events: "NOT_REQUIRED",
      transitions: "LEGACY_UNKNOWN",
    })
    expect(projectWorkforceTimesheetEvidenceReview({
      events: [
        { attendanceReviewState: "LEGACY_UNKNOWN" },
        { attendanceReviewState: "PENDING_REVIEW" },
      ],
      transitions: [{ attendanceReviewState: "NOT_REQUIRED" }],
    }).state).toBe("PENDING_REVIEW")
  })

  it("returns only deduplicated allowlisted exception type/status pairs", () => {
    expect(projectWorkforceTimesheetExceptions([
      { type: "OVERTIME", status: "OPEN" },
      { type: "LATE_START", status: "ACKNOWLEDGED" },
      { type: "OVERTIME", status: "OPEN" },
    ])).toEqual([
      { type: "LATE_START", status: "ACKNOWLEDGED" },
      { type: "OVERTIME", status: "OPEN" },
    ])
  })

  it("derives C6 stages only from a complete contiguous decision stream", () => {
    expect(projectWorkforceTimesheetExceptions([], [
      {
        kind: "NO_SHOW",
        decisions: [
          { caseRevision: 1, decisionCode: "ACKNOWLEDGE" },
          { caseRevision: 2, decisionCode: "RESOLVE_NO_CHANGE" },
        ],
        decisionHistoryTruncated: false,
      },
      {
        kind: "MISSED_FINISH",
        decisions: [{ caseRevision: 1, decisionCode: "REQUEST_EMPLOYEE_RESPONSE" }],
        decisionHistoryTruncated: false,
      },
    ])).toEqual([
      { type: "NO_SHOW", status: "RESOLVED" },
      { type: "MISSED_FINISH", status: "AWAITING_EMPLOYEE_RESPONSE" },
    ])

    for (const corrupt of [
      {
        kind: "NO_SHOW",
        decisions: [
          { caseRevision: 1, decisionCode: "ACKNOWLEDGE" },
          { caseRevision: 2, decisionCode: "RESOLVE_NO_CHANGE" },
        ],
        decisionHistoryTruncated: true,
      },
      {
        kind: "NO_SHOW",
        decisions: [
          { caseRevision: 1, decisionCode: "ACKNOWLEDGE" },
          { caseRevision: 3, decisionCode: "RESOLVE_NO_CHANGE" },
        ],
        decisionHistoryTruncated: false,
      },
      {
        kind: "NO_SHOW",
        decisions: [{ caseRevision: 1, decisionCode: "UNKNOWN_DECISION" }],
        decisionHistoryTruncated: false,
      },
    ]) {
      expect(projectWorkforceTimesheetExceptions([], [corrupt])).toEqual([
        { type: "NO_SHOW", status: "DATA_INTEGRITY_REVIEW" },
      ])
    }

    expect(projectWorkforceTimesheetExceptions([], [{
      kind: "NO_SHOW",
      decisions: Array.from(
        { length: WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.decisionsPerCase + 1 },
        (_, index) => ({ caseRevision: index + 1, decisionCode: "ACKNOWLEDGE" }),
      ),
      decisionHistoryTruncated: false,
    }])).toEqual([{ type: "NO_SHOW", status: "DATA_INTEGRITY_REVIEW" }])
  })

  it("hash-verifies and summarizes one contiguous legacy-v1 to v2 correction chain", () => {
    const first = approvalRevision({
      id: "approval-private-v1",
      recordKind: "APPROVAL",
      revision: 1,
      supersedesId: null,
      calculation: calculationV1,
    })
    const second = approvalRevision({
      id: "approval-private-v2",
      recordKind: "CORRECTION",
      revision: 2,
      supersedesId: first.id,
      calculation: calculationV2,
    })

    expect(summarizeWorkforceTimesheetApprovalRevisions([second, first])).toEqual({
      state: "CORRECTED",
      verification: "HASH_AND_CHAIN_VERIFIED",
      revisionCount: 2,
      currentRevision: 2,
      currentCalculationVersion: 2,
      revisions: [
        { revision: 1, recordKind: "APPROVAL", calculationVersion: 1 },
        { revision: 2, recordKind: "CORRECTION", calculationVersion: 2 },
      ],
    })
    expect(summarizeWorkforceTimesheetApprovalRevisions([])).toEqual({
      state: "NOT_APPROVED",
      verification: "NO_APPROVAL",
      revisionCount: 0,
      currentRevision: null,
      currentCalculationVersion: null,
      revisions: [],
    })
  })

  it("never returns private identifiers, hashes, rows, reasons, proof, location or actors", () => {
    const approval = {
      ...approvalRevision({
        id: "approval-secret",
        recordKind: "APPROVAL",
        revision: 1,
        supersedesId: null,
        calculation: calculationV1,
      }),
      approvedByUserId: "actor-secret",
      correctionReason: "reason-secret",
    }
    const result = buildWorkforceTimesheetReadModel({
      events: [{ attendanceReviewState: "NOT_REQUIRED", latitude: 1, proof: "proof-secret" }],
      transitions: [{ attendanceReviewState: "PENDING_REVIEW", longitude: 2 }],
      exceptions: [{ type: "LONG_PAUSE", status: "OPEN", reason: "case-reason-secret" }],
      exceptionCases: [{
        kind: "NO_SHOW",
        decisions: [{ caseRevision: 1, decisionCode: "ACKNOWLEDGE", actorUserId: "case-actor-secret" }],
        decisionHistoryTruncated: false,
        caseId: "case-secret",
        reason: "case-decision-reason-secret",
      }],
      approvals: [approval],
    })
    const serialized = JSON.stringify(result)

    expect(result).toMatchObject({
      source: "BOUNDED_VERIFIED_TIMESHEET_FACTS",
      evidenceReview: { state: "PENDING_REVIEW" },
      approval: { state: "APPROVED", verification: "HASH_AND_CHAIN_VERIFIED" },
      boundaries: {
        identifiers: "EXCLUDED_FROM_READ_MODEL",
        reasons: "EXCLUDED_FROM_READ_MODEL",
        rawEvidence: "EXCLUDED_FROM_READ_MODEL",
        location: "EXCLUDED_FROM_READ_MODEL",
        actors: "EXCLUDED_FROM_READ_MODEL",
      },
    })
    for (const secret of [
      "approval-secret",
      "agent-private",
      "workday-private",
      "policy-private",
      "shift-private",
      "schedule-private",
      "actor-secret",
      "reason-secret",
      "case-reason-secret",
      "case-actor-secret",
      "case-secret",
      "case-decision-reason-secret",
      "proof-secret",
      approval.rowsHash,
      approval.factsHash,
    ]) expect(serialized).not.toContain(secret)
  })

  it("fails closed on unknown or unbounded evidence and exception input", () => {
    expect(() => projectWorkforceTimesheetEvidenceReview({
      events: [{ attendanceReviewState: "APPROVED" }],
      transitions: [],
    })).toThrow(WorkforceTimesheetReadModelError)
    expect(() => projectWorkforceTimesheetEvidenceReview({
      events: Array.from(
        { length: WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.events + 1 },
        () => ({ attendanceReviewState: "NOT_REQUIRED" }),
      ),
      transitions: [],
    })).toThrow(WorkforceTimesheetReadModelError)
    expect(() => projectWorkforceTimesheetExceptions([
      { type: "PRIVATE_MANAGER_NOTE", status: "OPEN" },
    ])).toThrow(WorkforceTimesheetReadModelError)
    expect(() => projectWorkforceTimesheetExceptions([
      { type: "NO_SHOW", status: "AUTO_PENALIZED" },
    ])).toThrow(WorkforceTimesheetReadModelError)
  })

  it("fails closed on unverifiable, mixed-scope, branched or downgraded approval history", () => {
    const first = approvalRevision({
      id: "approval-1",
      recordKind: "APPROVAL",
      revision: 1,
      supersedesId: null,
      calculation: calculationV1,
    })
    const second = approvalRevision({
      id: "approval-2",
      recordKind: "CORRECTION",
      revision: 2,
      supersedesId: first.id,
      calculation: calculationV2,
    })
    const v1Correction = approvalRevision({
      id: "approval-3",
      recordKind: "CORRECTION",
      revision: 3,
      supersedesId: second.id,
      calculation: { ...calculationV1, fact: { ...calculationV1.fact, workedSeconds: 27_000 } },
    })

    const invalidHistories: WorkforceTimesheetApprovalRevisionReadInput[][] = [
      [{ ...first, rowsHash: "0".repeat(64) }],
      [first, { ...second, supersedesId: "another-approval" }],
      [first, { ...second, agentId: "another-agent" }],
      [first, second, v1Correction],
      [first, { ...second, revision: 3 }],
    ]
    for (const history of invalidHistories) {
      expect(() => summarizeWorkforceTimesheetApprovalRevisions(history))
        .toThrow(WorkforceTimesheetReadModelError)
    }
  })
})
