import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET } from "@/app/api/v1/mtm/mobile/team-schedule/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const AUTH = {
  orgId: "org-1",
  agentId: "agent-1",
  userId: "user-1",
  email: "agent@example.com",
  name: "Current Agent",
  role: "AGENT",
}

function request(query = "?from=2026-08-17&to=2026-08-23") {
  return new NextRequest(`http://localhost/api/v1/mtm/mobile/team-schedule${query}`, {
    headers: { Authorization: "Bearer mobile" },
  })
}

function enableTeamSchedule() {
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{
    key: "teamScheduleVisibilityEnabled",
    value: true,
  }] as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-1" } as never)
  vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([])
})

describe("GET /api/v1/mtm/mobile/team-schedule", () => {
  it("requires mobile authentication", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as never)
    expect((await GET(request())).status).toBe(401)
  })

  it("is field-agent only and rejects a manager before reading settings", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH, role: "MANAGER" } as never)

    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "MTM_MOBILE_CAPABILITY_REQUIRED",
      capability: "FIELD_EXECUTE",
    })
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
  })

  it.each([
    "",
    "?from=2026-08-17",
    "?to=2026-08-23",
    "?from=2026-08-23&to=2026-08-17",
    "?from=2026-02-30&to=2026-03-01",
    "?from=2026-08-01&to=2026-09-12",
  ])("rejects an invalid range before reading settings or schedule data: %s", async (query) => {
    const response = await GET(request(query))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_TEAM_SCHEDULE_RANGE_INVALID" })
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
  })

  it("fails closed by default and never queries the actor or colleague routes", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        enabled: false,
        from: "2026-08-17",
        to: "2026-08-23",
        days: 7,
        scope: "DISABLED",
        meetings: [],
        truncated: false,
      },
    })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
  })

  it("returns no meetings and does not query routes when the current agent has no team", async () => {
    enableTeamSchedule()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: null } as never)

    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { enabled: true, scope: "NO_TEAM", meetings: [], truncated: false },
    })
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
  })

  it("scopes meetings to active colleagues in the same tenant and team", async () => {
    enableTeamSchedule()

    const response = await GET(request("?from=2026-08-01&to=2026-09-11"))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      enabled: true,
      days: 42,
      scope: "TEAM",
      truncated: false,
    })

    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith({
      where: {
        id: "agent-1",
        organizationId: "org-1",
        status: "ACTIVE",
        role: "AGENT",
      },
      select: { id: true, teamId: true },
    })
    expect(prisma.mtmRoutePoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        deletedAt: null,
        route: {
          organizationId: "org-1",
          deletedAt: null,
          date: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lt: new Date("2026-09-12T00:00:00.000Z"),
          },
          // INCOMPLETE: a colleague's unfinished past day still happened, so it
          // must not vanish from the shared calendar when the job closes it.
          status: { in: ["PLANNED", "IN_PROGRESS", "COMPLETED", "INCOMPLETE"] },
          publishedVersion: { not: null },
          agentId: { not: "agent-1" },
          assignments: { none: { agentId: "agent-1", removedAt: null } },
          agent: {
            organizationId: "org-1",
            teamId: "team-1",
            status: "ACTIVE",
            role: "AGENT",
          },
        },
      },
      take: 1_001,
    }))
  })

  it("returns only the safe meeting card fields and strips sensitive source data", async () => {
    enableTeamSchedule()
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      id: "point-1",
      status: "PENDING",
      plannedTime: new Date("2026-08-20T10:30:00.000Z"),
      orderIndex: 2,
      notes: "must never escape",
      customerId: "customer-secret-id",
      customer: {
        id: "customer-secret-id",
        name: "Central Clinic",
        address: "12 Nizami Street",
        city: "Baku",
        phone: "+994-secret",
        latitude: 40.4,
        longitude: 49.8,
      },
      contactId: "contact-secret-id",
      contact: {
        id: "contact-secret-id",
        displayName: "Dr Aysel",
        phone: "+994-contact-secret",
      },
      route: {
        id: "route-secret-id",
        date: new Date("2026-08-20T00:00:00.000Z"),
        status: "PLANNED",
        notes: "route secret",
        agent: { id: "agent-2", name: "Aysel" },
      },
    }] as never)

    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.meetings).toEqual([{
      id: "point-1",
      date: "2026-08-20",
      plannedTime: "2026-08-20T10:30:00.000Z",
      agent: { id: "agent-2", name: "Aysel" },
      customer: { name: "Central Clinic" },
      contact: { displayName: "Dr Aysel" },
      location: { address: "12 Nizami Street", city: "Baku" },
      routeStatus: "PLANNED",
      pointStatus: "PENDING",
    }])

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("customer-secret-id")
    expect(serialized).not.toContain("contact-secret-id")
    expect(serialized).not.toContain("route-secret-id")
    expect(serialized).not.toContain("+994")
    expect(serialized).not.toContain("must never escape")
    expect(serialized).not.toContain("route secret")
    expect(serialized).not.toContain("40.4")
    expect(serialized).not.toContain("49.8")

    const query = vi.mocked(prisma.mtmRoutePoint.findMany).mock.calls[0][0] as any
    expect(query.select).toEqual({
      id: true,
      status: true,
      plannedTime: true,
      customer: { select: { name: true, address: true, city: true } },
      contact: { select: { displayName: true } },
      route: {
        select: {
          date: true,
          status: true,
          agent: { select: { id: true, name: true } },
        },
      },
    })
  })
})
