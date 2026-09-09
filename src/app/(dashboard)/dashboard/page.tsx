"use client"

import { useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import {
  DollarSign, Users, Handshake, TrendingUp, Ticket, Megaphone,
} from "lucide-react"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { useAutoTour } from "@/components/tour/tour-provider"
import { DashboardGrid } from "@/components/dashboard/dashboard-grid"
import { RisksBanner } from "@/components/dashboard/risks-banner"
import { SalesPipeline } from "@/components/dashboard/sales-pipeline"
import { RevenueTrend } from "@/components/dashboard/revenue-trend"
import { LeadSourcesDonut } from "@/components/dashboard/lead-sources-donut"
import { RecentDeals } from "@/components/dashboard/recent-deals"
import { AiLeadScoring } from "@/components/dashboard/ai-lead-scoring"
import { AiValueWidget } from "@/components/dashboard/ai-value-widget"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { CampaignStats } from "@/components/dashboard/campaign-stats"
import { UpcomingEvents } from "@/components/dashboard/upcoming-events"
import { WeeklyMetrics } from "@/components/dashboard/weekly-metrics"
import { SegmentsWidget } from "@/components/dashboard/segments-widget"
import { LoyaltyMetricWidget, type LoyaltyDashboardOverview } from "@/components/dashboard/loyalty-metric-widget"
import { QuickAccessStrip } from "@/components/dashboard/quick-access-strip"
import { DashboardWelcome } from "@/components/dashboard/dashboard-welcome"
import { resolveDashboardWidgets, type ResolvedDashboardWidget } from "@/lib/dashboard/resolve-widgets"
import { useDashboardHero } from "@/contexts/dashboard-hero-context"
import { resolveQuickActions } from "@/lib/dashboard/quick-actions"
import type { DashboardWidgetConfig } from "@/lib/dashboard/widget-registry"
import { hasModule } from "@/lib/modules"
import { orgFromSession } from "@/lib/nav-items"

type WidgetConfigMap = Record<string, Partial<DashboardWidgetConfig>>
type DashboardTranslator = (key: string, values?: Record<string, string | number>) => string
type FetchHeaders = Record<string, string>
type SessionUserWithDashboardScope = {
  organizationId?: string | number | null
  role?: string | null
}
type DashboardRisk = {
  severity: string
  titleKey?: string
  title?: string
  descKey?: string
  descParams?: Record<string, string | number>
  description?: string
  metric?: string
}
type DashboardData = {
  financial: { monthlyRevenue: number; marginPct: number }
  pipeline: {
    deals: number
    wonValue: number
    conversionRate: number
    recentDeals: Record<string, unknown>[]
  }
  leads: {
    activeCount: number
    total: number
    conversionRate: number
    bySource: Record<string, unknown>[]
    topScored: Record<string, unknown>[]
  }
  operations: { openTickets: number; slaBreached: number }
  activity: { recent: Record<string, unknown>[] }
  risks: DashboardRisk[]
  forecast: Record<string, unknown>[]
  campaigns?: Array<{ openRate?: number }>
  events: Record<string, unknown>[]
  weeklyMetrics: unknown
}
type DashboardApiResponse = { success?: boolean; data?: DashboardData }
type WidgetConfigApiResponse = { success?: boolean; data?: { widgets?: WidgetConfigMap; quickActions?: string[] } }

const EMPTY_DASHBOARD_DATA: DashboardData = {
  financial: { monthlyRevenue: 0, marginPct: 0 },
  pipeline: {
    deals: 0,
    wonValue: 0,
    conversionRate: 0,
    recentDeals: [],
  },
  leads: {
    activeCount: 0,
    total: 0,
    conversionRate: 0,
    bySource: [],
    topScored: [],
  },
  operations: { openTickets: 0, slaBreached: 0 },
  activity: { recent: [] },
  risks: [],
  forecast: [],
  campaigns: [],
  events: [],
  weeklyMetrics: null,
}

async function fetchJsonWithTimeout<T>(url: string, headers: FetchHeaders, timeoutMs = 12000): Promise<T | null> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    if (!response.ok) return null
    return await response.json() as T
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}

