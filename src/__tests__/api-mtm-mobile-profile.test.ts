/**
 * Tests for GET /api/v1/mtm/mobile/profile — agent profile + today's summary
 * (ProfileScreen of the field mobile app).
 *
 * Route file: src/app/api/v1/mtm/mobile/profile/route.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET } from "@/app/api/v1/mtm/mobile/profile/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

const ORG = "org-1"
const AGENT_ID = "agent-1"
const AUTH_CONTEXT = {
  orgId: ORG,
  agentId: AGENT_ID,
  tenantCapabilities: { routeField: true, workforceHrm: true },
}

function makeReq(): NextRequest {
  return new NextRequest(
    new URL("http://localhost:3000/api/v1/mtm/mobile/profile"),
    { headers: { Authorization: "Bearer valid-token" } },
  )
}

const sampleAgent = {
  id: AGENT_ID,
  name: "Ali Agayev",
  email: "ali@example.com",
  phone: "+994501234567",
  role: "AGENT",
  status: "ACTIVE",
  avatar: null,
  isOnline: true,
  organizationId: ORG,
  organization: { id: ORG, name: "Acme FMCG" },
  manager: { id: "mgr-1", name: "Manager One" },
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"))
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH_CONTEXT as any)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/v1/mtm/mobile/profile", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it("returns 404 when the agent record is gone", async () => {
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe("Agent not found")
  })

  it("returns agent profile with organization name, manager and today's summary", async () => {
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue(sampleAgent as any)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(3)
    vi.mocked(prisma.mtmTask.count).mockResolvedValue(2)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-1", totalPoints: 10, visitedPoints: 4, status: "IN_PROGRESS",
    }] as any)

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.agent).toMatchObject({
      id: AGENT_ID,
      name: "Ali Agayev",
      email: "ali@example.com",
      role: "AGENT",
      organizationId: ORG,
      organizationName: "Acme FMCG",
      manager: { id: "mgr-1", name: "Manager One" },
    })
    expect(json.data.todaySummary).toEqual({
      date: "2026-07-15",
      timezone: "Asia/Baku",
      visits: 3,
      tasksCompleted: 2,
      routes: 1,
      routePoints: 10,
      routeVisited: 4,
      routeStatus: "IN_PROGRESS",
      routeStatuses: ["IN_PROGRESS"],
    })

    // all today-queries are scoped to the authenticated agent
    const visitArgs = vi.mocked(prisma.mtmVisit.count).mock.calls[0][0] as any
    expect(visitArgs.where.organizationId).toBe(ORG)
    expect(visitArgs.where.agentId).toBe(AGENT_ID)
    expect(visitArgs.where.deletedAt).toBeNull()
    const taskArgs = vi.mocked(prisma.mtmTask.count).mock.calls[0][0] as any
    expect(taskArgs.where.organizationId).toBe(ORG)
    expect(taskArgs.where.agentId).toBe(AGENT_ID)
    expect(taskArgs.where.status).toBe("COMPLETED")
    const routeArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(routeArgs.where.organizationId).toBe(ORG)
    expect(routeArgs.where.OR).toEqual([
      { agentId: AGENT_ID },
      { assignments: { some: { agentId: AGENT_ID, removedAt: null } } },
    ])
  })

  it("todaySummary falls back to zeros / NONE when there is no route today", async () => {
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue(sampleAgent as any)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmTask.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])

    const res = await GET(makeReq())
    const json = await res.json()
    expect(json.data.todaySummary).toEqual({
      date: "2026-07-15",
      timezone: "Asia/Baku",
      visits: 0,
      tasksCompleted: 0,
      routes: 0,
      routePoints: 0,
      routeVisited: 0,
      routeStatus: "NONE",
      routeStatuses: [],
    })
  })

  it("does not query or disclose Route & Field summary data for a Workforce-only tenant", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH_CONTEXT,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    } as any)
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue(sampleAgent as any)

    const response = await GET(makeReq())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.todaySummary).toMatchObject({
      visits: 0,
      tasksCompleted: 0,
      routes: 0,
      routeStatus: "NONE",
      routeStatuses: [],
    })
    expect(json.data.capabilities).toBeUndefined()
    expect(prisma.mtmVisit.count).not.toHaveBeenCalled()
    expect(prisma.mtmTask.count).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })

  it("uses organization-local midnight boundaries instead of the server timezone", async () => {
    vi.setSystemTime(new Date("2026-07-14T21:30:00.000Z"))
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue(sampleAgent as any)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmTask.count).mockResolvedValue(0)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])

    const response = await GET(makeReq())
    const json = await response.json()
    expect(json.data.todaySummary.date).toBe("2026-07-15")

    const visitArgs = vi.mocked(prisma.mtmVisit.count).mock.calls[0][0] as any
    expect(visitArgs.where.checkInAt).toEqual({
      gte: new Date("2026-07-14T20:00:00.000Z"),
      lt: new Date("2026-07-15T20:00:00.000Z"),
    })
  })

  it("returns 500 when a query fails", async () => {
    vi.mocked(prisma.mtmAgent.findUnique).mockRejectedValue(new Error("db down"))
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
    const json = await res.json()
    // NOTE: raw e.message passthrough is pre-existing route behavior —
    // not pinned here so later sanitization doesn't break this test.
    expect(json.error).toBeTruthy()
  })
})
