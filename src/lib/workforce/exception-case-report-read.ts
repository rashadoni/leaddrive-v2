import type { Prisma } from "@prisma/client"
import { buildWorkforceExceptionCaseReport, type WorkforceExceptionCaseReport } from "@/lib/workforce/exception-case-report"
import {
  buildWorkforceExceptionRecordedOutcomes,
  type WorkforceExceptionRecordedOutcomes,
} from "@/lib/workforce/exception-case-report-recorded-outcomes"

const MAX_CASES = 5_000
const MAX_CORRECTION_PROOFS = 5_000
const MAX_DECISIONS = 64

export class WorkforceExceptionCaseReportReadLimitError extends Error {
  readonly code = "WORKFORCE_EXCEPTION_REPORT_LIMIT_EXCEEDED"
  constructor() { super("Exception report read exceeded its bounded cohort or correction proof limit") }
}

export type WorkforceExceptionCaseRecordedReport = WorkforceExceptionCaseReport & {
  recordedOutcomes: WorkforceExceptionRecordedOutcomes
}

/**
 * Caller supplies a tenant-scoped REPEATABLE READ transaction. Both bounded
 * reads must observe the same snapshot, including an atomic request approval.
 * Minimal relationship IDs/timestamps are internal and never returned/audited.
 */
export async function readWorkforceExceptionCaseReport(tx: Prisma.TransactionClient, input: {
  organizationId: string
  startAt: Date
  endAt: Date
}): Promise<WorkforceExceptionCaseRecordedReport> {
  const cases = await tx.workforceExceptionCase.findMany({
    where: { organizationId: input.organizationId, createdAt: { gte: input.startAt, lt: input.endAt } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_CASES + 1,
    select: {
      id: true, organizationId: true, agentId: true, workdayId: true, createdAt: true, kind: true,
      decisions: {
        orderBy: { caseRevision: "asc" },
        take: MAX_DECISIONS + 1,
        select: { caseRevision: true, decisionCode: true, createdAt: true },
      },
      employeeResponses: { take: 1, select: { id: true } },
    },
  })
  if (cases.length > MAX_CASES) throw new WorkforceExceptionCaseReportReadLimitError()

  const proofs = cases.length === 0 ? [] : await tx.workforceTimeCorrection.findMany({
    where: {
      organizationId: input.organizationId,
      source: "REQUEST_APPROVAL",
      request: { is: {
        organizationId: input.organizationId, type: "TIME_CORRECTION", status: "APPROVED",
        exceptionCaseId: { in: cases.map((item) => item.id) },
      } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_CORRECTION_PROOFS + 1,
    select: {
      organizationId: true, agentId: true, workdayId: true, requestId: true, source: true,
      request: { select: {
        id: true, organizationId: true, agentId: true, type: true, status: true,
        correctionWorkdayId: true, exceptionCaseId: true,
      } },
    },
  })
  if (proofs.length > MAX_CORRECTION_PROOFS) throw new WorkforceExceptionCaseReportReadLimitError()

  const analysis = buildWorkforceExceptionRecordedOutcomes({
    organizationId: input.organizationId, cases, correctionProofs: proofs,
  })
  const report = buildWorkforceExceptionCaseReport({ cases: cases.map((item) => ({
    agentId: item.agentId,
    kind: item.kind,
    decisionCodes: item.decisions.slice(0, MAX_DECISIONS).map((decision) => decision.decisionCode),
    decisionHistoryTruncated: analysis.integrityCaseIds.has(item.id),
    recordedEmployeeResponseCount: item.employeeResponses.length,
  })) })
  return { ...report, recordedOutcomes: analysis.recordedOutcomes }
}
