/**
 * S4 Sales Territories — test suite
 *
 * Group A: matchTerritoryRules pure helper (no DB)
 * Group B: Territory CRUD routes (mocked Prisma)
 * Group C: TerritoryMembership routes (mocked Prisma)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { matchTerritoryRules, findMatchingTerritories } from "@/lib/territory-rules"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    territory: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    territoryMembership: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    // cross-tenant user guard
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: "u2", organizationId: "org1" }),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn().mockResolvedValue("org1"),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn().mockResolvedValue({ orgId: "org1", userId: "user1" }),
  // POST migrated to withRlsAuth, whose factory calls isAuthError(auth) on the
  // requireAuth result — must be exported by the mock or it's undefined.
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(
  method: string,
  url = "http://localhost/api/v1/territories",
  body?: unknown
): NextRequest {
  const init: ConstructorParameters<typeof NextRequest>[1] = { method }
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" }
    init.body = JSON.stringify(body)
  }
  return new NextRequest(url, init)
}

// ─── Group A: matchTerritoryRules pure helper ─────────────────────────────────

describe("matchTerritoryRules", () => {
  describe("empty rules match everything", () => {
    it("matches company with country + industry", () => {
      expect(matchTerritoryRules({}, { country: "AZ", industry: "Tech" })).toBe(true)
    })
    it("matches company with no data", () => {
      expect(matchTerritoryRules({}, {})).toBe(true)
    })
  })

  describe("country filter", () => {
    it("matches when country in list", () => {
      expect(matchTerritoryRules({ countries: ["AZ", "GE"] }, { country: "AZ" })).toBe(true)
    })
    it("rejects when country not in list", () => {
      expect(matchTerritoryRules({ countries: ["AZ"] }, { country: "TR" })).toBe(false)
    })
    it("rejects when company has no country", () => {
      expect(matchTerritoryRules({ countries: ["AZ"] }, {})).toBe(false)
    })
    it("normalises country to uppercase", () => {
      expect(matchTerritoryRules({ countries: ["AZ"] }, { country: "az" })).toBe(true)
    })
    it("empty countries array = any", () => {
      expect(matchTerritoryRules({ countries: [] }, { country: "TR" })).toBe(true)
    })
  })

  describe("industry filter", () => {
    it("matches when industry in list (case-insensitive)", () => {
      expect(matchTerritoryRules({ industries: ["tech", "Finance"] }, { industry: "TECH" })).toBe(true)
    })
    it("rejects when industry not in list", () => {
      expect(matchTerritoryRules({ industries: ["Tech"] }, { industry: "Retail" })).toBe(false)
    })
    it("rejects when company has no industry", () => {
      expect(matchTerritoryRules({ industries: ["Tech"] }, {})).toBe(false)
    })
    it("empty industries array = any", () => {
      expect(matchTerritoryRules({ industries: [] }, {})).toBe(true)
    })
  })

  describe("company size filter", () => {
    it("matches when size in range [min, max]", () => {
      expect(matchTerritoryRules({ companySizeMin: 10, companySizeMax: 500 }, { employeeCount: 100 })).toBe(true)
    })
    it("matches at exact min boundary", () => {
      expect(matchTerritoryRules({ companySizeMin: 10 }, { employeeCount: 10 })).toBe(true)
    })
    it("matches at exact max boundary", () => {
      expect(matchTerritoryRules({ companySizeMax: 500 }, { employeeCount: 500 })).toBe(true)
    })
    it("rejects below min", () => {
      expect(matchTerritoryRules({ companySizeMin: 50 }, { employeeCount: 5 })).toBe(false)
    })
    it("rejects above max", () => {
      expect(matchTerritoryRules({ companySizeMax: 100 }, { employeeCount: 200 })).toBe(false)
    })
    it("companySizeMax=0 means no upper limit", () => {
      expect(matchTerritoryRules({ companySizeMax: 0 }, { employeeCount: 999999 })).toBe(true)
    })
    it("rejects when no employeeCount but min set", () => {
      expect(matchTerritoryRules({ companySizeMin: 10 }, {})).toBe(false)
    })
  })

  describe("multi-dimension AND", () => {
    it("must satisfy all dimensions", () => {
      const rules = { countries: ["AZ"], industries: ["Tech"], companySizeMin: 10 }
      expect(matchTerritoryRules(rules, { country: "AZ", industry: "Tech", employeeCount: 50 })).toBe(true)
      expect(matchTerritoryRules(rules, { country: "AZ", industry: "Retail", employeeCount: 50 })).toBe(false)
      expect(matchTerritoryRules(rules, { country: "TR", industry: "Tech", employeeCount: 50 })).toBe(false)
    })
  })

  describe("findMatchingTerritories", () => {
    it("returns IDs of matching territories", () => {
      const territories = [
        { id: "t1", rules: { countries: ["AZ"] } },
        { id: "t2", rules: { countries: ["TR"] } },
        { id: "t3", rules: {} },
      ]
      const result = findMatchingTerritories(territories, { country: "AZ" })
      expect(result).toContain("t1")
      expect(result).toContain("t3")
      expect(result).not.toContain("t2")
    })

    it("returns empty array if no territories match", () => {
      const territories = [{ id: "t1", rules: { countries: ["AZ"] } }]
      expect(findMatchingTerritories(territories, { country: "TR" })).toEqual([])
    })
  })
})

// ─── Group B: Territory CRUD routes ──────────────────────────────────────────

describe("GET /api/v1/territories", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 200 with territories list", async () => {
    const { prisma } = await import("@/lib/prisma")
    const mockTerritories = [
      { id: "t1", name: "Baku Region", organizationId: "org1", isActive: true, rules: {}, members: [], createdAt: new Date() },
    ]
    vi.mocked(prisma.territory.findMany).mockResolvedValueOnce(mockTerritories as any)

    const { GET } = await import("@/app/api/v1/territories/route")
    const req = makeReq("GET")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data).toHaveLength(1)
    expect(data.data[0].name).toBe("Baku Region")
  })
})

describe("POST /api/v1/territories", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 201 on valid create", async () => {
    const { prisma } = await import("@/lib/prisma")
    const created = { id: "t2", name: "South Region", organizationId: "org1", isActive: true, rules: { countries: ["AZ"] }, members: [], createdAt: new Date() }
    vi.mocked(prisma.territory.create).mockResolvedValueOnce(created as any)

    const { POST } = await import("@/app/api/v1/territories/route")
    const req = makeReq("POST", "http://localhost/api/v1/territories", {
      name: "South Region",
      rules: { countries: ["AZ"] },
    })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.data.name).toBe("South Region")
  })

  it("returns 400 if name missing", async () => {
    const { POST } = await import("@/app/api/v1/territories/route")
    const req = makeReq("POST", "http://localhost/api/v1/territories", { rules: {} })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe("PATCH /api/v1/territories/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 200 on valid update", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.territory.findFirst).mockResolvedValueOnce({ id: "t1", organizationId: "org1" } as any)
    const updated = { id: "t1", name: "Updated", isActive: false, rules: {}, members: [], createdAt: new Date() }
    vi.mocked(prisma.territory.update).mockResolvedValueOnce(updated as any)

    const { PATCH } = await import("@/app/api/v1/territories/[id]/route")
    const req = makeReq("PATCH", "http://localhost/api/v1/territories/t1", { isActive: false })
    const res = await PATCH(req, { params: Promise.resolve({ id: "t1" }) })
    expect(res.status).toBe(200)
  })

  it("returns 404 if territory not found", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.territory.findFirst).mockResolvedValueOnce(null)

    const { PATCH } = await import("@/app/api/v1/territories/[id]/route")
    const req = makeReq("PATCH", "http://localhost/api/v1/territories/bad", { isActive: false })
    const res = await PATCH(req, { params: Promise.resolve({ id: "bad" }) })
    expect(res.status).toBe(404)
  })
})

describe("DELETE /api/v1/territories/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 200 on delete", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.territory.findFirst).mockResolvedValueOnce({ id: "t1", organizationId: "org1" } as any)
    vi.mocked(prisma.territory.delete).mockResolvedValueOnce({} as any)

    const { DELETE } = await import("@/app/api/v1/territories/[id]/route")
    const req = makeReq("DELETE", "http://localhost/api/v1/territories/t1")
    const res = await DELETE(req, { params: Promise.resolve({ id: "t1" }) })
    expect(res.status).toBe(200)
  })
})

// ─── Group C: TerritoryMembership routes ─────────────────────────────────────

describe("POST /api/v1/territories/[id]/members", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 201 on member add", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.territory.findFirst).mockResolvedValueOnce({ id: "t1", organizationId: "org1" } as any)
    vi.mocked(prisma.territoryMembership.findUnique).mockResolvedValueOnce(null)
    const created = { id: "m1", territoryId: "t1", userId: "u2", createdAt: new Date() }
    vi.mocked(prisma.territoryMembership.create).mockResolvedValueOnce(created as any)

    const { POST } = await import("@/app/api/v1/territories/[id]/members/route")
    const req = makeReq("POST", "http://localhost/api/v1/territories/t1/members", { userId: "u2" })
    const res = await POST(req, { params: Promise.resolve({ id: "t1" }) })
    expect(res.status).toBe(201)
  })

  it("returns 409 if member already exists", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.territory.findFirst).mockResolvedValueOnce({ id: "t1", organizationId: "org1" } as any)
    vi.mocked(prisma.territoryMembership.findUnique).mockResolvedValueOnce({ id: "m1" } as any)

    const { POST } = await import("@/app/api/v1/territories/[id]/members/route")
    const req = makeReq("POST", "http://localhost/api/v1/territories/t1/members", { userId: "u2" })
    const res = await POST(req, { params: Promise.resolve({ id: "t1" }) })
    expect(res.status).toBe(409)
  })

  it("returns 400 if userId missing", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.territory.findFirst).mockResolvedValueOnce({ id: "t1", organizationId: "org1" } as any)

    const { POST } = await import("@/app/api/v1/territories/[id]/members/route")
    const req = makeReq("POST", "http://localhost/api/v1/territories/t1/members", {})
    const res = await POST(req, { params: Promise.resolve({ id: "t1" }) })
    expect(res.status).toBe(400)
  })
})

describe("DELETE /api/v1/territories/[id]/members/[userId]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 200 on remove", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.territory.findFirst).mockResolvedValueOnce({ id: "t1", organizationId: "org1" } as any)
    vi.mocked(prisma.territoryMembership.delete).mockResolvedValueOnce({} as any)

    const { DELETE } = await import("@/app/api/v1/territories/[id]/members/[userId]/route")
    const req = makeReq("DELETE")
    const res = await DELETE(req, { params: Promise.resolve({ id: "t1", userId: "u2" }) })
    expect(res.status).toBe(200)
  })
})
