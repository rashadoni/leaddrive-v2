import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const schema = z.object({
  text: z.string().min(1).max(4000),
})

export const POST = withRlsAuth("inbox", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const chat = await prisma.webChatSession.findFirst({ where: { id, organizationId: orgId } })
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const message = await prisma.webChatMessage.create({
    data: {
      organizationId: orgId,
      sessionId: id,
      fromRole: "agent",
      authorUserId: auth.userId,
      text: parsed.data.text,
    },
  })
  await prisma.webChatSession.update({
    where: { id },
    data: {
      lastMessageAt: new Date(),
      assignedUserId: chat.assignedUserId || auth.userId,
    },
  })

  return NextResponse.json({ success: true, data: message })
})
