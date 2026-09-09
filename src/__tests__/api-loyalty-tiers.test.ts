/**
 * D8 Loyalty slice-2-full — LoyaltyTier CRUD route tests.
 *
 * Coverage:
 *   GET  /api/v1/loyalty-tiers              — list, empty, auth error
 *   POST /api/v1/loyalty-tiers              — create (happy + validation)
 *   POST /api/v1/loyalty-tiers?seedDefaults — seed (happy + already-exists 409)
 *   PATCH  /api/v1/loyalty-tiers/[id]       — update (happy + validation + 404)
 *   DELETE /api/v1/loyalty-tiers/[id]       — delete with orphan cleanup
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loyaltyTier: {
      findMany:  vi.fn(),
      findFirst: vi.fn(),
      count:     vi.fn(),
      create:    vi.fn(),
      update:    vi.fn(),
      delete:    vi.fn(),
    },
    loyaltyAccount: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET, POST } from "@/app/api/v1/loyalty-tiers/route"
import { PATCH, DELETE } from "@/app/api/v1/loyalty-tiers/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin" }

function makeReq(url: string, opts?: RequestInit) {
  return new Request(url, opts) as any
}
function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const TIER_ROW = {
  id: "tier-1",
  organizationId: "org-1",
  code: "bronze",
  name: "Bronze",
  description: null,
  minLifetimePoints: 0,
  multiplier: 1.0,
  benefits: {},
  isActive: true,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
})

// ─── GET /api/v1/loyalty-tiers ───────────────────────────────────────────────

describe("GET /api/v1/loyalty-tiers", () => {
  it("returns 401 on auth error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any)
    const res = await GET(makeReq("http://localhost/api/v1/loyalty-tiers"))
    expect(res.status).toBe(401)
  })

  it("returns empty list when no tiers configured", async () => {
    vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([])
    const res = await GET(makeReq("http://localhost/api/v1/loyalty-tiers"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tiers).toEqual([])
    expect(body.total).toBe(0)
  })

  it("returns tiers ordered by minLifetimePoints asc", async () => {
    const silver = { ...TIER_ROW, id: "tier-2", code: "silver", minLifetimePoints: 1000, multiplier: 1.1 }
    vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([TIER_ROW, silver] as any)
    const res = await GET(makeReq("http://localhost/api/v1/loyalty-tiers"))
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.tiers[0].code).toBe("bronze")
    expect(body.tiers[1].code).toBe("silver")
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.loyaltyTier.findMany).mockRejectedValue(new Error("DB down"))
    const res = await GET(makeReq("http://localhost/api/v1/loyalty-tiers"))
    expect(res.status).toBe(500)
  })
})

// ─── POST /api/v1/loyalty-tiers (create) ─────────────────────────────────────

describe("POST /api/v1/loyalty-tiers — create", () => {
  const VALID_BODY = {
    code: "bronze",
    name: "Bronze",
    minLifetimePoints: 0,
    multiplier: 1.0,
  }

  it("creates a tier and returns 201", async () => {
    vi.mocked(prisma.loyaltyTier.create).mockResolvedValue(TIER_ROW as any)
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-tiers", {
        method: "POST",
        body: JSON.stringify(VALID_BODY),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.tier.code).toBe("bronze")
  })

  it("returns 400 for invalid code (uppercase)", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-tiers", {
        method: "POST",
        body: JSON.stringify({ ...VALID_BODY, code: "GOLD" }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/code/i)
  })

  it("returns 400 for invalid code (starts with digit)", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-tiers", {
        method: "POST",
        body: JSON.stringify({ ...VALID_BODY, code: "1gold" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for missing name", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-tiers", {
        method: "POST",
        body: JSON.stringify({ ...VALID_BODY, name: "" }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name/i)
  })

  it("returns 400 for negative minLifetimePoints", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-tiers", {
        method: "POST",
        body: JSON.stringify({ ...VALID_BODY, minLifetimePoints: -1 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for multiplier = 0", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-tiers", {
        method: "POST",
        body: JSON.stringify({ ...VALID_BODY, multiplier: 0 }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/multiplier/i)
  })

  it("returns 400 for multiplier > 10 (MAX_TIER_MULTIPLIER)", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-tiers", {
        method: "POST",
        body: JSON.stringify({ ...VALID_BODY, multiplier: 11 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 409 on duplicate code (unique constraint)", async () => {
    vi.mocked(prisma.loyaltyTier.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on"), {}),
    )
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-tiers", {
        method: "POST",
        body: JSON.stringify(VALID_BODY),
      }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already exists/i)
  })
})

// ─── POST /api/v1/loyalty-tiers?seedDefaults ─────────────────────────────────

describe("POST /api/v1/loyalty-tiers?seedDefaults", () => {
  it("seeds 5 default tiers and returns seeded count", async () => {
    vi.mocked(prisma.loyaltyTier.count).mockResolvedValue(0)
    vi.mocked(prisma.$transaction as any).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ ...TIER_ROW, id: `tier-${i}` })),
    )
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-tiers?seedDefaults=true", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.seeded).toBe(5)
  })

  it("returns 409 when tiers already exist", async () => {
    vi.mocked(prisma.loyaltyTier.count).mockResolvedValue(3)
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-tiers?seedDefaults=true", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.existing).toBe(3)
  })
})

// ─── PATCH /api/v1/loyalty-tiers/[id] ────────────────────────────────────────

describe("PATCH /api/v1/loyalty-tiers/[id]", () => {
  it("returns 404 when tier not found", async () => {
    vi.mocked(prisma.loyaltyTier.findFirst).mockResolvedValue(null)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-tiers/tier-99", {
        method: "PATCH",
        body: JSON.stringify({ name: "Gold" }),
      }),
      makeCtx("tier-99"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 400 when no mutable fields provided", async () => {
    vi.mocked(prisma.loyaltyTier.findFirst).mockResolvedValue(TIER_ROW as any)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-tiers/tier-1", {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      makeCtx("tier-1"),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/No mutable fields/i)
  })

  it("returns 400 for invalid name", async () => {
    vi.mocked(prisma.loyaltyTier.findFirst).mockResolvedValue(TIER_ROW as any)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-tiers/tier-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "" }),
      }),
      makeCtx("tier-1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for multiplier out of range", async () => {
    vi.mocked(prisma.loyaltyTier.findFirst).mockResolvedValue(TIER_ROW as any)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-tiers/tier-1", {
        method: "PATCH",
        body: JSON.stringify({ multiplier: 0 }),
      }),
      makeCtx("tier-1"),
    )
    expect(res.status).toBe(400)
  })

  it("updates tier and returns updated row; update is scoped to correct id", async () => {
    vi.mocked(prisma.loyaltyTier.findFirst).mockResolvedValue(TIER_ROW as any)
    const updated = { ...TIER_ROW, name: "Gold", multiplier: 1.5 }
    vi.mocked(prisma.loyaltyTier.update).mockResolvedValue(updated as any)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-tiers/tier-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Gold", multiplier: 1.5 }),
      }),
      makeCtx("tier-1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tier.name).toBe("Gold")
    expect(body.tier.multiplier).toBe(1.5)
    // Verify the update was scoped to the correct tier id (not a stray update-all).
    const updateCall = vi.mocked(prisma.loyaltyTier.update).mock.calls[0][0]
    expect(updateCall.where).toEqual({ id: "tier-1" })
  })

  it("scopes findFirst to organizationId (cross-tenant guard)", async () => {
    vi.mocked(prisma.loyaltyTier.findFirst).mockResolvedValue(null)
    await PATCH(
      makeReq("http://localhost/api/v1/loyalty-tiers/tier-99", {
        method: "PATCH",
        body: JSON.stringify({ name: "Test" }),
      }),
      makeCtx("tier-99"),
    )
    const findCall = vi.mocked(prisma.loyaltyTier.findFirst).mock.calls[0][0]
    expect((findCall as any).where.organizationId).toBe("org-1")
    expect((findCall as any).where.id).toBe("tier-99")
  })

  it("clears benefits when null is passed", async () => {
    vi.mocked(prisma.loyaltyTier.findFirst).mockResolvedValue(TIER_ROW as any)
    vi.mocked(prisma.loyaltyTier.update).mockResolvedValue({ ...TIER_ROW, benefits: {} } as any)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-tiers/tier-1", {
        method: "PATCH",
        body: JSON.stringify({ benefits: null }),
      }),
      makeCtx("tier-1"),
    )
    expect(res.status).toBe(200)
    // benefits null → {} (column is NOT NULL)
    const update = vi.mocked(prisma.loyaltyTier.update).mock.calls[0][0]
    expect(update.data.benefits).toEqual({})
  })
})

// ─── DELETE /api/v1/loyalty-tiers/[id] ───────────────────────────────────────

describe("DELETE /api/v1/loyalty-tiers/[id]", () => {
  it("returns 404 when tier not found", async () => {
    vi.mocked(prisma.loyaltyTier.findFirst).mockResolvedValue(null)
    const res = await DELETE(
      makeReq("http://localhost/api/v1/loyalty-tiers/tier-99", {
        method: "DELETE",
      }),
      makeCtx("tier-99"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes tier and null-clears orphaned accounts", async () => {
    vi.mocked(prisma.loyaltyTier.findFirst).mockResolvedValue(TIER_ROW as any)
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => {
      const fakeTx = {
        loyaltyAccount: {
          updateMany: vi.fn().mockResolvedValue({ count: 3 }),
        },
        loyaltyTier: {
          delete: vi.fn().mockResolvedValue({}),
        },
      }
      return fn(fakeTx)
    })
    const res = await DELETE(
      makeReq("http://localhost/api/v1/loyalty-tiers/tier-1", {
        method: "DELETE",
      }),
      makeCtx("tier-1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.orphansCleared).toBe(3)
    expect(body.code).toBe("bronze")
  })
})
