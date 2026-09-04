import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const deleted = await prisma.$transaction(async (tx) => {
    const category = await tx.kbCategory.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true, parentId: true, sortOrder: true },
    })
    if (!category) return null

    const affectedArticles = await tx.kbArticle.findMany({
      where: { organizationId: orgId, categoryId: id },
      select: { id: true },
    })
    const childCategories = await tx.kbCategory.findMany({
      where: { organizationId: orgId, parentId: id },
      select: { id: true },
    })
    await tx.kbArticle.updateMany({
      where: { organizationId: orgId, categoryId: id },
      data: { categoryId: null },
    })
    await tx.kbCategory.updateMany({
      where: { organizationId: orgId, parentId: id },
      data: { parentId: null },
    })
    const result = await tx.kbCategory.deleteMany({
      where: { id, organizationId: orgId },
    })
    if (result.count === 0) return null

    return {
      category,
      articleIds: affectedArticles.map((article) => article.id),
      childCategoryIds: childCategories.map((category) => category.id),
    }
  })

  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: { deleted } })
})
