"use client"

import { useId, useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight, Settings2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { CapabilityGoal, CapabilityOverview, OverviewStatus } from "@/lib/capabilities-overview"

export interface CapabilitiesCopy {
  title: string
  subtitle: string
  loading: string
  error: string
  forbidden: string
  retry: string
  empty: string
  open: string
  configure: string
  discuss: string
  contactAdmin: string
  accessNote: string
  connectionNote: string
  installedApps: string
  installedAppsHint: string
  back: string
  goals: Record<CapabilityGoal, { title: string; description: string }>
  statuses: Record<OverviewStatus, { label: string; hint: string }>
  modules: Record<string, { name: string; summary: string; benefits: string[] }>
}

const GOALS: CapabilityGoal[] = ["customers", "team", "operations", "industry"]
const CONNECTIONS = new Set(["omnichannel", "voip", "settings"])

export function CapabilitiesOverviewContent({ overview, copy }: { overview: CapabilityOverview; copy: CapabilitiesCopy }) {
  const [selectedId, setSelectedId] = useState("sales")
  const selected = overview.capabilities.find(item => item.id === selectedId) ?? overview.capabilities[0]
  const detailId = useId()
  const detail = useRef<HTMLElement>(null)
  if (!selected) return <p className="rounded-xl border border-border bg-card p-6 text-muted-foreground">{copy.empty}</p>
  const selectedCopy = copy.modules[selected.id]
  const selectedStatus = copy.statuses[selected.status]

  const selectedPanel = (
      <section ref={detail} id={detailId} aria-live="polite" aria-atomic="true" className="scroll-mt-6 rounded-xl border border-border bg-card p-5 sm:p-6" data-crm-card="">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{selectedCopy.name}</h2>
          <Badge variant={selected.status === "available" ? "success" : selected.status === "requested" ? "info" : "outline"}>{selectedStatus.label}</Badge>
        </div>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6">
          {selectedCopy.benefits.map(benefit => <li key={benefit}>{benefit}</li>)}
        </ul>
        <p className="mt-5 rounded-lg bg-muted/50 px-3 py-3 text-sm leading-6">{selectedStatus.hint}</p>
        {CONNECTIONS.has(selected.id) && selected.status === "available" ? <p className="mt-3 max-w-[70ch] text-sm leading-6 text-muted-foreground">{copy.connectionNote}</p> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          {selected.openHref ? <Button asChild className="min-h-11 sm:min-h-9"><Link href={selected.openHref}>{copy.open}<ArrowRight className="h-4 w-4" /></Link></Button> : null}
          {selected.setupHref && selected.setupHref !== selected.openHref ? <Button asChild variant="outline" className="min-h-11 sm:min-h-9"><Link href={selected.setupHref}><Settings2 className="h-4 w-4" />{copy.configure}</Link></Button> : null}
          {selected.status === "requires_access" && overview.canManage ? <Button asChild variant="outline" className="min-h-11 sm:min-h-9"><Link href="/contact">{copy.discuss}</Link></Button> : null}
          {(selected.status === "requires_access" || selected.status === "restricted") && !overview.canManage ? <p className="text-sm leading-6 text-muted-foreground">{copy.contactAdmin}</p> : null}
        </div>
      </section>
  )

  return (
    <div className="space-y-8">
      {GOALS.map(goal => {
        const entries = overview.capabilities.filter(item => item.goal === goal)
        if (entries.length === 0) return null
        return (
          <section key={goal} aria-labelledby={`${detailId}-${goal}`} className="space-y-3">
            <div>
              <h2 id={`${detailId}-${goal}`} className="text-lg font-semibold tracking-tight">{copy.goals[goal].title}</h2>
              <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">{copy.goals[goal].description}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {entries.map(entry => {
                const active = selected.id === entry.id
                const content = copy.modules[entry.id]
                return (
                  <Card key={entry.id} className={cn("overflow-hidden", active && "border-primary ring-1 ring-primary/20")}>
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-controls={detailId}
                      onClick={() => {
                        setSelectedId(entry.id)
                        requestAnimationFrame(() => detail.current?.scrollIntoView({ block: "nearest" }))
                      }}
                      className={cn("flex min-h-36 w-full flex-col items-start gap-2 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", active && "bg-primary/5")}
                    >
                      <span className="text-base font-semibold">{content.name}</span>
                      <span className="max-w-[65ch] text-sm leading-6 text-muted-foreground">{content.summary}</span>
                      <span className="mt-auto pt-1 text-xs font-medium">{copy.statuses[entry.status].label}</span>
                    </button>
                  </Card>
                )
              })}
            </div>
            {selected.goal === goal ? selectedPanel : null}
          </section>
        )
      })}

      {overview.installedAppsCount > 0 ? (
        <section className="flex flex-col items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center" data-crm-card="">
          <div><h2 className="text-sm font-semibold">{copy.installedApps}</h2><p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">{copy.installedAppsHint}</p></div>
          <Button asChild variant="outline" className="min-h-11 shrink-0 sm:min-h-9"><Link href="/marketplace/apps">{copy.configure}<ArrowRight className="h-4 w-4" /></Link></Button>
        </section>
      ) : null}
    </div>
  )
}
