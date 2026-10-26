// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { orgFromSession } from "@/lib/nav-items"
import type { ResolvedDashboardWidget } from "@/lib/dashboard/resolve-widgets"
import type { ResolvedQuickAction } from "@/lib/dashboard/quick-actions"

const state = vi.hoisted(() => ({
  session: {
    iat: 1,
    user: {
      id: "synthetic-user-a", email: "synthetic-a@example.invalid",
      organizationId: "synthetic-org-a", role: "manager", plan: "enterprise",
      modules: { crm: true, sales: true, loyalty: true },
    },
  },
  sessionPresent: true,
  status: "authenticated" as "authenticated" | "loading" | "unauthenticated",
  t: (key: string) => key,
  renderedDeals: [] as number[],
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: state.sessionPresent ? state.session : null, status: state.status }),
}))
vi.mock("next-intl", () => ({ useTranslations: () => state.t }))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => {} }))
// Navigation's independent MTM-settings request is outside this page's batch.
// Keep the real permission resolution and all page-owned lifecycle logic.
vi.mock("@/hooks/use-mtm-org-settings", () => ({ useNavOrgContext: (user: unknown) => orgFromSession(user) }))
vi.mock("@/components/dashboard/dashboard-welcome", () => ({
  DashboardWelcome: ({ data, quickActions }: {
    data: { pipeline: { deals: number } }; quickActions: ResolvedQuickAction[]
  }) => {
    state.renderedDeals.push(data.pipeline.deals)
    return createElement("section", { "data-testid": "dashboard-data" },
      createElement("span", { "data-testid": "deal-count" }, String(data.pipeline.deals)),
      ...quickActions.map((action) => createElement("a", { key: action.href, href: action.href }, action.href)))
  },
}))
vi.mock("@/components/dashboard/dashboard-grid", () => ({
  DashboardGrid: ({ widgets }: { widgets: ResolvedDashboardWidget[] }) => createElement("div", null,
    ...widgets.map((widget) => createElement("div", { key: widget.id, "data-dashboard-widget": widget.id }))),
}))
// Chart/browser integrations and child-owned requests are not part of the
// page's loading state. The real registry still decides which widgets exist.
vi.mock("@/components/dashboard/kpi-card", () => ({ KpiCard: () => null }))
vi.mock("@/components/dashboard/risks-banner", () => ({ RisksBanner: () => null }))
vi.mock("@/components/dashboard/sales-pipeline", () => ({ SalesPipeline: () => null }))
vi.mock("@/components/dashboard/revenue-trend", () => ({ RevenueTrend: () => null }))
vi.mock("@/components/dashboard/lead-sources-donut", () => ({ LeadSourcesDonut: () => null }))
vi.mock("@/components/dashboard/recent-deals", () => ({ RecentDeals: () => null }))
vi.mock("@/components/dashboard/ai-lead-scoring", () => ({ AiLeadScoring: () => null }))
vi.mock("@/components/dashboard/ai-value-widget", () => ({ AiValueWidget: () => null }))
vi.mock("@/components/dashboard/activity-feed", () => ({ ActivityFeed: () => null }))
vi.mock("@/components/dashboard/campaign-stats", () => ({ CampaignStats: () => null, campaignRateLabel: () => "" }))
vi.mock("@/components/dashboard/upcoming-events", () => ({ UpcomingEvents: () => null }))
vi.mock("@/components/dashboard/weekly-metrics", () => ({ WeeklyMetrics: () => null }))
vi.mock("@/components/dashboard/segments-widget", () => ({ SegmentsWidget: () => null }))
vi.mock("@/components/dashboard/loyalty-metric-widget", () => ({ LoyaltyMetricWidget: () => null }))
vi.mock("@/components/dashboard/quick-access-strip", () => ({ QuickAccessStrip: () => null }))

import DashboardPage from "@/app/(dashboard)/dashboard/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EXECUTIVE = "/api/v1/dashboard/executive"
const CONFIG = "/api/v1/dashboard/widget-config"
const LOYALTY = "/api/v1/loyalty-overview"
const fetchMock = vi.fn<typeof fetch>()
type PendingRequest = { url: string; options: RequestInit; resolve: (response: Response) => void }
let requests: PendingRequest[]
let honorRequestAbort: boolean
let container: HTMLElement
let root: Root | null

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 503, json: async () => body } as Response
}

