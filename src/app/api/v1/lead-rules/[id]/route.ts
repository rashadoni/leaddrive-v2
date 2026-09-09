import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  method: z.enum(["round_robin", "condition"]).optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.string(),
    value: z.string(),
  })).optional(),
  assignees: z.array(z.string()).optional(),
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.leadAssignmentRule.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 })

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const rule = await prisma.leadAssignmentRule.update({
    where: { id },
    data: parsed.data,
  })

  return NextResponse.json({ success: true, data: rule })
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.leadAssignmentRule.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 })

  await prisma.leadAssignmentRule.delete({ where: { id } })
  return NextResponse.json({ success: true })
})
