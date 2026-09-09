import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  socialAccount: { findMany: vi.fn() },
  socialProviderCapabilityProof: { findMany: vi.fn() },
  sourceRoutePlan: {
    updateMany: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  monitoringSource: { findMany: vi.fn() },
  organization: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))

const settings = vi.hoisted(() => ({
  searchIndex: {
    enabled: true,
    provider: "apify" as const,
    endpoint: null,
    allowedHosts: [],
    limit: 100,
    includeComments: true,
    encryptedToken: "encrypted",
    hasToken: true,
    apifyActors: {
      webSearch: "apify/google-search-scraper",
      instagramProfile: "apify/instagram-scraper",
      instagramHashtag: "apify/instagram-hashtag-scraper",
      facebookSearch: "scrapeforge/facebook-search-posts",
      facebookPosts: "apify/facebook-posts-scraper",
      tiktokSearch: "clockworks/tiktok-scraper",
      instagramComments: "apify/instagram-comment-scraper",
      facebookComments: "apify/facebook-comments-scraper",
      tiktokComments: "clockworks/tiktok-comments-scraper",
    },
  },
  provider: { allowedHosts: [], replyAllowedHosts: [] },
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/social/monitoring-settings", () => ({
  getSocialMonitoringSettings: vi.fn(async () => settings),
  mergeMonitoringSettingsIntoSourceSettings: (sourceSettings: unknown) => sourceSettings,
}))

import {
  ROUTE_ADAPTERS,
  compileSourceRoutePlans,
  enforceBrightDataOnlyPolicy,
  instagramBusinessDiscoveryUsername,
  recordSourceRouteResult,
  selectedAdapterForPlan,
} from "@/lib/social/source-route-plan"

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: "source-1",
    organizationId: "org-1",
    platform: "instagram",
    sourceType: "page",
    ownership: "external",
    collectionMode: "search_index",
    cadenceMinutes: 360,
    url: "https://instagram.com/brand",
    handle: "brand",
    query: "brand",
    settings: { searchIndex: { includeComments: true } },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  settings.searchIndex.hasToken = true
  mockPrisma.socialAccount.findMany.mockResolvedValue([])
  mockPrisma.socialProviderCapabilityProof.findMany.mockResolvedValue([])
  mockPrisma.organization.findUnique.mockResolvedValue({ settings: {} })
  mockPrisma.sourceRoutePlan.updateMany.mockResolvedValue({ count: 1 })
  let sequence = 0
  mockPrisma.sourceRoutePlan.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({ id: `route-${++sequence}`, ...args.create }))
  mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma))
})