function dashboardResponse(deals: number) {
  return {
    success: true,
    data: {
      financial: { monthlyRevenue: 0, marginPct: 0 },
      pipeline: { deals, wonValue: 0, conversionRate: 0, recentDeals: [] },
      leads: { activeCount: 0, total: 0, conversionRate: 0, bySource: [], topScored: [] },
      operations: { openTickets: 0, slaBreached: 0 },
      activity: { recent: [] }, risks: [], forecast: [], campaigns: [], events: [], weeklyMetrics: null,
    },
  }
}

async function render() {
  await act(async () => { root!.render(createElement(DashboardPage)) })
}

async function settle(batch: PendingRequest[], deals: number, config = response({ success: true, data: { widgets: {} } })) {
  await act(async () => {
    for (const request of batch) {
      request.resolve(request.url === EXECUTIVE ? response(dashboardResponse(deals))
        : request.url === CONFIG ? config : response({}))
    }
  })
}

function expectBatch(batch: PendingRequest[], loyalty: boolean) {
  expect(batch.map((request) => request.url).sort()).toEqual([EXECUTIVE, CONFIG, ...(loyalty ? [LOYALTY] : [])].sort())
  for (const request of batch) {
    expect(new Headers(request.options.headers).get("x-organization-id")).toBe(state.session.user.organizationId)
    expect(request.options.signal).toBeDefined()
    expect(request.options.signal!.aborted).toBe(false)
  }
}

function expectLoaded(deals: number) {
  expect(container.querySelector('[data-testid="deal-count"]')?.textContent).toBe(String(deals))
  expect(container.querySelector(".dashboard-welcome--loading")).toBeNull()
}

function cloneSession() {
  state.session = {
    ...state.session, iat: state.session.iat + 1,
    user: { ...state.session.user, modules: { ...state.session.user.modules } },
  }
}

