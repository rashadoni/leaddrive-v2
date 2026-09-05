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

import { DELETE } from "@/app/api/v1/workforce/configuration/access/grants/[id]/route"
import { POST } from "@/app/api/v1/workforce/configuration/access/grants/route"
import { prisma } from "@/lib/prisma"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"

const auth = {
  orgId: "org_1",
  userId: "tenant_admin_1",
  role: "admin",
  principalType: "session" as const,
}

type Handler = (req: NextRequest, auth: typeof auth) => Promise<Response>
const post = POST as unknown as Handler
type DeleteHandler = (req: NextRequest, auth: typeof auth, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
const revoke = DELETE as unknown as DeleteHandler

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/workforce/configuration/access/grants", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "203.0.113.40",
      "user-agent": "workforce-grant-test",
    },
    body: JSON.stringify(body),
  })
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "grant-op-1",
    principalUserId: "employee_2",
    role: "SCHEDULER",
    scope: { kind: "ORGANIZATION" },
    grantReasonCode: "ONBOARDING_ASSIGNMENT",
    ...overrides,
  }
}

const tenantAdminGrant = {
  id: "grant_tenant_admin_1",
  organizationId: auth.orgId,
  principalUserId: auth.userId,
  role: "TENANT_ADMIN",
  scopeKind: "ORGANIZATION",
  scopeTeamId: null,
  scopeSiteId: null,
  scopeAgentId: null,
  effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
  effectiveUntil: null,
  revocation: null,
}

const evidenceReviewerGrant = {
  ...tenantAdminGrant,
  id: "grant_evidence_1",
  principalUserId: "employee_2",
  role: "EVIDENCE_REVIEWER",
}

const revocableGrant = {
  id: "grant_scheduler_1",
  organizationId: auth.orgId,
  principalUserId: "employee_2",
  operationId: "grant-op-previous",
  role: "SCHEDULER",
  scopeKind: "ORGANIZATION",
  scopeTeamId: null,
  scopeSiteId: null,
  scopeAgentId: null,
  effectiveFrom: new Date("2026-09-02T00:00:00.000Z"),
  effectiveUntil: null,
  grantedByUserId: auth.userId,
  grantReasonCode: "ONBOARDING_ASSIGNMENT",
}

function revocationRequest(body: Record<string, unknown> = {}) {
  return request({
    operationId: "revoke-op-1",
    revocationReasonCode: "ROLE_CHANGE",
    ...body,
  })
}

const revokeContext = { params: Promise.resolve({ id: "grant_scheduler_1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValue(null)
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "employee_2" } as never)
  vi.mocked(prisma.workforceAccessGrant.findMany).mockImplementation(async (args: unknown) => {
    const principalUserId = (args as { where?: { principalUserId?: string } }).where?.principalUserId
    return principalUserId === auth.userId ? [tenantAdminGrant] : []
  })
  vi.mocked(prisma.workforceAccessGrant.create).mockResolvedValue({ id: "grant_new_1" } as never)
  vi.mocked(prisma.workforceAccessGrant.findFirst).mockResolvedValue(revocableGrant as never)
  vi.mocked(prisma.workforceAccessGrantRevocation.create).mockResolvedValue({
    id: "revocation_new_1",
  } as never)
})

