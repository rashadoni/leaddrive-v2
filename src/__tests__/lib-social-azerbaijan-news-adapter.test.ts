import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  mentionEvidence: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}))

const mockDeps = vi.hoisted(() => ({
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  getMonitoringScenarios: vi.fn(),
  fetchVerifiedWebNewsArticle: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: mockDeps.findMatchedKeyword,
  ingestMentionWithResult: mockDeps.ingestMentionWithResult,
}))
vi.mock("@/lib/social/monitoring-scenarios", () => ({
  getMonitoringScenarios: mockDeps.getMonitoringScenarios,
}))
vi.mock("@/lib/social/web-news-article", () => ({
  fetchVerifiedWebNewsArticle: mockDeps.fetchVerifiedWebNewsArticle,
}))

import {
  azerbaijanNewsWindow,
  parseBakuWsSearchHtml,
  parseReportAzSearchHtml,
  parseVerifiedReportAzArticle,
  runAzerbaijanNewsCollector,
} from "@/lib/social/azerbaijan-news-adapter"
import {
  AZERBAIJAN_NEWS_FEEDS,
  parseAzerbaijanNewsRss,
} from "@/lib/social/azerbaijan-news-feed"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const source: MonitoringSourceForRun = {
  id: "source-web",
  organizationId: "org-1",
  platform: "web",
  sourceType: "keyword",
  collectionMode: "search_index",
  status: "active",
  cadenceMinutes: 360,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  query: "Baku Electronics",
  keywords: ["Baku Electronics"],
  settings: {
    scenarioId: "scenario-baku",
    azerbaijanNews: {
      feedsEnabled: false,
    },
  },
  routeExecution: {
    collectorRunId: "collector-1",
    routePlanId: "route-1",
    capability: "DISCOVER_POSTS",
    adapterKey: "AZERBAIJAN_NEWS_DIRECT",
    acquisitionMode: "NEWS_INDEX",
    targetScenarioId: "scenario-baku",
    targetSubjectId: "subject-baku",
    fullArchiveRun: true,
    maxItems: 50,
  },
}

const searchHtml = `
  <div class="col-md-3 index-post-block" data-timestamp="2026-07-19 12:05:35">
    <a href="/biznes-xeberleri/baku-electronics-yeni-kampaniya" class="news__item" target="_blank">
      <h2 class="news__title ">Baku Electronics yeni kampaniyaya başlayıb</h2>
    </a>
  </div>
`

const bakuWsSearchHtml = `
  <div class="post-item">
    <div class="post-item-img">
      <a href="https://baku.ws/biznes/baku-electronics-yeni-kampaniyaya-baslayib">
        <span class="post-item-date">
          <span class="post-item-date-time">14:20</span>
          <span class="post-item-date-day">20 iyul 2026</span>
        </span>
      </a>
    </div>
    <h3 class="post-item-title">
      <a href="https://baku.ws/biznes/baku-electronics-yeni-kampaniyaya-baslayib">
        Baku Electronics yeni kampaniyaya başlayıb
      </a>
    </h3>
  </div>
`

const apaRss = `
  <?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <item>
        <title><![CDATA[Baku Electronics yeni mağaza açıb]]></title>
        <description><![CDATA[Şirkət Bakıda yeni mağazasını istifadəyə verib.]]></description>
        <link>https://apa.az/sahibkarliq/baku-electronics-yeni-magaza-acib-984788</link>
        <pubDate>Sun, 26 Jul 2026 15:30:00 +0400</pubDate>
        <enclosure url="https://apa.az/storage/news/baku-electronics.jpg" type="image/jpeg"/>
      </item>
      <item>
        <title>Etibarsız nəticə</title>
        <link>https://example.com/not-azerbaijan-news</link>
        <pubDate>Sun, 26 Jul 2026 15:30:00 +0400</pubDate>
      </item>
      <item>
        <title><![CDATA[Baku Electronics 2024-cü il kampaniyası]]></title>
        <description><![CDATA[Bu köhnə xəbər yeni nəticə kimi qəbul edilməməlidir.]]></description>
        <link>https://apa.az/sahibkarliq/baku-electronics-2024-kampaniyasi-700001</link>
        <pubDate>Mon, 15 Jan 2024 10:00:00 +0400</pubDate>
      </item>
    </channel>
  </rss>
`

