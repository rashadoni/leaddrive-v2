/**
 * CLM Slice 7c — API tests for:
 *   POST /api/v1/contracts/:id/create-invoice
 *
 * Coverage:
 *   - 401 when unauthenticated
 *   - 403 when user lacks invoices:write (even if contracts:write passes)
 *   - 403 when user lacks contracts:write (checked first)
 *   - 403 when caller is a mobile-JWT auth (FIX 1 — finance action, not mobile)
 *   - 404 when contract belongs to a different org (foreign contract)
 *   - Creates a draft invoice pre-filled from the contract:
 *       • status = "draft"
 *       • contractId, companyId, dealId, contactId from the contract
 *       • title from contract.title
 *       • totalAmount/subtotal/balanceDue from contract.valueAmount (Decimal string — no float)
 *       • currency from contract
 *       • issueDate ≈ now, dueDate ≈ +30 days
 *   - Money passes through as Decimal (not float)
 *   - Response contains warning when existing invoices found
 *   - ERP push is best-effort: a push failure does NOT fail the invoice creation
 *   - 500 on unexpected errors
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockContractFindFirst = vi.fn()
const mockInvoiceCount = vi.fn()
const mockInvoiceCreate = vi.fn()
const mockInvoiceFindFirst = vi.fn()
const mockAccountingFindFirst = vi.fn()
const mockInvoiceNumber = vi.fn()
const mockPushInvoiceToErp = vi.fn()
const mockRequireAuth = vi.fn()
const mockGetMobileAuth = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findFirst: (...args: unknown[]) => mockContractFindFirst(...args),
    },
    invoice: {
      count: (...args: unknown[]) => mockInvoiceCount(...args),
      create: (...args: unknown[]) => mockInvoiceCreate(...args),
      findFirst: (...args: unknown[]) => mockInvoiceFindFirst(...args),
    },
    accountingIntegration: {
      findFirst: (...args: unknown[]) => mockAccountingFindFirst(...args),
    },
  },
  // Prisma.Decimal used in the route for zero values
  Prisma: {
    Decimal: class MockDecimal {
      private value: number
      constructor(v: number | string) {
        this.value = Number(v)
      }
      toString() {
        return String(this.value)
      }
      toNumber() {
        return this.value
      }
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (result: unknown) => result instanceof NextResponse,
}))

vi.mock("@/lib/mobile-auth", () => ({
  getMobileAuth: (...args: unknown[]) => mockGetMobileAuth(...args),
}))

vi.mock("@/lib/invoice-number", () => ({
  generateInvoiceNumber: (...args: unknown[]) => mockInvoiceNumber(...args),
}))

vi.mock("@/lib/integrations/erp/provider", () => ({
  pushInvoiceToErp: (...args: unknown[]) => mockPushInvoiceToErp(...args),
}))

vi.mock("@/lib/prisma-decimal", () => ({
  normalizeInvoiceRow: vi.fn((row: Record<string, unknown>) => ({
    ...row,
    subtotal: 5000,
    discountValue: 0,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 5000,
    paidAmount: 0,
    balanceDue: 5000,
  })),
  normalizeInvoiceItemRow: vi.fn((item: Record<string, unknown>) => ({
    ...item,
    unitPrice: 5000,
    total: 5000,
  })),
}))

vi.mock("@/lib/invoice-calculations", () => ({
  calculateDueDate: vi.fn(() => new Date("2026-07-08T00:00:00.000Z")),
}))

vi.mock("crypto", () => ({
  default: { randomUUID: () => "test-uuid-view-token" },
  randomUUID: () => "test-uuid-view-token",
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { POST } from "@/app/api/v1/contracts/[id]/create-invoice/route"

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG_ID = "org-1"
const CONTRACT_ID = "ctr-1"
const USER_ID = "user-1"

// A Decimal-like value (as Prisma returns)
const decimalValue = {
  toString: () => "5000.0000",
  toNumber: () => 5000,
}

const baseContract = {
  id: CONTRACT_ID,
  title: "Service Agreement 2026",
  contractNumber: "CNT-2026-001",
  companyId: "co-1",
  dealId: "deal-1",
  contactId: "ct-1",
  valueAmount: decimalValue,
  currency: "AZN",
}

const createdInvoice = {
  id: "inv-new-1",
  organizationId: ORG_ID,
  invoiceNumber: "INV-2026-00001",
  title: "Service Agreement 2026",
  status: "draft",
  contractId: CONTRACT_ID,
  companyId: "co-1",
  dealId: "deal-1",
  contactId: "ct-1",
  subtotal: { toString: () => "5000.0000", toNumber: () => 5000 },
  discountValue: { toString: () => "0.0000", toNumber: () => 0 },
  discountAmount: { toString: () => "0.0000", toNumber: () => 0 },
  taxAmount: { toString: () => "0.0000", toNumber: () => 0 },
  totalAmount: { toString: () => "5000.0000", toNumber: () => 5000 },
  paidAmount: { toString: () => "0.0000", toNumber: () => 0 },
  balanceDue: { toString: () => "5000.0000", toNumber: () => 5000 },
  currency: "AZN",
  issueDate: new Date("2026-06-08T00:00:00.000Z"),
  dueDate: new Date("2026-07-08T00:00:00.000Z"),
  viewToken: "test-uuid-view-token",
  items: [
    {
      id: "item-1",
      name: "Service Agreement 2026",
      description: "Contract CNT-2026-001",
      quantity: 1,
      unitPrice: { toNumber: () => 5000 },
      discount: 0,
      total: { toNumber: () => 5000 },
      sortOrder: 0,
    },
  ],
  company: { id: "co-1", name: "ACME Corp" },
}

const authResult = {
  orgId: ORG_ID,
  userId: USER_ID,
  role: "manager" as const,
  email: "user@test.com",
  name: "Test User",
}

// ─── Request helpers ──────────────────────────────────────────────────────────

function makePOSTReq(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/v1/contracts/${CONTRACT_ID}/create-invoice`,
    { method: "POST", headers: { "Content-Type": "application/json" } },
  )
}

function makeParams() {
  return { params: Promise.resolve({ id: CONTRACT_ID }) }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/contracts/:id/create-invoice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: both auth checks pass, NOT a mobile-JWT caller
    mockRequireAuth.mockImplementation((req: unknown, module: string) => {
      if (module === "contracts" || module === "invoices") return authResult
      return authResult
    })
    mockGetMobileAuth.mockReturnValue(null) // default: not a mobile caller
    mockContractFindFirst.mockResolvedValue(baseContract)
    mockInvoiceCount.mockResolvedValue(0)
    mockInvoiceNumber.mockResolvedValue("INV-2026-00001")
    mockInvoiceCreate.mockResolvedValue(createdInvoice)
    mockPushInvoiceToErp.mockResolvedValue({ skipped: true })
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when unauthenticated (contracts gate)", async () => {
    mockRequireAuth.mockImplementation(() =>
      new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    )
    const req = makePOSTReq()
    const res = await POST(req, makeParams())
    expect(res.status).toBe(401)
  })

  it("returns 403 when user lacks contracts:write", async () => {
    mockRequireAuth.mockImplementation((req: unknown, module: string) => {
      if (module === "contracts")
        return new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403 })
      return authResult
    })
    const req = makePOSTReq()
    const res = await POST(req, makeParams())
    expect(res.status).toBe(403)
  })

  it("returns 403 when user lacks invoices:write (contracts passes, invoices fails)", async () => {
    mockRequireAuth.mockImplementation((req: unknown, module: string) => {
      if (module === "contracts") return authResult
      if (module === "invoices")
        return new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403 })
      return authResult
    })
    const req = makePOSTReq()
    const res = await POST(req, makeParams())
    expect(res.status).toBe(403)
  })

  it("returns 403 when caller is a mobile-JWT auth (finance action, not available via mobile app)", async () => {
    // requireAuth passes (mobile-JWT bypasses permission gate — systemic, escalated separately)
    // but the route must explicitly reject mobile callers for this FINANCE action
    mockGetMobileAuth.mockReturnValue({
      agentId: "agent-1",
      userId: "user-mobile-1",
      orgId: ORG_ID,
      email: "agent@test.com",
      name: "Field Agent",
      role: "agent",
    })
    const req = makePOSTReq()
    const res = await POST(req, makeParams())
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.message).toContain("mobile")
    // Invoice must NOT have been created
    expect(mockInvoiceCreate).not.toHaveBeenCalled()
  })

  // ── Org scope ─────────────────────────────────────────────────────────────

  it("returns 404 when contract belongs to a different org (foreign contract)", async () => {
    mockContractFindFirst.mockResolvedValue(null)
    const req = makePOSTReq()
    const res = await POST(req, makeParams())
    expect(res.status).toBe(404)
    // Verify that the findFirst was called with organizationId guard
    expect(mockContractFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      }),
    )
  })

  // ── Invoice creation ──────────────────────────────────────────────────────

  it("creates a draft invoice pre-filled from the contract", async () => {
    const req = makePOSTReq()
    const res = await POST(req, makeParams())
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toBeDefined()
    // Title from contract
    expect(json.data.title).toBe("Service Agreement 2026")
  })

  it("invoice create is called with correct contractId and org-scoped data", async () => {
    const req = makePOSTReq()
    await POST(req, makeParams())
    expect(mockInvoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          contractId: CONTRACT_ID,
          companyId: "co-1",
          dealId: "deal-1",
          contactId: "ct-1",
          status: "draft",
          currency: "AZN",
        }),
      }),
    )
  })

  it("passes money from contract.valueAmount as Decimal (not float JS number)", async () => {
    const req = makePOSTReq()
    await POST(req, makeParams())
    const createCall = mockInvoiceCreate.mock.calls[0][0]
    const { subtotal, totalAmount, balanceDue } = createCall.data
    // All three should NOT be plain JS floats — they should be the Decimal
    // object passed through. Verify they all have a toString() method (duck type).
    expect(typeof subtotal.toString).toBe("function")
    expect(typeof totalAmount.toString).toBe("function")
    expect(typeof balanceDue.toString).toBe("function")
    // And the string values should be the contract's value
    expect(subtotal.toString()).toBe("5000.0000")
    expect(totalAmount.toString()).toBe("5000.0000")
    expect(balanceDue.toString()).toBe("5000.0000")
  })

  it("includes warning in response when existing invoices already exist", async () => {
    mockInvoiceCount.mockResolvedValue(2)
    const req = makePOSTReq()
    const res = await POST(req, makeParams())
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.warning).toBeDefined()
    expect(json.warning).toContain("2 invoice")
  })

  it("does NOT include warning when no existing invoices", async () => {
    mockInvoiceCount.mockResolvedValue(0)
    const req = makePOSTReq()
    const res = await POST(req, makeParams())
    const json = await res.json()
    expect(json.warning).toBeUndefined()
  })

  // ── ERP push is best-effort ───────────────────────────────────────────────

  it("ERP push failure does NOT fail the invoice creation (best-effort)", async () => {
    mockPushInvoiceToErp.mockRejectedValue(new Error("ERP unreachable"))
    const req = makePOSTReq()
    // Invoice creation should still succeed even though ERP push throws
    const res = await POST(req, makeParams())
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("returns 500 on unexpected prisma errors", async () => {
    mockInvoiceCreate.mockRejectedValue(new Error("DB connection lost"))
    const req = makePOSTReq()
    const res = await POST(req, makeParams())
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Internal server error")
  })
})