describe("Workforce access-grant configuration API", () => {
  it("requires MFA before parsing, target lookup, grant reads or writes", async () => {
    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValue(NextResponse.json({
      code: "WORKFORCE_ATTENDANCE_MFA_REQUIRED",
    }, { status: 403 }))

    const response = await post(request(validRequest()), auth)

    expect(response.status).toBe(403)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.create).not.toHaveBeenCalled()
  })

  it("creates one audited non-admin grant only after tenant-target and transaction authorization checks", async () => {
    const response = await post(request(validRequest()), auth)

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      success: true,
      idempotent: false,
      data: { grantId: "grant_new_1" },
    })
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: "Serializable",
    }))
    expect(prisma.workforceAccessGrant.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: auth.orgId,
        principalUserId: "employee_2",
        role: "SCHEDULER",
        scopeKind: "ORGANIZATION",
        scopeTeamId: null,
        scopeSiteId: null,
        scopeAgentId: null,
        grantedByUserId: auth.userId,
        grantReasonCode: "ONBOARDING_ASSIGNMENT",
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_ACCESS_GRANT_RECORDED",
        metadataKind: "workforce_access_control",
        ipAddress: "203.0.113.40",
        userAgent: "workforce-grant-test",
      }),
    }))
  })

  it("never lets an administrator self-grant or use HTTP to bootstrap a tenant administrator", async () => {
    const selfGrant = await post(request(validRequest({ principalUserId: auth.userId })), auth)
    const bootstrap = await post(request(validRequest({ role: "TENANT_ADMIN" })), auth)

    expect(selfGrant.status).toBe(409)
    await expect(selfGrant.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_GRANT_SELF_GRANT_DENIED" })
    expect(bootstrap.status).toBe(409)
    await expect(bootstrap.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_GRANT_BOOTSTRAP_ONLY" })
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.create).not.toHaveBeenCalled()
  })

  it("does not reveal or write a cross-tenant, inactive or absent target", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

    const response = await post(request(validRequest()), auth)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_GRANT_TARGET_UNAVAILABLE" })
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.create).not.toHaveBeenCalled()
  })

  it("rejects a separation-of-duties conflict before the transaction without exposing existing roles", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockImplementation(async (args: unknown) => {
      const principalUserId = (args as { where?: { principalUserId?: string } }).where?.principalUserId
      return principalUserId === "employee_2" ? [evidenceReviewerGrant] : [tenantAdminGrant]
    })

    const response = await post(request(validRequest({ role: "DEVICE_SECURITY_ADMIN" })), auth)

    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload).toMatchObject({ code: "WORKFORCE_ACCESS_GRANT_INCOMPATIBLE_ROLE" })
    expect(JSON.stringify(payload)).not.toContain("EVIDENCE_REVIEWER")
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.create).not.toHaveBeenCalled()
  })

  it("fails closed if the actor loses tenant-admin grant before the write transaction", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockImplementation(async (args: unknown) => {
      const principalUserId = (args as { where?: { principalUserId?: string } }).where?.principalUserId
      return principalUserId === auth.userId ? [] : []
    })

    const response = await post(request(validRequest()), auth)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_GRANT_NOT_AUTHORIZED" })
    expect(prisma.workforceAccessGrant.create).not.toHaveBeenCalled()
  })

  it("appends an audited immutable revocation only after the transaction rechecks tenant-admin authority", async () => {
    const response = await revoke(revocationRequest(), auth, revokeContext)

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      success: true,
      idempotent: false,
      data: { revocationId: "revocation_new_1" },
    })
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: "Serializable",
    }))
    expect(prisma.workforceAccessGrantRevocation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: auth.orgId,
        grantId: "grant_scheduler_1",
        operationId: "revoke-op-1",
        revokedByUserId: auth.userId,
        revocationReasonCode: "ROLE_CHANGE",
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_ACCESS_GRANT_REVOKED",
        ipAddress: "203.0.113.40",
        userAgent: "workforce-grant-test",
      }),
    }))
  })

  it("keeps tenant-admin removal outside the browser endpoint and makes missing/cross-tenant grants indistinguishable", async () => {
    vi.mocked(prisma.workforceAccessGrant.findFirst).mockResolvedValueOnce({
      ...revocableGrant,
      role: "TENANT_ADMIN",
    } as never)
    const tenantAdmin = await revoke(revocationRequest(), auth, revokeContext)

    vi.mocked(prisma.workforceAccessGrant.findFirst).mockResolvedValueOnce(null)
    const missing = await revoke(revocationRequest(), auth, revokeContext)

    expect(tenantAdmin.status).toBe(409)
    await expect(tenantAdmin.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_REVOCATION_BOOTSTRAP_ONLY" })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_REVOCATION_TARGET_UNAVAILABLE" })
    expect(prisma.workforceAccessGrantRevocation.create).not.toHaveBeenCalled()
  })

  it("fails closed before any revoke write when MFA or transaction authorization is unavailable", async () => {
    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValueOnce(NextResponse.json({
      code: "WORKFORCE_ATTENDANCE_MFA_REQUIRED",
    }, { status: 403 }))
    const mfa = await revoke(revocationRequest(), auth, revokeContext)
    expect(mfa.status).toBe(403)
    expect(prisma.workforceAccessGrant.findFirst).not.toHaveBeenCalled()

    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])
    const authorization = await revoke(revocationRequest(), auth, revokeContext)
    expect(authorization.status).toBe(403)
    await expect(authorization.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_GRANT_NOT_AUTHORIZED" })
    expect(prisma.workforceAccessGrantRevocation.create).not.toHaveBeenCalled()
  })
})
