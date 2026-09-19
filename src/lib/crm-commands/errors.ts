export type CrmCommandErrorCode =
  | "VALIDATION_FAILED"
  | "FORBIDDEN"
  | "FORBIDDEN_FIELD"
  | "NOT_FOUND"

export class CrmCommandError extends Error {
  constructor(
    readonly code: CrmCommandErrorCode,
    message: string,
    readonly status: 400 | 403 | 404,
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
