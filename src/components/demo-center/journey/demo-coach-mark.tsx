"use client"

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { useReducedMotion } from "framer-motion"
import { ChevronLeft, ChevronRight, SkipForward } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DemoStepPlacement } from "@/lib/demo-center/journey"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/**
 * Coach mark for the guided demo.
 *
 * Same visual language as the in-app tour (`src/components/tour/tour-step.tsx`)
 * — a highlighted ring on the real control and a small card next to it — but
 * with the rules a guided story needs and the tour does not:
 *   - it never blocks the control: the dim is a box-shadow on a
 *     pointer-events-none ring, so the prospect clicks the real button;
 *   - a missing anchor is reported (`onMissing`) instead of silently
 *     skipping the step;
 *   - action steps show no «Next»: they close only when the state changes;
 *   - Escape does not dismiss a required step.
 */

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface DemoCoachMarkProps {
  /** Re-locates the anchor when it changes. */
  stepKey: string
  anchor: string
  placement: DemoStepPlacement
  title: string
  instruction: string
  counter: string
  mode: "observe" | "action"
  canBack: boolean
  canSkip: boolean
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onMissing: (missing: boolean) => void
}

const PADDING = 6
const GAP = 14
const VIEWPORT_MARGIN = 16
const LOCATE_INTERVAL_MS = 120
const LOCATE_ATTEMPTS = 25

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function DemoCoachMark({
  stepKey,
  anchor,
  placement,
  title,
  instruction,
  counter,
  mode,
  canBack,
  canSkip,
  onNext,
  onBack,
  onSkip,
  onMissing,
}: DemoCoachMarkProps) {
  const reducedMotion = useReducedMotion()
  const [rect, setRect] = useState<Rect | null>(null)
  const [size, setSize] = useState({ width: 340, height: 160 })
  const popoverRef = useRef<HTMLDivElement>(null)

  // Locate the anchor. Scenes render tabs and cards a tick after the step
  // changes, so poll briefly before declaring the anchor missing.
  useEffect(() => {
    let attempts = 0
    let cleanupPosition: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const attach = (found: Element) => {
      const update = () => {
        const box = found.getBoundingClientRect()
        setRect({ top: box.top, left: box.left, width: box.width, height: box.height })
      }
      update()
      const box = found.getBoundingClientRect()
      if (box.top < 0 || box.bottom > window.innerHeight) {
        found.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" })
        timer = setTimeout(update, reducedMotion ? 0 : 400)
      }
      const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null
      observer?.observe(found)
      window.addEventListener("resize", update)
      window.addEventListener("scroll", update, true)
      cleanupPosition = () => {
        observer?.disconnect()
        window.removeEventListener("resize", update)
        window.removeEventListener("scroll", update, true)
      }
      onMissing(false)
    }

    const locate = () => {
      const found = document.querySelector(`[data-tour-id="${anchor}"]`)
      if (found) {
        attach(found)
        return
      }
      attempts += 1
      if (attempts >= LOCATE_ATTEMPTS) {
        setRect(null)
        onMissing(true)
        return
      }
      timer = setTimeout(locate, LOCATE_INTERVAL_MS)
    }

    // Deferred by a tick on purpose: scenes mount their tabs and cards right
    // after the step changes, and nothing should set state during the effect.
    timer = setTimeout(locate, 0)
    return () => {
      if (timer) clearTimeout(timer)
      cleanupPosition?.()
    }
  }, [anchor, stepKey, onMissing, reducedMotion])

  useLayoutEffect(() => {
    const node = popoverRef.current
    if (!node) return
    const box = node.getBoundingClientRect()
    setSize((previous) =>
      Math.abs(previous.width - box.width) < 1 && Math.abs(previous.height - box.height) < 1
        ? previous
        : { width: box.width, height: box.height },
    )
  }, [title, instruction, counter, mode, rect])

  // Move focus to the card so screen readers announce the step; the control
  // itself stays reachable with Tab.
  const located = rect !== null
  useEffect(() => {
    if (located) popoverRef.current?.focus({ preventScroll: true })
  }, [stepKey, located])

  if (!rect) return null

  const ring: Rect = {
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  }

  const maxWidth = Math.min(340, window.innerWidth - VIEWPORT_MARGIN * 2)
  const width = Math.min(size.width || 340, maxWidth)
  const height = Math.min(size.height || 160, window.innerHeight - VIEWPORT_MARGIN * 2)

  const fits = {
    bottom: ring.top + ring.height + GAP + height <= window.innerHeight - VIEWPORT_MARGIN,
    top: ring.top - GAP - height >= VIEWPORT_MARGIN,
    right: ring.left + ring.width + GAP + width <= window.innerWidth - VIEWPORT_MARGIN,
    left: ring.left - GAP - width >= VIEWPORT_MARGIN,
  }
  const preferred: Exclude<DemoStepPlacement, "auto">[] =
    placement === "auto" ? ["bottom", "top", "right", "left"] : [placement, "bottom", "top", "right", "left"]
  const side = preferred.find((candidate) => fits[candidate]) ?? "bottom"

  let top: number
  let left: number
  if (side === "bottom") {
    top = ring.top + ring.height + GAP
    left = ring.left
  } else if (side === "top") {
    top = ring.top - GAP - height
    left = ring.left
  } else if (side === "right") {
    top = ring.top
    left = ring.left + ring.width + GAP
  } else {
    top = ring.top
    left = ring.left - GAP - width
  }

  const popoverStyle: CSSProperties = {
    position: "fixed",
    zIndex: 10002,
    width,
    maxWidth,
    maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`,
    overflowY: "auto",
    left: clamp(left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)),
    top: clamp(top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)),
  }

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="demo-coach-ring"
        className={cn(
          "pointer-events-none fixed z-[10000] rounded-lg ring-2 ring-[#FF4D00]/80",
          !reducedMotion && "transition-[top,left,width,height] duration-200",
        )}
        style={{ ...ring, boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.32)" }}
      />
      <div
        ref={popoverRef}
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        data-testid="demo-coach-card"
        data-side={side}
        style={popoverStyle}
        className={cn(
          "rounded-xl border border-zinc-200 bg-card p-4 shadow-xl outline-none dark:border-zinc-700",
          !reducedMotion && "animate-in fade-in duration-200",
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{counter}</p>
        <p className="mt-1 text-sm font-semibold leading-tight">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{instruction}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              mode === "action" ? "bg-orange-50 text-orange-800" : "bg-muted text-muted-foreground",
            )}
          >
            {mode === "action" ? S.waiting : S.observe}
          </span>
          <div className="flex items-center gap-1.5">
            {canBack && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onBack}>
                <ChevronLeft className="mr-0.5 h-3 w-3" /> {S.back}
              </Button>
            )}
            {canSkip && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onSkip}>
                <SkipForward className="mr-0.5 h-3 w-3" /> {S.skip}
              </Button>
            )}
            {mode === "observe" && (
              <Button size="sm" className="h-7 px-3 text-xs" onClick={onNext}>
                {S.next} <ChevronRight className="ml-0.5 h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
