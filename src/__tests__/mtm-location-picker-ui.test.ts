// @vitest-environment jsdom
/**
 * The organization's map picker: an address, «where I am now», or a point on
 * the map — and a pin that can be corrected afterwards.
 *
 * Until 2026-10-06 the picker was a map under the English words «Click on map
 * to set location». The owner: «нужен тут поиск — по месту, где я сейчас, и по
 * адресу, который я буду писать, и потом чтобы можно было корректировать».
 *
 * The real component with the Russian copy. Leaflet cannot draw in jsdom, so
 * the map itself is a stand-in that records what the component asks of it;
 * the network and the browser's location are stubbed.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Record<string, Record<string, string>>
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    (ru[namespace]?.[key] ?? `${namespace}.${key}`).replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? "")),
}))

type MarkerProps = { position: [number, number]; draggable?: boolean; eventHandlers?: { dragend?: (event: unknown) => void } }
const map = vi.hoisted(() => ({
  center: { lat: 40.4093, lng: 49.8671 },
  zoom: 13,
  flights: [] as { to: [number, number]; zoom: number }[],
  handlers: {} as Record<string, (event?: unknown) => void>,
  marker: null as MarkerProps | null,
}))

vi.mock("leaflet/dist/leaflet.css", () => ({}))
vi.mock("leaflet", () => ({ default: { divIcon: () => ({}) } }))
vi.mock("@/components/mtm/carto-vector-basemap", () => ({ CartoVectorBasemap: () => null }))
vi.mock("react-leaflet", () => {
  const mapApi = {
    getCenter: () => map.center,
    getZoom: () => map.zoom,
    invalidateSize: () => {},
    flyTo: (to: [number, number], zoom: number) => { map.flights.push({ to, zoom }) },
  }
  return {
    MapContainer: ({ children }: { children?: ReactNode }) => createElement("div", { "data-testid": "map" }, children),
    Marker: (props: MarkerProps) => { map.marker = props; return createElement("div", { "data-testid": "pin" }) },
    useMap: () => mapApi,
    useMapEvents: (handlers: Record<string, (event?: unknown) => void>) => { Object.assign(map.handlers, handlers); return mapApi },
  }
})

import LocationPickerMap from "@/components/mtm/location-picker-map"

/** The organization's form: it holds the pair, and hands back what it was given. */
let position: { latitude: number | null; longitude: number | null }
let changes: [number, number][]
let geocode: (url: URL) => { status: number; body: unknown }
let searches: URL[]
let root: Root
let container: HTMLDivElement

