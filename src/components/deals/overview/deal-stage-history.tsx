"use client"

/**
 * How long the deal stood on each stage, read from the record's journal.
 * With no recorded move it says only what is known — the current stage since
 * the deal was created — and says that the journal has nothing more.
 */
import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format-date"
import { stageChanges, stageSegments, type AuditEntryLike } from "@/lib/deals/deal-overview"

export function DealStageHistory({ dealId, orgId, createdAt, currentStage, stageLabels }: {
  dealId: string
  orgId?: string
  createdAt: string
  currentStage: string
  stageLabels: Record<string, string>
}) {
  const t = useTranslations("dealPage")
  const locale = useLocale()
  const [entries, setEntries] = useState<AuditEntryLike[] | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/v1/audit-log?entityType=deal&entityId=${dealId}&limit=100`, { headers: orgId ? { "x-organization-id": orgId } : undefined })
      .then((r) => r.json())
      .then((j) => { if (alive) setEntries(j.success ? (j.data?.logs || j.data || []) : []) })
      .catch(() => { if (alive) setEntries([]) })
    return () => { alive = false }
    // The current stage is a dependency: a move made on this page is a new line of the journal.
  }, [dealId, orgId, currentStage])

  const now = useMemo(() => new Date(), [])
  if (entries === null) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />

  const changes = stageChanges(entries)
  const segments = stageSegments(createdAt, currentStage, changes, now)
  const longest = Math.max(1, ...segments.map((s) => s.days))
  const total = segments.reduce((sum, s) => sum + s.days, 0)

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        {t("historyTotal", { days: total })}{changes.length === 0 && ` ${t("historyNoMoves")}`}
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{t("historyStage")}</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">{t("historyFrom")}</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">{t("historyTo")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("historyDays")}</th>
              <th className="w-[34%] px-4 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {segments.map((segment, index) => (
              <tr key={`${segment.from}-${index}`} className="border-t border-border">
                <td className="px-4 py-2.5 font-semibold">{segment.stage ? (stageLabels[segment.stage] || segment.stage) : t("historyUnknownStage")}</td>
                <td className="hidden px-4 py-2.5 sm:table-cell">{formatDate(segment.from, locale)}</td>
                <td className="hidden px-4 py-2.5 sm:table-cell">{segment.to ? formatDate(segment.to, locale) : <Badge variant="info">{t("historyNow")}</Badge>}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{segment.days}</td>
                <td className="px-4 py-2.5">
                  <span className="block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${Math.max(2, (segment.days / longest) * 100)}%` }} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
