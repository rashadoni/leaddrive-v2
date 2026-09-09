import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  monitoringSource: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  collectorRun: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  channelConfig: {
    findFirst: vi.fn(),
  },
  sourceRoutePlan: {
    findMany: vi.fn(),
  },
  socialProviderCapabilityProof: {
    count: vi.fn(),
  },
  socialProviderRun: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  ingestEnvelope: {
    findMany: vi.fn(),
  },
  tikTokPublicationRevisit: {
    findMany: vi.fn(),
  },
  organization: {
    findUnique: vi.fn(),
  },
}))

const routeAdapterMocks = vi.hoisted(() => ({
  hasApifyCommentCandidates: vi.fn(),
  runApifyAsyncCollector: vi.fn(),
  runBrightDataCollector: vi.fn(),
  runXOfficialCollector: vi.fn(),
}))

const tikTokRevisitMocks = vi.hoisted(() => ({
  reconcileForSource: vi.fn(),
}))

const paidBudgetMocks = vi.hoisted(() => ({
  beginPaidRouteBudgetDispatch: vi.fn(),
  requiresPaidRouteBudget: vi.fn((adapter: string) => adapter === "__never__"),
  usesProviderAccountBudget: vi.fn((adapter: string) => adapter === "BRIGHT_DATA_SNAPSHOT"),
  reservePaidRouteBudget: vi.fn(),
  finishPaidRouteBudgetReservation: vi.fn(),
}))

const paidAuthorizationMocks = vi.hoisted(() => ({
  authorizeTenantManualPaidRun: vi.fn(),
  finalizeTenantManualPaidRunAuthorization: vi.fn(),
  parseTenantPaidRunPolicy: vi.fn(),
  runQuotaValid: vi.fn(),
  tenantPaidRunEmergencyStopped: vi.fn(),
}))

const failbackMocks = vi.hoisted(() => ({
  auditProviderFailback: vi.fn(),
}))
const monitoringScenarioMocks = vi.hoisted(() => ({
  getScenarios: vi.fn(),
}))
const collectionFenceMocks = vi.hoisted(() => ({
  cleanSlateBlocked: vi.fn(),
  withTenantFence: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}))

vi.mock("@/lib/secure-token", () => ({
  decryptToken: vi.fn(),
}))

vi.mock("@/lib/sentiment", () => ({
  classifySentiment: vi.fn(),
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
}))

vi.mock("@/lib/social/source-route-plan", () => ({
  SOURCE_ROUTE_POLICY_VERSION: "social-monitoring-v2-pr2-budget-v1",
  ROUTE_ADAPTERS: {
    META_GRAPH: "META_GRAPH",
    YOUTUBE_DATA_API: "YOUTUBE_DATA_API",
    VK_API: "VK_API",
    TELEGRAM_BOT_API: "TELEGRAM_BOT_API",
    TIKTOK_BUSINESS_API: "TIKTOK_BUSINESS_API",
    X_API: "X_API",
    LICENSED_PROVIDER: "LICENSED_PROVIDER",
    BRIGHT_DATA_SNAPSHOT: "BRIGHT_DATA_SNAPSHOT",
    APIFY_ASYNC: "APIFY_ASYNC",
    AZERBAIJAN_NEWS_DIRECT: "AZERBAIJAN_NEWS_DIRECT",
    GOOGLE_ALERTS_RSS: "GOOGLE_ALERTS_RSS",
    SEARCH_INDEX_GENERIC: "SEARCH_INDEX_GENERIC",
    NOTIFICATION_INBOX: "NOTIFICATION_INBOX",
    BROWSER_CAPTURE_READ_ONLY: "BROWSER_CAPTURE_READ_ONLY",
    MANUAL_TASK: "MANUAL_TASK",
  },
  compileSourceRoutePlans: vi.fn(async () => []),
  recordSourceRouteResult: vi.fn(async () => undefined),
  selectedAdapterForPlan: vi.fn((plan: { primaryAdapter: string }) => plan.primaryAdapter),
}))

vi.mock("@/lib/social/apify-async-adapter", () => ({
  hasApifyCommentCandidates: routeAdapterMocks.hasApifyCommentCandidates,
  runApifyAsyncCollector: routeAdapterMocks.runApifyAsyncCollector,
}))

vi.mock("@/lib/social/bright-data-adapter", () => ({
  runBrightDataCollector: routeAdapterMocks.runBrightDataCollector,
}))

vi.mock("@/lib/social/twitter-poller", () => ({
  runXOfficialCollector: routeAdapterMocks.runXOfficialCollector,
}))

vi.mock("@/lib/social/tiktok-publication-revisit-repo", () => ({
  reconcileTikTokPublicationRevisitsForSource: tikTokRevisitMocks.reconcileForSource,
}))

vi.mock("@/lib/social/paid-route-budget", () => paidBudgetMocks)
vi.mock("@/lib/social/paid-run-authorization", () => ({
  ...paidAuthorizationMocks,
  PAID_RUN_PHASE: "PAID_ROUTE_COLLECTION",
}))
vi.mock("@/lib/social/provider-failback-reconciliation", () => failbackMocks)
vi.mock("@/lib/social/monitoring-scenarios", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/social/monitoring-scenarios")>(),
  getMonitoringScenariosUncached: monitoringScenarioMocks.getScenarios,
}))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  socialMonitoringCleanSlateBlocked: collectionFenceMocks.cleanSlateBlocked,
  withSocialMonitoringTenantCollectionFence: collectionFenceMocks.withTenantFence,
}))

import {
  backoffMultiplierForRuns,
  claimMonitoringSourceRun,
  classifyBusinessDiscoveryFailure,
  dispatchRouteAdapter,
  effectiveCadenceMinutes,
  findDueMonitoringSources,
  monitoringSourceDueState,
  nextSourceStatus,
  providerRunShowsDispatchExposure,
  reapStaleMonitoringSourceLeases,
  routeBudgetValues,
  runMonitoringSourceNow,
  runMonitoringSource,
  buildCollectorRunRejectionHistogram,
  getCollectorRunRejectionHistogram,
  type MonitoringSourceForRun,
} from "@/lib/social/monitoring-collector"
import { prisma } from "@/lib/prisma"
import { compileSourceRoutePlans, recordSourceRouteResult, SOURCE_ROUTE_POLICY_VERSION } from "@/lib/social/source-route-plan"
import { withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"

const source: MonitoringSourceForRun = {
  id: "src-1",
  organizationId: "org-1",
  platform: "instagram",
  sourceType: "hashtag",
  collectionMode: "manual",
  status: "active",
  cadenceMinutes: 60,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  settings: {
    expandedQueries: [
      { displayTerm: "leaddrive", priority: 100, cadenceMinutes: 30 },
      { displayTerm: "#leaddrive", priority: 95, cadenceMinutes: 45 },
    ],
  },
  // Собираемый источник всегда принадлежит живому клиенту: автосбор платит
  // провайдеру и без активной связи обязан отказывать (источники удалённого
  // клиента остаются именно без связей).
  subjectSources: [{ relationType: "MONITORS", scenarioId: null, subject: { status: "active" } }],
} as MonitoringSourceForRun

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  collectionFenceMocks.cleanSlateBlocked.mockReturnValue(false)
  collectionFenceMocks.withTenantFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true, value: await collect() }))
  vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([{
    ...source,
    ownership: "external",
    subjectSources: [],
  }] as never)
  vi.mocked(prisma.monitoringSource.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.sourceRoutePlan.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.socialProviderRun.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.socialProviderRun.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingestEnvelope.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.tikTokPublicationRevisit.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as never)
  vi.mocked(prisma.socialProviderCapabilityProof.count).mockResolvedValue(0 as never)
  monitoringScenarioMocks.getScenarios.mockResolvedValue([])
  // Default: no run-count quota, so requestedCap-less runs take the existing path.
  paidAuthorizationMocks.parseTenantPaidRunPolicy.mockReturnValue({ manualRunsEnabled: false, emergencyStopped: true, dailyRunQuota: 0 })
  paidAuthorizationMocks.runQuotaValid.mockReturnValue(false)
  paidAuthorizationMocks.tenantPaidRunEmergencyStopped.mockResolvedValue(false)
  routeAdapterMocks.runApifyAsyncCollector.mockResolvedValue({
    status: "success",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: null,
    rawStats: { queued: true },
  })
  routeAdapterMocks.hasApifyCommentCandidates.mockResolvedValue(false)
  tikTokRevisitMocks.reconcileForSource.mockResolvedValue({ subjectIds: [], examined: 0, created: 0 })
  routeAdapterMocks.runBrightDataCollector.mockResolvedValue({
    status: "success",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: null,
    rawStats: { reusedEnrichment: true },
  })
  routeAdapterMocks.runXOfficialCollector.mockResolvedValue({
    status: "success",
    foundCount: 1,
    newCount: 1,
    duplicateCount: 0,
    ignoredCount: 0,
  })
  paidBudgetMocks.requiresPaidRouteBudget.mockReturnValue(false)
  paidBudgetMocks.beginPaidRouteBudgetDispatch.mockResolvedValue(true)
  paidBudgetMocks.reservePaidRouteBudget.mockResolvedValue({ status: "NOT_REQUIRED" })
  paidBudgetMocks.finishPaidRouteBudgetReservation.mockResolvedValue(undefined)
  paidAuthorizationMocks.authorizeTenantManualPaidRun.mockResolvedValue({
    status: "AUTHORIZED",
    authorizationId: "authorization-1",
    maxTotalChargeUsd: 1,
    policyVersion: 2,
  })
  paidAuthorizationMocks.finalizeTenantManualPaidRunAuthorization.mockResolvedValue(undefined)
  failbackMocks.auditProviderFailback.mockResolvedValue({
    reconciled: true,
    evidenceAvailable: true,
    fallbackIdentityCount: 1,
    primaryIdentityCount: 1,
    retainedFallbackCount: 1,
    matchedByPrimaryCount: 1,
    unresolvedGapCount: 0,
    identityConflictCount: 0,
    unresolvedIdentityHashes: [],
    conflictingIdentityHashes: [],
  })
})

describe("collector rejection histogram", () => {
  it("counts terminal rejection decisions and ignores accepted/pending rows", () => {
    expect(buildCollectorRunRejectionHistogram([
      { relevanceStatus: "REJECTED", relevanceReason: " external_comment_has_no_own_subject_match " },
      { relevanceStatus: "POLICY_DENIED", relevanceReason: "provider_not_approved" },
      { relevanceStatus: "REVIEW", relevanceReason: null },
      { relevanceStatus: "ACCEPTED", relevanceReason: "exact_term_match" },
      { relevanceStatus: "PENDING", relevanceReason: null },
    ])).toEqual({
      total: 3,
      byReason: {
        external_comment_has_no_own_subject_match: 1,
        provider_not_approved: 1,
        unknown: 1,
      },
      byStatus: { REJECTED: 1, POLICY_DENIED: 1, REVIEW: 1 },
    })
  })

  it("reads only the requested tenant/run and decision fields", async () => {
    vi.mocked(prisma.ingestEnvelope.findMany).mockResolvedValue([
      { relevanceStatus: "REJECTED", relevanceReason: "foreign_same_name" },
    ] as never)
    await expect(getCollectorRunRejectionHistogram("org-1", "run-1")).resolves.toEqual({
      total: 1,
      byReason: { foreign_same_name: 1 },
      byStatus: { REJECTED: 1 },
    })
    expect(prisma.ingestEnvelope.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        collectorRunId: "run-1",
        relevanceStatus: { in: ["REVIEW", "REJECTED", "POLICY_DENIED", "DELETED_AT_SOURCE"] },
      },
      select: { relevanceStatus: true, relevanceReason: true },
    })
  })
})

describe("manual paid-run provider exposure", () => {
  it("lets an explicit pre-dispatch marker override a stranded reservation", () => {
    expect(providerRunShowsDispatchExposure({
      inputSnapshot: { providerRequestDispatched: false },
      externalRunId: null,
      reservedChargeUsd: 0.5,
      actualChargeUsd: 0,
    })).toBe(false)
  })

  it("keeps a legacy reservation conservative when the dispatch marker is missing", () => {
    expect(providerRunShowsDispatchExposure({
      inputSnapshot: {},
      externalRunId: null,
      reservedChargeUsd: 0.5,
      actualChargeUsd: 0,
    })).toBe(true)
  })

  it("treats remote identity or actual charge as exposure even with a false marker", () => {
    expect(providerRunShowsDispatchExposure({
      inputSnapshot: { providerRequestDispatched: false },
      externalRunId: "remote-1",
      reservedChargeUsd: 0,
      actualChargeUsd: 0,
    })).toBe(true)
    expect(providerRunShowsDispatchExposure({
      inputSnapshot: { providerRequestDispatched: false },
      externalRunId: null,
      reservedChargeUsd: 0,
      actualChargeUsd: 0.01,
    })).toBe(true)
  })
})

