import { describe, expect, it } from "vitest"
import { attendanceEmploymentOnDate, type AttendanceEmploymentEvent } from "@/lib/mtm/attendance-employment"
import { buildMtmAttendanceReport, filterMtmAttendanceRows, type MtmAttendanceReportInput } from "@/lib/mtm/attendance-report"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"
const kinds = defaultAttendanceDayKinds(() => ({ az: "Fixture", ru: "Fixture", en: "Fixture" }))
const events: AttendanceEmploymentEvent[] = [
  { kind: "HIRE", effectiveAt: "2026-10-12T05:00:00Z" },
  { kind: "TERMINATION", effectiveAt: "2026-10-13T20:00:00Z" },
  { kind: "REHIRE", effectiveAt: "2026-10-16T05:00:00Z" },
]
function input(): MtmAttendanceReportInput { return { employees: [{ id: "employee", name: "Fictional employee", teamId: null, teamName: null, employmentEvents: events }],
  workdays: [], rules: [], calendar: [], dayKinds: kinds, from: "2026-10-09", to: "2026-10-16", now: "2026-10-17T12:00:00Z" } }
const leave: AttendanceApprovedPeriod = { id: "leave", agentId: "employee", startDate: "2026-10-09", endDate: "2026-10-16", decidedAt: "2026-10-08T10:00:00Z",
  details: { kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", dayKind: kinds.find(kind => kind.key === "ANNUAL_LEAVE")! } }
describe("explicit employment dates and leave edge cases", () => {
  it("does not count pre-hire, post-termination or the rehire gap as absence", () => {
    const result = buildMtmAttendanceReport(input())
    expect(result.rows.filter(row => row.kind === "NOT_EMPLOYED").map(row => row.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-14", "2026-10-15"])
    expect(filterMtmAttendanceRows(result.rows, { form: "ABSENCES" }).map(row => row.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-16"])
    expect(result.totals.absentCount).toBe(3)
    expect(result.rows[0]).toMatchObject({ employmentState: "NOT_EMPLOYED", expectedWorkSeconds: 0, dayKind: { key: "NOT_EMPLOYED" } })
  })
  it("keeps unknown history explicit and never infers a hire from directory status", () => {
    const base = input()
    const result = buildMtmAttendanceReport({ ...base, employees: [{ ...base.employees[0], employmentEvents: [] }] })
    expect(result.rows.every(row => row.employmentState === "UNKNOWN")).toBe(true)
    expect(result.rows[0].kind).toBe("ABSENT")
    expect(attendanceEmploymentOnDate([{ kind: "TERMINATION", effectiveAt: "2026-10-15T08:00:00Z" }], "2026-10-12", "Asia/Baku")).toBe("UNKNOWN")
  })
  it("uses the rule timezone for midnight termination, retains any employed part of a civil date", () => {
    expect(attendanceEmploymentOnDate(events, "2026-10-14", "Asia/Baku")).toBe("NOT_EMPLOYED")
    expect(attendanceEmploymentOnDate(events, "2026-10-13", "Asia/Baku")).toBe("EMPLOYED")
    expect(attendanceEmploymentOnDate(events, "2026-10-13", "UTC")).toBe("EMPLOYED")
    expect(attendanceEmploymentOnDate(events, "2026-10-16", "Asia/Baku")).toBe("EMPLOYED")
  })
  it("retains actual work outside employment as a conflict without lateness or invented absence", () => {
    const date = "2026-10-14", startedAt = `${date}T06:00:00Z`, completedAt = `${date}T13:00:00Z`
    const result = buildMtmAttendanceReport({ ...input(), from: date, to: date, workdays: [{ id: "day", agentId: "employee", workDate: date, status: "COMPLETED", startedAt, completedAt, totalPausedSeconds: 0,
      events: [{ type: "START", occurredAt: startedAt }, { type: "FINISH", occurredAt: completedAt }] }] })
    expect(result.rows[0]).toMatchObject({ kind: "WORKED", workedSeconds: 25200, expectedWorkSeconds: 0, lateSeconds: 0, earlyLeaveSeconds: 0, flags: ["WORKED_OUTSIDE_EMPLOYMENT"] })
    expect(result.rows[0].events).toHaveLength(2)
    expect(filterMtmAttendanceRows(result.rows, { form: "ABSENCES" })).toHaveLength(0)
  })
  it("a holiday inside leave and dates outside employment consume no annual leave", () => {
    const result = buildMtmAttendanceReport({ ...input(), approvedRequests: [leave], calendar: [{ id: "holiday", date: "2026-10-13", kind: "PUBLIC_HOLIDAY", name: "Fictional holiday", agentId: null, teamId: null, movedToDate: null, routePlanningAllowed: null }] })
    expect(result.totals.annualLeaveDays).toBe(2)
    expect(result.rows.filter(row => row.annualLeaveDays === 1).map(row => row.date)).toEqual(["2026-10-12", "2026-10-16"])
    expect(result.rows.find(row => row.date === "2026-10-13")).toMatchObject({ kind: "HOLIDAY", annualLeaveDays: 0 })
  })
  it("keeps work on leave visible and returns all used days when the approval is removed", () => {
    const date = "2026-10-12", startedAt = `${date}T05:00:00Z`, completedAt = `${date}T14:00:00Z`
    const base = { ...input(), from: date, to: date, workdays: [{ id: "day", agentId: "employee", workDate: date, status: "COMPLETED", startedAt, completedAt, totalPausedSeconds: 0,
      events: [{ type: "START", occurredAt: startedAt }, { type: "FINISH", occurredAt: completedAt }] }] }
    const approved = buildMtmAttendanceReport({ ...base, approvedRequests: [leave] })
    expect(approved.rows[0]).toMatchObject({ kind: "WORKED", workedSeconds: 32400, annualLeaveDays: 1, flags: ["WORKED_ON_APPROVED_ABSENCE"] })
    const cancelled = buildMtmAttendanceReport(base)
    expect(cancelled.totals.annualLeaveDays).toBe(0)
    expect(cancelled.rows[0]).toMatchObject({ kind: "WORKED", workedSeconds: 32400, flags: [] })
    expect(cancelled.rows[0].events).toEqual(approved.rows[0].events)
  })
})
