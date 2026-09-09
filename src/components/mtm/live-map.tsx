"use client"

import "leaflet/dist/leaflet.css"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, useMap, useMapEvents } from "react-leaflet"
import L from "leaflet"
import { CartoVectorBasemap } from "./carto-vector-basemap"
import { formatDateTime, formatTime } from "@/lib/format-date"

// F-24: rewritten on Leaflet. Google Maps + AdvancedMarker had been the
// source of 5 hotfixes in a month — Vector tiles need a real Map ID, the React
// wrapper crashed on marker mount, and the API key needed a separate
// build-time pipeline. Leaflet keeps all MTM overlays on one renderer; CARTO's
// vector layer is supplied through carto-vector-basemap.tsx.

// ── Types ────────────────────────────────────────────────────────────────────

export interface RouteStop {
  orderIndex: number
  status: "VISITED" | "SKIPPED" | "NEXT" | "PENDING"
  latitude: number
  longitude: number
  name: string
  address?: string
  visitedAt?: string
}

// F-38: shared type. `AgentLocation` previously lived here too, conflicting
// with the dashboard-side declaration. Use the canonical `LiveMapAgent`
// from src/lib/mtm-types.ts.
import type {
  LiveMapAgent,
  LiveMapClusterMarker,
  LiveMapViewportBounds,
  MtmFieldStatus,
} from "@/lib/mtm-types"
import { clusterLiveMapViewportAgents, FIELD_STATUS_LABEL_KEYS } from "@/lib/mtm-types"

function isMtmFieldStatus(value: string): value is MtmFieldStatus {
  return value in FIELD_STATUS_LABEL_KEYS
}

interface Props {
  agents: LiveMapAgent[]
  replayTrack?: Array<{ latitude: number; longitude: number; recordedAt: string }>
  showGeofence?: boolean
  showHeatmap?: boolean
  geofenceRadius?: number
  plannedRoute?: RouteStop[]
  focusAgentId?: string | null
  etaSeconds?: number | null
  timeZone?: string
  showWorkdayStatus?: boolean
}

// ── Constants ────────────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  CHECKED_IN: "#22c55e",
  ON_ROAD: "#3b82f6",
  LATE: "#ef4444",
  OFFLINE: "#94a3b8",
}

// Field-status label keys come from the shared dictionary at
// src/lib/mtm-types.ts so map page + live map can't drift. Resolved
// through `tMap(\`fieldStatus.\${key}\`)` at render-time.
const statusLabelKeys = FIELD_STATUS_LABEL_KEYS

const routeStopColors: Record<string, string> = {
  VISITED: "#22c55e",
  SKIPPED: "#ef4444",
  NEXT: "#6C63FF",
  PENDING: "#94a3b8",
}

const BASE_MAP_TILE_ERROR_THRESHOLD = 3

// ── Icon factories (Leaflet uses HTML divIcon, no AdvancedMarker hassle) ─────

