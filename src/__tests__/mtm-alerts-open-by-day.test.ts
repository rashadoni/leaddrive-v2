// @vitest-environment jsdom
/**
 * The alerts page opens on every open alert, day by day (owner, 2026-10-15).
 *
 * The Panel said «7 не решено», its button opened 12 October and the page
 * showed 1: it read one day at a time, and the other six (7–8 October) were
 * on no screen. The look was shown to the owner as a picture first («Да,
 * делай»). Rendered from the server's grouping of Zeytun's seven open alerts
 * as they stood that day (the agent's name replaced).
 */
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { groupMtmAlertsByAgentDay, type MtmAlertDayRow } from "@/lib/mtm/alert-day-groups"

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/mtm/alerts",
  useSearchParams: () => nav.params,
}))
const session = { data: { user: { organizationId: "org-1" } }, status: "authenticated" }
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const T = ru.mtmAlertsPage

const row = (id: string, createdAt: string, type: string, metadata: Record<string, unknown>): MtmAlertDayRow => ({
  id, agentId: "agent-1", agentName: "Agent One", type, category: "WARNING", title: "", description: null,
  isResolved: false, createdAt, metadata,
})
// The metadata as the alert jobs write it on production.
const deviation = (id: string, at: string, meters: number) => row(id, at, "OUT_OF_ZONE", {
  routeId: "r-1", threshold: 500, deviationMeters: meters,
  messageKey: "routeDeviation", messageParams: { deviationMeters: meters, thresholdMeters: 500 },
})
const openVisit = (id: string, at: string, minutes: number) => row(id, at, "LONG_BREAK", {
  visitId: `visit-${id}`, actualDuration: minutes, alertThresholdMinutes: 120,
  messageKey: "visitStillOpen", messageParams: { minutes, customerName: "Clinic One", thresholdMinutes: 120 },
})

/** Zeytun's seven open alerts of 15 October 2026, in UTC. */
const ROWS = [
  openVisit("a12", "2026-10-12T19:30:00.000Z", 128),
  deviation("a8e", "2026-10-08T18:01:00.000Z", 1_600),
  deviation("a8d", "2026-10-08T17:50:00.000Z", 1_200),
  deviation("a8c", "2026-10-08T15:08:00.000Z", 900),
  deviation("a8b", "2026-10-08T10:06:00.000Z", 700),
  deviation("a8a", "2026-10-08T09:56:00.000Z", 650),
  // 7 October in UTC, 8 October in Baku.
  openVisit("a7", "2026-10-07T20:15:00.000Z", 120),
]

let openRows: MtmAlertDayRow[]
let posts: Array<{ url: string; body: unknown }>

function answer(url: URL) {
  // The server's rule: a day, or resolved / all alerts, is one day; else every open alert.
  if (url.searchParams.get("date") || (url.searchParams.get("status") ?? "open") !== "open") {
    return { timezone: "Asia/Baku", mode: "day", date: url.searchParams.get("date") ?? "2026-10-15", today: "2026-10-15", status: url.searchParams.get("status") ?? "open",
      staleDays: 7, staleBefore: "2026-10-07T20:00:00.000Z", canResolve: true, truncated: false, groups: [], stale: { total: 0, groups: [] } }
  }
  return { timezone: "Asia/Baku", mode: "open", date: null, today: "2026-10-15", status: "open", staleDays: 7,
    staleBefore: "2026-10-07T20:00:00.000Z", canResolve: true, truncated: false,
    groups: groupMtmAlertsByAgentDay(openRows, "Asia/Baku"), stale: { total: 0, groups: [] } }
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "https://crm.test")
  if (init?.method === "POST") {
    const body = JSON.parse(String(init.body))
    posts.push({ url: url.pathname, body })
    openRows = openRows.filter((candidate) => !(body.ids as string[]).includes(candidate.id))
    return new Response(JSON.stringify({ success: true, data: { resolved: body.ids.length } }))
  }
  if (url.pathname === "/api/v1/mtm/alerts") return new Response(JSON.stringify({ success: true, data: answer(url) }))
  return new Response(JSON.stringify({ success: true, data: { agents: [{ id: "agent-1", name: "Agent One" }] } }))
})

