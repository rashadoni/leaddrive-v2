// @vitest-environment jsdom
/**
 * Live map → «Слои» and the tick on an employee's card.
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

import { LiveMapLayersControl, type LiveMapLayer, type LiveMapLayersAlert } from "@/components/mtm/live-map-layers-control"

describe("the layers control on the map", () => {
  let root: Root
  let container: HTMLDivElement
  let state: Record<string, boolean>
  let hidden: number
  let baseMaps: { value: string; options: Array<{ id: string; label: string }>; onChange: (id: string) => void } | null
  /** What one more layer holds, listed under its switch; and what the layers have to say with the panel closed. */
  let areaNames: string[] | null
  let alert: LiveMapLayersAlert | Array<LiveMapLayersAlert | null> | null
  const layers = (): LiveMapLayer[] => [
    { id: "agents", label: "Сотрудники", hint: "значки с последним положением", on: state.agents, onToggle: () => { state.agents = !state.agents }, shownByDefault: true },
    { id: "route", label: "Маршрут дня", on: state.route, onToggle: () => { state.route = !state.route }, shownByDefault: true },
    { id: "heat", label: "Тепловая карта", on: state.heat, onToggle: () => { state.heat = !state.heat }, testId: "mtm-map-heatmap-toggle" },
    ...(areaNames ? [{
      id: "areas", label: "Свои зоны", hint: `на карте зон: ${areaNames.length}`, on: state.areas, onToggle: () => { state.areas = !state.areas },
      detail: state.areas ? createElement("ul", null, areaNames.map((name) => createElement("li", { key: name }, name))) : undefined,
    }] : []),
  ]
  const draw = async () => {
    await act(async () => {
      root.render(createElement(LiveMapLayersControl, {
        layers: layers(), hiddenAgentCount: hidden, onShowAllAgents: () => { hidden = 0 }, note: "Полный трек — в «Истории».",
        baseMaps, alert,
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
    baseMaps = null
    areaNames = null
    alert = null
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("stays inside the map's frame however many layers there are: the open panel scrolls, the button does not shrink", async () => {
    // Seven switches made the panel 493 px tall on a phone map of 360: the last two could not be reached.
    await draw()
    const control = container.querySelector('[data-testid="live-map-layers"]') as HTMLElement
    expect(control.className).toContain("bottom-3 right-3 top-3")
    expect(control.className).toContain("z-[1200]")
    expect(opener().className).toContain("shrink-0")
    await press(opener())
    expect(panel()?.className).toContain("min-h-0")
    expect(panel()?.className).toContain("overflow-y-auto")
  })

  it("on a wide map the switches stand in two columns, so the panel does not scroll inside itself", async () => {
    // Nine switches in one column were 680 px tall — more than the map of a laptop, which is what bounds the panel.
    // Measured in a real browser: in two columns they take 430–480 px on maps from 546 px wide (a 1280 px window).
    await draw()
    const control = container.querySelector('[data-testid="live-map-layers"]') as HTMLElement
    // The frame spans the map (left to right) only to learn its width; it still takes no presses itself.
    expect(control.className).toContain("@container")
    expect(control.className).toContain("left-3")
    expect(control.className).toContain("pointer-events-none")
    await press(opener())
    expect(panel()?.className).toContain("pointer-events-auto")
    // Narrow by default — a phone keeps one column — and wide only where the map says there is room.
    expect(panel()?.className).toContain("w-72")
    expect(panel()?.className).toContain("@2xl:w-[35rem]")
    expect(panel()?.className).toContain("@lg:w-[31rem]")
    expect(panel()?.className).toContain("max-w-full")
    const list = container.querySelector('[data-testid="live-map-layers-list"]') as HTMLElement
    expect(list.className).toContain("grid-cols-1")
    expect(list.className).toContain("@lg:grid-cols-2")
    // One line above every switch but those of the first row, in one column and in two.
    const rows = [...list.children] as HTMLElement[]
    expect(rows.length).toBeGreaterThan(2)
    for (const row of rows) {
      expect(row.className).toContain("border-t")
      expect(row.className).toContain("first:border-t-0")
    }
    expect(rows[1].className).toContain("@lg:[&:nth-child(2)]:border-t-0")
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

  it("offers the map's backgrounds as worded choices of which exactly one is on — and only when there is a choice", async () => {
    await draw()
    await press(opener())
    // A page that offers none: nothing is drawn about backgrounds.
    expect(container.querySelector('[data-testid="live-map-base-maps"]')).toBeNull()

    const chosen: string[] = []
    const offer = (value: string) => ({
      value,
      options: [{ id: "voyager", label: "Карта" }, { id: "light", label: "Светлая" }, { id: "satellite", label: "Спутник" }],
      onChange: (id: string) => { chosen.push(id); baseMaps = offer(id) },
    })
    baseMaps = offer("voyager")
    await draw()
    const choices = () => [...container.querySelectorAll('[data-testid="live-map-base-maps"] [role="radio"]')] as HTMLButtonElement[]
    expect(container.querySelector('[data-testid="live-map-base-maps"] [role="radiogroup"]')?.getAttribute("aria-labelledby")).toBe("live-map-base-maps-title")
    expect(container.querySelector("#live-map-base-maps-title")?.textContent).toBe("Вид карты")
    expect(choices().map((choice) => [choice.textContent, choice.getAttribute("aria-checked")])).toEqual([["Карта", "true"], ["Светлая", "false"], ["Спутник", "false"]])
    await press(container.querySelector('[data-testid="live-map-base-map-satellite"]'))
    expect(chosen).toEqual(["satellite"])
    expect(choices().map((choice) => choice.getAttribute("aria-checked"))).toEqual(["false", "false", "true"])
    // A background is not a layer taken off the map: the closed button shows no «something is hidden» mark for it.
    await press(opener())
    expect(container.querySelector('[data-testid="live-map-layers-mark"]')).toBeNull()

    // One background only (a build without the others): no choice to draw.
    baseMaps = { value: "voyager", options: [{ id: "voyager", label: "Карта" }], onChange: () => {} }
    await draw()
    await press(opener())
    expect(container.querySelector('[data-testid="live-map-base-maps"]')).toBeNull()
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

  it("lists what a layer holds under its own switch while it is on — inside the panel, with no frame or scrollbar of its own", async () => {
    areaNames = ["Северный участок", "Центр"]
    state.areas = false
    await draw()
    await press(opener())
    // Off: the switch and its line, nothing under them.
    expect(container.querySelector('[data-testid="live-map-layer-detail-areas"]')).toBeNull()
    await press(layerSwitch("live-map-layer-areas"))
    const detail = container.querySelector('[data-testid="live-map-layer-detail-areas"]') as HTMLElement
    expect([...detail.querySelectorAll("li")].map((row) => row.textContent)).toEqual(["Северный участок", "Центр"])
    // In the row of its own layer, after that layer's switch — and inside the one panel that scrolls.
    const row = layerSwitch("live-map-layer-areas").closest("li") as HTMLElement
    expect(row.contains(detail)).toBe(true)
    // In two columns the layer with a list takes the whole width: the list is not squeezed into half of it.
    expect(row.className).toContain("@lg:col-span-2")
    expect(panel()?.contains(detail)).toBe(true)
    expect(detail.className).not.toMatch(/overflow|max-h/)
    // The other layers have nothing listed under them.
    expect(container.querySelectorAll('[data-testid^="live-map-layer-detail-"]')).toHaveLength(1)
    // An extra layer nobody had switched on is not something «taken off the map».
    await press(layerSwitch("live-map-layer-areas"))
    await press(opener())
    expect(container.querySelector('[data-testid="live-map-layers-mark"]')).toBeNull()
  })

  it("says each layer's own trouble on the map while the panel is closed, each with its own way out", async () => {
    const retried: string[] = []
    // One alert, as the page gave it before there were two layers that are read from the server.
    alert = { text: "Клиенты не загрузились", actionLabel: "Повторить", onAction: () => { retried.push("clients") } }
    await draw()
    const said = () => [...container.querySelectorAll('[role="status"]')].map((line) => line.textContent)
    expect(said()).toEqual(["Клиенты не загрузилисьПовторить"])
    // Two layers in trouble are two lines; a layer with nothing to say adds none.
    alert = [
      { text: "Клиенты не загрузились", actionLabel: "Повторить", onAction: () => { retried.push("clients") } },
      null,
      { text: "Свои зоны не загрузились", actionLabel: "Повторить", onAction: () => { retried.push("areas") }, testId: "live-map-areas-alert" },
      { text: "показана только часть базы", actionLabel: null, onAction: null, testId: "live-map-part-alert" },
    ]
    await draw()
    expect(said()).toEqual(["Клиенты не загрузилисьПовторить", "Свои зоны не загрузилисьПовторить", "показана только часть базы"])
    await press(container.querySelector('[data-testid="live-map-areas-alert-action"]'))
    await press(container.querySelector('[data-testid="live-map-layers-alert-action"]'))
    expect(retried).toEqual(["areas", "clients"])
    expect(container.querySelector('[data-testid="live-map-part-alert-action"]')).toBeNull()
    // With the panel open the layers' own lines say it; the alerts step aside.
    await press(opener())
    expect(said()).toEqual([])
    alert = [null, null]
    await press(opener())
    expect(said()).toEqual([])
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
  // 2026-10-09 the cards became a table (owner: «список должен быть
  // компактным… фильтры прямо в списке, как в Excel»). The ticks moved with
  // the rows into the list's own component; how they behave when pressed is
  // exercised in mtm-live-map-roster.test.ts.
  const roster = readFileSync("src/components/mtm/live-map-roster.tsx", "utf8")

  it("removes markers for the whole layer and for each employee who is not ticked", () => {
    expect(page).toContain("if (!showAgentMarkers || hiddenAgentIds.has(agent.agentId)) return []")
    // The list keeps everybody: hiding is about the map, not the roster — the
    // rows are decided by the filters alone, with no look at who is hidden.
    expect(page).toMatch(/const filteredAgents = useMemo\(\s*\(\) => sortRoster\(applyRosterFilters\(agents, rosterFilters\), rosterSort, locale\)/)
    // A tick per employee (owner, 2026-10-09: «галочкой выбирать… некоторых
    // конкретных видеть одновременно, кто где находится»): a real checkbox.
    expect(roster).toMatch(/<input\s+type="checkbox"\s+checked=\{!hiddenAgentIds\.has\(agent\.agentId\)\}\s+onChange=\{\(\) => onToggleAgentOnMap\(agent\.agentId\)\}/)
    expect(roster).toContain('aria-label={tMap("layers.agentOnMap", { name: agent.name })}')
    expect(page).toContain("onToggleAgentOnMap={toggleAgentOnMap}")
  })

  it("lets go of the selection when the selected employee is the one hidden", () => {
    expect(page).toMatch(/const toggleAgentOnMap = \(agentId: string\) => \{[\s\S]{0,400}if \(hide && selectedAgentRef\.current === agentId\) handleAgentClick\(agentId\)/)
  })

  it("starts a comparison from nobody, or from everybody, in one press, and says how many are on the map", () => {
    // «Все» and «Никого» are about the rows in the list: with a filter on,
    // nobody out of sight is ticked or unticked behind one's back.
    expect(roster).toContain('data-testid="live-map-on-map-none" onClick={() => onSetAgentsOnMap(rowIds, false)}')
    expect(roster).toContain('data-testid="live-map-on-map-all" onClick={() => onSetAgentsOnMap(rowIds, true)}')
    expect(roster).toContain('tMap("layers.onMapCount", { shown: tick.onMap, total: tick.total })')
    expect(page).toContain("onSetAgentsOnMap={setAgentsOnMap}")
    // Taking the selected employee off the map lets go of the selection, as his own tick does.
    expect(page).toMatch(/const setAgentsOnMap = \(agentIds: string\[\], onMap: boolean\) => \{[\s\S]{0,500}if \(!onMap && selected && agentIds\.includes\(selected\)\) handleAgentClick\(selected\)/)
    for (const locale of ["ru", "az", "en"]) {
      const layers = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmMap.layers
      expect(layers.onMapCount, locale).toMatch(/\{shown\}.*\{total\}/)
      expect(layers.agentOnMap, locale).toContain("{name}")
      expect([typeof layers.selectAll, typeof layers.selectNone]).toEqual(["string", "string"])
    }
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
