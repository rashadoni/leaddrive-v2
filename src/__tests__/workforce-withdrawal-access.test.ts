import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const AUTH = { orgId: "org-withdrawal", userId: "admin", role: "superadmin", principalType: "session" }
vi.mock("@/lib/prisma", () => ({ prisma: {
  organization: { findUnique: vi.fn() }, workforceAccessGrant: { findMany: vi.fn() },
} }))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: vi.fn((_scope, _action, handler) => (req: NextRequest) => handler(req, AUTH)),
  withRlsSessionAuth: vi.fn((handler) => (req: NextRequest) => handler(req, AUTH)),
}))
import { prisma } from "@/lib/prisma"
import {
  withWorkforceRlsAuth, withWorkforceSessionAuth, withWorkforceSessionAdminAuth,
  withWorkforceSessionScheduleConfigurationAuth, withWorkforceSessionPolicyConfigurationAuth,
  withWorkforceSessionEmploymentConfigurationAuth, withWorkforceSessionPilotFenceAuth,
  withWorkforceSessionRetentionReadAuth, withWorkforceSessionExceptionQueueAuth,
  withWorkforceSessionExceptionDecisionAuth,
} from "@/lib/with-workforce-rls-auth"
import { getTenantCapabilityAccess } from "@/lib/tenant-capability-access"

// Real product availability, real entitlement evaluation and real Workforce
// wrappers. Only the outer login and database are fixtures; never enable HRM.
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "enterprise", modules: { "workforce-hrm": true, mtm: true },
    features: ["workforce-hrm", "workforce-granular-access-v1"], addons: [],
  } as never)
})

describe("withdrawn HRM authorization", () => {
  it("denies all retained Workforce handlers even to an entitled superadmin", async () => {
    const handler = vi.fn(async () => NextResponse.json({ secret: "must-not-be-read" }))
    const wrappers = [
      withWorkforceRlsAuth("read", handler), withWorkforceSessionAuth("write", handler),
      withWorkforceSessionAdminAuth(handler),
      withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_WRITE", handler),
      withWorkforceSessionPolicyConfigurationAuth(handler),
      withWorkforceSessionEmploymentConfigurationAuth(handler),
      withWorkforceSessionPilotFenceAuth(handler), withWorkforceSessionRetentionReadAuth(handler),
      withWorkforceSessionExceptionQueueAuth(handler), withWorkforceSessionExceptionDecisionAuth(handler),
    ]
    for (const wrapped of wrappers) {
      const response = await wrapped(new NextRequest("http://localhost/api/v1/workforce/today"))
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED" })
    }
    expect(handler).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
  })

  it("denies the alternative capability reader without querying stored HRM grants", async () => {
    expect(await getTenantCapabilityAccess(AUTH.orgId, "workforce-hrm")).toMatchObject({ allowed: false })
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
  })
})
