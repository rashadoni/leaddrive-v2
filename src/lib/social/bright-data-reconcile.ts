import { prisma } from "@/lib/prisma"
import { brightDataPriceSnapshotFromEnv } from "@/lib/social/bright-data-budget-cap"
import {
  BrightDataApiError,
  BrightDataClient,
  type BrightDataProgress,
} from "@/lib/social/bright-data-client"
import {
  brightDataArchiveContextFromSnapshot,
  brightDataProviderCapability,
  importBrightDataSnapshotRows,
  type BrightDataSnapshotImportInput,
} from "@/lib/social/bright-data-adapter"
import type { MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import type { ProviderCapability } from "@/lib/social/provider-capability-contract"
import {
  advanceMonitoringRouteProviderCursor,
  providerFetchWatermarkForResult,
} from "@/lib/social/archive-provider-window"
import {
  withSocialMonitoringImportFence,
  type SocialMonitoringImportFenceResult,
} from "@/lib/social/monitoring-import-fence"

const PROVIDER_KEY = "bright-data"
const ADAPTER_KEY = "BRIGHT_DATA_SNAPSHOT"
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20
const IMPORT_LEASE_MS = 10 * 60_000
const MIN_MISSING_SNAPSHOT_AGE_MS = 15 * 60_000
const SUPPORTED_PLATFORMS = new Set(["instagram", "facebook", "tiktok"])
const PROVIDER_CAPABILITIES = new Set<ProviderCapability>([
  "DISCOVER_URLS",
  "ENRICH_CONTENT",
  "READ_COMMENTS",
  "READ_MEDIA",
  "UPDATE_METRICS",
])

type SourceSnapshot = Omit<MonitoringSourceForRun, "routeExecution">

export interface BrightDataRecoveryRun {
  id: string
  organizationId: string
  sourceId: string
  routePlanId: string
  collectorRunId: string | null
  providerKey: string
  adapterKey: string
  phase: string
  status: string
  externalRunId: string | null
  inputSnapshot: unknown
  reservedChargeUsd: unknown
  maxItems: number
  timeoutSeconds: number
  createdAt: Date
  updatedAt: Date
  source: SourceSnapshot
  routePlan: {
    capability: string
    acquisitionMode: string
  }
}

interface BrightDataReadClient {
  progress(snapshotId: string): Promise<BrightDataProgress>
  download(snapshotId: string): Promise<Record<string, unknown>[]>
}

export interface BrightDataReconcileDependencies {
  now(): Date
  apiToken(): string | null
  priceSnapshot(): ReturnType<typeof brightDataPriceSnapshotFromEnv>
  createReadClient(apiToken: string, timeoutMs: number): BrightDataReadClient
  findRuns(
    limit: number,
    staleImportBefore: Date,
    scope?: BrightDataReconcileScope,
  ): Promise<BrightDataRecoveryRun[]>
  claimReady(run: BrightDataRecoveryRun, staleImportBefore: Date): Promise<boolean>
  markRemoteFailed(run: BrightDataRecoveryRun, now: Date): Promise<boolean>
  markMissingSnapshotFailed(run: BrightDataRecoveryRun, now: Date): Promise<boolean>
  recordRetry(run: BrightDataRecoveryRun, error: string): Promise<void>
  recordImportedOutcome(run: BrightDataRecoveryRun, result: MonitoringCollectorResult): Promise<void>
  importRows(input: BrightDataSnapshotImportInput): Promise<MonitoringCollectorResult>
  advanceCursor(input: Parameters<typeof advanceMonitoringRouteProviderCursor>[0]): Promise<number>
  runPostImportWithinFence<T>(
    run: BrightDataRecoveryRun,
    persist: () => Promise<T>,
  ): Promise<SocialMonitoringImportFenceResult<T>>
}

export interface BrightDataReconcileResult {
  id: string
  status: "PENDING" | "IMPORTED" | "PARTIAL" | "FAILED" | "SKIPPED" | "ERROR" | "STALE"
  error?: string
  foundCount?: number
  newCount?: number
  duplicateCount?: number
  ignoredCount?: number
}

export interface BrightDataReconcileScope {
  organizationId?: string
  ids?: string[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function positiveInteger(value: unknown): number | null {
  const parsed = numberValue(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function providerCapability(run: BrightDataRecoveryRun): ProviderCapability | null {
  const stored = record(run.inputSnapshot).capability
  if (typeof stored === "string" && PROVIDER_CAPABILITIES.has(stored as ProviderCapability)) {
    return stored as ProviderCapability
  }
  return brightDataProviderCapability(run.routePlan.capability)
}

function requestedMaxRecords(run: BrightDataRecoveryRun): number {
  const snapshot = record(run.inputSnapshot)
  const inputCount = positiveInteger(snapshot.targetCount) ?? 1
  const limitPerInput = positiveInteger(snapshot.requestedLimitPerInput)
    ?? Math.max(1, Math.min(1_000, Math.trunc(run.maxItems)))
  return Math.max(1, Math.min(1_000_000, inputCount * limitPerInput))
}

function sourceForRecovery(run: BrightDataRecoveryRun): MonitoringSourceForRun | null {
  if (!run.collectorRunId || !SUPPORTED_PLATFORMS.has(run.source.platform)) return null
  const snapshot = record(run.inputSnapshot)
  const archiveContext = brightDataArchiveContextFromSnapshot(run.inputSnapshot)
  const targetScenarioId = typeof snapshot.leadDriveTargetScenarioId === "string"
    ? String(snapshot.leadDriveTargetScenarioId)
    : typeof snapshot.targetScenarioId === "string"
      ? String(snapshot.targetScenarioId)
      : archiveContext?.targetScenarioId ?? undefined
  return {
    ...run.source,
    routeExecution: {
      collectorRunId: run.collectorRunId,
      routePlanId: run.routePlanId,
      capability: run.routePlan.capability,
      adapterKey: run.adapterKey,
      acquisitionMode: run.routePlan.acquisitionMode,
      providerKey: run.providerKey,
      providerRunId: run.id,
      maxItems: run.maxItems,
      timeoutSeconds: run.timeoutSeconds,
      manualPaidRun: snapshot.manualRun === true
        || snapshot.leadDriveManualPaidRun === true,
      fullArchiveRun: snapshot.leadDriveFullArchiveRun === true
        || archiveContext?.fullArchiveRun === true,
      targetScenarioId,
      targetSubjectId: typeof snapshot.targetSubjectId === "string"
        ? String(snapshot.targetSubjectId)
        : undefined,
    },
  }
}

function recoveryError(error: unknown): string {
  if (error instanceof BrightDataApiError) {
    return `bright_data_reconcile_${error.classification.class.toLowerCase()}`
  }
  return "bright_data_reconcile_failed"
}

function missingSnapshotIsStale(run: BrightDataRecoveryRun, now: Date): boolean {
  const timeoutMs = Math.max(MIN_MISSING_SNAPSHOT_AGE_MS, Math.max(30, run.timeoutSeconds) * 1_000)
  return now.getTime() - run.updatedAt.getTime() >= timeoutMs
}

async function defaultFindRuns(
  limit: number,
  staleImportBefore: Date,
  scope?: BrightDataReconcileScope,
): Promise<BrightDataRecoveryRun[]> {
  return prisma.socialProviderRun.findMany({
    where: {
      providerKey: PROVIDER_KEY,
      adapterKey: ADAPTER_KEY,
      purgedAt: null,
      ...(scope?.organizationId ? { organizationId: scope.organizationId } : {}),
      ...(scope?.ids?.length ? { id: { in: scope.ids } } : {}),
      OR: [
        { status: "RUNNING" },
        { status: "SUCCEEDED", externalRunId: { not: null } },
        { status: "IMPORTING", externalRunId: { not: null }, updatedAt: { lte: staleImportBefore } },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      organizationId: true,
      sourceId: true,
      routePlanId: true,
      collectorRunId: true,
      providerKey: true,
      adapterKey: true,
      phase: true,
      status: true,
      externalRunId: true,
      inputSnapshot: true,
      reservedChargeUsd: true,
      maxItems: true,
      timeoutSeconds: true,
      createdAt: true,
      updatedAt: true,
      source: {
        select: {
          id: true,
          organizationId: true,
          platform: true,
          sourceType: true,
          url: true,
          handle: true,
          query: true,
          ownership: true,
          collectionMode: true,
          status: true,
          cadenceMinutes: true,
          lastCheckedAt: true,
          lastSuccessfulAt: true,
          lastError: true,
          runClaimToken: true,
          runClaimExpiresAt: true,
          runClaimVersion: true,
          settings: true,
          keywords: true,
        },
      },
      routePlan: { select: { capability: true, acquisitionMode: true } },
    },
  }) as Promise<BrightDataRecoveryRun[]>
}

async function defaultClaimReady(run: BrightDataRecoveryRun, staleImportBefore: Date): Promise<boolean> {
  const fenced = await withSocialMonitoringImportFence({
    organizationId: run.organizationId,
    providerRunId: run.id,
    providerKey: PROVIDER_KEY,
    expectedStatuses: ["RUNNING", "SUCCEEDED", "IMPORTING"],
  }, async () => {
    const updated = await prisma.socialProviderRun.updateMany({
      where: {
        id: run.id,
        organizationId: run.organizationId,
        providerKey: PROVIDER_KEY,
        adapterKey: ADAPTER_KEY,
        purgedAt: null,
        externalRunId: run.externalRunId,
        OR: [
          { status: { in: ["RUNNING", "SUCCEEDED"] } },
          { status: "IMPORTING", updatedAt: { lte: staleImportBefore } },
        ],
      },
      data: { status: "IMPORTING", lastError: null },
    })
    return updated.count === 1
  })
  return fenced.allowed && fenced.value
}

async function defaultMarkRemoteFailed(run: BrightDataRecoveryRun, now: Date): Promise<boolean> {
  const updated = await prisma.socialProviderRun.updateMany({
    where: {
      id: run.id,
      organizationId: run.organizationId,
      providerKey: PROVIDER_KEY,
      adapterKey: ADAPTER_KEY,
      purgedAt: null,
      externalRunId: run.externalRunId,
      status: { in: ["RUNNING", "SUCCEEDED", "IMPORTING"] },
    },
    data: {
      status: "FAILED",
      reservedChargeUsd: 0,
      lastError: "bright_data_snapshot_failed",
      finishedAt: now,
    },
  })
  return updated.count === 1
}

async function defaultMarkMissingSnapshotFailed(run: BrightDataRecoveryRun, now: Date): Promise<boolean> {
  const updated = await prisma.socialProviderRun.updateMany({
    where: {
      id: run.id,
      organizationId: run.organizationId,
      providerKey: PROVIDER_KEY,
      adapterKey: ADAPTER_KEY,
      purgedAt: null,
      status: "RUNNING",
      externalRunId: null,
      updatedAt: run.updatedAt,
    },
    data: {
      status: "FAILED",
      reservedChargeUsd: 0,
      lastError: "bright_data_snapshot_id_missing",
      finishedAt: now,
    },
  })
  return updated.count === 1
}

export async function recordBrightDataImportRetry(
  run: BrightDataRecoveryRun,
  error: string,
): Promise<void> {
  await prisma.socialProviderRun.updateMany({
    where: {
      id: run.id,
      organizationId: run.organizationId,
      providerKey: PROVIDER_KEY,
      adapterKey: ADAPTER_KEY,
      purgedAt: null,
      status: "IMPORTING",
    },
    // The request that owned the IMPORTING lease has already failed and
    // returned. Release it immediately so the next GET-only reconciliation
    // poll can retry the same snapshot instead of waiting ten minutes for the
    // crash-recovery lease to expire.
    data: {
      status: "RUNNING",
      lastError: error,
    },
  })
}

export async function recordBrightDataImportedOutcome(
  run: BrightDataRecoveryRun,
  result: MonitoringCollectorResult,
): Promise<void> {
  await prisma.socialProviderRun.updateMany({
    where: {
      id: run.id,
      organizationId: run.organizationId,
      providerKey: PROVIDER_KEY,
      adapterKey: ADAPTER_KEY,
      purgedAt: null,
      status: { in: ["IMPORTED", "PARTIAL"] },
    },
    data: {
      acceptedCount: result.newCount,
      duplicateCount: result.duplicateCount,
      rejectedCount: result.ignoredCount,
      lastError: result.error ?? null,
    },
  })
}

const DEFAULT_DEPENDENCIES: BrightDataReconcileDependencies = {
  now: () => new Date(),
  apiToken: () => process.env.BRIGHT_DATA_API_TOKEN?.trim() || null,
  priceSnapshot: () => brightDataPriceSnapshotFromEnv(),
  createReadClient: (apiToken, timeoutMs) => new BrightDataClient({ apiToken, timeoutMs }),
  findRuns: defaultFindRuns,
  claimReady: defaultClaimReady,
  markRemoteFailed: defaultMarkRemoteFailed,
  markMissingSnapshotFailed: defaultMarkMissingSnapshotFailed,
  recordRetry: recordBrightDataImportRetry,
  recordImportedOutcome: recordBrightDataImportedOutcome,
  importRows: input => importBrightDataSnapshotRows(input),
  advanceCursor: advanceMonitoringRouteProviderCursor,
  runPostImportWithinFence: (run, persist) => withSocialMonitoringImportFence({
    organizationId: run.organizationId,
    providerRunId: run.id,
    providerKey: PROVIDER_KEY,
    expectedStatuses: ["IMPORTED", "PARTIAL"],
  }, persist),
}

/**
 * Reconciles already-dispatched Bright Data snapshots using GET-only provider
 * calls. The read client intentionally exposes only progress/download; no
 * trigger or scrape method exists on this code path.
 */
export async function reconcileBrightDataProviderRuns(
  limit = DEFAULT_LIMIT,
  dependencies: BrightDataReconcileDependencies = DEFAULT_DEPENDENCIES,
  scope?: BrightDataReconcileScope,
): Promise<BrightDataReconcileResult[]> {
  const boundedLimit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)))
  const now = dependencies.now()
  const staleImportBefore = new Date(now.getTime() - IMPORT_LEASE_MS)
  const runs = await dependencies.findRuns(boundedLimit, staleImportBefore, scope)
  if (runs.length === 0) return []

  const results: BrightDataReconcileResult[] = []
  for (const run of runs) {
    if (!run.externalRunId) {
      if (!missingSnapshotIsStale(run, now)) {
        results.push({ id: run.id, status: "PENDING" })
        continue
      }
      const failed = await dependencies.markMissingSnapshotFailed(run, now)
      results.push({
        id: run.id,
        status: failed ? "FAILED" : "STALE",
        ...(failed ? { error: "bright_data_snapshot_id_missing" } : {}),
      })
      continue
    }

    const token = dependencies.apiToken()
    if (!token) {
      results.push({ id: run.id, status: "SKIPPED", error: "bright_data_token_missing" })
      continue
    }

    const capability = providerCapability(run)
    const source = sourceForRecovery(run)
    const reservedChargeUsd = numberValue(run.reservedChargeUsd)
    if (!capability || !source || reservedChargeUsd === null || reservedChargeUsd < 0) {
      results.push({ id: run.id, status: "ERROR", error: "bright_data_reconcile_context_invalid" })
      continue
    }

    const client = dependencies.createReadClient(
      token,
      Math.max(1_000, Math.min(120_000, run.timeoutSeconds * 1_000)),
    )
    try {
      const progress = await client.progress(run.externalRunId)
      if (progress.status === "starting" || progress.status === "running") {
        results.push({ id: run.id, status: "PENDING" })
        continue
      }
      if (progress.status === "failed") {
        const failed = await dependencies.markRemoteFailed(run, now)
        results.push({
          id: run.id,
          status: failed ? "FAILED" : "STALE",
          ...(failed ? { error: "bright_data_snapshot_failed" } : {}),
        })
        continue
      }

      const price = dependencies.priceSnapshot()
      if (price.status !== "READY") {
        results.push({ id: run.id, status: "SKIPPED", error: price.reason })
        continue
      }

      const claimed = await dependencies.claimReady(run, staleImportBefore)
      if (!claimed) {
        results.push({ id: run.id, status: "STALE" })
        continue
      }
      const rows = await client.download(run.externalRunId)
      const archiveContext = brightDataArchiveContextFromSnapshot(run.inputSnapshot)
      const frozenRequestedLimitPerInput = positiveInteger(
        record(run.inputSnapshot).requestedLimitPerInput,
      )
      const imported = await dependencies.importRows({
        source,
        providerRunId: run.id,
        capability,
        rows,
        requestedMaxRecords: requestedMaxRecords(run),
        ...(frozenRequestedLimitPerInput !== null
          ? { requestedLimitPerInput: frozenRequestedLimitPerInput }
          : {}),
        reservedChargeUsd,
        priceSnapshot: price.snapshot,
        now,
        manualPaidRun: source.routeExecution?.manualPaidRun === true,
        providerRequestDispatched: false,
        archiveContext,
      })
      const fetchAfter = providerFetchWatermarkForResult({
        collectionMode: source.collectionMode,
        status: imported.status,
        rawStats: imported.rawStats,
        finishedAt: now,
      })
      const fullArchiveRun = source.routeExecution?.fullArchiveRun === true
      const postImport = await dependencies.runPostImportWithinFence(run, async () => {
        await dependencies.recordImportedOutcome(run, imported)
        if (fetchAfter && (source.routeExecution?.manualPaidRun !== true || fullArchiveRun)) {
          await dependencies.advanceCursor({
            organizationId: run.organizationId,
            sourceId: run.sourceId,
            routePlanId: run.routePlanId,
            adapterKey: run.adapterKey,
            fullArchiveRun,
            targetScenarioId: archiveContext?.targetScenarioId ?? source.routeExecution?.targetScenarioId,
            archiveStartAt: archiveContext?.archiveStartAt ?? null,
            until: fetchAfter,
            reason: "bright_data_route_package_imported",
          })
        }
      })
      if (!postImport.allowed) {
        results.push({
          id: run.id,
          status: "STALE",
          error: postImport.reason,
        })
        continue
      }
      results.push({
        id: run.id,
        status: imported.rawStats?.providerStatus === "IMPORTED" ? "IMPORTED" : "PARTIAL",
        ...(imported.error ? { error: imported.error } : {}),
        foundCount: imported.foundCount,
        newCount: imported.newCount,
        duplicateCount: imported.duplicateCount,
        ignoredCount: imported.ignoredCount,
      })
    } catch (error) {
      const stableError = recoveryError(error)
      await dependencies.recordRetry(run, stableError)
      results.push({ id: run.id, status: "ERROR", error: stableError })
    }
  }
  return results
}
