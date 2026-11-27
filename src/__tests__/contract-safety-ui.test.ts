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
// The real hook keeps its functions for the component's life (the form's open effect depends on them).
const currencyField = vi.hoisted(() => ({ setCurrency: () => {}, resetCurrency: () => {} }))
vi.mock("@/lib/use-org-default-currency", () => ({
  useCurrencyField: (initial?: string | null) => ({ currency: initial || "AZN", ...currencyField }),
}))

import { ContractForm } from "@/components/contract-form"

/**
 * «Опасные места» in the contract's «Изменить» form (owner 2026-11-26, mock, «Давай»): the warning
 * before an approved contract goes back to draft, the lock on a signed contract's terms for anyone
 * but an administrator, and the taken number in words. React in jsdom; the server is `fetch`.
 */
let container: HTMLDivElement
let root: Root
const puts: Array<Record<string, unknown>> = []
let replies: Array<{ status: number; json: unknown }> = []

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  puts.length = 0
  replies = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)))
      const reply = replies.shift() ?? { status: 200, json: { success: true } }
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.json } as Response
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) } as Response
  }))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const field = (id: string) => container.querySelector(`#${id}`) as HTMLInputElement
const contract = (over: Record<string, unknown> = {}) => ({
  id: "ctr-1", contractNumber: "DG-1", title: "Müqavilə", companyId: "", dealId: "", contactId: "", type: "service_agreement",
  status: "approved", startDate: "2026-01-01", endDate: "2026-12-31", valueAmount: "120000", currency: "AZN", notes: "", signedAt: null, ...over,
})
async function open(initialData: Record<string, unknown>, isAdmin = false) {
  const onSaved = vi.fn()
  await act(async () => root.render(createElement(ContractForm, { open: true, onOpenChange: vi.fn(), onSaved, initialData, isAdmin } as never)))
  await flush()
  return onSaved
}
async function type(id: string, value: string) {
  const input = field(id)
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
}
async function save() {
  await act(async () => { (container.querySelector("form") as HTMLFormElement).requestSubmit() })
  await flush()
}

describe("an approved contract", () => {
  it("asks before it goes back to draft, then saves with the consent", async () => {
    replies = [{ status: 409, json: { code: "REAPPROVAL_REQUIRED", fields: ["valueAmount"] } }]
    const onSaved = await open(contract())
    await type("valueAmount", "125000")
    await save()
    expect(puts).toHaveLength(1)
    expect(puts[0].confirmReapproval).toBeUndefined()
    expect(q("contract-reapproval-warning")?.textContent).toContain("safety.reapprovalWarning")
    expect(onSaved).not.toHaveBeenCalled()

    await act(async () => q("contract-reapproval-confirm")!.click())
    await flush()
    expect(puts).toHaveLength(2)
    expect(puts[1]).toMatchObject({ valueAmount: 125000, confirmReapproval: true })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it("its terms are not locked: it is not signed", async () => {
    await open(contract())
    expect(field("valueAmount").disabled).toBe(false)
    expect(q("contract-terms-locked")).toBeNull()
  })
})

describe("a signed contract", () => {
  it("locks the amount, currency and dates for anyone but an administrator, and says why", async () => {
    await open(contract({ status: "active", signedAt: "2026-01-01T00:00:00.000Z" }))
    for (const id of ["valueAmount", "startDate", "endDate"]) expect(field(id).disabled).toBe(true)
    expect(q("contract-terms-locked")?.textContent).toContain("safety.signedLocked")
    expect(field("title").disabled).toBe(false)
  })
  it("an administrator may change them", async () => {
    await open(contract({ status: "active", signedAt: "2026-01-01T00:00:00.000Z" }), true)
    expect(field("valueAmount").disabled).toBe(false)
    expect(q("contract-terms-locked")).toBeNull()
  })
})

it("a taken number is said in words", async () => {
  replies = [{ status: 409, json: { code: "CONTRACT_NUMBER_TAKEN" } }]
  await open(contract({ status: "draft" }))
  await type("contractNumber", "DG-7")
  await save()
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('safety.numberTaken{"number":"DG-7"}')
})
