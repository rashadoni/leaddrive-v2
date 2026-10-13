import { readFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { buildMtmAttendanceReport, type MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { attendanceOvertimeRows } from "@/lib/mtm/attendance-overtime"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { buildAttendanceXlsx, buildAttendancePdf } from "@/lib/mtm/attendance-export"
import { attendancePdfText } from "./helpers/attendance-pdf"
import { AttendanceViewConfigSchema, DEFAULT_ATTENDANCE_OVERTIME_COLUMNS } from "@/lib/mtm/attendance-view-contract"

const date = "2026-11-02", next = "2026-11-03"
const at = (clock: string, day = date) => `${day}T${clock}:00+04:00`
const employee = { id: "overtime-fixture", name: "=Demo employee", teamId: null, teamName: null }
function report() {
  const startedAt = at("09:00"), completedAt = at("20:15")
  return buildMtmAttendanceReport({ from: date, to: next, now: at("21:00", next), employees: [employee], rules: [], calendar: [],
    workdays: [{ id: "worked", agentId: employee.id, workDate: date, startedAt, completedAt, status: "COMPLETED", totalPausedSeconds: 3600,
      events: [{ type: "START", occurredAt: startedAt }, { type: "PAUSE", occurredAt: at("13:00"), latitude: 40.987654, longitude: 49.123456 }, { type: "RESUME", occurredAt: at("14:00") }, { type: "FINISH", occurredAt: completedAt }] }] })
}
function permission(id = "permission", startTime = "18:00", endTime = "19:00"): AttendanceApprovedPeriod {
  return { id, agentId: employee.id, startDate: date, endDate: date, decidedAt: at("08:00"),
    details: { kind: "OVERTIME", unit: "HOURS", startTime, endTime, timezone: "Asia/Baku", dayKind: defaultAttendanceDayKinds(() => ({ ru: "Fixture", az: "Fixture", en: "Fixture" })).find(kind => kind.key === "OVERTIME")! } }
}
const row = () => ({ ...report().rows[0], overtimeThresholdMinutes: 15 })
describe("overtime uses final report facts and independent approved allowances", () => {
  it("subtracts the actual shared pause total, compares the threshold without deducting it and does not turn permission into worked time", () => {
    const source = { ...row(), approvedRequests: [permission()] }
    expect(attendanceOvertimeRows([source])[0]).toMatchObject({ excessSeconds: 8100, thresholdSeconds: 900, approvedSeconds: 3600, state: "EXCEEDED" })
    expect(source.workedSeconds).toBe(36900)
  })
  it.each([0, 15, 135, 150])("compares an explicit %i minute threshold with a strict excess", minutes => {
    expect(attendanceOvertimeRows([{ ...row(), overtimeThresholdMinutes: minutes }])[0].state).toBe(minutes < 135 ? "EXCEEDED" : "WITHIN")
  })
  it("keeps missing thresholds and unknown work distinct from zero, and never produces negative excess", () => {
    expect(attendanceOvertimeRows([{ ...row(), overtimeThresholdMinutes: null }])[0].state).toBe("THRESHOLD_UNSET")
    for (const change of [{ kind: "OPEN", completedAt: null }, { factsState: "INVALID" }, { workedSeconds: null }]) {
      expect(attendanceOvertimeRows([{ ...row(), ...change } as MtmAttendanceReportRow])[0]).toMatchObject({ excessSeconds: null, state: "UNKNOWN" })
    }
    expect(attendanceOvertimeRows([{ ...row(), workedSeconds: 3600 }])[0].excessSeconds).toBe(0)
    expect(attendanceOvertimeRows([report().rows[1]])).toEqual([])
  })
  it("unions overlapping allowances and ignores absence or another employee's approvals", () => {
    const approvedRequests = [permission(), permission("duplicate"), permission("overlap", "18:30", "20:00"), { ...permission("other"), agentId: "other" }, { ...permission("leave"), details: { ...permission().details, kind: "HOURLY_ABSENCE" as const } }]
    expect(attendanceOvertimeRows([{ ...row(), approvedRequests }])[0].approvedSeconds).toBe(7200)
  })
  it("attributes a next-date allowance once to its recorded night shift, and preserves ambiguous/invalid approvals as unknown", () => {
    const approvedRequests = [{ ...permission(), startDate: next, endDate: next, details: { ...permission().details, startTime: "06:00", endTime: "07:00" } }]
    const night = { ...row(), startedAt: at("22:00"), completedAt: at("07:00", next), approvedRequests }
    const tomorrow = { ...report().rows[1], approvedRequests }
    expect(attendanceOvertimeRows([night, tomorrow]).map(item => item.approvedSeconds)).toEqual([3600])
    const overlappingDay = { ...night, date: next, workdayId: "second", startedAt: at("06:30", next) }
    expect(attendanceOvertimeRows([night, overlappingDay]).map(item => item.approvedSeconds)).toEqual([null, null])
    const invalid = { ...permission(), details: { ...permission().details, timezone: "invalid" } }
    expect(attendanceOvertimeRows([{ ...row(), approvedRequests: [invalid] }])[0].approvedSeconds).toBeNull()
  })
  it("includes a next-date approval after the scheduled end in the canonical night row", () => {
    const startedAt = at("22:00"), completedAt = at("07:00", next)
    const approved = { ...permission(), startDate: next, endDate: next, details: { ...permission().details, startTime: "06:00", endTime: "07:00" } }
    const result = buildMtmAttendanceReport({ from: date, to: next, now: at("21:00", next), employees: [employee], rules: [], calendar: [], approvedRequests: [approved],
      shiftAssignments: [{ agentId: employee.id, plan: { id: "night-plan", version: 1, createdAt: at("08:00"), teamId: null, teamName: null, memberCount: 1,
        value: { from: date, to: next, timezone: "Asia/Baku", attribution: "END_DAY", preHolidayMinutes: null, preHolidayConfirmed: false, overtimeThresholdMinutes: 0,
          cycle: [{ kind: "WORK", startTime: "22:00", endTime: "06:00", nextDay: true, lunchMinutes: 0, lateGraceMinutes: 0 }] } } }],
      workdays: [{ id: "night", agentId: employee.id, workDate: date, startedAt, completedAt, status: "COMPLETED", totalPausedSeconds: 0, events: [{ type: "START", occurredAt: startedAt }, { type: "FINISH", occurredAt: completedAt }] }] })
    expect(result.rows[0].approvedRequests).toHaveLength(1)
    expect(attendanceOvertimeRows(result.rows)[0]).toMatchObject({ approvedSeconds: 3600, excessSeconds: 3600 })
  })
  it.each(["ru", "az", "en"] as const)("exports the same overtime cells to real Excel/PDF in %s, without break location", async locale => {
    const source = report(); source.rows[0] = { ...row(), approvedRequests: [permission()] }
    const config = AttendanceViewConfigSchema.parse({ version: 1, mode: "OVERTIME", columns: [...DEFAULT_ATTENDANCE_OVERTIME_COLUMNS], showTotals: true, filters: { from: date, to: next, form: "ALL" } })
    const t = createTranslator({ locale, messages: JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")), namespace: "mtmAttendance" })
    const table = buildAttendanceTable(source, config, locale, t)
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0].cells.slice(2, 7)).toEqual(["8:00", "10:15", "2:15", "0:15", "1:00"])
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await buildAttendanceXlsx(table).xlsx.writeBuffer())
    expect(book.worksheets[0].getRow(2).getCell(1).value).toBe("'=Demo employee")
    expect(book.worksheets[0].getRow(2).getCell(5).value).toBe("2:15")
    const pdf = attendancePdfText(buildAttendancePdf(table))
    expect(pdf).toContain("2:15"); expect(pdf).toContain("1:00")
    expect(JSON.stringify(table) + pdf).not.toMatch(/40\.987654|49\.123456|latitude|longitude/)
    expect(AttendanceViewConfigSchema.safeParse({ ...config, filters: { ...config.filters, form: "LATE_EARLY" } }).success).toBe(false)
  })
})
