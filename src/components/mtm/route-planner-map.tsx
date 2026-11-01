"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useMemo, useRef } from "react"
import { CircleMarker, MapContainer, Marker, Polyline, Popup, useMap } from "react-leaflet"
import L from "leaflet"
import { CartoBasemap } from "./carto-basemap"
import type { RoutePlannerCandidate, RoutePlannerPlace } from "@/lib/mtm/route-planner"

/**
 * The route planner's map (/mtm/routes/plan): every organization the agent
 * may visit — orange where somebody has had no visit this month, grey where
 * everybody has — and the day's route on top of it, numbered, joined by a
 * dashed line. A click on a place opens it with a button per client.
 */

const DUE = "#f97316"
const VISITED = "#a1a1aa"
const ROUTE = "#18181b"

const stopIcon = (index: number) => L.divIcon({
  className: "mtm-route-planner-stop",
  html: `<div aria-hidden="true" style="width:26px;height:26px;border-radius:13px;background:${ROUTE};color:#fff;font:700 12px/26px var(--font-dashboard, system-ui), system-ui, sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">${index + 1}</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

export type RoutePlannerMapStop = { key: string; latitude: number | null; longitude: number | null }

export type RoutePlannerMapWords = {
  label: string
  dueThisMonth: string
  visitedThisMonth: string
  inRoute: string
  /** The organization as a stop of its own, without a named doctor. */
  placeVisit: string
  add: (candidate: RoutePlannerCandidate) => string
  candidateLine: (candidate: RoutePlannerCandidate) => string
}

/** Fits all places once, when they first arrive; the route's growth never moves the map. */
function FitOnce({ places, focus }: { places: RoutePlannerPlace[]; focus: RoutePlannerPlace | null }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || places.length === 0) return
    fitted.current = true
    map.invalidateSize()
    if (places.length === 1) map.setView([places[0].latitude, places[0].longitude], 15)
    else map.fitBounds(L.latLngBounds(places.map((place) => [place.latitude, place.longitude] as [number, number])), { padding: [48, 48], maxZoom: 15 })
  }, [map, places])
  useEffect(() => {
    if (focus) map.flyTo([focus.latitude, focus.longitude], Math.max(map.getZoom(), 15), { duration: 0.4 })
  }, [map, focus])
  return null
}

export default function RoutePlannerMap({
  places,
  stops,
  selectedPlaceId,
  focusPlaceId,
  onSelectPlace,
  onAdd,
  words,
}: {
  places: RoutePlannerPlace[]
  stops: RoutePlannerMapStop[]
  selectedPlaceId: string | null
  focusPlaceId: string | null
  onSelectPlace: (customerId: string | null) => void
  onAdd: (candidate: RoutePlannerCandidate) => void
  words: RoutePlannerMapWords
}) {
  const inRoute = useMemo(() => new Set(stops.map((stop) => stop.key)), [stops])
  const routeLine = useMemo(() => stops
    .filter((stop): stop is RoutePlannerMapStop & { latitude: number; longitude: number } => typeof stop.latitude === "number" && typeof stop.longitude === "number")
    .map((stop) => [stop.latitude, stop.longitude] as [number, number]), [stops])
  const selected = places.find((place) => place.customerId === selectedPlaceId) ?? null
  const focus = places.find((place) => place.customerId === focusPlaceId) ?? null
  const center: [number, number] = places[0] ? [places[0].latitude, places[0].longitude] : [40.4093, 49.8671]

  return (
    <section aria-label={words.label} className="h-full w-full" data-testid="mtm-route-planner-map">
      <MapContainer center={center} zoom={12} zoomControl={false} style={{ height: "100%", width: "100%" }}>
        <CartoBasemap />
        <FitOnce places={places} focus={focus} />
        {places.map((place) => (
          <CircleMarker
            key={place.customerId}
            center={[place.latitude, place.longitude]}
            radius={7}
            pathOptions={{ color: "#fff", weight: 2, fillColor: place.dueThisMonth ? DUE : VISITED, fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelectPlace(place.customerId) }}
          />
        ))}
        {routeLine.length > 1 ? <Polyline positions={routeLine} pathOptions={{ color: ROUTE, weight: 4, opacity: 0.8, dashArray: "6 6" }} /> : null}
        {stops.map((stop, index) => (typeof stop.latitude === "number" && typeof stop.longitude === "number"
          ? <Marker key={stop.key} position={[stop.latitude, stop.longitude]} icon={stopIcon(index)} />
          : null))}
        {selected ? (
          <Popup position={[selected.latitude, selected.longitude]} eventHandlers={{ remove: () => onSelectPlace(null) }} offset={[0, -4]}>
            <div className="min-w-[220px] max-w-[280px] space-y-2 font-dashboard text-[13px]" data-testid="mtm-route-planner-popup">
              <div>
                <p className="font-semibold leading-snug">{selected.name}</p>
                {selected.address ? <p className="text-xs text-muted-foreground">{selected.address}</p> : null}
              </div>
              <ul className="space-y-1.5">
                {selected.candidates.map((candidate) => {
                  const taken = inRoute.has(candidate.key)
                  return (
                    <li key={candidate.key} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{candidate.contactId ? candidate.name : words.placeVisit}</span>
                        <span className="block truncate text-xs text-muted-foreground">{words.candidateLine(candidate)}</span>
                      </span>
                      <button
                        type="button"
                        disabled={taken}
                        data-testid={`mtm-route-planner-add-${candidate.key}`}
                        onClick={() => onAdd(candidate)}
                        className="inline-flex h-7 shrink-0 items-center rounded-full bg-primary px-2.5 text-xs font-semibold text-primary-foreground disabled:bg-zinc-200 disabled:text-zinc-500" data-crm-button="default"
                      >
                        {taken ? words.inRoute : words.add(candidate)}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Popup>
        ) : null}
      </MapContainer>
    </section>
  )
}
