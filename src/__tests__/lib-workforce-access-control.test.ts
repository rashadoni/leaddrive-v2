import { describe, expect, it } from "vitest"
import {
  decideWorkforceAccess,
  workforceRawEvidenceAccessDenied,
  workforceRolePermissions,
  workforceRoleScopeKinds,
  validateWorkforceDraftRoleSet,
  type WorkforceAccessGrant,
} from "@/lib/workforce/access-control"

const NOW = new Date("2026-08-30T12:00:00.000Z")
const BASE = {
  organizationId: "org-1",
  principalUserId: "user-1",
  selfAgentId: "agent-self",
  resource: { organizationId: "org-1", agentId: "agent-1", teamId: "team-1", siteId: "site-1" },
  now: NOW,
}

function grant(input: Partial<WorkforceAccessGrant> = {}): WorkforceAccessGrant {
  return {
    id: "grant-1",
    organizationId: "org-1",
    principalUserId: "user-1",
    role: "TEAM_MANAGER",
    scope: { kind: "TEAM", teamId: "team-1" },
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    revokedAt: null,
    ...input,
  }
}

describe("Workforce granular access foundation", () => {
  it("keeps employee self actions exact to the employee subject", () => {
    expect(decideWorkforceAccess({
      ...BASE,
      permission: "SELF_WORKTIME_MUTATE",
      resource: { organizationId: "org-1", agentId: "agent-self" },
      grants: [],
    })).toEqual({ allowed: true, source: "SELF" })
    expect(decideWorkforceAccess({ ...BASE, permission: "SELF_WORKTIME_MUTATE", grants: [] }))
      .toEqual({ allowed: false, code: "WORKFORCE_ACCESS_SELF_SCOPE_DENIED" })
  })

  it("allows a role only within its explicit effective team scope", () => {
    expect(decideWorkforceAccess({ ...BASE, permission: "TEAM_REQUEST_DECIDE", grants: [grant()] }))
      .toEqual({ allowed: true, source: "GRANT", grantId: "grant-1" })
    expect(decideWorkforceAccess({
      ...BASE,
      permission: "TEAM_REQUEST_DECIDE",
      resource: { ...BASE.resource, teamId: "team-2" },
      grants: [grant()],
    })).toEqual({ allowed: false, code: "WORKFORCE_ACCESS_SCOPE_DENIED" })
  })

  it("allows accountable exception decisions only for an explicit HR or scoped team-manager grant", () => {
    expect(decideWorkforceAccess({ ...BASE, permission: "TEAM_EXCEPTION_DECIDE", grants: [grant()] }))
      .toEqual({ allowed: true, source: "GRANT", grantId: "grant-1" })
    expect(decideWorkforceAccess({
      ...BASE,
      permission: "TEAM_EXCEPTION_DECIDE",
      grants: [grant({ role: "HR_ADMIN", scope: { kind: "ORGANIZATION" } })],
    })).toEqual({ allowed: true, source: "GRANT", grantId: "grant-1" })
    expect(decideWorkforceAccess({
      ...BASE,
      permission: "TEAM_EXCEPTION_DECIDE",
      grants: [grant({ role: "TIME_APPROVER" })],
    })).toEqual({ allowed: false, code: "WORKFORCE_ACCESS_GRANT_UNAVAILABLE" })
  })

  it("does not let a role borrow another role's permission or an unsupported broad scope", () => {
    expect(decideWorkforceAccess({ ...BASE, permission: "TIME_APPROVE", grants: [grant()] }))
      .toEqual({ allowed: false, code: "WORKFORCE_ACCESS_GRANT_UNAVAILABLE" })
    expect(decideWorkforceAccess({
      ...BASE,
      permission: "TEAM_REQUEST_DECIDE",
      grants: [grant({ scope: { kind: "ORGANIZATION" } })],
    })).toEqual({ allowed: false, code: "WORKFORCE_ACCESS_SCOPE_DENIED" })
  })

  it("uses a later matching grant instead of failing on an earlier narrow grant", () => {
    expect(decideWorkforceAccess({
      ...BASE,
      permission: "TEAM_REQUEST_DECIDE",
      grants: [
        grant({ id: "grant-wrong-team", scope: { kind: "TEAM", teamId: "team-2" } }),
        grant({ id: "grant-right-team" }),
      ],
    })).toEqual({ allowed: true, source: "GRANT", grantId: "grant-right-team" })
  })

  it("fails closed for future, expired or revoked grants", () => {
    for (const invalid of [
      grant({ effectiveFrom: new Date("2026-09-01T00:00:00.000Z") }),
      grant({ effectiveUntil: new Date("2026-08-30T11:59:00.000Z") }),
      grant({ revokedAt: new Date("2026-08-30T11:59:00.000Z") }),
    ]) {
      expect(decideWorkforceAccess({ ...BASE, permission: "TEAM_REQUEST_DECIDE", grants: [invalid] }))
        .toEqual({ allowed: false, code: "WORKFORCE_ACCESS_GRANT_UNAVAILABLE" })
    }
  })

  it("reserves raw evidence for the separately purpose-gated C10 path", () => {
    expect(workforceRawEvidenceAccessDenied()).toEqual({
      allowed: false,
      code: "WORKFORCE_ACCESS_RAW_EVIDENCE_RESTRICTED",
    })
    expect(workforceRolePermissions("HR_ADMIN")).toContain("TEAM_EXCEPTION_DECIDE")
    expect(workforceRolePermissions("TEAM_MANAGER")).toContain("TEAM_EXCEPTION_DECIDE")
    expect(workforceRolePermissions("EVIDENCE_REVIEWER")).toEqual(["EVIDENCE_DERIVED_READ"])
    expect(workforceRoleScopeKinds("DEVICE_SECURITY_ADMIN")).toEqual(["ORGANIZATION", "SITE"])
  })

  it("records recommended separation-of-duty pairs as a deterministic draft validation", () => {
    expect(validateWorkforceDraftRoleSet(["TEAM_MANAGER", "SCHEDULER", "TIME_APPROVER", "SCHEDULER"]))
      .toEqual({
        valid: false,
        code: "WORKFORCE_ACCESS_INCOMPATIBLE_DRAFT_ROLES",
        roles: ["SCHEDULER", "TIME_APPROVER", "TEAM_MANAGER"],
        incompatiblePairs: [["SCHEDULER", "TIME_APPROVER"], ["TIME_APPROVER", "TEAM_MANAGER"]],
      })
    expect(validateWorkforceDraftRoleSet(["HR_ADMIN", "TEAM_MANAGER", "HR_ADMIN"]))
      .toEqual({ valid: true, roles: ["HR_ADMIN", "TEAM_MANAGER"], incompatiblePairs: [] })
  })

  it("fails closed when a future or malformed role is proposed", () => {
    expect(validateWorkforceDraftRoleSet(["HR_ADMIN", "NOT_A_WORKFORCE_ROLE"]))
      .toEqual({
        valid: false,
        code: "WORKFORCE_ACCESS_DRAFT_ROLE_UNKNOWN",
        roles: ["HR_ADMIN"],
        incompatiblePairs: [],
      })
  })
})
