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
 * Something about a layer that must be seen with the panel closed — a layer
 * that is on and could not be read looks, on the map, exactly like «there
 * is nothing here». Said in words on the map, with what to do about it.
 */
export interface LiveMapLayersAlert {
  text: string
  actionLabel: string | null
  onAction: (() => void) | null
  /** Names the alert when there is more than one to tell apart; the action is `${testId}-action`. */
  testId?: string
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
export function LiveMapLayersControl({ layers, hiddenAgentCount, onShowAllAgents, note, alert = null, baseMaps = null, closeTurn = 0 }: {
  layers: LiveMapLayer[]
  /**
   * Counts the times the map was asked, from outside it, to show a place — a
   * zone's «На карте» in the list on the page. Each new turn closes the panel:
   * open, it lies over the middle of the map, which is exactly where the place
   * asked for is shown, and the press would seem to have done nothing.
   */
  closeTurn?: number
  /**
   * The map's background, when there is more than one to choose from. Not a
   * layer: exactly one is always on, and choosing one hides nothing.
   */
  baseMaps?: { value: string; options: Array<{ id: string; label: string }>; onChange: (id: string) => void } | null
  /** Employees taken off the map one by one with the eye on their card. */
  hiddenAgentCount: number
  onShowAllAgents: () => void
  note?: string
  /** One alert, or one for each layer that has something to say (see LiveMapLayersAlert). */
  alert?: LiveMapLayersAlert | Array<LiveMapLayersAlert | null> | null
}) {
  const tMap = useTranslations("mtmMap")
  const [open, setOpen] = useState(false)
  // Closed while rendering, not in an effect after it: the panel is not drawn
  // once more over the place asked for. The button opens it again as always.
  const [closedAtTurn, setClosedAtTurn] = useState(closeTurn)
  if (closedAtTurn !== closeTurn) {
    setClosedAtTurn(closeTurn)
    setOpen(false)
  }
  const offCount = layers.filter((layer) => layer.shownByDefault && !layer.on).length + (hiddenAgentCount > 0 ? 1 : 0)
  const alerts = (Array.isArray(alert) ? alert : [alert]).filter((item): item is LiveMapLayersAlert => item != null)

  return (
    // Bounded by the map's frame (top and bottom) and above the tools: with
    // seven switches the open panel was taller than a phone's map, and the last
    // ones were cut off with no way to reach them. There it scrolls inside
    // itself. On a map wide enough the switches stand in two columns instead:
    // nine of them in one column were taller than the map of a laptop, and a
    // list that scrolls inside a panel inside a page is the thing the owner
    // calls a bug. For the same reason a layer is its switch and one line of
    // words here, and nothing is listed under it: what a layer holds can be
    // any number of things, and the panel has only the map's height to give —
    // the organization's own zones are listed on the page (live-map-zones-card.tsx).
    // A switch left alone in the last row of the two columns (an odd number of
    // them) has the row's whole width for its words: «Свои зоны» with no zones
    // yet says how to draw the first one, and that sentence was five lines in
    // half the panel — taller than the room left on a laptop's map.
    // The frame spans the map's width only to learn that width (@container) —
    // it takes no presses itself.
    <div className="@container pointer-events-none absolute left-3 bottom-3 right-3 top-3 z-[1200] flex flex-col items-end gap-2" data-testid="live-map-layers">
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
      {open ? null : alerts.map((item, index) => (
        <div key={item.testId ?? `alert-${index}`} role="status" className="pointer-events-auto flex max-w-[min(18rem,calc(100vw-3rem))] shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 shadow-md dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid={item.testId ?? "live-map-layers-alert"}>
          <span>{item.text}</span>
          {item.actionLabel && item.onAction ? (
            <button type="button" onClick={item.onAction} data-testid={item.testId ? `${item.testId}-action` : "live-map-layers-alert-action"} className="inline-flex min-h-8 items-center font-semibold underline underline-offset-2 [@media(pointer:coarse)]:min-h-11">
              {item.actionLabel}
            </button>
          ) : null}
        </div>
      ))}
      {open ? (
        <div id="live-map-layers-panel" className="pointer-events-auto min-h-0 w-72 max-w-full overflow-y-auto rounded-lg border border-zinc-300 bg-card p-2 shadow-lg @lg:w-[31rem] @2xl:w-[35rem] dark:border-zinc-600">
          {baseMaps && baseMaps.options.length > 1 ? (
            <div className="mb-1 border-b border-zinc-200 px-1 pb-2 dark:border-zinc-700" data-testid="live-map-base-maps">
              <div id="live-map-base-maps-title" className="text-xs font-semibold uppercase text-muted-foreground">{tMap("layers.base")}</div>
              <div role="radiogroup" aria-labelledby="live-map-base-maps-title" className="mt-1 flex flex-wrap gap-1.5">
                {baseMaps.options.map((option) => {
                  const chosen = option.id === baseMaps.value
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => baseMaps.onChange(option.id)}
                      data-testid={`live-map-base-map-${option.id}`}
                      className={cn(
                        "inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium transition-colors [@media(pointer:coarse)]:min-h-11",
                        chosen ? "border-primary bg-primary/10 font-semibold" : "border-zinc-300 hover:bg-muted dark:border-zinc-600",
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          {/* A line above every switch but the first row's: one of them in one column, two in two. */}
          <ul className="grid grid-cols-1 @lg:grid-cols-2 @lg:gap-x-4" data-testid="live-map-layers-list">
            {layers.map((layer) => (
              <li key={layer.id} className="flex items-center gap-3 border-t border-zinc-200 px-1 py-1.5 first:border-t-0 @lg:[&:nth-child(2)]:border-t-0 @lg:last:odd:col-span-2 dark:border-zinc-700">
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
