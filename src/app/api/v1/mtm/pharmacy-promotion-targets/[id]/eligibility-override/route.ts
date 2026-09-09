import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  PHARMACY_PROMOTION_ADMIN_REQUIRED,
  jsonValue,
  requireCurrentPharmacyPromotionAdministrator,
  resolvePharmacyPromotionAdministrator,
} from "@/lib/mtm/pharmacy-promotion-admin"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"
import { PharmacyPromotionEligibilityOverrideSchema } from "@/lib/mtm/pharmacy-promotion-validators"

type RouteContext = { params: Promise<{ id: string }> }

function forbidden() {
  return NextResponse.json({
    error: "Web administrator access required",
    code: PHARMACY_PROMOTION_ADMIN_REQUIRED,
  }, { status: 403 })
}

function responseTarget(target: {
  id: string
  eligibilityStatus: string
  eligibilitySnapshot: unknown
  eligibilityOverrideReason: string | null
}) {
  return {
    id: target.id,
    eligibilityStatus: target.eligibilityStatus,
    eligibilitySnapshot: target.eligibilitySnapshot,
    eligibilityOverrideReason: target.eligibilityOverrideReason,
  }
}

/**
 * Record a governed exception to target eligibility. The exception is narrow:
 * it can resolve only a PENDING/INELIGIBLE target, never a terminal target,
 * and it does not bypass tenant, active-pharmacy, source-freshness, formula,
 * or approval-policy checks performed when an execution is submitted.
 */
