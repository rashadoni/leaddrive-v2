// @vitest-environment jsdom
/**
 * What an MTM map draws when CARTO refuses its tiles.
 *
 * CARTO's free basemaps may be limited or cut off without warning (terms of
 * 29 September 2026); a refused background used to be a grey map on every
 * screen of every tenant until somebody released a fix. Where the deployment
 * names a backup provider (src/lib/mtm/basemap-provider.ts) the map goes over
 * to it by itself — and where the deployment says so, CARTO is not asked at
 * all, on pages that are already open too.
 *
 * Leaflet and react-leaflet are real. jsdom loads no images, so the tile
 * elements are what the test reads, and their load and error events are
 * dispatched by hand — a refused tile is an `error` on its <img>, which is
 * all a browser tells a map about a 403.
 */
import { act, createElement, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import type L from "leaflet"
import { MapContainer, useMap } from "react-leaflet"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const CARTO_KEY = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY = "referrer-key"
  return "referrer-key"
})

import { CartoBasemap } from "@/components/mtm/carto-basemap"
import {
  BASEMAP_FAILOVER_AFTER_REFUSALS,
  BASEMAP_FAILOVER_MEMORY_MS,
  BASEMAP_PROVIDER_META,
  BASEMAP_PROVIDER_PATH,
  basemapFailoverRemembered,
  forgetBasemapFailover,
  serializeBasemapProvider,
} from "@/lib/mtm/basemap-provider"
import { refreshBasemapProvider, resetBasemapProviderStoreForTests } from "@/lib/mtm/basemap-provider-store"
import { liveMapBaseMaps } from "@/lib/mtm/live-map-base-maps"

const BAKU: [number, number] = [40.4093, 49.8671]
const BACKUP_URL = "https://tiles.backup.example/v1/streets/{z}/{y}/{x}?token=browser-key"
const BACKUP_CREDIT = "Powered by Backup & Co <maps>"
const N = BASEMAP_FAILOVER_AFTER_REFUSALS

let container: HTMLDivElement
let root: Root
let leafletMap: L.Map | null

async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** Hands the test the map itself, to move it as a dispatcher would. */
function Grab() {
  const map = useMap()
  useEffect(() => {
    leafletMap = map
  }, [map])
  return null
}

async function mountMap(props: Parameters<typeof CartoBasemap>[0] = {}, basemapKey = "carto-0") {
  await act(async () => {
    root.render(
      createElement(
        MapContainer,
        { center: BAKU, zoom: 12, style: { height: "100%", width: "100%" } },
        createElement(Grab),
        createElement(CartoBasemap, { key: basemapKey, ...props }),
      ),
    )
  })
  await settle()
}

async function remount(props: Parameters<typeof CartoBasemap>[0] = {}) {
  act(() => root.unmount())
  root = createRoot(container)
  await mountMap(props, `carto-${Math.random()}`)
}

const tiles = () => Array.from(container.querySelectorAll<HTMLImageElement>("img.leaflet-tile"))
// A tile is answered once — drawn or refused; the test keeps count so that none is answered twice.
let answered = new WeakSet<HTMLImageElement>()
const pending = () => tiles().filter((tile) => !answered.has(tile))
const hosts = () => [...new Set(tiles().map((tile) => new URL(tile.src).hostname.replace(/^[abcd]\./, "")))]
const credit = () => container.querySelector(".leaflet-control-attribution")?.textContent ?? ""

/** What the server wrote into the page's head; absent when the deployment names no backup. */
function tellPage(provider: { primary?: "carto" | "backup"; tileSize?: 256 | 512; url?: string } | null, where: HTMLElement = document.head) {
  document.querySelectorAll(`meta[name="${BASEMAP_PROVIDER_META}"]`).forEach((tag) => tag.remove())
  // A page reads its own tag once; another page in this file is another page.
  resetBasemapProviderStoreForTests()
  if (!provider) return
  const tag = document.createElement("meta")
  tag.setAttribute("name", BASEMAP_PROVIDER_META)
  tag.setAttribute("content", provider.url
    ? JSON.stringify({ primary: provider.primary ?? "carto", url: provider.url, attribution: BACKUP_CREDIT, tileSize: provider.tileSize ?? 256 })
    : serializeBasemapProvider({
      primary: provider.primary ?? "carto",
      backup: { url: BACKUP_URL, attribution: BACKUP_CREDIT, tileSize: provider.tileSize ?? 256 },
    })!)
  where.appendChild(tag)
}

