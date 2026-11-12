"use client"

/**
 * The one chip the meetings screens choose things with.
 *
 * It existed twice before — the WhatsApp rules had theirs, the screen-in-the-
 * hall panel drew its own — and a third was about to be written for the
 * vocabulary card. Three chips that are nearly the same read as three
 * different products on one screen (owner, 2026-11-12: «кнопки, не забывай
 * про общий дизайн»), so there is one here and the screens import it.
 *
 * Chosen state is `aria-pressed`, not a class: a screen reader says «pressed»
 * and the CRM's own button system leaves it alone — the filled look belongs
 * to the single action button of a screen, never to a chip.
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function BookingChip({ active, onClick, disabled, label, className, children }: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  /** For a chip whose text is not the whole story — a drawing, a count. */
  label?: string
  className?: string
  children: ReactNode
}) {
  return <button
    type="button"
    aria-pressed={active}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      "flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
      active ? "bg-primary/10 text-primary ring-1 ring-primary/30" : "bg-muted text-muted-foreground hover:text-foreground",
      className,
    )}
  >{children}</button>
}
