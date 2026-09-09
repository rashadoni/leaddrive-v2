/**
 * Pure Tier-1 board analytics (custom columns Phase 4 / Board Reports, Phase A).
 *
 * Current-state + date aggregations only — NO TaskActivity, so zero history
 * caveats (the flow metrics in Tier 2/3 are a later phase). Kept a PURE function
 * (deterministic given `now`) so it's unit-testable; the route fetches the rows
 * and the UI renders the bundle. Legacy statuses are folded to canonical stages
 * with the SAME map the board uses (STATUS_TO_STAGE), and WIP buckets reuse
 * resolveLaneKey so a task lands in exactly the lane the board shows it in.
 */
import { STATUS_TO_STAGE, resolveLaneKey, type LaneColumn } from "./board-columns"

export interface AnalyticsTask {
  id: string
  taskKey: string | null
  title: string
  status: string
  boardColumnKey: string | null
  type: string | null
  dueDate: Date | null
  completedAt: Date | null
  createdAt: Date
  assignedTo: string | null
  assigneeName: string | null
  estimatedHours: number | null
  estimatedPrice: number | null
}

export interface AnalyticsColumn extends LaneColumn {
  label: string
  color: string | null
}

export interface TaskRef {
  id: string
  taskKey: string | null
  title: string
  dueDate: string | null
  assignedTo: string | null
  assigneeName: string | null
}

export interface Tier1Analytics {
  range: { days: number; start: string; end: string }
  totals: {
    totalTasks: number
    wip: number
    done: number
    overdue: number
    dueSoon: number
    throughputThisWeek: number
  }
  wip: { key: string; label: string; mapsToStatus: string; count: number; color: string | null }[]
  throughput: { weekStart: string; count: number }[]
  assigneeThroughput: { userId: string | null; name: string | null; count: number }[]
  createdVsResolved: { weekStart: string; created: number; resolved: number }[]
  workload: {
    userId: string | null
    name: string | null
    total: number
    hours: number
    byStage: Record<string, number>
    completed: number
    open: number
    inProgress: number
    notStarted: number
    overdue: number
    completionRate: number
  }[]
  due: { overdue: TaskRef[]; dueSoon: TaskRef[] }
  workMix: { type: string; count: number }[]
}

export interface ValueRollup {
  byLane: { key: string; label: string; mapsToStatus: string; color: string | null; value: number; hours: number; count: number }[]
  totalValue: number
  totalHours: number
  openCount: number // open (non-done) tasks in the pipeline
  withValue: number // of those, how many carry an estimatedPrice
  withHours: number // of those, how many carry an estimatedHours
}

export interface BurnupPoint {
  date: string // YYYY-MM-DD (UTC day)
  scope: number // cumulative tasks created as-of end of day
  done: number // cumulative tasks completed as-of end of day
}
export interface Burnup {
  points: BurnupPoint[] // oldest → newest; last point clamped to now (live)
  total: number // tasks.length — scope at the final point
}

export interface MonteCarlo {
  remaining: number // open (non-done) tasks to finish
  throughputDays: number // days of throughput history sampled
  throughputTotal: number // completions in that window (sample sufficiency)
  trials: number
  sufficient: boolean // false ⇒ too little history to forecast (forecast empty)
  // p50/p70/p85/p95 → days-from-now + date. `capped` = the simulation hit the 10y
  // horizon (backlog too big for the throughput) ⇒ the date is NOT trustworthy and
  // is left empty; the UI shows "≥ Nd" instead of a fabricated date.
  forecast: { p: number; days: number; capped: boolean; date: string }[]
}

const STAGES = ["backlog", "todo", "in_progress", "testing", "review", "done"] as const

function foldStage(status: string): string {
  return STATUS_TO_STAGE[status] ?? "backlog"
}

function isDone(status: string): boolean {
  return foldStage(status) === "done"
}

// Monday 00:00 UTC of the week containing `d` (deterministic, TZ-free).
function weekStartUTC(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const mondayIdx = (x.getUTCDay() + 6) % 7 // Sun=6, Mon=0
  x.setUTCDate(x.getUTCDate() - mondayIdx)
  return x
}

function toRef(t: AnalyticsTask): TaskRef {
  return {
    id: t.id,
    taskKey: t.taskKey,
    title: t.title,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    assignedTo: t.assignedTo,
    assigneeName: t.assigneeName,
  }
}

