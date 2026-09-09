import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST /api/v1/users/me/change-password — self-service password change with
 * current-password verification. bcrypt is mocked: compare() returns true only
 * when the supplied current password equals state.currentPassword; hash()
 * returns a deterministic stub so we can assert it was applied.
 */

const state: {
  authOk: boolean
  user: any
  currentPassword: string // the "real" current password compare() accepts
  lastUpdate: any
  updateCount: number
} = {
  authOk: true,
  user: null,
  currentPassword: "OldPass123",
  lastUpdate: null,
  updateCount: 1,
}

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(async () => {
    if (!state.authOk) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return { userId: "u1", orgId: "org_1", role: "sales", email: "me@b.com", name: "Me" }
  }),
  isAuthError: vi.fn((x: any) => x instanceof NextResponse),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async () => state.user),
      updateMany: vi.fn(async ({ where, data }: any) => {
        state.lastUpdate = { where, data }
        return { count: state.updateCount }
      }),
    },
  },
}))

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(async (plain: string) => plain === state.currentPassword),
    hash: vi.fn(async (p: string) => `H(${p})`),
  },
}))

import { POST } from "@/app/api/v1/users/me/change-password/route"

function req(body: any): NextRequest {
  return new NextRequest("https://example.com/api/v1/users/me/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.authOk = true
  state.currentPassword = "OldPass123!Strong"
  state.lastUpdate = null
  state.updateCount = 1
  state.user = { id: "u1", organizationId: "org_1", passwordHash: "H(OldPass123!Strong)" }
  vi.clearAllMocks()
})

describe("POST /api/v1/users/me/change-password", () => {
  it("changes the password on the happy path: hashes new + sets passwordChangedAt", async () => {
    const before = Date.now()
    const res = await POST(req({ currentPassword: "OldPass123!Strong", newPassword: "BrandNew456!" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true })

    expect(state.lastUpdate.where).toEqual({ id: "u1", organizationId: "org_1" })
    expect(state.lastUpdate.data.passwordHash).toBe("H(BrandNew456!)")
    expect(state.lastUpdate.data.passwordChangedAt).toBeInstanceOf(Date)
    expect(state.lastUpdate.data.passwordChangedAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it("rejects a wrong current password with 400 and never writes", async () => {
    const res = await POST(req({ currentPassword: "WrongOne", newPassword: "BrandNew456!" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/current password is incorrect/i)
    expect(state.lastUpdate).toBeNull()
  })

  it("rejects when new === current with 400 and never writes", async () => {
    const res = await POST(req({ currentPassword: "OldPass123!Strong", newPassword: "OldPass123!Strong" }))
    expect(res.status).toBe(400)
    expect(state.lastUpdate).toBeNull()
  })

  it("rejects the pentest weak password before credential comparison", async () => {
    const res = await POST(req({ currentPassword: "OldPass123!Strong", newPassword: "12345678" }))
    expect(res.status).toBe(400)
    expect(state.lastUpdate).toBeNull()
  })

  it("returns 404 when the user row is missing", async () => {
    state.user = null
    const res = await POST(req({ currentPassword: "OldPass123!Strong", newPassword: "BrandNew456!" }))
    expect(res.status).toBe(404)
  })

  it("returns 401 when unauthenticated", async () => {
    state.authOk = false
    const res = await POST(req({ currentPassword: "OldPass123!Strong", newPassword: "BrandNew456!" }))
    expect(res.status).toBe(401)
  })
})