function draw(address?: string) {
  root.render(createElement(LocationPickerMap, {
    ...position,
    address,
    onChange: (lat: number, lng: number) => {
      changes.push([lat, lng])
      position = { latitude: lat, longitude: lng }
      draw(address)
    },
  }))
}
const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
}
async function open(address?: string) {
  await act(async () => { draw(address) })
  await act(async () => { container.querySelector<HTMLButtonElement>("button")?.click() })
  await settle()
}
const picker = () => container.querySelector<HTMLElement>('[data-testid="mtm-location-picker"]')
const button = (label: string) => [...(picker()?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.trim() === label) ?? null
const searchBox = () => picker()?.querySelector<HTMLInputElement>('input[type="search"]') ?? null
const notice = () => picker()?.querySelector('[data-testid="mtm-location-picker-notice"]')?.textContent ?? ""
const results = () => [...(picker()?.querySelectorAll('[data-testid="mtm-location-picker-results"] button') ?? [])] as HTMLButtonElement[]
const press = async (element: HTMLElement | null) => { await act(async () => { element?.click() }); await settle() }
async function type(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setValue?.call(searchBox(), value)
    searchBox()?.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  position = { latitude: null, longitude: null }
  changes = []
  searches = []
  map.flights = []
  map.handlers = {}
  map.marker = null
  map.center = { lat: 40.4093, lng: 49.8671 }
  geocode = () => ({
    status: 200,
    body: { success: true, data: { results: [
      { label: "Tbilisi prospekti 10, Bakı", latitude: 40.397828, longitude: 49.81699 },
      { label: "Tbilisi prospekti, Sumqayıt", latitude: 40.5855, longitude: 49.6317 },
    ] } },
  })
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(String(input), "http://localhost")
    searches.push(url)
    const { status, body } = geocode(url)
    return { ok: status < 400, status, json: async () => body }
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("map picker — by the address the manager types", () => {
  it("searches when asked, offers what was found, and puts the pin on the chosen address", async () => {
    await open()
    expect(notice()).toBe("Найдите адрес, нажмите «Моё местоположение» или просто нажмите на карту.")

    await type("  Tbilisi   prospekti 10 ")
    // Typing alone asks nobody: the free service forbids search-as-you-type.
    expect(searches).toEqual([])

    await press(button("Найти"))
    expect(searches.map((url) => [url.pathname, url.searchParams.get("q"), url.searchParams.get("lang")]))
      .toEqual([["/api/v1/mtm/geocode", "Tbilisi prospekti 10", "ru"]])
    expect(results().map((item) => item.textContent)).toEqual(["Tbilisi prospekti 10, Bakı", "Tbilisi prospekti, Sumqayıt"])
    // Finding is not choosing: nothing is set until an address is pressed.
    expect(changes).toEqual([])

    await press(results()[0])
    expect(changes).toEqual([[40.397828, 49.81699]])
    expect(map.flights).toEqual([{ to: [40.397828, 49.81699], zoom: 17 }])
    expect(results()).toEqual([])
    expect(notice()).toBe("Метку можно поправить: перетащите её или нажмите на карту в нужном месте.")
  })

  it("starts from the address already typed in the organization's form, and searches near the map", async () => {
    map.center = { lat: 41.69, lng: 44.8 }
    await open("Rustaveli 12, Tbilisi")
    expect(searchBox()?.value).toBe("Rustaveli 12, Tbilisi")

    await act(async () => { map.handlers.moveend?.() })
    await press(button("Найти"))
    expect(searches.map((url) => [url.searchParams.get("q"), url.searchParams.get("lat"), url.searchParams.get("lng")]))
      .toEqual([["Rustaveli 12, Tbilisi", "41.69", "44.8"]])
  })

  it("searches on Enter without submitting the form it sits in", async () => {
    await open()
    await type("Nizami 5")
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    await act(async () => { searchBox()?.dispatchEvent(enter) })
    await settle()

    expect(searches).toHaveLength(1)
    expect(enter.defaultPrevented).toBe(true)
    expect(picker()?.querySelector("form")).toBeNull()
  })

  it("says in words when nothing was found, when the search is down, and when there is too little to search", async () => {
    await open()
    await type("ab")
    await press(button("Найти"))
    expect([notice(), searches.length]).toEqual(["Введите хотя бы 3 символа.", 0])

    geocode = () => ({ status: 200, body: { success: true, data: { results: [] } } })
    await type("zzzz qqqq")
    await press(button("Найти"))
    expect(notice()).toBe("Ничего не найдено. Уточните адрес или поставьте метку на карте вручную.")

    geocode = () => ({ status: 502, body: { error: "Address search is unavailable right now", code: "MTM_GEOCODE_UNAVAILABLE" } })
    await press(button("Найти"))
    expect(notice()).toBe("Поиск адресов сейчас недоступен. Поставьте метку на карте вручную.")

    geocode = () => ({ status: 429, body: { code: "MTM_GEOCODE_RATE_LIMITED" } })
    await press(button("Найти"))
    expect(notice()).toBe("Слишком много запросов. Повторите через минуту.")
    expect(changes).toEqual([])
  })
})

describe("map picker — by where the manager is now", () => {
  const withLocation = (getCurrentPosition: (ok: (position: unknown) => void, fail: (error: unknown) => void) => void) =>
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } })

  it("puts the pin where the browser says, and says how sure the browser is", async () => {
    withLocation((ok) => ok({ coords: { latitude: 40.39782849, longitude: 49.81699012, accuracy: 84.6 } }))
    await open()
    await press(button("Моё местоположение"))

    expect(changes).toEqual([[40.397828, 49.81699]])
    expect(map.flights).toEqual([{ to: [40.397828, 49.81699], zoom: 17 }])
    expect(notice()).toBe("Определено с точностью около 85 м. Если метка не на месте — поправьте её.")
  })

  it("says what to do when the browser refuses, and sets nothing", async () => {
    withLocation((_ok, fail) => fail({ code: 1, PERMISSION_DENIED: 1 }))
    await open()
    await press(button("Моё местоположение"))
    expect(notice()).toBe("Браузер не дал доступ к местоположению. Разрешите его для этого сайта и обновите страницу — или поставьте метку вручную.")

    withLocation((_ok, fail) => fail({ code: 3, PERMISSION_DENIED: 1 }))
    await press(button("Моё местоположение"))
    expect(notice()).toBe("Не удалось определить местоположение. Попробуйте ещё раз или поставьте метку вручную.")
    expect(changes).toEqual([])
  })
})

describe("map picker — correcting the pin", () => {
  it("lets the pin be dragged, and a click on the map moves it too", async () => {
    position = { latitude: 40.397828, longitude: 49.81699 }
    await open()
    expect([map.marker?.position, map.marker?.draggable]).toEqual([[40.397828, 49.81699], true])

    await act(async () => { map.marker?.eventHandlers?.dragend?.({ target: { getLatLng: () => ({ lat: 40.39801234, lng: 49.81712345 }) } }) })
    await act(async () => { map.handlers.click?.({ latlng: { lat: 40.3985, lng: 49.8168 } }) })

    expect(changes).toEqual([[40.398012, 49.817123], [40.3985, 49.8168]])
    expect(map.marker?.position).toEqual([40.3985, 49.8168])
    expect(picker()?.querySelector('[data-testid="mtm-location-picker-coordinates"]')?.textContent).toBe("40.398500, 49.816800")
    // Correcting by hand does not make the map jump: the manager is already looking there.
    expect(map.flights).toEqual([])
  })

  it("speaks the reader's language everywhere, the closed preview included", async () => {
    await act(async () => { draw() })
    expect(container.textContent).toContain("Указать место на карте")
    await act(async () => { container.querySelector<HTMLButtonElement>("button")?.click() })
    await settle()

    expect(picker()?.textContent).toContain("Место на карте")
    expect(button("Готово")).not.toBeNull()
    expect(container.textContent).not.toMatch(/Click on map|Done|mtmLocationPicker\./)

    await press(button("Готово"))
    expect(picker()).toBeNull()
  })
})
