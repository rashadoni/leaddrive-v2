import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { canManageEscalationRules } from "@/lib/escalation-rules/presentation"

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notify"), target: z.enum(["manager", "admin"]) }),
  z.object({ type: z.literal("increase_priority") }),
  z.object({ type: z.literal("reassign") }),
])

const updateRuleSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  triggerType: z.enum(["first_response_breach", "resolution_breach", "resolution_warning"]).optional(),
  triggerMinutes: z.number().int().min(0).max(525_600).optional(),
  level: z.number().int().min(1).max(5).optional(),
  actions: z.array(actionSchema).length(1).optional(),
  isActive: z.boolean().optional(),
})

export const PATCH = withRlsAuth("tickets", "write", async (req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  if (!canManageEscalationRules(authResult.role)) {
    return NextResponse.json({ error: "Forbidden", code: "ESCALATION_WRITE_FORBIDDEN" }, { status: 403 })
  }
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

    const next = {
      triggerType: parsed.data.triggerType ?? existing.triggerType,
      triggerMinutes: parsed.data.triggerMinutes ?? existing.triggerMinutes,
      level: parsed.data.level ?? existing.level,
      actions: parsed.data.actions ?? existing.actions,
      isActive: parsed.data.isActive ?? existing.isActive,
    }
    if (next.isActive) {
      const conflicting = await prisma.escalationRule.findFirst({
        where: {
          organizationId: orgId,
          id: { not: id },
          isActive: true,
          triggerType: next.triggerType,
          triggerMinutes: next.triggerMinutes,
          level: next.level,
          actions: { equals: next.actions },
        },
        select: { id: true },
      })
      if (conflicting) return NextResponse.json({ error: "An identical active escalation rule already exists.", code: "ESCALATION_RULE_CONFLICT" }, { status: 409 })
    }

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

export const DELETE = withRlsAuth("tickets", "write", async (_req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  if (!canManageEscalationRules(authResult.role)) {
    return NextResponse.json({ error: "Forbidden", code: "ESCALATION_WRITE_FORBIDDEN" }, { status: 403 })
  }
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
