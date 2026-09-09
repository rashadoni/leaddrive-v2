import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), requireAuth: vi.fn(),
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

import { POST as CREATE } from "@/app/api/v1/mtm/kpi-policies/route"
import { POST as ACTIVATE } from "@/app/api/v1/mtm/kpi-policies/[id]/activate/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { kpiPolicyHash } from "@/lib/mtm/kpi-policy"
import { prisma } from "@/lib/prisma"

const definition = {
  schemaVersion: 1, formulaVersion: "SWM_PLAN_GPS_V1",
  rounding: { mode: "HALF_UP", scale: 1 },
  plan: { numerator: "VISITED_ROUTE_POINTS", denominator: "NON_DRAFT_NON_CANCELLED_ROUTE_POINTS" },
  gps: { numerator: "COMPLETED_VISITS_WITH_VALID_CHECK_IN_AND_CHECK_OUT", denominator: "COMPLETED_VISITS" },
  exclusions: ["DRAFT_ROUTES", "CANCELLED_ROUTES", "CANCELLED_VISITS", "SOFT_DELETED_RECORDS"],
  visitTypeAliases: { DOUBLE: ["DOUBLE", "JOINT"], INDEPENDENT: ["INDEPENDENT", "SELF"] },
  reconciliationCases: [{
    name: "approved baseline", filter: { visitType: "ALL", brandId: null },
    planPoints: [{ routePointId: "rp", agentId: "a", agentName: "A", customerId: "c", customerName: "C", contactId: null, date: "2026-07-01", visitType: "INDEPENDENT", brandIds: [], completed: true }],
    visits: [{ visitId: "v", routePointId: "rp", agentId: "a", agentName: "A", customerId: "c", customerName: "C", contactId: null, date: "2026-07-01", visitType: "INDEPENDENT", brandIds: [], completed: true, gpsConfirmed: true }],
    expected: { plan: { numerator: 1, denominator: 1, percentage: 100 }, gps: { numerator: 1, denominator: 1, percentage: 100 } },
  }],
}
function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: "policy-1", organizationId: "org-1", code: "SWM_PLAN_GPS", version: 1,
    nameRu: "Формула KPI", nameAz: "KPI formulu", nameEn: "KPI formula",
    schemaVersion: 1, definition, definitionHash: kpiPolicyHash(definition),
    approvalReference: null, sourceSystem: "SwissMed specification", sourceReference: "SWM-13",
    sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"), effectiveFrom: new Date("2026-07-01T00:00:00.000Z"), effectiveTo: null,
    status: "DRAFT", createdByUserId: "admin-user", signedByUserId: null, signedAt: null, activatedAt: null, retiredAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  }
}
function createRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/kpi-policies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
})

describe("SWM-13 KPI policy configuration", () => {
  it("creates an audited draft only after server reconciliation", async () => {
    vi.mocked(prisma.mtmKpiPolicy.create).mockResolvedValue(policy() as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit" } as never)
    const response = await CREATE(createRequest({
      code: "SWM_PLAN_GPS", version: 1, nameRu: "Формула KPI", nameAz: "KPI formulu", nameEn: "KPI formula",
      definition, sourceSystem: "SwissMed specification", sourceReference: "SWM-13",
      sourceObservedAt: "2026-08-01T00:00:00.000Z", effectiveFrom: "2026-07-01",
    }))
    expect(response.status).toBe(201)
    expect(prisma.mtmKpiPolicy.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT", definitionHash: kpiPolicyHash(definition) }) }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledOnce()
  })

  it("rejects a package whose declared control result does not reconcile", async () => {
    const invalid = { ...definition, reconciliationCases: [{ ...definition.reconciliationCases[0], expected: { ...definition.reconciliationCases[0].expected, gps: { numerator: 0, denominator: 1, percentage: 0 } } }] }
    const response = await CREATE(createRequest({
      code: "SWM_PLAN_GPS", version: 1, nameRu: "Формула KPI", nameAz: "KPI formulu", nameEn: "KPI formula",
      definition: invalid, sourceSystem: "SwissMed specification", sourceObservedAt: "2026-08-01T00:00:00.000Z", effectiveFrom: "2026-07-01",
    }))
    expect(response.status).toBe(422)
    expect(prisma.mtmKpiPolicy.create).not.toHaveBeenCalled()
  })

  it("activates the exact reviewed hash under the tenant lock and writes audit", async () => {
    const draft = policy()
    const signedAt = new Date("2026-08-09T10:00:00.000Z")
    const active = policy({ status: "ACTIVE", approvalReference: "SWM-13 approval", signedByUserId: "admin-user", signedAt, activatedAt: signedAt })
    vi.mocked(prisma.mtmKpiPolicy.findFirst).mockResolvedValueOnce(draft as never).mockResolvedValueOnce(null as never).mockResolvedValueOnce(active as never)
    vi.mocked(prisma.mtmKpiPolicy.updateMany).mockResolvedValueOnce({ count: 0 } as never).mockResolvedValueOnce({ count: 1 } as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit" } as never)
    const response = await ACTIVATE(new NextRequest("http://localhost:3000/api/v1/mtm/kpi-policies/policy-1/activate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedDefinitionHash: draft.definitionHash, approvalReference: "SWM-13 approval" }),
    }), { params: Promise.resolve({ id: "policy-1" }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, data: { idempotent: false } })
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledOnce()
  })

  it("denies a manager before any policy write", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager", role: "MANAGER", scopedAgentIds: [] } as never)
    const response = await CREATE(createRequest({}))
    expect(response.status).toBe(403)
    expect(prisma.mtmKpiPolicy.create).not.toHaveBeenCalled()
  })
})
