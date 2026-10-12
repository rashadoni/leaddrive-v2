// @vitest-environment jsdom
/**
 * The page behind a «ссылка на местоположение», as somebody with the link
 * and no account sees it.
 *
 * The view is the real one; only the network and the Leaflet canvas are
 * stood in for (the canvas by a stand-in that records what it is handed).
 * The sentences are the catalog's own through the real formatter, and the
 * clock is driven by hand — so «3 минуты назад», «asks twice a minute» and
 * «never again after the link is over» are read here as they happen.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => ({
  locale: "ru",
  /** Everything the page handed to the map, newest last. */
  maps: [] as Array<Record<string, unknown>>,
  /** How the page asked for the map's code to be loaded. */
  mapLoading: null as null | { ssr?: boolean; loading?: () => unknown },
}))

vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl")
  const { readFileSync } = await import("node:fs")
  const translators = new Map<string, unknown>()
  return {
    useLocale: () => hoisted.locale,
    useTranslations: (namespace: string) => {
      const key = `${hoisted.locale}:${namespace}`
      if (!translators.has(key)) {
        const whole = JSON.parse(readFileSync(`messages/${hoisted.locale}.json`, "utf8")) as Record<string, unknown>
        translators.set(key, actual.createTranslator({
          locale: hoisted.locale,
          // As in the app: the layout hands this page its own namespace and nothing else.
          messages: { mtmLocationShareLink: whole.mtmLocationShareLink } as never,
          namespace: namespace as never,
          onError: (error) => { throw error },
        }))
      }
      return translators.get(key)
    },
  }
})
// The Leaflet canvas is not drawn in jsdom: a stand-in records what it is given.
vi.mock("next/dynamic", async () => {
  const { createElement: h } = await import("react")
  return {
    default: (_load: unknown, options: { ssr?: boolean; loading?: () => unknown }) => {
      hoisted.mapLoading = options
      return function MapStandIn(props: Record<string, unknown>) {
        hoisted.maps.push({ ...props })
        return h("div", { "data-testid": "map-stand-in" })
      }
    },
  }
})

import { LocationShareLinkView } from "@/components/mtm/location-share-link-view"
import LocationShareLinkError from "@/app/share/location/[token]/error"

const TOKEN = "b".repeat(64)
const ASKED = `/api/v1/public/location-share/${TOKEN}`
/** The server's clock: five past two in the afternoon in Baku. */
const SERVER_NOW = Date.parse("2026-10-12T10:05:30.000Z")
const iso = (ms: number) => new Date(ms).toISOString()
const data = {
  name: "Нигяр Примерова",
  organizationName: "Example LLC",
  expiresAt: "2026-10-12T14:00:00.000Z",
  timezone: "Asia/Baku",
}
/** The moment the organization's day ends: midnight in Baku. */
const BAKU_MIDNIGHT = "2026-10-12T20:00:00.000Z"
/** Recorded three minutes and ten seconds before the server answered. */
const POINT = { latitude: 40.4093, longitude: 49.8671, recordedAt: iso(SERVER_NOW - 190_000) }

