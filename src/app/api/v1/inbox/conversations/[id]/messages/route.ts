import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"

export const POST = withInboxSessionWrite(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { text } = await req.json()

  const conv = await prisma.socialConversation.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // platform="inbox" rows are ensure-created collaborator anchors for email/sms threads ([P3]), NOT a
  // real send channel — none of the dispatch branches below match, so a reply would silently no-send +
  // persist a channelType:"inbox" outbound row. Replies for those go through /api/v1/inbox. Guard the край.
  if (conv.platform === "inbox") {
    return NextResponse.json({ error: "Use the inbox send endpoint for this conversation" }, { status: 400 })
  }

  const channel = conv.channelConfigId
    ? await prisma.channelConfig.findFirst({ where: { id: conv.channelConfigId } })
    : null

  let sent = false

  if (conv.platform === "whatsapp" && channel) {
    const { sendWhatsAppMessage } = await import("@/lib/whatsapp")
    sent = await sendWhatsAppMessage({ to: conv.externalId, message: text, organizationId: orgId })
      .then(r => r.success)
      .catch(() => false)
  } else if (conv.platform === "telegram" && channel) {
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
