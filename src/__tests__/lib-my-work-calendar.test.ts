import { afterAll, describe, expect, it } from "vitest"

// The calendar lays days out in the person's own time — Baku here.
const tz = process.env.TZ
process.env.TZ = "Asia/Baku"
afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })

const { dayKeys, dueNote, firstDayFor, planForDay, planTasks, plannedDay, rankBefore, rankBetween, shiftDayKey, visibleDayCount } =
  await import("@/lib/tasks/my-work-calendar")

describe("days in the «Təqvim» of Mənim işlərim", () => {
  it("steps day by day across months", () => {
    expect(shiftDayKey("2026-11-30", 1)).toBe("2026-12-01")
    expect(shiftDayKey("2026-11-01", -1)).toBe("2026-10-31")
    expect(dayKeys("2026-11-09", 3)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"])
  })

  it("a plan is a calendar day, read back as the same day whatever the time zone", () => {
    expect(planForDay("2026-11-12")).toEqual({ day: "2026-11-12T00:00:00.000Z", rank: null })
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
  it("a day holds what is planned for it; without an order of their own, by priority", () => {
    expect(byDay.get("2026-11-10")!.map((x) => x.id)).toEqual(["tue-crit", "done-tue", "tue-low"])
    expect(byDay.get("2026-11-09")).toEqual([])
    expect([...byDay.values()].flat().some((x) => x.id === "far")).toBe(false)
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

describe("each person's order inside a day, as in Bordio", () => {
  const day = "2026-11-04"
  // Nazrin's 4 Nov in Bordio: «60 Sumqayıt» above two «Aksiya Email», finished ones in their places.
  const tasks = [
    { id: "aksiya-2", title: "Aksiya Email", status: "done", priority: "medium", dueDate: null, plans: [planForDay(day, 17937883216)] },
    { id: "sumqayit", title: "60 Sumqayıt", status: "done", priority: "medium", dueDate: null, plans: [planForDay(day, 17937701285)] },
    { id: "unranked", title: "Afişa", status: "todo", priority: "critical", dueDate: null, plans: [planForDay(day)] },
    { id: "aksiya-1", title: "Aksiya Email", status: "todo", priority: "medium", dueDate: null, plans: [planForDay(day, 17937883193)] },
  ]
  const list = () => planTasks(tasks.filter((x) => x.status !== "done"), tasks.filter((x) => x.status === "done"), [day]).byDay.get(day)!
  it("keeps the order — finished cards stay where they stand — and puts cards without one after", () => {
    expect(list().map((x) => x.id)).toEqual(["sumqayit", "aksiya-1", "aksiya-2", "unranked"])
  })
  it("a card dropped on another lands just above it; dropped on the first, above all", () => {
    expect(rankBefore(list(), "aksiya-2", "unranked")).toBe((17937883193 + 17937883216) / 2)
    expect(rankBefore(list(), "sumqayit", "unranked")).toBe(17937701285 - 1_000_000)
    expect(rankBetween(5, null)).toBe(1_000_005)
  })
})
