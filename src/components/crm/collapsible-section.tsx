"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Creatio-style collapsible content section: caret + title header,
 * collapsible body. Used on record pages (deal/lead) to group blocks
 * inside the main content column.
 */
export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  className,
  tourId,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  tourId?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      data-tour-id={tourId}
      className={cn("rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card", className)}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-left"
      >
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        {title}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}
