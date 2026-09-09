"use client"

import { useEffect, useState, useRef } from "react"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { OperationalWeekHome } from "@/components/mtm/operational-week-home"
import { Button } from "@/components/ui/button"
import { createDateFormatter, formatDate, formatDateTime, formatTime } from "@/lib/format-date"
import Link from "next/link"
import {
  MapPin, Users, Route, CheckSquare, AlertTriangle,
  ClipboardList, TrendingUp, Clock,
  Wifi, Navigation, FileWarning, TimerReset,
  Check, ChevronDown, LifeBuoy, Mail, Megaphone, Phone,
} from "lucide-react"

function DashboardClock({ locale, timezone }: { locale: string; timezone: string | null }) {
  const [clock, setClock] = useState<Date | null>(null)
  useEffect(() => {
    setClock(new Date())
    // C16: the panel shows hours and minutes, so ticking every second only
    // re-rendered the same string 59 times out of 60. Half a minute is close
    // enough for a clock that cannot show seconds anyway.
    const interval = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(interval)
  }, [])
  return (
    <div className="text-left text-muted-foreground sm:text-right">
      <div className="text-xs">{clock ? formatDate(clock, locale, { weekday: "long", year: "numeric", month: "long", day: "numeric", ...(timezone ? { timeZone: timezone } : {}) }) : "—"}</div>
      <div className="font-mono text-2xl font-bold tabular-nums text-foreground">
        {clock ? formatTime(clock, locale, { hour: "2-digit", minute: "2-digit", hour12: false, ...(timezone ? { timeZone: timezone } : {}) }) : "--:--"}
      </div>
    </div>
  )
}

