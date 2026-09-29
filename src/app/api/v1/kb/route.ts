import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const createArticleSchema = z.object({
  restoreId: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(500),
  content: z.string().optional(),
  categoryId: z.string().optional(),
  status: z.enum(["draft", "published"]).optional(),
  tags: z.array(z.string()).optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const search = (searchParams.get("search") || "").trim()
  const requestedPage = Number.parseInt(searchParams.get("page") || "1", 10)
  const requestedLimit = Number.parseInt(searchParams.get("limit") || "50", 10)
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1
  const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, requestedLimit)) : 50
  const status = searchParams.get("status")
  const categoryId = searchParams.get("categoryId")
  const includeSummary = searchParams.get("summary") === "1"

  try {
    const where = {
      organizationId: orgId,
      ...(search ? {
        OR: [
          { title: { contains: search, mode: "insensitive" as const } },
          { content: { contains: search, mode: "insensitive" as const } },
          { tags: { has: search } },
        ],
      } : {}),
      ...(["published", "draft"].includes(status || "") ? { status: status as "published" | "draft" } : {}),
      ...(categoryId === "uncategorized"
        ? { categoryId: null }
        : categoryId
          ? { categoryId }
          : {}),
    }

    const [articles, total, statusGroups, viewAggregate, categoryGroups] = await Promise.all([
      prisma.kbArticle.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { category: true },
      }),
      prisma.kbArticle.count({ where }),
      includeSummary
        ? prisma.kbArticle.groupBy({
            by: ["status"],
            where: { organizationId: orgId },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      includeSummary
        ? prisma.kbArticle.aggregate({
            where: { organizationId: orgId },
            _sum: { viewCount: true },
          })
        : Promise.resolve(null),
      includeSummary
        ? prisma.kbArticle.groupBy({
            by: ["categoryId", "status"],
            where: { organizationId: orgId },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ])

    const countFor = (key: string) =>
      statusGroups.find((group) => group.status === key)?._count._all ?? 0

    return NextResponse.json({
      success: true,
      data: {
        articles,
        total,
        page,
        limit,
        search,
        ...(includeSummary ? {
          summary: {
            total,
            published: countFor("published"),
            draft: countFor("draft"),
            views: viewAggregate?._sum.viewCount ?? 0,
            categories: categoryGroups.map((group) => ({
              categoryId: group.categoryId,
              status: group.status,
              count: group._count._all,
            })),
          },
        } : {}),
      },
    })
  } catch (e) {
    console.error("[kb GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createArticleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    if (parsed.data.categoryId) {
      const category = await prisma.kbCategory.findFirst({
        where: { id: parsed.data.categoryId, organizationId: orgId },
        select: { id: true },
      })
      if (!category) {
        return NextResponse.json({ error: "Category not found" }, { status: 400 })
      }
    }

    const { restoreId, ...articleData } = parsed.data
    const article = await prisma.kbArticle.create({
      data: { ...(restoreId ? { id: restoreId } : {}), organizationId: orgId, ...articleData },
    })

    // Auto-embed for vector search (non-blocking)
    if (articleData.status === "published") {
      import("@/lib/ai/embeddings").then(({ embedKbArticle }) =>
        embedKbArticle(article.id, orgId, articleData.title, articleData.content || "")
      ).catch(() => {})
    }

    return NextResponse.json({ success: true, data: article }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