/** The provider refuses `count` of the tiles it is being asked for. */
function refuse(count: number) {
  const asked = pending()
  expect(asked.length, "tiles being asked for").toBeGreaterThanOrEqual(count)
  for (const tile of asked.slice(0, count)) {
    answered.add(tile)
    act(() => {
      tile.dispatchEvent(new Event("error"))
    })
  }
}

/** The provider serves `count` of the tiles it is being asked for (all of them by default). */
function serve(count = pending().length) {
  for (const tile of pending().slice(0, count)) {
    answered.add(tile)
    act(() => {
      tile.dispatchEvent(new Event("load"))
    })
  }
}

/** The dispatcher looks somewhere else: a screen of tiles nobody has asked for yet. */
async function moveMap() {
  await act(async () => {
    leafletMap!.setView([41.2, 47.2], 12, { animate: false })
  })
  await settle()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1024)
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(768)
  // A page loaded a moment ago asks the server nothing; a case that asks says so itself.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch") }))
  window.sessionStorage.clear()
  forgetBasemapFailover()
  tellPage(null)
  leafletMap = null
  answered = new WeakSet()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  tellPage(null)
  forgetBasemapFailover()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("a map whose CARTO tiles are refused", () => {
  it("with no backup named, stays with CARTO and reports every refused tile, as it always did", async () => {
    const onError = vi.fn()
    await mountMap({ onError })
    refuse(N + 2)
    await settle()

    expect(onError).toHaveBeenCalledTimes(N + 2)
    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
    expect(fetch).not.toHaveBeenCalled()
  })

  it("goes over to the backup by itself once several tiles are refused and not one is drawn — and says nothing of an error", async () => {
    tellPage({})
    const onError = vi.fn()
    const onLoading = vi.fn()
    await mountMap({ onError, onLoading })
    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
    expect(tiles()[0].src).toContain(`key=${CARTO_KEY}`)

    // One bad tile is a bad tile: nothing changes, and nobody is alarmed yet.
    refuse(N - 1)
    await settle()
    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
    expect(onError).not.toHaveBeenCalled()

    const loadingBefore = onLoading.mock.calls.length
    refuse(1)
    await settle()

    expect(hosts()).toEqual(["tiles.backup.example"])
    expect(container.querySelectorAll(".leaflet-tile-pane .leaflet-layer")).toHaveLength(1)
    for (const tile of tiles()) {
      const url = new URL(tile.src)
      // {z}/{y}/{x}, as the provider's address has them, with its key.
      expect(url.pathname).toMatch(/^\/v1\/streets\/12\/\d+\/\d+$/)
      expect(url.searchParams.get("token")).toBe("browser-key")
    }
    // The dispatcher was never told the background failed: it did not.
    expect(onError).not.toHaveBeenCalled()
    expect(onLoading.mock.calls.length).toBeGreaterThan(loadingBefore)
    // Whose map it is now is said on the map, in words.
    expect(credit()).toContain(BACKUP_CREDIT)
    expect(credit()).not.toContain("CARTO")
    expect(container.querySelector(".leaflet-control-attribution maps")).toBeNull()
  })

  it("a map that has stood open since the morning is refused in the afternoon like any other", async () => {
    tellPage({})
    const onError = vi.fn()
    await mountMap({ onError })
    // The morning: every tile of the screen is drawn.
    serve()
    await settle()
    expect(pending()).toHaveLength(0)

    // The afternoon: CARTO has started refusing; the dispatcher moves the map.
    await moveMap()
    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
    refuse(N)
    await settle()

    expect(hosts()).toEqual(["tiles.backup.example"])
    expect(onError).not.toHaveBeenCalled()
  })

  it("a screen with one tile left from before and the rest refused goes over too", async () => {
    tellPage({})
    await mountMap()
    // One tile comes from the browser's own cache; CARTO refuses every one it is really asked for.
    serve(1)
    refuse(N)
    await settle()

    expect(hosts()).toEqual(["tiles.backup.example"])
  })

  it("stays with CARTO while tiles are being drawn: a few bad ones among many good ones are reported as before", async () => {
    tellPage({})
    const onError = vi.fn()
    await mountMap({ onError })
    serve(N + 2)
    refuse(N)
    await settle()

    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
    expect(onError).toHaveBeenCalledTimes(N)
    expect(basemapFailoverRemembered()).toBe(false)
  })

  it("remembers it for this tab: the next map does not ask CARTO again", async () => {
    tellPage({})
    await mountMap()
    refuse(N)
    await settle()
    expect(hosts()).toEqual(["tiles.backup.example"])

    // Another screen with a map, or «retry» on this one: a new basemap.
    await remount()
    expect(hosts()).toEqual(["tiles.backup.example"])

    // A tab that forgot — or another tab — asks CARTO first.
    forgetBasemapFailover()
    await remount()
    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
  })

  it("half an hour on, a map that is still open asks CARTO again at its next move — and stays if CARTO serves", async () => {
    tellPage({})
    await mountMap()
    refuse(N)
    await settle()
    expect(hosts()).toEqual(["tiles.backup.example"])
    serve()

    // Within the half hour a move asks the backup: nothing is spent on a CARTO that refused a minute ago.
    await moveMap()
    expect(hosts()).toEqual(["tiles.backup.example"])
    serve()

    const later = Date.now() + BASEMAP_FAILOVER_MEMORY_MS + 1
    vi.spyOn(Date, "now").mockReturnValue(later)
    await act(async () => {
      leafletMap!.setView(BAKU, 12, { animate: false })
    })
    await settle()

    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
    serve()
    await settle()
    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
  })

  it("stays with CARTO when the browser itself is offline — the backup would be refused just the same", async () => {
    tellPage({})
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false)
    const onError = vi.fn()
    await mountMap({ onError })
    refuse(N + 1)
    await settle()

    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
    // From the moment it can be told, the map is told: its own «no connection» words depend on it.
    expect(onError).toHaveBeenCalledTimes(2)
    expect(basemapFailoverRemembered()).toBe(false)
  })

  it("lets go of a backup that refuses as well: back to CARTO, the failure is said, and the tab forgets", async () => {
    tellPage({})
    const onError = vi.fn()
    await mountMap({ onError })
    refuse(N)
    await settle()
    expect(hosts()).toEqual(["tiles.backup.example"])
    expect(basemapFailoverRemembered()).toBe(true)

    // The backup's key is wrong, or the network is down though the browser says otherwise.
    refuse(N)
    await settle()
    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
    expect(basemapFailoverRemembered()).toBe(false)
    expect(onError).not.toHaveBeenCalled()

    // Nowhere left to go: from here every refusal is reported and nothing swings back and forth.
    refuse(N + 2)
    await settle()
    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
    expect(onError).toHaveBeenCalledTimes(N + 2)
  })

  it("a screen on which nothing was drawn has not loaded, whatever Leaflet calls it", async () => {
    const onLoad = vi.fn()
    const onError = vi.fn()
    await mountMap({ onLoad, onError })
    // Leaflet fires `load` when every tile has settled — refused ones included.
    refuse(pending().length)
    await settle()
    expect(pending()).toHaveLength(0)
    expect(onError).toHaveBeenCalled()
    expect(onLoad).not.toHaveBeenCalled()

    await moveMap()
    serve(1)
    refuse(pending().length)
    await settle()
    // One tile drawn is a background somebody can see.
    expect(onLoad).toHaveBeenCalled()
  })
})

