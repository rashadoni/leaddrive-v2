import crypto from "node:crypto"
import { prisma } from "@/lib/prisma"
import { findMatchedKeyword, ingestMentionWithResult, type IngestInput } from "@/lib/social/ingest-mention"
import {
  GOOGLE_ALERTS_RSS_ADAPTER,
  GOOGLE_ALERTS_RSS_POLICY_VERSION,
  decryptGoogleAlertsRssUrl,
  isGoogleAlertsRssSource,
} from "@/lib/social/google-alerts-rss"
import { unwrapGoogleAlertUrl } from "@/lib/social/google-alerts-email"
import { fetchVerifiedWebNewsArticle } from "@/lib/social/web-news-article"
import { requiredMatchTermsForSource } from "@/lib/social/search-index-adapter"
import {
  ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES,
  advanceMonitoringRouteProviderCursor,
  routeProviderCursorFetchAfterForSource,
  scenarioArchiveStartAtForSource,
} from "@/lib/social/archive-provider-window"
import {
  observationContextForCollector,
  routeExecutionMetadata,
  targetScopedObservationIdempotencyKey,
} from "@/lib/social/collector-observation-context"
import type {
  MonitoringCollectorResult,
  MonitoringSourceForRun,
} from "@/lib/social/monitoring-collector"

const MAX_FEED_BYTES = 1_000_000
const MAX_FEED_ENTRIES = 50
const MAX_FEED_SNIPPET_CHARS = 1_200
const DEFAULT_FETCH_TIMEOUT_MS = 10_000
const ARTICLE_FETCH_CONCURRENCY = 3
const POLICY_REJECTED_ARTICLE_ERRORS = new Set([
  "outside_azerbaijan",
  "unsafe_url",
  "private_address",
])

export type GoogleAlertsRssEntry = {
  title: string
  snippet: string | null
  url: string
  updatedAt: Date | null
}

type GoogleAlertsMatchEvidence = "article_metadata" | "google_alerts_feed_snippet"

export function googleAlertsRssEntriesAfterCheckpoint(
  entries: GoogleAlertsRssEntry[],
  checkpoint: Date | null,
  overlapMinutes = ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES,
): GoogleAlertsRssEntry[] {
  if (!checkpoint) return entries
  const lowerBound = checkpoint.getTime() - Math.max(0, overlapMinutes) * 60_000
  // Entries without an Atom timestamp remain eligible and rely on canonical
  // mention dedupe; silently dropping them would be less safe.
  return entries.filter(entry => !entry.updatedAt || entry.updatedAt.getTime() >= lowerBound)
}

function newestFeedUpdatedAt(entries: GoogleAlertsRssEntry[], upperBound: Date): Date | null {
  const newest = Math.max(...entries.map(entry => entry.updatedAt?.getTime() ?? Number.NEGATIVE_INFINITY))
  return Number.isFinite(newest) ? new Date(Math.min(newest, upperBound.getTime())) : null
}

function googleAlertsRssCoverageStats(
  archiveStartAt: Date | null,
  entries: GoogleAlertsRssEntry[],
  until: Date,
): Record<string, unknown> {
  const timestamps = entries
    .map(entry => entry.updatedAt?.getTime() ?? NaN)
    .filter(timestamp => Number.isFinite(timestamp))
    .sort((left, right) => left - right)
  return {
    // Google exposes only the entries currently retained in this Atom feed.
    // Even an empty successful response cannot prove that the full requested
    // historical window was searched.
    coverageClass: archiveStartAt ? "PARTIAL" : "COMPLETE_FOR_DELIVERED_FEED",
    coverageLimited: true,
    coverageLimit: "CURRENT_GOOGLE_ALERTS_FEED_ONLY",
    historicalBackfillGuaranteed: false,
    requestedWindow: {
      since: archiveStartAt?.toISOString() ?? null,
      until: until.toISOString(),
    },
    deliveredFeedWindow: {
      oldestEntryAt: timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null,
      newestEntryAt: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString() : null,
    },
    maxFeedEntries: MAX_FEED_ENTRIES,
    feedEntryLimitReached: entries.length >= MAX_FEED_ENTRIES,
  }
}

function decodeXmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  }
  const decodeCodePoint = (raw: string, radix: number): string => {
    const codePoint = Number.parseInt(raw, radix)
    const isValidXmlCodePoint = codePoint === 0x09
      || codePoint === 0x0a
      || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    return Number.isInteger(codePoint) && isValidXmlCodePoint
      ? String.fromCodePoint(codePoint)
      : "\uFFFD"
  }
  return value
    .replace(/&#(\d+);/gu, (_match, raw: string) => decodeCodePoint(raw, 10))
    .replace(/&#x([0-9a-f]+);/giu, (_match, raw: string) => decodeCodePoint(raw, 16))
    .replace(/&([a-z]+);/giu, (match, entity: string) => named[entity.toLowerCase()] ?? match)
}

function plainText(value: string): string {
  let decoded = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/giu, "$1")
  // Google encodes HTML inside Atom XML and sometimes double-encodes
  // entities in the generated snippet. Decode a bounded number of times,
  // then strip all markup before the text can become match evidence.
  decoded = decodeXmlEntities(decodeXmlEntities(decoded))
  return decoded
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function tagText(xml: string, tagName: string): string | null {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = xml.match(new RegExp(
    `<(?:[\\w.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}>`,
    "iu",
  ))
  return match?.[1] ?? null
}

function attribute(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "iu"))
  return match?.[2] ? decodeXmlEntities(match[2]).trim() : null
}

function parsedDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(plainText(value))
  return Number.isFinite(date.getTime()) ? date : null
}

/**
 * Purpose-built Atom parser for the bounded Google Alerts feed shape. Entry
 * text is never trusted as article data: every URL is unwrapped and the
 * publisher page must later pass the existing NewsArticle verifier.
 */
export function parseGoogleAlertsAtomFeed(xml: string): GoogleAlertsRssEntry[] {
  const entries: GoogleAlertsRssEntry[] = []
  const seen = new Set<string>()
  const entryPattern = /<(?:[\w.-]+:)?entry\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?entry>/giu

  for (const match of xml.matchAll(entryPattern)) {
    const entryXml = match[1]
    const linkTags = entryXml.match(/<(?:[\w.-]+:)?link\b[^>]*\/?>/giu) ?? []
    let url: string | null = null
    for (const linkTag of linkTags) {
      const rel = attribute(linkTag, "rel")?.toLowerCase() ?? "alternate"
      if (!["alternate", ""].includes(rel)) continue
      const href = attribute(linkTag, "href")
      if (!href) continue
      url = unwrapGoogleAlertUrl(href)
      if (url) break
    }
    if (!url || seen.has(url)) continue
    seen.add(url)

    const title = plainText(tagText(entryXml, "title") ?? "").slice(0, 300)
    const content = plainText(tagText(entryXml, "content") ?? "")
    const summary = content ? "" : plainText(tagText(entryXml, "summary") ?? "")
    const snippet = (content || summary).slice(0, MAX_FEED_SNIPPET_CHARS) || null
    entries.push({
      title,
      snippet,
      url,
      updatedAt: parsedDate(tagText(entryXml, "updated") ?? tagText(entryXml, "published")),
    })
    if (entries.length >= MAX_FEED_ENTRIES) break
  }
  return entries
}

async function readLimitedFeed(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
    throw new Error("google_alerts_rss_too_large")
  }
  if (!response.body) return ""

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let xml = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_FEED_BYTES) {
      await reader.cancel()
      throw new Error("google_alerts_rss_too_large")
    }
    xml += decoder.decode(value, { stream: true })
  }
  return xml + decoder.decode()
}

async function fetchGoogleAlertsFeed(
  feedUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  timeout.unref?.()
  try {
    const response = await fetchImpl(feedUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": "LeadDrive-GoogleAlertsRSS/1.0",
      },
    })
    if (!response.ok) throw new Error(`google_alerts_rss_http_${response.status}`)
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    if (!/(?:atom|xml)/u.test(contentType)) {
      throw new Error("google_alerts_rss_content_type_invalid")
    }
    const body = await readLimitedFeed(response)
    if (/<!DOCTYPE|<!ENTITY/iu.test(body)) {
      throw new Error("google_alerts_rss_xml_entities_forbidden")
    }
    if (!/<(?:[\w.-]+:)?feed\b/iu.test(body)) {
      throw new Error("google_alerts_rss_feed_invalid")
    }
    return body
  } finally {
    clearTimeout(timeout)
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index])
    }
  }))
  return results
}

