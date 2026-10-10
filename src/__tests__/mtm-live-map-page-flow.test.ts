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
/** The organization's own zones as the server keeps them, or a status when the read fails. */
let zoneBase: { zones: unknown; access?: { canWrite: boolean } } | number
/** How many times the zones were read, and every change the server was asked for. */
let zoneReads: number
let zoneWrites: Array<{ method: string; path: string; body: unknown }>
/** Set to make the server refuse the next changes: a status and its code. */
let zoneRefusal: { status: number; code?: string } | null
/** How long a read of the zones takes to come back; what it brings is the list as it was when it was asked for. */
let zoneReadDelayMs: number
/**
 * A read held back until the case lets it go — not for a number of
 * milliseconds: a case that checks what stands on the page «while the answer
 * is on its way» must not depend on how fast the runner is that day.
 */
let zoneReadGate: Promise<void> | null
/** The same for the employees' own answer: the page says «Загрузка карты...» until it comes. */
let rosterGate: Promise<void> | null
/** A gate, and the way to open it. */
function gate(): { held: Promise<void>; release: () => void } {
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  return { held, release }
}
/** How many of the next changes the server carries out and then cannot answer: the connection drops on the way back. */
let zoneAnswersLost: number

// An invented block a hundredth of a degree a side, and a circle beside it — as the server sends them.
const NORTH_BLOCK = {
  id: "zone-north", name: "Северный участок", kind: "POLYGON", color: null,
  centerLatitude: null, centerLongitude: null, radiusMeters: null,
  polygon: { type: "Polygon", coordinates: [[[49.8, 40.4], [49.81, 40.4], [49.81, 40.41], [49.8, 40.41], [49.8, 40.4]]] },
}
const CENTRE_CIRCLE = { id: "zone-centre", name: "Центр", kind: "CIRCLE", color: "teal", centerLatitude: 40.4, centerLongitude: 49.85, radiusMeters: 1500, polygon: null }

