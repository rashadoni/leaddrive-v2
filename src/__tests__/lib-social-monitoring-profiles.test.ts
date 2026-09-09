import { describe, expect, it, vi } from "vitest"

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }))

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: queryRaw } }))

import {
  buildMonitoringProfileCoverage,
  buildMonitoringProfileView,
  deriveProfileStatus,
  deriveScenarioSearchFromSubject,
  loadFindingSummaries,
  profileSubjectInclude,
  suggestProfileAliases,
  type ProfileSubjectRow,
} from "@/lib/social/monitoring-profiles"
import type { MonitoringScenario } from "@/lib/social/monitoring-scenarios"

function queryText(index: number): string {
  const query = queryRaw.mock.calls[index]?.[0] as readonly string[] | undefined
  return Array.isArray(query) ? query.join("") : ""
}

describe("monitoring profile finding SQL", () => {
  it("excludes legacy positive comments and automatic review envelopes from operator totals", async () => {
    queryRaw.mockReset()
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await loadFindingSummaries("org-1", ["subject-1"])

    expect(queryRaw).toHaveBeenCalledTimes(3)
    expect(queryText(0)).toContain("UPPER(sm.\"contentKind\"::text) IN ('COMMENT', 'REPLY')")
    expect(queryText(0)).toContain("LOWER(BTRIM(COALESCE(sm.\"sourceType\", ''))) IN ('comment', 'reply')")
    expect(queryText(0)).toContain("LOWER(BTRIM(COALESCE(sm.sentiment, ''))) IN ('negative', 'neutral')")
    expect(queryText(1)).toContain(
      "COALESCE(envelope.\"relevanceReason\", '') = ANY(",
    )
    expect(queryText(1)).toContain(
      "COALESCE(envelope.\"contentKind\"::text, '') = ANY(",
    )
    expect(queryText(2)).toContain("UPPER(sm.\"contentKind\"::text) IN ('COMMENT', 'REPLY')")
    expect(queryText(2)).toContain("LOWER(BTRIM(COALESCE(sm.sentiment, ''))) IN ('negative', 'neutral')")
  })
})

