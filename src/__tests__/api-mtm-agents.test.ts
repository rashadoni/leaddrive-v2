import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mtm/route-permissions", () => ({ resolveMtmRouteActor: vi.fn() }))

// Возможность тенанта решается по плану, аддонам и модулям — собирать здесь
// правдоподобную строку организации значило бы тестировать биллинг, а не гейт.
// Подменяем один предикат, остальной модуль настоящий.
vi.mock("@/lib/tenant-capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant-capabilities")>()),
  isTenantCapabilityEnabled: vi.fn(() => true),
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-pw"), compare: vi.fn() },
}))

import { GET as ListAgents, POST as CreateAgent } from "@/app/api/v1/mtm/agents/route"
import { GET as GetAgent, PUT as UpdateAgent, DELETE as DeleteAgent } from "@/app/api/v1/mtm/agents/[id]/route"
import { GET as GetDashboard } from "@/app/api/v1/mtm/dashboard/route"
import { GET as GetAnalytics } from "@/app/api/v1/mtm/analytics/route"
import { GET as GetLeaderboard } from "@/app/api/v1/mtm/leaderboard/route"
import { prisma } from "@/lib/prisma"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"
import { getOrgId, getSession, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"

const ORG = "org-1"

function makeReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

function makeJsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Route tests reuse user ids with different cards; never serve a memoized actor.
  resetMtmFieldScopeMemo()
  vi.mocked(getSession).mockResolvedValue(null)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(isTenantCapabilityEnabled).mockReturnValue(true)
})

function mockAgentAdministrator() {
  vi.mocked(getSession).mockResolvedValue({
    orgId: ORG,
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: null,
    role: "ADMIN",
    scopedAgentIds: null,
  })
}

function mockAgentWorkforceRetentionClear() {
  for (const model of [
    prisma.mtmAgentWorkday,
    prisma.mtmAgentWorkdayEvent,
    prisma.mtmAgentLocation,
    prisma.mtmHrmRequest,
    prisma.mtmWorkCalendarDay,
    prisma.mtmAuditLog,
    prisma.workforceShiftAssignment,
    prisma.workforcePolicySnapshot,
    prisma.workforceShiftSnapshot,
    prisma.workforceAttendanceException,
    prisma.workforceTimeCorrection,
    prisma.workforceTimesheetApproval,
  ]) vi.mocked(model.count).mockResolvedValue(0)
}

