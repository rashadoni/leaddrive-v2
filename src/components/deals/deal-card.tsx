"use client"

import { useState, useRef, useEffect } from "react"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { MeddpiccChips } from "@/components/deals/meddpicc-chips"
import { Plus, Loader2 } from "lucide-react"
import { formatAmount } from "@/lib/deal-money"

interface DealCardProps {
  deal: {
    id: string
    name: string
    company?: string
    valueAmount: number
    currency: string
    assignedTo?: string
    probability: number
    stageChangedAt?: string | null
    nextTask?: { id: string; title: string; dueDate: string | null; status: string } | null
    meddpicc?: unknown
  }
  onClick?: () => void
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  isDragging?: boolean
  rottingDays?: number
  onQuickAddTask?: (dealId: string, title: string) => Promise<void>
}

type TrafficLight = "green" | "red" | "yellow"

function getTrafficLight(deal: DealCardProps["deal"]): TrafficLight {
  if (!deal.nextTask) return "yellow"
  if (deal.nextTask.status === "completed") return "yellow"
  if (deal.nextTask.dueDate) {
    const due = new Date(deal.nextTask.dueDate)
    if (due < new Date()) return "red"
  }
  return "green"
}

/**
 * Застой рисуется не «есть/нет», а по степени.
 *
 * Раньше любая сделка старше порога заливалась розовым целиком. На живой
 * доске в стадиях лежат месяцами, поэтому розовыми были почти все карточки —
 * сигнал, который срабатывает на десяти карточках из двенадцати, перестаёт
 * быть сигналом, а доска читается как «всё горит». Порог не трогаем (это
 * настройка организации), меняется только громкость: тонкая полоса слева,
 * цвет которой зависит от того, во сколько раз превышен порог.
 */
type StaleTier = "none" | "warn" | "high" | "critical"

function staleDays(stageChangedAt: string | null | undefined): number | null {
  if (!stageChangedAt) return null
  return Math.floor((Date.now() - new Date(stageChangedAt).getTime()) / 86400000)
}

function staleTier(days: number | null, threshold: number): StaleTier {
  if (days === null || threshold <= 0 || days <= threshold) return "none"
  if (days > threshold * 4) return "critical"
  if (days > threshold * 2) return "high"
  return "warn"
}

const STALE_EDGE: Record<StaleTier, string> = {
  none: "border-l-transparent",
  warn: "border-l-amber-300 dark:border-l-amber-500/60",
  high: "border-l-orange-400 dark:border-l-orange-500/70",
  critical: "border-l-red-500 dark:border-l-red-500/80",
}

const STALE_TEXT: Record<StaleTier, string> = {
  none: "",
  warn: "text-muted-foreground",
  high: "text-orange-600 dark:text-orange-400",
  critical: "text-red-600 dark:text-red-400 font-medium",
}

// Жёлтый — это «задачи не назначено», состояние по умолчанию у большинства
// карточек. Заливкой оно читалось как предупреждение и складывалось с двумя
// другими тревожными сигналами на той же карточке, поэтому теперь это пустое
// кольцо. Красный (просроченная задача) больше не пульсирует: цвета хватает,
// а пульсация на доске из двадцати карточек не даёт смотреть ни на что.
const TRAFFIC_DOTS: Record<TrafficLight, string> = {
  green: "bg-emerald-500",
  red: "bg-red-500",
  yellow: "bg-transparent ring-1 ring-inset ring-zinc-300 dark:ring-zinc-600",
}

