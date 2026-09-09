/**
 * D8 Loyalty — LoyaltyReward CRUD route tests (the redeem catalog admin API).
 * GET list / POST create (+ validation) / PATCH update (+ 404) / DELETE (+ 404),
 * all tenant-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loyaltyReward: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET, POST } from "@/app/api/v1/loyalty-rewards/route"
import { PATCH, DELETE } from "@/app/api/v1/loyalty-rewards/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "u-1", role: "admin" }
const mkReq = (body?: object, method = "GET") =>
  new Request("http://x/api/v1/loyalty-rewards", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as any
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
})

describe("loyalty-rewards CRUD", () => {
  it("GET lists rewards cheapest-first", async () => {
    vi.mocked(prisma.loyaltyReward.findMany).mockResolvedValue([{ id: "r1", name: "Coffee", pointsCost: 50 }] as any)
    const j = await (await GET(mkReq(), undefined as any)).json()
    expect(j.rewards).toHaveLength(1)
    expect(prisma.loyaltyReward.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ pointsCost: "asc" }, { createdAt: "asc" }] }),
    )
  })

  it("POST 400 on missing name", async () => {
    expect((await POST(mkReq({ pointsCost: 50 }, "POST"), undefined as any)).status).toBe(400)
  })
  it("POST 400 on non-positive pointsCost", async () => {
    expect((await POST(mkReq({ name: "X", pointsCost: 0 }, "POST"), undefined as any)).status).toBe(400)
  })
  it("POST creates a reward (201), org-scoped, isActive default true", async () => {
    vi.mocked(prisma.loyaltyReward.create).mockResolvedValue({ id: "r1", name: "Coffee", pointsCost: 50 } as any)
    const res = await POST(mkReq({ name: "Coffee", description: "Free coffee", pointsCost: 50 }, "POST"), undefined as any)
    expect(res.status).toBe(201)
    expect(prisma.loyaltyReward.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-1", name: "Coffee", pointsCost: 50, isActive: true, createdBy: "u-1" }),
      }),
    )
  })

  it("PATCH 404 when not found", async () => {
    vi.mocked(prisma.loyaltyReward.updateMany).mockResolvedValue({ count: 0 } as any)
    expect((await PATCH(mkReq({ pointsCost: 75 }, "PATCH"), ctx("nope"))).status).toBe(404)
  })
  it("PATCH updates only the given fields, tenant-scoped", async () => {
    vi.mocked(prisma.loyaltyReward.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.loyaltyReward.findFirst).mockResolvedValue({ id: "r1", pointsCost: 75 } as any)
    const res = await PATCH(mkReq({ pointsCost: 75 }, "PATCH"), ctx("r1"))
    expect(res.status).toBe(200)
    expect(prisma.loyaltyReward.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", organizationId: "org-1" }, data: { pointsCost: 75 } }),
    )
  })
  it("PATCH 400 when no fields provided", async () => {
    expect((await PATCH(mkReq({}, "PATCH"), ctx("r1"))).status).toBe(400)
  })

  it("DELETE 404 when not found", async () => {
    vi.mocked(prisma.loyaltyReward.deleteMany).mockResolvedValue({ count: 0 } as any)
    expect((await DELETE(mkReq(undefined, "DELETE"), ctx("nope"))).status).toBe(404)
  })
  it("DELETE removes, tenant-scoped", async () => {
    vi.mocked(prisma.loyaltyReward.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await DELETE(mkReq(undefined, "DELETE"), ctx("r1"))
    expect(res.status).toBe(200)
    expect(prisma.loyaltyReward.deleteMany).toHaveBeenCalledWith({ where: { id: "r1", organizationId: "org-1" } })
  })
})
