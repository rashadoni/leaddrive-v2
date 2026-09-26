/** Immutable employee-owned HR request fields protected by clientRequestId. */
export type WorkforceHrmRequestSubmission = {
  type: string
  startDate: Date
  endDate: Date
  correctionWorkdayId: string | null
  exceptionCaseId: string | null
  requestedStartAt: Date | null
  requestedEndAt: Date | null
  reason: string
}

export type WorkforceHrmRequestIdempotencyDb = {
  $executeRaw: (
    query: TemplateStringsArray,
    ...values: readonly unknown[]
  ) => PromiseLike<unknown>
}

/**
 * Serializes the organization/employee-global client request key before its
 * replay read. A linked correction may point at any case, so a per-case lock
 * alone cannot protect the database uniqueness contract for this key.
 */
export async function lockWorkforceHrmRequestClientKey(
  db: WorkforceHrmRequestIdempotencyDb,
  scope: { organizationId: string; agentId: string; clientRequestId: string },
): Promise<void> {
  const key = `workforce-hrm-request:${scope.organizationId}:${scope.agentId}:${scope.clientRequestId}`
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime()
}

export function workforceHrmRequestSubmissionMatches(
  record: WorkforceHrmRequestSubmission,
  input: WorkforceHrmRequestSubmission,
): boolean {
  return record.type === input.type
    && record.startDate.getTime() === input.startDate.getTime()
    && record.endDate.getTime() === input.endDate.getTime()
    && record.correctionWorkdayId === input.correctionWorkdayId
    && record.exceptionCaseId === input.exceptionCaseId
    && sameInstant(record.requestedStartAt, input.requestedStartAt)
    && sameInstant(record.requestedEndAt, input.requestedEndAt)
    && record.reason === input.reason
}
