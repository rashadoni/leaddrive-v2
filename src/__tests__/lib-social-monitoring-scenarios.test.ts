import { beforeEach, describe, expect, it, vi } from "vitest"

const { aliasCreateMany } = vi.hoisted(() => ({ aliasCreateMany: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSubjectAlias: { createMany: aliasCreateMany },
  },
}))

import {
  applySelectiveYouTubeSourcePolicy,
  applySelectiveTikTokSourcePolicy,
  findMonitoringScenarioMatches,
  preserveManagedScenarioRouteProviderCursors,
  scenarioSourceTargets,
  suggestScenarioSearch,
  syncScenarioSubjectAliases,
  type MonitoringScenario,
} from "@/lib/social/monitoring-scenarios"

function scenario(overrides: Partial<MonitoringScenario> = {}): MonitoringScenario {
  const base: MonitoringScenario = {
    id: "scn-1",
    subjectId: "subject-1",
    subjectName: "Nokaut",
    name: "Nokaut monitor",
    description: null,
    status: "active",
    platforms: ["instagram"],
    search: {
      topics: ["Nokaut"],
      keywords: ["kishiklubu"],
      hashtags: ["patrulaz"],
      handles: ["@nokaut.az"],
      urls: ["https://www.instagram.com/patrulaz/"],
      useHashtagFallback: true,
      includeOwnedComments: true,
      includeExternalComments: true,
    },
    ai: {
      sentiments: ["negative", "lead"],
      minConfidence: 80,
      action: "create_lead",
      directions: ["general_reputation"],
    },
    reply: {
      identityId: "identity-1",
      identityLabel: "Nokaut.az",
      mode: "manual_approval",
      autoReplyEnabled: false,
      liveSendAllowed: false,
    },
    archive: {
      startAt: null,
      lastBackfilledAt: null,
      scannedCount: 0,
      matchedCount: 0,
      status: "pending",
    },
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
  }

  return {
    ...base,
    ...overrides,
    search: { ...base.search, ...overrides.search },
    ai: { ...base.ai, ...overrides.ai },
    reply: { ...base.reply, ...overrides.reply },
  }
}

