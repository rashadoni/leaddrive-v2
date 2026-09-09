/**
 * Maps a board/department report bundle (loadBoardReportBundle → board-analytics)
 * into the branded ReportPptxModel consumed by buildReportPptx. Pure + defensive:
 * every section is optional, so a sparse board still produces a clean deck.
 */
import type { ReportPptxModel, ReportPptxBranding, ReportPptxChart, ReportPptxKpi, ReportPptxTable } from "./report-pptx"
import type { Tier1Analytics, ValueRollup } from "@/lib/tasks/board-analytics"

type BoardBundle = Partial<Tier1Analytics> & {
  valueRollup?: ValueRollup
  sla?: { pct: number; targetDays: number; metCount: number; measuredCount: number; isBoardDefault?: boolean }
}

const num = (n: number | null | undefined) => (typeof n === "number" && isFinite(n) ? n : 0)
const shortDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—")
// ISO week-start (YYYY-MM-DD) → "MMM D"-ish compact label (just MM-DD to stay TZ-free).
const weekLabel = (iso: string) => (iso.length >= 10 ? iso.slice(5, 10) : iso)

export function boardBundleToPptxModel(
  bundle: BoardBundle,
  meta: { name: string; key: string; isDepartment: boolean },
  branding: ReportPptxBranding,
  generatedAt: string,
  rangeLabel: string,
): ReportPptxModel {
  const t = bundle.totals
  const kpis: ReportPptxKpi[] = t
    ? [
        { label: "Total tasks", value: String(num(t.totalTasks)) },
        { label: "In progress", value: String(num(t.wip)) },
        { label: "Done", value: String(num(t.done)) },
        { label: "Done this week", value: String(num(t.throughputThisWeek)) },
        { label: "Overdue", value: String(num(t.overdue)) },
        { label: "Due soon", value: String(num(t.dueSoon)) },
      ]
    : []

  const charts: ReportPptxChart[] = []

  if (bundle.wip?.length) {
    charts.push({
      title: "Work in progress by stage",
      type: "bar",
      series: [{ name: "Tasks", labels: bundle.wip.map((w) => w.label), values: bundle.wip.map((w) => num(w.count)) }],
    })
  }
  if (bundle.throughput?.length) {
    charts.push({
      title: "Throughput by week (completed)",
      type: "line",
      series: [{ name: "Done", labels: bundle.throughput.map((p) => weekLabel(p.weekStart)), values: bundle.throughput.map((p) => num(p.count)) }],
    })
  }
  if (bundle.createdVsResolved?.length) {
    const labels = bundle.createdVsResolved.map((p) => weekLabel(p.weekStart))
    charts.push({
      title: "Created vs resolved",
      type: "line",
      series: [
        { name: "Created", labels, values: bundle.createdVsResolved.map((p) => num(p.created)) },
        { name: "Resolved", labels, values: bundle.createdVsResolved.map((p) => num(p.resolved)) },
      ],
    })
  }
  if (bundle.workMix?.length) {
    charts.push({
      title: "Work mix by type",
      type: "doughnut",
      series: [{ name: "Type", labels: bundle.workMix.map((w) => w.type), values: bundle.workMix.map((w) => num(w.count)) }],
    })
  }
  if (bundle.assigneeThroughput?.length) {
    const top = bundle.assigneeThroughput.slice(0, 10)
    charts.push({
      title: "Throughput by assignee",
      type: "bar",
      series: [{ name: "Done", labels: top.map((a) => a.name || "—"), values: top.map((a) => num(a.count)) }],
    })
  }
  if (bundle.valueRollup && num(bundle.valueRollup.totalValue) > 0) {
    const byLane = bundle.valueRollup.byLane ?? []
    charts.push({
      title: "Pipeline value by stage",
      type: "bar",
      series: [{ name: "Value", labels: byLane.map((l) => l.label), values: byLane.map((l) => num(l.value)) }],
    })
  }

  const tables: ReportPptxTable[] = []
  if (bundle.workload?.length) {
    tables.push({
      title: "Workload by assignee",
      columns: ["Assignee", "WIP", "Hours"],
      rows: bundle.workload.map((w) => [w.name || "—", num(w.total), num(w.hours)]),
    })
  }
  if (bundle.due?.overdue?.length) {
    tables.push({
      title: "Overdue tasks",
      columns: ["Key", "Title", "Assignee", "Due"],
      rows: bundle.due.overdue.map((r) => [r.taskKey || "—", r.title, r.assigneeName || "—", shortDate(r.dueDate)]),
    })
  }

  return {
    title: `${meta.name} — ${meta.isDepartment ? "Department report" : "Board report"}`,
    subtitle: rangeLabel,
    generatedAt,
    branding,
    kpis,
    charts,
    tables,
  }
}
