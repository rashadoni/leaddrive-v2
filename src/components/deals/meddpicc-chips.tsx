"use client"

/**
 * D2 (Creatio 10X roadmap) — compact MEDDPICC letter chips for deal lists:
 * 8 letters, each colored by its block's score (red 1-2 / yellow 3 / green
 * 4-5, muted when unscored). Tooltip carries the block name + score.
 */
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import {
  MEDDPICC_BLOCKS,
  MEDDPICC_LETTERS,
  parseMeddpicc,
  scoreBucket,
  summarizeMeddpicc,
} from "@/lib/meddpicc"

// Hue mapping (red/amber/emerald) must stay in sync with STATUS_STYLES and
// BUCKET_BTN in deal-meddpicc.tsx — Tailwind needs literal class strings, so
// the three surfaces keep their own maps on purpose.
const BUCKET_CHIP: Record<string, string> = {
  none: "bg-muted text-muted-foreground/60",
  red: "bg-red-500/90 text-white",
  yellow: "bg-amber-500/90 text-white",
  green: "bg-emerald-500/90 text-white",
}

// Компактный вид: одна плашка вместо восьми кружков.
const BUCKET_PILL: Record<string, string> = {
  unscored: "bg-muted text-muted-foreground",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  yellow: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
}

export function MeddpiccChips({
  meddpicc,
  className,
  hideWhenEmpty = false,
  compact = false,
}: {
  meddpicc: unknown
  className?: string
  /** Kanban cards drop the row entirely when nothing is scored; the list keeps the muted letters as an "unassessed" cue. */
  hideWhenEmpty?: boolean
  /**
   * Одна плашка «MEDDPICC 5/8» вместо восьми буквенных кружков. Восемь
   * цветных кружков на карточке канбана переносились на вторую строку и
   * занимали больше места, чем название сделки, — из-за чего соседние
   * карточки в колонке расходились по высоте. Полная раскладка остаётся в
   * списке и в карточке сделки.
   */
  compact?: boolean
}) {
  const t = useTranslations("meddpicc")
  const data = parseMeddpicc(meddpicc)
  if (hideWhenEmpty && Object.keys(data).length === 0) return null
  if (compact) {
    const summary = summarizeMeddpicc(data)
    const detail = MEDDPICC_BLOCKS
      .map((key) => `${t(`block_${key}`)}: ${data[key]?.score !== undefined ? `${data[key]!.score}/5` : "—"}`)
      .join("\n")
    return (
      <span
        title={detail}
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none",
          BUCKET_PILL[summary.status] ?? BUCKET_PILL.unscored,
          className,
        )}
      >
        MEDDPICC
        <span className="tabular-nums opacity-80">{summary.scored}/{MEDDPICC_BLOCKS.length}</span>
      </span>
    )
  }
  return (
    <span className={cn("inline-flex gap-0.5", className)}>
      {MEDDPICC_BLOCKS.map((key) => {
        const score = data[key]?.score
        return (
          <span
            key={key}
            title={`${t(`block_${key}`)}${score !== undefined ? `: ${score}/5` : ""}`}
            className={cn(
              "inline-flex h-4 w-4 min-w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold leading-none",
              BUCKET_CHIP[scoreBucket(score)],
            )}
          >
            {MEDDPICC_LETTERS[key]}
          </span>
        )
      })}
    </span>
  )
}
