import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { expandVisibleProductGroupIds } from "@/lib/mtm/product-group-access"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

const PRESENTATION_MIME_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const

const CreateProductSchema = z.object({
  groupId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).nullish(),
  documentId: z.string().trim().min(1).max(128),
  presentationVersion: z.string().trim().max(80).nullish(),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
}).strict()

async function resolveProductAccess(auth: {
  orgId: string
  userId: string
  role: string
  agentId?: string | null
}) {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return null

  const groups = await prisma.mtmProductGroup.findMany({
    where: { organizationId: auth.orgId },
    select: {
      id: true,
      parentId: true,
      members: {
        where: { agentId: actor.agentId ?? "__no_agent__" },
        select: { role: true },
      },
    },
  })
  const visibleIds = actor.role === "ADMIN"
    ? new Set(groups.map((group) => group.id))
    : expandVisibleProductGroupIds(groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      hasDirectMembership: group.members.length > 0,
    })))
  const managedIds = actor.role === "ADMIN"
    ? visibleIds
    : expandVisibleProductGroupIds(groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      hasDirectMembership: group.members.some((member) => member.role === "MANAGER"),
    })))
  return { actor, visibleIds, managedIds }
}

export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  const access = await resolveProductAccess(auth)
  if (!access) {
    return NextResponse.json({ error: "MTM access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }
  const products = await prisma.mtmProduct.findMany({
    where: { organizationId: auth.orgId, groupId: { in: [...access.visibleIds] } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      group: { select: { id: true, name: true, parentId: true } },
      document: {
        select: {
          id: true,
          title: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          deletedAt: true,
        },
      },
      _count: { select: { presentationSessions: true } },
    },
  })
  return NextResponse.json({
    success: true,
    data: {
      products: products.map((product) => ({
        ...product,
        canManage: access.managedIds.has(product.groupId),
      })),
    },
  })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const parsed = CreateProductSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid product", details: parsed.error.flatten() }, { status: 400 })
  }
  const access = await resolveProductAccess(auth)
  if (
    !access ||
    !["ADMIN", "MANAGER", "SUPERVISOR"].includes(access.actor.role) ||
    !access.managedIds.has(parsed.data.groupId)
  ) {
    return NextResponse.json({ error: "Group is outside your scope", code: "MTM_PRODUCT_FORBIDDEN" }, { status: 403 })
  }

  const document = await prisma.mtmDocument.findFirst({
    where: {
      id: parsed.data.documentId,
      organizationId: auth.orgId,
      deletedAt: null,
      mimeType: { in: [...PRESENTATION_MIME_TYPES] },
    },
    select: { id: true },
  })
  if (!document) {
    return NextResponse.json({
      error: "A PDF or PowerPoint presentation file is required",
      code: "MTM_PRODUCT_DOCUMENT_INVALID",
    }, { status: 422 })
  }

  try {
    const product = await prisma.mtmProduct.create({
      data: {
        organizationId: auth.orgId,
        groupId: parsed.data.groupId,
        name: parsed.data.name,
        description: parsed.data.description || null,
        documentId: document.id,
        presentationVersion: parsed.data.presentationVersion || null,
        sortOrder: parsed.data.sortOrder,
      },
      include: {
        group: { select: { id: true, name: true } },
        document: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
      },
    })
    return NextResponse.json({ success: true, data: product }, { status: 201 })
  } catch (error) {
    console.error("[MTM/products POST]", error)
    return NextResponse.json({ error: "Failed to create product", code: "MTM_PRODUCT_CREATE_FAILED" }, { status: 500 })
  }
})
