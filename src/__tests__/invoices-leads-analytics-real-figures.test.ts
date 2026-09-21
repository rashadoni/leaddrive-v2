// @vitest-environment jsdom
/**
 * Invoices → «Analitika» and Leads → «Analitika» show only what the
 * organisation's records say.
 *
 * Found 2026-09-21. The invoices tab drew «Weekly collection» with
 * Math.random, listed three companies that exist nowhere under «Auto-invoices»
 * and added AZN, USD, EUR and PLN into single figures. The leads tab's «Top
 * leads» ring printed the score × 0.85 as a conversion probability. On prod
 * that day three of the four invoicing organisations billed in more than one
 * currency, 17 of 25 paid invoices had no recorded payment, and not one of the
 * 106 open leads carried a probability any model had produced.
 *
 * The rendered checks fail on the old components. The calculations are checked
 * on records shaped the way the API returns them.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
  useLocale: () => "en",
}))

import { InvoicesAnalytics } from "@/components/invoices/invoices-analytics"
import { LeadsAnalytics } from "@/components/leads/leads-analytics"
import { modelConversionProbability } from "@/lib/leads/conversion-probability"
import {
  averageDaysToPay,
  billingByCurrency,
  changeOnPrevious,
  monthlyAverage,
  monthlyBilled,
  paidWithoutRecordedPayment,
  receivablesAging,
  recurringSummary,
  startOfWeek,
  weeklyCollections,
  type InvoiceAnalyticsRecord,
  type RecurringRuleRecord,
} from "@/lib/invoices/analytics"

/** A local wall-clock moment as the ISO string the API sends. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString()

// Monday 21 September 2026, 10:00 local: the week runs 21–27 September.
const NOW = new Date(2026, 8, 21, 10)

let seq = 0
function invoice(overrides: Partial<InvoiceAnalyticsRecord>): InvoiceAnalyticsRecord {
  seq++
  return {
    id: `inv-${seq}`,
    status: "sent",
    amount: 1000,
    paidAmount: 0,
    currency: "AZN",
    issueDate: at(2026, 8, 1),
    dueDate: at(2026, 9, 1),
    createdAt: at(2026, 8, 1),
    payments: [],
    ...overrides,
  }
}

const pay = (amount: number, paymentDate: string, currency = "AZN") => ({ amount, currency, paymentDate })

describe("weekly collection, from recorded payments", () => {
  it("puts each payment in the week it was paid, per currency, and never adds currencies", () => {
    const weekly = weeklyCollections(
      [
        invoice({ status: "paid", payments: [pay(1200, at(2026, 8, 15)), pay(300.5, at(2026, 8, 21, 9))] }),
        invoice({ status: "partially_paid", paidAmount: 800, payments: [pay(800, at(2026, 7, 4))] }),
        invoice({ status: "paid", currency: "USD", amount: 950, payments: [pay(950, at(2026, 8, 16), "USD")] }),
        // Before the eight-week window.
        invoice({ status: "paid", amount: 5000, payments: [pay(5000, at(2026, 6, 20))] }),
      ],
      NOW,
    )
    expect(weekly.weeks.map((w) => [w.getMonth(), w.getDate()])).toEqual([
      [7, 3], [7, 10], [7, 17], [7, 24], [7, 31], [8, 7], [8, 14], [8, 21],
    ])
    expect(weekly.byCurrency.map((s) => s.currency)).toEqual(["AZN", "USD"])
    expect(weekly.byCurrency[0]).toMatchObject({ total: 2300.5, count: 3, values: [800, 0, 0, 0, 0, 0, 1200, 300.5] })
    expect(weekly.byCurrency[1]).toMatchObject({ total: 950, count: 1, values: [0, 0, 0, 0, 0, 0, 950, 0] })
  })

  it("draws nothing for an organisation whose paid invoices have no recorded payment — and says how many", () => {
    const invoices = [
      invoice({ status: "paid", amount: 4200, paidAmount: 4200, payments: [] }),
      invoice({ status: "paid", amount: 900, paidAmount: 0, payments: [] }),
      invoice({ status: "overdue", payments: [] }),
    ]
    expect(weeklyCollections(invoices, NOW).byCurrency).toEqual([])
    expect(paidWithoutRecordedPayment(invoices)).toBe(2)
    // Rows loaded without their payments say nothing either way.
    expect(paidWithoutRecordedPayment([invoice({ status: "paid", payments: undefined })])).toBe(0)
  })

  it("starts weeks on Monday in the viewer's calendar", () => {
    expect(startOfWeek(new Date(2026, 8, 27, 23, 59))).toEqual(new Date(2026, 8, 21))
    expect(startOfWeek(new Date(2026, 8, 21, 0, 0))).toEqual(new Date(2026, 8, 21))
  })
})

describe("billing, receivables and payment speed", () => {
  const billedInvoices = [
    invoice({ status: "sent", amount: 1000, issueDate: at(2026, 8, 3) }),
    invoice({ status: "paid", amount: 500, issueDate: at(2026, 7, 10) }),
    invoice({ status: "overdue", currency: "USD", amount: 700, issueDate: at(2026, 8, 5) }),
    invoice({ status: "sent", amount: 300, issueDate: null, createdAt: at(2026, 8, 7) }),
    // Bill nobody.
    invoice({ status: "draft", amount: 9999, issueDate: at(2026, 8, 1) }),
    invoice({ status: "cancelled", amount: 4000, issueDate: at(2026, 8, 2) }),
    invoice({ status: "refunded", amount: 250, issueDate: at(2026, 8, 2) }),
    // Outside the twelve months.
    invoice({ status: "paid", amount: 100, issueDate: at(2025, 8, 30) }),
  ]

  it("counts issued invoices per month and currency — not drafts, cancelled or refunded ones", () => {
    const billed = monthlyBilled(billedInvoices, NOW)
    expect(billed.months[0]).toEqual({ year: 2025, month: 9 })
    expect(billed.months[11]).toEqual({ year: 2026, month: 8 })
    expect(billed.byCurrency.map((s) => s.currency)).toEqual(["AZN", "USD"])
    const azn = billed.byCurrency[0]
    expect(azn.values.slice(10)).toEqual([500, 1300])
    expect(azn.total).toBe(1800)
    expect(billed.byCurrency[1].values[11]).toBe(700)
    expect(changeOnPrevious(azn.values)).toBeCloseTo(160, 6)
    // Two months billed, not twelve: 1800 / 2.
    expect(monthlyAverage(azn)).toEqual({ value: 900, months: 2 })
  })

  it("gives no month-on-month change when the month before billed nothing", () => {
    expect(changeOnPrevious([0, 0, 5000])).toBeNull()
    expect(changeOnPrevious([5000])).toBeNull()
  })

  it("ages what customers still owe, per currency", () => {
    const aging = receivablesAging(
      [
        invoice({ status: "overdue", amount: 1000, dueDate: at(2026, 7, 1) }), // 50 days late
        invoice({ status: "sent", amount: 400, dueDate: at(2026, 9, 1) }), // not due yet
        invoice({ status: "partially_paid", amount: 1000, paidAmount: 600, dueDate: at(2026, 8, 10) }), // 10 days
        invoice({ status: "overdue", currency: "USD", amount: 300, dueDate: at(2026, 0, 1) }), // 262 days
        invoice({ status: "paid", amount: 777, dueDate: at(2026, 7, 1) }),
        invoice({ status: "draft", amount: 888, dueDate: at(2026, 7, 1) }),
        invoice({ status: "cancelled", amount: 999, dueDate: at(2026, 7, 1) }),
      ],
      NOW,
    )
    expect(aging.map((s) => [s.currency, s.total, s.values])).toEqual([
      ["AZN", 1800, [400, 400, 1000, 0, 0]],
      ["USD", 300, [0, 0, 0, 0, 300]],
    ])
  })

  it("rates collection per currency, and a paid status is the whole amount", () => {
    const standing = billingByCurrency([
      invoice({ status: "paid", amount: 1000, paidAmount: 0 }),
      invoice({ status: "partially_paid", amount: 1000, paidAmount: 250 }),
      invoice({ status: "draft", amount: 500 }),
      invoice({ status: "overdue", currency: "USD", amount: 400 }),
      invoice({ status: "sent", currency: "EUR", amount: 0 }),
    ])
    expect(standing).toEqual([
      { currency: "AZN", billed: 2000, paid: 1250, outstanding: 750, count: 2, percent: 62.5 },
      { currency: "USD", billed: 400, paid: 0, outstanding: 400, count: 1, percent: 0 },
      { currency: "EUR", billed: 0, paid: 0, outstanding: 0, count: 1, percent: null },
    ])
  })

  it("averages days to pay only over invoices whose recorded payments settle them", () => {
    const days = averageDaysToPay([
      invoice({ status: "paid", issueDate: at(2026, 8, 1), payments: [pay(500, at(2026, 8, 5)), pay(500, at(2026, 8, 11))] }),
      invoice({ status: "paid", issueDate: at(2026, 7, 1), payments: [pay(1000, at(2026, 7, 21))] }),
      // Marked paid by hand, outright and after a partial payment: no record of when.
      invoice({ status: "paid", issueDate: at(2026, 5, 1), payments: [] }),
      invoice({ status: "paid", issueDate: at(2026, 5, 1), payments: [pay(300, at(2026, 5, 3))] }),
    ])
    expect(days).toEqual({ days: 15, count: 2 })
    expect(averageDaysToPay([invoice({ status: "paid", payments: [] })])).toBeNull()
  })
})

describe("recurring rules", () => {
  const rules: RecurringRuleRecord[] = [
    {
      id: "r1", title: "Aylıq xidmət haqqı", frequency: "monthly", intervalCount: 1, isActive: true,
      nextRunDate: at(2026, 9, 1), currency: "AZN", taxRate: 0.18, includeVat: true,
      items: [{ quantity: 2, unitPrice: 1000, discount: 10 }],
    },
    {
      id: "r2", title: "Rüblük dəstək", frequency: "quarterly", intervalCount: 1, isActive: true,
      nextRunDate: at(2026, 8, 25), currency: "USD", taxRate: 0, includeVat: false,
      items: [{ quantity: 1, unitPrice: 500, discount: 0 }],
    },
    {
      id: "r3", title: "Dayandırılıb", frequency: "monthly", isActive: false,
      nextRunDate: at(2026, 8, 22), currency: "AZN", items: [{ quantity: 1, unitPrice: 50 }],
    },
  ]

  it("lists active rules, soonest first, with the amount the generator will bill", () => {
    const summary = recurringSummary(rules)
    expect(summary.active).toBe(2)
    expect(summary.upcoming.map((r) => [r.id, r.amount, r.currency])).toEqual([
      ["r2", 500, "USD"],
      // 2 × 1000 − 10% = 1800, plus 18% VAT.
      ["r1", 2124, "AZN"],
    ])
  })
})

describe("conversion probability", () => {
  it("is a model's own estimate or nothing", () => {
    // What the scoring cron writes (src/lib/ai/lead-scoring.ts): factors, no probability.
    expect(modelConversionProbability({ factors: { contactCompleteness: 64, engagementLevel: 40 } })).toBeNull()
    // Da Vinci's rule-based fallback used to store score × 0.85.
    expect(modelConversionProbability({ conversionProb: 77, aiPowered: false })).toBeNull()
    expect(modelConversionProbability({ conversionProb: 77 })).toBeNull()
    expect(modelConversionProbability({ conversionProb: 64, aiPowered: true })).toBe(64)
    expect(modelConversionProbability({ conversionProb: "64", aiPowered: true })).toBeNull()
    expect(modelConversionProbability({ conversionProb: 140, aiPowered: true })).toBeNull()
    expect(modelConversionProbability(null)).toBeNull()
    expect(modelConversionProbability([])).toBeNull()
  })
})

// ── Rendered ────────────────────────────────────────────────────────

// Tells React this is a test environment, so act() does not warn on every render.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function settle() {
  // fetch → res.json() → setState: let every pending promise settle.
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function widget(id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  expect(el, `widget "${id}" is not rendered`).not.toBeNull()
  return el!
}

describe("Invoices → Analitika as rendered", () => {
  function serveRules(rules: RecurringRuleRecord[] | "fail") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (rules === "fail" || !url.startsWith("/api/v1/recurring-invoices")) {
          return new Response(JSON.stringify({ error: "nope" }), { status: 500 })
        }
        return new Response(JSON.stringify({ success: true, data: rules }), { status: 200 })
      }),
    )
  }

  async function renderTab(invoices: InvoiceAnalyticsRecord[], total?: number) {
    await act(async () => {
      root.render(createElement(InvoicesAnalytics, { invoices, total, orgId: "org-1" }))
    })
    await settle()
  }

  /** Heights of the weekly bars, as drawn. */
  function weeklyBarHeights(): string[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="invoices-analytics-weekly"] [style*="height"]'),
    ).map((bar) => bar.style.height)
  }

  it("shows no weekly bar and no invented recurring invoice for an organisation with no paid invoices", async () => {
    serveRules([])
    await renderTab([
      invoice({ status: "sent", amount: 1500 }),
      invoice({ status: "overdue", amount: 2300, dueDate: at(2026, 6, 1) }),
    ])
    expect(weeklyBarHeights().filter((h) => h !== "0%")).toEqual([])
    expect(widget("invoices-analytics-weekly").textContent).toContain("noPaymentsInWeeks")
    expect(container.textContent).not.toMatch(/TechCorp|DataFlow|CloudNet/)
    expect(widget("invoices-analytics-recurring").textContent).toContain("noRecurringRules")
    expect(widget("invoices-analytics-days-to-pay").textContent).toContain("—")
    expect(widget("invoices-analytics-collection-rate").textContent).toContain("0%")
  })

  it("names the invoices marked paid without a recorded payment instead of drawing them", async () => {
    serveRules([])
    await renderTab([invoice({ status: "paid", amount: 4200, paidAmount: 4200, payments: [] })])
    expect(weeklyBarHeights().filter((h) => h !== "0%")).toEqual([])
    expect(widget("invoices-analytics-weekly").textContent).toContain('paidWithoutPayment{"count":1}')
  })

  it("draws a bar only for weeks with recorded payments, in the largest currency, and lists the other", async () => {
    serveRules([])
    const monday = startOfWeek(new Date())
    const inWeek = (weeksBack: number) => {
      const d = new Date(monday)
      d.setDate(d.getDate() - weeksBack * 7)
      d.setHours(1)
      return d.toISOString()
    }
    await renderTab([
      invoice({ status: "paid", amount: 1200, payments: [pay(1200, inWeek(0))] }),
      invoice({ status: "paid", amount: 800, payments: [pay(800, inWeek(3))] }),
      invoice({ status: "paid", currency: "USD", amount: 950, payments: [pay(950, inWeek(1), "USD")] }),
    ])
    const heights = weeklyBarHeights()
    expect(heights).toHaveLength(8)
    expect(heights.map((h) => h !== "0%")).toEqual([false, false, false, false, true, false, false, true])
    const text = widget("invoices-analytics-weekly").textContent ?? ""
    // formatBucket groups thousands in the runtime's locale.
    expect(text).toMatch(/2[,\s\u00a0\u202f]?000 ₼/)
    expect(text).toContain("+ 950 $ · 1")
    // Never one number for two currencies.
    expect(text).not.toMatch(/2[,\s\u00a0\u202f]?950/)
  })

  it("lists the organisation's own recurring rules, with the amount they bill", async () => {
    serveRules([
      {
        id: "r1", title: "Aylıq xidmət haqqı", frequency: "monthly", intervalCount: 1, isActive: true,
        nextRunDate: at(2026, 9, 1), currency: "AZN", taxRate: 0.18, includeVat: true,
        items: [{ quantity: 2, unitPrice: 1000, discount: 10 }],
      },
      { id: "r2", title: "Dayandırılıb", frequency: "monthly", isActive: false, currency: "AZN", items: [] },
    ])
    await renderTab([])
    const text = widget("invoices-analytics-recurring").textContent ?? ""
    expect(text).toContain("Aylıq xidmət haqqı")
    expect(text).toContain("₼2.1K")
    expect(text).toContain('activeRules{"count":1}')
    expect(text).not.toContain("Dayandırılıb")
  })

  it("says the recurring rules could not be loaded instead of listing any", async () => {
    serveRules("fail")
    await renderTab([])
    expect(widget("invoices-analytics-recurring").textContent).toContain("dataUnavailable")
    expect(container.textContent).not.toMatch(/TechCorp|DataFlow|CloudNet/)
  })

  it("keeps receivables in their own currencies", async () => {
    serveRules([])
    await renderTab([
      invoice({ status: "overdue", amount: 1000, dueDate: at(2026, 0, 10) }),
      invoice({ status: "overdue", currency: "USD", amount: 600, dueDate: at(2026, 0, 10) }),
    ])
    const text = widget("invoices-analytics-aging").textContent ?? ""
    expect(text).toContain("₼1.0K")
    expect(text).toContain("+ 600 $ · 1")
    expect(text).not.toContain("1.6K")
  })

  it("says when the figures cover only the latest invoices", async () => {
    serveRules([])
    await renderTab([invoice({})], 750)
    expect(container.textContent).toContain('analyticsBasedOnLatest{"count":1,"total":750}')
  })
})

