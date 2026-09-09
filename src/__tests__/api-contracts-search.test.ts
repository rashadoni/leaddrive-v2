import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

// FIX 1: route now uses requireAuth + isAuthError
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))
vi.mock("@/lib/contract-lifecycle/upsert-renewal-alerts", () => ({ upsertRenewalAlerts: vi.fn().mockResolvedValue(undefined) }))

import { GET } from "@/app/api/v1/contracts/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"

function makeReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

const AUTH_OK = { orgId: "org-1", userId: "u-1", role: "admin", email: "a@b.com", name: "Admin" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK as any)
  vi.mocked(isAuthError).mockImplementation((r): r is NextResponse => r instanceof NextResponse)
  vi.mocked(prisma.contract.findMany).mockResolvedValue([])
  vi.mocked(prisma.contract.count).mockResolvedValue(0)
})

function getWhereArg() {
  return (vi.mocked(prisma.contract.findMany).mock.calls[0][0] as any).where
}
function getIncludeArg() {
  return (vi.mocked(prisma.contract.findMany).mock.calls[0][0] as any).include
}
function getOrderByArg() {
  return (vi.mocked(prisma.contract.findMany).mock.calls[0][0] as any).orderBy
}

// ─── Full-text search ────────────────────────────────────────────────

describe("GET /contracts — full-text search", () => {
  it("no search param → no OR clause", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    const where = getWhereArg()
    expect(where.OR).toBeUndefined()
    expect(where.organizationId).toBe("org-1")
  })

  it("search param builds OR across 5 fields", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?search=acme"))
    const where = getWhereArg()
    expect(where.OR).toHaveLength(5)
    const fields = where.OR.map((c: any) => Object.keys(c)[0])
    expect(fields).toContain("title")
    expect(fields).toContain("contractNumber")
    expect(fields).toContain("notes")
    expect(fields).toContain("renderedBody")
    expect(fields).toContain("company")
    // company is nested
    const companyClause = where.OR.find((c: any) => c.company)
    expect(companyClause.company.name.contains).toBe("acme")
    // all are case-insensitive
    for (const clause of where.OR) {
      const val = Object.values(clause)[0] as any
      const nested = val?.name ?? val
      expect(nested.mode).toBe("insensitive")
    }
  })

  it("org-scoping always present", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?search=test"))
    expect(getWhereArg().organizationId).toBe("org-1")
  })
})

// ─── Tag filter ──────────────────────────────────────────────────────

describe("GET /contracts — tagIds filter", () => {
  it("no tagIds → no tags filter", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    expect(getWhereArg().tags).toBeUndefined()
  })

  it("single tagId builds some filter", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?tagIds=t1"))
    const where = getWhereArg()
    expect(where.tags).toEqual({ some: { id: { in: ["t1"] }, organizationId: "org-1" } })
  })

  it("multiple tagIds are all passed in the IN list", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?tagIds=t1,t2,t3"))
    const where = getWhereArg()
    expect(where.tags.some.id.in).toEqual(["t1", "t2", "t3"])
  })
})

// ─── Value range ─────────────────────────────────────────────────────

describe("GET /contracts — value range filters", () => {
  it("valueMin alone sets gte", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?valueMin=1000"))
    const where = getWhereArg()
    expect(where.valueAmount.gte).toBe(1000)
    expect(where.valueAmount.lte).toBeUndefined()
  })

  it("valueMax alone sets lte", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?valueMax=50000"))
    const where = getWhereArg()
    expect(where.valueAmount.lte).toBe(50000)
    expect(where.valueAmount.gte).toBeUndefined()
  })

  it("both valueMin and valueMax set gte+lte", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?valueMin=500&valueMax=10000"))
    const where = getWhereArg()
    expect(where.valueAmount.gte).toBe(500)
    expect(where.valueAmount.lte).toBe(10000)
  })

  it("invalid valueMin (NaN) is ignored — no valueAmount filter", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?valueMin=abc"))
    const where = getWhereArg()
    expect(where.valueAmount).toBeUndefined()
  })
})

// ─── Date range filters ───────────────────────────────────────────────

describe("GET /contracts — date range filters", () => {
  it("startFrom + startTo sets startDate range", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?startFrom=2025-01-01&startTo=2025-12-31"))
    const where = getWhereArg()
    expect(where.startDate.gte).toBeInstanceOf(Date)
    expect(where.startDate.lte).toBeInstanceOf(Date)
  })

  it("endFrom + endTo sets endDate range", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?endFrom=2026-01-01&endTo=2026-12-31"))
    const where = getWhereArg()
    expect(where.endDate.gte).toBeInstanceOf(Date)
    expect(where.endDate.lte).toBeInstanceOf(Date)
  })

  it("invalid date string is ignored — no startDate filter", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?startFrom=not-a-date"))
    const where = getWhereArg()
    expect(where.startDate).toBeUndefined()
  })
})

// ─── Type filter ──────────────────────────────────────────────────────

describe("GET /contracts — type filter", () => {
  it("passes type to where clause", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?type=nda"))
    expect(getWhereArg().type).toBe("nda")
  })

  it("no type param → no type in where", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    expect(getWhereArg().type).toBeUndefined()
  })
})

// ─── Include tags ─────────────────────────────────────────────────────

describe("GET /contracts — includes tags", () => {
  it("always includes org-filtered tags in the findMany call (FIX 2)", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    const include = getIncludeArg()
    expect(include.tags).toBeDefined()
    // FIX 2: tags must carry a where: { organizationId } scope
    expect(include.tags.where).toEqual({ organizationId: "org-1" })
    expect(include.tags.select).toEqual({ id: true, name: true, color: true })
  })
})

// ─── Existing filters still work ──────────────────────────────────────

describe("GET /contracts — existing filters still work", () => {
  it("status filter still applied", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?status=active"))
    expect(getWhereArg().status).toBe("active")
  })

  it("companyId filter still applied", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?companyId=comp-1"))
    expect(getWhereArg().companyId).toBe("comp-1")
  })

  it("sort by value_desc produces correct orderBy", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?sortBy=value_desc"))
    expect(getOrderByArg()).toEqual({ valueAmount: "desc" })
  })

  it("pagination still works", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?page=3&limit=10"))
    const call = vi.mocked(prisma.contract.findMany).mock.calls[0][0] as any
    expect(call.skip).toBe(20)
    expect(call.take).toBe(10)
  })
})
