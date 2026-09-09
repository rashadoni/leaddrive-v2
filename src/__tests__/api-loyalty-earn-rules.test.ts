/**
 * D8 Loyalty slice-2-full — LoyaltyEarnRule CRUD route tests.
 *
 * Coverage:
 *   GET  /api/v1/loyalty-earn-rules       — list (no filter, trigger filter, active filter, auth error)
 *   POST /api/v1/loyalty-earn-rules       — create (happy + validation)
 *   PATCH  /api/v1/loyalty-earn-rules/[id] — update (happy + validation + 404)
 *   DELETE /api/v1/loyalty-earn-rules/[id] — delete
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loyaltyEarnRule: {
      findMany:  vi.fn(),
      findFirst: vi.fn(),
      create:    vi.fn(),
      update:    vi.fn(),
      delete:    vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET, POST } from "@/app/api/v1/loyalty-earn-rules/route"
import { PATCH, DELETE } from "@/app/api/v1/loyalty-earn-rules/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin" }

function makeReq(url: string, opts?: RequestInit) {
  return new Request(url, opts) as any
}
function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const RULE_ROW = {
  id: "rule-1",
  organizationId: "org-1",
  name: "Purchase 1pt per $",
  trigger: "purchase",
  pointsRate: 1.0,
  pointsFlat: null,
  minOrderAmount: null,
  productCategory: null,
  priority: 0,
  applyTierMultiplier: true,
  isActive: true,
  validFrom: null,
  validUntil: null,
  metadata: {},
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
})

// ─── GET /api/v1/loyalty-earn-rules ──────────────────────────────────────────

describe("GET /api/v1/loyalty-earn-rules", () => {
  it("returns 401 on auth error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any,
    )
    const res = await GET(makeReq("http://localhost/api/v1/loyalty-earn-rules"))
    expect(res.status).toBe(401)
  })

  it("returns all rules unfiltered", async () => {
    const signupRule = { ...RULE_ROW, id: "rule-2", trigger: "signup", pointsRate: null, pointsFlat: 100 }
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([RULE_ROW, signupRule] as any)
    const res = await GET(makeReq("http://localhost/api/v1/loyalty-earn-rules"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.rules).toHaveLength(2)
  })

  it("filters by trigger", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([RULE_ROW] as any)
    const res = await GET(makeReq("http://localhost/api/v1/loyalty-earn-rules?trigger=purchase"))
    expect(res.status).toBe(200)
    const findArgs = vi.mocked(prisma.loyaltyEarnRule.findMany).mock.calls[0][0]
    expect((findArgs.where as any).trigger).toBe("purchase")
  })

  it("returns 400 for invalid trigger filter", async () => {
    const res = await GET(makeReq("http://localhost/api/v1/loyalty-earn-rules?trigger=unknown"))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/trigger/i)
  })

  it("filters by active=true", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([RULE_ROW] as any)
    const res = await GET(makeReq("http://localhost/api/v1/loyalty-earn-rules?active=true"))
    expect(res.status).toBe(200)
    const findArgs = vi.mocked(prisma.loyaltyEarnRule.findMany).mock.calls[0][0]
    expect((findArgs.where as any).isActive).toBe(true)
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockRejectedValue(new Error("DB down"))
    const res = await GET(makeReq("http://localhost/api/v1/loyalty-earn-rules"))
    expect(res.status).toBe(500)
  })
})

// ─── POST /api/v1/loyalty-earn-rules (create) ────────────────────────────────

describe("POST /api/v1/loyalty-earn-rules — create", () => {
  const VALID_BODY = {
    name: "Purchase 1pt per $",
    trigger: "purchase",
    pointsRate: 1.0,
  }

  it("creates rule and returns 201", async () => {
    vi.mocked(prisma.loyaltyEarnRule.create).mockResolvedValue(RULE_ROW as any)
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-earn-rules", {
        method: "POST",
        body: JSON.stringify(VALID_BODY),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.rule.name).toBe("Purchase 1pt per $")
  })

  it("creates rule with pointsFlat only (no pointsRate)", async () => {
    const signupRule = { ...RULE_ROW, trigger: "signup", pointsRate: null, pointsFlat: 100 }
    vi.mocked(prisma.loyaltyEarnRule.create).mockResolvedValue(signupRule as any)
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-earn-rules", {
        method: "POST",
        body: JSON.stringify({ name: "Signup bonus", trigger: "signup", pointsFlat: 100 }),
      }),
    )
    expect(res.status).toBe(201)
  })

  it("returns 400 for missing name", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-earn-rules", {
        method: "POST",
        body: JSON.stringify({ ...VALID_BODY, name: "" }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name/i)
  })

  it("returns 400 for invalid trigger", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-earn-rules", {
        method: "POST",
        body: JSON.stringify({ ...VALID_BODY, trigger: "unknown_event" }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/trigger/i)
  })

  it("returns 400 when neither pointsRate nor pointsFlat is provided", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-earn-rules", {
        method: "POST",
        body: JSON.stringify({ name: "test", trigger: "purchase" }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/pointsRate.*pointsFlat/i)
  })

  it("returns 400 for negative pointsRate", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-earn-rules", {
        method: "POST",
        body: JSON.stringify({ ...VALID_BODY, pointsRate: -1 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for negative pointsFlat", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-earn-rules", {
        method: "POST",
        body: JSON.stringify({ name: "test", trigger: "signup", pointsFlat: -50 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when validFrom > validUntil", async () => {
    const res = await POST(
      makeReq("http://localhost/api/v1/loyalty-earn-rules", {
        method: "POST",
        body: JSON.stringify({
          ...VALID_BODY,
          validFrom: "2027-01-01",
          validUntil: "2026-01-01",
        }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/validFrom.*validUntil/i)
  })
})

// ─── PATCH /api/v1/loyalty-earn-rules/[id] ───────────────────────────────────

describe("PATCH /api/v1/loyalty-earn-rules/[id]", () => {
  it("returns 404 when rule not found", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findFirst).mockResolvedValue(null)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-earn-rules/rule-99", {
        method: "PATCH",
        body: JSON.stringify({ name: "New name" }),
      }),
      makeCtx("rule-99"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 400 when no mutable fields provided", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findFirst).mockResolvedValue(RULE_ROW as any)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-earn-rules/rule-1", {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      makeCtx("rule-1"),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/No mutable fields/i)
  })

  it("returns 400 when PATCH would null both pointsRate and pointsFlat", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findFirst).mockResolvedValue({
      ...RULE_ROW,
      pointsRate: 1.0,
      pointsFlat: null,
    } as any)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-earn-rules/rule-1", {
        method: "PATCH",
        body: JSON.stringify({ pointsRate: null }),
      }),
      makeCtx("rule-1"),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/pointsRate.*pointsFlat/i)
  })

  it("returns 400 when merged window violates validFrom <= validUntil", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findFirst).mockResolvedValue({
      ...RULE_ROW,
      validFrom: new Date("2026-01-01"),
      validUntil: null,
    } as any)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-earn-rules/rule-1", {
        method: "PATCH",
        body: JSON.stringify({ validUntil: "2025-01-01" }),
      }),
      makeCtx("rule-1"),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/validFrom.*validUntil/i)
  })

  it("updates rule and returns updated row", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findFirst).mockResolvedValue(RULE_ROW as any)
    const updated = { ...RULE_ROW, name: "Renamed rule", priority: 5 }
    vi.mocked(prisma.loyaltyEarnRule.update).mockResolvedValue(updated as any)
    const res = await PATCH(
      makeReq("http://localhost/api/v1/loyalty-earn-rules/rule-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed rule", priority: 5 }),
      }),
      makeCtx("rule-1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rule.name).toBe("Renamed rule")
    expect(body.rule.priority).toBe(5)
  })
})

// ─── DELETE /api/v1/loyalty-earn-rules/[id] ──────────────────────────────────

describe("DELETE /api/v1/loyalty-earn-rules/[id]", () => {
  it("returns 404 when rule not found", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findFirst).mockResolvedValue(null)
    const res = await DELETE(
      makeReq("http://localhost/api/v1/loyalty-earn-rules/rule-99", {
        method: "DELETE",
      }),
      makeCtx("rule-99"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes rule and returns ok with name", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findFirst).mockResolvedValue(RULE_ROW as any)
    vi.mocked(prisma.loyaltyEarnRule.delete).mockResolvedValue(RULE_ROW as any)
    const res = await DELETE(
      makeReq("http://localhost/api/v1/loyalty-earn-rules/rule-1", {
        method: "DELETE",
      }),
      makeCtx("rule-1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.name).toBe("Purchase 1pt per $")
  })

  it("returns 500 on DB error during delete", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findFirst).mockResolvedValue(RULE_ROW as any)
    vi.mocked(prisma.loyaltyEarnRule.delete).mockRejectedValue(new Error("DB error"))
    const res = await DELETE(
      makeReq("http://localhost/api/v1/loyalty-earn-rules/rule-1", {
        method: "DELETE",
      }),
      makeCtx("rule-1"),
    )
    expect(res.status).toBe(500)
  })
})
