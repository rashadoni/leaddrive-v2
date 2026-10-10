// @vitest-environment jsdom
/**
 * «На карте» on a zone's row — asked of Leaflet itself.
 *
 * The list of the organization's own zones stands on the page, outside the
 * map, and each row has «На карте»: the map moves so that the whole zone is in
 * view. The page's side of it — which zone was asked for, and that a second
 * press is a second asking — is in mtm-live-map-page-flow.test.ts, where the
 * map is a stand-in that records what it is given. A stand-in cannot say where
 * a map ends up. So here the real map is mounted, as in
 * mtm-live-map-zone-stacking.test.ts, and what is looked at is what Leaflet
 * itself says is in view afterwards.
 *
 * jsdom lays nothing out, so the map is told its size (800 × 600); from there
 * on its centre, its zoom and its bounds are Leaflet's own arithmetic. What a
 * browser adds is the flight between two views — jsdom has none, the map goes
 * straight there — and that was looked at in a real browser.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import L from "leaflet"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru
    for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})
vi.mock("leaflet/dist/leaflet.css", () => ({}))
// The background asks the network for tiles; nothing here is about it.
vi.mock("@/components/mtm/carto-basemap", () => ({ CartoBasemap: () => null }))

import MtmLiveMap from "@/components/mtm/live-map"
import type { LiveMapZone } from "@/lib/mtm/live-map-zones"

// Invented places. The map opens on the middle of Baku (no employee is on it); these are far from there.
// A district three hundred kilometres to the west: a block about a kilometre a side.
const WEST_BLOCK: LiveMapZone = {
  id: "zone-west", name: "Западный участок", color: "navy", kind: "POLYGON",
  outline: [{ latitude: 40.68, longitude: 46.35 }, { latitude: 40.68, longitude: 46.362 }, { latitude: 40.689, longitude: 46.362 }, { latitude: 40.689, longitude: 46.35 }],
}
// A region around a town two hundred kilometres to the south: a circle forty kilometres across.
const SOUTH_REGION: LiveMapZone = { id: "zone-south", name: "Южный район", color: "lime", kind: "CIRCLE", center: { latitude: 38.75, longitude: 48.85 }, radiusMeters: 20_000 }
// A shop's own doorstep, as small as a zone may be.
const DOORSTEP: LiveMapZone = { id: "zone-door", name: "У входа", color: "pink", kind: "CIRCLE", center: { latitude: 41.2, longitude: 47.17 }, radiusMeters: 25 }
const ZONES = [WEST_BLOCK, SOUTH_REGION, DOORSTEP]
const BAKU: L.LatLngTuple = [40.4093, 49.8671]

/** Every map Leaflet makes, in the order it made them: the test has no other way to the one inside the component. */
const maps: L.Map[] = []
L.Map.addInitHook(function keepMap(this: L.Map) { maps.push(this) })
const map = () => {
  const made = maps.at(-1)
  if (!made) throw new Error("Leaflet has made no map")
  return made
}

const METERS_PER_DEGREE = 111_320
/** The outermost places of a zone, worked out here and not by Leaflet: the corners, or the circle's north, south, east and west. */
const edges = (zone: LiveMapZone): L.LatLngTuple[] => {
  if (zone.kind === "POLYGON") return zone.outline.map((point) => [point.latitude, point.longitude])
  const north = zone.radiusMeters / METERS_PER_DEGREE
  const east = zone.radiusMeters / (METERS_PER_DEGREE * Math.cos((zone.center.latitude * Math.PI) / 180))
  const { latitude, longitude } = zone.center
  return [[latitude + north, longitude], [latitude - north, longitude], [latitude, longitude + east], [latitude, longitude - east]]
}
const inView = (zone: LiveMapZone) => edges(zone).every((place) => map().getBounds().contains(place))
/** How much of the map's shorter side the zone takes, 0…1: «in view» on a map of the whole country is not «shown». */
const shareOfMap = (zone: LiveMapZone) => {
  const points = edges(zone).map((place) => map().latLngToContainerPoint(place))
  const width = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x))
  const height = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))
  return Math.max(width / 800, height / 600)
}

let root: Root
let container: HTMLDivElement

