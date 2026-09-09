"use client"

/**
 * Colour-scale legend for the KPI Arena: explains that green = beating the KPI
 * target and red = far behind, plus what bubble SIZE encodes. Pure presentational.
 */
import { useTranslations } from "next-intl"
import { StatusMarker } from "@/components/leaderboard/status-glyph"
import type { AgentStatus } from "@/lib/leaderboard/types"

const ORDER: AgentStatus[] = ["exceeding", "on_track", "behind", "at_risk", "critical"]

export function LeaderboardLegend() {
  const t = useTranslations("leaderboard")
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className="font-medium text-foreground">{t("legend.colorSize")}:</span>
        {ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <StatusMarker status={s} className="h-3 w-3" />
            {t(`status.${s}`)}
          </span>
        ))}
      </div>
      <span>{t("legend.sizeHint")}</span>
    </div>
  )
}
