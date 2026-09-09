/**
 * CLM Slice 5c — Tests for GET /api/v1/contract-analytics
 *
 * Coverage:
 *   - 401 when unauthenticated
 *   - 403 when user lacks contracts read permission
 *   - All prisma queries carry organizationId (org-scoped)
 *   - summary fields computed correctly
 *   - renewalRate handles 0-denominator (null)
 *   - money sums via Prisma _sum (no Number()-sum of many Decimals)
 *   - byType, cohorts, approvalFlow, deviationRisk sections present
 *   - date filter params forwarded (from/to on createdAt)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    contractDeviationFlag: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

vi.mock("@/lib/prisma-decimal", () => ({
  decimalToNumber: vi.fn((v: unknown) => {
    if (v == null) return 0
    if (typeof v === "number") return v
    if (typeof v === "object" && typeof (v as any).toNumber === "function") {
      return (v as any).toNumber()
    }
    return Number(v)
  }),
  decimalToNumberNullable: vi.fn((v: unknown) => {
    if (v == null) return null
    if (typeof v === "number") return v
    if (typeof v === "object" && typeof (v as any).toNumber === "function") {
      return (v as any).toNumber()
    }
    return Number(v)
  }),
}))

import { GET } from "@/app/api/v1/contract-analytics/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(url = "http://localhost/api/v1/contract-analytics"): NextRequest {
  return new NextRequest(url, {
    method: "GET",
    headers: { "Content-Type": "application/json", "x-organization-id": "org-1" },
  })
}

const authRead = { orgId: "org-1", userId: "user-1" }
const auth401 = new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
const auth403 = new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403 })

/** A Prisma Decimal-like object */
function makeDecimal(n: number) {
  return { toNumber: () => n, toFixed: (d: number) => n.toFixed(d) }
}

// ─── Default mock data ────────────────────────────────────────────────────────

function setupDefaultMocks() {
  // aggregate: liveCount=3, totalValue=Decimal(30000)
  vi.mocked((prisma as any).contract.aggregate).mockResolvedValue({
    _sum: { valueAmount: makeDecimal(30000) },
    _count: { id: 3 },
  })

  // findMany for liveContracts (MRR calc)
  vi.mocked((prisma as any).contract.findMany).mockImplementation(async (args: any) => {
    // If where has signedAt: { not: null } → cycle time sample
    if (args?.where?.signedAt) {
      return [
        {
          createdAt: new Date("2026-01-01"),
          signedAt: new Date("2026-01-08"), // 7 days
        },
        {
          createdAt: new Date("2026-02-01"),
          signedAt: new Date("2026-02-11"), // 10 days
        },
      ]
    }
    // Otherwise → live contracts for MRR
    return [
      {
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        valueAmount: makeDecimal(12000),
        currency: "USD",
      },
      {
        startDate: null,
        endDate: null,
        valueAmount: makeDecimal(6000),
        currency: "USD",
      },
    ]
  })

  // count for renewedCount, expiredCount, expiringSoonCount
  vi.mocked((prisma as any).contract.count)
    .mockResolvedValueOnce(8)   // renewedCount
    .mockResolvedValueOnce(2)   // expiredCount
    .mockResolvedValueOnce(1)   // expiringSoonCount

  // contractDeviationFlag.count → openDeviationCount
  vi.mocked((prisma as any).contractDeviationFlag.count).mockResolvedValue(5)

  // contract.groupBy for byType
  vi.mocked((prisma as any).contract.groupBy).mockImplementation(async (args: any) => {
    if (args?.by?.includes("type")) {
      return [
        { type: "service_agreement", _count: { id: 2 }, _sum: { valueAmount: makeDecimal(20000) } },
        { type: "nda", _count: { id: 1 }, _sum: { valueAmount: makeDecimal(10000) } },
      ]
    }
    if (args?.by?.includes("status")) {
      return [
        { status: "active", _count: { id: 3 } },
        { status: "draft", _count: { id: 2 } },
        { status: "pending_approval", _count: { id: 1 } },
      ]
    }
    return []
  })

  // contractDeviationFlag.groupBy by severity
  vi.mocked((prisma as any).contractDeviationFlag.groupBy).mockResolvedValue([
    { severity: "critical", _count: { id: 3 } },
    { severity: "warning", _count: { id: 2 } },
  ])

  // findMany for cohorts (endDate buckets)
  // Override so the last call (cohorts) returns proper data
  // We mock with a fresh call after the signed-at + live ones
  vi.mocked((prisma as any).contract.findMany)
    .mockResolvedValueOnce([
      // First call: liveContracts for MRR
      {
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        valueAmount: makeDecimal(12000),
        currency: "USD",
      },
    ])
    .mockResolvedValueOnce([
      // Second call: signed cycle time sample
      {
        createdAt: new Date("2026-01-01"),
        signedAt: new Date("2026-01-08"),
      },
    ])
    .mockResolvedValueOnce([
      // Third call: cohorts
      {
        endDate: new Date("2026-09-15"),
        valueAmount: makeDecimal(10000),
      },
      {
        endDate: new Date("2026-09-20"),
        valueAmount: makeDecimal(5000),
      },
    ])
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(authRead as any)
  setupDefaultMocks()
})

