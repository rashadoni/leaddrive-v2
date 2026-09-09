import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

vi.mock("@/lib/mtm/route-permissions", () => ({
  resolveMtmRouteActor: vi.fn(),
}))

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn(() => Promise.resolve()),
}))

import { GET, POST } from "@/app/api/v1/mtm/kpi/route"
import { GET as EXPORT_GET } from "@/app/api/v1/mtm/kpi/export/route"
import { requireAuth } from "@/lib/api-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { prisma } from "@/lib/prisma"
import { kpiPolicyHash } from "@/lib/mtm/kpi-policy"

const ORG_ID = "org-1"
const SESSION = {
  orgId: ORG_ID,
  userId: "manager-user",
  role: "user",
  email: "manager@example.com",
  name: "Manager",
}
const MANAGER_ACTOR = {
  agentId: "manager-1",
  role: "MANAGER",
  scopedAgentIds: ["agent-1", "agent-2"],
}
const KPI_POLICY_DEFINITION = {
  schemaVersion: 1 as const,
  formulaVersion: "SWM_PLAN_GPS_V1" as const,
  rounding: { mode: "HALF_UP" as const, scale: 1 as const },
  plan: { numerator: "VISITED_ROUTE_POINTS" as const, denominator: "NON_DRAFT_NON_CANCELLED_ROUTE_POINTS" as const },
  gps: { numerator: "COMPLETED_VISITS_WITH_VALID_CHECK_IN_AND_CHECK_OUT" as const, denominator: "COMPLETED_VISITS" as const },
  exclusions: ["DRAFT_ROUTES", "CANCELLED_ROUTES", "CANCELLED_VISITS", "SOFT_DELETED_RECORDS"] as const,
  visitTypeAliases: { DOUBLE: ["DOUBLE", "JOINT"], INDEPENDENT: ["INDEPENDENT", "SELF"] },
  reconciliationCases: [{
    name: "approved baseline",
    filter: { visitType: "ALL" as const, brandId: null },
    planPoints: [{ routePointId: "rp-1", agentId: "a-1", agentName: "A", customerId: "c-1", customerName: "C", contactId: null, date: "2026-07-01", visitType: "INDEPENDENT" as const, brandIds: [], completed: true }],
    visits: [{ visitId: "v-1", routePointId: "rp-1", agentId: "a-1", agentName: "A", customerId: "c-1", customerName: "C", contactId: null, date: "2026-07-01", visitType: "INDEPENDENT" as const, brandIds: [], completed: true, gpsConfirmed: true }],
    expected: { plan: { numerator: 1, denominator: 1, percentage: 100 }, gps: { numerator: 1, denominator: 1, percentage: 100 } },
  }],
}

