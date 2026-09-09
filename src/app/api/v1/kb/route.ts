import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const createArticleSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().optional(),
  categoryId: z.string().optional(),
  status: z.enum(["draft", "published"]).optional(),
  tags: z.array(z.string()).optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  const status = searchParams.get("status")

  try {
    const where = {
      organizationId: orgId,
      ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
      ...(status ? { status } : {}),
    }

    const [articles, total] = await Promise.all([
      prisma.kbArticle.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { category: true },
      }),
      prisma.kbArticle.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: { articles, total, page, limit, search },
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
    const article = await prisma.kbArticle.create({
      data: { organizationId: orgId, ...parsed.data },
    })

    // Auto-embed for vector search (non-blocking)
    if (parsed.data.status === "published") {
      import("@/lib/ai/embeddings").then(({ embedKbArticle }) =>
        embedKbArticle(article.id, orgId, parsed.data.title, parsed.data.content || "")
      ).catch(() => {})
    }

    return NextResponse.json({ success: true, data: article }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
