import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const updateSlaPolicySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  priority: z.string().min(1).optional(),
  // Decimal hours; floor at 1 minute (1/60 h) so a non-form PUT can't set a sub-minute SLA.
  firstResponseHours: z.number().min(1 / 60, "First response must be at least 1 minute").optional(),
  resolutionHours: z.number().min(1 / 60, "Resolution must be at least 1 minute").optional(),
  businessHoursOnly: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const policy = await prisma.slaPolicy.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!policy) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: policy })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateSlaPolicySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const result = await prisma.slaPolicy.updateMany({
      where: { id, organizationId: orgId },
      data: parsed.data,
    })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const updated = await prisma.slaPolicy.findFirst({ where: { id, organizationId: orgId } })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const result = await prisma.slaPolicy.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
