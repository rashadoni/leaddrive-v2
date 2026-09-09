/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from "@prisma/client"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
      email: `${authState.userId}@example.com`,
      name: "Actor",
      agentId: authState.agentId,
      principal: authState.principal,
    }, context),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})
vi.mock("@/lib/mtm/mobile-capabilities", () => ({ requireMobileCapability: vi.fn() }))

import { POST as overrideEligibility } from "@/app/api/v1/mtm/pharmacy-promotion-targets/[id]/eligibility-override/route"
import { POST as submitExecution } from "@/app/api/v1/mtm/pharmacy-promotion-executions/[id]/submit/route"
import { prisma } from "@/lib/prisma"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"

const ORG = "org-1"
const TARGET = "target-1"
const EXECUTION = "execution-1"
const OVERRIDE_REASON = "Approved field exception SWM-09-2026-08-01"
const OVERRIDE_BODY = {
  operationId: "operation-eligibility-override-0001",
  expectedEligibilityStatus: "PENDING" as const,
  reason: OVERRIDE_REASON,
}

const administrator: MtmRouteActor = { agentId: null, role: "ADMIN", scopedAgentIds: null }
const manager: MtmRouteActor = { agentId: "manager-1", role: "MANAGER", scopedAgentIds: ["agent-1"] }
const fieldAgent: MtmRouteActor = { agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] }

const FORMULA = {
  schemaVersion: 1,
  kind: "LINEAR_V1",
  factPointsPerUnit: "1",
  rewardPointsPerUnit: "0.5",
  scale: 4,
  rounding: "HALF_UP",
  sourceFreshnessMinutes: 60,
} as const
const POLICY = {
  schemaVersion: 1,
  levels: ["L1", "L2"],
  l1Roles: ["MANAGER", "SUPERVISOR", "ADMIN"],
  l2Roles: ["MANAGER", "ADMIN"],
  preventSelfApproval: true,
  requireDistinctReviewers: true,
  reasonRequiredFor: ["REJECTED", "RETURNED"],
} as const
const ELIGIBILITY = {
  schemaVersion: 1,
  customerObjectTypes: ["PHARMACY"],
  requireActiveCustomer: true,
  requireCompletedVisit: true,
  minimumEvidenceCount: 2,
} as const

function jsonRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function context(id = TARGET) {
  return { params: Promise.resolve({ id }) }
}

function overrideTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET,
    organizationId: ORG,
    status: "PLANNED",
    eligibilityStatus: "PENDING",
    eligibilitySnapshot: { schemaVersion: 1, status: "PENDING", pendingOrFailedReasons: ["VISIT_INCOMPLETE"] },
    eligibilityOverrideReason: null,
    promotionVersionId: "promotion-version-1",
    promotionVersion: { promotionId: "promotion-1" },
    ...overrides,
  }
}

