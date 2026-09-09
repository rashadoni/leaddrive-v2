import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    invoice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    invoicePayment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    paymentRegistryEntry: { create: vi.fn() },
    journeyEnrollment: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    journey: { update: vi.fn(), updateMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn(),
}))
vi.mock("@/lib/constants", () => ({
  DEFAULT_CURRENCY: "AZN",
  getCurrencySymbol: vi.fn((code?: string) => code ?? "₼"),
}))
vi.mock("@/lib/invoice-calculations", () => ({
  calculateBalance: vi.fn().mockImplementation((total: number, paid: number) => Math.round((total - paid) * 100) / 100),
}))
vi.mock("@/lib/invoice-number", () => ({
  generateInvoiceNumber: vi.fn().mockResolvedValue("INV-2026-002"),
}))
vi.mock("@/lib/invoice-html", () => ({
  generateInvoiceHtml: vi.fn().mockReturnValue("<html>invoice</html>"),
  getEmailTemplate: vi.fn().mockReturnValue({ subject: "Invoice", html: "<p>Pay please</p>" }),
}))
vi.mock("@/lib/invoice-templates", () => ({
  getTranslations: vi.fn().mockReturnValue({
    actTitle: "Act",
    unitValue: "pcs",
    approve: "Approve",
    directorOf: " director",
    signAndStamp: "Sign",
    city: "Baku",
    companyInfo: "Info",
    companyName: "Company",
    documentNumber: "Doc#",
    monthlyReport: "Monthly",
    servicesProvided: "Services",
    description: "Desc",
    unit: "Unit",
    quantity: "Qty",
    unitPrice: "Price",
    total: "Total",
    subtotal: "Subtotal",
    discount: "Discount",
    vat: "VAT",
    grandTotal: "Grand Total",
    actIntroTemplate: "Intro",
    actClause1Template: "Clause 1",
    actClause2: "Clause 2",
    actClause3: "Clause 3",
    signature: "Signature",
    position: "Position",
    fullName: "Full Name",
    printButton: "Print",
  }),
  formatDate: vi.fn().mockReturnValue("01.01.2026"),
  formatMoney: vi.fn().mockReturnValue("100.00"),
  formatMonthYear: vi.fn().mockReturnValue("January 2026"),
  fillTemplate: vi.fn().mockReturnValue("Filled template text"),
  getFirstDayOfMonth: vi.fn().mockReturnValue(new Date("2026-01-01")),
  getLastDayOfMonth: vi.fn().mockReturnValue(new Date("2026-01-31")),
}))
vi.mock("crypto", () => ({ default: { randomUUID: () => "uuid-dup-123" } }))
vi.mock("nodemailer", () => ({
  createTransport: vi.fn().mockReturnValue({
    sendMail: vi.fn().mockResolvedValue({ messageId: "msg-1" }),
  }),
}))

import { GET as GET_PAYMENTS, POST as POST_PAYMENTS } from "@/app/api/v1/invoices/[id]/payments/route"
import { DELETE as DELETE_PAYMENT } from "@/app/api/v1/invoices/[id]/payments/[paymentId]/route"
import { POST as POST_SEND } from "@/app/api/v1/invoices/[id]/send/route"
import { POST as POST_DUPLICATE } from "@/app/api/v1/invoices/[id]/duplicate/route"
import { GET as GET_ACT } from "@/app/api/v1/invoices/[id]/act/route"
import { GET as GET_STATS } from "@/app/api/v1/invoices/stats/route"
import { POST as POST_OVERDUE } from "@/app/api/v1/invoices/overdue/route"
import { GET as GET_NEXT_NUMBER } from "@/app/api/v1/invoices/next-number/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth, isAuthError } from "@/lib/api-auth"

const ORG = "org-1"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function paymentParams(id: string, paymentId: string) {
  return { params: Promise.resolve({ id, paymentId }) }
}

