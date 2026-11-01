"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { CircleMarker, MapContainer, Marker, Polyline, Popup, useMap } from "react-leaflet"
import { HISTORY_MAP_COLORS } from "@/lib/mtm/history-path"
import {
  historyReplayCuts,
  historyReplayFrame,
  modeRuns,
  readHistoryMovement,
  timeRoadTrack,
  type TimedVertex,
} from "@/lib/mtm/history-replay"
import { MovementArrows, movementLineStyle, replayMarkerIcon } from "./movement-arrows"
import L from "leaflet"
import { useTranslations } from "next-intl"
import { formatInTimezone } from "@/lib/timezone"
import { CartoBasemap } from "./carto-basemap"

type Point = {
  id: string
  latitude: number
  longitude: number
  accuracy: number | null
  battery: number | null
  recordedAt: string
  /** km/h as stored, and the phone's course: how he was moving is read from them. */
  speed?: number | null
  heading?: number | null
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
  /** Why the phone was silent: only a lost signal is drawn — a break is the employee's own time. */
  reason?: "TELEMETRY_GAP" | "WORKDAY_PAUSED"
  startLatitude: number
  startLongitude: number
  endLatitude: number
  endLongitude: number
}

type Focus = {
  from: string
  to: string
  latitude: number | null
  longitude: number | null
} | null