// ─── Auth tests ───────────────────────────────────────────────────────────────

describe("GET /api/v1/contract-analytics — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth401 as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it("returns 403 when user lacks contracts read permission", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth403 as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it("returns 200 for authenticated read user", async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
  })
})

// ─── Org-scoped tests ─────────────────────────────────────────────────────────

describe("GET /api/v1/contract-analytics — org scoping", () => {
  it("passes organizationId to contract.aggregate", async () => {
    await GET(makeReq())
    expect(vi.mocked((prisma as any).contract.aggregate)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )
  })

  it("counts only active/renewing contracts as live value", async () => {
    await GET(makeReq())
    const aggCall = vi.mocked((prisma as any).contract.aggregate).mock.calls[0][0]
    expect(aggCall.where.status.in).toEqual(["active", "renewing"])
  })

  it("passes organizationId to contractDeviationFlag.count", async () => {
    await GET(makeReq())
    expect(vi.mocked((prisma as any).contractDeviationFlag.count)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )
  })

  it("passes organizationId to contract.groupBy by-type", async () => {
    await GET(makeReq())
    const calls = vi.mocked((prisma as any).contract.groupBy).mock.calls
    const byTypeCall = calls.find((c: any) => c[0]?.by?.includes("type"))
    expect(byTypeCall).toBeDefined()
    expect(byTypeCall[0].where).toEqual(expect.objectContaining({ organizationId: "org-1" }))
  })

  it("passes organizationId to contractDeviationFlag.groupBy", async () => {
    await GET(makeReq())
    expect(vi.mocked((prisma as any).contractDeviationFlag.groupBy)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )
  })
})

// ─── Summary tests ────────────────────────────────────────────────────────────

describe("GET /api/v1/contract-analytics — summary", () => {
  it("returns liveCount from aggregate._count.id", async () => {
    vi.mocked((prisma as any).contract.aggregate).mockResolvedValue({
      _sum: { valueAmount: makeDecimal(0) },
      _count: { id: 7 },
    })
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json.summary.liveCount).toBe(7)
  })

  it("serialises totalValue as a decimal string (not float)", async () => {
    vi.mocked((prisma as any).contract.aggregate).mockResolvedValue({
      _sum: { valueAmount: makeDecimal(99999.99) },
      _count: { id: 1 },
    })
    const res = await GET(makeReq())
    const json = await res.json()
    // Must be a string (not a JS number) to preserve precision
    expect(typeof json.summary.totalValue).toBe("string")
    expect(json.summary.totalValue).toBe("99999.99")
  })

  it("returns totalValue '0.00' when _sum is null", async () => {
    vi.mocked((prisma as any).contract.aggregate).mockResolvedValue({
      _sum: { valueAmount: null },
      _count: { id: 0 },
    })
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json.summary.totalValue).toBe("0.00")
  })

  it("renewalRate is null when denominator is 0", async () => {
    // Full reset + re-setup with count=0 so renewed+expired=0
    vi.resetAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    vi.mocked((prisma as any).contract.aggregate).mockResolvedValue({
      _sum: { valueAmount: makeDecimal(0) }, _count: { id: 0 },
    })
    vi.mocked((prisma as any).contract.findMany).mockResolvedValue([])
    vi.mocked((prisma as any).contract.count).mockResolvedValue(0)
    vi.mocked((prisma as any).contractDeviationFlag.count).mockResolvedValue(0)
    vi.mocked((prisma as any).contract.groupBy).mockResolvedValue([])
    vi.mocked((prisma as any).contractDeviationFlag.groupBy).mockResolvedValue([])
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json.summary.renewalRate).toBeNull()
  })

  it("renewalRate computes correctly when denominator > 0", async () => {
    // Full reset + re-setup with specific counts: renewed=3, expired=1, expiringSoon=0
    vi.resetAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    vi.mocked((prisma as any).contract.aggregate).mockResolvedValue({
      _sum: { valueAmount: makeDecimal(0) }, _count: { id: 4 },
    })
    vi.mocked((prisma as any).contract.findMany).mockResolvedValue([])
    vi.mocked((prisma as any).contract.count)
      .mockResolvedValueOnce(3)   // renewedCount
      .mockResolvedValueOnce(1)   // expiredCount
      .mockResolvedValueOnce(0)   // expiringSoonCount
    vi.mocked((prisma as any).contractDeviationFlag.count).mockResolvedValue(0)
    vi.mocked((prisma as any).contract.groupBy).mockResolvedValue([])
    vi.mocked((prisma as any).contractDeviationFlag.groupBy).mockResolvedValue([])
    const res = await GET(makeReq())
    const json = await res.json()
    // 3/(3+1) = 75%
    expect(json.summary.renewalRate).toBe(75)
  })

  it("avgCycleTimeDays is null when no signed contracts", async () => {
    // Full reset + re-setup with all findMany returning empty
    vi.resetAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    vi.mocked((prisma as any).contract.aggregate).mockResolvedValue({
      _sum: { valueAmount: null }, _count: { id: 0 },
    })
    vi.mocked((prisma as any).contract.findMany).mockResolvedValue([])
    vi.mocked((prisma as any).contract.count).mockResolvedValue(0)
    vi.mocked((prisma as any).contractDeviationFlag.count).mockResolvedValue(0)
    vi.mocked((prisma as any).contract.groupBy).mockResolvedValue([])
    vi.mocked((prisma as any).contractDeviationFlag.groupBy).mockResolvedValue([])
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json.summary.avgCycleTimeDays).toBeNull()
  })

  it("openDeviations comes from contractDeviationFlag.count", async () => {
    vi.mocked((prisma as any).contractDeviationFlag.count).mockResolvedValue(9)
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json.summary.openDeviations).toBe(9)
  })
})

