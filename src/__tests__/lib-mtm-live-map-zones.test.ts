/**
 * «Свои зоны» of the live map: named areas a manager draws by hand (owner,
 * 2026-10-09, of the tracking product shown as the model: «бери почти всё,
 * чего у нас нет»).
 *
 * The rule that matters most here is the dullest one: a stored ring is
 * [longitude, latitude] and the page's outline is { latitude, longitude }.
 * One swapped pair draws a district in another hemisphere and no other check
 * notices — so a known corner is followed all the way round.
 */
import { describe, expect, it } from "vitest"
import {
  LIVE_MAP_ZONE_DEFAULT_HEX,
  LIVE_MAP_ZONE_DEFAULT_RADIUS_METERS,
  LIVE_MAP_ZONE_MAX_CORNERS,
  liveMapZoneHex,
  liveMapZoneOutline,
  liveMapZoneOutlineProblem,
  liveMapZoneRing,
  liveMapZoneRingProblem,
  liveMapZoneShapeBody,
  liveMapZoneWriteProblem,
  liveMapZonesLargestFirst,
  parseLiveMapZone,
  parseLiveMapZoneRadius,
  parseLiveMapZones,
  sortLiveMapZones,
  withLiveMapZone,
  withoutLiveMapZone,
  zoneAreaSquareMeters,
  type LiveMapZone,
  type LiveMapZonePoint,
  type LiveMapZoneRingPair,
  type LiveMapZoneShape,
} from "@/lib/mtm/live-map-zones"
import { MTM_AGENT_MAP_COLORS } from "@/lib/mtm/agent-tags"
import { MapZoneCreateSchema, MapZoneUpdateSchema } from "@/lib/mtm-validators"

// An invented block of a hundredth of a degree a side, north-east of nothing in particular.
const BLOCK: LiveMapZonePoint[] = [
  { latitude: 40.4, longitude: 49.8 },
  { latitude: 40.4, longitude: 49.81 },
  { latitude: 40.41, longitude: 49.81 },
  { latitude: 40.41, longitude: 49.8 },
]
const BLOCK_RING: LiveMapZoneRingPair[] = [[49.8, 40.4], [49.81, 40.4], [49.81, 40.41], [49.8, 40.41], [49.8, 40.4]]
/** The same four corners joined crosswise: a figure of eight. */
const BOW_TIE: LiveMapZoneRingPair[] = [[49.8, 40.4], [49.81, 40.41], [49.8, 40.41], [49.81, 40.4], [49.8, 40.4]]

/** Three corners on one latitude: what three presses along one row of the screen give. A line, closed. */
const ALONG_A_PARALLEL: LiveMapZoneRingPair[] = [[49.8, 40.4], [49.81, 40.4], [49.82, 40.4], [49.8, 40.4]]
/** …and three on one longitude. */
const ALONG_A_MERIDIAN: LiveMapZoneRingPair[] = [[49.8, 40.4], [49.8, 40.41], [49.8, 40.42], [49.8, 40.4]]
/** Out to one place and back, out to another and back (A-B-A-C-A): three different corners, two lines, nothing between them. */
const OUT_AND_BACK: LiveMapZoneRingPair[] = [[49.8, 40.4], [49.81, 40.4], [49.8, 40.4], [49.8, 40.41], [49.8, 40.4]]

/** A ring of `corners` different corners that goes once round a centre. */
function roundRing(corners: number): LiveMapZoneRingPair[] {
  const open = Array.from({ length: corners }, (_unused, index): LiveMapZoneRingPair => {
    const angle = (2 * Math.PI * index) / corners
    return [49.85 + 0.05 * Math.cos(angle), 40.4 + 0.05 * Math.sin(angle)]
  })
  return [...open, open[0]]
}

