import { beforeEach, describe, expect, it, vi } from "vitest"

const withTenantFence = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiAlert: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    monitoringSource: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    collectorRun: {
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: withTenantFence,
}))

import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import {
  evaluateSocialCoverageAlertRules,
  filterDuplicateCoverageAlertCandidates,
  writeSocialCoverageAlerts,
} from "@/lib/social/coverage-alerts"
import { evaluateSocialCoverageSloRules, runSocialCoverageSloChecks } from "@/lib/social/coverage-slo"

const findAlerts = vi.mocked(prisma.aiAlert.findMany)
const createAlert = vi.mocked(prisma.aiAlert.create)
const findSources = vi.mocked(prisma.monitoringSource.findMany)
const updateSources = vi.mocked(prisma.monitoringSource.updateMany)
const findRuns = vi.mocked(prisma.collectorRun.findMany)
const findUsers = vi.mocked(prisma.user.findMany)

beforeEach(() => {
  vi.clearAllMocks()
  withTenantFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true as const, value: await collect() }))
  findAlerts.mockResolvedValue([])
  createAlert.mockResolvedValue({ id: "alert-1" })
  findSources.mockResolvedValue([])
  updateSources.mockResolvedValue({ count: 0 })
  findRuns.mockResolvedValue([])
  findUsers.mockResolvedValue([])
  vi.mocked(createNotification).mockResolvedValue(undefined as never)
})

