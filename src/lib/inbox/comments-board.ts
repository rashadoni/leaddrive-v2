/**
 * The «Комментарии» section of Omni-Channel (owner 2026-11-22: «люди в директ не пишут… надо в
 * омниканале создать раздел комментарии платформ»; mock-up approved «Давай»).
 *
 * It is a second VIEW of rows the inbox already holds, not a second store: a comment is the inbound
 * `ChannelMessage` the webhook wrote into its author's conversation (lib/inbox/instagram-comment-ingest),
 * and an answer is the outbound row the ordinary send wrote (`metadata.igCommentReply`). Here the
 * same rows are grouped by post, so a person works through one reel's comments instead of opening
 * forty conversations. Answering goes through the inbox's own send (`POST /api/v1/inbox` with
 * `commentReply`), so every rule of that path holds here too.
 *
 * Reads only what the caller may see: the caller's organization, minus the pages hidden from them
 * (lib/inbox/channel-access).
 */
import { prisma } from "@/lib/prisma"
import { privateReplyAvailable, storedInstagramComment } from "@/lib/social/instagram-comments"
import { matchCommentKeywordRule, type CommentKeywordRule } from "@/lib/inbox/comment-keyword-rules"
import { facebookPrivateReplyAvailable, storedFacebookReplies } from "@/lib/inbox/facebook-comment-reply"

/** How far back the section looks, and how many comments it carries at most. */
export const COMMENTS_BOARD_DAYS = 30
export const COMMENTS_BOARD_LIMIT = 1000

