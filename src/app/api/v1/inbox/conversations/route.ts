import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { validateConversationTagsInput } from "@/lib/inbox/conversation-tags"

export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const platform = searchParams.get("platform") || ""
  const status = searchParams.get("status") || "open"
  const tag = searchParams.get("tag") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")

  let normalizedTag = ""
  if (tag) {
    const parsedTag = validateConversationTagsInput([tag])
    if (!parsedTag.ok || parsedTag.tags.length !== 1) {
      return NextResponse.json({ error: parsedTag.ok ? "Invalid tag" : parsedTag.error }, { status: 400 })
    }
    normalizedTag = parsedTag.tags[0]
  }

  const where: Prisma.SocialConversationWhereInput = { organizationId: orgId }
  if (platform) where.platform = platform
  if (status !== "all") where.status = status
  if (normalizedTag) where.tags = { has: normalizedTag }

  const [conversations, total] = await Promise.all([
    prisma.socialConversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.socialConversation.count({ where }),
  ])

  return NextResponse.json({ success: true, data: { conversations, total, page, limit } })
})
