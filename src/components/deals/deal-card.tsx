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

function isRotting(stageChangedAt: string | null | undefined, days: number): boolean {
  if (!stageChangedAt) return false
  const changed = new Date(stageChangedAt).getTime()
  const now = Date.now()
  return (now - changed) / 86400000 > days
}

const TRAFFIC_DOTS: Record<TrafficLight, string> = {
  green: "bg-green-500",
  red: "bg-red-500 animate-pulse",
  yellow: "bg-amber-400",
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
  const rotting = isRotting(deal.stageChangedAt, rottingDays)

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
          "rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-2.5 transition-all",
          onClick && "cursor-pointer",
          isDragging && "opacity-50 ring-2 ring-primary",
          rotting && "bg-red-50/40 dark:bg-red-950/10 border-red-200/50 dark:border-red-800/30",
          !rotting && "hover:shadow-sm",
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
            <span className="text-xs font-semibold text-primary">
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
          <MeddpiccChips meddpicc={deal.meddpicc} hideWhenEmpty className="mt-1.5 flex flex-wrap" />
        )}

        {/* Rotting indicator */}
        {rotting && (
          <div className="mt-1.5 pl-4">
            <span className="text-[10px] text-red-500 dark:text-red-400 font-medium">
              {t("daysStale", { days: Math.floor((Date.now() - new Date(deal.stageChangedAt!).getTime()) / 86400000) })}
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
