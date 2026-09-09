import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bill: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    invoice: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    bankAccount: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    fund: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    fundBalanceProjection: {
      create: vi.fn(),
    },
    eventCommandReceipt: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    domainEvent: {
      create: vi.fn(),
    },
    eventOutbox: {
      create: vi.fn(),
    },
    cashFlowEntry: {
      findMany: vi.fn(),
    },
    salesForecast: {
      findMany: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => {
  const getOrgId = vi.fn()
  return {
    getOrgId,
    requireAuth: vi.fn(async (req: NextRequest) => {
      const orgId = await getOrgId(req)
      return orgId
        ? { orgId, userId: "user-1" }
        : new Response(null, { status: 401 })
    }),
    isAuthError: vi.fn((value: unknown) => value instanceof Response),
  }
})

vi.mock("@/lib/constants", () => ({
  DEFAULT_CURRENCY: "AZN",
  getCurrencySymbol: () => "₼",
}))

import { GET as GET_DASHBOARD } from "@/app/api/finance/dashboard/route"
import { GET as GET_EXPORT } from "@/app/api/finance/dashboard/export/route"
import { GET as GET_BANK_ACCOUNTS, POST as POST_BANK_ACCOUNT } from "@/app/api/finance/bank-accounts/route"
import { PUT as PUT_BANK_ACCOUNT, DELETE as DELETE_BANK_ACCOUNT } from "@/app/api/finance/bank-accounts/[id]/route"
import { GET as GET_FUNDS, POST as POST_FUND } from "@/app/api/finance/funds/route"
import { GET as GET_PAYABLES, POST as POST_PAYABLE } from "@/app/api/finance/payables/route"
import { GET as GET_RECEIVABLES } from "@/app/api/finance/receivables/route"
import { GET as GET_PAYABLES_STATS } from "@/app/api/finance/payables/stats/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── FINANCE DASHBOARD ──────────────────────────────────────────────

describe("GET /api/finance/dashboard", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_DASHBOARD(makeRequest("/api/finance/dashboard"))
    expect(res.status).toBe(401)
  })

  it("returns dashboard data with KPIs and trends", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.bill.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 0 })
    // Revenue = collected invoices, expenses = paid bills, plan = sales forecast.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { id: "i1", invoiceNumber: "INV-1", totalAmount: 100000, balanceDue: 10000, dueDate: null, issueDate: new Date(Date.UTC(2026, 2, 15)), status: "partially_paid", companyId: null },
    ] as any)
    vi.mocked(prisma.bill.findMany).mockResolvedValue([
      { id: "b1", totalAmount: 55000, balanceDue: 0, dueDate: null, issueDate: new Date(Date.UTC(2026, 2, 15)), status: "paid", category: "salaries", vendorName: "ACME" },
    ] as any)
    vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([
      { month: 3, entryType: "inflow", amount: 80000 },
      { month: 3, entryType: "outflow", amount: 50000 },
    ] as any)
    vi.mocked(prisma.salesForecast.findMany).mockResolvedValue([
      { month: 3, amount: 100000 },
    ] as any)
    vi.mocked(prisma.fund.findMany).mockResolvedValue([])

    const res = await GET_DASHBOARD(makeRequest("/api/finance/dashboard?year=2026"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.kpis).toBeDefined()
    expect(json.data.kpis.revenue.plan).toBe(100000)   // sales forecast
    expect(json.data.kpis.revenue.fact).toBe(90000)    // 100000 invoiced − 10000 still due
    expect(json.data.kpis.expenses.plan).toBeNull()    // no expense plan exists any more
    expect(json.data.kpis.netProfit.fact).toBe(35000)  // 90000 − 55000
    expect(json.data.kpis.cashBalance.current).toBe(30000) // 80000 - 50000
    expect(json.data.revenueTrend).toHaveLength(12)
    expect(json.data.year).toBe(2026)
  })

  it("auto-updates overdue bill and invoice statuses", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.bill.updateMany).mockResolvedValue({ count: 2 })
    vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])
    vi.mocked(prisma.bill.findMany).mockResolvedValue([])
    vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([])
    vi.mocked(prisma.salesForecast.findMany).mockResolvedValue([])
    vi.mocked(prisma.fund.findMany).mockResolvedValue([])

    await GET_DASHBOARD(makeRequest("/api/finance/dashboard"))

    expect(prisma.bill.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "overdue" } }),
    )
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "overdue" } }),
    )
  })
})

