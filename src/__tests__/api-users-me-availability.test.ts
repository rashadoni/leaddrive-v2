import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const state = {
  authOk: true,
  user: { isAvailable: true } as { isAvailable: boolean } | null,
  updateCount: 1,
}

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(async () => state.authOk
    ? { userId: "u1", orgId: "org-1", role: "support", email: "a@b.c", name: "Agent" }
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 })),
  isAuthError: vi.fn((value: unknown) => value instanceof NextResponse),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async () => state.user),
      updateMany: vi.fn(async () => ({ count: state.updateCount })),
    },
  },
}))

import { GET, PATCH } from "@/app/api/v1/users/me/availability/route"
import { prisma } from "@/lib/prisma"

const request = (method = "GET", body?: unknown) => new NextRequest(
  "http://localhost:3000/api/v1/users/me/availability",
  {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  },
)

beforeEach(() => {
  vi.clearAllMocks()
  state.authOk = true
  state.user = { isAvailable: true }
  state.updateCount = 1
})

describe("self-service availability", () => {
  it("reads only the caller's tenant-scoped availability truth", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { isAvailable: true } })
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "u1", organizationId: "org-1" },
      select: { isAvailable: true },
    })
  })

  it("writes only the caller's tenant-scoped row and returns server truth", async () => {
    const response = await PATCH(request("PATCH", { isAvailable: false }))
    expect(response.status).toBe(200)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", organizationId: "org-1" },
      data: { isAvailable: false },
    })
    expect(await response.json()).toEqual({ success: true, data: { isAvailable: false } })
  })

  it("fails visibly when no user row was updated", async () => {
    state.updateCount = 0
    const response = await PATCH(request("PATCH", { isAvailable: false }))
    expect(response.status).toBe(404)
  })

  it("rejects unauthenticated reads without touching data", async () => {
    state.authOk = false
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })
})
