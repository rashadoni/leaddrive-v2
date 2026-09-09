import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { pharmacyPromotionCapabilities } from "@/lib/mtm/pharmacy-promotion-query"
import {
  PharmacyPromotionEligibilityDefinitionSchema,
  PharmacyPromotionFormulaDefinitionSchema,
  evaluatePharmacyPromotionEligibility,
  pharmacyPromotionConfigurationState,
  pharmacyPromotionExecutionReadiness,
  pharmacyPromotionSyncScopeKey,
  pharmacyPromotionSourceFreshness,
  reconcilePharmacyPromotionLedger,
} from "@/lib/mtm/pharmacy-promotion"

type RouteContext = { params: Promise<{ id: string }> }

function decimal(value: Prisma.Decimal | string | number | null | undefined) {
  return value == null ? null : new Prisma.Decimal(value).toFixed(4)
}

type DetailEvidence = Pick<Prisma.MtmPharmacyPromotionEvidenceGetPayload<{}>,
  "id" | "kind" | "contentHash" | "capturedAt" | "sourceObservedAt" | "sourceReceivedAt"
> & {
  submittedByAgent: { id: string; name: string } | null
  document: {
    id: string
    title: string | null
    fileName: string
    mimeType: string
    sizeBytes: number
    checksumSha256: string
  } | null
}

type DetailReview = Pick<Prisma.MtmPharmacyPromotionReviewGetPayload<{}>,
  | "id" | "level" | "decision" | "formulaId" | "approvalPolicyId" | "batchId"
  | "reason" | "reviewerNameSnapshot" | "factPointsPreview" | "rewardPointsPreview"
  | "differencePointsPreview" | "decidedAt"
>

type DetailLedgerEntry = Pick<Prisma.MtmPharmacyPointsLedgerEntryGetPayload<{}>,
  | "id" | "entryType" | "bucket" | "delta" | "sourceKey" | "reason"
  | "reversesEntryId" | "formulaVersion" | "formulaHash" | "occurredAt"
>

