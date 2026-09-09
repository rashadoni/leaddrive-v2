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

import { GET } from "@/app/api/v1/mtm/coverage/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { coveragePolicyHash } from "@/lib/mtm/coverage-policy"
import { prisma } from "@/lib/prisma"

const definition = {
  schemaVersion: 1,
  timezone: "Asia/Baku",
  rounding: { mode: "HALF_UP", scale: 2 },
  groups: [{
    key: "pharmacies",
    order: 1,
    subjectType: "PHARMACY",
    labels: { ru: "Аптеки", az: "Apteklər", en: "Pharmacies" },
    population: { source: "CUSTOMER", filter: { objectType: "PHARMACY", status: "ACTIVE" } },
    metrics: {
      requiredCoverage: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "requiredCoverage" } },
      actualMoi: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "actualMoi" } },
      target: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "target" } },
      actualCoverage: { source: "FIELD_POTENTIAL", unit: "VALUE", rule: { field: "coverageValue" } },
      uncoveredMoi: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "uncoveredMoi" } },
    },
  }],
  reconciliation: { kpiFormulaVersion: "SWM15-v1", tolerance: "0.0001" },
}

function request(agentId = "agent-1") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/coverage?agentId=${agentId}&periodStart=2026-07-01&periodEnd=2026-07-31`)
}

function activePolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: "policy-1",
    organizationId: "org-1",
    code: "BASE_COVERAGE",
    version: 1,
    nameRu: "Покрытие базы",
    nameAz: "Baza əhatəsi",
    nameEn: "Base coverage",
    definition,
    definitionHash: coveragePolicyHash(definition),
    approvalReference: "SwissMed approval SWM15-2026-08",
    sourceSystem: "SwissMed specification",
    sourceReference: "SWM15",
    sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"),
    status: "ACTIVE",
    signedByUserId: "admin-1",
    signedAt: new Date("2026-08-08T08:00:00.000Z"),
    activatedAt: new Date("2026-08-08T08:00:00.000Z"),
    retiredAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: "org-1",
    userId: "manager-user",
    role: "user",
    email: "manager@example.com",
    name: "Manager",
  } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: "manager-agent",
    role: "MANAGER",
    scopedAgentIds: ["manager-agent", "agent-1"],
  } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Aysel" } as never)
  vi.mocked(prisma.mtmCoveragePolicy.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmCoverageSnapshot.findFirst).mockResolvedValue(null as never)
})

describe("GET /api/v1/mtm/coverage", () => {
  it("returns an honest unsigned state when neither a frozen period nor an active policy exists", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { available: false, state: "UNSIGNED_COVERAGE_POLICY" },
    })
    expect(prisma.mtmCoverageSnapshot.findFirst).toHaveBeenCalledOnce()
  })

  it("hides an out-of-scope employee before reading any employee facts", async () => {
    const response = await GET(request("outside-agent"))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "MTM_COVERAGE_AGENT_NOT_FOUND" })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmCoveragePolicy.findFirst).not.toHaveBeenCalled()
  })

  it("does not expose totals before a frozen snapshot exists", async () => {
    vi.mocked(prisma.mtmCoveragePolicy.findFirst).mockResolvedValue(activePolicy() as never)
    vi.mocked(prisma.mtmCoverageSnapshot.findFirst).mockResolvedValue(null as never)
    const response = await GET(request())
    expect(await response.json()).toMatchObject({
      data: {
        available: false,
        state: "NO_COVERAGE_SNAPSHOT",
        policy: { code: "BASE_COVERAGE", version: 1 },
      },
    })
  })

  it("returns only complete signed frozen totals", async () => {
    vi.mocked(prisma.mtmCoveragePolicy.findFirst).mockResolvedValue(activePolicy() as never)
    vi.mocked(prisma.mtmCoverageSnapshot.findFirst).mockResolvedValue({
      id: "snapshot-1",
      policyId: "policy-1",
      policyVersion: 1,
      timezone: "Asia/Baku",
      populationHash: "1".repeat(64),
      sourceCutoffAt: new Date("2026-07-31T20:00:00.000Z"),
      sourceFreshnessAt: new Date("2026-07-31T19:45:00.000Z"),
      frozenAt: new Date("2026-08-01T01:00:00.000Z"),
      completeness: {
        schemaVersion: 1,
        complete: true,
        expectedRows: 50,
        persistedRows: 50,
        missingSources: [],
        warnings: [],
      },
      totals: {
        groups: [{
          key: "pharmacies",
          label: "Аптеки",
          order: 1,
          subjectType: "PHARMACY",
          populationCount: 50,
          requiredCoverage: "50",
          actualMoi: "44",
          target: "0",
          actualCoverage: "44",
          uncoveredMoi: "30",
        }],
        overall: {
          populationCount: 50,
          requiredCoverage: "50",
          actualMoi: "44",
          target: "0",
          actualCoverage: "44",
          uncoveredMoi: "30",
        },
      },
    } as never)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        available: true,
        state: "READY",
        snapshot: { id: "snapshot-1" },
        totals: { overall: { uncoveredMoi: "30" } },
      },
    })
  })

  it("keeps a closed period readable through its coherent retired policy", async () => {
    vi.mocked(prisma.mtmCoveragePolicy.findFirst).mockResolvedValue(activePolicy({
      status: "RETIRED",
      retiredAt: new Date("2026-08-10T00:00:00.000Z"),
    }) as never)
    vi.mocked(prisma.mtmCoverageSnapshot.findFirst).mockResolvedValue({
      id: "snapshot-retired",
      policyId: "policy-1",
      policyVersion: 1,
      timezone: "Asia/Baku",
      populationHash: "2".repeat(64),
      sourceCutoffAt: new Date("2026-07-31T20:00:00.000Z"),
      sourceFreshnessAt: new Date("2026-07-31T19:45:00.000Z"),
      frozenAt: new Date("2026-08-01T01:00:00.000Z"),
      completeness: { schemaVersion: 1, complete: true, expectedRows: 1, persistedRows: 1, missingSources: [], warnings: [] },
      totals: {
        groups: [{
          key: "pharmacies", label: "Аптеки", order: 1, subjectType: "PHARMACY", populationCount: 1,
          requiredCoverage: "50", actualMoi: "44", target: "0", actualCoverage: "44", uncoveredMoi: "30",
        }],
        overall: { populationCount: 1, requiredCoverage: "50", actualMoi: "44", target: "0", actualCoverage: "44", uncoveredMoi: "30" },
      },
    } as never)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { available: true, snapshot: { id: "snapshot-retired" }, policy: { id: "policy-1" } },
    })
    expect(prisma.mtmCoveragePolicy.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "policy-1", status: { in: ["ACTIVE", "RETIRED"] } }),
    }))
  })
})
