/**
 * What the team answered in the Instagram / Messenger app itself, mirrored into the CRM thread.
 *
 * An Instagram professional account connected to the CRM is still an account on somebody's phone,
 * and people answer customers there. Meta reports every such reply to our webhook as a `messaging`
 * event with `message.is_echo`; until 2026-11-13 both webhooks dropped it on the first line. The
 * thread in the CRM then showed the customer's question with nothing under it, so a second person
 * answered the same customer again (Zeytun Pharma: 76 inbound and 0 outbound rows on 11–12 Nov,
 * every one of them answered in the app).
 *
 * The echo lands as an ORDINARY OUTBOUND row with status `sent` — the same shape and for the same
 * reasons as lib/inbox/whatsapp-app-echo: the AI coverage readers treat a delivered outbound row as
 * an answer and stand down, and the row never touches the customer's messaging window.
 *
 * The one thing WhatsApp does not have: Meta echoes OUR OWN sends too (the inbox composer, the
 * auto-reply, the AI). Those already have a row, written by whoever sent them, so the echo of one
 * must be recognised and dropped — see `findOwnSend`.
 */
import { prisma } from "@/lib/prisma"
import { fetchAndStoreMetaMedia } from "@/lib/inbox/meta-media"
import { isDuplicateInsert } from "@/lib/social/meta-inbound-idempotency"
import { parseInstagramAttachment } from "@/lib/social/instagram-inbound-audio"
import { resolveMetaSenderName } from "@/lib/social/meta-sender-profile"
import { isIgLogin } from "@/lib/social/tenant-meta-app"
import { sanitizeLog } from "@/lib/sanitize"

/** The marker the partial unique index (migration 20261215100000) and the inbox both read. */
export const META_APP_ECHO_SOURCE = "business_app"

/**
 * How long a row written by our own send may trail its echo.
 *
 * Every sender writes its row AFTER the Graph call returns, and the echo of that call can reach the
 * webhook first. An echo that matches nothing is therefore looked up again before it is believed to
 * be a reply typed in the app.
 */
const OWN_SEND_RETRY_DELAYS_MS = [1500, 2500]
/** A row of ours older than this cannot be what an echo arriving now is about. */
const OWN_SEND_TEXT_WINDOW_MS = 10 * 60_000

type Rec = Record<string, unknown>

export type MetaDmEchoEvent = {
  sender?: { id?: unknown }
  recipient?: { id?: unknown }
  timestamp?: unknown
  message?: {
    mid?: unknown
    text?: unknown
    is_echo?: unknown
    is_deleted?: unknown
    attachments?: unknown
  }
}

export type MetaDmEchoChannel = {
  id: string
  organizationId: string
  apiKey?: string | null
  pageId?: string | null
  settings?: unknown
}

export type MetaDmEchoOutcome = "stored" | "own_send" | "duplicate" | "skipped"

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function metadataRecord(value: unknown): Rec {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Rec) } : {}
}

function eventDate(value: unknown): Date {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return new Date()
  // Messenger and Instagram send milliseconds; seconds are accepted in case that ever differs.
  const at = new Date(n > 1e12 ? n : n * 1000)
  // A clock that disagrees with ours must not push the reply in front of the question it answers
  // by landing in the future.
  return at.getTime() > Date.now() ? new Date() : at
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The row our own send already wrote for this echo, if there is one.
 *
 *   1. by Meta's message id — a send that kept the id Graph returned (`externalId`, or
 *      `metadata.metaMessageIds` when one CRM message went out as a file plus its caption);
 *   2. by its words — the text senders do not keep the id, so: an outbound row of ours to the same
 *      customer, written in the last minutes, with exactly this text, not yet claimed by another
 *      echo. The claim is what lets two identical replies in a row both be recognised.
 */
