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

import { GET } from "@/app/api/v1/mtm/coverage-snapshots/[id]/rows/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { coveragePolicyHash } from "@/lib/mtm/coverage-policy"
import { prisma } from "@/lib/prisma"

const definition = {
  schemaVersion: 1,
  timezone: "Asia/Baku",
  rounding: { mode: "HALF_UP", scale: 2 },
  groups: [{
    key: "doctors",
    order: 1,
    subjectType: "DOCTOR",
    labels: { ru: "Врачи", az: "Həkimlər", en: "Doctors" },
    population: { source: "CONTACT", filter: { type: "DOCTOR" } },
    metrics: {
      requiredCoverage: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "requiredCoverage" } },
      actualMoi: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "actualMoi" } },
      target: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "target" } },
      actualCoverage: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "actualCoverage" } },
      uncoveredMoi: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "uncoveredMoi" } },
    },
  }],
  reconciliation: { kpiFormulaVersion: "SWM15-v1", tolerance: "0.0001" },
}

const snapshot = {
  id: "snapshot-1",
  organizationId: "org-1",
  policyId: "policy-1",
  policyVersion: 1,
  agentId: "agent-1",
  agentName: "Aysel",
  periodStart: new Date("2026-07-01T00:00:00.000Z"),
  periodEnd: new Date("2026-07-31T00:00:00.000Z"),
  timezone: "Asia/Baku",
  status: "FROZEN",
  frozenAt: new Date("2026-08-01T01:00:00.000Z"),
  completeness: { schemaVersion: 1, complete: true, expectedRows: 1, persistedRows: 1, missingSources: [], warnings: [] },
}

const policy = {
  id: "policy-1",
  organizationId: "org-1",
  code: "BASE_COVERAGE",
  version: 1,
  definition,
  definitionHash: coveragePolicyHash(definition),
  approvalReference: "SwissMed approval SWM15-2026-08",
  status: "RETIRED",
  signedByUserId: "admin-user",
  signedAt: new Date("2026-08-01T00:00:00.000Z"),
  activatedAt: new Date("2026-08-01T00:00:00.000Z"),
  retiredAt: new Date("2026-08-10T00:00:00.000Z"),
}

const coverageRow = {
  id: "row-1",
  subjectType: "DOCTOR",
  subjectId: "doctor-1",
  subjectName: "Doctor One",
  customerId: "clinic-1",
  customerName: "Clinic One",
  groupKey: "doctors",
  groupLabel: "Врачи",
  groupOrder: 1,
  categoryCode: "A",
  categoryLabel: "A",
  specialtyCode: "PE",
  specialtyName: "Pediatrician",
  requiredCoverage: "1",
  actualMoi: "0",
  target: "0",
  actualCoverage: "0",
  uncoveredMoi: "1",
  explanation: {
    summary: {
      ru: "Не покрыто по подписанной формуле",
      az: "İmzalanmış düstura görə əhatə olunmayıb",
      en: "Uncovered under the signed formula",
    },
    sourceRule: "SWM15-v1",
  },
  planningContext: { sourcePeriod: "2026-07" },
}

function request(query = "?groupKey=doctors&uncoveredOnly=true&page=1&limit=5") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/coverage-snapshots/snapshot-1/rows${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: "org-1", userId: "manager-user", role: "user", email: "manager@example.com", name: "Manager",
  } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: "manager-agent", role: "MANAGER", scopedAgentIds: ["manager-agent", "agent-1"],
  } as never)
  vi.mocked(prisma.mtmCoverageSnapshot.findFirst).mockResolvedValue(snapshot as never)
  vi.mocked(prisma.mtmCoveragePolicy.findFirst).mockResolvedValue(policy as never)
  vi.mocked(prisma.mtmCoverageSnapshotRow.count).mockResolvedValue(1 as never)
  vi.mocked(prisma.mtmCoverageSnapshotRow.findMany).mockResolvedValue([coverageRow] as never)
})

describe("GET /api/v1/mtm/coverage-snapshots/:id/rows", () => {
  it("returns bounded uncovered explanations and a safe planning target", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: "snapshot-1" }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        filter: { groupKey: "doctors", uncoveredOnly: true, page: 1, limit: 5 },
        total: 1,
        hasMore: false,
        rows: [{
          id: "row-1",
          uncoveredMoi: "1",
          explanation: { summary: { en: "Uncovered under the signed formula" } },
          planningTarget: { customerId: "clinic-1", contactId: "doctor-1" },
        }],
      },
    })
    expect(prisma.mtmCoverageSnapshotRow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        snapshotId: "snapshot-1",
        groupKey: "doctors",
        uncoveredMoi: { gt: 0 },
      }),
      skip: 0,
      take: 5,
    }))
    const select = vi.mocked(prisma.mtmCoverageSnapshotRow.findMany).mock.calls[0][0] as any
    expect(select.select).not.toHaveProperty("sourceEvidence")
    expect(select.select).not.toHaveProperty("rowHash")
  })

  it("hides an employee snapshot outside the manager scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-agent", role: "MANAGER", scopedAgentIds: ["manager-agent"],
    } as never)
    const response = await GET(request(), { params: Promise.resolve({ id: "snapshot-1" }) })
    expect(response.status).toBe(404)
    expect(prisma.mtmCoveragePolicy.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmCoverageSnapshotRow.findMany).not.toHaveBeenCalled()
  })

  it("fails closed when a stored explanation cannot justify the row", async () => {
    vi.mocked(prisma.mtmCoverageSnapshotRow.findMany).mockResolvedValue([{
      ...coverageRow,
      explanation: { formula: "missing-localized-summary" },
    }] as never)
    const response = await GET(request(), { params: Promise.resolve({ id: "snapshot-1" }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_COVERAGE_ROW_EXPLANATION_INVALID" })
  })
})