describe("monitoring scenario search strategy", () => {
  // Решение владельца 2026-08-01: веб покрывается только лентами Google Alerts.
  // Прежний канонический источник обходил фиксированный список азербайджанских
  // изданий с нашей инфраструктуры — это ограничивало по своей природе
  // глобальный поиск и нагружало площадки.
  it("не создаёт поисковый WEB-источник: покрытие даёт только лента Google Alerts", () => {
    const base = scenario()
    const targets = scenarioSourceTargets(scenario({
      platforms: ["web", "youtube"],
      web: {
        sourceMode: "google_alerts_rss",
        googleAlertsRssConfigured: true,
      },
      search: {
        ...base.search,
        topics: ["Nokaut"],
        keywords: ["nokaut az"],
        hashtags: [],
        handles: [],
        urls: [],
      },
    }))

    expect(targets.filter(target => target.input.platform === "web")).toEqual([])
    // Остальные платформы сценария не задеты.
    expect(targets.some(target => target.input.platform === "youtube")).toBe(true)
  })

  it("ignores legacy URL and handle targets and provisions only global term sources", () => {
    const base = scenario()
    const targets = scenarioSourceTargets(scenario({
      platforms: ["instagram", "facebook"],
      search: {
        ...base.search,
        topics: [],
        keywords: ["Araz Supermarket"],
        hashtags: [],
        handles: ["@arazsupermarket"],
        urls: ["https://www.instagram.com/arazsupermarket/"],
      },
    }))

    expect(targets).toEqual([
      expect.objectContaining({
        targetType: "keyword",
        targetValue: "Araz Supermarket",
        input: expect.objectContaining({
          platform: "instagram",
          sourceType: "keyword",
          query: "Araz Supermarket",
        }),
      }),
      expect.objectContaining({
        targetType: "keyword",
        targetValue: "Araz Supermarket",
        input: expect.objectContaining({
          platform: "facebook",
          sourceType: "keyword",
          query: "Araz Supermarket",
        }),
      }),
    ])
    expect(targets.every(target => !target.input.url && !target.input.handle)).toBe(true)
  })

  it("creates exactly one canonical provider query per platform", () => {
    const base = scenario()
    const targets = scenarioSourceTargets(scenario({
      platforms: ["facebook", "instagram"],
      search: {
        ...base.search,
        topics: ["Araz Supermarket", "Araz Market"],
        keywords: ["araz endirim", "araz kampaniya"],
        hashtags: ["#arazsupermarket"],
        handles: [],
        urls: [],
      },
    }))

    expect(targets).toHaveLength(2)
    expect(targets.map(target => target.input)).toEqual([
      expect.objectContaining({
        platform: "facebook",
        sourceType: "keyword",
        query: "Araz Supermarket",
        keywords: [],
        settings: expect.objectContaining({ canonicalBrandQuery: true }),
      }),
      expect.objectContaining({
        platform: "instagram",
        sourceType: "keyword",
        query: "Araz Supermarket",
        keywords: [],
        settings: expect.objectContaining({ canonicalBrandQuery: true }),
      }),
    ])

    const bounded = scenarioSourceTargets(scenario({
      platforms: ["facebook"],
      search: {
        ...base.search,
        topics: Array.from({ length: 21 }, (_, index) => `term-${index + 1}`),
        keywords: [],
        hashtags: [],
        handles: [],
        urls: [],
      },
    }))
    expect(bounded).toHaveLength(1)
    expect(bounded[0].targetValue).toBe("term-1")
    expect(bounded[0].input.keywords).toEqual([])
  })

  it("preserves route provider cursors when the same managed target is re-saved", () => {
    const original = scenario({
      platforms: ["youtube"],
      search: {
        ...scenario().search,
        topics: ["Araz Supermarket"],
        keywords: [],
        hashtags: [],
        handles: [],
        urls: [],
      },
      archive: {
        ...scenario().archive,
        startAt: "2026-04-01T09:30:00.000Z",
      },
    })
    const target = scenarioSourceTargets(original)[0]
    const routeProviderCursors = {
      "route-1:YOUTUBE_DATA_API": {
        fetchAfter: "2026-07-28T10:00:00.000Z",
      },
    }

    const merged = preserveManagedScenarioRouteProviderCursors(
      { searchIndex: { includeComments: false } },
      {
        managedBy: "monitoring_scenario",
        scenarioId: original.id,
        scenarioLinks: [{
          scenarioId: original.id,
          subjectId: original.subjectId,
          targetType: target.targetType,
          targetValue: target.targetValue,
          archiveStartAt: original.archive.startAt,
        }],
        searchIndex: {
          includeComments: true,
          fetchAfter: "2026-07-01T00:00:00.000Z",
          routeProviderCursors,
        },
      },
      original,
      target,
    )

    expect(merged).toEqual({
      searchIndex: {
        includeComments: false,
        routeProviderCursors,
      },
    })
  })

  it("does not carry provider cursors into a changed archive, subject, or target scope", () => {
    const original = scenario({
      platforms: ["youtube"],
      search: {
        ...scenario().search,
        topics: ["Araz Supermarket"],
        keywords: [],
        hashtags: [],
        handles: [],
        urls: [],
      },
      archive: {
        ...scenario().archive,
        startAt: "2026-04-01T09:30:00.000Z",
      },
    })
    const target = scenarioSourceTargets(original)[0]
    const existingSettings = {
      managedBy: "monitoring_scenario",
      scenarioId: original.id,
      scenarioLinks: [{
        scenarioId: original.id,
        subjectId: original.subjectId,
        targetType: target.targetType,
        targetValue: target.targetValue,
        archiveStartAt: original.archive.startAt,
      }],
      searchIndex: {
        routeProviderCursors: {
          "route-1:YOUTUBE_DATA_API": {
            fetchAfter: "2026-07-28T10:00:00.000Z",
          },
        },
      },
    }
    const nextSettings = { searchIndex: { includeComments: false } }

    expect(preserveManagedScenarioRouteProviderCursors(
      nextSettings,
      existingSettings,
      {
        ...original,
        archive: {
          ...original.archive,
          startAt: "2026-03-01T00:00:00.000Z",
        },
      },
      target,
    )).toEqual(nextSettings)
    expect(preserveManagedScenarioRouteProviderCursors(
      nextSettings,
      existingSettings,
      { ...original, subjectId: "subject-2" },
      target,
    )).toEqual(nextSettings)
    expect(preserveManagedScenarioRouteProviderCursors(
      nextSettings,
      existingSettings,
      original,
      { ...target, targetValue: "Araz Market" },
    )).toEqual(nextSettings)
  })

  it("stamps external TikTok sources with daily candidate-only policy but no longer bars the schedule", () => {
    const source = applySelectiveTikTokSourcePolicy({ platform: "tiktok", ownership: "external", cadenceMinutes: 60, settings: {} })
    expect(source.cadenceMinutes).toBe(1440)
    // liveRoutingAllowed:false здесь означало «TikTok не собирается по
    // расписанию никогда»: обход молча пропускал такие источники, и на проде
    // шесть брендов четыре дня не собирались вовсе (#665).
    expect(source.settings).toEqual({
      selectiveDiscovery: {
        contractVersion: "tiktok-selective-query-pack-v1",
        candidateOnly: true,
        arbitraryVideoScanAllowed: false,
      },
    })
    expect(applySelectiveTikTokSourcePolicy({ platform: "tiktok", ownership: "owned", cadenceMinutes: 60, settings: {} }).cadenceMinutes).toBe(60)
  })

  // Пересохранение сценария не должно начинать тратить деньги там, где
  // оператор сбор осознанно выключил.
  it("keeps an operator's explicit automatic-collection ban on re-save", () => {
    const source = applySelectiveTikTokSourcePolicy({
      platform: "tiktok",
      ownership: "external",
      cadenceMinutes: 60,
      settings: { selectiveDiscovery: { liveRoutingAllowed: false } },
    })
    expect(source.settings).toMatchObject({
      selectiveDiscovery: expect.objectContaining({ liveRoutingAllowed: false }),
    })
  })

  it("stamps external YouTube sources with daily matched-only policy", () => {
    const source = applySelectiveYouTubeSourcePolicy({
      platform: "youtube",
      ownership: "external",
      collectionMode: "search_index",
      cadenceMinutes: 60,
      status: "needs_setup",
      settings: {},
    })
    expect(source.collectionMode).toBe("official_api")
    expect(source.cadenceMinutes).toBe(1440)
    expect(source.status).toBe("limited")
    expect(source.settings).toEqual({ selectiveDiscovery: {
      contractVersion: "youtube-selective-query-pack-v1",
      candidateOnly: true,
      commentsRequireMatched: true,
      arbitraryVideoScanAllowed: false,
      liveReplies: false,
    } })
    expect(applySelectiveYouTubeSourcePolicy({ platform: "youtube", ownership: "owned", cadenceMinutes: 60, settings: {} }).cadenceMinutes).toBe(60)
  })

  it("generates hashtag fallback from topics and keywords", () => {
    const search = suggestScenarioSearch({
      topics: ["Nokaut", "nokaut.az"],
      keywords: ["boxing club", "Nokaut"],
      hashtags: ["#fitness"],
      handles: ["@nokaut.az"],
      urls: ["https://www.instagram.com/explore/tags/nokaut/#top"],
    })

    expect(search.keywords).toEqual(["boxing club", "Nokaut"])
    expect(search.hashtags).toEqual(["fitness", "nokaut", "nokautaz", "boxingclub"])
    expect(search.handles).toEqual([])
    expect(search.urls).toEqual([])
    expect(search.useHashtagFallback).toBe(true)
    expect(search.includeOwnedComments).toBe(true)
    expect(search.includeExternalComments).toBeNull() // explicit choice comes from the UI only
  })

  it("gates owned comments by includeOwnedComments and external comments by includeExternalComments", () => {
    const ownedComment = {
      organizationId: "org-1",
      platform: "instagram",
      sourceType: "comment",
      sourceProvider: "native",
      text: "Nokaut haqqında şərh",
      matchedTerm: "Nokaut",
    }
    const externalComment = { ...ownedComment, sourceProvider: "search_index" }
    const post = { ...ownedComment, sourceType: "post" }

    // both on (default): everything matches
    expect(findMonitoringScenarioMatches([scenario()], ownedComment)).toHaveLength(1)
    expect(findMonitoringScenarioMatches([scenario()], externalComment)).toHaveLength(1)

    // owned off: owned comment skipped, external comment and posts unaffected
    const ownedOff = scenario({ search: { includeOwnedComments: false } as MonitoringScenario["search"] })
    expect(findMonitoringScenarioMatches([ownedOff], ownedComment)).toEqual([])
    expect(findMonitoringScenarioMatches([ownedOff], externalComment)).toHaveLength(1)
    expect(findMonitoringScenarioMatches([ownedOff], post)).toHaveLength(1)

    // external off: external comment skipped, owned comment and posts unaffected
    const externalOff = scenario({ search: { includeExternalComments: false } as MonitoringScenario["search"] })
    expect(findMonitoringScenarioMatches([externalOff], externalComment)).toEqual([])
    expect(findMonitoringScenarioMatches([externalOff], ownedComment)).toHaveLength(1)
    expect(findMonitoringScenarioMatches([externalOff], post)).toHaveLength(1)

    // legacy null (no explicit choice) still matches external comments — whether they
    // exist at all is governed by the org-global collection toggle
    const legacyNull = scenario({ search: { includeExternalComments: null } as MonitoringScenario["search"] })
    expect(findMonitoringScenarioMatches([legacyNull], externalComment)).toHaveLength(1)
  })

  it("classifies connected-account webhook/bridge comments as OWNED, not external", () => {
    // Own TikTok comments arrive via the tiktok-organic webhook / Chatwoot bridge —
    // turning off paid external scraping must not silence them.
    const base = {
      organizationId: "org-1",
      platform: "instagram",
      sourceType: "comment",
      text: "Nokaut haqqında şərh",
      matchedTerm: "Nokaut",
    }
    const externalOff = scenario({ search: { includeExternalComments: false } as MonitoringScenario["search"] })
    for (const provider of ["chatwoot", "tiktok_organic", "webhook", "native", undefined]) {
      expect(findMonitoringScenarioMatches([externalOff], { ...base, sourceProvider: provider })).toHaveLength(1)
    }
    const ownedOff = scenario({ search: { includeOwnedComments: false } as MonitoringScenario["search"] })
    for (const provider of ["chatwoot", "tiktok_organic", "webhook", "native", undefined]) {
      expect(findMonitoringScenarioMatches([ownedOff], { ...base, sourceProvider: provider })).toEqual([])
    }
  })

  it("matches active scenarios only by global terms and ignores legacy direct targets", () => {
    const matches = findMonitoringScenarioMatches([scenario()], {
      organizationId: "org-1",
      platform: "instagram",
      sourceProvider: "search_index",
      text: "Nokaut haqqında yeni xəbər #patrulaz",
      matchedTerm: null,
      authorHandle: "@nokaut.az",
      url: "https://www.instagram.com/patrulaz/p/ABC123/",
    })

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      scenarioId: "scn-1",
      scenarioName: "Nokaut monitor",
      action: "create_lead",
      sentiments: ["negative", "lead"],
      minConfidence: 80,
      matchedConfidence: 90,
      reply: expect.objectContaining({
        identityId: "identity-1",
        liveSendAllowed: false,
      }),
    })
    expect(matches[0].matchedTargets).toEqual(expect.arrayContaining([
      { type: "topic", value: "Nokaut" },
      { type: "hashtag", value: "patrulaz" },
    ]))
    expect(matches[0].matchedTargets).toHaveLength(2)
  })

  it("ignores paused scenarios and platform mismatches", () => {
    const input = {
      organizationId: "org-1",
      platform: "instagram",
      text: "Nokaut haqqında yeni xəbər",
      matchedTerm: "Nokaut",
    }

    expect(findMonitoringScenarioMatches([scenario({ status: "paused" })], input)).toEqual([])
    expect(findMonitoringScenarioMatches([scenario({ platforms: ["facebook"] })], input)).toEqual([])
  })

  it("allows web scenarios to match search-index results from platform collectors", () => {
    const matches = findMonitoringScenarioMatches([
      scenario({
        platforms: ["web"],
        search: {
          topics: [],
          keywords: ["Nokaut"],
          hashtags: [],
          handles: [],
          urls: [],
          useHashtagFallback: true,
          includeOwnedComments: true,
          includeExternalComments: true,
        },
      }),
    ], {
      organizationId: "org-1",
      platform: "instagram",
      sourceProvider: "search_index",
      text: "Nokaut yeni məkanda açıldı",
    })

    expect(matches).toHaveLength(1)
    expect(matches[0].matchedTargets).toEqual([{ type: "keyword", value: "Nokaut" }])
  })
})