const circleRow = { id: "zone-centre", name: "Центр", kind: "CIRCLE", color: "teal", centerLatitude: 40.4, centerLongitude: 49.85, radiusMeters: 1500, polygon: null }
const outlineRow = {
  id: "zone-north", name: "Северный участок", kind: "POLYGON", color: null,
  centerLatitude: null, centerLongitude: null, radiusMeters: null, polygon: { type: "Polygon", coordinates: [BLOCK_RING] },
}

describe("the order of the two numbers", () => {
  it("stores a corner as [longitude, latitude] and gives it back to the page as { latitude, longitude }", () => {
    const ring = liveMapZoneRing(BLOCK)
    // The first corner was drawn at latitude 40.4, longitude 49.8.
    expect(ring[0]).toEqual([49.8, 40.4])
    expect(ring).toEqual(BLOCK_RING)
    expect(liveMapZoneOutline(ring)).toEqual(BLOCK)
  })

  it("closes the ring back to its first corner, and the page's outline holds every corner once", () => {
    const ring = liveMapZoneRing(BLOCK)
    expect(ring).toHaveLength(BLOCK.length + 1)
    expect(ring[ring.length - 1]).toEqual(ring[0])
    expect(liveMapZoneOutline(ring)).toHaveLength(BLOCK.length)
    expect(liveMapZoneRing([])).toEqual([])
  })

  it("does not take a pair written the other way round for a place: a latitude of 120 is not on the globe", () => {
    // [latitude, longitude] of a point at longitude 120 — the mistake this file exists to prevent.
    const swapped = [[40.4, 120], [40.4, 120.01], [40.41, 120.01], [40.4, 120]]
    expect(liveMapZoneOutline(swapped)).toBeNull()
    expect(liveMapZoneOutline(swapped.map(([latitude, longitude]) => [longitude, latitude]))).toHaveLength(3)
  })
})

