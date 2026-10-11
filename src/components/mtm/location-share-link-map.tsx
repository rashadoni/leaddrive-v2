"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useMemo } from "react"
import L from "leaflet"
import { AttributionControl, MapContainer, Marker, useMap } from "react-leaflet"
import { liveMapAgentMarker } from "@/lib/mtm/live-map-agent-marker"
import { CartoBasemap } from "./carto-basemap"

/** Close enough to read the street names around the point. */
const ZOOM = 15

/** The map measures its box when it mounts; the box settles a moment later — fonts, the address bar of a phone. */
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
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); observer?.disconnect() }
  }, [map])
  return null
}

/**
 * Keeps the point in the middle when the employee moves. The zoom is the
 * visitor's own: only the centre follows, and only when the point changed —
 * an answer that repeats the same coordinate does not pull the map back from
 * where the visitor dragged it.
 *
 * `recentreKey` is the one other thing that brings the map back: it changes
 * when the visitor presses «Обновить». He has dragged the map away from an
 * employee who is standing still, and the same coordinate coming back would
 * otherwise leave him without the marker and without a way to it.
 */
function FollowPoint({ latitude, longitude, recentreKey }: { latitude: number; longitude: number; recentreKey: number }) {
  const map = useMap()
  const signature = `${latitude.toFixed(5)},${longitude.toFixed(5)}`
  useEffect(() => {
    map.setView([latitude, longitude], map.getZoom())
    // `signature` stands for the pair: the same point again must not re-centre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature, recentreKey])
  return null
}

/**
 * The map of the public page behind a «ссылка на местоположение»: the
 * usual background and one marker — where the employee is now.
 *
 * Nothing else is drawn, because nothing else is known here: the page is
 * given a name and one point. No track, no circle of accuracy, no balloon —
 * and the marker carries no colour a manager gave the employee: that colour
 * is the managers' own note about a person.
 *
 * The corner says whose the background is — OpenStreetMap and CARTO, as they
 * ask — and no more: the library's own mark, with the flag it carries, is
 * left off the one map of ours that people outside a customer's organization
 * see.
 *
 * Loaded only in the browser (Leaflet needs a window).
 */
export default function LocationShareLinkMap({ latitude, longitude, name, recentreKey }: {
  latitude: number
  longitude: number
  /** The employee's name: its first letter is on the marker. */
  name: string
  /** Changes when the visitor asks for the marker back: the map returns to it even if the point has not moved. */
  recentreKey: number
}) {
  const icon = useMemo(() => {
    // The marker of the managers' own map, as it draws a fresh position.
    const { html, size } = liveMapAgentMarker({ name, freshness: "ONLINE", focused: true })
    return L.divIcon({ className: "mtm-agent-marker", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
  }, [name])

  return (
    <MapContainer center={[latitude, longitude]} zoom={ZOOM} attributionControl={false} style={{ position: "absolute", inset: 0 }}>
      <AttributionControl prefix={false} />
      <InvalidateSize />
      <FollowPoint latitude={latitude} longitude={longitude} recentreKey={recentreKey} />
      <CartoBasemap />
      {/* Not a button: pressing it would open nothing. */}
      <Marker position={[latitude, longitude]} icon={icon} interactive={false} keyboard={false} />
    </MapContainer>
  )
}
