/**
 * Workforce's future granular-role contract. It is deliberately pure: this
 * file does not assign, persist or activate a role grant. Existing endpoints
 * retain their established authorization until a forward-only migration and
 * tenant rollout can make these grants authoritative without surprise lockout.
 */

export const WORKFORCE_ACCESS_ROLES = [
  "TENANT_ADMIN",
  "HR_ADMIN",
  "SCHEDULER",
  "TIME_APPROVER",
  "EVIDENCE_REVIEWER",
  "DEVICE_SECURITY_ADMIN",
  "EXPORT_CUSTODIAN",
  "RETENTION_HOLD_OFFICER",
  "PILOT_ROLLBACK_OPERATOR",
  "TEAM_MANAGER",
] as const

export type WorkforceAccessRole = typeof WORKFORCE_ACCESS_ROLES[number]

/**
 * Recommended v1 separation of duties, recorded as a draft validation
 * contract only. It neither changes an existing grant nor blocks a tenant
 * until the forward-only C7 grant migration explicitly opts that tenant in.
 *
 * Each pair is canonical (the earlier role appears first in
 * `WORKFORCE_ACCESS_ROLES`) so audit and future migration output is stable.
 */
export const WORKFORCE_RECOMMENDED_INCOMPATIBLE_ROLE_PAIRS = [
  ["SCHEDULER", "TIME_APPROVER"],
  ["TIME_APPROVER", "TEAM_MANAGER"],
  ["EVIDENCE_REVIEWER", "DEVICE_SECURITY_ADMIN"],
  ["EXPORT_CUSTODIAN", "RETENTION_HOLD_OFFICER"],
] as const satisfies readonly (readonly [WorkforceAccessRole, WorkforceAccessRole])[]

export type WorkforceIncompatibleRolePair = typeof WORKFORCE_RECOMMENDED_INCOMPATIBLE_ROLE_PAIRS[number]

export type WorkforceDraftRoleSetValidation =
  | {
      valid: true
      /** De-duplicated and canonical role order; no grant is created. */
      roles: readonly WorkforceAccessRole[]
      incompatiblePairs: readonly []
    }
  | {
      valid: false
      code: "WORKFORCE_ACCESS_DRAFT_ROLE_UNKNOWN" | "WORKFORCE_ACCESS_INCOMPATIBLE_DRAFT_ROLES"
      roles: readonly WorkforceAccessRole[]
      incompatiblePairs: readonly WorkforceIncompatibleRolePair[]
    }

export const WORKFORCE_ACCESS_PERMISSIONS = [
  "SELF_WORKTIME_READ",
  "SELF_WORKTIME_MUTATE",
  "SELF_REQUEST_CREATE",
  "SELF_REQUEST_CANCEL",
  "SELF_EXCEPTION_READ",
  "SELF_EXCEPTION_EXPLAIN",
  "TEAM_ATTENDANCE_READ",
  "TEAM_REQUEST_READ",
  "TEAM_REQUEST_DECIDE",
  "TEAM_EXCEPTION_READ",
  "SCHEDULE_READ",
  "SCHEDULE_WRITE",
  "SITE_ASSIGNMENT_WRITE",
  "WORKFORCE_POLICY_DRAFT_WRITE",
  "TIME_APPROVE",
  "TIME_CORRECT",
  "EVIDENCE_DERIVED_READ",
  "DEVICE_LIFECYCLE_MANAGE",
  "QR_STATION_MANAGE",
  "TIMESHEET_EXPORT",
  "RETENTION_HOLD_MANAGE",
  "RETENTION_DRY_RUN_READ",
  "PILOT_FENCE_MANAGE",
  "PILOT_ROLLBACK_RUN",
  "ROLE_GRANT_MANAGE",
] as const

export type WorkforceAccessPermission = typeof WORKFORCE_ACCESS_PERMISSIONS[number]

export type WorkforceAccessScope =
  | { kind: "ORGANIZATION" }
  | { kind: "TEAM"; teamId: string }
  | { kind: "SITE"; siteId: string }
  | { kind: "AGENT"; agentId: string }

export type WorkforceResourceScope = {
  organizationId: string
  agentId?: string | null
  teamId?: string | null
  siteId?: string | null
}

