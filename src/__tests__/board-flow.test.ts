import { describe, it, expect } from "vitest"
import { computeFlowMetrics, computeCfd, computeReopened, computeSla, type FlowTask, type FlowEvent } from "@/lib/tasks/board-flow"

const DAY = 86_400_000
const NOW = new Date("2026-06-20T00:00:00.000Z")
const d = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY)

// T1 completed WITH history: created -10d, →in_progress -9d, →done -2d (completed -2d)
// T2 completed WITHOUT history: created -5d, completed -1d
// T3 open in_progress WITH history: created -8d, →in_progress -6d
// T4 open todo WITHOUT history: created -3d
const TASKS: FlowTask[] = [
  { id: "t1", taskKey: "B-1", title: "T1", status: "done", createdAt: d(10), completedAt: d(2) },
  { id: "t2", taskKey: "B-2", title: "T2", status: "completed", createdAt: d(5), completedAt: d(1) },
  { id: "t3", taskKey: "B-3", title: "T3", status: "in_progress", createdAt: d(8), completedAt: null },
  { id: "t4", taskKey: "B-4", title: "T4", status: "todo", createdAt: d(3), completedAt: null },
]
const EVENTS: FlowEvent[] = [
  { taskId: "t1", oldValue: "todo", newValue: "in_progress", at: d(9) },
  { taskId: "t1", oldValue: "in_progress", newValue: "done", at: d(2) },
  { taskId: "t3", oldValue: "todo", newValue: "in_progress", at: d(6) },
]

const m = computeFlowMetrics(TASKS, EVENTS, NOW)

describe("computeFlowMetrics", () => {
  it("lead time = completedAt − createdAt, over all completed tasks", () => {
    expect(m.leadTime.count).toBe(2) // t1 (8d), t2 (4d)
    expect(m.leadTime.coveredOf).toBe(2)
    expect(m.leadTime.p85Days).toBe(8) // nearest-rank top of [4,8]
  })

  it("cycle time = completedAt − first active-stage entry, with coverage", () => {
    expect(m.cycleTime.count).toBe(1) // only t1 has a recorded active-stage entry
    expect(m.cycleTime.coveredOf).toBe(2) // 2 completed tasks total
    expect(m.cycleTime.medianDays).toBe(7) // t1: done(-2d) − in_progress(-9d) = 7d
    const bucket = m.cycleTime.histogram.find((h) => h.label === "5–7d")
    expect(bucket?.count).toBe(1)
  })

  it("aging WIP: age since entering the current status (event), else createdAt fallback", () => {
    const t3 = m.aging.tasks.find((t) => t.id === "t3")!
    const t4 = m.aging.tasks.find((t) => t.id === "t4")!
    expect(t3.ageDays).toBe(6) // entered in_progress -6d
    expect(t3.ageFromFallback).toBe(false) // measured from the real entry event
    expect(t4.ageDays).toBe(3) // no event → since createdAt -3d
    expect(t4.ageFromFallback).toBe(true) // createdAt guess
    // done tasks excluded from aging
    expect(m.aging.tasks.find((t) => t.id === "t1")).toBeUndefined()
    // p85 cycle = 7; neither open task is older → none at risk
    expect(m.aging.atRiskCount).toBe(0)
    expect(m.aging.tasks.map((t) => t.id)).toEqual(["t3", "t4"]) // sorted by age desc
  })

  it("time-in-status: per-stage average over tasks WITH history (segments)", () => {
    expect(m.timeInStatus.coveredOf).toBe(2) // t1, t3 have events
    expect(m.timeInStatus.total).toBe(4) // of 4 tasks
    const byStage = Object.fromEntries(m.timeInStatus.stages.map((s) => [s.stage, s]))
    // todo: t1 spent 1d (created -10d → in_progress -9d), t3 spent 2d (-8d → -6d) → avg 1.5
    expect(byStage.todo).toMatchObject({ avgDays: 1.5, count: 2 })
    // in_progress: t1 7d (-9d→-2d), t3 6d (-6d→now) → avg 6.5
    expect(byStage.in_progress).toMatchObject({ avgDays: 6.5, count: 2 })
    expect(byStage.review.count).toBe(0)
  })

  it("at-risk flag fires when an open task is older than p85 cycle", () => {
    // an open in_progress task created 30d ago, no events → age 30 > p85(7)
    const m2 = computeFlowMetrics(
      [...TASKS, { id: "t5", taskKey: "B-5", title: "Stuck", status: "in_progress", createdAt: d(30), completedAt: null }],
      EVENTS,
      NOW,
    )
    const t5 = m2.aging.tasks.find((t) => t.id === "t5")!
    expect(t5.atRisk).toBe(true)
    expect(m2.aging.atRiskCount).toBe(1)
  })
})

