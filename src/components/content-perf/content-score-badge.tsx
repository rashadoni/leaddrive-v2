"use client"

/**
 * M10 Content Performance AI — slice-3 ContentScoreBadge.
 *
 * Compact color-coded chip showing the 0-100 content score. Click
 * → opens a small popover with the factor breakdown so the marketer
 * can see "why" without leaving the page.
 *
 * Mirrors the T9 HealthScoreBadge UX intentionally — a uniform "score
 * + breakdown" interaction across the product. Colors align with
 * marketing-industry sentiment:
 *   score < 30  → red (disaster / list compromised)
 *   score < 55  → amber (underperforming)
 *   score < 75  → yellow (median)
 *   score ≥ 75  → emerald (strong)
 *
 * Renders nothing when `score` is null/undefined — drop-in safe on
 * list rows for templates / campaigns that haven't been scored yet
 * (cron hasn't run, or new content).
 */
import { useState } from "react"
import { ChevronDown } from "lucide-react"

export interface ContentScoreFactors {
  baseline?: number
  openRate?: number
  clickRate?: number
  bounceRate?: number
  unsubscribeRate?: number
  spamRate?: number
  openBonus?: number
  clickBonus?: number
  bouncePenalty?: number
  unsubscribePenalty?: number
  spamPenalty?: number
  recencyPenalty?: number
  sampleSize?: number
  sampleSizeFactor?: number
}

interface Props {
  score: number | null | undefined
  factors?: ContentScoreFactors | null
  size?: "sm" | "md"
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
  if (score < 55) return "Underperforming"
  if (score < 75) return "Median"
  return "Strong"
}

function pct(v: number | undefined): string {
  if (v == null) return "—"
  return `${(v * 100).toFixed(1)}%`
}

export function ContentScoreBadge({ score, factors, size = "md", compact = false }: Props) {
  const [open, setOpen] = useState(false)
  if (score === null || score === undefined) return null

  const tint = COLOR_TINT(score)
  const sizing = size === "sm" ? "text-xs px-1.5 py-0.5" : "text-sm px-2.5 py-1"
  const baseClasses = `inline-flex items-center gap-1 rounded border font-medium ${tint} ${sizing}`

  if (compact || !factors) {
    return (
      <span className={baseClasses} title={`Score: ${score}/100 — ${LABEL_FOR(score)}`}>
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
        title={`${LABEL_FOR(score)} — click for breakdown`}
      >
        <span className="font-mono">{score}</span>
        <span className="opacity-70">·</span>
        <span>{LABEL_FOR(score)}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        // Popover uses simple `absolute top-full left-0` positioning
        // without viewport-collision logic. Fine on list cards (current
        // slice-3 use). Full-mode usage inside cramped containers
        // (e.g. Card with overflow-hidden) may clip — slice-4 should
        // migrate to Radix Popover for proper portaling + collision.
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[260px] rounded-md border bg-popover text-popover-foreground p-3 shadow-md text-xs">
          <div className="font-semibold mb-2">Score breakdown</div>

          <div className="mb-2 text-muted-foreground">
            Sample size: <span className="font-mono">{factors.sampleSize ?? 0}</span>
            {factors.sampleSizeFactor !== undefined && factors.sampleSizeFactor < 1 ? (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                (low sample — bonuses dampened to {Math.round((factors.sampleSizeFactor ?? 0) * 100)}%)
              </span>
            ) : null}
          </div>

          <FactorRow label="Open rate" pct={factors.openRate} />
          <FactorRow label="Click rate" pct={factors.clickRate} />
          <FactorRow label="Bounce rate" pct={factors.bounceRate} red />
          <FactorRow label="Unsubscribe rate" pct={factors.unsubscribeRate} red />
          <FactorRow label="Spam rate" pct={factors.spamRate} red />
        </div>
      )}
    </span>
  )
}

function FactorRow({ label, pct: pctValue, red }: { label: string; pct: number | undefined; red?: boolean }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${red ? "text-red-600 dark:text-red-400" : ""}`}>
        {pct(pctValue)}
      </span>
    </div>
  )
}
