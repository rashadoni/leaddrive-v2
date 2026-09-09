import { z } from "zod"
import { normalizePharmacyPromotionDecimal18_4 } from "@/lib/mtm/pharmacy-promotion-decimal"

const identifier = z.string().trim().min(1).max(128)
const clientIdentifier = z.string().trim().min(8).max(128)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i)
const observedAtFutureToleranceMs = 5 * 60_000

export const PharmacyPromotionObservedAtSchema = z.string()
  .datetime({ offset: true })
  .superRefine((value, context) => {
    if (new Date(value).getTime() > Date.now() + observedAtFutureToleranceMs) {
      context.addIssue({
        code: "custom",
        message: "Source observation time cannot be more than five minutes in the future",
      })
    }
  })

const decimalInput = z.union([z.number(), z.string()]).transform((value, context) => {
  const normalized = normalizePharmacyPromotionDecimal18_4(value)
  if (normalized === null) {
    context.addIssue({
      code: "custom",
      message: "Expected a non-negative DECIMAL(18,4) value",
    })
    return z.NEVER
  }
  return normalized
})

export const PharmacyPromotionTypeCreateSchema = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  nameRu: z.string().trim().min(1).max(160),
  nameAz: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().min(1).max(160),
}).strict()

export const PharmacyPromotionRootCreateSchema = z.object({
  code: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
}).strict()

export const PharmacyPromotionFormulaCreateSchema = z.object({
  code: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  version: z.number().int().positive(),
  nameRu: z.string().trim().min(1).max(200),
  nameAz: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  definition: z.unknown(),
  sourceSystem: z.string().trim().min(1).max(120),
  sourceReference: z.string().trim().min(1).max(500),
  observedAt: PharmacyPromotionObservedAtSchema,
}).strict()

export const PharmacyPromotionApprovalPolicyCreateSchema = z.object({
  code: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  definition: z.unknown(),
  sourceSystem: z.string().trim().min(1).max(120),
  sourceReference: z.string().trim().min(1).max(500),
  observedAt: PharmacyPromotionObservedAtSchema,
}).strict()

export const PharmacyPromotionSignSchema = z.object({
  expectedDefinitionHash: sha256,
  approvalReference: z.string().trim().min(3).max(500),
}).strict()

export const PharmacyPromotionVersionCreateSchema = z.object({
  revision: z.number().int().positive(),
  typeId: identifier,
  nameRu: z.string().trim().min(1).max(200),
  nameAz: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  descriptionRu: z.string().trim().max(4_000).nullable().optional(),
  descriptionAz: z.string().trim().max(4_000).nullable().optional(),
  descriptionEn: z.string().trim().max(4_000).nullable().optional(),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  timezone: z.string().trim().min(1).max(100),
  formulaId: identifier,
  approvalPolicyId: identifier,
  eligibilityDefinition: z.unknown(),
  eligibilityApprovalReference: z.string().trim().min(3).max(500).nullable().optional(),
  sourceSystem: z.string().trim().min(1).max(120),
  sourceReference: z.string().trim().min(1).max(500),
  observedAt: PharmacyPromotionObservedAtSchema,
}).strict().superRefine((value, context) => {
  if (value.endsOn < value.startsOn) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "End date must not be before start date" })
  }
})

export const PharmacyPromotionVersionPublishSchema = z.object({
  expectedDefinitionHash: sha256,
  approvalReference: z.string().trim().min(3).max(500),
  eligibilityApprovalReference: z.string().trim().min(3).max(500),
}).strict()

export const PharmacyPromotionTargetCreateSchema = z.object({
  promotionVersionId: identifier,
  customerId: identifier,
  assignedAgentId: identifier,
  contactId: identifier.nullable().optional(),
  planQuantity: decimalInput,
  unit: z.string().trim().min(1).max(40),
  sourceSystem: z.string().trim().min(1).max(120),
  sourceReference: z.string().trim().min(1).max(500),
  observedAt: PharmacyPromotionObservedAtSchema,
  operationId: clientIdentifier,
}).strict()

export const PharmacyPromotionEligibilityOverrideSchema = z.object({
  operationId: clientIdentifier,
  expectedEligibilityStatus: z.enum(["PENDING", "INELIGIBLE"]),
  reason: z.string().trim().min(3).max(2_000),
}).strict()

