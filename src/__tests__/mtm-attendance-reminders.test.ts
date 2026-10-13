import { describe, expect, it } from "vitest"
import { attendanceReminderKinds, AttendanceReminderPolicySchema } from "@/lib/mtm/attendance-reminder-contract"
import { buildMtmAttendanceReport, type MtmAttendanceReportInput, type MtmAttendanceWorkday } from "@/lib/mtm/attendance-report"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"
const date = "2026-10-12"
const at = (clock: string) => `${date}T${clock}:00+04:00`
const employee = { id: "fictional-employee", name: "Fictional employee", teamId: null, teamName: null }
const day = (start = "09:00", paused = false): MtmAttendanceWorkday => ({ id: "day", agentId: employee.id, workDate: date, status: paused ? "PAUSED" : "STARTED", startedAt: at(start), completedAt: null, totalPausedSeconds: 0,
  events: [{ type: "START", occurredAt: at(start) }, ...(paused ? [{ type: "PAUSE", occurredAt: at("17:00") }] : [])] })
function kinds(clock: string, change: Partial<MtmAttendanceReportInput> = {}) {
  const now = new Date(at(clock))
  const report = buildMtmAttendanceReport({ employees: [employee], workdays: [], calendar: [], rules: [], from: date, to: date, now, ...change })
  return attendanceReminderKinds(report.rows[0], now, 10)
}
function leave(kind = "ANNUAL_LEAVE", hourly = false): AttendanceApprovedPeriod {
  const dayKind = defaultAttendanceDayKinds(() => ({ az: "Fixture", ru: "Fixture", en: "Fixture" })).find(row => row.key === kind)!
  return { id: "approval", agentId: employee.id, startDate: date, endDate: date, decidedAt: at("07:00"), details: { kind: kind as AttendanceApprovedPeriod["details"]["kind"], dayKind, unit: hourly ? "HOURS" : "DAYS", startTime: hourly ? "09:00" : null, endTime: hourly ? "11:00" : null, timezone: "Asia/Baku" } }
}
describe("optional attendance reminder timing from the shared report", () => {
  it.each([["08:59", []], ["09:00", ["EMPLOYEE_START"]], ["09:10", ["EMPLOYEE_START"]], ["09:11", ["EMPLOYEE_START", "MANAGER_MISSING"]], ["18:00", []]])("handles the start/grace/end boundary %s", (clock, expected) => expect(kinds(clock)).toEqual(expected))
  it("does not close a day and suppresses finish reminders during a break", () => {
    expect(kinds("17:59", { workdays: [day()] })).toEqual([])
    expect(kinds("18:00", { workdays: [day()] })).toEqual(["EMPLOYEE_FINISH"])
    expect(kinds("18:01", { workdays: [day("09:00", true)] })).toEqual([])
    const completed = { ...day(), completedAt: at("18:00"), status: "COMPLETED", events: [...day().events, { type: "FINISH", occurredAt: at("18:00") }] }
    expect(kinds("18:01", { workdays: [completed] })).toEqual([])
  })
  it.each(["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY", "WEEKEND"] as const)("skips %s from the same calendar", kind => {
    expect(kinds("10:00", { calendar: [{ id: "holiday", date, kind, name: "Fixture", teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null }] })).toEqual([])
  })
  it.each(["ANNUAL_LEAVE", "SICK_LEAVE", "TIME_OFF"])("skips approved %s including a working-on-leave fact", kind => {
    const approvedRequests = [leave(kind)]
    expect(kinds("10:00", { approvedRequests })).toEqual([])
    expect(kinds("10:00", { approvedRequests, workdays: [day("09:30")] })).toEqual([])
  })
  it("resumes after an hourly absence and never calls excused arrival late", () => {
    const approvedRequests = [leave("HOURLY_ABSENCE", true)]
    expect(kinds("10:00", { approvedRequests })).toEqual([])
    expect(kinds("11:01", { approvedRequests })).toEqual(["EMPLOYEE_START", "MANAGER_MISSING"])
    expect(kinds("11:01", { approvedRequests, workdays: [day("11:00")] })).toEqual([])
  })
  it("reports later offline arrival only if the shared report still calls it late", () => {
    expect(kinds("10:00", { workdays: [day("09:11")] })).toEqual(["MANAGER_LATE"])
    expect(kinds("10:00", { workdays: [day("09:10")] })).toEqual([])
  })
  it("fails closed for invalid facts, stale dates and employment outside the interval", () => {
    expect(kinds("10:00", { workdays: [{ ...day(), events: [] }] })).toEqual([])
    expect(kinds("10:00", { from: "2026-10-11", to: "2026-10-11" })).toEqual([])
    expect(kinds("10:00", { employees: [{ ...employee, employmentEvents: [{ kind: "HIRE", effectiveAt: "2026-11-01T00:00:00Z" }] }] })).toEqual([])
  })
  it("does not accept truthy settings or unrelated setting names", () => {
    expect(AttendanceReminderPolicySchema.safeParse({ attendanceEmployeeRemindersEnabled: "true" }).success).toBe(false)
    expect(AttendanceReminderPolicySchema.safeParse({ attendanceEmployeeRemindersEnabled: true, attendanceEnabled: true }).success).toBe(false)
    expect(AttendanceReminderPolicySchema.parse({ attendanceManagerAlertsEnabled: false })).toEqual({ attendanceManagerAlertsEnabled: false })
  })
})


