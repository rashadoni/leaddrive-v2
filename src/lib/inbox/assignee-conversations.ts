/**
 * The server half of the inbox's «Ответственный» filter (`assignee-filter.ts` holds the rules the
 * screen shares).
 *
 * The inbox list is built from the organization's newest messages (`PAGE_SIZE.INBOX`), so a
 * conversation nobody wrote in lately is simply not in it. Filtering that list on the screen would
 * show «the conversations of Leyla» as the dozen that happen to be recent, the manager would move
 * those — and believe it was all of them. So when the list is asked for one person, her open
 * conversations that fell out of the window are read here from the conversation rows themselves
 * and added as rows without messages; opening one reads its history as usual
 * (`GET /api/v1/inbox/thread`).
 *
 * Closed conversations are not added: there may be years of them, and the reason to look at one
 * person's conversations is to hand over what is still being worked on. The «closed» tab under the
 * filter therefore holds what the list's window holds, as it does without the filter.
 */

import { prisma } from "@/lib/prisma"
import { CLOSED_CONVERSATION_STATUSES, type InboxAssigneeHolder } from "@/lib/inbox/assignee-filter"

/** How many conversations outside the window one request adds, newest first. */
export const ASSIGNEE_QUIET_LIMIT = 300

const NOT_CLOSED = CLOSED_CONVERSATION_STATUSES.map((status) => ({
  status: { equals: status, mode: "insensitive" as const },
}))

/**
 * A website chat's row in `social_conversations` (`platform "inbox"`, `externalId "w:<session>"`)
 * only carries its labels and folder; who answers a website chat is on the `WebChatSession`.
 */
const WEB_CHAT_SHELL = { platform: "inbox", externalId: { startsWith: "w:" } }

type VisibleChannels = Record<string, unknown> | undefined

/**
 * Everyone who holds an open conversation the caller may see — including people who no longer work
 * here. Their conversations are the ones nobody answers, and the assign list (active accounts
 * only) cannot name them.
 */
export async function loadInboxAssigneeHolders(input: {
  organizationId: string
  visibleChannels: VisibleChannels
}): Promise<InboxAssigneeHolder[]> {
  const { organizationId, visibleChannels } = input
  const conversationHolders: Array<{ assignedTo: string | null }> = await prisma.socialConversation.groupBy({
    by: ["assignedTo"],
    where: {
      organizationId,
      assignedTo: { not: null },
      deletedAt: null,
      NOT: [...NOT_CLOSED, WEB_CHAT_SHELL],
      ...(visibleChannels ? { AND: [visibleChannels] } : {}),
    },
    _count: { _all: true },
  })
  const chatHolders: Array<{ assignedUserId: string | null }> = await prisma.webChatSession.groupBy({
    by: ["assignedUserId"],
    where: {
      organizationId,
      assignedUserId: { not: null },
      NOT: { status: { equals: "closed", mode: "insensitive" } },
    },
    _count: { _all: true },
  })
  const ids = [...new Set([
    ...conversationHolders.map((row) => row.assignedTo),
    ...chatHolders.map((row) => row.assignedUserId),
  ].filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return []

  const users: Array<{ id: string; name: string | null; isActive: boolean; anonymizedAt: Date | null }> =
    await prisma.user.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true, isActive: true, anonymizedAt: true },
    })
  const byId = new Map(users.map((user) => [user.id, user]))
  return ids.map((id) => {
    const user = byId.get(id)
    // The column is a bare string: an id that is no user of this organization is held by nobody.
    if (!user || user.anonymizedAt) return { id, name: null, active: false, removed: true }
    return { id, name: user.name?.trim() || null, active: user.isActive, removed: false }
  })
}

type ContactLike = { id: string; fullName: string | null; email: string | null; phone: string | null; lifecycleStage: string | null }

