import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import crypto from "crypto"

const mockPrisma = vi.hoisted(() => ({
  organization: { findUnique: vi.fn() },
  monitoringSubject: { findMany: vi.fn() },
  sourceRoutePlan: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  monitoringSource: { findFirst: vi.fn(), updateMany: vi.fn() },
  socialProviderRun: {
    aggregate: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  ingestEnvelope: { findMany: vi.fn(), findFirst: vi.fn() },
  socialMention: { findMany: vi.fn() },
  mentionEvidence: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  socialDeletionLedgerEntry: { findMany: vi.fn(), update: vi.fn() },
  socialCommentCheckpoint: { upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  tikTokPublicationRevisit: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}))

const deps = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  hmacToken: vi.fn(),
  classifySentiment: vi.fn(),
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  getSocialMonitoringSettings: vi.fn(),
  recordSourceRouteResult: vi.fn(),
  tenantClientFundedManualRunsEnabled: vi.fn(),
  tenantProviderAccountFundedRunPolicy: vi.fn(),
  tenantPaidRunEmergencyStopped: vi.fn(),
  runWithinImportFence: vi.fn(),
  cleanSlateBlocked: vi.fn(),
  paidEmergencyStopped: vi.fn(),
  decideTikTokPublication: vi.fn(),
  isTikTokPublicationEligibleForComments: vi.fn(),
  persistTikTokPublicationDecision: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/secure-token", () => ({ decryptToken: deps.decryptToken, hmacToken: deps.hmacToken }))
vi.mock("@/lib/sentiment", () => ({ classifySentiment: deps.classifySentiment }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: deps.findMatchedKeyword,
  ingestMentionWithResult: deps.ingestMentionWithResult,
}))
vi.mock("@/lib/social/monitoring-settings", () => ({
  DEFAULT_APIFY_SEARCH_ACTORS: {
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
  getSocialMonitoringSettings: deps.getSocialMonitoringSettings,
}))
vi.mock("@/lib/social/source-route-plan", () => ({
  recordSourceRouteResult: deps.recordSourceRouteResult,
}))
vi.mock("@/lib/social/paid-run-authorization", () => ({
  tenantClientFundedManualRunsEnabled: deps.tenantClientFundedManualRunsEnabled,
  tenantProviderAccountFundedRunPolicy: deps.tenantProviderAccountFundedRunPolicy,
  tenantPaidRunEmergencyStopped: deps.tenantPaidRunEmergencyStopped,
}))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringImportFence: deps.runWithinImportFence,
  socialMonitoringCleanSlateBlocked: deps.cleanSlateBlocked,
  socialMonitoringPaidEmergencyStopped: deps.paidEmergencyStopped,
}))
vi.mock("@/lib/social/tiktok-publication-gate", () => ({
  decideTikTokPublication: deps.decideTikTokPublication,
  isTikTokPublicationEligibleForComments: deps.isTikTokPublicationEligibleForComments,
  persistTikTokPublicationDecision: deps.persistTikTokPublicationDecision,
}))

