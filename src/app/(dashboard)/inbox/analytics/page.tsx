"use client"

/**
 * Inbox analytics — the expanded omni-channel report. Message volume + per-channel split,
 * conversation status + per-channel breakdown + avg lifetime, FRT + SLA + distribution + backlog
 * aging, per-agent performance, and temporal patterns (busiest-hours heatmap + daily trend).
 * Read-only; all data from the org-scoped GET /api/v1/inbox/analytics(/frt|/team|/temporal).
 * Filters: date range, channel, agent.
 *
 * NOTE: this page IS already linked in the sidebar (nav-items.ts → "inboxAnalyticsNav", omnichannel
 * group) — it is visible to omnichannel tenants the moment this deploys, so any change here must be
 * verified on prod right after deploy (there is no unlinked-draft buffer).
 */
import { useState, useEffect, useMemo, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import {
  Loader2, ArrowDownLeft, ArrowUpRight, MessageSquare, BarChart3, Users, Clock, Gauge, Timer, Inbox,
  Download, X, TrendingUp, TrendingDown, ArrowRight, PhoneCall,
} from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { ChannelIcon, channelLabel, channelColor } from "@/lib/inbox-channels"
import { HelpButton } from "@/components/help/help-button"
import {
  pct, channelAiTrend, type InboxAnalytics, type FrtStats, type AgentPerformance,
  type SlaDistribution, type BacklogAging, type PlatformStat,
} from "@/lib/inbox-analytics"
import { buildAnalyticsCsv } from "@/lib/inbox-analytics-csv"

type CustomerSegmentKey = "interested" | "potential" | "marketing_contacted" | "sales_contacted" | "unable_to_contact" | "sold" | "not_sold" | "no_result" | "unclassified"
type SalesHandoffStage = Exclude<CustomerSegmentKey, "marketing_contacted" | "unclassified">
type AnalyticsPayload = InboxAnalytics & {
  byPlatform: PlatformStat[]
  avgLifetimeHours: number | null
  customerSegments?: { key: CustomerSegmentKey; count: number }[]
  managerSegments?: {
    agentId: string | null
    agentName: string
    segments: Partial<Record<CustomerSegmentKey, number>>
    createdDeals: number
    wonDeals: number
  }[]
  messageStatuses?: { status: string; inbound: number; outbound: number; total: number }[]
}
type HandoffPayload = {
  totals: {
    marketingContacted: number
    leadsCreated: number
    salesReported: number
    awaitingSalesReport: number
    sold: number
    marketingToLeadRate: number | null
    salesReportRate: number | null
    soldRate: number | null
  }
  marketing: {
    agentId: string | null
    agentName: string | null
    conversationsContacted: number
    leadsCreated: number
  }[]
  sellers: {
    agentId: string | null
    agentName: string | null
    assignedLeads: number
    reported: number
    awaiting: number
    outcomes: Partial<Record<SalesHandoffStage, number>>
  }[]
}
// FRT is fully SQL-aggregated since slice 3 — no caps; aging carries the bad-date exclusion count.
type FrtPayload = FrtStats & {
  sla: SlaDistribution
  aging: BacklogAging & { excludedBadDates?: number }
}
type TeamPayload = { agents: AgentPerformance[]; cap: number; capped: boolean }
type DrillRow = {
  id: string; contactName: string; channel: string; status: string
  lastMessageAt: string; ageHours: number; agentName: string | null; unreadCount: number
}
type DrillState = { title: string; loading: boolean; rows: DrillRow[]; truncated: boolean } | null
const AGE_BUCKET_KEYS = ["lt1h", "h1to4", "h4to24", "gt24h"] as const
// Same order as the /frt distribution labels — clicking bar i drills FRT_BUCKET_KEYS[i] (slice 4).
const FRT_BUCKET_KEYS = ["lt5m", "m5to15", "m15to30", "m30to60", "gt60m"] as const
type TemporalPayload = { heatmap: number[][]; trend: { date: string; inbound: number; outbound: number }[] }
// B2 (Creatio 10X roadmap) — per-channel AI effectiveness from GET /inbox/stats/channels.
type ChannelEffRow = {
  channel: string
  volume: number
  avgFirstResponseMinutes: number | null
  resolved: number
  aiResolved: number
  aiEffectivenessPct: number | null
  escalated: number
  escalationSharePct: number | null
}

type Range = "7d" | "30d" | "all" | "custom"
const RANGES: { key: Range; days: number | null }[] = [
  { key: "7d", days: 7 },
  { key: "30d", days: 30 },
  { key: "all", days: null },
]
// Stable channel options (don't collapse when the result set is filtered).
const CHANNELS = ["email", "sms", "whatsapp", "telegram", "facebook", "instagram", "vkontakte", "web-chat"]
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] // Postgres EXTRACT(DOW): 0=Sun..6=Sat

