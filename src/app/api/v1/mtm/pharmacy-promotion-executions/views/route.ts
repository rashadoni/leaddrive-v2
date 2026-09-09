import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  PHARMACY_PROMOTION_EXECUTION_VIEW_ENTITY,
  PharmacyPromotionSavedViewCreateSchema,
  canonicalPromotionSavedFilters,
  canonicalStoredPromotionSavedFilters,
  pharmacyPromotionSavedViewSelect,
  publicPromotionSavedView,
  savedFiltersJson,
} from "./_contract"

function validationResponse(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return NextResponse.json({
    error: "Validation failed",
    code: "MTM_PHARMACY_SAVED_VIEW_INVALID",
    details: issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  }, { status: 400 })
}

export const GET = withMtmRlsAuth("mtm", "read", async (_req, auth) => {
  const views = await prisma.savedView.findMany({
    where: {
      organizationId: auth.orgId,
      userId: auth.userId,
      entityType: PHARMACY_PROMOTION_EXECUTION_VIEW_ENTITY,
      isShared: false,
    },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: pharmacyPromotionSavedViewSelect,
  })

  // RLS and the Prisma predicate are the primary boundary. The projection
  // check is deliberate defence-in-depth against future query refactors.
  const ownedViews = views.flatMap((view: Parameters<typeof publicPromotionSavedView>[0]) => {
    if (
      view.organizationId !== auth.orgId
      || view.userId !== auth.userId
      || view.isShared
    ) return []
    const filters = canonicalStoredPromotionSavedFilters(view.filters)
    if (!filters) return []
    return [{ ...publicPromotionSavedView(view), filters }]
  })

  return NextResponse.json(
    { success: true, data: { views: ownedViews } },
    { headers: { "Cache-Control": "private, no-store" } },
  )
})

export const POST = withMtmRlsAuth("mtm", "read", async (req, auth) => {
  const parsed = PharmacyPromotionSavedViewCreateSchema.safeParse(
    await req.json().catch(() => null),
  )
  if (!parsed.success) return validationResponse(parsed.error.issues)

  const canonical = canonicalPromotionSavedFilters(parsed.data.filters)
  if (!canonical.ok) {
    return NextResponse.json({
      error: "Validation failed",
      code: canonical.code,
      details: [{ path: `filters.${canonical.field}`, message: "Invalid promotion filter" }],
    }, { status: 400 })
  }

  try {
    const view = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (parsed.data.isDefault) {
        await tx.savedView.updateMany({
          where: {
            organizationId: auth.orgId,
            userId: auth.userId,
            entityType: PHARMACY_PROMOTION_EXECUTION_VIEW_ENTITY,
            isDefault: true,
          },
          data: { isDefault: false },
        })
      }
      return tx.savedView.create({
        data: {
          organizationId: auth.orgId,
          userId: auth.userId,
          entityType: PHARMACY_PROMOTION_EXECUTION_VIEW_ENTITY,
          name: parsed.data.name,
          filters: savedFiltersJson(canonical.filters),
          isDefault: parsed.data.isDefault,
          isShared: false,
          sortOrder: parsed.data.sortOrder,
        },
        select: pharmacyPromotionSavedViewSelect,
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      action: "PHARMACY_PROMOTION_VIEW_CREATE",
      entity: "saved_view",
      entityId: view.id,
      metadataKind: "pharmacy_promotion_execution_saved_view",
      newData: { name: view.name, isDefault: view.isDefault },
      req,
    }).catch((error) => console.warn("[MTM/pharmacy-promotion-executions/views POST] audit failed", error))

    return NextResponse.json({
      success: true,
      data: { view: publicPromotionSavedView(view) },
    }, { status: 201 })
  } catch (error) {
    console.error("[MTM/pharmacy-promotion-executions/views POST]", error)
    return NextResponse.json({ error: "Failed to save promotion view" }, { status: 500 })
  }
})
