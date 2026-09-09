import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const updateMacroSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  actions: z.array(z.object({ type: z.string(), value: z.string() })).optional(),
  shortcutKey: z.string().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const macro = await prisma.ticketMacro.findFirst({ where: { id, organizationId: orgId } })
  if (!macro) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ success: true, data: macro })
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await req.json()
  const parsed = updateMacroSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const result = await prisma.ticketMacro.updateMany({
    where: { id, organizationId: orgId },
    data: parsed.data,
  })
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.ticketMacro.findFirst({ where: { id } })
  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const result = await prisma.ticketMacro.deleteMany({ where: { id, organizationId: orgId } })
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ success: true, data: { deleted: id } })
})
