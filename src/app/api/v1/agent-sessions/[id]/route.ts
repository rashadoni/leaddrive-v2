/**
 *   GET    /api/v1/agent-sessions/[id]   → session + last 50 steps
 *   PATCH  /api/v1/agent-sessions/[id]   → cancel (only supported status mutation in slice 1)
 *
 * Part of H1 Agent framework (Phase 3 slice 1).
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { canTransitionStatus, type SessionStatus } from "@/lib/agent/state-machine"

const patchSchema = z.object({
  status: z.enum(["cancelled"]).optional(),
})

export const GET = withRlsAuth("ai", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const session = await prisma.agentSession.findFirst({
    where: { id, organizationId: auth.orgId },
    include: {
      steps: { orderBy: { stepIndex: "desc" }, take: 50 },
    },
  })
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: session })
})

export const PATCH = withRlsAuth("ai", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success || !parsed.data.status) {
    return NextResponse.json({ error: "Only `status: 'cancelled'` is supported in slice 1" }, { status: 400 })
  }

  const existing = await prisma.agentSession.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, status: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!canTransitionStatus(existing.status as SessionStatus, parsed.data.status)) {
    return NextResponse.json(
      { error: `Cannot transition from '${existing.status}' to '${parsed.data.status}'` },
      { status: 400 }
    )
  }

  const updated = await prisma.agentSession.update({
    where: { id },
    data: {
      status: parsed.data.status,
      completedAt: new Date(),
      result: "Cancelled by user",
    },
  })
  return NextResponse.json({ success: true, data: updated })
})