// ─── GET /api/v1/mtm/agents ────────────────────────────────
describe("GET /api/v1/mtm/agents", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await ListAgents(makeReq("/api/v1/mtm/agents"))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("Unauthorized")
  })

  it("returns paginated agents", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "a1", name: "Agent 1" }] as any)
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(1)

    const res = await ListAgents(makeReq("/api/v1/mtm/agents"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.agents).toHaveLength(1)
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(50)
  })

  it("says an agent is on a break instead of letting them fade to grey", async () => {
    // A break stops GPS by design (A7), so `lastSeenAt` goes stale on someone
    // who is simply at lunch — indistinguishable from a dead phone until the
    // workday's own state reaches the list.
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "a1", name: "Agent 1" }] as any)
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([
      { agentId: "a1", status: "PAUSED", startedAt: new Date("2026-09-09T05:00:00Z"), pausedAt: new Date("2026-09-09T10:05:00Z"), completedAt: null },
    ] as any)

    const res = await ListAgents(makeReq("/api/v1/mtm/agents"))
    expect(res.status).toBe(200)
    const json = await res.json()
    // Состояние — да, момент — нет: у этого вызова нет браузерной сессии, то
    // есть это мобильный токен или ключ интеграции. Права на «Персонал» у них
    // нет, а «на перерыве» без времени по-прежнему спасает от серой точки.
    expect(json.data.agents[0].presence).toEqual({ kind: "paused", since: null })
    expect(json.data.agents[0].breaks).toEqual([])
  })

  it("отдаёт моменты перерыва тому, у кого есть право на «Персонал»", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    mockAgentAdministrator()
    // Общая фабрика мока отвечает только на свою пятиполевую выборку; гейт
    // «Персонала» берёт четыре поля, поэтому строку подкладываем явно.
    // Именно Once: mockResolvedValue переживает clearAllMocks и подменил бы
    // общую фабрику до конца файла — dashboard, analytics и leaderboard тогда
    // получают чужую строку организации и падают с 403.
    vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
      plan: "enterprise", addons: [], features: ["workforce-hrm"], modules: { "workforce-hrm": true },
    } as any)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "a1", name: "Agent 1" }] as any)
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([
      { agentId: "a1", status: "PAUSED", startedAt: new Date("2026-09-09T05:00:00Z"), pausedAt: new Date("2026-09-09T10:05:00Z"), completedAt: null },
    ] as any)

    const res = await ListAgents(makeReq("/api/v1/mtm/agents"))
    const json = await res.json()
    expect(json.data.agents[0].presence).toEqual({ kind: "paused", since: "2026-09-09T10:05:00.000Z" })
  })

  it("не отдаёт моменты, когда платный модуль выключен", async () => {
    // Остальные экраны рабочий день при выключенном workforce-hrm прячут.
    // Этот отдавал его мимо проверки.
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    mockAgentAdministrator()
    vi.mocked(isTenantCapabilityEnabled).mockReturnValue(false)
    // Общая фабрика мока отвечает только на свою пятиполевую выборку; гейт
    // «Персонала» берёт четыре поля, поэтому строку подкладываем явно.
    // Именно Once: mockResolvedValue переживает clearAllMocks и подменил бы
    // общую фабрику до конца файла — dashboard, analytics и leaderboard тогда
    // получают чужую строку организации и падают с 403.
    vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
      plan: "enterprise", addons: [], features: ["workforce-hrm"], modules: { "workforce-hrm": true },
    } as any)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "a1", name: "Agent 1" }] as any)
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([
      { agentId: "a1", status: "COMPLETED", startedAt: new Date("2026-09-09T05:00:00Z"), pausedAt: null, completedAt: new Date("2026-09-09T14:00:00Z") },
    ] as any)

    const res = await ListAgents(makeReq("/api/v1/mtm/agents"))
    const json = await res.json()
    expect(json.data.agents[0].presence).toEqual({ kind: "finished", at: null })
    expect(json.data.agents[0].breaks).toEqual([])
  })

  it("puts plan fulfilment and app activity on the card without leaking the push token", async () => {
    // Prod 2026-09-14: «0% eff.» and amber «Aktiv deyil» on every card while the
    // route was done and the phone sent GPS every 30 s — the page read fields
    // this list never returned.
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "a1", name: "Anar", lastSeenAt: null, expoPushToken: null, latestLocation: { receivedAt: new Date(Date.now() - 30_000) } },
      { id: "a2", name: "Bez plana", lastSeenAt: null, expoPushToken: "ExponentPushToken[secret]", latestLocation: null },
    ] as any)
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(2)
    vi.mocked(prisma.mtmVisit.groupBy).mockResolvedValue([{ agentId: "a1", _count: { _all: 2 } }] as any)
    vi.mocked(prisma.mtmRoute.groupBy).mockResolvedValue([{ agentId: "a1", _sum: { totalPoints: 2, visitedPoints: 2 } }] as any)

    const res = await ListAgents(makeReq("/api/v1/mtm/agents"))
    const json = await res.json()
    const [anar, other] = json.data.agents

    expect(anar.activity).toEqual({ periodDays: 7, visits: 2, plannedPoints: 2, visitedPoints: 2, planFulfillment: 100 })
    expect(anar.app).toMatchObject({ state: "active", notificationsConnected: false })
    expect(other.activity.planFulfillment).toBeNull()
    expect(other.app).toMatchObject({ state: "never", notificationsConnected: true })
    expect(JSON.stringify(json)).not.toContain("ExponentPushToken")
    expect(anar).not.toHaveProperty("latestLocation")

    const routeWhere = (vi.mocked(prisma.mtmRoute.groupBy).mock.calls[0][0] as any).where
    expect(routeWhere).toMatchObject({ organizationId: ORG, agentId: { in: ["a1", "a2"] }, deletedAt: null, totalPoints: { gt: 0 } })
  })

  it("still lists people when the activity figures cannot be computed", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "a1", name: "Agent 1" }] as any)
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmRoute.groupBy).mockRejectedValueOnce(new Error("db down"))
    const res = await ListAgents(makeReq("/api/v1/mtm/agents"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.agents[0].activity).toBeNull()
    expect(json.data.agents[0].app.state).toBe("never")
  })

  it("still lists people when presence cannot be resolved", async () => {
    // The list is the point of this endpoint; presence is an enrichment. A
    // failing workday query must cost one label, not the whole screen.
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "a1", name: "Agent 1" }] as any)
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockRejectedValue(new Error("workday unavailable"))

    const res = await ListAgents(makeReq("/api/v1/mtm/agents"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.agents).toHaveLength(1)
    expect(json.data.agents[0].presence).toEqual({ kind: "not-started" })
  })

  it("filters by status and role", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(0)

    await ListAgents(makeReq("/api/v1/mtm/agents?status=ACTIVE&role=MANAGER"))

    const callArgs = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any
    expect(callArgs.where.status).toBe("ACTIVE")
    expect(callArgs.where.role).toBe("MANAGER")
  })

  it("returns 500 on prisma error (was silent-success — fixed by F-05)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findMany).mockRejectedValue(new Error("DB error"))
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await ListAgents(makeReq("/api/v1/mtm/agents"))
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toBeDefined()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

// ─── POST /api/v1/mtm/agents ───────────────────────────────
describe("POST /api/v1/mtm/agents", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await CreateAgent(makeJsonReq("/api/v1/mtm/agents", "POST", { name: "A" }))
    expect(res.status).toBe(401)
  })

  it("creates agent with hashed password and returns 201", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.create).mockResolvedValue({ id: "new-agent", name: "John" } as any)

    const body = { name: "John", email: "john@test.com", password: "AgentSecret123!", role: "MANAGER" }
    const res = await CreateAgent(makeJsonReq("/api/v1/mtm/agents", "POST", body))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)

    const createArgs = vi.mocked(prisma.mtmAgent.create).mock.calls[0][0] as any
    expect(createArgs.data.organizationId).toBe(ORG)
    expect(createArgs.data.name).toBe("John")
    expect(createArgs.data.passwordHash).toBe("hashed-pw")
    expect(createArgs.data.role).toBe("MANAGER")
    expect(createArgs.data.canSelfPublishRoutes).toBe(false)
    expect(createArgs.select.passwordHash).toBeUndefined()
    expect(createArgs.select.expoPushToken).toBeUndefined()
  })

  it("persists an administrator's per-agent route planning and publishing choices", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.create).mockResolvedValue({ id: "new-agent", name: "John" } as any)

    const res = await CreateAgent(makeJsonReq("/api/v1/mtm/agents", "POST", {
      name: "John",
      password: "AgentSecret123!",
      canPlanOwnRoutes: false,
      canSelfPublishRoutes: true,
    }))

    expect(res.status).toBe(201)
    const createArgs = vi.mocked(prisma.mtmAgent.create).mock.calls[0][0] as any
    expect(createArgs.data.canPlanOwnRoutes).toBe(false)
    expect(createArgs.select.canPlanOwnRoutes).toBe(true)
    expect(createArgs.data.canSelfPublishRoutes).toBe(true)
    expect(createArgs.select.canSelfPublishRoutes).toBe(true)
  })

  it("rejects a weak mobile-agent password before hashing", async () => {
    mockAgentAdministrator()

    const res = await CreateAgent(makeJsonReq("/api/v1/mtm/agents", "POST", {
      name: "Weak Agent",
      password: "12345678",
    }))

    expect(res.status).toBe(400)
    expect(prisma.mtmAgent.create).not.toHaveBeenCalled()
  })

  it("rejects a linked CRM user outside the authenticated organization", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

    const res = await CreateAgent(makeJsonReq("/api/v1/mtm/agents", "POST", {
      name: "Foreign link",
      userId: "cm1234567890123456789012",
    }))

    expect(res.status).toBe(400)
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "cm1234567890123456789012", organizationId: ORG, isActive: true },
      select: { id: true },
    })
    expect(prisma.mtmAgent.create).not.toHaveBeenCalled()
  })

  it("returns 400 on create failure", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.create).mockRejectedValue(new Error("Duplicate email"))

    const res = await CreateAgent(makeJsonReq("/api/v1/mtm/agents", "POST", { name: "X" }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("Duplicate email")
  })

  it("rejects a mobile or API-key principal without a browser administrator session", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)

    const res = await CreateAgent(makeJsonReq("/api/v1/mtm/agents", "POST", {
      name: "Escalated",
      role: "ADMIN",
      password: "AgentSecret123!",
    }))

    expect(res.status).toBe(403)
    expect(prisma.mtmAgent.create).not.toHaveBeenCalled()
  })
})

