/**
 * Integration tests for MTM Mobile Sync endpoints (M2-1b)
 *
 * Routes covered:
 *   GET  /api/v1/mtm/mobile/sync/pull
 *   POST /api/v1/mtm/mobile/sync/push
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm/mobile-sync-telemetry", () => ({
  recordMtmMobileV1SyncActivity: vi.fn(),
}))
vi.mock("@/lib/workforce/mobile-write-fence", () => ({
  evaluateWorkforceMobileWriteAccess: vi.fn(),
}))

import { GET as PullGET } from "@/app/api/v1/mtm/mobile/sync/pull/route"
import { POST as PushPOST } from "@/app/api/v1/mtm/mobile/sync/push/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { recordMtmMobileV1SyncActivity } from "@/lib/mtm/mobile-sync-telemetry"
import { evaluateWorkforceMobileWriteAccess } from "@/lib/workforce/mobile-write-fence"
import { mtmWorkdayRequestHash, parseMtmWorkdayEvent } from "@/lib/mtm/workday"

const ORG = "org-1"
const AGENT_ID = "agent-1"

const AUTH_CONTEXT = {
  orgId: ORG,
  agentId: AGENT_ID,
  role: "AGENT",
  tenantCapabilities: { routeField: true, workforceHrm: true },
}

function makePullReq(qs = ""): NextRequest {
  return new NextRequest(
    new URL(`http://localhost:3000/api/v1/mtm/mobile/sync/pull${qs}`),
    { headers: { Authorization: "Bearer valid-token" } },
  )
}

function makePushReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    new URL("http://localhost:3000/api/v1/mtm/mobile/sync/push"),
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token", ...headers },
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: authenticated
  vi.mocked(resolveMobileAuth).mockReturnValue(AUTH_CONTEXT as any)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({
    id: ORG,
    plan: "enterprise",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true },
  } as never)
  // Default: all entity queries return empty arrays
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT_ID, teamId: null } as never)
  // Since audit A6 a customer without coordinates is a check-in conflict, so
  // the default fixture carries a real pair; the dedicated case clears it.
  vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "cust-1", category: "B", objectType: "OTHER", latitude: 40.4, longitude: 49.8, geofenceRadius: null } as never)
  vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmVisitPolicy.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCustomerAgentAssignment.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContactAgentAssignment.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAlert.create).mockResolvedValue({ id: "alert-1" } as never)
  vi.mocked(prisma.mtmVisitRequirementSnapshot.create).mockResolvedValue({ id: "snapshot-1", requirements: [] } as never)
  vi.mocked(prisma.mtmDoctorScoringFormula.findFirst).mockResolvedValue({
    id: "formula-1",
    version: "2026.1",
    definitionHash: "a".repeat(64),
    glossarySchemaVersion: 1,
    approvalReference: "SWM-CAB-041",
    sourceSystem: "SwissMed approved master data",
    sourceReference: "SWM-04/2026.1",
    sourceObservedAt: new Date("2026-07-01T09:00:00.000Z"),
  } as never)
  // Re-assert defaults each test: non-Once per-test overrides survive
  // vi.clearAllMocks(), so without these a mockResolvedValue set in one test
  // would leak into every test after it (ordering-dependent results).
  vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmSyncOperation.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmSyncOperation.create).mockResolvedValue({} as any)
  vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue(null)
  vi.mocked(evaluateWorkforceMobileWriteAccess).mockResolvedValue({
    allowed: true,
    mode: "LEGACY_ALLOWED",
    deviceId: null,
    cohortEpoch: null,
  } as never)
})

// ─── GET /api/v1/mtm/mobile/sync/pull ────────────────────────────────────────

describe("GET /api/v1/mtm/mobile/sync/pull", () => {
  it("returns 401 when not authenticated", async () => {
    // withMobileRls treats a null resolveMobileAuth result as unauthenticated → 401.
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as any)
    const res = await PullGET(makePullReq())
    expect(res.status).toBe(401)
    expect(recordMtmMobileV1SyncActivity).not.toHaveBeenCalled()
  })

  it("records authenticated v1 pull activity before validation without trusting the APK header", async () => {
    const request = new NextRequest("http://localhost:3000/api/v1/mtm/mobile/sync/pull?since=not-a-date", {
      headers: { Authorization: "Bearer valid-token", "x-field-apk-version": "2.3.1+101" },
    })

    expect((await PullGET(request)).status).toBe(400)
    expect(recordMtmMobileV1SyncActivity).toHaveBeenCalledWith({
      organizationId: ORG,
      agentId: AGENT_ID,
      apkVersion: "2.3.1+101",
      endpoint: "GET /api/v1/mtm/mobile/sync/pull",
    })
  })

  it("returns success=true with timestamp and all entity keys on full sync", async () => {
    const res = await PullGET(makePullReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.timestamp).toBeDefined()
    expect(json.changes).toHaveProperty("routes")
    expect(json.changes).toHaveProperty("customers")
    expect(json.changes).toHaveProperty("visits")
    expect(json.changes).toHaveProperty("tasks")
    expect(json.changes).toHaveProperty("contacts")
  })

  it("each entity has updated and deleted arrays", async () => {
    const res = await PullGET(makePullReq())
    const json = await res.json()
    for (const entity of Object.values(json.changes)) {
      expect(entity).toHaveProperty("updated")
      expect(entity).toHaveProperty("deleted")
      expect(Array.isArray((entity as any).updated)).toBe(true)
      expect(Array.isArray((entity as any).deleted)).toBe(true)
    }
  })

  it("applies org + assignment-aware agent scope to route queries", async () => {
    await PullGET(makePullReq())
    const routeArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(routeArgs.where.organizationId).toBe(ORG)
    expect(routeArgs.where.AND[0].OR).toEqual([
      { agentId: AGENT_ID },
      { assignments: { some: { agentId: AGENT_ID, removedAt: null } } },
    ])
    expect(routeArgs.where.AND).toHaveLength(1)
    expect(routeArgs.where.deletedAt).toBeNull()
  })

  it("returns a route when the mobile agent is an active participant", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValueOnce([{
      id: "route-participant",
      organizationId: ORG,
      agentId: "agent-primary",
      status: "PLANNED",
      assignments: [
        { agentId: "agent-primary", role: "PRIMARY", assignedAt: new Date("2026-07-15T07:00:00.000Z") },
        { agentId: AGENT_ID, role: "PARTICIPANT", assignedAt: new Date("2026-07-15T07:01:00.000Z") },
      ],
      points: [],
    }] as any)

    const res = await PullGET(makePullReq("?entities=routes"))
    const json = await res.json()

    expect(json.changes.routes.updated[0]).toMatchObject({
      id: "route-participant",
      agentId: "agent-primary",
      assignments: expect.arrayContaining([
        expect.objectContaining({ agentId: AGENT_ID, role: "PARTICIPANT" }),
      ]),
    })
    const routeArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(routeArgs.include.assignments.where).toEqual({ removedAt: null })
  })

  it("preserves the legacy route payload while assignments migrate additively", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValueOnce([{
      id: "route-legacy",
      organizationId: ORG,
      agentId: AGENT_ID,
      status: "PLANNED",
      points: [],
    }] as any)

    const res = await PullGET(makePullReq("?entities=routes"))
    const json = await res.json()

    expect(json.changes.routes.updated[0]).toMatchObject({
      id: "route-legacy",
      agentId: AGENT_ID,
    })
  })

  it("applies sinceFilter when `since` query param is an ISO string", async () => {
    const since = new Date("2026-05-01T00:00:00.000Z")
    await PullGET(makePullReq(`?since=${since.toISOString()}`))
    const customerArgs = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(customerArgs.where.OR).toEqual(expect.arrayContaining([
      { updatedAt: { gt: since } },
      { agentAssignments: { some: { agentId: AGENT_ID, updatedAt: { gt: since } } } },
      { attributeFacts: { some: { package: { updatedAt: { gt: since } } } } },
      {
        routePoints: {
          some: expect.objectContaining({
            deletedAt: null,
            route: expect.objectContaining({ organizationId: ORG, deletedAt: null }),
          }),
        },
      },
    ]))
  })

  it("uses the web-equivalent assignment-or-route scope for offline organizations", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValueOnce([{
      id: "customer-route-visible",
      name: "Route clinic",
      agentAssignments: [],
      routePoints: [{
        id: "point-1",
        routeId: "route-1",
        route: { id: "route-1", name: "Monday", status: "PLANNED" },
      }],
      _count: { contactWorkplaces: 2, visits: 4 },
    }] as any)

    const res = await PullGET(makePullReq("?entities=customers"))
    const json = await res.json()

    expect(json.changes.customers).toMatchObject({
      projection: "organization-core-v3",
      scope: "effective-assignment-or-active-route",
      updated: [expect.objectContaining({ id: "customer-route-visible" })],
    })
    const customerArgs = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(customerArgs.where.AND[0].OR).toEqual(expect.arrayContaining([
      {
        agentAssignments: {
          some: expect.objectContaining({ agentId: { in: [AGENT_ID] } }),
        },
      },
      {
        routePoints: {
          some: expect.objectContaining({
            route: expect.objectContaining({ OR: expect.any(Array) }),
          }),
        },
      },
    ]))
    expect(customerArgs.select).toMatchObject({
      contactPerson: true,
      notes: true,
      geofenceRadius: true,
      polygon: true,
      attributeFacts: {
        where: { package: { status: "ACTIVE", effectiveFrom: { lte: expect.any(Date) } } },
        select: expect.objectContaining({ medicalCategoryCode: true, licenseStatus: true, polygonCode: true }),
      },
      managingManager: { select: expect.objectContaining({ id: true, name: true }) },
      agentAssignments: { select: expect.objectContaining({ role: true, effectiveFrom: true }) },
      routePoints: { select: expect.objectContaining({ route: expect.any(Object) }) },
      _count: { select: expect.any(Object) },
    })
  })

  it("accepts `since` as epoch ms integer", async () => {
    const epochMs = new Date("2026-05-01").getTime()
    // Query param is always a string; numeric string triggers the epoch path
    // (Number("1746057600000") is not NaN, so route does new Date(epochMs))
    await PullGET(makePullReq(`?since=${String(epochMs)}`))
    const customerArgs = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(customerArgs.where.OR[0].updatedAt.gt).toEqual(new Date(epochMs))
  })

  it("includes assignment updates in the route delta even when the parent route is unchanged", async () => {
    const since = new Date("2026-07-15T06:00:00.000Z")
    await PullGET(makePullReq(`?entities=routes&since=${since.toISOString()}`))

    const routeArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(routeArgs.where.AND[1]).toEqual({
      OR: [
        { updatedAt: { gt: since } },
        {
          assignments: {
            some: {
              agentId: AGENT_ID,
              removedAt: null,
              updatedAt: { gt: since },
            },
          },
        },
      ],
    })
  })

  it("returns 400 on invalid `since` value", async () => {
    const res = await PullGET(makePullReq("?since=not-a-date"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/invalid.*since/i)
  })

  it("only queries requested entities when `entities` param is set", async () => {
    await PullGET(makePullReq("?entities=routes,tasks"))
    // routes + tasks queried
    expect(vi.mocked(prisma.mtmRoute.findMany)).toHaveBeenCalled()
    expect(vi.mocked(prisma.mtmTask.findMany)).toHaveBeenCalled()
    // customers + contacts NOT queried
    expect(vi.mocked(prisma.mtmCustomer.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.mtmContact.findMany)).not.toHaveBeenCalled()
    // response only includes requested entities
    const res = await PullGET(makePullReq("?entities=routes,tasks"))
    const json = await res.json()
    expect(json.changes).toHaveProperty("routes")
    expect(json.changes).toHaveProperty("tasks")
    expect(json.changes).not.toHaveProperty("customers")
    expect(json.changes).not.toHaveProperty("contacts")
  })

  it("scopes contacts to the agent's active assignments and returns them", async () => {
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValueOnce([
      { id: "contact-1", displayName: "Dr. A", specialtyName: "Cardio", type: "DOCTOR", category: "A", phone: "+994", email: null, updatedAt: new Date() },
    ] as any)
    const res = await PullGET(makePullReq("?entities=contacts"))
    const json = await res.json()
    expect(json.changes.contacts.updated[0]).toMatchObject({ id: "contact-1", displayName: "Dr. A" })
    const contactArgs = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as any
    expect(contactArgs.where.organizationId).toBe(ORG)
    expect(contactArgs.where.deletedAt).toBeNull()
    expect(contactArgs.where.AND[0].OR).toEqual(expect.arrayContaining([
      {
        agentAssignments: {
          some: expect.objectContaining({
            agentId: { in: [AGENT_ID] },
            deletedAt: null,
            effectiveFrom: { lte: expect.any(Date) },
          }),
        },
      },
      {
        workplaces: {
          some: expect.objectContaining({
            deletedAt: null,
            endedOn: null,
            customer: expect.objectContaining({ OR: expect.any(Array) }),
          }),
        },
      },
    ]))
    expect(contactArgs.select).toMatchObject({
      displayName: true,
      qualificationCategory: true,
      profile: true,
      agentAssignments: {
        where: expect.objectContaining({ agentId: AGENT_ID, deletedAt: null }),
        select: expect.objectContaining({
          id: true,
          role: true,
          effectiveFrom: true,
          effectiveTo: true,
        }),
      },
      workplaces: expect.objectContaining({ select: expect.any(Object) }),
      fieldPotentials: expect.objectContaining({ select: expect.any(Object) }),
      doctorAssessments: expect.objectContaining({ select: expect.any(Object) }),
      dictionaryAssignments: expect.objectContaining({
        where: { effectiveTo: null },
        select: expect.objectContaining({ dictionary: expect.any(Object) }),
      }),
    })
  })

  it("includes assignment and workplace deltas in the offline contact projection", async () => {
    const since = new Date("2026-07-15T06:00:00.000Z")
    await PullGET(makePullReq(`?entities=contacts&since=${since.toISOString()}`))
    const contactArgs = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as any
    expect(contactArgs.where.OR).toEqual(expect.arrayContaining([
      { workplaces: { some: { updatedAt: { gt: since } } } },
      { dictionaryAssignments: { some: { updatedAt: { gt: since } } } },
      { agentAssignments: { some: { agentId: AGENT_ID, updatedAt: { gt: since } } } },
      {
        agentAssignments: {
          some: {
            agentId: AGENT_ID,
            deletedAt: null,
            effectiveFrom: { gt: since, lte: expect.any(Date) },
          },
        },
      },
    ]))
  })

  it("populates deleted IDs for delta sync (since + deletedAt filter)", async () => {
    vi.mocked(prisma.mtmRoute.findMany)
      .mockResolvedValueOnce([]) // active routes
      .mockResolvedValueOnce([{ id: "route-deleted" }] as any) // deleted route IDs
    const res = await PullGET(makePullReq("?entities=routes&since=2026-05-01T00:00:00.000Z"))
    const json = await res.json()
    expect(json.changes.routes.deleted).toContain("route-deleted")
  })

  it("returns a route tombstone when the participant assignment was removed", async () => {
    vi.mocked(prisma.mtmRouteAssignment.findMany).mockResolvedValueOnce([
      { routeId: "route-unassigned" },
      { routeId: "route-unassigned" },
    ] as any)

    const res = await PullGET(makePullReq("?entities=routes&since=2026-07-15T06:00:00.000Z"))
    const json = await res.json()

    expect(json.changes.routes.deleted).toEqual(["route-unassigned"])
    const assignmentArgs = vi.mocked(prisma.mtmRouteAssignment.findMany).mock.calls[0][0] as any
    expect(assignmentArgs.where).toEqual({
      organizationId: ORG,
      agentId: AGENT_ID,
      removedAt: { not: null, gt: new Date("2026-07-15T06:00:00.000Z") },
    })
  })

  it("returns a customer tombstone when effective ownership leaves the agent scope", async () => {
    vi.mocked(prisma.mtmCustomer.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "customer-unassigned" },
        { id: "customer-unassigned" },
      ] as any)

    const since = new Date("2026-07-15T06:00:00.000Z")
    const res = await PullGET(makePullReq(`?entities=customers&since=${since.toISOString()}`))
    const json = await res.json()

    expect(json.changes.customers.deleted).toEqual(["customer-unassigned"])
    const scopeArgs = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[2][0] as any
    expect(scopeArgs.where.organizationId).toBe(ORG)
    expect(scopeArgs.where.deletedAt).toBeNull()
    expect(scopeArgs.where.NOT).toMatchObject({ OR: expect.any(Array) })
    expect(scopeArgs.where.OR).toEqual(expect.arrayContaining([
      { agentAssignments: { some: expect.objectContaining({ agentId: AGENT_ID }) } },
      { routePoints: { some: expect.objectContaining({ route: expect.any(Object) }) } },
    ]))
  })

  it("returns a customer tombstone when its final route scope is removed", async () => {
    vi.mocked(prisma.mtmCustomer.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "customer-route-removed" }] as any)

    const since = new Date("2026-07-15T06:00:00.000Z")
    const res = await PullGET(makePullReq(`?entities=customers&since=${since.toISOString()}`))
    const json = await res.json()

    expect(json.changes.customers.deleted).toEqual(["customer-route-removed"])
    const scopeArgs = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[2][0] as any
    const routeCandidate = scopeArgs.where.OR.find((item: any) => item.routePoints)
    expect(routeCandidate.routePoints.some.route.OR).toEqual(expect.arrayContaining([
      { agentId: AGENT_ID, updatedAt: { gt: since } },
      { assignments: { some: { agentId: AGENT_ID, updatedAt: { gt: since } } } },
    ]))
  })

  it("returns a contact tombstone when effective ownership leaves the agent scope", async () => {
    vi.mocked(prisma.mtmContactAgentAssignment.findMany).mockResolvedValueOnce([
      { contactId: "contact-unassigned" },
      { contactId: "contact-unassigned" },
    ] as any)

    const since = new Date("2026-07-15T06:00:00.000Z")
    const res = await PullGET(makePullReq(`?entities=contacts&since=${since.toISOString()}`))
    const json = await res.json()

    expect(json.changes.contacts.deleted).toEqual(["contact-unassigned"])
    const assignmentArgs = vi.mocked(prisma.mtmContactAgentAssignment.findMany).mock.calls[0][0] as any
    expect(assignmentArgs.where.organizationId).toBe(ORG)
    expect(assignmentArgs.where.agentId).toBe(AGENT_ID)
    expect(assignmentArgs.where.contact.is).toMatchObject({
      deletedAt: null,
      NOT: expect.objectContaining({ OR: expect.any(Array) }),
    })
  })

  it("evicts an indirectly visible contact when workplace scope is removed", async () => {
    vi.mocked(prisma.mtmContact.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "contact-workplace-unassigned" }] as any)

    const since = new Date("2026-07-15T06:00:00.000Z")
    const res = await PullGET(makePullReq(`?entities=contacts&since=${since.toISOString()}`))
    const json = await res.json()

    expect(json.changes.contacts.deleted).toEqual(["contact-workplace-unassigned"])
    const scopeArgs = vi.mocked(prisma.mtmContact.findMany).mock.calls[2][0] as any
    expect(scopeArgs.where).toMatchObject({
      organizationId: ORG,
      deletedAt: null,
      NOT: expect.objectContaining({ OR: expect.any(Array) }),
      workplaces: {
        some: expect.objectContaining({
          customer: { OR: expect.any(Array) },
        }),
      },
    })
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockRejectedValue(new Error("DB down"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await PullGET(makePullReq())
    expect(res.status).toBe(500)
    spy.mockRestore()
  })
})

// ─── POST /api/v1/mtm/mobile/sync/push ───────────────────────────────────────

describe("POST /api/v1/mtm/mobile/sync/push", () => {
  it("returns 401 when not authenticated", async () => {
    // withMobileRls treats a null resolveMobileAuth result as unauthenticated → 401.
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as any)
    const res = await PushPOST(makePushReq({ operations: [] }))
    expect(res.status).toBe(401)
    expect(recordMtmMobileV1SyncActivity).not.toHaveBeenCalled()
  })

  it("records authenticated v1 push activity without reading operation payload into telemetry", async () => {
    const request = new NextRequest("http://localhost:3000/api/v1/mtm/mobile/sync/push", {
      method: "POST",
      body: JSON.stringify({ operations: [] }),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-token",
        "x-field-apk-version": "2.3.1+101",
      },
    })

    expect((await PushPOST(request)).status).toBe(200)
    expect(recordMtmMobileV1SyncActivity).toHaveBeenCalledWith({
      organizationId: ORG,
      agentId: AGENT_ID,
      apkVersion: "2.3.1+101",
      endpoint: "POST /api/v1/mtm/mobile/sync/push",
    })
  })

  it("returns empty results when operations array is empty", async () => {
    const res = await PushPOST(makePushReq({ operations: [] }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.results).toHaveLength(0)
  })

  it("isolates a disabled route-field operation without writing it", async () => {
    // Capability checks are intentionally operation-scoped: an old client can
    // keep a workforce operation in the same outbox batch without losing it
    // just because this route operation is no longer allowed.
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH_CONTEXT,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    } as never)

    const response = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-disabled-route-field",
        op: "create",
        entity: "visits",
        data: { customerId: "cust-1" },
        clientTimestamp: Date.now(),
      }],
    }))

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results).toEqual([expect.objectContaining({
      operationId: "op-disabled-route-field",
      status: "error",
      serverData: { code: "TENANT_CAPABILITY_DISABLED", capabilityId: "route-field" },
    })])
    expect(vi.mocked(prisma.mtmVisit.create)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.mtmSyncOperation.create)).not.toHaveBeenCalled()
  })

  it("returns 400 when operations count exceeds 100", async () => {
    const ops = Array.from({ length: 101 }, (_, i) => ({
      operationId: `op-${i}`,
      op: "create",
      entity: "visits",
      data: { customerId: "cust-1" },
    }))
    const res = await PushPOST(makePushReq({ operations: ops }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/max 100/i)
  })

  it("returns idempotent result for a previously seen operationId", async () => {
    // Already-processed ops arrive via the batched pre-check (findMany)
    vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([{
      operationId: "op-dup",
      entity: "visits",
      status: "ok",
      result: { serverId: "visit-server-1", serverData: {} },
    }] as any)
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-dup",
        op: "create",
        entity: "visits",
        data: { customerId: "cust-1" },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("ok")
    expect(json.results[0].serverId).toBe("visit-server-1")
    // Should NOT have created a new visit
    expect(vi.mocked(prisma.mtmVisit.create)).not.toHaveBeenCalled()
  })

  it("rejects a changed workday payload for an already-pinned C1 operation", async () => {
    const occurredAt = new Date(Date.now() - 60_000).toISOString()
    const queuedAt = new Date(Date.now() - 30_000).toISOString()
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-pinned-1",
      occurredAt,
      claimedAt: occurredAt,
      capturedAt: occurredAt,
      queuedAt,
      schemaVersion: 2,
      latitude: 40.4093,
      longitude: 49.8671,
    }, "op-workday-payload-bound", "Asia/Baku", new Date())
    expect(parsed.input).toBeTruthy()

    vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([{
      operationId: "op-workday-payload-bound",
      entity: "workdays",
      status: "ok",
      requestHash: mtmWorkdayRequestHash({ organizationId: ORG, agentId: AGENT_ID }, parsed.input!),
      result: { serverId: "workday-pinned-1", serverData: { workday: { status: "STARTED" } } },
    }] as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-workday-payload-bound",
      op: "create",
      entity: "workdays",
      data: {
        action: "START",
        id: "workday-pinned-1",
        occurredAt,
        claimedAt: occurredAt,
        capturedAt: occurredAt,
        queuedAt,
        schemaVersion: 2,
        latitude: 40.4093,
        longitude: 49.8672,
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      operationId: "op-workday-payload-bound",
      status: "conflict",
      serverData: { code: "WORKFORCE_WORKDAY_IDEMPOTENCY_MISMATCH" },
    })
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).not.toHaveBeenCalled()
  })

  it("replays a pinned own field-session workday after Workforce is disabled", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH_CONTEXT,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)
    vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([{
      operationId: "op-replay-after-disable",
      entity: "workdays",
      status: "ok",
      result: {
        serverId: "workday-pinned-1",
        serverData: { workday: { status: "STARTED" }, event: { type: "START" } },
      },
    }] as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-replay-after-disable",
      op: "create",
      entity: "workdays",
      data: {
        action: "START",
        id: "workday-pinned-1",
        occurredAt: "2026-07-14T05:00:00.000Z",
        latitude: 0,
        longitude: 0,
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      operationId: "op-replay-after-disable",
      status: "ok",
      serverId: "workday-pinned-1",
      serverData: { workday: { status: "STARTED" }, event: { type: "START" } },
    })
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).not.toHaveBeenCalled()
  })

  it("records error for operation with missing required fields", async () => {
    const res = await PushPOST(makePushReq({
      operations: [{ operationId: "op-1" }], // missing op, entity, data
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("error")
    expect(json.results[0].error).toMatch(/missing or invalid required/i)
  })

  it("malformed op (numeric operationId) fails per-op without 500ing the batch", async () => {
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-ok",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as never)
    const res = await PushPOST(makePushReq({
      operations: [
        // numeric operationId is truthy but must not reach prisma (it would
        // throw a validation error and 500 the whole request)
        { operationId: 123, op: "update", entity: "tasks", data: { id: "t1" }, clientTimestamp: Date.now() },
        { operationId: "op-good", op: "create", entity: "visits", data: { customerId: "cust-1" }, clientTimestamp: Date.now() },
      ],
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results[0].status).toBe("error")
    expect(json.results[0].operationId).toBe("?")
    expect(json.results[1].status).toBe("ok")
    // the malformed op is excluded from the batched pre-check
    expect(vi.mocked(prisma.mtmSyncOperation.findMany)).toHaveBeenCalledTimes(1)
    const findManyArgs = vi.mocked(prisma.mtmSyncOperation.findMany).mock.calls[0][0] as any
    expect(findManyArgs.where.operationId.in).toEqual(["op-good"])
  })

  it("pre-check failure degrades gracefully — ops still process, dedup falls to the atomic pin", async () => {
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-ok",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as never)
    vi.mocked(prisma.mtmSyncOperation.findMany).mockRejectedValueOnce(new Error("connection reset"))
    vi.mocked(prisma.mtmVisit.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "visit-ok", customerId: "cust-1", routePointId: null, checkInAt: new Date() } as never)
    const res = await PushPOST(makePushReq({
      operations: [
        { operationId: "op-a", op: "create", entity: "visits", data: { customerId: "cust-1" }, clientTimestamp: Date.now() },
        { operationId: "op-b", op: "create", entity: "visits", data: { customerId: "cust-1" }, clientTimestamp: Date.now() },
      ],
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results[0].status).toBe("ok")
    expect(json.results[1]).toMatchObject({ status: "conflict", serverData: { code: "MTM_VISIT_ALREADY_ACTIVE" } })
    // Both outcomes are pinned atomically despite the failed idempotency
    // pre-check, and both writers acquire the same per-agent slot lock.
    expect(vi.mocked(prisma.mtmSyncOperation.create)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.$executeRaw)).toHaveBeenCalledTimes(2)
    const lockKeys = vi.mocked(prisma.$executeRaw).mock.calls.map((call: unknown[]) => call[1])
    expect(lockKeys).toEqual([
      `mtm-active-visit:${ORG}:${AGENT_ID}`,
      `mtm-active-visit:${ORG}:${AGENT_ID}`,
    ])
  })

  it("creates a visit on visits/create and returns ok with serverId", async () => {
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-server-1",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as any)
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-v1",
        op: "create",
        entity: "visits",
        data: { customerId: "cust-1", checkInAt: new Date().toISOString() },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("ok")
    expect(json.results[0].serverId).toBe("visit-server-1")
    expect(vi.mocked(prisma.mtmVisit.create)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG, agentId: AGENT_ID }) }),
    )
  })

  it("pins an offline check-in at a customer without coordinates as a conflict (audit A6)", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "cust-ocean", category: "B", objectType: "OTHER", latitude: null, longitude: null, geofenceRadius: null,
    } as never)

    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-no-coords",
        op: "create",
        entity: "visits",
        data: { customerId: "cust-ocean", checkInAt: new Date().toISOString(), checkInLat: 40.41, checkInLng: 49.87 },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()

    expect(json.results[0]).toMatchObject({
      status: "conflict",
      serverData: { code: "MTM_VISIT_CUSTOMER_NO_COORDINATES", customerId: "cust-ocean" },
    })
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("rejects an ad-hoc check-in when the only route access is observer visibility", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue(null)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-observer-only-customer",
      op: "create",
      entity: "visits",
      data: { id: "visit-observer-only", customerId: "cust-observer-only" },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "conflict",
      serverData: { code: "MTM_VISIT_CUSTOMER_NOT_FOUND" },
    })
    const mutationScope = (vi.mocked(prisma.mtmCustomer.findFirst).mock.calls[0][0] as any).where.AND[0]
    expect(mutationScope.OR[1].routePoints.some.route.OR[1]).toEqual({
      assignments: {
        some: {
          agentId: { in: [AGENT_ID] },
          removedAt: null,
          role: { not: "OBSERVER" },
        },
      },
    })
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("binds an offline check-in only to an explicitly active route point", async () => {
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue({
      id: "point-1",
      routeId: "route-1",
      customerId: "cust-1",
      contactId: "contact-1",
      route: {
        status: "IN_PROGRESS",
        assignments: [
          { agentId: AGENT_ID, role: "PRIMARY" },
          { agentId: "agent-2", role: "PARTICIPANT" },
        ],
      },
    } as any)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "field-visit-1",
      status: "CHECKED_IN",
      checkInAt: new Date("2026-07-15T08:00:00.000Z"),
      customerId: "cust-1",
      contactId: "contact-1",
      routeId: "route-1",
      routePointId: "point-1",
    } as any)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-route-checkin",
      op: "create",
      entity: "visits",
      data: {
        id: "field-visit-1",
        customerId: "cust-1",
        contactId: "contact-1",
        routeId: "route-1",
        routePointId: "point-1",
        checkInAt: "2026-07-15T08:00:00.000Z",
        checkInLat: 40.4,
        checkInLng: 49.8,
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "ok", serverId: "field-visit-1" })
    expect(prisma.mtmVisit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contactId: "contact-1",
        routeId: "route-1",
        routePointId: "point-1",
      }),
    }))
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisitParticipant.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        agentId: "agent-2",
        visitId: "field-visit-1",
        joinedAt: new Date("2026-07-15T08:00:00.000Z"),
      })],
    }))
  })

  it("still accepts a check-in queued offline after the day-close job retired the route", async () => {
    // The sweep closes yesterday's open routes a few hours after midnight. A
    // phone that was offline pushes a real check-in long after that; refusing
    // it would destroy the only record of a visit that happened, and the agent
    // has no way to enter it again.
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue({
      id: "point-1",
      routeId: "route-1",
      customerId: "cust-1",
      contactId: null,
      route: { status: "INCOMPLETE", assignments: [{ agentId: AGENT_ID, role: "PRIMARY" }] },
    } as any)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "late-visit-1",
      status: "CHECKED_IN",
      checkInAt: new Date("2026-07-15T08:00:00.000Z"),
      customerId: "cust-1",
      contactId: null,
      routeId: "route-1",
      routePointId: "point-1",
    } as any)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-late-route-checkin",
      op: "create",
      entity: "visits",
      data: {
        id: "late-visit-1",
        customerId: "cust-1",
        routeId: "route-1",
        routePointId: "point-1",
        checkInAt: "2026-07-15T08:00:00.000Z",
        checkInLat: 40.4,
        checkInLng: 49.8,
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "ok", serverId: "late-visit-1" })

    const where = vi.mocked(prisma.mtmRoutePoint.findFirst).mock.calls[0][0] as any
    // A closed day is admitted only when the route had actually started, so a
    // check-in still cannot turn a saved plan into an active route.
    expect(where.where.route.AND[0].OR).toEqual([
      { status: "IN_PROGRESS" },
      { status: "INCOMPLETE", startedAt: { not: null } },
    ])
  })

  it("rejects a route-point check-in while the route is still only planned", async () => {
    // The active-route predicate deliberately excludes PLANNED. Returning no
    // route point here models the database query result without disclosing
    // the plan to a stale/offline client.
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValueOnce(null)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-planned-route-checkin",
      op: "create",
      entity: "visits",
      data: { id: "visit-planned-route", customerId: "cust-1", routeId: "route-1", routePointId: "point-1" },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "conflict",
      serverData: { code: "MTM_ROUTE_POINT_NOT_AVAILABLE" },
    })
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
    const routePointQuery = vi.mocked(prisma.mtmRoutePoint.findFirst).mock.calls[0][0] as any
    // PLANNED is absent from the admitted set, so a check-in can never turn a
    // saved plan into an active route.
    const admitted = routePointQuery.where.route.AND[0].OR.map((clause: any) => clause.status)
    expect(admitted).not.toContain("PLANNED")
    expect(admitted).toContain("IN_PROGRESS")
  })

  it("pins an out-of-zone route check-in as a resolvable conflict", async () => {
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue({
      id: "point-1",
      routeId: "route-1",
      customerId: "cust-1",
      contactId: null,
      route: { status: "PLANNED", assignments: [] },
    } as any)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "cust-1",
      category: "B",
      objectType: "CLINIC",
      latitude: 40.4,
      longitude: 49.8,
      geofenceRadius: 50,
    } as any)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-out-of-zone",
      op: "create",
      entity: "visits",
      data: {
        id: "field-visit-zone",
        customerId: "cust-1",
        routeId: "route-1",
        routePointId: "point-1",
        checkInLat: 41.0,
        checkInLng: 50.5,
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "conflict",
      serverData: { code: "MTM_VISIT_OUT_OF_ZONE", geofenceRadius: 50 },
    })
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
    expect(prisma.mtmAlert.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "conflict" }),
    }))
  })

  it("rejects an ad-hoc contact outside the tenant customer before visit creation", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue(null)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-contact-outside",
      op: "create",
      entity: "visits",
      data: { id: "visit-contact-outside", customerId: "cust-1", contactId: "contact-foreign" },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "conflict", serverData: { code: "MTM_VISIT_CONTACT_NOT_FOUND" } })
    expect(prisma.mtmContact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "contact-foreign", organizationId: ORG, deletedAt: null }),
    }))
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("fails closed when the route-point mutation fence loses current assignment", async () => {
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValueOnce({
      id: "point-1",
      routeId: "route-1",
      customerId: "cust-1",
      contactId: null,
      route: { status: "PLANNED", assignments: [] },
    } as never)
    vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 0 } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-route-fence",
      op: "create",
      entity: "visits",
      data: { id: "visit-route-fence", customerId: "cust-1", routePointId: "point-1" },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "conflict", serverData: { code: "MTM_ROUTE_POINT_NOT_AVAILABLE" } })
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
    expect(prisma.mtmVisitParticipant.createMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "point-1", status: "PENDING", deletedAt: null }),
    }))
  })

  it("pins a force check-in from an unprivileged agent as a forbidden conflict", async () => {
    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-force-agent",
      op: "create",
      entity: "visits",
      data: {
        id: "field-visit-force-agent",
        customerId: "cust-1",
        checkInLat: 40.4,
        checkInLng: 49.8,
        force: true,
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "conflict",
      serverData: { code: "MTM_VISIT_FORCE_FORBIDDEN", actorRole: "AGENT" },
    })
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "conflict" }),
    }))
  })

  it("accepts and audits an out-of-zone force check-in from a manager", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH_CONTEXT, role: "MANAGER" } as never)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "cust-1",
      latitude: 40.4,
      longitude: 49.8,
      geofenceRadius: 50,
    } as never)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "field-visit-force-manager",
      status: "CHECKED_IN",
      checkInAt: new Date("2026-07-21T09:00:00.000Z"),
      customerId: "cust-1",
      contactId: null,
      routeId: null,
      routePointId: null,
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-force-manager",
      op: "create",
      entity: "visits",
      data: {
        id: "field-visit-force-manager",
        customerId: "cust-1",
        checkInAt: "2026-07-21T09:00:00.000Z",
        checkInLat: 41.0,
        checkInLng: 50.5,
        force: true,
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "ok",
      serverId: "field-visit-force-manager",
    })
    expect(prisma.mtmVisit.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAlert.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ forceOverride: true, actorRole: "MANAGER" }),
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        agentId: AGENT_ID,
        action: "CHECK_IN_FORCED",
        entity: "visit",
        entityId: "field-visit-force-manager",
        metadataKind: "force_checkin",
        newData: expect.objectContaining({ actorRole: "MANAGER", forceOverride: true }),
      }),
    })
  })

  it("does not grant managers general field mutation capability", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH_CONTEXT, role: "MANAGER" } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-manager-ordinary",
      op: "create",
      entity: "visits",
      data: { id: "visit-manager-ordinary", customerId: "cust-1" },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      code: "MTM_MOBILE_CAPABILITY_REQUIRED",
      capability: "FIELD_EXECUTE",
    })
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("delivers a workday event while returning a per-operation capability error for a queued route mutation", async () => {
    const occurredAt = new Date(Date.now() - 60_000).toISOString()
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH_CONTEXT,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAgentWorkday.create).mockResolvedValue({
      id: "workday-hrm-only-1",
      workDate: new Date("2026-07-14T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-14T05:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      startLatitude: 0,
      startLongitude: 0,
      endLatitude: null,
      endLongitude: null,
      createdAt: new Date("2026-07-14T05:00:00.000Z"),
      updatedAt: new Date("2026-07-14T05:00:00.000Z"),
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockResolvedValue({
      id: "event-hrm-only-1",
      workdayId: "workday-hrm-only-1",
      clientEventId: "op-hrm-only-workday",
      type: "START",
      occurredAt: new Date("2026-07-14T05:00:00.000Z"),
      attendanceReviewState: "NOT_REQUIRED",
      attendanceReviewReasonCode: null,
    } as never)

    const response = await PushPOST(makePushReq({ operations: [
      {
        operationId: "op-hrm-only-workday",
        op: "create",
        entity: "workdays",
        data: {
          action: "START",
          id: "workday-hrm-only-1",
          occurredAt,
          latitude: 0,
          longitude: 0,
        },
        clientTimestamp: Date.now(),
      },
      {
        operationId: "op-hrm-only-route",
        op: "create",
        entity: "visits",
        data: { id: "visit-route-disabled", customerId: "cust-1" },
        clientTimestamp: Date.now(),
      },
    ] }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationId: "op-hrm-only-workday",
        status: "ok",
        serverId: "workday-hrm-only-1",
        serverData: expect.objectContaining({
          review: { state: "NOT_REQUIRED", reasonCode: null },
        }),
      }),
      expect.objectContaining({
        operationId: "op-hrm-only-route",
        status: "error",
        serverData: { code: "TENANT_CAPABILITY_DISABLED", capabilityId: "route-field" },
      }),
    ]))
    expect(prisma.mtmAgentWorkday.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("delivers an offline HRM request while isolating a queued route mutation", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH_CONTEXT,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    } as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmHrmRequest.create).mockResolvedValue({
      id: "hrm-hrm-only-1",
      clientRequestId: "hrm-client-0001",
      type: "LEAVE",
      status: "PENDING",
      startDate: new Date("2026-07-20T00:00:00.000Z"),
      endDate: new Date("2026-07-21T00:00:00.000Z"),
      correctionWorkdayId: null,
      requestedStartAt: null,
      requestedEndAt: null,
      reason: "Annual leave",
      submittedAt: new Date("2026-07-14T05:00:00.000Z"),
    } as never)

    const response = await PushPOST(makePushReq({ operations: [
      {
        operationId: "op-hrm-only-request",
        op: "create",
        entity: "hrmRequests",
        data: {
          id: "hrm-hrm-only-1",
          clientRequestId: "hrm-client-0001",
          type: "LEAVE",
          startDate: "2026-07-20",
          endDate: "2026-07-21",
          reason: "Annual leave",
          submittedAt: "2026-07-14T05:00:00.000Z",
        },
        clientTimestamp: Date.now(),
      },
      {
        operationId: "op-hrm-only-route-after-request",
        op: "create",
        entity: "visits",
        data: { id: "visit-route-disabled", customerId: "cust-1" },
        clientTimestamp: Date.now(),
      },
    ] }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationId: "op-hrm-only-request",
        status: "ok",
        serverId: "hrm-hrm-only-1",
      }),
      expect.objectContaining({
        operationId: "op-hrm-only-route-after-request",
        status: "error",
        serverData: { code: "TENANT_CAPABILITY_DISABLED", capabilityId: "route-field" },
      }),
    ]))
    expect(prisma.mtmHrmRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: "hrm-hrm-only-1",
        organizationId: ORG,
        agentId: AGENT_ID,
        clientRequestId: "hrm-client-0001",
      }),
    }))
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("fences only Workforce operations in a mixed legacy batch without pinning the denied write", async () => {
    vi.mocked(evaluateWorkforceMobileWriteAccess).mockResolvedValue({
      allowed: false,
      mode: "FROZEN",
      code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN",
      message: "Mobile Workforce writes are temporarily frozen for this tenant.",
      deviceId: "device-fence",
    } as never)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-after-fence",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as never)

    const response = await PushPOST(makePushReq({ operations: [
      {
        operationId: "op-fenced-workday",
        op: "create",
        entity: "workdays",
        data: {},
        clientTimestamp: Date.now(),
      },
      {
        operationId: "op-route-after-fence",
        op: "create",
        entity: "visits",
        data: { customerId: "cust-1" },
        clientTimestamp: Date.now(),
      },
    ] }, { "x-field-device-id": "device-fence" }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationId: "op-fenced-workday",
        status: "error",
        serverData: { code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN", mode: "FROZEN" },
      }),
      expect.objectContaining({
        operationId: "op-route-after-fence",
        status: "ok",
        serverId: "visit-after-fence",
      }),
    ]))
    expect(evaluateWorkforceMobileWriteAccess).toHaveBeenCalledWith({
      auth: AUTH_CONTEXT,
      deviceId: "device-fence",
    })
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ operationId: "op-route-after-fence" }),
    }))
    expect(vi.mocked(prisma.mtmSyncOperation.create).mock.calls.map((call: any[]) => call[0].data.operationId))
      .not.toContain("op-fenced-workday")
  })

  it("fences HRM requests with the same device gate", async () => {
    vi.mocked(evaluateWorkforceMobileWriteAccess).mockResolvedValue({
      allowed: false,
      mode: "COHORT_ONLY",
      code: "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED",
      message: "This device is not enrolled for the current Workforce mobile write cohort.",
      deviceId: null,
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-fenced-request",
      op: "create",
      entity: "hrmRequests",
      data: {},
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "error",
      serverData: { code: "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED", mode: "COHORT_ONLY" },
    })
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).not.toHaveBeenCalled()
  })

  it("re-checks the fence in the write transaction so a concurrent freeze cannot commit an HRM request", async () => {
    vi.mocked(evaluateWorkforceMobileWriteAccess)
      .mockResolvedValueOnce({
        allowed: true,
        mode: "LEGACY_ALLOWED",
        deviceId: "device-fence",
        cohortEpoch: null,
      } as never)
      .mockResolvedValueOnce({
        allowed: false,
        mode: "FROZEN",
        code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN",
        message: "Mobile Workforce writes are temporarily frozen for this tenant.",
        deviceId: "device-fence",
      } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-fence-race-request",
      op: "create",
      entity: "hrmRequests",
      data: {
        id: "hrm-fence-race-1",
        clientRequestId: "hrm-fence-race-client-1",
        type: "LEAVE",
        startDate: "2026-07-20",
        endDate: "2026-07-21",
        reason: "Annual leave",
        submittedAt: "2026-07-14T05:00:00.000Z",
      },
      clientTimestamp: Date.now(),
    }] }, { "x-field-device-id": "device-fence" }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "error",
      serverData: { code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN", mode: "FROZEN" },
    })
    expect(evaluateWorkforceMobileWriteAccess).toHaveBeenNthCalledWith(1, {
      auth: AUTH_CONTEXT,
      deviceId: "device-fence",
    })
    expect(evaluateWorkforceMobileWriteAccess).toHaveBeenNthCalledWith(2, expect.objectContaining({
      auth: AUTH_CONTEXT,
      deviceId: "device-fence",
      tx: prisma,
    }))
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).not.toHaveBeenCalled()
  })

  it("rejects a relabelled old workday replay before it can cross a product fence", async () => {
    vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([{
      operationId: "op-stored-workday",
      entity: "workdays",
      status: "ok",
      result: { serverId: "workday-secret", serverData: { workday: { id: "workday-secret" } } },
    }] as never)
    vi.mocked(evaluateWorkforceMobileWriteAccess).mockResolvedValue({
      allowed: false,
      mode: "FROZEN",
      code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN",
      message: "Mobile Workforce writes are temporarily frozen for this tenant.",
      deviceId: "device-fence",
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-stored-workday",
      op: "create",
      entity: "visits",
      data: { customerId: "cust-1" },
      clientTimestamp: Date.now(),
    }] }, { "x-field-device-id": "device-fence" }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "error",
      serverData: { code: "MTM_SYNC_OPERATION_ID_MISMATCH" },
    })
    expect(JSON.stringify(body)).not.toContain("workday-secret")
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("returns a retryable per-operation error when the Workforce fence is unavailable, without stopping Routes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(evaluateWorkforceMobileWriteAccess).mockRejectedValue(new Error("fence database unavailable"))
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-after-fence-unavailable",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as never)

    const response = await PushPOST(makePushReq({ operations: [
      { operationId: "op-fence-unavailable", op: "create", entity: "workdays", data: {}, clientTimestamp: Date.now() },
      { operationId: "op-route-still-runs", op: "create", entity: "visits", data: { customerId: "cust-1" }, clientTimestamp: Date.now() },
    ] }))
    const body = await response.json()
    consoleError.mockRestore()

    expect(body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationId: "op-fence-unavailable",
        status: "error",
        serverData: { code: "WORKFORCE_MOBILE_WRITE_FENCE_UNAVAILABLE" },
      }),
      expect.objectContaining({ operationId: "op-route-still-runs", status: "ok" }),
    ]))
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
  })

  it("visit update: returns conflict when visit not found or not owned by agent", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-v2",
        op: "update",
        entity: "visits",
        data: { id: "visit-x", status: "CHECKED_OUT" },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("conflict")
    expect(json.results[0].error).toMatch(/not found/i)
  })

  it("visit update: returns conflict when trying to revert CHECKED_OUT status", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-x",
      status: "CHECKED_OUT",
    } as any)
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-v3",
        op: "update",
        entity: "visits",
        data: { id: "visit-x", status: "CHECKED_IN" }, // reverting terminal status
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("conflict")
    expect(json.results[0].error).toMatch(/terminal/i)
    // Server returns existing visit so client can reconcile UI state
    expect(json.results[0].serverData).toMatchObject({ id: "visit-x", status: "CHECKED_OUT" })
  })

  it("visit checkout writes nothing when the atomic primary-owner fence loses reassignment", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ id: "visit-x", status: "CHECKED_IN" } as never)
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 0 } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-visit-reassigned",
      op: "update",
      entity: "visits",
      data: { id: "visit-x", status: "CHECKED_OUT", outcome: "SUCCESSFUL" },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0].status).toBe("conflict")
    expect(prisma.mtmVisit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "visit-x", organizationId: ORG, agentId: AGENT_ID, status: "CHECKED_IN" }),
    }))
    expect(prisma.mtmVisit.update).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findFirst).toHaveBeenCalledTimes(1)
  })

  it("versions and audits task completion using server time instead of the device clock", async () => {
    const clientCompletedAt = new Date("2099-07-15T09:30:00.000Z")
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
      id: "task-1",
      status: "PENDING",
      completedAt: null,
      version: 2,
      sourceKey: null,
      dueDate: new Date("2026-07-15T09:00:00.000Z"),
      acceptedAt: null,
      startedAt: null,
      scheduledStartAt: null,
      recurrenceRule: null,
      recurrenceInterval: null,
      recurrenceUntil: null,
      recurrenceTimezone: null,
      recurrenceAnchorScheduledStartAt: null,
      recurrenceAnchorDueDate: null,
      recurrenceParentId: null,
      customerId: "cust-1",
      title: "Follow up",
      description: null,
      priority: "HIGH",
    } as any)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmTaskEvent.create).mockResolvedValue({ id: "task-event-1" } as never)
    const receivedAfter = Date.now()
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-t1",
        op: "update",
        entity: "tasks",
        data: { id: "task-1", expectedVersion: 2, status: "COMPLETED", progress: 50 },
        clientTimestamp: clientCompletedAt.getTime(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("ok")
    const updateArgs = vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0] as any
    expect(updateArgs.data).toMatchObject({ progress: 100, version: { increment: 1 } })
    expect(updateArgs.data.completedAt).toBeInstanceOf(Date)
    expect(updateArgs.data.completedAt.getTime()).toBeGreaterThanOrEqual(receivedAfter)
    expect(updateArgs.data.completedAt).not.toEqual(clientCompletedAt)
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taskId: "task-1",
        clientEventId: "op-t1",
        type: "COMPLETED",
        fromStatus: "PENDING",
        toStatus: "COMPLETED",
        evidence: expect.objectContaining({
          clientOccurredAt: null,
          clientOccurredAtAccepted: false,
        }),
      }),
    }))
  })

  it("returns the server card when an offline task version is stale", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
      id: "task-stale",
      status: "IN_PROGRESS",
      version: 4,
      title: "Server title",
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-task-stale",
      op: "update",
      entity: "tasks",
      data: { id: "task-stale", expectedVersion: 3, status: "COMPLETED" },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "conflict",
      serverData: {
        code: "MTM_TASK_VERSION_CONFLICT",
        task: { id: "task-stale", version: 4, title: "Server title" },
      },
    })
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it("creates exactly the next occurrence when a recurring task completes", async () => {
    const sourceTask = {
      id: "task-weekly",
      agentId: AGENT_ID,
      status: "IN_PROGRESS",
      completedAt: null,
      version: 1,
      sourceKey: "mobile-self:task-weekly",
      dueDate: new Date("2026-07-15T09:00:00.000Z"),
      acceptedAt: new Date("2026-07-15T07:00:00.000Z"),
      startedAt: new Date("2026-07-15T08:00:00.000Z"),
      scheduledStartAt: null,
      recurrenceRule: "WEEKLY",
      recurrenceInterval: 2,
      recurrenceUntil: new Date("2026-08-31T00:00:00.000Z"),
      recurrenceTimezone: "UTC",
      recurrenceAnchorScheduledStartAt: null,
      recurrenceAnchorDueDate: new Date("2026-07-15T09:00:00.000Z"),
      recurrenceCursorScheduledStartAt: null,
      recurrenceCursorDueDate: new Date("2026-07-15T09:00:00.000Z"),
      recurrenceParentId: null,
      customerId: "cust-1",
      title: "Check clinic stock",
      description: "Repeat every two weeks",
      priority: "HIGH",
    }
    vi.mocked(prisma.mtmTask.findFirst)
      .mockResolvedValueOnce(sourceTask as never)
      .mockResolvedValueOnce({
        ...sourceTask,
        status: "COMPLETED",
        progress: 100,
        version: 2,
      } as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmTask.create).mockResolvedValue({
      id: "task-weekly-next",
    } as never)
    vi.mocked(prisma.mtmTaskEvent.create).mockResolvedValue({ id: "task-event" } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-task-weekly-complete",
      op: "update",
      entity: "tasks",
      data: { id: sourceTask.id, expectedVersion: 1, status: "COMPLETED" },
      clientTimestamp: new Date("2026-07-15T10:00:00.000Z").getTime(),
    }] }))
    const body = await response.json()

    expect(body.results[0].status).toBe("ok")
    expect(prisma.mtmTask.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agentId: AGENT_ID,
        customerId: "cust-1",
        sourceKey: "task-recurrence:task-weekly:2026-07-29T09:00:00.000Z",
        dueDate: new Date("2026-07-29T09:00:00.000Z"),
        recurrenceParentId: "task-weekly",
        recurrenceRule: "WEEKLY",
        recurrenceInterval: 2,
      }),
    }))
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.mtmTask.findFirst).mock.calls[1][0].select).toMatchObject({
      recurrenceCursorScheduledStartAt: true,
      recurrenceCursorDueDate: true,
    })
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.mtmTask.updateMany).mock.invocationCallOrder[0],
    )
  })

  it("syncs visit action evidence before checkout", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      requirementSnapshot: { requirements: [{ id: "requirement-1", mode: "REQUIRED", allowWaiver: false }] },
    } as any)
    vi.mocked(prisma.mtmVisitActionResult.create).mockResolvedValue({
      id: "action-1",
      visitId: "visit-1",
      actionKey: "PRESENTATION",
      status: "COMPLETED",
      completedAt: new Date(),
    } as any)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-action-1",
      op: "create",
      entity: "visitActions",
      data: { visitId: "visit-1", actionKey: "PRESENTATION", evidence: { material: "Cardiology 2026", version: "3" } },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "ok", serverId: "action-1" })
    expect(prisma.mtmVisitActionResult.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actionKey: "PRESENTATION", completedByAgentId: AGENT_ID }),
    }))
  })

  it("creates a reminder task when NEXT_ACTION syncs from mobile", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      customerId: "cust-1",
      requirementSnapshot: { requirements: [{ id: "requirement-next", mode: "REQUIRED", allowWaiver: false }] },
    } as any)
    vi.mocked(prisma.mtmVisitActionResult.create).mockResolvedValue({
      id: "action-next",
      visitId: "visit-1",
      actionKey: "NEXT_ACTION",
      status: "COMPLETED",
      completedAt: new Date(),
    } as any)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmTask.create).mockResolvedValue({ id: "task-next" } as any)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-next-action",
      op: "create",
      entity: "visitActions",
      data: {
        visitId: "visit-1",
        actionKey: "NEXT_ACTION",
        evidence: { title: "Call doctor", dueDate: "2026-07-15T08:00:00.000Z", priority: "HIGH" },
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "ok", serverId: "action-next" })
    expect(prisma.mtmVisit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "visit-1",
        organizationId: ORG,
        agentId: AGENT_ID,
        status: "CHECKED_IN",
        deletedAt: null,
      },
      data: { nextActionDueAt: new Date("2026-07-15T08:00:00.000Z") },
    }))
    expect(prisma.mtmTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceKey: "visit-next-action:visit-1",
        title: "Call doctor",
        priority: "HIGH",
        agentId: AGENT_ID,
        customerId: "cust-1",
      }),
    }))
  })

  it("rejects malformed NEXT_ACTION evidence before writing", async () => {
    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-next-action-invalid",
      op: "create",
      entity: "visitActions",
      data: { visitId: "visit-1", actionKey: "NEXT_ACTION", evidence: { title: "Missing date" } },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "error" })
    expect(body.results[0].error).toMatch(/valid evidence\.dueDate/i)
    expect(prisma.mtmVisitActionResult.create).not.toHaveBeenCalled()
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })

  it("rejects a hidden visit action during offline sync", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      requirementSnapshot: { requirements: [{ id: "requirement-1", mode: "HIDDEN", allowWaiver: false }] },
    } as any)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-action-hidden",
      op: "create",
      entity: "visitActions",
      data: { visitId: "visit-1", actionKey: "STOCK_CHECK", evidence: { product: "A" } },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "conflict", serverData: { code: "MTM_VISIT_ACTION_HIDDEN" } })
    expect(prisma.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })

  it("keeps a participant-only mobile actor read-only for visit actions", async () => {
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 0 } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "foreign-primary-visit",
      agentId: "primary-agent",
      requirementSnapshot: { requirements: [{ id: "requirement-1", mode: "REQUIRED", allowWaiver: false }] },
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-participant-action",
      op: "create",
      entity: "visitActions",
      data: { visitId: "foreign-primary-visit", actionKey: "PRESENTATION", evidence: { note: "blocked" } },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0].status).toBe("conflict")
    expect(prisma.mtmVisit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "foreign-primary-visit",
        organizationId: ORG,
        agentId: AGENT_ID,
        status: "CHECKED_IN",
      }),
    }))
    expect(prisma.mtmVisit.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })

  it("requires the online waiver reason contract before mobile writes", async () => {
    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-waiver-no-reason",
      op: "create",
      entity: "visitActions",
      data: { visitId: "visit-1", actionKey: "PRESENTATION", status: "WAIVED", evidence: {} },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "error" })
    expect(body.results[0].error).toMatch(/waiver reason/i)
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })

  it("returns error for unsupported entity type", async () => {
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-x1",
        op: "create",
        entity: "promotions", // not supported in push
        data: { name: "Test" },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("error")
    expect(json.results[0].error).toMatch(/unsupported entity/i)
  })

  it("persists idempotency record for each processed operation", async () => {
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-new",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as any)
    await PushPOST(makePushReq({
      operations: [{
        operationId: "op-persist",
        op: "create",
        entity: "visits",
        data: { customerId: "cust-1" },
        clientTimestamp: Date.now(),
      }],
    }))
    expect(vi.mocked(prisma.mtmSyncOperation.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          operationId: "op-persist",
          organizationId: ORG,
          agentId: AGENT_ID,
          status: "ok",
        }),
      }),
    )
    // entity write and pin share one $transaction, write first
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledTimes(1)
    const writeOrder = vi.mocked(prisma.mtmVisit.create).mock.invocationCallOrder[0]
    const pinOrder = vi.mocked(prisma.mtmSyncOperation.create).mock.invocationCallOrder[0]
    expect(writeOrder).toBeLessThan(pinOrder)
  })

  it("null element in operations fails as a malformed op, not a 500", async () => {
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-ok",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as any)
    const res = await PushPOST(makePushReq({
      operations: [
        null,
        { operationId: "op-after-null", op: "create", entity: "visits", data: { customerId: "cust-1" }, clientTimestamp: Date.now() },
      ],
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results[0].status).toBe("error")
    expect(json.results[0].operationId).toBe("?")
    expect(json.results[1].status).toBe("ok")
  })

  it("field-only update to a CHECKED_OUT visit applies (not a terminal revert)", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-done",
      status: "CHECKED_OUT",
    } as any)
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-notes-late",
        op: "update",
        entity: "visits",
        data: { id: "visit-done", notes: "synced after checkout" },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("ok")
    const updateArgs = vi.mocked(prisma.mtmVisit.updateMany).mock.calls[0][0] as any
    expect(updateArgs.data.notes).toBe("synced after checkout")
    expect(updateArgs.where).toMatchObject({
      id: "visit-done",
      organizationId: ORG,
      agentId: AGENT_ID,
      status: "CHECKED_OUT",
    })
  })

  it("P2002 on the pin replays the concurrent winner's stored result", async () => {
    // Local processing succeeds but the pin hits the unique constraint —
    // a concurrent duplicate push already committed this operationId.
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-local",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as any)
    vi.mocked(prisma.mtmSyncOperation.create).mockRejectedValueOnce({ code: "P2002" })
    vi.mocked(prisma.mtmSyncOperation.findFirst).mockResolvedValue({
      operationId: "op-race",
      entity: "visits",
      status: "ok",
      result: { serverId: "visit-winner", serverData: { id: "visit-winner" } },
    } as any)
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-race",
        op: "create",
        entity: "visits",
        data: { customerId: "cust-1" },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("ok")
    // the response replays the WINNER's result, not the rolled-back local write
    expect(json.results[0].serverId).toBe("visit-winner")
  })

  it("does not leak an unrelated field-session winner through a Routes-only replay race", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH_CONTEXT,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-local",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as any)
    vi.mocked(prisma.mtmSyncOperation.create).mockRejectedValueOnce({ code: "P2002" })
    vi.mocked(prisma.mtmSyncOperation.findFirst).mockResolvedValue({
      operationId: "op-cross-product-race",
      entity: "workdays",
      status: "ok",
      result: {
        serverId: "workday-secret",
        serverData: { workday: { id: "workday-secret", status: "STARTED" } },
      },
    } as any)

    const response = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-cross-product-race",
        op: "create",
        entity: "visits",
        data: { customerId: "cust-1" },
        clientTimestamp: Date.now(),
      }],
    }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "error",
      serverData: { code: "MTM_SYNC_OPERATION_ID_MISMATCH" },
    })
    expect(JSON.stringify(body)).not.toContain("workday-secret")
  })

  it("P2002 from a non-idempotency unique (client-supplied visit id) → pinned conflict", async () => {
    vi.mocked(prisma.mtmVisit.create).mockRejectedValueOnce({ code: "P2002" })
    // recheck finds no idempotency record (beforeEach default: findFirst → null)
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-dup-id",
        op: "create",
        entity: "visits",
        data: { id: "visit-existing", customerId: "cust-1" },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("conflict")
    expect(json.results[0].error).toMatch(/already exists/i)
    // the conflict is pinned so retries replay a stable result
    expect(vi.mocked(prisma.mtmSyncOperation.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ operationId: "op-dup-id", status: "conflict" }),
      }),
    )
  })

  it("unexpected P2002 on a non-create path → retryable error, not a guessed conflict", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ id: "visit-1", status: "CHECKED_IN" } as any)
    vi.mocked(prisma.mtmVisit.updateMany).mockRejectedValueOnce({ code: "P2002" })
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-upd-p2002",
        op: "update",
        entity: "visits",
        data: { id: "visit-1", notes: "x" },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("error")
    expect(json.results[0].error).toMatch(/conflicting write, retry/i)
  })

  it("recheck failure after P2002 → retryable error, batch continues", async () => {
    vi.mocked(prisma.mtmVisit.create)
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce({ id: "visit-ok", status: "CHECKED_IN", checkInAt: new Date() } as any)
    vi.mocked(prisma.mtmSyncOperation.findFirst).mockRejectedValueOnce(new Error("connection reset"))
    const res = await PushPOST(makePushReq({
      operations: [
        { operationId: "op-bad", op: "create", entity: "visits", data: { customerId: "cust-1" }, clientTimestamp: Date.now() },
        { operationId: "op-fine", op: "create", entity: "visits", data: { customerId: "cust-1" }, clientTimestamp: Date.now() },
      ],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("error")
    expect(json.results[0].error).toMatch(/recheck failed/i)
    expect(json.results[1].status).toBe("ok")
  })

  it("intra-batch duplicate operationId replays locally without a second write", async () => {
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-once",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as any)
    const dupOp = {
      operationId: "op-same",
      op: "create",
      entity: "visits",
      data: { customerId: "cust-1" },
      clientTimestamp: Date.now(),
    }
    const res = await PushPOST(makePushReq({ operations: [dupOp, { ...dupOp }] }))
    const json = await res.json()
    expect(json.results).toHaveLength(2)
    expect(json.results[0].status).toBe("ok")
    expect(json.results[1].status).toBe("ok")
    expect(json.results[1].serverId).toBe("visit-once")
    // processed once, pinned once — the duplicate replayed from the in-batch map
    expect(vi.mocked(prisma.mtmVisit.create)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.mtmSyncOperation.create)).toHaveBeenCalledTimes(1)
  })

  it("orders entity (removed in #288): op errors softly, rest of batch still processes", async () => {
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({
      id: "visit-after-order",
      status: "CHECKED_IN",
      checkInAt: new Date(),
    } as any)
    const res = await PushPOST(makePushReq({
      operations: [
        {
          operationId: "op-order-1",
          op: "create",
          entity: "orders",
          data: { customerId: "cust-1", items: [] },
          clientTimestamp: Date.now(),
        },
        {
          operationId: "op-visit-after",
          op: "create",
          entity: "visits",
          data: { customerId: "cust-1" },
          clientTimestamp: Date.now(),
        },
      ],
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.results[0].status).toBe("error")
    expect(json.results[0].error).toBe('Unsupported entity "orders"')
    // error results are NOT pinned in the idempotency table (retryable);
    // only the ok visits op gets a record
    const persisted = vi.mocked(prisma.mtmSyncOperation.create).mock.calls.map((c: any[]) => c[0].data)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ operationId: "op-visit-after", status: "ok" })
    // the visits op in the same batch is unaffected
    expect(json.results[1].status).toBe("ok")
    expect(json.results[1].serverId).toBe("visit-after-order")
  })

  it("replays the saved error message for a persisted conflict operationId", async () => {
    vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([{
      operationId: "op-dup-conflict",
      entity: "visits",
      status: "conflict",
      result: { serverData: { id: "visit-x", status: "CHECKED_OUT" }, error: "Cannot revert terminal visit status" },
    }] as any)
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-dup-conflict",
        op: "update",
        entity: "visits",
        data: { id: "visit-x", status: "CHECKED_IN" },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("conflict")
    expect(json.results[0].error).toBe("Cannot revert terminal visit status")
    expect(json.results[0].serverData).toEqual({ id: "visit-x", status: "CHECKED_OUT" })
    // replayed, not reprocessed
    expect(vi.mocked(prisma.mtmSyncOperation.create)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.mtmVisit.update)).not.toHaveBeenCalled()
  })

  it("returns 400 when request body is not valid JSON", async () => {
    const badReq = new NextRequest(
      new URL("http://localhost:3000/api/v1/mtm/mobile/sync/push"),
      {
        method: "POST",
        body: "not-json{{{",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
      },
    )
    const res = await PushPOST(badReq)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/invalid json/i)
  })

  it("visit update: returns error when data.id is missing", async () => {
    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-v4",
        op: "update",
        entity: "visits",
        data: { status: "CHECKED_OUT" }, // no id
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0].status).toBe("error")
    expect(json.results[0].error).toMatch(/data\.id required/i)
  })

  it("creates and audits an agent-owned offline task", async () => {
    vi.mocked(prisma.mtmTask.create).mockResolvedValue({
      id: "task-mobile-1",
      title: "Call the new clinic",
      status: "PENDING",
      priority: "HIGH",
      version: 1,
      customerId: "cust-1",
    } as never)
    vi.mocked(prisma.mtmTaskEvent.create).mockResolvedValue({ id: "task-event-created" } as never)

    const res = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-t2",
        op: "create",
        entity: "tasks",
        data: {
          id: "task-mobile-1",
          title: "Call the new clinic",
          customerId: "cust-1",
          priority: "HIGH",
          dueDate: "2026-07-16T09:00:00.000Z",
        },
        clientTimestamp: new Date("2026-07-15T08:00:00.000Z").getTime(),
      }],
    }))
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ status: "ok", serverId: "task-mobile-1" })
    expect(prisma.mtmTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: "task-mobile-1",
        organizationId: ORG,
        agentId: AGENT_ID,
        sourceKey: "mobile-self:task-mobile-1",
        status: "PENDING",
      }),
    }))
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clientEventId: "op-t2",
        taskId: "task-mobile-1",
        type: "CREATED",
      }),
    }))
  })

  it("rejects a recurring mobile copy before entering the sync transaction", async () => {
    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-task-copy-recurring",
      op: "create",
      entity: "tasks",
      data: {
        id: "task-mobile-copy",
        title: "Copy",
        copiedFromId: "task-1",
        dueDate: "2026-08-10T09:00:00.000Z",
        recurrence: { rule: "WEEKLY", interval: 1 },
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "error" })
    expect(body.results[0].error).toMatch(/one-off/i)
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })

  it("stores an offline task comment as an immutable event", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "task-1" } as never)
    vi.mocked(prisma.mtmTaskEvent.create).mockResolvedValue({
      id: "event-comment-1",
      taskId: "task-1",
      type: "COMMENTED",
      occurredAt: new Date("2026-07-15T10:00:00.000Z"),
      comment: "Doctor asked to call tomorrow",
      evidence: null,
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-task-comment",
      op: "create",
      entity: "taskEvents",
      data: {
        taskId: "task-1",
        type: "COMMENTED",
        occurredAt: "2026-07-15T10:00:00.000Z",
        comment: "Doctor asked to call tomorrow",
        evidence: { actorAgentId: "spoofed-agent", kind: "spoofed-kind" },
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "ok", serverId: "event-comment-1" })
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG,
        agentId: AGENT_ID,
        clientEventId: "op-task-comment",
        comment: "Doctor asked to call tomorrow",
        evidence: {
          kind: "MTM_TASK_CLIENT_EVENT",
          clientKind: "COMMENTED",
          source: "MOBILE_SYNC",
          actorAgentId: AGENT_ID,
          clientEvidence: { actorAgentId: "spoofed-agent", kind: "spoofed-kind" },
        },
      }),
    }))
  })

  it("does not append an offline task event after ownership/version fencing is lost", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
      id: "task-1", status: "PENDING", version: 3,
    } as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 0 } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-task-event-race",
      op: "create",
      entity: "taskEvents",
      data: {
        taskId: "task-1",
        type: "COMMENTED",
        occurredAt: "2026-07-15T10:00:00.000Z",
        comment: "must not cross reassignment",
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "conflict",
      serverData: { code: "MTM_TASK_SCOPE_CHANGED" },
    })
    expect(prisma.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it("applies and pins an offline workday start", async () => {
    const occurredAt = new Date(Date.now() - 60_000).toISOString()
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAgentWorkday.create).mockResolvedValue({
      id: "workday-mobile-1",
      workDate: new Date("2026-07-14T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-14T05:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      startLatitude: 0,
      startLongitude: 0,
      endLatitude: null,
      endLongitude: null,
      createdAt: new Date("2026-07-14T05:00:00.000Z"),
      updatedAt: new Date("2026-07-14T05:00:00.000Z"),
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockResolvedValue({
      id: "op-workday-start",
      workdayId: "workday-mobile-1",
      clientEventId: "op-workday-start",
      type: "START",
      occurredAt: new Date("2026-07-14T05:00:00.000Z"),
    } as never)

    const response = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-workday-start",
        op: "create",
        entity: "workdays",
        data: {
          action: "START",
          id: "workday-mobile-1",
          occurredAt,
          latitude: 0,
          longitude: 0,
        },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await response.json()

    expect(json.results[0]).toMatchObject({
      operationId: "op-workday-start",
      status: "ok",
      serverId: "workday-mobile-1",
      serverData: { workday: { status: "STARTED" }, event: { type: "START" } },
    })
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operationId: "op-workday-start",
        entity: "workdays",
        status: "ok",
      }),
    }))
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    const lockCall = vi.mocked(prisma.$executeRaw).mock.calls[0] as unknown as [TemplateStringsArray, string]
    expect(lockCall[0].join("?")).toContain("pg_advisory_xact_lock")
    expect(lockCall[1]).toBe(`mtm-workday:${ORG}:${AGENT_ID}`)
    expect(vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.mtmAgentWorkday.findFirst).mock.invocationCallOrder[0])
  })

  it("does not pin a successful workday sync result when its transactional audit write fails", async () => {
    const occurredAt = new Date(Date.now() - 60_000).toISOString()
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAgentWorkday.create).mockResolvedValue({
      id: "workday-audit-failure-1",
      workDate: new Date(occurredAt),
      status: "STARTED",
      startedAt: new Date(occurredAt),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      startLatitude: null,
      startLongitude: null,
      endLatitude: null,
      endLongitude: null,
      createdAt: new Date(occurredAt),
      updatedAt: new Date(occurredAt),
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockResolvedValue({
      id: "event-audit-failure-1",
      workdayId: "workday-audit-failure-1",
      clientEventId: "op-workday-audit-failure",
      type: "START",
      occurredAt: new Date(occurredAt),
    } as never)
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValue(new Error("audit storage unavailable"))

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-workday-audit-failure",
      op: "create",
      entity: "workdays",
      data: { action: "START", id: "workday-audit-failure-1", occurredAt },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      operationId: "op-workday-audit-failure",
      status: "error",
      error: "Internal error, retry",
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmSyncOperation.create).not.toHaveBeenCalled()
  })

  it("allows a Routes-only field session without the Workforce write fence or side effects", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH_CONTEXT,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAgentWorkday.create).mockResolvedValue({
      id: "route-session-1",
      workDate: new Date("2026-07-14T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-14T05:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      startLatitude: null,
      startLongitude: null,
      endLatitude: null,
      endLongitude: null,
      createdAt: new Date("2026-07-14T05:00:00.000Z"),
      updatedAt: new Date("2026-07-14T05:00:00.000Z"),
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockResolvedValue({
      id: "event-route-session-1",
      workdayId: "route-session-1",
      clientEventId: "op-route-session-start",
      type: "START",
      occurredAt: new Date("2026-07-14T05:00:00.000Z"),
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-route-session-start",
      op: "create",
      entity: "workdays",
      data: {
        action: "START",
        id: "route-session-1",
        occurredAt: "2026-07-14T05:00:00.000Z",
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      operationId: "op-route-session-start",
      status: "ok",
      serverId: "route-session-1",
      serverData: { workday: { status: "STARTED" }, event: { type: "START" } },
    })
    expect(evaluateWorkforceMobileWriteAccess).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "workdays", operationId: "op-route-session-start", status: "ok" }),
    }))
  })

  it("returns the server workday and safe recovery actions for an offline conflict", async () => {
    const occurredAt = new Date(Date.now() - 60_000).toISOString()
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-paused-1",
      workDate: new Date("2026-07-14T00:00:00.000Z"),
      status: "PAUSED",
      startedAt: new Date("2026-07-14T05:00:00.000Z"),
      pausedAt: new Date("2026-07-14T06:00:00.000Z"),
      completedAt: null,
      totalPausedSeconds: 0,
      startLatitude: null,
      startLongitude: null,
      endLatitude: null,
      endLongitude: null,
      createdAt: new Date("2026-07-14T05:00:00.000Z"),
      updatedAt: new Date("2026-07-14T06:00:00.000Z"),
    } as never)

    const response = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-workday-pause-while-paused",
        op: "create",
        entity: "workdays",
        data: {
          action: "PAUSE",
          workdayId: "workday-paused-1",
          occurredAt,
        },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await response.json()

    expect(json.results[0]).toMatchObject({
      operationId: "op-workday-pause-while-paused",
      status: "conflict",
      serverData: {
        code: "MTM_WORKDAY_NOT_RUNNING",
        workday: { id: "workday-paused-1", status: "PAUSED" },
        allowedActions: ["RESUME", "FINISH"],
      },
    })
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operationId: "op-workday-pause-while-paused",
        status: "conflict",
        result: expect.objectContaining({
          serverData: expect.objectContaining({ allowedActions: ["RESUME", "FINISH"] }),
        }),
      }),
    }))
  })

  it("replays and pins a web-origin workday event through offline sync", async () => {
    const occurredAt = new Date(Date.now() - 60_000).toISOString()
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue({
      id: "event-web-1",
      workdayId: "workday-cross-channel",
      clientEventId: "event-cross-channel",
      type: "START",
      occurredAt: new Date(occurredAt),
      latitude: 0,
      longitude: 0,
      accuracy: 5,
      note: null,
      createdAt: new Date("2026-07-14T05:00:00.000Z"),
      workday: {
        id: "workday-cross-channel",
        workDate: new Date("2026-07-14T00:00:00.000Z"),
        status: "STARTED",
        startedAt: new Date("2026-07-14T05:00:00.000Z"),
        pausedAt: null,
        completedAt: null,
        totalPausedSeconds: 0,
        startLatitude: 0,
        startLongitude: 0,
        endLatitude: null,
        endLongitude: null,
        createdAt: new Date("2026-07-14T05:00:00.000Z"),
        updatedAt: new Date("2026-07-14T05:00:00.000Z"),
      },
    } as never)

    const response = await PushPOST(makePushReq({
      operations: [{
        operationId: "event-cross-channel",
        op: "create",
        entity: "workdays",
        data: {
          action: "START",
          id: "workday-cross-channel",
          occurredAt,
          latitude: 0,
          longitude: 0,
          accuracy: 5,
        },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await response.json()

    expect(json.results[0]).toMatchObject({
      operationId: "event-cross-channel",
      status: "ok",
      serverId: "workday-cross-channel",
      serverData: {
        idempotent: true,
        workday: { id: "workday-cross-channel", status: "STARTED" },
        event: { id: "event-web-1", clientEventId: "event-cross-channel" },
      },
    })
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operationId: "event-cross-channel",
        status: "ok",
        result: expect.objectContaining({
          serverData: expect.objectContaining({ idempotent: true }),
        }),
      }),
    }))
  })

  it("rejects a malformed workday transition before opening a transaction", async () => {
    const response = await PushPOST(makePushReq({
      operations: [{
        operationId: "op-workday-pause",
        op: "create",
        entity: "workdays",
        data: { action: "PAUSE", occurredAt: "2026-07-14T06:00:00.000Z" },
        clientTimestamp: Date.now(),
      }],
    }))
    const json = await response.json()

    expect(json.results[0]).toMatchObject({
      status: "error",
      error: "data.workdayId required for workday transition",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).not.toHaveBeenCalled()
  })

  it("creates an immutable commitment from an assigned visit and uploaded evidence", async () => {
    const submittedAt = new Date("2026-07-16T08:00:00.000Z")
    vi.mocked(prisma.mtmCommitment.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-commitment-1",
      customerId: "customer-1",
      contactId: "contact-1",
    } as never)
    vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({ id: "photo-promise-1" } as never)
    vi.mocked(prisma.mtmCommitment.create).mockResolvedValue({
      id: "commitment-1",
      clientCommitmentId: "client-commitment-1",
      visitId: "visit-commitment-1",
      customerId: "customer-1",
      contactId: "contact-1",
      productExternalId: "sku-1",
      productName: "ACC 200 mg",
      brandExternalId: null,
      brandName: "ACC",
      promisedQuantity: new Prisma.Decimal("12.50"),
      unit: "packs",
      dueAt: new Date("2026-07-20T18:00:00.000Z"),
      note: "Doctor agreed",
      evidencePhotoId: "photo-promise-1",
      submittedAt,
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-commitment-create-1",
      op: "create",
      entity: "commitments",
      data: {
        clientCommitmentId: "client-commitment-1",
        visitId: "visit-commitment-1",
        productExternalId: "sku-1",
        productName: "ACC 200 mg",
        brandName: "ACC",
        promisedQuantity: 12.5,
        unit: "packs",
        dueAt: "2026-07-20T18:00:00.000Z",
        note: "Doctor agreed",
        evidenceClientPhotoId: "mobile-photo-promise-1",
      },
      clientTimestamp: submittedAt.getTime(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "ok",
      serverId: "commitment-1",
      serverData: { promisedQuantity: 12.5, evidencePhotoId: "photo-promise-1" },
    })
    expect(prisma.mtmVisit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: ORG }),
    }))
    expect(prisma.mtmPhoto.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        agentId: AGENT_ID,
        visitId: "visit-commitment-1",
        clientPhotoId: "mobile-photo-promise-1",
        category: "commitment-promise",
      }),
    }))
    expect(prisma.mtmCommitment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG,
        agentId: AGENT_ID,
        customerId: "customer-1",
        contactId: "contact-1",
        evidencePhotoId: "photo-promise-1",
        submittedAt,
      }),
    }))
  })

  it("records fact and server-computed variance exactly once", async () => {
    const fulfilledAt = new Date("2026-07-20T10:00:00.000Z")
    vi.mocked(prisma.mtmCommitment.findFirst).mockResolvedValue({
      id: "commitment-1",
      customerId: "customer-1",
      promisedQuantity: new Prisma.Decimal(10),
      fulfillment: null,
    } as never)
    vi.mocked(prisma.mtmCommitmentFulfillment.create).mockResolvedValue({
      id: "fulfillment-1",
      commitmentId: "commitment-1",
      clientFulfillmentId: "client-fulfillment-1",
      outcome: "PARTIAL",
      actualQuantity: new Prisma.Decimal(4),
      varianceQuantity: new Prisma.Decimal(-6),
      note: "Four packs sold",
      evidencePhotoId: null,
      fulfilledAt,
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-commitment-fact-1",
      op: "create",
      entity: "commitmentFulfillments",
      data: {
        commitmentId: "commitment-1",
        clientFulfillmentId: "client-fulfillment-1",
        outcome: "PARTIAL",
        actualQuantity: 4,
        note: "Four packs sold",
      },
      clientTimestamp: fulfilledAt.getTime(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "ok",
      serverData: { actualQuantity: 4, varianceQuantity: -6 },
    })
    const createArgs = vi.mocked(prisma.mtmCommitmentFulfillment.create).mock.calls[0][0] as any
    expect(String(createArgs.data.varianceQuantity)).toBe("-6")
    expect(createArgs.data).toMatchObject({
      organizationId: ORG,
      agentId: AGENT_ID,
      commitmentId: "commitment-1",
      fulfilledAt,
    })
  })

  it("rejects a fact whose outcome contradicts promise-vs-fact quantity", async () => {
    vi.mocked(prisma.mtmCommitment.findFirst).mockResolvedValue({
      id: "commitment-1",
      customerId: "customer-1",
      promisedQuantity: new Prisma.Decimal(10),
      fulfillment: null,
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-commitment-fact-invalid",
      op: "create",
      entity: "commitmentFulfillments",
      data: {
        commitmentId: "commitment-1",
        clientFulfillmentId: "client-fulfillment-invalid",
        outcome: "FULFILLED",
        actualQuantity: 9,
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "conflict",
      serverData: { code: "MTM_COMMITMENT_OUTCOME_MISMATCH" },
    })
    expect(prisma.mtmCommitmentFulfillment.create).not.toHaveBeenCalled()
  })

  it("creates a pending brand potential from the mobile outbox with evidence", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: "cm000000000000000000201" } as never)
    vi.mocked(prisma.mtmFieldPotential.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{ id: "cm000000000000000000203" }] as never)
    vi.mocked(prisma.mtmFieldPotential.create).mockResolvedValue({
      id: "cm000000000000000000202",
      status: "PENDING",
      contactId: "cm000000000000000000201",
      agentId: AGENT_ID,
      updatedAt: new Date("2026-07-22T08:00:00.000Z"),
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-brand-potential-create",
      op: "create",
      entity: "brandPotentials",
      data: {
        contactId: "cm000000000000000000201",
        clientPotentialId: "mobile-potential-0001",
        brandExternalId: "brand-acc",
        brandName: "ACC",
        productExternalId: "product-acc-200",
        productName: "ACC 200 mg",
        categoryLabel: "B2",
        potentialValue: 80,
        coverageValue: 25,
        periodStart: "2026-07-01",
        source: "FIELD_INTERVIEW",
        provenance: { method: "doctor interview" },
        evidenceVisitIds: ["cm000000000000000000203"],
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "ok",
      serverId: "cm000000000000000000202",
    })
    expect(prisma.mtmFieldPotential.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG,
        contactId: "cm000000000000000000201",
        agentId: AGENT_ID,
        enteredByAgentId: AGENT_ID,
        brandExternalId: "brand-acc",
        formulaVersion: "2026.1",
        provenance: expect.objectContaining({
          professionalGlossary: expect.objectContaining({ definitionHash: "a".repeat(64) }),
        }),
        status: "PENDING",
        evidenceVisits: { create: [{ organizationId: ORG, visitId: "cm000000000000000000203" }] },
      }),
    }))
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operationId: "op-brand-potential-create",
        entity: "brandPotentials",
        status: "ok",
      }),
    }))
  })

  it("pins a brand potential conflict when evidence visits are outside the completed doctor scope", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: "cm000000000000000000201" } as never)
    vi.mocked(prisma.mtmFieldPotential.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-brand-potential-evidence",
      op: "create",
      entity: "brandPotentials",
      data: {
        contactId: "cm000000000000000000201",
        clientPotentialId: "mobile-potential-0002",
        brandExternalId: "brand-acc",
        brandName: "ACC",
        potentialValue: 80,
        coverageValue: 25,
        periodStart: "2026-07-01",
        source: "FIELD_INTERVIEW",
        evidenceVisitIds: ["cm000000000000000000203"],
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "conflict",
      serverData: { code: "MTM_BRAND_POTENTIAL_EVIDENCE_INVALID" },
    })
    expect(prisma.mtmFieldPotential.create).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "conflict" }),
    }))
  })

  it("returns a stable conflict for a reused brand potential client id with different payload", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: "cm000000000000000000201" } as never)
    vi.mocked(prisma.mtmFieldPotential.findFirst).mockResolvedValue({
      id: "cm000000000000000000202",
      contactId: "cm000000000000000000201",
      requestHash: "different",
      status: "PENDING",
      updatedAt: new Date("2026-07-22T08:00:00.000Z"),
    } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-brand-potential-idempotency",
      op: "create",
      entity: "brandPotentials",
      data: {
        contactId: "cm000000000000000000201",
        clientPotentialId: "mobile-potential-0003",
        brandExternalId: "brand-acc",
        brandName: "ACC",
        potentialValue: 80,
        coverageValue: 25,
        periodStart: "2026-07-01",
        source: "FIELD_INTERVIEW",
      },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({
      status: "conflict",
      serverData: { code: "MTM_BRAND_POTENTIAL_IDEMPOTENCY_CONFLICT" },
    })
    expect(prisma.mtmFieldPotential.create).not.toHaveBeenCalled()
  })

  it("ends an agent-owned brand potential through the mobile outbox without deleting history", async () => {
    vi.mocked(prisma.mtmFieldPotential.findFirst).mockResolvedValue({
      id: "cm000000000000000000202",
      contactId: "cm000000000000000000201",
      enteredByAgentId: AGENT_ID,
      status: "VERIFIED",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      contact: { id: "cm000000000000000000201" },
    } as never)
    vi.mocked(prisma.mtmFieldPotential.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await PushPOST(makePushReq({ operations: [{
      operationId: "op-brand-potential-end",
      op: "update",
      entity: "brandPotentials",
      data: { id: "cm000000000000000000202", periodEnd: "2026-07-31", reason: "New cycle" },
      clientTimestamp: Date.now(),
    }] }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "ok", serverId: "cm000000000000000000202" })
    expect(prisma.mtmFieldPotential.updateMany).toHaveBeenCalledWith({
      where: { id: "cm000000000000000000202", organizationId: ORG, status: { not: "ENDED" }, deletedAt: null },
      data: expect.objectContaining({ status: "ENDED", reviewComment: "New cycle" }),
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "BRAND_POTENTIAL_END" }),
    }))
  })
})
