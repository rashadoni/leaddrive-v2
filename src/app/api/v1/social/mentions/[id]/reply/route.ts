import { NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import { requestSocialReplyEnqueue } from "@/lib/social/outbound-boundary"
import { evaluateSocialReplyPolicy } from "@/lib/social/reply-policy"

const schema = z.object({
  text: z.string().trim().min(1).max(2000),
  approvedPolicy: z.boolean().optional().default(false),
})

/**
 * Request an external reply. This route deliberately never calls a platform or
 * provider publisher directly. PR1 funnels every allowed request into the single
 * fail-closed enqueue boundary; PR6 will back that boundary with the audited
 * durable outbox.
 */
export const POST = withSocialMonitoringMutationFence("social", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const mention = await prisma.socialMention.findFirst({
    where: { id, organizationId: orgId },
    include: { account: true },
  })
  if (!mention) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const replyPolicy = evaluateSocialReplyPolicy(
    {
      platform: mention.platform,
      sourceType: mention.sourceType,
      sourceProvider: mention.sourceProvider,
      sourceMetadata: mention.sourceMetadata,
      text: mention.text,
      sentiment: mention.sentiment,
      hasConnectedAccount: Boolean(mention.account?.accessToken),
    },
    {
      // This route requests a PENDING outbox item; the durable worker performs
      // the real global/tenant/platform/connection live-send checks again.
      liveRepliesEnabled: true,
      approvedPolicy: parsed.data.approvedPolicy,
    },
  )

  if (!replyPolicy.liveAllowed) {
    await logAudit(orgId, "social_reply_blocked", "social_mention", mention.id, mention.platform, {
      newValue: {
        reason: replyPolicy.reason,
        sourceTier: replyPolicy.sourceTier,
        approvalRequired: replyPolicy.approvalRequired,
        supportedProvider: replyPolicy.supportedProvider,
      },
    })
    return NextResponse.json(
      {
        error: replyPolicy.message,
        code: replyPolicy.reason,
        data: { replyPolicy },
      },
      { status: replyPolicy.reason === "unsupported_provider" ? 501 : 409 },
    )
  }

  const enqueue = await requestSocialReplyEnqueue({
    organizationId: orgId,
    mentionId: mention.id,
    requestedBy: auth.userId,
    replyText: parsed.data.text,
    platform: mention.platform,
    externalId: mention.externalId,
    sourceType: mention.sourceType,
    sourceProvider: mention.sourceProvider,
    sourceMetadata: mention.sourceMetadata,
  })

  if (enqueue.ok) {
    await logAudit(orgId, "social_reply_outbox_created", "social_mention", mention.id, mention.platform, {
      newValue: { outboundReplyId: enqueue.data.id, state: enqueue.data.state, replyPolicy },
    })
    return NextResponse.json({ success: true, code: enqueue.code, data: { ...enqueue.data, replyPolicy } }, { status: enqueue.status })
  }

  await logAudit(orgId, "social_reply_blocked", "social_mention", mention.id, mention.platform, {
    newValue: {
      reason: enqueue.code,
      replyPolicy,
      boundary: "outbound_social_reply_queue",
    },
  })
  return NextResponse.json(
    { error: enqueue.error, code: enqueue.code, data: { replyPolicy } },
    { status: enqueue.status },
  )
})
