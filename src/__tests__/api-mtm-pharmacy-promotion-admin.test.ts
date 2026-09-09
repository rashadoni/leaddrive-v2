/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const authState = vi.hoisted(() => ({
  principal: "web" as "web" | "mobile",
  userId: "admin-user",
  role: "admin",
  agentId: null as string | null,
}))

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-mtm-rls-auth", () => ({
  withMtmRlsAuth: (_module: unknown, _action: unknown, handler: (...args: any[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, {
      orgId: "org-1",
      userId: authState.userId,
      role: authState.role,
      email: "actor@example.com",
      name: "Actor",
      agentId: authState.agentId,
      principal: authState.principal,
    }, context),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

import { POST as retireVersion } from "@/app/api/v1/mtm/pharmacy-promotions/[id]/versions/[versionId]/retire/route"
import { GET as listTargets, POST as planTarget } from "@/app/api/v1/mtm/pharmacy-promotion-targets/route"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const PROMOTION = "promotion-1"
const VERSION = "version-1"
const DEFINITION_HASH = "a".repeat(64)
const ELIGIBILITY = {
  schemaVersion: 1,
  customerObjectTypes: ["PHARMACY"],
  requireActiveCustomer: true,
  requireCompletedVisit: true,
  minimumEvidenceCount: 1,
} as const

const administrator: MtmRouteActor = { agentId: null, role: "ADMIN", scopedAgentIds: null }
const manager: MtmRouteActor = { agentId: "manager-1", role: "MANAGER", scopedAgentIds: ["agent-1"] }

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function getRequest(path: string) {
  return new NextRequest(`http://localhost${path}`)
}

function routeContext() {
  return { params: Promise.resolve({ id: PROMOTION, versionId: VERSION }) }
}

function version(status: "PUBLISHED" | "RETIRED" | "DRAFT") {
  return {
    id: VERSION,
    organizationId: ORG,
    promotionId: PROMOTION,
    definitionHash: DEFINITION_HASH,
    status,
    retiredAt: status === "RETIRED" ? new Date("2026-08-01T12:00:00.000Z") : null,
  }
}

const targetBody = {
  promotionVersionId: VERSION,
  customerId: "customer-1",
  assignedAgentId: "agent-1",
  planQuantity: "10",
  unit: "packs",
  sourceSystem: "SWISSMED_TPM",
  sourceReference: "SM-PLAN-001",
  observedAt: "2026-08-01T09:00:00.000Z",
  operationId: "operation-plan-001",
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.principal = "web"
  authState.userId = "admin-user"
  authState.role = "admin"
  authState.agentId = null
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(administrator)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([])
  vi.mocked(prisma.mtmPharmacyPromotionEvent.create).mockResolvedValue({ id: "event-1" } as never)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
})

describe("SWM-09 campaign version retirement", () => {
  it("atomically retires only the selected tenant version and preserves all historical rows", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionVersion.findFirst)
      .mockResolvedValueOnce(version("PUBLISHED") as never)
      .mockResolvedValueOnce(version("RETIRED") as never)
    vi.mocked(prisma.mtmPharmacyPromotionVersion.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await retireVersion(request(
      `/api/v1/mtm/pharmacy-promotions/${PROMOTION}/versions/${VERSION}/retire`,
      { expectedDefinitionHash: DEFINITION_HASH.toUpperCase(), reason: "Governed formula rollover" },
    ), routeContext())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      idempotent: false,
      data: { historicalRecordsPreserved: true, newTargetPlanningAllowed: false },
    })
    expect(prisma.mtmPharmacyPromotionVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: VERSION,
        organizationId: ORG,
        promotionId: PROMOTION,
        status: "PUBLISHED",
        definitionHash: DEFINITION_HASH,
      },
      data: { status: "RETIRED", retiredAt: expect.any(Date) },
    })
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        promotionVersionId: VERSION,
        eventType: "PROMOTION_VERSION_RETIRED",
        fromState: "PUBLISHED",
        toState: "RETIRED",
        sourceKey: `promotion-version:${VERSION}:retired`,
        payload: expect.objectContaining({
          preservesHistoricalExecutions: true,
          allowsNewTargetPlanning: false,
        }),
      }),
    })
    expect(prisma.mtmPharmacyPromotionTarget.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.$queryRaw).mock.calls.map((call: unknown[]) => call[1])).toEqual([
      `mtm-pharmacy-promotion:${ORG}:${PROMOTION}`,
      `mtm-pharmacy-version:${ORG}:${VERSION}`,
    ])
  })

  it("rejects a different replay reason instead of rewriting the audit trail", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionVersion.findFirst).mockResolvedValue(version("RETIRED") as never)
    const originalRequestHash = pharmacyPromotionHash({
      promotionId: PROMOTION,
      versionId: VERSION,
      expectedDefinitionHash: DEFINITION_HASH,
      reason: "Original governed retirement",
    })
    vi.mocked(prisma.mtmPharmacyPromotionEvent.findFirst).mockResolvedValue({ requestHash: originalRequestHash } as never)

    const response = await retireVersion(request(
      `/api/v1/mtm/pharmacy-promotions/${PROMOTION}/versions/${VERSION}/retire`,
      { expectedDefinitionHash: DEFINITION_HASH, reason: "A different retirement reason" },
    ), routeContext())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_VERSION_RETIRE_REPLAY_CONFLICT" })
    expect(prisma.mtmPharmacyPromotionVersion.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
  })
})