describe("social monitoring collector scheduler", () => {
  it("reaps only the exact expired claim and fails its still-running collector run", async () => {
    const now = new Date("2026-07-12T12:00:00.000Z")
    vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([{
      id: "stale-source",
      organizationId: "org-1",
      runClaimToken: "claim-old",
      runClaimVersion: 7,
      runClaimExpiresAt: new Date("2026-07-12T11:59:00.000Z"),
    }] as never)
    vi.mocked(prisma.monitoringSource.updateMany).mockResolvedValueOnce({ count: 1 } as never)
    vi.mocked(prisma.collectorRun.updateMany).mockResolvedValueOnce({ count: 1 } as never)

    await expect(reapStaleMonitoringSourceLeases({ organizationId: "org-1", now, limit: 25 })).resolves.toEqual({
      scanned: 1,
      reaped: 1,
      runsFailed: 1,
      hasMore: false,
    })
    expect(prisma.monitoringSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        runClaimToken: { not: null },
        runClaimExpiresAt: { lte: now },
      }),
      take: 25,
    }))
    expect(prisma.monitoringSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "stale-source",
        runClaimToken: "claim-old",
        runClaimVersion: 7,
        runClaimExpiresAt: { lte: now },
      }),
      data: expect.objectContaining({ runClaimToken: null, runClaimExpiresAt: null }),
    }))
    expect(prisma.collectorRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceId: "stale-source",
        claimToken: "claim-old",
        claimVersion: 7,
        status: "running",
        leaseExpiresAt: { lte: now },
      }),
      data: expect.objectContaining({ status: "failed", error: "collector_lease_expired", finishedAt: now }),
    }))
  })

  it("does not fail a run when a renewed claim wins the compare-and-set race", async () => {
    vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([{
      id: "renewed-source",
      organizationId: "org-1",
      runClaimToken: "claim-old",
      runClaimVersion: 2,
      runClaimExpiresAt: new Date("2026-07-12T11:59:00.000Z"),
    }] as never)
    vi.mocked(prisma.monitoringSource.updateMany).mockResolvedValueOnce({ count: 0 } as never)

    await expect(reapStaleMonitoringSourceLeases({ now: new Date("2026-07-12T12:00:00.000Z") })).resolves.toMatchObject({
      scanned: 1,
      reaped: 0,
      runsFailed: 0,
    })
    expect(prisma.collectorRun.updateMany).not.toHaveBeenCalled()
  })

  it("uses the fastest expanded-query cadence for due calculations", () => {
    expect(effectiveCadenceMinutes(source)).toBe(30)

    const due = monitoringSourceDueState(source, [], new Date("2026-07-05T10:00:00.000Z"))

    expect(due).toMatchObject({
      due: true,
      reason: "never_checked",
      cadenceMinutes: 30,
      backoffMultiplier: 1,
    })
  })

  it.each([
    { platform: "youtube", contractVersion: "youtube-selective-query-pack-v1", configuredCadence: 2880 },
    { platform: "tiktok", contractVersion: "tiktok-selective-query-pack-v1", configuredCadence: 1440 },
  ])("keeps the selective $platform discovery cadence exactly daily", ({ platform, contractVersion, configuredCadence }) => {
    const selectiveSource: MonitoringSourceForRun = {
      ...source,
      platform,
      ownership: "external",
      cadenceMinutes: configuredCadence,
      settings: {
        ...source.settings as Record<string, unknown>,
        selectiveDiscovery: { contractVersion },
      },
    }

    expect(effectiveCadenceMinutes(selectiveSource)).toBe(1440)
    expect(monitoringSourceDueState(
      { ...selectiveSource, lastCheckedAt: new Date("2026-07-22T12:00:00.000Z") },
      [],
      new Date("2026-07-23T11:59:59.000Z"),
    )).toMatchObject({
      due: false,
      reason: "backoff_wait",
      cadenceMinutes: 1440,
    })
    expect(monitoringSourceDueState(
      { ...selectiveSource, lastCheckedAt: new Date("2026-07-22T12:00:00.000Z") },
      [],
      new Date("2026-07-23T12:00:00.000Z"),
    )).toMatchObject({
      due: true,
      reason: "cadence_due",
      cadenceMinutes: 1440,
    })
  })

  it("uses the tenant weekly cadence only for scheduled due selection", () => {
    const lastCheckedAt = new Date("2026-07-18T12:00:00.000Z")
    const scheduledCadenceMinutes = 7 * 24 * 60

    expect(monitoringSourceDueState(
      { ...source, lastCheckedAt },
      [],
      new Date("2026-07-25T11:59:59.000Z"),
      scheduledCadenceMinutes,
    )).toMatchObject({
      due: false,
      reason: "backoff_wait",
      cadenceMinutes: scheduledCadenceMinutes,
    })
    expect(monitoringSourceDueState(
      { ...source, lastCheckedAt },
      [],
      new Date("2026-07-25T12:00:00.000Z"),
      scheduledCadenceMinutes,
    )).toMatchObject({
      due: true,
      reason: "cadence_due",
      cadenceMinutes: scheduledCadenceMinutes,
    })
  })

  it("does not apply a selective cadence contract to the wrong platform", () => {
    expect(effectiveCadenceMinutes({
      ...source,
      platform: "facebook",
      ownership: "external",
      cadenceMinutes: 1440,
      settings: {
        ...source.settings as Record<string, unknown>,
        selectiveDiscovery: { contractVersion: "youtube-selective-query-pack-v1" },
      },
    })).toBe(30)
  })

  it("marks inactive sources as not due", () => {
    const due = monitoringSourceDueState({ ...source, status: "paused" }, [], new Date("2026-07-05T10:00:00.000Z"))

    expect(due).toMatchObject({
      due: false,
      reason: "inactive",
      dueAt: null,
    })
  })

  it("backs off repeated failures and repeated empty successful runs", () => {
    expect(backoffMultiplierForRuns([
      { status: "failed", startedAt: new Date(), error: "rate_limited" },
      { status: "partial", startedAt: new Date(), error: "auth_failed" },
      { status: "success", startedAt: new Date(), error: null, foundCount: 1 },
    ])).toBe(4)

    expect(backoffMultiplierForRuns([
      { status: "success", startedAt: new Date(), error: null, foundCount: 0 },
      { status: "success", startedAt: new Date(), error: null, foundCount: 0 },
      { status: "success", startedAt: new Date(), error: null, foundCount: 0 },
    ])).toBe(2)
  })

  it("caps backoff at x2 for config-class failure streaks (no provider was hit)", () => {
    const infraStreak = [
      { status: "partial", startedAt: new Date(), error: "paid_route_budget_unconfigured" },
      { status: "partial", startedAt: new Date(), error: "paid_route_daily_budget_exhausted" },
      { status: "failed", startedAt: new Date(), error: "source_routes_partial_or_pending" },
      { status: "partial", startedAt: new Date(), error: "bright_data_live_routing_disabled" },
      { status: "partial", startedAt: new Date(), error: "manual_collection_required" },
    ]
    // Old behavior slept these sources for cadence*8 (days), so budget/route
    // fixes never took effect — the retry itself is the repair path.
    expect(backoffMultiplierForRuns(infraStreak)).toBe(2)

    // A single provider failure inside the streak keeps the full backoff.
    expect(backoffMultiplierForRuns([
      { status: "partial", startedAt: new Date(), error: "paid_route_daily_budget_exhausted" },
      { status: "failed", startedAt: new Date(), error: "rate_limited" },
      { status: "partial", startedAt: new Date(), error: "paid_route_budget_unconfigured" },
    ])).toBe(8)
  })

  it("selects only due tenant sources", async () => {
    vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([
      { ...source, id: "due", lastCheckedAt: null },
      {
        ...source,
        id: "selective-manual-only",
        lastCheckedAt: null,
        settings: { selectiveDiscovery: { liveRoutingAllowed: false } },
      },
      {
        ...source,
        id: "collection-policy-manual-only",
        lastCheckedAt: null,
        settings: { collectionPolicy: { automaticCollectionAllowed: false, manualOnly: true } },
      },
      { ...source, id: "waiting", lastCheckedAt: new Date(Date.now() + 60_000) },
    ] as never)
    vi.mocked(prisma.collectorRun.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)

    const due = await findDueMonitoringSources({ organizationId: "org-1", limit: 2 })

    expect(prisma.monitoringSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        status: { in: ["active", "limited", "needs_setup"] },
      },
      orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "asc" }],
      take: 10,
    }))
    expect(due.map((item) => item.id)).toEqual(["due"])
    expect(prisma.collectorRun.findMany).toHaveBeenCalledTimes(2)
  })

  it("excludes every tenant source while the clean-slate collection fence is active", async () => {
    vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([{
      ...source,
      id: "blocked-by-clean-slate",
      organization: {
        settings: {
          socialMonitoringCleanSlate: { collectionBlocked: true },
        },
      },
      routePlans: [],
      subjectSources: [],
    }] as never)
    collectionFenceMocks.cleanSlateBlocked.mockReturnValue(true)

    await expect(findDueMonitoringSources({
      organizationId: "org-1",
      limit: 10,
    })).resolves.toEqual([])

    expect(prisma.collectorRun.findMany).not.toHaveBeenCalled()
  })

  // WEB-слот у сценария теперь ровно один — лента Google Alerts. Прежние
  // keyword-строки (в том числе канонические) отбирались здесь по СТАТУСУ,
  // ничего не зная о плане сценария, и продолжали бы обходить издания после
  // того, как сценарий перестал их создавать (решение владельца 2026-08-01).
  it("планирует только RSS-ленту WEB и не берёт устаревшие keyword-строки", async () => {
    const webRoute = {
      status: "ACTIVE",
      capability: "DISCOVER_POSTS",
      primaryAdapter: "AZERBAIJAN_NEWS_DIRECT",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: null,
      budget: { usdLimitsConfigured: false },
      policyVersion: SOURCE_ROUTE_POLICY_VERSION,
      dependsOnCapability: null,
      lastFailureClass: null,
    }
    const webSource = {
      ...source,
      platform: "web",
      ownership: "external",
      organization: { settings: {} },
      routePlans: [webRoute],
      lastCheckedAt: null,
    }
    vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([
      {
        ...webSource,
        id: "baku-primary",
        sourceType: "keyword",
        collectionMode: "search_index",
        query: "Baku Electronics",
        settings: { canonicalBrandQuery: true },
        subjectSources: [{ relationType: "MONITORS", scenarioId: "scenario-baku", subject: { status: "active" } }],
      },
      {
        ...webSource,
        id: "baku-alias",
        sourceType: "keyword",
        collectionMode: "search_index",
        query: "bakuelectronics",
        settings: {},
        subjectSources: [{ relationType: "MONITORS", scenarioId: "scenario-baku", subject: { status: "active" } }],
      },
      {
        ...webSource,
        id: "baku-rss",
        sourceType: "notification_inbox",
        collectionMode: "notification_inbox",
        query: "google-alerts-rss:scenario-baku",
        settings: { managedBy: "google_alerts_rss", scenarioId: "scenario-baku" },
        routePlans: [{
          ...webRoute,
          primaryAdapter: "GOOGLE_ALERTS_RSS",
        }],
        subjectSources: [{ relationType: "MONITORS", scenarioId: "scenario-baku", subject: { status: "active" } }],
      },
      {
        ...webSource,
        id: "bravo-primary",
        sourceType: "keyword",
        collectionMode: "search_index",
        query: "Bravo",
        settings: { canonicalBrandQuery: true },
        subjectSources: [{ relationType: "MONITORS", scenarioId: "scenario-bravo", subject: { status: "active" } }],
      },
    ] as never)
    vi.mocked(prisma.collectorRun.findMany).mockResolvedValue([] as never)

    const due = await findDueMonitoringSources({ organizationId: "org-1", limit: 10 })

    expect(due.map(item => item.id)).toEqual(["baku-rss"])
    expect(prisma.collectorRun.findMany).toHaveBeenCalledTimes(1)
  })

  it("filters legacy scenario direct targets without blocking independent registry sources", async () => {
    const freeRoute = {
      status: "ACTIVE",
      capability: "DISCOVER_POSTS",
      primaryAdapter: "YOUTUBE_DATA_API",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: null,
      budget: { usdLimitsConfigured: false },
      policyVersion: SOURCE_ROUTE_POLICY_VERSION,
      dependsOnCapability: null,
      lastFailureClass: null,
    }
    const runtime = {
      ...source,
      platform: "youtube",
      sourceType: "campaign",
      url: "https://youtube.com/@legacy-target",
      query: null,
      ownership: "external",
      organization: { settings: {} },
      subjectSources: [{ relationType: "MONITORS", scenarioId: "scenario-1", subject: { status: "active" } }],
      routePlans: [freeRoute],
      lastCheckedAt: null,
    }
    vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([
      {
        ...runtime,
        id: "legacy-scenario-direct",
        settings: {},
      },
      {
        ...runtime,
        id: "independent-direct",
        settings: { scenarioLinks: [{ scenarioId: "legacy-scenario", targetType: "url" }] },
        subjectSources: [],
      },
    ] as never)
    vi.mocked(prisma.collectorRun.findMany).mockResolvedValue([] as never)

    const due = await findDueMonitoringSources({ organizationId: "org-1", limit: 10 })

    // legacy-scenario-direct отсеян: прямой источник помечен сценарием.
    // independent-direct — независимый источник реестра: связей с клиентом у
    // него нет вовсе, и это НЕ признак удалённого клиента (так выглядит всё,
    // что добавлено вручную в «Источниках», и сценарии без клиента). Осиротевшие
    // после удаления клиента источники гасятся в самом удалении
    // (deleteMonitoringSubject → status=disabled + INVALIDATED маршруты),
    // поэтому здесь он обязан собираться.
    expect(due.map(item => item.id)).toEqual(["independent-direct"])
    expect(prisma.collectorRun.findMany).toHaveBeenCalledTimes(1)
  })

  it("does not schedule paused-subject or unbudgeted paid-only sources", async () => {
    const runtime = {
      organization: { settings: {} },
      subjectSources: [{ subject: { status: "active" } }],
    }
    vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([
      {
        ...source,
        ...runtime,
        id: "paid-only",
        routePlans: [{
          status: "ACTIVE",
          primaryAdapter: "APIFY_ASYNC",
          fallbackAdapters: ["MANUAL_TASK"],
          budget: { usdLimitsConfigured: false },
          policyVersion: SOURCE_ROUTE_POLICY_VERSION,
          dependsOnCapability: null,
        }],
      },
      {
        ...source,
        ...runtime,
        id: "paused-subject",
        subjectSources: [{ subject: { status: "paused" } }],
        routePlans: [{
          status: "ACTIVE",
          primaryAdapter: "YOUTUBE_DATA_API",
          fallbackAdapters: ["MANUAL_TASK"],
          budget: { usdLimitsConfigured: false },
          policyVersion: SOURCE_ROUTE_POLICY_VERSION,
          dependsOnCapability: null,
        }],
      },
      {
        ...source,
        ...runtime,
        id: "free-active",
        routePlans: [{
          status: "ACTIVE",
          primaryAdapter: "YOUTUBE_DATA_API",
          fallbackAdapters: ["MANUAL_TASK"],
          budget: { usdLimitsConfigured: false },
          policyVersion: SOURCE_ROUTE_POLICY_VERSION,
          dependsOnCapability: null,
        }],
      },
      {
        ...source,
        ...runtime,
        id: "legacy-instagram-repair",
        ownership: "external",
        lastCheckedAt: new Date(Date.now() + 86_400_000),
        routePlans: [{
          status: "ACTIVE",
          capability: "DISCOVER_POSTS",
          primaryAdapter: "META_GRAPH",
          fallbackAdapters: ["APIFY_ASYNC", "MANUAL_TASK"],
          capabilityProofId: null,
          budget: { usdLimitsConfigured: false },
          policyVersion: SOURCE_ROUTE_POLICY_VERSION,
          dependsOnCapability: null,
        }],
      },
    ] as never)
    vi.mocked(prisma.collectorRun.findMany).mockResolvedValue([] as never)

    const due = await findDueMonitoringSources({ organizationId: "org-1", limit: 10 })

    expect(due.map(item => item.id)).toEqual(["free-active", "legacy-instagram-repair"])
    // Migration bypasses cadence/backoff and does not need historical runs.
    expect(prisma.collectorRun.findMany).toHaveBeenCalledTimes(1)
  })

  it("bounds a 500-source scheduler scan and serves the oldest 100 without starvation", async () => {
    const candidates = Array.from({ length: 500 }, (_, index) => ({
      ...source,
      id: `source-${String(index).padStart(3, "0")}`,
      lastCheckedAt: null,
    }))
    vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue(candidates as never)
    vi.mocked(prisma.collectorRun.findMany).mockResolvedValue([] as never)

    const due = await findDueMonitoringSources({ organizationId: "org-1", limit: 500 })

    expect(prisma.monitoringSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }))
    expect(due).toHaveLength(100)
    expect(due[0].id).toBe("source-000")
    expect(due.at(-1)?.id).toBe("source-099")
    expect(prisma.collectorRun.findMany).toHaveBeenCalledTimes(100)
  })
})

