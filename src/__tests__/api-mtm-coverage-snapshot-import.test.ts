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

import { POST } from "@/app/api/v1/mtm/coverage-snapshots/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { CoverageSnapshotImportSchema, coveragePolicyHash } from "@/lib/mtm/coverage-policy"
import { prepareCoverageSnapshot } from "@/lib/mtm/coverage-snapshot"
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

const policy = {
  id: "policy-1",
  organizationId: "org-1",
  code: "BASE_COVERAGE",
  version: 1,
  definition,
  definitionHash: coveragePolicyHash(definition),
  approvalReference: "SwissMed approval SWM15-2026-08",
  sourceSystem: "SwissMed specification",
  sourceReference: "SWM15",
  sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"),
  effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
  effectiveTo: null,
  status: "ACTIVE",
  signedByUserId: "admin-user",
  signedAt: new Date("2026-08-08T08:00:00.000Z"),
  activatedAt: new Date("2026-08-08T08:00:00.000Z"),
  retiredAt: null,
}

const payload = {
  policyId: policy.id,
  expectedDefinitionHash: policy.definitionHash,
  agentId: "agent-1",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  sourceCutoffAt: "2026-06-30T20:00:00.000Z",
  sourceFreshnessAt: "2026-06-30T19:45:00.000Z",
  sourceBatchReference: "swissmed-2026-06",
  rows: [{
    subjectType: "PHARMACY",
    subjectId: "pharmacy-1",
    subjectName: "Pharmacy 1",
    groupKey: "pharmacies",
    requiredCoverage: "50",
    actualMoi: "44",
    target: "0",
    actualCoverage: "44",
    uncoveredMoi: "30",
    explanation: {
      summary: {
        ru: "Не покрыто по подписанной формуле",
        az: "İmzalanmış düstura görə əhatə olunmayıb",
        en: "Uncovered under the signed formula",
      },
      formula: "signed-external-result",
    },
    planningContext: { direction: "PHARMACIES" },
    sourceEvidence: { sourceRow: "row-1" },
  }],
}

function request() {
  return new NextRequest("http://localhost:3000/api/v1/mtm/coverage-snapshots", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest" },
    body: JSON.stringify(payload),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: "org-1",
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
  vi.mocked(prisma.mtmCoveragePolicy.findFirst).mockResolvedValue(policy as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Aysel" } as never)
  vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "pharmacy-1", objectType: "PHARMACY" }] as never)
})

describe("POST /api/v1/mtm/coverage-snapshots", () => {
  it("freezes verified tenant rows and their server-reconciled totals atomically", async () => {
    const building = {
      id: "snapshot-1",
      status: "BUILDING",
      populationHash: "building-hash",
    }
    const frozen = {
      id: "snapshot-1",
      status: "FROZEN",
      populationHash: "frozen-hash",
      policyVersion: 1,
      timezone: "Asia/Baku",
      sourceCutoffAt: new Date("2026-06-30T20:00:00.000Z"),
      sourceFreshnessAt: new Date("2026-06-30T19:45:00.000Z"),
    }
    vi.mocked(prisma.mtmCoverageSnapshot.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(frozen as never)
    vi.mocked(prisma.mtmCoverageSnapshot.create).mockResolvedValue(building as never)
    vi.mocked(prisma.mtmCoverageSnapshotRow.createMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmCoverageSnapshot.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)

    const response = await POST(request())
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ success: true, idempotent: false, data: { id: "snapshot-1", status: "FROZEN" } })
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    expect(prisma.mtmCoverageSnapshotRow.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        organizationId: "org-1",
        snapshotId: "snapshot-1",
        subjectType: "PHARMACY",
        customerId: "pharmacy-1",
        ownerAgentId: "agent-1",
        groupLabel: "Аптеки",
        uncoveredMoi: "30",
        sourceEvidence: expect.objectContaining({ sourceBatchReference: "swissmed-2026-06" }),
      })],
    })
    expect(prisma.mtmCoverageSnapshot.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "BUILDING" }),
      data: expect.objectContaining({
        status: "FROZEN",
        totals: expect.objectContaining({ overall: expect.objectContaining({ uncoveredMoi: "30" }) }),
        completeness: expect.objectContaining({ complete: true, expectedRows: 1, persistedRows: 1 }),
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledOnce()
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: "Serializable",
      timeout: 30_000,
    }))
  })

  it("rejects a cross-tenant or missing subject before creating a snapshot", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([] as never)
    const response = await POST(request())
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: "MTM_COVERAGE_SNAPSHOT_SUBJECTS_INVALID",
      missingCustomers: ["pharmacy-1"],
    })
    expect(prisma.mtmCoverageSnapshot.create).not.toHaveBeenCalled()
    expect(prisma.mtmCoverageSnapshotRow.createMany).not.toHaveBeenCalled()
  })

  it("returns an exact frozen replay without writing rows or duplicate audit", async () => {
    const normalized = CoverageSnapshotImportSchema.parse({
      ...payload,
      rows: payload.rows.map((row) => ({
        ...row,
        customerId: row.subjectId,
        customerName: row.subjectName,
        sourceEvidence: { ...row.sourceEvidence, sourceBatchReference: payload.sourceBatchReference },
      })),
    })
    const prepared = prepareCoverageSnapshot(definition, normalized, { id: "agent-1", name: "Aysel" })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    vi.mocked(prisma.mtmCoverageSnapshot.findFirst).mockResolvedValue({
      id: "snapshot-existing",
      status: "FROZEN",
      populationHash: prepared.value.populationHash,
      policyVersion: 1,
      timezone: "Asia/Baku",
      sourceCutoffAt: new Date(payload.sourceCutoffAt),
      sourceFreshnessAt: new Date(payload.sourceFreshnessAt),
    } as never)

    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, idempotent: true, data: { id: "snapshot-existing" } })
    expect(prisma.mtmCoverageSnapshot.create).not.toHaveBeenCalled()
    expect(prisma.mtmCoverageSnapshotRow.createMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})
