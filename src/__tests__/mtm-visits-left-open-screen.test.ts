// @vitest-environment jsdom
/**
 * A visit the agent left open is not «going on now» (owner, 2026-10-15).
 *
 * On the visits page «Сейчас идут визиты: 1» was a visit opened on 12 October,
 * three days before, and its card said «21:21 → ещё не завершён». The office
 * does not close an agent's visit (2026-09-25); it reminds him. The look was
 * shown to the owner as a picture first («Да, делай»). The visit here is that
 * one, as the server returned it (names as on the screen he showed).
 */
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/mtm/visits",
  useSearchParams: () => nav.params,
}))
const session = { data: { user: { organizationId: "org-1", id: "user-1" } }, status: "authenticated" }
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/ai/advisor-record-widget", () => ({ AdvisorRecordWidget: () => null }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Link props, not attributes of <a>
    default: ({ href, children, scroll, prefetch, ...rest }: { href: string; scroll?: boolean; prefetch?: boolean; children?: unknown }) => h("a", { href, ...rest }, children as never),
  }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const T = ru.mtmVisitsPage

/** 15 October 2026, 20:00 in Baku. */
const NOW = new Date("2026-10-15T16:00:00.000Z")
const customer = (id: string, name: string) => ({ id, name, address: "Yasamal r-nu", city: "Bakı", latitude: 40.400897, longitude: 49.804292, geofenceRadius: null })
const row = (id: string, checkInAt: string, agentId: string, agentName: string, place: ReturnType<typeof customer>) => ({
  id, agentId, customerId: place.id, contactId: null, status: "CHECKED_IN", checkInAt, checkOutAt: null, duration: null,
  checkInLat: 40.4126, checkInLng: 49.9516, checkInCustomerLat: 40.4122, checkInCustomerLng: 49.9518, checkInGeofenceRadius: 300,
  agent: { id: agentId, name: agentName }, customer: place, contact: null, tasksCompleted: 0, tasksTotal: 0,
})
const STALE = row("visit-stale", "2026-10-12T17:21:51.026Z", "agent-1", "Seymur Məmmədov", customer("c1", "Milli Onkologiya Mərkəzi"))
const FRESH = row("visit-fresh", "2026-10-15T15:30:00.000Z", "agent-2", "Agent Two", customer("c2", "Yasamal Hospital"))
const review = (visit: typeof STALE) => ({
  visit: {
    ...visit, locationRequest: null, notes: null, outcome: null, potential: null, resultNotes: null, nextActionDueAt: null,
    route: { id: "route-1", name: null, date: "2026-10-12T00:00:00.000Z" }, routePoint: { id: "point-1", orderIndex: 0 },
    requirementSnapshot: { requirements: [{ id: "req-1", actionKey: "PHOTO", mode: "OPTIONAL", minCount: 1 }] },
    actionResults: [], presentationSessions: [], photos: [], primaryAgentHidden: false, photoCount: 0,
  },
  geofenceRadius: 300, openTasks: { count: 0, items: [] }, timezone: "Asia/Baku", viewer: { canExecute: false },
})

let posts: Array<{ url: string; body: Record<string, unknown> }>
let viewerRole: string
const json = (body: unknown) => new Response(JSON.stringify(body))
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "https://crm.test")
  if (init?.method === "POST") {
    posts.push({ url: url.pathname, body: JSON.parse(String(init.body)) })
    return json({ success: true, data: { id: "message-1" } })
  }
  if (url.pathname === "/api/v1/mtm/visits/active") return json({ success: true, data: { visits: [FRESH, STALE], viewer: { agentId: null, role: viewerRole }, longOpenMinutes: 120 } })
  if (url.pathname === "/api/v1/mtm/visits/visit-stale/review") return json({ success: true, data: review(STALE) })
  if (url.pathname === "/api/v1/mtm/visits") return json({ success: true, data: { visits: [STALE], total: 1, totalExact: true, sourceTruncated: false, candidateLimit: null, page: 1, limit: 20, range: "7d", timezone: "Asia/Baku", geofenceRadius: 300 } })
  return json({ success: true, data: {} })
})

let container: HTMLDivElement
let root: Root

async function flush() {
  for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
async function mount() {
  const { default: Page } = await import("@/app/(dashboard)/mtm/visits/page")
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale: "ru", timeZone: "Asia/Baku", messages: ru, onError: () => {}, children: null }
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(Page))))
  await flush()
}
const byTestId = (id: string) => {
  const element = container.querySelector(`[data-testid="${id}"]`)
  if (!element) throw new Error(`no [data-testid="${id}"]`)
  return element as HTMLElement
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  nav.params = new URLSearchParams()
  posts = []
  viewerRole = "ADMIN"
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  fetchMock.mockClear()
})

describe("a visit left open on the visits page", () => {
  it("is listed apart, with its date and how long — the visit begun half an hour ago is the one going on", async () => {
    await mount()

    const going = container.querySelector('[aria-labelledby="team-active-visits-title"]')!
    expect(going.textContent).toContain(T.teamActiveTitle.replace("{count}", "1"))
    expect(going.textContent).toContain("Yasamal Hospital")
    expect(going.textContent).not.toContain("Milli Onkologiya Mərkəzi")

    const leftOpen = byTestId("mtm-visits-left-open")
    expect(leftOpen.textContent).toContain("Не закрыт агентом: 1 визит")
    expect(leftOpen.textContent).toContain("Milli Onkologiya Mərkəzi")
    expect(leftOpen.textContent).toContain("Seymur Məmmədov · открыт с 12 окт., 21:21 · 2 дня")
    // The history says the same of the same visit.
    expect(container.querySelector('[data-testid="mtm-visit-row-left-open"]')?.textContent).toBe(T.statusLeftOpen)
  })

  it("reminds the agent through «Связь с командой», in all three languages, once", async () => {
    await mount()

    await act(async () => { byTestId("mtm-visit-remind-visit-stale").click() })
    await flush()

    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe("/api/v1/mtm/operations/messages")
    expect(posts[0].body).toMatchObject({ type: "DIRECT", agentIds: ["agent-1"] })
    expect(posts[0].body.body).toBe("Визит в «Milli Onkologiya Mərkəzi» открыт с 12 октября в 21:21 и всё ещё не закрыт. Закройте его в приложении.")
    expect(Object.keys(posts[0].body.localizations as object).sort()).toEqual(["az", "en", "ru"])
    const sent = byTestId("mtm-visit-remind-visit-stale") as HTMLButtonElement
    expect(sent.textContent).toBe(T.reminded)
    expect(sent.disabled).toBe(true)
  })

  it("says in the visit's card that the agent has not closed it, since when — and offers the reminder, never a close", async () => {
    nav.params = new URLSearchParams("visitId=visit-stale")
    await mount()

    expect(byTestId("mtm-visit-left-open-status").textContent).toBe(T.statusLeftOpen)
    expect(byTestId("mtm-visit-review-facts").textContent).toContain("с 12 окт., 21:21 → не закрыт агентом · 2 дня")
    expect(byTestId("mtm-visit-left-open-note").textContent).toContain(T.remindAgent)
    expect(container.textContent).not.toMatch(/Закрыть визит(?! может)/)
  })
})
