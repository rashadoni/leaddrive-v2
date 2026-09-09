"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import {
  DollarSign, Users, Handshake, TrendingUp, Ticket, Megaphone,
} from "lucide-react"
import { formatDate } from "@/lib/format-date"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { RisksBanner } from "@/components/dashboard/risks-banner"
import { SalesPipeline } from "@/components/dashboard/sales-pipeline"
import { RevenueTrend } from "@/components/dashboard/revenue-trend"
import { LeadSourcesDonut } from "@/components/dashboard/lead-sources-donut"
import { RecentDeals } from "@/components/dashboard/recent-deals"
import { AiLeadScoring } from "@/components/dashboard/ai-lead-scoring"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { CampaignStats } from "@/components/dashboard/campaign-stats"
import { UpcomingEvents } from "@/components/dashboard/upcoming-events"
import { WeeklyMetrics } from "@/components/dashboard/weekly-metrics"
import { ChurnRiskWidget } from "@/components/dashboard/churn-risk-widget"
import { RecommendedActions } from "@/components/dashboard/recommended-actions"
import { HelpButton } from "@/components/help/help-button"

function fmt(n: number): string {
  if (n >= 1000000) return `${(n / 1000).toFixed(0)}K`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`.replace(".0K", "K")
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export default function DashboardPage() {
  const { data: session } = useSession()
  const t = useTranslations("dashboard")
  const tc = useTranslations("common")
  const te = useTranslations("engagement")
  const locale = useLocale()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [widgets, setWidgets] = useState<Record<string, boolean>>({})
  const [widgetsLoaded, setWidgetsLoaded] = useState(false)

  useEffect(() => {
    const orgId = session?.user?.organizationId
    const userRole = (session?.user as any)?.role || "viewer"
    if (!orgId) return
    fetch("/api/v1/dashboard/widget-config", {
      headers: { "x-organization-id": String(orgId) },
    })
      .then(r => r.json())
      .then(j => {
        const defaults: Record<string, boolean> = {
          statCards: true, dealPipeline: true, revenueTrend: true, leadSources: true,
          recentDeals: true, aiLeadScoring: true, activityFeed: true,
          campaignStats: true, upcomingEvents: true, weeklyMetrics: true,
          recommendedActions: true, churnRisk: true,
        }
        if (j.success && j.data?.widgets) {
          for (const [key, val] of Object.entries(j.data.widgets) as [string, any][]) {
            defaults[key] = val.enabled && (val.roles?.length === 0 || val.roles?.includes(userRole))
          }
        }
        setWidgets(defaults)
        setWidgetsLoaded(true)
      })
      .catch(() => { setWidgetsLoaded(true) })
  }, [session])

  function timeAgo(d: string): string {
    const diff = Date.now() - new Date(d).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 60) return t("minAgo", { m })
    const h = Math.floor(m / 60)
    if (h < 24) return t("hoursAgo", { h })
    return t("daysAgo", { d: Math.floor(h / 24) })
  }

  function getGreeting(): string {
    const h = new Date().getHours()
    if (h < 12) return t("greeting.morning")
    if (h < 18) return t("greeting.afternoon")
    return t("greeting.evening")
  }

  useEffect(() => {
    async function load() {
      try {
        const orgId = session?.user?.organizationId
        const res = await fetch("/api/v1/dashboard/executive", {
          headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
        })
        const json = await res.json()
        if (json.success) setData(json.data)
      } catch (err) { console.error(err) } finally { setLoading(false) }
    }
    load()
  }, [session])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-56 bg-muted rounded-lg animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (!data || !widgetsLoaded) return <div className="py-20 text-center text-muted-foreground">{t("noData")}</div>

  const { financial, pipeline, leads, operations, activity, risks, forecast, campaigns, events, weeklyMetrics } = data

  return (
    <div className="space-y-6">
      {/* ═══ Header ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">{t("title")} <HelpButton slug="crm-dashboard" variant="label" /></h1>
          <p className="text-xs text-muted-foreground">
            {formatDate(new Date(), locale, { day: "numeric", month: "long", year: "numeric", weekday: "long" })}
            {" · "}{t("lastUpdated")}: {new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>

      {/* ═══ Row 1: 6 KPIs ═══ */}
      {widgets.statCards && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            title={t("kpiRevenue")}
            value={`₼${fmt(financial.monthlyRevenue)}`}
            sub={financial.marginPct > 0 ? `↗ +${financial.marginPct.toFixed(0)}%` : undefined}
            icon={<DollarSign className="h-5 w-5" />}
            color="#22c55e"
          />
          <KpiCard
            title={t("kpiLeads")}
            value={leads.activeCount || leads.total || 0}
            sub={leads.activeCount > 0 ? `↗ +${leads.activeCount}` : undefined}
            icon={<Users className="h-5 w-5" />}
            color="#8b5cf6"
          />
          <KpiCard
            title={t("kpiDeals")}
            value={pipeline.deals || 0}
            sub={`↗ ₼${fmt(pipeline.wonValue || 0)}`}
            icon={<Handshake className="h-5 w-5" />}
            color="#3b82f6"
          />
          <KpiCard
            title={t("kpiConversion")}
            value={`${pipeline.conversionRate || leads.conversionRate || 0}%`}
            sub={pipeline.conversionRate > 0 ? `↗ +${(pipeline.conversionRate * 0.1).toFixed(1)}%` : undefined}
            icon={<TrendingUp className="h-5 w-5" />}
            color="#f59e0b"
          />
          <KpiCard
            title={t("kpiTickets")}
            value={operations.openTickets || 0}
            sub={operations.slaBreached > 0 ? `↗ ${operations.slaBreached} SLA` : `↗ ${t("avgTime")}`}
            icon={<Ticket className="h-5 w-5" />}
            color="#06b6d4"
          />
          <KpiCard
            title={t("kpiCampaigns")}
            value={campaigns?.length || 0}
            sub={campaigns?.length > 0 ? `↗ ${campaigns[0]?.openRate || 0}% ${t("openRate")}` : undefined}
            icon={<Megaphone className="h-5 w-5" />}
            color="#ec4899"
          />
        </div>
      )}

      {/* ═══ Risks Banner ═══ */}
      {risks && <RisksBanner risks={risks} />}

      {/* ═══ Row 2: Pipeline + Revenue Trend + Lead Sources ═══ */}
      <div className="grid lg:grid-cols-3 gap-4">
        {widgets.dealPipeline && <SalesPipeline pipeline={pipeline} />}
        {widgets.revenueTrend && <RevenueTrend forecast={forecast} />}
        {widgets.leadSources && <LeadSourcesDonut leadsBySource={leads.bySource} totalLeads={leads.activeCount || leads.total || 0} />}
      </div>

      {/* ═══ Row 3: Recent Deals + Da Vinci Lead Scoring + Activity Feed ═══ */}
      <div className="grid lg:grid-cols-3 gap-4">
        {widgets.recentDeals && <RecentDeals deals={pipeline.recentDeals} />}
        {widgets.aiLeadScoring && <AiLeadScoring leads={leads.topScored} />}
        {widgets.activityFeed && <ActivityFeed activities={activity.recent} timeAgo={timeAgo} />}
      </div>

      {/* ═══ Row 4: Campaigns + Events + Weekly Metrics ═══ */}
      <div className="grid lg:grid-cols-3 gap-4">
        {widgets.campaignStats && <CampaignStats campaigns={campaigns} />}
        {widgets.upcomingEvents && <UpcomingEvents events={events} />}
        {widgets.weeklyMetrics && <WeeklyMetrics metrics={weeklyMetrics} />}
      </div>

      {/* ═══ Row 5: AI Insights ═══ */}
      <div className="grid lg:grid-cols-3 gap-4">
        {widgets.recommendedActions && <RecommendedActions />}
        {widgets.churnRisk && <ChurnRiskWidget />}
        {/* Engagement Overview */}
        {data && (
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 bg-card">
            <h3 className="text-sm font-semibold mb-3">{te("title")}</h3>
            {(() => {
              const hot = data.engagementHot ?? 0
              const warm = data.engagementWarm ?? 0
              const cold = data.engagementCold ?? 0
              const total = hot + warm + cold
              if (total === 0) return <p className="text-xs text-muted-foreground">{te("noData")}</p>
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-12 text-muted-foreground">{te("hot")}</span>
                    <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-red-500 rounded-full" style={{ width: `${total > 0 ? (hot / total * 100) : 0}%` }} />
                    </div>
                    <span className="text-xs font-medium w-10 text-right">{hot}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-12 text-muted-foreground">{te("warm")}</span>
                    <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full" style={{ width: `${total > 0 ? (warm / total * 100) : 0}%` }} />
                    </div>
                    <span className="text-xs font-medium w-10 text-right">{warm}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-12 text-muted-foreground">{te("cold")}</span>
                    <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${total > 0 ? (cold / total * 100) : 0}%` }} />
                    </div>
                    <span className="text-xs font-medium w-10 text-right">{cold}</span>
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