export function DealCard({ deal, onClick, onDragStart, onDragEnd, isDragging, rottingDays = 14, onQuickAddTask }: DealCardProps) {
  const t = useTranslations("deals")
  const [quickAdd, setQuickAdd] = useState(false)
  const [taskTitle, setTaskTitle] = useState("")
  const [saving, setSaving] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close the quick-add popover when the user clicks anywhere outside it.
  // Replaces the previous onMouseLeave-on-card reset, which fired the moment
  // the cursor passed through the gap between the card and the popover
  // (popover sits at `top-full` — below the card's hit box).
  useEffect(() => {
    if (!quickAdd) return
    function onDocMouseDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setQuickAdd(false)
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [quickAdd])

  // «Royal Park» с подзаголовком «Royal park» — это не два факта, а один,
  // набранный дважды в разном регистре. Подпись показывается, только когда
  // компания добавляет что-то к названию сделки.
  const companyLine =
    deal.company && deal.company.trim().toLowerCase() !== deal.name.trim().toLowerCase()
      ? deal.company
      : null

  const light = getTrafficLight(deal)
  const daysStale = staleDays(deal.stageChangedAt)
  const tier = staleTier(daysStale, rottingDays)

  const TRAFFIC_TITLES: Record<TrafficLight, string> = {
    green: t("trafficTaskScheduled"),
    red: t("trafficOverdueTask"),
    yellow: t("trafficNoUpcomingTask"),
  }

  const handleQuickAdd = async () => {
    if (!taskTitle.trim() || !onQuickAddTask) return
    setSaving(true)
    try {
      await onQuickAddTask(deal.id, taskTitle.trim())
      setTaskTitle("")
      setQuickAdd(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1 }}
      transition={{ duration: 0.2 }}
      // z-30 when the quick-add popover is open — otherwise the NEXT card's
      // `.relative` (its own stacking context, later in DOM order) paints on
      // top of this card's popover (which lives in THIS card's stacking
      // context and so can't escape it).
      className={cn("relative group", quickAdd && "z-30")}
    >
      <div
        className={cn(
          "rounded-lg border border-l-[3px] border-zinc-200 dark:border-zinc-700 bg-card p-2.5 shadow-[0_1px_2px_rgba(24,32,50,0.05)] transition-all",
          "hover:shadow-[0_4px_12px_rgba(24,32,50,0.10)]",
          onClick && "cursor-pointer",
          isDragging && "opacity-50 ring-2 ring-primary",
          STALE_EDGE[tier],
        )}
        onClick={onClick}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        {/* Traffic light dot */}
        <div className="flex items-start gap-2">
          <div
            className={cn("h-2 w-2 rounded-full flex-shrink-0 mt-1", TRAFFIC_DOTS[light])}
            title={TRAFFIC_TITLES[light]}
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-xs leading-tight truncate">{deal.name}</p>
            {companyLine && (
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">{companyLine}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-1.5 pl-4">
          <div className="flex items-center gap-1.5">
            {/* Сумма была оранжевой на каждой карточке — тем же цветом, что и
                кнопка действия и полоса стадий: три разные вещи одним акцентом.
                Деньги здесь — данные, а не действие. */}
            <span className="text-xs font-semibold tabular-nums">
              {formatAmount(deal.valueAmount || 0, deal.currency)}
            </span>
            {deal.probability > 0 && (
              <span className={cn(
                "text-[9px] font-semibold px-1 py-0.5 rounded",
                deal.probability >= 70 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                deal.probability >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              )}>
                {deal.probability}%
              </span>
            )}
          </div>
          {deal.assignedTo && (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium flex-shrink-0">
              {deal.assignedTo.charAt(0)}
            </div>
          )}
        </div>

        {/* D2 — MEDDPICC chips; the component hides itself while unscored */}
        {deal.meddpicc != null && (
          <MeddpiccChips meddpicc={deal.meddpicc} hideWhenEmpty compact className="mt-1.5 ml-4" />
        )}

        {/* Rotting indicator */}
        {tier !== "none" && daysStale !== null && (
          <div className="mt-1.5 pl-4">
            <span className={cn("text-[10px]", STALE_TEXT[tier])}>
              {t("daysStale", { days: daysStale })}
            </span>
          </div>
        )}
      </div>

      {/* Quick-add task button — always in DOM (when applicable), revealed via
          CSS group-hover. Using JS `hovered` state failed because the button
          sits half-outside the card (`-bottom-2`); the cursor's trip across
          that 0.5rem gap fired onMouseLeave on the card and unmounted the
          button before the click could land. */}
      {onQuickAddTask && !quickAdd && (
        <button
          type="button"
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium shadow-md hover:shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          onClick={e => { e.stopPropagation(); setQuickAdd(true) }}
        >
          <Plus className="h-3 w-3" /> {t("quickAddTask")}
        </button>
      )}

      {/* Quick-add task popover */}
      {quickAdd && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-full left-0 right-0 z-20 mt-1 p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card shadow-lg"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex gap-1.5">
            <input
              autoFocus
              className="flex-1 h-7 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 text-[11px] bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={t("taskTitlePlaceholder")}
              value={taskTitle}
              onChange={e => setTaskTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleQuickAdd(); if (e.key === "Escape") setQuickAdd(false) }}
            />
            <button
              className="h-7 w-7 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={!taskTitle.trim() || saving}
              onClick={handleQuickAdd}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