describe("deterministic social source route compiler", () => {
  it("routes an external YouTube keyword source through the official Data API when an API key is configured", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "youtube-api-key")

    const plans = await compileSourceRoutePlans(source({
      platform: "youtube",
      sourceType: "keyword",
      ownership: "external",
      collectionMode: "official_api",
      cadenceMinutes: 1440,
      url: null,
      handle: null,
      query: "bravo supermarket",
      settings: {
        selectiveDiscovery: {
          contractVersion: "youtube-selective-query-pack-v1",
          candidateOnly: true,
          commentsRequireMatched: true,
        },
      },
    }))

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      capability: "READ_EXTERNAL_COMMENTS",
      primaryAdapter: ROUTE_ADAPTERS.YOUTUBE_DATA_API,
      fallbackAdapters: [ROUTE_ADAPTERS.MANUAL_TASK],
      acquisitionMode: "OFFICIAL_API",
      connectionAccountId: null,
      capabilityProofId: null,
      status: "ACTIVE",
    })
  })

  it.each(["facebook", "instagram", "tiktok"])(
    "routes %s discovery and external comments through pinned Apify actors",
    async (platform) => {
      const plans = await compileSourceRoutePlans(source({
        platform,
        ownership: platform === "facebook" ? "unknown" : "external",
        url: `https://${platform}.com/brand`,
      }))

      expect(plans).toHaveLength(2)
      expect(plans).toEqual(expect.arrayContaining([
        expect.objectContaining({ capability: "DISCOVER_POSTS", primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC, acquisitionMode: "APIFY_FALLBACK", status: "ACTIVE" }),
        expect.objectContaining({ capability: "READ_EXTERNAL_COMMENTS", primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC, acquisitionMode: "APIFY_FALLBACK", dependsOnCapability: "DISCOVER_POSTS", status: "ACTIVE" }),
      ]))
    },
  )

  // Решение владельца 2026-08-01: WEB покрывается только лентой Google Alerts.
  // Любая другая web-строка обязана фейлиться закрыто прямо в компиляторе —
  // именно этот гейт останавливает уже созданные на проде строки, которые
  // крон отбирает по статусу, ничего не зная о плане сценария.
  it("фейлит закрыто web-обнаружение без ленты Google Alerts", async () => {
    const plans = await compileSourceRoutePlans(source({
      platform: "web",
      sourceType: "keyword",
      url: null,
      handle: null,
      query: "bravo supermarket",
      settings: { searchIndex: { includeComments: false } },
    }))

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      capability: "DISCOVER_POSTS",
      primaryAdapter: ROUTE_ADAPTERS.MANUAL_TASK,
      fallbackAdapters: [],
      acquisitionMode: "MANUAL_URL",
      status: "BLOCKED",
    })
    expect(plans[0].primaryAdapter).not.toBe(ROUTE_ADAPTERS.AZERBAIJAN_NEWS_DIRECT)
    expect(plans[0].fallbackAdapters).not.toContain(ROUTE_ADAPTERS.AZERBAIJAN_NEWS_DIRECT)
  })

  it("не включает прямой обход изданий даже при доступном Apify", async () => {
    settings.searchIndex.hasToken = true

    const plans = await compileSourceRoutePlans(source({
      platform: "web",
      sourceType: "keyword",
      url: null,
      handle: null,
      query: "bravo supermarket",
      settings: { searchIndex: { includeComments: false } },
    }))

    expect(plans[0]).toMatchObject({ status: "BLOCKED", primaryAdapter: ROUTE_ADAPTERS.MANUAL_TASK })
  })

  it("routes a scenario-bound Google Alerts feed through the free RSS adapter only", async () => {
    const plans = await compileSourceRoutePlans(source({
      platform: "web",
      sourceType: "notification_inbox",
      collectionMode: "notification_inbox",
      url: null,
      handle: null,
      query: "google-alerts-rss:scenario-1",
      settings: {
        managedBy: "google_alerts_rss",
        scenarioId: "scenario-1",
        googleAlertsRss: { configured: true, encryptedFeedUrl: "v1:ciphertext" },
      },
    }))

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      capability: "DISCOVER_POSTS",
      primaryAdapter: ROUTE_ADAPTERS.GOOGLE_ALERTS_RSS,
      fallbackAdapters: [ROUTE_ADAPTERS.MANUAL_TASK],
      acquisitionMode: "NEWS_INDEX",
      status: "ACTIVE",
    })
  })

  it("lets a source explicitly opt out of the tenant comment default", async () => {
    const plans = await compileSourceRoutePlans(source({ settings: { searchIndex: { includeComments: false } } }))

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ capability: "DISCOVER_POSTS" })
  })

  it("never assigns a scraper fallback to X without official or licensed access", async () => {
    const plans = await compileSourceRoutePlans(source({
      platform: "twitter",
      url: "https://x.com/search?q=brand",
      settings: { searchIndex: { includeComments: false } },
    }))

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      primaryAdapter: ROUTE_ADAPTERS.MANUAL_TASK,
      fallbackAdapters: [],
      status: "BLOCKED",
      reason: expect.stringContaining("X requires official or licensed search access"),
    })
  })

  it("does not mistake a connected Meta account for access to arbitrary external-page comments", async () => {
    mockPrisma.socialAccount.findMany.mockResolvedValue([{ id: "acc-meta", platform: "instagram", isActive: true, accessToken: "encrypted" }])
    const plans = await compileSourceRoutePlans(source({
      collectionMode: "official_api",
      settings: { socialAccountId: "acc-meta", searchIndex: { includeComments: true } },
    }))

    expect(plans[0]).toMatchObject({
      capability: "READ_EXTERNAL_COMMENTS",
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      acquisitionMode: "APIFY_FALLBACK",
      connectionAccountId: "acc-meta",
      status: "ACTIVE",
    })
  })

  it("uses Apify for global Facebook keywords even when a Meta account is connected", async () => {
    mockPrisma.socialAccount.findMany.mockResolvedValue([{
      id: "acc-meta",
      platform: "facebook",
      isActive: true,
      accessToken: "encrypted",
    }])
    mockPrisma.socialProviderCapabilityProof.findMany.mockResolvedValue([{
      id: "proof-bright",
      providerKey: "bright-data",
      adapterKey: ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT,
      platform: "facebook",
      capability: "DISCOVER_POSTS",
      contentScopes: ["PUBLIC"],
      contractVersion: "social-provider-capabilities-v1",
      policyVersion: "social-monitoring-v2-pr2",
      readAllowed: true,
      replyAllowed: false,
      aiProcessingAllowed: true,
      exportAllowed: true,
      retentionDays: 30,
      status: "VERIFIED",
      verifiedAt: new Date("2026-07-28T00:00:00Z"),
      sandboxVerifiedAt: null,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    }])
    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_ROUTING", "1")

    const plans = await compileSourceRoutePlans(source({
      platform: "facebook",
      sourceType: "keyword",
      collectionMode: "official_api",
      url: "https://facebook.com/search/posts?q=brand",
      settings: { socialAccountId: "acc-meta", searchIndex: { includeComments: false } },
    }))

    expect(plans[0]).toMatchObject({
      capability: "DISCOVER_POSTS",
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      fallbackAdapters: [ROUTE_ADAPTERS.MANUAL_TASK],
      acquisitionMode: "APIFY_FALLBACK",
      status: "ACTIVE",
    })
  })

  it("uses Apify for global Instagram keywords while preserving Meta for eligible profiles", async () => {
    mockPrisma.socialAccount.findMany.mockResolvedValue([{
      id: "acc-meta",
      platform: "instagram",
      isActive: true,
      accessToken: "encrypted",
    }])

    const plans = await compileSourceRoutePlans(source({
      platform: "instagram",
      sourceType: "keyword",
      collectionMode: "official_api",
      url: null,
      handle: null,
      query: "brand",
      settings: { socialAccountId: "acc-meta", searchIndex: { includeComments: false } },
    }))

    expect(plans[0]).toMatchObject({
      capability: "DISCOVER_POSTS",
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      fallbackAdapters: [ROUTE_ADAPTERS.MANUAL_TASK],
      acquisitionMode: "APIFY_FALLBACK",
      connectionAccountId: "acc-meta",
      status: "ACTIVE",
    })
  })

  it("never treats a Meta proof as global search and can fall back to verified Bright Data when Apify is unavailable", async () => {
    settings.searchIndex.hasToken = false
    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_ROUTING", "1")
    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_TENANT_IDS", "org-1")
    mockPrisma.socialProviderCapabilityProof.findMany.mockResolvedValue([
      {
        id: "proof-meta",
        providerKey: "meta",
        adapterKey: ROUTE_ADAPTERS.META_GRAPH,
        platform: "facebook",
        capability: "DISCOVER_POSTS",
        contentScopes: ["PUBLIC"],
        contractVersion: "meta-business-discovery-v1",
        policyVersion: "social-monitoring-v2-pr2",
        readAllowed: true,
        replyAllowed: false,
        aiProcessingAllowed: true,
        exportAllowed: true,
        retentionDays: 30,
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-28T00:00:00Z"),
        sandboxVerifiedAt: new Date("2026-07-28T00:00:00Z"),
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      },
      {
        id: "proof-bright",
        providerKey: "bright-data",
        adapterKey: ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT,
        platform: "facebook",
        capability: "DISCOVER_POSTS",
        contentScopes: ["PUBLIC"],
        contractVersion: "social-provider-capabilities-v1",
        policyVersion: "social-monitoring-v2-pr2",
        readAllowed: true,
        replyAllowed: false,
        aiProcessingAllowed: true,
        exportAllowed: true,
        retentionDays: 30,
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-27T00:00:00Z"),
        sandboxVerifiedAt: null,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      },
    ])

    const plans = await compileSourceRoutePlans(source({
      platform: "facebook",
      sourceType: "keyword",
      ownership: "unknown",
      collectionMode: "official_api",
      query: "brand",
      url: null,
      settings: { searchIndex: { includeComments: false } },
    }))

    expect(plans[0]).toMatchObject({
      capability: "DISCOVER_POSTS",
      primaryAdapter: ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT,
      capabilityProofId: "proof-bright",
      acquisitionMode: "LICENSED_PROVIDER",
      status: "ACTIVE",
    })
  })

  it("models official X recent search as discovery rather than comment access", async () => {
    mockPrisma.socialAccount.findMany.mockResolvedValue([{ id: "acc-x", platform: "twitter", isActive: true, accessToken: "encrypted" }])
    const plans = await compileSourceRoutePlans(source({
      platform: "twitter",
      collectionMode: "official_api",
      settings: { socialAccountId: "acc-x" },
    }))

    expect(plans[0]).toMatchObject({ capability: "DISCOVER_POSTS", primaryAdapter: ROUTE_ADAPTERS.X_API, status: "ACTIVE" })
  })

  it("marks USD limits configured only when the owner supplied all three values", async () => {
    mockPrisma.socialAccount.findMany.mockResolvedValue([{ id: "acc-x", platform: "twitter", isActive: true, accessToken: "encrypted" }])

    const withoutOwnerPricing = await compileSourceRoutePlans(source({
      platform: "twitter",
      collectionMode: "official_api",
      settings: { socialAccountId: "acc-x" },
    }))
    expect(withoutOwnerPricing[0].budget).toMatchObject({ usdLimitsConfigured: false })

    const configured = await compileSourceRoutePlans(source({
      platform: "twitter",
      collectionMode: "official_api",
      settings: {
        socialAccountId: "acc-x",
        budget: { maxTotalChargeUsd: 0.25, dailyBudgetUsd: 2, monthlyBudgetUsd: 20 },
      },
    }))
    expect(configured[0].budget).toMatchObject({
      maxTotalChargeUsd: 0.25,
      dailyBudgetUsd: 2,
      monthlyBudgetUsd: 20,
      usdLimitsConfigured: true,
    })
  })

  it("applies the tenant-wide route-budget default when the source has no explicit budget", async () => {
    mockPrisma.socialAccount.findMany.mockResolvedValue([{ id: "acc-x", platform: "twitter", isActive: true, accessToken: "encrypted" }])
    mockPrisma.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          routeDefaults: { maxTotalChargeUsd: 0.5, dailyBudgetUsd: 10, monthlyBudgetUsd: 100 },
        },
      },
    })

    const plans = await compileSourceRoutePlans(source({
      platform: "twitter",
      collectionMode: "official_api",
      settings: { socialAccountId: "acc-x" },
    }))
    expect(plans[0].budget).toMatchObject({
      maxTotalChargeUsd: 0.5,
      dailyBudgetUsd: 10,
      monthlyBudgetUsd: 100,
      usdLimitsConfigured: true,
    })

    // An explicit per-source budget still wins over the tenant default.
    const explicit = await compileSourceRoutePlans(source({
      platform: "twitter",
      collectionMode: "official_api",
      settings: {
        socialAccountId: "acc-x",
        budget: { maxTotalChargeUsd: 0.25, dailyBudgetUsd: 2, monthlyBudgetUsd: 20 },
      },
    }))
    expect(explicit[0].budget).toMatchObject({ maxTotalChargeUsd: 0.25, dailyBudgetUsd: 2, monthlyBudgetUsd: 20 })
  })

  it("persists a bounded owner circuit TTL override in each route", async () => {
    const plans = await compileSourceRoutePlans(source({
      settings: {
        circuitBreaker: { cooldownSeconds: 42 },
        searchIndex: { includeComments: false },
      },
    }))
    expect(plans[0].rateLimit).toMatchObject({
      maxRequestsPerMinute: 30,
      circuitCooldownSeconds: 42,
    })

    const clamped = await compileSourceRoutePlans(source({
      settings: {
        circuitBreaker: { cooldownSeconds: 99_999 },
        searchIndex: { includeComments: false },
      },
    }))
    expect(clamped[0].rateLimit).toMatchObject({ circuitCooldownSeconds: 21_600 })
  })

  it("persists a bounded failback overlap window in each route", async () => {
    const plans = await compileSourceRoutePlans(source({
      settings: {
        circuitBreaker: { failbackOverlapMinutes: 180 },
        searchIndex: { includeComments: false },
      },
    }))
    expect(plans[0].rateLimit).toMatchObject({ failbackOverlapMinutes: 180 })

    const clamped = await compileSourceRoutePlans(source({
      settings: {
        circuitBreaker: { failbackOverlapMinutes: 99_999 },
        searchIndex: { includeComments: false },
      },
    }))
    expect(clamped[0].rateLimit).toMatchObject({ failbackOverlapMinutes: 1_440 })
  })

  it("requires a verified proof before enabling TikTok Business comments", async () => {
    mockPrisma.socialAccount.findMany.mockResolvedValue([{ id: "acc-1", platform: "tiktok", isActive: true, accessToken: "encrypted" }])
    const withoutProof = await compileSourceRoutePlans(source({
      platform: "tiktok",
      ownership: "owned",
      collectionMode: "official_api",
      settings: { socialAccountId: "acc-1" },
    }))
    expect(withoutProof[0]).toMatchObject({ status: "BLOCKED", primaryAdapter: ROUTE_ADAPTERS.MANUAL_TASK })

    mockPrisma.socialProviderCapabilityProof.findMany.mockResolvedValue([{
      id: "proof-1",
      providerKey: "TIKTOK",
      adapterKey: ROUTE_ADAPTERS.TIKTOK_BUSINESS_API,
      platform: "tiktok",
      capability: "READ_OWNED_COMMENTS",
      contentScopes: ["OWNED"],
      contractVersion: "2026-03",
      policyVersion: "social-monitoring-v2-pr2",
      readAllowed: true,
      replyAllowed: false,
      aiProcessingAllowed: true,
      exportAllowed: true,
      retentionDays: 30,
      status: "VERIFIED",
      verifiedAt: new Date("2026-07-01T00:00:00Z"),
      sandboxVerifiedAt: null,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    }])
    const withProof = await compileSourceRoutePlans(source({
      platform: "tiktok",
      ownership: "owned",
      collectionMode: "official_api",
      settings: { socialAccountId: "acc-1" },
    }))
    expect(withProof[0]).toMatchObject({
      status: "ACTIVE",
      primaryAdapter: ROUTE_ADAPTERS.TIKTOK_BUSINESS_API,
      capabilityProofId: "proof-1",
      connectionAccountId: "acc-1",
    })
  })

  it("preserves a verified Bright Data route but selects it only when Apify is unavailable", async () => {
    mockPrisma.socialProviderCapabilityProof.findMany.mockResolvedValue([{
      id: "proof-bright",
      providerKey: "bright-data",
      adapterKey: ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT,
      platform: "instagram",
      capability: "DISCOVER_POSTS",
      contentScopes: ["PUBLIC"],
      contractVersion: "social-provider-capabilities-v1",
      policyVersion: "social-monitoring-v2-pr2",
      readAllowed: true,
      replyAllowed: false,
      aiProcessingAllowed: true,
      exportAllowed: true,
      retentionDays: 30,
      status: "VERIFIED",
      verifiedAt: new Date("2026-07-14T00:00:00Z"),
      sandboxVerifiedAt: null,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    }])

    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_ROUTING", "1")
    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_TENANT_IDS", "org-1")
    const apifyEnabledPlan = await compileSourceRoutePlans(source({ settings: { searchIndex: { includeComments: false } } }))
    expect(apifyEnabledPlan[0]).toMatchObject({
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      fallbackAdapters: [ROUTE_ADAPTERS.MANUAL_TASK],
      capabilityProofId: null,
      acquisitionMode: "APIFY_FALLBACK",
      status: "ACTIVE",
    })

    settings.searchIndex.hasToken = false
    const brightDataPlan = await compileSourceRoutePlans(source({ settings: { searchIndex: { includeComments: false } } }))
    expect(brightDataPlan[0]).toMatchObject({
      primaryAdapter: ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT,
      fallbackAdapters: [ROUTE_ADAPTERS.MANUAL_TASK],
      capabilityProofId: "proof-bright",
      acquisitionMode: "LICENSED_PROVIDER",
      status: "ACTIVE",
    })
  })

  it("ignores a persisted Apify proof when credentials are unavailable", async () => {
    settings.searchIndex.hasToken = false
    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_ROUTING", "1")
    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_TENANT_IDS", "org-1")
    mockPrisma.socialProviderCapabilityProof.findMany.mockResolvedValue([
      {
        id: "proof-apify",
        providerKey: "apify",
        adapterKey: ROUTE_ADAPTERS.APIFY_ASYNC,
        platform: "facebook",
        capability: "DISCOVER_POSTS",
        contentScopes: ["PUBLIC"],
        contractVersion: "social-provider-capabilities-v1",
        policyVersion: "social-monitoring-v2-pr2",
        readAllowed: true,
        replyAllowed: false,
        aiProcessingAllowed: true,
        exportAllowed: true,
        retentionDays: 30,
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-28T00:00:00Z"),
        sandboxVerifiedAt: null,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      },
      {
        id: "proof-bright",
        providerKey: "bright-data",
        adapterKey: ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT,
        platform: "facebook",
        capability: "DISCOVER_POSTS",
        contentScopes: ["PUBLIC"],
        contractVersion: "social-provider-capabilities-v1",
        policyVersion: "social-monitoring-v2-pr2",
        readAllowed: true,
        replyAllowed: false,
        aiProcessingAllowed: true,
        exportAllowed: true,
        retentionDays: 30,
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-27T00:00:00Z"),
        sandboxVerifiedAt: null,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      },
    ])

    const plans = await compileSourceRoutePlans(source({
      platform: "facebook",
      sourceType: "keyword",
      ownership: "unknown",
      collectionMode: "official_api",
      query: "brand",
      url: null,
      settings: { searchIndex: { includeComments: false } },
    }))

    expect(plans[0]).toMatchObject({
      primaryAdapter: ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT,
      capabilityProofId: "proof-bright",
      acquisitionMode: "LICENSED_PROVIDER",
      status: "ACTIVE",
    })
  })

  it("routes selective TikTok discovery and scoped comments through Apify", async () => {
    mockPrisma.socialProviderCapabilityProof.findMany.mockResolvedValue([
      "DISCOVER_POSTS",
      "READ_EXTERNAL_COMMENTS",
    ].map((capability, index) => ({
      id: `legacy-apify-${index}`,
      providerKey: "apify",
      adapterKey: ROUTE_ADAPTERS.APIFY_ASYNC,
      platform: "tiktok",
      capability,
      contentScopes: ["PUBLIC"],
      contractVersion: "social-provider-capabilities-v1",
      policyVersion: "social-monitoring-v2-pr2",
      readAllowed: true,
      replyAllowed: false,
      aiProcessingAllowed: true,
      exportAllowed: true,
      retentionDays: 30,
      status: "VERIFIED",
      verifiedAt: new Date("2026-07-14T00:00:00Z"),
      sandboxVerifiedAt: null,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    })))

    const plans = await compileSourceRoutePlans(source({
      platform: "tiktok",
      url: "https://www.tiktok.com/@brand",
      settings: { searchIndex: { includeComments: true } },
    }))

    const discover = plans.find((plan: { capability: string }) => plan.capability === "DISCOVER_POSTS")
    expect(discover).toMatchObject({
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      acquisitionMode: "APIFY_FALLBACK",
      status: "ACTIVE",
    })
    const comments = plans.find((plan: { capability: string }) => plan.capability === "READ_EXTERNAL_COMMENTS")
    expect(comments).toMatchObject({
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      acquisitionMode: "APIFY_FALLBACK",
      status: "ACTIVE",
    })
  })

  it("accepts a verified Facebook Apify proof for discovery and still enables scoped comments", async () => {
    const platform = "facebook"
    mockPrisma.socialProviderCapabilityProof.findMany.mockResolvedValue([{
      id: "legacy-apify",
      providerKey: "apify",
      adapterKey: ROUTE_ADAPTERS.APIFY_ASYNC,
      platform,
      capability: "DISCOVER_POSTS",
      contentScopes: ["PUBLIC"],
      contractVersion: "social-provider-capabilities-v1",
      policyVersion: "social-monitoring-v2-pr2",
      readAllowed: true,
      replyAllowed: false,
      aiProcessingAllowed: true,
      exportAllowed: true,
      retentionDays: 30,
      status: "VERIFIED",
      verifiedAt: new Date("2026-07-14T00:00:00Z"),
      sandboxVerifiedAt: null,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    }])

    const plans = await compileSourceRoutePlans(source({
      platform,
      url: `https://${platform}.com/brand`,
      settings: { searchIndex: { includeComments: true } },
    }))

    const discover = plans.find((plan: { capability: string }) => plan.capability === "DISCOVER_POSTS")
    expect(discover).toMatchObject({
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      capabilityProofId: "legacy-apify",
      acquisitionMode: "APIFY_FALLBACK",
      status: "ACTIVE",
    })
    const comments = plans.find((plan: { capability: string }) => plan.capability === "READ_EXTERNAL_COMMENTS")
    expect(comments).toMatchObject({
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      acquisitionMode: "APIFY_FALLBACK",
      status: "ACTIVE",
    })
  })

  it.each(["facebook", "instagram"])(
    "pauses Bright Data fallbacks and split phases for new %s routes while Apify is enabled",
    async (platform) => {
      const capabilities = [
        "DISCOVER_POSTS",
        "ENRICH_CONTENT",
        "READ_MEDIA",
        "UPDATE_METRICS",
        "READ_EXTERNAL_COMMENTS",
      ]
      mockPrisma.socialProviderCapabilityProof.findMany.mockResolvedValue(capabilities.map((capability, index) => ({
        id: `proof-bright-${index}`,
        providerKey: "bright-data",
        adapterKey: ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT,
        platform,
        capability,
        contentScopes: ["PUBLIC"],
        contractVersion: "social-provider-capabilities-v1",
        policyVersion: "social-monitoring-v2-pr2",
        readAllowed: true,
        replyAllowed: false,
        aiProcessingAllowed: true,
        exportAllowed: true,
        retentionDays: 30,
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-14T00:00:00Z"),
        sandboxVerifiedAt: null,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      })))
      vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_ROUTING", "1")

      const plans = await compileSourceRoutePlans(source({
        platform,
        ownership: platform === "facebook" ? "unknown" : "external",
        url: `https://${platform}.com/brand`,
      }))

      expect(plans).toHaveLength(2)
      expect(plans).toEqual(expect.arrayContaining([
        expect.objectContaining({
          capability: "DISCOVER_POSTS",
          primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
          fallbackAdapters: [ROUTE_ADAPTERS.MANUAL_TASK],
          executionOrder: 0,
          dependsOnCapability: null,
        }),
        expect.objectContaining({
          capability: "READ_EXTERNAL_COMMENTS",
          primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
          fallbackAdapters: [ROUTE_ADAPTERS.MANUAL_TASK],
          executionOrder: 1,
          dependsOnCapability: "DISCOVER_POSTS",
        }),
      ]))
      expect(plans.some((plan: { primaryAdapter: string; fallbackAdapters: string[] }) => (
        plan.primaryAdapter === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT
        || plan.fallbackAdapters.includes(ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT)
      ))).toBe(false)
      expect(plans.some((plan: { capability: string }) => (
        ["ENRICH_CONTENT", "READ_MEDIA", "UPDATE_METRICS"].includes(plan.capability)
      ))).toBe(false)
    },
  )
})