// ─── Money no-float tests ─────────────────────────────────────────────────────

describe("GET /api/v1/contract-analytics — money via Prisma _sum (no float)", () => {
  it("uses aggregate._sum for totalValue (not Number()-sum of many rows)", async () => {
    await GET(makeReq())
    // Verify aggregate was called — that's the Prisma _sum path
    const aggCalls = vi.mocked((prisma as any).contract.aggregate).mock.calls
    expect(aggCalls.length).toBeGreaterThan(0)
    // The live contract findMany must NOT be used to sum values
    // (it's used only for MRR duration calc) — we don't accumulate totalValue in JS
    const aggCall = aggCalls[0]
    expect(aggCall[0]._sum).toBeDefined()
    expect(aggCall[0]._sum.valueAmount).toBe(true)
  })

  it("byType totalValue is serialised as string per-group", async () => {
    const res = await GET(makeReq())
    const json = await res.json()
    // Every byType row's totalValue must be a string
    for (const row of json.byType) {
      expect(typeof row.totalValue).toBe("string")
    }
  })
})

// ─── Section presence tests ───────────────────────────────────────────────────

describe("GET /api/v1/contract-analytics — sections", () => {
  it("response contains all required top-level sections", async () => {
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json).toHaveProperty("summary")
    expect(json).toHaveProperty("byType")
    expect(json).toHaveProperty("cohorts")
    expect(json).toHaveProperty("approvalFlow")
    expect(json).toHaveProperty("deviationRisk")
    expect(json).toHaveProperty("generatedAt")
  })

  it("byType contains type, count, totalValue", async () => {
    const res = await GET(makeReq())
    const json = await res.json()
    expect(Array.isArray(json.byType)).toBe(true)
    if (json.byType.length > 0) {
      const row = json.byType[0]
      expect(row).toHaveProperty("type")
      expect(row).toHaveProperty("count")
      expect(row).toHaveProperty("totalValue")
    }
  })

  it("approvalFlow contains status + count entries", async () => {
    const res = await GET(makeReq())
    const json = await res.json()
    expect(Array.isArray(json.approvalFlow)).toBe(true)
    for (const entry of json.approvalFlow) {
      expect(entry).toHaveProperty("status")
      expect(entry).toHaveProperty("count")
      expect(entry.count).toBeGreaterThan(0) // zero-count filtered out
    }
  })

  it("deviationRisk has all three severity levels", async () => {
    const res = await GET(makeReq())
    const json = await res.json()
    const severities = json.deviationRisk.map((r: any) => r.severity)
    expect(severities).toContain("critical")
    expect(severities).toContain("warning")
    expect(severities).toContain("info")
  })

  it("cohorts contains period, count, value", async () => {
    const res = await GET(makeReq())
    const json = await res.json()
    expect(Array.isArray(json.cohorts)).toBe(true)
    if (json.cohorts.length > 0) {
      const row = json.cohorts[0]
      expect(row).toHaveProperty("period")
      expect(row).toHaveProperty("count")
      expect(row).toHaveProperty("value")
    }
  })
})

// ─── Date filter tests ────────────────────────────────────────────────────────

describe("GET /api/v1/contract-analytics — date filter", () => {
  it("passes from/to as createdAt filter to aggregate", async () => {
    const req = makeReq(
      "http://localhost/api/v1/contract-analytics?from=2026-01-01&to=2026-06-30"
    )
    await GET(req)
    const aggCall = vi.mocked((prisma as any).contract.aggregate).mock.calls[0]
    expect(aggCall[0].where.createdAt).toBeDefined()
    expect(aggCall[0].where.createdAt.gte).toEqual(new Date("2026-01-01"))
    expect(aggCall[0].where.createdAt.lte).toEqual(new Date("2026-06-30"))
  })

  it("does not add createdAt filter when no params", async () => {
    await GET(makeReq())
    const aggCall = vi.mocked((prisma as any).contract.aggregate).mock.calls[0]
    expect(aggCall[0].where.createdAt).toBeUndefined()
  })
})
