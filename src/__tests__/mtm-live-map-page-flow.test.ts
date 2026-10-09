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

const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180
const CENTRE = { latitude: 40.4093, longitude: 49.8671 }
const northOf = (meters: number) => ({ latitude: CENTRE.latitude + meters / METERS_PER_DEGREE, longitude: CENTRE.longitude })

interface Row { agentId: string; name: string; fieldStatus: string; meters: number | null; minutesAgo: number; battery?: number; workdayState?: string }
let rosterRows: Row[]
let requests: string[]

function answer(now: number) {
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()
  return {
    success: true,
    data: {
      agentLocations: rosterRows.map((row) => ({
        agentId: row.agentId, name: row.name, isOnline: true, lastSeenAt: iso(0), teamId: null, teamName: null,
        fieldStatus: row.fieldStatus, freshness: row.meters == null ? "NO_LOCATION" : "ONLINE",
        workdayState: row.workdayState ?? "ACTIVE", workdayDate: "2026-10-09", workdayStartedAt: iso(120), workdayCarryover: false,
        locationState: row.meters == null ? "NO_LOCATION_REPORTED" : "AVAILABLE",
        routeCompletion: 0, routeVisited: 0, routeTotal: 0, openVisitSince: null,
        ...(row.meters == null ? {} : { ...northOf(row.meters), accuracy: 10, speed: 20, battery: row.battery ?? 70, recordedAt: iso(row.minutesAgo) }),
      })),
      liveFeed: [],
      teams: [],
      contract: {
        scope: "ORGANIZATION", today: "2026-10-09", timezone: "Asia/Baku", maxRosterSize: 500, returnedAgents: rosterRows.length,
        rosterTruncated: false, markerCount: rosterRows.filter((row) => row.meters != null).length, workforceEnabled: true,
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
    // First the menu is really gone; then the tick in which it hands the focus
    // back to its heading — two steps, so the next press never races it.
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  }
  const open = async () => {
    await act(async () => { root.render(createElement(MtmMapPage)) })
    await settle(20)
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    window.localStorage.clear()
    hoisted.map.props = null
    requests = []
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
      if (url.pathname === "/api/v1/mtm/routes") return Response.json({ success: true, data: { routes: [] } })
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
    await press(byTestId("live-map-roster-filters-column-battery"))
    await press(byTestId("roster-filter-only-battery-LOW"))
    await closeMenu()
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
    const distance = (agentId: string) => container.querySelector(`[data-testid="live-map-agent-card-${agentId}"] [data-column="distance"]`)?.textContent
    expect([distance("near"), distance("mid"), distance("far"), distance("none")]).toEqual(["450 м", "3,0 км", "7,4 км", "—"])
    expect(byTestId("roster-column-distance")?.closest('[role="columnheader"]')?.getAttribute("aria-sort")).toBe("ascending")
    expect(byTestId("live-map-point-chip")?.textContent).toBe("Ближайшие к: Точка на картеУбрать")

    // Another order asked for in a column menu: «nearest first» steps aside, the distance stays in view.
    await press(byTestId("roster-column-name"))
    await press(byTestId("roster-sort-name-desc"))
    await closeMenu()
    expect(rowIds()).toEqual(["near", "mid", "far", "none"].sort((a, b) => ({ near: "Nigar", mid: "Murad", far: "Fərid", none: "Aynur" } as Record<string, string>)[b].localeCompare(({ near: "Nigar", mid: "Murad", far: "Fərid", none: "Aynur" } as Record<string, string>)[a], "ru")))
    expect(distance("near")).toBe("450 м")
    // What is remembered for tomorrow is the order by name, never the distance.
    expect(JSON.parse(window.localStorage.getItem(ROSTER_VIEW_STORAGE_KEY) ?? "{}").sort).toEqual({ column: "name", direction: "desc" })

    // The point removed: no distance column, the list in the order last asked for.
    await press(byTestId("live-map-point-clear"))
    expect(mapProp("referencePoint")).toBeNull()
    expect(byTestId("roster-column-distance")).toBeNull()
    expect(rowIds()[0]).toBe("near")
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
    await press(byTestId("roster-filter-only-distance-NEAR"))
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
    expect(JSON.parse(window.localStorage.getItem("leaddrive.mtm.live-map.look.v1") ?? "{}")).toEqual({ labels: true, trails: false, glide: false })
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
})
