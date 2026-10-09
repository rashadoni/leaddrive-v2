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
  ROSTER_NO_MANAGER,
  ROSTER_NO_TEAM,
  rosterFilterAllows,
  rosterFilterOptions,
  rosterFilterTicked,
  rosterSignalAge,
  rosterStatusChipOn,
  rosterTickState,
  rosterValue,
  serializeRosterView,
  sortRoster,
  tickRosterFilterValue,
  withRosterFilter,
  activeRosterFilterColumns,
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

// Owner, 2026-10-09, after a day with the first version: «фильтр кажется не
// юзабилити… сравни с ТМС примером». The first version copied a spreadsheet to
// the letter — everything ticked, untick what you do not want. The tracking
// product named as the model ticks the other way round, in its list and in its
// tables: a tick means «show these», nothing ticked is the whole list.
describe("a column's filter: tick what to show", () => {
  it("nothing ticked is no filter; one tick shows exactly that value", () => {
    expect(rosterFilterAllows(undefined, "LATE")).toBe(true)
    expect(rosterFilterTicked(undefined, "LATE")).toBe(false)
    const late = tickRosterFilterValue(undefined, "LATE")
    expect(late).toEqual({ mode: "only", values: ["LATE"] })
    expect(rosterFilterTicked(late, "LATE")).toBe(true)
    expect(rosterFilterTicked(late, "ON_ROAD")).toBe(false)
    expect(ids(applyRosterFilters(TEAM, { status: late }))).toEqual(["a4"])
  })

  it("a second tick adds to the first; taking one off leaves the other", () => {
    const lateAndOnRoad = tickRosterFilterValue(tickRosterFilterValue(undefined, "LATE"), "ON_ROAD")
    expect(ids(applyRosterFilters(TEAM, { status: lateAndOnRoad }))).toEqual(["a2", "a4"])
    expect(ids(applyRosterFilters(TEAM, { status: tickRosterFilterValue(lateAndOnRoad, "LATE") }))).toEqual(["a2"])
  })

  it("the last tick taken off is the filter taken off — the whole list, never an empty one", () => {
    const late = tickRosterFilterValue(undefined, "LATE")
    expect(tickRosterFilterValue(late, "LATE")).toBeUndefined()
    // However an empty filter came to be, it hides nobody and counts as no filter.
    const empty: RosterFilters = { status: { mode: "only", values: [] } }
    expect(applyRosterFilters(TEAM, empty)).toHaveLength(TEAM.length)
    expect(activeRosterFilterColumns(empty)).toEqual([])
    expect(withRosterFilter({}, "status", { mode: "only", values: [] })).toEqual({})
  })

  it("somebody who joins the roster later is shown only if his value is ticked", () => {
    const newcomer = person("a7", "Yeni Əməkdaş", { fieldStatus: "ON_ROAD" })
    expect(ids(applyRosterFilters([...TEAM, newcomer], { status: onlyRosterFilterValue("ON_ROAD") }))).toEqual(["a2", "a7"])
    expect(ids(applyRosterFilters([...TEAM, newcomer], { name: { mode: "only", values: ["a1", "a2"] } }))).toEqual(["a1", "a2"])
  })

  it("applies every column's filter together", () => {
    const filters: RosterFilters = { team: onlyRosterFilterValue("t-south"), workday: onlyRosterFilterValue("ACTIVE") }
    expect(ids(applyRosterFilters(TEAM, filters))).toEqual(["a3"])
  })

  it("lists every value a column can have, in its own order, also the ones nobody has right now", () => {
    // At nine in the evening everybody is offline: the status list is still the six statuses, not one line.
    const evening = TEAM.map((agent) => ({ ...agent, fieldStatus: "OFFLINE" }))
    expect(rosterFilterOptions(evening, {}, "status")).toEqual([
      { value: "CHECKED_IN", count: 0 },
      { value: "ON_ROAD", count: 0 },
      { value: "STOPPED", count: 0 },
      { value: "LATE", count: 0 },
      { value: "ROUTE_FINISHED", count: 0 },
      { value: "OFFLINE", count: 6 },
    ])
    expect(rosterFilterOptions(TEAM, {}, "battery").map((option) => option.value)).toEqual(["LOW", "MID", "HIGH", "UNKNOWN"])
    expect(rosterFilterOptions(TEAM, {}, "route").map((option) => option.value)).toEqual(["IN_PROGRESS", "NOT_STARTED", "DONE", "NONE"])
  })

  it("counts a column's values against the OTHER filters, and never drops a team or a manager from the list because of them", () => {
    const filters: RosterFilters = { team: onlyRosterFilterValue("t-north"), status: onlyRosterFilterValue("LATE") }
    // The status list is counted inside the northern team, where nobody is late.
    expect(rosterFilterOptions(TEAM, filters, "status").map((option) => [option.value, option.count])).toEqual([
      ["CHECKED_IN", 1], ["ON_ROAD", 1], ["STOPPED", 0], ["LATE", 0], ["ROUTE_FINISHED", 0], ["OFFLINE", 0],
    ])
    // The team list is counted inside «late»: only the southern team has one.
    // The northern and the people of no team are still listed, with a zero —
    // a filter on status must not leave the dispatcher a list of one team.
    const teams = rosterFilterOptions(TEAM, filters, "team")
    expect(teams).toHaveLength(3)
    expect(Object.fromEntries(teams.map((option) => [option.value, option.count])))
      .toEqual({ "t-south": 1, "t-north": 0, [rosterValue(TEAM[5], "team")]: 0 })
    // With a filter that leaves nobody at all, the teams and the managers are all still there to press.
    const nobody: RosterFilters = { status: onlyRosterFilterValue("ROUTE_FINISHED") }
    expect(rosterFilterOptions(TEAM, nobody, "team").map((option) => option.count)).toEqual([0, 0, 0])
    const withBosses = TEAM.map((agent, index) => (index < 2 ? { ...agent, managerId: "boss-1", managerName: "Старший" } : agent))
    expect(rosterFilterOptions(withBosses, nobody, "manager")).toEqual([{ value: "boss-1", count: 0 }, { value: ROSTER_NO_MANAGER, count: 0 }])
    expect(Object.fromEntries(rosterFilterOptions(withBosses, { status: onlyRosterFilterValue("LATE") }, "manager").map((option) => [option.value, option.count])))
      .toEqual({ "boss-1": 0, [ROSTER_NO_MANAGER]: 1 })
  })

  it("does not drop a value that is there though the column's own vocabulary does not know it", () => {
    const odd = [TEAM[0], { ...TEAM[1], workdayState: "ON_LEAVE" } as unknown as MtmDashboardAgent]
    const workday = rosterFilterOptions(odd, {}, "workday").map((option) => [option.value, option.count])
    expect(workday.slice(-1)).toEqual([["ON_LEAVE", 1]])
    expect(workday.slice(0, -1).map(([value]) => value)).toEqual(rosterFilterOptions(TEAM, {}, "workday").map((option) => option.value))
  })

  it("lists by name only who is there under the other filters, plus whoever is ticked — so a tick can always be taken off", () => {
    const late: RosterFilters = { status: onlyRosterFilterValue("LATE") }
    expect(rosterFilterOptions(TEAM, late, "name")).toEqual([{ value: "a4", count: 1 }])
    expect(rosterFilterOptions(TEAM, { ...late, name: { mode: "only", values: ["a1"] } }, "name"))
      .toEqual([{ value: "a4", count: 1 }, { value: "a1", count: 0 }])
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
    // From a filter made in the menu (several values) a chip still leaves just its status.
    expect(pickRosterStatus({ status: { mode: "only", values: ["LATE", "STOPPED"] } }, "LATE")).toEqual({ status: { mode: "only", values: ["LATE"] } })
  })

  it("lights no chip without a filter, and exactly the statuses that are ticked", () => {
    const statuses = ["CHECKED_IN", "ON_ROAD", "STOPPED", "ROUTE_FINISHED", "LATE", "OFFLINE"]
    expect(statuses.filter((status) => rosterStatusChipOn({}, status))).toEqual([])
    expect(statuses.filter((status) => rosterStatusChipOn({ status: onlyRosterFilterValue("LATE") }, status))).toEqual(["LATE"])
    expect(statuses.filter((status) => rosterStatusChipOn({ status: { mode: "only", values: ["ON_ROAD", "STOPPED"] } }, status)))
      .toEqual(["ON_ROAD", "STOPPED"])
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

// «Отдел» is a column nobody can fill in: no screen of the product assigns a
// team. The card does have «Руководитель» — the grouping a dispatcher with a
// hundred people can actually use («покажи только людей Иванова»).
describe("«Руководитель»: the grouping the cards really hold", () => {
  const CREW = [
    person("m1", "Zaur", { managerId: "boss-b", managerName: "Bəhruz Rəhimov" }),
    person("m2", "Aynur", { managerId: "boss-a", managerName: "Əli Həsənov" }),
    person("m3", "Çingiz", { managerId: "boss-b", managerName: "Bəhruz Rəhimov" }),
    person("m4", "İlqar", { managerId: null, managerName: null }),
    person("m5", "Vüqar", { managerId: "boss-a", managerName: "Əli Həsənov" }),
  ]

  it("is a column only once somebody has a manager — a column of dashes is not a column", () => {
    expect(availableRosterColumns(TEAM, { workforceEnabled: true })).not.toContain("manager")
    expect(availableRosterColumns(CREW, { workforceEnabled: true })).toContain("manager")
  })

  it("holds the manager, or «nobody», as the value the filter and the groups work on", () => {
    expect(CREW.map((agent) => rosterValue(agent, "manager"))).toEqual(["boss-b", "boss-a", "boss-b", ROSTER_NO_MANAGER, "boss-a"])
    expect(ids(applyRosterFilters(CREW, { manager: onlyRosterFilterValue("boss-a") }))).toEqual(["m2", "m5"])
    expect(ids(applyRosterFilters(CREW, { manager: onlyRosterFilterValue(ROSTER_NO_MANAGER) }))).toEqual(["m4"])
    expect(rosterFilterOptions(CREW, {}, "manager").map((option) => [option.value, option.count]).sort())
      .toEqual([[ROSTER_NO_MANAGER, 1], ["boss-a", 2], ["boss-b", 2]].sort())
  })

  it("groups by manager in the order of the managers' names, with the people of nobody last", () => {
    const groups = groupRoster(sortRoster(CREW, { column: "name", direction: "asc" }, "az"), "manager", "az")
    expect(groups.map((group) => [group.key, ids(group.agents)])).toEqual([
      ["boss-b", ["m3", "m1"]],
      ["boss-a", ["m2", "m5"]],
      [ROSTER_NO_MANAGER, ["m4"]],
    ])
  })

  // Owner, 2026-09-15, of the employees screen: a manager listed apart from his
  // own people reads as «he is nobody's». The same here: he heads his group.
  it("a manager who is in the list himself heads his own group — not «без руководителя», not his own boss's group", () => {
    const office = [
      person("boss-a", "Əli Həsənov", { managerId: null, managerName: null }),
      person("lead", "Kamran Lider", { managerId: "boss-a", managerName: "Əli Həsənov" }),
      person("w1", "Aynur", { managerId: "boss-a", managerName: "Əli Həsənov" }),
      person("w2", "Zaur", { managerId: "lead", managerName: "Kamran Lider" }),
      person("w3", "Babək", { managerId: "lead", managerName: "Kamran Lider" }),
      person("free", "Vüqar", { managerId: null, managerName: null }),
    ]
    const rows = sortRoster(office, { column: "name", direction: "asc" }, "az")
    expect(groupRoster(rows, "manager", "az").map((group) => [group.key, ids(group.agents)])).toEqual([
      // The manager first, then his people in the list's order.
      ["boss-a", ["boss-a", "w1"]],
      // A lead under him with people of his own is a group of his own.
      ["lead", ["lead", "w3", "w2"]],
      [ROSTER_NO_MANAGER, ["free"]],
    ])
    // A filter that hides his people does not send him to «без руководителя»: who leads is read from everybody.
    const onlyBosses = rows.filter((agent) => agent.agentId === "boss-a" || agent.agentId === "free")
    expect(groupRoster(onlyBosses, "manager", "az", office).map((group) => [group.key, ids(group.agents)])).toEqual([
      ["boss-a", ["boss-a"]],
      [ROSTER_NO_MANAGER, ["free"]],
    ])
  })

  it("two managers of one name are two groups that keep one order, whatever order the rows come in", () => {
    const twins = [
      person("t1", "Aynur", { managerId: "boss-z", managerName: "Əli Həsənov" }),
      person("t2", "Zaur", { managerId: "boss-y", managerName: "Əli Həsənov" }),
    ]
    const order = (rows: MtmDashboardAgent[]) => groupRoster(rows, "manager", "az").map((group) => group.key)
    expect(order(twins)).toEqual(["boss-y", "boss-z"])
    expect(order([...twins].reverse())).toEqual(["boss-y", "boss-z"])
  })

  it("sorts by the manager's name, the people of nobody last either way", () => {
    expect(ids(sortRoster(CREW, { column: "manager", direction: "asc" }, "az")).slice(-1)).toEqual(["m4"])
    expect(ids(sortRoster(CREW, { column: "manager", direction: "desc" }, "az")).slice(-1)).toEqual(["m4"])
    expect(ids(sortRoster(CREW, { column: "manager", direction: "asc" }, "az")).slice(0, 2).sort()).toEqual(["m1", "m3"])
  })
})

describe("the layout remembered in the browser", () => {
  it("comes back valid whatever was stored", () => {
    expect(parseRosterView(null)).toEqual(ROSTER_DEFAULT_VIEW)
    expect(parseRosterView("{not json")).toEqual(ROSTER_DEFAULT_VIEW)
    const chosen = { width: "wide", sort: { column: "battery", direction: "desc" }, groupBy: "team", columns: ["battery", "status"] } as RosterView
    expect(parseRosterView(serializeRosterView(chosen))).toEqual({
      width: "wide",
      sort: { column: "battery", direction: "desc" },
      groupBy: "team",
      // The name is the row: it comes back even if it was not stored.
      columns: ["name", "status", "battery"],
    })
    expect(parseRosterView({ width: "enormous", sort: { column: "salary" }, groupBy: "mood", columns: ["nonsense"] })).toEqual(ROSTER_DEFAULT_VIEW)
  })

  // The list will get columns after views began to be remembered. A view
  // saved before a column existed never switched it off — it simply was not
  // there; one saved by a build that knew it, without it, was a choice.
  it("a default column the saving build did not know comes in as for a new person; one the person switched off stays off", () => {
    const view = { width: "wide", sort: { column: "name", direction: "asc" }, groupBy: "none", columns: ["name", "status", "signal"] }
    // Saved by a build that knew only these six: the defaults it had never heard of arrive, in the table's own order.
    const knewLittle = JSON.stringify({ ...view, seen: ["name", "status", "signal", "team", "workday", "nonsense"] })
    expect(parseRosterView(knewLittle).columns).toEqual(["name", "status", "signal", "distance", "route", "battery"])
    // Saved by this build: it knew them all, so their absence is what the person chose.
    expect(parseRosterView(serializeRosterView(view as RosterView)).columns).toEqual(["name", "status", "signal"])
    expect(JSON.parse(serializeRosterView(view as RosterView)).seen).toEqual(expect.arrayContaining(["manager", "battery", "distance"]))
    // Saved before anything was written beside the view: it knew the first ten, and nothing new is a default yet.
    expect(parseRosterView(JSON.stringify(view)).columns).toEqual(["name", "status", "signal"])
    // «Руководитель» is one tick away, not a default: the wide table was sized without it.
    expect(ROSTER_DEFAULT_VIEW.columns).not.toContain("manager")
    // A grouping by it is remembered like any other.
    expect(parseRosterView(serializeRosterView({ ...ROSTER_DEFAULT_VIEW, groupBy: "manager" })).groupBy).toBe("manager")
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
      hiddenOnWide: state.hiddenList,
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
    // Escape, then wait for what a person would see before pressing anything
    // else: the menu is gone and the focus is back on the heading that opened
    // it (Radix hands it back a tick after the menu unmounts). A fixed pause
    // lost that race on a loaded CI runner — the focus landed after the next
    // press and closed the menu that press had just opened (static-checks went
    // red on it, 2026-10-09).
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    for (let turn = 0; turn < 150; turn += 1) {
      if (!document.body.querySelector("[data-radix-popper-content-wrapper]") && document.activeElement !== document.body) break
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2)) })
    }
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
    await press(byTestId("roster-filter-value-status-LATE"))
    expect(rowIds()).toHaveLength(25)
    expect(byTestId("live-map-roster-count")?.textContent).toBe("25 из 100")
  })

  it("opens a tick list from the column heading: nothing ticked, every status listed, and a tick shows just those rows", async () => {
    await draw()
    expect(byTestId("roster-column-menu-status")).toBeNull()
    await openMenu("status")
    // Every status the map has, with how many people are in it now — also the one nobody is in.
    const values = [...byTestId("roster-filter-values-status")!.querySelectorAll("li")].map((item) => item.textContent)
    expect(values).toEqual(["На точке1", "В пути1", "Стоит1", "Опаздывает1", "Маршрут завершён0", "GPS неактивен2"])
    const ticks = () => [...byTestId("roster-filter-values-status")!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(ticks().filter((tick) => tick.checked)).toEqual([])
    // The menu says what a tick means, in words.
    expect(byTestId("roster-column-menu-status")?.textContent).toContain("Отметьте, кого показать. Ничего не отмечено — показаны все.")
    // No «сбросить» while there is nothing to reset.
    expect(byTestId("roster-filter-reset-status")).toBeNull()

    await press(byTestId("roster-filter-value-status-LATE"))
    expect(state.filters).toEqual({ status: { mode: "only", values: ["LATE"] } })
    expect(rowIds()).toEqual(["a4"])
    // The heading says a filter is on, and so does a chip that takes it off.
    expect(byTestId("roster-column-status")?.getAttribute("data-filtered")).toBe("true")
    expect(byTestId("live-map-roster-filter-chip-status")?.textContent).toBe("Статус: Опаздывает")

    // A second tick adds to the first.
    await press(byTestId("roster-filter-value-status-ON_ROAD"))
    expect(rowIds()).toEqual(["a2", "a4"])
    expect(byTestId("live-map-roster-filter-chip-status")?.textContent).toBe("Статус: Опаздывает, В пути")
    expect(ticks().filter((tick) => tick.checked)).toHaveLength(2)

    await press(byTestId("live-map-roster-filter-chip-status")?.querySelector("button"))
    expect(state.filters).toEqual({})
    expect(rowIds()).toHaveLength(6)
  })

  it("the last tick taken off is the whole list again, and «Сбросить этот фильтр» does it in one press", async () => {
    await draw()
    await openMenu("status")
    await press(byTestId("roster-filter-value-status-LATE"))
    expect(rowIds()).toEqual(["a4"])
    await press(byTestId("roster-filter-value-status-LATE"))
    // Not an empty list with «ничего не выбрано»: no tick is no filter.
    expect(state.filters).toEqual({})
    expect(rowIds()).toHaveLength(6)
    expect(byTestId("live-map-roster-filter-chip-status")).toBeNull()

    await press(byTestId("roster-filter-value-status-OFFLINE"))
    await press(byTestId("roster-filter-value-status-STOPPED"))
    expect(rowIds()).toEqual(["a6", "a3", "a5"])
    await press(byTestId("roster-filter-reset-status"))
    expect(state.filters).toEqual({})
    expect(rowIds()).toHaveLength(6)
  })

  it("a status nobody is in can still be ticked: the list is then empty and says how to get back", async () => {
    await draw()
    await openMenu("status")
    await press(byTestId("roster-filter-value-status-ROUTE_FINISHED"))
    expect(rowIds()).toEqual([])
    expect(byTestId("live-map-roster-filter-chip-status")?.textContent).toBe("Статус: Маршрут завершён")
    await closeMenu()
    await press(byTestId("live-map-roster-empty-reset"))
    expect(rowIds()).toHaveLength(6)
  })

  it("filters by several columns at once and clears them all in one press", async () => {
    await draw()
    await openMenu("team")
    await press(byTestId("roster-filter-value-team-t-south"))
    await closeMenu()
    await openMenu("workday")
    await press(byTestId("roster-filter-value-workday-ACTIVE"))
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
    expect(offered[0].textContent).toBe("İlqar Məmmədov")
    await press(byTestId("roster-filter-value-name-p7"))
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
    expect(state.view.columns).toEqual(["name", "status", "distance", "team", "workday", "route", "battery", "speed"])
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

  it("brings its top back into view when a filter leaves a few rows behind the heading that follows the screen", async () => {
    // Seen on production: scrolled down a long list, a filter left three rows,
    // and they were all behind the heading — the list looked empty.
    agents = Array.from({ length: 60 }, (_unused, index) => person(`p${index}`, `Сотрудник ${String(index + 1).padStart(2, "0")}`, {
      fieldStatus: index < 3 ? "LATE" : "ON_ROAD",
    }))
    await draw()
    const aside = byTestId("live-map-roster")!
    const heading = byTestId("live-map-roster-heading")!
    const scrolled: Array<unknown> = []
    aside.scrollIntoView = (options?: unknown) => { scrolled.push(options) }
    // The page is scrolled deep into the list: its top is far above the screen, the heading is stuck at the top of it.
    const place = (listTop: number, listBottom: number, headingTop: number) => {
      aside.getBoundingClientRect = () => ({ top: listTop, bottom: listBottom, left: 0, right: 400, width: 400, height: listBottom - listTop, x: 0, y: listTop, toJSON: () => ({}) })
      heading.getBoundingClientRect = () => ({ top: headingTop, bottom: headingTop + 160, left: 0, right: 400, width: 400, height: 160, x: 0, y: headingTop, toJSON: () => ({}) })
    }
    Object.defineProperty(window, "innerHeight", { value: 700, configurable: true })

    // Somebody reading far down a long list is not moved when it gets a little shorter (a poll took one row away).
    place(-1500, 900, 0)
    agents = agents.slice(0, 59)
    await draw()
    expect(scrolled).toEqual([])

    // A filter leaves three rows: the list now ends inside its own heading.
    place(-40, 170, 10)
    state.filters = { status: onlyRosterFilterValue("LATE") }
    await draw()
    expect(rowIds()).toHaveLength(3)
    expect(scrolled).toEqual([{ block: "start" }])

    // With the heading in its place there is nothing to bring back; and a list that grows never moves the page.
    place(120, 400, 120)
    state.filters = { status: onlyRosterFilterValue("OFFLINE") }
    await draw()
    state.filters = {}
    await draw()
    expect(scrolled).toHaveLength(1)
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

  it("offers «По руководителю» where the cards name managers, and heads each group with his name", async () => {
    // Nobody here has a manager: neither the column nor the grouping is offered.
    await draw()
    await press(byTestId("live-map-roster-view"))
    expect(byTestId("live-map-roster-group-manager")).toBeNull()
    expect(byTestId("live-map-roster-column-toggle-manager")).toBeNull()
    await closeMenu()

    agents = TEAM.map((agent, index) => index < 2
      ? { ...agent, managerId: "boss-1", managerName: "Старший Первый" }
      : index < 4 ? { ...agent, managerId: "boss-2", managerName: "Старший Второй" } : agent)
    await draw()
    // Not drawn until asked for: the wide table was sized without it.
    expect(row("a1").querySelector('[data-column="manager"]')).toBeNull()
    await press(byTestId("live-map-roster-view"))
    await press(byTestId("live-map-roster-column-toggle-manager"))
    expect(cell("a1", "manager").textContent).toBe("Старший Первый")
    expect(cell("a5", "manager").textContent).toBe("—")
    await press(byTestId("live-map-roster-group-manager"))
    expect(state.view.groupBy).toBe("manager")
    const heads = [...container.querySelectorAll('[data-testid^="live-map-roster-group-row-"]')].map((head) => head.textContent ?? "")
    expect(heads).toHaveLength(3)
    expect(heads[0]).toContain("Старший Второй")
    expect(heads[1]).toContain("Старший Первый")
    // The people whose card names nobody close the list, under their own words.
    expect(heads[2]).toContain("Без руководителя")
    await closeMenu()
    // «Only his people», from «Фильтры»: managers by name, the people of nobody last.
    await press(byTestId("live-map-roster-filters-button"))
    const offered = [...byTestId("live-map-roster-filters-group-manager")!.querySelectorAll("button")]
      .map((option) => option.querySelector("span.truncate")?.textContent)
    expect(offered).toEqual(["Старший Второй", "Старший Первый", "Без руководителя"])
    await press(byTestId("live-map-roster-filters-value-manager-boss-1"))
    expect(rowIds().sort()).toEqual(["a1", "a2"])
  })

  it("says how long somebody has been standing — in the wide table, and only where the server recorded when he stopped", async () => {
    agents = [
      person("s1", "Стоит давно", { fieldStatus: "STOPPED", stationarySince: minutesAgo(80) }),
      person("s2", "Стоит, начало неизвестно", { fieldStatus: "STOPPED" }),
      person("s3", "Едет", { fieldStatus: "ON_ROAD", stationarySince: minutesAgo(80) }),
    ]
    await draw()
    const standing = byTestId("live-map-agent-standing-s1")!
    expect(standing.textContent).toBe(" · 1 ч 20 мин")
    // Beside the map there is room for the status word only; the wide table shows the duration.
    expect(standing.className.split(" ")).toEqual(expect.arrayContaining(["hidden", "@2xl:inline"]))
    // On hover, since when.
    expect(byTestId("live-map-agent-status-s1")?.getAttribute("title")).toBe("Стоит с 08:40")
    // No recorded beginning: the word alone, no invented duration.
    expect(byTestId("live-map-agent-standing-s2")).toBeNull()
    expect(visibleText(cell("s2", "status"))).toBe("Стоит")
    // Not carried into «в пути».
    expect(byTestId("live-map-agent-standing-s3")).toBeNull()
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

  it("«Фильтры» is one panel: every column with its values to press, no second level — also the columns it has no room to draw", async () => {
    await draw()
    expect(byTestId("live-map-roster-filters-button")?.textContent).toBe("Фильтры")
    await press(byTestId("live-map-roster-filters-button"))
    const panel = byTestId("live-map-roster-filters-menu")!
    // Every column of this roster at once, also the ones the narrow list does
    // not draw. Particular people are picked from the search and the name column.
    expect([...panel.querySelectorAll('[data-testid^="live-map-roster-filters-title-"]')].map((title) => title.textContent))
      .toEqual(["Статус", "Сигнал", "Отдел", "Приложение", "Рабочий день", "Маршрут", "Скорость", "Батарея"])
    // The values are on the panel already: one press from «Фильтры» to a filter.
    expect([...byTestId("live-map-roster-filters-group-battery")!.querySelectorAll("button")].map((value) => value.textContent))
      .toEqual(["Ниже 20%1", "20–50%1", "Выше 50%2", "Нет данных2"])
    expect(panel.textContent).toContain("Отметьте, кого показать. Ничего не отмечено — показаны все.")
    expect(byTestId("live-map-roster-filters-count")?.textContent).toBe("6 из 6")
    expect(byTestId("live-map-roster-filters-menu-reset")).toBeNull()
    expect(panel.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(0)

    await press(byTestId("live-map-roster-filters-value-battery-LOW"))
    expect(rowIds()).toEqual(["a1"])
    // The other columns' numbers follow: they are counted inside what is already filtered.
    expect(byTestId("live-map-roster-filters-value-team-t-south")?.textContent).toBe("Cənub0")
    expect(byTestId("live-map-roster-filters-value-team-t-north")?.textContent).toBe("Şimal1")
    // The panel stays open and says what the press did.
    expect(byTestId("live-map-roster-filters-value-battery-LOW")?.getAttribute("aria-pressed")).toBe("true")
    expect(byTestId("live-map-roster-filters-count")?.textContent).toBe("1 из 6")
    expect(byTestId("live-map-roster-filters-button")?.textContent).toBe("Фильтры· 1")
    // A second value of the same column adds to it; another column narrows.
    await press(byTestId("live-map-roster-filters-value-battery-HIGH"))
    expect(rowIds()).toHaveLength(3)
    await press(byTestId("live-map-roster-filters-value-team-t-south"))
    expect(state.filters).toEqual({ battery: { mode: "only", values: ["LOW", "HIGH"] }, team: { mode: "only", values: ["t-south"] } })
    expect(byTestId("live-map-roster-filters-button")?.textContent).toBe("Фильтры· 2")
    // The panel's own counter is the rows drawn.
    expect(byTestId("live-map-roster-filters-count")?.textContent).toBe(`${rowIds().length} из 6`)
    // Pressed again, a value is let go of.
    await press(byTestId("live-map-roster-filters-value-team-t-south"))
    expect(state.filters).toEqual({ battery: { mode: "only", values: ["LOW", "HIGH"] } })

    await press(byTestId("live-map-roster-filters-menu-reset"))
    expect(state.filters).toEqual({})
    expect(rowIds()).toHaveLength(6)
    expect(byTestId("live-map-roster-filters-menu")).not.toBeNull()
  })

  it("sorts by a column it has no room to draw, from «Вид»", async () => {
    await draw()
    await press(byTestId("live-map-roster-view"))
    const column = byTestId("live-map-roster-sort-column") as HTMLSelectElement
    expect(column.value).toBe("name")
    expect([...column.options].map((option) => option.textContent))
      .toEqual(["Сотрудник", "Статус", "Сигнал", "Отдел", "Приложение", "Рабочий день", "Маршрут", "Скорость", "Батарея"])
    expect(byTestId("live-map-roster-sort-asc")?.textContent).toBe("От А до Я")
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!
    await act(async () => { setter.call(column, "battery"); column.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(state.view.sort).toEqual({ column: "battery", direction: "asc" })
    // The words of the two directions are the column's own.
    expect(byTestId("live-map-roster-sort-asc")?.textContent).toBe("Сначала меньшие")
    await press(byTestId("live-map-roster-sort-desc"))
    expect(state.view.sort).toEqual({ column: "battery", direction: "desc" })
    expect(byTestId("live-map-roster-sort-desc")?.getAttribute("aria-pressed")).toBe("true")
    expect(rowIds().slice(0, 2)).toEqual(sortRoster(TEAM, { column: "battery", direction: "desc" }, "ru").slice(0, 2).map((agent) => agent.agentId))
  })

  describe("where the menus open", () => {
    // jsdom has no media queries and no layout: the width of the screen is said
    // by the stub, and the list's heading is given a place to stand. What is
    // asserted is what the menu was really placed against — the side the
    // positioning engine chose and the width of the thing it measured — not a
    // flag the component sets about itself. Once, the anchor line stood before
    // the trigger and every menu opened in the corner of the screen.
    const screen = { besideMap: true, roomForTable: true }
    const listeners = new Map<string, Set<() => void>>()
    const resize = async (next: Partial<typeof screen>) => {
      Object.assign(screen, next)
      await act(async () => { for (const group of listeners.values()) for (const listener of group) listener() })
    }
    const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) }) }
    const HEADING = { left: 600, top: 100, width: 400, height: 160 }
    const placeHeading = () => {
      byTestId("live-map-roster-heading")!.getBoundingClientRect = () => ({
        ...HEADING, right: HEADING.left + HEADING.width, bottom: HEADING.top + HEADING.height, x: HEADING.left, y: HEADING.top, toJSON: () => ({}),
      }) as DOMRect
    }
    /** Where an open menu really stands: the side chosen and the width of what it was anchored to. */
    const placed = (testId: string) => {
      const content = byTestId(testId)?.closest("[data-side]")
      const wrapper = byTestId(testId)?.closest<HTMLElement>("[data-radix-popper-content-wrapper]")
      return { side: content?.getAttribute("data-side") ?? null, anchorWidth: wrapper?.style.getPropertyValue("--radix-popper-anchor-width") ?? null }
    }
    const BESIDE_THE_LIST = { side: "left", anchorWidth: `${HEADING.width}px` }
    const UNDER_ITS_OWN_HEADING = { side: "bottom", anchorWidth: "0px" }
    const floating = () => byTestId("live-map-roster-filters-menu")?.closest("[data-radix-popper-content-wrapper]") != null
    beforeEach(() => {
      screen.besideMap = true
      screen.roomForTable = true
      listeners.clear()
      vi.stubGlobal("matchMedia", (query: string) => ({
        get matches() { return query === "(min-width: 1024px)" ? screen.besideMap : query === "(min-width: 85rem)" ? screen.roomForTable : false },
        media: query,
        addEventListener(_type: string, listener: () => void) { listeners.set(query, (listeners.get(query) ?? new Set()).add(listener)) },
        removeEventListener(_type: string, listener: () => void) { listeners.get(query)?.delete(listener) },
        addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
      }))
      // Without a screen of some size the engine has no room anywhere and flips every menu.
      Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1440 })
      Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 900 })
    })
    afterEach(() => {
      Reflect.deleteProperty(document.documentElement, "clientWidth")
      Reflect.deleteProperty(document.documentElement, "clientHeight")
    })

    it("beside the map: to the left of the list, over the map — the rows being filtered stay in sight", async () => {
      await draw()
      placeHeading()
      await openMenu("status")
      await settle()
      expect(placed("roster-column-menu-status")).toEqual(BESIDE_THE_LIST)
      await closeMenu()
      await press(byTestId("live-map-roster-filters-button"))
      await settle()
      expect(floating()).toBe(true)
      expect(placed("live-map-roster-filters-menu")).toEqual(BESIDE_THE_LIST)
      // A floating panel is closed by Escape or a press outside: it needs no «Готово».
      expect(byTestId("live-map-roster-filters-done")).toBeNull()
      expect(byTestId("live-map-roster-heading")?.className).toContain("sticky")
      // It is bounded by the room to the left of the list, so it is never cut by the edge of the screen.
      expect(byTestId("live-map-roster-filters-menu")?.className).toContain("var(--radix-popover-content-available-width)")
    })

    it("in the wide table: a column's menu drops under its own heading, «Фильтры» still stands beside the list", async () => {
      await draw()
      placeHeading()
      await press(byTestId("live-map-roster-width"))
      expect(state.view.width).toBe("wide")
      await openMenu("status")
      await settle()
      expect(placed("roster-column-menu-status")).toEqual(UNDER_ITS_OWN_HEADING)
      await closeMenu()
      await press(byTestId("live-map-roster-filters-button"))
      await settle()
      expect(floating()).toBe(true)
      expect(placed("live-map-roster-filters-menu")).toEqual(BESIDE_THE_LIST)
    })

    it("«Таблица» remembered on a screen with no room for it: the list is narrow, so its menus open to the left", async () => {
      screen.roomForTable = false
      state.view = { ...state.view, width: "wide" }
      await draw()
      placeHeading()
      await openMenu("status")
      await settle()
      expect(placed("roster-column-menu-status")).toEqual(BESIDE_THE_LIST)
    })

    it("under the map, on a phone: «Фильтры» opens in the list itself, and «Готово» says how many are left and puts it away", async () => {
      screen.besideMap = false
      screen.roomForTable = false
      await draw()
      const scrolled: Array<unknown> = []
      byTestId("live-map-roster")!.scrollIntoView = (options?: unknown) => { scrolled.push(options) }
      await openMenu("status")
      await settle()
      expect(placed("roster-column-menu-status")).toEqual(UNDER_ITS_OWN_HEADING)
      await closeMenu()
      const button = byTestId("live-map-roster-filters-button")!
      expect(button.getAttribute("aria-expanded")).toBe("false")
      await press(button)
      expect(button.getAttribute("aria-expanded")).toBe("true")
      // In the list, not floating over it: nothing is covered and the page scrolls as one.
      expect(floating()).toBe(false)
      const panel = byTestId("live-map-roster-filters-menu")!
      expect(container.contains(panel)).toBe(true)
      // No part of it is a frame with a scrollbar of its own (owner rule, 2026-09-14).
      for (const node of [panel, ...panel.querySelectorAll("*")]) {
        expect(node.getAttribute("class") ?? "", node.getAttribute("data-testid") ?? node.tagName).not.toMatch(/overflow-(y-)?(auto|scroll)|(^|\s)max-h-/)
      }
      // A heading that holds the open panel can be taller than the screen: it
      // does not follow the scroll. Pressed from a list scrolled to row forty
      // the panel would open far above the screen — so the top of the list is
      // brought into view with it.
      expect(byTestId("live-map-roster-heading")?.className).not.toContain("sticky")
      expect(scrolled).toEqual([{ block: "start" }])
      await press(byTestId("live-map-roster-filters-value-status-OFFLINE"))
      expect(byTestId("live-map-roster-filters-done")?.textContent).toBe("Готово · показано 2 из 6")
      // «Готово» stands at the foot of a tall panel: with the panel gone the
      // page is brought back to the list, and the focus goes to «Фильтры».
      await press(byTestId("live-map-roster-filters-done"))
      expect(byTestId("live-map-roster-filters-menu")).toBeNull()
      expect(byTestId("live-map-roster-heading")?.className).toContain("sticky")
      expect(rowIds()).toEqual(["a6", "a5"])
      expect(scrolled).toEqual([{ block: "start" }, { block: "start" }])
      expect(document.activeElement).toBe(button)
      // The same button opens and closes it; closing it that way moves nothing — it is on the screen already.
      await press(button)
      expect(byTestId("live-map-roster-filters-menu")).not.toBeNull()
      expect(scrolled).toHaveLength(3)
      await press(button)
      expect(byTestId("live-map-roster-filters-menu")).toBeNull()
      expect(scrolled).toHaveLength(3)
    })

    it("a floating panel never moves the page", async () => {
      await draw()
      const scrolled: Array<unknown> = []
      byTestId("live-map-roster")!.scrollIntoView = (options?: unknown) => { scrolled.push(options) }
      await press(byTestId("live-map-roster-filters-button"))
      await press(byTestId("live-map-roster-filters-value-status-OFFLINE"))
      await closeMenu()
      expect(scrolled).toEqual([])
    })

    it("the list put away on a wide screen takes its open filters with it: they do not open by themselves when it comes back", async () => {
      // Under the map a list that was «put away» is still shown, with its filters open.
      screen.besideMap = false
      screen.roomForTable = false
      state.hiddenList = true
      await draw()
      await press(byTestId("live-map-roster-filters-button"))
      expect(byTestId("live-map-roster-filters-menu")).not.toBeNull()
      // The window is made wide: the list is put away, and its panel with it.
      await resize({ besideMap: true, roomForTable: true })
      expect(byTestId("live-map-roster-filters-menu")).toBeNull()
      expect(byTestId("live-map-roster-filters-button")?.getAttribute("aria-expanded")).toBe("false")
      // The list is brought back: nothing opens over the map.
      state.hiddenList = false
      await draw()
      await settle()
      expect(byTestId("live-map-roster-filters-menu")).toBeNull()
    })
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
    state.filters = { status: { mode: "only", values: ["OFFLINE", "LATE", "STOPPED"] }, battery: onlyRosterFilterValue("LOW") }
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
    expect(page).toMatch(/const filteredAgents = useMemo\(\s*\(\) => sortRoster\(applyRosterFilters\(agents, rosterFilters\), rosterSort, locale\)/)
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
    expect(page).toContain("window.localStorage.setItem(ROSTER_VIEW_STORAGE_KEY, serializeRosterView(stored))")
    expect(page).toContain("const view = parseRosterView(stored)")
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
    expect(roster).toContain('"-top-3 z-20 rounded-t-lg border-b border-zinc-200 bg-card sm:-top-4 lg:-top-8 dark:border-zinc-700",')
    // It follows the screen — except while it holds the open filters under the map, when it can be taller than the screen.
    expect(roster).toContain('!filtersInList && "[@media(min-height:600px)]:sticky",')
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
    expect(page).toContain('wide: "lg:grid-cols-[minmax(0,1fr)_400px] min-[85rem]:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]"')
    expect(page).toContain('hidden: "lg:grid-cols-1"')
    expect(roster).toContain('"ml-auto hidden min-[85rem]:inline-flex"')
    // A width breakpoint in px next to the named ones (which are in rem) is a
    // rule Tailwind cannot put in order: it came out before `lg` and lost to
    // it, and on production «Таблица» changed its label and nothing else.
    for (const source of [page, roster]) expect(source).not.toMatch(/\b(min|max)-\[\d+px\]:/)
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
    expect(page).toContain('className="relative isolate order-1 h-[54vh]')
  })

  it("lets the signal go on ageing in the list while polls fail", () => {
    expect(page).toContain("nextBoundary != null ? Math.min(60_000, Math.max(100, nextBoundary - now)) : 60_000,")
  })
})
