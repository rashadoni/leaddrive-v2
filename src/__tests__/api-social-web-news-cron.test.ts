import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mockState = vi.hoisted(() => ({
  runWithRlsBypass: vi.fn((fn: () => Promise<Response>) => fn()),
  requireCronAuth: vi.fn(),
  organizationFindFirst: vi.fn(),
  subjectFindMany: vi.fn(),
  sourceFindMany: vi.fn(),
  getScenarios: vi.fn(),
  syncScenarioSources: vi.fn(),
  syncGoogleAlertsRssSource: vi.fn(),
  runSource: vi.fn(),
  withTenantFence: vi.fn(),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: mockState.runWithRlsBypass,
}))

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: mockState.requireCronAuth,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findFirst: mockState.organizationFindFirst },
    monitoringSubject: { findMany: mockState.subjectFindMany },
    monitoringSource: { findMany: mockState.sourceFindMany },
  },
}))

vi.mock("@/lib/social/monitoring-scenarios", () => ({
  getMonitoringScenariosUncached: mockState.getScenarios,
  syncMonitoringScenarioSources: mockState.syncScenarioSources,
}))

vi.mock("@/lib/social/google-alerts-rss", () => ({
  syncGoogleAlertsRssSource: mockState.syncGoogleAlertsRssSource,
}))

vi.mock("@/lib/social/monitoring-collector", () => ({
  runMonitoringSourceNow: mockState.runSource,
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: mockState.withTenantFence,
}))

import { POST } from "@/app/api/cron/social-web-news/route"

function request(path = "/api/cron/social-web-news?organizationSlug=brandprotection") {
  return new NextRequest(`http://localhost${path}`, { method: "POST" })
}

function scenario(id: string, name: string, status = "active", options: { rss?: boolean } = {}) {
  const googleAlertsRssConfigured = options.rss ?? true
  return {
    id,
    name,
    status,
    subjectId: `subject-${id}`,
    platforms: ["web"],
    // WEB собирается только лентой Google Alerts, поэтому сценарий без ленты
    // источника не имеет вовсе — это отдельное состояние, а не сбой.
    web: {
      sourceMode: googleAlertsRssConfigured ? "google_alerts_rss" : "direct_publishers",
      googleAlertsRssConfigured,
    },
  }
}

