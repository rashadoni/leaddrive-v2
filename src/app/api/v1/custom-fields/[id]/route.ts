import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const updateCustomFieldSchema = z.object({
  entityType: z.string().min(1).optional(),
  fieldName: z.string().min(1).max(200).optional(),
  fieldLabel: z.string().min(1).max(200).optional(),
  fieldType: z.string().min(1).optional(),
  options: z.array(z.string()).optional(),
  isRequired: z.boolean().optional(),
  defaultValue: z.string().optional(),
  isActive: z.boolean().optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const field = await prisma.customField.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!field) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: field })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateCustomFieldSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const result = await prisma.customField.updateMany({
      where: { id, organizationId: orgId },
      data: parsed.data,
    })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const updated = await prisma.customField.findFirst({ where: { id, organizationId: orgId } })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const result = await prisma.customField.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
