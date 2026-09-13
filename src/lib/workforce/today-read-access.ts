import { NextResponse } from "next/server"
import {
  readPersistedWorkforceAccessGrants,
  type WorkforceAccessGrantReaderDb,
} from "@/lib/workforce/access-grant-resolution"
import { decideWorkforceAccess } from "@/lib/workforce/access-control"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"

export type WorkforceTodayReadCandidate = {
  id: string
  teamId: string | null
}

function todayReadDenied(): NextResponse {
  // A missing, revoked, incompatible or differently scoped grant must not
  // reveal whether the tenant currently has any other active employee.
  return NextResponse.json({
    error: "This Workforce Today view requires an effective worktime-read grant.",
    code: "WORKFORCE_TODAY_READ_ACCESS_REQUIRED",
  }, { status: 403 })
}

function todayReadUnavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to verify Workforce Today access.",
    code: "WORKFORCE_TODAY_READ_ACCESS_UNAVAILABLE",
  }, { status: 503 })
}

/**
 * Controlled C7 fence for the current-day Workforce read model.
 *
 * The candidate query supplies only current active employee IDs and team IDs;
 * it intentionally contains no names, workday facts, calendar data or
 * location/evidence. The bounded persisted-grant snapshot is then reused for
 * every candidate, preventing an N+1 grant lookup and a growing revocation
 * race. TEAM scope is valid for this current-day model because its resource
 * explicitly carries the current team ID. A site scope is not inferred from a
 * mutable schedule or presence claim, so it fails closed until a separately
 * reviewed current-site resolver exists.
 */
export async function requireWorkforceTodayReadAccess(input: {
  db: WorkforceAccessGrantReaderDb
  organizationId: string
  organizationFeatures: unknown
  principalUserId: string
  selfAgentId: string | null
  candidates: readonly WorkforceTodayReadCandidate[]
}): Promise<{ agentIds: readonly string[] } | Response> {
  if (!workforceGranularAccessEnabled(input.organizationFeatures)) {
    return { agentIds: input.candidates.map((candidate) => candidate.id) }
  }

  try {
    const grants = await readPersistedWorkforceAccessGrants({
      db: input.db,
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
    })
    if (!grants) return todayReadUnavailable()

    const agentIds = input.candidates.flatMap((candidate) => {
      const resource = {
        organizationId: input.organizationId,
        agentId: candidate.id,
        ...(candidate.teamId == null ? {} : { teamId: candidate.teamId }),
      }
      const self = decideWorkforceAccess({
        organizationId: input.organizationId,
        principalUserId: input.principalUserId,
        selfAgentId: input.selfAgentId,
        permission: "SELF_WORKTIME_READ",
        resource,
        grants,
      })
      if (self.allowed) return [candidate.id]

      const attendance = decideWorkforceAccess({
        organizationId: input.organizationId,
        principalUserId: input.principalUserId,
        selfAgentId: null,
        permission: "TEAM_ATTENDANCE_READ",
        resource,
        grants,
      })
      return attendance.allowed ? [candidate.id] : []
    })
    return agentIds.length > 0 ? { agentIds } : todayReadDenied()
  } catch (error) {
    console.error("[workforce/today] authorization lookup failed", error)
    return todayReadUnavailable()
  }
}
