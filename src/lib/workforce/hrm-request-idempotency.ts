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
