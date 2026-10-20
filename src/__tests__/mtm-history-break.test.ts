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
    // A marker says its colour, and its popup is in the page: the stop's own minutes are read off it.
    CircleMarker: ({ pathOptions, children }: { pathOptions?: { color?: string }; children?: unknown }) =>
      h("b", { "data-marker": pathOptions?.color ?? "" }, children as never),
    Popup: ({ children }: { children?: unknown }) => h("span", { "data-popup": "" }, children as never),
    useMap: () => ({ invalidateSize: () => {}, fitBounds: () => {}, setView: () => {} }),
  }
})
vi.mock("@/components/mtm/carto-basemap", () => ({ CartoBasemap: () => null }))

import { DayTripLedger, type DayTripData, type DayTripFocus } from "@/components/mtm/day-trip-ledger"
import LocationHistoryMap from "@/components/mtm/location-history-map"
import { buildDayTrip } from "@/lib/mtm/day-trip"
import { cutHistoryStopsAtBreaks, detectHistoryGaps, detectHistoryStops, type HistoryLocationPoint, type HistoryVisit } from "@/lib/mtm/location-history"
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
  const stops = detectHistoryStops({ points, visits: [], radiusMeters: 80, minimumSeconds: 5 * 60, offlineThresholdSeconds: 300, gaps })
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

    // «Перерыв 39 мин 09:31–10:10» — from «Перерыв» to «Продолжить», as the
    // journal says, not from the fix before it — and nothing to press.
    expect(breakRow.textContent).toBe("Перерыв39 мин09:31–10:10")
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
    const stops = detectHistoryStops({ points: fixes, visits: [], radiusMeters: 50, minimumSeconds: 5 * 60, offlineThresholdSeconds: 300, gaps })
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
    // 05:30:05 to 05:33:55, the journal's 3 min 50 s.
    expect(breakRow.textContent).toBe("Перерыв4 мин05:30–05:33")
    expect(breakRow.querySelector("button, a, [tabindex], [role='button']")).toBeNull()
    await act(async () => { (breakRow.querySelector("span") as HTMLElement).click() })
    expect(focused).toEqual([])
    expect(data.trip.summary).toMatchObject({ movingSeconds: 60 * 60 - 230, pausedSeconds: 230, unknownSeconds: 0 })

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

  // Verification of 2026-10-20: the whole silence around a break took one
  // name. A one-minute break inside six minutes without a fix read «Перерыв
  // 6 мин» and «перерыв 6 мин» in the summary — against the journal and the
  // attendance report — and a break with a few seconds too many of silence
  // around it read «Нет данных» with no «Перерыв» at all, a red line and a
  // clickable row across it. Each day goes through the detectors and the trip
  // builder the API runs, then the ledger and the map, as the page shows them.
  describe("is exactly as long as the journal says, whatever the silence around it", () => {
    const utc = (clock: string) => new Date(`${DAY}T${clock}.000Z`)
    const cases: Array<{
      name: string
      fixes: () => HistoryLocationPoint[]
      lunch: [string, string]
      rows: string[]
      paused: number
      unknown: number
      /** The last fix before the silence and the first after it. */
      silence: [string, string]
    }> = [
      {
        name: "a one-minute break in six minutes without a fix",
        fixes: () => [...track("09:00", "09:26", HOME, PHARMACY), ...track("09:32", "10:00", CAFE_STREET, CLINIC)],
        lunch: ["09:30:30", "09:31:30"],
        rows: ["Начал день", "В пути", "Перерыв1 мин09:30–09:31", "В пути", "Закрыл день"],
        paused: 60,
        unknown: 0,
        silence: ["09:26:00", "09:32:00"],
      },
      {
        name: "115 s of break with 305 s of silence left over — 5 s before it, 300 s after",
        fixes: () => [...track("09:00", "09:30", HOME, PHARMACY), ...track("09:37", "10:00", CAFE_STREET, CLINIC)],
        lunch: ["09:30:05", "09:32:00"],
        rows: ["Начал день", "В пути", "Перерыв2 мин09:30–09:32", "В пути", "Закрыл день"],
        paused: 115,
        unknown: 0,
        silence: ["09:30:00", "09:37:00"],
      },
      {
        name: "four minutes, the fixes right before «Перерыв» and right after «Продолжить»",
        fixes: () => [...track("09:00", "09:30", HOME, PHARMACY), ...track("09:34", "10:00", CAFE_STREET, CLINIC)],
        lunch: ["09:30:05", "09:33:55"],
        rows: ["Начал день", "В пути", "Перерыв4 мин09:30–09:33", "В пути", "Закрыл день"],
        paused: 230,
        unknown: 0,
        silence: ["09:30:00", "09:34:00"],
      },
      {
        name: "an hour without a fix around a four-minute break",
        fixes: () => [...track("09:00", "09:30", HOME, PHARMACY), ...track("10:30", "11:00", CAFE_STREET, CLINIC)],
        lunch: ["10:00:00", "10:04:00"],
        rows: [
          "Начал день", "В пути",
          "Нет данных с телефона30 мин09:30–10:00", "Перерыв4 мин10:00–10:04", "Нет данных с телефона26 мин10:04–10:30",
          "В пути", "Закрыл день",
        ],
        paused: 240,
        unknown: 56 * 60,
        silence: ["09:30:00", "10:30:00"],
      },
    ]

    it.each(cases)("$name", async ({ fixes: make, lunch, rows: expectedRows, paused, unknown, silence }) => {
      const fixes = make()
      const breaks = mtmWorkdayPauses([
        { type: "PAUSE", occurredAt: utc(lunch[0]) },
        { type: "RESUME", occurredAt: utc(lunch[1]) },
      ])
      const gaps = detectHistoryGaps(fixes, 300, breaks.map((pause) => ({ startedAt: pause.from, endedAt: pause.to })))
      const stops = detectHistoryStops({ points: fixes, visits: [], radiusMeters: 50, minimumSeconds: 5 * 60, offlineThresholdSeconds: 300, gaps })
      const workday = { startedAt: fixes[0].recordedAt, completedAt: fixes.at(-1)!.recordedAt }
      const trip = buildDayTrip({ points: fixes, stops, visits: [], gaps, workday })
      const data = JSON.parse(JSON.stringify({ points: fixes, gaps, trip })) as {
        trip: DayTripData
        points: ReturnType<typeof day>["points"]
        gaps: ReturnType<typeof day>["gaps"]
      }

      // The ledger: the break with the journal's length, and the silence on
      // either side of it a row only where that side alone is a lost signal.
      const focused: Array<DayTripFocus | null> = []
      await render(createElement(DayTripLedger, {
        trip: data.trip, multiDay: false, focusId: null, onFocus: (focus: DayTripFocus | null) => focused.push(focus),
        formatMoment: (value: string) => value.slice(11, 16),
        formatDuration: (seconds: number) => `${Math.round(seconds / 60)} мин`,
      }))
      const rows = [...container.querySelectorAll("li")]
      // A silence's row in full; of every other row its title.
      const read = (row: Element) => {
        const title = row.querySelector(".font-medium")?.textContent
        return title === "Перерыв" || title === "Нет данных с телефона" ? row.textContent : title
      }
      expect(rows.map(read)).toEqual(expectedRows)
      const breakRow = rows.find((row) => row.textContent?.startsWith("Перерыв"))!
      expect(breakRow.querySelector("button, a, [tabindex], [role='button']")).toBeNull()
      await act(async () => { (breakRow.querySelector("span") as HTMLElement).click() })
      expect(focused).toEqual([])
      expect(data.trip.summary).toMatchObject({ pausedSeconds: paused, unknownSeconds: unknown })
      // The figure the attendance report counts for the same break.
      expect(paused).toBe((utc(lunch[1]).getTime() - utc(lunch[0]).getTime()) / 1_000)

      // The map: the track cut at the break, and no line of any colour joins the two sides of it.
      await act(async () => { root.unmount() })
      root = createRoot(container)
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      try {
        await render(createElement(LocationHistoryMap, {
          points: data.points, stops: [], visits: [], workday: null, plannedRoutes: [], gaps: data.gaps,
          layers: { planned: true, actual: true, stops: true, visits: true, gaps: true },
          locale: "ru", timezone: "UTC", playbackIndex: data.points.length - 1,
        }))
        await act(async () => { await vi.advanceTimersByTimeAsync(150) })
      } finally {
        vi.useRealTimers()
      }
      const lines = [...container.querySelectorAll<HTMLElement>("[data-line]")]
        .map((line) => ({ color: line.dataset.line, positions: JSON.parse(line.dataset.positions ?? "[]") as Array<[number, number]> }))
      const before = data.points.find((point) => point.recordedAt === `${DAY}T${silence[0]}.000Z`)!
      const after = data.points.find((point) => point.recordedAt === `${DAY}T${silence[1]}.000Z`)!
      const near = (a: [number, number], b: { latitude: number; longitude: number }) =>
        Math.abs(a[0] - b.latitude) < 1e-6 && Math.abs(a[1] - b.longitude) < 1e-6
      const runs = lines.filter((line) => line.color === HISTORY_MAP_COLORS.track)
      expect(runs).toHaveLength(2)
      expect(lines.some((line) => line.positions.some((point) => near(point, before)) && line.positions.some((point) => near(point, after)))).toBe(false)
      expect(lines.filter((line) => line.color === HISTORY_MAP_COLORS.gap)).toEqual([])
    })
  })

  // Verification of 2026-10-20, round 4: the trip cut a stop at a break, but
  // the stop list, the map's popup and the timeline still gave it whole —
  // «1 ч 19 мин» at the spot where he had his lunch. The stops are cut once,
  // where they are made, and every reader has the same pieces. A visit with a
  // break inside it is named once, by its own check-in and check-out.
  describe("cuts the stops around it once, for every reader", () => {
    const utc = (clock: string) => new Date(`${DAY}T${clock}.000Z`)
    const ledger = async (trip: DayTripData) => {
      await render(createElement(DayTripLedger, {
        trip, multiDay: false, focusId: null, onFocus: () => {},
        formatMoment: (value: string) => value.slice(11, 16),
        formatDuration: (seconds: number) => `${Math.round(seconds / 60)} мин`,
      }))
      return [...container.querySelectorAll("li")].map((row) => row.textContent)
    }
    const historyOf = (fixes: HistoryLocationPoint[], lunch: [string, string], visits: HistoryVisit[] = [], dayOpen = false) => {
      const pauses = mtmWorkdayPauses([{ type: "PAUSE", occurredAt: utc(lunch[0]) }, { type: "RESUME", occurredAt: utc(lunch[1]) }])
        .map((pause) => ({ startedAt: pause.from, endedAt: pause.to }))
      const gaps = detectHistoryGaps(fixes, 300, pauses)
      // As the route does: the stop list reads the stops cut at the breaks,
      // and the trip cuts the detector's own by its rule.
      const detected = detectHistoryStops({ points: fixes, visits, radiusMeters: 50, minimumSeconds: 5 * 60, offlineThresholdSeconds: 300 })
      const stops = cutHistoryStopsAtBreaks(detected, { points: fixes, visits, gaps, minimumSeconds: 5 * 60, offlineThresholdSeconds: 300 })
      const workday = { startedAt: fixes[0].recordedAt, completedAt: dayOpen ? null : fixes.at(-1)!.recordedAt }
      const trip = buildDayTrip({ points: fixes, stops: detected, visits, gaps, workday, stopMinimumSeconds: 5 * 60 })
      return JSON.parse(JSON.stringify({ points: fixes, gaps, stops, trip })) as {
        points: ReturnType<typeof day>["points"]
        gaps: ReturnType<typeof day>["gaps"]
        stops: Array<{ id: string; latitude: number; longitude: number; startedAt: string; endedAt: string; durationSeconds: number; pointCount: number; averageAccuracy: number | null; batteryStart: number | null; batteryEnd: number | null; connectivity: "ONLINE" | "OFFLINE_GAPS"; visit: { customerName: string; customerAddress: string | null; confirmed: true } | null }>
        trip: DayTripData
      }
    }
    const aptek = (checkIn: string, checkOut: string): HistoryVisit => ({
      id: "v1", customerId: "c1", status: "CHECKED_OUT", checkInAt: utc(checkIn), checkOutAt: utc(checkOut),
      checkInLat: PHARMACY[0], checkInLng: PHARMACY[1],
      customer: { name: "Aptek 24", address: null, latitude: PHARMACY[0], longitude: PHARMACY[1] },
    })

    it("a 38-minute lunch at one spot: the map's popups give each stop its own minutes, as the trip does", async () => {
      const fixes = [
        ...track("09:00", "09:10", HOME, PHARMACY),
        ...track("09:10", "09:35", PHARMACY, PHARMACY),
        ...track("10:14", "10:29", PHARMACY, PHARMACY),
        ...track("10:29", "10:40", PHARMACY, CLINIC),
      ].filter((point, index, all) => index === 0 || point.recordedAt > all[index - 1].recordedAt)
      const data = historyOf(fixes, ["09:35:50", "10:13:50"])
      expect((await ledger(data.trip)).slice(2, 5)).toEqual([
        "Остановка без визита26 мин09:10–09:35", "Перерыв38 мин09:35–10:13", "Остановка без визита15 мин10:13–10:29",
      ])
      await act(async () => { root.unmount() })
      root = createRoot(container)
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      try {
        await render(createElement(LocationHistoryMap, {
          points: data.points, stops: data.stops, visits: [], workday: null, plannedRoutes: [], gaps: data.gaps,
          layers: { planned: true, actual: false, stops: true, visits: true, gaps: true },
          locale: "ru", timezone: "UTC", playbackIndex: data.points.length - 1,
        }))
        await act(async () => { await vi.advanceTimersByTimeAsync(150) })
      } finally {
        vi.useRealTimers()
      }
      const popups = [...container.querySelectorAll<HTMLElement>(`[data-marker="#b45309"] [data-popup]`)]
      expect(popups.map((popup) => [...popup.querySelectorAll("div")].map((line) => line.textContent).filter((line) => line?.startsWith("Длительность")))).toEqual([
        ["Длительность: 26 мин"],
        ["Длительность: 15 мин"],
      ])
    })

    it("a visit with a break inside it is named once, by its own check-in and check-out; after the break, the same place", async () => {
      const fixes = [
        ...track("11:30", "12:00", CAFE_STREET, PHARMACY),
        ...track("12:00", "12:25", PHARMACY, PHARMACY),
        ...track("13:05", "13:30", PHARMACY, PHARMACY),
        ...track("13:30", "13:50", PHARMACY, CLINIC),
      ].filter((point, index, all) => index === 0 || point.recordedAt > all[index - 1].recordedAt)
      const data = historyOf(fixes, ["12:26:00", "13:04:00"], [aptek("12:01:00", "13:29:00")])
      const rows = await ledger(data.trip)
      expect(rows.slice(2, 5)).toEqual([
        "Aptek 24Визит 12:01–13:2911:59–12:26",
        "Перерыв38 мин12:26–13:04",
        "Там же, после перерыва26 мин13:04–13:30",
      ])
      expect(rows.filter((row) => row?.includes("Aptek 24"))).toHaveLength(1)
      expect(data.trip.summary).toMatchObject({ visitCount: 1, pausedSeconds: 38 * 60 })
    })

    it("parked at the door, checked in, a break, checked out: the visit, not «Визит 0 мин»", async () => {
      const fixes = [
        ...track("09:00", "09:10", HOME, PHARMACY),
        ...track("09:40", "09:40", PHARMACY, PHARMACY),
        ...track("09:41", "09:50", CAFE_STREET, CLINIC),
      ].filter((point, index, all) => index === 0 || point.recordedAt > all[index - 1].recordedAt)
      const data = historyOf(fixes, ["09:10:20", "09:39:50"], [aptek("09:10:10", "09:40:20")])
      const rows = await ledger(data.trip)
      expect(rows.filter((row) => row?.includes("Aptek 24"))).toEqual(["Aptek 24Визит 09:10–09:4009:10–09:10"])
      // The piece after the break, ten seconds at the door, does not name the
      // visit again — and is not the drive's either: he was still checked in
      // there. The drive starts at his last fix at the door (09:40); the fix
      // after it is 2 km off, so the check-out at 09:40:20 was pressed on the road.
      expect(rows).toEqual([
        "Начал день09:00", expect.stringMatching(/^В пути10 мин/), "Aptek 24Визит 09:10–09:4009:10–09:10",
        "Перерыв30 мин09:10–09:39", "Там же, после перерыва0 мин09:39–09:40", expect.stringMatching(/^В пути10 мин.*09:40–09:50$/), "Закрыл день09:50",
      ])
      // «Детали остановок» still lists no stop of a few seconds.
      expect(data.stops).toEqual([])
    })

    // Verification of round 5: checked in, «Перерыв» three minutes later. The
    // stop list has no stop of three minutes; the trip has them as the visit —
    // they were «В пути» across the check-in.
    it("checked in, a break three minutes later: those minutes are the visit, not «В пути»", async () => {
      const fixes = [
        ...track("09:00", "10:00", HOME, PHARMACY),
        ...track("10:00", "10:03", PHARMACY, PHARMACY),
        ...track("10:33", "11:10", PHARMACY, PHARMACY),
        ...track("11:10", "11:30", PHARMACY, CLINIC),
      ].filter((point, index, all) => index === 0 || point.recordedAt > all[index - 1].recordedAt)
      const data = historyOf(fixes, ["10:03:00", "10:33:00"], [aptek("10:00:30", "11:10:00")])
      expect(data.stops.map((stop) => [stop.startedAt.slice(11, 16), stop.endedAt.slice(11, 16)])).toEqual([["10:33", "11:10"]])
      expect(await ledger(data.trip)).toEqual([
        "Начал день09:00", expect.stringMatching(/^В пути60 мин.*09:00–10:00$/), "Aptek 24Визит 10:00–11:1010:00–10:03",
        "Перерыв30 мин10:03–10:33", "Там же, после перерыва37 мин10:33–11:10", expect.stringMatching(/^В пути.*11:10–11:30$/), "Закрыл день11:30",
      ])
    })

    // Verification of round 6 (E10): he is at the customer's now, the visit
    // not closed, a break taken in the middle of it. The open visit had no
    // check-out to overlap, and after «Продолжить» the ledger read
    // «Остановка без визита» at the same customer's.
    it("a visit still open, a break inside it: named once, «Визит не закрыт», then the same place", async () => {
      const fixes = [
        ...track("09:00", "10:00", HOME, PHARMACY),
        ...track("10:00", "10:20", PHARMACY, PHARMACY),
        ...track("10:50", "11:10", PHARMACY, PHARMACY),
      ].filter((point, index, all) => index === 0 || point.recordedAt > all[index - 1].recordedAt)
      const open = { ...aptek("10:00:30", "10:00:30"), status: "CHECKED_IN", checkOutAt: null }
      const data = historyOf(fixes, ["10:20:10", "10:50:00"], [open], true)
      expect(data.stops.map((stop) => [stop.startedAt.slice(11, 16), stop.endedAt.slice(11, 16), stop.visit?.customerName ?? null])).toEqual([
        ["10:00", "10:20", "Aptek 24"],
        ["10:50", "11:10", "Aptek 24"],
      ])
      expect((await ledger(data.trip)).slice(2)).toEqual([
        "Aptek 24Визит не закрыт10:00–10:20", "Перерыв30 мин10:20–10:50", "Там же, после перерыва20 мин10:50–11:10", "Последний сигнал, день не закрыт11:10",
      ])
    })

    // Round 5: the day still open, no fix since «Продолжить». The day ends at
    // that press, and the row does not call it a signal.
    it("the day open, no fix since «Продолжить»: the end says so, not «Последний сигнал»", async () => {
      const fixes = track("09:00", "10:00", HOME, PHARMACY)
      const rows = await ledger(historyOf(fixes, ["10:00:30", "10:30:00"], [], true).trip)
      expect(rows.slice(-2)).toEqual(["Перерыв30 мин10:00–10:30", "Продолжил после перерыва, сигнала нет10:30"])
      await act(async () => { root.unmount() })
      root = createRoot(container)
      const signal = [...fixes, ...track("10:31", "10:40", PHARMACY, CLINIC)]
      expect((await ledger(historyOf(signal, ["10:00:30", "10:30:00"], [], true).trip)).at(-1)).toBe("Последний сигнал, день не закрыт10:40")
    })
  })
})