function approvedKpiPolicy() {
  return {
    id: "kpi-policy-1", organizationId: ORG_ID, code: "SWM_PLAN_GPS", version: 1,
    nameRu: "KPI", nameAz: "KPI", nameEn: "KPI", schemaVersion: 1,
    definition: KPI_POLICY_DEFINITION, definitionHash: kpiPolicyHash(KPI_POLICY_DEFINITION),
    approvalReference: "SWISSMED-KPI-2026-01", sourceSystem: "SwissMed",
    sourceReference: null, sourceObservedAt: new Date("2026-06-30T00:00:00.000Z"),
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null,
    status: "ACTIVE", createdByUserId: "admin", signedByUserId: "admin",
    signedAt: new Date("2026-06-30T00:00:00.000Z"), activatedAt: new Date("2026-06-30T00:00:00.000Z"), retiredAt: null,
    createdAt: new Date("2026-06-30T00:00:00.000Z"), updatedAt: new Date("2026-06-30T00:00:00.000Z"),
  }
}

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/kpi${query}`)
}

function exportRequest(query = "") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/kpi/export${query}`)
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/kpi", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "vitest-kpi",
      "x-forwarded-for": "192.0.2.10",
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(SESSION as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(MANAGER_ACTOR as never)
  vi.mocked(writeMtmAudit).mockResolvedValue(undefined as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmFieldPotential.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmKpiPolicy.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "enterprise",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true },
  } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/v1/mtm/kpi", () => {
  it("returns 401 before reading KPI facts when there is no authenticated tenant principal", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json(
      { error: "Unauthorized" },
      { status: 401 },
    ) as never)

    const req = request("?from=2026-07-01&to=2026-08-01")
    const response = await GET(req)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
    expect(requireAuth).toHaveBeenCalledWith(req, "mtm", "read", { deferLegacyModuleGate: "mtm" })
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
  })

  it("returns the requireAuth 403 without resolving actor or reading tenant data", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json(
      { error: "Forbidden", message: "Module permission denied" },
      { status: 403 },
    ) as never)

    const req = request("?from=2026-07-01&to=2026-08-01")
    const response = await GET(req)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: "Forbidden",
      message: "Module permission denied",
    })
    expect(requireAuth).toHaveBeenCalledWith(req, "mtm", "read", { deferLegacyModuleGate: "mtm" })
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmFieldPotential.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.findMany).not.toHaveBeenCalled()
  })

  it.each([
    ["an unresolved MTM actor", null],
    ["a field agent", { agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] }],
  ])("requires manager-grade access for %s", async (_label, actor) => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(actor as never)

    const response = await GET(request("?from=2026-07-01&to=2026-08-01"))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "Manager access required" })
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
  })

  it("applies tenant timezone, manager scope, team and participant scope to every fact query", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "America/New_York" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Amina",
      status: "ACTIVE",
      teamId: "team-north",
      team: { name: "North" },
    }] as never)

    const response = await GET(request(
      "?from=2026-07-01&to=2026-08-01&teamId=team-north&visitType=ALL",
    ))

    expect(response.status).toBe(200)
    expect(resolveMtmRouteActor).toHaveBeenCalledWith(prisma, {
      organizationId: ORG_ID,
      userId: SESSION.userId,
      webRole: SESSION.role,
    })
    expect(prisma.mtmSetting.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
      select: { key: true, value: true },
    })
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG_ID,
        id: { in: ["agent-1", "agent-2"] },
        teamId: "team-north",
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 501,
    }))
    expect(prisma.mtmRoutePoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        deletedAt: null,
        route: {
          organizationId: ORG_ID,
          deletedAt: null,
          status: { notIn: ["DRAFT", "CANCELLED"] },
          OR: [
            { agentId: { in: ["agent-1"] } },
            {
              assignments: {
                some: {
                  agentId: { in: ["agent-1"] },
                  role: { not: "OBSERVER" },
                },
              },
            },
          ],
          date: {
            gte: new Date("2026-07-01T00:00:00.000Z"),
            lt: new Date("2026-08-01T00:00:00.000Z"),
          },
        },
      },
      take: 10_001,
    }))
    expect(prisma.mtmVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG_ID,
        deletedAt: null,
        OR: [
          { agentId: { in: ["agent-1"] } },
          {
            participants: {
              some: {
                agentId: { in: ["agent-1"] },
                role: { not: "OBSERVER" },
              },
            },
          },
        ],
        checkInAt: {
          gte: new Date("2026-07-01T04:00:00.000Z"),
          lt: new Date("2026-08-01T04:00:00.000Z"),
        },
      }),
      take: 10_001,
    }))
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
    const visitSelect = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any
    expect(visitSelect.select.actionResults).toEqual({
      where: { status: "COMPLETED" },
      select: { evidence: true, updatedAt: true },
    })
    expect((await response.json()).data.scope.timezone).toBe("America/New_York")
  })

  it("requests and preserves the deterministic roster order by name then immutable id", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Same Name", status: "ACTIVE", teamId: null, team: null },
      { id: "agent-2", name: "Same Name", status: "ACTIVE", teamId: null, team: null },
    ] as never)

    const response = await GET(request("?from=2026-07-01&to=2026-08-01"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 501,
    }))
    expect(body.data.agents.map((agent: { id: string }) => agent.id)).toEqual(["agent-1", "agent-2"])
  })

  it("returns no employees or facts for an explicitly requested out-of-scope employee", async () => {
    const response = await GET(request(
      "?from=2026-07-01&to=2026-08-01&agentId=agent-outside",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: {
        agents: [],
        teams: [],
        report: null,
        outOfScope: true,
      },
    })
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
  })

  it.each([
    [
      "an impossible calendar date",
      "?from=2026-02-30&to=2026-03-02",
      "Invalid date range (maximum 366 days)",
    ],
    [
      "a reversed range",
      "?from=2026-08-01&to=2026-07-01",
      "Invalid date range (maximum 366 days)",
    ],
    [
      "a range over 366 days",
      "?from=2025-01-01&to=2026-01-03",
      "Invalid date range (maximum 366 days)",
    ],
    [
      "an unsupported visit type",
      "?from=2026-07-01&to=2026-08-01&visitType=REMOTE",
      "visitType must be ALL, DOUBLE or INDEPENDENT",
    ],
  ])("rejects %s", async (_label, query, error) => {
    const response = await GET(request(query))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
  })

  it("returns an explainable, filter-preserving KPI response with source drill-down", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
      { key: "brandPotentialPerAgentEnabled", value: false },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Amina",
      status: "ACTIVE",
      teamId: "team-north",
      team: { name: "North" },
    }] as never)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([
      {
        id: "point-1",
        customerId: "customer-1",
        contactId: "contact-1",
        status: "VISITED",
        customer: { name: "Central Clinic" },
        route: {
          date: new Date("2026-07-14T00:00:00.000Z"),
          updatedAt: new Date("2026-07-14T12:00:00.000Z"),
          agentId: "agent-1",
          agent: { name: "Amina" },
          assignments: [{
            agentId: "agent-2",
            role: "PARTICIPANT",
            assignedAt: new Date("2026-07-01T00:00:00.000Z"),
            removedAt: null,
            agent: { name: "Samir" },
          }],
        },
      },
      {
        id: "point-unmatched",
        customerId: "customer-2",
        contactId: "contact-2",
        status: "PLANNED",
        customer: { name: "West Clinic" },
        route: {
          date: new Date("2026-07-14T00:00:00.000Z"),
          updatedAt: new Date("2026-07-14T12:00:00.000Z"),
          agentId: "agent-1",
          agent: { name: "Amina" },
          assignments: [{
            agentId: "agent-2",
            role: "PARTICIPANT",
            assignedAt: new Date("2026-07-01T00:00:00.000Z"),
            removedAt: null,
            agent: { name: "Samir" },
          }],
        },
      },
    ] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      {
        id: "visit-gps",
        agentId: "agent-1",
        customerId: "customer-1",
        contactId: "contact-1",
        routePointId: "point-1",
        status: "CHECKED_OUT",
        checkInAt: new Date("2026-07-14T08:00:00.000Z"),
        updatedAt: new Date("2026-07-14T08:30:00.000Z"),
        checkInLat: 40.41,
        checkInLng: 49.87,
        checkOutLat: 40.42,
        checkOutLng: 49.88,
        agent: { name: "Amina" },
        customer: { name: "Central Clinic" },
        requirementSnapshot: null,
        participants: [{
          agentId: "agent-2",
          joinedAt: new Date("2026-07-14T07:00:00.000Z"),
          leftAt: null,
          agent: { name: "Samir" },
        }],
        actionResults: [{
          evidence: { brandIds: ["brand-b"] },
          updatedAt: new Date("2026-07-14T08:29:00.000Z"),
        }],
      },
      {
        id: "visit-zero-gps",
        agentId: "agent-1",
        customerId: "customer-3",
        contactId: "contact-3",
        routePointId: null,
        status: "CHECKED_OUT",
        checkInAt: new Date("2026-07-14T09:00:00.000Z"),
        updatedAt: new Date("2026-07-14T09:30:00.000Z"),
        checkInLat: 0,
        checkInLng: 0,
        checkOutLat: 40.4,
        checkOutLng: 49.8,
        agent: { name: "Amina" },
        customer: { name: "East Clinic" },
        requirementSnapshot: { sourcePolicy: { visitType: "DOUBLE" } },
        participants: [],
        actionResults: [],
      },
      {
        id: "visit-out-of-range-gps",
        agentId: "agent-1",
        customerId: "customer-4",
        contactId: "contact-4",
        routePointId: null,
        status: "CHECKED_OUT",
        checkInAt: new Date("2026-07-14T10:00:00.000Z"),
        updatedAt: new Date("2026-07-14T10:30:00.000Z"),
        checkInLat: 40.4,
        checkInLng: 49.8,
        checkOutLat: 91,
        checkOutLng: 181,
        agent: { name: "Amina" },
        customer: { name: "South Clinic" },
        requirementSnapshot: { sourcePolicy: { visitType: "DOUBLE" } },
        participants: [],
        actionResults: [],
      },
    ] as never)
    vi.mocked(prisma.mtmFieldPotential.findMany).mockResolvedValue([
      {
        id: "potential-customer-1-brand-a",
        supersedesPotentialId: null,
        status: "VERIFIED",
        agentId: null,
        customerId: "customer-1",
        contactId: "contact-1",
        brandExternalId: "brand-a",
        brandName: "Brand Alpha",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T11:00:00.000Z"),
      },
      {
        id: "potential-customer-3-brand-a",
        supersedesPotentialId: null,
        status: "VERIFIED",
        agentId: null,
        customerId: "customer-3",
        contactId: "contact-3",
        brandExternalId: "brand-a",
        brandName: "Brand Alpha",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T11:00:00.000Z"),
      },
      {
        id: "potential-customer-4-brand-a",
        supersedesPotentialId: null,
        status: "VERIFIED",
        agentId: null,
        customerId: "customer-4",
        contactId: "contact-4",
        brandExternalId: "brand-a",
        brandName: "Brand Alpha",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T11:00:00.000Z"),
      },
      {
        id: "potential-customer-1-brand-b",
        supersedesPotentialId: null,
        status: "VERIFIED",
        agentId: null,
        customerId: "customer-1",
        contactId: "contact-1",
        brandExternalId: "brand-b",
        brandName: "Brand Beta",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T11:00:00.000Z"),
      },
    ] as never)

    const response = await GET(request(
      "?from=2026-07-01&to=2026-08-01&teamId=team-north&agentId=agent-1&visitType=double&brandId=brand-a",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(body.data.scope).toEqual({
      from: "2026-07-01",
      toExclusive: "2026-08-01",
      timezone: "UTC",
      teamId: "team-north",
      agentId: "agent-1",
      visitType: "DOUBLE",
      brandId: "brand-a",
    })
    expect(body.data.agents).toEqual([
      expect.objectContaining({ id: "agent-1", name: "Amina", teamId: "team-north" }),
    ])
    expect(body.data.teams).toEqual([{ id: "team-north", name: "North" }])
    expect(body.data.brands).toEqual([
      { id: "brand-a", name: "Brand Alpha" },
      { id: "brand-b", name: "Brand Beta" },
    ])
    expect(body.data.report.formula).toMatchObject({
      version: "SWM_PLAN_GPS_V1",
      generatedAt: expect.any(String),
      planDefinition: "visited route points / non-draft, non-cancelled route points",
      gpsDefinition: "completed visits with check-in and check-out coordinates / completed visits",
      exclusions: ["draft routes", "cancelled routes", "cancelled visits", "soft-deleted records"],
      adjustments: [],
    })
    expect(body.data.report.plan).toEqual({ numerator: 1, denominator: 1, percentage: 100 })
    expect(body.data.report.gps).toEqual({ numerator: 1, denominator: 3, percentage: 33.3 })
    expect(body.data.report.totals).toEqual({
      planned: 1,
      completedPlan: 1,
      completedVisits: 3,
      gpsConfirmedVisits: 1,
    })
    expect(body.data.report.drilldown.planDenominator.map((row: { routePointId: string }) => row.routePointId))
      .toEqual(["point-1"])
    expect(body.data.report.drilldown.gpsNumerator.map((row: { visitId: string }) => row.visitId))
      .toEqual(["visit-gps"])
    expect(body.data.report.drilldown.gpsDenominator.map((row: { visitId: string }) => row.visitId))
      .toEqual(["visit-gps", "visit-zero-gps", "visit-out-of-range-gps"])
    expect(body.data.report.trend).toEqual([
      expect.objectContaining({
        date: "2026-07-14",
        planned: 1,
        completed: 1,
        visits: 3,
        gps: 1,
        planPercentage: 100,
        gpsPercentage: 33.3,
      }),
    ])
    const potentialQuery = vi.mocked(prisma.mtmFieldPotential.findMany).mock.calls[0][0] as any
    expect(potentialQuery).toMatchObject({
      where: {
        organizationId: ORG_ID,
        deletedAt: null,
        brandExternalId: { not: null },
        AND: [
          { agentId: null },
          {
            OR: [
              { customerId: { in: ["customer-1", "customer-2", "customer-3", "customer-4"] } },
              { contactId: { in: ["contact-1", "contact-2", "contact-3", "contact-4"] } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10_001,
      select: {
        id: true,
        supersedesPotentialId: true,
        status: true,
        agentId: true,
        customerId: true,
        contactId: true,
        brandExternalId: true,
        brandName: true,
        periodStart: true,
        periodEnd: true,
        updatedAt: true,
      },
    })
    expect(potentialQuery.where).not.toHaveProperty("status")
    expect(potentialQuery.where).not.toHaveProperty("supersededBy")
    expect(body.data.contract).toEqual({
      workforceEnabled: true,
      maxFacts: 10_000,
      maxAgents: 500,
      truncated: false,
      truncationReasons: [],
      partialLimit: null,
      brandSource: "effective verified/ended period-overlapping field potential or explicit visit action evidence",
      visitTypeSource: "policy snapshot; otherwise non-observer participant assignment",
      aggregationSemantics: "team totals count each fact once; an employee filter credits a joint fact to every active non-observer participant, so employee totals are intentionally non-additive",
      displayAttributionSemantics: "the selected primary owner is displayed first; otherwise the name/id-sorted credited participant is displayed, while attributedAgents lists the complete credited cohort",
      brandAttributionSemantics: "shared potential or date-valid potential for an agent credited by the applied cohort; explicit completed visit-action evidence remains fact-bound",
      teamScopeSemantics: "authorization and team filters use the current roster; fact attribution inside that scope uses route-date and visit-time assignments",
      routePointVisitResolution: "any completed linked visit completes the point; completed then GPS-confirmed then immutable visit id selects visit-type evidence; brand evidence is unioned",
      sourceFreshnessSemantics: "age of the latest candidate business-fact change in the tenant/manager/date scope before visit-type and brand filtering; not a collector heartbeat",
      snapshotReadConsistency: "READ_COMMITTED_BEST_EFFORT; snapshotId identifies the exact assembled response and export rejects a changed snapshot",
      adjustmentSemantics: {
        PLAN_POINT: "excluded from plan numerator and denominator",
        GPS_VISIT: "GPS evidence excluded from numerator; completed visit remains in denominator",
      },
      policySemantics: "authoritative only when one coherent signed KPI policy covers the complete requested period and all fact cohorts are complete",
    })
  })

  it("applies the latest audited exclusion to totals and keeps the source fact explainable", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Amina",
      teamId: "team-north",
      team: { name: "North" },
    }] as never)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      id: "point-excluded",
      customerId: "customer-1",
      contactId: "contact-1",
      status: "VISITED",
      customer: { name: "Central Clinic" },
      route: {
        date: new Date("2026-07-14T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T12:00:00.000Z"),
        agentId: "agent-1",
        agent: { name: "Amina" },
        assignments: [],
      },
    }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      id: "visit-kept",
      agentId: "agent-1",
      customerId: "customer-1",
      contactId: "contact-1",
      routePointId: "point-excluded",
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-07-14T08:00:00.000Z"),
      updatedAt: new Date("2026-07-14T08:30:00.000Z"),
      checkInLat: 40.41,
      checkInLng: 49.87,
      checkOutLat: 40.42,
      checkOutLng: 49.88,
      agent: { name: "Amina" },
      customer: { name: "Central Clinic" },
      requirementSnapshot: { sourcePolicy: { visitType: "INDEPENDENT" } },
      participants: [],
      actionResults: [],
    }] as never)
    vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([{
      id: "audit-plan-exclude",
      action: "KPI_FACT_EXCLUDED",
      entityId: "point-excluded",
      agentId: "manager-1",
      newData: {
        factType: "PLAN_POINT",
        reason: "Duplicate plan source row",
        formulaVersion: "SWM_PLAN_GPS_V1",
      },
      createdAt: new Date("2026-07-15T09:00:00.000Z"),
    }] as never)

    const response = await GET(request("?from=2026-07-01&to=2026-08-01"))
    const report = (await response.json()).data.report

    expect(response.status).toBe(200)
    expect(prisma.mtmAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG_ID,
        entity: "kpi_fact",
        action: { in: ["KPI_FACT_EXCLUDED", "KPI_FACT_RESTORED"] },
        entityId: { in: ["point-excluded", "visit-kept"] },
      },
    }))
    expect(report.plan).toEqual({ numerator: 0, denominator: 0, percentage: 0 })
    expect(report.gps).toEqual({ numerator: 1, denominator: 1, percentage: 100 })
    expect(report.formula.adjustments).toEqual([{
      factType: "PLAN_POINT",
      factId: "point-excluded",
      action: "EXCLUDE",
      reason: "Duplicate plan source row",
      createdAt: "2026-07-15T09:00:00.000Z",
      actorAgentId: "manager-1",
      auditId: "audit-plan-exclude",
    }])
    expect(report.drilldown.planDenominator).toEqual([])
    expect(report.drilldown.exclusions.planPoints).toEqual([
      expect.objectContaining({ routePointId: "point-excluded", customerId: "customer-1" }),
    ])
  })

  it("deterministically prefers completed evidence when multiple visits reference one route point", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Amina",
      status: "ACTIVE",
      teamId: null,
      team: null,
    }] as never)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      id: "point-multiple-visits",
      customerId: "customer-1",
      contactId: "contact-1",
      status: "PLANNED",
      customer: { name: "Central Clinic" },
      route: {
        id: "route-1",
        date: new Date("2026-07-14T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T10:00:00.000Z"),
        agentId: "agent-1",
        agent: { name: "Amina" },
        assignments: [],
      },
    }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      {
        id: "visit-completed-evidence",
        agentId: "agent-1",
        customerId: "customer-1",
        contactId: "contact-1",
        routePointId: "point-multiple-visits",
        status: "CHECKED_OUT",
        checkInAt: new Date("2026-07-14T08:00:00.000Z"),
        updatedAt: new Date("2026-07-14T08:30:00.000Z"),
        checkInLat: 40.41,
        checkInLng: 49.87,
        checkOutLat: 40.42,
        checkOutLng: 49.88,
        agent: { name: "Amina" },
        customer: { name: "Central Clinic" },
        requirementSnapshot: { sourcePolicy: { visitType: "INDEPENDENT" } },
        participants: [],
        actionResults: [{
          evidence: { brandIds: ["brand-completed"] },
          updatedAt: new Date("2026-07-14T08:29:00.000Z"),
        }],
      },
      {
        id: "visit-later-incomplete",
        agentId: "agent-1",
        customerId: "customer-1",
        contactId: "contact-1",
        routePointId: "point-multiple-visits",
        status: "CHECKED_IN",
        checkInAt: new Date("2026-07-14T09:00:00.000Z"),
        updatedAt: new Date("2026-07-14T09:30:00.000Z"),
        checkInLat: 40.41,
        checkInLng: 49.87,
        checkOutLat: null,
        checkOutLng: null,
        agent: { name: "Amina" },
        customer: { name: "Central Clinic" },
        requirementSnapshot: { sourcePolicy: { visitType: "DOUBLE" } },
        participants: [],
        actionResults: [{
          evidence: { brandIds: ["brand-incomplete"] },
          updatedAt: new Date("2026-07-14T09:29:00.000Z"),
        }],
      },
    ] as never)

    const response = await GET(request("?from=2026-07-01&to=2026-08-01"))
    const body = await response.json()
    const planFact = body.data.report.drilldown.planDenominator[0]

    expect(response.status).toBe(200)
    expect(planFact).toMatchObject({
      routePointId: "point-multiple-visits",
      completed: true,
      visitType: "INDEPENDENT",
      brandIds: ["brand-completed", "brand-incomplete"],
    })
    expect(body.data.report.plan).toEqual({ numerator: 1, denominator: 1, percentage: 100 })
  })

  it("classifies PRIMARY-only plan points as INDEPENDENT and PARTICIPANT points as DOUBLE", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Amina",
      status: "ACTIVE",
      teamId: null,
      team: null,
    }] as never)
    const point = (id: string, role: "PRIMARY" | "PARTICIPANT") => ({
      id,
      customerId: `customer-${id}`,
      contactId: null,
      status: "PLANNED",
      customer: { name: `Clinic ${id}` },
      route: {
        id: `route-${id}`,
        date: new Date("2026-07-14T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T12:00:00.000Z"),
        agentId: "agent-1",
        agent: { name: "Amina" },
        assignments: [{
          agentId: "agent-2",
          role,
          assignedAt: new Date("2026-07-01T00:00:00.000Z"),
          removedAt: null,
          agent: { name: "Samir" },
        }],
      },
    })
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([
      point("point-primary-only", "PRIMARY"),
      point("point-participant", "PARTICIPANT"),
    ] as never)

    const independentResponse = await GET(request(
      "?from=2026-07-01&to=2026-08-01&visitType=INDEPENDENT",
    ))
    const independentBody = await independentResponse.json()
    const doubleResponse = await GET(request(
      "?from=2026-07-01&to=2026-08-01&visitType=DOUBLE",
    ))
    const doubleBody = await doubleResponse.json()

    expect(independentResponse.status).toBe(200)
    expect(independentBody.data.report.plan).toEqual({ numerator: 0, denominator: 1, percentage: 0 })
    expect(independentBody.data.report.drilldown.planDenominator).toEqual([
      expect.objectContaining({
        routePointId: "point-primary-only",
        visitType: "INDEPENDENT",
      }),
    ])
    expect(doubleResponse.status).toBe(200)
    expect(doubleBody.data.report.plan).toEqual({ numerator: 0, denominator: 1, percentage: 0 })
    expect(doubleBody.data.report.drilldown.planDenominator).toEqual([
      expect.objectContaining({
        routePointId: "point-participant",
        visitType: "DOUBLE",
      }),
    ])
    const routeQuery = vi.mocked(prisma.mtmRoutePoint.findMany).mock.calls[0][0] as any
    expect(routeQuery.select.route.select.assignments.select).toMatchObject({
      agentId: true,
      role: true,
      assignedAt: true,
      removedAt: true,
    })
  })

  it("attributes a joint fact and brand potential only to participant B, never out-of-scope primary A", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Visible Participant",
      status: "ACTIVE",
      teamId: "team-visible",
      team: { name: "Visible Team" },
    }] as never)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      id: "point-joint",
      customerId: "customer-1",
      contactId: "contact-1",
      status: "VISITED",
      customer: { name: "Central Clinic" },
      route: {
        date: new Date("2026-07-14T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T10:00:00.000Z"),
        agentId: "agent-private-primary",
        agent: { name: "Private Primary Name" },
        assignments: [{
          agentId: "agent-1",
          role: "PARTICIPANT",
          assignedAt: new Date("2026-07-01T00:00:00.000Z"),
          removedAt: null,
          agent: { name: "Visible Participant" },
        }],
      },
    }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      id: "visit-joint",
      agentId: "agent-private-primary",
      customerId: "customer-1",
      contactId: "contact-1",
      routePointId: "point-joint",
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-07-14T08:00:00.000Z"),
      updatedAt: new Date("2026-07-14T10:30:00.000Z"),
      checkInLat: 40.41,
      checkInLng: 49.87,
      checkOutLat: 40.42,
      checkOutLng: 49.88,
      agent: { name: "Private Primary Name" },
      customer: { name: "Central Clinic" },
      requirementSnapshot: { sourcePolicy: { visitType: "DOUBLE" } },
      participants: [{
        agentId: "agent-1",
        joinedAt: new Date("2026-07-14T07:00:00.000Z"),
        leftAt: null,
        agent: { name: "Visible Participant" },
      }],
      actionResults: [],
    }] as never)
    vi.mocked(prisma.mtmFieldPotential.findMany).mockResolvedValue([
      {
        id: "potential-primary-a",
        supersedesPotentialId: null,
        status: "VERIFIED",
        agentId: "agent-private-primary",
        customerId: "customer-1",
        contactId: "contact-1",
        brandExternalId: "brand-primary-a",
        brandName: "Private Primary Brand",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T11:00:00.000Z"),
      },
      {
        id: "potential-participant-b",
        supersedesPotentialId: null,
        status: "VERIFIED",
        agentId: "agent-1",
        customerId: "customer-1",
        contactId: "contact-1",
        brandExternalId: "brand-participant-b",
        brandName: "Visible Participant Brand",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T11:30:00.000Z"),
      },
    ] as never)

    const response = await GET(request(
      "?from=2026-07-01&to=2026-08-01&agentId=agent-1",
    ))
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.data.report.drilldown.planDenominator).toEqual([
      expect.objectContaining({
        routePointId: "point-joint",
        agentId: "agent-1",
        agentName: "Visible Participant",
        sourceAgentId: null,
        sourceAgentName: null,
        attributedAgentIds: ["agent-1"],
        brandIds: ["brand-participant-b"],
      }),
    ])
    expect(body.data.report.drilldown.gpsDenominator).toEqual([
      expect.objectContaining({
        visitId: "visit-joint",
        agentId: "agent-1",
        agentName: "Visible Participant",
        sourceAgentId: null,
        sourceAgentName: null,
        attributedAgentIds: ["agent-1"],
        brandIds: ["brand-participant-b"],
      }),
    ])
    expect(body.data.brands).toEqual([
      { id: "brand-participant-b", name: "Visible Participant Brand" },
    ])
    const potentialQuery = vi.mocked(prisma.mtmFieldPotential.findMany).mock.calls[0][0] as any
    expect(potentialQuery.where.AND[0]).toEqual({ agentId: { in: ["agent-1"] } })
    expect(serialized).not.toContain("agent-private-primary")
    expect(serialized).not.toContain("Private Primary Name")
    expect(serialized).not.toContain("brand-primary-a")
    expect(serialized).not.toContain("Private Primary Brand")
  })

  it("bounds workday enrichment to exact credited agent/date pairs from completed visits", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Amina", status: "ACTIVE", teamId: null, team: null },
      { id: "agent-2", name: "Samir", status: "ACTIVE", teamId: null, team: null },
    ] as never)
    const visit = (input: {
      id: string
      agentId: string
      agentName: string
      checkInAt: string
      status: "CHECKED_OUT" | "CHECKED_IN"
      participants?: Array<{
        agentId: string
        joinedAt: Date
        leftAt: Date | null
        agent: { name: string }
      }>
    }) => ({
      id: input.id,
      agentId: input.agentId,
      customerId: `customer-${input.id}`,
      contactId: `contact-${input.id}`,
      routePointId: null,
      status: input.status,
      checkInAt: new Date(input.checkInAt),
      updatedAt: new Date(input.checkInAt),
      checkInLat: 40.4,
      checkInLng: 49.8,
      checkOutLat: input.status === "CHECKED_OUT" ? 40.4 : null,
      checkOutLng: input.status === "CHECKED_OUT" ? 49.8 : null,
      agent: { name: input.agentName },
      customer: { name: `Clinic ${input.id}` },
      requirementSnapshot: null,
      participants: input.participants ?? [],
      actionResults: [],
    })
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      visit({
        id: "joint-a-b",
        agentId: "agent-1",
        agentName: "Amina",
        checkInAt: "2026-07-14T08:00:00.000Z",
        status: "CHECKED_OUT",
        participants: [{
          agentId: "agent-2",
          joinedAt: new Date("2026-07-14T07:00:00.000Z"),
          leftAt: null,
          agent: { name: "Samir" },
        }],
      }),
      visit({
        id: "second-a",
        agentId: "agent-1",
        agentName: "Amina",
        checkInAt: "2026-07-14T10:00:00.000Z",
        status: "CHECKED_OUT",
      }),
      visit({
        id: "independent-b",
        agentId: "agent-2",
        agentName: "Samir",
        checkInAt: "2026-07-15T08:00:00.000Z",
        status: "CHECKED_OUT",
      }),
      visit({
        id: "open-b",
        agentId: "agent-2",
        agentName: "Samir",
        checkInAt: "2026-07-16T08:00:00.000Z",
        status: "CHECKED_IN",
      }),
    ] as never)
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([
      {
        id: "workday-a-14",
        agentId: "agent-1",
        workDate: new Date("2026-07-14T00:00:00.000Z"),
        status: "COMPLETED",
        updatedAt: new Date("2026-07-14T18:00:00.000Z"),
      },
      {
        id: "workday-b-15",
        agentId: "agent-2",
        workDate: new Date("2026-07-15T00:00:00.000Z"),
        status: "PAUSED",
        updatedAt: new Date("2026-07-15T12:00:00.000Z"),
      },
    ] as never)

    const response = await GET(request("?from=2026-07-01&to=2026-08-01"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(prisma.mtmAgentWorkday.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        OR: [
          {
            agentId: "agent-1",
            workDate: { in: [new Date("2026-07-14T00:00:00.000Z")] },
          },
          {
            agentId: "agent-2",
            workDate: { in: [new Date("2026-07-15T00:00:00.000Z")] },
          },
        ],
      },
      orderBy: [{ workDate: "asc" }, { agentId: "asc" }],
      take: 10_001,
      select: {
        id: true,
        agentId: true,
        workDate: true,
        status: true,
        updatedAt: true,
      },
    })
    expect(body.data.report.drilldown.gpsDays).toEqual([
      expect.objectContaining({
        agentId: "agent-1",
        date: "2026-07-14",
        completedVisits: 2,
        workdayId: "workday-a-14",
        workdayState: "COMPLETED",
      }),
      expect.objectContaining({
        agentId: "agent-2",
        date: "2026-07-15",
        completedVisits: 1,
        workdayId: "workday-b-15",
        workdayState: "PAUSED",
      }),
    ])
  })

  it("keeps Routes-only KPI available without querying Workforce workdays", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "timezone", value: "UTC" }] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1", name: "Amina", status: "ACTIVE", teamId: null, team: null,
    }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      id: "visit-1",
      agentId: "agent-1",
      customerId: "customer-1",
      contactId: null,
      routePointId: null,
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-07-14T08:00:00.000Z"),
      updatedAt: new Date("2026-07-14T09:00:00.000Z"),
      checkInLat: 40.4,
      checkInLng: 49.8,
      checkOutLat: 40.4,
      checkOutLng: 49.8,
      agent: { name: "Amina" },
      customer: { name: "Clinic" },
      requirementSnapshot: null,
      participants: [],
      actionResults: [],
    }] as never)

    const response = await GET(request("?from=2026-07-01&to=2026-08-01"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.contract.workforceEnabled).toBe(false)
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
    expect(body.data.report.drilldown.gpsDays[0]).not.toHaveProperty("workdayId")
    expect(body.data.report.drilldown.gpsDays[0]).not.toHaveProperty("workdayState")

    vi.mocked(prisma.mtmKpiPolicy.findFirst).mockResolvedValue(approvedKpiPolicy() as never)
    const exportResponse = await EXPORT_GET(exportRequest("?from=2026-07-01&to=2026-08-01"))
    const csv = await exportResponse.text()
    expect(exportResponse.status).toBe(200)
    expect(csv).not.toContain('"workdayId"')
    expect(csv).not.toContain('"workdayState"')
  })

  it("attributes removed assignments and participants only when they were active at the fact event", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Historical Participant",
      status: "ACTIVE",
      teamId: null,
      team: null,
    }] as never)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([
      {
        id: "point-historical-visible",
        customerId: "customer-visible",
        contactId: "contact-visible",
        status: "VISITED",
        customer: { name: "Visible Historical Clinic" },
        route: {
          id: "route-historical-visible",
          date: new Date("2026-07-14T00:00:00.000Z"),
          updatedAt: new Date("2026-07-14T10:00:00.000Z"),
          agentId: "agent-private-primary",
          agent: { name: "Private Primary Name" },
          assignments: [{
            agentId: "agent-1",
            role: "PARTICIPANT",
            assignedAt: new Date("2026-07-01T00:00:00.000Z"),
            removedAt: new Date("2026-07-15T00:00:00.000Z"),
            agent: { name: "Historical Participant" },
          }],
        },
      },
      {
        id: "point-removed-before-day",
        customerId: "customer-hidden",
        contactId: "contact-hidden",
        status: "VISITED",
        customer: { name: "Hidden Historical Clinic" },
        route: {
          id: "route-removed-before-day",
          date: new Date("2026-07-14T00:00:00.000Z"),
          updatedAt: new Date("2026-07-14T10:00:00.000Z"),
          agentId: "agent-private-primary",
          agent: { name: "Private Primary Name" },
          assignments: [{
            agentId: "agent-1",
            role: "PARTICIPANT",
            assignedAt: new Date("2026-07-01T00:00:00.000Z"),
            removedAt: new Date("2026-07-13T23:59:59.000Z"),
            agent: { name: "Historical Participant" },
          }],
        },
      },
    ] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      {
        id: "visit-historical-visible",
        agentId: "agent-private-primary",
        customerId: "customer-visible",
        contactId: "contact-visible",
        routePointId: null,
        status: "CHECKED_OUT",
        checkInAt: new Date("2026-07-14T08:00:00.000Z"),
        updatedAt: new Date("2026-07-14T08:30:00.000Z"),
        checkInLat: 40.41,
        checkInLng: 49.87,
        checkOutLat: 40.42,
        checkOutLng: 49.88,
        agent: { name: "Private Primary Name" },
        customer: { name: "Visible Historical Clinic" },
        requirementSnapshot: { sourcePolicy: { visitType: "DOUBLE" } },
        participants: [{
          agentId: "agent-1",
          joinedAt: new Date("2026-07-01T00:00:00.000Z"),
          leftAt: new Date("2026-07-14T09:00:00.000Z"),
          agent: { name: "Historical Participant" },
        }],
        actionResults: [],
      },
      {
        id: "visit-left-before-check-in",
        agentId: "agent-private-primary",
        customerId: "customer-hidden",
        contactId: "contact-hidden",
        routePointId: null,
        status: "CHECKED_OUT",
        checkInAt: new Date("2026-07-14T08:00:00.000Z"),
        updatedAt: new Date("2026-07-14T08:30:00.000Z"),
        checkInLat: 40.41,
        checkInLng: 49.87,
        checkOutLat: 40.42,
        checkOutLng: 49.88,
        agent: { name: "Private Primary Name" },
        customer: { name: "Hidden Historical Clinic" },
        requirementSnapshot: { sourcePolicy: { visitType: "DOUBLE" } },
        participants: [{
          agentId: "agent-1",
          joinedAt: new Date("2026-07-01T00:00:00.000Z"),
          leftAt: new Date("2026-07-14T07:59:59.000Z"),
          agent: { name: "Historical Participant" },
        }],
        actionResults: [],
      },
    ] as never)

    const response = await GET(request(
      "?from=2026-07-01&to=2026-08-01&agentId=agent-1",
    ))
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.data.report.drilldown.planDenominator).toEqual([
      expect.objectContaining({
        routePointId: "point-historical-visible",
        agentId: "agent-1",
        agentName: "Historical Participant",
        attributedAgentIds: ["agent-1"],
        adjustable: false,
      }),
    ])
    expect(body.data.report.drilldown.gpsDenominator).toEqual([
      expect.objectContaining({
        visitId: "visit-historical-visible",
        agentId: "agent-1",
        agentName: "Historical Participant",
        attributedAgentIds: ["agent-1"],
        adjustable: false,
      }),
    ])
    expect(serialized).not.toContain("point-removed-before-day")
    expect(serialized).not.toContain("visit-left-before-check-in")
    expect(serialized).not.toContain("agent-private-primary")
    expect(serialized).not.toContain("Private Primary Name")

    const routeQuery = vi.mocked(prisma.mtmRoutePoint.findMany).mock.calls[0][0] as any
    expect(routeQuery.where.route.OR[1].assignments.some).toEqual({
      agentId: { in: ["agent-1"] },
      role: { not: "OBSERVER" },
    })
    expect(routeQuery.select.route.select.assignments.select).toMatchObject({
      agentId: true,
      role: true,
      assignedAt: true,
      removedAt: true,
    })
    const visitQuery = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any
    expect(visitQuery.where.OR[1].participants.some).toEqual({
      agentId: { in: ["agent-1"] },
      role: { not: "OBSERVER" },
    })
    expect(visitQuery.select.participants.select).toMatchObject({
      agentId: true,
      joinedAt: true,
      leftAt: true,
    })
  })

  it("evaluates route assignments against the Asia/Baku local-day boundaries", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "Asia/Baku" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Local-day Assignee",
      status: "ACTIVE",
      teamId: null,
      team: null,
    }] as never)

    const routePoint = (
      id: string,
      assignment: { assignedAt: Date; removedAt: Date | null },
    ) => ({
      id,
      customerId: `customer-${id}`,
      contactId: null,
      status: "PLANNED",
      customer: { name: `Clinic ${id}` },
      route: {
        id: `route-${id}`,
        date: new Date("2026-07-14T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T12:00:00.000Z"),
        agentId: "agent-private-primary",
        agent: { name: "Private Primary" },
        assignments: [{
          agentId: "agent-1",
          role: "PARTICIPANT",
          ...assignment,
          agent: { name: "Local-day Assignee" },
        }],
      },
    })
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([
      routePoint("assigned-inside", {
        assignedAt: new Date("2026-07-13T21:00:00.000Z"),
        removedAt: null,
      }),
      routePoint("removed-at-day-start", {
        assignedAt: new Date("2026-07-01T00:00:00.000Z"),
        removedAt: new Date("2026-07-13T20:00:00.000Z"),
      }),
      routePoint("removed-before-day", {
        assignedAt: new Date("2026-07-01T00:00:00.000Z"),
        removedAt: new Date("2026-07-13T19:59:00.000Z"),
      }),
      routePoint("assigned-at-next-day", {
        assignedAt: new Date("2026-07-14T20:00:00.000Z"),
        removedAt: null,
      }),
    ] as never)

    const response = await GET(request(
      "?from=2026-07-01&to=2026-08-01&agentId=agent-1",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.scope.timezone).toBe("Asia/Baku")
    expect(body.data.report.drilldown.planDenominator.map(
      (fact: { routePointId: string }) => fact.routePointId,
    )).toEqual([
      "assigned-inside",
      "removed-at-day-start",
    ])
    expect(JSON.stringify(body)).not.toContain("removed-before-day")
    expect(JSON.stringify(body)).not.toContain("assigned-at-next-day")
  })

  it("resolves a revision chain by fact date and never resurrects v1 after terminal v2 ends", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Amina",
      status: "ACTIVE",
      teamId: "team-1",
      team: { name: "Team 1" },
    }] as never)
    const point = (id: string, date: string) => ({
      id,
      customerId: "customer-shared",
      contactId: "contact-shared",
      status: "PLANNED",
      customer: { name: "Shared Clinic" },
      route: {
        date: new Date(`${date}T00:00:00.000Z`),
        updatedAt: new Date(`${date}T09:00:00.000Z`),
        agentId: "agent-1",
        agent: { name: "Amina" },
        assignments: [],
      },
    })
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([
      point("point-july", "2026-07-15"),
      point("point-august", "2026-08-15"),
      point("point-september", "2026-09-15"),
    ] as never)
    vi.mocked(prisma.mtmFieldPotential.findMany).mockResolvedValue([
      {
        id: "potential-v1",
        supersedesPotentialId: null,
        status: "ENDED",
        agentId: "agent-1",
        customerId: "customer-shared",
        contactId: "contact-shared",
        brandExternalId: "brand-v1",
        brandName: "Brand V1",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: null,
        updatedAt: new Date("2026-07-01T09:00:00.000Z"),
      },
      {
        id: "potential-v2",
        supersedesPotentialId: "potential-v1",
        status: "ENDED",
        agentId: "agent-1",
        customerId: "customer-shared",
        contactId: "contact-shared",
        brandExternalId: "brand-v2",
        brandName: "Brand V2",
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEnd: new Date("2026-08-31T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T09:00:00.000Z"),
      },
      {
        id: "potential-draft-v3",
        supersedesPotentialId: "potential-v2",
        status: "PENDING",
        agentId: "agent-1",
        customerId: "customer-shared",
        contactId: "contact-shared",
        brandExternalId: "brand-draft-v3",
        brandName: "Draft Brand V3",
        periodStart: new Date("2026-09-01T00:00:00.000Z"),
        periodEnd: null,
        updatedAt: new Date("2026-09-01T09:00:00.000Z"),
      },
    ] as never)

    const response = await GET(request("?from=2026-07-01&to=2026-10-01"))
    const body = await response.json()
    const facts = Object.fromEntries(
      body.data.report.drilldown.planDenominator.map(
        (fact: { routePointId: string }) => [fact.routePointId, fact],
      ),
    )

    expect(response.status).toBe(200)
    expect(facts["point-july"].brandIds).toEqual(["brand-v1"])
    expect(facts["point-august"].brandIds).toEqual(["brand-v2"])
    expect(facts["point-september"].brandIds).toEqual([])
    expect(body.data.brands).toEqual([
      { id: "brand-v1", name: "Brand V1" },
      { id: "brand-v2", name: "Brand V2" },
    ])
    const potentialQuery = vi.mocked(prisma.mtmFieldPotential.findMany).mock.calls[0][0] as any
    expect(potentialQuery.where).not.toHaveProperty("status")
    expect(potentialQuery.where).not.toHaveProperty("supersededBy")
    expect(potentialQuery.where.AND).toEqual([
      { agentId: { in: ["agent-1"] } },
      {
        OR: [
          { customerId: { in: ["customer-shared"] } },
          { contactId: { in: ["contact-shared"] } },
        ],
      },
    ])
    expect(potentialQuery.select).toMatchObject({
      id: true,
      supersedesPotentialId: true,
      status: true,
      periodStart: true,
      periodEnd: true,
    })
  })

  it("applies potential status and inclusive validity dates to each individual fact date", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Amina",
      status: "ACTIVE",
      teamId: null,
      team: null,
    }] as never)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      id: "point-validity",
      customerId: "customer-1",
      contactId: "contact-1",
      status: "PLANNED",
      customer: { name: "Central Clinic" },
      route: {
        date: new Date("2026-07-15T00:00:00.000Z"),
        updatedAt: new Date("2026-07-15T09:00:00.000Z"),
        agentId: "agent-1",
        agent: { name: "Amina" },
        assignments: [],
      },
    }] as never)
    const potential = (
      id: string,
      status: "VERIFIED" | "ENDED" | "PENDING" | "REJECTED",
      periodStart: string | null,
      periodEnd: string | null,
    ) => ({
      id,
      supersedesPotentialId: null,
      status,
      agentId: "agent-1",
      customerId: "customer-1",
      contactId: "contact-1",
      brandExternalId: id.replace("potential-", "brand-"),
      brandName: id,
      periodStart: periodStart ? new Date(`${periodStart}T00:00:00.000Z`) : null,
      periodEnd: periodEnd ? new Date(`${periodEnd}T00:00:00.000Z`) : null,
      updatedAt: new Date("2026-07-15T10:00:00.000Z"),
    })
    vi.mocked(prisma.mtmFieldPotential.findMany).mockResolvedValue([
      potential("potential-boundary", "VERIFIED", "2026-07-15", "2026-07-15"),
      potential("potential-open", "ENDED", null, null),
      potential("potential-future", "VERIFIED", "2026-07-16", null),
      potential("potential-expired", "ENDED", null, "2026-07-14"),
      potential("potential-pending", "PENDING", null, null),
      potential("potential-rejected", "REJECTED", null, null),
    ] as never)

    const response = await GET(request("?from=2026-07-01&to=2026-08-01&agentId=agent-1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.report.drilldown.planDenominator).toEqual([
      expect.objectContaining({
        routePointId: "point-validity",
        brandIds: ["brand-boundary", "brand-open"],
      }),
    ])
    expect(body.data.brands).toEqual([
      { id: "brand-boundary", name: "potential-boundary" },
      { id: "brand-open", name: "potential-open" },
    ])
  })

  it("keeps a just-expired potential update in source freshness even when it no longer contributes a brand", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-15T12:00:00.000Z") })
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Amina",
      status: "ACTIVE",
      teamId: null,
      team: null,
    }] as never)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      id: "point-expired-potential",
      customerId: "customer-1",
      contactId: "contact-1",
      status: "PLANNED",
      customer: { name: "Central Clinic" },
      route: {
        date: new Date("2026-09-15T00:00:00.000Z"),
        updatedAt: new Date("2026-09-15T10:00:00.000Z"),
        agentId: "agent-1",
        agent: { name: "Amina" },
        assignments: [],
      },
    }] as never)
    vi.mocked(prisma.mtmFieldPotential.findMany).mockResolvedValue([{
      id: "potential-just-expired",
      supersedesPotentialId: null,
      status: "ENDED",
      agentId: "agent-1",
      customerId: "customer-1",
      contactId: "contact-1",
      brandExternalId: "brand-a",
      brandName: "Brand Alpha",
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-14T00:00:00.000Z"),
      updatedAt: new Date("2026-09-15T11:59:00.000Z"),
    }] as never)

    const response = await GET(request("?from=2026-09-01&to=2026-10-01&brandId=brand-a"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.report.plan.denominator).toBe(0)
    expect(body.data.report.drilldown.planDenominator).toEqual([])
    expect(body.data.report.formula).toMatchObject({
      sourceUpdatedAt: "2026-09-15T11:59:00.000Z",
      sourceFreshness: "CURRENT",
    })
  })

  it("keeps an audited GPS visit in the denominator while removing only its numerator evidence", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Amina",
      status: "ACTIVE",
      teamId: null,
      team: null,
    }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      id: "visit-gps-excluded",
      agentId: "agent-1",
      customerId: "customer-1",
      contactId: "contact-1",
      routePointId: null,
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-07-14T08:00:00.000Z"),
      updatedAt: new Date("2026-07-14T09:00:00.000Z"),
      checkInLat: 40.41,
      checkInLng: 49.87,
      checkOutLat: 40.42,
      checkOutLng: 49.88,
      agent: { name: "Amina" },
      customer: { name: "Central Clinic" },
      requirementSnapshot: { sourcePolicy: { visitType: "INDEPENDENT" } },
      participants: [],
      actionResults: [],
    }] as never)
    vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([
      {
        id: "audit-gps-exclude",
        action: "KPI_FACT_EXCLUDED",
        entityId: "visit-gps-excluded",
        agentId: "manager-1",
        newData: {
          factType: "GPS_VISIT",
          reason: "GPS evidence failed manual verification",
          formulaVersion: "SWM_PLAN_GPS_V1",
        },
        createdAt: new Date("2026-07-15T09:00:00.000Z"),
      },
      {
        id: "audit-gps-restore",
        action: "KPI_FACT_RESTORED",
        entityId: "visit-gps-excluded",
        agentId: "manager-2",
        newData: {
          factType: "GPS_VISIT",
          reason: "Earlier evidence restoration decision",
          formulaVersion: "SWM_PLAN_GPS_V1",
        },
        createdAt: new Date("2026-07-14T09:00:00.000Z"),
      },
    ] as never)

    const response = await GET(request("?from=2026-07-01&to=2026-08-01"))
    const report = (await response.json()).data.report

    expect(response.status).toBe(200)
    expect(report.gps).toEqual({ numerator: 0, denominator: 1, percentage: 0 })
    expect(report.totals).toMatchObject({ completedVisits: 1, gpsConfirmedVisits: 0 })
    expect(report.drilldown.gpsNumerator).toEqual([])
    expect(report.drilldown.gpsDenominator).toEqual([
      expect.objectContaining({ visitId: "visit-gps-excluded", gpsConfirmed: false }),
    ])
    expect(report.drilldown.exclusions.visits).toEqual([
      expect.objectContaining({ visitId: "visit-gps-excluded" }),
    ])
    expect(report.formula.adjustments).toEqual([
      {
        factType: "GPS_VISIT",
        factId: "visit-gps-excluded",
        action: "RESTORE",
        reason: "Earlier evidence restoration decision",
        createdAt: "2026-07-14T09:00:00.000Z",
        actorAgentId: "manager-2",
        auditId: "audit-gps-restore",
      },
      {
        factType: "GPS_VISIT",
        factId: "visit-gps-excluded",
        action: "EXCLUDE",
        reason: "GPS evidence failed manual verification",
        createdAt: "2026-07-15T09:00:00.000Z",
        actorAgentId: "manager-1",
        auditId: "audit-gps-exclude",
      },
    ])
  })

  it("marks a truncated late source as partial and non-authoritative", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-15T12:00:00.000Z") })
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Amina",
      status: "ACTIVE",
      teamId: null,
      team: null,
    }] as never)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      id: "point-1",
      customerId: "customer-1",
      contactId: "contact-1",
      status: "PLANNED",
      customer: { name: "Central Clinic" },
      route: {
        date: new Date("2026-07-14T00:00:00.000Z"),
        updatedAt: new Date("2026-07-15T10:00:00.000Z"),
        agentId: "agent-1",
        agent: { name: "Amina" },
        assignments: [],
      },
    }] as never)
    vi.mocked(prisma.mtmFieldPotential.findMany).mockResolvedValue(
      Array.from({ length: 10_001 }, (_, index) => ({
        id: `potential-${index}`,
        supersedesPotentialId: null,
        status: "PENDING",
        agentId: "agent-1",
        customerId: "customer-1",
        contactId: "contact-1",
        brandExternalId: "brand-a",
        brandName: "Brand Alpha",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        updatedAt: new Date("2026-07-15T10:00:00.000Z"),
      })) as never,
    )

    const response = await GET(request("?from=2026-07-01&to=2026-08-01"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.contract).toMatchObject({ maxFacts: 10_000, truncated: true })
    expect(body.data.report.formula).toMatchObject({
      completeness: "PARTIAL",
      calculationState: "READY",
      authoritative: false,
      sourceUpdatedAt: "2026-07-15T10:00:00.000Z",
      sourceFreshness: "LATE",
      sourceFreshnessThresholdMinutes: 15,
    })
  })

  it("bounds the roster and marks the calculation partial when the manager scope exceeds the cap", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      ...MANAGER_ACTOR,
      scopedAgentIds: null,
    } as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue(
      Array.from({ length: 501 }, (_, index) => ({
        id: `agent-${String(index).padStart(3, "0")}`,
        name: `Agent ${String(index).padStart(3, "0")}`,
        status: "ACTIVE",
        teamId: null,
        team: null,
      })) as never,
    )

    const response = await GET(request("?from=2026-07-01&to=2026-08-01"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: ORG_ID },
      take: 501,
    }))
    expect(body.data.agents).toHaveLength(500)
    expect(body.data.agents.at(-1).id).toBe("agent-499")
    expect(body.data.contract).toMatchObject({
      maxFacts: 10_000,
      maxAgents: 500,
      truncated: true,
    })
    expect(body.data.report.formula).toMatchObject({
      completeness: "PARTIAL",
      authoritative: false,
    })
  })
})

