import {
  CARTO_VOYAGER_ATTRIBUTION,
  CARTO_VOYAGER_RASTER_SUBDOMAINS,
  cartoBasemapsApiKey,
} from "@/lib/carto-basemap"

/**
 * The backgrounds the live map can be drawn on.
 *
 * Owner, 2026-10-09, of the tracking product shown to him as the model («бери
 * почти всё, чего у нас нет», then «добей до 100 %»): there the map's look is
 * switched on the map itself — a scheme, a light one, a dark one, a satellite
 * picture. Ours had one.
 *
 * «Карта» is CARTO Voyager, what every MTM map has always shown; «Светлая»
 * is CARTO's quiet light background, served by the same hosts under the same
 * key (checked from the production origin, 2026-10-09). There is no dark
 * one: it shipped for a few hours and the owner, seeing it the same night,
 * said «не нужна тёмная карта». A browser that remembered it comes back to
 * «Карта».
 *
 * A satellite picture is somebody else's imagery and needs a contract of its
 * own: it is offered only where the build was given a tile address for it —
 * until then the choice is simply not there, never a grey square.
 *
 * Pure: no React, no Leaflet.
 */

export const LIVE_MAP_BASE_MAP_IDS = ["voyager", "light", "satellite"] as const
export type LiveMapBaseMapId = typeof LIVE_MAP_BASE_MAP_IDS[number]
export const DEFAULT_LIVE_MAP_BASE_MAP: LiveMapBaseMapId = "voyager"

export interface LiveMapBaseMapTiles {
  url: string
  /** HTML, as Leaflet's attribution control takes it. */
  attribution: string
  /** The hosts `{s}` stands for; absent when the address has none. */
  subdomains?: string
}

export interface LiveMapBaseMap {
  id: LiveMapBaseMapId
  /** Null for the default: the map then draws what it has always drawn. */
  tiles: LiveMapBaseMapTiles | null
}

const CARTO_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** A tile address a browser can be sent to: https, with the three places Leaflet fills in. */
function satelliteTileUrl(raw: string | null | undefined): string | null {
  const url = raw?.trim() ?? ""
  if (!url.startsWith("https://")) return null
  return ["{z}", "{x}", "{y}"].every((part) => url.includes(part)) ? url : null
}

/**
 * The backgrounds this build can offer, in the order they are offered.
 *
 * The environment is read as literal default parameters: a `NEXT_PUBLIC_`
 * value is put into the bundle only where it is named in full.
 */
export function liveMapBaseMaps(
  cartoKey: string | null = cartoBasemapsApiKey(),
  satelliteUrl: string | null | undefined = process.env.NEXT_PUBLIC_MTM_SATELLITE_TILE_URL,
  satelliteAttribution: string | null | undefined = process.env.NEXT_PUBLIC_MTM_SATELLITE_TILE_ATTRIBUTION,
): LiveMapBaseMap[] {
  const carto = (url: string): LiveMapBaseMapTiles => ({
    url: cartoKey ? `${url}?key=${encodeURIComponent(cartoKey)}` : url,
    attribution: CARTO_VOYAGER_ATTRIBUTION,
    subdomains: CARTO_VOYAGER_RASTER_SUBDOMAINS,
  })
  const maps: LiveMapBaseMap[] = [
    { id: "voyager", tiles: null },
    { id: "light", tiles: carto(CARTO_LIGHT) },
  ]
  const satellite = satelliteTileUrl(satelliteUrl)
  if (satellite) {
    maps.push({
      id: "satellite",
      // Whose picture it is must be said on the map; the words come from the
      // deployment's settings and are shown as text, never as markup.
      tiles: { url: satellite, attribution: escapeHtml(satelliteAttribution?.trim() ?? "") },
    })
  }
  return maps
}

/** What was remembered, if this build still offers it; otherwise the map everybody knows. */
export function parseLiveMapBaseMap(value: unknown, offered: readonly LiveMapBaseMap[]): LiveMapBaseMapId {
  return offered.find((map) => map.id === value)?.id ?? DEFAULT_LIVE_MAP_BASE_MAP
}
