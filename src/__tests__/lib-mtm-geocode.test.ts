/**
 * Address search behind the organization's map picker.
 *
 * Owner, 2026-10-06: «нужен тут поиск … по адресу, который я буду писать».
 * The search goes to OpenStreetMap's public service, which is free on
 * conditions: the application names itself, asks at most once a second, and
 * does not ask twice for what it already knows. These tests hold the library
 * to that, and to never handing the picker a point that is not one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildForgivingUrl,
  buildGeocodeUrl,
  buildReverseUrl,
  geocodeAddress,
  parseForgivingResponse,
  parseGeocodeResponse,
  parseReverseResponse,
  resetGeocodeStateForTests,
  reverseGeocode,
  simplifyAddressQuery,
  type GeocodeDeps,
} from "@/lib/mtm/geocode"

/** What the service answers for a street in the city the manager is looking at. */
const upstream = [
  { lat: "40.3978284", lon: "49.8169901", display_name: "Tbilisi prospekti, Yasamal, Bakı, Azərbaycan", importance: 0.4 },
  { lat: "40.4093", lon: "49.8671", display_name: "Bakı, Azərbaycan" },
]

/** What the forgiving service answers for the same building, spelled the map's way. */
const forgivingUpstream = {
  type: "FeatureCollection",
  features: [
    {
      geometry: { type: "Point", coordinates: [49.805225, 40.399929] },
      properties: { name: "Milli Onkologiya Mərkəzi", street: "Həsən bəy Zərdabi prospekti", housenumber: "79B", district: "Yasamal rayonu", city: "Bakı", country: "Azərbaycan" },
    },
    {
      geometry: { type: "Point", coordinates: [49.80475, 40.40019] },
      properties: { street: "Həsən bəy Zərdabi pr.", housenumber: "79b", city: "Bakı", country: "Azərbaycan" },
    },
  ],
}
const BAKU = { latitude: 40.4093, longitude: 49.8671 }

type Answer = { ok: boolean; status: number; json: () => Promise<unknown> }
const json = (body: unknown): Answer => ({ ok: true, status: 200, json: async () => body })
const down = (): Answer => ({ ok: false, status: 503, json: async () => ({}) })

let clock = 1_000_000
let slept: number[] = []
/** How long each request was given before the library would give up on it. */
let patience: number[] = []
let calls: { url: URL; headers: Record<string, string> }[] = []
/** The exact service; the forgiving one answers «nothing» unless a test says otherwise. */
let answer: () => Answer
let forgivingAnswer: () => Answer
const asked = () => calls.map((call) => call.url.hostname)

const deps: GeocodeDeps = {
  now: () => clock,
  sleep: async (ms) => { slept.push(ms); clock += ms },
  timeout: (ms) => { patience.push(ms); return new AbortController().signal },
  fetch: (async (input: string, init?: { headers?: Record<string, string> }) => {
    const url = new URL(String(input))
    calls.push({ url, headers: init?.headers ?? {} })
    return url.hostname === "photon.komoot.io" ? forgivingAnswer() : answer()
  }) as unknown as typeof fetch,
}

beforeEach(() => {
  resetGeocodeStateForTests()
  clock = 1_000_000
  slept = []
  patience = []
  calls = []
  answer = () => json(upstream)
  forgivingAnswer = () => json({ type: "FeatureCollection", features: [] })
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("address search — what is asked", () => {
  it("asks for the typed address, in the manager's language, at most five places", () => {
    const url = new URL(buildGeocodeUrl({ query: "Tbilisi prospekti 10", language: "az" }))
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: "jsonv2", q: "Tbilisi prospekti 10", limit: "5", "accept-language": "az",
    })
  })

  it("prefers places near what the manager is looking at, without fencing the search in", () => {
    const url = new URL(buildGeocodeUrl({ query: "Nizami 5", language: "ru", near: { latitude: 40.4, longitude: 49.8 } }))
    // left, top, right, bottom — and a preference only.
    expect(url.searchParams.get("viewbox")).toBe("49.300,40.900,50.300,39.900")
    expect(url.searchParams.get("bounded")).toBe("0")
  })

  it("does not search «near» a pair that is no place: unset, or off the globe", () => {
    const urls = [
      { latitude: 0, longitude: 0 },
      { latitude: 91, longitude: 10 },
      { latitude: Number.NaN, longitude: 10 },
    ].map((near) => new URL(buildGeocodeUrl({ query: "Nizami 5", language: "ru", near })))
    expect(urls.filter((url) => url.searchParams.has("viewbox"))).toEqual([])
  })
})