describe("edge cases", () => {
  it("limits completed-flow metrics to the selected completion window", () => {
    const windowStart = d(3)
    const ranged = computeFlowMetrics(TASKS, EVENTS, NOW, windowStart)
    expect(ranged.leadTime.count).toBe(2)

    const tighter = computeFlowMetrics(TASKS, EVENTS, NOW, d(1.5))
    expect(tighter.leadTime.count).toBe(1)
    expect(tighter.leadTime.medianDays).toBe(4)
  })

  it("empty board → zeros, no crash", () => {
    const e = computeFlowMetrics([], [], NOW)
    expect(e.leadTime.count).toBe(0)
    expect(e.cycleTime.count).toBe(0)
    expect(e.aging.tasks).toEqual([])
    expect(e.timeInStatus.total).toBe(0)
  })

  it("no history at all → lead time still computed, cycle coverage 0/N", () => {
    const e = computeFlowMetrics(TASKS, [], NOW)
    expect(e.leadTime.count).toBe(2) // lead needs no events
    expect(e.cycleTime.count).toBe(0) // no active-stage entries recorded
    expect(e.cycleTime.coveredOf).toBe(2)
  })
})

describe("computeCfd", () => {
  // Reconstructs daily per-stage counts from the SAME fixture. Only T1 + T3 have
  // events ⇒ they are the reconstructable ("covered") set. T2 + T4 are placed in
  // the explicit unknown-history band in the past; today's point uses live status.
  const cfd = computeCfd(TASKS, EVENTS, NOW, 12)
  const at = (date: string) => cfd.points.find((p) => p.date === date)!

  it("reports coverage = tasks WITH usable history, of total", () => {
    expect(cfd.coveredOf).toBe(2) // T1, T3 have status_changed events
    expect(cfd.total).toBe(4) // of 4 tasks on the board
  })

  it("emits one point per day in range, oldest → newest, ending today", () => {
    expect(cfd.points).toHaveLength(12)
    expect(cfd.points[0].date).toBe("2026-06-09") // 11 days before NOW
    expect(cfd.points[11].date).toBe("2026-06-20") // today (NOW)
  })

  it("last point == exact current state of all tasks", () => {
    const last = at("2026-06-20")
    expect(last.in_progress).toBe(1)
    expect(last.done).toBe(2)
    expect(last.todo).toBe(1)
    expect(last.unknown).toBe(0)
    expect(last.todo + last.in_progress + last.done).toBe(4)
  })

  it("before a task's first event it sits in that event's oldValue (pre-transition base)", () => {
    // -10d: T1 exists (created -10d) but →in_progress is -9d ⇒ still in 'todo' base
    expect(at("2026-06-10")).toMatchObject({ unknown: 0, todo: 1, in_progress: 0, done: 0 })
  })

  it("mid-range: both tasks active once each has entered in_progress", () => {
    // -6d: T1 in_progress (since -9d), T3 just entered in_progress (-6d)
    // T2/T4 do not exist yet, so the unknown-history band is still empty.
    expect(at("2026-06-14")).toMatchObject({ unknown: 0, in_progress: 2, done: 0, todo: 0 })
  })

  it("done band first appears when the completion event lands, and never decreases", () => {
    expect(at("2026-06-17")).toMatchObject({ done: 0, unknown: 2 }) // T2/T4 exist but have no history
    expect(at("2026-06-18").done).toBe(1) // -2d: T1 → done
    const doneSeries = cfd.points.map((p) => p.done)
    for (let i = 1; i < doneSeries.length; i++) {
      expect(doneSeries[i]).toBeGreaterThanOrEqual(doneSeries[i - 1]) // monotonic (no reopen in fixture)
    }
  })

  it("days before any task existed are all-zero", () => {
    expect(at("2026-06-09")).toMatchObject({ unknown: 0, backlog: 0, todo: 0, in_progress: 0, testing: 0, review: 0, done: 0 })
  })

  it("empty board → range of zero-points, no crash", () => {
    const e = computeCfd([], [], NOW, 7)
    expect(e.coveredOf).toBe(0)
    expect(e.total).toBe(0)
    expect(e.points).toHaveLength(7)
    expect(e.points.every((p) => p.unknown + p.backlog + p.todo + p.in_progress + p.testing + p.review + p.done === 0)).toBe(true)
  })

  it("keeps legacy unrecognized statuses in the explicit unknown band", () => {
    const task: FlowTask = {
      id: "legacy",
      taskKey: "B-LEGACY",
      title: "Legacy status",
      status: "custom_status",
      createdAt: d(3),
      completedAt: null,
    }
    const events: FlowEvent[] = [
      { taskId: task.id, oldValue: "custom_status", newValue: "another_custom_status", at: d(1) },
    ]
    const result = computeCfd([task], events, NOW, 4)
    expect(result.points.every((point) => point.unknown === 1)).toBe(true)
  })
})