type Rec = Record<string, unknown>
function rec(value: unknown): Rec {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Rec : {}
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export type BoardReply = {
  id: string
  text: string
  /** `public` — under the post; `private` — the comment's one private reply; `direct` — an ordinary Direct message. */
  mode: "public" | "private" | "direct"
  createdAt: string
  /** Who answered, when a person did it from the CRM. */
  authorName: string | null
  /** The keyword whose rule sent it, when nobody typed it. */
  keyword: string | null
  /** Typed in the Instagram app, not in the CRM. */
  fromApp: boolean
}

export type BoardComment = {
  /** The stored row — what an answer names. */
  id: string
  platform: "instagram" | "facebook"
  /** Facebook: null until a private reply has told us the person's Messenger thread. */
  conversationId: string | null
  author: string
  text: string
  createdAt: string
  /** A reply to another comment under the post, not a top-level one. */
  isThreadReply: boolean
  answered: boolean
  /** May «write in Direct» still go as this comment's private reply (once, 7 days)? */
  privateReplyAvailable: boolean
  /** The word of the rule this comment matches, whether or not its message went. */
  keyword: string | null
  replies: BoardReply[]
}

export type BoardPost = {
  key: string
  platform: "instagram" | "facebook"
  channelConfigId: string | null
  channelName: string | null
  caption: string | null
  permalink: string | null
  imageUrl: string | null
  isReel: boolean
  lastCommentAt: string
  total: number
  unanswered: number
  comments: BoardComment[]
}

export type CommentRow = {
  id: string
  conversationId: string | null
  channelConfigId: string | null
  from: string
  body: string
  createdAt: Date
  metadata: unknown
}

export type ReplyRow = {
  id: string
  body: string
  status: string
  createdAt: Date
  metadata: unknown
}

function replyOf(row: ReplyRow): { commentId: string; reply: BoardReply } | null {
  if (row.status === "failed") return null
  const meta = rec(row.metadata)
  const link = rec(meta.igCommentReply)
  const commentId = str(link.commentId)
  if (!commentId) return null
  const mode = link.mode === "public" || link.mode === "private" ? link.mode : "direct"
  return {
    commentId,
    reply: {
      id: row.id,
      text: row.body,
      mode,
      createdAt: row.createdAt.toISOString(),
      authorName: meta.authorType === "operator" ? str(meta.authorName) : null,
      keyword: str(rec(meta.commentKeyword).keyword),
      fromApp: meta.source === "business_app",
    },
  }
}

/**
 * Groups stored comments by post. Pure, so the grouping and the «answered» rule are tested without a
 * database. A comment is answered when a delivered answer names it — under the post, privately or in
 * Direct — or when its private reply is marked as gone.
 */
export function buildCommentsBoard(input: {
  comments: readonly CommentRow[]
  replies: readonly ReplyRow[]
  channelNames: ReadonlyMap<string, string>
  rules: readonly CommentKeywordRule[]
  now?: number
}): BoardPost[] {
  const repliesByComment = new Map<string, BoardReply[]>()
  for (const row of input.replies) {
    const parsed = replyOf(row)
    if (!parsed) continue
    const list = repliesByComment.get(parsed.commentId) ?? []
    list.push(parsed.reply)
    repliesByComment.set(parsed.commentId, list)
  }

  const posts = new Map<string, BoardPost>()
  for (const row of input.comments) {
    const stored = storedInstagramComment(row.metadata)
    if (!stored) continue
    const key = `${row.channelConfigId ?? "-"}:${stored.mediaId ?? "unknown"}`
    let post = posts.get(key)
    if (!post) {
      post = {
        key,
        platform: "instagram",
        channelConfigId: row.channelConfigId,
        channelName: row.channelConfigId ? input.channelNames.get(row.channelConfigId) ?? null : null,
        caption: stored.caption,
        permalink: stored.permalink,
        imageUrl: stored.imageUrl,
        isReel: stored.mediaProductType === "REELS",
        lastCommentAt: row.createdAt.toISOString(),
        total: 0,
        unanswered: 0,
        comments: [],
      }
      posts.set(key, post)
    }
    // The post's facts are read once per post; an earlier comment may have missed them.
    post.caption ??= stored.caption
    post.permalink ??= stored.permalink
    post.imageUrl ??= stored.imageUrl
    const replies = (repliesByComment.get(stored.commentId) ?? [])
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const answered = replies.length > 0 || Boolean(stored.privateReplyAt)
    post.comments.push({
      id: row.id,
      platform: "instagram",
      conversationId: row.conversationId,
      author: stored.username ? `@${stored.username}` : row.from,
      text: row.body,
      createdAt: row.createdAt.toISOString(),
      isThreadReply: Boolean(stored.parentId),
      answered,
      privateReplyAvailable: privateReplyAvailable(row, input.now),
      keyword: matchCommentKeywordRule(input.rules, row.body, row.channelConfigId)?.keyword ?? null,
      replies,
    })
    post.total += 1
    if (!answered) post.unanswered += 1
    if (row.createdAt.toISOString() > post.lastCommentAt) post.lastCommentAt = row.createdAt.toISOString()
  }

  const list = [...posts.values()]
  for (const post of list) post.comments.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return list.sort((a, b) => b.lastCommentAt.localeCompare(a.lastCommentAt))
}

export type FacebookCommentRow = {
  id: string
  channelConfigId: string | null
  commentId: string
  postId: string | null
  parentId: string | null
  fromId: string | null
  fromName: string | null
  body: string
  commentedAt: Date
  caption: string | null
  permalink: string | null
  imageUrl: string | null
  isVideo: boolean
  privateReplyAt: Date | null
  conversationId: string | null
  replies: unknown
}

/** Facebook's rows in the board's shape: answered once any answer is stored or the private reply went. */
export function buildFacebookPosts(input: {
  comments: readonly FacebookCommentRow[]
  channelNames: ReadonlyMap<string, string>
  rules: readonly CommentKeywordRule[]
  now?: number
}): BoardPost[] {
  const posts = new Map<string, BoardPost>()
  for (const row of input.comments) {
    const key = `${row.channelConfigId ?? "-"}:${row.postId ?? "unknown"}`
    const at = row.commentedAt.toISOString()
    let post = posts.get(key)
    if (!post) {
      post = {
        key,
        platform: "facebook",
        channelConfigId: row.channelConfigId,
        channelName: row.channelConfigId ? input.channelNames.get(row.channelConfigId) ?? null : null,
        caption: row.caption,
        permalink: row.permalink,
        imageUrl: row.imageUrl,
        isReel: row.isVideo,
        lastCommentAt: at,
        total: 0,
        unanswered: 0,
        comments: [],
      }
      posts.set(key, post)
    }
    post.caption ??= row.caption
    post.permalink ??= row.permalink
    post.imageUrl ??= row.imageUrl
    const replies: BoardReply[] = storedFacebookReplies(row.replies)
      .map((r) => ({ id: r.id, text: r.text, mode: r.mode, createdAt: r.at, authorName: r.authorName, keyword: r.keyword, fromApp: r.fromApp }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const answered = replies.length > 0 || Boolean(row.privateReplyAt)
    post.comments.push({
      id: row.id,
      platform: "facebook",
      conversationId: row.conversationId,
      author: row.fromName || "Facebook",
      text: row.body,
      createdAt: at,
      isThreadReply: Boolean(row.parentId),
      answered,
      privateReplyAvailable: facebookPrivateReplyAvailable(row, input.now),
      keyword: matchCommentKeywordRule(input.rules, row.body, row.channelConfigId)?.keyword ?? null,
      replies,
    })
    post.total += 1
    if (!answered) post.unanswered += 1
    if (at > post.lastCommentAt) post.lastCommentAt = at
  }
  const list = [...posts.values()]
  for (const post of list) post.comments.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return list
}

export type CommentsBoardChannel = { id: string; name: string }

export type CommentsBoard = {
  posts: BoardPost[]
  channels: CommentsBoardChannel[]
  /** True when the window held more comments than the section carries. */
  truncated: boolean
}

/**
 * The organization's comments of the last 30 days, grouped by post. Must run inside the caller's
 * tenant scope. `hiddenChannelIds` — the pages this person may not see; their comments are not read
 * at all, so neither the list nor the counters betray them.
 */
export async function loadCommentsBoard(params: {
  organizationId: string
  hiddenChannelIds: ReadonlySet<string>
  rules: readonly CommentKeywordRule[]
  now?: number
}): Promise<CommentsBoard> {
  const { organizationId, hiddenChannelIds } = params
  const now = params.now ?? Date.now()
  const since = new Date(now - COMMENTS_BOARD_DAYS * 24 * 60 * 60 * 1000)
  const hidden = [...hiddenChannelIds]

  const channelRows: Array<{ id: string; configName: string | null; channelType: string; settings: unknown }> = await prisma.channelConfig.findMany({
    where: {
      organizationId,
      channelType: { in: ["instagram", "facebook"] },
      isActive: true,
      ...(hidden.length ? { id: { notIn: hidden } } : {}),
    },
    select: { id: true, configName: true, channelType: true, settings: true },
    orderBy: { createdAt: "asc" },
  })
  // A Facebook Page is offered only once it was connected with the comment permissions.
  const channels = channelRows
    .filter((c) => c.channelType === "instagram" || rec(c.settings).commentsGranted === true)
    .map((c) => ({ id: c.id, name: c.configName || (c.channelType === "facebook" ? "Facebook" : "Instagram") }))
  // Names for rows of a Page that has since lost the permission: its stored comments still show.
  const channelNames = new Map(channelRows.map((c) => [c.id, c.configName || "Facebook"]))

  const visible = hidden.length
    ? { OR: [{ channelConfigId: null }, { channelConfigId: { notIn: hidden } }] }
    : {}
  // A JSON path that is absent reads as SQL NULL, and NULL matches no LIKE: `string_contains: ""`
  // is «the key is there».
  const rows: CommentRow[] = await prisma.channelMessage.findMany({
    where: {
      organizationId,
      channelType: "instagram",
      direction: "inbound",
      createdAt: { gte: since },
      metadata: { path: ["igComment", "commentId"], string_contains: "" },
      ...visible,
    },
    orderBy: { createdAt: "desc" },
    take: COMMENTS_BOARD_LIMIT + 1,
    select: { id: true, conversationId: true, channelConfigId: true, from: true, body: true, createdAt: true, metadata: true },
  })
  const truncated = rows.length > COMMENTS_BOARD_LIMIT
  const comments = truncated ? rows.slice(0, COMMENTS_BOARD_LIMIT) : rows

  const conversationIds = [...new Set(comments.map((c) => c.conversationId).filter((id): id is string => !!id))]
  const replies: ReplyRow[] = conversationIds.length === 0 ? [] : await prisma.channelMessage.findMany({
    where: {
      organizationId,
      channelType: "instagram",
      direction: "outbound",
      conversationId: { in: conversationIds },
      createdAt: { gte: since },
      metadata: { path: ["igCommentReply", "commentId"], string_contains: "" },
    },
    select: { id: true, body: true, status: true, createdAt: true, metadata: true },
  })

  const facebookRows: FacebookCommentRow[] = await prisma.facebookPageComment.findMany({
    where: { organizationId, removedAt: null, commentedAt: { gte: since }, ...visible },
    orderBy: { commentedAt: "desc" },
    take: COMMENTS_BOARD_LIMIT + 1,
    select: {
      id: true, channelConfigId: true, commentId: true, postId: true, parentId: true, fromId: true, fromName: true,
      body: true, commentedAt: true, caption: true, permalink: true, imageUrl: true, isVideo: true,
      privateReplyAt: true, conversationId: true, replies: true,
    },
  })
  const facebookTruncated = facebookRows.length > COMMENTS_BOARD_LIMIT

  const posts = [
    ...buildCommentsBoard({ comments, replies, channelNames, rules: params.rules, now }),
    ...buildFacebookPosts({
      comments: facebookTruncated ? facebookRows.slice(0, COMMENTS_BOARD_LIMIT) : facebookRows,
      channelNames,
      rules: params.rules,
      now,
    }),
  ].sort((a, b) => b.lastCommentAt.localeCompare(a.lastCommentAt))

  return { posts, channels, truncated: truncated || facebookTruncated }
}
