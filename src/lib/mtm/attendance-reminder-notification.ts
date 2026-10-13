import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { ATTENDANCE_REMINDER_ENTITY } from "@/lib/mtm/attendance-reminder-contract"
import { readAttendanceReminderPolicy } from "@/lib/mtm/attendance-reminder-policy"
import { attendanceReminderReader, attendanceReminderTenantEnabled } from "@/lib/mtm/attendance-reminder-store"

/** Shared by list/count/mark-read. Legacy inbox entries keep their own gates. */
export function attendanceReminderMobilePredicate(organizationId: string, agentId: string) {
  return Prisma.sql`(("metadata"->>'attendanceReminderId') IS NULL OR (
    EXISTS(SELECT 1 FROM mtm_settings s WHERE s."organizationId"=${organizationId} AND s.key='attendanceEnabled' AND s.value='true'::jsonb)
    AND EXISTS(SELECT 1 FROM mtm_settings s WHERE s."organizationId"=${organizationId} AND s.key='attendanceEmployeeRemindersEnabled' AND s.value='true'::jsonb)
    AND EXISTS(SELECT 1 FROM mtm_agents a WHERE a."organizationId"=${organizationId} AND a.id=${agentId} AND a.status='ACTIVE' AND NOT a."attendanceExcluded" AND (a.role='AGENT' OR a."attendanceParticipant"))
  ))`
}
export async function attendanceReminderWebFilter(organizationId: string, userId: string): Promise<Prisma.NotificationWhereInput> {
  let ids: string[] = []
  try {
    const policy = await readAttendanceReminderPolicy(prisma, organizationId)
    if (policy.enabled && policy.manager && await attendanceReminderTenantEnabled(prisma, organizationId)) {
      const reader = await attendanceReminderReader(prisma, organizationId, userId)
      if (reader) {
        const scope = reader.actor.scopedAgentIds
        const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT n.id FROM mtm_attendance_reminder_notices n
          JOIN mtm_agents a ON a."organizationId"=n."organizationId" AND a.id=n."agentId"
          WHERE n."organizationId"=${organizationId} AND n."recipientUserId"=${userId}
            AND a.status='ACTIVE' AND NOT a."attendanceExcluded" AND (a.role='AGENT' OR a."attendanceParticipant")
            AND (a."userId" IS NULL OR a."userId"<>${userId})
            AND (${scope === null} OR n."agentId"=ANY(${scope === null ? [] : [...scope]}::text[]))
          ORDER BY n."createdAt" DESC,n.id DESC LIMIT 10000`
        ids = rows.map(row => row.id)
      }
    }
  } catch { /* New reminder kind fails closed without hiding other inbox kinds. */ }
  return { OR: [{ entityType: null }, { entityType: { not: ATTENDANCE_REMINDER_ENTITY } }, { entityType: ATTENDANCE_REMINDER_ENTITY, entityId: { in: ids } }] }
}
