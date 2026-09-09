/**
 * Pure Tier-2 board flow metrics (Board Reports Phase B.1) — cycle time, lead
 * time, aging WIP, time-in-status. Reconstructed from the `status_changed`
 * TaskActivity timeline (now reliable since the §5.7 fix; older / un-bulk-fixed
 * tasks may still lack history → every metric reports COVERAGE: "based on N of M").
 *
 * "Active stages" (the cycle-time clock starts when a task first enters one) are
 * the RECORDED statuses in_progress / testing / review — keyed off the history's
 * status, NOT a column's mapsToStatus, so it survives custom columns where two
 * columns share a status. Legacy statuses are folded to canonical stages
 * (STATUS_TO_STAGE) so they align with the 6 lanes.
 *
 * `computeCfd` (Tier-2 #11) reconstructs the daily per-stage Cumulative Flow from
 * the same timeline. A no-event task's past lane is unknowable, so historical
 * points place it in an explicit `unknown` band instead of fabricating a stage.
 * The final point is an exact live snapshot of every task on the board.
 */
import { STATUS_TO_STAGE } from "./board-columns"

const ACTIVE_STAGES = new Set(["in_progress", "testing", "review"])
const DAY = 86_400_000

// Global fallback SLA cycle-time target (calendar days) for boards that haven't set
// their own Division.slaTargetDays (Board Reports Tier-3 #14).
export const DEFAULT_SLA_TARGET_DAYS = 5

export interface FlowTask {
  id: string
  taskKey: string | null
  title: string
  status: string
  createdAt: Date
  completedAt: Date | null
}
export interface FlowEvent {
  taskId: string
  oldValue: string | null
  newValue: string | null
  at: Date
}

export interface Histogram {
  label: string
  count: number
}
export interface DurationStats {
  count: number
  coveredOf: number
  medianDays: number
  p85Days: number
  p95Days: number
  histogram: Histogram[]
}
export interface CfdPoint {
  date: string // YYYY-MM-DD (UTC day)
  unknown: number // existed on this day, but no reconstructable status history
  backlog: number
  todo: number
  in_progress: number
  testing: number
  review: number
  done: number
}
export interface Cfd {
  coveredOf: number // tasks WITH ≥1 status_changed event (reconstructable)
  total: number
  points: CfdPoint[] // oldest → newest, one per day in range; final point includes all tasks
}

export interface SlaStats {
  targetDays: number // the cycle-time target this % was measured against (echoed for the UI)
  measuredCount: number // completed tasks with a measurable cycle (the SLA denominator)
  metCount: number // of those, how many had cycle ≤ targetDays
  pct: number // metCount ÷ measuredCount as a percent (0 when none measurable)
  coveredOf: number // completed tasks total (measuredCount of these have a usable cycle)
}

export interface ReopenedStats {
  reopenEvents: number // total done → non-done transitions (raw rework volume)
  reopenedTasks: number // distinct tasks reopened ≥1 time
  completedCount: number // tasks with completedAt (the rework-rate denominator)
  reworkRatePct: number // reopenedTasks ÷ completedCount, as a percent (0 if none completed; can exceed 100% when tasks are reopened but not yet re-completed — an honest "more reopens than completions" signal, not clamped)
  coveredOf: number // tasks WITH ≥1 status_changed event (history needed to detect reopens)
  total: number
  topReopened: { id: string; taskKey: string | null; title: string; count: number }[]
}

export interface FlowMetrics {
  leadTime: DurationStats
  cycleTime: DurationStats
  aging: {
    p85CycleDays: number
    atRiskCount: number
    tasks: { id: string; taskKey: string | null; title: string; status: string; ageDays: number; atRisk: boolean; ageFromFallback: boolean }[]
  }
  timeInStatus: {
    coveredOf: number
    total: number
    stages: { stage: string; avgDays: number; count: number }[]
  }
}

const STAGES = ["backlog", "todo", "in_progress", "testing", "review", "done"] as const

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// Nearest-rank percentile on an UNSORTED array (sorts a copy).
function percentile(values: number[], q: number): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))
  return s[idx]
}

