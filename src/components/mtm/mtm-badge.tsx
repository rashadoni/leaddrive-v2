import type { BadgeProps } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/*
 * The Badge of the MTM pages (owner-approved colours, 2026-10-18): a status is
 * said by the colour of its words and a dot, never by a filled pill. The props
 * are the shared Badge's, so an MTM page swaps only its import and the rest of
 * the CRM keeps the shared one.
 */
const STATUS: Record<string, { text: string; dot: string }> = {
  success: { text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  warning: { text: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  destructive: { text: "text-red-700 dark:text-red-300", dot: "bg-red-500" },
  info: { text: "text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
  brand: { text: "text-primary", dot: "bg-primary" },
}

export function Badge({ className, variant, children, ...props }: BadgeProps) {
  const status = variant ? STATUS[variant] : undefined
  if (status) {
    return (
      <div className={cn("inline-flex items-center gap-1.5 text-xs font-medium", status.text, className)} {...props}>
        <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status.dot)} />
        {children}
      </div>
    )
  }
  // outline, default, secondary: a neutral label with a thin edge, no fill.
  return (
    <div className={cn("inline-flex items-center rounded-full border border-zinc-200 px-2.5 py-0.5 text-xs font-medium text-foreground dark:border-zinc-700", className)} {...props}>
      {children}
    </div>
  )
}
