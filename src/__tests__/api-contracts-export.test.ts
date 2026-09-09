/**
 * CLM Slice 7b — Tests for GET /api/v1/contracts/export
 *
 * Coverage:
 *   - 401 when unauthenticated
 *   - 403 when user lacks contracts read permission
 *   - org-scoped: prisma.contract.findMany called with organizationId from auth
 *   - All supported filters passed through to where clause
 *   - Row cap: take: 10000 applied
 *   - Returns application/vnd…spreadsheetml.sheet content-type
 *   - Returns Content-Disposition: attachment header
 *   - Money (valueAmount) via decimalToNumber — no float accumulation
 *   - 500 on unexpected errors
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(),
    },
  },
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

// ExcelJS mock: minimal buffer.
// Workbook is mocked with a regular function (not arrow) so it can be used as a constructor.
vi.mock("exceljs", () => {
  const mockWorksheet = {
    columns: [],
    getRow: vi.fn().mockReturnValue({ font: {} }),
    addRow: vi.fn(),
  }
  function WorkbookMock(this: any) {
    this.creator = ""
    this.created = null
    this.addWorksheet = vi.fn().mockReturnValue(mockWorksheet)
    this.xlsx = {
      writeBuffer: vi.fn().mockResolvedValue(Buffer.from("FAKE_XLSX")),
    }
  }
  return {
    default: {
      Workbook: WorkbookMock,
    },
  }
})

import { GET } from "@/app/api/v1/contracts/export/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(url = "http://localhost/api/v1/contracts/export"): NextRequest {
  return new NextRequest(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-organization-id": "org-1",
    },
  })
}

const authRead = { orgId: "org-1", userId: "user-1" }
const auth401 = new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
  status: 401,
})
const auth403 = new NextResponse(JSON.stringify({ error: "Forbidden" }), {
  status: 403,
})

function makeDecimal(n: number) {
  return { toNumber: () => n, toFixed: (d: number) => n.toFixed(d) }
}

const mockContracts = [
  {
    id: "c-1",
    contractNumber: "CLM-001",
    title: "Service Agreement",
    company: { name: "Acme Corp" },
    type: "service_agreement",
    status: "active",
    valueAmount: makeDecimal(50000),
    currency: "USD",
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-12-31"),
    tags: [{ name: "Priority" }, { name: "Q1" }],
  },
  {
    id: "c-2",
    contractNumber: "CLM-002",
    title: "NDA",
    company: null,
    type: "nda",
    status: "draft",
    valueAmount: null,
    currency: "USD",
    startDate: null,
    endDate: null,
    tags: [],
  },
]

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(authRead as any)
  vi.mocked((prisma as any).contract.findMany).mockResolvedValue(mockContracts)
})

// ─── Auth tests ───────────────────────────────────────────────────────────────

describe("GET /api/v1/contracts/export — auth", () => {
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

describe("GET /api/v1/contracts/export — org scoping", () => {
  it("passes organizationId from auth to prisma.contract.findMany", async () => {
    await GET(makeReq())
    const calls = vi.mocked((prisma as any).contract.findMany).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0][0].where.organizationId).toBe("org-1")
  })

  it("does NOT call prisma when auth fails (401)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth401 as any)
    await GET(makeReq())
    expect(vi.mocked((prisma as any).contract.findMany)).not.toHaveBeenCalled()
  })
})

// ─── Row cap test ─────────────────────────────────────────────────────────────

describe("GET /api/v1/contracts/export — row cap", () => {
  it("applies take: 10000 to prevent memory blowup", async () => {
    await GET(makeReq())
    const call = vi.mocked((prisma as any).contract.findMany).mock.calls[0]
    expect(call[0].take).toBe(10_000)
  })
})

// ─── Filter forwarding tests ──────────────────────────────────────────────────

describe("GET /api/v1/contracts/export — filters", () => {
  it("forwards status filter to where clause", async () => {
    const req = makeReq("http://localhost/api/v1/contracts/export?status=active")
    await GET(req)
    const call = vi.mocked((prisma as any).contract.findMany).mock.calls[0]
    expect(call[0].where.status).toBe("active")
  })

  it("returns 400 for an invalid status filter", async () => {
    const req = makeReq("http://localhost/api/v1/contracts/export?status=expiring")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.code).toBe("INVALID_CONTRACT_STATUS")
    expect(vi.mocked((prisma as any).contract.findMany)).not.toHaveBeenCalled()
  })

  it("forwards type filter to where clause", async () => {
    const req = makeReq("http://localhost/api/v1/contracts/export?type=nda")
    await GET(req)
    const call = vi.mocked((prisma as any).contract.findMany).mock.calls[0]
    expect(call[0].where.type).toBe("nda")
  })

  it("forwards tagIds filter as tag some-in clause", async () => {
    const req = makeReq("http://localhost/api/v1/contracts/export?tagIds=tag-1,tag-2")
    await GET(req)
    const call = vi.mocked((prisma as any).contract.findMany).mock.calls[0]
    expect(call[0].where.tags).toEqual({
      some: { id: { in: ["tag-1", "tag-2"] }, organizationId: "org-1" },
    })
  })

  it("forwards hasDeviations=true as deviationFlags some-flagged clause", async () => {
    const req = makeReq(
      "http://localhost/api/v1/contracts/export?hasDeviations=true",
    )
    await GET(req)
    const call = vi.mocked((prisma as any).contract.findMany).mock.calls[0]
    expect(call[0].where.deviationFlags).toEqual({
      some: { status: "flagged", organizationId: "org-1" },
    })
  })

  it("does not add tag filter when tagIds is absent", async () => {
    await GET(makeReq())
    const call = vi.mocked((prisma as any).contract.findMany).mock.calls[0]
    expect(call[0].where.tags).toBeUndefined()
  })

  it("forwards valueMin/valueMax to valueAmount range", async () => {
    const req = makeReq(
      "http://localhost/api/v1/contracts/export?valueMin=1000&valueMax=5000",
    )
    await GET(req)
    const call = vi.mocked((prisma as any).contract.findMany).mock.calls[0]
    expect(call[0].where.valueAmount).toEqual({ gte: 1000, lte: 5000 })
  })

  it("forwards startFrom/startTo to startDate range", async () => {
    const req = makeReq(
      "http://localhost/api/v1/contracts/export?startFrom=2026-01-01&startTo=2026-06-30",
    )
    await GET(req)
    const call = vi.mocked((prisma as any).contract.findMany).mock.calls[0]
    expect(call[0].where.startDate).toEqual({
      gte: new Date("2026-01-01"),
      lte: new Date("2026-06-30"),
    })
  })

  it("forwards endFrom/endTo to endDate range", async () => {
    const req = makeReq(
      "http://localhost/api/v1/contracts/export?endFrom=2026-07-01&endTo=2026-12-31",
    )
    await GET(req)
    const call = vi.mocked((prisma as any).contract.findMany).mock.calls[0]
    expect(call[0].where.endDate).toEqual({
      gte: new Date("2026-07-01"),
      lte: new Date("2026-12-31"),
    })
  })

  it("adds OR search clause when search param present", async () => {
    const req = makeReq("http://localhost/api/v1/contracts/export?search=Acme")
    await GET(req)
    const call = vi.mocked((prisma as any).contract.findMany).mock.calls[0]
    expect(Array.isArray(call[0].where.OR)).toBe(true)
    expect(call[0].where.OR.length).toBeGreaterThan(0)
  })
})

// ─── Response headers tests ───────────────────────────────────────────────────

describe("GET /api/v1/contracts/export — response headers", () => {
  it("returns application/vnd…spreadsheetml.sheet Content-Type", async () => {
    const res = await GET(makeReq())
    const ct = res.headers.get("Content-Type") ?? ""
    expect(ct).toContain("spreadsheetml.sheet")
  })

  it("returns Content-Disposition: attachment header", async () => {
    const res = await GET(makeReq())
    const cd = res.headers.get("Content-Disposition") ?? ""
    expect(cd).toMatch(/^attachment/)
  })

  it("includes .xlsx in the filename", async () => {
    const res = await GET(makeReq())
    const cd = res.headers.get("Content-Disposition") ?? ""
    expect(cd).toMatch(/\.xlsx/)
  })
})

// ─── Money / no-float test ────────────────────────────────────────────────────

describe("GET /api/v1/contracts/export — money via decimalToNumber", () => {
  it("calls decimalToNumber for valueAmount (boundary conversion)", async () => {
    const { decimalToNumber } = await import("@/lib/prisma-decimal")
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    vi.mocked((prisma as any).contract.findMany).mockResolvedValue([
      { ...mockContracts[0] },
    ])
    await GET(makeReq())
    // decimalToNumber must have been invoked at least once (for the Decimal valueAmount)
    expect(vi.mocked(decimalToNumber)).toHaveBeenCalled()
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe("GET /api/v1/contracts/export — error handling", () => {
  it("returns 500 when prisma throws", async () => {
    vi.mocked((prisma as any).contract.findMany).mockRejectedValue(
      new Error("DB error"),
    )
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })
})
