import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const state: {
  authOk: boolean
  user: Record<string, unknown> | null
  lastUpdate: Record<string, unknown> | null
} = {
  authOk: true,
  user: null,
  lastUpdate: null,
}

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(async () => {
    if (!state.authOk) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return {
      orgId: "org-1",
      userId: "admin-1",
      role: "admin",
      email: "admin@example.com",
      name: "Admin",
    }
  }),
  orgHasModule: vi.fn(async () => true),
  moduleDisabledResponse: vi.fn((moduleId: string) =>
    NextResponse.json({ error: "Forbidden", message: `Module "${moduleId}" is not enabled.` }, { status: 403 })),
  isAuthError: vi.fn((value: unknown) => value instanceof NextResponse),
}))

vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(),
  prisma: {
    user: {
      findFirst: vi.fn(async () => state.user),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.lastUpdate = data
        return { ...state.user, ...data }
      }),
    },
  },
}))

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(async (password: string) => `HASH(${password})`),
  },
}))

import { POST } from "@/app/api/v1/users/[id]/reset-password/route"
import { logAudit } from "@/lib/prisma"

const params = { params: Promise.resolve({ id: "user-1" }) }

function request(body: Record<string, unknown>) {
  return new NextRequest("https://example.com/api/v1/users/user-1/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.authOk = true
  state.lastUpdate = null
  state.user = {
    id: "user-1",
    organizationId: "org-1",
    name: "Advisor Manager",
    email: "advisor.manager@example.com",
    isActive: true,
    passwordChangedAt: null,
  }
  vi.clearAllMocks()
})

describe("POST /api/v1/users/[id]/reset-password", () => {
  it("rejects mismatched confirmation without changing the account", async () => {
    const response = await POST(request({
      password: "Valid-Test-Pass-2026!",
      confirmPassword: "Different2026!",
    }), params)

    expect(response.status).toBe(400)
    expect(state.lastUpdate).toBeNull()
  })

  it("returns 404 when the target user is outside the tenant", async () => {
    state.user = null

    const response = await POST(request({
      password: "Valid-Test-Pass-2026!",
      confirmPassword: "Valid-Test-Pass-2026!",
    }), params)

    expect(response.status).toBe(404)
  })

  it("hashes the new password, invalidates sessions, and writes a redacted audit", async () => {
    const response = await POST(request({
      password: "Valid-Test-Pass-2026!",
      confirmPassword: "Valid-Test-Pass-2026!",
    }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(state.lastUpdate).toMatchObject({
      passwordHash: "HASH(Valid-Test-Pass-2026!)",
      resetToken: null,
      resetTokenExp: null,
    })
    expect(state.lastUpdate?.passwordChangedAt).toBeInstanceOf(Date)
    expect(logAudit).toHaveBeenCalledWith(
      "org-1",
      "password_reset",
      "user",
      "user-1",
      "advisor.manager@example.com",
      expect.objectContaining({
        userId: "admin-1",
        newValue: expect.objectContaining({ sessionsInvalidated: true }),
      }),
    )
    expect(JSON.stringify(vi.mocked(logAudit).mock.calls)).not.toContain("Valid-Test-Pass-2026!")
    expect(JSON.stringify(vi.mocked(logAudit).mock.calls)).not.toContain("HASH(")
  })

  it("resets a disabled account but reports that it remains inactive", async () => {
    state.user = { ...state.user, isActive: false }

    const response = await POST(request({
      password: "Valid-Test-Pass-2026!",
      confirmPassword: "Valid-Test-Pass-2026!",
    }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.isActive).toBe(false)
  })

  it("requires an authenticated settings administrator", async () => {
    state.authOk = false

    const response = await POST(request({
      password: "Valid-Test-Pass-2026!",
      confirmPassword: "Valid-Test-Pass-2026!",
    }), params)

    expect(response.status).toBe(401)
  })
})