describe("social monitoring manual run", () => {
  it("rejects dependent comments when the target scenario has not explicitly authorized them", async () => {
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue(source as never)
    monitoringScenarioMocks.getScenarios.mockResolvedValueOnce([{
      id: "scenario-a",
      subjectId: "subject-a",
      status: "active",
      search: { includeExternalComments: false },
    }])

    const result = await runMonitoringSourceNow("org-1", "src-1", {
      requestedByUserId: "admin-1",
      targetScenarioId: "scenario-a",
      targetSubjectId: "subject-a",
      paidRunConfirmed: true,
      clientFundedManual: true,
      includeComments: true,
    })

    expect(result).toEqual({ error: "external_comments_run_not_authorized" })
    expect(paidAuthorizationMocks.authorizeTenantManualPaidRun).not.toHaveBeenCalled()
    expect(prisma.collectorRun.create).not.toHaveBeenCalled()
  })

  it("repairs a legacy paid WEB discovery plan before the free-run preflight", async () => {
    const webSource = {
      ...source,
      platform: "web",
      collectionMode: "search_index",
      ownership: "external",
    }
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue(webSource as never)
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{
        primaryAdapter: "APIFY_ASYNC",
        fallbackAdapters: ["MANUAL_TASK"],
      }] as never)
      .mockResolvedValueOnce([{
        primaryAdapter: "AZERBAIJAN_NEWS_DIRECT",
        fallbackAdapters: ["MANUAL_TASK"],
      }] as never)
    vi.mocked(prisma.socialProviderRun.findFirst).mockResolvedValue({
      startedAt: new Date(),
      createdAt: new Date(),
      timeoutSeconds: 900,
    } as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", {
      requestedByUserId: "user-1",
      onlyCapability: "DISCOVER_POSTS",
    })

    expect(compileSourceRoutePlans).toHaveBeenCalledWith(expect.objectContaining({
      id: "src-1",
      platform: "web",
      ownership: "external",
    }))
    expect(result).toMatchObject({ error: "already_running" })
    expect(prisma.collectorRun.create).not.toHaveBeenCalled()
  })

  it("requires an explicit USD cap for a capability-scoped paid route even in quota mode", async () => {
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue(source as never)
    vi.mocked(prisma.sourceRoutePlan.findMany).mockResolvedValueOnce([{
      primaryAdapter: "APIFY_ASYNC",
      fallbackAdapters: ["MANUAL_TASK"],
    }] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", {
      requestedByUserId: "user-1",
      onlyCapability: "READ_EXTERNAL_COMMENTS",
    })

    expect(result).toEqual({ error: "paid_manual_run_cap_required" })
    expect(paidAuthorizationMocks.authorizeTenantManualPaidRun).not.toHaveBeenCalled()
    expect(prisma.collectorRun.create).not.toHaveBeenCalled()
  })

  it("requires an authenticated actor before requesting tenant paid-run authorization", async () => {
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue(source as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", { maxTotalChargeUsd: 0.5 })

    expect(result).toEqual({ error: "paid_manual_run_actor_required" })
    expect(paidAuthorizationMocks.authorizeTenantManualPaidRun).not.toHaveBeenCalled()
    expect(prisma.collectorRun.create).not.toHaveBeenCalled()
  })

  it("stops before collector execution when the tenant paid-run guard blocks", async () => {
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue(source as never)
    paidAuthorizationMocks.authorizeTenantManualPaidRun.mockResolvedValueOnce({
      status: "BLOCKED",
      reason: "paid_manual_runs_not_authorized",
    })

    const result = await runMonitoringSourceNow("org-1", "src-1", {
      maxTotalChargeUsd: 0.5,
      requestedByUserId: "user-1",
    })

    expect(result).toEqual({ error: "paid_manual_runs_not_authorized" })
    expect(prisma.collectorRun.create).not.toHaveBeenCalled()
    expect(paidAuthorizationMocks.finalizeTenantManualPaidRunAuthorization).not.toHaveBeenCalled()
  })

  it("keeps the full tenant reservation when an unexpected collector exception makes dispatch uncertain", async () => {
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue(source as never)
    vi.mocked(prisma.monitoringSource.updateMany).mockRejectedValueOnce(new Error("database unavailable"))

    await expect(runMonitoringSourceNow("org-1", "src-1", {
      maxTotalChargeUsd: 0.5,
      requestedByUserId: "user-1",
    })).rejects.toThrow("database unavailable")

    expect(paidAuthorizationMocks.finalizeTenantManualPaidRunAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "exception",
      providerRequestDispatched: true,
      maxTotalChargeUsd: 1,
    }))
  })

  it("blocks only while an asynchronous provider job for the source is still active", async () => {
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue(source as never)
    vi.mocked(prisma.socialProviderRun.findFirst).mockResolvedValue({
      startedAt: new Date(),
      createdAt: new Date(),
      timeoutSeconds: 900,
    } as never)

    const result = await runMonitoringSourceNow("org-1", "src-1")

    expect(result).toMatchObject({ error: "already_running" })
    expect(prisma.socialProviderRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        NOT: { phase: "PAID_ROUTE_COLLECTION", status: "SUCCEEDED" },
      }),
    }))
    expect(prisma.collectorRun.create).not.toHaveBeenCalled()
  })

  it("rechecks protected identity after claiming and before provider dispatch", async () => {
    const directSource = {
      ...source,
      sourceType: "profile",
      url: "https://instagram.com/our-brand",
      ownership: "external",
    }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : directSource
    ) as never)
    vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([{
      ...directSource,
      subjectSources: [{ relationType: "OFFICIAL" }],
    }] as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-protected" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-protected" } as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", {
      maxTotalChargeUsd: 0.5,
      requestedByUserId: "user-1",
    })

    expect(result).toEqual({ error: "official_identity_not_collectable" })
    expect(prisma.collectorRun.update).toHaveBeenCalledWith({
      where: { id: "run-protected" },
      data: expect.objectContaining({
        status: "skipped",
        error: "official_identity_not_collectable",
        rawStats: expect.objectContaining({ dispatchBlocked: true }),
      }),
    })
    expect(compileSourceRoutePlans).not.toHaveBeenCalled()
    expect(paidAuthorizationMocks.finalizeTenantManualPaidRunAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ providerRequestDispatched: false }),
    )
  })

  it("creates a collector run and records safe skipped status when no adapter is configured", async () => {
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : source
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-1" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-1" } as never)
    vi.mocked(prisma.monitoringSource.update).mockResolvedValue(source as never)
    vi.mocked(prisma.ingestEnvelope.findMany).mockResolvedValue([
      { relevanceStatus: "REJECTED", relevanceReason: "foreign_same_name" },
      { relevanceStatus: "REVIEW", relevanceReason: "low_confidence" },
    ] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1")

    expect("runId" in result).toBe(true)
    expect(result).toMatchObject({
      runId: "run-1",
      sourceId: "src-1",
      status: "skipped",
      error: "source_route_plan_missing",
      foundCount: 0,
      newCount: 0,
    })
    expect(prisma.collectorRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        sourceId: "src-1",
        claimToken: expect.any(String),
        claimVersion: 1,
        leaseExpiresAt: expect.any(Date),
        status: "running",
        rawStats: { manualRun: true },
      }),
    })
    expect(prisma.collectorRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "skipped",
        error: "source_route_plan_missing",
        rawStats: expect.objectContaining({
          failClosed: true,
          manualRun: true,
          rejectionReasonHistogram: {
            total: 2,
            byReason: { foreign_same_name: 1, low_confidence: 1 },
            byStatus: { REJECTED: 1, REVIEW: 1 },
          },
        }),
      }),
    }))
    expect(prisma.monitoringSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "src-1", organizationId: "org-1", runClaimVersion: 1 }),
      data: expect.objectContaining({
        status: "active",
        lastCheckedAt: expect.any(Date),
        lastError: "source_route_plan_missing",
        runClaimToken: null,
        runClaimExpiresAt: null,
      }),
    }))
  })

  it("allows an explicit one-off run for a paused source and preserves paused status", async () => {
    const pausedSource = { ...source, status: "paused" }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 2, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : pausedSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-paused" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-paused" } as never)

    await expect(runMonitoringSourceNow("org-1", "src-1")).resolves.toMatchObject({
      runId: "run-paused",
      status: "skipped",
    })

    expect(prisma.monitoringSource.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        id: "src-1",
        organizationId: "org-1",
        status: { in: ["active", "limited", "needs_setup", "paused"] },
      }),
    }))
    expect(prisma.monitoringSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "paused" }),
    }))
  })

  it.each(["partial", "failed"] as const)(
    "never resumes a paused source after a one-off %s result",
    status => {
      expect(nextSourceStatus(
        { ...source, status: "paused" },
        {
          status,
          foundCount: 0,
          newCount: 0,
          duplicateCount: 0,
          ignoredCount: 0,
          error: "provider_partial_or_failed",
        },
      )).toBe("paused")
    },
  )

  it("preserves a non-runnable status imposed after the collector claimed the source", async () => {
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 3, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : source
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-concurrent-pause" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-concurrent-pause" } as never)
    vi.mocked(prisma.monitoringSource.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never) // claim
      .mockResolvedValueOnce({ count: 0 } as never) // runnable finalizer loses to pause
      .mockResolvedValueOnce({ count: 1 } as never) // preserve status, release lease

    await expect(runMonitoringSourceNow("org-1", "src-1")).resolves.toMatchObject({
      runId: "run-concurrent-pause",
      status: "skipped",
      error: "source_route_plan_missing",
    })

    expect(prisma.monitoringSource.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        id: "src-1",
        organizationId: "org-1",
        runClaimVersion: 3,
        status: "active",
      }),
    }))
    expect(prisma.monitoringSource.updateMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({
        id: "src-1",
        organizationId: "org-1",
        runClaimVersion: 3,
        status: { not: "active" },
      }),
      data: expect.not.objectContaining({ status: expect.anything() }),
    }))
  })

  it("preserves a resume imposed after a one-off paused-source claim", async () => {
    const pausedSource = { ...source, status: "paused" }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 4, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : pausedSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-concurrent-resume" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-concurrent-resume" } as never)
    vi.mocked(prisma.monitoringSource.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never) // claim paused
      .mockResolvedValueOnce({ count: 0 } as never) // exact paused finalizer loses to resume
      .mockResolvedValueOnce({ count: 1 } as never) // preserve active, release lease

    await expect(runMonitoringSourceNow("org-1", "src-1")).resolves.toMatchObject({
      runId: "run-concurrent-resume",
      status: "skipped",
      error: "source_route_plan_missing",
    })

    expect(prisma.monitoringSource.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        id: "src-1",
        organizationId: "org-1",
        runClaimVersion: 4,
        status: "paused",
      }),
    }))
    expect(prisma.monitoringSource.updateMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({
        id: "src-1",
        organizationId: "org-1",
        runClaimVersion: 4,
        status: { not: "paused" },
      }),
      data: expect.not.objectContaining({ status: expect.anything() }),
    }))
  })

  it("recompiles a Bright-Data-less plan once when live routing + a verified proof now exist", async () => {
    const prev = process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING
    process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING = "1"
    try {
      vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
        args.where?.runClaimToken
          ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
          : source
      ) as never)
      vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
      vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-bd" } as never)
      vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-bd" } as never)
      vi.mocked(prisma.monitoringSource.update).mockResolvedValue(source as never)
      // Stale plan: current policy version + an executable-but-Bright-Data-less
      // route, so neither the policy-version nor the all-blocked self-heal fires.
      vi.mocked(prisma.sourceRoutePlan.findMany)
        .mockResolvedValueOnce([{ routeKey: "src-1::DISCOVER_POSTS:PUBLIC", policyVersion: SOURCE_ROUTE_POLICY_VERSION, primaryAdapter: "META_GRAPH", fallbackAdapters: ["MANUAL_TASK"] }] as never)
        .mockResolvedValue([] as never)
      vi.mocked(prisma.socialProviderCapabilityProof.count).mockResolvedValue(1 as never)

      await runMonitoringSourceNow("org-1", "src-1")

      expect(prisma.socialProviderCapabilityProof.count).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1", platform: "instagram", adapterKey: "BRIGHT_DATA_SNAPSHOT", status: "VERIFIED" }),
      }))
      expect(compileSourceRoutePlans).toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING
      else process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING = prev
    }
  })

  it("does not recompile a current Apify Meta plan just because Bright Data is paused", async () => {
    const prev = process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING
    process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING = "1"
    try {
      vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
        args.where?.runClaimToken
          ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
          : source
      ) as never)
      vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
      vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-apify-paused-bd" } as never)
      vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-apify-paused-bd" } as never)
      vi.mocked(prisma.monitoringSource.update).mockResolvedValue(source as never)
      vi.mocked(prisma.sourceRoutePlan.findMany)
        .mockResolvedValueOnce([{
          routeKey: "src-1::DISCOVER_POSTS:PUBLIC",
          policyVersion: SOURCE_ROUTE_POLICY_VERSION,
          capability: "DISCOVER_POSTS",
          primaryAdapter: "APIFY_ASYNC",
          fallbackAdapters: ["MANUAL_TASK"],
        }] as never)
        .mockResolvedValue([] as never)

      await runMonitoringSourceNow("org-1", "src-1")

      expect(prisma.socialProviderCapabilityProof.count).not.toHaveBeenCalled()
      expect(compileSourceRoutePlans).not.toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING
      else process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING = prev
    }
  })

  it("leaves a Bright-Data-less plan untouched when live routing is off", async () => {
    const prev = process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING
    delete process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING
    try {
      vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
        args.where?.runClaimToken
          ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
          : source
      ) as never)
      vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
      vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-off" } as never)
      vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-off" } as never)
      vi.mocked(prisma.monitoringSource.update).mockResolvedValue(source as never)
      vi.mocked(prisma.sourceRoutePlan.findMany)
        .mockResolvedValueOnce([{ routeKey: "src-1::DISCOVER_POSTS:PUBLIC", policyVersion: SOURCE_ROUTE_POLICY_VERSION, primaryAdapter: "META_GRAPH", fallbackAdapters: ["MANUAL_TASK"] }] as never)
        .mockResolvedValue([] as never)
      vi.mocked(prisma.socialProviderCapabilityProof.count).mockResolvedValue(1 as never)

      await runMonitoringSourceNow("org-1", "src-1")

      expect(prisma.socialProviderCapabilityProof.count).not.toHaveBeenCalled()
      expect(compileSourceRoutePlans).not.toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING
      else process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING = prev
    }
  })

  it("recompiles only a legacy external Instagram META_GRAPH discovery plan without a capability proof", async () => {
    const externalProfile = {
      ...source,
      ownership: "external",
      sourceType: "profile",
      collectionMode: "search_index",
    }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : externalProfile
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-proof-repair" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-proof-repair" } as never)
    vi.mocked(prisma.monitoringSource.update).mockResolvedValue(externalProfile as never)
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{
        routeKey: "src-1::DISCOVER_POSTS:PUBLIC",
        policyVersion: SOURCE_ROUTE_POLICY_VERSION,
        capability: "DISCOVER_POSTS",
        primaryAdapter: "META_GRAPH",
        fallbackAdapters: ["APIFY_ASYNC", "MANUAL_TASK"],
        capabilityProofId: null,
      }] as never)
      .mockResolvedValue([] as never)

    await runMonitoringSourceNow("org-1", "src-1")

    expect(compileSourceRoutePlans).toHaveBeenCalledWith(expect.objectContaining({
      id: "src-1",
      platform: "instagram",
      ownership: "external",
    }))
  })

  it("recompiles a shared source when its requested scenario alias is missing", async () => {
    const sharedSource = {
      ...source,
      platform: "web",
      collectionMode: "search_index",
      settings: {
        scenarioLinks: [
          { scenarioId: "scenario-a" },
          { scenarioId: "scenario-b" },
        ],
      },
    }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : sharedSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-scenario-alias-repair" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-scenario-alias-repair" } as never)
    vi.mocked(prisma.monitoringSource.update).mockResolvedValue(sharedSource as never)
    const basePlan = {
      id: "route-scenario-a",
      routeKey: "route:scenario-a",
      scenarioId: "scenario-a",
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "APIFY_ASYNC",
      fallbackAdapters: [],
      capabilityProofId: null,
      capabilityProof: null,
      connectionAccountId: null,
      acquisitionMode: "APIFY_FALLBACK",
      dependsOnCapability: null,
      budget: { maxItems: 100, timeoutSeconds: 900 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: SOURCE_ROUTE_POLICY_VERSION,
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{
        routeKey: basePlan.routeKey,
        scenarioId: "scenario-a",
        policyVersion: SOURCE_ROUTE_POLICY_VERSION,
        capability: "DISCOVER_POSTS",
        primaryAdapter: "APIFY_ASYNC",
        fallbackAdapters: [],
        capabilityProofId: null,
      }] as never)
      .mockResolvedValueOnce([{
        ...basePlan,
        id: "route-scenario-b",
        routeKey: "route:scenario-b",
        scenarioId: "scenario-b",
      }] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", {
      targetScenarioId: "scenario-b",
      targetSubjectId: "subject-b",
      maxTotalChargeUsd: 1,
      requestedByUserId: "user-1",
    })

    expect(compileSourceRoutePlans).toHaveBeenCalledWith(expect.objectContaining({
      id: "src-1",
      settings: expect.objectContaining({
        scenarioLinks: sharedSource.settings.scenarioLinks,
      }),
    }))
    expect(result).toMatchObject({ status: "success", runId: "run-scenario-alias-repair" })
    expect(routeAdapterMocks.runApifyAsyncCollector).toHaveBeenCalledTimes(1)
  })

  it("executes identical physical routes once even when several scenarios reference them", async () => {
    // Apify is only a legitimate primary for generic web sources (TikTok/IG/FB
    // are Bright Data-only), so this route-dedup case uses a web source.
    const webSource = { ...source, platform: "web", collectionMode: "search_index" }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : webSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-dedupe" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-dedupe" } as never)
    vi.mocked(prisma.monitoringSource.update).mockResolvedValue(source as never)
    const basePlan = {
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "APIFY_ASYNC",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: null,
      capabilityProof: null,
      connectionAccountId: null,
      acquisitionMode: "APIFY_FALLBACK",
      dependsOnCapability: null,
      budget: { maxItems: 100, timeoutSeconds: 900 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: "route:scenario-a", policyVersion: "social-monitoring-v2-pr2-budget-v1" }] as never)
      .mockResolvedValueOnce([
        { ...basePlan, id: "route-a", routeKey: "route:scenario-a", scenarioId: "scenario-a" },
        { ...basePlan, id: "route-b", routeKey: "route:scenario-b", scenarioId: "scenario-b" },
      ] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", { maxTotalChargeUsd: 1, requestedByUserId: "user-1" })

    expect(result).toMatchObject({ status: "success", runId: "run-dedupe" })
    expect(routeAdapterMocks.runApifyAsyncCollector).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.collectorRun.update)).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawStats: expect.objectContaining({
          routeResults: [expect.objectContaining({ aliasPlanIds: ["route-a", "route-b"] })],
        }),
      }),
    }))
  })

  it("blocks a paid manual adapter before reservation when no explicit cap is supplied", async () => {
    const twitterSource = { ...source, platform: "twitter", collectionMode: "official_api" }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : twitterSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-cap-required" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-cap-required" } as never)
    paidBudgetMocks.requiresPaidRouteBudget.mockImplementation(adapter => adapter === "X_API")
    const plan = {
      id: "route-x-cap-required",
      routeKey: "route:x:cap-required",
      scenarioId: null,
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "X_API",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: null,
      capabilityProof: null,
      connectionAccountId: "account-x",
      acquisitionMode: "OFFICIAL_API",
      dependsOnCapability: null,
      budget: { usdLimitsConfigured: false, maxItems: 100, timeoutSeconds: 900 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1")

    expect(result).toMatchObject({ status: "partial", error: "paid_manual_run_cap_required" })
    expect(paidBudgetMocks.reservePaidRouteBudget).not.toHaveBeenCalled()
    expect(routeAdapterMocks.runXOfficialCollector).not.toHaveBeenCalled()
    const sourceUpdate = vi.mocked(prisma.monitoringSource.updateMany).mock.calls.at(-1)?.[0]
    expect(sourceUpdate?.data).not.toHaveProperty("lastSuccessfulAt")
  })
  it("reserves and forwards an explicit cap for a paid manual adapter", async () => {
    const twitterSource = { ...source, platform: "twitter", collectionMode: "official_api" }
    vi.mocked(prisma.socialProviderRun.findMany).mockRejectedValueOnce(new Error("provider ledger unavailable"))
    paidAuthorizationMocks.authorizeTenantManualPaidRun.mockResolvedValueOnce({
      status: "AUTHORIZED",
      authorizationId: "authorization-manual-x",
      maxTotalChargeUsd: 0.1,
      policyVersion: 2,
    })
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : twitterSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-budget-block" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-budget-block" } as never)
    paidBudgetMocks.requiresPaidRouteBudget.mockImplementation(adapter => adapter === "X_API")
    paidBudgetMocks.reservePaidRouteBudget.mockResolvedValue({
      status: "RESERVED",
      providerRunId: "provider-run-manual-x",
      reservedChargeUsd: 0.1,
    })
    const plan = {
      id: "route-x",
      routeKey: "route:x",
      scenarioId: null,
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "X_API",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: null,
      capabilityProof: null,
      connectionAccountId: "account-x",
      acquisitionMode: "OFFICIAL_API",
      dependsOnCapability: null,
      budget: { usdLimitsConfigured: false, maxItems: 100, timeoutSeconds: 900 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", { maxTotalChargeUsd: 0.1, requestedByUserId: "user-1" })

    expect(result).toMatchObject({ status: "success", runId: "run-budget-block" })
    expect(paidBudgetMocks.reservePaidRouteBudget).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      routePlanId: "route-x",
      adapterKey: "X_API",
      manualMaxTotalChargeUsd: 0.1,
      timeoutSeconds: expect.any(Number),
    }))
    const reservedTimeoutSeconds = paidBudgetMocks.reservePaidRouteBudget.mock.calls[0]?.[0].timeoutSeconds
    expect(reservedTimeoutSeconds).toBeGreaterThan(0)
    expect(reservedTimeoutSeconds).toBeLessThanOrEqual(840)
    expect(paidBudgetMocks.beginPaidRouteBudgetDispatch).toHaveBeenCalledWith(
      "org-1",
      "provider-run-manual-x",
    )
    expect(routeAdapterMocks.runXOfficialCollector).toHaveBeenCalledWith(expect.objectContaining({
      routeExecution: expect.objectContaining({
        providerRunId: "provider-run-manual-x",
        manualPaidRun: true,
        manualMaxTotalChargeUsd: 0.1,
      }),
    }))
    expect(prisma.socialProviderRun.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        collectorRunId: "run-budget-block",
      },
      select: {
        inputSnapshot: true,
        externalRunId: true,
        reservedChargeUsd: true,
        actualChargeUsd: true,
      },
    })
    expect(paidAuthorizationMocks.finalizeTenantManualPaidRunAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ providerRequestDispatched: true }),
    )
  })

  it("terminalizes a collector and releases authorization when its lease is too short to dispatch", async () => {
    const twitterSource = { ...source, platform: "twitter", collectionMode: "official_api" }
    paidAuthorizationMocks.authorizeTenantManualPaidRun.mockResolvedValueOnce({
      status: "AUTHORIZED",
      authorizationId: "authorization-short-lease",
      maxTotalChargeUsd: 0.1,
      policyVersion: 2,
    })
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 20_000) }
        : twitterSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-short-lease" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-short-lease" } as never)
    paidBudgetMocks.requiresPaidRouteBudget.mockImplementation(adapter => adapter === "X_API")
    const plan = {
      id: "route-x-short-lease",
      routeKey: "route:x:short-lease",
      scenarioId: null,
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "X_API",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: null,
      capabilityProof: null,
      connectionAccountId: "account-x",
      acquisitionMode: "OFFICIAL_API",
      dependsOnCapability: null,
      budget: { usdLimitsConfigured: false, maxItems: 100, timeoutSeconds: 900 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", {
      maxTotalChargeUsd: 0.1,
      requestedByUserId: "user-1",
    })

    expect(result).toMatchObject({
      status: "partial",
      error: "collector_lease_insufficient_before_dispatch",
      runId: "run-short-lease",
    })
    expect(paidBudgetMocks.reservePaidRouteBudget).not.toHaveBeenCalled()
    expect(routeAdapterMocks.runXOfficialCollector).not.toHaveBeenCalled()
    expect(prisma.collectorRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-short-lease" },
      data: expect.objectContaining({
        status: "partial",
        error: "collector_lease_insufficient_before_dispatch",
      }),
    }))
    expect(paidAuthorizationMocks.finalizeTenantManualPaidRunAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        collectorRunId: "run-short-lease",
        providerRequestDispatched: false,
      }),
    )
  })

  it("finalizes an uncertain paid adapter exception and does not try its fallback", async () => {
    let tenantFenceDepth = 0
    collectionFenceMocks.withTenantFence.mockImplementation(async (
      _organizationId: string,
      collect: () => Promise<unknown>,
    ) => {
      tenantFenceDepth += 1
      try {
        return { allowed: true, value: await collect() }
      } finally {
        tenantFenceDepth -= 1
      }
    })
    paidBudgetMocks.finishPaidRouteBudgetReservation.mockImplementationOnce(async () => {
      expect(tenantFenceDepth).toBeGreaterThan(0)
    })
    const twitterSource = { ...source, platform: "twitter", collectionMode: "official_api" }
    paidAuthorizationMocks.authorizeTenantManualPaidRun.mockResolvedValueOnce({
      status: "AUTHORIZED",
      authorizationId: "authorization-unknown-x",
      maxTotalChargeUsd: 0.1,
      policyVersion: 2,
    })
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : twitterSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-unknown-x" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-unknown-x" } as never)
    paidBudgetMocks.requiresPaidRouteBudget.mockImplementation(adapter => adapter === "X_API")
    paidBudgetMocks.reservePaidRouteBudget.mockResolvedValue({
      status: "RESERVED",
      providerRunId: "provider-run-unknown-x",
      reservedChargeUsd: 0.1,
    })
    routeAdapterMocks.runXOfficialCollector.mockRejectedValueOnce(new Error("unexpected adapter failure"))
    const plan = {
      id: "route-unknown-x",
      routeKey: "route:x:unknown",
      scenarioId: null,
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "X_API",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: null,
      capabilityProof: null,
      connectionAccountId: "account-x",
      acquisitionMode: "OFFICIAL_API",
      dependsOnCapability: null,
      budget: { usdLimitsConfigured: false, maxItems: 100, timeoutSeconds: 900 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", {
      maxTotalChargeUsd: 0.1,
      requestedByUserId: "user-1",
    })

    expect(result).toMatchObject({ status: "failed", error: "route_adapter_exception" })
    expect(routeAdapterMocks.runXOfficialCollector).toHaveBeenCalledTimes(1)
    expect(paidBudgetMocks.beginPaidRouteBudgetDispatch).toHaveBeenCalledWith(
      "org-1",
      "provider-run-unknown-x",
    )
    expect(paidBudgetMocks.finishPaidRouteBudgetReservation).toHaveBeenCalledWith(
      "org-1",
      "provider-run-unknown-x",
      expect.objectContaining({
        status: "failed",
        error: "route_adapter_exception",
        rawStats: expect.objectContaining({
          adapterInvoked: true,
          providerRequestDispatched: true,
          dispatchUnknown: true,
        }),
      }),
    )
    expect(recordSourceRouteResult).toHaveBeenCalledWith(
      "org-1",
      "route-unknown-x",
      expect.objectContaining({ usedAdapter: "X_API", ok: false, forceCircuitOpen: true }),
    )
  })

  it("normalizes a transport timeout at the dispatch boundary", async () => {
    vi.useFakeTimers()
    paidBudgetMocks.requiresPaidRouteBudget.mockImplementation(adapter => adapter === "X_API")
    routeAdapterMocks.runXOfficialCollector.mockImplementationOnce((adapterSource: MonitoringSourceForRun) =>
      withSocialProviderTimeout("x_page", signal => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      }), { timeoutMs: 60_000, signal: adapterSource.providerRequestSignal }),
    )
    const pending = dispatchRouteAdapter({
      ...source,
      platform: "twitter",
      routeExecution: {
        collectorRunId: "collector-timeout",
        routePlanId: "route-timeout",
        capability: "DISCOVER_POSTS",
        adapterKey: "X_API",
        acquisitionMode: "OFFICIAL_API",
        timeoutSeconds: 1,
      },
    }, "X_API")
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      error: "x_api_timeout",
      rawStats: {
        adapter: "X_API",
        timeoutMs: 1_000,
        providerRequestDispatched: true,
        dispatchUnknown: true,
      },
    })
  })

  it("stops fallback when an Apify dispatch times out with a remote outcome still unknown", async () => {
    vi.useFakeTimers()
    paidBudgetMocks.requiresPaidRouteBudget.mockReturnValue(false)
    routeAdapterMocks.runApifyAsyncCollector.mockImplementationOnce((adapterSource: MonitoringSourceForRun) =>
      withSocialProviderTimeout("apify_actor", signal => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      }), { timeoutMs: 60_000, signal: adapterSource.providerRequestSignal }),
    )
    const pending = dispatchRouteAdapter({
      ...source,
      platform: "web",
      routeExecution: {
        collectorRunId: "collector-apify-timeout",
        routePlanId: "route-apify-timeout",
        capability: "DISCOVER_POSTS",
        adapterKey: "APIFY_ASYNC",
        acquisitionMode: "APIFY_FALLBACK",
        timeoutSeconds: 1,
      },
    }, "APIFY_ASYNC")
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      error: "apify_async_timeout",
      rawStats: {
        adapter: "APIFY_ASYNC",
        providerRequestDispatched: true,
        dispatchUnknown: true,
      },
    })
  })

  it.each(["stopped", "unavailable"] as const)(
    "releases a paid reservation without provider I/O when the emergency-stop check is %s",
    async (emergencyCheck) => {
      const twitterSource = { ...source, platform: "twitter", collectionMode: "official_api" }
      paidAuthorizationMocks.authorizeTenantManualPaidRun.mockResolvedValueOnce({
        status: "AUTHORIZED",
        authorizationId: "authorization-reset-race",
        maxTotalChargeUsd: 0.1,
        policyVersion: 2,
      })
      if (emergencyCheck === "stopped") {
        paidAuthorizationMocks.tenantPaidRunEmergencyStopped.mockResolvedValueOnce(true)
      } else {
        paidAuthorizationMocks.tenantPaidRunEmergencyStopped.mockRejectedValueOnce(new Error("database unavailable"))
      }
      vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
        args.where?.runClaimToken
          ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
          : twitterSource
      ) as never)
      vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
      vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-reset-race" } as never)
      vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-reset-race" } as never)
      paidBudgetMocks.requiresPaidRouteBudget.mockImplementation(adapter => adapter === "X_API")
      paidBudgetMocks.reservePaidRouteBudget.mockResolvedValue({
        status: "RESERVED",
        providerRunId: "provider-run-reset-race",
        reservedChargeUsd: 0.1,
      })
      const plan = {
        id: "route-x-reset-race",
        routeKey: "route:x:reset-race",
        scenarioId: null,
        capability: "DISCOVER_POSTS",
        contentScope: "PUBLIC",
        primaryAdapter: "X_API",
        fallbackAdapters: ["MANUAL_TASK"],
        capabilityProofId: null,
        capabilityProof: null,
        connectionAccountId: "account-x",
        acquisitionMode: "OFFICIAL_API",
        dependsOnCapability: null,
        budget: { usdLimitsConfigured: false, maxItems: 100, timeoutSeconds: 900 },
        rateLimit: { maxRequestsPerMinute: 30 },
        circuitOpenUntil: null,
        status: "ACTIVE",
        policyVersion: "social-monitoring-v2-pr2-budget-v1",
      }
      vi.mocked(prisma.sourceRoutePlan.findMany)
        .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
        .mockResolvedValueOnce([plan] as never)

      const result = await runMonitoringSourceNow("org-1", "src-1", {
        maxTotalChargeUsd: 0.1,
        requestedByUserId: "user-1",
      })

      expect(result).toMatchObject({
        status: "partial",
        error: "paid_run_emergency_stopped_before_dispatch",
      })
      expect(routeAdapterMocks.runXOfficialCollector).not.toHaveBeenCalled()
      expect(paidBudgetMocks.beginPaidRouteBudgetDispatch).not.toHaveBeenCalled()
      expect(paidBudgetMocks.finishPaidRouteBudgetReservation).toHaveBeenCalledWith(
        "org-1",
        "provider-run-reset-race",
        expect.objectContaining({
          status: "skipped",
          error: "paid_run_emergency_stopped_before_dispatch",
          rawStats: expect.objectContaining({ providerRequestDispatched: false, failClosed: true }),
        }),
      )
    },
  )

  it.each([
    {
      label: "suppresses an unrequested dependent comments run",
      includeComments: false,
      discoveryQueued: true,
      expectedDiscoveryCapUsd: 100,
      expectedAdapterCalls: 1,
      expectedCommentsStatus: "skipped",
    },
    {
      label: "freezes separate discovery and dependent comments allocations",
      includeComments: true,
      discoveryQueued: true,
      expectedDiscoveryCapUsd: 50,
      expectedAdapterCalls: 1,
      expectedCommentsStatus: "queued",
    },
    {
      label: "uses the frozen comments allocation after reusing discovery",
      includeComments: true,
      discoveryQueued: false,
      expectedDiscoveryCapUsd: 50,
      expectedAdapterCalls: 2,
      expectedCommentsStatus: "success",
    },
  ])("$label under one client-funded source fuse", async ({
    includeComments,
    discoveryQueued,
    expectedDiscoveryCapUsd,
    expectedAdapterCalls,
    expectedCommentsStatus,
  }) => {
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : source
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-client-funded" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-client-funded" } as never)
    paidAuthorizationMocks.authorizeTenantManualPaidRun.mockResolvedValueOnce({
      status: "AUTHORIZED",
      authorizationId: "authorization-client-funded",
      maxTotalChargeUsd: 100,
      policyVersion: 0,
    })
    routeAdapterMocks.runApifyAsyncCollector.mockResolvedValue({
      status: "success",
      foundCount: 1,
      newCount: 1,
      duplicateCount: 0,
      ignoredCount: 0,
      error: null,
      rawStats: { queued: discoveryQueued },
    })
    const discoveryPlan = {
      id: "route-client-funded-discovery",
      routeKey: "route:client-funded:discovery",
      scenarioId: "scenario-a",
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "APIFY_ASYNC",
      fallbackAdapters: [],
      capabilityProofId: null,
      capabilityProof: null,
      connectionAccountId: null,
      acquisitionMode: "APIFY_FALLBACK",
      dependsOnCapability: null,
      budget: { usdLimitsConfigured: false, maxItems: 2_500, timeoutSeconds: 900 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: SOURCE_ROUTE_POLICY_VERSION,
    }
    const commentsPlan = {
      ...discoveryPlan,
      id: "route-client-funded-comments",
      routeKey: "route:client-funded:comments",
      capability: "READ_EXTERNAL_COMMENTS",
      dependsOnCapability: "DISCOVER_POSTS",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([
        { routeKey: discoveryPlan.routeKey, policyVersion: discoveryPlan.policyVersion, primaryAdapter: "APIFY_ASYNC", fallbackAdapters: [] },
        { routeKey: commentsPlan.routeKey, policyVersion: commentsPlan.policyVersion, primaryAdapter: "APIFY_ASYNC", fallbackAdapters: [] },
      ] as never)
      .mockResolvedValueOnce([discoveryPlan, commentsPlan] as never)
    if (includeComments) {
      monitoringScenarioMocks.getScenarios.mockResolvedValueOnce([{
        id: "scenario-a",
        subjectId: "subject-a",
        status: "active",
        search: { includeExternalComments: true },
      }])
    }

    const result = await runMonitoringSourceNow("org-1", "src-1", {
      requestedByUserId: "admin-1",
      targetScenarioId: "scenario-a",
      targetSubjectId: "subject-a",
      fullArchiveRun: true,
      archiveStartAt: "2026-07-01T00:00:00.000Z",
      paidRunConfirmed: true,
      clientFundedManual: true,
      ...(includeComments ? { includeComments: true } : {}),
    })

    expect(result).toMatchObject({
      status: "success",
      runId: "run-client-funded",
      error: null,
    })
    expect(paidAuthorizationMocks.authorizeTenantManualPaidRun).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceId: "src-1",
      requestedByUserId: "admin-1",
      maxTotalChargeUsd: 100,
      clientFundedManual: true,
    })
    expect(routeAdapterMocks.runApifyAsyncCollector).toHaveBeenCalledTimes(expectedAdapterCalls)
    const routeExecutions = routeAdapterMocks.runApifyAsyncCollector.mock.calls.map(
      ([routed]) => routed.routeExecution,
    )
    expect(routeExecutions[0]).toEqual(expect.objectContaining({
      routePlanId: "route-client-funded-discovery",
      manualPaidRun: true,
      manualMaxTotalChargeUsd: expectedDiscoveryCapUsd,
      clientFundedManual: true,
      targetScenarioId: "scenario-a",
      fullArchiveRun: true,
      archiveStartAt: "2026-07-01T00:00:00.000Z",
      maxItems: 2_500,
      ...(includeComments
        ? {
            dependentCommentsAuthorized: true,
            dependentCommentsMaxTotalChargeUsd: 50,
            sourceAuthorizedMaxTotalChargeUsd: 100,
            discoveryMaxTotalChargeUsd: 50,
          }
        : { suppressDependentPaidRuns: true }),
    }))
    if (includeComments) {
      expect(routeExecutions[0]).not.toHaveProperty("suppressDependentPaidRuns")
    } else {
      expect(routeExecutions.every(execution =>
        execution?.suppressDependentPaidRuns === true,
      )).toBe(true)
    }
    if (expectedAdapterCalls === 2) {
      expect(routeExecutions[1]).toEqual(expect.objectContaining({
        routePlanId: "route-client-funded-comments",
        capability: "READ_EXTERNAL_COMMENTS",
        manualPaidRun: true,
        manualMaxTotalChargeUsd: 50,
        clientFundedManual: true,
        targetScenarioId: "scenario-a",
      }))
    }
    expect(prisma.collectorRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rawStats: expect.objectContaining({
          manualRun: true,
          targetScenarioId: "scenario-a",
          fullArchiveRun: true,
          archiveStartAt: "2026-07-01T00:00:00.000Z",
          paidRunConfirmed: true,
          clientFundedManual: true,
          ...(includeComments ? { includeComments: true } : {}),
          manualMaxTotalChargeUsd: 100,
        }),
      }),
    })
    expect(prisma.collectorRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawStats: expect.objectContaining({
          routeResults: expect.arrayContaining([
            expect.objectContaining({
              routePlanId: "route-client-funded-comments",
              status: expectedCommentsStatus,
              error: includeComments ? null : "dependent_comments_not_requested",
            }),
          ]),
        }),
      }),
    }))
  })

  it("refuses run-now before claiming a source while clean-slate is active", async () => {
    collectionFenceMocks.withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    await expect(runMonitoringSource(source)).rejects.toThrow(
      "social_monitoring_collection_blocked",
    )

    expect(prisma.monitoringSource.updateMany).not.toHaveBeenCalled()
    expect(prisma.collectorRun.create).not.toHaveBeenCalled()
  })

  it("does not create post-reset history when the claimed generation was replaced", async () => {
    vi.mocked(prisma.monitoringSource.findFirst)
      .mockResolvedValueOnce({
        runClaimVersion: 7,
        runClaimExpiresAt: new Date(Date.now() + 15 * 60_000),
      } as never)
      // A clean-slate reset cleared this token and incremented the generation
      // after claim. Even if collection is later resumed, the stale worker
      // cannot create a collector row past the reset boundary.
      .mockResolvedValueOnce(null)

    await expect(runMonitoringSource(source)).rejects.toThrow(
      "collector_already_running",
    )

    expect(collectionFenceMocks.withTenantFence).toHaveBeenCalledTimes(2)
    expect(prisma.monitoringSource.findFirst).toHaveBeenLastCalledWith({
      where: {
        id: "src-1",
        organizationId: "org-1",
        status: { in: ["active", "limited", "needs_setup"] },
        runClaimToken: expect.any(String),
        runClaimVersion: 7,
        runClaimExpiresAt: { gt: expect.any(Date) },
      },
      select: { id: true },
    })
    expect(prisma.collectorRun.create).not.toHaveBeenCalled()
  })

  it("does not compile route plans after clean-slate wins past collector creation", async () => {
    const allowFence = async (
      _organizationId: string,
      collect: () => Promise<unknown>,
    ) => ({ allowed: true as const, value: await collect() })
    collectionFenceMocks.withTenantFence
      .mockImplementationOnce(allowFence)
      .mockImplementationOnce(allowFence)
      .mockResolvedValueOnce({
        allowed: false,
        reason: "social_monitoring_collection_blocked",
      })
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue({
      id: "src-1",
      runClaimVersion: 1,
      runClaimExpiresAt: new Date(Date.now() + 15 * 60_000),
    } as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-before-reset" } as never)
    vi.mocked(prisma.sourceRoutePlan.findMany).mockResolvedValue([] as never)

    await expect(runMonitoringSource(source)).rejects.toThrow(
      "social_monitoring_collection_blocked",
    )

    expect(prisma.collectorRun.create).toHaveBeenCalledOnce()
    expect(compileSourceRoutePlans).not.toHaveBeenCalled()
    expect(recordSourceRouteResult).not.toHaveBeenCalled()
  })

  it("does not publish route health after reset invalidates the collector generation", async () => {
    const allowFence = async (
      _organizationId: string,
      collect: () => Promise<unknown>,
    ) => ({ allowed: true as const, value: await collect() })
    collectionFenceMocks.withTenantFence
      .mockImplementationOnce(allowFence) // claim
      .mockImplementationOnce(allowFence) // collector row
      .mockImplementationOnce(allowFence) // post-plan generation check
      .mockImplementationOnce(allowFence) // free adapter persistence
      .mockResolvedValueOnce({
        allowed: false,
        reason: "social_monitoring_collection_blocked",
      })
    const twitterSource = {
      ...source,
      platform: "twitter",
      collectionMode: "official_api",
    }
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue({
      id: "src-1",
      runClaimVersion: 1,
      runClaimExpiresAt: new Date(Date.now() + 15 * 60_000),
    } as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-before-reset" } as never)
    const plan = {
      id: "route-before-reset",
      routeKey: "route:twitter:discover",
      scenarioId: null,
      policyVersion: SOURCE_ROUTE_POLICY_VERSION,
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "X_API",
      fallbackAdapters: [],
      capabilityProofId: null,
      capabilityProof: null,
      connectionAccountId: null,
      acquisitionMode: "OFFICIAL_API",
      dependsOnCapability: null,
      budget: {},
      rateLimit: {},
      circuitOpenUntil: null,
      status: "ACTIVE",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([plan] as never)
      .mockResolvedValueOnce([plan] as never)

    await expect(runMonitoringSource(twitterSource, { manualRun: true })).rejects.toThrow(
      "social_monitoring_collection_blocked",
    )

    expect(routeAdapterMocks.runXOfficialCollector).toHaveBeenCalledOnce()
    expect(recordSourceRouteResult).not.toHaveBeenCalled()
    expect(prisma.collectorRun.update).not.toHaveBeenCalled()
  })

  it("skips automatic paid-only routes when recurring owner limits are absent", async () => {
    const twitterSource = { ...source, platform: "twitter", collectionMode: "official_api" }
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue({
      runClaimVersion: 1,
      runClaimExpiresAt: new Date(Date.now() + 15 * 60_000),
    } as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-scheduled-budget-block" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-scheduled-budget-block" } as never)
    paidBudgetMocks.requiresPaidRouteBudget.mockImplementation(adapter => adapter === "X_API")
    paidBudgetMocks.reservePaidRouteBudget.mockResolvedValue({
      status: "BLOCKED",
      reason: "paid_route_budget_unconfigured",
    })
    const plan = {
      id: "route-x-scheduled",
      routeKey: "route:x:scheduled",
      scenarioId: null,
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "X_API",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: null,
      capabilityProof: null,
      connectionAccountId: "account-x",
      acquisitionMode: "OFFICIAL_API",
      dependsOnCapability: null,
      budget: { usdLimitsConfigured: false, maxItems: 100, timeoutSeconds: 900 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSource(twitterSource)

    expect(result).toMatchObject({ status: "skipped", error: "automatic_route_not_authorized" })
    expect(paidBudgetMocks.reservePaidRouteBudget).not.toHaveBeenCalled()
    expect(routeAdapterMocks.runXOfficialCollector).not.toHaveBeenCalled()
  })

  it("uses the approved Apify fallback when the Bright Data budget is blocked (generic web only)", async () => {
    // This legacy generic-WEB fallback remains supported independently of the
    // native Facebook/Instagram Apify-first routes.
    const providerSource = { ...source, platform: "web", collectionMode: "provider_api" }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : providerSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-bright-budget-fallback" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-bright-budget-fallback" } as never)
    paidBudgetMocks.requiresPaidRouteBudget.mockImplementation(adapter => adapter === "BRIGHT_DATA_SNAPSHOT")
    paidBudgetMocks.reservePaidRouteBudget.mockResolvedValue({
      status: "BLOCKED",
      reason: "paid_route_daily_budget_exhausted",
    })
    const plan = {
      id: "route-bright-budget-fallback",
      routeKey: "route:bright:budget-fallback",
      scenarioId: null,
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: ["APIFY_ASYNC", "MANUAL_TASK"],
      capabilityProofId: "proof-bright",
      capabilityProof: {
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-14T00:00:00.000Z"),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        readAllowed: true,
        exportAllowed: true,
        replyAllowed: false,
        sandboxVerifiedAt: null,
      },
      connectionAccountId: null,
      acquisitionMode: "LICENSED_PROVIDER",
      dependsOnCapability: null,
      budget: { usdLimitsConfigured: true, maxTotalChargeUsd: 0.05, maxItems: 10, timeoutSeconds: 60 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", { maxTotalChargeUsd: 0.05, requestedByUserId: "user-1" })

    expect(result).toMatchObject({ status: "success", runId: "run-bright-budget-fallback" })
    expect(routeAdapterMocks.runBrightDataCollector).not.toHaveBeenCalled()
    expect(routeAdapterMocks.runApifyAsyncCollector).toHaveBeenCalledOnce()
    expect(recordSourceRouteResult).toHaveBeenCalledWith(
      "org-1",
      plan.id,
      expect.objectContaining({
        ok: true,
        usedAdapter: "APIFY_ASYNC",
        primaryAttempted: true,
        primaryFailureClass: "paid_route_daily_budget_exhausted",
      }),
    )
  })

  it("allows a legacy Facebook route to fail over from blocked Bright Data to Apify", async () => {
    // Existing persisted routes may still place Bright Data first until the
    // policy-version recompile. Runtime enforcement must permit the newly
    // approved Facebook discovery fallback during that transition.
    const facebookSource = { ...source, platform: "facebook", collectionMode: "provider_api" }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : facebookSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-facebook-apify-fallback" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-facebook-apify-fallback" } as never)
    paidBudgetMocks.requiresPaidRouteBudget.mockImplementation(adapter => adapter === "BRIGHT_DATA_SNAPSHOT")
    paidBudgetMocks.reservePaidRouteBudget.mockResolvedValue({
      status: "BLOCKED",
      reason: "paid_route_daily_budget_exhausted",
    })
    const plan = {
      id: "route-facebook-legacy-apify",
      routeKey: "route:facebook:legacy-apify",
      scenarioId: null,
      capability: "DISCOVER_POSTS",
      contentScope: "PUBLIC",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: ["APIFY_ASYNC", "MANUAL_TASK"],
      capabilityProofId: "proof-bright",
      capabilityProof: {
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-14T00:00:00.000Z"),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        readAllowed: true,
        exportAllowed: true,
        replyAllowed: false,
        sandboxVerifiedAt: null,
      },
      connectionAccountId: null,
      acquisitionMode: "LICENSED_PROVIDER",
      dependsOnCapability: null,
      budget: { usdLimitsConfigured: true, maxTotalChargeUsd: 0.05, maxItems: 10, timeoutSeconds: 60 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", { maxTotalChargeUsd: 0.05, requestedByUserId: "user-1" })

    expect(result).toMatchObject({ status: "success", runId: "run-facebook-apify-fallback" })
    expect(routeAdapterMocks.runApifyAsyncCollector).toHaveBeenCalledOnce()
    expect(routeAdapterMocks.runBrightDataCollector).not.toHaveBeenCalled()
    expect(recordSourceRouteResult).toHaveBeenCalledWith(
      "org-1",
      plan.id,
      expect.objectContaining({
        ok: true,
        usedAdapter: "APIFY_ASYNC",
        primaryAttempted: true,
        primaryFailureClass: "paid_route_daily_budget_exhausted",
      }),
    )
  })

  it("reserves one Bright Data call while media reuses the enrichment payload", async () => {
    const providerSource = { ...source, collectionMode: "provider_api" }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : providerSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-bright-coalesced" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-bright-coalesced" } as never)
    paidBudgetMocks.requiresPaidRouteBudget.mockImplementation(adapter => adapter === "BRIGHT_DATA_SNAPSHOT")
    paidBudgetMocks.reservePaidRouteBudget.mockResolvedValue({
      status: "RESERVED",
      providerRunId: "provider-run-bright",
      reservedChargeUsd: 0.05,
    })
    const proof = {
      status: "VERIFIED",
      verifiedAt: new Date("2026-07-14T00:00:00.000Z"),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      readAllowed: true,
      exportAllowed: true,
      replyAllowed: false,
      sandboxVerifiedAt: null,
    }
    const basePlan = {
      routeKey: "route:bright",
      scenarioId: null,
      contentScope: "PUBLIC",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: "proof-bright",
      capabilityProof: proof,
      connectionAccountId: null,
      acquisitionMode: "LICENSED_PROVIDER",
      budget: { usdLimitsConfigured: true, maxTotalChargeUsd: 0.05, maxItems: 10, timeoutSeconds: 60 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    const enrichment = { ...basePlan, id: "route-enrich", capability: "ENRICH_CONTENT", dependsOnCapability: null }
    const media = { ...basePlan, id: "route-media", routeKey: "route:bright:media", capability: "READ_MEDIA", dependsOnCapability: "ENRICH_CONTENT" }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: enrichment.routeKey, policyVersion: enrichment.policyVersion }] as never)
      .mockResolvedValueOnce([enrichment, media] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1", { maxTotalChargeUsd: 0.05, requestedByUserId: "user-1" })

    expect(result).toMatchObject({ status: "success", runId: "run-bright-coalesced" })
    expect(paidBudgetMocks.reservePaidRouteBudget).toHaveBeenCalledTimes(1)
    expect(paidBudgetMocks.finishPaidRouteBudgetReservation).toHaveBeenCalledTimes(1)
    expect(routeAdapterMocks.runBrightDataCollector).toHaveBeenCalledTimes(2)
    expect(routeAdapterMocks.runBrightDataCollector.mock.calls[0][0].routeExecution).toMatchObject({
      capability: "ENRICH_CONTENT",
      providerRunId: "provider-run-bright",
    })
    expect(routeAdapterMocks.runBrightDataCollector.mock.calls[1][0].routeExecution).toMatchObject({
      capability: "READ_MEDIA",
      providerRunId: null,
    })
  })

  it("runs a dependent comments route when enriched parent posts already exist", async () => {
    const providerSource = { ...source, platform: "facebook", collectionMode: "provider_api" }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : providerSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-comments-persisted-parent" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-comments-persisted-parent" } as never)
    vi.mocked(prisma.ingestEnvelope.findMany).mockResolvedValueOnce([{ id: "enriched-parent-1" }] as never)
    const plan = {
      id: "route-comments",
      routeKey: "route:comments",
      scenarioId: null,
      capability: "READ_EXTERNAL_COMMENTS",
      contentScope: "PUBLIC",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: "proof-bright",
      capabilityProof: {
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-14T00:00:00.000Z"),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        readAllowed: true,
        exportAllowed: true,
        replyAllowed: false,
        sandboxVerifiedAt: null,
      },
      connectionAccountId: null,
      acquisitionMode: "LICENSED_PROVIDER",
      dependsOnCapability: "ENRICH_CONTENT",
      budget: { maxItems: 10, timeoutSeconds: 60 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1")

    expect(result).toMatchObject({ status: "success", runId: "run-comments-persisted-parent" })
    expect(routeAdapterMocks.runBrightDataCollector).toHaveBeenCalledWith(expect.objectContaining({
      routeExecution: expect.objectContaining({
        capability: "READ_EXTERNAL_COMMENTS",
        routePlanId: "route-comments",
      }),
    }))
    expect(vi.mocked(prisma.collectorRun.update)).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawStats: expect.objectContaining({
          routeResults: [expect.objectContaining({
            capability: "READ_EXTERNAL_COMMENTS",
            dependencySatisfiedFromPersistedState: true,
          })],
        }),
      }),
    }))
  })

  it.each(["DISCOVER_POSTS", "ENRICH_CONTENT"])(
    "reconciles a legacy TikTok negative parent before the %s comments gate",
    async (dependsOnCapability) => {
    const providerSource = {
      ...source,
      platform: "tiktok",
      collectionMode: "provider_api",
      settings: { scenarioLinks: [{ subjectId: "subject-active" }] },
    }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : providerSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-comments-tiktok-legacy" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-comments-tiktok-legacy" } as never)
    tikTokRevisitMocks.reconcileForSource.mockResolvedValueOnce({
      subjectIds: ["subject-active"],
      examined: 1,
      created: 1,
    })
    vi.mocked(prisma.tikTokPublicationRevisit.findMany).mockResolvedValueOnce([{ id: "legacy-revisit" }] as never)
    const plan = {
      id: "route-comments-tiktok",
      routeKey: "route:comments:tiktok",
      scenarioId: "scenario-active",
      capability: "READ_EXTERNAL_COMMENTS",
      contentScope: "PUBLIC",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: "proof-bright",
      capabilityProof: {
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-14T00:00:00.000Z"),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        readAllowed: true,
        exportAllowed: true,
        replyAllowed: false,
        sandboxVerifiedAt: null,
      },
      connectionAccountId: null,
      acquisitionMode: "LICENSED_PROVIDER",
      dependsOnCapability,
      budget: { maxItems: 10, timeoutSeconds: 60 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSource(providerSource as MonitoringSourceForRun, {
      manualRun: true,
      onlyCapability: "READ_EXTERNAL_COMMENTS",
      targetScenarioId: "scenario-active",
      targetSubjectId: "subject-active",
    })

    expect(result).toMatchObject({ status: "success", runId: "run-comments-tiktok-legacy" })
    expect(tikTokRevisitMocks.reconcileForSource).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      sourceId: "src-1",
      targetSubjectId: "subject-active",
    }))
    expect(vi.mocked(prisma.tikTokPublicationRevisit.findMany)).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        status: { in: ["ACTIVE", "INACTIVE"] },
        ingestEnvelope: expect.objectContaining({
          relevanceStatus: "ACCEPTED",
          acceptedMention: expect.objectContaining({
            sentiment: "negative",
            subjectMatches: {
              some: { status: "MATCHED", subjectId: { in: ["subject-active"] } },
            },
          }),
        }),
      }),
    }))
    expect(vi.mocked(prisma.tikTokPublicationRevisit.findMany).mock.calls[0][0].where.ingestEnvelope).not.toHaveProperty("sourceId")
    expect(vi.mocked(prisma.tikTokPublicationRevisit.findMany).mock.calls[0][0].where).not.toHaveProperty("nextDueAt")
      expect(routeAdapterMocks.runBrightDataCollector).toHaveBeenCalledWith(expect.objectContaining({
        routeExecution: expect.objectContaining({ capability: "READ_EXTERNAL_COMMENTS" }),
      }))
    },
  )

  it.each(["DISCOVER_POSTS", "ENRICH_CONTENT"])(
    "runs an explicit Apify comments-only route from source-scoped candidates with a %s dependency",
    async (dependsOnCapability) => {
      const providerSource = { ...source, platform: "instagram", collectionMode: "search_index" }
      vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
        args.where?.runClaimToken
          ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
          : providerSource
      ) as never)
      vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
      vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-comments-apify-candidate" } as never)
      vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-comments-apify-candidate" } as never)
      vi.mocked(prisma.ingestEnvelope.findMany).mockResolvedValueOnce([] as never)
      routeAdapterMocks.hasApifyCommentCandidates.mockResolvedValueOnce(true)
      const plan = {
        id: "route-comments-apify",
        routeKey: "route:comments:apify",
        scenarioId: "scenario-a",
        capability: "READ_EXTERNAL_COMMENTS",
        contentScope: "PUBLIC",
        primaryAdapter: "APIFY_ASYNC",
        fallbackAdapters: ["MANUAL_TASK"],
        capabilityProofId: null,
        capabilityProof: null,
        connectionAccountId: null,
        acquisitionMode: "APIFY_FALLBACK",
        dependsOnCapability,
        budget: { maxItems: 10, timeoutSeconds: 60 },
        rateLimit: { maxRequestsPerMinute: 30 },
        circuitOpenUntil: null,
        status: "ACTIVE",
        policyVersion: "social-monitoring-v2-pr2-budget-v1",
      }
      vi.mocked(prisma.sourceRoutePlan.findMany)
        .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
        .mockResolvedValueOnce([plan] as never)

      const result = await runMonitoringSource(providerSource as MonitoringSourceForRun, {
        manualRun: true,
        manualMaxTotalChargeUsd: 1,
        onlyCapability: "READ_EXTERNAL_COMMENTS",
        targetScenarioId: "scenario-a",
        targetSubjectId: "subject-a",
        clientFundedManual: true,
        includeComments: true,
      })

      expect(result).toMatchObject({ status: "success", runId: "run-comments-apify-candidate" })
      expect(routeAdapterMocks.hasApifyCommentCandidates).toHaveBeenCalledWith(expect.objectContaining({ id: "src-1" }))
      expect(routeAdapterMocks.runApifyAsyncCollector).toHaveBeenCalledWith(expect.objectContaining({
        routeExecution: expect.objectContaining({
          capability: "READ_EXTERNAL_COMMENTS",
          routePlanId: "route-comments-apify",
          manualMaxTotalChargeUsd: 0.5,
        }),
      }))
      expect(vi.mocked(prisma.collectorRun.update)).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          rawStats: expect.objectContaining({
            routeResults: [expect.objectContaining({
              capability: "READ_EXTERNAL_COMMENTS",
              dependencySatisfiedFromPersistedState: true,
            })],
          }),
        }),
      }))
    },
  )

  it.each(["DISCOVER_POSTS", "ENRICH_CONTENT"])(
    "keeps %s persisted Apify comment candidates fail-closed for scheduled runs",
    async (dependsOnCapability) => {
      const providerSource = { ...source, platform: "instagram", collectionMode: "search_index" }
      vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
        args.where?.runClaimToken
          ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
          : providerSource
      ) as never)
      vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
      vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-comments-apify-scheduled" } as never)
      vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-comments-apify-scheduled" } as never)
      vi.mocked(prisma.ingestEnvelope.findMany).mockResolvedValueOnce([] as never)
      routeAdapterMocks.hasApifyCommentCandidates.mockResolvedValueOnce(true)
      const plan = {
        id: "route-comments-apify",
        routeKey: "route:comments:apify",
        scenarioId: null,
        capability: "READ_EXTERNAL_COMMENTS",
        contentScope: "PUBLIC",
        primaryAdapter: "APIFY_ASYNC",
        fallbackAdapters: ["MANUAL_TASK"],
        capabilityProofId: null,
        capabilityProof: null,
        connectionAccountId: null,
        acquisitionMode: "APIFY_FALLBACK",
        dependsOnCapability,
        budget: { maxItems: 10, timeoutSeconds: 60 },
        rateLimit: { maxRequestsPerMinute: 30 },
        circuitOpenUntil: null,
        status: "ACTIVE",
        policyVersion: "social-monitoring-v2-pr2-budget-v1",
      }
      vi.mocked(prisma.sourceRoutePlan.findMany)
        .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
        .mockResolvedValueOnce([plan] as never)

      const result = await runMonitoringSource(providerSource as MonitoringSourceForRun)

      expect(result).toMatchObject({ status: "partial", runId: "run-comments-apify-scheduled" })
      expect(routeAdapterMocks.hasApifyCommentCandidates).not.toHaveBeenCalled()
      expect(routeAdapterMocks.runApifyAsyncCollector).not.toHaveBeenCalled()
      expect(vi.mocked(prisma.collectorRun.update)).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          rawStats: expect.objectContaining({
            routeResults: [expect.objectContaining({
              capability: "READ_EXTERNAL_COMMENTS",
              status: "skipped",
              error: "route_dependency_pending",
            })],
          }),
        }),
      }))
    },
  )

  it("keeps a dependent comments route pending when no parent posts are persisted", async () => {
    const providerSource = { ...source, platform: "facebook", collectionMode: "provider_api" }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : providerSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-comments-no-parent" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-comments-no-parent" } as never)
    vi.mocked(prisma.ingestEnvelope.findMany).mockResolvedValueOnce([] as never)
    const plan = {
      id: "route-comments-pending",
      routeKey: "route:comments:pending",
      scenarioId: null,
      capability: "READ_EXTERNAL_COMMENTS",
      contentScope: "PUBLIC",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: ["MANUAL_TASK"],
      capabilityProofId: "proof-bright",
      capabilityProof: {
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-14T00:00:00.000Z"),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        readAllowed: true,
        exportAllowed: true,
        replyAllowed: false,
        sandboxVerifiedAt: null,
      },
      connectionAccountId: null,
      acquisitionMode: "LICENSED_PROVIDER",
      dependsOnCapability: "ENRICH_CONTENT",
      budget: { maxItems: 10, timeoutSeconds: 60 },
      rateLimit: { maxRequestsPerMinute: 30 },
      circuitOpenUntil: null,
      status: "ACTIVE",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1")

    expect(result).toMatchObject({ status: "partial", error: "source_routes_partial_or_pending" })
    expect(routeAdapterMocks.runBrightDataCollector).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.collectorRun.update)).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawStats: expect.objectContaining({
          routeResults: [expect.objectContaining({
            capability: "READ_EXTERNAL_COMMENTS",
            error: "route_dependency_pending",
          })],
        }),
      }),
    }))
  })

  it("audits an expired Bright Data circuit before promoting primary again", async () => {
    const providerSource = { ...source, collectionMode: "provider_api" }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : providerSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-failback" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-failback" } as never)
    const plan = {
      id: "route-failback",
      routeKey: "route:failback",
      scenarioId: null,
      capability: "ENRICH_CONTENT",
      contentScope: "PUBLIC",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: ["APIFY_ASYNC", "MANUAL_TASK"],
      capabilityProofId: "proof-bright",
      capabilityProof: {
        status: "VERIFIED",
        verifiedAt: new Date("2026-07-14T00:00:00.000Z"),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        readAllowed: true,
        exportAllowed: true,
        replyAllowed: false,
        sandboxVerifiedAt: null,
      },
      connectionAccountId: null,
      acquisitionMode: "LICENSED_PROVIDER",
      dependsOnCapability: null,
      budget: { maxItems: 10, timeoutSeconds: 60 },
      rateLimit: { maxRequestsPerMinute: 30, failbackOverlapMinutes: 60 },
      circuitOpenUntil: new Date("2020-01-01T00:00:00.000Z"),
      status: "DEGRADED",
      policyVersion: "social-monitoring-v2-pr2-budget-v1",
    }
    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockResolvedValueOnce([{ routeKey: plan.routeKey, policyVersion: plan.policyVersion }] as never)
      .mockResolvedValueOnce([plan] as never)

    const result = await runMonitoringSourceNow("org-1", "src-1")

    expect(result).toMatchObject({ status: "success", runId: "run-failback" })
    expect(failbackMocks.auditProviderFailback).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      routePlanId: "route-failback",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: ["APIFY_ASYNC", "MANUAL_TASK"],
    }))
    expect(vi.mocked(recordSourceRouteResult)).toHaveBeenCalledWith(
      "org-1",
      "route-failback",
      expect.objectContaining({
        ok: true,
        usedAdapter: "BRIGHT_DATA_SNAPSHOT",
        primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
        primaryAttempted: true,
        failbackReconciled: true,
      }),
    )
  })

  it("fails closed when another worker holds the collector claim", async () => {
    vi.mocked(prisma.monitoringSource.updateMany).mockResolvedValueOnce({ count: 0 } as never)

    const claim = await claimMonitoringSourceRun("org-1", "src-1", new Date("2026-07-05T10:00:00.000Z"))

    expect(claim).toBeNull()
    expect(prisma.monitoringSource.findFirst).not.toHaveBeenCalled()
    expect(prisma.monitoringSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "src-1",
        organizationId: "org-1",
        status: { in: ["active", "limited", "needs_setup"] },
        OR: expect.arrayContaining([{ runClaimToken: null }]),
      }),
      data: expect.objectContaining({ runClaimVersion: { increment: 1 } }),
    }))
  })

  it("fences a worker whose claim was replaced before it can publish source health", async () => {
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 4, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : source
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-fenced" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-fenced" } as never)
    vi.mocked(prisma.monitoringSource.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never) // claim
      .mockResolvedValueOnce({ count: 0 } as never) // fenced source result CAS
      .mockResolvedValueOnce({ count: 0 } as never) // release cannot clear the replacement claim

    const result = await runMonitoringSourceNow("org-1", "src-1")

    expect(result).toMatchObject({
      runId: "run-fenced",
      status: "failed",
      error: "collector_lease_lost",
    })
    expect(prisma.collectorRun.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "run-fenced" },
      data: expect.objectContaining({
        status: "failed",
        error: "collector_lease_lost",
        rawStats: expect.objectContaining({ leaseLost: true, claimVersion: 4 }),
      }),
    }))
  })
})

