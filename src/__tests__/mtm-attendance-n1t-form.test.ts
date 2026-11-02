/**
 * One N-1t for accounting however many closes of 100 it was frozen in (owner, 2026-10-20).
 * The blocks a month is closed in must read back as exactly the N-1t the report builds for all
 * those people at once — lines, № 1..N, notes and one set of totals — in every language.
 */
import { readFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"
import { buildMtmAttendanceReport, type MtmAttendanceReport, type MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { attendanceN1tConfig } from "@/lib/mtm/attendance-month-snapshot"
import { attendanceN1tParts, joinAttendanceN1t, type AttendanceN1tBlock } from "@/lib/mtm/attendance-n1t-form"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"

const LOCALES = ["az", "ru", "en"] as const
const catalogues = Object.fromEntries(LOCALES.map(locale => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmAttendance as Record<string, string>]))
const text = (locale: (typeof LOCALES)[number]) => createTranslator({ locale, messages: { mtmAttendance: catalogues[locale] }, namespace: "mtmAttendance" })
const kinds = defaultAttendanceDayKinds(key => ({ az: catalogues.az[`dayKindName${key}`] ?? key, ru: catalogues.ru[`dayKindName${key}`] ?? key, en: catalogues.en[`dayKindName${key}`] ?? key }))
const kind = (key: string) => kinds.find(item => item.key === key)!
const config = attendanceN1tConfig("2026-09-01", "2026-09-30")
const at = (date: string, time: string) => `${date}T${time}:00+04:00`

/**
 * 250 invented people: arrivals that differ, corrected days, approved leave with its own day kind
 * (only in the second block, so the legend grows), people in another time zone (only in the last
 * block), and — as with a night shift counted on the 1st — accounting lines where some people
 * from the end of the list come first.
 */
function september(): MtmAttendanceReport {
  const employees = Array.from({ length: 250 }, (_, index) => ({ id: `p-${String(index + 1).padStart(3, "0")}`, name: `Demo işçi ${String(index + 1).padStart(3, "0")}`, position: "Kassir", teamId: "t1", teamName: "Satış" }))
  const workdays = employees.flatMap((person, index) => ["2026-09-01", "2026-09-02", "2026-09-29"].map(date => {
    const from = `09:${String(index % 45).padStart(2, "0")}`
    return { id: `${person.id}-${date}`, agentId: person.id, workDate: date, status: "COMPLETED", startedAt: at(date, from), completedAt: at(date, "18:00"), totalPausedSeconds: index % 3 ? 0 : 900,
      events: [{ type: "START", occurredAt: at(date, from) }, { type: "FINISH", occurredAt: at(date, "18:00") }] }
  }))
  const report = buildMtmAttendanceReport({ from: "2026-09-01", to: "2026-09-30", now: "2026-10-20T08:00:00Z", rules: [], calendar: [], employees, workdays, dayKinds: kinds } as never)
  const rows: MtmAttendanceReportRow[] = report.rows.map(row => {
    const number = Number(row.employeeId.slice(2))
    let next: MtmAttendanceReportRow = number > 230 ? { ...row, timezone: "Europe/Berlin" } : row
    if (row.date === "2026-09-02" && number % 40 === 7) next = { ...next, corrections: [{ id: `c-${row.employeeId}`, requestId: null, source: "REQUEST_APPROVAL", occurredAt: "2026-09-03T06:00:00Z",
      reviewer: { id: "r", name: "Demo kadr rəhbəri" }, before: { kind: "WORKDAY", facts: { startedAt: "2026-09-02T05:30:00Z", completedAt: "2026-09-02T14:00:00Z", totalPausedSeconds: 0 } },
      after: { startedAt: "2026-09-02T05:00:00Z", completedAt: "2026-09-02T14:00:00Z", totalPausedSeconds: 0 } }] as never }
    if (row.date === "2026-09-15" && number >= 120 && number < 125) next = { ...next, dayKind: kind("ANNUAL_LEAVE"), annualLeaveDays: 1,
      approvedRequests: [{ id: `l-${row.employeeId}`, agentId: row.employeeId, startDate: "2026-09-15", endDate: "2026-09-15", decidedAt: "2026-09-10T06:00:00Z",
        details: { kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", dayKind: kind("ANNUAL_LEAVE") } }] as never }
    return next
  })
  // Night-shift people counted on the 1st lead the accounting lines.
  const early = new Set(["p-200", "p-150"])
  return { ...report, rows, accountingRows: [...rows.filter(row => early.has(row.employeeId) && row.date === "2026-09-01"), ...rows.filter(row => !(early.has(row.employeeId) && row.date === "2026-09-01"))] }
}
const only = (report: MtmAttendanceReport, ids: readonly string[]): MtmAttendanceReport =>
  ({ ...report, rows: report.rows.filter(row => ids.includes(row.employeeId)), accountingRows: report.accountingRows?.filter(row => ids.includes(row.employeeId)) })
/** What the store freezes: blocks of 100 cut from the N-1t's own line order, each built from its own people. */
function blocks(report: MtmAttendanceReport, locale: (typeof LOCALES)[number], sizes = 100): AttendanceN1tBlock[] {
  const order = buildAttendanceTable(report, config, locale, text(locale)).rows.map(row => row.key), parts: AttendanceN1tBlock[] = []
  for (let index = 0; index < order.length; index += sizes) {
    const own = only(report, order.slice(index, index + sizes))
    parts.push({ table: buildAttendanceTable(own, config, locale, text(locale)), parts: attendanceN1tParts(own, config), asOf: report.asOf })
  }
  return parts
}

describe("one N-1t from closes of up to 100 people", () => {
  it.each(LOCALES)("joins three blocks into exactly the N-1t of all 250 (%s)", locale => {
    const report = september(), whole = buildAttendanceTable(report, config, locale, text(locale)), parts = blocks(report, locale)
    expect(parts.map(part => part.table.rows.length)).toEqual([100, 100, 50])
    // The blocks differ where it matters: own numbering from 1, own totals, own legend, own zones.
    expect(parts[1].table.rows[0].cells[0]).toBe(1)
    expect(parts[1].table.details[4]).not.toBe(parts[0].table.details[4])
    expect(parts[2].parts.zones).toEqual(["Asia/Baku", "Europe/Berlin"])
    expect(parts.map(part => part.parts.correctionLines)).toEqual([3, 2, 2])
    expect(parts[0].parts.zones).toEqual(["Asia/Baku"])
    const joined = joinAttendanceN1t(parts, text(locale))
    expect(joined).toEqual(whole)
    expect(joined.rows.map(row => row.cells[0])).toEqual(Array.from({ length: 250 }, (_, index) => index + 1))
    // The night-shift people stay first, as the N-1t lists them.
    expect(joined.rows.slice(0, 2).map(row => row.key)).toEqual(["p-150", "p-200"])
    expect(joined.totals).toEqual(whole.totals)
  })

  it("keeps one close exactly as it was stored, and continues the numbering after a part already closed", () => {
    const report = september(), [first] = blocks(report, "az")
    expect(joinAttendanceN1t([first], text("az"))).toBe(first.table)
    const rest = joinAttendanceN1t([first], text("az"), 151)
    expect(rest.rows.map(row => row.cells[0])).toEqual(Array.from({ length: 100 }, (_, index) => 151 + index))
    expect({ ...rest, rows: [] }).toEqual({ ...first.table, rows: [] })
  })

  it("keeps a line for each moment when parts were closed at different times", () => {
    const report = september(), [first, second] = blocks(report, "en"), later = { ...report, asOf: "2026-10-21T09:30:00.000Z" }
    const own = only(later, second.table.rows.map(row => row.key)), moved = { table: buildAttendanceTable(own, config, "en", text("en")), parts: attendanceN1tParts(own, config), asOf: later.asOf }
    const joined = joinAttendanceN1t([first, moved], text("en"))
    expect(joined.details.slice(1, 3)).toEqual([first.table.details[1], moved.table.details[1]])
    expect(joined.details[1]).not.toBe(joined.details[2])
  })

  it("refuses a frozen table whose notes do not fit its parts", () => {
    const [first, second] = blocks(september(), "az")
    expect(() => joinAttendanceN1t([first, { ...second, parts: { ...second.parts, correctionLines: 500 } }], text("az"))).toThrow("MTM_ATTENDANCE_MONTH_DAMAGED")
  })
})
