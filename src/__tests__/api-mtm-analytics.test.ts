/**
 * Tests for GET /api/v1/mtm/analytics (M2-3 Mars KPI dashboards).
 *
 * Prisma call order (determines mockResolvedValueOnce sequencing):
 *
 * Batch 1 (Promise.all):
 *   [0] mtmVisit.count          → totalVisits
 *   [1] mtmTask.count           → totalTasks
 *   [2] mtmTask.count           → completedTasks
 *   [3] mtmPhoto.count          → totalPhotos
 *   [4] mtmVisit.findMany       → visits (trend)
 *   [5] mtmTask.findMany        → tasks (trend)
 *   [6] mtmVisit.findMany       → recentVisits (weekly comparison DOW)
 *
 * Batch 3 (Promise.all):
 *   [0] mtmVisit.groupBy        → agentVisitStats (first 5 rows double as topAgents)
 *   [1] mtmRoute.groupBy        → agentRouteStats (new M2-3)
 *   [2] mtmRoute.aggregate      → routeAggregate (new M2-3)
 *   [3] mtmRoute.findMany       → routesWithTime (new M2-3)
 *   [4] mtmVisit.aggregate      → visitDurationAgg (new M2-3)
 *
 * After Batch 3:
 *   mtmAgent.findMany           → agents
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mtm/route-permissions", () => ({ resolveMtmRouteActor: vi.fn() }))

import { GET } from "@/app/api/v1/mtm/analytics/route"
import { GET as EXPORT_GET } from "@/app/api/v1/mtm/analytics/export/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const ORG = "org-mars"
const SESSION = { orgId: ORG, userId: "manager-user", role: "manager", email: "manager@example.com", name: "Manager" }

function makeReq(qs = ""): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/v1/mtm/analytics${qs}`))
}

/**
 * Baseline mocks so tests only override what they actually care about.
 * Sets default (non-queued) values for every prisma call in the route.
 */
