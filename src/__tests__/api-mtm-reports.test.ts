/**
 * Tests for GET /api/v1/mtm/reports — redesigned supervisor reports (#293):
 * overview counts + per-type summary / daily series / paginated reportData.
 *
 * Route file: src/app/api/v1/mtm/reports/route.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

import { GET } from "@/app/api/v1/mtm/reports/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const ORG = "org-1"
const AUTH = { orgId: ORG, userId: "manager-user", role: "manager", email: "manager@example.com", name: "Manager" }

function makeReq(qs = ""): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/v1/mtm/reports${qs}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
  // Freeze the clock mid-day: the route buckets series by its own new Date(),
  // so a real clock crossing local midnight between test setup and the
  // request would shift mocked rows into yesterday's bucket (flaky).
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-08T12:00:00") })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/v1/mtm/reports", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }) as never)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it("overview (no type): returns the 4 card counts, null detail sections", async () => {
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(4)
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(7)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(21)
    vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(13)

    const res = await GET(makeReq("?period=week"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.counts).toEqual({ agent: 4, route: 7, visit: 21, photo: 13 })
    expect(json.data.summary).toBeNull()
    expect(json.data.series).toBeNull()
    expect(json.data.reportData).toBeNull()
    expect(json.data.period).toBe("week")
    expect(json.data.type).toBe("")

    // agent card counts only ACTIVE agents
    const agentCountArgs = vi.mocked(prisma.mtmAgent.count).mock.calls[0][0] as any
    expect(agentCountArgs.where).toEqual({ organizationId: ORG, status: "ACTIVE" })
  })

  it("type=visit: builds summary (completion rate, avg duration), series and rows", async () => {
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(2)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(10)

    vi.mocked(prisma.mtmVisit.groupBy).mockResolvedValue([
      { status: "CHECKED_OUT", _count: { _all: 6 } },
      { status: "CHECKED_IN", _count: { _all: 4 } },
    ] as any)
    vi.mocked(prisma.mtmVisit.aggregate).mockResolvedValue({ _avg: { duration: 32.4 } } as any)
    const today = new Date()
    // 1st findMany = dates/agents for series, 2nd = page rows
    vi.mocked(prisma.mtmVisit.findMany)
      .mockResolvedValueOnce([
        { createdAt: today, agentId: "agent-1" },
        { createdAt: today, agentId: "agent-2" },
        { createdAt: today, agentId: "agent-1" },
      ] as any)
      .mockResolvedValueOnce([
        {
          id: "visit-1", createdAt: today, status: "CHECKED_OUT", duration: 30,
          agent: { name: "Ali" }, customer: { name: "Store A" },
        },
      ] as any)

    const res = await GET(makeReq("?type=visit&period=week"))
    expect(res.status).toBe(200)
    const json = await res.json()

    const summary = Object.fromEntries(json.data.summary.map((s: any) => [s.labelKey, s.value]))
    expect(summary["sum.total"]).toBe(10)
    expect(summary["sum.completed"]).toBe(6)
    expect(summary["sum.completionRate"]).toBe(60)
    expect(summary["sum.avgDuration"]).toBe(32)
    expect(summary["sum.uniqueAgents"]).toBe(2)

    // continuous daily series over the 7-day period, today's bucket = 3
    expect(json.data.series.length).toBeGreaterThanOrEqual(7)
    expect(json.data.series[json.data.series.length - 1].count).toBe(3)

    expect(json.data.reportData).toEqual([
      expect.objectContaining({ id: "visit-1", agent: "Ali", customer: "Store A", status: "CHECKED_OUT", duration: 30 }),
    ])
    expect(json.data.total).toBe(10)
  })

  it("type=agent: per-agent visit/task/photo counts and top performer", async () => {
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(2)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Ali", role: "AGENT" },
      { id: "agent-2", name: "Vali", role: "AGENT" },
    ] as any)
    // per-agent visit counts: agent-1 → 5, agent-2 → 1 (mtmVisit.count is
    // also called once for the overview card BEFORE the per-agent calls);
    // task/photo counts and the series findMany ride the factory defaults (0/[])
    vi.mocked(prisma.mtmVisit.count)
      .mockResolvedValueOnce(6) // overview card
      .mockResolvedValueOnce(5) // agent-1
      .mockResolvedValueOnce(1) // agent-2

    const res = await GET(makeReq("?type=agent"))
    const json = await res.json()

    expect(json.data.reportData).toHaveLength(2)
    expect(json.data.reportData[0]).toMatchObject({ id: "agent-1", name: "Ali", visits: 5 })

    const summary = Object.fromEntries(json.data.summary.map((s: any) => [s.labelKey, s.value]))
    expect(summary["sum.activeAgents"]).toBe(2)
    expect(summary["sum.avgPerAgent"]).toBe(3) // (5+1)/2
    expect(summary["sum.topPerformer"]).toBe("Ali")
  })

  it("clamps limit to 100 and floors page to 1", async () => {
    // all counts ride the factory default (count → 0)
    const res = await GET(makeReq("?limit=999&page=-5"))
    const json = await res.json()
    expect(json.data.limit).toBe(100)
    expect(json.data.page).toBe(1)
  })

  it("returns 500 when a query fails", async () => {
    vi.mocked(prisma.mtmAgent.count).mockRejectedValue(new Error("db down"))
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
    const json = await res.json()
    // NOTE: the route currently passes e.message through to the client —
    // pre-existing behavior, deliberately not pinned here so a later
    // sanitization pass doesn't break this test.
    expect(json.error).toBeTruthy()
  })
})