// ─── BANK ACCOUNTS ──────────────────────────────────────────────────

describe("GET /api/finance/bank-accounts", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_BANK_ACCOUNTS(makeRequest("/api/finance/bank-accounts"))
    expect(res.status).toBe(401)
  })

  it("returns list of bank accounts", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const accounts = [{ id: "ba1", accountName: "Main", bankName: "Kapital" }]
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue(accounts as any)

    const res = await GET_BANK_ACCOUNTS(makeRequest("/api/finance/bank-accounts"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual(accounts)
  })
})

describe("POST /api/finance/bank-accounts", () => {
  it("returns 400 on validation failure", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await POST_BANK_ACCOUNT(makeRequest("/api/finance/bank-accounts", {
      method: "POST",
      body: JSON.stringify({ accountName: "" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates bank account and unsets other defaults", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.bankAccount.updateMany).mockResolvedValue({ count: 1 })
    const account = { id: "ba2", accountName: "USD Account", bankName: "ABB", isDefault: true }
    vi.mocked(prisma.bankAccount.create).mockResolvedValue(account as any)

    const res = await POST_BANK_ACCOUNT(makeRequest("/api/finance/bank-accounts", {
      method: "POST",
      body: JSON.stringify({ accountName: "USD Account", bankName: "ABB", isDefault: true }),
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.data).toEqual(account)
    expect(prisma.bankAccount.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", isDefault: true },
      data: { isDefault: false },
    })
  })
})

describe("PUT /api/finance/bank-accounts/[id]", () => {
  it("returns 404 when account not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue(null)

    const res = await PUT_BANK_ACCOUNT(
      makeRequest("/api/finance/bank-accounts/ba1", { method: "PUT", body: JSON.stringify({ accountName: "Updated" }) }),
      makeParams("ba1"),
    )
    expect(res.status).toBe(404)
  })

  it("updates bank account", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue({ id: "ba1" } as any)
    vi.mocked(prisma.bankAccount.update).mockResolvedValue({ id: "ba1", accountName: "Updated" } as any)

    const res = await PUT_BANK_ACCOUNT(
      makeRequest("/api/finance/bank-accounts/ba1", { method: "PUT", body: JSON.stringify({ accountName: "Updated" }) }),
      makeParams("ba1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.accountName).toBe("Updated")
  })
})

describe("DELETE /api/finance/bank-accounts/[id]", () => {
  it("returns 404 when account not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue(null)

    const res = await DELETE_BANK_ACCOUNT(
      makeRequest("/api/finance/bank-accounts/ba1", { method: "DELETE" }),
      makeParams("ba1"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes bank account", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue({ id: "ba1" } as any)
    vi.mocked(prisma.bankAccount.delete).mockResolvedValue({} as any)

    const res = await DELETE_BANK_ACCOUNT(
      makeRequest("/api/finance/bank-accounts/ba1", { method: "DELETE" }),
      makeParams("ba1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })
})

// ─── FUNDS ──────────────────────────────────────────────────────────

describe("GET /api/finance/funds", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_FUNDS(makeRequest("/api/finance/funds"))
    expect(res.status).toBe(401)
  })

  it("returns funds with rules included", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const funds = [{ id: "f1", name: "Reserve", targetAmount: null, currentBalance: "0.0000", rules: [] }]
    vi.mocked(prisma.fund.findMany).mockResolvedValue(funds as any)

    const res = await GET_FUNDS(makeRequest("/api/finance/funds"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual([{
      ...funds[0],
      currentBalance: 0,
      targetAmountExact: null,
      currentBalanceExact: "0.0000",
    }])
    expect(prisma.fund.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      include: { rules: true },
      orderBy: { createdAt: "asc" },
    })
  })
})

describe("POST /api/finance/funds", () => {
  it("returns 400 on invalid body", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await POST_FUND(makeRequest("/api/finance/funds", {
      method: "POST",
      headers: { "Idempotency-Key": "test-key-1234" },
      body: JSON.stringify({ name: "" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates a fund", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const createdAt = new Date("2026-09-01T12:00:00.000Z")
    const fund = {
      id: "f2",
      organizationId: "org-1",
      name: "Emergency",
      description: null,
      targetAmount: "10000.0000",
      currentBalance: "0.0000",
      currency: "AZN",
      color: null,
      isActive: true,
      createdBy: "user-1",
      createdAt,
      updatedAt: createdAt,
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma))
    vi.mocked(prisma.eventCommandReceipt.findUnique).mockResolvedValue(null as any)
    vi.mocked(prisma.fund.create).mockResolvedValue(fund as any)
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ currentVersion: 1n }] as any)
    vi.mocked(prisma.domainEvent.create).mockResolvedValue({ payloadHash: "a".repeat(64) } as any)
    vi.mocked(prisma.eventOutbox.create).mockResolvedValue({ payloadHash: "b".repeat(64) } as any)
    vi.mocked(prisma.fundBalanceProjection.create).mockResolvedValue({ id: "projection-1" } as any)
    vi.mocked(prisma.eventCommandReceipt.create).mockImplementation(async (args: any) => ({
      id: "receipt-1",
      requestHash: args.data.requestHash,
      responseStatus: args.data.responseStatus,
      responseBody: args.data.responseBody,
      eventIds: args.data.eventIds,
    }) as any)

    const res = await POST_FUND(makeRequest("/api/finance/funds", {
      method: "POST",
      headers: { "Idempotency-Key": "test-key-1234" },
      body: JSON.stringify({ name: "Emergency", targetAmount: 10000 }),
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.data).toMatchObject({
      id: "f2",
      name: "Emergency",
      targetAmount: 10000,
      targetAmountExact: "10000.0000",
      currentBalance: 0,
      currentBalanceExact: "0.0000",
    })
    expect(prisma.domainEvent.create).toHaveBeenCalledOnce()
    expect(prisma.eventOutbox.create).toHaveBeenCalledOnce()
    expect(prisma.fundBalanceProjection.create).toHaveBeenCalledOnce()
    expect(prisma.eventCommandReceipt.create).toHaveBeenCalledOnce()
  })
})

// ─── PAYABLES (BILLS) ───────────────────────────────────────────────

describe("GET /api/finance/payables", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_PAYABLES(makeRequest("/api/finance/payables"))
    expect(res.status).toBe(401)
  })

  it("returns bills with optional status filter", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    // payments: [] required — GET handler calls b.payments.map(normalizeBillPaymentRow)
    // paidAmount/balanceDue required — normalizeBillRow converts all 3 money fields
    const bills = [{ id: "b1", vendorName: "AWS", totalAmount: 5000, paidAmount: 0, balanceDue: 5000, status: "pending", payments: [] }]
    vi.mocked(prisma.bill.findMany).mockResolvedValue(bills as any)

    const res = await GET_PAYABLES(makeRequest("/api/finance/payables?status=pending"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual(bills)
    expect(prisma.bill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", status: "pending" },
      }),
    )
  })
})

describe("POST /api/finance/payables", () => {
  it("returns 400 on validation failure", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await POST_PAYABLE(makeRequest("/api/finance/payables", {
      method: "POST",
      body: JSON.stringify({ vendorName: "AWS" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates a bill with balanceDue = totalAmount", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    // paidAmount required — normalizeBillRow always outputs all 3 money fields
    const bill = { id: "b2", vendorName: "AWS", totalAmount: 3000, paidAmount: 0, balanceDue: 3000, status: "pending" }
    vi.mocked(prisma.bill.create).mockResolvedValue(bill as any)

    const res = await POST_PAYABLE(makeRequest("/api/finance/payables", {
      method: "POST",
      body: JSON.stringify({ vendorName: "AWS", title: "Cloud hosting", totalAmount: 3000 }),
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.data).toEqual(bill)
    const createCall = vi.mocked(prisma.bill.create).mock.calls[0][0]
    expect(createCall.data.balanceDue).toBe(3000)
    expect(createCall.data.status).toBe("pending")
  })
})

// ─── BILL DECIMAL REGRESSION GUARDS ─────────────────────────────────────────

describe("Bill Decimal boundary — GET /api/finance/payables", () => {
  it("converts Prisma.Decimal amounts to JS numbers in list response", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    // Simulate Prisma Decimal objects (duck-typed with .toNumber())
    const decimalLike = (n: number) => ({ toNumber: () => n })
    const bills = [{
      id: "b-dec",
      vendorName: "Stripe",
      status: "pending",
      totalAmount: decimalLike(5000),
      paidAmount: decimalLike(1000),
      balanceDue: decimalLike(4000),
      payments: [],
    }]
    vi.mocked(prisma.bill.findMany).mockResolvedValue(bills as any)

    const res = await GET_PAYABLES(makeRequest("/api/finance/payables"))
    const json = await res.json()

    expect(res.status).toBe(200)
    const b = json.data[0]
    // Must be plain JS numbers, not strings like "5000.0000"
    expect(b.totalAmount).toBe(5000)
    expect(b.paidAmount).toBe(1000)
    expect(b.balanceDue).toBe(4000)
    expect(typeof b.totalAmount).toBe("number")
    expect(typeof b.paidAmount).toBe("number")
    expect(typeof b.balanceDue).toBe("number")
  })
})

describe("Bill Decimal boundary — GET /api/finance/payables/stats", () => {
  it("sums Decimal balanceDue correctly — no string-concat bug", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const decimalLike = (n: number) => ({ toNumber: () => n })
    const bills = [
      { id: "s1", vendorName: "A", status: "pending", balanceDue: decimalLike(1000), dueDate: null, vendorId: null, billNumber: null, title: "A", category: null },
      { id: "s2", vendorName: "B", status: "pending", balanceDue: decimalLike(2000), dueDate: null, vendorId: null, billNumber: null, title: "B", category: null },
    ]
    vi.mocked(prisma.bill.findMany).mockResolvedValue(bills as any)

    const res = await GET_PAYABLES_STATS(makeRequest("/api/finance/payables/stats"))
    const json = await res.json()

    expect(res.status).toBe(200)
    // Without decimalToNumber(): 0 += Decimal(1000) → "01000.0000" string-concat
    expect(json.data.total).toBe(3000)
    expect(typeof json.data.total).toBe("number")
  })
})

// ─── RECEIVABLES ────────────────────────────────────────────────────

describe("GET /api/finance/receivables", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_RECEIVABLES(makeRequest("/api/finance/receivables"))
    expect(res.status).toBe(401)
  })

  it("returns receivables with aging buckets and top debtors", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const pastDueDate = new Date(Date.now() - 15 * 86400000).toISOString()
    const invoices = [
      {
        id: "inv1",
        invoiceNumber: "INV-001",
        totalAmount: 5000,
        balanceDue: 3000,
        dueDate: new Date(pastDueDate),
        status: "overdue",
        companyId: "c1",
        company: { id: "c1", name: "Acme Corp" },
      },
    ]
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(invoices as any)

    const res = await GET_RECEIVABLES(makeRequest("/api/finance/receivables"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.total).toBe(3000)
    expect(json.data.overdueTotal).toBe(3000)
    expect(json.data.overdueCount).toBe(1)
    expect(json.data.aging).toHaveLength(5)
    // 15 days overdue should be in bucket index 1 (1-30 days)
    expect(json.data.aging[1].amount).toBe(3000)
    expect(json.data.topDebtors).toHaveLength(1)
    expect(json.data.topDebtors[0].companyName).toBe("Acme Corp")
  })

  it("Decimal-normalization: total/aging/overdueTotal are numbers when balanceDue is Decimal", async () => {
    // Simulate Prisma.Decimal: object with .toNumber() — without decimalToNumber()
    // total += Decimal → "0118.0000" (string). Guards the P0 fix in 9d57b374.
    const dec = (v: number) => ({ toNumber: () => v, valueOf: () => v, toString: () => `${v}.0000` })
    const pastDueDate = new Date(Date.now() - 15 * 86400000)
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: "inv1",
        invoiceNumber: "INV-001",
        totalAmount: dec(5000),
        balanceDue: dec(3000),
        dueDate: pastDueDate,
        status: "overdue",
        companyId: "c1",
        company: { id: "c1", name: "Acme Corp" },
      },
    ] as any)

    const res = await GET_RECEIVABLES(makeRequest("/api/finance/receivables"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(typeof json.data.total).toBe("number")
    expect(json.data.total).toBe(3000)
    expect(typeof json.data.overdueTotal).toBe("number")
    expect(json.data.overdueTotal).toBe(3000)
    expect(typeof json.data.aging[1].amount).toBe("number")
    expect(json.data.aging[1].amount).toBe(3000)
    expect(typeof json.data.topDebtors[0].amount).toBe("number")
    expect(json.data.topDebtors[0].amount).toBe(3000)
  })
})

// ─── E-4: DATE RANGE FILTER ──────────────────────────────────────────

describe("GET /api/finance/dashboard — E-4 date range validation", () => {
  beforeEach(() => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
  })

  it("returns 400 when only dateFrom is supplied (XOR guard)", async () => {
    const res = await GET_DASHBOARD(makeRequest("/api/finance/dashboard?dateFrom=2026-03-01"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/dateFrom and dateTo are required/i)
  })

  it("returns 400 when only dateTo is supplied (XOR guard)", async () => {
    const res = await GET_DASHBOARD(makeRequest("/api/finance/dashboard?dateTo=2026-03-31"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/dateFrom and dateTo are required/i)
  })

  it("returns 400 on invalid date string", async () => {
    const res = await GET_DASHBOARD(makeRequest("/api/finance/dashboard?dateFrom=not-a-date&dateTo=2026-03-31"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Invalid/i)
  })

  it("returns 400 when dateFrom is after dateTo", async () => {
    const res = await GET_DASHBOARD(makeRequest("/api/finance/dashboard?dateFrom=2026-04-01&dateTo=2026-03-01"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/after/i)
  })

  it("returns 400 when date range crosses calendar year", async () => {
    const res = await GET_DASHBOARD(makeRequest("/api/finance/dashboard?dateFrom=2025-12-01&dateTo=2026-01-31"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/calendar year/i)
  })

  it("happy path: scopes revenue to the range + echoes dateFrom/dateTo in response", async () => {
    vi.mocked(prisma.bill.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 0 })
    // The DB query already filters by issueDate, but the route filters again in
    // memory; feeding it an out-of-range row proves that guard still holds.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { id: "in", invoiceNumber: "INV-IN", totalAmount: 40000, balanceDue: 0, dueDate: null, issueDate: new Date(Date.UTC(2026, 2, 15)), status: "paid", companyId: null },
      { id: "out", invoiceNumber: "INV-OUT", totalAmount: 99000, balanceDue: 0, dueDate: null, issueDate: new Date(Date.UTC(2026, 1, 10)), status: "paid", companyId: null },
    ] as any)
    vi.mocked(prisma.bill.findMany).mockResolvedValue([])
    vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([])
    vi.mocked(prisma.salesForecast.findMany).mockResolvedValue([])
    vi.mocked(prisma.fund.findMany).mockResolvedValue([])

    const res = await GET_DASHBOARD(
      makeRequest("/api/finance/dashboard?dateFrom=2026-03-01&dateTo=2026-03-31"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    // Only the March invoice should be counted — the February one is out of range
    expect(json.data.kpis.revenue.fact).toBe(40000)
    // revenueTrend should cover only months 3–3
    expect(json.data.revenueTrend).toHaveLength(1)
    expect(json.data.revenueTrend[0].month).toBe(3)
    // Response echoes dateFrom / dateTo
    expect(json.data.dateFrom).toBe("2026-03-01")
    expect(json.data.dateTo).toBe("2026-03-31")
  })
})

describe("Decimal-normalization: GET /api/finance/dashboard A/R KPIs", () => {
  it("arTotal and aging buckets are numbers when Invoice.balanceDue is Decimal", async () => {
    // Guards the P0 fix in 9d57b374 for the finance/dashboard route.
    const dec = (v: number) => ({ toNumber: () => v, valueOf: () => v, toString: () => `${v}.0000` })
    const overdueDate = new Date(Date.now() - 5 * 86400000) // 5 days ago

    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.bill.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: "inv1",
        invoiceNumber: "INV-001",
        totalAmount: dec(10000),
        balanceDue: dec(7500),
        dueDate: overdueDate,
        status: "overdue",
        companyId: "c1",
      },
    ] as any)
    vi.mocked(prisma.bill.findMany).mockResolvedValue([])
    vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([])
    vi.mocked(prisma.salesForecast.findMany).mockResolvedValue([])
    vi.mocked(prisma.fund.findMany).mockResolvedValue([])

    const res = await GET_DASHBOARD(makeRequest("/api/finance/dashboard?year=2026"))
    const json = await res.json()
    expect(res.status).toBe(200)
    const kpis = json.data.kpis
    expect(typeof kpis.arTotal.amount).toBe("number")
    expect(kpis.arTotal.amount).toBe(7500)
    expect(typeof kpis.arTotal.overdueAmount).toBe("number")
    expect(kpis.arTotal.overdueAmount).toBe(7500)
    // Aging bucket 0 (current) or 1 (1-30 days) — overdue 5 days → bucket 1
    const aging = json.data.arAging
    expect(typeof aging[1].amount).toBe("number")
    expect(aging[1].amount).toBe(7500)
  })
})

// ─── E-4.4: RECEIVABLES DATE RANGE FILTER ───────────────────────────────────

describe("GET /api/finance/receivables — E-4.4 date range", () => {
  beforeEach(() => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
  })

  it("returns 400 when only dateFrom is supplied (XOR guard)", async () => {
    const res = await GET_RECEIVABLES(makeRequest("/api/finance/receivables?dateFrom=2026-03-01"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/dateFrom and dateTo are required/i)
  })

  it("returns 400 when only dateTo is supplied (XOR guard)", async () => {
    const res = await GET_RECEIVABLES(makeRequest("/api/finance/receivables?dateTo=2026-03-31"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/dateFrom and dateTo are required/i)
  })

  it("returns 400 when dateFrom is after dateTo", async () => {
    const res = await GET_RECEIVABLES(makeRequest("/api/finance/receivables?dateFrom=2026-04-01&dateTo=2026-03-01"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/after/i)
  })

  it("returns 400 when date range crosses calendar year", async () => {
    const res = await GET_RECEIVABLES(makeRequest("/api/finance/receivables?dateFrom=2025-12-01&dateTo=2026-01-31"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/calendar year/i)
  })

  it("happy path: passes issueDate filter to Prisma and returns correct totals", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: "inv1",
        invoiceNumber: "INV-001",
        totalAmount: 5000,
        balanceDue: 3000,
        dueDate: new Date("2026-03-10"),
        status: "sent",
        companyId: "c1",
        company: { id: "c1", name: "Acme" },
      },
    ] as any)

    const res = await GET_RECEIVABLES(makeRequest("/api/finance/receivables?dateFrom=2026-03-01&dateTo=2026-03-31"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.total).toBe(3000)
    // Verify that the Prisma call included issueDate filter
    expect(vi.mocked(prisma.invoice.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          issueDate: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
        }),
      }),
    )
  })

  it("happy path: no date range → no issueDate filter in Prisma call", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])

    const res = await GET_RECEIVABLES(makeRequest("/api/finance/receivables"))
    expect(res.status).toBe(200)
    // When no date range, issueDate should NOT be in the where clause
    const call = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]
    expect((call as any).where).not.toHaveProperty("issueDate")
  })
})

