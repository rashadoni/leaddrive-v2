// @vitest-environment jsdom
/**
 * What an MTM map asks the network for to draw its background, and whether the
 * Content-Security-Policy lets every one of those requests through.
 *
 * Until 2026-10-09 the basemap asked for CARTO's vector style first. The
 * policy refused that one request (a host wildcard does not admit the bare
 * host), so in production the vector map never appeared: 69 violation reports
 * from users' browsers in the log between 5 September and 9 October, and
 * raster tiles on every screen. No test failed, because the tests of the time
 * checked the URL helpers and the text of the policy — never the requests a
 * mounted map makes against that policy.
 *
 * Leaflet and react-leaflet are real here. jsdom loads no images, so the tile
 * elements are what the test reads, and their load and error events are
 * dispatched by hand.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MapContainer } from "react-leaflet"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildCsp } from "@/lib/csp"
import { cspAdmits, cspSourceAdmits } from "./helpers/csp-admits"

// The key is read when the module loads, as it is in the browser bundle.
const CARTO_KEY = vi.hoisted(() => {
  const key = "referrer key/+"
  process.env.NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY = key
  return key
})

import { CartoBasemap } from "@/components/mtm/carto-basemap"
import { liveMapBaseMaps } from "@/lib/mtm/live-map-base-maps"

const BAKU: [number, number] = [40.4093, 49.8671]

let container: HTMLDivElement
let root: Root
let fetched: string[]
let xhrOpened: string[]
let workersStarted: string[]

async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mountMap(props: Parameters<typeof CartoBasemap>[0] = {}, basemapKey = "carto-0") {
  await act(async () => {
    root.render(
      createElement(
        MapContainer,
        { center: BAKU, zoom: 12, style: { height: "100%", width: "100%" } },
        createElement(CartoBasemap, { key: basemapKey, ...props }),
      ),
    )
  })
  await settle()
}

const tiles = () => Array.from(container.querySelectorAll<HTMLImageElement>("img.leaflet-tile"))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom lays nothing out; Leaflet takes the map's size from these two.
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1024)
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(768)

  fetched = []
  xhrOpened = []
  workersStarted = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    fetched.push(String(input instanceof Request ? input.url : input))
    throw new TypeError("Failed to fetch")
  }))
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation((_method: string, url: string | URL) => {
    xhrOpened.push(String(url))
  })
  vi.stubGlobal("Worker", class {
    constructor(url: string | URL) {
      workersStarted.push(String(url))
    }
  })

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

describe("the MTM basemap and the Content-Security-Policy", () => {
  it("draws its background from CARTO raster tiles, with the key on every one", async () => {
    await mountMap()

    const requested = tiles().map((tile) => new URL(tile.src))
    expect(requested.length).toBeGreaterThan(4)
    for (const url of requested) {
      expect(url.protocol).toBe("https:")
      expect(url.hostname).toMatch(/^[abcd]\.basemaps\.cartocdn\.com$/)
      expect(url.pathname).toMatch(/^\/rastertiles\/voyager\/12\/\d+\/\d+\.png$/)
      // Without the key CARTO answers with a tile that reads «API KEY REQUIRED».
      expect(url.searchParams.get("key")).toBe(CARTO_KEY)
    }
    expect(new Set(requested.map((url) => url.hostname)).size).toBeGreaterThan(1)
  })

  it("asks for nothing the policy refuses: every request is an image the policy admits", async () => {
    await mountMap()
    const policy = buildCsp("nonce")

    const requested = tiles().map((tile) => tile.src)
    expect(requested.length).toBeGreaterThan(4)
    for (const url of requested) {
      expect(cspAdmits(policy, "img-src", url), url).toBe(true)
    }
    // A style document, TileJSON, glyphs or a worker would each be a request of
    // another kind, answering to connect-src or worker-src instead.
    expect(fetched).toEqual([])
    expect(xhrOpened).toEqual([])
    expect(workersStarted).toEqual([])
    expect(container.querySelectorAll("canvas")).toHaveLength(0)
  })

  it("reports loading, a loaded tile and a failed tile to the map that mounted it", async () => {
    const onLoading = vi.fn()
    const onLoad = vi.fn()
    const onError = vi.fn()
    await mountMap({ onLoading, onLoad, onError })

    expect(onLoading).toHaveBeenCalled()
    expect(onLoad).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    const [first, second] = tiles()
    act(() => {
      first.dispatchEvent(new Event("load"))
    })
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()

    act(() => {
      second.dispatchEvent(new Event("error"))
    })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("leaves one tile layer behind when the live map retries its background", async () => {
    await mountMap({}, "carto-0")
    const before = tiles().length
    expect(container.querySelectorAll(".leaflet-tile-pane .leaflet-layer")).toHaveLength(1)

    // live-map.tsx remounts the basemap under a new key when the dispatcher presses «retry».
    await mountMap({}, "carto-1")
    expect(container.querySelectorAll(".leaflet-tile-pane .leaflet-layer")).toHaveLength(1)
    expect(tiles()).toHaveLength(before)
    expect(container.querySelectorAll(".leaflet-control-attribution a[href='https://carto.com/attributions']")).toHaveLength(1)
  })
})

describe("the trap the vector basemap fell into", () => {
  const wildcard = "https://*.basemaps.cartocdn.com"

  it("a host wildcard admits every subdomain and not the host itself", () => {
    expect(cspSourceAdmits(wildcard, "https://a.basemaps.cartocdn.com/rastertiles/voyager/12/2615/1552.png")).toBe(true)
    expect(cspSourceAdmits(wildcard, "https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/12/2615/1552.mvt")).toBe(true)
    expect(cspSourceAdmits(wildcard, "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json")).toBe(false)
  })

  it("the check that would have caught it answers for the policy in force, not for its text", () => {
    const policy = buildCsp("nonce")
    expect(cspAdmits(policy, "connect-src", "https://app.leaddrivecrm.org/api/v1/ping")).toBe(true)
    expect(cspAdmits(policy, "connect-src", "https://generativelanguage.googleapis.com/v1beta/models")).toBe(true)
    expect(cspAdmits(policy, "connect-src", "https://evil.example/collect")).toBe(false)
    expect(cspAdmits(policy, "img-src", "http://a.basemaps.cartocdn.com/rastertiles/voyager/1/1/1.png")).toBe(false)
    expect(cspAdmits(policy, "worker-src", "https://cdn.example/worker.js")).toBe(false)
  })

  // «Слои → Вид карты» on the live map (owner, 2026-10-09: «добей до 100 %» of
  // the tracking product shown as the model, where the map's look is switched
  // on the map itself).
  describe("the live map's other backgrounds", () => {
    const SATELLITE = "https://tiles.imagery.example/v1/{z}/{x}/{y}.jpg?token=contract"
    const offered = () => liveMapBaseMaps(CARTO_KEY, SATELLITE, "© Imagery <b>Co</b>")
    const background = (id: string) => offered().find((map) => map.id === id)!.tiles

    it("«Светлая» and «Тёмная» are CARTO's own tiles under the same key, and the policy admits every one", async () => {
      const policy = buildCsp("nonce")
      for (const [id, path] of [["light", "light_all"], ["dark", "dark_all"]] as const) {
        await mountMap({ tiles: background(id) }, `carto-${id}`)
        const requested = tiles().map((tile) => new URL(tile.src))
        expect(requested.length, id).toBeGreaterThan(4)
        for (const url of requested) {
          expect(url.hostname).toMatch(/^[abcd]\.basemaps\.cartocdn\.com$/)
          expect(url.pathname).toMatch(new RegExp(`^/${path}/12/\\d+/\\d+\\.png$`))
          expect(url.searchParams.get("key")).toBe(CARTO_KEY)
          expect(cspAdmits(policy, "img-src", url.href), url.href).toBe(true)
        }
        expect(fetched).toEqual([])
      }
    })

    it("going back to «Карта» asks for Voyager again, and the tiles of the background left behind are taken away", async () => {
      await mountMap({ tiles: background("dark") }, "carto-dark")
      expect(tiles().every((tile) => tile.src.includes("/dark_all/"))).toBe(true)
      await mountMap({ tiles: null }, "carto-voyager")
      expect(tiles().length).toBeGreaterThan(4)
      expect(tiles().every((tile) => tile.src.includes("/rastertiles/voyager/"))).toBe(true)
    })

    it("a page that hands the same background again on every refresh does not make the map ask for its tiles again", async () => {
      await mountMap({ tiles: { ...background("light")! } }, "carto-light")
      const first = tiles()
      // A new object with the same values, the same key: the same layer stays.
      await mountMap({ tiles: { ...background("light")! } }, "carto-light")
      expect(tiles()).toEqual(first)
      expect(tiles().every((tile, index) => tile === first[index])).toBe(true)
    })

    it("«Спутник» is offered only where the build was given an address for it — https, with the three places Leaflet fills in", () => {
      expect(liveMapBaseMaps(CARTO_KEY, undefined, undefined).map((map) => map.id)).toEqual(["voyager", "light", "dark"])
      for (const refused of ["", "   ", "http://tiles.imagery.example/{z}/{x}/{y}.jpg", "https://tiles.imagery.example/{z}/{x}.jpg", "javascript:alert(1)//{z}{x}{y}"]) {
        expect(liveMapBaseMaps(CARTO_KEY, refused, "x").map((map) => map.id), refused).toEqual(["voyager", "light", "dark"])
      }
      expect(offered().map((map) => map.id)).toEqual(["voyager", "light", "dark", "satellite"])
    })

    it("draws the satellite picture from the address given, credits it in words, and the policy admits it", async () => {
      await mountMap({ tiles: background("satellite") }, "carto-satellite")
      const policy = buildCsp("nonce")
      const requested = tiles().map((tile) => new URL(tile.src))
      expect(requested.length).toBeGreaterThan(4)
      for (const url of requested) {
        expect(url.origin).toBe("https://tiles.imagery.example")
        expect(url.pathname).toMatch(/^\/v1\/12\/\d+\/\d+\.jpg$/)
        expect(url.searchParams.get("token")).toBe("contract")
        expect(cspAdmits(policy, "img-src", url.href), url.href).toBe(true)
      }
      // Whose picture it is, as text: the credit line comes from settings and is never markup.
      const credit = container.querySelector(".leaflet-control-attribution")
      expect(credit?.textContent).toContain("© Imagery <b>Co</b>")
      expect(credit?.querySelector("b")).toBeNull()
    })

    it("a remembered background this build no longer offers is not remembered", async () => {
      const { parseLiveMapBaseMap } = await import("@/lib/mtm/live-map-base-maps")
      const withoutSatellite = liveMapBaseMaps(CARTO_KEY, undefined, undefined)
      expect(parseLiveMapBaseMap("satellite", withoutSatellite)).toBe("voyager")
      expect(parseLiveMapBaseMap("dark", withoutSatellite)).toBe("dark")
      expect(parseLiveMapBaseMap("something", withoutSatellite)).toBe("voyager")
      expect(parseLiveMapBaseMap(undefined, withoutSatellite)).toBe("voyager")
      // Without a key the addresses carry none (CARTO then answers with its own notice — as for Voyager).
      expect(liveMapBaseMaps(null, undefined, undefined)[1].tiles?.url).toBe("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png")
    })
  })
})
