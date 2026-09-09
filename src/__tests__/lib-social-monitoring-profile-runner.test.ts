import { describe, expect, it, vi } from "vitest"
import {
  canResumeMonitoringProfileRun,
  createMonitoringProfileRunResumeContext,
  mergeMonitoringCollectorAndProviderResult,
  monitoringCollectorResultHasPendingProvider,
  monitoringCollectorPendingProviderRunIds,
  monitoringProfileSourcesForPlatform,
  monitoringProfileSourceRunCounts,
  runMonitoringProfileSources,
  summarizeMonitoringProfileRunPlatforms,
  summarizeMonitoringProviderRuns,
  type MonitoringProfileRunProgress,
  type MonitoringProfileRunSource,
} from "@/lib/social/monitoring-profile-runner"

function source(
  id: string,
  isActive = true,
  platform = "instagram",
): MonitoringProfileRunSource {
  return {
    id,
    platform,
    label: `source-${id}`,
    status: isActive ? "active" : "paused",
    isActive,
  }
}

describe("monitoringProfileSourcesForPlatform", () => {
  const sources = [
    source("facebook-1", true, "facebook"),
    source("facebook-1", true, "facebook"),
    source("instagram-1", true, "instagram"),
    source("youtube-paused", false, "youtube"),
    source("web-rss", true, "WEB"),
    source("web-direct", true, "web"),
  ]

  it("returns only active, deduplicated sources for the selected platform", () => {
    expect(monitoringProfileSourcesForPlatform(sources, "facebook").map(item => item.id))
      .toEqual(["facebook-1"])
    expect(monitoringProfileSourcesForPlatform(sources, "youtube")).toEqual([])
    expect(monitoringProfileSourcesForPlatform(sources, "web").map(item => item.id))
      .toEqual(["web-rss", "web-direct"])
  })

  it("keeps every active platform when all sources are requested", () => {
    expect(monitoringProfileSourcesForPlatform(sources, "all").map(item => item.id))
      .toEqual(["facebook-1", "instagram-1", "web-rss", "web-direct"])
  })
})

describe("monitoring profile resume identity", () => {
  const now = new Date("2026-07-28T12:00:00.000Z")
  const resumeContext = createMonitoringProfileRunResumeContext({
    scenarioId: "scenario-1",
    profileRevision: "revision-1",
    sourceIds: ["source-2", "source-1"],
    now: new Date("2026-07-28T11:00:00.000Z"),
  })
  const progress: MonitoringProfileRunProgress = {
    phase: "stopped",
    total: 2,
    attempted: 1,
    succeeded: 1,
    partial: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    found: 1,
    accepted: 1,
    review: 0,
    rejected: 0,
    duplicates: 0,
    sourceResults: [{
      sourceId: "source-1",
      platform: "instagram",
      label: "Instagram",
      status: "success",
      found: 1,
      accepted: 1,
      review: 0,
      rejected: 0,
      duplicates: 0,
      limitations: [],
    }],
    current: null,
    lastIssue: null,
    resumeContext,
  }

  it("resumes only the same recent scenario, profile revision, and source queue", () => {
    expect(canResumeMonitoringProfileRun({
      progress,
      scenarioId: "scenario-1",
      profileRevision: "revision-1",
      sourceIds: ["source-1", "source-2"],
      now,
    })).toBe(true)

    for (const changed of [
      { scenarioId: "scenario-2", profileRevision: "revision-1", sourceIds: ["source-1", "source-2"] },
      { scenarioId: "scenario-1", profileRevision: "revision-2", sourceIds: ["source-1", "source-2"] },
      { scenarioId: "scenario-1", profileRevision: "revision-1", sourceIds: ["source-1", "source-3"] },
    ]) {
      expect(canResumeMonitoringProfileRun({ progress, ...changed, now })).toBe(false)
    }
  })

  it("does not treat stale, unidentified, or provider-pending progress as a resumable queue", () => {
    const legacyProgress = { ...progress }
    delete legacyProgress.resumeContext
    expect(canResumeMonitoringProfileRun({
      progress,
      scenarioId: "scenario-1",
      profileRevision: "revision-1",
      sourceIds: ["source-1", "source-2"],
      now: new Date("2026-07-30T12:00:00.000Z"),
    })).toBe(false)
    expect(canResumeMonitoringProfileRun({
      progress: legacyProgress,
      scenarioId: "scenario-1",
      profileRevision: "revision-1",
      sourceIds: ["source-1", "source-2"],
      now,
    })).toBe(false)
    expect(canResumeMonitoringProfileRun({
      progress: { ...progress, phase: "completed_with_pending" },
      scenarioId: "scenario-1",
      profileRevision: "revision-1",
      sourceIds: ["source-1", "source-2"],
      now,
    })).toBe(false)
  })

  it("resumes an identified provider wait without accepting an ambiguous current source", () => {
    const providerWaitProgress: MonitoringProfileRunProgress = {
      ...progress,
      current: {
        id: "source-2",
        platform: "facebook",
        label: "Facebook",
        index: 2,
        stage: "provider_wait",
        preview: {
          found: 0,
          accepted: 0,
          review: 0,
          rejected: 0,
          duplicates: 0,
        },
        providerWait: {
          providerRunIds: ["provider-run-1"],
          collectorResult: {
            status: "pending",
            foundCount: 0,
            newCount: 0,
            duplicateCount: 0,
          },
        },
      },
    }
    expect(canResumeMonitoringProfileRun({
      progress: providerWaitProgress,
      scenarioId: "scenario-1",
      profileRevision: "revision-1",
      sourceIds: ["source-1", "source-2"],
      now,
    })).toBe(true)
    expect(canResumeMonitoringProfileRun({
      progress: {
        ...providerWaitProgress,
        current: {
          ...providerWaitProgress.current!,
          stage: "starting",
          providerWait: undefined,
        },
      },
      scenarioId: "scenario-1",
      profileRevision: "revision-1",
      sourceIds: ["source-1", "source-2"],
      now,
    })).toBe(false)
  })
})

