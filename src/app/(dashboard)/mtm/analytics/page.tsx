"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { PageDescription } from "@/components/page-description"
import { ColorStatCard } from "@/components/color-stat-card"
import { KpiCard } from "@/components/mtm/kpi-card"
import { Button } from "@/components/ui/button"
import { HelpButton } from "@/components/help/help-button"
import { ExplainableKpiDashboard } from "@/components/mtm/explainable-kpi-dashboard"
import {
  BarChart3, MapPin, CheckCircle2, Camera, TrendingUp,
  ChevronDown, Clock, Route, Target, Download,
} from "lucide-react"

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
const monthKeys = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const

export default function MtmAnalyticsPage() {
  const { data: session } = useSession()
  const t = useTranslations("nav")
  const ta = useTranslations("mtmAnalytics")
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [period, setPeriod] = useState<"weekly" | "monthly" | "yearly">("monthly")
  const [exporting, setExporting] = useState(false)
  const orgId = session?.user?.organizationId

  const fetchAnalytics = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/mtm/analytics?period=${period}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>),
        signal,
      })
      const r = await res.json()
      if (!res.ok || !r.success) {
        toast.error(`Failed to load analytics: ${r.error || "Unknown error"}`)
      } else {
        setData(r.data)
      }
    } catch (e) {
      if (signal.aborted) return
      toast.error(`Failed to load analytics: ${e instanceof Error ? e.message : "Network error"}`)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [orgId, period])

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch(`/api/v1/mtm/analytics/export?period=${period}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>),
      })
      if (!res.ok) {
        toast.error(ta("exportFailed"))
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `mtm-analytics-${period}-${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(ta("exportFailed"))
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    if (!legacyOpen) return
    const controller = new AbortController()
    void fetchAnalytics(controller.signal)
    return () => controller.abort()
  }, [fetchAnalytics, legacyOpen])

  const kpi = data?.kpi || { totalVisits: 0, totalTasks: 0, totalPhotos: 0, completionRate: 0 }
  const marsKpi = data?.marsKpi || {
    visitPlanFulfillment: 0,
    avgTimeOnRoute: 0,
    avgTimeInStore: 0,
  }
  const monthlyTrend   = data?.monthlyTrend   || []
  const weeklyComparison = data?.weeklyComparison || []
  const topAgents      = data?.topAgents      || []
  const agentKpis      = data?.agentKpis      || []

  const maxTrend  = Math.max(...monthlyTrend.map((m: any) => Math.max(m.visits, m.tasks)), 1)
  const maxWeekly = Math.max(...weeklyComparison.map((w: any) => Math.max(w.thisWeek, w.lastWeek)), 1)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PageDescription icon={BarChart3} title={ta("title")} description={ta("subtitle")} />
          <HelpButton slug="mtm-analytics" variant="label" />
        </div>
      </div>

      <ExplainableKpiDashboard orgId={orgId ? String(orgId) : undefined} />

      <details
        className="group overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-700"
        onToggle={(event) => setLegacyOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span role="heading" aria-level={2} className="block text-base font-semibold">{ta("legacyScopeTitle")}</span>
            <span className="mt-1 block max-w-[80ch] text-sm leading-6 text-muted-foreground">{ta("legacyScopeNote")}</span>
          </span>
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>

        <div className="space-y-4 border-t border-zinc-200 p-4 dark:border-zinc-700">
          <div className="flex flex-wrap gap-1">
            {(["weekly", "monthly", "yearly"] as const).map(p => (
              <Button key={p} variant={period === p ? "default" : "outline"} size="sm" onClick={() => setPeriod(p)}>
                {ta(`period.${p}`)}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              <Download className="mr-1 h-3.5 w-3.5" />
              {exporting ? ta("exporting") : ta("exportExcel")}
            </Button>
          </div>

          {loading ? (
            <div className="animate-pulse space-y-4 motion-reduce:animate-none" aria-busy="true">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-24 rounded-lg bg-muted" />)}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-28 rounded-lg bg-muted" />)}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="h-64 rounded-lg bg-muted" />
                <div className="h-64 rounded-lg bg-muted" />
              </div>
            </div>
          ) : (
            <>

      {/* Standard KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
        <ColorStatCard label={ta("kpiTotalVisits")}     value={kpi.totalVisits}     icon={<MapPin className="h-4 w-4" />}        />
        <ColorStatCard label={ta("kpiCompletedTasks")}  value={kpi.totalTasks}      icon={<CheckCircle2 className="h-4 w-4" />}  />
        <ColorStatCard label={ta("kpiPhotosUploaded")}  value={kpi.totalPhotos}     icon={<Camera className="h-4 w-4" />}        />
        <ColorStatCard label={ta("kpiCompletionRate")}  value={`${kpi.completionRate}%`} icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      {/* Mars KPI row */}
      <div>
        <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
          {ta("marsKpiTitle")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiCard
            label={ta("marsKpiVisitPlan")}
            value={marsKpi.visitPlanFulfillment}
            unit="%"
            target={100}
            icon={<Target className="h-3.5 w-3.5" />}

          />
          <KpiCard
            label={ta("marsKpiRouteTime")}
            value={marsKpi.avgTimeOnRoute}
            unit={ta("unitMin")}
            icon={<Route className="h-3.5 w-3.5" />}
           
            description={ta("marsKpiRouteTimeDesc")}
          />
          <KpiCard
            label={ta("marsKpiStoreTime")}
            value={marsKpi.avgTimeInStore}
            unit={ta("unitMin")}
            icon={<Clock className="h-3.5 w-3.5" />}
           
            description={ta("marsKpiStoreTimeDesc")}
          />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Yearly / Monthly Trend Chart */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" /> {ta("trend")}
          </h3>
          {monthlyTrend.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              {ta("noDataForPeriod")}
            </div>
          ) : (
            <div className="space-y-2">
              {monthlyTrend.map((m: any) => {
                const label = m.month.split("-")[1]
                const monthIdx = parseInt(label) - 1
                const monthKey = monthKeys[monthIdx]
                return (
                  <div key={m.month} className="flex items-center gap-2 text-xs">
                    <span className="w-8 text-muted-foreground">
                      {monthKey ? ta(`month.${monthKey}`) : label}
                    </span>
                    <div className="flex-1 flex gap-1">
                      <div className="h-4 rounded bg-teal-500/80"   style={{ width: `${(m.tasks  / maxTrend) * 100}%` }} />
                      <div className="h-4 rounded bg-green-500/80"  style={{ width: `${(m.visits / maxTrend) * 100}%` }} />
                    </div>
                    <span className="w-16 text-right text-muted-foreground">{m.tasks}t / {m.visits}v</span>
                  </div>
                )
              })}
              <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-teal-500/80"  /> {ta("tasks")}</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-green-500/80" /> {ta("visits")}</span>
              </div>
            </div>
          )}
        </div>

        {/* Weekly Comparison Chart */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
          <h3 className="font-semibold text-sm mb-4">{ta("weeklyComparison")}</h3>
          {weeklyComparison.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{ta("noData")}</div>
          ) : (
            <div className="space-y-2">
              {weeklyComparison.map((w: any) => (
                <div key={w.day} className="flex items-center gap-2 text-xs">
                  <span className="w-8 text-muted-foreground">{ta(`weekday.${dayKeys[w.day]}`)}</span>
                  <div className="flex-1 flex flex-col gap-0.5">
                    <div className="h-3 rounded bg-primary/80"         style={{ width: `${(w.thisWeek / maxWeekly) * 100}%` }} />
                    <div className="h-3 rounded bg-muted-foreground/30" style={{ width: `${(w.lastWeek / maxWeekly) * 100}%` }} />
                  </div>
                  <span className="w-12 text-right text-muted-foreground">{w.thisWeek}/{w.lastWeek}</span>
                </div>
              ))}
              <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-primary/80"         /> {ta("thisWeek")}</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-muted-foreground/30" /> {ta("lastWeek")}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Agent KPI breakdown table (drill-down) */}
      {agentKpis.length > 0 && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
          <h3 className="font-semibold text-sm mb-3">{ta("agentBreakdown")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-3 font-medium">{ta("agentName")}</th>
                  <th className="text-right py-2 px-2 font-medium">{ta("agentTotalVisits")}</th>
                  <th className="text-right py-2 px-2 font-medium">{ta("agentPlanFulfill")}</th>
                  <th className="text-right py-2 px-2 font-medium">{ta("agentAvgStoreTime")}</th>
                </tr>
              </thead>
              <tbody>
                {agentKpis.map((agent: any) => {
                  const planColor =
                    agent.visitPlanFulfillment >= 90 ? "text-green-600" :
                    agent.visitPlanFulfillment >= 70 ? "text-amber-600" :
                    "text-red-600"
                  return (
                    <tr key={agent.agentId} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-3 font-medium">{agent.name}</td>
                      <td className="text-right py-2 px-2">{agent.totalVisits}</td>
                      <td className={`text-right py-2 px-2 font-semibold ${planColor}`}>
                        {agent.visitPlanFulfillment}%
                      </td>
                      <td className="text-right py-2 px-2">{agent.avgTimeInStore} {ta("unitMin")}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Agents (existing block) */}
      {topAgents.length > 0 && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
          <h3 className="font-semibold text-sm mb-3">{ta("topAgentsByVisits")}</h3>
          <div className="space-y-2">
            {topAgents.map((agent: any, i: number) => (
              <div key={agent.agentId} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold">
                  {i + 1}
                </span>
                <span className="flex-1 text-sm font-medium">{agent.name}</span>
                <span className="text-sm text-muted-foreground">{ta("visitsCount", { n: agent.visits })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
            </>
          )}
        </div>
      </details>
    </div>
  )
}
