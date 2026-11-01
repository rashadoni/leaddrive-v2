import { attendancePdfText as pdfText } from "./helpers/attendance-pdf"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { AttendanceExportTooLarge, buildAttendancePdf, buildAttendanceXlsx } from "@/lib/mtm/attendance-export"
import { DEFAULT_ATTENDANCE_DAY_COLUMNS } from "@/lib/mtm/attendance-presentation"
import { ATTENDANCE_DAY_REPORT_COLUMNS, DEFAULT_ATTENDANCE_MONTH_COLUMNS, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

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
    // 8:09 present − 0:30 pressed break − the other 0:30 of the 13:00–14:00 lunch (owner, 2026-10-16: «вычитать обед самому»).
    expect(sheet.getRow(2).getCell(7).value).toBe("7:09")
    expect(sheet.getRow(2).getCell(8).value).toBe("0:30")
    expect(sheet.getRow(3).getCell(7).value).toBe("—")
    const note = createTranslator({ locale, messages: JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")), namespace: "mtmAttendance" })
    // A break was pressed (0:30), so the note must not say «no break pressed» (owner, 2026-11-01).
    const lunchNote = note("reportLunchAutoShortBreaks", { time: "0:30" })
    expect(String(sheet.getRow(2).getCell(11).value)).toContain(lunchNote)
    expect(String(sheet.getRow(2).getCell(11).value)).not.toContain(note("reportLunchAuto", { time: "0:30" }))
    expect(String(sheet.getRow(3).getCell(11).value)).not.toContain(lunchNote)
    expect(sheet.getRow(2).getCell(1).type).toBe(ExcelJS.ValueType.String)
    const pdf = buildAttendancePdf(projected)
    if (process.env.MTM_ATTENDANCE_EXPORT_DIR) {
      mkdirSync(process.env.MTM_ATTENDANCE_EXPORT_DIR, { recursive: true })
      writeFileSync(`${process.env.MTM_ATTENDANCE_EXPORT_DIR}/attendance-day-${locale}.pdf`, pdf)
      writeFileSync(`${process.env.MTM_ATTENDANCE_EXPORT_DIR}/attendance-day-${locale}.xlsx`, Buffer.from(bytes))
    }
    const text = pdfText(pdf)
    expect(text).toContain("Əli Əliyev")
    expect(text).toContain("7:09")
    expect(text).toContain("0:21")
    expect(text).toContain(projected.title)
    const allCells = JSON.stringify(reopened.worksheets.map((sheet) => sheet.getSheetValues()))
    expect(allCells + text).not.toMatch(/40\.987654|49\.123456|PRIVATE_BREAK_MARKER|latitude|longitude/)
  })
  it("keeps custom ordering and hides totals while the monthly grid retains every day", () => {
    const custom = table("en", { ...config, columns: ["late", "employee", "worked"], showTotals: false })
    expect(custom.columns.map((column) => column.key)).toEqual(["late", "employee", "worked"])
    expect(custom.rows[0].cells).toEqual(["0:21", "=Fixture Əli Əliyev", "7:09"])
    expect(custom.totals).toEqual([])
    const month = table("en", { ...config, mode: "MONTH", columns: [...DEFAULT_ATTENDANCE_MONTH_COLUMNS], filters: { from: "2026-10-01", to: "2026-10-31", form: "ALL" } })
    expect(month.columns.filter((column) => column.key.startsWith("2026-"))).toHaveLength(31)
    expect(month.rows).toHaveLength(2)
    const text = pdfText(buildAttendancePdf(month))
    expect(text).toContain("Oct 31, 2026")
    expect(text).toContain("7:09")
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


describe("approved HR catalogue periods remain visible in exports", () => {
  it.each(["DAY", "MONTH"] as const)("exports the frozen kind and approved period for %s without inventing hours", async mode => {
    const date = "2026-10-12"
    const dayKind = defaultAttendanceDayKinds(() => ({ az: "Demo təhsil", ru: "Учебный отпуск", en: "Fixture study leave" })).find(kind => kind.key === "STUDY_LEAVE")!
    const result = buildMtmAttendanceReport({ employees: [{ id: "employee", name: "Fictional employee", teamId: null, teamName: null }], workdays: [], rules: [], calendar: [], from: date, to: date, now: "2026-10-13T12:00:00Z",
      approvedRequests: [{ id: "record", agentId: "employee", startDate: date, endDate: date, decidedAt: "2026-10-12T12:00:00Z", details: { kind: "HR_RECORD", dayKind, unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku" } }] })
    const messages = JSON.parse(readFileSync("messages/en.json", "utf8"))
    const projected = buildAttendanceTable(result, { ...config, mode, columns: mode === "MONTH" ? [...DEFAULT_ATTENDANCE_MONTH_COLUMNS] : [...DEFAULT_ATTENDANCE_DAY_COLUMNS],
      filters: { from: mode === "MONTH" ? "2026-10-01" : date, to: mode === "MONTH" ? "2026-10-31" : date, form: "ALL" } }, "en", createTranslator({ locale: "en", messages, namespace: "mtmAttendance" }))
    const text = pdfText(buildAttendancePdf(projected))
    expect(text.replace(/\s+/g, " ")).toContain("Fixture study leave")
    expect(text).toContain("Approved:")
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await buildAttendanceXlsx(projected).xlsx.writeBuffer())
    const cells = JSON.stringify(book.worksheets.map(sheet => sheet.getSheetValues()))
    expect(cells).toContain("Fixture study leave")
    expect(result.totals).toMatchObject({ workedSeconds: 0, arrivedCount: 0, absentCount: 0 })
    expect(text + cells).not.toMatch(/submissionHash|recording|attachmentIds/)
  })
})

it("keeps approved-hour exclusions identical in the late form, Excel and PDF", async () => {
  const dayKind = defaultAttendanceDayKinds(() => ({ az: "İcazə", ru: "Отпроситься", en: "Approved absence" })).find(kind => kind.key === "HOURLY_ABSENCE")!
  const date = "2026-10-12"
  const result = buildMtmAttendanceReport({ employees: [{ id: "a", name: "Fictional approved employee", teamId: null, teamName: null }],
    from: date, to: date, now: "2026-10-13T12:00:00Z", rules: [], calendar: [],
    workdays: [{ id: "day", agentId: "a", workDate: date, status: "COMPLETED", startedAt: at("10:00"), completedAt: at("17:00"), totalPausedSeconds: 0,
      events: [{ type: "START", occurredAt: at("10:00") }, { type: "FINISH", occurredAt: at("17:00") }] }],
    approvedRequests: [["09:00", "10:00"], ["17:00", "18:00"]].map(([startTime, endTime]) => ({ id: startTime, agentId: "a", startDate: date, endDate: date, decidedAt: at("08:00"),
      details: { kind: "HOURLY_ABSENCE", unit: "HOURS", startTime, endTime, timezone: "Asia/Baku", dayKind } })) })
  const translate = createTranslator({ locale: "en", messages: JSON.parse(readFileSync("messages/en.json", "utf8")), namespace: "mtmAttendance" })
  const late = buildAttendanceTable(result, { ...config, filters: { from: date, to: date, form: "LATE_EARLY" } }, "en", translate)
  expect(late.rows).toHaveLength(0)
  expect(pdfText(buildAttendancePdf(late))).not.toContain("Fictional approved employee")
  const sheet = buildAttendanceXlsx(late).worksheets[0]
  expect(JSON.stringify(sheet.getSheetValues())).not.toContain("Fictional approved employee")
  const all = buildAttendanceTable(result, { ...config, columns: ["employee", "worked", "late", "early"] }, "en", translate)
  // 10:00–17:00 present − the automatic 13:00–14:00 lunch = 6:00 (owner, 2026-10-16: «вычитать обед самому»).
  expect(all.rows[0].cells.slice(0, 4)).toEqual(["Fictional approved employee", "6:00", "0:00", "0:00"])
  const actual = new ExcelJS.Workbook(); await actual.xlsx.load(await buildAttendanceXlsx(all).xlsx.writeBuffer())
  expect(actual.worksheets[0].getRow(2).getCell(2).value).toBe("6:00")
  expect(pdfText(buildAttendancePdf(all))).toContain("6:00")

})

// Owner, 2026-11-01: the day report's notes went to a second PDF page, and «İnformasiya TExnologiyaları» broke mid-word.
it("prints a day report on one page width, without cutting a word in the middle", () => {
  const wide = buildMtmAttendanceReport({
    employees: [{ id: "a", name: "Fixture Rəşad Rəhimov", position: "Rəhbər", departmentId: "d", departmentName: "İnformasiya TExnologiyaları", teamId: null, teamName: null }],
    from: "2026-10-12", to: "2026-10-12", now: "2026-10-13T19:00:00+04:00", rules: [], calendar: [],
    workdays: [{ id: "w", agentId: "a", workDate: "2026-10-12", status: "COMPLETED", startedAt: at("09:21"), completedAt: at("17:30"), totalPausedSeconds: 1800,
      events: [{ type: "START", occurredAt: at("09:21") }, { type: "PAUSE", occurredAt: at("12:00") }, { type: "RESUME", occurredAt: at("12:30") }, { type: "FINISH", occurredAt: at("17:30") }] }],
  })
  const messages = JSON.parse(readFileSync("messages/az.json", "utf8"))
  const day = buildAttendanceTable(wide, { ...config, columns: [...ATTENDANCE_DAY_REPORT_COLUMNS] }, "az", createTranslator({ locale: "az", messages, namespace: "mtmAttendance" }))
  expect(day.columns.map(column => column.key)).toContain("notes")
  const text = pdfText(buildAttendancePdf(day))
  expect(text).toContain("1 / 1")
  const lines = text.split("\n")
  expect(lines.some(line => line.includes("TExnologiyaları"))).toBe(true)
  expect(lines.some(line => /^TExnolog\S*$|^iyaları/.test(line) && !line.includes("TExnologiyaları"))).toBe(false)
  expect(text).toContain(messages.mtmAttendance.reportLunchAutoShortBreaks.replace("{time}", "0:30").split(" ")[0])
})