export type WorkforceAccessGrant = {
  id: string
  organizationId: string
  principalUserId: string
  role: WorkforceAccessRole
  scope: WorkforceAccessScope
  effectiveFrom: Date
  effectiveUntil: Date | null
  revokedAt: Date | null
}

export type WorkforceAccessDecision =
  | { allowed: true; source: "SELF" | "GRANT"; grantId?: string }
  | {
      allowed: false
      code:
        | "WORKFORCE_ACCESS_SELF_SCOPE_DENIED"
        | "WORKFORCE_ACCESS_GRANT_UNAVAILABLE"
        | "WORKFORCE_ACCESS_SCOPE_DENIED"
        | "WORKFORCE_ACCESS_RAW_EVIDENCE_RESTRICTED"
    }

const SELF_PERMISSIONS = new Set<WorkforceAccessPermission>([
  "SELF_WORKTIME_READ",
  "SELF_WORKTIME_MUTATE",
  "SELF_REQUEST_CREATE",
  "SELF_REQUEST_CANCEL",
  "SELF_EXCEPTION_READ",
  "SELF_EXCEPTION_EXPLAIN",
])

const ROLE_PERMISSIONS: Readonly<Record<WorkforceAccessRole, readonly WorkforceAccessPermission[]>> = {
  TENANT_ADMIN: ["ROLE_GRANT_MANAGE"],
  HR_ADMIN: ["SCHEDULE_READ", "WORKFORCE_POLICY_DRAFT_WRITE"],
  SCHEDULER: ["SCHEDULE_READ", "SCHEDULE_WRITE", "SITE_ASSIGNMENT_WRITE"],
  TIME_APPROVER: ["TEAM_ATTENDANCE_READ", "TIME_APPROVE", "TIME_CORRECT"],
  EVIDENCE_REVIEWER: ["EVIDENCE_DERIVED_READ"],
  DEVICE_SECURITY_ADMIN: ["DEVICE_LIFECYCLE_MANAGE", "QR_STATION_MANAGE"],
  EXPORT_CUSTODIAN: ["TEAM_ATTENDANCE_READ", "TIMESHEET_EXPORT"],
  RETENTION_HOLD_OFFICER: ["RETENTION_HOLD_MANAGE", "RETENTION_DRY_RUN_READ"],
  PILOT_ROLLBACK_OPERATOR: ["PILOT_FENCE_MANAGE", "PILOT_ROLLBACK_RUN"],
  TEAM_MANAGER: ["TEAM_ATTENDANCE_READ", "TEAM_REQUEST_READ", "TEAM_REQUEST_DECIDE", "TEAM_EXCEPTION_READ"],
}

const ROLE_SCOPE_KINDS: Readonly<Record<WorkforceAccessRole, readonly WorkforceAccessScope["kind"][]>> = {
  TENANT_ADMIN: ["ORGANIZATION"],
  HR_ADMIN: ["ORGANIZATION", "TEAM", "SITE"],
  SCHEDULER: ["ORGANIZATION", "TEAM", "SITE"],
  TIME_APPROVER: ["ORGANIZATION", "TEAM", "AGENT"],
  EVIDENCE_REVIEWER: ["ORGANIZATION", "TEAM", "SITE", "AGENT"],
  DEVICE_SECURITY_ADMIN: ["ORGANIZATION", "SITE"],
  EXPORT_CUSTODIAN: ["ORGANIZATION", "TEAM", "AGENT"],
  RETENTION_HOLD_OFFICER: ["ORGANIZATION"],
  PILOT_ROLLBACK_OPERATOR: ["ORGANIZATION"],
  TEAM_MANAGER: ["TEAM", "SITE"],
}

/**
 * Exact raw evidence is intentionally absent from the role vocabulary. A
 * later C10 investigation route must require an explicit purpose, reason,
 * access audit and separately reviewed disclosure policy; a generic role
 * cannot turn a coordinate, QR or device proof into an ordinary read.
 */
export function workforceRawEvidenceAccessDenied(): WorkforceAccessDecision {
  return { allowed: false, code: "WORKFORCE_ACCESS_RAW_EVIDENCE_RESTRICTED" }
}

export function workforceRolePermissions(role: WorkforceAccessRole): readonly WorkforceAccessPermission[] {
  return ROLE_PERMISSIONS[role]
}

export function workforceRoleScopeKinds(role: WorkforceAccessRole): readonly WorkforceAccessScope["kind"][] {
  return ROLE_SCOPE_KINDS[role]
}

