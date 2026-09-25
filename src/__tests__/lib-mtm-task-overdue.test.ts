import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { mtmOverdueTaskWhere, mtmTaskOverdueDays } from "@/lib/mtm/task-overdue"

/**
 * Tasks audit 2026-09-24: «Overdue» on /mtm/tasks showed 0 while all 243 open
 * tasks were past their due date — the list filtered on a stored status that
 * nobody writes, while the phone and «Today» derive it from the due date.
 */
const now = Date.parse("2026-09-24T09:00:00.000Z")

describe("a late field task", () => {
  it("is an open task whose due date has passed, counted in whole days", () => {
    expect(mtmTaskOverdueDays({ status: "PENDING", dueDate: "2026-08-24T09:00:00.000Z" }, now)).toBe(31)
    expect(mtmTaskOverdueDays({ status: "IN_PROGRESS", dueDate: new Date("2026-09-24T08:00:00.000Z") }, now)).toBe(1)
    expect(mtmTaskOverdueDays({ status: "PENDING", dueDate: "2026-09-25T09:00:00.000Z" }, now)).toBeNull()
    expect(mtmTaskOverdueDays({ status: "COMPLETED", dueDate: "2026-08-24T09:00:00.000Z" }, now)).toBeNull()
    expect(mtmTaskOverdueDays({ status: "CANCELLED", dueDate: "2026-08-24T09:00:00.000Z" }, now)).toBeNull()
    expect(mtmTaskOverdueDays({ status: "PENDING", dueDate: null }, now)).toBeNull()
  })

  it("is filtered by due date, not by a stored status", () => {
    expect(mtmOverdueTaskWhere(new Date(now))).toEqual({
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
      dueDate: { lt: new Date(now) },
    })
    const route = readFileSync("src/app/api/v1/mtm/tasks/route.ts", "utf8")
    expect(route).toContain('...(status === "OVERDUE" ? [mtmOverdueTaskWhere(now)] : [])')
    expect(route).toContain('...(status && status !== "OVERDUE" ? { status:')
    expect(route).toContain("OVERDUE: overdueCount")
    const page = readFileSync("src/app/(dashboard)/mtm/tasks/page.tsx", "utf8")
    expect(page).toContain('(["PENDING", "IN_PROGRESS", "OVERDUE", "COMPLETED"] as const)')
    expect(page).toContain('t("overdueBy", { count: task.overdueDays })')
  })
})
