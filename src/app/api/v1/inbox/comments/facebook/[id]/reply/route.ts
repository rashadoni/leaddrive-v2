import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { channelVisible, hiddenChannelIdsFor } from "@/lib/inbox/channel-access"
import { sendFacebookCommentReply } from "@/lib/inbox/facebook-comment-reply"

const bodySchema = z.strictObject({
  mode: z.enum(["public", "private"]),
  body: z.string().trim().min(1).max(1000),
})

/**
 * A person's answer to a Facebook Page comment from «Комментарии»: under the post, or as the comment's
 * one private reply (lib/inbox/facebook-comment-reply). A comment on a Page hidden from this person is
 * answered like a missing one.
 */
export const POST = withInboxSessionWrite(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const row = await prisma.facebookPageComment.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { channelConfigId: true },
  })
  if (!row || !channelVisible(await hiddenChannelIdsFor(auth), row.channelConfigId)) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 })
  }
  const result = await sendFacebookCommentReply({
    organizationId: auth.orgId,
    rowId: id,
    mode: parsed.data.mode,
    text: parsed.data.body,
    authorName: auth.name || auth.email || null,
    authorUserId: auth.userId,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true }, { status: 201 })
})
