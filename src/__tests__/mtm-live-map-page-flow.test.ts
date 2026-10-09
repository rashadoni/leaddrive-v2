// @vitest-environment jsdom
/**
 * The live map page as a person uses it: the list, the chips above the map,
 * the tools on it and the map's own answers, wired together.
 *
 * The pieces have their own tests. This one runs the page itself, because the
 * rules that matter live between the pieces: the map draws only the rows the
 * list shows; a point picked on the map turns the list to «nearest first»
 * until another order is asked for; a selection goes when its row goes.
 * Only the network, the session and the Leaflet canvas are stood in for.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages

const hoisted = vi.hoisted(() => ({
  /** What the page last handed to the map, and the map's way of answering back. */
  map: { props: null as Record<string, unknown> | null },
}))

// As in the app, a translator, the router and the session are the same objects
// from one render to the next: the page's effects depend on them.
vi.mock("next-intl", () => {
  const translators = new Map<string, (key: string, values?: Record<string, unknown>) => string>()
  return {
    useLocale: () => "ru",
    useTranslations: (namespace: string) => {
      let translate = translators.get(namespace)
      if (!translate) {
        translate = (key, values) => {
          let node: unknown = ru
          for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
          const raw = typeof node === "string" ? node : `${namespace}.${key}`
          return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
        }
        translators.set(namespace, translate)
      }
      return translate
    },
  }
})
vi.mock("next/navigation", () => {
  const searchParams = new URLSearchParams("")
  const router = { replace: () => {}, push: () => {} }
  return { useSearchParams: () => searchParams, useRouter: () => router, usePathname: () => "/mtm/map" }
})
vi.mock("next-auth/react", () => {
  const session = { status: "authenticated", data: { user: { id: "viewer-1", organizationId: "org-1", email: "viewer@example.test" } } }
  return { useSession: () => session }
})
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})
// The Leaflet canvas is not drawn in jsdom: a stand-in records what it is given.
vi.mock("next/dynamic", async () => {
  const { createElement: h } = await import("react")
  return {
    default: () => function MapStandIn(props: Record<string, unknown>) {
      hoisted.map.props = props
      return h("div", { "data-testid": "map-stand-in" })
    },
  }
})
vi.mock("sonner", () => ({ toast: { info: () => {}, error: () => {}, success: () => {} } }))
vi.mock("@/components/page-description", () => ({ PageDescription: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/mtm/location-history-panel", () => ({ LocationHistoryPanel: () => null }))
vi.mock("@/lib/mtm/route-cache", () => ({
  saveRouteCache: async () => {},
  loadRouteCache: async () => null,
  routeCacheKey: (agent: string, day: string) => `${agent}:${day}`,
}))

import MtmMapPage from "@/app/(dashboard)/mtm/map/page"
import { ROSTER_VIEW_STORAGE_KEY } from "@/lib/mtm/live-map-roster"
import { resetLiveMapPlaceCacheForTests } from "@/components/mtm/live-map-agent-place"

const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180
const CENTRE = { latitude: 40.4093, longitude: 49.8671 }
const northOf = (meters: number) => ({ latitude: CENTRE.latitude + meters / METERS_PER_DEGREE, longitude: CENTRE.longitude })

interface Row { agentId: string; name: string; fieldStatus: string; meters: number | null; minutesAgo: number; battery?: number; workdayState?: string; managerId?: string; managerName?: string; tags?: string[] }
let rosterRows: Row[]
let requests: string[]
/** What the journal and the road server answer for the selected employee's card. */
let activityLogs: Array<Record<string, unknown>>
let street: string | null
/** Today's routes of whoever is asked about. */
let routes: Array<Record<string, unknown>>
/** A tenant with Route & Field only says nothing of the workday. */
let workforceEnabled: boolean
/** How long the day's route takes to come back, as over a real network. */
let routeDelayMs: number
/** What the server says of the client base, or a status when it fails. */
let clientBase: Record<string, unknown> | number

function answer(now: number) {
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()
  return {
    success: true,
    data: {
      agentLocations: rosterRows.map((row) => ({
        agentId: row.agentId, name: row.name, isOnline: true, lastSeenAt: iso(0), teamId: null, teamName: null,
        managerId: row.managerId ?? null, managerName: row.managerName ?? null,
        tags: row.tags ?? [], mapColor: null,
        fieldStatus: row.fieldStatus, freshness: row.meters == null ? "NO_LOCATION" : "ONLINE",
        workdayState: row.workdayState ?? "ACTIVE", workdayDate: "2026-10-09", workdayStartedAt: iso(120), workdayCarryover: false,
        workdayPausedAt: workforceEnabled && row.workdayState === "PAUSED" ? iso(35) : null, workdayCompletedAt: null,
        locationState: row.meters == null ? "NO_LOCATION_REPORTED" : "AVAILABLE",
        routeCompletion: 0, routeVisited: 0, routeTotal: 0, openVisitSince: null,
        ...(row.meters == null ? {} : { ...northOf(row.meters), accuracy: 10, speed: 20, battery: row.battery ?? 70, recordedAt: iso(row.minutesAgo) }),
      })),
      liveFeed: [],
      teams: [],
      contract: {
        scope: "ORGANIZATION", today: "2026-10-09", timezone: "Asia/Baku", maxRosterSize: 500, returnedAgents: rosterRows.length,
        rosterTruncated: false, markerCount: rosterRows.filter((row) => row.meters != null).length, workforceEnabled,
        generatedAt: new Date(now).toISOString(), polling: { minimumIntervalSeconds: 15 },
        freshnessThresholds: { onlineSeconds: 300, delayedSeconds: 600 }, maxAccuracyMeters: 100, geofenceRadiusMeters: 150,
      },
    },
  }
}

describe("the live map page, end to end", () => {
  let root: Root
  let container: HTMLDivElement

  const byTestId = (testId: string) => document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const settle = async (ms = 0) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
  const press = async (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error("element not found")
    await act(async () => { element.click() })
    await settle()
  }
  const rowIds = () => [...container.querySelectorAll('[data-testid^="live-map-agent-card-"]')].map((row) => row.getAttribute("data-testid")!.replace("live-map-agent-card-", ""))
  const onMap = () => (hoisted.map.props?.agents as Array<{ agentId: string }>).map((agent) => agent.agentId)
  const mapProp = <T,>(name: string) => hoisted.map.props?.[name] as T
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
  const open = async () => {
    await act(async () => { root.render(createElement(MtmMapPage)) })
    await settle(20)
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    window.localStorage.clear()
    // The streets the tab remembers are the tab's: every case starts with none.
    resetLiveMapPlaceCacheForTests()
    hoisted.map.props = null
    requests = []
    activityLogs = []
    street = "Nizami küçəsi"
    routes = []
    workforceEnabled = true
    routeDelayMs = 0
    clientBase = {
      clients: [
        { id: "c-near", name: "Аптека на углу", ...northOf(500), category: "A", objectType: "PHARMACY", geofenceRadius: 150 },
        { id: "c-far", name: "Клиника", ...northOf(7_000), category: "B", objectType: "CLINIC", geofenceRadius: null },
      ],
      total: 5, withoutCoordinates: 3, truncated: false,
    }
    rosterRows = [
      { agentId: "far", name: "Fərid", fieldStatus: "ON_ROAD", meters: 7_400, minutesAgo: 1 },
      { agentId: "near", name: "Nigar", fieldStatus: "STOPPED", meters: 450, minutesAgo: 1, battery: 12 },
      { agentId: "mid", name: "Murad", fieldStatus: "ON_ROAD", meters: 3_000, minutesAgo: 2 },
      { agentId: "none", name: "Aynur", fieldStatus: "OFFLINE", meters: null, minutesAgo: 0 },
    ]
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(String(input), "http://localhost")
      requests.push(url.pathname + url.search)
      if (url.pathname === "/api/v1/mtm/locations") return Response.json(answer(Date.now()))
      if (url.pathname === "/api/v1/mtm/routes") {
        if (routeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, routeDelayMs))
        return Response.json({ success: true, data: { routes } })
      }
      if (url.pathname === "/api/v1/mtm/activity") return Response.json({ success: true, data: { logs: activityLogs } })
      if (url.pathname === "/api/v1/mtm/alerts") return Response.json({ success: true, data: { groups: [] } })
      if (url.pathname === "/api/v1/mtm/geocode/street") return Response.json({ success: true, data: { available: true, street, distanceMeters: 9 } })
      if (url.pathname === "/api/v1/mtm/locations/clients") {
        return typeof clientBase === "number" ? new Response("{}", { status: clientBase }) : Response.json({ success: true, data: clientBase })
      }
      // The card's own two blocks: the day counted on the server, and what the phone registered with.
      if (url.pathname === "/api/v1/mtm/locations/day-totals") {
        return Response.json({ success: true, data: {
          date: "2026-10-09", timezone: "Asia/Baku", distanceMeters: 18_400, distanceBasis: "ROADS", movingSeconds: 2_700, unknownSeconds: 0,
          firstPointAt: new Date(Date.now() - 4 * 3_600_000).toISOString(), lastPointAt: new Date(Date.now() - 60_000).toISOString(), complete: true,
          generatedAt: new Date().toISOString(),
        } })
      }
      if (url.pathname === "/api/v1/mtm/locations/device") {
        return Response.json({ success: true, data: { notificationsConnected: true, platform: "android", appVersion: "2.4.1", registeredAt: null } })
      }
      throw new Error(`unexpected request: ${url.pathname}`)
    }))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("opens with everybody in the list by name and only the people with a live position on the map", async () => {
    await open()
    expect(requests).toEqual(["/api/v1/mtm/locations"])
    expect(rowIds()).toEqual(["none", "far", "mid", "near"])
    expect(onMap().sort()).toEqual(["far", "mid", "near"])
    expect(byTestId("live-map-roster-count")?.textContent).toBe("4 из 4")
    // No tool is waiting for a press, and there is no point to measure to.
    expect([mapProp("pressMode"), mapProp("referencePoint"), (mapProp<unknown[]>("rulerPoints")).length]).toEqual([null, null, 0])
    expect(byTestId("roster-column-distance")).toBeNull()
  })

  it("draws on the map only what the chips and the column menus leave in the list — and counts the chips the same way", async () => {
    await open()
    await press(byTestId("mtm-map-status-chip-ON_ROAD"))
    expect(rowIds()).toEqual(["far", "mid"])
    expect(onMap().sort()).toEqual(["far", "mid"])
    expect(byTestId("mtm-map-status-chip-ON_ROAD")?.getAttribute("aria-pressed")).toBe("true")
    expect(byTestId("live-map-roster-filter-chip-status")?.textContent).toBe("Статус: В пути")
    // The same chip again takes the filter off.
    await press(byTestId("mtm-map-status-chip-ON_ROAD"))
    expect(rowIds()).toHaveLength(4)

    // A filter on another column: the chips now count inside it.
    await press(byTestId("live-map-roster-filters-button"))
    await press(byTestId("live-map-roster-filters-value-battery-LOW"))
    await press(byTestId("live-map-roster-filters-done"))
    expect(rowIds()).toEqual(["near"])
    expect(onMap()).toEqual(["near"])
    expect(byTestId("mtm-map-status-chip-all")?.textContent).toContain("(1)")
    expect(byTestId("mtm-map-status-chip-ON_ROAD")?.textContent).toContain("(0)")
    expect(byTestId("mtm-map-status-chip-STOPPED")?.textContent).toContain("(1)")
  })

  it("takes an unticked employee off the map and keeps him in the list; selecting him puts him back", async () => {
    await open()
    await press(byTestId("live-map-agent-on-map-mid"))
    expect(onMap().sort()).toEqual(["far", "near"])
    expect(rowIds()).toContain("mid")
    expect(mapProp("focusAgentId")).toBeNull()
    await press(byTestId("live-map-agent-card-mid"))
    expect(mapProp("focusAgentId")).toBe("mid")
    expect(onMap().sort()).toEqual(["far", "mid", "near"])
    expect((byTestId("live-map-agent-on-map-mid") as HTMLInputElement).checked).toBe(true)
    expect(requests).toContain("/api/v1/mtm/routes?agentId=mid&date=2026-10-09")
  })

  it("lets go of the selected employee when a filter takes his row away", async () => {
    await open()
    await press(byTestId("live-map-agent-card-far"))
    expect(mapProp("focusAgentId")).toBe("far")
    expect(byTestId("live-map-agent-detail")).not.toBeNull()
    await press(byTestId("mtm-map-status-chip-STOPPED"))
    expect(rowIds()).toEqual(["near"])
    expect(mapProp("focusAgentId")).toBeNull()
    expect(byTestId("live-map-agent-detail")).toBeNull()
  })

  it("turns the list to «nearest first» when a point is pressed on the map, measured only from live positions", async () => {
    await open()
    await press(byTestId("live-map-tool-point"))
    await press(byTestId("live-map-pick-point"))
    expect(mapProp("pressMode")).toBe("point")
    // The map reports the press; the page decides it is the point.
    await act(async () => { mapProp<(latitude: number, longitude: number) => void>("onMapPress")(CENTRE.latitude, CENTRE.longitude) })
    await settle()
    expect(mapProp("pressMode")).toBeNull()
    expect(mapProp<{ label: string }>("referencePoint")).toEqual({ ...CENTRE, label: "Точка на карте" })
    expect(rowIds()).toEqual(["near", "mid", "far", "none"])
    // What a sighted person reads in the cell: the words kept for a screen reader are left out.
    const distance = (agentId: string) => {
      const copy = container.querySelector(`[data-testid="live-map-agent-card-${agentId}"] [data-column="distance"]`)?.cloneNode(true) as Element | undefined
      for (const hidden of copy?.querySelectorAll(".sr-only") ?? []) hidden.remove()
      return copy?.textContent
    }
    expect([distance("near"), distance("mid"), distance("far"), distance("none")]).toEqual(["450 м", "3,0 км", "7,4 км", "—"])
    expect(byTestId("roster-column-distance")?.closest('[role="columnheader"]')?.getAttribute("aria-sort")).toBe("ascending")
    expect(byTestId("live-map-point-chip")?.textContent).toBe("Ближайшие к: Точка на картеУбрать")

    // Another order asked for in a column menu — the very one that is remembered,
    // by name A to Z, which is not the order of the distances: «nearest first»
    // steps aside, the distance stays in view.
    const sortOf = (column: string) => byTestId(`roster-column-${column}`)?.closest('[role="columnheader"]')?.getAttribute("aria-sort")
    await press(byTestId("roster-column-name"))
    await press(byTestId("roster-sort-name-asc"))
    await closeMenu()
    expect(rowIds()).toEqual(["none", "far", "mid", "near"])
    expect([sortOf("name"), sortOf("distance")]).toEqual(["ascending", "none"])
    expect(distance("near")).toBe("450 м")
    // What is remembered for tomorrow is the order by name, never the distance.
    expect(JSON.parse(window.localStorage.getItem(ROSTER_VIEW_STORAGE_KEY) ?? "{}").sort).toEqual({ column: "name", direction: "asc" })

    // The point removed: no distance column, the list in the order last asked for.
    await press(byTestId("live-map-point-clear"))
    expect(mapProp("referencePoint")).toBeNull()
    expect(byTestId("roster-column-distance")).toBeNull()
    expect(rowIds()).toEqual(["none", "far", "mid", "near"])
  })

  it("comes back as it was left in this browser: the order of the list and the look of the map", async () => {
    window.localStorage.setItem(ROSTER_VIEW_STORAGE_KEY, JSON.stringify({ width: "wide", sort: { column: "name", direction: "desc" }, groupBy: "none", columns: ["name", "status", "battery"] }))
    window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ labels: true, trails: false, glide: false }))
    await open()
    expect(rowIds()).toEqual(["near", "mid", "far", "none"])
    expect(byTestId("roster-column-name")?.closest('[role="columnheader"]')?.getAttribute("aria-sort")).toBe("descending")
    expect(byTestId("mtm-map-canvas")?.getAttribute("data-roster")).toBe("wide")
    expect([mapProp("showLabels"), mapProp("trails"), mapProp("glideMarkers")]).toEqual([true, null, false])
  })

  it("the card comes back as it was laid out in this browser: a folded block stays folded and asks nothing, a hidden one is not drawn", async () => {
    window.localStorage.setItem("leaddrive.mtm.live-map.card.v1", JSON.stringify({ order: ["route", "events", "day", "device"], collapsed: ["day"], hidden: ["device"] }))
    await open()
    await press(byTestId("live-map-agent-card-near"))
    await settle(700)
    const blocks = [...document.querySelectorAll('[data-testid^="live-map-card-block-"]')]
      .map((block) => block.getAttribute("data-testid")!)
      .filter((id) => /^live-map-card-block-(events|route|day|device)$/.test(id))
    expect(blocks).toEqual(["live-map-card-block-route", "live-map-card-block-events", "live-map-card-block-day"])
    expect(byTestId("live-map-card-block-toggle-day")?.getAttribute("aria-expanded")).toBe("false")
    // Folded and hidden blocks ask the server for nothing.
    expect(requests.filter((request) => request.startsWith("/api/v1/mtm/locations/day-totals") || request.startsWith("/api/v1/mtm/locations/device"))).toEqual([])
    // Unfolded, the block asks once — and the choice is remembered.
    await press(byTestId("live-map-card-block-toggle-day"))
    await settle(700)
    expect(requests.filter((request) => request.startsWith("/api/v1/mtm/locations/day-totals"))).toEqual(["/api/v1/mtm/locations/day-totals?agentId=near"])
    expect(JSON.parse(window.localStorage.getItem("leaddrive.mtm.live-map.card.v1") ?? "{}")).toMatchObject({ collapsed: [], hidden: ["device"] })
  })

  it("the printed sheet is headed with the page's name and the organization's own clock, not the browser's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      // 21:30 UTC on the 9th is half past one at night on the 10th in Baku.
      vi.setSystemTime(new Date("2026-10-09T21:30:00.000Z"))
      await open()
      await press(byTestId("live-map-roster-print"))
      const frame = document.querySelector<HTMLIFrameElement>('iframe[data-testid="live-map-roster-print-frame"]')!
      const heading = new DOMParser().parseFromString(frame.srcdoc, "text/html").querySelector("h1")?.textContent ?? ""
      expect(heading).toMatch(/^Живая карта · 10 окт\. 2026 г\., 01:30$/)
      frame.remove()
    } finally {
      vi.useRealTimers()
    }
  })

  it("selects an employee from his marker, and a second press on the same marker does not let go of him", async () => {
    await open()
    const selectOnMap = async (agentId: string) => {
      await act(async () => { mapProp<(agentId: string) => void>("onAgentSelect")(agentId) })
      await settle()
    }
    await selectOnMap("mid")
    expect(mapProp("focusAgentId")).toBe("mid")
    expect(requests).toContain("/api/v1/mtm/routes?agentId=mid&date=2026-10-09")
    expect(byTestId("live-map-agent-card-mid")?.getAttribute("data-selected")).toBe("true")
    // The second press is somebody reading his balloon.
    await selectOnMap("mid")
    expect(mapProp("focusAgentId")).toBe("mid")
  })

  it("does not count among «the nearest» somebody the map itself does not draw, and drops a distance filter with the point", async () => {
    // Fresh coordinate, two hundred metres away — but his workday is closed, so the map has no marker for him.
    rosterRows = [...rosterRows, { agentId: "home", name: "Vüqar", fieldStatus: "ON_ROAD", meters: 200, minutesAgo: 1, workdayState: "CLOSED" }]
    await open()
    expect(onMap().sort()).toEqual(["far", "mid", "near"])
    // His earlier positions are not in anybody's tail either.
    expect(mapProp<Map<string, unknown[]>>("trails").has("home")).toBe(false)
    await press(byTestId("live-map-tool-point"))
    await press(byTestId("live-map-pick-point"))
    await act(async () => { mapProp<(latitude: number, longitude: number) => void>("onMapPress")(CENTRE.latitude, CENTRE.longitude) })
    await settle()
    expect(rowIds().slice(0, 3)).toEqual(["near", "mid", "far"])
    expect(container.querySelector('[data-testid="live-map-agent-card-home"] [data-column="distance"]')?.textContent).toBe("—")

    // «Only within a kilometre», then the point is removed: the filter goes with it instead of emptying the list.
    await press(byTestId("roster-column-distance"))
    await press(byTestId("roster-filter-value-distance-NEAR"))
    await closeMenu()
    expect(rowIds()).toEqual(["near"])
    await press(byTestId("live-map-point-clear"))
    expect(rowIds()).toHaveLength(5)
    expect(byTestId("live-map-roster-filter-chip-distance")).toBeNull()
    expect(onMap().sort()).toEqual(["far", "mid", "near"])
  })

  it("brings the list back when a point is picked while it is put away: the answer is in the list", async () => {
    await open()
    await press(byTestId("live-map-roster-view"))
    await press(byTestId("live-map-roster-hide"))
    await closeMenu()
    expect(byTestId("mtm-map-canvas")?.getAttribute("data-roster")).toBe("hidden")
    await press(byTestId("live-map-tool-point"))
    await press(byTestId("live-map-pick-point"))
    await act(async () => { mapProp<(latitude: number, longitude: number) => void>("onMapPress")(CENTRE.latitude, CENTRE.longitude) })
    await settle()
    expect(byTestId("mtm-map-canvas")?.getAttribute("data-roster")).toBe("narrow")
    expect(rowIds()[0]).toBe("near")
  })

  it("never remembers «by distance» as the order of the list", async () => {
    await open()
    await press(byTestId("live-map-tool-point"))
    await press(byTestId("live-map-pick-point"))
    await act(async () => { mapProp<(latitude: number, longitude: number) => void>("onMapPress")(CENTRE.latitude, CENTRE.longitude) })
    await settle()
    // Asked for by hand, the far end first.
    await press(byTestId("roster-column-distance"))
    await press(byTestId("roster-sort-distance-desc"))
    await closeMenu()
    expect(rowIds()).toEqual(["far", "mid", "near", "none"])
    expect(JSON.parse(window.localStorage.getItem(ROSTER_VIEW_STORAGE_KEY) ?? "{}").sort).toEqual({ column: "name", direction: "asc" })
    // Grouping changed meanwhile: the list keeps the order it is shown in.
    await press(byTestId("live-map-roster-view"))
    await press(byTestId("live-map-roster-group-status"))
    await closeMenu()
    expect(JSON.parse(window.localStorage.getItem(ROSTER_VIEW_STORAGE_KEY) ?? "{}")).toMatchObject({ groupBy: "status", sort: { column: "name", direction: "asc" } })
    await press(byTestId("live-map-point-clear"))
    // With the point gone there is nothing to be far from: back to the remembered order, inside the groups.
    expect(byTestId("roster-column-distance")).toBeNull()
    expect(byTestId("roster-column-name")?.closest('[role="columnheader"]')?.getAttribute("aria-sort")).toBe("ascending")
  })

  it("gives the map's presses to the ruler while it is on, and to nobody once it is off", async () => {
    await open()
    await press(byTestId("live-map-tool-ruler"))
    expect(mapProp("pressMode")).toBe("ruler")
    const pressMap = async (meters: number) => {
      await act(async () => { mapProp<(latitude: number, longitude: number) => void>("onMapPress")(northOf(meters).latitude, CENTRE.longitude) })
      await settle()
    }
    await pressMap(0)
    await pressMap(1_000)
    await pressMap(600)
    expect(mapProp<unknown[]>("rulerPoints")).toHaveLength(3)
    expect(byTestId("live-map-ruler-total")?.textContent).toBe("Линейка: 1,4 км")
    // A point for the list is not picked by the ruler's presses.
    expect(mapProp("referencePoint")).toBeNull()
    await press(byTestId("live-map-ruler-undo"))
    expect(byTestId("live-map-ruler-total")?.textContent).toBe("Линейка: 1,0 км")
    await press(byTestId("live-map-ruler-done"))
    expect([mapProp("pressMode"), mapProp<unknown[]>("rulerPoints").length]).toEqual([null, 0])
    // Switching to «point on the map» switches the ruler off, points and all.
    await press(byTestId("live-map-tool-ruler"))
    await pressMap(200)
    await press(byTestId("live-map-tool-point"))
    await press(byTestId("live-map-pick-point"))
    expect([mapProp("pressMode"), mapProp<unknown[]>("rulerPoints").length]).toEqual(["point", 0])
  })

  it("hands the map its tail from the roster's own answers and switches the three looks from «Слои»", async () => {
    await open()
    const trails = () => mapProp<Map<string, unknown[]> | null>("trails")
    // One answer so far: one position each, and nobody without a coordinate.
    expect([...(trails()?.keys() ?? [])].sort()).toEqual(["far", "mid", "near"])
    expect(trails()?.get("far")).toHaveLength(1)
    expect([mapProp("showLabels"), mapProp("glideMarkers")]).toEqual([false, true])
    // Nothing but the roster (and no day's track) was asked of the server.
    expect(requests.filter((request) => !request.startsWith("/api/v1/mtm/locations"))).toEqual([])

    await press(container.querySelector('[data-testid="live-map-layers"] > button'))
    await press(byTestId("live-map-layer-labels"))
    await press(byTestId("live-map-layer-trails"))
    await press(byTestId("live-map-layer-glide"))
    expect([mapProp("showLabels"), trails(), mapProp("glideMarkers")]).toEqual([true, null, false])
    // The look of the map is remembered in the browser.
    expect(JSON.parse(window.localStorage.getItem("leaddrive.mtm.live-map.look.v1") ?? "{}")).toEqual({ labels: true, trails: false, glide: false, clients: false, base: "voyager" })
  })

  it("switches the map's background from «Слои», remembers it, and comes back with it", async () => {
    await open()
    // The map everybody knows: the map is handed no other background.
    expect(mapProp("baseMap")).toBeNull()
    await press(document.querySelector('[data-testid="live-map-layers"] > button'))
    expect([...document.querySelectorAll('[data-testid="live-map-base-maps"] [role="radio"]')].map((choice) => choice.textContent)).toEqual(["Карта", "Светлая", "Тёмная"])
    await press(byTestId("live-map-base-map-dark"))
    expect(mapProp<{ id: string; url: string }>("baseMap")).toMatchObject({ id: "dark", url: expect.stringContaining("/dark_all/") })
    expect(byTestId("live-map-base-map-dark")?.getAttribute("aria-checked")).toBe("true")
    expect(JSON.parse(window.localStorage.getItem("leaddrive.mtm.live-map.look.v1") ?? "{}")).toMatchObject({ base: "dark" })

    // The page is opened again in this browser.
    await act(async () => { root.unmount() })
    root = createRoot(container)
    await open()
    expect(mapProp<{ id: string }>("baseMap")).toMatchObject({ id: "dark" })
    // A background this build does not offer (no satellite address was given) falls back to the usual map.
    await act(async () => { root.unmount() })
    root = createRoot(container)
    window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ base: "satellite" }))
    await open()
    expect(mapProp("baseMap")).toBeNull()
  })

  it("puts the list away on a wide screen without touching what the map draws, and says when a filter is narrowing it", async () => {
    await open()
    await press(byTestId("mtm-map-status-chip-ON_ROAD"))
    await press(byTestId("live-map-roster-view"))
    await press(byTestId("live-map-roster-hide"))
    await closeMenu()
    expect(byTestId("mtm-map-canvas")?.getAttribute("data-roster")).toBe("hidden")
    expect(byTestId("live-map-roster")?.className).toContain("lg:hidden")
    expect(byTestId("live-map-roster-show")?.textContent).toBe("Список: 2 из 4 · фильтр")
    expect(onMap().sort()).toEqual(["far", "mid"])
    await press(byTestId("live-map-roster-show"))
    expect(byTestId("mtm-map-canvas")?.getAttribute("data-roster")).toBe("narrow")
    expect(byTestId("live-map-roster")?.className).not.toContain("lg:hidden")
  })

  it("opens the selected employee's card with where he is, since when, and his own events of today", async () => {
    rosterRows[1] = { agentId: "near", name: "Nigar", fieldStatus: "STOPPED", meters: 450, minutesAgo: 1, workdayState: "PAUSED", managerId: "boss-1", managerName: "Старший Первый", tags: ["стажёр", "север"] }
    activityLogs = [
      { id: "2", action: "WORKDAY_PAUSE", agentId: "near", createdAt: new Date(Date.now() - 35 * 60_000).toISOString() },
      { id: "1", action: "CHECK_OUT", agentId: "near", createdAt: new Date(Date.now() - 50 * 60_000).toISOString(), subject: { customerName: "Аптека на углу", visitId: "v1", routeId: null } },
      // The office editing his card is not his event.
      { id: "0", action: "AGENT_UPDATE", agentId: "near", createdAt: new Date(Date.now() - 55 * 60_000).toISOString() },
    ]
    await open()
    await press(byTestId("live-map-agent-card-near"))
    // The street is asked once the position has rested (the picker's rhythm);
    // then for as long as the answers are on their way — a loaded runner is slow.
    await settle(800)
    for (let turn = 0; turn < 150; turn += 1) {
      const waiting = byTestId("live-map-agent-place-text")?.textContent === "определяю улицу…"
        || document.querySelectorAll('[data-testid="live-map-agent-event"]').length === 0
      if (!waiting) break
      await settle(20)
    }
    const detail = byTestId("live-map-agent-detail")!
    expect(detail.querySelector('[data-testid="live-map-agent-place-text"]')?.textContent).toBe("Nizami küçəsi")
    // (Run in the first half-hour after the organization's midnight, the break began «вчера» and carries its date.)
    expect(detail.querySelector('[data-testid="live-map-since-BREAK"]')?.textContent).toMatch(/^Перерыв с .*\d{2}:\d{2} · 35 мин$/)
    const events = [...detail.querySelectorAll('[data-testid="live-map-agent-event"]')].map((row) => row.textContent?.replace(/^\d{2}:\d{2}/, ""))
    expect(events).toEqual(["Перерыв", "Завершил визит · Аптека на углу", "Рабочий день начат"])
    // Asked for him, for today — his own journal, not the team's feed under the map.
    const card = requests.filter((request) => !request.startsWith("/api/v1/mtm/locations") && !request.startsWith("/api/v1/mtm/routes"))
    expect(card.filter((request) => request.startsWith("/api/v1/mtm/activity"))).toEqual(["/api/v1/mtm/activity?agentId=near&period=today&type=FIELD_DAY&limit=100"])
    expect(card.filter((request) => request.startsWith("/api/v1/mtm/alerts"))).toEqual(["/api/v1/mtm/alerts?view=groups&agentId=near&status=all"])
    expect(card.filter((request) => request.startsWith("/api/v1/mtm/geocode/street"))).toHaveLength(1)
    // Whom she reports to is said in the card, whether or not the list draws that column.
    expect(detail.querySelector('[data-testid="live-map-agent-manager"]')?.textContent).toBe("Руководитель: Старший Первый")
    // And the labels a manager put on her.
    expect(detail.querySelector('[data-testid="live-map-agent-tags"]')?.textContent).toBe("Метки: стажёр, север")
    expect(byTestId("roster-column-manager")).toBeNull()
    // The list above it can be taken away as a file.
    expect(byTestId("live-map-roster-export")?.textContent).toBe("Excel")
  })

  it("the card also carries the day in numbers, the phone, and worded links to the other screens already narrowed to him", async () => {
    await open()
    await press(byTestId("live-map-agent-card-near"))
    for (let turn = 0; turn < 150; turn += 1) {
      if (byTestId("live-map-agent-day-distance") && byTestId("live-map-device-notifications")) break
      await settle(20)
    }
    const detail = byTestId("live-map-agent-detail")!
    // Counted on the server for him, for the organization's today: the page sends who, never which day.
    expect(requests.filter((request) => request.startsWith("/api/v1/mtm/locations/day-totals"))).toEqual(["/api/v1/mtm/locations/day-totals?agentId=near"])
    expect(detail.querySelector('[data-testid="live-map-agent-day-distance"]')?.textContent).toContain("18,4 км")
    expect(detail.querySelector('[data-testid="live-map-agent-day-distance"]')?.textContent).toContain("по дорогам")
    expect(detail.querySelector('[data-testid="live-map-agent-day-moving"]')?.textContent).toContain("45 мин")
    // The phone: what the list already knew, and the two things one small read adds.
    expect(requests.filter((request) => request.startsWith("/api/v1/mtm/locations/device"))).toEqual(["/api/v1/mtm/locations/device?agentId=near"])
    expect(detail.querySelector('[data-testid="live-map-device-battery"]')?.textContent).toMatch(/^Батарея: 12%/)
    expect(detail.querySelector('[data-testid="live-map-device-app-version"]')?.textContent).toBe("Версия приложения: 2.4.1")
    expect(detail.querySelector('[data-testid="live-map-device-notifications"]')?.textContent).toBe("Уведомления: Подключены")
    // A default the server fills in is not shown as the phone's own word.
    expect(detail.textContent).not.toMatch(/android/i)
    // The other screens, in words, each opened on him.
    const links = [...detail.querySelectorAll('[data-testid^="live-map-agent-link-"]')].map((link) => [link.textContent, link.getAttribute("href")])
    expect(links).toEqual([
      ["Оповещения", "/mtm/alerts?agentId=near"],
      ["Отчёт за период", "/mtm/calendar?view=agent&agentId=near"],
      ["Задачи", "/mtm/tasks?agentId=near"],
      ["Профиль сотрудника", "/mtm/agents/near"],
      ["Настройки оповещений", "/mtm/settings?tab=alerts"],
    ])
    // «История за день» stays the pill it was, with today's date.
    expect(byTestId("live-map-open-history")?.getAttribute("href")).toBe("/mtm/map?mode=history&agentId=near&date=2026-10-09")
    // The list above the card can be printed as it stands.
    expect(byTestId("live-map-roster-print")?.textContent).toBe("Печать")
  })

  it("says nothing about a place for somebody the map shows no live position for", async () => {
    await open()
    await press(byTestId("live-map-agent-card-none"))
    await settle(700)
    expect(byTestId("live-map-agent-detail")).not.toBeNull()
    expect(byTestId("live-map-agent-place")).toBeNull()
    expect(requests.some((request) => request.startsWith("/api/v1/mtm/geocode/street"))).toBe(false)
  })

  it("reads an area from the ruler once it has three points", async () => {
    await open()
    await press(byTestId("live-map-tool-ruler"))
    const pressMap = async (latitude: number, longitude: number) => {
      await act(async () => { mapProp<(lat: number, lng: number) => void>("onMapPress")(latitude, longitude) })
      await settle()
    }
    await pressMap(40.4, 49.8)
    await pressMap(40.409, 49.8)
    expect(byTestId("live-map-ruler-area")).toBeNull()
    await pressMap(40.409, 49.8118)
    // About a kilometre by a kilometre, halved: a triangle of some fifty hectares.
    expect(byTestId("live-map-ruler-area")?.textContent).toMatch(/^Площадь внутри: \d{2},\d га$/)
    // A fourth point that takes the line back across itself: a figure of eight has no one area.
    await pressMap(40.4, 49.806)
    await pressMap(40.412, 49.806)
    expect(mapProp<unknown[]>("rulerPoints")).toHaveLength(5)
    expect(byTestId("live-map-ruler-area")).toBeNull()
    expect(byTestId("live-map-ruler-total")).not.toBeNull()
  })

  it("a tenant without the Workforce module is told nothing of a break in the card, as nowhere else on the page", async () => {
    workforceEnabled = false
    rosterRows[1] = { agentId: "near", name: "Nigar", fieldStatus: "STOPPED", meters: 450, minutesAgo: 1, workdayState: "PAUSED" }
    await open()
    await press(byTestId("live-map-agent-card-near"))
    await settle(700)
    expect(byTestId("live-map-agent-detail")).not.toBeNull()
    expect(byTestId("live-map-since-BREAK")).toBeNull()
    // The journal gave no shift rows and the row's shift start is not offered either.
    expect([...document.querySelectorAll('[data-testid="live-map-agent-event"]')]).toHaveLength(0)
  })

  describe("«Клиенты»: the client base as a layer", () => {
    const openLayers = async () => { await press(container.querySelector('[data-testid="live-map-layers"] > button')) }
    const clientRequests = () => requests.filter((request) => request.startsWith("/api/v1/mtm/locations/clients")).length
    const hint = () => byTestId("live-map-layer-hint-clients")?.textContent

    it("is off until asked for: nothing is read and the map is given no clients", async () => {
      await open()
      expect(clientRequests()).toBe(0)
      expect(mapProp<unknown[]>("clients")).toEqual([])
      await openLayers()
      expect(byTestId("live-map-layer-clients")?.getAttribute("aria-checked")).toBe("false")
      expect(hint()).toBe("учреждения из базы, у которых есть координаты")
    })

    it("switched on, reads the base once, hands the points to the map and says what it does not show", async () => {
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-clients"))
      await settle(20)
      expect(clientRequests()).toBe(1)
      expect(mapProp<Array<{ id: string }>>("clients").map((client) => client.id)).toEqual(["c-near", "c-far"])
      // Five in the base, two with a place: the other three are not on any map, and the layer says so.
      expect(hint()).toMatch(/^на карте 2 .+ · \S/)
      expect(hint()).not.toContain("не удалось")
      // The organization's check-in radius goes with them, for clients without one of their own.
      expect(mapProp("geofenceRadius")).toBe(150)
      // The employees on the map are who they were: clients take no marker from anybody.
      expect(onMap().sort()).toEqual(["far", "mid", "near"])
      // Remembered in this browser like the other looks of the map.
      expect(JSON.parse(window.localStorage.getItem("leaddrive.mtm.live-map.look.v1") ?? "{}")).toMatchObject({ clients: true })
      // Off again: the map is given none, and nothing is read.
      await press(byTestId("live-map-layer-clients"))
      expect(mapProp<unknown[]>("clients")).toEqual([])
      expect(clientRequests()).toBe(1)
      // And on again: the base that was read is still the base — nothing is asked for anew.
      await press(byTestId("live-map-layer-clients"))
      await settle(20)
      expect(mapProp<unknown[]>("clients")).toHaveLength(2)
      expect(clientRequests()).toBe(1)
    })

    it("«Кто ближе всех» in a client's balloon turns the list to that client — nearest employee first", async () => {
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-clients"))
      await settle(20)
      const [nearClient] = mapProp<Array<{ id: string; name: string; latitude: number; longitude: number }>>("clients")
      await act(async () => { mapProp<(client: unknown) => void>("onClientNearest")(nearClient) })
      await settle()
      expect(mapProp<{ label: string }>("referencePoint")).toMatchObject({ label: "Аптека на углу", latitude: nearClient.latitude, longitude: nearClient.longitude })
      // «Nigar» stands 450 m north of the centre, the client 500 m: she is fifty metres from it.
      expect(rowIds().slice(0, 3)).toEqual(["near", "mid", "far"])
      expect(byTestId("live-map-agent-distance-near")?.textContent).toContain("50")
    })

    it("a layer that is on and could not be read says so on the map itself, with a way to try again", async () => {
      clientBase = 500
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-clients"))
      await settle(20)
      expect(hint()).toBe("не удалось загрузить клиентов — нажмите «Обновить»")
      expect(mapProp<unknown[]>("clients")).toEqual([])
      // With «Слои» closed the map would look exactly like «no clients here».
      await openLayers()
      const alert = byTestId("live-map-layers-alert")
      expect(alert?.textContent).toContain("Клиенты не загрузились")
      clientBase = { clients: [{ id: "c-near", name: "Аптека на углу", ...northOf(500), category: "A", objectType: "PHARMACY", geofenceRadius: null }], total: 1, withoutCoordinates: 0, truncated: false }
      await press(byTestId("live-map-layers-alert-action"))
      await settle(20)
      expect(clientRequests()).toBe(2)
      expect(mapProp<unknown[]>("clients")).toHaveLength(1)
      expect(byTestId("live-map-layers-alert")).toBeNull()
    })

    it("a base cut by the server says so on the map as well: part of it is not the whole", async () => {
      clientBase = { ...(clientBase as Record<string, unknown>), truncated: true, total: 12_000 }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-clients"))
      await settle(20)
      expect(hint()).toContain("показана только часть базы")
      await openLayers()
      expect(byTestId("live-map-layers-alert")?.textContent).toBe("показана только часть базы")
      expect(byTestId("live-map-layers-alert-action")).toBeNull()
    })

    it("a malformed answer draws nothing rather than made-up points", async () => {
      clientBase = { clients: "not a list", total: 3 }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-clients"))
      await settle(20)
      expect(mapProp<unknown[]>("clients")).toEqual([])
      expect(hint()).toBe("не удалось загрузить клиентов — нажмите «Обновить»")
    })
  })

  describe("while the map refreshes itself", () => {
    // Half a minute between refreshes: the clock is driven by hand, a second at
    // a time (React applies what a timer set when the `act` it fired in ends).
    const forward = async (ms: number, step = 1_000) => {
      for (let passed = 0; passed < ms; passed += step) {
        await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(step, ms - passed)) })
      }
    }
    const count = (prefix: string) => requests.filter((request) => request.startsWith(prefix)).length
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] })
      // Ten seconds into a two-minute turn of the events' own clock.
      vi.setSystemTime(new Date("2026-10-09T10:00:10.000Z"))
      // «Nigar» stands 450 m north of the centre — inside the circle of the first stop of her route.
      routes = [{
        id: "route-1", status: "IN_PROGRESS", date: "2026-10-09",
        points: [
          { id: "p1", orderIndex: 0, status: "PENDING", plannedTime: null, visitedAt: null, visits: [],
            customer: { id: "c1", name: "Аптека на углу", address: "ул. Низами, 10", ...northOf(430), geofenceRadius: 150 } },
          { id: "p2", orderIndex: 1, status: "PENDING", plannedTime: null, visitedAt: null, visits: [],
            customer: { id: "c2", name: "Клиника", address: null, ...northOf(5_000), geofenceRadius: null } },
        ],
      }]
    })
    afterEach(() => { vi.useRealTimers() })

    it("the card stays as it is — the same place, never «определяю улицу…» — and asks nobody again", async () => {
      await act(async () => { root.render(createElement(MtmMapPage)) })
      await forward(1_000)
      await act(async () => { byTestId("live-map-agent-card-near")!.click() })
      await forward(2_000)
      const placeText = () => byTestId("live-map-agent-place-text")?.textContent ?? "<нет строки>"
      expect(placeText()).toBe("в зоне клиента Аптека на углу")
      expect(byTestId("mtm-map-selected-route")?.textContent).toContain("Аптека на углу")
      // At a client of today's route: no street is asked of anyone.
      expect(count("/api/v1/mtm/geocode/street")).toBe(0)
      expect([count("/api/v1/mtm/activity"), count("/api/v1/mtm/alerts")]).toEqual([1, 1])
      // Her day in numbers and her phone: asked for once, when the card was opened.
      expect([count("/api/v1/mtm/locations/day-totals"), count("/api/v1/mtm/locations/device")]).toEqual([1, 1])

      // Everything the line and the day's steps say while two refreshes go by.
      const said = new Set<string>([placeText()])
      const steps = new Set<boolean>()
      const observer = new MutationObserver(() => {
        said.add(placeText())
        steps.add(Boolean(byTestId("mtm-map-selected-route")?.textContent?.includes("Аптека на углу")))
      })
      observer.observe(container, { subtree: true, childList: true, characterData: true })
      const polls = count("/api/v1/mtm/locations")
      // The route takes half a second to come back, and the screen is looked at
      // ten times a second: what it shows while the answer is on its way counts.
      routeDelayMs = 500
      await forward(65_000, 100)
      observer.disconnect()
      expect(count("/api/v1/mtm/locations")).toBeGreaterThanOrEqual(polls + 2)
      expect([...said]).toEqual(["в зоне клиента Аптека на углу"])
      expect([...steps]).not.toContain(false)
      expect(count("/api/v1/mtm/geocode/street")).toBe(0)
      // The map refreshed twice and nothing about her changed: her events were not asked for again…
      expect([count("/api/v1/mtm/activity"), count("/api/v1/mtm/alerts")]).toEqual([1, 1])
      // …nor the day's kilometres, nor the phone: none of the card rides on the list's thirty-second timer.
      expect([count("/api/v1/mtm/locations/day-totals"), count("/api/v1/mtm/locations/device")]).toEqual([1, 1])
      // …until the events' own clock turns: an alert about her is raised exactly while her row stands still.
      await forward(60_000)
      expect([count("/api/v1/mtm/activity"), count("/api/v1/mtm/alerts")]).toEqual([2, 2])
      // The day is counted again on the same two-minute turn; what the phone registered with is not.
      expect([count("/api/v1/mtm/locations/day-totals"), count("/api/v1/mtm/locations/device")]).toEqual([2, 1])
    })

    it("«Обновить» reads the base again; while it is on its way, and if it fails, the points already on the map stay", async () => {
      window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ labels: false, trails: true, glide: true, clients: true }))
      await act(async () => { root.render(createElement(MtmMapPage)) })
      await forward(2_000)
      expect(count("/api/v1/mtm/locations/clients")).toBe(1)
      expect(mapProp<unknown[]>("clients")).toHaveLength(2)
      // Inside the roster's own cooldown «Обновить» asks for nothing.
      await act(async () => { byTestId("mtm-map-refresh")!.click() })
      await forward(1_000)
      expect(count("/api/v1/mtm/locations/clients")).toBe(1)

      // Past it: the base is read again — and this time the read fails.
      await forward(16_000)
      clientBase = 500
      const shown = new Set<number>()
      const observer = new MutationObserver(() => shown.add(mapProp<unknown[]>("clients").length))
      observer.observe(container, { subtree: true, childList: true, characterData: true, attributes: true })
      await act(async () => { byTestId("mtm-map-refresh")!.click() })
      await forward(2_000, 100)
      observer.disconnect()
      expect(count("/api/v1/mtm/locations/clients")).toBe(2)
      // Never taken off the map: not while the read was out, not when it failed.
      expect(mapProp<unknown[]>("clients")).toHaveLength(2)
      expect([...shown]).not.toContain(0)
      await act(async () => { container.querySelector<HTMLElement>('[data-testid="live-map-layers"] > button')!.click() })
      expect(byTestId("live-map-layer-hint-clients")?.textContent).toMatch(/^на карте 2 .+не удалось обновить$/)
      // A failed read is tried again by itself a minute later, without anybody pressing anything.
      clientBase = { clients: [], total: 0, withoutCoordinates: 0, truncated: false }
      await forward(61_000)
      expect(count("/api/v1/mtm/locations/clients")).toBe(3)
      expect(mapProp<unknown[]>("clients")).toEqual([])
      expect(byTestId("live-map-layer-hint-clients")?.textContent).not.toContain("не удалось")
    })

    it("a remembered layer that fails when the page opens is tried again by itself, a bounded number of times", async () => {
      window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ labels: false, trails: true, glide: true, clients: true }))
      clientBase = 500
      await act(async () => { root.render(createElement(MtmMapPage)) })
      await forward(2_000)
      expect(count("/api/v1/mtm/locations/clients")).toBe(1)
      expect(byTestId("live-map-layers-alert")?.textContent).toContain("Клиенты не загрузились")
      await forward(10 * 60_000, 5_000)
      // The first read and three more by the page itself — not one a minute for ever.
      expect(count("/api/v1/mtm/locations/clients")).toBe(4)
    })

    it("the client base is read when its layer is switched on, not on the map's timer", async () => {
      window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ labels: false, trails: true, glide: true, clients: true }))
      await act(async () => { root.render(createElement(MtmMapPage)) })
      await forward(2_000)
      expect(count("/api/v1/mtm/locations/clients")).toBe(1)
      expect(mapProp<unknown[]>("clients")).toHaveLength(2)
      const polls = requests.filter((request) => request === "/api/v1/mtm/locations").length
      await forward(95_000)
      expect(requests.filter((request) => request === "/api/v1/mtm/locations").length).toBeGreaterThanOrEqual(polls + 3)
      expect(count("/api/v1/mtm/locations/clients")).toBe(1)
      expect(mapProp<unknown[]>("clients")).toHaveLength(2)
    })

    it("on the road the street is asked once, however many times the map refreshes", async () => {
      routes = []
      await act(async () => { root.render(createElement(MtmMapPage)) })
      await forward(1_000)
      await act(async () => { byTestId("live-map-agent-card-near")!.click() })
      await forward(2_000)
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("Nizami küçəsi")
      await forward(95_000)
      expect(count("/api/v1/mtm/locations")).toBeGreaterThanOrEqual(3)
      expect(count("/api/v1/mtm/geocode/street")).toBe(1)
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("Nizami küçəsi")
    })
  })

})
