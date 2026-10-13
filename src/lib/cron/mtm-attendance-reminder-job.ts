import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { prismaJobCursorStore, type JobCursorStore } from "@/lib/cron/job-cursor"
import { createAttendanceReminders } from "@/lib/mtm/attendance-reminder-store"

export const ATTENDANCE_REMINDER_JOB = "mtm-attendance-reminders"
const BATCH = 100
/** Numeric round-robin offset contains no tenant or employee identifiers.
 * Inserts/deletes may repeat or defer a subject for one cycle; dedupe is in DB. */
export async function executeMtmAttendanceReminderJob(now = new Date(), cursorStore: JobCursorStore = prismaJobCursorStore()) {
  const started = Date.now()
  const previous = await cursorStore.read(ATTENDANCE_REMINDER_JOB)
  const offset = previous && /^v1:\d{1,12}$/.test(previous) ? Number(previous.slice(3)) : 0
  const candidates = await prisma.$queryRaw<{ organizationId: string; id: string }[]>`SELECT a."organizationId",a.id FROM mtm_agents a
    JOIN organizations o ON o.id=a."organizationId" AND o."isActive"
    WHERE a.status='ACTIVE' AND NOT a."attendanceExcluded" AND (a.role='AGENT' OR a."attendanceParticipant")
    AND EXISTS(SELECT 1 FROM mtm_settings s WHERE s."organizationId"=a."organizationId" AND s.key='attendanceEnabled' AND s.value='true'::jsonb)
    AND EXISTS(SELECT 1 FROM mtm_settings s WHERE s."organizationId"=a."organizationId" AND s.key IN ('attendanceEmployeeRemindersEnabled','attendanceManagerAlertsEnabled') AND s.value='true'::jsonb)
    ORDER BY a."organizationId",a.id LIMIT ${BATCH} OFFSET ${offset}`
  let processed = 0, created = 0, failed = 0
  for (const candidate of candidates) {
    if (Date.now() - started >= 45_000) break
    try {
      created += await runWithTenant(candidate.organizationId, () => createAttendanceReminders(candidate.organizationId, candidate.id, now))
    } catch {
      // No names, identifiers, recipient data or report cells in worker logs.
      console.error("[MTM Cron] attendance reminder preparation failed")
      failed++
    }
    processed++
  }
  const next = candidates.length < BATCH && processed === candidates.length ? 0 : offset + processed
  if (!await cursorStore.compareAndSet(ATTENDANCE_REMINDER_JOB, previous, `v1:${next}`)) throw new Error("MTM_ATTENDANCE_REMINDER_CURSOR_CHANGED")
  return { scanned: candidates.length, processed, created, failed }
}
export function runMtmAttendanceReminderJob() {
  return runWithRlsBypass(() => withJobLease({ name: ATTENDANCE_REMINDER_JOB, ttlMs: 120_000 }, () => executeMtmAttendanceReminderJob()))
}
