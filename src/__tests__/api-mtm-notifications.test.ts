/**
 * MtmNotification regression suite (F-09 — implement, not delete).
 *
 * Three things this file locks:
 *   1. The 4 notification endpoints (web GET/PATCH + mobile GET/PATCH)
 *      behave correctly on auth, filters, and bulk mark-as-read.
 *   2. notifyAgent fires at the two production write sites
 *      (visits POST out-of-zone, mobile/location route deviation).
 *   3. Multi-tenant scope is enforced everywhere — a notification belongs to
 *      one org+agent and PATCH cannot leak across tenants.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm-notify", () => ({
  notifyAgent: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/geo-utils", () => ({
  calculateDistance: vi.fn(() => 600), // > 100m default radius
  distanceToPolyline: vi.fn(() => 800), // > 500m deviation threshold
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async (s: string) => s),
}))

vi.mock("@/lib/mtm-settings", () => ({
  getMtmSettings: vi.fn(async () => ({
    deviationThresholdMeters: 500,
    deviationAlertThrottleMinutes: 10,
    // honest-settings: out-of-zone alerting is gated by this org toggle in
    // BOTH production call sites under test (visits POST + mobile/location).
    alertOutOfZone: true,
    alertLongBreak: true,
    geofenceRadius: 100,
    timezone: "Asia/Baku",
    gpsInterval: 30,
    photoRequired: false,
    maxPhotosPerVisit: 10,
  })),
}))

import { GET as WebNotifGet, PATCH as WebNotifPatch } from "@/app/api/v1/mtm/notifications/route"
import { GET as MobileNotifGet, PATCH as MobileNotifPatch } from "@/app/api/v1/mtm/mobile/notifications/route"
import { POST as CreateVisit } from "@/app/api/v1/mtm/visits/route"
import { POST as MobileLocationPost } from "@/app/api/v1/mtm/mobile/location/route"

import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { notifyAgent } from "@/lib/mtm-notify"

const ORG = "org-1"
const AGENT = "agent-cuid-1"
const BOTH_PRODUCTS = {
  plan: "starter",
  addons: [],
  features: ["mtm", "workforce-hrm"],
  modules: { mtm: true, "workforce-hrm": true },
}
const MOBILE_AUTH = {
  orgId: ORG,
  agentId: AGENT,
  role: "AGENT",
  tenantCapabilities: { routeField: true, workforceHrm: true },
}

function sqlText(value: unknown): string {
  if (Array.isArray(value)) return value.map(sqlText).join(" ")
  if (value && typeof value === "object" && "strings" in value) {
    const sql = value as { strings: string[]; values?: unknown[] }
    return `${sql.strings.join(" ")} ${(sql.values ?? []).map(sqlText).join(" ")}`
  }
  return ["string", "number", "boolean"].includes(typeof value) ? String(value) : ""
}

function jsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function getReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    role: "admin",
    userId: "admin-user",
    email: "admin@example.com",
    name: "Admin",
  } as never)
  vi.mocked(notifyAgent).mockResolvedValue(undefined as any)
  vi.mocked(resolveMobileAuth).mockResolvedValue(MOBILE_AUTH as any)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(BOTH_PRODUCTS as never)
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
    id: "workday-active",
    status: "STARTED",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: null,
  } as never)
})

// ═══════════════════════════════════════════════════════════════════════════
// WEB: GET /api/v1/mtm/notifications — supervisor/admin view
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/mtm/notifications (web)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await WebNotifGet(getReq("/api/v1/mtm/notifications"))
    expect(res.status).toBe(401)
  })

  it("returns items + unread count scoped to org", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: "n1" }])
      .mockResolvedValueOnce([{ count: 1 }])
    vi.mocked(prisma.mtmNotification.findMany).mockResolvedValue([
      { id: "n1", title: "Out of zone", isRead: false } as any,
    ])

    const res = await WebNotifGet(getReq("/api/v1/mtm/notifications"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.items).toHaveLength(1)
    expect(json.data.unread).toBe(1)

    const listQuery = sqlText(vi.mocked(prisma.$queryRaw).mock.calls[0])
    expect(listQuery).toContain(ORG)
    const findArgs = vi.mocked(prisma.mtmNotification.findMany).mock.calls[0][0] as any
    expect(findArgs.where).toMatchObject({ organizationId: ORG, id: { in: ["n1"] } })
  })

  it("filters by agentId and unreadOnly", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }])

    await WebNotifGet(getReq(`/api/v1/mtm/notifications?agentId=${AGENT}&unreadOnly=true&limit=10`))

    const query = sqlText(vi.mocked(prisma.$queryRaw).mock.calls[0])
    expect(query).toContain(AGENT)
    expect(query).toContain("FALSE")
    expect(query).toContain("10")
  })

  it("excludes Workforce notifications for a Routes-only web tenant", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...BOTH_PRODUCTS,
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }])

    const response = await WebNotifGet(getReq("/api/v1/mtm/notifications"))

    expect(response.status).toBe(200)
    const query = sqlText(vi.mocked(prisma.$queryRaw).mock.calls[0])
    expect(query).toContain("domain")
    expect(query).toContain("route")
    expect(query).toContain("hrmRequestId")
  })

  it("returns 500 on prisma error (not silent-success)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("DB down"))
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await WebNotifGet(getReq("/api/v1/mtm/notifications"))
    expect(res.status).toBe(500)
    errSpy.mockRestore()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// WEB: PATCH /api/v1/mtm/notifications — mark read/unread
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/v1/mtm/notifications (web)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await WebNotifPatch(jsonReq("/api/v1/mtm/notifications", "PATCH", { ids: ["n1"], isRead: true }))
    expect(res.status).toBe(401)
  })

  it("marks specific ids as read scoped to org", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(2)

    const res = await WebNotifPatch(
      jsonReq("/api/v1/mtm/notifications", "PATCH", { ids: ["n1", "n2"], isRead: true })
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.updated).toBe(2)

    const query = sqlText(vi.mocked(prisma.$executeRaw).mock.calls[0])
    expect(query).toContain("n1")
    expect(query).toContain("n2")
    expect(query).toContain(ORG)
    expect(query).toContain("true")
  })

  it("marks all unread as read with all:true", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(15)

    const res = await WebNotifPatch(jsonReq("/api/v1/mtm/notifications", "PATCH", { all: true, isRead: true }))
    const json = await res.json()
    expect(json.data.updated).toBe(15)

    const query = sqlText(vi.mocked(prisma.$executeRaw).mock.calls[0])
    expect(query).toContain("false")
    expect(query).toContain(ORG)
  })

  it("cannot mark a Workforce notification through a Routes-only web inbox", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...BOTH_PRODUCTS,
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0)

    await WebNotifPatch(jsonReq("/api/v1/mtm/notifications", "PATCH", { ids: ["workforce-n1"], isRead: true }))

    const query = sqlText(vi.mocked(prisma.$executeRaw).mock.calls[0])
    expect(query).toContain("route")
    expect(query).toContain("hrmRequestId")
  })

  it("returns 400 when neither ids nor all is provided", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const res = await WebNotifPatch(jsonReq("/api/v1/mtm/notifications", "PATCH", { isRead: true }))
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MOBILE: GET /api/v1/mtm/mobile/notifications — agent-scoped
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/mtm/mobile/notifications (agent)", () => {
  it("returns 401 when JWT missing/invalid", async () => {
    // withMobileRls treats a null resolveMobileAuth result as unauthenticated → 401.
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as any)
    const res = await MobileNotifGet(getReq("/api/v1/mtm/mobile/notifications"))
    expect(res.status).toBe(401)
  })

  it("returns only the calling agent's notifications", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([
      { id: "n-mine", agentId: AGENT, title: "Route deviation" } as any,
      ])
      .mockResolvedValueOnce([{ count: 1 }])

    const res = await MobileNotifGet(getReq("/api/v1/mtm/mobile/notifications"))
    const json = await res.json()
    expect(json.data.items[0].id).toBe("n-mine")
    expect(json.data.unread).toBe(1)

    const findArgs = vi.mocked(prisma.$queryRaw).mock.calls[0]
    const query = sqlText(findArgs)
    // Critical: agent can ONLY see their own notifications, not org-wide.
    expect(query).toContain(AGENT)
    expect(query).toContain(ORG)
  })

  it("keeps Routes-only notifications isolated from Workforce metadata", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...MOBILE_AUTH,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as any)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }])

    const response = await MobileNotifGet(getReq("/api/v1/mtm/mobile/notifications"))

    expect(response.status).toBe(200)
    const query = sqlText(vi.mocked(prisma.$queryRaw).mock.calls[0])
    expect(query).toContain("NOT")
    expect(query).toContain("hrmRequestId")
  })

  it("returns only Workforce notifications to a Workforce-only tenant", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...MOBILE_AUTH,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    } as any)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }])

    const response = await MobileNotifGet(getReq("/api/v1/mtm/mobile/notifications"))

    expect(response.status).toBe(200)
    const query = sqlText(vi.mocked(prisma.$queryRaw).mock.calls[0])
    expect(query).toContain("NOT")
    expect(query).toContain("hrmRequestId")
    expect(query).toContain("routeIds")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MOBILE: PATCH /api/v1/mtm/mobile/notifications
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/v1/mtm/mobile/notifications (agent)", () => {
  beforeEach(() => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(MOBILE_AUTH as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1)
  })

  it("marks specific ids as read with strict agent scope", async () => {
    await MobileNotifPatch(
      jsonReq("/api/v1/mtm/mobile/notifications", "PATCH", { ids: ["n1"], isRead: true })
    )
    const query = sqlText(vi.mocked(prisma.$executeRaw).mock.calls[0])
    expect(query).toContain("n1")
    expect(query).toContain(AGENT)
    expect(query).toContain(ORG)
  })

  it("marks all unread as read with all:true scoped to the agent", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(7)

    const res = await MobileNotifPatch(
      jsonReq("/api/v1/mtm/mobile/notifications", "PATCH", { all: true, isRead: true })
    )
    const json = await res.json()
    expect(json.data.updated).toBe(7)

    const query = sqlText(vi.mocked(prisma.$executeRaw).mock.calls[0])
    expect(query).toContain("false") // only currently-unread rows
    expect(query).toContain(AGENT)
  })

  it("returns 400 when neither ids nor all provided", async () => {
    const res = await MobileNotifPatch(
      jsonReq("/api/v1/mtm/mobile/notifications", "PATCH", { isRead: true })
    )
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// notifyAgent call sites — the model is only useful if writes happen
// ═══════════════════════════════════════════════════════════════════════════

describe("notifyAgent: production call sites", () => {
  it("fires from POST /visits when an out-of-zone check-in is forced", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    // Fresh web actor is ADMIN; this is the active target used by both the
    // reference gate and the visit-policy snapshot.
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT, role: "SUPERVISOR", teamId: null } as any)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "cust-1",
      name: "Distant Shop",
      category: "B",
      objectType: "OTHER",
      latitude: 40.41,
      longitude: 49.87,
      geofenceRadius: null,
    } as any)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "cust-1" }] as any)
    vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue(null) // use 100m default
    vi.mocked(prisma.mtmAlert.create).mockResolvedValue({} as any)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({ id: "v1" } as any)
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmVisitRequirementSnapshot.create).mockResolvedValue({ id: "snapshot-1" } as any)

    await CreateVisit(
      jsonReq("/api/v1/mtm/visits", "POST", {
        agentId: AGENT,
        customerId: "cust-1",
        latitude: 40.5,
        longitude: 49.9,
        force: true,
      })
    )

    expect(notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        agentId: AGENT,
        type: "warning",
        title: "Out of zone check-in",
        metadata: expect.objectContaining({
          customerId: "cust-1",
          distanceMeters: 600,
          geofenceRadius: 100,
        }),
      })
    )
    // Body should be a human-readable string mentioning the distance + customer.
    const call = vi.mocked(notifyAgent).mock.calls[0][0]
    expect(call.body).toContain("Distant Shop")
    expect(call.body).toContain("600m")
  })

  it("fires from POST /mobile/location when an agent deviates from the planned route", async () => {
    vi.mocked(resolveMobileAuth).mockReturnValue(MOBILE_AUTH as any)
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({} as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "r1",
      points: [
        { customer: { latitude: 40.4, longitude: 49.8, name: "A" } },
        { customer: { latitude: 40.5, longitude: 49.9, name: "B" } },
      ],
    } as any)
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue(null) // no throttle hit
    vi.mocked(prisma.mtmAlert.create).mockResolvedValue({} as any)

    await MobileLocationPost(
      jsonReq("/api/v1/mtm/mobile/location", "POST", { latitude: 40.6, longitude: 50.0 })
    )

    expect(notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        agentId: AGENT,
        type: "warning",
        title: "Route deviation",
        metadata: expect.objectContaining({ routeId: "r1", deviationMeters: 800 }),
      })
    )
  })

  it("does NOT fire when the only other stop is a pre-migration Null Island customer", async () => {
    // (0, 0) as a corridor vertex runs the planned line from Baku to the Gulf
    // of Guinea, so the agent standing at the door reads as 800 m off route.
    // With that stop dropped, one usable vertex is left and no corridor
    // exists to deviate from (field UX audit A1).
    vi.mocked(resolveMobileAuth).mockReturnValue(MOBILE_AUTH as any)
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({} as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "r1",
      points: [
        { customer: { latitude: 40.4, longitude: 49.8, name: "A" } },
        { customer: { latitude: 0, longitude: 0, name: "Legacy" } },
      ],
    } as any)
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAlert.create).mockResolvedValue({} as any)

    await MobileLocationPost(
      jsonReq("/api/v1/mtm/mobile/location", "POST", { latitude: 40.6, longitude: 50.0 })
    )

    expect(notifyAgent).not.toHaveBeenCalled()
    expect(prisma.mtmAlert.create).not.toHaveBeenCalled()
  })

  it("does NOT fire when a recent throttle alert exists (mobile/location)", async () => {
    vi.mocked(resolveMobileAuth).mockReturnValue(MOBILE_AUTH as any)
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({} as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "r1",
      points: [
        { customer: { latitude: 40.4, longitude: 49.8, name: "A" } },
        { customer: { latitude: 40.5, longitude: 49.9, name: "B" } },
      ],
    } as any)
    // A recent alert exists — throttle should suppress both alert + notification
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue({ id: "al-recent" } as any)

    await MobileLocationPost(
      jsonReq("/api/v1/mtm/mobile/location", "POST", { latitude: 40.6, longitude: 50.0 })
    )

    // Belt-and-suspenders: prove the handler actually reached the throttle
    // branch (i.e. didn't short-circuit on an earlier error that would also
    // satisfy "create not called"). If findFirst is never reached, this test
    // is asserting on the wrong invariant.
    expect(prisma.mtmAlert.findFirst).toHaveBeenCalledTimes(1)
    expect(notifyAgent).not.toHaveBeenCalled()
    expect(prisma.mtmAlert.create).not.toHaveBeenCalled()
  })
})
