import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn(() => Promise.resolve()) }))

import { GET as getActiveVisits } from "@/app/api/v1/mtm/visits/active/route"
import { GET as getVisitWorkspace } from "@/app/api/v1/mtm/visits/[id]/workspace/route"
import { PUT as saveVisitResult } from "@/app/api/v1/mtm/visits/[id]/result/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { mutableVisitWhere, scopedVisitWhere } from "@/lib/mtm/visit-scope"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const adminAuth = { orgId: "org-1", userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }

function request(path: string, method = "GET", body?: unknown) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(adminAuth as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: null,
    role: "ADMIN",
    scopedAgentIds: null,
  } as never)
  vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmVisitActionResult.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
})

describe("visit workspace scope", () => {
  it("restricts an agent to owned or participating visits", () => {
    expect(scopedVisitWhere({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] }, "org-1", { status: "CHECKED_IN" }))
      .toMatchObject({
        organizationId: "org-1",
        status: "CHECKED_IN",
        OR: [
          { agentId: { in: ["agent-1"] } },
          {
            participants: {
              some: {
                organizationId: "org-1",
                agentId: { in: ["agent-1"] },
                role: { not: "OBSERVER" },
                leftAt: null,
              },
            },
          },
        ],
      })
  })

  it("keeps the mutation workspace primary-scoped even for a participant", () => {
    expect(mutableVisitWhere(
      { agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] },
      "org-1",
      { status: "CHECKED_IN" },
    )).toEqual({
      organizationId: "org-1",
      deletedAt: null,
      status: "CHECKED_IN",
      agentId: { in: ["agent-1"] },
    })
  })

  it("returns active visits through the same scoped query", async () => {
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{ id: "visit-1", status: "CHECKED_IN" }] as never)
    const response = await getActiveVisits(request("/api/v1/mtm/visits/active"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { visits: [{ id: "visit-1" }] } })
    expect(prisma.mtmVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", status: "CHECKED_IN" }),
    }))
  })

  it("does not return a participant-only active workspace", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])

    const response = await getActiveVisits(request("/api/v1/mtm/visits/active"))

    expect(response.status).toBe(200)
    expect(prisma.mtmVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        status: "CHECKED_IN",
        agentId: { in: ["agent-1"] },
      }),
    }))
    expect((vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any).where).not.toHaveProperty("OR")
  })

  it("returns 404 before ancillary facts for a participant-only workspace", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "participant-1",
      role: "AGENT",
      scopedAgentIds: ["participant-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)

    const response = await getVisitWorkspace(
      request("/api/v1/mtm/visits/visit-outside/workspace"),
      { params: Promise.resolve({ id: "visit-outside" }) },
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "MTM_VISIT_NOT_FOUND" })
    expect(prisma.mtmVisit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "visit-outside",
        organizationId: "org-1",
        agentId: { in: ["participant-1"] },
      }),
    }))
    expect(prisma.mtmTask.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisitActionResult.findMany).not.toHaveBeenCalled()
  })

  it("filters active participant identities and ancillary facts to the current team scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["manager-1", "agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      organizationId: "org-1",
      agentId: "agent-1",
      customerId: "customer-1",
      status: "CHECKED_IN",
      checkInAt: new Date("2026-07-13T10:00:00.000Z"),
      agent: { id: "agent-1", name: "Scoped primary" },
      customer: { id: "customer-1", name: "Customer" },
      participants: [
        { agentId: "agent-1", role: "PARTICIPANT", leftAt: null, agent: { id: "agent-1", name: "Scoped" } },
        { agentId: "agent-secret", role: "PARTICIPANT", leftAt: null, agent: { id: "agent-secret", name: "Secret" } },
        { agentId: "manager-1", role: "OBSERVER", leftAt: null, agent: { id: "manager-1", name: "Observer" } },
      ],
      requirementSnapshot: null,
      actionResults: [],
      photos: [],
      route: null,
      routePoint: null,
    } as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisitActionResult.findMany).mockResolvedValue([])

    const response = await getVisitWorkspace(
      request("/api/v1/mtm/visits/visit-1/workspace"),
      { params: Promise.resolve({ id: "visit-1" }) },
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.visit.participants).toHaveLength(1)
    expect(JSON.stringify(json)).not.toContain("agent-secret")
    expect(JSON.stringify(json)).not.toContain("Secret")
    expect(JSON.stringify(json)).not.toContain("Observer")
    expect(prisma.mtmTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agentId: { in: ["manager-1", "agent-1"] } }),
    }))
    expect(prisma.mtmVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agentId: { in: ["manager-1", "agent-1"] } }),
    }))
    expect(prisma.mtmVisitActionResult.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        visit: expect.objectContaining({ agentId: { in: ["manager-1", "agent-1"] } }),
      }),
    }))
  })
})

