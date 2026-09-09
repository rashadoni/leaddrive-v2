import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"

// Conversation Automation Engine flow CRUD. The runner is wired through
// conversation-events, but remains feature-flag gated: an org must have
// `conversationFlowEvents`/`conversationAutomation`, and the flow must be active,
// before inbound messages can create ConversationFlowRun rows.
const FLOW_TRIGGERS = ["conversation_opened", "message_inbound", "conversation_idle", "ai_escalated"] as const
const FLOW_STATUSES = ["draft", "active", "paused"] as const

const createSchema = z.object({
  name: z.string().min(1).max(255),
  trigger: z.enum(FLOW_TRIGGERS).optional(),
  status: z.enum(FLOW_STATUSES).optional(),
  channelTypes: z.array(z.string()).optional(),
  graph: z.record(z.string(), z.any()).optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const flows = await prisma.conversationFlow.findMany({
    where: { organizationId: orgId, ...(status ? { status } : {}) },
    orderBy: [{ updatedAt: "desc" }],
  })
  return NextResponse.json({ success: true, data: flows })
})

export const POST = withRlsAuth("ai", "write", async (req, auth) => {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const flow = await prisma.conversationFlow.create({
    data: {
      organizationId: auth.orgId,
      name: parsed.data.name,
      trigger: parsed.data.trigger ?? "conversation_opened",
      status: parsed.data.status ?? "draft",
      channelTypes: parsed.data.channelTypes ?? [],
      graph: (parsed.data.graph ?? {}) as Prisma.InputJsonValue,
      createdBy: auth.userId ?? null,
    },
  })
  return NextResponse.json({ success: true, data: flow }, { status: 201 })
})
