import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("inbox", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const since = searchParams.get("since")
  const sinceDate = since ? new Date(since) : null

  const whereOpen = {
    organizationId: orgId,
    status: { in: ["open", "escalated"] },
    ...(sinceDate ? { lastMessageAt: { gt: sinceDate } } : {}),
  }

  const count = await prisma.webChatSession.count({ where: whereOpen })
  return NextResponse.json({ success: true, data: { count } })
})
