/**
 * Which of our accounts a conversation reached, and which address the customer writes from.
 *
 * The inbox card said «WhatsApp» and nothing else. That was enough while a workspace had one number
 * per platform; on 2026-11-10 LeadDrive Inc. had three WhatsApp channels at once — one of them a
 * coexistence number whose inbound the webhook deliberately holds back (lib/inbox/whatsapp-reply-hold)
 * — so «which number» decides whether automation answers at all, and the thread did not say (owner:
 * «в омни канале не показывает на какой ватсап номер пишут и с какого пишут, также и другие
 * платформы»). Facebook and Instagram have the same question with several pages connected.
 *
 * One field, read from the message's `channelConfigId`, for every platform. The per-platform part is
 * confined to the two tables below, because `from`/`to` genuinely do not hold the same kind of thing
 * on every channel — and nothing here invents an address: a column that holds a name or an opaque
 * platform id yields nothing rather than something that looks like an address and is not one.
 */

import { channelNumber } from "@/lib/channels/channel-number-label"

export type InboxChannelAccount = {
  /** The `ChannelConfig` row — what the inbox rail filters a number or a page by. */
  id: string | null
  channelType: string | null
  /** What «Ayarlar → Kanallar» calls this channel — the same `configName` that screen prints. */
  name: string | null
  number: string | null
  /** True when `number` is Meta's internal id; the screen puts the «Meta ID» word in front of it. */
  numberIsMetaId: boolean
}

/** The columns this reader needs. The route's `select` is what actually fetches them. */
export type InboxChannelRow = {
  id: string
  channelType?: string | null
  configName?: string | null
  displayName?: string | null
  phoneNumber?: string | null
  settings?: unknown
}

export type InboxChannelMessageLike = {
  direction?: string | null
  channelType?: string | null
  channelConfigId?: string | null
  from?: string | null
  to?: string | null
  metadata?: unknown
  createdAt?: Date | string | null
}

export type InboxChannelConversationLike = {
  /** The thread's own channel binding, when a SocialConversation row carries one. */
  channelConfigId?: string | null
  messages?: unknown
}

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {}

/** Reads as something a person could write to or dial — an e-mail address or a phone number. */
function addressLike(value: string): boolean {
  if (value.includes("@")) return value.length <= 254
  return /^\+?[\d][\d\s().-]{5,}$/.test(value) && value.replace(/\D/g, "").length >= 6
}

/**
 * Where the customer writes from, as this channel records it.
 *
 * WhatsApp puts the profile NAME in `from` and keeps the number in `metadata.waPhone`; Telegram does
 * the same and keeps `@username` in metadata; SMS and e-mail are the plain case. Facebook, Instagram,
 * VK and TikTok write an opaque sender id (a PSID/IGSID is sixteen digits and reads like a phone
 * number) — there is no address to show there, so the card shows none and the name above it stands.
 */
function customerAddressOf(message: InboxChannelMessageLike): string | null {
  const meta = asRecord(message.metadata)
  switch (message.channelType) {
    case "whatsapp":
      return text(meta.waPhone)
    case "telegram": {
      const username = text(meta.username)
      if (!username) return null
      return username.startsWith("@") ? username : `@${username}`
    }
    case "sms":
    case "email": {
      const value = message.direction === "inbound" ? text(message.from) : text(message.to)
      return value && addressLike(value) ? value : null
    }
    default:
      return null
  }
}

/**
 * Our own address on a channel that has no `ChannelConfig` row to name.
 *
 * Inbound SMS is written without a `channelConfigId` at all (the sms-inbound webhook), and its `to` is
 * literally the number the customer texted — the one thing the operator is asking about. Limited to
 * the two channels whose `to` is an address: on WhatsApp it is the word "system", on Telegram "bot",
 * on Meta a page id.
 */
function arrivalAddressOf(message: InboxChannelMessageLike): string | null {
  if (message.direction !== "inbound") return null
  if (message.channelType !== "sms" && message.channelType !== "email") return null
  const value = text(message.to)
  return value && addressLike(value) ? value : null
}

function newestFirst(messages: unknown): InboxChannelMessageLike[] {
  if (!Array.isArray(messages)) return []
  const at = (message: InboxChannelMessageLike) => {
    const value = message.createdAt ? new Date(message.createdAt).getTime() : NaN
    return Number.isFinite(value) ? value : 0
  }
  return [...messages as InboxChannelMessageLike[]]
    .filter((message) => message && typeof message === "object")
    .sort((a, b) => at(b) - at(a))
}

/**
 * The channel this thread is on: the one its most recent message came through, never "the first
 * active channel of that platform". A thread merged onto one contact can hold messages from two of
 * the workspace's numbers, and the recent one is the one a reply would leave from.
 */
export function conversationChannelConfigId(conversation: InboxChannelConversationLike): string | null {
  for (const message of newestFirst(conversation.messages)) {
    const id = text(message.channelConfigId)
    if (id) return id
  }
  return text(conversation.channelConfigId)
}

