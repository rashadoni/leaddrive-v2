"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Activity, Gauge } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Creatio AI-Studio-style "Agent Metrics" section: Sessions Served,
 * Success Rate, an hourly "Sessions over time" bar chart and latency
 * percentiles. Pure presentation over data the command center already
 * fetches — no extra requests, no chart dependency.
 */

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

export function AgentMetricsSection({
  sessionsServed,
  successRate,
  sessionDates,
  latenciesMs,
  avgLatencyMs,
}: {
  sessionsServed: number
  successRate: number
  sessionDates: string[]
  latenciesMs: Array<number | null>
  avgLatencyMs?: number | null
}) {
  const t = useTranslations("ai")

  // 24 hourly buckets ending at the current hour (recent capped sample).
  const buckets = useMemo(() => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const start = now.getTime() - 23 * 3_600_000
    const counts = new Array<number>(24).fill(0)
    for (const d of sessionDates) {
      const ts = new Date(d).getTime()
      const idx = Math.floor((ts - start) / 3_600_000)
      if (idx >= 0 && idx < 24) counts[idx]++
    }
    return counts.map((count, i) => {
      const h = new Date(start + i * 3_600_000)
      return { count, label: `${String(h.getHours()).padStart(2, "0")}:00` }
    })
  }, [sessionDates])

  const maxCount = Math.max(1, ...buckets.map(b => b.count))

  const latStats = useMemo(() => {
    const vals = latenciesMs.filter((v): v is number => typeof v === "number" && v > 0).sort((a, b) => a - b)
    return { p50: percentile(vals, 50), p95: percentile(vals, 95) }
  }, [latenciesMs])

  const fmtMs = (v: number | null | undefined) =>
    v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold">{t("agentMetricsTitle")}</h2>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5 mb-4">{t("agentMetricsSubtitle")}</p>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* Left: headline stats */}
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
            <p className="text-xs text-muted-foreground">{t("sessionsServed")}</p>
            <p className="text-3xl font-bold mt-1">{sessionsServed.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
            <p className="text-xs text-muted-foreground">{t("successRate")}</p>
            <p className={cn(
              "text-3xl font-bold mt-1",
              successRate >= 50 ? "text-green-600 dark:text-green-400" : "text-amber-500",
            )}>
              {successRate.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Right: sessions over time + latency */}
        <div className="min-w-0">
          <p className="text-xs font-semibold mb-2">{t("sessionsOverTime")}</p>
          <div className="flex items-end gap-[3px] h-28" role="img" aria-label={t("sessionsOverTime")}>
            {buckets.map((b, i) => (
              <div key={i} className="flex-1 min-w-0 flex flex-col items-center gap-1 h-full justify-end">
                <div
                  className={cn("w-full rounded-t-sm", b.count > 0 ? "bg-blue-500" : "bg-muted")}
                  style={{ height: b.count > 0 ? `${Math.max(6, (b.count / maxCount) * 100)}%` : "3px" }}
                  title={`${b.label} — ${b.count}`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1 text-[9px] text-muted-foreground">
            {buckets.filter((_, i) => i % 4 === 0).map((b, i) => (
              <span key={i}>{b.label}</span>
            ))}
          </div>

          {/* Latency */}
          <div className="flex items-center gap-6 mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-700">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-muted-foreground" /> {t("latencyTitle")}
            </p>
            <div className="flex items-center gap-5 text-sm">
              <span><span className="text-xs text-muted-foreground mr-1">{t("latencyAvg")}</span><b>{fmtMs(avgLatencyMs)}</b></span>
              <span><span className="text-xs text-muted-foreground mr-1">p50</span><b>{fmtMs(latStats.p50)}</b></span>
              <span><span className="text-xs text-muted-foreground mr-1">p95</span><b>{fmtMs(latStats.p95)}</b></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
