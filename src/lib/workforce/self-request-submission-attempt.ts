export type WorkforceSelfRequestSubmissionInput = {
  clientRequestId: string
  type: "LEAVE" | "ABSENCE" | "TIME_CORRECTION"
  startDate: string
  endDate: string
  reason: string
  correctionWorkdayId?: string
  exceptionCaseId?: string
  requestedStartLocal?: string
  requestedEndLocal?: string
}

export type WorkforceSelfRequestSubmissionAttempt = Readonly<{
  input: Readonly<WorkforceSelfRequestSubmissionInput>
  uncertain: boolean
}>

export class WorkforceSelfRequestSubmissionError extends Error {
  constructor(message: string, readonly definitivelyRejected: boolean) {
    super(message)
    this.name = "WorkforceSelfRequestSubmissionError"
  }
}

const definiteRefusals = new Map<string, readonly number[]>([
  ["WORKFORCE_SELF_REQUEST_INVALID", [400]],
  ["WORKFORCE_SCOPE_DENIED", [403]],
  ["WORKFORCE_SELF_REQUEST_WORKDAY_NOT_FOUND", [404, 409]],
  ["WORKFORCE_SELF_REQUEST_LOCAL_TIME_INVALID", [409]],
  ["WORKFORCE_SELF_REQUEST_TIME_RANGE_INVALID", [409]],
  ["WORKFORCE_SELF_REQUEST_OVERLAP", [409]],
  ["WORKFORCE_EXCEPTION_LINKED_MUTATION_RESOLVED", [409]],
  ["WORKFORCE_EXCEPTION_LINKED_MUTATION_HISTORY_INVALID", [409]],
  ["session_expired", [401]],
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A failed transport or malformed reply cannot establish whether a write committed. */
export function readWorkforceSelfRequestSubmissionReply(
  status: number,
  body: unknown,
  fallbackMessage: string,
): { idempotent: boolean } {
  if (isRecord(body)
    && body.success === true
    && typeof body.idempotent === "boolean"
    && status === (body.idempotent ? 200 : 201)
    && isRecord(body.data)
    && typeof body.data.id === "string"
    && body.data.id.trim().length > 0) {
    return { idempotent: body.idempotent }
  }
  const message = isRecord(body) && typeof body.error === "string" && body.error.trim()
    ? body.error
    : fallbackMessage
  const rejected = isRecord(body)
    && body.success !== true
    && typeof body.error === "string"
    && body.error.trim().length > 0
    && typeof body.code === "string"
    && Boolean(definiteRefusals.get(body.code)?.includes(status))
  throw new WorkforceSelfRequestSubmissionError(message, rejected)
}

export function captureWorkforceSelfRequestSubmissionAttempt(
  input: WorkforceSelfRequestSubmissionInput,
): WorkforceSelfRequestSubmissionAttempt {
  return Object.freeze({ input: Object.freeze({ ...input }), uncertain: false })
}

/** A refused retry cannot disprove an earlier write whose reply was lost. */
export function retainWorkforceSelfRequestSubmissionAfterFailure(
  attempt: WorkforceSelfRequestSubmissionAttempt,
  error: unknown,
): WorkforceSelfRequestSubmissionAttempt | null {
  if (!attempt.uncertain
    && error instanceof WorkforceSelfRequestSubmissionError
    && error.definitivelyRejected) return null
  return Object.freeze({ input: attempt.input, uncertain: true })
}
