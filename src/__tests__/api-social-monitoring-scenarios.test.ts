import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler<C = unknown> = (req: NextRequest, auth: AuthContext, ctx: C) => Promise<Response>
type CreateMonitoringSourceArgs = { data: Record<string, unknown> }

const mockState = vi.hoisted(() => ({
  registrations: [] as Array<{ module: string | undefined; action: string | undefined }>,
  fenceBlocked: false,
  settings: null as unknown,
  sources: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (module: string | undefined, action: string | undefined, handler: RouteHandler) => {
    mockState.registrations.push({ module, action })
    return (req: NextRequest, ctx?: unknown) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }, ctx)
  },
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (module: string | undefined, action: string | undefined, handler: RouteHandler) => {
    mockState.registrations.push({ module, action })
    return (req: NextRequest, ctx?: unknown) => {
      if (mockState.fenceBlocked) {
        return NextResponse.json(
          {
            error: "Social Monitoring is paused for a clean-slate reset",
            code: "social_monitoring_collection_blocked",
          },
          { status: 409 },
        )
      }
      return handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }, ctx)
    }
  },
}))

vi.mock("@/lib/social/source-route-plan", () => ({
  compileOrganizationSourceRoutePlans: vi.fn(async () => []),
}))

vi.mock("@/lib/prisma", () => {
  const client = {
    channelConfig: {
      findFirst: vi.fn(async () => (mockState.settings ? { id: "cfg-1", settings: mockState.settings } : null)),
      create: vi.fn(async (args: { data: { settings: unknown } }) => {
        mockState.settings = args.data.settings
        return { id: "cfg-1", settings: mockState.settings }
      }),
      update: vi.fn(async (args: { data: { settings: unknown } }) => {
        mockState.settings = args.data.settings
        return { id: "cfg-1", settings: mockState.settings }
      }),
    },
    monitoringSource: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => (
        mockState.sources.find((source) => (
          source.organizationId === args.where.organizationId &&
          source.platform === args.where.platform &&
          source.sourceType === args.where.sourceType &&
          source.collectionMode === args.where.collectionMode &&
          (args.where.url === undefined || source.url === args.where.url) &&
          (args.where.query === undefined || source.query === args.where.query) &&
          (args.where.handle === undefined || source.handle === args.where.handle)
        )) ?? null
      )),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => (
        mockState.sources.filter((source) => source.organizationId === args.where.organizationId)
      )),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: `src-${mockState.sources.length + 1}`,
          lastCheckedAt: null,
          lastSuccessfulAt: null,
          lastError: null,
          collectorRuns: [],
          ...args.data,
        }
        mockState.sources.push(row)
        return row
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = mockState.sources.findIndex((source) => source.id === args.where.id)
        if (index >= 0) {
          mockState.sources[index] = { ...mockState.sources[index], ...args.data }
          return mockState.sources[index]
        }
        return { id: args.where.id, ...args.data }
      }),
      updateMany: vi.fn(async (args: {
        where: { organizationId?: string; id?: { in?: string[] } }
        data: Record<string, unknown>
      }) => {
        const ids = new Set(args.where.id?.in ?? [])
        let count = 0
        mockState.sources = mockState.sources.map((source) => {
          if (
            (args.where.organizationId === undefined || source.organizationId === args.where.organizationId)
            && (ids.size === 0 || ids.has(String(source.id)))
          ) {
            count += 1
            return { ...source, ...args.data }
          }
          return source
        })
        return { count }
      }),
    },
    monitoringSubjectSource: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    sourceRoutePlan: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => mockState.sources
      .filter(source => (
        source.platform === "facebook"
        && source.sourceType === "keyword"
        && ["active", "limited", "needs_setup"].includes(String(source.status))
        && Array.isArray(source.keywords)
        && source.keywords.length > 1
        && (source.settings as { managedBy?: string } | undefined)?.managedBy === "monitoring_scenario"
        && (
          !source.runClaimToken
          || !source.runClaimExpiresAt
          || new Date(String(source.runClaimExpiresAt)).getTime() <= Date.now()
        )
      ))
      .map(source => ({
        id: source.id,
        organizationId: source.organizationId,
        settings: source.settings,
      }))),
  }
  return {
    prisma: {
      ...client,
      $transaction: vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => {
        const settingsBefore = structuredClone(mockState.settings)
        const sourcesBefore = structuredClone(mockState.sources)
        try {
          return await callback(client)
        } catch (error) {
          mockState.settings = settingsBefore
          mockState.sources = sourcesBefore
          throw error
        }
      }),
    },
    logAudit: vi.fn(),
  }
})

