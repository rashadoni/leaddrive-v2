// @vitest-environment jsdom
/**
 * The tools of the live map taken from the tracker shown to the owner as the
 * model (2026-10-09: «отличный пример нашёл, бери почти всё, чего нет у нас»):
 * the tail behind a marker, names beside markers, a ruler, an address or a
 * point on the map — and the list's answer to «who is nearest to it».
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
vi.mock("@/components/mtm/live-map", () => ({}))

import type { MtmDashboardAgent } from "@/lib/mtm-types"
import {
  extendLiveMapTrails,
  liveMapTrailSegments,
  pathLengthMeters,
  TRAIL_MAX_POINTS,
  type LiveMapTrails,
} from "@/lib/mtm/live-map-trails"
import {
  applyRosterFilters,
  availableRosterColumns,
  onlyRosterFilterValue,
  ROSTER_DEFAULT_VIEW,
  rosterDistanceToPoint,
  rosterValue,
  sortRoster,
} from "@/lib/mtm/live-map-roster"
import { LiveMapRoster } from "@/components/mtm/live-map-roster"
import { LiveMapTools } from "@/components/mtm/live-map-tools"

const NOW = Date.parse("2026-10-09T10:00:00.000Z")
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()
// A degree of latitude on the sphere the product measures on (radius 6371 km).
const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180
const BAKU = { latitude: 40.4093, longitude: 49.8671 }
const north = (meters: number) => ({ latitude: BAKU.latitude + meters / METERS_PER_DEGREE, longitude: BAKU.longitude })

function person(agentId: string, name: string, over: Partial<MtmDashboardAgent> = {}): MtmDashboardAgent {
  return {
    agentId, name, isOnline: true, fieldStatus: "ON_ROAD", freshness: "ONLINE", workdayState: "ACTIVE",
    routeCompletion: 0, locationState: "AVAILABLE", recordedAt: at(1), teamId: null, teamName: null,
    routeVisited: 0, routeTotal: 0, speed: 30, battery: 80, ...BAKU,
    ...over,
  }
}

describe("«След»: where an employee has just been", () => {
  const seen = (trails: LiveMapTrails, agentId: string) => (trails.get(agentId) ?? []).map((point) => Math.round((point.latitude - BAKU.latitude) * METERS_PER_DEGREE))

  it("grows by one position per answer, only when he has really moved", () => {
    let trails: LiveMapTrails = new Map()
    trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(0), recordedAt: at(3) }], NOW)
    trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(120), recordedAt: at(2) }], NOW)
    // GPS wandering a few metres while he stands is not a journey.
    trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(126), recordedAt: at(1.5) }], NOW)
    // The same answer again (a poll that brought nothing new) adds nothing.
    trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(120), recordedAt: at(2) }], NOW)
    trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(300), recordedAt: at(1) }], NOW)
    expect(seen(trails, "a")).toEqual([0, 120, 300])
  })

  it("is made of nothing but admissible coordinates, and never of a point older than the last one", () => {
    let trails: LiveMapTrails = new Map()
    trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(0), recordedAt: at(2) }], NOW)
    trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(500), recordedAt: at(5) }], NOW)
    trails = extendLiveMapTrails(trails, [{ agentId: "a", latitude: 95, longitude: 49, recordedAt: at(1) }], NOW)
    trails = extendLiveMapTrails(trails, [{ agentId: "a", latitude: null, longitude: null, recordedAt: at(1) }], NOW)
    trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(500), recordedAt: "not a time" }], NOW)
    expect(seen(trails, "a")).toEqual([0])
  })

  it("is the last half hour and no longer; a name search that hides somebody for a moment does not cost him his tail", () => {
    let trails: LiveMapTrails = new Map()
    trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(0), recordedAt: at(29) }, { agentId: "b", ...north(0), recordedAt: at(1) }], NOW)
    // «b» is not in this answer (the roster was narrowed by a search).
    trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(400), recordedAt: at(1) }], NOW + 2 * 60_000)
    // The first point of «a» is now 31 minutes old.
    expect(seen(trails, "a")).toEqual([400])
    expect(seen(trails, "b")).toEqual([0])
    // …and comes back on to it when he is in the answer again.
    trails = extendLiveMapTrails(trails, [{ agentId: "b", ...north(250), recordedAt: at(-3) }], NOW + 3 * 60_000)
    expect(seen(trails, "b")).toEqual([0, 250])
    // What nobody has added to for half an hour is gone, answer or no answer.
    expect(extendLiveMapTrails(trails, [], NOW + 40 * 60_000).size).toBe(0)
    // A coordinate that was already too old when it arrived starts no tail.
    expect(extendLiveMapTrails(new Map(), [{ agentId: "c", ...north(0), recordedAt: at(45) }], NOW).has("c")).toBe(false)
    let long: LiveMapTrails = new Map()
    for (let step = 0; step < TRAIL_MAX_POINTS + 15; step += 1) {
      long = extendLiveMapTrails(long, [{ agentId: "a", ...north(step * 50), recordedAt: new Date(NOW - (25 * 60_000) + step * 20_000).toISOString() }], NOW)
    }
    expect(long.get("a")).toHaveLength(TRAIL_MAX_POINTS)
  })

  it("is not drawn across a silence: a line through buildings he never walked through", () => {
    const points = [
      { ...north(0), recordedAt: at(20) },
      { ...north(200), recordedAt: at(19) },
      // Eight minutes with no signal, then two kilometres away.
      { ...north(2_200), recordedAt: at(11) },
      { ...north(2_400), recordedAt: at(10) },
      { ...north(2_600), recordedAt: at(9) },
    ]
    expect(liveMapTrailSegments(points).map((segment) => segment.length)).toEqual([2, 3])
    // One lonely point is not a line.
    expect(liveMapTrailSegments([points[0], points[2]])).toEqual([])
    expect(liveMapTrailSegments([])).toEqual([])
  })

  it("is not broken by a stop: the phone was not silent while he stood at a client", () => {
    // Drives, stands for eight minutes reporting every half minute, drives on.
    let trails: LiveMapTrails = new Map()
    const report = (meters: number, secondsFromStart: number) => {
      const when = NOW - 20 * 60_000 + secondsFromStart * 1_000
      trails = extendLiveMapTrails(trails, [{ agentId: "a", ...north(meters), recordedAt: new Date(when).toISOString() }], when)
    }
    report(0, 0)
    report(300, 30)
    for (let second = 60; second <= 540; second += 30) report(300 + (second % 60 === 0 ? 4 : -3), second)
    report(700, 570)
    report(1_100, 600)
    const points = trails.get("a") ?? []
    // Standing added no points — but the place he stood at was heard from until he left.
    expect(points.map((point) => Math.round((point.latitude - BAKU.latitude) * METERS_PER_DEGREE))).toEqual([0, 300, 700, 1_100])
    expect(Date.parse(points[1].heardAt ?? "") - Date.parse(points[1].recordedAt)).toBe(510_000)
    expect(liveMapTrailSegments(points).map((segment) => segment.length)).toEqual([4])
    // A point he is still standing on does not age out from under him.
    const stillThere = extendLiveMapTrails(new Map([["a", [{ ...north(0), recordedAt: at(50), heardAt: at(1) }]]]), [], NOW)
    expect(stillThere.get("a")).toHaveLength(1)
  })

  it("measures a ruler's line as the sum of its segments", () => {
    expect(pathLengthMeters([])).toBe(0)
    expect(pathLengthMeters([north(0)])).toBe(0)
    expect(Math.round(pathLengthMeters([north(0), north(1_000), north(400)]))).toBe(1_600)
  })
})

describe("«who is nearest» — the distance to the point picked on the map", () => {
  const point = north(0)
  const team = [
    person("far", "Fərid", north(7_400)),
    person("near", "Nigar", north(450)),
    person("stale", "Samir", { ...north(100), freshness: "STALE", fieldStatus: "OFFLINE" }),
    person("none", "Nərmin", { latitude: undefined, longitude: undefined, freshness: "NO_LOCATION", fieldStatus: "OFFLINE" }),
    person("mid", "Murad", { ...north(3_000), freshness: "DELAYED" }),
  ]
  const measured = team.map((agent) => ({ ...agent, distanceMeters: rosterDistanceToPoint(agent, point) }))

  it("is measured from where somebody is now — not from where he was yesterday", () => {
    expect(measured.map((agent) => agent.distanceMeters == null ? null : Math.round(agent.distanceMeters))).toEqual([7_400, 450, null, null, 3_000])
  })

  it("puts the nearest first and the people with no live position last, whichever way it is sorted", () => {
    const ids = (direction: "asc" | "desc") => sortRoster(measured, { column: "distance", direction }, "az").map((agent) => agent.agentId)
    expect(ids("asc")).toEqual(["near", "mid", "far", "none", "stale"])
    expect(ids("desc")).toEqual(["far", "mid", "near", "none", "stale"])
  })

  it("is a column only while a point is picked, with its own classes to filter by", () => {
    expect(availableRosterColumns(team, { workforceEnabled: true })).not.toContain("distance")
    expect(availableRosterColumns(measured, { workforceEnabled: true })).toContain("distance")
    expect(measured.map((agent) => rosterValue(agent, "distance"))).toEqual(["FAR", "NEAR", "UNKNOWN", "UNKNOWN", "CLOSE"])
    expect(applyRosterFilters(measured, { distance: onlyRosterFilterValue("NEAR") }).map((agent) => agent.agentId)).toEqual(["near"])
  })

  describe("in the list", () => {
    let root: Root
    let container: HTMLDivElement
    const draw = async (agents: MtmDashboardAgent[]) => {
      const rows = sortRoster(agents, { column: "distance", direction: "asc" }, "ru")
      await act(async () => {
        root.render(createElement(LiveMapRoster, {
          agents, rows, searchSlot: null, filters: {}, onFiltersChange: () => {},
          view: { ...ROSTER_DEFAULT_VIEW, sort: { column: "distance", direction: "asc" } }, onViewChange: () => {}, onHide: () => {},
          hiddenAgentIds: new Set<string>(), onToggleAgentOnMap: () => {}, onSetAgentsOnMap: () => {},
          selectedAgentId: null, onSelect: () => {}, renderDetail: () => null, nowMs: NOW, workforceEnabled: true,
          formatClock: () => "", formatVisitOpened: () => "", isEarlierDay: () => false,
          formatDistance: (meters: number) => meters < 1_000 ? `${Math.round(meters)} м` : `${(meters / 1_000).toFixed(1).replace(".", ",")} км`,
        }))
      })
    }
    const cell = (agentId: string, column: string) => container.querySelector(`[data-testid="live-map-agent-card-${agentId}"] [data-column="${column}"]`) as HTMLElement | null

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

    it("takes the place of the signal's age beside the map, says the distance in words, and a dash for nobody to measure", async () => {
      await draw(measured)
      expect([cell("near", "distance")?.textContent, cell("mid", "distance")?.textContent, cell("far", "distance")?.textContent, cell("stale", "distance")?.textContent])
        .toEqual(["450 м", "3,0 км", "7,4 км", "—"])
      // Beside the map: name, status, distance. The signal waits for the wide table.
      expect(cell("near", "distance")?.className).not.toContain("hidden")
      expect(cell("near", "signal")?.className).toContain("hidden @2xl:block")
      // The distance heading carries a sort arrow by default: it gets the room for it.
      expect((container.querySelector('[data-testid="live-map-roster"]') as HTMLElement).style.getPropertyValue("--roster-narrow")).toBe("2.25rem minmax(0,1.4fr) minmax(0,1fr) 6.5rem")
      expect((container.querySelector('[data-testid="roster-column-distance"]') as HTMLElement).textContent).toBe("До точки")
      expect((container.querySelector('[data-testid="roster-column-distance"]') as HTMLElement).closest('[role="columnheader"]')?.getAttribute("aria-sort")).toBe("ascending")
    })

    it("is not there at all without a point", async () => {
      await draw(team)
      expect(cell("near", "distance")).toBeNull()
      expect(container.querySelector('[data-testid="roster-column-distance"]')).toBeNull()
      expect(cell("near", "signal")?.className).not.toContain("hidden")
    })
  })
})

describe("the tools on the map, in words", () => {
  let root: Root
  let container: HTMLDivElement
  let state: { point: { latitude: number; longitude: number; label: string } | null; picking: boolean; ruler: boolean; fullscreen: boolean; rulerPoints: Array<{ latitude: number; longitude: number }> }
  let fullscreenSupported: boolean
  let requests: string[]
  let answer: () => Response

  const draw = async () => {
    await act(async () => {
      root.render(createElement(LiveMapTools, {
        near: BAKU,
        referencePoint: state.point,
        onReferencePointChange: (point) => { state.point = point },
        pickingPoint: state.picking,
        onPickingPointChange: (picking) => { state.picking = picking },
        rulerActive: state.ruler,
        onRulerToggle: () => { state.ruler = !state.ruler; state.rulerPoints = [] },
        rulerMeters: pathLengthMeters(state.rulerPoints),
        rulerPointCount: state.rulerPoints.length,
        onRulerUndo: () => { state.rulerPoints = state.rulerPoints.slice(0, -1) },
        formatDistance: (meters: number) => meters < 1_000 ? `${Math.round(meters)} м` : `${(meters / 1_000).toFixed(1).replace(".", ",")} км`,
        fullscreen: state.fullscreen,
        onFullscreenToggle: () => { state.fullscreen = !state.fullscreen },
        fullscreenSupported,
      }))
    })
  }
  const byTestId = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const press = async (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error("element not found")
    await act(async () => { element.click() })
    await draw()
  }
  const type = async (value: string) => {
    const input = byTestId("live-map-address-input") as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
  }
  const submit = async () => {
    await act(async () => {
      byTestId("live-map-point-panel")!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await draw()
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    state = { point: null, picking: false, ruler: false, fullscreen: false, rulerPoints: [] }
    fullscreenSupported = true
    requests = []
    answer = () => Response.json({ success: true, data: { results: [
      { label: "Həsən bəy Zərdabi prospekti, 79B, Bakı", latitude: 40.3781, longitude: 49.8194 },
      { label: "Zərdabi küçəsi, Sumqayıt", latitude: 40.5897, longitude: 49.6686 },
    ] } })
    vi.stubGlobal("fetch", vi.fn(async (input: string) => { requests.push(String(input)); return answer() }))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("says what each tool does, and offers the full screen only where the browser has one", async () => {
    await draw()
    expect([byTestId("live-map-tool-point")?.textContent, byTestId("live-map-tool-ruler")?.textContent, byTestId("live-map-tool-fullscreen")?.textContent])
      .toEqual(["Адрес или точка", "Линейка", "Весь экран"])
    await press(byTestId("live-map-tool-ruler"))
    expect(state.ruler).toBe(true)
    expect(byTestId("live-map-tool-ruler")?.getAttribute("aria-pressed")).toBe("true")
    await press(byTestId("live-map-tool-fullscreen"))
    expect(byTestId("live-map-tool-fullscreen")?.textContent).toBe("Обычный размер")
    fullscreenSupported = false
    await draw()
    expect(byTestId("live-map-tool-fullscreen")).toBeNull()
  })

  it("finds an address on «Найти» — not on every letter — near where the map is looking, and takes the one that is pressed", async () => {
    await draw()
    expect(byTestId("live-map-point-panel")).toBeNull()
    await press(byTestId("live-map-tool-point"))
    await type("Zərdabi 79")
    // The search service allows one request a second: typing alone asks nothing.
    expect(requests).toEqual([])
    await submit()
    expect(requests).toHaveLength(1)
    const asked = new URL(requests[0], "http://localhost")
    expect([asked.pathname, asked.searchParams.get("q"), asked.searchParams.get("lang"), asked.searchParams.get("lat"), asked.searchParams.get("lng")])
      .toEqual(["/api/v1/mtm/geocode", "Zərdabi 79", "ru", "40.4093", "49.8671"])
    const hits = [...byTestId("live-map-address-hits")!.querySelectorAll("button")]
    expect(hits.map((hit) => hit.textContent)).toEqual(["Həsən bəy Zərdabi prospekti, 79B, Bakı", "Zərdabi küçəsi, Sumqayıt"])
    await press(hits[0])
    expect(state.point).toEqual({ latitude: 40.3781, longitude: 49.8194, label: "Həsən bəy Zərdabi prospekti, 79B, Bakı" })
    // The panel closes; what the list is now sorted by stays in sight, with a way out.
    expect(byTestId("live-map-point-panel")).toBeNull()
    expect(byTestId("live-map-point-chip")?.textContent).toBe("Ближайшие к: Həsən bəy Zərdabi prospekti, 79B, BakıУбрать")
    // With the panel open again the chip steps aside: on a phone the two together are taller than the map.
    await press(byTestId("live-map-tool-point"))
    expect(byTestId("live-map-point-chip")).toBeNull()
    await press(byTestId("live-map-tool-point"))
    await press(byTestId("live-map-point-clear"))
    expect(state.point).toBeNull()
    expect(byTestId("live-map-point-chip")).toBeNull()
  })

  it("shows the best three results, so the search field stays inside a phone's map", async () => {
    answer = () => Response.json({ success: true, data: { results: Array.from({ length: 5 }, (_unused, index) => ({ label: `Nizami küçəsi ${index + 1}, Bakı`, latitude: 40.37 + index / 1_000, longitude: 49.83 })) } })
    await draw()
    await press(byTestId("live-map-tool-point"))
    await type("Nizami")
    await submit()
    const hits = [...byTestId("live-map-address-hits")!.querySelectorAll("button")]
    expect(hits.map((hit) => hit.textContent)).toEqual(["Nizami küçəsi 1, Bakı", "Nizami küçəsi 2, Bakı", "Nizami küçəsi 3, Bakı"])
    // A long address is cut to two lines here; the whole of it is in the tooltip.
    expect(hits[0].getAttribute("title")).toBe("Nizami küçəsi 1, Bakı")
    expect(hits[0].querySelector("span")?.className).toContain("line-clamp-2")
  })

  it("says in words why a search gave nothing", async () => {
    await draw()
    await press(byTestId("live-map-tool-point"))
    await type("ab")
    await submit()
    expect(requests).toEqual([])
    expect(byTestId("live-map-address-notice")?.textContent).toBe("Введите хотя бы 3 буквы")

    await type("Несуществующая улица")
    answer = () => Response.json({ success: true, data: { results: [] } })
    await submit()
    expect(byTestId("live-map-address-notice")?.textContent).toBe("Ничего не найдено. Напишите улицу так, как она названа на карте.")
    answer = () => Response.json({ error: "Too many" }, { status: 429 })
    await submit()
    expect(byTestId("live-map-address-notice")?.textContent).toBe("Слишком много запросов. Попробуйте через минуту.")
    answer = () => Response.json({ error: "down" }, { status: 502 })
    await submit()
    expect(byTestId("live-map-address-notice")?.textContent).toBe("Поиск адреса сейчас недоступен")
    expect(state.point).toBeNull()
  })

  it("lets a point be marked by a press on the map instead, says so while it waits, and can be called off", async () => {
    await draw()
    await press(byTestId("live-map-tool-point"))
    await press(byTestId("live-map-pick-point"))
    expect(state.picking).toBe(true)
    expect(byTestId("live-map-point-panel")).toBeNull()
    // The tool stays lit while the map waits for the press, and the hint has its own way out.
    expect(byTestId("live-map-tool-point")?.className).toContain("bg-primary")
    expect(byTestId("live-map-picking")?.textContent).toBe("Нажмите на карту в нужном местеОтмена")
    await press(byTestId("live-map-picking-cancel"))
    expect(state.picking).toBe(false)
    expect(byTestId("live-map-picking")).toBeNull()
    // Pressing the tool itself again calls it off too.
    state.picking = true
    await draw()
    await press(byTestId("live-map-tool-point"))
    expect(state.picking).toBe(false)
  })

  it("reads the ruler out in words beside the tools: what it measures, how to go on, how to take a point back", async () => {
    await draw()
    expect(byTestId("live-map-ruler")).toBeNull()
    await press(byTestId("live-map-tool-ruler"))
    expect(byTestId("live-map-ruler")?.textContent).toBe("Линейка: 0 мНажмите на карту, чтобы поставить первую точкуГотово")
    // Three presses on the map: 1 km north, then 400 m back.
    state.rulerPoints = [north(0), north(1_000), north(600)]
    await draw()
    expect(byTestId("live-map-ruler-total")?.textContent).toBe("Линейка: 1,4 км")
    expect(byTestId("live-map-ruler")?.textContent).toContain("Каждое нажатие добавляет отрезок")
    await press(byTestId("live-map-ruler-undo"))
    expect(byTestId("live-map-ruler-total")?.textContent).toBe("Линейка: 1,0 км")
    // «Готово» switches the ruler off, and it forgets its points.
    await press(byTestId("live-map-ruler-done"))
    expect([state.ruler, state.rulerPoints.length]).toEqual([false, 0])
    expect(byTestId("live-map-ruler")).toBeNull()
  })
})

describe("the wiring of the tools", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/map/page.tsx", "utf8")
  const map = readFileSync("src/components/mtm/live-map.tsx", "utf8")

  it("makes the tail of the roster's own answers and loads nothing for it", () => {
    // SWM-12: live mode never loads a day's GPS. One position per employee per answer.
    // …and only a position the map itself would draw at that moment: not a
    // coordinate shared with the workday closed, not a stale one.
    expect(page).toMatch(/setTrails\(\(current\) => extendLiveMapTrails\(\s*current,\s*nextAgents\.filter\(\(agent\) => hasRenderableLivePosition\(agent\.freshness, agent\.workdayState, nextContract\.workforceEnabled\)\),\s*Date\.parse\(nextContract\.generatedAt\),/)
    expect(page.match(/setTrails\(/g) ?? []).toHaveLength(2)
    expect(page).toContain("trails={mapLook.trails ? trails : null}")
    expect(page).not.toContain("replayTrack=")
    // Drawn for people shown on their own; a cluster is a count, not a person.
    expect(map).toMatch(/trails \? markerSelection\.markers\.flatMap\(\(marker\) => \{\s*if \(marker\.kind !== "AGENT"\) return \[\]/)
  })

  it("keeps a name beside every marker when asked, and says who it is under the pointer otherwise", () => {
    expect(map).toContain('<Tooltip direction="top" key={showLabels ? "label" : "hover"} permanent={showLabels}')
    expect(page).toContain('{ id: "labels", label: tMap("layers.labels"), hint: tMap("layers.labelsHint"), on: mapLook.labels')
    expect(page).toContain('{ id: "trails", label: tMap("layers.trails"), hint: tMap("layers.trailsHint"), on: mapLook.trails')
    expect(page).toContain('{ id: "glide", label: tMap("layers.glide"), hint: tMap("layers.glideHint"), on: mapLook.glide')
  })

  it("glides a marker only for a real, short move that somebody is watching", () => {
    expect(map).toContain("if (!enabled || still || meters < 1 || meters > GLIDE_MAX_METERS) {")
    // A new position arriving mid-glide starts from where the marker is, not from where it set out.
    expect(map).toContain("const from = shownRef.current")
    expect(map).toContain('document.visibilityState !== "visible"')
    expect(map).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches')
    expect(map).toContain("glide={glideMarkers}")
  })

  it("gives a press on the map to the ruler first, then to «point on the map», and to neither otherwise", () => {
    expect(page).toMatch(/if \(rulerActive\) setRulerPoints\(\(points\) => \[\.\.\.points, \{ latitude, longitude \}\]\)\s*else if \(pickingPoint\) changeReferencePoint\(\{ latitude, longitude, label: pickedPointLabel \}\)/)
    expect(page).toContain('pressMode={rulerActive ? "ruler" : pickingPoint ? "point" : null}')
    // With no tool waiting the map does not listen for presses at all.
    expect(map).toContain("<MapPresses active={pressMode != null} onPress={handleMapPress} />")
    expect(map).toMatch(/click: \(event\) => \{\s*if \(active\) onPress\(event\.latlng\.lat, event\.latlng\.lng\)/)
    // Two quick presses are two points, not a zoom.
    expect(map).toContain("map.doubleClickZoom.disable()")
    // A press on an employee or on a stop is the tool's too — «measure from him» — and opens no balloon.
    expect(map).toContain("click: () => pressMode ? onMapPress?.(agent.latitude, agent.longitude) : onAgentSelect?.(agent.agentId)")
    expect(map).toContain("click: () => pressMode ? onMapPress?.(stop.latitude, stop.longitude) : onStopSelect?.(stop.orderIndex)")
    expect(map.match(/\{pressMode \? null : <Popup>/g) ?? []).toHaveLength(2)
    // Switched on or off, the ruler starts from nothing.
    expect(page).toMatch(/const switchRuler = useCallback\(\(on: boolean\) => \{\s*setRulerActive\(on\)\s*setRulerPoints\(\[\]\)/)
    // The two never wait for a press at the same time.
    expect(page).toContain("onPickingPointChange={(picking) => { setPickingPoint(picking); if (picking) switchRuler(false) }}")
    expect(page).toContain("onRulerToggle={() => { switchRuler(!rulerActive); setPickingPoint(false) }}")
  })

  it("turns the list to «nearest first» when a point is picked, until another order is asked for, and never remembers that order", () => {
    expect(page).toMatch(/setReferencePoint\(point\)\s*setNearestFirst\(point != null\)/)
    expect(page).toContain("const rosterSort: RosterSort = referencePoint && nearestFirst")
    expect(page).toContain("if (sortChosen) setNearestFirst(false)")
    expect(page).toContain('const stored: RosterView = view.sort.column === "distance" ? { ...view, sort: storedSortRef.current } : view')
    // Measured only from a position the map itself would draw (see the page-flow test for the behaviour).
    expect(page).toContain("return { ...presented, distanceMeters: drawn ? rosterDistanceToPoint(presented, referencePoint) : null }")
  })

  it("leaves the view to the dispatcher while a tool is in use, and frames who is on the map — not every move they make", () => {
    expect(map).toContain("hold={pressMode != null || rulerPoints.length > 0 || referencePoint != null}")
    // Held is the framing of the whole team; an employee selected meanwhile still gets his stops in view.
    expect(map).toContain("if (hold && !(focusAgentId && plannedRoute.length > 0)) return")
    // A point pressed on the map is on the screen already: no flying in on it.
    expect(map).toMatch(/if \(map\.getBounds\(\)\.contains\(\[latitude, longitude\]\)\) return\s*map\.flyTo\(\[latitude, longitude\]/)
    // The frame without a selection is keyed on the people, sorted: a move of eleven metres or a re-sorted list is not a new frame.
    expect(map).toContain('`all:${framedAgents.map((agent) => agent.agentId).sort().join("|")}:')
  })

  it("gives the map the whole screen through the browser's own full screen, on the map's frame", () => {
    expect(page).toContain('<div ref={mapFrameRef} data-testid="mtm-map-frame" className="relative isolate order-1')
    expect(page).toContain("void mapFrameRef.current?.requestFullscreen?.()?.catch?.(() => undefined)")
    expect(page).toContain('document.addEventListener("fullscreenchange", onChange)')
  })

  it("has every word of the tools in all three languages", () => {
    const paths = (node: Messages, prefix = ""): string[] => Object.entries(node).flatMap(([key, value]) =>
      typeof value === "string" ? [`${prefix}${key}`] : paths(value, `${prefix}${key}.`))
    const expected = paths((ru.mtmMap as Messages).tools as Messages)
    expect(expected.length).toBeGreaterThan(15)
    for (const locale of ["az", "en"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages
      expect(paths((messages.mtmMap as Messages).tools as Messages), locale).toEqual(expected)
      for (const key of ["labels", "labelsHint", "trails", "trailsHint", "glide", "glideHint"]) {
        expect(typeof ((messages.mtmMap as Messages).layers as Messages)[key], `${locale} layers.${key}`).toBe("string")
      }
    }
  })
})
