"use client"

import { useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Flame, ListChecks, PhoneCall, Calendar } from "lucide-react"
import { formatDate } from "@/lib/format-date"
import { getLeadScoreFactorLabel } from "@/lib/leads/score-factor-labels"
import { cn } from "@/lib/utils"

/**
 * Creatio-style lead overview rail (Readiness / Interest / Customer
 * engagement / Lead information) + the 3-box stat row. Both feed off a
 * single fetch of the existing lead timeline endpoint.
 */

export interface LeadTimelineStats {
  loading: boolean
  firstDate: string | null
  lastDate: string | null
  tasksToDo: number
  callsMade: number
}

const TASK_DONE_STATUSES = new Set(["completed", "done", "cancelled", "canceled"])

export function useLeadTimelineStats(leadId: string, orgId?: string): LeadTimelineStats {
  const [stats, setStats] = useState<LeadTimelineStats>({
    loading: true, firstDate: null, lastDate: null, tasksToDo: 0, callsMade: 0,
  })

  useEffect(() => {
    if (!leadId) return
    const headers: Record<string, string> = orgId ? { "x-organization-id": orgId } : {}
    let cancelled = false
    fetch(`/api/v1/leads/${leadId}/timeline`, { headers })
      .then(r => r.json())
      .then(json => {
        if (cancelled || !json.success) return
        const entries: Array<{ kind: string; date: string; meta?: Record<string, unknown> }> =
          json.data?.timeline || []
        const dates = entries.map(e => e.date).sort()
        setStats({
          loading: false,
          firstDate: dates[0] ?? null,
          lastDate: dates[dates.length - 1] ?? null,
          tasksToDo: entries.filter(e =>
            e.kind === "task" && !TASK_DONE_STATUSES.has(String(e.meta?.status ?? "").toLowerCase()),
          ).length,
          callsMade: entries.filter(e =>
            e.kind === "call" || (e.kind === "activity" && e.meta?.activityType === "call"),
          ).length,
        })
      })
      .catch(() => { if (!cancelled) setStats(s => ({ ...s, loading: false })) })
    return () => { cancelled = true }
  }, [leadId, orgId])

  return stats
}

function RailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</p>
      {children}
    </div>
  )
}

function segmentOf(score: number): "hot" | "warm" | "cold" {
  if (score >= 70) return "hot"
  if (score >= 40) return "warm"
  return "cold"
}

const SEGMENT_CHIP: Record<string, string> = {
  hot: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  warm: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  cold: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
}

export function LeadOverview({
  lead,
  stats,
  priorityLabel,
  priorityClass,
  sourceLabel,
}: {
  lead: { score: number; interest: string | null; brand: string | null; source: string | null; priority: string }
  stats: LeadTimelineStats
  priorityLabel: string
  priorityClass: string
  sourceLabel: string | null
}) {
  const t = useTranslations("leads")
  const locale = useLocale()
  const readiness = Math.min(100, Math.max(0, Math.round(lead.score)))
  const segment = segmentOf(readiness)
  const segmentLabels: Record<string, string> = {
    hot: t("overviewSegmentHot"),
    warm: t("overviewSegmentWarm"),
    cold: t("overviewSegmentCold"),
  }

  return (
    <div className="space-y-3">
      {/* Readiness */}
      <RailBlock title={t("overviewReadiness")}>
        <div className="flex items-center gap-2">
          <Flame className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          <span className="text-3xl font-bold text-blue-600 dark:text-blue-400">{readiness}&nbsp;%</span>
        </div>
      </RailBlock>

      {/* Interest */}
      <RailBlock title={t("overviewInterest")}>
        {lead.interest ? (
          <p className="text-sm font-medium leading-relaxed">{lead.interest}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("overviewNotSpecified")}</p>
        )}
      </RailBlock>

      {/* Customer engagement */}
      <RailBlock title={t("overviewEngagement")}>
        <div className="space-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t("overviewEngagementFirst")}</p>
            <p className="font-medium">{stats.firstDate ? formatDate(stats.firstDate, locale) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("overviewEngagementLast")}</p>
            <p className="font-medium">{stats.lastDate ? formatDate(stats.lastDate, locale) : "—"}</p>
          </div>
        </div>
      </RailBlock>

      {/* Lead information */}
      <RailBlock title={t("overviewLeadInfo")}>
        <div className="space-y-2.5 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("overviewSegment")}</p>
            <span className={cn("inline-flex text-xs font-medium px-2.5 py-1 rounded-full", SEGMENT_CHIP[segment])}>
              {segmentLabels[segment]}
            </span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("modalPriority")}</p>
            <span className={cn("inline-flex text-xs font-medium px-2.5 py-1 rounded-full", priorityClass)}>
              {priorityLabel}
            </span>
          </div>
          {sourceLabel && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("modalSource")}</p>
              <span className="inline-flex text-xs font-medium px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                {sourceLabel}
              </span>
            </div>
          )}
        </div>
      </RailBlock>
    </div>
  )
}

/**
 * Creatio-style "Lead Evaluation" AI-rail card: readiness, scoring
 * factors and the existing convert action. Pure presentation — the
 * convert dialog stays owned by the page.
 */
export function LeadEvaluationCard({
  score,
  factors,
  converted,
  onConvert,
  convertLabel,
}: {
  /** null = the scorer has not reached this lead yet. Not the same as zero. */
  score: number | null
  factors: Record<string, unknown> | null
  converted: boolean
  onConvert: () => void
  convertLabel: string
}) {
  const t = useTranslations("leads")
  const readiness = score === null ? null : Math.min(100, Math.max(0, Math.round(score)))
  const entries = factors
    ? Object.entries(factors).filter(([, v]) => typeof v === "number").slice(0, 5) as Array<[string, number]>
    : []

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("leadEvaluation")}</p>
      <div className="flex items-center gap-2">
        <Flame className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
          {readiness === null ? "—" : <>{readiness}&nbsp;%</>}
        </span>
      </div>
      {entries.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t("scoreFactors")}</p>
          {entries.map(([key, val]) => {
            const pct = Math.min(100, Math.max(0, Math.round(val)))
            return (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate">{getLeadScoreFactorLabel(key, t)}</span>
                <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-7 text-right font-medium">{pct}</span>
              </div>
            )
          })}
        </div>
      )}
      {!converted && (
        <button
          type="button"
          onClick={onConvert}
          className="w-full text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 hover:bg-muted transition-colors"
        >
          {convertLabel}
        </button>
      )}
    </div>
  )
}

export function LeadStatBoxes({
  stats,
  createdAt,
}: {
  stats: LeadTimelineStats
  createdAt: string
}) {
  const t = useTranslations("leads")
  const locale = useLocale()

  const boxes = [
    { label: t("overviewTasksToDo"), value: stats.loading ? "…" : String(stats.tasksToDo), icon: ListChecks },
    { label: t("overviewCallsMade"), value: stats.loading ? "…" : String(stats.callsMade), icon: PhoneCall },
    { label: t("overviewCreatedOn"), value: formatDate(createdAt, locale), icon: Calendar },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {boxes.map(({ label, value, icon: Icon }) => (
        <div key={label} className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" /> {label}
          </p>
          <p className="text-lg font-bold mt-0.5 truncate">{value}</p>
        </div>
      ))}
    </div>
  )
}
