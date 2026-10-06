/**
 * Address search for the organization's location picker.
 *
 * Owner, 2026-10-06, looking at the picker that only took a click on the map:
 * «нужен тут поиск — по месту, где я сейчас, и по адресу, который я буду
 * писать, и потом чтобы можно было корректировать». The address half is this
 * file: one typed address in, a handful of candidate points out. The manager
 * then corrects the pin by hand, so a result that is a building or two off is
 * a starting point, not a defect.
 *
 * The search is OpenStreetMap's Nominatim, the same data the map is drawn
 * from. Its public service is free and has rules this file exists to keep:
 * the application names itself, sends at most one request a second, never
 * searches as the user types, and remembers what it already asked. Only the
 * typed address and a rough map area leave the server — no organization, no
 * user, no client record.
 *
 * Nominatim wants the street spelled the way the map spells it. The first
 * real card tried on production the same evening had «Yasamal r-nu, Hasanbay
 * Zardabi küçəsi 79B, Yasamal, Bakı» — the map knows that street as «Həsən
 * bəy Zərdabi prospekti» — and the search found nothing. So when the exact
 * search finds nothing, the address is stripped to what identifies it (names,
 * house number, city — no «küçəsi», no «r-nu», nothing twice) and asked of
 * Photon, a second free search over the same OpenStreetMap data that forgives
 * spelling. Photon alone would not do: it sent a Cyrillic Baku address to
 * Arkhangelsk, which Nominatim reads correctly — hence the order, and the
 * rule that a forgiving match far from the map is not a match.
 */

export interface GeocodeHit {
  label: string
  latitude: number
  longitude: number
}

export interface GeocodeQuery {
  /** What the manager typed, already trimmed. */
  query: string
  /** Language of the labels that come back. */
  language: string
  /** The middle of the map the manager is looking at: nearby places first. */
  near?: { latitude: number; longitude: number } | null
}

export type GeocodeResult = { ok: true; hits: GeocodeHit[] } | { ok: false }

export const GEOCODE_QUERY_MIN = 3
export const GEOCODE_QUERY_MAX = 200
export const GEOCODE_MAX_HITS = 5

const ENDPOINT = "https://nominatim.openstreetmap.org/search"
const FORGIVING_ENDPOINT = "https://photon.komoot.io/api/"
/** A forgiving match further than this from the map is a coincidence of words. */
const FORGIVING_MAX_DISTANCE_KM = 1_000
const USER_AGENT = "LeadDriveCRM/1.0 (+https://leaddrivecrm.org)"
const TIMEOUT_MS = 6_000
/** The public service asks for no more than one request a second. */
const MIN_SPACING_MS = 1_100
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const CACHE_MAX = 500
/** Half the side of the «nearby» box, in degrees: roughly a city and its suburbs. */
const NEAR_BOX_DEGREES = 0.5

const cache = new Map<string, { at: number; hits: GeocodeHit[] }>()
let queue: Promise<void> = Promise.resolve()
let lastRequestAt = 0

export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === "number" && typeof longitude === "number"
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    // (0, 0) is how an unset pair looks, not a place anyone is searching near.
    && !(latitude === 0 && longitude === 0)
}

export function buildGeocodeUrl({ query, language, near }: GeocodeQuery): string {
  const url = new URL(ENDPOINT)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("q", query)
  url.searchParams.set("limit", String(GEOCODE_MAX_HITS))
  url.searchParams.set("accept-language", language)
  if (near && isValidCoordinate(near.latitude, near.longitude)) {
    // A preference, not a fence (`bounded=0`): an address in another city is
    // still found, it just does not outrank the street of the same name here.
    const round = (value: number) => value.toFixed(3)
    url.searchParams.set("viewbox", [
      round(Math.max(-180, near.longitude - NEAR_BOX_DEGREES)),
      round(Math.min(90, near.latitude + NEAR_BOX_DEGREES)),
      round(Math.min(180, near.longitude + NEAR_BOX_DEGREES)),
      round(Math.max(-90, near.latitude - NEAR_BOX_DEGREES)),
    ].join(","))
    url.searchParams.set("bounded", "0")
  }
  return url.toString()
}