describe("address search — what comes back", () => {
  it("turns the answer into points the picker can place", () => {
    expect(parseGeocodeResponse(upstream)).toEqual([
      { label: "Tbilisi prospekti, Yasamal, Bakı, Azərbaycan", latitude: 40.397828, longitude: 49.81699 },
      { label: "Bakı, Azərbaycan", latitude: 40.4093, longitude: 49.8671 },
    ])
  })

  it("drops whatever is not a named point on the globe, and stops at five", () => {
    const junk = [
      null, "x", {},
      { lat: "abc", lon: "49.8", display_name: "No latitude" },
      { lat: "95", lon: "49.8", display_name: "Off the globe" },
      { lat: "0", lon: "0", display_name: "Null Island" },
      { lat: "40.4", lon: "49.8", display_name: "   " },
      { lat: "40.4", lon: "49.8" },
    ]
    expect(parseGeocodeResponse(junk)).toEqual([])
    expect(parseGeocodeResponse({ error: "Unable to geocode" })).toEqual([])
    const many = Array.from({ length: 9 }, (_item, index) => ({ lat: "40.4", lon: String(49 + index / 10), display_name: `Place ${index}` }))
    expect(parseGeocodeResponse(many).map((hit) => hit.label)).toEqual(["Place 0", "Place 1", "Place 2", "Place 3", "Place 4"])
  })
})

describe("address search — the rules of the free service", () => {
  it("names the application on every request", async () => {
    const result = await geocodeAddress({ query: "Tbilisi prospekti", language: "az" }, deps)
    expect(result).toEqual({ ok: true, hits: parseGeocodeResponse(upstream) })
    expect(calls.map((call) => call.headers["User-Agent"])).toEqual(["LeadDriveCRM/1.0 (+https://leaddrivecrm.org)"])
    // Nothing of the tenant or the user travels with the address.
    expect(Object.keys(calls[0].headers).sort()).toEqual(["Accept", "User-Agent"])
  })

  it("does not ask twice for the same address in the same area", async () => {
    const query = { query: "Tbilisi prospekti", language: "az", near: { latitude: 40.41, longitude: 49.83 } }
    await geocodeAddress(query, deps)
    // Typed with other capitals, a street away on the map: the same question.
    const again = await geocodeAddress({ ...query, query: "TBILISI PROSPEKTI", near: { latitude: 40.43, longitude: 49.84 } }, deps)
    expect(again).toEqual({ ok: true, hits: parseGeocodeResponse(upstream) })
    expect(calls).toHaveLength(1)

    // Another language, or another city, is another question.
    await geocodeAddress({ ...query, language: "ru" }, deps)
    await geocodeAddress({ ...query, near: { latitude: 41.6, longitude: 44.8 } }, deps)
    expect(calls).toHaveLength(3)
  })

  it("forgets an answer after a day", async () => {
    await geocodeAddress({ query: "Tbilisi prospekti", language: "az" }, deps)
    clock += 24 * 60 * 60 * 1_000 + 1
    await geocodeAddress({ query: "Tbilisi prospekti", language: "az" }, deps)
    expect(calls).toHaveLength(2)
  })

  it("keeps a second between two requests, whoever makes them", async () => {
    await Promise.all([
      geocodeAddress({ query: "Nizami 5", language: "az" }, deps),
      geocodeAddress({ query: "Fizuli 12", language: "az" }, deps),
      geocodeAddress({ query: "Babek 44", language: "az" }, deps),
    ])
    expect(calls).toHaveLength(3)
    // The first goes at once; each of the others waits out the gap.
    expect(slept).toEqual([1_100, 1_100])
  })
})

