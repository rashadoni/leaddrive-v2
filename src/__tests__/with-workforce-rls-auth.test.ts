import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const sessionRole = vi.hoisted(() => ({ value: "manager" }))

const AUTH = {
  orgId: "org-1",
  userId: "user-1",
  role: "manager",
  email: "manager@example.test",
  name: "Manager",
  principalType: "session",
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    workforceAccessGrant: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: vi.fn((_module, _action, handler) => (req: NextRequest, ctx?: unknown) => handler(req, AUTH, ctx)),
  withRlsSessionAuth: vi.fn((handler) => (req: NextRequest, ctx?: unknown) => handler(req, {
    ...AUTH,
    role: sessionRole.value,
    principalType: "session",
  }, ctx)),
}))

import { prisma } from "@/lib/prisma"
import { withRlsAuth, withRlsSessionAuth } from "@/lib/with-rls"
import {
  withWorkforceRlsAuth,
  withWorkforceSessionAdminAuth,
  withWorkforceSessionEmploymentConfigurationAuth,
  withWorkforceSessionExceptionDecisionAuth,
  withWorkforceSessionExceptionQueueAuth,
  withWorkforceSessionGrantManagementAuth,
  withWorkforceSessionPilotFenceAuth,
  withWorkforceSessionPolicyConfigurationAuth,
  withWorkforceSessionRetentionReadAuth,
  withWorkforceSessionScheduleConfigurationAuth,
} from "@/lib/with-workforce-rls-auth"

const request = () => new NextRequest("http://localhost:3000/api/v1/workforce/today")