/** The server's side of a change to a zone: it keeps what it is sent and answers with the row. */
function answerZoneWrite(method: string, path: string, body: Record<string, unknown> | null): Response {
  zoneWrites.push({ method, path, body })
  if (zoneRefusal) return Response.json({ error: "refused", code: zoneRefusal.code }, { status: zoneRefusal.status })
  const kept = typeof zoneBase === "number" || !Array.isArray(zoneBase.zones) ? [] : zoneBase.zones as Array<Record<string, unknown>>
  if (method === "POST") {
    // As the real route does (api-mtm-map-zones.test.ts): the very drawing that is already kept is answered, not kept twice.
    const drawing = (zone: Record<string, unknown> | null) => JSON.stringify([
      zone?.name, zone?.kind, zone?.color ?? null, zone?.centerLatitude ?? null, zone?.centerLongitude ?? null, zone?.radiusMeters ?? null, zone?.polygon ?? null,
    ])
    const already = kept.find((zone) => drawing(zone) === drawing(body))
    if (already) return Response.json({ success: true, data: already })
    const zone = {
      id: `zone-new-${zoneWrites.length}`, name: body?.name, kind: body?.kind, color: body?.color ?? null,
      centerLatitude: body?.centerLatitude ?? null, centerLongitude: body?.centerLongitude ?? null, radiusMeters: body?.radiusMeters ?? null,
      polygon: body?.polygon ?? null,
    }
    kept.push(zone)
    return Response.json({ success: true, data: zone }, { status: 201 })
  }
  const id = decodeURIComponent(path.split("/").pop() ?? "")
  const index = kept.findIndex((zone) => zone.id === id)
  if (index < 0) return Response.json({ error: "Zone not found", code: "MTM_MAP_ZONE_NOT_FOUND" }, { status: 404 })
  if (method === "DELETE") {
    kept.splice(index, 1)
    return Response.json({ success: true, data: { id } })
  }
  kept[index] = { ...kept[index], ...body }
  return Response.json({ success: true, data: kept[index] })
}

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
    zoneBase = { zones: [], access: { canWrite: true } }
    zoneReads = 0
    zoneWrites = []
    zoneRefusal = null
    zoneReadDelayMs = 0
    zoneReadGate = null
    rosterGate = null
    zoneAnswersLost = 0
    rosterRows = [
      { agentId: "far", name: "Fərid", fieldStatus: "ON_ROAD", meters: 7_400, minutesAgo: 1 },
      { agentId: "near", name: "Nigar", fieldStatus: "STOPPED", meters: 450, minutesAgo: 1, battery: 12 },
      { agentId: "mid", name: "Murad", fieldStatus: "ON_ROAD", meters: 3_000, minutesAgo: 2 },
      { agentId: "none", name: "Aynur", fieldStatus: "OFFLINE", meters: null, minutesAgo: 0 },
    ]
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      requests.push(url.pathname + url.search)
      if (url.pathname.startsWith("/api/v1/mtm/locations/zones")) {
        const method = init?.method ?? "GET"
        if (method !== "GET") {
          const answered = answerZoneWrite(method, url.pathname, init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null)
          if (zoneAnswersLost > 0) {
            zoneAnswersLost -= 1
            throw new TypeError("Failed to fetch")
          }
          return answered
        }
        zoneReads += 1
        const asked = typeof zoneBase === "number" ? zoneBase : JSON.parse(JSON.stringify(zoneBase)) as Record<string, unknown>
        if (zoneReadDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, zoneReadDelayMs))
        if (zoneReadGate) await zoneReadGate
        return typeof asked === "number" ? new Response("{}", { status: asked }) : Response.json({ success: true, data: asked })
      }
      if (url.pathname === "/api/v1/mtm/locations") {
        if (rosterGate) await rosterGate
        return Response.json(answer(Date.now()))
      }
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
    expect(JSON.parse(window.localStorage.getItem("leaddrive.mtm.live-map.look.v1") ?? "{}")).toEqual({ labels: true, trails: false, glide: false, clients: false, areas: false, areasList: false, base: "voyager" })
  })

  it("switches the map's background from «Слои», remembers it, and comes back with it", async () => {
    await open()
    // The map everybody knows: the map is handed no other background.
    expect(mapProp("baseMap")).toBeNull()
    await press(document.querySelector('[data-testid="live-map-layers"] > button'))
    expect([...document.querySelectorAll('[data-testid="live-map-base-maps"] [role="radio"]')].map((choice) => choice.textContent)).toEqual(["Карта", "Светлая"])
    await press(byTestId("live-map-base-map-light"))
    expect(mapProp<{ id: string; url: string }>("baseMap")).toMatchObject({ id: "light", url: expect.stringContaining("/light_all/") })
    expect(byTestId("live-map-base-map-light")?.getAttribute("aria-checked")).toBe("true")
    expect(JSON.parse(window.localStorage.getItem("leaddrive.mtm.live-map.look.v1") ?? "{}")).toMatchObject({ base: "light" })

    // The page is opened again in this browser.
    await act(async () => { root.unmount() })
    root = createRoot(container)
    await open()
    expect(mapProp<{ id: string }>("baseMap")).toMatchObject({ id: "light" })
    // A background this build does not offer — no satellite address was given, and the dark
    // one that was taken away the night it shipped — falls back to the usual map.
    for (const gone of ["satellite", "dark"]) {
      await act(async () => { root.unmount() })
      root = createRoot(container)
      window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ base: gone }))
      await open()
      expect(mapProp("baseMap"), gone).toBeNull()
    }
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

  describe("«Свои зоны»: areas the organization draws on the map and names", () => {
    type ZoneOnMap = { id: string; name: string; kind: string; color: string | null; center?: { latitude: number; longitude: number }; radiusMeters?: number; outline?: Array<{ latitude: number; longitude: number }> }
    const openLayers = async () => { await press(container.querySelector('[data-testid="live-map-layers"] > button')) }
    const hint = () => byTestId("live-map-layer-hint-areas")?.textContent
    const zonesOnMap = () => mapProp<ZoneOnMap[]>("zones")
    // The zones' own card on the page: folded until «Показать список» is pressed.
    const card = () => byTestId("live-map-zones-card")
    const cardTitle = () => byTestId("live-map-zones-card-title")?.textContent
    const fold = () => byTestId("live-map-zones-card-fold")
    const unfoldCard = async () => { await press(fold()) }
    const zoneRows = () => [...document.querySelectorAll<HTMLElement>('[data-testid^="live-map-zone-row-zone-"]')]
    const look = () => JSON.parse(window.localStorage.getItem("leaddrive.mtm.live-map.look.v1") ?? "{}") as Record<string, unknown>
    const pressMap = async (latitude: number, longitude: number) => {
      await act(async () => { mapProp<(lat: number, lng: number) => void>("onMapPress")(latitude, longitude) })
      await settle()
    }
    const type = async (testId: string, value: string, within: ParentNode = document.body) => {
      const input = within.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)
      if (!input) throw new Error(`no field ${testId}`)
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
    }
    const notice = () => byTestId("live-map-zone-notice")?.textContent
    // Three corners of a triangle about a kilometre a side, as the ruler is pressed.
    const outlineTriangle = async () => {
      await press(byTestId("live-map-tool-ruler"))
      await pressMap(40.4, 49.8)
      await pressMap(40.409, 49.8)
      await pressMap(40.409, 49.8118)
    }

    it("is off until asked for: nothing is read and the map is given no zones", async () => {
      zoneBase = { zones: [NORTH_BLOCK], access: { canWrite: true } }
      await open()
      expect(zoneReads).toBe(0)
      expect(zonesOnMap()).toEqual([])
      await openLayers()
      const layer = byTestId("live-map-layer-areas")
      expect([layer?.getAttribute("aria-label"), layer?.getAttribute("aria-checked")]).toEqual(["Свои зоны", "false"])
      expect(hint()).toBe("районы и участки с названием, нарисованные на карте вручную")
      expect([card(), byTestId("live-map-zone-list")]).toEqual([null, null])
      // Not the clients' own check-in circles: that layer is another switch with another name.
      expect(byTestId("live-map-layer-zones")?.getAttribute("aria-label")).toBe("Зоны клиентов")
    })

    it("switched on, reads the zones once, draws them where they were drawn and lists each with what it covers", async () => {
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: true } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      expect(zoneReads).toBe(1)
      // By name, in the viewer's own alphabet — not in the order the server keeps them.
      expect(zonesOnMap().map((zone) => zone.name)).toEqual(["Северный участок", "Центр"])
      const [block, circle] = zonesOnMap()
      // The stored ring is [longitude, latitude]: its first corner is at latitude 40.4, longitude 49.8.
      expect(block).toMatchObject({ id: "zone-north", kind: "POLYGON", color: null })
      expect(block.outline).toEqual([
        { latitude: 40.4, longitude: 49.8 }, { latitude: 40.4, longitude: 49.81 }, { latitude: 40.41, longitude: 49.81 }, { latitude: 40.41, longitude: 49.8 },
      ])
      expect(circle).toMatchObject({ id: "zone-centre", kind: "CIRCLE", color: "teal", center: { latitude: 40.4, longitude: 49.85 }, radiusMeters: 1500 })
      expect(mapProp("canEditZones")).toBe(true)
      expect(hint()).toBe("на карте зон: 2")
      // In «Слои» the layer is its switch and that one line: no zone is listed in the panel, which has only the map's height to give.
      const panel = document.getElementById("live-map-layers-panel")!
      expect(byTestId("live-map-layer-areas")?.closest("li")?.textContent).toBe("Свои зонына карте зон: 2")
      expect([panel.textContent?.includes("Северный участок"), panel.textContent?.includes("Центр")]).toEqual([false, false])
      expect(panel.querySelector('[data-testid^="live-map-zone-"]')).toBeNull()
      // The zones are listed on the page, in a card of their own: folded, it says how many there are.
      expect(cardTitle()).toBe("Свои зоны · 2")
      expect([fold()?.textContent, fold()?.getAttribute("aria-expanded"), zoneRows().length]).toEqual(["Показать список", "false", 0])
      expect(byTestId("mtm-map-frame")!.contains(card())).toBe(false)
      await unfoldCard()
      expect([fold()?.textContent, fold()?.getAttribute("aria-expanded")]).toEqual(["Свернуть список", "true"])
      // The list: the name and how much the zone covers.
      const rows = zoneRows()
        .map((row) => [row.querySelector('[data-testid="live-map-zone-row-name"]')?.textContent, row.querySelector('[data-testid="live-map-zone-row-area"]')?.textContent])
      expect(rows).toEqual([["Северный участок", "94,2 га"], ["Центр", "7,07 км²"]])
      expect(zoneRows().every((row) => card()!.contains(row))).toBe(true)
      // The employees on the map are who they were, and the clients' layer was not touched.
      expect(onMap().sort()).toEqual(["far", "mid", "near"])
      expect(requests.some((request) => request.startsWith("/api/v1/mtm/locations/clients"))).toBe(false)
      // Remembered in this browser like the other looks of the map.
      expect(look()).toMatchObject({ areas: true, areasList: true })
      // Off: the map is given none, and the card goes with the layer. On again: the zones that were read are still the zones.
      await press(byTestId("live-map-layer-areas"))
      expect(zonesOnMap()).toEqual([])
      expect([card(), byTestId("live-map-zone-list")]).toEqual([null, null])
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      expect(zonesOnMap()).toHaveLength(2)
      expect(zoneReads).toBe(1)
      // The card is back as it was left: unfolded.
      expect([cardTitle(), zoneRows().length]).toEqual(["Свои зоны · 2", 2])
    })

    it("the card is not drawn before the zones have been read: a list that is still on its way is not «no zones»", async () => {
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: true } }
      // Held until this case lets it go, however long the runner takes over the lines between.
      const read = gate()
      zoneReadGate = read.held
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      // The layer is on and the read is out.
      expect([byTestId("live-map-layer-areas")?.getAttribute("aria-checked"), hint(), zoneReads]).toEqual(["true", "загружаю зоны…", 1])
      expect([card(), byTestId("live-map-zone-empty")]).toEqual([null, null])
      read.release()
      await settle(20)
      expect([hint(), cardTitle()]).toEqual(["на карте зон: 2", "Свои зоны · 2"])
    })

    it("the card waits for the employees too: while the map itself is still loading there is no «На карте» to press", async () => {
      // A return visit: the layer and its list were left on. The zones answer first, the employees have not yet.
      window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ areas: true, areasList: true }))
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: true } }
      const employees = gate()
      rosterGate = employees.held
      await open()
      await settle(20)
      // The zones have been read and answered; the map is not drawn yet — only the words that it is loading.
      expect(zoneReads).toBe(1)
      expect(byTestId("mtm-map-frame")?.textContent).toBe("Загрузка карты...")
      expect(byTestId("map-stand-in")).toBeNull()
      // A press made now would be lost: the map that is drawn afterwards starts from the turn it was drawn with.
      expect([card(), document.querySelectorAll('[data-testid^="live-map-zone-show-"]').length]).toEqual([null, 0])
      employees.release()
      await settle(20)
      expect(byTestId("map-stand-in")).not.toBeNull()
      expect([cardTitle(), zoneRows().length, document.querySelectorAll('[data-testid^="live-map-zone-show-"]').length]).toEqual(["Свои зоны · 2", 2, 2])
      expect(zoneReads).toBe(1)
    })

    it("stands in the employees' column, above their list — put away with it, wide with it, and under the map on a phone", async () => {
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: true } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      await openLayers()
      const canvas = byTestId("mtm-map-canvas")!
      const side = byTestId("mtm-map-side")!
      const roster = byTestId("live-map-roster")!
      // The canvas has two places: the map, and the column — the card and the list are in the column, the card first.
      expect([...canvas.children]).toEqual([byTestId("mtm-map-frame"), side])
      expect([...side.children]).toEqual([card(), roster])
      // …and drawn in that order, top to bottom: a column that is not turned over, and a card that is not sent after the list.
      expect(side.className.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-col"]))
      expect(card()!.className).not.toMatch(/(^|\s)(\S+:)?order-/)
      // Under the map where the canvas is one column (a phone): after the map, before the list.
      expect(byTestId("mtm-map-frame")!.className).toContain("order-1")
      expect(side.className).toContain("order-2")
      // The column is the width the list was given, so the card cannot be wider than the list nor push it.
      expect(side.className).toContain("min-w-0")
      expect(side.className).not.toContain("lg:hidden")

      // The list as the wide table: the column is the wide one, and the card is still in it.
      await press(byTestId("live-map-roster-width"))
      expect(canvas.getAttribute("data-roster")).toBe("wide")
      expect([...byTestId("mtm-map-side")!.children]).toEqual([card(), byTestId("live-map-roster")])

      // The list put away on a wide screen: the whole column goes, the card with it — the map has the width.
      await press(byTestId("live-map-roster-view"))
      await press(byTestId("live-map-roster-hide"))
      await closeMenu()
      expect(canvas.getAttribute("data-roster")).toBe("hidden")
      expect(byTestId("mtm-map-side")!.className.split(" ")).toContain("lg:hidden")
      expect(byTestId("mtm-map-side")!.contains(card())).toBe(true)
      // The zones stay on the map all the while: putting the list away is not switching the layer off.
      expect(zonesOnMap()).toHaveLength(2)
      await press(byTestId("live-map-roster-show"))
      expect(byTestId("mtm-map-side")!.className).not.toContain("lg:hidden")
      expect(cardTitle()).toBe("Свои зоны · 2")
    })

    it("remembers in this browser whether the list of zones is unfolded — and works the same when the browser keeps nothing", async () => {
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: true } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      expect([look().areasList, zoneRows().length]).toEqual([false, 0])
      await unfoldCard()
      expect([look().areasList, zoneRows().length]).toEqual([true, 2])

      // The page is opened again in this browser: the layer is on and its list is unfolded, as they were left.
      await act(async () => { root.unmount() })
      root = createRoot(container)
      await open()
      expect([cardTitle(), fold()?.getAttribute("aria-expanded"), zoneRows().length]).toEqual(["Свои зоны · 2", "true", 2])
      // Folded and opened once more: folded.
      await press(fold())
      expect([look().areasList, zoneRows().length]).toEqual([false, 0])
      await act(async () => { root.unmount() })
      root = createRoot(container)
      await open()
      expect([cardTitle(), fold()?.getAttribute("aria-expanded"), zoneRows().length]).toEqual(["Свои зоны · 2", "false", 0])

      // A browser that keeps nothing for the page (private mode, storage closed): reading and writing both throw.
      await act(async () => { root.unmount() })
      root = createRoot(container)
      const closed = () => { throw new DOMException("The operation is insecure.", "SecurityError") }
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(closed)
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(closed)
      try {
        expect(() => window.localStorage.getItem("leaddrive.mtm.live-map.look.v1")).toThrow()
        await open()
        // Nothing remembered: the layer is off, as on a first visit — and the page is all there.
        expect([card(), rowIds().length]).toEqual([null, 4])
        await openLayers()
        await press(byTestId("live-map-layer-areas"))
        await settle(20)
        expect([cardTitle(), zoneRows().length]).toEqual(["Свои зоны · 2", 0])
        // Not remembered; still applied.
        await unfoldCard()
        expect([fold()?.textContent, zoneRows().length]).toEqual(["Свернуть список", 2])
        await press(fold())
        expect([fold()?.textContent, zoneRows().length]).toEqual(["Показать список", 0])
      } finally {
        vi.restoreAllMocks()
      }
    })

    it("«На карте» on a zone's row asks the map for that zone — again for the same zone when pressed again — and is a reader's too", async () => {
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: false } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      await unfoldCard()
      const asked = () => mapProp<{ zoneId: string; turn: number } | null>("focusZone")
      // Nothing was asked for by merely opening the list.
      expect(asked()).toBeNull()
      expect(byTestId("live-map-zone-show-zone-centre")?.textContent).toBe("На карте")
      // «Слои» is still open — the layer has just been switched on in it — and lies over the middle of the map.
      const layersButton = () => container.querySelector('[data-testid="live-map-layers"] > button')
      const layersOpen = () => [document.getElementById("live-map-layers-panel") != null, layersButton()?.getAttribute("aria-expanded")]
      expect(layersOpen()).toEqual([true, "true"])
      await press(byTestId("live-map-zone-show-zone-centre"))
      expect(asked()).toEqual({ zoneId: "zone-centre", turn: 1 })
      // The zone is shown in the middle of the map, so the panel gets out of the way.
      expect(layersOpen()).toEqual([false, "false"])
      // It opens again when asked — the layer is as it was left — and the next «На карте» closes it again.
      await openLayers()
      expect(layersOpen()).toEqual([true, "true"])
      expect(byTestId("live-map-layer-areas")?.getAttribute("aria-checked")).toBe("true")
      // The same zone a second time is a new turn: the map was dragged away meanwhile, and goes back.
      await press(byTestId("live-map-zone-show-zone-centre"))
      expect(asked()).toEqual({ zoneId: "zone-centre", turn: 2 })
      expect(layersOpen()).toEqual([false, "false"])
      await press(byTestId("live-map-zone-show-zone-north"))
      expect(asked()).toEqual({ zoneId: "zone-north", turn: 3 })
      expect(layersOpen()).toEqual([false, "false"])
      // The zone asked for is one the map was given; where the real map then goes is asked of Leaflet in mtm-live-map-zone-focus.test.ts.
      expect(zonesOnMap().map((zone) => zone.id)).toContain("zone-north")
      // Looking is not changing: nothing was sent, and no form opened.
      expect([zoneWrites.length, byTestId("live-map-zone-form")]).toEqual([0, null])
    })

    it("«На карте» switches «Следить» off — the map would go back to the employee at his next position — and lets go of nothing else", async () => {
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: true } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      await unfoldCard()
      await press(byTestId("live-map-agent-card-near"))
      const follow = () => byTestId("live-map-follow")
      const selection = () => [mapProp("focusAgentId"), byTestId("live-map-agent-detail") != null, onMap().sort().join()]
      expect([follow()?.textContent, follow()?.getAttribute("aria-pressed"), mapProp("followAgent")]).toEqual(["Следить", "false", false])
      expect(selection()).toEqual(["near", true, "far,mid,near"])

      // Nobody is followed: the zone is asked for, and the employee stays chosen with his day open, as he was.
      await press(byTestId("live-map-zone-show-zone-centre"))
      expect(mapProp("focusZone")).toEqual({ zoneId: "zone-centre", turn: 1 })
      expect([follow()?.getAttribute("aria-pressed"), mapProp("followAgent")]).toEqual(["false", false])
      expect(selection()).toEqual(["near", true, "far,mid,near"])

      // «Следить» on: the map keeps to him at every new position.
      await press(follow())
      expect([follow()?.getAttribute("aria-pressed"), mapProp("followAgent")]).toEqual(["true", true])
      // A zone asked for in words: the button shows it is off, and the map is told so — he is still the one chosen.
      await press(byTestId("live-map-zone-show-zone-north"))
      expect(mapProp("focusZone")).toEqual({ zoneId: "zone-north", turn: 2 })
      expect([follow()?.getAttribute("aria-pressed"), mapProp("followAgent")]).toEqual(["false", false])
      expect(selection()).toEqual(["near", true, "far,mid,near"])
      // Switched on again by the person, it is on again.
      await press(follow())
      expect([follow()?.getAttribute("aria-pressed"), mapProp("followAgent")]).toEqual(["true", true])
    })

    it("«На карте» brings the map back into view where the list stands under it, and leaves the page alone where the map is beside the list", async () => {
      zoneBase = { zones: [CENTRE_CIRCLE], access: { canWrite: true } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      await unfoldCard()
      const frame = byTestId("mtm-map-frame")!
      const scrolled: unknown[] = []
      frame.scrollIntoView = (how?: boolean | ScrollIntoViewOptions) => { scrolled.push(how) }
      const place = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 360, width: 360, x: 0, y: top, toJSON: () => ({}) })
      vi.stubGlobal("innerHeight", 800)
      // Beside the list (a wide screen): the map is on the screen, cut a little at the bottom.
      frame.getBoundingClientRect = () => place(260, 700)
      await press(byTestId("live-map-zone-show-zone-centre"))
      expect(scrolled).toEqual([])
      // A phone, scrolled down to the card: the map is a screen above, out of sight.
      frame.getBoundingClientRect = () => place(-520, 430)
      await press(byTestId("live-map-zone-show-zone-centre"))
      expect(scrolled).toEqual([{ block: "nearest" }])
      // Only a strip of it is left at the top of the screen.
      frame.getBoundingClientRect = () => place(-330, 430)
      await press(byTestId("live-map-zone-show-zone-centre"))
      expect(scrolled).toHaveLength(2)
      // A phone scrolled a few rows down the card: more than half of the map is still on the screen, but its upper
      // 200 px are not — and the zone is shown in the middle of the whole map, 28 px from the screen's top edge.
      vi.stubGlobal("innerHeight", 844)
      frame.getBoundingClientRect = () => place(-200, 456)
      await press(byTestId("live-map-zone-show-zone-centre"))
      expect(scrolled).toHaveLength(3)
      // Standing at the top edge with its lower part below the screen — but more than half in view — it is left alone:
      // that is the wide screen, where the map keeps its place beside the list.
      frame.getBoundingClientRect = () => place(0, 1500)
      await press(byTestId("live-map-zone-show-zone-centre"))
      expect(scrolled).toHaveLength(3)
      expect(mapProp<{ turn: number }>("focusZone").turn).toBe(5)

      // In the app the page scrolls inside <main>, under a header of 56 px: «above the top edge» is above <main>'s.
      const main = document.createElement("main")
      document.body.appendChild(main)
      main.appendChild(container)
      try {
        main.getBoundingClientRect = () => place(56, 788)
        // 26 px of the map are under the header.
        frame.getBoundingClientRect = () => place(30, 456)
        await press(byTestId("live-map-zone-show-zone-centre"))
        expect(scrolled).toHaveLength(4)
        // Right under the header, all of it in view: nothing to bring back.
        frame.getBoundingClientRect = () => place(56, 456)
        await press(byTestId("live-map-zone-show-zone-centre"))
        expect(scrolled).toHaveLength(4)
        // Beside the list the map keeps its place 12 px under the header, cut at the bottom by a strip: the page stays where it is.
        frame.getBoundingClientRect = () => place(68, 790)
        await press(byTestId("live-map-zone-show-zone-centre"))
        expect(scrolled).toHaveLength(4)
      } finally {
        document.body.appendChild(container)
        main.remove()
      }
      expect(scrolled).toEqual([{ block: "nearest" }, { block: "nearest" }, { block: "nearest" }, { block: "nearest" }])
    })

    it("a layer that is on and could not be read says so on the map itself, with «Повторить» — beside any other layer's own trouble", async () => {
      zoneBase = 500
      clientBase = 500
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await press(byTestId("live-map-layer-clients"))
      await settle(20)
      expect(hint()).toBe("не удалось загрузить зоны — нажмите «Обновить»")
      expect(zonesOnMap()).toEqual([])
      // No card either: «Свои зоны · 0» would say there are none, and nobody knows that.
      expect([card(), byTestId("live-map-zone-list")]).toEqual([null, null])
      // With «Слои» closed the map would look exactly like «no zones here».
      await openLayers()
      expect(byTestId("live-map-areas-alert")?.textContent).toBe("Свои зоны не загрузилисьПовторить")
      expect(byTestId("live-map-layers-alert")?.textContent).toContain("Клиенты не загрузились")
      zoneBase = { zones: [CENTRE_CIRCLE], access: { canWrite: true } }
      await press(byTestId("live-map-areas-alert-action"))
      await settle(20)
      expect(zoneReads).toBe(2)
      expect(zonesOnMap().map((zone) => zone.id)).toEqual(["zone-centre"])
      expect(byTestId("live-map-areas-alert")).toBeNull()
      // The clients' own alert is still there: one layer coming back says nothing for another.
      expect(byTestId("live-map-layers-alert")).not.toBeNull()
    })

    it("a malformed answer draws nothing, and a row that cannot be drawn is left out and counted — never guessed at", async () => {
      zoneBase = { zones: "not a list", access: { canWrite: true } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      expect(zonesOnMap()).toEqual([])
      expect(hint()).toBe("не удалось загрузить зоны — нажмите «Обновить»")

      // A circle whose centre was written the other way round: a latitude of 120 is not on the globe.
      zoneBase = { zones: [CENTRE_CIRCLE, { ...CENTRE_CIRCLE, id: "zone-swapped", centerLatitude: 120, centerLongitude: 40.4 }], access: { canWrite: true } }
      await openLayers()
      await press(byTestId("live-map-areas-alert-action"))
      await settle(20)
      expect(zonesOnMap().map((zone) => zone.id)).toEqual(["zone-centre"])
      await openLayers()
      expect(hint()).toBe("на карте зон: 1 · не удалось показать: 1")
    })

    it("the ruler's outline can be kept: «Сохранить как зону» asks for a name and a colour and sends a closed ring of [longitude, latitude] pairs", async () => {
      await open()
      await press(byTestId("live-map-tool-ruler"))
      // Taking the ruler up asks, once, whether this viewer may draw zones; the layer itself stays off.
      expect(zoneReads).toBe(1)
      await pressMap(40.4, 49.8)
      await pressMap(40.409, 49.8)
      expect(byTestId("live-map-ruler-save-zone")).toBeNull()
      await pressMap(40.409, 49.8118)
      expect(byTestId("live-map-ruler-save-zone")?.textContent).toBe("Сохранить как зону")
      // A line that crosses itself encloses no one area and is not a zone — and the ruler's line says so, the button is not merely gone.
      await pressMap(40.4, 49.806)
      await pressMap(40.412, 49.806)
      expect(byTestId("live-map-ruler-save-zone")).toBeNull()
      expect(byTestId("live-map-ruler-outline-problem")?.textContent).toBe("Сохранить как зону нельзя: линия пересекает сама себя.")
      await press(byTestId("live-map-ruler-undo"))
      await press(byTestId("live-map-ruler-undo"))
      expect(byTestId("live-map-ruler-outline-problem")).toBeNull()

      await press(byTestId("live-map-ruler-save-zone"))
      const form = byTestId("live-map-zone-form")!
      expect([form.getAttribute("data-task"), byTestId("live-map-zone-form-title")?.textContent]).toEqual(["outline", "Новая зона по контуру линейки"])
      expect(document.activeElement).toBe(byTestId("live-map-zone-name"))
      // Without a name nothing is sent.
      await press(byTestId("live-map-zone-save"))
      expect(notice()).toBe("Введите название зоны")
      expect(zoneWrites).toEqual([])
      await type("live-map-zone-name", "  Северный участок ")
      await press(byTestId("live-map-zone-color-teal"))
      expect(byTestId("live-map-zone-color-name")?.textContent).toBe("Бирюзовый")
      await press(byTestId("live-map-zone-save"))

      expect(zoneWrites).toEqual([{
        method: "POST", path: "/api/v1/mtm/locations/zones",
        body: {
          name: "Северный участок", color: "teal", kind: "POLYGON",
          // Pressed at latitude 40.4, longitude 49.8 — sent as [49.8, 40.4], and closed back to it.
          polygon: { type: "Polygon", coordinates: [[[49.8, 40.4], [49.8, 40.409], [49.8118, 40.409], [49.8, 40.4]]] },
        },
      }])
      // The server kept it: the zone is on the map at once, its layer is on, the ruler is put down.
      expect(zonesOnMap()).toEqual([{
        id: "zone-new-1", name: "Северный участок", color: "teal", kind: "POLYGON",
        outline: [{ latitude: 40.4, longitude: 49.8 }, { latitude: 40.409, longitude: 49.8 }, { latitude: 40.409, longitude: 49.8118 }],
      }])
      expect([mapProp("pressMode"), mapProp<unknown[]>("rulerPoints").length]).toEqual([null, 0])
      expect(byTestId("live-map-zone-form")).toBeNull()
      expect(JSON.parse(window.localStorage.getItem("leaddrive.mtm.live-map.look.v1") ?? "{}")).toMatchObject({ areas: true })
      // What the server answered was drawn: the list was not read a second time for it.
      expect(zoneReads).toBe(1)
      await openLayers()
      expect([byTestId("live-map-layer-areas")?.getAttribute("aria-checked"), hint()]).toEqual(["true", "на карте зон: 1"])
    })

    it("says in words why the server did not keep a zone, and draws nothing it refused", async () => {
      await open()
      await outlineTriangle()
      await press(byTestId("live-map-ruler-save-zone"))
      await type("live-map-zone-name", "Центр")
      zoneRefusal = { status: 409, code: "MTM_MAP_ZONE_LIMIT_REACHED" }
      await press(byTestId("live-map-zone-save"))
      expect(notice()).toBe("В организации уже 500 зон — больше сохранить нельзя. Удалите ненужную.")
      // Nothing changed on the map: no zone, the layer still off, the outline still in hand.
      expect(zonesOnMap()).toEqual([])
      expect(JSON.parse(window.localStorage.getItem("leaddrive.mtm.live-map.look.v1") ?? "{}").areas ?? false).toBe(false)
      expect([mapProp("pressMode"), mapProp<unknown[]>("rulerPoints").length]).toEqual(["ruler", 3])
      // A supervisor's session, a minute of too many changes, a server that fell over: each in its own words.
      for (const [refusal, words] of [
        [{ status: 403, code: "MTM_MAP_ZONE_READ_ONLY" }, "У вас нет права менять зоны"],
        [{ status: 429, code: "MTM_MAP_ZONE_RATE_LIMITED" }, "Слишком много изменений подряд. Подождите минуту."],
        [{ status: 400 }, "Сервер не принял зону: проверьте название и очертания."],
        [{ status: 500, code: "MTM_MAP_ZONE_FAILED" }, "Не получилось. Попробуйте ещё раз."],
        // «Not found» about a zone that was never there is not «somebody removed it».
        [{ status: 404 }, "Не получилось. Попробуйте ещё раз."],
        [{ status: 401 }, "Вход устарел. Обновите страницу и войдите снова."],
      ] as const) {
        zoneRefusal = refusal
        await press(byTestId("live-map-zone-save"))
        expect(notice()).toBe(words)
        expect(zonesOnMap()).toEqual([])
      }
      // The same form, once the server takes it.
      zoneRefusal = null
      await press(byTestId("live-map-zone-save"))
      expect(zonesOnMap().map((zone) => zone.name)).toEqual(["Центр"])
      expect(byTestId("live-map-zone-form")).toBeNull()
    })

    it("a zone whose answer was lost on the way back is not kept twice when «Сохранить» is pressed again", async () => {
      await open()
      await outlineTriangle()
      await press(byTestId("live-map-ruler-save-zone"))
      await type("live-map-zone-name", "Центр")
      // The server keeps the zone — and the connection drops before its answer arrives.
      zoneAnswersLost = 1
      await press(byTestId("live-map-zone-save"))
      expect(notice()).toBe("Нет связи с сервером. Попробуйте ещё раз.")
      expect((zoneBase as { zones: unknown[] }).zones).toHaveLength(1)
      // The page was told nothing, so it draws nothing: the form is still open with the name in it.
      expect(zonesOnMap()).toEqual([])
      expect((byTestId("live-map-zone-name") as HTMLInputElement).value).toBe("Центр")
      // Exactly what the words ask for.
      await press(byTestId("live-map-zone-save"))
      expect(zoneWrites.map((write) => write.method)).toEqual(["POST", "POST"])
      expect(zoneWrites[1].body).toEqual(zoneWrites[0].body)
      // One zone on the server and one on the map — the one the first press made.
      expect((zoneBase as { zones: unknown[] }).zones).toHaveLength(1)
      expect(zonesOnMap().map((zone) => [zone.id, zone.name])).toEqual([["zone-new-1", "Центр"]])
      expect(byTestId("live-map-zone-form")).toBeNull()
      // «Обновить» would show a twin if there were one: the list read again is still one zone.
      await openLayers()
      expect(hint()).toBe("на карте зон: 1")
    })

    it("a press on the map while a zone is being named takes neither the form nor the name away: the form says why it cannot be saved now, and waits", async () => {
      await open()
      await outlineTriangle()
      await press(byTestId("live-map-ruler-save-zone"))
      await type("live-map-zone-name", "Центр")
      await press(byTestId("live-map-zone-color-teal"))
      const typed = () => [(byTestId("live-map-zone-name") as HTMLInputElement | null)?.value, byTestId("live-map-zone-color-teal")?.getAttribute("aria-pressed")]
      const blocked = () => byTestId("live-map-zone-blocked")?.querySelector("span")?.textContent ?? null
      const save = () => byTestId("live-map-zone-save") as HTMLButtonElement
      // The ruler is still on: the map goes on giving its presses to it.
      expect(mapProp("pressMode")).toBe("ruler")

      // A press west of the triangle, level with its middle: the new stretch of line goes through the triangle's side.
      await pressMap(40.4045, 49.79)
      expect(mapProp<unknown[]>("rulerPoints")).toHaveLength(4)
      expect(byTestId("live-map-zone-form")?.getAttribute("data-task")).toBe("outline")
      expect(typed()).toEqual(["Центр", "true"])
      expect(blocked()).toBe("Сохранить как зону нельзя: линия пересекает сама себя.")
      expect(save().disabled).toBe(true)
      await press(save())
      expect(zoneWrites).toEqual([])

      // «Убрать последнюю», offered beside the reason: the outline is a triangle again and the form is as it was.
      await press(byTestId("live-map-zone-blocked-action"))
      expect(mapProp<unknown[]>("rulerPoints")).toHaveLength(3)
      expect([blocked(), save().disabled]).toEqual([null, false])
      expect(typed()).toEqual(["Центр", "true"])

      // Taken back to two points from the ruler's own line: nothing is enclosed, and the form still does not go.
      await press(byTestId("live-map-ruler-undo"))
      expect(mapProp<unknown[]>("rulerPoints")).toHaveLength(2)
      expect(blocked()).toBe("Сохранить пока нельзя: нужны хотя бы три точки. Нажмите на карту, чтобы поставить ещё.")
      expect([save().disabled, byTestId("live-map-zone-blocked-action")]).toEqual([true, null])
      expect(typed()).toEqual(["Центр", "true"])

      // The third point put again, elsewhere: saved under the name typed at the start.
      await pressMap(40.409, 49.81)
      expect([blocked(), save().disabled]).toEqual([null, false])
      await press(save())
      expect(zoneWrites).toEqual([{
        method: "POST", path: "/api/v1/mtm/locations/zones",
        body: { name: "Центр", color: "teal", kind: "POLYGON", polygon: { type: "Polygon", coordinates: [[[49.8, 40.4], [49.8, 40.409], [49.81, 40.409], [49.8, 40.4]]] } },
      }])
      expect(zonesOnMap().map((zone) => zone.name)).toEqual(["Центр"])
      expect(byTestId("live-map-zone-form")).toBeNull()
    })

    it("three presses along one line are a line, not a zone: no «Сохранить как зону», and the ruler says why", async () => {
      await open()
      await press(byTestId("live-map-tool-ruler"))
      // One row of the screen is one latitude, to the last digit.
      await pressMap(40.4, 49.8)
      await pressMap(40.4, 49.81)
      expect(byTestId("live-map-ruler-outline-problem")).toBeNull()
      await pressMap(40.4, 49.82)
      expect(byTestId("live-map-ruler-save-zone")).toBeNull()
      expect(byTestId("live-map-ruler-outline-problem")?.textContent).toBe("Сохранить как зону нельзя: точки стоят на одной линии, внутри нет площади.")
      // There and back along the same line is no more of a zone.
      await pressMap(40.4, 49.81)
      expect(byTestId("live-map-ruler-save-zone")).toBeNull()
      expect(byTestId("live-map-ruler-outline-problem")).not.toBeNull()
      await press(byTestId("live-map-ruler-undo"))
      // A point off the line, and there is something inside.
      await pressMap(40.409, 49.81)
      expect(byTestId("live-map-ruler-outline-problem")).toBeNull()
      expect(byTestId("live-map-ruler-save-zone")?.textContent).toBe("Сохранить как зону")
      expect(zoneWrites).toEqual([])
    })

    it("a picked point can be the centre of a zone: «Зона вокруг точки» asks for a name, a radius in metres and a colour", async () => {
      await open()
      await press(byTestId("live-map-tool-point"))
      await press(byTestId("live-map-pick-point"))
      await pressMap(CENTRE.latitude, CENTRE.longitude)
      expect(zoneReads).toBe(1)
      expect(byTestId("live-map-point-zone")?.textContent).toBe("Зона вокруг точки")
      // The chip that names the point is what it was.
      expect(byTestId("live-map-point-chip")?.textContent).toBe("Ближайшие к: Точка на картеУбрать")
      await press(byTestId("live-map-point-zone"))
      expect([byTestId("live-map-zone-form")?.getAttribute("data-task"), byTestId("live-map-zone-form-title")?.textContent]).toEqual(["circle", "Новая зона вокруг точки"])
      // A sensible radius is already there, and the range allowed is said in words.
      expect((byTestId("live-map-zone-radius") as HTMLInputElement).value).toBe("500")
      expect(byTestId("live-map-zone-radius-range")?.textContent?.replace(/\s/g, " ")).toBe("от 25 до 100 000 метров")
      await type("live-map-zone-name", "Центр")
      // Ten metres is under what the server keeps: said here, and nothing is sent or quietly made into 25.
      await type("live-map-zone-radius", "10")
      await press(byTestId("live-map-zone-save"))
      expect(notice()?.replace(/\s/g, " ")).toBe("Радиус — целое число от 25 до 100 000 метров")
      expect(zoneWrites).toEqual([])
      await type("live-map-zone-radius", "750")
      await press(byTestId("live-map-zone-save"))
      expect(zoneWrites).toEqual([{
        method: "POST", path: "/api/v1/mtm/locations/zones",
        body: { name: "Центр", color: null, kind: "CIRCLE", centerLatitude: CENTRE.latitude, centerLongitude: CENTRE.longitude, radiusMeters: 750 },
      }])
      expect(zonesOnMap()).toEqual([{ id: "zone-new-1", name: "Центр", color: null, kind: "CIRCLE", center: { ...CENTRE }, radiusMeters: 750 }])
      // The point is still the point: the list goes on answering «who is nearest to it».
      expect(mapProp<{ label: string }>("referencePoint")).toMatchObject({ ...CENTRE })
      expect(rowIds()[0]).toBe("near")
    })

    it("offers no way to draw or change a zone to somebody the server says may only look", async () => {
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: false } }
      await open()
      await outlineTriangle()
      expect(byTestId("live-map-ruler-area")).not.toBeNull()
      expect(byTestId("live-map-ruler-save-zone")).toBeNull()
      await press(byTestId("live-map-tool-point"))
      await press(byTestId("live-map-pick-point"))
      await pressMap(CENTRE.latitude, CENTRE.longitude)
      expect(byTestId("live-map-point-chip")).not.toBeNull()
      expect(byTestId("live-map-point-zone")).toBeNull()
      // He sees every zone: on the map and in the list — without the three buttons, and told who has them.
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      expect(zonesOnMap()).toHaveLength(2)
      expect(mapProp("canEditZones")).toBe(false)
      await unfoldCard()
      expect(document.querySelectorAll('[data-testid^="live-map-zone-row-zone-"]')).toHaveLength(2)
      expect(document.querySelector('[data-testid^="live-map-zone-rename-"], [data-testid^="live-map-zone-recolor-"], [data-testid^="live-map-zone-remove-"]')).toBeNull()
      // All the card offers him: to fold the list, and to find each zone on the map.
      expect([...card()!.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Свернуть список", "На карте", "На карте"])
      expect(byTestId("live-map-zone-read-only")?.textContent).toBe("Рисовать и менять зоны могут администратор и менеджер.")
      // A press on a button in a balloon he was never shown opens nothing either.
      await act(async () => { mapProp<(zoneId: string, action: string) => void>("onZoneAction")("zone-centre", "delete") })
      expect(byTestId("live-map-zone-form")).toBeNull()
      expect(zoneWrites).toEqual([])
    })

    // While that read is still on its way: «no «save as a zone» button while the answer about who may draw is still on its way», below, on the clock.
    it("draws no «save as a zone» button when the read that says who may draw has failed", async () => {
      zoneBase = 500
      await open()
      await outlineTriangle()
      expect(zoneReads).toBe(1)
      expect(byTestId("live-map-ruler-area")).not.toBeNull()
      expect(byTestId("live-map-ruler-save-zone")).toBeNull()
      // The layer was never switched on, so nothing on the map complains about it.
      expect(byTestId("live-map-areas-alert")).toBeNull()
    })

    it("removing a zone asks first, in words, and only then takes it off the map", async () => {
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: true } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      await unfoldCard()
      await press(byTestId("live-map-zone-remove-zone-centre"))
      const row = byTestId("live-map-zone-row-zone-centre")!
      expect(row.querySelector('[data-testid="live-map-zone-form-title"]')?.textContent).toBe("Удалить зону «Центр»?")
      expect(row.textContent).toContain("Она исчезнет с карты у всех в организации.")
      // Asked, not done.
      expect(zoneWrites).toEqual([])
      expect(zonesOnMap()).toHaveLength(2)
      await press(row.querySelector('[data-testid="live-map-zone-cancel"]'))
      expect(byTestId("live-map-zone-form")).toBeNull()
      expect(zoneWrites).toEqual([])

      await press(byTestId("live-map-zone-remove-zone-centre"))
      expect(byTestId("live-map-zone-save")?.textContent).toBe("Удалить")
      await press(byTestId("live-map-zone-save"))
      expect(zoneWrites).toEqual([{ method: "DELETE", path: "/api/v1/mtm/locations/zones/zone-centre", body: null }])
      expect(zonesOnMap().map((zone) => zone.id)).toEqual(["zone-north"])
      expect(byTestId("live-map-zone-row-zone-centre")).toBeNull()
      expect([hint(), cardTitle()]).toEqual(["на карте зон: 1", "Свои зоны · 1"])
      expect(zoneReads).toBe(1)
    })

    it("renames and recolours a zone from its row in the list, and from its balloon on the map", async () => {
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: true } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      await unfoldCard()

      // «Цвет» in the list: the colour it has is the one chosen; another is sent as its key.
      await press(byTestId("live-map-zone-recolor-zone-centre"))
      const row = () => byTestId("live-map-zone-row-zone-centre")!
      expect(row().querySelector('[data-testid="live-map-zone-form-title"]')?.textContent).toBe("Цвет зоны «Центр»")
      expect(row().querySelector('[data-testid="live-map-zone-color-teal"]')?.getAttribute("aria-pressed")).toBe("true")
      await press(row().querySelector('[data-testid="live-map-zone-color-pink"]'))
      await press(row().querySelector('[data-testid="live-map-zone-save"]'))
      expect(zoneWrites).toEqual([{ method: "PUT", path: "/api/v1/mtm/locations/zones/zone-centre", body: { color: "pink" } }])
      expect(zonesOnMap().find((zone) => zone.id === "zone-centre")?.color).toBe("pink")
      // «Без цвета» is sent as no colour — not left out, which would keep the old one.
      await press(byTestId("live-map-zone-recolor-zone-centre"))
      await press(row().querySelector('[data-testid="live-map-zone-color-none"]'))
      await press(row().querySelector('[data-testid="live-map-zone-save"]'))
      expect(zoneWrites[1]).toEqual({ method: "PUT", path: "/api/v1/mtm/locations/zones/zone-centre", body: { color: null } })
      expect(zonesOnMap().find((zone) => zone.id === "zone-centre")?.color).toBeNull()

      // «Переименовать» in the zone's balloon: the map reports the button, the page opens the form beside the tools.
      await openLayers()
      await act(async () => { mapProp<(zoneId: string, action: string) => void>("onZoneAction")("zone-north", "rename") })
      await settle()
      const editor = byTestId("live-map-zone-editor")!
      expect(editor.querySelector('[data-testid="live-map-zone-form-title"]')?.textContent).toBe("Переименовать зону")
      expect((editor.querySelector('[data-testid="live-map-zone-name"]') as HTMLInputElement).value).toBe("Северный участок")
      await type("live-map-zone-name", "Аэропорт", editor)
      await press(editor.querySelector('[data-testid="live-map-zone-save"]'))
      expect(zoneWrites[2]).toEqual({ method: "PUT", path: "/api/v1/mtm/locations/zones/zone-north", body: { name: "Аэропорт" } })
      expect(byTestId("live-map-zone-editor")).toBeNull()
      // The list is by name: «Аэропорт» now stands before «Центр». The shape did not move.
      expect(zonesOnMap().map((zone) => zone.name)).toEqual(["Аэропорт", "Центр"])
      expect(zoneRows().map((item) => item.querySelector('[data-testid="live-map-zone-row-name"]')?.textContent)).toEqual(["Аэропорт", "Центр"])
      expect(zonesOnMap()[0].outline?.[0]).toEqual({ latitude: 40.4, longitude: 49.8 })
      expect(zoneReads).toBe(1)
    })

    it("a zone a colleague removed meanwhile goes from this map too instead of being renamed back to life — and why is said where its form stood: in the card for a row, on the map for a balloon", async () => {
      const SOUTH_CIRCLE = { ...CENTRE_CIRCLE, id: "zone-south", name: "Южный склад", color: null, centerLatitude: 40.35 }
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK, SOUTH_CIRCLE], access: { canWrite: true } }
      const removedByColleague = (id: string) => {
        const kept = (zoneBase as { zones: Array<{ id: string }> }).zones
        kept.splice(kept.findIndex((zone) => zone.id === id), 1)
      }
      const said = () => [...document.querySelectorAll<HTMLElement>('[data-testid="live-map-zone-gone"]')]
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      await unfoldCard()

      // Somebody else removes «Центр» on the server; here its row in the list is still being renamed.
      removedByColleague("zone-centre")
      await press(byTestId("live-map-zone-rename-zone-centre"))
      await type("live-map-zone-name", "Старый город")
      await press(byTestId("live-map-zone-save"))
      expect(zoneWrites).toEqual([{ method: "PUT", path: "/api/v1/mtm/locations/zones/zone-centre", body: { name: "Старый город" } }])
      expect(zonesOnMap().map((zone) => zone.id)).toEqual(["zone-north", "zone-south"])
      expect(byTestId("live-map-zone-form")).toBeNull()
      // The form closed and the zone vanished — which, with nothing said, reads as «renaming deleted my zone».
      // Said in the card where the row was, above the rows that are left — where whoever pressed is looking.
      expect(said()).toHaveLength(1)
      expect(said()[0].querySelector("span")?.textContent).toBe("Этой зоны уже нет: её удалил кто-то другой")
      expect(card()!.contains(said()[0])).toBe(true)
      expect(said()[0].compareDocumentPosition(byTestId("live-map-zone-list")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // Not on the map: nothing there asked for this change, and «Слои» says only how many zones are left.
      expect(byTestId("mtm-map-frame")!.contains(said()[0])).toBe(false)
      expect([hint(), cardTitle()]).toEqual(["на карте зон: 2", "Свои зоны · 2"])
      await press(byTestId("live-map-zone-gone-close"))
      expect(said()).toEqual([])

      // The same from a zone's balloon: its form stands beside the tools, and so do the words.
      removedByColleague("zone-north")
      await act(async () => { mapProp<(zoneId: string, action: string) => void>("onZoneAction")("zone-north", "color") })
      await settle()
      await press(byTestId("live-map-zone-editor")!.querySelector('[data-testid="live-map-zone-color-pink"]'))
      await press(byTestId("live-map-zone-editor")!.querySelector('[data-testid="live-map-zone-save"]'))
      expect(zonesOnMap().map((zone) => zone.id)).toEqual(["zone-south"])
      expect(byTestId("live-map-zone-form")).toBeNull()
      // Inside the frame that is all the browser draws when the map has the whole screen — a balloon can be
      // pressed there. (The page's toasts are outside it; here they are stood in for by nothing.)
      expect(said()).toHaveLength(1)
      expect(byTestId("live-map-zone-editor")!.contains(said()[0])).toBe(true)
      expect(byTestId("mtm-map-frame")!.contains(said()[0])).toBe(true)
      expect(card()!.contains(said()[0])).toBe(false)

      // Another zone's form takes its place. And a REMOVAL that came too late needs no saying: gone is what was asked for.
      removedByColleague("zone-south")
      await act(async () => { mapProp<(zoneId: string, action: string) => void>("onZoneAction")("zone-south", "delete") })
      await settle()
      expect(said()).toEqual([])
      expect(byTestId("live-map-zone-form-title")?.textContent).toBe("Удалить зону «Южный склад»?")
      await press(byTestId("live-map-zone-save"))
      expect(zoneWrites[2]).toEqual({ method: "DELETE", path: "/api/v1/mtm/locations/zones/zone-south", body: null })
      expect(zonesOnMap()).toEqual([])
      expect([byTestId("live-map-zone-form"), ...said()]).toEqual([null])
    })

    it("tells a manager with no zones yet how to draw the first one, in the words that are on the buttons", async () => {
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      const howTo = "Зон пока нет. Чтобы нарисовать первую: «Линейка» → «Сохранить как зону» или «Адрес или точка» → «Зона вокруг точки»."
      // In the card, and at once: with no zones there is no list to unfold, and nothing to press before being told.
      expect([cardTitle(), fold()]).toEqual(["Свои зоны · 0", null])
      expect(card()!.contains(byTestId("live-map-zone-empty"))).toBe(true)
      expect(byTestId("live-map-zone-empty")?.textContent).toBe(howTo)
      expect([byTestId("live-map-tool-ruler")?.textContent, byTestId("live-map-tool-point")?.textContent]).toEqual(["Линейка", "Адрес или точка"])
      // …and on the map itself, as the layer's own line in «Слои» — instead of «на карте зон: 0», which says nothing to do.
      expect(hint()).toBe(howTo)
      expect(byTestId("mtm-map-frame")!.contains(byTestId("live-map-layer-hint-areas"))).toBe(true)
    })

    it("with the employees' list put away and no zones yet, how to draw the first one is still said — inside the map's frame", async () => {
      await open()
      // The whole width to the map: the natural state for drawing. The column goes, and the zones' card with it.
      await press(byTestId("live-map-roster-view"))
      await press(byTestId("live-map-roster-hide"))
      await closeMenu()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      expect(byTestId("mtm-map-canvas")?.getAttribute("data-roster")).toBe("hidden")
      const side = byTestId("mtm-map-side")!
      expect(side.className.split(" ")).toContain("lg:hidden")
      // The card is drawn, but in the column that is not shown on a wide screen.
      expect([cardTitle(), side.contains(card())]).toEqual(["Свои зоны · 0", true])
      // What can be read on that screen is inside the map's frame — which is also all that the whole-screen map shows.
      const frame = byTestId("mtm-map-frame")!
      expect(frame.contains(side)).toBe(false)
      const line = byTestId("live-map-layer-hint-areas")!
      expect(frame.contains(line)).toBe(true)
      expect(line.textContent).toBe("Зон пока нет. Чтобы нарисовать первую: «Линейка» → «Сохранить как зону» или «Адрес или точка» → «Зона вокруг точки».")
      // The buttons it names are in the same frame, under the same words.
      expect([frame.contains(byTestId("live-map-tool-ruler")), byTestId("live-map-tool-ruler")?.textContent, byTestId("live-map-tool-point")?.textContent])
        .toEqual([true, "Линейка", "Адрес или точка"])

      // The first zone drawn: the line counts again.
      await outlineTriangle()
      await press(byTestId("live-map-ruler-save-zone"))
      await type("live-map-zone-name", "Первая")
      await press(byTestId("live-map-zone-save"))
      await settle(20)
      expect(zonesOnMap().map((zone) => zone.name)).toEqual(["Первая"])
      expect(hint()).toBe("на карте зон: 1")
    })

    it("a reader with no zones to see is told, on the map too, who may draw them — and never how", async () => {
      zoneBase = { zones: [], access: { canWrite: false } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      expect(hint()).toBe("Зон пока нет. Рисовать и менять зоны могут администратор и менеджер.")
      expect(byTestId("live-map-zone-empty")?.textContent).toBe("Зон пока нет. Рисовать и менять зоны могут администратор и менеджер.")
    })

    it("«Зон пока нет» is said only where nobody drew any: rows that are kept and could not be shown keep the count", async () => {
      // Two rows are kept and neither can be drawn: «no zones yet» would be untrue.
      const broken = { ...CENTRE_CIRCLE, centerLatitude: 120, centerLongitude: 40.4 }
      zoneBase = { zones: [{ ...broken, id: "zone-a" }, { ...broken, id: "zone-b" }], access: { canWrite: true } }
      await open()
      await openLayers()
      await press(byTestId("live-map-layer-areas"))
      await settle(20)
      expect(zonesOnMap()).toEqual([])
      expect(hint()).toBe("на карте зон: 0 · не удалось показать: 2")
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

    it("the zones are read when their layer is switched on and on «Обновить» — never on the map's timer", async () => {
      window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ labels: false, trails: true, glide: true, areas: true }))
      zoneBase = { zones: [CENTRE_CIRCLE], access: { canWrite: true } }
      await act(async () => { root.render(createElement(MtmMapPage)) })
      await forward(2_000)
      expect(zoneReads).toBe(1)
      expect(mapProp<unknown[]>("zones")).toHaveLength(1)
      const polls = requests.filter((request) => request === "/api/v1/mtm/locations").length
      await forward(95_000)
      expect(requests.filter((request) => request === "/api/v1/mtm/locations").length).toBeGreaterThanOrEqual(polls + 3)
      expect(zoneReads).toBe(1)
      // «Обновить» is how a zone a colleague has just drawn gets onto this map —
      // once the roster's own cooldown lets «Обновить» ask for anything at all.
      ;(zoneBase as { zones: unknown[] }).zones.push(NORTH_BLOCK)
      await act(async () => { byTestId("mtm-map-refresh")!.click() })
      await forward(1_000)
      expect(zoneReads).toBe(1)
      await forward(16_000)
      await act(async () => { byTestId("mtm-map-refresh")!.click() })
      await forward(2_000, 100)
      expect(zoneReads).toBe(2)
      expect(mapProp<unknown[]>("zones")).toHaveLength(2)
    })

    it("a refresh of the zones that fails takes nothing off the map, says so in «Слои», and is tried again by itself", async () => {
      window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ labels: false, trails: true, glide: true, areas: true, areasList: true }))
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: true } }
      await act(async () => { root.render(createElement(MtmMapPage)) })
      await forward(18_000)
      expect(mapProp<unknown[]>("zones")).toHaveLength(2)
      zoneBase = 500
      const shown = new Set<number>()
      const observer = new MutationObserver(() => shown.add(mapProp<unknown[]>("zones").length))
      observer.observe(container, { subtree: true, childList: true, characterData: true, attributes: true })
      await act(async () => { byTestId("mtm-map-refresh")!.click() })
      await forward(2_000, 100)
      observer.disconnect()
      expect(zoneReads).toBe(2)
      // Never taken off the map: not while the read was out, not when it failed.
      expect(mapProp<unknown[]>("zones")).toHaveLength(2)
      expect([...shown]).not.toContain(0)
      // The zones are on the map, so nothing shouts over it; the layer's own line says the refresh failed.
      expect(byTestId("live-map-areas-alert")).toBeNull()
      await act(async () => { container.querySelector<HTMLElement>('[data-testid="live-map-layers"] > button')!.click() })
      expect(byTestId("live-map-layer-hint-areas")?.textContent).toBe("на карте зон: 2 · не удалось обновить")
      // Who may change them was said by the last answer that did come: the list, in its card, keeps its rows and their buttons.
      expect(byTestId("live-map-zones-card-title")?.textContent).toBe("Свои зоны · 2")
      expect(byTestId("live-map-zone-rename-zone-centre")).not.toBeNull()
      // A minute later the page asks again by itself.
      zoneBase = { zones: [CENTRE_CIRCLE], access: { canWrite: true } }
      await forward(61_000)
      expect(zoneReads).toBe(3)
      expect(mapProp<unknown[]>("zones")).toHaveLength(1)
      expect(byTestId("live-map-layer-hint-areas")?.textContent).toBe("на карте зон: 1")
    })

    it("no zones yet and a refresh that failed: the layer's line goes back to the count and says the refresh failed", async () => {
      window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ areas: true }))
      zoneBase = { zones: [], access: { canWrite: true } }
      await act(async () => { root.render(createElement(MtmMapPage)) })
      await forward(18_000)
      await act(async () => { container.querySelector<HTMLElement>('[data-testid="live-map-layers"] > button')!.click() })
      const line = () => byTestId("live-map-layer-hint-areas")?.textContent
      expect(line()).toBe("Зон пока нет. Чтобы нарисовать первую: «Линейка» → «Сохранить как зону» или «Адрес или точка» → «Зона вокруг точки».")
      zoneBase = 500
      await act(async () => { byTestId("mtm-map-refresh")!.click() })
      await forward(2_000, 100)
      expect(zoneReads).toBe(2)
      // «Зон пока нет» is what an answer said, not what a failure says: the line is the count again, with the failure beside it.
      expect(line()).toBe("на карте зон: 0 · не удалось обновить")
      // The next read that does come back says it again.
      zoneBase = { zones: [], access: { canWrite: true } }
      await forward(61_000)
      expect(zoneReads).toBe(3)
      expect(line()).toBe("Зон пока нет. Чтобы нарисовать первую: «Линейка» → «Сохранить как зону» или «Адрес или точка» → «Зона вокруг точки».")
    })

    it.each([
      ["somebody who may draw gets it once the answer is in", true],
      ["somebody who may only look never gets it", false],
    ])("no «save as a zone» button while the answer about who may draw is still on its way: %s", async (_who, canWrite) => {
      // The layer is off: the zones are asked for only because a tool was taken up, and the answer takes three seconds.
      zoneBase = { zones: [], access: { canWrite } }
      zoneReadDelayMs = 3_000
      const pressMap = async (latitude: number, longitude: number) => {
        await act(async () => { mapProp<(lat: number, lng: number) => void>("onMapPress")(latitude, longitude) })
      }
      await act(async () => { root.render(createElement(MtmMapPage)) })
      await forward(1_000, 100)

      // The ruler, and a triangle outlined at once — well inside those three seconds.
      await act(async () => { byTestId("live-map-tool-ruler")!.click() })
      await pressMap(40.4, 49.8)
      await pressMap(40.409, 49.8)
      await pressMap(40.409, 49.8118)
      await forward(500, 100)
      expect(zoneReads).toBe(1)
      // The ruler is a ruler for everybody; what it may offer besides has not been said yet.
      expect(byTestId("live-map-ruler-area")).not.toBeNull()
      expect(byTestId("live-map-ruler-save-zone")).toBeNull()

      // A point picked while the same read is still out: no «Зона вокруг точки» either.
      await act(async () => { byTestId("live-map-tool-point")!.click() })
      await act(async () => { byTestId("live-map-pick-point")!.click() })
      await pressMap(CENTRE.latitude, CENTRE.longitude)
      await forward(300, 100)
      expect(byTestId("live-map-point-chip")).not.toBeNull()
      expect(byTestId("live-map-point-zone")).toBeNull()
      expect(zoneReads).toBe(1)

      // The answer arrives: the button is there for whoever it says may draw, and for nobody else.
      await forward(3_000, 100)
      expect(byTestId("live-map-point-zone") !== null).toBe(canWrite)
      await act(async () => { byTestId("live-map-tool-ruler")!.click() })
      await pressMap(40.4, 49.8)
      await pressMap(40.409, 49.8)
      await pressMap(40.409, 49.8118)
      await forward(300, 100)
      expect(byTestId("live-map-ruler-area")).not.toBeNull()
      expect(byTestId("live-map-ruler-save-zone") !== null).toBe(canWrite)
      // One read answered both tools.
      expect(zoneReads).toBe(1)
    })

    it("a refresh that was on its way while a zone was removed does not bring the zone back", async () => {
      window.localStorage.setItem("leaddrive.mtm.live-map.look.v1", JSON.stringify({ labels: false, trails: true, glide: true, areas: true, areasList: true }))
      zoneBase = { zones: [CENTRE_CIRCLE, NORTH_BLOCK], access: { canWrite: true } }
      await act(async () => { root.render(createElement(MtmMapPage)) })
      await forward(18_000)
      expect(zoneReads).toBe(1)
      const ids = () => mapProp<Array<{ id: string }>>("zones").map((zone) => zone.id)
      expect(ids()).toEqual(["zone-north", "zone-centre"])
      // «Обновить»: the read sets out, and takes three seconds to come back with the list as it was.
      zoneReadDelayMs = 3_000
      await act(async () => { byTestId("mtm-map-refresh")!.click() })
      await forward(300, 100)
      expect(zoneReads).toBe(2)
      // Meanwhile «Центр» is removed, and the server answers at once.
      zoneReadDelayMs = 0
      await act(async () => { byTestId("live-map-zone-remove-zone-centre")!.click() })
      await act(async () => { byTestId("live-map-zone-save")!.click() })
      await forward(300, 100)
      expect(zoneWrites).toEqual([{ method: "DELETE", path: "/api/v1/mtm/locations/zones/zone-centre", body: null }])
      expect(ids()).toEqual(["zone-north"])
      // The late answer still names «Центр». It is not what the map shows: the list was asked for again instead.
      const shown = new Set<string>()
      const observer = new MutationObserver(() => shown.add(ids().join(",")))
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
      await forward(5_000, 100)
      observer.disconnect()
      expect(ids()).toEqual(["zone-north"])
      expect([...shown].filter((list) => list.includes("zone-centre"))).toEqual([])
      expect(zoneReads).toBe(3)
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
