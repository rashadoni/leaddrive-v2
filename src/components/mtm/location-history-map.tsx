"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { CircleMarker, MapContainer, Polyline, Popup, useMap } from "react-leaflet"
import L from "leaflet"
import { useTranslations } from "next-intl"
import { formatInTimezone } from "@/lib/timezone"
import { CartoVectorBasemap } from "./carto-vector-basemap"

type Point = {
  id: string
  latitude: number
  longitude: number
  accuracy: number | null
  battery: number | null
  recordedAt: string
}

type Stop = {
  id: string
  latitude: number
  longitude: number
  startedAt: string
  endedAt: string
  durationSeconds: number
  averageAccuracy: number | null
  batteryStart: number | null
  batteryEnd: number | null
  connectivity: "ONLINE" | "OFFLINE_GAPS"
  visit: { customerName: string; customerAddress: string | null; confirmed: true } | null
}

type Visit = {
  id: string
  checkInAt: string
  checkInLat: number | null
  checkInLng: number | null
  customer: {
    name: string
    latitude: number | null
    longitude: number | null
  }
}

type Workday = {
  startedAt: string
  completedAt: string | null
  startLatitude: number | null
  startLongitude: number | null
  endLatitude: number | null
  endLongitude: number | null
} | null

type PlannedRoute = {
  id: string
  points: Array<{
    id: string
    orderIndex: number
    status: "PENDING" | "VISITED" | "SKIPPED"
    plannedTime: string | null
    label: string
    customer: {
      latitude: number | null
      longitude: number | null
    }
  }>
}

type Gap = {
  id: string
  startedAt: string
  endedAt: string
  startLatitude: number
  startLongitude: number
  endLatitude: number
  endLongitude: number
}

function ResizeAndFit({ coordinates }: { coordinates: L.LatLngTuple[] }) {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize()
      if (coordinates.length === 1) map.setView(coordinates[0], 15)
      if (coordinates.length > 1) map.fitBounds(L.latLngBounds(coordinates), { padding: [36, 36] })
    }, 50)
    return () => clearTimeout(timer)
  }, [coordinates, map])
  return null
}

