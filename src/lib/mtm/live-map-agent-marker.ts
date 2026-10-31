import type { MtmCoordinateFreshness } from "@/lib/mtm-types"
import { mtmAgentMapColorHex } from "@/lib/mtm/agent-tags"
import { HISTORY_MAP_COLORS } from "@/lib/mtm/history-path"
import type { MtmMovementMode } from "@/lib/mtm/movement-mode"

/**
 * An employee's marker on the live map, as the HTML the map is given.
 *
 * The marker itself says one thing — how fresh the GPS point is — and says it
 * three ways, so that nobody has to tell colours apart: the fill (green,
 * amber, slate), the shape (circle, leaf, square) and, for a position that is
 * no longer live, the opacity. None of the three belongs to the employee.
 *
 * The colour a manager gave him (owner, 2026-10-09, of the tracking product
 * shown as the model) is therefore a ring OUTSIDE the marker's white border:
 * «the pink one» is found at a glance, and the marker still says what it said.
 * A hairline of white closes the ring, because the map has a dark background
 * to choose and two of the eight colours are dark.
 *
 * It takes the KEY stored on the card and looks the hex up in the palette
 * itself. The marker is a string of HTML: text from the database must have no
 * way into it, so nothing here accepts a colour as text. A key this build does
 * not know draws no ring.
 *
 * Pure — no Leaflet, no React — so what is drawn can be read by a test.
 */
export interface LiveMapAgentMarker {
  html: string
  /** The marker's box in pixels; the ring is drawn outside it and moves nothing. */
  size: number
}

/**
 * The three ways of moving as white pictures for the inside of a marker
 * (owner, 2026-11-01, of the mockup: «иконка — пешком, на машине, стоит»).
 * Fixed strings: nothing from the database is drawn with them.
 */
export const MTM_MOVEMENT_ICON_SVG: Record<MtmMovementMode, string> = {
  DRIVE: '<path fill="currentColor" d="M3.5 16.2v-4.4l2-5A2.2 2.2 0 0 1 7.5 5.4h9a2.2 2.2 0 0 1 2 1.4l2 5v4.4a1 1 0 0 1-1 1h-.9a2.3 2.3 0 0 1-4.5 0H9.9a2.3 2.3 0 0 1-4.5 0h-.9a1 1 0 0 1-1-1zM6.3 11h11.4l-1.3-3.4H7.6z"/>',
  WALK: '<circle cx="13.5" cy="3.8" r="2.1" fill="currentColor"/><path d="M9.5 21.5l2.3-6.2 2.7 2.6v3.6M11.8 15.3l-.9-5.6-3.2 1.7-1 3.2M10.9 9.7l3.6 2.8 3.2.6" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  STAY: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor"/>',
}

/**
 * The colour of each way of moving — on the lines, the arrows and the
 * legend: the history map's own palette, so a drive is one blue everywhere.
 */
export const MTM_MOVEMENT_COLORS: Record<MtmMovementMode, string> = {
  DRIVE: HISTORY_MAP_COLORS.track,
  WALK: HISTORY_MAP_COLORS.walk,
  STAY: HISTORY_MAP_COLORS.raw,
}

export function liveMapAgentMarker(input: {
  name: string
  freshness: MtmCoordinateFreshness
  focused: boolean
  /** The palette key from the employee's card, as the server sent it. */
  mapColor?: string | null
  /**
   * How he is moving now and which way (src/lib/mtm/movement-mode.ts). The
   * picture of it takes the letter's place, and an arrow outside the marker
   * points the way he is going. Absent or null — the letter, as before.
   */
  movement?: { mode: MtmMovementMode; heading: number | null } | null
}): LiveMapAgentMarker {
  const { name, freshness, focused } = input
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
  const ringHex = mtmAgentMapColorHex(input.mapColor)
  const ring = ringHex ? `0 0 0 3px ${ringHex}, 0 0 0 4px rgba(255,255,255,0.9), ` : ""
  const movement = input.movement ?? null
  const iconSize = focused ? 22 : 18
  const inside = movement
    ? `<svg viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}" aria-hidden="true">${MTM_MOVEMENT_ICON_SVG[movement.mode]}</svg>`
    : initial
  const html = `<div style="
      width:${size}px;height:${size}px;border-radius:${radius};opacity:${opacity};
      background:${color};border:${border}px solid white;
      display:flex;align-items:center;justify-content:center;
      font:700 14px system-ui,sans-serif;color:white;
      box-shadow:${ring}0 2px 8px rgba(0,0,0,0.3);
      cursor:pointer;transition:transform 0.2s;
    ">${inside}</div>`
  const heading = movement && movement.mode !== "STAY" && typeof movement.heading === "number" && Number.isFinite(movement.heading)
    ? Math.round(((movement.heading % 360) + 360) % 360)
    : null
  if (heading == null) return { html, size }
  // The arrow: a box larger than the marker, centred on it and turned to the
  // course, with the arrow at its top edge — just outside the marker's ring.
  // It is the marker's own colour: it belongs to the marker, and says no more
  // about freshness than the marker does.
  const box = size + 38
  const half = box / 2
  const arrow = `<svg width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" aria-hidden="true" style="
      position:absolute;left:${(size - box) / 2}px;top:${(size - box) / 2}px;
      transform:rotate(${heading}deg);pointer-events:none;overflow:visible;
    "><path d="M ${half} 1 L ${half + 7} 12 L ${half - 7} 12 Z" fill="${color}" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>`
  return {
    html: `<div style="position:relative;width:${size}px;height:${size}px">${arrow}${html}</div>`,
    size,
  }
}

/** A step further than this is not a move to watch: the first fix after a silence, a jump across town. */
export const LIVE_MAP_GLIDE_MAX_METERS = 3_000

/**
 * Does the marker glide to its new place, or go straight there? It glides
 * only for a real, short move between two live positions that somebody is
 * watching. A grey last known point on either side is a jump: from the point
 * he left before a break to his first fix after it, a glide would draw the
 * way he went in between — the very thing his break keeps to himself (and,
 * after a phone gone quiet, a way nobody saw him go).
 */
export function liveMapMarkerGlides(input: {
  /** The dispatcher's «Плавное движение». */
  enabled: boolean
  /** The tab is hidden, or the viewer asked the system for less motion. */
  still: boolean
  meters: number
  fromLastKnown: boolean
  toLastKnown: boolean
}): boolean {
  return input.enabled && !input.still && !input.fromLastKnown && !input.toLastKnown &&
    input.meters >= 1 && input.meters <= LIVE_MAP_GLIDE_MAX_METERS
}