describe("classifyBusinessDiscoveryFailure", () => {
  const graphBody = (error: Record<string, unknown>) => JSON.stringify({ error })

  it("maps an expired caller token to an auth-class error", () => {
    expect(classifyBusinessDiscoveryFailure(400, graphBody({ code: 190, message: "Error validating access token" })))
      .toBe("business_discovery_oauth_token_invalid")
  })

  it("maps throttling responses to a rate-limit-class error", () => {
    expect(classifyBusinessDiscoveryFailure(429, "")).toBe("business_discovery_rate_limit")
    expect(classifyBusinessDiscoveryFailure(400, graphBody({ code: 4, message: "Application request limit reached" })))
      .toBe("business_discovery_rate_limit")
  })

  it("maps Graph code 10 to a permission-class error even when Meta returns HTTP 400", () => {
    expect(classifyBusinessDiscoveryFailure(400, graphBody({ code: 10, message: "Application does not have permission for this action" })))
      .toBe("official_permission_error")
  })

  it("maps personal/unknown targets to an unsupported-class error so the route fails over", () => {
    expect(classifyBusinessDiscoveryFailure(400, graphBody({ code: 100, error_subcode: 2207013, message: "The account is not a business account" })))
      .toBe("business_discovery_target_unsupported")
    expect(classifyBusinessDiscoveryFailure(400, graphBody({ code: 110, message: "Business discovery user cannot be found" })))
      .toBe("business_discovery_target_unsupported")
  })

  it("falls back to permission/generic errors for everything else", () => {
    expect(classifyBusinessDiscoveryFailure(403, graphBody({ code: 200, message: "Permissions error" })))
      .toBe("official_permission_error")
    expect(classifyBusinessDiscoveryFailure(500, "<html>upstream</html>")).toBe("official_fetch_failed")
  })
})

