import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("social", "read", async (req: NextRequest, auth) => {
  const state = req.nextUrl.searchParams.get("state")?.trim() || undefined
  const rows = await prisma.outboundSocialReply.findMany({
    where: { organizationId: auth.orgId, ...(state ? { state } : {}) },
    include: {
      approval: true,
      subject: { select: { id: true, name: true, type: true } },
      senderAccount: { select: { id: true, platform: true, handle: true, displayName: true } },
      mention: { select: { id: true, text: true, url: true, authorName: true, authorHandle: true, contentVersion: true } },
      events: { orderBy: { createdAt: "desc" }, take: 10 },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  return NextResponse.json({ success: true, data: rows })
})