// ─── GET /api/v1/mtm/agents/[id] ───────────────────────────
describe("GET /api/v1/mtm/agents/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GetAgent(makeReq("/api/v1/mtm/agents/a1"), makeParams("a1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when agent not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)

    const res = await GetAgent(makeReq("/api/v1/mtm/agents/a1"), makeParams("a1"))
    expect(res.status).toBe(404)
  })

  it("returns agent data", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "a1", name: "John" } as any)

    const res = await GetAgent(makeReq("/api/v1/mtm/agents/a1"), makeParams("a1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("John")

    const callArgs = vi.mocked(prisma.mtmAgent.findFirst).mock.calls[0][0] as any
    expect(callArgs.select.passwordHash).toBeUndefined()
    expect(callArgs.select.expoPushToken).toBeUndefined()
  })
})

// ─── PUT /api/v1/mtm/agents/[id] ───────────────────────────
describe("PUT /api/v1/mtm/agents/[id]", () => {
  it("returns 404 when agent not found", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 0 })

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/a1", "PUT", { name: "Updated" }),
      makeParams("a1")
    )
    expect(res.status).toBe(404)
  })

  it("updates agent successfully", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 })

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/a1", "PUT", { name: "Updated", status: "INACTIVE" }),
      makeParams("a1")
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("updates the individual self-publish permission without changing other access", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      name: "Agent",
      email: "agent@test.com",
      role: "AGENT",
      status: "ACTIVE",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: false,
      managerId: null,
    } as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 })

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/a1", "PUT", { canSelfPublishRoutes: true }),
      makeParams("a1"),
    )

    expect(res.status).toBe(200)
    const updateArgs = vi.mocked(prisma.mtmAgent.updateMany).mock.calls[0][0] as any
    expect(updateArgs.data.canSelfPublishRoutes).toBe(true)
  })

  it("rejects a weak replacement password before updating", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      name: "Agent",
      email: "agent@test.com",
      role: "AGENT",
      status: "ACTIVE",
      managerId: null,
    } as any)

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/a1", "PUT", { password: "abcdefgh" }),
      makeParams("a1"),
    )

    expect(res.status).toBe(400)
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })

  it("does not update an agent to a foreign CRM user", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "a1", role: "AGENT", managerId: null, userId: null } as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/a1", "PUT", { userId: "cm1234567890123456789012" }),
      makeParams("a1"),
    )

    expect(res.status).toBe(400)
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })

  it("does not let a mobile principal promote itself", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/a1", "PUT", { role: "ADMIN" }),
      makeParams("a1"),
    )

    expect(res.status).toBe(403)
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })
})