async function findOwnSend(params: {
  organizationId: string
  platform: "instagram" | "facebook"
  recipientId: string
  mid: string
  text: string | null
}): Promise<{ kind: "own_send" | "duplicate" } | null> {
  const { organizationId, platform, recipientId, mid, text } = params
  const byId = await prisma.channelMessage.findFirst({
    where: {
      organizationId,
      channelType: platform,
      direction: "outbound",
      OR: [{ externalId: mid }, { metadata: { path: ["metaMessageIds"], array_contains: mid } }],
    },
    select: { id: true, metadata: true },
  })
  if (byId) {
    return { kind: metadataRecord(byId.metadata).source === META_APP_ECHO_SOURCE ? "duplicate" : "own_send" }
  }
  if (!text) return null

  const candidates = await prisma.channelMessage.findMany({
    where: {
      organizationId,
      channelType: platform,
      direction: "outbound",
      to: recipientId,
      body: text,
      createdAt: { gte: new Date(Date.now() - OWN_SEND_TEXT_WINDOW_MS) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, externalId: true, metadata: true },
    take: 20,
  })
  const unclaimed = candidates.find((row: { metadata: unknown }) => {
    const meta = metadataRecord(row.metadata)
    return meta.source !== META_APP_ECHO_SOURCE && !str(meta.echoMid)
  })
  if (!unclaimed) return null
  await prisma.channelMessage.update({
    where: { id: unclaimed.id },
    data: {
      ...(unclaimed.externalId ? {} : { externalId: mid }),
      metadata: { ...metadataRecord(unclaimed.metadata), echoMid: mid },
    },
  }).catch(() => null)
  return { kind: "own_send" }
}

/**
 * The thread this echo belongs to, without the inbound side effects.
 *
 * The reply proves somebody read the customer's messages, so the unread counter goes to zero —
 * otherwise the inbox keeps a red badge on a conversation that is already answered, which is the
 * exact confusion this module exists to end. Status, assignment and snooze are left alone.
 */
async function ensureEchoConversation(params: {
  channel: MetaDmEchoChannel
  platform: "instagram" | "facebook"
  recipientId: string
  lastMessage: string
  at: Date
}): Promise<string | null> {
  const { channel, platform, recipientId, lastMessage, at } = params
  const organizationId = channel.organizationId
  const where = { organizationId_platform_externalId: { organizationId, platform, externalId: recipientId } }
  const existing = await prisma.socialConversation.findUnique({
    where,
    select: { id: true, lastMessageAt: true },
  }).catch(() => null)
  if (existing) {
    const newer = !existing.lastMessageAt || at >= existing.lastMessageAt
    await prisma.socialConversation.update({
      where: { id: existing.id },
      data: { unreadCount: 0, ...(newer ? { lastMessage, lastMessageAt: at } : {}) },
    }).catch(() => null)
    return existing.id
  }

  // The team wrote first, from the app, to somebody who has never written to us.
  const contactName = await resolveMetaSenderName({
    organizationId, platform, senderId: recipientId,
    token: channel.apiKey ?? null, igLogin: isIgLogin(channel.settings), accountId: channel.pageId ?? null,
  }).catch(() => recipientId)
  try {
    const created = await prisma.socialConversation.create({
      data: {
        organizationId,
        platform,
        externalId: recipientId,
        contactName: contactName || recipientId,
        lastMessage,
        lastMessageAt: at,
        channelConfigId: channel.id,
      },
      select: { id: true },
    })
    return created.id
  } catch (error) {
    if (!isDuplicateInsert(error)) throw error
    const raced = await prisma.socialConversation.findUnique({ where, select: { id: true } }).catch(() => null)
    return raced?.id ?? null
  }
}

/**
 * Store one echo event. Runs inside `runWithTenant` — the webhook has already resolved the channel.
 *
 * `accountId` is our side of the thread: the Instagram account id or the Facebook page id.
 */
export async function ingestMetaDmEcho(params: {
  channel: MetaDmEchoChannel
  platform: "instagram" | "facebook"
  accountId: string
  event: MetaDmEchoEvent
  /** Tests pass [] so they do not sleep. */
  retryDelaysMs?: number[]
}): Promise<MetaDmEchoOutcome> {
  const { channel, platform, accountId, event } = params
  const organizationId = channel.organizationId
  const message = event.message
  const mid = str(message?.mid)
  const recipientId = str(event.recipient?.id)
  // Without an id there is nothing to tell a redelivery from a second reply; without a recipient
  // there is no thread. A deleted message has no content to show.
  if (!message || !mid || !recipientId || message.is_deleted === true) return "skipped"
  // An echo addressed to ourselves is not a conversation with a customer.
  if (recipientId === accountId) return "skipped"

  const text = str(message.text)
  const parsed = parseInstagramAttachment(message.attachments) as { mediaUrl: string | null; messageType: string | null }
  if (!text && !parsed.mediaUrl) return "skipped"

  const delays = params.retryDelaysMs ?? OWN_SEND_RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt += 1) {
    const own = await findOwnSend({ organizationId, platform, recipientId, mid, text })
    if (own) {
      // One line per echo of our own send: it is how a live account shows that echoes arrive at all.
      if (own.kind === "own_send") console.log(`[Meta Echo] ${platform} echo of our own send recognised (org=${sanitizeLog(organizationId)})`)
      return own.kind
    }
    if (attempt >= delays.length) break
    await sleep(delays[attempt])
  }

  let mediaUrl = parsed.mediaUrl
  let messageType = parsed.messageType
  const stored = mediaUrl ? await fetchAndStoreMetaMedia(mediaUrl, organizationId).catch(() => null) : null
  if (stored) {
    mediaUrl = stored.url
    messageType = stored.kind
  }

  const at = eventDate(event.timestamp)
  const body = text ?? "[media]"
  const conversationId = await ensureEchoConversation({ channel, platform, recipientId, lastMessage: body, at })

  try {
    await prisma.channelMessage.create({
      data: {
        organizationId,
        channelConfigId: channel.id,
        channelType: platform,
        direction: "outbound",
        from: accountId,
        to: recipientId,
        body,
        // `sent` is load-bearing: the AI coverage reader counts only sent/delivered/read rows.
        status: "sent",
        externalId: mid,
        mediaUrl,
        messageType: messageType || "text",
        conversationId: conversationId ?? undefined,
        createdAt: at,
        metadata: {
          platform,
          source: META_APP_ECHO_SOURCE,
          sentFromBusinessApp: true,
          accountId,
          recipientId,
        },
      },
    })
  } catch (error) {
    if (isDuplicateInsert(error)) return "duplicate"
    throw error
  }
  console.log(
    `[Meta Echo] ${platform} reply from the app stored (org=${sanitizeLog(organizationId)}, mid=${sanitizeLog(mid)})`,
  )
  return "stored"
}