export const POST = withMtmRlsAuth<RouteContext>("mtm", "write", async (req, auth, context) => {
  if (!await resolvePharmacyPromotionAdministrator(prisma, auth)) return forbidden()

  const parsed = PharmacyPromotionEligibilityOverrideSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid eligibility override",
      code: "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_INVALID",
    }, { status: 400 })
  }

  const { id: targetId } = await context.params
  if (!targetId || targetId.length > 128) {
    return NextResponse.json({
      error: "Invalid promotion target reference",
      code: "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_INVALID",
    }, { status: 400 })
  }
  const body = parsed.data
  const requestHash = pharmacyPromotionHash({ targetId, ...body })
  const sourceKey = `promotion-target:${targetId}:eligibility-override:${body.operationId}`

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-target:${auth.orgId}:${targetId}`}, 0))`
      const actor = await requireCurrentPharmacyPromotionAdministrator(tx, auth)
      const target = await tx.mtmPharmacyPromotionTarget.findFirst({
        where: { id: targetId, organizationId: auth.orgId },
        select: {
          id: true,
          status: true,
          eligibilityStatus: true,
          eligibilitySnapshot: true,
          eligibilityOverrideReason: true,
          promotionVersionId: true,
          promotionVersion: { select: { promotionId: true } },
        },
      })
      if (!target) return { kind: "NOT_FOUND" as const }

      const replay = await tx.mtmPharmacyPromotionEvent.findFirst({
        where: { organizationId: auth.orgId, sourceKey },
        select: {
          eventType: true,
          targetId: true,
          actorUserId: true,
          requestHash: true,
        },
      })
      if (replay) {
        if (
          replay.eventType !== "PROMOTION_TARGET_ELIGIBILITY_OVERRIDDEN"
          || replay.targetId !== targetId
          || replay.actorUserId !== auth.userId
          || replay.requestHash !== requestHash
          || target.eligibilityStatus !== "OVERRIDDEN"
          || target.eligibilityOverrideReason !== body.reason
        ) {
          return { kind: "REPLAY_CONFLICT" as const }
        }
        return { kind: "OK" as const, target, idempotent: true }
      }

      if (target.status === "CLOSED" || target.status === "CANCELLED") {
        return { kind: "TARGET_TERMINAL" as const, status: target.status }
      }
      if (target.eligibilityStatus !== body.expectedEligibilityStatus) {
        return { kind: "STATE_CONFLICT" as const, status: target.eligibilityStatus }
      }

      const overriddenAt = new Date()
      const eligibilitySnapshot = {
        schemaVersion: 1,
        status: "OVERRIDDEN",
        previousStatus: target.eligibilityStatus,
        previousEvaluation: target.eligibilitySnapshot,
        override: {
          reason: body.reason,
          operationId: body.operationId,
          actorUserId: auth.userId,
          actorAgentId: actor.agentId,
          occurredAt: overriddenAt.toISOString(),
        },
      }
      const changed = await tx.mtmPharmacyPromotionTarget.updateMany({
        where: {
          id: targetId,
          organizationId: auth.orgId,
          status: { in: ["PLANNED", "CONNECTED"] },
          eligibilityStatus: body.expectedEligibilityStatus,
        },
        data: {
          eligibilityStatus: "OVERRIDDEN",
          eligibilityOverrideReason: body.reason,
          eligibilitySnapshot: jsonValue(eligibilitySnapshot),
        },
      })
      if (changed.count !== 1) throw new Error("MTM_PHARMACY_ELIGIBILITY_OVERRIDE_CONFLICT")

      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          promotionId: target.promotionVersion.promotionId,
          promotionVersionId: target.promotionVersionId,
          targetId,
          eventType: "PROMOTION_TARGET_ELIGIBILITY_OVERRIDDEN",
          fromState: target.eligibilityStatus,
          toState: "OVERRIDDEN",
          actorAgentId: actor.agentId,
          actorUserId: auth.userId,
          sourceKey,
          requestHash,
          payload: jsonValue({
            operationId: body.operationId,
            reason: body.reason,
            actorUserId: auth.userId,
            actorAgentId: actor.agentId,
            occurredAt: overriddenAt.toISOString(),
            previousEligibilitySnapshot: target.eligibilitySnapshot,
          }),
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "PHARMACY_PROMOTION_ELIGIBILITY_OVERRIDE",
          entity: "mtm_pharmacy_promotion_target",
          entityId: targetId,
          metadataKind: "pharmacy_promotion_eligibility",
          oldData: jsonValue({
            eligibilityStatus: target.eligibilityStatus,
            eligibilitySnapshot: target.eligibilitySnapshot,
            eligibilityOverrideReason: target.eligibilityOverrideReason,
          }),
          newData: jsonValue({
            eligibilityStatus: "OVERRIDDEN",
            eligibilitySnapshot,
            eligibilityOverrideReason: body.reason,
            requestHash,
          }),
        },
      })

      return {
        kind: "OK" as const,
        target: {
          id: target.id,
          eligibilityStatus: "OVERRIDDEN",
          eligibilitySnapshot,
          eligibilityOverrideReason: body.reason,
        },
        idempotent: false,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "Promotion target not found" }, { status: 404 })
    }
    if (result.kind === "TARGET_TERMINAL") {
      return NextResponse.json({
        error: "A terminal promotion target cannot be overridden",
        code: "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_TARGET_TERMINAL",
        status: result.status,
      }, { status: 409 })
    }
    if (result.kind === "STATE_CONFLICT") {
      return NextResponse.json({
        error: "Target eligibility changed since it was selected",
        code: "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_STATE_CONFLICT",
        status: result.status,
      }, { status: 409 })
    }
    if (result.kind === "REPLAY_CONFLICT") {
      return NextResponse.json({
        error: "Eligibility override cannot be replayed coherently",
        code: "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_REPLAY_CONFLICT",
      }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      data: { target: responseTarget(result.target) },
      idempotent: result.idempotent,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_FAILED"
    if (code === PHARMACY_PROMOTION_ADMIN_REQUIRED) return forbidden()
    if (code === "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_CONFLICT") {
      return NextResponse.json({ error: "Target eligibility changed concurrently", code }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return NextResponse.json({
        error: "Eligibility override conflicted with another change",
        code: "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_CONFLICT",
      }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotion-target eligibility override]", error)
    return NextResponse.json({
      error: "Failed to override promotion target eligibility",
      code: "MTM_PHARMACY_ELIGIBILITY_OVERRIDE_FAILED",
    }, { status: 500 })
  }
})
