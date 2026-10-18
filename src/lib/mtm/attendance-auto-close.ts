import type { Prisma } from "@prisma/client"
import type { AttendanceCorrectionBasis, AttendanceRequestDto } from "@/lib/mtm/attendance-request-contract"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"

/**
 * «Закрыть день» approved without waiting for the manager — when the company
 * has switched it on.
 *
 * Owner, 2026-10-18, right after the phone learned to close a forgotten day
 * (leaddrive-mtm #146/#147): «чтоб была возможность в настройках включить
 * автоподтверждение, но чтоб были показаны опоздания»; asked which requests,
 * he chose «Только «Закрыть день»». Leave, sick leave and every other request
 * still wait for a person.
 *
 * What counts as closing a forgotten day, and nothing else: a time correction
 * of a day that is still open (STARTED or PAUSED), from an earlier date of the
 * company, whose start is left exactly as the phone recorded it. The start is
 * the condition that keeps lateness in the report: a correction that moves the
 * start goes to the manager as before, however the setting stands.
 *
 * Approved by whom: the administrator who switched the setting on. The ledger
 * (workforce_time_corrections) and its database guards require a person behind
 * every approved correction, and the agent's card usually has no CRM login; the
 * switch is that person's standing decision, so the request, the ledger row and
 * the audit name them, and the decision note says it was automatic. It is the
 * manager's own decision path (`decideAttendanceRequestInTransaction`), with
 * every check it makes: the administrator must still be active, still have
 * write on MTM and the employee in scope, and never be the employee.
 */
export const ATTENDANCE_AUTO_CLOSE_SETTING_KEY = "attendanceAutoCloseForgottenDay"
/** Who switched it on; written by the settings route, never by a client. */
export const ATTENDANCE_AUTO_CLOSE_BY_KEY = "attendanceAutoCloseForgottenDayBy"

const notes = { az: az.mtmAttendance.autoCloseDecisionNote, ru: ru.mtmAttendance.autoCloseDecisionNote, en: en.mtmAttendance.autoCloseDecisionNote }

export function isForgottenDayClose(input: {
  basis: AttendanceCorrectionBasis | undefined
  requestedStartAt: Date | null
  timezone: string
  now: Date
}): boolean {
  const { basis, requestedStartAt, timezone, now } = input
  if (!basis || basis.kind !== "WORKDAY") return false
  const { facts } = basis
  if (facts.status !== "STARTED" && facts.status !== "PAUSED") return false
  if (facts.workDate >= currentDateKey(now, timezone)) return false
  const started = Date.parse(facts.startedAt)
  if (!requestedStartAt || !Number.isFinite(started)) return false
  // The request names minutes; the phone recorded seconds. Same minute = unchanged.
  return Math.floor(started / 60_000) * 60_000 === requestedStartAt.getTime()
}

/**
 * Inside the submission transaction, after the request row is written. Returns
 * the approved request, or null when the setting is off or anything refuses —
 * then the request simply waits for the manager, as it always did. A savepoint
 * keeps a refusal from the database (its guards) from taking the submission
 * down with it.
 */
export async function autoApproveForgottenDayClose(
  db: Prisma.TransactionClient,
  input: { organizationId: string; agentId: string; request: AttendanceRequestDto },
): Promise<AttendanceRequestDto | null> {
  const { organizationId, agentId, request } = input
  const rows = await db.mtmSetting.findMany({
    where: { organizationId, key: { in: [ATTENDANCE_AUTO_CLOSE_SETTING_KEY, ATTENDANCE_AUTO_CLOSE_BY_KEY] } },
    select: { key: true, value: true },
  }) as Array<{ key: string; value: unknown }>
  const enabled = rows.find((row) => row.key === ATTENDANCE_AUTO_CLOSE_SETTING_KEY)?.value === true
  const by = rows.find((row) => row.key === ATTENDANCE_AUTO_CLOSE_BY_KEY)?.value
  if (!enabled || typeof by !== "string" || !by) return null

  const employee = await db.mtmAgent.findFirst({ where: { organizationId, id: agentId }, select: { user: { select: { preferredLanguage: true } } } }) as { user: { preferredLanguage: string | null } | null } | null
  const language = employee?.user?.preferredLanguage
  const note = notes[language === "ru" || language === "en" ? language : "az"]

  // The manager's path, imported late: it imports the request store, which calls this.
  const { decideAttendanceRequestInTransaction } = await import("@/lib/mtm/attendance-request-decision")
  await db.$executeRaw`SAVEPOINT mtm_attendance_auto_close`
  try {
    const decided = await decideAttendanceRequestInTransaction(db, { organizationId, userId: by, principalType: "session" }, request.id, {
      decision: "APPROVED", version: request.version, note,
    })
    await db.$executeRaw`RELEASE SAVEPOINT mtm_attendance_auto_close`
    return decided.request
  } catch (error) {
    await db.$executeRaw`ROLLBACK TO SAVEPOINT mtm_attendance_auto_close`
    // Codes only: why the switch did not apply, never the request's content.
    console.warn("[mtm/attendance] auto-close not applied:", error instanceof AttendanceRequestError ? error.code : error instanceof Error ? error.name : "unknown")
    return null
  }
}
