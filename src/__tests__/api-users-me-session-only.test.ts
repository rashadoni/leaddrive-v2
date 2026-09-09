import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const guardState = vi.hoisted(() => ({ browserSession: false }))

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(async () => {
    if (!guardState.browserSession) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    }
    return {
      orgId: "org-1",
      userId: "owner-user",
      role: "admin",
      email: "owner@example.com",
      name: "Owner",
    }
  }),
  // This is deliberately valid. The regression is that users/me handlers must
  // never reach this API-key-capable fallback after browser-session denial.
  requireAuth: vi.fn(async () => ({
    orgId: "org-1",
    userId: "owner-user",
    role: "admin",
    email: "",
    name: "API Key: owner automation",
    scopes: ["write:users"],
  })),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    userApprovalDelegate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }))
vi.mock("sharp", () => ({ default: vi.fn() }))

import { requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { PATCH as patchProfile } from "@/app/api/v1/users/me/route"
import { POST as uploadAvatar } from "@/app/api/v1/users/me/avatar/route"
import { POST as revokeSessions } from "@/app/api/v1/users/me/revoke-sessions/route"
import { POST as createDelegate } from "@/app/api/v1/users/me/approval-delegates/route"

const bearerHeaders = {
  authorization: "Bearer ld_valid_owner_key",
  "content-type": "application/json",
}

function request(path: string, method: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: bearerHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  guardState.browserSession = false
  vi.clearAllMocks()
})

describe("/api/v1/users/me session-cookie-only boundary", () => {
  it("rejects an API key before email/avatar/revoke/delegate handlers touch Prisma", async () => {
    const attempts = [
      () => patchProfile(request("/api/v1/users/me", "PATCH", { email: "attacker@example.com" })),
      () => uploadAvatar(request("/api/v1/users/me/avatar", "POST")),
      () => revokeSessions(request("/api/v1/users/me/revoke-sessions", "POST")),
      () => createDelegate(request("/api/v1/users/me/approval-delegates", "POST", {
        toUserId: "attacker-user",
        startDate: "2026-08-11T00:00:00.000Z",
        endDate: "2026-08-12T00:00:00.000Z",
      })),
    ]

    for (const attempt of attempts) {
      const response = await attempt()
      expect(response.status).toBe(401)
    }

    expect(requireSessionAuth).toHaveBeenCalledTimes(attempts.length)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
    expect(prisma.userApprovalDelegate.findFirst).not.toHaveBeenCalled()
    expect(prisma.userApprovalDelegate.create).not.toHaveBeenCalled()
  })

  it("allows the same profile handler for a valid browser session", async () => {
    guardState.browserSession = true
    vi.mocked(prisma.user.findFirst).mockImplementation(async ({ where }: any) => {
      if (where?.NOT) return null
      return {
        id: "owner-user",
        organizationId: "org-1",
        name: "New Owner",
        email: "owner@example.com",
        phone: "+994501234567",
      }
    })
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await patchProfile(request("/api/v1/users/me", "PATCH", {
      name: "New Owner",
      phone: "+994 (50) 123-45-67",
    }))

    expect(response.status).toBe(200)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "owner-user", organizationId: "org-1" },
      data: { name: "New Owner", phone: "+994501234567" },
    })
    expect(requireAuth).not.toHaveBeenCalled()
  })
})
