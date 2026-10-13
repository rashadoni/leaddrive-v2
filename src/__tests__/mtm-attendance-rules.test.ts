import { describe, expect, it } from "vitest"
import { AttendanceRuleInputSchema, MTM_ATTENDANCE_BASELINE_RULE, attendanceRuleForDate, attendanceRuleMinimumDate } from "@/lib/mtm/attendance-rules"

const first = { ...MTM_ATTENDANCE_BASELINE_RULE, id: "rule-a", effectiveFrom: "2026-10-15", startTime: "08:00" }
const second = { ...first, id: "rule-b", effectiveFrom: "2026-11-01", startTime: "10:00" }

describe("MTM attendance versioned workday rules", () => {
  it("keeps historical days unchanged when a new rule is published", () => {
    const before = attendanceRuleForDate([first], "2026-10-20")
    expect(attendanceRuleForDate([first, second], "2026-10-20")).toEqual(before)
    expect(attendanceRuleForDate([second, first], "2026-11-01")).toEqual(second)
    expect(attendanceRuleForDate([first, second], "2026-10-14")).toEqual(MTM_ATTENDANCE_BASELINE_RULE)
  })
  it("requires a future date and keeps all already published windows intact", () => {
    const now = new Date("2026-10-13T12:00:00.000Z")
    expect(attendanceRuleMinimumDate([], "Asia/Baku", now)).toBe("2026-10-14")
    expect(attendanceRuleMinimumDate([first, second], "Asia/Baku", now)).toBe("2026-11-02")
  })
  it("cannot turn an existing local day into a future day by changing timezone", () => {
    expect(attendanceRuleMinimumDate([], "America/Los_Angeles", new Date("2026-10-13T01:00:00.000Z"))).toBe("2026-10-14")
  })
  it("rejects impossible rules and ambiguous weekdays", () => {
    const input = { effectiveFrom: "2026-10-15", startTime: "09:00", endTime: "18:00", lunchMinutes: 60, lateGraceMinutes: 10, weekendDays: [0, 6] }
    expect(AttendanceRuleInputSchema.safeParse(input).success).toBe(true)
    for (const change of [{ startTime: "25:00" }, { endTime: "08:00" }, { lunchMinutes: 540 }, { weekendDays: [0, 0] }, { effectiveFrom: "2026-02-30" }, { lateGraceMinutes: -1 }]) {
      expect(AttendanceRuleInputSchema.safeParse({ ...input, ...change }).success, JSON.stringify(change)).toBe(false)
    }
  })
})
