import { prisma } from "@/lib/prisma"
import { decryptToken } from "@/lib/secure-token"
import { findMatchedKeyword, ingestMentionWithResult, type IngestInput } from "@/lib/social/ingest-mention"
import { observationContextForCollector, routeExecutionMetadata } from "@/lib/social/collector-observation-context"
import { withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"
import type { CollectorEvidenceDraft, MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import { getMonitoringScenarios, type MonitoringScenario } from "@/lib/social/monitoring-scenarios"
import { resolveArchiveProviderWindow } from "@/lib/social/archive-provider-window"
import {
  isSocialOutboundSecurityError,
  requestSocialOutboundJson,
} from "@/lib/social/social-outbound-http"

export const SEARCH_INDEX_MIN_CADENCE_MINUTES = 360
export const DEFAULT_SEARCH_LOOKBACK_HOURS = 24
export const DEFAULT_SEARCH_LIMIT = 50
export const MAX_SEARCH_LIMIT = 100

type SearchIndexItem = Record<string, unknown>
type SearchLookbackWindow = {
  hours: number
  since: Date
  until: Date
  resumedFromWatermark: boolean
  clamped: boolean
}
type SearchMatchTerms = {
  terms: string[]
  source: "scenario" | "source" | "none"
  scenarioIds: string[]
  scenarioNames: string[]
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function stringAt(value: unknown, path: string[]): string | null {
  let current: unknown = value
  for (const key of path) current = recordFromUnknown(current)[key]
  return stringValue(current)
}

function stringListFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean)))
}

function allowedSearchHosts(): Set<string> {
  return new Set((process.env.SOCIAL_SEARCH_INDEX_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean))
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
  return false
}

function searchSettings(source: MonitoringSourceForRun): Record<string, unknown> {
  const settings = recordFromUnknown(source.settings)
  const sourceSearch = recordFromUnknown(settings.searchIndex)
  const envLimit = Number(process.env.SOCIAL_SEARCH_INDEX_LIMIT || "")
  const envLookbackHours = Number(process.env.SOCIAL_SEARCH_INDEX_LOOKBACK_HOURS || "")
  return {
    ...sourceSearch,
    approved: sourceSearch.approved === true || process.env.SOCIAL_SEARCH_INDEX_ENABLED === "1",
    provider: stringValue(sourceSearch.provider) || "generic",
    endpoint: stringValue(sourceSearch.endpoint) || process.env.SOCIAL_SEARCH_INDEX_ENDPOINT,
    limit: numberValue(sourceSearch.limit) ?? (Number.isFinite(envLimit) && envLimit > 0 ? envLimit : undefined),
    lookbackHours: numberValue(sourceSearch.lookbackHours) ?? (Number.isFinite(envLookbackHours) && envLookbackHours > 0 ? envLookbackHours : undefined),
  }
}

function allowedSearchHostsForSource(source: MonitoringSourceForRun): Set<string> {
  const settings = recordFromUnknown(source.settings)
  const sourceSearch = recordFromUnknown(settings.searchIndex)
  return new Set([...allowedSearchHosts(), ...stringListFromUnknown(sourceSearch.allowedHosts)])
}

function resolveSearchToken(source: MonitoringSourceForRun): string | null {
  const settings = searchSettings(source)
  const encrypted = stringValue(settings.encryptedToken)
  if (!encrypted) return null
  const purpose = stringValue(settings.tokenPurpose) || `social-search-index:${source.organizationId}`
  try {
    return decryptToken(encrypted, purpose)
  } catch {
    try {
      return decryptToken(encrypted, `social-search-index:${source.id}`)
    } catch {
      return null
    }
  }
}

function urlSearchTerm(source: MonitoringSourceForRun): string | null {
  if (!source.url) return null
  try {
    const parsed = new URL(source.url)
    const parts = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean)
    const firstPath = parts[0]?.replace(/^@+/, "")
    if (firstPath && ["profile", "page", "competitor", "influencer", "campaign"].includes(source.sourceType)) return `@${firstPath}`
    return source.url
  } catch {
    return null
  }
}

function searchQuery(source: MonitoringSourceForRun): string | null {
  if (source.query) return source.sourceType === "hashtag" ? `#${source.query.replace(/^#+/, "")}` : source.query
  if (source.handle) return source.handle
  const fromUrl = urlSearchTerm(source)
  if (fromUrl) return fromUrl
  if (source.keywords?.[0]) return source.keywords[0]
  return null
}