// ─── DELETE /api/v1/mtm/agents/[id] ────────────────────────
describe("DELETE /api/v1/mtm/agents/[id]", () => {
  it("returns 404 when agent not found", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)

    const res = await DeleteAgent(makeReq("/api/v1/mtm/agents/a1"), makeParams("a1"))
    expect(res.status).toBe(404)
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
  })

  it("blocks permanent deletion when the employee has Workforce time history", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      name: "Agent One",
      email: "agent@example.com",
      role: "AGENT",
    } as never)
    vi.mocked(prisma.mtmAgentWorkday.count).mockResolvedValue(1)

    const res = await DeleteAgent(makeReq("/api/v1/mtm/agents/a1"), makeParams("a1"))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: "WORKFORCE_RETENTION_BLOCKED" })
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
  })

  it("blocks permanent deletion when the employee has an HRM decision but no workday", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      name: "Agent One",
      email: "agent@example.com",
      role: "AGENT",
    } as never)
    vi.mocked(prisma.mtmHrmRequest.count).mockResolvedValue(1)

    const res = await DeleteAgent(makeReq("/api/v1/mtm/agents/a1"), makeParams("a1"))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: "WORKFORCE_RETENTION_BLOCKED" })
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
  })

  it("blocks permanent deletion when only a Workforce transition audit remains", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      name: "Agent One",
      email: "agent@example.com",
      role: "AGENT",
    } as never)
    vi.mocked(prisma.mtmAuditLog.count).mockResolvedValue(1)

    const res = await DeleteAgent(makeReq("/api/v1/mtm/agents/a1"), makeParams("a1"))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: "WORKFORCE_RETENTION_BLOCKED" })
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes agent successfully", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      name: "Agent One",
      email: "agent@example.com",
      role: "AGENT",
    } as never)
    mockAgentWorkforceRetentionClear()
    vi.mocked(prisma.mtmAgent.deleteMany).mockResolvedValue({ count: 1 })

    const res = await DeleteAgent(makeReq("/api/v1/mtm/agents/a1"), makeParams("a1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

// ─── Web field scope for employee cards (audit 2026-09-14) ──
describe("employee cards follow the web user's field scope", () => {
  const SCOPE = ["mgr-1", "agent-1", "sup-1"]

  function mockWebManager(actor: unknown = { agentId: "mgr-1", role: "MANAGER", scopedAgentIds: SCOPE }) {
    vi.mocked(getSession).mockResolvedValue({
      orgId: ORG,
      userId: "manager-user",
      role: "manager",
      email: "manager@example.com",
      name: "Manager",
    } as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(actor as never)
  }

  function card(overrides: Record<string, unknown> = {}) {
    return {
      id: "agent-1",
      name: "Agent",
      email: "agent@example.com",
      role: "AGENT",
      status: "ACTIVE",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: false,
      managerId: "mgr-1",
      userId: null,
      ...overrides,
    }
  }

  it("lists only the manager's agents instead of every employee", async () => {
    mockWebManager()
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)

    const res = await ListAgents(makeReq("/api/v1/mtm/agents?limit=200"))

    expect(res.status).toBe(200)
    const where = (vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any).where
    expect(where).toMatchObject({ organizationId: ORG, id: { in: SCOPE } })
    expect((vi.mocked(prisma.mtmAgent.count).mock.calls[0][0] as any).where.id).toEqual({ in: SCOPE })
  })

  it("keeps the list organization-wide for a web administrator", async () => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)

    await ListAgents(makeReq("/api/v1/mtm/agents"))

    expect((vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any).where.id).toBeUndefined()
  })

  it("refuses a web manager without an MTM card on list, detail and edit", async () => {
    mockWebManager(null)

    const list = await ListAgents(makeReq("/api/v1/mtm/agents"))
    expect(list.status).toBe(403)
    expect(await list.json()).toMatchObject({ code: "MTM_FIELD_SCOPE_REQUIRED" })
    const detail = await GetAgent(makeReq("/api/v1/mtm/agents/agent-1"), makeParams("agent-1"))
    expect(detail.status).toBe(403)
    const edit = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { name: "X" }), makeParams("agent-1"))
    expect(edit.status).toBe(403)
    expect(await edit.json()).toMatchObject({ code: "MTM_FIELD_SCOPE_REQUIRED" })
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })

  it("opens a card only inside the scope", async () => {
    mockWebManager()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null as never)

    const res = await GetAgent(makeReq("/api/v1/mtm/agents/agent-other"), makeParams("agent-other"))

    expect(res.status).toBe(404)
    const where = (vi.mocked(prisma.mtmAgent.findFirst).mock.calls[0][0] as any).where
    expect(where.id).toEqual({ equals: "agent-other", in: SCOPE })
  })

  it("does not let a manager edit or reset the password of an agent outside their scope", async () => {
    mockWebManager()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null as never)

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/agent-other", "PUT", { password: "Str0ng-Passw0rd!" }),
      makeParams("agent-other"),
    )

    expect(res.status).toBe(404)
    expect((vi.mocked(prisma.mtmAgent.findFirst).mock.calls[0][0] as any).where.id).toEqual({ equals: "agent-other", in: SCOPE })
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })

  it("lets a manager edit their own agent, still fenced to the scope at write time", async () => {
    mockWebManager()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(card() as never)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 })

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { name: "Renamed", role: "AGENT", managerId: "mgr-1" }),
      makeParams("agent-1"),
    )

    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.mtmAgent.updateMany).mock.calls[0][0] as any).where.id).toEqual({ equals: "agent-1", in: SCOPE })
  })

  it("keeps manager and administrator cards, and those roles, for administrators", async () => {
    mockWebManager()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(card({ id: "mgr-1", role: "MANAGER" }) as never)
    const ownCard = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/mgr-1", "PUT", { role: "ADMIN" }), makeParams("mgr-1"))
    expect(ownCard.status).toBe(403)
    expect(await ownCard.json()).toMatchObject({ code: "MTM_AGENT_ROLE_ADMIN_REQUIRED" })

    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(card() as never)
    const promote = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { role: "MANAGER" }), makeParams("agent-1"))
    expect(promote.status).toBe(403)

    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "cm1234567890123456789012" } as never)
    const link = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { userId: "cm1234567890123456789012" }),
      makeParams("agent-1"),
    )
    expect(link.status).toBe(403)
    expect(await link.json()).toMatchObject({ code: "MTM_AGENT_LINK_ADMIN_REQUIRED" })
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })

  it("refuses to move an agent under a manager outside the scope", async () => {
    mockWebManager()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(card() as never)

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { managerId: "cm9999999999999999999999" }),
      makeParams("agent-1"),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_AGENT_OUT_OF_SCOPE" })
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })

  it("deletes only an in-scope field card", async () => {
    mockWebManager()
    mockAgentWorkforceRetentionClear()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null as never)
    const outside = await DeleteAgent(makeReq("/api/v1/mtm/agents/agent-other"), makeParams("agent-other"))
    expect(outside.status).toBe(404)
    expect((vi.mocked(prisma.mtmAgent.findFirst).mock.calls[0][0] as any).where.id).toEqual({ equals: "agent-other", in: SCOPE })

    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(card({ id: "sup-1", role: "MANAGER" }) as never)
    const peer = await DeleteAgent(makeReq("/api/v1/mtm/agents/sup-1"), makeParams("sup-1"))
    expect(peer.status).toBe(403)
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
  })

  it("creates a field agent under the manager by default and refuses a manager role", async () => {
    mockWebManager()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "mgr-1" } as never) // default manager exists
    vi.mocked(prisma.mtmAgent.create).mockResolvedValue({ id: "new", name: "New" } as never)

    const created = await CreateAgent(makeJsonReq("/api/v1/mtm/agents", "POST", { name: "New" }))
    expect(created.status).toBe(201)
    expect((vi.mocked(prisma.mtmAgent.create).mock.calls[0][0] as any).data).toMatchObject({ role: "AGENT", managerId: "mgr-1" })

    const manager = await CreateAgent(makeJsonReq("/api/v1/mtm/agents", "POST", { name: "Boss", role: "MANAGER" }))
    expect(manager.status).toBe(403)
    expect(prisma.mtmAgent.create).toHaveBeenCalledTimes(1)
  })

  // ─── Review of #204: no second team through the reporting line ──────────
  // mgr-1 sits in team-A (no region), so their territory is [team-A]. A direct
  // report in team-B is in their scope, but team-B is not their territory.
  function territoryOfTeamA() {
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue({ id: "mgr-1", teamId: "team-A" } as never)
    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue({ id: "team-A", regionId: null } as never)
  }

  it("refuses to make a report from another team a supervisor — it would hand over that team", async () => {
    mockWebManager()
    territoryOfTeamA()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(card({ teamId: "team-B" }) as never)

    const res = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { role: "SUPERVISOR" }), makeParams("agent-1"))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_AGENT_TERRITORY_REQUIRED" })
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })

  it("refuses a password reset for a report whose team is outside the territory", async () => {
    mockWebManager()
    territoryOfTeamA()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(card({ teamId: "team-B" }) as never)

    const res = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { password: "Str0ng-Passw0rd!" }), makeParams("agent-1"))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_AGENT_TERRITORY_REQUIRED" })
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })

  it("refuses a password reset for a card without a team", async () => {
    mockWebManager()
    territoryOfTeamA()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(card({ teamId: null }) as never)

    const res = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { password: "Str0ng-Passw0rd!" }), makeParams("agent-1"))

    expect(res.status).toBe(403)
  })

  it("allows supervisor assignment and password reset inside the manager's own team", async () => {
    mockWebManager()
    territoryOfTeamA()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(card({ teamId: "team-A" }) as never)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 })

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { role: "SUPERVISOR", password: "Str0ng-Passw0rd!" }),
      makeParams("agent-1"),
    )

    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.mtmAgent.updateMany).mock.calls[0][0] as any).data).toMatchObject({ role: "SUPERVISOR", passwordHash: "hashed-pw" })
  })

  it("keeps editing other fields of an out-of-territory report possible", async () => {
    mockWebManager()
    territoryOfTeamA()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(card({ teamId: "team-B" }) as never)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 })

    const res = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { name: "Renamed", role: "AGENT" }), makeParams("agent-1"))

    expect(res.status).toBe(200)
  })

  it("refuses to create a supervisor card as a scoped manager", async () => {
    mockWebManager()
    const res = await CreateAgent(makeJsonReq("/api/v1/mtm/agents", "POST", { name: "Lead", role: "SUPERVISOR" }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_AGENT_TERRITORY_REQUIRED" })
    expect(prisma.mtmAgent.create).not.toHaveBeenCalled()
  })

  it("answers an out-of-scope probe with 404 before checking whether the linked user or manager exists", async () => {
    mockWebManager()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null as never)

    const res = await UpdateAgent(
      makeJsonReq("/api/v1/mtm/agents/agent-other", "PUT", { userId: "user-somewhere", managerId: "someone" }),
      makeParams("agent-other"),
    )

    expect(res.status).toBe(404)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledTimes(1)
  })

  it("does not let a supervisor or a field agent behind a web manager login manage cards", async () => {
    mockWebManager({ agentId: "sup-1", role: "SUPERVISOR", scopedAgentIds: ["sup-1", "agent-1"] })
    const res = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/agent-1", "PUT", { name: "X" }), makeParams("agent-1"))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_AGENT_ADMIN_REQUIRED" })
  })
})

