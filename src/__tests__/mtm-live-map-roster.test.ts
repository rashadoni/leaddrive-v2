// @vitest-environment jsdom
/**
 * The employee list beside the live map: a compact table with a filter in
 * every column heading.
 *
 * Owner, 2026-10-09, looking at three tall cards with cut-off names: «список
 * должен быть компактным, завтра будут например 100 пользователей. Нужны
 * фильтры прямо в списке, как в Excel». The cards took three lines each and
 * the only filter was one row of status chips above the map.
 */
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru[namespace]
    for (const part of key.split(".")) node = (node as Messages | undefined)?.[part]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))

import type { MtmDashboardAgent } from "@/lib/mtm-types"
import { parseMtmLiveMapContract } from "@/lib/mtm-types"
import {
  applyRosterFilters,
  availableRosterColumns,
  groupRoster,
  onlyRosterFilterValue,
  parseRosterView,
  pickRosterStatus,
  ROSTER_DEFAULT_VIEW,
  ROSTER_FILTER_NOTHING,
  ROSTER_NO_TEAM,
  rosterFilterAllows,
  rosterFilterOptions,
  rosterSignalAge,
  rosterStatusChipOn,
  rosterTickState,
  rosterValue,
  sortRoster,
  toggleRosterFilterValue,
  type RosterFilters,
  type RosterView,
} from "@/lib/mtm/live-map-roster"
import { LiveMapRoster } from "@/components/mtm/live-map-roster"

const NOW = Date.parse("2026-10-09T10:00:00.000Z")
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

function person(agentId: string, name: string, over: Partial<MtmDashboardAgent> = {}): MtmDashboardAgent {
  return {
    agentId, name, isOnline: true, fieldStatus: "ON_ROAD", freshness: "ONLINE", workdayState: "ACTIVE",
    routeCompletion: 0, locationState: "AVAILABLE", recordedAt: minutesAgo(1), teamId: null, teamName: null,
    routeVisited: 0, routeTotal: 0, speed: 30, battery: 80,
    ...over,
  }
}

// A small field team: two teams and one person outside any, every status once.
const TEAM = [
  person("a1", "Əli Həsənov", { fieldStatus: "CHECKED_IN", teamId: "t-north", teamName: "Şimal", routeVisited: 2, routeTotal: 5, speed: 0, battery: 15, openVisitSince: minutesAgo(20) }),
  person("a2", "Çingiz Əliyev", { fieldStatus: "ON_ROAD", teamId: "t-north", teamName: "Şimal", routeVisited: 0, routeTotal: 4, recordedAt: minutesAgo(3), battery: 45 }),
  person("a3", "İlqar Məmmədov", { fieldStatus: "STOPPED", teamId: "t-south", teamName: "Cənub", routeVisited: 4, routeTotal: 4, speed: 1, recordedAt: minutesAgo(8), freshness: "DELAYED" }),
  person("a4", "Şükür Quliyev", { fieldStatus: "LATE", teamId: "t-south", teamName: "Cənub", workdayState: "NOT_STARTED", recordedAt: minutesAgo(2) }),
  person("a5", "Zaur Babayev", { fieldStatus: "OFFLINE", freshness: "STALE", isOnline: false, workdayState: "CLOSED", recordedAt: minutesAgo(60 * 26), speed: null, battery: null }),
  person("a6", "Aynur Rzayeva", { fieldStatus: "OFFLINE", freshness: "NO_LOCATION", isOnline: false, workdayState: "NOT_STARTED", recordedAt: undefined, speed: null, battery: null }),
]
// The edges of every class, and two people a sort cannot tell apart except by name.
const EDGES = [
  person("e1", "Vüqar", { battery: 19.9, speed: 2, routeVisited: 3, routeTotal: 3, fieldStatus: "ROUTE_FINISHED", workdayState: "CLOSED" }),
  person("e2", "Anar", { battery: 20, speed: 2.1, routeVisited: 1, routeTotal: 4, workdayState: "PAUSED", isOnline: false }),
  person("e3", "Bəhruz", { battery: 49.9, speed: 0, routeVisited: 0, routeTotal: 4 }),
  person("e4", "Anar", { battery: 50, speed: 60, routeVisited: 2, routeTotal: 4, workdayState: "NOT_STARTED" }),
]
const ids = (agents: MtmDashboardAgent[]) => agents.map((agent) => agent.agentId)

describe("what a column holds", () => {
  it("puts numbers into the classes a dispatcher asks about", () => {
    expect(TEAM.map((agent) => rosterValue(agent, "route"))).toEqual(["IN_PROGRESS", "NOT_STARTED", "DONE", "NONE", "NONE", "NONE"])
    expect(TEAM.map((agent) => rosterValue(agent, "battery"))).toEqual(["LOW", "MID", "HIGH", "HIGH", "UNKNOWN", "UNKNOWN"])
    // GPS noise of a km/h or two is «standing», not «moving».
    expect(TEAM.map((agent) => rosterValue(agent, "speed"))).toEqual(["STILL", "MOVING", "STILL", "MOVING", "UNKNOWN", "UNKNOWN"])
    expect(TEAM.map((agent) => rosterValue(agent, "team"))).toEqual(["t-north", "t-north", "t-south", "t-south", ROSTER_NO_TEAM, ROSTER_NO_TEAM])
    expect(TEAM.map((agent) => rosterValue(agent, "app"))).toEqual(["ONLINE", "ONLINE", "ONLINE", "ONLINE", "OFFLINE", "OFFLINE"])
    // A status the list does not know is not a seventh group: it is «GPS inactive».
    expect(rosterValue(person("x", "X", { fieldStatus: "SOMETHING_NEW" }), "status")).toBe("OFFLINE")
  })

  it("draws the class boundaries where the labels say: below 20, 20-50, above 50; moving is faster than 2 km/h", () => {
    expect(EDGES.map((agent) => rosterValue(agent, "battery"))).toEqual(["LOW", "MID", "MID", "HIGH"])
    expect(EDGES.map((agent) => rosterValue(agent, "speed"))).toEqual(["STILL", "MOVING", "STILL", "MOVING"])
    expect(EDGES.map((agent) => rosterValue(agent, "route"))).toEqual(["DONE", "IN_PROGRESS", "NOT_STARTED", "IN_PROGRESS"])
  })
})

