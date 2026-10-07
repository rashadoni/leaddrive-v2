// @vitest-environment jsdom
/**
 * The payment-orders table draws only the actions the signed-in role can
 * actually take.
 *
 * The finance screens do not show a refused request: a mutation that fails
 * simply does nothing. When the server started refusing by role (2026-10-07),
 * that would have left a manager with a delete button that does not delete and
 * a viewer with an "Approve" that does not approve. The component is rendered
 * for real here, with the real Russian copy and the real role matrix; only the
 * network and the session are stubbed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
function message(namespace: string | undefined, key: string): string | undefined {
  let node: string | Messages | undefined = ru
  for (const part of [...(namespace ? namespace.split(".") : []), ...key.split(".")]) {
    node = typeof node === "object" ? node[part] : undefined
  }
  return typeof node === "string" ? node : undefined
}
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) =>
      (message(namespace, key) ?? `${namespace}.${key}`).replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
    t.has = (key: string) => message(namespace, key) !== undefined
    return t
  },
  useLocale: () => "ru",
}))

const session = {
  data: { user: { id: "u-1", organizationId: "org-1", role: "admin" } },
  status: "authenticated",
}
const searchParams = new URLSearchParams()
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/finance",
}))
vi.mock("@/components/ai/advisor-record-widget", () => ({ AdvisorRecordWidget: () => null }))

import { PaymentsDashboard } from "@/components/finance/payments-dashboard"

const order = (id: string, status: string, createdBy: string | null = "u-someone-else") => ({
  id, orderNumber: id, counterpartyName: "Acme", amount: 100, currency: "AZN",
  purpose: "Rent", paymentMethod: "bank_transfer", status, createdBy, createdAt: "2026-10-01T10:00:00Z",
})
// The signed-in person is "u-1" (see `session`): PO-OWN is the order they raised.
const ORDERS = [
  order("PO-DRAFT", "draft"),
  order("PO-PENDING", "pending_approval"),
  order("PO-OWN", "pending_approval", "u-1"),
  order("PO-APPROVED", "approved"),
]

let root: Root
let container: HTMLDivElement

const label = (key: string) => message("finance.pod", key)!

/** order number → the labels of the buttons drawn in its row ("🗑" for the icon-only delete). */
function actions(): Record<string, string[]> {
  const rows = [...container.querySelectorAll("tbody tr")]
  return Object.fromEntries(rows.map((row) => {
    const number = ORDERS.find((o) => row.textContent?.includes(o.id))?.id ?? "?"
    const buttons = [...row.querySelectorAll("button")].map((button) => button.textContent?.trim() || "🗑")
    return [number, buttons]
  }))
}
const rowText = (orderNumber: string) =>
  [...container.querySelectorAll("tbody tr")].find((row) => row.textContent?.includes(orderNumber))?.textContent ?? ""
const hasButton = (text: string) => [...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === text)

async function render(role: string) {
  session.data.user.role = role
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(PaymentsDashboard)))
  })
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.startsWith("/api/finance/payment-orders") ? { data: ORDERS }
      : url.startsWith("/api/finance/registry") ? { data: [], stats: {}, total: 0, page: 1, limit: 50 }
      : { data: [] }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("payment orders — actions by role", () => {
  it("an administrator has every action", async () => {
    await render("admin")

    expect(hasButton(label("newOrder"))).toBe(true)
    expect(actions()).toEqual({
      "PO-DRAFT": [label("edit"), label("submit"), "🗑"],
      "PO-PENDING": [label("approveBtn"), label("rejectBtn")],
      // An administrator approves their own order too.
      "PO-OWN": [label("approveBtn"), label("rejectBtn")],
      "PO-APPROVED": [label("executeBtn")],
    })
    expect(rowText("PO-OWN")).not.toContain(label("awaitsAnotherApprover"))
  })

  it("a manager runs the orders and is not offered a delete the server would refuse", async () => {
    await render("manager")

    expect(hasButton(label("newOrder"))).toBe(true)
    expect(actions()).toEqual({
      "PO-DRAFT": [label("edit"), label("submit")],
      "PO-PENDING": [label("approveBtn"), label("rejectBtn")],
      // Their own order: no "Approve", and the row says why in words. They can
      // still take it back.
      "PO-OWN": [label("rejectBtn")],
      "PO-APPROVED": [label("executeBtn")],
    })
    expect(rowText("PO-OWN")).toContain(label("awaitsAnotherApprover"))
    expect(rowText("PO-PENDING")).not.toContain(label("awaitsAnotherApprover"))
  })

  it("a viewer reads the orders and is offered nothing to press", async () => {
    await render("viewer")

    expect(hasButton(label("newOrder"))).toBe(false)
    expect(actions()).toEqual({ "PO-DRAFT": [], "PO-PENDING": [], "PO-OWN": [], "PO-APPROVED": [] })
  })
})