export function conversationCustomerAddress(conversation: InboxChannelConversationLike): string | null {
  for (const message of newestFirst(conversation.messages)) {
    const address = customerAddressOf(message)
    if (address) return address
  }
  return null
}

function conversationArrivalAddress(conversation: InboxChannelConversationLike): string | null {
  for (const message of newestFirst(conversation.messages)) {
    const address = arrivalAddressOf(message)
    if (address) return address
  }
  return null
}

export function channelAccountOf(row: InboxChannelRow): InboxChannelAccount {
  const number = channelNumber(row)
  return {
    id: row.id,
    channelType: text(row.channelType),
    // The settings row prints `configName`; the two screens must say the same name for the same
    // channel, so `displayName` is only a fallback for a row saved without one.
    name: text(row.configName) ?? text(row.displayName),
    number: number?.value ?? null,
    numberIsMetaId: number?.isMetaId ?? false,
  }
}

/**
 * The account on one line, the way «Ayarlar → Kanallar» writes it: the pieces joined by « · », and
 * the localized «Meta ID» word in front of a row that has only Meta's internal id. The word comes
 * from the caller so the two screens read from the same message catalogue.
 */
export function channelAccountLine(
  account: InboxChannelAccount | null | undefined,
  metaIdPrefix: string,
): string | null {
  if (!account) return null
  const number = account.number
    ? (account.numberIsMetaId ? `${metaIdPrefix} ${account.number}` : account.number)
    : null
  return [account.name, number].filter(Boolean).join(" · ") || null
}

/** Two addresses that are the same person — so the card does not print the contact's phone twice. */
export function sameChannelAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = text(a)
  const right = text(b)
  if (!left || !right) return false
  if (left.toLowerCase() === right.toLowerCase()) return true
  if (left.includes("@") || right.includes("@")) return false
  // «050 123 45 67» and «+994 50 123 45 67» are one number: the local spelling drops the country
  // code and carries a leading zero the international one does not.
  const digits = (value: string) => value.replace(/\D/g, "").replace(/^0+/, "")
  const leftDigits = digits(left)
  const rightDigits = digits(right)
  if (leftDigits.length < 7 || rightDigits.length < 7) return false
  return leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits)
}

/**
 * Attach `channelAccount` + `channelAddress` to every conversation, loading each channel row once.
 *
 * `loadChannels` belongs to the caller so the database `select` — and anything it forgets — stays in
 * the route where a route test can see it.
 */
export async function attachInboxChannelAccounts<T extends InboxChannelConversationLike>(
  conversations: T[],
  loadChannels: (ids: string[]) => Promise<InboxChannelRow[]>,
): Promise<(T & { channelAccount: InboxChannelAccount | null; channelAddress: string | null })[]> {
  const wanted = new Map<T, string | null>()
  for (const conversation of conversations) wanted.set(conversation, conversationChannelConfigId(conversation))
  const ids = Array.from(new Set(Array.from(wanted.values()).filter((id): id is string => !!id)))
  const rows = ids.length ? await loadChannels(ids) : []
  const byId = new Map(rows.filter((row) => row && typeof row.id === "string").map((row) => [row.id, row]))

  return conversations.map((conversation) => {
    const id = wanted.get(conversation) ?? null
    const row = id ? byId.get(id) : undefined
    let account: InboxChannelAccount | null = row ? channelAccountOf(row) : null
    if (!account?.number) {
      // Nothing named the number — the address it arrived on still answers the question (inbound SMS).
      const arrival = conversationArrivalAddress(conversation)
      if (arrival) {
        account = account
          ? { ...account, number: arrival }
          : { id: null, channelType: null, name: null, number: arrival, numberIsMetaId: false }
      }
    }
    if (account && !account.name && !account.number) account = null
    return {
      ...conversation,
      channelAccount: account,
      channelAddress: conversationCustomerAddress(conversation),
    }
  })
}

/**
 * The platforms whose accounts the inbox rail lists one by one. A workspace may hold several numbers
 * or pages of one platform (LeadDrive Inc. on 2026-11-10: three WhatsApp numbers, five Facebook
 * pages), and the rail showed one «WhatsApp» line for all of them (owner: «не понятно на какой
 * ватсап пишут … тут только одна вкладка от каждого»).
 */
export const INBOX_ACCOUNT_CHANNEL_TYPES = [
  "whatsapp", "facebook", "instagram", "telegram", "sms", "email", "vkontakte", "tiktok",
] as const

/** What the rail and the list row print for an account: its number, or its name when it has none. */
export function channelAccountShortLabel(account: Pick<InboxChannelAccount, "name" | "number" | "numberIsMetaId"> | null | undefined): string | null {
  if (!account) return null
  if (account.number && !account.numberIsMetaId) return account.number
  return account.name ?? null
}
