/**
 * Comments under the posts of an Instagram account connected through Instagram Login.
 *
 * Zeytun, 2026-11-16 (Sabina, marketing): «omnichannel hissəyə instagram komentləri düşmür». The owner
 * chose, from a mock-up, that a comment lands in the conversation with its author — the same one
 * that holds the person's Direct — as a card with the post, and that an operator answers it in Direct
 * by default, or publicly under the post.
 *
 * What Meta gives (Business Login for Instagram, read 2026-11-16):
 *   • the `comments` webhook field, with `instagram_business_basic` + `instagram_business_manage_comments`
 *     at ADVANCED access — without App Review no comment notification arrives at all;
 *   • the payload sits directly on the entry (`entry.field` / `entry.value`), not in `changes[]` as on
 *     Facebook Login; both shapes are read, because Meta's own examples show both;
 *   • `value.from.id` is the Instagram-scoped id — the same id a Direct message comes from, which is
 *     what puts the comment into the person's existing conversation;
 *   • mentions of the account in other people's comments arrive inside `comments` too.
 *
 * Replies: publicly `POST /<comment-id>/replies`; privately `POST /me/messages` with
 * `recipient.comment_id` (lib/social/meta-dm-attachment) — once per comment, within 7 days.
 *
 * Every Graph call here carries the token in the Authorization header, never in the URL, and never
 * throws: a failure is a value.
 */
import { redactOAuthProviderText } from "@/lib/oauth-redaction"

const IG_GRAPH = "https://graph.instagram.com/v21.0"

/** The scope a connection must hold for comments; requested at connect only while COMMENTS_SCOPE_REQUESTED. */
export const IG_COMMENTS_SCOPE = "instagram_business_manage_comments"

/**
 * Meta gives `instagram_business_manage_comments` to accounts without a role on the app only after
 * App Review. Asking every connecting account for a permission the app does not hold yet is a risk
 * nobody needs: until Meta answers, the scope is requested only when the connect link asks for it
 * (`?comments=1` — the tester account the review video is shot on). Turn this on once Meta approves.
 */
export const COMMENTS_SCOPE_REQUESTED = false

/** The code the inbox screen turns into words: Meta takes only text as an answer to a comment. */
export const INSTAGRAM_COMMENT_TEXT_ONLY = "instagram_comment_text_only"

/** Private replies: Meta takes one per comment, within this many days of the comment. */
export const PRIVATE_REPLY_WINDOW_DAYS = 7

export type InstagramCommentEvent = {
  commentId: string
  fromId: string
  username: string | null
  text: string
  mediaId: string | null
  mediaProductType: string | null
  parentId: string | null
}

type Rec = Record<string, unknown>