/**
 * Validates a proposed future role set without looking up or mutating a live
 * grant. Unknown persisted/future role strings fail closed. Actual SoD
 * enforcement still requires an audited assignment migration and must also
 * retain the existing endpoint-level self-approval checks.
 */
export function validateWorkforceDraftRoleSet(
  proposedRoles: readonly string[],
): WorkforceDraftRoleSetValidation {
  const proposedRoleSet = new Set(proposedRoles)
  const roles = WORKFORCE_ACCESS_ROLES.filter((role) => proposedRoleSet.has(role))
  if (proposedRoles.some((role) => !WORKFORCE_ACCESS_ROLES.includes(role as WorkforceAccessRole))) {
    return {
      valid: false,
      code: "WORKFORCE_ACCESS_DRAFT_ROLE_UNKNOWN",
      roles,
      incompatiblePairs: [],
    }
  }

  const incompatiblePairs = WORKFORCE_RECOMMENDED_INCOMPATIBLE_ROLE_PAIRS.filter(([first, second]) => (
    proposedRoleSet.has(first) && proposedRoleSet.has(second)
  ))
  if (incompatiblePairs.length > 0) {
    return {
      valid: false,
      code: "WORKFORCE_ACCESS_INCOMPATIBLE_DRAFT_ROLES",
      roles,
      incompatiblePairs,
    }
  }
  return { valid: true, roles, incompatiblePairs: [] }
}

function isActiveGrant(grant: WorkforceAccessGrant, now: Date): boolean {
  return grant.effectiveFrom <= now
    && (grant.effectiveUntil == null || now < grant.effectiveUntil)
    && (grant.revokedAt == null || now < grant.revokedAt)
}

function grantContainsResource(grant: WorkforceAccessGrant, resource: WorkforceResourceScope): boolean {
  if (grant.organizationId !== resource.organizationId) return false
  switch (grant.scope.kind) {
    case "ORGANIZATION": return true
    case "TEAM": return resource.teamId === grant.scope.teamId
    case "SITE": return resource.siteId === grant.scope.siteId
    case "AGENT": return resource.agentId === grant.scope.agentId
  }
}

/**
 * Resolves a candidate grant without accepting a broad CRM role as a hidden
 * Workforce privilege. The caller supplies the already-resolved resource
 * context; this function never looks up a live site/team and therefore cannot
 * accidentally widen an effective-dated historical decision.
 */
export function decideWorkforceAccess(input: {
  organizationId: string
  principalUserId: string
  selfAgentId: string | null
  permission: WorkforceAccessPermission
  resource: WorkforceResourceScope
  grants: readonly WorkforceAccessGrant[]
  now?: Date
}): WorkforceAccessDecision {
  if (input.organizationId !== input.resource.organizationId) {
    return { allowed: false, code: "WORKFORCE_ACCESS_SCOPE_DENIED" }
  }
  if (SELF_PERMISSIONS.has(input.permission)) {
    return input.selfAgentId != null && input.selfAgentId === input.resource.agentId
      ? { allowed: true, source: "SELF" }
      : { allowed: false, code: "WORKFORCE_ACCESS_SELF_SCOPE_DENIED" }
  }

  const now = input.now ?? new Date()
  const eligibleGrants = input.grants.filter((grant) => (
    grant.organizationId === input.organizationId
    && grant.principalUserId === input.principalUserId
    && isActiveGrant(grant, now)
    && ROLE_PERMISSIONS[grant.role].includes(input.permission)
  ))
  if (eligibleGrants.length === 0) return { allowed: false, code: "WORKFORCE_ACCESS_GRANT_UNAVAILABLE" }
  const matchedGrant = eligibleGrants.find((grant) => (
    ROLE_SCOPE_KINDS[grant.role].includes(grant.scope.kind)
    && grantContainsResource(grant, input.resource)
  ))
  if (matchedGrant) return { allowed: true, source: "GRANT", grantId: matchedGrant.id }
  if (eligibleGrants.some((grant) => !ROLE_SCOPE_KINDS[grant.role].includes(grant.scope.kind))) {
    return { allowed: false, code: "WORKFORCE_ACCESS_SCOPE_DENIED" }
  }
  return { allowed: false, code: "WORKFORCE_ACCESS_SCOPE_DENIED" }
}
