/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Grouped alert list + bulk resolve (prod 2026-09-14).
 *
 * The office saw 31 identical English "Route deviation detected" cards for
 * one agent, no links, and April alerts still open. The grouped view and the
 * bulk resolve are pinned here; the auth scaffolding mirrors
 * api-mtm-field-scope-by-team.test.ts.
 *
 * Original scope notes:
 *
 * RLS separates tenants, not teams. The photo gallery and the alert list were
 * returning the whole company to every manager — and to a field agent's app
 * token — and any web user with MTM write could close or delete other teams'
 * alerts. These tests pin the scope each principal gets:
 *   - web admin → organization-wide;
 *   - manager/supervisor → rows of agents in their scope only;
 *   - field agent token → only themselves (and no alert review);
 *   - web user without an MTM card → MTM_FIELD_SCOPE_REQUIRED.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

vi.mock("@/lib/mtm-audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mtm-audit")>("@/lib/mtm-audit")
  return { ...actual, writeMtmAudit: vi.fn(() => Promise.resolve()) }
})


import { GET as ListAlerts } from "@/app/api/v1/mtm/alerts/route"
import { POST as BulkResolve } from "@/app/api/v1/mtm/alerts/resolve/route"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { prisma } from "@/lib/prisma"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const ORG = "org-1"
const MANAGER_SCOPE = ["mgr-1", "agent-1", "agent-2"]
const WEB = { orgId: ORG, email: "user@example.com", name: "User" }

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function bulk(body: unknown) {
  return BulkResolve(req("/api/v1/mtm/alerts/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), undefined as never)
}

function asWebAdmin() {
  vi.mocked(requireAuth).mockResolvedValue({ ...WEB, userId: "admin-user", role: "admin" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })
}

function asWebManager() {
  vi.mocked(requireAuth).mockResolvedValue({ ...WEB, userId: "manager-user", role: "manager" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "mgr-1", role: "MANAGER", scopedAgentIds: MANAGER_SCOPE })
}

function asWebManagerWithoutCard() {
  vi.mocked(requireAuth).mockResolvedValue({ ...WEB, userId: "manager-user", role: "manager" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)
}

function asAgentToken() {
  const mobile = {
    orgId: ORG,
    agentId: "agent-9",
    userId: "agent-user",
    role: "AGENT",
    email: "agent@example.com",
    name: "Agent",
    tenantCapabilities: { routeField: true, workforceHrm: true },
  }
  vi.mocked(getMobileAuth).mockReturnValue(mobile as never)
  vi.mocked(resolveMobileAuth).mockResolvedValue(mobile as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-9", role: "AGENT", scopedAgentIds: ["agent-9"] })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Route tests reuse user ids with different cards; never serve a memoized actor.
  resetMtmFieldScopeMemo()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({
    id: ORG,
    plan: "enterprise",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true, "route-field": true },
  } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "timezone", value: "Asia/Baku" }] as never)
  vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAlert.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmAlert.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmAlert.deleteMany).mockResolvedValue({ count: 1 } as never)
})

const deviation = (id: string, at: string, meters: number, extra: Record<string, unknown> = {}) => ({
  id, agentId: "agent-1", type: "OUT_OF_ZONE", category: "WARNING", title: "Route deviation detected", description: null,
  isResolved: false, createdAt: new Date(at), agent: { id: "agent-1", name: "Anar" },
  metadata: { routeId: "route-1", messageKey: "routeDeviation", messageParams: { deviationMeters: meters, thresholdMeters: 500 }, ...extra },
})