describe("POST /api/v1/mtm/kpi", () => {
  it("returns the requireAuth 403 without resolving actor, fact or audit side effects", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json(
      { error: "Forbidden", message: "Write permission denied" },
      { status: 403 },
    ) as never)
    const req = postRequest({
      factType: "GPS_VISIT",
      factId: "visit-1",
      action: "EXCLUDE",
      reason: "Evidence requires manager review",
    })

    const response = await POST(req)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: "Forbidden",
      message: "Write permission denied",
    })
    expect(requireAuth).toHaveBeenCalledWith(req, "mtm", "write", { deferLegacyModuleGate: "mtm" })
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmFieldPotential.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findFirst).not.toHaveBeenCalled()
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })

  it.each([
    [
      "an unsupported fact type",
      { factType: "TASK", factId: "task-1", action: "EXCLUDE", reason: "Invalid KPI source record" },
    ],
    [
      "a missing fact id",
      { factType: "PLAN_POINT", factId: " ", action: "EXCLUDE", reason: "Invalid KPI source record" },
    ],
    [
      "an unsupported action",
      { factType: "GPS_VISIT", factId: "visit-1", action: "DELETE", reason: "Invalid KPI source record" },
    ],
    [
      "a reason shorter than ten characters",
      { factType: "GPS_VISIT", factId: "visit-1", action: "EXCLUDE", reason: "too short" },
    ],
    [
      "a reason longer than 500 characters",
      { factType: "GPS_VISIT", factId: "visit-1", action: "EXCLUDE", reason: "x".repeat(501) },
    ],
  ])("rejects %s before resolving the fact", async (_label, payload) => {
    const response = await POST(postRequest(payload))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "factType, factId, action and a 10-500 character reason are required",
    })
    expect(prisma.mtmRoutePoint.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findFirst).not.toHaveBeenCalled()
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })

  it("rejects an adjustment when the manager sees a joint visit only as participant", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockImplementation((...args: unknown[]) => {
      const query = args[0] as { where?: { OR?: unknown } }
      return Promise.resolve(query.where?.OR ? { id: "visit-outside" } : null)
    })

    const response = await POST(postRequest({
      factType: "GPS_VISIT",
      factId: "visit-outside",
      action: "EXCLUDE",
      reason: "Visit belongs to another management scope",
    }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Fact not found in manager scope" })
    expect(prisma.mtmVisit.findFirst).toHaveBeenCalledWith({
      where: {
        id: "visit-outside",
        organizationId: ORG_ID,
        deletedAt: null,
        agentId: { in: ["agent-1", "agent-2"] },
      },
      select: { id: true },
    })
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })

  it("writes a scoped, reasoned audit event for an accepted plan-point exclusion", async () => {
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue({ id: "point-1" } as never)
    const req = postRequest({
      factType: "PLAN_POINT",
      factId: " point-1 ",
      action: "EXCLUDE",
      reason: " Duplicate plan entry confirmed ",
    })

    const response = await POST(req)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      success: true,
      data: {
        factType: "PLAN_POINT",
        factId: "point-1",
        action: "EXCLUDE",
        reason: "Duplicate plan entry confirmed",
      },
    })
    expect(prisma.mtmRoutePoint.findFirst).toHaveBeenCalledWith({
      where: {
        id: "point-1",
        deletedAt: null,
        route: {
          organizationId: ORG_ID,
          deletedAt: null,
          agentId: { in: ["agent-1", "agent-2"] },
        },
      },
      select: { id: true },
    })
    expect(writeMtmAudit).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      agentId: "manager-1",
      action: "KPI_FACT_EXCLUDED",
      entity: "kpi_fact",
      entityId: "point-1",
      metadataKind: "kpi_adjustment",
      newData: {
        factType: "PLAN_POINT",
        reason: "Duplicate plan entry confirmed",
        formulaVersion: "SWM_PLAN_GPS_V1",
        actorUserId: "manager-user",
      },
      req,
    })
  })
})

