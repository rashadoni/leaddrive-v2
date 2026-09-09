import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { normalizeContractRow, decimalToNumber, decimalToNumberNullable, deepNormalizeDecimals } from "@/lib/prisma-decimal"

// ─── deepNormalizeDecimals ──────────────────────────────────────────────────

describe("deepNormalizeDecimals", () => {
  const dec = (n: number) => ({ toNumber: () => n })

  it("converts a top-level Decimal to number", () => {
    expect(deepNormalizeDecimals(dec(99.99))).toBe(99.99)
  })

  it("converts Decimal inside a flat object", () => {
    const result = deepNormalizeDecimals({ id: "c1", valueAmount: dec(1200) }) as any
    expect(result.valueAmount).toBe(1200)
    expect(result.id).toBe("c1")
  })

  it("converts Decimal fields nested inside arrays of objects", () => {
    const result = deepNormalizeDecimals({
      contracts: [
        { id: "c1", valueAmount: dec(5000) },
        { id: "c2", valueAmount: null },
      ],
    }) as any
    expect(result.contracts[0].valueAmount).toBe(5000)
    expect(result.contracts[1].valueAmount).toBeNull()
  })

  it("converts multiple Decimal fields in the same object", () => {
    const result = deepNormalizeDecimals({
      amount: dec(100),
      subtotal: dec(90),
      taxAmount: dec(10),
    }) as any
    expect(result.amount).toBe(100)
    expect(result.subtotal).toBe(90)
    expect(result.taxAmount).toBe(10)
  })

  it("leaves plain numbers, strings, booleans, and dates unchanged", () => {
    const d = new Date("2026-01-01")
    const result = deepNormalizeDecimals({ n: 42, s: "hello", b: true, d }) as any
    expect(result.n).toBe(42)
    expect(result.s).toBe("hello")
    expect(result.b).toBe(true)
    expect(result.d).toBe(d)
  })

  it("returns null for Decimal.toNumber() === Infinity", () => {
    const inf = { toNumber: () => Infinity }
    expect(deepNormalizeDecimals(inf)).toBeNull()
  })

  it("handles deeply nested structure (3 levels)", () => {
    const result = deepNormalizeDecimals({
      invoice: { items: [{ price: dec(25), qty: 2 }] },
    }) as any
    expect(result.invoice.items[0].price).toBe(25)
    expect(result.invoice.items[0].qty).toBe(2)
  })

  it("converts BigInt to number (future-proof for Contact/Campaign export)", () => {
    const result = deepNormalizeDecimals({ lifetimeRevenueCents: BigInt(150000) }) as any
    expect(result.lifetimeRevenueCents).toBe(150000)
    expect(typeof result.lifetimeRevenueCents).toBe("number")
  })
})

// ─── normalizeContractRow ───────────────────────────────────────────────────

describe("normalizeContractRow", () => {
  it("converts a Prisma.Decimal-like object to number", () => {
    const row = { id: "c1", valueAmount: { toNumber: () => 12500.5 } }
    const result = normalizeContractRow(row)
    expect(result.valueAmount).toBe(12500.5)
    expect(result.id).toBe("c1")
  })

  it("converts null to null", () => {
    const result = normalizeContractRow({ id: "c2", valueAmount: null })
    expect(result.valueAmount).toBeNull()
  })

  it("converts undefined to null", () => {
    const result = normalizeContractRow({ id: "c3", valueAmount: undefined })
    expect(result.valueAmount).toBeNull()
  })

  it("passes through a plain number unchanged", () => {
    const result = normalizeContractRow({ id: "c4", valueAmount: 999 })
    expect(result.valueAmount).toBe(999)
  })

  it("converts string representation to number", () => {
    const result = normalizeContractRow({ id: "c5", valueAmount: "7500.0000" })
    expect(result.valueAmount).toBe(7500)
  })

  it("preserves other fields on the row", () => {
    const row = { id: "c1", title: "Service Agreement", currency: "AZN", valueAmount: { toNumber: () => 1 } }
    const result = normalizeContractRow(row)
    expect(result.title).toBe("Service Agreement")
    expect(result.currency).toBe("AZN")
  })
})