function submitDraft() {
  const formulaHash = pharmacyPromotionHash(FORMULA)
  const policyHash = pharmacyPromotionHash(POLICY)
  const eligibilityHash = pharmacyPromotionHash(ELIGIBILITY)
  return {
    id: EXECUTION,
    clientExecutionId: "client-execution-offline-0001",
    organizationId: ORG,
    targetId: TARGET,
    agentId: "agent-1",
    visitId: "visit-1",
    visit: {
      id: "visit-1",
      status: "CHECKED_IN",
      customerId: "pharmacy-1",
      agentId: "agent-1",
      checkOutAt: null,
      deletedAt: null,
    },
    actualQuantity: new Prisma.Decimal("10"),
    version: 1,
    status: "DRAFT",
    l1State: "NOT_READY",
    l2State: "NOT_READY",
    sourceObservedAt: new Date("2026-08-01T09:30:00.000Z"),
    sourceReceivedAt: new Date("2026-08-01T09:31:00.000Z"),
    formulaId: "formula-1",
    formulaHash,
    formula: {
      id: "formula-1",
      version: 1,
      status: "ACTIVE",
      definition: FORMULA,
      definitionHash: formulaHash,
      signedAt: new Date("2026-08-01T08:00:00.000Z"),
      approvalReference: "FORMULA-APPROVAL-1",
    },
    approvalPolicyId: "policy-1",
    approvalPolicyHash: policyHash,
    approvalPolicy: {
      id: "policy-1",
      version: 1,
      status: "ACTIVE",
      definition: POLICY,
      definitionHash: policyHash,
      signedAt: new Date("2026-08-01T08:00:00.000Z"),
      approvalReference: "POLICY-APPROVAL-1",
    },
    target: {
      id: TARGET,
      status: "CONNECTED",
      eligibilityStatus: "OVERRIDDEN",
      eligibilityOverrideReason: OVERRIDE_REASON,
      customer: {
        id: "pharmacy-1",
        objectType: "PHARMACY",
        status: "ACTIVE",
        deletedAt: null,
      },
      promotionVersion: {
        id: "promotion-version-1",
        status: "PUBLISHED",
        timezone: "Asia/Baku",
        startsOn: new Date("2026-08-01T00:00:00.000Z"),
        endsOn: new Date("2026-08-31T00:00:00.000Z"),
        eligibilityDefinition: ELIGIBILITY,
        eligibilityDefinitionHash: eligibilityHash,
        eligibilityApprovedAt: new Date("2026-08-01T08:00:00.000Z"),
        eligibilityApprovalReference: "ELIGIBILITY-APPROVAL-1",
      },
    },
    _count: { evidence: 0 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-08-01T10:00:00.000Z"))
  authState.principal = "web"
  authState.userId = "admin-user"
  authState.role = "admin"
  authState.agentId = null
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(administrator)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([])
  vi.mocked(prisma.mtmPharmacyPromotionEvent.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmPharmacyPromotionEvent.create).mockResolvedValue({ id: "event-1" } as never)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
  vi.mocked(prisma.mtmPharmacyPromotionTarget.updateMany).mockResolvedValue({ count: 1 } as never)
})

afterEach(() => vi.useRealTimers())

describe("SWM-09 governed target eligibility override", () => {
  it("atomically records a reasoned tenant target exception and immutable domain audit", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst).mockResolvedValue(overrideTarget() as never)

    const response = await overrideEligibility(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-targets/${TARGET}/eligibility-override`,
      OVERRIDE_BODY,
    ), context())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      idempotent: false,
      data: { target: { id: TARGET, eligibilityStatus: "OVERRIDDEN", eligibilityOverrideReason: OVERRIDE_REASON } },
    })
    expect(prisma.mtmPharmacyPromotionTarget.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET, organizationId: ORG },
    }))
    expect(prisma.mtmPharmacyPromotionTarget.updateMany).toHaveBeenCalledWith({
      where: {
        id: TARGET,
        organizationId: ORG,
        status: { in: ["PLANNED", "CONNECTED"] },
        eligibilityStatus: "PENDING",
      },
      data: expect.objectContaining({
        eligibilityStatus: "OVERRIDDEN",
        eligibilityOverrideReason: OVERRIDE_REASON,
        eligibilitySnapshot: expect.objectContaining({
          status: "OVERRIDDEN",
          previousStatus: "PENDING",
          override: expect.objectContaining({
            reason: OVERRIDE_REASON,
            operationId: OVERRIDE_BODY.operationId,
            actorUserId: "admin-user",
          }),
        }),
      }),
    })
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        promotionId: "promotion-1",
        promotionVersionId: "promotion-version-1",
        targetId: TARGET,
        eventType: "PROMOTION_TARGET_ELIGIBILITY_OVERRIDDEN",
        fromState: "PENDING",
        toState: "OVERRIDDEN",
        actorUserId: "admin-user",
        sourceKey: `promotion-target:${TARGET}:eligibility-override:${OVERRIDE_BODY.operationId}`,
        requestHash: pharmacyPromotionHash({ targetId: TARGET, ...OVERRIDE_BODY }),
        payload: expect.objectContaining({
          reason: OVERRIDE_REASON,
          operationId: OVERRIDE_BODY.operationId,
          actorUserId: "admin-user",
          actorAgentId: null,
          occurredAt: "2026-08-01T10:00:00.000Z",
        }),
      }),
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        action: "PHARMACY_PROMOTION_ELIGIBILITY_OVERRIDE",
        entityId: TARGET,
        newData: expect.objectContaining({ eligibilityOverrideReason: OVERRIDE_REASON }),
      }),
    })
  })

  it("replays only the same actor, reason and optimistic source state", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst).mockResolvedValue(overrideTarget({
      eligibilityStatus: "OVERRIDDEN",
      eligibilityOverrideReason: OVERRIDE_REASON,
    }) as never)
    vi.mocked(prisma.mtmPharmacyPromotionEvent.findFirst).mockResolvedValue({
      eventType: "PROMOTION_TARGET_ELIGIBILITY_OVERRIDDEN",
      targetId: TARGET,
      actorUserId: "admin-user",
      requestHash: pharmacyPromotionHash({ targetId: TARGET, ...OVERRIDE_BODY }),
    } as never)

    const response = await overrideEligibility(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-targets/${TARGET}/eligibility-override`,
      OVERRIDE_BODY,
    ), context())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, idempotent: true })
    expect(prisma.mtmPharmacyPromotionTarget.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("rejects a reused operation ID with a different reason", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst).mockResolvedValue(overrideTarget({
      eligibilityStatus: "OVERRIDDEN",
      eligibilityOverrideReason: OVERRIDE_REASON,
    }) as never)
    vi.mocked(prisma.mtmPharmacyPromotionEvent.findFirst).mockResolvedValue({
      eventType: "PROMOTION_TARGET_ELIGIBILITY_OVERRIDDEN",
      targetId: TARGET,
      actorUserId: "admin-user",
      requestHash: pharmacyPromotionHash({ targetId: TARGET, ...OVERRIDE_BODY }),
    } as never)

    const response = await overrideEligibility(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-targets/${TARGET}/eligibility-override`,
      { ...OVERRIDE_BODY, reason: "Different governed exception" },
    ), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_REPLAY_CONFLICT" })
    expect(prisma.mtmPharmacyPromotionTarget.updateMany).not.toHaveBeenCalled()
  })

  it("requires a non-empty reason before entering the write transaction", async () => {
    const response = await overrideEligibility(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-targets/${TARGET}/eligibility-override`,
      { ...OVERRIDE_BODY, reason: " " },
    ), context())

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_INVALID" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("denies managers and mobile principals before reading a target", async () => {
    authState.role = "member"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(manager)
    const managerResponse = await overrideEligibility(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-targets/${TARGET}/eligibility-override`,
      OVERRIDE_BODY,
    ), context())
    expect(managerResponse.status).toBe(403)

    authState.principal = "mobile"
    authState.agentId = "agent-1"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    const mobileResponse = await overrideEligibility(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-targets/${TARGET}/eligibility-override`,
      OVERRIDE_BODY,
    ), context())
    expect(mobileResponse.status).toBe(403)
    expect(prisma.mtmPharmacyPromotionTarget.findFirst).not.toHaveBeenCalled()
  })

  it("does not resolve a target outside the authenticated tenant", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst).mockResolvedValue(null)
    const response = await overrideEligibility(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-targets/${TARGET}/eligibility-override`,
      OVERRIDE_BODY,
    ), context())

    expect(response.status).toBe(404)
    expect(prisma.mtmPharmacyPromotionTarget.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET, organizationId: ORG },
    }))
    expect(prisma.mtmPharmacyPromotionTarget.updateMany).not.toHaveBeenCalled()
  })
})

describe("SWM-09 execution submit with an audited eligibility exception", () => {
  it("honours the override for visit/evidence eligibility while retaining all other posting gates", async () => {
    authState.userId = "agent-user"
    authState.role = "member"
    authState.agentId = "agent-1"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    const draft = submitDraft()
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockResolvedValue([{
      id: EXECUTION,
      target: { promotionVersionId: "promotion-version-1" },
    }] as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce({
        ...draft,
        status: "READY",
        l1State: "READY",
        version: 2,
        factPointsPreview: new Prisma.Decimal("10"),
        rewardPointsPreview: new Prisma.Decimal("5"),
        differencePointsPreview: new Prisma.Decimal("5"),
        submittedAt: new Date("2026-08-01T10:00:00.000Z"),
        readyAt: new Date("2026-08-01T10:00:00.000Z"),
      } as never)
    vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue({ value: true } as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await submitExecution(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/submit`,
      { operationId: "operation-submit-override-0001", expectedVersion: 1 },
    ), context(EXECUTION))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, data: { status: "READY", version: 2 } })
    expect(prisma.mtmPharmacyPromotionTarget.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetId: TARGET,
        executionId: EXECUTION,
        eventType: "EXECUTION_SUBMITTED",
        payload: expect.objectContaining({
          eligibility: {
            evaluatedStatus: "INELIGIBLE",
            evaluatedReasons: ["VISIT_INCOMPLETE", "EVIDENCE_INCOMPLETE"],
            previousTargetStatus: "OVERRIDDEN",
            targetStatus: "OVERRIDDEN",
            overridden: true,
            overrideReason: OVERRIDE_REASON,
          },
        }),
      }),
    })
  })

  it("resolves a durable offline submit by clientExecutionId and audits the canonical execution id", async () => {
    authState.userId = "agent-user"
    authState.role = "member"
    authState.agentId = "agent-1"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    const draft = submitDraft()
    const ready = {
      ...draft,
      status: "READY",
      l1State: "READY",
      version: 2,
      factPointsPreview: new Prisma.Decimal("10"),
      rewardPointsPreview: new Prisma.Decimal("5"),
      differencePointsPreview: new Prisma.Decimal("5"),
      submittedAt: new Date("2026-08-01T10:00:00.000Z"),
      readyAt: new Date("2026-08-01T10:00:00.000Z"),
    }
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockResolvedValue([{
      id: EXECUTION,
      target: { promotionVersionId: "promotion-version-1" },
    }] as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce(ready as never)
    vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue({ value: true } as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await submitExecution(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions/client-execution-offline-0001/submit",
      { operationId: "operation-client-submit-0001", expectedVersion: 1 },
    ), context("client-execution-offline-0001"))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, data: { id: EXECUTION, status: "READY" } })
    expect(prisma.mtmPharmacyPromotionExecution.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        agentId: "agent-1",
        OR: [
          { id: "client-execution-offline-0001" },
          { clientExecutionId: "client-execution-offline-0001" },
        ],
      },
      select: { id: true, target: { select: { promotionVersionId: true } } },
      take: 2,
    })
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ executionId: EXECUTION }),
    })
  })

  it("does not resolve a clientExecutionId outside the authenticated tenant and agent scope", async () => {
    authState.userId = "agent-user"
    authState.role = "member"
    authState.agentId = "agent-1"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockResolvedValue([])

    const response = await submitExecution(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions/foreign-client-execution/submit",
      { operationId: "operation-foreign-submit-0001", expectedVersion: 1 },
    ), context("foreign-client-execution"))

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_EXECUTION_NOT_FOUND" })
    expect(prisma.mtmPharmacyPromotionExecution.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        agentId: "agent-1",
        OR: [
          { id: "foreign-client-execution" },
          { clientExecutionId: "foreign-client-execution" },
        ],
      },
      select: { id: true, target: { select: { promotionVersionId: true } } },
      take: 2,
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
  })

  it("fails closed if an overridden row has lost its mandatory audit reason", async () => {
    authState.userId = "agent-user"
    authState.role = "member"
    authState.agentId = "agent-1"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    const draft = submitDraft()
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockResolvedValue([{
      id: EXECUTION,
      target: { promotionVersionId: "promotion-version-1" },
    }] as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue({
      ...draft,
      target: { ...draft.target, eligibilityOverrideReason: null },
    } as never)
    vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue({ value: true } as never)

    const response = await submitExecution(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/submit`,
      { operationId: "operation-submit-override-0001", expectedVersion: 1 },
    ), context(EXECUTION))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_TARGET_OVERRIDE_AUDIT_MISSING" })
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
  })

  it("rejects a canonical/client execution reference collision without mutating either row", async () => {
    authState.userId = "agent-user"
    authState.role = "member"
    authState.agentId = "agent-1"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockResolvedValue([
      { id: "execution-a", target: { promotionVersionId: "promotion-version-1" } },
      { id: "execution-b", target: { promotionVersionId: "promotion-version-1" } },
    ] as never)

    const response = await submitExecution(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions/execution-a/submit",
      { operationId: "operation-ambiguous-submit-0001", expectedVersion: 1 },
    ), context("execution-a"))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_EXECUTION_REFERENCE_AMBIGUOUS" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
  })
})
