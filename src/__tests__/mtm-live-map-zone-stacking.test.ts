// @vitest-environment jsdom
/**
 * Which of two overlapping zones answers a press — asked of Leaflet itself.
 *
 * Every other test of the live map stands react-leaflet in with plain
 * elements, and those cannot show this. Leaflet draws a pane's shapes in the
 * order they were ADDED to the map, whatever order React lists them in, and
 * never reorders them; each zone is a filled shape that takes every press on
 * it. So a pharmacy's circle inside a district's outline was under the
 * district whenever the district came later — by the alphabet after a reload,
 * by the clock within a session — and its own balloon could not be opened on
 * the map at all (review, 2026-10-10).
 *
 * Here the real map is mounted: jsdom has SVG, so Leaflet draws real <path>
 * elements into the zones' pane, and they are read back in the order they
 * lie. jsdom lays nothing out, so it cannot be asked what is under a finger.
 * What a browser answers is the last path, in that order, that contains the
 * place — that is worked out here, and then that path is really pressed and
 * the balloon Leaflet opens is looked at.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

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
import { MTM_AGENT_MAP_COLORS, type MtmAgentMapColorKey } from "@/lib/mtm/agent-tags"
import type { LiveMapZone } from "@/lib/mtm/live-map-zones"

// Invented places. A district: a block a hundredth of a degree a side, about a kilometre.
const DISTRICT: LiveMapZone = {
  id: "zone-district", name: "Центр", color: "navy", kind: "POLYGON",
  outline: [{ latitude: 40.4, longitude: 49.8 }, { latitude: 40.4, longitude: 49.81 }, { latitude: 40.41, longitude: 49.81 }, { latitude: 40.41, longitude: 49.8 }],
}
// A pharmacy's circle in the middle of it: 300 m, well inside. By name it comes before the district.
const PHARMACY: LiveMapZone = { id: "zone-pharmacy", name: "Аптека", color: "pink", kind: "CIRCLE", center: { latitude: 40.405, longitude: 49.805 }, radiusMeters: 300 }
// And a region around both.
const REGION: LiveMapZone = { id: "zone-region", name: "Апшерон", color: "lime", kind: "CIRCLE", center: { latitude: 40.405, longitude: 49.805 }, radiusMeters: 20_000 }

/** Three places, and the zones each of them is inside. */
const AT_THE_PHARMACY = ["zone-pharmacy", "zone-district", "zone-region"]
const IN_THE_DISTRICT_AWAY_FROM_THE_PHARMACY = ["zone-district", "zone-region"]
const OUTSIDE_THE_DISTRICT = ["zone-region"]

let root: Root
let container: HTMLDivElement