const sampleInvoice = {
  id: "inv-1",
  organizationId: ORG,
  invoiceNumber: "INV-001",
  title: "Test",
  status: "sent",
  totalAmount: 1000,
  paidAmount: 0,
  balanceDue: 1000,
  recipientName: "Acme Corp",
  companyId: "co-1",
  currency: "AZN",
  subtotal: 1000,
  taxAmount: 0,
  taxRate: 0,
  includeVat: false,
  discountType: "percentage",
  discountValue: 0,
  discountAmount: 0,
  issueDate: new Date("2026-01-15"),
  items: [{ id: "item-1", name: "Service", quantity: 1, unitPrice: 1000, total: 1000, sortOrder: 0 }],
  company: { id: "co-1", name: "Acme Corp" },
  contact: null,
  contract: null,
  documentLanguage: "az",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  // Most legacy invoice sub-routes in this combined suite still use withRls;
  // payment routes use requireAuth through withRlsAuth.
  vi.mocked(getSession).mockResolvedValue(null as any)
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "user-1", role: "admin" } as any)
  vi.mocked(isAuthError).mockReturnValue(false)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
  vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma))
})

// ─── Payments GET ───────────────────────────────────────────────────

describe("GET /invoices/[id]/payments", () => {
  it("returns 401 when unauthenticated", async () => {
    const authError = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    vi.mocked(requireAuth).mockResolvedValueOnce(authError)
    vi.mocked(isAuthError).mockReturnValueOnce(true)
    const req = makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments")
    const res = await GET_PAYMENTS(req, idParams("inv-1"))
    expect(res.status).toBe(401)
    expect(requireAuth).toHaveBeenCalledWith(req, "invoices", "read")
  })

  it("returns payments list", async () => {
    vi.mocked(prisma.invoicePayment.findMany).mockResolvedValueOnce([
      { id: "pay-1", amount: 500, paymentMethod: "bank_transfer" },
    ] as any)
    const res = await GET_PAYMENTS(makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments"), idParams("inv-1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
    expect(requireAuth).toHaveBeenCalledWith(expect.any(NextRequest), "invoices", "read")
  })
})

// ─── Payments POST ──────────────────────────────────────────────────

describe("POST /invoices/[id]/payments", () => {
  it("blocks a principal without invoice write permission", async () => {
    const authError = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    vi.mocked(requireAuth).mockResolvedValueOnce(authError)
    vi.mocked(isAuthError).mockReturnValueOnce(true)
    const req = makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments", {
      method: "POST",
      body: JSON.stringify({ amount: 500 }),
    })

    const res = await POST_PAYMENTS(req, idParams("inv-1"))

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(req, "invoices", "write")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid amount", async () => {
    const res = await POST_PAYMENTS(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments", {
        method: "POST",
        body: JSON.stringify({ amount: -5 }),
      }),
      idParams("inv-1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when invoice not found", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce(null)
    const res = await POST_PAYMENTS(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments", {
        method: "POST",
        body: JSON.stringify({ amount: 500 }),
      }),
      idParams("inv-1"),
    )
    expect(res.status).toBe(404)
  })

  it("rejects a payment currency that does not match the locked invoice", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce(sampleInvoice as any)

    const res = await POST_PAYMENTS(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments", {
        method: "POST",
        body: JSON.stringify({ amount: 500, currency: "usd" }),
      }),
      idParams("inv-1"),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("currency"),
    })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.invoicePayment.create).not.toHaveBeenCalled()
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })

  it("creates payment and updates invoice to partially_paid", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({ ...sampleInvoice, paidAmount: 0, totalAmount: 1000 } as any)
    vi.mocked(prisma.invoicePayment.create).mockResolvedValueOnce({ id: "pay-1", amount: 500 } as any)
    vi.mocked(prisma.invoice.updateMany).mockResolvedValueOnce({ count: 1 } as any)
    vi.mocked(prisma.paymentRegistryEntry.create).mockResolvedValueOnce({} as any)

    const res = await POST_PAYMENTS(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments", {
        method: "POST",
        body: JSON.stringify({ amount: 500 }),
      }),
      idParams("inv-1"),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.invoicePayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ currency: "AZN" }),
    })

    // Should update invoice with partially_paid status
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "partially_paid" }),
      }),
    )
  })

  it("marks invoice as paid when fully paid", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({ ...sampleInvoice, paidAmount: 0, totalAmount: 1000 } as any)
    vi.mocked(prisma.invoicePayment.create).mockResolvedValueOnce({ id: "pay-2", amount: 1000 } as any)
    vi.mocked(prisma.invoice.updateMany).mockResolvedValueOnce({ count: 1 } as any)
    vi.mocked(prisma.paymentRegistryEntry.create).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValueOnce(null)

    const res = await POST_PAYMENTS(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments", {
        method: "POST",
        body: JSON.stringify({ amount: 1000 }),
      }),
      idParams("inv-1"),
    )
    expect(res.status).toBe(201)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "paid" }),
      }),
    )
  })
})

