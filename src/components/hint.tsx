"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

/**
 * A hint under the cursor: one sentence on what a button will do, or on how a
 * value is counted.
 *
 * Owner, 2026-10-15, on the live map's employee card: «тут нет подсказок при
 * наведении, и вообще подсказок в модуле очень мало». Some buttons had the
 * browser's own `title` — it shows only after a second of a still cursor, in
 * the system's grey, and he never saw one. This one opens in a fifth of a
 * second, in the app's style, and on keyboard focus too. The look was shown to
 * him as a picture first («делай так»).
 *
 * Each hint has its own provider, so it works wherever it is drawn — inside a
 * test, a dialog or a page outside the dashboard layout — without depending on
 * one mounted above it.
 */

const HINT_DELAY_MS = 200

const BUBBLE =
  "z-[2000] max-w-[260px] rounded-lg bg-zinc-900 px-3 py-2 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-white shadow-xl " +
  "dark:bg-zinc-100 dark:text-zinc-900 " +
  "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"

export interface HintProps {
  /** The sentence. Empty: the child is drawn as it is, with no hint. */
  text: string | null | undefined
  /** One element that takes a ref: a button, a link, a span. */
  children: React.ReactElement
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  /**
   * Wrap the child in a span first. A disabled button sends no pointer
   * events, so its hint — usually the one that says why it is disabled —
   * would never open on the button itself.
   */
  wrap?: boolean
}

export function Hint({ text, children, side = "bottom", align = "center", wrap = false }: HintProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLElement>(null)
  // Where the bubble is drawn. Inside the dashboard's own frame, so it speaks
  // in the dashboard's font like the rest of the screen (in <body> it fell
  // back to the browser's). And the live map can go full screen: only the
  // full-screen element is drawn then, so the bubble goes into it.
  const [container, setContainer] = React.useState<Element | null>(null)
  if (!text) return children

  const trigger = wrap ? <span className="inline-flex max-w-full" tabIndex={0}>{children}</span> : children
  return (
    <TooltipPrimitive.Provider delayDuration={HINT_DELAY_MS} skipDelayDuration={300}>
      <TooltipPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          // Radix measures the bubble with ResizeObserver. Where there is none
          // (a test's jsdom), the hint stays closed instead of throwing.
          if (next && typeof ResizeObserver === "undefined") return
          if (next) setContainer(document.fullscreenElement ?? triggerRef.current?.closest(".font-dashboard") ?? null)
          setOpen(next)
        }}
      >
        <TooltipPrimitive.Trigger asChild ref={triggerRef}>{trigger}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal container={container ?? undefined}>
          <TooltipPrimitive.Content side={side} align={align} sideOffset={6} collisionPadding={8} className={BUBBLE} data-testid="hint-bubble">
            {text}
            <TooltipPrimitive.Arrow className="fill-zinc-900 dark:fill-zinc-100" width={10} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

/**
 * A value whose meaning is not obvious — «±12 m», «🧭 40%», a count in a
 * summary. The dotted underline says, before anyone hovers, that there is an
 * explanation; the hint says how the value is counted.
 */
export function HintValue({ text, children, className, side, align }: {
  text: string | null | undefined
  children: React.ReactNode
  className?: string
  side?: HintProps["side"]
  align?: HintProps["align"]
}) {
  if (!text) return <span className={className}>{children}</span>
  return (
    <Hint text={text} side={side} align={align}>
      <span
        tabIndex={0}
        data-hint-value=""
        className={cn(
          "cursor-help underline decoration-current/40 decoration-dotted underline-offset-2 outline-none focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-ring",
          className,
        )}
      >
        {children}
      </span>
    </Hint>
  )
}
