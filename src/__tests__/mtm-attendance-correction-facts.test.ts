import { describe, expect, it } from "vitest"
import { createTranslator } from "next-intl"
import az from "../../messages/az.json"
import ru from "../../messages/ru.json"
import en from "../../messages/en.json"
import { projectAttendanceCorrectionFacts } from "@/lib/mtm/attendance-correction-facts"
import { replayWorkforceWorkdayFacts } from "@/lib/workforce/workday-facts-replay"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import { buildMtmAttendanceReport, filterMtmAttendanceRows } from "@/lib/mtm/attendance-report"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { attendanceCorrectionLines, attendanceJournalEntries, attendanceMonthCell } from "@/lib/mtm/attendance-presentation"
import { ATTENDANCE_VIEW_COLUMNS, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

const date = "2026-10-12"
const at = (clock: string) => new Date(`${date}T${clock}:00.000Z`)
const now = new Date("2026-10-13T12:00:00Z")
const event = (type: string, clock: string) => ({ id: `${type}-${clock}`, type, occurredAt: at(clock), appliedAt: at(clock), clientEventId: null })
function day() { return { id: "workday-fixture", agentId: "employee-fixture", workDate: at("00:00"), status: "COMPLETED", startedAt: at("05:00"),
  completedAt: at("14:00"), pausedAt: null, totalPausedSeconds: 0, events: [] as ReturnType<typeof event>[] } }
function ledger(beforeFacts: unknown, afterFacts: unknown, id = "correction-fixture") { return { id, requestId: "request-fixture", source: "REQUEST_APPROVAL", occurredAt: now,
  beforeFacts, afterFacts, actorUser: { id: "reviewer-fixture", name: "Fixture reviewer" }, reason: "PRIVATE_REASON_MUST_NOT_LEAK", latitude: 48.12345 } }
function report(workday = day(), corrections = [ledger({ kind: "MISSING", workDate: date }, workforceWorkdayCorrectionFacts(workday))]) {
  return buildMtmAttendanceReport({ employees: [{ id: workday.agentId, name: "Fixture employee", teamId: null, teamName: null }],
    from: date, to: date, now, calendar: [], rules: [], workdays: [{ ...workday, correctionProjection: projectAttendanceCorrectionFacts(workday, corrections, now) }] })
}

describe("MTM correction replay and safe report projection", () => {
  it("creates complete facts from one missing-day ledger entry without inventing phone events", () => {
    const result = report()
    expect(result.rows[0]).toMatchObject({ kind: "WORKED", factsState: "VALID", workedSeconds: 32400, pausedSeconds: 0, events: [] })
    expect(result.rows[0].corrections).toHaveLength(1)
    expect(filterMtmAttendanceRows(result.rows, { form: "JOURNAL" })).toHaveLength(1)
    expect(result.totals).toMatchObject({ arrivedCount: 1, workedSeconds: 32400, unknownWorkedCount: 0 })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_REASON|48\.12345|clientEventId|latitude/)
  })
  it("keeps an unproved empty journal unknown", () => {
    const result = report(day(), [])
    expect(result.rows[0]).toMatchObject({ kind: "INVALID_FACTS", workedSeconds: null })
  })
  it.each(["events", "duplicate-genesis", "open-genesis", "paused-genesis", "wrong-date", "forged-before", "column-drift", "future-decision"])("rejects %s instead of producing worked hours", (kind) => {
    const workday = day()
    const after = workforceWorkdayCorrectionFacts(workday)
    const corrections = [ledger({ kind: "MISSING", workDate: date }, after)]
    if (kind === "events") workday.events = [event("START", "05:00"), event("FINISH", "14:00")]
    if (kind === "duplicate-genesis") corrections.push({ ...corrections[0], id: "second-genesis" })
    if (kind === "open-genesis") Object.assign(after, { status: "STARTED", completedAt: null })
    if (kind === "paused-genesis") after.totalPausedSeconds = 100
    if (kind === "wrong-date") corrections[0].beforeFacts = { kind: "MISSING", workDate: "2026-10-11" }
    if (kind === "forged-before") corrections[0].beforeFacts = { kind: "MISSING", workDate: date, employeeSaysSo: true }
    if (kind === "column-drift") workday.completedAt = at("15:00")
    if (kind === "future-decision") corrections[0].occurredAt = new Date(now.getTime() + 1000)
    expect(report(workday, corrections).rows[0]).toMatchObject({ kind: "INVALID_FACTS", workedSeconds: null, pausedSeconds: null })
  })
  it("closes the original pause once and preserves that closure after a later finish amendment", () => {
    const workday = { ...day(), completedAt: at("15:00"), totalPausedSeconds: 7200,
      events: [event("START", "05:00"), event("PAUSE", "12:00")] }
    const before = workforceWorkdayCorrectionFacts({ ...workday, status: "PAUSED", completedAt: null, pausedAt: at("12:00"), totalPausedSeconds: 0 })
    const firstAfter = { ...before, status: "COMPLETED" as const, pausedAt: null, completedAt: at("14:00").toISOString(), totalPausedSeconds: 7200 }
    const corrections = [ledger(firstAfter, workforceWorkdayCorrectionFacts(workday), "second"), ledger(before, firstAfter, "first")]
    const result = report(workday, corrections)
    expect(result.rows[0]).toMatchObject({ factsState: "VALID", workedSeconds: 28800, pausedSeconds: 7200, completedAt: at("15:00").toISOString() })
    expect(result.rows[0].corrections?.map((entry) => entry.id)).toEqual(["first", "second"])
    expect(result.rows[0].events.map((entry) => entry.type)).toEqual(["START", "PAUSE"])
  })
  it("extends genesis with one immutable chain and rejects forks or moving a boundary through a pause", () => {
    const workday = day()
    const initial = workforceWorkdayCorrectionFacts(workday)
    const changed = { ...initial, startedAt: at("04:30").toISOString() }
    const genesis = ledger({ kind: "MISSING", workDate: date }, initial)
    expect(replayWorkforceWorkdayFacts({ workdayId: workday.id, events: [], corrections: [ledger(initial, changed, "next"), genesis] }).correctionIds).toEqual([genesis.id, "next"])
    expect(() => replayWorkforceWorkdayFacts({ workdayId: workday.id, events: [], corrections: [genesis, ledger(initial, changed, "one"), ledger(initial, changed, "two")] })).toThrow(/unambiguous/)
    const original = { ...initial, totalPausedSeconds: 3600 }
    const pausedWorkday = { ...workday, startedAt: at("10:00"), totalPausedSeconds: 3600,
      events: [event("START", "05:00"), event("PAUSE", "08:00"), event("RESUME", "09:00"), event("FINISH", "14:00")] }
    expect(report(pausedWorkday, [ledger(original, workforceWorkdayCorrectionFacts(pausedWorkday))]).rows[0].factsState).toBe("INVALID")
  })
  it.each(["az", "ru", "en"] as const)("projects the same before/after, reviewer and clock in %s screen and all export modes", (locale) => {
    const translate = createTranslator({ locale, messages: { az, ru, en }[locale], namespace: "mtmAttendance" })
    const t = (key: string, values?: Record<string, string | number>) => translate(key as keyof typeof ru.mtmAttendance, values)
    const result = report()
    const row = result.rows[0]
    const [line] = attendanceCorrectionLines(row, locale, t)
    expect(line).toContain(t("reportCorrectionMissing"))
    expect(line).toContain("Fixture reviewer")
    expect(line).toContain("09:00:00")
    expect(line).toContain(locale === "en" ? "06:00:00 PM" : "18:00:00")
    expect(attendanceJournalEntries(row, locale, t)).toEqual([{ id: "correction:correction-fixture", description: line, phoneAt: null, serverAt: now.toISOString(), correction: true }])
    expect(attendanceMonthCell(row, t)).toBe("9:00 *")
    for (const mode of ["DAY", "JOURNAL", "MONTH"] as const) {
      const config: AttendanceViewConfig = { version: 1, mode, columns: [...ATTENDANCE_VIEW_COLUMNS[mode]], showTotals: true,
        filters: { from: mode === "MONTH" ? "2026-10-01" : date, to: mode === "MONTH" ? "2026-10-31" : date, form: mode === "JOURNAL" ? "JOURNAL" : "ALL" } }
      const table = buildAttendanceTable(result, config, locale, t)
      expect(JSON.stringify(table)).toContain(line)
      expect(table.totals.join(" ")).toContain("9:00")
      if (mode === "JOURNAL") expect(table.rows[0].cells[table.columns.findIndex((column) => column.key === "phoneAt")]).toBe("—")
    }
    const hiddenNotes = buildAttendanceTable(result, { version: 1, mode: "DAY", columns: ["employee", "worked"], showTotals: false, filters: { from: date, to: date, form: "ALL" } }, locale, t)
    expect(hiddenNotes.details.join(" ")).toContain(line)
  })
})
