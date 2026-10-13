import { describe, expect, it } from "vitest"
import { attendanceLeaveBalance, attendanceServiceYears } from "@/lib/mtm/attendance-leave-balance"
import { AttendanceLeavePolicyInputSchema, AttendanceLeaveProfileInputSchema, type AttendanceLeavePolicy, type AttendanceLeaveRevision, type AttendanceLeaveProfile } from "@/lib/mtm/attendance-leave-contract"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"
const catalogue = defaultAttendanceDayKinds(key => ({ az: key, ru: key, en: key })), annual = catalogue.find(item => item.key === "ANNUAL_LEAVE")!
const policy: AttendanceLeavePolicy = { reviewed: true, basisDate: "2026-01-01", counting: "CALENDAR_EXCEPT_HOLIDAYS", minutesPerDay: null,
  tiers: [{ category: "Fictional category", minimumYears: 0, days: 10 }, { category: "Fictional category", minimumYears: 5, days: 15 }] }
const profile: AttendanceLeaveRevision<AttendanceLeaveProfile> = { id: "fictional-profile", year: 2026, version: 1, createdAt: "2026-01-01T00:00:00Z", value: { category: "Fictional category", serviceStart: "2020-01-01", openingDays: 2 } }
const period = (id: string, startDate: string, endDate = startDate): AttendanceApprovedPeriod => ({ id, agentId: "employee-a", startDate, endDate, decidedAt: "2026-01-01T00:00:00Z",
  details: { kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", dayKind: annual } })
function rows(periods: AttendanceApprovedPeriod[]) {
  return buildMtmAttendanceReport({ from: "2026-10-09", to: "2026-10-14", now: "2026-10-13T15:00:00Z", employees: [{ id: "employee-a", name: "Fictional employee", teamId: null, teamName: null }], rules: [],
    workdays: [], calendar: [{ id: "holiday", date: "2026-10-12", kind: "PUBLIC_HOLIDAY", teamId: null, agentId: null, name: "Fictional holiday", movedToDate: null, routePlanningAllowed: false }], dayKinds: catalogue, approvedRequests: periods }).rows
}
const calculate = (overrides: Partial<Parameters<typeof attendanceLeaveBalance>[0]> = {}) => attendanceLeaveBalance({ employeeId: "employee-a", name: "Fictional employee", teamName: null, rows: rows([period("leave-a", "2026-10-09", "2026-10-14")]), usedThrough: "2026-10-13", policy, profile, ...overrides })
describe("client-confirmed leave balance", () => {
  it("has no implied legal allowance or day-counting rule", () => {
    expect(calculate({ policy: null })).toMatchObject({ state: "POLICY_MISSING", allowanceDays: null, usedDays: null, remainingDays: null })
    expect(calculate({ policy: { ...policy, reviewed: false } }).state).toBe("POLICY_MISSING")
    expect(calculate({ profile: null })).toMatchObject({ state: "PROFILE_MISSING", allowanceDays: null, usedDays: 4 })
  })
  it("uses the matching highest tenure tier, explicit opening balance and separate future approvals", () => {
    expect(calculate()).toMatchObject({ state: "READY", serviceYears: 6, allowanceDays: 15, usedDays: 4, plannedDays: 1, remainingDays: 13, availableDays: 12 })
  })
  it("counts weekends only with the explicit calendar-day method", () => {
    expect(calculate({ policy: { ...policy, counting: "WORKING_DAYS" } })).toMatchObject({ usedDays: 2, plannedDays: 1 })
  })
  it("unions duplicate approvals and excludes another employee's periods", () => {
    expect(calculate({ rows: rows([period("one", "2026-10-13"), period("two", "2026-10-13"), { ...period("foreign", "2026-10-14"), agentId: "employee-b" }]) })).toMatchObject({ usedDays: 1, plannedDays: 0 })
  })
  it("keeps negative balances and never invents a matching category or service start", () => {
    expect(calculate({ profile: { ...profile, value: { ...profile.value, openingDays: -20 } } }).remainingDays).toBe(-9)
    expect(calculate({ profile: { ...profile, value: { ...profile.value, category: "Unknown" } } }).state).toBe("TIER_MISSING")
    expect(calculate({ profile: { ...profile, value: { ...profile.value, serviceStart: "2026-02-01" } } }).state).toBe("TENURE_UNKNOWN")
  })
  it("requires a client conversion for hourly leave and unions overlapping intervals", () => {
    const a = period("hour-a", "2026-10-13"), b = period("hour-b", "2026-10-13")
    a.details = { ...a.details, unit: "HOURS", startTime: "09:00", endTime: "11:00" }
    b.details = { ...b.details, unit: "HOURS", startTime: "10:00", endTime: "12:00" }
    const hours = rows([a, b])
    expect(calculate({ rows: hours })).toMatchObject({ state: "HOURS_UNCONFIGURED", usedDays: null, remainingDays: null })
    expect(calculate({ rows: hours, policy: { ...policy, minutesPerDay: 360 } })).toMatchObject({ state: "READY", usedDays: 0.5 })
    expect(calculate({ rows: rows([a, period("whole", "2026-10-13")]) })).toMatchObject({ usedDays: 1 })
  })
  it("unions actual instants across frozen timezones and refuses an ambiguous DST clock", () => {
    const a = period("baku", "2026-10-13"), b = period("berlin", "2026-10-13")
    a.details = { ...a.details, unit: "HOURS", startTime: "09:00", endTime: "10:00" }
    b.details = { ...b.details, unit: "HOURS", startTime: "09:00", endTime: "10:00", timezone: "Europe/Berlin" }
    const hourlyPolicy = { ...policy, minutesPerDay: 240 }
    expect(calculate({ rows: rows([a, b]), policy: hourlyPolicy }).usedDays).toBe(0.5)
    const ambiguous = period("dst", "2026-10-25")
    ambiguous.details = { ...ambiguous.details, unit: "HOURS", startTime: "02:15", endTime: "03:15", timezone: "Europe/Berlin" }
    const day = { ...rows([])[0], date: "2026-10-25", approvedRequests: [ambiguous] }
    expect(calculate({ rows: [day], policy: hourlyPolicy })).toMatchObject({ state: "HOURS_INVALID", usedDays: null, remainingDays: null })
  })
  it("retains unknown/anniversary boundaries instead of rounding tenure up", () => {
    expect(attendanceServiceYears("2020-10-14", "2026-10-13")).toBe(5)
    expect(attendanceServiceYears("2020-10-13", "2026-10-13")).toBe(6)
    expect(attendanceServiceYears("2020-02-29", "2021-02-28")).toBe(0)
    expect(attendanceServiceYears("2020-02-29", "2021-03-01")).toBe(1)
    expect(attendanceServiceYears("invalid", "2026-01-01")).toBeNull()
  })
  it("requires coherent versioned input and refuses duplicate tier boundaries", () => {
    const input = { year: 2026, requestId: "10000000-0000-4000-8000-000000000001", expectedRevisionId: null, reason: "Fictional approved rule", policy }
    expect(AttendanceLeavePolicyInputSchema.safeParse(input).success).toBe(true)
    expect(AttendanceLeavePolicyInputSchema.safeParse({ ...input, policy: { ...policy, tiers: [policy.tiers[0], policy.tiers[0]] } }).success).toBe(false)
    expect(AttendanceLeavePolicyInputSchema.safeParse({ ...input, policy: { ...policy, basisDate: "2025-01-01" } }).success).toBe(false)
    expect(AttendanceLeavePolicyInputSchema.safeParse({ ...input, policy: { ...policy, counting: null } }).success).toBe(false)
    expect(AttendanceLeaveProfileInputSchema.safeParse({ year: 2026, requestId: input.requestId, expectedRevisionId: null, reason: "Fictional inputs", agentId: "employee-a", profile: profile.value }).success).toBe(true)
  })
})
