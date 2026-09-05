import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionGrantManagementAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/workforce/attendance-route", () => ({
  requireWorkforceAttendanceSecurityMfa: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/access-grant-rate-limit", () => ({
  requireWorkforceAccessGrantRateLimit: vi.fn(async () => null),
}))

import { GET } from "@/app/api/v1/workforce/configuration/access/grant-targets/route"
import { prisma } from "@/lib/prisma"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { requireWorkforceAccessGrantRateLimit } from "@/lib/workforce/access-grant-rate-limit"

const AUTH = {
  orgId: "org-1",
  userId: "tenant-admin-1",
  role: "admin",
  principalType: "session" as const,
}
const invoke = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function request(query: string) {
  return new NextRequest("http://localhost/api/v1/workforce/configuration/access/grant-targets?" + query, {
    headers: {
      "x-real-ip": "203.0.113.64",
      "user-agent": "workforce-grant-target-search-test",
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValue(null)
  vi.mocked(requireWorkforceAccessGrantRateLimit).mockResolvedValue(null)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
})

describe("GET /api/v1/workforce/configuration/access/grant-targets", () => {
  it("returns only bounded tenant-local active principal labels and metadata-only search audit", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", name: "Aysel Aliyeva", email: "aysel@example.test" },
    ] as never)

    const response = await invoke(request("kind=PRINCIPAL&q=ay"), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        kind: "PRINCIPAL",
        items: [{ id: "user-1", label: "Aysel Aliyeva · aysel@example.test" }],
        hasMore: false,
      },
    })
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: AUTH.orgId,
        isActive: true,
        OR: [
          { name: { contains: "ay", mode: "insensitive" } },
          { email: { contains: "ay", mode: "insensitive" } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 26,
      select: { id: true, name: true, email: true },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_ACCESS_GRANT_TARGET_SEARCHED",
        entityId: "PRINCIPAL",
        newData: {
          targetKind: "PRINCIPAL",
          queryLength: 2,
          resultCount: 1,
          hasMore: false,
        },
        ipAddress: "203.0.113.64",
        userAgent: "workforce-grant-target-search-test",
      }),
    }))
    expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toContain("Aysel")
    expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toContain("aysel@example.test")
  })

  it("uses the exact active team, site and agent directory predicates", async () => {
    vi.mocked(prisma.mtmTeam.findMany).mockResolvedValue([
      { id: "team-1", name: "North team", code: "NORTH" },
    ] as never)
    vi.mocked(prisma.workforceSite.findMany).mockResolvedValue([
      { id: "site-1", name: "Baku office", code: "BAKU" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Aysel Aliyeva", email: "aysel@example.test", externalCode: null },
    ] as never)

    await expect(invoke(request("kind=TEAM&q=no"), AUTH)).resolves.toHaveProperty("status", 200)
    await expect(invoke(request("kind=SITE&q=ba"), AUTH)).resolves.toHaveProperty("status", 200)
    await expect(invoke(request("kind=AGENT&q=ay"), AUTH)).resolves.toHaveProperty("status", 200)

    expect(prisma.mtmTeam.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: AUTH.orgId, isActive: true }),
      take: 26,
    }))
    expect(prisma.workforceSite.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: AUTH.orgId, status: "ACTIVE" }),
      take: 26,
    }))
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: AUTH.orgId, status: "ACTIVE" }),
      take: 26,
    }))
  })

  it("requires MFA before parsing, rate guard, directory lookup or audit", async () => {
    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValue(NextResponse.json({
      code: "WORKFORCE_ATTENDANCE_MFA_REQUIRED",
    }, { status: 403 }))

    const response = await invoke(request("kind=PRINCIPAL&q=ay"), AUTH)

    expect(response.status).toBe(403)
    expect(requireWorkforceAccessGrantRateLimit).not.toHaveBeenCalled()
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("rejects short/invalid target searches before charging a rate budget", async () => {
    const invalid = await invoke(request("kind=PRINCIPAL&q=a"), AUTH)
    const unknown = await invoke(request("kind=UNKNOWN&q=ay"), AUTH)

    expect(invalid.status).toBe(400)
    expect(unknown.status).toBe(400)
    expect(requireWorkforceAccessGrantRateLimit).not.toHaveBeenCalled()
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails closed before any directory lookup or audit if the shared guard denies", async () => {
    vi.mocked(requireWorkforceAccessGrantRateLimit).mockResolvedValue(NextResponse.json({
      code: "WORKFORCE_ACCESS_GRANT_RATE_LIMITED",
    }, { status: 429 }))

    const response = await invoke(request("kind=PRINCIPAL&q=ay"), AUTH)

    expect(response.status).toBe(429)
    expect(requireWorkforceAccessGrantRateLimit).toHaveBeenCalledWith({
      operation: "INVENTORY",
      organizationId: AUTH.orgId,
      principalUserId: AUTH.userId,
    })
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})
