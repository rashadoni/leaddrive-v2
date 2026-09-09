import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { setTyping, getTyping } from "@/lib/web-chat-typing"
import { withRlsAuth } from "@/lib/with-rls"

export const POST = withRlsAuth("inbox", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params
  const chat = await prisma.webChatSession.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 })
  setTyping(id, "agent")
  return NextResponse.json({ success: true })
})

export const GET = withRlsAuth("inbox", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params
  const chat = await prisma.webChatSession.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const state = getTyping(id)
  return NextResponse.json({
    success: true,
    data: state && state.role === "visitor" ? { typing: true } : { typing: false },
  })
})
