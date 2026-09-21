"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format-date"
import { MiniLineChart, MiniDonut } from "@/components/charts/mini-charts"
import {
  Send,
  MailOpen,
  MousePointerClick,
  AlertTriangle,
  Wallet,
  TrendingUp,
  Layers,
  Zap,
  FileText,
} from "lucide-react"
import {
  campaignRoi,
  monthlyTrend,
  summarizeCampaigns,
  summarizeJourneys,
  summarizeSegments,
  summarizeTemplates,
  topCampaigns,
  type CampaignAnalyticsRecord,
  type CampaignRoiSource,
  type JourneyAnalyticsRecord,
  type Rate,
  type SegmentAnalyticsRecord,
  type TemplateAnalyticsRecord,
} from "@/lib/campaigns/analytics"

// Every figure on this tab comes from src/lib/campaigns/analytics.ts, which
// may not produce a number that no record holds. Where the records cannot
// answer, the tab prints «—» and says why.

interface CampaignsAnalyticsProps {
  campaigns: CampaignAnalyticsRecord[]
  /** How many campaigns the organisation has; `campaigns` may be only the latest of them. */
  total?: number
  orgId?: string | null
}

// The same page size the Segments and Templates pages load.
const LIST_LIMIT = 500

const TEMPLATE_CATEGORY_KEYS: Record<string, string> = {
  general: "catGeneral",
  welcome: "catWelcome",
  onboarding: "catOnboarding",
  notification: "catNotification",
  marketing: "catMarketing",
  follow_up: "catFollowUp",
  proposal: "catProposal",
}
const DONUT_COLORS = ["#8b5cf6", "#06b6d4", "#f59e0b", "#10b981"]
const DONUT_OTHER_COLOR = "#a1a1aa"

// ── Helpers ──────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
  return n.toLocaleString(undefined)
}

function percentText(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1) + "%"
}

// ── Loading the neighbouring records ────────────────────────────────

type Source<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "failed" }
type Rows<T> = { rows: T[]; total: number }

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function rowsFrom<T>(key: string) {
  return (data: unknown): Rows<T> | null => {
    const body = asObject(data)
    const rows = body?.[key]
    if (!Array.isArray(rows)) return null
    const total = Number(body?.total)
    return { rows: rows as T[], total: Number.isFinite(total) ? Math.max(total, rows.length) : rows.length }
  }
}

const readSegments = rowsFrom<SegmentAnalyticsRecord>("segments")
const readTemplates = rowsFrom<TemplateAnalyticsRecord>("templates")
const readJourneys = rowsFrom<JourneyAnalyticsRecord>("journeys")

function readRoi(data: unknown): CampaignRoiSource | null {
  const body = asObject(data)
  const summary = asObject(body?.summary)
  if (!summary || !Array.isArray(body?.campaigns)) return null
  return {
    summary: {
      totalRevenue: Number(summary.totalRevenue) || 0,
      totalCost: Number(summary.totalCost) || 0,
      totalRoi: Number(summary.totalRoi) || 0,
    },
    campaigns: body.campaigns as CampaignRoiSource["campaigns"],
  }
}

function useSource<T>(url: string, orgId: string | null | undefined, read: (data: unknown) => T | null): Source<T> {
  const [source, setSource] = useState<Source<T>>({ state: "loading" })
  useEffect(() => {
    const controller = new AbortController()
    const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
    fetch(url, { headers, signal: controller.signal })
      .then(async (res) => {
        const json = res.ok ? await res.json() : null
        const data = json?.success ? read(json.data) : null
        if (!controller.signal.aborted) setSource(data ? { state: "ready", data } : { state: "failed" })
      })
      .catch(() => {
        if (!controller.signal.aborted) setSource({ state: "failed" })
      })
    return () => controller.abort()
  }, [url, orgId, read])
  return source
}

function figure(state: Source<unknown>["state"], value: number | undefined): string {
  if (state === "loading") return "…"
  return value == null ? "—" : fmt(value)
}

// ── Sub-components ──────────────────────────────────────────────────

function KpiBox({
  testId,
  icon,
  value,
  label,
  note,
  iconColor,
}: {
  testId: string
  icon: React.ReactNode
  value: string
  label: string
  note?: string
  iconColor?: string
}) {
  return (
    <div
      data-testid={`campaigns-analytics-${testId}`}
      className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 flex items-center gap-3 min-w-0"
    >
      <div
        className={cn(
          "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center",
          iconColor ?? "bg-primary/10 text-primary"
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold text-foreground truncate">{value}</div>
        <div className="text-xs text-muted-foreground truncate">{label}</div>
        {note && <div className="text-[10px] leading-snug text-muted-foreground break-words">{note}</div>}
      </div>
    </div>
  )
}

function FunnelBar({
  label,
  count,
  percent,
  percentLabel,
  color,
}: {
  label: string
  count: number | null
  percent: number | null
  percentLabel?: string
  color: string
}) {
  const width = percent == null ? 0 : Math.min(100, Math.max(percent, percent > 0 ? 1 : 0))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">
          {count == null ? (
            "—"
          ) : (
            <>
              {fmt(count)} <span className="text-muted-foreground text-xs">({percentLabel ?? percentText(percent)})</span>
            </>
          )}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("w-2 h-2 rounded-full", color)} />
      {label}
    </div>
  )
}