describe("social coverage alerts", () => {
  it("emits source failure, lead intent, VIP, competitor, repeated complaint, and negative spike rules", () => {
    const candidates = evaluateSocialCoverageAlertRules({
      sources: [
        { id: "src-1", platform: "instagram", sourceType: "hashtag", collectionMode: "search_index", status: "limited", lastError: "rate_limited" },
      ],
      mentions: [
        {
          id: "m-1",
          platform: "facebook",
          text: "Complaint wave",
          sentiment: "negative",
          sourceType: "competitor",
          sourceMetadata: { socialTriage: { leadIntent: true, complaint: true, relevanceScore: 91 } },
          matchedTerm: "competitor",
          reach: 15000,
          engagement: 600,
          cluster: { id: "cluster-1", mentionCount: 4, topic: "complaint", riskLevel: "high" },
        },
        { id: "m-2", platform: "facebook", text: "Bad", sentiment: "negative", sourceMetadata: {}, reach: 0, engagement: 0 },
        { id: "m-3", platform: "facebook", text: "Bad again", sentiment: "negative", sourceMetadata: {}, reach: 0, engagement: 0 },
      ],
    })

    expect(candidates.map((item) => item.rule)).toEqual(expect.arrayContaining([
      "source_failure",
      "lead_intent",
      "vip_author",
      "competitor_mention",
      "repeated_complaint",
      "negative_spike",
    ]))
  })

  it("filters duplicate candidates by dedupe key", () => {
    const candidates = evaluateSocialCoverageAlertRules({
      sources: [{ id: "src-1", platform: "instagram", sourceType: "hashtag", collectionMode: "search_index", status: "blocked", lastError: null }],
      mentions: [],
    })

    const fresh = filterDuplicateCoverageAlertCandidates(candidates, [
      { metadata: { dedupeKey: candidates[0].dedupeKey } },
    ])

    expect(fresh).toHaveLength(0)
  })

  it("writes only fresh alerts", async () => {
    const candidates = evaluateSocialCoverageAlertRules({
      sources: [{ id: "src-1", platform: "instagram", sourceType: "hashtag", collectionMode: "search_index", status: "blocked", lastError: null }],
      mentions: [],
    })

    const count = await writeSocialCoverageAlerts("org-1", candidates, new Date("2026-07-05T10:00:00.000Z"))

    expect(count).toBe(1)
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        type: "social_coverage_rule",
        metadata: expect.objectContaining({
          rule: "source_failure",
          dedupeKey: candidates[0].dedupeKey,
        }),
      }),
    }))
  })

  it("does not read or write coverage alerts while the tenant fence is closed", async () => {
    withTenantFence.mockResolvedValue({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })
    const candidates = evaluateSocialCoverageAlertRules({
      sources: [{ id: "src-1", platform: "instagram", sourceType: "hashtag", collectionMode: "search_index", status: "blocked", lastError: null }],
      mentions: [],
    })

    const count = await writeSocialCoverageAlerts("org-1", candidates)

    expect(count).toBe(0)
    expect(findAlerts).not.toHaveBeenCalled()
    expect(createAlert).not.toHaveBeenCalled()
  })

  it("emits SLO alerts for stale, repeated failures, zero results, provider errors, and rejection spikes", () => {
    const now = new Date("2026-07-18T12:00:00.000Z")
    const candidates = evaluateSocialCoverageSloRules([{
      id: "src-slo",
      organizationId: "org-1",
      platform: "youtube",
      sourceType: "comments",
      status: "active",
      lastSuccessfulAt: new Date("2026-07-16T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-18T11:00:00.000Z"),
      recentRuns: [
        { status: "failed", startedAt: now, error: "youtube_rate_limited", foundCount: 0 },
        { status: "failed", startedAt: now, error: "youtube_rate_limited", foundCount: 0 },
        { status: "success", startedAt: now, error: null, foundCount: 0, rawStats: { rejectionReasonHistogram: { total: 12 } } },
        { status: "success", startedAt: now, error: null, foundCount: 0, rawStats: { rejectionReasonHistogram: { total: 15 } } },
        { status: "success", startedAt: now, error: null, foundCount: 0 },
      ],
    }], now)

    expect(candidates.map(item => item.rule)).toEqual(expect.arrayContaining([
      "stale_source",
      "provider_status_failure",
      "rejection_spike",
    ]))
    const zeroCandidates = evaluateSocialCoverageSloRules([{
      id: "src-zero",
      organizationId: "org-1",
      platform: "instagram",
      sourceType: "hashtag",
      status: "active",
      lastSuccessfulAt: now,
      recentRuns: [
        { status: "success", foundCount: 0 },
        { status: "success", foundCount: 0 },
        { status: "success", foundCount: 0 },
      ],
    }], now)
    expect(zeroCandidates.map(item => item.rule)).toContain("unexpected_zero_results")
  })

  it("does not treat explicitly manual-only discovery as automatic coverage debt", () => {
    const manualDebt = {
      organizationId: "org-1",
      status: "limited",
      lastSuccessfulAt: null,
      lastCheckedAt: new Date("2026-07-18T11:00:00.000Z"),
      recentRuns: [
        { status: "partial", error: "paid_route_daily_budget_exhausted" },
        { status: "partial", error: "paid_route_daily_budget_exhausted" },
        { status: "partial", error: "paid_route_daily_budget_exhausted" },
      ],
    }
    const candidates = evaluateSocialCoverageSloRules([{
      ...manualDebt,
      id: "src-selective-manual-only",
      platform: "tiktok",
      sourceType: "keyword",
      settings: { selectiveDiscovery: { liveRoutingAllowed: false } },
    }, {
      ...manualDebt,
      id: "src-policy-manual-only",
      platform: "instagram",
      sourceType: "profile",
      settings: { collectionPolicy: { automaticCollectionAllowed: false, manualOnly: true } },
    }], new Date("2026-07-18T12:00:00.000Z"))

    expect(candidates).toEqual([])
  })

  it("does not treat runtime-ineligible paid-only routes as automatic coverage debt", () => {
    const candidates = evaluateSocialCoverageSloRules([{
      id: "src-paid-only",
      organizationId: "org-1",
      platform: "web",
      sourceType: "keyword",
      status: "limited",
      lastSuccessfulAt: null,
      lastCheckedAt: new Date("2026-07-18T11:00:00.000Z"),
      automaticCollectionEligible: false,
      recentRuns: [
        { status: "partial", error: "paid_route_budget_unconfigured" },
        { status: "partial", error: "paid_route_budget_unconfigured" },
        { status: "partial", error: "paid_route_budget_unconfigured" },
      ],
    }], new Date("2026-07-18T12:00:00.000Z"))

    expect(candidates).toEqual([])
  })

  it("clears provider failure alerts after a successful recovery run", () => {
    const now = new Date("2026-07-18T12:00:00.000Z")
    const candidates = evaluateSocialCoverageSloRules([{
      id: "src-recovered",
      organizationId: "org-1",
      platform: "youtube",
      sourceType: "keyword",
      status: "active",
      lastSuccessfulAt: now,
      recentRuns: [
        { status: "success", startedAt: now, error: null, foundCount: 1 },
        { status: "success", startedAt: now, error: null, foundCount: 0 },
        { status: "success", startedAt: now, error: null, foundCount: 0 },
        { status: "partial", startedAt: now, error: "youtube_rate_limited:rateLimitExceeded", foundCount: 0 },
        { status: "partial", startedAt: now, error: "youtube_rate_limited:rateLimitExceeded", foundCount: 0 },
      ],
    }], now)

    expect(candidates.map(item => item.rule)).not.toContain("provider_status_failure")
  })

  it("runs SLO checks tenant-scoped and writes fresh candidates", async () => {
    findSources.mockResolvedValue([{
      id: "src-1",
      organizationId: "org-1",
      platform: "youtube",
      sourceType: "comments",
      status: "active",
      lastSuccessfulAt: new Date("2026-07-16T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-18T11:00:00.000Z"),
      lastError: null,
    }])
    findRuns.mockResolvedValue([
      { sourceId: "src-1", status: "failed", startedAt: new Date("2026-07-18T11:00:00.000Z"), finishedAt: null, error: "youtube_rate_limited", foundCount: 0, rawStats: {} },
      { sourceId: "src-1", status: "failed", startedAt: new Date("2026-07-18T10:00:00.000Z"), finishedAt: null, error: "youtube_rate_limited", foundCount: 0, rawStats: {} },
      { sourceId: "src-1", status: "failed", startedAt: new Date("2026-07-18T09:00:00.000Z"), finishedAt: null, error: "youtube_rate_limited", foundCount: 0, rawStats: {} },
    ])
    const result = await runSocialCoverageSloChecks({
      organizationId: "org-1",
      now: new Date("2026-07-18T12:00:00.000Z"),
    })

    expect(result.evaluated).toBeGreaterThan(0)
    expect(findSources).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-1" } }))
    expect(findRuns).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", sourceId: { in: ["src-1"] } }) }))
    expect(createAlert).toHaveBeenCalled()
  })

  it("does not read, notify, or revive SLO state while the tenant fence is closed", async () => {
    withTenantFence.mockResolvedValue({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    const result = await runSocialCoverageSloChecks({
      organizationId: "org-1",
      now: new Date("2026-07-18T12:00:00.000Z"),
    })

    expect(result).toEqual({
      evaluated: 0,
      created: 0,
      revived: 0,
      notifiedAdmins: 0,
      candidates: [],
    })
    expect(findSources).not.toHaveBeenCalled()
    expect(findRuns).not.toHaveBeenCalled()
    expect(findAlerts).not.toHaveBeenCalled()
    expect(createAlert).not.toHaveBeenCalled()
    expect(findUsers).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
    expect(updateSources).not.toHaveBeenCalled()
  })

  it("re-reads a bounded global source scope inside each tenant fence", async () => {
    findSources
      .mockResolvedValueOnce([
        { id: "src-1", organizationId: "org-1" },
        { id: "src-2", organizationId: "org-2" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await runSocialCoverageSloChecks({
      now: new Date("2026-07-18T12:00:00.000Z"),
    })

    expect(result.evaluated).toBe(0)
    expect(findSources).toHaveBeenNthCalledWith(1, {
      select: { id: true, organizationId: true },
      take: 500,
    })
    expect(withTenantFence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(withTenantFence).toHaveBeenCalledWith("org-2", expect.any(Function))
    expect(findSources).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { organizationId: "org-1", id: { in: ["src-1"] } },
    }))
    expect(findSources).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: { organizationId: "org-2", id: { in: ["src-2"] } },
    }))
  })

  it("revives config-starved sources and notifies admins about new coverage alerts", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z")
    findSources.mockResolvedValue([
      {
        // Starved by a config error, parked by backoff 21h ago → revive.
        id: "src-starved",
        organizationId: "org-1",
        platform: "facebook",
        sourceType: "profile",
        status: "limited",
        lastSuccessfulAt: new Date("2026-07-16T00:00:00.000Z"),
        lastCheckedAt: new Date("2026-07-17T15:00:00.000Z"),
        lastError: "paid_route_budget_unconfigured",
      },
      {
        // Real provider failure → NOT revived (keeps its backoff).
        id: "src-provider",
        organizationId: "org-1",
        platform: "youtube",
        sourceType: "comments",
        status: "active",
        lastSuccessfulAt: new Date("2026-07-16T00:00:00.000Z"),
        lastCheckedAt: new Date("2026-07-17T15:00:00.000Z"),
        lastError: "youtube_rate_limited",
      },
      {
        // Config error but checked 10 minutes ago → wait, no revive churn.
        id: "src-recent",
        organizationId: "org-1",
        platform: "tiktok",
        sourceType: "keyword",
        status: "active",
        lastSuccessfulAt: new Date("2026-07-16T00:00:00.000Z"),
        lastCheckedAt: new Date("2026-07-18T11:50:00.000Z"),
        lastError: "paid_route_daily_budget_exhausted",
      },
    ])
    updateSources.mockResolvedValue({ count: 1 })
    findUsers.mockResolvedValue([{ id: "admin-1" }, { id: "manager-1" }])

    const result = await runSocialCoverageSloChecks({ organizationId: "org-1", now })

    expect(updateSources).toHaveBeenCalledTimes(1)
    const updateArgs = updateSources.mock.calls[0][0]
    expect(updateArgs.where).toMatchObject({ id: { in: ["src-starved"] }, organizationId: "org-1" })
    expect(result.revived).toBe(1)

    // stale_source alerts were freshly written → both admins get pinged.
    expect(result.created).toBeGreaterThan(0)
    expect(result.notifiedAdmins).toBe(2)
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      userId: "admin-1",
      push: true,
      awaitPush: true,
      kind: "social.coverage",
    }))
  })

  it("waits for coverage notifications before releasing the SLO run", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z")
    findSources.mockResolvedValue([{
      id: "src-1",
      organizationId: "org-1",
      platform: "youtube",
      sourceType: "comments",
      status: "active",
      lastSuccessfulAt: new Date("2026-07-16T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-18T11:00:00.000Z"),
      lastError: null,
    }])
    findUsers.mockResolvedValue([{ id: "admin-1" }])
    let releaseNotification!: () => void
    const notificationPending = new Promise<void>((resolve) => {
      releaseNotification = resolve
    })
    vi.mocked(createNotification).mockReturnValue(notificationPending as never)

    let settled = false
    const run = runSocialCoverageSloChecks({ organizationId: "org-1", now })
      .finally(() => {
        settled = true
      })
    await vi.waitFor(() => expect(createNotification).toHaveBeenCalledTimes(1))

    expect(settled).toBe(false)
    releaseNotification()
    const result = await run

    expect(settled).toBe(true)
    expect(result.notifiedAdmins).toBe(1)
  })

  it("does not notify when every alert is a 24h duplicate", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z")
    findSources.mockResolvedValue([{
      id: "src-1",
      organizationId: "org-1",
      platform: "youtube",
      sourceType: "comments",
      status: "active",
      lastSuccessfulAt: new Date("2026-07-16T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-18T11:00:00.000Z"),
      lastError: null,
    }])
    findAlerts.mockResolvedValue([
      { metadata: { dedupeKey: `stale_source:src-1:24h` } },
    ])

    const result = await runSocialCoverageSloChecks({ organizationId: "org-1", now })

    expect(result.created).toBe(0)
    expect(result.notifiedAdmins).toBe(0)
    expect(createNotification).not.toHaveBeenCalled()
  })
})
