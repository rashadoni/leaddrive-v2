import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canManageMtmProductGroup, resolveMtmProductAccess } from "@/lib/mtm/product-access"
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

export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  const access = await resolveMtmProductAccess(auth)
  if (!access) {
    return NextResponse.json({ error: "MTM access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }
  const visibleGroupIds = [...access.visibleIds]
  const [products, deleted] = await Promise.all([
    prisma.mtmProduct.findMany({
      where: { organizationId: auth.orgId, groupId: { in: visibleGroupIds }, deletedAt: null },
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
        viewers: { select: { agentId: true } },
        _count: { select: { presentationSessions: true } },
      },
    }),
    // A deleted presentation leaves the list, not the history: its showings
    // still count on the group's «Vizitdə».
    prisma.mtmProduct.findMany({
      where: { organizationId: auth.orgId, groupId: { in: visibleGroupIds }, deletedAt: { not: null } },
      select: { groupId: true, _count: { select: { presentationSessions: true } } },
    }),
  ])
  const deletedShowings: Record<string, number> = {}
  for (const product of deleted as Array<{ groupId: string; _count: { presentationSessions: number } }>) {
    deletedShowings[product.groupId] = (deletedShowings[product.groupId] ?? 0) + product._count.presentationSessions
  }
  return NextResponse.json({
    success: true,
    data: {
      products: (products as Array<{ groupId: string; viewers: Array<{ agentId: string }> }>).map(({ viewers, ...product }) => ({
        ...product,
        viewerAgentIds: viewers.map((viewer) => viewer.agentId),
        canManage: canManageMtmProductGroup(access, product.groupId),
      })),
      deletedShowings,
    },
  })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const parsed = CreateProductSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid product", details: parsed.error.flatten() }, { status: 400 })
  }
  const access = await resolveMtmProductAccess(auth)
  if (!access || !canManageMtmProductGroup(access, parsed.data.groupId)) {
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
    // A live presentation of the group already has this name (a deleted one does not count).
    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "A presentation with this name already exists in the group", code: "MTM_PRODUCT_NAME_TAKEN" }, { status: 409 })
    }
    console.error("[MTM/products POST]", error)
    return NextResponse.json({ error: "Failed to create product", code: "MTM_PRODUCT_CREATE_FAILED" }, { status: 500 })
  }
})