function agentIcon(name: string, freshness: LiveMapAgent["freshness"], focused: boolean) {
  const size = focused ? 38 : 32
  const border = focused ? 3.5 : 2.5
  const initial = (name?.charAt(0) || "?").toUpperCase()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
  const color = freshness === "ONLINE" ? "#15803d" : freshness === "DELAYED" ? "#b45309" : "#64748b"
  const radius = freshness === "ONLINE" ? "50%" : freshness === "DELAYED" ? "30% 70% 30% 70%" : "6px"
  const opacity = freshness === "STALE" ? 0.72 : 1
  return L.divIcon({
    className: "mtm-agent-marker",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:${radius};opacity:${opacity};
      background:${color};border:${border}px solid white;
      display:flex;align-items:center;justify-content:center;
      font:700 14px system-ui,sans-serif;color:white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      cursor:pointer;transition:transform 0.2s;
    ">${initial}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function clusterIcon(marker: LiveMapClusterMarker) {
  const { ONLINE: online, DELAYED: delayed, STALE: stale } = marker.freshnessCounts
  const color = stale > 0 ? "#64748b" : delayed > 0 ? "#b45309" : "#15803d"
  const radius = stale > 0 ? "8px" : delayed > 0 ? "34% 66% 34% 66%" : "50%"
  const count = marker.agents.length > 99 ? "99+" : marker.agents.length
  const dots = [
    online > 0 ? `<i style="background:#22c55e" title="${online}"></i>` : "",
    delayed > 0 ? `<i style="background:#f59e0b" title="${delayed}"></i>` : "",
    stale > 0 ? `<i style="background:#94a3b8" title="${stale}"></i>` : "",
  ].join("")
  return L.divIcon({
    className: "mtm-agent-cluster-marker",
    html: `<div style="
      width:42px;height:42px;border-radius:${radius};background:${color};
      border:3px solid rgba(255,255,255,0.96);color:white;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      box-shadow:0 3px 10px rgba(15,23,42,0.3);cursor:zoom-in;
      font:800 13px system-ui,sans-serif;line-height:1;
    "><span>${count}</span><span style="display:flex;gap:2px;margin-top:4px">${dots}</span></div>
    <style>.mtm-agent-cluster-marker i{display:block;width:5px;height:5px;border-radius:50%;border:1px solid rgba(255,255,255,.85)}</style>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  })
}

function routeStopIcon(orderIndex: number, status: string) {
  const color = routeStopColors[status] || routeStopColors.PENDING
  const opacity = status === "VISITED" ? 0.5 : 1
  return L.divIcon({
    className: "mtm-route-stop-marker",
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      background:${color};border:2px solid white;opacity:${opacity};
      display:flex;align-items:center;justify-content:center;
      font:700 10px system-ui,sans-serif;color:white;
      box-shadow:0 1px 4px rgba(0,0,0,0.25);
    ">${orderIndex + 1}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

// ── Sub-components ───────────────────────────────────────────────────────────

function InvalidateSize() {
  const map = useMap()
  useEffect(() => {
    // Match route-map.tsx pattern — Leaflet measures tile size at mount and
    // again if the container resizes (e.g. sidebar collapse / layout flip).
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

function FitBounds({ agents, plannedRoute }: { agents: LiveMapAgent[]; plannedRoute: RouteStop[] }) {
  const map = useMap()
  const lastFitRef = useRef("")
  useEffect(() => {
    const points: L.LatLngTuple[] = [
      ...agents.map((a) => [a.latitude, a.longitude] as L.LatLngTuple),
      ...plannedRoute.map((s) => [s.latitude, s.longitude] as L.LatLngTuple),
    ].filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
    if (points.length < 2) return
    // Avoid re-fitting on every render when set of coords didn't change
    const sig = points.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join("|")
    if (sig === lastFitRef.current) return
    lastFitRef.current = sig
    map.fitBounds(L.latLngBounds(points), { padding: [60, 60] })
  }, [map, agents, plannedRoute])
  return null
}

function FocusAgent({ agents, focusAgentId }: { agents: LiveMapAgent[]; focusAgentId: string | null }) {
  const map = useMap()
  useEffect(() => {
    if (!focusAgentId) return
    const agent = agents.find((a) => a.agentId === focusAgentId)
    if (agent) map.flyTo([agent.latitude, agent.longitude], 15, { duration: 0.5 })
  }, [map, focusAgentId, agents])
  return null
}

function normalizeLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180
}

function ViewportReporter({ onChange }: { onChange: (viewport: LiveMapViewportBounds, zoom: number) => void }) {
  const report = useCallback((map: L.Map) => {
    const padded = map.getBounds().pad(0.15)
    const rawWest = padded.getWest()
    const rawEast = padded.getEast()
    onChange({
      north: Math.min(90, padded.getNorth()),
      south: Math.max(-90, padded.getSouth()),
      west: rawEast - rawWest >= 360 ? -180 : normalizeLongitude(rawWest),
      east: rawEast - rawWest >= 360 ? 180 : normalizeLongitude(rawEast),
    }, map.getZoom())
  }, [onChange])
  const map = useMap()
  useMapEvents({
    moveend: () => report(map),
    zoomend: () => report(map),
  })
  useEffect(() => report(map), [map, report])
  return null
}

function ClusterMarker({ marker, title }: { marker: LiveMapClusterMarker; title: string }) {
  const map = useMap()
  return (
    <Marker
      position={[marker.latitude, marker.longitude]}
      icon={clusterIcon(marker)}
      zIndexOffset={400}
      title={title}
      alt={title}
      eventHandlers={{
        click: () => map.flyTo(
          [marker.latitude, marker.longitude],
          Math.min(18, map.getZoom() + 2),
          { duration: 0.35 },
        ),
      }}
    />
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function MtmLiveMap({
  agents,
  replayTrack = [],
  showGeofence = false,
  showHeatmap = false,
  geofenceRadius = 100,
  plannedRoute = [],
  focusAgentId = null,
  etaSeconds = null,
  timeZone,
  showWorkdayStatus = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const baseMapTileErrorCountRef = useRef(0)
  const baseMapTileSuccessCountRef = useRef(0)
  const baseMapUnavailableRef = useRef(false)
  const baseMapFailureTimerRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [baseMapRevision, setBaseMapRevision] = useState(0)
  const [baseMapUnavailable, setBaseMapUnavailable] = useState(false)
  const [viewport, setViewport] = useState<LiveMapViewportBounds | null>(null)
  const [zoom, setZoom] = useState(12)
  const locale = useLocale()
  const tMap = useTranslations("mtmMap")

  const handleViewportChange = useCallback((next: LiveMapViewportBounds, nextZoom: number) => {
    setViewport((current) => current &&
      current.north === next.north && current.south === next.south &&
      current.east === next.east && current.west === next.west
      ? current
      : next)
    setZoom((current) => current === nextZoom ? current : nextZoom)
  }, [])

  const handleBaseMapTileError = useCallback(() => {
    if (baseMapUnavailableRef.current) return
    baseMapTileErrorCountRef.current += 1
    if (baseMapTileErrorCountRef.current < BASE_MAP_TILE_ERROR_THRESHOLD ||
        baseMapTileSuccessCountRef.current > 0) return
    if (baseMapFailureTimerRef.current != null) window.clearTimeout(baseMapFailureTimerRef.current)
    // Give successful tiles from the same viewport a chance to arrive before
    // declaring the background unavailable. Employee GPS is independent.
    baseMapFailureTimerRef.current = window.setTimeout(() => {
      baseMapFailureTimerRef.current = null
      if (baseMapTileSuccessCountRef.current > 0 ||
          baseMapTileErrorCountRef.current < BASE_MAP_TILE_ERROR_THRESHOLD) return
      baseMapUnavailableRef.current = true
      setBaseMapUnavailable(true)
    }, 500)
  }, [])

  const handleBaseMapTileSuccess = useCallback(() => {
    baseMapTileSuccessCountRef.current += 1
    if (baseMapFailureTimerRef.current != null) {
      window.clearTimeout(baseMapFailureTimerRef.current)
      baseMapFailureTimerRef.current = null
    }
    baseMapTileErrorCountRef.current = 0
    if (baseMapUnavailableRef.current) {
      baseMapUnavailableRef.current = false
      setBaseMapUnavailable(false)
    }
  }, [])

  const handleBaseMapLoading = useCallback(() => {
    if (baseMapFailureTimerRef.current != null) {
      window.clearTimeout(baseMapFailureTimerRef.current)
      baseMapFailureTimerRef.current = null
    }
    baseMapTileErrorCountRef.current = 0
    baseMapTileSuccessCountRef.current = 0
  }, [])

  const resetBaseMapAttempt = useCallback(() => {
    if (baseMapFailureTimerRef.current != null) {
      window.clearTimeout(baseMapFailureTimerRef.current)
      baseMapFailureTimerRef.current = null
    }
    baseMapTileErrorCountRef.current = 0
    baseMapTileSuccessCountRef.current = 0
    baseMapUnavailableRef.current = false
    setBaseMapUnavailable(false)
  }, [])

  const retryBaseMap = useCallback(() => {
    resetBaseMapAttempt()
    setBaseMapRevision((current) => current + 1)
  }, [resetBaseMapAttempt])

  useEffect(() => () => {
    if (baseMapFailureTimerRef.current != null) window.clearTimeout(baseMapFailureTimerRef.current)
  }, [])

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
    return () => {
      observer?.disconnect()
      clearTimeout(fallback)
    }
  }, [])

  const defaultCenter: L.LatLngTuple = useMemo(() => {
    if (agents.length > 0 && Number.isFinite(agents[0].latitude) && Number.isFinite(agents[0].longitude)) {
      return [agents[0].latitude, agents[0].longitude]
    }
    if (plannedRoute.length > 0) {
      return [plannedRoute[0].latitude, plannedRoute[0].longitude]
    }
    return [40.4093, 49.8671] // Baku default
  }, [agents, plannedRoute])

  const routePath: L.LatLngTuple[] = useMemo(
    () =>
      plannedRoute
        .filter((s) => s.status === "NEXT" || s.status === "PENDING")
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((s) => [s.latitude, s.longitude] as L.LatLngTuple),
    [plannedRoute]
  )

  const replayPath: L.LatLngTuple[] = useMemo(
    () => replayTrack.map((p) => [p.latitude, p.longitude] as L.LatLngTuple),
    [replayTrack]
  )

  const markerSelection = useMemo(
    () => clusterLiveMapViewportAgents(agents, viewport, zoom, focusAgentId),
    [agents, focusAgentId, viewport, zoom],
  )
  // Reuse the capped, viewport-aware clustering selection so the density layer
  // never mounts hundreds of extra Leaflet nodes on phones or tablets.
  const heatPoints = useMemo(
    () => markerSelection.markers.map((marker) => ({
      id: marker.id,
      latitude: marker.latitude,
      longitude: marker.longitude,
      count: marker.kind === "CLUSTER" ? marker.agents.length : 1,
    })),
    [markerSelection.markers],
  )
  const renderedAgents = markerSelection.markers.flatMap((marker) => marker.kind === "AGENT" ? [marker.agent] : [])
  const renderedAgentIds = markerSelection.markers.flatMap((marker) => (
    marker.kind === "AGENT" ? [marker.agent.agentId] : marker.agents.map((agent) => agent.agentId)
  ))

  return (
    <div
      ref={containerRef}
      data-testid="mtm-live-map-canvas"
      data-ready={ready}
      data-rendered-agent-ids={renderedAgentIds.join(",")}
      data-heatmap-point-count={showHeatmap ? heatPoints.length : 0}
      style={{ position: "absolute", inset: 0 }}
    >
      {ready ? (
        <MapContainer
          center={defaultCenter}
          zoom={12}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          <InvalidateSize />
          <FitBounds agents={agents} plannedRoute={plannedRoute} />
          <FocusAgent agents={agents} focusAgentId={focusAgentId} />
          <ViewportReporter onChange={handleViewportChange} />

          <CartoVectorBasemap
            key={`carto-${baseMapRevision}`}
            onLoading={handleBaseMapLoading}
            onError={handleBaseMapTileError}
            onLoad={handleBaseMapTileSuccess}
          />

          {/* Visual density from actual current coordinates; never captures map input. */}
          {showHeatmap && heatPoints.map((point) => (
            <CircleMarker
              key={`heat-${point.id}`}
              center={[point.latitude, point.longitude]}
              radius={Math.min(42, 24 + Math.sqrt(point.count) * 3)}
              interactive={false}
              bubblingMouseEvents={false}
              pathOptions={{
                stroke: false,
                fillColor: "#f97316",
                fillOpacity: 0.16,
              }}
            />
          ))}

          {/* Planned-route corridor (dashed) */}
          {routePath.length >= 2 && (
            <Polyline positions={routePath} pathOptions={{ color: "#6C63FF", weight: 2, opacity: 0.5, dashArray: "6 4" }} />
          )}

          {/* Replay trail (solid amber) */}
          {replayPath.length >= 2 && (
            <Polyline positions={replayPath} pathOptions={{ color: "#f59e0b", weight: 3, opacity: 0.85 }} />
          )}

          {/* Geofence rings around each agent */}
          {showGeofence &&
            renderedAgents.map((a) => (
              <Circle
                key={`geo-${a.agentId}`}
                center={[a.latitude, a.longitude]}
                radius={geofenceRadius}
                pathOptions={{
                  color: statusColors[a.fieldStatus || "OFFLINE"] ?? statusColors.OFFLINE,
                  weight: 1.5,
                  opacity: 0.6,
                  fillColor: statusColors[a.fieldStatus || "OFFLINE"] ?? statusColors.OFFLINE,
                  fillOpacity: 0.08,
                }}
              />
            ))}

          {/* Route stop markers */}
          {plannedRoute.map((stop) => (
            <Marker
              key={`stop-${stop.orderIndex}`}
              position={[stop.latitude, stop.longitude]}
              icon={routeStopIcon(stop.orderIndex, stop.status)}
              zIndexOffset={100}
              title={stop.name}
              alt={stop.name}
            >
              <Popup>
                <div style={{ fontFamily: "system-ui,sans-serif", minWidth: 140 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    #{stop.orderIndex + 1} {stop.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {tMap("routeStopStatus.label")}: {tMap(`routeStopStatus.${stop.status.toLowerCase()}`)}
                    {stop.visitedAt && <> · {formatTime(new Date(stop.visitedAt), locale, timeZone ? { timeZone } : undefined)}</>}
                  </div>
                  {stop.address && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{stop.address}</div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Agent markers */}
          {markerSelection.markers.map((marker) => {
            if (marker.kind === "CLUSTER") {
              return (
                <ClusterMarker
                  key={marker.id}
                  marker={marker}
                  title={`${tMap("clusterLabel", { count: marker.agents.length })}. ${tMap("clusterFreshness", {
                    online: marker.freshnessCounts.ONLINE,
                    delayed: marker.freshnessCounts.DELAYED,
                    stale: marker.freshnessCounts.STALE,
                  })}. ${tMap("clusterZoomHint")}`}
                />
              )
            }
            const agent = marker.agent
            const status = agent.fieldStatus || (agent.isOnline ? "ON_ROAD" : "OFFLINE")
            const statusKey: MtmFieldStatus = isMtmFieldStatus(status) ? status : "OFFLINE"
            const isFocused = agent.agentId === focusAgentId
            return (
              <Marker
                key={marker.id}
                position={[agent.latitude, agent.longitude]}
                icon={agentIcon(agent.name, agent.freshness, isFocused)}
                zIndexOffset={isFocused ? 1000 : 500}
                title={agent.name}
                alt={agent.name}
              >
                <Popup>
                  <div style={{ fontFamily: "system-ui,sans-serif", minWidth: 170 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "#0B0B1E" }}>
                      {agent.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>
                      {tMap(`fieldStatus.${statusLabelKeys[statusKey]}`)}
                      {agent.speed && agent.speed > 0 ? ` · ${agent.speed.toFixed(1)} km/h` : ""}
                      {agent.battery != null ? ` · 🔋${agent.battery}%` : ""}
                    </div>
                    <div style={{ fontSize: 12, color: agent.freshness === "STALE" ? "#64748b" : "#334155", fontWeight: 600, marginBottom: 2 }}>
                      {tMap(`freshness.${agent.freshness.toLowerCase()}`)}
                      {showWorkdayStatus ? ` · ${tMap(`workday.${agent.workdayState.toLowerCase()}`)}` : ""}
                    </div>
                    {etaSeconds != null && isFocused && (
                      <div style={{ fontSize: 12, color: "#6C63FF", fontWeight: 600, marginBottom: 2 }}>
                        {tMap("eta.label")}: {etaSeconds < 60
                          ? tMap("eta.seconds", { count: etaSeconds })
                          : tMap("eta.minutes", { count: Math.round(etaSeconds / 60) })}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {tMap("recordedAt")}: {formatDateTime(new Date(agent.recordedAt), locale, timeZone ? { timeZone } : undefined)}
                      {agent.accuracy != null ? ` · ±${Math.round(agent.accuracy)} m` : ""}
                      {agent.battery != null ? ` · ${tMap("battery")}: ${Math.round(agent.battery)}%` : ""}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      ) : (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            fontSize: 14,
          }}
        >
          {tMap("loadingMap")}
        </div>
      )}
      {ready && baseMapUnavailable ? (
        <div
          data-testid="mtm-live-map-background-error"
          className="absolute left-3 right-3 top-3 z-[1000] rounded-xl border border-amber-300 bg-background/95 p-3 shadow-lg backdrop-blur-sm sm:left-1/2 sm:right-auto sm:w-[min(520px,calc(100%-24px))] sm:-translate-x-1/2"
          role="alert"
        >
          <div className="text-sm font-semibold text-foreground">
            {tMap("mapBackgroundUnavailable")}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {tMap("mapBackgroundUnavailableHint")}
          </div>
          <button
            type="button"
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-lg border border-amber-400 bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:hover:bg-amber-950/30"
            onClick={retryBaseMap}
          >
            {tMap("retryMapBackground")}
          </button>
        </div>
      ) : null}
      {ready && markerSelection.truncated ? (
        <div
          className="pointer-events-none absolute bottom-7 left-3 z-[500] max-w-[min(320px,calc(100%-24px))] rounded-md border border-zinc-300 bg-background/95 px-2.5 py-1.5 text-[11px] font-medium text-foreground shadow-sm dark:border-zinc-700"
          role="status"
        >
          {tMap("markerWindowLimited", {
            shown: markerSelection.representedCount,
            total: markerSelection.eligibleCount,
          })}
        </div>
      ) : null}
    </div>
  )
}