const draw = async (over: { zones?: LiveMapZone[]; focusZone?: { zoneId: string; turn: number } | null } = {}) => {
  await act(async () => { root.render(createElement(MtmLiveMap, { agents: [], zones: over.zones ?? ZONES, canEditZones: false, focusZone: over.focusZone ?? null })) })
  // The map, then its pane, then the shapes in the pane: each mounts a render after the one before.
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
/** The dispatcher drags the map somewhere else. */
const dragTo = async (center: L.LatLngTuple, zoom: number) => {
  await act(async () => { map().setView(center, zoom, { animate: false }) })
}
/**
 * Whether the map is still where it was. To a few pixels, not to the last digit: Leaflet re-reads its centre from
 * the pixels when the frame is measured again, and a pixel at this zoom is thirty metres. The zones are 200–300 km away.
 */
const stayedAt = (place: L.LatLng) => map().getCenter().distanceTo(place) < 100
/** Lets whatever the press set going come to rest. jsdom has no flight between two views: Leaflet goes straight there. */
const rest = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) }) }

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  // The map waits for a frame with a size before it mounts Leaflet — and Leaflet then measures that frame itself.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(800)
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(600)
  maps.length = 0
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("«На карте» for a zone, on the real Leaflet", () => {
  it("brings the whole of an outlined zone into view from wherever the map was, close enough to see it", async () => {
    await draw()
    // The map is a real one with a real size, and it opened on Baku: the zone is nowhere near.
    expect([map().getSize().x, map().getSize().y]).toEqual([800, 600])
    expect(map().getBounds().contains(BAKU)).toBe(true)
    expect(inView(WEST_BLOCK)).toBe(false)

    await draw({ focusZone: { zoneId: "zone-west", turn: 1 } })
    await rest()
    expect(inView(WEST_BLOCK)).toBe(true)
    // Not a dot on a map of the whole country: the zone takes a good part of the frame…
    expect(shareOfMap(WEST_BLOCK)).toBeGreaterThan(0.4)
    // …and not to its very edges either, where the tools and «Слои» lie over the map.
    expect(shareOfMap(WEST_BLOCK)).toBeLessThan(0.9)
    expect(map().getBounds().contains(BAKU)).toBe(false)
  })

  it("answers a second press for the same zone too: dragged away, the map goes back to it", async () => {
    await draw()
    await draw({ focusZone: { zoneId: "zone-west", turn: 1 } })
    await rest()
    expect(inView(WEST_BLOCK)).toBe(true)

    await dragTo(BAKU, 12)
    expect(inView(WEST_BLOCK)).toBe(false)
    // The same zone, the next press.
    await draw({ focusZone: { zoneId: "zone-west", turn: 2 } })
    await rest()
    expect(inView(WEST_BLOCK)).toBe(true)

    // And a third, for good measure — it is the press that is counted, not the zone.
    await dragTo(BAKU, 12)
    await draw({ focusZone: { zoneId: "zone-west", turn: 3 } })
    await rest()
    expect(inView(WEST_BLOCK)).toBe(true)
  })

  it("moves once for one press: a zone renamed, a list refreshed, do not take the map back to what was asked for earlier", async () => {
    await draw()
    await draw({ focusZone: { zoneId: "zone-west", turn: 1 } })
    await rest()
    expect(inView(WEST_BLOCK)).toBe(true)
    // The dispatcher looks elsewhere, and meanwhile the zones come again as a new list — one renamed, as after «Переименовать».
    await dragTo(BAKU, 12)
    await draw({ zones: [{ ...WEST_BLOCK, name: "Запад" }, SOUTH_REGION, DOORSTEP], focusZone: { zoneId: "zone-west", turn: 1 } })
    await draw({ zones: [...ZONES], focusZone: { zoneId: "zone-west", turn: 1 } })
    await rest()
    expect(inView(WEST_BLOCK)).toBe(false)
    expect(map().getBounds().contains(BAKU)).toBe(true)
  })

  it("shows a circle by its centre and its radius: all of a wide one, and a doorstep without blowing it up to fill the map", async () => {
    await draw()
    expect(inView(SOUTH_REGION)).toBe(false)
    await draw({ focusZone: { zoneId: "zone-south", turn: 1 } })
    await rest()
    // Forty kilometres across: its north, south, east and west are all on the map.
    expect(inView(SOUTH_REGION)).toBe(true)
    expect(shareOfMap(SOUTH_REGION)).toBeGreaterThan(0.4)
    const wide = map().getZoom()

    await draw({ focusZone: { zoneId: "zone-door", turn: 2 } })
    await rest()
    expect(inView(DOORSTEP)).toBe(true)
    // Much closer than the region — and with the streets around it still on the map: fifty metres do not fill the frame.
    expect(map().getZoom()).toBeGreaterThan(wide + 4)
    expect(map().getZoom()).toBeLessThanOrEqual(17)
    expect(shareOfMap(DOORSTEP)).toBeLessThan(0.5)
    // From one zone to another: the first is no longer what the map shows.
    expect(inView(SOUTH_REGION)).toBe(false)
  })

  it("breaks nothing and moves nothing when the zone asked for is not on the map — its layer was switched off meanwhile", async () => {
    await draw({ zones: [] })
    const before = map().getCenter()
    await draw({ zones: [], focusZone: { zoneId: "zone-west", turn: 1 } })
    await rest()
    expect(stayedAt(before)).toBe(true)
    // The layer comes back on: that old press is not answered now, out of the blue.
    await draw({ focusZone: { zoneId: "zone-west", turn: 1 } })
    await rest()
    expect(stayedAt(before)).toBe(true)
    // A zone nobody has, asked for by a page that is out of step: nothing either.
    await draw({ focusZone: { zoneId: "zone-nobody-has", turn: 2 } })
    await rest()
    expect(stayedAt(before)).toBe(true)
    // The next real press works as ever.
    await draw({ focusZone: { zoneId: "zone-west", turn: 3 } })
    await rest()
    expect(inView(WEST_BLOCK)).toBe(true)
  })

  it("a map drawn anew does not fly to a zone asked for before it existed", async () => {
    // The page came back from «История» with the last press still in hand.
    await draw({ focusZone: { zoneId: "zone-west", turn: 4 } })
    await rest()
    expect(map().getBounds().contains(BAKU)).toBe(true)
    expect(inView(WEST_BLOCK)).toBe(false)
    await draw({ focusZone: { zoneId: "zone-west", turn: 5 } })
    await rest()
    expect(inView(WEST_BLOCK)).toBe(true)
  })
})
