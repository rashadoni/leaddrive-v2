/**
 * Pure fail-closed preflight for a future destructive C10 time/decision
 * retention executor. This module neither connects to a database nor deletes
 * a row. It cannot turn source-only evidence into production authorization.
 */
export type WorkforceRetentionPreflightInput = {
  legalHold: "CLEAR" | "ACTIVE" | "UNAVAILABLE"
  environment: "ISOLATED_STAGING" | "PRODUCTION" | "UNKNOWN"
  backupRestore: "VERIFIED_FOR_CURRENT_WINDOW" | "MISSING_OR_STALE"
  cursorLease: "PER_CLASS_LEASED" | "MISSING_OR_UNVERIFIED"
  pressure: "NORMAL" | "ELEVATED" | "UNAVAILABLE"
  purgeAudit: "IMMUTABLE_AUDIT_READY" | "MISSING_OR_UNVERIFIED"
  accountableAuthorization: "RECORDED" | "MISSING"
}

export type WorkforceRetentionPreflightBlocker =
  | "WORKFORCE_RETENTION_LEGAL_HOLD_ACTIVE"
  | "WORKFORCE_RETENTION_LEGAL_HOLD_UNAVAILABLE"
  | "WORKFORCE_RETENTION_ENVIRONMENT_UNSAFE"
  | "WORKFORCE_RETENTION_BACKUP_RESTORE_UNVERIFIED"
  | "WORKFORCE_RETENTION_CURSOR_LEASE_UNVERIFIED"
  | "WORKFORCE_RETENTION_PRESSURE_STOP"
  | "WORKFORCE_RETENTION_AUDIT_UNVERIFIED"
  | "WORKFORCE_RETENTION_AUTHORIZATION_MISSING"

export type WorkforceRetentionPreflight = {
  outcome: "READY_FOR_EXTERNAL_EXECUTION_AUTHORIZATION" | "BLOCKED"
  blockers: readonly WorkforceRetentionPreflightBlocker[]
  execution: "NOT_AVAILABLE"
}

/**
 * Requires all prerequisites including isolated staging. Production is never
 * marked ready here; a separately approved release process must promote a
 * verified staging result and invoke an executor that does not yet exist.
 */
export function evaluateWorkforceTimeDecisionRetentionPreflight(
  input: WorkforceRetentionPreflightInput,
): WorkforceRetentionPreflight {
  const blockers: WorkforceRetentionPreflightBlocker[] = []
  if (input.legalHold === "ACTIVE") blockers.push("WORKFORCE_RETENTION_LEGAL_HOLD_ACTIVE")
  else if (input.legalHold !== "CLEAR") blockers.push("WORKFORCE_RETENTION_LEGAL_HOLD_UNAVAILABLE")
  if (input.environment !== "ISOLATED_STAGING") blockers.push("WORKFORCE_RETENTION_ENVIRONMENT_UNSAFE")
  if (input.backupRestore !== "VERIFIED_FOR_CURRENT_WINDOW") blockers.push("WORKFORCE_RETENTION_BACKUP_RESTORE_UNVERIFIED")
  if (input.cursorLease !== "PER_CLASS_LEASED") blockers.push("WORKFORCE_RETENTION_CURSOR_LEASE_UNVERIFIED")
  if (input.pressure !== "NORMAL") blockers.push("WORKFORCE_RETENTION_PRESSURE_STOP")
  if (input.purgeAudit !== "IMMUTABLE_AUDIT_READY") blockers.push("WORKFORCE_RETENTION_AUDIT_UNVERIFIED")
  if (input.accountableAuthorization !== "RECORDED") blockers.push("WORKFORCE_RETENTION_AUTHORIZATION_MISSING")

  return {
    outcome: blockers.length === 0 ? "READY_FOR_EXTERNAL_EXECUTION_AUTHORIZATION" : "BLOCKED",
    blockers,
    execution: "NOT_AVAILABLE",
  }
}
