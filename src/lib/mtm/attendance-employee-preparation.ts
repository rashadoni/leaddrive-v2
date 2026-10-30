import type { Prisma } from "@prisma/client"

export type AttendanceEmployeePreparation = {
  checkedAt: string; date: string
  login: "AVAILABLE" | "ACCOUNT_MISSING" | "INACTIVE" | "CONTACT_MISSING"
  schedule: "SHIFT" | "COMPANY" | "DEFAULT"
  branch: { name: string; active: boolean } | null
  installations: { required: boolean; approved: number; pending: number }
}
type PreparationRow = {
  companySchedule: boolean; shiftSchedule: boolean; branchName: string | null; branchActive: boolean | null
  approvalRequired: boolean; approved: number; pending: number
}
type Card = { status: string; phone: string | null; email?: string | null; user: { isActive: boolean; phone: string | null; email?: string | null } | null }

/** Internal to the already-authorized, repeatable-read employee detail. These
 * are configuration facts, not a promise that the phone/SMS/GPS works. */
export async function readAttendanceEmployeePreparation(tx: Prisma.TransactionClient, scope: { organizationId: string; agentId: string; date: string }, card: Card, now: Date): Promise<AttendanceEmployeePreparation> {
  const { organizationId, agentId, date } = scope
  const [row] = await tx.$queryRaw<PreparationRow[]>`
    WITH scope AS (SELECT ${organizationId}::text AS org,${agentId}::text AS agent,${date}::date AS day),
    primary_branch AS (
      SELECT p."branchId" FROM mtm_attendance_primary_branch_revisions p,scope s
      WHERE p."organizationId"=s.org AND p."agentId"=s.agent ORDER BY p.version DESC LIMIT 1
    ), branch AS (
      SELECT b.name,b.active FROM mtm_attendance_branch_revisions b,scope s,primary_branch p
      WHERE b."organizationId"=s.org AND b."branchId"=p."branchId" ORDER BY b.version DESC LIMIT 1
    ), latest_installation AS (
      SELECT DISTINCT ON (r."installationId") r.id,r."organizationId" FROM mtm_attendance_installation_requests r,scope s
      WHERE r."organizationId"=s.org AND r."agentId"=s.agent ORDER BY r."installationId",r."submittedAt" DESC,r.id DESC
    ), installations AS (
      SELECT count(*) FILTER (WHERE d.action='APPROVE' AND v.id IS NULL)::int AS approved,
        count(*) FILTER (WHERE d.id IS NULL)::int AS pending
      FROM latest_installation r
      LEFT JOIN mtm_attendance_installation_decisions d ON d."organizationId"=r."organizationId" AND d."installationRequestId"=r.id
      LEFT JOIN mtm_attendance_installation_revocations v ON v."organizationId"=d."organizationId" AND v."decisionId"=d.id
    )
    SELECT EXISTS (SELECT 1 FROM mtm_attendance_rules r WHERE r."organizationId"=s.org AND r."effectiveFrom"<=s.day) AS "companySchedule",
      EXISTS (SELECT 1 FROM mtm_attendance_shift_plans p JOIN mtm_attendance_shift_members m ON m."organizationId"=p."organizationId" AND m."planId"=p.id
        WHERE p."organizationId"=s.org AND m."agentId"=s.agent AND p.value->>'from'<=s.day::text AND p.value->>'to'>=s.day::text) AS "shiftSchedule",
      (SELECT name FROM branch) AS "branchName",(SELECT active FROM branch) AS "branchActive",
      COALESCE((SELECT value='true'::jsonb FROM mtm_settings WHERE "organizationId"=s.org AND key='attendanceRequireInstallationApproval'),false) AS "approvalRequired",
      i.approved,i.pending FROM scope s CROSS JOIN installations i`
  if (!row) throw new Error("MTM_ATTENDANCE_PREPARATION_UNAVAILABLE")
  return {
    checkedAt: now.toISOString(), date,
    login: !card.user ? "ACCOUNT_MISSING" : card.status !== "ACTIVE" || !card.user.isActive ? "INACTIVE"
      : ![card.phone, card.user.phone, card.email, card.user.email].some(value => value?.trim() && !value.trim().endsWith("@invalid.local")) ? "CONTACT_MISSING" : "AVAILABLE",
    schedule: row.shiftSchedule ? "SHIFT" : row.companySchedule ? "COMPANY" : "DEFAULT",
    branch: row.branchName ? { name: row.branchName, active: row.branchActive === true } : null,
    installations: { required: row.approvalRequired, approved: row.approved, pending: row.pending },
  }
}
