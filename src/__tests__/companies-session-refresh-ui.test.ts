// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  session: {
    iat: 1,
    user: { id: "synthetic-user-a", organizationId: "synthetic-org-a", role: "manager" },
  },
  onSaved: undefined as (() => void | Promise<void>) | undefined,
  t: (key: string) => key,
}))

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.session, status: "authenticated" }) }))
vi.mock("next-intl", () => ({ useTranslations: () => state.t }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("lucide-react", () => ({
  Building2: () => null, Plus: () => null, Search: () => null, Users: () => null,
  FileText: () => null, TrendingUp: () => null, ArrowUpDown: () => null,
  Pencil: () => null, Trash2: () => null, CheckSquare: () => null, Square: () => null,
}))

// Keep the actual page's hooks, requests and card text. Children with their own
// data loading or browser integrations are outside this request-lifecycle test.
vi.mock("@/components/company-form", () => ({
  CompanyForm: ({ onSaved }: { onSaved: () => void | Promise<void> }) => {
    state.onSaved = onSaved
    return null
  },
}))
vi.mock("@/components/lead-detail-modal", () => ({ LeadDetailModal: () => null }))
vi.mock("@/components/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }))
vi.mock("@/components/saved-view-bar", () => ({ SavedViewBar: () => null }))
vi.mock("@/components/tasks/inline-tasks-table", () => ({ InlineSelectCell: () => null }))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => {} }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/did-you-know", () => ({ DidYouKnow: () => null }))
vi.mock("@/components/page-description", () => ({ PageDescription: () => null }))
vi.mock("@/components/color-stat-card", () => ({ ColorStatCard: () => null }))
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title }: { title: ReactNode }) => createElement("header", null, title),
}))
vi.mock("@/components/entity-bulk-bar", () => ({
  EntityBulkBar: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}))
vi.mock("@/components/ui/motion", () => ({
  MotionList: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  MotionItem: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}))
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => createElement("article", null, children),
  CardContent: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => createElement("button", null, children),
}))
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => createElement("span", null, children),
}))
vi.mock("@/components/ui/input", () => ({ Input: () => null }))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => createElement("select", null, children),
}))

import CompaniesPage from "@/app/(dashboard)/companies/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LIST_URL = "/api/v1/companies?category=client&limit=500"
const fetchMock = vi.fn<typeof fetch>()
let container: HTMLDivElement
let root: Root

function response(name: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        companies: [{ id: "synthetic-company", name, status: "active", leadScore: 0, userCount: 0 }],
        total: 1,
        totalUsers: 0,
        totalContacts: 0,
      },
    }),
  } as Response
}

function deferredResponse() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

async function render() {
  await act(async () => { root.render(createElement(CompaniesPage)) })
}

async function settle(request: ReturnType<typeof deferredResponse>, name: string) {
  await act(async () => { request.resolve(response(name)) })
}

function requestOptions(index: number): RequestInit {
  expect(fetchMock.mock.calls[index]?.[0]).toBe(LIST_URL)
  return fetchMock.mock.calls[index][1]!
}

beforeEach(() => {
  state.session = {
    iat: 1,
    user: { id: "synthetic-user-a", organizationId: "synthetic-org-a", role: "manager" },
  }
  state.onSaved = undefined
  fetchMock.mockReset().mockResolvedValue(response("Synthetic initial company"))
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("companies session refresh", () => {
  it("keeps one GET when Auth.js replaces an unchanged identity, while pending and after completion", async () => {
    const initial = deferredResponse()
    fetchMock.mockReturnValueOnce(initial.promise)
    await render()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const signal = requestOptions(0).signal!

    state.session = { ...state.session, iat: 2, user: { ...state.session.user } }
    await render()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(false)

    await settle(initial, "Synthetic initial company")
    expect(container.textContent).toContain("Synthetic initial company")
    state.session = { ...state.session, iat: 3, user: { ...state.session.user } }
    await render()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(false)
  })

  it.each([
    ["user", { id: "synthetic-user-b" }],
    ["organization", { organizationId: "synthetic-org-b" }],
    ["role", { role: "viewer" }],
  ] as const)("reloads for a changed %s and ignores a late response from its previous scope", async (_kind, change) => {
    const previous = deferredResponse()
    const next = deferredResponse()
    fetchMock.mockReturnValueOnce(previous.promise).mockReturnValueOnce(next.promise)
    await render()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const previousSignal = requestOptions(0).signal!

    state.session = { ...state.session, user: { ...state.session.user, ...change } }
    await render()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(previousSignal.aborted).toBe(true)
    expect(requestOptions(1).signal?.aborted).toBe(false)
    expect(new Headers(requestOptions(1).headers).get("x-organization-id"))
      .toBe(state.session.user.organizationId)

    await settle(next, "Synthetic replacement company")
    expect(container.textContent).toContain("Synthetic replacement company")
    // The mock deliberately resolves despite abort, to cover a response that
    // finishes parsing after cleanup as well as transports that ignore signals.
    await settle(previous, "Synthetic previous company")
    expect(container.textContent).toContain("Synthetic replacement company")
    expect(container.textContent).not.toContain("Synthetic previous company")
  })

  it("still refreshes after the company form reports a successful save", async () => {
    await render()
    expect(container.textContent).toContain("Synthetic initial company")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.onSaved).toBeTypeOf("function")

    fetchMock.mockResolvedValueOnce(response("Synthetic saved company"))
    await act(async () => { await state.onSaved!() })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requestOptions(1).signal).toBeUndefined()
    expect(container.textContent).toContain("Synthetic saved company")
    expect(container.textContent).not.toContain("Synthetic initial company")
  })
})