function ResizeAndFit({ coordinates, maxZoom }: { coordinates: L.LatLngTuple[]; maxZoom?: number }) {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize()
      if (coordinates.length === 1) map.setView(coordinates[0], maxZoom ?? 15)
      if (coordinates.length > 1) map.fitBounds(L.latLngBounds(coordinates), { padding: [36, 36], maxZoom })
    }, 50)
    return () => clearTimeout(timer)
  }, [coordinates, map, maxZoom])
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
  playbackAt: playbackAtInput = null,
  focus = null,
  matchedTrack = null,
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
    roads?: boolean
  }
  locale: string
  timezone: string
  playbackIndex: number
  /**
   * The moment of the day the replay holds, in ms. Given, the employee is
   * drawn where he was then — between two fixes too — and the line ends at
   * him; absent, the moment is the fix at `playbackIndex`.
   */
  playbackAt?: number | null
  /** A leg picked in the day's trip: its stretch of track is drawn on top and framed. */
  focus?: Focus
  /** The track along the streets from the self-hosted OSRM, when it answered. */
  matchedTrack?: { segments: Array<Array<[number, number]>> } | null
}) {
  const t = useTranslations("mtmMap.history")
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  // How he was moving at each fix — car, on foot, standing — and which way,
  // never joined across a break or a lost signal (src/lib/mtm/history-replay.ts).
  const cuts = useMemo(() => historyReplayCuts(points, gaps), [gaps, points])
  const reading = useMemo(() => readHistoryMovement(points, cuts), [cuts, points])
  const fallbackIndex = points.length ? Math.min(points.length - 1, Math.max(0, playbackIndex)) : 0
  const playbackAt = playbackAtInput ?? (points[fallbackIndex] ? Date.parse(points[fallbackIndex].recordedAt) : Number.POSITIVE_INFINITY)
  const frame = useMemo(
    () => historyReplayFrame(points, reading, cuts, playbackAt),
    [cuts, playbackAt, points, reading],
  )
  const visiblePointCount = frame ? frame.index + 1 : 0
  const visiblePoints = useMemo(
    () => layers.actual ? points.slice(0, visiblePointCount) : [],
    [layers.actual, points, visiblePointCount],
  )
  const fullActualPath = useMemo(
    () => layers.actual ? points.map((point) => [point.latitude, point.longitude] as L.LatLngTuple) : [],
    [layers.actual, points],
  )
  // The fixes as runs of the track, broken at every gap and break.
  const fixRuns = useMemo(() => {
    const runs: TimedVertex[][] = []
    let run: TimedVertex[] = []
    points.forEach((point, fixIndex) => {
      run.push({ latitude: point.latitude, longitude: point.longitude, fixIndex })
      if (cuts[fixIndex] || fixIndex === points.length - 1) {
        if (run.length > 1) runs.push(run)
        run = []
      }
    })
    return runs
  }, [cuts, points])
  // Up to the moment the replay holds, in pieces of one way of moving each.
  const actualRuns = useMemo(
    () => layers.actual ? fixRuns.flatMap((run) => modeRuns(run, reading.modes, frame)) : [],
    [fixRuns, frame, layers.actual, reading.modes],
  )
  // Owner 2026-09-27: the day along the streets, with the straight fixes kept
  // underneath, thin, for honesty. Owner 2026-11-01: it stays while the day
  // plays — each place of it belongs to a fix, so it is cut at the moment.
  const timedRoad = useMemo(
    () => matchedTrack ? timeRoadTrack(matchedTrack.segments, points) : [],
    [matchedTrack, points],
  )
  const roadRuns = useMemo(
    () => layers.actual && layers.roads !== false && matchedTrack
      ? timedRoad.flatMap((segment) => modeRuns(segment, reading.modes, frame))
      : [],
    [frame, layers.actual, layers.roads, matchedTrack, reading.modes, timedRoad],
  )
  const drawnRuns = roadRuns.length ? roadRuns : actualRuns
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
  // The red dotted «no points — path unknown» line joins the two ends of a
  // lost signal. A break is not one: drawn from where he paused to where he
  // resumed it would mislabel his own time as a signal loss and still say
  // which way he went. The track itself stays broken there (historyReplayCuts).
  const signalGaps = useMemo(() => gaps.filter((gap) => gap.reason !== "WORKDAY_PAUSED"), [gaps])
  const gapSegments = useMemo(() => layers.gaps ? signalGaps.map((gap) => ({
      id: gap.id,
      startedAt: gap.startedAt,
      coordinates: [
        [gap.startLatitude, gap.startLongitude],
        [gap.endLatitude, gap.endLongitude],
      ] as L.LatLngTuple[],
    })).filter((gap) => new Date(gap.startedAt).getTime() <= playbackAt) : [], [layers.gaps, playbackAt, signalGaps])
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
  const focusPath = useMemo(() => {
    if (!focus) return []
    const from = Date.parse(focus.from)
    const to = Date.parse(focus.to)
    return points
      .filter((point) => {
        const at = Date.parse(point.recordedAt)
        return at >= from && at <= to
      })
      .map((point) => [point.latitude, point.longitude] as L.LatLngTuple)
  }, [focus, points])
  const focusFrame = useMemo(() => {
    if (!focus) return null
    const place = focus.latitude != null && focus.longitude != null
      ? [[focus.latitude, focus.longitude] as L.LatLngTuple]
      : []
    const frame = [...focusPath, ...place]
    return frame.length ? frame : null
  }, [focus, focusPath])
  const coordinates = useMemo(() => [
    ...fullActualPath,
    ...plannedPaths.flatMap((route) => route.coordinates),
    ...(layers.gaps ? signalGaps.flatMap((gap) => [[gap.startLatitude, gap.startLongitude] as L.LatLngTuple, [gap.endLatitude, gap.endLongitude] as L.LatLngTuple]) : []),
    ...(layers.stops ? stops.map((stop) => [stop.latitude, stop.longitude] as L.LatLngTuple) : []),
    ...(layers.visits ? visitMarkers.map((visit) => [visit.latitude, visit.longitude] as L.LatLngTuple) : []),
  ], [fullActualPath, layers.gaps, layers.stops, layers.visits, plannedPaths, signalGaps, stops, visitMarkers])

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
          <ResizeAndFit coordinates={focusFrame ?? coordinates} maxZoom={focusFrame ? 16 : undefined} />
          <CartoBasemap />
          {actualRuns.map((run, index) => (
            <Polyline key={`actual-${index}`} positions={run.path} pathOptions={roadRuns.length
              ? { color: HISTORY_MAP_COLORS.raw, weight: 2, opacity: 0.7, dashArray: "2 6" }
              : movementLineStyle(run.mode, 0.9)} />
          ))}
          {roadRuns.map((run, index) => (
            <Polyline key={`road-${index}`} positions={run.path} pathOptions={movementLineStyle(run.mode, 0.9)} />
          ))}
          <MovementArrows keyPrefix="history" lines={drawnRuns} />
          {focusPath.length > 1 && (
            <Polyline positions={focusPath} pathOptions={{ color: HISTORY_MAP_COLORS.current, weight: 7, opacity: 0.95 }} />
          )}
          {focus && focus.latitude != null && focus.longitude != null && (
            <CircleMarker center={[focus.latitude, focus.longitude]} radius={14} pathOptions={{ color: HISTORY_MAP_COLORS.current, fillOpacity: 0.15, weight: 3 }} />
          )}
          {plannedPaths.map((route) => route.coordinates.length > 1 && (
            <Polyline key={`plan-${route.id}`} positions={route.coordinates} pathOptions={{ color: HISTORY_MAP_COLORS.plan, weight: 3, opacity: 0.72, dashArray: "8 6" }} />
          ))}
          {gapSegments.map((gap) => (
            <Polyline key={gap.id} positions={gap.coordinates} pathOptions={{ color: HISTORY_MAP_COLORS.gap, weight: 4, opacity: 0.9, dashArray: "3 6" }} />
          ))}
          {layers.planned && plannedRoutes.flatMap((route) => route.points).map((point) =>
            point.customer.latitude != null && point.customer.longitude != null ? (
              <CircleMarker
                key={`planned-${point.id}`}
                center={[point.customer.latitude, point.customer.longitude]}
                radius={7}
                pathOptions={{ color: "#6d28d9", fillColor: HISTORY_MAP_COLORS.plan, fillOpacity: 0.75, weight: 2 }}
              >
                <Popup><strong>{point.orderIndex + 1}. {point.label}</strong><div>{t(`pointStatus.${point.status}`)}</div>{point.plannedTime && <div>{formatMoment(point.plannedTime)}</div>}</Popup>
              </CircleMarker>
            ) : null
          )}
          {layers.actual && visiblePoints.map((point, index) => {
            return (
            <CircleMarker
              key={point.id}
              center={[point.latitude, point.longitude]}
              radius={index === 0 ? 5 : 2}
              pathOptions={{ color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.75, weight: 1 }}
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
              pathOptions={{ color: "#b45309", fillColor: HISTORY_MAP_COLORS.stop, fillOpacity: 0.8, weight: 2 }}
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
              pathOptions={{ color: "#047857", fillColor: HISTORY_MAP_COLORS.visit, fillOpacity: 0.8, weight: 2 }}
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
          {/* The employee at the moment the replay holds: how he is moving, and which way. */}
          {layers.actual && frame ? (
            <Marker
              position={[frame.latitude, frame.longitude]}
              icon={replayMarkerIcon(frame.mode, frame.heading, HISTORY_MAP_COLORS.current)}
              interactive={false}
              keyboard={false}
              zIndexOffset={1000}
            />
          ) : null}
        </MapContainer>
      )}
    </div>
  )
}
