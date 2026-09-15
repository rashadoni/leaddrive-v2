/**
 * The public contract of a manager's reopen of today's finished workday and
 * of its undo: request limits, refusal codes and the availability the
 * operational week reports for the selected employee.
 *
 * Pure constants and types, safe for the browser bundle. The services answer
 * with these codes, the week read model repeats them as `blockedReason`, and
 * the CRM dialog localizes every one of them — one list, so a new refusal
 * cannot reach a manager as an untranslated code.
 */

/** Bounds of the mandatory reason, after trimming. */
export const WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH = 3
export const WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH = 1000

/** 409 codes of POST /api/v1/workforce/workdays/:id/reopen. */
export const WORKFORCE_WORKDAY_REOPEN_CONFLICT_CODES = [
  "WORKFORCE_WORKDAY_REOPEN_IDEMPOTENCY_MISMATCH",
  "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED",
  "WORKFORCE_WORKDAY_REOPEN_NOT_TODAY",
  "WORKFORCE_WORKDAY_REOPEN_VERSION_CONFLICT",
  "WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS",
  "WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED",
  "WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING",
  "WORKFORCE_WORKDAY_REOPEN_CORRECTED",
  "WORKFORCE_WORKDAY_REOPEN_HISTORY_INVALID",
] as const

export type WorkforceWorkdayReopenConflictCode = typeof WORKFORCE_WORKDAY_REOPEN_CONFLICT_CODES[number]

/** 409 codes of POST /api/v1/workforce/workdays/:id/reopen/undo. */
export const WORKFORCE_WORKDAY_REOPEN_UNDO_CONFLICT_CODES = [
  "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
  "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_TODAY",
  "WORKFORCE_WORKDAY_REOPEN_UNDO_VERSION_CONFLICT",
  "WORKFORCE_WORKDAY_REOPEN_UNDO_IDEMPOTENCY_MISMATCH",
  "WORKFORCE_WORKDAY_REOPEN_UNDO_HISTORY_INVALID",
] as const

export type WorkforceWorkdayReopenUndoConflictCode = typeof WORKFORCE_WORKDAY_REOPEN_UNDO_CONFLICT_CODES[number]

/**
 * 403 codes both endpoints answer to a principal who may not act on the
 * employee: a session without Workforce write (`withWorkforceSessionAuth`), or
 * one outside the manager time-correction authority.
 */
export const WORKFORCE_WORKDAY_MANAGER_ACTION_DENIAL_CODES = [
  "WORKFORCE_SESSION_PERMISSION_REQUIRED",
  "WORKFORCE_SCOPE_DENIED",
] as const

export type WorkforceWorkdayManagerActionDenialCode = typeof WORKFORCE_WORKDAY_MANAGER_ACTION_DENIAL_CODES[number]

export type WorkforceWorkdayManagerActionBlockedReason =
  | WorkforceWorkdayReopenConflictCode
  | WorkforceWorkdayReopenUndoConflictCode
  | WorkforceWorkdayManagerActionDenialCode

/**
 * Whether the viewing manager may perform one action on the employee's
 * workday today. `workdayId` and `updatedAt` are the target and the version
 * to send as `expectedUpdatedAt`; `blockedReason` is the code the endpoint
 * would answer with, null exactly when `allowed`.
 */
export type WorkforceWorkdayManagerAction = {
  allowed: boolean
  workdayId: string | null
  updatedAt: string | null
  blockedReason: WorkforceWorkdayManagerActionBlockedReason | null
}

export type WorkforceWorkdayManagerActions = {
  reopen: WorkforceWorkdayManagerAction
  undoReopen: WorkforceWorkdayManagerAction
}
