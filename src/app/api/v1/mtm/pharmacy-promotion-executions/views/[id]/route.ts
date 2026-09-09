import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  PHARMACY_PROMOTION_EXECUTION_VIEW_ENTITY,
  PharmacyPromotionSavedViewUpdateSchema,
  canonicalPromotionSavedFilters,
  pharmacyPromotionSavedViewSelect,
  publicPromotionSavedView,
  savedFiltersJson,
} from "../_contract"

type RouteContext = { params: Promise<{ id: string }> }

function ownedViewWhere(id: string, organizationId: string, userId: string) {
  return {
    id,
    organizationId,
    userId,
    entityType: PHARMACY_PROMOTION_EXECUTION_VIEW_ENTITY,
    isShared: false,
  } as const
}

function validationResponse(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return NextResponse.json({
    error: "Validation failed",
    code: "MTM_PHARMACY_SAVED_VIEW_INVALID",
    details: issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  }, { status: 400 })
}

export const PATCH = withMtmRlsAuth(
  "mtm",
  "read",
  async (req, auth, { params }: RouteContext) => {
    const { id } = await params
    const parsed = PharmacyPromotionSavedViewUpdateSchema.safeParse(
      await req.json().catch(() => null),
    )
    if (!parsed.success) return validationResponse(parsed.error.issues)

    const canonical = parsed.data.filters === undefined
      ? null
      : canonicalPromotionSavedFilters(parsed.data.filters)
    if (canonical && !canonical.ok) {
      return NextResponse.json({
        error: "Validation failed",
        code: canonical.code,
        details: [{ path: `filters.${canonical.field}`, message: "Invalid promotion filter" }],
      }, { status: 400 })
    }

    const ownedWhere = ownedViewWhere(id, auth.orgId, auth.userId)
    try {
      const existing = await prisma.savedView.findFirst({
        where: ownedWhere,
        select: pharmacyPromotionSavedViewSelect,
      })
      if (
        !existing
        || existing.organizationId !== auth.orgId
        || existing.userId !== auth.userId
        || existing.isShared
      ) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }

      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (parsed.data.isDefault === true) {
          await tx.savedView.updateMany({
            where: {
              organizationId: auth.orgId,
              userId: auth.userId,
              entityType: PHARMACY_PROMOTION_EXECUTION_VIEW_ENTITY,
              isDefault: true,
              NOT: { id },
            },
            data: { isDefault: false },
          })
        }
        const changed = await tx.savedView.updateMany({
          where: ownedWhere,
          data: {
            ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
            ...(canonical?.ok ? { filters: savedFiltersJson(canonical.filters) } : {}),
            ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
            ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
          },
        })
        if (changed.count !== 1) return null
        return tx.savedView.findFirst({
          where: ownedWhere,
          select: pharmacyPromotionSavedViewSelect,
        })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

      if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 })

      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        action: "PHARMACY_PROMOTION_VIEW_UPDATE",
        entity: "saved_view",
        entityId: id,
        metadataKind: "pharmacy_promotion_execution_saved_view",
        oldData: { name: existing.name, isDefault: existing.isDefault },
        newData: { name: updated.name, isDefault: updated.isDefault },
        req,
      }).catch((error) => console.warn("[MTM/pharmacy-promotion-executions/views PATCH] audit failed", error))

      return NextResponse.json({
        success: true,
        data: { view: publicPromotionSavedView(updated) },
      })
    } catch (error) {
      console.error("[MTM/pharmacy-promotion-executions/views PATCH]", error)
      return NextResponse.json({ error: "Failed to update promotion view" }, { status: 500 })
    }
  },
)

export const DELETE = withMtmRlsAuth(
  "mtm",
  "read",
  async (req, auth, { params }: RouteContext) => {
    const { id } = await params
    const ownedWhere = ownedViewWhere(id, auth.orgId, auth.userId)
    try {
      const existing = await prisma.savedView.findFirst({
        where: ownedWhere,
        select: pharmacyPromotionSavedViewSelect,
      })
      if (
        !existing
        || existing.organizationId !== auth.orgId
        || existing.userId !== auth.userId
        || existing.isShared
      ) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }

      const deleted = await prisma.savedView.deleteMany({ where: ownedWhere })
      if (deleted.count !== 1) return NextResponse.json({ error: "Not found" }, { status: 404 })

      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        action: "PHARMACY_PROMOTION_VIEW_DELETE",
        entity: "saved_view",
        entityId: id,
        metadataKind: "pharmacy_promotion_execution_saved_view",
        oldData: { name: existing.name, isDefault: existing.isDefault },
        req,
      }).catch((error) => console.warn("[MTM/pharmacy-promotion-executions/views DELETE] audit failed", error))

      return NextResponse.json({ success: true })
    } catch (error) {
      console.error("[MTM/pharmacy-promotion-executions/views DELETE]", error)
      return NextResponse.json({ error: "Failed to delete promotion view" }, { status: 500 })
    }
  },
)
