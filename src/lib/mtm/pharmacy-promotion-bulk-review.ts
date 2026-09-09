import { Prisma } from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { pharmacyPromotionHash, type PharmacyPromotionReviewDecision, type PharmacyPromotionReviewLevel } from "@/lib/mtm/pharmacy-promotion"
import { preparePharmacyPromotionReview } from "@/lib/mtm/pharmacy-promotion-review"

export const pharmacyPromotionBulkReviewInclude = {
  formula: true,
  approvalPolicy: true,
  target: { select: { id: true, customerId: true, contactId: true } },
  reviews: {
    select: { level: true, decision: true, reviewerAgentId: true, reviewerUserId: true },
  },
} satisfies Prisma.MtmPharmacyPromotionExecutionInclude

export type PharmacyPromotionBulkVersion = { executionId: string; expectedVersion: number }

export function preparePharmacyPromotionBulkReview(input: {
  executions: any[]
  actor: MtmRouteActor
  reviewerUserId: string
  level: PharmacyPromotionReviewLevel
  decision: PharmacyPromotionReviewDecision
  reason?: string | null
  postingEnabled: boolean
  versions?: PharmacyPromotionBulkVersion[]
}) {
  const sorted = [...input.executions].sort((left, right) => left.id.localeCompare(right.id))
  const versionMap = new Map(input.versions?.map((entry) => [entry.executionId, entry.expectedVersion]))
  const executionIds = sorted.map((execution) => execution.id)
  const selectionHash = pharmacyPromotionHash(executionIds)
  const entries = sorted.map((execution) => {
    const expectedVersion = versionMap.size > 0
      ? versionMap.get(execution.id)
      : execution.version
    if (expectedVersion === undefined) throw new Error("MTM_PHARMACY_BULK_VERSION_SET_INVALID")
    const prepared = preparePharmacyPromotionReview({
      execution,
      actor: input.actor,
      reviewerUserId: input.reviewerUserId,
      parameters: {
        expectedVersion,
        level: input.level,
        decision: input.decision,
        reason: input.reason,
      },
      postingEnabled: input.postingEnabled,
    })
    return {
      executionId: execution.id,
      expectedVersion,
      previewHash: prepared.previewHash,
      preview: prepared.preview,
      calculation: prepared.calculation,
    }
  })
  const preview = {
    schemaVersion: 1,
    selectionScope: "EXPLICIT_IDS" as const,
    executionIds,
    selectionHash,
    level: input.level,
    decision: input.decision,
    reason: input.reason?.trim() || null,
    entries: entries.map(({ calculation: _calculation, ...entry }) => entry),
  }
  return {
    preview,
    previewHash: pharmacyPromotionHash(preview),
    selectionHash,
    versions: entries.map(({ executionId, expectedVersion }) => ({ executionId, expectedVersion })),
    entries,
  }
}
