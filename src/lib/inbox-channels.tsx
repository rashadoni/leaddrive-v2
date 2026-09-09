/**
 * Shared omni-channel helpers for the inbox screens.
 *
 * Extracted so the new Whelp-grade workspace (`/inbox/v2`) and any future
 * consumer read ONE channel icon/colour/label map. The legacy `/inbox`
 * page keeps its own inline copy untouched (we don't edit the live screen
 * during this redesign) — once `/inbox/v2` ships and replaces it, the legacy
 * copy is deleted with the legacy page.
 */
import type { ElementType } from "react"
import {
  Mail, MessageCircle, MessageSquare, Phone, Globe,
} from "lucide-react"

/** Channel keys the inbox API emits (see `/api/v1/inbox`). */
export type ChannelKey =
  | "email" | "telegram" | "sms" | "whatsapp" | "facebook"
  | "instagram" | "vkontakte" | "tiktok" | "voip" | "web-chat"

/**
 * Channels offered as filter tabs (`all` is the unfiltered view). Must list
 * every key `ChannelKey` supports so the folders rail can filter any channel
 * the API returns (e.g. `vkontakte` conversations would otherwise show in the
 * list but have no rail filter).
 */
export const CHANNELS = [
  "all", "email", "telegram", "sms", "whatsapp", "facebook", "instagram", "vkontakte", "tiktok", "voip", "web-chat",
] as const

/** Channels an agent can type a reply into (excludes `all` + call-only `voip`). */
export const REPLY_CHANNELS = CHANNELS.filter((c) => c !== "all" && c !== "voip")

const ICONS: Record<string, ElementType> = {
  email: Mail,
  telegram: MessageCircle,
  sms: Phone,
  whatsapp: MessageCircle,
  facebook: MessageSquare,
  instagram: MessageSquare,
  vkontakte: MessageSquare,
  tiktok: MessageSquare,
  voip: Phone,
  "web-chat": Globe,
}

export function ChannelIcon({ channel, className = "h-3.5 w-3.5" }: { channel: string; className?: string }) {
  const Icon = ICONS[channel] ?? MessageSquare
  return <Icon className={className} />
}

export function channelColor(ch: string): string {
  switch (ch) {
    case "email": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
    case "telegram": return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
    case "sms": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
    case "whatsapp": return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    case "facebook": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
    case "instagram": return "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400"
    case "vkontakte": return "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400"
    case "tiktok": return "bg-muted text-foreground"
    case "voip": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
    case "web-chat": return "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
    default: return "bg-muted text-foreground/70"
  }
}

export function channelLabel(ch: string): string {
  switch (ch) {
    case "email": return "Email"
    case "telegram": return "Telegram"
    case "sms": return "SMS"
    case "whatsapp": return "WhatsApp"
    case "facebook": return "Facebook"
    case "instagram": return "Instagram"
    case "vkontakte": return "VKontakte"
    case "tiktok": return "TikTok"
    case "voip": return "VoIP"
    case "web-chat": return "Web Chat"
    case "all": return "All"
    default: return ch
  }
}

/* ── Shared inbox API shapes (mirror `/api/v1/inbox` response) ── */

export interface InboxMessage {
  id: string
  direction: string
  channelType: string
  from: string
  to: string
  subject?: string
  body: string
  status: string
  createdAt: string
  // mediaUrl / messageType are TOP-LEVEL ChannelMessage columns (set by the
  // facebook/whatsapp/etc webhooks on inbound media), NOT inside metadata.
  mediaUrl?: string | null
  messageType?: string
  metadata?: { [k: string]: unknown }
}

export interface InboxCallLog {
  id: string
  direction: string
  fromNumber: string
  toNumber: string
  status: string
  duration?: number | null
  provider?: string | null
  conversationId?: string | null
  channelConfigId?: string | null
  claimedByUserId?: string | null
  claimedAt?: string | null
  queueId?: string | null
  providerCallId?: string | null
  recordingUrl?: string | null
  hasRecording?: boolean
  recordingPlaybackUrl?: string | null
  transcription?: string | null
  insightsAt?: string | null
  notes?: string | null
  providerOutcome?: string | null
  providerDialStatus?: string | null
  providerHangupCause?: string | null
  startedAt?: string | null
  endedAt?: string | null
  createdAt: string
}

/* ── Phase 4b — received attachments (display only; per-channel send is later) ── */

export interface InboxAttachment {
  id: string
  url: string
  type: string // "image" | "document" | "file" | ...
  createdAt: string
}

