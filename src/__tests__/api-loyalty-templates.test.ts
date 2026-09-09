/**
 * D8 Loyalty — earn-rule templates endpoint tests (Slice 2 Loyalty Builder).
 *
 * GET  /api/v1/loyalty-templates  — catalog + isApplied (via metadata.templateId)
 * POST /api/v1/loyalty-templates  — apply (create rules), dedup, force, 404/400
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loyaltyEarnRule: { findMany: vi.fn(), create: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET, POST } from "@/app/api/v1/loyalty-templates/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin" }
const req = (body?: object) =>
  new Request("http://localhost/api/v1/loyalty-templates", body ? { method: "POST", body: JSON.stringify(body) } : undefined) as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
})

describe("GET /api/v1/loyalty-templates", () => {
  it("returns the catalog with isApplied=false when no rules carry a templateId", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([] as any)
    const res = await GET(req(), undefined as any)
    const j = await res.json()
    expect(j.success).toBe(true)
    expect(j.data.length).toBeGreaterThanOrEqual(4)
    expect(j.data.every((t: any) => t.isApplied === false)).toBe(true)
    expect(j.data.find((t: any) => t.id === "points-per-dollar")).toMatchObject({ seedTiers: true })
  })

  it("marks a template isApplied when an earn rule carries its templateId", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([{ metadata: { templateId: "welcome-bonus" } }] as any)
    const res = await GET(req(), undefined as any)
    const j = await res.json()
    expect(j.data.find((t: any) => t.id === "welcome-bonus").isApplied).toBe(true)
    expect(j.data.find((t: any) => t.id === "birthday-bonus").isApplied).toBe(false)
  })
})

describe("POST /api/v1/loyalty-templates", () => {
  it("400 on missing templateId", async () => {
    const res = await POST(req({}), undefined as any)
    expect(res.status).toBe(400)
  })

  it("404 on unknown template", async () => {
    const res = await POST(req({ templateId: "nope" }), undefined as any)
    expect(res.status).toBe(404)
  })

  it("409 when already applied and not forced", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([{ metadata: { templateId: "welcome-bonus" } }] as any)
    const res = await POST(req({ templateId: "welcome-bonus" }), undefined as any)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("already_applied")
  })

  it("creates the rule(s) with metadata.templateId and returns 201 + seedTiers hint", async () => {
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.loyaltyEarnRule.create).mockResolvedValue({ id: "rule-new", name: "1 point per $1 spent", trigger: "purchase" } as any)
    const res = await POST(req({ templateId: "points-per-dollar" }), undefined as any)
    expect(res.status).toBe(201)
    const j = await res.json()
    expect(j).toMatchObject({ success: true, templateId: "points-per-dollar", seedTiers: true })
    expect(j.created).toHaveLength(1)
    expect(prisma.loyaltyEarnRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          trigger: "purchase",
          pointsRate: 1,
          applyTierMultiplier: true,
          isActive: true,
          metadata: { templateId: "points-per-dollar" },
        }),
      }),
    )
  })

  it("force re-applies even when already applied (creates a duplicate, skips dedup)", async () => {
    vi.mocked(prisma.loyaltyEarnRule.create).mockResolvedValue({ id: "rule-2", name: "Welcome bonus", trigger: "signup" } as any)
    const res = await POST(req({ templateId: "welcome-bonus", force: true }), undefined as any)
    expect(res.status).toBe(201)
    // dedup findMany is skipped under force, and the rule IS created (a second
    // copy with the same metadata.templateId) — by design.
    expect(prisma.loyaltyEarnRule.findMany).not.toHaveBeenCalled()
    expect(prisma.loyaltyEarnRule.create).toHaveBeenCalledTimes(1)
  })

  it("401 when auth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }) as any)
    const res = await POST(req({ templateId: "welcome-bonus" }), undefined as any)
    expect(res.status).toBe(401)
  })
})
