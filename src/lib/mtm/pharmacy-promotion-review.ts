import { Prisma } from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  PharmacyPromotionApprovalPolicyDefinitionSchema,
  PharmacyPromotionFormulaDefinitionSchema,
  calculatePharmacyPromotionPoints,
  canReviewPharmacyPromotion,
  nextPharmacyPromotionReviewState,
  pharmacyPromotionHash,
  pharmacyPromotionSourceFreshness,
  type PharmacyPromotionReviewDecision,
  type PharmacyPromotionReviewLevel,
} from "@/lib/mtm/pharmacy-promotion"

export type PharmacyPromotionReviewExecution = {
  id: string
  version: number
  status: string
  l1State: string
  l2State: string
  agentId: string
  submittedByAgentId: string | null
  submittedByUserId: string | null
  actualQuantity: Prisma.Decimal | string | number
  formulaId: string
  formulaVersion: number
  formulaHash: string
  approvalPolicyId: string
  approvalPolicyVersion: number
  approvalPolicyHash: string
  factPointsPreview: Prisma.Decimal | string | number | null
  rewardPointsPreview: Prisma.Decimal | string | number | null
  differencePointsPreview: Prisma.Decimal | string | number | null
  calculationInput: unknown
  calculationOutput: unknown
  sourceObservedAt: Date | string
  sourceReceivedAt: Date | string
  readyAt: Date | string | null
  formula: {
    id: string
    status: string
    version: number
    definition: unknown
    definitionHash: string
    approvalReference: string | null
    signedAt: Date | string | null
  }
  approvalPolicy: {
    id: string
    status: string
    version: number
    definition: unknown
    definitionHash: string
    approvalReference: string | null
    signedAt: Date | string | null
    allowSelfApproval: boolean
    requireDistinctReviewers: boolean
    requireRejectReason: boolean
    requireReturnReason: boolean
  }
  reviews: Array<{
    level: string
    decision: string
    reviewerAgentId: string | null
    reviewerUserId: string | null
  }>
}

export type PharmacyPromotionReviewParameters = {
  expectedVersion: number
  level: PharmacyPromotionReviewLevel
  decision: PharmacyPromotionReviewDecision
  reason?: string | null
}

function exactDecimal(value: Prisma.Decimal | string | number | null): string | null {
  return value == null ? null : new Prisma.Decimal(value).toFixed(4)
}

