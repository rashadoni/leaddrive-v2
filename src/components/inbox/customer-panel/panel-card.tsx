import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * One card of the inbox customer panel, drawn as the owner-approved mock-up draws them
 * (2026-11-15, `section.panel`): white on the panel's grey, rounded, a small upper-case title.
 */
export function PanelCard({ title, icon, action, children, className, testId }: {
  title?: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section data-testid={testId} className={cn("rounded-2xl border border-border/70 bg-card px-3 py-2.5", className)}>
      {title ? (
        <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/70">
          {icon}
          <span className="min-w-0 truncate">{title}</span>
          {action ? <span className="ml-auto shrink-0 normal-case tracking-normal">{action}</span> : null}
        </h4>
      ) : null}
      {children}
    </section>
  )
}