function scenario(overrides: Partial<MonitoringScenario> = {}): MonitoringScenario {
  return {
    id: "scn-1",
    subjectId: "subject-1",
    subjectName: "Araz Supermarket",
    name: "Araz Supermarket",
    description: null,
    status: "active",
    platforms: ["instagram", "facebook"],
    search: {
      topics: [],
      keywords: ["Araz Supermarket"],
      hashtags: ["arazsupermarket"],
      handles: [],
      urls: [],
      useHashtagFallback: true,
      includeOwnedComments: true,
      includeExternalComments: null,
    },
    ai: {
      sentiments: ["negative", "complaint"],
      minConfidence: 80,
      action: "draft_reply",
      directions: ["general_reputation"],
    },
    reply: {
      identityId: null,
      identityLabel: null,
      mode: "manual_approval",
      autoReplyEnabled: false,
      liveSendAllowed: false,
    },
    archive: { startAt: null, lastBackfilledAt: null, scannedCount: 0, matchedCount: 0, status: "pending" },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

function subject(overrides: Partial<ProfileSubjectRow> = {}): ProfileSubjectRow {
  return {
    id: "subject-1",
    name: "Araz Supermarket",
    type: "COMPANY",
    status: "active",
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    aliases: [],
    sources: [],
    ...overrides,
  }
}

describe("deriveProfileStatus", () => {
  it("reports an active subject with an active scenario as active", () => {
    expect(deriveProfileStatus("active", scenario())).toBe("active")
  })

  it("reports a subject without any scenario as needs_resume", () => {
    // Bahruz Şiraliyev: the scenario was deleted, the subject and its archive
    // remain. It must not read as a working monitor.
    expect(deriveProfileStatus("active", null)).toBe("needs_resume")
  })

  it("reports a draft scenario as needs_resume", () => {
    expect(deriveProfileStatus("active", scenario({ status: "draft" }))).toBe("needs_resume")
  })

  it("reports a paused scenario as paused", () => {
    expect(deriveProfileStatus("active", scenario({ status: "paused" }))).toBe("paused")
  })

  it("reports a paused subject as paused", () => {
    expect(deriveProfileStatus("paused", scenario())).toBe("paused")
  })

  it("reports an archived subject as archived regardless of scenario", () => {
    expect(deriveProfileStatus("archived", scenario())).toBe("archived")
  })
})

describe("buildMonitoringProfileView", () => {
  it("folds subject and scenario into one card without leaking internal terms", () => {
    const view = buildMonitoringProfileView(
      subject({ aliases: [{ kind: "HASHTAG", value: "arazsupermarket", normalizedValue: "arazsupermarket", isNegative: false }] }),
      scenario(),
    )
    expect(view.name).toBe("Araz Supermarket")
    expect(view.status).toBe("active")
    expect(view.platforms).toEqual(["instagram", "facebook"])
    expect(view.directions).toEqual(["general_reputation"])
    expect(view.aliases).toHaveLength(1)
    expect(view.liveSendAllowed).toBe(false)
  })

  it("keeps a scenario-less subject resumable with its aliases intact", () => {
    const view = buildMonitoringProfileView(
      subject({
        name: "Bahruz Şiraliyev",
        aliases: [{ kind: "NAME", value: "Bahruz Şiraliyev", normalizedValue: "bahruz şiraliyev", isNegative: false }],
      }),
      null,
    )
    expect(view.status).toBe("needs_resume")
    expect(view.scenarioId).toBeNull()
    expect(view.platforms).toEqual([])
    expect(view.aliases).toHaveLength(1)
  })

  it("uses the most recent of subject and scenario as last updated", () => {
    const view = buildMonitoringProfileView(
      subject({ updatedAt: new Date("2026-07-01T00:00:00.000Z") }),
      scenario({ updatedAt: "2026-07-09T00:00:00.000Z" }),
    )
    expect(view.lastUpdatedAt).toBe("2026-07-09T00:00:00.000Z")
  })

  it("exposes the latest active LOGO selected by the subject query", () => {
    const view = buildMonitoringProfileView(subject({
      visualReferences: [
        {
          imageUrl: "/uploads/social-logos/org-1/newest.webp",
          updatedAt: new Date("2026-07-09T00:00:00.000Z"),
        },
        {
          imageUrl: "/uploads/social-logos/org-1/older.webp",
          updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    }), scenario())

    expect(profileSubjectInclude.visualReferences).toMatchObject({
      where: {
        referenceType: "LOGO",
        status: "active",
      },
      orderBy: { updatedAt: "desc" },
      take: 1,
    })
    expect(view.logoUrl).toBe("/uploads/social-logos/org-1/newest.webp")
  })

  it("returns a null logoUrl when the monitoring has no active logo", () => {
    const view = buildMonitoringProfileView(subject(), scenario())

    expect(view.logoUrl).toBeNull()
  })

  it("reports the real source status instead of a nonexistent isActive column", () => {
    const currentScenario = scenario()
    const view = buildMonitoringProfileView(subject({
      sources: [{
        scenarioId: "scn-1",
        source: {
          id: "source-1",
          platform: "instagram",
          sourceType: "keyword",
          collectionMode: "search_index",
          handle: null,
          query: "Araz Supermarket",
          url: null,
          status: "needs_setup",
        },
      }],
    }), currentScenario)

    expect(view.sources).toEqual([expect.objectContaining({
      id: "source-1",
      status: "needs_setup",
      isActive: true,
    })])
  })

  it("exposes a conservative paid-run cap and shared-source warning on the card", () => {
    const currentScenario = scenario({
      search: {
        ...scenario().search,
        includeExternalComments: true,
      },
    })
    const view = buildMonitoringProfileView(subject({
      sources: [{
        scenarioId: "scn-1",
        source: {
          id: "source-paid",
          platform: "instagram",
          sourceType: "keyword",
          collectionMode: "search_index",
          handle: null,
          query: "Araz Supermarket",
          url: null,
          status: "active",
          settings: {
            scenarioLinks: [{ scenarioId: "scn-1" }, { scenarioId: "scn-2" }],
          },
          routePlans: [{
            scenarioId: "scn-1",
            capability: "DISCOVER_POSTS",
            status: "ACTIVE",
            primaryAdapter: "APIFY_ASYNC",
            fallbackAdapters: [],
            budget: { usdLimitsConfigured: true, maxTotalChargeUsd: 1.5 },
          }, {
            scenarioId: "scn-1",
            capability: "READ_EXTERNAL_COMMENTS",
            status: "ACTIVE",
            primaryAdapter: "APIFY_ASYNC",
            fallbackAdapters: [],
            dependsOnCapability: "DISCOVER_POSTS",
          }],
          _count: { subjectSources: 2 },
        },
      }],
    }), currentScenario)

    expect(view.sources[0]).toMatchObject({
      paid: true,
      commentsOnlyEligible: true,
      maxTotalChargeUsd: 1.5,
      sharedAcrossMonitorings: true,
    })
  })

  it("does not expose sources explicitly linked only to another scenario", () => {
    const view = buildMonitoringProfileView(subject({
      sources: [{
        scenarioId: "scn-other",
        source: {
          id: "source-other",
          platform: "instagram",
          sourceType: "profile",
          handle: "other",
          query: null,
          url: null,
          status: "active",
          settings: { scenarioLinks: [{ scenarioId: "scn-other" }] },
          routePlans: [{
            scenarioId: "scn-other",
            capability: "DISCOVER_POSTS",
            status: "ACTIVE",
            primaryAdapter: "APIFY_ASYNC",
            fallbackAdapters: [],
          }],
        },
      }],
    }), scenario())

    expect(view.sources).toEqual([])
  })

  // WEB покрывается только лентой Google Alerts (решение владельца
  // 2026-08-01): устаревшая keyword-строка в карточку клиента не попадает и
  // в покрытии не числится, иначе клиент видел бы живой веб-источник там,
  // где сбора больше нет.
  it("показывает в карточке только ленту Google Alerts, без устаревшего прямого поиска", () => {
    const base = scenario()
    const rssScenario = scenario({
      platforms: ["web"],
      web: {
        sourceMode: "google_alerts_rss",
        googleAlertsRssConfigured: true,
      },
      search: {
        ...base.search,
        topics: [],
        keywords: ["Araz Supermarket"],
        hashtags: [],
        handles: [],
        urls: [],
        includeExternalComments: false,
      },
    })
    const view = buildMonitoringProfileView(subject({
      sources: [
        {
          scenarioId: "scn-1",
          relationType: "MONITORS",
          source: {
            id: "rss-source",
            platform: "web",
            sourceType: "notification_inbox",
            collectionMode: "notification_inbox",
            handle: null,
            query: "google-alerts-rss:scn-1",
            url: null,
            status: "active",
            settings: {
              managedBy: "google_alerts_rss",
              scenarioId: "scn-1",
              scenarioName: "Araz Supermarket",
              scenarioLinks: [{ scenarioId: "scn-1" }],
            },
            routePlans: [{
              scenarioId: "scn-1",
              capability: "DISCOVER_POSTS",
              status: "ACTIVE",
              primaryAdapter: "GOOGLE_ALERTS_RSS",
              fallbackAdapters: [],
            }],
          },
        },
        {
          scenarioId: "scn-1",
          relationType: "MONITORS",
          source: {
            id: "direct-web-source",
            platform: "web",
            sourceType: "keyword",
            collectionMode: "search_index",
            handle: null,
            query: "Araz Supermarket",
            url: null,
            status: "active",
            settings: {
              managedBy: "monitoring_scenario",
              scenarioId: "scn-1",
              canonicalBrandQuery: true,
              scenarioLinks: [{ scenarioId: "scn-1" }],
            },
            routePlans: [{
              scenarioId: "scn-1",
              capability: "DISCOVER_POSTS",
              status: "ACTIVE",
              primaryAdapter: "AZERBAIJAN_NEWS_DIRECT",
              fallbackAdapters: [],
            }],
          },
        },
      ],
    }), rssScenario)

    expect(view.sources).toEqual([
      expect.objectContaining({
        id: "rss-source",
        platform: "web",
        sourceType: "notification_inbox",
        label: "Google Alerts RSS · Araz Supermarket",
        isActive: true,
        paid: false,
      }),
    ])
    expect(view.coverage).toEqual([
      expect.objectContaining({
        platform: "web",
        sourceCount: 1,
        activeSourceCount: 1,
        collectionState: "configured",
      }),
    ])
  })

  // Один и тот же клиент больше не заводится дважды: карточка мониторинга
  // должна показывать, к какой компании CRM он привязан.
  it("отдаёт привязанного клиента CRM во вью-модели профиля", () => {
    const withCompany = buildMonitoringProfileView(subject({
      company: { id: "company-1", name: "Bravo Supermarket MMC" },
    }), scenario())
    expect(withCompany.company).toEqual({ id: "company-1", name: "Bravo Supermarket MMC" })

    const withoutCompany = buildMonitoringProfileView(subject({}), scenario())
    expect(withoutCompany.company).toBeNull()
  })

  it("reports selected-source coverage without claiming the whole platform", () => {
    const [coverage] = buildMonitoringProfileCoverage(["facebook"], [{
      id: "source-facebook",
      platform: "facebook",
      sourceType: "page",
      handle: "arazsupermarket",
      query: null,
      url: "https://www.facebook.com/arazsupermarket",
      status: "active",
      lastSuccessfulAt: new Date("2026-07-15T10:05:00.000Z"),
      lastError: null,
      routePlans: [
        { capability: "DISCOVER_POSTS", status: "ACTIVE" },
        { capability: "READ_EXTERNAL_COMMENTS", status: "ACTIVE" },
      ],
      collectorRuns: [{
        status: "success",
        startedAt: new Date("2026-07-15T10:00:00.000Z"),
        foundCount: 24,
        newCount: 18,
        duplicateCount: 3,
        ignoredCount: 3,
        rawStats: { coverageClass: "COMPLETE_FOR_INPUT" },
      }],
    }], true)

    expect(coverage).toMatchObject({
      platform: "facebook",
      scope: "selected_sources",
      collectionState: "configured",
      commentState: "configured",
      completeness: "confirmed_for_input",
      latestFoundCount: 24,
      latestAcceptedCount: 21,
      latestRejectedCount: 3,
      latestDuplicateCount: 3,
      latestRunStatuses: ["success"],
      latestCheckedAt: "2026-07-15T10:00:00.000Z",
      lastSuccessfulAt: "2026-07-15T10:05:00.000Z",
      lastError: null,
      fullPlatformCoverage: false,
    })
  })

  it("labels sampled keyword discovery as partial broad search", () => {
    const [coverage] = buildMonitoringProfileCoverage(["tiktok"], [{
      id: "source-tiktok",
      platform: "tiktok",
      sourceType: "keyword",
      handle: null,
      query: "araz supermarket",
      url: null,
      status: "limited",
      lastSuccessfulAt: new Date("2026-07-15T11:05:00.000Z"),
      lastError: "paid_route_budget_unconfigured",
      routePlans: [{ capability: "DISCOVER_POSTS", status: "DEGRADED" }],
      collectorRuns: [{
        status: "partial",
        startedAt: new Date("2026-07-15T11:00:00.000Z"),
        foundCount: 10,
        newCount: 4,
        duplicateCount: 1,
        ignoredCount: 5,
        rawStats: { routeResults: [{ capability: "DISCOVER_POSTS", coverageClass: "SAMPLED" }] },
      }],
    }], false)

    expect(coverage).toMatchObject({
      scope: "broad_search",
      collectionState: "limited",
      commentState: "off",
      completeness: "partial",
      latestFoundCount: 10,
      latestAcceptedCount: 5,
      latestRejectedCount: 5,
      latestDuplicateCount: 1,
      latestRunStatuses: ["partial"],
      latestCheckedAt: "2026-07-15T11:00:00.000Z",
      lastSuccessfulAt: "2026-07-15T11:05:00.000Z",
      lastError: "paid_route_budget_unconfigured",
    })
  })

  it("treats a needs-setup source as runnable but limited when its Apify discovery route is ready", () => {
    const baseSource = {
      id: "source-tiktok",
      platform: "tiktok",
      sourceType: "keyword",
      handle: null,
      query: "Araz Supermarket",
      url: null,
      status: "needs_setup",
    }
    const [apifyCoverage] = buildMonitoringProfileCoverage(["tiktok"], [{
      ...baseSource,
      routePlans: [{
        capability: "DISCOVER_POSTS",
        status: "ACTIVE",
        primaryAdapter: "APIFY_ASYNC",
      }],
    }], false)
    const [nonApifyCoverage] = buildMonitoringProfileCoverage(["tiktok"], [{
      ...baseSource,
      routePlans: [{
        capability: "DISCOVER_POSTS",
        status: "ACTIVE",
        primaryAdapter: "SEARCH_INDEX",
      }],
    }], false)

    expect(apifyCoverage).toMatchObject({
      scope: "broad_search",
      collectionState: "limited",
      activeSourceCount: 1,
    })
    expect(nonApifyCoverage).toMatchObject({
      collectionState: "needs_setup",
      activeSourceCount: 0,
    })
  })

  it("ignores disabled automatic keywords when a selected page is active", () => {
    const [coverage] = buildMonitoringProfileCoverage(["instagram"], [
      {
        id: "selected-profile",
        platform: "instagram",
        sourceType: "profile",
        handle: "arazsupermarket",
        query: null,
        url: "https://www.instagram.com/arazsupermarket",
        status: "active",
      },
      {
        id: "stale-keyword",
        platform: "instagram",
        sourceType: "keyword",
        handle: null,
        query: "Araz Supermarket",
        url: null,
        status: "disabled",
      },
    ], false)

    expect(coverage).toMatchObject({ scope: "selected_sources", sourceCount: 1 })
  })
})

describe("deriveScenarioSearchFromSubject", () => {
  it("derives the collection query from the subject so the name is typed once", () => {
    const search = deriveScenarioSearchFromSubject({
      name: "Araz Supermarket",
      aliases: [
        { kind: "TRANSLITERATION", value: "Araz Market", normalizedValue: "araz market", isNegative: false },
        { kind: "HASHTAG", value: "arazsupermarket", normalizedValue: "arazsupermarket", isNegative: false },
        { kind: "HANDLE", value: "araz_supermarket", normalizedValue: "araz_supermarket", isNegative: false },
        { kind: "DOMAIN", value: "araz.az", normalizedValue: "araz.az", isNegative: false },
      ],
    })
    expect(search.keywords).toEqual(["Araz Supermarket", "Araz Market", "araz_supermarket"])
    expect(search.hashtags).toEqual(["arazsupermarket"])
    expect(search.handles).toEqual([])
  })

  it("keeps a domain out of the collection query so it cannot suppress keyword sources", () => {
    // Domains remain match-only vocabulary rather than collection targets.
    const search = deriveScenarioSearchFromSubject({
      name: "Araz Supermarket",
      aliases: [{ kind: "DOMAIN", value: "araz.az", normalizedValue: "araz.az", isNegative: false }],
    })
    expect(search.urls).toEqual([])
    expect(search.keywords).toEqual(["Araz Supermarket"])
  })

  it("never sends negative aliases to the collection query", () => {
    const search = deriveScenarioSearchFromSubject({
      name: "Araz",
      aliases: [{ kind: "NAME", value: "Araz river", normalizedValue: "araz river", isNegative: true }],
    })
    expect(search.keywords).toEqual(["Araz"])
  })

  it("never sends required context to the collection query", () => {
    const search = deriveScenarioSearchFromSubject({
      name: "Araz",
      aliases: [{ kind: "CONTEXT", value: "supermarket", normalizedValue: "supermarket", isNegative: false }],
    })
    expect(search.keywords).toEqual(["Araz"])
  })

  it("deduplicates the name against an identical alias", () => {
    const search = deriveScenarioSearchFromSubject({
      name: "Araz Supermarket",
      aliases: [{ kind: "NAME", value: "araz supermarket", normalizedValue: "araz supermarket", isNegative: false }],
    })
    expect(search.keywords).toEqual(["Araz Supermarket"])
  })

  it("appends optional advanced keywords without requiring them", () => {
    const search = deriveScenarioSearchFromSubject({ name: "Araz", aliases: [] }, ["kassa"])
    expect(search.keywords).toEqual(["Araz", "kassa"])
  })

  it("keeps direct page/profile targets out of scenario search", () => {
    const search = deriveScenarioSearchFromSubject({ name: "Araz Supermarket", aliases: [] })
    expect(search.urls).toEqual([])
    expect(search.handles).toEqual([])
  })
})

describe("suggestProfileAliases", () => {
  it("proposes local spelling variants without any provider call", () => {
    const suggestions = suggestProfileAliases("Bahruz Şiraliyev")
    const values = suggestions.map(item => item.value)
    expect(values).toContain("bahruz siraliyev")
    expect(suggestions.some(item => item.kind === "HASHTAG")).toBe(true)
  })

  it("proposes a hashtag from a multi-word name", () => {
    const suggestions = suggestProfileAliases("Araz Supermarket")
    expect(suggestions).toContainEqual({ kind: "HASHTAG", value: "arazsupermarket" })
  })

  it("never guesses an unverified handle", () => {
    const suggestions = suggestProfileAliases("Araz Supermarket")
    expect(suggestions.some(item => item.kind === "HANDLE")).toBe(false)
  })

  it("returns nothing for an empty name", () => {
    expect(suggestProfileAliases("   ")).toEqual([])
  })
})
