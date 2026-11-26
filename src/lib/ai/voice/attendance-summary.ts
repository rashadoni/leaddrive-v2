import { checkPermission, type Role } from "@/lib/permissions"
import { getTenantCapabilityAccess } from "@/lib/tenant-capability-access"
import { hideableIdForFieldCapability } from "@/lib/user-module-access"
import { getMtmAttendanceAccess } from "@/lib/mtm/attendance-access"
import { AttendanceReportAccessError, readMtmAttendanceReport } from "@/lib/mtm/attendance-report-store"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { dateInputValueInTimezone } from "@/lib/timezone"

/**
 * «Kadr uçotu» for Da Vinci: who came, who is late, who is absent, whose day is
 * still open, who is on approved leave (owner 2026-11-26: «он должен на все
 * вопросы отвечать… по всем модулям», then «Да, делай» for attendance).
 *
 * It reads the SAME report the attendance page and its export read
 * (`readMtmAttendanceReport`), through the same gates as that page's routes:
 * the role may read MTM, the tenant has the Personnel capability and this
 * person has not had it hidden, attendance is switched on, and the person is a
 * personnel reader (HR with the all-employees grant, or a manager over their
 * own people). The report narrows the employees itself, so a team lead hears
 * about their team only. A second calculation of lateness or absence would be
 * a second truth; there is none here - this file only shortens the answer.
 *
 * What never leaves: places. Neither where a mark was made nor where a break
 * was spent (CLAUDE.md, «MTM: координаты за перерыв не пишутся»); the report
 * does not even read break coordinates.
 */

/** A spoken list is rarely heard past the tenth name; the count says the rest. */
const LIST_LIMIT = 10
/** Long enough for "this month"; the page itself allows a year. */
export const ATTENDANCE_SUMMARY_MAX_DAYS = 31

export type AttendanceSummaryInput = {
  orgId: string
  userId: string
  role: Role
  hiddenModules?: readonly string[]
  timezone: string
  now: Date
  from?: string
  to?: string
}

type Person = { name: string; date: string }

function localTime(iso: string | null, timezone: string): string | null {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))
  } catch {
    return null
  }
}

function capped<T>(rows: T[]): { items: T[]; more: number } {
  return { items: rows.slice(0, LIST_LIMIT), more: Math.max(0, rows.length - LIST_LIMIT) }
}