describe("runMonitoringProfileSources", () => {
  it("deduplicates active sources, runs strictly sequentially, and aggregates counts", async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const order: string[] = []
    const progress: number[] = []

    const result = await runMonitoringProfileSources({
      sources: [source("one"), source("one"), source("paused", false), source("two")],
      onProgress: current => progress.push(current.attempted),
      runSource: async current => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        order.push(current.id)
        await Promise.resolve()
        concurrent -= 1
        return {
          status: "success",
          foundCount: 3,
          newCount: 2,
          duplicateCount: 1,
        }
      },
    })

    expect(order).toEqual(["one", "two"])
    expect(maxConcurrent).toBe(1)
    expect(result).toMatchObject({
      phase: "completed",
      total: 2,
      attempted: 2,
      succeeded: 2,
      found: 6,
      accepted: 4,
      review: 0,
      rejected: 0,
      duplicates: 2,
    })
    expect(result.sourceResults).toHaveLength(2)
    expect(progress).toContain(0)
    expect(progress.at(-1)).toBe(2)
  })

  it("continues after a source exception and never treats an unknown status as success", async () => {
    const runSource = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        status: "mystery",
        foundCount: Number.NaN,
        newCount: -4,
        duplicateCount: Number.POSITIVE_INFINITY,
      })

    const result = await runMonitoringProfileSources({
      sources: [source("one"), source("two")],
      runSource,
    })

    expect(runSource).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      phase: "completed_with_issues",
      attempted: 2,
      succeeded: 0,
      failed: 2,
      found: 0,
      accepted: 0,
      review: 0,
      rejected: 0,
      duplicates: 0,
    })
  })

  it("stops before the first source when requested", async () => {
    const runSource = vi.fn()
    const result = await runMonitoringProfileSources({
      sources: [source("one")],
      shouldStop: () => true,
      runSource,
    })

    expect(runSource).not.toHaveBeenCalled()
    expect(result).toMatchObject({ phase: "stopped", total: 1, attempted: 0 })
  })

  it("lets the current source finish and prevents the next source from starting", async () => {
    let stop = false
    const order: string[] = []
    const result = await runMonitoringProfileSources({
      sources: [source("one"), source("two")],
      shouldStop: () => stop,
      runSource: async current => {
        order.push(current.id)
        stop = true
        return { status: "success", foundCount: 1, newCount: 1, duplicateCount: 0 }
      },
    })

    expect(order).toEqual(["one"])
    expect(result).toMatchObject({ phase: "stopped", total: 2, attempted: 1 })
  })

  it("continues an interrupted queue without rerunning completed sources", async () => {
    let stop = false
    const firstPass = await runMonitoringProfileSources({
      sources: [source("one"), source("two")],
      shouldStop: () => stop,
      runSource: async current => {
        stop = current.id === "one"
        return { status: "success", foundCount: 1, newCount: 1, duplicateCount: 0 }
      },
    })
    const resumedSources: string[] = []

    const resumed = await runMonitoringProfileSources({
      sources: [source("two")],
      initialProgress: firstPass,
      runSource: async current => {
        resumedSources.push(current.id)
        return { status: "success", foundCount: 2, newCount: 1, duplicateCount: 1 }
      },
    })

    expect(resumedSources).toEqual(["two"])
    expect(resumed).toMatchObject({
      phase: "completed",
      total: 2,
      attempted: 2,
      succeeded: 2,
      found: 3,
      accepted: 2,
      duplicates: 1,
    })
    expect(resumed.sourceResults.map(result => result.sourceId)).toEqual(["one", "two"])
  })

  it("keeps an identified pending provider run as a resumable current source", async () => {
    const stages: string[] = []
    const providerRunIds: string[][] = []
    const result = await runMonitoringProfileSources({
      sources: [source("one")],
      onProgress: progress => {
        if (progress.current) {
          stages.push(progress.current.stage)
          if (progress.current.providerWait) {
            providerRunIds.push(progress.current.providerWait.providerRunIds)
          }
        }
      },
      runSource: async (_current, setStage, _setPreview, setProviderWait) => {
        setProviderWait(["provider-1", "provider-1"], {
          status: "pending",
          foundCount: 0,
          newCount: 0,
          duplicateCount: 0,
        })
        setStage("provider_wait")
        return { status: "pending", foundCount: 0, newCount: 0, duplicateCount: 0 }
      },
    })

    expect(stages).toEqual(expect.arrayContaining(["starting", "provider_wait"]))
    expect(providerRunIds).toContainEqual(["provider-1"])
    expect(result).toMatchObject({
      phase: "stopped",
      attempted: 0,
      pending: 0,
      succeeded: 0,
      sourceResults: [],
      current: {
        id: "one",
        stage: "provider_wait",
        providerWait: {
          providerRunIds: ["provider-1"],
          collectorResult: {
            status: "pending",
          },
        },
      },
    })
  })

  it("polls the exact persisted provider source first, then continues the queue", async () => {
    const firstPass = await runMonitoringProfileSources({
      sources: [source("one"), source("two")],
      runSource: async (current, _setStage, _setPreview, setProviderWait) => {
        expect(current.id).toBe("one")
        setProviderWait(["provider-one"], {
          status: "pending",
          foundCount: 2,
          newCount: 0,
          duplicateCount: 0,
        })
        return {
          status: "pending",
          foundCount: 2,
          newCount: 0,
          duplicateCount: 0,
        }
      },
    })
    const resumedOrder: string[] = []

    const resumed = await runMonitoringProfileSources({
      // Deliberately put the next source first. The persisted current source
      // must still be polled before any other source can be dispatched.
      sources: [source("two"), source("one")],
      initialProgress: firstPass,
      runSource: async current => {
        resumedOrder.push(current.id)
        return current.id === "one"
          ? {
              status: "success",
              foundCount: 4,
              newCount: 3,
              duplicateCount: 1,
            }
          : {
              status: "success",
              foundCount: 2,
              newCount: 1,
              duplicateCount: 1,
            }
      },
    })

    expect(resumedOrder).toEqual(["one", "two"])
    expect(resumed).toMatchObject({
      phase: "completed",
      total: 2,
      attempted: 2,
      succeeded: 2,
      pending: 0,
      found: 6,
      accepted: 4,
      duplicates: 2,
      current: null,
    })
    expect(resumed.sourceResults.map(result => result.sourceId)).toEqual(["one", "two"])
  })

  it("does not dispatch another source when the persisted provider source is absent", async () => {
    const initial = await runMonitoringProfileSources({
      sources: [source("one"), source("two")],
      runSource: async (_current, _setStage, _setPreview, setProviderWait) => {
        setProviderWait(["provider-one"], {
          status: "pending",
          foundCount: 0,
          newCount: 0,
          duplicateCount: 0,
        })
        return {
          status: "pending",
          foundCount: 0,
          newCount: 0,
          duplicateCount: 0,
        }
      },
    })
    const runSource = vi.fn()

    const result = await runMonitoringProfileSources({
      sources: [source("two")],
      initialProgress: initial,
      runSource,
    })

    expect(runSource).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      phase: "stopped",
      attempted: 0,
      current: {
        id: "one",
        providerWait: {
          providerRunIds: ["provider-one"],
        },
      },
    })
  })

  it("preserves the provider checkpoint when polling throws", async () => {
    const initial = await runMonitoringProfileSources({
      sources: [source("one"), source("two")],
      runSource: async (_current, _setStage, _setPreview, setProviderWait) => {
        setProviderWait(["provider-one"], {
          status: "pending",
          foundCount: 0,
          newCount: 0,
          duplicateCount: 0,
        })
        return {
          status: "pending",
          foundCount: 0,
          newCount: 0,
          duplicateCount: 0,
        }
      },
    })

    const result = await runMonitoringProfileSources({
      sources: [source("one"), source("two")],
      initialProgress: initial,
      runSource: async () => {
        throw new Error("provider_poll_timeout")
      },
    })

    expect(result).toMatchObject({
      phase: "stopped",
      attempted: 0,
      failed: 0,
      pending: 0,
      sourceResults: [],
      current: {
        id: "one",
        stage: "provider_wait",
        providerWait: {
          providerRunIds: ["provider-one"],
        },
      },
      lastIssue: {
        sourceId: "one",
        error: "provider_poll_timeout",
      },
    })
  })

  it("publishes provider snapshots before the current source completes", async () => {
    const liveCounts: Array<{ attempted: number; found: number; review: number }> = []
    const result = await runMonitoringProfileSources({
      sources: [source("one")],
      onProgress: progress => {
        liveCounts.push({
          attempted: progress.attempted,
          found: progress.found + (progress.current?.preview.found ?? 0),
          review: progress.review + (progress.current?.preview.review ?? 0),
        })
      },
      runSource: async (_current, setStage, setPreview) => {
        setStage("provider_wait")
        setPreview({
          status: "pending",
          foundCount: 50,
          newCount: 0,
          reviewCount: 47,
          rejectedCount: 3,
          duplicateCount: 0,
        })
        return {
          status: "success",
          foundCount: 50,
          newCount: 0,
          reviewCount: 47,
          rejectedCount: 3,
          duplicateCount: 0,
        }
      },
    })

    expect(liveCounts).toContainEqual({ attempted: 0, found: 50, review: 47 })
    expect(result).toMatchObject({
      attempted: 1,
      found: 50,
      review: 47,
      rejected: 3,
    })
  })

  it("does not start the next source while a provider remains pending", async () => {
    const runSource = vi.fn().mockResolvedValue({
      status: "pending",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
    })

    const result = await runMonitoringProfileSources({
      sources: [source("one"), source("two")],
      runSource,
    })

    expect(runSource).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      phase: "completed_with_pending",
      attempted: 1,
      pending: 1,
    })
  })

  it("halts after an ambiguous paid-source exception", async () => {
    const runSource = vi.fn().mockRejectedValue(new Error("network_timeout"))
    const paidSource = { ...source("paid"), paid: true }

    const result = await runMonitoringProfileSources({
      sources: [paidSource, source("free")],
      runSource,
    })

    expect(runSource).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      phase: "completed_with_pending",
      attempted: 1,
      failed: 0,
      pending: 1,
    })
  })
})

