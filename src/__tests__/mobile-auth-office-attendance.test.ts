import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
vi.hoisted(() => { process.env.NEXTAUTH_SECRET = "fictional-office-attendance-test-secret" })
vi.mock("@/lib/prisma", () => ({ prisma: { mtmAgent: { findFirst: vi.fn() }, mtmSetting: { findUnique: vi.fn() }, user: { findFirst: vi.fn() } } }))
vi.mock("jsonwebtoken", () => ({ default: { verify: vi.fn() } }))
import jwt from "jsonwebtoken"
import { prisma } from "@/lib/prisma"
import { JWT_SECRET, resolveMobileAuth } from "@/lib/mobile-auth"
import { createSessionFingerprint } from "@/lib/session-invalidation"
const agentId = "office-fixture-agent", userId = "office-fixture-user", organizationId = "office-fixture-org"
const user = { isActive: true, passwordHash: "fixture-user-hash", passwordChangedAt: null }
const agent = { role: "EMPLOYEE", status: "ACTIVE", userId, passwordHash: null, organization: { isActive: true, plan: "enterprise", addons: [], features: [], modules: { "route-field": true } } }
const request = (path: string, method = "GET") => new NextRequest(`http://localhost${path}`, { method, headers: { authorization: "Bearer fixture-token" } })
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(jwt.verify).mockReturnValue({ agentId, userId, orgId: organizationId, role: "ADMIN",
    agentSessionFingerprint: createSessionFingerprint({ principalId: agentId, passwordHash: agent.passwordHash, secret: JWT_SECRET }),
    userSessionFingerprint: createSessionFingerprint({ principalId: userId, passwordHash: user.passwordHash, passwordChangedAt: null, secret: JWT_SECRET }) } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(agent as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: true } as never)
  vi.mocked(prisma.user.findFirst).mockResolvedValue(user as never)
})
describe("office attendance fresh mobile access", () => {
  it("allows enrollment through the linked credentials while ignoring an old elevated token role", async () => {
    expect((await resolveMobileAuth(request("/api/v1/mtm/mobile/bootstrap")))?.role).toBe("EMPLOYEE")
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ attendanceParticipant: true }) }))
  })
  it.each(["/api/v1/mtm/mobile/sync/pull", "/api/v1/mtm/visits", "/api/v1/mtm/mobile/route-field/contacts", "/api/v1/mtm/mobile/attendance/requests/foreign"])("denies unknown or field path %s", async path => {
    expect(await resolveMobileAuth(request(path))).toBeNull()
  })
  it("checks the exact HTTP method as well as the path", async () => {
    expect(await resolveMobileAuth(request("/api/v1/mtm/mobile/attendance/requests", "PATCH"))).toBeNull()
    expect(await resolveMobileAuth(request("/api/v1/mtm/mobile/sync/push", "POST"))).not.toBeNull()
    expect(await resolveMobileAuth(request("/api/v2/mtm/mobile/route-field/device-tokens", "POST"))).not.toBeNull()
    expect(await resolveMobileAuth(request("/api/v2/mtm/mobile/route-field/device-tokens", "GET"))).toBeNull()
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
