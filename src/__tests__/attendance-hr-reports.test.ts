import { readFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { attendanceDayKindPresetCodes, defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { AttendanceViewConfigSchema, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"
import { ATTENDANCE_REPORTS, ATTENDANCE_REPORT_GROUPS } from "@/lib/mtm/attendance-reports-catalog"
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"

// Owner, 2026-10-15: "all the reports HR may need" — the ZKBioTime-style list
// plus the Azerbaijani «Forma N-1t», built on the one report engine.
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const t = createTranslator({ locale: "ru", messages: ru, namespace: "mtmAttendance" })
const kinds = attendanceDayKindPresetCodes(defaultAttendanceDayKinds(key => ({ ru: ru.mtmAttendance[`dayKindName${key}`], az: "x", en: "x" })), "RU")
const at = (date: string, time: string) => `${date}T${time}:00+04:00`
const day = (agentId: string, date: string, start: string, finish: string) => ({ id: `${agentId}-${date}`, agentId, workDate: date, status: "COMPLETED", startedAt: at(date, start),
  completedAt: at(date, finish), totalPausedSeconds: 0, events: [{ type: "START", occurredAt: at(date, start) }, { type: "FINISH", occurredAt: at(date, finish) }] })
const leave: AttendanceApprovedPeriod = { id: "leave", agentId: "rashad", startDate: "2026-10-07", endDate: "2026-10-08", decidedAt: "2026-10-01T08:00:00Z",
  details: { kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", dayKind: kinds.find(kind => kind.key === "ANNUAL_LEAVE")! } }
// Mon 5 – Fri 9 October 2026. Nigar: four days, late on Tuesday; Rashad: Monday, Tuesday absent, two days of leave, Friday.
const report = buildMtmAttendanceReport({ from: "2026-10-05", to: "2026-10-09", now: "2026-10-12T08:00:00Z", rules: [], calendar: [], dayKinds: kinds, approvedRequests: [leave],
  employees: [{ id: "nigar", name: "Нигяр", position: "Бухгалтер", teamId: "centre", teamName: "Центр" }, { id: "rashad", name: "Рашад", teamId: "north", teamName: "Север" }],
  workdays: [day("nigar", "2026-10-05", "09:00", "18:00"), day("nigar", "2026-10-06", "09:40", "18:00"), day("nigar", "2026-10-07", "09:00", "18:00"), day("nigar", "2026-10-08", "09:00", "18:00"),
    day("rashad", "2026-10-05", "09:00", "18:00"), day("rashad", "2026-10-09", "09:00", "17:00")] })
const config = (mode: AttendanceViewConfig["mode"], columns: string[], filters: Partial<AttendanceViewConfig["filters"]> = {}) =>
  AttendanceViewConfigSchema.parse({ version: 1, mode, columns, showTotals: true, filters: { from: "2026-10-05", to: "2026-10-09", form: "ALL", ...filters } })
const rowOf = (table: ReturnType<typeof buildAttendanceTable>, name: string) => Object.fromEntries(table.columns.map((column, index) => [column.key, table.rows.find(row => row.cells[0] === name || row.cells[1] === name)!.cells[index]]))

describe("HR reports on the report engine", () => {
  it("sums one row per employee: planned and worked days, absences, leave and attendance rate", () => {
    const table = buildAttendanceTable(report, config("SUMMARY", [...ATTENDANCE_REPORTS.summary.columns]), "ru", t)
    expect(table.title).toBe(ru.mtmAttendance.reportSummaryTitle)
    expect(table.rows.map(row => row.cells[0])).toEqual(["Нигяр", "Рашад"])
    expect(rowOf(table, "Нигяр")).toMatchObject({ plannedDays: 5, workedDays: 4, lateCount: 1, absent: 1, leaveDays: 0, attendanceRate: "80%" })
    // Leave days are not planned work and not an unexcused absence.
    expect(rowOf(table, "Рашад")).toMatchObject({ workedDays: 2, absent: 1, leaveDays: 2 })
  })

  it("shows the hours balance with its sign", () => {
    const table = buildAttendanceTable(report, config("BALANCE", [...ATTENDANCE_REPORTS.balance.columns]), "ru", t)
    const nigar = rowOf(table, "Нигяр"), rashad = rowOf(table, "Рашад")
    expect(String(nigar.balance)).toMatch(/^−/)   // one day absent
    expect(String(rashad.balance)).toMatch(/^−/)
    expect(nigar.expected).not.toBe("—")
  })

  it("puts one column per absence kind found in the period", () => {
    const table = buildAttendanceTable(report, config("ABSENCE_KINDS", [...ATTENDANCE_REPORTS.absenceKinds.columns]), "ru", t)
    const leaveColumn = table.columns.find(column => column.key === "kind:ANNUAL_LEAVE")!
    expect(leaveColumn.label).toContain(ru.mtmAttendance.dayKindNameANNUAL_LEAVE)
    expect(rowOf(table, "Рашад")["kind:ANNUAL_LEAVE"]).toBe(2)
    expect(rowOf(table, "Нигяр")["kind:ANNUAL_LEAVE"]).toBe("—")
  })

  it("groups by team", () => {
    const table = buildAttendanceTable(report, config("TEAM", [...ATTENDANCE_REPORTS.teams.columns]), "ru", t)
    expect(table.rows.map(row => row.cells[0])).toEqual(["Север", "Центр"])
    expect(rowOf(table, "Центр")).toMatchObject({ employees: 1, workedDays: 4, lateCount: 1 })
  })

  it("lays out «Forma N-1t»: number, name, position, unit, day codes, days and hours worked", () => {
    const table = buildAttendanceTable(report, config("MONTH", [...ATTENDANCE_REPORTS.n1t.columns], { from: "2026-10-01", to: "2026-10-31" }), "ru", t)
    expect(table.title).toBe(ru.mtmAttendance.reportN1tTitle)
    expect(table.columns.slice(0, 4).map(column => column.key)).toEqual(["index", "employee", "position", "team"])
    expect(table.columns[2].label).toBe(ru.mtmAttendance.reportPosition)
    expect(rowOf(table, "Нигяр").position).toBe("Бухгалтер"); expect(rowOf(table, "Рашад").position).toBe("—")
    expect(table.columns.filter(column => /^\d{4}-\d{2}-\d{2}$/.test(column.key))).toHaveLength(31)
    expect(table.rows.map(row => row.cells[0])).toEqual([1, 2])
    expect(rowOf(table, "Нигяр").workedDays).toBe(4)
  })

  it("dates in Azerbaijani never fall back to the root locale", () => {
    const az = JSON.parse(readFileSync("messages/az.json", "utf8"))
    const table = buildAttendanceTable(report, config("DAY", [...ATTENDANCE_REPORTS.day.columns]), "az", createTranslator({ locale: "az", messages: az, namespace: "mtmAttendance" }))
    expect(JSON.stringify(table)).not.toMatch(/M\d{2}\b/)
  })

  it("every catalogue table report is a valid saved-form config, and every card is in one group", () => {
    for (const [key, definition] of Object.entries(ATTENDANCE_REPORTS)) {
      if (definition.kind !== "table") continue
      const filters = definition.period === "month" ? { from: "2026-10-01", to: "2026-10-31" } : {}
      expect(() => config(definition.mode, [...definition.columns], { ...filters, form: definition.form }), key).not.toThrow()
    }
    expect(ATTENDANCE_REPORT_GROUPS.flatMap(group => group.reports).sort()).toEqual(Object.keys(ATTENDANCE_REPORTS).sort())
  })
})