export function computeTier1Analytics(
  tasks: AnalyticsTask[],
  columns: AnalyticsColumn[],
  now: Date,
  rangeDays: number,
): Tier1Analytics {
  const start = new Date(now.getTime() - rangeDays * 86_400_000)
  const dueSoonEnd = new Date(now.getTime() + 7 * 86_400_000)
  const laneCols: LaneColumn[] = columns.map((c) => ({ key: c.key, mapsToStatus: c.mapsToStatus }))

  // ── weekly buckets across the range ──
  const weeks: { weekStart: string; created: number; resolved: number }[] = []
  const weekIndex = new Map<string, number>()
  {
    let w = weekStartUTC(start)
    const lastWeek = weekStartUTC(now)
    while (w.getTime() <= lastWeek.getTime()) {
      const key = w.toISOString()
      weekIndex.set(key, weeks.length)
      weeks.push({ weekStart: key, created: 0, resolved: 0 })
      w = new Date(w.getTime() + 7 * 86_400_000)
    }
  }
  const thisWeekKey = weekStartUTC(now).toISOString()

  // ── single pass over tasks ──
  const wipCounts = new Map<string, number>() // lane key → count (open tasks only)
  const assigneeResolved = new Map<string | null, { name: string | null; count: number }>()
  const workloadMap = new Map<string | null, {
    name: string | null
    total: number
    hours: number
    byStage: Record<string, number>
    completed: number
    open: number
    inProgress: number
    notStarted: number
    overdue: number
  }>()
  const typeCounts = new Map<string, number>()
  const overdue: TaskRef[] = []
  const dueSoon: TaskRef[] = []
  let wip = 0
  let done = 0
  let throughputThisWeek = 0

  for (const t of tasks) {
    const stage = foldStage(t.status)
    const taskDone = stage === "done"

    // work mix (report 6) — over ALL tasks
    const ty = t.type ?? "task"
    typeCounts.set(ty, (typeCounts.get(ty) ?? 0) + 1)

    // workload (report 4) — current load per assignee, by stage, over ALL tasks
    {
      const wl = workloadMap.get(t.assignedTo) ?? {
        name: t.assigneeName,
        total: 0,
        hours: 0,
        byStage: Object.fromEntries(STAGES.map((s) => [s, 0])),
        completed: 0,
        open: 0,
        inProgress: 0,
        notStarted: 0,
        overdue: 0,
      }
      wl.total += 1
      wl.hours += t.estimatedHours ?? 0
      wl.byStage[stage] = (wl.byStage[stage] ?? 0) + 1
      if (taskDone) wl.completed += 1
      else {
        wl.open += 1
        if (stage === "backlog" || stage === "todo") wl.notStarted += 1
        else wl.inProgress += 1
        if (t.dueDate && t.dueDate.getTime() < now.getTime()) wl.overdue += 1
      }
      workloadMap.set(t.assignedTo, wl)
    }

    if (taskDone) {
      done += 1
    } else {
      // WIP snapshot (report 1) + overdue/due-soon (report 5) — OPEN tasks only.
      // A done task with a past dueDate is intentionally NOT counted "overdue"
      // (closed work isn't at risk), which is why this lives in the open branch.
      wip += 1
      const lane = resolveLaneKey({ status: t.status, boardColumnKey: t.boardColumnKey }, laneCols)
      if (lane) wipCounts.set(lane, (wipCounts.get(lane) ?? 0) + 1)
      if (t.dueDate) {
        if (t.dueDate.getTime() < now.getTime()) overdue.push(toRef(t))
        else if (t.dueDate.getTime() <= dueSoonEnd.getTime()) dueSoon.push(toRef(t))
      }
    }

    // throughput / resolved (reports 2, 2b, 3) — keyed off completedAt in range
    if (t.completedAt && t.completedAt.getTime() >= start.getTime() && t.completedAt.getTime() <= now.getTime()) {
      const wk = weekStartUTC(t.completedAt).toISOString()
      const idx = weekIndex.get(wk)
      if (idx !== undefined) weeks[idx].resolved += 1
      if (wk === thisWeekKey) throughputThisWeek += 1
      const ar = assigneeResolved.get(t.assignedTo) ?? { name: t.assigneeName, count: 0 }
      ar.count += 1
      assigneeResolved.set(t.assignedTo, ar)
    }
    // created in range (report 3)
    if (t.createdAt.getTime() >= start.getTime() && t.createdAt.getTime() <= now.getTime()) {
      const wk = weekStartUTC(t.createdAt).toISOString()
      const idx = weekIndex.get(wk)
      if (idx !== undefined) weeks[idx].created += 1
    }
  }

  // WIP in board-column order
  const wipReport = columns.map((c) => ({
    key: c.key,
    label: c.label,
    mapsToStatus: c.mapsToStatus,
    count: wipCounts.get(c.key) ?? 0,
    color: c.color,
  }))

  const round1 = (n: number) => Math.round(n * 10) / 10

  return {
    range: { days: rangeDays, start: start.toISOString(), end: now.toISOString() },
    totals: {
      totalTasks: tasks.length,
      wip,
      done,
      overdue: overdue.length,
      dueSoon: dueSoon.length,
      throughputThisWeek,
    },
    wip: wipReport,
    throughput: weeks.map((w) => ({ weekStart: w.weekStart, count: w.resolved })),
    assigneeThroughput: [...assigneeResolved.entries()]
      .map(([userId, v]) => ({ userId, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count),
    createdVsResolved: weeks.map((w) => ({ weekStart: w.weekStart, created: w.created, resolved: w.resolved })),
    workload: [...workloadMap.entries()]
      .map(([userId, v]) => ({
        userId,
        name: v.name,
        total: v.total,
        hours: round1(v.hours),
        byStage: v.byStage,
        completed: v.completed,
        open: v.open,
        inProgress: v.inProgress,
        notStarted: v.notStarted,
        overdue: v.overdue,
        completionRate: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total),
    due: {
      overdue: overdue.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
      dueSoon: dueSoon.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
    },
    workMix: [...typeCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
  }
}

/**
 * Value / effort in pipeline (Tier-3 #16). Sums estimatedPrice + estimatedHours of
 * OPEN tasks (done excluded — pipeline = unrealised work), grouped by the same board
 * lane the WIP card uses (resolveLaneKey). Pure current-state: needs no history, so
 * it is always accurate. Honesty: estimates are nullable, so withValue/withHours
 * disclose how many open tasks actually carry each estimate (unestimated open work
 * is invisible to the sums) — the UI surfaces this so the totals aren't over-read.
 */
export function computeValueRollup(tasks: AnalyticsTask[], columns: AnalyticsColumn[]): ValueRollup {
  const laneCols: LaneColumn[] = columns.map((c) => ({ key: c.key, mapsToStatus: c.mapsToStatus }))
  const byLane = new Map<string, { value: number; hours: number; count: number }>()
  let totalValue = 0
  let totalHours = 0
  let openCount = 0
  let withValue = 0
  let withHours = 0
  for (const t of tasks) {
    if (isDone(t.status)) continue // pipeline = open work only
    openCount += 1
    const v = t.estimatedPrice ?? 0
    const h = t.estimatedHours ?? 0
    if (t.estimatedPrice != null) withValue += 1
    if (t.estimatedHours != null) withHours += 1
    totalValue += v
    totalHours += h
    const lane = resolveLaneKey({ status: t.status, boardColumnKey: t.boardColumnKey }, laneCols)
    if (!lane) continue
    const b = byLane.get(lane) ?? { value: 0, hours: 0, count: 0 }
    b.value += v
    b.hours += h
    b.count += 1
    byLane.set(lane, b)
  }
  const r1 = (n: number) => Math.round(n * 10) / 10
  const r2 = (n: number) => Math.round(n * 100) / 100
  return {
    byLane: columns.map((c) => {
      const b = byLane.get(c.key) ?? { value: 0, hours: 0, count: 0 }
      return { key: c.key, label: c.label, mapsToStatus: c.mapsToStatus, color: c.color, value: r2(b.value), hours: r1(b.hours), count: b.count }
    }),
    totalValue: r2(totalValue),
    totalHours: r1(totalHours),
    openCount,
    withValue,
    withHours,
  }
}

/**
 * Burnup (Tier-3 #15). Two cumulative lines over the range: scope = tasks created
 * as-of each day, done = tasks completed as-of each day. Pure current-state from
 * createdAt/completedAt (no status history) so it is always accurate; the gap
 * between the lines is the remaining work. Same UTC-day cutoffs as the CFD, the
 * final point clamped to now so it reflects the live totals.
 */
export function computeBurnup(tasks: AnalyticsTask[], now: Date, rangeDays: number): Burnup {
  const DAY = 86_400_000
  const days = Math.max(1, Math.min(180, Math.floor(rangeDays) || 30))
  const nowMs = now.getTime()
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const created = tasks.map((t) => t.createdAt.getTime()).sort((a, b) => a - b)
  const completed = tasks
    .filter((t) => t.completedAt)
    .map((t) => t.completedAt!.getTime())
    .sort((a, b) => a - b)
  // count of sorted values ≤ cutoff (binary search — O(log n) per day)
  const countLE = (arr: number[], cutoff: number) => {
    let lo = 0
    let hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid] <= cutoff) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const points: BurnupPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = todayStart - i * DAY
    const cutoff = Math.min(dayStart + DAY - 1, nowMs)
    points.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      scope: countLE(created, cutoff),
      done: countLE(completed, cutoff),
    })
  }
  return { points, total: tasks.length }
}

/**
 * Monte-Carlo completion forecast (Tier-3 #17). Simulates finishing the OPEN tasks
 * by repeatedly sampling the board's historical daily-throughput distribution
 * (completions per UTC day over the window, zero-days included) and counting the
 * days until `remaining` items are done; the percentiles of that distribution give
 * p50/p70/p85/p95 forecast dates. Throughput is `completedAt`-based (no status
 * history). Sufficiency guard: needs ≥14 days of history AND ≥3 completions AND a
 * non-zero backlog — else it returns sufficient=false + an empty forecast rather
 * than a confident-but-wrong projection from too little data. `rng` is injectable
 * so the stochastic result is deterministic in tests.
 */
export function computeMonteCarlo(
  tasks: AnalyticsTask[],
  now: Date,
  rangeDays: number,
  rng: () => number = Math.random,
  trials = 1000,
): MonteCarlo {
  const DAY = 86_400_000
  const remaining = tasks.filter((t) => !isDone(t.status)).length
  const days = Math.max(1, Math.min(180, Math.floor(rangeDays) || 30))
  const nowMs = now.getTime()
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const windowStart = todayStart - (days - 1) * DAY

  // one throughput sample per day in the window (including zero-completion days)
  const samples = new Array<number>(days).fill(0)
  for (const t of tasks) {
    if (!t.completedAt) continue
    const cm = t.completedAt.getTime()
    if (cm > nowMs) continue
    const dayStart = Date.UTC(t.completedAt.getUTCFullYear(), t.completedAt.getUTCMonth(), t.completedAt.getUTCDate())
    const idx = Math.round((dayStart - windowStart) / DAY)
    if (idx >= 0 && idx < days) samples[idx] += 1
  }
  const throughputTotal = samples.reduce((a, b) => a + b, 0)

  const sufficient = remaining > 0 && days >= 14 && throughputTotal >= 3
  if (!sufficient) {
    return { remaining, throughputDays: days, throughputTotal, trials, sufficient: false, forecast: [] }
  }

  const cap = 3650 // 10y safety bound so a near-zero throughput run can't loop forever
  const results: number[] = []
  for (let i = 0; i < trials; i++) {
    let done = 0
    let d = 0
    while (done < remaining && d < cap) {
      done += samples[Math.floor(rng() * days)] // draw a random day's throughput
      d += 1
    }
    results.push(d)
  }
  results.sort((a, b) => a - b)
  const pctDays = (p: number) => results[Math.min(results.length - 1, Math.max(0, Math.ceil((p / 100) * results.length) - 1))]
  const forecast = [50, 70, 85, 95].map((p) => {
    const fd = pctDays(p)
    // capped ⇒ this percentile's trial never finished within the 10y horizon, so the
    // value is only a lower bound — never print it as a date (anti-confident-but-wrong).
    const capped = fd >= cap
    return { p, days: fd, capped, date: capped ? "" : new Date(nowMs + fd * DAY).toISOString().slice(0, 10) }
  })
  return { remaining, throughputDays: days, throughputTotal, trials, sufficient: true, forecast }
}

export function rangeToDays(range: string | null | undefined): number {
  return range === "7d" ? 7 : range === "90d" ? 90 : 30
}