describe("the public page of a location link", () => {
  let root: Root
  let container: HTMLDivElement
  let requests: Array<{ path: string; cache: RequestCache | undefined }>
  /** The signal of each request, in the order they were sent: which of them the page gave up on. */
  let signals: AbortSignal[]
  /** What the server says now; a function is asked on every request. */
  let server: () => Response | Promise<Response>
  /** Time that has passed on the server since the page was opened. */
  let elapsed: () => number
  let visibility: DocumentVisibilityState

  const byTestId = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const text = (testId: string) => byTestId(testId)?.textContent ?? null
  const state = () => byTestId("location-share-link")?.getAttribute("data-state")
  const lastMap = () => hoisted.maps.at(-1)
  /** A second at a time: React applies what a timer set when the `act` it fired in ends. */
  const forward = async (ms: number, step = 1_000) => {
    for (let passed = 0; passed < ms; passed += step) {
      await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(step, ms - passed)) })
    }
  }
  const open = async (token = TOKEN) => {
    await act(async () => { root.render(createElement(LocationShareLinkView, { token })) })
    await forward(50, 50)
  }
  const look = async (how: DocumentVisibilityState) => {
    visibility = how
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")) })
    await forward(50, 50)
  }
  const available = (over: Record<string, unknown> = {}) => Response.json({
    success: true, state: "AVAILABLE", data: { ...data, ...POINT, generatedAt: iso(SERVER_NOW + elapsed()), ...over },
  })
  const unavailable = (over: Record<string, unknown> = {}) => Response.json({
    success: true, state: "UNAVAILABLE", data: { ...data, generatedAt: iso(SERVER_NOW + elapsed()), ...over },
  })
  const gone = () => Response.json({ success: false, state: "GONE" }, { status: 404 })

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    hoisted.locale = "ru"
    hoisted.maps.length = 0
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] })
    // The visitor's own clock is seven hours wrong: nothing on the page may be counted from it.
    const openedAt = Date.parse("2026-10-12T03:00:00.000Z")
    vi.setSystemTime(new Date(openedAt))
    elapsed = () => Date.now() - openedAt
    // …and stands in Baku, as the organization does — until a case says otherwise.
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-240)
    visibility = "visible"
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility })
    requests = []
    signals = []
    server = () => available()
    vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      requests.push({ path: url.pathname + url.search, cache: init?.cache })
      const signal = init?.signal ?? new AbortController().signal
      signals.push(signal)
      // As a browser does it: a request the page gives up on is rejected there and then.
      return new Promise<Response>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")))
        Promise.resolve().then(() => server()).then(resolve, reject)
      })
    }))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
    Reflect.deleteProperty(document, "visibilityState")
  })

  describe("when there is a position to show", () => {
    it("draws the map with exactly that point, and says who, when the coordinate was recorded and until when the link works", async () => {
      await open()
      expect(state()).toBe("available")
      expect(text("location-share-link-name")).toBe("Нигяр Примерова")
      expect(text("location-share-link-organization")).toBe("Example LLC")
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 3 минуты назад")
      expect(text("location-share-link-expires")).toBe("Ссылка действует до 18:00")
      // Said on the page until 2026-10-12; it is the link's description for a messenger's preview now, not a line the visitor reads.
      expect(byTestId("location-share-link-scope")).toBeNull()
      expect(container.textContent).toContain("Страница обновляется сама.")
      expect(byTestId("location-share-link-map")?.getAttribute("aria-label")).toBe("Карта: где сейчас находится сотрудник")
      // The map is handed the point, the name for the marker's letter and how many times «Обновить» was pressed — and nothing else.
      expect(lastMap()).toEqual({ latitude: 40.4093, longitude: 49.8671, name: "Нигяр Примерова", recentreKey: 0 })
      // Asked once, of the public route, never from a cache.
      expect(requests).toEqual([{ path: ASKED, cache: "no-store" }])
    })

    it("lets nothing else an answer carries reach the screen or the map", async () => {
      server = () => available({
        phone: "+994 50 000 00 00", email: "n.primerova@example.test", accuracy: 12.5, speed: 41, heading: 270, battery: 37,
        mapColor: "pink", tags: ["стажёр"], agentId: "agent-internal-7", organizationId: "org-internal-3",
        route: [[40.4, 49.8], [40.41, 49.86]], customer: "Аптека на углу", workdayStartedAt: "2026-10-12T05:00:00.000Z",
      })
      await open()
      expect(state()).toBe("available")
      expect(Object.keys(lastMap() ?? {}).sort()).toEqual(["latitude", "longitude", "name", "recentreKey"])
      expect(container.innerHTML).not.toMatch(/994|example\.test|12[.,]5|\b41\b|270|\b37\b|pink|стажёр|agent-internal|org-internal|Аптека|09:00|05:00/)
    })

    it("counts «N минут назад» from the server's clock and the time passed on the page — not from the visitor's own clock", async () => {
      await open()
      // The device believes it is 03:00 UTC; the age is still the true three minutes.
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 3 минуты назад")
      // The employee stands still: the same point comes back, two minutes older.
      await forward(120_000)
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 5 минут назад")
    })

    it("says «только что» of a point recorded within the minute", async () => {
      server = () => available({ recordedAt: iso(SERVER_NOW + elapsed() - 20_000) })
      await open()
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:05 · только что")
    })

    it("follows the employee: a new point from the server is what the map is handed next", async () => {
      await open()
      server = () => available({ latitude: 40.4201, longitude: 49.8802, recordedAt: iso(SERVER_NOW + elapsed() - 15_000) })
      await forward(30_000)
      expect(lastMap()).toEqual({ latitude: 40.4201, longitude: 49.8802, name: "Нигяр Примерова", recentreKey: 0 })
      expect(container.querySelectorAll('[data-testid="map-stand-in"]')).toHaveLength(1)
    })
  })

  describe("the organization's clock", () => {
    it("prints every time in the organization's zone and names the zone to a visitor whose own clock reads differently", async () => {
      // The visitor's device is on UTC.
      vi.mocked(Date.prototype.getTimezoneOffset).mockReturnValue(0)
      await open()
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 3 минуты назад")
      expect(text("location-share-link-expires")).toBe("Ссылка действует до 18:00")
      // As a person says it — not the name of a zone out of a database.
      expect(text("location-share-link-timezone")).toBe("Время указано по времени организации (GMT+4)")
    })

    it("does not explain the zone to somebody whose clock already reads the same", async () => {
      await open()
      expect(byTestId("location-share-link-timezone")).toBeNull()
    })

    it("follows the answer's zone, whatever it is — and falls back to UTC for a zone that is none", async () => {
      vi.mocked(Date.prototype.getTimezoneOffset).mockReturnValue(-240)
      server = () => available({ timezone: "Europe/Warsaw" })
      await open()
      expect(text("location-share-link-recorded")).toBe("Обновлено в 12:02 · 3 минуты назад")
      expect(text("location-share-link-expires")).toBe("Ссылка действует до 16:00")
      expect(text("location-share-link-timezone")).toBe("Время указано по времени организации (GMT+2)")

      server = () => available({ timezone: "Somewhere/Nowhere" })
      await forward(30_000)
      expect(text("location-share-link-expires")).toBe("Ссылка действует до 14:00")
      expect(text("location-share-link-timezone")).toBe("Время указано по времени организации (GMT+0)")
    })
  })

  describe("when the link works and there is nothing to show", () => {
    it("says so in plain words, draws no map and gives no reason", async () => {
      server = () => unavailable()
      await open()
      expect(state()).toBe("unavailable")
      expect(text("location-share-link-unavailable")).toBe("Сейчас местоположение недоступноСтраница проверяет сама. Когда местоположение станет доступно, оно появится здесь.")
      expect(text("location-share-link-name")).toBe("Нигяр Примерова")
      expect(text("location-share-link-expires")).toBe("Ссылка действует до 18:00")
      expect(byTestId("location-share-link-map")).toBeNull()
      expect(byTestId("map-stand-in")).toBeNull()
      expect(hoisted.maps).toEqual([])
      expect(byTestId("location-share-link-recorded")).toBeNull()
      // «Only the current point is shown» is not said where no point is shown.
      expect(byTestId("location-share-link-scope")).toBeNull()
      // That the page checks by itself is said once, by the words above — and it can still be asked by hand.
      expect(container.textContent).not.toContain("Страница обновляется сама.")
      expect(text("location-share-link-refresh")).toBe("Обновить")
    })

    it("goes on checking, and shows the position the moment the server has one — and takes it away again when it has none", async () => {
      server = () => unavailable()
      await open()
      server = () => available({ recordedAt: iso(SERVER_NOW + elapsed() - 60_000) })
      await forward(30_000)
      expect(state()).toBe("available")
      expect(lastMap()).toMatchObject({ latitude: 40.4093, longitude: 49.8671 })
      server = () => unavailable()
      await forward(30_000)
      expect(state()).toBe("unavailable")
      expect(byTestId("map-stand-in")).toBeNull()
      expect(container.textContent).not.toContain("Обновлено в")
    })

    it("ignores coordinates sent beside «nothing to show»: the state is the server's word, not the page's reading of the fields", async () => {
      server = () => unavailable({ latitude: 40.4093, longitude: 49.8671, recordedAt: iso(SERVER_NOW) })
      await open()
      expect(state()).toBe("unavailable")
      expect(hoisted.maps).toEqual([])
    })
  })

  describe("when the link no longer works", () => {
    it("says so in plain words, with nothing of anybody on the page", async () => {
      server = gone
      await open()
      expect(state()).toBe("gone")
      expect(text("location-share-link-gone")).toBe("Ссылка больше не работаетПопросите того, кто её прислал, сделать новую.")
      expect(byTestId("map-stand-in")).toBeNull()
      expect(byTestId("location-share-link-refresh")).toBeNull()
      expect(container.textContent).not.toMatch(/Примерова|Example LLC|Ссылка действует/)
    })

    it("never asks the server again: not on its timer, not when the tab comes back, not ever", async () => {
      server = gone
      await open()
      expect(requests).toHaveLength(1)
      await forward(10 * 60_000, 10_000)
      await look("hidden")
      await look("visible")
      await forward(60_000, 10_000)
      expect(requests).toHaveLength(1)
    })

    it("takes the map off the screen at once when a link that worked is revoked while the page is open — and the name with it once the server has said so twice", async () => {
      await open()
      expect(state()).toBe("available")
      server = gone
      await forward(30_000)
      // Said once: where he is goes at once, and the page does not yet call the link over.
      expect(state()).toBe("unavailable")
      expect(byTestId("map-stand-in")).toBeNull()
      expect(container.textContent).not.toContain("Обновлено в")
      expect(text("location-share-link-unavailable")).toContain("Сейчас местоположение недоступно")
      expect(byTestId("location-share-link-notice")).toBeNull()
      expect(requests).toHaveLength(2)
      // Said again half a minute later: over, and nothing of anybody is left on the page.
      await forward(30_000)
      expect(requests).toHaveLength(3)
      expect(state()).toBe("gone")
      expect(container.textContent).not.toMatch(/Примерова|Example LLC|Обновлено в/)
      await forward(5 * 60_000, 10_000)
      expect(requests).toHaveLength(3)
    })

    it("says so at once for an address that is not a link at all — and does not ask the server about it", async () => {
      for (const address of ["", "not-a-link", "b".repeat(63), "B".repeat(64), `${"b".repeat(64)}0`, "../../api/v1/mtm/locations"]) {
        act(() => root.unmount())
        root = createRoot(container)
        await open(address)
        expect(state(), address).toBe("gone")
      }
      await forward(60_000, 10_000)
      expect(requests).toEqual([])
    })

    it("does not take some other 404 on the way for the end of the link: only the server's own «GONE» stops the page", async () => {
      await open()
      // A deploy in progress answers with a page, not with the route's answer.
      server = () => new Response("<html>Not Found</html>", { status: 404, headers: { "content-type": "text/html" } })
      await forward(30_000)
      expect(state()).toBe("available")
      expect(text("location-share-link-notice")).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      server = () => available()
      await forward(30_000)
      expect(byTestId("location-share-link-notice")).toBeNull()
      expect(requests).toHaveLength(3)
    })

    it("when the link's time runs out by the page's clock the position goes — and the server, asked at once, is the one to say it is over", async () => {
      // The link ends forty seconds from now.
      server = () => available({ expiresAt: iso(SERVER_NOW + 40_000) })
      await open()
      expect(state()).toBe("available")
      await forward(30_000)
      expect(state()).toBe("available")
      // The next half-minute is past the moment: asked, the server says the link is over.
      server = gone
      await forward(30_000)
      expect(requests).toHaveLength(3)
      // Once is enough here: the page's own clock says the same.
      expect(state()).toBe("gone")
      expect(byTestId("map-stand-in")).toBeNull()
      await forward(3 * 60_000, 10_000)
      expect(requests).toHaveLength(3)
    })

    it("does not end the page by its own clock when the server cannot be reached: no position, no «больше не работает», and it goes on asking", async () => {
      server = () => available({ expiresAt: iso(SERVER_NOW + 40_000) })
      await open()
      server = () => { throw new TypeError("Failed to fetch") }
      await forward(60_000)
      // Past the moment, and nobody to ask.
      expect(state()).toBe("unavailable")
      expect(byTestId("map-stand-in")).toBeNull()
      expect(container.textContent).not.toContain("Обновлено в")
      expect(byTestId("location-share-link-gone")).toBeNull()
      expect(text("location-share-link-notice")).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      expect(requests).toHaveLength(3)
      await forward(60_000)
      expect(requests).toHaveLength(5)
      expect(state()).toBe("unavailable")
      // The connection is back: now the server says it, and the page believes it.
      server = gone
      await forward(30_000)
      expect(state()).toBe("gone")
      const asked = requests.length
      await forward(3 * 60_000, 10_000)
      expect(requests).toHaveLength(asked)
    })
  })

  describe("asking the server", () => {
    it("asks twice a minute while somebody is looking", async () => {
      await open()
      await forward(95_000)
      // On opening, then at 30, 60 and 90 seconds.
      expect(requests).toHaveLength(4)
      expect(new Set(requests.map((request) => request.path))).toEqual(new Set([ASKED]))
    })

    it("asks nothing in a hidden tab, and asks at once when the tab is looked at again", async () => {
      await open()
      await look("hidden")
      await forward(5 * 60_000, 10_000)
      expect(requests).toHaveLength(1)
      await look("visible")
      expect(requests).toHaveLength(2)
      // …and from there on its usual half-minute.
      await forward(31_000)
      expect(requests).toHaveLength(3)
    })

    it("flicking between tabs does not ask each time", async () => {
      await open()
      for (let flick = 0; flick < 5; flick += 1) {
        await look("hidden")
        await look("visible")
      }
      expect(requests).toHaveLength(1)
    })

    it("after «too many requests» waits a minute instead of asking again, keeps what it shows, and says so", async () => {
      await open()
      server = () => Response.json({ success: false, state: "RATE_LIMITED", retryAfterSeconds: 60 }, { status: 429, headers: { "Retry-After": "60" } })
      await forward(30_000)
      expect(requests).toHaveLength(2)
      expect(text("location-share-link-notice")).toBe("Слишком много запросов. Страница попробует снова через минуту.")
      expect(state()).toBe("available")
      expect(byTestId("map-stand-in")).not.toBeNull()
      // «Обновить» is not a way around the wait.
      expect(byTestId("location-share-link-refresh")?.hasAttribute("disabled")).toBe(true)
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      server = () => available()
      // The half-minute tick inside the wait asks nobody…
      await forward(45_000)
      expect(requests).toHaveLength(2)
      // …the first one after the minute does.
      await forward(20_000)
      expect(requests).toHaveLength(3)
      expect(byTestId("location-share-link-notice")).toBeNull()
      expect(byTestId("location-share-link-refresh")?.hasAttribute("disabled")).toBe(false)
    })

    it("waits as long as the answer asks when that is longer, and a minute when the refusal names no time (the proxy's own)", async () => {
      await open()
      server = () => Response.json({ success: false, state: "RATE_LIMITED", retryAfterSeconds: 150 }, { status: 429 })
      await forward(30_000)
      expect(requests).toHaveLength(2)
      server = () => available()
      // Four half-minute ticks go by inside the two and a half minutes.
      await forward(140_000)
      expect(requests).toHaveLength(2)
      await forward(15_000)
      expect(requests).toHaveLength(3)

      server = () => Response.json({ error: "Too many requests" }, { status: 429 })
      await forward(30_000)
      expect(requests).toHaveLength(4)
      expect(text("location-share-link-notice")).toBe("Слишком много запросов. Страница попробует снова через минуту.")
      server = () => available()
      await forward(50_000)
      expect(requests).toHaveLength(4)
      await forward(10_000)
      expect(requests).toHaveLength(5)
    })

    it("with no connection keeps the marker, says the data could not be refreshed, and tries again on its next half-minute — not in a loop", async () => {
      await open()
      server = () => { throw new TypeError("Failed to fetch") }
      await forward(30_000)
      expect(text("location-share-link-notice")).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      expect(state()).toBe("available")
      expect(lastMap()).toMatchObject({ latitude: 40.4093, longitude: 49.8671 })
      // The age goes on by the page's clock while nothing new arrives.
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 3 минуты назад")
      await forward(29_000)
      expect(requests).toHaveLength(2)
      server = () => available()
      await forward(2_000)
      expect(requests).toHaveLength(3)
      expect(byTestId("location-share-link-notice")).toBeNull()
    })

    it("stops calling a point «сейчас» once it has held it for longer than the server itself would hand one over", async () => {
      await open()
      server = () => { throw new TypeError("Failed to fetch") }
      // Eleven more minutes without an answer: the point is fourteen minutes old — still within the quarter of an hour.
      await forward(11 * 60_000, 10_000)
      expect(state()).toBe("available")
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 14 минут назад")
      await forward(2 * 60_000, 10_000)
      expect(state()).toBe("unavailable")
      expect(byTestId("map-stand-in")).toBeNull()
      expect(text("location-share-link-unavailable")).toContain("Сейчас местоположение недоступно")
      expect(container.textContent).not.toContain("Обновлено в")
    })

    it("when the very first question fails, says so with «Обновить» instead of loading for ever", async () => {
      server = () => { throw new TypeError("Failed to fetch") }
      await open()
      expect(state()).toBe("loading")
      expect(text("location-share-link-notice")).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      server = () => available()
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      await forward(50, 50)
      expect(state()).toBe("available")
    })

    it("«Обновить» asks at once, says «Обновляем…» while the answer is on its way and takes no second press", async () => {
      await open()
      let answer: (response: Response) => void = () => {}
      server = () => new Promise<Response>((resolve) => { answer = resolve })
      expect(text("location-share-link-refresh")).toBe("Обновить")
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      expect(requests).toHaveLength(2)
      expect(text("location-share-link-refresh")).toBe("Обновляем…")
      expect(byTestId("location-share-link-refresh")?.hasAttribute("disabled")).toBe(true)
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      await forward(10_000)
      expect(requests).toHaveLength(2)
      await act(async () => { answer(available({ latitude: 40.5, longitude: 49.9 })) })
      await forward(50, 50)
      expect(text("location-share-link-refresh")).toBe("Обновить")
      expect(lastMap()).toMatchObject({ latitude: 40.5, longitude: 49.9 })
    })

    it("the page's own timer does not pile a second question on one that is on its way", async () => {
      await open()
      // Slow, not dead: the answer comes ten seconds into the next half-minute.
      let answer: (response: Response) => void = () => {}
      server = () => new Promise<Response>((resolve) => { answer = resolve })
      await forward(30_000)
      expect(requests).toHaveLength(2)
      await look("hidden")
      await look("visible")
      await forward(10_000)
      expect(requests).toHaveLength(2)
      await act(async () => { answer(available()) })
      await forward(50, 50)
      expect(byTestId("location-share-link-notice")).toBeNull()
      expect(state()).toBe("available")
    })

    it("a question that hangs is given up after fifteen seconds and said so — the page does not stand silent over it", async () => {
      await open()
      // A phone on a poor connection: the request neither fails nor answers.
      server = () => new Promise<Response>(() => {})
      await forward(30_000)
      expect(requests).toHaveLength(2)
      await forward(14_000)
      expect(byTestId("location-share-link-notice")).toBeNull()
      expect(signals[1].aborted).toBe(false)
      await forward(1_000)
      expect(signals[1].aborted).toBe(true)
      expect(text("location-share-link-notice")).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      // What it showed stays, ageing; and the next half-minute asks again instead of waiting behind the dead one.
      expect(state()).toBe("available")
      await forward(15_000)
      expect(requests).toHaveLength(3)
      server = () => available()
      await forward(30_000)
      expect(requests).toHaveLength(4)
      expect(byTestId("location-share-link-notice")).toBeNull()
    })

    it("says so as well when the deadline cuts an answer off half-way: headers came, the rest never did", async () => {
      await open()
      server = () => {
        const signal = signals.at(-1)!
        const half = Response.json({})
        // The body of a request the page gave up on fails to arrive, as in a browser.
        Object.defineProperty(half, "json", { value: () => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))) }) })
        return half
      }
      await forward(30_000)
      expect(requests).toHaveLength(2)
      expect(byTestId("location-share-link-notice")).toBeNull()
      await forward(15_000)
      expect(text("location-share-link-notice")).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      expect(state()).toBe("available")
    })

    it("«Обновить» does not wait behind the page's own hanging question: that one is dropped and the press asks anew", async () => {
      await open()
      server = () => new Promise<Response>(() => {})
      await forward(30_000)
      expect(requests).toHaveLength(2)
      // Five seconds into the hang the visitor presses.
      await forward(5_000)
      server = () => available({ latitude: 40.5, longitude: 49.9 })
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      expect(requests).toHaveLength(3)
      expect(signals[1].aborted).toBe(true)
      expect(signals[2].aborted).toBe(false)
      await forward(50, 50)
      expect(lastMap()).toMatchObject({ latitude: 40.5, longitude: 49.9 })
      expect(text("location-share-link-refresh")).toBe("Обновить")
      // The question that was dropped on purpose is not reported as a lost connection — not then, not at its own deadline.
      expect(byTestId("location-share-link-notice")).toBeNull()
      await forward(12_000)
      expect(byTestId("location-share-link-notice")).toBeNull()
    })

    it("a press whose own question hangs is given up the same way: the button is back after fifteen seconds, with the reason, and takes the next press", async () => {
      await open()
      server = () => new Promise<Response>(() => {})
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      expect(requests).toHaveLength(2)
      await forward(14_000)
      expect(text("location-share-link-refresh")).toBe("Обновляем…")
      await forward(1_000)
      expect(signals[1].aborted).toBe(true)
      expect(text("location-share-link-refresh")).toBe("Обновить")
      expect(byTestId("location-share-link-refresh")?.hasAttribute("disabled")).toBe(false)
      expect(text("location-share-link-notice")).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      server = () => available()
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      await forward(50, 50)
      expect(requests).toHaveLength(3)
      expect(byTestId("location-share-link-notice")).toBeNull()
    })

    it("«Обновить» on the first screen, after a first question that hangs, is taken too", async () => {
      server = () => new Promise<Response>(() => {})
      await open()
      expect(state()).toBe("loading")
      await forward(15_000)
      expect(text("location-share-link-notice")).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      server = () => available()
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      await forward(50, 50)
      expect(state()).toBe("available")
    })

    it("a press brings the map back to the marker — the page's own questions never do", async () => {
      await open()
      expect(lastMap()?.recentreKey).toBe(0)
      // The employee stands still; the page asks by itself four times.
      await forward(120_000)
      expect(requests).toHaveLength(5)
      expect(lastMap()?.recentreKey).toBe(0)
      await look("hidden")
      await forward(60_000, 10_000)
      await look("visible")
      expect(lastMap()?.recentreKey).toBe(0)
      // The same coordinate comes back to a press as well — and the map is told to return to it.
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      await forward(50, 50)
      expect(lastMap()).toEqual({ latitude: 40.4093, longitude: 49.8671, name: "Нигяр Примерова", recentreKey: 1 })
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      await forward(50, 50)
      expect(lastMap()?.recentreKey).toBe(2)
      // With no connection the press still brings the map back: the marker it shows is the one to return to.
      server = () => { throw new TypeError("Failed to fetch") }
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      await forward(50, 50)
      expect(lastMap()?.recentreKey).toBe(3)
    })

    it("stops asking when the page is closed", async () => {
      await open()
      act(() => root.unmount())
      root = createRoot(container)
      await forward(2 * 60_000, 10_000)
      expect(requests).toHaveLength(1)
    })
  })

  describe("an answer that cannot be what it says", () => {
    it("draws no marker where it would have to guess: a point off the globe, no point, no time", async () => {
      for (const broken of [
        { latitude: 91 }, { longitude: -181 }, { latitude: "40.4" }, { latitude: null }, { longitude: Number.NaN },
        { recordedAt: null }, { recordedAt: "недавно" }, { expiresAt: null }, { generatedAt: "now" }, { name: null }, { organizationName: 7 },
      ]) {
        act(() => root.unmount())
        root = createRoot(container)
        hoisted.maps.length = 0
        server = () => available(broken)
        await open()
        expect(hoisted.maps, JSON.stringify(broken)).toEqual([])
        expect(state(), JSON.stringify(broken)).toBe("loading")
        expect(text("location-share-link-notice"), JSON.stringify(broken)).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      }
    })

    it("reads only the two answers it knows: a success without a state, another state, a bare 200", async () => {
      for (const body of [{ success: true, data: { ...data, ...POINT, generatedAt: iso(SERVER_NOW) } }, { success: true, state: "MOVED", data: {} }, { state: "AVAILABLE", data: { ...data, ...POINT } }, null, "ok", []]) {
        act(() => root.unmount())
        root = createRoot(container)
        server = () => Response.json(body)
        await open()
        expect(state(), JSON.stringify(body)).toBe("loading")
        expect(byTestId("map-stand-in"), JSON.stringify(body)).toBeNull()
      }
    })
  })

  describe("in the link's language", () => {
    it("reads in Azerbaijani, on the 24-hour clock", async () => {
      hoisted.locale = "az"
      await open()
      expect(text("location-share-link-organization")).toBe("Example LLC")
      expect(text("location-share-link-recorded")).toBe("Yenilənib: 14:02 · 3 dəqiqə əvvəl")
      expect(text("location-share-link-expires")).toBe("Link bu vaxta qədər işləyir: 18:00")
      expect(text("location-share-link-refresh")).toBe("Yenilə")
    })

    it("reads in English", async () => {
      hoisted.locale = "en"
      server = () => unavailable()
      await open()
      expect(text("location-share-link-unavailable")).toContain("The location is not available right now")
      server = gone
      // Said twice, half a minute apart.
      await forward(60_000)
      expect(text("location-share-link-gone")).toBe("This link no longer worksAsk whoever sent it to make a new one.")
    })

    it("says «до конца дня» in each language for a link that ends with the organization's day", async () => {
      for (const [locale, sentence] of [
        ["ru", "Ссылка действует до конца дня"], ["en", "The link works until the end of the day"], ["az", "Link günün sonuna qədər işləyir"],
      ]) {
        act(() => root.unmount())
        root = createRoot(container)
        hoisted.locale = locale
        server = () => available({ expiresAt: BAKU_MIDNIGHT })
        await open()
        expect(text("location-share-link-expires"), locale).toBe(sentence)
      }
    })
  })

  describe("a link that ends with the organization's day", () => {
    it("says so in words — «до 00:00» names no day", async () => {
      server = () => available({ expiresAt: BAKU_MIDNIGHT })
      await open()
      expect(text("location-share-link-expires")).toBe("Ссылка действует до конца дня")
      expect(container.textContent).not.toContain("00:00")
      // The same without a position to show.
      server = () => unavailable({ expiresAt: BAKU_MIDNIGHT })
      await forward(30_000)
      expect(state()).toBe("unavailable")
      expect(text("location-share-link-expires")).toBe("Ссылка действует до конца дня")
    })

    it("is a clock a minute either side of that moment, and for the same moment in a zone whose day ends at another hour", async () => {
      server = () => available({ expiresAt: iso(Date.parse(BAKU_MIDNIGHT) - 60_000) })
      await open()
      expect(text("location-share-link-expires")).toBe("Ссылка действует до 23:59")
      server = () => available({ expiresAt: iso(Date.parse(BAKU_MIDNIGHT) + 60_000) })
      await forward(30_000)
      expect(text("location-share-link-expires")).toBe("Ссылка действует до 00:01")
      server = () => available({ expiresAt: BAKU_MIDNIGHT, timezone: "Europe/Warsaw" })
      await forward(30_000)
      expect(text("location-share-link-expires")).toBe("Ссылка действует до 22:00")
    })
  })

  describe("the visitor's phone and its two clocks", () => {
    /** What locking a phone does: the wall clock goes on, the steady one and every timer stand still. */
    const sleep = (ms: number) => { vi.setSystemTime(new Date(Date.now() + ms)) }

    it("after the phone has slept for half an hour: asks the moment it is looked at, and meanwhile does not call the old point «3 минуты назад»", async () => {
      await open()
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 3 минуты назад")
      await look("hidden")
      const steady = performance.now()
      sleep(35 * 60_000)
      // The premise: by the steady clock no time has passed at all.
      expect(performance.now()).toBe(steady)
      // Back in front of somebody, on a connection that has not woken up yet.
      let answer: (response: Response) => void = () => {}
      server = () => new Promise<Response>((resolve) => { answer = resolve })
      await look("visible")
      expect(requests).toHaveLength(2)
      // The point is thirty-eight minutes old: the server itself would not hand it over.
      expect(state()).toBe("unavailable")
      expect(byTestId("map-stand-in")).toBeNull()
      expect(container.textContent).not.toContain("Обновлено в")
      await act(async () => { answer(available({ recordedAt: iso(SERVER_NOW + elapsed() - 20_000) })) })
      await forward(50, 50)
      expect(state()).toBe("available")
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:40 · только что")
    })

    it("after five minutes of sleep the point is still shown — with its true age", async () => {
      await open()
      await look("hidden")
      sleep(5 * 60_000)
      server = () => new Promise<Response>(() => {})
      await look("visible")
      expect(requests).toHaveLength(2)
      expect(state()).toBe("available")
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 8 минут назад")
    })

    it("a phone that slept through the link's last minutes does not go on showing the position", async () => {
      server = () => available({ expiresAt: iso(SERVER_NOW + 4 * 60_000) })
      await open()
      await look("hidden")
      sleep(5 * 60_000)
      server = gone
      await look("visible")
      expect(state()).toBe("gone")
      expect(byTestId("map-stand-in")).toBeNull()
    })

    it("flicking between tabs still does not ask each time: by both clocks it was asked a moment ago", async () => {
      await open()
      for (let flick = 0; flick < 5; flick += 1) {
        await look("hidden")
        sleep(5_000)
        await look("visible")
      }
      // Twenty-five seconds in all: not yet half a minute.
      expect(requests).toHaveLength(1)
      await look("hidden")
      sleep(5_000)
      await look("visible")
      expect(requests).toHaveLength(2)
    })

    it("a wall clock set back an hour changes nothing: the age goes on by the steady clock", async () => {
      await open()
      vi.setSystemTime(new Date(Date.now() - 60 * 60_000))
      // The server's own clock, of course, did not move.
      const perfAtChange = performance.now()
      server = () => available({ generatedAt: iso(SERVER_NOW + 5_000 + (performance.now() - perfAtChange)), recordedAt: POINT.recordedAt })
      await forward(120_000)
      expect(requests).toHaveLength(5)
      expect(state()).toBe("available")
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 5 минут назад")
    })

    // The case above is answered every half-minute, and every answer starts
    // the count anew — it would pass with the steady clock left out of the
    // sum altogether. What the steady clock is there for shows only where
    // the page counts from a moment BEFORE the clock was set back: by the
    // wall clock alone no time passes from there until the hour is made up.
    // Three such moments: the answer it holds, the start of a wait it was
    // asked for, and the last time it asked.

    it("a wall clock set back an hour while the server does not answer: the point the page holds goes on ageing, and leaves the screen at the server's own limit", async () => {
      // The server's clock is its own: it does not jump with the phone's.
      const perfAtOpen = performance.now()
      const serverNow = () => SERVER_NOW + (performance.now() - perfAtOpen)
      await open()
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 3 минуты назад")
      // Somebody corrects the phone's clock — an hour back — on a connection that hangs every question from here on.
      vi.setSystemTime(new Date(Date.now() - 60 * 60_000))
      server = () => new Promise<Response>(() => {})
      await forward(120_000)
      expect(state()).toBe("available")
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 5 минут назад")
      // It went on asking: each hanging question given up after its fifteen seconds, and said so.
      expect(requests).toHaveLength(5)
      expect(text("location-share-link-notice")).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      // Nine minutes more and the point is fourteen minutes old; past the quarter of an hour it is no longer called «сейчас».
      await forward(9 * 60_000, 10_000)
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 14 минут назад")
      await forward(2 * 60_000, 10_000)
      expect(state()).toBe("unavailable")
      expect(byTestId("map-stand-in")).toBeNull()
      expect(container.textContent).not.toContain("Обновлено в")
      // The connection is back: the next half-minute's question is answered, and its point is on the map.
      server = () => available({ generatedAt: iso(serverNow()), recordedAt: iso(serverNow() - 20_000) })
      await forward(30_000)
      expect(state()).toBe("available")
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:18 · только что")
      expect(byTestId("location-share-link-notice")).toBeNull()
    })

    it("a wall clock set back an hour in the middle of a «too many requests» wait: the wait is still a minute, not an hour and a minute", async () => {
      const perfAtOpen = performance.now()
      const serverNow = () => SERVER_NOW + (performance.now() - perfAtOpen)
      await open()
      server = () => Response.json({ success: false, state: "RATE_LIMITED", retryAfterSeconds: 60 }, { status: 429, headers: { "Retry-After": "60" } })
      await forward(30_000)
      expect(requests).toHaveLength(2)
      expect(text("location-share-link-notice")).toBe("Слишком много запросов. Страница попробует снова через минуту.")
      // Ten seconds into the wait the phone's clock is corrected: an hour back.
      await forward(10_000)
      vi.setSystemTime(new Date(Date.now() - 60 * 60_000))
      server = () => available({ generatedAt: iso(serverNow()), recordedAt: POINT.recordedAt })
      // The half-minute tick inside the minute asks nobody…
      await forward(35_000)
      expect(requests).toHaveLength(2)
      // …the first one after it does — the silence is over by the clock that cannot be set — and the button is back.
      await forward(20_000)
      expect(requests).toHaveLength(3)
      expect(byTestId("location-share-link-notice")).toBeNull()
      expect(byTestId("location-share-link-refresh")?.hasAttribute("disabled")).toBe(false)
      expect(state()).toBe("available")
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 4 минуты назад")
    })

    it("a wall clock set back an hour does not keep the page from asking when it is looked at again: by the steady clock it last asked forty seconds ago", async () => {
      const perfAtOpen = performance.now()
      const serverNow = () => SERVER_NOW + (performance.now() - perfAtOpen)
      await open()
      vi.setSystemTime(new Date(Date.now() - 60 * 60_000))
      server = () => available({ generatedAt: iso(serverNow()), recordedAt: POINT.recordedAt })
      await look("hidden")
      // Forty seconds in a hidden tab: its timer runs and asks nobody.
      await forward(40_000)
      expect(requests).toHaveLength(1)
      await look("visible")
      expect(requests).toHaveLength(2)
      expect(text("location-share-link-recorded")).toBe("Обновлено в 14:02 · 3 минуты назад")
    })

    it("a wall clock set a day ahead does not end a link that works: the position goes, the server is asked, and its answer puts it back", async () => {
      // The server's clock is its own: it does not jump with the phone's.
      const perfAtOpen = performance.now()
      const serverNow = () => SERVER_NOW + (performance.now() - perfAtOpen)
      server = () => available({ generatedAt: iso(serverNow()), recordedAt: iso(serverNow() - 60_000) })
      await open()
      expect(state()).toBe("available")
      // Somebody corrects the phone's date: a day forward, far past the link's last moment.
      vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60_000))
      // The connection is slow at that moment, so what the page does by itself can be seen.
      let answer: (response: Response) => void = () => {}
      server = () => new Promise<Response>((resolve) => { answer = resolve })
      await forward(30_000)
      expect(requests).toHaveLength(2)
      expect(state()).toBe("unavailable")
      expect(byTestId("map-stand-in")).toBeNull()
      expect(byTestId("location-share-link-gone")).toBeNull()
      // The server says the link works, as it does.
      await act(async () => { answer(available({ generatedAt: iso(serverNow()), recordedAt: iso(serverNow() - 60_000) })) })
      await forward(50, 50)
      expect(state()).toBe("available")
      expect(text("location-share-link-recorded")).toContain("1 минуту назад")
      // …and it goes on working, half-minute after half-minute.
      server = () => available({ generatedAt: iso(serverNow()), recordedAt: iso(serverNow() - 60_000) })
      await forward(90_000)
      expect(state()).toBe("available")
      expect(requests).toHaveLength(5)
    })
  })

  describe("«больше не работает», said of a link that worked a moment ago", () => {
    it("one such answer is not the end: the position goes at once, the page asks once more after half a minute — and goes on when the link works", async () => {
      await open()
      server = gone
      await forward(30_000)
      expect(state()).toBe("unavailable")
      expect(byTestId("map-stand-in")).toBeNull()
      expect(text("location-share-link-name")).toBe("Нигяр Примерова")
      expect(byTestId("location-share-link-gone")).toBeNull()
      expect(requests).toHaveLength(2)
      // The server was stumbling: it is itself again.
      server = () => available()
      // Not asked sooner than the half-minute by the page itself…
      await forward(29_000)
      expect(requests).toHaveLength(2)
      // …and then once.
      await forward(1_000)
      expect(requests).toHaveLength(3)
      expect(state()).toBe("available")
      expect(lastMap()).toMatchObject({ latitude: 40.4093, longitude: 49.8671 })
      // From there on its usual half-minute — the extra question left no second timer behind.
      await forward(60_000)
      expect(requests).toHaveLength(5)
    })

    it("a second one, later, is again the first: the count starts over with every answer that says the link works", async () => {
      await open()
      server = gone
      await forward(30_000)
      server = () => available()
      await forward(30_000)
      expect(state()).toBe("available")
      // An hour's worth of trouble, one bad answer at a time, never two in a row.
      for (let turn = 0; turn < 4; turn += 1) {
        server = gone
        await forward(30_000)
        expect(state(), `turn ${turn}`).toBe("unavailable")
        server = () => available()
        await forward(30_000)
        expect(state(), `turn ${turn}`).toBe("available")
      }
    })

    it("«Обновить» pressed inside the half-minute asks — and its answer is neither the end nor a new count", async () => {
      await open()
      server = gone
      await forward(30_000)
      expect(requests).toHaveLength(2)
      // Five seconds later the visitor presses; the server is still stumbling.
      await forward(5_000)
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      await forward(50, 50)
      expect(requests).toHaveLength(3)
      expect(state()).toBe("unavailable")
      expect(byTestId("location-share-link-gone")).toBeNull()
      // And again.
      await forward(10_000)
      await act(async () => { byTestId("location-share-link-refresh")?.click() })
      await forward(50, 50)
      expect(requests).toHaveLength(4)
      expect(state()).toBe("unavailable")
      // The half-minute is counted from the first answer: at its end the page asks, and that one ends it.
      await forward(15_000)
      expect(requests).toHaveLength(5)
      expect(state()).toBe("gone")
    })

    it("a press after the half-minute is the second question, and ends the page", async () => {
      await open()
      server = gone
      await forward(30_000)
      // Nobody is looking when the half-minute is up: nothing is asked.
      await look("hidden")
      await forward(60_000, 10_000)
      expect(requests).toHaveLength(2)
      expect(byTestId("location-share-link-gone")).toBeNull()
      await look("visible")
      expect(requests).toHaveLength(3)
      expect(state()).toBe("gone")
    })

    it("a failed question in between is neither: the page still waits for the server's second word", async () => {
      await open()
      server = gone
      await forward(30_000)
      server = () => { throw new TypeError("Failed to fetch") }
      await forward(30_000)
      expect(requests).toHaveLength(3)
      expect(state()).toBe("unavailable")
      expect(text("location-share-link-notice")).toBe("Не удалось обновить данные. Проверьте интернет — страница попробует ещё раз.")
      server = gone
      await forward(30_000)
      expect(state()).toBe("gone")
    })

    it("a link opened dead is over at once, as before: there the page has nothing to lose by believing it", async () => {
      server = gone
      await open()
      expect(state()).toBe("gone")
      expect(requests).toHaveLength(1)
    })
  })

  describe("when the page itself cannot be drawn", () => {
    it("says so in the link's language with one worded button — which loads the page anew — and no way out to anywhere else", async () => {
      const reload = vi.fn()
      vi.stubGlobal("location", { href: window.location.href, origin: window.location.origin, reload })
      const reset = vi.fn()
      for (const [locale, title, sentence, button] of [
        ["ru", "Местоположение сотрудника", "Не удалось показать страницу. Проверьте интернет и нажмите «Обновить».", "Обновить"],
        ["en", "Employee location", "The page could not be shown. Check your internet connection and press “Refresh”.", "Refresh"],
        ["az", "Əməkdaşın olduğu yer", "Səhifəni göstərmək alınmadı. İnternet bağlantısını yoxlayın və «Yenilə» düyməsini basın.", "Yenilə"],
      ]) {
        act(() => root.unmount())
        root = createRoot(container)
        hoisted.locale = locale
        reload.mockClear()
        // Next hands the page the error and its own `reset`; neither is used.
        await act(async () => { root.render(createElement(LocationShareLinkError as never, { error: new Error("Loading chunk 4821 failed."), reset })) })
        expect(text("location-share-link-error"), locale).toBe(`${title}${sentence}${button}`)
        // Nothing of what went wrong is printed, and nothing leads to another page.
        expect(container.innerHTML, locale).not.toMatch(/chunk|4821|Xəta|Ana səhifə/)
        expect(container.querySelectorAll("a"), locale).toHaveLength(0)
        const buttons = [...container.querySelectorAll("button")]
        expect(buttons.map((element) => element.textContent), locale).toEqual([button])
        await act(async () => { buttons[0].click() })
        expect(reload, locale).toHaveBeenCalledTimes(1)
      }
      expect(reset).not.toHaveBeenCalled()
      // Nothing was asked of the server by this page.
      expect(requests).toEqual([])
    })
  })

  describe("while the map's own code is on its way", () => {
    it("the page says «Загружаем местоположение…» in the map's place — in the link's language — and loads the map in the browser only", async () => {
      await open()
      expect(hoisted.mapLoading?.ssr).toBe(false)
      expect(typeof hoisted.mapLoading?.loading).toBe("function")
      for (const [locale, sentence] of [["ru", "Загружаем местоположение…"], ["en", "Loading the location…"], ["az", "Olduğu yer yüklənir…"]]) {
        act(() => root.unmount())
        root = createRoot(container)
        hoisted.locale = locale
        await act(async () => { root.render(hoisted.mapLoading!.loading!() as ReturnType<typeof createElement>) })
        expect(text("location-share-link-map-loading"), locale).toBe(sentence)
        expect(byTestId("location-share-link-map-loading")?.getAttribute("role"), locale).toBe("status")
      }
    })
  })
})