describe("visit result", () => {
  it("updates the same next-action task on retry", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      agentId: "agent-1",
      customerId: "customer-1",
      status: "CHECKED_IN",
      requirementSnapshot: { requirements: [{ id: "req-next", actionKey: "NEXT_ACTION", mode: "REQUIRED" }] },
    } as never)
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmVisitActionResult.findFirst).mockResolvedValue({ id: "result-next" } as never)
    vi.mocked(prisma.mtmVisitActionResult.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "task-next", visitId: "visit-1", deletedAt: null } as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
    const body = {
      outcome: "RESCHEDULE",
      potential: "HIGH",
      discussedTopics: [],
      nextAction: { title: "Return with samples", dueDate: "2026-07-20T09:00:00.000Z", priority: "HIGH" },
    }

    const first = await saveVisitResult(request("/api/v1/mtm/visits/visit-1/result", "PUT", body), { params: Promise.resolve({ id: "visit-1" }) })
    const second = await saveVisitResult(request("/api/v1/mtm/visits/visit-1/result", "PUT", body), { params: Promise.resolve({ id: "visit-1" }) })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledTimes(2)
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", visitId: "visit-1" }),
      data: expect.objectContaining({ agentId: "agent-1", customerId: "customer-1", visitId: "visit-1" }),
    }))
  })

  it("requires a next action when outcome is reschedule", async () => {
    const response = await saveVisitResult(request("/api/v1/mtm/visits/visit-1/result", "PUT", {
      outcome: "RESCHEDULE",
      potential: "UNKNOWN",
      discussedTopics: [],
    }), { params: Promise.resolve({ id: "visit-1" }) })
    expect(response.status).toBe(400)
    expect(prisma.mtmVisit.findFirst).not.toHaveBeenCalled()
  })

  it("creates a next action with a deterministic source key", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      agentId: "agent-1",
      customerId: "customer-1",
      status: "CHECKED_IN",
      requirementSnapshot: { requirements: [{ id: "req-next", actionKey: "NEXT_ACTION", mode: "OPTIONAL" }] },
    } as never)
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmVisitActionResult.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmVisitActionResult.create).mockResolvedValue({ id: "result-next" } as never)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmTask.create).mockResolvedValue({ id: "task-next" } as never)

    const response = await saveVisitResult(request("/api/v1/mtm/visits/visit-1/result", "PUT", {
      outcome: "SUCCESSFUL",
      potential: "MEDIUM",
      discussedTopics: [],
      nextAction: { title: "Send material", dueDate: "2026-07-20T09:00:00.000Z" },
    }), { params: Promise.resolve({ id: "visit-1" }) })

    expect(response.status).toBe(200)
    expect(prisma.mtmTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceKey: "visit-next-action:visit-1" }),
    }))
  })

  it("clears derived action state and cancels the old follow-up task on PUT omission", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      agentId: "agent-1",
      customerId: "customer-1",
      status: "CHECKED_IN",
      requirementSnapshot: { requirements: [] },
    } as never)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
      id: "task-next",
      visitId: "visit-1",
      deletedAt: null,
    } as never)

    const response = await saveVisitResult(request("/api/v1/mtm/visits/visit-1/result", "PUT", {
      outcome: "SUCCESSFUL",
      potential: "UNKNOWN",
      discussedTopics: [],
      feedback: null,
      finalNote: null,
      nextAction: null,
    }), { params: Promise.resolve({ id: "visit-1" }) })

    expect(response.status).toBe(200)
    expect(prisma.mtmVisitActionResult.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", visitId: "visit-1", actionKey: "NEXT_ACTION" },
      data: expect.objectContaining({ status: "PENDING", completedAt: null }),
    }))
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", visitId: "visit-1" }),
      data: expect.objectContaining({
        agentId: "agent-1",
        customerId: "customer-1",
        visitId: "visit-1",
        status: "CANCELLED",
        completedAt: null,
      }),
    }))
  })
})
