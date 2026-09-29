import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getPortalUser } from "@/lib/portal-auth"
import { PAGE_SIZE } from "@/lib/constants"

export async function GET(req: NextRequest) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const articleId = searchParams.get("id")

  // RLS: org comes from the verified portal JWT — whole handler runs tenant-scoped.
  return await runWithTenant(user.organizationId, async () => {

  // Single article view — return full content and increment viewCount
  if (articleId) {
    const article = await prisma.kbArticle.findFirst({
      where: {
        id: articleId,
        organizationId: user.organizationId,
        status: "published",
      },
      include: { category: { select: { id: true, name: true } } },
    })
    if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 })

    await prisma.kbArticle.update({
      where: { id: article.id },
      data: { viewCount: { increment: 1 } },
    })

    return NextResponse.json({
      success: true,
      data: {
        id: article.id,
        title: article.title,
        content: article.content,
        tags: article.tags,
        category: article.category,
        viewCount: article.viewCount + 1,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      },
    })
  }

  // List view — return truncated content
  const articles = await prisma.kbArticle.findMany({
    where: {
      organizationId: user.organizationId,
      status: "published",
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE.DEFAULT,
    select: {
      id: true,
      title: true,
      content: true,
      tags: true,
      viewCount: true,
      createdAt: true,
      updatedAt: true,
      category: { select: { id: true, name: true } },
    },
  })

  const data = articles.map((article) => ({
    id: article.id,
    title: article.title,
    content: article.content ? article.content.slice(0, 200) : "",
    tags: article.tags,
    category: article.category,
    viewCount: article.viewCount,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  }))

  return NextResponse.json({ success: true, data })
  }) // end runWithTenant (tenant-scoped handler body)
}
