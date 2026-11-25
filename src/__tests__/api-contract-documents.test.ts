/**
 * The routes of a contract's documents (price protocols, acceptance acts) and
 * the invoice's «why is this price off the protocol» record. What is written
 * and what is refused: a protocol takes the deal's lines or the previous
 * protocol's; an act is only for an invoice of this contract, once; only a
 * draft is edited or cancelled, checked again under the write; a product of
 * another organisation is not linked. Prisma and the session are stand-ins.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    contractDocument: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    contractDocumentLine: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    dealLineItem: { findMany: vi.fn() },
    invoice: { findFirst: vi.fn(), findMany: vi.fn() },
    product: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  logAudit: vi.fn(),
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v: unknown) => v instanceof NextResponse),
}))
vi.mock("@/lib/permissions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/permissions")>()
  return { ...real, checkPermission: vi.fn(() => true) }
})

import { GET as listDocs, POST as createDoc } from "@/app/api/v1/contracts/[id]/documents/route"
import { PUT as putDoc, DELETE as deleteDoc } from "@/app/api/v1/contracts/[id]/documents/[docId]/route"
import { POST as recordDeviation } from "@/app/api/v1/invoices/[id]/protocol-deviation/route"
import { prisma, logAudit } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { checkPermission } from "@/lib/permissions"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any
const ORG = "org-1"
const C = "ctr-1"

const contract = {
  id: C,
  contractNumber: "AS/2026-0775",
  title: "Alğı-satqı müqaviləsi",
  status: "active",
  currency: "AZN",
  dealId: "deal-1",
  companyId: "co-1",
  endDate: new Date("2027-11-24T00:00:00Z"),
  signedAt: new Date("2026-11-25T10:00:00Z"),
  createdAt: new Date("2026-11-20T10:00:00Z"),
  company: { name: "Kaspi Logistika MMC", director: "F. Qəhrəmanov" },
}

const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost:3000${url}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
const params = { params: Promise.resolve({ id: C }) }
const docParams = { params: Promise.resolve({ id: C, docId: "doc-1" }) }

let tx: Record<string, Record<string, ReturnType<typeof vi.fn>>>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "user-1", role: "manager", email: "m@x.az", name: "M" } as never)
  vi.mocked(checkPermission).mockReturnValue(true)
  db.contract.findFirst.mockResolvedValue(contract)
  db.organization.findUnique.mockResolvedValue({ name: "Org", settings: { invoice: { companyName: "Nümunə MMC", defaultTaxRate: 0.18 } } })
  db.contractDocument.findFirst.mockResolvedValue(null)
  db.contractDocument.findMany.mockResolvedValue([])
  db.contractDocumentLine.findMany.mockResolvedValue([])
  db.dealLineItem.findMany.mockResolvedValue([
    { productId: "p-palet", name: "Taxta palet", quantity: "400", unitPrice: "100", discountPct: "4", product: { unit: "ədəd" } },
  ])
  db.product.findMany.mockResolvedValue([{ id: "p-palet" }])
  tx = {
    contractDocument: {
      findMany: vi.fn(async () => [{ number: 1 }, { number: 2 }]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "doc-new", ...data, invoice: null })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    contractDocumentLine: { deleteMany: vi.fn(), createMany: vi.fn() },
  }
  ;(tx as Record<string, unknown>).$queryRaw = vi.fn(async () => [])
  db.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx))
})

describe("POST /api/v1/contracts/:id/documents — a price protocol", () => {
  it("takes the deal's lines at the discounted price, numbered after the ones taken, under a lock on the contract", async () => {
    const res = await createDoc(req(`/api/v1/contracts/${C}/documents`, "POST", { kind: "price_protocol" }), params)
    expect(res.status).toBe(201)
    expect((tx as unknown as Record<string, ReturnType<typeof vi.fn>>).$queryRaw).toHaveBeenCalledTimes(1)
    expect(tx.contractDocument.findMany.mock.calls[0][0].where).toEqual({ organizationId: ORG, contractId: C, kind: "price_protocol" })
    const data = tx.contractDocument.create.mock.calls[0][0].data
    expect(data).toMatchObject({ organizationId: ORG, contractId: C, kind: "price_protocol", number: 3, status: "draft", vatRate: 0.18, currency: "AZN", subtotal: 38400, totalAmount: 45312 })
    expect(data.validTo).toEqual(contract.endDate)
    expect(data.lines.create).toEqual([
      { organizationId: ORG, position: 0, productId: "p-palet", name: "Taxta palet", unit: "ədəd", quantity: 400, unitPrice: 96, amount: 38400 },
    ])
  })

  it("copies the latest protocol's lines and VAT when there is one", async () => {
    db.contractDocument.findFirst.mockResolvedValueOnce({ vatRate: "0", lines: [{ productId: null, name: "Xidmət", unit: "saat", quantity: null, unitPrice: "40" }] })
    await createDoc(req(`/api/v1/contracts/${C}/documents`, "POST", { kind: "price_protocol" }), params)
    expect(db.dealLineItem.findMany).not.toHaveBeenCalled()
    const data = tx.contractDocument.create.mock.calls[0][0].data
    expect(data.vatRate).toBe(0)
    expect(data.lines.create[0]).toMatchObject({ name: "Xidmət", quantity: null, unitPrice: 40, amount: 0 })
  })

  it("is refused for a contract that is still a draft", async () => {
    db.contract.findFirst.mockResolvedValue({ ...contract, status: "draft" })
    const res = await createDoc(req(`/api/v1/contracts/${C}/documents`, "POST", { kind: "price_protocol" }), params)
    expect(res.status).toBe(409)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/contracts/:id/documents — an acceptance act", () => {
  const invoice = {
    id: "inv-1", contractId: C, currency: "AZN", includeVat: true, taxRate: 0.18, status: "sent",
    items: [{ productId: "p-palet", name: "Taxta palet", quantity: 400, unitPrice: "96", discount: 0 }],
  }

  it("repeats the invoice's lines and VAT", async () => {
    db.invoice.findFirst.mockResolvedValue(invoice)
    const res = await createDoc(req(`/api/v1/contracts/${C}/documents`, "POST", { kind: "acceptance_act", invoiceId: "inv-1" }), params)
    expect(res.status).toBe(201)
    expect(db.invoice.findFirst.mock.calls[0][0].where).toEqual({ id: "inv-1", organizationId: ORG })
    expect(tx.contractDocument.create.mock.calls[0][0].data).toMatchObject({ kind: "acceptance_act", invoiceId: "inv-1", vatRate: 0.18, validFrom: null, validTo: null, totalAmount: 45312 })
  })

  it("returns the invoice's open act instead of making a second", async () => {
    db.invoice.findFirst.mockResolvedValue(invoice)
    db.contractDocument.findFirst.mockResolvedValue({ id: "act-1", kind: "acceptance_act", number: 1, status: "draft", vatRate: "0.18", subtotal: "0", vatAmount: "0", totalAmount: "0" })
    const res = await createDoc(req(`/api/v1/contracts/${C}/documents`, "POST", { kind: "acceptance_act", invoiceId: "inv-1" }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ existing: true, data: { id: "act-1" } })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("refuses an invoice of another contract, a cancelled one, and a person who may not read invoices", async () => {
    db.invoice.findFirst.mockResolvedValue({ ...invoice, contractId: "ctr-other" })
    expect((await createDoc(req(`/api/v1/contracts/${C}/documents`, "POST", { kind: "acceptance_act", invoiceId: "inv-1" }), params)).status).toBe(409)
    db.invoice.findFirst.mockResolvedValue({ ...invoice, status: "cancelled" })
    expect((await createDoc(req(`/api/v1/contracts/${C}/documents`, "POST", { kind: "acceptance_act", invoiceId: "inv-1" }), params)).status).toBe(409)
    vi.mocked(checkPermission).mockReturnValue(false)
    expect((await createDoc(req(`/api/v1/contracts/${C}/documents`, "POST", { kind: "acceptance_act", invoiceId: "inv-1" }), params)).status).toBe(403)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe("PUT and DELETE /api/v1/contracts/:id/documents/:docId", () => {
  const draft = {
    id: "doc-1", contractId: C, kind: "price_protocol", number: 1, status: "draft", vatRate: "0.18",
    documentDate: new Date(), validFrom: null, validTo: null, currency: "AZN", subtotal: "0", vatAmount: "0", totalAmount: "0",
    invoice: null, lines: [],
  }

  it("replaces a draft's lines, recomputes totals, and links only this organisation's products", async () => {
    db.contractDocument.findFirst.mockResolvedValue(draft)
    db.product.findMany.mockResolvedValue([{ id: "p-palet" }])
    const res = await putDoc(
      req(`/api/v1/contracts/${C}/documents/doc-1`, "PUT", {
        vatRate: 0,
        lines: [
          { productId: "p-palet", name: "Taxta palet", unit: "ədəd", quantity: 10, unitPrice: 96 },
          { productId: "p-foreign-org", name: "Çatdırılma", unit: null, quantity: null, unitPrice: 60 },
        ],
      }),
      docParams,
    )
    expect(res.status).toBe(200)
    // the write itself re-checks the draft status
    expect(tx.contractDocument.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "doc-1", contractId: C, organizationId: ORG, status: "draft" },
      data: { vatRate: 0, subtotal: 960, vatAmount: 0, totalAmount: 960 },
    })
    expect(tx.contractDocumentLine.deleteMany).toHaveBeenCalledWith({ where: { organizationId: ORG, documentId: "doc-1" } })
    expect(tx.contractDocumentLine.createMany.mock.calls[0][0].data.map((l: { productId: string | null }) => l.productId)).toEqual(["p-palet", null])
  })

  it("refuses to edit anything but a draft — what went to signing is what is signed", async () => {
    db.contractDocument.findFirst.mockResolvedValue({ ...draft, status: "in_signing" })
    const res = await putDoc(req(`/api/v1/contracts/${C}/documents/doc-1`, "PUT", { note: "x" }), docParams)
    expect(res.status).toBe(409)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("refuses a period that ends before it starts", async () => {
    const res = await putDoc(req(`/api/v1/contracts/${C}/documents/doc-1`, "PUT", { validFrom: "2026-12-01", validTo: "2026-11-01" }), docParams)
    expect(res.status).toBe(400)
  })

  it("cancels only a draft, and keeps the row", async () => {
    db.contractDocument.updateMany.mockResolvedValue({ count: 1 })
    expect((await deleteDoc(req(`/api/v1/contracts/${C}/documents/doc-1`, "DELETE"), docParams)).status).toBe(200)
    expect(db.contractDocument.updateMany).toHaveBeenCalledWith({ where: { id: "doc-1", contractId: C, organizationId: ORG, status: "draft" }, data: { status: "cancelled" } })
    db.contractDocument.updateMany.mockResolvedValue({ count: 0 })
    db.contractDocument.findFirst.mockResolvedValue({ status: "signed" })
    expect((await deleteDoc(req(`/api/v1/contracts/${C}/documents/doc-1`, "DELETE"), docParams)).status).toBe(409)
  })
})

describe("GET /api/v1/contracts/:id/documents", () => {
  it("names the protocol in force with its lines, and which invoices have an act", async () => {
    db.contractDocument.findMany.mockResolvedValue([
      { id: "pp-1", kind: "price_protocol", number: 1, status: "signed", validFrom: new Date("2026-01-01"), validTo: null, documentDate: new Date("2026-01-01"), invoiceId: null, vatRate: "0.18", subtotal: "0", vatAmount: "0", totalAmount: "0" },
      { id: "act-1", kind: "acceptance_act", number: 1, status: "draft", validFrom: null, validTo: null, documentDate: new Date(), invoiceId: "inv-1", vatRate: "0.18", subtotal: "0", vatAmount: "0", totalAmount: "0" },
    ])
    db.contractDocumentLine.findMany.mockResolvedValue([{ productId: "p-palet", name: "Taxta palet", unit: "ədəd", quantity: null, unitPrice: "96" }])
    db.invoice.findMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "INV-1", status: "sent", totalAmount: "45312", currency: "AZN", issueDate: new Date() },
      { id: "inv-2", invoiceNumber: "INV-2", status: "draft", totalAmount: "100", currency: "AZN", issueDate: new Date() },
    ])
    const { data } = await (await listDocs(req(`/api/v1/contracts/${C}/documents`), params)).json()
    expect(data.activeProtocol).toMatchObject({ id: "pp-1", number: 1, signed: true, lines: [{ name: "Taxta palet", unitPrice: 96 }] })
    expect(data.invoices.map((i: { id: string; act: unknown }) => [i.id, i.act])).toEqual([["inv-1", { id: "act-1", status: "draft" }], ["inv-2", null]])
  })
})

describe("POST /api/v1/invoices/:id/protocol-deviation", () => {
  const p = { params: Promise.resolve({ id: "inv-1" }) }
  beforeEach(() => {
    db.invoice.findFirst.mockResolvedValue({ id: "inv-1", invoiceNumber: "INV-1", contractId: C, items: [{ productId: null, name: "Çatdırılma", unitPrice: "75" }] })
    db.contractDocument.findMany.mockResolvedValue([
      { id: "pp-1", number: 1, status: "signed", validFrom: null, validTo: null, documentDate: new Date(), lines: [{ productId: null, name: "Çatdırılma", unitPrice: "60" }] },
    ])
  })

  it("writes the reason and the lines it covers to the invoice's history", async () => {
    const res = await recordDeviation(req("/api/v1/invoices/inv-1/protocol-deviation", "POST", { reason: "Gecə çatdırılması" }), p)
    expect(res.status).toBe(200)
    expect(vi.mocked(logAudit).mock.calls[0]).toEqual([
      ORG, "price_deviation", "invoice", "inv-1", "INV-1",
      { newValue: { reason: "Gecə çatdırılması", protocolNumber: 1, deviations: [{ itemIndex: 0, name: "Çatdırılma", invoicePrice: 75, protocolPrice: 60 }] }, userId: "user-1" },
    ])
  })

  it("refuses a reason when nothing deviates", async () => {
    db.invoice.findFirst.mockResolvedValue({ id: "inv-1", invoiceNumber: "INV-1", contractId: C, items: [{ productId: null, name: "Çatdırılma", unitPrice: "60" }] })
    const res = await recordDeviation(req("/api/v1/invoices/inv-1/protocol-deviation", "POST", { reason: "Gecə çatdırılması" }), p)
    expect(res.status).toBe(409)
    expect(logAudit).not.toHaveBeenCalled()
  })
})
