"use client"

import { useMemo } from "react"
import { useLocale } from "next-intl"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format-date"
import { MiniDonut } from "@/components/charts/mini-charts"
import {
  UserPlus, Flame, TrendingUp, CheckCircle2, XCircle,
  Target, Clock, Zap, BarChart3, ArrowUpRight, ArrowDownRight,
  Globe, Users, Phone, Mail, Linkedin, Sparkles,
} from "lucide-react"

// ── Types ───────────────────────────────────────────────────────────────

interface Lead {
  id: string
  contactName: string
  companyName: string | null
  email: string | null
  phone: string | null
  source: string | null
  status: string
  priority: string
  score: number
  scoreDetails: any
  estimatedValue: number | null
  createdAt: string
}

interface LeadsAnalyticsProps {
  leads: Lead[]
  labels: {
    totalLeads: string
    hotLeads: string
    avgScore: string
    converted: string
    lost: string
    conversionRate: string
    avgDaysToConvert: string
    statusDistribution: string
    scoreDistribution: string
    sourceBreakdown: string
    priorityBreakdown: string
    topLeads: string
    conversionProbability: string
    score: string
    estimatedValue: string
    conversionFunnel: string
    noData: string
    new: string
    contacted: string
    qualified: string
    high: string
    medium: string
    low: string
    leadsByMonth: string
    pipelineValue: string
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

function fmtCurrency(n: number): string {
  return `\u20BC${fmt(n)}`
}

function daysBetween(a: string, b: string): number {
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000))
}

// ── Status & Source definitions ─────────────────────────────────────────