export default function LocationHistoryMap({
  points,
  stops,
  visits,
  workday,
  plannedRoutes,
  gaps,
  layers,
  locale,
  timezone,
  playbackIndex,
}: {
  points: Point[]
  stops: Stop[]
  visits: Visit[]
  workday: Workday
  plannedRoutes: PlannedRoute[]
  gaps: Gap[]
  layers: {
    planned: boolean
    actual: boolean
    stops: boolean
    visits: boolean
    gaps: boolean
  }
  locale: string
  timezone: string
  playbackIndex: number
}) {
  const t = useTranslations("mtmMap.history")
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const boundedPlaybackIndex = points.length ? Math.min(points.length - 1, Math.max(0, playbackIndex)) : 0
  const visiblePointCount = points.length ? boundedPlaybackIndex + 1 : 0
  const playbackPoint = points[boundedPlaybackIndex] ?? null
  const visiblePoints = useMemo(
    () => layers.actual ? points.slice(0, visiblePointCount) : [],
    [layers.actual, points, visiblePointCount],
  )
  const fullActualPath = useMemo(
    () => layers.actual ? points.map((point) => [point.latitude, point.longitude] as L.LatLngTuple) : [],
    [layers.actual, points],
  )
  const actualPath = useMemo(
    () => visiblePoints.map((point) => [point.latitude, point.longitude] as L.LatLngTuple),
    [visiblePoints],
  )
  const activePoint = visiblePoints.at(-1) ?? null
  const playbackAt = playbackPoint ? new Date(playbackPoint.recordedAt).getTime() : Number.POSITIVE_INFINITY
  const plannedPaths = useMemo(() => layers.planned
    ? plannedRoutes.map((route) => ({
        ...route,
        coordinates: route.points.flatMap((point) =>
          point.customer.latitude == null || point.customer.longitude == null
            ? []
            : [[point.customer.latitude, point.customer.longitude] as L.LatLngTuple],
        ),
      }))
    : [], [layers.planned, plannedRoutes])
  const visitMarkers = useMemo(() => visits.flatMap((visit) => {
    const latitude = visit.checkInLat ?? visit.customer.latitude
    const longitude = visit.checkInLng ?? visit.customer.longitude
    return latitude == null || longitude == null ? [] : [{ ...visit, latitude, longitude }]
  }), [visits])
  const workdayMarkers = useMemo(() => {
    if (!workday) return []
    return [
      workday.startLatitude != null && workday.startLongitude != null
        ? { key: "start", label: t("workdayStart"), latitude: workday.startLatitude, longitude: workday.startLongitude, at: workday.startedAt }
        : null,
      workday.completedAt && workday.endLatitude != null && workday.endLongitude != null
        ? { key: "end", label: t("workdayEnd"), latitude: workday.endLatitude, longitude: workday.endLongitude, at: workday.completedAt }
        : null,
    ].filter(Boolean) as Array<{ key: string; label: string; latitude: number; longitude: number; at: string }>
  }, [t, workday])
  const gapSegments = useMemo(() => layers.gaps ? gaps.map((gap) => ({
      id: gap.id,
      startedAt: gap.startedAt,
      coordinates: [
        [gap.startLatitude, gap.startLongitude],
        [gap.endLatitude, gap.endLongitude],
      ] as L.LatLngTuple[],
    })).filter((gap) => new Date(gap.startedAt).getTime() <= playbackAt) : [], [gaps, layers.gaps, playbackAt])
  const visibleStops = useMemo(
    () => layers.stops ? stops.filter((stop) => new Date(stop.startedAt).getTime() <= playbackAt) : [],
    [layers.stops, playbackAt, stops],
  )
  const visibleVisits = useMemo(
    () => layers.visits ? visitMarkers.filter((visit) => new Date(visit.checkInAt).getTime() <= playbackAt) : [],
    [layers.visits, playbackAt, visitMarkers],
  )
  const visibleWorkdayMarkers = useMemo(
    () => workdayMarkers.filter((marker) => new Date(marker.at).getTime() <= playbackAt),
    [playbackAt, workdayMarkers],
  )
  const coordinates = useMemo(() => [
    ...fullActualPath,
    ...plannedPaths.flatMap((route) => route.coordinates),
    ...(layers.gaps ? gaps.flatMap((gap) => [[gap.startLatitude, gap.startLongitude] as L.LatLngTuple, [gap.endLatitude, gap.endLongitude] as L.LatLngTuple]) : []),
    ...(layers.stops ? stops.map((stop) => [stop.latitude, stop.longitude] as L.LatLngTuple) : []),
    ...(layers.visits ? visitMarkers.map((visit) => [visit.latitude, visit.longitude] as L.LatLngTuple) : []),
  ], [fullActualPath, gaps, layers.gaps, layers.stops, layers.visits, plannedPaths, stops, visitMarkers])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          const bounds = element.getBoundingClientRect()
          if (bounds.width > 100 && bounds.height > 100) setReady(true)
        })
    observer?.observe(element)
    const timer = setTimeout(() => setReady(true), 100)
    return () => {
      observer?.disconnect()
      clearTimeout(timer)
    }
  }, [])

  const center = coordinates[0] ?? ([40.4093, 49.8671] as L.LatLngTuple)
  const formatMoment = (value: string, options?: Intl.DateTimeFormatOptions) =>
    formatInTimezone(value, timezone, options ?? { dateStyle: "short", timeStyle: "short" }, locale)

  return (
    <div ref={containerRef} className="relative h-full min-h-[360px] w-full">
      {ready && (
        <MapContainer center={center} zoom={12} className="h-full w-full" scrollWheelZoom>
          <ResizeAndFit coordinates={coordinates} />
          <CartoVectorBasemap />
          {actualPath.length > 1 && (
            <Polyline positions={actualPath} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.78 }} />
          )}
          {plannedPaths.map((route) => route.coordinates.length > 1 && (
            <Polyline key={`plan-${route.id}`} positions={route.coordinates} pathOptions={{ color: "#7c3aed", weight: 3, opacity: 0.72, dashArray: "8 6" }} />
          ))}
          {gapSegments.map((gap) => (
            <Polyline key={gap.id} positions={gap.coordinates} pathOptions={{ color: "#dc2626", weight: 4, opacity: 0.9, dashArray: "3 6" }} />
          ))}
          {layers.planned && plannedRoutes.flatMap((route) => route.points).map((point) =>
            point.customer.latitude != null && point.customer.longitude != null ? (
              <CircleMarker
                key={`planned-${point.id}`}
                center={[point.customer.latitude, point.customer.longitude]}
                radius={7}
                pathOptions={{ color: "#6d28d9", fillColor: "#8b5cf6", fillOpacity: 0.75, weight: 2 }}
              >
                <Popup><strong>{point.orderIndex + 1}. {point.label}</strong><div>{t(`pointStatus.${point.status}`)}</div>{point.plannedTime && <div>{formatMoment(point.plannedTime)}</div>}</Popup>
              </CircleMarker>
            ) : null
          )}
          {layers.actual && visiblePoints.map((point, index) => {
            const isActive = point.id === activePoint?.id
            return (
            <CircleMarker
              key={point.id}
              center={[point.latitude, point.longitude]}
              radius={isActive ? 8 : index === 0 ? 5 : 2}
              pathOptions={isActive
                ? { color: "#9a3412", fillColor: "#fb923c", fillOpacity: 0.95, weight: 3 }
                : { color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.75, weight: 1 }}
            >
              <Popup>
                <div className="space-y-1 text-xs">
                  <strong>{formatMoment(point.recordedAt)}</strong>
                  <div>{t("accuracy")}: {point.accuracy == null ? "—" : `${Math.round(point.accuracy)} m`}</div>
                  <div>{t("battery")}: {point.battery == null ? "—" : `${Math.round(point.battery)}%`}</div>
                </div>
              </Popup>
            </CircleMarker>
            )
          })}
          {visibleStops.map((stop) => (
            <CircleMarker
              key={stop.id}
              center={[stop.latitude, stop.longitude]}
              radius={9}
              pathOptions={{ color: "#b45309", fillColor: "#f59e0b", fillOpacity: 0.8, weight: 2 }}
            >
              <Popup>
                <div className="space-y-1 text-xs">
                  <strong>{stop.visit?.customerName ?? t("detectedStop")}</strong>
                  {stop.visit?.customerAddress && <div>{stop.visit.customerAddress}</div>}
                  <div>{formatMoment(stop.startedAt)} – {formatMoment(stop.endedAt, { timeStyle: "short" })}</div>
                  <div>{t("duration")}: {t("durationMinutes", { minutes: Math.round(stop.durationSeconds / 60) })}</div>
                  <div>{t("battery")}: {stop.batteryStart == null ? "—" : stop.batteryStart === stop.batteryEnd ? `${Math.round(stop.batteryStart)}%` : `${Math.round(stop.batteryStart)}–${Math.round(stop.batteryEnd ?? stop.batteryStart)}%`}</div>
                  <div>{stop.connectivity === "ONLINE" ? t("online") : t("offlineGaps")}</div>
                  <div>{t("visitFact")}: {stop.visit ? t("confirmed") : t("notConfirmed")}</div>
                </div>
              </Popup>
            </CircleMarker>
          ))}
          {visibleVisits.map((visit) => (
            <CircleMarker
              key={`visit-${visit.id}`}
              center={[visit.latitude, visit.longitude]}
              radius={7}
              pathOptions={{ color: "#047857", fillColor: "#10b981", fillOpacity: 0.8, weight: 2 }}
            >
              <Popup>
                <div className="space-y-1 text-xs">
                  <strong>{visit.customer.name}</strong>
                  <div>{t("confirmedVisit")}</div>
                  <div>{formatMoment(visit.checkInAt)}</div>
                </div>
              </Popup>
            </CircleMarker>
          ))}
          {visibleWorkdayMarkers.map((marker) => (
            <CircleMarker
              key={marker.key}
              center={[marker.latitude, marker.longitude]}
              radius={8}
              pathOptions={{ color: "#334155", fillColor: marker.key === "start" ? "#22c55e" : "#64748b", fillOpacity: 0.9, weight: 2 }}
            >
              <Popup><strong>{marker.label}</strong><div>{formatMoment(marker.at)}</div></Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      )}
    </div>
  )
}
