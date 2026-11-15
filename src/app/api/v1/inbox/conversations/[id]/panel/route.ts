import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { hiddenChannelIdsFor, visibleChannelWhere, withConversationChannelAccess } from "@/lib/inbox/channel-access"
import { aiReplyEnabled } from "@/lib/inbox/reply-mode"
import { buildJourney, type JourneyCall, type JourneyMessage } from "@/lib/inbox/customer-journey"

type ConversationRow = { id: string; platform: string; metadata: unknown; createdAt: Date }

const CONVERSATIONS_MAX = 20
const MESSAGES_MAX = 400
const CALLS_MAX = 50

function channelOf(conversation: { platform: string; metadata: unknown }): string {
  if (conversation.platform !== "inbox") return conversation.platform
  const meta = conversation.metadata && typeof conversation.metadata === "object" && !Array.isArray(conversation.metadata)
    ? conversation.metadata as Record<string, unknown>
    : {}
  return typeof meta.channel === "string" && meta.channel ? meta.channel : "inbox"
}

/**
 * What the inbox panel shows beside a conversation that the thread itself does not carry
 * (owner, 2026-11-15, the dense-inbox mock-up): the customer's path across channels, since when he
 * writes, on which channels, and the conversation's «AI rejimi». Deals and reminders come from their
 * own routes (`/deals?contactId=`, `/tasks?relatedType=`), each with its own module and record
 * access — this route reads only inbox data, and only on channels the person may see.
 */
export const GET = withRlsAuth("inbox", "read", withConversationChannelAccess(async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const orgId = auth.orgId
  const conversation = await prisma.socialConversation.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true, platform: true, metadata: true, contactId: true, channelConfigId: true, createdAt: true,
      autoReplyOffAt: true, autoReplyOffBy: true,
      channelConfig: { select: { settings: true } },
    },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const hidden = await hiddenChannelIdsFor(auth)
  const visible = visibleChannelWhere(hidden)
  const conversations: ConversationRow[] = conversation.contactId
    ? await prisma.socialConversation.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          OR: [{ id: conversation.id }, { contactId: conversation.contactId }],
          ...(visible ? { AND: [visible] } : {}),
        },
        orderBy: { lastMessageAt: "desc" },
        take: CONVERSATIONS_MAX,
        select: { id: true, platform: true, metadata: true, createdAt: true },
      })
    : [{ id: conversation.id, platform: conversation.platform, metadata: conversation.metadata, createdAt: conversation.createdAt }]
  if (!conversations.some((row: ConversationRow) => row.id === conversation.id)) {
    conversations.push({ id: conversation.id, platform: conversation.platform, metadata: conversation.metadata, createdAt: conversation.createdAt })
  }
  const ids = conversations.map((row: ConversationRow) => row.id)
  const channels = new Map<string, string>(conversations.map((row: ConversationRow) => [row.id, channelOf(row)] as [string, string]))

  const [messages, calls, first, contact, offBy] = await Promise.all([
    prisma.channelMessage.findMany({
      where: { organizationId: orgId, conversationId: { in: ids } },
      orderBy: { createdAt: "desc" },
      take: MESSAGES_MAX,
      select: { id: true, conversationId: true, direction: true, body: true, messageType: true, createdAt: true, metadata: true },
    }),
    prisma.callLog.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { conversationId: { in: ids } },
          ...(conversation.contactId ? [{ contactId: conversation.contactId }] : []),
        ],
        ...(visible ? { AND: [visible] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: CALLS_MAX,
      select: { id: true, conversationId: true, direction: true, status: true, provider: true, duration: true, startedAt: true, createdAt: true },
    }),
    prisma.channelMessage.aggregate({
      where: { organizationId: orgId, conversationId: { in: ids } },
      _min: { createdAt: true },
    }),
    conversation.contactId
      ? prisma.contact.findFirst({
          where: { id: conversation.contactId, organizationId: orgId },
          select: { id: true, createdAt: true, preferredLanguage: true },
        })
      : Promise.resolve(null),
    conversation.autoReplyOffBy
      ? prisma.user.findFirst({ where: { id: conversation.autoReplyOffBy, organizationId: orgId }, select: { name: true, email: true } })
      : Promise.resolve(null),
  ])

  const journeyMessages: JourneyMessage[] = (messages as Array<Omit<JourneyMessage, "conversationId"> & { conversationId: string | null }>)
    .flatMap((message) => message.conversationId ? [{ ...message, conversationId: message.conversationId }] : [])
  const journeyCalls: JourneyCall[] = calls
  const journey = buildJourney({
    messages: journeyMessages,
    calls: journeyCalls,
    channelOf: (conversationId: string) => channels.get(conversationId) ?? "inbox",
    currentConversationId: conversation.id,
  })

  const sinceCandidates = [first._min.createdAt, contact?.createdAt, ...conversations.map((row: ConversationRow) => row.createdAt)]
    .filter((value): value is Date => value instanceof Date)
  const since = sinceCandidates.length ? new Date(Math.min(...sinceCandidates.map((value) => value.getTime()))) : null

  const platform = channelOf(conversation)
  const settings = conversation.channelConfig?.settings
  const replyMode = settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).replyMode
    : undefined

  return NextResponse.json({
    success: true,
    data: {
      since: since ? since.toISOString() : null,
      channels: [...new Set([...channels.values(), ...journeyCalls.map((call) => call.provider === "whatsapp" ? "whatsapp-call" : "voip")])],
      language: contact?.preferredLanguage ?? null,
      journey,
      autoReply: {
        off: conversation.autoReplyOffAt !== null,
        offAt: conversation.autoReplyOffAt ? conversation.autoReplyOffAt.toISOString() : null,
        offByName: offBy ? (offBy.name || offBy.email) : null,
        // Whether the AI answers on this channel at all (`replyMode`; WhatsApp is on unless set to agent).
        channelAi: aiReplyEnabled(typeof replyMode === "string" ? replyMode : null, platform === "whatsapp"),
      },
    },
  })
}))
