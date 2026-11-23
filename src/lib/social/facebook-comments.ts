/**
 * Comments under a Facebook Page's posts: what Meta sends and the Graph calls (owner, 2026-11-23).
 *
 * What Meta gives (Webhooks for Pages, Graph API Page comments):
 *   • the `feed` webhook field; a comment is `changes[].value` with `item: "comment"` and a `verb`
 *     (add, edited, remove, hide…). `parent_id` equals `post_id` for a comment directly under the post;
 *   • `from` is the author, by a user id that is NOT their Messenger PSID, and Meta may leave it out.
 *     That is why a Page comment has no conversation until the private reply names the PSID;
 *   • reading needs `pages_read_engagement` + `pages_read_user_content`, answering
 *     `pages_manage_engagement`. Until App Review they work for people with a role on the app.
 *
 * Replies: publicly `POST /<comment-id>/comments`; privately `POST /me/messages` with
 * `recipient.comment_id` (lib/social/meta-dm-attachment) — once per comment, within 7 days.
 *
 * Every Graph call carries the token in the Authorization header and never throws.
 */
import { redactOAuthProviderText } from "@/lib/oauth-redaction"

const GRAPH = process.env.META_GRAPH_BASE || "https://graph.facebook.com/v21.0"

export const FACEBOOK_COMMENT_SCOPES = ["pages_read_engagement", "pages_read_user_content", "pages_manage_engagement"] as const

/** What `?comments=1` asks for: Messenger's own set, which the Page must keep, plus the three above. */
export const FACEBOOK_COMMENT_CONNECT_SCOPES = [
  "public_profile",
  "pages_show_list",
  "business_management",
  "pages_messaging",
  "pages_manage_metadata",
  ...FACEBOOK_COMMENT_SCOPES,
] as const

export const FACEBOOK_PRIVATE_REPLY_DAYS = 7

export type FacebookCommentEvent = {
  verb: string
  commentId: string
  postId: string | null
  /** The comment this one answers; null for a comment directly under the post. */
  parentId: string | null
  fromId: string | null
  fromName: string | null
  text: string
  commentedAt: Date
  permalink: string | null
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

/** `created_time` of a feed event is epoch seconds; an ISO string is taken too. */
function when(value: unknown): Date {
  const parsed = typeof value === "number" ? new Date(value * 1000) : typeof value === "string" ? new Date(value) : null
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : new Date()
}

/** The comments one webhook entry of a Page carries. Posts, likes and shares in `feed` are not taken. */
export function facebookCommentEvents(entry: unknown): FacebookCommentEvent[] {
  const changes = rec(entry).changes
  if (!Array.isArray(changes)) return []
  const out: FacebookCommentEvent[] = []
  for (const change of changes) {
    const c = rec(change)
    if (c.field !== "feed") continue
    const v = rec(c.value)
    if (v.item !== "comment") continue
    const commentId = str(v.comment_id)
    if (!commentId) continue
    const post = rec(v.post)
    const postId = str(v.post_id) ?? str(post.id)
    const parent = str(v.parent_id)
    const from = rec(v.from)
    out.push({
      verb: str(v.verb) ?? "add",
      commentId,
      postId,
      parentId: parent && parent !== postId ? parent : null,
      fromId: str(from.id),
      fromName: str(from.name),
      text: typeof v.message === "string" ? v.message : "",
      commentedAt: when(v.created_time),
      permalink: str(post.permalink_url),
    })
  }
  return out
}

function safeLog(value: unknown): string {
  return redactOAuthProviderText(value instanceof Error ? `${value.name}: ${value.message}` : String(value))
}

/** Did the person leave all three ticks on in Meta's dialog? Any failure reads as «no». */
export async function tokenHoldsFacebookCommentScopes(userToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH}/me/permissions`, {
      headers: { Authorization: `Bearer ${userToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return false
    const data = rec(await res.json()).data
    if (!Array.isArray(data)) return false
    const granted = new Set(data.map(rec).filter((p) => p.status === "granted").map((p) => p.permission))
    return FACEBOOK_COMMENT_SCOPES.every((scope) => granted.has(scope))
  } catch (e) {
    console.warn("[fb-comments] permissions read error:", safeLog(e))
    return false
  }
}

export type FacebookPostInfo = {
  caption: string | null
  permalink: string | null
  imageUrl: string | null
  isVideo: boolean
}

export async function fetchFacebookPostInfo(postId: string, token: string): Promise<FacebookPostInfo | null> {
  if (!postId || !token) return null
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(postId)}?fields=message,permalink_url,full_picture,status_type`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.warn(`[fb-comments] post read failed (${res.status}):`, safeLog(await res.text()))
      return null
    }
    const json = rec(await res.json())
    return {
      caption: typeof json.message === "string" ? json.message : null,
      permalink: str(json.permalink_url),
      imageUrl: str(json.full_picture),
      isVideo: str(json.status_type) === "added_video",
    }
  } catch (e) {
    console.warn("[fb-comments] post read error:", safeLog(e))
    return null
  }
}

/** A public answer under the comment — everyone who opens the post sees it. */
export async function replyToFacebookComment(params: {
  commentId: string
  text: string
  token: string
}): Promise<{ ok: boolean; replyId: string | null; error: string | null }> {
  const { commentId, text, token } = params
  if (!commentId || !text.trim() || !token) return { ok: false, replyId: null, error: "not configured" }
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(commentId)}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
      signal: AbortSignal.timeout(15_000),
    })
    const raw = await res.text()
    if (!res.ok) {
      console.error(`[fb-comments] public reply failed (${res.status}):`, redactOAuthProviderText(raw))
      let reason: string | null = null
      try { reason = str(rec(rec(JSON.parse(raw)).error).message) } catch { /* not JSON */ }
      return { ok: false, replyId: null, error: reason ? redactOAuthProviderText(reason) : `HTTP ${res.status}` }
    }
    let replyId: string | null = null
    try { replyId = str(rec(JSON.parse(raw)).id) } catch { /* a 2xx without a body is still a reply */ }
    return { ok: true, replyId, error: null }
  } catch (e) {
    console.error("[fb-comments] public reply error:", safeLog(e))
    return { ok: false, replyId: null, error: "send error" }
  }
}
