"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useTranslations } from "next-intl"
import { motion } from "framer-motion"
import { DealCard } from "./deal-card"
import { cn } from "@/lib/utils"
import { bucketByCurrency, leadBucket, formatBucket } from "@/lib/deal-money"
import { InfoHint } from "@/components/info-hint"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"

/**
 * Цвет стадии с прозрачностью — только для честного `#rrggbb`.
 *
 * Цвет стадии приходит из настроек воронки, то есть из данных тенанта, и
 * может оказаться чем угодно: именем CSS-цвета, пустой строкой, мусором.
 * Приклеивать альфу к такой строке нельзя — получится невалидный цвет и
 * колонка останется без фона. Поэтому подмешиваем только когда формат
 * распознан, а иначе возвращаем undefined и стиль просто не ставится.
 */
function tint(color: string | undefined, alpha: number): string | undefined {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined
  const hex = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0")
  return `${color}${hex}`
}

interface Stage {
  name: string
  /** Pre-localized label — the parent (deals/page.tsx) runs `stageLabel(name,
   *  displayName)` before passing stages in, so this is rendered raw here. Do
   *  NOT add a raw seed `displayName` to this prop without localizing first. */
  displayName: string
  color: string
  hint?: string
}

interface Deal {
  id: string
  name: string
  company?: string
  valueAmount: number
  currency: string
  stage: string
  assignedTo?: string
  probability: number
  stageChangedAt?: string | null
  nextTask?: { id: string; title: string; dueDate: string | null; status: string } | null
  meddpicc?: unknown
}

interface KanbanBoardProps {
  stages: Stage[]
  deals: Deal[]
  onDealClick?: (deal: Deal) => void
  onDealMove?: (dealId: string, newStage: string) => void
  onQuickAddTask?: (dealId: string, title: string) => Promise<void>
  rottingDays?: number
}

