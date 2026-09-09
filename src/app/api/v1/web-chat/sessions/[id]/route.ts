import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { CLOSE_OUTCOMES } from "@/lib/inbox/close-outcome"

export const GET = withRlsAuth("inbox", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const chat = await prisma.webChatSession.findFirst({
    where: { id, organizationId: orgId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  })
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ success: true, data: chat })
})

const updateSchema = z.object({
  status: z.enum(["open", "closed", "escalated"]).optional(),
  assignedUserId: z.string().nullable().optional(),
  aiPaused: z.boolean().optional(),
  closeOutcome: z.enum(CLOSE_OUTCOMES).optional(),
  closeOutcomeReason: z.string().max(2000).optional(),
})

export const PATCH = withRlsAuth("inbox", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const existing = await prisma.webChatSession.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Auto-pause AI when a human claims the session; resume when released.
  // Explicit aiPaused in the body wins (agent can toggle manually).
  const { closeOutcome, closeOutcomeReason, ...rest } = parsed.data
  const data: Record<string, unknown> = { ...rest }
  if (parsed.data.aiPaused === undefined && parsed.data.assignedUserId !== undefined) {
    data.aiPaused = parsed.data.assignedUserId !== null
  }
  if (parsed.data.status === "closed" && existing.status !== "closed") {
    data.closedAt = new Date()
  }
  if (closeOutcome !== undefined) data.closeOutcome = closeOutcome
  if (closeOutcomeReason !== undefined) data.closeOutcomeReason = closeOutcomeReason.trim() || null

  const updated = await prisma.webChatSession.update({
    where: { id },
    data,
  })
  return NextResponse.json({ success: true, data: updated })
})
