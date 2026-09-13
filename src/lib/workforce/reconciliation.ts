import { exportStoredWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-export"

const MAX_ROWS_PER_KIND = 1_000

export type WorkforceReconciliationCode =
  | "WORKDAY_EVENT_SCOPE_MISMATCH"
  | "EVIDENCE_SUBJECT_INVALID"
  | "EVIDENCE_SUBJECT_SCOPE_MISMATCH"
  | "ASSESSMENT_EVIDENCE_MISMATCH"
  | "EXCEPTION_SUBJECT_INVALID"
  | "EXCEPTION_SUBJECT_SCOPE_MISMATCH"
  | "APPROVAL_REVISION_INVALID"
  | "APPROVAL_HASH_INVALID"
  | "EXPORT_APPROVAL_MISMATCH"

type ScopedAgentRow = { id: string; organizationId: string; agentId: string }

export type WorkforceReconciliationSnapshot = {
  workdays: readonly ScopedAgentRow[]
  events: readonly (ScopedAgentRow & { workdayId: string })[]
  transitions: readonly (ScopedAgentRow & { workdayId: string })[]
  evidence: readonly {
    id: string
    organizationId: string
    workdayEventId: string | null
    siteTransitionId: string | null
  }[]
  assessments: readonly { id: string; organizationId: string; evidenceId: string }[]
  exceptions: readonly {
    id: string
    organizationId: string
    agentId: string
    workdayId: string | null
    workdayEventId: string | null
    evidenceId: string | null
    segmentId: string | null
    expectedWorkDate: string | null
  }[]
  approvals: readonly {
    id: string
    organizationId: string
    agentId: string
    periodStart: Date
    periodEnd: Date
    recordKind: "APPROVAL" | "CORRECTION"
    revision: number
    supersedesId: string | null
    calculationVersion: number
    rowsHash: string
    factsHash: string
    rows: unknown
    approvedAt: Date
  }[]
  exports: readonly {
    approvalId: string
    organizationId: string
    agentId: string
    approvalRowsHash: string
    approvalFactsHash: string
  }[]
}

export type WorkforceReconciliationResult = {
  status: "MATCHED" | "MISMATCH"
  examined: Readonly<Record<keyof WorkforceReconciliationSnapshot, number>>
  mismatchCounts: Partial<Record<WorkforceReconciliationCode, number>>
  mismatchTotal: number
  repair: "NONE"
}

function bounded(snapshot: WorkforceReconciliationSnapshot) {
  for (const [kind, rows] of Object.entries(snapshot)) {
    if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_KIND) {
      throw new Error(`WORKFORCE_RECONCILIATION_BATCH_INVALID:${kind}`)
    }
  }
}

function dateKey(date: Date): string {
  return date instanceof Date && Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : "INVALID"
}

function approvalScope(row: WorkforceReconciliationSnapshot["approvals"][number]): string {
  return [row.organizationId, row.agentId, dateKey(row.periodStart), dateKey(row.periodEnd)].join("\u0000")
}

/**
 * Reconciles one bounded, already-authorized snapshot without modifying it.
 * Results contain only finite mismatch codes and counts; row/tenant/employee
 * identifiers and source payloads never cross the diagnostic boundary.
 */
