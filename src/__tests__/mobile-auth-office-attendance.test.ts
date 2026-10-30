import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
vi.hoisted(() => { process.env.NEXTAUTH_SECRET = "fictional-office-attendance-test-secret" })
vi.mock("@/lib/prisma", () => ({ prisma: { mtmAgent: { findFirst: vi.fn() }, mtmSetting: { findUnique: vi.fn() }, user: { findFirst: vi.fn() } } }))
vi.mock("jsonwebtoken", () => ({ default: { verify: vi.fn() } }))
vi.mock("@/lib/identity/legacy-credential-boundary", () => ({ readLegacyCredentialBoundary: vi.fn().mockResolvedValue("LEGACY"), readLegacyPhoneCredentialBoundary: vi.fn().mockResolvedValue("LEGACY") }))
import jwt from "jsonwebtoken"
import { prisma } from "@/lib/prisma"
import { JWT_SECRET, resolveMobileAuth } from "@/lib/mobile-auth"
import { readLegacyCredentialBoundary } from "@/lib/identity/legacy-credential-boundary"
import { createSessionFingerprint } from "@/lib/session-invalidation"
const agentId = "office-fixture-agent", userId = "office-fixture-user", organizationId = "office-fixture-org"
const user = { isActive: true, passwordHash: "fixture-user-hash", passwordChangedAt: null }
const agent = { role: "EMPLOYEE", status: "ACTIVE", userId, passwordHash: null, organization: { isActive: true, plan: "enterprise", addons: [], features: [], modules: { "route-field": true, personnel: true } } }
const request = (path: string, method = "GET") => new NextRequest(`http://localhost${path}`, { method, headers: { authorization: "Bearer fixture-token" } })
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readLegacyCredentialBoundary).mockResolvedValue("LEGACY")
  vi.mocked(jwt.verify).mockReturnValue({ agentId, userId, orgId: organizationId, role: "ADMIN",
    agentSessionFingerprint: createSessionFingerprint({ principalId: agentId, passwordHash: agent.passwordHash, secret: JWT_SECRET }),
    userSessionFingerprint: createSessionFingerprint({ principalId: userId, passwordHash: user.passwordHash, passwordChangedAt: null, secret: JWT_SECRET }) } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(agent as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: true } as never)
  vi.mocked(prisma.user.findFirst).mockResolvedValue(user as never)
})
describe("office attendance fresh mobile access", () => {
  it.each(["MIGRATED", "UNAVAILABLE"] as const)("does not let an old office JWT bypass %s identity authority", async status => {
    vi.mocked(readLegacyCredentialBoundary).mockResolvedValue(status)
    expect(await resolveMobileAuth(request("/api/v1/mtm/mobile/bootstrap"))).toBeNull()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
  })
  it("allows enrollment through the linked credentials while ignoring an old elevated token role", async () => {
    expect((await resolveMobileAuth(request("/api/v1/mtm/mobile/bootstrap")))?.role).toBe("EMPLOYEE")
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ attendanceParticipant: true }) }))
  })
  it.each(["/api/v1/mtm/mobile/sync/pull", "/api/v1/mtm/visits", "/api/v1/mtm/mobile/route-field/contacts", "/api/v2/mtm/mobile/route-field/attendance/requests/foreign"])("denies unknown or field path %s", async path => {
    expect(await resolveMobileAuth(request(path))).toBeNull()
  })
  it("checks the exact HTTP method as well as the path", async () => {
    expect(await resolveMobileAuth(request("/api/v2/mtm/mobile/route-field/attendance/requests", "PATCH"))).toBeNull()
    expect(await resolveMobileAuth(request("/api/v1/mtm/mobile/sync/push", "POST"))).not.toBeNull()
    expect(await resolveMobileAuth(request("/api/v2/mtm/mobile/route-field/workday-return", "POST"))).not.toBeNull()
    expect(await resolveMobileAuth(request("/api/v2/mtm/mobile/route-field/workday-return", "GET"))).toBeNull()
    expect(await resolveMobileAuth(request("/api/v2/mtm/mobile/route-field/device-tokens", "POST"))).not.toBeNull()
    expect(await resolveMobileAuth(request("/api/v2/mtm/mobile/route-field/device-tokens", "GET"))).toBeNull()
  })
  it.each([
    ["GET", "/requests"], ["POST", "/requests"], ["GET", "/request-limits"], ["POST", "/attachments"],
    ["DELETE", "/requests/00000000-0000-4000-8000-000000000001"],
    ["GET", "/attachments/00000000-0000-4000-8000-000000000001"],
    ["GET", "/location-consent"], ["POST", "/location-consent"], ["GET", "/installation"], ["POST", "/installation"],
    ["GET", "/explanations"], ["POST", "/explanations"], ["GET", "/marks"],
  ])("admits the new own attendance endpoint %s %s with fresh office credentials", async (method, suffix) => {
    expect((await resolveMobileAuth(request(`/api/v2/mtm/mobile/route-field/attendance${suffix}`, method)))?.role).toBe("EMPLOYEE")
    expect(await resolveMobileAuth(request(`/api/v1/mtm/mobile/attendance${suffix}`, method))).toBeNull()
  })
  it.each(["PATCH", "PUT", "DELETE"])("does not admit an unsupported explanations method %s", async method => {
    expect(await resolveMobileAuth(request("/api/v2/mtm/mobile/route-field/attendance/explanations", method))).toBeNull()
  })
  it("does not turn the explanations allowance into a detail or HR decision allowance", async () => {
    for (const path of [
      "/api/v2/mtm/mobile/route-field/attendance/explanations/00000000-0000-4000-8000-000000000001",
      "/api/v1/mtm/attendance/explanations/00000000-0000-4000-8000-000000000001/decision",
    ]) expect(await resolveMobileAuth(request(path, "POST"))).toBeNull()
  })
  it("revokes office access when attendance is disabled", async () => {
    vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: false } as never)
    expect(await resolveMobileAuth(request("/api/v1/mtm/mobile/bootstrap"))).toBeNull()
  })
  it("requires the explicit participant row on each request", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValueOnce(agent as never).mockResolvedValueOnce(null)
    expect(await resolveMobileAuth(request("/api/v1/mtm/mobile/bootstrap"))).toBeNull()
  })
  it("also revokes the linked CRM user's session", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ ...user, isActive: false } as never)
    expect(await resolveMobileAuth(request("/api/v1/mtm/mobile/bootstrap"))).toBeNull()
  })
})

