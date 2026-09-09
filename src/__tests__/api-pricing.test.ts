import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pricingProfile: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pricingProfileCategory: { update: vi.fn() },
    pricingService: { findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    pricingCategory: { findMany: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    pricingGroup: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))

import { GET as GET_DATA, PUT as PUT_DATA } from "@/app/api/v1/pricing/data/route"
import { GET as GET_PROFILES, POST as POST_PROFILES } from "@/app/api/v1/pricing/profiles/route"
import { GET as GET_PROFILE_BY_ID, PUT as PUT_PROFILE, DELETE as DELETE_PROFILE } from "@/app/api/v1/pricing/profiles/[id]/route"
import { GET as GET_CATEGORIES } from "@/app/api/v1/pricing/categories/route"
import { GET as GET_GROUPS } from "@/app/api/v1/pricing/groups/route"
import { GET as GET_UNIT_TYPES } from "@/app/api/v1/pricing/unit-types/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
})

// ─── GET /api/v1/pricing/data ───────────────────────────────────────

describe("GET /api/v1/pricing/data", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_DATA(makeReq("http://localhost:3000/api/v1/pricing/data"))
    expect(res.status).toBe(401)
  })

  it("returns pricing data in legacy format", async () => {
    vi.mocked(prisma.pricingProfile.findMany).mockResolvedValue([
      {
        id: "p1",
        companyCode: "ACME",
        monthlyTotal: 1000,
        annualTotal: 12000,
        group: { name: "Group A" },
        categories: [
          {
            total: 500,
            category: { name: "Infrastructure" },
            services: [
              { name: "Firewall", qty: 1, price: 500, total: 500, unit: "Per Device" },
            ],
          },
        ],
      },
    ] as any)

    const res = await GET_DATA(makeReq("http://localhost:3000/api/v1/pricing/data"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.ACME).toBeDefined()
    expect(json.data.ACME.group).toBe("Group A")
    expect(json.data.ACME.monthly).toBe(1000)
    expect(json.data.ACME.annual).toBe(12000)
    expect(json.data.ACME.categories.Infrastructure.total).toBe(500)
    expect(json.data.ACME.categories.Infrastructure.services).toHaveLength(1)
    expect(json.data.ACME.categories.Infrastructure.services[0].name).toBe("Firewall")
  })

  it("returns 500 on database error", async () => {
    vi.mocked(prisma.pricingProfile.findMany).mockRejectedValue(new Error("DB down"))
    const res = await GET_DATA(makeReq("http://localhost:3000/api/v1/pricing/data"))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Internal server error")
  })
})

// ─── GET /api/v1/pricing/profiles ───────────────────────────────────

describe("GET /api/v1/pricing/profiles", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_PROFILES(makeReq("http://localhost:3000/api/v1/pricing/profiles"))
    expect(res.status).toBe(401)
  })

  it("returns profiles with pagination", async () => {
    const mockProfiles = [{ id: "p1", companyCode: "ACME", group: { name: "A" }, company: null, categories: [], _count: { additionalSales: 0 } }]
    vi.mocked(prisma.pricingProfile.findMany).mockResolvedValue(mockProfiles as any)
    vi.mocked(prisma.pricingProfile.count).mockResolvedValue(1)

    const res = await GET_PROFILES(makeReq("http://localhost:3000/api/v1/pricing/profiles?page=1&limit=10"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.profiles).toHaveLength(1)
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(10)
  })

  it("passes groupId, companyId, and search filters", async () => {
    vi.mocked(prisma.pricingProfile.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.pricingProfile.count).mockResolvedValue(0)

    await GET_PROFILES(makeReq("http://localhost:3000/api/v1/pricing/profiles?groupId=g1&companyId=c1&search=test"))

    const call = vi.mocked(prisma.pricingProfile.findMany).mock.calls[0][0] as any
    expect(call.where.groupId).toBe("g1")
    expect(call.where.companyId).toBe("c1")
    expect(call.where.companyCode).toEqual({ contains: "test", mode: "insensitive" })
  })
})

// ─── POST /api/v1/pricing/profiles ──────────────────────────────────

