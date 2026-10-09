// @vitest-environment jsdom
/**
 * Live map → the selected employee's day, step by step.
 *
 * Owner, 2026-10-08, after a survey of some fifty transport and field-sales
 * products: «по карте думаю нужно больше интерактивности». What they all have
 * and this map did not is one linked screen: choose a person on the map or in
 * the list, see his day in order, press a step — the map goes there; press a
 * stop on the map — its step lights up.
 *
 * The rules of a step are tested as a function; the list is the real
 * component with the real Russian copy.
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
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}))

import { LiveMapDaySteps } from "@/components/mtm/live-map-day-steps"
import { liveMapDayProgress, liveMapDaySteps, type LiveMapDayStepPoint } from "@/lib/mtm/live-map-day-steps"
import { summarizeMtmRouteExecution } from "@/lib/mtm/route-point-execution"

const NOW = Date.parse("2026-10-08T08:00:00.000Z")
const at = (hhmm: string) => `2026-10-08T${hhmm}:00.000Z`
type Visit = { id: string; status: string; checkInAt: string; checkOutAt?: string | null }
const point = (order: number, status: string, extra: {
  plannedTime?: string | null; visits?: Visit[]; visitedAt?: string | null; noCoordinates?: boolean
} = {}) => ({
  id: `p${order}`, orderIndex: order, status,
  plannedTime: extra.plannedTime ?? null,
  visitedAt: extra.visitedAt ?? null,
  visits: extra.visits ?? [],
  customer: { name: `Учреждение ${order + 1}`, latitude: extra.noCoordinates ? null : 40.4 + order / 100, longitude: extra.noCoordinates ? null : 49.8 },
})
const stepsOf = (points: ReturnType<typeof point>[], now = NOW) =>
  liveMapDaySteps(points as LiveMapDayStepPoint[], summarizeMtmRouteExecution(points).points, now)

describe("what a step of the day is", () => {
  const day = [
    point(0, "VISITED", { plannedTime: at("06:00"), visits: [{ id: "v0", status: "CHECKED_OUT", checkInAt: at("06:05"), checkOutAt: at("06:35") }] }),
    point(1, "PENDING", { plannedTime: at("07:00"), visits: [{ id: "v1", status: "CHECKED_IN", checkInAt: at("07:40"), checkOutAt: null }] }),
    point(2, "PENDING", { plannedTime: at("07:30") }),
    point(3, "PENDING", { plannedTime: at("10:00") }),
    point(4, "SKIPPED"),
  ]

  it("reads visited, visit in progress, next, planned and skipped off the stops and their visits", () => {
    expect(stepsOf(day).map((step) => [step.sequence, step.state])).toEqual([
      [1, "VISITED"], [2, "IN_VISIT"], [3, "NEXT"], [4, "PLANNED"], [5, "SKIPPED"],
    ])
  })

  it("carries the times of what happened, and how long it took", () => {
    const [first, second] = stepsOf(day)
    expect([first.checkInAt, first.checkOutAt, first.durationMinutes, first.visitId]).toEqual([at("06:05"), at("06:35"), 30, "v0"])
    // The visit in progress has a beginning and no end.
    expect([second.checkInAt, second.checkOutAt, second.visitId]).toEqual([at("07:40"), null, "v1"])
  })

  it("says a visit began late only beyond the tolerance, and by how much", () => {
    const [first, second] = stepsOf(day)
    expect(first.startedLateMinutes).toBeNull()      // five minutes is not late
    expect(second.startedLateMinutes).toBe(40)
  })

  it("marks a stop overdue when its planned time has passed and nobody has begun it", () => {
    const steps = stepsOf(day)
    expect(steps[2].overdueMinutes).toBe(30)         // planned 07:30, now 08:00
    expect(steps[3].overdueMinutes).toBeNull()       // planned 10:00
    // A stop already visited, being visited or skipped is never «overdue».
    expect([steps[0].overdueMinutes, steps[1].overdueMinutes, steps[4].overdueMinutes]).toEqual([null, null, null])
    // …and within the tolerance it is not yet late.
    expect(stepsOf(day, Date.parse(at("07:40")))[2].overdueMinutes).toBeNull()
  })

  it("claims nothing about time for a stop that was planned without one", () => {
    const [only] = stepsOf([point(0, "PENDING")])
    expect([only.state, only.plannedTime, only.overdueMinutes, only.startedLateMinutes]).toEqual(["NEXT", null, null, null])
  })

  it("keeps a stop without coordinates in the day, and says the map cannot show it", () => {
    const steps = stepsOf([point(0, "PENDING", { noCoordinates: true }), point(1, "PENDING")])
    expect(steps.map((step) => [step.state, step.onMap])).toEqual([["NEXT", false], ["PLANNED", true]])
  })

  it("counts «2 of 5»: been to or at, never the skipped one", () => {
    expect(liveMapDayProgress(stepsOf(day))).toEqual({ done: 2, total: 5 })
    expect(liveMapDayProgress([])).toEqual({ done: 0, total: 0 })
  })

  it("takes a stop closed by a list payload without visit facts as visited", () => {
    const [only] = stepsOf([point(0, "VISITED", { visitedAt: at("06:30") })])
    expect([only.state, only.checkInAt]).toEqual(["VISITED", null])
  })
})

describe("the steps under the employee's card", () => {
  let root: Root
  let container: HTMLDivElement
  let chosen: (number | null)[] = []
  const day = [
    point(0, "VISITED", { visits: [{ id: "v0", status: "CHECKED_OUT", checkInAt: at("06:05"), checkOutAt: at("06:35") }] }),
    point(1, "PENDING", { plannedTime: at("07:00") }),
    point(2, "PENDING", { noCoordinates: true }),
  ]
  const draw = async (selectedOrder: number | null) => {
    await act(async () => {
      root.render(createElement(LiveMapDaySteps, {
        steps: stepsOf(day), selectedOrder,
        onSelect: (order: number | null) => { chosen.push(order) },
        formatTime: (value: string | null | undefined) => (value ? value.slice(11, 16) : ""),
      }))
    })
  }
  const step = (order: number) => container.querySelector(`[data-testid="live-map-day-step-${order}"]`) as HTMLElement
  const button = (order: number) => step(order).querySelector("button") as HTMLButtonElement

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    chosen = []
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("lists the day in order with what happened at each stop, in words", async () => {
    await draw(null)
    expect(step(0).textContent).toContain("Учреждение 1")
    expect(step(0).textContent).toContain("Посещена")
    expect(step(0).textContent).toContain("Факт 06:05–06:35")
    expect(step(0).textContent).toContain("30 мин")
    expect(step(1).textContent).toContain("Следующая")
    expect(step(1).textContent).toContain("План 07:00")
    expect(step(1).querySelector('[data-cue="overdue"]')?.textContent).toBe("опаздывает на 60 мин")
    // The visited stop offers its visit; the others have none to offer.
    expect(step(0).querySelector("a")?.getAttribute("href")).toBe("/mtm/visits?visitId=v0")
    expect(step(1).querySelector("a")).toBeNull()
  })

  it("asks the map for a stop when its step is pressed, and lets it go on a second press", async () => {
    await draw(null)
    await act(async () => { button(1).click() })
    expect(chosen).toEqual([1])
    await draw(1)
    expect([button(0).getAttribute("aria-pressed"), button(1).getAttribute("aria-pressed")]).toEqual(["false", "true"])
    await act(async () => { button(1).click() })
    expect(chosen).toEqual([1, null])
  })

  it("does not pretend the map can show a stop that has no coordinates", async () => {
    await draw(null)
    expect(button(2).disabled).toBe(true)
    expect(step(2).textContent).toContain("нет координат")
    await act(async () => { button(2).click() })
    expect(chosen).toEqual([])
  })
})

/**
 * The map itself is Leaflet and is not drawn in jsdom; that a marker selects
 * and a step reaches the map is checked on the running page after a deploy.
 * These hold the wiring in place so it cannot quietly come apart.
 */