import { DELETE, PATCH } from "@/app/api/v1/social/monitoring-scenarios/[id]/route"
import { GET, POST } from "@/app/api/v1/social/monitoring-scenarios/route"
import { prisma, logAudit } from "@/lib/prisma"
import { repairLegacyFacebookScenarioSources } from "@/lib/social/monitoring-scenarios"

const findFirst = vi.mocked(prisma.channelConfig.findFirst)
const create = vi.mocked(prisma.channelConfig.create)
const update = vi.mocked(prisma.channelConfig.update)
const createSource = vi.mocked(prisma.monitoringSource.create)
const deleteSubjectSources = vi.mocked(prisma.monitoringSubjectSource.deleteMany)
const audit = vi.mocked(logAudit)

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState.fenceBlocked = false
  mockState.settings = null
  mockState.sources = []
})

describe("social monitoring scenarios API", () => {
  it("does not create or reactivate scenario state while clean-slate collection is blocked", async () => {
    mockState.fenceBlocked = true

    const createResponse = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Blocked scenario",
      platforms: ["facebook"],
    }))
    const patchResponse = await PATCH(request("/api/v1/social/monitoring-scenarios/scenario-1", {
      status: "active",
    }), params("scenario-1"))

    expect(createResponse.status).toBe(409)
    expect(patchResponse.status).toBe(409)
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it("returns an empty scenario list for a new tenant", async () => {
    const res = await GET(request("/api/v1/social/monitoring-scenarios"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual({
      scenarios: [],
      stats: { total: 0, active: 0, draft: 0, paused: 0 },
    })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        channelType: "social_monitoring",
        configName: "Monitoring scenarios",
      }),
    }))
    expect(mockState.registrations).toContainEqual({ module: "social", action: "read" })
  })

  it("creates one canonical global-search source per platform with local aliases and reply identity metadata", async () => {
    const res = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Nokaut mentions",
      platforms: ["instagram", "tiktok", "facebook"],
      topics: ["Nokaut", "boxing club"],
      keywords: ["nokaut.az"],
      sentiments: ["negative", "complaint", "lead"],
      action: "draft_reply",
      minConfidence: 82,
      replyIdentityId: "acc-1",
      replyIdentityLabel: "Nokaut.az (facebook)",
      replyMode: "safe_template_dry_run",
      autoReplyEnabled: true,
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.data).toMatchObject({
      name: "Nokaut mentions",
      platforms: ["instagram", "tiktok", "facebook"],
      search: {
        topics: ["Nokaut", "boxing club"],
        keywords: ["nokaut.az"],
        hashtags: ["nokaut", "boxingclub", "nokautaz"],
        useHashtagFallback: true,
        includeOwnedComments: true,
      },
      ai: {
        sentiments: ["negative", "complaint", "lead"],
        minConfidence: 82,
        action: "draft_reply",
      },
      reply: {
        identityId: "acc-1",
        identityLabel: "Nokaut.az (facebook)",
        mode: "safe_template_dry_run",
        autoReplyEnabled: true,
        liveSendAllowed: false,
      },
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        channelType: "social_monitoring",
        configName: "Monitoring scenarios",
      }),
    }))
    expect(createSource).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "keyword",
        collectionMode: "search_index",
        query: "nokaut",
        keywords: [],
        settings: expect.objectContaining({
          managedBy: "monitoring_scenario",
          scenarioName: "Nokaut mentions",
          scenarioTargetType: "keyword",
          canonicalBrandQuery: true,
          aliases: expect.arrayContaining(["boxing club", "nokaut.az", "boxingclub", "nokautaz"]),
          liveExternalSendEnabled: false,
          autoReplyEnabled: false,
        }),
      }),
    }))
    expect(createSource).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platform: "tiktok",
        sourceType: "keyword",
        query: "nokaut",
        keywords: [],
        settings: expect.objectContaining({
          managedBy: "monitoring_scenario",
          canonicalBrandQuery: true,
          aliases: expect.arrayContaining(["boxing club", "nokaut.az", "boxingclub", "nokautaz"]),
          liveExternalSendEnabled: false,
          autoReplyEnabled: false,
        }),
      }),
    }))
    expect(audit).toHaveBeenCalledWith("org-1", "create", "social_monitoring_scenario", json.data.id, "Nokaut mentions")
    expect(mockState.registrations).toContainEqual({ module: "social", action: "write" })
  })

  // WEB больше не создаёт и не переиспользует keyword-источник: покрытие даёт
  // только лента Google Alerts (решение владельца 2026-08-01). Прежняя
  // операторская строка обязана остаться нетронутой и погаснуть как stale.
  it("не переиспользует операторский WEB-источник под сценарий", async () => {
    mockState.sources.push({
      id: "existing-web-source",
      organizationId: "org-1",
      platform: "web",
      sourceType: "keyword",
      collectionMode: "search_index",
      query: "araz supermarket",
      url: null,
      handle: null,
      ownership: "external",
      cadenceMinutes: 360,
      keywords: ["legacy paid alias"],
      riskLevel: "medium",
      status: "active",
      settings: { aliases: ["Legacy local alias"] },
    })

    const response = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Araz reputation",
      platforms: ["web"],
      topics: ["Araz Supermarket", "Araz Market"],
      keywords: ["Araz"],
      hashtags: [],
    }))

    expect(response.status).toBe(201)
    expect(createSource).not.toHaveBeenCalled()
    const existing = mockState.sources.find(source => source.id === "existing-web-source")
    expect(existing).toMatchObject({ query: "araz supermarket", keywords: ["legacy paid alias"] })
    // Ни привязки к сценарию, ни канонической метки — строка не входит в план.
    expect(existing?.settings).not.toHaveProperty("scenarioLinks")
    expect(existing?.settings).not.toHaveProperty("canonicalBrandQuery")
  })

  // #638: aliases у переиспользованного источника продолжают накапливаться
  // (терпимость сличения при импорте), а searchFanOutTerms — список платных
  // поисковых слотов — заменяется при каждом сохранении сценария, чтобы
  // выведенные из сценария алиасы переставали тратить поисковый бюджет.
  it("заменяет searchFanOutTerms при каждом сохранении, пока aliases накапливаются", async () => {
    mockState.sources.push({
      id: "operator-instagram-keyword",
      organizationId: "org-1",
      platform: "instagram",
      sourceType: "keyword",
      collectionMode: "search_index",
      url: null,
      query: "araz supermarket",
      handle: null,
      ownership: "external",
      cadenceMinutes: 360,
      keywords: [],
      riskLevel: "medium",
      status: "active",
      settings: { aliases: ["Legacy local alias"] },
    })

    const created = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Araz reputation",
      platforms: ["instagram"],
      topics: ["Araz Supermarket"],
      keywords: ["Araz Market"],
      hashtags: [],
    }))
    expect(created.status).toBe(201)
    const id = (await created.json()).data.id as string
    const reusedSettings = mockState.sources
      .find(source => source.id === "operator-instagram-keyword")?.settings as Record<string, unknown>
    expect(reusedSettings).toMatchObject({ canonicalBrandQuery: true })
    expect(reusedSettings.aliases).toEqual(expect.arrayContaining(["Legacy local alias", "Araz Market"]))
    expect(reusedSettings.searchFanOutTerms).toEqual(expect.arrayContaining(["Araz Market"]))
    expect(reusedSettings.searchFanOutTerms).not.toContain("Legacy local alias")

    const patched = await PATCH(request(`/api/v1/social/monitoring-scenarios/${id}`, {
      keywords: ["Araz Endirim"],
    }), params(id))
    expect(patched.status).toBe(200)

    const resavedSettings = mockState.sources
      .find(source => source.id === "operator-instagram-keyword")?.settings as Record<string, unknown>
    // Слияние осталось для сличения: старый операторский алиас жив.
    expect(resavedSettings.aliases).toEqual(expect.arrayContaining(["Legacy local alias", "Araz Market", "Araz Endirim"]))
    // А поисковые слоты следуют ТЕКУЩЕМУ сценарию: выведенный термин исчез.
    expect(resavedSettings.searchFanOutTerms).toEqual(expect.arrayContaining(["Araz Endirim"]))
    expect(resavedSettings.searchFanOutTerms).not.toContain("Araz Market")
    expect(resavedSettings.searchFanOutTerms).not.toContain("Legacy local alias")
  })

  it("splits legacy packed Facebook scenario sources before the collector can run them", async () => {
    const response = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Legacy Facebook terms",
      platforms: ["facebook"],
      topics: [],
      keywords: ["Araz Supermarket", "Bravo Supermarket"],
      hashtags: [],
    }))
    const created = (await response.json()).data as { id: string }
    const stored = mockState.settings as { scenarios: Array<Record<string, unknown>> }
    const storedScenario = stored.scenarios.find(item => item.id === created.id)
    if (!storedScenario) throw new Error("scenario fixture was not persisted")
    storedScenario.search = {
      ...(storedScenario.search as Record<string, unknown>),
      hashtags: [],
      useHashtagFallback: false,
    }
    mockState.sources = [{
      id: "src-legacy-packed-facebook",
      organizationId: "org-1",
      platform: "facebook",
      sourceType: "keyword",
      collectionMode: "search_index",
      query: "Araz Supermarket|Bravo Supermarket",
      url: null,
      handle: null,
      ownership: "external",
      cadenceMinutes: 360,
      keywords: ["Araz Supermarket", "Bravo Supermarket"],
      riskLevel: "medium",
      status: "active",
      runClaimToken: "expired-collector",
      runClaimExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
      runClaimVersion: 4,
      settings: {
        managedBy: "monitoring_scenario",
        scenarioId: created.id,
        scenarioName: "Legacy Facebook terms",
        scenarioTargetType: "keyword",
        scenarioTargetValue: "Araz Supermarket|Bravo Supermarket",
        scenarioLinks: [{
          scenarioId: created.id,
          scenarioName: "Legacy Facebook terms",
          targetType: "keyword",
          targetValue: "Araz Supermarket|Bravo Supermarket",
        }],
      },
    }]

    await expect(repairLegacyFacebookScenarioSources({
      organizationId: "org-1",
      limit: 10,
    })).resolves.toMatchObject({
      scanned: 1,
      organizations: 1,
      scenarios: 1,
      failedOrganizations: 0,
      hasMore: false,
    })

    expect(mockState.sources.find(source => source.id === "src-legacy-packed-facebook"))
      .toMatchObject({ status: "disabled" })
    expect(prisma.monitoringSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        id: { in: ["src-legacy-packed-facebook"] },
      }),
      data: {
        runClaimToken: null,
        runClaimExpiresAt: null,
        runClaimVersion: { increment: 1 },
      },
    }))
    const activeFacebookSources = mockState.sources
      .filter(source => source.platform === "facebook" && source.status !== "disabled")
    expect(activeFacebookSources).toHaveLength(1)
    expect(activeFacebookSources[0]).toMatchObject({
      query: "araz supermarket",
      keywords: [],
      settings: expect.objectContaining({
        canonicalBrandQuery: true,
        aliases: expect.arrayContaining([
          "arazsupermarket",
          "Bravo Supermarket",
          "bravosupermarket",
        ]),
      }),
    })
  })

  it("rolls scenario JSON and managed sources back when provisioning fails", async () => {
    createSource.mockRejectedValueOnce(new Error("source write failed"))

    const response = await POST(request("/api/v1/social/monitoring-scenarios", {
      subjectId: "subject-1",
      name: "Atomic monitoring",
      platforms: ["instagram"],
      keywords: ["atomic"],
    }))

    expect(response.status).toBe(400)
    expect(mockState.settings).toBeNull()
    expect(mockState.sources).toEqual([])
  })

  it("reuses one scenario when the same subject is submitted again", async () => {
    const payload = {
      subjectId: "subject-1",
      name: "One collection plan",
      platforms: ["instagram"],
      keywords: ["leaddrive"],
    }

    expect((await POST(request("/api/v1/social/monitoring-scenarios", payload))).status).toBe(201)
    expect((await POST(request("/api/v1/social/monitoring-scenarios", payload))).status).toBe(201)

    const stored = mockState.settings as { scenarios: unknown[] }
    expect(stored.scenarios).toHaveLength(1)
  })

  it("persists includeExternalComments=false and stamps it onto managed search sources", async () => {
    const res = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "No external comments",
      platforms: ["instagram"],
      keywords: ["nokaut"],
      sentiments: ["negative"],
      action: "show_only",
      includeOwnedComments: false,
      includeExternalComments: false,
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.data.search.includeOwnedComments).toBe(false)
    expect(json.data.search.includeExternalComments).toBe(false)
    expect(createSource).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        settings: expect.objectContaining({
          searchIndex: expect.objectContaining({ includeComments: false }),
        }),
      }),
    }))
  })

  it("does NOT stamp searchIndex.includeComments when the scenario made no explicit choice", async () => {
    // Legacy/API-created scenarios without the field inherit the org-global toggle —
    // saving them must never silently opt an org into paid comment scraping.
    const res = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "No explicit choice",
      platforms: ["instagram"],
      keywords: ["nokaut"],
      sentiments: ["negative"],
      action: "show_only",
    }))

    expect(res.status).toBe(201)
    expect((await res.json()).data.search.includeExternalComments).toBeNull()
    for (const call of createSource.mock.calls as Array<[{ data: { settings: Record<string, unknown> } }]>) {
      if ((call[0].data.settings as { scenarioName?: string }).scenarioName !== "No explicit choice") continue
      // The source pipeline may add other searchIndex keys (e.g. domain) — only the
      // scenario stamp must be absent so the org-global toggle stays in charge.
      expect((call[0].data.settings.searchIndex as Record<string, unknown> | undefined) ?? {}).not.toHaveProperty("includeComments")
    }
  })

  it("ignores legacy URL/handle payloads and provisions only global term discovery", async () => {
    const res = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Patrul monitoring",
      platforms: ["instagram", "facebook", "tiktok"],
      urls: ["https://www.instagram.com/patrulaz.az/"],
      handles: ["@patrulaz.az"],
      keywords: ["hava"],
      hashtags: ["#yol"],
      sentiments: ["neutral"],
      action: "draft_reply",
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.data.search.urls).toEqual([])
    expect(json.data.search.handles).toEqual([])

    const createdUrlSources = createSource.mock.calls
      .map((call: [CreateMonitoringSourceArgs]) => call[0].data)
      .filter((data: Record<string, unknown>) => Boolean(data.url || data.handle))
    const createdTermSources = createSource.mock.calls
      .map((call: [CreateMonitoringSourceArgs]) => call[0].data)
      .filter((data: Record<string, unknown>) => data.sourceType === "keyword" || data.sourceType === "hashtag")

    expect(createdUrlSources).toEqual([])
    expect(createdTermSources).toHaveLength(3)
    expect(createdTermSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        platform: "instagram",
        sourceType: "keyword",
        query: "hava",
        keywords: [],
        settings: expect.objectContaining({
          canonicalBrandQuery: true,
          aliases: expect.arrayContaining(["yol"]),
        }),
      }),
      expect.objectContaining({ platform: "facebook", sourceType: "keyword", query: "hava" }),
      expect.objectContaining({
        platform: "tiktok",
        sourceType: "keyword",
        query: "hava",
        keywords: [],
        settings: expect.objectContaining({
          canonicalBrandQuery: true,
          aliases: expect.arrayContaining(["yol"]),
        }),
      }),
    ]))
  })

  it("rejects a scenario whose only submitted targets are legacy pages", async () => {
    const res = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Pages only",
      platforms: ["instagram", "facebook"],
      urls: ["https://www.instagram.com/patrulaz.az/"],
      handles: ["@patrulaz.az"],
    }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "Scenario needs at least one topic, keyword, or hashtag",
    })
    expect(mockState.sources).toEqual([])
  })

  it("disables scenario-managed direct rows and detaches independent Sources on resync", async () => {
    const created = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Legacy direct cleanup",
      subjectId: "subject-patrul",
      platforms: ["instagram"],
      keywords: ["patrul"],
    }))
    const id = (await created.json()).data.id as string
    mockState.sources.push(
      {
        id: "legacy-managed-profile",
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "profile",
        collectionMode: "search_index",
        url: "https://www.instagram.com/patrulaz",
        query: null,
        handle: null,
        status: "active",
        settings: {
          managedBy: "monitoring_scenario",
          scenarioId: id,
          scenarioName: "Legacy direct cleanup",
          scenarioTargetType: "url",
          scenarioTargetValue: "https://www.instagram.com/patrulaz",
          scenarioLinks: [{ scenarioId: id, targetType: "url" }],
        },
      },
      {
        id: "independent-profile",
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "profile",
        collectionMode: "search_index",
        url: "https://www.instagram.com/baku.ws",
        query: null,
        handle: null,
        status: "active",
        settings: {
          managedBy: "source_registry_import",
          customSetting: "preserved",
          scenarioLinks: [{ scenarioId: id, targetType: "url" }],
        },
      },
      {
        id: "legacy-competitor-query",
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "competitor",
        collectionMode: "search_index",
        url: null,
        query: "legacy competitor page",
        handle: null,
        status: "active",
        settings: {
          managedBy: "source_registry_import",
          scenarioLinks: [{ scenarioId: id, targetType: "handle" }],
        },
      },
    )

    const patched = await PATCH(request(`/api/v1/social/monitoring-scenarios/${id}`, {
      status: "active",
    }), params(id))

    expect(patched.status).toBe(200)
    expect(mockState.sources.find(source => source.id === "legacy-managed-profile")).toMatchObject({
      status: "disabled",
      settings: {
        scenarioLinks: [],
        disabledByScenarioSyncAt: expect.any(String),
        liveExternalSendEnabled: false,
        autoReplyEnabled: false,
      },
    })
    expect(mockState.sources.find(source => source.id === "legacy-managed-profile")?.settings)
      .not.toHaveProperty("managedBy")
    expect(mockState.sources.find(source => source.id === "legacy-managed-profile")?.settings)
      .not.toHaveProperty("scenarioId")
    expect(mockState.sources.find(source => source.id === "independent-profile")).toMatchObject({
      status: "active",
      settings: {
        managedBy: "source_registry_import",
        customSetting: "preserved",
        scenarioLinks: [],
        liveExternalSendEnabled: false,
        autoReplyEnabled: false,
      },
    })
    expect(mockState.sources.find(source => source.id === "legacy-competitor-query")).toMatchObject({
      status: "active",
      settings: {
        managedBy: "source_registry_import",
        scenarioLinks: [],
        liveExternalSendEnabled: false,
        autoReplyEnabled: false,
      },
    })
    expect(deleteSubjectSources).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        subjectId: "subject-patrul",
        relationType: "MONITORS",
        source: {
          OR: [
            { url: { not: null } },
            { handle: { not: null } },
            { sourceType: { in: ["profile", "page", "competitor", "influencer"] } },
          ],
        },
      },
    })
  })

  it("disables legacy per-term TikTok sources when an active scenario is resynced", async () => {
    const created = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Packed TikTok monitoring",
      platforms: ["tiktok"],
      keywords: ["Araz Market"],
      hashtags: ["#arazmarket"],
    }))
    const createdJson = await created.json()
    const id = createdJson.data.id as string

    mockState.sources.push({
      id: "legacy-tiktok-hashtag",
      organizationId: "org-1",
      platform: "tiktok",
      sourceType: "hashtag",
      collectionMode: "search_index",
      url: null,
      query: "arazmarket",
      handle: null,
      status: "limited",
      settings: { managedBy: "monitoring_scenario", scenarioId: id },
    })

    const patched = await PATCH(request(`/api/v1/social/monitoring-scenarios/${id}`, {
      status: "active",
    }), params(id))

    expect(patched.status).toBe(200)
    expect(mockState.sources.find(source => source.id === "legacy-tiktok-hashtag")).toMatchObject({
      status: "disabled",
      settings: expect.objectContaining({ disabledByScenarioSyncAt: expect.any(String) }),
    })
    expect(mockState.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        platform: "tiktok",
        sourceType: "keyword",
        query: "araz market",
        keywords: [],
        settings: expect.objectContaining({
          canonicalBrandQuery: true,
          aliases: expect.arrayContaining(["arazmarket"]),
        }),
      }),
    ]))
  })

  // WEB-сценарий вообще не создаёт keyword-источник: единственный веб-канал —
  // лента Google Alerts, а до её подключения источников у сценария нет.
  it("не создаёт WEB keyword-источник ни при создании, ни при удалении сценария", async () => {
    const first = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "First news plan",
      platforms: ["web"],
      keywords: ["shared brand"],
    }))
    const firstId = (await first.json()).data.id as string
    await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Second news plan",
      platforms: ["web"],
      keywords: ["shared brand"],
    }))

    expect(mockState.sources.filter(source => source.platform === "web")).toHaveLength(0)

    const deleted = await DELETE(
      request(`/api/v1/social/monitoring-scenarios/${firstId}`),
      params(firstId),
    )

    expect(deleted.status).toBe(200)
    expect(mockState.sources.filter(source => source.platform === "web")).toHaveLength(0)
  })

  // Подключение ленты — единственный способ получить веб-источник. Прежний
  // «канонический прямой поиск» не должен появляться ни до, ни после.
  it("создаёт только RSS-источник, когда сценарий подключает Google Alerts", async () => {
    const first = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "First RSS news plan",
      platforms: ["web"],
      keywords: ["shared rss brand"],
    }))
    const firstId = (await first.json()).data.id as string
    await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Second direct news plan",
      platforms: ["web"],
      keywords: ["shared rss brand"],
    }))

    const patched = await PATCH(request(`/api/v1/social/monitoring-scenarios/${firstId}`, {
      googleAlertsRssUrl: "https://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222",
    }), params(firstId))

    expect(patched.status).toBe(200)
    expect(mockState.sources.filter(source => (
      source.platform === "web" && source.sourceType === "keyword"
    ))).toHaveLength(0)
    expect(mockState.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        platform: "web",
        sourceType: "notification_inbox",
        query: `google-alerts-rss:${firstId}`,
        settings: expect.objectContaining({
          managedBy: "google_alerts_rss",
          scenarioId: firstId,
          googleAlertsRss: expect.objectContaining({
            configured: true,
            encryptedFeedUrl: expect.stringMatching(/^v1:/),
          }),
        }),
      }),
    ]))
  })

  it("preserves stored scenario timestamps when listing", async () => {
    mockState.settings = {
      scenarios: [{
        id: "scn-1",
        name: "Stored scenario",
        status: "active",
        platforms: ["instagram"],
        search: {
          topics: ["nokaut"],
          keywords: [],
          hashtags: ["nokaut"],
          handles: ["@legacy-page"],
          urls: ["https://www.instagram.com/legacy-page"],
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
          liveSendAllowed: true,
        },
        createdAt: "2026-07-01T10:00:00.000Z",
        updatedAt: "2026-07-02T10:00:00.000Z",
      }],
    }

    const res = await GET(request("/api/v1/social/monitoring-scenarios"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.scenarios[0]).toMatchObject({
      id: "scn-1",
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-02T10:00:00.000Z",
      reply: { liveSendAllowed: false },
      search: { handles: [], urls: [] },
    })
  })

  it("keeps a legacy pages-only scenario visible but makes it an inert draft", async () => {
    mockState.settings = {
      scenarios: [{
        id: "legacy-pages-only",
        name: "Legacy pages only",
        status: "active",
        platforms: ["instagram", "facebook"],
        search: {
          topics: [],
          keywords: [],
          hashtags: [],
          handles: ["@legacy-page"],
          urls: ["https://www.instagram.com/legacy-page"],
        },
        createdAt: "2026-07-01T10:00:00.000Z",
        updatedAt: "2026-07-02T10:00:00.000Z",
      }],
    }

    const res = await GET(request("/api/v1/social/monitoring-scenarios"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.scenarios).toEqual([
      expect.objectContaining({
        id: "legacy-pages-only",
        status: "draft",
        search: expect.objectContaining({ handles: [], urls: [] }),
      }),
    ])
  })

  it("updates and deletes an existing scenario", async () => {
    const created = await POST(request("/api/v1/social/monitoring-scenarios", {
      name: "Complaints",
      platforms: ["instagram"],
      topics: ["service"],
    }))
    const createdJson = await created.json()
    const id = createdJson.data.id as string

    const patched = await PATCH(request(`/api/v1/social/monitoring-scenarios/${id}`, {
      status: "paused",
    }), params(id))
    const patchedJson = await patched.json()

    expect(patched.status).toBe(200)
    expect(patchedJson.data.status).toBe("paused")
    expect(patchedJson.data.name).toBe("Complaints")
    expect(patchedJson.data.search.topics).toEqual(["service"])
    expect(mockState.sources.every(source => source.status === "paused")).toBe(true)
    expect(update).toHaveBeenCalled()

    const deleted = await DELETE(request(`/api/v1/social/monitoring-scenarios/${id}`), params(id))
    const deletedJson = await deleted.json()

    expect(deleted.status).toBe(200)
    expect(deletedJson.success).toBe(true)
    expect(audit).toHaveBeenCalledWith("org-1", "delete", "social_monitoring_scenario", id, "deleted")
  })
})
