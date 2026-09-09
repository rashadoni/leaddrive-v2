"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { ExternalLink, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type DashboardWidgetShellProps = {
  title: string
  description?: string
  icon?: ReactNode
  href?: string
  actionLabel?: string
  children: ReactNode
  className?: string
  headerClassName?: string
  loading?: boolean
  empty?: boolean
  emptyTitle?: string
  emptyDescription?: string
}

export function DashboardWidgetShell({
  title,
  description,
  icon,
  href,
  actionLabel,
  children,
  className,
  headerClassName,
  loading = false,
  empty = false,
  emptyTitle,
  emptyDescription,
}: DashboardWidgetShellProps) {
  return (
    <section className={cn("dashboard-bento-card flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:border-zinc-700", className)}>
      <div className={cn("shrink-0 flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800", headerClassName)}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {icon ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">{icon}</span> : null}
            <h2 className="truncate text-sm font-semibold">{title}</h2>
          </div>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {href ? (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 dark:border-zinc-700"
          >
            {actionLabel}
            <ExternalLink className="h-3 w-3" />
          </Link>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex min-h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : empty ? (
          <div className="flex min-h-32 flex-col justify-center rounded-lg border border-dashed border-zinc-200 bg-muted/20 px-4 py-5 text-sm dark:border-zinc-800">
            <p className="font-medium">{emptyTitle}</p>
            {emptyDescription ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{emptyDescription}</p> : null}
          </div>
        ) : children}
      </div>
    </section>
  )
}