const draw = async (zones: LiveMapZone[]) => {
  await act(async () => { root.render(createElement(MtmLiveMap, { agents: [], zones, canEditZones: true })) })
  // The map, then its pane, then the shapes in the pane: each mounts a render after the one before.
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
const pane = () => container.querySelector(".leaflet-mtm-own-zones-pane") as HTMLElement
const paths = () => [...pane().querySelectorAll("path")]
/** A zone's path is told by its colour: Leaflet writes the stroke it was given onto the element. */
const zoneOf = (path: Element) => {
  const stroke = path.getAttribute("stroke")
  const zone = [DISTRICT, PHARMACY, REGION].find((candidate) => MTM_AGENT_MAP_COLORS[candidate.color as MtmAgentMapColorKey] === stroke)
  if (!zone) throw new Error(`a path of no known zone: ${stroke}`)
  return zone.id
}
/** The zones as they lie, the bottom one first. */
const stack = () => paths().map(zoneOf)
/** The path a browser gives a press to: the topmost of those that contain the place. */
const topmostOf = (containing: string[]) => {
  const path = paths().filter((candidate) => containing.includes(zoneOf(candidate))).at(-1)
  if (!path) throw new Error("no zone there")
  return path
}
/** Presses there, and says whose balloon Leaflet opened. */
const pressAt = async (containing: string[]) => {
  await act(async () => { topmostOf(containing).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 400, clientY: 300 })) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return [...document.querySelectorAll('[data-testid^="live-map-zone-zone-"]')].map((balloon) => balloon.getAttribute("data-testid")!.replace("live-map-zone-", ""))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  // The map waits for a frame with a size before it mounts Leaflet.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
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

describe("zones that overlap, on the real Leaflet", () => {
  it.each([
    ["the small one is listed first, as the alphabet lists them", [PHARMACY, DISTRICT]],
    ["the big one is listed first", [DISTRICT, PHARMACY]],
  ])("a small circle inside a large outline is the one that answers a press on it — %s", async (_order, zones) => {
    await draw(zones)
    // One drawing surface for the zones, and both shapes on it as real paths that take presses.
    expect(pane().querySelectorAll("svg")).toHaveLength(1)
    expect(paths().map((path) => path.classList.contains("leaflet-interactive"))).toEqual([true, true])
    // The district lies under the pharmacy.
    expect(stack()).toEqual(["zone-district", "zone-pharmacy"])
    expect(await pressAt(AT_THE_PHARMACY)).toEqual(["zone-pharmacy"])
    // …and is still pressed everywhere the pharmacy does not cover it.
    expect(await pressAt(IN_THE_DISTRICT_AWAY_FROM_THE_PHARMACY)).toEqual(["zone-district"])
  })

  it("a district outlined later around a zone that is already on the map goes under it, not over it", async () => {
    await draw([PHARMACY])
    expect(stack()).toEqual(["zone-pharmacy"])
    const pharmacyPath = paths()[0]
    // Drawn a moment ago: Leaflet adds its shape last, which by itself is on top.
    await draw([PHARMACY, DISTRICT])
    expect(stack()).toEqual(["zone-district", "zone-pharmacy"])
    expect(await pressAt(AT_THE_PHARMACY)).toEqual(["zone-pharmacy"])
    // A region around both, listed first this time: under both.
    await draw([REGION, PHARMACY, DISTRICT])
    expect(stack()).toEqual(["zone-region", "zone-district", "zone-pharmacy"])
    expect(await pressAt(AT_THE_PHARMACY)).toEqual(["zone-pharmacy"])
    expect(await pressAt(IN_THE_DISTRICT_AWAY_FROM_THE_PHARMACY)).toEqual(["zone-district"])
    expect(await pressAt(OUTSIDE_THE_DISTRICT)).toEqual(["zone-region"])
    // The shapes were put in order, not drawn anew: the pharmacy's is the element it was from the start.
    expect(paths().at(-1)).toBe(pharmacyPath)
  })

  it("keeps the order when a zone is renamed or another is removed, and never leaves the zones' own pane", async () => {
    await draw([REGION, PHARMACY, DISTRICT])
    // Renamed so that the alphabet would now put it last: the size has not changed, and neither has the order.
    await draw([REGION, { ...PHARMACY, name: "Я — аптека" }, DISTRICT])
    expect(stack()).toEqual(["zone-region", "zone-district", "zone-pharmacy"])
    await draw([{ ...PHARMACY, name: "Я — аптека" }, REGION])
    expect(stack()).toEqual(["zone-region", "zone-pharmacy"])
    // Under everything that is a person, a client or a line: Leaflet's own panes for those start at 400.
    expect(pane().style.zIndex).toBe("350")
    expect(paths()).toHaveLength(2)
    // No zone's shape is drawn anywhere but in that pane.
    const zoneStrokes = new Set<string>([DISTRICT, PHARMACY, REGION].map((zone) => MTM_AGENT_MAP_COLORS[zone.color as MtmAgentMapColorKey]))
    expect([...container.querySelectorAll("path")].filter((path) => zoneStrokes.has(path.getAttribute("stroke") ?? "") && !pane().contains(path))).toEqual([])
    await draw([])
    expect(paths()).toEqual([])
  })
})