export function reconcileWorkforceSnapshot(
  snapshot: WorkforceReconciliationSnapshot,
): WorkforceReconciliationResult {
  bounded(snapshot)
  const counts: Partial<Record<WorkforceReconciliationCode, number>> = {}
  const mismatch = (code: WorkforceReconciliationCode) => {
    counts[code] = (counts[code] ?? 0) + 1
  }

  const workdays = new Map(snapshot.workdays.map((row) => [row.id, row]))
  const events = new Map(snapshot.events.map((row) => [row.id, row]))
  const transitions = new Map(snapshot.transitions.map((row) => [row.id, row]))
  const evidence = new Map(snapshot.evidence.map((row) => [row.id, row]))
  const approvals = new Map(snapshot.approvals.map((row) => [row.id, row]))

  for (const event of snapshot.events) {
    const workday = workdays.get(event.workdayId)
    if (!workday || workday.organizationId !== event.organizationId || workday.agentId !== event.agentId) {
      mismatch("WORKDAY_EVENT_SCOPE_MISMATCH")
    }
  }

  for (const row of snapshot.evidence) {
    const subjectCount = Number(row.workdayEventId !== null) + Number(row.siteTransitionId !== null)
    if (subjectCount !== 1) {
      mismatch("EVIDENCE_SUBJECT_INVALID")
      continue
    }
    const subject = row.workdayEventId ? events.get(row.workdayEventId) : transitions.get(row.siteTransitionId!)
    if (!subject || subject.organizationId !== row.organizationId) mismatch("EVIDENCE_SUBJECT_SCOPE_MISMATCH")
  }

  for (const row of snapshot.assessments) {
    const source = evidence.get(row.evidenceId)
    if (!source || source.organizationId !== row.organizationId) mismatch("ASSESSMENT_EVIDENCE_MISMATCH")
  }

  for (const row of snapshot.exceptions) {
    const hasNoShowSubject = row.segmentId !== null && row.expectedWorkDate !== null
    if (!row.workdayId && !row.workdayEventId && !row.evidenceId && !hasNoShowSubject) {
      mismatch("EXCEPTION_SUBJECT_INVALID")
      continue
    }
    const workday = row.workdayId ? workdays.get(row.workdayId) : undefined
    const event = row.workdayEventId ? events.get(row.workdayEventId) : undefined
    const proof = row.evidenceId ? evidence.get(row.evidenceId) : undefined
    if (
      (row.workdayId && (!workday || workday.organizationId !== row.organizationId || workday.agentId !== row.agentId))
      || (row.workdayEventId && (!event || event.organizationId !== row.organizationId || event.agentId !== row.agentId))
      || (row.evidenceId && (!proof || proof.organizationId !== row.organizationId))
    ) mismatch("EXCEPTION_SUBJECT_SCOPE_MISMATCH")
  }

  const approvalGroups = new Map<string, typeof snapshot.approvals[number][]>()
  for (const row of snapshot.approvals) {
    const group = approvalGroups.get(approvalScope(row)) ?? []
    group.push(row)
    approvalGroups.set(approvalScope(row), group)
    try {
      exportStoredWorkforceTimesheetApproval(row)
    } catch {
      mismatch("APPROVAL_HASH_INVALID")
    }
  }
  for (const group of approvalGroups.values()) {
    group.sort((left, right) => left.revision - right.revision || left.id.localeCompare(right.id))
    for (let index = 0; index < group.length; index += 1) {
      const row = group[index]
      const previous = group[index - 1]
      const validFirst = index === 0 && row.revision === 1 && row.recordKind === "APPROVAL" && row.supersedesId === null
      const validNext = index > 0 && row.revision === previous.revision + 1
        && row.recordKind === "CORRECTION" && row.supersedesId === previous.id
      if (!validFirst && !validNext) mismatch("APPROVAL_REVISION_INVALID")
    }
  }

  for (const row of snapshot.exports) {
    const approval = approvals.get(row.approvalId)
    if (
      !approval
      || approval.organizationId !== row.organizationId
      || approval.agentId !== row.agentId
      || approval.rowsHash !== row.approvalRowsHash
      || approval.factsHash !== row.approvalFactsHash
    ) mismatch("EXPORT_APPROVAL_MISMATCH")
  }

  const mismatchTotal = Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0)
  return {
    status: mismatchTotal === 0 ? "MATCHED" : "MISMATCH",
    examined: {
      workdays: snapshot.workdays.length,
      events: snapshot.events.length,
      transitions: snapshot.transitions.length,
      evidence: snapshot.evidence.length,
      assessments: snapshot.assessments.length,
      exceptions: snapshot.exceptions.length,
      approvals: snapshot.approvals.length,
      exports: snapshot.exports.length,
    },
    mismatchCounts: counts,
    mismatchTotal,
    repair: "NONE",
  }
}
