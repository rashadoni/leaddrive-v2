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
import { activityPeriodStart, MAX_PAGE_LIMIT, VIEWER_READ_ACTION_SUFFIXES } from "@/app/api/v1/mtm/activity/_constants"
import { prisma } from "@/lib/prisma"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"
import { requireAuth } from "@/lib/api-auth"

const ORG = "org-1"
// The contract tests below run as a web admin (organization-wide scope); the
// "field scope" block at the end pins what a manager and others see.
const AUTH = { orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }
const MANAGER_AUTH = { orgId: ORG, userId: "manager-user", role: "manager", email: "manager@example.com", name: "Manager" }

/** A web manager whose MTM card is a MANAGER with one direct report, agent-1. */
function linkManagerCard() {
  vi.mocked(requireAuth).mockResolvedValue(MANAGER_AUTH as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: "mgr-1", role: "MANAGER", canPlanOwnRoutes: true, canSelfPublishRoutes: false,
  } as never)
  vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue({ id: "mgr-1", teamId: null } as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValueOnce([{ id: "agent-1" }] as never)
}
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
  // Route tests reuse user ids with different cards; never serve a memoized actor.
  resetMtmFieldScopeMemo()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
  // Default count to 0 unless a test overrides
  vi.mocked(prisma.mtmAuditLog.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([])
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(BOTH_PRODUCTS as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)
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

  describe("field scope (audit 2026-09-14)", () => {
    it("limits a manager's feed and every counter to their agents", async () => {
      linkManagerCard()
      const res = await GET(makeReq("/api/v1/mtm/activity?period=all"))
      expect(res.status).toBe(200)
      const scoped = { in: ["agent-1", "mgr-1"] }
      for (const [arg] of vi.mocked(prisma.mtmAuditLog.count).mock.calls) {
        expect((arg as any).where.agentId).toEqual(scoped)
      }
      expect((vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any).where.agentId).toEqual(scoped)
    })

    it("accepts an agent filter inside the scope", async () => {
      linkManagerCard()
      const res = await GET(makeReq("/api/v1/mtm/activity?agentId=agent-1"))
      expect(res.status).toBe(200)
      expect((vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any).where.agentId).toBe("agent-1")
    })

    it("rejects an agent of another team", async () => {
      linkManagerCard()
      const res = await GET(makeReq("/api/v1/mtm/activity?agentId=agent-other-team"))
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: "MTM_AGENT_OUT_OF_SCOPE" })
      expect(prisma.mtmAuditLog.findMany).not.toHaveBeenCalled()
    })

    it("refuses a web manager without an MTM card instead of showing the company", async () => {
      vi.mocked(requireAuth).mockResolvedValue(MANAGER_AUTH as never)
      const res = await GET(makeReq("/api/v1/mtm/activity"))
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: "MTM_FIELD_SCOPE_REQUIRED" })
      expect(prisma.mtmAuditLog.count).not.toHaveBeenCalled()
    })

    it("keeps the admin feed organization-wide", async () => {
      await GET(makeReq("/api/v1/mtm/activity"))
      expect((vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any).where.agentId).toBeUndefined()
      expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    })
  })
})

// ─── Prod 2026-09-14: a feed an office manager can read ──────────────────────
describe("GET /api/v1/mtm/activity — manager feed (2026-09-14)", () => {
  it("excludes viewer read events (*_READ, *_VIEW) from the feed and every counter", async () => {
    await GET(makeReq("/api/v1/mtm/activity?period=7d"))
    const wheres = [
      ...vi.mocked(prisma.mtmAuditLog.count).mock.calls.map(([arg]) => (arg as any).where),
      (vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any).where,
    ]
    for (const where of wheres) {
      expect(where.AND).toEqual(expect.arrayContaining([
        { NOT: { action: { endsWith: "_READ" } } },
        { NOT: { action: { endsWith: "_VIEW" } } },
        { action: { notIn: ["ROUTE_TRAVEL_PREVIEW"] } },
      ]))
    }
    // GPS_HISTORY_VIEW and WEEK_GPS_LATEST_READ — the two names seen on prod.
    const excluded = (action: string) => VIEWER_READ_ACTION_SUFFIXES.some((suffix) => action.endsWith(suffix))
    expect(excluded("GPS_HISTORY_VIEW")).toBe(true)
    expect(excluded("WEEK_GPS_LATEST_READ")).toBe(true)
    expect(excluded("CHECK_IN")).toBe(false)
    expect(excluded("PHOTO_REVIEW")).toBe(false)
  })

  it("starts 'today' at the organization's midnight, not the server's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      // 00:30 on 15 September in Baku (UTC+4) is still 14 September in UTC.
      vi.setSystemTime(new Date("2026-09-14T20:30:00.000Z"))
      vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "timezone", value: "Asia/Baku" }] as never)
      await GET(makeReq("/api/v1/mtm/activity?period=today"))
      const where = (vi.mocked(prisma.mtmAuditLog.count).mock.calls[0][0] as any).where
      expect(where.createdAt.gte.toISOString()).toBe("2026-09-14T20:00:00.000Z")
    } finally {
      vi.useRealTimers()
      vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([] as never)
    }
  })

  it("activityPeriodStart covers 7 and 30 local days and 'all'", () => {
    const now = new Date("2026-09-14T10:00:00.000Z")
    expect(activityPeriodStart("7d", now, "Asia/Baku")?.toISOString()).toBe("2026-09-07T20:00:00.000Z")
    expect(activityPeriodStart("30d", now, "Asia/Baku")?.toISOString()).toBe("2026-08-15T20:00:00.000Z")
    expect(activityPeriodStart("all", now, "Asia/Baku")).toBeNull()
  })

  it("names the customer and links the visit/route on each row", async () => {
    vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([
      { id: "l1", action: "CHECK_IN", entity: "visit", entityId: "v-1", newData: { customerName: "Aptek 24", routeId: "r-1" }, createdAt: new Date() },
      { id: "l2", action: "CHECK_OUT", entity: "visit", entityId: "v-2", newData: { duration: 12 }, createdAt: new Date() },
      { id: "l3", action: "CHECK_IN", entity: "visit", entityId: "v-3", newData: { customerId: "c-3" }, createdAt: new Date() },
      { id: "l4", action: "ROUTE_COMPLETE", entity: "route", entityId: "r-9", newData: {}, createdAt: new Date() },
    ] as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "c-3", name: "Klinika" }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{ id: "v-2", customer: { name: "Zeytun" } }] as never)

    const json = await (await GET(makeReq("/api/v1/mtm/activity"))).json()

    expect(json.data.logs.map((log: any) => log.subject)).toEqual([
      { customerName: "Aptek 24", visitId: "v-1", routeId: "r-1" },
      { customerName: "Zeytun", visitId: "v-2", routeId: null },
      { customerName: "Klinika", visitId: "v-3", routeId: null },
      { customerName: null, visitId: null, routeId: "r-9" },
    ])
    expect((vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any).where.organizationId).toBe(ORG)
    expect((vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any).where.organizationId).toBe(ORG)
    expect(json.data.timezone).toBe("Asia/Baku")
  })

  it("type=ROUTE filters route start/completion", async () => {
    await GET(makeReq("/api/v1/mtm/activity?type=ROUTE"))
    expect((vi.mocked(prisma.mtmAuditLog.findMany).mock.calls[0][0] as any).where.action).toEqual({ in: ["ROUTE_START", "ROUTE_COMPLETE"] })
  })
})
