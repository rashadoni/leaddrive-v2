import { prisma } from "@/lib/prisma"
import { decryptToken } from "@/lib/secure-token"
import { findMatchedKeyword, ingestMentionWithResult, type IngestInput, type ParentMatchContext } from "@/lib/social/ingest-mention"
import { observationContextForCollector, routeExecutionMetadata } from "@/lib/social/collector-observation-context"
import { parentMatchContextsForComments } from "@/lib/social/parent-match-context"
import { withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"
import type { CollectorEvidenceDraft, MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import {
  isSocialOutboundSecurityError,
  requestSocialOutboundJson,
} from "@/lib/social/social-outbound-http"

type ProviderItem = Record<string, unknown>

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringListFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean)))
}

function sourceKeywords(source: MonitoringSourceForRun): string[] {
  return source.keywords ?? []
}

function allowedProviderHosts(): Set<string> {
  return new Set((process.env.SOCIAL_PROVIDER_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean))
}

function allowedProviderHostsForSource(source: MonitoringSourceForRun): Set<string> {
  return new Set([...allowedProviderHosts(), ...stringListFromUnknown(providerSettings(source).allowedHosts)])
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
  return false
}

function providerSettings(source: MonitoringSourceForRun): Record<string, unknown> {
  const settings = recordFromUnknown(source.settings)
  return recordFromUnknown(settings.provider)
}

function providerReplySettings(source: MonitoringSourceForRun): Record<string, unknown> {
  return recordFromUnknown(providerSettings(source).reply)
}

function providerReplyCapability(source: MonitoringSourceForRun, item: ProviderItem, sourceType: string): Record<string, unknown> | null {
  const reply = providerReplySettings(source)
  if (reply.approved !== true) return null
  const endpoint = stringValue(reply.endpoint)
  if (!endpoint) return null
  const targetId =
    stringValue(item.replyTargetId) ||
    stringValue(item.commentId) ||
    stringValue(item.externalCommentId) ||
    stringValue(item.threadId) ||
    stringValue(item.id)
  if (!targetId) return null

  const encryptedToken = stringValue(reply.encryptedToken)
  const allowedHosts = stringListFromUnknown(reply.allowedHosts)
  return {
    approved: true,
    provider: stringValue(reply.name) || stringValue(providerSettings(source).name) || "generic",
    endpoint,
    targetId,
    targetType: stringValue(item.replyTargetType) || sourceType,
    ...(encryptedToken ? { encryptedToken } : {}),
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
  }
}

function resolveProviderEndpoint(source: MonitoringSourceForRun): { endpoint?: URL; error?: string } {
  const provider = providerSettings(source)
  if (provider.approved !== true) return { error: "provider_not_approved" }
  const endpointValue = stringValue(provider.endpoint)
  if (!endpointValue) return { error: "provider_endpoint_missing" }

  let endpoint: URL
  try {
    endpoint = new URL(endpointValue)
  } catch {
    return { error: "provider_endpoint_invalid" }
  }
  if (endpoint.protocol !== "https:") return { error: "provider_https_required" }
  if (isPrivateOrLocalHost(endpoint.hostname)) return { error: "provider_host_not_allowed" }
  const allowedHosts = allowedProviderHostsForSource(source)
  if (allowedHosts.size === 0 || !allowedHosts.has(endpoint.hostname.toLowerCase())) {
    return { error: "provider_host_not_allowed" }
  }
  return { endpoint }
}

function resolveProviderToken(source: MonitoringSourceForRun): string | null {
  const provider = providerSettings(source)
  const encrypted = stringValue(provider.encryptedToken)
  if (!encrypted) return null
  try {
    return decryptToken(encrypted, `social-provider:${source.id}`)
  } catch {
    try {
      return decryptToken(encrypted, "social-provider")
    } catch {
      return null
    }
  }
}

