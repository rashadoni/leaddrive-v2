import { describe, expect, it } from "vitest"
import { MTM_ATTENDANCE_BASELINE_RULE, type MtmAttendanceRule } from "@/lib/mtm/attendance-rules"
import { buildMtmAttendanceReport, filterMtmAttendanceRows, summarizeMtmAttendanceRows,
  type MtmAttendanceEventInput, type MtmAttendanceReportInput, type MtmAttendanceWorkday } from "@/lib/mtm/attendance-report"
import type { WorkCalendarOverride } from "@/lib/mtm/work-calendar"

const date = "2026-10-12" // Monday; all clock fixtures below are in Asia/Baku.
const at = (clock: string, day = date) => `${day}T${clock.length === 5 ? `${clock}:00` : clock}+04:00`
const employee = { id: "agent-a", name: "Aysel", teamId: "team-a", teamName: "North" }
const secondEmployee = { id: "agent-b", name: "Leyla", teamId: "team-b", teamName: "South" }
const event = (type: string, clock: string, day = date): MtmAttendanceEventInput => ({ type, occurredAt: at(clock, day) })
function completed(change: Partial<MtmAttendanceWorkday> = {}): MtmAttendanceWorkday {
  return { id: "day-a", agentId: employee.id, workDate: date, status: "COMPLETED",
    startedAt: at("09:00"), completedAt: at("18:00"), totalPausedSeconds: 0,
    events: [event("START", "09:00"), event("FINISH", "18:00")], ...change }
}
function input(change: Partial<MtmAttendanceReportInput> = {}): MtmAttendanceReportInput {
  return { employees: [employee], workdays: [], calendar: [], rules: [], from: date, to: date, now: at("19:00"), ...change }
}
function row(day: MtmAttendanceWorkday, change: Partial<MtmAttendanceReportInput> = {}) {
  return buildMtmAttendanceReport(input({ workdays: [day], ...change })).rows[0]
}
function override(change: Partial<WorkCalendarOverride>): WorkCalendarOverride {
  return { id: "calendar-a", date, kind: "COMPANY_HOLIDAY", name: "Company day", teamId: null,
    agentId: null, movedToDate: null, routePlanningAllowed: null, ...change }
}
const rule = (change: Partial<MtmAttendanceRule>): MtmAttendanceRule => ({ ...MTM_ATTENDANCE_BASELINE_RULE,
  id: "rule-a", effectiveFrom: "2026-10-01", ...change })