describe("a deployment that made the backup its background", () => {
  it("draws every map from the backup and does not ask CARTO for a single tile", async () => {
    tellPage({ primary: "backup" })
    await mountMap()

    expect(tiles().length).toBeGreaterThan(4)
    expect(hosts()).toEqual(["tiles.backup.example"])
    expect(credit()).toContain(BACKUP_CREDIT)
  })

  it("does not second-guess the operator: a backup that refuses is reported, and CARTO is still not asked", async () => {
    tellPage({ primary: "backup" })
    const onError = vi.fn()
    await mountMap({ onError })
    refuse(N + 2)
    await settle()

    expect(hosts()).toEqual(["tiles.backup.example"])
    expect(onError).toHaveBeenCalledTimes(N + 2)
  })

  it("asks a provider of 512 px tiles one zoom lower, so its map is not drawn at half the size", async () => {
    tellPage({ primary: "backup", tileSize: 512 })
    await mountMap()

    const asked = tiles()
    expect(asked.length).toBeGreaterThan(0)
    for (const tile of asked) {
      expect(new URL(tile.src).pathname).toMatch(/^\/v1\/streets\/11\/\d+\/\d+$/)
      expect(tile.style.width).toBe("512px")
    }
    // The whole world on one screen would be zoom −1, which no provider has: nothing is asked.
    await act(async () => {
      leafletMap!.setView([0, 0], 0, { animate: false })
    })
    await settle()
    expect(tiles().map((tile) => new URL(tile.src).pathname).filter((path) => path.includes("/-1/"))).toEqual([])

    tellPage({ primary: "backup", tileSize: 256 })
    await remount()
    expect(new URL(tiles()[0].src).pathname).toMatch(/^\/v1\/streets\/12\//)
    expect(tiles()[0].style.width).toBe("256px")
  })

  it("stands in for CARTO's light background too, and leaves another host's picture alone", async () => {
    tellPage({ primary: "backup" })
    const light = liveMapBaseMaps(CARTO_KEY).find((map) => map.id === "light")!.tiles
    await mountMap({ tiles: light })
    expect(hosts()).toEqual(["tiles.backup.example"])

    // «Спутник» is somebody else's imagery: not CARTO's to refuse, not the backup's to replace.
    const satellite = { url: "https://imagery.example/{z}/{x}/{y}.jpg", attribution: "Imagery Co" }
    await mountMap({ tiles: satellite })
    expect(hosts()).toEqual(["imagery.example"])
    expect(credit()).toContain("Imagery Co")
  })

  it("a refused satellite picture is reported and never swapped for the backup", async () => {
    tellPage({})
    const onError = vi.fn()
    await mountMap({ tiles: { url: "https://imagery.example/{z}/{x}/{y}.jpg", attribution: "Imagery Co" }, onError })
    refuse(N + 1)
    await settle()

    expect(hosts()).toEqual(["imagery.example"])
    expect(onError).toHaveBeenCalledTimes(N + 1)
  })

  it("a page told rubbish draws CARTO, as a page told nothing does — and no map is lost to a bad address", async () => {
    for (const url of [
      "http://insecure.example/{z}/{x}/{y}",
      // Pasted with a placeholder left in it: Leaflet would throw while drawing the map.
      "https://tiles.backup.example/{z}/{x}/{y}.png?key={key}",
      "https://tiles.backup.example/{z}/{x}/{y}.png?key={",
    ]) {
      tellPage({ primary: "backup", url })
      await remount()
      expect(hosts(), url).toEqual(["basemaps.cartocdn.com"])
      expect(container.querySelector(".leaflet-container"), url).not.toBeNull()
    }
  })

  it("obeys only what the server wrote into the head: a tag of the same name elsewhere is nobody's", async () => {
    tellPage({ primary: "backup" }, document.body)
    await mountMap()

    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
  })
})

describe("a page that was already open when the operator moved the maps", () => {
  const answer = (primary: "carto" | "backup") => vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe(BASEMAP_PROVIDER_PATH)
    return Response.json({ success: true, data: { primary, backup: { url: BACKUP_URL, attribution: BACKUP_CREDIT, tileSize: 256 } } })
  })

  it("learns it without a reload: the map that stands on the screen goes over where it stands", async () => {
    tellPage({})
    await mountMap()
    serve()
    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
    const mapElement = container.querySelector(".leaflet-container")

    // CARTO now answers every request with «API KEY REQUIRED» tiles — pictures, not errors. The operator moves the maps.
    vi.stubGlobal("fetch", answer("backup"))
    await act(async () => {
      await refreshBasemapProvider(Date.now() + 5 * 60_000)
    })
    await settle()

    expect(hosts()).toEqual(["tiles.backup.example"])
    expect(container.querySelector(".leaflet-container")).toBe(mapElement)
    expect(credit()).toContain(BACKUP_CREDIT)
  })

  it("and goes back the same way when the operator returns the maps to CARTO", async () => {
    tellPage({ primary: "backup" })
    await mountMap()
    expect(hosts()).toEqual(["tiles.backup.example"])

    vi.stubGlobal("fetch", answer("carto"))
    await act(async () => {
      await refreshBasemapProvider(Date.now() + 5 * 60_000)
    })
    await settle()

    expect(hosts()).toEqual(["basemaps.cartocdn.com"])
  })

  it("a page that learns of a backup only now starts watching CARTO from that moment", async () => {
    // Loaded before any backup was named: nothing in its head.
    await mountMap()
    refuse(N)
    await settle()
    expect(hosts()).toEqual(["basemaps.cartocdn.com"])

    vi.stubGlobal("fetch", answer("carto"))
    await act(async () => {
      await refreshBasemapProvider(Date.now() + 5 * 60_000)
    })
    await settle()
    await moveMap()
    refuse(N)
    await settle()

    expect(hosts()).toEqual(["tiles.backup.example"])
  })
})
