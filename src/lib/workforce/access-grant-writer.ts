import {
  createWorkforceAccessGrantDraft,
  createWorkforceAccessGrantRevocationDraft,
  type WorkforceAccessGrantDraft,
  type WorkforceAccessGrantRevocationDraft,
} from "@/lib/workforce/access-grant-ledger"

/**
 * Transaction-scoped persistence primitives for the C7 role ledger. Callers
 * must pass already-resolved authorization, a tenant-scoped transaction client
 * and stay behind the explicit granular-access rollout fence. The writer never
 * supplies a legacy-role fallback or grants authority by itself.
 */

type WorkforceAccessGrantWriteData = {
  organizationId: string
  principalUserId: string
  operationId: string
  role: WorkforceAccessGrantDraft["role"]
  scopeKind: WorkforceAccessGrantDraft["scope"]["kind"]
  scopeTeamId: string | null
  scopeSiteId: string | null
  scopeAgentId: string | null
  effectiveFrom: Date
  effectiveUntil: Date | null
  grantedByUserId: string
  grantReasonCode: string
}

type WorkforceAccessGrantStored = WorkforceAccessGrantWriteData & { id: string }

type WorkforceAccessGrantRevocationWriteData = {
  organizationId: string
  grantId: string
  operationId: string
  revokedByUserId: string
  revocationReasonCode: string
  revokedAt: Date
}

type WorkforceAccessGrantRevocationStored = WorkforceAccessGrantRevocationWriteData & { id: string }

export type WorkforceAccessGrantWriterDb = {
  $executeRaw: (query: TemplateStringsArray, ...values: readonly unknown[]) => Promise<unknown>
  workforceAccessGrant: {
    create: (args: { data: WorkforceAccessGrantWriteData }) => Promise<WorkforceAccessGrantStored>
    findFirst: (args: {
      where: { organizationId: string; operationId?: string; id?: string }
      select: Record<string, true>
    }) => Promise<WorkforceAccessGrantStored | null>
  }
  workforceAccessGrantRevocation: {
    create: (args: { data: WorkforceAccessGrantRevocationWriteData }) => Promise<WorkforceAccessGrantRevocationStored>
    findFirst: (args: {
      where: { organizationId: string; operationId: string }
      select: Record<string, true>
    }) => Promise<WorkforceAccessGrantRevocationStored | null>
  }
  mtmAuditLog: {
    create: (args: {
      data: {
        organizationId: string
        agentId: null
        action: string
        entity: string
        entityId: string
        metadataKind: string
        newData: Record<string, unknown>
        ipAddress: string | null
        userAgent: string | null
      }
    }) => Promise<unknown>
  }
}

export type WorkforceAccessGrantAuthorization = (input: {
  operation: "GRANT" | "REVOKE"
  organizationId: string
  actorUserId: string
}) => boolean | Promise<boolean>

export type WorkforceAccessGrantAuditContext = {
  ipAddress: string | null
  userAgent: string | null
}