describe("a column's filter, the way a spreadsheet's tick list means it", () => {
  it("starts with everything ticked; taking one tick off hides exactly that value", () => {
    expect(rosterFilterAllows(undefined, "LATE")).toBe(true)
    const withoutOffline = toggleRosterFilterValue(undefined, "OFFLINE")
    expect(withoutOffline).toEqual({ mode: "except", values: ["OFFLINE"] })
    expect(ids(applyRosterFilters(TEAM, { status: withoutOffline }))).toEqual(["a1", "a2", "a3", "a4"])
    // The tick put back: no filter at all, not an empty one.
    expect(toggleRosterFilterValue(withoutOffline, "OFFLINE")).toBeUndefined()
  })

  it("«only» leaves one value in a single press and grows by further ticks", () => {
    const onlyLate = onlyRosterFilterValue("LATE")
    expect(ids(applyRosterFilters(TEAM, { status: onlyLate }))).toEqual(["a4"])
    const lateAndOnRoad = toggleRosterFilterValue(onlyLate, "ON_ROAD")
    expect(ids(applyRosterFilters(TEAM, { status: lateAndOnRoad }))).toEqual(["a2", "a4"])
  })

  it("tells «everybody except» from «only these» when somebody new joins the roster", () => {
    // The whole point of two modes: the list changes every thirty seconds.
    const newcomer = person("a7", "Yeni Əməkdaş", { fieldStatus: "ON_ROAD" })
    const exceptOne: RosterFilters = { name: toggleRosterFilterValue(undefined, "a5") }
    const onlyTwo: RosterFilters = { name: { mode: "only", values: ["a1", "a2"] } }
    expect(ids(applyRosterFilters([...TEAM, newcomer], exceptOne))).toContain("a7")
    expect(ids(applyRosterFilters([...TEAM, newcomer], onlyTwo))).toEqual(["a1", "a2"])
  })

  it("shows nobody once every tick is taken off, until something is ticked", () => {
    expect(applyRosterFilters(TEAM, { status: ROSTER_FILTER_NOTHING })).toEqual([])
    expect(ids(applyRosterFilters(TEAM, { status: toggleRosterFilterValue(ROSTER_FILTER_NOTHING, "STOPPED") }))).toEqual(["a3"])
  })

  it("applies every column's filter together", () => {
    const filters: RosterFilters = { team: onlyRosterFilterValue("t-south"), workday: onlyRosterFilterValue("ACTIVE") }
    expect(ids(applyRosterFilters(TEAM, filters))).toEqual(["a3"])
  })

  it("counts a column's values against the OTHER filters, and keeps a ticked value that they have emptied", () => {
    const filters: RosterFilters = { team: onlyRosterFilterValue("t-north"), status: onlyRosterFilterValue("LATE") }
    // The status list is counted inside the northern team, where nobody is late —
    // «Опаздывает» stays, at zero, because it is ticked and must be untickable.
    expect(rosterFilterOptions(TEAM, filters, "status")).toEqual([
      { value: "CHECKED_IN", count: 1 },
      { value: "ON_ROAD", count: 1 },
      { value: "LATE", count: 0 },
    ])
    // The team list is counted inside «late»: only the southern team has one.
    expect(rosterFilterOptions(TEAM, filters, "team")).toEqual([{ value: "t-south", count: 1 }, { value: "t-north", count: 0 }])
  })
})

describe("the status chips above the map — the same filter under another hand", () => {
  it("a chip leaves its one status, the same chip again or «Все» takes the filter off", () => {
    const late = pickRosterStatus({}, "LATE")
    expect(late).toEqual({ status: { mode: "only", values: ["LATE"] } })
    expect(pickRosterStatus(late, "LATE")).toEqual({})
    expect(pickRosterStatus(late, null)).toEqual({})
    // Another chip replaces the first; other columns' filters are not touched.
    const withTeam: RosterFilters = { ...late, team: onlyRosterFilterValue("t-north") }
    expect(pickRosterStatus(withTeam, "ON_ROAD")).toEqual({ status: { mode: "only", values: ["ON_ROAD"] }, team: { mode: "only", values: ["t-north"] } })
    // From a filter made in the menu (several values, or «all except») a chip still leaves just its status.
    expect(pickRosterStatus({ status: { mode: "except", values: ["OFFLINE"] } }, "LATE")).toEqual({ status: { mode: "only", values: ["LATE"] } })
    expect(pickRosterStatus({ status: { mode: "only", values: ["LATE", "STOPPED"] } }, "LATE")).toEqual({ status: { mode: "only", values: ["LATE"] } })
  })

  it("lights no chip without a filter, and exactly the statuses a filter lets through", () => {
    const statuses = ["CHECKED_IN", "ON_ROAD", "STOPPED", "ROUTE_FINISHED", "LATE", "OFFLINE"]
    expect(statuses.filter((status) => rosterStatusChipOn({}, status))).toEqual([])
    expect(statuses.filter((status) => rosterStatusChipOn({ status: onlyRosterFilterValue("LATE") }, status))).toEqual(["LATE"])
    expect(statuses.filter((status) => rosterStatusChipOn({ status: { mode: "except", values: ["OFFLINE", "LATE"] } }, status)))
      .toEqual(["CHECKED_IN", "ON_ROAD", "STOPPED", "ROUTE_FINISHED"])
    // A filter on another column lights nothing here.
    expect(statuses.filter((status) => rosterStatusChipOn({ team: onlyRosterFilterValue("t-north") }, status))).toEqual([])
  })
})

