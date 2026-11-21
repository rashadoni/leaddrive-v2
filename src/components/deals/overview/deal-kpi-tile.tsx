"use client"

/**
 * One fact of the deal as a tile of the dashboard's kind (KpiCard): a label,
 * a number, one line under it. The whole tile is a button that leads to where
 * the fact is worked on, and it says so under the cursor.
 */
import type { ReactNode } from "react"
import { ArrowRight } from "lucide-react"
import { Hint } from "@/components/hint"
import { cn } from "@/lib/utils"

export function DealKpiTile({ label, icon, value, muted, extra, sub, hint, onClick, testId }: {
  label: string
  icon: ReactNode
  value: ReactNode
  /** The value is an absence («not assigned»), so it is drawn quieter than a number. */
  muted?: boolean
  extra?: ReactNode
  sub: ReactNode
  hint: string
  onClick: () => void
  testId?: string
}) {
  return (
    <Hint text={hint}>
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className="group flex min-h-[112px] min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all duration-200 hover:-translate-y-px hover:border-input hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
          <span className="truncate">{label}</span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors group-hover:bg-foreground group-hover:text-background [&_svg]:h-4 [&_svg]:w-4" aria-hidden>{icon}</span>
        </span>
        <span className={cn("block max-w-full text-lg font-bold leading-tight tracking-tight tabular-nums max-sm:break-words sm:truncate sm:text-[22px]", muted && "text-muted-foreground")}>{value}</span>
        {extra}
        <span className="mt-auto flex min-h-[22px] min-w-0 items-center gap-1.5 pt-1 text-xs text-muted-foreground">{sub}</span>
      </button>
    </Hint>
  )
}

/** The line of a tile that is an invitation: «Assign →». */
export function TileAction({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-[hsl(var(--crm-accent-text,20_90%_33%))]">
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </span>
  )
}

/** A thin bar: how much of the invoiced amount is paid. */
export function TileBar({ percent }: { percent: number }) {
  return (
    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className="block h-full rounded-full bg-emerald-600 transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </span>
  )
}