const DAY_BUCKETS = [1, 2, 3, 5, 7, 14, 30, Infinity]
const DAY_LABELS = ["≤1d", "1–2d", "2–3d", "3–5d", "5–7d", "1–2wk", "2–4wk", ">1mo"]
function histogram(days: number[]): Histogram[] {
  const counts = new Array(DAY_BUCKETS.length).fill(0)
  for (const d of days) {
    let i = DAY_BUCKETS.findIndex((b) => d <= b)
    if (i < 0) i = DAY_BUCKETS.length - 1
    counts[i] += 1
  }
  return DAY_LABELS.map((label, i) => ({ label, count: counts[i] }))
}

function durationStats(daysArr: number[], coveredOf: number): DurationStats {
  return {
    count: daysArr.length,
    coveredOf,
    medianDays: round1(percentile(daysArr, 0.5)),
    p85Days: round1(percentile(daysArr, 0.85)),
    p95Days: round1(percentile(daysArr, 0.95)),
    histogram: histogram(daysArr),
  }
}

export function computeFlowMetrics(tasks: FlowTask[], events: FlowEvent[], now: Date, windowStart?: Date): FlowMetrics {
  // Group events per task, ascending by time.
  const byTask = new Map<string, FlowEvent[]>()
  for (const e of events) {
    const arr = byTask.get(e.taskId)
    if (arr) arr.push(e)
    else byTask.set(e.taskId, [e])
  }
  for (const arr of byTask.values()) arr.sort((a, b) => a.at.getTime() - b.at.getTime())

  const completed = tasks.filter((t) =>
    t.completedAt
    && (!windowStart || t.completedAt.getTime() >= windowStart.getTime())
    && t.completedAt.getTime() <= now.getTime(),
  )

  // ── lead time (always computable for completed tasks) ──
  const leadDays = completed.map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / DAY).filter((d) => d >= 0)

  // ── cycle time (needs a recorded entry into an active stage) ──
  // Reopen note: cycle uses the FIRST active-stage entry vs the final completedAt,
  // so a done→reopened→done task counts the dormant gap. Reopen/rework handling is
  // a Tier-3 (#13) concern, intentionally not corrected here.
  const cycleDays: number[] = []
  for (const t of completed) {
    const evs = byTask.get(t.id)
    if (!evs) continue
    const firstActive = evs.find((e) => e.newValue && ACTIVE_STAGES.has(e.newValue))
    if (firstActive) {
      const c = (t.completedAt!.getTime() - firstActive.at.getTime()) / DAY
      if (c >= 0) cycleDays.push(c)
    }
  }
  const cycle = durationStats(cycleDays, completed.length)
  const p85Cycle = cycle.p85Days

  // ── aging WIP (open tasks; age since entering current status) ──
  const openTasks = tasks.filter((t) => STATUS_TO_STAGE[t.status] !== "done")
  const aging = openTasks
    .map((t) => {
      const evs = byTask.get(t.id) ?? []
      // latest event whose newValue is the task's CURRENT status → entered-at.
      // If none is recorded, fall back to createdAt (over-states age) and FLAG it
      // so the UI can footnote the guess instead of presenting it as measured.
      let enteredAt = t.createdAt
      let ageFromFallback = true
      for (let i = evs.length - 1; i >= 0; i--) {
        if (evs[i].newValue === t.status) {
          enteredAt = evs[i].at
          ageFromFallback = false
          break
        }
      }
      const ageDays = round1(Math.max(0, (now.getTime() - enteredAt.getTime()) / DAY))
      return {
        id: t.id,
        taskKey: t.taskKey,
        title: t.title,
        status: t.status,
        ageDays,
        atRisk: p85Cycle > 0 && ageDays > p85Cycle,
        ageFromFallback,
      }
    })
    .sort((a, b) => b.ageDays - a.ageDays)

  // ── time-in-status (needs a transition timeline) ──
  const stageTotals = new Map<string, { sum: number; count: number }>()
  for (const s of STAGES) stageTotals.set(s, { sum: 0, count: 0 })
  let tisCovered = 0
  for (const t of tasks) {
    const evs = byTask.get(t.id)
    if (!evs || !evs.length) continue
    tisCovered += 1
    const end = (t.completedAt ?? now).getTime()
    // segment [createdAt → evs[0].at] in the pre-first status (evs[0].oldValue)
    const segments: { status: string | null; from: number; to: number }[] = [
      { status: evs[0].oldValue, from: t.createdAt.getTime(), to: evs[0].at.getTime() },
    ]
    for (let i = 0; i < evs.length; i++) {
      const to = i + 1 < evs.length ? evs[i + 1].at.getTime() : end
      segments.push({ status: evs[i].newValue, from: evs[i].at.getTime(), to })
    }
    const seenStages = new Set<string>()
    for (const seg of segments) {
      const from = windowStart ? Math.max(seg.from, windowStart.getTime()) : seg.from
      const to = Math.min(seg.to, now.getTime())
      if (!seg.status || to <= from) continue
      const stage = STATUS_TO_STAGE[seg.status]
      if (!stage) continue
      const bucket = stageTotals.get(stage)
      if (!bucket) continue
      bucket.sum += (to - from) / DAY
      if (!seenStages.has(stage)) {
        bucket.count += 1
        seenStages.add(stage)
      }
    }
  }

  return {
    leadTime: durationStats(leadDays, completed.length),
    cycleTime: cycle,
    aging: {
      p85CycleDays: p85Cycle,
      atRiskCount: aging.filter((a) => a.atRisk).length,
      tasks: aging,
    },
    timeInStatus: {
      coveredOf: tisCovered,
      total: tasks.length,
      stages: STAGES.map((stage) => {
        const b = stageTotals.get(stage)!
        return { stage, avgDays: b.count ? round1(b.sum / b.count) : 0, count: b.count }
      }),
    },
  }
}

