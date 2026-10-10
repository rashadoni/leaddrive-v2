/**
 * «Свои зоны» on the live map: named areas a manager draws by hand.
 *
 * Owner, 2026-10-09, of the tracking product shown to him as the model: «бери
 * почти всё, чего у нас нет». There a dispatcher outlines a district, a
 * delivery area, «центр», gives it a name, and it stays on the map for
 * everybody. Here the only areas on the map were the clients' own check-in
 * circles (the «Зоны клиентов» layer) — those belong to a client's card and
 * are not these.
 *
 * A zone is a drawing: a circle (centre and radius) or one closed outline.
 * Nothing works out whether an employee is inside one.
 *
 * Three orders of the same two numbers meet on this page, and one swapped
 * conversion draws a zone in the wrong hemisphere with every other check
 * green. So the conversions live here and nowhere else:
 *
 *   - stored and sent: GeoJSON, a ring of [longitude, latitude] pairs that
 *     ends on the pair it began with;
 *   - on the page: the outline as its corners, { latitude, longitude }, each
 *     once — what the ruler holds, and what the area and the «crosses itself»
 *     check of live-map-trails.ts take.
 *
 * Pure: no React, no Leaflet, no Prisma. The API's validation and the page
 * share it, so they cannot disagree about what a zone is.
 */
import { isMtmAgentMapColorKey, mtmAgentMapColorHex, type MtmAgentMapColorKey } from "@/lib/mtm/agent-tags"
import { outlineCrossesItself, polygonAreaSquareMeters } from "@/lib/mtm/live-map-trails"

/**
 * Zones one organization may keep. The list is answered whole — the map
 * draws all of it — so it has to have an end; the server refuses the next one.
 */
export const LIVE_MAP_ZONE_LIMIT = 500
export const LIVE_MAP_ZONE_NAME_MAX_LENGTH = 120
/** The same lower bound as a client's check-in radius; the upper one is a region, not a country. */
export const LIVE_MAP_ZONE_MIN_RADIUS_METERS = 25
export const LIVE_MAP_ZONE_MAX_RADIUS_METERS = 100_000
/** Corners of an outline. Fewer than three enclose nothing; two hundred trace a district by hand. */
export const LIVE_MAP_ZONE_MIN_CORNERS = 3
export const LIVE_MAP_ZONE_MAX_CORNERS = 200
/**
 * The least an outline has to enclose. Not a size anybody draws to: under a
 * square metre is what three corners on one line come to, and what the list
 * and the balloon would then print as «0 м²» beside a zone that is a bare line.
 */
export const LIVE_MAP_ZONE_MIN_AREA_SQUARE_METERS = 1
/** What «Зона вокруг точки» offers before anything is typed: a few streets around the point. */
export const LIVE_MAP_ZONE_DEFAULT_RADIUS_METERS = 500
/**
 * The colour of a zone nobody chose a colour for. None of the eight a manager
 * can choose, and none of what the map already says in colour: how fresh a
 * marker's GPS is (green, amber, slate), a trail (blue), a day's route
 * (violet), the picked point (rose), the clients' own check-in circles (grey).
 */
export const LIVE_MAP_ZONE_DEFAULT_HEX = "#9a3412"

export interface LiveMapZonePoint {
  latitude: number
  longitude: number
}

/** One pair of a stored ring: [longitude, latitude], GeoJSON's order. */
export type LiveMapZoneRingPair = [number, number]

/**
 * A zone's outline as it is stored and sent: a GeoJSON Polygon with one
 * closed ring. A type and not an interface on purpose: it is written into a
 * Json column, and only a type literal is accepted there as a JSON value.
 */
export type LiveMapZonePolygon = {
  type: "Polygon"
  coordinates: LiveMapZoneRingPair[][]
}

/** A shape as the page holds it. `outline` is open: every corner once. */
export type LiveMapZoneShape =
  | { kind: "CIRCLE"; center: LiveMapZonePoint; radiusMeters: number }
  | { kind: "POLYGON"; outline: readonly LiveMapZonePoint[] }

export type LiveMapZone = LiveMapZoneShape & {
  id: string
  name: string
  /** A key of the employees' palette (agent-tags.ts); null — no colour chosen. */
  color: MtmAgentMapColorKey | null
}

/**
 * What can be done to a zone that is already on the map. Its shape is not
 * among them: a district outlined wrongly is removed and outlined again.
 */