describe("what can be an outline", () => {
  it("reads only a closed ring of pairs of numbers: anything else is not an outline", () => {
    expect(liveMapZoneOutline(null)).toBeNull()
    expect(liveMapZoneOutline("ring")).toBeNull()
    expect(liveMapZoneOutline(BLOCK_RING.slice(0, 3))).toBeNull()
    // Open: the last pair is not the first.
    expect(liveMapZoneOutline(BLOCK_RING.slice(0, 4))).toBeNull()
    expect(liveMapZoneOutline(BLOCK_RING.map(([longitude, latitude]) => [longitude, latitude, 0]))).toBeNull()
    expect(liveMapZoneOutline(BLOCK_RING.map(([longitude, latitude]) => [String(longitude), String(latitude)]))).toBeNull()
    expect(liveMapZoneOutline(BLOCK_RING.map(([longitude]) => [longitude, Number.NaN]))).toBeNull()
    expect(liveMapZoneOutline(BLOCK_RING.map(() => null))).toBeNull()
  })

  it("says why a ring cannot be kept as a zone", () => {
    expect(liveMapZoneRingProblem(BLOCK_RING)).toBeNull()
    expect(liveMapZoneRingProblem(BLOCK_RING.slice(0, 3))).toBe("size")
    expect(liveMapZoneRingProblem([])).toBe("size")
    expect(liveMapZoneRingProblem(BLOCK_RING.slice(0, 4))).toBe("open")
    expect(liveMapZoneRingProblem(BOW_TIE)).toBe("crossing")
  })

  it("refuses the same spot pressed again and again: a closed ring of the right length around nothing", () => {
    const spot: LiveMapZoneRingPair = [49.8, 40.4]
    expect(liveMapZoneRingProblem([spot, spot, spot, spot])).toBe("corners")
    // There and back along one line is two corners, however many pairs.
    expect(liveMapZoneRingProblem([spot, [49.81, 40.41], spot, [49.81, 40.41], spot])).toBe("corners")
  })

  it("refuses three different corners that enclose nothing: all on one line, or a line gone out and back along itself", () => {
    // Each has three different corners and no edge that crosses another — and no inside.
    expect(liveMapZoneRingProblem(ALONG_A_PARALLEL)).toBe("corners")
    expect(liveMapZoneRingProblem(ALONG_A_MERIDIAN)).toBe("corners")
    expect(liveMapZoneRingProblem(OUT_AND_BACK)).toBe("corners")
    // Whichever corner the line is closed at.
    expect(liveMapZoneRingProblem([[49.81, 40.4], [49.82, 40.4], [49.8, 40.4], [49.81, 40.4]])).toBe("corners")
    // A figure of eight sums to about nothing as well, and is still refused for what it is.
    expect(liveMapZoneRingProblem(BOW_TIE)).toBe("crossing")
  })

  it("keeps an outline that is small or thin as long as something is inside it", () => {
    // A yard: about four metres by four.
    const yard: LiveMapZoneRingPair[] = [[49.8, 40.4], [49.80005, 40.4], [49.80005, 40.40004], [49.8, 40.40004], [49.8, 40.4]]
    expect(zoneAreaSquareMeters({ kind: "POLYGON", outline: liveMapZoneOutline(yard)! })).toBeLessThan(30)
    expect(liveMapZoneRingProblem(yard)).toBeNull()
    // A street: a kilometre long and some ten metres wide.
    const street: LiveMapZoneRingPair[] = [[49.8, 40.4], [49.8118, 40.4], [49.8118, 40.4001], [49.8, 40.4001], [49.8, 40.4]]
    expect(liveMapZoneRingProblem(street)).toBeNull()
    // The third corner a few metres off the line of the other two: a sliver, and a zone.
    expect(liveMapZoneRingProblem([[49.8, 40.4], [49.81, 40.4], [49.82, 40.40005], [49.8, 40.4]])).toBeNull()
  })

  it("takes an outline of two hundred corners and not one more", () => {
    expect(liveMapZoneRingProblem(roundRing(LIVE_MAP_ZONE_MAX_CORNERS))).toBeNull()
    expect(liveMapZoneRingProblem(roundRing(LIVE_MAP_ZONE_MAX_CORNERS + 1))).toBe("size")
  })

  it("says the same about the ruler's points as they stand, in the four ways the page words it", () => {
    const points = (ring: LiveMapZoneRingPair[]) => liveMapZoneOutline(ring)!
    expect(liveMapZoneOutlineProblem(BLOCK)).toBeNull()
    expect(liveMapZoneOutlineProblem([])).toBe("tooFew")
    expect(liveMapZoneOutlineProblem(BLOCK.slice(0, 2))).toBe("tooFew")
    expect(liveMapZoneOutlineProblem(points(roundRing(LIVE_MAP_ZONE_MAX_CORNERS)))).toBeNull()
    expect(liveMapZoneOutlineProblem(points(roundRing(LIVE_MAP_ZONE_MAX_CORNERS + 1)))).toBe("tooMany")
    expect(liveMapZoneOutlineProblem(points(BOW_TIE))).toBe("crossing")
    for (const ring of [ALONG_A_PARALLEL, ALONG_A_MERIDIAN, OUT_AND_BACK]) expect(liveMapZoneOutlineProblem(points(ring))).toBe("flat")
    // The same spot pressed three times encloses nothing either.
    expect(liveMapZoneOutlineProblem([BLOCK[0], BLOCK[0], BLOCK[0]])).toBe("flat")
    // The page and the server cannot disagree: what the page would offer to save is exactly what the server keeps.
    for (const ring of [BLOCK_RING, BOW_TIE, ALONG_A_PARALLEL, ALONG_A_MERIDIAN, OUT_AND_BACK, roundRing(LIVE_MAP_ZONE_MAX_CORNERS + 1)]) {
      const kept = MapZoneCreateSchema.safeParse({ name: "Участок", kind: "POLYGON", polygon: { type: "Polygon", coordinates: [ring] } }).success
      expect(liveMapZoneOutlineProblem(points(ring)) === null).toBe(kept)
    }
  })
})