describe("capability-scoped social provider regression control", () => {
  const apifyPrimary = {
    primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
    fallbackAdapters: [ROUTE_ADAPTERS.MANUAL_TASK],
    capabilityProofId: "proof-apify",
    acquisitionMode: "APIFY_FALLBACK" as const,
    reason: "hypothetical regression that reintroduced an Apify primary",
    status: "ACTIVE" as const,
  }

  it("allows discovery and scoped external comments on every guarded social platform", () => {
    for (const platform of ["facebook", "instagram", "tiktok"]) {
      expect(enforceBrightDataOnlyPolicy(platform, { ...apifyPrimary }, "DISCOVER_POSTS"))
        .toEqual(apifyPrimary)
    }
    for (const platform of ["instagram", "facebook", "tiktok"]) {
      expect(enforceBrightDataOnlyPolicy(platform, { ...apifyPrimary }, "READ_EXTERNAL_COMMENTS"))
        .toEqual(apifyPrimary)
    }
    expect(enforceBrightDataOnlyPolicy("instagram", { ...apifyPrimary }, "READ_MEDIA"))
      .toMatchObject({ primaryAdapter: ROUTE_ADAPTERS.MANUAL_TASK, status: "BLOCKED" })
  })

  it("strips an Apify fallback for an unrelated TikTok capability", () => {
    const sanitized = enforceBrightDataOnlyPolicy("tiktok", {
      primaryAdapter: ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT,
      fallbackAdapters: [ROUTE_ADAPTERS.APIFY_ASYNC, ROUTE_ADAPTERS.MANUAL_TASK],
      capabilityProofId: "proof-bright",
      acquisitionMode: "LICENSED_PROVIDER",
      reason: "verified Bright Data proof",
      status: "ACTIVE",
    }, "READ_MEDIA")
    expect(sanitized.primaryAdapter).toBe(ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT)
    expect(sanitized.fallbackAdapters).toEqual([ROUTE_ADAPTERS.MANUAL_TASK])
    expect(sanitized.status).toBe("ACTIVE")
  })

  it("leaves generic web Apify routes untouched", () => {
    const sanitized = enforceBrightDataOnlyPolicy("web", { ...apifyPrimary })
    expect(sanitized).toEqual(apifyPrimary)
  })
})

