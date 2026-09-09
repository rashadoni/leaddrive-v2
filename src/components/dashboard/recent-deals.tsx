"use client"

import { useTranslations } from "next-intl"
import { Handshake, Star } from "lucide-react"
import { fmtAmount } from "@/lib/utils"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"

const stageColors: Record<string, string> = {
  LEAD: "text-muted-foreground", QUALIFIED: "text-blue-500", PROPOSAL: "text-violet-500",
  NEGOTIATION: "text-amber-500", WON: "text-emerald-500", LOST: "text-red-500",
}

export function RecentDeals({ deals }: { deals: any[] }) {
  const t = useTranslations("dashboard")

  return (
    <div className="dashboard-bento-card rounded-lg bg-card border border-zinc-200 dark:border-zinc-700 shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Handshake className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-semibold">{t("recentDeals")}</span>
        </div>
        <a href="/deals" className="text-[10px] text-violet-600 hover:underline">{t("viewAll")} →</a>
      </div>
      {deals && deals.length > 0 ? (
        <div className="space-y-1.5">
          {deals.map((d: any) => (
            <div key={d.id} className="flex items-center gap-2 py-0.5">
              <div className={`w-1 h-8 rounded-full ${canonicalDealStage(d.stage) === "WON" ? "bg-emerald-400" : canonicalDealStage(d.stage) === "LOST" ? "bg-red-400" : "bg-blue-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium truncate">{d.name}</span>
                  {canonicalDealStage(d.stage) === "WON" && <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
                </div>
                <span className="text-[10px] text-muted-foreground">{d.company?.name || "—"}</span>
              </div>
              <span className="text-xs font-semibold text-emerald-600 shrink-0">{fmtAmount(d.valueAmount || 0)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="h-[100px] flex items-center justify-center text-xs text-muted-foreground">{t("noData")}</div>
      )}
    </div>
  )
}
