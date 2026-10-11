// @vitest-environment jsdom
/**
 * The map of the public page behind a «ссылка на местоположение»: the usual
 * background and one marker where the employee is — and nothing else.
 *
 * Leaflet and react-leaflet are real here. jsdom lays nothing out and loads
 * no images, so what is read is what Leaflet put into the page: where the
 * marker stands, which tiles were asked for, what can be pressed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import L from "leaflet"
import { buildCsp } from "@/lib/csp"
import { cspAdmits } from "./helpers/csp-admits"

vi.mock("leaflet/dist/leaflet.css", () => ({}))

import LocationShareLinkMap from "@/components/mtm/location-share-link-map"

const WIDTH = 390
const HEIGHT = 480
const BAKU = { latitude: 40.4093, longitude: 49.8671 }
const SUMQAYIT = { latitude: 40.5897, longitude: 49.6686 }

/** The tile of the web map that holds a coordinate, at a zoom. */
function tileOf(point: { latitude: number; longitude: number }, zoom: number): string {
  const scale = 2 ** zoom
  const latitude = (point.latitude * Math.PI) / 180
  const x = Math.floor(((point.longitude + 180) / 360) * scale)
  const y = Math.floor(((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2) * scale)
  return `/${zoom}/${x}/${y}.png`
}

describe("the map of a location link", () => {
  let root: Root
  let container: HTMLDivElement
  let fetched: string[]
  /** Every map Leaflet made, so that a case can drag the one on screen. */
  const maps: L.Map[] = []
  L.Map.addInitHook(function remember(this: L.Map) { maps.push(this) })

  const settle = async () => {
    for (let turn = 0; turn < 3; turn += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    }
  }
  const draw = async (props: { latitude: number; longitude: number; name: string; recentreKey?: number }) => {
    await act(async () => { root.render(createElement(LocationShareLinkMap, { recentreKey: 0, ...props })) })
    await settle()
  }
  /** What a visitor's thumb does: the map is dragged, here by a third of its width and a quarter of its height. */
  const drag = async () => {
    const map = maps.at(-1)
    if (!map) throw new Error("no map was made")
    await act(async () => { map.panBy([WIDTH / 3, HEIGHT / 4], { animate: false }) })
    await settle()
  }
  /** How far the marker stands from the middle of the map's box, in pixels. */
  const offCentre = () => {
    const marker = placed(markers()[0])
    const pane = placed(container.querySelector<HTMLElement>(".leaflet-map-pane")!) ?? { x: 0, y: 0 }
    if (!marker) throw new Error("the marker is not placed")
    return Math.hypot(marker.x + pane.x - WIDTH / 2, marker.y + pane.y - HEIGHT / 2)
  }
  /** Leaflet glides back to a point that is near; the glide is a quarter of a second. */
  const glide = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) }) }
  const markers = () => [...container.querySelectorAll<HTMLElement>(".leaflet-marker-pane .mtm-agent-marker")]
  /** Where Leaflet put an element, in the map's own pixels. */
  const placed = (element: HTMLElement) => (element as HTMLElement & { _leaflet_pos?: { x: number; y: number } })._leaflet_pos
  const tiles = () => [...container.querySelectorAll<HTMLImageElement>("img.leaflet-tile")].map((tile) => new URL(tile.src))

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // jsdom lays nothing out; Leaflet takes the map's size from these two — a phone's screen.
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(WIDTH)
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(HEIGHT)
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    fetched = []
    maps.length = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      fetched.push(String(input instanceof Request ? input.url : input))
      throw new TypeError("Failed to fetch")
    }))
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

  it("draws exactly one marker, in the middle of a map centred on the answered coordinate", async () => {
    await draw({ ...BAKU, name: "Нигяр Примерова" })
    expect(markers()).toHaveLength(1)
    // The middle of the box: the map was opened on that very point.
    expect(placed(markers()[0])).toMatchObject({ x: WIDTH / 2, y: HEIGHT / 2 })
    // And the background that was asked for is the piece of the world that holds it.
    const asked = tiles().map((url) => url.pathname)
    expect(asked.length).toBeGreaterThan(3)
    expect(asked.some((path) => path.endsWith(tileOf(BAKU, 15))), tileOf(BAKU, 15)).toBe(true)
    expect(asked.some((path) => path.endsWith(tileOf(SUMQAYIT, 15)))).toBe(false)
  })

  it("puts the first letter of the name on the marker, and draws it as the managers' map draws a fresh position", async () => {
    await draw({ ...BAKU, name: "Нигяр Примерова" })
    const marker = markers()[0]
    expect(marker.textContent?.trim()).toBe("Н")
    const body = marker.firstElementChild as HTMLElement
    // Green and round: the same sign for «свежая координата» as on the live map.
    expect(body.style.background).toBe("rgb(21, 128, 61)")
    expect(body.style.borderRadius).toBe("50%")
    // No ring of a manager's colour: that colour is a note about the person, and is not sent here at all.
    expect(body.style.boxShadow).toBe("0 2px 8px rgba(0,0,0,0.3)")
  })

  it("is not something to press: no balloon, no button, nothing for the keyboard to stop on", async () => {
    await draw({ ...BAKU, name: "Нигяр Примерова" })
    const marker = markers()[0]
    expect(marker.classList.contains("leaflet-interactive")).toBe(false)
    expect(marker.getAttribute("role")).toBeNull()
    expect(marker.getAttribute("tabindex")).toBeNull()
    await act(async () => { marker.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(container.querySelector(".leaflet-popup")).toBeNull()
    // Nothing but the marker lies over the background: no track, no circle, no second marker.
    expect(container.querySelectorAll(".leaflet-overlay-pane *")).toHaveLength(0)
    expect(container.querySelectorAll(".leaflet-shadow-pane *")).toHaveLength(0)
    expect(container.querySelectorAll(".leaflet-tooltip-pane *")).toHaveLength(0)
  })

  it("follows the employee: a new coordinate moves the one marker and brings the map to it", async () => {
    await draw({ ...BAKU, name: "Нигяр Примерова" })
    await draw({ ...SUMQAYIT, name: "Нигяр Примерова" })
    expect(markers()).toHaveLength(1)
    // In the middle again — of a map that is now on the new point, whose piece of the world is asked for.
    expect(placed(markers()[0])).toMatchObject({ x: WIDTH / 2, y: HEIGHT / 2 })
    expect(tiles().some((url) => url.pathname.endsWith(tileOf(SUMQAYIT, 15))), tileOf(SUMQAYIT, 15)).toBe(true)
    expect(tiles().some((url) => url.pathname.endsWith(tileOf(BAKU, 15)))).toBe(false)
  })

  it("takes its background from the same tiles as every other map of ours, every one admitted by the page's policy — and asks the network for nothing else", async () => {
    await draw({ ...BAKU, name: "Нигяр Примерова" })
    const policy = buildCsp("nonce")
    const asked = tiles()
    expect(asked.length).toBeGreaterThan(3)
    for (const url of asked) {
      expect(url.hostname, url.href).toMatch(/^[abcd]\.basemaps\.cartocdn\.com$/)
      expect(url.pathname, url.href).toMatch(/^\/rastertiles\/voyager\/15\/\d+\/\d+\.png$/)
      expect(cspAdmits(policy, "img-src", url.href), url.href).toBe(true)
    }
    // The page says where the background is from.
    expect(container.querySelector(".leaflet-control-attribution")?.textContent).toMatch(/CARTO/)
    expect(fetched).toEqual([])
  })

  it("credits OpenStreetMap and CARTO in its corner — and carries no mark of the map library, nor the flag that comes with it", async () => {
    await draw({ ...BAKU, name: "Нигяр Примерова" })
    const corners = [...container.querySelectorAll(".leaflet-control-attribution")]
    // One corner, not the library's own plus ours.
    expect(corners).toHaveLength(1)
    const credit = corners[0]
    expect(credit.textContent).toContain("OpenStreetMap")
    expect(credit.textContent).toContain("CARTO")
    expect([...credit.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "https://www.openstreetmap.org/copyright", "https://carto.com/attributions",
    ])
    expect(credit.textContent).not.toMatch(/Leaflet/i)
    expect(credit.querySelector("svg")).toBeNull()
    expect(container.innerHTML).not.toMatch(/leafletjs\.com|leaflet-attribution-flag/)
  })

  it("stays where the visitor dragged it while the same coordinate keeps coming back", async () => {
    await draw({ ...BAKU, name: "Нигяр Примерова" })
    expect(offCentre()).toBeLessThan(1)
    await drag()
    const dragged = offCentre()
    expect(dragged).toBeGreaterThan(100)
    // The page asks twice a minute; the employee stands still.
    for (let answer = 0; answer < 3; answer += 1) await draw({ ...BAKU, name: "Нигяр Примерова" })
    await glide()
    expect(offCentre()).toBeCloseTo(dragged, 0)
  })

  it("comes back to the marker when the visitor asks for it — also when the point has not moved", async () => {
    await draw({ ...BAKU, name: "Нигяр Примерова", recentreKey: 0 })
    await drag()
    expect(offCentre()).toBeGreaterThan(100)
    // «Обновить» was pressed: the same point, one press more.
    await draw({ ...BAKU, name: "Нигяр Примерова", recentreKey: 1 })
    await glide()
    expect(offCentre()).toBeLessThan(1)
    expect(markers()).toHaveLength(1)
    // The zoom is still the visitor's own.
    await act(async () => { maps.at(-1)?.setZoom(17, { animate: false }) })
    await drag()
    await draw({ ...BAKU, name: "Нигяр Примерова", recentreKey: 2 })
    await glide()
    expect(offCentre()).toBeLessThan(1)
    expect(maps.at(-1)?.getZoom()).toBe(17)
  })

  it("draws a marker for a name it cannot take a letter from", async () => {
    await draw({ ...BAKU, name: "" })
    expect(markers()).toHaveLength(1)
    expect(markers()[0].textContent?.trim()).toBe("?")
  })
})