/** Whatever came back, only well-formed places leave this function. */
export function parseGeocodeResponse(raw: unknown): GeocodeHit[] {
  if (!Array.isArray(raw)) return []
  const hits: GeocodeHit[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const place = item as { lat?: unknown; lon?: unknown; display_name?: unknown }
    const latitude = typeof place.lat === "string" || typeof place.lat === "number" ? Number(place.lat) : NaN
    const longitude = typeof place.lon === "string" || typeof place.lon === "number" ? Number(place.lon) : NaN
    const label = typeof place.display_name === "string" ? place.display_name.trim().slice(0, 300) : ""
    if (!label || !isValidCoordinate(latitude, longitude)) continue
    hits.push({
      label,
      latitude: Math.round(latitude * 1_000_000) / 1_000_000,
      longitude: Math.round(longitude * 1_000_000) / 1_000_000,
    })
    if (hits.length === GEOCODE_MAX_HITS) break
  }
  return hits
}

/**
 * Words that say what kind of thing a name is, not which one: a street, an
 * avenue, a district, a city, a house. The map spells them its own way
 * («prospekti» where the card says «küçəsi»), so the forgiving search goes
 * without them.
 */
const KIND_WORDS = new Set([
  // Azerbaijani
  "küçəsi", "küçə", "küç", "kucesi", "kuce", "kuc", "prospekti", "prospekt", "pros", "pr", "döngəsi", "döngə",
  "dalanı", "dalan", "şossesi", "şosse", "meydanı", "meydan", "rayonu", "rayon", "ray", "r-nu", "r-n",
  "şəhəri", "şəhər", "şəh", "qəsəbəsi", "qəsəbə", "qəs", "kəndi", "kənd", "ev", "bina", "mənzil",
  // Russian
  "улица", "ул", "проспект", "пр", "пр-т", "просп", "переулок", "пер", "шоссе", "площадь", "пл",
  "район", "р-н", "р-он", "город", "г", "посёлок", "поселок", "пос", "дом", "д", "корпус", "корп",
  // English
  "street", "str", "st", "avenue", "ave", "road", "rd", "district", "city", "building", "bldg",
])

/**
 * The address reduced to what identifies it, for the forgiving search:
 * «Yasamal r-nu, Hasanbay Zardabi küçəsi 79B, Yasamal, Bakı» →
 * «Yasamal Hasanbay Zardabi 79B Bakı».
 */