describe("MTM attendance shared report calculation", () => {
  it("deducts only actual pauses from facts while lunch reduces the planned norm", () => {
    const withLunch = row(completed({ totalPausedSeconds: 3600,
      events: [event("START", "09:00"), event("PAUSE", "13:00"), event("RESUME", "14:00"), event("FINISH", "18:00")] }))
    expect(withLunch).toMatchObject({ kind: "WORKED", factsState: "VALID", expectedWorkSeconds: 28800,
      workedSeconds: 28800, pausedSeconds: 3600, lateSeconds: 0, earlyLeaveSeconds: 0 })
    expect(row(completed())).toMatchObject({ expectedWorkSeconds: 28800, workedSeconds: 32400, pausedSeconds: 0 })
  })

  it.each([["09:10", 0], ["09:10:01", 601], ["09:21", 1260]])("applies grace to %s without subtracting it from real lateness", (start, expected) => {
    const result = row(completed({ startedAt: at(start), events: [event("START", start), event("FINISH", "18:00")] }))
    expect(result.lateSeconds).toBe(expected)
    expect(result.flags.includes("LATE_START")).toBe(expected > 0)
  })

  it("compares early leaving with scheduled end, independently of worked hours", () => {
    const result = row(completed({ startedAt: at("07:00"), completedAt: at("16:40"),
      events: [event("START", "07:00"), event("FINISH", "16:40")] }))
    expect(result.workedSeconds).toBe(34800)
    expect(result.earlyLeaveSeconds).toBe(4800)
    expect(result.flags).toContain("EARLY_LEAVE")
  })

  it("emits every employee and date, preserving holidays and weekends even in the future", () => {
    const result = buildMtmAttendanceReport(input({ employees: [employee, secondEmployee], to: "2026-10-19",
      now: at("19:00", "2026-10-16"), calendar: [override({ date: "2026-10-14" })] }))
    expect(result.rows).toHaveLength(16)
    expect(result.rows.filter((item) => item.employeeId === employee.id).map((item) => item.kind))
      .toEqual(["ABSENT", "ABSENT", "HOLIDAY", "ABSENT", "ABSENT", "WEEKEND", "WEEKEND", "UPCOMING"])
    expect(result.rows.find((item) => item.date === "2026-10-14")).toMatchObject({ expectedWorkSeconds: 0, calendarName: "Company day" })
    expect(result.totals.absentCount).toBe(8)
  })

  it("uses custom weekends only without a calendar override, retaining agent/team/org precedence", () => {
    const custom = rule({ weekendDays: [0, 5] })
    const normal = buildMtmAttendanceReport(input({ from: "2026-10-16", to: "2026-10-17", rules: [custom], now: at("19:00", "2026-10-19") }))
    expect(normal.rows.map((item) => item.kind)).toEqual(["WEEKEND", "ABSENT"])
    const calendar = [override({ id: "org", date: "2026-10-16", kind: "EXCEPTION_WORKDAY" }),
      override({ id: "team", date: "2026-10-16", teamId: employee.teamId, kind: "PUBLIC_HOLIDAY" }),
      override({ id: "agent", date: "2026-10-16", agentId: employee.id, kind: "EXCEPTION_WORKDAY" })]
    const all = buildMtmAttendanceReport(input({ employees: [employee, secondEmployee], from: "2026-10-16", to: "2026-10-16",
      rules: [custom], calendar, now: at("19:00", "2026-10-19") }))
    expect(all.rows.map((item) => item.calendarKind)).toEqual(["EXCEPTION_WORKDAY", "EXCEPTION_WORKDAY"])
    const team = buildMtmAttendanceReport(input({ from: "2026-10-16", to: "2026-10-16", rules: [custom], calendar: calendar.slice(0, 2), now: at("19:00", "2026-10-19") }))
    expect(team.rows[0].kind).toBe("HOLIDAY")
  })

  it.each([["08:00", "UPCOMING"], ["09:10", "UPCOMING"], ["09:10:01", "ABSENT"]])("keeps an unstarted day at %s correctly classified", (now, kind) => {
    expect(buildMtmAttendanceReport(input({ now: at(now) })).rows[0].kind).toBe(kind)
  })

  it("counts today's open facts but never accumulates a forgotten past day indefinitely", () => {
    const open = completed({ status: "STARTED", completedAt: null, events: [event("START", "09:00")] })
    expect(row(open, { now: at("12:00") })).toMatchObject({ kind: "OPEN", workedSeconds: 10800, earlyLeaveSeconds: null })
    const report = buildMtmAttendanceReport(input({ workdays: [open], now: at("12:00", "2026-10-13") }))
    expect(report.rows[0]).toMatchObject({ kind: "MISSING_FINISH", factsState: "VALID", workedSeconds: null, pausedSeconds: 0 })
    expect(report.totals).toMatchObject({ workedSeconds: 0, unknownWorkedCount: 1, unknownPausedCount: 0, isComplete: false })
    const paused = row({ ...open, status: "PAUSED", events: [...open.events, event("PAUSE", "13:00")] }, { now: at("12:00", "2026-10-13") })
    expect(paused).toMatchObject({ kind: "MISSING_FINISH", workedSeconds: null, pausedSeconds: null })
  })

  it("uses the shared REOPEN pause semantics and server application order", () => {
    const events = [event("START", "09:00"), event("PAUSE", "13:00"), event("RESUME", "14:00"),
      { ...event("FINISH", "17:00"), appliedAt: at("17:00") },
      { ...event("REOPEN", "17:00"), appliedAt: at("18:00") }, event("RESUME", "18:00"), event("FINISH", "19:00")]
    const result = row(completed({ completedAt: at("19:00"), totalPausedSeconds: 7200, events: [...events].reverse() }))
    expect(result).toMatchObject({ factsState: "VALID", workedSeconds: 28800, pausedSeconds: 7200 })
    expect(result.events.filter((item) => item.occurredAt === "2026-10-12T13:00:00.000Z").map((item) => item.type)).toEqual(["FINISH", "REOPEN"])
  })

  it.each([
    ["missing journal", { events: [] }, "JOURNAL_INCOMPLETE"],
    ["missing finish event", { events: [event("START", "09:00")] }, "JOURNAL_INCOMPLETE"],
    ["missing completed timestamp", { completedAt: null }, "WORKDAY_INCONSISTENT"],
    ["paused without an open interval", { status: "PAUSED", completedAt: null }, "WORKDAY_INCONSISTENT"],
    ["contradictory pause total", { totalPausedSeconds: 3600 }, "PAUSE_TOTAL_MISMATCH"],
    ["bad timestamp", { startedAt: "yesterday" }, "TIMESTAMP_INVALID"],
    ["unknown event", { events: [event("START", "09:00"), event("UNKNOWN", "12:00"), event("FINISH", "18:00")] }, "EVENT_TYPE_INVALID"],
    ["future event", { events: [event("START", "09:00"), event("FINISH", "20:00")] }, "WORKDAY_INCONSISTENT"],
  ] satisfies Array<[string, Partial<MtmAttendanceWorkday>, string]>) ("marks %s unknown without fabricating time", (_, change, reason) => {
    const result = row(completed(change))
    expect(result).toMatchObject({ kind: "INVALID_FACTS", factsState: "INVALID", workedSeconds: null, pausedSeconds: null, lateSeconds: null, earlyLeaveSeconds: null })
    expect(result.invalidReasons).toContain(reason)
  })

  it("rejects break intervals outside corrected facts instead of manufacturing a replacement", () => {
    const result = row(completed({ startedAt: at("14:00"), totalPausedSeconds: 3600,
      events: [event("START", "09:00"), event("PAUSE", "12:00"), event("RESUME", "13:00"), event("FINISH", "18:00")] }))
    expect(result).toMatchObject({ kind: "INVALID_FACTS", workedSeconds: null, invalidReasons: ["WORKDAY_INCONSISTENT"] })
  })

  it("does not double count duplicate workdays", () => {
    const report = buildMtmAttendanceReport(input({ workdays: [completed(), completed({ id: "duplicate" })] }))
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].invalidReasons).toEqual(["DUPLICATE_WORKDAY"])
    expect(report.totals).toMatchObject({ workedSeconds: 0, unknownWorkedCount: 1, invalidFactsCount: 1 })
  })

  it("keeps historical timezone and rules when a later version is published", () => {
    const first = rule({})
    const future = rule({ id: "later", effectiveFrom: "2026-10-15", timezone: "Europe/Berlin", startTime: "08:00", lunchMinutes: 30 })
    const old = buildMtmAttendanceReport(input({ rules: [first], workdays: [completed()] }))
    expect(buildMtmAttendanceReport(input({ rules: [first, future], workdays: [completed()] }))).toEqual(old)
    const later = buildMtmAttendanceReport(input({ from: "2026-10-15", to: "2026-10-15", rules: [future, first], now: "2026-10-15T18:00:00Z" })).rows[0]
    expect(later).toMatchObject({ ruleId: "later", timezone: "Europe/Berlin", plannedStartAt: "2026-10-15T06:00:00.000Z", expectedWorkSeconds: 34200 })
  })

  it("retains working facts on days off without calling them late or early", () => {
    const result = row(completed({ startedAt: at("10:00"), completedAt: at("16:00"), events: [event("START", "10:00"), event("FINISH", "16:00")] }),
      { calendar: [override({})] })
    expect(result).toMatchObject({ kind: "WORKED", expectedWorkSeconds: 0, workedSeconds: 21600, lateSeconds: 0, earlyLeaveSeconds: 0, flags: ["WORKED_ON_DAY_OFF"] })
  })

  it("filters forms and sums exactly the same rows, retaining unknown counts", () => {
    const late = completed({ startedAt: at("09:21"), completedAt: at("17:30"), totalPausedSeconds: 1800,
      events: [event("START", "09:21"), event("PAUSE", "12:00"), event("RESUME", "12:30"), event("FINISH", "17:30")] })
    const open = completed({ id: "past-open", workDate: "2026-10-13", status: "STARTED", startedAt: at("09:00", "2026-10-13"),
      completedAt: null, events: [event("START", "09:00", "2026-10-13")] })
    const report = buildMtmAttendanceReport(input({ employees: [employee, secondEmployee], workdays: [late, open], to: "2026-10-14", now: at("19:00", "2026-10-14") }))
    const rows = filterMtmAttendanceRows(report.rows, { form: "LATE_EARLY", teamId: employee.teamId })
    expect(rows).toHaveLength(1)
    expect(summarizeMtmAttendanceRows(rows)).toMatchObject({ rowCount: 1, workedSeconds: 27540, pausedSeconds: 1800, lateSeconds: 1260, earlyLeaveSeconds: 1800, isComplete: true })
    expect(filterMtmAttendanceRows(report.rows, { form: "ABSENCES" })).toHaveLength(4)
    expect(filterMtmAttendanceRows(report.rows, { form: "JOURNAL" })).toHaveLength(2)
    expect(filterMtmAttendanceRows(report.rows, { employeeId: secondEmployee.id, from: "2026-10-13", to: "2026-10-13" })).toHaveLength(1)
    expect(report.totals).toMatchObject({ unknownWorkedCount: 1, isComplete: false })
  })

  it("returns only safe DTO fields, including phone and server timestamps but no locations or notes", () => {
    const privateEvent = { ...event("PAUSE", "13:00"), id: "pause", latitude: 40, longitude: 49, note: "private", payload: { secret: true },
      claimedAt: at("13:00"), appliedAt: at("13:01"), serverReceivedAt: at("13:01") }
    const privateDay = { ...completed({ totalPausedSeconds: 3600, events: [event("START", "09:00"), privateEvent, event("RESUME", "14:00"), event("FINISH", "18:00")] }), startLatitude: 40 }
    const result = row(privateDay)
    expect(result.events.find((item) => item.id === "pause")).toEqual({ id: "pause", type: "PAUSE", occurredAt: "2026-10-12T09:00:00.000Z",
      claimedAt: "2026-10-12T09:00:00.000Z", appliedAt: "2026-10-12T09:01:00.000Z", serverReceivedAt: "2026-10-12T09:01:00.000Z" })
    expect(JSON.stringify(result)).not.toMatch(/latitude|longitude|private|payload|secret/i)
  })

  it("rejects invalid or oversized input instead of silently truncating rows", () => {
    expect(() => buildMtmAttendanceReport(input({ to: "2026-10-11" }))).toThrow("MTM_ATTENDANCE_REPORT_INPUT_INVALID")
    expect(() => buildMtmAttendanceReport(input({ now: "2026-10-12T12:00:00" }))).toThrow("MTM_ATTENDANCE_REPORT_INPUT_INVALID")
    expect(() => buildMtmAttendanceReport(input({ employees: [employee, employee] }))).toThrow("MTM_ATTENDANCE_REPORT_INPUT_INVALID")
    expect(() => buildMtmAttendanceReport(input({ from: "2026-01-01", to: "2027-01-02" }))).toThrow("MTM_ATTENDANCE_REPORT_TOO_LARGE")
    expect(() => buildMtmAttendanceReport(input({ from: "2026-01-01", to: "2026-12-31",
      employees: Array.from({ length: 275 }, (_, index) => ({ ...employee, id: `agent-${index}` })) }))).toThrow("MTM_ATTENDANCE_REPORT_TOO_LARGE")
  })
})


