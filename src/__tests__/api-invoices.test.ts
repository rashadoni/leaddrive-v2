import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    invoiceItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn() }))
vi.mock("@/lib/constants", () => ({ DEFAULT_CURRENCY: "AZN" }))
vi.mock("@/lib/invoice-number", () => ({
  generateInvoiceNumber: vi.fn().mockResolvedValue("INV-001"),
}))
vi.mock("@/lib/invoice-calculations", () => ({
  calculateItemTotal: vi.fn().mockReturnValue(100),
  calculateInvoiceTotals: vi.fn().mockReturnValue({
    subtotal: 100,
    discountAmount: 0,
    taxAmount: 18,
    totalAmount: 118,
  }),
  calculateDueDate: vi.fn().mockReturnValue(new Date("2026-05-01")),
  calculateBalance: vi.fn().mockReturnValue(118),
}))
vi.mock("crypto", () => ({ default: { randomUUID: () => "test-uuid-123" } }))

import { GET, POST } from "@/app/api/v1/invoices/route"
import {
  GET as GET_BY_ID,
  PUT,
  DELETE,
} from "@/app/api/v1/invoices/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"
import { NextRequest } from "next/server"

const ORG = "org-1"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const sampleInvoice = {
  id: "inv-1",
  organizationId: ORG,
  invoiceNumber: "INV-001",
  title: "Test Invoice",
  status: "draft",
  totalAmount: 118,
  subtotal: 100,
  discountValue: 0,
  discountAmount: 0,
  taxAmount: 18,
  paidAmount: 0,
  balanceDue: 118,
  discountType: "percentage",
  taxRate: 18,
  includeVat: false,
  items: [{ id: "item-1", name: "Widget", quantity: 2, unitPrice: 50, total: 100 }],
  payments: [],
  company: { id: "co-1", name: "Acme" },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  // invoice routes are getOrgId-only withRls handlers; default getSession to null
  // so withRls falls through to getOrgId (the 401 tests null getOrgId too).
  vi.mocked(getSession).mockResolvedValue(null as any)
})

// ─── GET /invoices ───────────────────────────────────────────────

describe("GET /api/v1/invoices", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null as unknown as string)
    const res = await GET(makeReq("http://localhost:3000/api/v1/invoices"))
    expect(res.status).toBe(401)
  })

  it("returns paginated invoices", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([sampleInvoice] as never)
    vi.mocked(prisma.invoice.count).mockResolvedValue(1 as never)

    const res = await GET(makeReq("http://localhost:3000/api/v1/invoices"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.invoices).toHaveLength(1)
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(50)
  })

  it("applies search filter", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never)

    await GET(makeReq("http://localhost:3000/api/v1/invoices?search=test"))

    const where = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where.title).toEqual({ contains: "test", mode: "insensitive" })
  })

  it("applies status filter", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never)

    await GET(makeReq("http://localhost:3000/api/v1/invoices?status=paid"))

    const where = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where.status).toBe("paid")
  })

  it("applies companyId, dealId, contractId filters", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never)

    await GET(
      makeReq(
        "http://localhost:3000/api/v1/invoices?companyId=c1&dealId=d1&contractId=ct1"
      )
    )

    const where = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where.companyId).toBe("c1")
    expect(where.dealId).toBe("d1")
    expect(where.contractId).toBe("ct1")
  })

  it("applies dateFrom and dateTo filters on issueDate", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never)

    await GET(
      makeReq(
        "http://localhost:3000/api/v1/invoices?dateFrom=2026-01-01&dateTo=2026-12-31"
      )
    )

    const where = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where.issueDate).toEqual({
      gte: new Date("2026-01-01"),
      lte: new Date("2026-12-31"),
    })
  })

  it("returns 500 on database error", async () => {
    vi.mocked(prisma.invoice.findMany).mockRejectedValue(new Error("DB fail"))

    const res = await GET(makeReq("http://localhost:3000/api/v1/invoices"))
    expect(res.status).toBe(500)
  })
})

// ─── POST /invoices ──────────────────────────────────────────────

