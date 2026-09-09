"use client"

import "maplibre-gl/dist/maplibre-gl.css"

import L from "leaflet"
import { useEffect, useRef } from "react"
import { useMap } from "react-leaflet"
import {
  CARTO_VOYAGER_ATTRIBUTION,
  CARTO_VOYAGER_RASTER_TILE_URL,
  CARTO_VOYAGER_VECTOR_STYLE_URL,
  getCartoBasemapRequestUrl,
} from "@/lib/carto-basemap"

type CartoVectorBasemapProps = {
  onLoading?: () => void
  onLoad?: () => void
  onError?: () => void
}

/**
 * Keeps the product's Leaflet overlays and controls while rendering CARTO's
 * current Voyager vector basemap through MapLibre. If a browser cannot start
 * WebGL or the vector style is unavailable, the previous keyed raster layer is
 * mounted as a safe fallback instead of hiding employee GPS information.
 */
export function CartoVectorBasemap({ onLoading, onLoad, onError }: CartoVectorBasemapProps) {
  const map = useMap()
  const callbacksRef = useRef({ onLoading, onLoad, onError })

  useEffect(() => {
    callbacksRef.current = { onLoading, onLoad, onError }
  }, [onError, onLoad, onLoading])

  useEffect(() => {
    let disposed = false
    let vectorLayer: L.Layer | null = null
    let rasterLayer: L.TileLayer | null = null
    let vectorReady = false
    let hasRasterFallback = false
    let vectorAttributionAdded = false
    let removeMaplibreErrorListener: (() => void) | null = null

    const reportLoading = () => callbacksRef.current.onLoading?.()
    const reportLoad = () => callbacksRef.current.onLoad?.()
    const reportError = () => callbacksRef.current.onError?.()

    const mountRasterFallback = () => {
      if (disposed || hasRasterFallback) return
      hasRasterFallback = true
      vectorLayer?.remove()
      vectorLayer = null
      if (vectorAttributionAdded) {
        map.attributionControl?.removeAttribution(CARTO_VOYAGER_ATTRIBUTION)
        vectorAttributionAdded = false
      }
      removeMaplibreErrorListener?.()
      removeMaplibreErrorListener = null

      reportLoading()
      rasterLayer = L.tileLayer(CARTO_VOYAGER_RASTER_TILE_URL, {
        attribution: CARTO_VOYAGER_ATTRIBUTION,
        subdomains: "abcd",
      })
      rasterLayer.on({
        tileerror: reportError,
        tileload: reportLoad,
        load: reportLoad,
        loading: reportLoading,
      })
      rasterLayer.addTo(map)
    }

    reportLoading()
    void import("@maplibre/maplibre-gl-leaflet")
      .then(({ maplibreGL }) => {
        if (disposed) return

        const layer = maplibreGL({
          attributionControl: false,
          style: CARTO_VOYAGER_VECTOR_STYLE_URL,
          transformRequest: (url: string) => ({ url: getCartoBasemapRequestUrl(url) }),
        })
        vectorLayer = layer
        map.attributionControl?.addAttribution(CARTO_VOYAGER_ATTRIBUTION)
        vectorAttributionAdded = true
        layer.addTo(map)

        const maplibreMap = layer.getMaplibreMap()
        const handleMaplibreError = () => {
          if (!vectorReady) mountRasterFallback()
        }
        const handleMaplibreLoad = () => {
          if (disposed || hasRasterFallback) return
          vectorReady = true
          reportLoad()
          map.invalidateSize()
        }

        maplibreMap.on("error", handleMaplibreError)
        maplibreMap.once("load", handleMaplibreLoad)
        removeMaplibreErrorListener = () => maplibreMap.off("error", handleMaplibreError)
      })
      .catch(() => mountRasterFallback())

    return () => {
      disposed = true
      removeMaplibreErrorListener?.()
      vectorLayer?.remove()
      rasterLayer?.remove()
      if (vectorAttributionAdded) {
        map.attributionControl?.removeAttribution(CARTO_VOYAGER_ATTRIBUTION)
      }
    }
  }, [map])

  return null
}
