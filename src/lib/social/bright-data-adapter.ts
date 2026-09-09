import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hmacToken } from "@/lib/secure-token"
import {
  brightDataPriceSnapshotFromEnv,
} from "@/lib/social/bright-data-budget-cap"
import type { BrightDataPriceSnapshot } from "@/lib/social/bright-data-cost-ledger"
import { isBrightDataLiveRoutingAllowed } from "@/lib/social/bright-data-live-routing"
import {
  BrightDataApiError,
  BrightDataClient,
  brightDataRouteFor,
  type BrightDataInput,
} from "@/lib/social/bright-data-client"
import { normalizeBrightDataProviderBatch } from "@/lib/social/bright-data-provider-normalizer"
import { finalizeBrightDataProviderRunLedger } from "@/lib/social/bright-data-run-ledger-repo"
import { BRIGHT_DATA_SOCIAL_ROUTES } from "@/lib/social/bright-data-social-routes"
import {
  ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES,
  resolveArchiveProviderWindow,
  scenarioArchiveStartAtForSource,
  withArchiveProviderCursorOverlap,
} from "@/lib/social/archive-provider-window"
import { findMatchedKeyword, ingestMentionWithResult, type ParentMatchContext } from "@/lib/social/ingest-mention"
import {
  routeExecutionMetadata,
  targetScopedObservationIdempotencyKey,
} from "@/lib/social/collector-observation-context"
import { scheduleProviderMediaRecord } from "@/lib/social/media-observations"
import { recordProviderMetricSnapshot } from "@/lib/social/metric-snapshots"
import {
  withSocialMonitoringImportFence,
  type SocialMonitoringImportFenceResult,
} from "@/lib/social/monitoring-import-fence"
import { parentMatchContextsForComments } from "@/lib/social/parent-match-context"
import { classifySocialCommentThread, hasCommentEngagementSignal } from "@/lib/social/tiktok-comment-relevance"
import {
  decideTikTokPublication,
  isTikTokPublicationEligibleForComments,
  persistTikTokPublicationDecision,
} from "@/lib/social/tiktok-publication-gate"
import {
  reconcileTikTokPublicationRevisitsForSource,
  recordTikTokPublicationRevisitByPost,
} from "@/lib/social/tiktok-publication-revisit-repo"
import { beginPaidRouteBudgetDispatch } from "@/lib/social/paid-route-budget"
import type { MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import { monitoringSourceMatchesOwnedIdentity } from "@/lib/social/mention-author-scope"
import {
  canonicalProviderUrl,
  providerCandidateBoundaryDraft,
  providerRecordToIngestInput,
  type ProviderBatch,
  type ProviderCapability,
  type ProviderRecord,
} from "@/lib/social/provider-capability-contract"

const BRIGHT_DATA_ADAPTER_KEY = "BRIGHT_DATA_SNAPSHOT"
const BRIGHT_DATA_PROVIDER_KEY = "bright-data"
const CANDIDATE_RETENTION_MS = 24 * 3_600_000

export interface BrightDataAdapterTarget {
  url: string
  externalId: string | null
  mentionId: string | null
  matchedTerm: string | null
}

interface BrightDataRunReservation {
  id: string
  maxTotalChargeUsd: unknown
  reservedChargeUsd: unknown
  inputSnapshot?: unknown
}

interface BrightDataClientPort {
  trigger: BrightDataClient["trigger"]
  cancel: BrightDataClient["cancel"]
  triggerWithBudgetCap: BrightDataClient["triggerWithBudgetCap"]
  pollUntilReady: BrightDataClient["pollUntilReady"]
  download: BrightDataClient["download"]
}

interface PersistenceSummary {
  newCount: number
  duplicateCount: number
  ignoredCount: number
}

export interface BrightDataArchiveContext {
  fullArchiveRun: true
  targetScenarioId: string | null
  archiveStartAt: string | null
  cursorSince: string
  since: string
  until: string
  resumedFromWatermark: boolean
  overlapMinutes: number
}

export interface BrightDataSnapshotImportInput {
  source: MonitoringSourceForRun
  providerRunId: string
  capability: ProviderCapability
  rows: Record<string, unknown>[]
  requestedMaxRecords: number
  requestedLimitPerInput?: number
  reservedChargeUsd: number
  priceSnapshot: BrightDataPriceSnapshot
  now: Date
  manualPaidRun: boolean
  providerRequestDispatched: boolean
  targets?: BrightDataAdapterTarget[]
  archiveContext?: BrightDataArchiveContext | null
}

export interface BrightDataSnapshotImportDependencies {
  loadTargets(source: MonitoringSourceForRun, capability: ProviderCapability, maxItems: number): Promise<BrightDataAdapterTarget[]>
  persist(input: {
    source: MonitoringSourceForRun
    providerRunId: string
    batches: ProviderBatch[]
    targets: BrightDataAdapterTarget[]
    now: Date
    providerCoverageClass: "BLOCKED" | "PARTIAL" | "SAMPLED" | "COMPLETE_FOR_INPUT"
    requestedLimitPerInput: number
  }): Promise<PersistenceSummary>
  finalize(input: {
    organizationId: string
    providerRunId: string
    requestedUnits: number
    deliveredRecords: number
    acceptedUnique: number
    reservedChargeUsd: number
    priceSnapshot: BrightDataPriceSnapshot | null
    finalStatus: "PARTIAL" | "IMPORTED"
    driftWarnings?: string[]
    now: Date
  }): Promise<void>
  runWithinImportFence<T>(
    input: {
      organizationId: string
      providerRunId: string
      providerKey: string
      expectedStatuses: readonly string[]
      blockOnEmergencyStop?: boolean
    },
    persist: () => Promise<T>,
  ): Promise<SocialMonitoringImportFenceResult<T>>
}

export interface BrightDataAdapterDependencies {
  now(): Date
  createClient(apiToken: string, timeoutMs: number, parentSignal?: AbortSignal): BrightDataClientPort
  priceSnapshot(): ReturnType<typeof brightDataPriceSnapshotFromEnv>
  getRun(organizationId: string, providerRunId: string): Promise<BrightDataRunReservation | null>
  beginDispatch(organizationId: string, providerRunId: string): Promise<boolean>
  prepareRun(input: {
    organizationId: string
    providerRunId: string
    datasetId: string
    phase: string
    inputHash: string
    inputCount: number
    platform: string
    capability: ProviderCapability
    priceSnapshotId: string | null
    requestedLimitPerInput: number
    estimatedChargeUsd: number
    existingInputSnapshot?: unknown
    archiveContext?: BrightDataArchiveContext | null
  }): Promise<void>
  setExternalRunId(organizationId: string, providerRunId: string, snapshotId: string): Promise<void>
  loadTargets(source: MonitoringSourceForRun, capability: ProviderCapability, maxItems: number): Promise<BrightDataAdapterTarget[]>
  persist(input: {
    source: MonitoringSourceForRun
    providerRunId: string
    batches: ProviderBatch[]
    targets: BrightDataAdapterTarget[]
    now: Date
    providerCoverageClass: "BLOCKED" | "PARTIAL" | "SAMPLED" | "COMPLETE_FOR_INPUT"
    requestedLimitPerInput: number
  }): Promise<PersistenceSummary>
  finalize(input: {
    organizationId: string
    providerRunId: string
    requestedUnits: number
    deliveredRecords: number
    acceptedUnique: number
    reservedChargeUsd: number
    priceSnapshot: BrightDataPriceSnapshot | null
    finalStatus: "PARTIAL" | "IMPORTED"
    driftWarnings?: string[]
    now: Date
  }): Promise<void>
  runWithinImportFence<T>(
    input: {
      organizationId: string
      providerRunId: string
      providerKey: string
      expectedStatuses: readonly string[]
      blockOnEmergencyStop?: boolean
    },
    persist: () => Promise<T>,
  ): Promise<SocialMonitoringImportFenceResult<T>>
  reuseEnrichment(source: MonitoringSourceForRun, capability: ProviderCapability): Promise<MonitoringCollectorResult | null>
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function jsonRecord(value: unknown): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {}
}

function sourceTerms(source: MonitoringSourceForRun): string[] {
  const values = [source.query, source.handle, ...(source.keywords ?? [])]
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string")
    .map(value => value.replace(/^[@#]+/, "").trim())
    .filter(Boolean)))
}

function sourceScenarioIds(source: MonitoringSourceForRun): string[] {
  const settings = jsonRecord(source.settings)
  const links = Array.isArray(settings.scenarioLinks) ? settings.scenarioLinks : []
  return Array.from(new Set([
    source.routeExecution?.targetScenarioId,
    typeof settings.scenarioId === "string" ? settings.scenarioId : null,
    ...links.map(link => {
      const value = jsonRecord(link).scenarioId
      return typeof value === "string" ? value : null
    }),
  ].filter((value): value is string => Boolean(value?.trim())).map(value => value.trim())))
}

function sourceNegativeTerms(source: MonitoringSourceForRun): string[] {
  const values = jsonRecord(source.settings).negativeTerms
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean)))
}

function isoDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

export function brightDataArchiveContextForSource(
  source: MonitoringSourceForRun,
  now = new Date(),
): BrightDataArchiveContext | null {
  const route = source.routeExecution
  if (route?.fullArchiveRun !== true) return null

  const targetScenarioId = route.targetScenarioId?.trim() || null
  const archiveStartAt = scenarioArchiveStartAtForSource(
    source.settings,
    targetScenarioId,
    route.archiveStartAt,
  )
  const scope = {
    routePlanId: route.routePlanId,
    adapterKey: route.adapterKey,
    fullArchiveRun: true,
    targetScenarioId,
    archiveStartAt,
  }
  const cursorWindow = resolveArchiveProviderWindow(source.settings, now, 24, 24 * 30, {
    scope,
    archiveStartAt,
  })
  const providerWindow = withArchiveProviderCursorOverlap(
    cursorWindow,
    ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES,
    archiveStartAt,
  )
  return {
    fullArchiveRun: true,
    targetScenarioId,
    archiveStartAt: archiveStartAt?.toISOString() ?? null,
    cursorSince: cursorWindow.since.toISOString(),
    since: providerWindow.since.toISOString(),
    until: providerWindow.until.toISOString(),
    resumedFromWatermark: providerWindow.resumedFromWatermark,
    overlapMinutes: providerWindow.resumedFromWatermark
      ? ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES
      : 0,
  }
}

export function brightDataArchiveContextFromSnapshot(value: unknown): BrightDataArchiveContext | null {
  const snapshot = jsonRecord(jsonRecord(value).leadDriveArchiveContext)
  if (snapshot.fullArchiveRun !== true) return null
  const cursorSince = isoDate(snapshot.cursorSince)
  const since = isoDate(snapshot.since)
  const until = isoDate(snapshot.until)
  if (!cursorSince || !since || !until || new Date(since) > new Date(until)) return null
  return {
    fullArchiveRun: true,
    targetScenarioId: typeof snapshot.targetScenarioId === "string" && snapshot.targetScenarioId.trim()
      ? snapshot.targetScenarioId.trim()
      : null,
    archiveStartAt: isoDate(snapshot.archiveStartAt),
    cursorSince,
    since,
    until,
    resumedFromWatermark: snapshot.resumedFromWatermark === true,
    overlapMinutes: Number.isFinite(Number(snapshot.overlapMinutes))
      ? Math.max(0, Number(snapshot.overlapMinutes))
      : 0,
  }
}

export function filterBrightDataBatchesForArchive(
  batches: ProviderBatch[],
  archiveContext: BrightDataArchiveContext | null | undefined,
): {
  batches: ProviderBatch[]
  outsideWindowCount: number
  unknownTimestampCount: number
} {
  if (!archiveContext) {
    return { batches, outsideWindowCount: 0, unknownTimestampCount: 0 }
  }
  const since = new Date(archiveContext.since)
  const until = new Date(archiveContext.until)
  let outsideWindowCount = 0
  let unknownTimestampCount = 0
  const coalescedEnrichment = batches.some(batch => batch.capability === "ENRICH_CONTENT")
  const acceptedContentIds = new Set<string>()
  const timestampFiltered = batches.map(batch => ({
    ...batch,
    records: batch.records.filter(record => {
      if (
        record.recordType !== "CANDIDATE"
        && record.recordType !== "CONTENT"
        && record.recordType !== "COMMENT"
      ) return true
      const publishedAt = isoDate(record.publishedAt)
      if (!publishedAt) {
        // Unknown publication time must never silently enter a date-bounded
        // archive. Mark the import partial so the frozen checkpoint is not
        // advanced and surface the row count for operator review.
        unknownTimestampCount += 1
        return false
      }
      const timestamp = new Date(publishedAt).getTime()
      if (timestamp < since.getTime() || timestamp > until.getTime()) {
        outsideWindowCount += 1
        return false
      }
      if (record.recordType === "CONTENT") acceptedContentIds.add(record.externalId)
      return true
    }),
  }))
  const filtered = coalescedEnrichment
    ? timestampFiltered.map(batch => ({
        ...batch,
        records: batch.records.filter(record => {
          if (record.recordType === "MEDIA") {
            return acceptedContentIds.has(record.parentExternalId)
          }
          if (record.recordType === "METRIC") {
            return acceptedContentIds.has(record.externalId)
          }
          return true
        }),
      }))
    : timestampFiltered
  return { batches: filtered, outsideWindowCount, unknownTimestampCount }
}

export function brightDataProviderCapability(sourceCapability: string): ProviderCapability | null {
  if (sourceCapability === "DISCOVER_POSTS") return "DISCOVER_URLS"
  if (sourceCapability === "ENRICH_CONTENT") return "ENRICH_CONTENT"
  if (sourceCapability === "READ_EXTERNAL_COMMENTS" || sourceCapability === "READ_OWNED_COMMENTS") return "READ_COMMENTS"
  if (sourceCapability === "READ_MEDIA") return "READ_MEDIA"
  if (sourceCapability === "UPDATE_METRICS") return "UPDATE_METRICS"
  return null
}