describe("GET /api/v1/mtm/alerts?view=groups", () => {
  it("collapses one agent's repeated deviations of a day into one group with span, count and farthest distance", async () => {
    asWebManager()
    vi.mocked(prisma.mtmAlert.findMany)
      .mockResolvedValueOnce([
        deviation("a3", "2026-09-14T14:38:00.000Z", 7_700),
        deviation("a2", "2026-09-14T14:10:00.000Z", 3_100),
        deviation("a1", "2026-09-14T13:41:00.000Z", 900, { visitId: "visit-7" }),
      ] as never)
      .mockResolvedValueOnce([] as never)

    const res = await ListAlerts(req("/api/v1/mtm/alerts?view=groups&date=2026-09-14"))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.groups).toHaveLength(1)
    const [group] = data.groups
    expect(group).toMatchObject({
      agentId: "agent-1", agentName: "Anar", count: 3, openCount: 3,
      firstAt: "2026-09-14T13:41:00.000Z", lastAt: "2026-09-14T14:38:00.000Z",
      message: { key: "routeDeviation", distanceMeters: 7_700 },
      visitId: "visit-7",
      openIds: ["a3", "a2", "a1"],
    })
    expect(group.historyHref).toContain("/mtm/map?mode=history")
    expect(group.historyHref).toContain("agentId=agent-1")
    expect(group.historyHref).toContain("date=2026-09-14")
    expect(group.items.map((item: any) => item.id)).toEqual(["a3", "a2", "a1"])
    expect(data.canResolve).toBe(true)
  })

  it("filters the tenant-local day, status, type, agent — inside the manager's scope", async () => {
    asWebManager()
    await ListAlerts(req("/api/v1/mtm/alerts?view=groups&date=2026-09-14&agentId=agent-2&type=OUT_OF_ZONE&status=resolved"))
    const dayWhere = (vi.mocked(prisma.mtmAlert.findMany).mock.calls[0][0] as any).where
    expect(dayWhere).toMatchObject({ organizationId: ORG, agentId: "agent-2", type: "OUT_OF_ZONE", isResolved: true })
    // Baku midnight → 20:00 UTC the day before.
    expect(dayWhere.createdAt.gte.toISOString()).toBe("2026-09-13T20:00:00.000Z")
    expect(dayWhere.createdAt.lt.toISOString()).toBe("2026-09-14T20:00:00.000Z")
  })

  it("scopes a manager without an agent filter to their agents and ignores unknown types", async () => {
    asWebManager()
    await ListAlerts(req("/api/v1/mtm/alerts?view=groups&type=DROP_TABLE"))
    const dayWhere = (vi.mocked(prisma.mtmAlert.findMany).mock.calls[0][0] as any).where
    expect(dayWhere.agentId).toEqual({ in: MANAGER_SCOPE })
    expect(dayWhere.type).toBeUndefined()
    expect(dayWhere.isResolved).toBe(false) // default: open
  })

  it("refuses a deep link to an agent outside the scope", async () => {
    asWebManager()
    const res = await ListAlerts(req("/api/v1/mtm/alerts?view=groups&agentId=agent-other"))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_AGENT_OUT_OF_SCOPE" })
    expect(prisma.mtmAlert.findMany).not.toHaveBeenCalled()
  })

  it("lists open alerts older than 7 days apart, without closing anything", async () => {
    asWebManager()
    vi.mocked(prisma.mtmAlert.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([deviation("old-1", "2026-04-02T09:00:00.000Z", 1_200)] as never)
    vi.mocked(prisma.mtmAlert.count).mockResolvedValueOnce(41)

    const { data } = await (await ListAlerts(req("/api/v1/mtm/alerts?view=groups&date=2026-09-14"))).json()
    const staleWhere = (vi.mocked(prisma.mtmAlert.findMany).mock.calls[1][0] as any).where
    expect(staleWhere.isResolved).toBe(false)
    expect(staleWhere.createdAt.lt).toBeInstanceOf(Date)
    expect(data.stale.total).toBe(41)
    expect(data.stale.groups[0]).toMatchObject({ dateKey: "2026-04-02", count: 1 })
    expect(prisma.mtmAlert.updateMany).not.toHaveBeenCalled()
  })

  it("tells an agent token it cannot resolve", async () => {
    asAgentToken()
    const { data } = await (await ListAlerts(req("/api/v1/mtm/alerts?view=groups", { headers: { authorization: "Bearer token" } }))).json()
    expect(data.canResolve).toBe(false)
  })

  it("answers a web user without a field card with the localizable code", async () => {
    asWebManagerWithoutCard()
    const res = await ListAlerts(req("/api/v1/mtm/alerts?view=groups"))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_FIELD_SCOPE_REQUIRED" })
  })
})

describe("POST /api/v1/mtm/alerts/resolve", () => {
  it("resolves a group's ids only within the manager's scope, with one audit row", async () => {
    asWebManager()
    vi.mocked(prisma.mtmAlert.updateMany).mockResolvedValue({ count: 2 } as never)
    const res = await bulk({ ids: ["a1", "a2", "foreign-3"] })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ data: { resolved: 2 } })
    const args = vi.mocked(prisma.mtmAlert.updateMany).mock.calls[0][0] as any
    expect(args.where).toEqual({
      organizationId: ORG, isResolved: false, agentId: { in: MANAGER_SCOPE }, id: { in: ["a1", "a2", "foreign-3"] },
    })
    expect(args.data).toMatchObject({ isResolved: true, resolvedBy: "manager-user" })
    expect(writeMtmAudit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeMtmAudit).mock.calls[0][0]).toMatchObject({ action: "ALERT_BULK_RESOLVE", newData: expect.objectContaining({ count: 2, mode: "ids" }) })
  })

  it("closes all stale open alerts of an in-scope agent", async () => {
    asWebManager()
    vi.mocked(prisma.mtmAlert.updateMany).mockResolvedValue({ count: 41 } as never)
    const res = await bulk({ stale: true, agentId: "agent-1", type: "OUT_OF_ZONE" })
    expect(res.status).toBe(200)
    const where = (vi.mocked(prisma.mtmAlert.updateMany).mock.calls[0][0] as any).where
    expect(where).toMatchObject({ organizationId: ORG, isResolved: false, agentId: "agent-1", type: "OUT_OF_ZONE" })
    expect(where.createdAt.lt).toBeInstanceOf(Date)
  })

  it("does not let a manager close another team's stale alerts", async () => {
    asWebManager()
    const res = await bulk({ stale: true, agentId: "agent-other" })
    expect(res.status).toBe(403)
    expect(prisma.mtmAlert.updateMany).not.toHaveBeenCalled()
  })

  it("does not let an agent token resolve", async () => {
    asAgentToken()
    const res = await BulkResolve(req("/api/v1/mtm/alerts/resolve", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer token" }, body: JSON.stringify({ ids: ["a1"] }),
    }), undefined as never)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_ALERT_REVIEW_FORBIDDEN" })
    expect(prisma.mtmAlert.updateMany).not.toHaveBeenCalled()
  })

  it("refuses a web user without a card and an empty or mixed body", async () => {
    asWebManagerWithoutCard()
    expect((await bulk({ ids: ["a1"] })).status).toBe(403)
    asWebAdmin()
    expect((await bulk({ ids: [] })).status).toBe(400)
    expect((await bulk({ ids: ["a1"], stale: true })).status).toBe(400)
    expect(prisma.mtmAlert.updateMany).not.toHaveBeenCalled()
  })
})