async function ingestVerifiedArticle(
  source: MonitoringSourceForRun,
  entry: GoogleAlertsRssEntry,
  article: NonNullable<Awaited<ReturnType<typeof fetchVerifiedWebNewsArticle>>>,
  matchedTerm: string,
  matchedVia: GoogleAlertsMatchEvidence,
  ingest: typeof ingestMentionWithResult,
): Promise<{ created: boolean; accepted: boolean }> {
  const digest = crypto.createHash("sha256").update(article.url).digest("hex")
  const textParts = [
    article.headline,
    article.description,
    matchedVia === "google_alerts_feed_snippet" ? entry.snippet : null,
  ]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
  const input: IngestInput = {
    organizationId: source.organizationId,
    accountId: null,
    platform: "web",
    // Same identity as the authenticated email transport, so enabling both
    // delivery methods cannot duplicate one Google Alerts article.
    externalId: `google-alerts:${digest}`,
    sourceType: "mention",
    contentKind: "ARTICLE",
    sourceProvider: "notification_inbox",
    sourceMetadata: {
      monitoringSourceId: source.id,
      collector: "google_alerts_rss",
      provider: article.publisherDomain,
      publisherName: article.publisherName,
      publisherDomain: article.publisherDomain,
      publisherCountry: "AZ",
      headline: article.headline,
      description: article.description,
      imageUrl: article.imageUrl,
      newsOnly: true,
      freeRoute: true,
      policyVersion: GOOGLE_ALERTS_RSS_POLICY_VERSION,
      matchedVia,
      ...routeExecutionMetadata(source),
    },
    text: textParts.join("\n"),
    sentiment: null,
    matchedTerm,
    engagement: 0,
    reach: 0,
    url: article.url,
    canonicalUrl: article.url,
    authorName: article.publisherName,
    authorHandle: article.publisherDomain,
    publishedAt: article.publishedAt,
    observation: {
      ...observationContextForCollector(source, {
        providerItemId: digest,
        idempotencyKey: targetScopedObservationIdempotencyKey(source, article.url),
        rawPayload: {
          canonicalUrl: article.url,
          publisherDomain: article.publisherDomain,
          publishedAt: article.publishedAt.toISOString(),
          feedEntryTitle: entry.title,
          feedEntrySnippet: entry.snippet,
          feedEntryUpdatedAt: entry.updatedAt?.toISOString() ?? null,
          matchedVia,
        },
        relevanceStatus: "ACCEPTED",
        relevanceReason: "google_alerts_rss_verified_newsarticle",
        relevanceConfidence: 0.98,
        policySnapshot: {
          policyVersion: GOOGLE_ALERTS_RSS_POLICY_VERSION,
          publisherCountry: "AZ",
          requiredStructuredType: "NewsArticle",
          maxArticleAgeDays: 90,
          transport: "rss",
          matchedVia,
        },
      }),
      providerKey: "google_alerts",
    },
  }

  const result = await ingest(input, { suppressMediaScheduling: false })
  if (result.accepted === false) return { created: false, accepted: false }

  const existingEvidence = await prisma.mentionEvidence.findFirst({
    where: {
      organizationId: source.organizationId,
      mentionId: result.id,
      sourceId: source.id,
      permalink: article.url,
    },
    select: { id: true },
  })
  if (!existingEvidence) {
    await prisma.mentionEvidence.create({
      data: {
        organizationId: source.organizationId,
        mentionId: result.id,
        sourceId: source.id,
        permalink: article.url,
        screenshotUrl: null,
        rawSnippet: input.text,
        rawPayload: input.observation?.rawPayload ?? {},
        confidence: 0.98,
        sourceTrustTier: "T3",
      },
    })
  }
  return { created: result.created, accepted: true }
}

