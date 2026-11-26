// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}${JSON.stringify(values)}` : key)
    translate.has = () => true
    return translate
  },
}))

import { ContractMoneySummary } from "@/components/contracts/contract-money-summary"
import { contractMoney } from "@/lib/clm/contract-money"
import { readHint } from "./helpers/hint"

/**
 * «Деньги по договору» on the contract card (owner 2026-11-26, mock, «Давай»):
 * the four figures, what is overdue, what is left to invoice, an invoice beyond
 * the value and one in another currency — on the server's own arithmetic.
 */
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const now = new Date("2026-11-26T10:00:00Z")
const inv = (status: string, total: number, paid = 0, extra: Record<string, unknown> = {}) => ({
  status, totalAmount: total, paidAmount: paid, balanceDue: total - paid, currency: "AZN", dueDate: "2026-12-20T00:00:00Z", ...extra,
})
const render = (money: ReturnType<typeof contractMoney>) => act(async () => root.render(createElement(ContractMoneySummary, { money })))

describe("«Деньги по договору»", () => {
  it("shows the mock's figures and says what each one is", async () => {
    await render(contractMoney({ valueAmount: 120_000, currency: "AZN" }, [
      inv("paid", 40_000, 40_000), inv("partially_paid", 25_000, 20_000),
      inv("overdue", 15_000), inv("draft", 10_000), inv("cancelled", 99_000),
    ], now))
    expect(q("money-value")?.textContent).toBe("moneyValue120 000,00 AZN")
    expect(q("money-invoiced")?.textContent).toBe('moneyInvoiced80 000,00 AZNmoneyInvoicedCount{"count":3} · moneyDrafts{"amount":"10 000,00 AZN"}')
    expect(q("money-paid")?.textContent).toBe("moneyPaid60 000,00 AZN")
    expect(q("money-debt")?.textContent).toBe('moneyDebt20 000,00 AZNmoneyOverdue{"amount":"15 000,00 AZN"}')
    expect(q("money-remaining")?.textContent).toBe('moneyRemaining{"amount":"30 000,00 AZN"}')
    expect(q("money-over")).toBeNull()
    expect(await readHint(q("money-invoiced"))).toBe("moneyInvoicedHint")
    expect(await readHint(q("money-debt"))).toBe("moneyDebtHint")
  })

  it("says when invoices go beyond the value, and lists another currency apart", async () => {
    await render(contractMoney({ valueAmount: 50_000, currency: "AZN" }, [
      inv("sent", 40_000), inv("draft", 15_000), inv("sent", 900, 0, { currency: "USD" }),
    ], now))
    expect(q("money-remaining")?.textContent).toBe('moneyRemaining{"amount":"0,00 AZN"}')
    expect(q("money-over")?.textContent).toBe('moneyOver{"amount":"5 000,00 AZN"}')
    expect(q("money-other-USD")?.textContent).toBe('moneyOther{"currency":"USD","invoiced":"900,00 USD","paid":"0,00 USD","debt":"900,00 USD"}')
  })

  it("without a value, says what is left cannot be counted", async () => {
    await render(contractMoney({ valueAmount: null, currency: "AZN" }, [inv("sent", 1_000)], now))
    expect(q("money-value")?.textContent).toBe("moneyValue—")
    expect(q("money-remaining")?.textContent).toBe("moneyNoValue")
  })
})