export function KanbanBoard({ stages, deals, onDealClick, onDealMove, onQuickAddTask, rottingDays = 14 }: KanbanBoardProps) {
  // Пустая колонка подписывалась английским «No deals» посреди
  // азербайджанского интерфейса — строка была вшита в разметку.
  const t = useTranslations("deals")
  const emptyLabel = t("noDeals")
  const [dragDealId, setDragDealId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  // ── Drag-time auto-scroll ──────────────────────────────────────────────
  // Columns are kept at full height so the whole pipeline is visible at a
  // glance (an internal per-column scroll would hide deals — user feedback
  // 2026-06-20). The page scroller is the dashboard <main className="flex-1
  // overflow-y-auto"> (the window itself doesn't scroll: layout is a
  // h-screen + overflow-hidden shell). Native HTML5 DnD does NOT auto-scroll
  // that container, so a card grabbed at the bottom of a long column had
  // nowhere to go. While a drag is active we run a rAF loop that scrolls the
  // nearest scrollable ancestor when the pointer nears its top/bottom edge —
  // so you can drag a card from anywhere up/down to any other column.
  const scrollEl = useRef<HTMLElement | null>(null)
  const pointerY = useRef(0)
  const rafId = useRef<number | null>(null)

  const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
    let el: HTMLElement | null = node
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el
      el = el.parentElement
    }
    return (document.scrollingElement as HTMLElement) ?? null
  }

  const autoScrollTick = useCallback(() => {
    const sc = scrollEl.current
    if (sc) {
      const rect = sc.getBoundingClientRect()
      const EDGE = 90 // px hot-zone at top/bottom of the scroller
      const MAX = 18  // px per frame at the very edge
      const y = pointerY.current
      let dy = 0
      if (y < rect.top + EDGE) dy = -MAX * Math.min(1, (rect.top + EDGE - y) / EDGE)
      else if (y > rect.bottom - EDGE) dy = MAX * Math.min(1, (y - (rect.bottom - EDGE)) / EDGE)
      if (dy !== 0) sc.scrollBy(0, dy)
    }
    rafId.current = requestAnimationFrame(autoScrollTick)
  }, [])

  const trackPointer = useCallback((e: DragEvent) => { pointerY.current = e.clientY }, [])

  const startAutoScroll = useCallback((target: HTMLElement, clientY: number) => {
    pointerY.current = clientY
    scrollEl.current = findScrollParent(target)
    document.addEventListener("dragover", trackPointer)
    if (rafId.current == null) rafId.current = requestAnimationFrame(autoScrollTick)
  }, [autoScrollTick, trackPointer])

  const stopAutoScroll = useCallback(() => {
    document.removeEventListener("dragover", trackPointer)
    if (rafId.current != null) { cancelAnimationFrame(rafId.current); rafId.current = null }
    scrollEl.current = null
  }, [trackPointer])

  // Safety net: tear down the loop/listener if the board unmounts mid-drag.
  useEffect(() => stopAutoScroll, [stopAutoScroll])

  const handleDragStart = useCallback((e: React.DragEvent, dealId: string) => {
    setDragDealId(dealId)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", dealId)
    startAutoScroll(e.currentTarget as HTMLElement, e.clientY)
  }, [startAutoScroll])

  const handleDragOver = useCallback((e: React.DragEvent, stageName: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropTarget(stageName)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDropTarget(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, stageName: string) => {
    e.preventDefault()
    const dealId = e.dataTransfer.getData("text/plain") || dragDealId
    if (dealId && onDealMove) {
      const deal = deals.find(d => d.id === dealId)
      if (deal && deal.stage !== stageName) {
        onDealMove(dealId, stageName)
      }
    }
    setDragDealId(null)
    setDropTarget(null)
    stopAutoScroll()
  }, [dragDealId, deals, onDealMove, stopAutoScroll])

  const handleDragEnd = useCallback(() => {
    setDragDealId(null)
    setDropTarget(null)
    stopAutoScroll()
  }, [stopAutoScroll])

  return (
    <div className="grid grid-cols-6 gap-3 w-full">
      {stages.map((stage, stageIdx) => {
        const stageDeals = deals.filter((d) => d.stage === stage.name)
        // Итог колонки раньше был `fmtAmount(сумма всех valueAmount)`: он
        // складывал доллары с манатами и подписывал результат символом валюты
        // по умолчанию (USD из env) — отсюда «$» в шапках над карточками,
        // которые сами показывали AZN.
        const stageBuckets = bucketByCurrency(stageDeals)
        const { primary: stageTotal, extras: stageExtras } = leadBucket(stageBuckets)
        const isDropping = dropTarget === stage.name

        return (
          <motion.div
            key={stage.name}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: stageIdx * 0.05, duration: 0.25 }}
            className="flex min-w-0 flex-col"
          >
            {/* Stage header — Ramp style with dots. Sticky so the stage name
                stays pinned at the top of the scroller while you scroll down a
                long board (otherwise you'd lose track of which column is which).
                bg-background hides cards scrolling underneath it. */}
            <div className="sticky top-0 z-10 mb-2 bg-background px-0.5 pb-2 pt-1">
              <div className="flex items-center gap-2">
                <div
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: stage.color }}
                />
                <span className="text-xs font-semibold truncate">{stage.displayName}</span>
                {stage.hint && <InfoHint text={stage.hint} size={12} />}
                {/* Счётчик в цвете стадии: единственное место, где цвет что-то
                    значит, раньше сжималось до точки в два пикселя. */}
                <span
                  className="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{ backgroundColor: tint(stage.color, 0.12), color: stage.color }}
                >
                  {stageDeals.length}
                </span>
              </div>
              {stageTotal.value > 0 && (
                <p
                  className="text-[11px] text-muted-foreground mt-0.5 pl-4 tabular-nums"
                  title={stageBuckets.map((b) => formatBucket(b)).join(" · ")}
                >
                  {formatBucket(stageTotal)}
                  {stageExtras.length > 0 && (
                    // «+1» рядом с суммой читалось как «ещё одна сделка».
                    // Это другая валюта, поэтому показываем саму сумму.
                    <span className="ml-1.5 text-muted-foreground/70">
                      + {stageExtras.map((b) => formatBucket(b)).join(" + ")}
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* Stage column body. `flex-1` makes every column stretch to the
                full board height (the grid row stretches all 6 columns to the
                tallest), so even a short column's drop zone spans the whole
                height — you can drop a card into ANY column at any scroll
                position without the others needing to be on screen. A visible
                border marks each column's edges (incl. its empty lower part).
                Full height, no internal scroll: the whole pipeline stays
                visible; drag-time page auto-scroll handles reaching far cards. */}
            <div
              className={cn(
                "min-h-[200px] flex-1 space-y-2.5 overflow-hidden rounded-xl border border-t-[3px] p-2.5 transition-all duration-200",
                isDropping
                  ? "border-primary/40 bg-primary/5 ring-2 ring-primary/30 ring-dashed"
                  : "border-zinc-200 hover:bg-muted/30 dark:border-zinc-700",
              )}
              // Колонка держит цвет своей стадии: полоса сверху и очень слабый
              // фон. Раньше цвет жил только в двухпиксельной точке заголовка, а
              // выделены фоном были лишь «выиграно» и «проиграно» — остальные
              // четыре колонки не отличались друг от друга ничем.
              style={isDropping ? undefined : {
                borderTopColor: stage.color,
                backgroundColor: tint(stage.color, 0.07),
              }}
              onDragOver={(e) => handleDragOver(e, stage.name)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.name)}
            >
              {stageDeals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  onClick={() => onDealClick?.(deal)}
                  onDragStart={(e) => handleDragStart(e, deal.id)}
                  onDragEnd={handleDragEnd}
                  isDragging={dragDealId === deal.id}
                  rottingDays={rottingDays}
                  onQuickAddTask={onQuickAddTask}
                />
              ))}

              {stageDeals.length === 0 && (
                <div className="m-1 flex h-[72px] items-center justify-center rounded-lg border border-dashed border-zinc-200 text-[11px] text-muted-foreground/50 dark:border-zinc-700">
                  {emptyLabel}
                </div>
              )}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
