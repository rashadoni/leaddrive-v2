import { describe, expect, it } from "vitest"
import { buildMtmAttendanceReport, filterMtmAttendanceRows, type MtmAttendanceReportInput } from "@/lib/mtm/attendance-report"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"

const date = "2026-10-12"
const at = (clock: string) => `${date}T${clock}:00+04:00`
const catalogue = defaultAttendanceDayKinds(() => ({ az: "Fixture", ru: "Fixture", en: "Fixture" }))
function allowance(startTime: string, endTime: string, kind: AttendanceApprovedPeriod["details"]["kind"] = "HOURLY_ABSENCE"): AttendanceApprovedPeriod {
  return { id: `${kind}-${startTime}`, agentId: "employee", startDate: date, endDate: date, decidedAt: "2026-10-11T12:00:00Z",
    details: { kind, unit: "HOURS", startTime, endTime, timezone: "Asia/Baku", dayKind: catalogue.find(item => item.key === (kind === "HR_RECORD" ? "HOURLY_ABSENCE" : kind))! } }
}
function input(start = "10:00", end: string | null = "17:00"): MtmAttendanceReportInput {
  return { employees: [{ id: "employee", name: "Fictional employee", teamId: null, teamName: null }], rules: [], calendar: [], from: date, to: date, now: "2026-10-13T12:00:00Z",
    workdays: [{ id: "workday", agentId: "employee", workDate: date, status: end ? "COMPLETED" : "STARTED", startedAt: at(start), completedAt: end ? at(end) : null, totalPausedSeconds: 0,
      events: [{ type: "START", occurredAt: at(start) }, ...(end ? [{ type: "FINISH", occurredAt: at(end) }] : [])] }] }
}

