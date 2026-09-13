import { describe, expect, it } from "vitest"
import {
  createWorkforceAccessGrantDraft,
  createWorkforceAccessGrantRevocationDraft,
  WorkforceAccessGrantLedgerError,
} from "@/lib/workforce/access-grant-ledger"

const EFFECTIVE_FROM = new Date("2026-09-01T09:00:00.000Z")

describe("Workforce access grant ledger drafts", () => {
  it("creates an exact, effective-dated role grant without granting access", () => {
    expect(createWorkforceAccessGrantDraft({
      organizationId: "org-1",
      principalUserId: "user-1",
      operationId: "grant-op-1",
      role: "TIME_APPROVER",
      scope: { kind: "TEAM", teamId: "team-1" },
      effectiveFrom: EFFECTIVE_FROM,
      effectiveUntil: new Date("2026-10-01T09:00:00.000Z"),
      grantedByUserId: "admin-1",
      grantReasonCode: "HR_APPOINTMENT",
    })).toEqual({
      organizationId: "org-1",
      principalUserId: "user-1",
      operationId: "grant-op-1",
      role: "TIME_APPROVER",
      scope: { kind: "TEAM", teamId: "team-1" },
      effectiveFrom: EFFECTIVE_FROM,
      effectiveUntil: new Date("2026-10-01T09:00:00.000Z"),
      grantedByUserId: "admin-1",
      grantReasonCode: "HR_APPOINTMENT",
    })
  })

  it("fails closed for malformed scope, unsupported role scope or an invalid effective window", () => {
    for (const invalid of [
      { role: "TENANT_ADMIN", scope: { kind: "TEAM", teamId: "team-1" } },
      { role: "TIME_APPROVER", scope: { kind: "SITE", siteId: "site-1" } },
      { role: "HR_ADMIN", scope: { kind: "ORGANIZATION", unexpected: "value" } },
      { role: "UNKNOWN_ROLE", scope: { kind: "ORGANIZATION" } },
    ]) {
      expect(() => createWorkforceAccessGrantDraft({
        organizationId: "org-1", principalUserId: "user-1", operationId: "grant-op-1", effectiveFrom: EFFECTIVE_FROM,
        grantedByUserId: "admin-1", grantReasonCode: "HR_APPOINTMENT", ...invalid,
      })).toThrow(expect.objectContaining({ code: "WORKFORCE_ACCESS_GRANT_INPUT_INVALID" } satisfies Partial<WorkforceAccessGrantLedgerError>))
    }
    expect(() => createWorkforceAccessGrantDraft({
      organizationId: "org-1", principalUserId: "user-1", operationId: "grant-op-1", role: "HR_ADMIN", scope: { kind: "ORGANIZATION" },
      effectiveFrom: EFFECTIVE_FROM, effectiveUntil: EFFECTIVE_FROM, grantedByUserId: "admin-1", grantReasonCode: "HR_APPOINTMENT",
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_ACCESS_GRANT_INPUT_INVALID" }))
    expect(() => createWorkforceAccessGrantDraft({
      organizationId: "org-1", principalUserId: "user-1", operationId: "grant op with spaces", role: "HR_ADMIN", scope: { kind: "ORGANIZATION" },
      effectiveFrom: EFFECTIVE_FROM, grantedByUserId: "admin-1", grantReasonCode: "HR_APPOINTMENT",
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_ACCESS_GRANT_INPUT_INVALID" }))
  })

  it("creates an accountable append-only revocation only at or after the grant starts", () => {
    expect(createWorkforceAccessGrantRevocationDraft({
      organizationId: "org-1",
      grantId: "grant-1",
      operationId: "revoke-op-1",
      grantEffectiveFrom: EFFECTIVE_FROM,
      revokedByUserId: "admin-2",
      revocationReasonCode: "ROLE_CHANGE",
      revokedAt: new Date("2026-09-10T09:00:00.000Z"),
    })).toMatchObject({ grantId: "grant-1", revocationReasonCode: "ROLE_CHANGE" })
    expect(() => createWorkforceAccessGrantRevocationDraft({
      organizationId: "org-1", grantId: "grant-1", operationId: "revoke-op-1", grantEffectiveFrom: EFFECTIVE_FROM,
      revokedByUserId: "admin-2", revocationReasonCode: "ROLE_CHANGE", revokedAt: new Date("2026-08-31T09:00:00.000Z"),
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_ACCESS_REVOCATION_INPUT_INVALID" }))
  })
})
