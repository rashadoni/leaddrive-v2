import { describe, expect, it } from "vitest"
import {
  archiveProviderCursorKey,
  providerFetchWatermarkForResult,
  resolveArchiveProviderWindow,
  scenarioArchiveStartAtForSource,
  shouldAdvanceMonitoringRouteProviderCursor,
  withArchiveProviderCursorOverlap,
} from "@/lib/social/archive-provider-window"

describe("archive-first provider window", () => {
  const now = new Date("2026-07-14T08:00:00.000Z")

  it("starts after the last paid query watermark instead of repeating the default lookback", () => {
    const window = resolveArchiveProviderWindow({
      searchIndex: { fetchAfter: "2026-07-12T05:30:00.000Z" },
    }, now, 24)

    expect(window.since.toISOString()).toBe("2026-07-12T05:30:00.000Z")
    expect(window.until).toEqual(now)
    expect(window.resumedFromWatermark).toBe(true)
    expect(window.clamped).toBe(false)
  })

  it("caps an old uncollected gap at the provider maximum", () => {
    const window = resolveArchiveProviderWindow({
      searchIndex: { fetchAfter: "2026-01-01T00:00:00.000Z" },
    }, now, 24, 24 * 30)

    expect(window.since.toISOString()).toBe("2026-06-14T08:00:00.000Z")
    expect(window.clamped).toBe(true)
  })

  it("keeps independent cursors for each route and provider", () => {
    const window = resolveArchiveProviderWindow({
      searchIndex: {
        fetchAfter: "2026-07-12T05:30:00.000Z",
        routeProviderCursors: {
          "route-a:APIFY_ASYNC": {
            fetchAfter: "2026-07-14T06:45:00.000Z",
          },
          "route-a:BRIGHT_DATA_SNAPSHOT": {
            fetchAfter: "2026-07-14T07:15:00.000Z",
          },
        },
      },
    }, now, 24, 24 * 30, {
      scope: { routePlanId: "route-a", adapterKey: "APIFY_ASYNC" },
    })

    expect(window.since.toISOString()).toBe("2026-07-14T06:45:00.000Z")
    expect(window.resumedFromWatermark).toBe(true)
  })

  it("ignores the scheduled cursor during an explicit full run", () => {
    const window = resolveArchiveProviderWindow({
      searchIndex: {
        routeProviderCursors: {
          "route-a:APIFY_ASYNC": {
            fetchAfter: "2026-07-14T07:15:00.000Z",
          },
        },
      },
    }, now, 24, 24 * 30, {
      scope: { routePlanId: "route-a", adapterKey: "APIFY_ASYNC" },
      ignoreWatermark: true,
    })

    expect(window.since.toISOString()).toBe("2026-07-13T08:00:00.000Z")
    expect(window.resumedFromWatermark).toBe(false)
  })

  it("uses the scenario start initially, then its scoped successful-run checkpoint", () => {
    const settings = {
      scenarioLinks: [
        { scenarioId: "scenario-old", archiveStartAt: "2025-01-01T00:00:00.000Z" },
        { scenarioId: "scenario-target", archiveStartAt: "2026-04-01T09:30:00.000Z" },
      ],
      searchIndex: {
        fetchAfter: "2026-07-14T07:15:00.000Z",
      },
    }
    const startAt = scenarioArchiveStartAtForSource(settings, "scenario-target")
    const archiveScope = {
      routePlanId: "route-a",
      adapterKey: "APIFY_ASYNC",
      fullArchiveRun: true,
      targetScenarioId: "scenario-target",
      archiveStartAt: startAt,
    }
    const window = resolveArchiveProviderWindow(settings, now, 24, 24 * 30, {
      scope: archiveScope,
      archiveStartAt: startAt,
    })

    expect(startAt?.toISOString()).toBe("2026-04-01T09:30:00.000Z")
    expect(window.since.toISOString()).toBe("2026-04-01T09:30:00.000Z")
    expect(window.resumedFromWatermark).toBe(false)
    expect(window.clamped).toBe(false)

    const resumed = resolveArchiveProviderWindow({
      ...settings,
      searchIndex: {
        ...settings.searchIndex,
        routeProviderCursors: {
          [archiveProviderCursorKey(archiveScope)]: { fetchAfter: "2026-07-14T07:30:00.000Z" },
        },
      },
    }, now, 24, 24 * 30, {
      scope: archiveScope,
      archiveStartAt: startAt,
    })
    expect(resumed.since.toISOString()).toBe("2026-07-14T07:30:00.000Z")
    expect(withArchiveProviderCursorOverlap(resumed, 5, startAt).since.toISOString())
      .toBe("2026-07-14T07:25:00.000Z")
  })

  it("uses the authoritative scenario date without source links and preserves the repeat cursor", () => {
    const settings = {
      scenarioLinks: [],
      searchIndex: {
        // The scheduled cursor must not shorten an explicit archive run.
        fetchAfter: "2026-07-14T07:15:00.000Z",
      },
    }
    const startAt = scenarioArchiveStartAtForSource(
      settings,
      "scenario-target",
      "2026-07-01T00:00:00.000Z",
    )
    const archiveScope = {
      routePlanId: "route-a",
      adapterKey: "APIFY_ASYNC",
      fullArchiveRun: true,
      targetScenarioId: "scenario-target",
      archiveStartAt: startAt,
    }
    const firstRun = resolveArchiveProviderWindow(settings, now, 24, 24 * 30, {
      scope: archiveScope,
      archiveStartAt: startAt,
    })

    expect(startAt?.toISOString()).toBe("2026-07-01T00:00:00.000Z")
    expect(firstRun.since.toISOString()).toBe("2026-07-01T00:00:00.000Z")
    expect(firstRun.resumedFromWatermark).toBe(false)

    const repeatRun = resolveArchiveProviderWindow({
      ...settings,
      searchIndex: {
        ...settings.searchIndex,
        routeProviderCursors: {
          [archiveProviderCursorKey(archiveScope)]: {
            fetchAfter: "2026-07-14T07:30:00.000Z",
          },
        },
      },
    }, now, 24, 24 * 30, {
      scope: archiveScope,
      archiveStartAt: startAt,
    })

    expect(repeatRun.since.toISOString()).toBe("2026-07-14T07:30:00.000Z")
    expect(repeatRun.resumedFromWatermark).toBe(true)
    expect(withArchiveProviderCursorOverlap(repeatRun, 5, startAt).since.toISOString())
      .toBe("2026-07-14T07:25:00.000Z")
  })

  it("treats an authoritative null as no lower bound instead of using a stale source link", () => {
    expect(scenarioArchiveStartAtForSource({
      scenarioLinks: [{
        scenarioId: "scenario-target",
        archiveStartAt: "2025-01-01T00:00:00.000Z",
      }],
    }, "scenario-target", null)).toBeNull()
  })

  it("advances a complete explicit run so the next run is incremental", () => {
    const fetchAfter = new Date("2026-07-14T07:15:00.000Z")

    expect(shouldAdvanceMonitoringRouteProviderCursor({
      fetchAfter,
      adapterKey: "APIFY_ASYNC",
      fullArchiveRun: false,
    })).toBe(true)
    expect(shouldAdvanceMonitoringRouteProviderCursor({
      fetchAfter,
      adapterKey: "APIFY_ASYNC",
      fullArchiveRun: true,
    })).toBe(true)
  })

  it("adds a bounded overlap only when resuming from a persisted watermark", () => {
    const resumed = resolveArchiveProviderWindow({
      searchIndex: { fetchAfter: "2026-07-14T07:00:00.000Z" },
    }, now, 24)
    const firstRun = resolveArchiveProviderWindow({}, now, 24)

    expect(withArchiveProviderCursorOverlap(resumed).since.toISOString()).toBe("2026-07-14T06:55:00.000Z")
    expect(withArchiveProviderCursorOverlap(firstRun).since.toISOString()).toBe("2026-07-13T08:00:00.000Z")
  })

  it("never overlaps a repeat run before the scenario archive lower bound", () => {
    const archiveStartAt = new Date("2026-07-14T06:58:00.000Z")
    const archiveScope = {
      routePlanId: "route-a",
      adapterKey: "APIFY_ASYNC",
      fullArchiveRun: true,
      targetScenarioId: "scenario-target",
      archiveStartAt,
    }
    const resumed = resolveArchiveProviderWindow({
      searchIndex: {
        routeProviderCursors: {
          [archiveProviderCursorKey(archiveScope)]: { fetchAfter: "2026-07-14T07:00:00.000Z" },
        },
      },
    }, now, 24, 24 * 30, {
      scope: archiveScope,
      archiveStartAt,
    })
    expect(withArchiveProviderCursorOverlap(resumed, 5, archiveStartAt).since.toISOString())
      .toBe("2026-07-14T06:58:00.000Z")
  })

  it("keeps scheduled and manual archive checkpoints in separate namespaces", () => {
    const scheduled = archiveProviderCursorKey({
      routePlanId: "route-a",
      adapterKey: "APIFY_ASYNC",
    })
    const firstArchive = archiveProviderCursorKey({
      routePlanId: "route-a",
      adapterKey: "APIFY_ASYNC",
      fullArchiveRun: true,
      targetScenarioId: "scenario-target",
      archiveStartAt: "2026-04-01T09:30:00.000Z",
    })
    const editedArchive = archiveProviderCursorKey({
      routePlanId: "route-a",
      adapterKey: "APIFY_ASYNC",
      fullArchiveRun: true,
      targetScenarioId: "scenario-target",
      archiveStartAt: "2026-05-01T09:30:00.000Z",
    })
    const otherScenario = archiveProviderCursorKey({
      routePlanId: "route-a",
      adapterKey: "APIFY_ASYNC",
      fullArchiveRun: true,
      targetScenarioId: "scenario-other",
      archiveStartAt: "2026-04-01T09:30:00.000Z",
    })

    expect(scheduled).toBe("route-a:APIFY_ASYNC")
    expect(new Set([scheduled, firstArchive, editedArchive, otherScenario]).size).toBe(4)
    expect(firstArchive).toContain(":1775035800000:")
  })

  it("does not advance the watermark for queued async runs", () => {
    expect(providerFetchWatermarkForResult({
      collectionMode: "search_index",
      status: "success",
      rawStats: { queued: true, until: now.toISOString() },
      finishedAt: now,
    })).toBeNull()
  })

  it("does not substitute collector finish time when a reused provider window is unknown", () => {
    expect(providerFetchWatermarkForResult({
      collectionMode: "search_index",
      status: "success",
      rawStats: {
        providerStatus: "IMPORTED",
        reusedFreshDiscovery: true,
        cursorAdvanceSuppressed: true,
      },
      finishedAt: now,
    })).toBeNull()
  })

  it("advances only complete successful packages", () => {
    const explicit = providerFetchWatermarkForResult({
      collectionMode: "search_index",
      status: "success",
      rawStats: { until: "2026-07-14T07:59:00.000Z" },
      finishedAt: now,
    })
    const partial = providerFetchWatermarkForResult({
      collectionMode: "search_index",
      status: "partial",
      rawStats: { providerImported: true },
      finishedAt: now,
    })
    const sampled = providerFetchWatermarkForResult({
      collectionMode: "provider_api",
      status: "success",
      rawStats: { providerImported: true, coverageClass: "SAMPLED" },
      finishedAt: now,
    })
    const imported = providerFetchWatermarkForResult({
      collectionMode: "provider_api",
      status: "success",
      rawStats: { providerImported: true, coverageClass: "COMPLETE_FOR_INPUT" },
      finishedAt: now,
    })
    const official = providerFetchWatermarkForResult({
      collectionMode: "official_api",
      status: "success",
      rawStats: { until: "2026-07-14T07:58:00.000Z", coverageClass: "COMPLETE_FOR_INPUT" },
      finishedAt: now,
    })

    expect(explicit?.toISOString()).toBe("2026-07-14T07:59:00.000Z")
    expect(partial).toBeNull()
    expect(sampled).toBeNull()
    expect(imported).toEqual(now)
    expect(official?.toISOString()).toBe("2026-07-14T07:58:00.000Z")
  })
})
