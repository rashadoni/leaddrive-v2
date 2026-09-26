import { prisma } from "@/lib/prisma"
import { redactOAuthProviderText } from "@/lib/oauth-redaction"

export async function sendFacebookMessage(
  psid: string,
  text: string,
  pageAccessToken: string,
  orgId: string
): Promise<boolean> {
  void orgId
  try {
    const res = await fetch("https://graph.facebook.com/v20.0/me/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pageAccessToken}` },
      body: JSON.stringify({ recipient: { id: psid }, message: { text } }),
    })
    if (!res.ok) {
      console.error("Facebook send error:", redactOAuthProviderText(await res.text()))
      return false
    }
    return true
  } catch (e) {
    console.error("Facebook send exception:", e)
    return false
  }
}

export async function sendInstagramMessage(
  igsid: string,
  text: string,
  pageAccessToken: string,
  orgId: string
): Promise<boolean> {
  void orgId
  try {
    const res = await fetch("https://graph.facebook.com/v20.0/me/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pageAccessToken}` },
      body: JSON.stringify({ recipient: { id: igsid }, message: { text } }),
    })
    if (!res.ok) {
      console.error("Instagram send error:", redactOAuthProviderText(await res.text()))
      return false
    }
    return true
  } catch (e) {
    console.error("Instagram send exception:", e)
    return false
  }
}

export async function upsertSocialConversation(
  orgId: string,
  platform: string,
  externalId: string,
  contactName: string,
  lastMessage: string,
  channelConfigId?: string
) {
  const where = { organizationId_platform_externalId: { organizationId: orgId, platform, externalId } }
  const existing = await prisma.socialConversation.findUnique({ where, select: { id: true } }).catch(() => null)
  if (!existing) {
    try {
      const created = await prisma.socialConversation.create({
        data: {
          organizationId: orgId,
          platform,
          externalId,
          contactName,
          lastMessage,
          channelConfigId,
          lastMessageAt: new Date(),
        },
      })
      return { ...created, wasCreated: true as const }
    } catch (error) {
      if (!error || typeof error !== "object" || (error as { code?: string }).code !== "P2002") {
        throw error
      }
      // Lost a first-message create race; fall through to the update path. The winning request
      // owns conversation_opened, this one is a normal inbound update.
    }
  }

  const updated = await prisma.socialConversation.update({
    where,
    data: {
      // A new customer message starts a new service turn. Preserve ownership,
      // participants, lead links and history, but return a closed/snoozed
      // conversation to the shared open Inbox queue.
      status: "open",
      closedAt: null,
      snoozedUntil: null,
      lastMessage,
      lastMessageAt: new Date(),
      unreadCount: { increment: 1 },
      contactName,
      // Follow the connection that just delivered the customer's message. Replies go out through the
      // conversation's bound connection, and it used to stay pinned to whichever one received the FIRST
      // message: switch that connection off (a reconnected Page, a retired Meta app) and every existing
      // conversation kept receiving but answered «… не настроен» on send. Found 2026-09-21 on the
      // Lead Drive CRM Page. The connection that received THIS message is live by construction, and for
      // WhatsApp it is also the number whose 24-hour window the customer just opened.
      ...(channelConfigId ? { channelConfigId } : {}),
    },
  })
  return { ...updated, wasCreated: false as const }
}
