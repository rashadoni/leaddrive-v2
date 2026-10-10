"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CircleDashed, Loader2, MapPin, Maximize, Minimize, MousePointerClick, Ruler, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LiveMapReferencePoint } from "@/components/mtm/live-map"
import { LiveMapZoneForm, type LiveMapZoneFormValues } from "@/components/mtm/live-map-zone-form"
import { LIVE_MAP_ZONE_MAX_CORNERS, type LiveMapZoneOutlineProblem, type LiveMapZoneWriteProblem } from "@/lib/mtm/live-map-zones"

interface SearchHit {
  label: string
  latitude: number
  longitude: number
}

const MAX_HITS_SHOWN = 3

const TOOL = "pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-md transition-colors"
const TOOL_IDLE = "border-zinc-300 bg-card hover:bg-muted dark:border-zinc-600"
const TOOL_ON = "border-primary bg-primary text-primary-foreground"

/**
 * The tools of the live map, in words, on the map itself: find an address or
 * mark a point (and the list answers «who is nearest»), measure a distance,
 * give the map the whole screen.
 *
 * Owner, 2026-10-09, of the fleet tracker shown to him as the model: «бери
 * почти всё, чего нет у нас». There these are five icons in a corner; here
 * each says what it does (owner, 2026-09-22: an icon alone reads as nothing).
 *
 * The address search is the server's — OpenStreetMap through
 * /api/v1/mtm/geocode, which keeps the service's rules (one request a second,
 * never as-you-type). So it searches on «Найти», not on every letter.
 */