describe("approved hours suppress only the corresponding late/early violations", () => {
  it("keeps actual hours and journal while removing covered violations from the form and totals", () => {
    const original = buildMtmAttendanceReport(input())
    const result = buildMtmAttendanceReport({ ...input(), approvedRequests: [allowance("09:00", "10:00"), allowance("17:00", "18:00")] })
    expect(original.rows[0]).toMatchObject({ lateSeconds: 3600, earlyLeaveSeconds: 3600 })
    expect(result.rows[0]).toMatchObject({ startedAt: original.rows[0].startedAt, completedAt: original.rows[0].completedAt,
      // 10:00–17:00 present − the 13:00–14:00 lunch taken off automatically (owner, 2026-10-16: «вычитать обед самому»).
      workedSeconds: 21600, pausedSeconds: 0, lateSeconds: 0, earlyLeaveSeconds: 0, flags: [], events: original.rows[0].events })
    expect(result.totals).toMatchObject({ lateCount: 0, earlyLeaveCount: 0, lateSeconds: 0, earlyLeaveSeconds: 0 })
    expect(filterMtmAttendanceRows(result.rows, { form: "LATE_EARLY" })).toEqual([])
  })
  it("leaves uncovered time and does not subtract the grace allowance from a real violation", () => {
    const result = buildMtmAttendanceReport({ ...input("10:20", "16:40"), approvedRequests: [allowance("09:00", "10:00"), allowance("17:00", "18:00")] })
    expect(result.rows[0]).toMatchObject({ lateSeconds: 1200, earlyLeaveSeconds: 1200, flags: ["LATE_START", "EARLY_LEAVE"] })
    expect(filterMtmAttendanceRows(result.rows, { form: "LATE_EARLY" })).toHaveLength(1)
  })
  it("applies the effective grace only to the uncovered late interval", () => {
    expect(buildMtmAttendanceReport({ ...input("10:10", "18:00"), approvedRequests: [allowance("09:00", "10:00")] }).rows[0].lateSeconds).toBe(0)
    expect(buildMtmAttendanceReport({ ...input("10:11", "18:00"), approvedRequests: [allowance("09:00", "10:00")] }).rows[0].lateSeconds).toBe(660)
  })
  it("unions overlapping approvals, clips outside the interval, and retains an uncovered gap", () => {
    const periods = [allowance("08:00", "09:20"), allowance("09:10", "09:30"), allowance("09:45", "11:00")]
    expect(buildMtmAttendanceReport({ ...input("10:00", "18:00"), approvedRequests: periods }).rows[0].lateSeconds).toBe(900)
    expect(buildMtmAttendanceReport({ ...input("10:00", "18:00"), approvedRequests: [...periods, allowance("09:30", "09:45")] }).rows[0].lateSeconds).toBe(0)
  })
  it.each(["BUSINESS_TRIP", "REMOTE_WORK", "OVERTIME"] as const)("does not treat %s as permission to arrive late", kind => {
    expect(buildMtmAttendanceReport({ ...input(), approvedRequests: [allowance("09:00", "18:00", kind)] }).rows[0]).toMatchObject({ lateSeconds: 3600, earlyLeaveSeconds: 3600 })
  })
  it("supports hourly HR absence but does not excuse a recorded violation", () => {
    const period = allowance("09:00", "18:00", "HR_RECORD")
    expect(buildMtmAttendanceReport({ ...input(), approvedRequests: [period] }).rows[0]).toMatchObject({ lateSeconds: 0, earlyLeaveSeconds: 0 })
    period.details.dayKind = catalogue.find(item => item.key === "UNEXCUSED_ABSENCE")!
    expect(buildMtmAttendanceReport({ ...input(), approvedRequests: [period] }).rows[0]).toMatchObject({ lateSeconds: 3600, earlyLeaveSeconds: 3600 })
  })
  it("uses the request's frozen timezone, never the report's wall clock", () => {
    const period = allowance("08:00", "09:00") // Europe/Moscow = 09–10 Baku on this date.
    period.details.timezone = "Europe/Moscow"
    expect(buildMtmAttendanceReport({ ...input("10:00", "18:00"), approvedRequests: [period] }).rows[0].lateSeconds).toBe(0)
  })
  it("fails closed for invalid or ambiguous legacy request clocks", () => {
    const invalid = allowance("09:00", "10:00"); invalid.details.timezone = "Invalid/Zone"
    expect(buildMtmAttendanceReport({ ...input(), approvedRequests: [invalid] }).rows[0].lateSeconds).toBe(3600)
    const day = "2026-10-25", period = allowance("02:00", "03:00")
    period.startDate = day; period.endDate = day; period.details.timezone = "Europe/Berlin"
    const base = input("10:00", "18:00")
    const result = buildMtmAttendanceReport({ ...base, from: day, to: day, now: "2026-10-26T12:00:00Z",
      calendar: [{ id: "working-day", date: day, kind: "WORKING_DAY", name: null, teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null }],
      workdays: base.workdays.map(row => ({ ...row, workDate: day, startedAt: `${day}T10:00:00+04:00`, completedAt: `${day}T18:00:00+04:00`,
        events: [{ type: "START", occurredAt: `${day}T10:00:00+04:00` }, { type: "FINISH", occurredAt: `${day}T18:00:00+04:00` }] })), approvedRequests: [period] })
    expect(result.rows[0].lateSeconds).toBe(3600)
  })
  it("retains unknown early leave and missing finish, and never covers missing phone facts", () => {
    const result = buildMtmAttendanceReport({ ...input("10:00", null), approvedRequests: [allowance("09:00", "18:00")] })
    expect(result.rows[0]).toMatchObject({ kind: "MISSING_FINISH", workedSeconds: null, lateSeconds: 0, earlyLeaveSeconds: null, flags: ["MISSING_FINISH"] })
    const base = input(); const invalid = { ...base, workdays: [{ ...base.workdays[0], events: [] }] }
    expect(buildMtmAttendanceReport({ ...invalid, approvedRequests: [allowance("09:00", "18:00")] }).rows[0]).toMatchObject({ factsState: "INVALID", lateSeconds: null, earlyLeaveSeconds: null })
  })
  it("keeps work on a whole approved absence visible as a conflict without lateness", () => {
    const period = allowance("09:00", "18:00", "ANNUAL_LEAVE"); period.details.unit = "DAYS"; period.details.startTime = null; period.details.endTime = null
    expect(buildMtmAttendanceReport({ ...input(), approvedRequests: [period] }).rows[0]).toMatchObject({ kind: "WORKED", workedSeconds: 21600, lateSeconds: 0, earlyLeaveSeconds: 0, flags: ["WORKED_ON_APPROVED_ABSENCE"] })
  })
  it("does not let another employee's or another date's approval hide violations", () => {
    const wrongEmployee = allowance("09:00", "18:00"); wrongEmployee.agentId = "other"
    const wrongDate = allowance("09:00", "18:00"); wrongDate.startDate = "2026-10-11"; wrongDate.endDate = "2026-10-11"
    expect(buildMtmAttendanceReport({ ...input(), approvedRequests: [wrongEmployee, wrongDate] }).rows[0]).toMatchObject({ lateSeconds: 3600, earlyLeaveSeconds: 3600, flags: ["LATE_START", "EARLY_LEAVE"] })
  })
})
