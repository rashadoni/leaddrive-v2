import { attendancePdfText as pdfText } from "./helpers/attendance-pdf"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { AttendanceExportTooLarge, buildAttendancePdf, buildAttendanceXlsx } from "@/lib/mtm/attendance-export"
import { DEFAULT_ATTENDANCE_DAY_COLUMNS } from "@/lib/mtm/attendance-presentation"
import { DEFAULT_ATTENDANCE_MONTH_COLUMNS, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

const at = (time: string) => `2026-10-12T${time}:00+04:00`
const privateBreak = { type: "PAUSE", occurredAt: at("12:00"), latitude: 40.987654, longitude: 49.123456, note: "PRIVATE_BREAK_MARKER" }
const report = buildMtmAttendanceReport({
  employees: [{ id: "a", name: "=Fixture Əli Əliyev", teamId: "t", teamName: "+Fixture team" }, { id: "b", name: "Fixture unfinished", teamId: "t", teamName: "+Fixture team" }],
  from: "2026-10-01", to: "2026-10-31", now: "2026-10-13T19:00:00+04:00", rules: [], calendar: [],
  workdays: [
    { id: "finished", agentId: "a", workDate: "2026-10-12", status: "COMPLETED", startedAt: at("09:21"), completedAt: at("17:30"), totalPausedSeconds: 1800,
      events: [{ type: "START", occurredAt: at("09:21") }, privateBreak, { type: "RESUME", occurredAt: at("12:30") }, { type: "FINISH", occurredAt: at("17:30") }] },
    { id: "unfinished", agentId: "b", workDate: "2026-10-12", status: "STARTED", startedAt: at("09:00"), completedAt: null, totalPausedSeconds: 0, events: [{ type: "START", occurredAt: at("09:00") }] },
  ],
})
const config: AttendanceViewConfig = { version: 1, mode: "DAY", columns: [...DEFAULT_ATTENDANCE_DAY_COLUMNS], showTotals: true, filters: { from: "2026-10-12", to: "2026-10-12", form: "ALL" } }
function table(locale: "ru" | "az" | "en", settings = config) {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
  return buildAttendanceTable(report, settings, locale, createTranslator({ locale, messages, namespace: "mtmAttendance" }))
}


describe("attendance forms keep their numbers and privacy in actual files", () => {
  it.each(["ru", "az", "en"] as const)("exports the displayed ordered cells and Unicode to XLSX and PDF in %s", async (locale) => {
    const projected = table(locale)
    const workbook = buildAttendanceXlsx(projected)
    const bytes = await workbook.xlsx.writeBuffer()
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(bytes)
    const sheet = reopened.worksheets[0]
    expect(sheet.getRow(1).values).toEqual([undefined, ...projected.columns.map((column) => column.label)])
    expect(sheet.getRow(2).getCell(1).value).toBe("'=Fixture Əli Əliyev")
    expect(sheet.getRow(2).getCell(7).value).toBe("7:39")
    expect(sheet.getRow(2).getCell(8).value).toBe("0:30")
    expect(sheet.getRow(3).getCell(7).value).toBe("—")
    expect(sheet.getRow(2).getCell(1).type).toBe(ExcelJS.ValueType.String)
    const pdf = buildAttendancePdf(projected)
    if (process.env.MTM_ATTENDANCE_EXPORT_DIR) {
      mkdirSync(process.env.MTM_ATTENDANCE_EXPORT_DIR, { recursive: true })
      writeFileSync(`${process.env.MTM_ATTENDANCE_EXPORT_DIR}/attendance-day-${locale}.pdf`, pdf)
      writeFileSync(`${process.env.MTM_ATTENDANCE_EXPORT_DIR}/attendance-day-${locale}.xlsx`, Buffer.from(bytes))
    }
    const text = pdfText(pdf)
    expect(text).toContain("Əli Əliyev")
    expect(text).toContain("7:39")
    expect(text).toContain("0:21")
    expect(text).toContain(projected.title)
    const allCells = JSON.stringify(reopened.worksheets.map((sheet) => sheet.getSheetValues()))
    expect(allCells + text).not.toMatch(/40\.987654|49\.123456|PRIVATE_BREAK_MARKER|latitude|longitude/)
  })
  it("keeps custom ordering and hides totals while the monthly grid retains every day", () => {
    const custom = table("en", { ...config, columns: ["late", "employee", "worked"], showTotals: false })
    expect(custom.columns.map((column) => column.key)).toEqual(["late", "employee", "worked"])
    expect(custom.rows[0].cells).toEqual(["0:21", "=Fixture Əli Əliyev", "7:39"])
    expect(custom.totals).toEqual([])
    const month = table("en", { ...config, mode: "MONTH", columns: [...DEFAULT_ATTENDANCE_MONTH_COLUMNS], filters: { from: "2026-10-01", to: "2026-10-31", form: "ALL" } })
    expect(month.columns.filter((column) => column.key.startsWith("2026-"))).toHaveLength(31)
    expect(month.rows).toHaveLength(2)
    const text = pdfText(buildAttendancePdf(month))
    expect(text).toContain("Oct 31, 2026")
    expect(text).toContain("7:39")
    expect(text.replace(/\s+/g, " ")).toContain("partial total")
    expect(text).not.toMatch(/PRIVATE_BREAK_MARKER|40\.987654/)
  })
  it("exports phone and server time using only the safe event projection", () => {
    const journal = table("ru", { ...config, mode: "JOURNAL", columns: ["employee", "event", "phoneAt", "serverAt"], filters: { ...config.filters, form: "JOURNAL" } })
    expect(journal.rows).toHaveLength(5)
    expect(journal.rows[1].cells).toEqual(["=Fixture Əli Əliyev", "Начало перерыва", "12.10.2026, 12:00:00", "—"])
    expect(pdfText(buildAttendancePdf(journal))).not.toMatch(/PRIVATE_BREAK_MARKER|40\.987654/)
  })
  it("refuses an oversized file instead of silently truncating its rows", () => {
    const projected = table("en")
    const huge = { ...projected, rows: Array.from({ length: 10_001 }, () => projected.rows[0]) }
    expect(() => buildAttendanceXlsx(huge)).toThrow(AttendanceExportTooLarge)
    expect(() => buildAttendancePdf(huge)).toThrow(AttendanceExportTooLarge)
  })
})