/**
 * Cumulative Flow Diagram (Tier-2 #11). For each UTC day in the range, counts how
 * many tasks sit in each canonical stage as-of the END of that day — reconstructed
 * from the latest `status_changed` whose timestamp ≤ the cutoff (legacy-normalised
 * via STATUS_TO_STAGE); before a task's first recorded event it is placed in that
 * event's `oldValue` (its pre-transition base). Tasks without usable history are
 * counted in `unknown` on historical days. The final point is clamped to `now` and
 * uses each task's current status, so the current board snapshot includes all tasks.
 */
export function computeCfd(tasks: FlowTask[], events: FlowEvent[], now: Date, rangeDays: number): Cfd {
  const byTask = new Map<string, FlowEvent[]>()
  for (const e of events) {
    const arr = byTask.get(e.taskId)
    if (arr) arr.push(e)
    else byTask.set(e.taskId, [e])
  }
  for (const arr of byTask.values()) arr.sort((a, b) => a.at.getTime() - b.at.getTime())

  const coveredIds = new Set(tasks.filter((t) => byTask.has(t.id)).map((t) => t.id))

  // Cap the daily loop at 180 points (intentional: boards are small and no current
  // range exceeds 90d; the guard just bounds a pathological rangeDays, not real use).
  const days = Math.max(1, Math.min(180, Math.floor(rangeDays) || 30))
  const nowMs = now.getTime()
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  const points: CfdPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = todayStart - i * DAY
    const cutoff = Math.min(dayStart + DAY - 1, nowMs) // end of day, clamped to now for today
    const isLivePoint = cutoff === nowMs
    const counts: Record<string, number> = { unknown: 0, backlog: 0, todo: 0, in_progress: 0, testing: 0, review: 0, done: 0 }
    for (const t of tasks) {
      if (t.createdAt.getTime() > cutoff) continue // not yet created at this cutoff
      // The last point is a current snapshot, not a reconstruction. Using the
      // stored task status here makes its total reconcile with the live board.
      if (isLivePoint) {
        const liveStage = STATUS_TO_STAGE[t.status]
        if (liveStage) counts[liveStage] += 1
        else counts.unknown += 1
        continue
      }

      const evs = byTask.get(t.id)
      if (!evs?.length) {
        counts.unknown += 1
        continue
      }
      let status: string | null = null
      for (const e of evs) {
        if (e.at.getTime() <= cutoff) status = e.newValue
        else break // ascending ⇒ all remaining are later
      }
      if (status === null) status = evs[0].oldValue ?? t.status // pre-first-event base
      const stage = STATUS_TO_STAGE[status]
      if (stage) counts[stage] += 1
      else counts.unknown += 1
    }
    points.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      unknown: counts.unknown,
      backlog: counts.backlog,
      todo: counts.todo,
      in_progress: counts.in_progress,
      testing: counts.testing,
      review: counts.review,
      done: counts.done,
    })
  }

  return { coveredOf: coveredIds.size, total: tasks.length, points }
}

