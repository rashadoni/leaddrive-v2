import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { sendConversationReply, type ConversationReplyChannel } from "@/lib/inbox/send-conversation-reply"
import { readConversationAiDraft, clearConversationAiDraft } from "@/lib/inbox/ai-draft"
import { claimConversationAiReply, releaseConversationAiReplyClaim } from "@/lib/social/ai-autoreply"

/**
 * A2 — operator review of a pending AI reply draft (SocialConversation.metadata.aiDraft).
 *
 * POST /api/v1/inbox/conversations/[id]/ai-draft
 *   { action: "send", text?: string } — send the draft (optionally edited) on the draft's
 *     channel, then clear it. The sent message carries aiQuality + aiDraftApproved metadata;
 *     an operator-edited text drops the aiGenerated claim (a human rewrote it — A4 semantics).
 *   { action: "discard" } — drop the draft without sending.
 */

const DRAFT_SEND_CHANNELS = new Set(["email", "telegram", "sms", "whatsapp", "tiktok", "facebook", "instagram", "vkontakte"])

const schema = z.object({
  action: z.enum(["send", "discard"]),
  text: z.string().trim().min(1).max(8000).optional(),
})

export const POST = withInboxSessionWrite(async (req, session, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = session.orgId
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const conv = await prisma.socialConversation.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, externalId: true, metadata: true, channelConfigId: true, contactId: true },
  })
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const initialDraft = readConversationAiDraft(conv.metadata)
  if (!initialDraft) return NextResponse.json({ error: "No pending AI draft" }, { status: 404 })

  // Serialize both send and discard. Without one shared lease, a discard could
  // report success while a concurrent request was already sending the same
  // draft, or a stale sender could continue after the draft had been removed.
  const claim = await claimConversationAiReply({
    organizationId: orgId,
    conversationId: conv.id,
    holdMs: 10 * 60_000,
  })
  if (!claim.claimed) {
    return NextResponse.json({ error: "This draft is already being processed" }, { status: 409 })
  }
  const releaseClaim = () => releaseConversationAiReplyClaim({
    organizationId: orgId,
    conversationId: conv.id,
    token: claim.token,
  })

  // Re-read after acquiring the lease so a request that observed an old draft
  // cannot send it after another worker replaced or cleared it.
  const latest = await prisma.socialConversation.findFirst({
    where: { id: conv.id, organizationId: orgId },
    select: { metadata: true },
  })
  const draft = readConversationAiDraft(latest?.metadata)
  if (!draft || draft.createdAt !== initialDraft.createdAt) {
    await releaseClaim()
    return NextResponse.json({ error: "The draft changed while it was being processed" }, { status: 409 })
  }

  if (parsed.data.action === "discard") {
    const cleared = await clearConversationAiDraft({
      organizationId: orgId,
      conversationId: conv.id,
      expectedCreatedAt: draft.createdAt,
      claimToken: claim.token,
    })
    if (!cleared) {
      return NextResponse.json({ error: "The draft could not be discarded safely" }, { status: 409 })
    }
    await releaseClaim()
    return NextResponse.json({ success: true, data: { discarded: true } })
  }

  // send
  const priorAttempt = draft.channel === "web-chat"
    ? await prisma.webChatMessage.findFirst({
        where: {
          sessionId: draft.to,
          metadata: { path: ["aiDraftCreatedAt"], equals: draft.createdAt },
        },
        select: { id: true },
      })
    : await prisma.channelMessage.findFirst({
        where: {
          organizationId: orgId,
          conversationId: conv.id,
          direction: "outbound",
          metadata: { path: ["aiDraftCreatedAt"], equals: draft.createdAt },
          OR: [
            { status: { in: ["pending", "sent", "delivered", "read"] } },
            { status: "failed", metadata: { path: ["deliveryUnknown"], equals: true } },
          ],
        },
        select: { id: true },
      })
  if (priorAttempt) {
    const cleared = await clearConversationAiDraft({
      organizationId: orgId,
      conversationId: conv.id,
      expectedCreatedAt: draft.createdAt,
      claimToken: claim.token,
    })
    if (cleared) await releaseClaim()
    return NextResponse.json(
      { error: "This draft already has a delivery attempt. Verify the conversation before retrying.", deliveryUnknown: true },
      { status: 409 },
    )
  }
  const edited = typeof parsed.data.text === "string" && parsed.data.text.trim() !== draft.text.trim()
  const body = edited ? parsed.data.text!.trim() : draft.text

  // Web-chat drafts deliver as a widget message (mirrors POST /api/v1/inbox channel=web-chat),
  // not through sendConversationReply (no external transport).
  if (draft.channel === "web-chat") {
    const wcSession = await prisma.webChatSession.findFirst({ where: { id: draft.to, organizationId: orgId } })
    if (!wcSession) {
      await releaseClaim()
      return NextResponse.json({ error: "Web chat session not found" }, { status: 404 })
    }
    const message = await prisma.webChatMessage.create({
      data: {
        organizationId: orgId,
        sessionId: draft.to,
        fromRole: edited ? "agent" : "bot",
        authorUserId: session.userId,
        text: body,
        metadata: {
          aiDraftApproved: true,
          aiDraftReason: draft.reason,
          aiDraftCreatedAt: draft.createdAt,
          aiGenerated: !edited,
          authorType: edited ? "operator" : "ai",
          authorUserId: edited ? session.userId : null,
          authorName: edited ? session.name || session.email || null : null,
          sentVia: "leaddrive_inbox",
          sentOnBehalfOfCompany: true,
          ...(draft.quality && !edited ? { aiQuality: draft.quality } : {}),
          ...(draft.logId ? { aiLogId: draft.logId } : {}),
        },
      },
    })
    await prisma.webChatSession.update({
      where: { id: draft.to },
      data: { lastMessageAt: new Date(), assignedUserId: wcSession.assignedUserId || session.userId },
    })
    const cleared = await clearConversationAiDraft({
      organizationId: orgId,
      conversationId: conv.id,
      expectedCreatedAt: draft.createdAt,
      claimToken: claim.token,
    })
    if (!cleared) {
      return NextResponse.json(
        { error: "Message was sent, but the draft state could not be finalized. Do not retry.", deliveryUnknown: true },
        { status: 409 },
      )
    }
    await releaseClaim()
    return NextResponse.json({ success: true, data: { sent: true, edited, messageId: message.id } })
  }

  if (!DRAFT_SEND_CHANNELS.has(draft.channel)) {
    await releaseClaim()
    return NextResponse.json({ error: `Channel "${draft.channel}" cannot be replied from the inbox` }, { status: 400 })
  }
  const sent = await sendConversationReply({
    organizationId: orgId,
    channel: draft.channel as ConversationReplyChannel,
    to: draft.to,
    body,
    contactId: conv.contactId,
    conversationId: conv.id,
    channelConfigId: conv.channelConfigId,
    telegramParseMode: null,
    deliveryIdempotency: {
      source: "ai-draft",
      key: createHash("sha256")
        .update(`ai-draft:${orgId}:${conv.id}:${draft.createdAt}`)
        .digest("hex"),
    },
    extraMetadata: {
      autoReply: true,
      aiAutoReply: !edited, // edited by a human → no longer an AI-authored message (A4)
      aiDraftApproved: true,
      aiDraftReason: draft.reason,
      aiDraftCreatedAt: draft.createdAt,
      approvedBy: session.userId,
      ...(edited ? {
        authorType: "operator",
        authorUserId: session.userId,
        authorName: session.name || session.email || null,
      } : {}),
      ...(draft.quality && !edited ? { aiQuality: draft.quality } : {}),
      ...(draft.logId ? { aiLogId: draft.logId } : {}),
    },
  })
  if (!sent.success) {
    if (sent.deliveryUnknown) {
      // The sender recorded a durable deliveryUnknown row. Remove the draft so
      // the review UI cannot turn an ambiguous Chatwoot response into a second
      // automatic/operator POST.
      const cleared = await clearConversationAiDraft({
        organizationId: orgId,
        conversationId: conv.id,
        expectedCreatedAt: draft.createdAt,
        claimToken: claim.token,
      })
      if (cleared) await releaseClaim()
      return NextResponse.json(
        { error: sent.error, deliveryUnknown: true },
        { status: sent.statusCode },
      )
    }
    // Keep the draft — the operator can retry after the channel recovers.
    await releaseClaim()
    return NextResponse.json({ error: sent.error }, { status: sent.statusCode })
  }

  // Confirmed send → persist the assistant turn to AI history (mirrors flow ai_reply #4).
  if (draft.sessionId) {
    await prisma.aiChatMessage
      .create({ data: { sessionId: draft.sessionId, role: "assistant", content: body } })
      .catch(() => {})
  }
  const cleared = await clearConversationAiDraft({
    organizationId: orgId,
    conversationId: conv.id,
    expectedCreatedAt: draft.createdAt,
    claimToken: claim.token,
  })
  if (!cleared) {
    return NextResponse.json(
      { error: "Message was sent, but the draft state could not be finalized. Do not retry.", deliveryUnknown: true },
      { status: 409 },
    )
  }
  await releaseClaim()

  return NextResponse.json({ success: true, data: { sent: true, edited, messageId: sent.data.id } })
})
