/**
 * The whole feed of one customer when a manager opens him: his messages on every channel and his calls.
 *
 * The inbox list is built from the organization's newest 500 messages, so a customer who wrote on
 * Instagram a week ago and on WhatsApp today showed only today's WhatsApp — the rest of his history was
 * outside the window. Opening the thread reads his own history instead (owner, 2026-11-15, point 7 of
 * the approved list). The same rules as the list decide what belongs to him: messages tied to the
 * customer, and conversations tied to him — an Instagram or Messenger conversation only while a manager
 * keeps it linked (lib/inbox/contact-link). Numbers hidden from the person stay hidden, and deleted
 * conversations stay in the trash.
 */

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { accessibleCallWhere, exposeCallForClient } from "@/lib/calls/access"
import { channelVisible } from "@/lib/inbox/channel-access"
import { isContactLinkablePlatform } from "@/lib/inbox/contact-link"
import type { Role } from "@/lib/permissions"

export const THREAD_HISTORY_MESSAGES = 200
const THREAD_HISTORY_CALLS = 100

type HistoryDb = Pick<typeof prisma, "contact" | "socialConversation" | "channelMessage" | "callLog">

const CALL_SELECT = {
  id: true,
  conversationId: true,
  contactId: true,
  direction: true,
  fromNumber: true,
  toNumber: true,
  status: true,
  duration: true,
  provider: true,
  recordingUrl: true,
  transcription: true,
  insightsAt: true,
  notes: true,
  providerOutcome: true,
  providerDialStatus: true,
  providerHangupCause: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
} as const

function visibleWhere(hidden: ReadonlySet<string>): Prisma.ChannelMessageWhereInput | undefined {
  if (hidden.size === 0) return undefined
  return { OR: [{ channelConfigId: null }, { channelConfigId: { notIn: [...hidden] } }] }
}

export async function loadThreadHistory(
  options: {
    organizationId: string
    contactId?: string | null
    conversationId?: string | null
    hiddenChannelIds: ReadonlySet<string>
    role: string
    userId: string
  },
  db: HistoryDb = prisma,
) {
  const { organizationId, hiddenChannelIds } = options
  const contactId = options.contactId || null
  let customerConversationIds: string[] = []
  let messageWhere: Prisma.ChannelMessageWhereInput

  if (contactId) {
    const contact = await db.contact.findFirst({ where: { id: contactId, organizationId }, select: { id: true } })
    if (!contact) return null
    const conversations = await db.socialConversation.findMany({
      where: { organizationId, contactId, deletedAt: null },
      select: { id: true, channelConfigId: true },
      take: 50,
    })
    customerConversationIds = conversations
      .filter((c: { channelConfigId: string | null }) => channelVisible(hiddenChannelIds, c.channelConfigId))
      .map((c: { id: string }) => c.id)
    messageWhere = {
      OR: [
        { contactId },
        ...(customerConversationIds.length ? [{ conversationId: { in: customerConversationIds } }] : []),
      ],
    }
  } else if (options.conversationId) {
    const conversation = await db.socialConversation.findFirst({
      where: { id: options.conversationId, organizationId, deletedAt: null },
      select: { id: true, channelConfigId: true },
    })
    if (!conversation || !channelVisible(hiddenChannelIds, conversation.channelConfigId)) return null
    customerConversationIds = [conversation.id]
    messageWhere = { conversationId: conversation.id }
  } else {
    return null
  }

  const visible = visibleWhere(hiddenChannelIds)
  const rows = await db.channelMessage.findMany({
    where: { AND: [{ organizationId }, messageWhere, ...(visible ? [visible] : [])] },
    orderBy: { createdAt: "desc" },
    take: THREAD_HISTORY_MESSAGES,
  }) as Array<{ id: string; conversationId: string | null; [column: string]: unknown }>

  // A message's conversation has the last word: deleted — it is in the trash; an Instagram/Messenger
  // conversation no longer linked to this customer — it is not his, whatever the row once recorded.
  type HistoryConversation = { id: string; platform: string; contactId: string | null; deletedAt: Date | null }
  const rowConversationIds = [...new Set(rows.map((m) => m.conversationId).filter((id): id is string => Boolean(id)))]
  const conversationRows: HistoryConversation[] = rowConversationIds.length
    ? await db.socialConversation.findMany({
        where: { id: { in: rowConversationIds }, organizationId },
        select: { id: true, platform: true, contactId: true, deletedAt: true },
      })
    : []
  const conversationById = new Map<string, HistoryConversation>(conversationRows.map((c) => [c.id, c]))
  const messages = rows.filter((m) => {
    if (!m.conversationId) return true
    const conversation = conversationById.get(m.conversationId)
    if (!conversation) return true
    if (conversation.deletedAt) return false
    if (contactId && isContactLinkablePlatform(conversation.platform) && conversation.contactId !== contactId) return false
    return true
  })

  const threadConversationIds = [...new Set([
    ...customerConversationIds,
    ...messages.map((m) => m.conversationId).filter((id): id is string => Boolean(id)),
  ])]
  const callVisible = hiddenChannelIds.size > 0
    ? [{ OR: [{ channelConfigId: null }, { channelConfigId: { notIn: [...hiddenChannelIds] } }] }]
    : []
  const callScopes: Prisma.CallLogWhereInput[] = []
  if (threadConversationIds.length) callScopes.push({ conversationId: { in: threadConversationIds } })
  if (contactId) {
    callScopes.push({ AND: [{ contactId, conversationId: null }, accessibleCallWhere(options.role as Role, options.userId)] })
  }
  const calls = callScopes.length
    ? await db.callLog.findMany({
        where: { AND: [{ organizationId }, { OR: callScopes }, ...callVisible] },
        orderBy: { createdAt: "desc" },
        take: THREAD_HISTORY_CALLS,
        select: CALL_SELECT,
      })
    : []

  return {
    messages,
    callLogs: calls.map(exposeCallForClient),
    conversationIds: threadConversationIds,
  }
}
