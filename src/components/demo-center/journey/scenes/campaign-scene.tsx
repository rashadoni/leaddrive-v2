"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, BarChart3, List, Mail, MousePointerClick, Plus, Search, Send, Target, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ColorStatCard } from "@/components/color-stat-card"
import { formatDate } from "@/lib/format-date"
import {
  DEMO_CAMPAIGN_TYPE_KEYS,
  DEMO_SAMPLE_CAMPAIGNS,
  campaignRecordsEngagement,
  type DemoCampaignType,
  type DemoSampleCampaignStatus,
} from "@/lib/demo-center/journey"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/**
 * Marketing → Campaigns: the source that brought the prospect in.
 *
 * Mirrors the real pages: the list (`src/app/(dashboard)/campaigns/page.tsx`)
 * with its status cards, and the campaign itself — the KPI row and the
 * engagement rule of `campaigns/[id]/page.tsx`, plus the conversion funnel
 * and the money of the campaign ROI screen (`campaign-roi/page.tsx`,
 * `src/lib/campaigns/roi.ts`). The list is a working team's
 * (`DEMO_SAMPLE_CAMPAIGNS`) with the prospect's own campaign in it.
 *
 * The funnel is where this chapter earns its place: a mailer counts sends, a
 * CRM counts the deals and won money that came of them — and the prospect's
 * own deal joins those counts later in the story. It has no «leads» step: a
 * lead carries no campaign in the product, a deal does.
 */