export function preparePharmacyPromotionReview(input: {
  execution: PharmacyPromotionReviewExecution
  actor: MtmRouteActor
  reviewerUserId: string
  parameters: PharmacyPromotionReviewParameters
  postingEnabled: boolean
}) {
  const { execution, actor, reviewerUserId, parameters } = input
  if (execution.version !== parameters.expectedVersion) throw new Error("MTM_PHARMACY_EXECUTION_VERSION_CONFLICT")
  if (!input.postingEnabled) throw new Error("MTM_PHARMACY_POSTING_DISABLED")
  const formula = PharmacyPromotionFormulaDefinitionSchema.safeParse(execution.formula.definition)
  const policy = PharmacyPromotionApprovalPolicyDefinitionSchema.safeParse(execution.approvalPolicy.definition)
  if (
    !formula.success
    || !policy.success
    || !execution.formula.signedAt
    || !execution.formula.approvalReference
    || !execution.approvalPolicy.signedAt
    || !execution.approvalPolicy.approvalReference
    || !["ACTIVE", "RETIRED"].includes(execution.formula.status)
    || !["ACTIVE", "RETIRED"].includes(execution.approvalPolicy.status)
    || execution.formula.definitionHash !== pharmacyPromotionHash(execution.formula.definition)
    || execution.approvalPolicy.definitionHash !== pharmacyPromotionHash(execution.approvalPolicy.definition)
    || execution.formulaHash !== execution.formula.definitionHash
    || execution.approvalPolicyHash !== execution.approvalPolicy.definitionHash
    || execution.formulaId !== execution.formula.id
    || execution.formulaVersion !== execution.formula.version
    || execution.approvalPolicyId !== execution.approvalPolicy.id
    || execution.approvalPolicyVersion !== execution.approvalPolicy.version
  ) {
    throw new Error("MTM_PHARMACY_CONFIGURATION_NOT_SIGNED")
  }
  if (
    execution.approvalPolicy.allowSelfApproval === policy.data.preventSelfApproval
    || execution.approvalPolicy.requireDistinctReviewers !== policy.data.requireDistinctReviewers
    || execution.approvalPolicy.requireRejectReason !== policy.data.reasonRequiredFor.includes("REJECTED")
    || execution.approvalPolicy.requireReturnReason !== policy.data.reasonRequiredFor.includes("RETURNED")
  ) {
    throw new Error("MTM_PHARMACY_POLICY_PROJECTION_MISMATCH")
  }
  const l1 = execution.reviews.find((review) => review.level === "L1" && review.decision === "APPROVED")
  const authorization = canReviewPharmacyPromotion({
    actor,
    level: parameters.level,
    policy: policy.data,
    executionAgentId: execution.agentId,
    submittedByAgentId: execution.submittedByAgentId,
    submittedByUserId: execution.submittedByUserId,
    reviewerUserId,
    l1ReviewerAgentId: l1?.reviewerAgentId,
    l1ReviewerUserId: l1?.reviewerUserId,
  })
  if (!authorization.allowed) throw new Error(authorization.code)
  const nextState = nextPharmacyPromotionReviewState({
    status: execution.status,
    l1State: execution.l1State,
    l2State: execution.l2State,
    level: parameters.level,
    decision: parameters.decision,
    reason: parameters.reason,
  })
  const freshness = pharmacyPromotionSourceFreshness({
    observedAt: execution.sourceObservedAt,
    receivedAt: execution.sourceReceivedAt,
    now: execution.readyAt ? new Date(execution.readyAt) : new Date(),
    thresholdMinutes: formula.data.sourceFreshnessMinutes,
  })
  if (freshness.state !== "FRESH") throw new Error("MTM_PHARMACY_SOURCE_STALE")

  const calculation = calculatePharmacyPromotionPoints(formula.data, execution.actualQuantity)
  if (
    exactDecimal(execution.factPointsPreview) !== new Prisma.Decimal(calculation.factPoints).toFixed(4)
    || exactDecimal(execution.rewardPointsPreview) !== new Prisma.Decimal(calculation.rewardPoints).toFixed(4)
    || exactDecimal(execution.differencePointsPreview) !== new Prisma.Decimal(calculation.difference).toFixed(4)
  ) {
    throw new Error("MTM_PHARMACY_CALCULATION_CHANGED")
  }
  const preview = {
    executionId: execution.id,
    expectedVersion: parameters.expectedVersion,
    level: parameters.level,
    decision: parameters.decision,
    reason: parameters.reason?.trim() || null,
    nextState,
    formula: {
      id: execution.formulaId,
      version: execution.formulaVersion,
      hash: execution.formulaHash,
    },
    approvalPolicy: {
      id: execution.approvalPolicyId,
      version: execution.approvalPolicyVersion,
      hash: execution.approvalPolicyHash,
    },
    calculation: {
      inputHash: calculation.inputHash,
      calculationHash: calculation.calculationHash,
      factPoints: calculation.factPoints,
      rewardPoints: calculation.rewardPoints,
      difference: calculation.difference,
    },
    ledgerDelta: nextState.postsLedger ? [
      { bucket: "FACT_POINTS", delta: calculation.factPoints },
      { bucket: "REWARD_POINTS", delta: calculation.rewardPoints },
    ] : [],
    freshness,
  }
  return { preview, previewHash: pharmacyPromotionHash(preview), policy: policy.data, calculation }
}