beforeEach(() => {
  vi.clearAllMocks()
  sessionRole.value = "manager"
})
describe("withWorkforceSessionScheduleConfigurationAuth", () => {
  it("preserves legacy admin access and denies a legacy manager", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise", addons: [], features: ["workforce-hrm"], modules: { "workforce-hrm": true },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "admin"
    expect((await withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_WRITE", handler)(request())).status).toBe(200)
    sessionRole.value = "manager"
    expect((await withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_WRITE", handler)(request())).status).toBe(403)
  })

  it("fails closed after granular cutover without an effective grant", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise", addons: [], features: ["workforce-hrm", "workforce-granular-access-v1"], modules: { "workforce-hrm": true },
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "admin"
    const response = await withWorkforceSessionScheduleConfigurationAuth("SITE_ASSIGNMENT_WRITE", handler)(request())
    expect(response.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })
})
describe("withWorkforceSessionPolicyConfigurationAuth", () => {
  function entitled(features: string[]) {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise", addons: [], features, modules: { "workforce-hrm": true },
    } as never)
  }

  it("preserves the session-admin policy boundary before granular cutover", async () => {
    entitled(["workforce-hrm"])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "admin"
    expect((await withWorkforceSessionPolicyConfigurationAuth(handler)(request())).status).toBe(200)
    sessionRole.value = "manager"
    const denied = await withWorkforceSessionPolicyConfigurationAuth(handler)(request())
    expect(denied.status).toBe(403)
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
  })

  it("requires the matching organization HR grant after granular cutover", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{
      id: "policy-grant", organizationId: "org-1", principalUserId: "user-1", role: "HR_ADMIN",
      scopeKind: "ORGANIZATION", scopeTeamId: null, scopeSiteId: null, scopeAgentId: null,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveUntil: null, revocation: null,
    }] as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "sales"
    expect((await withWorkforceSessionPolicyConfigurationAuth(handler)(request())).status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(prisma.workforceAccessGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", principalUserId: "user-1" }),
      take: 201,
    }))
  })

  it("fails closed instead of restoring broad CRM-admin access", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "admin"
    const response = await withWorkforceSessionPolicyConfigurationAuth(handler)(request())
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_GRANULAR_ACCESS_REQUIRED" })
    expect(handler).not.toHaveBeenCalled()
  })
})
describe("withWorkforceSessionPilotFenceAuth", () => {
  function entitled(features: string[]) {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise", addons: [], features, modules: { "workforce-hrm": true },
    } as never)
  }

  it("preserves the accountable admin boundary before granular cutover", async () => {
    entitled(["workforce-hrm"])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "admin"
    expect((await withWorkforceSessionPilotFenceAuth(handler)(request())).status).toBe(200)
    sessionRole.value = "manager"
    expect((await withWorkforceSessionPilotFenceAuth(handler)(request())).status).toBe(403)
  })

  it("requires an organization pilot operator grant after granular cutover", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{
      id: "pilot-grant", organizationId: "org-1", principalUserId: "user-1", role: "PILOT_ROLLBACK_OPERATOR",
      scopeKind: "ORGANIZATION", scopeTeamId: null, scopeSiteId: null, scopeAgentId: null,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveUntil: null, revocation: null,
    }] as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "sales"
    expect((await withWorkforceSessionPilotFenceAuth(handler)(request())).status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("does not restore a broad CRM-admin fallback after cutover", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "admin"
    const response = await withWorkforceSessionPilotFenceAuth(handler)(request())
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_GRANULAR_ACCESS_REQUIRED" })
    expect(handler).not.toHaveBeenCalled()
  })
})
describe("withWorkforceSessionRetentionReadAuth", () => {
  function entitled(features: string[]) {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise", addons: [], features, modules: { "workforce-hrm": true },
    } as never)
  }

  it("preserves the accountable admin boundary before granular cutover", async () => {
    entitled(["workforce-hrm"])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "admin"
    expect((await withWorkforceSessionRetentionReadAuth(handler)(request())).status).toBe(200)
    sessionRole.value = "manager"
    expect((await withWorkforceSessionRetentionReadAuth(handler)(request())).status).toBe(403)
  })

  it("requires the dedicated organization retention-read grant after cutover", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{
      id: "retention-grant", organizationId: "org-1", principalUserId: "user-1", role: "RETENTION_HOLD_OFFICER",
      scopeKind: "ORGANIZATION", scopeTeamId: null, scopeSiteId: null, scopeAgentId: null,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveUntil: null, revocation: null,
    }] as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "sales"

    expect((await withWorkforceSessionRetentionReadAuth(handler)(request())).status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("does not restore broad CRM-admin access after cutover", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "admin"

    const response = await withWorkforceSessionRetentionReadAuth(handler)(request())
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_GRANULAR_ACCESS_REQUIRED" })
    expect(handler).not.toHaveBeenCalled()
  })
})
describe("withWorkforceSessionEmploymentConfigurationAuth", () => {
  it("uses the legacy admin boundary before granular cutover", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise", addons: [], features: ["workforce-hrm"], modules: { "workforce-hrm": true },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "admin"
    expect((await withWorkforceSessionEmploymentConfigurationAuth(handler)(request())).status).toBe(200)
    sessionRole.value = "manager"
    expect((await withWorkforceSessionEmploymentConfigurationAuth(handler)(request())).status).toBe(403)
  })

  it("requires an organization HR grant after granular cutover", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise", addons: [], features: ["workforce-hrm", "workforce-granular-access-v1"], modules: { "workforce-hrm": true },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    sessionRole.value = "admin"
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])
    expect((await withWorkforceSessionEmploymentConfigurationAuth(handler)(request())).status).toBe(403)
    expect(handler).not.toHaveBeenCalled()

    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{
      id: "employment-grant", organizationId: "org-1", principalUserId: "user-1", role: "HR_ADMIN",
      scopeKind: "ORGANIZATION", scopeTeamId: null, scopeSiteId: null, scopeAgentId: null,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveUntil: null, revocation: null,
    }] as never)
    sessionRole.value = "sales"
    expect((await withWorkforceSessionEmploymentConfigurationAuth(handler)(request())).status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
describe("withWorkforceRlsAuth", () => {
  it("requires the dedicated permission scope and active Workforce capability", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["workforce-hrm"],
      modules: { "workforce-hrm": true, mtm: false },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceRlsAuth("read", handler)(request())

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(withRlsAuth).toHaveBeenCalledWith("workforce", "read", expect.any(Function))
  })

  it("keeps the legacy MTM bundle working until Workforce is explicitly split", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceRlsAuth("read", handler)(request())

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("fails closed for a Routes-only tenant before the handler can query HRM data", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceRlsAuth("read", handler)(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "workforce-hrm",
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it("does not fail open if the entitlement lookup fails", async () => {
    vi.mocked(prisma.organization.findUnique).mockRejectedValue(new Error("database unavailable"))
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceRlsAuth("read", handler)(request())

    expect(response.status).toBe(503)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe("withWorkforceSessionAdminAuth", () => {
  it("requires a signed-in tenant administrator instead of accepting the API-key write path", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["workforce-hrm"],
      modules: { "workforce-hrm": true, mtm: false },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const managerResponse = await withWorkforceSessionAdminAuth(handler)(request())

    expect(managerResponse.status).toBe(403)
    await expect(managerResponse.json()).resolves.toMatchObject({ code: "WORKFORCE_POLICY_ADMIN_REQUIRED" })
    expect(handler).not.toHaveBeenCalled()
    expect(withRlsSessionAuth).toHaveBeenCalledTimes(1)
    expect(withRlsAuth).not.toHaveBeenCalled()

    sessionRole.value = "admin"
    const adminResponse = await withWorkforceSessionAdminAuth(handler)(request())

    expect(adminResponse.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
describe("withWorkforceSessionGrantManagementAuth", () => {
  function entitled(features: string[]) {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features,
      modules: { "workforce-hrm": true, mtm: false },
    } as never)
  }

  it("refuses legacy CRM-admin fallback until a granular tenant-admin bootstrap exists", async () => {
    entitled(["workforce-hrm"])
    sessionRole.value = "admin"
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceSessionGrantManagementAuth(handler)(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_GRANT_MANAGEMENT_BOOTSTRAP_REQUIRED" })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(handler).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
  })

  it("requires an effective organization-scoped tenant-admin grant after granular cutover", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{
      id: "grant_tenant_admin_1",
      organizationId: "org-1",
      principalUserId: "user-1",
      role: "TENANT_ADMIN",
      scopeKind: "ORGANIZATION",
      scopeTeamId: null,
      scopeSiteId: null,
      scopeAgentId: null,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveUntil: null,
      revocation: null,
    }] as never)
    sessionRole.value = "sales"
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceSessionGrantManagementAuth(handler)(request())

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("fails closed without leaking lookup failures", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    vi.mocked(prisma.workforceAccessGrant.findMany).mockRejectedValue(new Error("sensitive database detail"))
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceSessionGrantManagementAuth(handler)(request())

    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE" })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe("withWorkforceSessionExceptionQueueAuth", () => {
  function entitled(features: string[]) {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features,
      modules: { "workforce-hrm": true, mtm: false },
    } as never)
  }

  it("keeps the legacy tenant-admin boundary until the explicit granular cutover", async () => {
    entitled(["workforce-hrm"])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    sessionRole.value = "admin"
    expect((await withWorkforceSessionExceptionQueueAuth(handler)(request())).status).toBe(200)

    sessionRole.value = "manager"
    const denied = await withWorkforceSessionExceptionQueueAuth(handler)(request())
    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({ code: "WORKFORCE_POLICY_ADMIN_REQUIRED" })
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
  })

  it("accepts only an organization-scoped HR exception-read grant after cutover", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{
      id: "grant_exception_queue_1",
      organizationId: "org-1",
      principalUserId: "user-1",
      role: "HR_ADMIN",
      scopeKind: "ORGANIZATION",
      scopeTeamId: null,
      scopeSiteId: null,
      scopeAgentId: null,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveUntil: null,
      revocation: null,
    }] as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    sessionRole.value = "sales"
    const response = await withWorkforceSessionExceptionQueueAuth(handler)(request())

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(prisma.workforceAccessGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", principalUserId: "user-1" }),
      take: 201,
    }))
  })

  it("defers granular per-case authorization to the queue handler", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    sessionRole.value = "support"
    const response = await withWorkforceSessionExceptionQueueAuth(handler, "PER_CASE")(request())

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
  })

  it("does not fall back to a CRM administrator when a rolled-out tenant has no effective grant", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    sessionRole.value = "admin"
    const response = await withWorkforceSessionExceptionQueueAuth(handler)(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_GRANULAR_ACCESS_REQUIRED" })
    expect(handler).not.toHaveBeenCalled()
  })

  it("fails closed when queue authorization cannot be resolved", async () => {
    vi.mocked(prisma.organization.findUnique).mockRejectedValue(new Error("database unavailable"))
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceSessionExceptionQueueAuth(handler)(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE" })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe("withWorkforceSessionExceptionDecisionAuth", () => {
  function entitled(features: string[]) {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features,
      modules: { "workforce-hrm": true, mtm: false },
    } as never)
  }

  it("defers exact decision authority to persisted per-case grants instead of a CRM role", async () => {
    entitled(["workforce-hrm", "workforce-granular-access-v1"])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    sessionRole.value = "support"
    const response = await withWorkforceSessionExceptionDecisionAuth(handler)(request())

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
  })

  it("keeps the decision endpoint unavailable after granular-access rollback", async () => {
    entitled(["workforce-hrm"])
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    sessionRole.value = "admin"
    const response = await withWorkforceSessionExceptionDecisionAuth(handler)(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_GRANULAR_ACCESS_REQUIRED" })
    expect(handler).not.toHaveBeenCalled()
  })
})
