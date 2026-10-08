// @vitest-environment jsdom
/**
 * Live map → «Слои» and the eye on an employee's card.
 *
 * Owner, 2026-10-09: «надеюсь, по карте ты многие фичи учёл, например как
 * убирать на карте объекты, агентов… динамичная интерактивная карта». Until
 * then the markers and the route could not be taken off the map at all, one
 * employee could not be hidden, and the two switches that did exist sat in a
 * closed panel at the very bottom of the page.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru[namespace]
    for (const part of key.split(".")) node = (node as Messages | undefined)?.[part]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))

import { LiveMapLayersControl, type LiveMapLayer } from "@/components/mtm/live-map-layers-control"

describe("the layers control on the map", () => {
  let root: Root
  let container: HTMLDivElement
  let state: Record<string, boolean>
  let hidden: number
  const layers = (): LiveMapLayer[] => [
    { id: "agents", label: "Сотрудники", hint: "метки с последним положением", on: state.agents, onToggle: () => { state.agents = !state.agents }, shownByDefault: true },
    { id: "route", label: "Маршрут дня", on: state.route, onToggle: () => { state.route = !state.route }, shownByDefault: true },
    { id: "heat", label: "Тепловая карта", on: state.heat, onToggle: () => { state.heat = !state.heat }, testId: "mtm-map-heatmap-toggle" },
  ]
  const draw = async () => {
    await act(async () => {
      root.render(createElement(LiveMapLayersControl, {
        layers: layers(), hiddenAgentCount: hidden, onShowAllAgents: () => { hidden = 0 }, note: "Полный трек — в «Истории».",
      }))
    })
  }
  const opener = () => container.querySelector('[data-testid="live-map-layers"] > button') as HTMLButtonElement
  const panel = () => container.querySelector("#live-map-layers-panel") as HTMLElement | null
  const layerSwitch = (testId: string) => container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement
  const press = async (element: Element | null) => { await act(async () => { (element as HTMLElement).click() }); await draw() }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    state = { agents: true, route: true, heat: false }
    hidden = 0
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("stays out of the way until asked for", async () => {
    await draw()
    expect([opener().textContent, opener().getAttribute("aria-expanded")]).toEqual(["Слои", "false"])
    expect(panel()).toBeNull()
    await press(opener())
    expect(opener().getAttribute("aria-expanded")).toBe("true")
    expect(panel()?.textContent).toContain("Полный трек — в «Истории».")
  })

  it("shows every layer as a switch in its real state and flips the one that is pressed", async () => {
    await draw()
    await press(opener())
    expect(["live-map-layer-agents", "live-map-layer-route", "mtm-map-heatmap-toggle"].map((id) => layerSwitch(id).getAttribute("aria-checked")))
      .toEqual(["true", "true", "false"])
    await press(layerSwitch("live-map-layer-agents"))
    expect(state).toEqual({ agents: false, route: true, heat: false })
    expect(layerSwitch("live-map-layer-agents").getAttribute("aria-checked")).toBe("false")
    await press(layerSwitch("mtm-map-heatmap-toggle"))
    expect(state.heat).toBe(true)
  })

  it("says, while closed, that something has been taken off the map", async () => {
    // Nothing is «off» just because an extra layer was never turned on: the
    // mark is about what a person would otherwise look for and not find.
    await draw()
    expect(container.querySelector('[data-testid="live-map-layers-mark"]')).toBeNull()
    state.agents = false
    await draw()
    expect(container.querySelector('[data-testid="live-map-layers-mark"]')).not.toBeNull()
    state.agents = true
    hidden = 2
    await draw()
    expect(container.querySelector('[data-testid="live-map-layers-mark"]')).not.toBeNull()
  })

  it("counts the employees hidden one by one and brings them all back in one press", async () => {
    hidden = 3
    await draw()
    await press(opener())
    const line = container.querySelector('[data-testid="live-map-hidden-agents"]') as HTMLElement
    expect(line.textContent).toContain("Скрыто сотрудников: 3")
    await press(line.querySelector("button"))
    expect(hidden).toBe(0)
    expect(container.querySelector('[data-testid="live-map-hidden-agents"]')).toBeNull()
  })
})

describe("what the page takes off the map", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/map/page.tsx", "utf8")
  const map = readFileSync("src/components/mtm/live-map.tsx", "utf8")

  it("removes markers for the whole layer and for each employee hidden with the eye", () => {
    expect(page).toContain("if (!showAgentMarkers || hiddenAgentIds.has(agent.agentId)) return []")
    // The list keeps everybody: hiding is about the map, not the roster.
    expect(page).toMatch(/const filteredAgents = agents\.filter\(a => \{\s*if \(activeFilter === "all"\) return true/)
    expect(page).toContain("onClick={() => toggleAgentOnMap(agent.agentId)}")
    expect(page).toContain("aria-pressed={hiddenOnMap}")
  })

  it("lets go of the selection when the selected employee is the one hidden", () => {
    expect(page).toMatch(/const toggleAgentOnMap = \(agentId: string\) => \{[\s\S]{0,400}if \(hide && selectedAgentRef\.current === agentId\) handleAgentClick\(agentId\)/)
  })

  it("leaves only one employee on the map on request, and can bring everybody back", () => {
    expect(page).toMatch(/const showOnlyAgentOnMap = \(agentId: string\) => \{\s*setShowAgentMarkers\(true\)\s*setHiddenAgentIds\(new Set\(agents\.filter\(\(agent\) => agent\.agentId !== agentId\)/)
    expect(page).toContain("onShowAllAgents={() => setHiddenAgentIds(new Set())}")
  })

  it("takes the day route off the map without touching the steps in the list", () => {
    expect(page).toContain("plannedRoute={showDayRoute ? routeStops : NO_ROUTE_STOPS}")
    expect(page).toContain("steps={daySteps}")
  })

  it("draws client zones around the stops with the radius a check-in is really accepted in", () => {
    expect(page).toContain("zoneRadiusMeters: effectiveGeofenceRadius(customer.geofenceRadius, contract?.geofenceRadiusMeters)")
    const zones = map.slice(map.indexOf("{showGeofence &&"), map.indexOf("{/* Route stop markers */}"))
    expect(zones).toContain("plannedRoute.map((stop) => (")
    expect(zones).toContain("radius={stop.zoneRadiusMeters && stop.zoneRadiusMeters > 0 ? stop.zoneRadiusMeters : geofenceRadius}")
    // Not around the employee any more: that ring followed the person and said nothing about a client.
    expect(zones).not.toContain("a.latitude")
  })

  it("has the layer switches in one place: on the map, not in a panel under the page", () => {
    expect(page).toContain("<LiveMapLayersControl")
    expect(page).not.toContain("<details")
    for (const id of ["agents", "route", "zones", "heat"]) expect(page).toContain(`{ id: "${id}", label: tMap("layers.${id}")`)
  })
})
