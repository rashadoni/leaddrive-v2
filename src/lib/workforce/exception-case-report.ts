import {
  evaluateWorkforceExceptionDraftLifecycle,
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
  type WorkforceExceptionDraftStage,
} from "@/lib/workforce/exception-policy-draft"

export type WorkforceExceptionCaseReportStage = WorkforceExceptionDraftStage | "DATA_INTEGRITY_REVIEW"

export type WorkforceExceptionCaseReport = {
  source: "APPEND_ONLY_EXCEPTION_CASES"
  summary: {
    employees: number
    cases: number
    open: number
    awaitingEmployeeResponse: number
    hrReview: number
    resolved: number
    dataIntegrityReview: number
    employeeResponsesReceived: number
  }
  byType: Array<{
    type: string
    triageSeverity: "ROUTINE_REVIEW" | "ATTENTION_REVIEW"
    cases: number
    open: number
    awaitingEmployeeResponse: number
    hrReview: number
    resolved: number
    dataIntegrityReview: number
    employeeResponsesReceived: number
  }>
  unavailable: {
    employeeDetails: "EXCLUDED_FROM_AGGREGATE"
    caseReferences: "EXCLUDED_FROM_AGGREGATE"
    rawEvidence: "EXCLUDED_FROM_AGGREGATE"
    decisionReasons: "EXCLUDED_FROM_AGGREGATE"
    attendanceConclusion: "CASE_COUNTS_ARE_NOT_PRESENCE_OR_DISCIPLINARY_CONCLUSIONS"
  }
}

export class WorkforceExceptionCaseReportError extends Error {
  constructor(readonly code: "WORKFORCE_EXCEPTION_CASE_REPORT_INPUT_INVALID") {
    super(code)
  }
}

type MutableCounts = Omit<WorkforceExceptionCaseReport["summary"], "employees" | "cases">

function emptyCounts(): MutableCounts {
  return {
    open: 0,
    awaitingEmployeeResponse: 0,
    hrReview: 0,
    resolved: 0,
    dataIntegrityReview: 0,
    employeeResponsesReceived: 0,
  }
}

function canonicalAgentId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 160 || /[\u0000-\u001f]/.test(value)) {
    throw new WorkforceExceptionCaseReportError("WORKFORCE_EXCEPTION_CASE_REPORT_INPUT_INVALID")
  }
  return value
}

function canonicalDecisionCodes(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((code) => typeof code !== "string" || !code.trim() || code.length > 64)) {
    throw new WorkforceExceptionCaseReportError("WORKFORCE_EXCEPTION_CASE_REPORT_INPUT_INVALID")
  }
  return value
}

function canonicalResponseCount(value: unknown): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new WorkforceExceptionCaseReportError("WORKFORCE_EXCEPTION_CASE_REPORT_INPUT_INVALID")
  }
  return value
}

function canonicalBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new WorkforceExceptionCaseReportError("WORKFORCE_EXCEPTION_CASE_REPORT_INPUT_INVALID")
  }
  return value
}

function stageFor(decisionCodes: readonly string[]): WorkforceExceptionCaseReportStage {
  const lifecycle = evaluateWorkforceExceptionDraftLifecycle(decisionCodes.map((decisionCode) => ({ decisionCode })))
  return lifecycle.valid ? lifecycle.stage : "DATA_INTEGRITY_REVIEW"
}

function incrementStage(counts: MutableCounts, stage: WorkforceExceptionCaseReportStage) {
  switch (stage) {
    case "OPEN": counts.open += 1; return
    case "AWAITING_EMPLOYEE_RESPONSE": counts.awaitingEmployeeResponse += 1; return
    case "HR_REVIEW": counts.hrReview += 1; return
    case "RESOLVED": counts.resolved += 1; return
    case "DATA_INTEGRITY_REVIEW": counts.dataIntegrityReview += 1; return
  }
}

/**
 * Builds a bounded, raw-proof-free audit aggregate from persisted C6 cases.
 * It deliberately describes only recorded review cases, not absence,
 * physical presence, payroll, culpability or a disciplinary outcome.
 */
export function buildWorkforceExceptionCaseReport(input: {
  cases: ReadonlyArray<{
    agentId: unknown
    kind: unknown
    decisionCodes: unknown
    decisionHistoryTruncated: unknown
    recordedEmployeeResponseCount: unknown
  }>
}): WorkforceExceptionCaseReport {
  if (!Array.isArray(input.cases)) {
    throw new WorkforceExceptionCaseReportError("WORKFORCE_EXCEPTION_CASE_REPORT_INPUT_INVALID")
  }

  const classifications = new Map(WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1.classifications.map((item) => [item.type, item]))
  const employees = new Set<string>()
  const summaryCounts = emptyCounts()
  const byType = new Map<string, WorkforceExceptionCaseReport["byType"][number]>()

  for (const item of input.cases) {
    const agentId = canonicalAgentId(item.agentId)
    if (typeof item.kind !== "string") {
      throw new WorkforceExceptionCaseReportError("WORKFORCE_EXCEPTION_CASE_REPORT_INPUT_INVALID")
    }
    const classification = classifications.get(item.kind)
    if (!classification) {
      throw new WorkforceExceptionCaseReportError("WORKFORCE_EXCEPTION_CASE_REPORT_INPUT_INVALID")
    }
    const decisionCodes = canonicalDecisionCodes(item.decisionCodes)
    const decisionHistoryTruncated = canonicalBoolean(item.decisionHistoryTruncated)
    const recordedEmployeeResponseCount = canonicalResponseCount(item.recordedEmployeeResponseCount)
    // A partial ledger must never turn an older unselected decision into a
    // false `RESOLVED` state. The caller flags its bounded relation read and
    // the aggregate retains the case for data-integrity review instead.
    const stage = decisionHistoryTruncated ? "DATA_INTEGRITY_REVIEW" : stageFor(decisionCodes)
    const received = recordedEmployeeResponseCount > 0
    employees.add(agentId)
    incrementStage(summaryCounts, stage)
    if (received) summaryCounts.employeeResponsesReceived += 1

    const current = byType.get(classification.type) ?? {
      type: classification.type,
      triageSeverity: classification.triageSeverity,
      cases: 0,
      ...emptyCounts(),
    }
    current.cases += 1
    incrementStage(current, stage)
    if (received) current.employeeResponsesReceived += 1
    byType.set(classification.type, current)
  }

  return {
    source: "APPEND_ONLY_EXCEPTION_CASES",
    summary: {
      employees: employees.size,
      cases: input.cases.length,
      ...summaryCounts,
    },
    byType: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1.classifications
      .map((classification) => byType.get(classification.type))
      .filter((item): item is WorkforceExceptionCaseReport["byType"][number] => item !== undefined),
    unavailable: {
      employeeDetails: "EXCLUDED_FROM_AGGREGATE",
      caseReferences: "EXCLUDED_FROM_AGGREGATE",
      rawEvidence: "EXCLUDED_FROM_AGGREGATE",
      decisionReasons: "EXCLUDED_FROM_AGGREGATE",
      attendanceConclusion: "CASE_COUNTS_ARE_NOT_PRESENCE_OR_DISCIPLINARY_CONCLUSIONS",
    },
  }
}