export type LiveMapZoneChange =
  | { kind: "rename"; name: string }
  | { kind: "color"; color: MtmAgentMapColorKey | null }
  | { kind: "delete" }

/** The shape's part of a create or update request — the columns of the table. */
export type LiveMapZoneShapeBody =
  | { kind: "CIRCLE"; centerLatitude: number; centerLongitude: number; radiusMeters: number }
  | { kind: "POLYGON"; polygon: LiveMapZonePolygon }

function isLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90
}

function isLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180
}

// The two lines where the order of the numbers changes.
function pointOfPair(pair: readonly [number, number]): LiveMapZonePoint {
  return { latitude: pair[1], longitude: pair[0] }
}
function pairOfPoint(point: LiveMapZonePoint): LiveMapZoneRingPair {
  return [point.longitude, point.latitude]
}

function samePair(left: readonly [number, number], right: readonly [number, number]): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

/** The page's outline as a stored ring: [longitude, latitude] pairs, closed back to the first. */
export function liveMapZoneRing(outline: readonly LiveMapZonePoint[]): LiveMapZoneRingPair[] {
  if (outline.length === 0) return []
  return [...outline.map(pairOfPoint), pairOfPoint(outline[0])]
}

/**
 * A stored ring as the page's outline, or null when it is not a ring: not a
 * list of [longitude, latitude] pairs inside the globe, not closed, or too
 * short to enclose anything. The closing pair is dropped.
 */
export function liveMapZoneOutline(ring: unknown): LiveMapZonePoint[] | null {
  if (!Array.isArray(ring) || ring.length < LIVE_MAP_ZONE_MIN_CORNERS + 1) return null
  const pairs: LiveMapZoneRingPair[] = []
  for (const pair of ring as unknown[]) {
    if (!Array.isArray(pair) || pair.length !== 2 || !isLongitude(pair[0]) || !isLatitude(pair[1])) return null
    pairs.push([pair[0], pair[1]])
  }
  if (!samePair(pairs[0], pairs[pairs.length - 1])) return null
  return pairs.slice(0, -1).map(pointOfPair)
}

/**
 * Why a ring is refused as a zone, or null for one that can be kept:
 *
 *   - "size" — fewer corners than enclose anything, or more than a hand draws;
 *   - "open" — it does not end on the pair it began with;
 *   - "corners" — a closed ring of the right length around nothing: the same
 *     spot pressed three times, corners that all stand on one line, a line
 *     that goes out and comes back along itself (A-B-A-C-A);
 *   - "crossing" — a figure of eight. It has no one inside and no one area
 *     (see outlineCrossesItself), so it is not a zone.
 */
export type LiveMapZoneRingProblem = "size" | "open" | "corners" | "crossing"

export function liveMapZoneRingProblem(ring: readonly (readonly [number, number])[]): LiveMapZoneRingProblem | null {
  if (ring.length < LIVE_MAP_ZONE_MIN_CORNERS + 1 || ring.length > LIVE_MAP_ZONE_MAX_CORNERS + 1) return "size"
  if (!samePair(ring[0], ring[ring.length - 1])) return "open"
  const outline = ring.slice(0, -1).map(pointOfPair)
  const different = new Set(outline.map((point) => `${point.latitude},${point.longitude}`))
  if (different.size < LIVE_MAP_ZONE_MIN_CORNERS) return "corners"
  if (outlineCrossesItself(outline)) return "crossing"
  // Counting different corners is not enough: three of them on one line are
  // three and enclose nothing, and neither does a line retraced — its edges
  // lie on each other, which «crosses itself» does not see. So the area is
  // asked. After the crossing, not before it: the two loops of a figure of
  // eight cancel out to about nothing as well, and that ring is refused for
  // what it is.
  if (polygonAreaSquareMeters(outline) < LIVE_MAP_ZONE_MIN_AREA_SQUARE_METERS) return "corners"
  return null
}

/**
 * The same rule about what the page holds — the ruler's points, each once,
 * not yet closed — in the four ways it is said to the person drawing:
 *
 *   - "tooFew" — not three points yet;
 *   - "tooMany" — more points than an outline may have;
 *   - "flat" — the points enclose nothing ("corners" above);
 *   - "crossing" — the line crosses itself.
 *
 * Null for an outline that can be kept as it stands. The page offers «save as
 * a zone» by this and the server accepts a zone by liveMapZoneRingProblem, so
 * the button is never there for a ring the server would refuse.
 */
