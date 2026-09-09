import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { PAGE_SIZE } from "@/lib/constants"

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const sessions = await prisma.aiChatSession.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE.DEFAULT,
    })
    return NextResponse.json({ success: true, data: { sessions } })
  } catch (e) {
    console.error("[ai-sessions GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
