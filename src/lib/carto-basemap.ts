const CARTO_VOYAGER_RASTER_BASE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"

const CARTO_VOYAGER_VECTOR_STYLE_BASE_URL =
  "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"

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
 * Vector styles refer to further CARTO resources (TileJSON, vector tiles,
 * glyphs and sprites). MapLibre applies this helper through transformRequest
 * so the referrer-restricted key reaches every CARTO resource, not only the
 * initial style document.
 */
export function getCartoBasemapRequestUrl(
  url: string,
  apiKey = process.env.NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY,
) {
  const key = apiKey?.trim()
  if (!key) return url

  if (url.includes("{")) {
    if (!/^https:\/\/\{s\}\.basemaps\.cartocdn\.com\//.test(url)) return url
    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}key=${encodeURIComponent(key)}`
  }

  try {
    const parsed = new URL(url)
    const isCartoBasemap = parsed.protocol === "https:" &&
      (parsed.hostname === "basemaps.cartocdn.com" ||
        parsed.hostname.endsWith(".basemaps.cartocdn.com"))
    if (!isCartoBasemap) return url

    parsed.searchParams.set("key", key)
    return parsed.toString()
  } catch {
    return url
  }
}

export function getCartoVoyagerVectorStyleUrl(
  apiKey = process.env.NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY,
) {
  return getCartoBasemapRequestUrl(CARTO_VOYAGER_VECTOR_STYLE_BASE_URL, apiKey)
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
export const CARTO_VOYAGER_VECTOR_STYLE_URL = getCartoVoyagerVectorStyleUrl()
