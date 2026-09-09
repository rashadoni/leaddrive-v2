import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  PHARMACY_PROMOTION_ADMIN_REQUIRED,
  requireCurrentPharmacyPromotionAdministrator,
  resolvePharmacyPromotionAdministrator,
} from "@/lib/mtm/pharmacy-promotion-admin"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"
import { PharmacyPromotionRootCreateSchema } from "@/lib/mtm/pharmacy-promotion-validators"

function forbidden() {
  return NextResponse.json({ error: "Web administrator access required", code: "MTM_PHARMACY_ADMIN_REQUIRED" }, { status: 403 })
}

export const GET = withMtmRlsAuth("mtm", "read", async (_req, auth) => {
  if (!await resolvePharmacyPromotionAdministrator(prisma, auth)) return forbidden()
  const promotions = await prisma.mtmPharmacyPromotion.findMany({
    where: { organizationId: auth.orgId, archivedAt: null },
    include: {
      versions: {
        orderBy: { revision: "desc" },
        include: {
          type: { select: { id: true, code: true, nameRu: true, nameAz: true, nameEn: true, status: true } },
          formula: { select: { id: true, code: true, version: true, status: true, definitionHash: true } },
          approvalPolicy: { select: { id: true, code: true, version: true, status: true, definitionHash: true } },
          _count: { select: { targets: true } },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { code: "asc" }],
  })
  return NextResponse.json({ success: true, data: { promotions } })
})

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  if (!await resolvePharmacyPromotionAdministrator(prisma, auth)) return forbidden()
  const parsed = PharmacyPromotionRootCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid campaign", code: "MTM_PHARMACY_PROMOTION_INVALID" }, { status: 400 })
  }
  const body = parsed.data
  const requestHash = pharmacyPromotionHash(body)
  try {
    const promotion = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const actor = await requireCurrentPharmacyPromotionAdministrator(tx, auth)
      const created = await tx.mtmPharmacyPromotion.create({
        data: { organizationId: auth.orgId, code: body.code, createdByUserId: auth.userId },
      })
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          promotionId: created.id,
          eventType: "PROMOTION_CREATED",
          toState: "DRAFT",
          actorAgentId: actor.agentId,
          actorUserId: auth.userId,
          sourceKey: `promotion:${created.id}:created`,
          requestHash,
          payload: { code: created.code },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "PHARMACY_PROMOTION_CREATE",
          entity: "mtm_pharmacy_promotion",
          entityId: created.id,
          metadataKind: "pharmacy_promotion_configuration",
          newData: { code: created.code },
        },
      })
      return created
    })
    return NextResponse.json({ success: true, data: { promotion } }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === PHARMACY_PROMOTION_ADMIN_REQUIRED) return forbidden()
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Campaign code already exists", code: "MTM_PHARMACY_PROMOTION_CONFLICT" }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Campaign changed concurrently", code: "MTM_PHARMACY_PROMOTION_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotions POST]", error)
    return NextResponse.json({ error: "Failed to create campaign", code: "MTM_PHARMACY_PROMOTION_CREATE_FAILED" }, { status: 500 })
  }
})