export default function InboxAnalyticsPage() {
  const t = useTranslations("inboxAnalytics")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const [range, setRange] = useState<Range>("30d")
  const [customFrom, setCustomFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10))
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [channel, setChannel] = useState<string>("")
  const [agent, setAgent] = useState<string>("")
  const [customerStage, setCustomerStage] = useState<string>("")
  const [messageStatus, setMessageStatus] = useState<string>("")
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [frt, setFrt] = useState<FrtPayload | null>(null)
  const [team, setTeam] = useState<TeamPayload | null>(null)
  const [handoff, setHandoff] = useState<HandoffPayload | null>(null)
  const [temporal, setTemporal] = useState<TemporalPayload | null>(null)
  const [agentOptions, setAgentOptions] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [drill, setDrill] = useState<DrillState>(null)
  // B2: both windows fetched once — the card follows the page range (7d → 7,
  // else 30) and the trend arrow compares the two windows per channel.
  const [eff, setEff] = useState<{ d7: ChannelEffRow[]; d30: ChannelEffRow[] } | null>(null)

  const headers = useMemo(
    () => (orgId ? { "x-organization-id": String(orgId) } : {}) as Record<string, string>,
    [orgId],
  )

  const applyDateRange = useCallback((params: URLSearchParams) => {
    if (range === "custom") {
      if (customFrom) params.set("from", new Date(`${customFrom}T00:00:00`).toISOString())
      if (customTo) params.set("to", new Date(`${customTo}T23:59:59.999`).toISOString())
      return
    }
    const days = RANGES.find((item) => item.key === range)?.days ?? null
    if (days != null) params.set("from", new Date(Date.now() - days * 86_400_000).toISOString())
  }, [range, customFrom, customTo])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      applyDateRange(params)
      if (channel) params.set("channel", channel)
      if (agent) params.set("agent", agent)
      if (customerStage) params.set("customerStage", customerStage)
      if (messageStatus) params.set("messageStatus", messageStatus)
      const qs = params.toString()
      const [a, f, tm, tp, ho] = await Promise.all([
        fetch(`/api/v1/inbox/analytics?${qs}`, { headers }).then((r) => r.json()),
        fetch(`/api/v1/inbox/analytics/frt?${qs}`, { headers }).then((r) => r.json()),
        fetch(`/api/v1/inbox/analytics/team?${qs}`, { headers }).then((r) => r.json()),
        fetch(`/api/v1/inbox/analytics/temporal?${qs}`, { headers }).then((r) => r.json()),
        fetch(`/api/v1/inbox/analytics/handoff?${qs}`, { headers }).then((r) => r.json()),
      ])
      if (a.success) setData(a.data)
      if (f.success) setFrt(f.data)
      if (ho.success) setHandoff(ho.data)
      if (tm.success) {
        setTeam(tm.data)
        // Keep the agent dropdown populated from the UNFILTERED set so it doesn't collapse.
        if (!agent) {
          const options = new Map<string, string>()
          for (const employee of tm.data.agents as AgentPerformance[]) {
            if (employee.agentId) options.set(employee.agentId, employee.agentName || employee.agentId)
          }
          if (ho.success) {
            for (const employee of [...ho.data.marketing, ...ho.data.sellers] as {
              agentId: string | null
              agentName: string | null
            }[]) {
              if (employee.agentId) options.set(employee.agentId, employee.agentName || employee.agentId)
            }
          }
          setAgentOptions(Array.from(options, ([id, name]) => ({ id, name })))
        }
      }
      if (tp.success) setTemporal(tp.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [channel, agent, customerStage, messageStatus, headers, applyDateRange])

  useEffect(() => { fetchAll() }, [fetchAll, session])

  // B2: the stats/channels API has no channel/agent filters — fetch once per org.
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      // Partial failure keeps the surviving window (trend just disappears)
      // instead of hiding the whole card.
      const [r7, r30] = await Promise.allSettled([
        fetch("/api/v1/inbox/stats/channels?days=7", { headers }).then((r) => r.json()),
        fetch("/api/v1/inbox/stats/channels?days=30", { headers }).then((r) => r.json()),
      ])
      const win = (r: PromiseSettledResult<{ success?: boolean; data?: { channels: ChannelEffRow[] } }>) =>
        r.status === "fulfilled" && r.value.success ? r.value.data?.channels ?? null : null
      const d7 = win(r7)
      const d30 = win(r30)
      if (!cancelled && (d7 || d30)) setEff({ d7: d7 ?? [], d30: d30 ?? [] })
    })()
    return () => { cancelled = true }
  }, [headers, orgId])

  // Drill-down (slice 3): click an analytics segment → list the conversations behind the number.
  // extra carries the segment filter (ageBucket / channel / agent); the page's own filters + window
  // are merged in so the list matches what the aggregate counted.
  const openDrill = useCallback(async (title: string, extra: Record<string, string>) => {
    setDrill({ title, loading: true, rows: [], truncated: false })
    try {
      const params = new URLSearchParams()
      applyDateRange(params)
      if (channel) params.set("channel", channel)
      if (agent) params.set("agent", agent)
      if (customerStage) params.set("customerStage", customerStage)
      if (messageStatus) params.set("messageStatus", messageStatus)
      for (const [k, v] of Object.entries(extra)) params.set(k, v)
      const res = await fetch(`/api/v1/inbox/analytics/conversations?${params.toString()}`, { headers })
      const json = await res.json()
      if (json.success) {
        setDrill({ title, loading: false, rows: json.data.conversations, truncated: json.data.truncated })
      } else {
        setDrill({ title, loading: false, rows: [], truncated: false })
      }
    } catch {
      setDrill({ title, loading: false, rows: [], truncated: false })
    }
  }, [channel, agent, customerStage, messageStatus, headers, applyDateRange])

  // CSV export (slice 3): one file from the payloads already on screen — no second query path.
  const exportCsv = useCallback(() => {
    if (!data) return
    const csv = buildAnalyticsCsv({
      generatedAt: new Date().toISOString(),
      range,
      channel,
      agent: agent ? (agentOptions.find((a) => a.id === agent)?.name ?? agent) : "",
      kpi: [
        { label: t("totalMessages"), value: data.total },
        { label: t("inbound"), value: data.inbound },
        { label: t("outbound"), value: data.outbound },
        ...(frt ? [
          { label: t("medianFrt"), value: frt.medianMinutes ?? "" },
          { label: t("slaMet", { n: frt.sla.threshold }), value: `${frt.sla.slaMetPct}%` },
          { label: t("openBacklog"), value: frt.aging.total },
        ] : []),
        ...(data.avgLifetimeHours != null ? [{ label: t("avgLifetime"), value: data.avgLifetimeHours }] : []),
      ],
      byChannel: data.byChannel,
      byPlatform: data.byPlatform,
      sla: frt?.sla.distribution ?? null,
      aging: frt?.aging.buckets ?? null,
      agents: (team?.agents ?? []).map((a) => ({ ...a, agentName: a.agentName || t("unassigned") })),
    })
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `inbox-analytics-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [data, frt, team, range, channel, agent, agentOptions, t])

  const maxChannel = data?.byChannel[0]?.total ?? 0
  const heatMax = useMemo(
    () => (temporal ? Math.max(1, ...temporal.heatmap.flat()) : 1),
    [temporal],
  )

  // B2 window mapping: the stats API only aggregates 7- or 30-day windows, so
  // "all" deliberately falls back to 30d — the card's hint always names the
  // real window. The per-channel rows honour the page's channel filter
  // client-side; under an AGENT filter the card hides entirely (the API has
  // no per-agent split, and silently unfiltered numbers would read as wrong).
  const effIsShort = range === "7d"
  const effDays = effIsShort ? 7 : 30
  const effRows = useMemo(() => {
    if (!eff || agent) return []
    const rows = effIsShort ? eff.d7 : eff.d30
    return channel ? rows.filter((r) => r.channel === channel) : rows
  }, [eff, agent, channel, effIsShort])
  const effOtherRows = eff ? (effIsShort ? eff.d30 : eff.d7) : []

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> {t("title")}
            <HelpButton slug="inbox-analytics" variant="label" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="h-7 rounded-md border bg-background px-2 text-xs"
            aria-label={t("filterChannel")}
          >
            <option value="">{t("allChannels")}</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{channelLabel(c)}</option>
            ))}
          </select>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="h-7 rounded-md border bg-background px-2 text-xs max-w-[140px]"
            aria-label={t("filterAgent")}
          >
            <option value="">{t("allAgents")}</option>
            {agentOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <select
            value={customerStage}
            onChange={(event) => setCustomerStage(event.target.value)}
            className="h-7 rounded-md border bg-background px-2 text-xs max-w-[180px]"
            aria-label={t("filterCustomerSegment")}
          >
            <option value="">{t("allCustomerSegments")}</option>
            {(["interested", "potential", "marketing_contacted", "sales_contacted", "unable_to_contact", "sold", "not_sold", "no_result", "unclassified"] as CustomerSegmentKey[]).map((stage) => (
              <option key={stage} value={stage}>{t(`segment_${stage}`)}</option>
            ))}
          </select>
          <select
            value={messageStatus}
            onChange={(event) => setMessageStatus(event.target.value)}
            className="h-7 rounded-md border bg-background px-2 text-xs max-w-[150px]"
            aria-label={t("filterMessageStatus")}
          >
            <option value="">{t("allMessageStatuses")}</option>
            {["sent", "delivered", "read", "failed", "pending"].map((status) => (
              <option key={status} value={status}>{t(`messageStatus_${status}`)}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  range === r.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t(`range_${r.key}`)}
              </button>
            ))}
            <button
              onClick={() => setRange("custom")}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                range === "custom" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t("range_custom")}
            </button>
          </div>
          {range === "custom" && (
            <div className="flex items-center gap-1 rounded-md border bg-background px-1.5 py-1">
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="h-6 bg-transparent text-xs"
                aria-label={t("dateFrom")}
              />
              <span className="text-muted-foreground">—</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(event) => setCustomTo(event.target.value)}
                className="h-6 bg-transparent text-xs"
                aria-label={t("dateTo")}
              />
            </div>
          )}
          <button
            onClick={exportCsv}
            disabled={!data || data.total === 0}
            className="h-7 rounded-md border bg-background px-2.5 text-xs font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
          >
            <Download className="h-3.5 w-3.5" /> {t("exportCsv")}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !data || data.total === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
          {t("noMessages")}
        </div>
      ) : (
        <>
          {/* ── KPI row ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label={t("totalMessages")} value={data.total} icon={<MessageSquare className="h-4 w-4" />} />
            <StatCard label={t("inbound")} value={data.inbound} icon={<ArrowDownLeft className="h-4 w-4 text-emerald-600" />} sub={t("pctOfTotal", { pct: pct(data.inbound, data.total) })} />
            <StatCard label={t("outbound")} value={data.outbound} icon={<ArrowUpRight className="h-4 w-4 text-sky-600" />} sub={t("pctOfTotal", { pct: pct(data.outbound, data.total) })} />
            {frt && (
              <StatCard label={t("medianFrt")} valueText={frt.medianMinutes != null ? formatMinutes(frt.medianMinutes) : "—"} icon={<Timer className="h-4 w-4 text-violet-600" />} sub={frt.avgMinutes != null ? t("avgN", { v: formatMinutes(frt.avgMinutes) }) : undefined} />
            )}
            {frt && frt.sla.answered > 0 && (
              <StatCard label={t("slaMet", { n: frt.sla.threshold })} valueText={`${frt.sla.slaMetPct}%`} icon={<Gauge className="h-4 w-4 text-emerald-600" />} sub={t("ofAnswered", { n: frt.sla.answered.toLocaleString() })} />
            )}
            {frt && (
              <StatCard label={t("openBacklog")} value={frt.aging.total} icon={<Inbox className="h-4 w-4 text-amber-600" />} sub={frt.aging.oldestHours != null ? t("oldestN", { v: formatHours(frt.aging.oldestHours) }) : undefined} />
            )}
          </div>

          {data.messageStatuses && data.messageStatuses.length > 0 && (
            <Card title={t("messageStatuses")} icon={<MessageSquare className="h-4 w-4" />} hint={t("messageStatusesHint")}>
              <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-5">
                {data.messageStatuses.map((status) => (
                  <button
                    key={status.status}
                    type="button"
                    onClick={() => openDrill(t(`messageStatus_${status.status}`), { messageStatus: status.status })}
                    className="rounded-lg border bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="text-lg font-semibold tabular-nums">{status.total.toLocaleString()}</div>
                    <div className="text-[11px] text-muted-foreground">{t(`messageStatus_${status.status}`)}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {t("messageStatusSplit", { inbound: status.inbound, outbound: status.outbound })}
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* ── B2: per-channel AI effectiveness ── */}
          {effRows.length > 0 && (
            <Card
              title={t("channelEffectiveness")}
              hint={`${t("channelEffectivenessHint")} · ${t("effLastNDays", { n: effDays })}`}
            >
              <div className="divide-y">
                {effRows.map((c) => {
                  const other = effOtherRows.find((x) => x.channel === c.channel)
                  const trend = channelAiTrend(c.aiEffectivenessPct, other?.aiEffectivenessPct ?? null, effIsShort)
                  return (
                    <div key={c.channel} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="flex items-center gap-2.5 w-40 min-w-0">
                        <span className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0", channelColor(c.channel))}>
                          <ChannelIcon channel={c.channel} />
                        </span>
                        <span className="text-sm font-medium truncate">
                          {c.channel === "inbox" ? t("channelInboxAnchors") : channelLabel(c.channel)}
                        </span>
                      </div>
                      <div className="w-16 text-sm tabular-nums">
                        <div className="text-[10px] uppercase text-muted-foreground">{t("colVolume")}</div>
                        {c.volume.toLocaleString()}
                      </div>
                      <div className="w-20 text-sm tabular-nums">
                        <div className="text-[10px] uppercase text-muted-foreground">{t("colFrt")}</div>
                        {c.avgFirstResponseMinutes != null ? formatMinutes(c.avgFirstResponseMinutes) : "—"}
                      </div>
                      <div className="flex-1 min-w-[160px]">
                        <div className="flex items-center justify-between text-[10px] uppercase text-muted-foreground">
                          <span>{t("colAiCloses")}</span>
                          {trend && (
                            <span
                              title={t("aiTrendTip", { short: trend.shortPct, long: trend.longPct })}
                              className={cn("flex items-center gap-0.5 normal-case", trend.dir === "up" ? "text-emerald-600" : "text-red-500")}
                            >
                              {trend.dir === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                              {trend.shortPct}%
                            </span>
                          )}
                        </div>
                        {c.aiEffectivenessPct != null ? (
                          <div className="mt-1 flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                              <div className="h-full bg-emerald-500" style={{ width: `${c.aiEffectivenessPct}%` }} />
                            </div>
                            <span className="text-sm font-medium tabular-nums w-10 text-right">{c.aiEffectivenessPct}%</span>
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-muted-foreground">{t("noResolvedYet")}</div>
                        )}
                        {c.aiEffectivenessPct != null && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {t("aiResolvedOf", { ai: c.aiResolved, resolved: c.resolved })}
                          </div>
                        )}
                      </div>
                      <div className="w-24 text-sm tabular-nums">
                        <div className="text-[10px] uppercase text-muted-foreground">{t("colEscalations")}</div>
                        {c.escalationSharePct != null ? `${c.escalationSharePct}%` : "—"}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* ── Volume trend ── */}
          {temporal && temporal.trend.length > 1 && (
            <Card title={t("volumeTrend")}>
              <div className="p-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={temporal.trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="inb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#378ADD" stopOpacity={0.3} /><stop offset="100%" stopColor="#378ADD" stopOpacity={0} /></linearGradient>
                      <linearGradient id="out" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1D9E75" stopOpacity={0.25} /><stop offset="100%" stopColor="#1D9E75" stopOpacity={0} /></linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={28} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="inbound" stroke="#378ADD" fill="url(#inb)" strokeWidth={2} name={t("inbound")} />
                    <Area type="monotone" dataKey="outbound" stroke="#1D9E75" fill="url(#out)" strokeWidth={2} name={t("outbound")} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* ── Busiest-hours heatmap ── */}
          {temporal && heatMax > 1 && (
            <Card title={t("busiestHours")} hint={t("utcHint")}>
              <div className="p-4 overflow-x-auto">
                <div className="min-w-[560px]">
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: "28px repeat(24, 1fr)" }}>
                    <div />
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="text-[9px] text-center text-muted-foreground">{h % 3 === 0 ? h : ""}</div>
                    ))}
                    {temporal.heatmap.map((row, d) => (
                      <FragmentRow key={d} dayLabel={t(`dow_${DOW[d]}`)} row={row} max={heatMax} />
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ── Per-channel message volume (existing) ── */}
          <Card title={t("byChannel")}>
            <div className="divide-y">
              {data.byChannel.map((c) => (
                <div key={c.channel} className="px-4 py-3 flex items-center gap-3">
                  <span className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0", channelColor(c.channel))}>
                    <ChannelIcon channel={c.channel} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{c.channel === "unknown" ? t("channelOther") : channelLabel(c.channel)}</span>
                      <span className="text-muted-foreground tabular-nums">{c.total.toLocaleString()} · {pct(c.total, data.total)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct(c.total, maxChannel)}%` }} />
                    </div>
                    <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-0.5"><ArrowDownLeft className="h-3 w-3" /> {t("inShort", { n: c.inbound.toLocaleString() })}</span>
                      <span className="flex items-center gap-0.5"><ArrowUpRight className="h-3 w-3" /> {t("outShort", { n: c.outbound.toLocaleString() })}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* ── SLA + FRT distribution (uncapped — SQL-aggregated since slice 3) ── */}
          {frt && frt.sla.answered > 0 && (
            <Card title={t("slaAndDistribution")}>
              <div className="p-4 space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">{frt.sla.slaMetPct}%</span>
                  <span className="text-[11px] text-muted-foreground">{t("withinThreshold", { n: frt.sla.threshold, answered: frt.sla.answered.toLocaleString() })}</span>
                </div>
                <BucketBars
                  buckets={frt.sla.distribution}
                  accent="bg-violet-400"
                  onBucketClick={(i) =>
                    openDrill(`${t("slaAndDistribution")} · ${frt.sla.distribution[i].label}`, { frtBucket: FRT_BUCKET_KEYS[i] })
                  }
                />
              </div>
            </Card>
          )}

          {/* ── Backlog aging — buckets click through to the conversations behind them ── */}
          {frt && frt.aging.total > 0 && (
            <Card
              title={t("backlogAging")}
              hint={(frt.aging.excludedBadDates ?? 0) > 0 ? t("excludedBadDates", { n: frt.aging.excludedBadDates ?? 0 }) : undefined}
            >
              <div className="p-4">
                <BucketBars
                  buckets={frt.aging.buckets}
                  colorFor={(i) => ["bg-emerald-500", "bg-sky-500", "bg-amber-500", "bg-red-500"][i] || "bg-muted"}
                  onBucketClick={(i) =>
                    openDrill(`${t("backlogAging")} · ${frt.aging.buckets[i].label}`, { ageBucket: AGE_BUCKET_KEYS[i] })
                  }
                />
              </div>
            </Card>
          )}

          {/* ── Marketing → lead → sales handoff ── */}
          {handoff && (
            <Card title={t("handoffTitle")} icon={<PhoneCall className="h-4 w-4" />} hint={t("handoffHint")}>
              <div className="grid divide-y border-b md:grid-cols-4 md:divide-x md:divide-y-0">
                {([
                  {
                    value: handoff.totals.marketingContacted,
                    label: t("handoffMarketingContacted"),
                    detail: t("handoffMarketingDetail"),
                    rate: null,
                  },
                  {
                    value: handoff.totals.leadsCreated,
                    label: t("handoffLeadsCreated"),
                    detail: t("handoffLeadsDetail"),
                    rate: handoff.totals.marketingToLeadRate,
                  },
                  {
                    value: handoff.totals.salesReported,
                    label: t("handoffSalesReported"),
                    detail: t("handoffSalesReportedDetail", { n: handoff.totals.awaitingSalesReport }),
                    rate: handoff.totals.salesReportRate,
                  },
                  {
                    value: handoff.totals.sold,
                    label: t("handoffSold"),
                    detail: t("handoffSoldDetail"),
                    rate: handoff.totals.soldRate,
                  },
                ] as const).map((step, index) => (
                  <div key={step.label} className="relative px-4 py-4">
                    <span className="text-2xl font-semibold tabular-nums text-foreground">{step.value}</span>
                    <div className="mt-1 text-sm font-medium">{step.label}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{step.detail}</div>
                    {step.rate != null && (
                      <div className="mt-1 text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                        {t("handoffRateOfPrevious", { rate: step.rate })}
                      </div>
                    )}
                    {index < 3 && (
                      <ArrowRight
                        aria-hidden="true"
                        className="absolute -right-2.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full border bg-background p-0.5 text-muted-foreground md:block"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="min-w-0 divide-y">
                <section className="min-w-0">
                  <div className="px-4 pb-2 pt-4">
                    <h3 className="text-sm font-semibold">{t("handoffMarketingTeam")}</h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t("handoffMarketingTeamHint")}</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-y text-left text-muted-foreground">
                          <th className="px-4 py-2 font-medium">{t("colEmployee")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("colMarketingReplies")}</th>
                          <th className="px-4 py-2 text-right font-medium">{t("colLeadsCreated")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {handoff.marketing.length > 0 ? handoff.marketing.map((employee) => (
                          <tr key={employee.agentId ?? "unassigned"}>
                            <td className="px-4 py-2.5 font-medium">
                              {employee.agentName || t("handoffUnattributed")}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{employee.conversationsContacted}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{employee.leadsCreated}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">{t("handoffNoData")}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="min-w-0">
                  <div className="px-4 pb-2 pt-4">
                    <h3 className="text-sm font-semibold">{t("handoffSalesTeam")}</h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t("handoffSalesTeamHint")}</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-xs">
                      <thead>
                        <tr className="border-y text-left text-muted-foreground">
                          <th className="px-4 py-2 font-medium">{t("colSeller")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("colAssignedLeads")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("colCallReports")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("colAwaitingReport")}</th>
                          <th className="px-4 py-2 font-medium">{t("colCallOutcomes")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {handoff.sellers.length > 0 ? handoff.sellers.map((seller) => {
                          const outcomes = ([
                            "interested",
                            "potential",
                            "sales_contacted",
                            "unable_to_contact",
                            "sold",
                            "not_sold",
                            "no_result",
                          ] as SalesHandoffStage[]).filter((stage) => (seller.outcomes[stage] ?? 0) > 0)
                          return (
                            <tr key={seller.agentId ?? "unassigned"}>
                              <td className="px-4 py-2.5 font-medium">{seller.agentName || t("unassigned")}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{seller.assignedLeads}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{seller.reported}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{seller.awaiting}</td>
                              <td className="px-4 py-2.5">
                                {outcomes.length > 0 ? (
                                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                                    {outcomes.map((stage) => (
                                      <span key={stage} className="whitespace-nowrap text-muted-foreground">
                                        {t(`segment_${stage}`)} <strong className="font-semibold text-foreground">{seller.outcomes[stage]}</strong>
                                      </span>
                                    ))}
                                  </div>
                                ) : <span className="text-muted-foreground">—</span>}
                              </td>
                            </tr>
                          )
                        }) : (
                          <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t("handoffNoData")}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </Card>
          )}

          {/* ── Current conversation states ── */}
          {data.customerSegments && data.customerSegments.some((segment) => segment.count > 0) && (
            <Card title={t("customerSegments")} icon={<Gauge className="h-4 w-4" />} hint={t("customerSegmentsHint")}>
              <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                {data.customerSegments.map((segment) => (
                  <button
                    key={segment.key}
                    type="button"
                    onClick={() => openDrill(t(`segment_${segment.key}`), { customerStage: segment.key })}
                    className="rounded-lg border bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="text-lg font-semibold tabular-nums">{segment.count}</div>
                    <div className="text-[11px] text-muted-foreground">{t(`segment_${segment.key}`)}</div>
                  </button>
                ))}
              </div>
              {data.managerSegments && data.managerSegments.length > 0 && (
                <div className="border-t">
                  <div className="bg-muted/20 px-4 py-3">
                    <div className="text-sm font-semibold">{t("employeeResultsTitle")}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("employeeResultsHint")}</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-xs">
                      <thead className="border-y bg-muted/20">
                        <tr className="text-muted-foreground">
                          <th className="sticky left-0 z-10 min-w-52 bg-muted px-4 py-2.5 text-left font-semibold text-foreground">
                            {t("colEmployee")}
                          </th>
                          {(["marketing_contacted", "potential", "sales_contacted", "sold", "not_sold", "unable_to_contact"] as CustomerSegmentKey[]).map((key, index) => (
                            <th key={key} className={cn("px-3 py-2.5 font-medium text-right", index === 0 && "border-l")}>
                              {t(`segment_${key}`)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {data.managerSegments.map((manager) => (
                          <tr key={manager.agentId ?? "unassigned"} className="hover:bg-muted/30">
                            <td className="sticky left-0 z-10 bg-background px-4 py-2.5 font-medium">
                              {manager.agentName === "unassigned" ? t("unassignedConversations") : manager.agentName}
                            </td>
                            {(["marketing_contacted", "potential", "sales_contacted", "sold", "not_sold", "unable_to_contact"] as CustomerSegmentKey[]).map((key, index) => {
                              const value = manager.segments[key] ?? 0
                              return (
                                <td key={key} className={cn("px-3 py-2.5 text-right tabular-nums", index === 0 && "border-l", value ? "font-semibold text-foreground" : "text-muted-foreground/50")}>
                                  {value || "—"}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* ── Team performance ── */}
          {team && team.agents.length > 0 && (
            <Card title={t("teamPerformance")} icon={<Users className="h-4 w-4" />} hint={team.capped ? t("lastN", { n: team.cap.toLocaleString() }) : undefined}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground text-left border-b">
                      <th className="px-4 py-2 font-medium">{t("colAgent")}</th>
                      <th className="px-2 py-2 font-medium text-right">{t("colAssigned")}</th>
                      <th className="px-2 py-2 font-medium text-right">{t("colResolved")}</th>
                      <th className="px-2 py-2 font-medium text-right">{t("colResolution")}</th>
                      <th className="px-2 py-2 font-medium text-right">{t("colMedianFrt")}</th>
                      <th className="px-4 py-2 font-medium text-right">{t("colUnread")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {team.agents.map((a) => (
                      <tr
                        key={a.agentId ?? "unassigned"}
                        onClick={() => openDrill(a.agentName || t("unassigned"), { agent: a.agentId ?? "unassigned" })}
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <td className="px-4 py-2 font-medium truncate max-w-[160px]">{a.agentName || t("unassigned")}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.assigned.toLocaleString()}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.resolved.toLocaleString()}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.resolutionRate}%</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.medianFrtMinutes != null ? formatMinutes(a.medianFrtMinutes) : "—"}</td>
                        <td className={cn("px-4 py-2 text-right tabular-nums", a.unread > 0 && "text-amber-600 font-medium")}>{a.unread.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ── Conversations (status + resolution + lifetime + per-channel) ── */}
          <Card title={t("conversations")}>
            {data.conversations.total === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground/60">{t("noConversations")}</div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="flex items-end gap-6">
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">{data.conversations.resolutionRate}%</div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("resolutionDesc", { resolved: data.conversations.resolved.toLocaleString(), total: data.conversations.total.toLocaleString() })}
                    </div>
                  </div>
                  {data.avgLifetimeHours != null && (
                    <div>
                      <div className="text-2xl font-semibold tabular-nums flex items-center gap-1"><Clock className="h-4 w-4 text-muted-foreground" />{formatHours(data.avgLifetimeHours)}</div>
                      <div className="text-[11px] text-muted-foreground">{t("avgLifetime")}</div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <StatusPill label={t("statusOpen")} value={data.conversations.open} tint="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" />
                  <StatusPill label={t("statusResolved")} value={data.conversations.resolved} tint="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" />
                  <StatusPill label={t("statusArchived")} value={data.conversations.archived} tint="bg-muted text-foreground/70" />
                  {data.conversations.other > 0 && (
                    <StatusPill label={t("statusOther")} value={data.conversations.other} tint="bg-muted text-foreground/70" />
                  )}
                </div>
                {data.byPlatform.length > 0 && (
                  <div className="pt-1 space-y-1.5">
                    <div className="text-[11px] text-muted-foreground">{t("convByChannel")}</div>
                    {data.byPlatform.map((p) => (
                      <button
                        key={p.platform}
                        onClick={() => openDrill(channelLabel(p.platform), { channel: p.platform })}
                        className="w-full flex items-center gap-2 text-xs rounded hover:bg-muted/50 transition-colors text-left"
                      >
                        <span className="w-24 truncate">{channelLabel(p.platform)}</span>
                        <span className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <span className="block h-full bg-primary/70" style={{ width: `${pct(p.total, data.byPlatform[0].total)}%` }} />
                        </span>
                        <span className="tabular-nums text-muted-foreground w-28 text-right">{t("openResolvedN", { open: p.open, resolved: p.resolved })}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── Drill-down modal: the conversations behind a clicked segment ── */}
      {drill && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setDrill(null)}
        >
          <div
            className="bg-card border rounded-lg shadow-lg w-full max-w-lg max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={drill.title}
          >
            <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
              <span className="text-sm font-semibold truncate">{drill.title}</span>
              <button onClick={() => setDrill(null)} aria-label={t("drillClose")} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto">
              {drill.loading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : drill.rows.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">{t("drillEmpty")}</div>
              ) : (
                <div className="divide-y">
                  {drill.rows.map((r) => (
                    <a
                      key={r.id}
                      href={`/inbox?conversation=${encodeURIComponent(r.id)}`}
                      className="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-muted/50 transition-colors"
                      title={t("drillOpenThread")}
                    >
                      <span className={cn("h-6 w-6 rounded-full flex items-center justify-center shrink-0", channelColor(r.channel))}>
                        <ChannelIcon channel={r.channel} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{r.contactName || "—"}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {channelLabel(r.channel)} · {r.agentName || t("unassigned")} · {formatHours(r.ageHours)}
                        </div>
                      </div>
                      {r.unreadCount > 0 && (
                        <span className="shrink-0 text-[11px] font-medium text-amber-600 tabular-nums">{r.unreadCount}</span>
                      )}
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{r.status}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="px-4 py-2.5 border-t flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{drill.truncated ? t("drillTruncated") : t("drillCount", { n: drill.rows.length })}</span>
              <a href="/inbox" className="font-medium text-primary hover:underline">{t("drillOpenInbox")}</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FragmentRow({ dayLabel, row, max }: { dayLabel: string; row: number[]; max: number }) {
  return (
    <>
      <div className="text-[10px] text-muted-foreground flex items-center">{dayLabel}</div>
      {row.map((v, h) => (
        <div
          key={h}
          title={`${dayLabel} ${h}:00 — ${v}`}
          className="h-4 rounded-sm"
          style={{ backgroundColor: v === 0 ? "rgba(127,127,127,0.08)" : `rgba(55,138,221,${0.15 + 0.85 * (v / max)})` }}
        />
      ))}
    </>
  )
}

function BucketBars({ buckets, accent = "bg-primary", colorFor, onBucketClick }: {
  buckets: { label: string; count: number }[]
  accent?: string
  colorFor?: (i: number) => string
  /** When set, rows become buttons that drill into the conversations behind the bucket. */
  onBucketClick?: (i: number) => void
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count))
  return (
    <div className="space-y-2">
      {buckets.map((b, i) => {
        const Row = onBucketClick ? "button" : "div"
        return (
          <Row
            key={b.label}
            {...(onBucketClick ? { onClick: () => onBucketClick(i), type: "button" as const } : {})}
            className={cn(
              "w-full flex items-center gap-2 text-xs text-left",
              onBucketClick && "rounded hover:bg-muted/50 transition-colors cursor-pointer",
            )}
          >
            <span className="w-16 text-muted-foreground">{b.label}</span>
            <span className="flex-1 h-3.5 rounded bg-muted overflow-hidden">
              <span className={cn("block h-full rounded", colorFor ? colorFor(i) : accent)} style={{ width: `${Math.round((b.count / max) * 100)}%` }} />
            </span>
            <span className="w-8 text-right tabular-nums font-medium">{b.count}</span>
          </Row>
        )
      })}
    </div>
  )
}

function formatMinutes(m: number): string {
  if (m < 1) return "<1m"
  if (m < 60) return `${m % 1 === 0 ? m : m.toFixed(1)}m`
  const h = Math.floor(m / 60)
  const rem = Math.round(m % 60)
  return rem ? `${h}h ${rem}m` : `${h}h`
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 48) return `${h % 1 === 0 ? h : h.toFixed(1)}h`
  return `${Math.round(h / 24)}d`
}

function Card({ title, hint, icon, children }: { title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg bg-card">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
        <span className="text-sm font-semibold flex items-center gap-1.5">{icon}{title}</span>
        {hint && <span className="text-[11px] text-muted-foreground shrink-0">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function StatCard({ label, value, valueText, icon, sub }: { label: string; value?: number; valueText?: string; icon: React.ReactNode; sub?: string }) {
  return (
    <div className="border rounded-lg bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{valueText ?? (value ?? 0).toLocaleString()}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

function StatusPill({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className={cn("flex-1 rounded-md px-2.5 py-1.5", tint)}>
      <div className="text-base font-semibold tabular-nums leading-none">{value.toLocaleString()}</div>
      <div className="text-[10px] mt-0.5 opacity-80">{label}</div>
    </div>
  )
}
