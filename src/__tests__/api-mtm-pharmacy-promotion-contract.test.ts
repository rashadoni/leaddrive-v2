import { Prisma } from "@prisma/client"
import { describe, expect, it } from "vitest"
import {
  PHARMACY_PROMOTION_BLOCKERS,
  PharmacyPromotionFormulaDefinitionSchema,
  calculatePharmacyPromotionPoints,
  canReviewPharmacyPromotion,
  canonicalPharmacyPromotionJson,
  evaluatePharmacyPromotionEligibility,
  nextPharmacyPromotionReviewState,
  pharmacyPromotionConfigurationState,
  pharmacyPromotionExecutionReadiness,
  pharmacyPromotionFilterHash,
  pharmacyPromotionFilterValidationError,
  pharmacyPromotionFiltersFromSearchParams,
  pharmacyPromotionHash,
  pharmacyPromotionSourceFreshness,
  reconcilePharmacyPromotionLedger,
  validateSignedDefinition,
  type PharmacyPromotionApprovalPolicyDefinition,
  type PharmacyPromotionEligibilityDefinition,
  type PharmacyPromotionFormulaDefinition,
  type PharmacyPromotionSignedDefinition,
} from "@/lib/mtm/pharmacy-promotion"
import {
  PharmacyPromotionApprovalPolicyCreateSchema,
  PharmacyPromotionExecutionDraftSchema,
  PharmacyPromotionFormulaCreateSchema,
  PharmacyPromotionTargetCreateSchema,
  PharmacyPromotionVersionCreateSchema,
} from "@/lib/mtm/pharmacy-promotion-validators"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { normalizePharmacyPromotionHumanDecimal18_4 } from "@/lib/mtm/pharmacy-promotion-decimal"

const FORMULA: PharmacyPromotionFormulaDefinition = {
  schemaVersion: 1,
  kind: "LINEAR_V1",
  factPointsPerUnit: "1.25",
  rewardPointsPerUnit: "0.25",
  scale: 2,
  rounding: "HALF_UP",
  sourceFreshnessMinutes: 60,
}

const ELIGIBILITY: PharmacyPromotionEligibilityDefinition = {
  schemaVersion: 1,
  customerObjectTypes: ["PHARMACY"],
  requireActiveCustomer: true,
  requireCompletedVisit: true,
  minimumEvidenceCount: 2,
}

const POLICY: PharmacyPromotionApprovalPolicyDefinition = {
  schemaVersion: 1,
  levels: ["L1", "L2"],
  l1Roles: ["MANAGER", "SUPERVISOR", "ADMIN"],
  l2Roles: ["MANAGER", "ADMIN"],
  preventSelfApproval: true,
  requireDistinctReviewers: true,
  reasonRequiredFor: ["REJECTED", "RETURNED"],
}

function signedDefinition<T>(
  definition: T,
  overrides: Partial<PharmacyPromotionSignedDefinition<T>> = {},
): PharmacyPromotionSignedDefinition<T> {
  return {
    status: "ACTIVE",
    definition,
    definitionHash: pharmacyPromotionHash(definition),
    signedAt: new Date("2026-08-01T08:00:00.000Z"),
    approvalReference: "SWISSMED-APPROVAL-2026-08-01",
    version: "2026.1",
    ...overrides,
  }
}

const manager = (
  agentId: string,
  scopedAgentIds: string[] | null,
): MtmRouteActor => ({ agentId, role: "MANAGER", scopedAgentIds })

