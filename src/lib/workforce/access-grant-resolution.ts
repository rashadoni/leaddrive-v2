import {
  decideWorkforceAccess,
  type WorkforceAccessDecision,
  type WorkforceAccessGrant,
  type WorkforceAccessPermission,
  type WorkforceAccessScope,
  type WorkforceResourceScope,
} from "@/lib/workforce/access-control"

const MAX_ACTIVE_GRANTS = 200

type PersistedWorkforceAccessGrant = {
  id: string
  organizationId: string
  principalUserId: string
  role: string
  scopeKind: string
  scopeTeamId: string | null
  scopeSiteId: string | null
  scopeAgentId: string | null
  effectiveFrom: Date
  effectiveUntil: Date | null
  revocation: { revokedAt: Date } | null
}

export type WorkforceAccessGrantReaderDb = {
  workforceAccessGrant: {
    findMany: (args: {
      where: {
        organizationId: string
        principalUserId: string
        effectiveFrom: { lte: Date }
        OR: readonly [{ effectiveUntil: null }, { effectiveUntil: { gt: Date } }]
      }
      orderBy: readonly [{ effectiveFrom: "desc" }, { id: "desc" }]
      take: number
      select: Record<string, unknown>
    }) => Promise<readonly PersistedWorkforceAccessGrant[]>
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value)
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

/**
 * Converts a dormant durable grant row into the pure C7 evaluator input. Any
 * malformed scope is discarded, rather than widened to an organization grant.
 */
function scopeFromStored(row: PersistedWorkforceAccessGrant): WorkforceAccessScope | null {
  if (row.scopeKind === "ORGANIZATION") {
    return row.scopeTeamId == null && row.scopeSiteId == null && row.scopeAgentId == null
      ? { kind: "ORGANIZATION" }
      : null
  }
  if (row.scopeKind === "TEAM" && validIdentifier(row.scopeTeamId)
    && row.scopeSiteId == null && row.scopeAgentId == null) {
    return { kind: "TEAM", teamId: row.scopeTeamId }
  }
  if (row.scopeKind === "SITE" && validIdentifier(row.scopeSiteId)
    && row.scopeTeamId == null && row.scopeAgentId == null) {
    return { kind: "SITE", siteId: row.scopeSiteId }
  }
  if (row.scopeKind === "AGENT" && validIdentifier(row.scopeAgentId)
    && row.scopeTeamId == null && row.scopeSiteId == null) {
    return { kind: "AGENT", agentId: row.scopeAgentId }
  }
  return null
}

function grantFromStored(row: PersistedWorkforceAccessGrant): WorkforceAccessGrant | null {
  const scope = scopeFromStored(row)
  if (!scope || !validIdentifier(row.id) || !validIdentifier(row.organizationId)
    || !validIdentifier(row.principalUserId) || !validDate(row.effectiveFrom)
    || (row.effectiveUntil != null && !validDate(row.effectiveUntil))
    || (row.revocation != null && !validDate(row.revocation.revokedAt))) {
    return null
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    principalUserId: row.principalUserId,
    role: row.role as WorkforceAccessGrant["role"],
    scope,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    revokedAt: row.revocation?.revokedAt ?? null,
  }
}

/**
 * Reads one bounded, current authority snapshot. Callers that must evaluate a
 * proposed role set reuse this projection instead of issuing per-role reads.
 * `null` means the input or stored authority set was unsafe to evaluate.
 */
export async function readPersistedWorkforceAccessGrants(input: {
  db: WorkforceAccessGrantReaderDb
  organizationId: string
  principalUserId: string
  now?: Date
}): Promise<readonly WorkforceAccessGrant[] | null> {
  const now = input.now ?? new Date()
  if (!validDate(now) || !validIdentifier(input.organizationId) || !validIdentifier(input.principalUserId)) {
    return null
  }
  const rows = await input.db.workforceAccessGrant.findMany({
    where: {
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
      effectiveFrom: { lte: now },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    take: MAX_ACTIVE_GRANTS + 1,
    select: {
      id: true,
      organizationId: true,
      principalUserId: true,
      role: true,
      scopeKind: true,
      scopeTeamId: true,
      scopeSiteId: true,
      scopeAgentId: true,
      effectiveFrom: true,
      effectiveUntil: true,
      revocation: { select: { revokedAt: true } },
    },
  })
  if (rows.length > MAX_ACTIVE_GRANTS) return null
  return rows.map(grantFromStored).filter((grant): grant is WorkforceAccessGrant => grant != null)
}

/**
 * Reads only bounded, currently-effective grants for an already-resolved
 * Workforce resource. It has no fallback to a CRM/session role: until C7
 * grants are deliberately rolled out, every privileged caller is denied.
 */
export async function decidePersistedWorkforceAccess(input: {
  db: WorkforceAccessGrantReaderDb
  organizationId: string
  principalUserId: string
  selfAgentId: string | null
  permission: WorkforceAccessPermission
  resource: WorkforceResourceScope
  now?: Date
}): Promise<WorkforceAccessDecision> {
  const now = input.now ?? new Date()
  const grants = await readPersistedWorkforceAccessGrants({
    db: input.db,
    organizationId: input.organizationId,
    principalUserId: input.principalUserId,
    now,
  })
  if (!grants) return { allowed: false, code: "WORKFORCE_ACCESS_GRANT_UNAVAILABLE" }
  return decideWorkforceAccess({
    organizationId: input.organizationId,
    principalUserId: input.principalUserId,
    selfAgentId: input.selfAgentId,
    permission: input.permission,
    resource: input.resource,
    grants,
    now,
  })
}
