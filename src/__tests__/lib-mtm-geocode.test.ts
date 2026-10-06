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
  buildGeocodeUrl,
  geocodeAddress,
  parseGeocodeResponse,
  resetGeocodeStateForTests,
  type GeocodeDeps,
} from "@/lib/mtm/geocode"

/** What the service answers for a street in the city the manager is looking at. */
const upstream = [
  { lat: "40.3978284", lon: "49.8169901", display_name: "Tbilisi prospekti, Yasamal, Bakı, Azərbaycan", importance: 0.4 },
  { lat: "40.4093", lon: "49.8671", display_name: "Bakı, Azərbaycan" },
]

let clock = 1_000_000
let slept: number[] = []
let calls: { url: URL; headers: Record<string, string> }[] = []
let answer: () => { ok: boolean; status: number; json: () => Promise<unknown> }

const deps: GeocodeDeps = {
  now: () => clock,
  sleep: async (ms) => { slept.push(ms); clock += ms },
  fetch: (async (input: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: new URL(String(input)), headers: init?.headers ?? {} })
    return answer()
  }) as unknown as typeof fetch,
}

beforeEach(() => {
  resetGeocodeStateForTests()
  clock = 1_000_000
  slept = []
  calls = []
  answer = () => ({ ok: true, status: 200, json: async () => upstream })
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

describe("address search — when the service is not there", () => {
  it("says it could not search, and does not remember the failure", async () => {
    answer = () => ({ ok: false, status: 503, json: async () => ({}) })
    expect(await geocodeAddress({ query: "Tbilisi prospekti", language: "az" }, deps)).toEqual({ ok: false })

    answer = () => { throw new Error("network down") }
    clock += 5_000
    expect(await geocodeAddress({ query: "Tbilisi prospekti", language: "az" }, deps)).toEqual({ ok: false })

    answer = () => ({ ok: true, status: 200, json: async () => upstream })
    clock += 5_000
    expect(await geocodeAddress({ query: "Tbilisi prospekti", language: "az" }, deps)).toEqual({ ok: true, hits: parseGeocodeResponse(upstream) })
    expect(calls).toHaveLength(3)
  })

  it("remembers «nothing found» like any other answer", async () => {
    answer = () => ({ ok: true, status: 200, json: async () => [] })
    expect(await geocodeAddress({ query: "zzzz qqqq", language: "az" }, deps)).toEqual({ ok: true, hits: [] })
    await geocodeAddress({ query: "zzzz qqqq", language: "az" }, deps)
    expect(calls).toHaveLength(1)
  })
})
