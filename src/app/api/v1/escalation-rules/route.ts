import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const actionSchema = z.object({
  type: z.enum(["notify", "increase_priority", "reassign"]),
  target: z.string().optional(),
})

const createRuleSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: z.enum(["first_response_breach", "resolution_breach", "resolution_warning"]),
  triggerMinutes: z.number().int().min(0).default(0),
  level: z.number().int().min(1).max(5).default(1),
  actions: z.array(actionSchema).min(1),
  isActive: z.boolean().default(true),
})

export const GET = withRlsAuth("settings", "read", async (_req, authResult) => {
  const orgId = authResult.orgId

  try {
    const rules = await prisma.escalationRule.findMany({
      where: { organizationId: orgId },
      orderBy: { level: "asc" },
    })
    return NextResponse.json({ success: true, data: rules })
  } catch (e) {
    console.error("EscalationRules GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("settings", "write", async (req, authResult) => {
  const orgId = authResult.orgId

  const body = await req.json()
  const parsed = createRuleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
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
