/**
 * An Instagram comment, written into the inbox (lib/social/instagram-comments says what Meta sends).
 *
 * A customer's comment becomes an INBOUND row in the conversation with its author — the same
 * conversation (platform `instagram`, externalId = the person's Instagram-scoped id) that holds their
 * Direct messages, as the owner chose on 2026-11-16. The row is marked `metadata.igComment`; that
 * marker is what the screen draws as a post card and what every reader of the Direct window skips:
 *
 *   • a comment opens no Direct window — Meta takes a Direct answer to it only as the one private
 *     reply (lib/inbox/meta-reply-window, the composer);
 *   • no automatic answer from the AI, the keyword bot of Direct or a flow. A comment is public and
 *     the answer the owner wants is a person's. The AI coverage reader
 *     (`selectUncoveredAiInboundBatch`) skips these rows, so neither the webhook turn nor the backlog
 *     sweep ever picks one up. The one exception (owner 2026-11-22): a comment carrying a word an
 *     administrator wrote a rule for gets that rule's message in Direct
 *     (lib/inbox/comment-keyword-rules).
 *
 * The account's OWN comments come back through the same webhook. One that answers a customer's
 * comment — typed in the Instagram app, or the echo of a public reply sent from the CRM — is an
 * outbound row under that comment, written once (`findOwnReply`), like lib/inbox/meta-dm-app-echo.
 */
import { prisma } from "@/lib/prisma"
import { upsertSocialConversation } from "@/lib/facebook"
import { fetchAndStoreMetaMedia } from "@/lib/inbox/meta-media"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { isDuplicateInsert } from "@/lib/social/meta-inbound-idempotency"
import { META_APP_ECHO_SOURCE } from "@/lib/inbox/meta-dm-app-echo"
import { sanitizeLog } from "@/lib/sanitize"
import { runCommentKeywordAutoReply } from "@/lib/inbox/comment-keyword-auto-reply"
import {
  fetchInstagramPostInfo,
  isNoiseComment,
  storedInstagramComment,
  type InstagramCommentEvent,
  type InstagramPostInfo,
  type StoredInstagramComment,
} from "@/lib/social/instagram-comments"

export type InstagramCommentChannel = {
  id: string
  organizationId: string
  apiKey?: string | null
  pageId?: string | null
  settings?: unknown
}

export type InstagramCommentIngestResult =
  | "stored"
  | "duplicate"
  | "noise"
  | "own_reply_stored"
  | "own_ignored"

/** Our own public reply writes its row after Meta answers; its echo may arrive first. */
const OWN_REPLY_RETRY_DELAYS_MS = [1500, 2500]
const OWN_REPLY_TEXT_WINDOW_MS = 10 * 60_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type Rec = Record<string, unknown>
function rec(value: unknown): Rec {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Rec : {}
}

/** Is this comment the connected account's own? Ids differ between Meta's surfaces; the name does not. */
function isOwnComment(channel: InstagramCommentChannel, accountId: string, comment: InstagramCommentEvent): boolean {
  const settings = rec(channel.settings)
  const ownIds = [accountId, channel.pageId, settings.igScopedId].filter((x): x is string => typeof x === "string" && !!x)
  if (ownIds.includes(comment.fromId)) return true
  const ownName = typeof settings.username === "string" ? settings.username.trim().toLowerCase() : ""
  return !!ownName && !!comment.username && comment.username.trim().toLowerCase() === ownName
}

/**
 * The post card's facts. Taken from an earlier comment on the same post when there is one — one
 * Graph read and one stored picture per post, not per comment — otherwise read from Meta now and the
 * picture copied into our storage (Meta's CDN address expires within days).
 */
async function postInfoFor(
  channel: InstagramCommentChannel,
  mediaId: string | null,
  seams: IngestSeams,
): Promise<Pick<StoredInstagramComment, "caption" | "permalink" | "imageUrl">> {
  const empty = { caption: null, permalink: null, imageUrl: null }
  if (!mediaId) return empty
  const earlier = await prisma.channelMessage.findFirst({
    where: {
      organizationId: channel.organizationId,
      channelType: "instagram",
      direction: "inbound",
      metadata: { path: ["igComment", "mediaId"], equals: mediaId },
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  })
  const known = storedInstagramComment(earlier?.metadata)
  if (known && (known.permalink || known.caption || known.imageUrl)) {
    return { caption: known.caption, permalink: known.permalink, imageUrl: known.imageUrl }
  }
  const info: InstagramPostInfo | null = channel.apiKey
    ? await (seams.fetchPostInfo ?? fetchInstagramPostInfo)(mediaId, channel.apiKey)
    : null
  if (!info) return empty
  let imageUrl: string | null = null
  if (info.imageUrl) {
    const stored = await (seams.storeImage ?? fetchAndStoreMetaMedia)(info.imageUrl, channel.organizationId)
    imageUrl = stored?.url ?? null
  }
  return { caption: info.caption, permalink: info.permalink, imageUrl }
}

/** The CRM's own row for this reply, if the CRM sent it (by Meta's id, else by its words and comment). */
async function findOwnReply(organizationId: string, conversationId: string, comment: InstagramCommentEvent): Promise<boolean> {
  const byId = await prisma.channelMessage.findFirst({
    where: { organizationId, channelType: "instagram", direction: "outbound", externalId: comment.commentId },
    select: { id: true },
  })
  if (byId) return true
  const byText = await prisma.channelMessage.findFirst({
    where: {
      organizationId,
      conversationId,
      channelType: "instagram",
      direction: "outbound",
      body: comment.text,
      createdAt: { gte: new Date(Date.now() - OWN_REPLY_TEXT_WINDOW_MS) },
      metadata: { path: ["igCommentReply", "commentId"], equals: comment.parentId ?? "" },
    },
    select: { id: true },
  })
  return Boolean(byText)
}

async function ingestOwnComment(
  channel: InstagramCommentChannel,
  accountId: string,
  comment: InstagramCommentEvent,
  seams: IngestSeams,
): Promise<InstagramCommentIngestResult> {
  // The account commenting on its own post, not under a customer's comment: nothing to mirror.
  if (!comment.parentId) return "own_ignored"
  const parent = await prisma.channelMessage.findFirst({
    where: {
      organizationId: channel.organizationId,
      channelType: "instagram",
      direction: "inbound",
      externalId: comment.parentId,
    },
    select: { id: true, conversationId: true, from: true, metadata: true },
  })
  if (!parent?.conversationId || !storedInstagramComment(parent.metadata)) return "own_ignored"
  const delays = seams.retryDelaysMs ?? OWN_REPLY_RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt++) {
    if (await findOwnReply(channel.organizationId, parent.conversationId, comment)) return "duplicate"
    if (attempt >= delays.length) break
    await sleep(delays[attempt])
  }
  const at = new Date()
  try {
    await prisma.channelMessage.create({
      data: {
        organizationId: channel.organizationId,
        channelConfigId: channel.id,
        channelType: "instagram",
        direction: "outbound",
        from: accountId,
        to: parent.from,
        body: comment.text,
        status: "sent",
        externalId: comment.commentId,
        conversationId: parent.conversationId,
        metadata: {
          source: META_APP_ECHO_SOURCE,
          igCommentReply: { commentId: comment.parentId, replyId: comment.commentId, mode: "public" },
        },
      },
    })
  } catch (e) {
    if (isDuplicateInsert(e)) return "duplicate"
    throw e
  }
  await prisma.socialConversation.updateMany({
    where: { id: parent.conversationId, organizationId: channel.organizationId },
    data: { unreadCount: 0, lastMessage: comment.text, lastMessageAt: at },
  })
  return "own_reply_stored"
}

