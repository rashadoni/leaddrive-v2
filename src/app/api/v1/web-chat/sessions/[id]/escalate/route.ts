import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { escalateWebChatToTicket } from "@/lib/web-chat-escalate"

export const POST = withRlsAuth("inbox", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const chat = await prisma.webChatSession.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const result = await escalateWebChatToTicket(id, auth.userId)
  if (!result) return NextResponse.json({ error: "Failed" }, { status: 500 })

  const statusCode = result.alreadyEscalated ? 409 : 200
  return NextResponse.json(
    { success: !result.alreadyEscalated, data: result, ...(result.alreadyEscalated ? { error: "Already escalated" } : {}) },
    { status: statusCode },
  )
})
