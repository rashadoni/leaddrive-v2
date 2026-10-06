// @vitest-environment jsdom
/**
 * Route & Field → Routes: «these routes are waiting for you».
 *
 * 2026-10-06: a field agent built his route, the app answered «saved», and he
 * could not start it — it was a draft waiting for a manager. The manager was
 * told nothing: the draft was one more row among two hundred. The owner the
 * same night: the manager must see that a route was sent for approval.
 *
 * The real strip with the Russian copy; the page's own «publish» is a spy.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Record<string, Record<string, string>>
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    (ru[namespace]?.[key] ?? `${namespace}.${key}`).replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? "")),
}))

import { MtmRoutesAwaitingPublish } from "@/components/mtm/routes-awaiting-publish"
import { routesAwaitingPublish } from "@/lib/mtm/routes-awaiting-publish"
import type { MtmRouteRecord } from "@/components/mtm/route-types"

const TODAY = "2026-10-07"
const route = (id: string, overrides: Partial<MtmRouteRecord> = {}): MtmRouteRecord => ({
  id,
  version: 3,
  agentId: `agent-${id}`,
  agent: { id: `agent-${id}`, name: `Agent ${id.toUpperCase()}` },
  date: `${TODAY}T00:00:00.000Z`,
  status: "DRAFT",
  totalPoints: 2,
  visitedPoints: 0,
  ...overrides,
} as MtmRouteRecord)

let root: Root
let container: HTMLDivElement
const onOpen = vi.fn()
const onPublish = vi.fn()

async function show(routes: MtmRouteRecord[], canPublish = true) {
  await act(async () => {
    root.render(createElement(MtmRoutesAwaitingPublish, { routes, todayKey: TODAY, canPublish, onOpen, onPublish }))
  })
}
const strip = () => container.querySelector<HTMLElement>('[data-testid="mtm-routes-awaiting-publish"]')
const row = (id: string) => container.querySelector<HTMLElement>(`[data-testid="mtm-route-awaiting-${id}"]`)
const button = (id: string, label: string) => [...(row(id)?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.trim() === label) ?? null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  onOpen.mockReset()
  onPublish.mockReset()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

describe("which routes are waiting on a manager", () => {
  it("is a saved route with stops whose day has not passed — the nearest day first", () => {
    const waiting = routesAwaitingPublish([
      route("later", { date: "2026-10-09T00:00:00.000Z" }),
      route("today-b", { agent: { id: "b", name: "Beta" } }),
      route("today-a", { agent: { id: "a", name: "Alpha" }, totalPoints: 0, points: [{}, {}, {}] as never }),
    ], TODAY)
    expect(waiting.map((item) => [item.route.id, item.agentName, item.stops])).toEqual([
      ["today-a", "Alpha", 3], ["today-b", "Beta", 2], ["later", "Agent LATER", 2],
    ])
  })

  it("is not yesterday's draft, an empty draft, or a route that is already published", () => {
    const none = [
      route("yesterday", { date: "2026-10-06T00:00:00.000Z" }),
      route("empty", { totalPoints: 0 }),
      route("planned", { status: "PLANNED" }),
      route("running", { status: "IN_PROGRESS" }),
      route("done", { status: "COMPLETED" }),
    ]
    expect(routesAwaitingPublish(none, TODAY)).toEqual([])
  })
})

describe("Routes page — «ждут публикации»", () => {
  it("names who is waiting, for which day and with how many stops, and says why it matters", async () => {
    await show([route("s1"), route("p1", { status: "PLANNED" })])

    expect(strip()?.textContent).toContain("Ждут публикации: 1")
    expect(strip()?.textContent).toContain("сотрудники не могут по ним работать, пока вы их не опубликуете")
    expect(row("s1")?.textContent).toContain("Agent S1")
    expect(row("s1")?.textContent).toContain("7 октября")
    expect(row("s1")?.textContent).toContain("точек: 2")
    expect(row("p1")).toBeNull()
  })

  it("publishes that route with one press, through the page's own publish", async () => {
    const waiting = route("s1")
    await show([waiting])
    await act(async () => { button("s1", "Опубликовать маршрут")?.click() })

    expect(onPublish.mock.calls).toEqual([[waiting]])
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("opens the route first for a manager who wants to look before publishing", async () => {
    const waiting = route("s1")
    await show([waiting])
    await act(async () => { button("s1", "Открыть")?.click() })

    expect(onOpen.mock.calls).toEqual([[waiting]])
    expect(onPublish).not.toHaveBeenCalled()
  })

  it("is not there when nothing waits, and not shown to someone who cannot publish", async () => {
    await show([route("p1", { status: "PLANNED" })])
    expect(strip()).toBeNull()

    await show([route("s1")], false)
    expect(strip()).toBeNull()
  })

  it("lists five and says how many more there are, instead of pushing the page down", async () => {
    await show(["a", "b", "c", "d", "e", "f", "g"].map((id) => route(id)))

    expect(strip()?.textContent).toContain("Ждут публикации: 7")
    expect(strip()?.querySelectorAll("li")).toHaveLength(5)
    expect(strip()?.textContent).toContain("И ещё 2 — в списке ниже.")
  })
})