beforeEach(() => {
  state.session = {
    iat: 1,
    user: {
      id: "synthetic-user-a", email: "synthetic-a@example.invalid",
      organizationId: "synthetic-org-a", role: "manager", plan: "enterprise",
      modules: { crm: true, sales: true, loyalty: true },
    },
  }
  state.sessionPresent = true
  state.status = "authenticated"
  state.renderedDeals = []
  requests = []
  honorRequestAbort = false
  fetchMock.mockReset().mockImplementation((url, options) => new Promise<Response>((resolve, reject) => {
    // Intentionally permit a response after abort: cleanup must also fence a
    // JSON parse that finishes after the identity has already changed.
    requests.push({ url: String(url), options: options ?? {}, resolve })
    if (honorRequestAbort) {
      const abort = () => reject(new DOMException("Synthetic request aborted", "AbortError"))
      if (options?.signal?.aborted) abort()
      else options?.signal?.addEventListener("abort", abort, { once: true })
    }
  }))
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("main")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  // Release test transports even when an assertion failed, clearing the
  // component's real timeout timers without waiting for their 12-second cap.
  await act(async () => { requests.forEach((request) => request.resolve(response({}, false))) })
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("dashboard request lifecycle", () => {
  it("waits for initial session hydration before loading the authenticated scope", async () => {
    state.sessionPresent = false
    state.status = "loading"
    await render()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.querySelector(".dashboard-welcome--loading")).not.toBeNull()
    expect(state.renderedDeals).toEqual([])

    state.sessionPresent = true
    state.status = "authenticated"
    await render()
    expectBatch(requests, true)
    await settle(requests.slice(), 10)
    expectLoaded(10)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("keeps one pending batch when Auth.js clones an equivalent session", async () => {
    await render()
    const initial = requests.slice()
    expectBatch(initial, true)
    cloneSession()
    await render()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expectBatch(initial, true)
    await settle(initial, 11)
    expectLoaded(11)
  })

  it("preserves rendered data and one batch across scrolling and an equivalent session refresh", async () => {
    await render()
    await settle(requests.slice(), 22)
    const loadedNode = container.querySelector('[data-testid="dashboard-data"]')
    expectLoaded(22)
    await act(async () => {
      container.scrollTop = 500
      container.dispatchEvent(new Event("scroll"))
      container.scrollTop = 0
      container.dispatchEvent(new Event("scroll"))
      window.dispatchEvent(new Event("scroll"))
    })
    await render()
    expectLoaded(22)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    cloneSession()
    await render()
    expectLoaded(22)
    expect(container.querySelector('[data-testid="dashboard-data"]')).toBe(loadedNode)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("keeps a retained identity's pending request and loaded data during transient session loading", async () => {
    await render()
    const initial = requests.slice()
    state.status = "loading"
    cloneSession()
    await render()
    expectBatch(initial, true)
    await settle(initial, 33)
    expectLoaded(33)
    state.status = "authenticated"
    cloneSession()
    await render()
    expectLoaded(33)
    state.status = "loading"
    await render()
    expectLoaded(33)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each([
    ["user", { id: "synthetic-user-b" }],
    ["organization", { organizationId: "synthetic-org-b" }],
    ["role", { role: "viewer" }],
    ["loyalty capability", { modules: { crm: true, sales: true, loyalty: false } }],
  ] as const)("starts a fresh batch for changed %s, aborting and ignoring the old batch", async (_kind, change) => {
    await render()
    const previous = requests.slice()
    state.session = { ...state.session, user: { ...state.session.user, ...change } }
    await render()
    const next = requests.slice(previous.length)
    expectBatch(next, state.session.user.modules.loyalty)
    expect(previous.every((request) => request.options.signal!.aborted)).toBe(true)
    await settle(next, 44)
    expectLoaded(44)
    await settle(previous, 99)
    expectLoaded(44)
    expect(state.renderedDeals).not.toContain(99)
  })

  it("starts the loyalty request when its permission becomes available", async () => {
    state.session.user.modules.loyalty = false
    await render()
    const previous = requests.slice()
    expectBatch(previous, false)
    state.session = { ...state.session, user: { ...state.session.user, modules: { ...state.session.user.modules, loyalty: true } } }
    await render()
    const next = requests.slice(previous.length)
    expectBatch(next, true)
    expect(previous.every((request) => request.options.signal!.aborted)).toBe(true)
    await settle(next, 55)
    await settle(previous, 99)
    expectLoaded(55)
  })

  it("uses email as the identity fallback when an id is absent", async () => {
    state.session.user.id = ""
    await render()
    const previous = requests.slice()
    cloneSession()
    await render()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    state.session = { ...state.session, user: { ...state.session.user, email: "synthetic-b@example.invalid" } }
    await render()
    const next = requests.slice(previous.length)
    expectBatch(next, true)
    expect(previous.every((request) => request.options.signal!.aborted)).toBe(true)
    await settle(next, 56)
    await settle(previous, 99)
    expectLoaded(56)
  })

  it("keeps the same request scope when a user with a stable id updates their email", async () => {
    await render()
    await settle(requests.slice(), 57)
    state.session = { ...state.session, user: { ...state.session.user, email: "synthetic-new@example.invalid" } }
    await render()
    expectLoaded(57)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("never carries prior-scope data, widgets or quick actions into a new scope whose config fails", async () => {
    await render()
    await settle(requests.slice(), 66, response({
      success: true, data: { widgets: { statCards: { enabled: false } }, quickActions: ["/companies"] },
    }))
    expectLoaded(66)
    expect(container.querySelector('[data-dashboard-widget="statCards"]')).toBeNull()
    expect(container.querySelector('a[href="/companies"]')).not.toBeNull()

    const offset = requests.length
    state.renderedDeals = []
    state.session = { ...state.session, user: { ...state.session.user, organizationId: "synthetic-org-b" } }
    await render()
    // Observe even intermediate child renders, not only the DOM after effects:
    // old-tenant data must not flash before the new request's skeleton appears.
    expect(state.renderedDeals).not.toContain(66)
    await settle(requests.slice(offset), 77, response({}, false))
    expectLoaded(77)
    expect(container.querySelector('[data-dashboard-widget="statCards"]')).not.toBeNull()
    expect(container.querySelector('a[href="/companies"]')).toBeNull()
    expect(container.querySelector('a[href="/boards"]')).not.toBeNull()
  })

  it("requires a fresh result when switching A to B and back to A before B resolves", async () => {
    await render()
    await settle(requests.slice(), 67)
    expectLoaded(67)
    const originalOrg = state.session.user.organizationId
    state.renderedDeals = []
    state.session = { ...state.session, user: { ...state.session.user, organizationId: "synthetic-org-b" } }
    await render()
    const otherScope = requests.slice(3)
    expectBatch(otherScope, true)
    expect(container.querySelector('[data-testid="dashboard-data"]')).toBeNull()

    state.session = { ...state.session, user: { ...state.session.user, organizationId: originalOrg } }
    await render()
    const returnedScope = requests.slice(6)
    expectBatch(returnedScope, true)
    expect(otherScope.every((request) => request.options.signal!.aborted)).toBe(true)
    expect(container.querySelector('[data-testid="dashboard-data"]')).toBeNull()
    expect(state.renderedDeals).toEqual([])
    await settle(returnedScope, 68)
    await settle(otherScope, 99)
    expectLoaded(68)
    expect(state.renderedDeals).not.toContain(67)
    expect(state.renderedDeals).not.toContain(99)
  })

  it.each([false, true])("hides loaded data immediately on logout (retained session: %s) and reloads after sign-in", async (retained) => {
    await render()
    await settle(requests.slice(), 78)
    expectLoaded(78)
    state.renderedDeals = []
    state.sessionPresent = retained
    state.status = "unauthenticated"
    await render()
    expect(container.querySelector('[data-testid="dashboard-data"]')).toBeNull()
    expect(container.querySelector(".dashboard-welcome--loading")).toBeNull()
    expect(state.renderedDeals).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(3)

    state.sessionPresent = true
    state.status = "authenticated"
    await render()
    expect(container.querySelector('[data-testid="dashboard-data"]')).toBeNull()
    const next = requests.slice(3)
    expectBatch(next, true)
    await settle(next, 79)
    expectLoaded(79)
  })

  it("aborts an in-flight scope on logout and ignores responses that arrive afterwards", async () => {
    await render()
    const previous = requests.slice()
    state.sessionPresent = false
    state.status = "unauthenticated"
    await render()
    expect(previous.every((request) => request.options.signal!.aborted)).toBe(true)
    await settle(previous, 99)
    expect(container.querySelector('[data-testid="dashboard-data"]')).toBeNull()
    expect(state.renderedDeals).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("ends the loading state when all requests hit their bounded timeout", async () => {
    vi.useFakeTimers()
    honorRequestAbort = true
    await render()
    expectBatch(requests, true)
    await act(async () => { await vi.advanceTimersByTimeAsync(11999) })
    expect(container.querySelector(".dashboard-welcome--loading")).not.toBeNull()
    expect(requests.every((request) => !request.options.signal!.aborted)).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(requests.every((request) => request.options.signal!.aborted)).toBe(true)
    expectLoaded(0)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("retains successful dashboard data after a slower optional request times out", async () => {
    vi.useFakeTimers()
    honorRequestAbort = true
    await render()
    await settle(requests.filter((request) => request.url !== LOYALTY), 80)
    // Preserve the existing all-responses loading policy in this narrow fix.
    expect(container.querySelector(".dashboard-welcome--loading")).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
    expectLoaded(80)
    expect(requests.find((request) => request.url === LOYALTY)?.options.signal?.aborted).toBe(true)
    expect(requests.filter((request) => request.url !== LOYALTY).every((request) => !request.options.signal!.aborted)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("aborts all pending requests when the dashboard unmounts", async () => {
    await render()
    const initial = requests.slice()
    expectBatch(initial, true)
    await act(async () => { root!.unmount(); root = null })
    expect(initial.every((request) => request.options.signal!.aborted)).toBe(true)
    await settle(initial, 88)
    expect(container.textContent).toBe("")
    expect(state.renderedDeals).toEqual([])
  })
})