describe("computeReopened", () => {
  it("base fixture has no reopens (no done → active transition)", () => {
    const r = computeReopened(TASKS, EVENTS)
    expect(r.reopenEvents).toBe(0)
    expect(r.reopenedTasks).toBe(0)
    expect(r.completedCount).toBe(2) // T1, T2 have completedAt
    expect(r.reworkRatePct).toBe(0)
    expect(r.coveredOf).toBe(2) // T1, T3 have events
    expect(r.total).toBe(4)
    expect(r.topReopened).toEqual([])
  })

  it("counts done → non-done transitions as reopens, per task + total", () => {
    const tasks: FlowTask[] = [
      { id: "r1", taskKey: "B-9", title: "Bouncer", status: "done", createdAt: d(20), completedAt: d(1) },
      { id: "r2", taskKey: "B-10", title: "Clean", status: "done", createdAt: d(10), completedAt: d(3) },
    ]
    const events: FlowEvent[] = [
      { taskId: "r1", oldValue: "in_progress", newValue: "done", at: d(15) },
      { taskId: "r1", oldValue: "done", newValue: "in_progress", at: d(12) }, // reopen #1
      { taskId: "r1", oldValue: "in_progress", newValue: "done", at: d(8) },
      { taskId: "r1", oldValue: "done", newValue: "review", at: d(6) }, // reopen #2 (review folds non-done)
      { taskId: "r1", oldValue: "review", newValue: "done", at: d(1) },
      { taskId: "r2", oldValue: "todo", newValue: "done", at: d(3) }, // forward only, no reopen
    ]
    const r = computeReopened(tasks, events)
    expect(r.reopenEvents).toBe(2) // r1 bounced twice
    expect(r.reopenedTasks).toBe(1) // only r1
    expect(r.completedCount).toBe(2)
    expect(r.reworkRatePct).toBe(50) // 1 reopened / 2 completed
    expect(r.topReopened).toEqual([{ id: "r1", taskKey: "B-9", title: "Bouncer", count: 2 }])
  })

  it("done → completed and done → cancelled are NOT reopens (both fold to the done stage)", () => {
    const tasks: FlowTask[] = [{ id: "x", taskKey: "B-1", title: "X", status: "done", createdAt: d(5), completedAt: d(1) }]
    const events: FlowEvent[] = [
      { taskId: "x", oldValue: "done", newValue: "completed", at: d(3) },
      { taskId: "x", oldValue: "completed", newValue: "cancelled", at: d(2) },
    ]
    expect(computeReopened(tasks, events).reopenEvents).toBe(0)
  })

  it("topReopened is sorted by reopen count desc and capped", () => {
    const tasks: FlowTask[] = [
      { id: "a", taskKey: "B-1", title: "A", status: "in_progress", createdAt: d(9), completedAt: null },
      { id: "b", taskKey: "B-2", title: "B", status: "in_progress", createdAt: d(9), completedAt: null },
    ]
    const events: FlowEvent[] = [
      { taskId: "a", oldValue: "done", newValue: "todo", at: d(5) }, // a: 1 reopen
      { taskId: "b", oldValue: "done", newValue: "todo", at: d(5) }, // b: 2 reopens
      { taskId: "b", oldValue: "done", newValue: "in_progress", at: d(3) },
    ]
    const r = computeReopened(tasks, events)
    expect(r.topReopened.map((x) => x.id)).toEqual(["b", "a"])
    expect(r.reworkRatePct).toBe(0) // nothing completed → no divide-by-zero
  })

  it("empty → zeros", () => {
    const r = computeReopened([], [])
    expect(r).toMatchObject({ reopenEvents: 0, reopenedTasks: 0, completedCount: 0, reworkRatePct: 0, coveredOf: 0, total: 0 })
    expect(r.topReopened).toEqual([])
  })

  it("counts only reopen events and completions in the selected window", () => {
    const tasks: FlowTask[] = [
      { id: "r1", taskKey: "B-9", title: "Old reopen", status: "done", createdAt: d(20), completedAt: d(10) },
      { id: "r2", taskKey: "B-10", title: "Recent", status: "done", createdAt: d(5), completedAt: d(1) },
    ]
    const events: FlowEvent[] = [
      { taskId: "r1", oldValue: "done", newValue: "todo", at: d(12) },
      { taskId: "r2", oldValue: "done", newValue: "todo", at: d(2) },
    ]
    const r = computeReopened(tasks, events, d(7), NOW)
    expect(r.reopenEvents).toBe(1)
    expect(r.completedCount).toBe(1)
    expect(r.reworkRatePct).toBe(100)
  })
})