export const PharmacyPromotionExecutionDraftSchema = z.object({
  targetId: identifier,
  supersedesExecutionId: identifier.optional(),
  clientExecutionId: clientIdentifier,
  operationId: clientIdentifier,
  visitId: identifier.nullable().optional(),
  factQuantity: decimalInput,
  unit: z.string().trim().min(1).max(40),
  expectedVersion: z.literal(0).optional(),
  clientOccurredAt: z.string().datetime({ offset: true }).optional(),
}).strict()

export const PharmacyPromotionExecutionSubmitSchema = z.object({
  operationId: clientIdentifier,
  expectedVersion: z.number().int().positive(),
}).strict()

export const PharmacyPromotionEvidenceMetadataSchema = z.object({
  clientEvidenceId: clientIdentifier,
  clientDocumentId: clientIdentifier,
  operationId: clientIdentifier,
  // Required so an offline retry has a stable canonical request hash. A
  // server-generated `now` would turn a lost-response retry into a conflict.
  capturedAt: z.string().datetime({ offset: true }),
  checksumSha256: sha256,
  title: z.string().trim().max(200).optional(),
}).strict()

const PharmacyPromotionReviewBaseSchema = z.object({
  expectedVersion: z.number().int().positive(),
  level: z.enum(["L1", "L2"]),
  decision: z.enum(["APPROVED", "REJECTED", "RETURNED"]),
  reason: z.string().trim().max(2_000).nullable().optional(),
}).strict()

function validateReviewReason(
  value: z.infer<typeof PharmacyPromotionReviewBaseSchema>,
  context: z.RefinementCtx,
) {
  if ((value.decision === "REJECTED" || value.decision === "RETURNED") && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required" })
  }
}

export const PharmacyPromotionReviewPreviewSchema = PharmacyPromotionReviewBaseSchema
  .superRefine(validateReviewReason)

export const PharmacyPromotionReviewSchema = PharmacyPromotionReviewBaseSchema.extend({
  operationId: clientIdentifier,
  idempotencyKey: clientIdentifier,
  previewHash: sha256,
}).superRefine(validateReviewReason)

const PharmacyPromotionBulkReviewBaseSchema = z.object({
  executionIds: z.array(identifier).min(1).max(100),
  level: z.enum(["L1", "L2"]),
  decision: z.enum(["APPROVED", "REJECTED", "RETURNED"]),
  reason: z.string().trim().max(2_000).nullable().optional(),
}).strict()

function validateBulkReviewInput(
  value: z.infer<typeof PharmacyPromotionBulkReviewBaseSchema>,
  context: z.RefinementCtx,
) {
  if (new Set(value.executionIds).size !== value.executionIds.length) {
    context.addIssue({ code: "custom", path: ["executionIds"], message: "Duplicate execution IDs are not allowed" })
  }
  if ((value.decision === "REJECTED" || value.decision === "RETURNED") && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required" })
  }
}

export const PharmacyPromotionBulkReviewPreviewSchema = PharmacyPromotionBulkReviewBaseSchema
  .superRefine(validateBulkReviewInput)

export const PharmacyPromotionBulkReviewApplySchema = PharmacyPromotionBulkReviewBaseSchema.extend({
  operationId: clientIdentifier,
  idempotencyKey: clientIdentifier,
  previewHash: sha256,
  selectionHash: sha256,
  versions: z.array(z.object({
    executionId: identifier,
    expectedVersion: z.number().int().positive(),
  }).strict()).min(1).max(100),
}).superRefine((value, context) => {
  validateBulkReviewInput(value, context)
  const versionIds = new Set(value.versions.map((entry) => entry.executionId))
  if (
    versionIds.size !== value.versions.length
    || versionIds.size !== value.executionIds.length
    || value.executionIds.some((id) => !versionIds.has(id))
  ) {
    context.addIssue({ code: "custom", path: ["versions"], message: "Every selected execution needs one expected version" })
  }
})

export const PharmacyPromotionAdjustmentSchema = z.object({
  operationId: clientIdentifier,
  idempotencyKey: clientIdentifier,
  executionId: identifier,
  expectedVersion: z.number().int().positive(),
  delta: z.union([
    z.number().finite(),
    z.string().trim().regex(/^-?\d+(?:\.\d{1,4})?$/),
  ]),
  reason: z.string().trim().min(3).max(2_000),
  formulaId: identifier,
  previewHash: sha256,
}).strict()

export type PharmacyPromotionExecutionDraftInput = z.infer<typeof PharmacyPromotionExecutionDraftSchema>
export type PharmacyPromotionReviewInput = z.infer<typeof PharmacyPromotionReviewSchema>
