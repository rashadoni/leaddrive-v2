import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const createSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().optional(),
  sortOrder: z.number().optional(),
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

  const category = await prisma.kbCategory.create({
    data: { organizationId: orgId, ...parsed.data },
  })

  return NextResponse.json({ success: true, data: category }, { status: 201 })
})
