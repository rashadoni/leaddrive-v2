import type { MtmCoordinateFreshness } from "@/lib/mtm-types"
import { mtmAgentMapColorHex } from "@/lib/mtm/agent-tags"

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

export function liveMapAgentMarker(input: {
  name: string
  freshness: MtmCoordinateFreshness
  focused: boolean
  /** The palette key from the employee's card, as the server sent it. */
  mapColor?: string | null
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
  return {
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:${radius};opacity:${opacity};
      background:${color};border:${border}px solid white;
      display:flex;align-items:center;justify-content:center;
      font:700 14px system-ui,sans-serif;color:white;
      box-shadow:${ring}0 2px 8px rgba(0,0,0,0.3);
      cursor:pointer;transition:transform 0.2s;
    ">${initial}</div>`,
    size,
  }
}