export async function runGoogleAlertsRssCollector(
  source: MonitoringSourceForRun,
  options: {
    fetchImpl?: typeof fetch
    fetchArticle?: typeof fetchVerifiedWebNewsArticle
    ingest?: typeof ingestMentionWithResult
  } = {},
): Promise<MonitoringCollectorResult> {
  if (!isGoogleAlertsRssSource(source)) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "google_alerts_rss_source_invalid",
      rawStats: { adapter: GOOGLE_ALERTS_RSS_ADAPTER, providerRequestDispatched: false },
    }
  }
  const scenarioId = typeof (source.settings as Record<string, unknown> | null)?.scenarioId === "string"
    ? (source.settings as Record<string, unknown>).scenarioId as string
    : null
  if (!scenarioId) {
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "google_alerts_rss_scenario_missing",
      rawStats: { adapter: GOOGLE_ALERTS_RSS_ADAPTER, providerRequestDispatched: false },
    }
  }
  const runStartedAt = new Date()
  const archiveStartAt = scenarioArchiveStartAtForSource(
    source.settings,
    source.routeExecution?.targetScenarioId ?? scenarioId,
    source.routeExecution?.archiveStartAt,
  )
  const checkpointScope = source.routeExecution
    ? {
      routePlanId: source.routeExecution.routePlanId,
      adapterKey: source.routeExecution.adapterKey,
      fullArchiveRun: source.routeExecution.fullArchiveRun === true,
      targetScenarioId: source.routeExecution.targetScenarioId,
      archiveStartAt,
    }
    : undefined
  const feedCheckpoint = routeProviderCursorFetchAfterForSource(source.settings, checkpointScope)
  const initialCoverageStats = googleAlertsRssCoverageStats(archiveStartAt, [], runStartedAt)

  let feedUrl: string
  try {
    feedUrl = decryptGoogleAlertsRssUrl({
      organizationId: source.organizationId,
      scenarioId,
      settings: source.settings,
    })
  } catch {
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "google_alerts_rss_decryption_failed",
      rawStats: {
        adapter: GOOGLE_ALERTS_RSS_ADAPTER,
        providerRequestDispatched: false,
        ...initialCoverageStats,
      },
    }
  }

  const timeoutMs = Math.max(
    3_000,
    Math.min((source.routeExecution?.timeoutSeconds ?? DEFAULT_FETCH_TIMEOUT_MS / 1000) * 1000, 30_000),
  )
  let entries: GoogleAlertsRssEntry[]
  let deliveredEntries: GoogleAlertsRssEntry[] = []
  let feedTruncated = false
  try {
    const xml = await fetchGoogleAlertsFeed(feedUrl, options.fetchImpl ?? fetch, timeoutMs)
    deliveredEntries = parseGoogleAlertsAtomFeed(xml)
    const maxItems = Math.max(1, Math.min(source.routeExecution?.maxItems ?? MAX_FEED_ENTRIES, MAX_FEED_ENTRIES))
    const incrementalEntries = googleAlertsRssEntriesAfterCheckpoint(deliveredEntries, feedCheckpoint)
    entries = incrementalEntries.slice(0, maxItems)
    feedTruncated = deliveredEntries.length >= MAX_FEED_ENTRIES || incrementalEntries.length > entries.length
  } catch (error) {
    const message = error instanceof Error ? error.message : "google_alerts_rss_fetch_failed"
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: message === "This operation was aborted" || message.includes("abort")
        ? "google_alerts_rss_timeout"
        : message,
      rawStats: {
        adapter: GOOGLE_ALERTS_RSS_ADAPTER,
        provider: "google_alerts",
        providerRequestDispatched: true,
        ...initialCoverageStats,
      },
    }
  }
  const coverageStats = googleAlertsRssCoverageStats(archiveStartAt, deliveredEntries, runStartedAt)
  const latestFeedUpdatedAt = newestFeedUpdatedAt(deliveredEntries, runStartedAt)

  const matchTerms = await requiredMatchTermsForSource(source)
  if (entries.length === 0 || matchTerms.terms.length === 0) {
    return {
      status: "success",
      foundCount: entries.length,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: entries.length,
      error: null,
      rawStats: {
        adapter: GOOGLE_ALERTS_RSS_ADAPTER,
        provider: "google_alerts",
        newsOnly: true,
        entryCount: entries.length,
        deliveredEntryCount: deliveredEntries.length,
        checkpointFilteredCount: deliveredEntries.length - googleAlertsRssEntriesAfterCheckpoint(deliveredEntries, feedCheckpoint).length,
        feedCheckpointAt: feedCheckpoint?.toISOString() ?? null,
        requiredMatchTerms: matchTerms.terms,
        emptyFeed: deliveredEntries.length === 0,
        noNewFeedEntries: deliveredEntries.length > 0 && entries.length === 0,
        ...coverageStats,
      },
    }
  }

  const fetchArticle = options.fetchArticle ?? fetchVerifiedWebNewsArticle
  const ingest = options.ingest ?? ingestMentionWithResult
  const verified = await mapWithConcurrency(entries, ARTICLE_FETCH_CONCURRENCY, async entry => {
    try {
      const article = await fetchArticle(entry.url)
      return { entry, article, fetchFailed: false, policyRejected: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      const policyRejected = POLICY_REJECTED_ARTICLE_ERRORS.has(message)
      return {
        entry,
        article: null,
        fetchFailed: !policyRejected,
        policyRejected,
      }
    }
  })

  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  let verifiedCount = 0
  let articleFetchFailureCount = 0
  let policyRejectedCount = 0
  let beforeArchiveStartCount = 0
  let matchedViaFeedSnippetCount = 0
  for (const item of verified) {
    if (!item.article) {
      if (item.fetchFailed) articleFetchFailureCount += 1
      if (item.policyRejected) policyRejectedCount += 1
      ignoredCount += 1
      continue
    }
    verifiedCount += 1
    if (archiveStartAt && item.article.publishedAt.getTime() < archiveStartAt.getTime()) {
      beforeArchiveStartCount += 1
      ignoredCount += 1
      continue
    }
    const articleMatchedTerm = findMatchedKeyword(item.article.matchedCorpus, matchTerms.terms)
    const snippetMatchedTerm = articleMatchedTerm
      ? null
      : findMatchedKeyword(item.entry.snippet ?? "", matchTerms.terms)
    const matchedTerm = articleMatchedTerm ?? snippetMatchedTerm
    if (!matchedTerm) {
      ignoredCount += 1
      continue
    }
    const matchedVia: GoogleAlertsMatchEvidence = articleMatchedTerm
      ? "article_metadata"
      : "google_alerts_feed_snippet"
    if (matchedVia === "google_alerts_feed_snippet") matchedViaFeedSnippetCount += 1
    const result = await ingestVerifiedArticle(
      source,
      item.entry,
      item.article,
      matchedTerm,
      matchedVia,
      ingest,
    )
    if (!result.accepted) ignoredCount += 1
    else if (result.created) newCount += 1
    else duplicateCount += 1
  }

  const checkpointEligible = articleFetchFailureCount === 0
    && !feedTruncated
    && Boolean(checkpointScope && latestFeedUpdatedAt)
  let checkpointAdvanced = false
  if (checkpointEligible && checkpointScope && latestFeedUpdatedAt) {
    checkpointAdvanced = await advanceMonitoringRouteProviderCursor({
      organizationId: source.organizationId,
      sourceId: source.id,
      routePlanId: checkpointScope.routePlanId,
      adapterKey: checkpointScope.adapterKey,
      fullArchiveRun: checkpointScope.fullArchiveRun,
      targetScenarioId: checkpointScope.targetScenarioId,
      archiveStartAt: checkpointScope.archiveStartAt,
      until: latestFeedUpdatedAt,
      reason: "google_alerts_rss_feed_complete",
    }).then(updated => updated > 0).catch(error => {
      console.error("[social-monitoring] Google Alerts RSS checkpoint update failed", error)
      return false
    })
  }

  return {
    status: articleFetchFailureCount > 0 ? "partial" : "success",
    foundCount: entries.length,
    newCount,
    duplicateCount,
    ignoredCount,
    error: articleFetchFailureCount > 0 ? "google_alerts_rss_partial_fetch" : null,
    rawStats: {
      adapter: GOOGLE_ALERTS_RSS_ADAPTER,
      provider: "google_alerts",
      newsOnly: true,
      freeRoute: true,
      entryCount: entries.length,
      verifiedCount,
      articleFetchFailureCount,
      policyRejectedCount,
      beforeArchiveStartCount,
      matchedViaFeedSnippetCount,
      deliveredEntryCount: deliveredEntries.length,
      checkpointFilteredCount: deliveredEntries.length - googleAlertsRssEntriesAfterCheckpoint(deliveredEntries, feedCheckpoint).length,
      feedCheckpointAt: feedCheckpoint?.toISOString() ?? null,
      nextFeedCheckpointAt: latestFeedUpdatedAt?.toISOString() ?? null,
      checkpointAdvanced,
      requiredMatchTerms: matchTerms.terms,
      scenarioIds: matchTerms.scenarioIds,
      ...coverageStats,
    },
  }
}
