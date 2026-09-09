import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"
import { preparePharmacyPromotionReview } from "@/lib/mtm/pharmacy-promotion-review"
import { PharmacyPromotionReviewSchema } from "@/lib/mtm/pharmacy-promotion-validators"

type RouteContext = { params: Promise<{ id: string }> }

const executionInclude = {
  formula: true,
  approvalPolicy: true,
  target: { select: { id: true, customerId: true, contactId: true } },
  reviews: {
    select: { level: true, decision: true, reviewerAgentId: true, reviewerUserId: true },
  },
} satisfies Prisma.MtmPharmacyPromotionExecutionInclude

function reviewResponse(review: any, execution: any) {
  return {
    review: {
      id: review.id,
      level: review.level,
      decision: review.decision,
      reason: review.reason,
      reviewerName: review.reviewerNameSnapshot,
      decidedAt: review.decidedAt,
      preview: {
        factPoints: review.factPointsPreview?.toString() ?? null,
        rewardPoints: review.rewardPointsPreview?.toString() ?? null,
        difference: review.differencePointsPreview?.toString() ?? null,
      },
    },
    execution: {
      id: execution.id,
      version: execution.version,
      status: execution.status,
      l1State: execution.l1State,
      l2State: execution.l2State,
      closedAt: execution.closedAt,
    },
  }
}

function reviewNotificationCopy(locale: string | null | undefined, level: string, decision: string) {
  const language = locale === "az" || locale === "en" ? locale : "ru"
  const decisionText = {
    ru: { APPROVED: "одобрено", REJECTED: "отклонено", RETURNED: "возвращено на исправление" },
    az: { APPROVED: "təsdiqləndi", REJECTED: "rədd edildi", RETURNED: "düzəliş üçün qaytarıldı" },
    en: { APPROVED: "approved", REJECTED: "rejected", RETURNED: "returned for correction" },
  }[language][decision as "APPROVED" | "REJECTED" | "RETURNED"]
  return {
    title: {
      ru: "Решение по аптечной промоакции",
      az: "Aptek promosiyası üzrə qərar",
      en: "Pharmacy promotion decision",
    }[language],
    body: {
      ru: `${level}: выполнение ${decisionText}`,
      az: `${level}: icra ${decisionText}`,
      en: `${level}: execution ${decisionText}`,
    }[language],
  }
}

