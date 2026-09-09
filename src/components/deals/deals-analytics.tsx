"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { MiniLineChart, MiniDonut } from "@/components/charts/mini-charts"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Trophy,
  Percent,
  Clock,
  BarChart3,
  Brain,
  Phone,
  Mail,
  Users,
  Calendar,
  Shield,
  Zap,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  Package,
  ChevronRight,
  Activity,
} from "lucide-react"

// ── Types ───────────────────────────────────────────────────────────────

interface Deal {
  id: string
  title: string
  value: number
  stage: string
  probability?: number
  company?: { name: string }
  contact?: { name: string }
  expectedCloseDate?: string
  createdAt: string
}

interface DealsAnalyticsProps {
  deals: Deal[]
  pipelineValue: number
  wonValue: number
  lostCount: number
  wonCount: number
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

// ── Stage definitions ───────────────────────────────────────────────────

const STAGE_MAP: Record<string, { label: string; color: string; bgColor: string }> = {
  LEAD: { label: "Lid", color: "bg-blue-500", bgColor: "bg-blue-500/20" },
  QUALIFIED: { label: "Kvalifikasiya", color: "bg-amber-500", bgColor: "bg-amber-500/20" },
  PROPOSAL: { label: "T\u0259klif", color: "bg-violet-500", bgColor: "bg-violet-500/20" },
  NEGOTIATION: { label: "Dan\u0131\u015F\u0131qlar", color: "bg-orange-500", bgColor: "bg-orange-500/20" },
  WON: { label: "Qazan\u0131ld\u0131", color: "bg-emerald-500", bgColor: "bg-emerald-500/20" },
  LOST: { label: "\u0130tirildi", color: "bg-red-500", bgColor: "bg-red-500/20" },
}

// ── Mock data ───────────────────────────────────────────────────────────

const MOCK_COMPETITORS = [
  { name: "TechStar Solutions", deals: 5, threat: "high" as const },
  { name: "Digital Wave", deals: 3, threat: "medium" as const },
  { name: "CloudBase Inc.", deals: 2, threat: "low" as const },
  { name: "NextGen IT", deals: 4, threat: "high" as const },
]

const MOCK_CONTACT_ROLES = [
  { roleKey: "decisionMaker", count: 8 },
  { roleKey: "influencer", count: 12 },
  { roleKey: "user", count: 6 },
]

const MOCK_NEXT_STEPS = [
  { task: "TechStar demo", date: "5 Apr", priority: "high" as const },
  { task: "Price proposal", date: "7 Apr", priority: "medium" as const },
  { task: "Contract draft", date: "8 Apr", priority: "high" as const },
  { task: "Follow-up call", date: "10 Apr", priority: "low" as const },
]

const MOCK_RECENT_ACTIVITY = [
  { type: "call" as const, textKey: "callLog", timeKey: "timeAgo2h" },
  { type: "email" as const, textKey: "emailSent", timeKey: "timeAgo5h" },
  { type: "meeting" as const, textKey: "meetingDone", timeKey: "timeAgoYesterday" },
]

const MOCK_NBO = [
  { name: "Enterprise CRM Paket", match: 92 },
  { name: "AI Analitika Modul", match: 87 },
  { name: "M\u00FC\u015Ft\u0259ri Portal\u0131", match: 78 },
  { name: "Email Marketinq", match: 65 },
]

const FORECAST_DATA_EMPTY = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

const THREAT_COLORS: Record<string, string> = {
  high: "bg-red-500/15 text-red-500",
  medium: "bg-amber-500/15 text-amber-500",
  low: "bg-emerald-500/15 text-emerald-500",
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-blue-500/15 text-blue-400",
}

// ── Component ───────────────────────────────────────────────────────────

export function DealsAnalytics({ deals, pipelineValue, wonValue, lostCount, wonCount }: DealsAnalyticsProps) {
  const t = useTranslations("dealsAnalytics")
  const months = t("monthsShort").split(",")
  const analytics = useMemo(() => {
    /*
     * Стадия сворачивается к смыслу: CLOSED_WON — это выигрыш, а не «в работе».
     * Компонент клиентский, поэтому берётся чистая функция без обращений к базе;
     * собственные названия стадий организации ей неизвестны, но CLOSED_WON и
     * прочие известные написания она закрывает.
     */
    const canon = (stage: string) => canonicalDealStage(stage)
    const activeDeals = deals.filter((d) => canon(d.stage) !== "WON" && canon(d.stage) !== "LOST")
    const totalClosed = wonCount + lostCount
    const conversionRate = totalClosed > 0 ? (wonCount / totalClosed) * 100 : 0

    // Average deal cycle (days from created to now for active, or expected close)
    const cycleDays = deals
      .filter((d) => canon(d.stage) === "WON" || d.expectedCloseDate)
      .map((d) => daysBetween(d.createdAt, d.expectedCloseDate || new Date().toISOString()))
    const avgCycle = cycleDays.length > 0 ? Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) : 0
    const fastestCycle = cycleDays.length > 0 ? Math.min(...cycleDays) : 0
    const slowestCycle = cycleDays.length > 0 ? Math.max(...cycleDays) : 0

    const avgValue = deals.length > 0 ? deals.reduce((s, d) => s + d.value, 0) / deals.length : 0

    // Stage breakdown
    const stageGroups: Record<string, { count: number; value: number }> = {}
    for (const d of deals) {
      // Группировка по канону, иначе CLOSED_WON рисуется отдельной колонкой и
      // строка «Qazanıldı» недосчитывает сумму.
      const stage = canon(d.stage)
      if (!stageGroups[stage]) stageGroups[stage] = { count: 0, value: 0 }
      stageGroups[stage].count++
      stageGroups[stage].value += d.value
    }

    // AI forecast value
    const forecastValue = activeDeals.reduce((s, d) => s + d.value * ((d.probability ?? 50) / 100), 0)

    // Top deals by probability for AI section
    const topDeals = [...activeDeals]
      .sort((a, b) => (b.probability ?? 50) - (a.probability ?? 50))
      .slice(0, 5)

    return {
      activeDeals,
      conversionRate,
      avgCycle,
      fastestCycle,
      slowestCycle,
      avgValue,
      stageGroups,
      forecastValue,
      topDeals,
      totalDeals: deals.length,
    }
  }, [deals, wonCount, lostCount])

