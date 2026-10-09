const CARTO_VOYAGER_RASTER_BASE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"

/** The tile hosts `{s}` stands for; Leaflet rotates through them. */
export const CARTO_VOYAGER_RASTER_SUBDOMAINS = "abcd"

export const CARTO_VOYAGER_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

/**
 * CARTO uses a browser-facing basemap key. It is intentionally a `NEXT_PUBLIC_`
 * setting: map requests originate in the browser and CARTO keys are restricted
 * by allowed referrer.
 */
export function getCartoVoyagerRasterTileUrl(
  apiKey = process.env.NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY,
) {
  const key = apiKey?.trim()
  return key
    ? `${CARTO_VOYAGER_RASTER_BASE_URL}?key=${encodeURIComponent(key)}`
    : CARTO_VOYAGER_RASTER_BASE_URL
}

/**
 * The raw key for clients that build their own CARTO tile URLs, such as the
 * field app's WebView maps (mobile bootstrap `maps.cartoBasemapsApiKey`).
 * Null when the build was made without a key.
 */
export function cartoBasemapsApiKey(
  apiKey = process.env.NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY,
): string | null {
  const key = apiKey?.trim()
  return key ? key : null
}

export const CARTO_VOYAGER_RASTER_TILE_URL = getCartoVoyagerRasterTileUrl()
