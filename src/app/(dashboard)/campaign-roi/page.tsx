"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { HelpButton } from "@/components/help/help-button"
import { useEnumLabel, useStageLabel } from "@/lib/status-labels"
import { formatDate } from "@/lib/format-date"
import { DollarSign, TrendingUp, BarChart3, Target, Users, Eye, MousePointer, ChevronDown, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { ColorStatCard } from "@/components/color-stat-card"
import { InfoHint } from "@/components/info-hint"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

interface CampaignDeal {
  id: string
  name: string
  stage: string
  amount: number
  currency: string
}

interface CampaignROI {
  id: string
  name: string
  status: string
  type: string
  budget: number
  totalRecipients: number
  totalSent: number
  totalOpened: number
  totalClicked: number
  sentAt: string | null
  createdAt: string
  revenue: number
  attributedRevenue: number
  attributedRoi: number
  totalDeals: number
  wonDeals: number
  roi: number
  deals: CampaignDeal[]
}

interface Summary {
  totalRevenue: number
  totalCost: number
  totalRoi: number
  campaignCount: number
  totalAttributedRevenue: number
  totalAttributedRoi: number
  attributionModel: { name: string; modelType: string } | null
}

// ─── Funnel Step Component ─────────────────────────────────────
function FunnelStep({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-24 text-right shrink-0">{label}</span>
      <div className="flex-1 h-6 bg-muted/50 rounded-full overflow-hidden relative">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold">
          {value.toLocaleString()} ({pct.toFixed(1)}%)
        </span>
      </div>
    </div>
  )
}

// ─── Expandable Campaign Card ──────────────────────────────────
function CampaignCard({
  campaign,
  avgOpenRate,
  avgClickRate,
  attributionModelName,
}: {
  campaign: CampaignROI
  avgOpenRate: number
  avgClickRate: number
  attributionModelName: string | null
}) {
  const t = useTranslations("campaigns")
  const tr = useTranslations("campaignRoi")
  const tc = useTranslations("common")
  const statusLabel = useEnumLabel("campaigns", "status", ["draft", "scheduled", "sending", "sent", "cancelled", "ab_testing"])
  const typeLabel = useEnumLabel("campaigns", "type", ["email", "sms"])
  const stageLabel = useStageLabel()
  const locale = useLocale()
  const [expanded, setExpanded] = useState(false)

  const openRate = campaign.totalSent > 0 ? (campaign.totalOpened / campaign.totalSent) * 100 : 0
  const clickRate = campaign.totalSent > 0 ? (campaign.totalClicked / campaign.totalSent) * 100 : 0

  const stageColors: Record<string, string> = {
    WON: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    LOST: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    NEGOTIATION: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    PROPOSAL: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card overflow-hidden transition-shadow hover:shadow-sm">
      {/* Header — clickable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-start justify-between text-left"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{campaign.name}</h3>
            <Badge variant="outline" className="text-[10px]">{typeLabel(campaign.type)}</Badge>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px]",
                campaign.status === "sent" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                campaign.status === "draft" && "bg-muted text-muted-foreground",
              )}
            >
              {statusLabel(campaign.status)}
            </Badge>
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            <span>{tc("revenue")}: <strong className={cn("text-foreground", campaign.revenue > 0 && "text-green-600")}>${campaign.revenue.toLocaleString()}</strong></span>
            {attributionModelName && (
              <span title={tr("attributedHint")}>{tr("attributed")}: <strong className={cn("text-foreground", campaign.attributedRevenue > 0 && "text-emerald-600")}>${Math.round(campaign.attributedRevenue).toLocaleString()}</strong></span>
            )}
            <span>{tc("cost")}: <strong className="text-foreground">${(campaign.budget || 0).toLocaleString()}</strong></span>
            <span>{tr("deals")}: <strong className="text-foreground">{campaign.totalDeals}</strong></span>
            <span>{tr("wonDeals")}: <strong className={cn("text-foreground", campaign.wonDeals > 0 && "text-green-600")}>{campaign.wonDeals}</strong></span>
            <span>{tr("leads")}: <strong className="text-foreground">{campaign.totalRecipients}</strong></span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <div className={cn(
              "text-lg font-bold",
              campaign.roi > 0 ? "text-green-600" : campaign.roi < 0 ? "text-red-500" : "text-muted-foreground"
            )}>
              {campaign.budget > 0 ? `${campaign.roi.toFixed(1)}% ROI` : "—"}
            </div>
            {attributionModelName && campaign.budget > 0 && (
              <div className="text-[11px] text-muted-foreground" title={tr("attributedHint")}>
                {tr("attributed")}: {campaign.attributedRoi.toFixed(1)}%
              </div>
            )}
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
        </div>
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-5 bg-muted/10">
          {/* Conversion Funnel */}
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-primary" />
              {tr("conversionFunnel")}
            </h4>
            <div className="space-y-2">
              <FunnelStep label={tr("recipients")} value={campaign.totalRecipients} total={campaign.totalRecipients} color="bg-slate-400" />
              <FunnelStep label={t("sent")} value={campaign.totalSent} total={campaign.totalRecipients} color="bg-blue-500" />
              <FunnelStep label={tr("opened")} value={campaign.totalOpened} total={campaign.totalRecipients} color="bg-indigo-500" />
              <FunnelStep label={tr("clicked")} value={campaign.totalClicked} total={campaign.totalRecipients} color="bg-violet-500" />
              <FunnelStep label={tr("deals")} value={campaign.totalDeals} total={campaign.totalRecipients} color="bg-amber-500" />
              <FunnelStep label={tr("wonDeals")} value={campaign.wonDeals} total={campaign.totalRecipients} color="bg-green-500" />
            </div>
          </div>

          {/* Rate comparison */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Eye className="h-3 w-3" /> {t("openRate")}
                </span>
                <span className="text-sm font-bold">{openRate.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mb-1.5">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(openRate, 100)}%` }} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{tr("avgAllCampaigns")}</span>
                <span>{avgOpenRate.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-muted-foreground/30 rounded-full" style={{ width: `${Math.min(avgOpenRate, 100)}%` }} />
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <MousePointer className="h-3 w-3" /> {t("clickRate")}
                </span>
                <span className="text-sm font-bold">{clickRate.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mb-1.5">
                <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(clickRate, 100)}%` }} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{tr("avgAllCampaigns")}</span>
                <span>{avgClickRate.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-muted-foreground/30 rounded-full" style={{ width: `${Math.min(avgClickRate, 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">{tc("createdAt")}:</span>
              <span className="ml-1.5 font-medium">{campaign.createdAt ? formatDate(campaign.createdAt, locale, { day: "2-digit", month: "short", year: "numeric" }) : "—"}</span>
            </div>
            {campaign.sentAt && (
              <div>
                <span className="text-xs text-muted-foreground">{tr("sentAt")}:</span>
                <span className="ml-1.5 font-medium">{formatDate(campaign.sentAt, locale, { day: "2-digit", month: "short", year: "numeric" })}</span>
              </div>
            )}
          </div>

          {/* Deals table */}
          {campaign.deals.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-primary" />
                {tr("linkedDeals")} ({campaign.deals.length})
              </h4>
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-xs text-muted-foreground">
                      <th className="text-left px-3 py-2 font-medium">{tc("name")}</th>
                      <th className="text-left px-3 py-2 font-medium">{tc("stage")}</th>
                      <th className="text-right px-3 py-2 font-medium">{tc("amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaign.deals.map(deal => (
                      <tr key={deal.id} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-2">
                          <Link href={`/deals/${deal.id}`} className="text-primary hover:underline inline-flex items-center gap-1">
                            {deal.name}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <Badge className={cn("text-[10px]", stageColors[deal.stage] || "bg-muted text-foreground")}>
                            {stageLabel(deal.stage)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          ${deal.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {campaign.deals.length === 0 && (
            <div className="text-center py-3 text-sm text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-lg bg-muted/20">
              {tr("noLinkedDeals")}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────
export default function CampaignROIPage() {
  const t = useTranslations("campaigns")
  const tr = useTranslations("campaignRoi")
  const tc = useTranslations("common")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const [campaigns, setCampaigns] = useState<CampaignROI[]>([])
  const [summary, setSummary] = useState<Summary>({ totalRevenue: 0, totalCost: 0, totalRoi: 0, campaignCount: 0, totalAttributedRevenue: 0, totalAttributedRoi: 0, attributionModel: null })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/v1/campaign-roi", {
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
      .then(r => r.json())
      .then(j => {
        if (j.success) {
          setCampaigns(j.data.campaigns || [])
          setSummary(j.data.summary)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [session])

  const totalSent = campaigns.reduce((s, c) => s + c.totalSent, 0)
  const totalOpened = campaigns.reduce((s, c) => s + c.totalOpened, 0)
  const totalClicked = campaigns.reduce((s, c) => s + c.totalClicked, 0)
  const avgOpenRate = totalSent > 0 ? (totalOpened / totalSent) * 100 : 0
  const avgClickRate = totalSent > 0 ? (totalClicked / totalSent) * 100 : 0

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")} ROI</h1>
        <div className="animate-pulse"><div className="h-96 bg-muted rounded-lg" /></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-primary/10 rounded-lg">
          <BarChart3 className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} ROI <HelpButton slug="campaign-roi" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <PageDescription text={tr("pageDescription")} />

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ColorStatCard label={tc("revenue")} value={`$${summary.totalRevenue.toLocaleString()}`} icon={<DollarSign className="h-4 w-4" />} hint={tr("hintTotalRevenue")} />
        <ColorStatCard label={tc("cost")} value={`$${summary.totalCost.toLocaleString()}`} icon={<TrendingUp className="h-4 w-4" />} hint={tr("hintTotalCost")} />
        <ColorStatCard label="ROI" value={`${summary.totalRoi.toFixed(1)}%`} icon={<BarChart3 className="h-4 w-4" />} hint={tr("hintRoi")} />
        <ColorStatCard label={t("title")} value={summary.campaignCount} icon={<Target className="h-4 w-4" />} />
      </div>

      {/* C9 #10 — multi-touch attribution overlay (only when a model exists) */}
      {summary.attributionModel && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-900/10 px-4 py-3 text-sm flex items-center gap-2 flex-wrap">
          <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" />
          <span className="text-muted-foreground">
            {tr("attributedSummary", {
              model: summary.attributionModel.name,
              revenue: `$${Math.round(summary.totalAttributedRevenue).toLocaleString()}`,
              roi: summary.totalAttributedRoi.toFixed(1),
            })}
          </span>
        </div>
      )}

      {/* Summary bar */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-muted/30 flex items-center gap-8 text-sm">
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t("sent")}:</span>
          <span className="font-bold text-primary">
            {campaigns.reduce((s, c) => s + c.totalRecipients, 0) > 0
              ? Math.round(totalSent / campaigns.reduce((s, c) => s + c.totalRecipients, 0) * 100)
              : 0}%
          </span>
          <InfoHint text={tr("hintSendRate")} size={12} />
        </div>
        <div className="flex items-center gap-1.5">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t("openRate")}:</span>
          <span className="font-bold text-primary">{avgOpenRate.toFixed(1)}%</span>
          <InfoHint text={tr("hintOpenRate")} size={12} />
        </div>
        <div className="flex items-center gap-1.5">
          <MousePointer className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t("clickRate")}:</span>
          <span className="font-bold text-primary">{avgClickRate.toFixed(1)}%</span>
          <InfoHint text={tr("hintClickRate")} size={12} />
        </div>
      </div>

      {/* Campaign list */}
      <div className="space-y-3">
        {campaigns.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {tr("noCampaigns")}
          </div>
        ) : (
          campaigns.map(campaign => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              avgOpenRate={avgOpenRate}
              avgClickRate={avgClickRate}
              attributionModelName={summary.attributionModel?.name ?? null}
            />
          ))
        )}
      </div>
    </div>
  )
}