  // ── KPI Row ─────────────────────────────────────────────────────────

  const kpis = [
    {
      label: t("pipelineValue"),
      value: fmtCurrency(pipelineValue),
      change: pipelineValue > 0 ? "+22%" : null,
      up: true,
      icon: DollarSign,
      iconBg: "bg-violet-500/15 text-violet-500",
    },
    {
      label: t("won"),
      value: fmtCurrency(wonValue),
      sub: `${wonCount} ${t("deals")}`,
      change: null,
      up: true,
      icon: Trophy,
      iconBg: "bg-emerald-500/15 text-emerald-500",
    },
    {
      label: t("conversion"),
      value: `${analytics.conversionRate.toFixed(1)}%`,
      change: analytics.conversionRate > 0 ? "+5.1%" : null,
      up: true,
      icon: Percent,
      iconBg: "bg-blue-500/15 text-blue-500",
    },
    {
      label: t("avgCycle"),
      value: `${analytics.avgCycle} ${t("days")}`,
      change: analytics.avgCycle > 0 ? `-3 ${t("days")}` : null,
      up: true,
      icon: Clock,
      iconBg: "bg-amber-500/15 text-amber-500",
    },
    {
      label: t("avgValue"),
      value: fmtCurrency(analytics.avgValue),
      change: analytics.avgValue > 0 ? "+8%" : null,
      up: true,
      icon: BarChart3,
      iconBg: "bg-cyan-500/15 text-cyan-500",
    },
    {
      label: t("aiForecast"),
      value: fmtCurrency(analytics.forecastValue),
      change: null,
      up: true,
      icon: Brain,
      iconBg: "bg-fuchsia-500/15 text-fuchsia-500",
    },
  ]

  // ── Stage bars for pipeline kanban ────────────────────────────────

  const stageOrder = ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON"]
  const maxStageValue = Math.max(
    ...stageOrder.map((s) => analytics.stageGroups[s]?.value ?? 0),
    1
  )

