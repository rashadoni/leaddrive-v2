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

vi.mock("@/lib/mtm/route-permissions", () => ({
  resolveMtmRouteActor: vi.fn(),
}))

import { GET } from "@/app/api/v1/mtm/management-reports/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { prisma } from "@/lib/prisma"

const auth = { orgId: "org-1", userId: "manager-user", role: "manager", email: "manager@example.com", name: "Manager" }

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/management-reports${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(auth as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: "manager-1",
    role: "MANAGER",
    scopedAgentIds: new Set(["agent-1"]),
  } as never)
})

describe("GET /api/v1/mtm/management-reports", () => {
  it("applies the manager's agent scope to overview counts", async () => {
    const response = await GET(request("?period=week"))

    expect(response.status).toBe(200)
    expect(prisma.mtmRoute.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        OR: expect.arrayContaining([
          { agentId: { in: ["agent-1"] } },
          { assignments: { some: { agentId: { in: ["agent-1"] }, removedAt: null } } },
        ]),
      }),
    }))
    expect(prisma.mtmExternalSalesLine.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        document: expect.objectContaining({ agentId: { in: ["agent-1"] } }),
      }),
    }))
  })

  it("reconciles route plan and execution totals", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-1",
      date: new Date("2026-07-13T00:00:00.000Z"),
      totalPoints: 5,
      visitedPoints: 4,
      status: "COMPLETED",
      agent: { name: "Ali", team: { name: "North", region: { name: "Baku" } } },
    }] as never)

    const response = await GET(request("?type=route_execution&period=month"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.reportData[0]).toMatchObject({ planned: 5, actual: 4, compliance: 80 })
    expect(Object.fromEntries(body.data.summary.map((item: { labelKey: string; value: number }) => [item.labelKey, item.value]))).toMatchObject({
      "sum.plannedStops": 5,
      "sum.completedStops": 4,
      "sum.compliance": 80,
    })
  })

  it("rejects an unknown management report type", async () => {
    const response = await GET(request("?type=unknown"))
    expect(response.status).toBe(404)
  })
})
