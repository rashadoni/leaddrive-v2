import { describe, expect, it, vi } from "vitest"

// Адаптер тянет транзитивные модули приложения (next-auth, настройки,
// платёжные гейты) — для проверки чистой цепочки «сценарий → вход актора» они
// не нужны, поэтому заглушаем ровно так же, как это делает тест адаптера.
vi.mock("@/lib/prisma", () => ({ prisma: {}, logAudit: () => undefined }))
vi.mock("@/lib/secure-token", () => ({ decryptToken: () => "", hmacToken: () => "" }))
vi.mock("@/lib/sentiment", () => ({ classifySentiment: async () => "neutral" }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: () => null,
  ingestMentionWithResult: async () => ({ created: false }),
}))
vi.mock("@/lib/social/monitoring-settings", () => ({
  DEFAULT_APIFY_SEARCH_ACTORS: {},
  getSocialMonitoringSettings: async () => ({ searchIndex: { enabled: false } }),
  platformApifyToken: () => null,
}))
vi.mock("@/lib/social/source-route-plan", () => ({ recordSourceRouteResult: async () => undefined }))
vi.mock("@/lib/social/paid-run-authorization", () => ({
  tenantClientFundedManualRunsEnabled: async () => false,
  tenantProviderAccountFundedRunPolicy: async () => ({ enabled: false, dailyRunQuota: 0 }),
  tenantPaidRunEmergencyStopped: async () => true,
}))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringImportFence: async (_o: unknown, run: () => unknown) => run(),
  socialMonitoringCleanSlateBlocked: () => false,
  socialMonitoringPaidEmergencyStopped: () => false,
}))

import {
  scenarioSourceTargets,
  type MonitoringScenario,
} from "@/lib/social/monitoring-scenarios"
import {
  apifyActorForSource,
  apifyDiscoveryInput,
  type MonitoringSourceForRun,
} from "@/lib/social/apify-async-adapter"

/**
 * Сквозная гарантия: «завёл нового клиента — его название уходит в поиск Apify».
 *
 * Цепочка длинная и раньше молча рвалась в двух местах: Instagram склеивал
 * фразу в один токен из-за устаревшей сборки актора, а многословные источники
 * уходили на поиск через Google вместо площадки. Тест воспроизводит путь от
 * сценария нового бренда до фактического входа актора и падает, если любое
 * звено снова начнёт терять или искажать запрос.
 */

const ACTORS = {
  webSearch: "apify/google-search-scraper",
  facebookSearch: "scrapeforge/facebook-search-posts",
  facebookPosts: "apify/facebook-posts-scraper",
  instagramHashtag: "apify/instagram-hashtag-scraper",
  instagramProfile: "apify/instagram-scraper",
  tiktokSearch: "clockworks/tiktok-scraper",
  instagramComments: "apify/instagram-comment-scraper",
  facebookComments: "apify/facebook-comments-scraper",
  tiktokComments: "clockworks/tiktok-comments-scraper",
}

const BRAND = "Yeni Marketlər Şəbəkəsi"

function newClientScenario(): MonitoringScenario {
  return {
    id: "scn-new",
    subjectId: "subject-new",
    subjectName: BRAND,
    name: BRAND,
    description: null,
    status: "active",
    platforms: ["instagram", "facebook", "tiktok", "web"],
    search: {
      topics: [BRAND],
      keywords: ["yeni market", "şəbəkə"],
      hashtags: ["yenimarket"],
      handles: ["yenimarket"],
      urls: [],
      useHashtagFallback: true,
      includeOwnedComments: false,
      includeExternalComments: true,
    },
    ai: { sentiments: ["negative"], minConfidence: 80, action: "draft_reply", directions: ["general_reputation"] },
    reply: { identityId: null, identityLabel: null, mode: "manual_approval", autoReplyEnabled: false, liveSendAllowed: false },
    archive: { startAt: null, lastBackfilledAt: null, scannedCount: 0, matchedCount: 0, status: "pending" },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }
}

