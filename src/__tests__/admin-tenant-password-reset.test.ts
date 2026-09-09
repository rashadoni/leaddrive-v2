import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const state: {
  authAllowed: boolean
  mutationRejected: boolean
  rateLimitAllowed: boolean
  tenant: Record<string, unknown> | null
  user: Record<string, unknown> | null
  updatedCount: number
  throwOnLookup: boolean
} = {
  authAllowed: true,
  mutationRejected: false,
  rateLimitAllowed: true,
  tenant: null,
  user: null,
  updatedCount: 1,
  throwOnLookup: false,
}

vi.mock("@/lib/superadmin-guard", () => ({
  requireSuperAdmin: vi.fn(async () => {
    if (!state.authAllowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return {
      orgId: "platform-org",
      userId: "superadmin-1",
      role: "superadmin",
      email: "owner@leaddrivecrm.org",
      name: "Platform Owner",
    }
  }),
}))

vi.mock("@/lib/social/review-apply-request", () => ({
  guardInteractiveJsonMutation: vi.fn(() => state.mutationRejected
    ? NextResponse.json({ error: "cross_origin_request_rejected" }, { status: 403 })
    : null),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => state.rateLimitAllowed),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: vi.fn(async (callback: () => Promise<unknown>) => callback()),
}))

vi.mock("@/lib/request-ip", () => ({
  clientIp: vi.fn(() => "203.0.113.9"),
}))

vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(async () => undefined),
  prisma: {
    organization: {
      findUnique: vi.fn(async () => {
        if (state.throwOnLookup) throw new Error("database unavailable")
        return state.tenant
      }),
    },
    user: {
      findFirst: vi.fn(async () => state.user),
      updateMany: vi.fn(async () => ({ count: state.updatedCount })),
    },
  },
}))

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(async (password: string, cost: number) => `HASH(${cost}:${password})`),
  },
}))

import { POST } from "@/app/api/v1/admin/tenants/[id]/users/[userId]/reset-password/route"
import { checkRateLimit } from "@/lib/rate-limit"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { runWithRlsBypass } from "@/lib/rls-context"
import { logAudit, prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"

const params = {
  params: Promise.resolve({ id: "tenant-1", userId: "admin-1" }),
}

function request(body: unknown = {
  password: "Valid-Test-Pass-2026!",
  confirmPassword: "Valid-Test-Pass-2026!",
}) {
  return new NextRequest(
    "https://app.leaddrivecrm.org/api/v1/admin/tenants/tenant-1/users/admin-1/reset-password",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://app.leaddrivecrm.org",
        "User-Agent": "vitest",
      },
      body: JSON.stringify(body),
    },
  )
}

beforeEach(() => {
  state.authAllowed = true
  state.mutationRejected = false
  state.rateLimitAllowed = true
  state.tenant = { id: "tenant-1", name: "Brand Protection", isActive: true }
  state.user = {
    id: "admin-1",
    email: "admin@brandprotection.leaddrivecrm.org",
    role: "admin",
    isActive: true,
    passwordChangedAt: null,
  }
  state.updatedCount = 1
  state.throwOnLookup = false
  vi.clearAllMocks()
})

describe("POST /api/v1/admin/tenants/[id]/users/[userId]/reset-password", () => {
  it("rejects non-superadmins before cross-tenant guards or database access", async () => {
    state.authAllowed = false

    const response = await POST(request(), params)

    expect(response.status).toBe(403)
    expect(guardInteractiveJsonMutation).not.toHaveBeenCalled()
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
  })

  it("rejects a cross-origin interactive mutation before parsing or querying", async () => {
    state.mutationRejected = true

    const response = await POST(request(), params)

    expect(response.status).toBe(403)
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
  })

  it("rate-limits before bcrypt and returns Retry-After", async () => {
    state.rateLimitAllowed = false

    const response = await POST(request(), params)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("60")
    expect(bcrypt.hash).not.toHaveBeenCalled()
  })

  it("rejects mismatched or policy-invalid passwords before cross-tenant access", async () => {
    const mismatch = await POST(request({
      password: "Valid-Test-Pass-2026!",
      confirmPassword: "Different-Test-Pass-2026!",
    }), params)
    expect(mismatch.status).toBe(400)

    const weak = await POST(request({
      password: "Short1!",
      confirmPassword: "Short1!",
    }), params)
    expect(weak.status).toBe(400)

    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(bcrypt.hash).not.toHaveBeenCalled()
  })

  it("returns 404 when the tenant does not exist", async () => {
    state.tenant = null

    const response = await POST(request(), params)

    expect(response.status).toBe(404)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 when the exact tenant administrator is not found", async () => {
    state.user = null

    const response = await POST(request(), params)

    expect(response.status).toBe(404)
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "admin-1", organizationId: "tenant-1", role: "admin" },
      select: expect.any(Object),
    })
    expect(bcrypt.hash).not.toHaveBeenCalled()
  })

  it("hashes once, atomically scopes the update, invalidates sessions, and audits without secrets", async () => {
    const response = await POST(request(), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      data: {
        userId: "admin-1",
        isActive: true,
        tenantActive: true,
        sessionsInvalidated: true,
      },
    })
    expect(runWithRlsBypass).toHaveBeenCalledTimes(1)
    expect(bcrypt.hash).toHaveBeenCalledWith("Valid-Test-Pass-2026!", 12)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "admin-1", organizationId: "tenant-1", role: "admin" },
      data: expect.objectContaining({
        passwordHash: "HASH(12:Valid-Test-Pass-2026!)",
        passwordChangedAt: expect.any(Date),
        resetToken: null,
        resetTokenExp: null,
      }),
    })
    expect(prisma.user.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isActive: expect.anything() }),
    }))
    expect(logAudit).toHaveBeenCalledWith(
      "tenant-1",
      "superadmin_password_reset",
      "user",
      "admin-1",
      "admin@brandprotection.leaddrivecrm.org",
      expect.objectContaining({
        userId: "superadmin-1",
        ipAddress: "203.0.113.9",
        newValue: expect.objectContaining({ sessionsInvalidated: true }),
      }),
    )
    const auditPayload = JSON.stringify(vi.mocked(logAudit).mock.calls)
    expect(auditPayload).not.toContain("Valid-Test-Pass-2026!")
    expect(auditPayload).not.toContain("HASH(")
    expect(JSON.stringify(json)).not.toContain("passwordHash")
  })

  it("does not reactivate a disabled administrator", async () => {
    state.user = { ...(state.user ?? {}), isActive: false }

    const response = await POST(request(), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.isActive).toBe(false)
    expect(prisma.user.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isActive: expect.anything() }),
    }))
  })

  it("fails closed if the scoped account changes before the write", async () => {
    state.updatedCount = 0

    const response = await POST(request(), params)

    expect(response.status).toBe(404)
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("returns a generic error without leaking database details", async () => {
    state.throwOnLookup = true
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await POST(request(), params)
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({ error: "Internal server error" })
    expect(JSON.stringify(json)).not.toContain("database unavailable")
    consoleSpy.mockRestore()
  })

  it("invokes the superadmin guard for every request", async () => {
    await POST(request(), params)
    expect(requireSuperAdmin).toHaveBeenCalledTimes(1)
  })
})
