"use client"

import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

interface TourStepProps {
  targetId: string
  title: string
  description: string
  step: number
  totalSteps: number
  onNext: () => void
  onPrev: () => void
  onSkip: () => void
  isFirst: boolean
  isLast: boolean
  labels?: { back?: string; next?: string; done?: string }
}

export function TourStep({
  targetId,
  title,
  description,
  step,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
  isFirst,
  isLast,
  labels,
}: TourStepProps) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [popoverSide, setPopoverSide] = useState<"bottom" | "top">("bottom")
  const [popoverSize, setPopoverSize] = useState<{ width: number; height: number }>({ width: 360, height: 180 })
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null
    const el = document.querySelector(`[data-tour-id="${targetId}"]`)
    if (!el) {
      // Target not found — auto-skip to next step after short delay
      const timer = setTimeout(() => onNext(), 100)
      return () => clearTimeout(timer)
    }

    const updatePosition = () => {
      const rect = el.getBoundingClientRect()
      setPos({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
      setPopoverSide(rect.top > window.innerHeight / 2 ? "top" : "bottom")
    }

    updatePosition()

    // Scroll into view if needed
    const rect = el.getBoundingClientRect()
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      // Recalculate after scroll
      scrollTimer = setTimeout(updatePosition, 400)
    }

    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      if (scrollTimer) clearTimeout(scrollTimer)
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [targetId, step, onNext])

  useEffect(() => {
    const node = popoverRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    setPopoverSize(prev => (
      Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
        ? prev
        : { width: rect.width, height: rect.height }
    ))
  }, [title, description, step, totalSteps, popoverSide])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSkip()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onSkip])

  if (!pos) return null

  const PADDING = 8
  const spotlightStyle = {
    top: pos.top - PADDING,
    left: pos.left - PADDING,
    width: pos.width + PADDING * 2,
    height: pos.height + PADDING * 2,
  }

  const VIEWPORT_MARGIN = 16
  const GAP = PADDING + 12
  const maxPopoverHeight = Math.max(180, window.innerHeight - VIEWPORT_MARGIN * 2)
  const measuredHeight = Math.min(popoverSize.height || 180, maxPopoverHeight)
  const measuredWidth = Math.min(popoverSize.width || 360, window.innerWidth - VIEWPORT_MARGIN * 2)
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
  const belowTop = pos.top + pos.height + GAP
  const aboveTop = pos.top - measuredHeight - GAP
  const fitsBelow = belowTop + measuredHeight <= window.innerHeight - VIEWPORT_MARGIN
  const fitsAbove = aboveTop >= VIEWPORT_MARGIN
  const resolvedSide = popoverSide === "bottom"
    ? (fitsBelow || !fitsAbove ? "bottom" : "top")
    : (fitsAbove || !fitsBelow ? "top" : "bottom")

  // Popover position — clamp to viewport so tour controls remain reachable.
  const popoverStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 10002,
    maxWidth: 360,
    width: "calc(100vw - 32px)",
    maxHeight: "calc(100vh - 32px)",
    overflowY: "auto",
    left: clamp(pos.left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerWidth - measuredWidth - VIEWPORT_MARGIN)),
    top: clamp(
      resolvedSide === "bottom" ? belowTop : aboveTop,
      VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, window.innerHeight - measuredHeight - VIEWPORT_MARGIN),
    ),
  }

  return (
    <AnimatePresence>
      {/* Overlay */}
      <motion.div
        key="tour-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[10000]"
        style={{ pointerEvents: "none" }}
      >
        {/* Dark overlay with cutout */}
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "auto" }}>
          <defs>
            <mask id="tour-spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                x={spotlightStyle.left}
                y={spotlightStyle.top}
                width={spotlightStyle.width}
                height={spotlightStyle.height}
                rx="8"
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0" y="0" width="100%" height="100%"
            fill="rgba(0,0,0,0.5)"
            mask="url(#tour-spotlight-mask)"
            onClick={onSkip}
          />
        </svg>

        {/* Spotlight ring */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute rounded-lg ring-2 ring-primary/50 ring-offset-2 ring-offset-transparent"
          style={{
            ...spotlightStyle,
            pointerEvents: "none",
          }}
        />
      </motion.div>

      {/* Popover */}
      <motion.div
        key="tour-popover"
        ref={popoverRef}
        initial={{ opacity: 0, y: resolvedSide === "bottom" ? -8 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: resolvedSide === "bottom" ? -8 : 8 }}
        transition={{ duration: 0.25, delay: 0.1 }}
        style={popoverStyle}
      >
        <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl p-4 space-y-3" style={{ pointerEvents: "auto" }}>
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="space-y-1 pr-4">
              <p className="text-sm font-semibold leading-tight">{title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            </div>
            <button
              onClick={onSkip}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-muted-foreground">
              {step + 1} / {totalSteps}
            </span>
            <div className="flex items-center gap-1.5">
              {!isFirst && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onPrev}>
                  <ChevronLeft className="h-3 w-3 mr-0.5" /> {labels?.back || "Back"}
                </Button>
              )}
              <Button size="sm" className="h-7 px-3 text-xs" onClick={isLast ? onSkip : onNext}>
                {isLast ? (labels?.done || "Done") : (labels?.next || "Next")}
                {!isLast && <ChevronRight className="h-3 w-3 ml-0.5" />}
              </Button>
            </div>
          </div>

          {/* Progress dots */}
          <div className="flex justify-center gap-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all ${
                  i === step ? "w-4 bg-primary" : i < step ? "w-1.5 bg-primary/40" : "w-1.5 bg-muted-foreground/20"
                }`}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
