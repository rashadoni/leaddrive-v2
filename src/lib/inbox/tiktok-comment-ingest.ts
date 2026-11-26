/**
 * Bringing comments under owned TikTok videos into «Комментарии».
 *
 * TikTok has a `comment.update` webhook, but it needs a subscription per app and delivers within
 * five minutes anyway; this reads the same comments on a schedule, which works for every connected
 * account the day it is connected and has nothing to break when a subscription lapses. The webhook
 * is the later upgrade, not a different model: both end at `storeTikTokComments` below.
 *
 * What is stored is a customer's comment. The account's own comments are answers, not questions:
 * a reply by the account under someone's comment lands in that comment's `replies`, and a top-level
 * one is skipped entirely. Nothing here writes to a person privately — TikTok direct messages are a
 * permission we do not have.
 */
import { prisma } from "@/lib/prisma"
import { isNoiseComment } from "@/lib/social/instagram-comments"
import { storedTikTokReplies, type StoredTikTokReply } from "@/lib/inbox/tiktok-comment-reply"
import {
  listOwnedVideos,
  listVideoComments,
  type TikTokApiAccount,
  type TikTokComment,
  type TikTokOwnedVideo,
} from "@/lib/social/tiktok-comment-api"

/** One run's appetite: enough for a working day of a busy account, small enough to stay polite. */
export const TIKTOK_INGEST_VIDEOS = 10
export const TIKTOK_INGEST_COMMENTS_PER_VIDEO = 50

export type TikTokIngestAccount = TikTokApiAccount & {
  organizationId: string
  /** `open_id` — what TikTok's comment endpoints call `business_id`. */
  handle: string
  displayName: string | null
}

export type TikTokIngestCounts = {
  videos: number
  stored: number
  updated: number
  replies: number
  removed: number
  skipped: number
  failed: number
}

const empty = (): TikTokIngestCounts => ({ videos: 0, stored: 0, updated: 0, replies: 0, removed: 0, skipped: 0, failed: 0 })

/**
 * Our own answer, sent before TikTok gave it an id, meeting itself on the next poll.
 *
 * `sendTikTokCommentReply` records the answer under a local id when TikTok's response carried none.
 * The poller then sees the same words as a reply by the account and would add a second copy. One
 * local answer with the same text is claimed by the incoming one instead: same words, same author,
 * one line on screen.
 */
export function mergeOwnerReply(stored: readonly StoredTikTokReply[], incoming: StoredTikTokReply): StoredTikTokReply[] | null {
  if (stored.some((reply) => reply.id === incoming.id)) return null
  const local = stored.findIndex((reply) => reply.id.startsWith("local:") && reply.text === incoming.text)
  if (local === -1) return [...stored, incoming]
  const claimed = [...stored]
  // The person who pressed «Ответить» keeps the credit; only the id becomes TikTok's.
  claimed[local] = { ...claimed[local], id: incoming.id }
  return claimed
}

function ownerReply(comment: TikTokComment): StoredTikTokReply {
  return {
    id: comment.commentId,
    text: comment.text,
    at: comment.createdAt.toISOString(),
    authorName: null,
    fromApp: true,
  }
}

/** A comment worth a row: somebody else's, and not only @names and emojis. */
export function worthStoring(comment: TikTokComment): boolean {
  if (comment.owner) return false
  if (!comment.text.trim()) return false
  return !isNoiseComment(comment.text)
}

async function storeComment(input: {
  account: TikTokIngestAccount
  video: TikTokOwnedVideo
  comment: TikTokComment
  counts: TikTokIngestCounts
}): Promise<string | null> {
  const { account, video, comment, counts } = input
  const existing = await prisma.tikTokVideoComment.findFirst({
    where: { organizationId: account.organizationId, commentId: comment.commentId },
    select: { id: true, body: true, likes: true, removedAt: true },
  })
  const shared = {
    socialAccountId: account.id,
    businessId: account.handle,
    videoId: video.videoId,
    parentId: comment.parentId,
    username: comment.username,
    displayName: comment.displayName,
    body: comment.text,
    commentedAt: comment.createdAt,
    caption: video.caption,
    permalink: video.shareUrl,
    likes: comment.likes,
  }
  if (!existing) {
    const created = await prisma.tikTokVideoComment.create({
      data: { organizationId: account.organizationId, commentId: comment.commentId, ...shared },
      select: { id: true },
    })
    counts.stored += 1
    return created.id
  }
  // An edited comment, a changed like count, or one that came back after being hidden.
  if (existing.body !== comment.text || existing.likes !== comment.likes || existing.removedAt) {
    await prisma.tikTokVideoComment.update({
      where: { id: existing.id },
      data: { ...shared, removedAt: null },
    })
    counts.updated += 1
  }
  return existing.id
}