/**
 * Pull displayable attachments out of a thread's messages — any message with a
 * top-level `mediaUrl` (set by the facebook/whatsapp/etc webhooks on inbound
 * media). Read-only: sending attachments is a later per-channel sub-phase.
 * (No webhook writes a filename yet, so attachments are labelled by type.)
 */
export function extractAttachments(messages: InboxMessage[]): InboxAttachment[] {
  return messages
    .filter((m) => typeof m.mediaUrl === "string" && m.mediaUrl)
    .map((m) => ({
      id: m.id,
      url: m.mediaUrl as string,
      type: m.messageType || "file",
      createdAt: m.createdAt,
    }))
}

export interface InboxConversation {
  contactId: string | null
  contactName: string
  contactEmail: string | null
  contactPhone: string | null
  contactLifecycleStage?: string | null
  telegramChatId: string | null
  lastMessage: string
  lastMessageAt: string
  lastDirection?: string | null
  lastChannel: string
  unreadCount: number
  messageCount: number
  channels: string[]
  messages: InboxMessage[]
  callLogs?: InboxCallLog[]
  // Option-D — present only when the thread is backed by a persisted
  // SocialConversation row (channels that populate ChannelMessage.conversationId).
  socialConversationId?: string | null
  status?: string
  assignedTo?: string | null
  snoozedUntil?: string | null
  folderId?: string | null
  conversationTags?: string[]
  // Close disposition ("won" | "lost" | null) — surfaced in the context panel Details.
  closeOutcome?: string | null
  customerStage?: string | null
  salesCallOutcomes?: string[]
  customerStageSource?: string | null
  customerStageConfidence?: number | null
  customerStageReason?: string | null
  aiSuggestedCustomerStage?: string | null
  aiCustomerStageConfidence?: number | null
  aiCustomerStageReason?: string | null
  linkedLead?: {
    id: string
    assignedTo: string | null
    assignedToName: string | null
    createdAt: string
  } | null
  // Present only for web-chat threads (read from WebChatSession, not ChannelMessage).
  // The send path routes replies for these to WebChatMessage(agent).
  webChatSessionId?: string | null
  // True when the auto-reply bot answered in this thread (server-computed) → drives the "Чат-бот" view.
  botHandled?: boolean
  // Internal collaborators (userIds) added to this conversation — drives the "Со мной" view + avatars.
  // Model B: surfaces + notifies; does NOT restrict visibility; the customer never sees them.
  participants?: string[]
}

export interface InboxStats {
  totalMessages: number
  inbound: number
  outbound: number
  conversations: number
}

function safeInboxText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return fallback
}

/**
 * The inbox combines current Prisma rows with messages imported by older
 * channel integrations. Those legacy payloads are not guaranteed to match the
 * current client shape (an attachment body can be an object, for example).
 * Normalize render-critical fields once at the API boundary so one malformed
 * conversation cannot crash the whole workspace when it is opened.
 */
export function normalizeInboxConversations(value: unknown): InboxConversation[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((candidate, conversationIndex) => {
    if (!candidate || typeof candidate !== "object") return []
    const raw = candidate as Record<string, unknown>
    const rawMessages = Array.isArray(raw.messages) ? raw.messages : []
    const messages: InboxMessage[] = rawMessages.flatMap((candidateMessage) => {
      if (!candidateMessage || typeof candidateMessage !== "object") return []
      const message = candidateMessage as Record<string, unknown>
      const id = safeInboxText(message.id)
      if (!id) return []

      return [{
        ...message,
        id,
        direction: safeInboxText(message.direction),
        channelType: safeInboxText(message.channelType, "email"),
        from: safeInboxText(message.from),
        to: safeInboxText(message.to),
        subject: typeof message.subject === "string" ? message.subject : undefined,
        body: safeInboxText(
          message.body,
          message.mediaUrl ? "[attachment]" : "",
        ),
        status: safeInboxText(message.status),
        createdAt: safeInboxText(message.createdAt, new Date(0).toISOString()),
        mediaUrl: typeof message.mediaUrl === "string" ? message.mediaUrl : null,
        messageType: typeof message.messageType === "string" ? message.messageType : undefined,
        metadata: message.metadata && typeof message.metadata === "object"
          ? message.metadata as Record<string, unknown>
          : undefined,
      } satisfies InboxMessage]
    })
    const channels = Array.isArray(raw.channels)
      ? raw.channels.filter((channel): channel is string => typeof channel === "string")
      : []

    return [{
      ...raw,
      contactId: typeof raw.contactId === "string" ? raw.contactId : null,
      contactName: safeInboxText(raw.contactName, `Unknown contact ${conversationIndex + 1}`),
      contactEmail: typeof raw.contactEmail === "string" ? raw.contactEmail : null,
      contactPhone: typeof raw.contactPhone === "string" ? raw.contactPhone : null,
      telegramChatId: typeof raw.telegramChatId === "string" ? raw.telegramChatId : null,
      lastMessage: safeInboxText(raw.lastMessage),
      lastMessageAt: safeInboxText(raw.lastMessageAt, new Date(0).toISOString()),
      lastChannel: safeInboxText(raw.lastChannel, channels[0] ?? "email"),
      unreadCount: typeof raw.unreadCount === "number" ? raw.unreadCount : 0,
      messageCount: typeof raw.messageCount === "number" ? raw.messageCount : messages.length,
      channels,
      messages,
    } as InboxConversation]
  })
}