describe("computeSla", () => {
  // Same fixture: only T1 has a measurable cycle (7d: done -2d minus in_progress -9d).
  // T2 is completed but has no history ⇒ no measurable cycle. T3/T4 are open.
  it("% of measurable-cycle completed tasks meeting cycle ≤ target", () => {
    const s = computeSla(TASKS, EVENTS, 7)
    expect(s.targetDays).toBe(7)
    expect(s.measuredCount).toBe(1) // only T1 has a measurable cycle
    expect(s.coveredOf).toBe(2) // 2 completed (T1, T2); T2 has no cycle
    expect(s.metCount).toBe(1) // T1 cycle 7d ≤ 7
    expect(s.pct).toBe(100)
  })

  it("tighter target → fewer meet", () => {
    const s = computeSla(TASKS, EVENTS, 5)
    expect(s.metCount).toBe(0) // T1 cycle 7d > 5
    expect(s.pct).toBe(0)
    expect(s.measuredCount).toBe(1)
  })

  it("looser target → all measurable meet", () => {
    expect(computeSla(TASKS, EVENTS, 10).pct).toBe(100)
  })

  it("no history → nothing measurable, pct 0, coverage still counts completed", () => {
    const s = computeSla(TASKS, [], 5)
    expect(s.measuredCount).toBe(0)
    expect(s.metCount).toBe(0)
    expect(s.pct).toBe(0)
    expect(s.coveredOf).toBe(2) // 2 completed, none measurable
  })

  it("empty board → zeros, target echoed", () => {
    expect(computeSla([], [], 5)).toMatchObject({ measuredCount: 0, metCount: 0, pct: 0, coveredOf: 0, targetDays: 5 })
  })
})
