import type { HTMLAttributes, ReactNode } from "react"

import { cn } from "@/lib/utils"

type SupportPageWidth = "narrow" | "default" | "wide" | "fluid"

interface SupportPageShellProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode
  description?: ReactNode
  descriptionClassName?: string
  leading?: ReactNode
  utilities?: ReactNode
  actions?: ReactNode
  notices?: ReactNode
  toolbar?: ReactNode
  stickyToolbar?: boolean
  width?: SupportPageWidth
  titleSize?: "default" | "compact"
  density?: "compact" | "comfortable"
  titleId?: string
  contentClassName?: string
  children: ReactNode
}

const widthClasses: Record<SupportPageWidth, string> = {
  narrow: "max-w-4xl",
  default: "max-w-[1120px]",
  wide: "max-w-[1180px]",
  fluid: "max-w-none",
}

/**
 * Shared task-first frame for internal Support surfaces.
 *
 * The shell owns only page rhythm and semantic header slots. Operational
 * sections remain flat children so pages do not acquire another generic card
 * or nested landmark merely to look consistent.
 */
export function SupportPageShell({
  title,
  description,
  descriptionClassName,
  leading,
  utilities,
  actions,
  notices,
  toolbar,
  stickyToolbar = false,
  width = "default",
  titleSize = "default",
  density = "compact",
  titleId,
  className,
  contentClassName,
  children,
  ...props
}: SupportPageShellProps) {
  return (
    <div
      {...props}
      className={cn(
        "support-page-shell mx-auto flex w-full min-w-0 flex-col gap-[var(--support-space-section)] pb-[var(--support-space-page-end)]",
        widthClasses[width],
        className,
      )}
      data-support-page-shell="true"
      data-density={density}
    >
      <header
        className="flex min-w-0 flex-col gap-[var(--support-space-cluster)] border-b pb-[var(--support-space-section)] xl:flex-row xl:items-start xl:justify-between"
        data-slot="support-page-header"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-[var(--support-space-control)]">
            {leading ? <span className="inline-flex shrink-0 text-muted-foreground" data-slot="support-page-leading">{leading}</span> : null}
            <h1 id={titleId} className="support-page-title min-w-0 font-semibold tracking-tight" data-size={titleSize} data-slot="support-page-title">
              {title}
            </h1>
            {utilities ? <div className="flex min-h-[var(--support-control-min-size)] flex-wrap items-center gap-[var(--support-space-inline)] sm:min-h-0" data-slot="support-page-utilities">{utilities}</div> : null}
          </div>
          {description ? (
            <div className={cn("mt-[var(--support-space-inline)] max-w-[72ch] text-sm leading-5 text-muted-foreground", descriptionClassName)} data-slot="support-page-description">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex min-h-[var(--support-control-min-size)] max-w-full flex-wrap items-center gap-[var(--support-space-control)] xl:shrink-0" data-slot="support-page-actions">
            {actions}
          </div>
        ) : null}
      </header>

      {notices ? <div className="flex flex-col gap-[var(--support-space-control)]" data-slot="support-page-notices">{notices}</div> : null}
      {toolbar ? (
        <div
          className={cn(
            "min-w-0",
            stickyToolbar && "sticky top-0 z-20 bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85",
          )}
          data-slot="support-page-toolbar"
        >
          {toolbar}
        </div>
      ) : null}
      <div className={cn("flex min-w-0 flex-col gap-[var(--support-space-section)]", contentClassName)} data-slot="support-page-content">
        {children}
      </div>
    </div>
  )
}