describe("SWM-09 canonical definitions and signed configuration", () => {
  it("hashes semantically identical nested values independently of object key order", () => {
    const left = {
      version: "2026.1",
      formula: { reward: new Prisma.Decimal("0.2500"), fact: 1.25, ignored: undefined },
      signedAt: new Date("2026-08-01T08:00:00.000Z"),
      eligibility: ["PHARMACY", { active: true }],
    }
    const right = {
      eligibility: ["PHARMACY", { active: true }],
      signedAt: "2026-08-01T08:00:00.000Z",
      formula: { fact: 1.25, reward: "0.25" },
      version: "2026.1",
    }

    expect(canonicalPharmacyPromotionJson(left)).toBe(canonicalPharmacyPromotionJson(right))
    expect(pharmacyPromotionHash(left)).toBe(pharmacyPromotionHash(right))
    expect(pharmacyPromotionHash(left)).toMatch(/^[a-f0-9]{64}$/)
  })

  it("accepts only an active, signed, referenced formula whose content matches its hash", () => {
    expect(validateSignedDefinition(
      signedDefinition(FORMULA),
      PharmacyPromotionFormulaDefinitionSchema,
      PHARMACY_PROMOTION_BLOCKERS.FORMULA_NOT_SIGNED,
    )).toEqual({ ok: true, definition: FORMULA })

    const invalidDefinitions: Array<PharmacyPromotionSignedDefinition<PharmacyPromotionFormulaDefinition> | null> = [
      null,
      signedDefinition(FORMULA, { status: "DRAFT" }),
      signedDefinition(FORMULA, { signedAt: null }),
      signedDefinition(FORMULA, { approvalReference: "   " }),
      signedDefinition(FORMULA, { definitionHash: "0".repeat(64) }),
      signedDefinition({ ...FORMULA, scale: 5 } as PharmacyPromotionFormulaDefinition),
    ]

    for (const definition of invalidDefinitions) {
      expect(validateSignedDefinition(
        definition,
        PharmacyPromotionFormulaDefinitionSchema,
        PHARMACY_PROMOTION_BLOCKERS.FORMULA_NOT_SIGNED,
      )).toEqual({ ok: false, blocker: PHARMACY_PROMOTION_BLOCKERS.FORMULA_NOT_SIGNED })
    }
  })

  it.each([
    ["factPointsPerUnit", "-0.0001"],
    ["rewardPointsPerUnit", "100000000000000"],
  ] as const)("rejects a signed formula with an unsafe %s", (field, coefficient) => {
    const definition = { ...FORMULA, [field]: coefficient }

    expect(PharmacyPromotionFormulaDefinitionSchema.safeParse(definition).success).toBe(false)
    expect(validateSignedDefinition(
      signedDefinition(definition),
      PharmacyPromotionFormulaDefinitionSchema,
      PHARMACY_PROMOTION_BLOCKERS.FORMULA_NOT_SIGNED,
    )).toEqual({ ok: false, blocker: PHARMACY_PROMOTION_BLOCKERS.FORMULA_NOT_SIGNED })
  })

  it("reports every missing governance input and keeps posting disabled fail-closed", () => {
    const blocked = pharmacyPromotionConfigurationState({
      formula: null,
      approvalPolicy: null,
      eligibilityDefinition: ELIGIBILITY,
      eligibilityDefinitionHash: "invalid",
      eligibilityApprovedAt: null,
      eligibilityApprovalReference: null,
      postingEnabled: false,
    })

    expect(blocked).toMatchObject({ ready: false })
    if (blocked.ready) throw new Error("expected blocked configuration")
    expect(blocked.blockers).toHaveLength(4)
    expect(blocked.blockers).toEqual(expect.arrayContaining([
      PHARMACY_PROMOTION_BLOCKERS.FORMULA_NOT_SIGNED,
      PHARMACY_PROMOTION_BLOCKERS.POLICY_NOT_SIGNED,
      PHARMACY_PROMOTION_BLOCKERS.ELIGIBILITY_NOT_CONFIRMED,
      PHARMACY_PROMOTION_BLOCKERS.POSTING_DISABLED,
    ]))
  })

  it("opens the posting gate only when formula, policy and eligibility are all signed", () => {
    const input = {
      formula: signedDefinition(FORMULA),
      approvalPolicy: signedDefinition(POLICY),
      eligibilityDefinition: ELIGIBILITY,
      eligibilityDefinitionHash: pharmacyPromotionHash(ELIGIBILITY),
      eligibilityApprovedAt: new Date("2026-08-01T08:10:00.000Z"),
      eligibilityApprovalReference: "SWISSMED-ELIGIBILITY-2026-08-01",
      postingEnabled: true,
    }

    expect(pharmacyPromotionConfigurationState(input)).toEqual({ ready: true })
    expect(pharmacyPromotionConfigurationState({ ...input, postingEnabled: false })).toEqual({
      ready: false,
      blockers: [PHARMACY_PROMOTION_BLOCKERS.POSTING_DISABLED],
    })
  })

  it("keeps execution posting blocked until configuration, source freshness and evidence all pass", () => {
    const configuration = pharmacyPromotionConfigurationState({
      formula: signedDefinition(FORMULA),
      approvalPolicy: signedDefinition(POLICY),
      eligibilityDefinition: ELIGIBILITY,
      eligibilityDefinitionHash: pharmacyPromotionHash(ELIGIBILITY),
      eligibilityApprovedAt: new Date("2026-08-01T08:10:00.000Z"),
      eligibilityApprovalReference: "SWISSMED-ELIGIBILITY-2026-08-01",
      postingEnabled: true,
    })

    expect(pharmacyPromotionExecutionReadiness({
      configuration,
      source: { state: "FRESH", ageMinutes: 10 },
      evidenceCount: 2,
      minimumEvidenceCount: 2,
    })).toEqual({ ready: true })

    expect(pharmacyPromotionExecutionReadiness({
      configuration,
      source: { state: "STALE", ageMinutes: 61 },
      evidenceCount: 1,
      minimumEvidenceCount: 2,
    })).toEqual({
      ready: false,
      blockers: [
        PHARMACY_PROMOTION_BLOCKERS.SOURCE_STALE,
        PHARMACY_PROMOTION_BLOCKERS.EVIDENCE_INCOMPLETE,
      ],
    })
  })
})

