"use client"

/**
 * Board Reports — Phase A (Tier-1 essentials). A "Reports" tab inside a Kanban
 * board: period + assignee/type filters, KPI cards, and 6 current-state charts,
 * fed by GET /api/v1/divisions/[id]/analytics. Reuses the app's KpiCard +
 * mini-charts (no new chart lib). Caption discipline (architect): "closed this
 * week" is by completion DATE (in range); it is distinct from a task's done
 * STATUS — the two can legitimately differ, so we never show a raw done-total
 * KPI next to throughput where it would read as a contradiction.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Layers, CheckCircle2, AlertTriangle, Clock, Loader2, BarChart3, TrendingUp, Users, PieChart, GitCompareArrows, Activity, Timer, Hourglass, AreaChart, RotateCcw, Wallet, LineChart, Target, Dices, Presentation } from "lucide-react"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { MiniBarChart, MiniDonut } from "@/components/charts/mini-charts"
import type { Tier1Analytics, ValueRollup, Burnup, MonteCarlo } from "@/lib/tasks/board-analytics"
import type { FlowMetrics, Cfd, CfdPoint, ReopenedStats, SlaStats } from "@/lib/tasks/board-flow"

type SlaData = SlaStats & { isBoardDefault: boolean }
type ReportData = Tier1Analytics & { valueRollup?: ValueRollup; burnup?: Burnup; monteCarlo?: MonteCarlo; flow?: FlowMetrics; cfd?: Cfd; reopened?: ReopenedStats; sla?: SlaData }

interface Assignee { id: string; name: string }

const RANGES = ["7d", "30d", "90d"] as const
const REPORT_TYPES = ["bug", "feature", "story", "epic", "task"] as const
const STAGES = ["backlog", "todo", "in_progress", "testing", "review", "done"] as const
const CFD_STAGES = ["unknown", ...STAGES] as const

const STAGE_COLOR: Record<string, string> = {
  unknown: "#E5E7EB",
  backlog: "#C1C7D0", todo: "#94A3B8", in_progress: "#EA580C",
  testing: "#6554C0", review: "#00B8D9", done: "#00875A",
}
const TYPE_COLOR: Record<string, string> = {
  bug: "#DE350B", feature: "#00B8D9", story: "#00875A", epic: "#6554C0", task: "#EA580C",
}

// ── small inline chart primitives (shared-scale, correct) ──
function HBars({ items, empty }: { items: { label: string; value: number; color: string }[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.every((i) => i.value === 0)) return <Empty text={empty} />
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate text-muted-foreground" title={it.label}>{it.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
            <div className="h-full rounded" style={{ width: `${(it.value / max) * 100}%`, background: it.color }} />
          </div>
          <span className="w-7 shrink-0 text-right font-medium tabular-nums">{it.value}</span>
        </div>
      ))}
    </div>
  )
}

function DualLine({ weeks, createdLabel, resolvedLabel }: {
  weeks: { weekStart: string; created: number; resolved: number }[]
  createdLabel: string
  resolvedLabel: string
}) {
  if (weeks.length < 2) return <Empty text="—" />
  const max = Math.max(1, ...weeks.flatMap((w) => [w.created, w.resolved]))
  const line = (key: "created" | "resolved") =>
    weeks.map((w, i) => `${(i / (weeks.length - 1)) * 100},${100 - (w[key] / max) * 100}`).join(" ")
  return (
    <div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-24 w-full">
        <polyline points={line("created")} fill="none" stroke="#0EA5E9" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <polyline points={line("resolved")} fill="none" stroke="#00875A" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
        <Legend color="#0EA5E9" label={createdLabel} />
        <Legend color="#00875A" label={resolvedLabel} />
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
    </span>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">{text}</div>
}

function ReportCard({ title, sub, icon, children }: { title: string; sub?: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <div>
          <h3 className="text-sm font-semibold leading-none">{title}</h3>
          {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

export function BoardReports({ divisionId, assignees, onOpenTask, reloadKey, canEditSla, sectionsParam }: { divisionId: string; assignees: Assignee[]; onOpenTask?: (id: string) => void; reloadKey?: number; canEditSla?: boolean; sectionsParam?: string }) {
  const t = useTranslations("boardReports")
  const [range, setRange] = useState<string>("30d")
  const [assignee, setAssignee] = useState("")
  const [type, setType] = useState("")
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const q = new URLSearchParams({ range, flow: "1" })
      if (assignee) q.set("assignee", assignee)
      if (type) q.set("type", type)
      // Department Reports: narrow the aggregate to the selected sections (empty =
      // all visible sections). Ignored by the endpoint for a normal board.
      if (sectionsParam) q.set("sections", sectionsParam)
      const res = await fetch(`/api/v1/divisions/${divisionId}/analytics?${q.toString()}`, { credentials: "include" })
      if (res.ok) setData((await res.json()).data)
      else setError(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [divisionId, range, assignee, type, sectionsParam])
  useEffect(() => { load() }, [load, reloadKey])

  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30
  const rangeSub = t("inRange", { days })

  const selectCls = "rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none"

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Top bar: period + filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-input">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-xs font-medium ${range === r ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
            >
              {t(`range_${r}`)}
            </button>
          ))}
        </div>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls}>
          <option value="">{t("allAssignees")}</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>
          <option value="">{t("allTypes")}</option>
          {REPORT_TYPES.map((ty) => <option key={ty} value={ty}>{t(`type_${ty}`)}</option>)}
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <button
          onClick={() => {
            const q = new URLSearchParams({ range })
            if (assignee) q.set("assignee", assignee)
            if (type) q.set("type", type)
            if (sectionsParam) q.set("sections", sectionsParam)
            window.open(`/api/v1/divisions/${divisionId}/analytics/pptx?${q.toString()}`, "_blank")
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          title={t("exportPptx")}
        >
          <Presentation className="h-3.5 w-3.5" /> {t("exportPptx")}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">{t("loadError")}</div>
      ) : !data ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}</div>
      ) : (
        <>
          {/* KPI row */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard title={t("kpiWip")} value={data.totals.wip} sub={t("kpiWipSub")} icon={<Layers className="h-5 w-5" />} />
            <KpiCard title={t("kpiClosed")} value={data.totals.throughputThisWeek} sub={t("kpiClosedSub")} icon={<CheckCircle2 className="h-5 w-5" />} />
            <KpiCard title={t("kpiOverdue")} value={data.totals.overdue} sub={t("kpiOverdueSub")} icon={<AlertTriangle className="h-5 w-5" />} />
            <KpiCard title={t("kpiDueSoon")} value={data.totals.dueSoon} sub={t("kpiDueSoonSub")} icon={<Clock className="h-5 w-5" />} />
          </div>

          {/* Report grid */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ReportCard title={t("wipTitle")} sub={t("wipSub")} icon={<BarChart3 className="h-4 w-4" />}>
              <HBars
                empty={t("noOpen")}
                items={data.wip.map((w) => ({ label: w.label, value: w.count, color: w.color || STAGE_COLOR[w.mapsToStatus] || "#94A3B8" }))}
              />
            </ReportCard>

            <ReportCard title={t("throughputTitle")} sub={`${rangeSub} · ${t("byCompletedDate")}`} icon={<TrendingUp className="h-4 w-4" />}>
              {data.throughput.some((w) => w.count > 0) ? (
                <>
                  <MiniBarChart data={data.throughput.map((w) => w.count)} color="bg-emerald-500" height="h-24" />
                  <div className="mt-1 text-right text-[11px] text-muted-foreground">
                    {t("totalClosed", { n: data.throughput.reduce((s, w) => s + w.count, 0) })}
                  </div>
                </>
              ) : <Empty text={t("noClosed")} />}
            </ReportCard>

            <ReportCard title={t("createdResolvedTitle")} sub={rangeSub} icon={<GitCompareArrows className="h-4 w-4" />}>
              <DualLine weeks={data.createdVsResolved} createdLabel={t("created")} resolvedLabel={t("resolved")} />
            </ReportCard>

            <ReportCard title={t("assigneeThroughputTitle")} sub={`${rangeSub} · ${t("byCompletedDate")}`} icon={<Users className="h-4 w-4" />}>
              <HBars
                empty={t("noClosed")}
                items={data.assigneeThroughput.map((a) => ({ label: a.name ?? t("unassigned"), value: a.count, color: "#EA580C" }))}
              />
            </ReportCard>

            <ReportCard title={t("workloadTitle")} sub={t("workloadSub")} icon={<Users className="h-4 w-4" />}>
              {data.workload.length ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    <Legend color="#16A34A" label={t("workloadCompleted")} />
                    <Legend color="#F97316" label={t("workloadInProgress")} />
                    <Legend color="#DC2626" label={t("workloadNotStarted")} />
                    <Legend color="#991B1B" label={t("workloadOverdue")} />
                  </div>
                  <p className="text-[11px] leading-4 text-muted-foreground">{t("workloadOverlapNote")}</p>
                  {data.workload.map((w) => (
                    <div key={w.userId ?? "none"} className="rounded-lg border p-2 text-xs">
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium" title={w.name ?? t("unassigned")}>{w.name ?? t("unassigned")}</span>
                        <span className="font-semibold tabular-nums">{w.completionRate}%</span>
                        <span className="text-muted-foreground">{t("workloadDoneOf", { done: w.completed, total: w.total })}</span>
                      </div>
                      <div className="flex h-3 overflow-hidden rounded bg-muted">
                        {w.completed > 0 && <div title={`${t("workloadCompleted")}: ${w.completed}`} style={{ width: `${(w.completed / w.total) * 100}%`, background: "#16A34A" }} />}
                        {w.inProgress > 0 && <div title={`${t("workloadInProgress")}: ${w.inProgress}`} style={{ width: `${(w.inProgress / w.total) * 100}%`, background: "#F97316" }} />}
                        {w.notStarted > 0 && <div title={`${t("workloadNotStarted")}: ${w.notStarted}`} style={{ width: `${(w.notStarted / w.total) * 100}%`, background: "#DC2626" }} />}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{t("workloadNotCompleted")}: <b className="text-foreground">{w.open}</b></span>
                        <span>{t("workloadInProgress")}: <b className="text-orange-600">{w.inProgress}</b></span>
                        <span>{t("workloadNotStarted")}: <b className="text-red-600">{w.notStarted}</b></span>
                        <span>{t("workloadOverdue")}: <b className="text-red-800">{w.overdue}</b></span>
                        <span className="ml-auto">{w.hours ? `${w.hours}h` : "—"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <Empty text={t("noTasks")} />}
            </ReportCard>

            <ReportCard title={t("workMixTitle")} sub={t("workMixSub")} icon={<PieChart className="h-4 w-4" />}>
              {data.workMix.length ? (
                <div className="flex items-center gap-4">
                  <MiniDonut size={96} thickness={10} segments={data.workMix.map((m) => ({ value: m.count, color: TYPE_COLOR[m.type] || "#94A3B8" }))} />
                  <div className="space-y-1">
                    {data.workMix.map((m) => (
                      <div key={m.type} className="flex items-center gap-2 text-xs">
                        <Legend color={TYPE_COLOR[m.type] || "#94A3B8"} label={t(`type_${m.type}`)} />
                        <span className="ml-auto font-medium tabular-nums">{m.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <Empty text={t("noTasks")} />}
            </ReportCard>
          </div>

          {/* Overdue / due-soon lists */}
          {(data.due.overdue.length > 0 || data.due.dueSoon.length > 0) && (
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <DueList title={t("overdueTitle")} tasks={data.due.overdue} accent="text-red-600" unassigned={t("unassigned")} onOpenTask={onOpenTask} />
              <DueList title={t("dueSoonTitle")} tasks={data.due.dueSoon} accent="text-amber-600" unassigned={t("unassigned")} onOpenTask={onOpenTask} />
            </div>
          )}

          {/* Value/effort (#16) + Burnup (#15) + Monte-Carlo (#17) — current-state, always shown */}
          {(data.valueRollup || data.burnup || data.monteCarlo) && (
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {data.valueRollup && <ValueRollupCard rollup={data.valueRollup} />}
              {data.burnup && (
                <ReportCard title={t("burnupTitle")} sub={rangeSub} icon={<LineChart className="h-4 w-4" />}>
                  <BurnupChart burnup={data.burnup} />
                </ReportCard>
              )}
              {data.monteCarlo && (
                <ReportCard title={t("mcTitle")} sub={rangeSub} icon={<Dices className="h-4 w-4" />}>
                  <MonteCarloView mc={data.monteCarlo} />
                </ReportCard>
              )}
            </div>
          )}

          {/* ── Flow metrics (Tier 2) ── */}
          {data.flow && (
            <div className="mt-5">
              <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <Activity className="h-4 w-4" /> {t("flowSection")}
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {data.cfd && (
                  <div className="lg:col-span-2">
                    <ReportCard
                      title={t("cfdTitle")}
                      sub={t("cfdCoverageNote", { n: data.cfd.coveredOf, m: data.cfd.total, u: Math.max(0, data.cfd.total - data.cfd.coveredOf) })}
                      icon={<AreaChart className="h-4 w-4" />}
                    >
                      <CfdChart cfd={data.cfd} />
                    </ReportCard>
                  </div>
                )}

                <ReportCard
                  title={t("cycleTitle")}
                  sub={t("coverageNote", { n: data.flow.cycleTime.count, m: data.flow.cycleTime.coveredOf })}
                  icon={<Timer className="h-4 w-4" />}
                >
                  <DurationChart stats={data.flow.cycleTime} color="bg-sky-500" />
                </ReportCard>

                <ReportCard title={t("leadTitle")} sub={t("leadSub")} icon={<Hourglass className="h-4 w-4" />}>
                  <DurationChart stats={data.flow.leadTime} color="bg-violet-500" />
                </ReportCard>

                <ReportCard
                  title={t("timeInStatusTitle")}
                  sub={t("coverageNote", { n: data.flow.timeInStatus.coveredOf, m: data.flow.timeInStatus.total })}
                  icon={<BarChart3 className="h-4 w-4" />}
                >
                  {data.flow.timeInStatus.stages.some((s) => s.count > 0) ? (
                    <HBars
                      empty={t("noFlowData")}
                      items={data.flow.timeInStatus.stages
                        .filter((s) => s.count > 0)
                        .map((s) => ({ label: t(`stage_${s.stage}`), value: s.avgDays, color: STAGE_COLOR[s.stage] ?? "#94A3B8" }))}
                    />
                  ) : (
                    <Empty text={t("noFlowData")} />
                  )}
                </ReportCard>

                <ReportCard
                  title={t("agingTitle")}
                  sub={data.flow.aging.p85CycleDays > 0 ? t("agingSub", { d: data.flow.aging.p85CycleDays }) : t("needsBaseline")}
                  icon={<AlertTriangle className="h-4 w-4" />}
                >
                  <AgingList tasks={data.flow.aging.tasks} onOpenTask={onOpenTask} />
                </ReportCard>

                {data.reopened && (
                  <ReportCard
                    title={t("reopenedTitle")}
                    sub={t("coverageNote", { n: data.reopened.coveredOf, m: data.reopened.total })}
                    icon={<RotateCcw className="h-4 w-4" />}
                  >
                    <ReopenedView stats={data.reopened} onOpenTask={onOpenTask} />
                  </ReportCard>
                )}

                {data.sla && (
                  <ReportCard
                    title={t("slaTitle")}
                    sub={t("coverageNote", { n: data.sla.measuredCount, m: data.sla.coveredOf })}
                    icon={<Target className="h-4 w-4" />}
                  >
                    <SlaView sla={data.sla} divisionId={divisionId} canEdit={canEditSla} onSaved={load} />
                  </ReportCard>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DueList({ title, tasks, accent, unassigned, onOpenTask }: {
  title: string
  tasks: Tier1Analytics["due"]["overdue"]
  accent: string
  unassigned: string
  onOpenTask?: (id: string) => void
}) {
  if (!tasks.length) return null
  return (
    <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <h3 className={`mb-2 text-sm font-semibold ${accent}`}>{title} · {tasks.length}</h3>
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {tasks.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpenTask?.(t.id)}
            className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
          >
            {t.taskKey && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{t.taskKey}</span>}
            <span className="truncate" title={t.title}>{t.title}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : ""}
            </span>
            <span className="w-20 shrink-0 truncate text-right text-[11px] text-muted-foreground">{t.assigneeName ?? unassigned}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Cycle/lead time: median/p85/p95 + a day-bucket histogram. Empty when no task
// has the history the metric needs (the card sub already shows the coverage).
function DurationChart({ stats, color }: { stats: FlowMetrics["cycleTime"]; color: string }) {
  const t = useTranslations("boardReports")
  if (!stats.count) return <Empty text={t("noFlowData")} />
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs">
        <span><span className="font-semibold tabular-nums">{stats.medianDays}{t("dayShort")}</span> <span className="text-muted-foreground">{t("median")}</span></span>
        <span><span className="font-semibold tabular-nums">{stats.p85Days}{t("dayShort")}</span> <span className="text-muted-foreground">p85</span></span>
        <span><span className="font-semibold tabular-nums">{stats.p95Days}{t("dayShort")}</span> <span className="text-muted-foreground">p95</span></span>
      </div>
      <MiniBarChart data={stats.histogram.map((h) => h.count)} color={color} height="h-16" />
      {/* labels mirror MiniBarChart's flex-1 bars so each sits under its bar */}
      <div className="mt-0.5 flex text-[8px] text-muted-foreground">
        {stats.histogram.map((h) => <span key={h.label} className="flex-1 text-center">{h.label}</span>)}
      </div>
    </div>
  )
}

// Cumulative Flow Diagram (Tier-2 #11): daily per-stage counts as stacked bands.
// Historical tasks without a recorded status timeline remain in the explicit
// "unknown history" band; the final point is the exact current board snapshot.
function CfdChart({ cfd }: { cfd: Cfd }) {
  const t = useTranslations("boardReports")
  if (!cfd.total || cfd.points.length === 0) return <Empty text={t("noFlowData")} />
  const W = 300
  const H = 96
  const pts = cfd.points
  const n = pts.length
  const sv = (p: CfdPoint, s: (typeof CFD_STAGES)[number]) => p[s]
  const maxY = Math.max(1, ...pts.map((p) => CFD_STAGES.reduce((a, s) => a + sv(p, s), 0)))
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number) => H - (v / maxY) * H
  // cum[i][k] = sum of the first k canonical stages at point i (stacked boundaries)
  const cum = pts.map((p) => {
    const arr = [0]
    let acc = 0
    for (const s of CFD_STAGES) {
      acc += sv(p, s)
      arr.push(acc)
    }
    return arr
  })
  const present = CFD_STAGES.filter((s) => pts.some((p) => sv(p, s) > 0))
  const current = pts[n - 1]
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-foreground">{t("cfdCurrentSnapshot", { n: cfd.total })}</span>
        {STAGES.map((stage) => (
          <span key={stage} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_COLOR[stage] }} />
            {t(`stage_${stage}`)}: <b className="text-foreground">{current[stage]}</b>
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full rounded" role="img" aria-label={t("cfdTitle")}>
        {CFD_STAGES.map((stage, k) => {
          if (!pts.some((p) => sv(p, stage) > 0)) return null // skip empty band (degenerate polygon)
          const top = pts.map((_, i) => `${x(i)},${y(cum[i][k + 1])}`).join(" ")
          const bottom = pts.map((_, i) => `${x(i)},${y(cum[i][k])}`).reverse().join(" ")
          return <polygon key={stage} points={`${top} ${bottom}`} fill={STAGE_COLOR[stage]} fillOpacity={0.92} />
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[9px] tabular-nums text-muted-foreground">
        <span>{new Date(pts[0].date).toLocaleDateString()}</span>
        <span>{new Date(pts[n - 1].date).toLocaleDateString()}</span>
      </div>
      {present.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {present.map((s) => <Legend key={s} color={STAGE_COLOR[s]} label={t(`stage_${s}`)} />)}
        </div>
      )}
    </div>
  )
}

// Open tasks by age (oldest first), with at-risk badge + a ≈ marker when the age
// was estimated from createdAt (no status-entry event recorded).
function AgingList({ tasks, onOpenTask }: { tasks: FlowMetrics["aging"]["tasks"]; onOpenTask?: (id: string) => void }) {
  const t = useTranslations("boardReports")
  if (!tasks.length) return <Empty text={t("noOpen")} />
  return (
    <div className="max-h-56 space-y-1 overflow-y-auto">
      {tasks.slice(0, 15).map((task) => (
        <button
          key={task.id}
          type="button"
          onClick={() => onOpenTask?.(task.id)}
          className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
        >
          {task.taskKey && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{task.taskKey}</span>}
          <span className="truncate" title={task.title}>{task.title}</span>
          {task.ageFromFallback && <span title={t("ageFromFallbackHint")} className="shrink-0 text-amber-500">≈</span>}
          <span className="ml-auto shrink-0 font-medium tabular-nums">{task.ageDays}{t("dayShort")}</span>
          {task.atRisk && <span className="shrink-0 rounded bg-red-100 px-1 text-[10px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400">{t("atRisk")}</span>}
        </button>
      ))}
    </div>
  )
}

// Reopened / rework (Tier-3 #13): a rework-rate KPI + the tasks that bounced back
// from done most often (clickable, like the other lists). Counts done→non-done
// transitions, so it needs status history — the card sub shows the covered fraction.
function ReopenedView({ stats, onOpenTask }: { stats: ReopenedStats; onOpenTask?: (id: string) => void }) {
  const t = useTranslations("boardReports")
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">{stats.reworkRatePct}%</span>
        <span className="text-xs text-muted-foreground">{t("reworkSub", { reopened: stats.reopenedTasks, completed: stats.completedCount })}</span>
      </div>
      {stats.topReopened.length ? (
        <div className="max-h-44 space-y-1 overflow-y-auto">
          {stats.topReopened.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpenTask?.(task.id)}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
            >
              {task.taskKey && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{task.taskKey}</span>}
              <span className="truncate" title={task.title}>{task.title}</span>
              <span className="ml-auto shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">{t("reopenCount", { n: task.count })}</span>
            </button>
          ))}
        </div>
      ) : (
        <Empty text={t("noReopens")} />
      )}
    </div>
  )
}

// SLA achievement (Tier-3 #14): % of measurable-cycle completed tasks that met the
// per-board cycle-time target. Coloured by health; the target line notes whether
// it's the board's own value or the global default. Slice 2: admins get an inline
// target editor (PATCHes Division.slaTargetDays, then reloads) — shown even with no
// data so the target can be configured before completions accrue. Non-admins: the
// server PATCH gate is the real guard; canEdit just hides the widget.
function SlaView({ sla, divisionId, canEdit, onSaved }: { sla: SlaData; divisionId: string; canEdit?: boolean; onSaved?: () => void }) {
  const t = useTranslations("boardReports")
  const [draft, setDraft] = useState(String(sla.targetDays))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => { setDraft(String(sla.targetDays)) }, [sla.targetDays])

  const save = async (value: number | null) => {
    setSaving(true)
    setError(false)
    try {
      const res = await fetch(`/api/v1/divisions/${divisionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ slaTargetDays: value }),
      })
      if (res.ok) onSaved?.()
      else setError(true) // surface 400/403/500 instead of silently re-enabling
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const color = sla.pct >= 80 ? "text-emerald-600" : sla.pct >= 50 ? "text-amber-600" : "text-red-600"
  const barColor = sla.pct >= 80 ? "bg-emerald-500" : sla.pct >= 50 ? "bg-amber-500" : "bg-red-500"
  const n = Number(draft)
  const invalid = !draft || !Number.isInteger(n) || n < 1 || n > 365
  return (
    <div>
      {sla.measuredCount ? (
        <>
          <div className="mb-2 flex items-baseline gap-2">
            <span className={`text-2xl font-bold tabular-nums ${color}`}>{sla.pct}%</span>
            <span className="text-xs text-muted-foreground">{t("slaMet", { met: sla.metCount, measured: sla.measuredCount })}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, sla.pct)}%` }} />
          </div>
        </>
      ) : (
        <Empty text={t("noFlowData")} />
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("slaTarget", { d: sla.targetDays })}{sla.isBoardDefault ? ` · ${t("slaDefault")}` : ""}
      </p>
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={365}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            aria-label={t("slaTitle")}
            className="w-16 rounded border border-input bg-background px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-[11px] text-muted-foreground">{t("slaDaysUnit")}</span>
          <button
            type="button"
            onClick={() => save(n)}
            disabled={saving || invalid || n === sla.targetDays}
            className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {t("slaSave")}
          </button>
          {!sla.isBoardDefault && (
            <button
              type="button"
              onClick={() => save(null)}
              disabled={saving}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            >
              {t("slaReset")}
            </button>
          )}
          {error && <span role="alert" className="text-[11px] text-red-600">{t("slaSaveError")}</span>}
        </div>
      )}
    </div>
  )
}

// Burnup (Tier-3 #15): two cumulative lines — scope (tasks created as-of day) over
// done (completed as-of day). The shaded gap between them is remaining work; when
// the done line meets scope, the board is clear. Pure current-state, always exact.
function BurnupChart({ burnup }: { burnup: Burnup }) {
  const t = useTranslations("boardReports")
  const pts = burnup.points
  if (!pts.length || burnup.total === 0) return <Empty text={t("noTasks")} />
  const W = 300
  const H = 96
  const n = pts.length
  const maxY = Math.max(1, ...pts.map((p) => p.scope)) // scope ≥ done ⇒ scope is the ceiling
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number) => H - (v / maxY) * H
  const scopePts = pts.map((p, i) => `${x(i)},${y(p.scope)}`)
  const donePts = pts.map((p, i) => `${x(i)},${y(p.done)}`)
  const scopeLine = scopePts.join(" ")
  const doneLine = donePts.join(" ")
  const gap = `${scopePts.join(" ")} ${[...donePts].reverse().join(" ")}` // scope edge then done edge reversed
  const last = pts[n - 1]
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs">
        <span><span className="font-semibold tabular-nums">{last.scope}</span> <span className="text-muted-foreground">{t("burnupScope")}</span></span>
        <span><span className="font-semibold tabular-nums">{last.done}</span> <span className="text-muted-foreground">{t("burnupDone")}</span></span>
        <span><span className="font-semibold tabular-nums">{last.scope - last.done}</span> <span className="text-muted-foreground">{t("burnupRemaining")}</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label={t("burnupTitle")}>
        <polygon points={gap} fill="#94A3B8" fillOpacity={0.12} />
        <polyline points={scopeLine} fill="none" stroke="#64748B" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <polyline points={doneLine} fill="none" stroke="#00875A" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[9px] tabular-nums text-muted-foreground">
        <span>{new Date(pts[0].date).toLocaleDateString()}</span>
        <span>{new Date(last.date).toLocaleDateString()}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <Legend color="#64748B" label={t("burnupScope")} />
        <Legend color="#00875A" label={t("burnupDone")} />
      </div>
    </div>
  )
}

// Monte-Carlo forecast (Tier-3 #17): a confidence ladder — by which date the open
// tasks are p50/p70/p85/p95 likely to be finished, simulated from throughput. Honest
// empty state when there's too little throughput history to forecast.
function MonteCarloView({ mc }: { mc: MonteCarlo }) {
  const t = useTranslations("boardReports")
  if (!mc.sufficient) return <Empty text={t("mcInsufficient")} />
  // even the median hit the 10y horizon ⇒ backlog too big for the throughput to date it
  if (mc.forecast[0]?.capped) return <Empty text={t("mcTooSlow")} />
  return (
    <div>
      <div className="mb-2 text-[11px] text-muted-foreground">{t("mcSub", { remaining: mc.remaining, done: mc.throughputTotal, days: mc.throughputDays })}</div>
      <div className="space-y-1.5">
        {mc.forecast.map((f) => (
          <div key={f.p} className="flex items-center gap-2 text-xs">
            <span className="w-9 shrink-0 font-semibold tabular-nums">{f.p}%</span>
            <span className="text-muted-foreground">→</span>
            {f.capped ? (
              // lower bound only — never a fabricated date
              <span className="ml-auto text-muted-foreground tabular-nums">≥ {f.days}{t("dayShort")}</span>
            ) : (
              <>
                <span className="font-medium tabular-nums">{new Date(f.date).toLocaleDateString()}</span>
                <span className="ml-auto text-muted-foreground tabular-nums">{f.days}{t("dayShort")}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Pipeline value / effort (Tier-3 #16): SUM(estimatedPrice) + SUM(estimatedHours)
// of open tasks, grouped by board lane. Bars scale to value (or hours when nothing
// is priced); the sub discloses how many open tasks actually carry an estimate.
function ValueRollupCard({ rollup }: { rollup: ValueRollup }) {
  const t = useTranslations("boardReports")
  const lanes = rollup.byLane.filter((l) => l.count > 0)
  const noData = rollup.openCount === 0 || (rollup.withValue === 0 && rollup.withHours === 0)
  const hasValue = rollup.totalValue > 0
  const fmt = (n: number) => new Intl.NumberFormat().format(Math.round(n))
  const maxMetric = Math.max(1, ...lanes.map((l) => (hasValue ? l.value : l.hours)))
  return (
    <ReportCard
      title={t("valueTitle")}
      sub={t("valueCoverage", { priced: rollup.withValue, timed: rollup.withHours, open: rollup.openCount })}
      icon={<Wallet className="h-4 w-4" />}
    >
      {noData ? (
        <Empty text={t("noValue")} />
      ) : (
        <div>
          <div className="mb-3 flex gap-4">
            {rollup.withValue > 0 && <span><span className="text-lg font-bold tabular-nums">{fmt(rollup.totalValue)}</span> <span className="text-xs text-muted-foreground">{t("valueLabel")}</span></span>}
            {rollup.withHours > 0 && <span><span className="text-lg font-bold tabular-nums">{rollup.totalHours}{t("hourShort")}</span> <span className="text-xs text-muted-foreground">{t("effortLabel")}</span></span>}
          </div>
          <div className="space-y-1.5">
            {lanes.map((l) => (
              <div key={l.key} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate" title={l.label}>{l.label}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                  <div className="h-full" style={{ width: `${((hasValue ? l.value : l.hours) / maxMetric) * 100}%`, background: l.color || STAGE_COLOR[l.mapsToStatus] || "#94A3B8" }} />
                </div>
                {/* show only the estimate columns that actually have data (noData guard ⇒ ≥1 shows) */}
                {rollup.withValue > 0 && <span className="w-20 shrink-0 text-right font-medium tabular-nums">{fmt(l.value)}</span>}
                {rollup.withHours > 0 && <span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">{l.hours}{t("hourShort")}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </ReportCard>
  )
}