let container: HTMLDivElement
let root: Root

async function flush() {
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function mount() {
  const { default: Page } = await import("@/app/(dashboard)/mtm/alerts/page")
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale: "ru", timeZone: "Asia/Baku", messages: ru, onError: () => {}, children: null }
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(Page))))
  await flush()
}

const byTestId = (id: string) => {
  const element = document.querySelector(`[data-testid="${id}"]`)
  if (!element) throw new Error(`no [data-testid="${id}"]`)
  return element as HTMLElement
}
async function click(element: HTMLElement) {
  await act(async () => { element.click() })
  await flush()
}

beforeEach(() => {
  openRows = [...ROWS]
  posts = []
  nav.params = new URLSearchParams()
  nav.replace.mockClear()
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})

describe("the alerts page", () => {
  it("opens on all seven open alerts, a day under another, newest day first", async () => {
    await mount()

    expect(byTestId("mtm-alerts-open-summary").textContent).toBe("7 оповещений не решено · за 2 дня · 1 сотрудник")
    const days = [...container.querySelectorAll('section[data-testid^="mtm-alerts-day-"]')]
    expect(days.map((day) => day.getAttribute("data-testid"))).toEqual(["mtm-alerts-day-2026-10-12", "mtm-alerts-day-2026-10-08"])
    expect(days[0].querySelector("h2")?.textContent).toBe("понедельник, 12 октября")
    expect(days[0].textContent).toContain("1 не решено")
    expect(days[1].textContent).toContain("6 не решено")
    // The deviations of a day are one row; the visit left open is another.
    expect(days[1].textContent).toContain("Agent One · вне маршрута · 13:56–22:01 · 5 раз · 1,6 км от маршрута")
    expect(days[1].textContent).toContain("Agent One · визит не закрыт · 00:15 · 1 раз · открыт 120 мин")
    // The request asked for no day at all.
    const listCall = fetchMock.mock.calls.find(([input]) => String(input).startsWith("/api/v1/mtm/alerts?"))
    expect(new URL(String(listCall?.[0]), "https://crm.test").searchParams.has("date")).toBe(false)
  })

  it("resolves a whole day at once, after its count was shown", async () => {
    await mount()

    await click(byTestId("mtm-alerts-resolve-day-2026-10-08"))
    expect(document.body.textContent).toContain("Решить все 6 оповещений этого дня?")
    expect(posts).toEqual([])
    const confirm = [...document.querySelectorAll("button")].filter((button) => button.textContent === T.resolveDay).at(-1)!
    await click(confirm)

    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe("/api/v1/mtm/alerts/resolve")
    expect((posts[0].body as { ids: string[] }).ids.sort()).toEqual(["a7", "a8a", "a8b", "a8c", "a8d", "a8e"])
    expect(container.querySelector('[data-testid="mtm-alerts-day-2026-10-08"]')).toBeNull()
    expect(byTestId("mtm-alerts-open-summary").textContent).toContain("1 оповещение не решено")
  })

  it("shows one day on «Выбрать день», and comes back on «Все нерешённые»", async () => {
    await mount()

    await click(byTestId("mtm-alerts-pick-day"))
    expect(nav.replace).toHaveBeenLastCalledWith("/mtm/alerts?date=2026-10-15", { scroll: false })

    await act(async () => root.unmount())
    root = createRoot(container)
    nav.params = new URLSearchParams("date=2026-10-08")
    await mount()
    expect(container.querySelector('[data-testid="mtm-alerts-date"]')).not.toBeNull()
    await click(byTestId("mtm-alerts-all-open"))
    expect(nav.replace).toHaveBeenLastCalledWith("/mtm/alerts", { scroll: false })
  })

  it("says when nothing is left open, and offers what was resolved today", async () => {
    openRows = []
    await mount()

    expect(byTestId("mtm-alerts-none-open").textContent).toContain(T.noneOpen)
    const showResolved = [...container.querySelectorAll("button")].find((button) => button.textContent === T.showResolvedToday)!
    await click(showResolved)
    expect(nav.replace).toHaveBeenLastCalledWith("/mtm/alerts?status=resolved", { scroll: false })
  })
})