export function brightDataCoalescedReplayCapability(capability: ProviderCapability): boolean {
  return capability === "READ_MEDIA" || capability === "UPDATE_METRICS"
}

function phaseFor(capability: ProviderCapability): string {
  if (capability === "DISCOVER_URLS") return "DISCOVER_CANDIDATE_POSTS"
  if (capability === "READ_COMMENTS") return "EXTRACT_COMMENTS_FROM_CANDIDATES"
  return capability
}

function discoveryInputs(source: MonitoringSourceForRun): BrightDataInput[] {
  if (source.platform === "tiktok") {
    // Scenario-managed TikTok sources store the packed identity in `query` and
    // every actual provider search term in `keywords`. Dispatch the terms as
    // inputs in one budget-capped snapshot; never send the pipe-joined identity
    // as an additional provider query.
    const candidates = source.keywords?.length
      ? source.keywords
      : [source.query, source.handle]
    const uniqueTerms = new Map<string, string>()
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue
      const value = candidate.replace(/^[@#]+/, "").trim()
      if (!value) continue
      const key = value.toLocaleLowerCase()
      if (!uniqueTerms.has(key)) uniqueTerms.set(key, value)
    }
    const terms = Array.from(uniqueTerms.values())
    return terms.map(search_keyword => ({ search_keyword, country: "" }))
  }
  if (["instagram", "facebook"].includes(source.platform)) {
    const url = source.url?.trim()
    if (url) {
      const targetsOwnedIdentity = source.ownedIdentity
        ? monitoringSourceMatchesOwnedIdentity({
            platform: source.platform,
            sourceType: "profile",
            url,
            handle: source.handle,
            query: null,
          }, source.ownedIdentity)
        : false
      if (targetsOwnedIdentity) return []
      return [{ url }]
    }
    // Handle-only sources (wizard rows created without a URL) still name a
    // public page, and the FB/IG datasets are URL-based — derive the canonical
    // page URL instead of dead-ending the source.
    const handle = source.handle?.replace(/^@+/, "").trim()
    if (handle && /^[\w.-]+$/.test(handle)) {
      const derivedUrl = source.platform === "facebook"
        ? `https://www.facebook.com/${handle}`
        : `https://www.instagram.com/${handle}/`
      const targetsOwnedIdentity = source.ownedIdentity
        ? monitoringSourceMatchesOwnedIdentity({
            platform: source.platform,
            sourceType: "profile",
            url: derivedUrl,
            handle,
            query: null,
          }, source.ownedIdentity)
        : false
      if (targetsOwnedIdentity) return []
      return [{
        url: derivedUrl,
      }]
    }
    return []
  }
  return []
}

export function brightDataInputsFor(
  source: MonitoringSourceForRun,
  capability: ProviderCapability,
  targets: BrightDataAdapterTarget[],
): BrightDataInput[] {
  if (capability === "DISCOVER_URLS") return discoveryInputs(source)
  return targets.map(target => ({ url: target.url }))
}

function targetIdentityMap(targets: BrightDataAdapterTarget[]): Record<string, string> {
  return Object.fromEntries(targets.flatMap(target => (
    target.externalId ? [[canonicalProviderUrl(target.url), target.externalId]] : []
  )))
}

function aggregateHealth(values: Array<ReturnType<typeof normalizeBrightDataProviderBatch>["drift"]["health"]>) {
  if (values.includes("FAILED")) return "FAILED" as const
  if (values.includes("DEGRADED")) return "DEGRADED" as const
  if (values.every(value => value === "TRUE_ZERO")) return "TRUE_ZERO" as const
  return "HEALTHY" as const
}

async function defaultGetRun(organizationId: string, providerRunId: string): Promise<BrightDataRunReservation | null> {
  return prisma.socialProviderRun.findFirst({
    where: {
      id: providerRunId,
      organizationId,
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      adapterKey: BRIGHT_DATA_ADAPTER_KEY,
      purgedAt: null,
      status: "QUEUED",
    },
    select: { id: true, maxTotalChargeUsd: true, reservedChargeUsd: true, inputSnapshot: true },
  })
}

async function defaultPrepareRun(input: Parameters<BrightDataAdapterDependencies["prepareRun"]>[0]) {
  const updated = await prisma.socialProviderRun.updateMany({
    where: {
      id: input.providerRunId,
      organizationId: input.organizationId,
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      adapterKey: BRIGHT_DATA_ADAPTER_KEY,
      purgedAt: null,
      status: "QUEUED",
    },
    data: {
      phase: input.phase,
      datasetId: input.datasetId,
      schemaVersion: "bright-data-provider-adapter-v1",
      inputHash: input.inputHash,
      inputSnapshot: {
        ...jsonRecord(input.existingInputSnapshot),
        redacted: true,
        platform: input.platform,
        capability: input.capability,
        targetCount: input.inputCount,
        requestedLimitPerInput: input.requestedLimitPerInput,
        priceSnapshotId: input.priceSnapshotId,
        providerAccountBudget: true,
        estimatedChargeUsd: input.estimatedChargeUsd,
        ...(input.archiveContext
          ? {
              leadDriveFullArchiveRun: true,
              leadDriveTargetScenarioId: input.archiveContext.targetScenarioId,
              leadDriveArchiveStartAt: input.archiveContext.archiveStartAt,
              leadDriveArchiveContext: { ...input.archiveContext },
            }
          : {}),
      },
      reservedChargeUsd: input.estimatedChargeUsd,
      maxTotalChargeUsd: input.estimatedChargeUsd,
      dailyBudgetUsd: null,
      monthlyBudgetUsd: null,
    },
  })
  if (updated.count !== 1) throw new Error("bright_data_run_state_changed")
}

async function defaultSetExternalRunId(organizationId: string, providerRunId: string, snapshotId: string) {
  const updated = await prisma.socialProviderRun.updateMany({
    where: {
      id: providerRunId,
      organizationId,
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      purgedAt: null,
      status: "RUNNING",
    },
    data: { externalRunId: snapshotId },
  })
  if (updated.count !== 1) throw new Error("bright_data_run_state_changed")
}

async function latestDiscoveryTargets(source: MonitoringSourceForRun, maxItems: number): Promise<BrightDataAdapterTarget[]> {
  const run = await prisma.socialProviderRun.findFirst({
    where: {
      organizationId: source.organizationId,
      sourceId: source.id,
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      phase: "DISCOVER_CANDIDATE_POSTS",
      purgedAt: null,
      status: { in: ["IMPORTED", "PARTIAL"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  })
  if (!run) return []
  const rows = await prisma.ingestEnvelope.findMany({
    where: {
      organizationId: source.organizationId,
      sourceId: source.id,
      providerRunId: run.id,
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      contentKind: "UNKNOWN",
      OR: [{ canonicalUrl: { not: null } }, { url: { not: null } }],
    },
    orderBy: { createdAt: "desc" },
    take: maxItems,
    select: { canonicalUrl: true, url: true, externalId: true },
  })
  return rows.flatMap((row: { canonicalUrl: string | null; url: string | null; externalId: string | null }) => {
    const url = row.canonicalUrl || row.url
    return url ? [{ url, externalId: row.externalId, mentionId: null, matchedTerm: null }] : []
  })
}

async function enrichedTargets(source: MonitoringSourceForRun, maxItems: number): Promise<BrightDataAdapterTarget[]> {
  const rows = await prisma.ingestEnvelope.findMany({
    where: {
      organizationId: source.organizationId,
      sourceId: source.id,
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      acceptedMentionId: { not: null },
      contentKind: { in: ["POST", "VIDEO"] },
      OR: [{ canonicalUrl: { not: null } }, { url: { not: null } }],
    },
    orderBy: { createdAt: "desc" },
    take: maxItems,
    select: {
      canonicalUrl: true,
      url: true,
      externalId: true,
      acceptedMentionId: true,
      acceptedMention: { select: { matchedTerm: true } },
    },
  })
  const seen = new Set<string>()
  return rows.flatMap((row: {
    canonicalUrl: string | null
    url: string | null
    externalId: string | null
    acceptedMentionId: string | null
    acceptedMention: { matchedTerm: string | null } | null
  }) => {
    const url = row.canonicalUrl || row.url
    if (!url) return []
    const canonical = canonicalProviderUrl(url)
    if (seen.has(canonical)) return []
    seen.add(canonical)
    return [{
      url: canonical,
      externalId: row.externalId,
      mentionId: row.acceptedMentionId,
      matchedTerm: row.acceptedMention?.matchedTerm ?? null,
    }]
  })
}

export async function dueTikTokRevisitTargets(
  source: MonitoringSourceForRun,
  maxItems: number,
  now = new Date(),
  options: { includeNotYetDue?: boolean } = {},
): Promise<BrightDataAdapterTarget[]> {
  // Repair negative accepted parents created before the publication-gate
  // registration hook shipped. Subject lineage lets a current active route
  // recover parents stranded on a disabled legacy source without widening the
  // paid pull to unrelated accepted publications.
  const reconciliation = await reconcileTikTokPublicationRevisitsForSource({
    organizationId: source.organizationId,
    sourceId: source.id,
    sourceSettings: source.settings,
    targetSubjectId: source.routeExecution?.targetSubjectId,
    now,
    limit: maxItems,
  })
  if (reconciliation.subjectIds.length === 0) return []
  const rows = await prisma.tikTokPublicationRevisit.findMany({
    where: {
      organizationId: source.organizationId,
      status: options.includeNotYetDue ? { in: ["ACTIVE", "INACTIVE"] } : "ACTIVE",
      // The revisit cadence lets comments accumulate before a paid pull; a
      // MANUAL run means "results now", so it may take fresh registrations too.
      ...(options.includeNotYetDue ? {} : { nextDueAt: { lte: now } }),
      ingestEnvelope: {
        relevanceStatus: "ACCEPTED",
        deletedAtSource: null,
        purgedAt: null,
        acceptedMention: {
          sentiment: "negative",
          deletedAtSource: null,
          purgedAt: null,
          subjectMatches: {
            some: {
              status: "MATCHED",
              subjectId: { in: reconciliation.subjectIds },
            },
          },
        },
      },
    },
    orderBy: [{ nextDueAt: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(maxItems, 1), 100),
    select: {
      canonicalUrl: true,
      postExternalId: true,
      ingestEnvelope: { select: { matchedTerms: true } },
    },
  })
  return rows.map((row: { canonicalUrl: string; postExternalId: string; ingestEnvelope: { matchedTerms: string[] } }) => ({
    url: canonicalProviderUrl(row.canonicalUrl),
    externalId: row.postExternalId,
    mentionId: null,
    matchedTerm: row.ingestEnvelope.matchedTerms[0] ?? null,
  }))
}

async function defaultLoadTargets(
  source: MonitoringSourceForRun,
  capability: ProviderCapability,
  maxItems: number,
): Promise<BrightDataAdapterTarget[]> {
  if (capability === "DISCOVER_URLS") return []
  if (capability === "ENRICH_CONTENT") return latestDiscoveryTargets(source, maxItems)
  if (source.platform === "tiktok" && capability === "READ_COMMENTS") {
    // The "Запустить" button drives the FULL cycle in one click — including
    // comments of the publications it just found — exactly like a manual
    // deep-dive, instead of leaving comments to a later cron revisit.
    return dueTikTokRevisitTargets(source, maxItems, new Date(), {
      includeNotYetDue: source.routeExecution?.manualPaidRun === true,
    })
  }
  return enrichedTargets(source, maxItems)
}

function targetByUrl(targets: BrightDataAdapterTarget[]): Map<string, BrightDataAdapterTarget> {
  return new Map(targets.map(target => [canonicalProviderUrl(target.url), target]))
}

async function persistCandidate(
  source: MonitoringSourceForRun,
  providerRunId: string,
  record: Extract<ProviderRecord, { recordType: "CANDIDATE" }>,
  now: Date,
): Promise<"new" | "duplicate"> {
  const draft = providerCandidateBoundaryDraft(record)
  const key = {
    organizationId_idempotencyKey: {
      organizationId: source.organizationId,
      idempotencyKey: draft.idempotencyKey,
    },
  }
  const existing = await prisma.ingestEnvelope.findUnique({ where: key, select: { id: true } })
  await prisma.ingestEnvelope.upsert({
    where: key,
    update: {},
    create: {
      organizationId: source.organizationId,
      sourceId: source.id,
      collectorRunId: source.routeExecution?.collectorRunId ?? null,
      routePlanId: source.routeExecution?.routePlanId ?? null,
      providerRunId,
      adapterKey: draft.adapterKey,
      providerKey: draft.providerKey,
      providerItemId: draft.providerItemId,
      idempotencyKey: draft.idempotencyKey,
      acquisitionMode: "LICENSED_PROVIDER",
      contentKind: draft.contentKind,
      platform: draft.platform,
      externalId: draft.externalId,
      externalIds: { externalId: draft.externalId },
      url: draft.url,
      canonicalUrl: draft.canonicalUrl,
      text: null,
      contentHmac: hmacToken(draft.canonicalUrl, `bright-data-candidate:${source.organizationId}`),
      rawPayload: {},
      policySnapshot: draft.policySnapshot as Prisma.InputJsonValue,
      relevanceStatus: draft.relevanceStatus,
      purgeAt: new Date(now.getTime() + CANDIDATE_RETENTION_MS),
    },
  })
  return existing ? "duplicate" : "new"
}

export async function persistBrightDataBatches(input: Parameters<BrightDataAdapterDependencies["persist"]>[0]): Promise<PersistenceSummary> {
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  const terms = sourceTerms(input.source)
  const targets = targetByUrl(input.targets)
  type TikTokTargetCommentStats = {
    postExternalId: string
    canonicalUrl: string
    newCount: number
    duplicateCount: number
    ignoredCount: number
  }
  const tiktokTargetStats = input.source.platform === "tiktok"
    && input.source.routeExecution?.capability === "READ_EXTERNAL_COMMENTS"
    ? input.targets.flatMap(target => {
        const postExternalId = target.externalId?.trim()
        if (!postExternalId) return []
        return [{
          postExternalId,
          canonicalUrl: canonicalProviderUrl(target.url),
          newCount: 0,
          duplicateCount: 0,
          ignoredCount: 0,
        } satisfies TikTokTargetCommentStats]
      })
    : []
  const tiktokStatsByPostId = new Map(tiktokTargetStats.map(stats => [stats.postExternalId, stats]))
  const tiktokStatsByUrl = new Map(tiktokTargetStats.map(stats => [stats.canonicalUrl, stats]))
  const tiktokCommentStatsFor = (record: Extract<ProviderRecord, { recordType: "COMMENT" }>) => (
    tiktokStatsByPostId.get(record.postExternalId)
    ?? tiktokStatsByUrl.get(canonicalProviderUrl(record.parentPostUrl))
    ?? null
  )
  const mentionIds = new Map<string, string>()
  const commentParentUrls = input.batches.flatMap(batch => batch.records.flatMap(record => (
    record.recordType === "COMMENT" ? [record.parentPostUrl] : []
  )))
  const commentParentIds = input.batches.flatMap(batch => batch.records.flatMap(record => (
    record.recordType === "COMMENT" ? [record.postExternalId] : []
  )))
  const parentContexts = commentParentUrls.length > 0 || commentParentIds.length > 0
    ? await parentMatchContextsForComments(
        input.source.organizationId,
        input.source.platform,
        commentParentUrls,
        commentParentIds,
      )
    : new Map<string, ParentMatchContext>()

  for (const batch of input.batches) {
    const commentMatches = new Map<string, string | null>()
    const commentDecisions = new Map(classifySocialCommentThread(batch.records
      .filter((record): record is Extract<ProviderRecord, { recordType: "COMMENT" }> => record.recordType === "COMMENT")
      .map(record => {
        const matchedTerm = findMatchedKeyword(record.text, terms)
        commentMatches.set(record.externalId, matchedTerm)
        return {
          externalId: record.externalId,
          parentExternalId: record.parentExternalId,
          matchedTerm,
          // Comment extraction is scoped to publications that already matched
          // this tenant. Keep complaints, questions and lead intent even when
          // the comment does not repeat the brand name.
          engagementSignal: hasCommentEngagementSignal(record.text),
        }
      }))
      .map(decision => [decision.externalId, decision] as const))
    for (const record of batch.records) {
      if (record.recordType === "CANDIDATE") {
        const result = await persistCandidate(input.source, input.providerRunId, record, input.now)
        if (result === "new") newCount += 1
        else duplicateCount += 1
        continue
      }
      if (record.recordType === "CONTENT" || record.recordType === "COMMENT") {
        const tiktokCommentStats = record.recordType === "COMMENT"
          ? tiktokCommentStatsFor(record)
          : null
        const parentTarget = targets.get(canonicalProviderUrl(
          record.recordType === "COMMENT" ? record.parentPostUrl : record.canonicalUrl || record.url,
        ))
        const ingest = providerRecordToIngestInput({
          organizationId: input.source.organizationId,
          sourceId: input.source.id,
          collectorRunId: input.source.routeExecution?.collectorRunId ?? null,
          routePlanId: input.source.routeExecution?.routePlanId ?? null,
          providerRunId: input.providerRunId,
          acquisitionMode: "LICENSED_PROVIDER",
        }, record)
        ingest.sourceMetadata = {
          ...(ingest.sourceMetadata ?? {}),
          ...routeExecutionMetadata(input.source),
        }
        const scopedIdempotencyKey = targetScopedObservationIdempotencyKey(
          input.source,
          ingest.observation?.providerItemId ?? record.externalId,
        )
        if (scopedIdempotencyKey && ingest.observation) {
          ingest.observation.idempotencyKey = scopedIdempotencyKey
        }
        if (record.recordType === "COMMENT") {
          ingest.parentMatchContext = parentContexts.get(record.postExternalId)
            ?? parentContexts.get(record.parentPostUrl)
            ?? parentContexts.get(canonicalProviderUrl(record.parentPostUrl))
            ?? null
        }
        ingest.matchedTerm = record.recordType === "COMMENT"
          ? commentMatches.get(record.externalId) ?? null
          : providerRecordMatchedTerm(record.recordType, record.text, terms, parentTarget?.matchedTerm ?? null)
        const commentDecision = record.recordType === "COMMENT" ? commentDecisions.get(record.externalId) : null
        if (commentDecision) {
          ingest.observation = {
            ...ingest.observation,
            requireMatchedTerm:
              commentDecision.classification === "REJECTED"
              || commentDecision.reason === "OWN_TENANT_TERM",
            ...(commentDecision.classification === "CONTEXT"
              ? { relevanceStatus: "REVIEW", relevanceReason: "thread_context_for_actionable_descendant", relevanceConfidence: 1 }
              : commentDecision.reason === "REPLY_TO_ACTIONABLE_COMMENT"
                ? { relevanceStatus: "ACCEPTED", relevanceReason: "reply_to_actionable_comment", relevanceConfidence: 1 }
                : commentDecision.reason === "ENGAGEMENT_SIGNAL"
                  ? { relevanceStatus: "ACCEPTED", relevanceReason: "engagement_signal_on_matched_parent", relevanceConfidence: 1 }
                  : {}),
            policySnapshot: {
              ...(ingest.observation?.policySnapshot ?? {}),
              commentRelevanceClassification: commentDecision.classification,
              commentRelevanceReason: commentDecision.reason,
            },
          }
        }
        const result = await ingestMentionWithResult(ingest)
        if (result.accepted === false) {
          ignoredCount += 1
          if (tiktokCommentStats) tiktokCommentStats.ignoredCount += 1
          continue
        }
        // Wire the publication gate for accepted TikTok publications: a
        // MATCHED decision registers a revisit, which is the ONLY feed for the
        // EXTRACT_COMMENTS_FROM_CANDIDATES phase (dueTikTokRevisitTargets).
        // Without this call the revisit queue stays empty and comments are
        // never collected.
        if (record.recordType === "CONTENT" && input.source.platform === "tiktok") {
          const decision = decideTikTokPublication({
            query: input.source.query ?? input.source.handle ?? "",
            scenarioIds: sourceScenarioIds(input.source),
            provider: "bright-data",
            observedAt: input.now,
            publishedAt: record.publishedAt ? new Date(record.publishedAt) : null,
            freshnessSince: new Date(input.now.getTime() - 180 * 24 * 60 * 60 * 1000),
            caption: record.text,
            creator: record.author?.handle ?? record.author?.name ?? null,
            positiveTerms: terms,
            negativeTerms: sourceNegativeTerms(input.source),
          })
          if (isTikTokPublicationEligibleForComments(decision)) {
            const acceptedEnvelope = result.envelopeId
              ? { id: result.envelopeId }
              : await prisma.ingestEnvelope.findFirst({
                  where: {
                    organizationId: input.source.organizationId,
                    providerRunId: input.providerRunId,
                    platform: "tiktok",
                    externalId: record.externalId,
                    relevanceStatus: "ACCEPTED",
                    acceptedMentionId: result.id,
                  },
                  select: { id: true },
                })
            if (!acceptedEnvelope) throw new Error("bright_data_tiktok_accepted_envelope_missing")
            const registered = await persistTikTokPublicationDecision({
              organizationId: input.source.organizationId,
              envelopeId: acceptedEnvelope.id,
              decision,
            })
            // Терминально отклонённый конверт продвигать нечем — это не сбой
            // записи и не повод ронять импорт всего набора (#657).
            if (registered === "failed") throw new Error("bright_data_tiktok_publication_revisit_not_registered")
          }
        }
        mentionIds.set(record.recordType === "CONTENT" ? record.externalId : record.postExternalId, result.id)
        if (result.created) {
          newCount += 1
          if (tiktokCommentStats) tiktokCommentStats.newCount += 1
        } else {
          duplicateCount += 1
          if (tiktokCommentStats) tiktokCommentStats.duplicateCount += 1
        }
        continue
      }
      if (record.recordType === "MEDIA") {
        const mentionId = mentionIds.get(record.parentExternalId)
          ?? input.targets.find(target => target.externalId === record.parentExternalId)?.mentionId
        if (!mentionId) {
          continue
        }
        await scheduleProviderMediaRecord({
          organizationId: input.source.organizationId,
          mentionId,
        }, record)
        continue
      }
      if (record.recordType === "METRIC") {
        const mentionId = mentionIds.get(record.externalId)
          ?? input.targets.find(target => target.externalId === record.externalId)?.mentionId
          ?? null
        // Metrics are child observations, not standalone monitoring results.
        // Fail closed when the parent content was rejected/unmatched and no
        // previously accepted target can supply its tenant-scoped mention.
        if (!mentionId) {
          continue
        }
        await recordProviderMetricSnapshot({
          organizationId: input.source.organizationId,
          mentionId,
          providerRunId: input.providerRunId,
        }, record)
      }
    }
  }
  if (
    input.source.platform === "tiktok"
    && input.source.routeExecution?.capability === "READ_EXTERNAL_COMMENTS"
    && input.providerCoverageClass === "COMPLETE_FOR_INPUT"
  ) {
    for (const stats of tiktokTargetStats) {
      const observedCommentCount = stats.newCount + stats.duplicateCount + stats.ignoredCount
      // Reaching the provider's per-input ceiling is ambiguous: the thread may
      // contain more rows that the snapshot could not return. Keep that target
      // due instead of advancing its adaptive cadence as if the traversal were
      // complete.
      if (observedCommentCount >= input.requestedLimitPerInput) continue
      await recordTikTokPublicationRevisitByPost({
        organizationId: input.source.organizationId,
        postExternalId: stats.postExternalId,
        observedCommentCount,
        activityDetected: stats.newCount > 0,
        coverageClass: stats.ignoredCount > 0 ? "PARTIAL" : "COMPLETE",
        now: input.now,
      })
    }
  }
  return { newCount, duplicateCount, ignoredCount }
}

/**
 * A comment must match the monitored term in its own body. Parent relevance is
 * lineage only and must not turn a generic reply such as "thanks" into a brand
 * mention. Content enrichment may still reuse the discovery target match.
 */
export function providerRecordMatchedTerm(
  recordType: "CONTENT" | "COMMENT",
  text: string,
  terms: string[],
  parentMatchedTerm: string | null,
): string | null {
  const ownMatch = findMatchedKeyword(text, terms)
  return recordType === "COMMENT" ? ownMatch : ownMatch ?? parentMatchedTerm
}

async function defaultFinalize(input: Parameters<BrightDataAdapterDependencies["finalize"]>[0]) {
  const result = await finalizeBrightDataProviderRunLedger(input)
  if (result.status !== "UPDATED") throw new Error(`bright_data_run_finalize_${result.status.toLowerCase()}`)
}

async function defaultReuseEnrichment(
  source: MonitoringSourceForRun,
  capability: ProviderCapability,
): Promise<MonitoringCollectorResult | null> {
  const collectorRunId = source.routeExecution?.collectorRunId
  if (!collectorRunId) return null
  const run = await prisma.socialProviderRun.findFirst({
    where: {
      organizationId: source.organizationId,
      sourceId: source.id,
      collectorRunId,
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      phase: "ENRICH_CONTENT",
      purgedAt: null,
      status: { in: ["IMPORTED", "PARTIAL"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, receivedCount: true, acceptedCount: true, status: true },
  })
  if (!run) return null
  return {
    status: run.status === "PARTIAL" ? "partial" : "success",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: run.status === "PARTIAL" ? "bright_data_enrichment_partial" : null,
    rawStats: {
      providerRunId: run.id,
      providerStatus: run.status,
      coalescedCapability: capability,
      reusedEnrichment: true,
    },
  }
}

const DEFAULT_DEPENDENCIES: BrightDataAdapterDependencies = {
  now: () => new Date(),
  createClient: (apiToken, timeoutMs, parentSignal) => new BrightDataClient({
    apiToken,
    timeoutMs,
    signal: parentSignal,
  }),
  priceSnapshot: () => brightDataPriceSnapshotFromEnv(),
  getRun: defaultGetRun,
  beginDispatch: beginPaidRouteBudgetDispatch,
  prepareRun: defaultPrepareRun,
  setExternalRunId: defaultSetExternalRunId,
  loadTargets: defaultLoadTargets,
  persist: persistBrightDataBatches,
  finalize: defaultFinalize,
  runWithinImportFence: withSocialMonitoringImportFence,
  reuseEnrichment: defaultReuseEnrichment,
}

function stableProviderError(error: unknown): { error: string; failureClass: string | null; httpStatus: number | null } {
  if (error instanceof BrightDataApiError) {
    return {
      error: `bright_data_${error.classification.class.toLowerCase()}`,
      failureClass: error.classification.class,
      httpStatus: error.httpStatus,
    }
  }
  return { error: "bright_data_adapter_failed", failureClass: "UNKNOWN", httpStatus: null }
}

/**
 * Imports rows from an already-created Bright Data snapshot. This boundary has
 * no trigger/scrape client and therefore cannot dispatch or repeat a billable
 * collection. The live collector and the recovery cron share it so resumed
 * snapshots get the exact same normalization, persistence and cost treatment.
 */
export async function importBrightDataSnapshotRows(
  input: BrightDataSnapshotImportInput,
  dependencies: BrightDataSnapshotImportDependencies = {
    loadTargets: defaultLoadTargets,
    persist: persistBrightDataBatches,
    finalize: defaultFinalize,
    runWithinImportFence: withSocialMonitoringImportFence,
  },
): Promise<MonitoringCollectorResult> {
  const maxItems = Math.max(1, Math.min(1_000, Math.trunc(input.source.routeExecution?.maxItems ?? 100)))
  const targets = input.targets ?? await dependencies.loadTargets(input.source, input.capability, maxItems)
  const normalizationInputs = input.capability === "ENRICH_CONTENT"
    ? ["ENRICH_CONTENT", "READ_MEDIA", "UPDATE_METRICS"] as const
    : [input.capability]
  const normalized = normalizationInputs.map(batchCapability => normalizeBrightDataProviderBatch({
    platform: input.source.platform as "instagram" | "facebook" | "tiktok",
    capability: batchCapability,
    rows: input.rows,
    observedAt: input.now.toISOString(),
    query: input.source.query ?? input.source.handle ?? input.source.url ?? null,
    parentPostExternalIds: targetIdentityMap(targets),
  }))
  const health = aggregateHealth(normalized.map(item => item.drift.health))
  const archiveFiltered = filterBrightDataBatchesForArchive(
    normalized.map(item => item.batch),
    input.archiveContext,
  )
  const primary = normalized[0].drift
  // Provider-fetch failure vs schema drift (owner regression 2026-07-21):
  // when Bright Data returns ONLY its own error rows (dead_page, proxy, …)
  // there is no payload to normalize — the page was not fetched at all.
  const totalValid = normalized.reduce((sum, item) => sum + item.drift.validCount, 0)
  const totalProviderErrors = normalized.reduce((sum, item) => sum + item.drift.providerErrorCount, 0)
  const providerErrorCounts = new Map<string, number>()
  for (const item of normalized) {
    for (const [code, count] of Object.entries(item.drift.failureCodes)) {
      if (!code.startsWith("provider_error:")) continue
      const slug = code.slice("provider_error:".length)
      providerErrorCounts.set(slug, (providerErrorCounts.get(slug) ?? 0) + count)
    }
  }
  const dominantProviderError = [...providerErrorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const providerFetchFailed = health === "FAILED" && totalValid === 0 && totalProviderErrors > 0 && dominantProviderError !== null
  const warnings = Array.from(new Set(normalized.flatMap(item => item.drift.warnings)))
  if (archiveFiltered.unknownTimestampCount > 0) {
    warnings.push("bright_data_archive:missing_published_at")
  }
  const archiveWindowPartial = archiveFiltered.unknownTimestampCount > 0
  const providerCoverageClass = health === "FAILED"
    ? "BLOCKED" as const
    : health === "DEGRADED" || archiveWindowPartial
      ? "PARTIAL" as const
      : input.rows.length >= input.requestedMaxRecords
        ? "SAMPLED" as const
        : "COMPLETE_FOR_INPUT" as const
  const importedCompletely = providerCoverageClass === "COMPLETE_FOR_INPUT"
  // Live collection freezes this provider ceiling in the run snapshot. Recovery
  // must reuse it: the current target set can differ from the originally
  // dispatched one, so deriving from today's target count can overstate the
  // per-input ceiling and incorrectly mark a capped result complete.
  const requestedLimitPerInput = Number.isInteger(input.requestedLimitPerInput)
    && Number(input.requestedLimitPerInput) > 0
    ? Number(input.requestedLimitPerInput)
    : Math.max(
        1,
        Math.trunc(input.requestedMaxRecords / Math.max(targets.length, 1)),
      )
  const fenced = await dependencies.runWithinImportFence({
    organizationId: input.source.organizationId,
    providerRunId: input.providerRunId,
    providerKey: BRIGHT_DATA_PROVIDER_KEY,
    expectedStatuses: input.providerRequestDispatched
      ? ["RUNNING", "SUCCEEDED"]
      : ["IMPORTING"],
  }, async () => {
    const persisted = await dependencies.persist({
      source: input.source,
      providerRunId: input.providerRunId,
      batches: archiveFiltered.batches,
      targets,
      now: input.now,
      providerCoverageClass,
      requestedLimitPerInput,
    })
    await dependencies.finalize({
      organizationId: input.source.organizationId,
      providerRunId: input.providerRunId,
      requestedUnits: input.requestedMaxRecords,
      deliveredRecords: input.rows.length,
      acceptedUnique: Math.min(input.rows.length, primary.validCount),
      reservedChargeUsd: input.reservedChargeUsd,
      priceSnapshot: input.priceSnapshot,
      finalStatus: importedCompletely ? "IMPORTED" : "PARTIAL",
      driftWarnings: warnings,
      now: input.now,
    })
    return persisted
  })
  if (!fenced.allowed) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: fenced.reason,
      rawStats: {
        providerRunId: input.providerRunId,
        providerRequestDispatched: input.providerRequestDispatched,
        ...(input.providerRequestDispatched ? { dispatchUnknown: true } : {}),
        failClosed: true,
        collectionFence: true,
      },
    }
  }
  const persisted = fenced.value

  return {
    status: health === "FAILED" ? "failed" : health === "DEGRADED" || archiveWindowPartial ? "partial" : "success",
    foundCount: input.rows.length,
    newCount: persisted.newCount,
    duplicateCount: persisted.duplicateCount,
    ignoredCount: persisted.ignoredCount
      + primary.invalidCount
      + archiveFiltered.outsideWindowCount
      + archiveFiltered.unknownTimestampCount,
    error: health === "FAILED"
      ? (providerFetchFailed ? `bright_data_provider_${dominantProviderError}` : "bright_data_schema_failed")
      : health === "DEGRADED"
        ? "bright_data_schema_degraded"
        : archiveWindowPartial
          ? "bright_data_archive_timestamp_incomplete"
          : null,
    rawStats: {
      providerRunId: input.providerRunId,
      providerStatus: importedCompletely ? "IMPORTED" : "PARTIAL",
      providerImported: true,
      providerRequestDispatched: input.providerRequestDispatched,
      coverageClass: providerCoverageClass,
      until: input.archiveContext?.until ?? input.now.toISOString(),
      ...(input.archiveContext
        ? {
            since: input.archiveContext.since,
            archiveCursorSince: input.archiveContext.cursorSince,
            archiveStartAt: input.archiveContext.archiveStartAt,
            targetScenarioId: input.archiveContext.targetScenarioId,
            resumedFromWatermark: input.archiveContext.resumedFromWatermark,
            archiveOverlapMinutes: input.archiveContext.overlapMinutes,
            archiveOutsideWindowCount: archiveFiltered.outsideWindowCount,
            archiveUnknownTimestampCount: archiveFiltered.unknownTimestampCount,
          }
        : {}),
      schemaHealth: health,
      validCount: primary.validCount,
      invalidCount: primary.invalidCount,
      warnings,
      coalescedCapabilities: normalizationInputs,
      costEstimatedOnly: true,
      costUnavailable: false,
      manualPaidRun: input.manualPaidRun,
      ...(providerFetchFailed ? { providerFetchFailed: true } : {}),
    },
  }
}

export async function runBrightDataCollector(
  source: MonitoringSourceForRun,
  dependencies: BrightDataAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<MonitoringCollectorResult> {
  if (!isBrightDataLiveRoutingAllowed(source.organizationId)) {
    return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "bright_data_live_routing_disabled", rawStats: { providerRequestDispatched: false } }
  }
  const sourceCapability = source.routeExecution?.capability
  const capability = sourceCapability ? brightDataProviderCapability(sourceCapability) : null
  if (!capability) {
    return { status: "failed", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "bright_data_route_context_invalid", rawStats: { providerRequestDispatched: false } }
  }
  if (brightDataCoalescedReplayCapability(capability)) {
    return await dependencies.reuseEnrichment(source, capability) ?? {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "bright_data_enrichment_reuse_missing",
    }
  }
  const manualPaidRun = source.routeExecution?.manualPaidRun === true
  const providerRunId = source.routeExecution?.providerRunId
  if (!providerRunId) {
    return { status: "failed", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "bright_data_budget_reservation_required" }
  }
  const route = brightDataRouteFor(BRIGHT_DATA_SOCIAL_ROUTES, source.platform, capability)
  if (!route) {
    return { status: "failed", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "bright_data_dataset_route_missing", rawStats: { providerRequestDispatched: false } }
  }
  const maxItems = Math.max(1, Math.min(1_000, Math.trunc(source.routeExecution?.maxItems ?? 100)))
  const timeoutSeconds = Math.max(30, Math.min(3_600, Math.trunc(source.routeExecution?.timeoutSeconds ?? 900)))
  const targets = await dependencies.loadTargets(source, capability, maxItems)
  const inputs = brightDataInputsFor(source, capability, targets)
  if (inputs.length === 0) {
    const discoveryInputMissing = capability === "DISCOVER_URLS"
    return {
      // Dependent enrichment is idempotent: when discovery produced no new
      // targets (or all targets were already processed), there is nothing to
      // dispatch and the configured input is fully complete.
      status: discoveryInputMissing ? "skipped" : "success",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: discoveryInputMissing ? "bright_data_discovery_input_missing" : null,
      rawStats: {
        coverageClass: discoveryInputMissing ? "BLOCKED" : "COMPLETE_FOR_INPUT",
        noOp: true,
        noOpReason: discoveryInputMissing
          ? "bright_data_discovery_input_missing"
          : "bright_data_parent_targets_already_processed",
        providerRequestDispatched: false,
      },
    }
  }
  const token = process.env.BRIGHT_DATA_API_TOKEN?.trim()
  if (!token) {
    return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "bright_data_token_missing", rawStats: { providerRequestDispatched: false } }
  }
  const price = dependencies.priceSnapshot()
  if (price.status !== "READY") {
    return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: price.reason, rawStats: { providerRequestDispatched: false } }
  }
  const priceSnapshot = price.snapshot
  const run = await dependencies.getRun(source.organizationId, providerRunId)
  if (!run) {
    return { status: "failed", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "bright_data_budget_reservation_invalid", rawStats: { providerRequestDispatched: false } }
  }
  const requestedMaxRecords = inputs.length * maxItems
  const estimatedChargeUsd = roundUsd(
    (requestedMaxRecords * priceSnapshot.usdPerThousandRecords) / 1000,
  )
  const reservedChargeUsd = estimatedChargeUsd
  const now = dependencies.now()
  const archiveContext = brightDataArchiveContextForSource(source, now)
  const inputHash = hmacToken(JSON.stringify(inputs), `bright-data-input:${source.organizationId}:${providerRunId}`)
  let providerRequestDispatched = false
  let snapshotAccepted = false

  try {
    await dependencies.prepareRun({
      organizationId: source.organizationId,
      providerRunId,
      datasetId: route.datasetId,
      phase: phaseFor(capability),
      inputHash,
      inputCount: inputs.length,
      platform: source.platform,
      capability,
      priceSnapshotId: priceSnapshot.id,
      requestedLimitPerInput: maxItems,
      estimatedChargeUsd,
      existingInputSnapshot: run.inputSnapshot,
      archiveContext,
    })
    const client = dependencies.createClient(
      token,
      timeoutSeconds * 1_000,
      source.providerRequestSignal,
    )
    const dispatchFence = await dependencies.runWithinImportFence({
      organizationId: source.organizationId,
      providerRunId,
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      expectedStatuses: ["QUEUED"],
      blockOnEmergencyStop: true,
    }, async () => {
      const beganDispatch = await dependencies.beginDispatch(
        source.organizationId,
        providerRunId,
      )
      if (!beganDispatch) throw new Error("bright_data_dispatch_claim_failed")
      providerRequestDispatched = true
      const dispatched = await client.trigger({
        datasetId: route.datasetId,
        inputs,
        limitPerInput: maxItems,
        includeErrors: true,
        operation: route.operation,
        discoverBy: route.discoverBy,
      })
      snapshotAccepted = true
      try {
        await dependencies.setExternalRunId(source.organizationId, providerRunId, dispatched.snapshotId)
      } catch (error) {
        // The provider accepted a billable snapshot but local ownership was
        // lost (typically a concurrent reset). Best-effort cancellation keeps
        // the remote side aligned; the original CAS error remains authoritative.
        await client.cancel(dispatched.snapshotId).catch(() => undefined)
        throw error
      }
      return dispatched
    })
    if (!dispatchFence.allowed) {
      return {
        status: "skipped",
        foundCount: 0,
        newCount: 0,
        duplicateCount: 0,
        ignoredCount: 0,
        error: dispatchFence.reason,
        rawStats: {
          providerRunId,
          providerRequestDispatched: false,
          failClosed: true,
          collectionFence: true,
        },
      }
    }
    const snapshotId = dispatchFence.value.snapshotId
    // Manual runs execute behind a user-facing HTTP request. Bright Data
    // snapshots routinely need longer than Cloudflare's request timeout, so
    // return as soon as the durable snapshot id is recorded. The GET-only
    // reconciliation worker owns polling, download and import from here.
    if (manualPaidRun) {
      return {
        status: "partial",
        foundCount: 0,
        newCount: 0,
        duplicateCount: 0,
        ignoredCount: 0,
        error: "bright_data_snapshot_pending",
        rawStats: {
          providerRunId,
          providerRequestDispatched: true,
          asyncPending: true,
          manualPaidRun: true,
          snapshotIdRecorded: true,
          ...(archiveContext
            ? {
                since: archiveContext.since,
                until: archiveContext.until,
                archiveStartAt: archiveContext.archiveStartAt,
                targetScenarioId: archiveContext.targetScenarioId,
                resumedFromWatermark: archiveContext.resumedFromWatermark,
              }
            : {}),
        },
      }
    }
    await client.pollUntilReady(snapshotId, {
      maxAttempts: Math.min(300, Math.max(1, Math.ceil(timeoutSeconds / 5))),
      initialIntervalMs: 1_000,
      maxIntervalMs: 5_000,
    })
    const rows = await client.download(snapshotId)

    return await importBrightDataSnapshotRows({
      source,
      providerRunId,
      capability,
      rows,
      targets,
      requestedMaxRecords,
      requestedLimitPerInput: maxItems,
      reservedChargeUsd,
      priceSnapshot,
      now,
      manualPaidRun,
      providerRequestDispatched: true,
      archiveContext,
    }, dependencies)
  } catch (error) {
    const stable = stableProviderError(error)
    const dispatchUnknown = snapshotAccepted || (
      providerRequestDispatched && (
        !(error instanceof BrightDataApiError)
        || error.httpStatus === null
        || error.httpStatus < 400
        || error.httpStatus >= 500
      )
    )
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: stable.error,
      rawStats: {
        providerRunId,
        failureClass: stable.failureClass,
        httpStatus: stable.httpStatus,
        rawPayloadStored: false,
        providerRequestDispatched,
        dispatchUnknown,
      },
    }
  }
}
