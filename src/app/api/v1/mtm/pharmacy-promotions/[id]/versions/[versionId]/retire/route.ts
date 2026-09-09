import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  PHARMACY_PROMOTION_ADMIN_REQUIRED,
  requireCurrentPharmacyPromotionAdministrator,
  resolvePharmacyPromotionAdministrator,
} from "@/lib/mtm/pharmacy-promotion-admin"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"

type RouteContext = { params: Promise<{ id: string; versionId: string }> }

const RetireVersionSchema = z.object({
  expectedDefinitionHash: z.string().regex(/^[a-f0-9]{64}$/i),
  reason: z.string().trim().min(3).max(2_000),
}).strict()

function forbidden() {
  return NextResponse.json({
    error: "Web administrator access required",
    code: PHARMACY_PROMOTION_ADMIN_REQUIRED,
  }, { status: 403 })
}

/**
 * Stop future target planning without rewriting any existing target,
 * execution, review, event, or ledger row. Existing targets remain executable
 * against their immutable published definition; a successor revision may be
 * published after this transition.
 */
export const POST = withMtmRlsAuth<RouteContext>("mtm", "write", async (req, auth, context) => {
  if (!await resolvePharmacyPromotionAdministrator(prisma, auth)) return forbidden()

  const parsed = RetireVersionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid retirement request",
      code: "MTM_PHARMACY_VERSION_RETIRE_INVALID",
    }, { status: 400 })
  }

  const { id: promotionId, versionId } = await context.params
  const body = {
    expectedDefinitionHash: parsed.data.expectedDefinitionHash.toLowerCase(),
    reason: parsed.data.reason,
  }
  const requestHash = pharmacyPromotionHash({ promotionId, versionId, ...body })
  const sourceKey = `promotion-version:${versionId}:retired`

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // The campaign lock serializes publish/retire, and the version lock is
      // shared with target planning so no target can be created after the
      // retirement CAS has committed.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-promotion:${auth.orgId}:${promotionId}`}, 0))`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-version:${auth.orgId}:${versionId}`}, 0))`
      const actor = await requireCurrentPharmacyPromotionAdministrator(tx, auth)

      const version = await tx.mtmPharmacyPromotionVersion.findFirst({
        where: { id: versionId, organizationId: auth.orgId, promotionId },
      })
      if (!version) return { kind: "NOT_FOUND" as const }
      if (version.definitionHash.toLowerCase() !== body.expectedDefinitionHash) {
        return { kind: "HASH_CONFLICT" as const, actualDefinitionHash: version.definitionHash }
      }

      if (version.status === "RETIRED") {
        const retirementEvent = await tx.mtmPharmacyPromotionEvent.findFirst({
          where: { organizationId: auth.orgId, sourceKey },
          select: { requestHash: true },
        })
        if (!retirementEvent) return { kind: "AUDIT_MISSING" as const }
        if (retirementEvent.requestHash !== requestHash) return { kind: "REPLAY_CONFLICT" as const }
        return { kind: "OK" as const, version, idempotent: true }
      }
      if (version.status !== "PUBLISHED") {
        return { kind: "STATE_CONFLICT" as const, status: version.status }
      }

      const retiredAt = new Date()
      const changed = await tx.mtmPharmacyPromotionVersion.updateMany({
        where: {
          id: versionId,
          organizationId: auth.orgId,
          promotionId,
          status: "PUBLISHED",
          definitionHash: version.definitionHash,
        },
        data: { status: "RETIRED", retiredAt },
      })
      if (changed.count !== 1) throw new Error("MTM_PHARMACY_VERSION_RETIRE_CONFLICT")

      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          promotionId,
          promotionVersionId: versionId,
          eventType: "PROMOTION_VERSION_RETIRED",
          fromState: "PUBLISHED",
          toState: "RETIRED",
          actorAgentId: actor.agentId,
          actorUserId: auth.userId,
          sourceKey,
          requestHash,
          payload: {
            definitionHash: version.definitionHash,
            reason: body.reason,
            preservesHistoricalExecutions: true,
            allowsNewTargetPlanning: false,
          },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "PHARMACY_PROMOTION_VERSION_RETIRE",
          entity: "mtm_pharmacy_promotion_version",
          entityId: versionId,
          metadataKind: "pharmacy_promotion_configuration",
          oldData: { status: "PUBLISHED", definitionHash: version.definitionHash },
          newData: {
            status: "RETIRED",
            retiredAt: retiredAt.toISOString(),
            reason: body.reason,
            preservesHistoricalExecutions: true,
            allowsNewTargetPlanning: false,
          },
        },
      })

      const retired = await tx.mtmPharmacyPromotionVersion.findFirst({
        where: { id: versionId, organizationId: auth.orgId, promotionId },
      })
      if (!retired || retired.status !== "RETIRED" || !retired.retiredAt) {
        throw new Error("MTM_PHARMACY_VERSION_RETIRE_CONFLICT")
      }
      return { kind: "OK" as const, version: retired, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (result.kind === "HASH_CONFLICT") {
      return NextResponse.json({
        error: "Campaign version changed since it was selected",
        code: "MTM_PHARMACY_VERSION_DEFINITION_CHANGED",
        actualDefinitionHash: result.actualDefinitionHash,
      }, { status: 409 })
    }
    if (result.kind === "STATE_CONFLICT") {
      return NextResponse.json({
        error: "Only a published campaign version can be retired",
        code: "MTM_PHARMACY_VERSION_RETIRE_STATE_CONFLICT",
        status: result.status,
      }, { status: 409 })
    }
    if (result.kind === "AUDIT_MISSING" || result.kind === "REPLAY_CONFLICT") {
      return NextResponse.json({
        error: "Campaign version retirement cannot be replayed coherently",
        code: result.kind === "AUDIT_MISSING"
          ? "MTM_PHARMACY_VERSION_RETIRE_AUDIT_MISSING"
          : "MTM_PHARMACY_VERSION_RETIRE_REPLAY_CONFLICT",
      }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      data: {
        version: result.version,
        historicalRecordsPreserved: true,
        newTargetPlanningAllowed: false,
      },
      idempotent: result.idempotent,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_VERSION_RETIRE_FAILED"
    if (code === PHARMACY_PROMOTION_ADMIN_REQUIRED) return forbidden()
    if (code === "MTM_PHARMACY_VERSION_RETIRE_CONFLICT") {
      return NextResponse.json({ error: "Campaign version changed concurrently", code }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return NextResponse.json({
        error: "Campaign version retirement conflicted with another change",
        code: "MTM_PHARMACY_VERSION_RETIRE_CONFLICT",
      }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotions retire]", error)
    return NextResponse.json({
      error: "Failed to retire campaign version",
      code: "MTM_PHARMACY_VERSION_RETIRE_FAILED",
    }, { status: 500 })
  }
})