/** One conversation of the person that the list's window did not hold, in the list's row shape. */
export type AssigneeQuietThread = {
  channelConfigId: string | null
  contactId: string | null
  contactName: string
  contactEmail: string | null
  contactPhone: string | null
  contactLifecycleStage: string | null
  telegramChatId: string | null
  lastMessage: string
  lastMessageAt: Date
  lastDirection: string | null
  lastChannel: string
  unreadCount: number
  messageCount: number
  channels: string[]
  botHandled: boolean
  messages: unknown[]
  socialConversationId: string
  conversationTags: string[]
  closeOutcome: string | null
  customerStage: string | null
  salesCallOutcomes: string[]
  customerStageSource: string | null
  customerStageConfidence: number | null
  customerStageReason: string | null
  aiSuggestedCustomerStage: string | null
  aiCustomerStageConfidence: number | null
  aiCustomerStageReason: string | null
  participants: string[]
  status: string
  assignedTo: string | null
  snoozedUntil: Date | null
  folderId: string | null
}

type QuietRow = {
  id: string
  channelConfigId: string | null
  platform: string
  externalId: string
  contactId: string | null
  contactName: string | null
  status: string
  assignedTo: string | null
  snoozedUntil: Date | null
  folderId: string | null
  tags: string[] | null
  closeOutcome: string | null
  customerStage: string | null
  salesCallOutcomes: string[] | null
  customerStageSource: string | null
  customerStageConfidence: number | null
  customerStageReason: string | null
  aiSuggestedCustomerStage: string | null
  aiCustomerStageConfidence: number | null
  aiCustomerStageReason: string | null
  lastMessage: string | null
  lastMessageAt: Date
  metadata: unknown
}

type NewestMessage = {
  conversationId: string | null
  body: string | null
  direction: string
  createdAt: Date
  channelType: string
  channelConfigId: string | null
}

function metadataChannel(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const channel = (metadata as Record<string, unknown>).channel
  return typeof channel === "string" && channel ? channel : null
}

/**
 * The person's open conversations that are not in the list already, newest first.
 * `more` — there are further ones beyond `ASSIGNEE_QUIET_LIMIT`.
 */
