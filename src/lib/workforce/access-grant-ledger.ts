import {
  WORKFORCE_ACCESS_ROLES,
  workforceRoleScopeKinds,
  type WorkforceAccessRole,
  type WorkforceAccessScope,
} from "@/lib/workforce/access-control"

/**
 * Strict, persistence-free drafts for the future C7 grant service. Creating a
 * draft does not grant access: the later service must authorize the actor,
 * transactionally insert it and place the tenant behind its rollout fence.
 */

export type WorkforceAccessGrantDraft = {
  organizationId: string
  principalUserId: string
  role: WorkforceAccessRole
  scope: WorkforceAccessScope
  effectiveFrom: Date
  effectiveUntil: Date | null
  grantedByUserId: string
  grantReasonCode: string
}

export type WorkforceAccessGrantRevocationDraft = {
  organizationId: string
  grantId: string
  revokedByUserId: string
  revocationReasonCode: string
  revokedAt: Date
}

export class WorkforceAccessGrantLedgerError extends Error {
  constructor(readonly code: "WORKFORCE_ACCESS_GRANT_INPUT_INVALID" | "WORKFORCE_ACCESS_REVOCATION_INPUT_INVALID") {
    super(code)
  }
}

const REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/

function opaqueId(value: unknown, code: WorkforceAccessGrantLedgerError["code"]): string {
  if (typeof value !== "string" || !value.trim() || value.length > 191 || /[\u0000-\u001f]/.test(value)) {
    throw new WorkforceAccessGrantLedgerError(code)
  }
  return value
}

function canonicalRole(value: unknown): WorkforceAccessRole {
  if (typeof value !== "string" || !WORKFORCE_ACCESS_ROLES.includes(value as WorkforceAccessRole)) {
    throw new WorkforceAccessGrantLedgerError("WORKFORCE_ACCESS_GRANT_INPUT_INVALID")
  }
  return value as WorkforceAccessRole
}

function canonicalInstant(value: unknown, code: WorkforceAccessGrantLedgerError["code"]): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new WorkforceAccessGrantLedgerError(code)
  }
  return new Date(value.getTime())
}

function canonicalReasonCode(value: unknown, code: WorkforceAccessGrantLedgerError["code"]): string {
  if (typeof value !== "string" || !REASON_CODE.test(value)) {
    throw new WorkforceAccessGrantLedgerError(code)
  }
  return value
}

function canonicalScope(value: unknown): WorkforceAccessScope {
  if (!value || typeof value !== "object" || !("kind" in value)) {
    throw new WorkforceAccessGrantLedgerError("WORKFORCE_ACCESS_GRANT_INPUT_INVALID")
  }
  const scope = value as Record<string, unknown>
  switch (scope.kind) {
    case "ORGANIZATION":
      if (Object.keys(scope).length !== 1) break
      return { kind: "ORGANIZATION" }
    case "TEAM":
      if (Object.keys(scope).length !== 2) break
      return { kind: "TEAM", teamId: opaqueId(scope.teamId, "WORKFORCE_ACCESS_GRANT_INPUT_INVALID") }
    case "SITE":
      if (Object.keys(scope).length !== 2) break
      return { kind: "SITE", siteId: opaqueId(scope.siteId, "WORKFORCE_ACCESS_GRANT_INPUT_INVALID") }
    case "AGENT":
      if (Object.keys(scope).length !== 2) break
      return { kind: "AGENT", agentId: opaqueId(scope.agentId, "WORKFORCE_ACCESS_GRANT_INPUT_INVALID") }
  }
  throw new WorkforceAccessGrantLedgerError("WORKFORCE_ACCESS_GRANT_INPUT_INVALID")
}

export function createWorkforceAccessGrantDraft(input: {
  organizationId: unknown
  principalUserId: unknown
  role: unknown
  scope: unknown
  effectiveFrom: unknown
  effectiveUntil?: unknown
  grantedByUserId: unknown
  grantReasonCode: unknown
}): WorkforceAccessGrantDraft {
  const role = canonicalRole(input.role)
  const scope = canonicalScope(input.scope)
  if (!workforceRoleScopeKinds(role).includes(scope.kind)) {
    throw new WorkforceAccessGrantLedgerError("WORKFORCE_ACCESS_GRANT_INPUT_INVALID")
  }
  const effectiveFrom = canonicalInstant(input.effectiveFrom, "WORKFORCE_ACCESS_GRANT_INPUT_INVALID")
  const effectiveUntil = input.effectiveUntil == null
    ? null
    : canonicalInstant(input.effectiveUntil, "WORKFORCE_ACCESS_GRANT_INPUT_INVALID")
  if (effectiveUntil != null && effectiveUntil <= effectiveFrom) {
    throw new WorkforceAccessGrantLedgerError("WORKFORCE_ACCESS_GRANT_INPUT_INVALID")
  }
  return {
    organizationId: opaqueId(input.organizationId, "WORKFORCE_ACCESS_GRANT_INPUT_INVALID"),
    principalUserId: opaqueId(input.principalUserId, "WORKFORCE_ACCESS_GRANT_INPUT_INVALID"),
    role,
    scope,
    effectiveFrom,
    effectiveUntil,
    grantedByUserId: opaqueId(input.grantedByUserId, "WORKFORCE_ACCESS_GRANT_INPUT_INVALID"),
    grantReasonCode: canonicalReasonCode(input.grantReasonCode, "WORKFORCE_ACCESS_GRANT_INPUT_INVALID"),
  }
}

export function createWorkforceAccessGrantRevocationDraft(input: {
  organizationId: unknown
  grantId: unknown
  grantEffectiveFrom: unknown
  revokedByUserId: unknown
  revocationReasonCode: unknown
  revokedAt: unknown
}): WorkforceAccessGrantRevocationDraft {
  const grantEffectiveFrom = canonicalInstant(input.grantEffectiveFrom, "WORKFORCE_ACCESS_REVOCATION_INPUT_INVALID")
  const revokedAt = canonicalInstant(input.revokedAt, "WORKFORCE_ACCESS_REVOCATION_INPUT_INVALID")
  if (revokedAt < grantEffectiveFrom) {
    throw new WorkforceAccessGrantLedgerError("WORKFORCE_ACCESS_REVOCATION_INPUT_INVALID")
  }
  return {
    organizationId: opaqueId(input.organizationId, "WORKFORCE_ACCESS_REVOCATION_INPUT_INVALID"),
    grantId: opaqueId(input.grantId, "WORKFORCE_ACCESS_REVOCATION_INPUT_INVALID"),
    revokedByUserId: opaqueId(input.revokedByUserId, "WORKFORCE_ACCESS_REVOCATION_INPUT_INVALID"),
    revocationReasonCode: canonicalReasonCode(input.revocationReasonCode, "WORKFORCE_ACCESS_REVOCATION_INPUT_INVALID"),
    revokedAt,
  }
}
