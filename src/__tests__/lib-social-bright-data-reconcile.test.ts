import { describe, expect, it, vi } from "vitest"
import type { BrightDataProgress } from "@/lib/social/bright-data-client"
import type { MonitoringCollectorResult } from "@/lib/social/monitoring-collector"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialProviderRun: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))
vi.mock("@/lib/social/bright-data-adapter", () => ({
  brightDataProviderCapability: (capability: string) => capability === "DISCOVER_POSTS" ? "DISCOVER_URLS" : null,
  brightDataArchiveContextFromSnapshot: (value: unknown) => (
    value && typeof value === "object"
      ? (value as { leadDriveArchiveContext?: unknown }).leadDriveArchiveContext ?? null
      : null
  ),
  importBrightDataSnapshotRows: vi.fn(),
}))

import {
  recordBrightDataImportedOutcome,
  recordBrightDataImportRetry,
  reconcileBrightDataProviderRuns,
  type BrightDataReconcileDependencies,
  type BrightDataRecoveryRun,
} from "@/lib/social/bright-data-reconcile"

const NOW = new Date("2026-07-21T22:00:00.000Z")

const priceSnapshot = {
  id: "bright-data-account-2026-07-13-payg-1.50-per-1k",
  effectiveAt: "2026-07-13T00:00:00.000Z",
  usdPerThousandRecords: 1.5,
  sourceUrl: "https://brightdata.com/cp/billing/overview",
}

function recoveryRun(overrides: Partial<BrightDataRecoveryRun> = {}): BrightDataRecoveryRun {
  return {
    id: "provider-run-1",
    organizationId: "org-1",
    sourceId: "source-1",
    routePlanId: "route-1",
    collectorRunId: "collector-1",
    providerKey: "bright-data",
    adapterKey: "BRIGHT_DATA_SNAPSHOT",
    phase: "DISCOVER_CANDIDATE_POSTS",
    status: "RUNNING",
    externalRunId: "s_existing_snapshot",
    inputSnapshot: {
      platform: "instagram",
      capability: "DISCOVER_URLS",
      targetCount: 1,
      requestedLimitPerInput: 10,
      manualRun: false,
    },
    reservedChargeUsd: 100,
    maxItems: 10,
    timeoutSeconds: 900,
    createdAt: new Date("2026-07-21T09:00:00.000Z"),
    updatedAt: new Date("2026-07-21T09:00:01.000Z"),
    source: {
      id: "source-1",
      organizationId: "org-1",
      platform: "instagram",
      sourceType: "profile",
      url: "https://www.instagram.com/example",
      handle: "example",
      query: null,
      ownership: "external",
      collectionMode: "search_index",
      status: "limited",
      cadenceMinutes: 360,
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      lastError: null,
      settings: {},
      keywords: ["example"],
    },
    routePlan: {
      capability: "DISCOVER_POSTS",
      acquisitionMode: "LICENSED_PROVIDER",
    },
    ...overrides,
  }
}

function dependencies(run: BrightDataRecoveryRun) {
  const billableTrigger = vi.fn()
  const billableScrape = vi.fn()
  const client = {
    progress: vi.fn(async (): Promise<BrightDataProgress> => ({
      snapshotId: run.externalRunId!,
      datasetId: "gd_existing",
      status: "ready" as const,
    })),
    download: vi.fn(async () => [{ id: "provider-row-1" }]),
    // These spies are deliberately outside the read-client interface. If the
    // reconciler ever reaches for a billable method, this regression fails.
    trigger: billableTrigger,
    scrape: billableScrape,
  }
  const deps: BrightDataReconcileDependencies = {
    now: () => NOW,
    apiToken: vi.fn(() => "read-token-never-logged"),
    priceSnapshot: () => ({ status: "READY", snapshot: priceSnapshot }),
    createReadClient: vi.fn(() => client),
    findRuns: vi.fn(async () => [run]),
    claimReady: vi.fn(async () => true),
    markRemoteFailed: vi.fn(async () => true),
    markMissingSnapshotFailed: vi.fn(async () => true),
    recordRetry: vi.fn(async () => undefined),
    recordImportedOutcome: vi.fn(async () => undefined),
    advanceCursor: vi.fn(async () => 1),
    runPostImportWithinFence: vi.fn(async (_run, persist) => ({
      allowed: true as const,
      value: await persist(),
    })),
    importRows: vi.fn(async (): Promise<MonitoringCollectorResult> => ({
      status: "success",
      foundCount: 1,
      newCount: 1,
      duplicateCount: 0,
      ignoredCount: 0,
      error: null,
      rawStats: { providerStatus: "IMPORTED", providerRequestDispatched: false },
    })),
  }
  return { deps, client, billableTrigger, billableScrape }
}

