import { prisma } from "@/lib/prisma"
import { decryptToken, encryptToken } from "@/lib/secure-token"
import { findMatchedKeyword, ingestMentionWithResult, type ParentMatchContext } from "@/lib/social/ingest-mention"
import { observationContextForCollector, routeExecutionMetadata } from "@/lib/social/collector-observation-context"
import { parentMatchContextsForComments } from "@/lib/social/parent-match-context"
import { isSocialProviderTimeoutError, withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"
import type { MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const TIKTOK_BUSINESS_BASE = "https://business-api.tiktok.com/open_api/v1.3"

type TikTokBusinessComment = {
  comment_id?: string
  video_id?: string
  parent_comment_id?: string
  unique_identifier?: string
  username?: string
  display_name?: string
  profile_image?: string
  create_time?: string | number
  text?: string
  likes?: number
  replies?: number
  reply_list?: TikTokBusinessComment[]
  owner?: boolean
  liked?: boolean
  pinned?: boolean
  status?: string
  image_url?: string
}

type TikTokVideo = {
  item_id?: string
  share_url?: string
  caption?: string
  comments?: number
}

type TikTokPage<T> = {
  code?: number
  message?: string
  request_id?: string
  data?: T
}

type VideoTarget = { id: string; url: string | null; caption: string | null; commentCount: number | null }

function parentPostUrlForVideo(source: MonitoringSourceForRun, video: VideoTarget): string {
  return video.url || source.url || `https://www.tiktok.com/video/${encodeURIComponent(video.id)}`
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean)
}

function isTikTokProviderFailure(error: string | null): boolean {
  return error === "tiktok_business_rate_limited"
    || error === "tiktok_business_permission_denied"
    || error === "tiktok_business_fetch_failed"
}

function videoIdFromUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean)
    const marker = parts.findIndex(part => part === "video")
    return marker >= 0 ? parts[marker + 1] ?? null : null
  } catch {
    return null
  }
}

function configuredVideoIds(source: MonitoringSourceForRun): string[] {
  const settings = record(source.settings)
  return Array.from(new Set([
    ...strings(settings.videoIds),
    ...(typeof settings.videoId === "string" ? [settings.videoId.trim()] : []),
    ...(typeof settings.postExternalId === "string" ? [settings.postExternalId.trim()] : []),
    videoIdFromUrl(source.url) ?? "",
  ].filter(Boolean)))
}

