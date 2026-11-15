import { NextResponse } from "next/server"
import { z } from "zod"
import { withConversationChannelAccess } from "@/lib/inbox/channel-access"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { setConversationAutoReply } from "@/lib/inbox/conversation-auto-reply"
import { logAudit } from "@/lib/prisma"

const bodySchema = z.strictObject({ on: z.boolean() })

/**
 * «AI rejimi» of one conversation (lib/inbox/conversation-auto-reply): `{ on: false }` silences
 * every automatic reply to this customer here, `{ on: true }` gives the thread back to its
 * channel's own setting. A person's action — browser session and inbox write, like every inbox
 * mutation.
 */
export const PUT = withInboxSessionWrite(withConversationChannelAccess(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const state = await setConversationAutoReply({
    organizationId: auth.orgId,
    conversationId: id,
    on: parsed.data.on,
    userId: auth.userId,
  })
  if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 })
  void logAudit(auth.orgId, "update", "conversation", id, parsed.data.on ? "auto-reply on" : "auto-reply off", {
    userId: auth.userId,
    newValue: { autoReply: parsed.data.on },
  })
  return NextResponse.json({ success: true, data: state })
}))
