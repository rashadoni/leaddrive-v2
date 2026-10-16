// @vitest-environment jsdom
/**
 * The route planner on a map (/mtm/routes/plan), as a manager uses it.
 *
 * Owner, 2026-10-15, from the UX audit: the builder was a small window where
 * the date could not be changed, clients came eight at a time and there was no
 * map. He chose this page from a picture («Да, делай»). Asked here: what the
 * page reads, what it sends — the same requests as the builder, so the server
 * keeps deciding — and what a manager sees while planning. The map itself
 * (Leaflet) is replaced by a stand-in that draws its places as buttons.
 */
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RoutePlannerCandidate, RoutePlannerPlace } from "@/lib/mtm/route-planner"

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn(), push: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  useSearchParams: () => nav.params,
}))
const session = { data: { user: { organizationId: "org-1" } }, status: "authenticated" }
vi.mock("next-auth/react", () => ({ useSession: () => session }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast: toasts }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})
// The Leaflet map: its places and their «add» buttons, as plain buttons.
const mapProps = vi.hoisted(() => ({ current: null as null | { places: RoutePlannerPlace[]; stops: Array<{ key: string }> } }))
vi.mock("next/dynamic", async () => {
  const { createElement: h } = await import("react")
  return {
    default: () => function MapStandIn(props: { places: RoutePlannerPlace[]; stops: Array<{ key: string }>; onAdd: (candidate: RoutePlannerCandidate) => void }) {
      mapProps.current = props
      return h("div", { "data-testid": "map-stand-in" }, props.places.flatMap((place) => place.candidates.map((candidate) =>
        h("button", { key: candidate.key, type: "button", "data-testid": `add-${candidate.key}`, onClick: () => props.onAdd(candidate) }, candidate.name))))
    },
  }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const T = ru.mtmRoutePlanner

/** About this many metres north of a point in Baku. */
const north = (meters: number) => 40.3988 + meters / 111_195
const customer = (id: string, meters: number) => ({ name: `Clinic ${id}`, address: `Street ${id}`, latitude: north(meters), longitude: 49.8301 })
const ORGANIZATIONS = [
  { customerId: "c1", contactId: null, name: "Clinic c1", category: "A", monthlyVisitCount: 0, customer: customer("c1", 0) },
  { customerId: "c2", contactId: null, name: "Clinic c2", category: "B", monthlyVisitCount: 0, customer: customer("c2", 300) },
  { customerId: "c3", contactId: null, name: "Clinic c3", category: "B", monthlyVisitCount: 2, customer: customer("c3", 600) },
]
const DOCTORS = [
  { customerId: "c1", contactId: "d1", name: "Dr One", specialtyName: "Gastro", category: "A", monthlyVisitCount: 0, customer: customer("c1", 0) },
]

let capabilities: Record<string, unknown>
let posts: Array<{ url: string; method: string; body: unknown }>
let createAnswer: { status: number; body: unknown }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "https://crm.test")
  const method = init?.method ?? "GET"
  if (method !== "GET") {
    posts.push({ url: url.pathname, method, body: JSON.parse(String(init?.body)) })
    if (url.pathname === "/api/v1/mtm/routes") return json(createAnswer.body, createAnswer.status)
    if (url.pathname.endsWith("/publish")) return json({ success: true, data: { version: 3 } })
  }
  if (url.pathname === "/api/v1/mtm/settings") return json({ success: true, data: { timezone: "Asia/Baku", routeTargetTypes: null } })
  if (url.pathname === "/api/v1/mtm/routes") return json({ success: true, data: { routes: [], capabilities } })
  if (url.pathname === "/api/v1/mtm/agents") return json({ success: true, data: { agents: [
    { id: "agent-1", name: "Agent One", role: "AGENT", status: "ACTIVE" },
    { id: "agent-2", name: "Agent Two", role: "AGENT", status: "ACTIVE" },
    { id: "manager-1", name: "Manager", role: "MANAGER", status: "ACTIVE" },
  ] } })
  if (url.pathname === "/api/v1/mtm/routes/candidates") {
    const candidates = url.searchParams.get("direction") === "DOCTOR" ? DOCTORS : ORGANIZATIONS
    return json({ success: true, data: { candidates, total: candidates.length, limited: false } })
  }
  return json({ error: "unexpected" }, 500)
})

