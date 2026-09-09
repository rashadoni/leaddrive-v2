"use client"

/**
 * Recharts views for /tasks/report. They render the SAME aggregated rows as the
 * tables below them (so chart = table = downloaded file):
 *  • ReportSummaryChart  — stacked bar, group × planned/ongoing/completed/cancelled.
 *  • ReportTimelineChart — line per group, completed tasks per calendar month.
 * Both cap the number of series for readability and DISCLOSE the cap (the table
 * below always lists every group, so no data is hidden).
 */

import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts"
import type { ReportRow, TimelineRow } from "@/lib/tasks/report-aggregate"

const BUCKETS = [
  { key: "planned", label: "Planned", color: "#94A3B8" },
  { key: "ongoing", label: "Ongoing", color: "#EA580C" },
  { key: "completed", label: "Completed", color: "#00875A" },
  { key: "cancelled", label: "Cancelled", color: "#DE350B" },
] as const

const LINE_COLORS = ["#EA580C", "#00875A", "#3B82F6", "#A855F7", "#EC4899", "#06B6D4", "#EAB308", "#64748B"]

const SUMMARY_CAP = 15
const TIMELINE_CAP = 8

function CapNote({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null
  return (
    <p className="text-center text-xs text-muted-foreground">
      Chart shows the top {shown} of {total} groups by total — the table below lists all.
    </p>
  )
}

export function ReportSummaryChart({ rows }: { rows: ReportRow[] }) {
  if (rows.length === 0) return null
  // Summary rows arrive sorted by LABEL (alphabetical), so sort by total here and
  // keep the most significant groups — otherwise a >15-group report would chart A–O.
  const top = [...rows].sort((a, b) => b.total - a.total).slice(0, SUMMARY_CAP)
  const data = top.map((r) => ({
    name: r.group, planned: r.planned, ongoing: r.ongoing, completed: r.completed, cancelled: r.cancelled,
  }))
  return (
    <div className="space-y-1">
      <div className="h-72 w-full rounded-xl border bg-card p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={64} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {BUCKETS.map((b) => (
              <Bar key={b.key} dataKey={b.key} name={b.label} stackId="a" fill={b.color} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <CapNote shown={SUMMARY_CAP} total={rows.length} />
    </div>
  )
}

export function ReportTimelineChart({ periods, rows, fmtMonth }: { periods: string[]; rows: TimelineRow[]; fmtMonth: (p: string) => string }) {
  if (periods.length === 0 || rows.length === 0) return null
  // TimelineRow[] is already sorted by total desc (most-productive first).
  const top = rows.slice(0, TIMELINE_CAP)
  const data = periods.map((p, i) => {
    const o: Record<string, string | number> = { month: fmtMonth(p) }
    for (const r of top) o[r.group] = r.byPeriod[i] ?? 0
    return o
  })
  return (
    <div className="space-y-1">
      <div className="h-72 w-full rounded-xl border bg-card p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {top.map((r, i) => (
              <Line key={r.group} type="monotone" dataKey={r.group} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <CapNote shown={TIMELINE_CAP} total={rows.length} />
    </div>
  )
}
