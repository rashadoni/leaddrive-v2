// @vitest-environment jsdom
// «Maliyyə icmalı → İcmal» fell over for every organization: since 2026-10-07
// /api/finance/dashboard sends the expense plan as null (there is none), and
// the summary called null.toLocaleString(). Found on production 2026-10-26.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const { default: messages } = await import("../../messages/az.json")
  const translators = new Map<string, unknown>()
  return {
    ...actual,
    useLocale: () => "az",
    useTranslations: (namespace: string) => {
      if (!translators.has(namespace)) {
        translators.set(namespace, actual.createTranslator({ locale: "az", messages: messages as never, namespace: namespace as never }))
      }
      return translators.get(namespace)
    },
  }
})
vi.mock("@/lib/finance/hooks", () => ({
  useFinanceDashboard: () => ({ isLoading: false, error: null, data: {
    year: 2026, dateFrom: null, dateTo: null,
    kpis: {
      revenue: { label: "Revenue", plan: 1000, fact: 800, variance: -200, variancePct: -20 },
      // As production sends it: no expense plan.
      expenses: { label: "Expenses", plan: null, fact: 300, variance: null, variancePct: null },
      netProfit: { fact: 500, prevMonth: 0, changePct: 0 },
      cashBalance: { current: 1200, projected: 1250 },
      arTotal: { amount: 400, overdueAmount: 0, overdueCount: 0 },
      apTotal: { amount: 100, overdueAmount: 0, overdueCount: 0 },
    },
    revenueTrend: [], expenseBreakdown: [], arAging: [], alerts: [],
  } }),
}))
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<object>()
  const Box = ({ children }: { children?: unknown }) => createElement("div", null, children as never)
  return { ...actual, ResponsiveContainer: Box }
})

// The organisation's currency comes from the server, as in the browser: the
// session names the organisation, /api/v1/organization/default-currency answers.
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { organizationId: "org-1" } }, status: "authenticated" }) }))

import { FinanceDashboard } from "@/components/finance/finance-dashboard"

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).includes("/api/v1/organization/default-currency")
      ? new Response(JSON.stringify({ success: true, data: { defaultCurrency: "AZN" } }), { status: 200 })
      : new Response("{}", { status: 404 })))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("finance overview without an expense plan", () => {
  it("renders, with a dash for the missing plan and the real figures around it", async () => {
    await act(async () => { root.render(createElement(FinanceDashboard)) })
    const text = container.textContent ?? ""
    expect(text).toContain("—")
    expect(text).toContain("1,000") // the revenue plan still shows
    expect(text).toContain("300")   // and the expenses actually spent
  })

  it("shows amounts in the organisation's currency, not the browser build's USD", async () => {
    await act(async () => { root.render(createElement(FinanceDashboard)) })
    await act(async () => {}) // the currency answer arrives
    const text = container.textContent ?? ""
    expect(text).toContain("AZN")
    expect(text).toContain("₼")
    expect(text).not.toContain("USD")
    expect(text).not.toContain("$")
  })
})