async function storeReplies(input: {
  organizationId: string
  rowId: string
  replies: readonly TikTokComment[]
  counts: TikTokIngestCounts
}): Promise<void> {
  const own = input.replies.filter((reply) => reply.owner)
  if (own.length === 0) return
  const row = await prisma.tikTokVideoComment.findFirst({
    where: { id: input.rowId, organizationId: input.organizationId },
    select: { replies: true },
  })
  if (!row) return
  let stored = storedTikTokReplies(row.replies)
  let changed = false
  for (const reply of own) {
    const merged = mergeOwnerReply(stored, ownerReply(reply))
    if (!merged) continue
    stored = merged
    changed = true
    input.counts.replies += 1
  }
  if (!changed) return
  await prisma.tikTokVideoComment.update({
    where: { id: input.rowId },
    data: { replies: stored as unknown as object[] },
  })
}

/**
 * Writes one video's comments and marks what TikTok no longer shows.
 *
 * «No longer shows» is judged only inside the window actually read: a comment older than the oldest
 * one TikTok returned may simply be past the page we asked for, and marking it gone would empty the
 * board of everything but the last fifty comments.
 */
export async function storeTikTokComments(input: {
  account: TikTokIngestAccount
  video: TikTokOwnedVideo
  comments: readonly TikTokComment[]
  counts: TikTokIngestCounts
}): Promise<void> {
  const { account, video, comments, counts } = input
  const seen = new Set<string>()
  for (const comment of comments) {
    seen.add(comment.commentId)
    for (const reply of comment.replies) seen.add(reply.commentId)
    if (!worthStoring(comment)) {
      counts.skipped += 1
    } else {
      const rowId = await storeComment({ account, video, comment, counts })
      if (rowId) await storeReplies({ organizationId: account.organizationId, rowId, replies: comment.replies, counts })
    }
    // Someone else's reply inside a thread is a question too, and it is shown under the same post.
    for (const reply of comment.replies) {
      if (!worthStoring(reply)) continue
      await storeComment({ account, video, comment: { ...reply, parentId: reply.parentId ?? comment.commentId }, counts })
    }
  }

  const oldest = comments.reduce<Date | null>((min, c) => (min === null || c.createdAt < min ? c.createdAt : min), null)
  if (!oldest) return
  const gone = await prisma.tikTokVideoComment.updateMany({
    where: {
      organizationId: account.organizationId,
      videoId: video.videoId,
      removedAt: null,
      commentedAt: { gte: oldest },
      ...(seen.size ? { commentId: { notIn: [...seen] } } : {}),
    },
    data: { removedAt: new Date() },
  })
  counts.removed += gone.count
}

/** Reads one connected account. Runs inside that organization's tenant scope. */
export async function ingestTikTokAccountComments(account: TikTokIngestAccount): Promise<TikTokIngestCounts> {
  const counts = empty()
  const videos = await listOwnedVideos({ account, businessId: account.handle, limit: TIKTOK_INGEST_VIDEOS })
  if (!videos.ok) {
    counts.failed += 1
    return counts
  }
  for (const video of videos.data) {
    // A video nobody commented on is not asked about: the list endpoint costs the same as a real one.
    if (video.commentCount <= 0) continue
    counts.videos += 1
    const comments = await listVideoComments({
      account,
      businessId: account.handle,
      videoId: video.videoId,
      limit: TIKTOK_INGEST_COMMENTS_PER_VIDEO,
    })
    if (!comments.ok) {
      counts.failed += 1
      continue
    }
    await storeTikTokComments({ account, video, comments: comments.data, counts })
  }
  return counts
}