export function LiveMapTools({
  near, referencePoint, onReferencePointChange, pickingPoint, onPickingPointChange,
  rulerActive, onRulerToggle, rulerMeters, rulerPointCount, onRulerUndo, formatDistance, rulerArea = null,
  fullscreen, onFullscreenToggle, fullscreenSupported, zoneDrawing = null, zoneEditor = null,
}: {
  /** Roughly where the map is looking, so nearby places come first. */
  near: { latitude: number; longitude: number } | null
  referencePoint: LiveMapReferencePoint | null
  onReferencePointChange: (point: LiveMapReferencePoint | null) => void
  pickingPoint: boolean
  onPickingPointChange: (picking: boolean) => void
  rulerActive: boolean
  onRulerToggle: () => void
  /** What the ruler's line adds up to so far, and how many points it has. */
  rulerMeters: number
  rulerPointCount: number
  onRulerUndo: () => void
  formatDistance: (meters: number) => string
  /** The area inside the ruler's line, already in words; null until it has three points. */
  rulerArea?: string | null
  fullscreen: boolean
  onFullscreenToggle: () => void
  fullscreenSupported: boolean
  /**
   * «Свои зоны»: what the ruler has outlined, or a circle around the picked
   * point, kept on the map under a name. Null until the server has said that
   * this viewer may draw zones — a button it would refuse is not drawn.
   */
  zoneDrawing?: {
    /**
     * Why the ruler's line cannot be a zone as it stands — too few points, a
     * line that crosses itself, points that enclose nothing — or null when it
     * can. The reason, so that it can be said: «Сохранить как зону» that is
     * simply not there explains nothing.
     */
    outlineProblem: LiveMapZoneOutlineProblem | null
    /** Resolves to why the server refused, or to null when the zone was kept. */
    onCreate: (kind: "outline" | "circle", values: LiveMapZoneFormValues) => Promise<LiveMapZoneWriteProblem | null>
  } | null
  /** The form of a zone that is already on the map, opened from its balloon. */
  zoneEditor?: ReactNode
}) {
  const tMap = useTranslations("mtmMap")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [notice, setNotice] = useState("")
  // Which new zone is being named. The form lives as long as the tool it came
  // from is in hand: the ruler, the picked point. Put the ruler down or remove
  // the point and the form goes too, instead of coming back by itself with the
  // next outline.
  //
  // An outline that merely stops being one a zone can be does NOT take the
  // form away. The ruler goes on taking presses while the form is open, so one
  // stray press — on the map, on a zone, on an employee's marker — could make
  // the line cross itself, and the form used to vanish with the name typed in
  // it and not a word of why. Now it stays, says the reason, and waits.
  const [zoneForm, setZoneForm] = useState<"outline" | "circle" | null>(null)
  const zoneFormShown = !zoneDrawing ? null
    : zoneForm === "outline" ? (rulerActive ? zoneForm : null)
      : zoneForm === "circle" ? (referencePoint ? zoneForm : null) : null
  if (zoneForm !== null && zoneFormShown === null) setZoneForm(null)
  const createZone = zoneDrawing?.onCreate
  const outlineProblem = zoneDrawing?.outlineProblem ?? null
  const outlineProblemText = outlineProblem
    ? tMap(`areas.outline.${outlineProblem}`, { max: new Intl.NumberFormat(locale).format(LIVE_MAP_ZONE_MAX_CORNERS) })
    : null
  // Too few points are mended by pressing the map; every other reason by taking the last point back.
  const outlineUndo = outlineProblem !== null && outlineProblem !== "tooFew" && rulerPointCount > 0

  const search = async (event: FormEvent) => {
    event.preventDefault()
    const text = query.trim().replace(/\s+/g, " ")
    setHits([])
    if (text.length < 3) {
      setNotice(tMap("tools.searchTooShort"))
      return
    }
    setSearching(true)
    setNotice("")
    try {
      const params = new URLSearchParams({ q: text, lang: locale })
      if (near) {
        params.set("lat", String(near.latitude))
        params.set("lng", String(near.longitude))
      }
      const response = await fetch(`/api/v1/mtm/geocode?${params.toString()}`, { headers: { Accept: "application/json" } })
      const body = await response.json().catch(() => null)
      if (response.status === 429) setNotice(tMap("tools.rateLimited"))
      else if (!response.ok || !Array.isArray(body?.data?.results)) setNotice(tMap("tools.searchFailed"))
      else if (body.data.results.length === 0) setNotice(tMap("tools.noResults"))
      else setHits(body.data.results as SearchHit[])
    } catch {
      setNotice(tMap("tools.searchFailed"))
    } finally {
      setSearching(false)
    }
  }

  const choose = (hit: SearchHit) => {
    onReferencePointChange({ latitude: hit.latitude, longitude: hit.longitude, label: hit.label })
    setHits([])
    setOpen(false)
  }

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[1100] flex max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col items-start gap-2" data-testid="live-map-tools">
      {open ? (
        <div id="live-map-point-panel" className="pointer-events-auto flex min-h-0 w-80 max-w-full flex-col rounded-lg border border-zinc-300 bg-card p-2 shadow-lg dark:border-zinc-600" data-testid="live-map-point-panel">
          <form onSubmit={search} className="flex shrink-0 items-center gap-1.5">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-background px-2.5 text-sm focus-within:border-primary/60 dark:border-zinc-700">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tMap("tools.searchPlaceholder")}
                aria-label={tMap("tools.searchPlaceholder")}
                data-testid="live-map-address-input"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
              />
            </label>
            <button type="submit" disabled={searching} data-testid="live-map-address-search" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-70">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {tMap(searching ? "tools.searching" : "tools.searchButton")}
            </button>
          </form>
          {notice ? <p role="status" className="mt-1.5 px-1 text-xs text-amber-800 dark:text-amber-300" data-testid="live-map-address-notice">{notice}</p> : null}
          {hits.length > 0 ? (
            <ul className="mt-1.5 min-h-0 divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-700" data-testid="live-map-address-hits">
              {/* The best three, two lines each: on a phone the map is 360 px
                  tall, and five wrapped addresses pushed the search field out of it. */}
              {hits.slice(0, MAX_HITS_SHOWN).map((hit) => (
                <li key={`${hit.latitude},${hit.longitude},${hit.label}`}>
                  <button type="button" onClick={() => choose(hit)} title={hit.label} className="flex min-h-11 w-full items-start gap-2 rounded px-1 py-1.5 text-left text-sm hover:bg-muted">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" aria-hidden="true" />
                    <span className="line-clamp-2 min-w-0">{hit.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => { onPickingPointChange(true); setOpen(false) }}
            data-testid="live-map-pick-point"
            className="mt-1.5 inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-300 text-sm font-medium hover:bg-muted dark:border-zinc-600"
          >
            <MousePointerClick className="h-4 w-4" aria-hidden="true" />{tMap("tools.pickOnMap")}
          </button>
          {hits.length === 0 ? <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">{tMap("tools.pointHint")}</p> : null}
        </div>
      ) : null}
      {zoneEditor ? <div className="pointer-events-auto w-80 max-w-full shrink-0" data-testid="live-map-zone-editor">{zoneEditor}</div> : null}
      {/* A new zone is named right here, beside what it is made of. */}
      {createZone && zoneFormShown ? (
        <LiveMapZoneForm
          key={zoneFormShown}
          className="pointer-events-auto w-80 max-w-full shrink-0 shadow-lg"
          task={{ kind: zoneFormShown }}
          blocked={zoneFormShown === "outline" && outlineProblemText
            ? { text: outlineProblemText, ...(outlineUndo ? { actionLabel: tMap("tools.rulerUndo"), onAction: onRulerUndo } : {}) }
            : null}
          onCancel={() => setZoneForm(null)}
          onSubmit={async (values) => {
            const refused = await createZone(zoneFormShown, values)
            if (!refused) setZoneForm(null)
            return refused
          }}
        />
      ) : null}
      {/* The ruler's reading, in words: what it measures so far and how to go on.
          On a phone it steps aside for the zone's form: the two together are taller than the map —
          which is why the form's own reason carries «Убрать последнюю» with it. */}
      {rulerActive ? (
        <div role="status" className={cn("pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-300 bg-card px-2.5 py-1.5 text-xs shadow-md dark:border-zinc-600", zoneFormShown && "max-sm:hidden")} data-testid="live-map-ruler">
          <span className="font-semibold" data-testid="live-map-ruler-total">{tMap("tools.rulerTotal", { distance: formatDistance(rulerMeters) })}</span>
          {rulerArea ? <span className="font-semibold" data-testid="live-map-ruler-area">{tMap("tools.rulerArea", { area: rulerArea })}</span> : null}
          {/* What has just been outlined can stay on the map as a zone with a name. */}
          {zoneDrawing && !zoneFormShown && outlineProblem === null ? (
            <button type="button" onClick={() => setZoneForm("outline")} data-testid="live-map-ruler-save-zone" className="inline-flex min-h-8 items-center rounded-md bg-primary px-2 font-semibold text-primary-foreground">
              {tMap("areas.saveOutline")}
            </button>
          ) : null}
          {/* …and when it cannot, the button is not merely gone: the line says why.
              Not before the third point — until then the ruler is only a ruler —
              and only to somebody who could have saved it. */}
          {zoneDrawing && !zoneFormShown && outlineProblemText && outlineProblem !== "tooFew" ? (
            <span className="text-amber-800 dark:text-amber-300" data-testid="live-map-ruler-outline-problem">{outlineProblemText}</span>
          ) : null}
          <span className="text-muted-foreground">{tMap(rulerPointCount === 0 ? "tools.rulerStart" : "tools.rulerHint")}</span>
          {rulerPointCount > 0 ? (
            <button type="button" onClick={onRulerUndo} data-testid="live-map-ruler-undo" className="inline-flex min-h-8 items-center font-semibold underline underline-offset-2">
              {tMap("tools.rulerUndo")}
            </button>
          ) : null}
          <button type="button" onClick={onRulerToggle} data-testid="live-map-ruler-done" className="inline-flex min-h-8 items-center rounded-md border border-zinc-300 px-2 font-semibold hover:bg-muted dark:border-zinc-600">
            {tMap("tools.rulerDone")}
          </button>
        </div>
      ) : null}
      {pickingPoint && !rulerActive ? (
        <div role="status" className="pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-300 bg-card px-2.5 py-1.5 text-xs shadow-md dark:border-zinc-600" data-testid="live-map-picking">
          <span className="font-semibold">{tMap("tools.pickingHint")}</span>
          <button type="button" onClick={() => onPickingPointChange(false)} data-testid="live-map-picking-cancel" className="inline-flex min-h-8 items-center font-semibold underline underline-offset-2">
            {tMap("tools.cancel")}
          </button>
        </div>
      ) : null}
      {/* Not while the panel is open: on a phone the two together are taller than the map. */}
      {referencePoint && !open ? (
        <div className={cn("pointer-events-auto flex max-w-full shrink-0 items-center gap-2 rounded-lg border border-rose-300 bg-card px-2.5 py-1.5 text-xs shadow-md dark:border-rose-800", zoneFormShown && "max-sm:hidden")} data-testid="live-map-point-chip">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-rose-700" aria-hidden="true" />
          <span className="min-w-0 truncate" title={referencePoint.label}>{tMap("tools.nearestTo", { label: referencePoint.label })}</span>
          <button type="button" onClick={() => onReferencePointChange(null)} data-testid="live-map-point-clear" className="inline-flex min-h-8 shrink-0 items-center gap-1 font-semibold underline underline-offset-2">
            <X className="h-3.5 w-3.5" aria-hidden="true" />{tMap("tools.clearPoint")}
          </button>
        </div>
      ) : null}
      {/* The picked point can be the centre of a zone. A button of its own, in
          words, beside the chip that names the point. */}
      {zoneDrawing && referencePoint && !open && !zoneFormShown ? (
        <button type="button" onClick={() => setZoneForm("circle")} data-testid="live-map-point-zone" className="pointer-events-auto inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-zinc-300 bg-card px-2.5 text-xs font-semibold shadow-md hover:bg-muted dark:border-zinc-600 [@media(pointer:coarse)]:min-h-11">
          <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />{tMap("areas.aroundPoint")}
        </button>
      ) : null}
      {/* While a tool waits for a press on the map its own line — with its way
          out — is all there is: on a phone the three buttons under it would
          take a third of the map. The same while a zone's form is open. */}
      <div className={cn("flex shrink-0 flex-wrap items-center gap-2", (rulerActive || pickingPoint || zoneFormShown || zoneEditor) && "max-sm:hidden")}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="live-map-point-panel"
          // The address panel and a zone's form do not fit a phone's map together: the panel takes the place.
          onClick={() => { setOpen((value) => !value); setZoneForm(null); if (pickingPoint) onPickingPointChange(false) }}
          data-testid="live-map-tool-point"
          className={cn(TOOL, open || pickingPoint ? TOOL_ON : TOOL_IDLE)}
        >
          <MapPin className="h-4 w-4" aria-hidden="true" />{tMap("tools.point")}
        </button>
        <button type="button" aria-pressed={rulerActive} onClick={onRulerToggle} data-testid="live-map-tool-ruler" className={cn(TOOL, rulerActive ? TOOL_ON : TOOL_IDLE)}>
          <Ruler className="h-4 w-4" aria-hidden="true" />{tMap("tools.ruler")}
        </button>
        {fullscreenSupported ? (
          <button type="button" aria-pressed={fullscreen} onClick={onFullscreenToggle} data-testid="live-map-tool-fullscreen" className={cn(TOOL, TOOL_IDLE)}>
            {fullscreen
              ? <><Minimize className="h-4 w-4" aria-hidden="true" />{tMap("tools.exitFullscreen")}</>
              : <><Maximize className="h-4 w-4" aria-hidden="true" />{tMap("tools.fullscreen")}</>}
          </button>
        ) : null}
      </div>
    </div>
  )
}