describe("provider progress helpers", () => {
  it("detects nested queued route results", () => {
    expect(monitoringCollectorResultHasPendingProvider({
      status: "partial",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      rawStats: { routeResults: [{ providerStatus: "RUNNING", queued: true }] },
    })).toBe(true)
  })

  it("extracts bounded provider ids from nested collector stats", () => {
    expect(monitoringCollectorPendingProviderRunIds({
      status: "partial",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      rawStats: {
        routeResults: [
          { providerRunId: "provider-a" },
          { nested: { providerRunId: "provider-b" } },
          { providerRunId: "provider-a" },
        ],
      },
    })).toEqual(["provider-a", "provider-b"])
  })

  it("keeps active provider work pending and summarizes terminal counts", () => {
    expect(summarizeMonitoringProviderRuns([{
      status: "RUNNING",
      receivedCount: 0,
      acceptedCount: 0,
      reviewCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
    }]).status).toBe("pending")

    expect(summarizeMonitoringProviderRuns([
      {
        status: "IMPORTED",
        receivedCount: 8,
        acceptedCount: 5,
        reviewCount: 1,
        rejectedCount: 0,
        duplicateCount: 2,
      },
      {
        status: "PARTIAL",
        receivedCount: 4,
        acceptedCount: 2,
        reviewCount: 0,
        rejectedCount: 1,
        duplicateCount: 1,
        lastError: "schema_degraded",
      },
    ])).toMatchObject({
      status: "partial",
      foundCount: 12,
      newCount: 7,
      acceptedCount: 7,
      reviewCount: 1,
      rejectedCount: 1,
      duplicateCount: 3,
      error: "schema_degraded",
    })
  })

  it("treats a successful paid-route ledger wrapper as terminal", () => {
    expect(summarizeMonitoringProviderRuns([{
      phase: "PAID_ROUTE_COLLECTION",
      status: "SUCCEEDED",
      receivedCount: 10,
      acceptedCount: 8,
      reviewCount: 0,
      rejectedCount: 1,
      duplicateCount: 1,
    }])).toMatchObject({
      status: "success",
      foundCount: 10,
      newCount: 8,
      rejectedCount: 1,
      duplicateCount: 1,
    })
  })

  it("keeps a lone running paid-route ledger wrapper pending", () => {
    expect(summarizeMonitoringProviderRuns([{
      phase: "PAID_ROUTE_COLLECTION",
      status: "RUNNING",
      receivedCount: 0,
      acceptedCount: 0,
      reviewCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
    }]).status).toBe("pending")
  })

  it("excludes paid-route ledger wrappers when concrete provider rows exist", () => {
    expect(summarizeMonitoringProviderRuns([
      {
        phase: "PAID_ROUTE_COLLECTION",
        status: "RUNNING",
        receivedCount: 10,
        acceptedCount: 10,
        reviewCount: 0,
        rejectedCount: 0,
        duplicateCount: 0,
      },
      {
        phase: "DISCOVER_CANDIDATE_POSTS",
        status: "IMPORTED",
        receivedCount: 10,
        acceptedCount: 7,
        reviewCount: 1,
        rejectedCount: 1,
        duplicateCount: 1,
      },
      {
        phase: "ENRICH_CANDIDATE_POSTS",
        status: "IMPORTED",
        receivedCount: 4,
        acceptedCount: 2,
        reviewCount: 0,
        rejectedCount: 1,
        duplicateCount: 1,
      },
    ])).toMatchObject({
      status: "success",
      foundCount: 14,
      newCount: 9,
      reviewCount: 1,
      rejectedCount: 2,
      duplicateCount: 2,
    })
  })

  it("keeps a concrete succeeded provider snapshot pending even with a terminal wrapper", () => {
    expect(summarizeMonitoringProviderRuns([
      {
        phase: "PAID_ROUTE_COLLECTION",
        status: "SUCCEEDED",
        receivedCount: 0,
        acceptedCount: 0,
        reviewCount: 0,
        rejectedCount: 0,
        duplicateCount: 0,
      },
      {
        phase: "DISCOVER_CANDIDATE_POSTS",
        status: "SUCCEEDED",
        receivedCount: 10,
        acceptedCount: 0,
        reviewCount: 0,
        rejectedCount: 0,
        duplicateCount: 0,
      },
    ]).status).toBe("pending")
  })

  it("merges provider counts without hiding collector limitations", () => {
    expect(mergeMonitoringCollectorAndProviderResult({
      status: "partial",
      foundCount: 3,
      newCount: 2,
      duplicateCount: 1,
      error: "synchronous_route_failed",
      runId: "collector-a",
    }, {
      status: "success",
      foundCount: 8,
      newCount: 5,
      duplicateCount: 2,
    })).toMatchObject({
      status: "partial",
      foundCount: 11,
      newCount: 7,
      acceptedCount: 7,
      reviewCount: 0,
      rejectedCount: 0,
      duplicateCount: 3,
      error: "synchronous_route_failed",
      runId: "collector-a",
    })
  })

  it("keeps an all-failed provider outcome failed instead of softening it to partial", () => {
    expect(mergeMonitoringCollectorAndProviderResult({
      status: "success",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      runId: "collector-a",
    }, {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      error: "provider_rejected",
    })).toMatchObject({
      status: "failed",
      error: "provider_rejected",
      runId: "collector-a",
    })
  })

  it("keeps accepted, review, invalid, and duplicate provider outcomes separate", () => {
    const provider = summarizeMonitoringProviderRuns([
      {
        status: "IMPORTED",
        receivedCount: 280,
        acceptedCount: 0,
        reviewCount: 280,
        rejectedCount: 0,
        duplicateCount: 0,
      },
      {
        status: "PARTIAL",
        receivedCount: 33,
        acceptedCount: 0,
        reviewCount: 0,
        rejectedCount: 33,
        duplicateCount: 0,
        lastError: "apify_schema_drift_threshold",
      },
    ])

    expect(monitoringProfileSourceRunCounts(provider)).toEqual({
      found: 313,
      accepted: 0,
      review: 280,
      rejected: 33,
      duplicates: 0,
    })
    expect(provider.newCount).toBe(0)
    expect(provider.limitations).toEqual(["apify_schema_drift_threshold"])
  })

  it("builds truthful live totals by platform and source", async () => {
    const web = {
      ...source("web"),
      platform: "web",
      label: "Baku Electronics",
    }
    const youtube = {
      ...source("youtube"),
      platform: "youtube",
      label: "Baku Electronics",
    }
    const result = await runMonitoringProfileSources({
      sources: [web, youtube],
      runSource: async current => current.id === "web"
        ? {
            status: "partial",
            foundCount: 313,
            newCount: 0,
            acceptedCount: 0,
            reviewCount: 280,
            rejectedCount: 33,
            duplicateCount: 0,
            error: "apify_schema_drift_threshold",
          }
        : {
            status: "success",
            foundCount: 3,
            newCount: 0,
            acceptedCount: 0,
            reviewCount: 0,
            rejectedCount: 0,
            duplicateCount: 3,
          },
    })

    expect(result).toMatchObject({
      phase: "completed_with_issues",
      found: 316,
      accepted: 0,
      review: 280,
      rejected: 33,
      duplicates: 3,
    })
    expect(summarizeMonitoringProfileRunPlatforms(result.sourceResults)).toEqual([
      expect.objectContaining({
        platform: "web",
        found: 313,
        accepted: 0,
        review: 280,
        rejected: 33,
        duplicates: 0,
        issueCount: 1,
      }),
      expect.objectContaining({
        platform: "youtube",
        found: 3,
        accepted: 0,
        review: 0,
        rejected: 0,
        duplicates: 3,
        issueCount: 0,
      }),
    ])
  })

  it("continues to the direct WEB source when the RSS source succeeds with an empty feed", async () => {
    const rss = {
      ...source("web-rss"),
      platform: "web",
      label: "Google Alerts RSS · Baku Electronics",
    }
    const direct = {
      ...source("web-direct"),
      platform: "web",
      label: "Baku Electronics",
    }
    const runSource = vi.fn(async (current: MonitoringProfileRunSource) => current.id === "web-rss"
      ? {
          status: "success",
          foundCount: 0,
          newCount: 0,
          duplicateCount: 0,
          ignoredCount: 0,
          rawStats: { emptyFeed: true },
        }
      : {
          status: "success",
          foundCount: 2,
          newCount: 1,
          duplicateCount: 1,
          ignoredCount: 0,
        })

    const result = await runMonitoringProfileSources({
      sources: [rss, direct],
      runSource,
    })

    expect(runSource.mock.calls.map(([current]) => current.id))
      .toEqual(["web-rss", "web-direct"])
    expect(result).toMatchObject({
      phase: "completed",
      total: 2,
      attempted: 2,
      succeeded: 2,
      found: 2,
      accepted: 1,
      duplicates: 1,
    })
    expect(result.sourceResults.map(item => item.sourceId))
      .toEqual(["web-rss", "web-direct"])
  })

  it("separates review rows from other ignored collector rows", () => {
    expect(monitoringProfileSourceRunCounts({
      status: "partial",
      foundCount: 10,
      newCount: 2,
      duplicateCount: 1,
      ignoredCount: 7,
      rawStats: {
        rejectionReasonHistogram: {
          byStatus: { REVIEW: 5, REJECTED: 2 },
        },
      },
    })).toEqual({
      found: 10,
      accepted: 2,
      review: 5,
      rejected: 2,
      duplicates: 1,
    })
  })
})