/**
 * Deterministic avatar tint from a name (so each contact gets a stable colour
 * in the list + thread + context panel without storing one). Tailwind-literal
 * classes so they survive purge.
 */
const AVATAR_TINTS = [
  "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500",
  "bg-teal-500", "bg-sky-500", "bg-indigo-500", "bg-violet-500", "bg-fuchsia-500",
]

export function avatarTint(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length]
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/* ── Phase 4 — quick replies from the org's TicketMacro library ── */

export interface MacroLike {
  id: string
  name: string
  actions?: { type: string; value: string }[]
}

export interface QuickReply {
  id: string
  name: string
  text: string
}

/**
 * A macro's first `add_comment` action is its canned reply text — reuse the
 * existing TicketMacro library as inbox quick-replies (no new model). Macros
 * with no `add_comment` action (pure status/tag automations) are dropped, since
 * there's nothing to insert into the composer.
 */
export function extractQuickReplies(macros: MacroLike[]): QuickReply[] {
  return macros
    .map((m) => ({
      id: m.id,
      name: m.name,
      text: m.actions?.find((a) => a.type === "add_comment")?.value ?? "",
    }))
    .filter((q) => q.text.length > 0)
}

/* ── Phase 3 — contact tag mutations (pure, so the inbox panel + tests share them) ── */

/** Append a trimmed tag; no-op (returns the SAME array) when blank or duplicate. */
export function appendTag(tags: string[], raw: string): string[] {
  const t = raw.trim()
  if (!t || tags.includes(t)) return tags
  return [...tags, t]
}

/** Remove a tag by exact value. */
export function dropTag(tags: string[], tag: string): string[] {
  return tags.filter((x) => x !== tag)
}

/* ── Phase 2 — conversation status tabs (opened / closed / snoozed) ── */

export type ConvStatusTab = "opened" | "closed" | "snoozed"

/**
 * Which status tab a conversation belongs to, from its surfaced
 * SocialConversation state (Option-D). An active snooze (snoozedUntil in the
 * future) wins over the open/closed split. Conversations with no persisted state
 * (status undefined — channels not backed by a SocialConversation row) are
 * treated as "opened": they're live threads, just not yet persisted.
 */
export function convStatusTab(
  c: { status?: string; snoozedUntil?: string | null },
  nowMs: number,
): ConvStatusTab {
  if (c.snoozedUntil && new Date(c.snoozedUntil).getTime() > nowMs) return "snoozed"
  if (c.status === "resolved" || c.status === "archived") return "closed"
  return "opened"
}

/* ── Phase 2c — folder views by assignment ── */

export type InboxView = "all" | "me" | "unassigned" | "others" | "chatbot" | "participating" | "spam" | "trash"

/**
 * Whether a conversation matches the selected folder view, by its surfaced
 * `assignedTo` (Option-D). "all" matches everything; me / unassigned / others
 * split on assignment vs the current user. chatbot/spam are later phases — they
 * match nothing here (callers keep those views disabled).
 */
export function convMatchesView(
  c: { assignedTo?: string | null; botHandled?: boolean; participants?: string[] },
  view: InboxView,
  myUserId: string | null,
): boolean {
  switch (view) {
    case "all": return true
    case "me": return !!myUserId && c.assignedTo === myUserId
    case "unassigned": return c.assignedTo == null
    case "others": return c.assignedTo != null && c.assignedTo !== myUserId
    case "chatbot": return c.botHandled === true // threads the auto-reply bot answered
    case "participating": return !!myUserId && (c.participants?.includes(myUserId) ?? false) // I'm a collaborator
    // The server already returned exactly the deleted threads for this view, so
    // filtering again here would be filtering twice. It did worse than that:
    // "trash" fell to the default below and every deleted thread was hidden, so
    // the trash was ALWAYS empty and a deleted conversation looked destroyed.
    case "trash": return true
    default: return false // spam — later phase
  }
}
