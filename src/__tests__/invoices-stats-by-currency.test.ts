// @vitest-environment jsdom
/**
 * The cards, tiles and payment bar at the top of the Invoices page never add
 * one currency to another.
 *
 * Until 2026-09-22 GET /api/v1/invoices/stats summed totalAmount, paidAmount
 * and balanceDue over every invoice and labelled the sum with the default
 * currency (AZN on prod): a USD-only organisation read «1 082 600 AZN», one
 * billing in USD and EUR read «493 245 AZN». Three of the four organisations
 * that invoice on prod bill in more than one currency.
 *
 * The page is rendered for real, and its requests are answered by the real
 * route handlers over mocked rows — so the check fails on the old route and
 * page together, as it would have on screen.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findMany: vi.fn(), count: vi.fn() },
    invoicePayment: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn() }))
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
  useLocale: () => "en",
}))
// Stable objects: the page re-fetches whenever `session` changes identity.
const session = { data: { user: { organizationId: "org-1" } }, status: "authenticated" }
const router = { push: vi.fn(), replace: vi.fn() }
const searchParams = new URLSearchParams()
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => searchParams }))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined, useTour: () => ({}) }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/did-you-know", () => ({ DidYouKnow: () => null }))

import InvoicesPage from "@/app/(dashboard)/invoices/page"
import { TooltipProvider } from "@/components/ui/tooltip"
import { GET as STATS } from "@/app/api/v1/invoices/stats/route"
import { GET as LIST } from "@/app/api/v1/invoices/route"
import { invoiceStats, type InvoiceStatsRow } from "@/lib/invoices/stats"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"

const ORG = "org-1"
const NOW = new Date(2026, 8, 22, 10)

/** Any written form of 1 500: "1500", "1,500", "1 500", "1.500". */
const FIFTEEN_HUNDRED = /(?<![\d.,])1[,.\s  ]?500(?!\d)/

function stat(overrides: Partial<InvoiceStatsRow>): InvoiceStatsRow {
  return {
    status: "sent",
    totalAmount: 1000,
    paidAmount: 0,
    balanceDue: 1000,
    currency: "AZN",
    issueDate: new Date(2026, 8, 10),
    createdAt: new Date(2026, 8, 10),
    ...overrides,
  }
}

describe("invoice stats, per currency", () => {
  it("never adds 1 000 AZN and 500 USD into 1 500", () => {
    const stats = invoiceStats(
      [stat({}), stat({ currency: "USD", totalAmount: 500, balanceDue: 500 })],
      NOW,
      "AZN",
    )
    expect(stats.money.invoiced).toEqual([
      { currency: "AZN", value: 1000, count: 1 },
      { currency: "USD", value: 500, count: 1 },
    ])
    expect(stats.money.outstanding.map((b) => [b.currency, b.value])).toEqual([["AZN", 1000], ["USD", 500]])
    // The old single-number fields stay in one currency, for pages loaded before this change.
    expect(stats).toMatchObject({ currency: "AZN", totalInvoiced: 1000, totalOutstanding: 1000, avgAmount: 1000 })
    expect(JSON.stringify(stats)).not.toMatch(/1500/)
  })

  it("counts drafts, cancelled and refunded invoices as before, and bills none of them", () => {
    const stats = invoiceStats(
      [
        stat({ status: "sent", totalAmount: 1000 }),
        stat({ status: "draft", totalAmount: 2000, balanceDue: 2000 }),
        stat({ status: "cancelled", totalAmount: 400, balanceDue: 400 }),
        stat({ status: "refunded", totalAmount: 300, paidAmount: 300, balanceDue: 0 }),
      ],
      NOW,
      "AZN",
    )
    expect(stats).toMatchObject({ totalCount: 4, draftCount: 1, cancelledCount: 1, sentCount: 1, thisMonthCount: 4, thisYearCount: 4 })
    expect(stats.money.invoiced).toEqual([{ currency: "AZN", value: 1000, count: 1 }])
    expect(stats.money.thisMonth).toEqual([{ currency: "AZN", value: 1000, count: 1 }])
    expect(stats.money.paid).toEqual([])
    expect(stats.money.outstanding).toEqual([{ currency: "AZN", value: 1000, count: 1 }])
  })

  it("counts an invoice marked paid in full, a partial one by what was paid", () => {
    const stats = invoiceStats(
      [
        stat({ status: "paid", totalAmount: 900, paidAmount: 0, balanceDue: 0 }),
        stat({ status: "partially_paid", totalAmount: 1000, paidAmount: 250, balanceDue: 750 }),
      ],
      NOW,
      "AZN",
    )
    expect(stats.money.paid).toEqual([{ currency: "AZN", value: 1150, count: 2 }])
    expect(stats.money.outstanding).toEqual([{ currency: "AZN", value: 750, count: 1 }])
  })

  it("keeps overdue balances in their own currency", () => {
    const stats = invoiceStats(
      [
        stat({ status: "overdue", currency: "USD", totalAmount: 700, balanceDue: 700 }),
        stat({ status: "overdue", currency: "EUR", totalAmount: 640, balanceDue: 640 }),
        stat({ status: "sent", totalAmount: 5000, balanceDue: 5000 }),
      ],
      NOW,
      "AZN",
    )
    expect(stats.money.overdue.map((b) => [b.currency, b.value])).toEqual([["USD", 700], ["EUR", 640]])
    // The legacy field is in AZN, the currency with the most invoiced — and AZN has nothing overdue.
    expect(stats).toMatchObject({ currency: "AZN", totalOverdue: 0 })
  })

  it("shows an organisation with no invoices a zero in its default currency", () => {
    const stats = invoiceStats([], NOW, "azn")
    expect(stats.currency).toBe("AZN")
    expect(Object.values(stats.money).every((list) => list.length === 0)).toBe(true)
    expect(stats.totalInvoiced).toBe(0)
  })
})

