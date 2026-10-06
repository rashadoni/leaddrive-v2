"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useRef, useState, type MutableRefObject } from "react"
import { MapContainer, Marker, useMapEvents, useMap } from "react-leaflet"
import L from "leaflet"
import { useLocale, useTranslations } from "next-intl"
import { LocateFixed, MapPin, Search } from "lucide-react"
import { CartoVectorBasemap } from "./carto-vector-basemap"

/**
 * Where an organization is: found by address, taken from where the manager
 * stands, or pointed at on the map — and corrected by hand afterwards.
 *
 * Until 2026-10-06 this was a map and one English sentence, «Click on map to
 * set location»: the manager had to find the building by eye. The owner:
 * «нужен тут поиск — по месту, где я сейчас, и по адресу, который я буду
 * писать, и потом чтобы можно было корректировать». All three end in the same
 * `onChange(lat, lng)` the click always made, so the organization's form and
 * its save are untouched.
 */

const markerIcon = L.divIcon({
  className: "custom-marker",
  html: `<div style="
    width: 32px; height: 32px; border-radius: 50%;
    background: #6C63FF;
    border: 3px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    cursor: grab;
  "></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
})

const DEFAULT_CENTER: [number, number] = [40.4093, 49.8671]
const PIN_ZOOM = 17

interface Props {
  latitude: number | null
  longitude: number | null
  onChange: (lat: number, lng: number) => void
  /** The address already typed in the form: offered as the first search. */
  address?: string
  /**
   * Given when the form takes its address from the map: the picker names the
   * address under the pin, and hands over the address of every pin the
   * manager sets here — by search, by «my location», by a click or a drag.
   */
  onAddress?: (place: PinAddress) => void
}

export type PinAddress = { address: string; district: string; city: string; label: string }
type SearchHit = { label: string; latitude: number; longitude: number }
type Notice = { tone: "info" | "problem"; text: string }

const sixDecimals = (value: number) => Math.round(value * 1000000) / 1000000

function ClickHandler({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(sixDecimals(e.latlng.lat), sixDecimals(e.latlng.lng))
    },
  })
  return null
}

/**
 * Keeps the map's idea of its own size true (the pattern of live-map.tsx).
 *
 * The list of found addresses opens above the map and closes again, so the
 * map's box changes height while it is on screen. Leaflet measures the box
 * once; on production (2026-10-06) the map came back from a search with a
 * grey band down one side and the pin off-centre, because the picture was
 * still being drawn for the box it had before.
 */
function InvalidateSize() {
  const map = useMap()
  useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 100)
    const t2 = setTimeout(() => map.invalidateSize(), 500)
    const t3 = setTimeout(() => map.invalidateSize(), 1500)
    const parent = map.getContainer()?.parentElement
    let observer: ResizeObserver | null = null
    if (parent && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => map.invalidateSize())
      observer.observe(parent)
    }
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      observer?.disconnect()
    }
  }, [map])
  return null
}

/** Remembers the middle of what the manager is looking at: nearby addresses first. */
function CenterTracker({ centerRef }: { centerRef: MutableRefObject<[number, number]> }) {
  const map = useMapEvents({
    moveend() {
      const center = map.getCenter()
      centerRef.current = [center.lat, center.lng]
    },
  })
  return null
}

/** Brings a point chosen outside the map — an address, the browser's location — into view. */
function FlyTo({ target }: { target: { latitude: number; longitude: number; seq: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    // The list of addresses has just closed and the map's box has grown:
    // measure it before flying, or the flight ends centred on the old box.
    map.invalidateSize()
    map.flyTo([target.latitude, target.longitude], Math.max(map.getZoom(), PIN_ZOOM), { duration: 0.5 })
  }, [map, target])
  return null
}

function FullScreenMap({ latitude, longitude, onChange, onClose, address, onAddress }: Props & { onClose: () => void }) {
  const t = useTranslations("mtmLocationPicker")
  const locale = useLocale()
  const hasPosition = latitude != null && longitude != null && latitude !== 0 && longitude !== 0
  const center: [number, number] = hasPosition ? [latitude!, longitude!] : DEFAULT_CENTER
  const centerRef = useRef<[number, number]>(center)

  const [query, setQuery] = useState(address?.trim() ?? "")
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const [target, setTarget] = useState<{ latitude: number; longitude: number; seq: number } | null>(null)
  // The address under the pin. Owner, 2026-10-07: he moved the pin and the
  // card kept showing the old address; then — «адрес поле убери из заполнений,
  // пусть он добавляется через поиск на карте». So the card's address is what
  // stands under the pin the manager set, and it is written without a second
  // press. A pin that was only looked at is not a pin that was set: opening
  // the map over a card must not rewrite its address. `forPoint` ties an
  // answer to the pin it was asked for.
  const [pinPlace, setPinPlace] = useState<{ forPoint: string; place: PinAddress | null } | null>(null)
  const [movedHere, setMovedHere] = useState(false)
  const writtenFor = useRef<string | null>(null)
  const onAddressRef = useRef(onAddress)
  onAddressRef.current = onAddress
  const pointKey = hasPosition ? `${latitude},${longitude}` : null
  const move = (lat: number, lng: number) => {
    setMovedHere(true)
    onChange(lat, lng)
  }
  // Whether the form takes an address back — not the callback itself, which
  // is a new function on every render of the form.
  const wantsAddress = Boolean(onAddress)

  useEffect(() => {
    if (!wantsAddress || !pointKey || !hasPosition) return
    let cancelled = false
    // The pin is dragged in steps; ask once it has rested.
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ lat: String(latitude), lng: String(longitude), lang: locale })
      fetch(`/api/v1/mtm/geocode/reverse?${params.toString()}`, { headers: { Accept: "application/json" } })
        .then(async (response) => (response.ok ? await response.json().catch(() => null) : null))
        .then((body) => {
          if (cancelled || !body?.data) return
          const found = body.data.place
          const place = found && typeof found.label === "string" && found.label ? (found as PinAddress) : null
          setPinPlace({ forPoint: pointKey, place })
        })
        .catch(() => {})
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [hasPosition, latitude, locale, longitude, pointKey, wantsAddress])

  const lookedUp = pinPlace !== null && pinPlace.forPoint === pointKey
  const placeUnderPin = lookedUp ? pinPlace.place : null

  // Hand the address of a pin the manager set to the form, once per pin.
  useEffect(() => {
    if (!movedHere || !pointKey || !placeUnderPin || writtenFor.current === pointKey) return
    writtenFor.current = pointKey
    onAddressRef.current?.(placeUnderPin)
  }, [movedHere, placeUnderPin, pointKey])

  const place = (lat: number, lng: number) => {
    const point = { latitude: sixDecimals(lat), longitude: sixDecimals(lng) }
    move(point.latitude, point.longitude)
    setTarget((current) => ({ ...point, seq: (current?.seq ?? 0) + 1 }))
  }

  const search = async () => {
    const text = query.trim().replace(/\s+/g, " ")
    setHits([])
    if (text.length < 3) {
      setNotice({ tone: "problem", text: t("searchTooShort") })
      return
    }
    setSearching(true)
    setNotice(null)
    try {
      const params = new URLSearchParams({
        q: text,
        lang: locale,
        lat: String(centerRef.current[0]),
        lng: String(centerRef.current[1]),
      })
      const response = await fetch(`/api/v1/mtm/geocode?${params.toString()}`, { headers: { Accept: "application/json" } })
      const body = await response.json().catch(() => null)
      if (response.status === 429) {
        setNotice({ tone: "problem", text: t("rateLimited") })
      } else if (!response.ok || !Array.isArray(body?.data?.results)) {
        setNotice({ tone: "problem", text: t("searchFailed") })
      } else if (body.data.results.length === 0) {
        setNotice({ tone: "problem", text: t("noResults") })
      } else {
        setHits(body.data.results as SearchHit[])
      }
    } catch {
      setNotice({ tone: "problem", text: t("searchFailed") })
    } finally {
      setSearching(false)
    }
  }

  const locate = () => {
    setHits([])
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNotice({ tone: "problem", text: t("locationUnavailable") })
      return
    }
    setLocating(true)
    setNotice(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        place(position.coords.latitude, position.coords.longitude)
        // A laptop is placed by its Wi-Fi, often a block off: say how sure
        // the browser is instead of presenting the pin as a measurement.
        setNotice({ tone: "info", text: t("locationAccuracy", { meters: Math.max(1, Math.round(position.coords.accuracy)) }) })
      },
      (error) => {
        setLocating(false)
        setNotice({ tone: "problem", text: t(error.code === error.PERMISSION_DENIED ? "locationDenied" : "locationUnavailable") })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col"
      onClick={(e) => e.stopPropagation()}
      data-testid="mtm-location-picker"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative m-2 flex flex-1 flex-col overflow-hidden rounded-xl bg-card text-foreground shadow-2xl sm:m-10">
        <div className="space-y-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-700 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-sm font-semibold">
              {t("title")}
              {hasPosition && (
                <span className="ml-3 text-xs font-normal text-muted-foreground" data-testid="mtm-location-picker-coordinates">
                  {latitude!.toFixed(6)}, {longitude!.toFixed(6)}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-h-9 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              {t("done")}
            </button>
          </div>

          {/* Not a <form>: this sits inside the organization's own form, and
              Enter here must search, not save the organization. */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex min-w-0 flex-1 gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return
                  e.preventDefault()
                  void search()
                }}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                maxLength={200}
                className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-200/70 bg-background px-3 text-base dark:border-zinc-700/70 md:text-sm"
              />
              <button
                type="button"
                onClick={() => { void search() }}
                disabled={searching}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                {searching ? t("searching") : t("search")}
              </button>
            </div>
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
            >
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
              {locating ? t("locating") : t("myLocation")}
            </button>
          </div>

          {hits.length > 0 && (
            <div data-testid="mtm-location-picker-results">
              <p className="text-xs font-medium text-muted-foreground">{t("resultsTitle")}</p>
              <ul className="mt-1 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                {hits.map((hit) => (
                  <li key={`${hit.latitude},${hit.longitude},${hit.label}`}>
                    <button
                      type="button"
                      onClick={() => {
                        place(hit.latitude, hit.longitude)
                        setHits([])
                        setNotice(null)
                      }}
                      className="flex min-h-10 w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="min-w-0">{hit.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p
            role="status"
            className={notice?.tone === "problem" ? "text-xs text-red-600 dark:text-red-400" : "text-xs text-muted-foreground"}
            data-testid="mtm-location-picker-notice"
          >
            {notice?.text ?? t(hasPosition ? "hintSet" : "hintEmpty")}
          </p>

          {onAddress && lookedUp && (placeUnderPin || movedHere) && (
            <p
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
              data-testid="mtm-location-picker-pin-address"
            >
              {placeUnderPin ? (
                <>
                  <span className="text-muted-foreground">{t("pinAddress")}</span>{" "}
                  <span className="font-medium">{placeUnderPin.label}</span>
                  {movedHere && <span className="text-muted-foreground"> — {t("addressWritten")}</span>}
                </>
              ) : (
                <span className="text-muted-foreground">{t("pinAddressUnknown")}</span>
              )}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1">
          <MapContainer center={center} zoom={hasPosition ? 16 : 13} style={{ height: "100%", width: "100%" }}>
            <CartoVectorBasemap />
            <ClickHandler onChange={move} />
            <CenterTracker centerRef={centerRef} />
            <FlyTo target={target} />
            <InvalidateSize />
            {hasPosition && (
              <Marker
                position={[latitude!, longitude!]}
                icon={markerIcon}
                draggable
                eventHandlers={{
                  dragend(event) {
                    const point = (event.target as L.Marker).getLatLng()
                    move(sixDecimals(point.lat), sixDecimals(point.lng))
                  },
                }}
              />
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  )
}

export default function LocationPickerMap({ latitude, longitude, onChange, address, onAddress }: Props) {
  const t = useTranslations("mtmLocationPicker")
  const [expanded, setExpanded] = useState(false)
  const hasPosition = latitude != null && longitude != null && latitude !== 0 && longitude !== 0

  return (
    <>
      {/* Compact preview — click to expand */}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        style={{
          width: "100%", height: 120, borderRadius: 8, border: "1px solid var(--border, #e2e8f0)",
          background: hasPosition ? "#f0f9ff" : "#f8fafc",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          cursor: "pointer", gap: 6, transition: "all 0.15s",
        }}
      >
        <span style={{ fontSize: 28 }}>{hasPosition ? "📍" : "🗺️"}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
          {hasPosition ? `${latitude!.toFixed(4)}, ${longitude!.toFixed(4)}` : t("previewEmpty")}
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>
          {hasPosition ? t("previewChange") : t("previewEmptyHint")}
        </span>
      </button>

      {/* Full screen map modal */}
      {expanded && (
        <FullScreenMap
          latitude={latitude}
          longitude={longitude}
          onChange={onChange}
          address={address}
          onAddress={onAddress}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  )
}