export type LiveMapZoneOutlineProblem = "tooFew" | "tooMany" | "flat" | "crossing"

export function liveMapZoneOutlineProblem(outline: readonly LiveMapZonePoint[]): LiveMapZoneOutlineProblem | null {
  const problem = liveMapZoneRingProblem(liveMapZoneRing(outline))
  if (problem === null) return null
  if (problem === "size") return outline.length < LIVE_MAP_ZONE_MIN_CORNERS ? "tooFew" : "tooMany"
  if (problem === "crossing") return "crossing"
  // "open" cannot come of a ring this file has just closed; what is left is a ring around nothing.
  return "flat"
}

/**
 * A shape drawn on the page as the request sends it. The radius is stored in
 * whole metres, and a circle pulled out with the mouse is never a whole number.
 */
export function liveMapZoneShapeBody(shape: LiveMapZoneShape): LiveMapZoneShapeBody {
  if (shape.kind === "CIRCLE") {
    return {
      kind: "CIRCLE",
      centerLatitude: shape.center.latitude,
      centerLongitude: shape.center.longitude,
      radiusMeters: Math.round(shape.radiusMeters),
    }
  }
  return { kind: "POLYGON", polygon: { type: "Polygon", coordinates: [liveMapZoneRing(shape.outline)] } }
}

/** Square metres a zone covers: the circle's disc, or what the outline encloses. */
export function zoneAreaSquareMeters(zone: LiveMapZoneShape): number {
  if (zone.kind === "CIRCLE") return Math.PI * zone.radiusMeters * zone.radiusMeters
  return polygonAreaSquareMeters(zone.outline)
}

/**
 * The colour a zone is drawn in: the hex of its key, looked up in the palette
 * in the code, or the one for «no colour». A key is all that is ever read of
 * what the server said — its text never reaches a style.
 */
export function liveMapZoneHex(color: string | null | undefined): string {
  return mtmAgentMapColorHex(color) ?? LIVE_MAP_ZONE_DEFAULT_HEX
}

/**
 * A radius as it was typed — «500», «1 500» — in whole metres, or null when
 * it is not a number the server would keep. Nothing is rounded or pulled into
 * the range behind the manager's back: «10» is refused, not turned into 25.
 */
export function parseLiveMapZoneRadius(text: string): number | null {
  const digits = text.replace(/\s+/g, "")
  if (!/^\d{1,7}$/.test(digits)) return null
  const meters = Number(digits)
  return meters >= LIVE_MAP_ZONE_MIN_RADIUS_METERS && meters <= LIVE_MAP_ZONE_MAX_RADIUS_METERS ? meters : null
}

/**
 * The zones in the order the map lays them down: the one that covers most
 * first, so that a smaller zone always lies on top of a bigger one.
 *
 * Every zone is a filled shape that takes the presses on it, and where two
 * overlap the press goes to the one on top. Laid down by name, or in the
 * order they were drawn, a pharmacy's circle inside a district's outline was
 * under the district whenever the alphabet or the clock said so, and its own
 * balloon could not be opened on the map at all. By size the smaller one
 * always answers; the bigger one is still pressed anywhere outside it.
 *
 * Two zones of one size keep one order — by id — on every render.
 */
export function liveMapZonesLargestFirst(zones: readonly LiveMapZone[]): LiveMapZone[] {
  return zones
    .map((zone) => ({ zone, area: zoneAreaSquareMeters(zone) }))
    .sort((left, right) => right.area - left.area || left.zone.id.localeCompare(right.zone.id))
    .map((sized) => sized.zone)
}

/** The zones in the order a list shows them: by name, as the viewer's own language sorts. */
export function sortLiveMapZones(zones: readonly LiveMapZone[], locale: string): LiveMapZone[] {
  return [...zones].sort((left, right) =>
    left.name.localeCompare(right.name, locale, { numeric: true, sensitivity: "base" }) || left.id.localeCompare(right.id))
}

/**
 * Why the server did not keep a change, as the form says it in words:
 *
 *   - "invalid" — it read the request and refused what was in it;
 *   - "limit" — the organization already keeps as many zones as it may;
 *   - "readOnly" — this viewer may look and not change;
 *   - "gone" — the zone was removed by somebody else meanwhile;
 *   - "busy" — too many changes in a minute;
 *   - "session" — nobody is signed in any more;
 *   - "network" — the request never got an answer;
 *   - "failed" — anything else.
 */
