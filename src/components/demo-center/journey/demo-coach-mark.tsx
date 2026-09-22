"use client"

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { useReducedMotion } from "framer-motion"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, SkipForward, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DemoStepPlacement } from "@/lib/demo-center/journey"
import { findDemoTarget, hasLayoutBox } from "./demo-target"
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
 *   - × and Escape hide the card and its dim and nothing else: the step is
 *     neither completed nor skipped, stays in the guide panel, and the
 *     panel can bring the card back. Without them the card could not be
 *     put away at all and covered the page it was talking about (reported
 *     by the owner 2026-09-22 on «Sizi gətirən kampaniya»);
 *   - on a step the prospect acts on, the ring and an arrow point at the
 *     exact control (`data-demo-target`), not the region around it, and they
 *     stay on screen when the card is put away — the owner, the same day:
 *     «тут должно стрелками показывать, что надо сделать». With the card
 *     away there is no dim and nothing blocks the page.
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
  /** Hides the card for this step; the step itself is untouched. */
  onClose: () => void
  onMissing: (missing: boolean) => void
  /** Step id whose `data-demo-target` control the arrow points at (action steps). */
  targetStepId?: string
  /** Words on the arrow, verb first. */
  targetLabel?: string
  /** The card was put away: only the ring and the arrow stay. */
  collapsed?: boolean
}