export default function MtmDashboardPage() {
  const { data: session } = useSession()
  const locale = useLocale()
  const t = useTranslations("nav")
  const td = useTranslations("mtmDashboardPage")
  const [dashboardResult, setDashboardResult] = useState<{ scopeKey: string; data: any } | null>(null)
  const [loading, setLoading] = useState(false)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [period, setPeriod] = useState<"today" | "week" | "month">("today")
  const [operationalResult, setOperationalResult] = useState<{ scopeKey: string; data: {
    announcement: {
      messageId: string
      title: string
      body: string
      effectiveUntil: string
      acknowledgedAt: string | null
    } | null
    support: { email: string | null; phone: string | null }
    timezone: string
  } } | null>(null)
  const [acknowledging, setAcknowledging] = useState(false)
  const [operationalLoading, setOperationalLoading] = useState(true)
  const [operationalError, setOperationalError] = useState(false)
  const [operationalRetry, setOperationalRetry] = useState(0)
  const orgId = session?.user?.organizationId
  const viewerKey = session?.user?.id || session?.user?.email || "no-viewer"
  const dashboardScopeKey = `${orgId || "no-org"}:${viewerKey}:${period}`
  const operationalScopeKey = `${orgId || "no-org"}:${viewerKey}:${locale}`
  const data = dashboardResult?.scopeKey === dashboardScopeKey ? dashboardResult.data : null
  const operational = operationalResult?.scopeKey === operationalScopeKey ? operationalResult.data : null
  const dashboardRequestIdRef = useRef(0)
  const operationalRequestIdRef = useRef(0)

  useEffect(() => {
    if (!legacyOpen) return
    const requestId = ++dashboardRequestIdRef.current
    const requestScopeKey = `${orgId || "no-org"}:${viewerKey}:${period}`
    const controller = new AbortController()
    setDashboardResult(null)
    setLoading(true)
    fetch(`/api/v1/mtm/dashboard?period=${period}`, {
      headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>),
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`)
        if (requestId === dashboardRequestIdRef.current) {
          setDashboardResult({ scopeKey: requestScopeKey, data: result.data })
        }
      })
      .catch((error) => {
        if (controller.signal.aborted || requestId !== dashboardRequestIdRef.current) return
        toast.error(td("dashboardLoadFailed", { error: error instanceof Error ? error.message : td("networkError") }))
      })
      .finally(() => {
        if (requestId === dashboardRequestIdRef.current) setLoading(false)
      })
    return () => controller.abort()
  }, [legacyOpen, period, orgId, td, viewerKey])

  useEffect(() => {
    const requestId = ++operationalRequestIdRef.current
    const requestScopeKey = `${orgId || "no-org"}:${viewerKey}:${locale}`
    const controller = new AbortController()
    setOperationalResult(null)
    setOperationalLoading(true)
    setOperationalError(false)
    fetch(`/api/v1/mtm/operational-announcement?locale=${encodeURIComponent(locale)}`, {
      headers: orgId ? { "x-organization-id": String(orgId) } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.success) throw new Error(result.error || td("announcementLoadFailed"))
        if (requestId === operationalRequestIdRef.current) {
          setOperationalResult({ scopeKey: requestScopeKey, data: result.data })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && requestId === operationalRequestIdRef.current) setOperationalError(true)
      })
      .finally(() => {
        if (requestId === operationalRequestIdRef.current) setOperationalLoading(false)
      })
    return () => controller.abort()
  }, [locale, operationalRetry, orgId, td, viewerKey])

  async function acknowledgeAnnouncement() {
    if (!operational?.announcement || operational.announcement.acknowledgedAt) return
    setAcknowledging(true)
    try {
      const response = await fetch("/api/v1/mtm/operational-announcement", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({ messageId: operational.announcement.messageId }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || td("announcementAckFailed"))
      setOperationalResult((current) => current?.scopeKey === operationalScopeKey && current.data.announcement ? {
        ...current,
        data: {
          ...current.data,
          announcement: { ...current.data.announcement, acknowledgedAt: result.data.acknowledgedAt },
        },
      } : current)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : td("announcementAckFailed"))
    } finally {
      setAcknowledging(false)
    }
  }

  const userName = session?.user?.name?.split(" ")[0] || ""
  const failedImportsUnavailable = Boolean(data?.scope?.omittedForBoundedScope?.includes("failedImports"))
  const metricValue = (value: number | null | undefined): number | string => data ? value ?? 0 : "—"

  return (
    <div className="space-y-5">
      {/* Header with greeting and live clock */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {userName && <h2 className="text-lg font-semibold mb-0.5">{td("welcomeBack", { name: userName })}</h2>}
          <div className="flex items-center gap-2">
            <PageDescription
              icon={MapPin}
              title={t("mtmDashboard")}
              description={td("subtitle")}
            />
            <HelpButton slug="mtm-overview" variant="label" />
          </div>
        </div>
        <DashboardClock
          locale={locale}
          timezone={typeof operational?.timezone === "string"
            ? operational.timezone
            : typeof data?.timezone === "string" ? data.timezone : null}
        />
      </div>

      {/* One clear daily path. Administration and reports remain in “All MTM tools”. */}
      <section aria-labelledby="mtm-next-step" className="flex flex-col gap-3 border-y border-zinc-200 py-4 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p id="mtm-next-step" className="text-sm font-semibold">{td("nextStepTitle")}</p>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{td("nextStepHint")}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link href="/mtm/routes"><Button className="min-h-11 w-full sm:w-auto"><Route className="mr-2 h-4 w-4" />{td("openPlan")}</Button></Link>
          <Link href="/mtm/visits"><Button variant="outline" className="min-h-11 w-full sm:w-auto"><CheckSquare className="mr-2 h-4 w-4" />{td("openVisits")}</Button></Link>
          <Link href="/mtm/map"><Button variant="ghost" className="min-h-11 w-full sm:w-auto"><MapPin className="mr-2 h-4 w-4" />{td("openMap")}</Button></Link>
        </div>
      </section>

      {operationalLoading ? (
        <div className="h-24 animate-pulse border-y border-zinc-200 bg-muted/40 motion-reduce:animate-none dark:border-zinc-700" aria-label={td("announcementLoading")} />
      ) : operationalError ? (
        <section className="flex flex-col gap-3 border-y border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">{td("announcementLoadFailed")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{td("announcementLoadFailedHint")}</p>
          </div>
          <Button variant="outline" className="min-h-11 shrink-0" onClick={() => setOperationalRetry((value) => value + 1)}>
            {td("announcementRetry")}
          </Button>
        </section>
      ) : (operational?.announcement || operational?.support.email || operational?.support.phone) ? (
        <section className="grid border-y border-zinc-200 bg-card dark:border-zinc-700 lg:grid-cols-[minmax(0,1fr)_320px]">
          {operational.announcement ? (
            <div className="p-4 lg:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                    <Megaphone className="h-4 w-4" />{td("keyMessage")}
                  </div>
                  <h3 className="mt-2 text-base font-semibold">{operational.announcement.title}</h3>
                  <p className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">{operational.announcement.body}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {td("announcementValidUntil", {
                      date: createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" })
                        .format(new Date(operational.announcement.effectiveUntil)),
                    })}
                  </p>
                </div>
                {operational.announcement.acknowledgedAt ? (
                  <span className="inline-flex min-h-10 shrink-0 items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                    <Check className="h-4 w-4" />{td("announcementAcknowledged")}
                  </span>
                ) : (
                  <Button className="min-h-11 shrink-0" onClick={acknowledgeAnnouncement} disabled={acknowledging}>
                    <Check className="mr-2 h-4 w-4" />{acknowledging ? td("announcementAcknowledging") : td("announcementAcknowledge")}
                  </Button>
                )}
              </div>
            </div>
          ) : <div className="hidden lg:block" />}
          {(operational.support.email || operational.support.phone) ? (
            <aside className="border-t border-zinc-200 p-4 dark:border-zinc-700 lg:border-l lg:border-t-0 lg:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><LifeBuoy className="h-4 w-4 text-primary" />{td("supportTitle")}</div>
              <p className="mt-1 text-xs text-muted-foreground">{td("supportHint")}</p>
              <div className="mt-3 space-y-2 text-sm">
                {operational.support.email ? (
                  <a className="flex min-h-10 items-center gap-2 hover:text-primary" href={`mailto:${encodeURIComponent(operational.support.email)}`}>
                    <Mail className="h-4 w-4" />{operational.support.email}
                  </a>
                ) : null}
                {operational.support.phone ? (
                  <a className="flex min-h-10 items-center gap-2 hover:text-primary" href={`tel:${operational.support.phone.replace(/[^\d+]/g, "")}`}>
                    <Phone className="h-4 w-4" />{operational.support.phone}
                  </a>
                ) : null}
              </div>
            </aside>
          ) : null}
        </section>
      ) : null}

      <OperationalWeekHome
        key={`${orgId || "no-org"}:${session?.user?.id || session?.user?.email || "no-viewer"}`}
        organizationId={orgId ? String(orgId) : null}
        viewerId={session?.user?.id || session?.user?.email || null}
      />

      <details
        className="group overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-700"
        onToggle={(event) => setLegacyOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span id="mtm-established-overview" role="heading" aria-level={2} className="block text-base font-semibold">
              {td("operationalWeek.legacyTitle")}
            </span>
            <span className="mt-1 block max-w-3xl text-sm leading-6 text-muted-foreground">
              {td("operationalWeek.legacyNote")}
            </span>
          </span>
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>

        <div className="space-y-5 border-t border-zinc-200 p-4 dark:border-zinc-700">

      {/* Period filter */}
      <div className="flex gap-1">
        {(["today", "week", "month"] as const).map(p => (
          <Button key={p} variant={period === p ? "default" : "outline"} size="sm" onClick={() => setPeriod(p)}>
            {td(`period.${p}`)}
          </Button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <ColorStatCard
          label={td("kpiPlannedRoutes")}
          value={metricValue(data?.todayRoutes)}
          subValue={td(`periodSuffix.${period}`)}
          icon={<Route className="h-4 w-4" />}
         
        />
        <ColorStatCard
          label={td("kpiCompleted")}
          value={metricValue(data?.completedRoutes)}
          subValue={data ? td("kpiCompletionSuffix", { pct: data.routeCompletion ?? 0 }) : loading ? td("loading") : undefined}
          icon={<CheckSquare className="h-4 w-4" />}
         
        />
        <ColorStatCard
          label={td("kpiOffRoute")}
          value={metricValue(data?.offRouteAlerts)}
          subValue={td("kpiNeedsAttention")}
          icon={<AlertTriangle className="h-4 w-4" />}
         
        />
        <ColorStatCard
          label={td("kpiPendingTasks")}
          value={metricValue(data?.pendingTasks)}
          subValue={data ? td("kpiUrgentSuffix", { n: data.urgentTasks ?? 0 }) : loading ? td("loading") : undefined}
          icon={<ClipboardList className="h-4 w-4" />}
         
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <ColorStatCard
          label={td("kpiImportFailures")}
          value={!data || failedImportsUnavailable ? "—" : data.failedImports ?? 0}
          subValue={!data ? loading ? td("loading") : undefined : failedImportsUnavailable ? td("scopeUnavailable") : td("kpiImportFailuresHint")}
          icon={<FileWarning className="h-4 w-4" />}
        />
        <ColorStatCard label={td("kpiOpenVisits")} value={metricValue(data?.openVisits)} subValue={data ? td("kpiOpenVisitsHint") : loading ? td("loading") : undefined} icon={<TimerReset className="h-4 w-4" />} />
        <ColorStatCard label={td("kpiApprovalBacklog")} value={metricValue(data?.approvalBacklog)} subValue={data ? td("kpiApprovalBacklogHint") : loading ? td("loading") : undefined} icon={<ClipboardList className="h-4 w-4" />} />
      </div>

      {/* Row 2: Donut + Time Metrics + Active Agents */}
      <div className="grid gap-3 md:grid-cols-3">
        {/* Donut Chart */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">{td("completionRate")}</h3>
          <div className="flex items-center gap-6">
            <div className="relative h-28 w-28 flex-shrink-0">
              <svg viewBox="0 0 36 36" className="h-28 w-28 -rotate-90">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${data?.routeCompletion ?? 0}, 100`} className="text-primary" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xl font-bold">{data ? `${data.routeCompletion ?? 0}%` : "—"}</span>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-primary" /><span>{td("kpiCompleted")}: {metricValue(data?.completedRoutes)}</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30" /><span>{td("remaining")}: {data ? (data.todayRoutes ?? 0) - (data.completedRoutes ?? 0) : "—"}</span></div>
            </div>
          </div>
        </div>

        {/* Time Metrics */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">{td("timeMetrics")}</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-950/30 flex items-center justify-center"><Clock className="h-4 w-4 text-blue-600" /></div>
              <div className="flex-1"><div className="text-xs text-muted-foreground">{td("avgRouteTime")}</div><div className="text-lg font-bold">{data ? td("minutes", { n: data.avgRouteDuration ?? 0 }) : "—"}</div></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-green-100 dark:bg-green-950/30 flex items-center justify-center"><Clock className="h-4 w-4 text-green-600" /></div>
              <div className="flex-1"><div className="text-xs text-muted-foreground">{td("avgVisitTime")}</div><div className="text-lg font-bold">{data ? td("minutes", { n: data.avgVisitDuration ?? 0 }) : "—"}</div></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center"><Clock className="h-4 w-4 text-amber-600" /></div>
              <div className="flex-1"><div className="text-xs text-muted-foreground">{td("totalWorkTime")}</div><div className="text-lg font-bold">{data ? td("hours", { n: data.totalWorkTime ?? 0 }) : "—"}</div></div>
            </div>
          </div>
        </div>

        {/* Active Agents */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">{td("activeAgents", { minutes: Math.max(1, Math.round((data?.gpsFreshnessThresholdSeconds ?? 300) / 60)) })}</h3>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950/30 dark:text-green-400">{data ? `${data.recentGpsAgents ?? 0}${data.gpsRosterTruncated ? "+" : ""}/${data.totalAgents ?? 0}` : "—"}</span>
          </div>
          {data?.generatedAt ? <p className="mb-3 text-xs text-muted-foreground">{td("dashboardSnapshotAt", { time: formatDateTime(data.generatedAt, locale, { timeStyle: "short", timeZone: data.timezone }) })}</p> : null}
          {data?.gpsRosterTruncated ? <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">{td("gpsRosterLimited")}</p> : null}
          {!data ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">{loading ? td("loading") : "—"}</div>
          ) : data.activeAgentsList?.length > 0 ? (
            <div className="space-y-2.5">
              {data.activeAgentsList.slice(0, 5).map((agent: any) => (
                <div key={agent.id} className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">{agent.name?.charAt(0)?.toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <Wifi className="h-3.5 w-3.5 text-green-600" />
                      {agent.name}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{agent.lastSeen ? td("lastGpsAt", { time: formatDateTime(agent.lastSeen, locale, { timeStyle: "short", timeZone: data.timezone }) }) : "—"}</div>
                  </div>
                  <span className="text-xs text-muted-foreground">{agent.speed != null ? `${agent.speed.toFixed(0)} km/h` : "—"}</span>
                </div>
              ))}
              <Link href="/mtm/map"><Button variant="outline" size="sm" className="w-full mt-1"><Navigation className="h-3 w-3 mr-1" /> {td("showOnMap")}</Button></Link>
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">{td("noAgentsOnline")}</div>
          )}
        </div>
      </div>

      {/* Recent Visits */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-cyan-500" /> {td("recentVisits")}</h3>
        {loading || !data ? (
          <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">{loading ? td("loading") : "—"}</div>
        ) : data?.recentVisits && data.recentVisits.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-2 font-medium">{td("colAgent")}</th><th className="pb-2 font-medium">{td("colCustomer")}</th><th className="pb-2 font-medium">{td("colStatus")}</th><th className="pb-2 font-medium">{td("colCheckIn")}</th><th className="pb-2 font-medium">{td("colDuration")}</th></tr></thead>
              <tbody>
                {data.recentVisits.map((v: any) => (
                  <tr key={v.id} className="border-b last:border-0">
                    <td className="py-2">{v.agent}</td>
                    <td className="py-2">{v.customer}</td>
                    <td className="py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${v.status === "CHECKED_OUT" ? "bg-green-100 text-green-700" : v.status === "CHECKED_IN" ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"}`}>{v.status === "CHECKED_OUT" ? td("visitStatus.checkedOut") : v.status === "CHECKED_IN" ? td("visitStatus.checkedIn") : v.status === "CANCELLED" ? td("visitStatus.cancelled") : td("visitStatus.other")}</span></td>
                    <td className="py-2 text-muted-foreground">{v.checkInAt ? formatDateTime(v.checkInAt, locale, { timeStyle: "short", timeZone: data.timezone }) : "—"}</td>
                    <td className="py-2 text-muted-foreground">{v.duration ? td("minutes", { n: v.duration }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">{td("noVisitsYet")}</div>
        )}
      </div>
        </div>
      </details>
    </div>
  )
}
