import { describe, expect, it } from "vitest"
import { monthWeeks, tasksByDueDay } from "@/lib/tasks/board-calendar"

// Baku is UTC+4 all year: the day a deadline falls on there.
const bakuDay = (at: Date) => new Date(at.getTime() + 4 * 3_600_000).toISOString().slice(0, 10)

describe("board calendar", () => {
  it("covers a month in six Monday-first weeks", () => {
    const weeks = monthWeeks(2026, 10) // November 2026 starts on a Sunday
    expect(weeks).toHaveLength(6)
    expect(weeks[0].map((day) => day.key)).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
    ])
    expect(weeks.flat().filter((day) => day.inMonth)).toHaveLength(30)
  })

  it("puts a Bordio date-only deadline on its own day in Baku, and counts the undated apart", () => {
    const { byDay, undated } = tasksByDueDay([
      { id: "a", dueDate: "2026-11-12T19:59:59.000Z" }, // Bordio «12 Nov», no time
      { id: "b", dueDate: "2026-11-12T05:00:00.000Z" },
      { id: "c", dueDate: "2026-11-12T20:30:00.000Z" }, // already the 13th in Baku
      { id: "d", dueDate: null },
    ], bakuDay)
    expect(byDay.get("2026-11-12")?.map((task) => task.id)).toEqual(["a", "b"])
    expect(byDay.get("2026-11-13")?.map((task) => task.id)).toEqual(["c"])
    expect(undated).toBe(1)
  })
})
