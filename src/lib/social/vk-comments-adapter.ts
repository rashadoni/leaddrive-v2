import { prisma } from "@/lib/prisma"
import { findMatchedKeyword, ingestMentionWithResult } from "@/lib/social/ingest-mention"
import { observationContextForCollector, routeExecutionMetadata } from "@/lib/social/collector-observation-context"
import { withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"
import type { MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

type VkComment = {
  id: number
  from_id?: number
  date?: number
  text?: string
  parents_stack?: number[]
  likes?: { count?: number }
  thread?: { count?: number; items?: VkComment[] }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isInteger(parsed) ? parsed : null
}

export function vkWallTarget(source: MonitoringSourceForRun): { ownerId: number; postId: number } | null {
  const settings = record(source.settings)
  const ownerId = numberValue(settings.ownerId ?? settings.owner_id)
  const postId = numberValue(settings.postId ?? settings.post_id)
  if (ownerId !== null && postId !== null) return { ownerId, postId }
  const candidates = [source.url, typeof settings.postUrl === "string" ? settings.postUrl : null].filter(Boolean) as string[]
  for (const candidate of candidates) {
    const match = candidate.match(/wall(-?\d+)_(\d+)/)
    if (match) return { ownerId: Number(match[1]), postId: Number(match[2]) }
  }
  return null
}

async function fetchVkCommentsPage(input: {
  target: { ownerId: number; postId: number }
  token: string
  offset: number
  parentCommentId?: number
  parentSignal?: AbortSignal
}) {
  const url = new URL("https://api.vk.com/method/wall.getComments")
  url.searchParams.set("owner_id", String(input.target.ownerId))
  url.searchParams.set("post_id", String(input.target.postId))
  url.searchParams.set("count", "100")
  url.searchParams.set("offset", String(input.offset))
  url.searchParams.set("sort", "asc")
  url.searchParams.set("need_likes", "1")
  url.searchParams.set("thread_items_count", "10")
  if (input.parentCommentId) url.searchParams.set("comment_id", String(input.parentCommentId))
  url.searchParams.set("access_token", input.token)
  url.searchParams.set("v", "5.199")
  return withSocialProviderTimeout("vk", async signal => {
    const response = await fetch(url, { signal })
    if (!response.ok) return { ok: false as const, error: `vk_comments_http_${response.status}` }
    const body = await response.json() as { response?: { count?: number; items?: VkComment[] }; error?: { error_code?: number; error_msg?: string } }
    if (body.error) return { ok: false as const, error: `vk_api_${body.error.error_code ?? "error"}:${body.error.error_msg ?? "unknown"}` }
    return { ok: true as const, items: body.response?.items ?? [], count: body.response?.count ?? 0 }
  }, { signal: input.parentSignal })
}

async function storeVkComment(input: {
  source: MonitoringSourceForRun
  target: { ownerId: number; postId: number }
  comment: VkComment
  parentId?: number | null
  keywords: string[]
}) {
  const text = (input.comment.text ?? "").trim()
  if (!text) return { ignored: true, accepted: false, created: false }
  const id = `${input.target.ownerId}_${input.target.postId}_${input.comment.id}`
  const postUrl = `https://vk.com/wall${input.target.ownerId}_${input.target.postId}`
  const permalink = `${postUrl}?reply=${input.comment.id}`
  const parentId = input.parentId ?? input.comment.parents_stack?.at(-1) ?? null
  const matchedTerm = findMatchedKeyword(text, input.keywords)
  const result = await ingestMentionWithResult({
    organizationId: input.source.organizationId,
    platform: "vkontakte",
    externalId: id,
    sourceType: parentId ? "reply" : "comment",
    contentKind: parentId ? "REPLY" : "COMMENT",
    postExternalId: `${input.target.ownerId}_${input.target.postId}`,
    parentExternalId: parentId ? `${input.target.ownerId}_${input.target.postId}_${parentId}` : `${input.target.ownerId}_${input.target.postId}`,
    threadExternalId: `${input.target.ownerId}_${input.target.postId}`,
    replyToExternalId: parentId ? `${input.target.ownerId}_${input.target.postId}_${parentId}` : null,
    depth: parentId ? 1 : 0,
    canonicalUrl: permalink,
    parentPostUrl: postUrl,
    sourceProvider: "native",
    sourceMetadata: {
      ownerId: input.target.ownerId,
      postId: input.target.postId,
      commentId: input.comment.id,
      officialCollector: true,
      ...routeExecutionMetadata(input.source),
    },
    text,
    sentiment: null,
    matchedTerm,
    engagement: input.comment.likes?.count ?? 0,
    url: permalink,
    authorHandle: input.comment.from_id ? String(input.comment.from_id) : null,
    publishedAt: input.comment.date ? new Date(input.comment.date * 1000) : null,
    observation: observationContextForCollector(input.source, {
      providerItemId: id,
      rawPayload: { target: input.target, comment: input.comment },
      requireMatchedTerm: input.source.routeExecution?.capability === "READ_EXTERNAL_COMMENTS",
    }),
  })
  if (result.accepted === false) return { ignored: false, accepted: false, created: false }

  const existing = await prisma.mentionEvidence.findFirst({
    where: { organizationId: input.source.organizationId, mentionId: result.id, sourceId: input.source.id, permalink },
    select: { id: true },
  })
  if (!existing) {
    await prisma.mentionEvidence.create({
      data: {
        organizationId: input.source.organizationId,
        mentionId: result.id,
        sourceId: input.source.id,
        permalink,
        rawSnippet: text,
        rawPayload: { target: input.target, comment: input.comment },
        confidence: 1,
        sourceTrustTier: "T1",
      },
    })
  }
  return { ignored: false, accepted: true, created: result.created }
}

export async function runVkCommentsCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const token = process.env.VK_SERVICE_TOKEN?.trim()
  if (!token) return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "vk_service_token_missing" }
  const target = vkWallTarget(source)
  if (!target) return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "vk_wall_post_required" }

  const maxItems = Math.max(1, Math.min(source.routeExecution?.maxItems ?? 1000, 5000))
  const keywords = Array.from(new Set((source.keywords ?? []).map(value => value.trim()).filter(Boolean)))
  let offset = 0
  let totalAvailable = 0
  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  let pages = 0
  let replyPages = 0
  let partialError: string | null = null

  while (foundCount < maxItems) {
    const page = await fetchVkCommentsPage({ target, token, offset, parentSignal: source.providerRequestSignal })
    if (!page.ok) return { status: pages > 0 ? "partial" : "failed", foundCount, newCount, duplicateCount, ignoredCount, error: page.error, rawStats: { pages, replyPages, coverageClass: pages > 0 ? "PARTIAL" : "BLOCKED" } }
    const items = page.items
    totalAvailable = page.count || items.length
    pages += 1
    for (const comment of items) {
      if (foundCount >= maxItems) break
      foundCount += 1
      const stored = await storeVkComment({ source, target, comment, keywords })
      if (stored.ignored || !stored.accepted) ignoredCount += 1
      else if (stored.created) newCount += 1
      else duplicateCount += 1
      const seenReplies = new Set<number>()
      for (const reply of comment.thread?.items ?? []) {
        if (foundCount >= maxItems) break
        if (seenReplies.has(reply.id)) continue
        seenReplies.add(reply.id)
        foundCount += 1
        const replyStored = await storeVkComment({ source, target, comment: reply, parentId: comment.id, keywords })
        if (replyStored.ignored || !replyStored.accepted) ignoredCount += 1
        else if (replyStored.created) newCount += 1
        else duplicateCount += 1
      }
      let replyOffset = 0
      const replyTotal = comment.thread?.count ?? seenReplies.size
      while (seenReplies.size < replyTotal && foundCount < maxItems) {
        const replies = await fetchVkCommentsPage({ target, token, offset: replyOffset, parentCommentId: comment.id, parentSignal: source.providerRequestSignal })
        if (!replies.ok) { partialError = replies.error; break }
        replyPages += 1
        if (replies.items.length === 0) break
        for (const reply of replies.items) {
          if (foundCount >= maxItems) break
          if (seenReplies.has(reply.id)) continue
          seenReplies.add(reply.id)
          foundCount += 1
          const replyStored = await storeVkComment({ source, target, comment: reply, parentId: comment.id, keywords })
          if (replyStored.ignored || !replyStored.accepted) ignoredCount += 1
          else if (replyStored.created) newCount += 1
          else duplicateCount += 1
        }
        replyOffset += replies.items.length
        if (replyOffset >= replies.count) break
      }
    }
    offset += items.length
    if (items.length === 0 || offset >= totalAvailable) break
  }

  const capped = foundCount >= maxItems || offset < totalAvailable
  return {
    status: partialError ? "partial" : "success",
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: partialError,
    rawStats: { platform: "vkontakte", pages, replyPages, totalAvailable, capped, coverageClass: capped ? "SAMPLED" : partialError ? "PARTIAL" : "COMPLETE_FOR_INPUT" },
  }
}