import {
  apifyActorForSource,
  apifyDatasetItemError,
  apifyDiscoveryInput,
  apifyInputResultCeiling,
  apifyPerInputResultLimitReached,
  discoveryReviewDecision,
  discoveryLookbackWindow,
  hasApifyCommentCandidates,
  importApifyProviderRun,
  processApifyDatasetDeletion,
  reconcileApifyProviderRuns,
  runApifyAsyncCollector,
  verifyApifyWebhookSecret,
} from "@/lib/social/apify-async-adapter"
import { archiveProviderCursorKey } from "@/lib/social/archive-provider-window"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const settings = {
  searchIndex: {
    enabled: true,
    provider: "apify",
    encryptedToken: "encrypted-token",
    actors: {},
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
}

const source: MonitoringSourceForRun = {
  id: "src-1",
  organizationId: "org-1",
  platform: "instagram",
  sourceType: "hashtag",
  ownership: "external",
  collectionMode: "search_index",
  status: "active",
  cadenceMinutes: 360,
  query: "leaddrive",
  keywords: ["leaddrive"],
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  settings: {},
  routeExecution: {
    collectorRunId: "collector-1",
    routePlanId: "route-1",
    capability: "DISCOVER_POSTS",
    adapterKey: "APIFY_ASYNC",
    acquisitionMode: "APIFY_FALLBACK",
  },
}

function clientFundedSource(overrides: Partial<NonNullable<MonitoringSourceForRun["routeExecution"]>> = {}): MonitoringSourceForRun {
  return {
    ...source,
    routeExecution: {
      ...source.routeExecution!,
      manualPaidRun: true,
      manualMaxTotalChargeUsd: 100,
      clientFundedManual: true,
      targetScenarioId: "scenario-a",
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.stubEnv("SOCIAL_MONITORING_ENFORCE_USD_BUDGETS", "1")
  deps.getSocialMonitoringSettings.mockResolvedValue(settings)
  deps.decryptToken.mockReturnValue("apify-token")
  deps.hmacToken.mockImplementation((value: string, purpose: string) => crypto.createHash("sha256").update(`${purpose}:${value}`).digest("hex"))
  deps.classifySentiment.mockResolvedValue("neutral")
  deps.findMatchedKeyword.mockReturnValue("leaddrive")
  deps.ingestMentionWithResult.mockImplementation(async (input: { externalId: string }) => ({ id: `mention-${input.externalId}`, created: true }))
  deps.recordSourceRouteResult.mockResolvedValue({ count: 1 })
  deps.tenantClientFundedManualRunsEnabled.mockResolvedValue(true)
  // По умолчанию тенант НЕ платит со счёта провайдера: существующие ожидания
  // про fail-closed без долларовых лимитов должны сохраниться.
  deps.tenantProviderAccountFundedRunPolicy.mockResolvedValue({ enabled: false, dailyRunQuota: 0 })
  deps.tenantPaidRunEmergencyStopped.mockResolvedValue(false)
  deps.runWithinImportFence.mockImplementation(async (
    _input: unknown,
    persist: () => Promise<unknown>,
  ) => ({ allowed: true, value: await persist() }))
  deps.cleanSlateBlocked.mockReturnValue(false)
  deps.paidEmergencyStopped.mockReturnValue(false)
  deps.decideTikTokPublication.mockImplementation((input: { query: string; scenarioIds: string[]; provider: string; observedAt: Date }) => ({
    status: "MATCHED",
    reasonCode: "DETERMINISTIC_TERM_MATCH",
    matchedTerms: [input.query],
    scenarioIds: input.scenarioIds,
    query: input.query,
    provider: input.provider,
    observedAt: input.observedAt.toISOString(),
    policySnapshot: {
      version: "tiktok-publication-gate-v1",
      probableOptIn: false,
      minProbableConfidence: 0.8,
      candidateOnly: true,
      liveRoutingAllowed: false,
    },
  }))
  deps.isTikTokPublicationEligibleForComments.mockImplementation((decision: { status: string }) => decision.status === "MATCHED")
  deps.persistTikTokPublicationDecision.mockResolvedValue("applied")
  mockPrisma.organization.findUnique.mockResolvedValue({ settings: {
    socialMonitoringPaidRuns: { emergencyStopped: false },
  } })
  mockPrisma.monitoringSubject.findMany.mockResolvedValue([{ id: "subject-1" }])
  mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
    budget: { maxItems: 100, maxTotalChargeUsd: 1, dailyBudgetUsd: 5, monthlyBudgetUsd: 50, usdLimitsConfigured: true, timeoutSeconds: 900 },
    freshnessMinutes: 60,
    contractVersion: "stable",
  })
  mockPrisma.sourceRoutePlan.findMany.mockResolvedValue([])
  mockPrisma.monitoringSource.findFirst.mockResolvedValue({ id: "src-1" })
  mockPrisma.monitoringSource.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.socialProviderRun.aggregate.mockResolvedValue({ _sum: { reservedChargeUsd: 0, actualChargeUsd: 0 } })
  mockPrisma.$queryRaw.mockResolvedValue([{ reservedChargeUsd: 0, actualChargeUsd: 0 }])
  mockPrisma.socialProviderRun.findFirst.mockResolvedValue(null)
  mockPrisma.socialProviderRun.findUnique.mockResolvedValue(null)
  mockPrisma.socialProviderRun.findMany.mockResolvedValue([])
  mockPrisma.socialProviderRun.create.mockResolvedValue({
    id: "provider-run-1",
    organizationId: "org-1",
  })
  mockPrisma.socialProviderRun.updateMany.mockResolvedValue({ id: "provider-run-1" })
  mockPrisma.socialProviderRun.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.sourceRoutePlan.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.mentionEvidence.findFirst.mockResolvedValue(null)
  mockPrisma.mentionEvidence.create.mockResolvedValue({ id: "evidence-1" })
  mockPrisma.mentionEvidence.findMany.mockResolvedValue([])
  mockPrisma.socialMention.findMany.mockResolvedValue([])
  mockPrisma.ingestEnvelope.findMany.mockResolvedValue([])
  mockPrisma.ingestEnvelope.findFirst.mockResolvedValue(null)
  const checkpointUrls = new Set<string>()
  mockPrisma.socialCommentCheckpoint.upsert.mockImplementation(async (args: { create?: { canonicalParentUrl?: string } }) => {
    if (args.create?.canonicalParentUrl) checkpointUrls.add(args.create.canonicalParentUrl)
    return { id: "checkpoint" }
  })
  mockPrisma.socialCommentCheckpoint.findMany.mockImplementation(async (args: { where?: { canonicalParentUrl?: { in?: string[] } } }) => {
    const requested = args.where?.canonicalParentUrl?.in
    const urls = requested ?? Array.from(checkpointUrls)
    return urls.filter(url => checkpointUrls.has(url)).map((canonicalParentUrl, index) => ({
      id: `checkpoint-${index}`,
      canonicalParentUrl,
      parentExternalId: null,
      discoveredAt: new Date(),
      lastActivityAt: new Date(),
      lastAttemptAt: null,
      lastSuccessfulAt: null,
      status: "ACTIVE",
      consecutiveNoChange: 0,
      lastSeenCommentCount: 0,
      lastSeenCommentExternalId: null,
    }))
  })
  mockPrisma.socialCommentCheckpoint.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.socialCommentCheckpoint.update.mockResolvedValue({ id: "checkpoint" })
  mockPrisma.tikTokPublicationRevisit.findMany.mockResolvedValue([])
  mockPrisma.tikTokPublicationRevisit.createMany.mockResolvedValue({ count: 0 })
  mockPrisma.tikTokPublicationRevisit.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.tikTokPublicationRevisit.findUnique.mockResolvedValue(null)
  mockPrisma.tikTokPublicationRevisit.update.mockResolvedValue({ id: "revisit" })
  mockPrisma.$executeRaw.mockResolvedValue(1)
  mockPrisma.$transaction.mockImplementation(async (
    operation: unknown[] | ((tx: typeof mockPrisma) => unknown),
  ) => typeof operation === "function" ? operation(mockPrisma) : Promise.all(operation))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("async Apify provider boundary", () => {
  it("builds a pinned global web-search route from monitored terms", () => {
    const webSource: MonitoringSourceForRun = {
      ...source,
      platform: "web",
      sourceType: "keyword",
      query: "bravo supermarket",
      keywords: ["bravo supermarket"],
    }

    expect(apifyActorForSource(webSource, "DISCOVER_POSTS", settings.searchIndex.apifyActors))
      .toBe("apify/google-search-scraper")
    expect(apifyDiscoveryInput(webSource, 25)).toEqual({
      queries: "\"bravo supermarket\"",
      maxPagesPerQuery: 3,
      resultsPerPage: 10,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
    })
  })

  it("excludes the monitored brand's owned domains from paid web discovery", () => {
    const webSource: MonitoringSourceForRun = {
      ...source,
      platform: "web",
      sourceType: "keyword",
      query: "Baku Electronics",
      keywords: ["Baku Electronics"],
      ownedIdentity: {
        authorNames: ["bakuelectronics"],
        sourceIds: ["official-web"],
        webHosts: ["bakuelectronics.az", "shop.bakuelectronics.az"],
        profileUrls: [],
      },
    }

    expect(apifyDiscoveryInput(webSource, 25)).toMatchObject({
      queries: "\"Baku Electronics\" -site:bakuelectronics.az -site:shop.bakuelectronics.az",
    })
  })

  it("uses native Instagram keyword discovery and keeps Google as an explicit fallback", () => {
    const instagramSource: MonitoringSourceForRun = {
      ...source,
      platform: "instagram",
      sourceType: "keyword",
      query: "Baku Electronics",
      keywords: ["Baku Electronics"],
      ownedIdentity: {
        authorNames: ["bakuelectronics"],
        sourceIds: ["official-instagram"],
        webHosts: [],
        profileUrls: [
          "https://instagram.com/bakuelectronics/",
          "https://www.facebook.com/bakuelectronics",
        ],
      },
    }

    expect(apifyActorForSource(instagramSource, "DISCOVER_POSTS", settings.searchIndex.apifyActors))
      .toBe("apify/instagram-hashtag-scraper")
    expect(apifyDiscoveryInput(instagramSource, 25)).toEqual({
      hashtags: ["Baku Electronics"],
      resultsLimit: 25,
      resultsType: "posts",
      keywordSearch: true,
    })
    expect(apifyDiscoveryInput(instagramSource, 25, null, "apify/google-search-scraper")).toMatchObject({
      queries: "\"Baku Electronics\" site:instagram.com -site:instagram.com/bakuelectronics",
    })

    const keywordOnlySource: MonitoringSourceForRun = {
      ...instagramSource,
      query: null,
      keywords: ["Araz", "Bravo", "Kontakt Home"],
      ownedIdentity: undefined,
    }
    expect(apifyDiscoveryInput(keywordOnlySource, 10)).toEqual({
      hashtags: ["Araz", "Bravo", "Kontakt Home"],
      resultsLimit: 3,
      resultsType: "posts",
      keywordSearch: true,
    })
    expect(apifyDiscoveryInput(keywordOnlySource, 2)).toBeNull()
    expect(apifyDiscoveryInput({
      ...keywordOnlySource,
      keywords: Array.from({ length: 21 }, (_, index) => `Brand ${index + 1}`),
    }, 100)).toBeNull()

    const fullScenarioBatch: MonitoringSourceForRun = {
      ...keywordOnlySource,
      query: Array.from({ length: 20 }, (_, index) => `Brand ${index + 1}`).join("|"),
      keywords: Array.from({ length: 20 }, (_, index) => `Brand ${index + 1}`),
      settings: {
        expandedQueries: [{
          term: Array.from({ length: 20 }, (_, index) => `Brand ${index + 1}`).join(" "),
          reason: "base_query",
        }],
      },
    }
    expect(apifyDiscoveryInput(fullScenarioBatch, 100)).toMatchObject({
      hashtags: Array.from({ length: 20 }, (_, index) => `Brand ${index + 1}`),
      resultsLimit: 5,
      keywordSearch: true,
    })
  })

  it("derives the effective provider ceiling from frozen per-query limits", () => {
    expect(apifyInputResultCeiling("apify/instagram-hashtag-scraper", {
      hashtags: Array.from({ length: 20 }, (_, index) => `Brand${index + 1}`),
      resultsLimit: 2,
    }, 50)).toBe(40)
    expect(apifyInputResultCeiling("apify/google-search-scraper", {
      queries: ["one", "two", "three"].join("\n"),
      maxPagesPerQuery: 4,
      resultsPerPage: 8,
    }, 100)).toBe(96)
    expect(apifyInputResultCeiling("clockworks/tiktok-scraper", {
      searchQueries: ["Araz Supermarket", "Araz", "arazsupermarket"],
      resultsPerPage: 16,
    }, 50)).toBe(48)
    expect(apifyInputResultCeiling("scrapeforge/facebook-search-posts", {
      max_results: 100,
    }, 100)).toBe(100)
  })

  it("sends packed TikTok scenario terms as separate global searches", () => {
    const packedTikTokSource: MonitoringSourceForRun = {
      ...source,
      platform: "tiktok",
      sourceType: "keyword",
      query: "Baku Electronics|bakuelectronics.az|Baku Elektroniks",
      keywords: ["Baku Electronics", "bakuelectronics.az", "Baku Elektroniks"],
      url: null,
      settings: {
        expandedQueries: [{
          term: "Baku Electronics bakuelectronics.az Baku Elektroniks",
          reason: "base_query",
        }],
      },
    }

    const input = apifyDiscoveryInput(packedTikTokSource, 50)
    expect(input).toMatchObject({
      searchQueries: [
        "Baku Electronics",
        "bakuelectronics.az",
        "Baku Elektroniks",
      ],
      maxItems: 50,
      // Аллокация #638: пер-запросный потолок делится между терминами, чтобы
      // первый популярный термин не выкупал весь бюджет до хвостовых.
      resultsPerPage: 16,
    })
    expect(input?.searchQueries).not.toContain(
      "Baku Electronics|bakuelectronics.az|Baku Elektroniks",
    )
    expect(input?.searchQueries).not.toContain(
      "Baku Electronics bakuelectronics.az Baku Elektroniks",
    )
  })

  it("fans TikTok search out to budget-bounded alias slots with the brand pinned first (#638)", () => {
    const input = apifyDiscoveryInput({
      ...source,
      platform: "tiktok",
      sourceType: "keyword",
      query: "Araz Supermarket",
      keywords: [],
      url: null,
      settings: {
        canonicalBrandQuery: true,
        aliases: ["Legacy merged alias", "Araz", "arazsupermarket", "Araz Market"],
        searchFanOutTerms: ["Araz", "arazsupermarket", "Araz Market"],
      },
    }, 50, {
      hours: 7 * 24,
      since: new Date("2026-07-23T00:00:00.000Z"),
      until: new Date("2026-07-30T00:00:00.000Z"),
      resumedFromWatermark: false,
      clamped: false,
    })

    // 50 позиций / минимум 15 на термин => канонический + 2 алиасных слота.
    // Слот 0 всегда бренд; вечно растущие merged-aliases в поиск не попадают.
    expect(input).toMatchObject({
      searchQueries: ["Araz Supermarket", "Araz", "arazsupermarket"],
      maxItems: 50,
      resultsPerPage: 16,
    })
    // #657: тройка «/video + LATEST + датовый фильтр» на проде отдавала пусто
    // на всех брендах, поэтому по умолчанию не отправляется.
    expect(input).not.toHaveProperty("searchSection")
    expect(input).not.toHaveProperty("videoSearchSorting")
    expect(input).not.toHaveProperty("videoSearchDateFilter")
  })

  it("keeps the single canonical TikTok query when no scenario fan-out list exists or budget is tight", () => {
    const legacySource = {
      ...source,
      platform: "tiktok",
      sourceType: "keyword",
      query: "Araz Supermarket",
      keywords: [],
      url: null,
    }
    // Прод-источник до пересохранения сценария: searchFanOutTerms ещё нет,
    // merged-aliases не должны внезапно стать платными поисками.
    expect(apifyDiscoveryInput({
      ...legacySource,
      settings: {
        canonicalBrandQuery: true,
        aliases: ["Araz", "arazsupermarket", "Araz Market"],
      },
    }, 50)).toMatchObject({
      searchQueries: ["Araz Supermarket"],
      maxItems: 50,
      resultsPerPage: 50,
    })
    // Бюджет 20 < 2×15: алиасный слот не помещается, веер не раскрывается.
    expect(apifyDiscoveryInput({
      ...legacySource,
      settings: {
        canonicalBrandQuery: true,
        searchFanOutTerms: ["Araz", "arazsupermarket"],
      },
    }, 20)).toMatchObject({
      searchQueries: ["Araz Supermarket"],
      maxItems: 20,
      resultsPerPage: 20,
    })
  })

  it("splits a legacy pipe-packed canonical query instead of searching the packed literal", () => {
    const packedCanonical = {
      ...source,
      platform: "tiktok",
      sourceType: "keyword",
      query: "Araz Supermarket|Araz Market",
      keywords: [],
      url: null,
    }
    // Слот 0 — первый сегмент (операторский приоритет), второй сегмент идёт
    // первым кандидатом веера впереди алиасов сценария.
    expect(apifyDiscoveryInput({
      ...packedCanonical,
      settings: {
        canonicalBrandQuery: true,
        searchFanOutTerms: ["arazsupermarket"],
      },
    }, 50)).toMatchObject({
      searchQueries: ["Araz Supermarket", "Araz Market", "arazsupermarket"],
      resultsPerPage: 16,
    })
    // Упакованный литерал не уходит в поиск ни при каком бюджете.
    expect(apifyDiscoveryInput({
      ...packedCanonical,
      settings: { canonicalBrandQuery: true },
    }, 20)).toMatchObject({
      searchQueries: ["Araz Supermarket"],
      resultsPerPage: 20,
    })
  })

  it("keeps Web and Facebook on the single canonical query; Instagram fans out to alias slots (#638)", () => {
    const canonicalSettings = {
      canonicalBrandQuery: true,
      aliases: ["Legacy merged alias", "Araz", "arazsupermarket", "Araz Market"],
      searchFanOutTerms: ["Araz", "arazsupermarket", "Araz Market"],
    }
    const webInput = apifyDiscoveryInput({
      ...source,
      platform: "web",
      sourceType: "keyword",
      query: "Araz Supermarket",
      keywords: ["Legacy paid alias"],
      settings: canonicalSettings,
    }, 50)
    const facebookInput = apifyDiscoveryInput({
      ...source,
      platform: "facebook",
      sourceType: "keyword",
      query: "Araz Supermarket",
      keywords: ["Legacy paid alias"],
      settings: canonicalSettings,
    }, 50)
    const instagramInput = apifyDiscoveryInput({
      ...source,
      platform: "instagram",
      sourceType: "keyword",
      query: "Araz Supermarket",
      keywords: ["Legacy paid alias"],
      settings: canonicalSettings,
    }, 50)

    expect(webInput).toMatchObject({
      queries: "\"Araz Supermarket\"",
      maxPagesPerQuery: 5,
      resultsPerPage: 10,
    })
    // Facebook — по-прежнему один родной запрос (#635); веер площадки — #638
    // слайс 2, дочерними прогонами.
    expect(facebookInput).toMatchObject({
      query: "Araz Supermarket",
      max_results: 50,
    })
    // 50 позиций / минимум 15 на термин => бренд + 2 алиасных слота, глубина
    // делится поровну. Merged-aliases и легаси keywords в поиск не попадают.
    expect(instagramInput).toEqual({
      hashtags: ["Araz Supermarket", "Araz", "arazsupermarket"],
      resultsLimit: 16,
      resultsType: "posts",
      keywordSearch: true,
    })
  })

  it("keeps the single canonical Instagram term when the source has no scenario fan-out list", () => {
    expect(apifyDiscoveryInput({
      ...source,
      platform: "instagram",
      sourceType: "keyword",
      query: "Araz Supermarket",
      keywords: ["Legacy paid alias"],
      settings: {
        canonicalBrandQuery: true,
        aliases: ["Araz", "arazsupermarket", "Araz Market"],
      },
    }, 50)).toEqual({
      hashtags: ["Araz Supermarket"],
      resultsLimit: 50,
      resultsType: "posts",
      keywordSearch: true,
    })
  })

  it("detects per-input Instagram and raw Google ceilings before aggregation", () => {
    expect(apifyPerInputResultLimitReached("apify/instagram-hashtag-scraper", {
      hashtags: ["Araz", "Bravo"],
      resultsLimit: 2,
    }, [
      { id: "a-1", inputUrl: "https://instagram.com/explore/tags/araz/" },
      { id: "a-2", inputUrl: "https://instagram.com/explore/tags/araz/" },
    ])).toBe(true)
    expect(apifyPerInputResultLimitReached("apify/instagram-hashtag-scraper", {
      hashtags: ["Araz", "Bravo"],
      resultsLimit: 2,
    }, [
      { id: "a-1", inputUrl: "https://instagram.com/explore/tags/araz/" },
      { id: "b-1", inputUrl: "https://instagram.com/explore/tags/bravo/" },
    ])).toBe(false)
  })

  it("tolerates alias-slot saturation but freezes the cursor on the canonical slot (#638)", () => {
    const fanOutInput = {
      hashtags: ["Araz Supermarket", "arazsupermarket"],
      resultsLimit: 2,
      leadDriveSearchFanOutAliasTerms: ["arazsupermarket"],
    }
    // Насыщен только алиасный слот: хвост алиаса — приемлемая потеря, прогон
    // остаётся IMPORTED и курсор бренда двигается.
    expect(apifyPerInputResultLimitReached("apify/instagram-hashtag-scraper", fanOutInput, [
      { id: "al-1", inputUrl: "https://instagram.com/explore/search/keyword/?q=arazsupermarket" },
      { id: "al-2", inputUrl: "https://instagram.com/explore/search/keyword/?q=arazsupermarket" },
      { id: "c-1", inputUrl: "https://instagram.com/explore/search/keyword/?q=Araz%20Supermarket" },
    ])).toBe(false)
    // Насыщен канонический слот — прежняя семантика: PARTIAL, окно перекупается.
    expect(apifyPerInputResultLimitReached("apify/instagram-hashtag-scraper", fanOutInput, [
      { id: "c-1", inputUrl: "https://instagram.com/explore/search/keyword/?q=Araz%20Supermarket" },
      { id: "c-2", inputUrl: "https://instagram.com/explore/search/keyword/?q=Araz%20Supermarket" },
    ])).toBe(true)
    // Атрибуция неполная: пигеонхол консервативен и замораживает курсор.
    expect(apifyPerInputResultLimitReached("apify/instagram-hashtag-scraper", fanOutInput, [
      { id: "u-1" },
      { id: "u-2" },
      { id: "u-3" },
    ])).toBe(true)

    const tiktokFanOutInput = {
      searchQueries: ["Araz Supermarket", "arazsupermarket"],
      resultsPerPage: 2,
      leadDriveSearchFanOutAliasTerms: ["arazsupermarket"],
    }
    expect(apifyPerInputResultLimitReached("clockworks/tiktok-scraper", tiktokFanOutInput, [
      { id: "al-1", searchQuery: "arazsupermarket" },
      { id: "al-2", searchQuery: "arazsupermarket" },
      { id: "c-1", searchQuery: "Araz Supermarket" },
    ])).toBe(false)
    expect(apifyPerInputResultLimitReached("clockworks/tiktok-scraper", tiktokFanOutInput, [
      { id: "c-1", searchQuery: "Araz Supermarket" },
      { id: "c-2", searchQuery: "Araz Supermarket" },
    ])).toBe(true)
    // Легаси-прогон без веера: любой насыщенный термин замораживает курсор.
    expect(apifyPerInputResultLimitReached("clockworks/tiktok-scraper", {
      searchQueries: ["Araz", "Bravo"],
      resultsPerPage: 2,
    }, [
      { id: "a-1", searchQuery: "Araz" },
      { id: "a-2", searchQuery: "Araz" },
    ])).toBe(true)
    // Без атрибуции работает пигеонхол: 2 термина × (2-1) = 2 < 5 строк.
    expect(apifyPerInputResultLimitReached("clockworks/tiktok-scraper", {
      searchQueries: ["Araz", "Bravo"],
      resultsPerPage: 2,
    }, [
      { id: "u-1" }, { id: "u-2" }, { id: "u-3" }, { id: "u-4" }, { id: "u-5" },
    ])).toBe(true)
    expect(apifyPerInputResultLimitReached("clockworks/tiktok-scraper", {
      searchQueries: ["Araz", "Bravo"],
      resultsPerPage: 2,
    }, [
      { id: "a-1", searchQuery: "Araz" },
      { id: "b-1", searchQuery: "Bravo" },
    ])).toBe(false)
  })

  it("keeps detecting raw Google ceilings before aggregation", () => {

    expect(apifyPerInputResultLimitReached("apify/google-search-scraper", {
      queries: "\"Araz\" site:facebook.com\n\"Bravo\" site:facebook.com",
      maxPagesPerQuery: 1,
      resultsPerPage: 3,
    }, [{
      searchQuery: { term: "\"Araz\" site:facebook.com", page: 1 },
      organicResults: [
        { url: "https://example.com/1" },
        { url: "https://example.com/2" },
        { url: "https://facebook.com/araz/posts/3" },
      ],
    }])).toBe(true)
    expect(apifyPerInputResultLimitReached("apify/google-search-scraper", {
      queries: "\"Araz\" site:facebook.com",
      maxPagesPerQuery: 1,
      resultsPerPage: 3,
    }, [{
      searchQuery: { term: "\"Araz\" site:facebook.com", page: 1 },
      organicResults: [
        { url: "https://example.com/1" },
        { url: "https://facebook.com/araz/posts/2" },
      ],
    }])).toBe(false)
    expect(apifyPerInputResultLimitReached("apify/google-search-scraper", {
      queries: "\"Araz\" site:facebook.com\n\"Bravo\" site:facebook.com",
      maxPagesPerQuery: 1,
      resultsPerPage: 3,
    }, [
      {
        searchQuery: { term: "\"Araz\" site:facebook.com", page: 1 },
        organicResults: [
          { url: "https://example.com/1" },
          { url: "https://facebook.com/araz/posts/2" },
        ],
      },
      {
        organicResults: [
          { url: "https://example.com/3" },
          { url: "https://example.com/4" },
          { url: "https://facebook.com/bravo/posts/5" },
        ],
      },
    ])).toBe(true)
  })

  it("sends the highest-priority campaign term to Facebook's singular native query", () => {
    const facebookSource: MonitoringSourceForRun = {
      ...source,
      platform: "facebook",
      sourceType: "keyword",
      query: "Araz Supermarket",
      keywords: ["Araz Supermarket"],
      url: null,
    }
    const input = apifyDiscoveryInput(facebookSource, 25)

    expect(apifyActorForSource(facebookSource, "DISCOVER_POSTS", settings.searchIndex.apifyActors))
      .toBe("scrapeforge/facebook-search-posts")
    expect(input).toEqual({
      query: "Araz Supermarket",
      search_type: "posts",
      max_results: 25,
      recent_posts: true,
    })
    expect(String(input?.query)).not.toContain("|")

    const expandedVariantSource: MonitoringSourceForRun = {
      ...facebookSource,
      settings: {
        expandedQueries: [{
          query: "Araz Supermarket",
          terms: ["arazsupermarket"],
        }],
      },
    }
    expect(apifyActorForSource(expandedVariantSource, "DISCOVER_POSTS", settings.searchIndex.apifyActors))
      .toBe("scrapeforge/facebook-search-posts")
    expect(apifyDiscoveryInput(expandedVariantSource, 25)).toMatchObject({
      query: "Araz Supermarket",
    })

    const facebookHashtagSource: MonitoringSourceForRun = {
      ...facebookSource,
      sourceType: "hashtag",
      query: "#ArazSupermarket",
      keywords: ["ArazSupermarket"],
    }
    expect(apifyActorForSource(facebookHashtagSource, "DISCOVER_POSTS", settings.searchIndex.apifyActors))
      .toBe("scrapeforge/facebook-search-posts")
    expect(apifyDiscoveryInput(facebookHashtagSource, 25)).toMatchObject({
      query: "ArazSupermarket",
      search_type: "posts",
      max_results: 25,
    })

    // #635: multi-term sources stay on Facebook's own search engine. The
    // singular native query carries the primary term; the silent reroute of
    // the whole source to Google's index of facebook.com is gone.
    const packedFacebookSource: MonitoringSourceForRun = {
      ...facebookSource,
      query: "Araz Supermarket|Araz market|Araz",
      keywords: ["Araz Supermarket", "Araz market", "Araz"],
    }
    expect(apifyActorForSource(packedFacebookSource, "DISCOVER_POSTS", settings.searchIndex.apifyActors))
      .toBe("scrapeforge/facebook-search-posts")
    expect(apifyDiscoveryInput(packedFacebookSource, 25)).toMatchObject({
      query: "Araz Supermarket",
      search_type: "posts",
      max_results: 25,
    })

    // Google remains possible only as an explicit operator-configured actor
    // override; the batch input builder is unchanged for that explicit path.
    const explicitGoogleFallbackActors = {
      ...settings.searchIndex.apifyActors,
      facebookSearch: "apify/google-search-scraper",
    }
    const fallbackActor = apifyActorForSource(packedFacebookSource, "DISCOVER_POSTS", explicitGoogleFallbackActors)
    expect(fallbackActor).toBe("apify/google-search-scraper")
    expect(apifyDiscoveryInput(packedFacebookSource, 25, null, fallbackActor)).toMatchObject({
      queries: [
        "\"Araz Supermarket\" site:facebook.com",
        "\"Araz market\" site:facebook.com",
        "\"Araz\" site:facebook.com",
      ].join("\n"),
      maxPagesPerQuery: 1,
      resultsPerPage: 8,
    })

    const queryOnlyPackedFacebookSource: MonitoringSourceForRun = {
      ...facebookSource,
      query: "Araz Supermarket|Bravo Supermarket",
      keywords: [],
    }
    expect(apifyActorForSource(
      queryOnlyPackedFacebookSource,
      "DISCOVER_POSTS",
      settings.searchIndex.apifyActors,
    )).toBe("scrapeforge/facebook-search-posts")
    expect(apifyDiscoveryInput(queryOnlyPackedFacebookSource, 25)).toMatchObject({
      query: "Araz Supermarket",
    })

    // The operator's own query outranks legacy keyword rows: the source that
    // says query "Araz" must search "Araz", never a keyword that happens to
    // sort first.
    const conflictingFieldsSource: MonitoringSourceForRun = {
      ...facebookSource,
      query: "Araz",
      keywords: ["Bravo"],
    }
    expect(apifyActorForSource(
      conflictingFieldsSource,
      "DISCOVER_POSTS",
      settings.searchIndex.apifyActors,
    )).toBe("scrapeforge/facebook-search-posts")
    expect(apifyDiscoveryInput(conflictingFieldsSource, 25)).toMatchObject({
      query: "Araz",
    })

    const twentyTermSource: MonitoringSourceForRun = {
      ...facebookSource,
      query: "Brand 1",
      keywords: Array.from({ length: 20 }, (_, index) => `Brand ${index + 1}`),
    }
    expect(apifyActorForSource(
      twentyTermSource,
      "DISCOVER_POSTS",
      settings.searchIndex.apifyActors,
    )).toBe("scrapeforge/facebook-search-posts")
    expect(apifyDiscoveryInput(twentyTermSource, 25)).toMatchObject({
      query: "Brand 1",
    })
    expect(apifyDiscoveryInput(twentyTermSource, 100, null, "apify/google-search-scraper")).toMatchObject({
      maxPagesPerQuery: 1,
      resultsPerPage: 5,
    })
    expect(apifyDiscoveryInput(twentyTermSource, 10, null, "apify/google-search-scraper")).toBeNull()
    expect(apifyDiscoveryInput({
      ...twentyTermSource,
      keywords: [...twentyTermSource.keywords!, "Brand 21"],
    }, 100, null, "apify/google-search-scraper")).toBeNull()
    expect(apifyDiscoveryInput({
      ...facebookSource,
      query: "Araz",
      keywords: ["Araz"],
    }, 101, null, "apify/google-search-scraper")).toBeNull()
  })

  it("records the terms the singular native Facebook query cannot carry on the run snapshot only", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ query: "Araz Supermarket", search_type: "posts" })
      expect(body).not.toHaveProperty("leadDriveUnsentProviderTerms")
      return new Response(JSON.stringify({
        data: { id: "external-fb-1", defaultDatasetId: "dataset-fb-1", buildId: "immutable-build-id" },
      }), { status: 201 })
    }))

    await expect(runApifyAsyncCollector({
      ...source,
      platform: "facebook",
      sourceType: "keyword",
      query: "Araz Supermarket|Araz market|Araz",
      keywords: ["Araz Supermarket", "Araz market", "Araz"],
      url: null,
    })).resolves.toMatchObject({ status: "success" })
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorId: "scrapeforge/facebook-search-posts",
        inputSnapshot: expect.objectContaining({
          query: "Araz Supermarket",
          leadDriveUnsentProviderTerms: ["Araz market", "Araz"],
        }),
      }),
    }))
  })

  it("plans a fan-out child for the second segment of a pipe-packed canonical query (#638)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { id: "external-fb-canonical", defaultDatasetId: "dataset-fb-canonical", buildId: "immutable-build-id" },
    }), { status: 201 })))

    await expect(runApifyAsyncCollector({
      ...source,
      platform: "facebook",
      sourceType: "keyword",
      query: "Araz Supermarket| #ArazMarket",
      keywords: [],
      url: null,
      settings: { canonicalBrandQuery: true },
    })).resolves.toMatchObject({ status: "success" })
    const created = mockPrisma.socialProviderRun.create.mock.calls.at(-1)?.[0]?.data as {
      maxItems: number
      maxTotalChargeUsd: number
      inputSnapshot: Record<string, unknown>
    }
    // Pipe segments are trimmed before normalization, so " #ArazMarket"
    // loses its # instead of smuggling it into the audit or the query.
    expect(created.inputSnapshot).toMatchObject({
      query: "Araz Supermarket",
      leadDriveFacebookFanOutTerms: ["ArazMarket"],
    })
    // Аудит #635 остаётся честным: пока дочерний прогон не создан, термин
    // числится неотправленным. План запустить ребёнка — ещё не покрытие.
    expect(created.inputSnapshot).toMatchObject({
      leadDriveUnsentProviderTerms: ["ArazMarket"],
    })
    // Бюджет источника делится между слотами: родитель + один ребёнок,
    // сумма зарезервированного не превышает авторизованных 100 позиций.
    const childBudget = created.inputSnapshot.leadDriveFacebookFanOutBudget as {
      maxItems: number
      maxTotalChargeUsd: number
    }
    expect(created.maxItems + childBudget.maxItems).toBe(100)
    expect(created.maxTotalChargeUsd + childBudget.maxTotalChargeUsd).toBeCloseTo(1, 6)
  })

  it("extracts global terms from search URLs and keeps direct post URLs on direct actors", () => {
    const facebookSearchUrlSource: MonitoringSourceForRun = {
      ...source,
      platform: "facebook",
      sourceType: "search_url",
      query: null,
      keywords: [],
      url: "https://www.facebook.com/search/top?q=araz%20supermarket&filters=recent",
    }
    const facebookDirectPostSource: MonitoringSourceForRun = {
      ...facebookSearchUrlSource,
      url: "https://www.facebook.com/arazsupermarket/posts/123",
    }
    const instagramDirectPostSource: MonitoringSourceForRun = {
      ...facebookSearchUrlSource,
      platform: "instagram",
      url: "https://www.instagram.com/p/direct-post-1/",
    }

    expect(apifyActorForSource(facebookSearchUrlSource, "DISCOVER_POSTS", settings.searchIndex.apifyActors))
      .toBe("scrapeforge/facebook-search-posts")
    expect(apifyDiscoveryInput(facebookSearchUrlSource, 25)).toMatchObject({
      query: "araz supermarket",
      search_type: "posts",
    })

    expect(apifyActorForSource(facebookDirectPostSource, "DISCOVER_POSTS", settings.searchIndex.apifyActors))
      .toBe("apify/facebook-posts-scraper")
    expect(apifyDiscoveryInput(facebookDirectPostSource, 25)).toEqual({
      startUrls: [{ url: facebookDirectPostSource.url }],
      resultsLimit: 25,
    })

    expect(apifyActorForSource(instagramDirectPostSource, "DISCOVER_POSTS", settings.searchIndex.apifyActors))
      .toBe("apify/instagram-scraper")
    expect(apifyDiscoveryInput(instagramDirectPostSource, 25)).toMatchObject({
      directUrls: [instagramDirectPostSource.url],
      resultsLimit: 25,
      resultsType: "posts",
    })
  })

  it("passes exact supported provider date fields and omits them for unsupported hashtag discovery", () => {
    const providerWindow = {
      hours: 1,
      since: new Date("2026-07-22T19:55:00.000Z"),
      until: new Date("2026-07-22T21:00:00.000Z"),
      resumedFromWatermark: true,
      clamped: false,
    }
    expect(apifyDiscoveryInput({
      ...source,
      platform: "web",
      sourceType: "keyword",
      query: "Baku Electronics",
      keywords: ["Baku Electronics"],
      url: null,
    }, 25, providerWindow)).toMatchObject({
      queries: "\"Baku Electronics\" after:2026-07-21 before:2026-07-23",
    })
    expect(apifyDiscoveryInput({
      ...source,
      sourceType: "profile",
      query: "leaddrive",
      url: "https://www.instagram.com/leaddrive/",
    }, 25, providerWindow)).toMatchObject({
      onlyPostsNewerThan: "2026-07-22T19:55:00.000Z",
      skipPinnedPosts: true,
    })
    expect(apifyDiscoveryInput({
      ...source,
      platform: "instagram",
      sourceType: "keyword",
      query: "Baku Electronics",
      keywords: ["Baku Electronics"],
      url: null,
    }, 25, providerWindow)).toMatchObject({
      hashtags: ["Baku Electronics"],
      keywordSearch: true,
    })
    expect(apifyDiscoveryInput({
      ...source,
      platform: "facebook",
      sourceType: "search_url",
      query: "Baku Electronics",
      keywords: ["Baku Electronics"],
      url: null,
    }, 25, providerWindow)).toMatchObject({
      query: "Baku Electronics",
      start_date: "2026-07-22",
      end_date: "2026-07-22",
      recent_posts: true,
    })
    expect(apifyDiscoveryInput({ ...source, sourceType: "hashtag" }, 25, providerWindow))
      .not.toHaveProperty("onlyPostsNewerThan")
    expect(apifyDiscoveryInput({ ...source, sourceType: "hashtag" }, 25, providerWindow))
      .toMatchObject({ keywordSearch: false })
    expect(apifyDiscoveryInput({
      ...source,
      platform: "tiktok",
      sourceType: "profile",
      query: "leaddrive",
      url: null,
    }, 25, providerWindow)).toMatchObject({
      profileSorting: "latest",
      excludePinnedPosts: true,
      oldestPostDateUnified: "2026-07-22T19:55:00.000Z",
    })
    const tiktokKeywordInput = apifyDiscoveryInput({
      ...source,
      platform: "tiktok",
      sourceType: "keyword",
      query: "LeadDrive",
      url: null,
    }, 25, providerWindow)
    expect(tiktokKeywordInput).toMatchObject({
      searchQueries: ["LeadDrive"],
      maxItems: 25,
      resultsPerPage: 25,
    })
    expect(tiktokKeywordInput).not.toHaveProperty("videoSearchDateFilter")

    // Оператор может вернуть параметры точечно, не выкатывая код (#657).
    const tunedInput = apifyDiscoveryInput({
      ...source,
      platform: "tiktok",
      sourceType: "keyword",
      query: "LeadDrive",
      url: null,
      settings: {
        tiktokVideoSearch: {
          searchSection: "/video",
          videoSearchSorting: "LATEST",
          videoSearchDateFilter: "auto",
        },
      },
    }, 25, providerWindow)
    expect(tunedInput).toMatchObject({
      searchSection: "/video",
      videoSearchSorting: "LATEST",
      videoSearchDateFilter: "PAST_WEEK",
    })
  })

  it("uses the targeted scenario archive date for a confirmed manual discovery window", () => {
    const window = discoveryLookbackWindow({
      ...source,
      platform: "instagram",
      sourceType: "keyword",
      settings: {
        scenarioLinks: [],
        searchIndex: {
          fetchAfter: "2026-07-22T20:00:00.000Z",
          lookbackHours: 24,
        },
      },
      routeExecution: {
        ...source.routeExecution!,
        fullArchiveRun: true,
        targetScenarioId: "scenario-target",
        archiveStartAt: "2026-04-01T09:30:00.000Z",
      },
    }, new Date("2026-07-22T21:00:00.000Z"))

    expect(window.since.toISOString()).toBe("2026-04-01T09:30:00.000Z")
    expect(window.until.toISOString()).toBe("2026-07-22T21:00:00.000Z")
    expect(window.resumedFromWatermark).toBe(false)
    expect(window.clamped).toBe(false)
  })

  it("resumes a confirmed manual discovery from its scoped checkpoint", () => {
    const archiveStartAt = "2026-04-01T09:30:00.000Z"
    const archiveCursorKey = archiveProviderCursorKey({
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC:posts",
      fullArchiveRun: true,
      targetScenarioId: "scenario-target",
      archiveStartAt,
    })
    const window = discoveryLookbackWindow({
      ...source,
      platform: "instagram",
      sourceType: "keyword",
      settings: {
        scenarioLinks: [],
        searchIndex: {
          routeProviderCursors: {
            [archiveCursorKey]: {
              fetchAfter: "2026-07-22T20:00:00.000Z",
            },
          },
        },
      },
      routeExecution: {
        ...source.routeExecution!,
        routePlanId: "route-1",
        adapterKey: "APIFY_ASYNC",
        manualPaidRun: true,
        fullArchiveRun: true,
        targetScenarioId: "scenario-target",
        archiveStartAt,
      },
    }, new Date("2026-07-22T21:00:00.000Z"))

    expect(window.since.toISOString()).toBe("2026-07-22T20:00:00.000Z")
    expect(window.resumedFromWatermark).toBe(true)
  })

  it("applies the archive import gate to native discovery items and reviews unknown dates", () => {
    const lookbackWindow = {
      since: new Date("2026-04-01T09:30:00.000Z"),
      until: new Date("2026-07-22T21:00:00.000Z"),
    }
    const base = {
      phase: "DISCOVER_CANDIDATE_POSTS",
      platform: "instagram",
      webDiscoveryOrganicResult: false,
      lookbackWindow,
      title: "Baku Electronics",
      terms: ["Baku Electronics"],
      matchedTerm: "Baku Electronics",
    }

    expect(discoveryReviewDecision({
      ...base,
      publishedAt: new Date("2026-03-31T23:59:59.000Z"),
    })).toEqual({
      relevanceStatus: "REJECTED",
      reason: "discovery_outside_lookback_window",
    })
    expect(discoveryReviewDecision({
      ...base,
      publishedAt: null,
    })).toEqual({
      relevanceStatus: "REVIEW",
      reason: "discovery_missing_published_at",
    })
    expect(discoveryReviewDecision({
      ...base,
      publishedAt: new Date("2026-04-01T09:30:00.000Z"),
    })).toBeNull()
  })

  it("freezes the overlapped cursor window in the run snapshot without leaking internal metadata to the actor", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-22T21:00:00.000Z"))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        onlyPostsNewerThan: "2026-07-22T19:55:00.000Z",
        skipPinnedPosts: true,
      })
      expect(body).not.toHaveProperty("leadDriveProviderWindow")
      return new Response(JSON.stringify({
        data: { id: "external-incremental-1", defaultDatasetId: "dataset-incremental-1", buildId: "immutable-build-id" },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector({
      ...source,
      sourceType: "profile",
      query: "leaddrive",
      url: "https://www.instagram.com/leaddrive/",
      settings: {
        searchIndex: {
          routeProviderCursors: {
            "route-1:APIFY_ASYNC": {
              fetchAfter: "2026-07-22T20:00:00.000Z",
            },
          },
        },
      },
    })).resolves.toMatchObject({
      status: "success",
      rawStats: {
        cursorSince: "2026-07-22T20:00:00.000Z",
        since: "2026-07-22T19:55:00.000Z",
        until: "2026-07-22T21:00:00.000Z",
        providerWindowOverlapMinutes: 5,
      },
    })
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        inputSnapshot: expect.objectContaining({
          leadDriveProviderWindow: {
            cursorSince: "2026-07-22T20:00:00.000Z",
            since: "2026-07-22T19:55:00.000Z",
            until: "2026-07-22T21:00:00.000Z",
            resumedFromWatermark: true,
            clamped: false,
            overlapMinutes: 5,
          },
          leadDriveProviderCursorScope: {
            routePlanId: "route-1",
            adapterKey: "APIFY_ASYNC",
            fullArchiveRun: false,
            targetScenarioId: null,
            archiveStartAt: null,
          },
        }),
      }),
    }))
  })

  it("freezes the targeted scenario and archive-start cursor namespace for async import", async () => {
    const archiveStartAt = "2026-04-01T09:30:00.000Z"
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).not.toHaveProperty("leadDriveProviderCursorScope")
      return new Response(JSON.stringify({
        data: { id: "external-archive-1", defaultDatasetId: "dataset-archive-1", buildId: "immutable-build-id" },
      }), { status: 201 })
    }))

    const archiveSource: MonitoringSourceForRun = {
      ...clientFundedSource({
        fullArchiveRun: true,
        targetScenarioId: "scenario-target",
        archiveStartAt,
      }),
      sourceType: "profile",
      query: "leaddrive",
      url: "https://www.instagram.com/leaddrive/",
      settings: {
        scenarioLinks: [],
      },
    }
    await expect(runApifyAsyncCollector(archiveSource)).resolves.toMatchObject({
      status: "success",
      rawStats: { queued: true },
    })
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        inputSnapshot: expect.objectContaining({
          leadDriveFullArchiveRun: true,
          leadDriveTargetScenarioId: "scenario-target",
          leadDriveArchiveStartAt: archiveStartAt,
          leadDriveProviderCursorScope: {
            routePlanId: "route-1",
            adapterKey: "APIFY_ASYNC",
            fullArchiveRun: true,
            targetScenarioId: "scenario-target",
            archiveStartAt,
          },
        }),
      }),
    }))
  })

  it("authenticates webhook secrets in constant-shape HMAC form and rejects a wrong secret", () => {
    const run = { organizationId: "org-1", idempotencyKey: "idem-1", webhookSecretHash: deps.hmacToken("correct", "apify-webhook:org-1:idem-1") }
    expect(verifyApifyWebhookSecret(run, "correct")).toBe(true)
    expect(verifyApifyWebhookSecret(run, "wrong")).toBe(false)
  })

  it("keeps the callback secret out of the webhook URL and sends it as a custom header", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://crm.example")
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const endpoint = new URL(String(input))
      const encodedWebhooks = endpoint.searchParams.get("webhooks")
      expect(encodedWebhooks).toBeTruthy()
      const webhooks = JSON.parse(Buffer.from(encodedWebhooks!, "base64").toString("utf8"))
      const callback = new URL(webhooks[0].requestUrl)

      expect(callback.origin).toBe("https://crm.example")
      expect(callback.searchParams.get("runId")).toBe("provider-run-1")
      expect(callback.searchParams.has("secret")).toBe(false)
      expect(JSON.parse(webhooks[0].headersTemplate)).toEqual({
        "X-LeadDrive-Apify-Secret": expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
      })
      return new Response(JSON.stringify({
        data: {
          id: "external-run-1",
          defaultDatasetId: "dataset-1",
          buildId: "immutable-build-id",
        },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "success",
      rawStats: { providerRunId: "provider-run-1", queued: true },
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("acknowledges duplicate delivery of an already imported run without fetching the dataset again", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({ providerKey: "APIFY", status: "IMPORTED", acceptedCount: 7 })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 7 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns the concurrently-created provider run on an idempotency race", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "raced-run", status: "QUEUED", receivedCount: 0, acceptedCount: 0, duplicateCount: 0, rejectedCount: 0, reviewCount: 0, lastError: null })
    mockPrisma.socialProviderRun.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({ status: "success", rawStats: { providerRunId: "raced-run", providerStatus: "QUEUED", queued: true } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("retains the paid reservation when the provider start response is ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network_timeout")))

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "partial",
      error: "apify_start_dispatch_unknown",
      rawStats: {
        providerRunId: "provider-run-1",
        providerStatus: "RUNNING",
        queued: true,
        dispatchUnknown: true,
      },
    })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "provider-run-1" }),
      data: expect.objectContaining({
        status: "RUNNING",
        lastError: "apify_start_dispatch_unknown",
      }),
    })
    expect(mockPrisma.socialProviderRun.updateMany.mock.calls[0]?.[0]?.data)
      .not.toHaveProperty("reservedChargeUsd")
  })

  it("closes an unreconciled ambiguous start after its timeout without releasing exposure", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-22T21:06:00.000Z"))
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-unknown",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      externalRunId: null,
      lastError: "apify_start_dispatch_unknown",
      startedAt: new Date("2026-07-22T21:00:00.000Z"),
      createdAt: new Date("2026-07-22T21:00:00.000Z"),
      timeoutSeconds: 30,
      source,
      routePlan: {},
    })

    await expect(importApifyProviderRun("provider-run-unknown")).resolves.toEqual({
      status: "BLOCKED",
      imported: 0,
      error: "apify_start_dispatch_unreconciled",
    })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "provider-run-unknown" }),
      data: expect.objectContaining({
        status: "BLOCKED",
        lastError: "apify_start_dispatch_unreconciled",
      }),
    })
    expect(mockPrisma.socialProviderRun.updateMany.mock.calls[0]?.[0]?.data)
      .not.toHaveProperty("reservedChargeUsd")
  })

  it("retains the paid reservation when a terminal failure omits usage", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-failed",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      externalRunId: "external-failed",
      createdAt: new Date("2026-07-28T10:00:00.000Z"),
      timeoutSeconds: 900,
      source,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { status: "FAILED" },
    }), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-failed")).resolves.toEqual({
      status: "FAILED",
      imported: 0,
      error: "apify_failed",
    })
    const terminalData = mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data
    expect(terminalData).toMatchObject({
      status: "FAILED",
      lastError: "apify_failed",
    })
    expect(terminalData).not.toHaveProperty("reservedChargeUsd")
    expect(terminalData).not.toHaveProperty("actualChargeUsd")
  })

  // Прод 2026-08-03: пять прогонов умерли у провайдера, успев собрать и
  // выставить в счёт сотни записей (~$1 каждый). Набор данных лежал на месте,
  // а код на статусе «упал» его выбрасывал — деньги в ноль.
  it("imports the paid dataset of a run that failed at the provider, keeping coverage partial", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-failed-with-data",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/instagram-hashtag-scraper",
      externalRunId: "external-failed-with-data",
      maxItems: 500,
      timeoutSeconds: 900,
      createdAt: new Date("2026-08-03T06:50:00.000Z"),
      source,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({
        data: {
          status: "FAILED",
          defaultDatasetId: "dataset-failed-with-data",
          usageTotalUsd: 1.06,
        },
      }), { status: 200 })
      : new Response(JSON.stringify([{
        id: "ig-1",
        caption: "leaddrive review",
        url: "https://www.instagram.com/p/failed-run-item/",
        timestamp: "2026-08-03T05:00:00.000Z",
        inputUrl: "https://instagram.com/explore/tags/leaddrive/",
      }]), { status: 200 })))

    const result = await importApifyProviderRun("provider-run-failed-with-data")

    // Записи забраны, но покрытие частичное: курсор двигать нельзя.
    expect(result).toMatchObject({ status: "PARTIAL", error: "apify_failed" })
    expect(deps.ingestMentionWithResult).toHaveBeenCalled()
    const terminalData = mockPrisma.socialProviderRun.updateMany.mock.calls
      .map(call => call?.[0]?.data)
      .findLast((data: Record<string, unknown> | undefined) => data?.status === "PARTIAL")
    expect(terminalData).toMatchObject({
      status: "PARTIAL",
      lastError: "apify_failed",
      receivedCount: 1,
    })
    // Курсор двигается только на IMPORTED, поэтому оплаченный, но неполный
    // прогон покрытием не считается и окно перечитается.
    expect(mockPrisma.socialProviderRun.updateMany.mock.calls
      .some(call => call?.[0]?.data?.status === "IMPORTED")).toBe(false)
  })

  it("retains the paid reservation while a terminal provider charge is still preliminary", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-28T10:00:00.000Z"))
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-preliminary-cost",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      externalRunId: "external-preliminary-cost",
      reservedChargeUsd: 1,
      createdAt: new Date("2026-07-28T09:55:00.000Z"),
      timeoutSeconds: 900,
      source,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: {
        status: "FAILED",
        finishedAt: "2026-07-28T09:59:55.000Z",
        usageTotalUsd: 0,
      },
    }), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-preliminary-cost")).resolves.toEqual({
      status: "FAILED",
      imported: 0,
      error: "apify_failed",
    })
    const terminalData = mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data
    expect(terminalData).toMatchObject({
      status: "FAILED",
      lastError: "apify_failed",
    })
    expect(terminalData).not.toHaveProperty("reservedChargeUsd")
    expect(terminalData).not.toHaveProperty("actualChargeUsd")
  })

  it("settles a retained reservation after Apify reports a stable terminal charge", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-stable-cost",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "IMPORTED",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      acceptedCount: 3,
      collectorRunId: "collector-1",
      externalRunId: "external-stable-cost",
      reservedChargeUsd: { toString: () => "1" },
      source,
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: {
        status: "SUCCEEDED",
        finishedAt: "2020-01-01T00:00:00.000Z",
        usageTotalUsd: 0.12,
      },
    }), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-stable-cost")).resolves.toEqual({
      status: "IMPORTED",
      imported: 3,
    })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "provider-run-stable-cost" }),
      data: {
        actualChargeUsd: 0.12,
        reservedChargeUsd: 0,
      },
    })
  })

  it("rejects a negative provider charge without releasing the reservation", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-negative-cost",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "IMPORTED",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      acceptedCount: 1,
      collectorRunId: "collector-1",
      externalRunId: "external-negative-cost",
      reservedChargeUsd: { toString: () => "1" },
      source,
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: {
        status: "SUCCEEDED",
        finishedAt: "2020-01-01T00:00:00.000Z",
        usageTotalUsd: -0.12,
      },
    }), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-negative-cost")).resolves.toEqual({
      status: "IMPORTED",
      imported: 1,
    })
    expect(mockPrisma.socialProviderRun.updateMany).not.toHaveBeenCalled()
  })

  it("settles a locally failed schema run without downloading its bad dataset again", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-failed-schema",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "FAILED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      externalRunId: "external-failed-schema",
      reservedChargeUsd: { toString: () => "1" },
      lastError: "apify_schema_drift_non_array",
      source,
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: {
        status: "SUCCEEDED",
        finishedAt: "2020-01-01T00:00:00.000Z",
        usageTotalUsd: 0.08,
      },
    }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(importApifyProviderRun("provider-run-failed-schema")).resolves.toEqual({
      status: "FAILED",
      imported: 0,
      error: "apify_schema_drift_non_array",
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "provider-run-failed-schema" }),
      data: {
        actualChargeUsd: 0.08,
        reservedChargeUsd: 0,
      },
    })
  })

  it("settles a retained charge after provider transit data was purged", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-purged-cost",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "PURGED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 2,
      collectorRunId: "collector-1",
      externalRunId: "external-purged-cost",
      reservedChargeUsd: { toString: () => "1" },
      lastError: null,
      source,
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: {
        status: "SUCCEEDED",
        finishedAt: "2020-01-01T00:00:00.000Z",
        usageTotalUsd: 0.11,
      },
    }), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-purged-cost")).resolves.toEqual({
      status: "PURGED",
      imported: 2,
    })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "provider-run-purged-cost" }),
      data: {
        actualChargeUsd: 0.11,
        reservedChargeUsd: 0,
      },
    })
  })

  it("releases an abandoned queue reservation only when the durable marker is exact false", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-28T10:10:00.000Z"))
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-abandoned-undispatched",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "QUEUED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      externalRunId: null,
      inputSnapshot: { providerRequestDispatched: false },
      reservedChargeUsd: { toString: () => "1" },
      actualChargeUsd: null,
      createdAt: new Date("2026-07-28T10:00:00.000Z"),
      timeoutSeconds: 30,
      source,
    })

    await expect(importApifyProviderRun("provider-run-abandoned-undispatched")).resolves.toEqual({
      status: "BLOCKED",
      imported: 0,
      error: "apify_queued_dispatch_unreconciled",
    })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "provider-run-abandoned-undispatched",
        status: "QUEUED",
        externalRunId: null,
        inputSnapshot: { path: ["providerRequestDispatched"], equals: false },
      }),
      data: expect.objectContaining({
        status: "BLOCKED",
        lastError: "apify_queued_dispatch_unreconciled",
        reservedChargeUsd: 0,
      }),
    })
  })

  it("terminalizes an abandoned legacy queue without releasing unknown exposure", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-28T10:10:00.000Z"))
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-abandoned-queue",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "QUEUED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      externalRunId: null,
      reservedChargeUsd: { toString: () => "1" },
      createdAt: new Date("2026-07-28T10:00:00.000Z"),
      timeoutSeconds: 30,
      source,
    })

    await expect(importApifyProviderRun("provider-run-abandoned-queue")).resolves.toEqual({
      status: "BLOCKED",
      imported: 0,
      error: "apify_queued_dispatch_unreconciled",
    })
    const blockedData = mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data
    expect(blockedData).toMatchObject({
      status: "BLOCKED",
      lastError: "apify_queued_dispatch_unreconciled",
    })
    expect(blockedData).not.toHaveProperty("reservedChargeUsd")
  })

  it("does not release an anomalous queued reservation whose dispatch marker is true", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-28T10:10:00.000Z"))
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-abandoned-claimed",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "QUEUED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      externalRunId: null,
      inputSnapshot: { providerRequestDispatched: true },
      reservedChargeUsd: { toString: () => "1" },
      actualChargeUsd: null,
      createdAt: new Date("2026-07-28T10:00:00.000Z"),
      timeoutSeconds: 30,
      source,
    })

    await expect(importApifyProviderRun("provider-run-abandoned-claimed")).resolves.toEqual({
      status: "BLOCKED",
      imported: 0,
      error: "apify_queued_dispatch_unreconciled",
    })
    const blockedData = mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data
    expect(blockedData).toMatchObject({
      status: "BLOCKED",
      lastError: "apify_queued_dispatch_unreconciled",
    })
    expect(blockedData).not.toHaveProperty("reservedChargeUsd")
  })

  it("continues reconciliation after one run fails and preserves a terminal settlement lane", async () => {
    const activeRun = {
      id: "provider-run-active-error",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      externalRunId: "external-active-error",
      createdAt: new Date("2026-07-28T09:00:00.000Z"),
      timeoutSeconds: 900,
      source,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    }
    const terminalRun = {
      id: "provider-run-terminal-cost",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "FAILED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      externalRunId: "external-terminal-cost",
      reservedChargeUsd: { toString: () => "1" },
      lastError: "apify_schema_drift_non_array",
      source,
    }
    mockPrisma.socialProviderRun.findMany
      .mockResolvedValueOnce([{ id: terminalRun.id }])
      .mockResolvedValueOnce([{ id: activeRun.id }])
    mockPrisma.socialProviderRun.findUnique
      .mockResolvedValueOnce(terminalRun)
      .mockResolvedValueOnce(activeRun)
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes(activeRun.externalRunId)) throw new Error("temporary provider failure")
      return new Response(JSON.stringify({
        data: {
          status: "SUCCEEDED",
          finishedAt: "2020-01-01T00:00:00.000Z",
          usageTotalUsd: 0.09,
        },
      }), { status: 200 })
    }))

    await expect(reconcileApifyProviderRuns(2)).resolves.toEqual([
      {
        id: terminalRun.id,
        status: "FAILED",
        imported: 0,
        error: "apify_schema_drift_non_array",
      },
      {
        id: activeRun.id,
        status: "FAILED",
        imported: 0,
        error: "apify_reconcile_failed",
      },
    ])
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: terminalRun.id }),
      data: {
        actualChargeUsd: 0.09,
        reservedChargeUsd: 0,
      },
    })
    expect(mockPrisma.socialProviderRun.findMany.mock.calls[0]?.[0]?.where.status.in)
      .toEqual(["IMPORTED", "PARTIAL", "FAILED", "PURGED"])
    // Полоса терминальных прогонов — ЕДИНСТВЕННАЯ, которая возвращается к уже
    // импортированному прогону. Каждый pending-маркер обязан быть в её
    // выборке, иначе сорванный диспатч зависших детей не повторит никто.
    expect(mockPrisma.socialProviderRun.findMany.mock.calls[0]?.[0]?.where.OR)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          inputSnapshot: {
            path: ["leadDriveDependentCommentsPending"],
            equals: true,
          },
        }),
        expect.objectContaining({
          inputSnapshot: {
            path: ["leadDriveDependentInstagramReelsPending"],
            equals: true,
          },
        }),
        expect.objectContaining({
          inputSnapshot: {
            path: ["leadDriveDependentFacebookFanOutPending"],
            equals: true,
          },
        }),
      ]))
    expect(mockPrisma.socialProviderRun.findMany.mock.calls[1]?.[0]?.where.status.in)
      .toEqual(["QUEUED", "RUNNING", "IMPORTING"])
    const rotationCalls = mockPrisma.socialProviderRun.updateMany.mock.calls
      .map(call => call[0])
      .filter(call => call?.data?.updatedAt instanceof Date)
    expect(rotationCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        where: { id: terminalRun.id, providerKey: "APIFY" },
      }),
      expect.objectContaining({
        where: { id: activeRun.id, providerKey: "APIFY" },
      }),
    ]))
  })

  it("does not age a preliminary cost while importing a slow dataset", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-28T10:00:00.000Z"))
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-slow-import",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      externalRunId: "external-slow-import",
      datasetId: "dataset-slow-import",
      reservedChargeUsd: 1,
      maxItems: 100,
      timeoutSeconds: 900,
      actorBuild: "stable",
      createdAt: new Date("2026-07-28T09:55:00.000Z"),
      inputSnapshot: {},
      source,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/actor-runs/")) {
        return new Response(JSON.stringify({
          data: {
            status: "SUCCEEDED",
            defaultDatasetId: "dataset-slow-import",
            finishedAt: "2026-07-28T09:59:55.000Z",
            usageTotalUsd: 0,
          },
        }), { status: 200 })
      }
      vi.setSystemTime(new Date("2026-07-28T10:00:20.000Z"))
      return new Response(JSON.stringify([{
        id: "post-slow-import",
        url: "https://instagram.com/p/post-slow-import",
        caption: "leaddrive",
        timestamp: "2026-07-28T09:59:00.000Z",
      }]), { status: 200 })
    }))

    await expect(importApifyProviderRun("provider-run-slow-import")).resolves.toEqual({
      status: "IMPORTED",
      imported: 1,
    })
    const finalData = mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data
    expect(finalData).toMatchObject({
      status: "IMPORTED",
      acceptedCount: 1,
    })
    expect(finalData).not.toHaveProperty("reservedChargeUsd")
    expect(finalData).not.toHaveProperty("actualChargeUsd")
  })

  it("lets only the compare-and-set winner import a webhook dataset", async () => {
    const running = {
      id: "provider-run-concurrent-webhook",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/instagram-hashtag-scraper",
      externalRunId: "external-concurrent-webhook",
      datasetId: "dataset-concurrent-webhook",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "0.0.585",
      createdAt: new Date("2026-07-28T09:55:00.000Z"),
      finishedAt: null,
      inputSnapshot: {},
      source,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    }
    mockPrisma.socialProviderRun.findUnique
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce({
        status: "IMPORTING",
        acceptedCount: 0,
        lastError: null,
      })
    mockPrisma.socialProviderRun.updateMany.mockResolvedValueOnce({ count: 0 })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/actor-runs/external-concurrent-webhook")
      return new Response(JSON.stringify({
        data: {
          status: "SUCCEEDED",
          defaultDatasetId: "dataset-concurrent-webhook",
        },
      }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(importApifyProviderRun(running.id)).resolves.toEqual({
      status: "IMPORTING",
      imported: 0,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: running.id,
        status: { in: ["QUEUED", "RUNNING", "SUCCEEDED"] },
      }),
      data: expect.objectContaining({
        status: "IMPORTING",
        datasetId: "dataset-concurrent-webhook",
      }),
    }))
  })

  it("does not persist a claimed dataset after the clean-slate fence engages", async () => {
    const running = {
      id: "provider-run-reset-race",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/instagram-hashtag-scraper",
      externalRunId: "external-reset-race",
      datasetId: "dataset-reset-race",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "0.0.585",
      createdAt: new Date("2026-07-28T09:55:00.000Z"),
      finishedAt: null,
      inputSnapshot: {},
      source,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue(running)
    deps.runWithinImportFence
      .mockImplementationOnce(async (_input: unknown, persist: () => Promise<unknown>) => ({
        allowed: true,
        value: await persist(),
      }))
      .mockResolvedValueOnce({
        allowed: false,
        reason: "social_monitoring_collection_blocked",
      })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes("/actor-runs/")
        ? new Response(JSON.stringify({
            data: {
              status: "SUCCEEDED",
              defaultDatasetId: "dataset-reset-race",
            },
          }), { status: 200 })
        : new Response(JSON.stringify([{
            id: "post-after-reset",
            url: "https://instagram.com/p/post-after-reset",
            caption: "leaddrive",
            timestamp: "2026-07-28T09:59:00.000Z",
          }]), { status: 200 })
    )))

    await expect(importApifyProviderRun(running.id)).resolves.toEqual({
      status: "BLOCKED",
      imported: 0,
      error: "social_monitoring_collection_blocked",
    })
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(mockPrisma.mentionEvidence.create).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "IMPORTED" }) }),
    )
  })

  it("queues one comment extraction after the reels companion is imported", async () => {
    const importedRun = {
      id: "discovery-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      parentRunId: "instagram-posts-root",
      providerKey: "APIFY",
      actorId: "apify/instagram-hashtag-scraper",
      status: "IMPORTED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 2,
      collectorRunId: "collector-1",
      inputSnapshot: {
        leadDriveInstagramResultsType: "reels",
      },
      source,
    }
    mockPrisma.socialProviderRun.findUnique
      .mockResolvedValueOnce(importedRun)
      .mockResolvedValueOnce(null)
    mockPrisma.sourceRoutePlan.findMany.mockResolvedValue([{
      id: "comments-route-1",
      capability: "READ_EXTERNAL_COMMENTS",
      acquisitionMode: "APIFY_FALLBACK",
    }])
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({
      id: "discovery-run-1",
      parentRunId: "instagram-posts-root",
      actorId: "apify/instagram-hashtag-scraper",
      inputSnapshot: { leadDriveInstagramResultsType: "reels" },
      createdAt: new Date(),
    })
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([
      {
        providerRunId: "discovery-run-1",
        canonicalUrl: "https://instagram.com/reel/reel-1",
        url: "https://instagram.com/reel/reel-1",
      },
      {
        providerRunId: "instagram-posts-root",
        canonicalUrl: "https://instagram.com/p/post-1",
        url: "https://instagram.com/p/post-1",
      },
    ])
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = new URL(String(input))
      expect(endpoint.searchParams.get("build")).toBe("0.0.502")
      expect(endpoint.searchParams.get("restartOnError")).toBe("false")
      expect(endpoint.searchParams.get("maxItems")).toBe("100")
      expect(endpoint.searchParams.get("maxTotalChargeUsd")).toBe("1")
      expect(JSON.parse(String(init?.body))).toMatchObject({
        directUrls: [
          "https://instagram.com/reel/reel-1",
          "https://instagram.com/p/post-1",
        ],
        includeNestedComments: true,
      })
      return new Response(JSON.stringify({
        data: { id: "external-comments-1", defaultDatasetId: "dataset-comments-1", buildId: "immutable-build-id" },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(importApifyProviderRun("discovery-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 2 })
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        routePlanId: "comments-route-1",
        parentRunId: "instagram-posts-root",
        phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      }),
    }))
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledOnce()
    expect(mockPrisma.ingestEnvelope.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        providerRunId: {
          in: ["discovery-run-1", "instagram-posts-root"],
        },
      }),
    }))
    expect(mockPrisma.ingestEnvelope.findMany.mock.calls[0][0].where).toMatchObject({ sourceId: "src-1" })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalRunId: "external-comments-1", actorBuild: "immutable-build-id", status: "RUNNING" }),
    }))
  })

  it("queues comments from imported posts after the reels companion fails", async () => {
    const importedRoot = {
      id: "instagram-posts-root-failed-reels",
      organizationId: "org-1",
      sourceId: "src-1",
      routePlanId: "route-1",
      providerKey: "APIFY",
      actorId: "apify/instagram-hashtag-scraper",
      status: "IMPORTED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 1,
      collectorRunId: "collector-pair-failed-reels",
      inputSnapshot: {
        hashtags: ["leaddrive"],
        resultsType: "posts",
        leadDriveInstagramResultsType: "posts",
        leadDriveInstagramReelsBudget: {
          maxItems: 50,
          maxTotalChargeUsd: 0.5,
        },
        leadDriveDependentInstagramReelsPending: true,
        leadDriveProviderWindow: {
          since: "2026-07-28T08:00:00.000Z",
          until: "2026-07-28T09:00:00.000Z",
        },
      },
      source,
    }
    mockPrisma.socialProviderRun.findUnique
      .mockResolvedValueOnce(importedRoot)
      .mockResolvedValueOnce(null)
    mockPrisma.socialProviderRun.findFirst
      .mockResolvedValueOnce({ id: "instagram-reels-failed", status: "FAILED" })
      .mockResolvedValueOnce({
        id: "instagram-posts-root-failed-reels",
        createdAt: new Date("2026-07-28T09:00:00.000Z"),
      })
    mockPrisma.sourceRoutePlan.findMany.mockResolvedValue([{
      id: "comments-route-1",
      capability: "READ_EXTERNAL_COMMENTS",
      acquisitionMode: "APIFY_FALLBACK",
    }])
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([{
      canonicalUrl: "https://instagram.com/p/post-from-successful-root",
      url: "https://instagram.com/p/post-from-successful-root",
    }])
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        directUrls: ["https://instagram.com/p/post-from-successful-root"],
        includeNestedComments: true,
      })
      return new Response(JSON.stringify({
        data: {
          id: "external-comments-after-reels-failure",
          defaultDatasetId: "dataset-comments-after-reels-failure",
          buildId: "build-comments-after-reels-failure",
        },
      }), { status: 201 })
    }))

    await expect(importApifyProviderRun(importedRoot.id)).resolves.toEqual({
      status: "IMPORTED",
      imported: 1,
    })
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        parentRunId: importedRoot.id,
        routePlanId: "comments-route-1",
        phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: importedRoot.id,
        organizationId: importedRoot.organizationId,
        providerKey: "APIFY",
        purgedAt: null,
        status: { in: ["IMPORTED", "PARTIAL"] },
      },
      data: {
        inputSnapshot: expect.not.objectContaining({
          leadDriveDependentInstagramReelsPending: true,
        }),
      },
    })
  })

  it("still queues the reels companion when the posts dataset is empty", async () => {
    const rootRun = {
      id: "instagram-empty-posts-root",
      organizationId: "org-1",
      sourceId: "src-1",
      routePlanId: "route-1",
      providerKey: "APIFY",
      actorId: "apify/instagram-hashtag-scraper",
      actorBuild: "0.0.585",
      externalRunId: "external-empty-posts-root",
      datasetId: "dataset-empty-posts-root",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-empty-posts-pair",
      maxItems: 50,
      timeoutSeconds: 900,
      createdAt: new Date("2026-07-28T09:00:00.000Z"),
      inputSnapshot: {
        hashtags: ["leaddrive"],
        resultsLimit: 50,
        resultsType: "posts",
        keywordSearch: false,
        leadDriveInstagramResultsType: "posts",
        leadDriveInstagramReelsBudget: {
          maxItems: 50,
          maxTotalChargeUsd: 0.5,
        },
        leadDriveProviderWindow: {
          cursorSince: "2026-07-28T08:00:00.000Z",
          since: "2026-07-28T07:55:00.000Z",
          until: "2026-07-28T09:00:00.000Z",
          resumedFromWatermark: true,
          clamped: false,
          overlapMinutes: 5,
        },
      },
      source,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    }
    mockPrisma.socialProviderRun.findUnique
      .mockResolvedValueOnce(rootRun)
      .mockResolvedValueOnce(null)
    mockPrisma.socialProviderRun.findFirst
      .mockResolvedValueOnce({
        inputSnapshot: {
          ...rootRun.inputSnapshot,
          leadDriveDependentInstagramReelsPending: true,
        },
      })
      .mockResolvedValue(null)
    mockPrisma.sourceRoutePlan.findFirst
      .mockResolvedValueOnce({
        id: "route-1",
        capability: "DISCOVER_POSTS",
        acquisitionMode: "APIFY_FALLBACK",
      })
      .mockResolvedValueOnce({
        budget: {
          maxItems: 100,
          maxTotalChargeUsd: 1,
          dailyBudgetUsd: 5,
          monthlyBudgetUsd: 50,
          usdLimitsConfigured: true,
          timeoutSeconds: 900,
        },
        freshnessMinutes: 60,
      })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = String(input)
      if (endpoint.includes("/actor-runs/")) {
        return new Response(JSON.stringify({
          data: {
            status: "SUCCEEDED",
            defaultDatasetId: "dataset-empty-posts-root",
            usageTotalUsd: 0.1,
          },
        }), { status: 200 })
      }
      if (endpoint.includes("/datasets/")) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      expect(JSON.parse(String(init?.body))).toMatchObject({
        hashtags: ["leaddrive"],
        resultsLimit: 50,
        resultsType: "reels",
        keywordSearch: false,
      })
      return new Response(JSON.stringify({
        data: {
          id: "external-reels-after-empty-posts",
          defaultDatasetId: "dataset-reels-after-empty-posts",
          buildId: "build-reels-after-empty-posts",
        },
      }), { status: 201 })
    }))

    await expect(importApifyProviderRun(rootRun.id)).resolves.toEqual({
      status: "PARTIAL",
      imported: 0,
      error: "apify_empty_discovery_dataset",
    })
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        parentRunId: rootRun.id,
        phase: "DISCOVER_CANDIDATE_POSTS",
        maxItems: 50,
        maxTotalChargeUsd: 0.5,
        inputSnapshot: expect.objectContaining({
          resultsType: "reels",
          leadDriveInstagramResultsType: "reels",
        }),
      }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: rootRun.id }),
      data: expect.objectContaining({
        status: "PARTIAL",
        lastError: "apify_empty_discovery_dataset",
        inputSnapshot: expect.objectContaining({
          leadDriveDependentInstagramReelsPending: true,
        }),
      }),
    }))
    // The child performs exactly its reservation lock and durable dispatch
    // claim; the PARTIAL posts member must not also advance its cursor.
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2)
  })

  it("queues a budget-split reels companion with a stable parent-scoped key", async () => {
    const reelsCursorKey = archiveProviderCursorKey({
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC:reels",
      fullArchiveRun: false,
      targetScenarioId: null,
      archiveStartAt: null,
    })
    const importedRoot = {
      id: "instagram-posts-root",
      organizationId: "org-1",
      sourceId: "src-1",
      routePlanId: "route-1",
      providerKey: "APIFY",
      actorId: "apify/instagram-hashtag-scraper",
      status: "IMPORTED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 2,
      collectorRunId: "collector-pair",
      inputSnapshot: {
        hashtags: ["leaddrive"],
        resultsType: "posts",
        keywordSearch: false,
        leadDriveInstagramResultsType: "posts",
        leadDriveInstagramReelsBudget: {
          maxItems: 50,
          maxTotalChargeUsd: 0.5,
        },
        leadDriveDependentInstagramReelsPending: true,
        leadDriveProviderWindow: {
          cursorSince: "2026-07-28T08:00:00.000Z",
          since: "2026-07-28T07:45:00.000Z",
          until: "2026-07-28T09:00:00.000Z",
          resumedFromWatermark: true,
          clamped: false,
          overlapMinutes: 15,
        },
        leadDriveProviderCursorScope: {
          routePlanId: "route-1",
          adapterKey: "APIFY_ASYNC:posts",
          fullArchiveRun: false,
          targetScenarioId: null,
          archiveStartAt: null,
        },
      },
      source: {
        ...source,
        settings: {
          searchIndex: {
            routeProviderCursors: {
              [reelsCursorKey]: {
                fetchAfter: "2026-07-28T06:30:00.000Z",
              },
            },
          },
        },
      },
    }
    mockPrisma.socialProviderRun.findUnique
      .mockResolvedValueOnce(importedRoot)
      .mockResolvedValueOnce(null)
    mockPrisma.sourceRoutePlan.findFirst
      .mockResolvedValueOnce({
        id: "route-1",
        capability: "DISCOVER_POSTS",
        acquisitionMode: "APIFY_FALLBACK",
      })
      .mockResolvedValueOnce({
        budget: {
          maxItems: 100,
          maxTotalChargeUsd: 1,
          dailyBudgetUsd: 5,
          monthlyBudgetUsd: 50,
          usdLimitsConfigured: true,
          timeoutSeconds: 900,
        },
        freshnessMinutes: 60,
      })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = new URL(String(input))
      expect(endpoint.searchParams.get("maxItems")).toBe("50")
      expect(endpoint.searchParams.get("maxTotalChargeUsd")).toBe("0.5")
      expect(JSON.parse(String(init?.body))).toMatchObject({
        hashtags: ["leaddrive"],
        resultsLimit: 50,
        resultsType: "reels",
        keywordSearch: false,
      })
      return new Response(JSON.stringify({
        data: {
          id: "external-instagram-reels",
          defaultDatasetId: "dataset-instagram-reels",
          buildId: "build-instagram-reels",
        },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(importApifyProviderRun("instagram-posts-root")).resolves.toEqual({
      status: "IMPORTED",
      imported: 2,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.sourceRoutePlan.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        parentRunId: "instagram-posts-root",
        routePlanId: "route-1",
        phase: "DISCOVER_CANDIDATE_POSTS",
        maxItems: 50,
        maxTotalChargeUsd: 0.5,
        reservedChargeUsd: 0.5,
        idempotencyKey: expect.stringContaining(":parent:instagram-posts-root:"),
        inputSnapshot: expect.objectContaining({
          resultsType: "reels",
          leadDriveInstagramResultsType: "reels",
          leadDriveProviderCursorScope: expect.objectContaining({
            adapterKey: "APIFY_ASYNC:reels",
          }),
          leadDriveProviderWindow: expect.objectContaining({
            cursorSince: "2026-07-28T06:30:00.000Z",
            since: "2026-07-28T06:25:00.000Z",
            until: "2026-07-28T09:00:00.000Z",
          }),
        }),
      }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: importedRoot.id }),
      }),
    )

    mockPrisma.socialProviderRun.findUnique.mockResolvedValue(importedRoot)
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({
      id: "provider-run-1",
      status: "RUNNING",
    })
    await expect(importApifyProviderRun("instagram-posts-root")).resolves.toEqual({
      status: "IMPORTED",
      imported: 2,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledOnce()

    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({
      id: "provider-run-1",
      status: "IMPORTED",
    })
    await expect(importApifyProviderRun("instagram-posts-root")).resolves.toEqual({
      status: "IMPORTED",
      imported: 2,
    })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "instagram-posts-root" }),
        data: expect.objectContaining({
          inputSnapshot: expect.not.objectContaining({
            leadDriveDependentInstagramReelsPending: true,
          }),
        }),
      }),
    )
  })

  it("queues one Facebook fan-out child per alias term, each on its own cursor (#638)", async () => {
    const aliasCursorKey = archiveProviderCursorKey({
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC:term:obamarket",
      fullArchiveRun: false,
      targetScenarioId: null,
      archiveStartAt: null,
    })
    const importedParent = {
      id: "facebook-canonical-root",
      organizationId: "org-1",
      sourceId: "src-1",
      routePlanId: "route-1",
      providerKey: "APIFY",
      actorId: "scrapeforge/facebook-search-posts",
      status: "IMPORTED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 3,
      collectorRunId: "collector-fanout",
      inputSnapshot: {
        query: "Oba Market",
        search_type: "posts",
        max_results: 50,
        leadDriveFacebookFanOutTerms: ["obamarket"],
        leadDriveFacebookFanOutBudget: { maxItems: 50, maxTotalChargeUsd: 0.5 },
        leadDriveDependentFacebookFanOutPending: true,
        leadDriveSuppressDependentPaidRuns: true,
        leadDriveProviderWindow: {
          cursorSince: "2026-07-28T08:00:00.000Z",
          since: "2026-07-28T07:45:00.000Z",
          until: "2026-07-28T09:00:00.000Z",
          resumedFromWatermark: true,
          clamped: false,
          overlapMinutes: 15,
        },
        leadDriveProviderCursorScope: {
          routePlanId: "route-1",
          adapterKey: "APIFY_ASYNC",
          fullArchiveRun: false,
          targetScenarioId: null,
          archiveStartAt: null,
        },
      },
      source: {
        ...source,
        platform: "facebook",
        sourceType: "keyword",
        query: "Oba Market",
        url: null,
        settings: {
          canonicalBrandQuery: true,
          searchFanOutTerms: ["obamarket"],
          searchIndex: {
            routeProviderCursors: {
              // У алиасного слота своя отметка — она старше брендовой.
              [aliasCursorKey]: { fetchAfter: "2026-07-28T06:30:00.000Z" },
            },
          },
        },
      },
    }
    mockPrisma.socialProviderRun.findUnique
      .mockResolvedValueOnce(importedParent)
      .mockResolvedValueOnce(null)
    mockPrisma.sourceRoutePlan.findFirst
      .mockResolvedValueOnce({
        id: "route-1",
        capability: "DISCOVER_POSTS",
        acquisitionMode: "APIFY_FALLBACK",
      })
      .mockResolvedValueOnce({
        budget: {
          maxItems: 100,
          maxTotalChargeUsd: 1,
          dailyBudgetUsd: 5,
          monthlyBudgetUsd: 50,
          usdLimitsConfigured: true,
          timeoutSeconds: 900,
        },
        freshnessMinutes: 60,
      })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = new URL(String(input))
      expect(endpoint.searchParams.get("maxItems")).toBe("50")
      expect(endpoint.searchParams.get("maxTotalChargeUsd")).toBe("0.5")
      // Ребёнок ищет свой алиас, а не канонический запрос бренда.
      expect(JSON.parse(String(init?.body))).toMatchObject({
        query: "obamarket",
        search_type: "posts",
        max_results: 50,
      })
      return new Response(JSON.stringify({
        data: {
          id: "external-facebook-alias",
          defaultDatasetId: "dataset-facebook-alias",
          buildId: "build-facebook-alias",
        },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(importApifyProviderRun("facebook-canonical-root")).resolves.toEqual({
      status: "IMPORTED",
      imported: 3,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        parentRunId: "facebook-canonical-root",
        routePlanId: "route-1",
        phase: "DISCOVER_CANDIDATE_POSTS",
        maxItems: 50,
        maxTotalChargeUsd: 0.5,
        reservedChargeUsd: 0.5,
        idempotencyKey: expect.stringContaining(":parent:facebook-canonical-root:"),
        inputSnapshot: expect.objectContaining({
          query: "obamarket",
          leadDriveFacebookFanOutTerm: "obamarket",
          // Свой ключ курсора: успех алиаса не двигает отметку бренда.
          leadDriveProviderCursorScope: expect.objectContaining({
            adapterKey: "APIFY_ASYNC:term:obamarket",
          }),
          // Нижняя граница — из алиасной отметки, верхняя заморожена окном
          // родителя, чтобы слоты не расползлись по разным «сейчас».
          leadDriveProviderWindow: expect.objectContaining({
            cursorSince: "2026-07-28T06:30:00.000Z",
            until: "2026-07-28T09:00:00.000Z",
          }),
          // Комментарии остаются работой родителя.
          leadDriveSuppressDependentPaidRuns: true,
        }),
      }),
    }))
    // Ребёнок сам веер не разворачивает — иначе внуки множили бы расход.
    expect(mockPrisma.socialProviderRun.create.mock.calls.at(-1)?.[0]?.data?.inputSnapshot)
      .not.toHaveProperty("leadDriveFacebookFanOutTerms")

    // Единственный слот отправлен — маркер снимается.
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "facebook-canonical-root" }),
        data: expect.objectContaining({
          inputSnapshot: expect.not.objectContaining({
            leadDriveDependentFacebookFanOutPending: true,
          }),
        }),
      }),
    )

    // Повторный проход видит уже созданного ребёнка и второй платный прогон
    // на тот же термин не выпускает.
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue(importedParent)
    mockPrisma.socialProviderRun.findMany.mockResolvedValue([{
      id: "facebook-alias-child",
      status: "RUNNING",
      inputSnapshot: { leadDriveFacebookFanOutTerm: "obamarket" },
    }])
    await expect(importApifyProviderRun("facebook-canonical-root")).resolves.toEqual({
      status: "IMPORTED",
      imported: 3,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledOnce()
  })

  it("dispatches one Facebook fan-out slot per pass and keeps the marker until the last (#638)", async () => {
    const parentWithTwoSlots = {
      id: "facebook-two-slot-root",
      organizationId: "org-1",
      sourceId: "src-1",
      routePlanId: "route-1",
      providerKey: "APIFY",
      actorId: "scrapeforge/facebook-search-posts",
      status: "IMPORTED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 1,
      collectorRunId: "collector-two-slot",
      inputSnapshot: {
        query: "Oba Market",
        leadDriveFacebookFanOutTerms: ["obamarket", "oba marketleri"],
        leadDriveFacebookFanOutBudget: { maxItems: 33, maxTotalChargeUsd: 0.33 },
        leadDriveDependentFacebookFanOutPending: true,
        leadDriveProviderWindow: {
          cursorSince: "2026-07-28T08:00:00.000Z",
          since: "2026-07-28T07:45:00.000Z",
          until: "2026-07-28T09:00:00.000Z",
          resumedFromWatermark: true,
          clamped: false,
          overlapMinutes: 15,
        },
      },
      source: {
        ...source,
        platform: "facebook",
        sourceType: "keyword",
        query: "Oba Market",
        url: null,
        settings: {
          canonicalBrandQuery: true,
          searchFanOutTerms: ["obamarket", "oba marketleri"],
        },
      },
    }
    // Только родитель существует под своим id: иначе поиск существующего
    // резерва по ключу идемпотентности вернул бы дочернему прогону родителя.
    mockPrisma.socialProviderRun.findUnique.mockImplementation(async (args: {
      where: { id?: string }
    }) => (args.where.id === "facebook-two-slot-root" ? parentWithTwoSlots : null))
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
      id: "route-1",
      capability: "DISCOVER_POSTS",
      acquisitionMode: "APIFY_FALLBACK",
      budget: {
        maxItems: 100,
        maxTotalChargeUsd: 1,
        dailyBudgetUsd: 5,
        monthlyBudgetUsd: 50,
        usdLimitsConfigured: true,
        timeoutSeconds: 900,
      },
      freshnessMinutes: 60,
    })
    const dispatchedQueries: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      dispatchedQueries.push(String(JSON.parse(String(init?.body)).query))
      return new Response(JSON.stringify({
        data: { id: "external-slot", defaultDatasetId: "dataset-slot", buildId: "build-slot" },
      }), { status: 201 })
    }))

    // Проход 1: отправлен только первый слот, маркер обязан остаться —
    // иначе второй термин не искал бы никто.
    await importApifyProviderRun("facebook-two-slot-root")
    expect(dispatchedQueries).toEqual(["obamarket"])
    expect(mockPrisma.socialProviderRun.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "facebook-two-slot-root" }),
        data: expect.objectContaining({
          inputSnapshot: expect.not.objectContaining({
            leadDriveDependentFacebookFanOutPending: true,
          }),
        }),
      }),
    )

    // Проход 2: первый слот уже создан — уходит второй, и маркер снимается.
    mockPrisma.socialProviderRun.findMany.mockResolvedValue([{
      id: "facebook-slot-1",
      status: "RUNNING",
      inputSnapshot: { leadDriveFacebookFanOutTerm: "obamarket" },
    }])
    await importApifyProviderRun("facebook-two-slot-root")
    expect(dispatchedQueries).toEqual(["obamarket", "oba marketleri"])
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "facebook-two-slot-root" }),
        data: expect.objectContaining({
          inputSnapshot: expect.not.objectContaining({
            leadDriveDependentFacebookFanOutPending: true,
          }),
        }),
      }),
    )
  })

  it("does not queue paid comments after the discovery source was disabled", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "discovery-disabled-source",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "IMPORTED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 2,
      collectorRunId: "collector-1",
      source,
    })
    mockPrisma.monitoringSource.findFirst.mockResolvedValue(null)

    await expect(importApifyProviderRun("discovery-disabled-source")).resolves.toEqual({
      status: "IMPORTED",
      imported: 2,
    })
    expect(mockPrisma.sourceRoutePlan.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
  })

  it("persists a dependent-comments retry when another collector holds the source lease", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "discovery-lease-contention",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-discovery",
      status: "IMPORTED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 2,
      collectorRunId: "collector-1",
      inputSnapshot: {},
      source,
    })
    mockPrisma.monitoringSource.updateMany.mockResolvedValueOnce({ count: 0 })
    mockPrisma.monitoringSource.findFirst.mockResolvedValue({ id: "src-1" })

    await expect(importApifyProviderRun("discovery-lease-contention")).resolves.toEqual({
      status: "IMPORTED",
      imported: 2,
    })

    expect(mockPrisma.sourceRoutePlan.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "discovery-lease-contention" }),
        data: expect.objectContaining({
          inputSnapshot: {
            leadDriveDependentCommentsPending: true,
          },
        }),
      }),
    )
  })

  it.each([
    ["missing", {}],
    ["forged above the source authorization", {
      leadDriveDependentCommentsAuthorized: true,
      leadDriveDependentCommentsMaxTotalChargeUsd: 100,
      leadDriveSourceAuthorizedMaxTotalChargeUsd: 100,
      leadDriveDiscoveryMaxTotalChargeUsd: 100,
    }],
  ])("rejects a %s frozen allocation for dependent comments", async (_label, allocationSnapshot) => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "discovery-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "IMPORTED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 2,
      collectorRunId: "collector-1",
      inputSnapshot: {
        leadDriveManualPaidRun: true,
        leadDriveClientFundedManual: true,
        leadDriveTargetScenarioId: "scenario-a",
        operatorAuthorizedMaxTotalChargeUsd: 0.5,
        ...allocationSnapshot,
      },
      source,
    })

    await expect(importApifyProviderRun("discovery-run-1")).resolves.toEqual({
      status: "IMPORTED",
      imported: 2,
    })

    expect(mockPrisma.sourceRoutePlan.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
  })

  it("propagates client-funded scope into dependent comment extraction", async () => {
    const importedRun = {
      id: "discovery-client-funded",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      status: "IMPORTED",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 2,
      collectorRunId: "collector-client-funded",
      inputSnapshot: {
        leadDriveManualPaidRun: true,
        leadDriveClientFundedManual: true,
        leadDriveTargetScenarioId: "scenario-a",
        operatorAuthorizedMaxTotalChargeUsd: 50,
        leadDriveDependentCommentsAuthorized: true,
        leadDriveDependentCommentsMaxTotalChargeUsd: 50,
        leadDriveSourceAuthorizedMaxTotalChargeUsd: 100,
        leadDriveDiscoveryMaxTotalChargeUsd: 50,
      },
      source,
    }
    mockPrisma.socialProviderRun.findUnique
      .mockResolvedValueOnce(importedRun)
      .mockResolvedValueOnce(null)
    mockPrisma.sourceRoutePlan.findMany.mockResolvedValue([{
      id: "comments-client-funded",
      capability: "READ_EXTERNAL_COMMENTS",
      acquisitionMode: "APIFY_FALLBACK",
    }])
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({
      id: "discovery-client-funded",
      createdAt: new Date(),
    })
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([{
      canonicalUrl: "https://instagram.com/p/client-funded",
      url: "https://instagram.com/p/client-funded",
    }])
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const endpoint = new URL(String(input))
      expect(endpoint.searchParams.get("maxTotalChargeUsd")).toBe("50")
      return new Response(JSON.stringify({
        data: {
          id: "external-comments-client-funded",
          defaultDatasetId: "dataset-comments-client-funded",
          buildId: "build-comments-client-funded",
        },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(importApifyProviderRun("discovery-client-funded")).resolves.toEqual({
      status: "IMPORTED",
      imported: 2,
    })

    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.sourceRoutePlan.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        scenarioId: "scenario-a",
        capability: "READ_EXTERNAL_COMMENTS",
        dependsOnCapability: "DISCOVER_POSTS",
      }),
    }))
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        collectorRunId: "collector-client-funded",
        routePlanId: "comments-client-funded",
        parentRunId: "discovery-client-funded",
        idempotencyKey:
          "apify:comments-client-funded:EXTRACT_COMMENTS_FROM_CANDIDATES:manual:collector-client-funded",
        reservedChargeUsd: 50,
        maxTotalChargeUsd: 50,
        dailyBudgetUsd: null,
        monthlyBudgetUsd: null,
        inputSnapshot: expect.objectContaining({
          leadDriveManualPaidRun: true,
          leadDriveClientFundedManual: true,
          leadDriveTargetScenarioId: "scenario-a",
          operatorAuthorizedMaxTotalChargeUsd: 50,
        }),
      }),
    }))
    const createdCommentsRun = mockPrisma.socialProviderRun.create.mock.calls[0]?.[0]?.data
    expect(createdCommentsRun?.idempotencyKey).not.toContain(":parent:")
  })

  it.each([
    ["facebook", "apify/facebook-comments-scraper", "0.0.322", "https://facebook.com/page/posts/1"],
    ["tiktok", "clockworks/tiktok-comments-scraper", "0.0.423", "https://tiktok.com/@brand/video/1"],
  ])("pins the verified %s comments actor build", async (platform, actorId, build, candidateUrl) => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
      budget: { maxItems: 10, maxTotalChargeUsd: 0.05, dailyBudgetUsd: 1.5, monthlyBudgetUsd: 20, usdLimitsConfigured: true, timeoutSeconds: 600 },
      freshnessMinutes: 60,
      contractVersion: "social-provider-contract-v2.1",
    })
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({ id: "discovery-run-1", createdAt: new Date() })
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue(platform === "tiktok" ? [{ canonicalUrl: candidateUrl, url: candidateUrl, externalId: "1", postExternalId: "1", subjectDecision: { status: "MATCHED", reasonCode: "DETERMINISTIC_TERM_MATCH", matchedTerms: ["brand"], scenarioIds: ["scn-1"], query: "brand", provider: "apify", observedAt: new Date().toISOString(), policySnapshot: { version: "tiktok-publication-gate-v1", probableOptIn: false, minProbableConfidence: 0.8, candidateOnly: true, liveRoutingAllowed: false } } }] : [{ canonicalUrl: candidateUrl, url: candidateUrl }])
    if (platform === "tiktok") {
      mockPrisma.tikTokPublicationRevisit.findMany.mockResolvedValue([{
        canonicalUrl: candidateUrl,
        postExternalId: "1",
        ingestEnvelope: { subjectDecision: { status: "MATCHED", reasonCode: "DETERMINISTIC_TERM_MATCH", scenarioIds: ["scn-1"], policySnapshot: { version: "tiktok-publication-gate-v1" } } },
      }])
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = new URL(String(input))
      expect(endpoint.pathname).toContain(actorId.replace("/", "~"))
      expect(endpoint.searchParams.get("build")).toBe(build)
      if (platform === "facebook") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          startUrls: [{ url: candidateUrl }],
          resultsLimit: 10,
          includeNestedComments: true,
          viewOption: "RECENT_ACTIVITY",
        })
      }
      return new Response(JSON.stringify({ data: { id: `run-${platform}`, defaultDatasetId: `dataset-${platform}`, buildId: `build-${platform}` } }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runApifyAsyncCollector({
      ...source,
      platform,
      sourceType: "profile",
      url: candidateUrl,
      routeExecution: {
        ...source.routeExecution!,
        capability: "READ_EXTERNAL_COMMENTS",
      },
    })

    expect(result).toMatchObject({ status: "success", rawStats: expect.objectContaining({ queued: true }) })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("reconciles a legacy-source negative TikTok parent through the active route's matched subject", async () => {
    const candidateUrl = "https://tiktok.com/@brand/video/legacy-negative"
    const acceptedAt = new Date("2026-07-30T10:00:00Z")
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
      budget: { maxItems: 10, maxTotalChargeUsd: 0.05, dailyBudgetUsd: 1.5, monthlyBudgetUsd: 20, usdLimitsConfigured: true, timeoutSeconds: 600 },
      freshnessMinutes: 60,
      contractVersion: "social-provider-contract-v2.1",
    })
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({ id: "discovery-run-current", createdAt: new Date() })
    mockPrisma.monitoringSubject.findMany.mockResolvedValue([{ id: "subject-negative" }])
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([])
    mockPrisma.$queryRaw.mockImplementation(async (query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join("?") ?? ""
      if (sql.includes('FROM "ingest_envelopes" AS e')) return [{
        id: "legacy-envelope",
        postExternalId: "legacy-negative",
        externalId: "legacy-negative",
        canonicalUrl: candidateUrl,
        url: candidateUrl,
        decidedAt: acceptedAt,
        acceptedAt,
        createdAt: acceptedAt,
      }]
      return [{ reservedChargeUsd: 0, actualChargeUsd: 0 }]
    })
    mockPrisma.tikTokPublicationRevisit.createMany.mockResolvedValue({ count: 1 })
    mockPrisma.tikTokPublicationRevisit.findMany.mockResolvedValue([{
      canonicalUrl: candidateUrl,
      postExternalId: "legacy-negative",
      ingestEnvelope: {
        subjectDecision: {
          status: "MATCHED",
          reasonCode: "negative_parent_subject_match",
          scenarioIds: ["scenario-negative"],
          policySnapshot: {},
        },
      },
    }])
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ postURLs: [candidateUrl] })
      return new Response(JSON.stringify({
        data: { id: "run-tiktok-legacy", defaultDatasetId: "dataset-tiktok-legacy", buildId: "build-tiktok-legacy" },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runApifyAsyncCollector({
      ...source,
      platform: "tiktok",
      sourceType: "keyword",
      query: "Brand",
      settings: { scenarioLinks: [{ scenarioId: "scenario-negative", subjectId: "subject-negative" }] },
      routeExecution: {
        ...source.routeExecution!,
        capability: "READ_EXTERNAL_COMMENTS",
        targetSubjectId: "subject-negative",
        manualPaidRun: true,
        manualMaxTotalChargeUsd: 0.05,
      },
    })

    expect(result).toMatchObject({ status: "success", rawStats: expect.objectContaining({ queued: true }) })
    const repairQuery = mockPrisma.$queryRaw.mock.calls
      .map(([query]) => query as { strings?: readonly string[] })
      .find(query => (query.strings?.join("?") ?? "").includes('FROM "ingest_envelopes" AS e'))
    const repairSql = repairQuery?.strings?.join("?") ?? ""
    expect(repairSql).toContain('LOWER(BTRIM(COALESCE(m."sentiment", \'\'))) = \'negative\'')
    expect(repairSql).toContain('msm."subjectId" IN')
    expect(repairSql).toContain('FROM "tiktok_publication_revisits" AS revisit')
    expect(mockPrisma.tikTokPublicationRevisit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        status: { in: ["ACTIVE", "INACTIVE"] },
        ingestEnvelope: expect.objectContaining({
          acceptedMention: expect.objectContaining({
            sentiment: "negative",
            subjectMatches: {
              some: { status: "MATCHED", subjectId: { in: ["subject-negative"] } },
            },
          }),
        }),
      }),
    }))
    expect(mockPrisma.tikTokPublicationRevisit.findMany.mock.calls[0][0].where.ingestEnvelope).not.toHaveProperty("sourceId")
    expect(mockPrisma.tikTokPublicationRevisit.findMany.mock.calls[0][0].where).not.toHaveProperty("nextDueAt")
    expect(mockPrisma.tikTokPublicationRevisit.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ ingestEnvelopeId: "legacy-envelope", postExternalId: "legacy-negative" })],
      skipDuplicates: true,
    }))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("does not fall back to normalized TikTok posts when approved candidate evidence is missing", async () => {
    const candidateUrl = "https://tiktok.com/@arazsupermarket/video/123"
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
      budget: { maxItems: 10, maxTotalChargeUsd: 0.05, dailyBudgetUsd: 1.5, monthlyBudgetUsd: 20, usdLimitsConfigured: true, timeoutSeconds: 600 },
      freshnessMinutes: 60,
      contractVersion: "social-provider-contract-v2.1",
    })
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({ id: "discovery-run-1", createdAt: new Date() })
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([])
    mockPrisma.mentionEvidence.findMany.mockResolvedValue([])
    mockPrisma.socialMention.findMany.mockResolvedValue([{
      canonicalUrl: candidateUrl,
      url: candidateUrl,
      parentPostUrl: null,
    }])
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ postURLs: [candidateUrl] })
      return new Response(JSON.stringify({
        data: { id: "run-tiktok", defaultDatasetId: "dataset-tiktok", buildId: "build-tiktok" },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runApifyAsyncCollector({
      ...source,
      platform: "tiktok",
      sourceType: "keyword",
      query: "Araz Supermarket",
      routeExecution: {
        ...source.routeExecution!,
        capability: "READ_EXTERNAL_COMMENTS",
      },
    })

    expect(result).toMatchObject({ status: "skipped", error: "apify_candidate_posts_missing" })
    expect(mockPrisma.socialMention.findMany).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("retains the reserved budget when Apify accepts the POST without a trustworthy run id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { defaultDatasetId: "dataset-1" } }), { status: 201 })))

    const result = await runApifyAsyncCollector(source)

    expect(result).toMatchObject({
      status: "partial",
      error: "apify_start_dispatch_unknown",
      rawStats: { providerRunId: "provider-run-1", providerStatus: "RUNNING", dispatchUnknown: true },
    })
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "QUEUED",
        reservedChargeUsd: 0.5,
        maxItems: 50,
        timeoutSeconds: 900,
        inputSnapshot: expect.objectContaining({ providerRequestDispatched: false }),
      }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: "provider-run-1" }),
      data: expect.objectContaining({ status: "RUNNING", lastError: "apify_start_dispatch_unknown" }),
    })
    expect(mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data)
      .not.toHaveProperty("reservedChargeUsd")
  })

  it("keeps a successful POST dispatch-unknown when acknowledgement persistence fails and does not start it again", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: {
        id: "external-ack-lost",
        defaultDatasetId: "dataset-ack-lost",
        buildId: "immutable-build-id",
      },
    }), { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)
    mockPrisma.socialProviderRun.updateMany
      .mockRejectedValueOnce(new Error("ack persistence unavailable"))
      .mockResolvedValue({ count: 1 })

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "partial",
      error: "apify_start_dispatch_unknown",
      rawStats: {
        providerRunId: "provider-run-1",
        providerStatus: "RUNNING",
        providerRequestDispatched: true,
        dispatchUnknown: true,
      },
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "QUEUED",
        reservedChargeUsd: 0.5,
        inputSnapshot: expect.objectContaining({ providerRequestDispatched: false }),
      }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        id: "provider-run-1",
        status: "RUNNING",
        externalRunId: null,
        inputSnapshot: { path: ["providerRequestDispatched"], equals: true },
      }),
      data: expect.objectContaining({ externalRunId: "external-ack-lost", status: "RUNNING" }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "provider-run-1",
        status: "RUNNING",
        inputSnapshot: { path: ["providerRequestDispatched"], equals: true },
      }),
      data: expect.objectContaining({
        status: "RUNNING",
        lastError: "apify_start_dispatch_unknown",
      }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data)
      .not.toHaveProperty("reservedChargeUsd")

    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      status: "RUNNING",
      receivedCount: 0,
      acceptedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      reviewCount: 0,
      lastError: "apify_start_dispatch_unknown",
      purgedAt: null,
    })

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "success",
      error: "apify_start_dispatch_unknown",
      rawStats: { providerRunId: "provider-run-1", providerStatus: "RUNNING", queued: true },
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledOnce()
  })

  it("releases only the exact undispatched reservation when the dispatch claim fails", async () => {
    mockPrisma.$executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "failed",
      error: "apify_start_dispatch_claim_failed",
      rawStats: {
        providerRunId: "provider-run-1",
        providerRequestDispatched: false,
        failClosed: true,
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "provider-run-1",
        status: "QUEUED",
        externalRunId: null,
        inputSnapshot: { path: ["providerRequestDispatched"], equals: false },
      }),
      data: expect.objectContaining({
        status: "BLOCKED",
        lastError: "apify_start_dispatch_claim_failed",
        reservedChargeUsd: 0,
      }),
    })
  })

  it("retains the reservation when Apify returns a server error after POST", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream unavailable", { status: 503 })))

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "partial",
      error: "apify_start_dispatch_unknown",
      rawStats: { providerStatus: "RUNNING", dispatchUnknown: true },
    })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: "provider-run-1" }),
      data: expect.objectContaining({ status: "RUNNING", lastError: "apify_start_dispatch_unknown" }),
    })
    expect(mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data)
      .not.toHaveProperty("reservedChargeUsd")
  })

  it("aborts the billable start POST when the parent collector deadline expires", async () => {
    const parent = new AbortController()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted")
        error.name = "AbortError"
        reject(error)
      }, { once: true })
    }))
    vi.stubGlobal("fetch", fetchMock)

    const pending = runApifyAsyncCollector({
      ...source,
      providerRequestSignal: parent.signal,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const requestSignal = fetchMock.mock.calls[0]?.[1]?.signal
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal).not.toBe(parent.signal)
    parent.abort()

    await expect(pending).resolves.toMatchObject({
      status: "partial",
      error: "apify_start_dispatch_unknown",
      rawStats: {
        providerStatus: "RUNNING",
        dispatchUnknown: true,
      },
    })
    expect(requestSignal?.aborted).toBe(true)
  })

  it("keeps Apify response-body parsing inside the parent collector deadline", async () => {
    const parent = new AbortController()
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return {
        ok: true,
        status: 201,
        json: () => new Promise((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => {
            const error = new Error("body aborted")
            error.name = "AbortError"
            reject(error)
          }, { once: true })
        }),
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const pending = runApifyAsyncCollector({
      ...source,
      providerRequestSignal: parent.signal,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal).not.toBe(parent.signal)
    parent.abort()

    await expect(pending).resolves.toMatchObject({
      status: "partial",
      error: "apify_start_dispatch_unknown",
      rawStats: {
        providerStatus: "RUNNING",
        providerRequestDispatched: true,
        dispatchUnknown: true,
      },
    })
    expect(requestSignal?.aborted).toBe(true)
    expect(mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data)
      .not.toHaveProperty("reservedChargeUsd")
  })

  it("retains the reservation when Apify rate-limits an ambiguous POST", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })))

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "partial",
      error: "apify_start_dispatch_unknown",
      rawStats: { providerStatus: "RUNNING", dispatchUnknown: true },
    })
    expect(mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data)
      .not.toHaveProperty("reservedChargeUsd")
  })

  it("releases the reservation after an explicit client rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid input" } }), { status: 400 })))

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "failed",
      error: "apify_start_400",
    })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: "provider-run-1" }),
      data: expect.objectContaining({
        status: "FAILED",
        lastError: "apify_start_400",
        reservedChargeUsd: 0,
      }),
    })
  })

  it("serializes the spend check and provider-run reservation under the shared tenant lock", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { id: "external-atomic", defaultDatasetId: "dataset-atomic" },
    }), { status: 201 })))

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "success",
      rawStats: { queued: true },
    })

    expect(mockPrisma.$transaction).toHaveBeenCalledOnce()
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2)
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2)
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledOnce()
    expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0])
      .toBeLessThan(mockPrisma.$queryRaw.mock.invocationCallOrder[0])
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[1])
      .toBeLessThan(mockPrisma.socialProviderRun.create.mock.invocationCallOrder[0])
    expect(mockPrisma.socialProviderRun.create.mock.invocationCallOrder[0])
      .toBeLessThan(mockPrisma.$executeRaw.mock.invocationCallOrder[1])
  })

  it("fails closed before provider I/O when the atomic spend lock cannot be acquired", async () => {
    mockPrisma.$executeRaw.mockRejectedValueOnce(new Error("lock unavailable"))
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "failed",
      error: "paid_route_budget_guard_failed",
      rawStats: { providerRequestDispatched: false, failClosed: true, budgetGuard: true },
    })
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not start a paid actor after the daily budget is exhausted", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ reservedChargeUsd: 4.5, actualChargeUsd: 0 }])
      .mockResolvedValueOnce([{ reservedChargeUsd: 4.5, actualChargeUsd: 0 }])
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({ status: "skipped", error: "paid_route_daily_budget_exhausted" })
    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails closed before provider I/O when USD enforcement is disabled", async () => {
    vi.stubEnv("SOCIAL_MONITORING_ENFORCE_USD_BUDGETS", "0")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "skipped",
      error: "paid_route_budget_enforcement_disabled",
      rawStats: { providerRequestDispatched: false, failClosed: true, budgetGuard: true },
    })
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("honors the tenant emergency stop for an automatic Apify run", async () => {
    deps.tenantPaidRunEmergencyStopped.mockResolvedValueOnce(true)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "skipped",
      error: "paid_run_emergency_stopped",
      rawStats: {
        providerRequestDispatched: false,
        failClosed: true,
        emergencyStopped: true,
      },
    })
    expect(deps.tenantPaidRunEmergencyStopped).toHaveBeenCalledWith("org-1")
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rechecks the emergency stop after reserving and before provider dispatch", async () => {
    deps.tenantPaidRunEmergencyStopped
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "skipped",
      error: "paid_run_emergency_stopped",
      rawStats: {
        providerRequestDispatched: false,
        emergencyStopped: true,
      },
    })
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "provider-run-1",
        inputSnapshot: { path: ["providerRequestDispatched"], equals: false },
      }),
      data: expect.objectContaining({
        status: "BLOCKED",
        lastError: "paid_run_emergency_stopped",
        reservedChargeUsd: 0,
      }),
    }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("closes an undispatched reservation when the collection fence blocks dispatch", async () => {
    deps.runWithinImportFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "skipped",
      error: "social_monitoring_collection_blocked",
      rawStats: {
        providerRequestDispatched: false,
        failClosed: true,
        collectionFence: true,
      },
    })
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "provider-run-1",
        organizationId: "org-1",
        providerKey: "APIFY",
        purgedAt: null,
        status: "QUEUED",
        externalRunId: null,
        OR: [
          { actualChargeUsd: null },
          { actualChargeUsd: { lte: 0 } },
        ],
        inputSnapshot: { path: ["providerRequestDispatched"], equals: false },
      },
      data: {
        status: "BLOCKED",
        lastError: "social_monitoring_collection_blocked",
        reservedChargeUsd: 0,
        finishedAt: expect.any(Date),
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails closed before provider I/O when owner USD limits are not configured", async () => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
      budget: { maxItems: 100, maxTotalChargeUsd: 1, dailyBudgetUsd: 5, monthlyBudgetUsd: 50, usdLimitsConfigured: false, timeoutSeconds: 900 },
      freshnessMinutes: 60,
      contractVersion: "social-provider-capabilities-v1",
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
      status: "skipped",
      error: "paid_route_budget_unconfigured",
      rawStats: { providerRequestDispatched: false, failClosed: true, budgetGuard: true },
    })
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Решение владельца 2026-08-01: тенант управляет расходом балансом в самом
  // Apify, поэтому ночной автосбор обязан платить со счёта провайдера ровно
  // так же, как уже работающий ручной запуск.
  describe("автосбор со счёта тенанта у провайдера", () => {
    const unlimitedPlan = {
      budget: { maxItems: 100, maxTotalChargeUsd: 1, dailyBudgetUsd: 5, monthlyBudgetUsd: 50, usdLimitsConfigured: false, timeoutSeconds: 900 },
      freshnessMinutes: 60,
      contractVersion: "social-provider-capabilities-v1",
    }

    it("доходит до провайдера без заданных долларовых лимитов", async () => {
      mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue(unlimitedPlan)
      deps.tenantProviderAccountFundedRunPolicy.mockResolvedValue({ enabled: true, dailyRunQuota: 5 })

      const result = await runApifyAsyncCollector(source)

      expect(result.error).not.toBe("paid_route_budget_unconfigured")
      expect(mockPrisma.socialProviderRun.create).toHaveBeenCalled()
      const snapshot = mockPrisma.socialProviderRun.create.mock.calls[0][0].data.inputSnapshot
      expect(snapshot.leadDriveProviderAccountFunded).toBe(true)
      // Предохранитель — тот же, что у ручного запуска ($100), а не системный
      // $4: иначе прогон резался бы по деньгам раньше, чем по числу находок.
      expect(snapshot.systemHardMaxPerRunUsd).toBe(100)
      // Выше прежнего системного $4 — значит предохранитель действительно
      // поднят. Точное число зависит от платформы: парный поиск Instagram
      // делит бюджет между постами и reels.
      expect(mockPrisma.socialProviderRun.create.mock.calls[0][0].data.reservedChargeUsd).toBeGreaterThan(4)
      // Ручные маркеры ставить нельзя: они подменяют ключ идемпотентности и
      // выводят прогон из учёта расходов.
      expect(snapshot.leadDriveManualPaidRun).toBeUndefined()
      expect(snapshot.leadDriveClientFundedManual).toBeUndefined()
    })

    it("не действует, пока строгий режим лимитов выключен", async () => {
      const previous = process.env.SOCIAL_MONITORING_ENFORCE_USD_BUDGETS
      process.env.SOCIAL_MONITORING_ENFORCE_USD_BUDGETS = "0"
      try {
        mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue(unlimitedPlan)
        deps.tenantProviderAccountFundedRunPolicy.mockResolvedValue({ enabled: true, dailyRunQuota: 5 })

        await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
          status: "skipped",
          error: "paid_route_budget_enforcement_disabled",
        })
        expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
      } finally {
        process.env.SOCIAL_MONITORING_ENFORCE_USD_BUDGETS = previous
      }
    })

    it("не действует для тенанта без разрешения платить со своего счёта", async () => {
      mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue(unlimitedPlan)
      deps.tenantProviderAccountFundedRunPolicy.mockResolvedValue({ enabled: false, dailyRunQuota: 0 })

      await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
        status: "skipped",
        error: "paid_route_budget_unconfigured",
      })
      expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    })

    it("останавливается суточной квотой прогонов, но пропускает, пока она не выбрана", async () => {
      mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue(unlimitedPlan)
      deps.tenantProviderAccountFundedRunPolicy.mockResolvedValue({ enabled: true, dailyRunQuota: 2 })

      // Квота выбрана: два чужих прогона за сутки при квоте 2.
      mockPrisma.$queryRaw.mockResolvedValue([
        { collectorRunId: "other-run-1" },
        { collectorRunId: "other-run-2" },
      ])
      await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
        status: "skipped",
        error: "paid_run_daily_quota_exhausted",
      })
      expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()

      // Под квотой — прогон обязан пройти. Без этой половины теста реализация,
      // блокирующая ВСЁ, тоже была бы «зелёной».
      mockPrisma.$queryRaw.mockResolvedValue([{ collectorRunId: "other-run-1" }])
      await runApifyAsyncCollector(source)
      expect(mockPrisma.socialProviderRun.create).toHaveBeenCalled()
    })

    // Пользовательский запуск без явного долларового капа приходит с
    // manualPaidRun=false и без второго условия утёк бы в эту ветку — стал бы
    // платным прогоном мимо авторизации и аудита ручного пути.
    it("не подхватывает пользовательский запуск без явного капа", async () => {
      mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue(unlimitedPlan)
      deps.tenantProviderAccountFundedRunPolicy.mockResolvedValue({ enabled: true, dailyRunQuota: 5 })
      const userRun = {
        ...source,
        routeExecution: { ...source.routeExecution!, collectorRunId: "collector-user-no-cap", manualSourceRun: true },
      }

      await expect(runApifyAsyncCollector(userRun)).resolves.toMatchObject({
        status: "skipped",
        error: "paid_route_budget_unconfigured",
      })
      expect(deps.tenantProviderAccountFundedRunPolicy).not.toHaveBeenCalled()
    })

    // Владелец мог задать лимиты на конкретный маршрут — тенантный признак не
    // имеет права снимать контроль там, где он включён осознанно.
    it("не снимает лимиты с маршрута, где владелец их задал", async () => {
      mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
        budget: { maxItems: 100, maxTotalChargeUsd: 0.5, dailyBudgetUsd: 5, monthlyBudgetUsd: 50, usdLimitsConfigured: true, timeoutSeconds: 900 },
        freshnessMinutes: 60,
        contractVersion: "social-provider-capabilities-v1",
      })
      deps.tenantProviderAccountFundedRunPolicy.mockResolvedValue({ enabled: true, dailyRunQuota: 5 })

      await runApifyAsyncCollector(source)

      const snapshot = mockPrisma.socialProviderRun.create.mock.calls[0][0].data.inputSnapshot
      expect(snapshot.leadDriveProviderAccountFunded).toBeUndefined()
    })

    it("выключен, пока суточная квота не задана", async () => {
      mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue(unlimitedPlan)
      // Ровно то, что вернёт политика тенанта без квоты: fail-closed.
      deps.tenantProviderAccountFundedRunPolicy.mockResolvedValue({ enabled: false, dailyRunQuota: 0 })

      await expect(runApifyAsyncCollector(source)).resolves.toMatchObject({
        status: "skipped",
        error: "paid_route_budget_unconfigured",
      })
      expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    })
  })

  it("fails closed before Apify I/O when a manual run has no explicit cap", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const manualSource = {
      ...source,
      routeExecution: { ...source.routeExecution!, collectorRunId: "collector-manual-missing-cap", manualPaidRun: true },
    }

    await expect(runApifyAsyncCollector(manualSource)).resolves.toMatchObject({
      status: "skipped",
      error: "paid_manual_run_cap_required",
      rawStats: { providerRequestDispatched: false, failClosed: true, budgetGuard: true },
    })
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("skips tenant period aggregates for a client-funded manual run while preserving its durable cap", async () => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
      budget: { maxItems: 100, usdLimitsConfigured: false, timeoutSeconds: 900 },
      freshnessMinutes: 60,
      contractVersion: "stable",
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const endpoint = new URL(String(input))
      expect(endpoint.searchParams.get("maxItems")).toBe("50")
      expect(endpoint.searchParams.get("maxTotalChargeUsd")).toBe("50")
      return new Response(JSON.stringify({
        data: {
          id: "external-client-funded",
          defaultDatasetId: "dataset-client-funded",
          buildId: "build-client-funded",
        },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(clientFundedSource())).resolves.toMatchObject({
      status: "success",
      rawStats: {
        queued: true,
        manualPaidRun: true,
        maxTotalChargeUsd: 50,
      },
    })

    expect(deps.tenantPaidRunEmergencyStopped).toHaveBeenCalledWith("org-1")
    expect(deps.tenantClientFundedManualRunsEnabled).toHaveBeenCalledWith("org-1")
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        schemaVersion: "social-observation-v2.1",
        reservedChargeUsd: 50,
        maxTotalChargeUsd: 50,
        dailyBudgetUsd: null,
        monthlyBudgetUsd: null,
        inputSnapshot: expect.objectContaining({
          leadDriveManualPaidRun: true,
          leadDriveClientFundedManual: true,
          operatorAuthorizedMaxTotalChargeUsd: 50,
          systemHardMaxPerRunUsd: 100,
          systemHardDailyBudgetUsd: null,
          systemHardMonthlyBudgetUsd: null,
          leadDriveInstagramReelsBudget: {
            maxItems: 50,
            maxTotalChargeUsd: 50,
          },
        }),
      }),
    }))
  })

  it("keeps global enforcement authoritative for a client-funded Apify run", async () => {
    vi.stubEnv("SOCIAL_MONITORING_ENFORCE_USD_BUDGETS", "0")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(clientFundedSource())).resolves.toMatchObject({
      status: "skipped",
      error: "paid_route_budget_enforcement_disabled",
      rawStats: {
        providerRequestDispatched: false,
        failClosed: true,
        budgetGuard: true,
      },
    })
    expect(deps.tenantPaidRunEmergencyStopped).not.toHaveBeenCalled()
    expect(deps.tenantClientFundedManualRunsEnabled).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps the tenant emergency stop authoritative for a client-funded Apify run", async () => {
    deps.tenantPaidRunEmergencyStopped.mockResolvedValueOnce(true)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(clientFundedSource())).resolves.toMatchObject({
      status: "skipped",
      error: "paid_manual_run_emergency_stopped",
      rawStats: {
        providerRequestDispatched: false,
        failClosed: true,
        emergencyStopped: true,
      },
    })
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails closed when provider-billed manual runs are not enabled for the tenant", async () => {
    deps.tenantClientFundedManualRunsEnabled.mockResolvedValueOnce(false)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(clientFundedSource())).resolves.toMatchObject({
      status: "skipped",
      error: "paid_client_funded_manual_not_authorized",
      rawStats: {
        providerRequestDispatched: false,
        failClosed: true,
        tenantAuthorization: false,
      },
    })
    expect(deps.tenantPaidRunEmergencyStopped).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns an existing client-funded provider run without a second dispatch", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-existing-client-funded",
      status: "QUEUED",
      receivedCount: 0,
      acceptedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      reviewCount: 0,
      lastError: null,
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector(clientFundedSource())).resolves.toMatchObject({
      status: "success",
      rawStats: {
        providerRunId: "provider-run-existing-client-funded",
        providerStatus: "QUEUED",
        queued: true,
      },
    })
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("forwards and audits the explicit cap for every manual provider run", async () => {
    mockPrisma.sourceRoutePlan.findFirst.mockResolvedValue({
      budget: { maxItems: 100, usdLimitsConfigured: false, timeoutSeconds: 900 },
      freshnessMinutes: 60,
      contractVersion: "stable",
    })
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({
      id: "recent-imported-run",
      status: "IMPORTED",
      importedAt: new Date(),
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const endpoint = new URL(String(input))
      expect(endpoint.searchParams.get("maxItems")).toBe("50")
      expect(endpoint.searchParams.get("maxTotalChargeUsd")).toBe("0.25")
      return new Response(JSON.stringify({
        data: { id: `external-${fetchMock.mock.calls.length}`, defaultDatasetId: "dataset-manual", buildId: "build-manual" },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const first = {
      ...source,
      routeExecution: { ...source.routeExecution!, collectorRunId: "collector-manual-1", manualPaidRun: true, manualMaxTotalChargeUsd: 0.5 },
    }
    const second = {
      ...source,
      routeExecution: { ...source.routeExecution!, collectorRunId: "collector-manual-2", manualPaidRun: true, manualMaxTotalChargeUsd: 0.5 },
    }

    await expect(runApifyAsyncCollector(first)).resolves.toMatchObject({
      status: "success",
      rawStats: { queued: true, manualPaidRun: true },
    })
    await expect(runApifyAsyncCollector(second)).resolves.toMatchObject({
      status: "success",
      rawStats: { queued: true, manualPaidRun: true },
    })

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(4)
    expect(mockPrisma.socialProviderRun.findFirst).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const created = mockPrisma.socialProviderRun.create.mock.calls.map(call => call[0].data)
    expect(created[0]).toMatchObject({
      reservedChargeUsd: 0.25,
      maxTotalChargeUsd: 0.25,
      dailyBudgetUsd: 4,
      monthlyBudgetUsd: 120,
      inputSnapshot: expect.objectContaining({
        leadDriveManualPaidRun: true,
        operatorAuthorizedMaxTotalChargeUsd: 0.25,
        leadDriveInstagramReelsBudget: {
          maxItems: 50,
          maxTotalChargeUsd: 0.25,
        },
      }),
    })
    expect(created[0].idempotencyKey).toContain("collector-manual-1")
    expect(created[1].idempotencyKey).toContain("collector-manual-2")
    expect(created[0].idempotencyKey).not.toBe(created[1].idempotencyKey)
  })

  it.each([
    { label: "Instagram keyword discovery", platform: "instagram", sourceType: "search_url", query: "LeadDrive", url: "https://www.instagram.com/leaddrive/", actorId: "apify/instagram-hashtag-scraper", build: "0.0.596" },
    { label: "Instagram profile discovery", platform: "instagram", sourceType: "profile", query: "leaddrive", url: "https://www.instagram.com/leaddrive/", actorId: "apify/instagram-scraper", build: "0.0.689" },
    { label: "Instagram hashtag discovery", platform: "instagram", sourceType: "hashtag", query: "leaddrive", url: null, actorId: "apify/instagram-hashtag-scraper", build: "0.0.596" },
    { label: "Facebook keyword discovery", platform: "facebook", sourceType: "keyword", query: "LeadDrive", url: null, actorId: "scrapeforge/facebook-search-posts", build: "1.0.19" },
    { label: "Facebook hashtag discovery", platform: "facebook", sourceType: "hashtag", query: "LeadDrive", url: null, actorId: "scrapeforge/facebook-search-posts", build: "1.0.19" },
    { label: "Facebook page discovery", platform: "facebook", sourceType: "profile", query: "leaddrive", url: "https://www.facebook.com/leaddrive", actorId: "apify/facebook-posts-scraper", build: "0.0.351" },
    { label: "TikTok global discovery", platform: "tiktok", sourceType: "keyword", query: "Bravo Supermarket", url: null, actorId: "clockworks/tiktok-scraper", build: "0.0.561" },
  ])("pins the verified $label build instead of using the route contract", async ({ platform, sourceType, query, url, actorId, build }) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const endpoint = new URL(String(input))
      expect(endpoint.pathname).toContain(actorId.replace("/", "~"))
      expect(endpoint.searchParams.get("build")).toBe(build)
      return new Response(JSON.stringify({ data: { id: "external-discovery-1", defaultDatasetId: "dataset-discovery-1", buildId: "immutable-provider-build" } }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runApifyAsyncCollector({
      ...source,
      platform,
      sourceType,
      query,
      url,
    })

    expect(result).toMatchObject({ status: "success", rawStats: expect.objectContaining({ actorId, queued: true }) })
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorBuild: build }),
    }))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("blocks an unpinned custom actor instead of treating the route contract as a build", async () => {
    deps.getSocialMonitoringSettings.mockResolvedValue({
      ...settings,
      searchIndex: {
        ...settings.searchIndex,
        apifyActors: { ...settings.searchIndex.apifyActors, tiktokSearch: "custom/tiktok-discovery" },
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector({
      ...source,
      platform: "tiktok",
      sourceType: "keyword",
      query: "Bravo Supermarket",
    })).resolves.toMatchObject({
      status: "skipped",
      error: "apify_actor_build_not_pinned",
      rawStats: { providerRequestDispatched: false, failClosed: true },
    })
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses native Instagram discovery for broad Meta keyword sources", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        hashtags: string[]
        resultsLimit: number
        resultsType: string
        keywordSearch: boolean
      }
      expect(body).toMatchObject({
        hashtags: ["leaddrive"],
        resultsLimit: 50,
        resultsType: "posts",
        keywordSearch: true,
      })
      return new Response(JSON.stringify({ data: { id: "external-search-1", defaultDatasetId: "dataset-search-1" } }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runApifyAsyncCollector({
      ...source,
      sourceType: "search_url",
      url: "https://www.instagram.com/leaddrive/",
      handle: "leaddrive",
    })

    expect(result).toMatchObject({ status: "success", rawStats: expect.objectContaining({ actorId: "apify/instagram-hashtag-scraper", queued: true }) })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("apify~instagram-hashtag-scraper")
  })

  it("reuses a fresh imported discovery so the dependent comments route can advance", async () => {
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({
      id: "fresh-discovery",
      status: "IMPORTED",
      receivedCount: 12,
      acceptedCount: 4,
      duplicateCount: 2,
      rejectedCount: 6,
      reviewCount: 0,
      inputSnapshot: {
        leadDriveProviderWindow: {
          since: "2026-07-28T08:00:00.000Z",
          until: "2026-07-28T09:00:00.000Z",
        },
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector({
      ...source,
      platform: "facebook",
      sourceType: "keyword",
      query: "leaddrive",
      keywords: ["leaddrive"],
      url: null,
    })).resolves.toMatchObject({
      status: "success",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      rawStats: expect.objectContaining({
        providerRunId: "fresh-discovery",
        queued: false,
        reusedFreshDiscovery: true,
        reusedReceivedCount: 12,
        reusedAcceptedCount: 4,
        until: "2026-07-28T09:00:00.000Z",
      }),
    })
    expect(mockPrisma.socialProviderRun.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        routePlanId: "route-1",
        actorId: "scrapeforge/facebook-search-posts",
        inputHash: expect.any(String),
      }),
    }))
  })

  it("does not reuse a fresh discovery from a different provider input", async () => {
    const staleInputHash = crypto.createHash("sha256")
      .update("apify-input:org-1:{\"hashtags\":[\"oldquery\"],\"resultsLimit\":100,\"resultsType\":\"posts\",\"keywordSearch\":false}")
      .digest("hex")
    mockPrisma.socialProviderRun.findFirst.mockImplementation(async (args: {
      where?: { inputHash?: string }
    }) => args.where?.inputHash === staleInputHash
      ? {
          id: "stale-discovery",
          status: "IMPORTED",
          receivedCount: 10,
          acceptedCount: 4,
          inputSnapshot: {},
        }
      : null)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { id: "external-new-query", defaultDatasetId: "dataset-new-query" },
    }), { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await runApifyAsyncCollector(source)

    expect(result).toMatchObject({
      status: "success",
      rawStats: expect.objectContaining({ queued: true }),
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledOnce()
  })

  it("degrades the route when more than 20 percent of a completed dataset violates the schema", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 100,
      timeoutSeconds: 900,
      actorBuild: "stable",
      source,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/actor-runs/")) return new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", finishedAt: "2020-01-01T00:00:00.000Z", usageTotalUsd: 0.42, buildId: "stable" } }), { status: 200 })
      return new Response(JSON.stringify([
        { id: "1", url: "https://instagram.com/p/1", caption: "leaddrive one", videoUrl: "https://cdn.example/video.mp4", displayUrl: "https://cdn.example/cover.jpg", timestamp: "2026-07-11T10:00:00Z" },
        { id: "2", url: "https://instagram.com/p/2", caption: "leaddrive two", timestamp: "2026-07-11T10:01:00Z" },
        { id: "3", url: "https://instagram.com/p/3", caption: "leaddrive three", timestamp: "2026-07-11T10:02:00Z" },
        { id: "invalid-no-url", caption: "leaddrive malformed" },
      ]), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await importApifyProviderRun("provider-run-1")

    expect(result).toEqual({ status: "PARTIAL", imported: 3, error: "apify_schema_drift_threshold" })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(3)
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      sourceMetadata: expect.objectContaining({
        mediaType: "VIDEO",
        mediaUrl: "https://cdn.example/video.mp4",
        audioUrl: "https://cdn.example/video.mp4",
        thumbnailUrl: "https://cdn.example/cover.jpg",
      }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PARTIAL", receivedCount: 4, acceptedCount: 3, rejectedCount: 1, reservedChargeUsd: 0, actualChargeUsd: 0.42 }),
    }))
    expect(mockPrisma.sourceRoutePlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DEGRADED", lastFailureClass: "SCHEMA_DRIFT" }),
    }))
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("keeps the discovery cursor unchanged when a successful Actor returns an empty dataset", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-empty",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-empty",
      datasetId: "dataset-empty",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "scrapeforge/facebook-search-posts",
      maxItems: 100,
      timeoutSeconds: 900,
      actorBuild: "1.0.19",
      createdAt: new Date("2026-07-28T10:00:00.000Z"),
      inputSnapshot: {},
      source: {
        ...source,
        platform: "facebook",
        sourceType: "keyword",
        query: "LeadDrive",
        keywords: ["LeadDrive"],
      },
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({
          data: {
            status: "SUCCEEDED",
            defaultDatasetId: "dataset-empty",
            finishedAt: "2020-01-01T00:00:00.000Z",
            usageTotalUsd: 0.01,
          },
        }), { status: 200 })
      : new Response(JSON.stringify([]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-empty")).resolves.toEqual({
      status: "PARTIAL",
      imported: 0,
      error: "apify_empty_discovery_dataset",
    })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "PARTIAL",
        receivedCount: 0,
        acceptedCount: 0,
        actualChargeUsd: 0.01,
        lastError: "apify_empty_discovery_dataset",
      }),
    }))
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockPrisma.sourceRoutePlan.findMany).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: "empty Facebook discovery",
      platform: "facebook",
      actorId: "scrapeforge/facebook-search-posts",
      datasetItems: [],
      expectedError: "apify_empty_discovery_dataset",
      snapshot: {},
    },
    {
      label: "blocked Facebook discovery",
      platform: "facebook",
      actorId: "scrapeforge/facebook-search-posts",
      datasetItems: [{
        inputUrl: "https://facebook.com/search/posts?q=LeadDrive",
        error: "no_items",
        requestErrorMessages: ["Request blocked after session retries"],
      }],
      expectedError: "apify_provider_blocked",
      snapshot: {},
    },
    {
      label: "blocked paired Instagram posts discovery",
      platform: "instagram",
      actorId: "apify/instagram-hashtag-scraper",
      datasetItems: [{
        inputUrl: "https://instagram.com/explore/search/keyword/?q=LeadDrive",
        error: "no_items",
        requestErrorMessages: ["Request blocked after session retries"],
      }],
      expectedError: "apify_provider_blocked",
      snapshot: {
        leadDriveInstagramResultsType: "posts",
        leadDriveInstagramReelsBudget: {
          maxItems: 50,
          maxTotalChargeUsd: 25,
        },
      },
    },
  ])("keeps authorized comments pending after $label", async ({
    platform,
    actorId,
    datasetItems,
    expectedError,
    snapshot,
  }) => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-manual-comments",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-manual-comments",
      datasetId: "dataset-manual-comments",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-manual-comments",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId,
      maxItems: 100,
      timeoutSeconds: 900,
      actorBuild: "stable",
      createdAt: new Date("2026-07-28T10:00:00.000Z"),
      inputSnapshot: {
        leadDriveManualPaidRun: true,
        leadDriveClientFundedManual: true,
        operatorAuthorizedMaxTotalChargeUsd: 50,
        leadDriveDependentCommentsAuthorized: true,
        leadDriveDependentCommentsMaxTotalChargeUsd: 50,
        leadDriveSourceAuthorizedMaxTotalChargeUsd: 100,
        leadDriveDiscoveryMaxTotalChargeUsd: 50,
        ...snapshot,
      },
      source: {
        ...source,
        platform,
        sourceType: "keyword",
        query: "LeadDrive",
        keywords: ["LeadDrive"],
      },
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/actor-runs/")
        ? new Response(JSON.stringify({
            data: {
              status: "SUCCEEDED",
              defaultDatasetId: "dataset-manual-comments",
              finishedAt: "2020-01-01T00:00:00.000Z",
              usageTotalUsd: 0.01,
            },
          }), { status: 200 })
        : new Response(JSON.stringify(datasetItems), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-manual-comments"))
      .resolves.toMatchObject({
        status: "PARTIAL",
        imported: 0,
        error: expectedError,
      })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "provider-run-manual-comments" }),
        data: expect.objectContaining({
          status: "PARTIAL",
          inputSnapshot: expect.objectContaining({
            leadDriveDependentCommentsPending: true,
          }),
        }),
      }),
    )
  })

  it("reports provider no-items rows as a public coverage gap instead of schema drift", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "0.0.322",
      source: {
        ...source,
        platform: "facebook",
        sourceType: "profile",
        url: "https://facebook.com/brand",
      },
      routePlan: { capability: "READ_EXTERNAL_COMMENTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", finishedAt: "2020-01-01T00:00:00.000Z", usageTotalUsd: 0.021 } }), { status: 200 })
      : new Response(JSON.stringify([
        { inputUrl: "https://facebook.com/brand/posts/1", error: "no_items", errorDescription: "Empty or private data for provided input" },
        { inputUrl: "https://facebook.com/brand/posts/2", error: "no_items", errorDescription: "Empty or private data for provided input" },
      ]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({
      status: "PARTIAL",
      imported: 0,
      error: "apify_no_public_items",
    })
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "PARTIAL",
        receivedCount: 2,
        acceptedCount: 0,
        rejectedCount: 2,
        actualChargeUsd: 0.021,
        lastError: "apify_no_public_items",
      }),
    }))
    expect(mockPrisma.sourceRoutePlan.updateMany).not.toHaveBeenCalled()
    expect(deps.recordSourceRouteResult).not.toHaveBeenCalled()
  })

  it("distinguishes provider blocking from a genuine no-public-items response", () => {
    expect(apifyDatasetItemError({
      error: "no_items",
      requestErrorMessages: [
        "Request blocked, retrying it again with different session",
      ],
    })).toBe("apify_provider_blocked")
    expect(apifyDatasetItemError({
      error: "no_items",
      errorDescription: "Empty or private data for provided input",
    })).toBe("apify_no_public_items")
    expect(apifyDatasetItemError({
      error: "no_items",
      requestErrorMessages: [
        "Retrying it again with different session",
      ],
    })).toBe("apify_no_public_items")
    expect(apifyDatasetItemError({
      error: "No videos found for the search query",
      errorCode: "SEARCH_QUERY_NOT_FOUND",
      input: "Baku Electronics",
    })).toBe("apify_no_public_items")
  })

  it("opens the Apify route circuit after the actor exhausts blocked sessions without auto-spending on fallback", async () => {
    const physicalPlan = {
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "APIFY_ASYNC",
      fallbackAdapters: ["BRIGHT_DATA_SNAPSHOT", "MANUAL_TASK"],
      capabilityProofId: "proof-1",
      connectionAccountId: null,
      acquisitionMode: "APIFY_FALLBACK",
      dependsOnCapability: null,
      budget: { maxItems: 10, maxTotalChargeUsd: 0.5 },
      rateLimit: { circuitCooldownSeconds: 120 },
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "0.0.322",
      source: {
        ...source,
        platform: "instagram",
        sourceType: "profile",
        url: "https://www.instagram.com/arazsupermarket/",
      },
      routePlan: physicalPlan,
    })
    mockPrisma.sourceRoutePlan.findMany.mockImplementation(async (args: {
      where?: { capability?: string }
    }) => {
      if (args.where?.capability === "DISCOVER_POSTS") {
        return [
          { id: "route-1", ...physicalPlan },
          { id: "route-alias-1", ...physicalPlan },
        ]
      }
      if (args.where?.capability === "READ_EXTERNAL_COMMENTS") {
        return [{
          id: "comments-route-1",
          capability: "READ_EXTERNAL_COMMENTS",
          acquisitionMode: "APIFY_FALLBACK",
        }]
      }
      return []
    })
    // If reconciliation accidentally queues the dependent comment actor, this
    // fresh candidate makes the extra provider POST observable.
    mockPrisma.socialMention.findMany.mockResolvedValue([{
      canonicalUrl: "https://instagram.com/p/old-candidate",
      url: null,
      parentPostUrl: null,
    }])
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({
        data: {
          status: "SUCCEEDED",
          defaultDatasetId: "dataset-1",
          usageTotalUsd: 0.02,
        },
      }), { status: 200 })
      : new Response(JSON.stringify([{
        inputUrl: "https://www.instagram.com/arazsupermarket/",
        error: "no_items",
        requestErrorMessages: [
          "Request blocked, retrying it again with different session",
          "Request blocked, retrying it again with different session",
        ],
      }]), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({
      status: "PARTIAL",
      imported: 0,
      error: "apify_provider_blocked",
    })
    expect(deps.recordSourceRouteResult).toHaveBeenCalledWith("org-1", "route-1", {
      ok: false,
      failureClass: "apify_provider_blocked",
      forceCircuitOpen: true,
    })
    expect(deps.recordSourceRouteResult).toHaveBeenCalledWith("org-1", "route-alias-1", {
      ok: false,
      failureClass: "apify_provider_blocked",
      forceCircuitOpen: true,
    })
    expect(deps.recordSourceRouteResult).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockPrisma.sourceRoutePlan.findMany.mock.calls.some(([args]) => (
      (args as { where?: { capability?: string } }).where?.capability === "READ_EXTERNAL_COMMENTS"
    ))).toBe(false)
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("does not force-open the route when a mixed dataset also contains usable content", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "0.0.689",
      source: {
        ...source,
        platform: "instagram",
        sourceType: "profile",
        url: "https://www.instagram.com/arazsupermarket/",
      },
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({
        data: {
          status: "SUCCEEDED",
          defaultDatasetId: "dataset-1",
          usageTotalUsd: 0.03,
        },
      }), { status: 200 })
      : new Response(JSON.stringify([
        {
          id: "post-1",
          url: "https://instagram.com/p/post-1",
          caption: "leaddrive launch",
          timestamp: "2026-07-23T01:00:00Z",
        },
        {
          inputUrl: "https://instagram.com/p/post-2",
          error: "no_items",
          requestErrorMessages: ["Request blocked after session retries"],
        },
      ]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({
      status: "PARTIAL",
      imported: 1,
      error: "apify_provider_blocked",
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(1)
    expect(deps.recordSourceRouteResult).toHaveBeenCalledWith("org-1", "route-1", {
      ok: false,
      failureClass: "apify_provider_blocked",
      forceCircuitOpen: false,
    })
  })

  it("does not re-import or mutate route health for a duplicate webhook after a partial import", async () => {
    const runningRun = {
      id: "provider-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "0.0.689",
      source: {
        ...source,
        platform: "instagram",
        sourceType: "profile",
        url: "https://www.instagram.com/arazsupermarket/",
      },
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    }
    mockPrisma.socialProviderRun.findUnique
      .mockResolvedValueOnce(runningRun)
      .mockResolvedValueOnce({
        ...runningRun,
        status: "PARTIAL",
        importedAt: new Date("2026-07-23T02:00:00Z"),
        lastError: "apify_provider_blocked",
      })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({
        data: {
          status: "SUCCEEDED",
          defaultDatasetId: "dataset-1",
          usageTotalUsd: 0.02,
        },
      }), { status: 200 })
      : new Response(JSON.stringify([{
        error: "no_items",
        requestErrorMessages: ["Request blocked after session retries"],
      }]), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({
      status: "PARTIAL",
      imported: 0,
      error: "apify_provider_blocked",
    })
    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({
      status: "PARTIAL",
      imported: 0,
      error: "apify_provider_blocked",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(deps.recordSourceRouteResult).toHaveBeenCalledTimes(1)
  })

  it("attributes facebook page posts to the page itself so own posts never read as 'from others' (owner regression 2026-07-21)", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "0.0.351",
      source: {
        ...source,
        platform: "facebook",
        sourceType: "profile",
        url: "https://www.facebook.com/arazsupermarket",
      },
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.02 } }), { status: 200 })
      : new Response(JSON.stringify([
        {
          // apify/facebook-posts-scraper shape: page identity lives in
          // pageName + facebookUrl (page root), never authorName/ownerUsername.
          id: "pfbid0own",
          url: "https://www.facebook.com/arazsupermarket/posts/pfbid0own",
          facebookUrl: "https://www.facebook.com/arazsupermarket",
          pageName: "Araz Supermarket",
          text: "Arazın Divindən Div boyda endirimlər! leaddrive",
          time: "2026-07-20T10:00:00.000Z",
          likesCount: 5,
        },
        {
          // Guard: a post URL (extra path segments) must never become a handle.
          id: "pfbid0guard",
          url: "https://www.facebook.com/arazsupermarket/posts/pfbid0guard",
          facebookUrl: "https://www.facebook.com/arazsupermarket/posts/pfbid0guard",
          text: "İkinci post leaddrive",
          time: "2026-07-20T11:00:00.000Z",
        },
      ]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 2 })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "apify:pfbid0own",
      authorName: "Araz Supermarket",
      authorHandle: "arazsupermarket",
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "apify:pfbid0guard",
      authorName: null,
      authorHandle: null,
    }))
  })

  it("imports external comments only after keyword relevance accepts them", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "stable",
      source,
      routePlan: { capability: "READ_EXTERNAL_COMMENTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockImplementation((text: string) => text.toLowerCase().includes("leaddrive") ? "leaddrive" : null)
    deps.ingestMentionWithResult.mockImplementation(async (input: { externalId: string; matchedTerm?: string | null }) => input.matchedTerm
      ? { id: `mention-${input.externalId}`, created: true }
      : { id: "", created: false, accepted: false, reason: "required_term_missing" })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", finishedAt: "2020-01-01T00:00:00.000Z", usageTotalUsd: 0.03 } }), { status: 200 })
      : new Response(JSON.stringify([
        { id: "comment-1", commentUrl: "https://instagram.com/p/post-1?comment_id=1", postUrl: "https://instagram.com/p/post-1", text: "LeadDrive помогает", ownerUsername: "alice" },
        { id: "comment-2", commentUrl: "https://instagram.com/p/post-1?comment_id=2", postUrl: "https://instagram.com/p/post-1", text: "Обычный комментарий", ownerUsername: "bob" },
      ]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 1 })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(2)
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(1, expect.objectContaining({
      contentKind: "COMMENT",
      matchedTerm: "leaddrive",
      parentPostUrl: "https://instagram.com/p/post-1",
      canonicalUrl: "https://instagram.com/p/post-1?comment_id=1",
      observation: expect.objectContaining({ requireMatchedTerm: true }),
    }))
    expect(mockPrisma.mentionEvidence.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ receivedCount: 2, acceptedCount: 1, rejectedCount: 1, actualChargeUsd: 0.03 }),
    }))
  })

  it("accepts an actionable Instagram comment only on a verified parent without repeating the brand", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "stable",
      source,
      routePlan: { capability: "READ_EXTERNAL_COMMENTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockReturnValue(null)
    deps.ingestMentionWithResult.mockImplementation(async (input: {
      externalId: string
      observation?: { relevanceStatus?: string; relevanceReason?: string }
    }) => input.observation?.relevanceStatus === "ACCEPTED"
      ? { id: `mention-${input.externalId}`, created: true }
      : { id: "", created: false, accepted: false })
    mockPrisma.socialMention.findMany.mockResolvedValue([{
      id: "parent-mention-1",
      url: "https://instagram.com/p/post-1",
      canonicalUrl: "https://instagram.com/p/post-1",
      matchedTerm: "leaddrive",
      subjectMatches: [{ subjectId: "subject-1" }],
    }])
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.02 } }), { status: 200 })
      : new Response(JSON.stringify([
        {
          id: "comment-question",
          commentUrl: "https://instagram.com/p/post-1?comment_id=question",
          postUrl: "https://instagram.com/p/post-1",
          text: "Почему заказ до сих пор не доставили?",
          ownerUsername: "customer",
        },
        {
          id: "orphan-question",
          commentUrl: "https://instagram.com/p/orphan?comment_id=question",
          postUrl: "https://instagram.com/p/orphan",
          text: "Почему заказ до сих пор не доставили?",
          ownerUsername: "other-customer",
        },
      ]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 1 })
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(1, expect.objectContaining({
      contentKind: "COMMENT",
      matchedTerm: null,
      parentMatchContext: expect.objectContaining({
        parentMentionId: "parent-mention-1",
        subjectIds: ["subject-1"],
      }),
      observation: expect.objectContaining({
        requireMatchedTerm: false,
        relevanceStatus: "ACCEPTED",
        relevanceReason: "engagement_signal_on_matched_parent",
        policySnapshot: expect.objectContaining({
          version: "social-comment-relevance-v2",
          commentRelevanceReason: "ENGAGEMENT_SIGNAL",
        }),
      }),
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(2, expect.objectContaining({
      contentKind: "COMMENT",
      matchedTerm: null,
      observation: expect.objectContaining({
        requireMatchedTerm: true,
        policySnapshot: expect.objectContaining({
          commentRelevanceClassification: "REJECTED",
          commentRelevanceReason: "NO_ACTIONABLE_SIGNAL",
        }),
      }),
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({ parentMatchContext: expect.anything() }),
    )
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receivedCount: 2,
        acceptedCount: 1,
        reviewCount: 0,
        rejectedCount: 1,
      }),
    }))
  })

  it("imports the pinned TikTok search dataset and keeps captionless videos in review", async () => {
    const tiktokSource: MonitoringSourceForRun = {
      ...source,
      platform: "tiktok",
      sourceType: "keyword",
      query: "Araz Supermarket",
      keywords: [],
      url: null,
      settings: {
        canonicalBrandQuery: true,
        aliases: ["Araz", "arazsupermarket"],
      },
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      sourceId: "src-1",
      maxItems: 10,
      timeoutSeconds: 900,
      actorId: "clockworks/tiktok-scraper",
      actorBuild: "0.0.561",
      createdAt: new Date("2026-07-30T00:00:00.000Z"),
      inputSnapshot: {
        searchQueries: ["Araz Supermarket"],
        resultsPerPage: 10,
        searchSection: "/video",
        videoSearchSorting: "LATEST",
        videoSearchDateFilter: "PAST_WEEK",
        leadDriveSuppressDependentPaidRuns: true,
        leadDriveProviderWindow: {
          since: "2026-07-23T00:00:00.000Z",
          until: "2026-07-30T00:00:00.000Z",
          resumedFromWatermark: false,
          clamped: false,
        },
      },
      source: tiktokSource,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockImplementation((text: string, terms: string[]) => {
      const normalized = text.toLocaleLowerCase()
      return terms.find(term => normalized.includes(term.toLocaleLowerCase())) ?? null
    })
    deps.ingestMentionWithResult.mockImplementation(async (input: {
      externalId: string
      observation?: { relevanceStatus?: string }
    }) => input.observation?.relevanceStatus === "REVIEW"
      ? {
          id: `review-${input.externalId}`,
          created: false,
          accepted: false,
          relevanceStatus: "REVIEW",
        }
      : { id: `mention-${input.externalId}`, created: true, envelopeId: `envelope-${input.externalId}` })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({
          data: {
            status: "SUCCEEDED",
            defaultDatasetId: "dataset-1",
            buildId: "0.0.561",
            usageTotalUsd: 0.04,
          },
        }), { status: 200 })
      : new Response(JSON.stringify([{
          id: "7659000000000000001",
          text: "Araz Supermarket endirimləri",
          createTimeISO: "2026-07-29T10:00:00.000Z",
          webVideoUrl: "https://www.tiktok.com/@customer.az/video/7659000000000000001",
          searchQuery: "Araz Supermarket",
          authorMeta: {
            name: "customer.az",
            nickName: "Customer AZ",
            profileUrl: "https://www.tiktok.com/@customer.az",
            avatar: "https://cdn.example/customer.jpg",
          },
          mediaUrls: ["https://cdn.example/video.mp4"],
          videoMeta: {
            downloadAddr: "https://cdn.example/video-fallback.mp4",
            coverUrl: "https://cdn.example/video-cover.jpg",
          },
          diggCount: 17,
          playCount: 4_321,
        }, {
          id: "7659000000000000002",
          text: null,
          createTimeISO: "2026-07-29T11:00:00.000Z",
          webVideoUrl: "https://www.tiktok.com/@silent.az/video/7659000000000000002",
          searchQuery: "Araz Supermarket",
          authorMeta: {
            name: "silent.az",
            nickName: "Silent Video",
            profileUrl: "https://www.tiktok.com/@silent.az",
            avatar: "https://cdn.example/silent.jpg",
          },
          mediaUrls: ["https://cdn.example/textless.mp4"],
          playCount: 100,
        }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({
      status: "IMPORTED",
      imported: 1,
    })
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(1, expect.objectContaining({
      externalId: "apify:7659000000000000001",
      contentKind: "VIDEO",
      text: "Araz Supermarket endirimləri",
      matchedTerm: "Araz Supermarket",
      authorName: "Customer AZ",
      authorHandle: "customer.az",
      authorAvatar: "https://cdn.example/customer.jpg",
      reach: 4_321,
      sourceMetadata: expect.objectContaining({
        providerQuery: "Araz Supermarket",
        providerQueryProvenance: "apify_search_input",
        authorUrl: "https://www.tiktok.com/@customer.az",
        mediaUrl: "https://cdn.example/video.mp4",
        mediaUrls: expect.arrayContaining([
          "https://cdn.example/video.mp4",
          "https://cdn.example/video-fallback.mp4",
        ]),
        thumbnailUrl: "https://cdn.example/video-cover.jpg",
      }),
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(2, expect.objectContaining({
      externalId: "apify:7659000000000000002",
      contentKind: "VIDEO",
      text: "[TikTok video without caption]",
      matchedTerm: null,
      sourceMetadata: expect.objectContaining({
        captionMissing: true,
        providerQuery: "Araz Supermarket",
        providerQueryProvenance: "apify_search_input",
        mediaUrls: ["https://cdn.example/textless.mp4"],
      }),
      observation: expect.objectContaining({
        requireMatchedTerm: true,
        relevanceStatus: "REVIEW",
        relevanceReason: "discovery_tiktok_video_without_caption",
      }),
    }))
    expect(deps.decideTikTokPublication).toHaveBeenCalledWith(expect.objectContaining({
      query: "Araz Supermarket",
      provider: "apify",
      caption: "Araz Supermarket endirimləri",
      creator: "customer.az",
      positiveTerms: expect.arrayContaining(["Araz Supermarket", "Araz", "arazsupermarket"]),
      freshnessSince: new Date("2026-07-23T00:00:00.000Z"),
      observedAt: new Date("2026-07-30T00:00:00.000Z"),
    }))
    expect(deps.persistTikTokPublicationDecision).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      envelopeId: "envelope-apify:7659000000000000001",
      decision: expect.objectContaining({ status: "MATCHED" }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "IMPORTED",
        receivedCount: 2,
        acceptedCount: 1,
        reviewCount: 1,
        rejectedCount: 0,
      }),
    }))
  })

  it("normalizes the pinned TikTok comments actor schema without promoting parent relevance", async () => {
    const parentUrl = "https://tiktok.com/@arazsupermarket/video/7659754973994962197"
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "PARTIAL",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 600,
      actorBuild: "0.0.423",
      inputSnapshot: { postURLs: [parentUrl] },
      source: { ...source, platform: "tiktok", query: "Araz Supermarket" },
      routePlan: { capability: "READ_EXTERNAL_COMMENTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockReturnValue(null)
    deps.ingestMentionWithResult.mockImplementation(async (input: { externalId: string; matchedTerm?: string | null }) => input.matchedTerm
      ? { id: `mention-${input.externalId}`, created: true }
      : { id: "", created: false, accepted: false })
    mockPrisma.socialMention.findMany.mockResolvedValue([{
      id: "parent-mention-1",
      url: parentUrl,
      canonicalUrl: parentUrl,
      matchedTerm: "Araz Supermarket",
      subjectMatches: [{ subjectId: "subject-araz" }],
    }])
    mockPrisma.tikTokPublicationRevisit.findUnique.mockResolvedValue({
      id: "revisit-1",
      approvedAt: new Date("2026-07-15T12:00:00.000Z"),
      lastActivityAt: new Date("2026-07-15T12:00:00.000Z"),
      lastCheckedAt: null,
      status: "ACTIVE",
      reactivationGeneration: 0,
      lastSeenCommentCount: 0,
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.05 } }), { status: 200 })
      : new Response(JSON.stringify([{
          videoWebUrl: "https://www.tiktok.com/@arazsupermarket/video/7659754973994962197",
          submittedVideoUrl: parentUrl,
          input: parentUrl,
          cid: "7659793636661986065",
          createTime: 1784116725,
          createTimeISO: "2026-07-15T13:18:45.000Z",
          text: "Qiymətlər haqqında adi şərh",
          diggCount: 2,
          repliesToId: null,
          uniqueId: "customer.az",
          avatarThumbnail: "https://cdn.example/customer.jpg",
        }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 0 })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "apify:7659793636661986065",
      contentKind: "COMMENT",
      postExternalId: "7659754973994962197",
      threadExternalId: "7659754973994962197",
      parentPostUrl: parentUrl,
      url: parentUrl,
      matchedTerm: null,
      authorHandle: "customer.az",
      authorAvatar: "https://cdn.example/customer.jpg",
      parentMatchContext: expect.objectContaining({ parentMentionId: "parent-mention-1" }),
      sourceMetadata: expect.not.objectContaining({ inheritedParentMatch: true }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "IMPORTED", receivedCount: 1, acceptedCount: 0, rejectedCount: 1 }),
    }))
    expect(mockPrisma.tikTokPublicationRevisit.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_id: { organizationId: "org-1", id: "revisit-1" } },
      data: expect.objectContaining({ lastCheckedAt: expect.any(Date), coverageClass: "COMPLETE" }),
    }))
  })

  it("flattens nested Instagram replies with explicit parent and thread identity", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "stable",
      source,
      routePlan: { capability: "READ_EXTERNAL_COMMENTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockReturnValue("leaddrive")
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", finishedAt: "2020-01-01T00:00:00.000Z", usageTotalUsd: 0.01 } }), { status: 200 })
      : new Response(JSON.stringify([{
          id: "comment-1",
          commentUrl: "https://instagram.com/p/post-1?comment_id=1",
          postUrl: "https://instagram.com/p/post-1",
          postId: "post-1",
          text: "LeadDrive parent",
          ownerUsername: "alice",
          replies: [{
            id: "reply-1",
            text: "LeadDrive reply",
            ownerUsername: "bob",
            ownerProfilePicUrl: "https://cdn.example/bob.jpg",
            timestamp: "2026-07-13T10:00:00Z",
          }],
        }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 2 })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(2)
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(2, expect.objectContaining({
      externalId: "apify:reply-1",
      contentKind: "REPLY",
      sourceType: "reply",
      postExternalId: "post-1",
      parentExternalId: "comment-1",
      threadExternalId: "post-1",
      replyToExternalId: "comment-1",
      depth: 1,
      parentPostUrl: "https://instagram.com/p/post-1",
      url: "https://instagram.com/p/post-1",
      authorHandle: "bob",
      authorAvatar: "https://cdn.example/bob.jpg",
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ receivedCount: 2, acceptedCount: 2, rejectedCount: 0, actualChargeUsd: 0.01 }),
    }))
  })

  it("normalizes the maintained actor's flat reply rows from comment URL identity", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 20,
      timeoutSeconds: 180,
      actorBuild: "b9EFc61xQ6Qctn1wM",
      source,
      routePlan: { capability: "READ_EXTERNAL_COMMENTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockReturnValue("leaddrive")
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", finishedAt: "2020-01-01T00:00:00.000Z", usageTotalUsd: 0.0437 } }), { status: 200 })
      : new Response(JSON.stringify([
          {
            id: "18000000000000001",
            commentUrl: "https://www.instagram.com/p/post-1/c/18000000000000001",
            parentCommentUrl: "",
            postUrl: "https://www.instagram.com/p/post-1/",
            text: "LeadDrive parent",
            ownerUsername: "alice",
            timestamp: "2026-07-13T10:00:00Z",
          },
          {
            id: "18000000000000002",
            commentUrl: "https://www.instagram.com/p/post-1/c/18000000000000001/r/18000000000000002",
            parentCommentUrl: "https://www.instagram.com/p/post-1/c/18000000000000001/",
            postUrl: "https://www.instagram.com/p/post-1/",
            text: "LeadDrive reply",
            ownerUsername: "bob",
            timestamp: "2026-07-13T10:01:00Z",
          },
        ]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 2 })
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(1, expect.objectContaining({
      contentKind: "COMMENT",
      postExternalId: "post-1",
      parentExternalId: null,
      threadExternalId: "post-1",
      depth: 0,
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(2, expect.objectContaining({
      externalId: "apify:18000000000000002",
      contentKind: "REPLY",
      sourceType: "reply",
      postExternalId: "post-1",
      parentExternalId: "18000000000000001",
      threadExternalId: "post-1",
      replyToExternalId: "18000000000000001",
      depth: 1,
      parentPostUrl: "https://www.instagram.com/p/post-1/",
      canonicalUrl: "https://www.instagram.com/p/post-1/c/18000000000000001/r/18000000000000002",
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ receivedCount: 2, acceptedCount: 2, duplicateCount: 0, actualChargeUsd: 0.0437 }),
    }))
  })

  it("keeps neutral comments on a verified parent in review and rejects an orphan", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "stable",
      source,
      routePlan: { capability: "READ_EXTERNAL_COMMENTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockReturnValue(null)
    deps.ingestMentionWithResult.mockImplementation(async (input: {
      externalId: string
      matchedTerm?: string | null
      observation?: { relevanceStatus?: string }
    }) => input.matchedTerm
      ? { id: `mention-${input.externalId}`, created: true }
      : input.observation?.relevanceStatus === "REVIEW"
        ? { id: "", created: false, accepted: false, relevanceStatus: "REVIEW" }
        : { id: "", created: false, accepted: false })
    mockPrisma.socialMention.findMany.mockResolvedValue([{
      id: "mention-parent-1",
      url: "https://instagram.com/p/post-1",
      canonicalUrl: null,
      matchedTerm: "leaddrive",
      subjectMatches: [{ subjectId: "subject-1" }],
    }])
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.03 } }), { status: 200 })
      : new Response(JSON.stringify([
        { id: "comment-1", commentUrl: "https://instagram.com/p/post-1?comment_id=1", postUrl: "https://instagram.com/p/post-1", text: "спасибо, очень полезно 👍", ownerUsername: "alice" },
        { id: "comment-2", commentUrl: "https://instagram.com/p/orphan?comment_id=2", postUrl: "https://instagram.com/p/orphan", text: "обычный комментарий", ownerUsername: "bob" },
      ]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 0 })
    // Parents resolved once per batch, org+platform scoped, posts only.
    expect(mockPrisma.socialMention.findMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.socialMention.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        platform: "instagram",
        contentKind: { notIn: ["COMMENT", "REPLY"] },
      }),
    }))
    // Parent context remains auditable and the neutral comment is retained for
    // review, but it still gets no inherited term or accepted mention.
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(1, expect.objectContaining({
      contentKind: "COMMENT",
      matchedTerm: null,
      parentMatchContext: expect.objectContaining({
        parentMentionId: "mention-parent-1",
        matchedTerm: "leaddrive",
        subjectIds: ["subject-1"],
      }),
      sourceMetadata: expect.not.objectContaining({ inheritedParentMatch: true }),
      observation: expect.objectContaining({
        requireMatchedTerm: false,
        relevanceStatus: "REVIEW",
        relevanceReason: "comment_on_verified_brand_parent",
        relevanceConfidence: 0.4,
        policySnapshot: expect.objectContaining({
          commentRelevanceClassification: "REJECTED",
          commentRelevanceReason: "NO_ACTIONABLE_SIGNAL",
        }),
      }),
    }))
    // Orphan comment (parent never matched) keeps strict behavior: no inherited term.
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(2, expect.objectContaining({
      matchedTerm: null,
      observation: expect.objectContaining({ requireMatchedTerm: true }),
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ parentMatchContext: expect.anything() }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receivedCount: 2,
        acceptedCount: 0,
        reviewCount: 1,
        rejectedCount: 1,
      }),
    }))
  })

  it("resolves parent posts through evidence permalinks when mention urls were canonicalized", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "stable",
      source,
      routePlan: { capability: "READ_EXTERNAL_COMMENTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockReturnValue(null)
    deps.ingestMentionWithResult.mockImplementation(async (input: { externalId: string; matchedTerm?: string | null }) => input.matchedTerm
      ? { id: `mention-${input.externalId}`, created: true }
      : { id: "", created: false, accepted: false })
    mockPrisma.socialMention.findMany.mockResolvedValue([])
    mockPrisma.mentionEvidence.findMany.mockResolvedValue([{
      permalink: "https://instagram.com/p/post-1?igsh=abc",
      mention: {
        id: "mention-parent-2",
        platform: "instagram",
        contentKind: "POST",
        matchedTerm: "leaddrive",
        subjectMatches: [{ subjectId: "subject-2" }],
      },
    }])
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.03 } }), { status: 200 })
      : new Response(JSON.stringify([
        { id: "comment-1", commentUrl: "https://instagram.com/p/post-1?comment_id=1", postUrl: "https://instagram.com/p/post-1?igsh=abc", text: "əla xəbərdir", ownerUsername: "carol" },
      ]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 0 })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      matchedTerm: null,
      parentMatchContext: expect.objectContaining({ parentMentionId: "mention-parent-2" }),
    }))
  })

  it("imports and normalizes native Facebook keyword-search results", async () => {
    const facebookSource: MonitoringSourceForRun = {
      ...source,
      platform: "facebook",
      sourceType: "keyword",
      query: "LeadDrive",
      // Keywords sort before the query in providerConfiguredTerms. Provenance
      // must still name the dispatched query from the run snapshot, never the
      // keywords-first fallback (#635 review).
      keywords: ["Legacy keyword"],
      url: null,
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "scrapeforge/facebook-search-posts",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "1.0.19",
      createdAt: new Date("2026-07-22T21:00:00.000Z"),
      inputSnapshot: {
        query: "LeadDrive",
        leadDriveUnsentProviderTerms: ["Legacy keyword"],
        leadDriveProviderWindow: {
          since: "2026-07-22T19:55:00.000Z",
          until: "2026-07-22T21:00:00.000Z",
        },
      },
      source: facebookSource,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1" } }), { status: 200 })
      : new Response(JSON.stringify([{
        post_id: "pfbid-native-1",
        type: "photo",
        url: "https://www.facebook.com/johndoe/posts/pfbid-native-1",
        message: "LeadDrive müştəri rəyi",
        timestamp: 1784750400,
        reactions_count: 156,
        comments_count: 42,
        reshare_count: 12,
        author: {
          id: "author-1",
          name: "John Doe",
          url: "https://www.facebook.com/johndoe",
          profile_picture_url: "https://cdn.example.com/johndoe.jpg",
        },
        image: { uri: "https://cdn.example.com/post.jpg" },
      }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 1 })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledOnce()
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "facebook",
      externalId: "apify:pfbid-native-1",
      postExternalId: "pfbid-native-1",
      url: "https://www.facebook.com/johndoe/posts/pfbid-native-1",
      text: "LeadDrive müştəri rəyi",
      engagement: 156,
      authorName: "John Doe",
      authorHandle: "johndoe",
      authorAvatar: "https://cdn.example.com/johndoe.jpg",
      sourceMetadata: expect.objectContaining({
        thumbnailUrl: "https://cdn.example.com/post.jpg",
        mediaType: "IMAGE",
        providerQuery: "LeadDrive",
        providerQueryProvenance: "apify_search_input",
      }),
    }))
    const finalData = mockPrisma.socialProviderRun.updateMany.mock.calls.at(-1)?.[0]?.data
    expect(finalData).not.toHaveProperty("reservedChargeUsd")
    expect(finalData).not.toHaveProperty("actualChargeUsd")
  })

  it("stamps each Instagram finding with the term from its own crawled input URL", async () => {
    const instagramSource: MonitoringSourceForRun = {
      ...source,
      platform: "instagram",
      sourceType: "keyword",
      query: "Araz Supermarket",
      keywords: [],
      url: null,
      settings: { canonicalBrandQuery: true, aliases: ["ArazMarket"] },
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-ig-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-ig-1",
      datasetId: "dataset-ig-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/instagram-hashtag-scraper",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "0.0.596",
      createdAt: new Date("2026-07-22T21:00:00.000Z"),
      inputSnapshot: {
        hashtags: ["Araz Supermarket", "ArazMarket"],
        resultsLimit: 5,
        keywordSearch: true,
        leadDriveProviderWindow: {
          since: "2026-07-22T19:55:00.000Z",
          until: "2026-07-22T21:00:00.000Z",
        },
      },
      source: instagramSource,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-ig-1" } }), { status: 200 })
      : new Response(JSON.stringify([
        {
          id: "ig-keyword-1",
          url: "https://instagram.com/p/ig-keyword-1",
          caption: "Araz Market endirim",
          timestamp: "2026-07-22T20:10:00Z",
          // Deliberately NOT the canonical query: the q= branch must be the
          // only chain link able to produce this value, so a regression in it
          // cannot hide behind the configured-term fallback (review of #642).
          inputUrl: "https://instagram.com/explore/search/keyword/?q=Araz%20Market",
        },
        {
          id: "ig-tag-1",
          url: "https://instagram.com/p/ig-tag-1",
          caption: "ArazMarket yeni filial",
          timestamp: "2026-07-22T20:20:00Z",
          inputUrl: "https://instagram.com/explore/tags/ArazMarket/",
        },
      ]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-ig-1")).resolves.toEqual({ status: "IMPORTED", imported: 2 })
    // #637: the finding carries the term that actually found it — the crawled
    // input URL's term — not the canonical brand fallback for every row.
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "apify:ig-keyword-1",
      sourceMetadata: expect.objectContaining({
        providerQuery: "Araz Market",
        providerQueryProvenance: "apify_search_input",
      }),
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "apify:ig-tag-1",
      sourceMetadata: expect.objectContaining({
        providerQuery: "ArazMarket",
        providerQueryProvenance: "apify_search_input",
      }),
    }))
  })

  it("keeps the Facebook cursor unchanged when the Actor reports a graceful plan cap", async () => {
    const facebookSource: MonitoringSourceForRun = {
      ...source,
      platform: "facebook",
      sourceType: "keyword",
      query: "LeadDrive",
      keywords: ["LeadDrive"],
      url: null,
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-facebook-capped",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-facebook-capped",
      datasetId: "dataset-facebook-capped",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "scrapeforge/facebook-search-posts",
      maxItems: 100,
      timeoutSeconds: 900,
      actorBuild: "1.0.19",
      createdAt: new Date("2026-07-22T21:00:00.000Z"),
      inputSnapshot: {
        leadDriveSuppressDependentPaidRuns: true,
        leadDriveProviderWindow: {
          cursorSince: "2026-07-22T20:00:00.000Z",
          since: "2026-07-22T19:55:00.000Z",
          until: "2026-07-22T21:00:00.000Z",
        },
      },
      source: facebookSource,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({
          data: {
            status: "SUCCEEDED",
            defaultDatasetId: "dataset-facebook-capped",
            statusMessage: "Free plan limit: max_results was automatically reduced to 20 results.",
          },
        }), { status: 200 })
      : new Response(JSON.stringify([{
          post_id: "pfbid-capped-1",
          type: "photo",
          url: "https://www.facebook.com/johndoe/posts/pfbid-capped-1",
          message: "LeadDrive capped result",
          timestamp: 1784750400,
          author: { id: "author-1", name: "John Doe" },
        }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-facebook-capped")).resolves.toEqual({
      status: "PARTIAL",
      imported: 1,
      error: "apify_actor_result_cap_reached",
    })
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "PARTIAL",
        lastError: "apify_actor_result_cap_reached",
      }),
    }))
  })

  it("keeps the Instagram cursor unchanged when free usage reports first-page coverage", async () => {
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-instagram-free-page",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-instagram-free-page",
      datasetId: "dataset-instagram-free-page",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/instagram-hashtag-scraper",
      maxItems: 50,
      timeoutSeconds: 900,
      actorBuild: "0.0.585",
      createdAt: new Date("2026-07-22T21:00:00.000Z"),
      inputSnapshot: {
        hashtags: ["leaddrive"],
        resultsLimit: 50,
        resultsType: "posts",
        leadDriveSuppressDependentPaidRuns: true,
        leadDriveProviderWindow: {
          cursorSince: "2026-07-22T20:00:00.000Z",
          since: "2026-07-22T19:55:00.000Z",
          until: "2026-07-22T21:00:00.000Z",
        },
      },
      source,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({
          data: {
            status: "SUCCEEDED",
            defaultDatasetId: "dataset-instagram-free-page",
            statusMessage: "Free usage covers just the first page of results. Upgrade your plan to get more pages.",
          },
        }), { status: 200 })
      : new Response(JSON.stringify([{
          id: "instagram-free-page-1",
          inputUrl: "https://www.instagram.com/explore/tags/leaddrive/",
          url: "https://www.instagram.com/p/instagram-free-page-1/",
          caption: "LeadDrive customer story",
          timestamp: "2026-07-22T20:30:00.000Z",
          ownerUsername: "customer.az",
        }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-instagram-free-page")).resolves.toEqual({
      status: "PARTIAL",
      imported: 1,
      error: "apify_actor_result_cap_reached",
    })
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "PARTIAL",
        lastError: "apify_actor_result_cap_reached",
      }),
    }))
  })

  it("matches Instagram's compact dispatched keyword but keeps the original phrase", async () => {
    const instagramSource: MonitoringSourceForRun = {
      ...source,
      platform: "instagram",
      sourceType: "keyword",
      query: "Baku Electronics",
      keywords: ["Baku Electronics"],
      url: null,
      settings: {
        expandedQueries: [{
          term: "Baku Electronics",
          displayTerm: "Baku Electronics",
        }],
      },
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/instagram-hashtag-scraper",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "0.0.585",
      createdAt: new Date("2026-07-22T21:00:00.000Z"),
      inputSnapshot: {
        hashtags: ["BakuElectronics", "OtherBrand"],
        resultsLimit: 1,
        leadDriveSuppressDependentPaidRuns: true,
        leadDriveProviderWindow: {
          since: "2026-07-22T19:55:00.000Z",
          until: "2026-07-22T21:00:00.000Z",
        },
      },
      source: instagramSource,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockImplementation((text: string, terms: string[]) =>
      terms.find(term => text.toLocaleLowerCase().includes(term.toLocaleLowerCase())) ?? null)
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({
        data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.03 },
      }), { status: 200 })
      : new Response(JSON.stringify([{
        id: "instagram-native-1",
        inputUrl: "https://www.instagram.com/explore/tags/bakuelectronics/",
        url: "https://www.instagram.com/p/instagram-native-1/",
        caption: "#BakuElectronics yeni kampaniya",
        timestamp: "2026-07-22T20:30:00.000Z",
        ownerUsername: "customer.az",
      }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({
      status: "PARTIAL",
      imported: 1,
      error: "apify_result_limit_reached",
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "instagram",
      matchedTerm: "Baku Electronics",
      text: "#BakuElectronics yeni kampaniya",
    }))
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("keeps the cursor unchanged when a raw Google query fills its page limit", async () => {
    const searchSource = {
      ...source,
      sourceType: "search_url",
      url: "https://www.instagram.com/leaddrive/",
      handle: "leaddrive",
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/google-search-scraper",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "stable",
      createdAt: new Date("2026-07-22T21:00:00.000Z"),
      inputSnapshot: {
        queries: "\"leaddrive\" site:instagram.com",
        maxPagesPerQuery: 1,
        resultsPerPage: 3,
        leadDriveFullArchiveRun: true,
        leadDriveTargetScenarioId: "scenario-target",
        leadDriveArchiveStartAt: "2026-04-01T09:30:00.000Z",
        leadDriveProviderCursorScope: {
          routePlanId: "route-1",
          adapterKey: "APIFY_ASYNC",
          fullArchiveRun: true,
          targetScenarioId: "scenario-target",
          archiveStartAt: "2026-04-01T09:30:00.000Z",
        },
        leadDriveProviderWindow: {
          cursorSince: "2026-07-22T20:00:00.000Z",
          since: "2026-07-22T19:55:00.000Z",
          until: "2026-07-22T21:00:00.000Z",
          resumedFromWatermark: true,
          clamped: false,
          overlapMinutes: 5,
        },
      },
      source: searchSource,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1" } }), { status: 200 })
      : new Response(JSON.stringify([{
        searchQuery: { term: '"leaddrive" site:instagram.com', page: 1 },
        organicResults: [
          { title: "LeadDrive reel", url: "https://www.instagram.com/reel/ABC123/", snippet: "LeadDrive review" },
          { title: "Profile", url: "https://www.instagram.com/leaddrive/", snippet: "LeadDrive profile" },
          { title: "Other", url: "https://example.com/post", snippet: "LeadDrive" },
        ],
      }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({
      status: "PARTIAL",
      imported: 1,
      error: "apify_result_limit_reached",
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(1)
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://www.instagram.com/reel/ABC123/",
      text: expect.stringContaining("LeadDrive review"),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ receivedCount: 1, acceptedCount: 1, rejectedCount: 0 }),
    }))
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "PARTIAL",
        lastError: "apify_result_limit_reached",
      }),
    }))
  })

  it("flattens multi-term Facebook hashtag fallback pages", async () => {
    const hashtagSource = {
      ...source,
      platform: "facebook",
      sourceType: "hashtag",
      query: "Araz|Bravo",
      keywords: ["Araz", "Bravo"],
      url: null,
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-facebook-hashtags",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-facebook-hashtags",
      datasetId: "dataset-facebook-hashtags",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/google-search-scraper",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "stable",
      createdAt: new Date("2026-07-22T21:00:00.000Z"),
      inputSnapshot: {},
      source: hashtagSource,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockImplementation((text: string, terms: string[]) =>
      terms.find(term => text.toLocaleLowerCase().includes(term.toLocaleLowerCase())) ?? null)
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({
          data: { status: "SUCCEEDED", defaultDatasetId: "dataset-facebook-hashtags" },
        }), { status: 200 })
      : new Response(JSON.stringify([{
          searchQuery: { term: "\"Araz\" site:facebook.com" },
          organicResults: [{
            title: "Araz campaign",
            url: "https://www.facebook.com/arazsupermarket/posts/123",
            snippet: "Araz endirimləri",
          }],
        }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-facebook-hashtags")).resolves.toEqual({
      status: "IMPORTED",
      imported: 1,
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "facebook",
      url: "https://www.facebook.com/arazsupermarket/posts/123",
      matchedTerm: "Araz",
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "provider-run-facebook-hashtags" }),
      data: expect.objectContaining({
        status: "IMPORTED",
        inputSnapshot: {
          leadDriveDependentCommentsPending: true,
        },
      }),
    }))
  })

  it("flattens global web-search results for a Web monitoring source", async () => {
    const searchSource = {
      ...source,
      platform: "web",
      sourceType: "keyword",
      query: "bravo supermarket",
      keywords: ["bravo supermarket"],
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/google-search-scraper",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "stable",
      source: searchSource,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1" } }), { status: 200 })
      : new Response(JSON.stringify([{
        searchQuery: { term: '"bravo supermarket"' },
        organicResults: [
          { title: "Bravo Supermarket xəbəri", url: "https://news.example.az/bravo-supermarket", snippet: "Bravo Supermarket haqqında yeni xəbər" },
          { title: "Google cache", url: "https://google.com/search?q=bravo", snippet: "Bravo Supermarket" },
        ],
      }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 1 })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(1)
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "web",
      url: "https://news.example.az/bravo-supermarket",
      text: expect.stringContaining("Bravo Supermarket haqqında yeni xəbər"),
      observation: expect.objectContaining({
        relevanceStatus: "REVIEW",
        relevanceReason: "discovery_missing_published_at",
      }),
    }))
  })

  it("expands Web hashtag SERPs, parses relative dates, and counts REVIEW separately after URL dedupe", async () => {
    const searchSource = {
      ...source,
      platform: "web",
      sourceType: "hashtag",
      query: "Baku Electronics",
      keywords: ["Baku Electronics"],
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/google-search-scraper",
      maxItems: 100,
      timeoutSeconds: 900,
      actorBuild: "stable",
      createdAt: new Date("2026-07-23T10:45:00.000Z"),
      inputSnapshot: {
        leadDriveTargetScenarioId: "baku-electronics",
        leadDriveProviderWindow: {
          since: "2026-07-16T10:45:00.000Z",
          until: "2026-07-23T10:45:00.000Z",
        },
      },
      source: searchSource,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    deps.findMatchedKeyword.mockImplementation((text: string, terms: string[]) =>
      terms.find(term => text.toLowerCase().includes(term.toLowerCase())) ?? null)
    deps.ingestMentionWithResult.mockImplementation(async (input: {
      externalId: string
      url?: string | null
      observation?: { relevanceStatus?: "REVIEW" | "REJECTED" }
    }) => {
      if (input.url?.includes("subject-review")) {
        return {
          id: `envelope-${input.externalId}`,
          envelopeId: `envelope-${input.externalId}`,
          created: false,
          accepted: false,
          relevanceStatus: "REVIEW" as const,
        }
      }
      return input.observation?.relevanceStatus
        ? {
          id: `envelope-${input.externalId}`,
          envelopeId: `envelope-${input.externalId}`,
          created: false,
          accepted: false,
          relevanceStatus: input.observation.relevanceStatus,
        }
        : { id: `mention-${input.externalId}`, created: true }
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1" } }), { status: 200 })
      : new Response(JSON.stringify([{
        searchQuery: { term: "\"Baku Electronics\"" },
        organicResults: [
          {
            title: "Baku Electronics kampaniyası",
            url: "https://news.example.az/baku-offer?utm_source=google",
            snippet: "Baku Electronics üçün yeni təklif",
            lastUpdated: "2 days ago",
          },
          {
            title: "Baku Electronics kampaniyası",
            url: "https://news.example.az/baku-offer?utm_campaign=search",
            snippet: "Baku Electronics üçün yeni təklif",
            lastUpdated: "2 days ago",
          },
          {
            title: "Baku Electronics",
            url: "https://facebook.com/dcb/tcnle",
            snippet: "Baku Electronics rəsmi səhifəsi",
          },
          {
            title: "Baku Electronics köhnə xəbər",
            url: "https://news.example.az/old-baku-story",
            snippet: "Baku Electronics arxivi",
            lastUpdated: "2 weeks ago",
          },
          {
            title: "Texnologiya xəbərləri",
            url: "https://news.example.az/market-roundup",
            snippet: "Baku Electronics haqqında qısa qeyd",
            lastUpdated: "1 day ago",
          },
          {
            title: "Baku Electronics mağazası",
            url: "https://news.example.az/subject-review",
            snippet: "Baku Electronics haqqında dəqiq nəticə",
            lastUpdated: "1 day ago",
          },
        ],
      }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 1 })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(5)
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://news.example.az/baku-offer?utm_source=google",
      publishedAt: new Date("2026-07-21T10:45:00.000Z"),
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://facebook.com/dcb/tcnle",
      observation: expect.objectContaining({
        relevanceStatus: "REVIEW",
        relevanceReason: "discovery_missing_published_at",
      }),
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://news.example.az/old-baku-story",
      observation: expect.objectContaining({
        relevanceStatus: "REJECTED",
        relevanceReason: "discovery_outside_lookback_window",
      }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "IMPORTED",
        receivedCount: 6,
        acceptedCount: 1,
        reviewCount: 3,
        rejectedCount: 1,
        duplicateCount: 1,
      }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "IMPORTING",
        receivedCount: 6,
        acceptedCount: 1,
        reviewCount: 3,
        rejectedCount: 1,
        duplicateCount: 1,
      }),
    }))
    expect(mockPrisma.sourceRoutePlan.updateMany).not.toHaveBeenCalled()
  })

  it("deduplicates a legacy SERP URL across alias runs in the same profile", async () => {
    const searchSource = {
      ...source,
      platform: "web",
      sourceType: "keyword",
      query: "Baku Electronics",
      keywords: ["Baku Electronics"],
    }
    mockPrisma.socialProviderRun.findUnique.mockResolvedValue({
      id: "provider-run-1",
      organizationId: "org-1",
      sourceId: "src-1",
      providerKey: "APIFY",
      externalRunId: "external-1",
      datasetId: "dataset-1",
      status: "RUNNING",
      phase: "DISCOVER_CANDIDATE_POSTS",
      acceptedCount: 0,
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      adapterKey: "APIFY_ASYNC",
      actorId: "apify/google-search-scraper",
      maxItems: 10,
      timeoutSeconds: 900,
      actorBuild: "stable",
      createdAt: new Date("2026-07-23T10:45:00.000Z"),
      inputSnapshot: { leadDriveTargetScenarioId: "baku-electronics" },
      source: searchSource,
      routePlan: { capability: "DISCOVER_POSTS", acquisitionMode: "APIFY_FALLBACK" },
    })
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([{
      idempotencyKey: "ingest:legacy-baku-url",
      sourceId: "legacy-alias-source",
      url: "https://news.example.az/baku-electronics?utm_source=google",
      canonicalUrl: "https://news.example.az/baku-electronics",
      subjectDecision: {},
      providerRun: {
        inputSnapshot: { leadDriveTargetScenarioId: "baku-electronics" },
      },
      purgedAt: new Date("2026-07-22T00:00:00.000Z"),
    }])
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/actor-runs/")
      ? new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1" } }), { status: 200 })
      : new Response(JSON.stringify([{
        searchQuery: { term: "\"Baku Electronics\"" },
        organicResults: [{
          title: "Baku Electronics",
          url: "https://news.example.az/baku-electronics",
          snippet: "Baku Electronics xəbəri",
        }],
      }]), { status: 200 })))

    await expect(importApifyProviderRun("provider-run-1")).resolves.toEqual({ status: "IMPORTED", imported: 0 })
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(mockPrisma.ingestEnvelope.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ purgedAt: expect.anything() }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receivedCount: 1,
        acceptedCount: 0,
        reviewCount: 0,
        rejectedCount: 0,
        duplicateCount: 1,
      }),
    }))
  })

  it("treats an already-deleted provider dataset as a successful idempotent purge", async () => {
    mockPrisma.socialDeletionLedgerEntry.findMany.mockResolvedValue([{
      id: "ledger-1",
      organizationId: "org-1",
      metadata: { datasetId: "dataset-1", providerRunId: "provider-run-1" },
    }])
    mockPrisma.socialDeletionLedgerEntry.update.mockResolvedValue({ id: "ledger-1" })
    mockPrisma.socialProviderRun.updateMany.mockResolvedValue({ count: 1 })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })))

    await expect(processApifyDatasetDeletion()).resolves.toEqual({ completed: 1, failed: 0 })
    expect(mockPrisma.socialDeletionLedgerEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED", completedAt: expect.any(Date), lastError: null }),
    }))
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PURGED", datasetId: null, inputSnapshot: {} }),
    }))
  })
})