function fmt(n: number): string {
  if (n >= 1000000) return `${(n / 1000).toFixed(0)}K`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`.replace(".0K", "K")
  return n.toLocaleString("en", { maximumFractionDigits: 0 })
}

function KpiStrip({ data, t }: { data: DashboardData; t: DashboardTranslator }) {
  const { financial, pipeline, leads, operations, campaigns } = data
  const campaignCount = campaigns?.length ?? 0
  const firstCampaignOpenRate = campaigns?.[0]?.openRate ?? 0

  return (
    <div data-tour-id="dashboard-stats" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        title={t("kpiRevenue")}
        value={`₼${fmt(financial.monthlyRevenue)}`}
        sub={financial.marginPct > 0 ? `↗ +${financial.marginPct.toFixed(0)}%` : undefined}
        icon={<DollarSign className="h-5 w-5" />}
      />
      <KpiCard
        title={t("kpiLeads")}
        value={leads.activeCount || leads.total || 0}
        sub={leads.activeCount > 0 ? `↗ +${leads.activeCount}` : undefined}
        icon={<Users className="h-5 w-5" />}
      />
      <KpiCard
        title={t("kpiDeals")}
        value={pipeline.deals || 0}
        sub={`↗ ₼${fmt(pipeline.wonValue || 0)}`}
        icon={<Handshake className="h-5 w-5" />}
      />
      <KpiCard
        title={t("kpiConversion")}
        value={`${pipeline.conversionRate || leads.conversionRate || 0}%`}
        sub={pipeline.conversionRate > 0 ? `↗ +${(pipeline.conversionRate * 0.1).toFixed(1)}%` : undefined}
        icon={<TrendingUp className="h-5 w-5" />}
      />
      <KpiCard
        title={t("kpiTickets")}
        value={operations.openTickets || 0}
        sub={operations.slaBreached > 0 ? `↗ ${t("slaBreaches", { count: operations.slaBreached })}` : `↗ ${t("avgTime")}`}
        icon={<Ticket className="h-5 w-5" />}
      />
      <KpiCard
        title={t("kpiCampaigns")}
        value={campaignCount}
        sub={campaignCount > 0 ? `↗ ${t("openRateSub", { rate: firstCampaignOpenRate })}` : undefined}
        icon={<Megaphone className="h-5 w-5" />}
      />
    </div>
  )
}

export default function DashboardPage() {
  const { data: session, status: sessionStatus } = useSession()
  const scopedUser = session?.user as unknown as SessionUserWithDashboardScope | undefined
  const t = useTranslations("dashboard")
  const [data, setData] = useState<DashboardData | null>(null)
  const [loyaltyOverview, setLoyaltyOverview] = useState<LoyaltyDashboardOverview | null>(null)
  const [widgetConfig, setWidgetConfig] = useState<WidgetConfigMap | null>(null)
  const [quickActionHrefs, setQuickActionHrefs] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  useAutoTour("dashboard")
  const org = useMemo(() => orgFromSession(session?.user), [session?.user])

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      if (sessionStatus === "loading") return

      const orgId = scopedUser?.organizationId
      if (!orgId) {
        setLoading(false)
        return
      }

      setLoading(true)

      const headers = { "x-organization-id": String(orgId) }
      const canLoadLoyalty = org.role === "superadmin" || hasModule(org, "loyalty")
      const dashboardPromise = fetchJsonWithTimeout<DashboardApiResponse>("/api/v1/dashboard/executive", headers)
      const configPromise = fetchJsonWithTimeout<WidgetConfigApiResponse>("/api/v1/dashboard/widget-config", headers)
      const loyaltyPromise = canLoadLoyalty
        ? fetchJsonWithTimeout<LoyaltyDashboardOverview>("/api/v1/loyalty-overview", headers)
        : Promise.resolve(null)

      const [dashboardRes, configRes, loyaltyRes] = await Promise.all([dashboardPromise, configPromise, loyaltyPromise])
      if (cancelled) return

      setData(dashboardRes?.success && dashboardRes.data ? dashboardRes.data : EMPTY_DASHBOARD_DATA)
      setLoyaltyOverview(loyaltyRes)
      if (configRes?.success && configRes.data?.widgets) setWidgetConfig(configRes.data.widgets)
      if (configRes?.success && Array.isArray(configRes.data?.quickActions)) {
        setQuickActionHrefs(configRes.data.quickActions)
      }
      setLastUpdated(new Date())
      setLoading(false)
    }

    void loadDashboard()
    return () => { cancelled = true }
  }, [org, scopedUser?.organizationId, sessionStatus])

  function timeAgo(d: string): string {
    const diff = Date.now() - new Date(d).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 60) return t("minAgo", { m })
    const h = Math.floor(m / 60)
    if (h < 24) return t("hoursAgo", { h })
    return t("daysAgo", { d: Math.floor(h / 24) })
  }

  const widgets = useMemo(() => resolveDashboardWidgets({
    config: widgetConfig,
    role: scopedUser?.role || "viewer",
    org,
  }), [org, scopedUser?.role, widgetConfig])

  // The hero is two registry widgets rendered outside the grid: it is
  // full-bleed and owns the first screen, so it cannot sit in a bento cell.
  // Being in the registry is what puts it in /settings/dashboard, which is the
  // whole point — before this it was the one block nobody could switch off.
  const showGreeting = widgets.some((widget) => widget.id === "welcomeGreeting")
  const showBrief = widgets.some((widget) => widget.id === "welcomeBrief")
  const showQuickAccess = widgets.some((widget) => widget.id === "quickAccessStrip")

  // Resolved against this user's navigation, so an action for a module the
  // tenant no longer has drops out instead of rendering a link into a 403.
  const quickActions = useMemo(
    () => resolveQuickActions(quickActionHrefs, org),
    [org, quickActionHrefs],
  )

  // Tell the shell whether the hero is showing a Da Vinci field, so it can drop
  // its own duplicate entry points — or restore them when the greeting is off.
  const { setHeroCommandVisible } = useDashboardHero()
  useEffect(() => {
    setHeroCommandVisible(showGreeting && !loading)
    return () => setHeroCommandVisible(false)
  }, [loading, setHeroCommandVisible, showGreeting])

  if (loading) {
    return (
      <div className="space-y-6">
        <section className="dashboard-welcome dashboard-welcome--loading" aria-busy="true" aria-label={t("welcome.loading")}>
          <div className="dashboard-welcome-loading-main">
            <span className="dashboard-welcome-loading-line dashboard-welcome-loading-line--meta" />
            <span className="dashboard-welcome-loading-line dashboard-welcome-loading-line--title" />
            <span className="dashboard-welcome-loading-line dashboard-welcome-loading-line--copy" />
            <span className="dashboard-welcome-loading-line dashboard-welcome-loading-line--command" />
          </div>
          <div className="dashboard-welcome-loading-brief">
            <span />
            <span />
            <span />
            <span />
          </div>
        </section>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-56 bg-muted rounded-lg animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (!data) return <div className="py-20 text-center text-muted-foreground">{t("noData")}</div>

  const dashboardData = data
  const { pipeline, leads, activity, risks, forecast, campaigns, events, weeklyMetrics } = dashboardData
  const orgId = scopedUser?.organizationId == null ? undefined : String(scopedUser.organizationId)
  const visibleWidgets = widgets.filter((widget) => {
    // The hero halves and the shortcut row are drawn above the grid, not in it.
    if (widget.id === "welcomeGreeting" || widget.id === "welcomeBrief") return false
    if (widget.id === "quickAccessStrip") return false
    if (widget.id !== "risksBanner") return true
    return Array.isArray(risks) && risks.some((risk) => risk.severity === "critical" || risk.severity === "warning")
  })

  function renderWidget(widget: ResolvedDashboardWidget) {
    switch (widget.id) {
      case "statCards":
        return <KpiStrip data={dashboardData} t={t} />
      case "risksBanner":
        return risks ? <RisksBanner risks={risks} /> : null
      case "dealPipeline":
        return <div data-tour-id="dashboard-pipeline"><SalesPipeline pipeline={pipeline} /></div>
      case "revenueTrend":
        return <RevenueTrend forecast={forecast} />
      case "leadSources":
        return <LeadSourcesDonut leadsBySource={leads.bySource} totalLeads={leads.activeCount || leads.total || 0} />
      case "recentDeals":
        return <RecentDeals deals={pipeline.recentDeals} />
      case "aiLeadScoring":
        return <AiLeadScoring leads={leads.topScored} />
      case "activityFeed":
        return <div data-tour-id="dashboard-activity"><ActivityFeed activities={activity.recent} timeAgo={timeAgo} /></div>
      case "aiValueMonth":
        return <AiValueWidget orgId={orgId} />
      case "campaignStats":
        return <CampaignStats campaigns={campaigns ?? []} />
      case "upcomingEvents":
        return <UpcomingEvents events={events} />
      case "weeklyMetrics":
        return <WeeklyMetrics metrics={weeklyMetrics} />
      case "segments":
        return <SegmentsWidget orgId={orgId} />
      case "loyaltyMembers":
        return <LoyaltyMetricWidget kind="members" overview={loyaltyOverview} />
      case "loyaltyPoints30d":
        return <LoyaltyMetricWidget kind="points30d" overview={loyaltyOverview} />
      case "loyaltyRedemptions30d":
        return <LoyaltyMetricWidget kind="redemptions30d" overview={loyaltyOverview} />
      default:
        return null
    }
  }

  return (
    <div className="dashboard-bento space-y-5">
      {/* Help and the tour replay are rendered by the header, right after
          "All apps" — see src/components/header.tsx. They used to sit at the
          end of the shortcut row below, which is in normal page flow, so at
          the right scroll position they ended up underneath the floating voice
          orb that is fixed to the bottom right corner. */}
      <DashboardWelcome
        userName={session?.user?.name}
        lastUpdated={lastUpdated ?? new Date()}
        data={dashboardData}
        showGreeting={showGreeting}
        showBrief={showBrief}
        quickActions={quickActions}
      />

      {showQuickAccess ? (
        <div className="dashboard-welcome-tools">
          <QuickAccessStrip />
        </div>
      ) : null}

      <DashboardGrid widgets={visibleWidgets} renderWidget={renderWidget} />
    </div>
  )
}