// ─── Reporting-line cycles (review of #204) ────────────────
describe("PUT /api/v1/mtm/agents/[id] — managerId cycles", () => {
  const cards: Record<string, { id: string; role: string; managerId: string | null; userId: null; teamId: null }> = {
    boss: { id: "boss", role: "MANAGER", managerId: null, userId: null, teamId: null },
    lead: { id: "lead", role: "SUPERVISOR", managerId: "boss", userId: null, teamId: null },
    rep: { id: "rep", role: "AGENT", managerId: "lead", userId: null, teamId: null },
  }

  beforeEach(() => {
    mockAgentAdministrator()
    vi.mocked(prisma.mtmAgent.findFirst).mockImplementation((async ({ where }: any) => {
      const id = typeof where.id === "string" ? where.id : where.id?.equals
      return cards[id] ?? null
    }) as never)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 })
  })

  it("refuses making an employee their own manager", async () => {
    const res = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/boss", "PUT", { managerId: "boss" }), makeParams("boss"))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "MTM_AGENT_MANAGER_CYCLE" })
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })

  it("refuses putting a manager under someone who reports to them, at any depth", async () => {
    const direct = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/boss", "PUT", { managerId: "lead" }), makeParams("boss"))
    expect(direct.status).toBe(400)
    const indirect = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/boss", "PUT", { managerId: "rep" }), makeParams("boss"))
    expect(indirect.status).toBe(400)
    expect(await indirect.json()).toMatchObject({ code: "MTM_AGENT_MANAGER_CYCLE" })
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  })

  it("accepts a manager outside the employee's own reporting line", async () => {
    const res = await UpdateAgent(makeJsonReq("/api/v1/mtm/agents/rep", "PUT", { managerId: "boss" }), makeParams("rep"))
    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.mtmAgent.updateMany).mock.calls[0][0] as any).data.managerId).toBe("boss")
  })
})

