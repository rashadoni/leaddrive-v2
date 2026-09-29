import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const createSchema = z.object({
  restoreId: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(100),
  parentId: z.string().optional(),
  sortOrder: z.number().optional(),
  restoreArticleIds: z.array(z.string().min(1)).max(10000).optional(),
  restoreChildCategoryIds: z.array(z.string().min(1)).max(10000).optional(),
})

export const GET = withRls(async (_req, { orgId }) => {
  const categories = await prisma.kbCategory.findMany({
    where: { organizationId: orgId },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { articles: true } } },
  })

  return NextResponse.json({ success: true, data: categories })
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const {
    restoreId,
    restoreArticleIds = [],
    restoreChildCategoryIds = [],
    ...categoryData
  } = parsed.data

  if (categoryData.parentId) {
    const parent = await prisma.kbCategory.findFirst({
      where: { id: categoryData.parentId, organizationId: orgId },
      select: { id: true },
    })
    if (!parent) return NextResponse.json({ error: "Parent category not found" }, { status: 400 })
  }

  const category = await prisma.$transaction(async (tx) => {
    const created = await tx.kbCategory.create({
      data: { ...(restoreId ? { id: restoreId } : {}), organizationId: orgId, ...categoryData },
    })
    if (restoreArticleIds.length > 0) {
      await tx.kbArticle.updateMany({
        where: {
          organizationId: orgId,
          id: { in: restoreArticleIds },
          categoryId: null,
        },
        data: { categoryId: created.id },
      })
    }
    if (restoreChildCategoryIds.length > 0) {
      await tx.kbCategory.updateMany({
        where: {
          organizationId: orgId,
          id: { in: restoreChildCategoryIds },
          parentId: null,
        },
        data: { parentId: created.id },
      })
    }
    return created
  })

  return NextResponse.json({ success: true, data: category }, { status: 201 })
})
