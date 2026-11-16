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
 *
 * And the handing over itself, when it is everything at once: `transferOpenConversations`.
 *
 * Without the filter the same rows are added for one more case: the conversations a WhatsApp
 * history import wrote (`lib/whatsapp-history-import`). An import brings months of conversations at
 * once, each with its own old date, so all but the newest few fall below the window — on 16.11.2026
 * the import screen counted 348 conversations and the list showed about fifty of them (owner: «тут
 * не все диалоги»).
 */

import type { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { CLOSED_CONVERSATION_STATUSES, type InboxAssigneeHolder } from "@/lib/inbox/assignee-filter"

/** How many conversations outside the window one request adds, newest first. */
export const ASSIGNEE_QUIET_LIMIT = 300

/** The same for the conversations a WhatsApp history import wrote: six months of a busy number. */
export const HISTORY_IMPORT_QUIET_LIMIT = 500

/**
 * Whose conversations outside the window are added: one person's (the «Ответственный» filter), or
 * the ones a WhatsApp history import wrote on these numbers (`metadata.historyImport`, set only on a
 * conversation the import itself created).
 */
export type QuietThreadScope =
  | { assigneeId: string }
  | { historyImportChannelIds: readonly string[] }

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
 * The open conversations a caller may see — ONE condition for the three things that must agree: who
 * the filter names and how many each holds, what the list adds for one person, and what «hand over
 * all» moves. A count on the button that the press does not move would be a lie told in a number.
 */
function openConversationsWhere(
  organizationId: string,
  visibleChannels: VisibleChannels,
  also: Array<Record<string, unknown>> = [],
) {
  const and = [...(visibleChannels ? [visibleChannels] : []), ...also]
  return {
    organizationId,
    deletedAt: null,
    NOT: [...NOT_CLOSED, WEB_CHAT_SHELL],
    ...(and.length > 0 ? { AND: and } : {}),
  }
}

/** The open website chats (`WebChatSession.status`: open, closed, escalated) — the same for all three. */
function openWebChatsWhere(organizationId: string) {
  return { organizationId, NOT: { status: { equals: "closed", mode: "insensitive" as const } } }
}

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
  const conversationHolders: Array<{ assignedTo: string | null; _count: { _all: number } }> =
    await prisma.socialConversation.groupBy({
      by: ["assignedTo"],
      where: { ...openConversationsWhere(organizationId, visibleChannels), assignedTo: { not: null } },
      _count: { _all: true },
    })
  const chatHolders: Array<{ assignedUserId: string | null; _count: { _all: number } }> =
    await prisma.webChatSession.groupBy({
      by: ["assignedUserId"],
      where: { ...openWebChatsWhere(organizationId), assignedUserId: { not: null } },
      _count: { _all: true },
    })
  const open = new Map<string, number>()
  for (const row of conversationHolders) {
    if (row.assignedTo) open.set(row.assignedTo, (open.get(row.assignedTo) ?? 0) + row._count._all)
  }
  for (const row of chatHolders) {
    if (row.assignedUserId) open.set(row.assignedUserId, (open.get(row.assignedUserId) ?? 0) + row._count._all)
  }
  const ids = [...open.keys()]
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
    if (!user || user.anonymizedAt) return { id, name: null, active: false, removed: true, open: open.get(id) ?? 0 }
    return { id, name: user.name?.trim() || null, active: user.isActive, removed: false, open: open.get(id) ?? 0 }
  })
}

/**
 * «Hand over all»: every open conversation and website chat one person holds goes to another, in
 * one transaction — however many there are. The selection on the screen carries fifty at a time
 * (`MAX_BULK_IDS`), and a manager who left with three hundred is not handed over in six careful
 * rounds; the rounds are where conversations get forgotten.
 *
 * What moves is what the filter counts for the person (`openConversationsWhere`): closed ones and
 * the trash stay with whoever held them, a number hidden from the caller is, to him, not there.
 * Only the owner changes — status, folder, labels, snooze and a website chat's `aiPaused` stay, as
 * in the handover on deleting a user (lib/user-work-handover): a chat the person answered herself
 * stays a person's, and an AI somebody switched back on by hand stays on. (The bulk «assign»
 * pauses the AI because there a person takes a chat from nobody; here she takes it from a person.)
 *
 * `fromUserId` is whatever the column holds — a deleted account's id or an id that is no user at
 * all are exactly the conversations that most need a new owner. `toUserId` is the caller's to
 * check: it must be somebody who can answer.
 */