/** Источник в том виде, в каком его создаёт сценарий нового клиента. */
function sourceFromTarget(platform: string, target: ReturnType<typeof scenarioSourceTargets>[number]): MonitoringSourceForRun {
  return {
    id: `src-${platform}`,
    organizationId: "org-1",
    platform,
    sourceType: target.input.sourceType,
    ownership: "external",
    collectionMode: "search_index",
    status: "active",
    cadenceMinutes: 360,
    query: target.input.query ?? null,
    keywords: target.input.keywords ?? [],
    lastCheckedAt: null,
    lastSuccessfulAt: null,
    lastError: null,
    settings: target.input.settings ?? {},
    routeExecution: {
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      capability: "DISCOVER_POSTS",
      adapterKey: "APIFY_ASYNC",
      acquisitionMode: "APIFY_FALLBACK",
    },
  } as MonitoringSourceForRun
}

describe("новый клиент доходит до поиска Apify", () => {
  const targets = scenarioSourceTargets(newClientScenario())

  it("создаёт по одному поисковому источнику на соцсеть с названием бренда", () => {
    // web намеренно отсутствует: веб покрывается только лентами Google Alerts,
    // которые привязываются к сценарию отдельно.
    expect(targets.some(item => item.input.platform === "web")).toBe(false)
    for (const platform of ["instagram", "facebook", "tiktok"]) {
      const target = targets.find(item => item.input.platform === platform)
      expect(target, `нет источника для ${platform}`).toBeDefined()
      // Название бренда, а не первый попавшийся алиас.
      expect(target!.input.query).toBe(BRAND)
      // Один запрос на бренд: алиасы лежат рядом для фильтрации, но не
      // размножаются в дополнительные платные поиски.
      expect(target!.input.settings).toMatchObject({ canonicalBrandQuery: true })
    }
  })

  it("Facebook получает родной поиск площадки с полной фразой", () => {
    const target = targets.find(item => item.input.platform === "facebook")!
    const source = sourceFromTarget("facebook", target)

    expect(apifyActorForSource(source, "DISCOVER_POSTS", ACTORS)).toBe(ACTORS.facebookSearch)
    expect(apifyDiscoveryInput(source, 100)).toMatchObject({
      query: BRAND,
      search_type: "posts",
    })
  })

  it("Instagram ищет фразой целиком, а не слитным токеном; бренд закреплён в слоте 0 веера", () => {
    const target = targets.find(item => item.input.platform === "instagram")!
    const source = sourceFromTarget("instagram", target)

    expect(apifyActorForSource(source, "DISCOVER_POSTS", ACTORS)).toBe(ACTORS.instagramHashtag)
    const input = apifyDiscoveryInput(source, 100) as {
      hashtags: string[]
      resultsLimit: number
      keywordSearch: boolean
    }
    expect(input.keywordSearch).toBe(true)
    // Веер #638: бренд всегда первый, дальше алиасы сценария в рамках бюджета.
    expect(input.hashtags[0]).toBe(BRAND)
    expect(input.hashtags).toEqual([BRAND, "yeni market", "şəbəkə", "yenimarket"])
    // Глубина делится между слотами, а не выкупается первым термином.
    expect(input.resultsLimit).toBe(25)
    // Регрессия закреплённой сборки: склеенный вариант искал не то.
    expect(input.hashtags[0]).toContain(" ")
  })

  it("TikTok получает поисковый запрос бренда первым слотом веера с пер-терминовой глубиной", () => {
    const target = targets.find(item => item.input.platform === "tiktok")!
    const source = sourceFromTarget("tiktok", target)

    expect(apifyActorForSource(source, "DISCOVER_POSTS", ACTORS)).toBe(ACTORS.tiktokSearch)
    expect(apifyDiscoveryInput(source, 100)).toMatchObject({
      searchQueries: [BRAND, "yeni market", "şəbəkə", "yenimarket"],
      maxItems: 100,
      resultsPerPage: 25,
    })
  })

  it("комментарии идут отдельной способностью, а не подмешиваются в поиск", () => {
    const target = targets.find(item => item.input.platform === "instagram")!
    const source = sourceFromTarget("instagram", target)
    expect(apifyActorForSource(source, "READ_EXTERNAL_COMMENTS", ACTORS)).toBe(ACTORS.instagramComments)
  })
})
