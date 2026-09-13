import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workforceAccessGrant: { findMany: vi.fn() },
    mtmAuditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionGrantManagementAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/workforce/attendance-route", () => ({
  requireWorkforceAttendanceSecurityMfa: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/access-grant-rate-limit", () => ({
  requireWorkforceAccessGrantRateLimit: vi.fn(async () => null),
}))

import { GET } from "@/app/api/v1/workforce/configuration/access/review/route"
import { prisma } from "@/lib/prisma"
import { requireWorkforceAccessGrantRateLimit } from "@/lib/workforce/access-grant-rate-limit"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"

const AUTH = { orgId: "org-review", userId: "custodian-1", role: "admin", principalType: "session" as const }
const invoke = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>
const request = () => new NextRequest("http://localhost/api/v1/workforce/configuration/access/review", {
  headers: { "x-real-ip": "203.0.113.44", "user-agent": "access-review-test" },
})

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    organizationId: AUTH.orgId,
    principalUserId: "employee-1",
    role: "SCHEDULER",
    scopeKind: "ORGANIZATION",
    scopeTeamId: null,
    scopeSiteId: null,
    scopeAgentId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    principalUser: { isActive: true },
    revocation: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValue(null)
  vi.mocked(requireWorkforceAccessGrantRateLimit).mockResolvedValue(null)
  vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
})

describe("GET /api/v1/workforce/configuration/access/review", () => {
  it("reviews durable tenant grants without inventing missing usage evidence", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([
      grant({
        effectiveUntil: new Date("2026-08-01T00:00:00.000Z"),
        principalUser: { isActive: false },
      }),
    ] as never)

    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        review: {
          activityEvidence: "UNAVAILABLE",
          grantsExamined: 1,
          actionsExamined: 0,
          findingCounts: { EXPIRED_UNREVOKED: 1, PRINCIPAL_INACTIVE: 1 },
          findings: [{ grantId: "grant-1", codes: ["EXPIRED_UNREVOKED", "PRINCIPAL_INACTIVE"] }],
          automaticAction: "NONE",
        },
      },
    })
    expect(prisma.workforceAccessGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: AUTH.orgId },
      take: 1001,
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: AUTH.orgId,
        action: "WORKFORCE_ACCESS_REVIEW_VIEWED",
        newData: expect.objectContaining({ activityEvidence: "UNAVAILABLE", grantsExamined: 1 }),
      }),
    }))
    const audit = vi.mocked(prisma.mtmAuditLog.create).mock.calls[0]?.[0]
    expect(JSON.stringify(audit)).not.toContain("employee-1")
    expect(JSON.stringify(audit)).not.toContain("grant-1")
  })

  it("fails before reading the ledger when MFA or the shared budget denies", async () => {
    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValueOnce(
      NextResponse.json({ code: "WORKFORCE_ATTENDANCE_MFA_REQUIRED" }, { status: 403 }),
    )
    expect((await invoke(request(), AUTH)).status).toBe(403)
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()

    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValueOnce(null)
    vi.mocked(requireWorkforceAccessGrantRateLimit).mockResolvedValueOnce(
      NextResponse.json({ code: "WORKFORCE_ACCESS_GRANT_RATE_LIMITED" }, { status: 429 }),
    )
    expect((await invoke(request(), AUTH)).status).toBe(429)
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
  })

  it("refuses an unbounded tenant inventory without writing review audit", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue(
      Array.from({ length: 1001 }, (_, index) => grant({ id: `grant-${index}` })) as never,
    )

    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_REVIEW_LIMIT_EXCEEDED" })
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("contains storage failures without logging private grant detail", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockRejectedValueOnce(
      new Error("employee-1 grant-1 private"),
    )
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(consoleError).toHaveBeenCalledWith(
      "[workforce/privacy] sensitive operation failed",
      { operation: "configuration-access-review" },
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("employee-1")
  })
})
