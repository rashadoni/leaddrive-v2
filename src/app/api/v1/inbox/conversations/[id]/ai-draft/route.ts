import { withConversationChannelAccess } from "@/lib/inbox/channel-access"
import { NextResponse } from "next/server"
import { z } from "zod"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { decidePendingAiDraft } from "@/lib/inbox/ai-draft-send"

/**
 * A2 — operator review of a pending AI reply draft (SocialConversation.metadata.aiDraft).
 *
 * POST /api/v1/inbox/conversations/[id]/ai-draft
 *   { action: "send", text?: string } — send the draft (optionally edited) on the draft's
 *     channel, then clear it. The sent message carries aiQuality + aiDraftApproved metadata;
 *     an operator-edited text drops the aiGenerated claim (a human rewrote it — A4 semantics).
 *   { action: "discard" } — drop the draft without sending.
 *
 * The work itself is lib/inbox/ai-draft-send — the same path the employees' Telegram bot sends by.
 */

const schema = z.object({
  action: z.enum(["send", "discard"]),
  text: z.string().trim().min(1).max(8000).optional(),
})

export const POST = withInboxSessionWrite(withConversationChannelAccess(async (req, session, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const outcome = await decidePendingAiDraft({
    organizationId: session.orgId,
    conversationId: id,
    decider: { userId: session.userId, name: session.name || null, email: session.email || null },
    action: parsed.data.action,
    text: parsed.data.text,
  })
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, ...(outcome.deliveryUnknown ? { deliveryUnknown: true } : {}) },
      { status: outcome.status },
    )
  }
  if (outcome.discarded) return NextResponse.json({ success: true, data: { discarded: true } })
  return NextResponse.json({ success: true, data: { sent: true, edited: outcome.edited, messageId: outcome.messageId } })
}))