let container: HTMLDivElement
let root: Root

async function flush() {
  for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
async function mount() {
  const { MtmRoutePlanner } = await import("@/components/mtm/route-planner")
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale: "ru", timeZone: "Asia/Baku", messages: ru, onError: () => {}, children: null }
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(MtmRoutePlanner))))
  await flush()
}
const byTestId = (id: string) => {
  const element = container.querySelector(`[data-testid="${id}"]`)
  if (!element) throw new Error(`no [data-testid="${id}"]`)
  return element as HTMLElement
}
async function click(element: HTMLElement) {
  await act(async () => { element.click() })
  await flush()
}
const stopNames = () => [...container.querySelectorAll('[data-testid^="mtm-route-planner-stop-"]')].map((stop) => stop.querySelector(".font-semibold")?.textContent)
const stopTimes = () => [...container.querySelectorAll('[data-testid^="mtm-route-planner-time-"]')].map((select) => (select as HTMLSelectElement).value)
const candidateCalls = () => fetchMock.mock.calls.map(([input]) => new URL(String(input), "https://crm.test")).filter((url) => url.pathname === "/api/v1/mtm/routes/candidates")

beforeEach(() => {
  nav.params = new URLSearchParams("agentId=agent-1&date=2026-10-16")
  nav.replace.mockClear()
  nav.push.mockClear()
  Object.values(toasts).forEach((spy) => spy.mockClear())
  capabilities = { canCreateRoute: true, canPublish: true, canReview: true, actorAgentId: null }
  posts = []
  createAnswer = { status: 201, body: { success: true, data: { id: "route-new", version: 1 } } }
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})

