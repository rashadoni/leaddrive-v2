import { prisma } from "@/lib/prisma"

export function isWhatsAppOptOut(text: string): boolean {
  return /^(?:stop|unsubscribe|отписка)[.!\s]*$/iu.test(text.trim())
}

/** Called before automation dispatch. Only an explicit unsubscribe command
 * changes consent; an ordinary subsequent message never opts the person in. */
export async function recordWhatsAppOptOut(organizationId: string, contactId: string | undefined) {
  if (!contactId) return
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId }, select: { id: true } })
  if (!contact) return
  const consent = { isOptedIn: false, optOutReason: "whatsapp_inbound_stop", optedOutAt: new Date() }
  await prisma.channelPreference.upsert({
    where: { contactId_channel: { contactId, channel: "whatsapp" } },
    create: { organizationId, contactId, channel: "whatsapp", ...consent },
    update: consent,
  })
}

export async function recordWhatsAppConversationOptOut(organizationId: string, conversationId: string) {
  const conversation = await prisma.socialConversation.findFirst({
    where: { id: conversationId, organizationId }, select: { metadata: true },
  })
  if (!conversation) return
  const metadata = conversation.metadata && typeof conversation.metadata === "object" && !Array.isArray(conversation.metadata)
    ? conversation.metadata : {}
  await prisma.socialConversation.updateMany({
    where: { id: conversationId, organizationId },
    data: { metadata: { ...metadata, whatsappOptedOut: true } },
  })
}