describe("GET /api/v1/mtm/kpi/export", () => {
  it("refuses an official export when no signed tenant KPI policy covers the period", async () => {
    const response = await EXPORT_GET(exportRequest("?from=2026-07-01&to=2026-08-01"))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_KPI_POLICY_NOT_APPROVED" })
  })

  it("exports exact credited provenance and brand display names while neutralizing spreadsheet formulas", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-01T12:34:56.000Z") })
    const unsafeAgentName = " \t=1+1"
    const unsafeCustomerId = "\u0000+customer-1"
    const unsafeCustomerName = "\u00A0-Central Clinic"
    const unsafeContactId = "\u0085@contact-1"
    vi.mocked(prisma.mtmKpiPolicy.findFirst).mockResolvedValue(approvedKpiPolicy() as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "UTC" },
      { key: "brandPotentialPerAgentEnabled", value: false },
    ] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      {
        id: "agent-1",
        name: unsafeAgentName,
        status: "ACTIVE",
        teamId: null,
        team: null,
      },
      {
        id: "agent-2",
        name: "Samir",
        status: "ACTIVE",
        teamId: null,
        team: null,
      },
    ] as never)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([
      {
        id: "point-safe",
        customerId: unsafeCustomerId,
        contactId: unsafeContactId,
        status: "VISITED",
        customer: { name: unsafeCustomerName },
        route: {
          date: new Date("2026-07-14T00:00:00.000Z"),
          updatedAt: new Date("2026-07-14T12:00:00.000Z"),
          agentId: "agent-1",
          agent: { name: unsafeAgentName },
          assignments: [{
            agentId: "agent-2",
            role: "PARTICIPANT",
            assignedAt: new Date("2026-07-01T00:00:00.000Z"),
            removedAt: null,
            agent: { name: "Samir" },
          }],
        },
      },
      {
        id: "point-unfiltered",
        customerId: "customer-2",
        contactId: "contact-2",
        status: "VISITED",
        customer: { name: "Unfiltered Clinic" },
        route: {
          date: new Date("2026-07-14T00:00:00.000Z"),
          updatedAt: new Date("2026-07-14T12:00:00.000Z"),
          agentId: "agent-1",
          agent: { name: "Unfiltered Agent" },
          assignments: [],
        },
      },
    ] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      {
        id: "visit-safe",
        agentId: "agent-1",
        customerId: unsafeCustomerId,
        contactId: unsafeContactId,
        routePointId: "point-safe",
        status: "CHECKED_OUT",
        checkInAt: new Date("2026-07-14T08:00:00.000Z"),
        updatedAt: new Date("2026-07-14T08:30:00.000Z"),
        checkInLat: 40.41,
        checkInLng: 49.87,
        checkOutLat: 40.42,
        checkOutLng: 49.88,
        agent: { name: unsafeAgentName },
        customer: { name: unsafeCustomerName },
        requirementSnapshot: null,
        participants: [{
          agentId: "agent-2",
          joinedAt: new Date("2026-07-14T07:00:00.000Z"),
          leftAt: null,
          agent: { name: "Samir" },
        }],
        actionResults: [],
      },
      {
        id: "visit-unfiltered",
        agentId: "agent-1",
        customerId: "customer-2",
        contactId: "contact-2",
        routePointId: "point-unfiltered",
        status: "CHECKED_OUT",
        checkInAt: new Date("2026-07-14T09:00:00.000Z"),
        updatedAt: new Date("2026-07-14T09:30:00.000Z"),
        checkInLat: 40.4,
        checkInLng: 49.8,
        checkOutLat: 40.4,
        checkOutLng: 49.8,
        agent: { name: "Unfiltered Agent" },
        customer: { name: "Unfiltered Clinic" },
        requirementSnapshot: null,
        participants: [],
        actionResults: [],
      },
    ] as never)
    vi.mocked(prisma.mtmFieldPotential.findMany).mockResolvedValue([
      {
        id: "potential-export-brand-a",
        supersedesPotentialId: null,
        status: "VERIFIED",
        agentId: null,
        customerId: unsafeCustomerId,
        contactId: unsafeContactId,
        brandExternalId: "brand-a",
        brandName: "Brand Alpha",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T11:00:00.000Z"),
      },
      {
        id: "potential-export-brand-b",
        supersedesPotentialId: null,
        status: "VERIFIED",
        agentId: null,
        customerId: "customer-2",
        contactId: "contact-2",
        brandExternalId: "brand-b",
        brandName: "Brand Beta",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T11:00:00.000Z"),
      },
    ] as never)

    const query = "?from=2026-07-01&to=2026-08-01&visitType=DOUBLE&brandId=brand-a"
    const dashboardResponse = await GET(request(query))
    const dashboardBody = await dashboardResponse.json()
    const snapshotId = dashboardBody.data.snapshotId as string
    const response = await EXPORT_GET(exportRequest(
      query + "&snapshotId=" + snapshotId,
    ))
    const bytes = new Uint8Array(await response.arrayBuffer())
    const csv = new TextDecoder().decode(bytes.slice(3))
    const expectedCsv = [
      "\"formulaVersion\",\"SWM_PLAN_GPS_V1\"",
      "\"policyCode\",\"SWM_PLAN_GPS\"",
      "\"policyVersion\",\"1\"",
      `\"policyDefinitionHash\",\"${kpiPolicyHash(KPI_POLICY_DEFINITION)}\"`,
      "\"policyApprovalReference\",\"SWISSMED-KPI-2026-01\"",
      "\"policyEffectiveFrom\",\"2026-01-01\"",
      "\"policyEffectiveTo\",\"\"",
      "\"snapshotId\",\"" + snapshotId + "\"",
      "\"generatedAt\",\"2026-08-01T12:34:56.000Z\"",
      "\"from\",\"2026-07-01\"",
      "\"toExclusive\",\"2026-08-01\"",
      "\"teamId\",\"\"",
      "\"agentId\",\"\"",
      "\"visitType\",\"DOUBLE\"",
      "\"brandId\",\"brand-a\"",
      "\"timezone\",\"UTC\"",
      "\"sourceUpdatedAt\",\"2026-07-14T12:00:00.000Z\"",
      "\"sourceFreshness\",\"HISTORICAL\"",
      "\"workforceEnabled\",\"true\"",
      "\"completeness\",\"COMPLETE\"",
      "\"authoritative\",\"true\"",
      "\"planDefinition\",\"visited route points / non-draft, non-cancelled route points\"",
      "\"gpsDefinition\",\"completed visits with check-in and check-out coordinates / completed visits\"",
      "\"baselineExclusions\",\"draft routes|cancelled routes|cancelled visits|soft-deleted records\"",
      "",
      "\"metric\",\"numerator\",\"denominator\",\"percentage\"",
      "\"plan\",\"1\",\"1\",\"100\"",
      "\"gps\",\"1\",\"1\",\"100\"",
      "",
      "\"date\",\"planned\",\"completedPlan\",\"completedVisits\",\"gpsConfirmed\",\"planPercentage\",\"gpsPercentage\"",
      "\"2026-07-14\",\"1\",\"1\",\"1\",\"1\",\"100\",\"100\"",
      "",
      "\"cohort\",\"factId\",\"agentId\",\"agentName\",\"customerId\",\"customerName\",\"contactId\",\"date\",\"visitType\",\"brandIds\",\"brandNames\",\"completed\",\"gpsConfirmed\",\"gpsEvidenceState\",\"sourceAgentId\",\"sourceAgentName\",\"attributedAgentIds\",\"attributedAgentNames\",\"adjustable\",\"adjustmentAction\",\"adjustmentReason\"",
      `\"planDenominator\",\"point-safe\",\"agent-1\",\"'${unsafeAgentName}\",\"'${unsafeCustomerId}\",\"'${unsafeCustomerName}\",\"'${unsafeContactId}\",\"2026-07-14\",\"DOUBLE\",\"brand-a\",\"Brand Alpha\",\"true\",\"\",\"\",\"agent-1\",\"'${unsafeAgentName}\",\"agent-1|agent-2\",\"'${unsafeAgentName}|Samir\",\"true\",\"\",\"\"`,
      `\"gpsDenominator\",\"visit-safe\",\"agent-1\",\"'${unsafeAgentName}\",\"'${unsafeCustomerId}\",\"'${unsafeCustomerName}\",\"'${unsafeContactId}\",\"2026-07-14\",\"DOUBLE\",\"brand-a\",\"Brand Alpha\",\"true\",\"true\",\"CONFIRMED\",\"agent-1\",\"'${unsafeAgentName}\",\"agent-1|agent-2\",\"'${unsafeAgentName}|Samir\",\"true\",\"\",\"\"`,
      "",
      "\"gpsDayAgentId\",\"gpsDayAgentName\",\"date\",\"workdayId\",\"workdayState\",\"evidenceSource\",\"sourceAgentIds\",\"sourceAgentNames\",\"completedVisits\",\"gpsConfirmedVisits\",\"gpsEvidenceStates\",\"visitIds\"",
      `\"agent-1\",\"'${unsafeAgentName}\",\"2026-07-14\",\"\",\"NOT_RECORDED\",\"VISIT_COORDINATES\",\"agent-1\",\"'${unsafeAgentName}\",\"1\",\"1\",\"CONFIRMED:1\",\"visit-safe\"`,
      "",
      "\"adjustmentFactType\",\"adjustmentFactId\",\"action\",\"reason\",\"createdAt\",\"actorAgentId\",\"auditId\"",
    ].join("\r\n")

    expect(dashboardResponse.status).toBe(200)
    expect(snapshotId).toMatch(/^[a-f0-9]{64}$/)
    expect(dashboardBody.data.brands).toEqual([
      { id: "brand-a", name: "Brand Alpha" },
      { id: "brand-b", name: "Brand Beta" },
    ])
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition"))
      .toBe("attachment; filename=\"mtm-plan-gps-kpi-2026-07-01-2026-08-01.csv\"")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect([...bytes.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF])
    expect(csv).toBe(expectedCsv)
    expect(csv).not.toContain("Unfiltered Agent")
    expect(csv).not.toContain("Unfiltered Clinic")
    for (const unsafeValue of [unsafeAgentName, unsafeCustomerId, unsafeCustomerName, unsafeContactId]) {
      expect(csv).not.toContain(`\",\"${unsafeValue}\"`)
      expect(csv).toContain(`\",\"'${unsafeValue}\"`)
    }
  })
})