export function simplifyAddressQuery(query: string): string {
  const seen = new Set<string>()
  const words: string[] = []
  for (const raw of query.split(/[\s,;]+/)) {
    const word = raw.replace(/^[.()«»"']+|[.()«»"']+$/g, "")
    if (!word) continue
    const key = word.toLocaleLowerCase()
    if (KIND_WORDS.has(key) || seen.has(key)) continue
    seen.add(key)
    words.push(word)
  }
  return words.join(" ")
}

export function buildForgivingUrl({ query, near }: Pick<GeocodeQuery, "query" | "near">): string {
  const url = new URL(FORGIVING_ENDPOINT)
  url.searchParams.set("q", query)
  url.searchParams.set("limit", String(GEOCODE_MAX_HITS))
  if (near && isValidCoordinate(near.latitude, near.longitude)) {
    url.searchParams.set("lat", near.latitude.toFixed(3))
    url.searchParams.set("lon", near.longitude.toFixed(3))
  }
  return url.toString()
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(b.latitude - a.latitude)
  const dLon = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 6_371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The forgiving search answers in GeoJSON; the picker gets the same points either way. */
export function parseForgivingResponse(raw: unknown, near?: GeocodeQuery["near"]): GeocodeHit[] {
  const features = raw && typeof raw === "object" ? (raw as { features?: unknown }).features : null
  if (!Array.isArray(features)) return []
  const origin = near && isValidCoordinate(near.latitude, near.longitude) ? near : null
  const hits: GeocodeHit[] = []
  for (const item of features) {
    if (!item || typeof item !== "object") continue
    const feature = item as { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }
    const coordinates = feature.geometry?.coordinates
    if (!Array.isArray(coordinates)) continue
    const longitude = typeof coordinates[0] === "number" ? coordinates[0] : NaN
    const latitude = typeof coordinates[1] === "number" ? coordinates[1] : NaN
    if (!isValidCoordinate(latitude, longitude)) continue
    if (origin && distanceKm(origin, { latitude, longitude }) > FORGIVING_MAX_DISTANCE_KM) continue
    const text = (key: string) => {
      const value = feature.properties?.[key]
      return typeof value === "string" ? value.trim() : ""
    }
    const street = [text("street"), text("housenumber")].filter(Boolean).join(" ")
    const parts = [text("name"), street, text("district"), text("city"), text("country")]
      .filter((part, index, all) => part && all.indexOf(part) === index)
    const label = parts.join(", ").slice(0, 300)
    if (!label) continue
    hits.push({
      label,
      latitude: Math.round(latitude * 1_000_000) / 1_000_000,
      longitude: Math.round(longitude * 1_000_000) / 1_000_000,
    })
    if (hits.length === GEOCODE_MAX_HITS) break
  }
  return hits
}

function cacheKey({ query, language, near }: GeocodeQuery): string {
  const area = near && isValidCoordinate(near.latitude, near.longitude)
    ? `${near.latitude.toFixed(1)},${near.longitude.toFixed(1)}`
    : "-"
  return `${language}|${area}|${query.toLowerCase()}`
}

/** One request at a time, a second apart — whoever asks. */
function takeTurn(now: () => number, sleep: (ms: number) => Promise<void>): Promise<void> {
  const turn = queue.then(async () => {
    const wait = lastRequestAt + MIN_SPACING_MS - now()
    if (wait > 0) await sleep(wait)
    lastRequestAt = now()
  })
  queue = turn.catch(() => undefined)
  return turn
}

export interface GeocodeDeps {
  fetch: typeof fetch
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const defaultDeps: GeocodeDeps = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** One question to one service. `null` = it did not answer. */
async function ask(url: string, deps: GeocodeDeps): Promise<unknown | null> {
  try {
    await takeTurn(deps.now, deps.sleep)
    const response = await deps.fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return response.ok ? await response.json() : null
  } catch (error) {
    console.warn("[MTM/geocode] address search failed", error instanceof Error ? error.name : "unknown")
    return null
  }
}

export async function geocodeAddress(input: GeocodeQuery, deps: GeocodeDeps = defaultDeps): Promise<GeocodeResult> {
  const key = cacheKey(input)
  const cached = cache.get(key)
  if (cached && deps.now() - cached.at < CACHE_TTL_MS) return { ok: true, hits: cached.hits }

  const remember = (hits: GeocodeHit[]): GeocodeResult => {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(key, { at: deps.now(), hits })
    return { ok: true, hits }
  }

  // The address as typed, read exactly.
  const exact = await ask(buildGeocodeUrl(input), deps)
  const exactHits = exact === null ? [] : parseGeocodeResponse(exact)
  if (exactHits.length > 0) return remember(exactHits)

  // Nothing — or no answer: what identifies the address, read forgivingly.
  const simpler = simplifyAddressQuery(input.query)
  const forgiving = simpler.length >= GEOCODE_QUERY_MIN
    ? await ask(buildForgivingUrl({ query: simpler, near: input.near }), deps)
    : null
  const forgivingHits = forgiving === null ? [] : parseForgivingResponse(forgiving, input.near)
  if (forgivingHits.length > 0) return remember(forgivingHits)

  if (exact === null && forgiving === null) return { ok: false }
  // «Nothing found» is remembered only when both services said so: one that
  // was down a minute ago may well know the address.
  return exact !== null && forgiving !== null ? remember([]) : { ok: true, hits: [] }
}

/** Tests only: forget what was asked and when. */
export function resetGeocodeStateForTests(): void {
  cache.clear()
  queue = Promise.resolve()
  lastRequestAt = 0
}
