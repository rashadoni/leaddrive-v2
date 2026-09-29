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

const createRuleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  triggerType: z.enum(["first_response_breach", "resolution_breach", "resolution_warning"]),
  triggerMinutes: z.number().int().min(0).max(525_600).default(0),
  level: z.number().int().min(1).max(5).default(1),
  actions: z.array(actionSchema).length(1),
  isActive: z.boolean().default(true),
})

export const GET = withRlsAuth("tickets", "read", async (_req, authResult) => {
  const orgId = authResult.orgId

  try {
    const rules = await prisma.escalationRule.findMany({
      where: { organizationId: orgId },
      orderBy: [{ level: "asc" }, { createdAt: "asc" }],
    })
    return NextResponse.json({ success: true, data: rules, permissions: { canWrite: canManageEscalationRules(authResult.role) } })
  } catch (e) {
    console.error("EscalationRules GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("tickets", "write", async (req, authResult) => {
  if (!canManageEscalationRules(authResult.role)) {
    return NextResponse.json({ error: "Forbidden", code: "ESCALATION_WRITE_FORBIDDEN" }, { status: 403 })
  }
  const orgId = authResult.orgId

  const body = await req.json()
  const parsed = createRuleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    if (parsed.data.isActive) {
      const conflicting = await prisma.escalationRule.findFirst({
        where: {
          organizationId: orgId,
          isActive: true,
          triggerType: parsed.data.triggerType,
          triggerMinutes: parsed.data.triggerMinutes,
          level: parsed.data.level,
          actions: { equals: parsed.data.actions },
        },
        select: { id: true },
      })
      if (conflicting) return NextResponse.json({ error: "An identical active escalation rule already exists.", code: "ESCALATION_RULE_CONFLICT" }, { status: 409 })
    }
    const rule = await prisma.escalationRule.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        triggerType: parsed.data.triggerType,
        triggerMinutes: parsed.data.triggerMinutes,
        level: parsed.data.level,
        actions: parsed.data.actions,
        isActive: parsed.data.isActive,
      },
    })
    return NextResponse.json({ success: true, data: rule }, { status: 201 })
  } catch (e) {
    console.error("EscalationRules POST error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
