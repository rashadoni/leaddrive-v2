import { statusBucket } from "./status-bucket"

/**
 * Operational task-report aggregation. SHARED by the export summary sheet
 * (/api/v1/tasks/export) and the on-screen report (/api/v1/tasks/report) so the
 * downloaded file and the page agree exactly. Groups tasks by a chosen dimension
 * and splits each group into the client's planned / ongoing / completed /
 * cancelled buckets.
 *
 * ⚠️  CLIENT-IMPORTED INVARIANT: report/page.tsx ("use client") imports
 * REPORT_GROUP_LABELS and REPORT_GROUP_BYS from this file as values.
 * Keep this file server-free (no prisma, no @/lib/prisma, no server-only
 * packages). Pure logic + types only. Server deps go in API routes.
 */

export type ReportGroupBy = "type" | "eventType" | "division" | "assignee" | "project" | "status" | "bucket"

export const REPORT_GROUP_BYS: readonly ReportGroupBy[] = ["type", "eventType", "division", "assignee", "project", "status", "bucket"]

export const REPORT_GROUP_LABELS: Record<ReportGroupBy, string> = {
  type: "Type", eventType: "Event type", division: "Board / Department", assignee: "Assignee",
  project: "Project", status: "Status", bucket: "Stage",
}

export interface ReportRow {
  group: string
  total: number
  planned: number
  ongoing: number
  completed: number
  cancelled: number
}

// Minimal task shape the aggregator needs (matches the export/report findMany select).
export interface AggTask {
  type: string | null
  eventType?: string | null
  status: string
  assignee?: { name: string | null } | null
  project?: { name: string | null } | null
  division?: { name: string | null; key?: string | null } | null
}

const BUCKET_TITLE: Record<string, string> = {
  planned: "Planned", ongoing: "Ongoing", completed: "Completed", cancelled: "Cancelled",
}

/** Resolve a task's group label under the chosen dimension. */
export function reportGroupValue(
  t: AggTask, groupBy: ReportGroupBy, typeLabel: Map<string, string>, eventTypeLabel: Map<string, string>,
): string {
  switch (groupBy) {
    case "type": return typeLabel.get(t.type ?? "") || t.type || "—"
    case "eventType": return eventTypeLabel.get(t.eventType ?? "") || t.eventType || "— (no event type)"
    case "division": return t.division?.name || "— (no board)"
    case "assignee": return t.assignee?.name || "Unassigned"
    case "project": return t.project?.name || "— (no project)"
    case "status": return t.status
    case "bucket": return BUCKET_TITLE[statusBucket(t.status)]
  }
}

/**
 * Aggregate tasks by a dimension into per-group planned/ongoing/completed/
 * cancelled counts (rows sorted by label) + a TOTAL row.
 */
export function aggregateTasksByGroup(
  tasks: AggTask[],
  groupBy: ReportGroupBy,
  typeLabel: Map<string, string>,
  eventTypeLabel: Map<string, string>,
): { rows: ReportRow[]; totals: ReportRow } {
  const agg = new Map<string, ReportRow>()
  for (const t of tasks) {
    const g = reportGroupValue(t, groupBy, typeLabel, eventTypeLabel)
    const row = agg.get(g) ?? { group: g, total: 0, planned: 0, ongoing: 0, completed: 0, cancelled: 0 }
    row.total++
    row[statusBucket(t.status)]++
    agg.set(g, row)
  }
  const rows = [...agg.values()].sort((a, b) => a.group.localeCompare(b.group))
  const totals: ReportRow = rows.reduce(
    (s, r) => ({
      group: "TOTAL",
      total: s.total + r.total,
      planned: s.planned + r.planned,
      ongoing: s.ongoing + r.ongoing,
      completed: s.completed + r.completed,
      cancelled: s.cancelled + r.cancelled,
    }),
    { group: "TOTAL", total: 0, planned: 0, ongoing: 0, completed: 0, cancelled: 0 },
  )
  return { rows, totals }
}

// ── Performance over time (throughput) ───────────────────────────────────────

export interface TimelineTask extends AggTask {
  completedAt: Date | string | null
}

export interface TimelineRow {
  group: string
  byPeriod: number[] // completed count per period, aligned to `periods`
  total: number
}

/** YYYY-MM of a completion date (UTC). */
function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7)
}

/**
 * Performance-over-time pivot: COMPLETED tasks (by completedAt) bucketed per
 * calendar month and grouped by the chosen dimension. group=assignee → "user
 * performance over time"; group=division → "team performance over time". Rows are
 * sorted most-productive first. Tasks with no completedAt are ignored (not yet
 * done → no throughput).
 */
export function aggregateTasksOverTime(
  tasks: TimelineTask[],
  groupBy: ReportGroupBy,
  typeLabel: Map<string, string>,
  eventTypeLabel: Map<string, string>,
): { periods: string[]; rows: TimelineRow[]; totalsByPeriod: number[] } {
  const months = new Set<string>()
  const byGroup = new Map<string, Map<string, number>>() // group → month → count
  for (const t of tasks) {
    if (!t.completedAt) continue
    const d = t.completedAt instanceof Date ? t.completedAt : new Date(t.completedAt)
    if (isNaN(d.getTime())) continue
    const m = monthKey(d)
    months.add(m)
    const g = reportGroupValue(t, groupBy, typeLabel, eventTypeLabel)
    const gm = byGroup.get(g) ?? new Map<string, number>()
    gm.set(m, (gm.get(m) ?? 0) + 1)
    byGroup.set(g, gm)
  }
  const periods = [...months].sort()
  const rows: TimelineRow[] = [...byGroup.entries()]
    .map(([group, gm]) => {
      const byPeriod = periods.map((p) => gm.get(p) ?? 0)
      return { group, byPeriod, total: byPeriod.reduce((s, n) => s + n, 0) }
    })
    .sort((a, b) => b.total - a.total || a.group.localeCompare(b.group))
  const totalsByPeriod = periods.map((_, i) => rows.reduce((s, r) => s + r.byPeriod[i], 0))
  return { periods, rows, totalsByPeriod }
}
