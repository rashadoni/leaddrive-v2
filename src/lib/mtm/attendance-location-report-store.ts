import { Prisma } from "@prisma/client"
import type { AttendanceLocationReportEvidence } from "@/lib/mtm/attendance-location-report"

/** Tenant AND authorized workdays; never SELECT evidence.* or geometry. */
export async function readAttendanceLocationReportEvidence(tx: Prisma.TransactionClient, organizationId: string, workdayIds: string[]) {
  if (!workdayIds.length) return new Map<string, AttendanceLocationReportEvidence>()
  const rows = await tx.$queryRaw<AttendanceLocationReportEvidence[]>`
    SELECT m."eventId", m.action, m."claimedAt", m."serverReceivedAt", m."locationState", m."distanceMeters",
      b."branchId", b.id AS "branchRevisionId", b.name AS "branchName"
    FROM mtm_attendance_mark_evidence m
    JOIN mtm_agent_workday_events e ON e."organizationId"=m."organizationId" AND e.id=m."eventId" AND e."agentId"=m."agentId"
    LEFT JOIN mtm_attendance_branch_revisions b ON b."organizationId"=m."organizationId" AND b.id=m."branchRevisionId"
    WHERE m."organizationId"=${organizationId} AND e."workdayId"=ANY(${workdayIds}::text[])
      AND e.type IN ('START','FINISH') AND m.action=e.type::text
    ORDER BY m."eventId" LIMIT 200001`
  if (rows.length > 200000) throw new Error("MTM_ATTENDANCE_REPORT_TOO_LARGE")
  return new Map(rows.map(row => [row.eventId, row]))
}
