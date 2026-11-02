import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { canManageMtmProductGroup, resolveMtmProductAccess } from "@/lib/mtm/product-access"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

const Ids = z.array(z.string().trim().min(1).max(128)).max(500)

/**
 * The change «Yadda saxla» sends: for every chosen presentation, these agents
 * start seeing it and those stop. An agent the manager did not touch is in
 * neither list, so his half-ticked state («sees only Forlaks») survives a save
 * of two presentations.
 */
const ViewersSchema = z.object({
  productIds: Ids.min(1).max(200),
  add: Ids,
  remove: Ids,
}).strict().superRefine((value, context) => {
  const added = new Set(value.add)
  if (value.remove.some((agentId) => added.has(agentId))) {
    context.addIssue({ code: "custom", path: ["remove"], message: "An agent cannot be added and removed at once" })
  }
})

/**
 * PUT /api/v1/mtm/products/viewers — who sees the chosen presentations in the
 * app (owner, 2026-10-21: «выбрать несколько презентаций и указать, для какого
 * агента будут видны… и нет сохранения»).
 *
 * Every presentation must be live and in a group the user manages, and every
 * added agent an active field agent of the organization — otherwise nothing is
 * written. Removing is allowed for any card of the organization, so somebody
 * who has left can still be taken off.
 */
export const PUT = withRouteFieldRlsAuth("write", async (req, auth) => {
  const parsed = ViewersSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid presentation viewers", details: parsed.error.flatten() }, { status: 400 })
  }
  const productIds = [...new Set(parsed.data.productIds)]
  const add = [...new Set(parsed.data.add)]
  const remove = [...new Set(parsed.data.remove)]

  const access = await resolveMtmProductAccess(auth)
  if (!access) {
    return NextResponse.json({ error: "MTM access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }
  const products: Array<{ id: string; groupId: string; name: string }> = await prisma.mtmProduct.findMany({
    where: { organizationId: auth.orgId, id: { in: productIds }, deletedAt: null },
    select: { id: true, groupId: true, name: true },
  })
  const visible = products.filter((product) => access.visibleIds.has(product.groupId))
  if (visible.length !== productIds.length) {
    return NextResponse.json({ error: "Presentation not found", code: "MTM_PRODUCT_NOT_FOUND" }, { status: 404 })
  }
  if (visible.some((product) => !canManageMtmProductGroup(access, product.groupId))) {
    return NextResponse.json({ error: "Group is outside your scope", code: "MTM_PRODUCT_FORBIDDEN" }, { status: 403 })
  }

  const agentIds = [...add, ...remove]
  const agents: Array<{ id: string; role: string; status: string }> = agentIds.length
    ? await prisma.mtmAgent.findMany({
      where: { organizationId: auth.orgId, id: { in: agentIds } },
      select: { id: true, role: true, status: true },
    })
    : []
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const invalid = [
    ...add.filter((agentId) => {
      const agent = agentById.get(agentId)
      return !agent || agent.role !== "AGENT" || agent.status !== "ACTIVE"
    }),
    ...remove.filter((agentId) => !agentById.has(agentId)),
  ]
  if (invalid.length > 0) {
    return NextResponse.json({ error: "One or more agents are invalid", code: "MTM_PRODUCT_VIEWER_INVALID" }, { status: 422 })
  }

  try {
    const viewers: Array<{ productId: string; agentId: string }> = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (remove.length > 0) {
        await tx.mtmProductViewer.deleteMany({
          where: { organizationId: auth.orgId, productId: { in: productIds }, agentId: { in: remove } },
        })
      }
      if (add.length > 0) {
        await tx.mtmProductViewer.createMany({
          data: productIds.flatMap((productId) => add.map((agentId) => ({
            organizationId: auth.orgId,
            productId,
            agentId,
            assignedByUserId: auth.userId || null,
          }))),
          skipDuplicates: true,
        })
      }
      return tx.mtmProductViewer.findMany({
        where: { organizationId: auth.orgId, productId: { in: productIds } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { productId: true, agentId: true },
      })
    })

    if (add.length + remove.length > 0) {
      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: access.actor.agentId,
        action: "FIELD_PRODUCT_VIEWERS_UPDATE",
        entity: "product",
        entityId: productIds.length === 1 ? productIds[0] : null,
        metadataKind: "product_presentation_viewers",
        newData: { productIds, productNames: visible.map((product) => product.name), added: add, removed: remove },
        req,
      }).catch((error) => console.warn("[MTM/products/viewers PUT] audit failed", error))
    }

    return NextResponse.json({
      success: true,
      data: {
        products: productIds.map((productId) => ({
          id: productId,
          viewerAgentIds: viewers.filter((viewer) => viewer.productId === productId).map((viewer) => viewer.agentId),
        })),
      },
    })
  } catch (error) {
    console.error("[MTM/products/viewers PUT]", error)
    return NextResponse.json({ error: "Failed to save who sees the presentations", code: "MTM_PRODUCT_VIEWERS_FAILED" }, { status: 500 })
  }
})
