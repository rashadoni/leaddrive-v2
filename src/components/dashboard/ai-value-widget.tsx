"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Sparkles, Clock, TrendingUp, TrendingDown, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

interface TopFeature {
  key: string
  count: number
}

interface Stats {
  approvedThisMonth: number
  approvedPrevMonth: number
  rejectedThisMonth: number
  pending: number
  minutesSaved: number
  topApprovedFeatures: TopFeature[]
  trendDelta: number
}

const FEATURE_LABELS: Record<string, { emoji: string; label: string }> = {
  ai_auto_followup:             { emoji: "📋", label: "Follow-up" },
  ai_auto_followup_shadow:      { emoji: "📋", label: "Follow-up" },
  ai_auto_acknowledge:          { emoji: "⚡", label: "SLA" },
  ai_auto_acknowledge_shadow:   { emoji: "⚡", label: "SLA" },
  ai_auto_payment_reminder:     { emoji: "💰", label: "Payment" },
  ai_auto_payment_reminder_shadow: { emoji: "💰", label: "Payment" },
  ai_auto_renewal:              { emoji: "🔄", label: "Renewal" },
  ai_auto_renewal_shadow:       { emoji: "🔄", label: "Renewal" },
  ai_auto_hot_lead:             { emoji: "🔥", label: "Hot lead" },
  ai_auto_hot_lead_shadow:      { emoji: "🔥", label: "Hot lead" },
  ai_auto_triage:               { emoji: "🏷", label: "Triage" },
  ai_auto_triage_shadow:        { emoji: "🏷", label: "Triage" },
  ai_auto_stage_advance:        { emoji: "📈", label: "Stage" },
  ai_auto_stage_advance_shadow: { emoji: "📈", label: "Stage" },
  ai_auto_sentiment:            { emoji: "😠", label: "Sentiment" },
  ai_auto_sentiment_shadow:     { emoji: "😠", label: "Sentiment" },
  ai_auto_kb_close:             { emoji: "📖", label: "KB close" },
  ai_auto_kb_close_shadow:      { emoji: "📖", label: "KB close" },
  ai_auto_duplicate:            { emoji: "🔗", label: "Duplicate" },
  ai_auto_duplicate_shadow:     { emoji: "🔗", label: "Duplicate" },
  ai_auto_credit_limit:         { emoji: "💳", label: "Credit" },
  ai_auto_credit_limit_shadow:  { emoji: "💳", label: "Credit" },
  ai_auto_meeting_recap:        { emoji: "🎙", label: "Meeting" },
  ai_auto_meeting_recap_shadow: { emoji: "🎙", label: "Meeting" },
  ai_auto_social_reply:         { emoji: "💬", label: "Social reply" },
  ai_auto_social_reply_shadow:  { emoji: "💬", label: "Social reply" },
  ai_auto_social_viral:         { emoji: "🚨", label: "Viral alert" },
  ai_auto_social_viral_shadow:  { emoji: "🚨", label: "Viral alert" },
}

function labelFor(key: string) {
  return FEATURE_LABELS[key] || { emoji: "•", label: key.replace("ai_auto_", "").replace("_shadow", "") }
}

function formatTime(mins: number, mLabel: string, hLabel: string): string {
  if (mins <= 0) return `0${mLabel}`
  if (mins < 60) return `${mins}${mLabel}`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}${hLabel} ${m}${mLabel}` : `${h}${hLabel}`
}

export function AiValueWidget({ orgId }: { orgId?: string }) {
  const t = useTranslations("dashboardWidgets")
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    fetch("/api/v1/settings/ai-stats", {
      headers: { "x-organization-id": orgId },
    })
      .then(r => r.json())
      .then(j => setStats(j?.data || null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId])

  const delta = stats?.trendDelta ?? 0
  const deltaPositive = delta >= 0
  const maxBarVal = stats?.topApprovedFeatures?.[0]?.count || 1

  return (
    <Link href="/settings/ai-automation" className="block group">
      <Card className="dashboard-bento-card p-4 h-full transition-colors hover:border-primary/40">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("aiValueMonthLabel")}</p>
          </div>
          {stats && stats.approvedPrevMonth > 0 && (
            <span className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
              deltaPositive
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            }`}>
              {deltaPositive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
              {deltaPositive ? "+" : ""}{delta}%
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="text-2xl font-semibold text-green-600 leading-none">{stats?.approvedThisMonth ?? 0}</div>
                <p className="text-[10px] text-muted-foreground mt-1">{t("aiValueApproved")}</p>
              </div>
              <div>
                <div className="flex items-baseline gap-1">
                  <Clock className="h-3.5 w-3.5 text-blue-600 self-center" />
                  <span className="text-2xl font-semibold text-blue-600 leading-none">{formatTime(stats?.minutesSaved ?? 0, t("minShort"), t("hourShort"))}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{t("aiValueSaved")}</p>
              </div>
            </div>

            {stats && stats.topApprovedFeatures.length > 0 ? (
              <div className="space-y-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("aiValueTopScenarios")}</p>
                {stats.topApprovedFeatures.map(f => {
                  const info = labelFor(f.key)
                  const pct = (f.count / maxBarVal) * 100
                  return (
                    <div key={f.key} className="flex items-center gap-2">
                      <span className="text-[11px] w-24 truncate">{info.emoji} {info.label}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground w-6 text-right">{f.count}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground pt-2 border-t border-zinc-200 dark:border-zinc-700">
                {t("aiValueEmpty")}
              </p>
            )}
          </>
        )}
      </Card>
    </Link>
  )
}
