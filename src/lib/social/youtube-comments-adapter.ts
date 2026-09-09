import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { findMatchedKeyword, ingestMentionWithResult, type ParentMatchContext } from "@/lib/social/ingest-mention"
import { observationContextForCollector, routeExecutionMetadata } from "@/lib/social/collector-observation-context"
import { parentMatchContextsForComments } from "@/lib/social/parent-match-context"
import { withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"
import { refreshYouTubeToken } from "@/lib/social/youtube-poller"
import type { MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import {
  decideYouTubePublication,
  isYouTubePublicationEligibleForComments,
  type YouTubePublicationDecision,
} from "@/lib/social/youtube-publication-gate"
import {
  ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES,
  resolveArchiveProviderWindow,
  scenarioArchiveStartAtForSource,
  withArchiveProviderCursorOverlap,
} from "@/lib/social/archive-provider-window"

type YouTubeComment = {
  id?: string
  snippet?: {
    textOriginal?: string
    textDisplay?: string
    authorDisplayName?: string
    authorChannelId?: { value?: string }
    authorProfileImageUrl?: string
    publishedAt?: string
    updatedAt?: string
    likeCount?: number
    parentId?: string
  }
}

type CommentThread = {
  id?: string
  snippet?: {
    videoId?: string
    totalReplyCount?: number
    canReply?: boolean
    topLevelComment?: YouTubeComment
  }
}

type YouTubeSearchResult = {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    channelId?: string
    channelTitle?: string
    publishedAt?: string
    thumbnails?: Record<string, { url?: string }>
  }
}

type YouTubeVideoResult = {
  id?: string
  snippet?: YouTubeSearchResult["snippet"]
}

type CommentWindowPosition = "inside" | "before" | "after" | "unknown"

const YOUTUBE_SELECTIVE_LOOKBACK_HOURS = 24 * 7
const DEFAULT_MAX_COMMENT_REQUESTS = 25
const MAX_COMMENT_REQUESTS = 100
const NEGATIVE_THREAD_MIN_ITEMS = 1000
const DEFAULT_NEGATIVE_RESCAN_TARGETS = 25
const MAX_NEGATIVE_RESCAN_TARGETS = 100

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function youtubeVideoIdFromUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const queryId = url.searchParams.get("v")?.trim()
    if (queryId) return queryId
    const parts = url.pathname.split("/").filter(Boolean)
    const marker = parts.findIndex(part => part === "shorts" || part === "live" || part === "embed")
    return marker >= 0
      ? parts[marker + 1]?.trim() || null
      : url.hostname.toLowerCase() === "youtu.be"
        ? parts[0]?.trim() || null
        : null
  } catch {
    return null
  }
}

function rawYoutubeVideoId(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized && /^[\w-]+$/.test(normalized) ? normalized : null
}

function configuredVideoId(source: MonitoringSourceForRun): string | null {
  const settings = record(source.settings)
  for (const value of [settings.videoId, settings.postExternalId]) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return youtubeVideoIdFromUrl(source.url)
}

async function durableNegativeYoutubeVideoIds(input: {
  source: MonitoringSourceForRun
  settings: Record<string, unknown>
  limit: number
  now: Date
}): Promise<{ videoIds: string[]; subjectCount: number; totalCount: number; rotationOffset: number }> {
  const scenarioLinks = Array.isArray(input.settings.scenarioLinks)
    ? input.settings.scenarioLinks.map(record)
    : []
  const candidateSubjectIds = Array.from(new Set([
    stringValue(input.source.routeExecution?.targetSubjectId),
    stringValue(input.settings.subjectId),
    stringValue(input.settings.targetSubjectId),
    ...scenarioLinks.map(link => stringValue(link.subjectId)),
  ].filter((value): value is string => Boolean(value))))
  const activeSubjects = await prisma.monitoringSubject.findMany({
    where: {
      organizationId: input.source.organizationId,
      status: "active",
      OR: [
        { sources: { some: { sourceId: input.source.id } } },
        ...(candidateSubjectIds.length > 0
          ? [{ id: { in: candidateSubjectIds } }]
          : []),
      ],
    },
    select: { id: true },
  })
  const subjectIds = Array.from(new Set(activeSubjects.map(subject => subject.id))).sort()
  if (subjectIds.length === 0) {
    return { videoIds: [], subjectCount: 0, totalCount: 0, rotationOffset: 0 }
  }

  const where = {
    organizationId: input.source.organizationId,
    platform: "youtube",
    contentKind: { in: ["VIDEO", "POST"] },
    sentiment: "negative",
    deletedAtSource: null,
    purgedAt: null,
    subjectMatches: {
      some: {
        organizationId: input.source.organizationId,
        subjectId: { in: subjectIds },
        status: "MATCHED",
      },
    },
  } satisfies Prisma.SocialMentionWhereInput
  const take = Math.min(Math.max(Math.trunc(input.limit), 1), MAX_NEGATIVE_RESCAN_TARGETS)
  const totalCount = await prisma.socialMention.count({ where })
  if (totalCount === 0) {
    return { videoIds: [], subjectCount: subjectIds.length, totalCount: 0, rotationOffset: 0 }
  }
  // Rotate one bounded slice per source cadence. Sorting by immutable id makes
  // the window deterministic inside a cadence bucket; wrapping prevents a
  // permanently newest-only take from starving older negative publications.
  const cadenceMs = Math.max(15, Math.trunc(input.source.cadenceMinutes || 60)) * 60_000
  const rotationBucket = Math.floor(input.now.getTime() / cadenceMs)
  const rotationOffset = totalCount <= take
    ? rotationBucket % totalCount
    : (rotationBucket * take) % totalCount
  const select = {
    externalId: true,
    postExternalId: true,
    canonicalUrl: true,
    url: true,
  } satisfies Prisma.SocialMentionSelect
  const firstTake = Math.min(take, totalCount - rotationOffset)
  const firstRows = await prisma.socialMention.findMany({
    where,
    orderBy: { id: "asc" },
    skip: rotationOffset,
    take: firstTake,
    select,
  })
  const wrappedTake = Math.min(take - firstRows.length, rotationOffset)
  const wrappedRows = wrappedTake > 0
    ? await prisma.socialMention.findMany({
        where,
        orderBy: { id: "asc" },
        skip: 0,
        take: wrappedTake,
        select,
      })
    : []
  const rows = [...firstRows, ...wrappedRows]
  const videoIds = Array.from(new Set(rows.flatMap(row => {
    const videoId = rawYoutubeVideoId(row.postExternalId)
      ?? youtubeVideoIdFromUrl(row.canonicalUrl)
      ?? youtubeVideoIdFromUrl(row.url)
      ?? rawYoutubeVideoId(row.externalId)
    return videoId ? [videoId] : []
  })))
  return { videoIds, subjectCount: subjectIds.length, totalCount, rotationOffset }
}

