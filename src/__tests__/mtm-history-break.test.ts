// @vitest-environment jsdom
/**
 * A break in the day's path on /mtm/map «История», as the demo clip
 * «Marşrut & Sahə» shows it (owner, 2026-10-20: production must look and
 * behave like the clip): «Перерыв» is a row with its duration and nothing
 * else. It is the employee's own time (owner's rule) — the row is not a
 * button that draws «where he went» between the fix before it and the fix
 * after it, and the map draws no red «no points — path unknown» line across
 * it, which would also call a break a lost signal. A lost signal keeps both.
 *
 * The day is built by the same detectors and trip builder the API runs
 * (location-history.ts, day-trip.ts) and handed over as JSON, as the page
 * receives it; only the Leaflet canvas is stood in for.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru
    for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})
// The canvas: every line the map would draw is put in the page as an element
// that says its colour, its dashes and its points.
vi.mock("react-leaflet", async () => {
  const { createElement: h } = await import("react")
  return {
    MapContainer: ({ children }: { children?: unknown }) => h("div", { "data-testid": "history-map" }, children as never),
    Polyline: ({ positions, pathOptions }: { positions: Array<[number, number]>; pathOptions: { color: string; dashArray?: string } }) =>
      h("i", { "data-line": pathOptions.color, "data-dash": pathOptions.dashArray ?? "", "data-positions": JSON.stringify(positions) }),
    CircleMarker: () => null,
    Popup: () => null,
    useMap: () => ({ invalidateSize: () => {}, fitBounds: () => {}, setView: () => {} }),
  }
})
vi.mock("@/components/mtm/carto-basemap", () => ({ CartoBasemap: () => null }))

import { DayTripLedger, type DayTripData, type DayTripFocus } from "@/components/mtm/day-trip-ledger"
import LocationHistoryMap from "@/components/mtm/location-history-map"
import { buildDayTrip } from "@/lib/mtm/day-trip"
import { detectHistoryGaps, detectHistoryStops, type HistoryLocationPoint } from "@/lib/mtm/location-history"
import { HISTORY_MAP_COLORS } from "@/lib/mtm/history-path"
import { matchRoads, resetMapMatchingState } from "@/lib/mtm/map-matching"
import { mtmWorkdayPauses } from "@/lib/mtm/workday-pauses"

const DAY = "2026-10-20"
const at = (clock: string) => new Date(`${DAY}T${clock}:00.000Z`)
let sequence = 0
function track(from: string, to: string, start: [number, number], end: [number, number]): HistoryLocationPoint[] {
  const t0 = at(from).getTime()
  const t1 = at(to).getTime()
  const steps = Math.max(1, Math.round((t1 - t0) / 30_000))
  return Array.from({ length: steps + 1 }, (_, index) => ({
    id: `p${String(sequence++).padStart(5, "0")}`,
    latitude: start[0] + (end[0] - start[0]) * index / steps,
    longitude: start[1] + (end[1] - start[1]) * index / steps,
    accuracy: 8, speed: null, heading: null, battery: 80,
    isMoving: start[0] !== end[0],
    recordedAt: new Date(t0 + (t1 - t0) * index / steps),
    workdayId: "w1",
  }))
}

const HOME: [number, number] = [40.3800, 49.8300]
const PHARMACY: [number, number] = [40.4300, 49.8700]
const CAFE_STREET: [number, number] = [40.4450, 49.8900]
const CLINIC: [number, number] = [40.4100, 49.9300]

/**
 * Drove to the pharmacy; paused at 09:30 and resumed at 10:10 a couple of
 * kilometres away; drove to the clinic; then the phone lost the signal from
 * 10:40 to 11:20 — no break pressed — and came back further on.
 */
function day() {
  const points = [
    ...track("09:00", "09:30", HOME, PHARMACY),
    ...track("10:10", "10:40", CAFE_STREET, CLINIC),
    ...track("11:20", "11:40", PHARMACY, HOME),
  ].filter((point, index, all) => index === 0 || point.recordedAt > all[index - 1].recordedAt)
  const gaps = detectHistoryGaps(points, 300, [{ startedAt: at("09:31"), endedAt: at("10:10") }])
  const stops = detectHistoryStops({ points, visits: [], radiusMeters: 80, minimumSeconds: 5 * 60, offlineThresholdSeconds: 300 })
  const trip = buildDayTrip({ points, stops, visits: [], gaps, workday: { startedAt: at("09:00"), completedAt: at("11:40") } })
  // As the page receives them: over JSON.
  return JSON.parse(JSON.stringify({ points, gaps, stops, trip })) as {
    points: Array<{ id: string; latitude: number; longitude: number; accuracy: number | null; battery: number | null; recordedAt: string }>
    gaps: Array<{ id: string; startedAt: string; endedAt: string; reason: "TELEMETRY_GAP" | "WORKDAY_PAUSED"; startLatitude: number; startLongitude: number; endLatitude: number; endLongitude: number }>
    stops: []
    trip: DayTripData
  }
}