export const GET = withMtmRlsAuth<RouteContext>("mtm", "read", async (_req, auth, context) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  const { id } = await context.params
  const execution = await prisma.mtmPharmacyPromotionExecution.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      ...(actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }),
    },
    include: {
      agent: { select: { id: true, name: true } },
      submittedByAgent: { select: { id: true, name: true } },
      target: {
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              code: true,
              address: true,
              locality: true,
              territoryCode: true,
              status: true,
              objectType: true,
              deletedAt: true,
            },
          },
          contact: { select: { id: true, displayName: true } },
          assignedTeam: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
          managingManager: { select: { id: true, name: true } },
          promotionVersion: {
            include: {
              promotion: { select: { id: true, code: true } },
              type: true,
            },
          },
        },
      },
      visit: {
        select: { id: true, status: true, checkInAt: true, checkOutAt: true, outcome: true, resultNotes: true },
      },
      formula: {
        select: {
          id: true,
          code: true,
          version: true,
          definition: true,
          definitionHash: true,
          status: true,
          signedAt: true,
          approvalReference: true,
          sourceSystem: true,
          sourceObservedAt: true,
        },
      },
      approvalPolicy: {
        select: {
          id: true,
          code: true,
          version: true,
          definition: true,
          definitionHash: true,
          status: true,
          signedAt: true,
          approvalReference: true,
        },
      },
      evidence: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          contentHash: true,
          capturedAt: true,
          sourceObservedAt: true,
          sourceReceivedAt: true,
          submittedByAgent: { select: { id: true, name: true } },
          document: {
            select: {
              id: true,
              title: true,
              fileName: true,
              mimeType: true,
              sizeBytes: true,
              checksumSha256: true,
            },
          },
        },
      },
      reviews: {
        orderBy: { decidedAt: "asc" },
        select: {
          id: true,
          level: true,
          decision: true,
          formulaId: true,
          approvalPolicyId: true,
          batchId: true,
          reason: true,
          reviewerNameSnapshot: true,
          factPointsPreview: true,
          rewardPointsPreview: true,
          differencePointsPreview: true,
          decidedAt: true,
        },
      },
      ledgerEntries: {
        orderBy: { occurredAt: "asc" },
        select: {
          id: true,
          entryType: true,
          bucket: true,
          delta: true,
          sourceKey: true,
          reason: true,
          reversesEntryId: true,
          formulaVersion: true,
          formulaHash: true,
          occurredAt: true,
        },
      },
      events: {
        orderBy: { occurredAt: "asc" },
        select: {
          id: true,
          eventType: true,
          fromState: true,
          toState: true,
          formulaId: true,
          approvalPolicyId: true,
          evidenceId: true,
          reviewId: true,
          operationId: true,
          payload: true,
          occurredAt: true,
        },
      },
    },
  })
  if (!execution) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const factLedger = execution.ledgerEntries.filter((entry: DetailLedgerEntry) => entry.bucket === "FACT_POINTS")
  const rewardLedger = execution.ledgerEntries.filter((entry: DetailLedgerEntry) => entry.bucket === "REWARD_POINTS")
  const factPoints = factLedger.length ? reconcilePharmacyPromotionLedger(factLedger) : null
  const rewardPoints = rewardLedger.length ? reconcilePharmacyPromotionLedger(rewardLedger) : null
  const settings = await getMtmSettings(auth.orgId)
  const capabilities = pharmacyPromotionCapabilities(actor, settings.pharmacyPromotionPostingEnabled)
  const formulaDefinition = PharmacyPromotionFormulaDefinitionSchema.safeParse(execution.formula.definition)
  const eligibilityDefinition = PharmacyPromotionEligibilityDefinitionSchema.safeParse(
    execution.target.promotionVersion.eligibilityDefinition,
  )
  const configuration = pharmacyPromotionConfigurationState({
    formula: {
      status: execution.formula.status,
      definition: execution.formula.definition,
      definitionHash: execution.formula.definitionHash,
      signedAt: execution.formula.signedAt,
      approvalReference: execution.formula.approvalReference,
      version: String(execution.formula.version),
    },
    approvalPolicy: {
      status: execution.approvalPolicy.status,
      definition: execution.approvalPolicy.definition,
      definitionHash: execution.approvalPolicy.definitionHash,
      signedAt: execution.approvalPolicy.signedAt,
      approvalReference: execution.approvalPolicy.approvalReference,
      version: String(execution.approvalPolicy.version),
    },
    eligibilityDefinition: execution.target.promotionVersion.eligibilityDefinition,
    eligibilityDefinitionHash: execution.target.promotionVersion.eligibilityDefinitionHash,
    eligibilityApprovedAt: execution.target.promotionVersion.eligibilityApprovedAt,
    eligibilityApprovalReference: execution.target.promotionVersion.eligibilityApprovalReference,
    postingEnabled: settings.pharmacyPromotionPostingEnabled,
    allowRetiredDefinitions: execution.target.promotionVersion.status === "RETIRED",
  })
  const freshness = pharmacyPromotionSourceFreshness({
    observedAt: execution.sourceObservedAt,
    receivedAt: execution.sourceReceivedAt,
    thresholdMinutes: formulaDefinition.success ? formulaDefinition.data.sourceFreshnessMinutes : 1,
  })
  const overrideReason = execution.target.eligibilityOverrideReason?.trim() ?? ""
  const overrideActive = execution.target.eligibilityStatus === "OVERRIDDEN" && overrideReason.length > 0
  const overrideAuditMissing = execution.target.eligibilityStatus === "OVERRIDDEN" && !overrideActive
  const eligibilityEvaluation = eligibilityDefinition.success
    ? evaluatePharmacyPromotionEligibility(eligibilityDefinition.data, {
        customerObjectType: execution.target.customer.objectType,
        customerActive: execution.target.customer.status === "ACTIVE" && !execution.target.customer.deletedAt,
        visitCompleted: execution.visit?.status === "CHECKED_OUT",
        evidenceCount: execution.evidence.length,
      })
    : null
  const eligibilityReasons = eligibilityEvaluation?.status === "INELIGIBLE"
    ? eligibilityEvaluation.reasons
    : []
  const eligibilityBlockers = eligibilityReasons.flatMap((reason) => {
    if (reason === "CUSTOMER_TYPE" || reason === "CUSTOMER_INACTIVE") return ["MTM_PHARMACY_TARGET_INVALID"]
    if (overrideActive) return []
    if (reason === "VISIT_INCOMPLETE") return ["MTM_PHARMACY_VISIT_INCOMPLETE"]
    if (reason === "EVIDENCE_INCOMPLETE") return ["MTM_PHARMACY_EVIDENCE_INCOMPLETE"]
    return ["MTM_PHARMACY_EXECUTION_INELIGIBLE"]
  })
  if (!overrideActive && execution.target.eligibilityStatus === "INELIGIBLE") {
    eligibilityBlockers.push("MTM_PHARMACY_EXECUTION_INELIGIBLE")
  }
  const readiness = pharmacyPromotionExecutionReadiness({
    configuration,
    source: freshness,
    evidenceCount: execution.evidence.length,
    minimumEvidenceCount: overrideActive
      ? 0
      : eligibilityDefinition.success
      ? eligibilityDefinition.data.minimumEvidenceCount
      : Number.MAX_SAFE_INTEGER,
  })
  const readinessBlockers = [...new Set([
    ...(overrideAuditMissing ? ["MTM_PHARMACY_TARGET_OVERRIDE_AUDIT_MISSING"] : []),
    ...(readiness.ready ? [] : readiness.blockers),
    ...eligibilityBlockers,
  ])]

  return NextResponse.json({
    success: true,
    data: {
      id: execution.id,
      version: execution.version,
      status: execution.status,
      l1State: execution.l1State,
      l2State: execution.l2State,
      permissions: {
        canSubmit: actor.role === "AGENT"
          && actor.agentId === execution.agentId
          && execution.status === "DRAFT",
        canReview: capabilities.canReview,
      },
      syncScopeKey: pharmacyPromotionSyncScopeKey({
        organizationId: auth.orgId,
        userId: auth.userId,
        agentId: actor.agentId,
      }),
      employee: execution.agent,
      submittedBy: execution.submittedByAgent,
      target: {
        id: execution.target.id,
        status: execution.target.status,
        customer: execution.target.customer,
        contact: execution.target.contact,
        team: execution.target.assignedTeam,
        manager: execution.target.managingManager,
        planQuantity: decimal(execution.planQuantitySnapshot),
        unit: execution.unit,
      },
      promotion: {
        id: execution.target.promotionVersion.id,
        revision: execution.target.promotionVersion.revision,
        status: execution.target.promotionVersion.status,
        nameRu: execution.target.promotionVersion.nameRu,
        nameAz: execution.target.promotionVersion.nameAz,
        nameEn: execution.target.promotionVersion.nameEn,
        startsOn: execution.target.promotionVersion.startsOn,
        endsOn: execution.target.promotionVersion.endsOn,
        timezone: execution.target.promotionVersion.timezone,
        promotion: execution.target.promotionVersion.promotion,
        type: execution.target.promotionVersion.type,
      },
      visit: execution.visit,
      factQuantity: decimal(execution.actualQuantity),
      preview: {
        factPoints: decimal(execution.factPointsPreview),
        rewardPoints: decimal(execution.rewardPointsPreview),
        difference: decimal(execution.differencePointsPreview),
      },
      ledgerTotals: {
        factPoints,
        rewardPoints,
        difference: factPoints === null && rewardPoints === null
          ? null
          : new Prisma.Decimal(factPoints ?? 0).minus(rewardPoints ?? 0).toFixed(4),
      },
      formula: {
        id: execution.formula.id,
        code: execution.formula.code,
        version: execution.formula.version,
        definitionHash: execution.formula.definitionHash,
        sourceSystem: execution.formula.sourceSystem,
        sourceObservedAt: execution.formula.sourceObservedAt,
      },
      approvalPolicy: {
        id: execution.approvalPolicy.id,
        code: execution.approvalPolicy.code,
        version: execution.approvalPolicy.version,
        definitionHash: execution.approvalPolicy.definitionHash,
      },
      eligibility: {
        status: execution.target.eligibilityStatus,
        overridden: overrideActive,
        overrideReason: overrideActive ? overrideReason : null,
        evaluatedStatus: eligibilityEvaluation?.status ?? "UNKNOWN",
        reasons: eligibilityReasons,
      },
      policy: {
        ready: readiness.ready && !overrideAuditMissing && eligibilityBlockers.length === 0,
        blockers: readiness.ready && !overrideAuditMissing && eligibilityBlockers.length === 0 ? [] : readinessBlockers,
        postingEnabled: settings.pharmacyPromotionPostingEnabled,
      },
      source: {
        system: execution.sourceSystem,
        reference: execution.sourceReference,
        observedAt: execution.sourceObservedAt,
        receivedAt: execution.sourceReceivedAt,
        freshness,
      },
      evidence: execution.evidence.map((entry: DetailEvidence) => ({
        ...entry,
        downloadUrl: entry.document
          ? `/api/v1/mtm/pharmacy-promotion-executions/${id}/evidence/${entry.id}/download`
          : null,
      })),
      reviews: execution.reviews.map((review: DetailReview) => ({
        ...review,
        factPointsPreview: decimal(review.factPointsPreview),
        rewardPointsPreview: decimal(review.rewardPointsPreview),
        differencePointsPreview: decimal(review.differencePointsPreview),
      })),
      ledger: execution.ledgerEntries.map((entry: DetailLedgerEntry) => ({ ...entry, delta: decimal(entry.delta) })),
      events: execution.events,
      submittedAt: execution.submittedAt,
      readyAt: execution.readyAt,
      closedAt: execution.closedAt,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
    },
  })
})
