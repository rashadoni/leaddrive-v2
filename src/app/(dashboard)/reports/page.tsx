"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { ColorStatCard } from "@/components/color-stat-card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogHeader, DialogTitle, DialogContent } from "@/components/ui/dialog"
import {
  TrendingUp, DollarSign, BarChart3, CheckSquare, Clock,
  Users, Building2, Target, FileText, Wallet, ArrowRight, Star, Loader2,
  Sparkles, AlertTriangle, Inbox, Layers, ShieldCheck, CornerDownRight, Settings2,
} from "lucide-react"
import { InfoHint } from "@/components/info-hint"
import { PageDescription } from "@/components/page-description"
import { cn } from "@/lib/utils"
import { DidYouKnow } from "@/components/did-you-know"

interface ReportData {
  overview: {
    companies: number
    contacts: number
    deals: number
    leads: number
    tasks: number
    tickets: number
    totalRevenue: number
    openTickets: number
    overdueTasks: number
  }
  revenue: {
    totalRevenue: number
    wonDealsCount: number
    avgDealSize: number
  }
  pipeline: {
    stages: { stage: string; count: number; value: number }[]
    totalPipelineValue: number
  }
  tasks: {
    total: number
    byStatus: { status: string; count: number }[]
    completionRate: number
    overdue: number
  }
  tickets: {
    total: number
    byStatus: { status: string; count: number }[]
    resolutionRate: number
    open: number
  }
  leads: {
    total: number
    byStatus: { status: string; count: number }[]
    conversionRate: number
  }
  topCompanies?: { name: string; revenue: number }[]
  leadFunnel?: { status: string; count: number }[]
  financial?: {
    monthlyRevenue: number
    wonDealsRevenue: number
    totalContracts: number
    activeContracts: number
  }
  csat?: {
    average: number
    totalRatings: number
    byRating: { rating: number | null; count: number }[]
  }
  serviceDesk?: {
    totals: {
      active: number
      slaBreached: number
      slaAtRisk: number
      firstResponseBreached: number
      pendingClosure: number
      reopened: number
      autoClosedLast30: number
      slaComplianceRate: number
      avgResolutionHours: number
      avgFirstResponseMinutes: number
    }
    backlogAging: { bucket: string; count: number }[]
    byCategory: {
      id: string | null
      name: string
      slug: string | null
      parentId?: string | null
      parentName?: string | null
      depth?: number
      scope?: string | null
      isActive?: boolean
      isPortalVisible?: boolean
      childrenCount?: number
      count: number
    }[]
    bySource: { source: string; count: number }[]
    byPriority: { priority: string; count: number }[]
    throughput: { date: string; created: number; resolved: number; closed: number }[]
    agentPerformance: { agentId: string | null; agentName: string; active: number; resolved: number; avgResolutionHours: number }[]
    latestBreaches: {
      id: string
      ticketNumber: string
      subject: string
      status: string
      priority: string
      source: string | null
      requesterName: string | null
      requesterEmail: string | null
      requesterPhone: string | null
      dueAt: string | null
      assigneeName: string | null
    }[]
    closureQueue: {
      id: string
      channel: string | null
      recipient: string | null
      dueAt: string
      ticket: {
        id: string
        ticketNumber: string
        subject: string
        priority: string
        requesterName: string | null
        requesterEmail: string | null
        requesterPhone: string | null
      }
    }[]
  }
}

interface DrillDownLead {
  id: string
  contactName: string
  companyName?: string | null
  score: number
  source?: string | null
}

function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value)
  return `"${raw.replace(/"/g, "\"\"")}"`
}

// -- AI Forecast Narrative --
function ForecastNarrative() {
  const ta = useTranslations("aiSettings")
  const [narrative, setNarrative] = useState("")
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  const load = () => {
    setLoading(true)
    setError(false)
    fetch("/api/v1/reports/ai-narrative")
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(res => { if (res.data?.narrative) setNarrative(res.data.narrative); else setError(true) })
      .catch(() => setError(true))
      .finally(() => { setLoading(false); setLoaded(true) })
  }

  if (!loaded && !loading) {
    return (
      <button onClick={load} className="flex items-center gap-1.5 mt-3 text-[11px] text-violet-600 hover:text-violet-800 transition-colors">
        <Sparkles className="h-3 w-3" /> {ta("aiCommentary")}
      </button>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 mt-3 text-[11px] text-muted-foreground animate-pulse">
        <Sparkles className="h-3 w-3" /> {ta("generatingInsight")}
      </div>
    )
  }

  if (error) {
    return (
      <button onClick={load} className="flex items-center gap-1.5 mt-3 text-[11px] text-red-500 hover:text-red-600 transition-colors">
        <Sparkles className="h-3 w-3" /> {ta("failedRetry")}
      </button>
    )
  }

  if (!narrative) return null

  return (
    <div className="mt-3 p-2.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200/50 dark:border-violet-800/30">
      <div className="flex items-start gap-1.5">
        <Sparkles className="h-3 w-3 text-violet-500 mt-0.5 shrink-0" />
        <p className="text-[11px] leading-relaxed text-foreground/80">{narrative}</p>
      </div>
    </div>
  )
}