function source(input: {
  id: string
  scenarios: string[]
  kind?: "direct" | "rss" | "stale"
  relationType?: string
  subjectStatus?: string
}) {
  const kind = input.kind ?? "direct"
  const scenarioId = input.scenarios[0]
  return {
    id: input.id,
    platform: "web",
    sourceType: kind === "rss" ? "notification_inbox" : "keyword",
    collectionMode: kind === "rss" ? "notification_inbox" : "search_index",
    query: kind === "rss" ? `google-alerts-rss:${scenarioId}` : input.id,
    handle: null,
    url: null,
    settings: {
      ...(kind === "direct" ? { canonicalBrandQuery: true } : {}),
      ...(kind === "rss" ? { managedBy: "google_alerts_rss", scenarioId } : {}),
      scenarioLinks: input.scenarios.map(scenarioId => ({ scenarioId })),
    },
    subjectSources: input.scenarios.map(scenarioId => ({
      scenarioId,
      relationType: input.relationType ?? "MONITORS",
      subject: { status: input.subjectStatus ?? "active" },
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState.requireCronAuth.mockReturnValue(null)
  mockState.organizationFindFirst.mockResolvedValue({ id: "org-1" })
  mockState.subjectFindMany.mockResolvedValue([
    { id: "subject-scenario-baku" },
    { id: "subject-scenario-araz" },
  ])
  mockState.getScenarios.mockResolvedValue([
    scenario("scenario-baku", "Baku Electronics"),
    scenario("scenario-araz", "Araz"),
  ])
  mockState.sourceFindMany.mockResolvedValue([
    source({ id: "source-baku-1", scenarios: ["scenario-baku"] }),
    source({ id: "source-baku-duplicate", scenarios: ["scenario-baku"] }),
    source({ id: "source-baku-rss", scenarios: ["scenario-baku"], kind: "rss" }),
    source({ id: "source-araz", scenarios: ["scenario-araz"] }),
    source({ id: "source-araz-legacy", scenarios: ["scenario-araz"], kind: "stale" }),
    source({ id: "source-owned", scenarios: ["scenario-araz"], relationType: "OFFICIAL" }),
  ])
  mockState.runSource.mockImplementation(async (_orgId: string, sourceId: string) => ({
    runId: `run-${sourceId}`,
    sourceId,
    status: "success",
    foundCount: 1,
    newCount: 1,
    duplicateCount: 0,
    ignoredCount: 0,
    error: null,
    rawStats: {},
  }))
  mockState.withTenantFence.mockImplementation(async (
    _organizationId: string,
    sync: () => Promise<unknown>,
  ) => ({ allowed: true, value: await sync() }))
})

describe("POST /api/cron/social-web-news", () => {
  it("runs exactly one canonical direct and one configured RSS route per scenario", async () => {
    const response = await POST(request())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mockState.sourceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        platform: "web",
        OR: [
          {
            sourceType: "keyword",
            collectionMode: "search_index",
            settings: { path: ["canonicalBrandQuery"], equals: true },
          },
          {
            sourceType: "notification_inbox",
            collectionMode: "notification_inbox",
            settings: { path: ["managedBy"], equals: "google_alerts_rss" },
          },
        ],
        subjectSources: {
          some: {
            relationType: "MONITORS",
            scenarioId: { not: null },
            subject: { status: "active" },
          },
        },
      }),
      take: 500,
    }))
    expect(mockState.runWithRlsBypass).toHaveBeenCalledTimes(1)
    expect(mockState.syncScenarioSources).toHaveBeenCalledTimes(2)
    expect(mockState.syncGoogleAlertsRssSource).toHaveBeenCalledTimes(2)
    expect(mockState.syncGoogleAlertsRssSource).toHaveBeenNthCalledWith(
      1,
      "org-1",
      expect.objectContaining({ id: "scenario-baku" }),
      undefined,
    )
    expect(mockState.runSource).toHaveBeenCalledTimes(3)
    expect(mockState.runSource).toHaveBeenNthCalledWith(
      1,
      "org-1",
      "source-baku-1",
      { onlyCapability: "DISCOVER_POSTS" },
    )
    expect(mockState.runSource).toHaveBeenNthCalledWith(
      2,
      "org-1",
      "source-baku-rss",
      { onlyCapability: "DISCOVER_POSTS" },
    )
    expect(mockState.runSource).toHaveBeenNthCalledWith(
      3,
      "org-1",
      "source-araz",
      { onlyCapability: "DISCOVER_POSTS" },
    )
    expect(payload).toMatchObject({
      success: true,
      data: {
        activeWebScenarioCount: 2,
        selectedSourceCount: 3,
        coveredScenarioCount: 2,
        missingScenarios: [],
        failed: [],
        totals: { found: 3, new: 3, duplicate: 0, ignored: 0 },
      },
    })
  })

  it("runs the canonical direct source after an existing RSS source returns an empty feed", async () => {
    mockState.getScenarios.mockResolvedValue([
      scenario("scenario-baku", "Baku Electronics"),
    ])
    mockState.subjectFindMany.mockResolvedValue([
      { id: "subject-scenario-baku" },
    ])
    mockState.sourceFindMany.mockResolvedValue([
      source({ id: "source-baku-rss", scenarios: ["scenario-baku"], kind: "rss" }),
      source({ id: "source-baku-direct", scenarios: ["scenario-baku"] }),
    ])
    mockState.runSource.mockImplementation(async (_orgId: string, sourceId: string) => (
      sourceId === "source-baku-rss"
        ? {
            runId: "run-rss",
            sourceId,
            status: "success",
            foundCount: 0,
            newCount: 0,
            duplicateCount: 0,
            ignoredCount: 0,
            error: null,
            rawStats: { emptyFeed: true },
          }
        : {
            runId: "run-direct",
            sourceId,
            status: "success",
            foundCount: 2,
            newCount: 1,
            duplicateCount: 1,
            ignoredCount: 0,
            error: null,
            rawStats: {},
          }
    ))

    const response = await POST(request())
    const payload = await response.json()

    expect(mockState.syncScenarioSources).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ id: "scenario-baku" }),
    )
    expect(mockState.runSource.mock.calls.map(([, sourceId]) => sourceId))
      .toEqual(["source-baku-rss", "source-baku-direct"])
    expect(payload).toMatchObject({
      success: true,
      data: {
        selectedSourceCount: 2,
        coveredScenarioCount: 1,
        missingScenarios: [],
        totals: { found: 2, new: 1, duplicate: 1, ignored: 0 },
      },
    })
  })

  it("reports scenarios without an eligible external WEB source", async () => {
    mockState.sourceFindMany.mockResolvedValue([
      source({ id: "source-baku", scenarios: ["scenario-baku"] }),
    ])

    const response = await POST(request())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(false)
    expect(payload.data.missingScenarios).toEqual([
      { id: "scenario-araz", name: "Araz" },
    ])
  })

  it("не считает сбоем WEB-сценарий без подключённой ленты Google Alerts", async () => {
    mockState.getScenarios.mockResolvedValue([
      scenario("scenario-baku", "Baku Electronics"),
      scenario("scenario-araz", "Araz", "active", { rss: false }),
    ])
    mockState.sourceFindMany.mockResolvedValue([
      source({ id: "source-baku-rss", scenarios: ["scenario-baku"], kind: "rss" }),
    ])

    const response = await POST(request())
    const payload = await response.json()

    expect(payload.success).toBe(true)
    expect(payload.data.missingScenarios).toEqual([])
    expect(payload.data.deferredScenarios).toEqual([])
    expect(payload.data.scenariosWithoutFeed).toEqual([{ id: "scenario-araz", name: "Araz" }])
  })

  it("does not hide a failed additive route behind its successful sibling", async () => {
    mockState.sourceFindMany.mockResolvedValue([
      source({ id: "source-baku-domain", scenarios: ["scenario-baku"] }),
      source({ id: "source-baku-rss", scenarios: ["scenario-baku"], kind: "rss" }),
      source({ id: "source-araz", scenarios: ["scenario-araz"] }),
    ])
    mockState.runSource.mockImplementation(async (_orgId: string, sourceId: string) => {
      if (sourceId === "source-baku-domain") {
        return { error: "official_identity_not_collectable" }
      }
      return {
        runId: `run-${sourceId}`,
        sourceId,
        status: "success",
        foundCount: 1,
        newCount: 1,
        duplicateCount: 0,
        ignoredCount: 0,
        error: null,
        rawStats: {},
      }
    })

    const response = await POST(request())
    const payload = await response.json()

    expect(payload.success).toBe(false)
    expect(mockState.runSource).toHaveBeenCalledTimes(3)
    expect(payload.data).toMatchObject({
      coveredScenarioCount: 2,
      missingScenarios: [],
      failed: [{
        sourceId: "source-baku-domain",
        scenarioIds: ["scenario-baku"],
        error: "official_identity_not_collectable",
      }],
    })
  })

  it("rotates the bounded queue and caps attempts at two routes for 100 scenarios", async () => {
    const scenarios = Array.from({ length: 101 }, (_, index) =>
      scenario(`scenario-${index + 1}`, `Brand ${index + 1}`))
    mockState.getScenarios.mockResolvedValue(scenarios)
    mockState.subjectFindMany.mockResolvedValue(
      scenarios.map(item => ({ id: item.subjectId })),
    )
    const candidateOrder = [scenarios[100], ...scenarios.slice(0, 100)]
    mockState.sourceFindMany.mockResolvedValue(candidateOrder.flatMap(item => [
      source({ id: `direct-${item.id}`, scenarios: [item.id] }),
      source({ id: `rss-${item.id}`, scenarios: [item.id], kind: "rss" }),
    ]))
    mockState.runSource.mockResolvedValue({ error: "provider_temporarily_unavailable" })

    const response = await POST(request())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mockState.runSource).toHaveBeenCalledTimes(200)
    expect(payload.data.attemptedSourceCount).toBe(200)
    expect(payload.data.deferredScenarios).toEqual([
      { id: "scenario-100", name: "Brand 100" },
    ])
    expect(payload.data.failed).toHaveLength(200)
  })

  it("does not classify an active scenario with a paused subject as missing", async () => {
    mockState.subjectFindMany.mockResolvedValue([{ id: "subject-scenario-baku" }])
    mockState.sourceFindMany.mockResolvedValue([
      source({ id: "source-baku", scenarios: ["scenario-baku"] }),
    ])

    const response = await POST(request())
    const payload = await response.json()

    expect(payload.success).toBe(true)
    expect(mockState.syncScenarioSources).toHaveBeenCalledTimes(1)
    expect(payload.data).toMatchObject({
      activeWebScenarioCount: 2,
      runnableWebScenarioCount: 1,
      pausedSubjectScenarios: [{ id: "scenario-araz", name: "Araz" }],
      missingScenarios: [],
    })
  })

  it("returns cron authorization failures without reading or running sources", async () => {
    mockState.requireCronAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(mockState.organizationFindFirst).not.toHaveBeenCalled()
    expect(mockState.sourceFindMany).not.toHaveBeenCalled()
    expect(mockState.runSource).not.toHaveBeenCalled()
  })

  it("requires an explicit tenant slug", async () => {
    const response = await POST(request("/api/cron/social-web-news"))

    expect(response.status).toBe(400)
    expect(mockState.organizationFindFirst).not.toHaveBeenCalled()
    expect(mockState.runSource).not.toHaveBeenCalled()
  })

  it("does not recreate scenario or Google Alerts sources while clean-slate collection is blocked", async () => {
    mockState.withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    const response = await POST(request())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      skipped: true,
      reason: "social_monitoring_collection_blocked",
    })
    expect(mockState.syncScenarioSources).not.toHaveBeenCalled()
    expect(mockState.syncGoogleAlertsRssSource).not.toHaveBeenCalled()
    expect(mockState.sourceFindMany).not.toHaveBeenCalled()
    expect(mockState.runSource).not.toHaveBeenCalled()
  })
})
