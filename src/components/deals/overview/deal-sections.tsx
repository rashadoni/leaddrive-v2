"use client"

/**
 * The details of a deal, closed until asked for: four sections in one row,
 * each naming what is inside and how many, each opening in place under the
 * row with its own short list of parts. Nothing scrolls inside: an open
 * section takes the page's width and as much height as it needs.
 */
import type { ReactNode } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { cn } from "@/lib/utils"

export interface DealSectionPart {
  id: string
  label: string
  count?: number | string
  /** Stays mounted while hidden: the page reads something from it (the number of product lines). */
  keepMounted?: boolean
  render: () => ReactNode
}

export interface DealSection {
  id: string
  label: string
  icon: ReactNode
  /** What is inside, in a line: «Invoices: 1 · purchases: 0». */
  summary: string
  hint: string
  parts: DealSectionPart[]
}

export function DealSections({ sections, open, part, ariaLabel, collapseLabel, onOpen, onPart }: {
  sections: DealSection[]
  open: string | null
  /** The chosen part of each section. */
  part: Record<string, string>
  ariaLabel: string
  collapseLabel: string
  onOpen: (id: string | null) => void
  onPart: (section: string, part: string) => void
}) {
  const current = sections.find((section) => section.id === open) ?? null
  const activePart = (section: DealSection) => section.parts.find((p) => p.id === part[section.id])?.id ?? section.parts[0]?.id

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div role="tablist" aria-label={ariaLabel} className={cn("grid grid-cols-2 lg:grid-cols-4", current && "border-b border-border bg-muted/40")}>
        {sections.map((section, index) => {
          const selected = section.id === open
          return (
            <Hint key={section.id} text={section.hint}>
              <button
                type="button"
                role="tab"
                id={`deal-section-${section.id}`}
                aria-selected={selected}
                aria-controls="deal-section-panel"
                onClick={() => onOpen(selected ? null : section.id)}
                className={cn(
                  "relative flex min-w-0 items-center gap-3 p-3 text-left transition-colors sm:p-4",
                  index % 2 === 0 && "border-r border-border",
                  index < 2 && "border-b border-border lg:border-b-0",
                  index < sections.length - 1 && "lg:border-r lg:border-border",
                  selected ? "bg-card before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary" : "hover:bg-muted/50",
                )}
              >
                <span className={cn(
                  "hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors sm:flex [&_svg]:h-[18px] [&_svg]:w-[18px]",
                  selected ? "bg-primary/10 text-[hsl(var(--crm-accent-text,20_90%_33%))]" : "bg-muted text-muted-foreground",
                )} aria-hidden>{section.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{section.label}</span>
                  <span className="block text-[12.5px] text-muted-foreground sm:truncate">{section.summary}</span>
                </span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", selected && "rotate-180 text-foreground")} aria-hidden />
              </button>
            </Hint>
          )
        })}
      </div>

      {sections.map((section) => {
        const visible = section.id === open
        const active = activePart(section)
        const mounted = section.parts.filter((p) => p.keepMounted || (visible && p.id === active))
        if (mounted.length === 0) return null
        return (
          <div
            key={section.id}
            id={visible ? "deal-section-panel" : undefined}
            role={visible ? "tabpanel" : undefined}
            aria-labelledby={visible ? `deal-section-${section.id}` : undefined}
            className={visible ? "p-4 sm:p-5" : "hidden"}
          >
            {visible && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {section.parts.map((p) => (
                  <Button key={p.id} type="button" size="sm" variant={p.id === active ? "selected" : "outline"} className="gap-1.5" data-part={p.id} onClick={() => onPart(section.id, p.id)}>
                    {p.label}
                    {p.count ? <span className="rounded-full border border-border bg-card px-1.5 text-[11px] font-semibold leading-4 text-muted-foreground">{p.count}</span> : null}
                  </Button>
                ))}
                <Button type="button" size="sm" variant="ghost" className="ml-auto gap-1.5 text-muted-foreground" onClick={() => onOpen(null)}>
                  <ChevronUp className="h-4 w-4" aria-hidden />
                  {collapseLabel}
                </Button>
              </div>
            )}
            {mounted.map((p) => (
              <div key={p.id} className={visible && p.id === active ? undefined : "hidden"} data-part-body={p.id}>{p.render()}</div>
            ))}
          </div>
        )
      })}
    </section>
  )
}