export async function buildAttendanceSummary(input: AttendanceSummaryInput): Promise<Record<string, unknown>> {
  // The page's own gates, in the page's order (with-attendance-auth.ts,
  // with-mtm-rls-auth.ts): role, tenant capability, per-person hiding, switch.
  if (!checkPermission(input.role, "mtm", "read")) return { error: "NOT_PERMITTED_FOR_ROLE" }
  const capability = await getTenantCapabilityAccess(input.orgId, "personnel")
  if (!capability.allowed) return { error: "MODULE_NOT_ENABLED", module: "personnel" }
  if (input.hiddenModules?.includes(hideableIdForFieldCapability("personnel"))) return { error: "NOT_PERMITTED_FOR_ROLE" }
  const access = await getMtmAttendanceAccess(input.orgId, input.userId, input.role)
  if (!access.enabled) return { error: "MODULE_NOT_ENABLED", module: "attendance" }
  // A field agent and anyone outside Personnel have no report at all.
  if (!access.actor) return { error: "NOT_PERMITTED_FOR_ROLE" }

  if ((input.from && !isDateKey(input.from)) || (input.to && !isDateKey(input.to))) return { error: "BAD_ARGUMENTS" }
  const today = dateInputValueInTimezone(input.now, input.timezone)
  const from = input.from ?? input.to ?? today
  const to = input.to ?? (input.from ? input.from : today)
  if (to < from) return { error: "BAD_ARGUMENTS" }
  if (to >= addDateKeyDays(from, ATTENDANCE_SUMMARY_MAX_DAYS)) return { error: "RANGE_TOO_LONG", maxDays: ATTENDANCE_SUMMARY_MAX_DAYS }

  let report: Awaited<ReturnType<typeof readMtmAttendanceReport>>
  try {
    report = await readMtmAttendanceReport({
      organizationId: input.orgId,
      actor: access.actor,
      query: { from, to, form: "ALL" },
      now: input.now,
    })
  } catch (error) {
    if (error instanceof AttendanceReportAccessError) return { error: "NOT_PERMITTED_FOR_ROLE" }
    if (error instanceof Error && error.message === "MTM_ATTENDANCE_REPORT_TOO_LARGE") return { error: "RANGE_TOO_LONG" }
    throw error
  }

  const rows = report.rows as MtmAttendanceReportRow[]
  const person = (row: MtmAttendanceReportRow): Person => ({ name: row.employeeName, date: row.date })
  const minutes = (seconds: number | null) => Math.round((seconds ?? 0) / 60)

  const late = capped(rows
    .filter((row) => (row.lateSeconds ?? 0) > 0)
    .sort((a, b) => (b.lateSeconds ?? 0) - (a.lateSeconds ?? 0))
    .map((row) => ({ ...person(row), minutes: minutes(row.lateSeconds), arrivedAt: localTime(row.startedAt, row.timezone) })))
  const absent = capped(rows.filter((row) => row.kind === "ABSENT").map(person))
  const earlyLeave = capped(rows
    .filter((row) => (row.earlyLeaveSeconds ?? 0) > 0)
    .map((row) => ({ ...person(row), minutes: minutes(row.earlyLeaveSeconds), leftAt: localTime(row.completedAt, row.timezone) })))
  // Started and not finished: still at work today, or a day nobody closed.
  const notClosed = capped(rows
    .filter((row) => row.kind === "OPEN" || row.kind === "MISSING_FINISH")
    .map((row) => ({ ...person(row), startedAt: localTime(row.startedAt, row.timezone), stillToday: row.kind === "OPEN" })))
  const onApprovedLeave = capped(rows
    .filter((row) => row.kind === "APPROVED_REQUEST")
    .map((row) => ({ ...person(row), kind: row.approvedRequests?.[0]?.details.kind ?? null })))

  const totals = report.totals
  return {
    period: { from, to, timezone: input.timezone, today },
    asOf: report.asOf,
    employees: totals.employeeCount,
    totals: {
      personDays: totals.rowCount,
      arrived: totals.arrivedCount,
      absent: totals.absentCount,
      late: totals.lateCount,
      earlyLeave: totals.earlyLeaveCount,
      notClosed: rows.filter((row) => row.kind === "OPEN" || row.kind === "MISSING_FINISH").length,
      onApprovedLeave: rows.filter((row) => row.kind === "APPROVED_REQUEST").length,
      daysOff: rows.filter((row) => row.kind === "WEEKEND" || row.kind === "HOLIDAY").length,
      // A day whose journal does not add up is counted, never guessed at.
      unreadableDays: totals.invalidFactsCount,
      workedHours: Math.round(totals.workedSeconds / 360) / 10,
      workedHoursComplete: totals.isComplete,
    },
    late: late.items, lateMore: late.more,
    absent: absent.items, absentMore: absent.more,
    earlyLeave: earlyLeave.items, earlyLeaveMore: earlyLeave.more,
    notClosed: notClosed.items, notClosedMore: notClosed.more,
    onApprovedLeave: onApprovedLeave.items, onApprovedLeaveMore: onApprovedLeave.more,
    // Who the figures cover: everyone for HR with the grant, otherwise only
    // the people this manager leads.
    scope: access.actor.scopedAgentIds === null ? "all_employees" : "own_people",
    means: "Times are local to each employee's schedule. absent = a working day with no start and no approved leave. notClosed with stillToday=true is someone still at work; otherwise the day was never closed. A *More field is how many more names were left out. When scope is own_people, say the figures cover the people this user leads.",
  }
}
