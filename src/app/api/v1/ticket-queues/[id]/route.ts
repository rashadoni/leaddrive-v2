import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const updateQueueSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  skills: z.array(z.string()).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  autoAssign: z.boolean().optional(),
  assignMethod: z.enum(["least_loaded", "round_robin"]).optional(),
  isActive: z.boolean().optional(),
})

export const PATCH = withRlsAuth("settings", "write", async (req: NextRequest, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  const body = await req.json()
  const parsed = updateQueueSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const existing = await prisma.ticketQueue.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!existing) return NextResponse.json({ error: "Queue not found" }, { status: 404 })

    const updated = await prisma.ticketQueue.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.skills !== undefined && { skills: parsed.data.skills }),
        ...(parsed.data.priority !== undefined && { priority: parsed.data.priority }),
        ...(parsed.data.autoAssign !== undefined && { autoAssign: parsed.data.autoAssign }),
        ...(parsed.data.assignMethod !== undefined && { assignMethod: parsed.data.assignMethod }),
        ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
      },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("TicketQueues PATCH error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("settings", "delete", async (_req: NextRequest, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  try {
    const existing = await prisma.ticketQueue.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!existing) return NextResponse.json({ error: "Queue not found" }, { status: 404 })

    await prisma.ticketQueue.delete({ where: { id } })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error("TicketQueues DELETE error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