describe("source route circuit breaker", () => {
  it("selects the first persisted fallback while the circuit is open", () => {
    expect(selectedAdapterForPlan({
      primaryAdapter: "PRIMARY",
      fallbackAdapters: ["FALLBACK", "MANUAL_TASK"],
      circuitOpenUntil: new Date("2026-07-11T12:15:00Z"),
    }, new Date("2026-07-11T12:00:00Z"))).toBe("FALLBACK")
  })

  it.each([
    ["schema degradation", { ok: true, degraded: true }],
    ["direct success", { ok: true }],
    ["fallback success", {
      ok: true,
      usedAdapter: "APIFY_ASYNC",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      primaryAttempted: true,
      primaryFailureClass: "timeout",
    }],
    ["failback pending", { ok: true, failbackReconciled: false }],
    ["quarantined failure", { ok: false, failureClass: "invalid_token" }],
    ["recoverable failure", { ok: false, failureClass: "timeout" }],
  ])("never resurrects an INVALIDATED route on %s", async (_label, result) => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
      failureCount: 1,
      rateLimit: {},
    })

    await recordSourceRouteResult("org-1", "route-invalidated", result, new Date())

    for (const [call] of mockPrisma.sourceRoutePlan.updateMany.mock.calls) {
      expect(call.where).toEqual(expect.objectContaining({
        id: "route-invalidated",
        organizationId: "org-1",
        status: { not: "INVALIDATED" },
      }))
    }
    for (const [call] of mockPrisma.sourceRoutePlan.findFirst.mock.calls) {
      expect(call.where).toEqual(expect.objectContaining({
        id: "route-invalidated",
        organizationId: "org-1",
        status: { not: "INVALIDATED" },
      }))
    }
  })

  it("opens the circuit with jittered backoff after the third consecutive recoverable failure", async () => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({ failureCount: 2 })
    const now = new Date("2026-07-11T12:00:00Z")
    await recordSourceRouteResult("org-1", "route-1", { ok: false, failureClass: "RATE_LIMIT" }, now)

    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    expect(call.where).toMatchObject({ organizationId: "org-1", id: "route-1", failureCount: 2 })
    expect(call.data).toMatchObject({ status: "DEGRADED", failureCount: 3, lastFailureClass: "RATE_LIMIT" })
    const openMs = (call.data.circuitOpenUntil as Date).getTime() - now.getTime()
    // RATE_LIMIT base 900s ± 25% jitter, attempt 1
    expect(openMs).toBeGreaterThanOrEqual(900 * 0.75 * 1000)
    expect(openMs).toBeLessThan(900 * 1.25 * 1000)
  })

  it("uses the persisted route TTL override for recoverable failures", async () => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
      failureCount: 2,
      rateLimit: { circuitCooldownSeconds: 60 },
    })
    const now = new Date("2026-07-11T12:00:00Z")
    await recordSourceRouteResult("org-1", "route-ttl", { ok: false, failureClass: "timeout" }, now)

    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    const openMs = (call.data.circuitOpenUntil as Date).getTime() - now.getTime()
    expect(openMs).toBeGreaterThanOrEqual(60 * 0.75 * 1000)
    expect(openMs).toBeLessThan(60 * 1.25 * 1000)
  })

  it("does not open the circuit before the threshold for a transient failure", async () => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({ failureCount: 0 })
    await recordSourceRouteResult("org-1", "route-1", { ok: false, failureClass: "timeout" }, new Date())

    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    expect(call.data.status).toBe("ACTIVE")
    expect(call.data.failureCount).toBe(1)
    expect(call.data.lastFailureClass).toBe("TRANSIENT")
    expect(call.data.circuitOpenUntil).toBeUndefined()
  })

  it("opens the circuit immediately when a provider already exhausted its internal retries", async () => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({ failureCount: 0 })
    const now = new Date("2026-07-11T12:00:00Z")

    await recordSourceRouteResult("org-1", "route-1", {
      ok: false,
      failureClass: "apify_provider_blocked",
      forceCircuitOpen: true,
    }, now)

    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    expect(call.data).toMatchObject({
      status: "DEGRADED",
      failureCount: 1,
      lastFailureClass: "TRANSIENT",
    })
    expect(call.data.circuitOpenUntil).toBeInstanceOf(Date)
    expect((call.data.circuitOpenUntil as Date).getTime()).toBeGreaterThan(now.getTime())
  })

  it("quarantines the route (BLOCKED) on an auth failure with no retry timer", async () => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({ failureCount: 0 })
    await recordSourceRouteResult("org-1", "route-1", { ok: false, failureClass: "invalid_token: unauthorized" }, new Date())

    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    expect(call.data).toMatchObject({ status: "BLOCKED", lastFailureClass: "AUTH", circuitOpenUntil: null })
  })

  it("quarantines the route on a missing capability proof (policy)", async () => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({ failureCount: 1 })
    await recordSourceRouteResult("org-1", "route-1", { ok: false, failureClass: "capability_proof_missing" }, new Date())

    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    expect(call.data).toMatchObject({ status: "BLOCKED", lastFailureClass: "POLICY" })
  })

  it("resets to ACTIVE and clears the circuit on success", async () => {
    await recordSourceRouteResult("org-1", "route-1", { ok: true }, new Date())
    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    expect(call.data).toMatchObject({ status: "ACTIVE", failureCount: 0, circuitOpenUntil: null, lastFailureClass: null })
  })

  it("keeps the route degraded when fallback succeeds while primary circuit is open", async () => {
    await recordSourceRouteResult("org-1", "route-1", {
      ok: true,
      usedAdapter: "APIFY_ASYNC",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      primaryAttempted: false,
    }, new Date("2026-07-14T03:00:00.000Z"))

    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    expect(call.data).toEqual({
      status: "DEGRADED",
      lastSucceededAt: new Date("2026-07-14T03:00:00.000Z"),
    })
    expect(mockPrisma.sourceRoutePlan.findFirst).not.toHaveBeenCalled()
  })

  it("reopens the circuit when primary fails before a successful fallback", async () => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
      failureCount: 3,
      rateLimit: { circuitCooldownSeconds: 60 },
    })
    const now = new Date("2026-07-14T03:00:00.000Z")
    await recordSourceRouteResult("org-1", "route-1", {
      ok: true,
      usedAdapter: "APIFY_ASYNC",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      primaryAttempted: true,
      primaryFailureClass: "timeout",
    }, now)

    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    expect(call.data).toMatchObject({
      status: "DEGRADED",
      failureCount: 4,
      lastFailureClass: "TRANSIENT",
      lastSucceededAt: now,
    })
    expect((call.data.circuitOpenUntil as Date).getTime()).toBeGreaterThan(now.getTime())
  })

  it("keeps primary degraded until the overlap audit reconciles", async () => {
    await recordSourceRouteResult("org-1", "route-1", {
      ok: true,
      usedAdapter: "BRIGHT_DATA_SNAPSHOT",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      primaryAttempted: true,
      failbackReconciled: false,
    }, new Date("2026-07-14T03:00:00.000Z"))

    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    expect(call.data).toMatchObject({
      status: "DEGRADED",
      lastFailureClass: "FAILBACK_RECONCILIATION_PENDING",
    })
    expect(call.data.circuitOpenUntil).toBeUndefined()
  })

  it("marks schema drift DEGRADED immediately without opening a retry circuit", async () => {
    await recordSourceRouteResult("org-1", "route-1", {
      ok: true,
      degraded: true,
      failureClass: "bright_data_schema_degraded",
    }, new Date("2026-07-14T03:00:00.000Z"))

    const call = mockPrisma.sourceRoutePlan.updateMany.mock.calls.at(-1)![0]
    expect(call).toMatchObject({
      where: { id: "route-1", organizationId: "org-1", status: { not: "INVALIDATED" } },
      data: {
        status: "DEGRADED",
        failureCount: { increment: 1 },
        circuitOpenUntil: null,
        lastFailureClass: "SCHEMA_DRIFT",
        lastSucceededAt: new Date("2026-07-14T03:00:00.000Z"),
      },
    })
  })
})

