import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import {
  persistAuthorizedWorkforceExceptionCase,
  WorkforceExceptionCaseWriterError,
  type WorkforceExceptionCaseAuthorization,
  type WorkforceExceptionCasePersistenceDb,
} from "@/lib/workforce/exception-case-writer"
import {
  createWorkforceMissedFinishExceptionCaseDraft,
} from "@/lib/workforce/exception-intake"
import {
  readWorkforceMissedFinishCandidate,
  type WorkforceMissedFinishCandidate,
  type WorkforceMissedFinishCandidateDb,
} from "@/lib/workforce/missed-finish-candidate"

/**
 * Transaction-only C6 bridge for a stale open workday. It deliberately has
 * no reminder delivery, scheduler, capability lookup, workday mutation,
 * notification or decision writer. The worker that eventually calls it must
 * provide its own reviewed timing policy, tenant fence, lease and monitoring.
 */
export type WorkforceMissedFinishCaseMaterializerDb =
  WorkforceMissedFinishCandidateDb & WorkforceExceptionCasePersistenceDb
export type WorkforceMissedFinishCaseMaterializerClient = {
  $transaction: <T>(operation: (tx: WorkforceMissedFinishCaseMaterializerDb) => Promise<T>) => Promise<T>
}

export type WorkforceMissedFinishCaseMaterialization =
  | {
      outcome: "REVIEW_CASE_RECORDED"
      caseId: string
      idempotent: boolean
      workdayId: string
    }
  | {
      outcome: "NOT_CREATED"
      candidate: WorkforceMissedFinishCandidate
    }

/**
 * Re-reads the concrete workday after taking the same canonical transition
 * lane as START/FINISH. A finish already committed before the read suppresses
 * the case; a later finish remains an immutable, human-reviewable fact and is
 * never invented, delayed or overwritten by this materializer.
 */
async function materializeAuthorizedWorkforceMissedFinishReviewCaseInTransaction(input: {
  tx: WorkforceMissedFinishCaseMaterializerDb
  organizationId: string
  agentId: string
  workdayId: string
  asOf: Date
  timing: {
    privateReminderAfterSeconds: number
    reviewAfterSeconds: number
  }
  authorize: WorkforceExceptionCaseAuthorization
}): Promise<WorkforceMissedFinishCaseMaterialization> {
  const authorized = await input.authorize({
    operation: "CASE_CREATE",
    organizationId: input.organizationId,
    agentId: input.agentId,
  })
  if (!authorized) {
    throw new WorkforceExceptionCaseWriterError("WORKFORCE_EXCEPTION_CASE_NOT_AUTHORIZED")
  }

  await lockMtmWorkdayTransitions(input.tx, {
    organizationId: input.organizationId,
    agentId: input.agentId,
  })
  const candidate = await readWorkforceMissedFinishCandidate(input.tx, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    workdayId: input.workdayId,
    asOf: input.asOf,
    timing: input.timing,
  })
  if (
    candidate.outcome !== "ACTION_CANDIDATE"
    || candidate.proposal.outcome !== "PROPOSE_REVIEW_CASE"
  ) {
    return { outcome: "NOT_CREATED", candidate }
  }

  const caseDraft = createWorkforceMissedFinishExceptionCaseDraft({
    organizationId: input.organizationId,
    agentId: input.agentId,
    workdayId: candidate.workdayId,
    proposal: candidate.proposal,
  })
  if (!caseDraft) {
    throw new WorkforceExceptionCaseWriterError("WORKFORCE_EXCEPTION_CASE_WRITE_CONFLICT")
  }
  const persisted = await persistAuthorizedWorkforceExceptionCase({
    db: input.tx,
    draft: caseDraft,
    authorize: input.authorize,
  })
  return {
    outcome: "REVIEW_CASE_RECORDED",
    caseId: persisted.caseId,
    idempotent: persisted.idempotent,
    workdayId: candidate.workdayId,
  }
}

/** Owns the interactive transaction that keeps the workday and case locks. */
export async function materializeAuthorizedWorkforceMissedFinishReviewCase(input: {
  db: WorkforceMissedFinishCaseMaterializerClient
  organizationId: string
  agentId: string
  workdayId: string
  asOf: Date
  timing: {
    privateReminderAfterSeconds: number
    reviewAfterSeconds: number
  }
  authorize: WorkforceExceptionCaseAuthorization
}): Promise<WorkforceMissedFinishCaseMaterialization> {
  return input.db.$transaction((tx) => materializeAuthorizedWorkforceMissedFinishReviewCaseInTransaction({
    tx,
    organizationId: input.organizationId,
    agentId: input.agentId,
    workdayId: input.workdayId,
    asOf: input.asOf,
    timing: input.timing,
    authorize: input.authorize,
  }))
}
