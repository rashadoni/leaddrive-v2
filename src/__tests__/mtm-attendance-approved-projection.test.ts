import { describe, expect, it } from "vitest"
import { buildMtmAttendanceReport, filterMtmAttendanceRows } from "@/lib/mtm/attendance-report"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"
const date = "2026-10-12"
const period: AttendanceApprovedPeriod = { id: "request-fixture", agentId: "employee-fixture", startDate: date, endDate: date, decidedAt: "2026-10-10T08:00:00Z",
  details: { kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", dayKind: defaultAttendanceDayKinds(() => ({ az: "Fixture", ru: "Fixture", en: "Fixture" })).find((item) => item.key === "ANNUAL_LEAVE")! } }
const input = { employees: [{ id: period.agentId, name: "Fictional employee", teamId: null, teamName: null }], from: date, to: date, now: "2026-10-13T12:00:00Z", rules: [], calendar: [], workdays: [] }
describe("approved attendance requests in the shared report", () => {
  it("shows the frozen leave kind instead of unexcused absence without creating worked hours", () => {
    const result = buildMtmAttendanceReport({ ...input, approvedRequests: [period] })
    expect(result.rows[0]).toMatchObject({ kind: "APPROVED_REQUEST", factsState: "NONE", workedSeconds: 0, expectedWorkSeconds: 0, dayKind: period.details.dayKind })
    expect(result.totals).toMatchObject({ absentCount: 0, arrivedCount: 0, workedSeconds: 0 })
    expect(filterMtmAttendanceRows(result.rows, { form: "ABSENCES" })).toHaveLength(0)
  })
  it("preserves a holiday inside leave and scopes the decision to its employee and dates", () => {
    const result = buildMtmAttendanceReport({ ...input, approvedRequests: [period], calendar: [{ id: "holiday", date, kind: "PUBLIC_HOLIDAY", name: "Fictional holiday", teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null }] })
    expect(result.rows[0]).toMatchObject({ kind: "HOLIDAY", calendarName: "Fictional holiday", expectedWorkSeconds: 0 })
    for (const change of [{ agentId: "someone-else" }, { startDate: "2026-10-13", endDate: "2026-10-14" }]) {
      expect(buildMtmAttendanceReport({ ...input, approvedRequests: [{ ...period, ...change }] }).totals.absentCount).toBe(1)
    }
  })
  it("retains genuine phone facts and flags work on leave", () => {
    const startedAt = `${date}T05:00:00Z`, completedAt = `${date}T14:00:00Z`
    const result = buildMtmAttendanceReport({ ...input, approvedRequests: [period], workdays: [{ id: "day", agentId: period.agentId, workDate: date, status: "COMPLETED", startedAt, completedAt, totalPausedSeconds: 0,
      events: [{ type: "START", occurredAt: startedAt }, { type: "FINISH", occurredAt: completedAt }] }] })
    expect(result.rows[0]).toMatchObject({ kind: "WORKED", factsState: "VALID", workedSeconds: 32400, flags: ["WORKED_ON_APPROVED_ABSENCE"] })
    expect(result.rows[0].events).toHaveLength(2)
  })
  it("projects a manual catalogue kind and still keeps a holiday inside manual annual leave", () => {
    const manual: AttendanceApprovedPeriod = { ...period, details: { ...period.details, kind: "HR_RECORD" } }
    const ordinary = buildMtmAttendanceReport({ ...input, approvedRequests: [manual] })
    expect(ordinary.rows[0]).toMatchObject({ kind: "APPROVED_REQUEST", dayKind: period.details.dayKind, workedSeconds: 0, expectedWorkSeconds: 0 })
    const holiday = buildMtmAttendanceReport({ ...input, approvedRequests: [manual], calendar: [{ id: "holiday", date, kind: "PUBLIC_HOLIDAY", name: "Fixture holiday", teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null }] })
    expect(holiday.rows[0].kind).toBe("HOLIDAY")
  })
  it("never masks invalid phone facts with an approved period", () => {
    const row = buildMtmAttendanceReport({ ...input, approvedRequests: [period], workdays: [{ id: "invalid-day", agentId: period.agentId, workDate: date, status: "COMPLETED", startedAt: `${date}T05:00:00Z`, completedAt: `${date}T14:00:00Z`, totalPausedSeconds: 0, events: [] }] }).rows[0]
    expect(row.kind).toBe("INVALID_FACTS")
    expect(row.approvedRequests).toHaveLength(1)
  })

  it("keeps a recorded unexcused absence in the absence form", () => {
    const dayKind = defaultAttendanceDayKinds(() => ({ az: "Fixture", ru: "Fixture", en: "Fixture" })).find(kind => kind.key === "UNEXCUSED_ABSENCE")!
    const result = buildMtmAttendanceReport({ ...input, approvedRequests: [{ ...period, details: { ...period.details, kind: "HR_RECORD", dayKind } }] })
    expect(result.rows[0]).toMatchObject({ kind: "ABSENT", dayKind })
    expect(result.totals.absentCount).toBe(1)
    expect(filterMtmAttendanceRows(result.rows, { form: "ABSENCES" })).toHaveLength(1)
  })

})
