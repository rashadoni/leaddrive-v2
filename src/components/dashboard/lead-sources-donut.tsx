"use client"

import { useTranslations } from "next-intl"
import { Users } from "lucide-react"
import { MiniDonut } from "@/components/charts/mini-charts"

const SOURCE_COLORS: Record<string, string> = {
  website: "#8b5cf6",
  linkedin: "#06b6d4",
  referral: "#22c55e",
  campaign: "#f59e0b",
  cold_call: "#3b82f6",
  event: "#ec4899",
  other: "#6366f1",
}
const SOURCE_KEYS: Record<string, string> = {
  website: "sourceWebsite",
  linkedin: "sourceLinkedin", // gitleaks:allow -- synthetic test/public display literal
  referral: "sourceReferral",
  campaign: "sourceCampaign",
  cold_call: "sourceColdCall",
  event: "sourceEvent",
  other: "sourceOther",
}

export function LeadSourcesDonut({ leadsBySource, totalLeads }: { leadsBySource: any[]; totalLeads: number }) {
  const t = useTranslations("dashboard")
  const sources = leadsBySource || []

  const segments = sources.map(s => ({
    pct: totalLeads > 0 ? (s._count / totalLeads) * 100 : 0,
    color: SOURCE_COLORS[s.source] || SOURCE_COLORS.other,
  }))

  return (
    <div className="dashboard-bento-card rounded-lg bg-card border border-zinc-200 dark:border-zinc-700 shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-violet-500" />
          <span className="text-sm font-semibold">{t("leadSources")}</span>
        </div>
        <span className="text-xs font-semibold text-violet-600">{totalLeads}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0">
          {segments.length > 0 ? (
            <MiniDonut segments={segments} size={80} />
          ) : (
            <div className="w-20 h-20 rounded-full border-8 border-zinc-200 dark:border-zinc-700" />
          )}
        </div>
        <div className="flex-1 space-y-1">
          {sources.map((s: any) => {
            const pct = totalLeads > 0 ? Math.round((s._count / totalLeads) * 100) : 0
            return (
              <div key={s.source} className="flex items-center gap-1.5 text-[10px]">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_COLORS[s.source] || SOURCE_COLORS.other }} />
                <span className="text-muted-foreground flex-1 truncate">{SOURCE_KEYS[s.source] ? t(SOURCE_KEYS[s.source]) : s.source}</span>
                <span className="font-semibold">{pct}%</span>
              </div>
            )
          })}
          {sources.length === 0 && <span className="text-[10px] text-muted-foreground">{t("noData")}</span>}
        </div>
      </div>
    </div>
  )
}