describe("scenario → subject alias sync (owner: one keyword list)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aliasCreateMany.mockResolvedValue({ count: 0 })
  })

  it("mirrors topics/keywords/hashtags into subject aliases and ignores legacy handles", async () => {
    await syncScenarioSubjectAliases("org-1", scenario({
      search: {
        topics: ["hava", "proqnoz"],
        keywords: ["hava proqnozu"],
        hashtags: ["#Arzum"],
        handles: ["@patrul.az"],
        urls: [],
        useHashtagFallback: true,
        includeOwnedComments: true,
        includeExternalComments: true,
      },
    }))

    expect(aliasCreateMany).toHaveBeenCalledTimes(1)
    const call = aliasCreateMany.mock.calls[0][0]
    expect(call.skipDuplicates).toBe(true)
    expect(call.data).toEqual([
      expect.objectContaining({ subjectId: "subject-1", kind: "NAME", normalizedValue: "hava", isAmbiguous: true }),
      // #636: a bare generic word is weak evidence regardless of length —
      // "proqnoz" alone matched anywhere must not auto-accept.
      expect.objectContaining({ kind: "NAME", normalizedValue: "proqnoz", isAmbiguous: true }),
      expect.objectContaining({ kind: "NAME", normalizedValue: "hava proqnozu", isAmbiguous: false }),
      // The matcher treats "#" as optional, so a short brand hashtag matches
      // the bare word in plain text and must carry the same gate.
      expect.objectContaining({ kind: "HASHTAG", value: "Arzum", normalizedValue: "arzum", isAmbiguous: true }),
    ])
    expect(call.data.every((row: { isNegative: boolean }) => row.isNegative === false)).toBe(true)
  })

  it("dedupes repeated terms across topics and keywords by normalized value", async () => {
    await syncScenarioSubjectAliases("org-1", scenario({
      search: {
        topics: ["Arzum", " ARZUM "],
        keywords: ["arzum"],
        hashtags: ["#arzum"],
        handles: [],
        urls: [],
        useHashtagFallback: true,
        includeOwnedComments: true,
        includeExternalComments: true,
      },
    }))

    const call = aliasCreateMany.mock.calls[0][0]
    // One NAME row and one HASHTAG row — same value in different kinds is allowed.
    expect(call.data.map((row: { kind: string; normalizedValue: string }) => `${row.kind}:${row.normalizedValue}`))
      .toEqual(["NAME:arzum", "HASHTAG:arzum"])
  })

  it("does nothing for a scenario without a linked subject", async () => {
    await expect(syncScenarioSubjectAliases("org-1", scenario({ subjectId: null }))).resolves.toBe(0)
    expect(aliasCreateMany).not.toHaveBeenCalled()
  })

  it("never issues deletes — operator aliases and negatives survive every sync", async () => {
    await syncScenarioSubjectAliases("org-1", scenario())
    expect(aliasCreateMany).toHaveBeenCalledTimes(1)
    // The mocked prisma exposes ONLY createMany; any delete/update call would throw.
  })
})
