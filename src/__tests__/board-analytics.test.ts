import { describe, it, expect } from "vitest"
import {
  computeTier1Analytics,
  computeValueRollup,
  computeBurnup,
  computeMonteCarlo,
  rangeToDays,
  type AnalyticsTask,
  type AnalyticsColumn,
} from "@/lib/tasks/board-analytics"

const DAY = 86_400_000
const NOW = new Date("2026-06-17T12:00:00.000Z")
const COLS: AnalyticsColumn[] = [
  { key: "backlog", label: "BACKLOG", mapsToStatus: "backlog", color: null },
  { key: "todo", label: "TO DO", mapsToStatus: "todo", color: null },
  { key: "in_progress", label: "IN PROGRESS", mapsToStatus: "in_progress", color: "#EA580C" },
  { key: "done", label: "DONE", mapsToStatus: "done", color: "#00875A" },
]

function task(p: Partial<AnalyticsTask> & { id: string }): AnalyticsTask {
  return {
    taskKey: p.id.toUpperCase(),
    title: `Task ${p.id}`,
    status: "todo",
    boardColumnKey: null,
    type: "task",
    dueDate: null,
    completedAt: null,
    createdAt: new Date(NOW.getTime() - 5 * DAY),
    assignedTo: null,
    assigneeName: null,
    estimatedHours: null,
    estimatedPrice: null,
    ...p,
  }
}

const TASKS: AnalyticsTask[] = [
  task({ id: "a", status: "in_progress", dueDate: new Date(NOW.getTime() - 1 * DAY), assignedTo: "alice", assigneeName: "Alice", type: "bug", estimatedHours: 5 }),
  task({ id: "b", status: "done", completedAt: new Date(NOW.getTime() - 1 * 3_600_000), assignedTo: "alice", assigneeName: "Alice", type: "feature" }),
  task({ id: "c", status: "todo", dueDate: new Date(NOW.getTime() + 3 * DAY), assignedTo: "bob", assigneeName: "Bob", type: "task", estimatedHours: 3 }),
  task({ id: "d", status: "done", completedAt: new Date(NOW.getTime() - 40 * DAY), createdAt: new Date(NOW.getTime() - 50 * DAY), assignedTo: "bob", assigneeName: "Bob", type: "story" }),
  task({ id: "e", status: "backlog", type: "bug" }),
  task({ id: "f", status: "done", completedAt: new Date(NOW.getTime() - 10 * DAY), assignedTo: "alice", assigneeName: "Alice", type: "feature" }),
]

describe("computeTier1Analytics (range=30d)", () => {
  const a = computeTier1Analytics(TASKS, COLS, NOW, 30)

  it("totals: wip/done/overdue/dueSoon/throughputThisWeek", () => {
    expect(a.totals.totalTasks).toBe(6)
    expect(a.totals.done).toBe(3) // b, d, f
    expect(a.totals.wip).toBe(3) // a, c, e
    expect(a.totals.overdue).toBe(1) // a (due yesterday, open)
    expect(a.totals.dueSoon).toBe(1) // c (due +3d, open)
    expect(a.totals.throughputThisWeek).toBe(1) // b (completed 1h ago)
  })

  it("WIP snapshot is per column, in column order, open tasks only", () => {
    expect(a.wip.map((w) => [w.key, w.count])).toEqual([
      ["backlog", 1], // e
      ["todo", 1], // c
      ["in_progress", 1], // a
      ["done", 0], // done tasks are not WIP
    ])
    expect(a.wip.find((w) => w.key === "in_progress")?.color).toBe("#EA580C")
  })

  it("throughput counts only in-range completions (b + f = 2; d is out of range)", () => {
    expect(a.throughput.reduce((s, w) => s + w.count, 0)).toBe(2)
  })

  it("assignee throughput attributes in-range completions to the person", () => {
    expect(a.assigneeThroughput).toEqual([{ userId: "alice", name: "Alice", count: 2 }])
  })

  it("created vs resolved sums over the range", () => {
    expect(a.createdVsResolved.reduce((s, w) => s + w.created, 0)).toBe(5) // all but d (created 50d ago)
    expect(a.createdVsResolved.reduce((s, w) => s + w.resolved, 0)).toBe(2) // b, f
  })

  it("workload: per assignee total + hours + byStage over ALL tasks", () => {
    const alice = a.workload.find((w) => w.userId === "alice")!
    expect(alice.total).toBe(3)
    expect(alice.hours).toBe(5)
    expect(alice.byStage.in_progress).toBe(1)
    expect(alice.byStage.done).toBe(2)
    expect(alice).toMatchObject({
      completed: 2,
      open: 1,
      inProgress: 1,
      notStarted: 0,
      overdue: 1,
      completionRate: 67,
    })
    const unassigned = a.workload.find((w) => w.userId === null)!
    expect(unassigned.total).toBe(1)
    expect(unassigned.byStage.backlog).toBe(1)
    expect(unassigned).toMatchObject({ completed: 0, open: 1, notStarted: 1, completionRate: 0 })
  })

  it("overdue / due-soon task lists", () => {
    expect(a.due.overdue.map((t) => t.id)).toEqual(["a"])
    expect(a.due.dueSoon.map((t) => t.id)).toEqual(["c"])
  })

  it("work mix counts by type, desc", () => {
    const mix = Object.fromEntries(a.workMix.map((m) => [m.type, m.count]))
    expect(mix).toEqual({ bug: 2, feature: 2, task: 1, story: 1 })
  })
})

