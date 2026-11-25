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

import { PortalContractView, PortalDocumentsHome } from "@/components/portal/portal-documents"

/**
 * «Sənədlər» in the client portal, as the counterparty sees it: what waits
 * for their signature, the company's contracts, one contract's chain with its
 * PDFs, and «İmzala» opening the signing page. React in jsdom; the server is `fetch`.
 */
let container: HTMLDivElement
let root: Root
const sent: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
let responses: Record<string, { status?: number; body: unknown }> = {}
const assign = vi.fn()

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  sent.length = 0
  responses = {}
  assign.mockReset()
  vi.stubGlobal("location", { ...window.location, assign })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      const reply = responses[`${method} ${url.split("?")[0]}`] ?? { status: 404, body: {} }
      const status = reply.status ?? 200
      return { ok: status < 400, status, json: async () => reply.body } as Response
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
const show = async (el: ReturnType<typeof createElement>) => { await act(async () => root.render(el)); await flush() }

const waiting = {
  signerId: "s-farid", envelopeId: "env-1", contractId: "c1", contractNumber: "AS/1",
  title: "QİYMƏT RAZILAŞDIRMA PROTOKOLU — AS/1", kind: "price_protocol", number: 2, sentAt: "2026-12-01T09:00:00Z", canSignNow: true,
}

describe("the cabinet's first page", () => {
  it("puts what waits for a signature first, and «İmzala» opens the signing page", async () => {
    responses["GET /api/v1/public/portal-documents"] = {
      body: { success: true, data: { waiting: [waiting, { ...waiting, signerId: "s-later", canSignNow: false }], contracts: [{ id: "c1", contractNumber: "AS/1", title: "Alğı-satqı", status: "active", startDate: "2026-01-01T00:00:00Z", endDate: null, signed: true }] } },
    }
    responses["POST /api/v1/public/portal-documents/sign"] = { body: { success: true, data: { url: "/sign/tok-1" } } }
    await show(createElement(PortalDocumentsHome))
    const box = q("portal-documents-waiting")!
    expect(box.textContent).toContain("QİYMƏT RAZILAŞDIRMA PROTOKOLU — AS/1")
    expect(box.textContent).toContain('waitingMeta{"number":"AS/1","date":"01.12.2026"}')
    expect(q("portal-sign-s-later")).toBeNull() // an earlier signer has not signed yet
    expect(box.textContent).toContain("waitingTurn")
    expect(q("portal-documents")!.textContent).toContain("contractStatus_active")
    await act(async () => q("portal-sign-s-farid")!.click())
    await flush()
    expect(sent.find((s) => s.method === "POST")?.body).toEqual({ signerId: "s-farid" })
    expect(assign).toHaveBeenCalledWith("/sign/tok-1")
  })

  it("says the link expired instead of opening a dead page", async () => {
    responses["GET /api/v1/public/portal-documents"] = { body: { success: true, data: { waiting: [waiting], contracts: [] } } }
    responses["POST /api/v1/public/portal-documents/sign"] = { status: 410, body: { success: false, code: "EXPIRED" } }
    await show(createElement(PortalDocumentsHome))
    await act(async () => q("portal-sign-s-farid")!.click())
    await flush()
    expect(assign).not.toHaveBeenCalled()
    expect(q("portal-documents")!.textContent).toContain("errExpired")
  })

  it("a contact without «Sənədlər» sees why, not an empty cabinet", async () => {
    responses["GET /api/v1/public/portal-documents"] = { status: 403, body: { success: false, code: "DOCUMENTS_DISABLED" } }
    await show(createElement(PortalDocumentsHome))
    expect(q("portal-documents-error")!.textContent).toBe("errNoAccess")
  })
})

describe("one contract's chain", () => {
  it("shows the four links with their PDFs; signed ones as the signed copy", async () => {
    responses["GET /api/v1/public/portal-documents/c1"] = {
      body: {
        success: true,
        data: {
          contract: { id: "c1", contractNumber: "AS/1", title: "Alğı-satqı", status: "active", startDate: null, endDate: null, signedAt: "2026-11-01T00:00:00Z", currency: "AZN", hasSignedCopy: true },
          documents: [
            { id: "pp-1", kind: "price_protocol", number: 1, status: "signed", documentDate: "2026-11-02", validFrom: null, validTo: null, totalAmount: 100, currency: "AZN", invoice: null },
            { id: "act-1", kind: "acceptance_act", number: 1, status: "in_signing", documentDate: "2026-11-20", validFrom: null, validTo: null, totalAmount: 100, currency: "AZN", invoice: { invoiceNumber: "INV-7" } },
          ],
          invoices: [{ id: "inv-7", invoiceNumber: "INV-7", status: "sent", totalAmount: 1250.5, currency: "AZN", issueDate: "2026-11-10", url: "/portal/invoice/tok7" }],
          waiting: [],
        },
      },
    }
    await show(createElement(PortalContractView, { contractId: "c1" }))
    expect(q("portal-contract-signed-pdf")!.getAttribute("href")).toMatch(/^\/api\/v1\/public\/portal-documents\/c1\/pdf\?lang=ru&download=1&signed=1&tz=/)
    const protocolPdf = q("portal-chain-protocols")!.querySelector("a")!.getAttribute("href")!
    expect(protocolPdf).toContain("doc=pp-1")
    expect(protocolPdf).toContain("signed=1")
    const actPdf = q("portal-chain-acts")!.querySelector("a")!.getAttribute("href")!
    expect(actPdf).toContain("doc=act-1")
    expect(actPdf).not.toContain("signed=1") // not signed yet: the document as it is
    expect(q("portal-chain-acts")!.textContent).toContain("INV-7")
    const invoice = q("portal-chain-invoices")!.querySelector("a")!
    expect(invoice.getAttribute("href")).toBe("/portal/invoice/tok7")
    expect(q("portal-chain-invoices")!.textContent).toContain("invoiceStatus_sent")
  })

  it("another company's contract is «not found»", async () => {
    responses["GET /api/v1/public/portal-documents/c-x"] = { status: 404, body: { success: false } }
    await show(createElement(PortalContractView, { contractId: "c-x" }))
    expect(container.textContent).toBe("notFound")
  })
})
