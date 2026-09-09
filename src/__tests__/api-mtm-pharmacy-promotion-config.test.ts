import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authState = vi.hoisted(() => ({ principal: "web" as "web" | "mobile" }))

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-mtm-rls-auth", () => ({
  withMtmRlsAuth: (_module: unknown, _action: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx?: unknown) => handler(req, {
      orgId: "org-1",
      userId: authState.principal === "mobile" ? "mobile-user" : "admin-user",
      role: authState.principal === "mobile" ? "sales" : "admin",
      email: "actor@example.com",
      name: "Actor",
      agentId: authState.principal === "mobile" ? "agent-1" : null,
      principal: authState.principal,
    }, ctx),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

import {
  GET as getFormulas,
  POST as createFormula,
} from "@/app/api/v1/mtm/pharmacy-points-formulas/route"
import { POST as activateFormula } from "@/app/api/v1/mtm/pharmacy-points-formulas/[id]/activate/route"
import {
  GET as getPolicies,
  POST as createPolicy,
} from "@/app/api/v1/mtm/pharmacy-approval-policies/route"
import { POST as activatePolicy } from "@/app/api/v1/mtm/pharmacy-approval-policies/[id]/activate/route"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { prisma } from "@/lib/prisma"

const FORMULA_ID = "formula-1"
const POLICY_ID = "policy-1"
const APPROVAL_REFERENCE = "SWISSMED-APPROVAL-2026-08-01"
const SIGNED_AT = new Date("2026-08-01T12:00:00.000Z")

const FORMULA_DEFINITION = {
  schemaVersion: 1,
  kind: "LINEAR_V1",
  factPointsPerUnit: "1.25",
  rewardPointsPerUnit: "0.25",
  scale: 2,
  rounding: "HALF_UP",
  sourceFreshnessMinutes: 60,
} as const

const POLICY_DEFINITION = {
  schemaVersion: 1,
  levels: ["L1", "L2"],
  l1Roles: ["SUPERVISOR", "MANAGER"],
  l2Roles: ["MANAGER", "ADMIN"],
  preventSelfApproval: true,
  requireDistinctReviewers: true,
  reasonRequiredFor: ["REJECTED"],
} as const

const formulaHash = pharmacyPromotionHash(FORMULA_DEFINITION)
const policyHash = pharmacyPromotionHash(POLICY_DEFINITION)

function formulaCreateRequestHash() {
  return pharmacyPromotionHash({
    code: "PHARMACY_SELL_OUT",
    version: 1,
    nameRu: "Баллы за продажи",
    nameAz: "Satış xalları",
    nameEn: "Sell-out points",
    definition: FORMULA_DEFINITION,
    sourceSystem: "SWISSMED_GOVERNANCE",
    sourceReference: "SM-RULE-2026-001",
    sourceObservedAt: "2026-08-01T09:00:00.000Z",
  })
}

function policyCreateRequestHash() {
  return pharmacyPromotionHash({
    code: "PHARMACY_L1_L2",
    version: 1,
    name: "SwissMed pharmacy L1/L2",
    definition: POLICY_DEFINITION,
    sourceSystem: "SWISSMED_GOVERNANCE",
    sourceReference: "SM-APPROVAL-2026-001",
    sourceObservedAt: "2026-08-01T09:00:00.000Z",
  })
}

