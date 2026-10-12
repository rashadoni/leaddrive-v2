"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useMemo } from "react"
import L from "leaflet"
import { AttributionControl, Circle, MapContainer, Marker, Polyline, useMap } from "react-leaflet"
import { CartoBasemap } from "./carto-basemap"

type Point = { latitude: number; longitude: number }

/** A pin with a word over it — «Было», «Предлагает» — as on the agent's own screen. */
function pin(label: string, color: string, textColor: string): L.DivIcon {
  const safe = label.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);white-space:nowrap">`
      + `<span style="background:${color};color:${textColor};font:700 11px/1.2 system-ui,sans-serif;padding:3px 8px;border-radius:999px;box-shadow:0 1px 3px rgba(0,0,0,.25);margin-bottom:4px">${safe}</span>`
      + `<span style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`
      + `</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

/** Both pins on screen at once, however far apart; one pin alone at street level. */
function Frame({ points }: { points: Point[] }) {
  const map = useMap()
  const signature = points.map((point) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`).join(";")
  useEffect(() => {
    const invalidate = setTimeout(() => map.invalidateSize(), 150)
    if (points.length > 1) map.fitBounds(L.latLngBounds(points.map((point) => [point.latitude, point.longitude] as [number, number])), { padding: [48, 48], maxZoom: 17 })
    else if (points.length === 1) map.setView([points[0].latitude, points[0].longitude], 16)
    return () => clearTimeout(invalidate)
    // `signature` stands for the points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature])
  return null
}

/**
 * The map of one «Клиент здесь» request, for the manager who decides: where
 * the customer's pin stands, where the agent says the customer is, the line
 * between them — and, as a faint circle, where the agent's own phone was and
 * how sure of itself.
 *
 * Loaded only in the browser (Leaflet needs a window).
 */
export default function CustomerLocationRequestMap({ previous, proposed, agentFix, labels }: {
  /** Null: the customer had no pin. */
  previous: Point | null
  proposed: Point
  agentFix: Point & { accuracyMeters: number }
  labels: { previous: string; proposed: string }
}) {
  const previousIcon = useMemo(() => pin(labels.previous, "#9ca3af", "#111827"), [labels.previous])
  const proposedIcon = useMemo(() => pin(labels.proposed, "#ea580c", "#ffffff"), [labels.proposed])
  const points = previous ? [previous, proposed] : [proposed]
  return (
    <MapContainer
      center={[proposed.latitude, proposed.longitude]}
      zoom={16}
      attributionControl={false}
      scrollWheelZoom={false}
      style={{ position: "absolute", inset: 0 }}
    >
      <AttributionControl prefix={false} />
      <Frame points={points} />
      <CartoBasemap />
      <Circle
        center={[agentFix.latitude, agentFix.longitude]}
        radius={Math.max(agentFix.accuracyMeters, 5)}
        pathOptions={{ color: "#2563eb", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.15 }}
        interactive={false}
      />
      {previous ? (
        <>
          <Polyline
            positions={[[previous.latitude, previous.longitude], [proposed.latitude, proposed.longitude]]}
            pathOptions={{ color: "#111827", weight: 2, dashArray: "6 6" }}
            interactive={false}
          />
          <Marker position={[previous.latitude, previous.longitude]} icon={previousIcon} interactive={false} keyboard={false} />
        </>
      ) : null}
      <Marker position={[proposed.latitude, proposed.longitude]} icon={proposedIcon} interactive={false} keyboard={false} />
    </MapContainer>
  )
}
