import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireAttendanceSelf, type AttendanceSelf } from "@/lib/mtm/attendance-self-access"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"

const LOCATION_STATES = ["INSIDE", "OUTSIDE", "UNCERTAIN", "UNCONFIGURED", "UNAVAILABLE", "NO_CONSENT"] as const
export type OwnAttendanceMarkRow = {
  eventId: string; action: string; claimedAt: Date; serverReceivedAt: Date | null
  locationState: string | null; latitude: number | null; longitude: number | null; accuracy: number | null
  fixCapturedAt: Date | null; branchName: string | null; distanceMeters: number | null
  qrState: string | null; qrBranchName: string | null; openCases: number; closedCases: number
}
/** Only one's own recorded START/FINISH evidence. This is a historical read;
 * it does not take a new GPS fix, infer presence or disclose installation IDs. */
export function ownAttendanceMark(row: OwnAttendanceMarkRow) {
  const endpoint = row.action === "START" || row.action === "FINISH"
  const state = endpoint && LOCATION_STATES.includes(row.locationState as typeof LOCATION_STATES[number]) ? row.locationState as typeof LOCATION_STATES[number] : "NOT_RECORDED"
  const measured = ["INSIDE", "OUTSIDE", "UNCERTAIN", "UNCONFIGURED"].includes(state)
  const coordinates = measured && typeof row.latitude === "number" && Number.isFinite(row.latitude) && Math.abs(row.latitude) <= 90
    && typeof row.longitude === "number" && Number.isFinite(row.longitude) && Math.abs(row.longitude) <= 180
    ? { latitude: row.latitude, longitude: row.longitude } : null
  const number = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? value : null
  const branchName = measured ? row.branchName : null
  const qrState = endpoint && ["VERIFIED", "NOT_PROVIDED", "EXPIRED", "INVALID", "BRANCH_CHANGED", "REUSED"].includes(row.qrState ?? "") ? row.qrState : null
  return {
    eventId: row.eventId, action: row.action, claimedAt: row.claimedAt.toISOString(), serverReceivedAt: row.serverReceivedAt?.toISOString() ?? null,
    location: { state, coordinates, accuracyMeters: coordinates ? number(row.accuracy) : null,
      capturedAt: coordinates ? row.fixCapturedAt?.toISOString() ?? null : null, branchName, distanceMeters: branchName ? number(row.distanceMeters) : null },
    qr: qrState ? { state: qrState, branchName: qrState === "VERIFIED" ? row.qrBranchName : null } : null,
    review: { openCases: Math.max(0, row.openCases), closedCases: Math.max(0, row.closedCases) },
  }
}

export async function readOwnAttendanceMarks(self: AttendanceSelf, workdayId: string) {
  if (!workdayId || workdayId.length > 191) throw new AttendanceRequestError("MTM_ATTENDANCE_MARKS_QUERY_INVALID", 400)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const timezone = await requireAttendanceSelf(tx, self)
    const day = await tx.mtmAgentWorkday.findFirst({ where: { id: workdayId, organizationId: self.organizationId, agentId: self.agentId }, select: { id: true, workDate: true } })
    if (!day) throw new AttendanceRequestError("MTM_ATTENDANCE_MARKS_NOT_FOUND", 404)
    const rows = await tx.$queryRaw<OwnAttendanceMarkRow[]>`
      SELECT e.id AS "eventId",e.type::text AS action,COALESCE(e."claimedAt",e."occurredAt") AS "claimedAt",e."serverReceivedAt",
        m."locationState",m.latitude,m.longitude,m.accuracy,m."fixCapturedAt",m."distanceMeters",b.name AS "branchName",
        q.state AS "qrState",qb.name AS "qrBranchName",
        (SELECT count(*)::int FROM mtm_attendance_risk_cases c WHERE c."organizationId"=e."organizationId" AND c."agentId"=e."agentId" AND c."eventId"=e.id
          AND NOT EXISTS (SELECT 1 FROM mtm_attendance_risk_decisions d WHERE d."organizationId"=c."organizationId" AND d."caseId"=c.id)) AS "openCases",
        (SELECT count(*)::int FROM mtm_attendance_risk_cases c WHERE c."organizationId"=e."organizationId" AND c."agentId"=e."agentId" AND c."eventId"=e.id
          AND EXISTS (SELECT 1 FROM mtm_attendance_risk_decisions d WHERE d."organizationId"=c."organizationId" AND d."caseId"=c.id)) AS "closedCases"
      FROM mtm_agent_workday_events e
      LEFT JOIN mtm_attendance_mark_evidence m ON m."organizationId"=e."organizationId" AND m."agentId"=e."agentId" AND m."eventId"=e.id
        AND m.action=e.type::text AND m."claimedAt"=COALESCE(e."claimedAt",e."occurredAt") AND e.type IN ('START','FINISH')
      LEFT JOIN mtm_attendance_branch_revisions b ON b."organizationId"=m."organizationId" AND b.id=m."branchRevisionId"
      LEFT JOIN mtm_attendance_qr_evidence q ON q."organizationId"=e."organizationId" AND q."agentId"=e."agentId" AND q."eventId"=e.id AND q.action=e.type::text AND e.type IN ('START','FINISH')
      LEFT JOIN mtm_attendance_branch_revisions qb ON qb."organizationId"=q."organizationId" AND qb.id=q."branchRevisionId"
      WHERE e."organizationId"=${self.organizationId} AND e."agentId"=${self.agentId} AND e."workdayId"=${day.id}
        AND e.type IN ('START','PAUSE','RESUME','FINISH')
      ORDER BY e."serverReceivedAt" DESC NULLS LAST,e.id DESC LIMIT 65`
    return { workdayId: day.id, workDate: day.workDate.toISOString().slice(0, 10), timezone,
      updatedAt: new Date().toISOString(), hasMore: rows.length > 64, items: rows.slice(0, 64).reverse().map(ownAttendanceMark) }
  }, { isolationLevel: "RepeatableRead", timeout: 15000 })
}