function Panel({
  testId,
  icon,
  title,
  badge,
  badgeClassName,
  children,
}: {
  testId: string
  icon: React.ReactNode
  title: string
  badge: string | null
  badgeClassName: string
  children: React.ReactNode
}) {
  return (
    <div
      data-testid={`campaigns-analytics-${testId}`}
      className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {badge != null && (
          <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", badgeClassName)}>{badge}</span>
        )}
      </div>
      {children}
    </div>
  )
}

function PanelStats({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className={cn("grid gap-2", items.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {items.map((item) => (
        <div key={item.label} className="text-center">
          <div className="text-lg font-bold text-foreground">{item.value}</div>
          <div className="text-[10px] text-muted-foreground">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

function ListCaption({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{children}</div>
}

// ── Main Component ──────────────────────────────────────────────────

export function CampaignsAnalytics({ campaigns, total, orgId }: CampaignsAnalyticsProps) {
  const t = useTranslations("campaigns")
  const tSegments = useTranslations("segments")
  const tJourneys = useTranslations("journeys")
  const tTemplates = useTranslations("emailTemplates")
  const locale = useLocale()

  const segments = useSource(`/api/v1/segments?limit=${LIST_LIMIT}`, orgId, readSegments)
  const templates = useSource(`/api/v1/email-templates?limit=${LIST_LIMIT}`, orgId, readTemplates)
  const journeys = useSource(`/api/v1/journeys?limit=${LIST_LIMIT}`, orgId, readJourneys)
  const roiSource = useSource("/api/v1/campaign-roi", orgId, readRoi)

  const summary = useMemo(() => summarizeCampaigns(campaigns), [campaigns])
  const trend = useMemo(() => monthlyTrend(campaigns, new Date()), [campaigns])
  const top = useMemo(() => topCampaigns(campaigns), [campaigns])
  const trendMax = Math.max(0, ...trend.flatMap((m) => [m.sent, m.opened, m.clicked]))

  const segmentSummary = segments.state === "ready" ? summarizeSegments(segments.data.rows, segments.data.total) : null
  const journeySummary = journeys.state === "ready" ? summarizeJourneys(journeys.data.rows, journeys.data.total) : null
  const templateSummary = templates.state === "ready" ? summarizeTemplates(templates.data.rows, templates.data.total) : null

  // A rate with no base reads «—»: nothing was sent, or nothing sent could record the step.
  const rateNote = (rate: Rate | null) => (rate ? undefined : summary.sent > 0 ? t("notRecorded") : t("noSendsYet"))

  const roi = (() => {
    if (roiSource.state === "loading") return { value: "…" }
    if (roiSource.state === "failed") return { value: "—", note: t("dataUnavailable") }
    const figureOf = campaignRoi(roiSource.data)
    switch (figureOf.kind) {
      case "value":
        return { value: `${figureOf.percent > 0 ? "+" : ""}${Math.round(figureOf.percent)}%` }
      case "no-revenue":
        return { value: "—", note: t("roiNoWonDeals") }
      case "several-currencies":
        return { value: "—", note: t("roiSeveralCurrencies") }
      case "no-budget":
        return { value: "—", note: t("roiNoBudget") }
    }
  })()

  const templateSlices = (() => {
    if (!templateSummary) return []
    const shown = templateSummary.byCategory.slice(0, DONUT_COLORS.length)
    const rest = templateSummary.byCategory.slice(DONUT_COLORS.length).reduce((sum, c) => sum + c.count, 0)
    const slices = shown.map((c, i) => ({
      key: c.category,
      label: TEMPLATE_CATEGORY_KEYS[c.category] ? tTemplates(TEMPLATE_CATEGORY_KEYS[c.category]) : c.category,
      count: c.count,
      color: DONUT_COLORS[i],
    }))
    if (rest > 0) slices.push({ key: "__other", label: t("tplOther"), count: rest, color: DONUT_OTHER_COLOR })
    return slices
  })()

  const latestNote = (rows: number, of: number) =>
    rows < of ? <Muted>{t("basedOnLatest", { count: rows, total: of })}</Muted> : null

  return (
    <div className="space-y-5">
      {total != null && total > campaigns.length && (
        <p className="text-xs text-muted-foreground">{t("basedOnLatest", { count: campaigns.length, total })}</p>
      )}

      {/* ── KPI Row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiBox
          testId="kpi-sent"
          icon={<Send className="w-5 h-5" />}
          value={fmt(summary.sent)}
          label={t("kpiSent")}
          iconColor="bg-blue-500/10 text-blue-500"
        />
        <KpiBox
          testId="kpi-open-rate"
          icon={<MailOpen className="w-5 h-5" />}
          value={percentText(summary.opened?.percent)}
          label={t("kpiOpenRate")}
          note={rateNote(summary.opened)}
          iconColor="bg-emerald-500/10 text-emerald-500"
        />
        <KpiBox
          testId="kpi-click-rate"
          icon={<MousePointerClick className="w-5 h-5" />}
          value={percentText(summary.clicked?.percent)}
          label={t("kpiClickRate")}
          note={rateNote(summary.clicked)}
          iconColor="bg-violet-500/10 text-violet-500"
        />
        <KpiBox
          testId="kpi-bounce"
          icon={<AlertTriangle className="w-5 h-5" />}
          value={percentText(summary.bounced?.percent)}
          label={t("kpiBounce")}
          note={rateNote(summary.bounced)}
          iconColor="bg-amber-500/10 text-amber-500"
        />
        <KpiBox
          testId="kpi-budget"
          icon={<Wallet className="w-5 h-5" />}
          value={fmt(summary.budget) + " ₼"}
          label={t("kpiBudget")}
          iconColor="bg-cyan-500/10 text-cyan-500"
        />
        <KpiBox
          testId="kpi-roi"
          icon={<TrendingUp className="w-5 h-5" />}
          value={roi.value}
          label="ROI"
          note={roi.note}
          iconColor="bg-green-500/10 text-green-500"
        />
      </div>

      {/* ── Row 2: Trend + Funnel + Top Campaigns ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Monthly sending trend — one scale for all three lines */}
        <div
          data-testid="campaigns-analytics-trend"
          className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-foreground">{t("monthlyTrend")}</h3>
          {trendMax === 0 ? (
            <Muted>{t("noSendsInPeriod")}</Muted>
          ) : (
            <>
              <div className="space-y-2">
                <MiniLineChart data={trend.map((m) => m.sent)} max={trendMax} color="stroke-blue-400" />
                <MiniLineChart data={trend.map((m) => m.opened)} max={trendMax} color="stroke-emerald-400" />
                <MiniLineChart data={trend.map((m) => m.clicked)} max={trendMax} color="stroke-violet-400" />
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <LegendDot color="bg-blue-400" label={t("legendSent")} />
                <LegendDot color="bg-emerald-400" label={t("legendOpened")} />
                <LegendDot color="bg-violet-400" label={t("legendClicked")} />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
                {trend.map((m) => (
                  <span key={`${m.year}-${m.month}`}>{formatDate(new Date(m.year, m.month, 1), locale, { month: "short" })}</span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Delivery funnel */}
        <div
          data-testid="campaigns-analytics-funnel"
          className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-foreground">{t("deliveryFunnel")}</h3>
          {summary.sent === 0 ? (
            <Muted>{t("noSendsYet")}</Muted>
          ) : (
            <>
              <div className="space-y-3">
                <FunnelBar label={t("funnelSent")} count={summary.sent} percent={100} percentLabel="100%" color="bg-blue-500" />
                <FunnelBar
                  label={t("funnelOpened")}
                  count={summary.opened?.count ?? null}
                  percent={summary.opened?.percent ?? null}
                  color="bg-emerald-500"
                />
                <FunnelBar
                  label={t("funnelClicked")}
                  count={summary.clicked?.count ?? null}
                  percent={summary.clicked?.percent ?? null}
                  color="bg-violet-500"
                />
                <FunnelBar
                  label={t("kpiBounce")}
                  count={summary.bounced?.count ?? null}
                  percent={summary.bounced?.percent ?? null}
                  color="bg-amber-500"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">{t("funnelRatesNote")}</p>
            </>
          )}
        </div>

        {/* Top campaigns */}
        <div
          data-testid="campaigns-analytics-top"
          className="bg-card rounded-xl border border-zinc-200 dark:border-zinc-700 p-5 space-y-4"
        >
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("topCampaigns")}</h3>
            <p className="text-[11px] text-muted-foreground">{t("topByClicks")}</p>
          </div>
          {summary.sent === 0 ? (
            <Muted>{t("noSendsYet")}</Muted>
          ) : top.length === 0 ? (
            <Muted>{t("noEngagementYet")}</Muted>
          ) : (
            <div className="space-y-3">
              {top.map((c, i) => (
                <div key={c.id} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                      i === 0
                        ? "bg-amber-500/15 text-amber-500"
                        : i === 1
                          ? "bg-muted-foreground/15 text-muted-foreground"
                          : "bg-orange-400/15 text-orange-400"
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">{c.name}</div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{fmt(c.sent)} {t("topSent")}</span>
                      <span>{percentText(c.openRate)} {t("topOpen")}</span>
                      <span>{percentText(c.clickRate)} {t("topClick")}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 3: Segments + Automation (journeys) + Templates ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Panel
          testId="segments"
          icon={<Layers className="w-4 h-4 text-muted-foreground" />}
          title={t("segments")}
          badge={segmentSummary ? fmt(segmentSummary.total) : null}
          badgeClassName="bg-primary/10 text-primary"
        >
          <PanelStats
            items={[
              { label: t("segTotal"), value: figure(segments.state, segmentSummary?.total) },
              { label: t("segDynamic"), value: figure(segments.state, segmentSummary?.dynamic) },
              { label: t("segStatic"), value: figure(segments.state, segmentSummary?.static) },
            ]}
          />
          <div className="border-t pt-3 space-y-2">
            {segments.state === "failed" ? (
              <Muted>{t("dataUnavailable")}</Muted>
            ) : segments.state === "ready" && segmentSummary ? (
              segmentSummary.total === 0 ? (
                <Muted>{tSegments("noSegments")}</Muted>
              ) : (
                <>
                  <ListCaption>{t("segContacts")}</ListCaption>
                  {segmentSummary.largest.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground truncate">{s.name}</span>
                      <span className="font-medium text-foreground ml-2">{fmt(s.contacts)}</span>
                    </div>
                  ))}
                  {latestNote(segments.data.rows.length, segments.data.total)}
                </>
              )
            ) : null}
          </div>
        </Panel>

        <Panel
          testId="automation"
          icon={<Zap className="w-4 h-4 text-muted-foreground" />}
          title={t("automation")}
          badge={journeySummary ? fmt(journeySummary.active) : null}
          badgeClassName="bg-emerald-500/10 text-emerald-500"
        >
          <PanelStats
            items={[
              { label: t("autoActive"), value: figure(journeys.state, journeySummary?.active) },
              { label: t("autoEntry"), value: figure(journeys.state, journeySummary?.entries) },
              {
                label: t("autoConversion"),
                value: journeys.state === "loading" ? "…" : percentText(journeySummary?.conversion?.percent),
              },
            ]}
          />
          <div className="border-t pt-3 space-y-2">
            {journeys.state === "failed" ? (
              <Muted>{t("dataUnavailable")}</Muted>
            ) : journeys.state === "ready" && journeySummary ? (
              journeySummary.total === 0 ? (
                <Muted>{tJourneys("noJourneys")}</Muted>
              ) : (
                <>
                  <ListCaption>{t("autoEntry")}</ListCaption>
                  {journeySummary.busiest.map((j) => (
                    <div key={j.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full flex-shrink-0",
                            j.active ? "bg-emerald-500" : "bg-muted-foreground/40"
                          )}
                        />
                        <span className="text-muted-foreground truncate">{j.name}</span>
                      </div>
                      <span className="font-medium text-foreground ml-2">{fmt(j.entries)}</span>
                    </div>
                  ))}
                  {latestNote(journeys.data.rows.length, journeys.data.total)}
                </>
              )
            ) : null}
          </div>
        </Panel>

        <Panel
          testId="templates"
          icon={<FileText className="w-4 h-4 text-muted-foreground" />}
          title={t("templates")}
          badge={templateSummary ? fmt(templateSummary.total) : null}
          badgeClassName="bg-violet-500/10 text-violet-500"
        >
          <PanelStats
            items={[
              { label: t("tplTotal"), value: figure(templates.state, templateSummary?.total) },
              { label: t("tplActive"), value: figure(templates.state, templateSummary?.active) },
            ]}
          />
          <div className="border-t pt-3">
            {templates.state === "failed" ? (
              <Muted>{t("dataUnavailable")}</Muted>
            ) : templates.state === "ready" && templateSummary ? (
              templateSummary.total === 0 ? (
                <Muted>{tTemplates("noTemplates")}</Muted>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-5">
                    <MiniDonut segments={templateSlices.map((s) => ({ value: s.count, color: s.color }))} size={64} />
                    <div className="space-y-1.5">
                      {templateSlices.map((s) => (
                        <div key={s.key} className="flex items-center gap-2 text-xs">
                          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                          <span className="text-muted-foreground">{s.label}</span>
                          <span className="font-medium text-foreground">{fmt(s.count)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {latestNote(templates.data.rows.length, templates.data.total)}
                </div>
              )
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  )
}