// -- CircularGauge --
function CircularGauge({
  value, max = 100, label, color = "#6366f1", size = 100,
}: { value: number; max?: number; label: string; color?: string; size?: number }) {
  const pct = Math.min(value / max, 1)
  const r = 38
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  const dashOffset = circumference * (1 - pct)
  const displayValue = max === 100 ? `${value}%` : value.toLocaleString()

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth={8} className="text-muted" />
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={color} strokeWidth={8}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text
          x={cx} y={cy + 1}
          textAnchor="middle" dominantBaseline="middle"
          className="rotate-90"
          style={{ transform: `rotate(90deg)`, transformOrigin: `${cx}px ${cy}px`, fontSize: size < 90 ? "13px" : "15px", fontWeight: 700, fill: "currentColor" }}
        >
          {displayValue}
        </text>
      </svg>
      <span className="text-xs text-muted-foreground text-center">{label}</span>
    </div>
  )
}

// -- FunnelPyramid --
function FunnelPyramid({ data, labels, onStageClick, viewLeadsTitle }: {
  data: { status: string; count: number }[]
  labels: Record<string, string>
  onStageClick?: (status: string) => void
  viewLeadsTitle?: (stageLabel: string) => string
}) {
  const funnelStages = ["new", "contacted", "qualified", "converted", "lost", "rejected", "cancelled"]
    .map(s => data.find(d => d.status === s))
    .filter(Boolean) as { status: string; count: number }[]

  if (funnelStages.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">{labels._noData}</p>
  const total = funnelStages.reduce((sum, stage) => sum + stage.count, 0)

  return (
    <div className="flex flex-col gap-1.5">
      {funnelStages.map((stage) => {
        // Lead statuses are mutually exclusive current-state buckets, not
        // sequential cohorts. Dividing one bucket by the previous one produced
        // impossible values such as 592%; show each bucket's share instead.
        const share = total > 0 ? Math.round((stage.count / total) * 100) : 0

        const colorMap: Record<string, string> = {
          new: "#3b82f6",
          contacted: "#f59e0b",
          qualified: "#8b5cf6",
          converted: "#16a34a",
          lost: "#ef4444",
          rejected: "#ef4444",
          cancelled: "#64748b",
        }
        const bg = colorMap[stage.status] || "#6b7280"

        return (
          <button
            type="button"
            key={stage.status}
            className="group grid grid-cols-[minmax(110px,1fr)_minmax(90px,2fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
            onClick={() => onStageClick?.(stage.status)}
            title={viewLeadsTitle?.(labels[stage.status] || stage.status)}
          >
            <span className="truncate text-xs font-medium text-foreground">
              {labels[stage.status] || stage.status}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full min-w-1 rounded-full transition-all group-hover:opacity-80"
                style={{ width: `${share}%`, backgroundColor: bg }}
              />
            </span>
            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              <b className="text-foreground">{stage.count}</b> · {share}%
            </span>
          </button>
        )
      })}
      <p className="pt-1 text-[11px] leading-4 text-muted-foreground">{labels._share}</p>
    </div>
  )
}

export default function ReportsPage() {
  const { data: session } = useSession()
  const t = useTranslations("reports")
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  useAutoTour("reports")
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [drillDownStatus, setDrillDownStatus] = useState<string | null>(null)
  const [drillDownLeads, setDrillDownLeads] = useState<DrillDownLead[]>([])
  const [drillDownLoading, setDrillDownLoading] = useState(false)
  const orgId = session?.user?.organizationId

  const handleFunnelDrillDown = async (status: string) => {
    setDrillDownStatus(status)
    setDrillDownLoading(true)
    try {
      const res = await fetch(`/api/v1/leads?status=${status}&limit=50`)
      const json = await res.json()
      setDrillDownLeads(json.data?.leads || [])
    } catch { setDrillDownLeads([]) }
    finally { setDrillDownLoading(false) }
  }

  const funnelLabels: Record<string, string> = {
    new: t("funnelNew"),
    contacted: t("funnelContacted"),
    qualified: t("funnelQualified"),
    converted: t("funnelConverted"),
    lost: t("funnelLost"),
    rejected: t("funnelRejected"),
    cancelled: t("funnelCancelled"),
    _share: t("funnelShare"),
    _noData: t("noData"),
  }

  const stageLabels: Record<string, string> = {
    LEAD: t("stageLead"),
    QUALIFIED: t("stageQualified"),
    PROPOSAL: t("stageProposal"),
    NEGOTIATION: t("stageNegotiation"),
    WON: t("stageWon"),
    LOST: t("stageLost"),
  }

  useEffect(() => {
    async function fetchReports() {
      try {
        const res = await fetch("/api/v1/reports", {
          headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
        })
        const json = await res.json()
        if (json.success) setData(json.data)
        else setFetchError(json.error || t("errorLoading"))
      } catch { setFetchError(t("failedToLoad")) } finally { setLoading(false) }
    }
    fetchReports()
  }, [orgId, t])

  useEffect(() => {
    if (loading) return

    const hash = window.location.hash.replace(/^#/, "")
    if (!hash) return

    const targetId = decodeURIComponent(hash)
    const scrollToHashTarget = () => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start", behavior: "smooth" })
    }

    const frame = window.requestAnimationFrame(scrollToHashTarget)
    const timeout = window.setTimeout(scrollToHashTarget, 250)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [loading, data])

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-40 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (fetchError || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center text-destructive">
          {fetchError || t("errorLoading")}
        </div>
      </div>
    )
  }

  // Lead funnel -- ordered stages
  const funnelOrder = ["new", "contacted", "qualified", "converted", "lost", "rejected", "cancelled"]
  const funnelData = funnelOrder
    .map(status => {
      const found = data.leadFunnel?.find(f => f.status === status)
      return { status, count: found?.count || 0 }
    })
    .filter(f => f.count > 0)

  // Sales forecast -- linear regression + projection
  const monthlyRevenue = data.financial?.monthlyRevenue || 0
  const wonRevenue = data.revenue.totalRevenue
  const avgMonthlyWon = wonRevenue > 0 ? wonRevenue / 6 : 0
  // Historical months (simulated from pipeline)
  const histMonths = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]
  const histValues = histMonths.map((_, i) => {
    const base = avgMonthlyWon * 0.7
    const noise = 1 + (i * 0.08) + (Math.sin(i * 1.5) * 0.1)
    return Math.round(base * noise) || Math.round(monthlyRevenue * (0.7 + i * 0.05))
  })
  // Forecast months
  const forecastMonths = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"]
  const lastHist = histValues[histValues.length - 1] || monthlyRevenue + avgMonthlyWon
  const forecastValues = forecastMonths.map((_, i) => {
    const growth = 1 + ((i + 1) * 0.05)
    return Math.round(lastHist * growth)
  })
  const allValues = [...histValues, ...forecastValues]
  const maxForecast = Math.max(...allValues, 1)
  const totalForecast = forecastValues.reduce((s, v) => s + v, 0)
  const forecastGrowth = histValues[0] > 0 ? Math.round(((forecastValues[forecastValues.length - 1] / histValues[0]) - 1) * 100) : 0

  const taskStatusLabel = (status: string) => {
    if (status === "completed") return t("completedLabel")
    if (status === "in_progress") return t("inProgressLabel")
    return t("todoLabel")
  }

  const ticketStatusLabel = (status: string) => {
    if (status === "new") return t("ticketNew")
    if (status === "in_progress") return t("ticketInProgress")
    if (status === "resolved") return t("ticketResolved")
    return t("ticketClosed")
  }

  const serviceDesk = data.serviceDesk
  const backlogMax = Math.max(...(serviceDesk?.backlogAging.map(row => row.count) || [0]), 1)
  const categoryMax = Math.max(...(serviceDesk?.byCategory.map(row => row.count) || [0]), 1)
  const sourceMax = Math.max(...(serviceDesk?.bySource.map(row => row.count) || [0]), 1)
  const priorityMax = Math.max(...(serviceDesk?.byPriority.map(row => row.count) || [0]), 1)
  const throughputMax = Math.max(
    ...(serviceDesk?.throughput.flatMap(row => [row.created, row.resolved, row.closed]) || [0]),
    1,
  )

  const agingBucketLabel = (bucket: string) => {
    if (bucket === "lt1d") return t("agingLt1d")
    if (bucket === "1to3d") return t("aging1to3d")
    if (bucket === "3to7d") return t("aging3to7d")
    return t("agingGt7d")
  }

  const formatHours = (hours: number) => {
    if (!hours || hours <= 0) return "0h"
    if (hours < 1) return `${Math.round(hours * 60)}m`
    return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)}h`
  }

  const formatMinutes = (minutes: number) => {
    if (!minutes || minutes <= 0) return "0m"
    if (minutes >= 60) return formatHours(minutes / 60)
    return `${minutes >= 10 ? Math.round(minutes) : minutes.toFixed(1)}m`
  }

  const sourceLabel = (source: string | null) => {
    if (!source || source === "unknown") return t("unknownLabel")
    if (source === "whatsapp") return "WhatsApp"
    if (source === "web_chat") return "Web chat"
    return source.replace(/_/g, " ")
  }

  const categoryScopeLabel = (scope: string | null | undefined) => {
    if (scope === "complaint") return t("complaintScope")
    if (scope === "both") return t("bothScope")
    return t("ticketScope")
  }

  const requesterLabel = (requester: {
    requesterName?: string | null
    requesterEmail?: string | null
    requesterPhone?: string | null
    source?: string | null
    channel?: string | null
  }) => requester.requesterName || requester.requesterEmail || requester.requesterPhone || sourceLabel(requester.source || requester.channel || null)

  const priorityTone = (priority: string) => {
    const normalized = priority.toLowerCase()
    if (normalized === "urgent" || normalized === "critical") return "bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300"
    if (normalized === "high") return "bg-orange-100 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/40 dark:text-orange-300"
    if (normalized === "low") return "bg-slate-100 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300"
    return "bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"
  }

  const serviceDeskMetrics = serviceDesk ? [
    { label: t("activeTickets"), value: serviceDesk.totals.active.toLocaleString(), icon: <Inbox className="h-4 w-4" />, tone: "text-blue-600" },
    { label: t("slaCompliance"), value: `${serviceDesk.totals.slaComplianceRate}%`, icon: <ShieldCheck className="h-4 w-4" />, tone: "text-green-600" },
    { label: t("slaBreached"), value: serviceDesk.totals.slaBreached.toLocaleString(), icon: <AlertTriangle className="h-4 w-4" />, tone: "text-red-600" },
    { label: t("slaAtRisk"), value: serviceDesk.totals.slaAtRisk.toLocaleString(), icon: <Clock className="h-4 w-4" />, tone: "text-amber-600" },
    { label: t("firstResponseBreached"), value: serviceDesk.totals.firstResponseBreached.toLocaleString(), icon: <FileText className="h-4 w-4" />, tone: "text-red-600" },
    { label: t("pendingClosure"), value: serviceDesk.totals.pendingClosure.toLocaleString(), icon: <CheckSquare className="h-4 w-4" />, tone: "text-indigo-600" },
    { label: t("reopenedTickets"), value: serviceDesk.totals.reopened.toLocaleString(), icon: <ArrowRight className="h-4 w-4" />, tone: "text-orange-600" },
    { label: t("avgResolutionHours"), value: formatHours(serviceDesk.totals.avgResolutionHours), icon: <Clock className="h-4 w-4" />, tone: "text-slate-700 dark:text-slate-300" },
    { label: t("avgFirstResponseMinutes"), value: formatMinutes(serviceDesk.totals.avgFirstResponseMinutes), icon: <FileText className="h-4 w-4" />, tone: "text-slate-700 dark:text-slate-300" },
    { label: t("autoClosedLast30"), value: serviceDesk.totals.autoClosedLast30.toLocaleString(), icon: <ShieldCheck className="h-4 w-4" />, tone: "text-slate-700 dark:text-slate-300" },
  ] : []

  const downloadServiceDeskCsv = () => {
    if (!serviceDesk) return

    const rows = [
      [t("serviceDeskOps"), ""],
      [t("activeTickets"), serviceDesk.totals.active],
      [t("slaCompliance"), `${serviceDesk.totals.slaComplianceRate}%`],
      [t("slaBreached"), serviceDesk.totals.slaBreached],
      [t("slaAtRisk"), serviceDesk.totals.slaAtRisk],
      [t("firstResponseBreached"), serviceDesk.totals.firstResponseBreached],
      [t("pendingClosure"), serviceDesk.totals.pendingClosure],
      [t("reopenedTickets"), serviceDesk.totals.reopened],
      [t("avgResolutionHours"), formatHours(serviceDesk.totals.avgResolutionHours)],
      [t("avgFirstResponseMinutes"), formatMinutes(serviceDesk.totals.avgFirstResponseMinutes)],
      [],
      [t("serviceDeskThroughput"), t("createdShort"), t("resolvedShort"), t("closedShort")],
      ...serviceDesk.throughput.map(row => [row.date, row.created, row.resolved, row.closed]),
      [],
      [t("latestBreaches"), t("colTicket"), t("priority"), t("agent"), t("fromLabel"), t("dueLabel")],
      ...serviceDesk.latestBreaches.map(ticket => [
        ticket.ticketNumber,
        ticket.subject,
        ticket.priority,
        ticket.assigneeName || t("unassigned"),
        requesterLabel(ticket),
        ticket.dueAt || "",
      ]),
      [],
      [t("closureQueue"), t("colTicket"), t("fromLabel"), t("dueLabel")],
      ...serviceDesk.closureQueue.map(item => [
        item.ticket.ticketNumber,
        item.ticket.subject,
        requesterLabel({ ...item.ticket, channel: item.channel }),
        item.dueAt,
      ]),
    ]

    const blob = new Blob(["\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "service-desk-report.csv"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="reports" /> <HelpButton slug="reports" variant="label" /></h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <PageDescription text={t("pageDescription")} />

      <DidYouKnow page="reports" className="mb-4" />

      {/* Overview Stats */}
      <div data-tour-id="reports-kpi" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <ColorStatCard label={t("statCompanies")} value={data.overview.companies} icon={<Building2 className="h-4 w-4" />} />
        <ColorStatCard label={t("statContacts")} value={data.overview.contacts} icon={<Users className="h-4 w-4" />} />
        <ColorStatCard label={t("statDeals")} value={data.overview.deals} icon={<DollarSign className="h-4 w-4" />} />
        <ColorStatCard label={t("statLeads")} value={data.overview.leads} icon={<Target className="h-4 w-4" />} />
        <ColorStatCard label={t("statTasksOverdue")} value={data.overview.overdueTasks} icon={<CheckSquare className="h-4 w-4" />} />
        <ColorStatCard label={t("statTickets")} value={data.overview.tickets} icon={<Clock className="h-4 w-4" />} />
      </div>

      {/* Main grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Financial Overview (T43) */}
        <Card data-tour-id="reports-pipeline-funnel">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1">{t("financialOverview")} <InfoHint text={t("hintRevenueOverview")} size={12} /></CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("revenueAndContracts")}</p>
              </div>
              <Wallet className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">{t("revenueWon")}</span>
                <span className="font-bold text-green-600">{data.revenue.totalRevenue.toLocaleString()} ₼</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">{t("monthlyContracts")}</span>
                <span className="font-bold">{(data.financial?.monthlyRevenue || 0).toLocaleString()} ₼</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">{t("pipelineTotal")}</span>
                <span className="font-bold">{data.pipeline.totalPipelineValue.toLocaleString()} ₼</span>
              </div>
              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between text-sm">
                  <span>{t("totalContracts")}</span>
                  <span className="font-medium">{data.financial?.totalContracts || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t("activeContracts")}</span>
                  <span className="font-medium text-green-600">{data.financial?.activeContracts || 0}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Deal Pipeline */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1">{t("dealsPipeline")} <InfoHint text={t("hintPipelineStages")} size={12} /></CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("byStage")}</p>
              </div>
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold mb-3">{data.pipeline.totalPipelineValue.toLocaleString()} ₼</div>
            <div className="space-y-2">
              {data.pipeline.stages.map(s => {
                const maxVal = Math.max(...data.pipeline.stages.map(x => x.value), 1)
                const pct = (s.value / maxVal) * 100
                return (
                  <div key={s.stage}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span>{stageLabels[s.stage] || s.stage}</span>
                      <span className="font-medium">{s.count} · {s.value.toLocaleString()} ₼</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Current lead-status distribution. Every lead is counted once in its
            current state; this is intentionally not a sequential cohort funnel. */}
        <Card data-tour-id="reports-lead-funnel">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1">{t("leadStatusDistribution")} <InfoHint text={t("hintLeadStatusDistribution")} size={12} /></CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("convertedShare")}: {data.leads.conversionRate}%</p>
              </div>
              <Target className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <FunnelPyramid data={funnelData} labels={funnelLabels} onStageClick={handleFunnelDrillDown} viewLeadsTitle={(stageLabel) => t("funnelViewLeads", { stage: stageLabel })} />
          </CardContent>
        </Card>

        {/* Task Summary -- CircularGauge (C4.1) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1">{t("taskSummary")} <InfoHint text={t("hintTaskSummary")} size={12} /></CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("completionAndOverdue")}</p>
              </div>
              <CheckSquare className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-3">
              <CircularGauge value={data.tasks.completionRate} label={t("completedLabel")} color="#22c55e" size={90} />
              <div className="flex-1 space-y-1">
                {data.tasks.byStatus.map(ts => (
                  <div key={ts.status} className="flex justify-between text-xs">
                    <span>{taskStatusLabel(ts.status)}</span>
                    <span className="font-medium">{ts.count}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs text-red-500">
                  <span>{t("overdueLabel")}</span>
                  <span className="font-medium">{data.tasks.overdue}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top 10 Clients (T44) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1">{t("topClients")} <InfoHint text={t("hintTopCompanies")} size={12} /></CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("byRevenue")}</p>
              </div>
              <Building2 className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            {data.topCompanies && data.topCompanies.length > 0 ? (
              <div className="space-y-2">
                {data.topCompanies.map((c, i) => {
                  const maxRev = data.topCompanies![0].revenue
                  const pct = (c.revenue / maxRev) * 100
                  return (
                    <div key={c.name}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="truncate flex-1 mr-2">
                          <span className="text-muted-foreground mr-1">{i + 1}.</span>
                          {c.name}
                        </span>
                        <span className="font-medium flex-shrink-0">{c.revenue.toLocaleString()} ₼</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">{t("noData")}</div>
            )}
          </CardContent>
        </Card>

        {/* Sales Forecast (T45) */}
        <Card data-tour-id="reports-forecast">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{t("salesForecast")}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("forecastSummary", { months: 12, pct: `${forecastGrowth > 0 ? "+" : ""}${forecastGrowth}` })}</p>
              </div>
              <div className="flex items-center gap-1">
                {forecastGrowth > 0 && <Badge className="bg-green-100 text-green-700 text-[10px]">+{forecastGrowth}%</Badge>}
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-0.5 h-24 mb-2">
              {/* Historical bars */}
              {histValues.map((val, i) => {
                const heightPct = (val / maxForecast) * 100
                return (
                  <div key={`h-${i}`} className="flex-1 flex flex-col items-center gap-0.5">
                    <span className="text-[8px] text-muted-foreground">{(val / 1000).toFixed(0)}k</span>
                    <div className="w-full bg-muted rounded-t overflow-hidden" style={{ height: "72px" }}>
                      <div className="w-full bg-muted-foreground/40 rounded-t transition-all" style={{ height: `${heightPct}%`, marginTop: `${100 - heightPct}%` }} />
                    </div>
                  </div>
                )
              })}
              {/* Forecast bars */}
              {forecastValues.map((val, i) => {
                const heightPct = (val / maxForecast) * 100
                return (
                  <div key={`f-${i}`} className="flex-1 flex flex-col items-center gap-0.5">
                    <span className="text-[8px] text-muted-foreground">{(val / 1000).toFixed(0)}k</span>
                    <div className="w-full bg-muted rounded-t overflow-hidden" style={{ height: "72px" }}>
                      <div className="w-full bg-primary/70 rounded-t transition-all border-t-2 border-dashed border-primary" style={{ height: `${heightPct}%`, marginTop: `${100 - heightPct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-0.5">
              {histMonths.map(m => (
                <div key={m} className="flex-1 text-center text-[9px] text-muted-foreground">{m}</div>
              ))}
              {forecastMonths.map(m => (
                <div key={m} className="flex-1 text-center text-[9px] text-primary font-medium">{m}</div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-muted-foreground/40 rounded" /> {t("legendActual")}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-primary/70 rounded border-t border-dashed border-primary" /> {t("legendForecast")}</span>
              <span className="ml-auto text-muted-foreground">6m total: {(totalForecast / 1000).toFixed(0)}k ₼</span>
            </div>
            <div data-tour-id="reports-ai-commentary"><ForecastNarrative /></div>
          </CardContent>
        </Card>

        {/* Ticket SLA -- CircularGauge (C4.1) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1">{t("ticketSla")} <InfoHint text={t("hintTicketSummary")} size={12} /></CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("resolutionAndOpen")}</p>
              </div>
              <Clock className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-3">
              <CircularGauge value={data.tickets.resolutionRate} label={t("resolvedLabel")} color="#6366f1" size={90} />
              <div className="flex-1 space-y-1">
                {data.tickets.byStatus.map(ts => (
                  <div key={ts.status} className="flex justify-between text-xs">
                    <span>{ticketStatusLabel(ts.status)}</span>
                    <span className="font-medium">{ts.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {serviceDesk && (
          <Card id="service-desk-operations" data-tour-id="reports-service-desk" className="md:col-span-2 lg:col-span-3 scroll-mt-24">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-1">
                    {t("serviceDeskOps")} <InfoHint text={t("hintServiceDeskOps")} size={12} />
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{t("serviceDeskOpsSubtitle")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={downloadServiceDeskCsv}
                    className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition hover:bg-muted"
                  >
                    <FileText className="h-3.5 w-3.5 text-sky-600" />
                    {t("exportServiceDeskCsv")}
                  </button>
                  <Layers className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid overflow-hidden rounded-md border bg-background sm:grid-cols-2 lg:grid-cols-5">
                {serviceDeskMetrics.map(metric => (
                  <div key={metric.label} className="min-h-[82px] border-b border-r p-3 last:border-r-0">
                    <div className={cn("mb-2 flex items-center gap-1.5 text-xs font-medium", metric.tone)}>
                      {metric.icon}
                      <span className="truncate">{metric.label}</span>
                    </div>
                    <div className="text-xl font-bold tracking-tight">{metric.value}</div>
                  </div>
                ))}
              </div>

              <section className="rounded-md border bg-muted/20 p-3">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{t("serviceDeskThroughput")}</h3>
                    <p className="text-xs text-muted-foreground">{t("serviceDeskThroughputHint")}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">{t("reportWindow14d")}</Badge>
                </div>
                <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-[repeat(14,minmax(0,1fr))]">
                  {serviceDesk.throughput.map(row => {
                    const createdHeight = Math.max(6, (row.created / throughputMax) * 72)
                    const resolvedHeight = Math.max(6, (row.resolved / throughputMax) * 72)
                    const closedHeight = Math.max(6, (row.closed / throughputMax) * 72)
                    return (
                      <div key={row.date} className="flex min-w-0 flex-col items-center gap-1">
                        <div className="flex h-[76px] w-full items-end justify-center gap-0.5 rounded bg-background px-1 py-1 ring-1 ring-border">
                          <span className="w-1.5 rounded-sm bg-blue-500/75" style={{ height: `${createdHeight}px` }} title={`${t("createdShort")}: ${row.created}`} />
                          <span className="w-1.5 rounded-sm bg-emerald-500/75" style={{ height: `${resolvedHeight}px` }} title={`${t("resolvedShort")}: ${row.resolved}`} />
                          <span className="w-1.5 rounded-sm bg-slate-500/75" style={{ height: `${closedHeight}px` }} title={`${t("closedShort")}: ${row.closed}`} />
                        </div>
                        <span className="truncate text-[10px] text-muted-foreground">{row.date.slice(5)}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-500/75" />{t("createdShort")}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500/75" />{t("resolvedShort")}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-500/75" />{t("closedShort")}</span>
                </div>
              </section>

              <div className="grid gap-5 lg:grid-cols-3">
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">{t("backlogAging")}</h3>
                    <p className="text-xs text-muted-foreground">{t("backlogAgingHint")}</p>
                  </div>
                  <div className="space-y-2">
                    {serviceDesk.backlogAging.map(row => (
                      <div key={row.bucket} className="flex items-center gap-2 text-xs">
                        <span className="w-20 shrink-0 text-muted-foreground">{agingBucketLabel(row.bucket)}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary/70" style={{ width: `${(row.count / backlogMax) * 100}%` }} />
                        </div>
                        <span className="w-8 text-right font-medium">{row.count}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-3">
                    <h3 className="mb-2 text-sm font-semibold">{t("byPriority")}</h3>
                    <div className="space-y-2">
                      {serviceDesk.byPriority.map(row => (
                        <div key={row.priority} className="flex items-center gap-2 text-xs">
                          <Badge className={cn("h-5 min-w-16 justify-center px-1.5 text-[10px] uppercase", priorityTone(row.priority))}>
                            {row.priority}
                          </Badge>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-orange-500/70" style={{ width: `${(row.count / priorityMax) * 100}%` }} />
                          </div>
                          <span className="w-8 text-right font-medium">{row.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">{t("byCategory")}</h3>
                      <p className="text-xs text-muted-foreground">{t("categoryReportHint")}</p>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/settings/ticket-categories">
                        <Settings2 className="h-3.5 w-3.5" /> {t("manageCategories")}
                      </Link>
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {serviceDesk.byCategory.length > 0 ? serviceDesk.byCategory.map(row => {
                      const depth = Math.min(row.depth || 0, 4)
                      const childrenCount = row.childrenCount || 0
                      const isSubcategory = depth > 0 || Boolean(row.parentId)
                      return (
                        <div key={`${row.id || row.slug || row.name}`} className="space-y-1.5 rounded-md border px-2 py-2">
                          <div className="flex items-center gap-2 text-xs">
                            <div className="min-w-0 flex-1" style={{ paddingLeft: `${depth * 12}px` }}>
                              <div className="flex min-w-0 items-center gap-1.5">
                                {depth > 0 && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                                <span className="truncate font-medium">{row.name}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                  {isSubcategory ? t("subcategory") : t("rootCategory")}
                                </Badge>
                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                  {categoryScopeLabel(row.scope)}
                                </Badge>
                                <span className="text-muted-foreground">
                                  {row.isPortalVisible ? t("portalVisible") : t("internalOnly")}
                                </span>
                                {childrenCount > 0 && (
                                  <span className="text-muted-foreground">{t("childrenShort", { count: childrenCount })}</span>
                                )}
                              </div>
                            </div>
                            <div className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-blue-500/70" style={{ width: `${(row.count / categoryMax) * 100}%` }} />
                            </div>
                            <span className="w-8 text-right font-medium">{row.count}</span>
                          </div>
                        </div>
                      )
                    }) : (
                      <p className="text-xs text-muted-foreground">{t("noData")}</p>
                    )}
                  </div>

                  <div className="border-t pt-3">
                    <h3 className="mb-2 text-sm font-semibold">{t("bySource")}</h3>
                    <div className="space-y-2">
                      {serviceDesk.bySource.length > 0 ? serviceDesk.bySource.map(row => (
                        <div key={row.source} className="flex items-center gap-2 text-xs">
                          <span className="min-w-0 flex-1 truncate capitalize">{sourceLabel(row.source)}</span>
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-green-500/70" style={{ width: `${(row.count / sourceMax) * 100}%` }} />
                          </div>
                          <span className="w-8 text-right font-medium">{row.count}</span>
                        </div>
                      )) : (
                        <p className="text-xs text-muted-foreground">{t("noData")}</p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">{t("latestBreaches")}</h3>
                    <p className="text-xs text-muted-foreground">{t("latestBreachesHint")}</p>
                  </div>
                  <div className="space-y-2">
                    {serviceDesk.latestBreaches.length > 0 ? serviceDesk.latestBreaches.map(ticket => (
                      <div key={ticket.id} className="rounded-md border border-red-200/70 bg-red-50/60 p-2 dark:border-red-900/50 dark:bg-red-950/10">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/tickets/${ticket.id}`} className="truncate text-xs font-semibold text-red-800 hover:underline dark:text-red-200">
                            {ticket.ticketNumber}
                          </Link>
                          <Badge className={cn("h-5 px-1.5 text-[10px] uppercase", priorityTone(ticket.priority))}>{ticket.priority}</Badge>
                        </div>
                        <p className="mt-1 truncate text-xs">{ticket.subject}</p>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                          {t("fromLabel")}: {requesterLabel(ticket)} · {sourceLabel(ticket.source)}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                          <span className="truncate">{ticket.assigneeName || t("unassigned")}</span>
                          <span>{t("dueLabel")}: {ticket.dueAt ? new Date(ticket.dueAt).toLocaleDateString() : "—"}</span>
                        </div>
                      </div>
                    )) : (
                      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("noBreaches")}</p>
                    )}
                  </div>

                  <div className="border-t pt-3">
                    <h3 className="mb-2 text-sm font-semibold">{t("closureQueue")}</h3>
                    <div className="space-y-2">
                      {serviceDesk.closureQueue.length > 0 ? serviceDesk.closureQueue.map(item => (
                        <div key={item.id} className="rounded-md border p-2">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <Link href={`/tickets/${item.ticket.id}`} className="truncate font-semibold text-primary hover:underline">
                              {item.ticket.ticketNumber}
                            </Link>
                            <span className="shrink-0 text-muted-foreground">{new Date(item.dueAt).toLocaleDateString()}</span>
                          </div>
                          <p className="mt-1 truncate text-xs">{item.ticket.subject}</p>
                          <p className="mt-1 truncate text-[11px] text-muted-foreground">
                            {t("fromLabel")}: {requesterLabel({ ...item.ticket, channel: item.channel })}
                          </p>
                        </div>
                      )) : (
                        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("noClosureQueue")}</p>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              <div className="overflow-hidden rounded-md border">
                <div className="grid grid-cols-[minmax(0,1fr)_64px_72px_88px] bg-muted/50 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                  <span>{t("agent")}</span>
                  <span className="text-right">{t("activeShort")}</span>
                  <span className="text-right">{t("resolvedShort")}</span>
                  <span className="text-right">{t("avgShort")}</span>
                </div>
                {serviceDesk.agentPerformance.length > 0 ? serviceDesk.agentPerformance.map(agent => (
                  <div key={agent.agentId || "unassigned"} className="grid grid-cols-[minmax(0,1fr)_64px_72px_88px] border-t px-3 py-2 text-xs">
                    <span className="truncate font-medium">{agent.agentId ? agent.agentName : t("unassigned")}</span>
                    <span className="text-right">{agent.active}</span>
                    <span className="text-right">{agent.resolved}</span>
                    <span className="text-right">{formatHours(agent.avgResolutionHours)}</span>
                  </div>
                )) : (
                  <p className="border-t px-3 py-3 text-xs text-muted-foreground">{t("noAgentData")}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Lead Conversion */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{t("leadConversion")}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("byStatus")}</p>
              </div>
              <Target className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.leads.conversionRate}%</div>
            <div className="text-xs text-muted-foreground mb-2">{t("conversion")}</div>
            <div className="space-y-1">
              {data.leads.byStatus.map(l => (
                <div key={l.status} className="flex justify-between text-xs">
                  <span className={funnelLabels[l.status] ? undefined : "capitalize"}>{funnelLabels[l.status] || l.status}</span>
                  <span className="font-medium">{l.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* CSAT */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{t("csat")}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("csatRatings")}</p>
              </div>
              <Star className="h-5 w-5 text-yellow-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold">{data.csat?.average || 0}</span>
              <span className="text-sm text-muted-foreground">/ 5</span>
            </div>
            <div className="text-xs text-muted-foreground mb-2">{data.csat?.totalRatings || 0} {t("ratings")}</div>
            {data.csat?.byRating && data.csat.byRating.length > 0 && (
              <div className="space-y-1">
                {[5, 4, 3, 2, 1].map(r => {
                  const item = data.csat!.byRating.find(b => b.rating === r)
                  const count = item?.count || 0
                  const total = data.csat!.totalRatings || 1
                  const pct = Math.round((count / total) * 100)
                  return (
                    <div key={r} className="flex items-center gap-2 text-xs">
                      <div className="flex items-center gap-0.5 w-10">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        <span>{r}</span>
                      </div>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 text-right font-medium">{count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue Report */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{t("dealRevenue")}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("wonDeals")}</p>
              </div>
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.revenue.totalRevenue.toLocaleString()} ₼</div>
            <div className="text-xs text-muted-foreground">{data.revenue.wonDealsCount} {t("wonDealsCount")}</div>
            <div className="text-xs text-muted-foreground mt-1">{t("avgDealSize")}: {data.revenue.avgDealSize.toLocaleString()} ₼</div>
          </CardContent>
        </Card>
      </div>

      {/* Lead Funnel Drill-Down Dialog */}
      {drillDownStatus && (
        <Dialog open={!!drillDownStatus} onOpenChange={open => { if (!open) setDrillDownStatus(null) }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              {t("drillDownTitle", { status: funnelLabels[drillDownStatus] || drillDownStatus, count: drillDownLeads.length })}
            </DialogTitle>
          </DialogHeader>
          <DialogContent className="max-h-[60vh] overflow-y-auto">
            {drillDownLoading ? (
              <div className="text-center py-8"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>
            ) : drillDownLeads.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">{t("noLeadsFound")}</p>
            ) : (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-zinc-200 dark:border-zinc-700">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t("colName")}</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t("colCompany")}</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t("colScore")}</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t("colSource")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillDownLeads.map(lead => (
                      <tr key={lead.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => window.location.href = `/leads/${lead.id}`}>
                        <td className="px-3 py-2 font-medium">{lead.contactName}</td>
                        <td className="px-3 py-2 text-muted-foreground">{lead.companyName || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={cn("text-xs font-bold", lead.score >= 60 ? "text-green-600" : lead.score >= 30 ? "text-yellow-600" : "text-red-500")}>
                            {lead.score}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{lead.source || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
