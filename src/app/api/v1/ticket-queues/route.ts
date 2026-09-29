import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { canManageSkillRouting, normalizeRoutingSkills } from "@/lib/skill-routing/presentation"

const createQueueSchema = z.object({
  name: z.string().trim().min(1).max(200),
  skills: z.array(z.string().trim().min(1).max(100)).max(100).transform(normalizeRoutingSkills).default([]),
  priority: z.number().int().min(0).max(100).default(0),
  autoAssign: z.boolean().default(true),
  assignMethod: z.enum(["least_loaded", "round_robin"]).default("least_loaded"),
  isActive: z.boolean().default(true),
})

export const GET = withRlsAuth("tickets", "read", async (_req, authResult) => {
  const orgId = authResult.orgId

  try {
    const queues = await prisma.ticketQueue.findMany({
      where: { organizationId: orgId },
      orderBy: { priority: "desc" },
    })
    return NextResponse.json({
      success: true,
      data: queues,
      permissions: { canWrite: canManageSkillRouting(authResult.role) },
    })
  } catch (e) {
    console.error("TicketQueues GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("tickets", "write", async (req, authResult) => {
  if (!canManageSkillRouting(authResult.role)) {
    return NextResponse.json({ error: "Forbidden", code: "ROUTING_WRITE_FORBIDDEN" }, { status: 403 })
  }
  const orgId = authResult.orgId

  const body = await req.json()
  const parsed = createQueueSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const queue = await prisma.ticketQueue.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        skills: parsed.data.skills,
        priority: parsed.data.priority,
        autoAssign: parsed.data.autoAssign,
        assignMethod: parsed.data.assignMethod,
        isActive: parsed.data.isActive,
      },
    })
    return NextResponse.json({ success: true, data: queue }, { status: 201 })
  } catch (e) {
    console.error("TicketQueues POST error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
