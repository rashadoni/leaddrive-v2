"use client"

import { useTranslations } from "next-intl"
import { BarChart3 } from "lucide-react"
import { MiniBarChart } from "@/components/charts/mini-charts"

export function WeeklyMetrics({ metrics }: { metrics: any }) {
  const t = useTranslations("dashboard")

  const totalLeads = (metrics?.leadsPerDay || []).reduce((s: number, v: number) => s + v, 0)
  const totalTickets = (metrics?.ticketsPerDay || []).reduce((s: number, v: number) => s + v, 0)

  return (
    <div className="dashboard-bento-card rounded-lg bg-card border border-zinc-200 dark:border-zinc-700 shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t("weeklyMetrics")}</span>
        </div>
      </div>
      <div className="space-y-2.5">
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-muted-foreground">{t("weeklyLeads")}</span>
            <span className="text-[10px] font-semibold text-violet-600">{totalLeads}</span>
          </div>
          <MiniBarChart data={metrics?.leadsPerDay?.length > 0 ? metrics.leadsPerDay : [0,0,0,0,0,0,0]} color="bg-violet-400" height="h-7" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-muted-foreground">{t("weeklyTickets")}</span>
            <span className="text-[10px] font-semibold text-cyan-600">{totalTickets}</span>
          </div>
          <MiniBarChart data={metrics?.ticketsPerDay?.length > 0 ? metrics.ticketsPerDay : [0,0,0,0,0,0,0]} color="bg-cyan-400" height="h-7" />
        </div>
        <div className="grid grid-cols-3 gap-1 pt-2 border-t border-zinc-200 dark:border-zinc-700">
          <div className="text-center">
            <div className="text-sm font-bold">{metrics?.slaCompliance ?? 0}%</div>
            <div className="text-[8px] text-muted-foreground">{t("slaCompliance")}</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold text-emerald-600">{metrics?.csat ? metrics.csat.toFixed(1) : "—"}</div>
            <div className="text-[8px] text-muted-foreground">CSAT</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold text-violet-600">{metrics?.avgResponseHours ? `${metrics.avgResponseHours}h` : "—"}</div>
            <div className="text-[8px] text-muted-foreground">{t("avgResponse")}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
