import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const actionSchema = z.object({
  type: z.enum(["notify", "increase_priority", "reassign"]),
  target: z.string().optional(),
})

const updateRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  triggerType: z.enum(["first_response_breach", "resolution_breach", "resolution_warning"]).optional(),
  triggerMinutes: z.number().int().min(0).optional(),
  level: z.number().int().min(1).max(5).optional(),
  actions: z.array(actionSchema).min(1).optional(),
  isActive: z.boolean().optional(),
})

export const PATCH = withRlsAuth("settings", "write", async (req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  const body = await req.json()
  const parsed = updateRuleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const existing = await prisma.escalationRule.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 })

    const updated = await prisma.escalationRule.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.triggerType !== undefined && { triggerType: parsed.data.triggerType }),
        ...(parsed.data.triggerMinutes !== undefined && { triggerMinutes: parsed.data.triggerMinutes }),
        ...(parsed.data.level !== undefined && { level: parsed.data.level }),
        ...(parsed.data.actions !== undefined && { actions: parsed.data.actions }),
        ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
      },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("EscalationRules PATCH error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("settings", "delete", async (_req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  try {
    const existing = await prisma.escalationRule.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 })

    await prisma.escalationRule.delete({ where: { id } })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error("EscalationRules DELETE error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