describe("SWM-09 target planning race and permission containment", () => {
  it("projects only scoped completed visits for offline-capable execution capture", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(manager)
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findMany).mockResolvedValue([])

    const response = await listTargets(getRequest(
      "/api/v1/mtm/pharmacy-promotion-targets?agentId=agent-1",
    ))

    expect(response.status).toBe(200)
    expect(prisma.mtmPharmacyPromotionTarget.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        AND: [
          { assignedAgentId: "agent-1" },
          { assignedAgentId: { in: ["agent-1"] } },
        ],
      }),
      include: expect.objectContaining({
        customer: {
          select: expect.objectContaining({
            visits: {
              where: {
                organizationId: ORG,
                status: "CHECKED_OUT",
                deletedAt: null,
                checkOutAt: { not: null },
                agentId: { in: ["agent-1"] },
              },
              orderBy: [{ checkOutAt: "desc" }, { id: "desc" }],
              take: 10,
              select: expect.objectContaining({ id: true, agentId: true, checkOutAt: true }),
            },
          }),
        },
      }),
    }))
  })

  it("rejects a foreign employee target/visit projection before querying tenant data", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(manager)

    const response = await listTargets(getRequest(
      "/api/v1/mtm/pharmacy-promotion-targets?agentId=agent-foreign",
    ))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_TARGET_SCOPE_DENIED" })
    expect(prisma.mtmPharmacyPromotionTarget.findMany).not.toHaveBeenCalled()
  })

  it("links the target event to the normalized durable planning operation", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionOperation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmPharmacyPromotionVersion.findFirst).mockResolvedValue({
      id: VERSION,
      organizationId: ORG,
      status: "PUBLISHED",
      timezone: "Asia/Baku",
      endsOn: new Date("2099-12-31T00:00:00.000Z"),
      eligibilityDefinition: ELIGIBILITY,
      eligibilityDefinitionHash: pharmacyPromotionHash(ELIGIBILITY),
      promotion: { id: PROMOTION, code: "PROMO-1" },
      type: { id: "type-1" },
    } as never)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "customer-1",
      code: "P-001",
      name: "Pharmacy One",
      address: "Baku",
      objectType: "PHARMACY",
      status: "ACTIVE",
      managingManagerId: null,
      managingManager: null,
    } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      status: "ACTIVE",
      team: null,
      manager: null,
    } as never)
    vi.mocked(prisma.mtmCustomerAgentAssignment.findFirst).mockResolvedValue({
      id: "assignment-1",
      role: "PRIMARY",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
    } as never)
    vi.mocked(prisma.mtmPharmacyPromotionOperation.create).mockImplementation(async (args: any) => ({
      id: "operation-db-1",
      ...args.data,
    }) as never)
    vi.mocked(prisma.mtmPharmacyPromotionTarget.create).mockImplementation(async (args: any) => ({
      id: "target-1",
      ...args.data,
    }) as never)
    vi.mocked(prisma.mtmPharmacyPromotionOperation.update).mockResolvedValue({ id: "operation-db-1" } as never)

    const response = await planTarget(request("/api/v1/mtm/pharmacy-promotion-targets", targetBody))

    expect(response.status).toBe(201)
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        promotionId: PROMOTION,
        promotionVersionId: VERSION,
        targetId: "target-1",
        operationId: "operation-db-1",
        eventType: "PROMOTION_TARGET_PLANNED",
        requestHash: pharmacyPromotionHash(targetBody),
      }),
    })
  })

  it("rechecks current manager authority before an idempotent replay and shares the version lifecycle lock", async () => {
    authState.role = "member"
    vi.mocked(resolveMtmRouteActor)
      .mockResolvedValueOnce(manager)
      .mockResolvedValueOnce(null)

    const response = await planTarget(request("/api/v1/mtm/pharmacy-promotion-targets", targetBody))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_TARGET_PLAN_DENIED" })
    expect(prisma.mtmPharmacyPromotionOperation.findFirst).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.$queryRaw).mock.calls.map((call: unknown[]) => call[1])).toEqual([
      `mtm-pharmacy-target:${ORG}:${targetBody.operationId}`,
      `mtm-pharmacy-version:${ORG}:${VERSION}`,
    ])
  })
})
