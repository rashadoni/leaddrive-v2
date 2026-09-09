import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  mentionEvidence: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}))

const mockDeps = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  classifySentiment: vi.fn(),
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  getMonitoringScenarios: vi.fn(),
}))

const outboundMocks = vi.hoisted(() => ({
  request: vi.fn(),
  isSecurityError: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}))

vi.mock("@/lib/secure-token", () => ({
  decryptToken: mockDeps.decryptToken,
}))

vi.mock("@/lib/sentiment", () => ({
  classifySentiment: mockDeps.classifySentiment,
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: mockDeps.findMatchedKeyword,
  ingestMentionWithResult: mockDeps.ingestMentionWithResult,
}))

vi.mock("@/lib/social/monitoring-scenarios", () => ({
  getMonitoringScenarios: mockDeps.getMonitoringScenarios,
}))

vi.mock("@/lib/social/social-outbound-http", () => ({
  requestSocialOutboundJson: outboundMocks.request,
  isSocialOutboundSecurityError: outboundMocks.isSecurityError,
}))

import { runSearchIndexCollector } from "@/lib/social/search-index-adapter"
import { prisma } from "@/lib/prisma"
import { ingestMentionWithResult } from "@/lib/social/ingest-mention"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const source: MonitoringSourceForRun = {
  id: "source-search",
  organizationId: "org-1",
  platform: "web",
  sourceType: "keyword",
  collectionMode: "search_index",
  status: "active",
  cadenceMinutes: 360,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  keywords: ["LeadDrive"],
  query: "LeadDrive CRM",
  settings: {
    searchIndex: {
      approved: true,
      endpoint: "https://search.example.com/v1/query",
      domain: "instagram.com",
      limit: 5,
    },
  },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"))
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.stubEnv("SOCIAL_SEARCH_INDEX_ALLOWED_HOSTS", "search.example.com")
  outboundMocks.isSecurityError.mockReturnValue(false)
  outboundMocks.request.mockImplementation(async (url: string, options: { headers?: Record<string, string> }) => {
    const response = await fetch(url, {
      headers: options.headers,
      signal: new AbortController().signal,
    })
    return {
      ok: response.ok,
      status: response.status,
      payload: await response.json().catch(() => null),
      finalUrl: url,
      redirects: 0,
    }
  })
  vi.mocked(prisma.mentionEvidence.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mentionEvidence.create).mockResolvedValue({ id: "evidence-1" } as never)
  mockDeps.decryptToken.mockReturnValue("search-token")
  mockDeps.classifySentiment.mockResolvedValue("neutral")
  mockDeps.getMonitoringScenarios.mockResolvedValue([])
  mockDeps.findMatchedKeyword.mockImplementation((text: string, keywords: string[] | null | undefined) => {
    const lower = text.toLowerCase()
    for (const keyword of keywords ?? []) {
      const trimmed = keyword.trim()
      if (trimmed && lower.includes(trimmed.toLowerCase())) return trimmed
    }
    return null
  })
  mockDeps.ingestMentionWithResult.mockResolvedValue({ id: "mention-1", created: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("search-index social monitoring adapter", () => {
  it("enforces strict cadence and endpoint allowlist before fetching", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runSearchIndexCollector({ ...source, cadenceMinutes: 60 })).resolves.toMatchObject({
      status: "skipped",
      error: "search_index_cadence_too_fast",
    })

    await expect(runSearchIndexCollector({ ...source, settings: { searchIndex: { approved: true, endpoint: "https://other.example.com/search" } } })).resolves.toMatchObject({
      status: "skipped",
      error: "search_index_host_not_allowed",
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not fetch or ingest external page streams when no keyword or hashtag is configured", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await runSearchIndexCollector({
      ...source,
      platform: "instagram",
      sourceType: "search_url",
      query: null,
      handle: null,
      keywords: [],
      url: "https://www.instagram.com/patrulaz.az",
      settings: {
        searchIndex: {
          approved: true,
          provider: "generic",
          endpoint: "https://search.example.com/v1/query",
        },
      },
    })

    expect(result).toMatchObject({
      status: "success",
      foundCount: 0,
      newCount: 0,
      ignoredCount: 0,
      rawStats: expect.objectContaining({
        requiredMatchTerms: [],
        skippedReason: "search_index_terms_missing",
      }),
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("uses active monitoring scenario terms for external URL sources instead of source keywords", async () => {
    mockDeps.getMonitoringScenarios.mockResolvedValue([
      {
        id: "scenario-weather",
        name: "Weather watch",
        description: null,
        status: "active",
        platforms: ["instagram", "facebook"],
        search: {
          topics: ["hava"],
          keywords: [],
          hashtags: ["yagis"],
          handles: [],
          urls: [],
          useHashtagFallback: true,
          includeOwnedComments: true,
        },
        ai: {
          sentiments: ["negative"],
          minConfidence: 80,
          action: "draft_reply",
        },
        reply: {
          identityId: null,
          identityLabel: null,
          mode: "manual_approval",
          autoReplyEnabled: false,
          liveSendAllowed: false,
        },
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z",
      },
    ])
    const fetchMock = vi.fn(async () => jsonResponse([
      {
        url: "https://www.instagram.com/p/noise",
        caption: "arzum 9999 source-level keyword should not drive scenario search.",
        ownerUsername: "patrulaz.az",
        timestamp: "2026-07-05T11:00:00.000Z",
        platform: "instagram",
      },
      {
        url: "https://www.instagram.com/p/weather",
        caption: "Bugun hava haqqinda xeber var.",
        ownerUsername: "patrulaz.az",
        timestamp: "2026-07-05T11:20:00.000Z",
        platform: "instagram",
      },
    ]))
    vi.stubGlobal("fetch", fetchMock)

    const result = await runSearchIndexCollector({
      ...source,
      platform: "instagram",
      sourceType: "search_url",
      query: null,
      handle: null,
      keywords: ["arzum"],
      url: "https://www.instagram.com/patrulaz.az/",
      settings: {
        searchIndex: {
          approved: true,
          provider: "generic",
          endpoint: "https://search.example.com/v1/query",
          encryptedToken: "ciphertext",
          tokenPurpose: "social-search-index:org-1",
          limit: 8,
        },
      },
    })

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      ignoredCount: 1,
      rawStats: expect.objectContaining({
        requiredMatchTerms: ["hava", "yagis"],
        matchTermSource: "scenario",
        scenarioIds: ["scenario-weather"],
        scenarioNames: ["Weather watch"],
      }),
    })
    expect(ingestMentionWithResult).toHaveBeenCalledTimes(1)
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "search:https://www.instagram.com/p/weather",
      matchedTerm: "hava",
    }))
  })

  it("ignores indexed items that do not match the configured keyword terms", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      results: [
        {
          title: "Traffic news",
          snippet: "No configured brand term in this public post.",
          url: "https://instagram.com/p/no-match",
        },
      ],
    })))

    const result = await runSearchIndexCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 0,
      newCount: 0,
      ignoredCount: 1,
      error: null,
      rawStats: expect.objectContaining({
        requiredMatchTerms: ["LeadDrive CRM", "LeadDrive"],
      }),
    })
    expect(ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("normalizes indexed snippets into mention evidence with partial coverage metadata", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input
      return jsonResponse({
        results: [
          {
            title: "LeadDrive CRM review",
            snippet: "Public indexed mention about LeadDrive.",
            url: "https://instagram.com/p/indexed",
            sourceName: "Instagram",
            publishedAt: "2026-07-05T09:00:00.000Z",
            confidence: 0.7,
          },
          { title: "No URL", snippet: "ignored" },
        ],
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runSearchIndexCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 1,
      ignoredCount: 1,
      error: null,
    })
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0] ?? "")
    expect(requestedUrl).toContain("q=LeadDrive+CRM")
    expect(requestedUrl).toContain("site=instagram.com")
    expect(requestedUrl).toContain("since=2026-07-04T12%3A00%3A00.000Z")
    expect(requestedUrl).toContain("until=2026-07-05T12%3A00%3A00.000Z")
    expect(outboundMocks.request).toHaveBeenCalledWith(
      expect.stringContaining("https://search.example.com/v1/query"),
      expect.objectContaining({
        method: "GET",
        allowedHosts: ["search.example.com"],
      }),
    )
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      platform: "web",
      externalId: "search:https://instagram.com/p/indexed",
      sourceProvider: "search_index",
      sourceMetadata: expect.objectContaining({
        monitoringSourceId: "source-search",
        collector: "search_index",
        partialCoverage: true,
      }),
      matchedTerm: "LeadDrive CRM",
    }))
    expect(prisma.mentionEvidence.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mentionId: "mention-1",
        sourceId: "source-search",
        permalink: "https://instagram.com/p/indexed",
        sourceTrustTier: "T3",
        confidence: 0.7,
      }),
    }))
  })

  it("does not copy an arbitrary upstream error body into collector rawStats", async () => {
    outboundMocks.request.mockResolvedValueOnce({
      ok: false,
      status: 500,
      payload: { secret: "search-provider-stack" },
      finalUrl: "https://search.example.com/v1/query",
      redirects: 0,
    })

    const result = await runSearchIndexCollector(source)

    expect(result).toMatchObject({
      status: "failed",
      error: "search_index_fetch_failed",
      rawStats: expect.objectContaining({ status: 500, outboundSafeTransport: true }),
    })
    expect(JSON.stringify(result)).not.toContain("search-provider-stack")
  })

  it("fails closed when the pinned transport blocks a DNS or redirect target", async () => {
    const blocked = Object.assign(new Error("blocked"), { socialSecurity: true })
    outboundMocks.request.mockRejectedValueOnce(blocked)
    outboundMocks.isSecurityError.mockImplementationOnce(error => error === blocked)

    const result = await runSearchIndexCollector(source)

    expect(result).toMatchObject({ status: "skipped", error: "search_index_outbound_blocked" })
    expect(ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("keeps only dated keyword matches inside the configured lookback window", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      results: [
        {
          title: "Fresh LeadDrive CRM mention",
          snippet: "LeadDrive appeared in a recent public post.",
          url: "https://instagram.com/p/fresh",
          publishedAt: "2026-07-05T11:00:00.000Z",
        },
        {
          title: "Old LeadDrive CRM mention",
          snippet: "LeadDrive appeared before the 24 hour window.",
          url: "https://instagram.com/p/old",
          publishedAt: "2026-07-03T11:00:00.000Z",
        },
        {
          title: "Undated LeadDrive CRM mention",
          snippet: "LeadDrive has no reliable timestamp.",
          url: "https://instagram.com/p/no-date",
        },
        {
          title: "Fresh unrelated mention",
          snippet: "This post is recent but does not match configured terms.",
          url: "https://instagram.com/p/no-keyword",
          publishedAt: "2026-07-05T10:30:00.000Z",
        },
      ],
    }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await runSearchIndexCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 1,
      ignoredCount: 3,
      rawStats: expect.objectContaining({
        lookbackHours: 24,
        since: "2026-07-04T12:00:00.000Z",
        until: "2026-07-05T12:00:00.000Z",
        limit: 5,
        receivedCount: 4,
        ignoredMissingPublishedAtCount: 1,
        ignoredOutOfWindowCount: 1,
      }),
    })
    expect(ingestMentionWithResult).toHaveBeenCalledTimes(1)
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "search:https://instagram.com/p/fresh",
      matchedTerm: "LeadDrive CRM",
    }))
  })

  it("derives a search query from an external Instagram profile URL when no handle is stored", async () => {
    const fetchCalls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return jsonResponse({ results: [] })
    })
    vi.stubGlobal("fetch", fetchMock)

    await runSearchIndexCollector({
      ...source,
      platform: "instagram",
      sourceType: "page",
      query: null,
      handle: null,
      keywords: ["patrulaz"],
      url: "https://www.instagram.com/patrulaz.az",
      settings: {
        searchIndex: {
          approved: true,
          endpoint: "https://search.example.com/v1/query",
          domain: "instagram.com",
          limit: 5,
        },
      },
    })

    const requestedUrl = new URL(fetchCalls[0] ?? "")
    expect(requestedUrl.searchParams.get("q")).toBe("@patrulaz.az")
    expect(requestedUrl.searchParams.get("site")).toBe("instagram.com")
  })

  it("uses global search-index configuration so new sources do not need per-source endpoint settings", async () => {
    vi.stubEnv("SOCIAL_SEARCH_INDEX_ENABLED", "1")
    vi.stubEnv("SOCIAL_SEARCH_INDEX_ENDPOINT", "https://search.example.com/v1/query")
    vi.stubEnv("SOCIAL_SEARCH_INDEX_LIMIT", "7")
    const fetchCalls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return jsonResponse({ results: [] })
    })
    vi.stubGlobal("fetch", fetchMock)

    await runSearchIndexCollector({
      ...source,
      sourceType: "page",
      query: null,
      handle: null,
      keywords: ["patrulaz"],
      url: "https://www.instagram.com/patrulaz.az",
      settings: {
        searchIndex: {
          domain: "instagram.com",
        },
      },
    })

    const requestedUrl = new URL(fetchCalls[0] ?? "")
    expect(requestedUrl.origin + requestedUrl.pathname).toBe("https://search.example.com/v1/query")
    expect(requestedUrl.searchParams.get("q")).toBe("@patrulaz.az")
    expect(requestedUrl.searchParams.get("limit")).toBe("7")
  })

  it("uses UI-saved search-index allowlist and encrypted token without server env", async () => {
    const fetchCalls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return jsonResponse({ results: [] })
    })
    vi.stubGlobal("fetch", fetchMock)

    await runSearchIndexCollector({
      ...source,
      settings: {
        searchIndex: {
          approved: true,
          endpoint: "https://search.example.com/v1/query",
          allowedHosts: ["search.example.com"],
          encryptedToken: "ciphertext",
          tokenPurpose: "social-search-index:org-1",
        },
      },
    })

    expect(mockDeps.decryptToken).toHaveBeenCalledWith("ciphertext", "social-search-index:org-1")
    expect(fetchCalls[0]).toContain("https://search.example.com/v1/query")
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      headers: { accept: "application/json", authorization: "Bearer search-token" },
      signal: expect.any(AbortSignal),
    })
  })

  it("ignores legacy tokenEnv even when it points at NEXTAUTH_SECRET", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "session-secret-must-not-be-forwarded")
    outboundMocks.request.mockResolvedValueOnce({
      ok: true,
      status: 200,
      payload: { results: [] },
      finalUrl: "https://search.example.com/v1/query",
      redirects: 0,
    })

    const result = await runSearchIndexCollector({
      ...source,
      settings: {
        searchIndex: {
          approved: true,
          endpoint: "https://search.example.com/v1/query",
          tokenEnv: "NEXTAUTH_SECRET",
        },
      },
    })

    const requestOptions = outboundMocks.request.mock.calls[0]?.[1] as {
      headers?: Record<string, string>
    }
    expect(result).toMatchObject({ status: "success" })
    expect(mockDeps.decryptToken).not.toHaveBeenCalled()
    expect(requestOptions.headers).toEqual({ accept: "application/json" })
    expect(requestOptions.headers).not.toHaveProperty("authorization")
    expect(JSON.stringify(result)).not.toContain("session-secret-must-not-be-forwarded")
  })

  it("requires the asynchronous route for Apify and never performs a synchronous fetch", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await runSearchIndexCollector({
      ...source,
      platform: "instagram",
      settings: { searchIndex: { approved: true, provider: "apify", encryptedToken: "ciphertext" } },
    })

    expect(result).toMatchObject({
      status: "skipped",
      error: "apify_async_route_required",
      rawStats: { provider: "apify", synchronousExecutionDisabled: true },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("marks malformed search payloads as failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })))

    await expect(runSearchIndexCollector(source)).resolves.toMatchObject({
      status: "failed",
      error: "search_index_payload_invalid",
    })
  })
})