// ─── E-4.4: PAYABLES STATS DATE RANGE FILTER ────────────────────────────────

describe("GET /api/finance/payables/stats — E-4.4 date range", () => {
  beforeEach(() => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
  })

  it("returns 400 when only dateFrom is supplied (XOR guard)", async () => {
    const res = await GET_PAYABLES_STATS(makeRequest("/api/finance/payables/stats?dateFrom=2026-03-01"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/dateFrom and dateTo are required/i)
  })

  it("returns 400 when only dateTo is supplied (XOR guard)", async () => {
    const res = await GET_PAYABLES_STATS(makeRequest("/api/finance/payables/stats?dateTo=2026-03-31"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/dateFrom and dateTo are required/i)
  })

  it("returns 400 when dateFrom is after dateTo", async () => {
    const res = await GET_PAYABLES_STATS(makeRequest("/api/finance/payables/stats?dateFrom=2026-04-01&dateTo=2026-03-01"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/after/i)
  })

  it("happy path: passes issueDate filter to Prisma when date range active", async () => {
    vi.mocked(prisma.bill.findMany).mockResolvedValue([])

    const res = await GET_PAYABLES_STATS(makeRequest("/api/finance/payables/stats?dateFrom=2026-03-01&dateTo=2026-03-31"))
    expect(res.status).toBe(200)

    expect(vi.mocked(prisma.bill.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          issueDate: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
        }),
      }),
    )
  })
})

