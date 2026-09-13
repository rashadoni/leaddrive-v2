import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import {
  persistAuthorizedWorkforceExceptionCase,
  WorkforceExceptionCaseWriterError,
  type WorkforceExceptionCaseAuthorization,
  type WorkforceExceptionCasePersistenceDb,
} from "@/lib/workforce/exception-case-writer"
import {
  readWorkforceNoShowCandidate,
  type WorkforceNoShowCandidate,
  type WorkforceNoShowCandidateDb,
} from "@/lib/workforce/no-show-candidate"

/**
 * Transaction-only C6 bridge from a current, complete no-show observation to
 * one immutable human-review case. It deliberately has no scheduler, route,
 * tenant-capability lookup, notification or decision writer: an operational
 * worker must still supply those controls before it can call this primitive.
 */
export type WorkforceNoShowCaseMaterializerDb = WorkforceNoShowCandidateDb & WorkforceExceptionCasePersistenceDb
export type WorkforceNoShowCaseMaterializerClient = {
  $transaction: <T>(operation: (tx: WorkforceNoShowCaseMaterializerDb) => Promise<T>) => Promise<T>
}

export type WorkforceNoShowCaseMaterialization =
  | {
      outcome: "REVIEW_CASE_RECORDED"
      caseId: string
      idempotent: boolean
      expectedStartAt: string
    }
  | {
      outcome: "NOT_CREATED"
      candidate: Exclude<WorkforceNoShowCandidate, { outcome: "REVIEW_CANDIDATE" }>
    }

/**
 * Re-reads eligibility *after* the canonical workday-transition lock. A
 * concurrent START therefore either becomes visible before the candidate is
 * evaluated or follows a recorded, review-only missed-start case. No caller
 * can turn the resulting case into a payroll, disciplinary or attendance fact
 * through this materializer.
 */
export async function materializeAuthorizedWorkforceNoShowReviewCaseInTransaction(input: {
  tx: WorkforceNoShowCaseMaterializerDb
  organizationId: string
  agentId: string
  workDate: string
  asOf: Date
  authorize: WorkforceExceptionCaseAuthorization
}): Promise<WorkforceNoShowCaseMaterialization> {
  const authorized = await input.authorize({
    operation: "CASE_CREATE",
    organizationId: input.organizationId,
    agentId: input.agentId,
  })
  if (!authorized) {
    throw new WorkforceExceptionCaseWriterError("WORKFORCE_EXCEPTION_CASE_NOT_AUTHORIZED")
  }

  // Match the canonical START/PAUSE/RESUME/FINISH transition namespace before
  // looking for an absent workday. The case writer takes a second, narrower
  // immutable-subject lock for deduplication after this fact-time check.
  await lockMtmWorkdayTransitions(input.tx, {
    organizationId: input.organizationId,
    agentId: input.agentId,
  })
  const candidate = await readWorkforceNoShowCandidate(input.tx, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    workDate: input.workDate,
    asOf: input.asOf,
  })
  if (candidate.outcome !== "REVIEW_CANDIDATE") {
    return { outcome: "NOT_CREATED", candidate }
  }

  const persisted = await persistAuthorizedWorkforceExceptionCase({
    db: input.tx,
    draft: candidate.caseDraft,
    authorize: input.authorize,
  })
  return {
    outcome: "REVIEW_CASE_RECORDED",
    caseId: persisted.caseId,
    idempotent: persisted.idempotent,
    expectedStartAt: candidate.expectedStartAt,
  }
}

/** Owns the interactive transaction that keeps the workday and case locks. */
export async function materializeAuthorizedWorkforceNoShowReviewCase(input: {
  db: WorkforceNoShowCaseMaterializerClient
  organizationId: string
  agentId: string
  workDate: string
  asOf: Date
  authorize: WorkforceExceptionCaseAuthorization
}): Promise<WorkforceNoShowCaseMaterialization> {
  return input.db.$transaction((tx) => materializeAuthorizedWorkforceNoShowReviewCaseInTransaction({
    tx,
    organizationId: input.organizationId,
    agentId: input.agentId,
    workDate: input.workDate,
    asOf: input.asOf,
    authorize: input.authorize,
  }))
}
