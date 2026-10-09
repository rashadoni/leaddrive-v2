import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CARTO_VOYAGER_RASTER_SUBDOMAINS,
  CARTO_VOYAGER_RASTER_TILE_URL,
  getCartoVoyagerRasterTileUrl,
} from "@/lib/carto-basemap"

const rasterBaseUrl =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"

/** A tile as Leaflet asks for it: the template with one host, one address and the retina suffix filled in. */
const tileUrl = (template: string, subdomain: string, retina = "") =>
  template
    .replace("{s}", subdomain)
    .replace("{z}", "12")
    .replace("{x}", "2615")
    .replace("{y}", "1552")
    .replace("{r}", retina)

describe("CARTO basemap configuration", () => {
  it("adds a URL-encoded key without changing the Leaflet tile template", () => {
    expect(getCartoVoyagerRasterTileUrl(" carto key/+ ")).toBe(
      `${rasterBaseUrl}?key=carto%20key%2F%2B`,
    )
  })

  it("retains an explicit unconfigured fallback for local development", () => {
    expect(getCartoVoyagerRasterTileUrl("")).toBe(rasterBaseUrl)
    expect(CARTO_VOYAGER_RASTER_TILE_URL).toMatch(/^https:\/\/\{s\}\.basemaps\.cartocdn\.com\//)
  })

  it("uses the shared basemap in every MTM Leaflet map", () => {
    for (const filename of [
      "src/components/mtm/live-map.tsx",
      "src/components/mtm/route-map.tsx",
      "src/components/mtm/location-history-map.tsx",
      "src/components/mtm/location-picker-map.tsx",
    ]) {
      const source = readFileSync(resolve(filename), "utf8")
      expect(source).toContain('from "./carto-basemap"')
      expect(source).toContain("<CartoBasemap")
      expect(source).not.toContain("<TileLayer")
    }
  })

  it("keeps every tile the basemap asks for out of the service worker cache", () => {
    const serviceWorker = readFileSync(resolve("src/sw.ts"), "utf8")
    const rule = serviceWorker.match(/matcher: \/(\^https:.+)\/i,\s+handler: new NetworkOnly\(\)/)
    expect(rule, "the map-tile rule in src/sw.ts").not.toBeNull()
    const networkOnly = new RegExp(rule![1], "i")

    const template = getCartoVoyagerRasterTileUrl("referrer-key")
    for (const subdomain of CARTO_VOYAGER_RASTER_SUBDOMAINS) {
      expect(networkOnly.test(tileUrl(template, subdomain)), subdomain).toBe(true)
      expect(networkOnly.test(tileUrl(template, subdomain, "@2x")), `${subdomain} @2x`).toBe(true)
    }
    expect(networkOnly.test("https://a.tile.openstreetmap.org/12/2615/1552.png")).toBe(true)
    // The live map's light and dark backgrounds are tiles like any other: never from the worker's cache.
    expect(networkOnly.test("https://b.basemaps.cartocdn.com/light_all/12/2615/1552@2x.png?key=referrer-key")).toBe(true)
    expect(networkOnly.test("https://c.basemaps.cartocdn.com/dark_all/12/2615/1552.png?key=referrer-key")).toBe(true)
    expect(networkOnly.test("https://app.leaddrivecrm.org/api/v1/ping")).toBe(false)
  })

  // The vector basemap was removed on 2026-10-09 (see carto-basemap.tsx): it
  // had never drawn a map in production, and admitting its style document in
  // the policy would have left every map blank. Bringing MapLibre back is a
  // feature with its own worker file and its own failure handling — not a
  // dependency to re-add beside the raster layer.
  it("ships no second renderer for the basemap to fall back from", () => {
    const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
    expect(installed.filter((name) => /maplibre|mapbox-gl/.test(name))).toEqual([])

    const basemap = readFileSync(resolve("src/components/mtm/carto-basemap.tsx"), "utf8")
    expect(basemap).not.toMatch(/\bimport\(/)
  })
})