describe("monitoring route item budget", () => {
  it("keeps a manual run at the configured route maxItems instead of forcing 1,000", () => {
    expect(routeBudgetValues({ maxItems: 75 }, true)).toMatchObject({ maxItems: 75 })
    expect(routeBudgetValues({ maxItems: 50_000 }, true)).toMatchObject({ maxItems: 5_000 })
    expect(routeBudgetValues({ maxItems: 0 }, true)).toMatchObject({ maxItems: 1 })
  })
})

describe("dispatchRouteAdapter Bright Data policy guard", () => {
  function runSource(platform: string): MonitoringSourceForRun {
    return {
      id: `src-${platform}`,
      organizationId: "org-brandprotection",
      platform,
      sourceType: "keyword",
      collectionMode: "search_index",
      status: "active",
      cadenceMinutes: 1440,
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      lastError: null,
      settings: {},
    }
  }

  it.each([
    ["instagram", "DISCOVER_POSTS"],
    ["facebook", "DISCOVER_POSTS"],
    ["tiktok", "DISCOVER_POSTS"],
    ["instagram", "READ_EXTERNAL_COMMENTS"],
    ["facebook", "READ_EXTERNAL_COMMENTS"],
    ["tiktok", "READ_EXTERNAL_COMMENTS"],
  ])(
    "allows the pinned Apify collector for %s %s",
    async (platform, capability) => {
      routeAdapterMocks.runApifyAsyncCollector.mockResolvedValueOnce({
        status: "success", foundCount: 1, newCount: 1, duplicateCount: 0, ignoredCount: 0,
      })
      const result = await dispatchRouteAdapter(runSource(platform), "APIFY_ASYNC", capability)
      expect(routeAdapterMocks.runApifyAsyncCollector).toHaveBeenCalledTimes(1)
      expect(result.status).toBe("success")
    },
  )

  it("still blocks Apify for unrelated Instagram capabilities", async () => {
    const result = await dispatchRouteAdapter(runSource("instagram"), "APIFY_ASYNC", "READ_MEDIA")
    expect(result.error).toBe("apify_excluded_bright_data_only_platform")
    expect(routeAdapterMocks.runApifyAsyncCollector).not.toHaveBeenCalled()
  })

  it("still allows the Apify collector for a generic web source", async () => {
    routeAdapterMocks.runApifyAsyncCollector.mockResolvedValueOnce({
      status: "success", foundCount: 1, newCount: 1, duplicateCount: 0, ignoredCount: 0,
    })
    const result = await dispatchRouteAdapter(runSource("web"), "APIFY_ASYNC")
    expect(routeAdapterMocks.runApifyAsyncCollector).toHaveBeenCalledTimes(1)
    expect(result.status).toBe("success")
  })
})

