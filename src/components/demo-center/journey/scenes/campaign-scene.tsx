"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, BarChart3, List, Mail, MousePointerClick, Plus, Search, Send, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ColorStatCard } from "@/components/color-stat-card"
import { formatDate } from "@/lib/format-date"
import { DEMO_CHANNEL_LABELS } from "@/lib/demo-center/journey"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/**
 * Marketing → Campaigns: the source that brought the prospect in.
 *
 * Mirrors the real page (`src/app/(dashboard)/campaigns/page.tsx`): the
 * list/analytics switch, five status cards, campaign cards with recipient
 * and send counts, and the campaign's own analytics. Data is the session
 * snapshot's single campaign, derived from the channel the prospect chose
 * on the request form.
 */
export function CampaignScene({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("campaigns")
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

  const openRate = campaign.sent === 0 ? 0 : Math.round((campaign.opened / campaign.sent) * 100)
  const clickRate = campaign.sent === 0 ? 0 : Math.round((campaign.clicked / campaign.sent) * 100)

  if (opened) {
    return (
      <div data-testid="demo-scene-campaign-detail" className="space-y-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setOpened(false)} aria-label={t("title")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {DEMO_CHANNEL_LABELS[campaign.channel]} · {t("statusSent")} · {formatDate(campaign.sentAt, locale)}
            </p>
          </div>
        </div>

        <div data-tour-id="campaign-detail" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ColorStatCard label={t("recipients")} value={campaign.audience.toLocaleString()} icon={<Users className="h-4 w-4" />} hint={t("hintColRecipients")} />
          <ColorStatCard label={t("kpiSent")} value={campaign.sent.toLocaleString()} icon={<Send className="h-4 w-4" />} />
          <ColorStatCard label={t("opens")} value={campaign.opened.toLocaleString()} icon={<Mail className="h-4 w-4" />} hint={t("hintOpens")} />
          <ColorStatCard label={t("clicks")} value={campaign.clicked.toLocaleString()} icon={<MousePointerClick className="h-4 w-4" />} hint={t("hintClicks")} />
        </div>

        <Card data-tour-id="campaigns-analytics">
          <CardContent className="space-y-4 pt-6">
            <Rate label={t("openRate")} percent={openRate} tone="bg-primary" />
            <Rate label={t("clickRate")} percent={clickRate} tone="bg-emerald-500" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div data-testid="demo-scene-campaign-list" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <div data-tour-id="campaigns-tabs" className="flex items-center gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-700">
            {([
              { key: "list" as const, Icon: List },
              { key: "analytics" as const, Icon: BarChart3 },
            ]).map(({ key, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={tab === key ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
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
          { label: t("statusDraft"), value: 0 },
          { label: t("statusScheduled"), value: 0 },
          { label: t("statusSending"), value: 0 },
          { label: t("statusSent"), value: 1 },
          { label: t("statusCancelled"), value: 0 },
        ]).map((stat) => (
          <ColorStatCard key={stat.label} label={stat.label} value={stat.value} icon={<Mail className="h-4 w-4" />} />
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
        <button
          type="button"
          onClick={openCampaign}
          {...demoTarget("source-open-campaign")}
          className="w-full rounded-xl border border-zinc-200 bg-card p-4 text-left transition-all hover:border-foreground/30 hover:shadow-sm dark:border-zinc-700"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{campaign.name}</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">{t("statusSent")}</span>
            <span className="text-xs text-muted-foreground">{DEMO_CHANNEL_LABELS[campaign.channel]}</span>
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {campaign.audience.toLocaleString()}</span>
            <span className="flex items-center gap-1"><Send className="h-3.5 w-3.5" /> {campaign.sent.toLocaleString()}</span>
            <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {openRate}%</span>
            <span className="flex items-center gap-1"><MousePointerClick className="h-3.5 w-3.5" /> {clickRate}%</span>
            <span className="ml-auto">{formatDate(campaign.sentAt, locale)}</span>
          </span>
        </button>
      </div>
    </div>
  )
}

function Rate({ label, percent, tone }: { label: string; percent: number; tone: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{percent}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  )
}
