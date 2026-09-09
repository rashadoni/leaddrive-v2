import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  PHARMACY_PROMOTION_ADMIN_REQUIRED,
  requireCurrentPharmacyPromotionAdministrator,
  resolvePharmacyPromotionAdministrator,
} from "@/lib/mtm/pharmacy-promotion-admin"
import { PharmacyPromotionTypeCreateSchema } from "@/lib/mtm/pharmacy-promotion-validators"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"

function forbidden() {
  return NextResponse.json({ error: "Web administrator access required", code: "MTM_PHARMACY_ADMIN_REQUIRED" }, { status: 403 })
}

export const GET = withMtmRlsAuth("mtm", "read", async (_req, auth) => {
  if (!await resolvePharmacyPromotionAdministrator(prisma, auth)) return forbidden()
  const types = await prisma.mtmPharmacyPromotionType.findMany({
    where: { organizationId: auth.orgId },
    orderBy: [{ status: "asc" }, { code: "asc" }],
  })
  return NextResponse.json({ success: true, data: { types } })
})

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  if (!await resolvePharmacyPromotionAdministrator(prisma, auth)) return forbidden()
  const parsed = PharmacyPromotionTypeCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid promotion type",
      code: "MTM_PHARMACY_TYPE_INVALID",
    }, { status: 400 })
  }
  const body = parsed.data
  const requestHash = pharmacyPromotionHash(body)
  try {
    const type = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const actor = await requireCurrentPharmacyPromotionAdministrator(tx, auth)
      const created = await tx.mtmPharmacyPromotionType.create({
        data: { organizationId: auth.orgId, ...body },
      })
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          promotionTypeId: created.id,
          eventType: "PROMOTION_TYPE_CREATED",
          toState: "DRAFT",
          actorAgentId: actor.agentId,
          actorUserId: auth.userId,
          sourceKey: `promotion-type:${created.id}:created`,
          requestHash,
          payload: { typeId: created.id, code: created.code },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "PHARMACY_PROMOTION_TYPE_CREATE",
          entity: "mtm_pharmacy_promotion_type",
          entityId: created.id,
          metadataKind: "pharmacy_promotion_configuration",
          newData: { code: created.code, status: created.status },
        },
      })
      return created
    })
    return NextResponse.json({ success: true, data: { type } }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === PHARMACY_PROMOTION_ADMIN_REQUIRED) return forbidden()
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Promotion type code already exists", code: "MTM_PHARMACY_TYPE_CONFLICT" }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Promotion type changed concurrently", code: "MTM_PHARMACY_TYPE_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotion-types POST]", error)
    return NextResponse.json({ error: "Failed to create promotion type", code: "MTM_PHARMACY_TYPE_CREATE_FAILED" }, { status: 500 })
  }
})