describe("instagram business discovery routing", () => {
  it("prefers official Business Discovery only with a verified Meta capability proof", async () => {
    mockPrisma.socialAccount.findMany.mockResolvedValue([{ id: "acc-meta", platform: "instagram", isActive: true, accessToken: "encrypted" }])
    mockPrisma.socialProviderCapabilityProof.findMany.mockResolvedValue([{
      id: "proof-meta-discovery",
      providerKey: "meta",
      adapterKey: ROUTE_ADAPTERS.META_GRAPH,
      platform: "instagram",
      capability: "DISCOVER_POSTS",
      contentScopes: ["PUBLIC"],
      contractVersion: "graph-v21",
      policyVersion: "social-monitoring-v2-pr2",
      readAllowed: true,
      replyAllowed: false,
      aiProcessingAllowed: true,
      exportAllowed: true,
      retentionDays: 30,
      status: "VERIFIED",
      verifiedAt: new Date("2026-07-22T00:00:00Z"),
      sandboxVerifiedAt: new Date("2026-07-22T00:00:00Z"),
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    }])
    const plans = await compileSourceRoutePlans(source({
      sourceType: "search_url",
      query: null,
      url: "https://www.instagram.com/brand/",
    }))

    expect(plans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "DISCOVER_POSTS",
        primaryAdapter: ROUTE_ADAPTERS.META_GRAPH,
        // Official API first, then Apify fallback (carve-out), then manual.
        fallbackAdapters: [ROUTE_ADAPTERS.APIFY_ASYNC, ROUTE_ADAPTERS.MANUAL_TASK],
        acquisitionMode: "OFFICIAL_API",
        capabilityProofId: "proof-meta-discovery",
        connectionAccountId: "acc-meta",
        status: "ACTIVE",
      }),
      // External comment bodies are not exposed by Graph; the pinned Apify
      // comments actor handles known public post URLs and nested replies.
      expect.objectContaining({ capability: "READ_EXTERNAL_COMMENTS", primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC, status: "ACTIVE" }),
    ]))
  })

  it("does not infer Business Discovery permission from a connected IG account alone", async () => {
    mockPrisma.socialAccount.findMany.mockResolvedValue([{ id: "acc-meta", platform: "instagram", isActive: true, accessToken: "encrypted" }])

    const plans = await compileSourceRoutePlans(source())
    const discover = plans.find((plan: { capability: string }) => plan.capability === "DISCOVER_POSTS")

    expect(discover).toMatchObject({
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      capabilityProofId: null,
      acquisitionMode: "APIFY_FALLBACK",
      status: "ACTIVE",
    })
  })

  it("falls Instagram discovery back to Apify when the target is not Business-Discovery eligible (carve-out 2026-07-21)", async () => {
    // A post URL is not a professional profile, so official Business Discovery
    // is unavailable — but Apify discovery still applies (was fail-closed before
    // the carve-out).
    mockPrisma.socialAccount.findMany.mockResolvedValue([{ id: "acc-meta", platform: "instagram", isActive: true, accessToken: "encrypted" }])
    const plans = await compileSourceRoutePlans(source({
      sourceType: "search_url",
      handle: null,
      query: null,
      url: "https://www.instagram.com/p/DEF456/",
    }))

    const discover = plans.find((plan: { capability: string }) => plan.capability === "DISCOVER_POSTS")
    expect(discover).toMatchObject({ primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC, acquisitionMode: "APIFY_FALLBACK", status: "ACTIVE" })
  })

  it("uses Apify discovery for Facebook external pages instead of treating them as Instagram Business Discovery", async () => {
    mockPrisma.socialAccount.findMany.mockResolvedValue([{ id: "acc-fb", platform: "facebook", isActive: true, accessToken: "encrypted" }])
    const plans = await compileSourceRoutePlans(source({ platform: "facebook", url: "https://facebook.com/somepage", handle: null }))

    const discover = plans.find((plan: { capability: string }) => plan.capability === "DISCOVER_POSTS")
    expect(discover).toMatchObject({
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      acquisitionMode: "APIFY_FALLBACK",
      status: "ACTIVE",
    })
  })

  it("uses Apify for Instagram discovery when no account or verified Bright Data proof exists (carve-out 2026-07-21)", async () => {
    const plans = await compileSourceRoutePlans(source())
    const discover = plans.find((plan: { capability: string }) => plan.capability === "DISCOVER_POSTS")
    expect(discover).toMatchObject({ primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC, acquisitionMode: "APIFY_FALLBACK", status: "ACTIVE" })
    // The known-publication comments actor is the second narrow IG carve-out.
    const comments = plans.find((plan: { capability: string }) => plan.capability === "READ_EXTERNAL_COMMENTS")
    expect(comments).toMatchObject({ primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC, status: "ACTIVE" })
  })
})

