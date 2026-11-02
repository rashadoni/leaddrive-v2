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

  it("counts the period from the organization's midnight, not the server's", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-04T21:30:00.000Z") }) // 01:30 on the 5th in Baku
    try {
      await GET(request("?period=today"))
      const where = (vi.mocked(prisma.mtmVisitRequirement.count).mock.calls[0][0] as any).where
      expect(where.snapshot.visit.checkInAt.gte.toISOString()).toBe("2026-11-04T20:00:00.000Z")
      expect(where.snapshot.visit.checkInAt.lt.toISOString()).toBe("2026-11-05T20:00:00.000Z")
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps a late promise from before the period, and calls one kept when somebody came back", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-04T08:00:00.000Z") })
    try {
      vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
        { id: "late", customerId: "c-late", checkInAt: new Date("2026-10-20T08:00:00Z"), nextActionDueAt: new Date("2026-10-25T08:00:00Z"), outcome: null, resultNotes: null, notes: null, agent: { name: "Ali" }, customer: { name: "Apteka 1" } },
        { id: "kept", customerId: "c-kept", checkInAt: new Date("2026-10-28T08:00:00Z"), nextActionDueAt: new Date("2026-11-03T08:00:00Z"), outcome: null, resultNotes: null, notes: null, agent: { name: "Ali" }, customer: { name: "Apteka 2" } },
        { id: "old-kept", customerId: "c-kept", checkInAt: new Date("2026-09-20T08:00:00Z"), nextActionDueAt: new Date("2026-10-01T08:00:00Z"), outcome: null, resultNotes: null, notes: null, agent: { name: "Ali" }, customer: { name: "Apteka 2" } },
      ] as never)
      vi.mocked(prisma.mtmVisit.groupBy).mockResolvedValue([
        { customerId: "c-late", _max: { checkInAt: new Date("2026-10-20T08:00:00Z") } },
        { customerId: "c-kept", _max: { checkInAt: new Date("2026-11-02T08:00:00Z") } },
      ] as never)
      const body = await (await GET(request("?type=promises&period=week"))).json()
      expect(body.data.reportData.map((row: { id: string; status: string }) => [row.id, row.status])).toEqual([["late", "OVERDUE"], ["kept", "DONE"]])
    } finally {
      vi.useRealTimers()
    }
  })

  it("counts the part of a month's sales plan that falls into the week", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-08T08:00:00.000Z") })
    try {
      vi.mocked(prisma.mtmExternalSalesDocument.findMany).mockResolvedValue([] as never)
      vi.mocked(prisma.mtmSalesPlanLine.findMany).mockResolvedValue([
        { customerId: "c1", agentId: "agent-1", territoryCode: null, periodStart: new Date("2026-11-01T00:00:00Z"), plannedAmount: 3000, plannedQuantity: 30, customer: { name: "Apteka" }, agent: { name: "Ali" } },
      ] as never)
      const body = await (await GET(request("?type=sales&period=week"))).json()
      // Monday 2 – Sunday 8 November: 7 of 30 days.
      expect(body.data.reportData[0]).toMatchObject({ customer: "Apteka", planAmount: 700 })
      expect(body.data.reportData[0]).not.toHaveProperty("customerId")
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects an unknown management report type", async () => {
    const response = await GET(request("?type=unknown"))
    expect(response.status).toBe(404)
  })
})
