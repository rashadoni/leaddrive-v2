import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { boardLabel, columnOfTask, doneColumnOf, myWorkGroup } from "@/lib/tasks/my-work"

// «Mənim işlərim» groups by the person's own calendar day — Baku here.
const tz = process.env.TZ
beforeAll(() => { process.env.TZ = "Asia/Baku" })
afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })

describe("which day group a task falls in", () => {
  // Tuesday 10 November 2026, 09:00 in Baku.
  const now = () => new Date(2026, 10, 10, 9, 0)
  it("by the due day in Baku, a due date being the end of its day", () => {
    expect(myWorkGroup("2026-11-09T19:59:59.000Z", now())).toBe("overdue") // Monday, 23:59:59 Baku
    expect(myWorkGroup("2026-11-10T19:59:59.000Z", now())).toBe("today")
    expect(myWorkGroup("2026-11-10T00:00:00.000Z", now())).toBe("today") // an old midnight-UTC save is 04:00 the same day
    expect(myWorkGroup("2026-11-11T19:59:59.000Z", now())).toBe("tomorrow")
    expect(myWorkGroup("2026-11-15T19:59:59.000Z", now())).toBe("week") // Sunday
    expect(myWorkGroup("2026-11-16T19:59:59.000Z", now())).toBe("later") // next Monday
    expect(myWorkGroup(null, now())).toBe("none")
    expect(myWorkGroup("not a date", now())).toBe("none")
  })
  it("on a Sunday the week is over: Monday is «tomorrow», Tuesday «later»", () => {
    const sunday = new Date(2026, 10, 15, 12, 0)
    expect(myWorkGroup("2026-11-16T19:59:59.000Z", sunday)).toBe("tomorrow")
    expect(myWorkGroup("2026-11-17T19:59:59.000Z", sunday)).toBe("later")
  })
})

describe("the board's columns on a row", () => {
  const columns = [
    { key: "c_done", label: "Bitdi", mapsToStatus: "done", sortOrder: 3 },
    { key: "c_todo", label: "Yeni", mapsToStatus: "todo", sortOrder: 1 },
    { key: "c_work", label: "İcrada", mapsToStatus: "in_progress", sortOrder: 2 },
  ]
  it("ticking puts a task in the board's «done» column, else in its last one", () => {
    expect(doneColumnOf(columns)?.key).toBe("c_done")
    expect(doneColumnOf(columns.filter((c) => c.key !== "c_done"))?.key).toBe("c_work")
    expect(doneColumnOf([])).toBeNull()
  })
  it("shows the column the board draws the task in", () => {
    expect(columnOfTask({ status: "in_progress", boardColumnKey: "c_work" }, columns)?.label).toBe("İcrada")
    expect(columnOfTask({ status: "pending" }, columns)?.label).toBe("Yeni")
  })
})

describe("the board's name on a row", () => {
  const all = [
    { id: "dig", name: "Digital Marketing", isDepartment: true },
    { id: "trad", name: "Traditional Marketing", isDepartment: true },
    { id: "z1", name: "Zeytun", parentDivisionId: "dig" },
    { id: "z2", name: "Zeytun", parentDivisionId: "trad" },
    { id: "p1", name: "Pharmastore", parentDivisionId: "dig" },
  ]
  it("is the board's name, with its folder only when another board shares it", () => {
    expect(boardLabel(all[4], all)).toBe("Pharmastore")
    expect(boardLabel(all[2], all)).toBe("Digital Marketing · Zeytun")
    expect(boardLabel(all[3], all)).toBe("Traditional Marketing · Zeytun")
  })
})

describe("a column's name in the reader's language", () => {
  it("translates the stock English names (Bordio's «New task»), keeps a board's own", async () => {
    const { stockColumnStage } = await import("@/lib/tasks/my-work")
    expect(stockColumnStage({ label: "New task", mapsToStatus: "todo" })).toBe("todo")
    expect(stockColumnStage({ label: "IN PROGRESS", mapsToStatus: "in_progress" })).toBe("in_progress")
    expect(stockColumnStage({ label: "Dizaynda", mapsToStatus: "in_progress" })).toBeNull()
    expect(stockColumnStage(null)).toBeNull()
  })
})