describe("instagramBusinessDiscoveryUsername", () => {
  const base = { platform: "instagram", sourceType: "profile", handle: null as string | null, url: null as string | null, settings: {} as unknown }

  it("resolves profile handles and instagram profile urls", () => {
    expect(instagramBusinessDiscoveryUsername({ ...base, handle: "@Baku.WS" })).toBe("baku.ws")
    expect(instagramBusinessDiscoveryUsername({ ...base, sourceType: "search_url", url: "https://www.instagram.com/baku.ws_official" })).toBe("baku.ws_official")
    expect(instagramBusinessDiscoveryUsername({ ...base, sourceType: "search_url", url: "https://instagram.com/qafqazinfo.az/?hl=en" })).toBe("qafqazinfo.az")
  })

  it("honors an explicit settings override", () => {
    expect(instagramBusinessDiscoveryUsername({ ...base, sourceType: "keyword", settings: { businessDiscoveryUsername: "@report.az" } })).toBe("report.az")
  })

  it("rejects post urls, reserved paths, keyword sources and invalid handles", () => {
    expect(instagramBusinessDiscoveryUsername({ ...base, sourceType: "search_url", url: "https://www.instagram.com/p/DEF456/" })).toBeNull()
    expect(instagramBusinessDiscoveryUsername({ ...base, sourceType: "search_url", url: "https://www.instagram.com/explore/tags/hava/" })).toBeNull()
    expect(instagramBusinessDiscoveryUsername({ ...base, sourceType: "keyword", handle: "hava proqnozu" })).toBeNull()
    expect(instagramBusinessDiscoveryUsername({ ...base, handle: "hava proqnozu" })).toBeNull()
    expect(instagramBusinessDiscoveryUsername({ ...base, sourceType: "search_url", url: "https://facebook.com/somepage" })).toBeNull()
    expect(instagramBusinessDiscoveryUsername({ ...base, platform: "facebook", handle: "somepage" })).toBeNull()
  })
})