export class WorkforceAccessGrantWriterError extends Error {
  constructor(readonly code:
    | "WORKFORCE_ACCESS_GRANT_NOT_AUTHORIZED"
    | "WORKFORCE_ACCESS_GRANT_WRITE_CONFLICT"
    | "WORKFORCE_ACCESS_REVOCATION_GRANT_NOT_FOUND"
    | "WORKFORCE_ACCESS_REVOCATION_GRANT_MISMATCH"
    | "WORKFORCE_ACCESS_REVOCATION_WRITE_CONFLICT") {
    super(code)
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002"
}

function grantLockKey(organizationId: string, principalUserId: string): string {
  return `workforce-access-grant:${organizationId}:${principalUserId}`
}

function canonicalGrant(draft: WorkforceAccessGrantDraft): WorkforceAccessGrantDraft {
  return createWorkforceAccessGrantDraft({
    organizationId: draft.organizationId,
    principalUserId: draft.principalUserId,
    operationId: draft.operationId,
    role: draft.role,
    scope: draft.scope,
    effectiveFrom: draft.effectiveFrom,
    effectiveUntil: draft.effectiveUntil,
    grantedByUserId: draft.grantedByUserId,
    grantReasonCode: draft.grantReasonCode,
  })
}

function canonicalRevocation(draft: WorkforceAccessGrantRevocationDraft): WorkforceAccessGrantRevocationDraft {
  return createWorkforceAccessGrantRevocationDraft({
    organizationId: draft.organizationId,
    grantId: draft.grantId,
    operationId: draft.operationId,
    grantEffectiveFrom: draft.grantEffectiveFrom,
    revokedByUserId: draft.revokedByUserId,
    revocationReasonCode: draft.revocationReasonCode,
    revokedAt: draft.revokedAt,
  })
}

function grantWriteData(draft: WorkforceAccessGrantDraft): WorkforceAccessGrantWriteData {
  const scope = draft.scope
  return {
    organizationId: draft.organizationId,
    principalUserId: draft.principalUserId,
    operationId: draft.operationId,
    role: draft.role,
    scopeKind: scope.kind,
    scopeTeamId: scope.kind === "TEAM" ? scope.teamId : null,
    scopeSiteId: scope.kind === "SITE" ? scope.siteId : null,
    scopeAgentId: scope.kind === "AGENT" ? scope.agentId : null,
    effectiveFrom: draft.effectiveFrom,
    effectiveUntil: draft.effectiveUntil,
    grantedByUserId: draft.grantedByUserId,
    grantReasonCode: draft.grantReasonCode,
  }
}

function sameGrant(left: WorkforceAccessGrantStored, right: WorkforceAccessGrantWriteData): boolean {
  return left.organizationId === right.organizationId
    && left.principalUserId === right.principalUserId
    && left.operationId === right.operationId
    && left.role === right.role
    && left.scopeKind === right.scopeKind
    && left.scopeTeamId === right.scopeTeamId
    && left.scopeSiteId === right.scopeSiteId
    && left.scopeAgentId === right.scopeAgentId
    && left.effectiveFrom.getTime() === right.effectiveFrom.getTime()
    && left.effectiveUntil?.getTime() === right.effectiveUntil?.getTime()
    && left.grantedByUserId === right.grantedByUserId
    && left.grantReasonCode === right.grantReasonCode
}

function revocationWriteData(draft: WorkforceAccessGrantRevocationDraft): WorkforceAccessGrantRevocationWriteData {
  return {
    organizationId: draft.organizationId,
    grantId: draft.grantId,
    operationId: draft.operationId,
    revokedByUserId: draft.revokedByUserId,
    revocationReasonCode: draft.revocationReasonCode,
    revokedAt: draft.revokedAt,
  }
}

function sameRevocation(left: WorkforceAccessGrantRevocationStored, right: WorkforceAccessGrantRevocationWriteData): boolean {
  return left.organizationId === right.organizationId
    && left.grantId === right.grantId
    && left.operationId === right.operationId
    && left.revokedByUserId === right.revokedByUserId
    && left.revocationReasonCode === right.revocationReasonCode
    && left.revokedAt.getTime() === right.revokedAt.getTime()
}

async function requireAuthorization(input: {
  authorize: WorkforceAccessGrantAuthorization
  operation: "GRANT" | "REVOKE"
  organizationId: string
  actorUserId: string
}): Promise<void> {
  if (!await input.authorize({
    operation: input.operation,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
  })) {
    throw new WorkforceAccessGrantWriterError("WORKFORCE_ACCESS_GRANT_NOT_AUTHORIZED")
  }
}

const GRANT_SELECT = {
  id: true,
  organizationId: true,
  principalUserId: true,
  operationId: true,
  role: true,
  scopeKind: true,
  scopeTeamId: true,
  scopeSiteId: true,
  scopeAgentId: true,
  effectiveFrom: true,
  effectiveUntil: true,
  grantedByUserId: true,
  grantReasonCode: true,
} as const

const REVOCATION_SELECT = {
  id: true,
  organizationId: true,
  grantId: true,
  operationId: true,
  revokedByUserId: true,
  revocationReasonCode: true,
  revokedAt: true,
} as const

/**
 * Inserts one immutable grant after a caller confirms the actor's authority.
 * The advisory transaction lock serializes grants for one tenant principal,
 * closing the read-committed race between otherwise incompatible roles. The
 * database trigger remains the final durable defence.
 */
export async function persistAuthorizedWorkforceAccessGrant(input: {
  db: WorkforceAccessGrantWriterDb
  draft: WorkforceAccessGrantDraft
  authorize: WorkforceAccessGrantAuthorization
  audit?: WorkforceAccessGrantAuditContext
}): Promise<{ grantId: string; idempotent: boolean }> {
  const draft = canonicalGrant(input.draft)
  await requireAuthorization({
    authorize: input.authorize,
    operation: "GRANT",
    organizationId: draft.organizationId,
    actorUserId: draft.grantedByUserId,
  })
  await input.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${grantLockKey(draft.organizationId, draft.principalUserId)}))`
  const data = grantWriteData(draft)
  try {
    const created = await input.db.workforceAccessGrant.create({ data })
    await input.db.mtmAuditLog.create({
      data: {
        organizationId: draft.organizationId,
        agentId: null,
        action: "WORKFORCE_ACCESS_GRANT_RECORDED",
        entity: "workforce_access_grant",
        entityId: created.id,
        metadataKind: "workforce_access_control",
        newData: {
          operationId: draft.operationId,
          principalUserId: draft.principalUserId,
          role: draft.role,
          scope: draft.scope,
          effectiveFrom: draft.effectiveFrom.toISOString(),
          effectiveUntil: draft.effectiveUntil?.toISOString() ?? null,
          grantReasonCode: draft.grantReasonCode,
        },
        ipAddress: input.audit?.ipAddress ?? null,
        userAgent: input.audit?.userAgent ?? null,
      },
    })
    return { grantId: created.id, idempotent: false }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const existing = await input.db.workforceAccessGrant.findFirst({
      where: { organizationId: draft.organizationId, operationId: draft.operationId },
      select: GRANT_SELECT,
    })
    if (existing && sameGrant(existing, data)) return { grantId: existing.id, idempotent: true }
    throw new WorkforceAccessGrantWriterError("WORKFORCE_ACCESS_GRANT_WRITE_CONFLICT")
  }
}

/**
 * Appends one immutable revocation after verifying the exact persisted grant
 * start. It never updates a grant, invents an end time, or accepts a caller's
 * stale/mismatched grant identity.
 */
export async function appendAuthorizedWorkforceAccessGrantRevocation(input: {
  db: WorkforceAccessGrantWriterDb
  draft: WorkforceAccessGrantRevocationDraft
  authorize: WorkforceAccessGrantAuthorization
  audit?: WorkforceAccessGrantAuditContext
}): Promise<{ revocationId: string; idempotent: boolean }> {
  const draft = canonicalRevocation(input.draft)
  await requireAuthorization({
    authorize: input.authorize,
    operation: "REVOKE",
    organizationId: draft.organizationId,
    actorUserId: draft.revokedByUserId,
  })
  const grant = await input.db.workforceAccessGrant.findFirst({
    where: { organizationId: draft.organizationId, id: draft.grantId },
    select: GRANT_SELECT,
  })
  if (!grant) throw new WorkforceAccessGrantWriterError("WORKFORCE_ACCESS_REVOCATION_GRANT_NOT_FOUND")
  if (grant.effectiveFrom.getTime() !== draft.grantEffectiveFrom.getTime()) {
    throw new WorkforceAccessGrantWriterError("WORKFORCE_ACCESS_REVOCATION_GRANT_MISMATCH")
  }
  await input.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${grantLockKey(draft.organizationId, grant.principalUserId)}))`
  const data = revocationWriteData(draft)
  try {
    const created = await input.db.workforceAccessGrantRevocation.create({ data })
    await input.db.mtmAuditLog.create({
      data: {
        organizationId: draft.organizationId,
        agentId: null,
        action: "WORKFORCE_ACCESS_GRANT_REVOKED",
        entity: "workforce_access_grant_revocation",
        entityId: created.id,
        metadataKind: "workforce_access_control",
        newData: {
          operationId: draft.operationId,
          grantId: draft.grantId,
          revokedAt: draft.revokedAt.toISOString(),
          revocationReasonCode: draft.revocationReasonCode,
        },
        ipAddress: input.audit?.ipAddress ?? null,
        userAgent: input.audit?.userAgent ?? null,
      },
    })
    return { revocationId: created.id, idempotent: false }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const existing = await input.db.workforceAccessGrantRevocation.findFirst({
      where: { organizationId: draft.organizationId, operationId: draft.operationId },
      select: REVOCATION_SELECT,
    })
    if (existing && sameRevocation(existing, data)) return { revocationId: existing.id, idempotent: true }
    throw new WorkforceAccessGrantWriterError("WORKFORCE_ACCESS_REVOCATION_WRITE_CONFLICT")
  }
}