describe("Bright Data snapshot reconciliation", () => {
  it("records only newly created mentions as accepted after import", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.socialProviderRun.updateMany).mockResolvedValue({ count: 1 })

    await recordBrightDataImportedOutcome(
      recoveryRun(),
      {
        status: "success",
        foundCount: 290,
        newCount: 39,
        duplicateCount: 251,
        ignoredCount: 0,
      },
    )

    expect(prisma.socialProviderRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          acceptedCount: 39,
          duplicateCount: 251,
          rejectedCount: 0,
          lastError: null,
        },
      }),
    )
  })

  it("releases a failed import lease for the next reconciliation poll", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.socialProviderRun.updateMany).mockResolvedValueOnce({ count: 1 })
    const run = recoveryRun({ status: "IMPORTING" })

    await recordBrightDataImportRetry(run, "bright_data_reconcile_failed")

    expect(prisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "provider-run-1",
        organizationId: "org-1",
        providerKey: "bright-data",
        adapterKey: "BRIGHT_DATA_SNAPSHOT",
        purgedAt: null,
        status: "IMPORTING",
      },
      data: {
        status: "RUNNING",
        lastError: "bright_data_reconcile_failed",
      },
    })
  })

  it("imports a ready existing snapshot without any trigger or scrape call", async () => {
    const run = recoveryRun()
    const { deps, client, billableTrigger, billableScrape } = dependencies(run)

    await expect(reconcileBrightDataProviderRuns(5, deps)).resolves.toEqual([{
      id: "provider-run-1",
      status: "IMPORTED",
      foundCount: 1,
      newCount: 1,
      duplicateCount: 0,
      ignoredCount: 0,
    }])

    expect(client.progress).toHaveBeenCalledWith("s_existing_snapshot")
    expect(deps.claimReady).toHaveBeenCalledOnce()
    expect(client.download).toHaveBeenCalledWith("s_existing_snapshot")
    expect(deps.importRows).toHaveBeenCalledWith(expect.objectContaining({
      providerRunId: "provider-run-1",
      capability: "DISCOVER_URLS",
      requestedMaxRecords: 10,
      requestedLimitPerInput: 10,
      reservedChargeUsd: 100,
      providerRequestDispatched: false,
    }))
    expect(deps.recordImportedOutcome).toHaveBeenCalledOnce()
    expect(deps.runPostImportWithinFence).toHaveBeenCalledOnce()
    expect(billableTrigger).not.toHaveBeenCalled()
    expect(billableScrape).not.toHaveBeenCalled()
  })

  it("preserves the frozen per-input ceiling when recovery target cardinality may have changed", async () => {
    const run = recoveryRun({
      maxItems: 99,
      inputSnapshot: {
        platform: "tiktok",
        capability: "READ_COMMENTS",
        targetCount: 3,
        requestedLimitPerInput: 20,
        manualRun: false,
      },
      source: {
        ...recoveryRun().source,
        platform: "tiktok",
      },
      routePlan: {
        capability: "READ_COMMENTS",
        acquisitionMode: "LICENSED_PROVIDER",
      },
    })
    const { deps } = dependencies(run)

    await reconcileBrightDataProviderRuns(5, deps)

    expect(deps.importRows).toHaveBeenCalledWith(expect.objectContaining({
      requestedMaxRecords: 60,
      requestedLimitPerInput: 20,
    }))
  })

  it("does not restore imported outcome or cursor after clean-slate wins the post-import fence", async () => {
    const run = recoveryRun()
    const { deps } = dependencies(run)
    vi.mocked(deps.runPostImportWithinFence).mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    await expect(reconcileBrightDataProviderRuns(5, deps)).resolves.toEqual([{
      id: "provider-run-1",
      status: "STALE",
      error: "social_monitoring_collection_blocked",
    }])

    expect(deps.importRows).toHaveBeenCalledOnce()
    expect(deps.recordImportedOutcome).not.toHaveBeenCalled()
    expect(deps.advanceCursor).not.toHaveBeenCalled()
  })

  it("reuses the frozen archive scope and advances only its manual scenario cursor", async () => {
    const archiveContext = {
      fullArchiveRun: true,
      targetScenarioId: "scenario-1",
      archiveStartAt: "2026-07-01T00:00:00.000Z",
      cursorSince: "2026-07-20T12:00:00.000Z",
      since: "2026-07-20T11:55:00.000Z",
      until: "2026-07-21T21:30:00.000Z",
      resumedFromWatermark: true,
      overlapMinutes: 5,
    }
    const run = recoveryRun({
      inputSnapshot: {
        platform: "instagram",
        capability: "DISCOVER_URLS",
        targetCount: 1,
        requestedLimitPerInput: 10,
        manualRun: true,
        leadDriveFullArchiveRun: true,
        leadDriveTargetScenarioId: "scenario-1",
        leadDriveArchiveStartAt: archiveContext.archiveStartAt,
        leadDriveArchiveContext: archiveContext,
      },
    })
    const { deps } = dependencies(run)
    vi.mocked(deps.importRows).mockResolvedValueOnce({
      status: "success",
      foundCount: 1,
      newCount: 1,
      duplicateCount: 0,
      ignoredCount: 0,
      rawStats: {
        providerStatus: "IMPORTED",
        providerImported: true,
        coverageClass: "COMPLETE_FOR_INPUT",
        until: archiveContext.until,
      },
    })

    await reconcileBrightDataProviderRuns(5, deps)

    expect(deps.importRows).toHaveBeenCalledWith(expect.objectContaining({
      archiveContext,
      source: expect.objectContaining({
        routeExecution: expect.objectContaining({
          manualPaidRun: true,
          fullArchiveRun: true,
          targetScenarioId: "scenario-1",
        }),
      }),
    }))
    expect(deps.advanceCursor).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceId: "source-1",
      routePlanId: "route-1",
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      fullArchiveRun: true,
      targetScenarioId: "scenario-1",
      archiveStartAt: "2026-07-01T00:00:00.000Z",
      until: new Date("2026-07-21T21:30:00.000Z"),
      reason: "bright_data_route_package_imported",
    })
  })

  it("does not advance the archive cursor for a sampled import", async () => {
    const run = recoveryRun({
      inputSnapshot: {
        platform: "instagram",
        capability: "DISCOVER_URLS",
        targetCount: 1,
        requestedLimitPerInput: 10,
        manualRun: true,
        leadDriveArchiveContext: {
          fullArchiveRun: true,
          targetScenarioId: "scenario-1",
          archiveStartAt: "2026-07-01T00:00:00.000Z",
          cursorSince: "2026-07-01T00:00:00.000Z",
          since: "2026-07-01T00:00:00.000Z",
          until: "2026-07-21T21:30:00.000Z",
          resumedFromWatermark: false,
          overlapMinutes: 0,
        },
      },
    })
    const { deps } = dependencies(run)
    vi.mocked(deps.importRows).mockResolvedValueOnce({
      status: "success",
      foundCount: 10,
      newCount: 10,
      duplicateCount: 0,
      ignoredCount: 0,
      rawStats: {
        providerStatus: "IMPORTED",
        providerImported: true,
        coverageClass: "SAMPLED",
        until: "2026-07-21T21:30:00.000Z",
      },
    })

    await reconcileBrightDataProviderRuns(5, deps)

    expect(deps.advanceCursor).not.toHaveBeenCalled()
  })

  it("leaves a remote running snapshot pending and does not claim or download it", async () => {
    const run = recoveryRun()
    const { deps, client } = dependencies(run)
    client.progress.mockResolvedValueOnce({
      snapshotId: "s_existing_snapshot",
      datasetId: "gd_existing",
      status: "running",
    })

    await expect(reconcileBrightDataProviderRuns(5, deps)).resolves.toEqual([{
      id: "provider-run-1",
      status: "PENDING",
    }])
    expect(deps.claimReady).not.toHaveBeenCalled()
    expect(client.download).not.toHaveBeenCalled()
  })

  it("releases an old pre-snapshot reservation without provider I/O", async () => {
    const run = recoveryRun({ externalRunId: null })
    const { deps, client } = dependencies(run)
    vi.mocked(deps.apiToken).mockReturnValueOnce(null)

    await expect(reconcileBrightDataProviderRuns(5, deps)).resolves.toEqual([{
      id: "provider-run-1",
      status: "FAILED",
      error: "bright_data_snapshot_id_missing",
    }])
    expect(deps.markMissingSnapshotFailed).toHaveBeenCalledWith(run, NOW)
    expect(deps.createReadClient).not.toHaveBeenCalled()
    expect(client.progress).not.toHaveBeenCalled()
  })

  it("does not double-import when another reconciler owns the claim", async () => {
    const run = recoveryRun()
    const { deps, client } = dependencies(run)
    vi.mocked(deps.claimReady).mockResolvedValueOnce(false)

    await expect(reconcileBrightDataProviderRuns(5, deps)).resolves.toEqual([{
      id: "provider-run-1",
      status: "STALE",
    }])
    expect(client.download).not.toHaveBeenCalled()
    expect(deps.importRows).not.toHaveBeenCalled()
  })

  it("keeps an import retryable when an existing snapshot download fails", async () => {
    const run = recoveryRun()
    const { deps, client } = dependencies(run)
    client.download.mockRejectedValueOnce(new Error("sensitive provider payload"))

    await expect(reconcileBrightDataProviderRuns(5, deps)).resolves.toEqual([{
      id: "provider-run-1",
      status: "ERROR",
      error: "bright_data_reconcile_failed",
    }])
    expect(deps.recordRetry).toHaveBeenCalledWith(run, "bright_data_reconcile_failed")
    expect(JSON.stringify(vi.mocked(deps.recordRetry).mock.calls)).not.toContain("sensitive provider payload")
  })

  it("fails closed before provider reads when the token is unavailable", async () => {
    const run = recoveryRun()
    const { deps } = dependencies(run)
    vi.mocked(deps.apiToken).mockReturnValueOnce(null)

    await expect(reconcileBrightDataProviderRuns(5, deps)).resolves.toEqual([{
      id: "provider-run-1",
      status: "SKIPPED",
      error: "bright_data_token_missing",
    }])
    expect(deps.createReadClient).not.toHaveBeenCalled()
    expect(deps.claimReady).not.toHaveBeenCalled()
  })
})
