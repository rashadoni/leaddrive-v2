import { prisma } from "@/lib/prisma"

export const WHATSAPP_REPLY_CHANNEL_MISMATCH = "whatsapp_reply_channel_mismatch"

type ThreadMessage = {
  channelType?: string | null
  channelConfigId?: string | null
  conversationId?: string | null
}

/** The legacy Inbox groups by contact. Never borrow an older business number's
 * canonical conversation when the newest WhatsApp message belongs to another. */
export function whatsappThreadReplyBinding(messages: readonly ThreadMessage[]) {
  const latest = messages.find(message => message.channelType === "whatsapp")
  const canonical = messages.find(message => message.channelType === "whatsapp" && message.conversationId)
  const blocked = !!(latest?.channelConfigId && canonical?.channelConfigId
    && latest.channelConfigId !== canonical.channelConfigId)
  return { whatsappReplyBlocked: blocked }
}

/** Recheck on the server: a stale Inbox or the conversation messages API must
 * not send from A after this customer's newest WhatsApp message arrived on B.
 * Missing bindings may use the sole active channel, never an arbitrary first. */
export async function checkWhatsAppReplyChannel(options: {
  organizationId: string
  to: string
  channelConfigId?: string | null
}): Promise<{ allowed: boolean; channelConfigId?: string | null }> {
  let channelConfigId = options.channelConfigId
  if (!channelConfigId) {
    const channels = await prisma.channelConfig.findMany({
      where: { organizationId: options.organizationId, channelType: "whatsapp", isActive: true },
      select: { id: true },
      take: 2,
    })
    if (channels.length > 1) return { allowed: false }
    channelConfigId = channels[0]?.id ?? null
  }

  const phone = options.to.replace(/\D/g, "")
  if (!channelConfigId || !/^\d{7,15}$/.test(phone)) return { allowed: true, channelConfigId }
  const latest = await prisma.channelMessage.findFirst({
    where: {
      organizationId: options.organizationId,
      channelType: "whatsapp",
      OR: [
        { from: { in: [phone, `+${phone}`] } },
        { to: { in: [phone, `+${phone}`] } },
        { metadata: { path: ["waPhone"], equals: phone } },
        { metadata: { path: ["waPhone"], equals: `+${phone}` } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { channelConfigId: true },
  })
  return { allowed: !latest?.channelConfigId || latest.channelConfigId === channelConfigId, channelConfigId }
}
