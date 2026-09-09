"use client"

/**
 * T9 Proactive Service — slice-3 HealthScoreBadge.
 *
 * Compact color-coded chip showing the 0-100 score. Click → opens
 * a small tooltip popover with the factor breakdown so the rep can
 * see "why" without leaving the page.
 *
 * Color thresholds align with `THRESHOLDS` from
 * `src/lib/proactive/constants.ts`:
 *   score < 30  → critical red
 *   score < 55  → warning amber
 *   score < 75  → caution yellow
 *   score ≥ 75  → healthy green
 *
 * Renders nothing when `score` is null/undefined — drop-in safe on
 * list rows that haven't been scored yet.
 */
import { useState } from "react"
import { ChevronDown } from "lucide-react"

/** Public shape so callers (Contact / Company / Deal detail pages)
 *  can type their fetched `factors` field without an `as never` cast. */
export interface HealthScoreFactors {
  churnRiskPenalty?: number
  engagementBonus?: number
  activityPenalty?: number
  paymentOverduePenalty?: number
  contractExpiringPenalty?: number
  baseline?: number
}
type Factors = HealthScoreFactors

interface Props {
  score: number | null | undefined
  factors?: Factors | null
  size?: "sm" | "md"
  /** When true, hides the breakdown popover (use on tight list rows). */
  compact?: boolean
}

const COLOR_TINT = (score: number): string => {
  if (score < 30) return "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900"
  if (score < 55) return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900"
  if (score < 75) return "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-300 dark:border-yellow-900"
  return "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900"
}

const LABEL_FOR = (score: number): string => {
  if (score < 30) return "Critical"
  if (score < 55) return "Warning"
  if (score < 75) return "Caution"
  return "Healthy"
}

export function HealthScoreBadge({ score, factors, size = "md", compact = false }: Props) {
  const [open, setOpen] = useState(false)
  if (score === null || score === undefined) return null

  const tint = COLOR_TINT(score)
  const sizing = size === "sm" ? "text-xs px-1.5 py-0.5" : "text-sm px-2.5 py-1"
  const baseClasses = `inline-flex items-center gap-1 rounded border font-medium ${tint} ${sizing}`

  if (compact || !factors) {
    return (
      <span className={baseClasses} title={`Health: ${score}/100 — ${LABEL_FOR(score)}`}>
        <span className="font-mono">{score}</span>
      </span>
    )
  }

  return (
    <span className="inline-flex flex-col items-start gap-1 relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className={`${baseClasses} hover:opacity-80 transition-opacity cursor-pointer`}
        title={`${LABEL_FOR(score)} — click for factor breakdown`}
      >
        <span className="font-mono">{score}</span>
        <span className="opacity-70">·</span>
        <span>{LABEL_FOR(score)}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] rounded-md border bg-popover text-popover-foreground p-3 shadow-md text-xs">
          <div className="font-semibold mb-2">Why {score}/100?</div>
          <FactorRow label="Baseline" value={factors.baseline ?? 80} delta={false} />
          <FactorRow label="Churn risk" value={factors.churnRiskPenalty ?? 0} delta penalty />
          <FactorRow label="Engagement bonus" value={factors.engagementBonus ?? 0} delta />
          <FactorRow label="Activity penalty" value={factors.activityPenalty ?? 0} delta penalty />
          {factors.paymentOverduePenalty ? (
            <FactorRow label="Payment overdue" value={factors.paymentOverduePenalty} delta penalty />
          ) : null}
          {factors.contractExpiringPenalty ? (
            <FactorRow label="Contract expiring" value={factors.contractExpiringPenalty} delta penalty />
          ) : null}
        </div>
      )}
    </span>
  )
}

function FactorRow({ label, value, delta, penalty }: { label: string; value: number; delta: boolean; penalty?: boolean }) {
  const sign = !delta ? "" : penalty ? "−" : "+"
  const tint = !delta ? "text-foreground" : penalty ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${tint}`}>{sign}{Math.round(value * 100) / 100}</span>
    </div>
  )
}
