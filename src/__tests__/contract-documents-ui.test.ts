// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }))
vi.mock("next-intl", () => ({
  useLocale: () => "az",
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}${JSON.stringify(values)}` : key)
    translate.has = () => true
    return translate
  },
}))

import { ContractDocumentsChain } from "@/components/contracts/contract-documents-chain"
import { ContractDocumentEditor } from "@/components/contracts/contract-document-editor"
import { InvoiceProtocolCheck } from "@/components/contracts/invoice-protocol-check"
import { readHint } from "./helpers/hint"

/**
 * The contract's document chain as the owner's mock has it (2026-11-25): the
 * chain in the contract card, a protocol's page, and the invoice's warning
 * about a price off the protocol. Real React in jsdom; the server is `fetch`.
 */
let container: HTMLDivElement
let root: Root
const sent: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
let responses: Record<string, unknown> = {}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  sent.length = 0
  push.mockReset()
  responses = {}
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      sent.push({ url, method, body })
      const reply = responses[`${method} ${url.split("?")[0]}`]
      if (reply === undefined) return { ok: false, status: 404, json: async () => ({}) } as Response
      return { ok: true, status: 200, json: async () => reply } as Response
    }),
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) })
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const click = async (el: Element | null) => { await act(async () => (el as HTMLElement).click()); await flush() }
const setValue = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

const chainData = (over: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    contract: { status: "active", signedAt: "2026-11-25T10:00:00Z" },
    documents: [],
    activeProtocol: null,
    invoices: [],
    ...over,
  },
})

describe("the document chain in the contract card", () => {
  it("lights the missing protocol and makes one from the button that says so", async () => {
    responses["GET /api/v1/contracts/ctr-1/documents"] = chainData()
    responses["POST /api/v1/contracts/ctr-1/documents"] = { success: true, data: { id: "pp-1" } }
    await act(async () => root.render(createElement(ContractDocumentsChain, { contractId: "ctr-1", canWrite: true, canInvoice: true })))
    await flush()
    expect(q("chain-contract")?.textContent).toContain("status_signed")
    expect(q("chain-protocol")?.className).toContain("border-primary")
    const make = q("chain-make-protocol")!
    expect(make.textContent).toContain("makeProtocol")
    expect(await readHint(make.closest("span") ?? make)).toBe("makeProtocolHint")
    await click(make)
    expect(sent.find((s) => s.method === "POST")?.body).toEqual({ kind: "price_protocol" })
    expect(push).toHaveBeenCalledWith("/contracts/ctr-1/documents/pp-1")
  })

  it("shows each invoice with its act, and makes the missing act from the invoice", async () => {
    responses["GET /api/v1/contracts/ctr-1/documents"] = chainData({
      documents: [{ id: "pp-1", kind: "price_protocol", number: 1, status: "signed", documentDate: "2026-11-25T00:00:00Z", validFrom: "2026-11-25T00:00:00Z", validTo: null, invoiceId: null, currency: "AZN", totalAmount: 0, invoice: null }],
      activeProtocol: { id: "pp-1", number: 1, signed: true },
      invoices: [
        { id: "inv-1", invoiceNumber: "INV-1", status: "sent", totalAmount: 45312, currency: "AZN", act: { id: "act-1", status: "draft" } },
        { id: "inv-2", invoiceNumber: "INV-2", status: "draft", totalAmount: 100, currency: "AZN", act: null },
      ],
    })
    responses["POST /api/v1/contracts/ctr-1/documents"] = { success: true, data: { id: "act-2" } }
    await act(async () => root.render(createElement(ContractDocumentsChain, { contractId: "ctr-1", canWrite: true, canInvoice: true })))
    await flush()
    expect(q("chain-acts")?.textContent).toContain('actCount{"done":1,"total":2}')
    expect(q("chain-make-act-inv-1")).toBeNull()
    expect(container.textContent).toContain("45 312,00 AZN")
    await click(q("chain-make-act-inv-2"))
    expect(sent.find((s) => s.method === "POST")?.body).toEqual({ kind: "acceptance_act", invoiceId: "inv-2" })
    expect(push).toHaveBeenCalledWith("/contracts/ctr-1/documents/act-2")
  })

  it("someone who may not write sees the chain without the buttons", async () => {
    responses["GET /api/v1/contracts/ctr-1/documents"] = chainData()
    await act(async () => root.render(createElement(ContractDocumentsChain, { contractId: "ctr-1", canWrite: false, canInvoice: false })))
    await flush()
    expect(q("contract-documents-chain")).not.toBeNull()
    expect(q("chain-make-protocol")).toBeNull()
    expect(q("chain-make-invoice")).toBeNull()
  })
})

const protocolDoc = (status = "draft") => ({
  success: true,
  data: {
    id: "pp-1", kind: "price_protocol", number: 1, status, documentDate: "2026-11-25T00:00:00Z", validFrom: "2026-11-25T00:00:00Z", validTo: "2027-11-24T00:00:00Z",
    currency: "AZN", vatRate: 0.18, note: null, invoice: null,
    contract: { id: "ctr-1", contractNumber: "AS/2026-0775", title: "Alğı-satqı" },
    lines: [{ productId: "p-palet", name: "Taxta palet", unit: "ədəd", quantity: 400, unitPrice: 96 }],
  },
})

describe("a protocol's page", () => {
  it("edits a draft's lines, shows the totals with VAT, and saves them all at once", async () => {
    responses["GET /api/v1/contracts/ctr-1/documents/pp-1"] = protocolDoc()
    responses["PUT /api/v1/contracts/ctr-1/documents/pp-1"] = { success: true, data: {} }
    await act(async () => root.render(createElement(ContractDocumentEditor, { contractId: "ctr-1", docId: "pp-1" })))
    await flush()
    expect(q("document-totals")?.textContent).toContain("38 400,00 AZN")
    expect(q("document-totals")?.textContent).toContain("45 312,00 AZN")

    await click(q("add-line"))
    const rows = container.querySelectorAll('[data-testid="document-lines"] tbody tr')
    const last = rows[rows.length - 1]
    const [name, unit, , price] = [...last.querySelectorAll("input")] as HTMLInputElement[]
    await setValue(name, "Çatdırılma")
    await setValue(unit, "reys")
    await setValue(price, "60")
    await click(q("document-save"))

    const put = sent.find((s) => s.method === "PUT")!
    expect(put.body).toMatchObject({
      documentDate: "2026-11-25",
      validFrom: "2026-11-25",
      validTo: "2027-11-24",
      vatRate: 0.18,
      lines: [
        { productId: "p-palet", name: "Taxta palet", unit: "ədəd", quantity: 400, unitPrice: 96 },
        { productId: null, name: "Çatdırılma", unit: "reys", quantity: null, unitPrice: 60 },
      ],
    })
    expect(container.textContent).toContain("saved")
  })

  it("only reads once it left the draft", async () => {
    responses["GET /api/v1/contracts/ctr-1/documents/pp-1"] = protocolDoc("signed")
    await act(async () => root.render(createElement(ContractDocumentEditor, { contractId: "ctr-1", docId: "pp-1" })))
    await flush()
    expect(q("document-status")?.textContent).toBe("status_signed")
    expect(q("document-save")).toBeNull()
    expect(q("add-line")).toBeNull()
    expect([...container.querySelectorAll('[data-testid="document-lines"] input')].every((i) => (i as HTMLInputElement).disabled)).toBe(true)
    expect(q("document-pdf")).not.toBeNull()
  })
})

describe("the invoice's warning about a price off the protocol", () => {
  it("names the line and both prices, and records the reason", async () => {
    responses["GET /api/v1/contracts/ctr-1/documents"] = chainData({
      activeProtocol: { id: "pp-1", number: 1, signed: true, lines: [{ productId: null, name: "Çatdırılma", unit: "reys", quantity: null, unitPrice: 60 }] },
    })
    responses["POST /api/v1/invoices/inv-1/protocol-deviation"] = { success: true }
    const onRecorded = vi.fn()
    await act(async () =>
      root.render(createElement(InvoiceProtocolCheck, { invoiceId: "inv-1", contractId: "ctr-1", items: [{ productId: null, name: "Çatdırılma", unitPrice: 75 }], onRecorded })),
    )
    await flush()
    const banner = q("invoice-protocol-deviation")!
    expect(banner.textContent).toContain('deviationLine{"name":"Çatdırılma","invoice":"75,00","protocol":"60,00"}')
    await setValue(banner.querySelector("input")!, "Gecə çatdırılması")
    await click(q("invoice-deviation-save"))
    expect(sent.find((s) => s.method === "POST")?.body).toEqual({ reason: "Gecə çatdırılması" })
    expect(onRecorded).toHaveBeenCalled()
  })

  it("draws nothing when the prices match the protocol", async () => {
    responses["GET /api/v1/contracts/ctr-1/documents"] = chainData({
      activeProtocol: { id: "pp-1", number: 1, signed: true, lines: [{ productId: null, name: "Çatdırılma", unit: null, quantity: null, unitPrice: 60 }] },
    })
    await act(async () => root.render(createElement(InvoiceProtocolCheck, { invoiceId: "inv-1", contractId: "ctr-1", items: [{ name: "Çatdırılma", unitPrice: 60 }] })))
    await flush()
    expect(q("invoice-protocol-deviation")).toBeNull()
  })
})