describe("POST /api/v1/pricing/profiles", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await POST_PROFILES(makeReq("http://localhost:3000/api/v1/pricing/profiles", {
      method: "POST",
      body: JSON.stringify({ companyCode: "X", groupId: "g1" }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 on validation failure (missing companyCode)", async () => {
    const res = await POST_PROFILES(makeReq("http://localhost:3000/api/v1/pricing/profiles", {
      method: "POST",
      body: JSON.stringify({ groupId: "g1" }),
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("Validation failed")
  })

  it("creates a profile and returns 201", async () => {
    const created = { id: "p-new", companyCode: "NEW", groupId: "g1", monthlyTotal: 0, annualTotal: 0, group: { name: "G" }, company: null }
    vi.mocked(prisma.pricingProfile.create).mockResolvedValue(created as any)

    const res = await POST_PROFILES(makeReq("http://localhost:3000/api/v1/pricing/profiles", {
      method: "POST",
      body: JSON.stringify({ companyCode: "NEW", groupId: "g1" }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.companyCode).toBe("NEW")
  })

  it("returns 409 on duplicate companyCode (P2002)", async () => {
    const error = new Error("Unique constraint") as any
    error.code = "P2002"
    vi.mocked(prisma.pricingProfile.create).mockRejectedValue(error)

    const res = await POST_PROFILES(makeReq("http://localhost:3000/api/v1/pricing/profiles", {
      method: "POST",
      body: JSON.stringify({ companyCode: "DUP", groupId: "g1" }),
    }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe("Profile with this companyCode already exists")
  })
})

// ─── GET /api/v1/pricing/profiles/:id ───────────────────────────────

describe("GET /api/v1/pricing/profiles/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_PROFILE_BY_ID(makeReq("http://localhost:3000/api/v1/pricing/profiles/p1"), makeParams("p1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when profile not found", async () => {
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue(null)
    const res = await GET_PROFILE_BY_ID(makeReq("http://localhost:3000/api/v1/pricing/profiles/missing"), makeParams("missing"))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe("Profile not found")
  })

  it("returns profile with categories and additional sales", async () => {
    const mockProfile = {
      id: "p1", companyCode: "ACME", group: { name: "A" }, company: null,
      categories: [], additionalSales: [],
    }
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue(mockProfile as any)

    const res = await GET_PROFILE_BY_ID(makeReq("http://localhost:3000/api/v1/pricing/profiles/p1"), makeParams("p1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("p1")
  })
})

// ─── PUT /api/v1/pricing/profiles/:id ───────────────────────────────

describe("PUT /api/v1/pricing/profiles/:id", () => {
  it("returns 404 when profile does not exist", async () => {
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue(null)
    const res = await PUT_PROFILE(
      makeReq("http://localhost:3000/api/v1/pricing/profiles/missing", { method: "PUT", body: JSON.stringify({ companyCode: "X" }) }),
      makeParams("missing"),
    )
    expect(res.status).toBe(404)
  })

  it("updates profile and returns updated data", async () => {
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue({ id: "p1", organizationId: "org-1" } as any)
    const updated = { id: "p1", companyCode: "UPDATED", group: { name: "G" }, company: null }
    vi.mocked(prisma.pricingProfile.update).mockResolvedValue(updated as any)

    const res = await PUT_PROFILE(
      makeReq("http://localhost:3000/api/v1/pricing/profiles/p1", { method: "PUT", body: JSON.stringify({ companyCode: "UPDATED" }) }),
      makeParams("p1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.companyCode).toBe("UPDATED")
  })
})

// ─── DELETE /api/v1/pricing/profiles/:id ────────────────────────────

describe("DELETE /api/v1/pricing/profiles/:id", () => {
  it("returns 404 when profile does not exist", async () => {
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue(null)
    const res = await DELETE_PROFILE(
      makeReq("http://localhost:3000/api/v1/pricing/profiles/missing", { method: "DELETE" }),
      makeParams("missing"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes profile and returns success", async () => {
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue({ id: "p1" } as any)
    vi.mocked(prisma.pricingProfile.delete).mockResolvedValue({ id: "p1" } as any)

    const res = await DELETE_PROFILE(
      makeReq("http://localhost:3000/api/v1/pricing/profiles/p1", { method: "DELETE" }),
      makeParams("p1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe(true)
  })
})

// ─── GET /api/v1/pricing/categories ─────────────────────────────────

describe("GET /api/v1/pricing/categories", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_CATEGORIES(makeReq("http://localhost:3000/api/v1/pricing/categories"))
    expect(res.status).toBe(401)
  })

  it("returns categories ordered by sortOrder", async () => {
    const cats = [
      { id: "c1", name: "Infrastructure", sortOrder: 1 },
      { id: "c2", name: "Security", sortOrder: 2 },
    ]
    vi.mocked(prisma.pricingCategory.findMany).mockResolvedValue(cats as any)

    const res = await GET_CATEGORIES(makeReq("http://localhost:3000/api/v1/pricing/categories"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(2)
    expect(json.data[0].name).toBe("Infrastructure")
  })
})

// ─── GET /api/v1/pricing/groups ─────────────────────────────────────

describe("GET /api/v1/pricing/groups", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_GROUPS(makeReq("http://localhost:3000/api/v1/pricing/groups"))
    expect(res.status).toBe(401)
  })

  it("returns group names as array of strings", async () => {
    vi.mocked(prisma.pricingGroup.findMany).mockResolvedValue([
      { id: "g1", name: "Enterprise", sortOrder: 1 },
      { id: "g2", name: "SMB", sortOrder: 2 },
    ] as any)

    const res = await GET_GROUPS(makeReq("http://localhost:3000/api/v1/pricing/groups"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toEqual(["Enterprise", "SMB"])
  })
})

// ─── GET /api/v1/pricing/unit-types ─────────────────────────────────

describe("GET /api/v1/pricing/unit-types", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_UNIT_TYPES(makeReq("http://localhost:3000/api/v1/pricing/unit-types"))
    expect(res.status).toBe(401)
  })

  it("returns default unit types merged with DB units, sorted", async () => {
    vi.mocked(prisma.pricingService.findMany).mockResolvedValue([
      { unit: "Per Rack" },
      { unit: "Per Device" }, // already in defaults
    ] as any)

    const res = await GET_UNIT_TYPES(makeReq("http://localhost:3000/api/v1/pricing/unit-types"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    // Should include default types + custom "Per Rack", sorted
    expect(json.data).toContain("Per Device")
    expect(json.data).toContain("Per Rack")
    expect(json.data).toContain("Hourly")
    // Verify sorted
    const sorted = [...json.data].sort()
    expect(json.data).toEqual(sorted)
  })
})
