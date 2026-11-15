"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { SquareKanban } from "lucide-react"
import { readJsonSafely } from "@/lib/http/read-json-safely"
import { dealStageBar } from "@/lib/inbox/deal-stage-bar"
import { DEFAULT_CURRENCY, getCurrencySymbol } from "@/lib/currency"
import { cn } from "@/lib/utils"
import { PanelCard } from "./panel-card"

type DealRow = {
  id: string
  name: string
  stage: string
  pipelineId: string | null
  valueAmount: number | string | null
  currency: string | null
}

type PipelineStage = { name: string; displayName: string | null; color: string | null; isWon?: boolean; isLost?: boolean; sortOrder?: number }

/**
 * «Sövdələşmə» — the customer's open deal with its stages (owner-approved mock-up, 2026-11-15).
 * Open = not won and not lost by the organization's own stage names (`/deals?open=1`, server-side
 * `orgStageVocabulary`). No open deal, or no right to see deals — no card.
 */
export function DealCard({ contactId, headers, refreshKey }: { contactId: string; headers: Record<string, string>; refreshKey: number }) {
  const t = useTranslations("inboxPanel")
  const locale = useLocale()
  const [deals, setDeals] = useState<DealRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [stages, setStages] = useState<PipelineStage[]>([])

  useEffect(() => {
    let alive = true
    setDeals(null)
    setStages([])
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/deals?contactId=${encodeURIComponent(contactId)}&open=1&limit=5`, { headers })
        const json = await readJsonSafely<{ data?: { deals?: DealRow[]; total?: number } }>(res)
        if (!alive) return
        const rows = res.ok && Array.isArray(json?.data?.deals) ? json!.data!.deals! : []
        setDeals(rows)
        setTotal(typeof json?.data?.total === "number" ? json.data.total : rows.length)
        const pipelineId = rows[0]?.pipelineId
        if (!pipelineId) return
        const pipe = await fetch(`/api/v1/pipelines/${encodeURIComponent(pipelineId)}`, { headers })
        const pipeJson = await readJsonSafely<{ data?: { stages?: PipelineStage[] } }>(pipe)
        if (alive && pipe.ok && Array.isArray(pipeJson?.data?.stages)) setStages(pipeJson!.data!.stages!)
      } catch {
        if (alive) setDeals([])
      }
    })()
    return () => { alive = false }
  }, [contactId, headers, refreshKey])

  const deal = deals?.[0]
  if (!deal) return null
  const amount = Number(deal.valueAmount ?? 0)
  const bar = dealStageBar(stages, deal.stage)
  const currentStep = bar.find((step) => step.current)
  const showAllLabels = bar.length > 0 && bar.length <= 5

  return (
    <PanelCard
      testId="inbox-panel-deal"
      title={t("dealTitle")}
      action={total > 1 ? <span className="text-[10.5px] font-semibold text-muted-foreground">{t("dealMore", { count: total - 1 })}</span> : null}
    >
      <Link href={`/deals/${deal.id}`} className="flex items-center gap-2.5 rounded-lg hover:bg-muted/40">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
          <SquareKanban className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[12.5px] font-semibold">{deal.name}</b>
          {!showAllLabels && (currentStep || deal.stage) ? (
            <small className="block truncate text-[10.5px] text-muted-foreground">{currentStep?.label ?? deal.stage}</small>
          ) : null}
        </span>
        {amount > 0 ? (
          <span className="shrink-0 text-base font-extrabold text-foreground">{amount.toLocaleString(locale, { maximumFractionDigits: 2 })} {getCurrencySymbol(deal.currency || DEFAULT_CURRENCY)}</span>
        ) : null}
      </Link>
      {bar.length > 0 ? (
        <>
          <div className="mt-2.5 flex gap-1" aria-hidden="true">
            {bar.map((step, i) => <span key={i} className={cn("h-[5px] flex-1 rounded-full", step.done ? "bg-orange-500" : "bg-muted")} />)}
          </div>
          {showAllLabels ? (
            <div className="mt-1 flex justify-between gap-1 text-[9.5px] font-semibold text-muted-foreground">
              {bar.map((step, i) => (
                <span key={i} className={cn("min-w-0 truncate", step.current && "font-bold text-orange-700 dark:text-orange-300")}>{step.label}</span>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </PanelCard>
  )
}
