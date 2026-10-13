import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { describe, expect, it } from "vitest"
import { AttendanceShiftValueSchema, type AttendanceShiftAssignment, type AttendanceShiftValue } from "@/lib/mtm/attendance-shift-contract"
import { attendanceShiftForDate } from "@/lib/mtm/attendance-shift-plan"
const value: AttendanceShiftValue = { from: "2026-11-01", to: "2026-11-30", timezone: "Asia/Baku", attribution: "END_DAY", preHolidayMinutes: null, preHolidayConfirmed: false, overtimeThresholdMinutes: null,
  cycle: [{ kind: "WORK", startTime: "22:00", endTime: "06:00", nextDay: true, lunchMinutes: 60, lateGraceMinutes: 10 }, { kind: "OFF" }] }
const assignment: AttendanceShiftAssignment = { agentId: "fictional-employee", plan: { id: "fictional-plan", version: 1, createdAt: "2026-10-13T10:00:00Z", teamId: "fictional-old-team", teamName: "Fictional team", memberCount: 1, value } }
const resolve = (date: string, assignments = [assignment]) => attendanceShiftForDate(assignments, assignment.agentId, "fictional-new-team", date, [])
describe("frozen-roster shift cycle", () => {
  it("keeps historical membership despite a later team move, and attributes only the night shift to the following date", () => {
    expect(resolve("2026-11-01")).toMatchObject({ working: true, nextDay: true, accountingDate: "2026-11-02", startTime: "22:00", endTime: "06:00" })
    expect(resolve("2026-11-02")).toMatchObject({ working: false, accountingDate: "2026-11-02" })
    expect(resolve("2026-11-03")?.working).toBe(true)
    expect(attendanceShiftForDate([assignment], "another-employee", null, "2026-11-01", [])).toBeNull()
    expect(resolve("2026-10-31")).toBeNull()
    expect(resolve("2026-12-01")).toBeNull()
  })
  it("uses the highest published revision only on its own date range", () => {
    const next = { ...assignment, plan: { ...assignment.plan, id: "next-plan", version: 2, value: { ...value, from: "2026-11-10", to: "2026-11-11", attribution: "START_DAY" as const } } }
    expect(resolve("2026-11-09", [next, assignment])?.id).toBe("fictional-plan")
    expect(resolve("2026-11-10", [next, assignment])).toMatchObject({ id: "next-plan", accountingDate: "2026-11-10" })
    expect(resolve("2026-11-12", [next, assignment])?.id).toBe("fictional-plan")
  })
  it("shortens only a confirmed pre-holiday rule and never invents a statutory hour", () => {
    const calendar = [{ id: "fictional-holiday", date: "2026-11-02", kind: "PUBLIC_HOLIDAY" as const, name: "Fictional holiday", teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null }]
    expect(attendanceShiftForDate([assignment], assignment.agentId, null, "2026-11-01", calendar)?.shorteningMinutes).toBe(0)
    const confirmed = { ...assignment, plan: { ...assignment.plan, value: { ...value, preHolidayMinutes: 45, preHolidayConfirmed: true } } }
    expect(attendanceShiftForDate([confirmed], assignment.agentId, null, "2026-11-01", calendar)?.shorteningMinutes).toBe(45)
    expect(attendanceShiftForDate([confirmed], assignment.agentId, null, "2026-11-03", calendar)?.shorteningMinutes).toBe(0)
    expect(AttendanceShiftValueSchema.safeParse({ ...value, preHolidayMinutes: 60 }).success).toBe(false)
  })
  it("rejects unmarked overnight clocks, empty working time, excessive range and unsafe timezone", () => {
    expect(AttendanceShiftValueSchema.safeParse(value).success).toBe(true)
    for (const cycle of [[{ ...value.cycle[0], nextDay: false }], [{ ...value.cycle[0], lunchMinutes: 480 }], [{ ...value.cycle[0], endTime: "23:00" }]]) expect(AttendanceShiftValueSchema.safeParse({ ...value, cycle }).success).toBe(false)
    expect(AttendanceShiftValueSchema.safeParse({ ...value, to: "2027-03-01" }).success).toBe(false)
    expect(AttendanceShiftValueSchema.safeParse({ ...value, timezone: "unknown" }).success).toBe(false)
  })
  it("keeps a night shift open after midnight and detects an omitted finish only after its planned end", () => {
    const workday = { id: "fictional-night", agentId: assignment.agentId, workDate: "2026-11-01", status: "STARTED", startedAt: "2026-11-01T22:00:00+04:00", completedAt: null, pausedAt: null, totalPausedSeconds: 0,
      events: [{ type: "START", occurredAt: "2026-11-01T22:00:00+04:00" }] }
    const input = { from: "2026-11-01", to: "2026-11-01", employees: [{ id: assignment.agentId, name: "Fictional employee", teamId: null, teamName: null }], workdays: [workday], rules: [], calendar: [], shiftAssignments: [assignment] }
    const open = buildMtmAttendanceReport({ ...input, now: "2026-11-02T03:00:00+04:00" }).rows[0]
    expect(open).toMatchObject({ kind: "OPEN", factsState: "VALID", workedSeconds: 18000, accountingDate: "2026-11-02", expectedWorkSeconds: 25200 })
    expect(open.flags).not.toContain("MISSING_FINISH")
    expect(buildMtmAttendanceReport({ ...input, now: "2026-11-02T07:00:00+04:00" }).rows[0]).toMatchObject({ kind: "MISSING_FINISH", workedSeconds: null })
    const finished = { ...workday, status: "COMPLETED", completedAt: "2026-11-02T06:00:00+04:00", totalPausedSeconds: 3600,
      events: [...workday.events, { type: "PAUSE", occurredAt: "2026-11-02T02:00:00+04:00" }, { type: "RESUME", occurredAt: "2026-11-02T03:00:00+04:00" }, { type: "FINISH", occurredAt: "2026-11-02T06:00:00+04:00" }] }
    expect(buildMtmAttendanceReport({ ...input, workdays: [finished], now: "2026-11-02T07:00:00+04:00" }).rows[0]).toMatchObject({ kind: "WORKED", date: "2026-11-01", workedSeconds: 25200, pausedSeconds: 3600, lateSeconds: 0, earlyLeaveSeconds: 0 })
  })

})
