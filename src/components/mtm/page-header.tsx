"use client"

import type { ReactNode } from "react"

import { HelpButton } from "@/components/help/help-button"
import type { HelpSlug } from "@/content/help/registry"
import { cn } from "@/lib/utils"

// One page header for every MTM screen (owner 2026-10-31, from a before/after
// picture): a large title, one line of explanation, the page's own buttons on
// the right and «Kömək» last as a plain outlined button. Before it, fourteen
// pages printed their name in 14 px beside an orange «Kömək» plaque, four
// others a large title with a round «?», and «Kadr uçotu» a third way.
export function MtmPageHeader({
  title,
  description,
  help,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  help?: HelpSlug
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <MtmPageTitle title={title} description={description} />
      {actions || help ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {actions}
          {help ? <HelpButton slug={help} variant="quiet" /> : null}
        </div>
      ) : null}
    </header>
  )
}

// The title half of the header, for a page whose header row already lays out
// its own controls (the client and organization lists): put «Kömək» last there
// with <HelpButton variant="quiet" />.
export function MtmPageTitle({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
    </div>
  )
}
