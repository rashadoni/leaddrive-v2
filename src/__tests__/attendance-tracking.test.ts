import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ATTENDANCE_TRACKED_CARD_WHERE, attendanceTrackedCardSql, isAttendanceTrackedCard } from "@/lib/mtm/attendance-tracking"

// Owner, 2026-10-14: an office employee is tracked by HR attendance; a field
// agent presses "Start day" for the field manager only. The old roster rule
// "AGENT or participant" lived in ~18 copies; one surviving copy puts agents
// back into a timesheet, reminder or month close.
const OLD_RULE = [
  /role:\s*"AGENT"\s*}\s*,\s*{\s*attendanceParticipant/,
  /role\s*=\s*'AGENT'\s+OR\s+[a-z.]*"attendanceParticipant"/i,
  /role\s*===\s*"AGENT"\s*\|\|\s*\w+\.attendanceParticipant/,
]
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe("HR attendance roster", () => {
  it("tracks enrolled office staff and never a field agent", () => {
    expect(isAttendanceTrackedCard({ role: "EMPLOYEE", attendanceParticipant: true })).toBe(true)
    expect(isAttendanceTrackedCard({ role: "MANAGER", attendanceParticipant: true })).toBe(true)
    expect(isAttendanceTrackedCard({ role: "EMPLOYEE", attendanceParticipant: false })).toBe(false)
    expect(isAttendanceTrackedCard({ role: "AGENT", attendanceParticipant: true })).toBe(false)
    expect(isAttendanceTrackedCard({ role: "AGENT", attendanceParticipant: false })).toBe(false)
    expect(ATTENDANCE_TRACKED_CARD_WHERE).toEqual({ attendanceParticipant: true, role: { not: "AGENT" } })
    expect(attendanceTrackedCardSql().sql).toBe(`("attendanceParticipant" AND "role" <> 'AGENT')`)
    expect(attendanceTrackedCardSql("a").sql).toBe(`(a."attendanceParticipant" AND a."role" <> 'AGENT')`)
    expect(() => attendanceTrackedCardSql("a; DROP")).toThrow()
  })

  it("has no surviving copy of the former 'AGENT or participant' rule", () => {
    const copies = sources("src").filter(file => OLD_RULE.some(rule => rule.test(readFileSync(file, "utf8"))))
    expect(copies).toEqual([])
  })
})