// Personnel is sold apart from routes (owner, 2026-10-14): such a tenant's
// office staff use the phone for their own attendance, and nothing else.
describe("Personnel without Route & Field", () => {
  const personnelOnly = (role: string) => ({ ...agent, role, organization: { ...agent.organization, modules: { personnel: true } } })
  it.each(["EMPLOYEE", "MANAGER", "SUPERVISOR", "ADMIN"])("admits %s to the office attendance endpoints with a Personnel-only snapshot", async role => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(personnelOnly(role) as never)
    const auth = await resolveMobileAuth(request("/api/v1/mtm/mobile/bootstrap"))
    expect(auth?.role).toBe(role)
    expect(auth?.tenantCapabilities).toMatchObject({ routeField: false, workforceHrm: false, personnel: true })
    expect(await resolveMobileAuth(request("/api/v2/mtm/mobile/route-field/attendance/requests", "POST"))).not.toBeNull()
    for (const method of ["GET", "POST"]) {
      expect((await resolveMobileAuth(request("/api/v2/mtm/mobile/route-field/attendance/explanations", method)))?.role).toBe(role)
    }
  })
  it.each(["MANAGER", "ADMIN"])("keeps %s out of field and manager endpoints", async role => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(personnelOnly(role) as never)
    for (const path of ["/api/v1/mtm/mobile/manager/team", "/api/v1/mtm/mobile/sync/pull", "/api/v1/mtm/visits"]) expect(await resolveMobileAuth(request(path))).toBeNull()
  })
  it("refuses a field agent: its day is routes, which the tenant does not have", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(personnelOnly("AGENT") as never)
    expect(await resolveMobileAuth(request("/api/v1/mtm/mobile/bootstrap"))).toBeNull()
  })
  it("refuses an office employee of a tenant with routes but without Personnel", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ ...agent, organization: { ...agent.organization, modules: { "route-field": true, personnel: false } } } as never)
    expect(await resolveMobileAuth(request("/api/v1/mtm/mobile/bootstrap"))).toBeNull()
  })
})
