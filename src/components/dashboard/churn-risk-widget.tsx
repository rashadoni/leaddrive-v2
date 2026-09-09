"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, Plus, Loader2 } from "lucide-react"
import Link from "next/link"

interface ChurnItem {
  companyId: string
  companyName: string
  riskScore: number
  factors: string[]
  lastActivity: string | null
}

function translateChurnFactor(factor: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (factor.startsWith("noActivity:")) {
    const days = parseInt(factor.split(":")[1], 10)
    return t("churnNoActivity", { days })
  }
  if (factor.startsWith("openTickets:")) {
    const count = parseInt(factor.split(":")[1], 10)
    return t("churnOpenTickets", { count })
  }
  if (factor === "noActiveDeals") return t("churnNoActiveDeals")
  return factor // fallback for legacy strings
}

export function ChurnRiskWidget() {
  const t = useTranslations("dashboard")
  const [data, setData] = useState<ChurnItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creatingTask, setCreatingTask] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/v1/analytics/churn-risk?limit=5")
      .then(r => r.json())
      .then(j => { if (j.success) setData(j.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleCreateCheckin = async (item: ChurnItem) => {
    setCreatingTask(item.companyId)
    try {
      await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Check-in: ${item.companyName}`,
          description: t("churnTaskDesc", { score: item.riskScore, factors: item.factors.map(f => translateChurnFactor(f, t)).join(", ") }),
          priority: item.riskScore >= 60 ? "high" : "medium",
          relatedType: "company",
          relatedId: item.companyId,
          dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
        }),
      })
    } catch {}
    setCreatingTask(null)
  }

  return (
    <div className="dashboard-bento-card rounded-lg bg-card border border-zinc-200 dark:border-zinc-700 shadow-sm p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-semibold">{t("churnRisk")}</span>
      </div>

      {loading ? (
        <div className="h-[120px] flex items-center justify-center text-xs text-muted-foreground">{t("loading")}</div>
      ) : data.length === 0 ? (
        <div className="h-[120px] flex items-center justify-center text-xs text-muted-foreground">{t("noData")}</div>
      ) : (
        <div className="space-y-2">
          {data.map(item => (
            <Link
              key={item.companyId}
              href={`/companies/${item.companyId}`}
              className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">{item.companyName}</p>
                <p className="text-[10px] text-muted-foreground truncate">{translateChurnFactor(item.factors[0], t)}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      item.riskScore >= 60 ? "bg-red-500" : item.riskScore >= 40 ? "bg-amber-500" : "bg-yellow-400"
                    }`}
                    style={{ width: `${item.riskScore}%` }}
                  />
                </div>
                <span className={`text-[10px] font-semibold w-6 text-right ${
                  item.riskScore >= 60 ? "text-red-500" : item.riskScore >= 40 ? "text-amber-500" : "text-yellow-600"
                }`}>
                  {item.riskScore}
                </span>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCreateCheckin(item) }}
                  className="h-5 w-5 rounded flex items-center justify-center hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                  title={t("churnCreateCheckin")}
                >
                  {creatingTask === item.companyId ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
