import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { lockTurns } from "@/lib/lock-turns"
import { record, TIKTOK_MESSAGING_CHANNEL, TIKTOK_MESSAGING_PROVIDER } from "./config"
import { messagingConversationKey, messagingMessageKey, type MessagingInbound } from "./webhook"

const turns = lockTurns("tiktok-messaging-ingest", 1)

export async function ingestMessagingInbound(event: MessagingInbound, appId: string): Promise<"stored" | "duplicate" | "ignored"> {
  // Only signed app/account identifiers enter this cross-tenant ownership lookup.
  const connections = await runWithRlsBypass(() => prisma.channelConnection.findMany({
    where: { platform: "tiktok", surface: "dm", provider: TIKTOK_MESSAGING_PROVIDER, status: "connected",
      AND: [{ settings: { path: ["appId"], equals: appId } }, { settings: { path: ["openId"], equals: event.businessId } }],
    }, select: { id: true, organizationId: true }, take: 2,
  }))
  if (connections.length !== 1) return "ignored"
  const { id: connectionId, organizationId } = connections[0]
  const externalId = messagingConversationKey(event.businessId, event.conversationId)
  return turns.run(organizationId, () => runWithTenant(organizationId, () => prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-messaging-connection:${organizationId}`}, 0))`
    // Recheck after the lock: disconnect/reconnect may have happened since lookup.
    const connection = await tx.channelConnection.findFirst({ where: { id: connectionId, organizationId, status: "connected", provider: TIKTOK_MESSAGING_PROVIDER } })
    const settings = record(connection?.settings)
    if (!connection?.channelConfigId || record(connection.capabilities).read !== true
      || settings.appId !== appId || settings.openId !== event.businessId) return "ignored"
    const active = await tx.channelConfig.findFirst({ where: { id: connection.channelConfigId, organizationId, channelType: TIKTOK_MESSAGING_CHANNEL, isActive: true }, select: { id: true } })
    if (!active) return "ignored"
    const messageExternalId = messagingMessageKey(event.businessId, event.messageId)
    if (await tx.channelMessage.findFirst({ where: { organizationId, channelType: "tiktok", direction: "inbound", externalId: messageExternalId }, select: { id: true } })) return "duplicate"
    const metadata = { provider: TIKTOK_MESSAGING_PROVIDER, platform: "tiktok", surface: "dm", connectionId, businessId: event.businessId, providerConversationId: event.conversationId }
    const at = new Date(event.timestamp)
    const conversation = await tx.socialConversation.upsert({
      where: { organizationId_platform_externalId: { organizationId, platform: "tiktok", externalId } },
      create: { organizationId, platform: "tiktok", externalId, channelConfigId: active.id, contactName: event.senderName, metadata, lastMessageAt: at },
      update: {},
    })
    // Hidden/trash conversations keep evidence but are not silently reopened.
    await tx.channelMessage.create({ data: {
      organizationId, channelConfigId: active.id, conversationId: conversation.id, channelType: "tiktok", direction: "inbound",
      from: event.senderId, to: event.businessId, body: event.body, messageType: event.messageType, status: "delivered", externalId: messageExternalId,
      createdAt: at, metadata: { ...metadata, senderName: event.senderName, providerMessageId: event.messageId, providerTimestamp: event.timestamp, unsupportedMedia: event.messageType !== "text" },
    } })
    await tx.socialConversation.updateMany({ where: { id: conversation.id, organizationId }, data: { unreadCount: { increment: 1 } } })
    await tx.socialConversation.updateMany({ where: { id: conversation.id, organizationId, lastMessageAt: { lte: at } }, data: { lastMessage: event.body, lastMessageAt: at } })
    await tx.channelConnection.updateMany({ where: { id: connectionId, organizationId, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: at } }] }, data: { lastInboundAt: at } })
    return "stored"
  })))
}