describe("comment candidates after official discovery", () => {
  it("reports a usable normalized mention candidate after a newer invalid URL", async () => {
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue(null)
    mockPrisma.mentionEvidence.findMany.mockResolvedValue([
      {
        permalink: "https://www.instagram.com/not-a-post/",
        mention: { canonicalUrl: "https://www.instagram.com/not-a-post/", url: null, parentPostUrl: null, contentKind: "POST" },
      },
      {
        permalink: "https://www.instagram.com/p/fresh-evidence-post/",
        mention: { canonicalUrl: "https://www.instagram.com/p/fresh-evidence-post/", url: null, parentPostUrl: null, contentKind: "POST" },
      },
    ])
    mockPrisma.socialMention.findMany.mockResolvedValue([
      {
        canonicalUrl: "https://www.instagram.com/p/fresh-normalized-post/",
        url: null,
        parentPostUrl: null,
      },
    ])

    await expect(hasApifyCommentCandidates(source)).resolves.toBe(true)
    expect(mockPrisma.mentionEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }))
    expect(mockPrisma.socialMention.findMany).not.toHaveBeenCalled()
  })

  it("does not forward invalid accepted envelope URLs to the comments actor", async () => {
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({ id: "parent-run-1", createdAt: new Date() })
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([
      { canonicalUrl: "https://www.instagram.com/profile-only/", url: null },
      { canonicalUrl: "https://www.instagram.com/reel/valid-parent/", url: null },
    ])
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { directUrls?: string[] }
      expect(body.directUrls).toEqual(["https://instagram.com/reel/valid-parent"])
      return new Response(JSON.stringify({ data: { id: "external-comments-envelope", defaultDatasetId: "dataset-envelope" } }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector({
      ...source,
      routeExecution: { ...source.routeExecution!, capability: "READ_EXTERNAL_COMMENTS" },
    })).resolves.toMatchObject({ status: "success" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not resend a fresh parent while its checkpoint is not due", async () => {
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue({ id: "parent-run-1", createdAt: new Date() })
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([{
      canonicalUrl: "https://instagram.com/p/already-scanned",
      url: null,
    }])
    mockPrisma.socialCommentCheckpoint.findMany.mockResolvedValue([])
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector({
      ...source,
      routeExecution: { ...source.routeExecution!, capability: "READ_EXTERNAL_COMMENTS" },
    })).resolves.toMatchObject({ status: "skipped", error: "apify_candidate_posts_missing" })
    expect(mockPrisma.socialCommentCheckpoint.upsert).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("revisits a due checkpoint even after raw discovery evidence has aged out", async () => {
    const dueUrl = "https://instagram.com/p/due-old-parent"
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue(null)
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([])
    mockPrisma.mentionEvidence.findMany.mockResolvedValue([])
    mockPrisma.socialMention.findMany.mockResolvedValue([])
    mockPrisma.socialCommentCheckpoint.findMany.mockResolvedValue([{
      id: "checkpoint-due",
      canonicalParentUrl: dueUrl,
      parentExternalId: null,
    }])
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ directUrls: [dueUrl] })
      return new Response(JSON.stringify({ data: { id: "external-due", defaultDatasetId: "dataset-due" } }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector({
      ...source,
      routeExecution: { ...source.routeExecution!, capability: "READ_EXTERNAL_COMMENTS" },
    })).resolves.toMatchObject({ status: "success", rawStats: expect.objectContaining({ queued: true }) })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.socialCommentCheckpoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastProviderRunId: "provider-run-1", nextDueAt: expect.any(Date) }),
    }))
  })

  it("lets a manual comments-only run revisit and lease an inactive checkpoint", async () => {
    const inactiveUrl = "https://instagram.com/p/inactive-old-negative"
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue(null)
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([])
    mockPrisma.mentionEvidence.findMany.mockResolvedValue([])
    mockPrisma.socialMention.findMany.mockResolvedValue([])
    mockPrisma.socialCommentCheckpoint.findMany.mockImplementation(async (args: {
      where?: { status?: unknown; nextDueAt?: unknown }
    }) => {
      expect(args.where?.status).toEqual({ in: ["ACTIVE", "INACTIVE"] })
      expect(args.where).not.toHaveProperty("nextDueAt")
      return [{
        id: "checkpoint-inactive",
        canonicalParentUrl: inactiveUrl,
        parentExternalId: "inactive-old-negative",
      }]
    })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ directUrls: [inactiveUrl] })
      return new Response(JSON.stringify({
        data: { id: "external-inactive", defaultDatasetId: "dataset-inactive" },
      }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector({
      ...clientFundedSource({ capability: "READ_EXTERNAL_COMMENTS" }),
      platform: "instagram",
    })).resolves.toMatchObject({ status: "success", rawStats: expect.objectContaining({ queued: true }) })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockPrisma.socialCommentCheckpoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["ACTIVE", "INACTIVE"] },
        canonicalParentUrl: { in: [inactiveUrl] },
      }),
      data: expect.objectContaining({
        lastProviderRunId: "provider-run-1",
        nextDueAt: expect.any(Date),
      }),
    }))
  })

  it("never revives stale parent runs or evidence as paid comment targets", async () => {
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue(null)
    mockPrisma.mentionEvidence.findMany.mockResolvedValue([])
    mockPrisma.socialMention.findMany.mockResolvedValue([])
    const before = Date.now() - 48 * 3_600_000

    await expect(hasApifyCommentCandidates(source)).resolves.toBe(false)

    const parentWhere = mockPrisma.socialProviderRun.findFirst.mock.calls.at(-1)?.[0]?.where
    const evidenceWhere = mockPrisma.mentionEvidence.findMany.mock.calls.at(-1)?.[0]?.where
    const mentionWhere = mockPrisma.socialMention.findMany.mock.calls.at(-1)?.[0]?.where
    for (const threshold of [parentWhere?.createdAt?.gte, evidenceWhere?.capturedAt?.gte, mentionWhere?.updatedAt?.gte]) {
      expect(threshold).toBeInstanceOf(Date)
      expect(threshold.getTime()).toBeGreaterThanOrEqual(before)
      expect(threshold.getTime()).toBeLessThanOrEqual(Date.now())
    }
  })

  it("builds comment candidates from fresh mention evidence when no Apify discovery parent exists", async () => {
    // Official Business Discovery ingests posts directly, so the comments
    // phase has no Apify parent run — only evidence permalinks.
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue(null)
    mockPrisma.mentionEvidence.findMany.mockResolvedValue([
      {
        permalink: "https://www.instagram.com/p/officially-found/",
        mention: { canonicalUrl: "https://www.instagram.com/p/officially-found/", url: null, parentPostUrl: null, contentKind: "POST" },
      },
      {
        // Profile URLs are not comment targets and must be filtered out.
        permalink: "https://www.instagram.com/baku.ws_official",
        mention: { canonicalUrl: "https://www.instagram.com/baku.ws_official", url: null, parentPostUrl: null, contentKind: "POST" },
      },
      {
        permalink: "https://www.instagram.com/p/some-comment/",
        mention: { canonicalUrl: "https://www.instagram.com/p/some-comment/", url: null, parentPostUrl: null, contentKind: "COMMENT" },
      },
    ])
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { directUrls?: string[]; resultsLimit?: number; includeNestedComments?: boolean }
      expect(body.directUrls).toEqual(["https://www.instagram.com/p/officially-found/"])
      expect(body.resultsLimit).toBe(100)
      expect(body.includeNestedComments).toBe(true)
      const endpoint = new URL(String(input))
      expect(endpoint.searchParams.get("maxItems")).toBe("100")
      expect(endpoint.searchParams.get("maxTotalChargeUsd")).toBe("1")
      return new Response(JSON.stringify({ data: { id: "external-comments-2", defaultDatasetId: "dataset-2" } }), { status: 201 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runApifyAsyncCollector({
      ...source,
      routeExecution: { ...source.routeExecution!, capability: "READ_EXTERNAL_COMMENTS" },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.status).not.toBe("skipped")
    expect(mockPrisma.socialProviderRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ phase: "EXTRACT_COMMENTS_FROM_CANDIDATES", parentRunId: null }),
    }))
  })

  it("still skips the comments phase when neither a parent run nor evidence exists", async () => {
    mockPrisma.socialProviderRun.findFirst.mockResolvedValue(null)
    mockPrisma.mentionEvidence.findMany.mockResolvedValue([])
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runApifyAsyncCollector({
      ...source,
      routeExecution: { ...source.routeExecution!, capability: "READ_EXTERNAL_COMMENTS" },
    })).resolves.toMatchObject({ status: "skipped", error: "apify_candidate_posts_missing" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