const qafqazinfoEncodedCdataRss = `
  <?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <item>
        <title>Yeni endirim kampaniyası elan edildi</title>
        <description>&lt;![CDATA[&lt;p&gt;Baku Electronics mağazalarında yeni kampaniya başlayıb.&lt;/p&gt;]]&gt;</description>
        <link>https://qafqazinfo.az/news/111111/yeni-endirim-kampaniyasi-elan-edildi</link>
        <pubDate>Sun, 26 Jul 2026 15:30:00 +0400</pubDate>
        <image><url>https://qafqazinfo.az/storage/111111.jpg</url></image>
      </item>
    </channel>
  </rss>
`

function articleHtml(type = "NewsArticle") {
  return `
    <html><head>
      <script type="application/ld+json">
      [{
        "@context":"https://schema.org",
        "@type":"${type}",
        "headline":"Baku Electronics yeni kampaniyaya başlayıb",
        "url":"https://report.az/biznes-xeberleri/baku-electronics-yeni-kampaniya",
        "datePublished":"2026-07-19T12:05:35+04:00",
        "description":"Baku Electronics Azərbaycanda yeni kampaniyanı elan edib.",
        "articleBody":"Baku Electronics mağazalarında yeni kampaniya başlayıb.",
        "author":{"@type":"Person","name":"İqtisadiyyat şöbəsi"},
        "image":{"@type":"ImageObject","url":"https://images.report.az/news.jpg"}
      }]
      </script>
    </head></html>
  `
}

function bakuWsArticleHtml() {
  return `
    <html><head>
      <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"NewsArticle",
        "headline":"Baku Electronics yeni kampaniyaya başlayıb",
        "url":"https://baku.ws/biznes/baku-electronics-yeni-kampaniyaya-baslayib",
        "datePublished":"2026-07-20T14:20:00+04:00",
        "description":"Yerli pərakəndə satış şəbəkəsi yeni kampaniyanı elan edib.",
        "articleBody":"Kampaniya iyulun 20-də başlayıb."
      }
      </script>
    </head><body>
      <div class="post-detail-content resize-area">
        <p>Baku Electronics mağazalarında yeni kampaniya başlayıb.</p>
      </div>
      <div class="share-block"></div>
    </body></html>
  `
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=UTF-8" },
  })
}

function rssResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/rss+xml; charset=UTF-8" },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"))
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  mockDeps.getMonitoringScenarios.mockResolvedValue([{
    id: "scenario-baku",
    name: "Baku Electronics",
    status: "active",
    platforms: ["web"],
    search: {
      topics: [],
      keywords: ["Baku Electronics"],
      hashtags: [],
      handles: [],
      urls: [],
    },
  }])
  mockDeps.findMatchedKeyword.mockImplementation((text: string, terms: string[]) =>
    terms.find(term => text.toLowerCase().includes(term.toLowerCase())) ?? null)
  mockDeps.ingestMentionWithResult.mockResolvedValue({
    id: "mention-1",
    created: true,
    accepted: true,
  })
  mockPrisma.mentionEvidence.findFirst.mockResolvedValue(null)
  mockPrisma.mentionEvidence.create.mockResolvedValue({ id: "evidence-1" })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("Azerbaijan direct news adapter", () => {
  it("parses publisher RSS items without accepting off-domain links", () => {
    const items = parseAzerbaijanNewsRss(apaRss, AZERBAIJAN_NEWS_FEEDS[0])
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual(expect.objectContaining({
      publisher: "APA.AZ",
      publisherHost: "apa.az",
      providerKey: "apa",
      title: "Baku Electronics yeni mağaza açıb",
      description: "Şirkət Bakıda yeni mağazasını istifadəyə verib.",
      url: "https://apa.az/sahibkarliq/baku-electronics-yeni-magaza-acib-984788",
      imageUrl: "https://apa.az/storage/news/baku-electronics.jpg",
      publishedAt: new Date("2026-07-26T11:30:00.000Z"),
    }))
    expect(items[1]).toEqual(expect.objectContaining({
      title: "Baku Electronics 2024-cü il kampaniyası",
      publishedAt: new Date("2024-01-15T06:00:00.000Z"),
    }))
  })

  it("preserves a description-only brand term from Qafqazinfo entity-escaped CDATA", () => {
    const [item] = parseAzerbaijanNewsRss(
      qafqazinfoEncodedCdataRss,
      AZERBAIJAN_NEWS_FEEDS[2],
    )

    expect(item).toEqual(expect.objectContaining({
      publisher: "Qafqazinfo",
      publisherHost: "qafqazinfo.az",
      providerKey: "qafqazinfo",
      title: "Yeni endirim kampaniyası elan edildi",
      description: "Baku Electronics mağazalarında yeni kampaniya başlayıb.",
      url: "https://qafqazinfo.az/news/111111/yeni-endirim-kampaniyasi-elan-edildi",
      imageUrl: "https://qafqazinfo.az/storage/111111.jpg",
    }))
    expect(item.title).not.toContain("Baku Electronics")
    expect(item.description).toContain("Baku Electronics")
  })

  it("parses only dated Report.az search candidates and verifies NewsArticle JSON-LD", () => {
    const [candidate] = parseReportAzSearchHtml(searchHtml)

    expect(candidate).toMatchObject({
      publisher: "Report.az",
      publisherHost: "report.az",
      url: "https://report.az/biznes-xeberleri/baku-electronics-yeni-kampaniya",
      title: "Baku Electronics yeni kampaniyaya başlayıb",
    })
    expect(candidate.publishedAt.toISOString()).toBe("2026-07-19T08:05:35.000Z")
    expect(parseVerifiedReportAzArticle(articleHtml(), candidate)).toMatchObject({
      title: "Baku Electronics yeni kampaniyaya başlayıb",
      description: "Baku Electronics Azərbaycanda yeni kampaniyanı elan edib.",
      authorName: "İqtisadiyyat şöbəsi",
    })
    expect(parseVerifiedReportAzArticle(articleHtml("Product"), candidate)).toBeNull()

    const [bakuWsCandidate] = parseBakuWsSearchHtml(bakuWsSearchHtml)
    expect(bakuWsCandidate).toMatchObject({
      publisher: "Baku.ws",
      publisherHost: "baku.ws",
      url: "https://baku.ws/biznes/baku-electronics-yeni-kampaniyaya-baslayib",
      publishedAt: new Date("2026-07-20T10:20:00.000Z"),
    })
    expect(parseVerifiedReportAzArticle(bakuWsArticleHtml(), bakuWsCandidate)?.matchedCorpus)
      .toContain("Baku Electronics mağazalarında")
  })

  it("uses 90 days for an explicit button run but never admits 2024 results", async () => {
    const window = azerbaijanNewsWindow({
      ...source,
      settings: {
        ...(source.settings as Record<string, unknown>),
        searchIndex: {
          routeProviderCursors: {
            "route-1:AZERBAIJAN_NEWS_DIRECT": {
              fetchAfter: "2026-07-24T05:54:36.108Z",
            },
          },
        },
      },
    })
    expect(window.since.toISOString()).toBe("2026-04-27T12:00:00.000Z")
    expect(window.resumedFromWatermark).toBe(false)

    const oldHtml = searchHtml.replace("2026-07-19 12:05:35", "2024-01-15 12:05:35")
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(htmlResponse(oldHtml))
      .mockResolvedValueOnce(htmlResponse(""))
    vi.stubGlobal("fetch", fetchMock)

    const result = await runAzerbaijanNewsCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockDeps.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("uses the targeted scenario archive start for an explicit button run", () => {
    const window = azerbaijanNewsWindow({
      ...source,
      settings: {
        ...(source.settings as Record<string, unknown>),
        scenarioLinks: [{
          scenarioId: "scenario-baku",
          archiveStartAt: "2026-06-01T00:00:00.000Z",
        }],
      },
      routeExecution: {
        ...source.routeExecution!,
        archiveStartAt: "2026-07-01T00:00:00.000Z",
      },
    })

    expect(window.since.toISOString()).toBe("2026-07-01T00:00:00.000Z")
    expect(window.resumedFromWatermark).toBe(false)
    expect(window.clamped).toBe(false)
  })

  it("keeps scheduled collection incremental and bounded to 48 hours", () => {
    const window = azerbaijanNewsWindow({
      ...source,
      settings: {
        ...(source.settings as Record<string, unknown>),
        searchIndex: {
          routeProviderCursors: {
            "route-1:AZERBAIJAN_NEWS_DIRECT": {
              fetchAfter: "2026-07-25T05:54:36.108Z",
            },
          },
        },
      },
      routeExecution: {
        ...source.routeExecution!,
        fullArchiveRun: false,
      },
    })

    expect(window.since.toISOString()).toBe("2026-07-25T05:54:36.108Z")
    expect(window.resumedFromWatermark).toBe(true)
  })

  it("treats Report.az search 404 as a valid empty news result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse("", 404))
    vi.stubGlobal("fetch", fetchMock)

    const result = await runAzerbaijanNewsCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: null,
      rawStats: {
        failedQueryCount: 0,
        receivedCandidateCount: 0,
        verifiedNewsCount: 0,
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("stops the query pack immediately when the publisher blocks the shared IP", async () => {
    mockDeps.getMonitoringScenarios.mockResolvedValue([{
      id: "scenario-baku",
      name: "Baku Electronics",
      status: "active",
      platforms: ["web"],
      search: {
        topics: [],
        keywords: [
          "Baku Electronics",
          "bakuelectronics",
          "bakuelectronics.az",
          "Baku elektroniks",
          "bakuelektroniks",
          "bakuelectronicsaz",
        ],
        hashtags: [],
        handles: [],
        urls: [],
      },
    }])
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse("", 403))
    vi.stubGlobal("fetch", fetchMock)

    const result = await runAzerbaijanNewsCollector(source)

    expect(result).toMatchObject({
      status: "failed",
      foundCount: 0,
      error: "azerbaijan_news_search_unavailable",
      rawStats: {
        attemptedQueryCount: 2,
        successfulQueryCount: 0,
        failedQueryCount: 2,
        searchThrottled: true,
        lastSearchError: "azerbaijan_news_http_403",
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("imports only a directly matched, structured local news article", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(htmlResponse(searchHtml))
      .mockResolvedValueOnce(htmlResponse(""))
      .mockResolvedValueOnce(htmlResponse(articleHtml()))
    vi.stubGlobal("fetch", fetchMock)

    const result = await runAzerbaijanNewsCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 1,
      duplicateCount: 0,
      ignoredCount: 0,
      rawStats: {
        adapter: "AZERBAIJAN_NEWS_DIRECT",
        provider: "azerbaijan_news_publishers",
        publisherCountry: "AZ",
        newsOnly: true,
        freeRoute: true,
        verifiedNewsCount: 1,
      },
    })
    expect(mockDeps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "web",
      contentKind: "ARTICLE",
      sourceProvider: "search_index",
      authorName: "Report.az",
      matchedTerm: "Baku Electronics",
      publishedAt: new Date("2026-07-19T08:05:35.000Z"),
      observation: expect.objectContaining({
        acquisitionMode: "NEWS_INDEX",
        relevanceStatus: "ACCEPTED",
        relevanceReason: "azerbaijan_news_verified_newsarticle",
      }),
    }))
    expect(mockPrisma.mentionEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceTrustTier: "T3",
        confidence: 0.98,
      }),
    })
  })

  it("collects a matching article from a local publisher feed without per-scenario alert setup", async () => {
    const feedSource: MonitoringSourceForRun = {
      ...source,
      settings: {
        ...(source.settings as Record<string, unknown>),
        azerbaijanNews: {
          feedsEnabled: true,
          publisherSearchEnabled: false,
        },
      },
      routeExecution: {
        ...source.routeExecution!,
        fullArchiveRun: false,
      },
    }
    mockDeps.fetchVerifiedWebNewsArticle.mockResolvedValue({
      url: "https://apa.az/sahibkarliq/baku-electronics-yeni-magaza-acib-984788",
      publisherName: "APA.AZ",
      publisherDomain: "apa.az",
      headline: "Baku Electronics yeni mağaza açıb",
      description: "Şirkət Bakıda yeni mağazasını istifadəyə verib.",
      authorName: null,
      imageUrl: "https://apa.az/storage/news/baku-electronics.jpg",
      publishedAt: new Date("2026-07-26T11:30:00.000Z"),
      matchedCorpus: "Baku Electronics yeni mağaza açıb\nŞirkət Bakıda yeni mağazasını istifadəyə verib.",
    })
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === "https://apa.az/rss") return rssResponse(apaRss)
      if ([
        "https://banker.az/feed/",
        "https://qafqazinfo.az/rss",
        "https://modern.az/rss",
      ].includes(url)) return rssResponse("")
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runAzerbaijanNewsCollector(feedSource)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 1,
      duplicateCount: 0,
      rawStats: {
        attemptedQueryCount: 0,
        attemptedFeedCount: 4,
        successfulFeedCount: 4,
        failedFeedCount: 0,
        verifiedNewsCount: 1,
        scenarioIds: ["scenario-baku"],
      },
    })
    expect(mockDeps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "web",
      contentKind: "ARTICLE",
      authorName: "APA.AZ",
      authorHandle: "apa.az",
      matchedTerm: "Baku Electronics",
      sourceMetadata: expect.objectContaining({
        collector: "azerbaijan_news_direct",
        provider: "apa.az",
        publisherDomain: "apa.az",
        headline: "Baku Electronics yeni mağaza açıb",
        newsOnly: true,
      }),
    }))
    expect(mockDeps.fetchVerifiedWebNewsArticle).toHaveBeenCalledTimes(1)
  })

  it("continues with Baku.ws when Report.az blocks the shared server IP", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(htmlResponse("", 403))
      .mockResolvedValueOnce(htmlResponse(bakuWsSearchHtml))
      .mockResolvedValueOnce(htmlResponse(bakuWsArticleHtml()))
    vi.stubGlobal("fetch", fetchMock)

    const result = await runAzerbaijanNewsCollector(source)

    expect(result).toMatchObject({
      status: "partial",
      foundCount: 1,
      newCount: 1,
      error: "azerbaijan_news_partial_fetch",
      rawStats: {
        searchThrottled: true,
        successfulQueryCount: 1,
        publishers: ["report.az", "baku.ws"],
        publisherStats: [
          {
            publisher: "report.az",
            attemptedQueryCount: 1,
            failedQueryCount: 1,
            throttled: true,
          },
          {
            publisher: "baku.ws",
            attemptedQueryCount: 1,
            successfulQueryCount: 1,
            throttled: false,
          },
        ],
      },
    })
    expect(mockDeps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: expect.stringMatching(/^az-news:baku-ws:/u),
      authorName: "Baku.ws",
      authorHandle: "baku.ws",
      matchedTerm: "Baku Electronics",
      sourceMetadata: expect.objectContaining({
        provider: "baku.ws",
      }),
    }))
  })

  it("uses a new scenario's terms and makes a repeated run duplicate-safe", async () => {
    mockDeps.getMonitoringScenarios.mockResolvedValue([{
      id: "scenario-araz",
      name: "Araz Supermarket",
      status: "active",
      platforms: ["web"],
      search: {
        topics: [],
        keywords: ["Araz Supermarket"],
        hashtags: [],
        handles: [],
        urls: [],
      },
    }])
    const arazSource: MonitoringSourceForRun = {
      ...source,
      query: "Araz Supermarket",
      keywords: ["Araz Supermarket"],
      settings: { scenarioId: "scenario-araz" },
      routeExecution: {
        ...source.routeExecution!,
        targetScenarioId: "scenario-araz",
        targetSubjectId: "subject-araz",
      },
    }
    const arazSearchHtml = bakuWsSearchHtml
      .replaceAll("baku-electronics", "araz-supermarket")
      .replaceAll("Baku Electronics", "Araz Supermarket")
    const arazArticleHtml = bakuWsArticleHtml()
      .replaceAll("baku-electronics", "araz-supermarket")
      .replaceAll("Baku Electronics", "Araz Supermarket")
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url)
      if (url.hostname === "report.az") return htmlResponse("")
      if (url.pathname === "/search") return htmlResponse(arazSearchHtml)
      return htmlResponse(arazArticleHtml)
    })
    vi.stubGlobal("fetch", fetchMock)
    mockDeps.ingestMentionWithResult
      .mockResolvedValueOnce({ id: "mention-araz", created: true, accepted: true })
      .mockResolvedValueOnce({ id: "mention-araz", created: false, accepted: true })

    const first = await runAzerbaijanNewsCollector(arazSource)
    const repeated = await runAzerbaijanNewsCollector(arazSource)

    expect(first).toMatchObject({ foundCount: 1, newCount: 1, duplicateCount: 0 })
    expect(repeated).toMatchObject({ foundCount: 1, newCount: 0, duplicateCount: 1 })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "baku.ws",
        searchParams: expect.any(URLSearchParams),
      }),
      expect.anything(),
    )
    const requestedSearchTerms = fetchMock.mock.calls
      .map(([input]) => input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url))
      .filter(url => url.pathname === "/search")
      .map(url => url.searchParams.get("query"))
    expect(requestedSearchTerms).toContain("Araz Supermarket")
  })
})