describe("SWM-09 deterministic calculation, eligibility and freshness", () => {
  it("canonicalizes the RU/AZ phone decimal comma without accepting grouped input", () => {
    expect(normalizePharmacyPromotionHumanDecimal18_4("1,5")).toBe("1.5")
    expect(normalizePharmacyPromotionHumanDecimal18_4("001,5000")).toBe("1.5")
    expect(normalizePharmacyPromotionHumanDecimal18_4("1,234,5")).toBeNull()
  })

  it.each([
    ["HALF_UP", "1.01", "0.01", "1.00"],
    ["HALF_EVEN", "1.00", "0.00", "1.00"],
    ["DOWN", "1.00", "0.00", "1.00"],
  ] as const)("applies %s rounding with exact Decimal output", (rounding, factPoints, rewardPoints, difference) => {
    const definition: PharmacyPromotionFormulaDefinition = {
      ...FORMULA,
      factPointsPerUnit: "1.005",
      rewardPointsPerUnit: "0.005",
      rounding,
    }

    const first = calculatePharmacyPromotionPoints(definition, new Prisma.Decimal(1))
    const replay = calculatePharmacyPromotionPoints(definition, "1.0")

    expect(first).toMatchObject({
      status: "CALCULATED",
      factQuantity: "1",
      factPoints,
      rewardPoints,
      difference,
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      calculationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(replay).toEqual(first)
  })

  it.each(["-0.0001", "Infinity", "1.00001", "100000000000000"])(
    "rejects unsafe fact quantity %s before calculation",
    (factQuantity) => {
      expect(() => calculatePharmacyPromotionPoints(FORMULA, factQuantity))
        .toThrow("MTM_PHARMACY_FACT_QUANTITY_INVALID")
    },
  )

  it("accepts the DECIMAL(18,4) boundary and rejects an unrepresentable calculated result", () => {
    const boundaryFormula: PharmacyPromotionFormulaDefinition = {
      ...FORMULA,
      factPointsPerUnit: "1",
      rewardPointsPerUnit: "0",
      scale: 4,
    }
    expect(calculatePharmacyPromotionPoints(
      boundaryFormula,
      "99999999999999.9999",
    )).toMatchObject({
      factQuantity: "99999999999999.9999",
      factPoints: "99999999999999.9999",
      rewardPoints: "0.0000",
      difference: "99999999999999.9999",
    })

    expect(() => calculatePharmacyPromotionPoints(
      { ...boundaryFormula, factPointsPerUnit: "1.0001" },
      "99999999999999.9999",
    )).toThrow("MTM_PHARMACY_CALCULATION_OUT_OF_RANGE")
  })

  it("canonicalizes numeric and string draft quantities before hashing or persistence", () => {
    const draft = {
      targetId: "target-12345678",
      clientExecutionId: "execution-12345678",
      operationId: "operation-12345678",
      factQuantity: "0012.5000" as string | number,
      unit: "packs",
    }
    const fromString = PharmacyPromotionExecutionDraftSchema.safeParse(draft)
    const fromNumber = PharmacyPromotionExecutionDraftSchema.safeParse({ ...draft, factQuantity: 12.5 })

    expect(fromString.success && fromString.data.factQuantity).toBe("12.5")
    expect(fromNumber.success && fromNumber.data.factQuantity).toBe("12.5")
    expect(PharmacyPromotionExecutionDraftSchema.safeParse({
      ...draft,
      factQuantity: 12.50001,
    }).success).toBe(false)
    expect(PharmacyPromotionExecutionDraftSchema.safeParse({
      ...draft,
      factQuantity: "100000000000000",
    }).success).toBe(false)
    expect(PharmacyPromotionExecutionDraftSchema.safeParse({
      ...draft,
      expectedVersion: 0,
    }).success).toBe(true)
    expect(PharmacyPromotionExecutionDraftSchema.safeParse({
      ...draft,
      expectedVersion: 1,
    }).success).toBe(false)
  })

  it("rejects future source observations consistently across administrative schemas", () => {
    const observedAt = new Date(Date.now() + 5 * 60_000 + 10_000).toISOString()
    const source = {
      sourceSystem: "SWISSMED_GOVERNANCE",
      sourceReference: "SM-SOURCE-001",
      observedAt,
    }
    const results = [
      PharmacyPromotionFormulaCreateSchema.safeParse({
        code: "FORMULA_1",
        version: 1,
        nameRu: "Формула",
        nameAz: "Formula",
        nameEn: "Formula",
        definition: FORMULA,
        ...source,
      }),
      PharmacyPromotionApprovalPolicyCreateSchema.safeParse({
        code: "POLICY_1",
        version: 1,
        name: "Approval policy",
        definition: POLICY,
        ...source,
      }),
      PharmacyPromotionVersionCreateSchema.safeParse({
        revision: 1,
        typeId: "type-1",
        nameRu: "Промо",
        nameAz: "Promo",
        nameEn: "Promo",
        startsOn: "2026-08-01",
        endsOn: "2026-08-31",
        timezone: "Asia/Baku",
        formulaId: "formula-1",
        approvalPolicyId: "policy-1",
        eligibilityDefinition: ELIGIBILITY,
        ...source,
      }),
      PharmacyPromotionTargetCreateSchema.safeParse({
        promotionVersionId: "version-1",
        customerId: "customer-1",
        assignedAgentId: "agent-1",
        planQuantity: "10",
        unit: "packs",
        operationId: "operation-target-1",
        ...source,
      }),
    ]

    for (const result of results) {
      expect(result.success).toBe(false)
      if (result.success) continue
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ["observedAt"],
          message: "Source observation time cannot be more than five minutes in the future",
        }),
      ]))
    }
  })

  it("explains every failed eligibility condition and accepts only a complete eligible fact", () => {
    expect(evaluatePharmacyPromotionEligibility(ELIGIBILITY, {
      customerObjectType: "CLINIC",
      customerActive: false,
      visitCompleted: false,
      evidenceCount: 1,
    })).toEqual({
      status: "INELIGIBLE",
      reasons: ["CUSTOMER_TYPE", "CUSTOMER_INACTIVE", "VISIT_INCOMPLETE", "EVIDENCE_INCOMPLETE"],
    })

    expect(evaluatePharmacyPromotionEligibility(ELIGIBILITY, {
      customerObjectType: "PHARMACY",
      customerActive: true,
      visitCompleted: true,
      evidenceCount: 2,
    })).toEqual({ status: "ELIGIBLE" })
  })

  it("treats the configured freshness threshold as inclusive and becomes stale immediately after it", () => {
    const observedAt = new Date("2026-08-01T09:45:00.000Z")

    expect(pharmacyPromotionSourceFreshness({
      observedAt,
      now: new Date("2026-08-01T10:00:00.000Z"),
      thresholdMinutes: 15,
    })).toEqual({ state: "FRESH", ageMinutes: 15 })

    expect(pharmacyPromotionSourceFreshness({
      observedAt,
      now: new Date("2026-08-01T10:00:00.001Z"),
      thresholdMinutes: 15,
    })).toEqual({ state: "STALE", ageMinutes: 15 })
  })

  it("returns UNKNOWN for missing or invalid source observation time", () => {
    expect(pharmacyPromotionSourceFreshness({ observedAt: null, thresholdMinutes: 15 }))
      .toEqual({ state: "UNKNOWN", ageMinutes: null })
    expect(pharmacyPromotionSourceFreshness({ observedAt: "not-a-date", thresholdMinutes: 15 }))
      .toEqual({ state: "UNKNOWN", ageMinutes: null })
  })
})

