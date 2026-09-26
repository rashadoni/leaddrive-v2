export type CrmCommandErrorCode =
  | "VALIDATION_FAILED"
  | "FORBIDDEN"
  | "FORBIDDEN_FIELD"
  | "NOT_FOUND"
  | "STALE_WRITE"
  // Not FORBIDDEN_FIELD: the field is allowed, the value is the problem.
  // `status: "converted"` has to go through convertLeadToDealCommand, which
  // creates the deal the word promises.
  | "CONVERSION_REQUIRES_COMMAND"

export class CrmCommandError extends Error {
  constructor(
    readonly code: CrmCommandErrorCode,
    message: string,
    readonly status: 400 | 403 | 404 | 409,
    readonly safeDetails?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = "CrmCommandError"
  }
}

export function validationError(message: string): CrmCommandError {
  return new CrmCommandError("VALIDATION_FAILED", message, 400)
}

export function forbiddenError(message = "Forbidden"): CrmCommandError {
  return new CrmCommandError("FORBIDDEN", message, 403)
}

export function notFoundError(message: string): CrmCommandError {
  return new CrmCommandError("NOT_FOUND", message, 404)
}

export function staleWriteError(message = "The record changed after it was reviewed"): CrmCommandError {
  return new CrmCommandError("STALE_WRITE", message, 409)
}
