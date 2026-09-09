import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  PHARMACY_PROMOTION_ADMIN_REQUIRED,
  requireCurrentPharmacyPromotionAdministrator,
  resolvePharmacyPromotionAdministrator,
} from "@/lib/mtm/pharmacy-promotion-admin"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withMtmRlsAuth<RouteContext>("mtm", "write", async (_req, auth, context) => {
  if (!await resolvePharmacyPromotionAdministrator(prisma, auth)) {
    return NextResponse.json({ error: "Web administrator access required", code: "MTM_PHARMACY_ADMIN_REQUIRED" }, { status: 403 })
  }
  const { id } = await context.params
  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-type:${auth.orgId}:${id}`}, 0))`
      const actor = await requireCurrentPharmacyPromotionAdministrator(tx, auth)
      const current = await tx.mtmPharmacyPromotionType.findFirst({ where: { id, organizationId: auth.orgId } })
      if (!current) return { notFound: true as const }
      const requestHash = pharmacyPromotionHash({ id, from: "DRAFT", to: "ACTIVE" })
      if (current.status === "ACTIVE") {
        const activationEvent = await tx.mtmPharmacyPromotionEvent.findFirst({
          where: {
            organizationId: auth.orgId,
            sourceKey: `promotion-type:${id}:activated`,
          },
          select: { requestHash: true },
        })
        if (!activationEvent) throw new Error("MTM_PHARMACY_TYPE_ACTIVATE_AUDIT_MISSING")
        if (activationEvent.requestHash !== requestHash) {
          throw new Error("MTM_PHARMACY_TYPE_ACTIVATE_REPLAY_CONFLICT")
        }
        return { type: current, idempotent: true }
      }
      if (current.status !== "DRAFT") throw new Error("MTM_PHARMACY_TYPE_STATE_CONFLICT")
      const changed = await tx.mtmPharmacyPromotionType.updateMany({
        where: { id, organizationId: auth.orgId, status: "DRAFT" },
        data: { status: "ACTIVE" },
      })
      if (changed.count !== 1) throw new Error("MTM_PHARMACY_TYPE_ACTIVATE_CONFLICT")
      const updated = await tx.mtmPharmacyPromotionType.findFirst({
        where: { id, organizationId: auth.orgId },
      })
      if (!updated || updated.status !== "ACTIVE") {
        throw new Error("MTM_PHARMACY_TYPE_ACTIVATE_CONFLICT")
      }
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          promotionTypeId: id,
          eventType: "PROMOTION_TYPE_ACTIVATED",
          fromState: current.status,
          toState: "ACTIVE",
          actorAgentId: actor.agentId,
          actorUserId: auth.userId,
          sourceKey: `promotion-type:${id}:activated`,
          requestHash,
          payload: { typeId: id, code: current.code },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "PHARMACY_PROMOTION_TYPE_ACTIVATE",
          entity: "mtm_pharmacy_promotion_type",
          entityId: id,
          metadataKind: "pharmacy_promotion_configuration",
          oldData: { status: current.status },
          newData: { status: "ACTIVE" },
        },
      })
      return { type: updated, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if ("notFound" in result) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { type: result.type }, idempotent: result.idempotent })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_TYPE_ACTIVATE_FAILED"
    if (code === PHARMACY_PROMOTION_ADMIN_REQUIRED) {
      return NextResponse.json({ error: "Web administrator access required", code }, { status: 403 })
    }
    if (
      code === "MTM_PHARMACY_TYPE_STATE_CONFLICT"
      || code === "MTM_PHARMACY_TYPE_ACTIVATE_CONFLICT"
      || code === "MTM_PHARMACY_TYPE_ACTIVATE_AUDIT_MISSING"
      || code === "MTM_PHARMACY_TYPE_ACTIVATE_REPLAY_CONFLICT"
    ) {
      return NextResponse.json({ error: "Promotion type cannot be activated from its current state", code }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Promotion type changed concurrently", code: "MTM_PHARMACY_TYPE_ACTIVATE_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotion-types activate]", error)
    return NextResponse.json({ error: "Failed to activate promotion type", code: "MTM_PHARMACY_TYPE_ACTIVATE_FAILED" }, { status: 500 })
  }
})