describe("SWM-09 reviewer RBAC and two-level state machine", () => {
  it("requires the configured role and current server-resolved employee scope", () => {
    expect(canReviewPharmacyPromotion({
      actor: manager("manager-1", ["agent-1"]),
      level: "L1",
      policy: POLICY,
      executionAgentId: "agent-1",
      submittedByAgentId: "agent-1",
      submittedByUserId: "agent-user",
      reviewerUserId: "manager-user",
    })).toEqual({ allowed: true })

    expect(canReviewPharmacyPromotion({
      actor: manager("manager-1", ["agent-2"]),
      level: "L1",
      policy: POLICY,
      executionAgentId: "agent-1",
      submittedByAgentId: "agent-1",
      submittedByUserId: "agent-user",
      reviewerUserId: "manager-user",
    })).toEqual({ allowed: false, code: "MTM_PHARMACY_REVIEW_SCOPE_DENIED" })

    expect(canReviewPharmacyPromotion({
      actor: { agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] },
      level: "L1",
      policy: POLICY,
      executionAgentId: "agent-1",
      submittedByAgentId: "agent-1",
      submittedByUserId: "agent-user",
      reviewerUserId: "agent-user",
    })).toEqual({ allowed: false, code: "MTM_PHARMACY_REVIEW_ROLE_DENIED" })
  })

  it("prevents self-review through either linked agent identity or web user identity", () => {
    expect(canReviewPharmacyPromotion({
      actor: manager("manager-1", ["manager-1"]),
      level: "L1",
      policy: POLICY,
      executionAgentId: "manager-1",
      submittedByAgentId: "manager-1",
      submittedByUserId: "manager-user",
      reviewerUserId: "manager-user",
    })).toEqual({ allowed: false, code: "MTM_PHARMACY_SELF_REVIEW_DENIED" })

    expect(canReviewPharmacyPromotion({
      actor: { agentId: null, role: "ADMIN", scopedAgentIds: null },
      level: "L1",
      policy: POLICY,
      executionAgentId: "agent-1",
      submittedByAgentId: "agent-1",
      submittedByUserId: "admin-user",
      reviewerUserId: "admin-user",
    })).toEqual({ allowed: false, code: "MTM_PHARMACY_SELF_REVIEW_DENIED" })
  })

  it("requires a distinct linked reviewer for L2 when the signed policy says so", () => {
    const base = {
      actor: manager("manager-2", ["agent-1"]),
      level: "L2" as const,
      policy: POLICY,
      executionAgentId: "agent-1",
      submittedByAgentId: "agent-1",
      submittedByUserId: "agent-user",
      reviewerUserId: "manager-2-user",
    }

    expect(canReviewPharmacyPromotion({ ...base, l1ReviewerAgentId: "manager-2" }))
      .toEqual({ allowed: false, code: "MTM_PHARMACY_DISTINCT_REVIEWER_REQUIRED" })
    expect(canReviewPharmacyPromotion({ ...base, l1ReviewerAgentId: "manager-1" }))
      .toEqual({ allowed: true })
  })

  it("also prevents the same unlinked web administrator from performing both review levels", () => {
    expect(canReviewPharmacyPromotion({
      actor: { agentId: null, role: "ADMIN", scopedAgentIds: null },
      level: "L2",
      policy: POLICY,
      executionAgentId: "agent-1",
      submittedByAgentId: "agent-1",
      submittedByUserId: "agent-user",
      reviewerUserId: "admin-reviewer",
      l1ReviewerAgentId: null,
      l1ReviewerUserId: "admin-reviewer",
    })).toEqual({ allowed: false, code: "MTM_PHARMACY_DISTINCT_REVIEWER_REQUIRED" })
  })

  it("moves an approved execution through L1 then L2 and posts only the final ledger award", () => {
    const l1 = nextPharmacyPromotionReviewState({
      status: "READY",
      l1State: "READY",
      l2State: "NOT_READY",
      level: "L1",
      decision: "APPROVED",
    })
    expect(l1).toEqual({
      status: "IN_REVIEW",
      l1State: "APPROVED",
      l2State: "READY",
      postsLedger: false,
    })

    expect(nextPharmacyPromotionReviewState({ ...l1, level: "L2", decision: "APPROVED" })).toEqual({
      status: "APPROVED",
      l1State: "APPROVED",
      l2State: "APPROVED",
      postsLedger: true,
    })
  })

  it.each(["REJECTED", "RETURNED"] as const)("requires an auditable reason for %s", (decision) => {
    expect(() => nextPharmacyPromotionReviewState({
      status: "READY",
      l1State: "READY",
      l2State: "NOT_READY",
      level: "L1",
      decision,
      reason: "   ",
    })).toThrow("MTM_PHARMACY_REVIEW_REASON_REQUIRED")
  })

  it("rejects L2 before a successful L1 decision", () => {
    expect(() => nextPharmacyPromotionReviewState({
      status: "READY",
      l1State: "READY",
      l2State: "NOT_READY",
      level: "L2",
      decision: "APPROVED",
    })).toThrow("MTM_PHARMACY_L2_NOT_READY")
  })

  it("keeps return and reject non-posting while preserving the completed earlier level", () => {
    expect(nextPharmacyPromotionReviewState({
      status: "READY",
      l1State: "READY",
      l2State: "NOT_READY",
      level: "L1",
      decision: "RETURNED",
      reason: "Photo is unreadable",
    })).toEqual({ status: "RETURNED", l1State: "RETURNED", l2State: "NOT_READY", postsLedger: false })

    expect(nextPharmacyPromotionReviewState({
      status: "IN_REVIEW",
      l1State: "APPROVED",
      l2State: "READY",
      level: "L2",
      decision: "REJECTED",
      reason: "Pharmacy is outside the signed campaign",
    })).toEqual({ status: "REJECTED", l1State: "APPROVED", l2State: "REJECTED", postsLedger: false })
  })
})

