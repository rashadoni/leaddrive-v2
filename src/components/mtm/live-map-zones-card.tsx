"use client"

import { useTranslations } from "next-intl"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { LiveMapZoneGone } from "@/components/mtm/live-map-zone-form"
import { LiveMapZoneList } from "@/components/mtm/live-map-zone-list"
import type { LiveMapZone, LiveMapZoneChange, LiveMapZoneWriteProblem } from "@/lib/mtm/live-map-zones"

/**
 * «Свои зоны» as a card on the page, above the employees' list: how many
 * zones the organization has drawn, and — unfolded — the list of them.
 *
 * The list used to stand under the layer's switch in «Слои». That panel is
 * bounded by the map's frame, so a list in it has one way to grow: a scrollbar
 * of its own — on a 1280 px window two zones were enough for it. The owner
 * calls a list that scrolls inside a panel a bug. Here the list is in the
 * page's own flow, where length costs nothing: the page scrolls, and nothing
 * in the card does. No height is set and nothing is cut off, on purpose.
 *
 * Folded until asked for: what stands under it is the employees' list, which
 * is what the page is for. The page remembers the choice in the browser (the
 * card only reports the press). With no zones there is nothing to fold, and
 * how to draw the first one is said at once.
 */
export function LiveMapZonesCard({ zones, canWrite, unfolded, onUnfoldedChange, gone, onGoneClose, formatArea, onChange, onShowOnMap, className }: {
  /** In the order to show them. */
  zones: readonly LiveMapZone[]
  /** Said by the server about this viewer. */
  canWrite: boolean
  unfolded: boolean
  onUnfoldedChange: (unfolded: boolean) => void
  /** A change asked from a row came too late — a colleague had removed the zone: said here, where the row stood, until closed. */
  gone: boolean
  onGoneClose: () => void
  formatArea: (squareMeters: number) => string
  /** Resolves to why the server refused, or to null when it kept the change. */
  onChange: (zone: LiveMapZone, change: LiveMapZoneChange) => Promise<LiveMapZoneWriteProblem | null>
  onShowOnMap: (zone: LiveMapZone) => void
  className?: string
}) {
  const tMap = useTranslations("mtmMap")
  const listed = zones.length === 0 || unfolded
  const Chevron = unfolded ? ChevronDown : ChevronRight

  return (
    // Its own width decides how many columns the zones stand in (@container): narrow beside the map, wide under it.
    <section
      aria-labelledby="live-map-zones-card-title"
      data-testid="live-map-zones-card"
      data-unfolded={listed ? "true" : "false"}
      className={cn("@container min-w-0 rounded-lg border border-zinc-200 bg-card px-3 py-2 text-[13px] dark:border-zinc-700", className)}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 id="live-map-zones-card-title" className="text-xs font-semibold uppercase text-muted-foreground" data-testid="live-map-zones-card-title">
          {tMap("layers.areas")}<span className="tabular-nums"> · {zones.length}</span>
        </h4>
        {zones.length > 0 ? (
          // In words, not an arrow alone: an arrow by itself does not say what it opens.
          <button
            type="button"
            aria-expanded={unfolded}
            aria-controls="live-map-zones-card-list"
            onClick={() => onUnfoldedChange(!unfolded)}
            data-testid="live-map-zones-card-fold"
            className="ml-auto inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs font-medium hover:bg-muted dark:border-zinc-700 [@media(pointer:coarse)]:min-h-11"
          >
            <Chevron className="h-3.5 w-3.5" aria-hidden="true" />
            {tMap(unfolded ? "areas.hideList" : "areas.showList")}
          </button>
        ) : null}
      </div>
      {gone ? <LiveMapZoneGone className="mt-2" onClose={onGoneClose} /> : null}
      {listed ? (
        <div id="live-map-zones-card-list" className="mt-2">
          <LiveMapZoneList zones={zones} canWrite={canWrite} formatArea={formatArea} onChange={onChange} onShowOnMap={onShowOnMap} />
        </div>
      ) : null}
    </section>
  )
}
