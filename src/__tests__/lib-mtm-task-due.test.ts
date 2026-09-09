import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { mtmTaskDueFormat, mtmTaskDueHasMeaningfulTime } from "@/lib/mtm/task-due"

describe("task due date (field UX audit C11)", () => {
  const baku = "Asia/Baku"

  it("drops the time when the deadline sits exactly on local midnight", () => {
    // 20:00Z is 00:00 in Baku (UTC+4): a date-only deadline, stored as an
    // instant. "1 окт., 00:00" reads as a time someone chose; they did not.
    const midnightInBaku = new Date("2026-09-30T20:00:00.000Z")
    expect(mtmTaskDueHasMeaningfulTime(midnightInBaku, baku)).toBe(false)
    expect(mtmTaskDueFormat(midnightInBaku, baku)).toEqual({ dateStyle: "medium" })
  })

  it("keeps a time somebody actually picked", () => {
    const fivePastMidnight = new Date("2026-09-30T20:05:00.000Z")
    expect(mtmTaskDueHasMeaningfulTime(fivePastMidnight, baku)).toBe(true)
    expect(mtmTaskDueFormat(fivePastMidnight, baku)).toEqual({ dateStyle: "medium", timeStyle: "short" })
    const afternoon = new Date("2026-09-30T14:30:00.000Z")
    expect(mtmTaskDueHasMeaningfulTime(afternoon, baku)).toBe(true)
  })

  it("judges midnight in the display timezone, not in UTC", () => {
    // The same instant is midnight in Baku and 20:00 the previous day in UTC.
    // A tenant in UTC must see that 20:00; a tenant in Baku must not see 00:00.
    const instant = new Date("2026-09-30T20:00:00.000Z")
    expect(mtmTaskDueHasMeaningfulTime(instant, baku)).toBe(false)
    expect(mtmTaskDueHasMeaningfulTime(instant, "UTC")).toBe(true)
  })

  it("counts statuses from the same filtered set as the total", () => {
    // The page used to show a server-wide "Всего: 137" next to status counts
    // taken from the rows of the current page only. Neither number was wrong;
    // together they lied.
    const route = readFileSync("src/app/api/v1/mtm/tasks/route.ts", "utf8")
    expect(route).toContain('prisma.mtmTask.groupBy({ by: ["status"], where, _count: { _all: true } })')
    expect(route).toContain("summary: Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all]))")
  })
})
