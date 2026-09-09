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

import { GET } from "@/app/api/v1/mtm/routes/candidates/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { coveragePolicyHash } from "@/lib/mtm/coverage-policy"

const ORG = "org-1"
const coverageDefinition = {
  schemaVersion: 1,
  timezone: "Asia/Baku",
  rounding: { mode: "HALF_UP", scale: 2 },
  groups: [{
    key: "pharmacies",
    order: 1,
    subjectType: "PHARMACY",
    labels: { ru: "Аптеки", az: "Apteklər", en: "Pharmacies" },
    population: { source: "CUSTOMER", filter: { objectType: "PHARMACY" } },
    metrics: {
      requiredCoverage: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "requiredCoverage" } },
      actualMoi: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "actualMoi" } },
      target: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "target" } },
      actualCoverage: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "actualCoverage" } },
      uncoveredMoi: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "uncoveredMoi" } },
    },
  }],
  reconciliation: { kpiFormulaVersion: "SWM15-v1", tolerance: "0.0001" },
} as const

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/routes/candidates?${query}`)
}

function organizationCandidate(input: { id: string; name: string; category?: "A" | "B" | "C" }) {
  return {
    id: input.id,
    code: `CODE-${input.id}`,
    name: input.name,
    category: input.category ?? "B",
    objectType: "STORE",
    organizationKind: "Sales outlet",
    address: "Baku",
    region: "Baku",
    administrativeDistrict: "Nasimi",
    locality: "Baku",
    cityDistrict: "Nasimi",
    city: "Baku",
    district: "Nasimi",
    territoryCode: "BAK-1",
    phone: null,
    latitude: null,
    longitude: null,
    agentAssignments: [],
    visits: [],
    _count: { visits: 0 },
    routePoints: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  })
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: "agent-1",
    name: "Agent One",
    teamId: "team-1",
  } as any)
})

describe("GET /api/v1/mtm/routes/candidates", () => {
  it("returns doctor candidates from the selected agent scope with planning availability", async () => {
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([{
      id: "doctor-1",
      displayName: "Aygun Doctor",
      externalCode: "D-100",
      category: "A",
      specialtyCode: "PE",
      specialtyName: "Pediatrics",
      agentAssignments: [{
        effectiveFrom: new Date("2026-07-01T00:00:00Z"),
        effectiveTo: new Date("2026-08-01T00:00:00Z"),
      }],
      workplaces: [{
        customer: {
          id: "clinic-1",
          code: "C-100",
          name: "Central Clinic",
          objectType: "CLINIC",
          organizationKind: "Medical center",
          address: "Main street 1",
          region: "Baku",
          administrativeDistrict: "Nasimi",
          locality: "Baku",
          cityDistrict: "Nasimi",
          city: "Baku",
          district: "Nasimi",
          territoryCode: "BAK-1",
          phone: null,
          latitude: 40.4,
          longitude: 49.8,
          agentAssignments: [],
        },
      }],
      doctorAssessments: [{
        psychotype: "Analytical",
        actualScore: { toString: () => "18.5" },
        formulaVersion: "v1",
        reviewedAt: new Date("2026-07-20"),
      }],
      visits: [{
        id: "visit-1",
        checkInAt: new Date("2026-07-01T08:00:00Z"),
        agent: { id: "agent-1", name: "Agent One" },
        customer: { id: "clinic-1", name: "Central Clinic" },
      }],
      _count: { visits: 3 },
      routePoints: [{
        id: "point-1",
        routeId: "route-1",
        route: {
          date: new Date("2026-07-29T00:00:00Z"),
          status: "DRAFT",
          version: 4,
        },
      }],
    }] as any)
    vi.mocked(prisma.mtmContact.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-1",
      date: new Date("2026-07-29T00:00:00Z"),
      status: "DRAFT",
      version: 4,
      points: [
        { id: "point-1", customerId: "clinic-1", contactId: "doctor-1", orderIndex: 0 },
        { id: "point-2", customerId: "clinic-2", contactId: "doctor-2", orderIndex: 1 },
      ],
    }] as any)

    const response = await GET(request(
      "agentId=agent-1&startDate=2026-07-29&direction=DOCTOR&period=5_DAYS"
      + "&region=Baku&customerId=clinic-1&specialtyCode=PE&psychotype=Analytical",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.candidates[0]).toMatchObject({
      kind: "DOCTOR",
      customerId: "clinic-1",
      contactId: "doctor-1",
      name: "Aygun Doctor",
      psychotype: "Analytical",
      score: "18.5",
      monthlyVisitCount: 3,
      availability: {
        source: "DIRECT_CONTACT_ASSIGNMENT",
        validFrom: "2026-07-01",
        validThrough: "2026-07-31",
      },
      plannedRoutes: [{
        pointId: "point-1",
        id: "route-1",
        date: "2026-07-29",
        status: "DRAFT",
        version: 4,
      }],
    })
    expect(body.data.candidates[0].customer.agentAssignments).toBeUndefined()
    expect(body.data.selectionScope).toEqual({
      mode: "AGENT_ASSIGNMENTS",
      activeOnly: true,
      assignmentRequired: true,
      agentId: "agent-1",
      effectiveOn: "2026-07-29",
    })
    expect(body.data.candidates[0].monthlyVisitSources).toEqual([{
      id: "visit-1",
      checkInAt: "2026-07-01T08:00:00.000Z",
      agent: { id: "agent-1", name: "Agent One" },
      customer: { id: "clinic-1", name: "Central Clinic" },
    }])
    expect(body.data.planningDays).toHaveLength(5)
    expect(body.data.planningDays[0]).toMatchObject({
      date: "2026-07-29",
      plannedStops: 2,
      routeCount: 1,
      routes: [{
        id: "route-1",
        status: "DRAFT",
        version: 4,
        points: [
          { id: "point-1", customerId: "clinic-1", contactId: "doctor-1", orderIndex: 0 },
          { id: "point-2", customerId: "clinic-2", contactId: "doctor-2", orderIndex: 1 },
        ],
      }],
    })
    expect(body.data.coverage).toMatchObject({
      available: false,
      state: "UNSIGNED_COVERAGE_POLICY",
      reason: "UNSIGNED_COVERAGE_POLICY",
    })
    expect(body.data.facets.organization).toEqual([{ id: "clinic-1", name: "Central Clinic" }])

    const contactQuery = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as any
    expect(contactQuery.where).toEqual(expect.objectContaining({
      organizationId: ORG,
      type: "DOCTOR",
      status: "ACTIVE",
      specialtyCode: "PE",
      doctorAssessments: { some: { status: "VERIFIED", psychotype: "Analytical" } },
    }))
    expect(JSON.stringify(contactQuery.where)).toContain('"agentId":"agent-1"')
    expect(JSON.stringify(contactQuery.where)).toContain('"id":"clinic-1"')
  })

  it("explains when a doctor is available through the assigned workplace", async () => {
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([{
      id: "doctor-workplace-1",
      displayName: "Workplace Doctor",
      externalCode: "D-WORKPLACE",
      category: "B",
      specialtyCode: "GP",
      specialtyName: "General practice",
      agentAssignments: [],
      workplaces: [{
        customer: {
          id: "clinic-unassigned-primary",
          code: "CLINIC-PRIMARY",
          name: "Unassigned Primary Clinic",
          objectType: "CLINIC",
          organizationKind: "Clinic",
          address: "Baku",
          region: "Baku",
          administrativeDistrict: null,
          locality: null,
          cityDistrict: null,
          city: "Baku",
          district: null,
          territoryCode: null,
          phone: null,
          latitude: null,
          longitude: null,
          agentAssignments: [],
        },
      }, {
        customer: {
          id: "clinic-workplace-1",
          code: "CLINIC-WORKPLACE",
          name: "Assigned Clinic",
          objectType: "CLINIC",
          organizationKind: "Clinic",
          address: "Baku",
          region: "Baku",
          administrativeDistrict: null,
          locality: null,
          cityDistrict: null,
          city: "Baku",
          district: null,
          territoryCode: null,
          phone: null,
          latitude: null,
          longitude: null,
          agentAssignments: [{
            effectiveFrom: new Date("2026-07-15T00:00:00Z"),
            effectiveTo: null,
          }],
        },
      }],
      doctorAssessments: [],
      visits: [],
      _count: { visits: 0 },
      routePoints: [],
    }] as any)
    vi.mocked(prisma.mtmContact.count).mockResolvedValue(1)

    const response = await GET(request(
      "agentId=agent-1&startDate=2026-07-29&direction=DOCTOR&period=5_DAYS",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.candidates[0].customerId).toBe("clinic-workplace-1")
    expect(body.data.candidates[0].availability).toEqual({
      source: "WORKPLACE_ASSIGNMENT",
      validFrom: "2026-07-15",
      validThrough: null,
    })
  })

  it("returns pharmacies as organization candidates and keeps doctor-only filters out", async () => {
    vi.mocked(prisma.mtmCoveragePolicy.findFirst).mockResolvedValue({
      id: "policy-1",
      organizationId: ORG,
      code: "BASE_COVERAGE",
      version: 1,
      nameRu: "Покрытие базы",
      nameAz: "Baza əhatəsi",
      nameEn: "Base coverage",
      definition: coverageDefinition,
      definitionHash: coveragePolicyHash(coverageDefinition),
      approvalReference: "SwissMed SWM15 approved",
      sourceSystem: "SwissMed",
      sourceReference: "SWM15",
      sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"),
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      effectiveTo: null,
      status: "ACTIVE",
      signedByUserId: "admin-user",
      signedAt: new Date("2026-08-01T00:00:00.000Z"),
      activatedAt: new Date("2026-08-01T00:00:00.000Z"),
      retiredAt: null,
    } as never)
    vi.mocked(prisma.mtmCoverageSnapshot.findFirst).mockResolvedValue({
      id: "snapshot-1",
      policyId: "policy-1",
      policyVersion: 1,
      timezone: "Asia/Baku",
      populationHash: "1".repeat(64),
      sourceCutoffAt: new Date("2026-07-31T20:00:00.000Z"),
      sourceFreshnessAt: new Date("2026-07-31T19:45:00.000Z"),
      frozenAt: new Date("2026-08-01T01:00:00.000Z"),
      completeness: { schemaVersion: 1, complete: true, expectedRows: 2, persistedRows: 2, missingSources: [], warnings: [] },
      totals: {
        groups: [{
          key: "pharmacies", label: "Аптеки", labels: coverageDefinition.groups[0].labels, order: 1, subjectType: "PHARMACY",
          populationCount: 2, requiredCoverage: "110", actualMoi: "90", target: "0", actualCoverage: "90", uncoveredMoi: "70",
        }],
        overall: { populationCount: 2, requiredCoverage: "110", actualMoi: "90", target: "0", actualCoverage: "90", uncoveredMoi: "70" },
      },
    } as never)
    vi.mocked(prisma.mtmCoverageSnapshotRow.findMany).mockResolvedValue([
      {
        subjectId: "pharmacy-1",
        groupKey: "pharmacies",
        requiredCoverage: "50",
        actualMoi: "44",
        target: "0",
        actualCoverage: "44",
        uncoveredMoi: "30",
        explanation: { summary: { ru: "Не покрыто 30", az: "30 əhatə olunmayıb", en: "30 uncovered" } },
      },
      {
        subjectId: "pharmacy-2",
        groupKey: "pharmacies",
        requiredCoverage: "60",
        actualMoi: "46",
        target: "0",
        actualCoverage: "46",
        uncoveredMoi: "40",
        explanation: { summary: { ru: "Не покрыто 40", az: "40 əhatə olunmayıb", en: "40 uncovered" } },
      },
    ] as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([
      {
        id: "pharmacy-1",
        code: "P-1",
        name: "Alpha Pharmacy",
        category: "B",
        objectType: "PHARMACY",
        organizationKind: "Pharmacy",
        address: "Market street 2",
        region: "Baku",
        administrativeDistrict: "Yasamal",
        locality: "Baku",
        cityDistrict: "Yasamal",
        city: "Baku",
        district: "Yasamal",
        territoryCode: "BAK-2",
        phone: null,
        latitude: null,
        longitude: null,
        agentAssignments: [{
          effectiveFrom: new Date("2026-06-01T00:00:00Z"),
          effectiveTo: null,
        }],
        visits: [],
        _count: { visits: 0 },
        routePoints: [],
      },
      {
        id: "pharmacy-2",
        code: "P-2",
        name: "Zulu Pharmacy",
        category: "B",
        objectType: "PHARMACY",
        organizationKind: "Pharmacy",
        address: "Market street 3",
        region: "Baku",
        administrativeDistrict: "Yasamal",
        locality: "Baku",
        cityDistrict: "Yasamal",
        city: "Baku",
        district: "Yasamal",
        territoryCode: "BAK-2",
        phone: null,
        latitude: null,
        longitude: null,
        agentAssignments: [{
          effectiveFrom: new Date("2026-06-15T00:00:00Z"),
          effectiveTo: null,
        }],
        visits: [],
        _count: { visits: 0 },
        routePoints: [],
      },
    ] as any)
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(2)

    const response = await GET(request(
      "agentId=agent-1&startDate=2026-07-29&direction=PHARMACY&period=7_DAYS"
      + "&specialtyCode=PE&psychotype=Analytical&sort=COVERAGE_GAP",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.candidates.map((candidate: { customerId: string }) => candidate.customerId)).toEqual([
      "pharmacy-2",
      "pharmacy-1",
    ])
    expect(body.data.candidates[0]).toMatchObject({
      kind: "PHARMACY",
      customerId: "pharmacy-2",
      contactId: null,
      availability: {
        source: "ORGANIZATION_ASSIGNMENT",
        validFrom: "2026-06-15",
        validThrough: null,
      },
      coverage: { groupKey: "pharmacies", uncoveredMoi: "40" },
    })
    expect(body.data.candidates[0].customer.agentAssignments).toBeUndefined()
    expect(body.data.coverage).toMatchObject({
      available: true,
      state: "READY",
      policy: { version: 1 },
      groups: [{ key: "pharmacies", uncoveredMoi: "70" }],
    })
    expect(body.data.planningDays).toHaveLength(7)
    expect(body.data.facets.specialtyCode).toEqual([])
    expect(body.data.facets.psychotype).toEqual([])
    const pharmacyQuery = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(pharmacyQuery.where.objectType).toBe("PHARMACY")
  })

  it("lets an administrator plan active store organizations before permanent ownership is assigned", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{
      id: "store-1",
      code: "STORE-1",
      name: "Araz Supermarket",
      category: "B",
      objectType: "STORE",
      organizationKind: "Sales outlet",
      address: "Baku",
      region: "Baku",
      administrativeDistrict: null,
      locality: "Baku",
      cityDistrict: null,
      city: "Baku",
      district: null,
      territoryCode: null,
      phone: null,
      latitude: null,
      longitude: null,
      agentAssignments: [],
      visits: [],
      _count: { visits: 0 },
      routePoints: [],
    }] as any)
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(1)

    const response = await GET(request(
      "agentId=agent-1&startDate=2026-08-20&direction=ORGANIZATION&period=5_DAYS",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.direction).toBe("ORGANIZATION")
    expect(body.data.coverage).toBeNull()
    expect(body.data.candidates[0]).toMatchObject({
      kind: "ORGANIZATION",
      customerId: "store-1",
      contactId: null,
      name: "Araz Supermarket",
      availability: {
        source: "ACTIVE_CATALOG",
        validFrom: null,
        validThrough: null,
      },
      customer: { objectType: "STORE" },
    })
    expect(body.data.facets.objectType).toEqual(["STORE"])
    expect(body.data.selectionScope).toEqual({
      mode: "ACTIVE_CATALOG",
      activeOnly: true,
      assignmentRequired: false,
      agentId: "agent-1",
      effectiveOn: "2026-08-20",
    })

    const organizationQuery = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(organizationQuery.where.objectType).toBeUndefined()
    expect(organizationQuery.where.AND).toBeUndefined()
    expect(JSON.stringify(organizationQuery.where)).not.toContain("agentAssignments")
  })

  it("keeps organization candidates assignment-scoped for managers", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "manager-user",
      role: "employee",
      email: "manager@example.com",
      name: "Manager",
    })
    vi.mocked(prisma.mtmAgent.findFirst)
      .mockResolvedValueOnce({ id: "manager-1", role: "MANAGER" } as any)
      .mockResolvedValueOnce({ id: "agent-1", name: "Agent One", teamId: null } as any)
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue({
      id: "manager-1",
      teamId: null,
    } as any)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1" }] as any)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(0)

    const response = await GET(request(
      "agentId=agent-1&startDate=2026-08-20&direction=ORGANIZATION&period=5_DAYS",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.selectionScope).toEqual({
      mode: "AGENT_ASSIGNMENTS",
      activeOnly: true,
      assignmentRequired: true,
      agentId: "agent-1",
      effectiveOn: "2026-08-20",
    })
    const organizationQuery = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(organizationQuery.where.AND).toEqual([{
      agentAssignments: {
        some: expect.objectContaining({ agentId: "agent-1" }),
      },
    }])
  })

  it("keeps legacy candidate requests capped at 500 without emitting a pagination contract", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([organizationCandidate({ id: "customer-1", name: "Araz" })] as any)
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(701)

    const response = await GET(request(
      "agentId=agent-1&startDate=2026-08-20&direction=ORGANIZATION&period=5_DAYS",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.pagination).toBeUndefined()
    expect(body.data.limited).toBe(true)
    expect((vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any).take).toBe(500)
  })

  it("uses a bound name-and-id tuple cursor for keyset candidate pages", async () => {
    vi.mocked(prisma.mtmCustomer.findMany)
      .mockResolvedValueOnce([
        organizationCandidate({ id: "customer-1", name: "Alpha" }),
        organizationCandidate({ id: "customer-2", name: "Bravo" }),
        organizationCandidate({ id: "customer-3", name: "Bravo" }),
      ] as any)
      .mockResolvedValueOnce([
        organizationCandidate({ id: "customer-3", name: "Bravo" }),
        organizationCandidate({ id: "customer-4", name: "Delta" }),
      ] as any)
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(4)

    const firstResponse = await GET(request(
      "agentId=agent-1&startDate=2026-08-20&direction=ORGANIZATION&period=5_DAYS&pagination=keyset&limit=2",
    ))
    const firstBody = await firstResponse.json()
    const cursor = firstBody.data.pagination.nextCursor as string

    expect(firstResponse.status).toBe(200)
    expect(firstBody.data.candidates.map((candidate: { customerId: string }) => candidate.customerId)).toEqual(["customer-1", "customer-2"])
    expect(firstBody.data.pagination).toMatchObject({
      schemaVersion: 1,
      mode: "KEYSET",
      supported: true,
      sortIntegrity: "FULL",
      limit: 2,
      hasMore: true,
    })
    expect(cursor).toMatch(/^v1:/)
    expect(cursor).not.toContain("customer-2")
    expect((vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any).take).toBe(3)

    const secondResponse = await GET(request(
      `agentId=agent-1&startDate=2026-08-20&direction=ORGANIZATION&period=5_DAYS&pagination=keyset&limit=2&cursor=${encodeURIComponent(cursor)}`,
    ))
    const secondBody = await secondResponse.json()
    const secondQuery = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[1][0] as any

    expect(secondResponse.status).toBe(200)
    expect(secondBody.data.candidates.map((candidate: { customerId: string }) => candidate.customerId)).toEqual(["customer-3", "customer-4"])
    expect(secondBody.data.pagination).toMatchObject({ hasMore: false, nextCursor: null })
    expect(secondQuery.where.AND).toEqual([{
      OR: [
        { name: { gt: "Bravo" } },
        { name: "Bravo", id: { gt: "customer-2" } },
      ],
    }])
  })

  it("uses category, name, and id as the priority-page tuple", async () => {
    vi.mocked(prisma.mtmCustomer.findMany)
      .mockResolvedValueOnce([
        organizationCandidate({ id: "customer-1", name: "Alpha", category: "A" }),
        organizationCandidate({ id: "customer-2", name: "Alpha", category: "A" }),
      ] as any)
      .mockResolvedValueOnce([organizationCandidate({ id: "customer-3", name: "Beta", category: "A" })] as any)
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(3)

    const firstResponse = await GET(request(
      "agentId=agent-1&startDate=2026-08-20&direction=ORGANIZATION&period=5_DAYS&sort=PRIORITY&pagination=keyset&limit=1",
    ))
    const firstBody = await firstResponse.json()
    const cursor = firstBody.data.pagination.nextCursor as string

    const secondResponse = await GET(request(
      `agentId=agent-1&startDate=2026-08-20&direction=ORGANIZATION&period=5_DAYS&sort=PRIORITY&pagination=keyset&limit=1&cursor=${encodeURIComponent(cursor)}`,
    ))
    const secondQuery = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[1][0] as any

    expect(secondResponse.status).toBe(200)
    expect(secondQuery.where.AND).toEqual([{
      OR: [
        { category: { in: ["B", "C", "D"] } },
        { category: "A", name: { gt: "Alpha" } },
        { category: "A", name: "Alpha", id: { gt: "customer-1" } },
      ],
    }])
  })

  it("does not invent a cursor for globally incomplete legacy sorts and rejects malformed cursors", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([organizationCandidate({ id: "customer-1", name: "Araz" })] as any)
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(701)

    const unsupportedResponse = await GET(request(
      "agentId=agent-1&startDate=2026-08-20&direction=ORGANIZATION&period=5_DAYS&sort=LAST_VISIT&pagination=keyset&limit=2",
    ))
    const unsupportedBody = await unsupportedResponse.json()

    expect(unsupportedResponse.status).toBe(200)
    expect(unsupportedBody.data.pagination).toEqual({
      schemaVersion: 1,
      mode: "LEGACY_CAP",
      supported: false,
      sortIntegrity: "PARTIAL",
      limit: 500,
      hasMore: false,
      nextCursor: null,
      reason: "GLOBAL_KEYSET_NOT_AVAILABLE",
    })
    expect((vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any).take).toBe(500)

    vi.clearAllMocks()
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(resolveMobileAuth).mockResolvedValue(null)
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "admin-user",
      role: "admin",
      email: "admin@example.com",
      name: "Admin",
    })
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Agent One", teamId: "team-1" } as any)

    const invalidResponse = await GET(request(
      "agentId=agent-1&startDate=2026-08-20&direction=ORGANIZATION&period=5_DAYS&pagination=keyset&cursor=plaintext",
    ))

    expect(invalidResponse.status).toBe(400)
    await expect(invalidResponse.json()).resolves.toMatchObject({
      code: "MTM_ROUTE_CANDIDATE_CURSOR_INVALID",
      messageKey: "candidatePaginationInvalid",
      remedies: ["RELOAD_CANDIDATES"],
    })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
  })

  it("rejects requests without an agent and valid start date", async () => {
    const response = await GET(request("direction=DOCTOR&startDate=29-07-2026"))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: "MTM_PLANNING_CANDIDATE_INPUT_INVALID",
    })
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
  })
})
