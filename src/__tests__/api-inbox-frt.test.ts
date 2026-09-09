import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * /frt is fully SQL-aggregated since slice 3 (cap removed): one $queryRaw for FRT+SLA+buckets,
 * one for backlog aging (with the SANE_MIN_DATE hygiene exclusion). These tests mock the two raw
 * calls in order and assert the response shaping + org guard.
 */
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn() } }))
vi.mock("@/lib/api-auth", () => {
  const getOrgId = vi.fn()
  return {
    getOrgId,
    getSession: vi.fn().mockResolvedValue(null),
    requireAuth: vi.fn(async (req: NextRequest) => {
      const orgId = await getOrgId(req)
      return orgId
        ? { orgId, userId: "support-1", role: "support", email: "", name: "" }
        : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: (value: unknown) => value instanceof Response,
  }
})

import { GET } from "@/app/api/v1/inbox/analytics/frt/route"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const fn = (x: unknown) => x as ReturnType<typeof vi.fn>

const FRT_ROW = {
  conversations: 3, answered: 2, median_min: 15, avg_min: 15, sla_met: 2,
  b1: 1, b2: 1, b3: 0, b4: 0, b5: 0,
}
const AGING_ROW = { a1: 1, a2: 0, a3: 0, a4: 2, total: 3, oldest_h: 30.25, excluded: 1 }

describe("GET /api/v1/inbox/analytics/frt (SQL-aggregated)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401 without an org — and runs no query", async () => {
    fn(getOrgId).mockResolvedValue(null)
    expect((await GET(new NextRequest("http://localhost/x"))).status).toBe(401)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("shapes the FRT aggregate + SLA + aging (incl. bad-date exclusion count)", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.$queryRaw)
      .mockResolvedValueOnce([FRT_ROW])    // FRT CTE aggregate
      .mockResolvedValueOnce([AGING_ROW])  // aging aggregate
    const res = await GET(new NextRequest("http://localhost/api/v1/inbox/analytics/frt"))
    expect(res.status).toBe(200)
    const d = (await res.json()).data
    expect(d).toMatchObject({
      conversations: 3, answered: 2, unanswered: 1, medianMinutes: 15, avgMinutes: 15,
    })
    expect(d.sla).toMatchObject({ threshold: 30, slaMetPct: 100, answered: 2 })
    expect(d.sla.distribution.map((b: { count: number }) => b.count)).toEqual([1, 1, 0, 0, 0])
    expect(d.aging).toMatchObject({ total: 3, oldestHours: 30.3, excludedBadDates: 1 })
    expect(d.aging.buckets.map((b: { count: number }) => b.count)).toEqual([1, 0, 0, 2])
    // no cap fields anymore — the computation is unbounded
    expect(d.cap).toBeUndefined()
    expect(d.capped).toBeUndefined()
  })

  it("empty result sets fold to zeros (no crash)", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.$queryRaw).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await GET(new NextRequest("http://localhost/api/v1/inbox/analytics/frt"))
    const d = (await res.json()).data
    expect(d).toMatchObject({ conversations: 0, answered: 0, unanswered: 0, medianMinutes: null })
    expect(d.aging.total).toBe(0)
    expect(d.aging.oldestHours).toBeNull()
  })

  it("clamps ?sla= into 1..1440 and echoes it in the payload", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.$queryRaw).mockResolvedValueOnce([FRT_ROW]).mockResolvedValueOnce([AGING_ROW])
    const res = await GET(new NextRequest("http://localhost/api/v1/inbox/analytics/frt?sla=99999"))
    expect((await res.json()).data.sla.threshold).toBe(1440)
  })
})
