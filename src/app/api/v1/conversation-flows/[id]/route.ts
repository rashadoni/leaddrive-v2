import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"

const TRIGGERS = ["conversation_opened", "message_inbound", "conversation_idle", "ai_escalated"] as const
const STATUSES = ["draft", "active", "paused"] as const

const updateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    trigger: z.enum(TRIGGERS).optional(),
    status: z.enum(STATUSES).optional(),
    channelTypes: z.array(z.string()).optional(),
    graph: z.record(z.string(), z.any()).optional(),
  })
  .strict()

export const GET = withRls(
  async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const flow = await prisma.conversationFlow.findFirst({ where: { id, organizationId: orgId } })
    if (!flow) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: flow })
  },
)

export const PUT = withRlsAuth(
  "ai",
  "write",
  async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const data: Prisma.ConversationFlowUpdateManyMutationInput = {}
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.trigger !== undefined) data.trigger = parsed.data.trigger
    if (parsed.data.status !== undefined) data.status = parsed.data.status
    if (parsed.data.channelTypes !== undefined) data.channelTypes = parsed.data.channelTypes
    if (parsed.data.graph !== undefined) {
      data.graph = parsed.data.graph as Prisma.InputJsonValue
      data.version = { increment: 1 } // bump on every graph edit so the builder can track revisions
    }

    const result = await prisma.conversationFlow.updateMany({
      where: { id, organizationId: auth.orgId },
      data,
    })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const updated = await prisma.conversationFlow.findFirst({ where: { id, organizationId: auth.orgId } })
    return NextResponse.json({ success: true, data: updated })
  },
)

export const DELETE = withRlsAuth(
  "ai",
  "write",
  async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const result = await prisma.conversationFlow.deleteMany({ where: { id, organizationId: auth.orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  },
)