// ─── E-4.5: FINANCE DASHBOARD EXPORT ────────────────────────────────────────

vi.mock("exceljs", () => {
  const mockCell = { value: null as any, numFmt: "", alignment: {} as any, style: {} as any, border: {} as any }
  const mockRow = {
    eachCell: vi.fn(),
    height: 0,
    getCell: vi.fn(() => mockCell),
  }
  const mockWorksheet = {
    columns: [] as any[],
    getRow: vi.fn(() => mockRow),
    addRow: vi.fn(() => mockRow),
    eachRow: vi.fn(),
  }
  class MockWorkbook {
    creator = ""
    created: any = null
    addWorksheet = vi.fn(() => mockWorksheet)
    xlsx = { writeBuffer: vi.fn(() => Buffer.from("xlsx-data")) }
  }
  return { default: { Workbook: MockWorkbook } }
})

describe("GET /api/finance/dashboard/export — E-4.5", () => {
  beforeEach(() => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
  })

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_EXPORT(makeRequest("/api/finance/dashboard/export"))
    expect(res.status).toBe(401)
  })

  it("returns 400 when only dateFrom is supplied (XOR guard)", async () => {
    const res = await GET_EXPORT(makeRequest("/api/finance/dashboard/export?dateFrom=2026-03-01"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/dateFrom and dateTo are required/i)
  })

  it("returns 400 when date range crosses calendar year", async () => {
    const res = await GET_EXPORT(makeRequest("/api/finance/dashboard/export?dateFrom=2025-12-01&dateTo=2026-01-31"))
    expect(res.status).toBe(400)
  })

  it("happy path: returns xlsx with correct Content-Type and filename (year mode)", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])
    vi.mocked(prisma.bill.findMany).mockResolvedValue([])
    vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([])
    vi.mocked(prisma.salesForecast.findMany).mockResolvedValue([])

    const res = await GET_EXPORT(makeRequest("/api/finance/dashboard/export?year=2026"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet")
    expect(res.headers.get("Content-Disposition")).toContain("finance-2026.xlsx")
  })

  it("happy path: filename includes date range when dateFrom+dateTo provided", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])
    vi.mocked(prisma.bill.findMany).mockResolvedValue([])
    vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([])
    vi.mocked(prisma.salesForecast.findMany).mockResolvedValue([])

    const res = await GET_EXPORT(makeRequest("/api/finance/dashboard/export?dateFrom=2026-03-01&dateTo=2026-03-31"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Disposition")).toContain("finance-2026-03-01_2026-03-31.xlsx")
  })
})
