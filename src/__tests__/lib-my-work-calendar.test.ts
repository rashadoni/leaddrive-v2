import { afterAll, describe, expect, it } from "vitest"

// The calendar lays days out in the person's own time — Baku here.
const tz = process.env.TZ
process.env.TZ = "Asia/Baku"
afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })

const { dayKeys, dueNote, firstDayFor, keepOwnDays, planForDay, planTasks, plannedDay, shiftDayKey, visibleDayCount } =
  await import("@/lib/tasks/my-work-calendar")

describe("days in the «Təqvim» of Mənim işlərim", () => {
  it("steps day by day across months", () => {
    expect(shiftDayKey("2026-11-30", 1)).toBe("2026-12-01")
    expect(shiftDayKey("2026-11-01", -1)).toBe("2026-10-31")
    expect(dayKeys("2026-11-09", 3)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"])
  })

  it("a plan is a calendar day, read back as the same day whatever the time zone", () => {
    expect(planForDay("2026-11-12")).toEqual({ day: "2026-11-12T00:00:00.000Z" })
    expect(plannedDay({ plans: [{ day: "2026-11-12T00:00:00.000Z" }] })).toBe("2026-11-12")
    expect(plannedDay({ plans: [] })).toBeNull()
    expect(plannedDay({})).toBeNull()
  })

  it("shows as many days as fit, like Bordio — one on a phone — and keeps yesterday in view from three", () => {
    expect(visibleDayCount(390)).toBe(1)
    expect(visibleDayCount(1000)).toBe(3)
    expect(visibleDayCount(1200)).toBe(4)
    expect(visibleDayCount(4000)).toBe(7)
    expect(firstDayFor("2026-11-10", 3)).toBe("2026-11-09")
    expect(firstDayFor("2026-11-10", 1)).toBe("2026-11-10")
  })
})

describe("which task goes where", () => {
  const days = ["2026-11-09", "2026-11-10", "2026-11-11"]
  const open = [
    { id: "late", title: "53 Sabunçu", status: "todo", priority: "high", dueDate: "2026-11-02T19:59:59.000Z", plans: [] },
    { id: "nodue", title: "Brendbuk", status: "todo", priority: "medium", dueDate: null, plans: [] },
    { id: "soon", title: "74 Nizami", status: "in_progress", priority: "critical", dueDate: "2026-11-11T19:59:59.000Z", plans: [] },
    { id: "tue-low", title: "Afişa", status: "todo", priority: "low", dueDate: null, plans: [planForDay("2026-11-10")] },
    { id: "tue-crit", title: "Banner", status: "todo", priority: "critical", dueDate: "2026-11-10T19:59:59.000Z", plans: [planForDay("2026-11-10")] },
    { id: "far", title: "Yeni il", status: "todo", priority: "medium", dueDate: null, plans: [planForDay("2026-12-01")] },
  ]
  const finished = [
    { id: "done-tue", title: "Aksiya Email", status: "done", priority: "medium", dueDate: null, plans: [planForDay("2026-11-10")] },
    { id: "done-nodate", title: "Old", status: "completed", priority: "medium", dueDate: null, plans: [] },
  ]
  const { waiting, byDay } = planTasks(open, finished, days)

  it("the waiting list holds every task without a day — finished ones too, as in Bordio — the latest deadline first", () => {
    expect(waiting.map((x) => x.id)).toEqual(["soon", "late", "nodue", "done-nodate"])
  })
  it("a day holds what is planned for it, open ones by priority, finished ones after", () => {
    expect(byDay.get("2026-11-10")!.map((x) => x.id)).toEqual(["tue-crit", "tue-low", "done-tue"])
    expect(byDay.get("2026-11-09")).toEqual([])
    expect([...byDay.values()].flat().some((x) => x.id === "far")).toBe(false)
  })
})

describe("a read of the list that was already under way", () => {
  const task = (id: string, day: string | null) => ({ id, title: id, status: "todo", dueDate: null, plans: day ? [planForDay(day)] : [] })

  it("keeps the day of a card moved while it was under way, and drops the day it carries for it", () => {
    const atStart = [task("moved", null), task("still", null)]
    const current = [task("moved", "2026-11-12"), task("still", null)]
    // The answer was read before the card was moved: for it the card has no day.
    const kept = keepOwnDays([task("moved", null), task("still", null)], current, atStart)
    expect(kept.map((t) => plannedDay(t))).toEqual(["2026-11-12", null])
  })

  it("keeps a card taken off its day since it began", () => {
    const atStart = [task("off", "2026-11-12")]
    const kept = keepOwnDays([task("off", "2026-11-12")], [task("off", null)], atStart)
    expect(plannedDay(kept[0])).toBeNull()
  })

  it("takes its own day for a task nobody touched since — a day given in another tab arrives", () => {
    const atStart = [task("quiet", null)]
    const kept = keepOwnDays([task("quiet", "2026-11-13")], [task("quiet", null)], atStart)
    expect(plannedDay(kept[0])).toBe("2026-11-13")
  })

  it("passes a task it brings for the first time through as it is", () => {
    const kept = keepOwnDays([task("fresh", "2026-11-13")], [], [])
    expect(plannedDay(kept[0])).toBe("2026-11-13")
    expect(kept).toHaveLength(1)
  })
})

describe("the deadline note on a card", () => {
  const now = new Date(2026, 10, 10, 9, 0)
  it("counts calendar days in Baku", () => {
    expect(dueNote("2026-11-02T19:59:59.000Z", now)).toEqual({ kind: "late", days: 8 })
    expect(dueNote("2026-11-10T19:59:59.000Z", now)).toEqual({ kind: "today" })
    expect(dueNote("2026-11-11T19:59:59.000Z", now)).toEqual({ kind: "tomorrow" })
    expect(dueNote("2026-11-20T19:59:59.000Z", now).kind).toBe("date")
    expect(dueNote(null, now)).toEqual({ kind: "none" })
  })
})
