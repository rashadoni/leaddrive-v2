"use client"

import { useTranslations } from "next-intl"
import { AlertTriangle } from "lucide-react"
import { Badge } from "@/components/ui/badge"

type DashboardRisk = {
  severity: string
  titleKey?: string
  title?: string
  descKey?: string
  descParams?: Record<string, string | number>
  description?: string
  metric?: string
}

export function RisksBanner({ risks }: { risks: DashboardRisk[] }) {
  const t = useTranslations("dashboard")
  const active = risks.filter((r) => r.severity === "critical" || r.severity === "warning")
  if (active.length === 0) return null

  return (
    <section
      aria-label={t("risksBanner")}
      className="dashboard-bento-card rounded-lg border border-zinc-200 bg-card p-3 shadow-sm dark:border-zinc-700"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold">{t("risksBanner")}</h2>
      </div>

      <div>
        {active.map((r, i) => (
          <div
            key={i}
            className={`dashboard-risk-row flex min-h-10 min-w-0 items-center gap-2 py-1.5 ${
              r.severity === "critical"
                ? "dashboard-risk-row--critical"
                : "dashboard-risk-row--warning"
            }`}
          >
            <AlertTriangle className="dashboard-risk-icon h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{r.titleKey ? t(r.titleKey) : r.title}</div>
              <div className="text-[10px] leading-tight text-muted-foreground">{r.descKey ? t(r.descKey, r.descParams || {}) : r.description}</div>
            </div>
            <Badge variant="outline" className="dashboard-risk-metric ml-1 shrink-0 text-[10px]">
              {r.metric}
            </Badge>
          </div>
        ))}
      </div>
    </section>
  )
}