/** The product's list colours and type marks (`campaigns/page.tsx`). */
const STATUS_TONE: Record<DemoSampleCampaignStatus, string> = {
  draft: "text-muted-foreground",
  scheduled: "text-amber-500",
  sent: "text-green-600",
  cancelled: "text-red-500",
}
const TYPE_MARK: Record<DemoCampaignType, string> = { email: "📧", sms: "📱", whatsapp: "💬", telegram: "✈️" }
const STATUS_KEY: Record<DemoSampleCampaignStatus, "statusDraft" | "statusScheduled" | "statusSent" | "statusCancelled"> = {
  draft: "statusDraft",
  scheduled: "statusScheduled",
  sent: "statusSent",
  cancelled: "statusCancelled",
}
export function CampaignScene({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("campaigns")
  const tr = useTranslations("campaignRoi")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { campaign } = snapshot.records
  const seen = snapshot.state !== "STARTED"
  const [opened, setOpened] = useState(seen)
  const [tab, setTab] = useState<"list" | "analytics">("list")

  const openCampaign = () => {
    if (reviewMode) {
      setOpened(true)
      return
    }
    if (step?.id !== "source-open-campaign") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    const result = dispatch({ type: "transition", stepId: step.id, to: "SOURCE_SEEN" })
    if (result.ok) setOpened(true)
  }

  // Only e-mail campaigns record opens and clicks; for the rest the product
  // prints «—» and says why, so the demo does the same instead of inventing
  // an Instagram open rate.
  const engagement = campaignRecordsEngagement(campaign.type)
  const typeLabel = t(DEMO_CAMPAIGN_TYPE_KEYS[campaign.type])
  const rate = (value: number) => (!engagement || campaign.sent === 0 ? null : Math.round((value / campaign.sent) * 100))
  const openRate = rate(campaign.opened)
  const clickRate = rate(campaign.clicked)
  const count = (value: number) => (engagement ? value.toLocaleString() : "—")
  // Launched, so the entered budget is what it cost — the product has no
  // other cost figure (`campaignCost`, src/lib/campaigns/roi.ts).
  const cost = campaign.budget
  const roiPercent = cost > 0 && campaign.revenue > 0 ? Math.round(((campaign.revenue - cost) / cost) * 100) : null
  const money = (value: number) => `${value.toLocaleString()} ₼`

  if (opened) {
    return (
      <div data-testid="demo-scene-campaign-detail" className="@container space-y-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setOpened(false)} aria-label={t("title")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {typeLabel} · {t("statusSent")} · {formatDate(campaign.sentAt, locale)}
            </p>
          </div>
        </div>

        <div data-tour-id="campaign-detail" className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          <ColorStatCard label={t("recipients")} value={campaign.audience.toLocaleString()} icon={<Users className="h-4 w-4" />} hint={t("hintColRecipients")} />
          <ColorStatCard label={t("kpiSent")} value={campaign.sent.toLocaleString()} icon={<Send className="h-4 w-4" />} />
          <ColorStatCard label={t("opens")} value={count(campaign.opened)} icon={<Mail className="h-4 w-4" />} hint={t("hintOpens")} />
          <ColorStatCard label={t("clicks")} value={count(campaign.clicked)} icon={<MousePointerClick className="h-4 w-4" />} hint={t("hintClicks")} />
        </div>
        {!engagement && <p className="-mt-1 text-xs text-muted-foreground">{t("detailEngagementEmailOnly")}</p>}

        <div className="grid gap-3 @3xl:grid-cols-2">
          <Card data-tour-id="campaign-funnel">
            <CardContent className="space-y-3 pt-6">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Target className="h-3.5 w-3.5 text-primary" /> {tr("conversionFunnel")}
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{S.campaignFunnelNote}</p>
              {([
                { label: tr("recipients"), value: campaign.audience, tone: "bg-slate-400" },
                { label: t("sent"), value: campaign.sent, tone: "bg-blue-500" },
                { label: tr("opened"), value: engagement ? campaign.opened : null, tone: "bg-indigo-500" },
                { label: tr("clicked"), value: engagement ? campaign.clicked : null, tone: "bg-violet-500" },
                { label: tr("deals"), value: campaign.deals, tone: "bg-amber-500" },
                { label: tr("wonDeals"), value: campaign.wonDeals, tone: "bg-emerald-500" },
              ]).map((row) => (
                <FunnelRow key={row.label} label={row.label} value={row.value} total={campaign.audience} tone={row.tone} />
              ))}
            </CardContent>
          </Card>

          <Card data-tour-id="campaign-roi">
            <CardContent className="space-y-3 pt-6">
              <p className="text-sm font-semibold">{S.campaignMoneyTitle}</p>
              <Field label={t("budget")} value={money(campaign.budget)} />
              <Field label={tc("cost")} value={money(cost)} />
              <Field label={tc("revenue")} value={money(campaign.revenue)} tone="text-emerald-600" />
              <div className="flex items-baseline justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">ROI</span>
                <span className="text-lg font-bold tabular-nums">{roiPercent === null ? "—" : `${roiPercent > 0 ? "+" : ""}${roiPercent}%`}</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{S.campaignMoneyNote}</p>
            </CardContent>
          </Card>
        </div>

        <Card data-tour-id="campaigns-analytics">
          <CardContent className="space-y-4 pt-6">
            <Rate label={t("openRate")} percent={openRate} tone="bg-primary" />
            <Rate label={t("clickRate")} percent={clickRate} tone="bg-emerald-500" />
            <div className="grid gap-x-8 gap-y-2 border-t pt-4 @xl:grid-cols-2">
              <Field label={tr("sentAt")} value={formatDate(campaign.sentAt, locale)} />
              <Field label={t("recipients")} value={campaign.audience.toLocaleString()} />
              <Field label={typeLabel} value={t("statusSent")} />
              <Field label={tr("linkedDeals")} value={`${campaign.deals}`} />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // The prospect's campaign heads the list as the newest send.
  const rows = [
    { id: campaign.id, own: true, name: campaign.name, description: S.campaignOwn, type: campaign.type, status: "sent" as const, audience: campaign.audience, sent: campaign.sent, budget: campaign.budget },
    ...DEMO_SAMPLE_CAMPAIGNS.map((sample) => ({ ...sample, own: false })),
  ]
  const countOf = (status: DemoSampleCampaignStatus | "sending") => rows.filter((row) => row.status === status).length

  return (
    <div data-testid="demo-scene-campaign-list" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <div data-tour-id="campaigns-tabs" className="flex items-center gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-700">
            {([
              { key: "analytics" as const, Icon: BarChart3, label: tc("analytics") },
              { key: "list" as const, Icon: List, label: tc("list") },
            ]).map(({ key, Icon, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => (key === "analytics" ? hint(S.hintDisabled) : setTab(key))}
                aria-current={tab === key ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          <Button data-tour-id="campaigns-new" onClick={() => hint(S.demoButtonHint)}>
            <Plus className="mr-1 h-4 w-4" /> {t("newCampaign")}
          </Button>
        </div>
      </div>

      <div data-tour-id="campaigns-stats" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {([
          { label: t("statusDraft"), value: countOf("draft"), hint: t("hintStatusDraft") },
          { label: t("statusScheduled"), value: countOf("scheduled"), hint: t("hintStatusScheduled") },
          { label: t("statusSending"), value: countOf("sending") },
          { label: t("statusSent"), value: countOf("sent") },
          { label: t("statusCancelled"), value: countOf("cancelled") },
        ]).map((stat) => (
          <ColorStatCard key={stat.label} label={stat.label} value={stat.value} icon={<Mail className="h-4 w-4" />} hint={stat.hint} />
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          readOnly
          placeholder={t("searchPlaceholder")}
          onClick={() => hint(S.demoButtonHint)}
          className="w-full rounded-lg border border-zinc-200 bg-background py-2 pl-9 pr-3 text-sm dark:border-zinc-700"
        />
      </div>

      <div data-tour-id="campaigns-list" className="space-y-3">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={row.own ? openCampaign : () => hint(S.campaignSampleHint)}
            {...(row.own ? demoTarget("source-open-campaign") : {})}
            className={cn(
              "w-full rounded-xl border bg-card p-4 text-left transition-all hover:border-foreground/30 hover:shadow-sm",
              row.own ? "border-primary/40 ring-1 ring-primary/20" : "border-zinc-200 dark:border-zinc-700",
            )}
          >
            <span className="flex items-start justify-between gap-4">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">{row.name}</span>
                  {row.own && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{S.campaignOwn}</span>}
                </span>
                {!row.own && <span className="mt-0.5 block text-sm text-muted-foreground">{row.description}</span>}
                <span className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <span className={cn("font-medium", STATUS_TONE[row.status])}>{t(STATUS_KEY[row.status])}</span>
                  <span className="text-muted-foreground">{TYPE_MARK[row.type]} {t(DEMO_CAMPAIGN_TYPE_KEYS[row.type])}</span>
                  <span className="flex items-center gap-1 text-muted-foreground"><Users className="h-3.5 w-3.5" /> {row.audience.toLocaleString()}</span>
                  {row.sent > 0 && <span className="flex items-center gap-1 text-muted-foreground"><Send className="h-3.5 w-3.5" /> {row.sent.toLocaleString()}</span>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {row.status === "sent" ? (
                  <>
                    <span className="block text-lg font-bold text-green-600">{row.sent.toLocaleString()}/{row.audience.toLocaleString()}</span>
                    <span className="block text-xs text-muted-foreground">{t("sent")}</span>
                  </>
                ) : row.budget ? (
                  <>
                    <span className="block text-lg font-bold">{row.budget.toLocaleString()}</span>
                    <span className="block text-xs text-muted-foreground">{t("budget")}</span>
                  </>
                ) : null}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** A rate the product does not record reads «—» and draws no bar. */
function Rate({ label, percent, tone }: { label: string; percent: number | null; tone: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{percent === null ? "—" : `${percent}%`}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
        {percent !== null && <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, percent)}%` }} />}
      </div>
    </div>
  )
}

/** One step of the campaign ROI screen's funnel: the count, and its share of
 *  the recipients. A count the product does not record reads «—». */
function FunnelRow({ label, value, total, tone }: { label: string; value: number | null; total: number; tone: string }) {
  const percent = value !== null && total > 0 ? (value / total) * 100 : 0
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {value === null ? "—" : value.toLocaleString()}
          {value !== null && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{percent >= 100 ? "100%" : `${percent.toFixed(1)}%`}</span>}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
        {value !== null && <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(Math.max(percent, 2), 100)}%` }} />}
      </div>
    </div>
  )
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", tone)}>{value}</span>
    </div>
  )
}