describe("automatic attendance participation in reports", () => {
  it("does not invent absences before activation, including the tenant's midnight boundary", () => {
    const person = { ...employee, attendanceIncludedFrom: "2026-10-13T20:30:00Z" }
    const report = buildMtmAttendanceReport(input({ employees: [person], to: "2026-10-15", now: at("19:00", "2026-10-15") }))
    expect(report.rows.map(row => row.date)).toEqual(["2026-10-14", "2026-10-15"])
    expect(report.totals.absentCount).toBe(2)
  })
  it("keeps existing actual facts before automatic participation without fabricating a hiring date", () => {
    const person = { ...employee, attendanceIncludedFrom: "2026-10-13T20:30:00Z" }
    const report = buildMtmAttendanceReport(input({ employees: [person], workdays: [completed()], to: "2026-10-14", now: at("19:00", "2026-10-14") }))
    expect(report.rows.map(row => row.date)).toEqual([date, "2026-10-14"])
    expect(report.rows[0]).toMatchObject({ kind: "WORKED", workedSeconds: 32400, employmentState: "UNKNOWN" })
  })
  it("preserves earlier history and leaves excluded days out even when legacy field work continues", () => {
    const person = { ...employee, participationEvents: [{ included: false, effectiveAt: "2026-10-13T06:00:00Z" }] }
    const legacyDay = completed({ id: "field-day", workDate: "2026-10-13", startedAt: at("09:00", "2026-10-13"), completedAt: at("18:00", "2026-10-13"), events: [event("START", "09:00", "2026-10-13"), event("FINISH", "18:00", "2026-10-13")] })
    const workdays = [completed(), legacyDay]
    const before = JSON.stringify(workdays)
    const report = buildMtmAttendanceReport(input({ employees: [person], workdays, to: "2026-10-15", now: at("19:00", "2026-10-15") }))
    expect(report.rows.map(row => row.date)).toEqual([date]); expect(report.totals.workedSeconds).toBe(32400)
    expect(JSON.stringify(workdays)).toBe(before)
  })
  it("re-inclusion resumes on its civil date without filling the excluded interval", () => {
    const person = { ...employee, participationEvents: [{ included: true, effectiveAt: "2026-10-14T20:30:00Z" }, { included: false, effectiveAt: "2026-10-13T06:00:00Z" }] }
    const report = buildMtmAttendanceReport(input({ employees: [person], to: "2026-10-16", now: at("19:00", "2026-10-16") }))
    expect(report.rows.map(row => row.date)).toEqual([date, "2026-10-15", "2026-10-16"])
  })
  it("uses the latest same-day change and fails visibly for malformed boundaries", () => {
    const person = { ...employee, participationEvents: [{ included: false, effectiveAt: at("10:00") }, { included: true, effectiveAt: at("11:00") }] }
    expect(buildMtmAttendanceReport(input({ employees: [person] })).rows).toHaveLength(1)
    expect(() => buildMtmAttendanceReport(input({ employees: [{ ...person, attendanceIncludedFrom: "bad-date" }] }))).toThrow("MTM_ATTENDANCE_PARTICIPATION_HISTORY_INVALID")
  })
})