export const POST = withMtmRlsAuth<RouteContext>("mtm", "write", async (req, auth, context) => {
  if (auth.principal === "mobile") {
    const forbidden = requireMobileCapability(auth, "TEAM_DECIDE")
    if (forbidden) return forbidden
  }
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  const { id } = await context.params
  const parsed = PharmacyPromotionReviewSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid review decision",
      code: "MTM_PHARMACY_REVIEW_INVALID",
    }, { status: 400 })
  }
  const body = parsed.data
  const requestHash = pharmacyPromotionHash({ executionId: id, ...body })
  const visible = await prisma.mtmPharmacyPromotionExecution.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      ...(actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }),
    },
    select: { id: true },
  })
  if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const prior = await prisma.mtmPharmacyPromotionReview.findFirst({
    where: { organizationId: auth.orgId, idempotencyKey: body.idempotencyKey, executionId: id },
  })
  if (prior) {
    if (prior.requestHash !== requestHash || prior.level !== body.level || prior.decision !== body.decision) {
      return NextResponse.json({ error: "Review idempotency conflict", code: "MTM_PHARMACY_REVIEW_IDEMPOTENCY_CONFLICT" }, { status: 409 })
    }
    const execution = await prisma.mtmPharmacyPromotionExecution.findFirst({
      where: {
        id,
        organizationId: auth.orgId,
        ...(actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }),
      },
    })
    if (!execution) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: reviewResponse(prior, execution), idempotent: true })
  }

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-review:${auth.orgId}:${id}`}, 0))`
      const currentActor = await resolveMtmRouteActor(tx as typeof prisma, {
        organizationId: auth.orgId,
        userId: auth.userId,
        webRole: auth.role,
        agentId: auth.agentId,
      })
      if (!currentActor) throw new Error("MTM_AGENT_INACTIVE")
      const replay = await tx.mtmPharmacyPromotionReview.findFirst({
        where: { organizationId: auth.orgId, idempotencyKey: body.idempotencyKey, executionId: id },
      })
      if (replay) {
        if (replay.requestHash !== requestHash || replay.level !== body.level || replay.decision !== body.decision) {
          throw new Error("MTM_PHARMACY_REVIEW_IDEMPOTENCY_CONFLICT")
        }
        const execution = await tx.mtmPharmacyPromotionExecution.findFirst({
          where: {
            id,
            organizationId: auth.orgId,
            ...(currentActor.scopedAgentIds === null ? {} : { agentId: { in: [...currentActor.scopedAgentIds] } }),
          },
        })
        if (!execution) return { notFound: true as const }
        return { review: replay, execution, idempotent: true }
      }
      const execution = await tx.mtmPharmacyPromotionExecution.findFirst({
        where: {
          id,
          organizationId: auth.orgId,
          ...(currentActor.scopedAgentIds === null ? {} : { agentId: { in: [...currentActor.scopedAgentIds] } }),
        },
        include: executionInclude,
      })
      if (!execution) return { notFound: true as const }
      const postingRow = await tx.mtmSetting.findFirst({
        where: { organizationId: auth.orgId, key: "pharmacyPromotionPostingEnabled" },
        select: { value: true },
      })
      const postingEnabled = postingRow?.value === true || postingRow?.value === "true"
      const prepared = preparePharmacyPromotionReview({
        execution,
        actor: currentActor,
        reviewerUserId: auth.userId,
        parameters: body,
        postingEnabled,
      })
      if (prepared.previewHash !== body.previewHash) throw new Error("MTM_PHARMACY_REVIEW_PREVIEW_STALE")

      const review = await tx.mtmPharmacyPromotionReview.create({
        data: {
          organizationId: auth.orgId,
          executionId: id,
          level: body.level,
          decision: body.decision,
          reviewerAgentId: currentActor.agentId,
          reviewerUserId: auth.userId,
          reviewerNameSnapshot: auth.name,
          reviewerScopeSnapshot: {
            role: currentActor.role,
            scopedAgentIds: currentActor.scopedAgentIds,
          },
          reason: body.reason?.trim() || null,
          approvalPolicyId: execution.approvalPolicyId,
          approvalPolicyVersion: execution.approvalPolicyVersion,
          approvalPolicyHash: execution.approvalPolicyHash,
          formulaId: execution.formulaId,
          formulaVersion: execution.formulaVersion,
          formulaHash: execution.formulaHash,
          factPointsPreview: new Prisma.Decimal(prepared.calculation.factPoints),
          rewardPointsPreview: new Prisma.Decimal(prepared.calculation.rewardPoints),
          differencePointsPreview: new Prisma.Decimal(prepared.calculation.difference),
          calculationSnapshot: prepared.preview.calculation,
          idempotencyKey: body.idempotencyKey,
          requestHash,
        },
      })
      const next = prepared.preview.nextState
      const closedAt = next.status === "APPROVED" || next.status === "REJECTED" ? new Date() : null
      const updated = await tx.mtmPharmacyPromotionExecution.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          version: body.expectedVersion,
          status: execution.status,
          l1State: execution.l1State,
          l2State: execution.l2State,
        },
        data: {
          status: next.status as any,
          l1State: next.l1State as any,
          l2State: next.l2State as any,
          closedAt,
          version: { increment: 1 },
        },
      })
      if (updated.count !== 1) throw new Error("MTM_PHARMACY_EXECUTION_VERSION_CONFLICT")

      if (next.postsLedger) {
        const ledgerBase = {
          organizationId: auth.orgId,
          beneficiaryAgentId: execution.agentId,
          targetId: execution.target.id,
          customerId: execution.target.customerId,
          contactId: execution.target.contactId,
          executionId: id,
          reviewId: review.id,
          entryType: "AWARD" as const,
          requestHash,
          formulaId: execution.formulaId,
          formulaVersion: execution.formulaVersion,
          formulaHash: execution.formulaHash,
          calculationSnapshot: prepared.preview.calculation,
          actorAgentId: currentActor.agentId,
          actorUserId: auth.userId,
        }
        await tx.mtmPharmacyPointsLedgerEntry.create({
          data: {
            ...ledgerBase,
            bucket: "FACT_POINTS",
            delta: new Prisma.Decimal(prepared.calculation.factPoints),
            sourceKey: `execution:${id}:award:fact`,
          },
        })
        await tx.mtmPharmacyPointsLedgerEntry.create({
          data: {
            ...ledgerBase,
            bucket: "REWARD_POINTS",
            delta: new Prisma.Decimal(prepared.calculation.rewardPoints),
            sourceKey: `execution:${id}:award:reward`,
          },
        })
      }
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          targetId: execution.target.id,
          executionId: id,
          formulaId: execution.formulaId,
          approvalPolicyId: execution.approvalPolicyId,
          reviewId: review.id,
          eventType: `REVIEW_${body.level}_${body.decision}`,
          fromState: execution.status,
          toState: next.status,
          actorAgentId: currentActor.agentId,
          actorUserId: auth.userId,
          sourceKey: `execution:${id}:review:${body.level}`,
          requestHash,
          payload: {
            reviewId: review.id,
            previewHash: body.previewHash,
            idempotencyKey: body.idempotencyKey,
            nextState: next,
          },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          action: `PHARMACY_PROMOTION_REVIEW_${body.decision}`,
          entity: "mtm_pharmacy_promotion_execution",
          entityId: id,
          metadataKind: "pharmacy_promotion_review",
          oldData: { status: execution.status, l1State: execution.l1State, l2State: execution.l2State },
          newData: { status: next.status, l1State: next.l1State, l2State: next.l2State, reviewId: review.id },
        },
      })
      const recipient = await tx.mtmAgent.findFirst({
        where: { id: execution.agentId, organizationId: auth.orgId },
        select: { user: { select: { preferredLanguage: true } } },
      })
      const notificationCopy = reviewNotificationCopy(recipient?.user?.preferredLanguage, body.level, body.decision)
      await tx.mtmNotification.create({
        data: {
          organizationId: auth.orgId,
          agentId: execution.agentId,
          title: notificationCopy.title,
          body: notificationCopy.body,
          type: body.decision === "APPROVED" ? "info" : "warning",
          metadata: { executionId: id, reviewId: review.id, level: body.level, decision: body.decision },
        },
      })
      const refreshed = await tx.mtmPharmacyPromotionExecution.findFirst({ where: { id, organizationId: auth.orgId } })
      return { review, execution: refreshed, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if ("notFound" in result) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!result.execution) throw new Error("MTM_PHARMACY_EXECUTION_NOT_FOUND")
    return NextResponse.json({ success: true, data: reviewResponse(result.review, result.execution), idempotent: result.idempotent })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_REVIEW_FAILED"
    if (code.endsWith("_DENIED") || code === "MTM_PHARMACY_DISTINCT_REVIEWER_REQUIRED") {
      return NextResponse.json({ error: "Review is not permitted", code }, { status: 403 })
    }
    const conflicts = new Set([
      "MTM_PHARMACY_REVIEW_IDEMPOTENCY_CONFLICT",
      "MTM_PHARMACY_REVIEW_PREVIEW_STALE",
      "MTM_PHARMACY_EXECUTION_VERSION_CONFLICT",
      "MTM_PHARMACY_L1_NOT_READY",
      "MTM_PHARMACY_L2_NOT_READY",
      "MTM_PHARMACY_REVIEW_REASON_REQUIRED",
      "MTM_PHARMACY_POSTING_DISABLED",
      "MTM_PHARMACY_CONFIGURATION_NOT_SIGNED",
      "MTM_PHARMACY_POLICY_PROJECTION_MISMATCH",
      "MTM_PHARMACY_SOURCE_STALE",
      "MTM_PHARMACY_CALCULATION_CHANGED",
      "MTM_PHARMACY_CALCULATION_OUT_OF_RANGE",
      "MTM_PHARMACY_FACT_QUANTITY_INVALID",
    ])
    if (conflicts.has(code)) return NextResponse.json({ error: "Review conflict", code }, { status: 409 })
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return NextResponse.json({
        error: "Review conflicted with another decision; refresh before retrying",
        code: error.code === "P2034"
          ? "MTM_PHARMACY_EXECUTION_VERSION_CONFLICT"
          : "MTM_PHARMACY_REVIEW_IDEMPOTENCY_CONFLICT",
      }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotion review]", error)
    return NextResponse.json({ error: "Failed to apply review", code: "MTM_PHARMACY_REVIEW_FAILED" }, { status: 500 })
  }
})
