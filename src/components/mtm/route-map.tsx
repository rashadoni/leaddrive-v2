"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { MapContainer, Marker, Popup, Polyline, useMap } from "react-leaflet"
import L from "leaflet"
import { hasMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { CartoVectorBasemap } from "./carto-vector-basemap"
import { createDateFormatter } from "@/lib/format-date"

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

interface RoutePoint {
  id: string
  orderIndex: number
  status: string
  customer?: { name?: string; latitude?: number | null; longitude?: number | null }
  visitedAt?: string | null
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
}

function pointStatusMessageKey(status: string): "pointStatusPending" | "pointStatusVisited" | "pointStatusSkipped" | "pointStatusUnknown" {
  switch (status) {
    case "PENDING": return "pointStatusPending"
    case "VISITED": return "pointStatusVisited"
    case "SKIPPED": return "pointStatusSkipped"
    default: return "pointStatusUnknown"
  }
}

function visitedTime(value: string | null | undefined, locale: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return createDateFormatter(locale, { timeStyle: "short" }).format(parsed)
}

export default function MtmRouteMap({ points }: Props) {
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
  const pointDetails = (point: RoutePoint, index: number) => {
    const stop = t("routeMapStopLabel", {
      number: index + 1,
      name: point.customer?.name?.trim() || t("routeMapUnnamedStop"),
    })
    const status = t("routeMapStatusLabel", { status: t(pointStatusMessageKey(point.status)) })
    const visitedAt = visitedTime(point.visitedAt, locale)
    const visited = visitedAt ? t("routeMapVisitedAt", { time: visitedAt }) : null
    return {
      stop,
      status,
      visited,
      accessibleLabel: visited ? `${stop}. ${status}. ${visited}` : `${stop}. ${status}`,
    }
  }

  return (
    <section
      ref={containerRef}
      aria-label={t("routeMapLabel")}
      style={{ height: "100%", width: "100%", minHeight: 400, display: "flex", flexDirection: "column" }}
    >
      <ol className="sr-only" aria-label={t("routeMapStopsLabel")}>
        {validPoints.map((point, index) => <li key={point.id}>{pointDetails(point, index).accessibleLabel}</li>)}
      </ol>
      <div style={{ flex: 1, minHeight: 0 }}>
        {ready ? (
          <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }}>
            <InvalidateSize />
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
                        {details.visited ? <> · {details.visited}</> : null}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              )
            })}
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