function normalizeMatchTerm(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.replace(/^#+/, "")
}

function requiredSourceMatchTerms(source: MonitoringSourceForRun): string[] {
  const terms = new Set<string>()
  if (source.sourceType === "keyword" || source.sourceType === "hashtag") {
    const queryTerm = normalizeMatchTerm(source.query)
    if (queryTerm) terms.add(queryTerm)
  }
  for (const keyword of source.keywords ?? []) {
    const term = normalizeMatchTerm(keyword)
    if (term) terms.add(term)
  }
  return Array.from(terms)
}

function normalizedScenarioTerm(value: string | null | undefined): string | null {
  const trimmed = normalizeMatchTerm(value)
  if (!trimmed) return null
  return trimmed.replace(/^@+/, "").trim()
}

function scenarioMatchTerms(scenario: MonitoringScenario): string[] {
  const terms = [
    ...scenario.search.topics,
    ...scenario.search.keywords,
    ...scenario.search.hashtags,
    ...scenario.search.handles,
  ]
  return Array.from(new Set(
    terms
      .map(normalizedScenarioTerm)
      .filter((term): term is string => Boolean(term)),
  ))
}

function sourceScenarioIds(source: MonitoringSourceForRun): Set<string> {
  const settings = recordFromUnknown(source.settings)
  const ids = new Set<string>()
  const directId = stringValue(settings.scenarioId)
  if (directId) ids.add(directId)
  const links = Array.isArray(settings.scenarioLinks) ? settings.scenarioLinks : []
  for (const item of links) {
    const id = stringValue(recordFromUnknown(item).scenarioId)
    if (id) ids.add(id)
  }
  return ids
}

function scenarioPlatformMatchesSource(scenario: MonitoringScenario, source: MonitoringSourceForRun): boolean {
  const platform = source.platform.toLowerCase()
  const platforms = scenario.platforms as string[]
  if (platforms.includes(platform)) return true
  return platforms.includes("web") && (platform === "web" || source.collectionMode === "search_index")
}

export async function requiredMatchTermsForSource(source: MonitoringSourceForRun): Promise<SearchMatchTerms> {
  const scenarios = await getMonitoringScenarios(source.organizationId).catch(() => [])
  const linkedScenarioIds = sourceScenarioIds(source)
  const activeScenarios = scenarios.filter((scenario) => scenario.status === "active" && scenarioPlatformMatchesSource(scenario, source))
  const targetScenarioId = source.routeExecution?.targetScenarioId
  const relevantScenarios = targetScenarioId
    ? activeScenarios.filter((scenario) => scenario.id === targetScenarioId)
    : linkedScenarioIds.size > 0
      ? activeScenarios.filter((scenario) => linkedScenarioIds.has(scenario.id))
      : activeScenarios
  const scenarioTerms = Array.from(new Set(relevantScenarios.flatMap(scenarioMatchTerms)))

  if (scenarioTerms.length > 0) {
    return {
      terms: scenarioTerms,
      source: "scenario",
      scenarioIds: relevantScenarios.map((scenario) => scenario.id),
      scenarioNames: relevantScenarios.map((scenario) => scenario.name),
    }
  }

  if (targetScenarioId) {
    return {
      terms: [],
      source: "none",
      scenarioIds: [],
      scenarioNames: [],
    }
  }

  const sourceTerms = requiredSourceMatchTerms(source)
  return {
    terms: sourceTerms,
    source: sourceTerms.length > 0 ? "source" : "none",
    scenarioIds: [],
    scenarioNames: [],
  }
}

function searchLimit(source: MonitoringSourceForRun): number {
  const settings = searchSettings(source)
  return Math.min(Math.max(numberValue(settings.limit) ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT)
}

function searchLookbackWindow(source: MonitoringSourceForRun, now = new Date()): SearchLookbackWindow {
  const settings = searchSettings(source)
  const hours = Math.min(Math.max(numberValue(settings.lookbackHours) ?? DEFAULT_SEARCH_LOOKBACK_HOURS, 1), 24 * 30)
  return resolveArchiveProviderWindow(source.settings, now, hours, 24 * 30)
}

function parseDateValue(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const asMillis = value > 10_000_000_000 ? value : value * 1000
    const date = new Date(asMillis)
    return Number.isFinite(date.getTime()) ? date : null
  }
  const raw = stringValue(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? date : null
}

function searchItemPublishedAt(item: SearchIndexItem): Date | null {
  return parseDateValue(item.publishedAt)
    ?? parseDateValue(item.date)
    ?? parseDateValue(item.timestamp)
    ?? parseDateValue(item.createdAt)
    ?? parseDateValue(item.created_time)
    ?? parseDateValue(item.createdTime)
    ?? parseDateValue(item.createTimeISO)
    ?? parseDateValue(item.createTime)
    ?? parseDateValue(item.takenAt)
    ?? parseDateValue(item.taken_at)
}

function isWithinLookbackWindow(publishedAt: Date | null | undefined, window: SearchLookbackWindow): boolean {
  if (!publishedAt) return false
  const ts = publishedAt.getTime()
  const clockSkewMs = 5 * 60_000
  return ts >= window.since.getTime() && ts <= window.until.getTime() + clockSkewMs
}

function lookbackRawStats(
  window: SearchLookbackWindow,
  limit: number,
  receivedCount: number,
  ignoredMissingPublishedAtCount: number,
  ignoredOutOfWindowCount: number,
) {
  return {
    lookbackHours: window.hours,
    since: window.since.toISOString(),
    until: window.until.toISOString(),
    resumedFromWatermark: window.resumedFromWatermark,
    providerWindowClamped: window.clamped,
    limit,
    receivedCount,
    ignoredMissingPublishedAtCount,
    ignoredOutOfWindowCount,
  }
}

function resolveSearchEndpoint(source: MonitoringSourceForRun, window: SearchLookbackWindow): { endpoint?: URL; query?: string; error?: string } {
  if (source.cadenceMinutes < SEARCH_INDEX_MIN_CADENCE_MINUTES) return { error: "search_index_cadence_too_fast" }
  const settings = searchSettings(source)
  if (settings.approved !== true) return { error: "search_index_not_approved" }
  const endpointValue = stringValue(settings.endpoint)
  if (!endpointValue) return { error: "search_index_endpoint_missing" }
  const query = searchQuery(source)
  if (!query) return { error: "search_index_query_missing" }

  let endpoint: URL
  try {
    endpoint = new URL(endpointValue)
  } catch {
    return { error: "search_index_endpoint_invalid" }
  }
  if (endpoint.protocol !== "https:") return { error: "search_index_https_required" }
  if (isPrivateOrLocalHost(endpoint.hostname)) return { error: "search_index_host_not_allowed" }
  const allowedHosts = allowedSearchHostsForSource(source)
  if (allowedHosts.size === 0 || !allowedHosts.has(endpoint.hostname.toLowerCase())) return { error: "search_index_host_not_allowed" }

  endpoint.searchParams.set("q", query)
  const domain = stringValue(settings.domain)
  if (domain) endpoint.searchParams.set("site", domain)
  endpoint.searchParams.set("limit", String(searchLimit(source)))
  endpoint.searchParams.set("since", window.since.toISOString())
  endpoint.searchParams.set("until", window.until.toISOString())
  return { endpoint, query }
}

function searchItems(payload: unknown): SearchIndexItem[] | null {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is SearchIndexItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  }
  const body = recordFromUnknown(payload)
  const items = Array.isArray(body.items) ? body.items : Array.isArray(body.results) ? body.results : Array.isArray(body.data) ? body.data : null
  if (!items) return null
  return items.filter((item): item is SearchIndexItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
}

function normalizeSearchItem(source: MonitoringSourceForRun, item: SearchIndexItem): IngestInput | null {
  const url =
    stringValue(item.url) ||
    stringValue(item.link) ||
    stringValue(item.permalink) ||
    stringValue(item.postUrl) ||
    stringValue(item.webVideoUrl) ||
    stringValue(item.videoUrl)
  const snippet =
    stringValue(item.snippet) ||
    stringValue(item.description) ||
    stringValue(item.caption) ||
    stringValue(item.text) ||
    stringValue(item.desc)
  const title = stringValue(item.title) || stringValue(item.shortCode) || stringValue(item.id)
  const text = [title, snippet].filter(Boolean).join("\n").trim()
  if (!url || !text) return null
  const publishedAt = searchItemPublishedAt(item)
  const platform = stringValue(item.platform) || source.platform || "web"

  return {
    organizationId: source.organizationId,
    accountId: null,
    platform,
    externalId: `search:${url}`,
    sourceType: "mention",
    sourceProvider: "search_index",
    sourceMetadata: {
      monitoringSourceId: source.id,
      collector: "search_index",
      partialCoverage: true,
      ...routeExecutionMetadata(source),
    },
    text,
    sentiment: null,
    matchedTerm: null,
    engagement: 0,
    reach: 0,
    url,
    authorName: stringValue(item.authorName) || stringValue(item.sourceName) || stringValue(item.ownerFullName) || stringAt(item, ["authorMeta", "name"]) || stringAt(item, ["author", "name"]),
    authorHandle: stringValue(item.authorHandle) || stringValue(item.ownerUsername) || stringAt(item, ["authorMeta", "name"]) || stringAt(item, ["author", "uniqueId"]),
    publishedAt: publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : null,
  }
}

async function ingestSearchMention(source: MonitoringSourceForRun, input: IngestInput, item: SearchIndexItem, evidence: CollectorEvidenceDraft) {
  const result = await ingestMentionWithResult({
    ...input,
    sentiment: input.sentiment ?? null,
    observation: observationContextForCollector(source, {
      providerItemId: stringValue(item.id) || input.externalId,
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
      permalink: evidence.permalink ?? undefined,
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
        screenshotUrl: null,
        rawSnippet: evidence.rawSnippet ?? input.text,
        rawPayload: evidence.rawPayload ?? item,
        confidence: evidence.confidence,
        sourceTrustTier: "T3",
      },
    })
  }
  return result
}

export async function runSearchIndexCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const settings = searchSettings(source)
  if (settings.provider === "apify") return {
    status: "skipped",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: "apify_async_route_required",
    rawStats: { provider: "apify", synchronousExecutionDisabled: true },
  }

  const window = searchLookbackWindow(source)
  const limit = searchLimit(source)
  const matchTerms = await requiredMatchTermsForSource(source)
  if (matchTerms.terms.length === 0) {
    return {
      status: "success",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: null,
      rawStats: { partialCoverage: true, externalReadOnly: true, requiredMatchTerms: [], matchTermSource: matchTerms.source, skippedReason: "search_index_terms_missing" },
    }
  }

  const resolved = resolveSearchEndpoint(source, window)
  if (!resolved.endpoint) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: resolved.error ?? "search_index_not_configured",
      rawStats: { partialCoverage: true, collectionMode: source.collectionMode, ...lookbackRawStats(window, limit, 0, 0, 0) },
    }
  }
  const endpoint = resolved.endpoint

  const headers: Record<string, string> = { accept: "application/json" }
  const token = resolveSearchToken(source)
  if (token) headers.authorization = `Bearer ${token}`
  let searchResponse: Awaited<ReturnType<typeof requestSocialOutboundJson>>
  try {
    searchResponse = await withSocialProviderTimeout("search_index", async () => requestSocialOutboundJson(
      endpoint.toString(),
      {
        method: "GET",
        headers,
        allowedHosts: Array.from(allowedSearchHostsForSource(source)),
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
      error: outboundBlocked ? "search_index_outbound_blocked" : "search_index_fetch_failed",
      rawStats: { partialCoverage: true, outboundSafeTransport: true },
    }
  }
  if (!searchResponse.ok) {
    return {
      status: searchResponse.status === 429 ? "partial" : "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: searchResponse.status === 429 ? "search_index_rate_limited" : "search_index_fetch_failed",
      rawStats: { status: searchResponse.status, partialCoverage: true, outboundSafeTransport: true },
    }
  }

  const items = searchItems(searchResponse.payload)
  if (!items) {
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "search_index_payload_invalid",
      rawStats: { partialCoverage: true },
    }
  }

  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  let ignoredMissingPublishedAtCount = 0
  let ignoredOutOfWindowCount = 0
  for (const item of items) {
    const normalized = normalizeSearchItem(source, item)
    if (!normalized) {
      ignoredCount++
      continue
    }
    if (!normalized.publishedAt) {
      ignoredMissingPublishedAtCount++
      ignoredCount++
      continue
    }
    if (!isWithinLookbackWindow(normalized.publishedAt, window)) {
      ignoredOutOfWindowCount++
      ignoredCount++
      continue
    }
    const matchedTerm = findMatchedKeyword(normalized.text, matchTerms.terms)
    if (!matchedTerm) {
      ignoredCount++
      continue
    }
    foundCount++
    const result = await ingestSearchMention(source, { ...normalized, matchedTerm }, item, {
      permalink: normalized.url ?? null,
      rawSnippet: normalized.text,
      rawPayload: item,
      confidence: numberValue(item.confidence) ?? 0.65,
      sourceTrustTier: "T3",
    })
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
    rawStats: {
      query: resolved.query,
      partialCoverage: true,
      externalReadOnly: true,
      requiredMatchTerms: matchTerms.terms,
      matchTermSource: matchTerms.source,
      scenarioIds: matchTerms.scenarioIds,
      scenarioNames: matchTerms.scenarioNames,
      ...lookbackRawStats(window, limit, items.length, ignoredMissingPublishedAtCount, ignoredOutOfWindowCount),
    },
  }
}