describe("edge cases", () => {
  it("empty board → zeros, no crash", () => {
    const a = computeTier1Analytics([], COLS, NOW, 30)
    expect(a.totals.totalTasks).toBe(0)
    expect(a.wip.every((w) => w.count === 0)).toBe(true)
    expect(a.assigneeThroughput).toEqual([])
    expect(a.workMix).toEqual([])
  })

  it("legacy statuses fold like the board (pending→todo wip, completed/cancelled→done)", () => {
    const legacy: AnalyticsTask[] = [
      task({ id: "p", status: "pending" }),
      task({ id: "x", status: "completed", completedAt: new Date(NOW.getTime() - 1 * DAY) }),
      task({ id: "y", status: "cancelled" }),
    ]
    const a = computeTier1Analytics(legacy, COLS, NOW, 30)
    expect(a.totals.wip).toBe(1) // only pending (folds to todo)
    expect(a.totals.done).toBe(2) // completed + cancelled fold to done
    expect(a.wip.find((w) => w.key === "todo")?.count).toBe(1) // pending lands in the todo lane
  })

  it("rangeToDays maps 7d/30d/90d, defaults to 30", () => {
    expect(rangeToDays("7d")).toBe(7)
    expect(rangeToDays("90d")).toBe(90)
    expect(rangeToDays("30d")).toBe(30)
    expect(rangeToDays(null)).toBe(30)
    expect(rangeToDays("bogus")).toBe(30)
  })
})