// ─── Payment DELETE ─────────────────────────────────────────────────

describe("DELETE /invoices/[id]/payments/[paymentId]", () => {
  it("returns auth error when requireAuth fails", async () => {
    const errorResponse = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    vi.mocked(requireAuth).mockResolvedValueOnce(errorResponse)
    vi.mocked(isAuthError).mockReturnValueOnce(true)

    const res = await DELETE_PAYMENT(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments/pay-1", { method: "DELETE" }),
      paymentParams("inv-1", "pay-1"),
    )
    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.any(NextRequest), "invoices", "delete")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("returns 404 when payment not found", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce(sampleInvoice as any)
    vi.mocked(prisma.invoicePayment.findFirst).mockResolvedValueOnce(null)
    const res = await DELETE_PAYMENT(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments/pay-1", { method: "DELETE" }),
      paymentParams("inv-1", "pay-1"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes payment and recalculates invoice", async () => {
    vi.mocked(prisma.invoicePayment.findFirst).mockResolvedValueOnce({ id: "pay-1", amount: 500, invoiceId: "inv-1", organizationId: ORG } as any)
    vi.mocked(prisma.invoicePayment.delete).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({ ...sampleInvoice, paidAmount: 500, totalAmount: 1000, status: "partially_paid" } as any)
    vi.mocked(prisma.invoice.updateMany).mockResolvedValueOnce({ count: 1 } as any)

    const res = await DELETE_PAYMENT(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments/pay-1", { method: "DELETE" }),
      paymentParams("inv-1", "pay-1"),
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.invoice.updateMany).toHaveBeenCalled()
  })

  it("keeps a still-overpaid invoice paid with a zero balance and paidAt", async () => {
    const paidAt = new Date("2026-08-01T12:00:00.000Z")
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({
      ...sampleInvoice,
      paidAmount: 150,
      totalAmount: 100,
      balanceDue: 0,
      status: "paid",
      paidAt,
    } as any)
    vi.mocked(prisma.invoicePayment.findFirst).mockResolvedValueOnce({
      id: "pay-1",
      amount: 20,
      invoiceId: "inv-1",
      organizationId: ORG,
    } as any)
    vi.mocked(prisma.invoicePayment.delete).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.invoice.updateMany).mockResolvedValueOnce({ count: 1 } as any)

    const res = await DELETE_PAYMENT(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/payments/pay-1", { method: "DELETE" }),
      paymentParams("inv-1", "pay-1"),
    )

    expect(res.status).toBe(200)
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: "inv-1", organizationId: ORG },
      data: {
        paidAmount: 130,
        balanceDue: 0,
        status: "paid",
        paidAt,
      },
    })
  })
})

// ─── Send ───────────────────────────────────────────────────────────

describe("POST /invoices/[id]/send", () => {
  it("returns 400 for invalid email", async () => {
    const res = await POST_SEND(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/send", {
        method: "POST",
        body: JSON.stringify({ recipientEmail: "not-an-email" }),
      }),
      idParams("inv-1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when invoice not found", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce(null)
    const res = await POST_SEND(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/send", {
        method: "POST",
        body: JSON.stringify({ recipientEmail: "client@co.com" }),
      }),
      idParams("inv-1"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 400 when SMTP not configured", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({ ...sampleInvoice, items: [] } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({ name: "Org", settings: {} } as any)

    const res = await POST_SEND(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/send", {
        method: "POST",
        body: JSON.stringify({ recipientEmail: "client@co.com" }),
      }),
      idParams("inv-1"),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("SMTP not configured")
  })
})

