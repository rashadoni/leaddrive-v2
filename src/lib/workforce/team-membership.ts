import { Prisma, type PrismaClient } from "@prisma/client"

/**
 * Append-only team fact selected at the instant an employee's workday began.
 * A missing row is intentionally meaningful: pre-history workdays must not be
 * reinterpreted from the employee directory's mutable current team.
 */
export type WorkforceHistoricalTeamMembership = {
  id: string
  teamId: string | null
  effectiveAt: Date
}

export type WorkforceHistoricalTeamMembershipCandidate = {
  requestId: string
  agentId: string
  workdayStartedAt: Date
}

export const MAX_WORKFORCE_HISTORICAL_TEAM_MEMBERSHIP_CANDIDATES = 1_000

type WorkforceTeamMembershipDb = Pick<PrismaClient, "$queryRaw">

function validInstant(value: Date): boolean {
  return Number.isFinite(value.getTime())
}

/**
 * Locks the mutable employee directory row while reading the immutable
 * membership timeline. A concurrent transfer is therefore serialized with a
 * workday snapshot instead of quietly changing its selected team.
 */
export async function resolveWorkforceHistoricalTeamMembership(
  db: WorkforceTeamMembershipDb,
  input: { organizationId: string; agentId: string; workdayStartedAt: Date },
): Promise<WorkforceHistoricalTeamMembership | null> {
  if (!validInstant(input.workdayStartedAt)) {
    throw new Error("Workforce team membership workday start is invalid")
  }

  const rows = await db.$queryRaw<Array<{
    id: string | null
    teamId: string | null
    effectiveAt: Date | null
  }>>(Prisma.sql`
    SELECT membership."id", membership."teamId", membership."effectiveAt"
    FROM "mtm_agents" AS agent
    LEFT JOIN LATERAL (
      SELECT "id", "teamId", "effectiveAt"
      FROM "workforce_employee_team_memberships"
      WHERE "organizationId" = ${input.organizationId}
        AND "agentId" = ${input.agentId}
        AND "effectiveAt" <= ${input.workdayStartedAt}
      ORDER BY "effectiveAt" DESC, "id" DESC
      LIMIT 1
    ) AS membership ON TRUE
    WHERE agent."organizationId" = ${input.organizationId}
      AND agent."id" = ${input.agentId}
    FOR SHARE OF agent
  `)
  const row = rows[0]
  if (!row?.id || !row.effectiveAt || !validInstant(row.effectiveAt)) return null
  return { id: row.id, teamId: row.teamId, effectiveAt: row.effectiveAt }
}

/** Resolve bounded request candidates in one metadata-only historical query. */
export async function resolveWorkforceHistoricalTeamMemberships(
  db: WorkforceTeamMembershipDb,
  input: { organizationId: string; candidates: readonly WorkforceHistoricalTeamMembershipCandidate[] },
): Promise<ReadonlyMap<string, string | null>> {
  if (input.candidates.length > MAX_WORKFORCE_HISTORICAL_TEAM_MEMBERSHIP_CANDIDATES) {
    throw new Error("Workforce historical team membership batch exceeds the safe limit")
  }
  if (input.candidates.length === 0) return new Map()
  const requestIds = new Set<string>()
  const rows = input.candidates.map((candidate) => {
    if (!candidate.requestId || !candidate.agentId || !validInstant(candidate.workdayStartedAt)
      || requestIds.has(candidate.requestId)) {
      throw new Error("Workforce historical team membership candidate is invalid")
    }
    requestIds.add(candidate.requestId)
    return Prisma.sql`(${candidate.requestId}, ${candidate.agentId}, ${candidate.workdayStartedAt})`
  })

  const memberships = await db.$queryRaw<Array<{ requestId: string | null; teamId: string | null }>>(Prisma.sql`
    SELECT candidate."requestId", membership."teamId"
    FROM (VALUES ${Prisma.join(rows)}) AS candidate("requestId", "agentId", "scopeInstant")
    LEFT JOIN LATERAL (
      SELECT "teamId"
      FROM "workforce_employee_team_memberships"
      WHERE "organizationId" = ${input.organizationId}
        AND "agentId" = candidate."agentId"
        AND "effectiveAt" <= candidate."scopeInstant"
      ORDER BY "effectiveAt" DESC, "id" DESC
      LIMIT 1
    ) AS membership ON TRUE
  `)
  const result = new Map<string, string | null>()
  for (const membership of memberships) {
    if (membership.requestId && requestIds.has(membership.requestId)) {
      result.set(membership.requestId, typeof membership.teamId === "string" ? membership.teamId : null)
    }
  }
  for (const requestId of requestIds) {
    if (!result.has(requestId)) result.set(requestId, null)
  }
  return result
}