function configuredChannelId(source: MonitoringSourceForRun, accountHandle: string | null): string | null {
  const settings = record(source.settings)
  for (const value of [settings.channelId, settings.youtubeChannelId]) {
    if (typeof value === "string" && /^UC[\w-]{20,}$/.test(value.trim())) return value.trim()
  }
  const handle = source.handle?.trim()
  if (handle && /^UC[\w-]{20,}$/.test(handle)) return handle
  if (source.url) {
    try {
      const parts = new URL(source.url).pathname.split("/").filter(Boolean)
      const channelIndex = parts.indexOf("channel")
      const channelId = channelIndex >= 0 ? parts[channelIndex + 1] : null
      if (channelId && /^UC[\w-]{20,}$/.test(channelId)) return channelId
    } catch {
      // URL validation happens before persistence; keep the collector defensive.
    }
  }
  return source.ownership === "owned" && accountHandle ? accountHandle : null
}

function configuredChannelHandle(source: MonitoringSourceForRun): string | null {
  const settings = record(source.settings)
  for (const value of [settings.channelHandle, source.handle]) {
    if (typeof value === "string" && value.trim() && !/^UC[\w-]{20,}$/.test(value.trim())) {
      return value.trim().replace(/^@/, "")
    }
  }
  if (source.url) {
    try {
      const segment = new URL(source.url).pathname.split("/").filter(Boolean).find(part => part.startsWith("@"))
      return segment?.slice(1) || null
    } catch {
      return null
    }
  }
  return null
}

function searchQuery(source: MonitoringSourceForRun, keywords: string[]): string | null {
  const explicit = source.query?.trim()
  if (explicit) return explicit.slice(0, 500)
  if (!["keyword", "hashtag", "campaign", "search_url", "manual"].includes(source.sourceType)) return null
  const terms = keywords.map(value => value.replace(/^#+/, "").trim()).filter(Boolean).slice(0, 10)
  return terms.length > 0 ? terms.join("|").slice(0, 500) : null
}

function commentSearchTerms(query: string | null, keywords: string[]): string[] {
  const candidates = keywords.length > 0
    ? keywords
    : (query?.split("|") ?? [])
  const unique = new Map<string, string>()
  for (const candidate of candidates) {
    const term = candidate.trim()
    if (!term || term.startsWith("-")) continue
    const key = term.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, term.slice(0, 500))
    if (unique.size >= 10) break
  }
  return Array.from(unique.values())
}

function thumbnailUrl(result: YouTubeSearchResult): string | null {
  const thumbnails = result.snippet?.thumbnails ?? {}
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const value = thumbnails[key]?.url?.trim()
    if (value) return value
  }
  return null
}

function commentWindowPosition(
  comment: YouTubeComment,
  window: { since: Date; until: Date } | null,
): CommentWindowPosition {
  if (!window) return "inside"
  const value = comment.snippet?.publishedAt
  if (!value) return "unknown"
  const publishedAt = new Date(value)
  if (!Number.isFinite(publishedAt.getTime())) return "unknown"
  if (publishedAt.getTime() < window.since.getTime()) return "before"
  if (publishedAt.getTime() > window.until.getTime()) return "after"
  return "inside"
}

async function youtubeAccount(source: MonitoringSourceForRun) {
  const settings = record(source.settings)
  const accountId = typeof settings.socialAccountId === "string" ? settings.socialAccountId : null
  return prisma.socialAccount.findFirst({
    where: {
      organizationId: source.organizationId,
      platform: "youtube",
      isActive: true,
      ...(accountId ? { id: accountId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  })
}

/**
 * Extracts Google's machine reason from an API error body — the exact
 * discriminator between e.g. rate-based 429s and daily-quota 403s
 * (`rateLimitExceeded` / `userRateLimitExceeded` / `quotaExceeded`). Covers
 * both the legacy `error.errors[].reason` shape and the newer `error.status`.
 */
function googleApiErrorDetails(body: string): { reason: string | null; status: string | null } {
  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: Array<{ reason?: string }>; status?: string }
    }
    const rawReason = parsed.error?.errors?.[0]?.reason
    const rawStatus = parsed.error?.status
    return {
      reason: typeof rawReason === "string" && rawReason.trim() ? rawReason.trim().slice(0, 80) : null,
      status: typeof rawStatus === "string" && rawStatus.trim() ? rawStatus.trim().slice(0, 80) : null,
    }
  } catch {
    return { reason: null, status: null }
  }
}

const HARD_YOUTUBE_QUOTA_REASON = /^(?:quotaExceeded|dailyLimitExceeded(?:Unreg)?|limitExceeded|RESOURCE_EXHAUSTED)$/i

type YouTubeFetchContext = {
  token: string | null
  apiKey: string | null
  parentSignal?: AbortSignal
  /** Bounded per-run 429 retry budget — keeps a cron tick from stalling. */
  retriesLeft: number
}

async function fetchYouTube<T>(url: URL, ctx: YouTubeFetchContext): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; reason: string | null; body: string }> {
  for (;;) {
    if (!ctx.token && ctx.apiKey) url.searchParams.set("key", ctx.apiKey)
    const youtubeResponse = await withSocialProviderTimeout("youtube", async signal => {
      const response = await fetch(url, {
        ...(ctx.token ? { headers: { Authorization: `Bearer ${ctx.token}` } } : {}),
        signal,
      })
      if (response.ok) {
        return { response, data: await response.json() as T, body: "" }
      }
      const body = await response.text().catch(error => {
        if (signal.aborted) throw error
        return ""
      })
      return { response, data: null, body }
    }, { signal: ctx.parentSignal })
    const { response, body } = youtubeResponse
    if (response.ok) return { ok: true, data: youtubeResponse.data as T }
    const details = googleApiErrorDetails(body)
    const reason = details.reason ?? details.status
    const quotaExhausted = [details.reason, details.status]
      .some(value => Boolean(value && HARD_YOUTUBE_QUOTA_REASON.test(value)))
    const rateLimited = quotaExhausted
      || Boolean(reason && /rateLimit/i.test(reason))
      || response.status === 429
    if (response.status === 429 && ctx.retriesLeft > 0 && !quotaExhausted) {
      // One bounded retry per budget slot, honouring Retry-After (capped at 2s
      // so a sequential cron tick over many sources cannot stall on sleeps).
      ctx.retriesLeft -= 1
      const retryAfterSeconds = Number(response.headers.get("retry-after"))
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
        ? Math.min(retryAfterSeconds * 1000, 2000)
        : 1000
      await new Promise(resolve => setTimeout(resolve, delayMs))
      continue
    }
    const base = body.includes("commentsDisabled") ? "youtube_comments_disabled"
      : rateLimited ? "youtube_rate_limited"
        : response.status === 403 ? "youtube_permission_denied"
          : "youtube_fetch_failed"
    // The `:reason` suffix keeps the stable machine prefix (regex classifiers
    // and coverage alerts keep matching) while making lastError diagnosable.
    const error = base === "youtube_comments_disabled" || !reason ? base : `${base}:${reason}`
    return { ok: false, status: response.status, error, reason, body }
  }
}