// ─── GET /api/v1/mtm/dashboard ─────────────────────────────
describe("GET /api/v1/mtm/dashboard", () => {
  const dashboardAuth = {
    orgId: ORG,
    userId: "manager-user",
    role: "manager",
    email: "manager@example.com",
    name: "Manager",
  }

  function mockDashboardActor(scopedAgentIds: string[] | null = null) {
    vi.mocked(requireAuth).mockResolvedValue(dashboardAuth as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: scopedAgentIds === null ? null : "manager-agent",
      role: scopedAgentIds === null ? "ADMIN" : "MANAGER",
      scopedAgentIds,
    })
  }

  it("returns 401 when module authentication fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      Response.json({ error: "Unauthorized" }, { status: 401 }) as never,
    )
    const res = await GetDashboard(makeReq("/api/v1/mtm/dashboard"))
    expect(res.status).toBe(401)
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
  })

  it("preserves the module permission 403 without querying dashboard data", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      Response.json({ error: "Forbidden" }, { status: 403 }) as never,
    )
    const res = await GetDashboard(makeReq("/api/v1/mtm/dashboard"))
    expect(res.status).toBe(403)
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.count).not.toHaveBeenCalled()
  })

  it("returns 403 when the authenticated user has no active MTM actor", async () => {
    vi.mocked(requireAuth).mockResolvedValue(dashboardAuth as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)

    const res = await GetDashboard(makeReq("/api/v1/mtm/dashboard"))
    expect(res.status).toBe(403)
    expect(prisma.mtmVisit.count).not.toHaveBeenCalled()
  })

  it("fails closed when a non-admin actor is ever resolved with the tenant-wide sentinel", async () => {
    vi.mocked(requireAuth).mockResolvedValue(dashboardAuth as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-agent",
      role: "MANAGER",
      scopedAgentIds: null,
    })

    const res = await GetDashboard(makeReq("/api/v1/mtm/dashboard"))
    expect(res.status).toBe(403)
    expect(prisma.mtmVisit.count).not.toHaveBeenCalled()
  })

  it("preserves tenant-admin dashboard stats and marks the response unbounded", async () => {
    mockDashboardActor(null)
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(5)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(3)
    vi.mocked(prisma.mtmAlert.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(10)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.aggregate).mockResolvedValue({ _avg: { duration: 25 } } as any)
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(20)
    vi.mocked(prisma.mtmTask.count).mockResolvedValue(4)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([])

    const res = await GetDashboard(makeReq("/api/v1/mtm/dashboard?period=month"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.scope).toEqual({
      semantics: "current primary-owner agent scope; null scope means tenant administrator",
      bounded: false,
      customerSemantics: "tenant-wide",
      omittedForBoundedScope: [],
    })
    expect(json.data).toHaveProperty("totalAgents")
    expect(json.data).toHaveProperty("todayVisits")
    expect(json.data).toHaveProperty("totalCustomers")
    expect(json.data).toHaveProperty("recentVisits")
    expect(json.data).toHaveProperty("avgVisitDuration")
    expect(json.data.timezone).toBe("Asia/Baku")
    expect(prisma.mtmImportJob.count).toHaveBeenCalledWith({
      where: { organizationId: ORG, status: { in: ["FAILED", "COMPLETED_WITH_ERRORS"] } },
    })
  })

  it("uses tenant-local closed date ranges for dashboard periods", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:30:00.000Z"))
    try {
      mockDashboardActor(["timezone-agent"])
      vi.mocked(prisma.mtmSetting.findMany).mockResolvedValueOnce([
        { key: "timezone", value: "Pacific/Auckland" },
      ] as never)

      const res = await GetDashboard(makeReq("/api/v1/mtm/dashboard?period=today"))

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.data.timezone).toBe("Pacific/Auckland")
      for (const call of vi.mocked(prisma.mtmRoute.count).mock.calls) {
        expect((call[0] as any).where.date).toEqual({
          gte: new Date("2026-08-02T00:00:00.000Z"),
          lt: new Date("2026-08-03T00:00:00.000Z"),
        })
      }
      for (const call of vi.mocked(prisma.mtmVisit.aggregate).mock.calls) {
        expect((call[0] as any).where.checkInAt).toEqual({
          gte: new Date("2026-08-01T12:00:00.000Z"),
          lt: new Date("2026-08-02T12:00:00.000Z"),
        })
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it("scopes every agent-linked aggregate and name lookup for a manager", async () => {
    mockDashboardActor(["agent-in-scope"])
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-in-scope", name: "Scoped Agent" },
      { id: "agent-out-of-scope", name: "Hidden Agent" },
    ] as any)
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmAlert.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      id: "outside-visit",
      agentId: "agent-out-of-scope",
      agent: { name: "Hidden Agent" },
      customer: { name: "Hidden Customer" },
      status: "CHECKED_OUT",
      checkInAt: new Date(),
      checkOutAt: new Date(),
      duration: 10,
    }] as any)
    vi.mocked(prisma.mtmVisit.aggregate).mockResolvedValue({ _avg: { duration: null } } as any)
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmTask.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([{
      agentId: "agent-in-scope",
      speed: 0,
      recordedAt: new Date(),
    }] as any)
    vi.mocked(prisma.mtmRouteChangeRequest.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmCustomerCreateRequest.count).mockResolvedValue(0)

    const res = await GetDashboard(makeReq("/api/v1/mtm/dashboard?period=week"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.scope).toMatchObject({
      bounded: true,
      omittedForBoundedScope: ["failedImports"],
    })
    expect(json.data.failedImports).toBeNull()
    expect(json.data.activeAgentsList).toEqual([
      expect.objectContaining({ id: "agent-in-scope", name: "Scoped Agent" }),
    ])
    expect(json.data).toMatchObject({ recentGpsAgents: 1, gpsFreshnessThresholdSeconds: 300, gpsRosterTruncated: false })
    expect(json.data.recentVisits).toEqual([])
    expect(JSON.stringify(json.data)).not.toContain("Hidden Agent")
    expect(JSON.stringify(json.data)).not.toContain("Hidden Customer")
    expect(prisma.mtmImportJob.count).not.toHaveBeenCalled()

    for (const call of [
      ...vi.mocked(prisma.mtmAgent.count).mock.calls,
      ...vi.mocked(prisma.mtmAgent.findMany).mock.calls,
    ]) {
      expect((call[0] as any).where.id).toEqual({ in: ["agent-in-scope"] })
    }
    const gpsRosterQuery = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any
    expect(gpsRosterQuery.where).toMatchObject({ status: "ACTIVE", id: { in: ["agent-in-scope"] } })
    expect(gpsRosterQuery.where).not.toHaveProperty("isOnline")
    expect(gpsRosterQuery.take).toBe(501)

    for (const call of [
      ...vi.mocked(prisma.mtmRoute.count).mock.calls,
      ...vi.mocked(prisma.mtmAlert.count).mock.calls,
      ...vi.mocked(prisma.mtmVisit.count).mock.calls,
      ...vi.mocked(prisma.mtmVisit.findMany).mock.calls,
      ...vi.mocked(prisma.mtmVisit.aggregate).mock.calls,
      ...vi.mocked(prisma.mtmTask.count).mock.calls,
    ]) {
      expect((call[0] as any).where.agentId).toEqual({ in: ["agent-in-scope"] })
      expect(JSON.stringify((call[0] as any).where)).not.toContain("agent-out-of-scope")
    }

    const customerWhere = (vi.mocked(prisma.mtmCustomer.count).mock.calls[0][0] as any).where
    expect(customerWhere.OR[0].agentAssignments.some.agentId).toEqual({ in: ["agent-in-scope"] })
    expect(customerWhere.OR[1].routePoints.some.route.OR[0].agentId).toEqual({ in: ["agent-in-scope"] })
    expect(customerWhere.OR[1].routePoints.some.route.OR[1].assignments.some.agentId).toEqual({ in: ["agent-in-scope"] })
    expect(JSON.stringify(customerWhere)).not.toContain("agent-out-of-scope")

    expect(prisma.mtmAgentLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG, agentId: { in: ["agent-in-scope"] }, recordedAt: { gte: expect.any(Date) } }),
      }),
    )
    expect(prisma.mtmRouteChangeRequest.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ requestedByAgentId: { in: ["agent-in-scope"] } }),
    })
    expect(prisma.mtmCustomerCreateRequest.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ requestedByAgentId: { in: ["agent-in-scope"] } }),
    })
  })

  it("accepts a revoked-checked mobile JWT and keeps the dashboard self-scoped", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-mobile",
      userId: "",
      role: "AGENT",
      email: "mobile@example.com",
      name: "Mobile Agent",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-mobile",
      role: "AGENT",
      scopedAgentIds: ["agent-mobile"],
    })
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-mobile", name: "Mobile Agent" },
    ] as any)
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmAlert.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.aggregate).mockResolvedValue({ _avg: { duration: null } } as any)
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmTask.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([{
      agentId: "agent-mobile",
      speed: 0,
      recordedAt: new Date(),
    }] as any)
    vi.mocked(prisma.mtmRouteChangeRequest.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmCustomerCreateRequest.count).mockResolvedValue(0)

    const res = await GetDashboard(new NextRequest("http://localhost:3000/api/v1/mtm/dashboard?period=week", {
      headers: { authorization: "Bearer mobile-token" },
    }))
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(requireAuth).not.toHaveBeenCalled()
    expect(resolveMobileAuth).toHaveBeenCalledTimes(1)
    expect(resolveMtmRouteActor).toHaveBeenCalledWith(prisma, {
      organizationId: ORG,
      userId: "",
      webRole: "AGENT",
      agentId: "agent-mobile",
    })
    expect(json.data.scope.bounded).toBe(true)
    expect(json.data.failedImports).toBeNull()
    expect(json.data.activeAgentsList).toEqual([
      expect.objectContaining({ id: "agent-mobile", name: "Mobile Agent" }),
    ])
    for (const call of vi.mocked(prisma.mtmRoute.count).mock.calls) {
      expect((call[0] as any).where.agentId).toEqual({ in: ["agent-mobile"] })
    }
    for (const call of vi.mocked(prisma.mtmVisit.count).mock.calls) {
      expect((call[0] as any).where.agentId).toEqual({ in: ["agent-mobile"] })
    }
  })

  it("isolates cache entries by a sorted hash of the fresh actor scope", async () => {
    vi.mocked(requireAuth).mockResolvedValue(dashboardAuth as never)
    vi.mocked(resolveMtmRouteActor)
      .mockResolvedValueOnce({ agentId: "manager-a", role: "MANAGER", scopedAgentIds: ["scope-2", "scope-1"] })
      .mockResolvedValueOnce({ agentId: "manager-b", role: "MANAGER", scopedAgentIds: ["scope-3"] })
      .mockResolvedValueOnce({ agentId: "manager-a", role: "MANAGER", scopedAgentIds: ["scope-1", "scope-2"] })
    vi.mocked(prisma.mtmAgent.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.aggregate).mockResolvedValue({ _avg: { duration: null } } as any)

    const first = await GetDashboard(makeReq("/api/v1/mtm/dashboard?period=today"))
    const second = await GetDashboard(makeReq("/api/v1/mtm/dashboard?period=today"))
    const reorderedFirst = await GetDashboard(makeReq("/api/v1/mtm/dashboard?period=today"))
    const firstBody = await first.json()
    const secondBody = await second.json()
    const reorderedBody = await reorderedFirst.json()

    expect(firstBody.data.totalAgents).toBe(1)
    expect(secondBody.data.totalAgents).toBe(2)
    expect(reorderedBody.data.totalAgents).toBe(1)
    expect(reorderedBody.cached).toBe(true)
    expect(resolveMtmRouteActor).toHaveBeenCalledTimes(3)
    expect(prisma.mtmAgent.count).toHaveBeenCalledTimes(4)
  })
})

