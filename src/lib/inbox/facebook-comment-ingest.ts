/**
 * A Facebook Page comment, written into `facebook_page_comments` (lib/social/facebook-comments says
 * what Meta sends, schema.prisma why it is not a ChannelMessage).
 *
 *   • a customer's comment is a row; nothing but a keyword rule answers it by itself: no AI, no bot;
 *   • an edit changes the words, a delete or hide takes the row off the screen;
 *   • the Page's own comment under a customer's is an answer on that row: the echo of a reply sent from
 *     the CRM is recognised, one typed on Facebook is shown as such.
 */
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { fetchAndStoreMetaMedia } from "@/lib/inbox/meta-media"
import { isDuplicateInsert } from "@/lib/social/meta-inbound-idempotency"
import { isNoiseComment } from "@/lib/social/instagram-comments"
import { autoReplyOff } from "@/lib/inbox/conversation-auto-reply"
import { COMMENT_KEYWORD_REPEAT_MS, loadCommentKeywordRules, matchCommentKeywordRule } from "@/lib/inbox/comment-keyword-rules"
import { appendFacebookReply, sendFacebookCommentReply, storedFacebookReplies } from "@/lib/inbox/facebook-comment-reply"
import { fetchFacebookPostInfo, type FacebookCommentEvent, type FacebookPostInfo } from "@/lib/social/facebook-comments"

export type FacebookCommentChannel = { id: string; organizationId: string; apiKey?: string | null; pageId?: string | null }
export type FacebookCommentIngestResult =
  | "stored" | "duplicate" | "noise" | "updated" | "removed" | "own_reply_stored" | "own_ignored" | "ignored"

export type FacebookIngestSeams = {
  fetchPostInfo?: typeof fetchFacebookPostInfo
  storeImage?: (url: string, organizationId: string) => Promise<{ url: string } | null>
  retryDelaysMs?: number[]
}

/** Our public reply writes itself after Meta answers; its echo may arrive first. */
const OWN_REPLY_RETRY_DELAYS_MS = [1500, 2500]
const OWN_REPLY_TEXT_WINDOW_MS = 10 * 60_000
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function postInfoFor(channel: FacebookCommentChannel, postId: string | null, seams: FacebookIngestSeams): Promise<Omit<FacebookPostInfo, "isVideo"> & { isVideo: boolean }> {
  const empty = { caption: null, permalink: null, imageUrl: null, isVideo: false }
  if (!postId) return empty
  const known = await prisma.facebookPageComment.findFirst({
    where: { organizationId: channel.organizationId, postId, OR: [{ caption: { not: null } }, { permalink: { not: null } }, { imageUrl: { not: null } }] },
    orderBy: { commentedAt: "desc" },
    select: { caption: true, permalink: true, imageUrl: true, isVideo: true },
  })
  if (known) return known
  const info = channel.apiKey ? await (seams.fetchPostInfo ?? fetchFacebookPostInfo)(postId, channel.apiKey) : null
  if (!info) return empty
  let imageUrl: string | null = null
  if (info.imageUrl) {
    // Meta's CDN address expires within days.
    const stored = await (seams.storeImage ?? fetchAndStoreMetaMedia)(info.imageUrl, channel.organizationId)
    imageUrl = stored?.url ?? null
  }
  return { ...info, imageUrl }
}

async function ingestOwnComment(channel: FacebookCommentChannel, event: FacebookCommentEvent, seams: FacebookIngestSeams): Promise<FacebookCommentIngestResult> {
  if (!event.parentId) return "own_ignored"
  const parent = await prisma.facebookPageComment.findFirst({
    where: { organizationId: channel.organizationId, commentId: event.parentId },
    select: { id: true },
  })
  if (!parent) return "own_ignored"
  const delays = seams.retryDelaysMs ?? OWN_REPLY_RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt++) {
    const row = await prisma.facebookPageComment.findFirst({ where: { id: parent.id }, select: { replies: true } })
    const replies = storedFacebookReplies(row?.replies)
    const since = Date.now() - OWN_REPLY_TEXT_WINDOW_MS
    if (replies.some((r) => r.id === event.commentId || (r.mode === "public" && r.text === event.text.trim() && new Date(r.at).getTime() >= since))) {
      return "duplicate"
    }
    if (attempt >= delays.length) break
    await sleep(delays[attempt])
  }
  await appendFacebookReply(channel.organizationId, parent.id, {
    id: event.commentId, text: event.text, mode: "public", at: event.commentedAt.toISOString(),
    authorName: null, keyword: null, ruleId: null, fromApp: true,
  })
  return "own_reply_stored"
}

