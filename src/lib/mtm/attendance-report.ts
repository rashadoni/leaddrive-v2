import { projectApprovedAttendanceRequests, type AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"
import type { AttendanceDayKind } from "@/lib/mtm/attendance-day-kinds"
import { addDateKeyDays, currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { AttendanceRuleInputSchema, attendanceRuleForDate, minutesOfDay, type MtmAttendanceRule } from "@/lib/mtm/attendance-rules"
import { resolveWorkCalendarDay, type WorkCalendarDayKind, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import { mtmWorkdayPauses } from "@/lib/mtm/workday-pauses"
import { isValidTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { calculateWorkforceTimesheetDay, type WorkforceWorkdayFactsInput } from "@/lib/workforce/timesheet-calculation"
import type { WorkforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"

export const MTM_ATTENDANCE_REPORT_MAX_DAYS = 366
export const MTM_ATTENDANCE_REPORT_MAX_ROWS = 100_000
export type MtmAttendanceInstant = Date | string
export type MtmAttendanceEventType = "START" | "PAUSE" | "RESUME" | "FINISH" | "REOPEN"
const EVENT_TYPES: readonly string[] = ["START", "PAUSE", "RESUME", "FINISH", "REOPEN"]

/** The caller has already applied tenant/manager scope; employment bounds arrive in stage 2.9. */
export interface MtmAttendanceEmployee {
  id: string
  name: string
  teamId: string | null
  teamName: string | null
}

export interface MtmAttendanceEventInput {
  id?: string
  type: string
  occurredAt: MtmAttendanceInstant
  appliedAt?: MtmAttendanceInstant | null
  claimedAt?: MtmAttendanceInstant | null
  serverReceivedAt?: MtmAttendanceInstant | null
}

/**
 * Current workday columns must be the canonical, ledger-backed projection.
 * Supply the whole journal, including START, FINISH and REOPEN, not just pauses.
 * An aggregate incompatible with that journal is reported as unknown; this
 * reader never manufactures break intervals to match a corrected total.
 */
export interface MtmAttendanceWorkday {
  id: string
  agentId: string
  workDate: Date | string
  status: string
  startedAt: MtmAttendanceInstant
  completedAt: MtmAttendanceInstant | null
  totalPausedSeconds: number
  events: readonly MtmAttendanceEventInput[]
  /** Server-only ledger proof; never accepted from a report request/client. */
  correctionProjection?: MtmAttendanceCorrectionProjection
}

/** Safe history: no reasons, attachments, device identifiers or coordinates. */
export type MtmAttendanceCorrection = {
  id: string; requestId: string | null; source: "REQUEST_APPROVAL" | "DIRECT_MANAGER"; occurredAt: string
  reviewer: { id: string; name: string | null }
  before: { kind: "MISSING"; workDate: string } | { kind: "WORKDAY"; facts: WorkforceWorkdayCorrectionFacts }
  after: WorkforceWorkdayCorrectionFacts
}
export type MtmAttendanceCorrectionProjection = { valid: false } | {
  valid: true; facts: WorkforceWorkdayCorrectionFacts
  pauseIntervals: Array<{ startedAt: string; endedAt: string | null }>
  history: MtmAttendanceCorrection[]
}

/** Allowlisted journal DTO: coordinates, notes and request/evidence payloads never cross this boundary. */
export interface MtmAttendanceEvent {
  id: string | null
  type: MtmAttendanceEventType
  occurredAt: string
  appliedAt: string | null
  claimedAt: string | null
  serverReceivedAt: string | null
}

export type MtmAttendanceDayKind = "APPROVED_REQUEST" | "WORKED" | "OPEN" | "MISSING_FINISH" | "ABSENT" | "WEEKEND" | "HOLIDAY" | "UPCOMING" | "INVALID_FACTS"
export type MtmAttendanceFlag = "WORKED_ON_APPROVED_ABSENCE" | "MISSING_FINISH" | "FACTS_INVALID" | "WORKED_ON_DAY_OFF" | "LATE_START" | "EARLY_LEAVE"
export type MtmAttendanceInvalidReason = "DUPLICATE_WORKDAY" | "SCHEDULE_INVALID" | "TIMESTAMP_INVALID" | "EVENT_TYPE_INVALID" | "JOURNAL_INCOMPLETE" | "PAUSE_TOTAL_MISMATCH" | "WORKDAY_INCONSISTENT"

/**
 * One employee × civil work date. All instants are canonical UTC, and timezone
 * comes from the rule effective on that date, never today's mutable settings.
 * null durations are unknown, not zero; totals name how many rows are unknown.
 * Breaks are represented solely by pausedSeconds, never their intervals/places.
 */
export interface MtmAttendanceReportRow {
  employeeId: string
  employeeName: string
  teamId: string | null
  teamName: string | null
  date: string
  workdayId: string | null
  kind: MtmAttendanceDayKind
  dayKind?: AttendanceDayKind
  factsState: "NONE" | "VALID" | "INVALID"
  ruleId: string
  timezone: string
  calendarKind: WorkCalendarDayKind
  calendarName: string | null
  isWorkingDay: boolean
  plannedStartAt: string | null
  plannedEndAt: string | null
  expectedWorkSeconds: number
  startedAt: string | null
  completedAt: string | null
  workedSeconds: number | null
  pausedSeconds: number | null
  lateSeconds: number | null
  earlyLeaveSeconds: number | null
  flags: MtmAttendanceFlag[]
  invalidReasons: MtmAttendanceInvalidReason[]
  events: MtmAttendanceEvent[]
  corrections?: MtmAttendanceCorrection[]
  approvedRequests?: AttendanceApprovedPeriod[]
}

export interface MtmAttendanceReportInput {
  approvedRequests?: readonly AttendanceApprovedPeriod[]
  dayKinds?: readonly AttendanceDayKind[]
  employees: readonly MtmAttendanceEmployee[]
  workdays: readonly MtmAttendanceWorkday[]
  calendar: readonly WorkCalendarOverride[]
  rules: readonly MtmAttendanceRule[]
  from: string
  to: string
  now: MtmAttendanceInstant
}

export class MtmAttendanceReportError extends Error {
  constructor(readonly code: "MTM_ATTENDANCE_REPORT_INPUT_INVALID" | "MTM_ATTENDANCE_REPORT_TOO_LARGE") { super(code) }
}

function instant(value: MtmAttendanceInstant | null | undefined): string | null {
  if (value == null) return null
  // A bare local clock string would otherwise depend on the host's timezone.
  if (typeof value === "string" && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function workDate(value: Date | string): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null
  return isDateKey(value) ? value : null
}

function rowKey(employeeId: string, date: string): string { return JSON.stringify([employeeId, date]) }

type DayPlan = { rule: MtmAttendanceRule; today: string; start: string | null; end: string | null; expectedSeconds: number }

/** Resolve expensive timezone/DST conversions once per date, not once per employee. */
function dayPlan(rules: readonly MtmAttendanceRule[], date: string, now: Date): DayPlan {
  const rule = attendanceRuleForDate(rules, date)
  if (!isValidTimezone(rule.timezone) || !AttendanceRuleInputSchema.safeParse({ effectiveFrom: rule.effectiveFrom,
    startTime: rule.startTime, endTime: rule.endTime, lunchMinutes: rule.lunchMinutes,
    lateGraceMinutes: rule.lateGraceMinutes, weekendDays: rule.weekendDays }).success) {
    throw new MtmAttendanceReportError("MTM_ATTENDANCE_REPORT_INPUT_INVALID")
  }
  const plan: DayPlan = { rule, today: currentDateKey(now, rule.timezone), start: null, end: null,
    expectedSeconds: (minutesOfDay(rule.endTime) - minutesOfDay(rule.startTime) - rule.lunchMinutes) * 60 }
  try {
    const start = localDateTimeToUnambiguousUtc(`${date}T${rule.startTime}`, rule.timezone).toISOString()
    const end = localDateTimeToUnambiguousUtc(`${date}T${rule.endTime}`, rule.timezone).toISOString()
    if (end > start && Number.isSafeInteger(plan.expectedSeconds) && plan.expectedSeconds >= 0) {
      plan.start = start
      plan.end = end
    }
  } catch { /* A DST gap/fold remains unknown instead of choosing an instant. */ }
  return plan
}

function invalid(row: MtmAttendanceReportRow, reasons: MtmAttendanceInvalidReason[]): MtmAttendanceReportRow {
  return { ...row, kind: "INVALID_FACTS", factsState: "INVALID", workedSeconds: null, pausedSeconds: null,
    lateSeconds: null, earlyLeaveSeconds: null, flags: [...row.flags, "FACTS_INVALID"], invalidReasons: [...new Set(reasons)] }
}

function journal(events: readonly MtmAttendanceEventInput[]): { events: MtmAttendanceEvent[]; reasons: MtmAttendanceInvalidReason[] } {
  const safe: MtmAttendanceEvent[] = []
  const reasons: MtmAttendanceInvalidReason[] = []
  for (const event of events) {
    if (!EVENT_TYPES.includes(event.type)) { reasons.push("EVENT_TYPE_INVALID"); continue }
    const occurredAt = instant(event.occurredAt)
    const appliedAt = instant(event.appliedAt)
    const claimedAt = instant(event.claimedAt)
    const serverReceivedAt = instant(event.serverReceivedAt)
    if (!occurredAt || (event.appliedAt != null && !appliedAt) || (event.claimedAt != null && !claimedAt)
      || (event.serverReceivedAt != null && !serverReceivedAt)) {
      reasons.push("TIMESTAMP_INVALID")
      if (!occurredAt) continue
    }
    safe.push({ id: event.id ?? null, type: event.type as MtmAttendanceEventType, occurredAt, appliedAt, claimedAt, serverReceivedAt })
  }
  // Array sort is stable, preserving caller order for legacy exact ties.
  safe.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)
    || (a.appliedAt ?? "").localeCompare(b.appliedAt ?? ""))
  return { events: safe, reasons }
}

function buildRow(employee: MtmAttendanceEmployee, date: string, days: readonly MtmAttendanceWorkday[],
  plan: DayPlan, calendar: readonly WorkCalendarOverride[], now: Date): MtmAttendanceReportRow {
  const { rule, today } = plan
  const effective = resolveWorkCalendarDay({ date, overrides: calendar, agentId: employee.id, teamId: employee.teamId })
  const customWeekend = rule.weekendDays.includes(new Date(`${date}T00:00:00.000Z`).getUTCDay())
  const isWorkingDay = effective.overrideId !== null ? effective.isWorkingDay : !customWeekend
  const calendarKind = effective.overrideId !== null ? effective.kind : customWeekend ? "WEEKEND" : "WORKING_DAY"
  const expectedWorkSeconds = isWorkingDay ? plan.expectedSeconds : 0
  const row: MtmAttendanceReportRow = {
    employeeId: employee.id, employeeName: employee.name, teamId: employee.teamId, teamName: employee.teamName,
    date, workdayId: null, kind: isWorkingDay ? date > today ? "UPCOMING" : "ABSENT"
      : ["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY"].includes(calendarKind) ? "HOLIDAY" : "WEEKEND",
    factsState: "NONE", ruleId: rule.id, timezone: rule.timezone, calendarKind, calendarName: effective.name,
    isWorkingDay, plannedStartAt: null, plannedEndAt: null, expectedWorkSeconds,
    startedAt: null, completedAt: null, workedSeconds: 0, pausedSeconds: 0, lateSeconds: 0, earlyLeaveSeconds: 0,
    flags: [], invalidReasons: [], events: [],
  }

  const plannedStartAt = plan.start
  const plannedEndAt = plan.end
  if (!plannedStartAt || !plannedEndAt) {
    // A DST gap/fold cannot be resolved by guessing a contractual start time.
    return isWorkingDay || days.length ? invalid(row, ["SCHEDULE_INVALID"]) : row
  }
  if (isWorkingDay) { row.plannedStartAt = plannedStartAt; row.plannedEndAt = plannedEndAt }
  if (!days.length) {
    // Within the lateness allowance, a person still has time to arrive.
    if (isWorkingDay && date === today && now.getTime() <= Date.parse(plannedStartAt) + rule.lateGraceMinutes * 60_000) row.kind = "UPCOMING"
    return row
  }
  if (days.length !== 1) return invalid(row, ["DUPLICATE_WORKDAY"])
  const day = days[0]
  const read = journal(day.events)
  row.workdayId = day.id
  row.startedAt = instant(day.startedAt)
  row.completedAt = instant(day.completedAt)
  row.events = read.events
  const corrected = day.correctionProjection
  if (corrected?.valid === false) return invalid(row, ["WORKDAY_INCONSISTENT"])
  if (corrected?.valid) {
    if (corrected.facts.id !== day.id || corrected.facts.workDate !== date || corrected.facts.status !== day.status
      || corrected.facts.startedAt !== row.startedAt || corrected.facts.completedAt !== row.completedAt
      || corrected.facts.totalPausedSeconds !== day.totalPausedSeconds || !corrected.history.length) return invalid(row, ["WORKDAY_INCONSISTENT"])
    row.corrections = corrected.history
  }
  if (date < today && (day.status === "STARTED" || day.status === "PAUSED")) row.flags.push("MISSING_FINISH")
  const reasons = [...read.reasons]
  if (!row.startedAt || (day.completedAt !== null && !row.completedAt)) reasons.push("TIMESTAMP_INVALID")
  if (!day.id || !["STARTED", "PAUSED", "COMPLETED"].includes(day.status)
    || !Number.isSafeInteger(day.totalPausedSeconds) || day.totalPausedSeconds < 0
    || read.events.some((event) => Date.parse(event.occurredAt) > now.getTime()) || date > today) reasons.push("WORKDAY_INCONSISTENT")
  if (!corrected?.valid && (read.events.filter((event) => event.type === "START").length !== 1
    || (day.status === "COMPLETED" && !read.events.some((event) => event.type === "FINISH")))) reasons.push("JOURNAL_INCOMPLETE")
  if (reasons.length) return invalid(row, reasons)

  // This is the only pause parser. Its documented tolerance for replayed or
  // redundant events is preserved; no second state machine is added here.
  const pauses = corrected?.valid ? corrected.pauseIntervals.map((pause) => ({ from: new Date(pause.startedAt), to: pause.endedAt ? new Date(pause.endedAt) : null })) : mtmWorkdayPauses(read.events)
  const closedPauseSeconds = pauses.reduce((total, pause) => total + (pause.to === null ? 0 : Math.floor((pause.to.getTime() - pause.from.getTime()) / 1000)), 0)
  if (closedPauseSeconds !== day.totalPausedSeconds) return invalid(row, ["PAUSE_TOTAL_MISMATCH"])
  try {
    const calculation = calculateWorkforceTimesheetDay({
      asOf: now.toISOString(),
      schedule: { shiftSnapshotId: `${rule.id}:${date}`, workDate: date, timezone: rule.timezone, plannedStartAt, plannedEndAt },
      policySnapshot: { snapshotId: rule.id, expectedWorkSeconds, lateGraceSeconds: rule.lateGraceMinutes * 60,
        undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null },
      facts: { workdayId: day.id, status: day.status as WorkforceWorkdayFactsInput["status"], startedAt: row.startedAt!, completedAt: row.completedAt,
        pauseIntervals: pauses.map((pause) => ({ startedAt: pause.from.toISOString(), endedAt: pause.to?.toISOString() ?? null })) },
    })
    row.factsState = "VALID"
    const missingFinish = row.flags.includes("MISSING_FINISH")
    row.kind = day.status === "COMPLETED" ? "WORKED" : missingFinish ? "MISSING_FINISH" : "OPEN"
    row.workedSeconds = missingFinish ? null : calculation.fact.workedSeconds
    row.pausedSeconds = missingFinish && day.status === "PAUSED" ? null : calculation.fact.pausedSeconds
    // Grace suppresses the violation; it does not deduct ten minutes from a
    // real 21-minute late arrival. No late/early verdict applies to a day off.
    row.lateSeconds = isWorkingDay && calculation.deviations.lateStartSeconds > rule.lateGraceMinutes * 60
      ? calculation.deviations.lateStartSeconds : 0
    row.earlyLeaveSeconds = day.status !== "COMPLETED" ? null : isWorkingDay
      ? Math.max(0, Math.floor((Date.parse(plannedEndAt) - Date.parse(row.completedAt!)) / 1000)) : 0
    if (!isWorkingDay) row.flags.push("WORKED_ON_DAY_OFF")
    if (row.lateSeconds > 0) row.flags.push("LATE_START")
    if (row.earlyLeaveSeconds !== null && row.earlyLeaveSeconds > 0) row.flags.push("EARLY_LEAVE")
    return row
  } catch {
    return invalid(row, ["WORKDAY_INCONSISTENT"])
  }
}

/** Build every date, including no-event dates; never infer employment from record creation/deletion dates. */
export function buildMtmAttendanceReport(input: MtmAttendanceReportInput) {
  const asOf = instant(input.now)
  if (!asOf || !isDateKey(input.from) || !isDateKey(input.to) || input.to < input.from
    || new Set(input.employees.map((employee) => employee.id)).size !== input.employees.length) {
    throw new MtmAttendanceReportError("MTM_ATTENDANCE_REPORT_INPUT_INVALID")
  }
  const dayCount = Math.round((Date.parse(input.to) - Date.parse(input.from)) / 86_400_000) + 1
  if (dayCount > MTM_ATTENDANCE_REPORT_MAX_DAYS || dayCount * input.employees.length > MTM_ATTENDANCE_REPORT_MAX_ROWS) {
    throw new MtmAttendanceReportError("MTM_ATTENDANCE_REPORT_TOO_LARGE")
  }
  const dates = Array.from({ length: dayCount }, (_, index) => addDateKeyDays(input.from, index))
  const employeeIds = new Set(input.employees.map((employee) => employee.id))
  const days = new Map<string, MtmAttendanceWorkday[]>()
  for (const day of input.workdays) {
    if (!employeeIds.has(day.agentId)) continue
    const date = workDate(day.workDate)
    if (!date) throw new MtmAttendanceReportError("MTM_ATTENDANCE_REPORT_INPUT_INVALID")
    if (date < input.from || date > input.to) continue
    const key = rowKey(day.agentId, date)
    days.set(key, [...(days.get(key) ?? []), day])
  }
  const now = new Date(asOf)
  const plans = new Map(dates.map((date) => [date, dayPlan(input.rules, date, now)]))
  const calendarByDate = new Map<string, WorkCalendarOverride[]>()
  for (const entry of input.calendar) {
    const date = workDate(entry.date)
    if (!date || date < input.from || date > input.to) continue
    calendarByDate.set(date, [...(calendarByDate.get(date) ?? []), entry])
  }
  const catalogue = new Map(input.dayKinds?.map((kind) => [kind.key, kind]))
  const approvedByEmployee = new Map<string, AttendanceApprovedPeriod[]>()
  for (const entry of input.approvedRequests ?? []) approvedByEmployee.set(entry.agentId, [...(approvedByEmployee.get(entry.agentId) ?? []), entry])
  const rows = input.employees.flatMap((employee) => dates.map((date) => {
    const row = buildRow(employee, date, days.get(rowKey(employee.id, date)) ?? [], plans.get(date)!, calendarByDate.get(date) ?? [], now)
    const dayKind = catalogue.get(row.kind)
    return projectApprovedAttendanceRequests(dayKind ? { ...row, dayKind } : row, approvedByEmployee.get(employee.id) ?? [], plans.get(date)!.rule.lateGraceMinutes * 60)
  }))
  return { from: input.from, to: input.to, asOf, rows, totals: summarizeMtmAttendanceRows(rows) }
}

export interface MtmAttendanceRowFilter {
  employeeId?: string
  teamId?: string
  from?: string
  to?: string
  form?: "ALL" | "LATE_EARLY" | "ABSENCES" | "JOURNAL"
}

/** Every report form selects from these rows rather than re-reading/calculating attendance. */
export function filterMtmAttendanceRows(rows: readonly MtmAttendanceReportRow[], filter: MtmAttendanceRowFilter = {}) {
  return rows.filter((row) => (!filter.employeeId || row.employeeId === filter.employeeId)
    && (!filter.teamId || row.teamId === filter.teamId) && (!filter.from || row.date >= filter.from) && (!filter.to || row.date <= filter.to)
    && (filter.form !== "LATE_EARLY" || (row.lateSeconds ?? 0) > 0 || (row.earlyLeaveSeconds ?? 0) > 0)
    && (filter.form !== "ABSENCES" || row.kind === "ABSENT") && (filter.form !== "JOURNAL" || row.events.length > 0 || Boolean(row.corrections?.length)))
}

/** Sums known values only. Consumers must retain the explicit completeness counts beside the totals. */
export function summarizeMtmAttendanceRows(rows: readonly MtmAttendanceReportRow[]) {
  const sum = (key: "workedSeconds" | "pausedSeconds" | "lateSeconds" | "earlyLeaveSeconds") => rows.reduce((total, row) => total + (row[key] ?? 0), 0)
  const unknownWorkedCount = rows.filter((row) => row.workedSeconds === null).length
  const unknownPausedCount = rows.filter((row) => row.pausedSeconds === null).length
  return {
    rowCount: rows.length, employeeCount: new Set(rows.map((row) => row.employeeId)).size,
    arrivedCount: rows.filter((row) => row.startedAt !== null && row.factsState === "VALID").length,
    absentCount: rows.filter((row) => row.kind === "ABSENT").length,
    lateCount: rows.filter((row) => (row.lateSeconds ?? 0) > 0).length,
    earlyLeaveCount: rows.filter((row) => (row.earlyLeaveSeconds ?? 0) > 0).length,
    missingFinishCount: rows.filter((row) => row.flags.includes("MISSING_FINISH")).length,
    invalidFactsCount: rows.filter((row) => row.factsState === "INVALID").length,
    workedSeconds: sum("workedSeconds"), pausedSeconds: sum("pausedSeconds"), lateSeconds: sum("lateSeconds"), earlyLeaveSeconds: sum("earlyLeaveSeconds"),
    unknownWorkedCount, unknownPausedCount, isComplete: unknownWorkedCount === 0 && unknownPausedCount === 0,
  }
}

export type MtmAttendanceReport = ReturnType<typeof buildMtmAttendanceReport>
export type MtmAttendanceReportTotals = ReturnType<typeof summarizeMtmAttendanceRows>