describe("how much a zone covers", () => {
  it("measures a circle by its radius", () => {
    const area = zoneAreaSquareMeters({ kind: "CIRCLE", center: { latitude: 40.4, longitude: 49.85 }, radiusMeters: 1000 })
    expect(area).toBeCloseTo(Math.PI * 1_000_000, 3)
  })

  it("measures an outline by what it encloses, whichever way round it was drawn", () => {
    // A hundredth of a degree is about 1112 m north-south and, at this latitude, about 847 m east-west.
    const metresPerDegree = (Math.PI * 6_371_000) / 180
    const expected = (0.01 * metresPerDegree) * (0.01 * metresPerDegree * Math.cos((40.405 * Math.PI) / 180))
    const area = zoneAreaSquareMeters({ kind: "POLYGON", outline: BLOCK })
    expect(Math.abs(area / expected - 1)).toBeLessThan(0.005)
    expect(zoneAreaSquareMeters({ kind: "POLYGON", outline: [...BLOCK].reverse() })).toBeCloseTo(area, 3)
  })
})

describe("a shape on its way to the server and back", () => {
  const drawn: LiveMapZoneShape[] = [
    { kind: "CIRCLE", center: { latitude: 40.37, longitude: 49.83 }, radiusMeters: 312.6 },
    { kind: "POLYGON", outline: BLOCK },
  ]

  it("is sent as the table's columns: a circle in whole metres, an outline as one closed ring", () => {
    expect(liveMapZoneShapeBody(drawn[0])).toEqual({ kind: "CIRCLE", centerLatitude: 40.37, centerLongitude: 49.83, radiusMeters: 313 })
    expect(liveMapZoneShapeBody(drawn[1])).toEqual({ kind: "POLYGON", polygon: { type: "Polygon", coordinates: [BLOCK_RING] } })
  })

  it("passes the server's own rules and comes back as the shape that was drawn", () => {
    for (const shape of drawn) {
      const accepted = MapZoneCreateSchema.safeParse({ name: "Участок", ...liveMapZoneShapeBody(shape) })
      expect(accepted.success, JSON.stringify(accepted.error?.issues)).toBe(true)
      // What the server stores is what it accepted; the list answers the same columns.
      const read = parseLiveMapZone({ id: "zone-1", color: null, ...accepted.data })
      expect(read).toEqual({
        id: "zone-1", name: "Участок", color: null,
        ...(shape.kind === "CIRCLE" ? { ...shape, radiusMeters: 313 } : shape),
      })
    }
  })
})