function request(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function formulaBody(overrides: Record<string, unknown> = {}) {
  return {
    code: "PHARMACY_SELL_OUT",
    version: 1,
    nameRu: "Баллы за продажи",
    nameAz: "Satış xalları",
    nameEn: "Sell-out points",
    definition: FORMULA_DEFINITION,
    sourceSystem: "SWISSMED_GOVERNANCE",
    sourceReference: "SM-RULE-2026-001",
    observedAt: "2026-08-01T09:00:00.000+00:00",
    ...overrides,
  }
}

function policyBody(overrides: Record<string, unknown> = {}) {
  return {
    code: "PHARMACY_L1_L2",
    version: 1,
    name: "SwissMed pharmacy L1/L2",
    definition: POLICY_DEFINITION,
    sourceSystem: "SWISSMED_GOVERNANCE",
    sourceReference: "SM-APPROVAL-2026-001",
    observedAt: "2026-08-01T09:00:00.000+00:00",
    ...overrides,
  }
}

function draftFormula(overrides: Record<string, unknown> = {}) {
  return {
    id: FORMULA_ID,
    organizationId: "org-1",
    code: "PHARMACY_SELL_OUT",
    version: 1,
    definition: FORMULA_DEFINITION,
    definitionHash: formulaHash,
    approvalReference: null,
    sourceSystem: "SWISSMED_GOVERNANCE",
    sourceReference: "SM-RULE-2026-001",
    sourceObservedAt: new Date("2026-08-01T09:00:00.000Z"),
    status: "DRAFT",
    signedByUserId: null,
    signedAt: null,
    activatedAt: null,
    ...overrides,
  }
}

function activeFormula(overrides: Record<string, unknown> = {}) {
  return draftFormula({
    status: "ACTIVE",
    approvalReference: APPROVAL_REFERENCE,
    signedByUserId: "admin-user",
    signedAt: SIGNED_AT,
    activatedAt: SIGNED_AT,
    ...overrides,
  })
}

function draftPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: POLICY_ID,
    organizationId: "org-1",
    code: "PHARMACY_L1_L2",
    version: 1,
    definition: POLICY_DEFINITION,
    definitionHash: policyHash,
    l1Roles: POLICY_DEFINITION.l1Roles,
    l2Roles: POLICY_DEFINITION.l2Roles,
    l1Scope: { kind: "CURRENT_ACTOR_SCOPE" },
    l2Scope: { kind: "CURRENT_ACTOR_SCOPE" },
    allowSelfApproval: false,
    requireDistinctReviewers: true,
    requireRejectReason: true,
    requireReturnReason: false,
    approvalReference: null,
    sourceSystem: "SWISSMED_GOVERNANCE",
    sourceReference: "SM-APPROVAL-2026-001",
    sourceObservedAt: new Date("2026-08-01T09:00:00.000Z"),
    status: "DRAFT",
    signedByUserId: null,
    signedAt: null,
    activatedAt: null,
    ...overrides,
  }
}

function activePolicy(overrides: Record<string, unknown> = {}) {
  return draftPolicy({
    status: "ACTIVE",
    approvalReference: APPROVAL_REFERENCE,
    signedByUserId: "admin-user",
    signedAt: SIGNED_AT,
    activatedAt: SIGNED_AT,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(SIGNED_AT)
  authState.principal = "web"
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: null,
    role: "ADMIN",
    scopedAgentIds: null,
  })
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
  vi.mocked(prisma.mtmPharmacyPromotionEvent.create).mockResolvedValue({ id: "event-1" } as never)
  vi.mocked(prisma.mtmPharmacyPointsFormula.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmPharmacyApprovalPolicy.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmPharmacyPromotionVersion.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("SWM-09 pharmacy promotion configuration access and tenant scope", () => {
  it("keeps both configuration registries tenant-scoped", async () => {
    vi.mocked(prisma.mtmPharmacyPointsFormula.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmPharmacyApprovalPolicy.findMany).mockResolvedValue([])

    expect((await getFormulas(request("/api/v1/mtm/pharmacy-points-formulas"))).status).toBe(200)
    expect((await getPolicies(request("/api/v1/mtm/pharmacy-approval-policies"))).status).toBe(200)

    expect(prisma.mtmPharmacyPointsFormula.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
    }))
    expect(prisma.mtmPharmacyApprovalPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
    }))
  })

  it("denies mobile configuration before actor resolution or data access", async () => {
    authState.principal = "mobile"

    const formulaResponse = await createFormula(request(
      "/api/v1/mtm/pharmacy-points-formulas",
      "POST",
      formulaBody(),
    ))
    const policyResponse = await getPolicies(request("/api/v1/mtm/pharmacy-approval-policies"))

    expect(formulaResponse.status).toBe(403)
    expect(await formulaResponse.json()).toMatchObject({ code: "MTM_PHARMACY_CONFIG_WEB_ONLY" })
    expect(policyResponse.status).toBe(403)
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPointsFormula.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyApprovalPolicy.findMany).not.toHaveBeenCalled()
  })

  it("denies a non-administrator before parsing or writes", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["manager-1"],
    })

    const response = await createPolicy(request(
      "/api/v1/mtm/pharmacy-approval-policies",
      "POST",
      policyBody(),
    ))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_CONFIG_ADMIN_REQUIRED" })
    expect(prisma.mtmPharmacyApprovalPolicy.create).not.toHaveBeenCalled()
  })

  it("returns 404 for a formula ID that is absent from the authenticated tenant", async () => {
    vi.mocked(prisma.mtmPharmacyPointsFormula.findFirst).mockResolvedValue(null)

    const response = await activateFormula(
      request(`/api/v1/mtm/pharmacy-points-formulas/outside-formula/activate`, "POST", {
        expectedDefinitionHash: formulaHash,
        approvalReference: APPROVAL_REFERENCE,
      }),
      params("outside-formula"),
    )

    expect(response.status).toBe(404)
    expect(prisma.mtmPharmacyPointsFormula.findFirst).toHaveBeenCalledWith({
      where: { id: "outside-formula", organizationId: "org-1" },
    })
    expect(prisma.mtmPharmacyPointsFormula.updateMany).not.toHaveBeenCalled()
  })
})