/**
 * The keyword rule's message, as the comment's private reply. Without an author id there is no way to
 * hold «once per person per day», so such a comment waits for a person.
 */
async function runKeywordRule(channel: FacebookCommentChannel, rowId: string, event: FacebookCommentEvent): Promise<void> {
  try {
    if (!event.fromId) return
    const rule = matchCommentKeywordRule(await loadCommentKeywordRules(channel.organizationId), event.text, channel.id)
    if (!rule) return
    const earlier = await prisma.facebookPageComment.findMany({
      where: {
        organizationId: channel.organizationId,
        fromId: event.fromId,
        id: { not: rowId },
        commentedAt: { gte: new Date(Date.now() - COMMENT_KEYWORD_REPEAT_MS) },
      },
      select: { replies: true },
      take: 200,
    })
    if (earlier.some((row: { replies: Prisma.JsonValue }) => storedFacebookReplies(row.replies).some((r) => r.ruleId === rule.id))) return
    // The person's Messenger thread, if an earlier private reply found it: its «AI rejimi» decides.
    const known = await prisma.facebookPageComment.findFirst({
      where: { organizationId: channel.organizationId, fromId: event.fromId, conversationId: { not: null } },
      orderBy: { commentedAt: "desc" },
      select: { conversationId: true },
    })
    if (known?.conversationId && await autoReplyOff(channel.organizationId, known.conversationId)) return
    const sent = await sendFacebookCommentReply({
      organizationId: channel.organizationId,
      rowId,
      mode: "private",
      text: rule.message,
      authorName: null,
      rule: { id: rule.id, keyword: rule.keyword },
    })
    if (!sent.ok) console.warn(`[fb-comments] keyword message not sent: ${sent.status}`)
  } catch (e) {
    console.error("[fb-comments] keyword rule error:", e instanceof Error ? e.message : "unknown")
  }
}

/** Must run inside the channel's tenant scope. Throws only on a database failure. */
export async function ingestFacebookComment(params: {
  channel: FacebookCommentChannel
  pageId: string
  event: FacebookCommentEvent
  seams?: FacebookIngestSeams
}): Promise<FacebookCommentIngestResult> {
  const { channel, pageId, event } = params
  const seams = params.seams ?? {}
  const organizationId = channel.organizationId
  const own = { organizationId, commentId: event.commentId }

  if (event.verb === "remove" || event.verb === "hide") {
    const done = await prisma.facebookPageComment.updateMany({ where: own, data: { removedAt: new Date() } })
    return done.count > 0 ? "removed" : "ignored"
  }
  if (event.verb === "unhide") {
    const done = await prisma.facebookPageComment.updateMany({ where: own, data: { removedAt: null } })
    return done.count > 0 ? "updated" : "ignored"
  }
  if (event.verb === "edited") {
    const done = await prisma.facebookPageComment.updateMany({ where: own, data: { body: event.text } })
    return done.count > 0 ? "updated" : "ignored"
  }
  if (event.verb !== "add") return "ignored"
  if (event.fromId && event.fromId === pageId) return ingestOwnComment(channel, event, seams)
  if (isNoiseComment(event.text)) return "noise"
  const existing = await prisma.facebookPageComment.findFirst({ where: own, select: { id: true } })
  if (existing) return "duplicate"

  const post = await postInfoFor(channel, event.postId, seams)
  let rowId: string
  try {
    const row = await prisma.facebookPageComment.create({
      select: { id: true },
      data: {
        organizationId,
        channelConfigId: channel.id,
        pageId,
        commentId: event.commentId,
        postId: event.postId,
        parentId: event.parentId,
        fromId: event.fromId,
        fromName: event.fromName,
        body: event.text,
        commentedAt: event.commentedAt,
        caption: post.caption,
        permalink: post.permalink ?? event.permalink,
        imageUrl: post.imageUrl,
        isVideo: post.isVideo,
      },
    })
    rowId = row.id
  } catch (e) {
    if (isDuplicateInsert(e)) return "duplicate"
    throw e
  }
  await runKeywordRule(channel, rowId, event)
  return "stored"
}