// ─── GET /api/v1/mtm/analytics ─────────────────────────────
describe("GET /api/v1/mtm/analytics", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }) as never)
    const res = await GetAnalytics(makeReq("/api/v1/mtm/analytics"))
    expect(res.status).toBe(401)
  })

  it("returns analytics KPIs and trends", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "u1", role: "manager", email: "m@x", name: "M" } as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager-1", role: "MANAGER", scopedAgentIds: null })
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(50)
    vi.mocked(prisma.mtmTask.count)
      .mockResolvedValueOnce(20) // totalTasks
      .mockResolvedValueOnce(15) // completedTasks
    vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(30)
    vi.mocked(prisma.mtmVisit.findMany)
      .mockResolvedValueOnce([]) // visits for trend
      .mockResolvedValueOnce([]) // recentVisits for weekly comparison
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.groupBy).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
    // M2-3 Mars KPI mocks
    vi.mocked(prisma.mtmRoute.aggregate).mockResolvedValue({ _sum: { totalPoints: 0, visitedPoints: 0 } } as any)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.groupBy).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.aggregate).mockResolvedValue({ _avg: { duration: null } } as any)

    const res = await GetAnalytics(makeReq("/api/v1/mtm/analytics"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.kpi).toHaveProperty("totalVisits")
    expect(json.data.kpi).toHaveProperty("completionRate")
    expect(json.data).toHaveProperty("monthlyTrend")
    expect(json.data).toHaveProperty("weeklyComparison")
    expect(json.data).toHaveProperty("topAgents")
    expect(json.data).toHaveProperty("marsKpi")
    expect(json.data).toHaveProperty("agentKpis")
  })
})

