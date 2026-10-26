// @vitest-environment jsdom
// The Fund screen as approved on 2026-10-26: the switch «Баланс из CRM /
// Kafka» only where the Kafka pilot runs and only for those who run the funds,
// the source under every balance, and «CRM» as the one press back.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"

const state = vi.hoisted(() => ({
  source: { available: true, source: "kafka" as "crm" | "kafka" },
  canWrite: true,
  mutate: vi.fn(),
}))

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const { default: messages } = await import("../../messages/ru.json")
  const translators = new Map<string, unknown>()
  return {
    ...actual,
    useLocale: () => "ru",
    useTranslations: (namespace: string) => {
      if (!translators.has(namespace)) {
        translators.set(namespace, actual.createTranslator({ locale: "ru", messages: messages as never, namespace: namespace as never }))
      }
      return translators.get(namespace)
    },
  }
})

vi.mock("@/lib/finance/hooks", () => {
  const idle = () => ({ mutate: vi.fn(), isPending: false })
  return {
    useFunds: () => ({ isLoading: false, data: [
      { id: "f-1", name: "Резервный фонд", currency: "AZN", currentBalance: 30000, isActive: true, createdAt: "", balanceSource: "kafka" },
      { id: "f-2", name: "Налоги", currency: "AZN", currentBalance: 5500, isActive: true, createdAt: "", balanceSource: "kafka-catching-up" },
      { id: "f-3", name: "Старый", currency: "AZN", currentBalance: 10, isActive: true, createdAt: "", balanceSource: "crm" },
    ] }),
    useFinanceDashboard: () => ({ data: undefined }),
    useFinanceAccess: () => ({ canWrite: state.canWrite, canDelete: false }),
    useFundBalanceSource: () => ({ data: state.source }),
    useSetFundBalanceSource: () => ({ mutate: state.mutate, isPending: false }),
    useCreateFund: idle, useDeleteFund: idle, useCreateFundTransaction: idle, useCreateFundRule: idle, useDeleteFundRule: idle,
    useFundTransactions: () => ({ data: [] }), useFundRules: () => ({ data: [] }),
  }
})
vi.mock("@/lib/constants", async (importOriginal) => ({ ...(await importOriginal<object>()), getCurrencySymbol: () => "₼" }))

import { FundManager } from "@/components/finance/fund-manager"

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  state.source = { available: true, source: "kafka" }
  state.canWrite = true
  state.mutate.mockReset()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

const render = () => act(async () => { root.render(createElement(FundManager)) })
const switchButton = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("[role=group] button")].find(b => b.textContent === label)

describe("Fund screen: balance from CRM or Kafka", () => {
  it("shows the switch on Kafka, the notice and the source under every balance", async () => {
    await render()
    expect(container.textContent).toContain("Баланс из")
    expect(switchButton("Kafka")?.getAttribute("aria-pressed")).toBe("true")
    expect(switchButton("CRM")?.getAttribute("aria-pressed")).toBe("false")
    expect(container.textContent).toContain("Балансы считаются из событий Kafka")
    expect(container.textContent).toContain("из Kafka")
    expect(container.textContent).toContain("из CRM — Kafka ещё догоняет")
    expect(container.textContent).toContain("из CRM — в Kafka нет истории")
  })

  it("«CRM» is the one press back", async () => {
    await render()
    await act(async () => { switchButton("CRM")!.click() })
    expect(state.mutate).toHaveBeenCalledWith("crm")
    await act(async () => { switchButton("Kafka")!.click() })
    expect(state.mutate).toHaveBeenCalledTimes(1) // pressing the active side does nothing
  })

  it("on CRM: no notice and no source labels", async () => {
    state.source = { available: true, source: "crm" }
    await render()
    expect(switchButton("CRM")?.getAttribute("aria-pressed")).toBe("true")
    expect(container.textContent).not.toContain("Балансы считаются из событий Kafka")
    expect(container.textContent).not.toContain("из Kafka")
  })

  it("no switch where there is no Kafka pilot, nor for those who only read", async () => {
    state.source = { available: false, source: "crm" }
    await render()
    expect(container.textContent).not.toContain("Баланс из")
    await act(async () => { root.unmount() })
    root = createRoot(container)
    state.source = { available: true, source: "kafka" }
    state.canWrite = false
    await render()
    expect(container.querySelector("[role=group]")).toBeNull()
    expect(container.textContent).toContain("из Kafka") // the reader still sees where the number comes from
  })
})
