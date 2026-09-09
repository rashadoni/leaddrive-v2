import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"

/**
 * Remove an internal participant from a conversation. Org-scoped (defense-in-depth: the conversation
 * must belong to the caller's org, and the delete is filtered by organizationId too).
 */
export const DELETE = withInboxSessionWrite(
  async (_req, { orgId }, { params }: { params: Promise<{ id: string; userId: string }> }) => {
    const { id, userId } = await params

    const conv = await prisma.socialConversation.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const deleted = await prisma.conversationParticipant.deleteMany({
      where: { socialConversationId: id, userId, organizationId: orgId },
    })

    return NextResponse.json({ success: true, data: { deleted: deleted.count } })
  },
)