describe("address search — an address the map spells differently", () => {
  // Production, 2026-10-06: the first real card tried. The map knows this
  // street as «Həsən bəy Zərdabi prospekti»; the exact search found nothing.
  const asWritten = "Yasamal r-nu, Hasanbay Zardabi küçəsi 79B, Yasamal, Bakı"

  it("keeps what identifies the address and drops the words that only say what kind of thing it is", () => {
    expect(simplifyAddressQuery(asWritten)).toBe("Yasamal Hasanbay Zardabi 79B Bakı")
    expect(simplifyAddressQuery("ул. Низами, д. 203, г. Баку")).toBe("Низами 203 Баку")
    expect(simplifyAddressQuery("Nizami Street 203, Baku City")).toBe("Nizami 203 Baku")
    // A name is not a kind of thing, and a house number is never dropped.
    expect(simplifyAddressQuery("Milli Onkologiya Mərkəzi")).toBe("Milli Onkologiya Mərkəzi")
    expect(simplifyAddressQuery("28 May küçəsi 5")).toBe("28 May 5")
  })

  it("asks the forgiving search only after the exact one found nothing, and with the simpler words", async () => {
    answer = () => json([])
    forgivingAnswer = () => json(forgivingUpstream)

    const result = await geocodeAddress({ query: asWritten, language: "az", near: BAKU }, deps)

    expect(asked()).toEqual(["nominatim.openstreetmap.org", "photon.komoot.io"])
    expect(Object.fromEntries(calls[1].url.searchParams)).toEqual({
      q: "Yasamal Hasanbay Zardabi 79B Bakı", limit: "5", lat: "40.409", lon: "49.867",
    })
    expect(result).toEqual({ ok: true, hits: [
      { label: "Milli Onkologiya Mərkəzi, Həsən bəy Zərdabi prospekti 79B, Yasamal rayonu, Bakı, Azərbaycan", latitude: 40.399929, longitude: 49.805225 },
      { label: "Həsən bəy Zərdabi pr. 79b, Bakı, Azərbaycan", latitude: 40.40019, longitude: 49.80475 },
    ] })
    // The second service is not kept waiting for the first one's sake, and
    // the pair is remembered as one answer.
    expect(slept).toEqual([])
    await geocodeAddress({ query: asWritten, language: "az", near: BAKU }, deps)
    expect(calls).toHaveLength(2)
  })

  // Production, the same evening: the forgiving service took longer than six
  // seconds from the server, the library gave up, and the address it knows
  // came back as «nothing found».
  it("gives the slow forgiving service twice as long as the exact one", async () => {
    answer = () => json([])
    forgivingAnswer = () => json(forgivingUpstream)
    await geocodeAddress({ query: asWritten, language: "az", near: BAKU }, deps)
    expect(patience).toEqual([6_000, 12_000])
  })

  it("keeps a second between two requests to the forgiving service too", async () => {
    answer = () => json([])
    await Promise.all([
      geocodeAddress({ query: "aaaa bbbb", language: "az" }, deps),
      geocodeAddress({ query: "cccc dddd", language: "az" }, deps),
    ])
    expect(asked().filter((host) => host === "photon.komoot.io")).toHaveLength(2)
    // One wait in each service's own line: the second exact request, the second forgiving one.
    expect(slept).toEqual([1_100, 1_100])
  })

  it("does not bother the forgiving search when the exact one found the address", async () => {
    await geocodeAddress({ query: "Tbilisi prospekti", language: "az", near: BAKU }, deps)
    expect(asked()).toEqual(["nominatim.openstreetmap.org"])
  })

  it("does not take a forgiving match on the other side of the continent for the address", () => {
    // What the forgiving service really answered for «Тбилисский проспект 10, Баку».
    const faraway = { features: [
      { geometry: { coordinates: [40.58368, 64.53294] }, properties: { name: "Баку", street: "Московский проспект", housenumber: "10 к1", city: "Архангельск" } },
      { geometry: { coordinates: [49.82270, 40.39158] }, properties: { street: "Tbilisi prospekti", city: "Bakı" } },
    ] }
    expect(parseForgivingResponse(faraway, BAKU).map((hit) => hit.label)).toEqual(["Tbilisi prospekti, Bakı"])
    // With no map to compare with, there is nothing to call far.
    expect(parseForgivingResponse(faraway, null)).toHaveLength(2)
  })

  it("reads only well-formed places out of a forgiving answer", () => {
    expect([null, [], "x", { features: "none" }].map((raw) => parseForgivingResponse(raw, BAKU))).toEqual([[], [], [], []])
    const junk = { features: [
      null,
      { geometry: {}, properties: { name: "No point" } },
      { geometry: { coordinates: ["49.8", "40.4"] }, properties: { name: "Strings" } },
      { geometry: { coordinates: [0, 0] }, properties: { name: "Null Island" } },
      { geometry: { coordinates: [49.8, 40.4] }, properties: {} },
    ] }
    expect(parseForgivingResponse(junk, null)).toEqual([])
    expect(new URL(buildForgivingUrl({ query: "Nizami 203 Bakı" })).searchParams.has("lat")).toBe(false)
  })
})