describe("the server's answer as the page holds it", () => {
  it("reads every zone it can draw, and whether this viewer may change them", () => {
    const answer = parseLiveMapZones({ zones: [circleRow, outlineRow], access: { canWrite: true } })
    expect(answer).toEqual({
      zones: [
        { id: "zone-centre", name: "Центр", color: "teal", kind: "CIRCLE", center: { latitude: 40.4, longitude: 49.85 }, radiusMeters: 1500 },
        { id: "zone-north", name: "Северный участок", color: null, kind: "POLYGON", outline: BLOCK },
      ],
      canWrite: true,
      unreadable: 0,
    })
  })

  it("offers the tools only on an explicit yes", () => {
    for (const access of [undefined, null, {}, { canWrite: "true" }, { canWrite: 1 }, { canWrite: false }, "yes"]) {
      expect(parseLiveMapZones({ zones: [], access })?.canWrite).toBe(false)
    }
    expect(parseLiveMapZones({ zones: [], access: { canWrite: true } })?.canWrite).toBe(true)
  })

  it("refuses an answer that is not a list of zones rather than drawing an empty map as the truth", () => {
    expect(parseLiveMapZones(null)).toBeNull()
    expect(parseLiveMapZones("zones")).toBeNull()
    expect(parseLiveMapZones({ access: { canWrite: true } })).toBeNull()
    expect(parseLiveMapZones({ zones: { 0: circleRow } })).toBeNull()
    // An organization that has drawn nothing yet is a list, and it is empty.
    expect(parseLiveMapZones({ zones: [] })).toEqual({ zones: [], canWrite: false, unreadable: 0 })
  })

  it("leaves out a row it cannot draw as what it says it is — and counts it, so the layer can say it is not whole", () => {
    const answer = parseLiveMapZones({
      zones: [
        circleRow,
        { ...circleRow, id: "no-radius", radiusMeters: null },
        { ...circleRow, id: "no-size", radiusMeters: 0 },
        { ...circleRow, id: "text-radius", radiusMeters: "1500" },
        { ...circleRow, id: "off-the-globe", centerLatitude: 120 },
        { ...circleRow, id: "no-centre", centerLongitude: null },
        { ...circleRow, id: "", name: "Без id" },
        { ...circleRow, id: "no-name", name: "   " },
        { ...circleRow, id: "a-square", kind: "SQUARE" },
        { ...outlineRow, id: "open", polygon: { type: "Polygon", coordinates: [BLOCK_RING.slice(0, 4)] } },
        { ...outlineRow, id: "with-a-hole", polygon: { type: "Polygon", coordinates: [BLOCK_RING, BLOCK_RING] } },
        { ...outlineRow, id: "a-line", polygon: { type: "LineString", coordinates: [BLOCK_RING] } },
        { ...outlineRow, id: "no-outline", polygon: null },
        null,
        "zone",
        outlineRow,
      ],
      access: { canWrite: false },
    })
    expect(answer?.zones.map((zone) => zone.id)).toEqual(["zone-centre", "zone-north"])
    expect(answer?.unreadable).toBe(14)
  })

  it("turns a colour it does not know into «no colour», never into a style", () => {
    for (const color of ["#ff0000", "red; background: url(x)", "constructor", "TEAL", 7, undefined]) {
      expect(parseLiveMapZone({ ...circleRow, color })?.color).toBeNull()
    }
    expect(parseLiveMapZone({ ...circleRow, color: "navy" })?.color).toBe("navy")
  })
})

