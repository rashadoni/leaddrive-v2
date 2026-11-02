import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { canManageMtmProductGroup, resolveMtmProductAccess } from "@/lib/mtm/product-access"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * DELETE /api/v1/mtm/products/:id — «Sil» on a presentation (owner,
 * 2026-10-21: «тут нет удаления презентации»).
 *
 * The row stays: every showing on a visit references it (ON DELETE RESTRICT)
 * and the visit history reads its name from it. Deleted means gone from the
 * catalog, from every phone and from the file download; the showings keep
 * counting where they happened. `isActive` goes false with it, so the previous
 * build — which knows no `deletedAt` — also hides it from the app.
 */
export const DELETE = withRouteFieldRlsAuth<RouteContext>("delete", async (req, auth, { params }) => {
  const { id } = await params
  if (!id || id.length > 128) return NextResponse.json({ error: "Invalid product id" }, { status: 400 })
  const access = await resolveMtmProductAccess(auth)
  if (!access) {
    return NextResponse.json({ error: "MTM access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }
  const product: {
    id: string
    groupId: string
    name: string
    deletedAt: Date | null
    _count: { presentationSessions: number }
  } | null = await prisma.mtmProduct.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, groupId: true, name: true, deletedAt: true, _count: { select: { presentationSessions: true } } },
  })
  // A presentation outside the user's groups is answered as one that does not exist.
  if (!product || !access.visibleIds.has(product.groupId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (!canManageMtmProductGroup(access, product.groupId)) {
    return NextResponse.json({ error: "Group is outside your scope", code: "MTM_PRODUCT_FORBIDDEN" }, { status: 403 })
  }
  const result = { id: product.id, name: product.name, showings: product._count.presentationSessions }
  if (product.deletedAt) return NextResponse.json({ success: true, data: result, idempotent: true })

  // Only a live row is deleted: of two presses at once, one deletes and one is told it already was.
  const deleted = await prisma.mtmProduct.updateMany({
    where: { id: product.id, organizationId: auth.orgId, deletedAt: null },
    data: { deletedAt: new Date(), deletedByUserId: auth.userId || null, isActive: false },
  })
  if (deleted.count === 0) return NextResponse.json({ success: true, data: result, idempotent: true })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: access.actor.agentId,
    action: "FIELD_PRODUCT_DELETE",
    entity: "product",
    entityId: product.id,
    metadataKind: "product_presentation_deleted",
    oldData: { name: product.name, groupId: product.groupId },
    newData: { name: product.name, showings: result.showings },
    req,
  }).catch((error) => console.warn("[MTM/products DELETE] audit failed", error))

  return NextResponse.json({ success: true, data: result, idempotent: false })
})