// ── The page, as rendered ───────────────────────────────────────────

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const dec = (v: number) => ({ toNumber: () => v, toString: () => `${v}.0000` })

/** An invoice row as Prisma returns it: Decimal(18,4) money. */
function prismaRow(id: string, currency: string, amount: number) {
  return {
    id,
    organizationId: ORG,
    invoiceNumber: `INV-${id}`,
    title: "Xidmət",
    status: "sent",
    currency,
    subtotal: dec(amount),
    discountValue: dec(0),
    discountAmount: dec(0),
    taxAmount: dec(0),
    totalAmount: dec(amount),
    paidAmount: dec(0),
    balanceDue: dec(amount),
    issueDate: new Date(),
    dueDate: new Date(Date.now() + 20 * 86_400_000),
    createdAt: new Date(),
    items: [],
    company: null,
    recurringInvoiceId: null,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getSession).mockResolvedValue(null as never)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

/** The page inside the provider (dashboard)/layout.tsx mounts around every dashboard page. */
async function renderPage() {
  await act(async () => {
    root.render(createElement(TooltipProvider, null, createElement(InvoicesPage)))
  })
  await settle()
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

describe("Invoices page, for an organisation billing 1 000 AZN and 500 USD", () => {
  beforeEach(() => {
    const rows = [prismaRow("a", "AZN", 1000), prismaRow("b", "USD", 500)]
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(rows as never)
    vi.mocked(prisma.invoice.count).mockResolvedValue(rows.length as never)
    vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([] as never)
    // The page's requests go to the real route handlers.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost")
        if (url.pathname === "/api/v1/invoices/stats") return STATS(new Request(url) as never)
        if (url.pathname === "/api/v1/invoices") return LIST(new Request(url) as never)
        if (url.pathname === "/api/v1/recurring-invoices") return new Response(JSON.stringify({ success: true, data: [] }))
        return new Response(JSON.stringify({ error: "unexpected " + url.pathname }), { status: 404 })
      }),
    )
  })

  it("the stats route answers per currency", async () => {
    const res = await STATS(new Request("http://localhost/api/v1/invoices/stats") as never)
    const json = await res.json()
    expect(json.data.money.invoiced).toEqual([
      { currency: "AZN", value: 1000, count: 1 },
      { currency: "USD", value: 500, count: 1 },
    ])
    expect(JSON.stringify(json)).not.toMatch(/1500/)
  })

  it("shows the manat and the dollars apart on the cards, and 1 500 nowhere", async () => {
    await renderPage()
    const text = container.textContent ?? ""
    // formatBucket groups thousands in the runtime's locale.
    expect(text).toMatch(/1[,\s  ]?000 ₼/)
    expect(text).toContain("+ 500 $ · 1")
    expect(text).not.toMatch(FIFTEEN_HUNDRED)
  })

  it("keeps the tiles and the payment bar per currency on the Analytics tab", async () => {
    await renderPage()
    const tab = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "analytics")
    expect(tab, "Analytics tab button").toBeTruthy()
    await act(async () => {
      tab!.click()
    })
    await settle()
    const text = container.textContent ?? ""
    expect(text).not.toMatch(FIFTEEN_HUNDRED)
    const bar = container.querySelector('[data-testid="invoices-payment-progress"]')?.textContent ?? ""
    expect(bar).toMatch(/1[,\s  ]?000\.00 AZN/)
    expect(bar).toMatch(/USD: 0\.00 \/ 500\.00 · 0%/)
  })
})