describe("quota-governed manual run", () => {
  function runnableSourceMocks() {
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : source
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-quota" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-quota" } as never)
    vi.mocked(prisma.monitoringSource.update).mockResolvedValue(source as never)
  }

  it("runs a no-cap scan through the standard path for an enabled tenant, bypassing USD manual authorization", async () => {
    runnableSourceMocks()
    paidAuthorizationMocks.parseTenantPaidRunPolicy.mockReturnValue({ manualRunsEnabled: true, emergencyStopped: false, dailyRunQuota: 3 })
    const result = await runMonitoringSourceNow("org-1", "src-1")
    expect("runId" in result).toBe(true)
    expect(paidAuthorizationMocks.authorizeTenantManualPaidRun).not.toHaveBeenCalled()
  })

  it("turns a free WEB news button run into a 90-day refresh without doing so for paid social", async () => {
    const webSource = {
      ...source,
      platform: "web",
      sourceType: "keyword",
      collectionMode: "search_index",
      query: "Baku Electronics",
    }
    vi.mocked(prisma.monitoringSource.findFirst).mockImplementation(async (args: { where?: { runClaimToken?: string } }) => (
      args.where?.runClaimToken
        ? { runClaimVersion: 1, runClaimExpiresAt: new Date(Date.now() + 15 * 60_000) }
        : webSource
    ) as never)
    vi.mocked(prisma.collectorRun.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-web-news" } as never)
    vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-web-news" } as never)
    vi.mocked(prisma.monitoringSource.update).mockResolvedValue(webSource as never)
    paidAuthorizationMocks.parseTenantPaidRunPolicy.mockReturnValue({
      manualRunsEnabled: true,
      emergencyStopped: false,
      dailyRunQuota: 3,
    })

    const result = await runMonitoringSourceNow("org-1", "src-1")

    expect("runId" in result).toBe(true)
    expect(prisma.collectorRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rawStats: expect.objectContaining({ fullArchiveRun: true }),
      }),
    })
  })

  it("blocks a no-cap scan when the tenant emergency stop is active", async () => {
    vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue(source as never)
    paidAuthorizationMocks.parseTenantPaidRunPolicy.mockReturnValue({ manualRunsEnabled: true, emergencyStopped: true, dailyRunQuota: 3 })
    await expect(runMonitoringSourceNow("org-1", "src-1")).resolves.toEqual({ error: "paid_manual_run_emergency_stopped" })
    expect(prisma.collectorRun.create).not.toHaveBeenCalled()
    expect(paidAuthorizationMocks.authorizeTenantManualPaidRun).not.toHaveBeenCalled()
  })

  it("falls through for a disabled policy so free sources still run without USD authorization", async () => {
    runnableSourceMocks()
    paidAuthorizationMocks.parseTenantPaidRunPolicy.mockReturnValue({ manualRunsEnabled: false, emergencyStopped: true, dailyRunQuota: 0 })
    const result = await runMonitoringSourceNow("org-1", "src-1")
    expect("runId" in result).toBe(true)
    expect(paidAuthorizationMocks.authorizeTenantManualPaidRun).not.toHaveBeenCalled()
  })
})
