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

import { POST as CREATE_POLICY } from "@/app/api/v1/mtm/coverage-policies/route"
import { POST as ACTIVATE_POLICY } from "@/app/api/v1/mtm/coverage-policies/[id]/activate/route"
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
    population: { source: "CONTACT", filter: { type: "DOCTOR", status: "ACTIVE" } },
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

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: "policy-1",
    organizationId: "org-1",
    code: "BASE_COVERAGE",
    version: 1,
    nameRu: "Покрытие базы",
    nameAz: "Baza əhatəsi",
    nameEn: "Base coverage",
    schemaVersion: 1,
    definition,
    definitionHash: coveragePolicyHash(definition),
    approvalReference: null,
    sourceSystem: "SwissMed specification",
    sourceReference: "SWM15",
    sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"),
    effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
    effectiveTo: null,
    status: "DRAFT",
    createdByUserId: "admin-user",
    signedByUserId: null,
    signedAt: null,
    activatedAt: null,
    retiredAt: null,
    createdAt: new Date("2026-08-08T08:00:00.000Z"),
    updatedAt: new Date("2026-08-08T08:00:00.000Z"),
    ...overrides,
  }
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
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: null,
    role: "ADMIN",
    scopedAgentIds: null,
  } as never)
})

describe("MTM coverage policy configuration", () => {
  it("creates an unsigned draft with a server-computed definition hash", async () => {
    const created = policy()
    vi.mocked(prisma.mtmCoveragePolicy.create).mockResolvedValue(created as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
    const response = await CREATE_POLICY(new NextRequest("http://localhost:3000/api/v1/mtm/coverage-policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "BASE_COVERAGE",
        version: 1,
        nameRu: "Покрытие базы",
        nameAz: "Baza əhatəsi",
        nameEn: "Base coverage",
        definition,
        sourceSystem: "SwissMed specification",
        sourceReference: "SWM15",
        sourceObservedAt: "2026-08-01T00:00:00.000Z",
        effectiveFrom: "2026-07-01",
      }),
    }))
    expect(response.status).toBe(201)
    expect(prisma.mtmCoveragePolicy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "DRAFT",
        definitionHash: coveragePolicyHash(definition),
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledOnce()
  })

  it("activates under an org lock and atomically records the approval", async () => {
    const draft = policy()
    const signedAt = new Date("2026-08-08T08:30:00.000Z")
    const active = policy({
      status: "ACTIVE",
      approvalReference: "SwissMed approval SWM15-2026-08",
      signedByUserId: "admin-user",
      signedAt,
      activatedAt: signedAt,
    })
    vi.mocked(prisma.mtmCoveragePolicy.findFirst)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(active as never)
    vi.mocked(prisma.mtmCoveragePolicy.updateMany)
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
    const response = await ACTIVATE_POLICY(new NextRequest("http://localhost:3000/api/v1/mtm/coverage-policies/policy-1/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedDefinitionHash: draft.definitionHash,
        approvalReference: "SwissMed approval SWM15-2026-08",
      }),
    }), { params: Promise.resolve({ id: "policy-1" }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, idempotent: false })
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    expect(prisma.mtmCoveragePolicy.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "ACTIVE",
        approvalReference: "SwissMed approval SWM15-2026-08",
        signedByUserId: "admin-user",
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledOnce()
  })
})
