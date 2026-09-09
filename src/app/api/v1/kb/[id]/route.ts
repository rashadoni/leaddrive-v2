import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const updateKbArticleSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  categoryId: z.string().optional(),
  status: z.enum(["draft", "published"]).optional(),
  tags: z.array(z.string()).optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const article = await prisma.kbArticle.findFirst({
      where: { id, organizationId: orgId },
      include: { category: true },
    })
    if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: article })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateKbArticleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const result = await prisma.kbArticle.updateMany({
      where: { id, organizationId: orgId },
      data: parsed.data,
    })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const updated = await prisma.kbArticle.findFirst({
      where: { id, organizationId: orgId },
      include: { category: true },
    })

    // Re-embed on update (non-blocking)
    if (updated && (updated.status === "published")) {
      import("@/lib/ai/embeddings").then(({ embedKbArticle }) =>
        embedKbArticle(id, orgId, updated.title, updated.content || "")
      ).catch(() => {})
    }

    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const result = await prisma.kbArticle.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