describe("POST /api/v1/invoices", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null as unknown as string)
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/invoices", {
        method: "POST",
        body: JSON.stringify({ title: "x" }),
      })
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when title is missing", async () => {
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/invoices", {
        method: "POST",
        body: JSON.stringify({}),
      })
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when item name is empty", async () => {
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/invoices", {
        method: "POST",
        body: JSON.stringify({
          title: "Invoice",
          items: [{ name: "", quantity: 1, unitPrice: 10 }],
        }),
      })
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when item quantity is below minimum", async () => {
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/invoices", {
        method: "POST",
        body: JSON.stringify({
          title: "Invoice",
          items: [{ name: "Widget", quantity: 0, unitPrice: 10 }],
        }),
      })
    )
    expect(res.status).toBe(400)
  })

  it("creates invoice with items and returns 201", async () => {
    vi.mocked(prisma.invoice.create).mockResolvedValue(sampleInvoice as never)

    const res = await POST(
      makeReq("http://localhost:3000/api/v1/invoices", {
        method: "POST",
        body: JSON.stringify({
          title: "Test Invoice",
          items: [{ name: "Widget", quantity: 2, unitPrice: 50 }],
        }),
      })
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data).toBeDefined()

    const createArg = vi.mocked(prisma.invoice.create).mock.calls[0][0] as Record<string, unknown>
    const data = createArg.data as Record<string, unknown>
    expect(data.invoiceNumber).toBe("INV-001")
    expect(data.viewToken).toBe("test-uuid-123")
    expect(data.totalAmount).toBe(118)
    expect(data.subtotal).toBe(100)
    expect(data.taxAmount).toBe(18)
  })

  it("returns 500 on database error", async () => {
    vi.mocked(prisma.invoice.create).mockRejectedValue(new Error("DB fail"))

    const res = await POST(
      makeReq("http://localhost:3000/api/v1/invoices", {
        method: "POST",
        body: JSON.stringify({ title: "Fail" }),
      })
    )
    expect(res.status).toBe(500)
  })
})

// ─── GET /invoices/:id ──────────────────────────────────────────

describe("GET /api/v1/invoices/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null as unknown as string)
    const res = await GET_BY_ID(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1"),
      idParams("inv-1")
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when invoice not found", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never)

    const res = await GET_BY_ID(
      makeReq("http://localhost:3000/api/v1/invoices/inv-999"),
      idParams("inv-999")
    )
    expect(res.status).toBe(404)
  })

  it("returns invoice with full includes", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(sampleInvoice as never)

    const res = await GET_BY_ID(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1"),
      idParams("inv-1")
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("inv-1")

    const callArg = vi.mocked(prisma.invoice.findFirst).mock.calls[0][0] as Record<string, unknown>
    const include = callArg.include as Record<string, unknown>
    expect(include).toHaveProperty("items")
    expect(include).toHaveProperty("payments")
    expect(include).toHaveProperty("company")
    expect(include).toHaveProperty("contact")
    expect(include).toHaveProperty("deal")
    expect(include).toHaveProperty("contract")
  })
})

// ─── PUT /invoices/:id ──────────────────────────────────────────

describe("PUT /api/v1/invoices/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null as unknown as string)
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1", {
        method: "PUT",
        body: JSON.stringify({ title: "Updated" }),
      }),
      idParams("inv-1")
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when invoice not found", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1", {
        method: "PUT",
        body: JSON.stringify({ title: "Updated" }),
      }),
      idParams("inv-1")
    )
    expect(res.status).toBe(404)
  })

  it("prevents modifying a paid invoice to a different status", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({
      ...sampleInvoice,
      status: "paid",
      payments: [],
    } as never)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1", {
        method: "PUT",
        body: JSON.stringify({ status: "draft" }),
      }),
      idParams("inv-1")
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("paid")
  })

  it("allows updating a paid invoice when status stays paid", async () => {
    vi.mocked(prisma.invoice.findFirst)
      .mockResolvedValueOnce({
        ...sampleInvoice,
        status: "paid",
        payments: [],
      } as never)
      .mockResolvedValueOnce(sampleInvoice as never)
    vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 1 } as never)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1", {
        method: "PUT",
        body: JSON.stringify({ status: "paid", notes: "updated note" }),
      }),
      idParams("inv-1")
    )
    expect(res.status).toBe(200)
  })

  it("recalculates totals when items are provided", async () => {
    vi.mocked(prisma.invoice.findFirst)
      .mockResolvedValueOnce({ ...sampleInvoice, payments: [], paidAmount: 0 } as never)
      .mockResolvedValueOnce(sampleInvoice as never)
    vi.mocked(prisma.invoiceItem.deleteMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.invoiceItem.createMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 1 } as never)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1", {
        method: "PUT",
        body: JSON.stringify({
          items: [{ name: "New Widget", quantity: 3, unitPrice: 100 }],
        }),
      }),
      idParams("inv-1")
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)

    expect(prisma.invoiceItem.deleteMany).toHaveBeenCalledWith({
      where: { invoiceId: "inv-1" },
    })
    expect(prisma.invoiceItem.createMany).toHaveBeenCalled()

    const updateArg = vi.mocked(prisma.invoice.updateMany).mock.calls[0][0] as Record<string, unknown>
    const data = updateArg.data as Record<string, unknown>
    expect(data.subtotal).toBe(100)
    expect(data.totalAmount).toBe(118)
    expect(data.balanceDue).toBe(118)
  })

  it("updates without item recalculation when no items provided", async () => {
    vi.mocked(prisma.invoice.findFirst)
      .mockResolvedValueOnce({ ...sampleInvoice, payments: [] } as never)
      .mockResolvedValueOnce(sampleInvoice as never)
    vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 1 } as never)

    await PUT(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1", {
        method: "PUT",
        body: JSON.stringify({ title: "Renamed" }),
      }),
      idParams("inv-1")
    )

    expect(prisma.invoiceItem.deleteMany).not.toHaveBeenCalled()
    expect(prisma.invoiceItem.createMany).not.toHaveBeenCalled()
  })
})