describe("what a request may say about a zone", () => {
  const circle = { kind: "CIRCLE", centerLatitude: 40.4, centerLongitude: 49.85, radiusMeters: 300 }
  const outline = { kind: "POLYGON", polygon: { type: "Polygon", coordinates: [BLOCK_RING] } }
  const refused = (body: unknown) => {
    const result = MapZoneCreateSchema.safeParse(body)
    return result.success ? null : result.error.issues.map((issue) => issue.path.join("."))
  }

  it("tidies the name and holds it to the form's length", () => {
    expect(MapZoneCreateSchema.parse({ name: "  Центр  ", ...circle }).name).toBe("Центр")
    expect(refused({ name: "   ", ...circle })).toEqual(["name"])
    expect(refused({ name: "я".repeat(121), ...circle })).toEqual(["name"])
    expect(refused({ name: "я".repeat(120), ...circle })).toBeNull()
    expect(refused(circle)).toEqual(["name"])
  })

  it("takes a colour only as a key of the employees' palette; «Без цвета» is an empty choice", () => {
    expect(MapZoneCreateSchema.parse({ name: "Центр", color: "teal", ...circle }).color).toBe("teal")
    expect(MapZoneCreateSchema.parse({ name: "Центр", color: "", ...circle }).color).toBeNull()
    expect(MapZoneCreateSchema.parse({ name: "Центр", color: null, ...circle }).color).toBeNull()
    expect(refused({ name: "Центр", color: "#0d9488", ...circle })).toEqual(["color"])
    expect(refused({ name: "Центр", color: "red", ...circle })).toEqual(["color"])
  })

  it("wants a circle whole: a centre that is two numbers on the globe and a radius in whole metres from 25 m to 100 km", () => {
    expect(refused({ name: "Центр", ...circle, radiusMeters: 24 })).toEqual(["radiusMeters"])
    expect(refused({ name: "Центр", ...circle, radiusMeters: 100_001 })).toEqual(["radiusMeters"])
    expect(refused({ name: "Центр", ...circle, radiusMeters: 300.5 })).toEqual(["radiusMeters"])
    expect(refused({ name: "Центр", ...circle, radiusMeters: 25 })).toBeNull()
    expect(refused({ name: "Центр", ...circle, radiusMeters: 100_000 })).toBeNull()
    expect(refused({ name: "Центр", ...circle, centerLatitude: 91 })).toEqual(["centerLatitude"])
    expect(refused({ name: "Центр", ...circle, centerLongitude: -181 })).toEqual(["centerLongitude"])
    // A missing centre is refused, not read as zero: null, "" and a number in quotes are not numbers.
    for (const absent of [null, "", "40.4", undefined]) {
      expect(refused({ name: "Центр", ...circle, centerLatitude: absent })).toEqual(["centerLatitude"])
    }
  })

  it("wants an outline as one closed ring that does not cross itself", () => {
    const ring = (coordinates: unknown) => refused({ name: "Участок", kind: "POLYGON", polygon: { type: "Polygon", coordinates } })
    expect(refused({ name: "Участок", ...outline })).toBeNull()
    expect(ring([BLOCK_RING.slice(0, 4)])).toEqual(["polygon.coordinates.0"])
    expect(ring([BOW_TIE])).toEqual(["polygon.coordinates.0"])
    expect(ring([BLOCK_RING.slice(0, 3)])).toEqual(["polygon.coordinates.0"])
    expect(ring([BLOCK_RING, BLOCK_RING])).toEqual(["polygon.coordinates"])
    expect(ring([])).toEqual(["polygon.coordinates"])
    expect(ring([roundRing(LIVE_MAP_ZONE_MAX_CORNERS)])).toBeNull()
    expect(ring([roundRing(LIVE_MAP_ZONE_MAX_CORNERS + 1)])).toEqual(["polygon.coordinates.0"])
    // A ring around nothing — corners on one line, a line gone out and back — is not an outline.
    for (const flat of [ALONG_A_PARALLEL, ALONG_A_MERIDIAN, OUT_AND_BACK]) expect(ring([flat])).toEqual(["polygon.coordinates.0"])
    // Pairs that are not two numbers on the globe are named one by one.
    expect(ring([[[49.8, 40.4], [49.81, 40.4], null, [49.8, 40.4]]])).toEqual(["polygon.coordinates.0.2"])
    expect(ring([[[49.8, 140.4], [49.81, 40.4], [49.81, 40.41], [49.8, 140.4]]])).toEqual(["polygon.coordinates.0.0.1", "polygon.coordinates.0.3.1"])
    expect(refused({ name: "Участок", kind: "POLYGON" })).toEqual(["polygon"])
    expect(refused({ name: "Участок", kind: "SQUARE" })).toEqual(["kind"])
  })

  it("changes a name or a colour on their own, and a shape only whole", () => {
    const change = (body: unknown) => {
      const result = MapZoneUpdateSchema.safeParse(body)
      return result.success ? result.data : result.error.issues.map((issue) => issue.code)
    }
    expect(change({ name: " Новое имя " })).toEqual({ name: "Новое имя" })
    expect(change({ color: null })).toEqual({ color: null })
    expect(change({ color: "pink" })).toEqual({ color: "pink" })
    expect(change({ name: "Круг", ...circle })).toEqual({ name: "Круг", ...circle })
    expect(change(outline)).toEqual(outline)
    // Nothing to change is not a change.
    expect(change({})).toEqual(["custom"])
    // Half a shape is not dropped and answered with success: it is refused.
    expect(change({ radiusMeters: 500 })).toEqual(["unrecognized_keys"])
    expect(change({ name: "Круг", polygon: outline.polygon })).toEqual(["unrecognized_keys"])
    expect(MapZoneUpdateSchema.safeParse({ kind: "CIRCLE", centerLatitude: 40.4, centerLongitude: 49.85 }).success).toBe(false)
    expect(MapZoneUpdateSchema.safeParse({ kind: "POLYGON", polygon: { type: "Polygon", coordinates: [BOW_TIE] } }).success).toBe(false)
    // A zone cannot be redrawn into a line either.
    expect(MapZoneUpdateSchema.safeParse({ kind: "POLYGON", polygon: { type: "Polygon", coordinates: [ALONG_A_PARALLEL] } }).success).toBe(false)
  })
})