function providerItems(payload: unknown): ProviderItem[] | null {
  const body = recordFromUnknown(payload)
  const directItems = Array.isArray(body.items) ? body.items : Array.isArray(body.data) ? body.data : null
  if (!directItems) return null
  return directItems.filter((item): item is ProviderItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
}

function normalizeProviderItem(source: MonitoringSourceForRun, item: ProviderItem): IngestInput | null {
  const text = stringValue(item.text) || stringValue(item.message) || stringValue(item.caption) || stringValue(item.snippet)
  if (!text) return null
  const externalId = stringValue(item.externalId) || stringValue(item.id) || stringValue(item.url) || stringValue(item.permalink)
  if (!externalId) return null
  const platform = stringValue(item.platform) || source.platform
  const url = stringValue(item.url) || stringValue(item.permalink)
  const explicitContentKind = (stringValue(item.contentKind) || stringValue(item.recordType))?.toUpperCase()
  const sourceType = stringValue(item.sourceType)
    || (explicitContentKind === "COMMENT" ? "comment" : explicitContentKind === "REPLY" ? "reply" : "mention")
  const contentKind = ["POST", "MENTION", "COMMENT", "REPLY", "REVIEW", "DM", "UNKNOWN"].includes(explicitContentKind ?? "")
    ? explicitContentKind
    : sourceType.toLowerCase() === "reply"
      ? "REPLY"
      : sourceType.toLowerCase() === "comment"
        ? "COMMENT"
        : undefined
  const commentLike = contentKind === "COMMENT" || contentKind === "REPLY"
  const parentPostUrl = commentLike
    ? stringValue(item.parentPostUrl) || stringValue(item.sourcePostUrl) || stringValue(item.postUrl)
    : null
  const canonicalUrl = stringValue(item.canonicalUrl)
    || (commentLike ? stringValue(item.commentUrl) || stringValue(item.commentPermalink) || url : url)
  const published = stringValue(item.publishedAt) || stringValue(item.createdAt) || stringValue(item.timestamp)
  const publishedAt = published ? new Date(published) : null
  const replyCapability = providerReplyCapability(source, item, sourceType)

  return {
    organizationId: source.organizationId,
    accountId: null,
    platform,
    externalId: `provider:${externalId}`,
    sourceType,
    ...(contentKind ? { contentKind } : {}),
    // Mentions are namespaced for deduplication, but comment providers refer
    // back to the publication's raw id when resolving parent context.
    postExternalId: stringValue(item.postExternalId)
      || stringValue(item.postId)
      || (!commentLike ? externalId : null),
    parentExternalId: stringValue(item.parentExternalId) || stringValue(item.parentCommentId),
    threadExternalId: stringValue(item.threadExternalId) || stringValue(item.threadId),
    replyToExternalId: stringValue(item.replyToExternalId) || stringValue(item.replyToCommentId),
    depth: numberValue(item.depth),
    canonicalUrl,
    parentPostUrl,
    sourceProvider: "provider_api",
    sourceMetadata: {
      monitoringSourceId: source.id,
      collector: "provider_api",
      provider: stringValue(providerSettings(source).name) || "generic",
      ...routeExecutionMetadata(source),
      ...(replyCapability ? { replyCapability } : {}),
    },
    text,
    sentiment: null,
    matchedTerm: findMatchedKeyword(text, sourceKeywords(source)),
    engagement: numberValue(item.engagement),
    reach: numberValue(item.reach),
    url,
    authorName: stringValue(item.authorName) || stringValue(item.author),
    authorHandle: stringValue(item.authorHandle) || stringValue(item.username),
    authorAvatar: stringValue(item.authorAvatar),
    publishedAt: publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : null,
  }
}

async function ingestProviderMention(
  source: MonitoringSourceForRun,
  input: IngestInput,
  item: ProviderItem,
  evidence: CollectorEvidenceDraft,
  parentMatchContext: ParentMatchContext | null,
) {
  const result = await ingestMentionWithResult({
    ...input,
    sentiment: input.sentiment ?? null,
    ...(parentMatchContext ? { parentMatchContext } : {}),
    observation: observationContextForCollector(source, {
      providerItemId: stringValue(item.id) || stringValue(item.externalId) || input.externalId,
      rawPayload: evidence.rawPayload ?? item,
      requireMatchedTerm: source.routeExecution?.capability === "READ_EXTERNAL_COMMENTS",
    }),
  })

  if (result.accepted === false) return result

  const existingEvidence = await prisma.mentionEvidence.findFirst({
    where: {
      organizationId: source.organizationId,
      mentionId: result.id,
      sourceId: source.id,
      ...(evidence.permalink ? { permalink: evidence.permalink } : {}),
    },
    select: { id: true },
  })
  if (!existingEvidence) {
    await prisma.mentionEvidence.create({
      data: {
        organizationId: source.organizationId,
        mentionId: result.id,
        sourceId: source.id,
        permalink: evidence.permalink ?? null,
        screenshotUrl: evidence.screenshotUrl ?? null,
        rawSnippet: evidence.rawSnippet ?? input.text,
        rawPayload: evidence.rawPayload ?? item,
        confidence: evidence.confidence,
        sourceTrustTier: evidence.sourceTrustTier,
      },
    })
  }

  return result
}

export async function runProviderApiCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const resolved = resolveProviderEndpoint(source)
  if (!resolved.endpoint) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: resolved.error ?? "provider_not_configured",
      rawStats: { providerSafeGate: true, collectionMode: source.collectionMode },
    }
  }
  const endpoint = resolved.endpoint

  const headers: Record<string, string> = { accept: "application/json" }
  const token = resolveProviderToken(source)
  if (token) headers.authorization = `Bearer ${token}`

  let providerResponse: Awaited<ReturnType<typeof requestSocialOutboundJson>>
  try {
    providerResponse = await withSocialProviderTimeout("provider", async () => requestSocialOutboundJson(
      endpoint.toString(),
      {
        method: "GET",
        headers,
        allowedHosts: Array.from(allowedProviderHostsForSource(source)),
      },
    ), { signal: source.providerRequestSignal })
  } catch (error) {
    const outboundBlocked = isSocialOutboundSecurityError(error)
    return {
      status: outboundBlocked ? "skipped" : "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: outboundBlocked ? "provider_outbound_blocked" : "provider_fetch_failed",
      rawStats: { providerSafeGate: true, outboundSafeTransport: true },
    }
  }
  if (!providerResponse.ok) {
    return {
      status: providerResponse.status === 429 ? "partial" : "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: providerResponse.status === 429 ? "provider_rate_limited" : "provider_fetch_failed",
      rawStats: { status: providerResponse.status, host: endpoint.hostname, outboundSafeTransport: true },
    }
  }

  const items = providerItems(providerResponse.payload)
  if (!items) {
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "provider_payload_invalid",
      rawStats: { host: endpoint.hostname },
    }
  }

  const normalizedItems: Array<{ item: ProviderItem; input: IngestInput }> = []
  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  for (const item of items) {
    const normalized = normalizeProviderItem(source, item)
    if (!normalized) {
      ignoredCount++
      continue
    }
    foundCount++
    normalizedItems.push({ item, input: normalized })
  }

  const parentContextsByPlatform = new Map<string, Map<string, ParentMatchContext>>()
  const parentKeysByPlatform = new Map<string, { urls: Set<string>; externalIds: Set<string> }>()
  for (const { input } of normalizedItems) {
    if (!["COMMENT", "REPLY"].includes(input.contentKind ?? "")) continue
    if (!input.parentPostUrl && !input.postExternalId) continue
    const keys = parentKeysByPlatform.get(input.platform) ?? { urls: new Set<string>(), externalIds: new Set<string>() }
    if (input.parentPostUrl) keys.urls.add(input.parentPostUrl)
    if (input.postExternalId) keys.externalIds.add(input.postExternalId)
    parentKeysByPlatform.set(input.platform, keys)
  }
  for (const [platform, keys] of parentKeysByPlatform) {
    parentContextsByPlatform.set(platform, await parentMatchContextsForComments(
      source.organizationId,
      platform,
      Array.from(keys.urls),
      Array.from(keys.externalIds),
    ))
  }

  for (const { item, input: normalized } of normalizedItems) {
    const platformContexts = parentContextsByPlatform.get(normalized.platform)
    const parentMatchContext = (normalized.postExternalId
      ? platformContexts?.get(normalized.postExternalId)
      : null)
      ?? (normalized.parentPostUrl ? platformContexts?.get(normalized.parentPostUrl) : null)
      ?? null
    const result = await ingestProviderMention(source, normalized, item, {
      permalink: normalized.url ?? null,
      rawSnippet: normalized.text,
      rawPayload: item,
      confidence: numberValue(item.confidence) ?? 0.75,
      sourceTrustTier: "T2",
    }, parentMatchContext)
    if (result.accepted === false) ignoredCount++
    else if (result.created) newCount++
    else duplicateCount++
  }

  return {
    status: "success",
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: null,
    rawStats: { host: endpoint.hostname, providerSafeGate: true, externalReadOnly: true },
  }
}
