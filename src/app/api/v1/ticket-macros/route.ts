import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const createMacroSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.string().optional(),
  actions: z.array(z.object({
    type: z.string(),
    value: z.string(),
  })).min(1),
  shortcutKey: z.string().optional(),
  sortOrder: z.number().int().optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get("category")

  const macros = await prisma.ticketMacro.findMany({
    where: {
      organizationId: orgId,
      ...(category ? { category } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  })

  return NextResponse.json({ success: true, data: macros })
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createMacroSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const macro = await prisma.ticketMacro.create({
    data: {
      organizationId: orgId,
      ...parsed.data,
    },
  })

  return NextResponse.json({ success: true, data: macro }, { status: 201 })
})
