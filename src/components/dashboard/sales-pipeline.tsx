"use client"

import { useTranslations } from "next-intl"
import { Target } from "lucide-react"
import { STAGE_COLORS } from "@/lib/constants"
import { fmtCurrencyCompact } from "@/lib/utils"
const stageKeys: Record<string, string> = {
  LEAD: "stageLead", QUALIFIED: "stageQualified", PROPOSAL: "stageProposal",
  NEGOTIATION: "stageNegotiation", WON: "stageWon", LOST: "stageLost",
}

function fmt(n: number): string {
  return fmtCurrencyCompact(n)
}

export function SalesPipeline({ pipeline }: { pipeline: any }) {
  const t = useTranslations("dashboard")
  const td = useTranslations("deals")
  const stageOrder = ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON"]
  const stages = pipeline?.stages || []

  return (
    <div className="dashboard-bento-card rounded-lg bg-card border border-zinc-200 dark:border-zinc-700 shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Target className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-semibold">{t("salesPipeline")}</span>
        </div>
        <span className="text-xs font-semibold text-blue-600">{fmt(pipeline?.wonValue || 0)}</span>
      </div>
      <div className="space-y-1.5">
        {stageOrder.map(stage => {
          const s = stages.find((x: any) => x.stage === stage)
          if (!s) return null
          const maxCount = Math.max(...stages.map((x: any) => x.count || 1))
          const width = Math.max((s.count / maxCount) * 100, 12)
          return (
            <div key={stage} className="flex items-center gap-2">
              <span className="text-[10px] w-[72px] text-muted-foreground truncate">{stageKeys[stage] ? td(stageKeys[stage]) : stage}</span>
              <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                <div
                  className="h-full rounded flex items-center px-1.5"
                  style={{ width: `${width}%`, backgroundColor: STAGE_COLORS[stage] }}
                >
                  <span className="text-[10px] text-white font-medium">{s.count}</span>
                </div>
              </div>
              <span className="text-[10px] font-mono w-12 text-right text-muted-foreground">{s.value?.toLocaleString()}</span>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-3 gap-1 pt-2 mt-2 border-t border-zinc-200 dark:border-zinc-700 text-center">
        <div>
          <div className="text-sm font-bold text-emerald-600">{pipeline?.wonThisMonth || 0}</div>
          <div className="text-[8px] text-muted-foreground">{t("won")}</div>
        </div>
        <div>
          <div className="text-sm font-bold text-red-500">{pipeline?.lostThisMonth || 0}</div>
          <div className="text-[8px] text-muted-foreground">{t("lost")}</div>
        </div>
        <div>
          <div className="text-sm font-bold text-blue-600">{pipeline?.conversionRate || 0}%</div>
          <div className="text-[8px] text-muted-foreground">{t("conversion")}</div>
        </div>
      </div>
    </div>
  )
}