/**
 * Reopened / rework (Tier-3 #13). Counts `status_changed` transitions that regress
 * from a done-stage back to a non-done stage (legacy-folded via STATUS_TO_STAGE, so
 * done→completed / done→cancelled are NOT reopens — both fold to done). rework% =
 * distinct reopened tasks ÷ completed tasks. Needs the history timeline, so the
 * covered fraction is disclosed exactly like the other flow metrics.
 */
export function computeReopened(tasks: FlowTask[], events: FlowEvent[], windowStart?: Date, now?: Date): ReopenedStats {
  const perTask = new Map<string, number>()
  const eventTaskIds = new Set<string>()
  let reopenEvents = 0
  for (const e of events) {
    if (windowStart && e.at.getTime() < windowStart.getTime()) continue
    if (now && e.at.getTime() > now.getTime()) continue
    eventTaskIds.add(e.taskId)
    if (!e.oldValue || !e.newValue) continue
    const from = STATUS_TO_STAGE[e.oldValue]
    const to = STATUS_TO_STAGE[e.newValue]
    if (from === "done" && to && to !== "done") {
      reopenEvents += 1
      perTask.set(e.taskId, (perTask.get(e.taskId) ?? 0) + 1)
    }
  }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const topReopened = [...perTask.entries()]
    .map(([id, count]) => {
      const tk = byId.get(id)
      return { id, taskKey: tk?.taskKey ?? null, title: tk?.title ?? "", count }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  const completedCount = tasks.filter((t) =>
    t.completedAt
    && (!windowStart || t.completedAt.getTime() >= windowStart.getTime())
    && (!now || t.completedAt.getTime() <= now.getTime()),
  ).length
  return {
    reopenEvents,
    reopenedTasks: perTask.size,
    completedCount,
    reworkRatePct: completedCount ? round1((perTask.size / completedCount) * 100) : 0,
    coveredOf: tasks.filter((t) => eventTaskIds.has(t.id)).length,
    total: tasks.length,
    topReopened,
  }
}

/**
 * SLA achievement (Tier-3 #14). Of the completed tasks whose cycle time is
 * MEASURABLE (a recorded active-stage entry exists — same basis as cycleTime),
 * the percent whose cycle ≤ targetDays (calendar days). Tasks without a measurable
 * cycle can't be judged, so they sit outside the denominator and the gap is
 * disclosed via measuredCount/coveredOf — same anti-confident-but-wrong discipline
 * as the other flow metrics. targetDays is resolved per-board upstream.
 */
export function computeSla(tasks: FlowTask[], events: FlowEvent[], targetDays: number, windowStart?: Date, now?: Date): SlaStats {
  const byTask = new Map<string, FlowEvent[]>()
  for (const e of events) {
    const arr = byTask.get(e.taskId)
    if (arr) arr.push(e)
    else byTask.set(e.taskId, [e])
  }
  for (const arr of byTask.values()) arr.sort((a, b) => a.at.getTime() - b.at.getTime())

  const completed = tasks.filter((t) =>
    t.completedAt
    && (!windowStart || t.completedAt.getTime() >= windowStart.getTime())
    && (!now || t.completedAt.getTime() <= now.getTime()),
  )
  let measuredCount = 0
  let metCount = 0
  for (const t of completed) {
    const evs = byTask.get(t.id)
    if (!evs) continue
    const firstActive = evs.find((e) => e.newValue && ACTIVE_STAGES.has(e.newValue))
    if (!firstActive) continue
    const cycle = (t.completedAt!.getTime() - firstActive.at.getTime()) / DAY
    if (cycle < 0) continue
    measuredCount += 1
    if (cycle <= targetDays) metCount += 1
  }
  return {
    targetDays,
    measuredCount,
    metCount,
    pct: measuredCount ? round1((metCount / measuredCount) * 100) : 0,
    coveredOf: completed.length,
  }
}
