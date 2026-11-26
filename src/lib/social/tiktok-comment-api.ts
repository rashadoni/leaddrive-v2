/**
 * TikTok's own words about comments under an owned video — the only part of this file that talks to
 * TikTok, so the ingest and the reply path are tested against shapes rather than against the network.
 *
 * Endpoints and their parameters are TikTok's «Manage comments on owned TikTok videos» (Accounts API
 * v1.3): `/business/video/list/` gives `item_id`, `/business/comment/list/` the comments of one video,
 * `/business/comment/reply/create/` posts an answer under it. `business_id` is the account's `open_id`
 * — what we store as the social account's handle.
 *
 * The scopes these need (`comment.list`, `comment.list.manage`) were approved for the app on
 * 2026-11-21. Direct messages are a different permission, still closed, so nothing here writes to a
 * person privately.
 */
import { businessAccessToken } from "@/lib/social/tiktok-business-token"

const TIKTOK_BUSINESS_BASE = "https://business-api.tiktok.com/open_api/v1.3"
const REQUEST_TIMEOUT_MS = 15_000

export type TikTokApiAccount = { id: string; accessToken: string | null; tokenExpiresAt?: Date | null }

export type TikTokOwnedVideo = {
  videoId: string
  caption: string | null
  shareUrl: string | null
  commentCount: number
}

export type TikTokComment = {
  commentId: string
  parentId: string | null
  username: string | null
  displayName: string | null
  text: string
  createdAt: Date
  likes: number
  /** TikTok marks the account's own comments; those are answers, not questions. */
  owner: boolean
  replies: TikTokComment[]
}

type Envelope<T> = { code?: number; message?: string; data?: T }

/** What went wrong, in TikTok's words — the caller decides whether to retry or to tell a person. */
export type TikTokApiFailure = { ok: false; code: number | null; message: string }
export type TikTokApiResult<T> = { ok: true; data: T } | TikTokApiFailure

function failure(code: number | null, message: string): TikTokApiFailure {
  return { ok: false, code, message }
}

async function call<T>(input: {
  path: string
  token: string
  method?: "GET" | "POST"
  query?: Record<string, string>
  body?: Record<string, unknown>
  signal?: AbortSignal
}): Promise<TikTokApiResult<T>> {
  const url = new URL(`${TIKTOK_BUSINESS_BASE}${input.path}`)
  for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value)
  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: input.method ?? "GET",
      headers: {
        "Access-Token": input.token,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      redirect: "error",
      cache: "no-store",
      signal: input.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return failure(null, error instanceof Error ? error.message : "request failed")
  }
  const payload = (await response.json().catch(() => null)) as Envelope<T> | null
  if (!payload) return failure(null, `HTTP ${response.status}`)
  // TikTok answers 200 with its own code; only 0 is success, and the message is what support asks for.
  if (payload.code !== 0) return failure(typeof payload.code === "number" ? payload.code : null, payload.message || `code ${payload.code}`)
  return { ok: true, data: (payload.data ?? {}) as T }
}

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null)
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/**
 * TikTok sends `create_time` in seconds, sometimes as a string. A comment whose time is unreadable
 * keeps the moment we read it: it must still show, and «when» is only its place in the list.
 */
export function commentTime(value: unknown, now = Date.now()): Date {
  const seconds = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date(now)
  return new Date(seconds * 1000)
}

export function parseComment(raw: unknown, now = Date.now()): TikTokComment | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  const commentId = str(value.comment_id)
  if (!commentId) return null
  const replies = Array.isArray(value.reply_list)
    ? value.reply_list.map((item) => parseComment(item, now)).filter((item): item is TikTokComment => item !== null)
    : []
  return {
    commentId,
    parentId: str(value.parent_comment_id),
    username: str(value.username) ?? str(value.unique_identifier),
    displayName: str(value.display_name),
    text: typeof value.text === "string" ? value.text : "",
    createdAt: commentTime(value.create_time, now),
    likes: num(value.likes),
    owner: value.owner === true,
    replies,
  }
}

/** The account's own videos, newest first — `item_id` is what the comment endpoints call `video_id`. */
export async function listOwnedVideos(params: {
  account: TikTokApiAccount
  businessId: string
  limit: number
  signal?: AbortSignal
}): Promise<TikTokApiResult<TikTokOwnedVideo[]>> {
  const { token, error } = await businessAccessToken(params.account, params.signal)
  if (!token) return failure(null, error ?? "no access token")
  const result = await call<{ videos?: unknown[] }>({
    path: "/business/video/list/",
    token,
    query: {
      business_id: params.businessId,
      fields: JSON.stringify(["item_id", "caption", "share_url", "comments"]),
      max_count: String(Math.max(1, Math.min(params.limit, 20))),
    },
    signal: params.signal,
  })
  if (!result.ok) return result
  const videos = Array.isArray(result.data.videos) ? result.data.videos : []
  return {
    ok: true,
    data: videos.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return []
      const value = raw as Record<string, unknown>
      const videoId = str(value.item_id)
      if (!videoId) return []
      return [{ videoId, caption: str(value.caption), shareUrl: str(value.share_url), commentCount: num(value.comments) }]
    }),
  }
}

/** Top-level comments of one video, with their replies. */
export async function listVideoComments(params: {
  account: TikTokApiAccount
  businessId: string
  videoId: string
  limit: number
  signal?: AbortSignal
  now?: number
}): Promise<TikTokApiResult<TikTokComment[]>> {
  const { token, error } = await businessAccessToken(params.account, params.signal)
  if (!token) return failure(null, error ?? "no access token")
  const result = await call<{ comments?: unknown[] }>({
    path: "/business/comment/list/",
    token,
    query: {
      business_id: params.businessId,
      video_id: params.videoId,
      include_replies: "true",
      max_count: String(Math.max(1, Math.min(params.limit, 50))),
    },
    signal: params.signal,
  })
  if (!result.ok) return result
  const raw = Array.isArray(result.data.comments) ? result.data.comments : []
  return { ok: true, data: raw.map((item) => parseComment(item, params.now)).filter((item): item is TikTokComment => item !== null) }
}

/**
 * Answers a comment under the video. TikTok returns the new comment's id; without one the caller
 * still has an answer to show, so the id is optional here and generated by the caller.
 */
export async function replyToVideoComment(params: {
  account: TikTokApiAccount
  businessId: string
  videoId: string
  commentId: string
  text: string
  signal?: AbortSignal
}): Promise<TikTokApiResult<{ commentId: string | null }>> {
  const { token, error } = await businessAccessToken(params.account, params.signal)
  if (!token) return failure(null, error ?? "no access token")
  const result = await call<{ comment_id?: unknown }>({
    path: "/business/comment/reply/create/",
    token,
    method: "POST",
    body: {
      business_id: params.businessId,
      video_id: params.videoId,
      comment_id: params.commentId,
      text: params.text,
    },
    signal: params.signal,
  })
  if (!result.ok) return result
  return { ok: true, data: { commentId: str(result.data.comment_id) } }
}