describe("the wiring between the list, the card and the map", () => {
  const map = readFileSync("src/components/mtm/live-map.tsx", "utf8")
  const page = readFileSync("src/app/(dashboard)/mtm/map/page.tsx", "utf8")

  it("selects an employee from his marker and shows who he is on hover", () => {
    expect(map).toContain("eventHandlers={{ click: () => onAgentSelect?.(agent.agentId) }}")
    expect(map).toMatch(/<Tooltip direction="top"[\s\S]{0,200}\{agent\.name\}/)
    expect(page).toContain("onAgentSelect={handleMapAgentSelect}")
    // A second press on the same marker reads its balloon; it must not drop the selection.
    expect(page).toMatch(/const handleMapAgentSelect = \(agentId: string\) => \{\s*if \(selectedAgentRef\.current === agentId\) return\s*handleAgentClick\(agentId\)/)
  })

  it("passes the stop in focus both ways and follows on request", () => {
    expect(page).toContain("focusStopOrder={selectedStop}")
    expect(page).toContain("onStopSelect={setSelectedStop}")
    expect(page).toContain("followAgent={followSelected}")
    expect(map).toContain("eventHandlers={{ click: () => onStopSelect?.(stop.orderIndex) }}")
    expect(map).toContain("<FocusStop stops={plannedRoute} focusStopOrder={focusStopOrder} markers={stopMarkersRef} />")
    expect(map).toContain("<FollowAgent agents={agents} focusAgentId={focusAgentId} enabled={followAgent} />")
  })

  it("drops a selection that a status chip has just hidden, and the stop and «follow» with any selection", () => {
    expect(page).toMatch(/if \(!selected \|\| shownAgentIdsRef\.current\.has\(selected\)\) return[\s\S]{0,200}setSelectedAgent\(null\)[\s\S]{0,80}\}, \[activeFilter\]\)/)
    expect(page).toMatch(/setSelectedStop\(null\)\s*if \(!selectedAgent\) setFollowSelected\(false\)\s*\}, \[selectedAgent\]\)/)
  })
})
