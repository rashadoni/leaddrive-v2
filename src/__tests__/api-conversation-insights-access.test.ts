import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

import { GET } from "@/app/api/v1/conversation-insights/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const REQUEST = () => new NextRequest("http://localhost:3000/api/v1/conversation-insights?days=7")
const AUTH = {
  orgId: "org-1",
  userId: "sales-1",
  role: "sales",
  email: "seller@example.test",
  name: "Seller",
}

describe("GET /api/v1/conversation-insights access", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([] as never)
  })

  it("preserves the VoIP read authorization gate", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as never,
    )

    const response = await GET(REQUEST())

    expect(response.status).toBe(403)
    expect(prisma.callLog.findMany).not.toHaveBeenCalled()
  })

  it("limits a salesperson to insights from their own calls", async () => {
    const response = await GET(REQUEST())

    expect(response.status).toBe(200)
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        userId: "sales-1",
        insightsAt: expect.objectContaining({ not: null }),
      }),
    }))
  })

  it("lets a manager aggregate tenant insights without a user filter", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...AUTH, role: "manager" } as never)

    const response = await GET(REQUEST())

    expect(response.status).toBe(200)
    const where = vi.mocked(prisma.callLog.findMany).mock.calls[0][0]!.where
    expect(where).toMatchObject({ organizationId: "org-1" })
    expect(where).not.toHaveProperty("userId")
  })
})
