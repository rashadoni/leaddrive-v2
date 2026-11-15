/**
 * The conversations one customer's feed is made of — his Instagram, his WhatsApp, his Messenger — and
 * which of them a reply goes to by default.
 *
 * The inbox list groups messages by customer, so one thread can hold several stored conversations, one
 * per channel. Every action that belongs to a conversation (reply, assign, close) has to know them all,
 * not only the one the newest message happened to arrive on (owner, 2026-11-15: «Bütün kanallar bir
 * lentdə»). Shared by the list route and the inbox screen.
 */

export type ThreadConversationSummary = {
  /** Conversation and channel together: a contact shell (platform "inbox") can hold e-mail AND Telegram. */
  key: string
  /** The stored conversation (`SocialConversation.id`). Several entries may share it — see `key`. */
  id: string
  /** The channel its messages travel on (`ChannelMessage.channelType`). */
  platform: string
  channelConfigId: string | null
  lastMessageAt: string
  /** When the customer last wrote here; null when only we wrote. */
  lastInboundAt: string | null
  messageCount: number
  unreadCount: number
}

type ThreadMessageLike = {
  conversationId?: string | null
  channelType?: string | null
  channelConfigId?: string | null
  direction?: string | null
  status?: string | null
  createdAt: string | Date
}

const iso = (value: string | Date) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString())
const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : -Infinity)

/** One entry per stored conversation and channel of the thread, most recently active first. */
export function summarizeThreadConversations(messages: readonly ThreadMessageLike[]): ThreadConversationSummary[] {
  const byId = new Map<string, ThreadConversationSummary>()
  for (const message of messages) {
    const id = message.conversationId
    if (!id) continue
    const platform = message.channelType || "email"
    const key = `${id}|${platform}`
    const at = iso(message.createdAt)
    let entry = byId.get(key)
    if (!entry) {
      entry = {
        key,
        id,
        platform,
        channelConfigId: message.channelConfigId ?? null,
        lastMessageAt: at,
        lastInboundAt: null,
        messageCount: 0,
        unreadCount: 0,
      }
      byId.set(key, entry)
    }
    entry.messageCount += 1
    if (time(at) > time(entry.lastMessageAt)) {
      entry.lastMessageAt = at
      // The account the newest message used is the one a reply leaves from.
      entry.channelConfigId = message.channelConfigId ?? entry.channelConfigId
    }
    if (message.direction === "inbound") {
      if (time(at) > time(entry.lastInboundAt)) entry.lastInboundAt = at
      if (message.status !== "read") entry.unreadCount += 1
    }
  }
  return [...byId.values()].sort((a, b) => time(b.lastMessageAt) - time(a.lastMessageAt))
}

/** The distinct stored conversations of a thread — what assign, close and the trash act on. */
export function threadConversationIds(thread: {
  socialConversationId?: string | null
  threadConversations?: ReadonlyArray<{ id: string }> | null
}): string[] {
  return [...new Set([
    thread.socialConversationId,
    ...(thread.threadConversations ?? []).map((tc) => tc.id),
  ].filter((id): id is string => Boolean(id)))]
}

/**
 * Where a reply goes unless the manager picks otherwise: the conversation the customer wrote in last.
 * Only we wrote anywhere — the most recently active one.
 */
export function defaultReplyConversation<T extends Pick<ThreadConversationSummary, "lastInboundAt" | "lastMessageAt">>(
  conversations: readonly T[],
): T | null {
  if (conversations.length === 0) return null
  const withInbound = conversations.filter((c) => c.lastInboundAt)
  const pool = withInbound.length > 0 ? withInbound : conversations
  return pool.reduce((best, c) =>
    time(withInbound.length > 0 ? c.lastInboundAt : c.lastMessageAt)
      > time(withInbound.length > 0 ? best.lastInboundAt : best.lastMessageAt) ? c : best)
}

/** A place a reply can go from a customer's thread: one of his stored conversations, or a bare channel. */
export type ReplyTarget = {
  key: string
  /** What POST /api/v1/inbox calls `channel`. */
  channel: string
  /** The conversation the reply goes through — the server binds recipient and account to it. */
  conversationId: string | null
  channelConfigId: string | null
  customerHandle: string | null
  lastInboundAt: string | null
  lastMessageAt: string | null
}

const NOT_REPLYABLE = new Set(["voip", "call", "all"])

/**
 * Everywhere the manager can answer this customer: each of his conversations (two Instagram accounts are
 * two targets), then any channel of the thread that has no stored conversation (an old e-mail thread).
 * A thread the server sent without its conversations (web chat, an older payload) keeps the one target
 * it always had.
 */
export function replyTargetsOf(thread: {
  channels?: readonly string[] | null
  lastChannel?: string | null
  socialConversationId?: string | null
  threadConversations?: ReadonlyArray<ThreadConversationSummary & { customerHandle?: string | null }> | null
}): ReplyTarget[] {
  const conversations = thread.threadConversations ?? []
  if (conversations.length === 0) {
    const channel = thread.lastChannel || thread.channels?.[0] || "email"
    return [{
      key: `channel:${channel}`,
      channel,
      conversationId: thread.socialConversationId ?? null,
      channelConfigId: null,
      customerHandle: null,
      lastInboundAt: null,
      lastMessageAt: null,
    }]
  }
  const targets: ReplyTarget[] = conversations
    .filter((c) => !NOT_REPLYABLE.has(c.platform))
    .map((c) => ({
      key: c.key,
      channel: c.platform,
      conversationId: c.id,
      channelConfigId: c.channelConfigId,
      customerHandle: c.customerHandle ?? null,
      lastInboundAt: c.lastInboundAt,
      lastMessageAt: c.lastMessageAt,
    }))
  const covered = new Set(targets.map((t) => t.channel))
  for (const channel of thread.channels ?? []) {
    if (covered.has(channel) || NOT_REPLYABLE.has(channel)) continue
    covered.add(channel)
    targets.push({
      key: `channel:${channel}`,
      channel,
      conversationId: null,
      channelConfigId: null,
      customerHandle: null,
      lastInboundAt: null,
      lastMessageAt: null,
    })
  }
  return targets
}

/** The target a reply goes to until the manager picks another: where the customer wrote last. */
export function defaultReplyTarget(targets: readonly ReplyTarget[], lastChannel?: string | null): ReplyTarget | null {
  const stored = targets.filter((t) => t.lastMessageAt)
  const best = defaultReplyConversation(stored as Array<ReplyTarget & { lastMessageAt: string }>)
  return best ?? targets.find((t) => t.channel === lastChannel) ?? targets[0] ?? null
}