describe("computeValueRollup (Tier-3 #16, current-state)", () => {
  // v5 is done (must be excluded — pipeline = open work). v3 has price but no
  // hours; v4 has hours but no price; v6 has neither — to test the per-estimate
  // coverage disclosure (withValue / withHours of openCount).
  const V: AnalyticsTask[] = [
    task({ id: "v1", status: "in_progress", estimatedPrice: 1000, estimatedHours: 10 }),
    task({ id: "v2", status: "in_progress", estimatedPrice: 500, estimatedHours: 5 }),
    task({ id: "v3", status: "todo", estimatedPrice: 2000, estimatedHours: null }),
    task({ id: "v4", status: "backlog", estimatedPrice: null, estimatedHours: 8 }),
    task({ id: "v5", status: "done", completedAt: new Date(NOW.getTime() - DAY), estimatedPrice: 9999, estimatedHours: 99 }),
    task({ id: "v6", status: "backlog", estimatedPrice: null, estimatedHours: null }),
  ]
  const r = computeValueRollup(V, COLS)
  const lane = (k: string) => r.byLane.find((l) => l.key === k)!

  it("sums value + hours over OPEN tasks only (done excluded)", () => {
    expect(r.openCount).toBe(5) // v5 (done) excluded
    expect(r.totalValue).toBe(3500) // 1000 + 500 + 2000
    expect(r.totalHours).toBe(23) // 10 + 5 + 8
  })

  it("discloses how many open tasks actually carry each estimate", () => {
    expect(r.withValue).toBe(3) // v1, v2, v3
    expect(r.withHours).toBe(3) // v1, v2, v4
  })

  it("groups by board lane in column order; done lane is zero", () => {
    expect(lane("in_progress")).toMatchObject({ value: 1500, hours: 15, count: 2 })
    expect(lane("todo")).toMatchObject({ value: 2000, hours: 0, count: 1 })
    expect(lane("backlog")).toMatchObject({ value: 0, hours: 8, count: 2 }) // v4 + v6
    expect(lane("done")).toMatchObject({ value: 0, hours: 0, count: 0 }) // v5 excluded
    expect(r.byLane.map((l) => l.key)).toEqual(["backlog", "todo", "in_progress", "done"])
  })

  it("carries the column label + color through", () => {
    expect(lane("in_progress")).toMatchObject({ label: "IN PROGRESS", color: "#EA580C" })
  })

  it("empty board → zeros, lanes present at zero", () => {
    const e = computeValueRollup([], COLS)
    expect(e).toMatchObject({ totalValue: 0, totalHours: 0, openCount: 0, withValue: 0, withHours: 0 })
    expect(e.byLane.every((l) => l.value === 0 && l.hours === 0 && l.count === 0)).toBe(true)
  })
})

describe("computeBurnup (Tier-3 #15, cumulative scope vs done)", () => {
  // Explicit midnight-dated tasks so the per-day cumulative cutoffs are exact
  // (NOW is noon). scope = created-as-of-day, done = completed-as-of-day.
  const bTask = (id: string, createdISO: string, completedISO: string | null) =>
    task({ id, createdAt: new Date(createdISO), completedAt: completedISO ? new Date(completedISO) : null })
  const BURN: AnalyticsTask[] = [
    bTask("b1", "2026-06-07T00:00:00Z", "2026-06-15T00:00:00Z"),
    bTask("b2", "2026-06-09T00:00:00Z", "2026-06-16T00:00:00Z"),
    bTask("b3", "2026-06-12T00:00:00Z", null),
    bTask("b4", "2026-06-14T00:00:00Z", null),
  ]
  const burn = computeBurnup(BURN, NOW, 12) // NOW = 2026-06-17T12:00Z
  const at = (date: string) => burn.points.find((p) => p.date === date)!

  it("emits one cumulative point per day, ending today, with total = task count", () => {
    expect(burn.points).toHaveLength(12)
    expect(burn.points[0].date).toBe("2026-06-06") // 11 days before today
    expect(burn.points[11].date).toBe("2026-06-17") // today (clamped to now)
    expect(burn.total).toBe(4)
  })

  it("scope rises as tasks are created; done rises as they complete", () => {
    expect(at("2026-06-06")).toMatchObject({ scope: 0, done: 0 }) // before any task existed
    expect(at("2026-06-07")).toMatchObject({ scope: 1, done: 0 }) // b1 created
    expect(at("2026-06-14")).toMatchObject({ scope: 4, done: 0 }) // all created, none done yet
    expect(at("2026-06-15")).toMatchObject({ scope: 4, done: 1 }) // b1 completed
    expect(at("2026-06-17")).toMatchObject({ scope: 4, done: 2 }) // b1 + b2 completed
  })

  it("both series are monotonic non-decreasing and scope ≥ done at every point", () => {
    burn.points.forEach((p, i) => {
      if (i > 0) {
        expect(p.scope).toBeGreaterThanOrEqual(burn.points[i - 1].scope)
        expect(p.done).toBeGreaterThanOrEqual(burn.points[i - 1].done)
      }
      expect(p.scope).toBeGreaterThanOrEqual(p.done) // can't finish what doesn't exist
    })
  })

  it("empty board → range of zero-points, no crash", () => {
    const e = computeBurnup([], NOW, 7)
    expect(e.points).toHaveLength(7)
    expect(e.total).toBe(0)
    expect(e.points.every((p) => p.scope === 0 && p.done === 0)).toBe(true)
  })
})