// ─── Duplicate ──────────────────────────────────────────────────────

describe("POST /invoices/[id]/duplicate", () => {
  it("returns 404 when original not found", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce(null)
    const res = await POST_DUPLICATE(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/duplicate", { method: "POST" }),
      idParams("inv-1"),
    )
    expect(res.status).toBe(404)
  })

  it("duplicates invoice with new number and draft status", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({ ...sampleInvoice } as any)
    vi.mocked(prisma.invoice.create).mockResolvedValueOnce({
      id: "inv-2",
      invoiceNumber: "INV-2026-002",
      status: "draft",
      paidAmount: 0,
      items: sampleInvoice.items,
    } as any)

    const res = await POST_DUPLICATE(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1/duplicate", { method: "POST" }),
      idParams("inv-1"),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.status).toBe("draft")
    expect(json.data.paidAmount).toBe(0)
  })
})

// ─── Act ────────────────────────────────────────────────────────────

describe("GET /invoices/[id]/act", () => {
  it("returns 404 when invoice not found", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce(null)
    const res = await GET_ACT(makeReq("http://localhost:3000/api/v1/invoices/inv-1/act"), idParams("inv-1"))
    expect(res.status).toBe(404)
  })

  it("returns HTML act document", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({
      ...sampleInvoice,
      items: [{ id: "item-1", name: "Service", description: null, unitPrice: 1000, total: 1000, sortOrder: 0 }],
    } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
      name: "Test Org",
      settings: { invoice: { companyName: "Test Org", directorName: "John" } },
    } as any)

    const res = await GET_ACT(makeReq("http://localhost:3000/api/v1/invoices/inv-1/act"), idParams("inv-1"))
    expect(res.headers.get("content-type")).toContain("text/html")
  })
})

// ─── Stats ──────────────────────────────────────────────────────────

describe("GET /invoices/stats", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null as any)
    const res = await GET_STATS(makeReq("http://localhost:3000/api/v1/invoices/stats"))
    expect(res.status).toBe(401)
  })

  it("returns aggregated stats", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([
      { status: "paid", totalAmount: 500, paidAmount: 500, balanceDue: 0, subtotal: 500, taxAmount: 0, createdAt: new Date(), issueDate: new Date() },
      { status: "sent", totalAmount: 300, paidAmount: 0, balanceDue: 300, subtotal: 300, taxAmount: 0, createdAt: new Date(), issueDate: new Date() },
    ] as any)

    const res = await GET_STATS(makeReq("http://localhost:3000/api/v1/invoices/stats"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.totalCount).toBe(2)
    expect(json.data.paidCount).toBe(1)
    expect(json.data.sentCount).toBe(1)
    expect(json.data.totalInvoiced).toBe(800)
  })
})

// ─── Overdue ────────────────────────────────────────────────────────

describe("POST /invoices/overdue", () => {
  it("marks overdue invoices", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(prisma.invoice.updateMany).mockResolvedValueOnce({ count: 3 } as any)
    const res = await POST_OVERDUE(makeReq("http://localhost:3000/api/v1/invoices/overdue", { method: "POST" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.updated).toBe(3)
  })
})

// ─── Next Number ────────────────────────────────────────────────────

describe("GET /invoices/next-number", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null as any)
    const res = await GET_NEXT_NUMBER(makeReq("http://localhost:3000/api/v1/invoices/next-number"))
    expect(res.status).toBe(401)
  })

  it("returns next invoice number", async () => {
    const res = await GET_NEXT_NUMBER(makeReq("http://localhost:3000/api/v1/invoices/next-number"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.number).toBe("INV-2026-002")
  })
})
