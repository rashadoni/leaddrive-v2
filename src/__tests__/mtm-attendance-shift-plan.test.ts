import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { readFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { describe, expect, it } from "vitest"
import { AttendanceShiftValueSchema, type AttendanceShiftAssignment, type AttendanceShiftValue } from "@/lib/mtm/attendance-shift-contract"
import { attendanceAccountingRows, attendanceShiftForDate } from "@/lib/mtm/attendance-shift-plan"
const value: AttendanceShiftValue = { from: "2026-11-01", to: "2026-11-30", timezone: "Asia/Baku", attribution: "END_DAY", preHolidayMinutes: null, preHolidayConfirmed: false, overtimeThresholdMinutes: null,
  cycle: [{ kind: "WORK", startTime: "22:00", endTime: "06:00", nextDay: true, lunchMinutes: 60, lateGraceMinutes: 10 }, { kind: "OFF" }] }
const assignment: AttendanceShiftAssignment = { agentId: "fictional-employee", plan: { id: "fictional-plan", version: 1, createdAt: "2026-10-13T10:00:00Z", teamId: "fictional-old-team", teamName: "Fictional team", memberCount: 1, value } }
const resolve = (date: string, assignments = [assignment]) => attendanceShiftForDate(assignments, assignment.agentId, "fictional-new-team", date, [])
describe("frozen-roster shift cycle", () => {
  it("keeps historical membership despite a later team move, and attributes only the night shift to the following date", () => {
    expect(resolve("2026-11-01")).toMatchObject({ working: true, nextDay: true, accountingDate: "2026-11-02", startTime: "22:00", endTime: "06:00" })
    expect(resolve("2026-11-02")).toMatchObject({ working: false, accountingDate: "2026-11-02" })
    expect(resolve("2026-11-03")?.working).toBe(true)
    expect(attendanceShiftForDate([assignment], "another-employee", null, "2026-11-01", [])).toBeNull()
    expect(resolve("2026-10-31")).toBeNull()
    expect(resolve("2026-12-01")).toBeNull()
  })
  it("uses the highest published revision only on its own date range", () => {
    const next = { ...assignment, plan: { ...assignment.plan, id: "next-plan", version: 2, value: { ...value, from: "2026-11-10", to: "2026-11-11", attribution: "START_DAY" as const } } }
    expect(resolve("2026-11-09", [next, assignment])?.id).toBe("fictional-plan")
    expect(resolve("2026-11-10", [next, assignment])).toMatchObject({ id: "next-plan", accountingDate: "2026-11-10" })
    expect(resolve("2026-11-12", [next, assignment])?.id).toBe("fictional-plan")
  })
  it("shortens only a confirmed pre-holiday rule and never invents a statutory hour", () => {
    const calendar = [{ id: "fictional-holiday", date: "2026-11-02", kind: "PUBLIC_HOLIDAY" as const, name: "Fictional holiday", teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null }]
    expect(attendanceShiftForDate([assignment], assignment.agentId, null, "2026-11-01", calendar)?.shorteningMinutes).toBe(0)
    const confirmed = { ...assignment, plan: { ...assignment.plan, value: { ...value, preHolidayMinutes: 45, preHolidayConfirmed: true } } }
    expect(attendanceShiftForDate([confirmed], assignment.agentId, null, "2026-11-01", calendar)?.shorteningMinutes).toBe(45)
    expect(attendanceShiftForDate([confirmed], assignment.agentId, null, "2026-11-03", calendar)?.shorteningMinutes).toBe(0)
    expect(AttendanceShiftValueSchema.safeParse({ ...value, preHolidayMinutes: 60 }).success).toBe(false)
  })
  it("rejects unmarked overnight clocks, empty working time, excessive range and unsafe timezone", () => {
    expect(AttendanceShiftValueSchema.safeParse(value).success).toBe(true)
    for (const cycle of [[{ ...value.cycle[0], nextDay: false }], [{ ...value.cycle[0], lunchMinutes: 480 }], [{ ...value.cycle[0], endTime: "23:00" }]]) expect(AttendanceShiftValueSchema.safeParse({ ...value, cycle }).success).toBe(false)
    expect(AttendanceShiftValueSchema.safeParse({ ...value, to: "2027-03-01" }).success).toBe(false)
    expect(AttendanceShiftValueSchema.safeParse({ ...value, timezone: "unknown" }).success).toBe(false)
  })
  it("keeps a night shift open after midnight and detects an omitted finish only after its planned end", () => {
    const workday = { id: "fictional-night", agentId: assignment.agentId, workDate: "2026-11-01", status: "STARTED", startedAt: "2026-11-01T22:00:00+04:00", completedAt: null, pausedAt: null, totalPausedSeconds: 0,
      events: [{ type: "START", occurredAt: "2026-11-01T22:00:00+04:00" }] }
    const input = { from: "2026-11-01", to: "2026-11-01", employees: [{ id: assignment.agentId, name: "Fictional employee", teamId: null, teamName: null }], workdays: [workday], rules: [], calendar: [], shiftAssignments: [assignment] }
    const open = buildMtmAttendanceReport({ ...input, now: "2026-11-02T03:00:00+04:00" }).rows[0]
    expect(open).toMatchObject({ kind: "OPEN", factsState: "VALID", workedSeconds: 18000, accountingDate: "2026-11-02", expectedWorkSeconds: 25200 })
    expect(open.flags).not.toContain("MISSING_FINISH")
    expect(buildMtmAttendanceReport({ ...input, now: "2026-11-02T07:00:00+04:00" }).rows[0]).toMatchObject({ kind: "MISSING_FINISH", workedSeconds: null })
    const finished = { ...workday, status: "COMPLETED", completedAt: "2026-11-02T06:00:00+04:00", totalPausedSeconds: 3600,
      events: [...workday.events, { type: "PAUSE", occurredAt: "2026-11-02T02:00:00+04:00" }, { type: "RESUME", occurredAt: "2026-11-02T03:00:00+04:00" }, { type: "FINISH", occurredAt: "2026-11-02T06:00:00+04:00" }] }
    expect(buildMtmAttendanceReport({ ...input, workdays: [finished], now: "2026-11-02T07:00:00+04:00" }).rows[0]).toMatchObject({ kind: "WORKED", date: "2026-11-01", workedSeconds: 25200, pausedSeconds: 3600, lateSeconds: 0, earlyLeaveSeconds: 0 })
  })

  it("keeps calendar leave on its own day and retains every incoming/outgoing shift at a month boundary", () => {
    const source = buildMtmAttendanceReport({ from: "2026-10-31", to: "2026-11-30", now: "2026-12-01T12:00:00Z", employees: [{ id: assignment.agentId, name: "Fictional employee", teamId: null, teamName: null }], workdays: [], rules: [], calendar: [] })
    const template = source.rows[0]
    const original = [
      { ...template, date: "2026-10-31", accountingDate: "2026-11-01", workdayId: "incoming", kind: "WORKED" as const, workedSeconds: 25200 },
      { ...template, date: "2026-11-01", accountingDate: "2026-11-01", workdayId: "same-date", kind: "WORKED" as const, workedSeconds: 3600 },
      { ...template, date: "2026-11-02", accountingDate: "2026-11-03", workdayId: null, kind: "HOLIDAY" as const, workedSeconds: 0 },
      { ...template, date: "2026-11-03", accountingDate: "2026-11-04", workdayId: null, kind: "APPROVED_REQUEST" as const, workedSeconds: 0 },
      { ...template, date: "2026-11-30", accountingDate: "2026-12-01", workdayId: "outgoing", kind: "WORKED" as const, workedSeconds: 28800 },
    ]
    const accountingRows = attendanceAccountingRows(original, "2026-11-01", "2026-11-30")
    expect(accountingRows.map(row => [row.sourceDate, row.date])).toEqual([["2026-10-31", "2026-11-01"], ["2026-11-01", "2026-11-01"], ["2026-11-02", "2026-11-02"], ["2026-11-03", "2026-11-03"]])
    for (const locale of ["ru", "az", "en"] as const) {
      const t = createTranslator({ locale, messages: JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")), namespace: "mtmAttendance" })
      const table = buildAttendanceTable({ ...source, rows: original, accountingRows }, { version: 1, mode: "MONTH", columns: ["employee", "days", "worked"], filters: { from: "2026-11-01", to: "2026-11-30", form: "ALL" }, showTotals: true }, locale, t)
      expect(table.rows[0].cells[1]).toMatch(/7:00.*31.*1:00/)
      expect(table.rows[0].cells.at(-1)).toBe("8:00")
    }
    expect(original[0].date).toBe("2026-10-31")
  })
  it("uses the shortened planned end date if shortening moves it before midnight", () => {
    const plan = { ...assignment, plan: { ...assignment.plan, value: { ...value, preHolidayMinutes: 60, preHolidayConfirmed: true, cycle: [{ kind: "WORK" as const, startTime: "16:00", endTime: "00:30", nextDay: true, lunchMinutes: 60, lateGraceMinutes: 10 }] } } }
    const calendar = [{ id: "fixture-holiday", date: "2026-11-02", kind: "PUBLIC_HOLIDAY" as const, name: "Fixture holiday", teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null }]
    expect(attendanceShiftForDate([plan], assignment.agentId, null, "2026-11-01", calendar)).toMatchObject({ accountingDate: "2026-11-01", shorteningMinutes: 60 })
  })
  it("keeps ambiguous DST shift boundaries unknown", () => {
    const plan = { ...assignment, plan: { ...assignment.plan, value: { ...value, from: "2026-10-25", to: "2026-10-25", timezone: "Europe/Berlin", cycle: [{ kind: "WORK" as const, startTime: "02:30", endTime: "10:30", nextDay: false, lunchMinutes: 60, lateGraceMinutes: 10 }] } } }
    const report = buildMtmAttendanceReport({ from: "2026-10-25", to: "2026-10-25", now: "2026-10-26T12:00:00Z", employees: [{ id: assignment.agentId, name: "Fictional employee", teamId: null, teamName: null }], workdays: [], rules: [], calendar: [], shiftAssignments: [plan] })
    expect(report.rows[0]).toMatchObject({ kind: "INVALID_FACTS", workedSeconds: null, invalidReasons: ["SCHEDULE_INVALID"] })
  })

  it("uses next-day hourly permission for the end of an overnight shift without inventing leave days", () => {
    const startedAt = "2026-11-01T22:00:00+04:00", completedAt = "2026-11-02T04:00:00+04:00"
    const workday = { id: "night-excused", agentId: assignment.agentId, workDate: "2026-11-01", status: "COMPLETED", startedAt, completedAt, totalPausedSeconds: 0,
      events: [{ type: "START", occurredAt: startedAt }, { type: "FINISH", occurredAt: completedAt }] }
    const input = { from: "2026-11-01", to: "2026-11-01", now: "2026-11-02T08:00:00+04:00", employees: [{ id: assignment.agentId, name: "Fictional employee", teamId: null, teamName: null }], workdays: [workday], rules: [], calendar: [], shiftAssignments: [assignment] }
    expect(buildMtmAttendanceReport(input).rows[0].earlyLeaveSeconds).toBe(7200)
    const permission = { id: "fictional-hourly-permission", agentId: assignment.agentId, startDate: "2026-11-02", endDate: "2026-11-02", decidedAt: "2026-10-01T12:00:00Z",
      details: { kind: "HOURLY_ABSENCE" as const, unit: "HOURS" as const, startTime: "04:00", endTime: "06:00", timezone: "Asia/Baku", dayKind: defaultAttendanceDayKinds(() => ({ az: "Fixture", ru: "Fixture", en: "Fixture" })).find(day => day.key === "HOURLY_ABSENCE")! } }
    const row = buildMtmAttendanceReport({ ...input, approvedRequests: [permission] }).rows[0]
    expect(row).toMatchObject({ kind: "WORKED", earlyLeaveSeconds: 0, workedSeconds: 21600, annualLeaveDays: 0 })
    expect(row.approvedRequests).toHaveLength(1)
  })

})
