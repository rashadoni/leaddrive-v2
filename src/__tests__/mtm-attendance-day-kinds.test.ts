import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createTranslator } from "next-intl"
import ExcelJS from "exceljs"
import { AttendanceDayKindsSchema, attendanceDayKindPresetCodes, defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { buildAttendancePdf, buildAttendanceXlsx } from "@/lib/mtm/attendance-export"
import { attendancePdfText } from "./helpers/attendance-pdf"
import { attendanceMonthCell, attendanceStatusText } from "@/lib/mtm/attendance-presentation"
import type { AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

const dictionaries = Object.fromEntries(["az", "ru", "en"].map((locale) => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmAttendance]))
const defaults = () => defaultAttendanceDayKinds((key) => ({ az: dictionaries.az[`dayKindName${key}`], ru: dictionaries.ru[`dayKindName${key}`], en: dictionaries.en[`dayKindName${key}`] }))
describe("company day kinds", () => {
  it.each(["AZ", "RU"] as const)("has a valid %s preset and leaves legal payment treatment unspecified", (preset) => {
    const items = attendanceDayKindPresetCodes(defaults(), preset)
    expect(AttendanceDayKindsSchema.parse(items)).toHaveLength(32)
    expect(items.every((item) => item.paid === null && Object.values(item.names).every(Boolean))).toBe(true)
    const sick = items.find((item) => item.key === "SICK_LEAVE")!
    expect(sick.code).toBe(preset === "AZ" ? "X" : "Б")
  })
  it("rejects missing or archived system kinds, duplicate codes and executable-looking codes", () => {
    const items = defaults()
    expect(AttendanceDayKindsSchema.safeParse(items.filter((item) => item.key !== "WORKED")).success).toBe(false)
    for (const patch of [{ archived: true }, { code: items[1].code }, { code: "=NOW()" }]) {
      expect(AttendanceDayKindsSchema.safeParse(items.map((item, index) => index ? item : { ...item, ...patch })).success).toBe(false)
    }
    expect(AttendanceDayKindsSchema.safeParse([...items, items[0]]).success).toBe(false)
  })
  it("presets preserve company translations, custom kinds and edited treatment", () => {
    const items = defaults()
    items[0] = { ...items[0], names: { ...items[0].names, en: "Company work" }, paid: true }
    const custom = { ...items[0], key: "CUSTOM_TEST", code: "ZZ" }
    const changed = attendanceDayKindPresetCodes([...items, custom], "RU")
    expect(changed[0]).toMatchObject({ code: "Я", paid: true, names: { en: "Company work" } })
    expect(changed.at(-1)).toEqual(custom)
  })
  it.each(["az", "ru", "en"] as const)("uses the same edited status in %s screen cells, day/journal/month, XLSX and PDF without changing hours", async (locale) => {
    const t = createTranslator({ locale, messages: dictionaries[locale] })
    const items = defaults().map((item) => item.key === "WORKED" ? { ...item, code: "WX", names: { az: "Şirkət günü", ru: "День компании", en: "Company day" }, paid: false, countsAsWorked: false } : item)
    const at = (time: string) => `2026-10-12T${time}:00+04:00`
    const input = { from: "2026-10-01", to: "2026-10-31", now: "2026-11-01T12:00:00Z", rules: [], calendar: [],
      employees: [{ id: "employee", name: "Fixture employee", teamId: null, teamName: null }],
      workdays: [{ id: "day", agentId: "employee", workDate: "2026-10-12", status: "COMPLETED", startedAt: at("09:00"), completedAt: at("18:00"), totalPausedSeconds: 0,
        events: [{ type: "START", occurredAt: at("09:00") }, { type: "FINISH", occurredAt: at("18:00") }] }],
    }
    const report = buildMtmAttendanceReport({ ...input, dayKinds: items })
    expect(report.totals).toEqual(buildMtmAttendanceReport(input).totals)
    const row = report.rows.find((item) => item.workdayId === "day")!
    const status = attendanceStatusText(row, locale, t)
    expect(status).toBe(`WX · ${items[0].names[locale]}`)
    // 09:00–18:00 without a break, less the automatic 1:00 lunch (owner, 2026-10-16: «вычитать обед самому»).
    expect(attendanceMonthCell(row, t)).toBe("WX · 8:00")
    for (const mode of ["DAY", "MONTH", "JOURNAL"] as const) {
      const config: AttendanceViewConfig = { version: 1, mode, columns: mode === "MONTH" ? ["employee", "days", "worked"] : ["employee", "status"], showTotals: true,
        filters: { from: input.from, to: input.to, form: mode === "JOURNAL" ? "JOURNAL" : "ALL" } }
      const table = buildAttendanceTable(report, config, locale, t)
      expect(JSON.stringify(table)).toContain(mode === "MONTH" ? "WX · 8:00" : status)
      const file = await buildAttendanceXlsx(table).xlsx.writeBuffer()
      const book = new ExcelJS.Workbook(); await book.xlsx.load(file)
      expect(JSON.stringify(book.worksheets[0].getSheetValues())).toContain(mode === "MONTH" ? "WX · 8:00" : status)
      expect(attendancePdfText(buildAttendancePdf(table))).toContain(items[0].names[locale])
    }
  })
})