// ─── DELETE /invoices/:id ────────────────────────────────────────

describe("DELETE /api/v1/invoices/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null as unknown as string)
    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1", { method: "DELETE" }),
      idParams("inv-1")
    )
    expect(res.status).toBe(401)
  })

  it("deletes invoice and returns success", async () => {
    vi.mocked(prisma.invoice.deleteMany).mockResolvedValue({ count: 1 } as never)

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1", { method: "DELETE" }),
      idParams("inv-1")
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(prisma.invoice.deleteMany).toHaveBeenCalledWith({
      where: { id: "inv-1", organizationId: ORG },
    })
  })

  it("returns 500 on database error", async () => {
    vi.mocked(prisma.invoice.deleteMany).mockRejectedValue(new Error("DB fail"))

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1", { method: "DELETE" }),
      idParams("inv-1")
    )
    expect(res.status).toBe(500)
  })
})

// ─── Decimal-normalization regression guards ─────────────────────
// After migration 20260525260000_invoice_money_decimal, all 7 money
// columns return Prisma.Decimal objects. Without normalizeInvoiceRow()
// they serialize as strings ("118.0000") instead of numbers (118).

describe("Decimal-normalization: GET /api/v1/invoices list", () => {
  it("money fields are JS numbers, not Decimal strings", async () => {
    const dec = (v: number) => ({ toNumber: () => v, toString: () => `${v}.0000` })
    const decimalInvoice = {
      ...sampleInvoice,
      subtotal: dec(100),
      discountValue: dec(0),
      discountAmount: dec(0),
      taxAmount: dec(18),
      totalAmount: dec(118),
      paidAmount: dec(0),
      balanceDue: dec(118),
    }
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([decimalInvoice] as never)
    vi.mocked(prisma.invoice.count).mockResolvedValue(1 as never)

    const res = await GET(makeReq("http://localhost:3000/api/v1/invoices"))
    const json = await res.json()
    expect(res.status).toBe(200)
    const inv = json.data.invoices[0]
    expect(typeof inv.totalAmount).toBe("number")
    expect(inv.totalAmount).toBe(118)
    expect(typeof inv.subtotal).toBe("number")
    expect(inv.subtotal).toBe(100)
    expect(typeof inv.taxAmount).toBe("number")
    expect(inv.taxAmount).toBe(18)
    expect(typeof inv.balanceDue).toBe("number")
    expect(inv.balanceDue).toBe(118)
  })
})

describe("Decimal-normalization: GET /api/v1/invoices/:id single", () => {
  it("money fields are JS numbers, not Decimal strings", async () => {
    const dec = (v: number) => ({ toNumber: () => v, toString: () => `${v}.0000` })
    const decimalInvoice = {
      ...sampleInvoice,
      subtotal: dec(100),
      discountValue: dec(0),
      discountAmount: dec(0),
      taxAmount: dec(18),
      totalAmount: dec(118),
      paidAmount: dec(0),
      balanceDue: dec(118),
      payments: [],
      contact: null,
      deal: null,
      contract: null,
    }
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(decimalInvoice as never)

    const res = await GET_BY_ID(
      makeReq("http://localhost:3000/api/v1/invoices/inv-1"),
      idParams("inv-1")
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    const inv = json.data
    expect(typeof inv.totalAmount).toBe("number")
    expect(inv.totalAmount).toBe(118)
    expect(typeof inv.paidAmount).toBe("number")
    expect(inv.paidAmount).toBe(0)
    expect(typeof inv.balanceDue).toBe("number")
    expect(inv.balanceDue).toBe(118)
  })
})