describe("order and groups", () => {
  it("sorts names the way the language does and keeps people without a value last either way", () => {
    expect(ids(sortRoster(TEAM, { column: "name", direction: "asc" }, "az"))).toEqual(["a6", "a2", "a1", "a3", "a4", "a5"])
    // Battery: 15, 45, 80, 80, then the two phones that reported none — also last when reversed.
    expect(ids(sortRoster(TEAM, { column: "battery", direction: "asc" }, "ru")).slice(-2).sort()).toEqual(["a5", "a6"])
    expect(ids(sortRoster(TEAM, { column: "battery", direction: "desc" }, "ru")).slice(-2).sort()).toEqual(["a5", "a6"])
    expect(ids(sortRoster(TEAM, { column: "battery", direction: "asc" }, "ru")).slice(0, 2)).toEqual(["a1", "a2"])
  })

  it("puts the newest signal first when the signal column is sorted «ascending»", () => {
    expect(ids(sortRoster(TEAM, { column: "signal", direction: "asc" }, "ru"))).toEqual(["a1", "a4", "a2", "a3", "a5", "a6"])
    expect(ids(sortRoster(TEAM, { column: "signal", direction: "desc" }, "ru"))).toEqual(["a5", "a3", "a2", "a4", "a1", "a6"])
  })

  it("sorts statuses in the order of the work, not of the alphabet", () => {
    expect(ids(sortRoster(TEAM, { column: "status", direction: "asc" }, "ru")).slice(0, 4)).toEqual(["a1", "a2", "a3", "a4"])
  })

  it("sorts every other column by what it shows, and breaks a tie by name, then by id", () => {
    const order = (column: Parameters<typeof sortRoster>[1]["column"], direction: "asc" | "desc", agents = EDGES) => ids(sortRoster(agents, { column, direction }, "az"))
    // Route: share of the day done — 0/4, 1/4, 2/4, 3/3.
    expect(order("route", "asc")).toEqual(["e3", "e2", "e4", "e1"])
    expect(order("route", "desc")).toEqual(["e1", "e4", "e2", "e3"])
    expect(order("speed", "asc")).toEqual(["e3", "e1", "e2", "e4"])
    expect(order("speed", "desc")).toEqual(["e4", "e2", "e1", "e3"])
    // Workday: running, paused, not started, finished. The two running ones are tied: Bəhruz before nobody else, by name.
    expect(order("workday", "asc")).toEqual(["e3", "e2", "e4", "e1"])
    // Application: in the network first; the three who are tie by name, and the two Anars by id.
    expect(order("app", "asc")).toEqual(["e4", "e3", "e1", "e2"])
    expect(order("app", "desc")).toEqual(["e2", "e4", "e3", "e1"])
    expect(order("name", "asc")).toEqual(["e2", "e4", "e3", "e1"])
    // Team: by the team's name, people without a team last both ways.
    expect(order("team", "asc", TEAM)).toEqual(["a3", "a4", "a2", "a1", "a6", "a5"])
    expect(order("team", "desc", TEAM)).toEqual(["a2", "a1", "a3", "a4", "a6", "a5"])
  })

  it("groups by team with «no team» closing the list, and by status in the status order", () => {
    expect(groupRoster(TEAM, "team", "az").map((group) => [group.key, ids(group.agents)])).toEqual([
      ["t-south", ["a3", "a4"]],
      ["t-north", ["a1", "a2"]],
      [ROSTER_NO_TEAM, ["a5", "a6"]],
    ])
    expect(groupRoster(TEAM, "status", "ru").map((group) => group.key)).toEqual(["CHECKED_IN", "ON_ROAD", "STOPPED", "LATE", "OFFLINE"])
    expect(groupRoster(TEAM, "none", "ru")).toHaveLength(1)
  })

  it("says whether a set of rows is on the map: all of it, some, or none", () => {
    expect(rosterTickState(["a1", "a2"], new Set())).toEqual({ state: "all", onMap: 2, total: 2 })
    expect(rosterTickState(["a1", "a2"], new Set(["a2"]))).toEqual({ state: "some", onMap: 1, total: 2 })
    expect(rosterTickState(["a1", "a2"], new Set(["a1", "a2", "zz"]))).toEqual({ state: "none", onMap: 0, total: 2 })
    expect(rosterTickState([], new Set()).state).toBe("none")
  })

  it("reads the age of a signal in the one unit that fits", () => {
    expect(rosterSignalAge(minutesAgo(0.5), NOW)).toEqual({ unit: "now" })
    expect(rosterSignalAge(minutesAgo(8), NOW)).toEqual({ unit: "minutes", count: 8 })
    expect(rosterSignalAge(minutesAgo(60 * 26), NOW)).toEqual({ unit: "hours", count: 26 })
    expect(rosterSignalAge(minutesAgo(60 * 24 * 3), NOW)).toEqual({ unit: "days", count: 3 })
    expect(rosterSignalAge(undefined, NOW)).toEqual({ unit: "none" })
    // A phone clock ahead of the server is «now», never a negative age.
    expect(rosterSignalAge(new Date(NOW + 90_000).toISOString(), NOW)).toEqual({ unit: "now" })
  })

  it("offers the team and workday columns only where they mean something", () => {
    expect(availableRosterColumns(TEAM, { workforceEnabled: true })).toContain("team")
    const noTeams = TEAM.map((agent) => ({ ...agent, teamId: null, teamName: null }))
    expect(availableRosterColumns(noTeams, { workforceEnabled: true })).not.toContain("team")
    expect(availableRosterColumns(TEAM, { workforceEnabled: false })).not.toContain("workday")
  })
})

describe("the layout remembered in the browser", () => {
  it("comes back valid whatever was stored", () => {
    expect(parseRosterView(null)).toEqual(ROSTER_DEFAULT_VIEW)
    expect(parseRosterView("{not json")).toEqual(ROSTER_DEFAULT_VIEW)
    expect(parseRosterView(JSON.stringify({ width: "wide", sort: { column: "battery", direction: "desc" }, groupBy: "team", columns: ["battery", "status"] }))).toEqual({
      width: "wide",
      sort: { column: "battery", direction: "desc" },
      groupBy: "team",
      // The name is the row: it comes back even if it was not stored.
      columns: ["name", "status", "battery"],
    })
    expect(parseRosterView({ width: "enormous", sort: { column: "salary" }, groupBy: "mood", columns: ["nonsense"] })).toEqual(ROSTER_DEFAULT_VIEW)
  })

  it("does not carry filters: yesterday's filter must not hide somebody today", () => {
    expect(Object.keys(ROSTER_DEFAULT_VIEW).sort()).toEqual(["columns", "groupBy", "sort", "width"])
    expect(parseRosterView({ filters: { status: { mode: "only", values: ["LATE"] } } })).not.toHaveProperty("filters")
  })
})