function rec(value: unknown): Rec {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Rec : {}
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function commentFromValue(value: unknown): InstagramCommentEvent | null {
  const v = rec(value)
  const commentId = str(v.id) ?? str(v.comment_id)
  const from = rec(v.from)
  const fromId = str(from.id)
  if (!commentId || !fromId) return null
  const media = rec(v.media)
  return {
    commentId,
    fromId,
    username: str(from.username),
    text: typeof v.text === "string" ? v.text : "",
    mediaId: str(media.id),
    mediaProductType: str(media.media_product_type),
    parentId: str(v.parent_id),
  }
}

/**
 * The comments one webhook entry carries. Business Login puts `field`/`value` on the entry itself;
 * Facebook Login (and Meta's `live_comments` example) puts them in `changes[]`. Live-broadcast
 * comments are not taken: the app subscribes only `comments`, and a live stream would flood a thread.
 */
export function instagramCommentEvents(entry: unknown): InstagramCommentEvent[] {
  const e = rec(entry)
  const out: InstagramCommentEvent[] = []
  if (e.field === "comments") {
    const one = commentFromValue(e.value)
    if (one) out.push(one)
  }
  if (Array.isArray(e.changes)) {
    for (const change of e.changes) {
      const c = rec(change)
      if (c.field !== "comments") continue
      const one = commentFromValue(c.value)
      if (one) out.push(one)
    }
  }
  return out
}

/**
 * A comment with nothing to answer: only @-tags of friends, emoji and punctuation («@leyla 😍»,
 * «🔥🔥🔥»). A giveaway post collects hundreds of them; each would open a conversation waiting for an
 * answer nobody gives. They stay in Instagram and are not brought into the inbox.
 *
 * A «+» is not noise. Under an ad in Azerbaijan it means «interested, write to me» (owner 2026-11-25:
 * two «+» under the Visitor Analytics reel never reached the inbox), so a comment with a plus is a
 * comment to answer, whatever else it carries.
 */
export function isNoiseComment(text: string): boolean {
  const withoutTags = text.replace(/@[\p{L}\p{N}._]+/gu, " ")
  if (withoutTags.includes("+")) return false
  return !/[\p{L}\p{N}]/u.test(withoutTags)
}

export type InstagramPostInfo = {
  caption: string | null
  permalink: string | null
  mediaType: string | null
  /** Meta's CDN address of a picture of the post; it expires, so the caller keeps a copy. */
  imageUrl: string | null
}

function safeLog(value: unknown): string {
  return redactOAuthProviderText(value instanceof Error ? `${value.name}: ${value.message}` : String(value))
}

/** What the comment card shows about the post: its words, link and a picture. Null on any failure. */
export async function fetchInstagramPostInfo(mediaId: string, token: string): Promise<InstagramPostInfo | null> {
  if (!mediaId || !token) return null
  try {
    const fields = "caption,permalink,media_type,media_url,thumbnail_url"
    const res = await fetch(`${IG_GRAPH}/${encodeURIComponent(mediaId)}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.warn(`[ig-comments] media read failed (${res.status}):`, safeLog(await res.text()))
      return null
    }
    const json = rec(await res.json())
    const mediaType = str(json.media_type)
    // A video's media_url is the video; its picture is thumbnail_url.
    const imageUrl = str(json.thumbnail_url) ?? (mediaType === "VIDEO" ? null : str(json.media_url))
    return {
      caption: typeof json.caption === "string" ? json.caption : null,
      permalink: str(json.permalink),
      mediaType,
      imageUrl,
    }
  } catch (e) {
    console.warn("[ig-comments] media read error:", safeLog(e))
    return null
  }
}

export type InstagramCommentReplyResult = { ok: boolean; replyId: string | null; error: string | null }

/** A public answer under the comment — everyone who opens the post sees it. */
export async function replyToInstagramComment(params: {
  commentId: string
  text: string
  token: string
}): Promise<InstagramCommentReplyResult> {
  const { commentId, text, token } = params
  if (!commentId || !text.trim() || !token) return { ok: false, replyId: null, error: "not configured" }
  try {
    const res = await fetch(`${IG_GRAPH}/${encodeURIComponent(commentId)}/replies`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
      signal: AbortSignal.timeout(15_000),
    })
    const raw = await res.text()
    if (!res.ok) {
      const safe = redactOAuthProviderText(raw)
      console.error(`[ig-comments] public reply failed (${res.status}):`, safe)
      let reason: string | null = null
      try { reason = str(rec(rec(JSON.parse(raw)).error).message) } catch { /* not JSON */ }
      return { ok: false, replyId: null, error: reason ? redactOAuthProviderText(reason) : `HTTP ${res.status}` }
    }
    let replyId: string | null = null
    try { replyId = str(rec(JSON.parse(raw)).id) } catch { /* a 2xx without a body is still a reply */ }
    return { ok: true, replyId, error: null }
  } catch (e) {
    console.error("[ig-comments] public reply error:", safeLog(e))
    return { ok: false, replyId: null, error: "send error" }
  }
}

/** The `igComment` block an inbound comment row carries in `metadata`. */
export type StoredInstagramComment = {
  commentId: string
  mediaId: string | null
  mediaProductType: string | null
  parentId: string | null
  username: string | null
  caption: string | null
  permalink: string | null
  /** Our own stored copy of the post picture (/uploads/…), or null. */
  imageUrl: string | null
  /** Set when the one private reply Meta allows for this comment went out. */
  privateReplyAt?: string
}

export function storedInstagramComment(metadata: unknown): StoredInstagramComment | null {
  const c = rec(rec(metadata).igComment)
  const commentId = str(c.commentId)
  if (!commentId) return null
  return {
    commentId,
    mediaId: str(c.mediaId),
    mediaProductType: str(c.mediaProductType),
    parentId: str(c.parentId),
    username: str(c.username),
    caption: typeof c.caption === "string" ? c.caption : null,
    permalink: str(c.permalink),
    imageUrl: str(c.imageUrl),
    ...(str(c.privateReplyAt) ? { privateReplyAt: str(c.privateReplyAt)! } : {}),
  }
}

/** Is a message row an Instagram comment (not a Direct message)? Readers of the Direct window use this. */
export function isInstagramCommentRow(metadata: unknown): boolean {
  return storedInstagramComment(metadata) !== null
}

/**
 * May an answer to this comment still go privately as a reply to the comment itself? Meta allows it
 * once per comment and within 7 days of it. After that a Direct answer is an ordinary Direct message,
 * which Meta takes only inside the person's own 24-hour window.
 */
export function privateReplyAvailable(comment: { createdAt: Date | string; metadata?: unknown }, now: number = Date.now()): boolean {
  const stored = storedInstagramComment(comment.metadata)
  if (!stored || stored.privateReplyAt) return false
  const at = new Date(comment.createdAt).getTime()
  if (!Number.isFinite(at)) return false
  return now - at < PRIVATE_REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000
}
