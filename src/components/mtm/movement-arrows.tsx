"use client"

/**
 * Arrows along a line, the way the employee went (owner, 2026-11-01, of the
 * mockup: «стрелки по направлению на линии»). One every ~90 px of screen
 * whatever the zoom — a whole day zoomed out is not a smear of arrows, a
 * street zoomed in still has them. Drawn as small markers that take no
 * presses: the line under them keeps its own.
 */
import { useMemo, useState } from "react"
import { Marker, useMap, useMapEvents } from "react-leaflet"
import L from "leaflet"

import { MTM_MOVEMENT_COLORS, MTM_MOVEMENT_ICON_SVG, MTM_MOVEMENT_MARKER_COLORS, MTM_STILL_COLOR, MTM_STILL_ICON_SVG } from "@/lib/mtm/live-map-agent-marker"
import { arrowsAlong, metresPerPixel, type MtmMovementMode } from "@/lib/mtm/movement-mode"

const ARROW_EVERY_PX = 90
/** A whole city's day at a glance never needs more than this many. */
const MAX_ARROWS = 400

const iconCache = new Map<string, L.DivIcon>()

/** A car's line is solid, so its arrow is white on it; a walk's is dotted, so its arrow is the walk's colour. */
function arrowIcon(mode: MtmMovementMode, bearing: number): L.DivIcon {
  const turn = Math.round(bearing / 5) * 5
  const key = `${mode}:${turn}`
  const cached = iconCache.get(key)
  if (cached) return cached
  const shape = mode === "DRIVE"
    ? `<path d="M -3.5 -4 L 2 0 L -3.5 4" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M -4 -5 L 4 0 L -4 5 Z" fill="${MTM_MOVEMENT_COLORS[mode]}" stroke="#ffffff" stroke-width="1" stroke-linejoin="round"/>`
  // The chevrons are drawn pointing east (90°); the line's bearing is from north.
  const icon = L.divIcon({
    className: "mtm-movement-arrow",
    html: `<svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true" style="display:block;transform:rotate(${turn - 90}deg);overflow:visible">${shape}</svg>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
  iconCache.set(key, icon)
  return icon
}

export interface MovementArrowLine {
  mode: MtmMovementMode
  path: ReadonlyArray<readonly [number, number]>
}

export function MovementArrows({ lines, keyPrefix }: { lines: readonly MovementArrowLine[]; keyPrefix: string }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const arrows = useMemo(() => {
    const placed: Array<{ key: string; latitude: number; longitude: number; mode: MtmMovementMode; bearing: number }> = []
    for (const [lineIndex, line] of lines.entries()) {
      // Standing is GPS jitter around one place: no direction to show.
      if (line.mode === "STAY" || line.path.length < 2) continue
      const every = ARROW_EVERY_PX * metresPerPixel(zoom, line.path[0][0])
      for (const [index, arrow] of arrowsAlong(line.path, every).entries()) {
        placed.push({ key: `${keyPrefix}-${lineIndex}-${index}`, ...arrow, mode: line.mode })
      }
    }
    return placed.length > MAX_ARROWS ? placed.filter((_, index) => index % Math.ceil(placed.length / MAX_ARROWS) === 0) : placed
  }, [keyPrefix, lines, zoom])
  return (
    <>
      {arrows.map((arrow) => (
        <Marker
          key={arrow.key}
          position={[arrow.latitude, arrow.longitude]}
          icon={arrowIcon(arrow.mode, arrow.bearing)}
          interactive={false}
          keyboard={false}
          zIndexOffset={-500}
        />
      ))}
    </>
  )
}

/** How a way of moving is drawn as a line: a car solid and strong, a walk dotted, standing thin and grey. */
export function movementLineStyle(mode: MtmMovementMode, emphasis = 1): L.PathOptions {
  if (mode === "DRIVE") return { color: MTM_MOVEMENT_COLORS.DRIVE, weight: 5 * emphasis, opacity: 0.85, lineCap: "round", lineJoin: "round" }
  if (mode === "WALK") return { color: MTM_MOVEMENT_COLORS.WALK, weight: 4 * emphasis, opacity: 0.9, dashArray: "1 8", lineCap: "round", lineJoin: "round" }
  return { color: MTM_MOVEMENT_COLORS.STAY, weight: 3, opacity: 0.7, lineCap: "round", lineJoin: "round" }
}

/**
 * The employee in the replay: a circle in the colour of the way he is moving
 * with its picture inside, an arrow outside it the way he is heading, and the
 * orange halo the legend calls «текущая позиция». On a break or out of signal
 * it is slate, with a pause or a crossed-out signal and no arrow.
 */
export function replayMarkerIcon(mode: MtmMovementMode | "BREAK" | "GAP", heading: number | null, haloColor: string): L.DivIcon {
  const still = mode === "BREAK" || mode === "GAP"
  // Standing is amber, as the mockup and the live map's markers have it.
  const fill = still ? MTM_STILL_COLOR : MTM_MOVEMENT_MARKER_COLORS[mode]
  const picture = still ? MTM_STILL_ICON_SVG[mode] : MTM_MOVEMENT_ICON_SVG[mode]
  const size = 30
  const box = size + 38
  const half = box / 2
  const arrow = !still && mode !== "STAY" && heading != null && Number.isFinite(heading)
    ? `<svg width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" aria-hidden="true" style="position:absolute;left:${(size - box) / 2}px;top:${(size - box) / 2}px;transform:rotate(${Math.round(heading)}deg);overflow:visible"><path d="M ${half} 1 L ${half + 7} 12 L ${half - 7} 12 Z" fill="${fill}" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>`
    : ""
  return L.divIcon({
    className: "mtm-replay-marker",
    html: `<div style="position:relative;width:${size}px;height:${size}px">${arrow}<div style="
      width:${size}px;height:${size}px;border-radius:50%;background:${fill};border:3px solid white;box-sizing:border-box;
      display:flex;align-items:center;justify-content:center;color:white;
      box-shadow:0 0 0 4px ${haloColor}66, 0 2px 8px rgba(0,0,0,0.35);
    "><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${picture}</svg></div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}
