import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const metricSnapshot = vi.hoisted(() => ({
  upsert: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: { socialMetricSnapshot: metricSnapshot } }))

import {
  listSocialMetricHistory,
  normalizeSocialMetricSnapshot,
  recordProviderMetricSnapshot,
  recordSocialMetricSnapshot,
} from "@/lib/social/metric-snapshots"
import type { ProviderMetricRecord } from "@/lib/social/provider-capability-contract"

const providerMetric: ProviderMetricRecord = {
  recordType: "METRIC",
  platform: "instagram",
  externalId: "post-1",
  parentUrl: "https://www.instagram.com/p/post-1/?utm_source=test",
  observedAt: "2026-07-14T01:00:00.000Z",
  views: 4_500_000_000,
  likes: 120,
  comments: 19,
  shares: 7,
  reactions: null,
  provenance: {
    providerKey: "BRIGHT_DATA",
    adapterKey: "BRIGHT_DATA_INSTAGRAM_POST",
    providerItemId: "provider-post-1",
    observedAt: "2026-07-14T01:00:00.000Z",
    schemaVersion: "instagram-post-v1",
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  metricSnapshot.upsert.mockResolvedValue({ id: "metric-1" })
  metricSnapshot.findMany.mockResolvedValue([])
})

describe("social metric snapshots", () => {
  it("normalizes non-negative counts as bigint without a 32-bit ceiling", () => {
    expect(normalizeSocialMetricSnapshot({
      organizationId: "org-1",
      platform: "Instagram",
      externalId: "post-1",
      parentUrl: "https://www.instagram.com/p/post-1/?utm_source=test",
      observedAt: "2026-07-14T01:00:00.000Z",
      views: "4500000000",
      comments: 0,
      providerKey: "BRIGHT_DATA",
      adapterKey: "BRIGHT_DATA_INSTAGRAM_POST",
      providerItemId: "provider-post-1",
      schemaVersion: "v1",
    })).toMatchObject({
      platform: "instagram",
      parentUrl: "https://instagram.com/p/post-1",
      views: BigInt("4500000000"),
      comments: BigInt(0),
      likes: null,
    })
  })

  it("persists provider observations idempotently without overwriting history", async () => {
    await recordProviderMetricSnapshot({
      organizationId: "org-1",
      mentionId: "mention-1",
      providerRunId: "run-1",
    }, providerMetric)

    expect(metricSnapshot.upsert).toHaveBeenCalledWith({
      where: {
        organizationId_platform_externalId_providerKey_adapterKey_observedAt: {
          organizationId: "org-1",
          platform: "instagram",
          externalId: "post-1",
          providerKey: "BRIGHT_DATA",
          adapterKey: "BRIGHT_DATA_INSTAGRAM_POST",
          observedAt: new Date("2026-07-14T01:00:00.000Z"),
        },
      },
      update: {},
      create: expect.objectContaining({
        mentionId: "mention-1",
        providerRunId: "run-1",
        parentUrl: "https://instagram.com/p/post-1",
        views: BigInt("4500000000"),
        likes: BigInt(120),
        comments: BigInt(19),
      }),
    })
  })

  it("rejects invalid counters and observations without any metric", async () => {
    const base = {
      organizationId: "org-1",
      platform: "instagram",
      externalId: "post-1",
      parentUrl: "https://instagram.com/p/post-1",
      observedAt: "2026-07-14T01:00:00.000Z",
      providerKey: "BRIGHT_DATA",
      adapterKey: "BRIGHT_DATA_INSTAGRAM_POST",
      providerItemId: "provider-post-1",
      schemaVersion: "v1",
    }
    expect(() => normalizeSocialMetricSnapshot({ ...base, views: -1 })).toThrow("views must be a non-negative safe integer")
    expect(() => normalizeSocialMetricSnapshot({ ...base, views: 1.5 })).toThrow("views must be a non-negative safe integer")
    expect(() => normalizeSocialMetricSnapshot(base)).toThrow("at least one metric is required")
    await expect(recordSocialMetricSnapshot({ ...base, views: Number.MAX_SAFE_INTEGER + 1 }))
      .rejects.toThrow("views must be a non-negative safe integer")
    expect(metricSnapshot.upsert).not.toHaveBeenCalled()
  })

  it("rejects a metric whose provenance timestamp does not identify the same observation", async () => {
    await expect(recordProviderMetricSnapshot({ organizationId: "org-1" }, {
      ...providerMetric,
      provenance: { ...providerMetric.provenance, observedAt: "2026-07-14T01:01:00.000Z" },
    })).rejects.toThrow("metric and provenance observedAt must match")
    expect(metricSnapshot.upsert).not.toHaveBeenCalled()
  })

  it("lists one tenant-scoped history series newest first with a bounded limit", async () => {
    await listSocialMetricHistory({ organizationId: "org-1", platform: "Instagram", externalId: "post-1", limit: 10_000 })
    expect(metricSnapshot.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", platform: "instagram", externalId: "post-1" },
      orderBy: { observedAt: "desc" },
      take: 500,
    })
  })
})

describe("social metric snapshot migration", () => {
  const sql = readFileSync(resolve(
    "prisma/migrations/20260714020000_social_metric_snapshots/migration.sql",
  ), "utf8")

  it("is tenant-forced, constrained, and intentionally avoids synthetic history", () => {
    expect(sql).toContain('ALTER TABLE "social_metric_snapshots" ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE "social_metric_snapshots" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('CREATE POLICY "tenant_isolation" ON "social_metric_snapshots"')
    expect(sql).toContain('social_metric_snapshots_nonnegative_check')
    expect(sql).toContain('social_metric_snapshots_has_metric_check')
    expect(sql).toContain('no data backfill')
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"social_metric_snapshots"/i)
  })
})