// ─── GET /api/v1/mtm/leaderboard ───────────────────────────
describe("GET /api/v1/mtm/leaderboard", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }) as never)
    const res = await GetLeaderboard(makeReq("/api/v1/mtm/leaderboard"))
    expect(res.status).toBe(401)
  })

  it("remains session-only after the Route & Field capability split", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "api-key-user",
      role: "manager",
      email: "key@example.com",
      name: "API key",
      principalType: "api_key",
    } as never)
    const res = await GetLeaderboard(makeReq("/api/v1/mtm/leaderboard"))
    expect(res.status).toBe(401)
  })

  it("preserves an authorization/capability denial without running rankings", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 }) as never)
    const res = await GetLeaderboard(makeReq("/api/v1/mtm/leaderboard"))
    expect(res.status).toBe(403)
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
  })

  it("returns ranked agents with scores and achievements (F-13: now uses groupBy)", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u1",
      role: "manager",
      email: "m@x",
      name: "M",
      principalType: "session",
    } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "a1", name: "Agent A" },
      { id: "a2", name: "Agent B" },
    ] as any)
    // F-13: leaderboard now uses 6 groupBy queries instead of 1+N×9 count loops.
    // Each groupBy returns Array<{agentId, _count}> for per-agent aggregates.
    vi.mocked(prisma.mtmVisit.groupBy).mockResolvedValue([
      { agentId: "a1", _count: 5 },
      { agentId: "a2", _count: 3 },
    ] as any)
    vi.mocked(prisma.mtmTask.groupBy).mockResolvedValue([
      { agentId: "a1", _count: 3 },
    ] as any)
    vi.mocked(prisma.mtmPhoto.groupBy).mockResolvedValue([
      { agentId: "a1", _count: 2 },
    ] as any)
    vi.mocked(prisma.mtmRoute.groupBy).mockResolvedValue([
      { agentId: "a1", _count: 1 },
    ] as any)
    vi.mocked(prisma.mtmAlert.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as any)

    const res = await GetLeaderboard(makeReq("/api/v1/mtm/leaderboard"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.rankings).toHaveLength(2)
    expect(json.data.rankings[0]).toHaveProperty("rank", 1)
    expect(json.data.rankings[0]).toHaveProperty("score")
    expect(json.data.rankings[0]).toHaveProperty("achievements")
    expect(json.data.period).toBe("monthly")
  })
})
