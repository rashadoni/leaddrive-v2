import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { OrganizationSavedViewSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"

const ENTITY_TYPE = "mtm_organizations"

export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  const views = await prisma.savedView.findMany({
    where: {
      organizationId: auth.orgId,
      entityType: ENTITY_TYPE,
      OR: [{ userId: auth.userId }, { isShared: true }],
    },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, filters: true, isDefault: true, isShared: true, userId: true },
  })
  return NextResponse.json({
    success: true,
    data: {
      views: views.map((view) => ({
        ...view,
        canDelete: view.userId === auth.userId,
      })),
    },
  })
})

export const POST = withRouteFieldRlsAuth("read", async (req, auth) => {
  const parsed = parseBody(OrganizationSavedViewSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  try {
    const view = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (body.isDefault) {
        await tx.savedView.updateMany({
          where: { organizationId: auth.orgId, userId: auth.userId, entityType: ENTITY_TYPE, isDefault: true },
          data: { isDefault: false },
        })
      }
      return tx.savedView.create({
        data: {
          organizationId: auth.orgId,
          userId: auth.userId,
          entityType: ENTITY_TYPE,
          name: body.name,
          filters: { ...body.filters, columns: body.columns } as Prisma.InputJsonValue,
          isDefault: body.isDefault,
        },
        select: { id: true, name: true, filters: true, isDefault: true, isShared: true, userId: true },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      action: "ORGANIZATION_VIEW_CREATE",
      entity: "saved_view",
      entityId: view.id,
      metadataKind: "organization_saved_view",
      newData: { name: view.name, isDefault: view.isDefault },
      req,
    }).catch((error) => console.warn("[MTM/organizations/views POST] audit failed", error))
    return NextResponse.json({ success: true, data: { view } }, { status: 201 })
  } catch (error) {
    console.error("[MTM/organizations/views POST]", error)
    return NextResponse.json({ error: "Failed to save organization view" }, { status: 500 })
  }
})
