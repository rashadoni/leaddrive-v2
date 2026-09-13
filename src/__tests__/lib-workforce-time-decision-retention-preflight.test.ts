import { describe, expect, it } from "vitest"
import { evaluateWorkforceTimeDecisionRetentionPreflight } from "@/lib/workforce/time-decision-retention-preflight"

const readyInput = {
  legalHold: "CLEAR",
  environment: "ISOLATED_STAGING",
  backupRestore: "VERIFIED_FOR_CURRENT_WINDOW",
  cursorLease: "PER_CLASS_LEASED",
  pressure: "NORMAL",
  purgeAudit: "IMMUTABLE_AUDIT_READY",
  accountableAuthorization: "RECORDED",
} as const

describe("Workforce time/decision retention execution preflight", () => {
  it("is only ready for external authorization after every staging prerequisite is evidenced", () => {
    expect(evaluateWorkforceTimeDecisionRetentionPreflight(readyInput)).toEqual({
      outcome: "READY_FOR_EXTERNAL_EXECUTION_AUTHORIZATION",
      blockers: [],
      execution: "NOT_AVAILABLE",
    })
  })

  it("fails closed for active, unavailable or malformed legal-hold evidence", () => {
    expect(evaluateWorkforceTimeDecisionRetentionPreflight({ ...readyInput, legalHold: "ACTIVE" })).toMatchObject({
      outcome: "BLOCKED", blockers: ["WORKFORCE_RETENTION_LEGAL_HOLD_ACTIVE"],
    })
    expect(evaluateWorkforceTimeDecisionRetentionPreflight({ ...readyInput, legalHold: "UNAVAILABLE" })).toMatchObject({
      outcome: "BLOCKED", blockers: ["WORKFORCE_RETENTION_LEGAL_HOLD_UNAVAILABLE"],
    })
    expect(evaluateWorkforceTimeDecisionRetentionPreflight({ ...readyInput, legalHold: "INVALID" as never })).toMatchObject({
      outcome: "BLOCKED", blockers: ["WORKFORCE_RETENTION_LEGAL_HOLD_UNAVAILABLE"],
    })
  })

  it("requires staging, restore, leased cursor, normal pressure, audit and accountable authorization", () => {
    expect(evaluateWorkforceTimeDecisionRetentionPreflight({
      legalHold: "CLEAR",
      environment: "PRODUCTION",
      backupRestore: "MISSING_OR_STALE",
      cursorLease: "MISSING_OR_UNVERIFIED",
      pressure: "ELEVATED",
      purgeAudit: "MISSING_OR_UNVERIFIED",
      accountableAuthorization: "MISSING",
    })).toEqual({
      outcome: "BLOCKED",
      blockers: [
        "WORKFORCE_RETENTION_ENVIRONMENT_UNSAFE",
        "WORKFORCE_RETENTION_BACKUP_RESTORE_UNVERIFIED",
        "WORKFORCE_RETENTION_CURSOR_LEASE_UNVERIFIED",
        "WORKFORCE_RETENTION_PRESSURE_STOP",
        "WORKFORCE_RETENTION_AUDIT_UNVERIFIED",
        "WORKFORCE_RETENTION_AUTHORIZATION_MISSING",
      ],
      execution: "NOT_AVAILABLE",
    })
  })
})
