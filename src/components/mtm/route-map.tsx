"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CircleMarker, MapContainer, Marker, Popup, Polyline, useMap } from "react-leaflet"
import L from "leaflet"
import { hasMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { CartoVectorBasemap } from "./carto-vector-basemap"
import { formatTime } from "@/lib/format-date"
import { summarizeMtmRouteExecution, type MtmRoutePointVisitFact } from "@/lib/mtm/route-point-execution"

function InvalidateSize() {
  const map = useMap()
  useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 100)
    const t2 = setTimeout(() => map.invalidateSize(), 500)
    const t3 = setTimeout(() => map.invalidateSize(), 1500)
    const container = map.getContainer()
    const parent = container?.parentElement
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
 * Frames every stop, and every recorded check-in position, when the map
 * mounts and when those positions change.
 *
 * Prod audit 2026-09-14: the route dialog centred on the first stop at zoom 13,
 * so a second stop a few kilometres away — and check-ins 7.8 and 13.1 km from
 * their pins — were simply off screen. A resize only re-measures the map
 * (`InvalidateSize`); refitting on it reset the user's own zoom (review of #205).
 */
function FitRouteBounds({ positions }: { positions: Array<[number, number]> }) {
  const map = useMap()
  const signature = positions.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join("|")
  useEffect(() => {
    if (positions.length === 0) return
    map.invalidateSize()
    if (positions.length === 1) map.setView(positions[0], 15)
    else map.fitBounds(L.latLngBounds(positions), { padding: [32, 32], maxZoom: 16 })
    // `signature` stands for `positions`: a new array with the same points must not refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature])
  return null
}

interface RoutePoint {
  id: string
  orderIndex: number
  status: string
  customer?: { name?: string; latitude?: number | null; longitude?: number | null }
  visitedAt?: string | null
  plannedTime?: string | null
  visits?: MtmRoutePointVisitFact[] | null
}

const createPointIcon = (index: number, status: string) =>
  L.divIcon({
    className: "custom-marker",
    html: `<div aria-hidden="true" style="
      width: 28px; height: 28px; border-radius: 50%;
      background: ${status === "VISITED" ? "#22c55e" : status === "SKIPPED" ? "#ef4444" : "#94a3b8"};
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 12px; font-weight: bold;
    ">${index + 1}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })

interface Props {
  points: RoutePoint[]
  /** Tenant timezone for stop times; the browser's when omitted. */
  timezone?: string
}

function pointStatusMessageKey(status: string): "pointStatusPending" | "pointStatusVisited" | "pointStatusSkipped" | "pointStatusUnknown" {
  switch (status) {
    case "PENDING": return "pointStatusPending"
    case "VISITED": return "pointStatusVisited"
    case "SKIPPED": return "pointStatusSkipped"
    default: return "pointStatusUnknown"
  }
}

function stopTime(value: string | null | undefined, locale: string, timezone?: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return formatTime(parsed, locale, { hour: "2-digit", minute: "2-digit", ...(timezone ? { timeZone: timezone } : {}) })
}

export default function MtmRouteMap({ points, timezone }: Props) {
  const t = useTranslations("mtmRoutesPage")
  const locale = useLocale()
  const containerRef = useRef<HTMLElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const check = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width > 100 && height > 100) setReady(true)
    }
    check()
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => check())
      observer.observe(el)
    }
    const fallback = setTimeout(() => setReady(true), 500)
    return () => { observer?.disconnect(); clearTimeout(fallback) }
  }, [])

  // A stop without a stored pair has no place on the map. It is never drawn
  // at (0, 0): that point is in the Gulf of Guinea, and until 2026-09 the
  // route card showed marker "1" in the ocean for exactly this case.
  const validPoints = points
    .filter((point) => hasMtmCoordinates(point.customer))
    .sort((a, b) => a.orderIndex - b.orderIndex)
  const missingCount = points.length - validPoints.length

  if (points.length === 0) return null

  if (validPoints.length === 0) {
    return (
      <section
        ref={containerRef}
        aria-label={t("routeMapLabel")}
        data-testid="mtm-route-map-empty"
        className="flex h-full w-full items-center justify-center bg-muted/30 p-6 text-center text-sm text-muted-foreground"
      >
        <p className="max-w-md">{t("routeMapNoCoordinates")}</p>
      </section>
    )
  }

  const center: [number, number] = [validPoints[0].customer!.latitude!, validPoints[0].customer!.longitude!]

  const polylinePositions: [number, number][] = validPoints.map((p) => [
    p.customer!.latitude!,
    p.customer!.longitude!,
  ])
  const execution = summarizeMtmRouteExecution(points)
  const factByPoint = new Map(execution.points.map((fact) => [fact.pointId, fact]))
  // Where the agent actually stood at check-in, drawn next to the pin it
  // belongs to. A long connector is the out-of-zone check-in, visibly.
  const checkIns = validPoints.flatMap((point, index) => {
    const visit = factByPoint.get(point.id)?.visit
    const position = { latitude: visit?.checkInLat, longitude: visit?.checkInLng }
    if (!visit || !hasMtmCoordinates(position)) return []
    return [{
      id: `${point.id}:${visit.id}`,
      index,
      position: [position.latitude, position.longitude] as [number, number],
      stop: [point.customer!.latitude!, point.customer!.longitude!] as [number, number],
      time: stopTime(typeof visit.checkInAt === "string" ? visit.checkInAt : visit.checkInAt?.toISOString(), locale, timezone),
    }]
  })
  const framedPositions: Array<[number, number]> = [...polylinePositions, ...checkIns.map((checkIn) => checkIn.position)]
  const pointDetails = (point: RoutePoint, index: number) => {
    const stop = t("routeMapStopLabel", {
      number: index + 1,
      name: point.customer?.name?.trim() || t("routeMapUnnamedStop"),
    })
    const status = t("routeMapStatusLabel", { status: t(pointStatusMessageKey(point.status)) })
    const fact = factByPoint.get(point.id)
    const planned = point.plannedTime ? t("stopFact.planned", { time: stopTime(point.plannedTime, locale, timezone) ?? "" }) : null
    // `visitedAt` is when the stop was closed. It used to be labelled as the
    // visit time; with the visit known, show arrival and departure instead.
    const visited = fact?.visit && fact.checkInAt
      ? fact.checkOutAt
        ? t("stopFact.fact", { from: stopTime(fact.checkInAt, locale, timezone) ?? "", to: stopTime(fact.checkOutAt, locale, timezone) ?? "" })
        : t("stopFact.factOpen", { from: stopTime(fact.checkInAt, locale, timezone) ?? "" })
      : point.visitedAt
        ? t("stopFact.closedAt", { time: stopTime(point.visitedAt, locale, timezone) ?? "" })
        : null
    return {
      planned,
      stop,
      status,
      visited,
      accessibleLabel: [stop, status, planned, visited].filter(Boolean).join(". "),
    }
  }

  return (
    <section
      ref={containerRef}
      aria-label={t("routeMapLabel")}
      style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column" }}
    >
      <ol className="sr-only" aria-label={t("routeMapStopsLabel")}>
        {validPoints.map((point, index) => <li key={point.id}>{pointDetails(point, index).accessibleLabel}</li>)}
      </ol>
      <div style={{ flex: 1, minHeight: 0 }}>
        {ready ? (
          <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }}>
            <InvalidateSize />
            <FitRouteBounds positions={framedPositions} />
            <CartoVectorBasemap />
            {/* Route line */}
            <Polyline positions={polylinePositions} color="#6366f1" weight={3} opacity={0.7} dashArray="8 4" />
            {/* Point markers */}
            {validPoints.map((point, i) => {
              const details = pointDetails(point, i)
              return (
                <Marker
                  key={point.id}
                  position={[point.customer!.latitude!, point.customer!.longitude!]}
                  icon={createPointIcon(i, point.status)}
                  keyboard
                  alt={details.accessibleLabel}
                  title={details.accessibleLabel}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-semibold">{details.stop}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {details.status}
                      </div>
                      {details.planned ? <div className="text-xs text-muted-foreground">{details.planned}</div> : null}
                      {details.visited ? <div className="text-xs font-medium">{details.visited}</div> : null}
                    </div>
                  </Popup>
                </Marker>
              )
            })}
            {checkIns.map((checkIn) => (
              <Polyline key={`link-${checkIn.id}`} positions={[checkIn.stop, checkIn.position]} color="#0ea5e9" weight={1.5} opacity={0.6} dashArray="2 6" />
            ))}
            {checkIns.map((checkIn) => (
              <CircleMarker
                key={`checkin-${checkIn.id}`}
                center={checkIn.position}
                radius={6}
                pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#0ea5e9", fillOpacity: 0.95 }}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold">#{checkIn.index + 1}</div>
                    <div className="text-xs text-muted-foreground mt-1">{t("stopFact.checkInPosition", { time: checkIn.time ?? "—" })}</div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        ) : (
          <div style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 14 }}>
            {t("routeMapLoading")}
          </div>
        )}
      </div>
      {missingCount > 0 ? (
        <p data-testid="mtm-route-map-missing" className="border-t border-zinc-200 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground dark:border-zinc-700">
          {t("routeMapMissingCoordinates", { count: missingCount })}
        </p>
      ) : null}
    </section>
  )
}
