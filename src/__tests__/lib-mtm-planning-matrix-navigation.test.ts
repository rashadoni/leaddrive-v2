import { describe, expect, it } from "vitest"
import {
  mobilePlanningDayLayout,
  nextPlanningMatrixCoordinate,
  orderedMobilePlanningDays,
} from "@/lib/mtm/planning-matrix-navigation"

describe("SWM-18 matrix keyboard navigation", () => {
  it("moves in all four directions without leaving the loaded grid", () => {
    expect(nextPlanningMatrixCoordinate({ row: 2, column: 2 }, "ArrowUp", 5, 4)).toEqual({ row: 1, column: 2 })
    expect(nextPlanningMatrixCoordinate({ row: 2, column: 2 }, "ArrowDown", 5, 4)).toEqual({ row: 3, column: 2 })
    expect(nextPlanningMatrixCoordinate({ row: 2, column: 2 }, "ArrowLeft", 5, 4)).toEqual({ row: 2, column: 1 })
    expect(nextPlanningMatrixCoordinate({ row: 2, column: 2 }, "ArrowRight", 5, 4)).toEqual({ row: 2, column: 3 })

    expect(nextPlanningMatrixCoordinate({ row: 0, column: 0 }, "ArrowUp", 5, 4)).toEqual({ row: 0, column: 0 })
    expect(nextPlanningMatrixCoordinate({ row: 4, column: 3 }, "ArrowDown", 5, 4)).toEqual({ row: 4, column: 3 })
  })

  it("supports row Home and End and ignores unrelated keys", () => {
    expect(nextPlanningMatrixCoordinate({ row: 2, column: 2 }, "Home", 5, 4)).toEqual({ row: 2, column: 0 })
    expect(nextPlanningMatrixCoordinate({ row: 2, column: 1 }, "End", 5, 4)).toEqual({ row: 2, column: 3 })
    expect(nextPlanningMatrixCoordinate({ row: 2, column: 1 }, "Enter", 5, 4)).toBeNull()
    expect(nextPlanningMatrixCoordinate({ row: 0, column: 0 }, "ArrowRight", 0, 0)).toBeNull()
  })
})

describe("SWM-18 mobile planning day projection", () => {
  const days = [
    { date: "2026-08-22" },
    { date: "2026-08-20" },
    { date: "2026-08-21" },
  ]
  const states = [
    { date: "2026-08-20", status: "DRAFT" },
    { date: "2026-08-22", status: "IN_PROGRESS" },
  ]

  it("keeps mixed editable and locked days in chronological order", () => {
    const projected = orderedMobilePlanningDays(days, states, (day) => day.date === "2026-08-21")
    expect(projected.map(({ day }) => day.date)).toEqual(["2026-08-20", "2026-08-21", "2026-08-22"])
    expect(projected.map(({ mutable }) => mutable)).toEqual([false, true, false])
    expect(mobilePlanningDayLayout(projected)).toEqual({
      editableDayCount: 1,
      lockedDayCount: 2,
      state: "mixed",
    })
  })

  it("distinguishes an all-locked plan from a mixed one", () => {
    const projected = orderedMobilePlanningDays(days, states, () => false)
    expect(projected.map(({ day }) => day.date)).toEqual(["2026-08-20", "2026-08-22"])
    expect(mobilePlanningDayLayout(projected).state).toBe("all-locked")
  })
})