describe("SWM-09 immutable configuration drafts", () => {
  it("rejects an invalid formula definition without persisting a draft", async () => {
    const response = await createFormula(request(
      "/api/v1/mtm/pharmacy-points-formulas",
      "POST",
      formulaBody({ definition: { ...FORMULA_DEFINITION, scale: 9 } }),
    ))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_FORMULA_DEFINITION_INVALID" })
    expect(prisma.mtmPharmacyPointsFormula.create).not.toHaveBeenCalled()
  })

  it("stores a canonical formula hash, localized names, provenance and DRAFT state", async () => {
    vi.mocked(prisma.mtmPharmacyPointsFormula.create).mockResolvedValue(draftFormula() as never)

    const response = await createFormula(request(
      "/api/v1/mtm/pharmacy-points-formulas",
      "POST",
      formulaBody({
        definition: {
          ...FORMULA_DEFINITION,
          factPointsPerUnit: 1.25,
          rewardPointsPerUnit: 0.25,
        },
      }),
    ))

    expect(response.status).toBe(201)
    expect(prisma.mtmPharmacyPointsFormula.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        version: 1,
        nameRu: "Баллы за продажи",
        nameAz: "Satış xalları",
        nameEn: "Sell-out points",
        definition: FORMULA_DEFINITION,
        definitionHash: formulaHash,
        sourceSystem: "SWISSMED_GOVERNANCE",
        sourceReference: "SM-RULE-2026-001",
        sourceObservedAt: new Date("2026-08-01T09:00:00.000Z"),
        status: "DRAFT",
        createdByUserId: "admin-user",
      }),
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "PHARMACY_POINTS_FORMULA_DRAFT_CREATED" }),
    })
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        formulaId: FORMULA_ID,
        eventType: "POINTS_FORMULA_DRAFT_CREATED",
        toState: "DRAFT",
        actorUserId: "admin-user",
        sourceKey: `points-formula:${FORMULA_ID}:draft-created`,
        requestHash: formulaCreateRequestHash(),
      }),
    })
  })

  it("derives every policy projection from the canonical definition", async () => {
    vi.mocked(prisma.mtmPharmacyApprovalPolicy.create).mockResolvedValue(draftPolicy() as never)

    const response = await createPolicy(request(
      "/api/v1/mtm/pharmacy-approval-policies",
      "POST",
      policyBody(),
    ))

    expect(response.status).toBe(201)
    expect(prisma.mtmPharmacyApprovalPolicy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        definition: POLICY_DEFINITION,
        definitionHash: policyHash,
        l1Roles: POLICY_DEFINITION.l1Roles,
        l2Roles: POLICY_DEFINITION.l2Roles,
        allowSelfApproval: false,
        requireDistinctReviewers: true,
        requireRejectReason: true,
        requireReturnReason: false,
        status: "DRAFT",
      }),
    })
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        approvalPolicyId: POLICY_ID,
        eventType: "APPROVAL_POLICY_DRAFT_CREATED",
        toState: "DRAFT",
        actorUserId: "admin-user",
        sourceKey: `approval-policy:${POLICY_ID}:draft-created`,
        requestHash: policyCreateRequestHash(),
      }),
    })
  })

  it("rejects client-supplied parallel policy projections", async () => {
    const response = await createPolicy(request(
      "/api/v1/mtm/pharmacy-approval-policies",
      "POST",
      policyBody({ allowSelfApproval: true }),
    ))

    expect(response.status).toBe(400)
    expect(prisma.mtmPharmacyApprovalPolicy.create).not.toHaveBeenCalled()
  })
})