  // Win/Loss donut segments
  const ongoing = analytics.activeDeals.length
  const totalWLO = wonCount + lostCount + ongoing || 1
  const donutSegments = [
    { pct: (wonCount / totalWLO) * 100, color: "#10b981" },
    { pct: (lostCount / totalWLO) * 100, color: "#ef4444" },
    { pct: (ongoing / totalWLO) * 100, color: "#6366f1" },
  ]

  return (
    <div className="space-y-4">
      {/* ── KPI Row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{kpi.label}</span>
              <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", kpi.iconBg)}>
                <kpi.icon className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-xl font-bold">{kpi.value}</div>
            <div className="flex items-center gap-1.5">
              {kpi.change && (
                <span className={cn("flex items-center text-xs font-medium", kpi.up ? "text-emerald-500" : "text-red-500")}>
                  {kpi.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {kpi.change}
                </span>
              )}
              {kpi.sub && <span className="text-xs text-muted-foreground">{kpi.sub}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Row 1 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pipeline Kanban */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">{t("pipelineKanban")}</h3>
            <span className="text-xs text-muted-foreground">{analytics.totalDeals} {t("deals")}</span>
          </div>
          <div className="space-y-2.5">
            {stageOrder.map((stage) => {
              const info = STAGE_MAP[stage]
              const group = analytics.stageGroups[stage]
              const val = group?.value ?? 0
              const count = group?.count ?? 0
              const pct = maxStageValue > 0 ? (val / maxStageValue) * 100 : 0
              return (
                <div key={stage} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{info?.label ?? stage}</span>
                    <span className="font-medium">
                      {fmtCurrency(val)}{" "}
                      <span className="text-muted-foreground">({count})</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", info?.color ?? "bg-muted-foreground/40")}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          {/* Stacked overview bar */}
          <div className="mt-4 flex h-3 rounded-full overflow-hidden bg-muted/30">
            {stageOrder.map((stage) => {
              const group = analytics.stageGroups[stage]
              const val = group?.value ?? 0
              const pct = pipelineValue > 0 ? (val / pipelineValue) * 100 : 0
              const info = STAGE_MAP[stage]
              return (
                <div
                  key={stage}
                  className={cn("h-full first:rounded-l-full last:rounded-r-full", info?.color)}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                  title={`${info?.label}: ${fmtCurrency(val)}`}
                />
              )
            })}
          </div>
        </div>

        {/* Revenue Forecast */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold">{t("revenueForecast")}</h3>
            <Sparkles className="w-4 h-4 text-fuchsia-400" />
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {t("expectedForecast")}{" "}
            <span className="font-semibold text-foreground">{fmtCurrency(analytics.forecastValue)}</span>
          </p>
          <div className="mb-3">
            <MiniLineChart data={deals.length > 0 ? deals.slice(-12).map(d => d.value) : FORECAST_DATA_EMPTY} color="stroke-fuchsia-400" />
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {months.map((m, i) => (
                <span key={m} className={cn("flex-1 text-center", i > 8 && "text-fuchsia-400/60")}>
                  {i % 3 === 0 ? m : ""}
                </span>
              )
            )}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold">{fmtCurrency(pipelineValue)}</div>
              <div className="text-[10px] text-muted-foreground">{t("current")}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-fuchsia-400">{fmtCurrency(analytics.forecastValue)}</div>
              <div className="text-[10px] text-muted-foreground">{t("forecast")}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-emerald-400">{pipelineValue > 0 ? `+${Math.round(((analytics.forecastValue - pipelineValue) / pipelineValue) * 100)}%` : "0%"}</div>
              <div className="text-[10px] text-muted-foreground">{t("growth")}</div>
            </div>
          </div>
        </div>

        {/* Win/Loss */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <h3 className="text-sm font-semibold mb-4">{t("winLoss")}</h3>
          <div className="flex items-center gap-5">
            <MiniDonut segments={donutSegments} size={80} />
            <div className="space-y-2 flex-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">{t("wonLabel")}</span>
                <span className="ml-auto font-semibold">{wonCount}</span>
                <span className="text-xs text-muted-foreground">
                  ({totalWLO > 0 ? Math.round((wonCount / totalWLO) * 100) : 0}%)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span className="text-muted-foreground">{t("lostLabel")}</span>
                <span className="ml-auto font-semibold">{lostCount}</span>
                <span className="text-xs text-muted-foreground">
                  ({totalWLO > 0 ? Math.round((lostCount / totalWLO) * 100) : 0}%)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <span className="text-muted-foreground">{t("ongoing")}</span>
                <span className="ml-auto font-semibold">{ongoing}</span>
              </div>
            </div>
          </div>
          {lostCount > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <span className="text-red-400 font-medium">{t("lossReason")}</span>
                <span className="text-muted-foreground">{t("lossReasonPrice")}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Contact Activity */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <h3 className="text-sm font-semibold mb-4">{t("contactActivity")}</h3>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { icon: Phone, label: t("calls"), value: 0, color: "text-blue-400 bg-blue-500/15" },
              { icon: Mail, label: t("emails"), value: 0, color: "text-emerald-400 bg-emerald-500/15" },
              { icon: Users, label: t("meetings"), value: 0, color: "text-violet-400 bg-violet-500/15" },
            ].map((item, i) => (
              <div key={i} className="text-center">
                <div className={cn("w-10 h-10 rounded-lg mx-auto flex items-center justify-center mb-1.5", item.color.split(" ")[1])}>
                  <item.icon className={cn("w-4.5 h-4.5", item.color.split(" ")[0])} />
                </div>
                <div className="text-lg font-bold">{item.value}</div>
                <div className="text-[10px] text-muted-foreground">
                  {i === 0 ? t("calls") : i === 1 ? t("emails") : t("meetings")}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2.5">
            {MOCK_RECENT_ACTIVITY.map((a, i) => (
              <div key={i} className="flex items-center gap-2.5 text-xs">
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center",
                  a.type === "call" ? "bg-blue-500/15" : a.type === "email" ? "bg-emerald-500/15" : "bg-violet-500/15"
                )}>
                  {a.type === "call" ? (
                    <Phone className="w-3 h-3 text-blue-400" />
                  ) : a.type === "email" ? (
                    <Mail className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Users className="w-3 h-3 text-violet-400" />
                  )}
                </div>
                <span className="flex-1 truncate">{t(a.textKey as any)}</span>
                <span className="text-muted-foreground whitespace-nowrap">{t(a.timeKey as any)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Da Vinci AI Forecast */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-4 h-4 text-fuchsia-400" />
            <h3 className="text-base font-semibold">{t("aiPredict")}</h3>
          </div>
          <div className="space-y-3">
            {analytics.topDeals.length > 0 ? (
              analytics.topDeals.map((deal) => (
                <div key={deal.id} className="flex items-center gap-3 group">
                  <div className="relative w-10 h-10 flex-shrink-0">
                    <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                      <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="4" />
                      <circle
                        cx="18" cy="18" r="14" fill="none"
                        className={cn(
                          (deal.probability ?? 50) >= 70 ? "stroke-emerald-400" :
                          (deal.probability ?? 50) >= 40 ? "stroke-amber-400" : "stroke-red-400"
                        )}
                        strokeWidth="4"
                        strokeDasharray={`${((deal.probability ?? 50) / 100) * 88} 88`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                      {deal.probability ?? 50}%
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{deal.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {deal.company?.name ?? "N/A"} &middot; {fmtCurrency(deal.value)}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              ))
            ) : (
              [
                { titleKey: "demoErp", company: "AzTech", value: 45000, prob: 85 },
                { titleKey: "demoCrm", company: "BakuSoft", value: 32000, prob: 72 },
                { titleKey: "demoCloud", company: "Caspian IT", value: 28000, prob: 60 },
                { titleKey: "demoMobile", company: "DigiWave", value: 18000, prob: 45 },
                { titleKey: "demoCyber", company: "ShieldTech", value: 15000, prob: 35 },
              ].map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="relative w-10 h-10 flex-shrink-0">
                    <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                      <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="4" />
                      <circle
                        cx="18" cy="18" r="14" fill="none"
                        className={cn(
                          d.prob >= 70 ? "stroke-emerald-400" : d.prob >= 40 ? "stroke-amber-400" : "stroke-red-400"
                        )}
                        strokeWidth="4"
                        strokeDasharray={`${(d.prob / 100) * 88} 88`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                      {d.prob}%
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t(d.titleKey)}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.company} &middot; {fmtCurrency(d.value)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Competitor Analysis */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold">{t("competitorAnalysis")}</h3>
          </div>
          <div className="space-y-2 mb-5">
            {MOCK_COMPETITORS.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <span className="text-muted-foreground">{c.deals} {t("deals")}</span>
                <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium", THREAT_COLORS[c.threat])}>
                  {t(c.threat as any)}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t pt-3">
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">{t("contactRoles")}</h4>
            <div className="flex gap-2">
              {MOCK_CONTACT_ROLES.map((r, i) => (
                <div key={i} className="flex-1 text-center p-2 rounded-lg bg-muted/40">
                  <div className="text-sm font-bold">{r.count}</div>
                  <div className="text-[10px] text-muted-foreground">{t(r.roleKey as any)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 3 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Deal Velocity */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">{t("dealVelocity")}</h3>
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-full">
              <TrendingUp className="w-3 h-3" />
              15%
            </span>
          </div>
          <div className="space-y-4">
            {[
              { label: t("avgCycleLabel"), value: `${analytics.avgCycle} ${t("days")}`, pct: (analytics.avgCycle / (analytics.slowestCycle || 45)) * 100, color: "bg-blue-500" },
              { label: t("fastest"), value: `${analytics.fastestCycle} ${t("days")}`, pct: (analytics.fastestCycle / (analytics.slowestCycle || 45)) * 100, color: "bg-emerald-500" },
              { label: t("slowest"), value: `${analytics.slowestCycle} ${t("days")}`, pct: 100, color: "bg-red-500" },
            ].map((item, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">
                    {i === 0 ? t("avgCycleLabel") : i === 1 ? t("fastest") : t("slowest")}
                  </span>
                  <span className="font-medium">{item.value}</span>
                </div>
                <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", item.color)}
                    style={{ width: `${Math.max(item.pct, 5)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center gap-2 text-xs">
              <Activity className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-blue-400 font-medium">{t("trend")}</span>
              <span className="text-muted-foreground">{t("trendText")}</span>
            </div>
          </div>
        </div>

        {/* Next Steps */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold">{t("nextSteps")}</h3>
          </div>
          <div className="space-y-2.5">
            {MOCK_NEXT_STEPS.map((step, i) => (
              <div key={i} className="flex items-start gap-2.5 text-xs group">
                <div className="mt-0.5 w-5 h-5 rounded-md border border-muted-foreground/30 flex items-center justify-center flex-shrink-0 group-hover:border-primary transition-colors">
                  <CheckCircle2 className="w-3 h-3 text-muted-foreground/40" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{step.task}</div>
                  <div className="text-muted-foreground mt-0.5 flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    {step.date}
                  </div>
                </div>
                <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0", PRIORITY_COLORS[step.priority])}>
                  {t(step.priority as any)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Next Best Offers */}
        <div className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold">{t("nextBestOffers")}</h3>
          </div>
          <div className="space-y-3">
            {MOCK_NBO.map((offer, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="relative w-10 h-10 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="14" fill="none"
                      className={cn(
                        offer.match >= 85 ? "stroke-emerald-400" :
                        offer.match >= 70 ? "stroke-cyan-400" : "stroke-amber-400"
                      )}
                      strokeWidth="3"
                      strokeDasharray={`${(offer.match / 100) * 88} 88`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold">
                    {offer.match}%
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{offer.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {t("matchLabel")} {offer.match >= 85 ? t("matchVeryHigh") : offer.match >= 70 ? t("matchHigh") : t("matchMedium")}
                  </div>
                </div>
                <Zap className={cn(
                  "w-3.5 h-3.5 flex-shrink-0",
                  offer.match >= 85 ? "text-emerald-400" : offer.match >= 70 ? "text-cyan-400" : "text-amber-400"
                )} />
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <div className="flex items-center gap-2 text-xs">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-cyan-400 font-medium">{t("aiSuggestion")}</span>
              <span className="text-muted-foreground">{t("aiSuggestionText")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
