import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import {
  PHARMACY_PROMOTION_BLOCKERS,
  PharmacyPromotionApprovalPolicyDefinitionSchema,
  PharmacyPromotionEligibilityDefinitionSchema,
  PharmacyPromotionFormulaDefinitionSchema,
  calculatePharmacyPromotionPoints,
  evaluatePharmacyPromotionEligibility,
  pharmacyPromotionConfigurationState,
  pharmacyPromotionExecutionReadiness,
  pharmacyPromotionHash,
  pharmacyPromotionSourceFreshness,
} from "@/lib/mtm/pharmacy-promotion"
import { PharmacyPromotionExecutionSubmitSchema } from "@/lib/mtm/pharmacy-promotion-validators"
import { dateInputValueInTimezone } from "@/lib/timezone"

type RouteContext = { params: Promise<{ id: string }> }

function actorFor(auth: MtmRlsAuth) {
  return resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

function responseData(execution: any) {
  return {
    id: execution.id,
    version: execution.version,
    status: execution.status,
    l1State: execution.l1State,
    l2State: execution.l2State,
    submittedAt: execution.submittedAt,
    readyAt: execution.readyAt,
    factQuantity: execution.actualQuantity.toString(),
    preview: {
      factPoints: execution.factPointsPreview?.toString() ?? null,
      rewardPoints: execution.rewardPointsPreview?.toString() ?? null,
      difference: execution.differencePointsPreview?.toString() ?? null,
    },
  }
}

export const POST = withMtmRlsAuth<RouteContext>("mtm", "write", async (req, auth, context) => {
  if (auth.principal === "mobile") {
    const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
    if (forbidden) return forbidden
  }
  const actor = await actorFor(auth)
  if (!actor) {
    return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  }
  if (actor.role !== "AGENT" || !actor.agentId) {
    return NextResponse.json({ error: "Field execution is agent-only", code: "MTM_PHARMACY_FIELD_EXECUTE_DENIED" }, { status: 403 })
  }
  const { id: executionReference } = await context.params
  if (!executionReference || executionReference.length > 128) {
    return NextResponse.json({
      error: "Invalid promotion execution reference",
      code: "MTM_PHARMACY_SUBMIT_INVALID",
    }, { status: 400 })
  }
  const parsed = PharmacyPromotionExecutionSubmitSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid submit request",
      code: "MTM_PHARMACY_SUBMIT_INVALID",
    }, { status: 400 })
  }
  const body = parsed.data

  // Durable offline drafts know their stable clientExecutionId before the
  // server-generated Prisma id exists. Resolve either reference inside the
  // authenticated agent scope, but fail closed if a legacy client ID collides
  // with another execution's canonical ID.
  const lifecycleMatches = await prisma.mtmPharmacyPromotionExecution.findMany({
    where: {
      organizationId: auth.orgId,
      agentId: actor.agentId,
      OR: [
        { id: executionReference },
        { clientExecutionId: executionReference },
      ],
    },
    select: { id: true, target: { select: { promotionVersionId: true } } },
    take: 2,
  })
  if (lifecycleMatches.length > 1) {
    return NextResponse.json({
      error: "Promotion execution reference is ambiguous",
      code: "MTM_PHARMACY_EXECUTION_REFERENCE_AMBIGUOUS",
    }, { status: 409 })
  }
  const lifecycle = lifecycleMatches[0]
  if (!lifecycle) {
    return NextResponse.json({ error: "Promotion execution not found", code: "MTM_PHARMACY_EXECUTION_NOT_FOUND" }, { status: 404 })
  }
  const executionId = lifecycle.id
  const requestHash = pharmacyPromotionHash({ executionId, ...body })
  const sourceKey = `execution:${executionId}:submit:${body.operationId}`

  const prior = await prisma.mtmPharmacyPromotionEvent.findFirst({
    where: { organizationId: auth.orgId, sourceKey },
    select: { requestHash: true, executionId: true },
  })
  if (prior) {
    if (prior.requestHash !== requestHash || prior.executionId !== executionId) {
      return NextResponse.json({ error: "Submit idempotency conflict", code: "MTM_PHARMACY_SUBMIT_IDEMPOTENCY_CONFLICT" }, { status: 409 })
    }
    const execution = await prisma.mtmPharmacyPromotionExecution.findFirst({
      where: { id: executionId, organizationId: auth.orgId, agentId: actor.agentId },
    })
    if (!execution) return NextResponse.json({ error: "Promotion execution not found", code: "MTM_PHARMACY_EXECUTION_NOT_FOUND" }, { status: 404 })
    return NextResponse.json({ success: true, data: responseData(execution), idempotent: true })
  }

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-submit:${auth.orgId}:${executionId}`}, 0))`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-version:${auth.orgId}:${lifecycle.target.promotionVersionId}`}, 0))`
      const currentActor = await resolveMtmRouteActor(tx as typeof prisma, {
        organizationId: auth.orgId,
        userId: auth.userId,
        webRole: auth.role,
        agentId: auth.agentId,
      })
      if (!currentActor || currentActor.role !== "AGENT" || !currentActor.agentId || currentActor.agentId !== actor.agentId) {
        throw new Error("MTM_PHARMACY_FIELD_EXECUTE_DENIED")
      }
      const replay = await tx.mtmPharmacyPromotionEvent.findFirst({
        where: { organizationId: auth.orgId, sourceKey },
        select: { requestHash: true },
      })
      if (replay) {
        if (replay.requestHash !== requestHash) throw new Error("MTM_PHARMACY_SUBMIT_IDEMPOTENCY_CONFLICT")
        const execution = await tx.mtmPharmacyPromotionExecution.findFirst({
          where: { id: executionId, organizationId: auth.orgId, agentId: currentActor.agentId },
        })
        return { execution, idempotent: true }
      }

      const execution = await tx.mtmPharmacyPromotionExecution.findFirst({
        where: { id: executionId, organizationId: auth.orgId, agentId: currentActor.agentId },
        include: {
          formula: true,
          approvalPolicy: true,
          visit: {
            select: {
              id: true,
              status: true,
              customerId: true,
              agentId: true,
              checkOutAt: true,
              deletedAt: true,
            },
          },
          target: {
            include: {
              customer: { select: { id: true, objectType: true, status: true, deletedAt: true } },
              promotionVersion: true,
            },
          },
          _count: { select: { evidence: true } },
        },
      })
      if (!execution) return { notFound: true as const }
      if (execution.status !== "DRAFT") throw new Error("MTM_PHARMACY_EXECUTION_NOT_DRAFT")
      if (execution.version !== body.expectedVersion) throw new Error("MTM_PHARMACY_EXECUTION_VERSION_CONFLICT")
      if (execution.target.status === "CANCELLED" || execution.target.status === "CLOSED") {
        throw new Error("MTM_PHARMACY_TARGET_CLOSED")
      }
      if (!new Set(["PUBLISHED", "RETIRED"]).has(execution.target.promotionVersion.status)) {
        throw new Error("MTM_PHARMACY_PROMOTION_NOT_PUBLISHED")
      }
      if (
        execution.target.customer.objectType !== "PHARMACY"
        || execution.target.customer.status !== "ACTIVE"
        || execution.target.customer.deletedAt
      ) {
        throw new Error("MTM_PHARMACY_TARGET_INVALID")
      }
      const eligibilityOverrideActive = execution.target.eligibilityStatus === "OVERRIDDEN"
        && Boolean(execution.target.eligibilityOverrideReason?.trim())
      if (execution.target.eligibilityStatus === "OVERRIDDEN" && !eligibilityOverrideActive) {
        throw new Error("MTM_PHARMACY_TARGET_OVERRIDE_AUDIT_MISSING")
      }
      const linkedVisitCompleted = execution.visit?.status === "CHECKED_OUT"
        && execution.visit.checkOutAt !== null
        && execution.visit.deletedAt === null
      if (execution.visit && execution.visit.deletedAt !== null) {
        throw new Error("MTM_PHARMACY_VISIT_INCOMPLETE")
      }
      if (execution.visit && !linkedVisitCompleted && !eligibilityOverrideActive) {
        throw new Error("MTM_PHARMACY_VISIT_INCOMPLETE")
      }

      const postingRow = await tx.mtmSetting.findFirst({
        where: { organizationId: auth.orgId, key: "pharmacyPromotionPostingEnabled" },
        select: { value: true },
      })
      const postingEnabled = postingRow?.value === true || postingRow?.value === "true"
      const formulaParsed = PharmacyPromotionFormulaDefinitionSchema.safeParse(execution.formula.definition)
      const policyParsed = PharmacyPromotionApprovalPolicyDefinitionSchema.safeParse(execution.approvalPolicy.definition)
      const eligibilityParsed = PharmacyPromotionEligibilityDefinitionSchema.safeParse(
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
        postingEnabled,
        allowRetiredDefinitions: execution.target.promotionVersion.status === "RETIRED",
      })
      const sourceFreshness = pharmacyPromotionSourceFreshness({
        observedAt: execution.sourceObservedAt,
        receivedAt: execution.sourceReceivedAt,
        thresholdMinutes: formulaParsed.success ? formulaParsed.data.sourceFreshnessMinutes : 1,
      })
      const minimumEvidenceCount = eligibilityOverrideActive
        ? 0
        : eligibilityParsed.success
          ? eligibilityParsed.data.minimumEvidenceCount
          : Number.MAX_SAFE_INTEGER
      const readiness = pharmacyPromotionExecutionReadiness({
        configuration,
        source: sourceFreshness,
        evidenceCount: execution._count.evidence,
        minimumEvidenceCount,
      })
      if (!readiness.ready) {
        const error = new Error("MTM_PHARMACY_CONFIGURATION_NOT_SIGNED") as Error & { blockers?: string[] }
        error.blockers = readiness.blockers
        throw error
      }
      if (!formulaParsed.success || !policyParsed.success || !eligibilityParsed.success) {
        throw new Error("MTM_PHARMACY_CONFIGURATION_NOT_SIGNED")
      }
      if (
        execution.formulaHash !== execution.formula.definitionHash
        || execution.approvalPolicyHash !== execution.approvalPolicy.definitionHash
      ) {
        throw new Error("MTM_PHARMACY_PINNED_POLICY_CHANGED")
      }
      const eligibility = evaluatePharmacyPromotionEligibility(eligibilityParsed.data, {
        customerObjectType: execution.target.customer.objectType,
        customerActive: execution.target.customer.status === "ACTIVE" && !execution.target.customer.deletedAt,
        visitCompleted: linkedVisitCompleted,
        evidenceCount: execution._count.evidence,
      })
      const eligibilityReasons = eligibility.status === "INELIGIBLE" ? eligibility.reasons : []
      if (!eligibilityOverrideActive && eligibility.status !== "ELIGIBLE") {
        const error = new Error("MTM_PHARMACY_EXECUTION_INELIGIBLE") as Error & { reasons?: string[] }
        error.reasons = eligibilityReasons
        throw error
      }
      const finalEligibilityStatus = eligibilityOverrideActive ? "OVERRIDDEN" : "ELIGIBLE"
      const dateKey = dateInputValueInTimezone(execution.sourceObservedAt, execution.target.promotionVersion.timezone)
      const startsOn = dateInputValueInTimezone(execution.target.promotionVersion.startsOn, "UTC")
      const endsOn = dateInputValueInTimezone(execution.target.promotionVersion.endsOn, "UTC")
      if (dateKey < startsOn || dateKey > endsOn) throw new Error("MTM_PHARMACY_EXECUTION_OUT_OF_PERIOD")

      const calculation = calculatePharmacyPromotionPoints(formulaParsed.data, execution.actualQuantity)
      const updated = await tx.mtmPharmacyPromotionExecution.updateMany({
        where: {
          id: executionId,
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          status: "DRAFT",
          version: body.expectedVersion,
        },
        data: {
          submittedByAgentId: currentActor.agentId,
          submittedByUserId: auth.principal === "web" ? auth.userId : null,
          calculationInput: {
            ...(execution.calculationInput as Record<string, unknown>),
            inputHash: calculation.inputHash,
          } as Prisma.InputJsonValue,
          calculationOutput: calculation as unknown as Prisma.InputJsonValue,
          factPointsPreview: new Prisma.Decimal(calculation.factPoints),
          rewardPointsPreview: new Prisma.Decimal(calculation.rewardPoints),
          differencePointsPreview: new Prisma.Decimal(calculation.difference),
          status: "READY",
          l1State: "READY",
          l2State: "NOT_READY",
          submittedAt: new Date(),
          readyAt: new Date(),
          version: { increment: 1 },
        },
      })
      if (updated.count !== 1) throw new Error("MTM_PHARMACY_EXECUTION_VERSION_CONFLICT")
      if (execution.target.eligibilityStatus === "PENDING") {
        const eligibleTarget = await tx.mtmPharmacyPromotionTarget.updateMany({
          where: {
            organizationId: auth.orgId,
            id: execution.targetId,
            eligibilityStatus: "PENDING",
          },
          data: {
            eligibilityStatus: "ELIGIBLE",
            eligibilitySnapshot: {
              schemaVersion: 1,
              evaluatedAt: new Date().toISOString(),
              eligibilityDefinitionHash: execution.target.promotionVersion.eligibilityDefinitionHash,
              status: "ELIGIBLE",
              reasons: [],
            },
          },
        })
        if (eligibleTarget.count !== 1) throw new Error("MTM_PHARMACY_TARGET_ELIGIBILITY_CONFLICT")
      } else if (!new Set(["ELIGIBLE", "OVERRIDDEN"]).has(execution.target.eligibilityStatus)) {
        throw new Error("MTM_PHARMACY_EXECUTION_INELIGIBLE")
      }
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          targetId: execution.targetId,
          executionId,
          eventType: "EXECUTION_SUBMITTED",
          fromState: "DRAFT",
          toState: "READY",
          actorAgentId: currentActor.agentId,
          actorUserId: auth.principal === "web" ? auth.userId : null,
          sourceKey,
          requestHash,
          payload: {
            operationId: body.operationId,
            inputHash: calculation.inputHash,
            calculationHash: calculation.calculationHash,
            eligibility: {
              evaluatedStatus: eligibility.status,
              evaluatedReasons: eligibilityReasons,
              previousTargetStatus: execution.target.eligibilityStatus,
              targetStatus: finalEligibilityStatus,
              overridden: eligibilityOverrideActive,
              overrideReason: eligibilityOverrideActive
                ? execution.target.eligibilityOverrideReason
                : null,
            },
          },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          action: "PHARMACY_PROMOTION_EXECUTION_SUBMITTED",
          entity: "mtm_pharmacy_promotion_execution",
          entityId: executionId,
          metadataKind: "pharmacy_promotion_execution",
          oldData: {
            status: "DRAFT",
            version: body.expectedVersion,
            eligibilityStatus: execution.target.eligibilityStatus,
          },
          newData: {
            status: "READY",
            version: body.expectedVersion + 1,
            requestHash,
            eligibilityStatus: finalEligibilityStatus,
            eligibilityOverrideReason: eligibilityOverrideActive
              ? execution.target.eligibilityOverrideReason
              : null,
          },
        },
      })
      const refreshed = await tx.mtmPharmacyPromotionExecution.findFirst({
        where: { id: executionId, organizationId: auth.orgId, agentId: currentActor.agentId },
      })
      return { execution: refreshed, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if ("notFound" in result) {
      return NextResponse.json({ error: "Promotion execution not found", code: "MTM_PHARMACY_EXECUTION_NOT_FOUND" }, { status: 404 })
    }
    if (!result.execution) throw new Error("MTM_PHARMACY_EXECUTION_NOT_FOUND")
    return NextResponse.json({ success: true, data: responseData(result.execution), idempotent: result.idempotent })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_SUBMIT_FAILED"
    const conflictCodes = new Set([
      "MTM_PHARMACY_FIELD_EXECUTE_DENIED",
      "MTM_PHARMACY_SUBMIT_IDEMPOTENCY_CONFLICT",
      "MTM_PHARMACY_EXECUTION_NOT_DRAFT",
      "MTM_PHARMACY_EXECUTION_VERSION_CONFLICT",
      "MTM_PHARMACY_TARGET_CLOSED",
      "MTM_PHARMACY_PROMOTION_NOT_PUBLISHED",
      "MTM_PHARMACY_TARGET_INVALID",
      "MTM_PHARMACY_VISIT_INCOMPLETE",
      "MTM_PHARMACY_TARGET_ELIGIBILITY_CONFLICT",
      "MTM_PHARMACY_TARGET_OVERRIDE_AUDIT_MISSING",
      "MTM_PHARMACY_CONFIGURATION_NOT_SIGNED",
      "MTM_PHARMACY_PINNED_POLICY_CHANGED",
      "MTM_PHARMACY_EXECUTION_INELIGIBLE",
      "MTM_PHARMACY_EXECUTION_OUT_OF_PERIOD",
      "MTM_PHARMACY_CALCULATION_OUT_OF_RANGE",
      "MTM_PHARMACY_FACT_QUANTITY_INVALID",
    ])
    if (conflictCodes.has(code)) {
      const details = error && typeof error === "object"
        ? { blockers: (error as any).blockers, reasons: (error as any).reasons }
        : {}
      return NextResponse.json({ error: "Promotion execution cannot be submitted", code, ...details }, {
        status: code === "MTM_PHARMACY_FIELD_EXECUTE_DENIED" ? 403 : 409,
      })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({
        error: "Promotion execution changed concurrently; refresh and retry",
        code: "MTM_PHARMACY_EXECUTION_VERSION_CONFLICT",
      }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotion submit]", error)
    return NextResponse.json({
      error: "Failed to submit promotion execution",
      code: "MTM_PHARMACY_SUBMIT_FAILED",
      blockers: code === PHARMACY_PROMOTION_BLOCKERS.POSTING_DISABLED ? [code] : undefined,
    }, { status: 500 })
  }
})
