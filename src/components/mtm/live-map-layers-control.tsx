"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Eye, Layers, X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface LiveMapLayer {
  id: string
  label: string
  hint?: string
  on: boolean
  onToggle: () => void
  testId?: string
  /**
   * Drawn unless somebody turns it off — the markers, the route. An extra
   * layer that was simply never turned on is not something «missing».
   */
  shownByDefault?: boolean
}

/**
 * «Слои» — what is drawn on the live map, switched on the map itself.
 *
 * Owner, 2026-10-09: «как убирать на карте объекты, агентов… динамичная
 * интерактивная карта». Until then two of these switches sat in a closed
 * panel at the very bottom of the page, the markers and the route could not
 * be taken off at all, and a single employee could not be hidden. The control
 * is closed until asked for, so the map itself stays clear.
 */
export function LiveMapLayersControl({ layers, hiddenAgentCount, onShowAllAgents, note }: {
  layers: LiveMapLayer[]
  /** Employees taken off the map one by one with the eye on their card. */
  hiddenAgentCount: number
  onShowAllAgents: () => void
  note?: string
}) {
  const tMap = useTranslations("mtmMap")
  const [open, setOpen] = useState(false)
  const offCount = layers.filter((layer) => layer.shownByDefault && !layer.on).length + (hiddenAgentCount > 0 ? 1 : 0)

  return (
    // Bounded by the map's frame (top and bottom) and above the tools: with
    // seven switches the open panel was taller than a phone's map, and the last
    // ones were cut off with no way to reach them. Now it scrolls inside itself.
    <div className="pointer-events-none absolute bottom-3 right-3 top-3 z-[1200] flex flex-col items-end gap-2" data-testid="live-map-layers">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="live-map-layers-panel"
        onClick={() => setOpen((value) => !value)}
        className="pointer-events-auto inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-zinc-300 bg-card px-3 text-sm font-medium shadow-md dark:border-zinc-600"
      >
        {open ? <X className="h-4 w-4" aria-hidden="true" /> : <Layers className="h-4 w-4" aria-hidden="true" />}
        {tMap("layers.title")}
        {/* Something is hidden: say so while the panel is closed. */}
        {!open && offCount > 0 ? <span className="h-2 w-2 rounded-full bg-amber-500" data-testid="live-map-layers-mark" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div id="live-map-layers-panel" className="pointer-events-auto min-h-0 w-72 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-lg border border-zinc-300 bg-card p-2 shadow-lg dark:border-zinc-600">
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {layers.map((layer) => (
              <li key={layer.id} className="flex items-center gap-3 px-1 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{layer.label}</span>
                  {layer.hint ? <span className="block text-xs text-muted-foreground" data-testid={`live-map-layer-hint-${layer.id}`}>{layer.hint}</span> : null}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={layer.on}
                  aria-label={layer.label}
                  data-testid={layer.testId ?? `live-map-layer-${layer.id}`}
                  onClick={layer.onToggle}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg"
                >
                  <span aria-hidden="true" className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors", layer.on ? "bg-primary" : "bg-zinc-300 dark:bg-zinc-700")}>
                    <span className={cn("inline-block h-5 w-5 rounded-full bg-white transition-transform", layer.on ? "translate-x-[22px]" : "translate-x-0.5")} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {hiddenAgentCount > 0 ? (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="live-map-hidden-agents">
              <span>{tMap("layers.hiddenAgents", { count: hiddenAgentCount })}</span>
              <button type="button" onClick={onShowAllAgents} className="inline-flex min-h-9 items-center gap-1 font-semibold underline underline-offset-2">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />{tMap("layers.showAll")}
              </button>
            </div>
          ) : null}
          {note ? <p className="mt-1 px-1 text-[11px] text-muted-foreground">{note}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