describe("reminders follow the canonical overnight source date", () => {
  const assignment = { agentId: employee.id, plan: { id: "night-plan", version: 1, createdAt: at("07:00"), teamId: null, teamName: null, memberCount: 1,
    value: { from: date, to: "2026-10-14", timezone: "Asia/Baku", attribution: "END_DAY" as const, preHolidayMinutes: null, preHolidayConfirmed: false, overtimeThresholdMinutes: null,
      cycle: [{ kind: "WORK" as const, startTime: "22:00", endTime: "06:00", nextDay: true, lunchMinutes: 0, lateGraceMinutes: 30 }] } } }
  const night = (clock: string, workdays: MtmAttendanceWorkday[] = [day("22:00")], approvedRequests: AttendanceApprovedPeriod[] = []) => {
    const now = new Date(clock), report = buildMtmAttendanceReport({ employees: [employee], workdays, calendar: [], rules: [], from: date, to: date, now, approvedRequests, shiftAssignments: [assignment] })
    return attendanceReminderKinds(report.rows[0], now, 10)
  }
  it("uses the saved shift grace instead of the fallback daytime rule", () => {
    expect(night(at("22:11"), [])).toEqual(["EMPLOYEE_START"])
    expect(night(at("22:31"), [])).toEqual(["EMPLOYEE_START", "MANAGER_MISSING"])
  })
  it("waits through midnight and prompts at the planned finish, including its missing-finish projection", () => {
    expect(night("2026-10-13T01:00:00+04:00")).toEqual([])
    expect(night("2026-10-13T05:59:00+04:00")).toEqual([])
    expect(night("2026-10-13T06:00:00+04:00")).toEqual(["EMPLOYEE_FINISH"])
    expect(night("2026-10-14T06:00:00+04:00")).toEqual([])
  })
  it("continues missing-start checks during the same night but not after the planned end", () => {
    expect(night("2026-10-13T01:00:00+04:00", [])).toEqual(["EMPLOYEE_START", "MANAGER_MISSING"])
    expect(night("2026-10-13T06:00:00+04:00", [])).toEqual([])
  })
  it("keeps a private break and an approved next-day absence quiet", () => {
    const paused = { ...day("22:00"), status: "PAUSED", events: [...day("22:00").events, { type: "PAUSE", occurredAt: "2026-10-13T05:00:00+04:00" }] }
    expect(night("2026-10-13T06:00:00+04:00", [paused])).toEqual([])
    const approved = { ...leave("HOURLY_ABSENCE", true), startDate: "2026-10-13", endDate: "2026-10-13", details: { ...leave("HOURLY_ABSENCE", true).details, startTime: "05:00", endTime: "07:00" } }
    expect(night("2026-10-13T06:00:00+04:00", [day("22:00")], [approved])).toEqual([])
  })
})