describe("computeMonteCarlo (Tier-3 #17, throughput forecast)", () => {
  // deterministic LCG so trials are reproducible in tests
  const makeRng = () => {
    let s = 42
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      return s / 0x7fffffff
    }
  }
  // 20 completions over the last 20 days (1/day) + 6 open ⇒ enough throughput history
  const fixture = (): AnalyticsTask[] => {
    const arr: AnalyticsTask[] = []
    for (let i = 1; i <= 20; i++) arr.push(task({ id: `c${i}`, status: "done", completedAt: new Date(NOW.getTime() - i * DAY) }))
    for (let i = 0; i < 6; i++) arr.push(task({ id: `o${i}`, status: "in_progress" }))
    return arr
  }

  it("forecasts the open tasks; percentiles are monotonic + dated from now", () => {
    const m = computeMonteCarlo(fixture(), NOW, 28, makeRng(), 500)
    expect(m.remaining).toBe(6) // 6 open tasks to finish
    expect(m.throughputTotal).toBe(20)
    expect(m.sufficient).toBe(true)
    expect(m.forecast.map((f) => f.p)).toEqual([50, 70, 85, 95])
    const days = m.forecast.map((f) => f.days)
    expect(days[0]).toBeLessThanOrEqual(days[1])
    expect(days[1]).toBeLessThanOrEqual(days[2])
    expect(days[2]).toBeLessThanOrEqual(days[3])
    expect(days[0]).toBeGreaterThan(0)
    expect(m.forecast[0].date).toBe(new Date(NOW.getTime() + days[0] * DAY).toISOString().slice(0, 10)) // date = now + days
  })

  it("is reproducible for a given rng seed", () => {
    const a = computeMonteCarlo(fixture(), NOW, 28, makeRng(), 500)
    const b = computeMonteCarlo(fixture(), NOW, 28, makeRng(), 500)
    expect(a.forecast).toEqual(b.forecast)
  })

  it("sparse history → not sufficient, empty forecast (no confident-but-wrong)", () => {
    const sparse = [
      task({ id: "c1", status: "done", completedAt: new Date(NOW.getTime() - 2 * DAY) }),
      task({ id: "o1", status: "todo" }),
    ]
    const m = computeMonteCarlo(sparse, NOW, 28, makeRng(), 500)
    expect(m.sufficient).toBe(false) // only 1 completion < the 3-completion floor
    expect(m.forecast).toEqual([])
    expect(m.remaining).toBe(1)
  })

  it("no open tasks → nothing to forecast (not sufficient)", () => {
    const done = [task({ id: "c1", status: "done", completedAt: new Date(NOW.getTime() - 1 * DAY) })]
    expect(computeMonteCarlo(done, NOW, 28, makeRng(), 500).sufficient).toBe(false)
  })

  it("empty board → not sufficient, no crash", () => {
    expect(computeMonteCarlo([], NOW, 28, makeRng(), 500)).toMatchObject({ remaining: 0, throughputTotal: 0, sufficient: false, forecast: [] })
  })

  it("degenerate (huge backlog, tiny throughput) → percentiles capped, no fabricated date", () => {
    // 3 completions over 90 days, 150 open: passes the data-quantity guard, but the
    // backlog can't finish within the 10y horizon ⇒ every percentile caps. The cap
    // value must NOT be dressed up as a real forecast date (the architect-found bug).
    const arr: AnalyticsTask[] = []
    for (let i = 1; i <= 3; i++) arr.push(task({ id: `c${i}`, status: "done", completedAt: new Date(NOW.getTime() - i * 10 * DAY) }))
    for (let i = 0; i < 150; i++) arr.push(task({ id: `o${i}`, status: "todo" }))
    const m = computeMonteCarlo(arr, NOW, 90, makeRng(), 200)
    expect(m.sufficient).toBe(true) // 3 completions over 90 days clears the quantity floor
    expect(m.forecast[0].capped).toBe(true) // …but the median caps
    expect(m.forecast[0].date).toBe("") // no fabricated date
    expect(m.forecast.every((f) => f.capped && f.date === "")).toBe(true)
  })
})