export async function loadAssigneeQuietThreads(input: {
  organizationId: string
  assigneeId: string
  /** The list's own channel filter ("whatsapp", …), or null for every channel. */
  channel: string | null
  visibleChannels: VisibleChannels
  /** Conversations the list holds already (as a thread's own or as one of its channels) or dropped as deleted. */
  knownConversationIds: ReadonlySet<string>
  contactById: Readonly<Record<string, ContactLike | undefined>>
}): Promise<{ threads: AssigneeQuietThread[]; more: boolean }> {
  const { organizationId, assigneeId, visibleChannels, knownConversationIds, contactById } = input
  const channel = input.channel && input.channel !== "all" ? input.channel : null
  // A website chat is read from its session, never from here.
  if (channel === "web-chat") return { threads: [], more: false }

  // An e-mail or SMS thread's row is `platform "inbox"` with the channel's own name in its metadata.
  const onChannel = channel
    ? { OR: [{ platform: channel }, { platform: "inbox", metadata: { path: ["channel"], equals: channel } }] }
    : null
  const rows: QuietRow[] = await prisma.socialConversation.findMany({
    where: {
      organizationId,
      assignedTo: assigneeId,
      deletedAt: null,
      NOT: [...NOT_CLOSED, WEB_CHAT_SHELL],
      AND: [...(visibleChannels ? [visibleChannels] : []), ...(onChannel ? [onChannel] : [])],
      ...(knownConversationIds.size > 0 ? { id: { notIn: [...knownConversationIds] } } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: ASSIGNEE_QUIET_LIMIT + 1,
    select: {
      id: true,
      channelConfigId: true,
      platform: true,
      externalId: true,
      contactId: true,
      contactName: true,
      status: true,
      assignedTo: true,
      snoozedUntil: true,
      folderId: true,
      tags: true,
      closeOutcome: true,
      customerStage: true,
      salesCallOutcomes: true,
      customerStageSource: true,
      customerStageConfidence: true,
      customerStageReason: true,
      aiSuggestedCustomerStage: true,
      aiCustomerStageConfidence: true,
      aiCustomerStageReason: true,
      lastMessage: true,
      lastMessageAt: true,
      metadata: true,
    },
  })
  const more = rows.length > ASSIGNEE_QUIET_LIMIT
  const page = rows.slice(0, ASSIGNEE_QUIET_LIMIT)
  if (page.length === 0) return { threads: [], more: false }

  // What was said last. An e-mail or SMS thread's row keeps no preview of its own; the newest
  // message of each conversation does. Bounded: a conversation whose newest message is not among
  // these falls back to what its row says.
  const pageIds = page.map((row) => row.id)
  const newest: NewestMessage[] = await prisma.channelMessage.findMany({
    where: { organizationId, conversationId: { in: pageIds } },
    orderBy: { createdAt: "desc" },
    take: Math.min(pageIds.length * 4, 1000),
    select: { conversationId: true, body: true, direction: true, createdAt: true, channelType: true, channelConfigId: true },
  })
  const lastByConversation = new Map<string, NewestMessage>()
  for (const message of newest) {
    if (message.conversationId && !lastByConversation.has(message.conversationId)) {
      lastByConversation.set(message.conversationId, message)
    }
  }

  const participantRows: Array<{ socialConversationId: string; userId: string }> =
    await prisma.conversationParticipant.findMany({
      where: { organizationId, socialConversationId: { in: pageIds } },
      select: { socialConversationId: true, userId: true },
    })
  const participantsByConversation = new Map<string, string[]>()
  for (const row of participantRows) {
    participantsByConversation.set(row.socialConversationId, [...(participantsByConversation.get(row.socialConversationId) ?? []), row.userId])
  }

  const threads: AssigneeQuietThread[] = page.map((row) => {
    const last = lastByConversation.get(row.id)
    const lastChannel = row.platform === "inbox"
      ? (last?.channelType || metadataChannel(row.metadata) || "email")
      : row.platform
    const contact = row.contactId ? contactById[row.contactId] : undefined
    const whatsappPhone = row.platform === "whatsapp" ? row.externalId : null
    return {
      channelConfigId: last?.channelConfigId ?? row.channelConfigId,
      contactId: contact ? contact.id : null,
      contactName: contact?.fullName?.trim() || row.contactName?.trim() || whatsappPhone || contact?.email || "—",
      contactEmail: contact?.email ?? null,
      contactPhone: contact?.phone ?? whatsappPhone,
      contactLifecycleStage: contact?.lifecycleStage ?? null,
      telegramChatId: null,
      lastMessage: (last?.body || row.lastMessage || "").slice(0, 100),
      lastMessageAt: last?.createdAt ?? row.lastMessageAt,
      lastDirection: last?.direction ?? null,
      lastChannel,
      // The list counts unread from the messages it holds; this row holds none.
      unreadCount: 0,
      messageCount: 0,
      channels: [lastChannel],
      botHandled: false,
      messages: [],
      socialConversationId: row.id,
      conversationTags: row.tags ?? [],
      closeOutcome: row.closeOutcome,
      customerStage: row.customerStage,
      salesCallOutcomes: row.salesCallOutcomes ?? [],
      customerStageSource: row.customerStageSource,
      customerStageConfidence: row.customerStageConfidence,
      customerStageReason: row.customerStageReason,
      aiSuggestedCustomerStage: row.aiSuggestedCustomerStage,
      aiCustomerStageConfidence: row.aiCustomerStageConfidence,
      aiCustomerStageReason: row.aiCustomerStageReason,
      participants: participantsByConversation.get(row.id) ?? [],
      status: row.status,
      assignedTo: row.assignedTo,
      snoozedUntil: row.snoozedUntil,
      folderId: row.folderId,
    }
  })
  return { threads, more }
}