async function persistComment(input: {
  source: MonitoringSourceForRun
  accountId: string | null
  comment: YouTubeComment
  videoId: string
  topLevelId: string
  reply: boolean
  canReply: boolean
  keywords: string[]
  parentMatchContext: ParentMatchContext | null
}) {
  const id = input.comment.id?.trim()
  const snippet = input.comment.snippet
  const text = (snippet?.textOriginal || snippet?.textDisplay || "").trim()
  if (!id || !text) return { ignored: true, created: false, accepted: false }
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(input.videoId)}`
  const commentUrl = `${watchUrl}&lc=${encodeURIComponent(id)}`
  const matchedTerm = findMatchedKeyword(text, input.keywords)
  const result = await ingestMentionWithResult({
    organizationId: input.source.organizationId,
    accountId: input.accountId,
    platform: "youtube",
    externalId: id,
    sourceType: input.reply ? "reply" : "comment",
    contentKind: input.reply ? "REPLY" : "COMMENT",
    postExternalId: input.videoId,
    parentExternalId: input.reply ? input.topLevelId : input.videoId,
    threadExternalId: input.topLevelId,
    replyToExternalId: input.reply ? input.topLevelId : null,
    depth: input.reply ? 1 : 0,
    canonicalUrl: commentUrl,
    parentPostUrl: watchUrl,
    sourceProvider: "native",
    sourceMetadata: {
      videoId: input.videoId,
      topLevelCommentId: input.topLevelId,
      youtubeCanReply: input.canReply,
      ownership: input.source.ownership ?? "unknown",
      officialCollector: true,
      ...routeExecutionMetadata(input.source),
    },
    text,
    sentiment: null,
    matchedTerm,
    engagement: snippet?.likeCount ?? 0,
    url: commentUrl,
    authorName: snippet?.authorDisplayName ?? null,
    authorHandle: snippet?.authorChannelId?.value ?? null,
    authorAvatar: snippet?.authorProfileImageUrl ?? null,
    publishedAt: snippet?.publishedAt ? new Date(snippet.publishedAt) : null,
    editedAt: snippet?.updatedAt && snippet.updatedAt !== snippet.publishedAt ? new Date(snippet.updatedAt) : null,
    ...(input.parentMatchContext ? { parentMatchContext: input.parentMatchContext } : {}),
    observation: observationContextForCollector(input.source, {
      providerItemId: id,
      rawPayload: { comment: input.comment, videoId: input.videoId },
      requireMatchedTerm: input.source.routeExecution?.capability === "READ_EXTERNAL_COMMENTS",
    }),
  })
  if (result.accepted === false) return { ignored: false, created: false, accepted: false }

  const existingEvidence = await prisma.mentionEvidence.findFirst({
    where: {
      organizationId: input.source.organizationId,
      mentionId: result.id,
      sourceId: input.source.id,
      permalink: commentUrl,
    },
    select: { id: true },
  })
  if (existingEvidence) {
    await prisma.mentionEvidence.update({
      where: { id: existingEvidence.id },
      data: {
        permalink: commentUrl,
        rawSnippet: text,
        rawPayload: { comment: input.comment, videoId: input.videoId },
        capturedAt: new Date(),
      },
    })
  } else {
    await prisma.mentionEvidence.create({
      data: {
      organizationId: input.source.organizationId,
      mentionId: result.id,
      sourceId: input.source.id,
      permalink: commentUrl,
      rawSnippet: text,
      rawPayload: { comment: input.comment, videoId: input.videoId },
      confidence: 1,
      sourceTrustTier: "T1",
      },
    })
  }
  return { ignored: false, created: result.created, accepted: true }
}

async function persistDiscoveredVideo(input: {
  source: MonitoringSourceForRun
  accountId: string | null
  result: YouTubeSearchResult
  keywords: string[]
  decision: YouTubePublicationDecision
}) {
  const videoId = input.result.id?.videoId?.trim()
  if (!videoId) return { ignored: true, created: false, accepted: false }
  const snippet = input.result.snippet
  const text = [snippet?.title, snippet?.description].filter(Boolean).join("\n").trim()
  if (!text) return { ignored: true, created: false, accepted: false }
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  const matchedTerm = findMatchedKeyword(text, input.keywords)
  const result = await ingestMentionWithResult({
    organizationId: input.source.organizationId,
    accountId: input.source.ownership === "owned" ? input.accountId : null,
    platform: "youtube",
    externalId: videoId,
    sourceType: "post",
    contentKind: "VIDEO",
    postExternalId: videoId,
    canonicalUrl: watchUrl,
    parentPostUrl: watchUrl,
    sourceProvider: "native",
    sourceMetadata: {
      videoId,
      channelId: snippet?.channelId ?? null,
      channelTitle: snippet?.channelTitle ?? null,
      thumbnailUrl: thumbnailUrl(input.result),
      ownership: input.source.ownership ?? "unknown",
      officialDiscovery: true,
      ...routeExecutionMetadata(input.source),
    },
    text,
    sentiment: null,
    matchedTerm,
    engagement: 0,
    url: watchUrl,
    authorName: snippet?.channelTitle ?? null,
    authorHandle: snippet?.channelId ?? null,
    authorAvatar: null,
    publishedAt: snippet?.publishedAt ? new Date(snippet.publishedAt) : null,
    observation: observationContextForCollector(input.source, {
      providerItemId: videoId,
      rawPayload: { searchResult: input.result },
      requireMatchedTerm: input.decision.status === "MATCHED",
      relevanceStatus: input.decision.status === "MATCHED" ? "ACCEPTED" : input.decision.status,
      relevanceReason: input.decision.reasonCode,
      relevanceConfidence: input.decision.status === "MATCHED" ? 1 : 0,
      policySnapshot: input.decision.policySnapshot,
    }),
  })
  return { ignored: false, created: result.created, accepted: result.accepted !== false }
}

export async function runYouTubeCommentsCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const account = await youtubeAccount(source)
  const apiKey = process.env.YOUTUBE_API_KEY?.trim() || null
  const token = account?.accessToken ? await refreshYouTubeToken(account, source.providerRequestSignal) : null
  if (!token && !apiKey) {
    return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "youtube_credentials_missing" }
  }
  // Which credential actually authenticates the run decides whose limits
  // apply (OAuth client's project vs API key's project) — record it so a 429
  // in production is attributable without guessing.
  const fetchCtx: YouTubeFetchContext = { token, apiKey, parentSignal: source.providerRequestSignal, retriesLeft: 1 }
  const credential = token ? "oauth_account" : "api_key"

  const maxItems = Math.max(1, Math.min(source.routeExecution?.maxItems ?? 1000, 5000))
  const negativeThreadItemCap = Math.min(5000, Math.max(maxItems, NEGATIVE_THREAD_MIN_ITEMS))
  const keywords = Array.from(new Set([...(source.keywords ?? []), ...(account?.keywords ?? [])].map(value => value.trim()).filter(Boolean)))
  const settings = record(source.settings)
  const configuredMaxCommentRequests = typeof settings.maxCommentRequests === "number" && Number.isFinite(settings.maxCommentRequests)
    ? Math.trunc(settings.maxCommentRequests)
    : DEFAULT_MAX_COMMENT_REQUESTS
  const baseMaxCommentRequests = Math.max(1, Math.min(configuredMaxCommentRequests, MAX_COMMENT_REQUESTS))
  const explicitVideoId = configuredVideoId(source)
  let channelId = configuredChannelId(source, account?.handle?.trim() || null)
  const query = explicitVideoId ? null : searchQuery(source, keywords)
  const publicationMatchTerms = Array.from(new Set([
    ...keywords,
    ...(source.query?.split("|") ?? []),
  ].map(value => value.trim()).filter(Boolean)))
  const keywordCommentSearchTerms = commentSearchTerms(source.query?.trim() || query, keywords)
  const filterVideoCommentsByKeyword = source.routeExecution?.capability === "READ_EXTERNAL_COMMENTS"
    && keywordCommentSearchTerms.length > 0
  const channelHandle = !explicitVideoId && !query && !channelId ? configuredChannelHandle(source) : null
  let foundCount = 0
  // Keyword comment collection is a two-stage route. Discovery candidates are
  // bounded separately below; maxItems here must remain available to bound the
  // requested comment/reply payload. Otherwise a full search page (for example
  // 10 videos with maxItems=10) prevents every commentThreads request.
  let commentFoundCount = 0
  let negativeThreadCommentCount = 0
  let normalThreadCommentCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  let searchPages = 0
  let maxSearchPages = 0
  let searchPageTokenRepeated = false
  let searchPageCapped = false
  let discoveredVideos = 0
  let approvedVideos = 0
  let reviewVideos = 0
  let rejectedVideos = 0
  let pages = 0
  let replyPages = 0
  let commentRequests = 0
  let commentRequestCapped = false
  let threadPageTokenRepeated = false
  let replyPageTokenRepeated = false
  let partialError: string | null = null
  let beforeWindowCommentCount = 0
  let afterWindowCommentCount = 0
  let missingCommentTimestampCount = 0
  let negativeParentFullThreadTargets = 0
  let explicitVideoHydrationStatus = explicitVideoId ? "not_needed" : null
  let explicitVideoHydrationError: string | null = null
  let durableNegativeRescanTargets = 0
  let durableNegativeRescanTargetsAdded = 0
  let durableNegativeRescanSubjectCount = 0
  let durableNegativeRescanTotalCount = 0
  let durableNegativeRescanRotationOffset = 0
  let maxCommentRequests = baseMaxCommentRequests
  let negativeThreadPageRequestBudget = 0
  let negativeTopLevelRequestBudget = 0
  let negativeReplyRequestReserve = 0
  let negativeReplyCandidateRotationOffset = 0
  let topLevelCommentRequestLimit = baseMaxCommentRequests
  let topLevelRequestCapped = false
  const usedCommentSearchTerms = new Set<string>()
  const videoIds: string[] = explicitVideoId ? [explicitVideoId] : []
  const seenCandidateVideoIds = new Set(videoIds)
  const observedAt = new Date()
  const selectiveDiscovery = record(settings.selectiveDiscovery)
  const weeklySelectiveDiscovery = selectiveDiscovery.contractVersion === "youtube-selective-query-pack-v1"
  const configuredLookbackHours = typeof settings.discoveryLookbackHours === "number" && Number.isFinite(settings.discoveryLookbackHours)
    ? settings.discoveryLookbackHours
    : weeklySelectiveDiscovery ? YOUTUBE_SELECTIVE_LOOKBACK_HOURS : 48
  const discoveryLookbackHours = Math.max(
    weeklySelectiveDiscovery ? YOUTUBE_SELECTIVE_LOOKBACK_HOURS : 24,
    Math.min(Math.trunc(configuredLookbackHours), 24 * 30),
  )
  const defaultFreshnessSince = new Date(observedAt.getTime() - discoveryLookbackHours * 60 * 60_000)
  const route = source.routeExecution
  const archiveStartAt = route?.fullArchiveRun === true
    ? scenarioArchiveStartAtForSource(
        source.settings,
        route.targetScenarioId,
        route.archiveStartAt,
      )
    : null
  const targetedWindowSettings = {
    ...settings,
    // A scenario resume must use its route/provider cursor. The legacy shared
    // cursor may belong to another adapter or scenario and cannot authorize a
    // later lower bound for this targeted YouTube run.
    searchIndex: {
      ...record(settings.searchIndex),
      fetchAfter: null,
    },
  }
  const targetedCursorWindow = archiveStartAt && route
    ? resolveArchiveProviderWindow(targetedWindowSettings, observedAt, discoveryLookbackHours, 24 * 30, {
        scope: {
          routePlanId: route.routePlanId,
          adapterKey: route.adapterKey,
          fullArchiveRun: true,
          targetScenarioId: route.targetScenarioId,
          archiveStartAt,
        },
        archiveStartAt,
      })
    : null
  const discoveryWindow = targetedCursorWindow
    ? withArchiveProviderCursorOverlap(
        targetedCursorWindow,
        ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES,
        archiveStartAt,
      )
    : null
  const freshnessSince = discoveryWindow?.since ?? defaultFreshnessSince
  // Only an explicitly targeted archive run publishes an `until` boundary.
  // The generic route core persists that boundary only for a successful,
  // complete package, so stopped/partial/sampled runs repeat the same window.
  // Scheduled/default YouTube discovery keeps its existing rolling lookback.
  const discoveryWindowRawStats = discoveryWindow && archiveStartAt
    ? {
        archiveStartAt: archiveStartAt.toISOString(),
        since: discoveryWindow.since.toISOString(),
        until: discoveryWindow.until.toISOString(),
        resumed: discoveryWindow.resumedFromWatermark,
        resumedFromWatermark: discoveryWindow.resumedFromWatermark,
        providerWindowOverlapMinutes: discoveryWindow.resumedFromWatermark
          ? ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES
          : 0,
      }
    : {}
  const negativeTerms = Array.isArray(settings.negativeTerms)
    ? settings.negativeTerms.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : []
  const parentContextCache = new Map<string, ParentMatchContext | null>()
  const cacheParentContextsForVideoIds = async (candidateVideoIds: string[]): Promise<void> => {
    const missingVideoIds = Array.from(new Set(candidateVideoIds
      .map(videoId => videoId.trim())
      .filter(videoId => videoId && !parentContextCache.has(videoId))))
    if (missingVideoIds.length === 0) return
    const watchUrls = missingVideoIds.map(videoId => (
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    ))
    const resolved = await parentMatchContextsForComments(
      source.organizationId,
      "youtube",
      watchUrls,
      missingVideoIds,
    )
    for (const videoId of missingVideoIds) {
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
      parentContextCache.set(
        videoId,
        resolved.get(videoId) ?? resolved.get(watchUrl) ?? null,
      )
    }
  }
  const parentContextForVideo = (videoId: string): ParentMatchContext | null => (
    parentContextCache.get(videoId) ?? null
  )

  if (channelHandle) {
    const channelsUrl = new URL("https://www.googleapis.com/youtube/v3/channels")
    channelsUrl.searchParams.set("part", "id")
    channelsUrl.searchParams.set("forHandle", channelHandle)
    channelsUrl.searchParams.set("maxResults", "1")
    const resolved = await fetchYouTube<{ items?: Array<{ id?: string }> }>(channelsUrl, fetchCtx)
    if (!resolved.ok) return {
      status: "failed", foundCount, newCount, duplicateCount, ignoredCount,
      error: resolved.reason ? `youtube_channel_resolution_failed:${resolved.reason}` : "youtube_channel_resolution_failed",
      rawStats: { status: resolved.status, reason: resolved.reason, credential, body: resolved.body.slice(0, 500), coverageClass: "BLOCKED" },
    }
    channelId = resolved.data.items?.[0]?.id?.trim() || null
  }

  // A direct external URL can reach the comments route before discovery has
  // ever stored its parent video. Hydrate that single explicit video with the
  // cheap videos.list endpoint, ingest/classify it, then reload the durable
  // parent context before deciding whether the thread may bypass searchTerms.
  // Existing parents and channel/query discovery do not incur this request.
  if (explicitVideoId && source.ownership === "external") {
    await cacheParentContextsForVideoIds([explicitVideoId])
    if (parentContextForVideo(explicitVideoId)) {
      explicitVideoHydrationStatus = "already_stored"
    } else {
      const videoUrl = new URL("https://www.googleapis.com/youtube/v3/videos")
      videoUrl.searchParams.set("part", "snippet")
      videoUrl.searchParams.set("id", explicitVideoId)
      videoUrl.searchParams.set("maxResults", "1")
      const hydrated = await fetchYouTube<{ items?: YouTubeVideoResult[] }>(videoUrl, fetchCtx)
      if (!hydrated.ok) {
        explicitVideoHydrationStatus = "failed"
        explicitVideoHydrationError = hydrated.error
        partialError = partialError ?? hydrated.error
      } else {
        const item = hydrated.data.items?.find(candidate => candidate.id?.trim() === explicitVideoId)
        if (!item?.snippet) {
          explicitVideoHydrationStatus = "not_found"
        } else {
          const publishedAt = item.snippet.publishedAt ? new Date(item.snippet.publishedAt) : null
          const validPublishedAt = publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : null
          const decision = decideYouTubePublication({
            observedAt,
            // Freshness is a discovery constraint, not a reason to discard an
            // explicitly targeted historical video. Future timestamps remain
            // protected by the gate's observedAt upper bound.
            freshnessSince: validPublishedAt ?? freshnessSince,
            publishedAt: validPublishedAt,
            title: item.snippet.title,
            description: item.snippet.description,
            channelTitle: item.snippet.channelTitle,
            positiveTerms: publicationMatchTerms,
            negativeTerms,
          })
          explicitVideoHydrationStatus = decision.status.toLowerCase()
          discoveredVideos += 1
          foundCount += 1
          if (isYouTubePublicationEligibleForComments(decision)) approvedVideos += 1
          else if (decision.status === "REVIEW") reviewVideos += 1
          else rejectedVideos += 1
          const stored = await persistDiscoveredVideo({
            source,
            accountId: account?.id ?? null,
            result: { id: { videoId: explicitVideoId }, snippet: item.snippet },
            keywords: publicationMatchTerms,
            decision,
          })
          if (stored.ignored || !stored.accepted) ignoredCount += 1
          else if (stored.created) newCount += 1
          else duplicateCount += 1
          if (stored.accepted) {
            parentContextCache.delete(explicitVideoId)
            await cacheParentContextsForVideoIds([explicitVideoId])
          }
        }
      }
    }
  }

  if (query) {
    const configuredMaxVideos = typeof settings.maxVideos === "number" ? settings.maxVideos : 25
    const maxVideos = Math.max(1, Math.min(Math.trunc(configuredMaxVideos), 100, maxItems))
    const configuredMaxSearchPages = typeof settings.maxSearchPages === "number" && Number.isFinite(settings.maxSearchPages)
      ? settings.maxSearchPages
      : 1
    // search.list has its own scarce daily call bucket. A relevance-poor
    // result set previously let a deep manual run page up to forty times because
    // maxItems (the comment cap) also bounded discovery. Keep discovery
    // independently and explicitly bounded.
    maxSearchPages = Math.max(1, Math.min(Math.trunc(configuredMaxSearchPages), 2))
    let searchPageToken: string | undefined
    // Only eligible videos advance videoIds. Guard against a provider that
    // repeats a pageToken (would spin and burn scarce daily search calls) the
    // same way the legacy poller does with `seenPageTokens`.
    const seenSearchPages = new Set<string>()
    do {
      const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search")
      searchUrl.searchParams.set("part", "snippet")
      searchUrl.searchParams.set("type", "video")
      searchUrl.searchParams.set("order", "date")
      searchUrl.searchParams.set("maxResults", String(Math.min(50, maxVideos - videoIds.length)))
      searchUrl.searchParams.set("q", query)
      searchUrl.searchParams.set("publishedAfter", freshnessSince.toISOString())
      if (searchPageToken) searchUrl.searchParams.set("pageToken", searchPageToken)
      const search = await fetchYouTube<{ items?: YouTubeSearchResult[]; nextPageToken?: string }>(searchUrl, fetchCtx)
      if (!search.ok) return {
        status: "failed", foundCount, newCount, duplicateCount, ignoredCount,
        error: search.error,
        rawStats: {
          status: search.status,
          reason: search.reason,
          credential,
          body: search.body.slice(0, 500),
          searchQuery: query,
          coverageClass: "BLOCKED",
          ...discoveryWindowRawStats,
        },
      }
      searchPages += 1
      for (const result of search.data.items ?? []) {
        const videoId = result.id?.videoId?.trim()
        if (!videoId || seenCandidateVideoIds.has(videoId)) continue
        seenCandidateVideoIds.add(videoId)
        discoveredVideos += 1
        foundCount += 1
        const publishedAt = result.snippet?.publishedAt ? new Date(result.snippet.publishedAt) : null
        const decision = decideYouTubePublication({
          observedAt,
          freshnessSince,
          publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
          title: result.snippet?.title,
          description: result.snippet?.description,
          channelTitle: result.snippet?.channelTitle,
          positiveTerms: Array.from(new Set([
            ...publicationMatchTerms,
            ...(query ? query.split("|") : []),
          ])),
          negativeTerms,
        })
        if (isYouTubePublicationEligibleForComments(decision)) {
          videoIds.push(videoId)
          approvedVideos += 1
        } else if (decision.status === "REVIEW") {
          reviewVideos += 1
        } else {
          rejectedVideos += 1
        }
        const stored = await persistDiscoveredVideo({
          source,
          accountId: account?.id ?? null,
          result,
          keywords: publicationMatchTerms,
          decision,
        })
        if (stored.ignored || !stored.accepted) ignoredCount += 1
        else if (stored.created) newCount += 1
        else duplicateCount += 1
        if (videoIds.length >= maxVideos || discoveredVideos >= maxItems) break
      }
      searchPageToken = search.data.nextPageToken
      if (searchPageToken) {
        if (seenSearchPages.has(searchPageToken)) { searchPageTokenRepeated = true; searchPageToken = undefined }
        else seenSearchPages.add(searchPageToken)
      }
    } while (
      searchPageToken
      && searchPages < maxSearchPages
      && videoIds.length < maxVideos
      && discoveredVideos < maxItems
    )
    // A remaining cursor means local bounds, rather than provider exhaustion,
    // ended discovery. Keep that visible as sampled coverage.
    searchPageCapped = Boolean(searchPageToken)
  }

  // Search discovery is intentionally fresh and bounded, but a negative video
  // can receive new comments long after it leaves that rolling window. Keep a
  // bounded, tenant + active-subject scoped rescan set from durable accepted
  // parents. A direct video URL already has stable target semantics and must
  // remain unchanged.
  if (query && !explicitVideoId) {
    const configuredNegativeRescanTargets = typeof settings.negativeRescanMaxVideos === "number"
      && Number.isFinite(settings.negativeRescanMaxVideos)
      ? Math.trunc(settings.negativeRescanMaxVideos)
      : DEFAULT_NEGATIVE_RESCAN_TARGETS
    const negativeRescanTargetLimit = Math.min(
      Math.max(configuredNegativeRescanTargets, 1),
      MAX_NEGATIVE_RESCAN_TARGETS,
      maxItems,
    )
    const durableTargets = await durableNegativeYoutubeVideoIds({
      source,
      settings,
      limit: negativeRescanTargetLimit,
      now: observedAt,
    })
    durableNegativeRescanTargets = durableTargets.videoIds.length
    durableNegativeRescanSubjectCount = durableTargets.subjectCount
    durableNegativeRescanTotalCount = durableTargets.totalCount
    durableNegativeRescanRotationOffset = durableTargets.rotationOffset
    const freshlySelectedVideoIds = new Set(videoIds)
    durableNegativeRescanTargetsAdded = durableTargets.videoIds
      .filter(videoId => !freshlySelectedVideoIds.has(videoId)).length
    // Put the cadence-rotated durable set first. Search results recur inside
    // the rolling discovery window, while these older negative publications
    // have no other route back into comment collection.
    const selectedVideoIds = Array.from(new Set([
      ...durableTargets.videoIds,
      ...videoIds,
    ]))
    videoIds.splice(0, videoIds.length, ...selectedVideoIds)
  }

  if (videoIds.length === 0 && !channelId) {
    // A source with no query/keywords/channel is a configuration problem —
    // keep it a skip with an explicit error. A query that ran but yielded no
    // eligible videos inside the freshness window is a NORMAL empty result:
    // returning an error here poisoned the route circuit breaker (repeated
    // "failures" opened the circuit and dropped routes to MANUAL_TASK), which
    // is how YouTube collection silently died in production.
    if (!query) {
      return { status: "skipped", foundCount, newCount, duplicateCount, ignoredCount, error: "youtube_query_or_channel_not_configured" }
    }
    return {
      status: "success",
      foundCount,
      newCount,
      duplicateCount,
      ignoredCount,
      rawStats: {
        credential,
        searchQuery: query,
        searchPages,
        maxSearchPages,
        searchPageCapped,
        searchPageTokenRepeated,
        discoveryLookbackHours,
        discoveredVideos,
        approvedVideos,
        reviewVideos,
        rejectedVideos,
        durableNegativeRescanTargets,
        durableNegativeRescanTargetsAdded,
        durableNegativeRescanSubjectCount,
        durableNegativeRescanTotalCount,
        durableNegativeRescanRotationOffset,
        emptyEligibleResult: true,
        coverageClass: searchPageTokenRepeated ? "PARTIAL" : searchPageCapped ? "SAMPLED" : "COMPLETE_FOR_INPUT",
        ...discoveryWindowRawStats,
      },
    }
  }

  const targets: Array<{ videoId: string | null; channelId: string | null }> = videoIds.length > 0
    ? videoIds.map(videoId => ({ videoId, channelId: null }))
    : [{ videoId: null, channelId }]

  await cacheParentContextsForVideoIds(videoIds)
  const isNegativeParentContext = (context: ParentMatchContext | null | undefined) => Boolean(
    context?.inheritAllCommentSubjectIds?.length
    && context.parentSentiment?.trim().toLowerCase() === "negative",
  )
  // When discovery returns a mixed set, verified negative publications get
  // the completeness floor before ordinary threads spend their own unchanged
  // item budget.
  targets.sort((left, right) => Number(isNegativeParentContext(
    right.videoId ? parentContextForVideo(right.videoId) : null,
  )) - Number(isNegativeParentContext(
    left.videoId ? parentContextForVideo(left.videoId) : null,
  )))

  const verifiedNegativeTargetCount = targets.filter(target => (
    target.videoId && isNegativeParentContext(parentContextForVideo(target.videoId))
  )).length
  if (verifiedNegativeTargetCount > 0) {
    // A verified negative thread gets a 100-item provider page budget for both
    // top-level comments and replies, up to the existing item floor/cap. The
    // top-level side also needs at least one first page per selected target.
    // This raises only negative runs, remains under the hard request ceiling,
    // and prevents top-level pagination from consuming every reply request.
    negativeThreadPageRequestBudget = Math.min(
      50,
      Math.ceil(negativeThreadItemCap / 100),
    )
    negativeTopLevelRequestBudget = Math.max(
      verifiedNegativeTargetCount,
      negativeThreadPageRequestBudget,
    )
    negativeReplyRequestReserve = negativeThreadPageRequestBudget
    maxCommentRequests = Math.min(
      MAX_COMMENT_REQUESTS,
      Math.max(
        baseMaxCommentRequests,
        negativeTopLevelRequestBudget + negativeReplyRequestReserve,
      ),
    )
    topLevelCommentRequestLimit = Math.max(
      1,
      maxCommentRequests - negativeReplyRequestReserve,
    )
  }

  const seenReplyIds = new Set<string>()
  const replyCandidates: Array<{
    topId: string
    currentVideoId: string
    canReply: boolean
    parentMatchContext: ParentMatchContext | null
    negativeParent: boolean
  }> = []
  targetLoop: for (const target of targets) {
    const targetParentContext = target.videoId ? parentContextForVideo(target.videoId) : null
    const captureFullNegativeThread = isNegativeParentContext(targetParentContext)
    const targetItemCap = captureFullNegativeThread ? negativeThreadItemCap : maxItems
    const targetItemCount = () => captureFullNegativeThread
      ? negativeThreadCommentCount
      : normalThreadCommentCount
    const targetHasCapacity = () => target.videoId
      ? targetItemCount() < targetItemCap
      : negativeThreadCommentCount < negativeThreadItemCap || normalThreadCommentCount < maxItems
    if (!targetHasCapacity() || topLevelRequestCapped) continue
    if (captureFullNegativeThread) negativeParentFullThreadTargets += 1
    const terms = target.videoId && filterVideoCommentsByKeyword && !captureFullNegativeThread
      ? keywordCommentSearchTerms
      : [null]
    const seenTopLevelIds = new Set<string>()
    commentTermLoop: for (const term of terms) {
      if (!targetHasCapacity() || topLevelRequestCapped) break
      if (term) usedCommentSearchTerms.add(term)
      let pageToken: string | undefined
      const seenThreadPageTokens = new Set<string>()
      let threadTraversalFailed = false
      do {
        if (commentRequests >= topLevelCommentRequestLimit) {
          topLevelRequestCapped = true
          break
        }
        commentRequests += 1
        const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads")
        url.searchParams.set("part", "snippet")
        url.searchParams.set("maxResults", "100")
        url.searchParams.set("order", "time")
        if (target.videoId) url.searchParams.set("videoId", target.videoId)
        else url.searchParams.set("allThreadsRelatedToChannelId", target.channelId as string)
        if (term) url.searchParams.set("searchTerms", term)
        if (pageToken) url.searchParams.set("pageToken", pageToken)
        const response = await fetchYouTube<{ items?: CommentThread[]; nextPageToken?: string }>(url, fetchCtx)
        if (!response.ok) {
          partialError = response.error
          if (pages === 0 && searchPages === 0) return {
            status: response.error === "youtube_comments_disabled" ? "skipped" : "failed",
            foundCount, newCount, duplicateCount, ignoredCount,
            error: response.error,
            rawStats: {
              status: response.status,
              reason: response.reason,
              credential,
              body: response.body.slice(0, 500),
              commentRequests,
              maxCommentRequests,
              coverageClass: "BLOCKED",
            },
          }
          threadTraversalFailed = true
          break
        }
        pages += 1
        // Channel-wide responses can contain many different video ids. Resolve
        // their stored parents once per provider page instead of issuing one or
        // two sequential Prisma queries for every individual thread.
        await cacheParentContextsForVideoIds((response.data.items ?? []).flatMap(thread => {
          const videoId = thread.snippet?.videoId?.trim()
          return videoId ? [videoId] : []
        }))
        // Drain top-level comments across every page for this target/search
        // term before spending either the request or item budget on replies.
        // YouTube returns newest-first pages on later runs, so even a per-page
        // reply phase can permanently starve top-level comments on page two.
        const orderedThreads = [...(response.data.items ?? [])].sort((left, right) => {
          const leftVideoId = left.snippet?.videoId || target.videoId
          const rightVideoId = right.snippet?.videoId || target.videoId
          const leftContext = targetParentContext ?? (leftVideoId ? parentContextForVideo(leftVideoId) : null)
          const rightContext = targetParentContext ?? (rightVideoId ? parentContextForVideo(rightVideoId) : null)
          return Number(isNegativeParentContext(rightContext)) - Number(isNegativeParentContext(leftContext))
        })
        for (const thread of orderedThreads) {
          const top = thread.snippet?.topLevelComment
          const topId = top?.id || thread.id
          const currentVideoId = thread.snippet?.videoId || target.videoId
          if (!top || !topId || !currentVideoId) { ignoredCount += 1; continue }
          if (seenTopLevelIds.has(topId)) continue
          seenTopLevelIds.add(topId)
          const canReply = thread.snippet?.canReply === true
          const parentMatchContext = targetParentContext ?? parentContextForVideo(currentVideoId)
          const negativeParent = isNegativeParentContext(parentMatchContext)
          if (negativeParent
            ? negativeThreadCommentCount >= negativeThreadItemCap
            : normalThreadCommentCount >= maxItems) continue
          foundCount += 1
          commentFoundCount += 1
          if (negativeParent) negativeThreadCommentCount += 1
          else normalThreadCommentCount += 1
          const topWindowPosition = commentWindowPosition(top, discoveryWindow)
          if (topWindowPosition === "before") {
            beforeWindowCommentCount += 1
            ignoredCount += 1
          } else if (topWindowPosition === "after") {
            afterWindowCommentCount += 1
            ignoredCount += 1
          } else if (topWindowPosition === "unknown") {
            missingCommentTimestampCount += 1
            ignoredCount += 1
          } else {
            const stored = await persistComment({
              source,
              accountId: source.ownership === "owned" ? account?.id ?? null : null,
              comment: top,
              videoId: currentVideoId,
              topLevelId: topId,
              reply: false,
              canReply,
              keywords,
              parentMatchContext,
            })
            if (stored.ignored || !stored.accepted) ignoredCount += 1
            else if (stored.created) newCount += 1
            else duplicateCount += 1
          }
          if ((thread.snippet?.totalReplyCount ?? 0) > 0) {
            replyCandidates.push({ topId, currentVideoId, canReply, parentMatchContext, negativeParent })
          }
        }

        pageToken = response.data.nextPageToken
        if (pageToken) {
          if (seenThreadPageTokens.has(pageToken)) {
            threadPageTokenRepeated = true
            pageToken = undefined
          } else {
            seenThreadPageTokens.add(pageToken)
          }
        }
      } while (pageToken && targetHasCapacity())

      if (topLevelRequestCapped || threadTraversalFailed) break commentTermLoop
    }
    if (topLevelRequestCapped) break targetLoop
  }

  // Replies are a global second phase across all selected videos/terms. A
  // popular first video therefore cannot consume the shared caps before later
  // negative videos have had their top-level pages traversed.
  const negativeReplyCandidates = replyCandidates
    .filter(candidate => candidate.negativeParent)
    .sort((left, right) => (
      `${left.currentVideoId}\u0000${left.topId}`.localeCompare(`${right.currentVideoId}\u0000${right.topId}`)
    ))
  const ordinaryReplyCandidates = replyCandidates.filter(candidate => !candidate.negativeParent)
  if (negativeReplyCandidates.length > 1) {
    const cadenceMs = Math.max(15, Math.trunc(source.cadenceMinutes || 60)) * 60_000
    const rotationBucket = Math.floor(observedAt.getTime() / cadenceMs)
    negativeReplyCandidateRotationOffset = rotationBucket % negativeReplyCandidates.length
  }
  const orderedReplyCandidates = [
    ...negativeReplyCandidates.slice(negativeReplyCandidateRotationOffset),
    ...negativeReplyCandidates.slice(0, negativeReplyCandidateRotationOffset),
    ...ordinaryReplyCandidates,
  ]
  for (const candidate of orderedReplyCandidates) {
    if (commentRequestCapped) break
    const { topId, currentVideoId, canReply, parentMatchContext, negativeParent } = candidate
    const candidateItemCap = negativeParent ? negativeThreadItemCap : maxItems
    const candidateItemCount = () => negativeParent
      ? negativeThreadCommentCount
      : normalThreadCommentCount
    if (candidateItemCount() >= candidateItemCap) continue
    let replyToken: string | undefined
    const seenReplyPageTokens = new Set<string>()
    do {
      if (commentRequests >= maxCommentRequests) {
        commentRequestCapped = true
        break
      }
      commentRequests += 1
      const repliesUrl = new URL("https://www.googleapis.com/youtube/v3/comments")
      repliesUrl.searchParams.set("part", "snippet")
      repliesUrl.searchParams.set("parentId", topId)
      repliesUrl.searchParams.set("maxResults", "100")
      if (replyToken) repliesUrl.searchParams.set("pageToken", replyToken)
      const replies = await fetchYouTube<{ items?: YouTubeComment[]; nextPageToken?: string }>(repliesUrl, fetchCtx)
      if (!replies.ok) { partialError = replies.error; break }
      replyPages += 1
      for (const reply of replies.data.items ?? []) {
        if (candidateItemCount() >= candidateItemCap) break
        const replyId = reply.id?.trim()
        if (replyId && seenReplyIds.has(replyId)) continue
        if (replyId) seenReplyIds.add(replyId)
        foundCount += 1
        commentFoundCount += 1
        if (negativeParent) negativeThreadCommentCount += 1
        else normalThreadCommentCount += 1
        const replyWindowPosition = commentWindowPosition(reply, discoveryWindow)
        if (replyWindowPosition === "before") {
          beforeWindowCommentCount += 1
          ignoredCount += 1
        } else if (replyWindowPosition === "after") {
          afterWindowCommentCount += 1
          ignoredCount += 1
        } else if (replyWindowPosition === "unknown") {
          missingCommentTimestampCount += 1
          ignoredCount += 1
        } else {
          const replyStored = await persistComment({
            source,
            accountId: source.ownership === "owned" ? account?.id ?? null : null,
            comment: reply,
            videoId: currentVideoId,
            topLevelId: topId,
            reply: true,
            canReply,
            keywords,
            parentMatchContext,
          })
          if (replyStored.ignored || !replyStored.accepted) ignoredCount += 1
          else if (replyStored.created) newCount += 1
          else duplicateCount += 1
        }
      }
      replyToken = replies.data.nextPageToken
      if (replyToken) {
        if (seenReplyPageTokens.has(replyToken)) {
          replyPageTokenRepeated = true
          replyToken = undefined
        } else {
          seenReplyPageTokens.add(replyToken)
        }
      }
    } while (replyToken && candidateItemCount() < candidateItemCap && !commentRequestCapped)
  }

  const collectionError = partialError ?? explicitVideoHydrationError
  const commentItemCapReached = normalThreadCommentCount >= maxItems
    || negativeThreadCommentCount >= negativeThreadItemCap
  return {
    status: collectionError ? "partial" : "success",
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: collectionError,
    rawStats: {
      platform: "youtube",
      credential,
      searchQuery: query,
      commentSearchTerms: Array.from(usedCommentSearchTerms),
      negativeParentFullThreadTargets,
      durableNegativeRescanTargets,
      durableNegativeRescanTargetsAdded,
      durableNegativeRescanSubjectCount,
      durableNegativeRescanTotalCount,
      durableNegativeRescanRotationOffset,
      explicitVideoHydrationStatus,
      explicitVideoHydrationError,
      searchPages,
      maxSearchPages,
      discoveryLookbackHours,
      searchPageCapped,
      searchPageTokenRepeated,
      discoveredVideos,
      approvedVideos,
      reviewVideos,
      rejectedVideos,
      targetVideos: videoIds.length,
      channelId,
      threadPages: pages,
      replyPages,
      threadPageTokenRepeated,
      replyPageTokenRepeated,
      commentRequests,
      baseMaxCommentRequests,
      maxCommentRequests,
      negativeThreadPageRequestBudget,
      negativeTopLevelRequestBudget,
      negativeReplyRequestReserve,
      negativeReplyCandidateRotationOffset,
      topLevelCommentRequestLimit,
      topLevelRequestCapped,
      commentRequestCapped: commentRequestCapped || topLevelRequestCapped,
      commentItems: commentFoundCount,
      normalThreadCommentItems: normalThreadCommentCount,
      negativeThreadCommentItems: negativeThreadCommentCount,
      negativeThreadItemCap,
      negativeThreadItemFloorApplied: negativeParentFullThreadTargets > 0
        && negativeThreadItemCap > maxItems,
      beforeWindowCommentCount,
      afterWindowCommentCount,
      missingCommentTimestampCount,
      discoveryCandidateCap: maxItems,
      commentItemCap: maxItems,
      maxItems,
      capped: commentItemCapReached || searchPageCapped || commentRequestCapped || topLevelRequestCapped,
      coverageClass: partialError
        || explicitVideoHydrationError
        || searchPageTokenRepeated
        || threadPageTokenRepeated
        || replyPageTokenRepeated
        || (discoveryWindow !== null && missingCommentTimestampCount > 0)
        ? "PARTIAL"
        : commentItemCapReached || searchPageCapped || commentRequestCapped || topLevelRequestCapped
          ? "SAMPLED"
          : "COMPLETE_FOR_INPUT",
      ...discoveryWindowRawStats,
    },
  }
}