describe("SWM-09 signed activation", () => {
  it("rejects an expected formula hash that no longer matches the reviewed draft", async () => {
    vi.mocked(prisma.mtmPharmacyPointsFormula.findFirst).mockResolvedValue(draftFormula() as never)

    const response = await activateFormula(
      request(`/api/v1/mtm/pharmacy-points-formulas/${FORMULA_ID}/activate`, "POST", {
        expectedDefinitionHash: "0".repeat(64),
        approvalReference: APPROVAL_REFERENCE,
      }),
      params(FORMULA_ID),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_FORMULA_HASH_CONFLICT" })
    expect(prisma.mtmPharmacyPointsFormula.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("does not retire a formula pinned by a published promotion version", async () => {
    vi.mocked(prisma.mtmPharmacyPointsFormula.findFirst).mockResolvedValue(draftFormula() as never)
    vi.mocked(prisma.mtmPharmacyPointsFormula.findMany).mockResolvedValue([
      { id: "formula-active" },
    ] as never)
    vi.mocked(prisma.mtmPharmacyPromotionVersion.findFirst).mockResolvedValue({
      id: "promotion-version-published",
    } as never)

    const response = await activateFormula(
      request(`/api/v1/mtm/pharmacy-points-formulas/${FORMULA_ID}/activate`, "POST", {
        expectedDefinitionHash: formulaHash,
        approvalReference: APPROVAL_REFERENCE,
      }),
      params(FORMULA_ID),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_PHARMACY_FORMULA_IN_USE",
      activeFormulaId: "formula-active",
      reason: "PUBLISHED_PROMOTION_VERSION",
    })
    expect(prisma.mtmPharmacyPointsFormula.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("does not retire an approval policy pinned by a non-terminal execution", async () => {
    vi.mocked(prisma.mtmPharmacyApprovalPolicy.findFirst).mockResolvedValue(draftPolicy() as never)
    vi.mocked(prisma.mtmPharmacyApprovalPolicy.findMany).mockResolvedValue([
      { id: "policy-active" },
    ] as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue({
      id: "execution-open",
    } as never)

    const response = await activatePolicy(
      request(`/api/v1/mtm/pharmacy-approval-policies/${POLICY_ID}/activate`, "POST", {
        expectedDefinitionHash: policyHash,
        approvalReference: APPROVAL_REFERENCE,
      }),
      params(POLICY_ID),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_PHARMACY_POLICY_IN_USE",
      activePolicyId: "policy-active",
      reason: "OPEN_EXECUTION",
    })
    expect(prisma.mtmPharmacyApprovalPolicy.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("activates a formula with advisory lock, CAS, coherent signature and in-transaction audit", async () => {
    vi.mocked(prisma.mtmPharmacyPointsFormula.findFirst)
      .mockResolvedValueOnce(draftFormula() as never)
      .mockResolvedValueOnce(activeFormula() as never)
    vi.mocked(prisma.mtmPharmacyPointsFormula.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)

    const response = await activateFormula(
      request(`/api/v1/mtm/pharmacy-points-formulas/${FORMULA_ID}/activate`, "POST", {
        expectedDefinitionHash: formulaHash,
        approvalReference: APPROVAL_REFERENCE,
      }),
      params(FORMULA_ID),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, idempotent: false })
    const lockCall = vi.mocked(prisma.$queryRaw).mock.calls[0]
    expect((lockCall[0] as unknown as readonly string[]).join("?")).toContain("pg_advisory_xact_lock")
    expect(prisma.mtmPharmacyPointsFormula.updateMany).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        id: FORMULA_ID,
        organizationId: "org-1",
        status: "DRAFT",
        definitionHash: formulaHash,
        signedAt: null,
        signedByUserId: null,
      }),
      data: expect.objectContaining({
        status: "ACTIVE",
        approvalReference: APPROVAL_REFERENCE,
        signedByUserId: "admin-user",
        signedAt: SIGNED_AT,
        activatedAt: SIGNED_AT,
      }),
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PHARMACY_POINTS_FORMULA_ACTIVATED",
        newData: expect.objectContaining({
          definitionHash: formulaHash,
          signedByUserId: "admin-user",
          signedAt: SIGNED_AT.toISOString(),
        }),
      }),
    })
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        formulaId: FORMULA_ID,
        eventType: "POINTS_FORMULA_ACTIVATED",
        fromState: "DRAFT",
        toState: "ACTIVE",
        actorUserId: "admin-user",
        sourceKey: `points-formula:${FORMULA_ID}:activated`,
        requestHash: pharmacyPromotionHash({
          formulaId: FORMULA_ID,
          expectedDefinitionHash: formulaHash,
          approvalReference: APPROVAL_REFERENCE,
        }),
      }),
    })
  })

  it("records the replaced formula as a separate normalized retirement event", async () => {
    vi.mocked(prisma.mtmPharmacyPointsFormula.findFirst)
      .mockResolvedValueOnce(draftFormula() as never)
      .mockResolvedValueOnce(activeFormula() as never)
    vi.mocked(prisma.mtmPharmacyPointsFormula.findMany).mockResolvedValue([
      { id: "formula-previous" },
    ] as never)
    vi.mocked(prisma.mtmPharmacyPointsFormula.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)

    const response = await activateFormula(
      request(`/api/v1/mtm/pharmacy-points-formulas/${FORMULA_ID}/activate`, "POST", {
        expectedDefinitionHash: formulaHash,
        approvalReference: APPROVAL_REFERENCE,
      }),
      params(FORMULA_ID),
    )

    expect(response.status).toBe(200)
    expect(vi.mocked(prisma.mtmPharmacyPromotionEvent.create).mock.calls.map((call: unknown[]) => (
      (call[0] as { data: Record<string, unknown> }).data
    ))).toEqual([
      expect.objectContaining({
        formulaId: "formula-previous",
        eventType: "POINTS_FORMULA_RETIRED",
        fromState: "ACTIVE",
        toState: "RETIRED",
        sourceKey: `points-formula:formula-previous:retired-by:${FORMULA_ID}`,
      }),
      expect.objectContaining({
        formulaId: FORMULA_ID,
        eventType: "POINTS_FORMULA_ACTIVATED",
      }),
    ])
  })

  it("replays the exact activation idempotently without another write or audit", async () => {
    vi.mocked(prisma.mtmPharmacyPointsFormula.findFirst).mockResolvedValue(activeFormula() as never)

    const response = await activateFormula(
      request(`/api/v1/mtm/pharmacy-points-formulas/${FORMULA_ID}/activate`, "POST", {
        expectedDefinitionHash: formulaHash,
        approvalReference: APPROVAL_REFERENCE,
      }),
      params(FORMULA_ID),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, idempotent: true })
    expect(prisma.mtmPharmacyPointsFormula.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails closed when an ACTIVE policy has an incoherent signature", async () => {
    vi.mocked(prisma.mtmPharmacyApprovalPolicy.findFirst).mockResolvedValue(
      activePolicy({ signedAt: null }) as never,
    )

    const response = await activatePolicy(
      request(`/api/v1/mtm/pharmacy-approval-policies/${POLICY_ID}/activate`, "POST", {
        expectedDefinitionHash: policyHash,
        approvalReference: APPROVAL_REFERENCE,
      }),
      params(POLICY_ID),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_POLICY_SIGNATURE_INCOHERENT" })
    expect(prisma.mtmPharmacyApprovalPolicy.updateMany).not.toHaveBeenCalled()
  })

  it("activates only a projection-coherent policy and signs all fields atomically", async () => {
    vi.mocked(prisma.mtmPharmacyApprovalPolicy.findFirst)
      .mockResolvedValueOnce(draftPolicy() as never)
      .mockResolvedValueOnce(activePolicy() as never)
    vi.mocked(prisma.mtmPharmacyApprovalPolicy.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)

    const response = await activatePolicy(
      request(`/api/v1/mtm/pharmacy-approval-policies/${POLICY_ID}/activate`, "POST", {
        expectedDefinitionHash: policyHash,
        approvalReference: APPROVAL_REFERENCE,
      }),
      params(POLICY_ID),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, idempotent: false })
    expect(prisma.mtmPharmacyApprovalPolicy.updateMany).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        id: POLICY_ID,
        organizationId: "org-1",
        status: "DRAFT",
        definitionHash: policyHash,
      }),
      data: expect.objectContaining({
        status: "ACTIVE",
        approvalReference: APPROVAL_REFERENCE,
        signedByUserId: "admin-user",
        signedAt: SIGNED_AT,
        activatedAt: SIGNED_AT,
      }),
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "PHARMACY_APPROVAL_POLICY_ACTIVATED" }),
    })
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        approvalPolicyId: POLICY_ID,
        eventType: "APPROVAL_POLICY_ACTIVATED",
        fromState: "DRAFT",
        toState: "ACTIVE",
        actorUserId: "admin-user",
        sourceKey: `approval-policy:${POLICY_ID}:activated`,
        requestHash: pharmacyPromotionHash({
          approvalPolicyId: POLICY_ID,
          expectedDefinitionHash: policyHash,
          approvalReference: APPROVAL_REFERENCE,
        }),
      }),
    })
  })
})
