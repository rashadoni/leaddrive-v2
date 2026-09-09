import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CARTO_VOYAGER_RASTER_TILE_URL,
  CARTO_VOYAGER_VECTOR_STYLE_URL,
  getCartoBasemapRequestUrl,
  getCartoVoyagerRasterTileUrl,
  getCartoVoyagerVectorStyleUrl,
} from "@/lib/carto-basemap"

const rasterBaseUrl =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
const vectorStyleBaseUrl =
  "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"

describe("CARTO basemap configuration", () => {
  it("adds a URL-encoded key without changing the Leaflet tile template", () => {
    expect(getCartoVoyagerRasterTileUrl(" carto key/+ ")).toBe(
      `${rasterBaseUrl}?key=carto%20key%2F%2B`,
    )
  })

  it("adds the key to the vector style and every CARTO sub-request", () => {
    expect(getCartoVoyagerVectorStyleUrl("vector-key")).toBe(
      `${vectorStyleBaseUrl}?key=vector-key`,
    )

    const resourceUrl = getCartoBasemapRequestUrl(
      "https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/12/2385/1538.mvt?lang=en",
      "carto key/+",
    )
    expect(new URL(resourceUrl).searchParams.get("lang")).toBe("en")
    expect(new URL(resourceUrl).searchParams.get("key")).toBe("carto key/+")
  })

  it("never adds the CARTO key to another map provider", () => {
    const openStreetMapUrl = "https://tile.openstreetmap.org/12/2385/1538.png"
    expect(getCartoBasemapRequestUrl(openStreetMapUrl, "vector-key")).toBe(openStreetMapUrl)
  })

  it("retains explicit unconfigured fallbacks for local development", () => {
    expect(getCartoVoyagerRasterTileUrl("")).toBe(rasterBaseUrl)
    expect(getCartoVoyagerVectorStyleUrl("")).toBe(vectorStyleBaseUrl)
    expect(CARTO_VOYAGER_RASTER_TILE_URL).toMatch(/^https:\/\/\{s\}\.basemaps\.cartocdn\.com\//)
    expect(CARTO_VOYAGER_VECTOR_STYLE_URL).toMatch(/^https:\/\/basemaps\.cartocdn\.com\/gl\//)
  })

  it("uses the shared vector layer in every MTM Leaflet map", () => {
    for (const filename of [
      "src/components/mtm/live-map.tsx",
      "src/components/mtm/route-map.tsx",
      "src/components/mtm/location-history-map.tsx",
      "src/components/mtm/location-picker-map.tsx",
    ]) {
      const source = readFileSync(resolve(filename), "utf8")
      expect(source).toContain('from "./carto-vector-basemap"')
      expect(source).toContain("<CartoVectorBasemap")
      expect(source).not.toContain("<TileLayer")
    }
  })

  it("keeps all CARTO vector resources out of the service worker cache", () => {
    const serviceWorker = readFileSync(resolve("src/sw.ts"), "utf8")
    expect(serviceWorker).toContain("rastertiles|vector|gl|fonts")
    expect(serviceWorker).toContain("new NetworkOnly()")
  })
})
