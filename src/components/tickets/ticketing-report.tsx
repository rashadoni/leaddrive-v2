"use client"

import { useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { AlertTriangle, ArrowRight, CheckSquare, Clock, CornerDownRight, FileText, Inbox, Layers, Loader2, Search, Settings2, ShieldCheck, TrendingUp, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { InfoHint } from "@/components/info-hint"
import { cn } from "@/lib/utils"

type ReportFilterState = {
  q: string
  period: string
  from: string
  to: string
  companyId: string
  categoryId: string
  assigneeId: string
  source: string
  status: string
  priority: string
  sla: string
  supportLevel: string
  slaPolicyId: string
  entitlementStatus: string
  milestoneType: string
  milestoneState: string
}

const REPORT_FILTER_KEYS: (keyof ReportFilterState)[] = [
  "q",
  "period",
  "from",
  "to",
  "companyId",
  "categoryId",
  "assigneeId",
  "source",
  "status",
  "priority",
  "sla",
  "supportLevel",
  "slaPolicyId",
  "entitlementStatus",
  "milestoneType",
  "milestoneState",
]

const DEFAULT_FILTER_STATE: ReportFilterState = {
  q: "",
  period: "all",
  from: "",
  to: "",
  companyId: "",
  categoryId: "",
  assigneeId: "",
  source: "",
  status: "",
  priority: "",
  sla: "",
  supportLevel: "",
  slaPolicyId: "",
  entitlementStatus: "",
  milestoneType: "",
  milestoneState: "",
}

interface ServiceDeskReportData {
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
  requesterBreakdown: {
    key: string
    label: string
    email: string | null
    phone: string | null
    source: string
    count: number
    active: number
  }[]
  throughput: { date: string; created: number; resolved: number; closed: number }[]
  agentPerformance: { agentId: string | null; agentName: string; active: number; resolved: number; avgResolutionHours: number }[]
  filterOptions?: {
    companies: { id: string; name: string }[]
    categories: ServiceDeskReportData["byCategory"]
    agents: { id: string; name: string; email: string }[]
    sources: string[]
    statuses: string[]
    priorities: string[]
    slaStates: string[]
    slaPolicies: { id: string; name: string }[]
    supportLevels: string[]
    entitlementStatuses: string[]
    milestoneTypes: string[]
    milestoneStates: string[]
  }
  entitlements?: {
    totals: {
      activeSupportTerms: number
      expiringSupportTerms30d: number
      overdueMilestones: number
      atRiskMilestones: number
      missedMilestones30d: number
    }
    companyRisk: {
      entitlementId: string
      companyId: string
      companyName: string
      supportLevel: string
      slaPolicyName: string
      status: string
      activeTickets: number
      overdue: number
      atRisk: number
      missed30d: number
      nextDueAt: string | null
      sampleTicketId: string | null
    }[]
    supportLevelComparison: {
      supportLevel: string
      terms: number
      activeTerms: number
      tickets: number
      overdue: number
      atRisk: number
      missed30d: number
    }[]
    milestoneDrilldown: {
      id: string
      ticketId: string
      ticketNumber: string
      subject: string
      priority: string
      companyId: string
      companyName: string
      supportLevel: string
      slaPolicyName: string
      milestoneType: string
      milestoneStatus: string
      dueAt: string
      missedAt: string | null
    }[]
  }
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

interface ReportsResponse {
  success?: boolean
  data?: {
    serviceDesk?: ServiceDeskReportData
  }
}

function readFilterState(searchParams: { get(name: string): string | null }): ReportFilterState {
  return REPORT_FILTER_KEYS.reduce((state, key) => {
    const value = searchParams.get(key)
    return { ...state, [key]: value || DEFAULT_FILTER_STATE[key] }
  }, DEFAULT_FILTER_STATE)
}

function filterParamsFromState(filters: ReportFilterState) {
  const params = new URLSearchParams()
  REPORT_FILTER_KEYS.forEach(key => {
    const value = filters[key]?.trim()
    if (!value || value === DEFAULT_FILTER_STATE[key] || value === "all") return
    params.set(key, value)
  })
  return params
}

function filterParamsFromSearch(searchParams: { get(name: string): string | null }) {
  return filterParamsFromState(readFilterState(searchParams))
}

function activeFilterCount(filters: ReportFilterState) {
  return REPORT_FILTER_KEYS.filter(key => {
    const value = filters[key]?.trim()
    return value && value !== DEFAULT_FILTER_STATE[key] && value !== "all"
  }).length
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ""
  const text = String(value).replace(/"/g, '""')
  return /[",\n\r]/.test(text) ? `"${text}"` : text
}

function formatHours(hours: number) {
  if (!hours || hours <= 0) return "0h"
  if (hours < 1) return `${Math.round(hours * 60)}m`
  return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)}h`
}

function formatMinutes(minutes: number) {
  if (!minutes || minutes <= 0) return "0m"
  if (minutes >= 60) return formatHours(minutes / 60)
  return `${minutes >= 10 ? Math.round(minutes) : minutes.toFixed(1)}m`
}

function sourceLabel(source: string | null, unknownLabel: string) {
  if (!source || source === "unknown") return unknownLabel
  if (source === "whatsapp") return "WhatsApp"
  if (source === "web_chat") return "Web chat"
  return source.replace(/_/g, " ")
}

function priorityTone(priority: string) {
  const normalized = priority.toLowerCase()
  if (normalized === "critical") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
  if (normalized === "high") return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
  if (normalized === "medium") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
}

function scopeLabel(scope: string | null | undefined, t: ReturnType<typeof useTranslations>) {
  if (scope === "complaint") return t("complaintScope")
  if (scope === "both") return t("bothScope")
  return t("ticketScope")
}

function statusLabel(status: string, t: ReturnType<typeof useTranslations>) {
  if (status === "new") return t("ticketNew")
  if (status === "open") return t("ticketOpen")
  if (status === "in_progress") return t("ticketInProgress")
  if (status === "waiting") return t("ticketWaiting")
  if (status === "escalated") return t("ticketEscalated")
  if (status === "resolved") return t("ticketResolved")
  if (status === "closed") return t("ticketClosed")
  return status.replace(/_/g, " ")
}

function priorityLabel(priority: string, t: ReturnType<typeof useTranslations>) {
  if (priority === "critical") return t("priorityCritical")
  if (priority === "high") return t("priorityHigh")
  if (priority === "medium") return t("priorityMedium")
  if (priority === "low") return t("priorityLow")
  return priority
}

function slaStateLabel(state: string, t: ReturnType<typeof useTranslations>) {
  if (state === "breached") return t("slaFilterBreached")
  if (state === "at_risk") return t("slaFilterAtRisk")
  if (state === "first_response_breached") return t("slaFilterFirstResponse")
  if (state === "pending_closure") return t("slaFilterPendingClosure")
  if (state === "reopened") return t("slaFilterReopened")
  if (state === "compliant") return t("slaFilterCompliant")
  return state.replace(/_/g, " ")
}

function supportLevelLabel(level: string, t: ReturnType<typeof useTranslations>) {
  if (level === "basic") return t("supportLevelBasic")
  if (level === "standard") return t("supportLevelStandard")
  if (level === "premium") return t("supportLevelPremium")
  if (level === "enterprise") return t("supportLevelEnterprise")
  return level
}

function entitlementStatusLabel(status: string, t: ReturnType<typeof useTranslations>) {
  if (status === "draft") return t("entitlementStatusDraft")
  if (status === "active") return t("entitlementStatusActive")
  if (status === "suspended") return t("entitlementStatusSuspended")
  if (status === "expired") return t("entitlementStatusExpired")
  if (status === "cancelled") return t("entitlementStatusCancelled")
  return status.replace(/_/g, " ")
}

function milestoneTypeLabel(type: string, t: ReturnType<typeof useTranslations>) {
  if (type === "first_response") return t("milestoneTypeFirstResponse")
  if (type === "problem_identified") return t("milestoneTypeProblemIdentified")
  if (type === "workaround_delivered") return t("milestoneTypeWorkaroundDelivered")
  if (type === "resolution") return t("milestoneTypeResolution")
  if (type === "escalation") return t("milestoneTypeEscalation")
  return type.replace(/_/g, " ")
}

function milestoneStateLabel(state: string, t: ReturnType<typeof useTranslations>) {
  if (state === "pending") return t("milestoneStatePending")
  if (state === "in_progress") return t("milestoneStateInProgress")
  if (state === "met") return t("milestoneStateMet")
  if (state === "missed") return t("milestoneStateMissed")
  if (state === "waived") return t("milestoneStateWaived")
  return state.replace(/_/g, " ")
}

function requesterLabel(
  requester: {
    requesterName?: string | null
    requesterEmail?: string | null
    requesterPhone?: string | null
    source?: string | null
    channel?: string | null
  },
  unknownLabel: string,
) {
  return requester.requesterName || requester.requesterEmail || requester.requesterPhone || sourceLabel(requester.source || requester.channel || null, unknownLabel)
}

export function TicketingReport({ orgId }: { orgId?: string }) {
  const t = useTranslations("reports")
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchKey = searchParams.toString()
  const [serviceDesk, setServiceDesk] = useState<ServiceDeskReportData | null>(null)
  const [filters, setFilters] = useState<ReportFilterState>(() => readFilterState(searchParams))
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFilters(readFilterState(searchParams))
  }, [searchKey, searchParams])

  useEffect(() => {
    let cancelled = false
    const query = filterParamsFromSearch(searchParams).toString()

    async function loadReport() {
      setLoading(true)
      setFailed(false)
      try {
        const res = await fetch(`/api/v1/reports${query ? `?${query}` : ""}`, {
          headers: orgId ? { "x-organization-id": orgId } : undefined,
        })
        const json = await res.json() as ReportsResponse
        if (!cancelled) setServiceDesk(json.success ? json.data?.serviceDesk || null : null)
      } catch {
        if (!cancelled) {
          setServiceDesk(null)
          setFailed(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadReport()

    return () => {
      cancelled = true
    }
  }, [orgId, searchKey, searchParams])

  function updateFilter(key: keyof ReportFilterState, value: string) {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      ...((key === "from" || key === "to") && value ? { period: "custom" } : {}),
    }))
  }

  function handleApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = new URLSearchParams(searchParams.toString())
    REPORT_FILTER_KEYS.forEach(key => next.delete(key))
    filterParamsFromState(filters).forEach((value, key) => next.set(key, value))
    if (pathname.endsWith("/tickets") && !next.get("view")) next.set("view", "reports")
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}#ticketing-report`, { scroll: false })
  }

  function handleReset() {
    setFilters(DEFAULT_FILTER_STATE)
    const next = new URLSearchParams(searchParams.toString())
    REPORT_FILTER_KEYS.forEach(key => next.delete(key))
    if (pathname.endsWith("/tickets") && !next.get("view")) next.set("view", "reports")
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}#ticketing-report`, { scroll: false })
  }

  if (loading) {
    return (
      <Card data-tour-id="tickets-report">
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </CardContent>
      </Card>
    )
  }

  if (failed || !serviceDesk) {
    return (
      <Card data-tour-id="tickets-report">
        <CardContent className="py-8 text-sm text-muted-foreground">
          {failed ? t("failedToLoad") : t("noData")}
        </CardContent>
      </Card>
    )
  }

  const backlogMax = Math.max(...serviceDesk.backlogAging.map(row => row.count), 1)
  const categoryMax = Math.max(...serviceDesk.byCategory.map(row => row.count), 1)
  const sourceMax = Math.max(...serviceDesk.bySource.map(row => row.count), 1)
  const priorityMax = Math.max(...serviceDesk.byPriority.map(row => row.count), 1)
  const requesterMax = Math.max(...serviceDesk.requesterBreakdown.map(row => row.count), 1)
  const throughputMax = Math.max(...serviceDesk.throughput.flatMap(row => [row.created, row.resolved, row.closed]), 1)
  const unknownLabel = t("unknownLabel")
  const appliedFilterCount = activeFilterCount(readFilterState(searchParams))
  const categoryOptions = serviceDesk.filterOptions?.categories || serviceDesk.byCategory
  const companyOptions = serviceDesk.filterOptions?.companies || []
  const agentOptions = serviceDesk.filterOptions?.agents || []
  const sourceOptions = serviceDesk.filterOptions?.sources || serviceDesk.bySource.map(row => row.source)
  const statusOptions = serviceDesk.filterOptions?.statuses || ["new", "open", "in_progress", "waiting", "escalated", "resolved", "closed"]
  const priorityOptions = serviceDesk.filterOptions?.priorities || ["critical", "high", "medium", "low"]
  const slaOptions = serviceDesk.filterOptions?.slaStates || ["breached", "at_risk", "first_response_breached", "pending_closure", "reopened", "compliant"]
  const slaPolicyOptions = serviceDesk.filterOptions?.slaPolicies || []
  const supportLevelOptions = serviceDesk.filterOptions?.supportLevels || ["basic", "standard", "premium", "enterprise"]
  const entitlementStatusOptions = serviceDesk.filterOptions?.entitlementStatuses || ["draft", "active", "suspended", "expired", "cancelled"]
  const milestoneTypeOptions = serviceDesk.filterOptions?.milestoneTypes || ["first_response", "problem_identified", "workaround_delivered", "resolution", "escalation"]
  const milestoneStateOptions = serviceDesk.filterOptions?.milestoneStates || ["pending", "in_progress", "met", "missed", "waived"]
  const entitlementReport = serviceDesk.entitlements
  const agingBucketLabel = (bucket: string) => {
    if (bucket === "lt1d") return t("agingLt1d")
    if (bucket === "1to3d") return t("aging1to3d")
    if (bucket === "3to7d") return t("aging3to7d")
    return t("agingGt7d")
  }
  const drillHref = (overrides: Partial<ReportFilterState>) => {
    const next = new URLSearchParams(searchParams.toString())
    next.set("view", "reports")
    Object.entries(overrides).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    return `/tickets?${next.toString()}#ticketing-report`
  }

  const metrics = [
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
  ]
  const entitlementMetrics = entitlementReport ? [
    {
      label: t("activeSupportTerms"),
      value: entitlementReport.totals.activeSupportTerms.toLocaleString(),
      hint: t("activeSupportTermsHint"),
      href: drillHref({ entitlementStatus: "active" }),
      icon: <ShieldCheck className="h-4 w-4" />,
      tone: "text-emerald-700 dark:text-emerald-300",
    },
    {
      label: t("expiringSupportTerms30d"),
      value: entitlementReport.totals.expiringSupportTerms30d.toLocaleString(),
      hint: t("expiringSupportTermsHint"),
      href: drillHref({ entitlementStatus: "active" }),
      icon: <Clock className="h-4 w-4" />,
      tone: "text-amber-700 dark:text-amber-300",
    },
    {
      label: t("overdueMilestones"),
      value: entitlementReport.totals.overdueMilestones.toLocaleString(),
      hint: t("overdueMilestonesHint"),
      href: drillHref({ milestoneState: "in_progress" }),
      icon: <AlertTriangle className="h-4 w-4" />,
      tone: "text-red-700 dark:text-red-300",
    },
    {
      label: t("atRiskMilestones"),
      value: entitlementReport.totals.atRiskMilestones.toLocaleString(),
      hint: t("atRiskMilestonesHint"),
      href: drillHref({ milestoneState: "in_progress" }),
      icon: <Clock className="h-4 w-4" />,
      tone: "text-orange-700 dark:text-orange-300",
    },
    {
      label: t("missedMilestones30d"),
      value: entitlementReport.totals.missedMilestones30d.toLocaleString(),
      hint: t("missedMilestonesHint"),
      href: drillHref({ milestoneState: "missed" }),
      icon: <TrendingUp className="h-4 w-4" />,
      tone: "text-slate-700 dark:text-slate-300",
    },
  ] : []

  function downloadServiceDeskCsv() {
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
      [t("byRequester"), t("fromLabel"), t("sourceFilter"), t("activeShort"), t("ticketsShort")],
      ...serviceDesk.requesterBreakdown.map(row => [
        row.label,
        row.email || row.phone || "",
        sourceLabel(row.source, unknownLabel),
        row.active,
        row.count,
      ]),
      [],
      [t("latestBreaches"), t("colTicket"), t("priority"), t("agent"), t("fromLabel"), t("dueLabel")],
      ...serviceDesk.latestBreaches.map(ticket => [
        ticket.ticketNumber,
        ticket.subject,
        ticket.priority,
        ticket.assigneeName || t("unassigned"),
        requesterLabel(ticket, unknownLabel),
        ticket.dueAt || "",
      ]),
      [],
      [t("closureQueue"), t("colTicket"), t("fromLabel"), t("dueLabel")],
      ...serviceDesk.closureQueue.map(item => [
        item.ticket.ticketNumber,
        item.ticket.subject,
        requesterLabel({ ...item.ticket, channel: item.channel }, unknownLabel),
        item.dueAt,
      ]),
      [],
      [t("supportTermsHealth"), ""],
      [t("activeSupportTerms"), serviceDesk.entitlements?.totals.activeSupportTerms || 0],
      [t("expiringSupportTerms30d"), serviceDesk.entitlements?.totals.expiringSupportTerms30d || 0],
      [t("overdueMilestones"), serviceDesk.entitlements?.totals.overdueMilestones || 0],
      [t("atRiskMilestones"), serviceDesk.entitlements?.totals.atRiskMilestones || 0],
      [t("missedMilestones30d"), serviceDesk.entitlements?.totals.missedMilestones30d || 0],
      [],
      [t("companyRiskTable"), t("colCompany"), t("supportLevel"), t("slaPolicy"), t("activeTickets"), t("overdueShort"), t("atRiskShort"), t("missed30dShort"), t("nextDue")],
      ...(serviceDesk.entitlements?.companyRisk || []).map(row => [
        row.companyName,
        supportLevelLabel(row.supportLevel, t),
        row.slaPolicyName,
        row.activeTickets,
        row.overdue,
        row.atRisk,
        row.missed30d,
        row.nextDueAt || "",
      ]),
      [],
      [t("milestoneDrilldown"), t("colTicket"), t("colCompany"), t("supportLevel"), t("milestoneType"), t("milestoneState"), t("dueLabel")],
      ...(serviceDesk.entitlements?.milestoneDrilldown || []).map(row => [
        row.ticketNumber,
        row.companyName,
        supportLevelLabel(row.supportLevel, t),
        milestoneTypeLabel(row.milestoneType, t),
        milestoneStateLabel(row.milestoneStatus, t),
        row.dueAt,
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
    <Card id="ticketing-report" data-tour-id="tickets-report">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-1 text-base">
              {t("serviceDeskOps")} <InfoHint text={t("hintServiceDeskOps")} size={12} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{t("serviceDeskOpsSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={downloadServiceDeskCsv}>
              <FileText className="h-3.5 w-3.5 text-sky-600" />
              {t("exportServiceDeskCsv")}
            </Button>
            <Layers className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleApply} className="rounded-md border bg-muted/20 p-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
            <label className="space-y-1 md:col-span-2 xl:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">{t("filterSearch")}</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filters.q}
                  onChange={event => updateFilter("q", event.target.value)}
                  placeholder={t("filterSearchPlaceholder")}
                  className="h-9 pl-8 text-sm"
                />
              </span>
            </label>

            <Select label={t("periodLabel")} value={filters.period} onChange={event => updateFilter("period", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="all">{t("allTime")}</option>
              <option value="7d">{t("period7d")}</option>
              <option value="14d">{t("period14d")}</option>
              <option value="30d">{t("period30d")}</option>
              <option value="90d">{t("period90d")}</option>
              <option value="this_month">{t("periodThisMonth")}</option>
              <option value="custom">{t("periodCustom")}</option>
            </Select>

            <Select label={t("companyFilter")} value={filters.companyId} onChange={event => updateFilter("companyId", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allCompanies")}</option>
              {companyOptions.map(company => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </Select>

            <Select label={t("categoryFilter")} value={filters.categoryId} onChange={event => updateFilter("categoryId", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allCategories")}</option>
              {categoryOptions.map(category => (
                <option key={category.id || category.slug || category.name} value={category.id || ""}>
                  {"  ".repeat(Math.min(category.depth || 0, 4))}{category.name}
                </option>
              ))}
            </Select>

            <Select label={t("agentFilter")} value={filters.assigneeId} onChange={event => updateFilter("assigneeId", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allAgents")}</option>
              {agentOptions.map(agent => (
                <option key={agent.id} value={agent.id}>{agent.name || agent.email}</option>
              ))}
            </Select>

            <Select label={t("sourceFilter")} value={filters.source} onChange={event => updateFilter("source", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allSources")}</option>
              {sourceOptions.map(source => (
                <option key={source} value={source}>{sourceLabel(source, unknownLabel)}</option>
              ))}
            </Select>

            <Select label={t("statusFilter")} value={filters.status} onChange={event => updateFilter("status", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allStatuses")}</option>
              {statusOptions.map(status => (
                <option key={status} value={status}>{statusLabel(status, t)}</option>
              ))}
            </Select>

            <Select label={t("priorityFilter")} value={filters.priority} onChange={event => updateFilter("priority", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allPriorities")}</option>
              {priorityOptions.map(priority => (
                <option key={priority} value={priority}>{priorityLabel(priority, t)}</option>
              ))}
            </Select>

            <Select label={t("slaFilter")} value={filters.sla} onChange={event => updateFilter("sla", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allSlaStates")}</option>
              {slaOptions.map(state => (
                <option key={state} value={state}>{slaStateLabel(state, t)}</option>
              ))}
            </Select>

            <Select label={t("slaPolicyFilter")} value={filters.slaPolicyId} onChange={event => updateFilter("slaPolicyId", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allSlaPolicies")}</option>
              {slaPolicyOptions.map(policy => (
                <option key={policy.id} value={policy.id}>{policy.name}</option>
              ))}
            </Select>

            <Select label={t("supportLevelFilter")} value={filters.supportLevel} onChange={event => updateFilter("supportLevel", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allSupportLevels")}</option>
              {supportLevelOptions.map(level => (
                <option key={level} value={level}>{supportLevelLabel(level, t)}</option>
              ))}
            </Select>

            <Select label={t("entitlementStatusFilter")} value={filters.entitlementStatus} onChange={event => updateFilter("entitlementStatus", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allEntitlementStatuses")}</option>
              {entitlementStatusOptions.map(status => (
                <option key={status} value={status}>{entitlementStatusLabel(status, t)}</option>
              ))}
            </Select>

            <Select label={t("milestoneTypeFilter")} value={filters.milestoneType} onChange={event => updateFilter("milestoneType", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allMilestoneTypes")}</option>
              {milestoneTypeOptions.map(type => (
                <option key={type} value={type}>{milestoneTypeLabel(type, t)}</option>
              ))}
            </Select>

            <Select label={t("milestoneStateFilter")} value={filters.milestoneState} onChange={event => updateFilter("milestoneState", event.target.value)} className="h-9 rounded-md text-sm">
              <option value="">{t("allMilestoneStates")}</option>
              {milestoneStateOptions.map(state => (
                <option key={state} value={state}>{milestoneStateLabel(state, t)}</option>
              ))}
            </Select>

            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t("fromDate")}</span>
              <Input type="date" value={filters.from} onChange={event => updateFilter("from", event.target.value)} className="h-9 text-sm" />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t("toDate")}</span>
              <Input type="date" value={filters.to} onChange={event => updateFilter("to", event.target.value)} className="h-9 text-sm" />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm">
              <Search className="h-3.5 w-3.5" />
              {t("applyFilters")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleReset}>
              <X className="h-3.5 w-3.5" />
              {t("resetFilters")}
            </Button>
            {appliedFilterCount > 0 && (
              <Badge variant="secondary" className="h-7 px-2 text-xs">
                {t("filtersActiveCount", { count: appliedFilterCount })}
              </Badge>
            )}
          </div>
        </form>

        <div className="grid overflow-hidden rounded-md border bg-background sm:grid-cols-2 lg:grid-cols-5">
          {metrics.map(metric => (
            <div key={metric.label} className="min-h-[82px] border-b border-r p-3 last:border-r-0">
              <div className={cn("mb-2 flex items-center gap-1.5 text-xs font-medium", metric.tone)}>
                {metric.icon}
                <span className="truncate">{metric.label}</span>
              </div>
              <div className="text-xl font-bold tracking-tight">{metric.value}</div>
            </div>
          ))}
        </div>

        {entitlementReport && (
          <section className="rounded-md border bg-background">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-3 py-3">
              <div>
                <h3 className="text-sm font-semibold">{t("supportTermsHealth")}</h3>
                <p className="text-xs text-muted-foreground">{t("supportTermsHealthHint")}</p>
              </div>
              <Button type="button" variant="outline" size="sm" asChild>
                <Link href="/support/entitlements">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t("manageSupportTerms")}
                </Link>
              </Button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5">
              {entitlementMetrics.map(metric => (
                <Link
                  key={metric.label}
                  href={metric.href}
                  className="min-h-[96px] border-b border-r p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className={cn("mb-2 flex items-center gap-1.5 text-xs font-medium", metric.tone)}>
                    {metric.icon}
                    <span className="truncate">{metric.label}</span>
                  </div>
                  <div className="text-xl font-bold tracking-tight">{metric.value}</div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{metric.hint}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

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

        {entitlementReport && (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <div className="overflow-hidden rounded-md border">
              <div className="flex flex-wrap items-start justify-between gap-3 bg-muted/40 px-3 py-3">
                <div>
                  <h3 className="text-sm font-semibold">{t("companyRiskTable")}</h3>
                  <p className="text-xs text-muted-foreground">{t("companyRiskHint")}</p>
                </div>
                <Badge variant="outline" className="text-[10px]">{t("topRiskCustomers")}</Badge>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-[minmax(180px,1.5fr)_100px_140px_72px_72px_72px_88px] border-t bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                    <span>{t("colCompany")}</span>
                    <span>{t("supportLevel")}</span>
                    <span>{t("slaPolicy")}</span>
                    <span className="text-right">{t("activeShort")}</span>
                    <span className="text-right">{t("overdueShort")}</span>
                    <span className="text-right">{t("atRiskShort")}</span>
                    <span className="text-right">{t("nextDue")}</span>
                  </div>
                  {entitlementReport.companyRisk.length > 0 ? entitlementReport.companyRisk.map(row => (
                    <Link
                      key={row.entitlementId}
                      href={drillHref({ companyId: row.companyId, supportLevel: row.supportLevel })}
                      className="grid grid-cols-[minmax(180px,1.5fr)_100px_140px_72px_72px_72px_88px] border-t px-3 py-2 text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{row.companyName}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{entitlementStatusLabel(row.status, t)}</span>
                      </span>
                      <span className="truncate">{supportLevelLabel(row.supportLevel, t)}</span>
                      <span className="truncate text-muted-foreground">{row.slaPolicyName}</span>
                      <span className="text-right">{row.activeTickets}</span>
                      <span className={cn("text-right font-medium", row.overdue > 0 && "text-red-600")}>{row.overdue}</span>
                      <span className={cn("text-right font-medium", row.atRisk > 0 && "text-orange-600")}>{row.atRisk}</span>
                      <span className="text-right text-muted-foreground">{row.nextDueAt ? new Date(row.nextDueAt).toLocaleDateString() : "-"}</span>
                    </Link>
                  )) : (
                    <p className="border-t px-3 py-4 text-xs text-muted-foreground">{t("noCompanyRisk")}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-md border">
              <div className="bg-muted/40 px-3 py-3">
                <h3 className="text-sm font-semibold">{t("supportLevelComparison")}</h3>
                <p className="text-xs text-muted-foreground">{t("supportLevelComparisonHint")}</p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_48px_48px_48px_48px] border-t bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                <span>{t("supportLevel")}</span>
                <span className="text-right">{t("termsShort")}</span>
                <span className="text-right">{t("ticketsShort")}</span>
                <span className="text-right">{t("lateShort")}</span>
                <span className="text-right">{t("missedShort")}</span>
              </div>
              {entitlementReport.supportLevelComparison.map(row => (
                <Link
                  key={row.supportLevel}
                  href={drillHref({ supportLevel: row.supportLevel })}
                  className="grid grid-cols-[minmax(0,1fr)_48px_48px_48px_48px] border-t px-3 py-2 text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate font-medium">{supportLevelLabel(row.supportLevel, t)}</span>
                  <span className="text-right">{row.activeTerms || row.terms}</span>
                  <span className="text-right">{row.tickets}</span>
                  <span className={cn("text-right font-medium", row.overdue + row.atRisk > 0 && "text-orange-600")}>{row.overdue + row.atRisk}</span>
                  <span className={cn("text-right font-medium", row.missed30d > 0 && "text-red-600")}>{row.missed30d}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {entitlementReport && entitlementReport.milestoneDrilldown.length > 0 && (
          <section className="overflow-hidden rounded-md border">
            <div className="flex flex-wrap items-start justify-between gap-3 bg-muted/40 px-3 py-3">
              <div>
                <h3 className="text-sm font-semibold">{t("milestoneDrilldown")}</h3>
                <p className="text-xs text-muted-foreground">{t("milestoneDrilldownHint")}</p>
              </div>
              <Badge variant="outline" className="text-[10px]">{t("showingTopMilestones", { count: entitlementReport.milestoneDrilldown.length })}</Badge>
            </div>
            <div className="grid divide-y">
              {entitlementReport.milestoneDrilldown.slice(0, 8).map(row => (
                <Link
                  key={row.id}
                  href={`/tickets/${row.ticketId}`}
                  className="grid gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[96px_minmax(0,1fr)_150px_120px_96px]"
                >
                  <span className="font-semibold text-primary">{row.ticketNumber}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{row.subject}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{row.companyName} · {supportLevelLabel(row.supportLevel, t)}</span>
                  </span>
                  <span className="truncate text-muted-foreground">{milestoneTypeLabel(row.milestoneType, t)}</span>
                  <span className={cn("font-medium", row.milestoneStatus === "missed" ? "text-red-600" : "text-orange-600")}>
                    {milestoneStateLabel(row.milestoneStatus, t)}
                  </span>
                  <span className="text-muted-foreground sm:text-right">{new Date(row.dueAt).toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

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
                            {scopeLabel(row.scope, t)}
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
                    <span className="min-w-0 flex-1 truncate capitalize">{sourceLabel(row.source, unknownLabel)}</span>
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

            <div className="border-t pt-3">
              <h3 className="text-sm font-semibold">{t("byRequester")}</h3>
              <p className="mb-2 text-xs text-muted-foreground">{t("requesterReportHint")}</p>
              <div className="space-y-2">
                {serviceDesk.requesterBreakdown.length > 0 ? serviceDesk.requesterBreakdown.map(row => (
                  <div key={row.key} className="rounded-md border px-2 py-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{row.email || row.phone || sourceLabel(row.source, unknownLabel)}</p>
                      </div>
                      <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
                        {sourceLabel(row.source, unknownLabel)}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-indigo-500/70" style={{ width: `${(row.count / requesterMax) * 100}%` }} />
                      </div>
                      <span className="w-28 text-right text-[11px] text-muted-foreground">
                        {t("activeShort")}: {row.active} · {t("ticketsShort")}: {row.count}
                      </span>
                    </div>
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
                    {t("fromLabel")}: {requesterLabel(ticket, unknownLabel)} · {sourceLabel(ticket.source, unknownLabel)}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{ticket.assigneeName || t("unassigned")}</span>
                    <span>{t("dueLabel")}: {ticket.dueAt ? new Date(ticket.dueAt).toLocaleDateString() : "-"}</span>
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
                      {t("fromLabel")}: {requesterLabel({ ...item.ticket, channel: item.channel }, unknownLabel)}
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
  )
}
