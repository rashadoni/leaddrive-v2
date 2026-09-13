import { NextResponse } from "next/server"
import {
  decidePersistedWorkforceAccess,
  type WorkforceAccessGrantReaderDb,
} from "@/lib/workforce/access-grant-resolution"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"

function timesheetReadDenied(): NextResponse {
  // A missing, revoked, incorrectly scoped or otherwise unavailable grant is
  // intentionally one result. The timesheet boundary must not be a grant or
  // employee-directory oracle.
  return NextResponse.json({
    error: "This Workforce timesheet requires an effective attendance-read grant.",
    code: "WORKFORCE_TIMESHEET_READ_ACCESS_REQUIRED",
  }, { status: 403 })
}

function timesheetReadUnavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to verify Workforce timesheet access.",
    code: "WORKFORCE_TIMESHEET_READ_ACCESS_UNAVAILABLE",
  }, { status: 503 })
}

/**
 * Controlled C7 fence for the Workforce browser timesheet.
 *
 * A selected employee can use the exact self read boundary or an
 * organization/exact-agent attendance grant. An unselected all-personnel
 * grid needs an organization grant. A current team/site must not stand in for
 * historical timesheet scope: a later indexed historical resolver can add
 * that capability without silently widening this first rollout.
 */
export async function requireWorkforceTimesheetReadAccess(input: {
  db: WorkforceAccessGrantReaderDb
  organizationId: string
  organizationFeatures: unknown
  principalUserId: string
  selfAgentId: string | null
  selectedAgentId: string | null
}): Promise<Response | null> {
  if (!workforceGranularAccessEnabled(input.organizationFeatures)) return null

  if (input.selectedAgentId != null && input.selectedAgentId === input.selfAgentId) {
    return null
  }

  try {
    const access = await decidePersistedWorkforceAccess({
      db: input.db,
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
      selfAgentId: null,
      permission: "TEAM_ATTENDANCE_READ",
      resource: {
        organizationId: input.organizationId,
        ...(input.selectedAgentId == null ? {} : { agentId: input.selectedAgentId }),
      },
    })
    return access.allowed ? null : timesheetReadDenied()
  } catch (error) {
    console.error("[workforce/timesheet] authorization lookup failed", error)
    return timesheetReadUnavailable()
  }
}
