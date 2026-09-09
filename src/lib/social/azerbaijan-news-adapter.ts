import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { findMatchedKeyword, ingestMentionWithResult, type IngestInput } from "@/lib/social/ingest-mention"
import { observationContextForCollector, routeExecutionMetadata, targetScopedObservationIdempotencyKey } from "@/lib/social/collector-observation-context"
import type { MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import {
  resolveArchiveProviderWindow,
  scenarioArchiveStartAtForSource,
  type ArchiveProviderWindow,
} from "@/lib/social/archive-provider-window"
import { requiredMatchTermsForSource } from "@/lib/social/search-index-adapter"
import {
  AZERBAIJAN_NEWS_ADAPTER,
  AZERBAIJAN_NEWS_POLICY_VERSION,
} from "@/lib/social/azerbaijan-news-contract"
import {
  AZERBAIJAN_NEWS_FEEDS,
  parseAzerbaijanNewsRss,
} from "@/lib/social/azerbaijan-news-feed"
import { fetchVerifiedWebNewsArticle } from "@/lib/social/web-news-article"

export {
  AZERBAIJAN_NEWS_ADAPTER,
  AZERBAIJAN_NEWS_POLICY_VERSION,
} from "@/lib/social/azerbaijan-news-contract"

const REPORT_AZ_ORIGIN = "https://report.az"
const REPORT_AZ_HOST = "report.az"
const BAKU_WS_ORIGIN = "https://baku.ws"
const BAKU_WS_HOST = "baku.ws"
const DEFAULT_AUTOMATIC_LOOKBACK_HOURS = 48
const DEFAULT_MANUAL_LOOKBACK_HOURS = 24 * 90
const MAX_AUTOMATIC_LOOKBACK_HOURS = 24 * 30
const MAX_MANUAL_LOOKBACK_HOURS = 24 * 90
// Scenario aliases are useful for matching an article, but firing every alias
// at the publisher's search endpoint repeats nearly identical work and can
// trigger its WAF. Keep acquisition to a small representative query pack; the
// full term set is still used below for direct article matching.
const MAX_QUERY_TERMS = 4
const DEFAULT_MAX_ITEMS = 50
const MAX_ITEMS = 100
const MAX_RESPONSE_BYTES = 3_000_000
const FETCH_TIMEOUT_MS = 15_000
const ARTICLE_CONCURRENCY = 3

type AzerbaijanNewsSearchPublisherHost = typeof REPORT_AZ_HOST | typeof BAKU_WS_HOST

export type AzerbaijanNewsSearchCandidate = {
  publisher: string
  publisherHost: string
  providerKey: string
  url: string
  title: string
  publishedAt: Date
  description?: string | null
  imageUrl?: string | null
}

export type VerifiedAzerbaijanNewsArticle = AzerbaijanNewsSearchCandidate & {
  description: string | null
  authorName: string | null
  imageUrl: string | null
  matchedCorpus: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean)
    : []
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  }
  return value
    .replace(/&#(\d+);/gu, (_match, raw: string) => String.fromCodePoint(Number(raw)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, raw: string) => String.fromCodePoint(Number.parseInt(raw, 16)))
    .replace(/&([a-z]+);/giu, (match, raw: string) => named[raw.toLowerCase()] ?? match)
}

function plainText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim()
}