describe("SWM-09 registry filters and exact ledger totals", () => {
  it("parses the full filter contract and preserves explicit date and amount modes", () => {
    const filters = pharmacyPromotionFiltersFromSearchParams(new URLSearchParams({
      q: "  Central Pharmacy  ",
      departmentId: "department-1",
      employeeId: "agent-1",
      promotionId: "promotion-1",
      promotionType: "sell-out",
      code: "SM-2026-01",
      executionStatus: "READY",
      controlledVisitStatus: "CONFIRMED",
      l1Status: "READY",
      l2Status: "NOT_READY",
      ready: "true",
      dateMode: "CONNECTED_AT",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      amountMode: "FACT_POINTS",
      amountMin: "001.2500",
      amountMax: "100.5000",
      regionId: "region-1",
      localityId: "locality-1",
      territoryId: "territory-1",
      contactId: "contact-1",
      managerId: "manager-1",
      userGroupId: "team-1",
      sort: "factPoints",
      direction: "asc",
      page: "2",
      pageSize: "50",
      columns: "promotion,pharmacy,plan,fact,points",
      density: "comfortable",
      view: "review",
    }))

    expect(filters).toEqual({
      q: "Central Pharmacy",
      departmentId: "department-1",
      employeeId: "agent-1",
      promotionId: "promotion-1",
      promotionType: "sell-out",
      code: "SM-2026-01",
      executionStatus: "READY",
      controlledVisitStatus: "CONFIRMED",
      l1Status: "READY",
      l2Status: "NOT_READY",
      ready: "true",
      dateMode: "CONNECTED_AT",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      amountMode: "FACT_POINTS",
      amountMin: "1.25",
      amountMax: "100.5",
      regionId: "region-1",
      localityId: "locality-1",
      territoryId: "territory-1",
      contactId: "contact-1",
      managerId: "manager-1",
      userGroupId: "team-1",
      sort: "factPoints",
      direction: "asc",
      page: 2,
      pageSize: 50,
      columns: "promotion,pharmacy,plan,fact,points",
      density: "comfortable",
      view: "review",
    })
  })

  it.each(["CREATED_AT", "CONNECTED_AT", "CLOSED_AT"] as const)("retains the date range in %s mode", (dateMode) => {
    const filters = pharmacyPromotionFiltersFromSearchParams(new URLSearchParams({
      dateMode,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    }))
    expect(filters).toMatchObject({ dateMode, dateFrom: "2026-08-01", dateTo: "2026-08-31" })
  })

  it.each(["FACT_POINTS", "REWARD_POINTS", "DIFFERENCE"] as const)("retains exact bounds in %s mode", (amountMode) => {
    const filters = pharmacyPromotionFiltersFromSearchParams(new URLSearchParams({
      amountMode,
      amountMin: "0.0001",
      amountMax: "999.9999",
    }))
    expect(filters).toMatchObject({ amountMode, amountMin: "0.0001", amountMax: "999.9999" })
  })

  it("fails invalid modes and pagination back to a bounded no-filter contract", () => {
    const filters = pharmacyPromotionFiltersFromSearchParams(new URLSearchParams({
      dateMode: "DROP_TABLE",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      amountMode: "BALANCE",
      amountMin: "Infinity",
      amountMax: "100",
      page: "-5",
      pageSize: "1000",
      direction: "sideways",
      density: "tiny",
      view: "unknown",
    }))

    expect(filters).toMatchObject({
      dateMode: "NONE",
      dateFrom: "",
      dateTo: "",
      amountMode: "NONE",
      amountMin: "",
      amountMax: "",
      page: 1,
      pageSize: 25,
      direction: "desc",
      density: "comfortable",
      view: "registry",
    })
  })

  it("keeps the comfortable UI default and restores an explicit compact saved view", () => {
    expect(pharmacyPromotionFiltersFromSearchParams(new URLSearchParams()).density).toBe("comfortable")
    expect(pharmacyPromotionFiltersFromSearchParams(new URLSearchParams({ density: "compact" })).density).toBe("compact")
  })

  it("rejects impossible calendar dates before timezone conversion", () => {
    const filters = pharmacyPromotionFiltersFromSearchParams(new URLSearchParams({
      dateMode: "CREATED_AT",
      dateFrom: "2026-02-31",
      dateTo: "2026-03-10",
    }))

    expect(pharmacyPromotionFilterValidationError(filters)).toEqual({
      field: "dateFrom",
      code: "MTM_PHARMACY_FILTER_INVALID",
    })
  })

  it("keeps a filter snapshot stable across page navigation but changes it for business filters", () => {
    const first = pharmacyPromotionFiltersFromSearchParams(new URLSearchParams({ employeeId: "agent-1", page: "1" }))
    const secondPage = pharmacyPromotionFiltersFromSearchParams(new URLSearchParams({ employeeId: "agent-1", page: "2" }))
    const anotherAgent = pharmacyPromotionFiltersFromSearchParams(new URLSearchParams({ employeeId: "agent-2", page: "1" }))

    expect(pharmacyPromotionFilterHash(first)).toBe(pharmacyPromotionFilterHash(secondPage))
    expect(pharmacyPromotionFilterHash(first)).not.toBe(pharmacyPromotionFilterHash(anotherAgent))
  })

  it("reconciles signed Decimal ledger entries without binary floating-point drift", () => {
    expect(reconcilePharmacyPromotionLedger([
      { delta: "0.1" },
      { delta: new Prisma.Decimal("0.2") },
      { delta: "-0.05" },
    ])).toBe("0.2500")

    expect(reconcilePharmacyPromotionLedger([
      { delta: "12345678901234.1234" },
      { delta: "0.8766" },
      { delta: "-10000000000000.0000" },
    ])).toBe("2345678901235.0000")
  })
})