const STATUS_MAP: Record<string, { color: string; bgColor: string }> = {
  new: { color: "bg-blue-500", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  contacted: { color: "bg-amber-500", bgColor: "bg-amber-100 dark:bg-amber-900/30" },
  qualified: { color: "bg-violet-500", bgColor: "bg-violet-100 dark:bg-violet-900/30" },
  converted: { color: "bg-emerald-500", bgColor: "bg-emerald-100 dark:bg-emerald-900/30" },
  lost: { color: "bg-red-500", bgColor: "bg-red-100 dark:bg-red-900/30" },
}

const SOURCE_ICONS: Record<string, any> = {
  website: Globe,
  referral: Users,
  cold_call: Phone,
  email: Mail,
  linkedin: Linkedin,
}

const SOURCE_COLORS: Record<string, string> = {
  website: "bg-blue-500",
  referral: "bg-green-500",
  cold_call: "bg-orange-500",
  email: "bg-violet-500",
  linkedin: "bg-sky-500",
}

// ── Component ───────────────────────────────────────────────────────────

export function LeadsAnalytics({ leads, labels }: LeadsAnalyticsProps) {
  const locale = useLocale()
  const stats = useMemo(() => {
    const active = leads.filter(l => !["converted", "lost"].includes(l.status))
    const converted = leads.filter(l => l.status === "converted")
    const lost = leads.filter(l => l.status === "lost")
    const hotLeads = leads.filter(l => l.score >= 80)
    const avgScore = leads.length > 0 ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0
    const conversionRate = leads.length > 0 ? Math.round((converted.length / leads.length) * 100) : 0

    // Status counts
    const statusCounts: Record<string, number> = {}
    leads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1 })

    // Source counts
    const sourceCounts: Record<string, number> = {}
    leads.forEach(l => {
      const src = l.source || "unknown"
      sourceCounts[src] = (sourceCounts[src] || 0) + 1
    })

    // Priority counts
    const priorityCounts: Record<string, number> = { high: 0, medium: 0, low: 0 }
    leads.forEach(l => { priorityCounts[l.priority] = (priorityCounts[l.priority] || 0) + 1 })

    // Score distribution
    const scoreRanges = [
      { label: "A (80-100)", min: 80, max: 100, color: "bg-emerald-500" },
      { label: "B (60-79)", min: 60, max: 79, color: "bg-blue-500" },
      { label: "C (40-59)", min: 40, max: 59, color: "bg-amber-500" },
      { label: "D (20-39)", min: 20, max: 39, color: "bg-orange-500" },
      { label: "F (0-19)", min: 0, max: 19, color: "bg-red-500" },
    ]
    const scoreDist = scoreRanges.map(r => ({
      ...r,
      count: leads.filter(l => l.score >= r.min && l.score <= r.max).length,
    }))

    // Pipeline value
    const pipelineValue = active.reduce((s, l) => s + (l.estimatedValue || 0), 0)
    const wonValue = converted.reduce((s, l) => s + (l.estimatedValue || 0), 0)

    // Top leads by score
    const topLeads = [...leads]
      .filter(l => !["converted", "lost"].includes(l.status))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    // Leads by month (last 6 months)
    const now = new Date()
    const monthlyData: { month: string; count: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      const monthLabel = formatDate(d, locale, { month: "short" })
      const count = leads.filter(l => l.createdAt.startsWith(monthKey)).length
      monthlyData.push({ month: monthLabel, count })
    }
    const maxMonthly = Math.max(...monthlyData.map(m => m.count), 1)

    return {
      total: leads.length, active: active.length, converted: converted.length, lost: lost.length,
      hotLeads: hotLeads.length, avgScore, conversionRate,
      statusCounts, sourceCounts, priorityCounts, scoreDist,
      pipelineValue, wonValue, topLeads, monthlyData, maxMonthly,
    }
  }, [leads, locale])

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <UserPlus className="h-12 w-12 text-muted-foreground/30 mb-3" />
        <p className="text-muted-foreground">{labels.noData}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── KPI Cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: labels.totalLeads,     value: stats.total,                icon: UserPlus,   sub: `${stats.active} active` },
          { label: labels.hotLeads,       value: stats.hotLeads,             icon: Flame,      sub: `score ≥ 80` },
          { label: labels.conversionRate, value: `${stats.conversionRate}%`, icon: Target,     sub: `${stats.converted} converted` },
          { label: labels.avgScore,       value: stats.avgScore,             icon: TrendingUp, sub: `/100` },
          { label: labels.pipelineValue,  value: fmtCurrency(stats.pipelineValue), icon: Zap, sub: `${stats.active} leads` },
          { label: labels.avgDaysToConvert, value: leads.length > 0 ? Math.round(leads.filter(l => l.status !== "converted").reduce((s, l) => s + daysBetween(l.createdAt, new Date().toISOString()), 0) / Math.max(1, leads.filter(l => l.status !== "converted").length)) : "—", icon: Clock, sub: "days avg" },
        ].map((kpi, i) => (
          <div key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground truncate">{kpi.label}</span>
              <div className="h-7 w-7 rounded-lg flex items-center justify-center bg-muted/50 shrink-0">
                <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{kpi.value}</p>
            <p className="text-[11px] text-muted-foreground">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Row 2: Status + Score + Source ────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Status Distribution */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            {labels.statusDistribution}
          </h3>
          <div className="space-y-3">
            {Object.entries(STATUS_MAP).map(([status, cfg]) => {
              const count = stats.statusCounts[status] || 0
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0
              const statusLabel = status === "new" ? labels.new : status === "contacted" ? labels.contacted : status === "qualified" ? labels.qualified : status === "converted" ? labels.converted : labels.lost
              return (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className={cn("h-2.5 w-2.5 rounded-full", cfg.color)} />
                      <span className="text-xs font-medium">{statusLabel}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", cfg.color)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Score Distribution */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            {labels.scoreDistribution}
          </h3>
          <div className="space-y-3">
            {stats.scoreDist.map(r => {
              const pct = stats.total > 0 ? (r.count / stats.total) * 100 : 0
              return (
                <div key={r.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">{r.label}</span>
                    <span className="text-xs text-muted-foreground">{r.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", r.color)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Source Breakdown */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            {labels.sourceBreakdown}
          </h3>
          {Object.keys(stats.sourceCounts).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(stats.sourceCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([src, count]) => {
                  const Icon = SOURCE_ICONS[src] || Globe
                  const color = SOURCE_COLORS[src] || "bg-muted-foreground/50"
                  const pct = stats.total > 0 ? (count / stats.total) * 100 : 0
                  return (
                    <div key={src}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium capitalize">{src.replace("_", " ")}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{count} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">{labels.noData}</p>
          )}
        </div>
      </div>

      {/* ── Row 3: Monthly Trend + Priority + Top Leads ──────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Monthly Trend */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            {labels.leadsByMonth}
          </h3>
          <div className="flex items-end gap-2 h-32">
            {stats.monthlyData.map((m, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] font-medium text-muted-foreground">{m.count}</span>
                <div className="w-full rounded-t-md bg-primary/80 transition-all" style={{ height: `${(m.count / stats.maxMonthly) * 100}%`, minHeight: m.count > 0 ? "4px" : "0" }} />
                <span className="text-[10px] text-muted-foreground truncate">{m.month}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Priority Breakdown */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            {labels.priorityBreakdown}
          </h3>
          <div className="flex items-center justify-center h-32">
            <MiniDonut
              segments={[
                { value: stats.priorityCounts.high, color: "#ef4444" },
                { value: stats.priorityCounts.medium, color: "#f59e0b" },
                { value: stats.priorityCounts.low, color: "#6b7280" },
              ]}
              size={110}
              thickness={14}
            />
            <div className="ml-4 space-y-2">
              {[
                { label: labels.high, count: stats.priorityCounts.high, color: "bg-red-500" },
                { label: labels.medium, count: stats.priorityCounts.medium, color: "bg-amber-500" },
                { label: labels.low, count: stats.priorityCounts.low, color: "bg-muted-foreground/50" },
              ].map(p => (
                <div key={p.label} className="flex items-center gap-2">
                  <div className={cn("h-2.5 w-2.5 rounded-full", p.color)} />
                  <span className="text-xs">{p.label}</span>
                  <span className="text-xs font-semibold">{p.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Leads */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Flame className="h-4 w-4 text-muted-foreground" />
            {labels.topLeads}
          </h3>
          {stats.topLeads.length > 0 ? (
            <div className="space-y-2.5">
              {stats.topLeads.map((lead, i) => {
                const prob = (lead.scoreDetails as any)?.conversionProb ?? Math.round(lead.score * 0.85)
                return (
                  <div key={lead.id} className="flex items-center gap-3">
                    <div className="relative h-9 w-9 flex-shrink-0">
                      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
                        <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" className="text-muted" strokeWidth="3" />
                        <circle cx="18" cy="18" r="14" fill="none" stroke={lead.score >= 80 ? "#22c55e" : lead.score >= 60 ? "#3b82f6" : lead.score >= 40 ? "#f59e0b" : "#ef4444"} strokeWidth="3" strokeDasharray={`${(prob / 100) * 88} 88`} strokeLinecap="round" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{prob}%</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{lead.contactName}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {lead.companyName || "—"} {lead.estimatedValue ? `· ${fmtCurrency(lead.estimatedValue)}` : ""}
                      </p>
                    </div>
                    <div className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded",
                      lead.score >= 80 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                      lead.score >= 60 ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    )}>
                      {lead.score}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">{labels.noData}</p>
          )}
        </div>
      </div>

      {/* ── Conversion Funnel ────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          {labels.conversionFunnel}
        </h3>
        <div className="flex items-center gap-1 h-12">
          {[
            { status: "new", label: labels.new, count: stats.statusCounts["new"] || 0, color: "bg-blue-500" },
            { status: "contacted", label: labels.contacted, count: stats.statusCounts["contacted"] || 0, color: "bg-amber-500" },
            { status: "qualified", label: labels.qualified, count: stats.statusCounts["qualified"] || 0, color: "bg-violet-500" },
            { status: "converted", label: labels.converted, count: stats.statusCounts["converted"] || 0, color: "bg-emerald-500" },
          ].map((step, i, arr) => {
            const maxCount = Math.max(...arr.map(s => s.count), 1)
            const height = Math.max(20, (step.count / maxCount) * 100)
            return (
              <div key={step.status} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center" style={{ height: "48px" }}>
                  <div className={cn("w-full rounded-t-md transition-all", step.color)} style={{ height: `${height}%` }} />
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold">{step.count}</p>
                  <p className="text-[10px] text-muted-foreground">{step.label}</p>
                </div>
                {i < arr.length - 1 && (
                  <div className="absolute text-muted-foreground/30">
                    <ArrowUpRight className="h-3 w-3" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {stats.total > 0 && (
          <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              {labels.converted}: {stats.converted} ({stats.conversionRate}%)
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5 text-red-500" />
              {labels.lost}: {stats.lost}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