function absolutePublisherUrl(raw: string, origin: string, publisherHost: string): string | null {
  try {
    const url = new URL(raw, origin)
    const host = url.hostname.toLowerCase().replace(/^www\./u, "")
    if (url.protocol !== "https:" || host !== publisherHost) return null
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function parseAzerbaijanTimestamp(raw: string): Date | null {
  const normalized = raw.trim().replace(" ", "T")
  const parsed = new Date(/[z+-]\d{2}:?\d{2}$/iu.test(normalized) ? normalized : `${normalized}+04:00`)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

export function parseReportAzSearchHtml(html: string): AzerbaijanNewsSearchCandidate[] {
  const blocks = html.split(/(?=<div class="col-md-3 index-post-block")/gu).slice(1)
  const candidates: AzerbaijanNewsSearchCandidate[] = []
  for (const block of blocks) {
    const timestamp = block.match(/data-timestamp=["']([^"']+)["']/iu)?.[1]
    const href = block.match(/<a\s+href=["']([^"']+)["'][^>]*class=["'][^"']*\bnews__item\b[^"']*["']/iu)?.[1]
    const titleHtml = block.match(/<h2[^>]*class=["'][^"']*\bnews__title\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/iu)?.[1]
    const publishedAt = timestamp ? parseAzerbaijanTimestamp(timestamp) : null
    const url = href ? absolutePublisherUrl(href, REPORT_AZ_ORIGIN, REPORT_AZ_HOST) : null
    const title = titleHtml ? plainText(titleHtml) : ""
    if (!publishedAt || !url || !title) continue
    candidates.push({
      publisher: "Report.az",
      publisherHost: REPORT_AZ_HOST,
      providerKey: "report",
      url,
      title,
      publishedAt,
    })
  }
  return candidates
}

const AZERBAIJANI_MONTHS: Record<string, number> = {
  yanvar: 0,
  fevral: 1,
  mart: 2,
  aprel: 3,
  may: 4,
  iyun: 5,
  iyul: 6,
  avqust: 7,
  sentyabr: 8,
  oktyabr: 9,
  noyabr: 10,
  dekabr: 11,
}

function parseBakuWsDate(dayText: string, timeText: string): Date | null {
  const match = plainText(dayText).toLocaleLowerCase("az").match(/^(\d{1,2})\s+([^\s]+)\s+(\d{4})$/u)
  const time = plainText(timeText).match(/^(\d{1,2}):(\d{2})$/u)
  if (!match || !time) return null
  const month = AZERBAIJANI_MONTHS[match[2]]
  if (month === undefined) return null
  const iso = `${match[3]}-${String(month + 1).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}T${String(Number(time[1])).padStart(2, "0")}:${time[2]}:00+04:00`
  const parsed = new Date(iso)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

export function parseBakuWsSearchHtml(html: string): AzerbaijanNewsSearchCandidate[] {
  const blocks = html.split(/(?=<div class="post-item">)/gu).slice(1)
  const candidates: AzerbaijanNewsSearchCandidate[] = []
  for (const block of blocks) {
    const href = block.match(/<a\s+href=["']([^"']+)["'][^>]*>/iu)?.[1]
    const titleHtml = block.match(/<h3[^>]*class=["'][^"']*\bpost-item-title\b[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/iu)?.[1]
    const timeHtml = block.match(/<span[^>]*class=["'][^"']*\bpost-item-date-time\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/iu)?.[1]
    const dayHtml = block.match(/<span[^>]*class=["'][^"']*\bpost-item-date-day\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/iu)?.[1]
    const publishedAt = dayHtml && timeHtml ? parseBakuWsDate(dayHtml, timeHtml) : null
    const url = href ? absolutePublisherUrl(href, BAKU_WS_ORIGIN, BAKU_WS_HOST) : null
    const title = titleHtml ? plainText(titleHtml) : ""
    if (!publishedAt || !url || !title) continue
    candidates.push({
      publisher: "Baku.ws",
      publisherHost: BAKU_WS_HOST,
      providerKey: "baku-ws",
      url,
      title,
      publishedAt,
    })
  }
  return candidates
}

function jsonLdNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdNodes)
  const item = record(value)
  if (Object.keys(item).length === 0) return []
  const graph = Array.isArray(item["@graph"]) ? item["@graph"].flatMap(jsonLdNodes) : []
  return [item, ...graph]
}

function jsonLdTypes(value: unknown): string[] {
  return typeof value === "string"
    ? [value]
    : stringList(value)
}

function newsImageUrl(value: unknown): string | null {
  if (typeof value === "string") return stringValue(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = newsImageUrl(item)
      if (found) return found
    }
    return null
  }
  return stringValue(record(value).url)
}

function newsAuthorName(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map(item => newsAuthorName(item)).find((item): item is string => Boolean(item)) ?? null
  }
  if (typeof value === "string") return stringValue(value)
  return stringValue(record(value).name)
}

export function parseVerifiedReportAzArticle(
  html: string,
  candidate: AzerbaijanNewsSearchCandidate,
): VerifiedAzerbaijanNewsArticle | null {
  const scripts = Array.from(html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  ))
  const nodes = scripts.flatMap(match => {
    try {
      return jsonLdNodes(JSON.parse(match[1]))
    } catch {
      return []
    }
  })
  const news = nodes.find(node => {
    const types = jsonLdTypes(node["@type"])
    return types.includes("NewsArticle") || types.includes("ReportageNewsArticle")
  })
  if (!news) return null

  const publisherOrigin = candidate.publisherHost === BAKU_WS_HOST ? BAKU_WS_ORIGIN : REPORT_AZ_ORIGIN
  const canonical = absolutePublisherUrl(
    stringValue(news.url) ?? stringValue(news.mainEntityOfPage) ?? candidate.url,
    publisherOrigin,
    candidate.publisherHost,
  )
  const publishedAt = parseAzerbaijanTimestamp(stringValue(news.datePublished) ?? "")
  const headline = stringValue(news.headline)
  if (!canonical || canonical !== candidate.url || !publishedAt || !headline) return null

  const description = stringValue(news.description)
  const articleBody = stringValue(news.articleBody)
  // Some publishers keep JSON-LD's articleBody intentionally short while the
  // visible story continues in the article container. Restrict the fallback to
  // the publisher's main article body so navigation and related-story links
  // cannot create a false brand match.
  const visibleArticleBody = candidate.publisherHost === BAKU_WS_HOST
    ? plainText(html.match(
        /<div[^>]*class=["'][^"']*\bpost-detail-content\b[^"']*["'][^>]*>([\s\S]*?)<div[^>]*class=["'][^"']*\bshare-block\b/iu,
      )?.[1] ?? "")
    : ""
  const matchedCorpus = [headline, description, articleBody, visibleArticleBody].filter(Boolean).join("\n")
  if (!matchedCorpus) return null
  return {
    ...candidate,
    title: headline,
    publishedAt,
    description,
    authorName: newsAuthorName(news.author),
    imageUrl: newsImageUrl(news.image),
    matchedCorpus,
  }
}

function withinWindow(date: Date, window: ArchiveProviderWindow): boolean {
  const timestamp = date.getTime()
  return timestamp >= window.since.getTime() && timestamp <= window.until.getTime() + 5 * 60_000
}

export function azerbaijanNewsWindow(source: MonitoringSourceForRun, now = new Date()): ArchiveProviderWindow {
  const fullArchive = source.routeExecution?.fullArchiveRun === true
  const archiveStartAt = fullArchive
    ? scenarioArchiveStartAtForSource(
        source.settings,
        source.routeExecution?.targetScenarioId,
        source.routeExecution?.archiveStartAt,
      )
    : null
  const settings = record(source.settings)
  const news = record(settings.azerbaijanNews)
  const configuredHours = numberValue(news.lookbackHours)
  const defaultHours = fullArchive ? DEFAULT_MANUAL_LOOKBACK_HOURS : DEFAULT_AUTOMATIC_LOOKBACK_HOURS
  const maxHours = fullArchive ? MAX_MANUAL_LOOKBACK_HOURS : MAX_AUTOMATIC_LOOKBACK_HOURS
  const hours = Math.max(1, Math.min(maxHours, configuredHours ?? defaultHours))
  const routePlanId = source.routeExecution?.routePlanId
  const adapterKey = source.routeExecution?.adapterKey
  return resolveArchiveProviderWindow(source.settings, now, hours, maxHours, {
    ...(routePlanId && adapterKey ? { scope: { routePlanId, adapterKey } } : {}),
    ignoreWatermark: fullArchive,
    archiveStartAt,
  })
}

function maxItems(source: MonitoringSourceForRun): number {
  const value = source.routeExecution?.maxItems ?? DEFAULT_MAX_ITEMS
  return Math.max(1, Math.min(MAX_ITEMS, Math.trunc(value)))
}

function normalizedQueryTerms(terms: string[]): string[] {
  return Array.from(new Set(terms
    .map(term => term.replace(/^[@#]+/u, "").trim())
    .filter(term => term.length >= 3 && term.length <= 160)))
    .slice(0, MAX_QUERY_TERMS)
}

async function fetchBoundedHtml(
  url: URL,
  expectedHost: string,
  options: {
    notFoundIsEmpty?: boolean
    allowedContentTypes?: string[]
  } = {},
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const acceptsXml = Boolean(options.allowedContentTypes?.some(type =>
      type.includes("xml") || type.includes("rss"),
    ))
    const response = await fetch(url, {
      headers: {
        accept: acceptsXml
          ? "application/rss+xml,application/xml,text/xml,text/plain;q=0.8"
          : "text/html,application/xhtml+xml",
        "user-agent": "LeadDrive-Azerbaijan-News-Monitor/1.0 (+https://leaddrivecrm.org)",
      },
      redirect: "follow",
      signal: controller.signal,
    })
    // Some publisher searches use HTTP 404 for a valid empty result. Treat that
    // narrowly as empty; article 404s and all other errors remain failures.
    if (response.status === 404 && options.notFoundIsEmpty === true) return ""
    if (!response.ok) throw new Error(`azerbaijan_news_http_${response.status}`)
    const finalUrl = new URL(response.url || url.toString())
    if (finalUrl.protocol !== "https:" || finalUrl.hostname.toLowerCase().replace(/^www\./u, "") !== expectedHost) {
      throw new Error("azerbaijan_news_redirect_outside_publisher")
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    const allowedContentTypes = options.allowedContentTypes ?? ["text/html", "application/xhtml+xml"]
    if (contentType && !allowedContentTypes.some(allowed => contentType.includes(allowed))) {
      throw new Error("azerbaijan_news_non_html_response")
    }
    const contentLength = Number(response.headers.get("content-length") ?? "")
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error("azerbaijan_news_response_too_large")
    }
    const html = await response.text()
    if (Buffer.byteLength(html, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("azerbaijan_news_response_too_large")
    }
    return html
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
      const index = cursor++
      results[index] = await mapper(items[index])
    }
  }))
  return results
}

async function ingestVerifiedArticle(
  source: MonitoringSourceForRun,
  article: VerifiedAzerbaijanNewsArticle,
  matchedTerm: string,
): Promise<{ created: boolean; accepted: boolean }> {
  const digest = crypto.createHash("sha256").update(article.url).digest("hex")
  const externalProviderKey = article.providerKey === "report" ? "report" : article.providerKey
  const input: IngestInput = {
    organizationId: source.organizationId,
    accountId: null,
    platform: "web",
    externalId: `az-news:${externalProviderKey}:${digest}`,
    sourceType: "mention",
    contentKind: "ARTICLE",
    sourceProvider: "search_index",
    sourceMetadata: {
      monitoringSourceId: source.id,
      collector: "azerbaijan_news_direct",
      provider: article.publisherHost,
      publisherName: article.publisher,
      publisherDomain: article.publisherHost,
      publisherCountry: "AZ",
      headline: article.title,
      description: article.description,
      newsOnly: true,
      partialCoverage: true,
      policyVersion: AZERBAIJAN_NEWS_POLICY_VERSION,
      imageUrl: article.imageUrl,
      ...routeExecutionMetadata(source),
    },
    text: [article.title, article.description].filter(Boolean).join("\n"),
    sentiment: null,
    matchedTerm,
    engagement: 0,
    reach: 0,
    url: article.url,
    canonicalUrl: article.url,
    authorName: article.publisher,
    authorHandle: article.publisherHost,
    publishedAt: article.publishedAt,
    observation: observationContextForCollector(source, {
      providerItemId: digest,
      idempotencyKey: targetScopedObservationIdempotencyKey(source, article.url),
      rawPayload: {
        title: article.title,
        description: article.description,
        url: article.url,
        publisher: article.publisher,
        publisherHost: article.publisherHost,
        publisherCountry: "AZ",
        publishedAt: article.publishedAt.toISOString(),
      },
      relevanceStatus: "ACCEPTED",
      relevanceReason: "azerbaijan_news_verified_newsarticle",
      relevanceConfidence: 0.98,
      policySnapshot: {
        policyVersion: AZERBAIJAN_NEWS_POLICY_VERSION,
        newsOnly: true,
        publisherCountry: "AZ",
        requiredStructuredType: "NewsArticle",
      },
    }),
  }
  const result = await ingestMentionWithResult(input)
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

const AZERBAIJAN_NEWS_PUBLISHERS = [
  {
    host: REPORT_AZ_HOST,
    searchUrl(term: string) {
      const url = new URL("/search", REPORT_AZ_ORIGIN)
      url.searchParams.set("query", term)
      return url
    },
    parseSearch: parseReportAzSearchHtml,
  },
  {
    host: BAKU_WS_HOST,
    searchUrl(term: string) {
      const url = new URL("/search", BAKU_WS_ORIGIN)
      url.searchParams.set("query", term)
      return url
    },
    parseSearch: parseBakuWsSearchHtml,
  },
] satisfies Array<{
  host: AzerbaijanNewsSearchPublisherHost
  searchUrl: (term: string) => URL
  parseSearch: (html: string) => AzerbaijanNewsSearchCandidate[]
}>

function collectionOptions(source: MonitoringSourceForRun): {
  feedsEnabled: boolean
  publisherSearchEnabled: boolean
} {
  const news = record(record(source.settings).azerbaijanNews)
  return {
    feedsEnabled: news.feedsEnabled !== false,
    publisherSearchEnabled: news.publisherSearchEnabled !== false,
  }
}

function verifiedArticleFromGeneric(
  candidate: AzerbaijanNewsSearchCandidate,
  article: Awaited<ReturnType<typeof fetchVerifiedWebNewsArticle>>,
): VerifiedAzerbaijanNewsArticle | null {
  if (!article) return null
  const articleHost = article.publisherDomain.toLowerCase().replace(/^www\./u, "")
  const candidateHost = candidate.publisherHost.toLowerCase().replace(/^www\./u, "")
  if (articleHost !== candidateHost && !articleHost.endsWith(`.${candidateHost}`)) return null
  return {
    ...candidate,
    publisher: article.publisherName || candidate.publisher,
    publisherHost: articleHost,
    url: article.url,
    title: article.headline,
    publishedAt: article.publishedAt,
    description: article.description,
    authorName: article.authorName,
    imageUrl: article.imageUrl || candidate.imageUrl || null,
    matchedCorpus: article.matchedCorpus,
  }
}

export async function runAzerbaijanNewsCollector(
  source: MonitoringSourceForRun,
): Promise<MonitoringCollectorResult> {
  if (source.platform !== "web") {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "azerbaijan_news_web_only",
      rawStats: { adapter: AZERBAIJAN_NEWS_ADAPTER, providerRequestDispatched: false },
    }
  }

  const matchTerms = await requiredMatchTermsForSource(source)
  const queryTerms = normalizedQueryTerms(matchTerms.terms)
  const window = azerbaijanNewsWindow(source)
  const limit = maxItems(source)
  const options = collectionOptions(source)
  if (queryTerms.length === 0) {
    return {
      status: "success",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: null,
      rawStats: {
        adapter: AZERBAIJAN_NEWS_ADAPTER,
        provider: "azerbaijan_news_publishers",
        publishers: AZERBAIJAN_NEWS_PUBLISHERS.map(publisher => publisher.host),
        publisherCountry: "AZ",
        newsOnly: true,
        partialCoverage: true,
        requiredMatchTerms: [],
        skippedReason: "azerbaijan_news_terms_missing",
        since: window.since.toISOString(),
        until: window.until.toISOString(),
      },
    }
  }

  let failedQueryCount = 0
  let successfulQueryCount = 0
  let attemptedQueryCount = 0
  let searchThrottled = false
  let lastSearchError: string | null = null
  const publisherStats: Array<{
    publisher: AzerbaijanNewsSearchPublisherHost
    attemptedQueryCount: number
    successfulQueryCount: number
    failedQueryCount: number
    throttled: boolean
    lastError: string | null
  }> = []
  const feedStats: Array<{
    publisher: string
    feedUrl: string
    receivedCount: number
    acceptedWindowCount: number
    status: "success" | "failed"
    lastError: string | null
  }> = []
  const candidatesByUrl = new Map<string, AzerbaijanNewsSearchCandidate>()
  if (options.publisherSearchEnabled) for (const publisher of AZERBAIJAN_NEWS_PUBLISHERS) {
    const stats = {
      publisher: publisher.host,
      attemptedQueryCount: 0,
      successfulQueryCount: 0,
      failedQueryCount: 0,
      throttled: false,
      lastError: null as string | null,
    }
    publisherStats.push(stats)
    for (const term of queryTerms) {
      attemptedQueryCount++
      stats.attemptedQueryCount++
      try {
        const html = await fetchBoundedHtml(
          publisher.searchUrl(term),
          publisher.host,
          { notFoundIsEmpty: true },
        )
        successfulQueryCount++
        stats.successfulQueryCount++
        for (const candidate of publisher.parseSearch(html)) {
          if (!withinWindow(candidate.publishedAt, window)) continue
          const existing = candidatesByUrl.get(candidate.url)
          if (!existing || candidate.publishedAt.getTime() > existing.publishedAt.getTime()) {
            candidatesByUrl.set(candidate.url, candidate)
          }
        }
      } catch (error) {
        failedQueryCount++
        stats.failedQueryCount++
        lastSearchError = error instanceof Error ? error.message : "azerbaijan_news_search_failed"
        stats.lastError = lastSearchError
        // A publisher-wide 403/429 is not term-specific. Stop querying only
        // that publisher and continue with the next free local news source.
        if (lastSearchError === "azerbaijan_news_http_403" || lastSearchError === "azerbaijan_news_http_429") {
          searchThrottled = true
          stats.throttled = true
          break
        }
      }
    }
  }

  let attemptedFeedCount = 0
  let successfulFeedCount = 0
  let failedFeedCount = 0
  let ignoredFeedPreviewMismatchCount = 0
  if (options.feedsEnabled) for (const feed of AZERBAIJAN_NEWS_FEEDS) {
    attemptedFeedCount++
    const stats = {
      publisher: feed.publisher,
      feedUrl: feed.url,
      receivedCount: 0,
      acceptedWindowCount: 0,
      status: "success" as "success" | "failed",
      lastError: null as string | null,
    }
    feedStats.push(stats)
    try {
      const xml = await fetchBoundedHtml(new URL(feed.url), feed.publisherHost, {
        allowedContentTypes: [
          "application/rss+xml",
          "application/atom+xml",
          "application/xml",
          "text/xml",
          "text/plain",
        ],
      })
      const items = parseAzerbaijanNewsRss(xml, feed)
      stats.receivedCount = items.length
      for (const candidate of items) {
        if (!withinWindow(candidate.publishedAt, window)) continue
        // Public feeds may contain hundreds of unrelated stories. The feed is
        // discovery only: fetch the publisher page when its own headline or
        // teaser already contains a scenario term, then require the term again
        // against verified NewsArticle metadata below.
        const previewCorpus = [candidate.title, candidate.description].filter(Boolean).join("\n")
        if (!findMatchedKeyword(previewCorpus, matchTerms.terms)) {
          ignoredFeedPreviewMismatchCount++
          continue
        }
        stats.acceptedWindowCount++
        const existing = candidatesByUrl.get(candidate.url)
        if (!existing || candidate.publishedAt.getTime() > existing.publishedAt.getTime()) {
          candidatesByUrl.set(candidate.url, candidate)
        }
      }
      successfulFeedCount++
    } catch (error) {
      failedFeedCount++
      stats.status = "failed"
      stats.lastError = error instanceof Error ? error.message : "azerbaijan_news_feed_failed"
    }
  }

  const candidates = Array.from(candidatesByUrl.values())
    .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime())
    .slice(0, limit)
  let articleFetchFailureCount = 0
  let ignoredNotNewsCount = 0
  let ignoredNoDirectMatchCount = 0
  const verified = await mapWithConcurrency(candidates, ARTICLE_CONCURRENCY, async candidate => {
    try {
      const article = candidate.publisherHost === REPORT_AZ_HOST || candidate.publisherHost === BAKU_WS_HOST
        ? parseVerifiedReportAzArticle(
            await fetchBoundedHtml(new URL(candidate.url), candidate.publisherHost),
            candidate,
          )
        : verifiedArticleFromGeneric(
            candidate,
            await fetchVerifiedWebNewsArticle(candidate.url),
          )
      if (!article || !withinWindow(article.publishedAt, window)) {
        ignoredNotNewsCount++
        return null
      }
      const matchedTerm = findMatchedKeyword(article.matchedCorpus, matchTerms.terms)
      if (!matchedTerm) {
        ignoredNoDirectMatchCount++
        return null
      }
      return { article, matchedTerm }
    } catch {
      articleFetchFailureCount++
      return null
    }
  })

  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = ignoredNotNewsCount + ignoredNoDirectMatchCount + articleFetchFailureCount
  for (const item of verified) {
    if (!item) continue
    foundCount++
    const ingested = await ingestVerifiedArticle(source, item.article, item.matchedTerm)
    if (!ingested.accepted) ignoredCount++
    else if (ingested.created) newCount++
    else duplicateCount++
  }

  const attemptedAcquisitionCount = attemptedQueryCount + attemptedFeedCount
  const successfulAcquisitionCount = successfulQueryCount + successfulFeedCount
  const allAcquisitionsFailed = attemptedAcquisitionCount > 0 && successfulAcquisitionCount === 0
  const partial = !allAcquisitionsFailed && (
    failedQueryCount > 0
    || failedFeedCount > 0
    || articleFetchFailureCount > 0
  )
  return {
    status: allAcquisitionsFailed ? "failed" : partial ? "partial" : "success",
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: allAcquisitionsFailed
      ? "azerbaijan_news_search_unavailable"
      : partial
        ? "azerbaijan_news_partial_fetch"
        : null,
    rawStats: {
      adapter: AZERBAIJAN_NEWS_ADAPTER,
      provider: "azerbaijan_news_publishers",
      publishers: [
        ...(options.publisherSearchEnabled ? AZERBAIJAN_NEWS_PUBLISHERS.map(publisher => publisher.host) : []),
        ...(options.feedsEnabled ? AZERBAIJAN_NEWS_FEEDS.map(feed => feed.publisherHost) : []),
      ],
      publisherStats,
      feedStats,
      publisherCountry: "AZ",
      newsOnly: true,
      partialCoverage: true,
      freeRoute: true,
      policyVersion: AZERBAIJAN_NEWS_POLICY_VERSION,
      queryTerms,
      attemptedQueryCount,
      attemptedFeedCount,
      successfulFeedCount,
      failedFeedCount,
      ignoredFeedPreviewMismatchCount,
      successfulQueryCount,
      matchTermSource: matchTerms.source,
      scenarioIds: matchTerms.scenarioIds,
      scenarioNames: matchTerms.scenarioNames,
      receivedCandidateCount: candidatesByUrl.size,
      checkedCandidateCount: candidates.length,
      verifiedNewsCount: foundCount,
      failedQueryCount,
      searchThrottled,
      lastSearchError,
      articleFetchFailureCount,
      ignoredNotNewsCount,
      ignoredNoDirectMatchCount,
      since: window.since.toISOString(),
      until: window.until.toISOString(),
      resumedFromWatermark: window.resumedFromWatermark,
      providerWindowClamped: window.clamped,
    },
  }
}