describe("how a zone is drawn and listed on the page", () => {
  const zone = (id: string, name: string): LiveMapZone => ({ id, name, color: null, kind: "CIRCLE", center: { latitude: 40.4, longitude: 49.85 }, radiusMeters: 500 })

  it("takes a zone's colour from the palette by its key, and has one of its own for «no colour» — never the text it was given", () => {
    expect(liveMapZoneHex("teal")).toBe(MTM_AGENT_MAP_COLORS.teal)
    expect(liveMapZoneHex(null)).toBe(LIVE_MAP_ZONE_DEFAULT_HEX)
    // Text that is not a key cannot become a style, however much it looks like one.
    for (const text of ["#ff0000", "red;background:url(x)", "constructor", "toString", ""]) {
      expect(liveMapZoneHex(text), text).toBe(LIVE_MAP_ZONE_DEFAULT_HEX)
    }
    // «No colour» is not one of the eight a manager can choose: a zone without a colour is told from one with.
    expect(Object.values(MTM_AGENT_MAP_COLORS)).not.toContain(LIVE_MAP_ZONE_DEFAULT_HEX)
  })

  it("reads a typed radius as whole metres and refuses what the server would not keep — without rounding it into range", () => {
    expect(parseLiveMapZoneRadius(String(LIVE_MAP_ZONE_DEFAULT_RADIUS_METERS))).toBe(500)
    expect(parseLiveMapZoneRadius(" 1 500 ")).toBe(1500)
    expect([parseLiveMapZoneRadius("25"), parseLiveMapZoneRadius("100000")]).toEqual([25, 100_000])
    for (const text of ["24", "100001", "0", "", "  ", "-500", "500.5", "500,5", "1e3", "пятьсот", "500 м", "99999999"]) {
      expect(parseLiveMapZoneRadius(text), text).toBeNull()
    }
  })

  it("lists zones by name as the viewer's language sorts, numbers by their value, and never reorders what it was given", () => {
    const given = [zone("3", "Центр"), zone("1", "участок 10"), zone("2", "Участок 2"), zone("4", "Аэропорт")]
    expect(sortLiveMapZones(given, "ru").map((kept) => kept.name)).toEqual(["Аэропорт", "Участок 2", "участок 10", "Центр"])
    expect(given.map((kept) => kept.id)).toEqual(["3", "1", "2", "4"])
    // Two zones may share a name: their order is still the same on every render.
    const twins = [zone("b", "Центр"), zone("a", "Центр")]
    expect(sortLiveMapZones(twins, "ru").map((kept) => kept.id)).toEqual(["a", "b"])
    expect(sortLiveMapZones([...twins].reverse(), "ru").map((kept) => kept.id)).toEqual(["a", "b"])
  })

  it("lays the bigger zone down first, so that a small zone inside a big one is the one on top — whatever their names and whichever came first", () => {
    // A pharmacy's circle, 400 m across its radius, inside a district's outline.
    const pharmacy: LiveMapZone = { id: "zone-b", name: "Аптека", color: null, kind: "CIRCLE", center: { latitude: 40.405, longitude: 49.805 }, radiusMeters: 400 }
    const district: LiveMapZone = { id: "zone-a", name: "Центр", color: null, kind: "POLYGON", outline: BLOCK }
    expect(zoneAreaSquareMeters(pharmacy)).toBeLessThan(zoneAreaSquareMeters(district))
    const laid = (zones: LiveMapZone[]) => liveMapZonesLargestFirst(zones).map((kept) => kept.name)
    // By name the circle comes first («Аптека»), by the moment of drawing either may: neither decides.
    expect(laid([pharmacy, district])).toEqual(["Центр", "Аптека"])
    expect(laid([district, pharmacy])).toEqual(["Центр", "Аптека"])
    // A region drawn around both a moment ago goes under both.
    const region: LiveMapZone = { id: "zone-0", name: "Апшерон", color: null, kind: "CIRCLE", center: { latitude: 40.405, longitude: 49.805 }, radiusMeters: 20_000 }
    expect(laid([pharmacy, district, region])).toEqual(["Апшерон", "Центр", "Аптека"])
    expect(laid([region, pharmacy, district])).toEqual(["Апшерон", "Центр", "Аптека"])
    // Two zones of one size keep one order on every render, and what was given is not reordered under the caller.
    const twins = [zone("b", "Центр"), zone("a", "Центр")]
    expect(liveMapZonesLargestFirst(twins).map((kept) => kept.id)).toEqual(["a", "b"])
    expect(liveMapZonesLargestFirst([...twins].reverse()).map((kept) => kept.id)).toEqual(["a", "b"])
    expect(twins.map((kept) => kept.id)).toEqual(["b", "a"])
  })

  it("puts a zone the server has just kept into the list in hand: a new one is added, a known one replaced, a removed one taken out", () => {
    const answer = { zones: [zone("1", "Центр"), zone("2", "Север")], canWrite: true, unreadable: 1 }
    const added = withLiveMapZone(answer, zone("3", "Юг"))
    expect(added.zones.map((kept) => kept.id)).toEqual(["1", "2", "3"])
    const renamed = withLiveMapZone(added, zone("2", "Северный участок"))
    expect(renamed.zones.map((kept) => [kept.id, kept.name])).toEqual([["1", "Центр"], ["2", "Северный участок"], ["3", "Юг"]])
    const removed = withoutLiveMapZone(renamed, "1")
    expect(removed.zones.map((kept) => kept.id)).toEqual(["2", "3"])
    // Who may change zones and what could not be drawn are the server's words: a change of one zone does not touch them.
    expect([removed.canWrite, removed.unreadable]).toEqual([true, 1])
    // What the page already holds is not changed under it.
    expect(answer.zones.map((kept) => kept.name)).toEqual(["Центр", "Север"])
    expect(withoutLiveMapZone(answer, "no such zone").zones).toHaveLength(2)
  })

  it("names why the server did not keep a change, so the form can say it in words", () => {
    expect(liveMapZoneWriteProblem(400, undefined)).toBe("invalid")
    expect(liveMapZoneWriteProblem(403, "MTM_MAP_ZONE_READ_ONLY")).toBe("readOnly")
    expect(liveMapZoneWriteProblem(403, "MTM_MAP_ZONE_MANAGER_REQUIRED")).toBe("readOnly")
    expect(liveMapZoneWriteProblem(404, "MTM_MAP_ZONE_NOT_FOUND")).toBe("gone")
    expect(liveMapZoneWriteProblem(409, "MTM_MAP_ZONE_LIMIT_REACHED")).toBe("limit")
    expect(liveMapZoneWriteProblem(429, "MTM_MAP_ZONE_RATE_LIMITED")).toBe("busy")
    expect(liveMapZoneWriteProblem(401, undefined)).toBe("session")
    // The sign-in page served with «200» in place of the answer is a session that has ended, not a zone that was saved.
    expect(liveMapZoneWriteProblem(200, undefined)).toBe("session")
    // Anything else is not dressed up as one of the above: a conflict that is not the limit, a server that fell over.
    expect(liveMapZoneWriteProblem(409, "SOMETHING_ELSE")).toBe("failed")
    expect(liveMapZoneWriteProblem(500, "MTM_MAP_ZONE_FAILED")).toBe("failed")
    expect(liveMapZoneWriteProblem(0, undefined)).toBe("failed")
  })
})