export type LiveMapZoneWriteProblem = "invalid" | "limit" | "readOnly" | "gone" | "busy" | "session" | "network" | "failed"

export function liveMapZoneWriteProblem(status: number, code: unknown): LiveMapZoneWriteProblem {
  if (status === 400) return "invalid"
  // «It went through» without the server's own «success» is the sign-in page
  // served in place of the answer: the session has ended.
  if (status === 401 || (status >= 200 && status < 300)) return "session"
  if (status === 403) return "readOnly"
  if (status === 404) return "gone"
  if (status === 409 && code === "MTM_MAP_ZONE_LIMIT_REACHED") return "limit"
  if (status === 429) return "busy"
  return "failed"
}

/**
 * One zone of an answer — a row of the list, or what a create or an update
 * gave back — or null when it cannot be drawn as what it says it is.
 */
export function parseLiveMapZone(value: unknown): LiveMapZone | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== "string" || !row.id) return null
  if (typeof row.name !== "string" || !row.name.trim()) return null
  const label = {
    id: row.id,
    name: row.name,
    // A colour this build does not know — dropped from the palette later, or
    // written by a newer build during a rollback — is «no colour», as on an
    // employee's marker. The zone is still there.
    color: isMtmAgentMapColorKey(row.color) ? row.color : null,
  }
  if (row.kind === "CIRCLE") {
    if (!isLatitude(row.centerLatitude) || !isLongitude(row.centerLongitude)) return null
    if (typeof row.radiusMeters !== "number" || !Number.isFinite(row.radiusMeters) || row.radiusMeters <= 0) return null
    return {
      ...label,
      kind: "CIRCLE",
      center: { latitude: row.centerLatitude, longitude: row.centerLongitude },
      radiusMeters: row.radiusMeters,
    }
  }
  if (row.kind === "POLYGON") {
    const polygon = row.polygon
    if (!polygon || typeof polygon !== "object" || Array.isArray(polygon)) return null
    const { type, coordinates } = polygon as Record<string, unknown>
    // One ring: a second one would be a hole, and no zone is drawn with one.
    if (type !== "Polygon" || !Array.isArray(coordinates) || coordinates.length !== 1) return null
    const outline = liveMapZoneOutline(coordinates[0])
    return outline ? { ...label, kind: "POLYGON", outline } : null
  }
  return null
}

/** What the server says about the organization's zones, as the page holds it. */
export interface LiveMapZonesAnswer {
  zones: LiveMapZone[]
  /** Whether this viewer may draw, change and remove zones; anything but an explicit yes is no. */
  canWrite: boolean
  /** Rows that were in the answer and could not be drawn — so the layer can say it is not whole. */
  unreadable: number
}

/**
 * Fail closed on a malformed answer: a layer with made-up shapes is worse
 * than no layer. An answer that is not a list of zones is refused whole; a
 * row inside it that cannot be drawn is left out and counted, never guessed at.
 */
export function parseLiveMapZones(value: unknown): LiveMapZonesAnswer | null {
  if (!value || typeof value !== "object") return null
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.zones)) return null
  const zones: LiveMapZone[] = []
  let unreadable = 0
  for (const row of data.zones) {
    const zone = parseLiveMapZone(row)
    if (zone) zones.push(zone)
    else unreadable += 1
  }
  const access = data.access && typeof data.access === "object" ? data.access as Record<string, unknown> : null
  return { zones, canWrite: access?.canWrite === true, unreadable }
}

/**
 * The answer the page holds with one zone added, or put in the place of the
 * one with its id — what a create, a rename or a recolour has just given
 * back. The page draws that, and does not read the whole list again for it.
 */
export function withLiveMapZone(answer: LiveMapZonesAnswer, zone: LiveMapZone): LiveMapZonesAnswer {
  const known = answer.zones.some((kept) => kept.id === zone.id)
  return { ...answer, zones: known ? answer.zones.map((kept) => (kept.id === zone.id ? zone : kept)) : [...answer.zones, zone] }
}

/** The same answer without the zone that was removed. */
export function withoutLiveMapZone(answer: LiveMapZonesAnswer, zoneId: string): LiveMapZonesAnswer {
  return { ...answer, zones: answer.zones.filter((kept) => kept.id !== zoneId) }
}
