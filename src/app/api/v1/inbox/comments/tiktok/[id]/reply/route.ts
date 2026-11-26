import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { sendTikTokCommentReply } from "@/lib/inbox/tiktok-comment-reply"

const bodySchema = z.strictObject({
  body: z.string().trim().min(1).max(150),
})

/**
 * A person's answer to a TikTok comment from «Комментарии». Only one mode exists — under the video:
 * TikTok's direct messages need the Business Messaging permission, which the platform has stopped
 * issuing, so there is no private reply to offer. The body is capped at TikTok's own comment length.
 */
export const POST = withInboxSessionWrite(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const row = await prisma.tikTokVideoComment.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true },
  })
  if (!row) return NextResponse.json({ error: "Comment not found" }, { status: 404 })
  const result = await sendTikTokCommentReply({
    organizationId: auth.orgId,
    rowId: id,
    text: parsed.data.body,
    authorName: auth.name || auth.email || null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true }, { status: 201 })
})