describe("the zone radius the map draws", () => {
  // Found while reading the list's code: the answer carried the organization's
  // radius, the parser dropped it, and every zone was drawn with the fallback.
  it("survives the contract parser", () => {
    const answer = {
      scope: "ORGANIZATION", today: "2026-10-09", timezone: "Asia/Baku", maxRosterSize: 500, returnedAgents: 6, rosterTruncated: false,
      markerCount: 4, workforceEnabled: true, generatedAt: new Date(NOW).toISOString(), polling: { minimumIntervalSeconds: 15 },
      freshnessThresholds: { onlineSeconds: 300, delayedSeconds: 600 }, maxAccuracyMeters: 100,
    }
    expect(parseMtmLiveMapContract({ ...answer, geofenceRadiusMeters: 250 })?.geofenceRadiusMeters).toBe(250)
    expect(parseMtmLiveMapContract(answer)).not.toHaveProperty("geofenceRadiusMeters")
    expect(parseMtmLiveMapContract({ ...answer, geofenceRadiusMeters: -5 })).not.toHaveProperty("geofenceRadiusMeters")
  })
})

describe("the list on the page", () => {
  let root: Root
  let container: HTMLDivElement
  let state: { filters: RosterFilters; view: RosterView; hidden: Set<string>; selected: string | null; hiddenList: boolean }
  let agents: MtmDashboardAgent[]
  let workforceEnabled: boolean

  function Harness() {
    const [, rerender] = useState(0)
    const update = (change: () => void) => { change(); rerender((value) => value + 1) }
    const rows = sortRoster(applyRosterFilters(agents, state.filters), state.view.sort, "ru")
    return createElement(LiveMapRoster, {
      agents,
      rows,
      searchSlot: createElement("input", { "data-testid": "search", type: "search" }),
      filters: state.filters,
      onFiltersChange: (filters: RosterFilters) => update(() => { state.filters = filters }),
      view: state.view,
      onViewChange: (view: RosterView) => update(() => { state.view = view }),
      onHide: () => update(() => { state.hiddenList = true }),
      hiddenAgentIds: state.hidden,
      onToggleAgentOnMap: (agentId: string) => update(() => {
        const next = new Set(state.hidden)
        if (next.has(agentId)) next.delete(agentId)
        else next.add(agentId)
        state.hidden = next
      }),
      onSetAgentsOnMap: (agentIds: string[], onMap: boolean) => update(() => {
        const next = new Set(state.hidden)
        for (const agentId of agentIds) { if (onMap) next.delete(agentId); else next.add(agentId) }
        state.hidden = next
      }),
      selectedAgentId: state.selected,
      onSelect: (agentId: string) => update(() => { state.selected = state.selected === agentId ? null : agentId }),
      renderDetail: (agent: MtmDashboardAgent) => createElement("div", { "data-testid": "detail" }, `день: ${agent.name}`),
      nowMs: NOW,
      workforceEnabled,
      formatClock: (value: string | null | undefined) => value ? new Date(value).toISOString().slice(11, 16) : "",
      formatVisitOpened: (value: string) => earlierDay(value) ? `${value.slice(8, 10)}.${value.slice(5, 7)}, ${value.slice(11, 16)}` : new Date(value).toISOString().slice(11, 16),
      isEarlierDay: earlierDay,
    })
  }
  const earlierDay = (value: string) => value.slice(0, 10) < new Date(NOW).toISOString().slice(0, 10)

  const draw = async () => { await act(async () => { root.render(createElement(Harness)) }) }
  const press = async (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error("element not found")
    await act(async () => { element.click() })
  }
  const byTestId = (testId: string) => document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const rowIds = () => [...container.querySelectorAll('[data-testid^="live-map-agent-card-"]')].map((row) => row.getAttribute("data-testid")!.replace("live-map-agent-card-", ""))
  const row = (agentId: string) => container.querySelector<HTMLElement>(`[data-testid="live-map-agent-card-${agentId}"]`)!
  const cell = (agentId: string, column: string) => row(agentId).querySelector<HTMLElement>(`[data-column="${column}"]`)!
  const tickOf = (agentId: string) => byTestId(`live-map-agent-on-map-${agentId}`) as HTMLInputElement
  /** What a sighted person reads in a cell beside the map: not the parts kept for the wide table or for a screen reader. */
  const visibleText = (element: Element) => {
    const copy = element.cloneNode(true) as Element
    for (const hidden of copy.querySelectorAll(".hidden, .sr-only")) hidden.remove()
    return copy.textContent
  }
  const openMenu = async (column: string) => { await press(byTestId(`roster-column-${column}`)) }
  const closeMenu = async () => {
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      // A menu closed from the keyboard hands the focus back to its heading a
      // tick later; let that land before the next press, as it does for a person.
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    state = { filters: {}, view: { ...ROSTER_DEFAULT_VIEW, columns: [...ROSTER_DEFAULT_VIEW.columns] }, hidden: new Set(), selected: null, hiddenList: false }
    agents = TEAM
    workforceEnabled = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("is one line per person: the tick, the name, what he is doing and how old his signal is — without a click", async () => {
    await draw()
    expect(rowIds()).toEqual(["a6", "a2", "a1", "a3", "a4", "a5"])
    expect(visibleText(cell("a1", "name"))).toBe("Əli Həsənov")
    // The status is the chip's own word. Since when a visit has been going is
    // in the wide table and in the tooltip; beside the map there is no room for it.
    expect(visibleText(cell("a1", "status"))).toBe("На точке")
    expect(cell("a1", "status").firstElementChild?.getAttribute("title")).toBe("На точке — визит открыт: 09:40")
    expect(cell("a1", "status").querySelector(".hidden")?.textContent).toBe(" · 09:40")
    expect(byTestId("live-map-agent-visit-stale-a1")).toBeNull()
    expect(cell("a4", "status").textContent).toBe("Опаздывает")
    expect([cell("a1", "signal"), cell("a3", "signal"), cell("a5", "signal"), cell("a6", "signal")].map(visibleText))
      .toEqual(["1 мин", "8 мин", "26 ч", "—"])
    // Nothing is opened until somebody is selected.
    expect(byTestId("detail")).toBeNull()
    expect(byTestId("live-map-roster-count")?.textContent).toBe("6 из 6")
  })

  it("stays one line per person for a hundred people", async () => {
    agents = Array.from({ length: 100 }, (_unused, index) => person(`p${index}`, `Сотрудник ${String(index + 1).padStart(3, "0")}`, {
      fieldStatus: index % 4 === 0 ? "LATE" : "ON_ROAD",
    }))
    await draw()
    expect(rowIds()).toHaveLength(100)
    expect(byTestId("live-map-roster-count")?.textContent).toBe("100 из 100")
    // A row is a single grid line of cells, not a card with lines of its own:
    // the tick, then name, status, signal, workday, route, battery (nobody here has a team).
    expect(row("p0").querySelectorAll('[role="cell"]')).toHaveLength(7)
    expect(row("p0").className).toContain("min-h-9")
    await openMenu("status")
    await press(byTestId("roster-filter-only-status-LATE"))
    expect(rowIds()).toHaveLength(25)
    expect(byTestId("live-map-roster-count")?.textContent).toBe("25 из 100")
  })

  it("opens a tick list with counts from the column heading, and a tick taken off hides those rows at once", async () => {
    await draw()
    expect(byTestId("roster-column-menu-status")).toBeNull()
    await openMenu("status")
    const values = [...byTestId("roster-filter-values-status")!.querySelectorAll("li")].map((item) => item.textContent)
    expect(values).toEqual(["На точке1только", "В пути1только", "Стоит1только", "Опаздывает1только", "GPS неактивен2только"])
    expect((byTestId("roster-filter-all-status") as HTMLInputElement).checked).toBe(true)

    await press(byTestId("roster-filter-value-status-OFFLINE"))
    expect(state.filters).toEqual({ status: { mode: "except", values: ["OFFLINE"] } })
    expect(rowIds()).toEqual(["a2", "a1", "a3", "a4"])
    // The heading says a filter is on, and so does a chip that takes it off.
    expect(byTestId("roster-column-status")?.getAttribute("data-filtered")).toBe("true")
    expect(byTestId("live-map-roster-filter-chip-status")?.textContent).toBe("Статус: все, кроме GPS неактивен")
    expect((byTestId("roster-filter-all-status") as HTMLInputElement).indeterminate).toBe(true)

    await press(byTestId("live-map-roster-filter-chip-status")?.querySelector("button"))
    expect(state.filters).toEqual({})
    expect(rowIds()).toHaveLength(6)
  })

  it("leaves one value with «только», and «Выбрать все» takes every tick off or puts them all back", async () => {
    await draw()
    await openMenu("status")
    await press(byTestId("roster-filter-only-status-LATE"))
    expect(rowIds()).toEqual(["a4"])
    expect(byTestId("live-map-roster-filter-chip-status")?.textContent).toBe("Статус: Опаздывает")
    // Not everything is ticked: «Выбрать все» ticks it all — no filter.
    await press(byTestId("roster-filter-all-status"))
    expect(state.filters).toEqual({})
    // Everything is ticked: the same box takes every tick off, and the list says how to get back.
    await press(byTestId("roster-filter-all-status"))
    expect(rowIds()).toEqual([])
    expect(byTestId("live-map-roster-filter-chip-status")?.textContent).toBe("Статус: ничего не выбрано")
    await closeMenu()
    await press(byTestId("live-map-roster-empty-reset"))
    expect(rowIds()).toHaveLength(6)
  })

  it("filters by several columns at once and clears them all in one press", async () => {
    await draw()
    await openMenu("team")
    await press(byTestId("roster-filter-only-team-t-south"))
    await closeMenu()
    await openMenu("workday")
    await press(byTestId("roster-filter-only-workday-ACTIVE"))
    await closeMenu()
    expect(rowIds()).toEqual(["a3"])
    expect(container.querySelectorAll('[data-testid^="live-map-roster-filter-chip-"]')).toHaveLength(2)
    await press(byTestId("live-map-roster-filters-reset"))
    expect(state.filters).toEqual({})
  })

  it("picks particular people from the name column, with a search once the list is long", async () => {
    agents = Array.from({ length: 12 }, (_unused, index) => person(`p${index}`, index === 7 ? "İlqar Məmmədov" : `Сотрудник ${index}`))
    await draw()
    await openMenu("name")
    const search = byTestId("roster-filter-search-name") as HTMLInputElement
    expect(search).not.toBeNull()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    // Typed without the dotted İ, as people type.
    await act(async () => { setter.call(search, "ilqar"); search.dispatchEvent(new Event("input", { bubbles: true })) })
    const offered = [...byTestId("roster-filter-values-name")!.querySelectorAll("li")]
    expect(offered).toHaveLength(1)
    // A list of names has one row each: no column of ones beside them.
    expect(offered[0].textContent).toBe("İlqar Məmmədovтолько")
    await press(byTestId("roster-filter-only-name-p7"))
    expect(rowIds()).toEqual(["p7"])
  })

  it("sorts from the same menu and says so on the heading", async () => {
    await draw()
    const heading = (column: string) => byTestId(`roster-column-${column}`)!.closest('[role="columnheader"]')!
    expect([heading("name").getAttribute("aria-sort"), heading("battery").getAttribute("aria-sort")]).toEqual(["ascending", "none"])
    await openMenu("battery")
    expect(byTestId("roster-sort-battery-asc")?.textContent).toBe("Сначала меньшие")
    await press(byTestId("roster-sort-battery-desc"))
    expect(state.view.sort).toEqual({ column: "battery", direction: "desc" })
    expect([heading("name").getAttribute("aria-sort"), heading("battery").getAttribute("aria-sort")]).toEqual(["none", "descending"])
    expect(rowIds().slice(0, 2).sort()).toEqual(["a3", "a4"])
    // No reading at all is last, not first, when the biggest come first.
    expect(rowIds().slice(-2).sort()).toEqual(["a5", "a6"])
  })

  it("ticks one person off the map without selecting him, and the tick above covers the rows in the list", async () => {
    await draw()
    await press(tickOf("a2"))
    expect([...state.hidden]).toEqual(["a2"])
    expect(state.selected).toBeNull()
    const master = byTestId("live-map-roster-master-tick") as HTMLInputElement
    expect([master.checked, master.indeterminate]).toEqual([false, true])
    expect(byTestId("live-map-on-map-bar")?.textContent).toContain("На карте: 5 из 6")

    await press(master)
    expect(state.hidden.size).toBe(0)
    await press(master)
    expect([...state.hidden].sort()).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"])

    // With a filter on, the tick is about the rows one can see — not about
    // people out of sight. Somebody outside the filter is hidden to begin with:
    // he must come through every press untouched.
    state.hidden = new Set(["a5"])
    state.filters = { team: onlyRosterFilterValue("t-north") }
    await draw()
    expect(byTestId("live-map-on-map-bar")?.textContent).toContain("На карте: 2 из 2")
    expect([(byTestId("live-map-roster-master-tick") as HTMLInputElement).checked, (byTestId("live-map-roster-master-tick") as HTMLInputElement).indeterminate]).toEqual([true, false])
    await press(byTestId("live-map-roster-master-tick"))
    expect([...state.hidden].sort()).toEqual(["a1", "a2", "a5"])
    expect(byTestId("live-map-on-map-bar")?.textContent).toContain("На карте: 0 из 2")
    await press(byTestId("live-map-roster-master-tick"))
    expect([...state.hidden]).toEqual(["a5"])
    await press(byTestId("live-map-on-map-none"))
    expect([...state.hidden].sort()).toEqual(["a1", "a2", "a5"])
    await press(byTestId("live-map-on-map-all"))
    expect([...state.hidden]).toEqual(["a5"])
  })

  it("selects a person from his row and opens his day right under it", async () => {
    await draw()
    await press(row("a3"))
    expect(state.selected).toBe("a3")
    expect(row("a3").getAttribute("data-selected")).toBe("true")
    expect(row("a3").nextElementSibling?.textContent).toBe("день: İlqar Məmmədov")
    // The name is a real button for the keyboard; pressing it is the same press, once.
    await press(cell("a3", "name").querySelector("button"))
    expect(state.selected).toBeNull()
    expect(byTestId("detail")).toBeNull()
  })

  it("groups the list with a tick and a count on every group, and folds a group away", async () => {
    await draw()
    await press(byTestId("live-map-roster-view"))
    await press(byTestId("live-map-roster-group-team"))
    await closeMenu()
    expect(state.view.groupBy).toBe("team")
    const groupRow = (key: string) => byTestId(`live-map-roster-group-row-${key}`)!
    expect([groupRow("t-south").textContent, groupRow("t-north").textContent, groupRow(ROSTER_NO_TEAM).textContent])
      .toEqual(["Cənub2 / 2", "Şimal2 / 2", "Без отдела2 / 2"])

    await press(groupRow("t-north").querySelector('input[type="checkbox"]'))
    expect([...state.hidden].sort()).toEqual(["a1", "a2"])
    expect(groupRow("t-north").textContent).toBe("Şimal0 / 2")

    await press(groupRow("t-south").querySelector("button"))
    expect(rowIds()).toEqual(["a2", "a1", "a6", "a5"])
    // A person selected from the map is never left inside a folded group…
    state.selected = "a4"
    await draw()
    expect(rowIds()).toContain("a4")
    expect(groupRow("t-south").querySelector("button")?.getAttribute("aria-expanded")).toBe("true")
    // …and folding the group he is in lets go of him: the press does what it says.
    await press(groupRow("t-south").querySelector("button"))
    expect(state.selected).toBeNull()
    expect(rowIds()).toEqual(["a2", "a1", "a6", "a5"])
    expect(groupRow("t-south").querySelector("button")?.getAttribute("aria-expanded")).toBe("false")
  })

  it("chooses the columns of the wide table, keeps the name, and can put the list away", async () => {
    await draw()
    // Beside the map: name, status, signal. The rest wait for the wide table.
    expect(cell("a1", "status").className).not.toContain("hidden")
    expect(cell("a1", "team").className).toContain("hidden @2xl:block")
    expect(row("a1").querySelector('[data-column="speed"]')).toBeNull()

    await press(byTestId("live-map-roster-view"))
    // The name is the row and the status is what the chips count: neither can be switched off.
    expect((byTestId("live-map-roster-column-toggle-name") as HTMLInputElement).disabled).toBe(true)
    expect((byTestId("live-map-roster-column-toggle-status") as HTMLInputElement).disabled).toBe(true)
    await press(byTestId("live-map-roster-column-toggle-speed"))
    await press(byTestId("live-map-roster-column-toggle-signal"))
    expect(state.view.columns).toEqual(["name", "status", "team", "workday", "route", "battery", "speed"])
    expect(cell("a2", "speed").textContent).toBe("30 км/ч")
    // The signal left the wide table but not the narrow list.
    expect(cell("a1", "signal").className).toContain("@2xl:hidden")
    expect(cell("a1", "status").className).not.toContain("hidden")

    await press(byTestId("live-map-roster-hide"))
    expect(state.hiddenList).toBe(true)
    await closeMenu()
    await press(byTestId("live-map-roster-width"))
    expect(state.view.width).toBe("wide")
  })

  it("drops the columns that have nothing to show: no teams, no workday module", async () => {
    agents = TEAM.map((agent) => ({ ...agent, teamId: null, teamName: null }))
    workforceEnabled = false
    await draw()
    expect(byTestId("roster-column-team")).toBeNull()
    expect(byTestId("roster-column-workday")).toBeNull()
    await press(byTestId("live-map-roster-view"))
    expect(byTestId("live-map-roster-group-team")).toBeNull()
    expect(byTestId("live-map-roster-group-workday")).toBeNull()
    expect(byTestId("live-map-roster-group-status")).not.toBeNull()
  })

  it("does not group by a column this roster does not have, whatever layout was remembered", async () => {
    // Remembered in another organization, where there were teams.
    agents = TEAM.map((agent) => ({ ...agent, teamId: null, teamName: null }))
    state.view = { ...state.view, groupBy: "team" }
    await draw()
    expect(container.querySelector('[data-testid^="live-map-roster-group-row-"]')).toBeNull()
    expect(rowIds()).toHaveLength(6)
    await press(byTestId("live-map-roster-view"))
    expect((byTestId("live-map-roster-group-none") as HTMLInputElement).checked).toBe(true)
  })

  it("filters and sorts the columns it has no room to draw, from «Фильтры»", async () => {
    await draw()
    expect(byTestId("live-map-roster-filters-button")?.textContent).toBe("Фильтры")
    await press(byTestId("live-map-roster-filters-button"))
    // Every column of this roster is offered, also the ones the narrow list does not show.
    expect([...byTestId("live-map-roster-filters-menu")!.querySelectorAll('[data-testid^="live-map-roster-filters-column-"]')].map((item) => item.textContent))
      .toEqual(["Сотрудник", "Статус", "Сигнал", "Отдел", "Приложение", "Рабочий день", "Маршрут", "Скорость", "Батарея"])
    await press(byTestId("live-map-roster-filters-column-battery"))
    await press(byTestId("roster-filter-only-battery-LOW"))
    expect(rowIds()).toEqual(["a1"])
    await press(byTestId("roster-sort-battery-desc"))
    expect(state.view.sort).toEqual({ column: "battery", direction: "desc" })
    // Back to the list of columns: the one that is filtered says how, and the button counts it.
    await press(byTestId("live-map-roster-filters-back"))
    expect(byTestId("live-map-roster-filters-column-battery")?.textContent).toBe("БатареяНиже 20%")
    expect(byTestId("live-map-roster-filters-button")?.textContent).toBe("Фильтры· 1")
    await press(byTestId("live-map-roster-filters-menu-reset"))
    expect(state.filters).toEqual({})
    expect(rowIds()).toHaveLength(6)
  })

  it("names a filtered value that the current answer no longer holds, and counts the rest of a long filter", async () => {
    state.filters = { team: onlyRosterFilterValue("t-north"), name: { mode: "only", values: ["a1", "a2", "a3", "a4"] } }
    await draw()
    expect(byTestId("live-map-roster-filter-chip-name")?.textContent).toBe("Сотрудник: Əli Həsənov, Çingiz Əliyev, ещё 2")
    // The name search narrowed the roster to people of another team: the chip still names the team.
    agents = TEAM.filter((agent) => agent.teamId === "t-south")
    await draw()
    expect(byTestId("live-map-roster-filter-chip-team")?.textContent).toBe("Отдел: Şimal")
    expect(byTestId("live-map-roster-filter-chip-name")?.textContent).toBe("Сотрудник: Əli Həsənov, Çingiz Əliyev, ещё 2")
    // A team nobody has ever been seen in is not called «no team».
    state.filters = { team: onlyRosterFilterValue("t-unknown") }
    await draw()
    expect(byTestId("live-map-roster-filter-chip-team")?.textContent).toBe("Отдел: нет в списке")
  })

  it("marks on the row a visit left open since an earlier day, and dates a shift carried over", async () => {
    const yesterdayEvening = new Date(NOW - 12 * 3_600_000).toISOString()
    agents = [
      person("v1", "Rəşad", { fieldStatus: "CHECKED_IN", openVisitSince: yesterdayEvening, workdayStartedAt: yesterdayEvening, workdayCarryover: true }),
      person("v2", "Nərgiz", { fieldStatus: "CHECKED_IN", openVisitSince: minutesAgo(30), workdayStartedAt: minutesAgo(120) }),
    ]
    await draw()
    // Beside the map the time does not fit; the warning does, with the words for a screen reader.
    expect(byTestId("live-map-agent-visit-stale-v1")?.textContent).toBe("визит открыт: 08.10, 22:00")
    expect(byTestId("live-map-agent-visit-stale-v1")?.className).toContain("@2xl:hidden")
    expect(byTestId("live-map-agent-visit-stale-v2")).toBeNull()
    // «22:00» alone would read as today.
    expect(cell("v1", "workday").textContent).toBe("Идёт · 08.10, 22:00")
    expect(cell("v2", "workday").textContent).toBe("Идёт · 08:00")
  })

  it("says the application's state in words for a screen reader, and by shape as well as colour", async () => {
    await draw()
    expect(cell("a1", "name").querySelector(".sr-only")?.textContent).toBe("Приложение: В сети")
    expect(cell("a5", "name").querySelector(".sr-only")?.textContent).toBe("Приложение: Не в сети")
    const dot = (agentId: string) => cell(agentId, "name").querySelector('[aria-hidden="true"]')!.className
    expect(dot("a1")).toContain("bg-green-500")
    expect(dot("a5")).toContain("border")
    expect(dot("a5")).not.toContain("bg-")
  })

  it("has a word for everything it can show, in every language", async () => {
    // The mock returns «namespace.key» for a key that does not exist.
    agents = [...TEAM, ...EDGES]
    state.view = { ...state.view, columns: ["name", "status", "signal", "team", "app", "workday", "route", "speed", "battery"], groupBy: "workday" }
    state.filters = { status: { mode: "except", values: ["OFFLINE"] }, battery: ROSTER_FILTER_NOTHING }
    await draw()
    for (const column of ["name", "status", "signal", "team", "app", "workday", "route", "speed", "battery"]) {
      await openMenu(column)
      expect(document.body.textContent, column).not.toContain("mtmMap.")
      await closeMenu()
    }
    await press(byTestId("live-map-roster-view"))
    expect(document.body.textContent).not.toContain("mtmMap.")
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join()
    const flat = (node: Messages, prefix = ""): Array<[string, string]> => Object.entries(node).flatMap(([key, value]) =>
      typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : flat(value, `${prefix}${key}.`))
    const russian = new Map(flat((ru.mtmMap as Messages).roster as Messages))
    for (const locale of ["az", "en"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages
      for (const [key, text] of flat((messages.mtmMap as Messages).roster as Messages)) {
        expect(placeholders(text), `${locale} ${key}`).toBe(placeholders(russian.get(key) ?? ""))
      }
    }
  })

  it("is never a frame with a scrollbar of its own: no ancestor of a row scrolls or caps its height", async () => {
    await draw()
    let node: Element | null = row("a1")
    const roster = byTestId("live-map-roster")
    while (node && node !== roster?.parentElement) {
      expect(node.className, node.getAttribute("data-testid") ?? node.tagName).not.toMatch(/overflow-(y-)?(auto|scroll)|(^|\s)max-h-/)
      node = node.parentElement
    }
    expect(node).toBe(roster?.parentElement)
  })
})

describe("the page behind the list", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/map/page.tsx", "utf8")
  const roster = readFileSync("src/components/mtm/live-map-roster.tsx", "utf8")

  it("draws on the map only the rows the list shows", () => {
    expect(page).toMatch(/const filteredAgents = useMemo\(\s*\(\) => sortRoster\(applyRosterFilters\(agents, rosterFilters\), rosterView\.sort, locale\)/)
    expect(page).toContain("const mapAgents: LiveMapAgent[] = filteredAgents.flatMap((agent) => {")
    expect(page).toContain("rows={filteredAgents}")
  })

  it("lets go of a selection that has left the list for any reason — a filter, a poll, a signal that aged", () => {
    // Keyed on whether he is shown, not on the filter object: a status that
    // changes by itself takes him out of a filter that did not change.
    expect(page).toContain("const selectedShown = selectedAgent == null || filteredAgents.some((agent) => agent.agentId === selectedAgent)")
    expect(page).toMatch(/useEffect\(\(\) => \{\s*if \(selectedShown\) return[\s\S]{0,200}setSelectedAgent\(null\)[\s\S]{0,80}\}, \[selectedShown\]\)/)
  })

  it("keeps the name search on the server, where a roster too long to load whole is searched whole", () => {
    expect(page).toContain('if (debouncedEmployeeFilter) params.set("employee", debouncedEmployeeFilter)')
    expect(page).toContain('testId="mtm-map-employee-filter" value={employeeFilter} onChange={setEmployeeFilter}')
    // The list adds no search of its own over the loaded rows.
    expect(page).toContain("applyRosterFilters(agents, rosterFilters)")
  })

  it("keeps the status chips above the map as the same filter the «Статус» heading holds, counted the same way", () => {
    expect(page).toContain("const pickStatus = (status: string | null) => setRosterFilters((current) => pickRosterStatus(current, status))")
    expect(page).toContain("const statusChipOn = (status: string) => rosterStatusChipOn(rosterFilters, status)")
    for (const status of ["CHECKED_IN", "ON_ROAD", "STOPPED", "ROUTE_FINISHED", "LATE", "OFFLINE"]) {
      expect(page).toContain(`aria-pressed={statusChipOn("${status}")} data-testid="mtm-map-status-chip-${status}" onClick={() => pickStatus("${status}")}`)
    }
    expect(page).toContain("onClick={() => pickStatus(null)}")
    // A chip's number is what pressing it leaves: counted inside the other columns' filters.
    expect(page).toContain('const statusCounts = useMemo(() => applyRosterFilters(agents, rosterFilters, "status").reduce(')
  })

  it("remembers the layout in the browser and forgets the filters with the visit", () => {
    expect(page).toContain("window.localStorage.setItem(ROSTER_VIEW_STORAGE_KEY, JSON.stringify(next))")
    expect(page).toContain("setRosterView(parseRosterView(stored))")
    expect(page).not.toMatch(/localStorage\.setItem\([^)]*rosterFilters/)
    // Another organization or viewer starts with no filter and nobody hidden.
    expect(page).toMatch(/setRosterFilters\(\{\}\)\s*setHiddenAgentIds\(new Set\(\)\)/)
  })

  it("keeps the page scrolling as one: the list grows, its heading follows the screen flush with the top", () => {
    // Owner rule, 2026-09-14: no list in a frame with a scrollbar of its own.
    // (A menu opened from the list may scroll inside itself; the rows never do —
    // the rendered ancestors of a row are walked in the test above.)
    const rows = roster.indexOf('data-testid="mtm-map-agent-list"')
    expect(rows).toBeGreaterThan(-1)
    expect(roster.slice(rows)).not.toMatch(/overflow-(y-)?(auto|scroll)|max-h-/)
    // The offsets are <main>'s own padding; without them rows show through above the heading.
    expect(roster).toContain('className="-top-3 z-20 rounded-t-lg border-b border-zinc-200 bg-card sm:-top-4 lg:-top-8 dark:border-zinc-700 [@media(min-height:600px)]:sticky"')
    expect(readFileSync("src/app/(dashboard)/layout.tsx", "utf8")).toMatch(/<main className=\{`[^`]*overflow-y-auto[^`]* p-3 sm:p-4 lg:p-8 /)
    expect(page).toContain("lg:sticky")
  })

  it("brings the selected employee's day into view under the heading — on a selection, not on a poll", () => {
    expect(page).toMatch(/useEffect\(\(\) => \{\s*if \(selectedAgent\) setRosterHidden\(false\)\s*\}, \[selectedAgent\]\)/)
    expect(page).toMatch(/if \(!selectedAgent \|\| rosterHidden\) return\s*selectedDetailRef\.current\?\.scrollIntoView\?\.\(\{ block: "nearest" \}\)\s*\}, \[selectedAgent, rosterHidden\]\)/)
    expect(roster).toContain('scroll-mt-[calc(var(--roster-head,11rem)+3rem)]')
    expect(roster).toContain('aside.style.setProperty("--roster-head"')
  })

  it("gives the list the width that is asked for: beside the map, a table where a map still fits, or the map alone", () => {
    expect(page).toContain('narrow: "lg:grid-cols-[minmax(0,1fr)_400px]"')
    expect(page).toContain('wide: "lg:grid-cols-[minmax(0,1fr)_400px] min-[1360px]:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]"')
    expect(page).toContain('hidden: "lg:grid-cols-1"')
    expect(roster).toContain('"ml-auto hidden min-[1360px]:inline-flex"')
    // Put away only where the list stands beside the map; under the map on a phone it stays.
    expect(page).toContain("hiddenOnWide={rosterHidden}")
    expect(roster).toContain('hiddenOnWide && "lg:hidden"')
    expect(page).toMatch(/data-testid="live-map-roster-show"\s*className="[^"]*\bhidden\b[^"]*lg:inline-flex/)
    // While it is away its filters still narrow the map, and the button says so.
    expect(page).toContain('tMap("roster.showFiltered", { shown: filteredAgents.length, total: agents.length })')
  })

  it("puts back on the map the employee who is selected while his tick is off", () => {
    expect(page).toMatch(/setSelectedAgent\(agentId\)[\s\S]{0,260}if \(!current\.has\(agentId\)\) return current\s*const next = new Set\(current\)\s*next\.delete\(agentId\)/)
  })

  it("keeps the map's own layer order inside the map, so a menu of the list is never drawn behind it", () => {
    expect(page).toContain('<div className="relative isolate order-1 h-[54vh]')
  })

  it("lets the signal go on ageing in the list while polls fail", () => {
    expect(page).toContain("nextBoundary != null ? Math.min(60_000, Math.max(100, nextBoundary - now)) : 60_000,")
  })
})
