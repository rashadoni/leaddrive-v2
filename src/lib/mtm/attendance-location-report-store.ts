import { Prisma } from "@prisma/client"
import type { AttendanceLocationReportEvidence } from "@/lib/mtm/attendance-location-report"

/** Tenant AND authorized workdays; never SELECT evidence.* or geometry. */
export async function readAttendanceLocationReportEvidence(tx: Prisma.TransactionClient, organizationId: string, workdayIds: string[]) {
  if (!workdayIds.length) return new Map<string, AttendanceLocationReportEvidence>()
  const rows = await tx.$queryRaw<AttendanceLocationReportEvidence[]>`
    SELECT e.id AS "eventId",e.type::text AS action,COALESCE(e."claimedAt",e."occurredAt") AS "claimedAt",
      COALESCE(m."serverReceivedAt",e."serverReceivedAt") AS "serverReceivedAt",m."locationState",m."distanceMeters",
      b."branchId",b.id AS "branchRevisionId",b.name AS "branchName",q.state AS "qrState",
      qb."branchId" AS "qrBranchId",qb.id AS "qrBranchRevisionId",qb.name AS "qrBranchName"
    FROM mtm_agent_workday_events e
    LEFT JOIN mtm_attendance_mark_evidence m ON m."organizationId"=e."organizationId" AND m."eventId"=e.id AND m."agentId"=e."agentId" AND m.action=e.type::text
    LEFT JOIN mtm_attendance_branch_revisions b ON b."organizationId"=m."organizationId" AND b.id=m."branchRevisionId"
    LEFT JOIN mtm_attendance_qr_evidence q ON q."organizationId"=e."organizationId" AND q."eventId"=e.id AND q."agentId"=e."agentId" AND q.action=e.type::text
    LEFT JOIN mtm_attendance_branch_revisions qb ON qb."organizationId"=q."organizationId" AND qb.id=q."branchRevisionId"
    WHERE e."organizationId"=${organizationId} AND e."workdayId"=ANY(${workdayIds}::text[])
      AND e.type IN ('START','FINISH') AND (m.id IS NOT NULL OR q.id IS NOT NULL)
    ORDER BY e.id LIMIT 200001`
  if (rows.length > 200000) throw new Error("MTM_ATTENDANCE_REPORT_TOO_LARGE")
  return new Map(rows.map(row => [row.eventId, row]))
}