describe("a break in the day's path", () => {
  let root: Root
  let container: HTMLDivElement
  const render = async (element: ReturnType<typeof createElement>) => {
    await act(async () => { root.render(element) })
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("is a row with its duration only: not a button, never focused, nothing drawn when it is pressed", async () => {
    const { trip } = day()
    expect(trip.entries.filter((entry) => entry.kind === "GAP").map((entry) => entry.kind === "GAP" && entry.reason)).toEqual(["WORKDAY_PAUSED", "TELEMETRY_GAP"])
    const focused: Array<DayTripFocus | null> = []
    await render(createElement(DayTripLedger, {
      trip, multiDay: false, focusId: null, onFocus: (focus: DayTripFocus | null) => focused.push(focus),
      formatMoment: (value: string) => value.slice(11, 16),
      formatDuration: (seconds: number) => `${Math.round(seconds / 60)} мин`,
    }))
    const rows = [...container.querySelectorAll("li")]
    const breakRow = rows.find((row) => row.textContent?.startsWith("Перерыв"))!
    const signalRow = rows.find((row) => row.textContent?.startsWith("Нет данных с телефона"))!

    // «Перерыв 40 мин 09:30–10:10», and nothing to press.
    expect(breakRow.textContent).toBe("Перерыв40 мин09:30–10:10")
    expect(breakRow.querySelector("button, a, [tabindex], [role='button']")).toBeNull()
    expect(breakRow.querySelector("[aria-pressed]")).toBeNull()
    await act(async () => { (breakRow.querySelector("span") as HTMLElement).click() })
    expect(focused).toEqual([])

    // A lost signal is still a stretch of the day the map can show.
    const signal = signalRow.querySelector("button")!
    expect(signal.getAttribute("aria-pressed")).toBe("false")
    await act(async () => { signal.click() })
    expect(focused).toHaveLength(1)
    expect(focused[0]).toMatchObject({ from: `${DAY}T10:40:00.000Z`, to: `${DAY}T11:20:00.000Z` })
    // Every other leg of the day can be picked, as before.
    expect(rows.filter((row) => row.querySelector("button")).length).toBe(rows.length - 3)
  })

  it("draws no red «no points» line across a break, and still breaks the track there", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const { points, gaps } = day()
      await render(createElement(LocationHistoryMap, {
        points, stops: [], visits: [], workday: null, plannedRoutes: [], gaps,
        layers: { planned: true, actual: true, stops: true, visits: true, gaps: true },
        locale: "ru", timezone: "UTC", playbackIndex: points.length - 1,
      }))
      // The map is mounted once its frame has a size, or after a tenth of a second.
      await act(async () => { await vi.advanceTimersByTimeAsync(150) })
      const lines = (color: string) => [...container.querySelectorAll<HTMLElement>(`[data-line="${color}"]`)]
        .map((line) => JSON.parse(line.dataset.positions ?? "[]") as Array<[number, number]>)

      const pauseGap = gaps.find((gap) => gap.reason === "WORKDAY_PAUSED")!
      const signalGap = gaps.find((gap) => gap.reason === "TELEMETRY_GAP")!
      // One red dotted line: the lost signal, end to end. None for the break.
      expect(lines(HISTORY_MAP_COLORS.gap)).toEqual([[
        [signalGap.startLatitude, signalGap.startLongitude],
        [signalGap.endLatitude, signalGap.endLongitude],
      ]])
      // The blue track runs in three pieces; none of them joins where he paused to where he resumed.
      const runs = lines(HISTORY_MAP_COLORS.track)
      expect(runs).toHaveLength(3)
      const joins = (run: Array<[number, number]>, a: [number, number], b: [number, number]) =>
        run.some((point, index) => index > 0 && point[0] === b[0] && point[1] === b[1] && run[index - 1][0] === a[0] && run[index - 1][1] === a[1])
      const paused: [number, number] = [pauseGap.startLatitude, pauseGap.startLongitude]
      const resumed: [number, number] = [pauseGap.endLatitude, pauseGap.endLongitude]
      expect(runs.some((run) => joins(run, paused, resumed))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // Verification of 2026-10-20: a break no longer than the gap threshold
  // (five minutes by default) was no gap at all. The day read «В пути» across
  // it, and both the track and the line along the streets joined where he
  // paused to where he resumed. The day goes through the history API's own
  // steps, in its order (the route itself is run in api-mtm-location-history):
  // the journal's breaks, the road server, the gaps, the trip.
  it("of four minutes: its own «Перерыв» row, and no line of the map crosses it", async () => {
    const utc = (clock: string) => new Date(`${DAY}T${clock}.000Z`)
    const fixes = [
      ...track("05:00", "05:30", HOME, PHARMACY),
      ...track("05:34", "06:00", CAFE_STREET, CLINIC),
    ]
    // «Перерыв» at 05:30:05, «Продолжить» at 05:33:55: no fix in between, as the server takes none.
    const breaks = mtmWorkdayPauses([
      { type: "START", occurredAt: utc("05:00:00") },
      { type: "PAUSE", occurredAt: utc("05:30:05") },
      { type: "RESUME", occurredAt: utc("05:33:55") },
      { type: "FINISH", occurredAt: utc("06:00:00") },
    ])
    // The road server matches every stretch it is asked for into one line through its fixes.
    resetMapMatchingState()
    const osrm = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes("/route/v1/")) return Response.json({ code: "Ok", routes: [{ distance: 2_000 }] })
      const coordinates = url.split("/match/v1/driving/")[1].split("?")[0].split(";").map((pair) => pair.split(",").map(Number))
      return Response.json({
        code: "Ok",
        matchings: [{ geometry: { coordinates }, legs: coordinates.slice(1).map(() => ({ distance: 100 })) }],
        tracepoints: coordinates.map((_, index) => ({ matchings_index: 0, waypoint_index: index })),
      })
    })
    const road = await matchRoads(fixes, { baseUrl: "http://osrm.test", fetchImpl: osrm as unknown as typeof fetch, breaks })
    resetMapMatchingState()
    const gaps = detectHistoryGaps(fixes, 300, breaks.map((pause) => ({ startedAt: pause.from, endedAt: pause.to })))
    const stops = detectHistoryStops({ points: fixes, visits: [], radiusMeters: 50, minimumSeconds: 5 * 60, offlineThresholdSeconds: 300 })
    const trip = buildDayTrip({ points: fixes, stops, visits: [], gaps, workday: { startedAt: utc("05:00:00"), completedAt: utc("06:00:00") }, roadSteps: road?.stepMeters })
    // As the page receives them: over JSON.
    const data = JSON.parse(JSON.stringify({ points: fixes, gaps, trip, matchedTrack: road?.complete ? { segments: road.segments } : null })) as {
      trip: DayTripData
      points: ReturnType<typeof day>["points"]
      gaps: ReturnType<typeof day>["gaps"]
      matchedTrack: { segments: Array<Array<[number, number]>> } | null
    }
    expect(data.matchedTrack?.segments.length).toBeGreaterThan(0)

    // The ledger: «Перерыв 4 мин» between two drives (the clock here is UTC), and nothing to press.
    const focused: Array<DayTripFocus | null> = []
    await render(createElement(DayTripLedger, {
      trip: data.trip, multiDay: false, focusId: null, onFocus: (focus: DayTripFocus | null) => focused.push(focus),
      formatMoment: (value: string) => value.slice(11, 16),
      formatDuration: (seconds: number) => `${Math.round(seconds / 60)} мин`,
    }))
    const rows = [...container.querySelectorAll("li")]
    expect(rows.map((row) => row.querySelector(".font-medium")?.textContent)).toEqual([
      "Начал день", "В пути", "Перерыв", "В пути", "Закрыл день",
    ])
    const breakRow = rows[2]
    expect(breakRow.textContent).toBe("Перерыв4 мин05:30–05:34")
    expect(breakRow.querySelector("button, a, [tabindex], [role='button']")).toBeNull()
    await act(async () => { (breakRow.querySelector("span") as HTMLElement).click() })
    expect(focused).toEqual([])
    expect(data.trip.summary).toMatchObject({ movingSeconds: 60 * 60 - 4 * 60, pausedSeconds: 4 * 60, unknownSeconds: 0 })

    // The map: the straight track and the line along the streets, both cut at the break; no red line for it.
    await act(async () => { root.unmount() })
    root = createRoot(container)
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      await render(createElement(LocationHistoryMap, {
        points: data.points, stops: [], visits: [], workday: null, plannedRoutes: [], gaps: data.gaps,
        layers: { planned: true, actual: true, stops: true, visits: true, gaps: true, roads: true },
        locale: "ru", timezone: "UTC", playbackIndex: data.points.length - 1, matchedTrack: data.matchedTrack,
      }))
      await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    } finally {
      vi.useRealTimers()
    }
    const lines = (color: string) => [...container.querySelectorAll<HTMLElement>(`[data-line="${color}"]`)]
      .map((line) => JSON.parse(line.dataset.positions ?? "[]") as Array<[number, number]>)
    const at0930 = data.points.find((point) => point.recordedAt === `${DAY}T05:30:00.000Z`)!
    const at0934 = data.points.find((point) => point.recordedAt === `${DAY}T05:34:00.000Z`)!
    const near = (a: [number, number], b: { latitude: number; longitude: number }) =>
      Math.abs(a[0] - b.latitude) < 1e-6 && Math.abs(a[1] - b.longitude) < 1e-6
    const crosses = (run: Array<[number, number]>) => run.some((point, index) => index > 0 && near(run[index - 1], at0930) && near(point, at0934))
    const roads = lines(HISTORY_MAP_COLORS.track)
    const straight = lines(HISTORY_MAP_COLORS.raw)
    expect(roads.length).toBeGreaterThan(0)
    expect(straight).toHaveLength(2)
    expect([...roads, ...straight].some(crosses)).toBe(false)
    expect(lines(HISTORY_MAP_COLORS.gap)).toEqual([])
  })
})
