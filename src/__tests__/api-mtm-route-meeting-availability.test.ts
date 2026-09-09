import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const authState = vi.hoisted(() => ({
  organizationId: "org-1",
  userId: "admin-user",
  agentId: null as string | null,
}))

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-mtm-rls-auth", () => ({
  withMtmRlsAuth: (_module: unknown, _action: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest) => handler(req, {
      orgId: authState.organizationId,
      userId: authState.userId,
      role: "admin",
      email: "planner@example.com",
      name: "Planner",
      agentId: authState.agentId,
      principal: "web",
    }),
  withRouteFieldRlsAuth: (_action: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest) => handler(req, {
      orgId: authState.organizationId,
      userId: authState.userId,
      role: "admin",
      email: "planner@example.com",
      name: "Planner",
      agentId: authState.agentId,
      principal: "web",
    }),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

import { POST } from "@/app/api/v1/mtm/routes/meeting-availability/route"
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

function request(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/routes/meeting-availability", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const slot = {
  customerId: "customer-1",
  contactId: "contact-1",
  plannedTime: "2026-08-24T09:00:00.000Z",
}

describe("POST /api/v1/mtm/routes/meeting-availability", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.organizationId = "org-1"
    authState.userId = "admin-user"
    authState.agentId = null
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: null,
      role: "ADMIN",
      scopedAgentIds: null,
    } as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([])
  })

  it("validates the request before querying any schedule", async () => {
    const response = await POST(request({ date: "not-a-date", slots: [] }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_MEETING_AVAILABILITY_INVALID" })
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
  })

  it("returns only a safe, time-specific colleague meeting signal", async () => {
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      customerId: "customer-1",
      contactId: "contact-1",
      plannedTime: new Date("2026-08-24T09:00:00.000Z"),
      notes: "This must never leave the route point",
      route: {
        id: "route-1",
        agentId: "agent-2",
        agent: { id: "agent-2", name: "Leyla Əliyeva" },
        assignments: [{
          agentId: "agent-3",
          agent: { id: "agent-3", name: "Kamran Abbasov" },
        }],
      },
    }] as never)

    const response = await POST(request({ date: "2026-08-24", slots: [slot] }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      success: true,
      data: {
        meetings: [{
          customerId: "customer-1",
          contactId: "contact-1",
          plannedTime: "2026-08-24T09:00:00.000Z",
          busyAgents: [],
          meetings: [{
            routeId: "route-1",
            agents: [
              { id: "agent-2", name: "Leyla Əliyeva" },
              { id: "agent-3", name: "Kamran Abbasov" },
            ],
            sameContact: true,
          }],
        }],
        teamScheduleVisibilityEnabled: false,
      },
    })
    expect(JSON.stringify(body)).not.toContain("This must never leave")
    expect(prisma.mtmRoutePoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        customerId: { in: ["customer-1"] },
        route: expect.objectContaining({
          organizationId: "org-1",
          status: { in: ["PLANNED", "IN_PROGRESS"] },
        }),
      }),
    }))
  })

  it("reports a selected agent as busy even when their existing meeting is with another customer", async () => {
    vi.mocked(prisma.mtmRoutePoint.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        customerId: "different-customer",
        contactId: null,
        plannedTime: new Date("2026-08-24T09:00:00.000Z"),
        route: {
          id: "busy-route",
          agentId: "agent-1",
          agent: { id: "agent-1", name: "Elçin Quliyev" },
          assignments: [],
        },
      }] as never)

    const response = await POST(request({
      date: "2026-08-24",
      agentIds: ["agent-1"],
      slots: [slot],
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        meetings: [{
          customerId: "customer-1",
          busyAgents: [{ id: "agent-1", name: "Elçin Quliyev" }],
          meetings: [],
        }],
      },
    })
    expect(prisma.mtmRoutePoint.findMany).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.mtmRoutePoint.findMany).mock.calls[1][0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        route: expect.objectContaining({
          AND: expect.arrayContaining([expect.objectContaining({
            OR: expect.arrayContaining([
              { agentId: { in: ["agent-1"] } },
            ]),
          })]),
        }),
      }),
    }))
  })

  it("does not include a field agent's teammates when the tenant has not enabled team calendar visibility", async () => {
    authState.agentId = "agent-1"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ teamId: "team-1" } as never)

    const response = await POST(request({ date: "2026-08-24", slots: [slot] }))

    expect(response.status).toBe(200)
    const query = vi.mocked(prisma.mtmRoutePoint.findMany).mock.calls[0][0] as {
      where: { route: { OR?: unknown } }
    }
    expect(query.where.route.OR).toEqual([
      { agentId: "agent-1" },
      { assignments: { some: { organizationId: "org-1", agentId: "agent-1", removedAt: null } } },
    ])
    expect(JSON.stringify(query.where.route)).not.toContain("team-1")
  })
})
