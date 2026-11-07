// @vitest-environment jsdom

/**
 * The contacts screen asks the server for each page and each search (2026-11-07).
 *
 * It used to load `?limit=500` once and filter in the browser — a contact past
 * the first 500 could not be found. These tests drive the real page with the
 * network stubbed and check the requests it makes: one per pause in typing,
 * one per page turned, and that «select all found» reaches every match and
 * hands the bulk endpoint no more than the 100 ids it accepts per call.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  session: { user: { id: "synthetic-user", organizationId: "synthetic-org", role: "admin" } },
}))

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.session, status: "authenticated" }) }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))
vi.mock("@/lib/status-labels", () => ({ useCategoryLabel: () => (value: string) => value }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("lucide-react", () => Object.fromEntries(
  ["Users", "Plus", "Mail", "Phone", "Pencil", "Trash2", "Search", "ChevronLeft", "ChevronRight",
    "CheckSquare", "Square", "MinusSquare", "Upload", "BarChart3"].map((name) => [name, () => null]),
))
vi.mock("@/components/csv-import-dialog", () => ({ CsvImportDialog: () => null }))
vi.mock("@/components/contact-form", () => ({ ContactForm: () => null }))
vi.mock("@/components/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => Promise<void> }) =>
    open ? createElement("button", { "data-testid": "confirm-bulk", onClick: () => { void onConfirm() } }, "confirm") : null,
}))
vi.mock("@/components/tasks/inline-tasks-table", () => ({
  InlineTitleCell: ({ value }: { value: string }) => createElement("span", null, value),
  InlineTextCell: () => null,
  InlineSelectCell: () => null,
  InlineBooleanCell: () => null,
}))
vi.mock("@/components/entity-bulk-bar", () => ({
  EntityBulkBar: ({ children, selectedCount }: { children: ReactNode; selectedCount: number }) =>
    selectedCount > 0 ? createElement("div", { "data-testid": "bulk-bar" }, children) : null,
}))
vi.mock("@/components/saved-view-bar", () => ({ SavedViewBar: () => null }))
vi.mock("@/components/info-hint", () => ({ InfoHint: () => null }))
vi.mock("@/components/page-description", () => ({ PageDescription: () => null }))
vi.mock("@/components/did-you-know", () => ({ DidYouKnow: () => null }))
vi.mock("@/components/color-stat-card", () => ({
  ColorStatCard: ({ label, value }: { label: string; value: ReactNode }) => createElement("div", null, `${label}=${value}`),
}))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => {} }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title }: { title: ReactNode }) => createElement("header", null, title),
}))

import ContactsPage from "@/app/(dashboard)/contacts/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fetchMock = vi.fn<typeof fetch>()
let container: HTMLDivElement
let root: Root

const TOTAL = 250

function listResponse(page: number) {
  const rows = Array.from({ length: 20 }, (_, i) => {
    const n = (page - 1) * 20 + i + 1
    return {
      id: `c${n}`, fullName: `Synthetic ${String(n).padStart(3, "0")}`, email: null, phone: null, position: null,
      source: null, brand: null, category: null, companyId: null, isActive: true, portalAccessEnabled: false,
      company: null, engagementScore: 0,
    }
  })
  return {
    success: true,
    data: {
      contacts: rows, total: TOTAL, page, limit: 20,
      stats: { total: 900, active: 800, withEmail: 700, withPhone: 600, hot: 1, warm: 2, cold: 897 },
    },
  }
}

function respond(url: string): Response {
  const u = new URL(url, "http://localhost")
  let body: unknown
  if (u.pathname === "/api/v1/contacts/bulk") body = { success: true }
  else if (u.searchParams.get("idsOnly") === "1") body = { success: true, data: { ids: Array.from({ length: TOTAL }, (_, i) => `c${i + 1}`), capped: false } }
  else body = listResponse(Number(u.searchParams.get("page") || "1"))
  return { ok: true, status: 200, json: async () => body } as Response
}

const listRequests = () =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), "http://localhost"))
    .filter((u) => u.pathname === "/api/v1/contacts" && u.searchParams.get("idsOnly") !== "1")

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

beforeEach(async () => {
  vi.useFakeTimers()
  fetchMock.mockReset().mockImplementation(async (input) => respond(String(input)))
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(ContactsPage)) })
  await flush()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("contacts list on the server", () => {
  it("asks for one page of the list view on mount and prints the book's counters", () => {
    const requests = listRequests()
    expect(requests).toHaveLength(1)
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ view: "list", sort: "name_asc", page: "1", limit: "20" })
    expect(container.textContent).toContain("Synthetic 001")
    expect(container.textContent).toContain("statTotal=900")
    expect(container.textContent).toContain("statWithPhone=600")
  })

  it("sends a search once the typing pauses, not per keystroke, from the first page", async () => {
    const input = container.querySelector("input[placeholder='searchPlaceholder']") as HTMLInputElement
    for (const partial of ["B", "Ba", "Bak", "Bakı"]) {
      await act(async () => { typeInto(input, partial) })
      await act(async () => { vi.advanceTimersByTime(100) })
    }
    expect(listRequests()).toHaveLength(1)

    await act(async () => { vi.advanceTimersByTime(300) })
    await flush()
    const requests = listRequests()
    expect(requests).toHaveLength(2)
    expect(requests[1].searchParams.get("search")).toBe("Bakı")
    expect(requests[1].searchParams.get("page")).toBe("1")
  })

  it("turns the page on the server", async () => {
    const next = container.querySelector("button[aria-label=nextPage]") as HTMLButtonElement
    await act(async () => { next.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    await flush()
    const requests = listRequests()
    expect(requests.at(-1)!.searchParams.get("page")).toBe("2")
    expect(container.textContent).toContain("Synthetic 021")
    expect(container.textContent).toContain(`pageOf:${JSON.stringify({ current: 2, total: Math.ceil(TOTAL / 20) })}`)
  })

  it("selects every match, not only the page, and sends the bulk action in calls of at most 100", async () => {
    // Tick one row so the bulk bar (and its «select all N») appears.
    const rowBox = container.querySelector("tbody tr td button") as HTMLButtonElement
    await act(async () => { rowBox.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    const selectAll = [...container.querySelectorAll("[data-testid=bulk-bar] button")]
      .find((b) => b.textContent?.startsWith("selectAll")) as HTMLButtonElement
    expect(selectAll.textContent).toBe(`selectAll:${JSON.stringify({ count: TOTAL })}`)
    await act(async () => { selectAll.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    await flush()

    const deleteButton = [...container.querySelectorAll("[data-testid=bulk-bar] button")]
      .find((b) => b.textContent?.includes("deleteSelected")) as HTMLButtonElement
    expect(deleteButton.textContent).toContain(`"count":${TOTAL}`)
    await act(async () => { deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    const confirm = container.querySelector("[data-testid=confirm-bulk]") as HTMLButtonElement
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    await flush()
    await flush()

    const bulkBodies = fetchMock.mock.calls
      .filter(([input]) => String(input) === "/api/v1/contacts/bulk")
      .map(([, init]) => JSON.parse(String(init!.body)) as { ids: string[]; action: string })
    expect(bulkBodies.map((b) => b.ids.length)).toEqual([100, 100, 50])
    expect(new Set(bulkBodies.flatMap((b) => b.ids)).size).toBe(TOTAL)
    expect(bulkBodies.every((b) => b.action === "delete")).toBe(true)
  })
})
