import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"

export const POST = withInboxSessionWrite(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { text, deliveryIdempotencyKey } = await req.json()

  const conv = await prisma.socialConversation.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
  })
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // platform="inbox" rows are ensure-created collaborator anchors for email/sms threads ([P3]), NOT a
  // real send channel — none of the dispatch branches below match, so a reply would silently no-send +
  // persist a channelType:"inbox" outbound row. Replies for those go through /api/v1/inbox. Guard the край.
  if (conv.platform === "inbox") {
    return NextResponse.json({ error: "Use the inbox send endpoint for this conversation" }, { status: 400 })
  }

  if (conv.platform === "tiktok") {
    if (typeof text !== "string" || typeof deliveryIdempotencyKey !== "string") {
      return NextResponse.json({ error: "Text and an idempotency key are required" }, { status: 400 })
    }
    const { sendConversationReply } = await import("@/lib/inbox/send-conversation-reply")
    const result = await sendConversationReply({ organizationId: orgId, channel: "tiktok", to: conv.externalId,
      body: text, conversationId: conv.id, channelConfigId: conv.channelConfigId,
      deliveryIdempotency: { source: "manual", key: deliveryIdempotencyKey } })
    return NextResponse.json(result.success ? { success: true, data: result.data }
      : { error: result.error, deliveryUnknown: result.deliveryUnknown, attemptId: result.attemptId }, { status: result.statusCode })
  }

  if (conv.platform === "whatsapp") {
    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 })
    }
    const { sendConversationReply } = await import("@/lib/inbox/send-conversation-reply")
    const result = await sendConversationReply({ organizationId: orgId, channel: "whatsapp", to: conv.externalId,
      body: text, conversationId: conv.id, channelConfigId: conv.channelConfigId,
      contactId: conv.contactId, leadId: conv.leadId })
    return NextResponse.json(result.success ? { success: true, data: result.data }
      : { error: result.error }, { status: result.statusCode })
  }

  const channel = conv.channelConfigId
    ? await prisma.channelConfig.findFirst({ where: { id: conv.channelConfigId } })
    : null

  let sent = false

  if (conv.platform === "telegram" && channel) {
    const token = channel.botToken
    const chatId = conv.externalId
    if (token) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      })
      sent = res.ok
    }
  } else if ((conv.platform === "facebook" || conv.platform === "instagram") && channel?.apiKey) {
    const { sendFacebookMessage } = await import("@/lib/facebook")
    sent = await sendFacebookMessage(conv.externalId, text, channel.apiKey, orgId)
  } else if (conv.platform === "vkontakte" && channel?.apiKey) {
    const { sendVkMessage } = await import("@/lib/vkontakte")
    sent = await sendVkMessage(conv.externalId, text, channel.apiKey)
  }

  // Save outbound message
  const msg = await prisma.channelMessage.create({
    data: {
      organizationId: orgId,
      channelConfigId: conv.channelConfigId,
      channelType: conv.platform,
      direction: "outbound",
      from: "agent",
      to: conv.externalId,
      body: text,
      status: sent ? "sent" : "failed",
      messageType: "text",
      conversationId: id,
      metadata: {},
    },
  })

  // Update conversation lastMessage
  await prisma.socialConversation.update({
    where: { id },
    data: { lastMessage: text, lastMessageAt: new Date() },
  })

  return NextResponse.json({ success: true, data: msg })
})