function setupBaseMocks() {
  vi.mocked(requireAuth).mockResolvedValue(SESSION as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager-agent", role: "MANAGER", scopedAgentIds: null })

  // Batch 1
  vi.mocked(prisma.mtmVisit.count).mockResolvedValue(10)
  vi.mocked(prisma.mtmTask.count).mockResolvedValue(8)
  vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(20)
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])

  // Batch 3 defaults
  vi.mocked(prisma.mtmVisit.groupBy).mockResolvedValue([])
  vi.mocked(prisma.mtmRoute.groupBy).mockResolvedValue([])
  vi.mocked(prisma.mtmRoute.aggregate).mockResolvedValue({
    _sum: { totalPoints: 0, visitedPoints: 0 },
  } as any)
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmVisit.aggregate).mockResolvedValue({
    _avg: { duration: null },
  } as any)

  // Agent name lookup
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/mtm/analytics", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }) as never)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it("passes through an mtm/read permission denial before actor or data access", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 }) as never)

    const res = await GET(makeReq())

    expect(res.status).toBe(403)
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.count).not.toHaveBeenCalled()
  })

  it("applies current primary-owner manager scope to every legacy cohort", async () => {
    setupBaseMocks()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager-agent", role: "MANAGER", scopedAgentIds: ["agent-in-scope"] })

    const res = await GET(makeReq("?period=yearly"))

    expect(res.status).toBe(200)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "mtm", "read", {
      deferLegacyModuleGate: "mtm",
    })
    const scopedCountCalls = [
      ...vi.mocked(prisma.mtmVisit.count).mock.calls,
      ...vi.mocked(prisma.mtmTask.count).mock.calls,
      ...vi.mocked(prisma.mtmPhoto.count).mock.calls,
    ] as Array<[any]>
    for (const [args] of scopedCountCalls) {
      expect(args.where.agentId).toEqual({ in: ["agent-in-scope"] })
    }
    expect(vi.mocked(prisma.mtmRoute.aggregate).mock.calls[0][0]?.where.agentId).toEqual({ in: ["agent-in-scope"] })
    expect(vi.mocked(prisma.mtmVisit.groupBy).mock.calls[0][0]?.where.agentId).toEqual({ in: ["agent-in-scope"] })
    const body = await res.json()
    expect(body.data.scope).toEqual(expect.objectContaining({ bounded: true }))
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Existing fields non-regression
  // ─────────────────────────────────────────────────────────────────────────

  it("returns existing kpi fields (non-regression)", async () => {
    setupBaseMocks()
    vi.mocked(prisma.mtmTask.count)
      .mockResolvedValueOnce(8)  // totalTasks
      .mockResolvedValueOnce(6)  // completedTasks

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.kpi).toMatchObject({
      totalVisits:    expect.any(Number),
      totalTasks:     expect.any(Number),
      totalPhotos:    expect.any(Number),
      completionRate: expect.any(Number),
    })
    // completionRate = round(6/8*100) = 75
    expect(body.data.kpi.completionRate).toBe(75)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // marsKpi section — shape
  // ─────────────────────────────────────────────────────────────────────────

  it("returns marsKpi with all 3 metrics", async () => {
    setupBaseMocks()
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.marsKpi).toMatchObject({
      visitPlanFulfillment:  expect.any(Number),
      avgTimeOnRoute:        expect.any(Number),
      avgTimeInStore:        expect.any(Number),
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // marsKpi — per-metric computation
  // ─────────────────────────────────────────────────────────────────────────

  it("computes visitPlanFulfillment correctly (73%)", async () => {
    setupBaseMocks()
    // routeAggregate (batch3[3]): 15 total, 11 visited → 73%
    vi.mocked(prisma.mtmRoute.aggregate).mockResolvedValue({
      _sum: { totalPoints: 15, visitedPoints: 11 },
    } as any)

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.marsKpi.visitPlanFulfillment).toBe(73)
  })

  it("computes avgTimeOnRoute correctly (210 min)", async () => {
    setupBaseMocks()
    // routesWithTime (batch3[4]): two routes
    const t0 = new Date("2026-05-21T09:00:00Z")
    const t1 = new Date("2026-05-21T13:00:00Z") // 240 min
    const t2 = new Date("2026-05-21T08:00:00Z")
    const t3 = new Date("2026-05-21T11:00:00Z") // 180 min
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([
      { startedAt: t0, completedAt: t1, agentId: "a1" } as any,
      { startedAt: t2, completedAt: t3, agentId: "a2" } as any,
    ])

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.marsKpi.avgTimeOnRoute).toBe(210) // (240+180)/2
  })

  it("computes avgTimeInStore correctly (20 min)", async () => {
    setupBaseMocks()
    // visitDurationAgg (batch3[5])
    vi.mocked(prisma.mtmVisit.aggregate).mockResolvedValue({
      _avg: { duration: 20 },
    } as any)

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.marsKpi.avgTimeInStore).toBe(20)
  })

  it("returns 0 for visitPlanFulfillment when no routes", async () => {
    setupBaseMocks()
    vi.mocked(prisma.mtmRoute.aggregate).mockResolvedValue({
      _sum: { totalPoints: null, visitedPoints: null },
    } as any)

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.marsKpi.visitPlanFulfillment).toBe(0)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // agentKpis section
  // ─────────────────────────────────────────────────────────────────────────

  it("returns agentKpis array with per-agent data", async () => {
    setupBaseMocks()

    // mtmVisit.groupBy — single call in batch3: agentVisitStats (its first
    // five rows also feed topAgents; the dedicated top-5 query was folded in)
    vi.mocked(prisma.mtmVisit.groupBy)
      .mockResolvedValueOnce([
        { agentId: "a1", _count: 8, _avg: { duration: 18 } },
        { agentId: "a2", _count: 5, _avg: { duration: 22 } },
      ] as any)

    // mtmRoute.groupBy (batch3[2]) — agentRouteStats
    vi.mocked(prisma.mtmRoute.groupBy).mockResolvedValue([
      { agentId: "a1", _sum: { totalPoints: 10, visitedPoints: 8 } },
    ] as any)

    // Agent names
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "a1", name: "Ali Hasanov" },
      { id: "a2", name: "Nigar Mammadova" },
    ] as any)

    const res = await GET(makeReq())
    const body = await res.json()
    expect(Array.isArray(body.data.agentKpis)).toBe(true)

    const a1 = body.data.agentKpis.find((a: any) => a.agentId === "a1")
    expect(a1).toBeDefined()
    expect(a1.name).toBe("Ali Hasanov")
    expect(a1.totalVisits).toBe(8)
    expect(a1.avgTimeInStore).toBe(18)
    // visitPlanFulfillment = round(8/10*100) = 80
    expect(a1.visitPlanFulfillment).toBe(80)

    const a2 = body.data.agentKpis.find((a: any) => a.agentId === "a2")
    expect(a2).toBeDefined()
    expect(a2.name).toBe("Nigar Mammadova")
    expect(a2.totalVisits).toBe(5)
    // a2 not in agentRouteStats → planFulfillment = 0
    expect(a2.visitPlanFulfillment).toBe(0)
  })

  it("returns empty agentKpis when no visit data", async () => {
    setupBaseMocks()
    // All groupBy calls return [] (from setupBaseMocks default)

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.agentKpis).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Excel export
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/mtm/analytics/export", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }) as never)
    const res = await EXPORT_GET(makeReq("?period=monthly"))
    expect(res.status).toBe(401)
  })

  it("returns xlsx with correct Content-Type and Content-Disposition", async () => {
    setupBaseMocks()

    // export route call order differs: no topAgentStats, direct per-agent queries
    vi.mocked(prisma.mtmVisit.groupBy)
      .mockResolvedValueOnce([   // agentVisitStats
        { agentId: "a1", _count: 8, _avg: { duration: 18 } },
      ] as any)

    vi.mocked(prisma.mtmRoute.groupBy).mockResolvedValue([
      { agentId: "a1", _sum: { totalPoints: 10, visitedPoints: 8 } },
    ] as any)

    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "a1", name: "Ali Hasanov" },
    ] as any)

    const res = await EXPORT_GET(makeReq("?period=monthly"))
    expect(res.status).toBe(200)

    const ct = res.headers.get("Content-Type")
    expect(ct).toContain("spreadsheetml")

    const cd = res.headers.get("Content-Disposition")
    expect(cd).toContain("analytics")
    expect(cd).toContain(".xlsx")

    const buf = await res.arrayBuffer()
    expect(buf.byteLength).toBeGreaterThan(100)
  })

  it("applies the same primary-owner scope to the legacy XLSX export", async () => {
    setupBaseMocks()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager-agent", role: "MANAGER", scopedAgentIds: ["agent-export"] })

    const res = await EXPORT_GET(makeReq("?period=yearly"))

    expect(res.status).toBe(200)
    expect(res.headers.get("X-MTM-Scope")).toBe("current-primary-owner")
    expect(vi.mocked(prisma.mtmVisit.count).mock.calls[0][0]?.where.agentId).toEqual({ in: ["agent-export"] })
    expect(vi.mocked(prisma.mtmRoute.aggregate).mock.calls[0][0]?.where.agentId).toEqual({ in: ["agent-export"] })
    expect(vi.mocked(prisma.mtmVisit.groupBy).mock.calls[0][0]?.where.agentId).toEqual({ in: ["agent-export"] })
  })

  it("filename includes the period and date", async () => {
    setupBaseMocks()
    vi.mocked(prisma.mtmVisit.groupBy).mockResolvedValue([])

    const res = await EXPORT_GET(makeReq("?period=weekly"))
    const cd = res.headers.get("Content-Disposition")
    expect(cd).toContain("Weekly")
  })
})