const PADDING = 6
const GAP = 14
const VIEWPORT_MARGIN = 16
const LOCATE_INTERVAL_MS = 120
const LOCATE_ATTEMPTS = 25

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect()
  return { top: box.top, left: box.left, width: box.width, height: box.height }
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b
  return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5
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
  onClose,
  onMissing,
  targetStepId,
  targetLabel,
  collapsed = false,
}: DemoCoachMarkProps) {
  const reducedMotion = useReducedMotion()

  // Escape puts the card away, like the ×; it never completes a step.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])
  useEffect(() => {
    if (collapsed) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [collapsed])
  const [rect, setRect] = useState<Rect | null>(null)
  // Keyed by step, so a new step never shows the previous step's control.
  const [targetState, setTargetState] = useState<{ key: string; rect: Rect | null; label: string | null }>({ key: stepKey, rect: null, label: null })
  const targetRect = targetState.key === stepKey ? targetState.rect : null
  // A control can name itself for the arrow (`data-demo-label`), e.g. the
  // live-call panel, whose next control changes as the prospect goes on.
  const targetOwnLabel = targetState.key === stepKey ? targetState.label : null
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [size, setSize] = useState({ width: 340, height: 160 })
  const popoverRef = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string | null>(null)
  const reducedMotionRef = useRef(reducedMotion)
  useEffect(() => {
    reducedMotionRef.current = reducedMotion
  }, [reducedMotion])

  // Brings a step's region into view, once per step — for steps with no
  // control to point at, which the control effect below does not scroll to.
  const scrollOnce = (element: Element) => {
    if (scrolledFor.current === stepKey) return
    const box = element.getBoundingClientRect()
    if (box.top >= 0 && box.bottom <= window.innerHeight) return
    scrolledFor.current = stepKey
    element.scrollIntoView({ behavior: reducedMotionRef.current ? "auto" : "smooth", block: "center", inline: "nearest" })
  }

  // Locate the anchor. Scenes render tabs and cards a tick after the step
  // changes, so poll briefly before declaring the anchor missing.
  useEffect(() => {
    let attempts = 0
    let cleanupPosition: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const attach = (found: Element) => {
      const update = () => {
        setRect((previous) => {
          const next = rectOf(found)
          return sameRect(previous, next) ? previous : next
        })
        setViewport((previous) =>
          previous.width === window.innerWidth && previous.height === window.innerHeight ? previous : { width: window.innerWidth, height: window.innerHeight },
        )
      }
      update()
      if (!targetStepId) scrollOnce(found)
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
      // Not laid out (a column hidden on a phone) counts as missing: a ring
      // round a zero-size box in the corner points at nothing.
      if (found && hasLayoutBox(found)) {
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
    // scrollOnce reads only refs and stepKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, stepKey, onMissing, targetStepId])

  // Follow the exact control. It can appear after a first click (a dialog's
  // «Create»), so the DOM is watched for the whole step; the page is scrolled
  // to it once per step, never again, so the prospect's own scrolling wins.
  useEffect(() => {
    if (!targetStepId) return
    let frame = 0
    let element: HTMLElement | null = null
    const measure = () => {
      frame = 0
      element = findDemoTarget(targetStepId)
      const next = element ? rectOf(element) : null
      const nextLabel = element?.getAttribute("data-demo-label") ?? null
      setTargetState((previous) =>
        previous.key === stepKey && sameRect(previous.rect, next) && previous.label === nextLabel ? previous : { key: stepKey, rect: next, label: nextLabel },
      )
      if (element) scrollOnce(element)
    }
    // A control that never shows up (or shows late): the region is brought
    // into view instead, so the prospect is never left on a dimmed page.
    const fallback = setTimeout(() => {
      if (findDemoTarget(targetStepId)) return
      const region = document.querySelector(`[data-tour-id="${anchor}"]`)
      if (region && hasLayoutBox(region)) scrollOnce(region)
    }, LOCATE_INTERVAL_MS * 5)
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const timer = setTimeout(measure, 0)
    const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(schedule) : null
    observer?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-demo-target", "data-demo-label", "class", "style", "hidden"] })
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    return () => {
      clearTimeout(timer)
      clearTimeout(fallback)
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
    }
    // scrollOnce reads only refs and stepKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetStepId, stepKey, anchor])

  useLayoutEffect(() => {
    const node = popoverRef.current
    if (!node) return
    const box = node.getBoundingClientRect()
    setSize((previous) =>
      Math.abs(previous.width - box.width) < 1 && Math.abs(previous.height - box.height) < 1
        ? previous
        : { width: box.width, height: box.height },
    )
  }, [title, instruction, counter, mode, rect, targetRect, collapsed])

  // Move focus to the card so screen readers announce the step; the control
  // itself stays reachable with Tab.
  const located = rect !== null || targetRect !== null
  useEffect(() => {
    if (located && !collapsed) popoverRef.current?.focus({ preventScroll: true })
  }, [stepKey, located, collapsed])

  const focus = targetRect ?? rect
  if (!focus) return null

  const viewWidth = viewport.width || window.innerWidth
  const viewHeight = viewport.height || window.innerHeight
  const ring: Rect = {
    top: focus.top - PADDING,
    left: focus.left - PADDING,
    width: focus.width + PADDING * 2,
    height: focus.height + PADDING * 2,
  }
  const pointsAtControl = mode === "action" && targetRect !== null
  const label = targetOwnLabel ?? targetLabel ?? S.coachArrowFallback
  // Arrows everywhere (owner, 2026-09-22: «везде нужны стрелки для
  // понимания»): at the control on a step to act on, at the region — with
  // the step's name — on a step that shows something.
  const arrowLabel = pointsAtControl ? label : S.coachLook(title)

  const ringElement = (
    <div
      aria-hidden="true"
      data-testid="demo-coach-ring"
      data-target={pointsAtControl ? "control" : "region"}
      className={cn(
        "pointer-events-none fixed z-[10000] rounded-lg ring-2 ring-[#FF4D00]/80",
        !reducedMotion && "transition-[top,left,width,height] duration-200",
        collapsed && pointsAtControl && !reducedMotion && "animate-pulse",
      )}
      style={{ ...ring, boxShadow: collapsed ? undefined : "0 0 0 9999px rgba(15, 23, 42, 0.32)" }}
    />
  )

  if (collapsed) {
    // Entirely out of the viewport; a control at its very edge is still visible.
    const offBelow = ring.top >= viewHeight
    const offAbove = ring.top + ring.height <= 0
    if (offBelow || offAbove) {
      // Scrolled away from the control: a chip at the edge brings it back.
      return (
        <button
          type="button"
          data-testid="demo-coach-arrow"
          data-docked={offBelow ? "bottom" : "top"}
          onClick={() =>
            (findDemoTarget(targetStepId ?? "") ?? document.querySelector(`[data-tour-id="${anchor}"]`))?.scrollIntoView({
              behavior: reducedMotion ? "auto" : "smooth",
              block: "center",
            })
          }
          className="fixed left-1/2 z-[10002] flex max-w-[min(80vw,320px)] -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#c2410c] px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-[#9a3412]"
          style={offBelow ? { bottom: VIEWPORT_MARGIN } : { top: VIEWPORT_MARGIN }}
        >
          {offBelow ? <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {/* It only scrolls, so it says where the action is, not the action. */}
          <span className="truncate">{offBelow ? S.coachChipBelow(arrowLabel) : S.coachChipAbove(arrowLabel)}</span>
        </button>
      )
    }
    // The arrow's tip sits on the control's centre line, right at the ring;
    // the words sit beyond it. Above the control, or below when there is no room.
    const glyph = 18
    const pillHeight = 26
    const above = ring.top - 4 - glyph - 4 - pillHeight >= VIEWPORT_MARGIN
    const centre = clamp(ring.left + ring.width / 2, VIEWPORT_MARGIN + glyph / 2, viewWidth - VIEWPORT_MARGIN - glyph / 2)
    const glyphTop = above ? ring.top - 4 - glyph : ring.top + ring.height + 4
    const pillWidth = Math.min(240, viewWidth - VIEWPORT_MARGIN * 2)
    const Glyph = above ? ArrowDown : ArrowUp
    return (
      <>
        {ringElement}
        <div aria-hidden="true" data-testid="demo-coach-arrow" data-side={above ? "top" : "bottom"} className="pointer-events-none">
          <Glyph
            className={cn("fixed z-[10002] text-[#c2410c] drop-shadow", !reducedMotion && "motion-safe:animate-bounce")}
            style={{ left: centre - glyph / 2, top: glyphTop, width: glyph, height: glyph }}
            strokeWidth={3}
          />
          <span
            className="fixed z-[10002] flex justify-center"
            style={{
              left: clamp(centre - pillWidth / 2, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewWidth - pillWidth - VIEWPORT_MARGIN)),
              width: pillWidth,
              top: above ? glyphTop - 4 - pillHeight : glyphTop + glyph + 4,
            }}
          >
            <span className="max-w-full truncate rounded-full bg-[#c2410c] px-3 py-1 text-xs font-semibold leading-[18px] text-white shadow-lg">{arrowLabel}</span>
          </span>
        </div>
      </>
    )
  }

  const maxWidth = Math.min(340, viewWidth - VIEWPORT_MARGIN * 2)
  const width = Math.min(size.width || 340, maxWidth)
  const height = Math.min(size.height || 160, viewHeight - VIEWPORT_MARGIN * 2)

  const fits = {
    bottom: ring.top + ring.height + GAP + height <= viewHeight - VIEWPORT_MARGIN,
    top: ring.top - GAP - height >= VIEWPORT_MARGIN,
    right: ring.left + ring.width + GAP + width <= viewWidth - VIEWPORT_MARGIN,
    left: ring.left - GAP - width >= VIEWPORT_MARGIN,
  }
  const preferred: Exclude<DemoStepPlacement, "auto">[] =
    placement === "auto" ? ["bottom", "top", "right", "left"] : [placement, "bottom", "top", "right", "left"]
  const fitting = preferred.find((candidate) => fits[candidate])
  const side = fitting ?? "bottom"

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
  const cardLeft = clamp(left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewWidth - width - VIEWPORT_MARGIN))
  const cardTop = clamp(top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewHeight - height - VIEWPORT_MARGIN))

  // The card is two layers: the positioned frame (no overflow, so the notch
  // below can stick out of it) and the body, which may scroll on a very
  // short screen.
  const popoverStyle: CSSProperties = {
    position: "fixed",
    zIndex: 10002,
    width,
    maxWidth,
    left: cardLeft,
    top: cardTop,
  }
  const ringOnScreen = ring.top < viewHeight && ring.top + ring.height > 0

  // The card's own arrow: a notch on the edge that faces the control, lined
  // up with it. Only when the card really sits beside the ring — a card
  // clamped over it has no side to point from.
  const caret: CSSProperties | null = fitting && ringOnScreen
    ? side === "bottom" || side === "top"
      ? { left: clamp(ring.left + ring.width / 2 - cardLeft - 6, 12, width - 24), [side === "bottom" ? "top" : "bottom"]: -6 }
      : { top: clamp(ring.top + ring.height / 2 - cardTop - 6, 12, height - 24), [side === "right" ? "left" : "right"]: -6 }
    : null

  // With the card open the ring gets its own arrow too, on the side away
  // from the card, so the eye lands on the thing and not only on the text.
  const glyphAbove = side !== "top" && ring.top - 4 - 18 >= VIEWPORT_MARGIN
  const glyphLeft = clamp(ring.left + ring.width / 2, VIEWPORT_MARGIN + 9, viewWidth - VIEWPORT_MARGIN - 9) - 9
  const CardGlyph = glyphAbove ? ArrowDown : ArrowUp

  return (
    <>
      {ringElement}
      {ringOnScreen ? (
        <CardGlyph
          aria-hidden="true"
          data-testid="demo-coach-ring-arrow"
          className={cn("pointer-events-none fixed z-[10001] text-[#c2410c] drop-shadow", !reducedMotion && "motion-safe:animate-bounce")}
          style={{ left: glyphLeft, top: glyphAbove ? ring.top - 4 - 18 : ring.top + ring.height + 4, width: 18, height: 18 }}
          strokeWidth={3}
        />
      ) : null}
      <div
        ref={popoverRef}
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        data-testid="demo-coach-card"
        data-side={side}
        style={popoverStyle}
        className={cn("outline-none", !reducedMotion && "animate-in fade-in duration-200")}
      >
        <div
          className="rounded-xl border border-zinc-200 bg-card p-4 shadow-xl dark:border-zinc-700"
          style={{ maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`, overflowY: "auto" }}
        >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{counter}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label={S.coachClose}
            title={S.coachClose}
            data-testid="demo-coach-close"
            className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1 text-sm font-semibold leading-tight">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{instruction}</p>
        {pointsAtControl ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[#c2410c] dark:text-orange-300">
            {side === "bottom" ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : side === "top" ? <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className={cn("h-3.5 w-3.5", side === "right" && "rotate-180")} aria-hidden="true" />}
            {label}
          </p>
        ) : null}
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
        {caret ? (
          <span
            aria-hidden="true"
            data-testid="demo-coach-caret"
            className="pointer-events-none absolute h-3 w-3 rotate-45 border border-zinc-200 bg-card dark:border-zinc-700"
            style={{
              ...caret,
              // Only the two borders facing the ring show, so the notch reads as part of the card.
              borderRightColor: side === "bottom" || side === "right" ? "transparent" : undefined,
              borderBottomColor: side === "bottom" || side === "left" ? "transparent" : undefined,
              borderLeftColor: side === "top" || side === "left" ? "transparent" : undefined,
              borderTopColor: side === "top" || side === "right" ? "transparent" : undefined,
            }}
          />
        ) : null}
      </div>
    </>
  )
}
