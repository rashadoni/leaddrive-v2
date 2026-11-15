import { NextResponse } from "next/server"
import { withConversationChannelAccess } from "@/lib/inbox/channel-access"
import { withRlsAuth } from "@/lib/with-rls"
import { conversationLearning } from "@/lib/inbox/learning/service"

/**
 * What the thread shows about training (lib/inbox/learning): whether the channel is in training and
 * how ready the AI is, whether it would have answered each person's answer the same, and what it
 * learned from this conversation. Read-only; anyone who may read the conversation.
 */
export const GET = withRlsAuth("inbox", "read", withConversationChannelAccess(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    return NextResponse.json({ data: await conversationLearning(orgId, id) })
  } catch (e) {
    console.error("[conversation learning GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}))