export type IngestSeams = {
  fetchPostInfo?: typeof fetchInstagramPostInfo
  storeImage?: (url: string, organizationId: string) => Promise<{ url: string } | null>
  /** Tests pass [] so they do not sleep. */
  retryDelaysMs?: number[]
  keywordReply?: typeof runCommentKeywordAutoReply
}

/** Must run inside the channel's tenant scope (the webhook's runWithTenant). Throws only on a database failure. */
export async function ingestInstagramComment(params: {
  channel: InstagramCommentChannel
  /** The webhook entry's id: the Instagram professional account the comment is about. */
  accountId: string
  comment: InstagramCommentEvent
  seams?: IngestSeams
}): Promise<InstagramCommentIngestResult> {
  const { channel, accountId, comment } = params
  const seams = params.seams ?? {}
  if (isOwnComment(channel, accountId, comment)) return ingestOwnComment(channel, accountId, comment, seams)

  if (isNoiseComment(comment.text)) {
    console.log(`[IG Webhook] comment without words skipped (org=${sanitizeLog(channel.organizationId)})`)
    return "noise"
  }
  const duplicate = await prisma.channelMessage.findFirst({
    where: { organizationId: channel.organizationId, channelType: "instagram", direction: "inbound", externalId: comment.commentId },
    select: { id: true },
  })
  if (duplicate) return "duplicate"

  const post = await postInfoFor(channel, comment.mediaId, seams)
  // The person may already have a conversation, named from their profile when they wrote in Direct;
  // a comment carries only the username, and must not rename them.
  const existing = await prisma.socialConversation.findUnique({
    where: { organizationId_platform_externalId: { organizationId: channel.organizationId, platform: "instagram", externalId: comment.fromId } },
    select: { contactName: true },
  })
  const name = existing?.contactName?.trim() || comment.username || comment.fromId
  const conv = await upsertSocialConversation(channel.organizationId, "instagram", comment.fromId, name, comment.text, channel.id)

  const igComment: StoredInstagramComment = {
    commentId: comment.commentId,
    mediaId: comment.mediaId,
    mediaProductType: comment.mediaProductType,
    parentId: comment.parentId,
    username: comment.username,
    ...post,
  }
  let stored: { id: string }
  try {
    stored = await prisma.channelMessage.create({
      select: { id: true },
      data: {
        organizationId: channel.organizationId,
        channelConfigId: channel.id,
        channelType: "instagram",
        direction: "inbound",
        from: comment.fromId,
        to: accountId,
        body: comment.text,
        status: "delivered",
        externalId: comment.commentId,
        messageType: "text",
        conversationId: conv.id,
        metadata: { senderId: comment.fromId, igAccountId: accountId, platform: "instagram", igLogin: true, igComment },
      },
    })
  } catch (e) {
    if (isDuplicateInsert(e)) return "duplicate"
    throw e
  }

  notifyConversationRecipients(channel.organizationId, conv.id, conv.assignedTo, {
    type: "info",
    title: "New comment",
    message: "New comment on Instagram",
    entityType: "inbox_message",
    entityId: conv.id,
    kind: "inbox.message",
  }).catch(() => {})

  // «A word in a comment → a ready message in Direct» (lib/inbox/comment-keyword-rules): the one
  // automatic answer a comment may get, and only where an administrator wrote a rule for the word.
  await (seams.keywordReply ?? runCommentKeywordAutoReply)({
    organizationId: channel.organizationId,
    channelConfigId: channel.id,
    conversationId: conv.id,
    recipientId: comment.fromId,
    inboundMessageId: stored.id,
    commentId: comment.commentId,
    text: comment.text,
  })
  return "stored"
}