export async function transferOpenConversations(input: {
  organizationId: string
  fromUserId: string
  toUserId: string
  actorUserId: string
  visibleChannels: VisibleChannels
}): Promise<{ conversations: number; webChats: number }> {
  const { organizationId, fromUserId, toUserId, actorUserId, visibleChannels } = input
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const conversations = await tx.socialConversation.updateMany({
      where: { ...openConversationsWhere(organizationId, visibleChannels), assignedTo: fromUserId },
      data: { assignedTo: toUserId },
    })
    const webChats = await tx.webChatSession.updateMany({
      where: { ...openWebChatsWhere(organizationId), assignedUserId: fromUserId },
      data: { assignedUserId: toUserId },
    })
    const moved = { conversations: conversations.count, webChats: webChats.count }
    // Nobody can list afterwards which conversations these were — the old owner is on none of them.
    // The journal row is the only trace, so it is written with the move or the move does not happen.
    if (moved.conversations + moved.webChats > 0) {
      await logAudit(
        organizationId,
        "bulk_update",
        "conversation",
        fromUserId,
        `Inbox handover: ${moved.conversations} conversations and ${moved.webChats} website chats`,
        { userId: actorUserId, oldValue: { assignedTo: fromUserId }, newValue: { assignedTo: toUserId, ...moved } },
        tx,
      )
    }
    return moved
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
  /** The newest message came with the WhatsApp Business app's history (lib/inbox/dense-inbox). */
  lastFromHistory: boolean
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
  /** Came over with the WhatsApp Business app's history — the list marks it «idxal». */
  historyImport: boolean
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
  historyImportedAt: Date | null
}

function metadataFlag(metadata: unknown, key: string): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false
  return (metadata as Record<string, unknown>)[key] === true
}

function metadataChannel(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const channel = (metadata as Record<string, unknown>).channel
  return typeof channel === "string" && channel ? channel : null
}

/**
 * The open conversations of `scope` that are not in the list already, newest first.
 * `more` — there are further ones beyond the scope's limit.
 */
export async function loadQuietThreads(input: {
  organizationId: string
  scope: QuietThreadScope
  /** The list's own channel filter ("whatsapp", …), or null for every channel. */
  channel: string | null
  visibleChannels: VisibleChannels
  /** Conversations the list holds already (as a thread's own or as one of its channels) or dropped as deleted. */
  knownConversationIds: ReadonlySet<string>
  contactById: Readonly<Record<string, ContactLike | undefined>>
}): Promise<{ threads: AssigneeQuietThread[]; more: boolean }> {
  const { organizationId, scope, visibleChannels, knownConversationIds, contactById } = input
  const byPerson = "assigneeId" in scope
  if (!byPerson && scope.historyImportChannelIds.length === 0) return { threads: [], more: false }
  const limit = byPerson ? ASSIGNEE_QUIET_LIMIT : HISTORY_IMPORT_QUIET_LIMIT
  const scoped = byPerson
    ? { assignedTo: scope.assigneeId }
    : {
        channelConfigId: { in: [...scope.historyImportChannelIds] },
        metadata: { path: ["historyImport"], equals: true },
      }
  const channel = input.channel && input.channel !== "all" ? input.channel : null
  // A website chat is read from its session, never from here.
  if (channel === "web-chat") return { threads: [], more: false }

  // An e-mail or SMS thread's row is `platform "inbox"` with the channel's own name in its metadata.
  const onChannel = channel
    ? { OR: [{ platform: channel }, { platform: "inbox", metadata: { path: ["channel"], equals: channel } }] }
    : null
  const rows: QuietRow[] = await prisma.socialConversation.findMany({
    where: {
      ...openConversationsWhere(organizationId, visibleChannels, [...(onChannel ? [onChannel] : []), scoped]),
      ...(knownConversationIds.size > 0 ? { id: { notIn: [...knownConversationIds] } } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit + 1,
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
  const more = rows.length > limit
  const page = rows.slice(0, limit)
  if (page.length === 0) return { threads: [], more: false }

  // What was said last. An e-mail or SMS thread's row keeps no preview of its own; the newest
  // message of each conversation does. Bounded: a conversation whose newest message is not among
  // these falls back to what its row says.
  const pageIds = page.map((row) => row.id)
  const newest: NewestMessage[] = await prisma.channelMessage.findMany({
    where: { organizationId, conversationId: { in: pageIds } },
    orderBy: { createdAt: "desc" },
    take: Math.min(pageIds.length * 4, 1000),
    select: { conversationId: true, body: true, direction: true, createdAt: true, channelType: true, channelConfigId: true, historyImportedAt: true },
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
      // Without its newest message at hand, a conversation the import made is taken as the import left it.
      lastFromHistory: last ? last.historyImportedAt != null : metadataFlag(row.metadata, "historyImport"),
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
      historyImport: metadataFlag(row.metadata, "historyImport"),
    }
  })
  return { threads, more }
}