describe("the route planner", () => {
  it("opens on the employee and the day of the address, with the clients due this month on the map", async () => {
    await mount()

    expect((byTestId("mtm-route-planner-agent") as HTMLSelectElement).value).toBe("agent-1")
    // A manager is not a field employee to plan for.
    expect([...byTestId("mtm-route-planner-agent").querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Agent One", "Agent Two"])
    expect(byTestId("mtm-route-planner-day").textContent).toBe("пт, 16 октября")
    expect(byTestId("mtm-route-planner-only-due").textContent).toBe("Без визита за октябрь · 2")
    // The builder's own list: for this employee and this day, for the month.
    const [organizations] = candidateCalls()
    expect(Object.fromEntries(organizations.searchParams)).toMatchObject({ agentId: "agent-1", startDate: "2026-10-16", direction: "ORGANIZATION", period: "MONTH" })
    // Only the place where somebody is due is drawn; the visited one waits behind «Все».
    expect(mapProps.current?.places.map((place) => place.customerId)).toEqual(["c1", "c2"])
    await click(byTestId("mtm-route-planner-all"))
    expect(mapProps.current?.places.map((place) => place.customerId)).toEqual(["c1", "c2", "c3"])
  })

  it("moves the plan to another day with the arrows, and reads that day's clients", async () => {
    await mount()

    await click(byTestId("mtm-route-planner-next-day"))

    expect(byTestId("mtm-route-planner-day").textContent).toBe("сб, 17 октября")
    expect(candidateCalls().at(-1)?.searchParams.get("startDate")).toBe("2026-10-17")
    expect(nav.replace).toHaveBeenLastCalledWith("/mtm/routes/plan?agentId=agent-1&date=2026-10-17", { scroll: false })
  })

  it("proposes the due clients close together, each an hour after the last, from 09:30", async () => {
    await mount()
    // Doctors are a route target by default: both lists are read.
    expect(candidateCalls().map((url) => url.searchParams.get("direction")).sort()).toEqual(["DOCTOR", "ORGANIZATION"])

    await click(byTestId("mtm-route-planner-suggest"))

    // At c1 the visit is to its doctor; c2 has none, so the clinic itself.
    expect(stopNames()).toEqual(["Dr One", "Clinic c2"])
    expect(stopTimes()).toEqual(["09:30", "10:30"])
    expect(byTestId("mtm-route-planner-summary").textContent).toContain("2 точки")
    expect(toasts.success).toHaveBeenCalledWith("Добавлены 2 точки")
    // Nothing new to propose: it says so instead of doing nothing.
    await click(byTestId("mtm-route-planner-suggest"))
    expect(toasts.info).toHaveBeenCalledWith("Все клиенты этого сотрудника за октябрь уже посещены или стоят в маршруте.")
  })

  it("moves a stop with the keyboard; the times stay where they were", async () => {
    await mount()
    await click(byTestId("add-c2"))
    await click(byTestId("add-c1"))
    expect(stopNames()).toEqual(["Clinic c2", "Clinic c1"])

    await act(async () => {
      byTestId("mtm-route-planner-stop-1").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }))
    })
    await flush()

    expect(stopNames()).toEqual(["Clinic c1", "Clinic c2"])
    expect(stopTimes()).toEqual(["09:30", "10:30"])
  })

  it("saves a draft through the builder's own request — times on the tenant's clock — and opens it among the routes", async () => {
    await mount()
    await click(byTestId("add-c1"))
    await click(byTestId("add-c2"))

    await click(byTestId("mtm-route-planner-save"))

    expect(posts).toEqual([{
      url: "/api/v1/mtm/routes",
      method: "POST",
      body: {
        name: null,
        date: "2026-10-16",
        notes: null,
        status: "DRAFT",
        agentId: "agent-1",
        assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
        points: [
          // 09:30 and 10:30 in Baku.
          { customerId: "c1", contactId: null, plannedTime: "2026-10-16T05:30:00.000Z" },
          { customerId: "c2", contactId: null, plannedTime: "2026-10-16T06:30:00.000Z" },
        ],
      },
    }])
    expect(nav.push).toHaveBeenCalledWith("/mtm/routes?routeId=route-new")
  })

  it("publishes after saving, with the version the save returned", async () => {
    await mount()
    await click(byTestId("add-c1"))

    await click(byTestId("mtm-route-planner-publish"))

    expect(posts.map((post) => post.url)).toEqual(["/api/v1/mtm/routes", "/api/v1/mtm/routes/route-new/publish"])
    expect(posts[1].body).toEqual({ expectedVersion: 1 })
    expect(toasts.success).toHaveBeenCalledWith(T.published)
  })

  it("says the employee already has a route that day, and leads to it", async () => {
    createAnswer = { status: 409, body: { error: "Duplicate", code: "ROUTE_DUPLICATE", duplicate: { id: "route-old" } } }
    await mount()
    await click(byTestId("add-c1"))

    await click(byTestId("mtm-route-planner-save"))

    const alert = container.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain(T.duplicate)
    expect(alert.querySelector("a")?.getAttribute("href")).toBe("/mtm/routes?routeId=route-old")
    expect(nav.push).not.toHaveBeenCalled()
  })

  it("lets an employee who plans his own day plan only for himself, and not publish when he may not", async () => {
    capabilities = { canCreateRoute: true, canPublish: false, canReview: false, actorAgentId: "agent-2" }
    nav.params = new URLSearchParams("date=2026-10-16")
    await mount()

    const agent = byTestId("mtm-route-planner-agent") as HTMLSelectElement
    expect(agent.value).toBe("agent-2")
    expect(agent.disabled).toBe(true)
    expect(container.querySelector('[data-testid="mtm-route-planner-publish"]')).toBeNull()
  })

  // «В маршрут» from the lists of clients and institutions (2026-10-16).
  it("puts the client from a list row on the route, and takes them out of the address so a reload does not add them twice", async () => {
    nav.params = new URLSearchParams("agentId=agent-1&date=2026-10-16&customerId=c1&contactId=d1")
    await mount()

    expect(stopNames()).toEqual(["Dr One"])
    expect(stopTimes()).toEqual(["09:30"])
    expect(container.querySelector('[data-testid="mtm-route-planner-prefill-missing"]')).toBeNull()
    expect(nav.replace).toHaveBeenLastCalledWith("/mtm/routes/plan?agentId=agent-1&date=2026-10-16", { scroll: false })
  })

  it("says so when the client is not this employee's to visit, and adds nothing", async () => {
    nav.params = new URLSearchParams("agentId=agent-1&date=2026-10-16&customerId=c9")
    await mount()

    expect(stopNames()).toEqual([])
    expect(byTestId("mtm-route-planner-prefill-missing").textContent).toBe(T.prefillMissing)
    // The client stays asked for: choosing the right employee puts them on.
    expect(nav.replace).not.toHaveBeenCalledWith("/mtm/routes/plan?agentId=agent-1&date=2026-10-16", { scroll: false })
  })
})
