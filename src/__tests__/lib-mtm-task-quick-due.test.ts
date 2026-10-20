import { describe, expect, it } from "vitest"
import { isQuickTaskDueChoice, quickTaskDueDate } from "@/lib/mtm/task-quick-due"
import { mtmTaskOverdueDays } from "@/lib/mtm/task-overdue"

/**
 * «Срок» in three fields (owner-approved mockup, 2026-10-20): a day means its
 * working evening, 18:00 in the organization's timezone, so a task is never
 * late the moment it is given.
 */

const BAKU = "Asia/Baku" // UTC+4, no daylight saving
const at = (iso: string) => new Date(iso)

describe("the day a task is due, from «Сегодня / Завтра / Без срока / Дата…»", () => {
  it("means 18:00 of that day in the organization's timezone", () => {
    const morning = at("2026-10-20T06:00:00.000Z") // 10:00 in Baku
    expect(quickTaskDueDate("today", morning, BAKU)?.toISOString()).toBe("2026-10-20T14:00:00.000Z")
    expect(quickTaskDueDate("tomorrow", morning, BAKU)?.toISOString()).toBe("2026-10-21T14:00:00.000Z")
    expect(quickTaskDueDate("2026-10-23", morning, BAKU)?.toISOString()).toBe("2026-10-23T14:00:00.000Z")
    expect(quickTaskDueDate("none", morning, BAKU)).toBeNull()
  })

  it("makes «Сегодня» the end of the day once less than an hour of the working day is left", () => {
    const evening = at("2026-10-20T13:30:00.000Z") // 17:30 in Baku
    expect(quickTaskDueDate("today", evening, BAKU)?.toISOString()).toBe("2026-10-20T19:59:00.000Z")
    // Today's date picked by hand is «Сегодня».
    expect(quickTaskDueDate("2026-10-20", evening, BAKU)?.toISOString()).toBe("2026-10-20T19:59:00.000Z")
  })

  it("gives no task that is late the moment it is given", () => {
    for (const nowIso of ["2026-10-20T04:00:00.000Z", "2026-10-20T13:59:00.000Z", "2026-10-20T19:00:00.000Z"]) {
      const now = at(nowIso)
      for (const choice of ["today", "tomorrow"] as const) {
        const due = quickTaskDueDate(choice, now, BAKU)
        expect(`${nowIso} ${choice}: ${mtmTaskOverdueDays({ status: "PENDING", dueDate: due }, now.getTime())}`).toBe(`${nowIso} ${choice}: null`)
      }
    }
  })

  it("refuses a day gone by and anything that is not a day", () => {
    const now = at("2026-10-20T06:00:00.000Z")
    expect(() => quickTaskDueDate("2026-10-19", now, BAKU)).toThrow(RangeError)
    for (const bad of ["yesterday", "2026-02-30", "20-10-2026", "", 5]) expect(isQuickTaskDueChoice(bad)).toBe(false)
    expect(() => quickTaskDueDate("2026-02-30", now, BAKU)).toThrow(RangeError)
  })
})
