import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const createSlaPolicySchema = z.object({
  name: z.string().min(1).max(200),
  priority: z.string().min(1),
  // Decimal hours; floor at 1 minute (1/60 h) so a non-form POST can't set a sub-minute SLA.
  firstResponseHours: z.number().min(1 / 60, "First response must be at least 1 minute"),
  resolutionHours: z.number().min(1 / 60, "Resolution must be at least 1 minute"),
  businessHoursOnly: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
})

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const policies = await prisma.slaPolicy.findMany({
      where: { organizationId: orgId },
      orderBy: { priority: "desc" },
    })

    return NextResponse.json({ success: true, data: policies })
  } catch (e) {
    console.error("[sla-policies GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createSlaPolicySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const policy = await prisma.slaPolicy.create({
      data: {
        organizationId: orgId,
        ...parsed.data,
      },
    })
    return NextResponse.json({ success: true, data: policy }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