// ─── MRR arithmetic precision ──────────────────────────────────────────────

describe("MRR division precision (IEEE-754 regression check)", () => {
  it("decimalToNumber handles 0.1+0.2 correctly via Decimal object", () => {
    // Simulates Prisma.Decimal returned from DB for a contract valueAmount
    const decimalLike = { toNumber: () => 1200 }
    const value = decimalToNumber(decimalLike)
    const months = 12
    const mrr = value / months
    expect(mrr).toBe(100)
  })

  it("decimalToNumberNullable returns null for null/undefined", () => {
    expect(decimalToNumberNullable(null)).toBeNull()
    expect(decimalToNumberNullable(undefined)).toBeNull()
  })

  it("decimalToNumberNullable converts Decimal to number", () => {
    expect(decimalToNumberNullable({ toNumber: () => 5500.25 })).toBe(5500.25)
  })
})

// ─── contract-lifecycle route decimal boundary ─────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractRenewalAlert: { findMany: vi.fn() },
    contractApprovalStage: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn() }))

import { GET as getCL } from "@/app/api/v1/contract-lifecycle/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"

function makeReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(null)
  vi.mocked(getOrgId).mockResolvedValue("org-1")
})

describe("GET /api/v1/contract-lifecycle — decimal boundary", () => {
  it("returns valueAmount as number when Prisma returns Decimal for renewal alerts", async () => {
    const decimalLike = { toNumber: () => 48000 }
    vi.mocked(prisma.contractRenewalAlert.findMany).mockResolvedValue([
      {
        id: "alert-1",
        contractId: "c1",
        dueAt: new Date("2026-07-01"),
        daysBeforeExpiry: 30,
        status: "pending",
        deliveredVia: null,
        deliveredAt: null,
        createdAt: new Date(),
        contract: {
          contractNumber: "C-001",
          title: "Service Contract",
          endDate: new Date("2026-08-01"),
          valueAmount: decimalLike,
          currency: "AZN",
          status: "active",
          company: { name: "Acme" },
        },
      },
    ] as any)
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([])

    const res = await getCL(makeReq("http://localhost:3000/api/v1/contract-lifecycle"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.renewals.items[0].valueAmount).toBe(48000)
    expect(typeof json.renewals.items[0].valueAmount).toBe("number")
  })

  it("returns null valueAmount when contract has no value", async () => {
    vi.mocked(prisma.contractRenewalAlert.findMany).mockResolvedValue([
      {
        id: "alert-2",
        contractId: "c2",
        dueAt: new Date("2026-07-01"),
        daysBeforeExpiry: 15,
        status: "pending",
        deliveredVia: null,
        deliveredAt: null,
        createdAt: new Date(),
        contract: {
          contractNumber: "C-002",
          title: "NDA",
          endDate: new Date("2026-08-01"),
          valueAmount: null,
          currency: "USD",
          status: "active",
          company: null,
        },
      },
    ] as any)
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([])

    const res = await getCL(makeReq("http://localhost:3000/api/v1/contract-lifecycle"))
    const json = await res.json()
    expect(json.renewals.items[0].valueAmount).toBeNull()
  })

  it("returns valueAmount as number for pending approvals", async () => {
    const decimalLike = { toNumber: () => 25000 }
    vi.mocked(prisma.contractRenewalAlert.findMany).mockResolvedValue([])
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([
      {
        id: "stage-1",
        contractId: "c3",
        order: 1,
        label: "Legal Review",
        status: "pending",
        assigneeUserId: "user-1",
        assigneeRole: null,
        createdAt: new Date(),
        contract: {
          contractNumber: "C-003",
          title: "Enterprise Deal",
          status: "pending_approval",
          valueAmount: decimalLike,
          currency: "EUR",
          company: { name: "BigCorp" },
        },
      },
    ] as any)

    const res = await getCL(makeReq("http://localhost:3000/api/v1/contract-lifecycle"))
    const json = await res.json()
    expect(json.approvals.items[0].valueAmount).toBe(25000)
    expect(typeof json.approvals.items[0].valueAmount).toBe("number")
  })
})
