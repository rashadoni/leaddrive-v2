"use client"

/**
 * Sortable list/table view of the KPI Arena — the "after the bubbles" ranked
 * board (toggle with the bubble canvas). Reuses the shared <DataTable> (client
 * sort/search/paginate). Row click opens the same AgentDetailCard.
 */
import { DataTable } from "@/components/data-table"
import { useTranslations } from "next-intl"
import { attainmentColor } from "@/lib/leaderboard/colors"
import { AgentAvatar } from "@/components/leaderboard/agent-avatar"
import { StatusMarker } from "@/components/leaderboard/status-glyph"
import type { NormalizedAgent } from "@/lib/leaderboard/types"

// DataTable's generic needs an index signature; NormalizedAgent (an interface)
// lacks one, so widen with Record for the table only.
type AgentRow = NormalizedAgent & Record<string, unknown>

function formatVolume(a: NormalizedAgent): string {
  if (a.volumeFormat === "currency") {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: a.currency || "AZN",
      maximumFractionDigits: 0,
    }).format(a.volume)
  }
  return new Intl.NumberFormat().format(a.volume)
}

export function LeaderboardTable({
  agents,
  onSelect,
}: {
  agents: NormalizedAgent[]
  onSelect?: (agent: NormalizedAgent) => void
}) {
  const t = useTranslations("leaderboard")

  const columns = [
    {
      key: "rank",
      label: "#",
      sortable: true,
      className: "w-12",
      render: (a: AgentRow) => <span className="font-semibold tabular-nums text-muted-foreground">{a.rank}</span>,
    },
    {
      key: "name",
      label: t("table.agent"),
      sortable: true,
      render: (a: AgentRow) => {
        const c = attainmentColor(a.attainmentPct)
        return (
          <div className="flex items-center gap-2.5">
            <AgentAvatar src={a.avatar} name={a.name} ring={c.ring} fill={c.fill} size={28} />
            <span className="font-medium">{a.name}</span>
          </div>
        )
      },
    },
    {
      key: "attainmentPct",
      label: t("table.kpi"),
      sortable: true,
      render: (a: AgentRow) => (
        <span className="font-bold tabular-nums" style={{ color: attainmentColor(a.attainmentPct).ring }}>
          {Math.round(a.attainmentPct)}%
        </span>
      ),
    },
    {
      key: "status",
      label: t("table.status"),
      sortable: true,
      render: (a: AgentRow) => (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <StatusMarker status={a.status} className="h-3.5 w-3.5" />
          {t(`status.${a.status}`)}
        </span>
      ),
    },
    {
      key: "volume",
      label: t("table.volume"),
      sortable: true,
      render: (a: AgentRow) => <span className="tabular-nums">{formatVolume(a)}</span>,
    },
  ]

  return (
    <DataTable<AgentRow>
      columns={columns}
      data={agents as AgentRow[]}
      searchKey="name"
      searchPlaceholder={t("table.search")}
      pageSize={20}
      onRowClick={(a) => onSelect?.(a as NormalizedAgent)}
    />
  )
}
