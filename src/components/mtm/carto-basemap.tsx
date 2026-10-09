"use client"

import L from "leaflet"
import { useEffect, useRef } from "react"
import { useMap } from "react-leaflet"
import {
  CARTO_VOYAGER_ATTRIBUTION,
  CARTO_VOYAGER_RASTER_SUBDOMAINS,
  CARTO_VOYAGER_RASTER_TILE_URL,
} from "@/lib/carto-basemap"

type CartoBasemapProps = {
  /**
   * Another background than Voyager — the live map's «Светлая», «Тёмная»,
   * «Спутник» (src/lib/mtm/live-map-base-maps.ts). Absent on every other map.
   */
  tiles?: { url: string; attribution: string; subdomains?: string } | null
  onLoading?: () => void
  onLoad?: () => void
  onError?: () => void
}

/**
 * The background of every MTM Leaflet map: CARTO's Voyager raster tiles.
 *
 * Until 2026-10-09 this component tried CARTO's vector style through MapLibre
 * first and mounted these tiles only as its fallback. The vector branch never
 * drew a map in production: its style document sits on the apex host
 * `basemaps.cartocdn.com`, which `https://*.basemaps.cartocdn.com` in
 * connect-src does not admit. Every map view downloaded MapLibre, had one
 * request refused, filed a CSP report and only then showed the tiles below.
 * Raster is what users have always seen, so raster is now all there is.
 *
 * Admitting the apex is NOT the way to bring vector back. Measured the same
 * day against the production bundle: once the style loads, the map goes blank
 * and stays blank. MapLibre 6 looks for its worker file beside
 * `import.meta.url`, webpack compiles that to the build machine's `file://`
 * path, no worker file is published — and a worker that fails to start raises
 * neither `error` nor `load`, so nothing falls back. Vector needs the worker
 * shipped and a watchdog for that silence; it is a feature, not a CSP fix.
 */
export function CartoBasemap({ tiles = null, onLoading, onLoad, onError }: CartoBasemapProps) {
  const map = useMap()
  const callbacksRef = useRef({ onLoading, onLoad, onError })

  useEffect(() => {
    callbacksRef.current = { onLoading, onLoad, onError }
  }, [onError, onLoad, onLoading])

  // By value, not by object: the page hands a new object on every render,
  // and the tiles must not be torn down and asked for again each time.
  const tileUrl = tiles?.url ?? null
  const tileAttribution = tiles?.attribution ?? ""
  const tileSubdomains = tiles?.subdomains ?? null

  useEffect(() => {
    const reportLoading = () => callbacksRef.current.onLoading?.()
    const reportLoad = () => callbacksRef.current.onLoad?.()
    const reportError = () => callbacksRef.current.onError?.()

    reportLoading()
    const layer = L.tileLayer(tileUrl ?? CARTO_VOYAGER_RASTER_TILE_URL, {
      attribution: tileUrl ? tileAttribution : CARTO_VOYAGER_ATTRIBUTION,
      ...(tileUrl
        ? (tileSubdomains ? { subdomains: tileSubdomains } : {})
        : { subdomains: CARTO_VOYAGER_RASTER_SUBDOMAINS }),
    })
    layer.on({
      tileerror: reportError,
      tileload: reportLoad,
      load: reportLoad,
      loading: reportLoading,
    })
    layer.addTo(map)

    return () => {
      layer.remove()
    }
  }, [map, tileUrl, tileAttribution, tileSubdomains])

  return null
}