describe("Leads → Analitika, «Top leads» as rendered", () => {
  const labels = new Proxy({} as Record<string, string>, { get: (_, key) => String(key) })

  function lead(id: string, score: number, scoreDetails: unknown) {
    return {
      id, contactName: `Lead ${id}`, companyName: null, email: null, phone: null, source: "website",
      status: "qualified", priority: "medium", score, scoreDetails, estimatedValue: null,
      createdAt: new Date().toISOString(),
    }
  }

  async function renderTab(leads: ReturnType<typeof lead>[]) {
    await act(async () => {
      root.render(createElement(LeadsAnalytics, { leads, labels: labels as never }))
    })
  }

  /** The text inside each «Top leads» ring — the 36-px circle that starts every row. */
  function rings(): string[] {
    return Array.from(container.querySelectorAll("div.relative.h-9")).map((ring) => ring.textContent ?? "")
  }

  it("shows «—», never a percentage, for leads no model estimated", async () => {
    // What the scoring cron leaves on every open lead: factors, no probability.
    const cron = { factors: { contactCompleteness: 64, engagementLevel: 40, dealPotential: 24, sourceQuality: 0, recency: 67 } }
    await renderTab([lead("a", 90, cron), lead("b", 70, cron), lead("c", 50, {})])
    expect(rings()).toEqual(["—", "—", "—"])
    // The old ring: 90 × 0.85, 70 × 0.85, 50 × 0.85.
    expect(container.textContent).not.toMatch(/77%|60%|43%/)
  })

  it("prints the probability only where Da Vinci's model produced one", async () => {
    await renderTab([
      lead("a", 88, { conversionProb: 64, aiPowered: true }),
      lead("b", 81, { conversionProb: 69, aiPowered: false }),
    ])
    expect(rings()).toEqual(["64%", "—"])
  })
})
