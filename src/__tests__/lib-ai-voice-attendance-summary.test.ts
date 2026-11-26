/**
 * Da Vinci's «Kadr uçotu» answer (owner 2026-11-26: «Да, делай»).
 *
 * The figures come from the attendance report itself, so what is pinned here is
 * the boundary around it - the same gates as the Personnel page, the period
 * resolved in the user's timezone, the report's own scope passed through - and
 * that the shortened answer carries names and times but never a place.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { capability, access, report } = vi.hoisted(() => ({
  capability: vi.fn(),
  access: vi.fn(),
  report: vi.fn(),
}))

vi.mock("@/lib/tenant-capability-access", () => ({ getTenantCapabilityAccess: capability }))
vi.mock("@/lib/mtm/attendance-access", () => ({ getMtmAttendanceAccess: access }))
vi.mock("@/lib/mtm/attendance-report-store", () => {
  class AttendanceReportAccessError extends Error {}
  return { AttendanceReportAccessError, readMtmAttendanceReport: report }
})

import { buildAttendanceSummary } from "@/lib/ai/voice/attendance-summary"
import { AttendanceReportAccessError } from "@/lib/mtm/attendance-report-store"

const MANAGER_ACTOR = { role: "MANAGER", agentId: null, scopedAgentIds: null }
const TEAM_LEAD_ACTOR = { role: "SUPERVISOR", agentId: "lead-1", scopedAgentIds: ["e-1", "e-2"] }
// 2026-11-26 07:30 UTC = 11:30 in Baku.
const NOW = new Date("2026-11-26T07:30:00.000Z")

function row(overrides: Record<string, unknown>) {
  return {
    employeeId: "e-1", employeeName: "Employee", date: "2026-11-26", timezone: "Asia/Baku",
    kind: "WORKED", factsState: "VALID", startedAt: null, completedAt: null,
    lateSeconds: 0, earlyLeaveSeconds: 0, flags: [], events: [],
    // The report may carry these; the answer must not.
    locationMarks: [{ latitude: 40.4, longitude: 49.8 }],
    ...overrides,
  }
}

const ROWS = [
  row({ employeeId: "e-1", employeeName: "Late Two", kind: "OPEN", startedAt: "2026-11-26T05:20:00.000Z", lateSeconds: 1200 }),
  row({ employeeId: "e-2", employeeName: "Late One", kind: "OPEN", startedAt: "2026-11-26T05:05:00.000Z", lateSeconds: 300 }),
  row({ employeeId: "e-3", employeeName: "Absent", kind: "ABSENT" }),
  row({ employeeId: "e-4", employeeName: "On Leave", kind: "APPROVED_REQUEST", approvedRequests: [{ details: { kind: "ANNUAL_LEAVE" } }] }),
  row({ employeeId: "e-5", employeeName: "Forgot", date: "2026-11-25", kind: "MISSING_FINISH", startedAt: "2026-11-25T05:00:00.000Z" }),
]

const TOTALS = {
  rowCount: 5, employeeCount: 5, arrivedCount: 3, absentCount: 1, lateCount: 2, earlyLeaveCount: 0,
  missingFinishCount: 1, invalidFactsCount: 0, workedSeconds: 7200, isComplete: false,
}

const base = { orgId: "org-1", userId: "u-1", role: "admin" as const, timezone: "Asia/Baku", now: NOW }

beforeEach(() => {
  vi.clearAllMocks()
  capability.mockResolvedValue({ allowed: true })
  access.mockResolvedValue({ enabled: true, actor: MANAGER_ACTOR })
  report.mockResolvedValue({ rows: ROWS, totals: TOTALS, asOf: NOW.toISOString() })
})

describe("buildAttendanceSummary", () => {
  it("reads today's report in the user's timezone through the report's own scope", async () => {
    const data = await buildAttendanceSummary(base)

    expect(report).toHaveBeenCalledWith({
      organizationId: "org-1",
      actor: MANAGER_ACTOR,
      query: { from: "2026-11-26", to: "2026-11-26", form: "ALL" },
      now: NOW,
    })
    expect(data.period).toEqual({ from: "2026-11-26", to: "2026-11-26", timezone: "Asia/Baku", today: "2026-11-26" })
    expect(data.scope).toBe("all_employees")
  })

  it("names who is late (worst first, local time), absent, on leave and whose day is open", async () => {
    const data = await buildAttendanceSummary(base) as Record<string, any>

    expect(data.late).toEqual([
      { name: "Late Two", date: "2026-11-26", minutes: 20, arrivedAt: "09:20" },
      { name: "Late One", date: "2026-11-26", minutes: 5, arrivedAt: "09:05" },
    ])
    expect(data.absent).toEqual([{ name: "Absent", date: "2026-11-26" }])
    expect(data.onApprovedLeave).toEqual([{ name: "On Leave", date: "2026-11-26", kind: "ANNUAL_LEAVE" }])
    expect(data.notClosed).toEqual([
      { name: "Late Two", date: "2026-11-26", startedAt: "09:20", stillToday: true },
      { name: "Late One", date: "2026-11-26", startedAt: "09:05", stillToday: true },
      { name: "Forgot", date: "2026-11-25", startedAt: "09:00", stillToday: false },
    ])
    expect(data.totals).toMatchObject({ arrived: 3, absent: 1, late: 2, notClosed: 3, onApprovedLeave: 1, workedHours: 2, workedHoursComplete: false })
  })

  it("never says where anyone was", async () => {
    const text = JSON.stringify(await buildAttendanceSummary(base))
    expect(text).not.toMatch(/latitude|longitude|locationMarks|49\.8/)
  })

  it("keeps a team lead to the people they lead", async () => {
    access.mockResolvedValue({ enabled: true, actor: TEAM_LEAD_ACTOR })
    const data = await buildAttendanceSummary({ ...base, role: "manager" })
    expect(report.mock.calls[0][0].actor).toBe(TEAM_LEAD_ACTOR)
    expect(data.scope).toBe("own_people")
  })

  it("caps each list at ten names and says how many were left out", async () => {
    report.mockResolvedValue({
      rows: Array.from({ length: 13 }, (_, i) => row({ employeeId: `a-${i}`, employeeName: `A${i}`, kind: "ABSENT" })),
      totals: { ...TOTALS, absentCount: 13 }, asOf: NOW.toISOString(),
    })
    const data = await buildAttendanceSummary(base) as Record<string, any>
    expect(data.absent).toHaveLength(10)
    expect(data.absentMore).toBe(3)
  })

  it("takes a period and refuses one longer than 31 days or reversed", async () => {
    await buildAttendanceSummary({ ...base, from: "2026-11-01", to: "2026-11-26" })
    expect(report.mock.calls[0][0].query).toMatchObject({ from: "2026-11-01", to: "2026-11-26" })

    expect(await buildAttendanceSummary({ ...base, from: "2026-01-01", to: "2026-11-26" })).toMatchObject({ error: "RANGE_TOO_LONG" })
    expect(await buildAttendanceSummary({ ...base, from: "2026-11-26", to: "2026-11-01" })).toEqual({ error: "BAD_ARGUMENTS" })
    expect(await buildAttendanceSummary({ ...base, from: "2026-02-31" })).toEqual({ error: "BAD_ARGUMENTS" })
    expect(report).toHaveBeenCalledTimes(1)
  })

  describe("the Personnel page's gates, and nothing read past a closed one", () => {
    it("a role without MTM", async () => {
      expect(await buildAttendanceSummary({ ...base, role: "ticketing" })).toEqual({ error: "NOT_PERMITTED_FOR_ROLE" })
      expect(capability).not.toHaveBeenCalled()
    })

    it("a tenant without Personnel", async () => {
      capability.mockResolvedValue({ allowed: false })
      expect(await buildAttendanceSummary(base)).toEqual({ error: "MODULE_NOT_ENABLED", module: "personnel" })
      expect(report).not.toHaveBeenCalled()
    })

    it("Personnel hidden from this person", async () => {
      expect(await buildAttendanceSummary({ ...base, role: "manager", hiddenModules: ["personnel"] })).toEqual({ error: "NOT_PERMITTED_FOR_ROLE" })
      expect(report).not.toHaveBeenCalled()
    })

    it("attendance switched off", async () => {
      access.mockResolvedValue({ enabled: false })
      expect(await buildAttendanceSummary(base)).toEqual({ error: "MODULE_NOT_ENABLED", module: "attendance" })
      expect(report).not.toHaveBeenCalled()
    })

    it("a field agent or anyone outside Personnel", async () => {
      access.mockResolvedValue({ enabled: true, actor: null })
      expect(await buildAttendanceSummary({ ...base, role: "sales" })).toEqual({ error: "NOT_PERMITTED_FOR_ROLE" })
      expect(report).not.toHaveBeenCalled()
    })

    it("an employee outside this person's scope", async () => {
      report.mockRejectedValue(new AttendanceReportAccessError())
      expect(await buildAttendanceSummary(base)).toEqual({ error: "NOT_PERMITTED_FOR_ROLE" })
    })
  })
})
