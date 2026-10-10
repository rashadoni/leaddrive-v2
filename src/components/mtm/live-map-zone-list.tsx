"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { LiveMapZoneForm, liveMapZoneFormChange } from "@/components/mtm/live-map-zone-form"
import {
  liveMapZoneHex,
  zoneAreaSquareMeters,
  type LiveMapZone,
  type LiveMapZoneChange,
  type LiveMapZoneWriteProblem,
} from "@/lib/mtm/live-map-zones"

const ACTION = "inline-flex min-h-8 items-center text-xs font-semibold underline underline-offset-2 [@media(pointer:coarse)]:min-h-11"

/**
 * What is said when the organization has no zones yet: to whoever may draw —
 * the way to the first zone, in the words that are on the buttons themselves;
 * to a reader — who may draw them.
 *
 * One sentence for the two places that say it: the zones' card on the page,
 * and the layer's own line in «Слои» — the card is put away together with the
 * employees' list and is not in the map's frame when the map has the whole
 * screen, and a manager with nothing drawn yet was then told nothing at all.
 */
export function useLiveMapNoZonesWords(): (canWrite: boolean) => string {
  const tMap = useTranslations("mtmMap")
  return (canWrite) => `${tMap("areas.empty")} ${canWrite
    ? tMap("areas.emptyHowTo", {
      ruler: tMap("tools.ruler"),
      save: tMap("areas.saveOutline"),
      point: tMap("tools.point"),
      around: tMap("areas.aroundPoint"),
    })
    : tMap("areas.readOnly")}`
}

/**
 * The organization's own zones as a list, in their card on the page
 * (live-map-zones-card.tsx): what each is called and how much it covers, a way
 * to find it on the map — and, for whoever may change them, the same three
 * things its balloon on the map offers.
 *
 * It has no frame and no scrollbar of its own (owner: a frame inside a frame
 * with its own scrollbar is a bug): it is as long as the zones are many, and
 * the page scrolls. Where the card is wide — under the map on a tablet, beside
 * it when the employees' list is the wide table — the zones stand in two or
 * three columns.
 *
 * A change is made where the zone's row is: the row opens the small form and
 * keeps it until the server has answered.
 */
export function LiveMapZoneList({ zones, canWrite, formatArea, onChange, onShowOnMap }: {
  /** In the order to show them. */
  zones: readonly LiveMapZone[]
  /** Said by the server about this viewer; a reader gets the list and «На карте» only. */
  canWrite: boolean
  formatArea: (squareMeters: number) => string
  /** Resolves to why the server refused, or to null when it kept the change. */
  onChange: (zone: LiveMapZone, change: LiveMapZoneChange) => Promise<LiveMapZoneWriteProblem | null>
  /** «На карте»: the map moves so that the whole zone is in view. Changes nothing, so it is everybody's. */
  onShowOnMap: (zone: LiveMapZone) => void
}) {
  const tMap = useTranslations("mtmMap")
  const noZonesWords = useLiveMapNoZonesWords()
  const [editing, setEditing] = useState<{ zoneId: string; kind: LiveMapZoneChange["kind"] } | null>(null)

  if (zones.length === 0) {
    return <p className="text-xs text-muted-foreground" data-testid="live-map-zone-empty">{noZonesWords(canWrite)}</p>
  }

  return (
    <div data-testid="live-map-zone-list">
      <ul className="grid grid-cols-1 gap-1 @lg:grid-cols-2 @lg:items-start @5xl:grid-cols-3">
        {zones.map((zone) => {
          const task = canWrite && editing?.zoneId === zone.id ? editing.kind : null
          return (
            <li key={zone.id} className="rounded-md bg-muted/50 px-2 py-1.5" data-testid={`live-map-zone-row-${zone.id}`}>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: liveMapZoneHex(zone.color) }} aria-hidden="true" />
                <span className="min-w-0 flex-1 break-words text-sm font-medium" data-testid="live-map-zone-row-name">{zone.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground" data-testid="live-map-zone-row-area">{formatArea(zoneAreaSquareMeters(zone))}</span>
              </div>
              {task ? (
                <LiveMapZoneForm
                  className="mt-1.5"
                  task={{ kind: task, zone }}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (values) => {
                    const refused = await onChange(zone, liveMapZoneFormChange(task, values))
                    if (!refused) setEditing(null)
                    return refused
                  }}
                />
              ) : (
                // The same words on every row: a screen reader is also told which zone each belongs to.
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
                  <button type="button" className={ACTION} aria-label={`${tMap("areas.showOnMap")}: ${zone.name}`} onClick={() => onShowOnMap(zone)} data-testid={`live-map-zone-show-${zone.id}`}>
                    {tMap("areas.showOnMap")}
                  </button>
                  {canWrite ? (
                    <>
                      <button type="button" className={ACTION} aria-label={`${tMap("areas.rename")}: ${zone.name}`} onClick={() => setEditing({ zoneId: zone.id, kind: "rename" })} data-testid={`live-map-zone-rename-${zone.id}`}>
                        {tMap("areas.rename")}
                      </button>
                      <button type="button" className={ACTION} aria-label={`${tMap("areas.recolor")}: ${zone.name}`} onClick={() => setEditing({ zoneId: zone.id, kind: "color" })} data-testid={`live-map-zone-recolor-${zone.id}`}>
                        {tMap("areas.recolor")}
                      </button>
                      <button type="button" className={`${ACTION} text-red-700 dark:text-red-400`} aria-label={`${tMap("areas.remove")}: ${zone.name}`} onClick={() => setEditing({ zoneId: zone.id, kind: "delete" })} data-testid={`live-map-zone-remove-${zone.id}`}>
                        {tMap("areas.remove")}
                      </button>
                    </>
                  ) : null}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {canWrite ? null : <p className="mt-1.5 text-xs text-muted-foreground" data-testid="live-map-zone-read-only">{tMap("areas.readOnly")}</p>}
    </div>
  )
}
