import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mentionEvidence: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/social/search-index-adapter", () => ({
  requiredMatchTermsForSource: vi.fn(async () => ({
    terms: ["Bravo Supermarket"],
    source: "scenario",
    scenarioIds: ["scenario-1"],
    scenarioNames: ["Bravo Supermarket"],
  })),
}))

import {
  normalizeGoogleAlertsRssUrl,
  syncGoogleAlertsRssSource,
} from "@/lib/social/google-alerts-rss"
import {
  googleAlertsRssEntriesAfterCheckpoint,
  parseGoogleAlertsAtomFeed,
  runGoogleAlertsRssCollector,
} from "@/lib/social/google-alerts-rss-adapter"
import { redactMonitoringSettingsForResponse } from "@/lib/social/monitoring-source"
import { encryptToken } from "@/lib/secure-token"
import { archiveProviderCursorKey } from "@/lib/social/archive-provider-window"
import type { MonitoringScenario } from "@/lib/social/monitoring-scenarios"

describe("Google Alerts RSS", () => {
  it("accepts only the official HTTPS feed shape and canonicalizes the host", () => {
    expect(normalizeGoogleAlertsRssUrl(
      "https://google.com/alerts/feeds/11111111111111111111/22222222222222222222/",
    )).toMatchObject({
      url: "https://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222",
      accountId: "11111111111111111111",
      alertId: "22222222222222222222",
    })

    expect(() => normalizeGoogleAlertsRssUrl(
      "https://evil.example/alerts/feeds/11111111111111111111/22222222222222222222",
    )).toThrow("google_alerts_rss_url_invalid")
    expect(() => normalizeGoogleAlertsRssUrl(
      "https://mail.google.com/alerts/feeds/11111111111111111111/22222222222222222222",
    )).toThrow("google_alerts_rss_url_invalid")
    expect(() => normalizeGoogleAlertsRssUrl(
      "https://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222?next=https://evil.example",
    )).toThrow("google_alerts_rss_url_invalid")
    expect(() => normalizeGoogleAlertsRssUrl(
      "http://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222",
    )).toThrow("google_alerts_rss_url_invalid")
  })

  it("parses Atom entries, unwraps Google links, strips markup, and deduplicates URLs", () => {
    const target = "https://report.az/biznes-xeberleri/bravo-supermarket-yeni-magaza"
    const wrapped = `https://www.google.com/url?url=${encodeURIComponent(target)}&amp;ct=ga`
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title type="html">&lt;b&gt;Bravo&lt;/b&gt; Supermarket xəbəri</title>
          <content type="html">&lt;p&gt;Yeni &lt;b&gt;Bravo Supermarket&lt;/b&gt;&amp;nbsp;xəbəri&lt;/p&gt;</content>
          <link href="${wrapped}" rel="alternate"/>
          <updated>2026-07-28T10:00:00Z</updated>
        </entry>
        <entry>
          <title>Duplicate</title>
          <link href="${wrapped}" rel="alternate"/>
        </entry>
      </feed>`

    expect(parseGoogleAlertsAtomFeed(xml)).toEqual([{
      title: "Bravo Supermarket xəbəri",
      snippet: "Yeni Bravo Supermarket xəbəri",
      url: target,
      updatedAt: new Date("2026-07-28T10:00:00Z"),
    }])
  })

  it("bounds Google Alerts snippets before they can become evidence", () => {
    const target = "https://report.az/biznes-xeberleri/bravo-supermarket-yeni-magaza"
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>News</title>
        <summary type="html">&lt;p&gt;${"x".repeat(1_500)}&lt;/p&gt;</summary>
        <link href="${target}" rel="alternate"/>
      </entry>
    </feed>`

    const [entry] = parseGoogleAlertsAtomFeed(xml)
    expect(entry.snippet).toHaveLength(1_200)
    expect(entry.snippet).not.toContain("<")
  })

  it("falls back to summary text and safely replaces invalid numeric entities", () => {
    const target = "https://report.az/biznes-xeberleri/bravo-supermarket-yeni-magaza"
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>News</title>
        <content type="html">&lt;p&gt;&lt;/p&gt;</content>
        <summary type="html">Bravo Supermarket &amp;#0; &amp;#9999999999; &amp;#xD800;</summary>
        <link href="${target}" rel="alternate"/>
      </entry>
    </feed>`

    expect(() => parseGoogleAlertsAtomFeed(xml)).not.toThrow()
    const [entry] = parseGoogleAlertsAtomFeed(xml)
    expect(entry.snippet).toBe("Bravo Supermarket � � �")
    expect(entry.snippet).not.toContain("\u0000")
  })

  it("treats a newly created empty feed as a valid feed with no entries", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <title>Оповещение Google – "Bravo Supermarket"</title>
      <link href="https://www.google.com/alerts/feeds/1/2" rel="self"/>
    </feed>`
    expect(parseGoogleAlertsAtomFeed(xml)).toEqual([])
  })

  it("uses Atom delivery timestamps for repeat checkpoints and keeps a safety overlap", () => {
    const checkpoint = new Date("2026-07-28T10:00:00.000Z")
    const old = { title: "old", snippet: null, url: "https://report.az/old", updatedAt: new Date("2026-07-28T09:54:59.000Z") }
    const overlap = { title: "overlap", snippet: null, url: "https://report.az/overlap", updatedAt: new Date("2026-07-28T09:56:00.000Z") }
    const late = { title: "late", snippet: null, url: "https://report.az/late", updatedAt: new Date("2026-07-28T10:05:00.000Z") }
    const unknown = { title: "unknown", snippet: null, url: "https://report.az/unknown", updatedAt: null }

    expect(googleAlertsRssEntriesAfterCheckpoint(
      [old, overlap, late, unknown],
      checkpoint,
    )).toEqual([overlap, late, unknown])
  })

  it("stores the scenario archive lower bound on the dedicated RSS source link", async () => {
    const create = vi.fn(async () => ({ id: "source-1" }))
    const scenario: MonitoringScenario = {
      id: "scenario-1",
      subjectId: null,
      subjectName: null,
      name: "Bravo Supermarket",
      description: null,
      status: "active",
      platforms: ["web"],
      search: {
        topics: [],
        keywords: ["Bravo Supermarket"],
        hashtags: [],
        handles: [],
        urls: [],
        useHashtagFallback: true,
        includeOwnedComments: false,
        includeExternalComments: false,
      },
      web: {
        sourceMode: "google_alerts_rss",
        googleAlertsRssConfigured: true,
      },
      ai: {
        sentiments: ["negative", "neutral", "positive"],
        minConfidence: 0.7,
        action: "alert",
        directions: ["general_reputation"],
      },
      reply: {
        identityId: null,
        identityLabel: null,
        mode: "draft_only",
        autoReplyEnabled: false,
        liveSendAllowed: false,
      },
      archive: {
        startAt: "2026-04-01T09:30:00.000Z",
        lastBackfilledAt: null,
        scannedCount: 0,
        matchedCount: 0,
        status: "pending",
      },
      createdAt: "2026-07-28T09:00:00.000Z",
      updatedAt: "2026-07-28T09:00:00.000Z",
    }
    const db = {
      monitoringSource: {
        findFirst: vi.fn(async () => null),
        create,
        update: vi.fn(),
      },
      monitoringSubjectSource: {
        upsert: vi.fn(),
      },
    }

    await syncGoogleAlertsRssSource(
      "org-1",
      scenario,
      "https://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222",
      undefined,
      db as never,
    )

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settings: expect.objectContaining({
          scenarioLinks: [
            expect.objectContaining({
              scenarioId: "scenario-1",
              archiveStartAt: "2026-04-01T09:30:00.000Z",
            }),
          ],
        }),
      }),
      select: { id: true },
    })
  })

  it("ignores verified articles before archiveStartAt and reports current-feed-only coverage", async () => {
    const archiveStartAt = "2026-07-20T00:00:00.000Z"
    const archiveCursorKey = archiveProviderCursorKey({
      routePlanId: "route-rss",
      adapterKey: "GOOGLE_ALERTS_RSS",
      fullArchiveRun: true,
      targetScenarioId: "scenario-1",
      archiveStartAt,
    })
    const feedUrl = "https://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222"
    const oldUrl = "https://report.az/biznes-xeberleri/bravo-supermarket-old"
    const currentUrl = "https://report.az/biznes-xeberleri/bravo-supermarket-current"
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Old Bravo Supermarket article</title>
        <link href="${oldUrl}" rel="alternate"/>
        <updated>2026-07-19T10:00:00Z</updated>
      </entry>
      <entry>
        <title>Current Bravo Supermarket article</title>
        <content type="html">A transport-only delivery snippet</content>
        <link href="${currentUrl}" rel="alternate"/>
        <updated>2026-07-21T10:00:00Z</updated>
      </entry>
    </feed>`
    const source = {
      id: "source-1",
      organizationId: "org-1",
      platform: "web",
      sourceType: "notification_inbox",
      query: "google-alerts-rss:scenario-1",
      collectionMode: "notification_inbox",
      status: "active",
      cadenceMinutes: 60,
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      lastError: null,
      settings: {
        managedBy: "google_alerts_rss",
        scenarioId: "scenario-1",
        scenarioLinks: [],
        searchIndex: {
          routeProviderCursors: {
            // A newer scheduled checkpoint must not hide the first/manual
            // archive feed window for this scenario.
            "route-rss:GOOGLE_ALERTS_RSS": {
              fetchAfter: "2026-07-21T11:00:00.000Z",
            },
            [archiveCursorKey]: {
              fetchAfter: "2026-07-19T09:00:00.000Z",
            },
          },
        },
        googleAlertsRss: {
          configured: true,
          encryptedFeedUrl: encryptToken(feedUrl, "google-alerts-rss:org-1:scenario-1"),
          fingerprint: "test-fingerprint",
          accountSuffix: "1111",
          alertSuffix: "2222",
        },
      },
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-rss",
        capability: "DISCOVER_POSTS",
        adapterKey: "GOOGLE_ALERTS_RSS",
        acquisitionMode: "NOTIFICATION_INBOX",
        maxItems: 50,
        fullArchiveRun: true,
        targetScenarioId: "scenario-1",
        archiveStartAt,
      },
    }
    const ingest = vi.fn(async (input: { externalId: string; text: string }) => ({
      id: `mention-${input.externalId}`,
      created: true,
    }))

    const result = await runGoogleAlertsRssCollector(source, {
      fetchImpl: vi.fn(async () => new Response(xml, {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      })) as unknown as typeof fetch,
      fetchArticle: vi.fn(async (url: string) => ({
        url,
        publisherName: "Report.az",
        publisherDomain: "report.az",
        headline: "Bravo Supermarket xəbəri",
        description: null,
        authorName: null,
        imageUrl: null,
        publishedAt: new Date(url === oldUrl
          ? "2026-07-19T10:00:00.000Z"
          : "2026-07-21T10:00:00.000Z"),
        matchedCorpus: "Bravo Supermarket xəbəri",
      })),
      ingest: ingest as never,
    })

    expect(result).toMatchObject({
      status: "success",
      foundCount: 2,
      newCount: 1,
      ignoredCount: 1,
      rawStats: expect.objectContaining({
        beforeArchiveStartCount: 1,
        feedCheckpointAt: "2026-07-19T09:00:00.000Z",
        coverageClass: "PARTIAL",
        coverageLimited: true,
        coverageLimit: "CURRENT_GOOGLE_ALERTS_FEED_ONLY",
        historicalBackfillGuaranteed: false,
        requestedWindow: expect.objectContaining({
          since: "2026-07-20T00:00:00.000Z",
        }),
      }),
    })
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      text: "Bravo Supermarket xəbəri",
    }), expect.anything())
  })

  it("does not report an empty current feed as complete historical backfill", async () => {
    const feedUrl = "https://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222"
    const result = await runGoogleAlertsRssCollector({
      id: "source-1",
      organizationId: "org-1",
      platform: "web",
      sourceType: "notification_inbox",
      query: "google-alerts-rss:scenario-1",
      collectionMode: "notification_inbox",
      status: "active",
      cadenceMinutes: 60,
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      lastError: null,
      settings: {
        managedBy: "google_alerts_rss",
        scenarioId: "scenario-1",
        scenarioLinks: [{
          scenarioId: "scenario-1",
          archiveStartAt: "2026-04-01T09:30:00.000Z",
        }],
        googleAlertsRss: {
          configured: true,
          encryptedFeedUrl: encryptToken(feedUrl, "google-alerts-rss:org-1:scenario-1"),
          fingerprint: "test-fingerprint",
          accountSuffix: "1111",
          alertSuffix: "2222",
        },
      },
    }, {
      fetchImpl: vi.fn(async () => new Response(
        `<feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
        {
          status: 200,
          headers: { "content-type": "application/atom+xml" },
        },
      )) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      status: "success",
      foundCount: 0,
      rawStats: expect.objectContaining({
        emptyFeed: true,
        coverageClass: "PARTIAL",
        coverageLimit: "CURRENT_GOOGLE_ALERTS_FEED_ONLY",
        historicalBackfillGuaranteed: false,
        requestedWindow: expect.objectContaining({
          since: "2026-04-01T09:30:00.000Z",
        }),
      }),
    })
  })

  it("accepts a verified article when the brand term appears only in the Google Alerts snippet", async () => {
    const feedUrl = "https://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222"
    const articleUrl = "https://anz.az/bravo-supermarket-xeberi"
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Market xəbərləri</title>
        <content type="html">&lt;p&gt;Yeni &lt;b&gt;Bravo Supermarket&lt;/b&gt; kampaniyası elan edildi.&lt;/p&gt;</content>
        <link href="${articleUrl}" rel="alternate"/>
        <updated>2026-07-30T23:12:00Z</updated>
      </entry>
    </feed>`
    const source = {
      id: "source-1",
      organizationId: "org-1",
      platform: "web",
      sourceType: "notification_inbox",
      query: "google-alerts-rss:scenario-1",
      collectionMode: "notification_inbox",
      status: "active",
      cadenceMinutes: 60,
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      lastError: null,
      settings: {
        managedBy: "google_alerts_rss",
        scenarioId: "scenario-1",
        googleAlertsRss: {
          configured: true,
          encryptedFeedUrl: encryptToken(feedUrl, "google-alerts-rss:org-1:scenario-1"),
          fingerprint: "test-fingerprint",
          accountSuffix: "1111",
          alertSuffix: "2222",
        },
      },
    }
    const ingest = vi.fn(async () => ({ id: "mention-1", created: true }))

    const result = await runGoogleAlertsRssCollector(source, {
      fetchImpl: vi.fn(async () => new Response(xml, {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      })) as unknown as typeof fetch,
      fetchArticle: vi.fn(async () => ({
        url: articleUrl,
        publisherName: "ANZ",
        publisherDomain: "anz.az",
        headline: "Market xəbərləri",
        description: "Yeni kampaniya elan edildi.",
        authorName: null,
        imageUrl: null,
        publishedAt: new Date("2026-07-30T22:00:00.000Z"),
        matchedCorpus: "Market xəbərləri\nYeni kampaniya elan edildi.\nANZ",
      })),
      ingest: ingest as never,
    })

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 1,
      ignoredCount: 0,
      rawStats: expect.objectContaining({
        matchedViaFeedSnippetCount: 1,
      }),
    })
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      matchedTerm: "Bravo Supermarket",
      text: expect.stringContaining("Bravo Supermarket kampaniyası"),
      observation: expect.objectContaining({
        rawPayload: expect.objectContaining({
          feedEntrySnippet: "Yeni Bravo Supermarket kampaniyası elan edildi.",
          matchedVia: "google_alerts_feed_snippet",
        }),
      }),
    }), expect.anything())
  })

  it("never lets a matching feed snippet bypass publisher article verification", async () => {
    const feedUrl = "https://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222"
    const articleUrl = "https://anz.az/bravo-supermarket-xeberi"
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Market xəbərləri</title>
        <summary>Bravo Supermarket kampaniyası</summary>
        <link href="${articleUrl}" rel="alternate"/>
        <updated>2026-07-30T23:12:00Z</updated>
      </entry>
    </feed>`
    const ingest = vi.fn()

    const result = await runGoogleAlertsRssCollector({
      id: "source-1",
      organizationId: "org-1",
      platform: "web",
      sourceType: "notification_inbox",
      query: "google-alerts-rss:scenario-1",
      collectionMode: "notification_inbox",
      status: "active",
      cadenceMinutes: 60,
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      lastError: null,
      settings: {
        managedBy: "google_alerts_rss",
        scenarioId: "scenario-1",
        googleAlertsRss: {
          configured: true,
          encryptedFeedUrl: encryptToken(feedUrl, "google-alerts-rss:org-1:scenario-1"),
          fingerprint: "test-fingerprint",
          accountSuffix: "1111",
          alertSuffix: "2222",
        },
      },
    }, {
      fetchImpl: vi.fn(async () => new Response(xml, {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      })) as unknown as typeof fetch,
      fetchArticle: vi.fn(async () => null),
      ingest: ingest as never,
    })

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 0,
      ignoredCount: 1,
      rawStats: expect.objectContaining({
        verifiedCount: 0,
        matchedViaFeedSnippetCount: 0,
      }),
    })
    expect(ingest).not.toHaveBeenCalled()
  })

  it("marks publisher fetch failures as partial instead of reporting a false success", async () => {
    const feedUrl = "https://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222"
    const articleUrl = "https://report.az/biznes-xeberleri/bravo-supermarket-yeni-magaza"
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Bravo Supermarket xəbəri</title>
        <link href="${articleUrl}" rel="alternate"/>
        <updated>2026-07-28T10:00:00Z</updated>
      </entry>
    </feed>`
    const source = {
      id: "source-1",
      organizationId: "org-1",
      platform: "web",
      sourceType: "notification_inbox",
      query: "google-alerts-rss:scenario-1",
      collectionMode: "notification_inbox",
      status: "active",
      cadenceMinutes: 60,
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      lastError: null,
      settings: {
        managedBy: "google_alerts_rss",
        scenarioId: "scenario-1",
        googleAlertsRss: {
          configured: true,
          encryptedFeedUrl: encryptToken(feedUrl, "google-alerts-rss:org-1:scenario-1"),
          fingerprint: "test-fingerprint",
          accountSuffix: "1111",
          alertSuffix: "2222",
        },
      },
    }

    const result = await runGoogleAlertsRssCollector(source, {
      fetchImpl: vi.fn(async () => new Response(xml, {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      })) as unknown as typeof fetch,
      fetchArticle: vi.fn(async () => {
        throw new Error("dns_timeout")
      }),
    })

    expect(result).toMatchObject({
      status: "partial",
      foundCount: 1,
      newCount: 0,
      ignoredCount: 1,
      error: "google_alerts_rss_partial_fetch",
      rawStats: expect.objectContaining({ articleFetchFailureCount: 1 }),
    })
  })

  it("never exposes the encrypted feed URL through monitoring-source responses", () => {
    const redacted = redactMonitoringSettingsForResponse({
      managedBy: "google_alerts_rss",
      googleAlertsRss: {
        configured: true,
        encryptedFeedUrl: "v1:secret-ciphertext",
        fingerprint: "private-fingerprint",
        alertSuffix: "2465",
      },
    })

    expect(redacted.googleAlertsRss).toEqual({
      configured: true,
      alertSuffix: "2465",
    })
  })
})
