import { beforeEach, describe, expect, it, vi } from "vitest"

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }))

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: queryRaw } }))

import { calculateSocialMonitoringMargin, getSocialMonitoringRollups } from "@/lib/social/monitoring-rollups"

function queryText(index: number): string {
  const query = queryRaw.mock.calls[index]?.[0] as {
    strings?: readonly string[]
    text?: string
    sql?: string
  } | undefined
  return query?.strings?.join("") ?? query?.text ?? query?.sql ?? ""
}

beforeEach(() => {
  vi.clearAllMocks()
  queryRaw
    .mockResolvedValueOnce([
      { surface: "posts", platform: "youtube", count: 3 },
      { surface: "comments", platform: "youtube", count: 8 },
      { surface: "replies", platform: "youtube", count: 2 },
    ])
    .mockResolvedValueOnce([
      {
        providerKey: "apify",
        phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
        runCount: 2,
        receivedCount: 100,
        acceptedCount: 20,
        reviewCount: 3,
        rejectedCount: 77,
        chargeUsd: "4.000000",
      },
    ])
    .mockResolvedValueOnce([
      {
        platform: "instagram",
        capability: "READ_EXTERNAL_COMMENTS",
        acquisitionMode: "APIFY_FALLBACK",
        adapterKey: "APIFY_ASYNC",
        status: "ACTIVE",
        routeCount: 1,
      },
    ])
    .mockResolvedValueOnce([
      {
        day: "2026-07-02",
        unit: "PROVIDER_RUN",
        dimension: "APIFY",
        quantity: "2",
        actualCostUsd: "3.000000",
        reservedExposureUsd: "1.000000",
      },
      {
        day: "2026-07-02",
        unit: "PROVIDER_ITEM",
        dimension: "APIFY",
        quantity: "100",
        actualCostUsd: "0",
        reservedExposureUsd: "0",
      },
      {
        day: "2026-07-03",
        unit: "ACCEPTED_MENTION",
        dimension: "instagram",
        quantity: "20",
        actualCostUsd: "0",
        reservedExposureUsd: "0",
      },
    ])
})

describe("social monitoring SQL rollups", () => {
  it("keeps comments and replies separate and computes provider unit cost", async () => {
    const result = await getSocialMonitoringRollups("org-1", new Date("2026-07-01T00:00:00Z"))

    expect(queryRaw).toHaveBeenCalledTimes(4)
    expect(queryText(0)).toContain('AND "purgedAt" IS NULL')
    expect(queryText(0)).toContain('AND "deletedAtSource" IS NULL')
    expect(queryText(0)).toContain('UPPER("contentKind"::text) IN (\'COMMENT\', \'REPLY\')')
    expect(queryText(0)).toContain('LOWER(BTRIM(COALESCE("sourceType", \'\'))) IN (\'comment\', \'reply\')')
    expect(queryText(0)).toContain("LOWER(BTRIM(COALESCE(sentiment, ''))) IN ('negative', 'neutral')")
    expect(queryText(0)).toContain('AND COALESCE("publishedAt", "createdAt") >=')
    expect(queryText(0)).toContain('AND "createdAt" >=')
    expect(queryText(1)).toContain('AND "purgedAt" IS NULL')
    expect(queryText(3).match(/AND "purgedAt" IS NULL/g)).toHaveLength(3)
    expect(queryText(3)).toContain('AND COALESCE("publishedAt", "createdAt") >=')
    expect(queryText(3)).toContain('AND "createdAt" >=')
    expect(queryText(3)).toContain("action = 'reset_boundary'")
    expect(queryText(3)).toContain('"entityType" = \'social_paid_run_authorization\'')
    expect(queryText(3)).toContain('boundary."userId" IS NULL')
    expect(queryText(3)).toContain(
      'boundary."entityName" = \'Social Monitoring clean slate\'',
    )
    expect(queryText(3)).toContain('boundary."entityId" LIKE \'clean-slate:%\'')
    expect(result.surfaces).toEqual({ posts: 3, comments: 8, replies: 2, other: 0 })
    expect(result.surfaceByPlatform).toEqual([
      { platform: "youtube", posts: 3, comments: 8, replies: 2, other: 0 },
    ])
    expect(result.providerCosts[0]).toMatchObject({ chargeUsd: 4, acceptedCount: 20, costPerAcceptedUsd: 0.2 })
    expect(result.coverage[0]).toMatchObject({ adapterKey: "APIFY_ASYNC", status: "ACTIVE" })
    expect(result.usage.totals).toEqual({
      quantities: { PROVIDER_RUN: 2, PROVIDER_ITEM: 100, ACCEPTED_MENTION: 20 },
      actualCostUsd: 3,
      reservedExposureUsd: 1,
      maximumCostExposureUsd: 4,
    })
    expect(result.usage.daily).toHaveLength(2)
    expect(result.usage.monthly).toEqual([expect.objectContaining({
      period: "2026-07",
      actualCostUsd: 3,
      reservedExposureUsd: 1,
    })])
    expect(result.usage.margin).toMatchObject({ status: "UNCONFIGURED", reason: "owner_rate_card_required" })
    expect(result.usage.measurementGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ unit: "STORAGE_GB_DAY", status: "UNAVAILABLE" }),
      expect.objectContaining({ unit: "RETENTION_GB_DAY", status: "UNAVAILABLE" }),
    ]))
  })
})

describe("social monitoring margin calculator", () => {
  it("does not invent a price or a usage scenario", () => {
    expect(calculateSocialMonitoringMargin({ ACCEPTED_MENTION: 10 }, 2, 1)).toEqual({
      status: "UNCONFIGURED",
      reason: "owner_rate_card_required",
      currency: "USD",
      scenarios: [],
    })
  })

  it("uses only owner-supplied revenue rates and scenario multipliers", () => {
    const result = calculateSocialMonitoringMargin(
      { ACCEPTED_MENTION: 100, PROVIDER_RUN: 2 },
      20,
      5,
      {
        currency: "USD",
        monthlyBaseRevenueUsd: 50,
        unitRevenueUsd: { ACCEPTED_MENTION: 0.5, PROVIDER_RUN: 5 },
        scenarioMultipliers: { low: 0.5, base: 1, high: 2 },
      },
    )

    expect(result.status).toBe("CONFIGURED")
    expect(result.scenarios).toEqual([
      expect.objectContaining({ name: "low", revenueUsd: 80, actualCostUsd: 10, maximumCostExposureUsd: 12.5, grossMarginUsd: 70 }),
      expect.objectContaining({ name: "base", revenueUsd: 110, actualCostUsd: 20, maximumCostExposureUsd: 25, grossMarginUsd: 90 }),
      expect.objectContaining({ name: "high", revenueUsd: 170, actualCostUsd: 40, maximumCostExposureUsd: 50, grossMarginUsd: 130 }),
    ])
  })

  it("rejects negative owner configuration", () => {
    expect(calculateSocialMonitoringMargin({}, 0, 0, {
      currency: "USD",
      monthlyBaseRevenueUsd: -1,
      unitRevenueUsd: {},
      scenarioMultipliers: { low: 1, base: 1, high: 1 },
    })).toMatchObject({ status: "INVALID_CONFIGURATION" })
  })
})
