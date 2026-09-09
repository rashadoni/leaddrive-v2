/**
 * Activity route (F-31 + F-32 + F-33) — regression net.
 *
 * Before: action filter mapped CHECK_IN → "VISIT_CHECK_IN" but writers
 * emit "CHECK_IN", so the type filter returned 0 rows. KPI counted by
 * mtmVisit.status — once a visit checked out, the CHECK_IN count
 * dropped to zero. Agent column showed "—" because findMany skipped
 * the now-existing agent relation.
 *
 * This file locks the contract:
 *   • KPI counts come from mtm_audit_logs by action (not mtmVisit.status)
 *   • Action filter maps to writer-emitted names (CHECK_IN, not VISIT_CHECK_IN)
 *   • findMany includes the agent relation so name resolves UI-side
 *   • type=TASK fans out into the full action set
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

import { GET } from "@/app/api/v1/mtm/activity/route"
import { MAX_PAGE_LIMIT } from "@/app/api/v1/mtm/activity/_constants"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const ORG = "org-1"
const AUTH = { orgId: ORG, userId: "manager-user", role: "manager", email: "manager@example.com", name: "Manager" }
const BOTH_PRODUCTS = {
  plan: "starter",
  addons: [],
  features: ["mtm", "workforce-hrm"],
  modules: { mtm: true, "workforce-hrm": true },
}

function makeReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
  // Default count to 0 unless a test overrides
  vi.mocked(prisma.mtmAuditLog.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([])
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(BOTH_PRODUCTS as never)
})

describe("GET /api/v1/mtm/activity", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }) as never)
    const res = await GET(makeReq("/api/v1/mtm/activity"))
    expect(res.status).toBe(401)
  })

  it("excludes Workforce audit facts from a Routes-only tenant", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...BOTH_PRODUCTS,
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)

    const response = await GET(makeReq("/api/v1/mtm/activity?period=all"))

    expect(response.status).toBe(200)
    const countWhere = (vi.mocked(prisma.mtmAuditLog.count).mock.calls[3][0] as any).where
    const listWhere = (vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any).where
    expect(countWhere.NOT.OR).toEqual(expect.arrayContaining([
      { entity: { in: ["workday", "hrm_request"] } },
      { metadataKind: { in: ["workday_transition", "hrm_request_decision"] } },
    ]))
    expect(listWhere.NOT).toEqual(countWhere.NOT)
  })

  it("rejects the Route activity surface when Route & Field is disabled", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...BOTH_PRODUCTS,
      features: ["workforce-hrm"],
      modules: { mtm: false, "workforce-hrm": true },
    } as never)

    const response = await GET(makeReq("/api/v1/mtm/activity"))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED", capabilityId: "route-field" })
    expect(prisma.mtmAuditLog.findMany).not.toHaveBeenCalled()
  })

  // ─── F-32: KPI from audit log, not from mtmVisit.status ────────────────
  describe("F-32 KPI counter — audit-log based", () => {
    it("counts CHECK_IN + CHECK_IN_FORCED under totalCheckIns", async () => {
      // 5 calls in order: check-ins, check-outs, photos, all-activities, violations
      vi.mocked(prisma.mtmAuditLog.count)
        .mockResolvedValueOnce(7) // totalCheckIns
        .mockResolvedValueOnce(5) // totalCheckOuts
        .mockResolvedValueOnce(2) // totalPhotos
        .mockResolvedValueOnce(20) // totalActivities
        .mockResolvedValueOnce(3) // totalViolations (forced check-ins + failed logins)

      const res = await GET(makeReq("/api/v1/mtm/activity"))
      const json = await res.json()
      expect(res.status).toBe(200)
      expect(json.data.kpi).toEqual({
        totalActivities: 20,
        totalCheckIns: 7,
        totalCheckOuts: 5,
        totalPhotos: 2,
        totalViolations: 3,
      })

      // Inspect: the FIRST count call must target CHECK_IN + CHECK_IN_FORCED
      const firstCall = vi.mocked(prisma.mtmAuditLog.count).mock.calls[0][0] as any
      expect(firstCall.where.action.in).toEqual(
        expect.arrayContaining(["CHECK_IN", "CHECK_IN_FORCED"])
      )
      // The forced variant must be present — that's the compliance signal.
      expect(firstCall.where.action.in).toContain("CHECK_IN_FORCED")
    })

    it("scopes all KPI counts to the period + organizationId", async () => {
      await GET(makeReq("/api/v1/mtm/activity"))
      const calls = vi.mocked(prisma.mtmAuditLog.count).mock.calls
      // 5 KPI counts (check-ins, check-outs, photos, all, violations), all scoped
      expect(calls).toHaveLength(5 + 1) // 5 KPI + 1 list-count
      for (const [arg] of calls.slice(0, 5)) {
        const where = (arg as any).where
        expect(where.organizationId).toBe(ORG)
        expect(where.createdAt.gte).toBeInstanceOf(Date)
      }
    })
  })

  // ─── F-31: action filter maps to writer-emitted names ──────────────────
  describe("F-31 type filter — writer-action mapping", () => {
    it("type=CHECK_IN → action in [CHECK_IN, CHECK_IN_FORCED] (not VISIT_CHECK_IN)", async () => {
      await GET(makeReq("/api/v1/mtm/activity?type=CHECK_IN"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      expect(findArgs.where.action.in).toEqual(["CHECK_IN", "CHECK_IN_FORCED"])
      // Regression guard: the OLD wrong key must NOT be present anywhere.
      expect(JSON.stringify(findArgs.where)).not.toContain("VISIT_CHECK_IN")
    })

    it("type=CHECK_OUT → action=CHECK_OUT (writer-aligned)", async () => {
      await GET(makeReq("/api/v1/mtm/activity?type=CHECK_OUT"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      expect(findArgs.where.action).toBe("CHECK_OUT")
      expect(JSON.stringify(findArgs.where)).not.toContain("VISIT_CHECK_OUT")
    })

    it("type=PHOTO → action=PHOTO_UPLOAD", async () => {
      await GET(makeReq("/api/v1/mtm/activity?type=PHOTO"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      expect(findArgs.where.action).toBe("PHOTO_UPLOAD")
    })

    it("type=TASK → all 4 lifecycle actions", async () => {
      await GET(makeReq("/api/v1/mtm/activity?type=TASK"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      expect(findArgs.where.action.in).toEqual(
        expect.arrayContaining(["TASK_CREATE", "TASK_UPDATE", "TASK_COMPLETE", "TASK_DELETE"])
      )
    })

    it("type=CHECK_IN_FORCED → action=CHECK_IN_FORCED only (compliance lens)", async () => {
      await GET(makeReq("/api/v1/mtm/activity?type=CHECK_IN_FORCED"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      // The forced-only filter must NOT include regular CHECK_IN — the
      // whole point is to isolate bypass events.
      expect(findArgs.where.action).toBe("CHECK_IN_FORCED")
    })

    it("no type → no action filter (returns everything in org)", async () => {
      await GET(makeReq("/api/v1/mtm/activity"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      expect(findArgs.where.action).toBeUndefined()
      expect(findArgs.where.organizationId).toBe(ORG)
    })

    it("unknown type → no action filter (defensive: not silent error)", async () => {
      await GET(makeReq("/api/v1/mtm/activity?type=BOGUS"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      expect(findArgs.where.action).toBeUndefined()
    })
  })

  // ─── F-33: agent relation included so UI shows the name ────────────────
  describe("F-33 agent JOIN — name resolves UI-side", () => {
    it("findMany includes the agent relation with id+name+avatar select", async () => {
      await GET(makeReq("/api/v1/mtm/activity"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      expect(findArgs.include).toEqual({
        agent: { select: { id: true, name: true, avatar: true } },
      })
    })

    it("returned logs carry agent.name when present (not '—')", async () => {
      vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([
        {
          id: "log-1",
          action: "CHECK_IN",
          entity: "visit",
          agentId: "agent-1",
          agent: { id: "agent-1", name: "Farid Aliyev" },
          createdAt: new Date(),
        } as any,
      ])
      vi.mocked(prisma.mtmAuditLog.count).mockResolvedValue(1)

      const res = await GET(makeReq("/api/v1/mtm/activity"))
      const json = await res.json()
      expect(json.data.logs[0].agent.name).toBe("Farid Aliyev")
    })
  })

  describe("pagination", () => {
    it("respects page + limit (50 default)", async () => {
      await GET(makeReq("/api/v1/mtm/activity?page=2&limit=25"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      expect(findArgs.skip).toBe(25)
      expect(findArgs.take).toBe(25)
    })

    it("caps limit at MAX_PAGE_LIMIT (no DOS via ?limit=10000)", async () => {
      // Pin to the exported constant so bumping the cap in route.ts also
      // updates the test in one place.
      expect(MAX_PAGE_LIMIT).toBeGreaterThan(0)
      await GET(makeReq("/api/v1/mtm/activity?limit=10000"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      expect(findArgs.take).toBe(MAX_PAGE_LIMIT)
    })

    it("orderBy createdAt desc — newest first in feed", async () => {
      await GET(makeReq("/api/v1/mtm/activity"))
      const findArgs = vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any
      expect(findArgs.orderBy).toEqual({ createdAt: "desc" })
    })
  })
})
