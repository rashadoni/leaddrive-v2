import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("inbox", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200)
  const status = searchParams.get("status") || undefined

  const sessions = await prisma.webChatSession.findMany({
    where: { organizationId: orgId, ...(status ? { status } : {}) },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    include: {
      _count: { select: { messages: true } },
    },
  })

  return NextResponse.json({ success: true, data: { sessions } })
})