describe("address search — when a service is not there", () => {
  it("says it could not search only when neither answered, and does not remember the failure", async () => {
    answer = down
    forgivingAnswer = down
    expect(await geocodeAddress({ query: "Tbilisi prospekti", language: "az" }, deps)).toEqual({ ok: false })

    answer = () => { throw new Error("network down") }
    forgivingAnswer = () => { throw new Error("network down") }
    clock += 5_000
    expect(await geocodeAddress({ query: "Tbilisi prospekti", language: "az" }, deps)).toEqual({ ok: false })

    answer = () => json(upstream)
    clock += 5_000
    expect(await geocodeAddress({ query: "Tbilisi prospekti", language: "az" }, deps)).toEqual({ ok: true, hits: parseGeocodeResponse(upstream) })
    expect(asked().filter((host) => host === "nominatim.openstreetmap.org")).toHaveLength(3)
  })

  it("still finds the address through the forgiving search when the exact one is down", async () => {
    answer = down
    forgivingAnswer = () => json(forgivingUpstream)
    const result = await geocodeAddress({ query: "Zardabi 79B, Bakı", language: "az", near: BAKU }, deps)
    expect(result.ok && result.hits.map((hit) => hit.latitude)).toEqual([40.399929, 40.40019])
  })

  it("remembers «nothing found» only when both said so", async () => {
    answer = () => json([])
    expect(await geocodeAddress({ query: "zzzz qqqq", language: "az" }, deps)).toEqual({ ok: true, hits: [] })
    await geocodeAddress({ query: "zzzz qqqq", language: "az" }, deps)
    expect(calls).toHaveLength(2)

    // One of the two was down: an empty answer now, but asked again next time.
    forgivingAnswer = down
    clock += 5_000
    expect(await geocodeAddress({ query: "yyyy wwww", language: "az" }, deps)).toEqual({ ok: true, hits: [] })
    clock += 5_000
    await geocodeAddress({ query: "yyyy wwww", language: "az" }, deps)
    expect(calls).toHaveLength(6)
  })
})

/**
 * Owner, 2026-10-07, after moving an organization's pin with «Моё
 * местоположение»: «я тут изменил адрес, но в отображении всё ещё старый
 * адрес». The picker now names the address under the pin.
 */
describe("the address under a pin", () => {
  /** What the service answers for a point on a building. */
  const building = {
    display_name: "Milli Onkologiya Mərkəzi, 79B, Həsən bəy Zərdabi prospekti, Yasamal rayonu, Bakı, 1012, Azərbaycan",
    address: {
      amenity: "Milli Onkologiya Mərkəzi", house_number: "79B", road: "Həsən bəy Zərdabi prospekti",
      city_district: "Yasamal rayonu", city: "Bakı", postcode: "1012", country: "Azərbaycan",
    },
  }
  const pin = { latitude: 40.3999291, longitude: 49.8052254, language: "az" }

  it("asks for the building under the point, in the manager's language", () => {
    const url = new URL(buildReverseUrl(pin))
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/reverse")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: "jsonv2", lat: "40.399929", lon: "49.805225", zoom: "18", addressdetails: "1", "accept-language": "az",
    })
  })

  it("is the street and house for the address field, the district and the city for theirs", () => {
    expect(parseReverseResponse(building)).toEqual({
      address: "Həsən bəy Zərdabi prospekti 79B",
      district: "Yasamal rayonu",
      city: "Bakı",
      label: "Həsən bəy Zərdabi prospekti 79B, Yasamal rayonu, Bakı",
    })
    // A street without a house number is still an address; a town is a city.
    expect(parseReverseResponse({ address: { road: "Nizami küçəsi", town: "Xırdalan" } }))
      .toEqual({ address: "Nizami küçəsi", district: "", city: "Xırdalan", label: "Nizami küçəsi, Xırdalan" })
  })

  it("is nothing when the point is on no street: a district alone is not an address", () => {
    const none = [null, "x", {}, { address: null }, { address: { city: "Bakı", city_district: "Yasamal rayonu" } }, { error: "Unable to geocode" }]
    expect(none.map((raw) => parseReverseResponse(raw))).toEqual(none.map(() => null))
  })

  it("names the application, and does not ask twice for a pin moved less than a metre", async () => {
    answer = () => json(building)
    const first = await reverseGeocode(pin, deps)
    expect(first).toEqual({ ok: true, place: parseReverseResponse(building) })
    expect(calls.map((call) => [call.url.pathname, call.headers["User-Agent"]]))
      .toEqual([["/reverse", "LeadDriveCRM/1.0 (+https://leaddrivecrm.org)"]])

    await reverseGeocode({ ...pin, latitude: pin.latitude + 0.000002 }, deps)
    expect(calls).toHaveLength(1)
    // A hundred metres away is another building.
    await reverseGeocode({ ...pin, latitude: pin.latitude + 0.001 }, deps)
    expect(calls).toHaveLength(2)
  })

  it("shares the exact service's one-a-second line with the address search", async () => {
    answer = () => json(building)
    await Promise.all([
      geocodeAddress({ query: "Tbilisi prospekti", language: "az" }, { ...deps, fetch: (async () => json(upstream)) as unknown as typeof fetch }),
      reverseGeocode(pin, deps),
    ])
    expect(slept).toEqual([1_100])
  })

  it("says it could not look when the service is down, and remembers «no street here»", async () => {
    answer = down
    expect(await reverseGeocode(pin, deps)).toEqual({ ok: false })
    answer = () => json({ address: { city: "Bakı" } })
    clock += 5_000
    expect(await reverseGeocode(pin, deps)).toEqual({ ok: true, place: null })
    await reverseGeocode(pin, deps)
    expect(calls).toHaveLength(2)
  })
})
