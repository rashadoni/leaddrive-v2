import { prisma } from "@/lib/prisma"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"
import { readAttendanceRules } from "@/lib/mtm/attendance-rule-store"
import { ATTENDANCE_TRACKED_CARD_WHERE } from "@/lib/mtm/attendance-tracking"

/**
 * Personnel → Today → "Set up attendance" (owner, 2026-10-15). Until these are
 * done every report is wrong for the company — all days read as absences,
 * leave has no norm — and HR had no way to know where to begin. Each step is
 * read from the data it stands for, never from a stored "done" flag.
 */
export const ATTENDANCE_SETUP_STEPS = ["hours", "holidays", "branches", "leave", "employees", "app"] as const
export type AttendanceSetupStep = (typeof ATTENDANCE_SETUP_STEPS)[number]
export type AttendanceSetupStatus = { key: AttendanceSetupStep; done: boolean; count?: number; total?: number }

/** Runs in the tenant's RLS context (the attendance route wrapper provides it). */
export async function readAttendanceSetup(organizationId: string, timezone: string, now = new Date()): Promise<AttendanceSetupStatus[]> {
  const today = currentDateKey(now, timezone)
  const year = Number(today.slice(0, 4))
  const [rules, holidays, branches, policies, tracked, marking] = await Promise.all([
    readAttendanceRules(organizationId),
    prisma.mtmWorkCalendarDay.count({ where: { organizationId, kind: { in: ["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY"] },
      date: { gte: new Date(`${year}-01-01T00:00:00.000Z`), lte: new Date(`${year}-12-31T00:00:00.000Z`) } } }),
    // A branch counts while its latest revision is active (revisions are never updated).
    prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM mtm_attendance_branches b
      WHERE b."organizationId" = ${organizationId} AND (SELECT r.active FROM mtm_attendance_branch_revisions r
        WHERE r."organizationId" = b."organizationId" AND r."branchId" = b.id ORDER BY r.version DESC LIMIT 1)`,
    prisma.mtmAttendanceLeavePolicy.findFirst({ where: { organizationId, year }, orderBy: { version: "desc" }, select: { value: true } }),
    prisma.mtmAgent.findMany({ where: { organizationId, status: "ACTIVE", attendanceExcluded: false, ...ATTENDANCE_TRACKED_CARD_WHERE }, select: { id: true } }),
    prisma.mtmAgentWorkday.findMany({ where: { organizationId, startedAt: { gte: new Date(`${addDateKeyDays(today, -30)}T00:00:00.000Z`) } }, select: { agentId: true }, distinct: ["agentId"] }),
  ])
  const trackedIds = new Set(tracked.map(card => card.id))
  const markingCount = marking.filter(row => trackedIds.has(row.agentId)).length
  const branchCount = Number(branches[0]?.count ?? 0)
  const leaveReviewed = (policies?.value as { reviewed?: unknown } | null)?.reviewed === true
  return [
    { key: "hours", done: rules.length > 0 },
    { key: "holidays", done: holidays > 0, count: holidays },
    { key: "branches", done: branchCount > 0, count: branchCount },
    { key: "leave", done: leaveReviewed },
    { key: "employees", done: tracked.length > 0, count: tracked.length },
    { key: "app", done: markingCount > 0, count: markingCount, total: tracked.length },
  ]
}
