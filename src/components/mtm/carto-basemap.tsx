"use client"

import L from "leaflet"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useMap } from "react-leaflet"
import {
  CARTO_VOYAGER_ATTRIBUTION,
  CARTO_VOYAGER_RASTER_SUBDOMAINS,
  CARTO_VOYAGER_RASTER_TILE_URL,
  isCartoTileUrl,
} from "@/lib/carto-basemap"
import {
  BASEMAP_FAILOVER_AFTER_REFUSALS,
  basemapBackupTiles,
  basemapFailoverRemembered,
  forgetBasemapFailover,
  rememberBasemapFailover,
} from "@/lib/mtm/basemap-provider"
import {
  basemapProviderServerSnapshot,
  basemapProviderSnapshot,
  refreshBasemapProvider,
  subscribeBasemapProvider,
} from "@/lib/mtm/basemap-provider-store"

type CartoBasemapProps = {
  /**
   * Another background than Voyager — the live map's «Светлая», «Спутник»
   * (src/lib/mtm/live-map-base-maps.ts). Absent on every other map.
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
 *
 * CARTO's tiles can be refused — its free service may be limited or cut off
 * without warning (src/lib/mtm/basemap-provider.ts). Where the deployment
 * names a backup provider:
 *
 *  - a map whose CARTO tiles are refused draws the backup's instead, by
 *    itself — also a map that has stood open since the morning; half an hour
 *    later it asks CARTO again;
 *  - where the deployment says the backup is the background, CARTO is not
 *    asked at all — and a map that is already open learns it without a reload
 *    (src/lib/mtm/basemap-provider-store.ts);
 *  - a backup that refuses as well is let go: the map returns to CARTO and
 *    says the background failed, as it always did.
 *
 * With no backup named nothing here differs from what it was, except one
 * thing that was wrong before: a screen on which every single tile was
 * refused used to be reported as loaded (Leaflet's `load` means «all tiles
 * settled», refused ones included), and the live map's «фон недоступен» never
 * appeared for the one case it was written for.
 */
export function CartoBasemap({ tiles = null, onLoading, onLoad, onError }: CartoBasemapProps) {
  const map = useMap()
  const callbacksRef = useRef({ onLoading, onLoad, onError })
  const provider = useSyncExternalStore(subscribeBasemapProvider, basemapProviderSnapshot, basemapProviderServerSnapshot)
  const [cartoRefused, setCartoRefused] = useState(() => basemapFailoverRemembered())
  // The backup refused too: for this map there is nowhere left to go, and it stops looking.
  const [backupRefused, setBackupRefused] = useState(false)

  useEffect(() => {
    callbacksRef.current = { onLoading, onLoad, onError }
  }, [onError, onLoad, onLoading])

  // A page that has been open for a while asks what the deployment says now.
  useEffect(() => {
    void refreshBasemapProvider()
  }, [])

  // By value, not by object: the page hands a new object on every render,
  // and the tiles must not be torn down and asked for again each time.
  const tileUrl = tiles?.url ?? null
  const tileAttribution = tiles?.attribution ?? ""
  const tileSubdomains = tiles?.subdomains ?? null

  // The backup stands in for CARTO's tiles only: a satellite picture from
  // another host is somebody else's to serve or refuse.
  const cartoAsked = tileUrl == null || isCartoTileUrl(tileUrl)
  const backup = provider.backup && cartoAsked ? provider.backup : null
  const backupIsBackground = backup != null && provider.primary === "backup"
  const drawBackup = backup != null && (backupIsBackground || (cartoRefused && !backupRefused))
  const backupUrl = backup?.url ?? null
  const backupAttribution = backup?.attribution ?? ""
  const backupTileSize = backup?.tileSize ?? 256

  useEffect(() => {
    const reportLoading = () => callbacksRef.current.onLoading?.()
    const reportLoad = () => callbacksRef.current.onLoad?.()
    const reportError = () => callbacksRef.current.onError?.()

    reportLoading()
    const layer = drawBackup && backupUrl
      ? (() => {
        const stand = basemapBackupTiles({ url: backupUrl, attribution: backupAttribution, tileSize: backupTileSize })
        return L.tileLayer(stand.url, {
          attribution: stand.attribution,
          // A provider of 512 px tiles is asked one zoom lower, or its map is
          // drawn at half the size; the whole world on one screen would then
          // be zoom −1, which no provider has.
          ...(stand.tileSize === 512 ? { tileSize: 512, zoomOffset: -1, minZoom: 1 } : {}),
        })
      })()
      : L.tileLayer(tileUrl ?? CARTO_VOYAGER_RASTER_TILE_URL, {
        attribution: tileUrl ? tileAttribution : CARTO_VOYAGER_ATTRIBUTION,
        ...(tileUrl
          ? (tileSubdomains ? { subdomains: tileSubdomains } : {})
          : { subdomains: CARTO_VOYAGER_RASTER_SUBDOMAINS }),
      })

    // CARTO is watched only where there is somewhere to go, and the backup
    // only where it stands in for a CARTO that refused (the operator's own
    // choice of background is not second-guessed).
    const mayGoOver = backupUrl != null && !drawBackup && !backupRefused
    const mayGoBack = drawBackup && !backupIsBackground
    // Counted for what is on the screen now: a map that drew its tiles in the
    // morning is refused in the afternoon like any other.
    let drawn = 0
    let refused = 0
    let refusedInARow = 0
    layer.on({
      loading: () => {
        drawn = 0
        refused = 0
        refusedInARow = 0
        // Half an hour on, at a moment the map is about to ask for tiles anyway: CARTO first again.
        if (mayGoBack && !basemapFailoverRemembered()) {
          setCartoRefused(false)
          return
        }
        reportLoading()
      },
      tileload: () => {
        drawn += 1
        refusedInARow = 0
        reportLoad()
      },
      tileerror: () => {
        refused += 1
        refusedInARow += 1
        // Several in a row and more than were drawn is a refusal of service,
        // not a bad tile. A browser that is simply offline is refused by
        // everybody — it stays where it is.
        const refusal = refusedInARow >= BASEMAP_FAILOVER_AFTER_REFUSALS && refused > drawn
        if (mayGoOver && refusal && (typeof navigator === "undefined" || navigator.onLine !== false)) {
          rememberBasemapFailover()
          setCartoRefused(true)
          return
        }
        if (mayGoBack && refusal && drawn === 0) {
          forgetBasemapFailover()
          setBackupRefused(true)
          return
        }
        // Nothing drawn yet and too early to say which it is: the map that
        // mounted this one is told when it can be told something true.
        if ((mayGoOver || mayGoBack) && drawn === 0 && refused < BASEMAP_FAILOVER_AFTER_REFUSALS) return
        reportError()
      },
      // Leaflet says «load» when every tile has settled — refused ones too.
      // A screen on which nothing was drawn has not loaded.
      load: () => {
        if (drawn > 0) reportLoad()
      },
    })
    layer.addTo(map)

    return () => {
      layer.remove()
    }
  }, [map, tileUrl, tileAttribution, tileSubdomains, drawBackup, backupUrl, backupAttribution, backupTileSize, backupIsBackground, backupRefused])

  return null
}