async function linkedTikTokAccount(source: MonitoringSourceForRun) {
  const settings = record(source.settings)
  const accountId = typeof settings.socialAccountId === "string"
    ? settings.socialAccountId
    : typeof settings.accountId === "string" ? settings.accountId : null
  return prisma.socialAccount.findFirst({
    where: {
      organizationId: source.organizationId,
      platform: "tiktok",
      isActive: true,
      ...(accountId ? { id: accountId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  })
}

async function businessAccessToken(
  account: { id: string; accessToken: string | null; tokenExpiresAt?: Date | null } | null,
  parentSignal?: AbortSignal,
): Promise<{
  token: string | null
  error: string | null
}> {
  const env = process.env.TIKTOK_BUSINESS_ACCESS_TOKEN?.trim()
  if (env) return { token: env, error: null }
  if (!account?.accessToken) return { token: null, error: null }
  let access = ""
  let refresh = ""
  try { [access, refresh] = decryptToken(account.accessToken, "oauth:tiktok-business").split("::") } catch { return { token: null, error: null } }
  const expired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 60_000
  if (!expired) return { token: access || null, error: null }
  const clientId = process.env.TIKTOK_BUSINESS_CLIENT_ID?.trim()
  const clientSecret = process.env.TIKTOK_BUSINESS_CLIENT_SECRET?.trim()
  if (!refresh || !clientId || !clientSecret) return { token: null, error: null }
  let refreshed: {
    response: Response
    payload: {
      code?: number
      data?: { access_token?: string; refresh_token?: string; expires_in?: number }
    } | null
  }
  try {
    refreshed = await withSocialProviderTimeout("tiktok_business_token_refresh", async (signal) => {
      const response = await fetch(`${TIKTOK_BUSINESS_BASE}/tt_user/oauth2/refresh_token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refresh }),
        signal,
      })
      const body = await response.text()
      let payload: {
        code?: number
        data?: { access_token?: string; refresh_token?: string; expires_in?: number }
      } | null = null
      try { payload = JSON.parse(body) as typeof payload } catch { /* handled below */ }
      return { response, payload }
    }, { signal: parentSignal })
  } catch (error) {
    return {
      token: null,
      error: isSocialProviderTimeoutError(error)
        ? "tiktok_business_token_refresh_timeout"
        : "tiktok_business_token_refresh_network",
    }
  }
  const { response, payload } = refreshed
  if (!response.ok || payload?.code !== 0 || !payload.data?.access_token) return { token: null, error: null }
  const nextRefresh = payload.data.refresh_token || refresh
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encryptToken(`${payload.data.access_token}::${nextRefresh}`, "oauth:tiktok-business"),
      tokenExpiresAt: payload.data.expires_in ? new Date(Date.now() + payload.data.expires_in * 1000) : null,
    },
  })
  return { token: payload.data.access_token, error: null }
}

async function fetchTikTok<T>(path: string, token: string, params: Record<string, string>, parentSignal?: AbortSignal): Promise<
  { ok: true; data: T; requestId: string | null }
  | { ok: false; status: number; error: string; requestId: string | null; body: string; dispatchUnknown: boolean }
> {
  const url = new URL(`${TIKTOK_BUSINESS_BASE}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  try {
    return await withSocialProviderTimeout("tiktok_business_api", async (signal) => {
      const response = await fetch(url, { headers: { "Access-Token": token }, signal })
      const body = await response.text()
      let payload: TikTokPage<T> | null = null
      try { payload = JSON.parse(body) as TikTokPage<T> } catch { /* reported below */ }
      if (!response.ok || payload?.code !== 0 || !payload.data) {
        const message = `${payload?.message ?? ""} ${body}`.toLowerCase()
        const error = response.status === 429 || message.includes("rate limit") ? "tiktok_business_rate_limited"
          : response.status === 401 || response.status === 403 || message.includes("permission") || message.includes("authorized") ? "tiktok_business_permission_denied"
            : "tiktok_business_fetch_failed"
        return { ok: false as const, status: response.status, error, requestId: payload?.request_id ?? null, body, dispatchUnknown: false }
      }
      return { ok: true as const, data: payload.data, requestId: payload.request_id ?? null }
    }, { signal: parentSignal })
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: isSocialProviderTimeoutError(error) ? "tiktok_business_timeout" : "tiktok_business_network",
      requestId: null,
      body: "",
      dispatchUnknown: true,
    }
  }
}

export function nextTikTokCursor(input: { hasMore: boolean | undefined; cursor: string | number | undefined; seen: Set<string> }): { cursor: string | undefined; error: string | null } {
  if (!input.hasMore) return { cursor: undefined, error: null }
  const cursor = String(input.cursor ?? "").trim()
  if (!cursor) return { cursor: undefined, error: "tiktok_pagination_cursor_missing" }
  if (input.seen.has(cursor)) return { cursor: undefined, error: "tiktok_pagination_cursor_repeated" }
  input.seen.add(cursor)
  return { cursor, error: null }
}

async function listOwnedVideos(input: {
  businessId: string
  token: string
  maxVideos: number
  maxPages: number
  parentSignal?: AbortSignal
}): Promise<{ videos: VideoTarget[]; pages: number; error: string | null; requestIds: string[]; dispatchUnknown: boolean }> {
  const videos: VideoTarget[] = []
  const requestIds: string[] = []
  let cursor: string | undefined
  const seenCursors = new Set<string>()
  let pages = 0
  let error: string | null = null
  let dispatchUnknown = false
  do {
    if (pages >= input.maxPages) {
      error = "tiktok_pagination_max_pages"
      break
    }
    const response = await fetchTikTok<{ videos?: TikTokVideo[]; cursor?: string | number; has_more?: boolean }>(
      "/business/video/list/",
      input.token,
      {
        business_id: input.businessId,
        fields: JSON.stringify(["item_id", "share_url", "caption", "comments"]),
        max_count: String(Math.min(20, input.maxVideos - videos.length)),
        ...(cursor ? { cursor } : {}),
      },
      input.parentSignal,
    )
    if (!response.ok) { error = response.error; dispatchUnknown = response.dispatchUnknown; break }
    pages += 1
    if (response.requestId) requestIds.push(response.requestId)
    for (const video of response.data.videos ?? []) {
      const id = video.item_id?.trim()
      if (!id || videos.some(existing => existing.id === id)) continue
      videos.push({ id, url: video.share_url?.trim() || null, caption: video.caption?.trim() || null, commentCount: video.comments ?? null })
      if (videos.length >= input.maxVideos) break
    }
    const next = nextTikTokCursor({ hasMore: response.data.has_more, cursor: response.data.cursor, seen: seenCursors })
    if (next.error) { error = next.error; break }
    cursor = next.cursor
  } while (cursor && videos.length < input.maxVideos)
  return { videos, pages, error, requestIds, dispatchUnknown }
}

async function persistComment(input: {
  source: MonitoringSourceForRun
  accountId: string | null
  comment: TikTokBusinessComment
  video: VideoTarget
  topLevelId: string
  reply: boolean
  keywords: string[]
  parentMatchContext: ParentMatchContext | null
}) {
  const id = input.comment.comment_id?.trim()
  const text = input.comment.text?.trim()
  if (!id || !text) return { ignored: true, accepted: false, created: false }
  const parentPostUrl = parentPostUrlForVideo(input.source, input.video)
  const separator = parentPostUrl.includes("?") ? "&" : "?"
  const commentUrl = `${parentPostUrl}${separator}comment_id=${encodeURIComponent(id)}`
  const matchedTerm = findMatchedKeyword(text, input.keywords)
  const result = await ingestMentionWithResult({
    organizationId: input.source.organizationId,
    accountId: input.accountId,
    platform: "tiktok",
    externalId: id,
    sourceType: input.reply ? "reply" : "comment",
    contentKind: input.reply ? "REPLY" : "COMMENT",
    postExternalId: input.video.id,
    parentExternalId: input.reply ? input.topLevelId : input.video.id,
    threadExternalId: input.topLevelId,
    replyToExternalId: input.reply ? input.topLevelId : null,
    depth: input.reply ? 1 : 0,
    canonicalUrl: commentUrl,
    parentPostUrl,
    sourceProvider: "native",
    sourceMetadata: {
      businessApiVersion: "v1.3",
      officialCollector: true,
      status: input.comment.status ?? null,
      owner: input.comment.owner ?? false,
      pinned: input.comment.pinned ?? false,
      videoCaption: input.video.caption,
      ...routeExecutionMetadata(input.source),
    },
    text,
    sentiment: null,
    matchedTerm,
    engagement: input.comment.likes ?? 0,
    url: commentUrl,
    authorName: input.comment.display_name ?? null,
    authorHandle: input.comment.unique_identifier ?? input.comment.username ?? null,
    authorAvatar: input.comment.profile_image ?? null,
    publishedAt: input.comment.create_time ? new Date(Number(input.comment.create_time) * 1000) : null,
    ...(input.parentMatchContext ? { parentMatchContext: input.parentMatchContext } : {}),
    observation: observationContextForCollector(input.source, {
      providerItemId: id,
      rawPayload: { comment: input.comment, video: input.video },
      requireMatchedTerm: input.source.routeExecution?.capability === "READ_EXTERNAL_COMMENTS",
    }),
  })
  if (result.accepted === false) return { ignored: false, accepted: false, created: false }

  const evidence = await prisma.mentionEvidence.findFirst({
    where: {
      organizationId: input.source.organizationId,
      mentionId: result.id,
      sourceId: input.source.id,
      permalink: commentUrl,
    },
    select: { id: true },
  })
  const data = {
    permalink: commentUrl,
    rawSnippet: text,
    rawPayload: { comment: input.comment, video: input.video },
    capturedAt: new Date(),
    confidence: 1,
    sourceTrustTier: "T1",
  }
  if (evidence) await prisma.mentionEvidence.update({ where: { id: evidence.id }, data })
  else await prisma.mentionEvidence.create({ data: { organizationId: input.source.organizationId, mentionId: result.id, sourceId: input.source.id, ...data } })
  return { ignored: false, accepted: true, created: result.created }
}

export async function runTikTokBusinessCommentsCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const account = await linkedTikTokAccount(source)
  const settings = record(source.settings)
  const access = await businessAccessToken(account, source.providerRequestSignal)
  const token = access.token
  const businessId = (typeof settings.tiktokBusinessId === "string" ? settings.tiktokBusinessId.trim() : "")
    || (typeof settings.businessId === "string" ? settings.businessId.trim() : "")
    || process.env.TIKTOK_BUSINESS_ID?.trim()
    || account?.handle?.trim()
    || ""
  if (access.error) {
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: access.error,
      rawStats: { failClosed: true, providerRequestDispatched: false, dispatchUnknown: false },
    }
  }
  if (!token || !businessId) {
    return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "tiktok_business_credentials_missing", rawStats: { failClosed: true, providerRequestDispatched: false, dispatchUnknown: false } }
  }
  if (source.providerRequestSignal?.aborted) {
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "tiktok_business_timeout",
      rawStats: { failClosed: true, providerRequestDispatched: false, dispatchUnknown: false },
    }
  }

  const maxItems = Math.max(1, Math.min(source.routeExecution?.maxItems ?? 1000, 5000))
  const maxVideos = Math.max(1, Math.min(Number(settings.maxVideos) || 20, 100))
  const maxPages = Math.max(1, Math.min(Number(settings.maxPages) || 100, 100))
  const configured = configuredVideoIds(source)
  let targets: VideoTarget[] = configured.map(id => ({
    id,
    url: videoIdFromUrl(source.url) === id ? source.url ?? null : null,
    caption: null,
    commentCount: null,
  }))
  let videoPages = 0
  let partialError: string | null = null
  let providerRequestDispatched = false
  let dispatchUnknown = false
  const requestIds: string[] = []
  if (targets.length === 0) {
    providerRequestDispatched = true
    const listed = await listOwnedVideos({ businessId, token, maxVideos, maxPages, parentSignal: source.providerRequestSignal })
    targets = listed.videos
    videoPages = listed.pages
    partialError = listed.error
    dispatchUnknown = listed.dispatchUnknown
    requestIds.push(...listed.requestIds)
    if (listed.dispatchUnknown) {
      return {
        status: "failed",
        foundCount: 0,
        newCount: 0,
        duplicateCount: 0,
        ignoredCount: 0,
        error: listed.error,
        rawStats: {
          videoPages,
          requestIds,
          coverageClass: "BLOCKED",
          providerRequestDispatched,
          dispatchUnknown: true,
        },
      }
    }
    if (listed.error && (targets.length === 0 || isTikTokProviderFailure(listed.error))) {
      return { status: "failed", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: listed.error, rawStats: { videoPages, requestIds, coverageClass: "BLOCKED", providerRequestDispatched, dispatchUnknown } }
    }
  }

  const keywords = Array.from(new Set([...(source.keywords ?? []), ...(account?.keywords ?? [])].map(value => value.trim()).filter(Boolean)))
  const seen = new Set<string>()
  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  let commentPages = 0
  let replyPages = 0
  let topLevelTraversalCapped = false
  const replyCandidates: Array<{ video: VideoTarget; topLevelId: string }> = []
  const seenReplyCandidateIds = new Set<string>()

  const targetParentUrls = targets.map(video => parentPostUrlForVideo(source, video))
  const resolvedParentContexts = await parentMatchContextsForComments(
    source.organizationId,
    "tiktok",
    targetParentUrls,
    targets.map(video => video.id),
  )
  const parentContextByVideoId = new Map(targets.map(video => {
    const parentUrl = parentPostUrlForVideo(source, video)
    return [
      video.id,
      resolvedParentContexts.get(video.id)
        ?? resolvedParentContexts.get(parentUrl)
        ?? null,
    ] as const
  }))

  const store = async (comment: TikTokBusinessComment, video: VideoTarget, topLevelId: string, reply: boolean) => {
    const id = comment.comment_id?.trim()
    // TikTok documents possible duplicates after 500 sorted results. Never
    // count or persist the same external comment twice within one execution.
    if (!id || seen.has(id)) { duplicateCount += id ? 1 : 0; ignoredCount += id ? 0 : 1; return }
    seen.add(id)
    foundCount += 1
    const persisted = await persistComment({
      source,
      accountId: account?.id ?? null,
      comment,
      video,
      topLevelId,
      reply,
      keywords,
      parentMatchContext: parentContextByVideoId.get(video.id) ?? null,
    })
    if (persisted.ignored || !persisted.accepted) ignoredCount += 1
    else if (persisted.created) newCount += 1
    else duplicateCount += 1
  }

  videoLoop: for (const video of targets) {
    if (foundCount >= maxItems) break
    if (source.providerRequestSignal?.aborted) {
      partialError = "tiktok_business_timeout"
      dispatchUnknown = providerRequestDispatched
      break
    }
    let cursor: string | undefined
    const seenCommentCursors = new Set<string>()
    do {
      if (commentPages >= maxPages) {
        partialError = "tiktok_pagination_max_pages"
        topLevelTraversalCapped = true
        break
      }
      if (source.providerRequestSignal?.aborted) {
        partialError = "tiktok_business_timeout"
        dispatchUnknown = providerRequestDispatched
        break videoLoop
      }
      providerRequestDispatched = true
      const response = await fetchTikTok<{ comments?: TikTokBusinessComment[]; cursor?: string | number; has_more?: boolean }>(
        "/business/comment/list/",
        token,
        {
          business_id: businessId,
          video_id: video.id,
          include_replies: "false",
          status: "ALL",
          sort_field: "create_time",
          sort_order: "DESC",
          max_count: "30",
          ...(cursor ? { cursor } : {}),
        },
        source.providerRequestSignal,
      )
      if (!response.ok) {
        partialError = response.error
        dispatchUnknown ||= response.dispatchUnknown
        break videoLoop
      }
      commentPages += 1
      if (response.requestId) requestIds.push(response.requestId)
      for (const comment of response.data.comments ?? []) {
        if (foundCount >= maxItems) break
        if (source.providerRequestSignal?.aborted) {
          partialError = "tiktok_business_timeout"
          dispatchUnknown = true
          break videoLoop
        }
        const topLevelId = comment.comment_id?.trim()
        if (!topLevelId) { ignoredCount += 1; continue }
        await store(comment, video, topLevelId, false)
        const replyCandidateId = `${video.id}:${topLevelId}`
        if (
          (comment.replies ?? comment.reply_list?.length ?? 0) > 0
          && !seenReplyCandidateIds.has(replyCandidateId)
        ) {
          seenReplyCandidateIds.add(replyCandidateId)
          replyCandidates.push({ video, topLevelId })
        }
      }
      const nextComment = nextTikTokCursor({ hasMore: response.data.has_more, cursor: response.data.cursor, seen: seenCommentCursors })
      if (nextComment.error) { partialError = nextComment.error; break }
      cursor = nextComment.cursor
    } while (cursor && foundCount < maxItems)
  }

  // Spend the reply budget only after top-level pagination across every video
  // has completed. Otherwise a large reply tree on the first video repeatedly
  // starves later videos because provider order is deterministic.
  replyLoop: for (const { video, topLevelId } of replyCandidates) {
    if (
      foundCount >= maxItems
      || topLevelTraversalCapped
      || dispatchUnknown
      || isTikTokProviderFailure(partialError)
    ) break
    let replyCursor: string | undefined
    const seenReplyCursors = new Set<string>()
    do {
      if (replyPages >= maxPages) { partialError = "tiktok_pagination_max_pages"; break replyLoop }
      if (source.providerRequestSignal?.aborted) {
        partialError = "tiktok_business_timeout"
        dispatchUnknown = providerRequestDispatched
        break replyLoop
      }
      providerRequestDispatched = true
      const replies = await fetchTikTok<{ comments?: TikTokBusinessComment[]; cursor?: string | number; has_more?: boolean }>(
        "/business/comment/reply/list/",
        token,
        {
          business_id: businessId,
          video_id: video.id,
          comment_id: topLevelId,
          status: "ALL",
          sort_field: "create_time",
          sort_order: "ASC",
          max_count: "30",
          ...(replyCursor ? { cursor: replyCursor } : {}),
        },
        source.providerRequestSignal,
      )
      if (!replies.ok) {
        partialError = replies.error
        dispatchUnknown ||= replies.dispatchUnknown
        break replyLoop
      }
      replyPages += 1
      if (replies.requestId) requestIds.push(replies.requestId)
      for (const reply of replies.data.comments ?? []) {
        if (foundCount >= maxItems) break
        if (source.providerRequestSignal?.aborted) {
          partialError = "tiktok_business_timeout"
          dispatchUnknown = true
          break replyLoop
        }
        await store(reply, video, topLevelId, true)
      }
      const nextReply = nextTikTokCursor({ hasMore: replies.data.has_more, cursor: replies.data.cursor, seen: seenReplyCursors })
      if (nextReply.error) { partialError = nextReply.error; break }
      replyCursor = nextReply.cursor
    } while (replyCursor && foundCount < maxItems)
  }

  return {
    status: dispatchUnknown || isTikTokProviderFailure(partialError)
      ? "failed"
      : partialError ? "partial" : "success",
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: partialError,
    rawStats: {
      platform: "tiktok",
      businessApiVersion: "v1.3",
      videos: targets.length,
      videoPages,
      commentPages,
      replyPages,
      topLevelTraversalCapped,
      deferredReplyThreads: replyCandidates.length,
      requestIds: requestIds.slice(-20),
      maxItems,
      capped: foundCount >= maxItems,
      coverageClass: foundCount >= maxItems ? "SAMPLED" : partialError ? "PARTIAL" : "COMPLETE_FOR_INPUT",
      watermarkEligible: !partialError && foundCount < maxItems,
      resumeMode: partialError ? "RETRY_FROM_START_WITH_TENANT_EXTERNAL_ID_DEDUPE" : null,
      lastCompleteCommentPage: commentPages,
      lastCompleteReplyPage: replyPages,
      providerRequestDispatched,
      dispatchUnknown,
    },
  }
}
