import { prisma } from "@/lib/prisma"
import { decryptToken } from "@/lib/secure-token"
import { runBrowserCaptureCollector } from "@/lib/social/browser-capture-adapter"
import { findMatchedKeyword, ingestMentionWithResult, type IngestInput, type ParentMatchContext } from "@/lib/social/ingest-mention"
import { runNotificationInboxCollector } from "@/lib/social/notification-inbox-adapter"
import { runProviderApiCollector } from "@/lib/social/provider-adapter"
import { runSearchIndexCollector } from "@/lib/social/search-index-adapter"
import { runAzerbaijanNewsCollector } from "@/lib/social/azerbaijan-news-adapter"
import { runGoogleAlertsRssCollector } from "@/lib/social/google-alerts-rss-adapter"
import { getSocialMonitoringSettings, mergeMonitoringSettingsIntoSourceSettings } from "@/lib/social/monitoring-settings"
import { getMonitoringScenariosUncached } from "@/lib/social/monitoring-scenarios"
import { observationContextForCollector, routeExecutionMetadata } from "@/lib/social/collector-observation-context"
import { runYouTubeCommentsCollector } from "@/lib/social/youtube-comments-adapter"
import { runVkCommentsCollector } from "@/lib/social/vk-comments-adapter"
import { runTelegramDiscussionCollector } from "@/lib/social/telegram-scanner"
import { runXOfficialCollector } from "@/lib/social/twitter-poller"
import { hasApifyCommentCandidates, runApifyAsyncCollector } from "@/lib/social/apify-async-adapter"
import { runBrightDataCollector } from "@/lib/social/bright-data-adapter"
import { runTikTokBusinessCommentsCollector } from "@/lib/social/tiktok-business-comments-adapter"
import { reconcileTikTokPublicationRevisitsForSource } from "@/lib/social/tiktok-publication-revisit-repo"
import { parentMatchContextsForComments } from "@/lib/social/parent-match-context"
import { classifyMetaGraphHttpFailure, collectMetaGraphCommentThreads, collectMetaGraphConnection, metaGraphCursorFetchUrl, sanitizeMetaGraphCursorUrl, type MetaGraphConnectionPage } from "@/lib/social/meta-graph-pagination"
import {
  META_GRAPH_CURSOR_COMPLETE,
  applyMetaGraphQuarantines,
  clearMetaGraphCommentBatchCursors,
  loadMetaGraphCursors,
  metaGraphReplyCursorKey,
  metaGraphStoredPendingReplies,
  metaGraphStoredTargets,
  metaGraphStoredWatchTargets,
  metaGraphTargetCursorKey,
  metaGraphTargetCursorValue,
  metaGraphTopCursorKey,
  planMetaGraphCommentCursorUpdates,
  rotateMetaGraphTargets,
  saveMetaGraphCursor,
  saveMetaGraphCursorUpdates,
  metaGraphWatchTargetCursorKey,
} from "@/lib/social/meta-graph-cursor"
import { ROUTE_ADAPTERS, SOURCE_ROUTE_POLICY_VERSION, compileSourceRoutePlans, instagramBusinessDiscoveryUsername, recordSourceRouteResult, selectedAdapterForPlan, type SourceCapability } from "@/lib/social/source-route-plan"
import { isBrightDataLiveRoutingAllowed } from "@/lib/social/bright-data-live-routing"
import { isApifySocialReadRouteAllowed, isApifyRouteReference, isBrightDataOnlyPlatform } from "@/lib/social/bright-data-policy"
import { auditProviderFailback } from "@/lib/social/provider-failback-reconciliation"
import {
  isSocialProviderTimeoutError,
  SOCIAL_PROVIDER_RUN_TIMEOUT_MAX_MS,
  withSocialProviderRunTimeout,
  withSocialProviderTimeout,
} from "@/lib/social/provider-request-timeout"
import {
  beginPaidRouteBudgetDispatch,
  finishPaidRouteBudgetReservation,
  requiresPaidRouteBudget,
  reservePaidRouteBudget,
  usesProviderAccountBudget,
} from "@/lib/social/paid-route-budget"
import {
  authorizeTenantManualPaidRun,
  finalizeTenantManualPaidRunAuthorization,
  PAID_RUN_PHASE,
  parseTenantPaidRunPolicy,
  tenantPaidRunEmergencyStopped,
} from "@/lib/social/paid-run-authorization"
import {
  advanceMonitoringRouteProviderCursor,
  providerFetchWatermarkForResult,
  scenarioArchiveStartAtForSource,
  shouldAdvanceMonitoringRouteProviderCursor,
} from "@/lib/social/archive-provider-window"
import { isInfraConfigError } from "@/lib/social/collector-error-classifier"
import { monitoringProfileScenarioRoutePlans } from "@/lib/social/monitoring-profile-run-plan"
import {
  allocateClientFundedSourceCapsUsd,
  CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD,
} from "@/lib/social/provider-spend-limits"
import {
  allowsAutomaticRouteAdapter,
  automaticSourceCollectionDecision,
  type AutomaticRoutePlan,
} from "@/lib/social/automatic-collection-policy"
import {
  assertMonitoringSourceIdentityCollectable,
  MonitoringSourceIdentityBlockedError,
  OFFICIAL_IDENTITY_NOT_COLLECTABLE,
} from "@/lib/social/monitoring-source-protection"
import {
  socialMonitoringCleanSlateBlocked,
  withSocialMonitoringTenantCollectionFence,
} from "@/lib/social/monitoring-import-fence"
import type { MonitoringAuthorIdentity } from "@/lib/social/mention-author-scope"
import crypto from "crypto"

export type CollectorStatus = "success" | "partial" | "failed" | "skipped"

export interface MonitoringCollectorResult {
  status: CollectorStatus
  foundCount: number
  newCount: number
  duplicateCount: number
  ignoredCount: number
  error?: string | null
  rawStats?: Record<string, unknown>
  /** Exact provider coverage boundary; successful source watermarks must not pass it. */
  successfulThroughAt?: Date | null
}

export interface CollectorEvidenceDraft {
  permalink?: string | null
  screenshotUrl?: string | null
  rawSnippet?: string | null
  rawPayload?: Record<string, unknown>
  confidence: number
  sourceTrustTier: string
}

export interface NormalizedCollectorMention {
  platform: string
  externalId?: string | null
  permalink?: string | null
  authorName?: string | null
  authorHandle?: string | null
  text: string
  publishedAt?: Date | null
  metadata?: Record<string, unknown>
}

export interface MonitoringCollectorAdapter {
  canRun(source: MonitoringSourceForRun): boolean
  run(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult>
  normalize(rawItem: unknown, source: MonitoringSourceForRun): NormalizedCollectorMention | null
  dedupeKey(item: NormalizedCollectorMention, source: MonitoringSourceForRun): string
  evidence(item: NormalizedCollectorMention, source: MonitoringSourceForRun): CollectorEvidenceDraft
}

export interface MonitoringSourceForRun {
  id: string
  organizationId: string
  platform: string
  sourceType: string
  url?: string | null
  handle?: string | null
  query?: string | null
  ownership?: string
  collectionMode: string
  status: string
  cadenceMinutes: number
  lastCheckedAt: Date | null
  lastSuccessfulAt: Date | null
  lastError: string | null
  runClaimToken?: string | null
  runClaimExpiresAt?: Date | null
  runClaimVersion?: number
  settings: unknown
  keywords?: string[]
  ownedIdentity?: MonitoringAuthorIdentity
  /** Ephemeral adapter-run deadline. Never persisted in source metadata. */
  providerRequestSignal?: AbortSignal
  routeExecution?: {
    collectorRunId: string
    routePlanId: string
    capability: string
    adapterKey: string
    acquisitionMode: string
    providerKey?: string | null
    providerRunId?: string | null
    maxItems?: number
    timeoutSeconds?: number
    manualSourceRun?: boolean
    manualPaidRun?: boolean
    manualMaxTotalChargeUsd?: number
    clientFundedManual?: boolean
    targetScenarioId?: string
    targetSubjectId?: string
    archiveStartAt?: string | null
    suppressDependentPaidRuns?: boolean
    dependentCommentsAuthorized?: boolean
    dependentCommentsMaxTotalChargeUsd?: number
    sourceAuthorizedMaxTotalChargeUsd?: number
    discoveryMaxTotalChargeUsd?: number
    fullArchiveRun?: boolean
    instagramResultsType?: "posts" | "reels"
    suppressFreshDiscoveryReuse?: boolean
    dependentProviderRun?: boolean
    parentProviderRunId?: string
    /**
     * Термин, которым этот прогон ищет вместо канонического запроса источника
     * (#638). Родной поиск Facebook принимает один запрос, поэтому алиасные
     * слоты веера — отдельные дочерние прогоны, каждый со своим термином и
     * своим курсором.
     */
    providerSearchTermOverride?: string
    providerRunMaxItemsOverride?: number
    providerRunMaxTotalChargeUsdOverride?: number
    providerWindowOverride?: {
      cursorSince: string
      since: string
      until: string
      resumedFromWatermark: boolean
      clamped: boolean
      overlapMinutes?: number
    }
  }
}

export interface CollectorRunSummary extends MonitoringCollectorResult {
  runId: string
  sourceId: string
}

/**
 * A bounded, run-scoped view of observation decisions. Reasons are supplied
 * by adapters/providers, so keep this aggregate deliberately small and never
 * persist arbitrary unbounded strings in CollectorRun.rawStats.
 */
export interface CollectorRunRejectionHistogram {
  total: number
  byReason: Record<string, number>
  byStatus: Record<string, number>
}

const REJECTION_STATUSES = new Set(["REVIEW", "REJECTED", "POLICY_DENIED", "DELETED_AT_SOURCE"])
const MAX_REJECTION_REASON_KEYS = 64

export function buildCollectorRunRejectionHistogram(
  rows: Array<{ relevanceStatus: string | null; relevanceReason: string | null }>,
): CollectorRunRejectionHistogram {
  const byReason: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  let total = 0

  for (const row of rows) {
    const status = row.relevanceStatus?.trim().toUpperCase() || "UNKNOWN"
    if (!REJECTION_STATUSES.has(status)) continue
    total += 1
    byStatus[status] = (byStatus[status] ?? 0) + 1

    const rawReason = row.relevanceReason?.trim().toLowerCase().slice(0, 120)
    const reason = rawReason || "unknown"
    if (byReason[reason] !== undefined || Object.keys(byReason).length < MAX_REJECTION_REASON_KEYS) {
      byReason[reason] = (byReason[reason] ?? 0) + 1
    } else {
      byReason.other = (byReason.other ?? 0) + 1
    }
  }

  return { total, byReason, byStatus }
}

/** Read only the tenant/run rows needed for observability. */
export async function getCollectorRunRejectionHistogram(
  organizationId: string,
  collectorRunId: string,
): Promise<CollectorRunRejectionHistogram> {
  const rows = await prisma.ingestEnvelope.findMany({
    where: {
      organizationId,
      collectorRunId,
      relevanceStatus: { in: Array.from(REJECTION_STATUSES) },
    },
    select: { relevanceStatus: true, relevanceReason: true },
  })
  return buildCollectorRunRejectionHistogram(rows)
}

export interface DueSourceSelection {
  dueAt: Date | null
  due: boolean
  reason: "never_checked" | "cadence_due" | "backoff_wait" | "inactive"
  backoffMultiplier: number
  cadenceMinutes: number
}

type RecentRun = { status: string; startedAt: Date; error: string | null; foundCount?: number | null }
type OfficialSocialAccount = {
  id: string
  platform: string
  handle: string
  displayName: string | null
  accessToken: string | null
  keywords: string[]
}

const COLLECTOR_LEASE_MS = 15 * 60_000
const COLLECTOR_SETTLEMENT_MARGIN_MS = 30_000
const MAX_BACKOFF_MULTIPLIER = 8
const GRAPH = "https://graph.facebook.com/v21.0"
const META_COMMENT_MAX_TOTAL_PAGES = 100
const META_COMMENT_MAX_PAGES_PER_CONNECTION = 10
const META_COMMENT_MAX_TOTAL_ITEMS = 2_000
const META_PARENT_MAX_PAGES = 10
const META_PARENT_MAX_ITEMS = 500

type FacebookGraphComment = {
  id: string
  message?: string
  from?: { id?: string; name?: string }
  created_time?: string
  like_count?: number
  permalink_url?: string
  parent?: { id?: string }
  comments?: MetaGraphConnectionPage<FacebookGraphComment>
  replies?: MetaGraphConnectionPage<FacebookGraphComment>
}

type FacebookGraphPost = { id: string; created_time?: string; permalink_url?: string }
type InstagramGraphMedia = { id: string; permalink?: string; timestamp?: string }

type InstagramGraphComment = {
  id: string
  text?: string
  username?: string
  timestamp?: string
  like_count?: number
  parent_id?: string
  replies?: MetaGraphConnectionPage<InstagramGraphComment>
  comments?: MetaGraphConnectionPage<InstagramGraphComment>
}

function metaCommentItemLimit(source: MonitoringSourceForRun): number {
  const configured = source.routeExecution?.maxItems
  if (typeof configured !== "number" || !Number.isFinite(configured) || configured <= 0) {
    return 1_000
  }
  // Native Graph reads are not billed per result. Generic route plans often
  // carry maxItems=100, which is too small for a complete multi-post comment
  // traversal and would repeatedly strand later pages without a persisted
  // cursor. Keep a bounded but useful floor for this owned-comment route.
  return Math.max(1_000, Math.min(Math.trunc(configured), META_COMMENT_MAX_TOTAL_ITEMS))
}

export type MonitoringSourceRunClaim = {
  token: string
  version: number
  expiresAt: Date
}

export class MonitoringSourceClaimUnavailableError extends Error {
  retryAfterSeconds?: number

  constructor(retryAfterSeconds?: number) {
    super("collector_already_running")
    this.name = "MonitoringSourceClaimUnavailableError"
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class SocialMonitoringCollectionBlockedError extends Error {
  constructor() {
    super("social_monitoring_collection_blocked")
    this.name = "SocialMonitoringCollectionBlockedError"
  }
}

export async function claimMonitoringSourceRun(
  organizationId: string,
  sourceId: string,
  now = new Date(),
  leaseMs = COLLECTOR_LEASE_MS,
  eligibleStatuses: readonly string[] = ["active", "limited", "needs_setup"],
): Promise<MonitoringSourceRunClaim | null> {
  const token = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + leaseMs)
  const claimed = await prisma.monitoringSource.updateMany({
    where: {
      id: sourceId,
      organizationId,
      status: { in: [...eligibleStatuses] },
      OR: [
        { runClaimToken: null },
        { runClaimExpiresAt: null },
        { runClaimExpiresAt: { lte: now } },
      ],
    },
    data: {
      runClaimToken: token,
      runClaimExpiresAt: expiresAt,
      runClaimVersion: { increment: 1 },
    },
  })
  if (claimed.count !== 1) return null

  const source = await prisma.monitoringSource.findFirst({
    where: { id: sourceId, organizationId, runClaimToken: token },
    select: { runClaimVersion: true, runClaimExpiresAt: true },
  })
  if (!source?.runClaimExpiresAt) {
    await prisma.monitoringSource.updateMany({
      where: { id: sourceId, organizationId, runClaimToken: token },
      data: { runClaimToken: null, runClaimExpiresAt: null },
    })
    return null
  }
  return { token, version: source.runClaimVersion, expiresAt: source.runClaimExpiresAt }
}

export async function releaseMonitoringSourceRunClaim(
  organizationId: string,
  sourceId: string,
  claim: MonitoringSourceRunClaim,
): Promise<boolean> {
  const released = await prisma.monitoringSource.updateMany({
    where: {
      id: sourceId,
      organizationId,
      runClaimToken: claim.token,
      runClaimVersion: claim.version,
    },
    data: { runClaimToken: null, runClaimExpiresAt: null },
  })
  return released.count === 1
}

type MonitoringSourceClaimFenceResult<T> =
  | { allowed: true; value: T }
  | {
      allowed: false
      reason: "social_monitoring_collection_blocked" | "collector_lease_lost"
    }

async function withCurrentMonitoringSourceClaimFence<T>(
  source: Pick<MonitoringSourceForRun, "id" | "organizationId">,
  claim: MonitoringSourceRunClaim,
  eligibleStatuses: readonly string[],
  action: () => Promise<T>,
): Promise<MonitoringSourceClaimFenceResult<T>> {
  const fenced = await withSocialMonitoringTenantCollectionFence(
    source.organizationId,
    async () => {
      const currentClaim = await prisma.monitoringSource.findFirst({
        where: {
          id: source.id,
          organizationId: source.organizationId,
          status: { in: [...eligibleStatuses] },
          runClaimToken: claim.token,
          runClaimVersion: claim.version,
          runClaimExpiresAt: { gt: new Date() },
        },
        select: { id: true },
      })
      if (!currentClaim) return { owned: false as const }
      return { owned: true as const, value: await action() }
    },
  )
  if (!fenced.allowed) return fenced
  if (!fenced.value.owned) {
    return { allowed: false, reason: "collector_lease_lost" }
  }
  return { allowed: true, value: fenced.value.value }
}

function requireCurrentMonitoringSourceClaim<T>(
  result: MonitoringSourceClaimFenceResult<T>,
): T {
  if (result.allowed) return result.value
  if (result.reason === "social_monitoring_collection_blocked") {
    throw new SocialMonitoringCollectionBlockedError()
  }
  throw new MonitoringSourceClaimUnavailableError()
}

export async function reapStaleMonitoringSourceLeases(options: {
  organizationId?: string
  limit?: number
  now?: Date
} = {}) {
  const now = options.now ?? new Date()
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500)
  const staleSources = await prisma.monitoringSource.findMany({
    where: {
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      runClaimToken: { not: null },
      runClaimExpiresAt: { lte: now },
    },
    select: {
      id: true,
      organizationId: true,
      runClaimToken: true,
      runClaimVersion: true,
      runClaimExpiresAt: true,
    },
    orderBy: { runClaimExpiresAt: "asc" },
    take: limit,
  })

  let reaped = 0
  let runsFailed = 0
  for (const stale of staleSources) {
    if (!stale.runClaimToken || !stale.runClaimExpiresAt) continue
    const released = await prisma.monitoringSource.updateMany({
      where: {
        id: stale.id,
        organizationId: stale.organizationId,
        runClaimToken: stale.runClaimToken,
        runClaimVersion: stale.runClaimVersion,
        runClaimExpiresAt: { lte: now },
      },
      data: {
        runClaimToken: null,
        runClaimExpiresAt: null,
        lastError: "collector_lease_expired",
      },
    })
    if (released.count !== 1) continue
    reaped += 1

    const failed = await prisma.collectorRun.updateMany({
      where: {
        organizationId: stale.organizationId,
        sourceId: stale.id,
        claimToken: stale.runClaimToken,
        claimVersion: stale.runClaimVersion,
        status: "running",
        leaseExpiresAt: { lte: now },
        finishedAt: null,
      },
      data: {
        status: "failed",
        error: "collector_lease_expired",
        finishedAt: now,
      },
    })
    runsFailed += failed.count
  }

  return { scanned: staleSources.length, reaped, runsFailed, hasMore: staleSources.length === limit }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function providerRunShowsDispatchExposure(run: {
  inputSnapshot: unknown
  externalRunId: string | null
  reservedChargeUsd: unknown
  actualChargeUsd: unknown
}): boolean {
  const marker = recordFromUnknown(run.inputSnapshot).providerRequestDispatched
  // Explicit durable false wins over a still-held reservation. A reservation
  // is only a conservative legacy fallback when no boolean marker exists;
  // remote id or actual charge remain hard evidence of provider exposure.
  return marker === true
    || Boolean(run.externalRunId)
    || Number(run.actualChargeUsd ?? 0) > 0
    || (marker !== false && Number(run.reservedChargeUsd ?? 0) > 0)
}

function consecutiveFailures(recentRuns: RecentRun[]): number {
  let count = 0
  for (const run of recentRuns) {
    if (run.status === "failed" || run.status === "partial") count++
    else break
  }
  return count
}


function consecutiveEmptySuccesses(recentRuns: RecentRun[]): number {
  let count = 0
  for (const run of recentRuns) {
    if (run.status === "success" && (run.foundCount ?? 0) === 0) count++
    else break
  }
  return count
}

export function backoffMultiplierForRuns(recentRuns: RecentRun[]): number {
  const failures = consecutiveFailures(recentRuns)
  const emptyRuns = consecutiveEmptySuccesses(recentRuns)
  // Exponential backoff (2^failures, cap x8) exists to protect providers from
  // hammering. A failure streak that never reached a provider must not inherit
  // it: with cadence 360-480m, x8 put whole groups of sources to sleep for
  // 2-3 DAYS, so budget/route fixes silently didn't take effect (prod
  // 2026-07-20: ~30 FB/IG page sources dormant 21h+ after the budget rollout).
  const infraOnly = failures > 0
    && recentRuns.slice(0, failures).every(run => isInfraConfigError(run.error))
  const failureMultiplier = infraOnly ? Math.min(2, 2 ** failures) : 2 ** failures
  return Math.min(MAX_BACKOFF_MULTIPLIER, Math.max(1, failureMultiplier, emptyRuns >= 3 ? 2 : 1, emptyRuns >= 6 ? 4 : 1))
}

export function effectiveCadenceMinutes(source: MonitoringSourceForRun): number {
  const settings = recordFromUnknown(source.settings)
  const selectiveDiscovery = recordFromUnknown(settings.selectiveDiscovery)
  const selectiveContract = typeof selectiveDiscovery.contractVersion === "string"
    ? selectiveDiscovery.contractVersion
    : null
  // Query expansion priorities are allowed to speed up ordinary free
  // collectors, but the selective YouTube/TikTok packs deliberately compile
  // to one bounded discovery run per day. Letting an inherited 30-minute
  // expanded-query cadence override that contract repeatedly burns provider
  // quota (YouTube search.list has a scarce daily call bucket) or paid-run
  // allowance.
  if (
    source.ownership === "external"
    && (
      (source.platform === "youtube" && selectiveContract === "youtube-selective-query-pack-v1")
      || (source.platform === "tiktok" && selectiveContract === "tiktok-selective-query-pack-v1")
    )
  ) {
    return 1440
  }
  const expandedQueries = Array.isArray(settings.expandedQueries) ? settings.expandedQueries : []
  const expandedCadences = expandedQueries
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null
      const cadence = (item as Record<string, unknown>).cadenceMinutes
      return typeof cadence === "number" && Number.isFinite(cadence) ? cadence : null
    })
    .filter((value): value is number => value !== null)
  return Math.max(15, Math.min(source.cadenceMinutes, ...expandedCadences))
}

export function monitoringSourceDueState(
  source: MonitoringSourceForRun,
  recentRuns: RecentRun[],
  now = new Date(),
  scheduledCadenceMinutes?: number,
): DueSourceSelection {
  if (!["active", "limited", "needs_setup"].includes(source.status)) {
    return { dueAt: null, due: false, reason: "inactive", backoffMultiplier: 1, cadenceMinutes: source.cadenceMinutes }
  }

  const cadenceMinutes = scheduledCadenceMinutes === undefined
    ? effectiveCadenceMinutes(source)
    : Math.max(15, Math.min(31 * 24 * 60, Math.trunc(scheduledCadenceMinutes)))
  const backoffMultiplier = backoffMultiplierForRuns(recentRuns)
  if (!source.lastCheckedAt) {
    return { dueAt: null, due: true, reason: "never_checked", backoffMultiplier, cadenceMinutes }
  }

  const dueAt = new Date(source.lastCheckedAt.getTime() + cadenceMinutes * backoffMultiplier * 60_000)
  return {
    dueAt,
    due: dueAt.getTime() <= now.getTime(),
    reason: dueAt.getTime() <= now.getTime() ? "cadence_due" : "backoff_wait",
    backoffMultiplier,
    cadenceMinutes,
  }
}

function notConfiguredResult(source: MonitoringSourceForRun): MonitoringCollectorResult {
  return {
    status: "skipped",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: "collector_not_configured",
    rawStats: {
      collectionMode: source.collectionMode,
      platform: source.platform,
      sourceType: source.sourceType,
      safeMode: true,
    },
  }
}

function appsecretProof(token: string): string | null {
  const secret = process.env.FACEBOOK_APP_SECRET
  if (!secret) return null
  return crypto.createHmac("sha256", secret).update(token).digest("hex")
}

function graphUrl(path: string, token: string, params: Record<string, string | number | undefined | null> = {}): string {
  const url = new URL(`${GRAPH}/${path.replace(/^\/+/, "")}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value))
  }
  const proof = appsecretProof(token)
  if (proof) url.searchParams.set("appsecret_proof", proof)
  return url.toString()
}

function graphAuthInit(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } }
}

function sourceTarget(source: MonitoringSourceForRun): string | null {
  const settings = recordFromUnknown(source.settings)
  const configured = typeof settings.socialAccountId === "string" ? settings.socialAccountId : null
  if (configured) return configured.toLowerCase()
  if (source.sourceType === "hashtag" || source.sourceType === "keyword") {
    return source.handle ? source.handle.replace(/^@+/, "").toLowerCase() : null
  }
  if (source.handle) return source.handle.replace(/^@+/, "").toLowerCase()
  if (source.query) return source.query.replace(/^#+/, "").toLowerCase()
  if (!source.url) return null
  try {
    const parsed = new URL(source.url)
    const parts = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean)
    return parts[0]?.replace(/^@+/, "").toLowerCase() || null
  } catch {
    return null
  }
}

function combinedSourceKeywords(source: MonitoringSourceForRun, accountKeywords: string[]): string[] {
  return [...accountKeywords, ...(source.keywords ?? [])]
}

function decryptSocialAccountToken(account: { platform: string; handle: string; accessToken: string | null }): string | null {
  if (!account.accessToken) return null
  try {
    return decryptToken(account.accessToken, `oauth:${account.platform}:${account.handle}`)
  } catch {
    if (account.platform === "tiktok") {
      try {
        return decryptToken(account.accessToken, "oauth:tiktok").split("::")[0] || null
      } catch {
        return null
      }
    }
    return null
  }
}

async function findOfficialSocialAccount(source: MonitoringSourceForRun): Promise<OfficialSocialAccount | null> {
  const settings = recordFromUnknown(source.settings)
  const explicitAccountId = typeof settings.socialAccountId === "string" ? settings.socialAccountId : null
  if (explicitAccountId) {
    return prisma.socialAccount.findFirst({
      where: {
        id: explicitAccountId,
        organizationId: source.organizationId,
        platform: source.platform,
        isActive: true,
        accessToken: { not: null },
      },
      select: { id: true, platform: true, handle: true, displayName: true, accessToken: true, keywords: true },
    })
  }

  const accounts: OfficialSocialAccount[] = await prisma.socialAccount.findMany({
    where: {
      organizationId: source.organizationId,
      platform: source.platform,
      isActive: true,
      accessToken: { not: null },
    },
    select: { id: true, platform: true, handle: true, displayName: true, accessToken: true, keywords: true },
    orderBy: { updatedAt: "desc" },
    take: 10,
  })
  if (accounts.length === 0) return null

  const target = sourceTarget(source)
  if (!target) return accounts.length === 1 ? accounts[0] : null
  return accounts.find((account: OfficialSocialAccount) => {
    const handle = account.handle.replace(/^@+/, "").toLowerCase()
    return handle === target || account.id.toLowerCase() === target || account.displayName?.toLowerCase() === target
  }) ?? null
}

async function fetchGraphJson<T>(url: string, token: string, parentSignal?: AbortSignal): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number; body: string }> {
  return withSocialProviderTimeout("meta_graph", async (signal) => {
    const res = await fetch(url, { ...graphAuthInit(token), signal })
    if (!res.ok) {
      const body = await res.text()
      const error = res.status === 401 || res.status === 403
        ? "official_permission_error"
        : res.status === 429
          ? "official_rate_limited"
          : "official_fetch_failed"
      return { ok: false as const, error, status: res.status, body }
    }
    return { ok: true as const, data: await res.json() as T }
  }, { signal: parentSignal })
}

async function ingestOfficialMention(
  source: MonitoringSourceForRun,
  input: IngestInput,
  evidence: CollectorEvidenceDraft,
  options: { requireMatchedTerm?: boolean } = {},
) {
  const result = await ingestMentionWithResult({
    ...input,
    sourceMetadata: {
      ...(input.sourceMetadata ?? {}),
      monitoringSourceId: source.id,
      collector: "official_api",
      collectionMode: source.collectionMode,
      ...routeExecutionMetadata(source),
    },
    observation: observationContextForCollector(source, {
      providerItemId: input.externalId,
      rawPayload: evidence.rawPayload,
      ...(options.requireMatchedTerm ? { requireMatchedTerm: true } : {}),
    }),
  })

  if (result.accepted === false) return result

  const existingEvidence = await prisma.mentionEvidence.findFirst({
    where: {
      organizationId: source.organizationId,
      mentionId: result.id,
      sourceId: source.id,
      ...(evidence.permalink ? { permalink: evidence.permalink } : {}),
    },
    select: { id: true },
  })
  if (!existingEvidence) {
    await prisma.mentionEvidence.create({
      data: {
        organizationId: source.organizationId,
        mentionId: result.id,
        sourceId: source.id,
        permalink: evidence.permalink ?? null,
        screenshotUrl: evidence.screenshotUrl ?? null,
        rawSnippet: evidence.rawSnippet ?? input.text,
        rawPayload: evidence.rawPayload ?? {},
        confidence: evidence.confidence,
        sourceTrustTier: evidence.sourceTrustTier,
      },
    })
  }

  return result
}

function officialResult(status: CollectorStatus, counts: Omit<MonitoringCollectorResult, "status">): MonitoringCollectorResult {
  return { status, ...counts }
}

async function runFacebookOfficialCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const account = await findOfficialSocialAccount(source)
  if (!account) return officialResult("skipped", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "official_account_not_connected", rawStats: { platform: "facebook" } })
  const token = decryptSocialAccountToken(account)
  if (!token) return officialResult("failed", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "official_token_unavailable", rawStats: { accountId: account.id } })

  // lastCheckedAt advances after partial runs; using it here would strand
  // unvisited comment pages. Only a fully successful traversal advances the
  // parent-discovery watermark.
  const since = source.lastSuccessfulAt ? Math.floor(source.lastSuccessfulAt.getTime() / 1000) : undefined
  const proof = appsecretProof(token)
  const cursorAccount = { id: account.id, organizationId: source.organizationId }
  const cursorPrefix = `source:${encodeURIComponent(source.id)}:facebook:`
  const parentCursorKey = `${cursorPrefix}parents`
  const parentResetCursorKey = `${cursorPrefix}reset:parents`
  const cycleCutoffCursorKey = `${cursorPrefix}cycle_cutoff`
  const rotationCursorKey = `${cursorPrefix}rotation`
  const loadedCursorState = await loadMetaGraphCursors(cursorAccount, cursorPrefix)
  const cursorState = applyMetaGraphQuarantines(loadedCursorState, cursorPrefix)
  const storedCycleCutoff = new Date(cursorState.get(cycleCutoffCursorKey) ?? "")
  const cycleCutoff = Number.isFinite(storedCycleCutoff.getTime())
    ? storedCycleCutoff
    : new Date(Math.floor(Date.now() / 1_000) * 1_000)
  if (!Number.isFinite(storedCycleCutoff.getTime())) {
    await saveMetaGraphCursor(cursorAccount, cycleCutoffCursorKey, cycleCutoff.toISOString())
  }
  const resumedParentUrl = metaGraphCursorFetchUrl(cursorState.get(parentCursorKey), GRAPH, proof)
  const posts = await collectMetaGraphConnection<FacebookGraphPost>({
    graphBaseUrl: GRAPH,
    appSecretProof: proof,
    initialUrl: resumedParentUrl ?? graphUrl("/me/posts", token, {
      fields: "id,created_time,permalink_url",
      limit: 50,
      since,
      until: Math.floor(cycleCutoff.getTime() / 1000),
    }),
    fetchPage: async url => {
      const page = await fetchGraphJson<MetaGraphConnectionPage<FacebookGraphPost>>(
        url,
        token,
        source.providerRequestSignal,
      )
      return page.ok
        ? { ok: true as const, data: page.data }
        : { ok: false as const, error: page.error, failureClass: classifyMetaGraphHttpFailure(page.status, url, page.body) }
    },
    maxPages: META_PARENT_MAX_PAGES,
    maxItems: META_PARENT_MAX_ITEMS,
  })
  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  let partialError: string | null = posts.error

  const recentPostsById = new Map(posts.items.map(post => [post.id, post]))
  for (const stored of [...metaGraphStoredTargets(cursorState, cursorPrefix), ...metaGraphStoredWatchTargets(cursorState, cursorPrefix)]) {
    const current = recentPostsById.get(stored.id)
    if (!current) {
      recentPostsById.set(stored.id, { id: stored.id, permalink_url: stored.url ?? undefined })
    } else if (!current.permalink_url && stored.url) {
      recentPostsById.set(stored.id, { ...current, permalink_url: stored.url })
    }
  }
  const recentPosts = Array.from(recentPostsById.values())
  if (posts.error && recentPosts.length === 0) {
    if (posts.failureClass === "invalid_cursor" && resumedParentUrl && !cursorState.get(parentResetCursorKey)) {
      await saveMetaGraphCursor(cursorAccount, parentCursorKey, null)
      await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, "1")
    }
    return officialResult("failed", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: posts.error, rawStats: { accountId: account.id, parentCoverage: { pages: posts.pages, capped: posts.capped } } })
  }
  const parentContexts: Map<string, ParentMatchContext> = await parentMatchContextsForComments(
    source.organizationId,
    "facebook",
    recentPosts.map(post => post.permalink_url).filter((url): url is string => Boolean(url)),
    recentPosts.map(post => post.id),
  )
  const commentItemLimit = metaCommentItemLimit(source)
  const topCursorValue = (postId: string) => cursorState.get(metaGraphTopCursorKey(cursorPrefix, postId))
  const activePosts = recentPosts.filter(post => topCursorValue(post.id) !== META_GRAPH_CURSOR_COMPLETE)
  const orderedPosts = rotateMetaGraphTargets(activePosts, cursorState.get(rotationCursorKey), post => post.id)
  const pendingFacebookReplies = metaGraphStoredPendingReplies(cursorState, cursorPrefix).flatMap(pending => {
    const post = recentPostsById.get(pending.targetId)
    return post ? [{ target: post, item: { id: pending.itemId } as FacebookGraphComment }] : []
  })
  const embeddedFacebookReplies = (comment: FacebookGraphComment) => comment.comments ?? comment.replies
  const facebookCommentsUrl = (post: FacebookGraphPost) => graphUrl(`/${post.id}/comments`, token, {
    fields: "id,message,from,created_time,like_count,permalink_url,parent{id},comments.limit(50){id,message,from,created_time,like_count,permalink_url,parent{id}}",
    limit: 50,
  })
  const facebookRepliesUrl = (comment: FacebookGraphComment) => graphUrl(`/${comment.id}/comments`, token, {
    fields: "id,message,from,created_time,like_count,permalink_url,parent{id}",
    limit: 50,
  })
  const comments = await collectMetaGraphCommentThreads<
    (typeof recentPosts)[number],
    FacebookGraphComment
  >({
    targets: orderedPosts,
    graphBaseUrl: GRAPH,
    appSecretProof: proof,
    initialUrl: facebookCommentsUrl,
    fetchPage: async url => {
      const page = await fetchGraphJson<MetaGraphConnectionPage<FacebookGraphComment>>(
        url,
        token,
        source.providerRequestSignal,
      )
      return page.ok
        ? { ok: true as const, data: page.data }
        : {
            ok: false as const,
            error: `meta_comments_fetch_failed_${page.status}`,
            failureClass: classifyMetaGraphHttpFailure(page.status, url, page.body),
          }
    },
    embeddedReplies: (comment, post) => {
      const replyKey = metaGraphReplyCursorKey(cursorPrefix, post.id, comment.id)
      return cursorState.get(replyKey) === META_GRAPH_CURSOR_COMPLETE ? null : embeddedFacebookReplies(comment)
    },
    itemId: comment => comment.id,
    replyParentId: reply => reply.parent?.id,
    topLevelResumeUrl: post => {
      const value = topCursorValue(post.id)
      return value && value !== META_GRAPH_CURSOR_COMPLETE
        ? metaGraphCursorFetchUrl(value, GRAPH, proof)
        : null
    },
    replyResumeUrl: (comment, post) => {
      const value = cursorState.get(metaGraphReplyCursorKey(cursorPrefix, post.id, comment.id))
      return value && value !== META_GRAPH_CURSOR_COMPLETE
        ? metaGraphCursorFetchUrl(value, GRAPH, proof)
        : null
    },
    pendingReplies: pendingFacebookReplies,
    maxPages: META_COMMENT_MAX_TOTAL_PAGES,
    maxPagesPerConnection: META_COMMENT_MAX_PAGES_PER_CONNECTION,
    maxItems: commentItemLimit,
  })
  if (comments.error) partialError = comments.error

  for (const { target: post, item: comment, replyToExternalId } of comments.records) {
    const text = (comment.message || "").trim()
    if (!text) {
      ignoredCount++
      continue
    }
    foundCount++
    const parentMatchContext = parentContexts.get(post.id)
      ?? (post.permalink_url ? parentContexts.get(post.permalink_url) : null)
      ?? null
    const result = await ingestOfficialMention(source, {
      organizationId: source.organizationId,
      accountId: account.id,
      platform: "facebook",
      externalId: `c:${comment.id}`,
      sourceType: replyToExternalId ? "reply" : "comment",
      contentKind: replyToExternalId ? "REPLY" : "COMMENT",
      postExternalId: post.id,
      parentExternalId: replyToExternalId ?? post.id,
      threadExternalId: post.id,
      replyToExternalId,
      depth: replyToExternalId ? 1 : 0,
      sourceProvider: "native",
      sourceMetadata: {
        postId: post.id,
        ...(replyToExternalId ? { parentCommentId: replyToExternalId } : {}),
        officialCollector: true,
      },
      text,
      sentiment: null,
      matchedTerm: findMatchedKeyword(text, combinedSourceKeywords(source, account.keywords)),
      engagement: comment.like_count ?? 0,
      url: post.permalink_url ?? null,
      canonicalUrl: comment.permalink_url ?? null,
      parentPostUrl: post.permalink_url ?? null,
      authorName: comment.from?.name ?? null,
      authorHandle: comment.from?.id ?? null,
      publishedAt: comment.created_time ? new Date(comment.created_time) : null,
      parentMatchContext,
    }, {
      permalink: post.permalink_url ?? null,
      rawSnippet: text,
      rawPayload: { post, comment, replyToExternalId },
      confidence: 0.95,
      sourceTrustTier: "T1",
    })
    if (result.created) newCount++
    else duplicateCount++
  }

  const cursorPlan = planMetaGraphCommentCursorUpdates({
    cursorPrefix,
    allTargets: recentPosts,
    orderedActiveTargets: orderedPosts,
    existing: cursorState,
    result: comments,
    targetId: post => post.id,
    itemId: comment => comment.id,
    embeddedReplies: embeddedFacebookReplies,
    initialTopLevelCursor: post => sanitizeMetaGraphCursorUrl(facebookCommentsUrl(post), GRAPH) ?? "",
    initialReplyCursor: comment => sanitizeMetaGraphCursorUrl(facebookRepliesUrl(comment), GRAPH) ?? "",
  })
  for (const post of recentPosts) {
    cursorPlan.updates.set(
      metaGraphTargetCursorKey(cursorPrefix, post.id),
      metaGraphTargetCursorValue(post.permalink_url),
    )
    const context = parentContexts.get(post.id)
      ?? (post.permalink_url ? parentContexts.get(post.permalink_url) : null)
      ?? null
    if (context?.inheritAllCommentSubjectIds?.length) {
      cursorPlan.updates.set(
        metaGraphWatchTargetCursorKey(cursorPrefix, post.id),
        metaGraphTargetCursorValue(post.permalink_url),
      )
    }
  }
  await saveMetaGraphCursorUpdates(cursorAccount, cursorPlan.updates)
  const canAdvanceParentCursor = cursorPlan.allTargetsComplete
    && (!posts.error || (Boolean(posts.resumeUrl) && !posts.failureClass))
  if (canAdvanceParentCursor) {
    // Clear the completed batch first. If the process exits before the parent
    // cursor write, the next run only repeats already-idempotent ingestion.
    await clearMetaGraphCommentBatchCursors(cursorAccount, cursorPrefix)
    await saveMetaGraphCursor(cursorAccount, parentCursorKey, posts.resumeUrl)
    await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, null)
    if (!posts.resumeUrl) await saveMetaGraphCursor(cursorAccount, cycleCutoffCursorKey, null)
  } else if (
    cursorPlan.allTargetsComplete
    && posts.failureClass === "invalid_cursor"
    && !cursorState.get(parentResetCursorKey)
  ) {
    await clearMetaGraphCommentBatchCursors(cursorAccount, cursorPrefix)
    await saveMetaGraphCursor(cursorAccount, parentCursorKey, null)
    await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, "1")
  } else {
    await saveMetaGraphCursor(cursorAccount, rotationCursorKey, cursorPlan.nextRotationTargetId)
  }
  if (!cursorPlan.allTargetsComplete && !partialError) partialError = "meta_comments_resume_pending"

  const tagged = await fetchGraphJson<{ data?: Array<{ id: string; message?: string; story?: string; created_time?: string; permalink_url?: string; from?: { id?: string; name?: string } }> }>(
    graphUrl("/me/tagged", token, { fields: "id,message,story,created_time,permalink_url,from", limit: 25 }),
    token,
    source.providerRequestSignal,
  )
  if (tagged.ok) {
    for (const taggedPost of tagged.data.data ?? []) {
      const text = (taggedPost.message || taggedPost.story || "").trim()
      if (!text) {
        ignoredCount++
        continue
      }
      foundCount++
      const result = await ingestOfficialMention(source, {
        organizationId: source.organizationId,
        accountId: account.id,
        platform: "facebook",
        externalId: `t:${taggedPost.id}`,
        sourceType: "mention",
        sourceProvider: "native",
        sourceMetadata: { taggedPostId: taggedPost.id, officialCollector: true },
        text,
        sentiment: null,
        matchedTerm: findMatchedKeyword(text, combinedSourceKeywords(source, account.keywords)),
        url: taggedPost.permalink_url ?? null,
        authorName: taggedPost.from?.name ?? null,
        authorHandle: taggedPost.from?.id ?? null,
        publishedAt: taggedPost.created_time ? new Date(taggedPost.created_time) : null,
      }, {
        permalink: taggedPost.permalink_url ?? null,
        rawSnippet: text,
        rawPayload: { taggedPost },
        confidence: 0.9,
        sourceTrustTier: "T1",
      })
      if (result.created) newCount++
      else duplicateCount++
    }
  } else {
    if (!partialError) partialError = tagged.error
  }

  return officialResult(partialError ? "partial" : "success", {
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: partialError,
    successfulThroughAt: cycleCutoff,
    rawStats: {
      accountId: account.id,
      platform: "facebook",
      externalReadOnly: true,
      until: cycleCutoff.toISOString(),
      sourceSuccessfulAt: cycleCutoff.toISOString(),
      invalidCursorResets: cursorPlan.invalidCursorResets,
      terminalCommentTargets: cursorPlan.terminalTargetIds.length,
      terminalReplyBranches: cursorPlan.terminalReplyIds.length,
      partialCoverage: Boolean(partialError),
      parentCoverage: {
        pages: posts.pages,
        records: posts.items.length,
        itemLimit: META_PARENT_MAX_ITEMS,
        pageLimit: META_PARENT_MAX_PAGES,
        capped: posts.capped,
        complete: !posts.error,
      },
      commentCoverage: {
        pages: comments.pages,
        records: comments.records.length,
        replies: comments.replies,
        itemLimit: commentItemLimit,
        pageLimit: META_COMMENT_MAX_TOTAL_PAGES,
        capped: comments.capped,
        complete: !comments.error,
      },
    },
  })
}

/**
 * Business Discovery caller: any active connected IG professional account can
 * ask Graph about an EXTERNAL username, so unlike findOfficialSocialAccount we
 * must not require the account handle to match the watched target.
 */
async function findBusinessDiscoveryCallerAccount(source: MonitoringSourceForRun): Promise<OfficialSocialAccount | null> {
  const settings = recordFromUnknown(source.settings)
  const explicitAccountId = typeof settings.socialAccountId === "string" ? settings.socialAccountId : null
  return prisma.socialAccount.findFirst({
    where: {
      organizationId: source.organizationId,
      platform: "instagram",
      isActive: true,
      accessToken: { not: null },
      ...(explicitAccountId ? { id: explicitAccountId } : {}),
    },
    select: { id: true, platform: true, handle: true, displayName: true, accessToken: true, keywords: true },
    orderBy: { updatedAt: "desc" },
  })
}

/**
 * Maps Graph Business Discovery failures onto strings the collector error
 * classifier understands. Target-specific refusals (personal account, unknown
 * username) intentionally read as "unsupported" so the route can fail over to
 * the approved fallback adapters instead of flapping.
 */
export function classifyBusinessDiscoveryFailure(status: number, body: string): string {
  let code: number | undefined
  let subcode: number | undefined
  let message = ""
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; error_subcode?: number; message?: string } }
    code = parsed.error?.code
    subcode = parsed.error?.error_subcode
    message = parsed.error?.message ?? ""
  } catch {
    // non-JSON upstream body — fall through to status-based mapping
  }
  if (code === 190) return "business_discovery_oauth_token_invalid"
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) return "business_discovery_rate_limit"
  if (code === 10 || /does not have permission|permissions? error/i.test(message)) {
    return "official_permission_error"
  }
  if (subcode === 2207013 || code === 110 || /cannot be found|does not exist/i.test(message)) {
    return "business_discovery_target_unsupported"
  }
  if (/business[\s_-]?discovery/i.test(message)) return "business_discovery_target_unsupported"
  if (status === 401 || status === 403) return "official_permission_error"
  return "official_fetch_failed"
}

type BusinessDiscoveryMedia = {
  id: string
  caption?: string
  permalink?: string
  timestamp?: string
  media_type?: string
  like_count?: number
  comments_count?: number
}

function instagramMediaContentKind(mediaType: unknown): "POST" | "VIDEO" | "IMAGE" | "AUDIO" {
  const normalized = typeof mediaType === "string" ? mediaType.trim().toUpperCase() : ""
  if (normalized.includes("VIDEO") || normalized.includes("REEL")) return "VIDEO"
  if (normalized.includes("AUDIO")) return "AUDIO"
  if (normalized.includes("IMAGE") || normalized.includes("CAROUSEL")) return "IMAGE"
  return "POST"
}

async function runInstagramBusinessDiscoveryCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const capability = source.routeExecution?.capability
  if (capability && capability !== "DISCOVER_POSTS") {
    return officialResult("skipped", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "business_discovery_capability_not_supported", rawStats: { capability, businessDiscovery: true } })
  }
  const targetUsername = instagramBusinessDiscoveryUsername(source)
  if (!targetUsername) {
    return officialResult("skipped", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "business_discovery_target_unresolved", rawStats: { sourceType: source.sourceType, businessDiscovery: true } })
  }
  const account = await findBusinessDiscoveryCallerAccount(source)
  if (!account) {
    return officialResult("skipped", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "official_account_not_connected", rawStats: { platform: "instagram", businessDiscovery: true } })
  }
  const token = decryptSocialAccountToken(account)
  if (!token) {
    return officialResult("failed", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "official_token_unavailable", rawStats: { accountId: account.id, businessDiscovery: true } })
  }

  const fields = `business_discovery.username(${targetUsername}){id,username,followers_count,media_count,media.limit(25){id,caption,permalink,timestamp,media_type,like_count,comments_count}}`
  const response = await fetchGraphJson<{
    business_discovery?: {
      id?: string
      username?: string
      followers_count?: number
      media_count?: number
      media?: { data?: BusinessDiscoveryMedia[] }
    }
  }>(graphUrl(`/${account.handle}`, token, { fields }), token, source.providerRequestSignal)
  if (!response.ok) {
    return officialResult("failed", {
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: classifyBusinessDiscoveryFailure(response.status, response.body),
      rawStats: { accountId: account.id, targetUsername, httpStatus: response.status, body: response.body.slice(0, 500), businessDiscovery: true },
    })
  }

  const discovery = response.data.business_discovery
  const media = discovery?.media?.data ?? []
  const terms = combinedSourceKeywords(source, account.keywords)
  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  for (const item of media) {
    const text = (item.caption || "").trim()
    if (!text) {
      ignoredCount++
      continue
    }
    // Watchlist semantics: an external news page floods without a term match,
    // so unmatched captions never enter the feed (boundary enforces it too).
    const matchedTerm = findMatchedKeyword(text, terms)
    if (!matchedTerm) {
      ignoredCount++
      continue
    }
    foundCount++
    const result = await ingestOfficialMention(source, {
      organizationId: source.organizationId,
      accountId: account.id,
      platform: "instagram",
      externalId: `bd:${item.id}`,
      sourceType: "post",
      contentKind: instagramMediaContentKind(item.media_type),
      sourceProvider: "official_discovery",
      sourceMetadata: {
        businessDiscovery: true,
        mediaType: instagramMediaContentKind(item.media_type),
        targetUsername,
        targetIgUserId: discovery?.id ?? null,
        followersCount: discovery?.followers_count ?? null,
        officialCollector: true,
      },
      text,
      sentiment: null,
      matchedTerm,
      engagement: (item.like_count ?? 0) + (item.comments_count ?? 0),
      url: item.permalink ?? null,
      authorHandle: discovery?.username ?? targetUsername,
      publishedAt: item.timestamp ? new Date(item.timestamp) : null,
    }, {
      permalink: item.permalink ?? null,
      rawSnippet: text,
      rawPayload: { businessDiscovery: { targetUsername }, media: item },
      confidence: 0.9,
      sourceTrustTier: "T2",
    }, { requireMatchedTerm: true })
    if (result.created) newCount++
    else duplicateCount++
  }

  return officialResult("success", {
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: null,
    rawStats: { accountId: account.id, targetUsername, mediaCount: media.length, platform: "instagram", businessDiscovery: true, externalReadOnly: true },
  })
}

async function runInstagramOfficialCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  if (source.ownership === "external") return runInstagramBusinessDiscoveryCollector(source)
  const account = await findOfficialSocialAccount(source)
  if (!account) return officialResult("skipped", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "official_account_not_connected", rawStats: { platform: "instagram" } })
  const token = decryptSocialAccountToken(account)
  if (!token) return officialResult("failed", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "official_token_unavailable", rawStats: { accountId: account.id } })

  if (source.sourceType === "hashtag") return runInstagramHashtagCollector(source, account, token)

  const proof = appsecretProof(token)
  const cursorAccount = { id: account.id, organizationId: source.organizationId }
  const cursorPrefix = `source:${encodeURIComponent(source.id)}:instagram:`
  const parentCursorKey = `${cursorPrefix}parents`
  const parentResetCursorKey = `${cursorPrefix}reset:parents`
  const rotationCursorKey = `${cursorPrefix}rotation`
  const cursorState = applyMetaGraphQuarantines(
    await loadMetaGraphCursors(cursorAccount, cursorPrefix),
    cursorPrefix,
  )
  const resumedParentUrl = metaGraphCursorFetchUrl(cursorState.get(parentCursorKey), GRAPH, proof)
  const media = await collectMetaGraphConnection<InstagramGraphMedia>({
    graphBaseUrl: GRAPH,
    appSecretProof: proof,
    initialUrl: resumedParentUrl ?? graphUrl(`/${account.handle}/media`, token, { fields: "id,permalink,timestamp", limit: 25 }),
    fetchPage: async url => {
      const page = await fetchGraphJson<MetaGraphConnectionPage<InstagramGraphMedia>>(
        url,
        token,
        source.providerRequestSignal,
      )
      return page.ok
        ? { ok: true as const, data: page.data }
        : { ok: false as const, error: page.error, failureClass: classifyMetaGraphHttpFailure(page.status, url, page.body) }
    },
    maxPages: META_PARENT_MAX_PAGES,
    maxItems: META_PARENT_MAX_ITEMS,
  })
  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  let partialError: string | null = media.error

  // Instagram's owned-media endpoint returns a bounded recent window (25 in
  // this request) and has no `since` cursor. Re-scan every media item returned;
  // comment page/item caps below are reported explicitly when reached.
  const recentMediaById = new Map(media.items.map(item => [item.id, item]))
  for (const stored of [...metaGraphStoredTargets(cursorState, cursorPrefix), ...metaGraphStoredWatchTargets(cursorState, cursorPrefix)]) {
    const current = recentMediaById.get(stored.id)
    if (!current) {
      recentMediaById.set(stored.id, { id: stored.id, permalink: stored.url ?? undefined })
    } else if (!current.permalink && stored.url) {
      recentMediaById.set(stored.id, { ...current, permalink: stored.url })
    }
  }
  const recentMedia = Array.from(recentMediaById.values())
  if (media.error && recentMedia.length === 0) {
    if (media.failureClass === "invalid_cursor" && resumedParentUrl && !cursorState.get(parentResetCursorKey)) {
      await saveMetaGraphCursor(cursorAccount, parentCursorKey, null)
      await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, "1")
    }
    return officialResult("failed", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: media.error, rawStats: { accountId: account.id, parentCoverage: { pages: media.pages, capped: media.capped } } })
  }
  const parentContexts: Map<string, ParentMatchContext> = await parentMatchContextsForComments(
    source.organizationId,
    "instagram",
    recentMedia.map(item => item.permalink).filter((url): url is string => Boolean(url)),
    recentMedia.map(item => item.id),
  )
  const commentItemLimit = metaCommentItemLimit(source)
  const topCursorValue = (mediaId: string) => cursorState.get(metaGraphTopCursorKey(cursorPrefix, mediaId))
  const activeMedia = recentMedia.filter(item => topCursorValue(item.id) !== META_GRAPH_CURSOR_COMPLETE)
  const orderedMedia = rotateMetaGraphTargets(activeMedia, cursorState.get(rotationCursorKey), item => item.id)
  const pendingInstagramReplies = metaGraphStoredPendingReplies(cursorState, cursorPrefix).flatMap(pending => {
    const mediaItem = recentMediaById.get(pending.targetId)
    return mediaItem ? [{ target: mediaItem, item: { id: pending.itemId } as InstagramGraphComment }] : []
  })
  const embeddedInstagramReplies = (comment: InstagramGraphComment) => comment.replies ?? comment.comments
  const instagramCommentsUrl = (item: InstagramGraphMedia) => graphUrl(`/${item.id}/comments`, token, {
    fields: "id,text,username,timestamp,like_count,replies.limit(50){id,text,username,timestamp,like_count}",
    limit: 50,
  })
  const instagramRepliesUrl = (comment: InstagramGraphComment) => graphUrl(`/${comment.id}/replies`, token, {
    fields: "id,text,username,timestamp,like_count",
    limit: 50,
  })
  const comments = await collectMetaGraphCommentThreads<
    (typeof recentMedia)[number],
    InstagramGraphComment
  >({
    targets: orderedMedia,
    graphBaseUrl: GRAPH,
    appSecretProof: proof,
    initialUrl: instagramCommentsUrl,
    fetchPage: async url => {
      const page = await fetchGraphJson<MetaGraphConnectionPage<InstagramGraphComment>>(
        url,
        token,
        source.providerRequestSignal,
      )
      return page.ok
        ? { ok: true as const, data: page.data }
        : {
            ok: false as const,
            error: `meta_comments_fetch_failed_${page.status}`,
            failureClass: classifyMetaGraphHttpFailure(page.status, url, page.body),
          }
    },
    embeddedReplies: (comment, item) => {
      const replyKey = metaGraphReplyCursorKey(cursorPrefix, item.id, comment.id)
      return cursorState.get(replyKey) === META_GRAPH_CURSOR_COMPLETE ? null : embeddedInstagramReplies(comment)
    },
    itemId: comment => comment.id,
    replyParentId: reply => reply.parent_id,
    topLevelResumeUrl: item => {
      const value = topCursorValue(item.id)
      return value && value !== META_GRAPH_CURSOR_COMPLETE
        ? metaGraphCursorFetchUrl(value, GRAPH, proof)
        : null
    },
    replyResumeUrl: (comment, item) => {
      const value = cursorState.get(metaGraphReplyCursorKey(cursorPrefix, item.id, comment.id))
      return value && value !== META_GRAPH_CURSOR_COMPLETE
        ? metaGraphCursorFetchUrl(value, GRAPH, proof)
        : null
    },
    pendingReplies: pendingInstagramReplies,
    maxPages: META_COMMENT_MAX_TOTAL_PAGES,
    maxPagesPerConnection: META_COMMENT_MAX_PAGES_PER_CONNECTION,
    maxItems: commentItemLimit,
  })
  if (comments.error) partialError = comments.error

  for (const { target: item, item: comment, replyToExternalId } of comments.records) {
    const text = (comment.text || "").trim()
    if (!text) {
      ignoredCount++
      continue
    }
    foundCount++
    const parentMatchContext = parentContexts.get(item.id)
      ?? (item.permalink ? parentContexts.get(item.permalink) : null)
      ?? null
    const result = await ingestOfficialMention(source, {
      organizationId: source.organizationId,
      accountId: account.id,
      platform: "instagram",
      externalId: `c:${comment.id}`,
      sourceType: replyToExternalId ? "reply" : "comment",
      contentKind: replyToExternalId ? "REPLY" : "COMMENT",
      postExternalId: item.id,
      parentExternalId: replyToExternalId ?? item.id,
      threadExternalId: item.id,
      replyToExternalId,
      depth: replyToExternalId ? 1 : 0,
      sourceProvider: "native",
      sourceMetadata: {
        mediaId: item.id,
        ...(replyToExternalId ? { parentCommentId: replyToExternalId } : {}),
        officialCollector: true,
      },
      text,
      sentiment: null,
      matchedTerm: findMatchedKeyword(text, combinedSourceKeywords(source, account.keywords)),
      engagement: comment.like_count ?? 0,
      url: item.permalink ?? null,
      parentPostUrl: item.permalink ?? null,
      authorHandle: comment.username ?? null,
      publishedAt: comment.timestamp ? new Date(comment.timestamp) : null,
      parentMatchContext,
    }, {
      permalink: item.permalink ?? null,
      rawSnippet: text,
      rawPayload: { media: item, comment, replyToExternalId },
      confidence: 0.95,
      sourceTrustTier: "T1",
    })
    if (result.created) newCount++
    else duplicateCount++
  }

  const cursorPlan = planMetaGraphCommentCursorUpdates({
    cursorPrefix,
    allTargets: recentMedia,
    orderedActiveTargets: orderedMedia,
    existing: cursorState,
    result: comments,
    targetId: item => item.id,
    itemId: comment => comment.id,
    embeddedReplies: embeddedInstagramReplies,
    initialTopLevelCursor: item => sanitizeMetaGraphCursorUrl(instagramCommentsUrl(item), GRAPH) ?? "",
    initialReplyCursor: comment => sanitizeMetaGraphCursorUrl(instagramRepliesUrl(comment), GRAPH) ?? "",
  })
  for (const item of recentMedia) {
    cursorPlan.updates.set(
      metaGraphTargetCursorKey(cursorPrefix, item.id),
      metaGraphTargetCursorValue(item.permalink),
    )
    const context = parentContexts.get(item.id)
      ?? (item.permalink ? parentContexts.get(item.permalink) : null)
      ?? null
    if (context?.inheritAllCommentSubjectIds?.length) {
      cursorPlan.updates.set(
        metaGraphWatchTargetCursorKey(cursorPrefix, item.id),
        metaGraphTargetCursorValue(item.permalink),
      )
    }
  }
  await saveMetaGraphCursorUpdates(cursorAccount, cursorPlan.updates)
  const canAdvanceParentCursor = cursorPlan.allTargetsComplete
    && (!media.error || (Boolean(media.resumeUrl) && !media.failureClass))
  if (canAdvanceParentCursor) {
    await clearMetaGraphCommentBatchCursors(cursorAccount, cursorPrefix)
    await saveMetaGraphCursor(cursorAccount, parentCursorKey, media.resumeUrl)
    await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, null)
  } else if (
    cursorPlan.allTargetsComplete
    && media.failureClass === "invalid_cursor"
    && !cursorState.get(parentResetCursorKey)
  ) {
    await clearMetaGraphCommentBatchCursors(cursorAccount, cursorPrefix)
    await saveMetaGraphCursor(cursorAccount, parentCursorKey, null)
    await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, "1")
  } else {
    await saveMetaGraphCursor(cursorAccount, rotationCursorKey, cursorPlan.nextRotationTargetId)
  }
  if (!cursorPlan.allTargetsComplete && !partialError) partialError = "meta_comments_resume_pending"

  const tags = await fetchGraphJson<{ data?: Array<{ id: string; caption?: string; permalink?: string; timestamp?: string; username?: string; media_type?: string }> }>(
    graphUrl(`/${account.handle}/tags`, token, { fields: "id,caption,permalink,timestamp,username,media_type", limit: 25 }),
    token,
    source.providerRequestSignal,
  )
  if (tags.ok) {
    for (const taggedMedia of tags.data.data ?? []) {
      const text = (taggedMedia.caption || "").trim()
      if (!text) {
        ignoredCount++
        continue
      }
      foundCount++
      const result = await ingestOfficialMention(source, {
        organizationId: source.organizationId,
        accountId: account.id,
        platform: "instagram",
        externalId: `t:${taggedMedia.id}`,
        sourceType: "mention",
        contentKind: instagramMediaContentKind(taggedMedia.media_type),
        sourceProvider: "native",
        sourceMetadata: {
          taggedMediaId: taggedMedia.id,
          mediaType: instagramMediaContentKind(taggedMedia.media_type),
          officialCollector: true,
        },
        text,
        sentiment: null,
        matchedTerm: findMatchedKeyword(text, combinedSourceKeywords(source, account.keywords)),
        url: taggedMedia.permalink ?? null,
        authorHandle: taggedMedia.username ?? null,
        publishedAt: taggedMedia.timestamp ? new Date(taggedMedia.timestamp) : null,
      }, {
        permalink: taggedMedia.permalink ?? null,
        rawSnippet: text,
        rawPayload: { taggedMedia },
        confidence: 0.9,
        sourceTrustTier: "T1",
      })
      if (result.created) newCount++
      else duplicateCount++
    }
  } else {
    if (!partialError) partialError = tags.error
  }

  return officialResult(partialError ? "partial" : "success", {
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: partialError,
    rawStats: {
      accountId: account.id,
      platform: "instagram",
      externalReadOnly: true,
      invalidCursorResets: cursorPlan.invalidCursorResets,
      terminalCommentTargets: cursorPlan.terminalTargetIds.length,
      terminalReplyBranches: cursorPlan.terminalReplyIds.length,
      partialCoverage: Boolean(partialError),
      parentCoverage: {
        pages: media.pages,
        records: media.items.length,
        itemLimit: META_PARENT_MAX_ITEMS,
        pageLimit: META_PARENT_MAX_PAGES,
        capped: media.capped,
        complete: !media.error,
      },
      commentCoverage: {
        pages: comments.pages,
        records: comments.records.length,
        replies: comments.replies,
        itemLimit: commentItemLimit,
        pageLimit: META_COMMENT_MAX_TOTAL_PAGES,
        capped: comments.capped,
        complete: !comments.error,
      },
    },
  })
}

async function runInstagramHashtagCollector(
  source: MonitoringSourceForRun,
  account: { id: string; handle: string; keywords: string[] },
  token: string,
): Promise<MonitoringCollectorResult> {
  const hashtag = (source.query || source.handle || "").replace(/^#+/, "").trim()
  if (!hashtag) return officialResult("skipped", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "instagram_hashtag_query_required", rawStats: { accountId: account.id } })

  const search = await fetchGraphJson<{ data?: Array<{ id: string; name?: string }> }>(
    graphUrl("/ig_hashtag_search", token, { user_id: account.handle, q: hashtag }),
    token,
    source.providerRequestSignal,
  )
  if (!search.ok) return officialResult("failed", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: search.error, rawStats: { accountId: account.id, status: search.status, body: search.body.slice(0, 500) } })
  const hashtagId = search.data.data?.[0]?.id
  if (!hashtagId) return officialResult("success", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: null, rawStats: { accountId: account.id, hashtag } })

  const media = await fetchGraphJson<{ data?: Array<{ id: string; caption?: string; permalink?: string; timestamp?: string; username?: string; media_type?: string; like_count?: number; comments_count?: number }> }>(
    graphUrl(`/${hashtagId}/recent_media`, token, { user_id: account.handle, fields: "id,caption,permalink,timestamp,username,media_type,like_count,comments_count", limit: 50 }),
    token,
    source.providerRequestSignal,
  )
  if (!media.ok) return officialResult("failed", { foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: media.error, rawStats: { accountId: account.id, hashtagId, status: media.status, body: media.body.slice(0, 500) } })

  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  for (const item of media.data.data ?? []) {
    const text = (item.caption || "").trim()
    if (!text) {
      ignoredCount++
      continue
    }
    foundCount++
    const result = await ingestOfficialMention(source, {
      organizationId: source.organizationId,
      accountId: account.id,
      platform: "instagram",
      externalId: `h:${hashtagId}:${item.id}`,
      sourceType: "mention",
      contentKind: instagramMediaContentKind(item.media_type),
      sourceProvider: "native",
      sourceMetadata: {
        hashtagId,
        hashtag,
        mediaId: item.id,
        mediaType: instagramMediaContentKind(item.media_type),
        officialCollector: true,
      },
      text,
      sentiment: null,
      matchedTerm: findMatchedKeyword(text, [hashtag, ...combinedSourceKeywords(source, account.keywords)]),
      engagement: (item.like_count ?? 0) + (item.comments_count ?? 0),
      url: item.permalink ?? null,
      authorHandle: item.username ?? null,
      publishedAt: item.timestamp ? new Date(item.timestamp) : null,
    }, {
      permalink: item.permalink ?? null,
      rawSnippet: text,
      rawPayload: { hashtagId, media: item },
      confidence: 0.85,
      sourceTrustTier: "T1",
    })
    if (result.created) newCount++
    else duplicateCount++
  }

  return officialResult("success", {
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: null,
    rawStats: { accountId: account.id, hashtagId, hashtag, platform: "instagram", externalReadOnly: true },
  })
}

async function runOfficialApiCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  if (source.platform === "facebook") return runFacebookOfficialCollector(source)
  if (source.platform === "instagram") return runInstagramOfficialCollector(source)
  return officialResult("skipped", {
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: "official_collector_not_supported",
    rawStats: { platform: source.platform, sourceType: source.sourceType },
  })
}

function numberFromJson(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

const AUTOMATIC_MAX_ITEMS_CEILING = 5000
const MANUAL_MAX_ITEMS_CEILING = AUTOMATIC_MAX_ITEMS_CEILING

export function routeBudgetValues(value: unknown, deepSearch = false) {
  const budget = recordFromUnknown(value)
  // Дефолт 1000 (было 100): по решению владельца 2026-08-01 лимит не должен
  // быть узким местом для находок. На наблюдаемых объёмах он и так не
  // упирался — прогоны возвращают единицы-десятки, — но теперь бренд с
  // всплеском упоминаний не обрежется на сотне. Потолок 5000 остаётся как
  // защита от неограниченной траты: провайдер тарифицирует за результаты.
  const configuredMaxItems = Math.trunc(numberFromJson(budget.maxItems, 1000))
  // A manual "Run" must preserve the route's configured item budget. Raising
  // every source to an implicit 1,000 items makes one profile click much wider
  // (and potentially more expensive) than the operator configured. Both modes
  // retain explicit ceilings for legacy plans with unsafe values.
  const maxItems = deepSearch
    ? Math.max(1, Math.min(MANUAL_MAX_ITEMS_CEILING, configuredMaxItems))
    : Math.max(1, Math.min(AUTOMATIC_MAX_ITEMS_CEILING, configuredMaxItems))
  return {
    maxItems,
    timeoutSeconds: Math.max(30, Math.min(3600, Math.trunc(numberFromJson(budget.timeoutSeconds, deepSearch ? 1800 : 900)))),
  }
}

type ExecutableRoutePlan = {
  id: string
  scenarioId: string | null
  status: string
  capability: string
  contentScope: string
  primaryAdapter: string
  fallbackAdapters: string[]
  capabilityProofId: string | null
  capabilityProof: {
    status: string
    verifiedAt: Date | null
    expiresAt: Date | null
    readAllowed: boolean
    exportAllowed: boolean
    replyAllowed: boolean
    sandboxVerifiedAt: Date | null
  } | null
  connectionAccountId: string | null
  acquisitionMode: string
  dependsOnCapability: string | null
  budget: unknown
  rateLimit: unknown
  circuitOpenUntil: Date | null
}

async function persistedDependencySatisfiesRoute(
  source: MonitoringSourceForRun,
  plan: Pick<ExecutableRoutePlan, "capability" | "dependsOnCapability" | "primaryAdapter">,
  options: {
    onlyCapability?: SourceCapability
    targetSubjectId?: string
    manualPaidRun?: boolean
  } = {},
): Promise<boolean> {
  const dependency = plan.dependsOnCapability
  if (!dependency) return true

  if (
    ["DISCOVER_POSTS", "ENRICH_CONTENT"].includes(dependency)
    && source.platform === "tiktok"
    && plan.capability === "READ_EXTERNAL_COMMENTS"
  ) {
    // This gate runs before either paid adapter loads targets. Repair and
    // resolve through the active subject lineage here, otherwise publications
    // accepted through a disabled legacy source never reach Bright or Apify.
    const reconciliation = await reconcileTikTokPublicationRevisitsForSource({
      organizationId: source.organizationId,
      sourceId: source.id,
      sourceSettings: source.settings,
      targetSubjectId: options.targetSubjectId,
      limit: 100,
    })
    if (reconciliation.subjectIds.length === 0) return false
    const dueRevisit = await prisma.tikTokPublicationRevisit.findMany({
      where: {
        organizationId: source.organizationId,
        status: options.manualPaidRun === true ? { in: ["ACTIVE", "INACTIVE"] } : "ACTIVE",
        ...(options.manualPaidRun === true ? {} : { nextDueAt: { lte: new Date() } }),
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
      select: { id: true },
      take: 1,
    })
    return dueRevisit.length > 0
  }

  // An explicit capability-scoped comments run may reuse the adapter's own
  // fresh, source-scoped parent resolver regardless of whether the compiled
  // split pipeline names DISCOVER_POSTS or ENRICH_CONTENT as its dependency.
  // The onlyCapability guard keeps this a deliberate one-shot path: scheduled
  // and full-source runs cannot turn persisted publications into recurring
  // paid comment jobs.
  if (
    ["DISCOVER_POSTS", "ENRICH_CONTENT"].includes(dependency)
    && plan.capability === "READ_EXTERNAL_COMMENTS"
    && plan.primaryAdapter === ROUTE_ADAPTERS.APIFY_ASYNC
    && options.onlyCapability === "READ_EXTERNAL_COMMENTS"
    && await hasApifyCommentCandidates(source)
  ) return true

  // Split licensed-provider routes are often completed asynchronously: a prior
  // collector/provider run can already have accepted/enriched parent posts even
  // though this *current* collector invocation did not just execute the
  // upstream route. Comments/media/metrics should not stay stuck at
  // route_dependency_pending in that case; their adapters can load those
  // persisted parents and fail closed with a concrete target/budget/provider
  // reason if nothing usable remains.
  if (
    dependency === "ENRICH_CONTENT"
    && ["READ_EXTERNAL_COMMENTS", "READ_MEDIA", "UPDATE_METRICS"].includes(plan.capability)
  ) {
    const enrichedParent = await prisma.ingestEnvelope.findMany({
      where: {
        organizationId: source.organizationId,
        sourceId: source.id,
        acceptedMentionId: { not: null },
        contentKind: { in: ["POST", "VIDEO"] },
        OR: [{ canonicalUrl: { not: null } }, { url: { not: null } }],
      },
      select: { id: true },
      take: 1,
    })
    return enrichedParent.length > 0
  }

  if (dependency === "DISCOVER_POSTS" && ["ENRICH_CONTENT", "READ_EXTERNAL_COMMENTS"].includes(plan.capability)) {
    const candidateParent = await prisma.ingestEnvelope.findMany({
      where: {
        organizationId: source.organizationId,
        sourceId: source.id,
        OR: [{ canonicalUrl: { not: null } }, { url: { not: null } }],
      },
      select: { id: true },
      take: 1,
    })
    return candidateParent.length > 0
  }

  return false
}

async function dispatchRouteAdapterUnchecked(source: MonitoringSourceForRun, adapter: string, capability?: string): Promise<MonitoringCollectorResult> {
  // Defensive regression control: guarded social discovery stays Bright Data
  // only, while the capability-scoped comment route may dispatch a pinned Apify
  // actor for already-known matched publication URLs. A legacy route for any
  // broader capability still fails closed before provider I/O.
  if (
    isApifyRouteReference(adapter)
    && isBrightDataOnlyPlatform(source.platform)
    && !isApifySocialReadRouteAllowed(source.platform, capability ?? null)
  ) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "apify_excluded_bright_data_only_platform",
      rawStats: { adapter, platform: source.platform, brightDataOnly: true },
    }
  }
  if (adapter === ROUTE_ADAPTERS.META_GRAPH) return runOfficialApiCollector(source)
  if (adapter === ROUTE_ADAPTERS.YOUTUBE_DATA_API) return runYouTubeCommentsCollector(source)
  if (adapter === ROUTE_ADAPTERS.VK_API) return runVkCommentsCollector(source)
  if (adapter === ROUTE_ADAPTERS.TELEGRAM_BOT_API) return runTelegramDiscussionCollector(source)
  if (adapter === ROUTE_ADAPTERS.X_API) return runXOfficialCollector(source)
  if (adapter === ROUTE_ADAPTERS.TIKTOK_BUSINESS_API) return runTikTokBusinessCommentsCollector(source)
  if (adapter === ROUTE_ADAPTERS.LICENSED_PROVIDER) return runProviderApiCollector(source)
  if (adapter === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT) return runBrightDataCollector(source)
  if (adapter === ROUTE_ADAPTERS.APIFY_ASYNC) return runApifyAsyncCollector(source)
  if (adapter === ROUTE_ADAPTERS.GOOGLE_ALERTS_RSS) return runGoogleAlertsRssCollector(source)
  if (adapter === ROUTE_ADAPTERS.AZERBAIJAN_NEWS_DIRECT) return runAzerbaijanNewsCollector(source)
  if (adapter === ROUTE_ADAPTERS.SEARCH_INDEX_GENERIC) return runSearchIndexCollector(source)
  if (adapter === ROUTE_ADAPTERS.NOTIFICATION_INBOX) return runNotificationInboxCollector(source)
  if (adapter === ROUTE_ADAPTERS.BROWSER_CAPTURE_READ_ONLY) return runBrowserCaptureCollector(source)
  if (adapter === ROUTE_ADAPTERS.MANUAL_TASK) return {
    status: "skipped",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: "manual_collection_required",
    rawStats: { adapter, manualTask: true },
  }
  return { ...notConfiguredResult(source), error: "route_adapter_not_supported", rawStats: { adapter, safeMode: true } }
}

export async function dispatchRouteAdapter(source: MonitoringSourceForRun, adapter: string, capability?: string): Promise<MonitoringCollectorResult> {
  try {
    const timeoutSeconds = source.routeExecution?.timeoutSeconds
    const timeoutMs = typeof timeoutSeconds === "number" && Number.isFinite(timeoutSeconds)
      ? Math.max(1, timeoutSeconds) * 1_000
      : undefined
    return await withSocialProviderRunTimeout(
      adapter.toLowerCase(),
      (providerRequestSignal) =>
        dispatchRouteAdapterUnchecked({ ...source, providerRequestSignal }, adapter, capability),
      { timeoutMs },
    )
  } catch (error) {
    if (!isSocialProviderTimeoutError(error)) throw error
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: error.message,
      rawStats: {
        adapter,
        timeoutMs: error.timeoutMs,
        providerRequestDispatched: true,
        dispatchUnknown:
          requiresPaidRouteBudget(adapter)
          || adapter === ROUTE_ADAPTERS.APIFY_ASYNC,
      },
    }
  }
}

async function runSafeCollector(
  source: MonitoringSourceForRun,
  collectorRunId: string,
  options: {
    claim: MonitoringSourceRunClaim
    eligibleStatuses: readonly string[]
    manualPaidRun?: boolean
    manualSourceRun?: boolean
    fullArchiveRun?: boolean
    manualMaxTotalChargeUsd?: number
    deepSearch?: boolean
    onlyCapability?: SourceCapability
    targetScenarioId?: string
    targetSubjectId?: string
    archiveStartAt?: string | null
    paidRunConfirmed?: boolean
    clientFundedManual?: boolean
    includeComments?: boolean
  } = {},
): Promise<MonitoringCollectorResult> {
  const withRunClaim = async <T>(action: () => Promise<T>): Promise<T> =>
    requireCurrentMonitoringSourceClaim(
      await withCurrentMonitoringSourceClaimFence(
        source,
        options.claim,
        options.eligibleStatuses,
        action,
      ),
    )
  const organizationSettings = options.manualPaidRun === true
    ? null
    : (await prisma.organization.findUnique({
        where: { id: source.organizationId },
        select: { settings: true },
      }))?.settings
  const currentPlans = await prisma.sourceRoutePlan.findMany({
    where: { organizationId: source.organizationId, sourceId: source.id, status: { not: "INVALIDATED" } },
    select: {
      routeKey: true,
      scenarioId: true,
      policyVersion: true,
      capability: true,
      primaryAdapter: true,
      fallbackAdapters: true,
      capabilityProofId: true,
    },
  })
  // Bright-Data staleness: a plan compiled while live routing was off (or before
  // the proof was verified) keeps an executable-but-wrong route (e.g. a dead
  // META_GRAPH primary), so the "all routes blocked" self-heal below never fires
  // and the verified Bright Data proof is never wired in. Detect that exact case
  // — routing now allowed + a verified BD proof exists, yet no plan references
  // BRIGHT_DATA_SNAPSHOT — and recompile once. After healing the plan carries BD,
  // so this stops firing and the circuit-breaker state is preserved on later runs.
  const brightData = ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT
  const planHasBrightData = currentPlans.some((plan: { primaryAdapter: string; fallbackAdapters: string[] }) =>
    plan.primaryAdapter === brightData || (plan.fallbackAdapters ?? []).includes(brightData))
  const currentApifySocialReadPlan = ["facebook", "instagram", "tiktok"].includes(source.platform)
    && currentPlans.some((plan: {
      policyVersion: string
      capability: string
      primaryAdapter: string
      fallbackAdapters: string[]
    }) => (
      plan.policyVersion === SOURCE_ROUTE_POLICY_VERSION
      && isApifySocialReadRouteAllowed(source.platform, plan.capability)
      && (
        plan.primaryAdapter === ROUTE_ADAPTERS.APIFY_ASYNC
        || (plan.fallbackAdapters ?? []).includes(ROUTE_ADAPTERS.APIFY_ASYNC)
      )
    ))
  let brightDataStale = false
  if (
    currentPlans.length > 0
    && !planHasBrightData
    // v12 intentionally pauses Bright Data on current Facebook/Instagram/TikTok
    // read plans while Apify owns the capability. Treating that absence as
    // stale would recompile every cadence and clear the Apify circuit breaker.
    && !currentApifySocialReadPlan
    && isBrightDataLiveRoutingAllowed(source.organizationId)
  ) {
    const verifiedBrightDataProofs = await prisma.socialProviderCapabilityProof.count({
      where: {
        organizationId: source.organizationId,
        platform: source.platform,
        adapterKey: brightData,
        status: "VERIFIED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    })
    brightDataStale = verifiedBrightDataProofs > 0
  }
  const prooflessInstagramBusinessDiscovery = source.platform === "instagram"
    && source.ownership === "external"
    && currentPlans.some((plan: { capability: string; primaryAdapter: string; capabilityProofId: string | null }) =>
      plan.capability === "DISCOVER_POSTS"
      && plan.primaryAdapter === ROUTE_ADAPTERS.META_GRAPH
      && !plan.capabilityProofId)
  const sourceSettings = recordFromUnknown(source.settings)
  const configuredScenarioIds = new Set([
    typeof sourceSettings.scenarioId === "string" ? sourceSettings.scenarioId.trim() : "",
    ...(Array.isArray(sourceSettings.scenarioLinks)
      ? sourceSettings.scenarioLinks.map(link => {
          const scenarioId = recordFromUnknown(link).scenarioId
          return typeof scenarioId === "string" ? scenarioId.trim() : ""
        })
      : []),
  ].filter(Boolean))
  // A physical publisher source can be shared by several monitoring
  // scenarios. Adding a second scenario updates source.settings immediately,
  // while its persisted route-plan aliases may still describe only the first
  // scenario. Recompile before applying the target-scenario filter so a valid,
  // explicitly linked shared source does not fail as
  // source_route_scenario_missing. This only persists deterministic plans; it
  // does not contact or charge a provider.
  const targetScenarioPlanStale = Boolean(
    options.targetScenarioId
    && configuredScenarioIds.has(options.targetScenarioId)
    && !currentPlans.some((plan: { scenarioId: string | null }) =>
      plan.scenarioId === options.targetScenarioId),
  )
  // One-time deterministic migration/staleness repair. This persists a plan;
  // it never asks an LLM or chooses a provider per fetched observation.
  if (currentPlans.length === 0 || brightDataStale || prooflessInstagramBusinessDiscovery || targetScenarioPlanStale || currentPlans.some((plan: { routeKey: string; policyVersion: string }) => plan.routeKey.endsWith(":entry") || plan.policyVersion !== SOURCE_ROUTE_POLICY_VERSION)) {
    await withRunClaim(() =>
      compileSourceRoutePlans({ ...source, ownership: source.ownership ?? "unknown" }),
    )
  }
  let plans = await prisma.sourceRoutePlan.findMany({
    where: { organizationId: source.organizationId, sourceId: source.id, status: { not: "INVALIDATED" } },
    orderBy: [{ executionOrder: "asc" }, { compiledAt: "desc" }],
    include: { capabilityProof: true },
  })
  await withRunClaim(async () => undefined)
  if (plans.length === 0) return {
    status: "skipped",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: "source_route_plan_missing",
    rawStats: { failClosed: true },
  }

  let executable: ExecutableRoutePlan[] = plans.filter(
    (plan: { status: string }) => ["ACTIVE", "DEGRADED"].includes(plan.status),
  ) as ExecutableRoutePlan[]
  if (executable.length === 0) {
    // Self-heal: plans compiled while a prerequisite was missing (live routing
    // off, proof not yet verified) stay BLOCKED forever because the staleness
    // check above only recompiles on a policy-version change. Before failing
    // closed, recompile once — if the environment now satisfies a route, the
    // source unblocks without operator surgery.
    await withRunClaim(() =>
      compileSourceRoutePlans({ ...source, ownership: source.ownership ?? "unknown" }),
    )
    plans = await prisma.sourceRoutePlan.findMany({
      where: { organizationId: source.organizationId, sourceId: source.id, status: { not: "INVALIDATED" } },
      orderBy: [{ executionOrder: "asc" }, { compiledAt: "desc" }],
      include: { capabilityProof: true },
    })
    await withRunClaim(async () => undefined)
    executable = plans.filter(
      (plan: { status: string }) => ["ACTIVE", "DEGRADED"].includes(plan.status),
    ) as ExecutableRoutePlan[]
  }
  if (executable.length === 0) return {
    status: "skipped",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: "source_route_plan_blocked",
    rawStats: { failClosed: true, blockedRoutes: plans.map((plan: { id: string; reason: string }) => ({ id: plan.id, reason: plan.reason })) },
  }
  if (options.targetScenarioId) {
    executable = monitoringProfileScenarioRoutePlans(
      executable,
      options.targetScenarioId,
    )
    if (executable.length === 0) return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "source_route_scenario_missing",
      rawStats: {
        failClosed: true,
        targetScenarioId: options.targetScenarioId,
      },
    }
  }
  if (options.onlyCapability) {
    executable = executable.filter((plan: { capability: string }) => plan.capability === options.onlyCapability)
    if (executable.length === 0) return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "source_route_capability_missing",
      rawStats: { failClosed: true, onlyCapability: options.onlyCapability },
    }
  }

  const dependentCommentsPlanAvailable = executable.some(plan =>
    options.targetScenarioId !== undefined
    && plan.scenarioId === options.targetScenarioId
    && plan.capability === "READ_EXTERNAL_COMMENTS"
    && (
      plan.dependsOnCapability === "DISCOVER_POSTS"
      || (
        options.onlyCapability === "READ_EXTERNAL_COMMENTS"
        && plan.dependsOnCapability === "ENRICH_CONTENT"
      )
    )
    && plan.primaryAdapter === ROUTE_ADAPTERS.APIFY_ASYNC,
  )
  let dependentCommentsMaxTotalChargeUsd: number | null = null
  let sourceAuthorizedMaxTotalChargeUsd: number | null = null
  let discoveryMaxTotalChargeUsd: number | null = null
  let rootManualChargeUsd = options.manualPaidRun === true
    ? Math.max(0, options.manualMaxTotalChargeUsd ?? 0)
    : null
  if (options.includeComments === true) {
    const commentsScopeAuthorized = options.manualPaidRun === true
      && options.clientFundedManual === true
      && dependentCommentsPlanAvailable
    const allocation = commentsScopeAuthorized
      ? allocateClientFundedSourceCapsUsd({
          authorizedTotalUsd: options.manualMaxTotalChargeUsd ?? Number.NaN,
          includeDependentComments: true,
        })
      : null
    if (!allocation || allocation.commentsUsd === null) {
      return {
        status: "skipped",
        foundCount: 0,
        newCount: 0,
        duplicateCount: 0,
        ignoredCount: 0,
        error: "external_comments_run_not_authorized",
        rawStats: {
          failClosed: true,
          providerRequestDispatched: false,
          includeComments: true,
        },
      }
    }
    rootManualChargeUsd = allocation.discoveryUsd
    dependentCommentsMaxTotalChargeUsd = allocation.commentsUsd
    sourceAuthorizedMaxTotalChargeUsd = options.manualMaxTotalChargeUsd ?? null
    discoveryMaxTotalChargeUsd = allocation.discoveryUsd
  }

  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  let anySuccess = false
  let anyPartial = false
  let anyFailure = false
  let pendingDependency = false
  let automaticRouteSkipped = false
  let dependentCommentsDiscoveryQueued = false
  const completedCapabilities = new Set<string>()
  const routeResults: Array<Record<string, unknown>> = []
  const successfulThroughCandidates: Date[] = []
  let remainingManualChargeUsd = rootManualChargeUsd
  let remainingDependentCommentsChargeUsd = dependentCommentsMaxTotalChargeUsd

  // A source can intentionally have one persisted plan per scenario. Scenarios
  // affect downstream classification, but identical acquisition plans must not
  // trigger the same API/provider job more than once (especially paid Apify
  // runs). Execute one physical route and attribute its result to every alias.
  const physicalGroups = new Map<string, { plan: ExecutableRoutePlan; aliases: ExecutableRoutePlan[] }>()
  for (const plan of executable as ExecutableRoutePlan[]) {
    const signature = JSON.stringify({
      capability: plan.capability,
      contentScope: plan.contentScope,
      primaryAdapter: plan.primaryAdapter,
      fallbackAdapters: plan.fallbackAdapters,
      capabilityProofId: plan.capabilityProofId,
      connectionAccountId: plan.connectionAccountId,
      acquisitionMode: plan.acquisitionMode,
      dependsOnCapability: plan.dependsOnCapability,
      budget: plan.budget,
      rateLimit: plan.rateLimit,
    })
    const existing = physicalGroups.get(signature)
    if (existing) existing.aliases.push(plan)
    else physicalGroups.set(signature, { plan, aliases: [plan] })
  }

  const recordAliases = async (aliases: ExecutableRoutePlan[], result: Parameters<typeof recordSourceRouteResult>[2]) => {
    await withRunClaim(() =>
      Promise.all(aliases.map(alias =>
        recordSourceRouteResult(source.organizationId, alias.id, result))),
    )
  }

  for (const { plan, aliases } of physicalGroups.values()) {
    const aliasPlanIds = aliases.map(alias => alias.id)
    let dependencySatisfiedFromPersistedState = false
    if (plan.capabilityProofId) {
      const proof = plan.capabilityProof
      const proofValid = proof?.status === "VERIFIED"
        && proof.verifiedAt
        && (!proof.expiresAt || proof.expiresAt.getTime() > Date.now())
        && (plan.capability.startsWith("REPLY_") ? proof.replyAllowed && proof.sandboxVerifiedAt : proof.readAllowed && proof.exportAllowed)
      if (!proofValid) {
        anyFailure = true
        await recordAliases(aliases, { ok: false, failureClass: "CAPABILITY_PROOF_INVALID" })
        routeResults.push({ routePlanId: plan.id, aliasPlanIds, capability: plan.capability, status: "failed", error: "capability_proof_invalid" })
        continue
      }
    } else if (plan.acquisitionMode === "LICENSED_PROVIDER" || plan.primaryAdapter === ROUTE_ADAPTERS.TIKTOK_BUSINESS_API) {
      anyFailure = true
      await recordAliases(aliases, { ok: false, failureClass: "CAPABILITY_PROOF_MISSING" })
      routeResults.push({ routePlanId: plan.id, aliasPlanIds, capability: plan.capability, status: "failed", error: "capability_proof_missing" })
      continue
    }
    const isDependentApifyCommentsPlan = plan.capability === "READ_EXTERNAL_COMMENTS"
      && plan.dependsOnCapability === "DISCOVER_POSTS"
      && plan.primaryAdapter === ROUTE_ADAPTERS.APIFY_ASYNC
    const usesAuthorizedCommentsAllocation = (
      isDependentApifyCommentsPlan
      || (
        options.onlyCapability === "READ_EXTERNAL_COMMENTS"
        && plan.capability === "READ_EXTERNAL_COMMENTS"
        && plan.dependsOnCapability === "ENRICH_CONTENT"
        && plan.primaryAdapter === ROUTE_ADAPTERS.APIFY_ASYNC
      )
    ) && remainingDependentCommentsChargeUsd !== null
    if (
      isDependentApifyCommentsPlan
      && options.manualPaidRun === true
      && options.onlyCapability !== "READ_EXTERNAL_COMMENTS"
      && (
        options.includeComments !== true
        || dependentCommentsDiscoveryQueued
      )
    ) {
      routeResults.push({
        routePlanId: plan.id,
        aliasPlanIds,
        capability: plan.capability,
        status: options.includeComments === true ? "queued" : "skipped",
        error: options.includeComments === true ? null : "dependent_comments_not_requested",
        ...(options.includeComments === true
          ? {
              queued: true,
              delegatedToDiscoveryProviderRun: true,
              dependentCommentsMaxTotalChargeUsd,
            }
          : {}),
      })
      continue
    }
    if (plan.dependsOnCapability && !completedCapabilities.has(plan.dependsOnCapability)) {
      dependencySatisfiedFromPersistedState = await persistedDependencySatisfiesRoute(source, plan, {
        onlyCapability: options.onlyCapability,
        targetSubjectId: options.targetSubjectId,
        manualPaidRun: options.manualPaidRun,
      })
      if (!dependencySatisfiedFromPersistedState) {
        pendingDependency = true
        routeResults.push({ routePlanId: plan.id, aliasPlanIds, capability: plan.capability, status: "skipped", error: "route_dependency_pending" })
        continue
      }
    }
    const budget = routeBudgetValues(plan.budget, options.deepSearch === true)
    const routeStartedAt = new Date()
    const primary = selectedAdapterForPlan(plan, routeStartedAt)
    const candidates = Array.from(new Set([
      ...(primary ? [primary] : []),
      ...plan.fallbackAdapters.filter((adapter: string) => adapter !== primary),
    ]))
      .filter(adapter => options.manualPaidRun === true || allowsAutomaticRouteAdapter({
        adapter,
        budget: plan.budget,
        organizationSettings,
      }))
      // The profile-scoped endpoint passes an explicit false when its fresh
      // preflight found only free routes. If a stale/missing plan recompiles to
      // a paid adapter after that preflight, fail closed instead of converting
      // the operator's free confirmation into a billable request.
      .filter(adapter => {
        if (options.paidRunConfirmed !== false) return true
        const reusesBrightDataEnrichment = adapter === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT
          && ["READ_MEDIA", "UPDATE_METRICS"].includes(plan.capability)
        return reusesBrightDataEnrichment
          || (adapter !== ROUTE_ADAPTERS.APIFY_ASYNC && !requiresPaidRouteBudget(adapter))
      })
    if (candidates.length === 0) {
      automaticRouteSkipped = true
      routeResults.push({
        routePlanId: plan.id,
        aliasPlanIds,
        capability: plan.capability,
        status: "skipped",
        error: "automatic_route_not_authorized",
      })
      continue
    }
    let finalResult: MonitoringCollectorResult | null = null
    let usedAdapter: string | null = null
    let primaryAttempted = false
    let primaryFailureClass: string | null = null
    let primaryHttpStatus: number | null = null
    for (const [candidateIndex, adapter] of candidates.entries()) {
      if (
        options.claim.expiresAt.getTime() - Date.now()
        <= COLLECTOR_SETTLEMENT_MARGIN_MS
      ) {
        // The claim still belongs to this collector, but there is no safe
        // window left for provider I/O plus durable settlement. Finish through
        // the normal collector path so the run and any manual authorization do
        // not remain stuck/charged despite zero provider exposure.
        finalResult = {
          status: "skipped",
          foundCount: 0,
          newCount: 0,
          duplicateCount: 0,
          ignoredCount: 0,
          error: "collector_lease_insufficient_before_dispatch",
          rawStats: {
            adapter,
            failClosed: true,
            collectorLease: true,
            providerRequestDispatched: false,
            stopRouteFallback: true,
          },
        }
        usedAdapter = adapter
        break
      }
      let paidReservation: Awaited<ReturnType<typeof reservePaidRouteBudget>> = { status: "NOT_REQUIRED" }
      const reusesBrightDataEnrichment = adapter === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT
        && ["READ_MEDIA", "UPDATE_METRICS"].includes(plan.capability)
      const monetaryAdapter = (requiresPaidRouteBudget(adapter) && !reusesBrightDataEnrichment)
        || adapter === ROUTE_ADAPTERS.APIFY_ASYNC
      const locallyCappedMonetaryAdapter = monetaryAdapter && !usesProviderAccountBudget(adapter)
      const remainingLeaseSeconds = Math.floor(
        (options.claim.expiresAt.getTime() - Date.now() - COLLECTOR_SETTLEMENT_MARGIN_MS) / 1_000,
      )
      const reservedTimeoutSeconds = Math.max(
        1,
        Math.min(
          budget.timeoutSeconds,
          Math.floor(SOCIAL_PROVIDER_RUN_TIMEOUT_MAX_MS / 1_000),
          remainingLeaseSeconds,
        ),
      )
      let manualRouteCapUsd: number | undefined
      if (options.manualPaidRun === true && locallyCappedMonetaryAdapter) {
        const availableManualChargeUsd = usesAuthorizedCommentsAllocation
          ? remainingDependentCommentsChargeUsd
          : remainingManualChargeUsd
        if (availableManualChargeUsd === null || availableManualChargeUsd <= 0) {
          finalResult = {
            status: "skipped",
            foundCount: 0,
            newCount: 0,
            duplicateCount: 0,
            ignoredCount: 0,
            error: options.manualMaxTotalChargeUsd === undefined
              ? "paid_manual_run_cap_required"
              : "paid_manual_run_cap_exhausted",
            rawStats: { adapter, failClosed: true, providerRequestDispatched: false },
          }
          usedAdapter = adapter
          break
        }
        const rawBudget = recordFromUnknown(plan.budget)
        const configuredCap = options.clientFundedManual === true
          ? availableManualChargeUsd
          : rawBudget.usdLimitsConfigured === true
            ? numberFromJson(rawBudget.maxTotalChargeUsd, availableManualChargeUsd)
            : availableManualChargeUsd
        manualRouteCapUsd = Math.min(availableManualChargeUsd, Math.max(0, configuredCap))
        if (manualRouteCapUsd <= 0) {
          finalResult = {
            status: "skipped",
            foundCount: 0,
            newCount: 0,
            duplicateCount: 0,
            ignoredCount: 0,
            error: "paid_manual_run_cap_invalid",
            rawStats: { adapter, failClosed: true, providerRequestDispatched: false },
          }
          usedAdapter = adapter
          break
        }
      }
      if (requiresPaidRouteBudget(adapter) && !reusesBrightDataEnrichment) {
        try {
          paidReservation = await reservePaidRouteBudget({
            organizationId: source.organizationId,
            sourceId: source.id,
            routePlanId: plan.id,
            collectorRunId,
            adapterKey: adapter,
            providerKey: adapter === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT ? "bright-data" : adapter,
            budget: plan.budget,
            maxItems: budget.maxItems,
            timeoutSeconds: reservedTimeoutSeconds,
            manualMaxTotalChargeUsd: manualRouteCapUsd,
            clientFundedManual: options.clientFundedManual === true,
            targetScenarioId: options.targetScenarioId,
            targetSubjectId: options.targetSubjectId,
          })
        } catch {
          finalResult = {
            status: "failed",
            foundCount: 0,
            newCount: 0,
            duplicateCount: 0,
            ignoredCount: 0,
            error: "paid_route_budget_guard_failed",
            rawStats: { adapter, failClosed: true, budgetGuard: true },
          }
          usedAdapter = adapter
          break
        }
        if (paidReservation.status === "BLOCKED") {
          finalResult = {
            status: "skipped",
            foundCount: 0,
            newCount: 0,
            duplicateCount: 0,
            ignoredCount: 0,
            error: paidReservation.reason,
            rawStats: { adapter, failClosed: true, budgetGuard: true },
          }
          usedAdapter = adapter
          if (adapter === plan.primaryAdapter) {
            primaryAttempted = true
            primaryFailureClass = paidReservation.reason
          }
          // A paid route must fail closed, but a later approved non-paid
          // provider may still collect the same read-only capability.
          const hasAutomatedFallback = candidates
            .slice(candidateIndex + 1)
            .some(candidate => candidate !== ROUTE_ADAPTERS.MANUAL_TASK)
          if (hasAutomatedFallback) continue
          break
        }
      }
      const dependentCommentsAuthorized = dependentCommentsMaxTotalChargeUsd !== null
        && plan.capability === "DISCOVER_POSTS"
        && adapter === ROUTE_ADAPTERS.APIFY_ASYNC
      const routedSource: MonitoringSourceForRun = {
        ...source,
        routeExecution: {
          collectorRunId,
          routePlanId: plan.id,
          capability: plan.capability,
          adapterKey: adapter,
          acquisitionMode: adapter === ROUTE_ADAPTERS.APIFY_ASYNC ? "APIFY_FALLBACK" : plan.acquisitionMode,
          providerKey: adapter === ROUTE_ADAPTERS.APIFY_ASYNC
            ? "APIFY"
            : adapter === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT
              ? "bright-data"
              : requiresPaidRouteBudget(adapter)
                ? adapter
                : null,
          providerRunId: paidReservation.status === "RESERVED" ? paidReservation.providerRunId : null,
          maxItems: budget.maxItems,
          timeoutSeconds: budget.timeoutSeconds,
          manualSourceRun: options.manualSourceRun === true,
          manualPaidRun: options.manualPaidRun === true,
          manualMaxTotalChargeUsd: manualRouteCapUsd,
          clientFundedManual: options.clientFundedManual === true,
          fullArchiveRun: options.fullArchiveRun === true,
          ...(options.targetScenarioId ? { targetScenarioId: options.targetScenarioId } : {}),
          ...(options.targetSubjectId ? { targetSubjectId: options.targetSubjectId } : {}),
          ...(options.archiveStartAt !== undefined
            ? { archiveStartAt: options.archiveStartAt }
            : {}),
          // A positive comments authorization carries a separately frozen
          // child allocation. Otherwise manual runs remain fail-closed and
          // cannot mint another Actor allowance from the root cap.
          ...(dependentCommentsAuthorized
            ? {
                dependentCommentsAuthorized: true,
                dependentCommentsMaxTotalChargeUsd,
                sourceAuthorizedMaxTotalChargeUsd: sourceAuthorizedMaxTotalChargeUsd!,
                discoveryMaxTotalChargeUsd: discoveryMaxTotalChargeUsd!,
              }
            : options.manualPaidRun === true
              ? { suppressDependentPaidRuns: true }
              : {}),
        },
      }
      if (
        options.manualPaidRun === true
        && locallyCappedMonetaryAdapter
      ) {
        const reserved = paidReservation.status === "RESERVED"
          ? paidReservation.reservedChargeUsd
          : manualRouteCapUsd ?? 0
        if (
          usesAuthorizedCommentsAllocation
          && remainingDependentCommentsChargeUsd !== null
        ) {
          remainingDependentCommentsChargeUsd = Math.max(
            0,
            remainingDependentCommentsChargeUsd - reserved,
          )
        } else {
          remainingManualChargeUsd = Math.max(0, (remainingManualChargeUsd ?? 0) - reserved)
        }
      }
      const adapterOwnsCollectionFence = adapter === ROUTE_ADAPTERS.APIFY_ASYNC
        || adapter === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT
      let attempted: MonitoringCollectorResult
      let paidReservationSettled = false
      const leaseInsufficientResult = (): MonitoringCollectorResult => ({
        status: "skipped",
        foundCount: 0,
        newCount: 0,
        duplicateCount: 0,
        ignoredCount: 0,
        error: "collector_lease_insufficient_before_dispatch",
        rawStats: {
          adapter,
          failClosed: true,
          collectorLease: true,
          providerRequestDispatched: false,
          stopRouteFallback: true,
        },
      })
      const invokeAdapter = async (): Promise<MonitoringCollectorResult> => {
        const remainingLeaseMs = options.claim.expiresAt.getTime() - Date.now()
        if (remainingLeaseMs <= COLLECTOR_SETTLEMENT_MARGIN_MS) {
          return leaseInsufficientResult()
        }
        const timeoutSeconds = Math.max(
          1,
          Math.min(
            budget.timeoutSeconds,
            Math.floor((remainingLeaseMs - COLLECTOR_SETTLEMENT_MARGIN_MS) / 1_000),
          ),
        )
        const adapterSource: MonitoringSourceForRun = {
          ...routedSource,
          routeExecution: routedSource.routeExecution
            ? { ...routedSource.routeExecution, timeoutSeconds }
            : routedSource.routeExecution,
        }
        try {
          return await dispatchRouteAdapter(adapterSource, adapter, plan.capability)
        } catch (error) {
          const dispatchUnknown = monetaryAdapter
          return {
            status: "failed",
            foundCount: 0,
            newCount: 0,
            duplicateCount: 0,
            ignoredCount: 0,
            error: isSocialProviderTimeoutError(error) ? error.message : "route_adapter_exception",
            rawStats: {
              adapter,
              failClosed: true,
              adapterInvoked: true,
              providerRequestDispatched: true,
              dispatchUnknown,
              exceptionName: error instanceof Error ? error.name : "UnknownError",
            },
          }
        }
      }
      try {
        if (adapterOwnsCollectionFence) {
          // Provider adapters take the same tenant lock internally around their
          // remote dispatch. Do not nest that lock here; only reject a stale
          // collector generation before handing off to the provider guard.
          await withRunClaim(async () => undefined)
          attempted = await invokeAdapter()
          if (paidReservation.status === "RESERVED") {
            await finishPaidRouteBudgetReservation(
              source.organizationId,
              paidReservation.providerRunId,
              attempted,
            )
            paidReservationSettled = true
          }
        } else {
          // The reservation claim, provider I/O, and terminal ledger marker
          // stay under one clean-slate fence. A reset can therefore observe
          // only QUEUED/not-dispatched or a fully settled dispatched outcome.
          attempted = await withRunClaim(async () => {
            if (
              options.claim.expiresAt.getTime() - Date.now()
              <= COLLECTOR_SETTLEMENT_MARGIN_MS
            ) {
              const leaseInsufficient = leaseInsufficientResult()
              if (paidReservation.status === "RESERVED") {
                await finishPaidRouteBudgetReservation(
                  source.organizationId,
                  paidReservation.providerRunId,
                  leaseInsufficient,
                )
                paidReservationSettled = true
              }
              return leaseInsufficient
            }
            if (paidReservation.status === "RESERVED") {
              const emergencyStoppedBeforeDispatch = await tenantPaidRunEmergencyStopped(source.organizationId)
                .catch(() => true)
              if (emergencyStoppedBeforeDispatch) {
                const stopped: MonitoringCollectorResult = {
                  status: "skipped",
                  foundCount: 0,
                  newCount: 0,
                  duplicateCount: 0,
                  ignoredCount: 0,
                  error: "paid_run_emergency_stopped_before_dispatch",
                  rawStats: {
                    adapter,
                    failClosed: true,
                    budgetGuard: true,
                    providerRequestDispatched: false,
                    stopRouteFallback: true,
                  },
                }
                await finishPaidRouteBudgetReservation(
                  source.organizationId,
                  paidReservation.providerRunId,
                  stopped,
                )
                paidReservationSettled = true
                return stopped
              }
              const beganDispatch = await beginPaidRouteBudgetDispatch(
                source.organizationId,
                paidReservation.providerRunId,
              )
              if (!beganDispatch) {
                throw new Error("paid_route_dispatch_claim_failed")
              }
            }
            const result = await invokeAdapter()
            if (paidReservation.status === "RESERVED") {
              await finishPaidRouteBudgetReservation(
                source.organizationId,
                paidReservation.providerRunId,
                result,
              )
              paidReservationSettled = true
            }
            return result
          })
        }
      } catch (error) {
        if (
          error instanceof MonitoringSourceClaimUnavailableError
          && paidReservation.status === "RESERVED"
        ) {
          const abandoned = leaseInsufficientResult()
          const cleanup = await withSocialMonitoringTenantCollectionFence(
            source.organizationId,
            () => finishPaidRouteBudgetReservation(
              source.organizationId,
              paidReservation.providerRunId,
              abandoned,
            ),
          )
          if (cleanup.allowed) {
            paidReservationSettled = true
            // The exact QUEUED/false settlement proves the provider was never
            // reached. Return a terminal result so the collector row and the
            // enclosing manual authorization are released normally.
            attempted = abandoned
          } else {
            throw error
          }
        } else {
          throw error
        }
      }
      if (
        options.manualPaidRun === true
        && locallyCappedMonetaryAdapter
        && paidReservation.status === "RESERVED"
        && paidReservationSettled
        && attempted.rawStats?.providerRequestDispatched === false
      ) {
        if (
          usesAuthorizedCommentsAllocation
          && remainingDependentCommentsChargeUsd !== null
        ) {
          remainingDependentCommentsChargeUsd += paidReservation.reservedChargeUsd
        } else {
          remainingManualChargeUsd = (remainingManualChargeUsd ?? 0) + paidReservation.reservedChargeUsd
        }
      }
      if (adapter === plan.primaryAdapter) {
        primaryAttempted = true
        const rawHttpStatus = attempted.rawStats?.httpStatus
        primaryHttpStatus = typeof rawHttpStatus === "number" && Number.isFinite(rawHttpStatus)
          ? rawHttpStatus
          : null
        if (attempted.status !== "success" && attempted.status !== "partial") {
          primaryFailureClass = attempted.error ?? "primary_adapter_failed"
        }
      }
      finalResult = attempted
      usedAdapter = adapter
      if (attempted.rawStats?.stopRouteFallback === true) break
      if (attempted.rawStats?.dispatchUnknown === true) break
      if (attempted.status === "success" || attempted.status === "partial") break
      if (adapter === ROUTE_ADAPTERS.MANUAL_TASK) break
    }
    const result = finalResult ?? { status: "failed" as const, foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "route_has_no_adapter" }
    if (
      result.status === "success"
      && result.successfulThroughAt instanceof Date
      && Number.isFinite(result.successfulThroughAt.getTime())
    ) {
      successfulThroughCandidates.push(result.successfulThroughAt)
    }
    const routeFetchAfter = providerFetchWatermarkForResult({
      collectionMode: source.collectionMode,
      status: result.status,
      rawStats: result.rawStats,
      finishedAt: new Date(),
    })
    const cursorAdvance = {
      fetchAfter: routeFetchAfter,
      adapterKey: usedAdapter,
      fullArchiveRun: options.fullArchiveRun === true,
    }
    if (shouldAdvanceMonitoringRouteProviderCursor(cursorAdvance)) {
      const archiveStartAt = options.fullArchiveRun === true
        ? scenarioArchiveStartAtForSource(
            source.settings,
            options.targetScenarioId,
            options.archiveStartAt,
          )
        : null
      await withRunClaim(() =>
        advanceMonitoringRouteProviderCursor({
          organizationId: source.organizationId,
          sourceId: source.id,
          routePlanId: plan.id,
          adapterKey: cursorAdvance.adapterKey,
          fullArchiveRun: options.fullArchiveRun === true,
          targetScenarioId: options.targetScenarioId,
          archiveStartAt,
          until: cursorAdvance.fetchAfter,
          reason: options.fullArchiveRun === true
            ? "manual_archive_route_package_persisted"
            : "scheduled_route_package_persisted",
        }).catch(error => {
          console.error("[social-monitoring] route provider cursor update failed", error)
          return 0
        }),
      )
    }
    foundCount += result.foundCount
    newCount += result.newCount
    duplicateCount += result.duplicateCount
    ignoredCount += result.ignoredCount
    const queued = result.rawStats?.queued === true
    if (
      queued
      && dependentCommentsMaxTotalChargeUsd !== null
      && plan.capability === "DISCOVER_POSTS"
      && usedAdapter === ROUTE_ADAPTERS.APIFY_ASYNC
    ) {
      dependentCommentsDiscoveryQueued = true
    }
    if ((result.status === "success" || result.status === "partial") && !queued) completedCapabilities.add(plan.capability)
    if (result.status === "success") anySuccess = true
    else if (result.status === "partial") anyPartial = true
    else if (result.status === "failed") anyFailure = true
    else pendingDependency = true
    const isSuccessful = result.status === "success" || result.status === "partial"
    const isFailbackProbe = isSuccessful
      && usedAdapter === plan.primaryAdapter
      && plan.status === "DEGRADED"
      && Boolean(plan.circuitOpenUntil && plan.circuitOpenUntil.getTime() <= routeStartedAt.getTime())
    const failbackAudit = isFailbackProbe
      ? await withRunClaim(() => auditProviderFailback({
          organizationId: source.organizationId,
          routePlanId: plan.id,
          primaryAdapter: plan.primaryAdapter,
          fallbackAdapters: plan.fallbackAdapters,
          rateLimit: plan.rateLimit,
          now: routeStartedAt,
        }))
      : null
    await recordAliases(aliases, {
      ok: isSuccessful,
      // Genuine schema drift takes the no-circuit DEGRADED path (retrying is
      // how drift heals after a normalizer fix). A provider-FETCH failure
      // (Bright Data returned only its own error rows: dead_page, proxy, …)
      // must instead reach the failure classifier so dead_page quarantines
      // (stop paying to re-hit a dead URL) and proxy gets a cheap circuit
      // retry (owner regression 2026-07-21).
      degraded: (result.rawStats?.schemaHealth === "DEGRADED" || result.rawStats?.schemaHealth === "FAILED")
        && result.rawStats?.providerFetchFailed !== true,
      failureClass: result.error ?? null,
      usedAdapter,
      primaryAdapter: plan.primaryAdapter,
      primaryAttempted,
      primaryFailureClass,
      primaryHttpStatus,
      // Unknown paid dispatch exposure must not be retried on the next cron
      // tick. Open the normal route circuit immediately so an operator/provider
      // reconciliation window exists before another paid request is possible.
      forceCircuitOpen: result.rawStats?.dispatchUnknown === true,
      ...(failbackAudit ? { failbackReconciled: failbackAudit.reconciled } : {}),
    })
    routeResults.push({
      routePlanId: plan.id,
      aliasPlanIds,
      capability: plan.capability,
      adapter: usedAdapter,
      status: result.status,
      error: result.error ?? null,
      primaryFailureClass,
      primaryHttpStatus,
      ...(dependencySatisfiedFromPersistedState ? { dependencySatisfiedFromPersistedState: true } : {}),
      ...(failbackAudit ? { failbackReconciliation: failbackAudit } : {}),
      ...(result.rawStats ?? {}),
    })
  }

  const status: CollectorStatus = anyFailure && !anySuccess && !anyPartial
    ? "failed"
    : anyPartial || anyFailure || pendingDependency
      ? "partial"
      : automaticRouteSkipped && !anySuccess
        ? "skipped"
      : "success"
  const singleRouteError = routeResults.length === 1 && typeof routeResults[0]?.error === "string"
    ? routeResults[0].error as string
    : null
  // Preserve the first actionable root cause instead of replacing it with the
  // generic partial/pending label after paid adapters fail closed and the
  // final manual fallback is reached. Dependency-pending is intentionally
  // excluded: it is a consequence of the first blocked capability, not the
  // reason collection could not start.
  const actionableRouteError = routeResults
    .flatMap(result => [result.primaryFailureClass, result.error])
    .find((error): error is string => typeof error === "string" && error !== "route_dependency_pending") ?? null
  return {
    status,
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: status === "failed"
      ? singleRouteError ?? actionableRouteError ?? "all_source_routes_failed"
      : status === "partial"
        ? actionableRouteError ?? "source_routes_partial_or_pending"
        : status === "skipped"
          ? singleRouteError ?? "automatic_route_not_authorized"
        : null,
    rawStats: { routePlanExecution: true, routeResults },
    successfulThroughAt: successfulThroughCandidates.length > 0
      ? new Date(Math.min(...successfulThroughCandidates.map(value => value.getTime())))
      : null,
  }
}

async function applyTenantMonitoringSettings(source: MonitoringSourceForRun): Promise<MonitoringSourceForRun> {
  const monitoringSettings = await getSocialMonitoringSettings(source.organizationId)
  return {
    ...source,
    settings: mergeMonitoringSettingsIntoSourceSettings(source.settings, monitoringSettings, source),
  }
}

export function nextSourceStatus(source: MonitoringSourceForRun, result: MonitoringCollectorResult): string {
  // A one-off run may explicitly claim a paused source, but its result never
  // grants permission to resume automatic scheduling.
  if (source.status === "paused") return "paused"
  if (result.status === "success") return "active"
  if (result.status === "partial") return "limited"
  if (result.status === "failed") return "limited"
  if (result.status === "skipped" && (
    result.error?.startsWith("official_")
    || result.error?.startsWith("provider_")
    || result.error?.startsWith("search_index_")
    || result.error?.startsWith("notification_inbox_")
    || result.error?.startsWith("browser_capture_")
    || result.error === "instagram_hashtag_query_required"
  )) return "needs_setup"
  return source.status
}

export async function runMonitoringSource(
  source: MonitoringSourceForRun,
  options: {
    manualRun?: boolean
    allowPausedSource?: boolean
    fullArchiveRun?: boolean
    manualMaxTotalChargeUsd?: number
    deepSearch?: boolean
    onlyCapability?: SourceCapability
    targetScenarioId?: string
    targetSubjectId?: string
    archiveStartAt?: string | null
    paidRunConfirmed?: boolean
    clientFundedManual?: boolean
    providerAccountFunded?: boolean
    includeComments?: boolean
  } = {},
): Promise<CollectorRunSummary> {
  const effectiveSource = await applyTenantMonitoringSettings(source)
  const eligibleStatuses = options.allowPausedSource === true
    ? ["active", "limited", "needs_setup", "paused"]
    : ["active", "limited", "needs_setup"]
  const fencedClaim = await withSocialMonitoringTenantCollectionFence(
    effectiveSource.organizationId,
    () => claimMonitoringSourceRun(
      effectiveSource.organizationId,
      effectiveSource.id,
      new Date(),
      COLLECTOR_LEASE_MS,
      eligibleStatuses,
    ),
  )
  if (!fencedClaim.allowed) throw new SocialMonitoringCollectionBlockedError()
  const claim = fencedClaim.value
  if (!claim) {
    const held = await prisma.monitoringSource.findFirst({
      where: { id: effectiveSource.id, organizationId: effectiveSource.organizationId },
      select: { runClaimExpiresAt: true },
    })
    const retryAfterSeconds = held?.runClaimExpiresAt
      ? Math.max(1, Math.ceil((held.runClaimExpiresAt.getTime() - Date.now()) / 1000))
      : undefined
    throw new MonitoringSourceClaimUnavailableError(retryAfterSeconds)
  }

  let released = false
  try {
    const run = requireCurrentMonitoringSourceClaim(
      await withCurrentMonitoringSourceClaimFence(
        effectiveSource,
        claim,
        eligibleStatuses,
        () => prisma.collectorRun.create({
      data: {
        organizationId: effectiveSource.organizationId,
        sourceId: effectiveSource.id,
        claimToken: claim.token,
        claimVersion: claim.version,
        leaseExpiresAt: claim.expiresAt,
        status: "running",
        rawStats: {
          manualRun: options.manualRun === true,
          ...(options.fullArchiveRun === true ? { fullArchiveRun: true } : {}),
          ...(options.onlyCapability ? { onlyCapability: options.onlyCapability } : {}),
          ...(options.targetScenarioId ? { targetScenarioId: options.targetScenarioId } : {}),
          ...(options.targetSubjectId ? { targetSubjectId: options.targetSubjectId } : {}),
          ...(options.archiveStartAt !== undefined
            ? { archiveStartAt: options.archiveStartAt }
            : {}),
          ...(options.paidRunConfirmed !== undefined
            ? { paidRunConfirmed: options.paidRunConfirmed }
            : {}),
          ...(options.clientFundedManual === true ? { clientFundedManual: true } : {}),
          ...(options.includeComments === true ? { includeComments: true } : {}),
          ...(options.manualMaxTotalChargeUsd !== undefined
            ? { manualMaxTotalChargeUsd: options.manualMaxTotalChargeUsd }
            : {}),
        },
      },
        }),
      ),
    )

    let ownedIdentity: MonitoringAuthorIdentity
    try {
      ownedIdentity = await assertMonitoringSourceIdentityCollectable({
        organizationId: effectiveSource.organizationId,
        source: effectiveSource,
        db: prisma,
      })
    } catch (error) {
      if (!(error instanceof MonitoringSourceIdentityBlockedError)) throw error
      await prisma.collectorRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: "skipped",
          error: OFFICIAL_IDENTITY_NOT_COLLECTABLE,
          rawStats: {
            manualRun: options.manualRun === true,
            dispatchBlocked: true,
            dispatchBlockReason: OFFICIAL_IDENTITY_NOT_COLLECTABLE,
          },
        },
      })
      throw error
    }
    const collectableSource: MonitoringSourceForRun = {
      ...effectiveSource,
      ownedIdentity,
    }

    let result: MonitoringCollectorResult
    try {
      result = await runSafeCollector(collectableSource, run.id, {
        claim,
        eligibleStatuses,
        manualSourceRun: options.allowPausedSource === true,
        manualPaidRun: options.manualRun === true,
        fullArchiveRun: options.fullArchiveRun === true,
        manualMaxTotalChargeUsd: options.manualMaxTotalChargeUsd,
        deepSearch: options.deepSearch === true,
        onlyCapability: options.onlyCapability,
        targetScenarioId: options.targetScenarioId,
        targetSubjectId: options.targetSubjectId,
        archiveStartAt: options.archiveStartAt,
        paidRunConfirmed: options.paidRunConfirmed,
        clientFundedManual: options.clientFundedManual,
        includeComments: options.includeComments,
      })
    } catch (error) {
      if (
        error instanceof SocialMonitoringCollectionBlockedError
        || error instanceof MonitoringSourceClaimUnavailableError
      ) {
        throw error
      }
      result = {
        status: "failed",
        foundCount: 0,
        newCount: 0,
        duplicateCount: 0,
        ignoredCount: 0,
        error: error instanceof Error ? error.message : "collector_exception",
        rawStats: {
          manualRun: options.manualRun === true,
          ...(options.onlyCapability ? { onlyCapability: options.onlyCapability } : {}),
          ...(options.targetScenarioId ? { targetScenarioId: options.targetScenarioId } : {}),
          ...(options.targetSubjectId ? { targetSubjectId: options.targetSubjectId } : {}),
          ...(options.archiveStartAt !== undefined
            ? { archiveStartAt: options.archiveStartAt }
            : {}),
          ...(options.paidRunConfirmed !== undefined
            ? { paidRunConfirmed: options.paidRunConfirmed }
            : {}),
          ...(options.clientFundedManual === true ? { clientFundedManual: true } : {}),
          ...(options.includeComments === true ? { includeComments: true } : {}),
          ...(options.manualMaxTotalChargeUsd !== undefined
            ? { manualMaxTotalChargeUsd: options.manualMaxTotalChargeUsd }
            : {}),
        },
      }
    }

    const finishedAt = new Date()
    // IngestEnvelope is the durable decision ledger. Aggregate it after the
    // adapter finishes so every collector gets the same run-scoped reasons,
    // without making individual adapters coordinate counters. Observability
    // must never turn an otherwise successful collector run into a failure.
    const rejectionReasonHistogram = await getCollectorRunRejectionHistogram(
      effectiveSource.organizationId,
      run.id,
    ).catch(error => {
      console.error("[social-monitoring] rejection histogram unavailable", error)
      return null
    })
    const finalizedRawStats = {
      ...(result.rawStats ?? {}),
      ...(rejectionReasonHistogram ? { rejectionReasonHistogram } : {}),
      manualRun: options.manualRun === true,
      ...(options.onlyCapability ? { onlyCapability: options.onlyCapability } : {}),
      ...(options.targetScenarioId ? { targetScenarioId: options.targetScenarioId } : {}),
      ...(options.targetSubjectId ? { targetSubjectId: options.targetSubjectId } : {}),
      ...(options.archiveStartAt !== undefined
        ? { archiveStartAt: options.archiveStartAt }
        : {}),
      ...(options.paidRunConfirmed !== undefined
        ? { paidRunConfirmed: options.paidRunConfirmed }
        : {}),
      ...(options.clientFundedManual === true ? { clientFundedManual: true } : {}),
      ...(options.includeComments === true ? { includeComments: true } : {}),
      ...(options.manualMaxTotalChargeUsd !== undefined
        ? { manualMaxTotalChargeUsd: options.manualMaxTotalChargeUsd }
        : {}),
      claimVersion: claim.version,
    }
    result = { ...result, rawStats: finalizedRawStats }
    await prisma.collectorRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        status: result.status,
        foundCount: result.foundCount,
        newCount: result.newCount,
        duplicateCount: result.duplicateCount,
        ignoredCount: result.ignoredCount,
        error: result.error ?? null,
        rawStats: finalizedRawStats,
      },
    })

    const successfulThroughAt = result.successfulThroughAt instanceof Date
      && Number.isFinite(result.successfulThroughAt.getTime())
      ? new Date(Math.min(result.successfulThroughAt.getTime(), finishedAt.getTime()))
      : finishedAt
    const sourceObservationData = {
      lastCheckedAt: finishedAt,
      ...(result.status === "success" ? { lastSuccessfulAt: successfulThroughAt } : {}),
      lastError: result.error ?? null,
      runClaimToken: null,
      runClaimExpiresAt: null,
    }
    let sourceUpdate = await prisma.monitoringSource.updateMany({
      where: {
        id: effectiveSource.id,
        organizationId: effectiveSource.organizationId,
        runClaimToken: claim.token,
        runClaimVersion: claim.version,
        // Change status only if it still exactly matches the snapshot used by
        // this run. This preserves both directions of an operator race:
        // active -> paused and a manual paused run followed by paused -> active.
        status: effectiveSource.status,
      },
      data: {
        status: nextSourceStatus(effectiveSource, result),
        ...sourceObservationData,
      },
    })
    if (sourceUpdate.count !== 1) {
      // The exact-status predicate and update are one atomic SQL statement. If
      // an operator changed status first, release only our matching lease and
      // persist observations without changing that newer decision.
      sourceUpdate = await prisma.monitoringSource.updateMany({
        where: {
          id: effectiveSource.id,
          organizationId: effectiveSource.organizationId,
          runClaimToken: claim.token,
          runClaimVersion: claim.version,
          status: { not: effectiveSource.status },
        },
        data: sourceObservationData,
      })
    }
    released = sourceUpdate.count === 1

    if (!released) {
      const leaseLostResult: MonitoringCollectorResult = {
        ...result,
        status: "failed",
        error: "collector_lease_lost",
        rawStats: { ...(result.rawStats ?? {}), claimVersion: claim.version, leaseLost: true },
      }
      await prisma.collectorRun.update({
        where: { id: run.id },
        data: {
          status: leaseLostResult.status,
          error: leaseLostResult.error,
          rawStats: leaseLostResult.rawStats,
        },
      })
      return { ...leaseLostResult, runId: run.id, sourceId: effectiveSource.id }
    }

    return { ...result, runId: run.id, sourceId: effectiveSource.id }
  } finally {
    if (!released) await releaseMonitoringSourceRunClaim(effectiveSource.organizationId, effectiveSource.id, claim)
  }
}

export async function runMonitoringSourceNow(
  organizationId: string,
  sourceId: string,
  options: {
    maxTotalChargeUsd?: number
    requestedByUserId?: string
    onlyCapability?: SourceCapability
    targetScenarioId?: string
    targetSubjectId?: string
    archiveStartAt?: string | null
    paidRunConfirmed?: boolean
    clientFundedManual?: boolean
    providerAccountFunded?: boolean
    fullArchiveRun?: boolean
    includeComments?: boolean
  } = {},
): Promise<CollectorRunSummary | { error: string; retryAfterSeconds?: number }> {
  const source = await prisma.monitoringSource.findFirst({
    where: { id: sourceId, organizationId },
  })
  if (!source) return { error: "not_found" }
  if (
    options.clientFundedManual === true
    && (
      !options.targetScenarioId
      || !options.targetSubjectId
      || options.paidRunConfirmed !== true
      || !options.requestedByUserId
    )
  ) {
    return { error: "client_funded_manual_scope_required" }
  }
  if (
    options.includeComments === true
    && (
      options.clientFundedManual !== true
      || options.paidRunConfirmed !== true
      || options.providerAccountFunded === true
      || !options.targetScenarioId
      || !options.targetSubjectId
      || !options.requestedByUserId
    )
  ) {
    return { error: "external_comments_run_not_authorized" }
  }
  if (options.includeComments === true) {
    const scenario = await getMonitoringScenariosUncached(organizationId)
      .then(scenarios => scenarios.find(item => item.id === options.targetScenarioId))
      .catch(() => null)
    if (
      !scenario
      || scenario.status !== "active"
      || scenario.subjectId !== options.targetSubjectId
      || scenario.search.includeExternalComments !== true
    ) {
      return { error: "external_comments_run_not_authorized" }
    }
  }
  if (
    options.targetScenarioId
    && ["paused", "disabled", "blocked"].includes(source.status)
  ) {
    return { error: "monitoring_source_not_active" }
  }

  if (
    options.onlyCapability
    && options.maxTotalChargeUsd === undefined
    && options.clientFundedManual !== true
  ) {
    let scopedPlans = await prisma.sourceRoutePlan.findMany({
      where: {
        organizationId,
        sourceId,
        capability: options.onlyCapability,
        status: { in: ["ACTIVE", "DEGRADED"] },
      },
      select: { primaryAdapter: true, fallbackAdapters: true },
    })
    // WEB discovery is deterministically free in the current policy. Repair a
    // persisted legacy APIFY plan before the paid-route preflight evaluates it,
    // otherwise the first click after a policy upgrade is rejected even though
    // runSafeCollector would immediately recompile the same source to the free
    // Azerbaijan news adapter.
    const freeWebNewsAdapters = new Set<string>([
      ROUTE_ADAPTERS.AZERBAIJAN_NEWS_DIRECT,
      ROUTE_ADAPTERS.GOOGLE_ALERTS_RSS,
    ])
    const freeWebNewsDiscovery = source.platform === "web"
      && options.onlyCapability === "DISCOVER_POSTS"
    if (
      freeWebNewsDiscovery
      && (
        scopedPlans.length === 0
        || scopedPlans.some((plan: { primaryAdapter: string }) =>
          !freeWebNewsAdapters.has(plan.primaryAdapter))
      )
    ) {
      await compileSourceRoutePlans({
        ...source,
        ownership: source.ownership ?? "unknown",
      })
      scopedPlans = await prisma.sourceRoutePlan.findMany({
        where: {
          organizationId,
          sourceId,
          capability: options.onlyCapability,
          status: { in: ["ACTIVE", "DEGRADED"] },
        },
        select: { primaryAdapter: true, fallbackAdapters: true },
      })
    }
    const scopedPaid = scopedPlans.some((plan: { primaryAdapter: string; fallbackAdapters: string[] }) =>
      [plan.primaryAdapter, ...(plan.fallbackAdapters ?? [])].some((adapter) =>
        adapter === ROUTE_ADAPTERS.APIFY_ASYNC || requiresPaidRouteBudget(adapter),
      ),
    )
    if (scopedPaid) return { error: "paid_manual_run_cap_required" }
  }

  // Async providers can keep billing after the short collector request has
  // returned. Refuse only a genuinely overlapping provider job; once it is
  // terminal, another deliberate click is allowed immediately.
  const activeProviderRun = await prisma.socialProviderRun.findFirst({
    where: {
      organizationId,
      sourceId,
      status: { in: ["QUEUED", "RUNNING", "IMPORTING", "SUCCEEDED"] },
      // The successful reservation wrapper has no provider work left. Treating
      // it as active prevents the same shared source from running for the next
      // profile even after its concrete child run has been imported.
      NOT: { phase: PAID_RUN_PHASE, status: "SUCCEEDED" },
    },
    orderBy: { createdAt: "desc" },
    select: { startedAt: true, createdAt: true, timeoutSeconds: true },
  })
  if (activeProviderRun) {
    const startedAt = activeProviderRun.startedAt ?? activeProviderRun.createdAt
    const timeoutMs = Math.max(30, activeProviderRun.timeoutSeconds) * 1_000
    const expiresAt = startedAt.getTime() + timeoutMs + 5 * 60_000
    if (Date.now() < expiresAt) {
      return {
        error: "already_running",
        retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1_000)),
      }
    }
  }

  const requestedCap = options.clientFundedManual === true
    ? options.providerAccountFunded === true
      ? undefined
      : Math.min(
        options.maxTotalChargeUsd ?? CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD,
        CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD,
      )
    : options.maxTotalChargeUsd
  // WEB discovery is hard-routed to the free Azerbaijan news adapter. A user
  // click must re-check the bounded 90-day news window instead of resuming from
  // the scheduler watermark; otherwise a recent zero-result scheduled run can
  // hide valid older news. This must stay WEB/DISCOVER_POSTS-only so manual
  // clicks on paid social routes do not silently broaden provider work.
  const fullWebNewsRefresh = source.platform === "web"
    && (options.onlyCapability === undefined || options.onlyCapability === "DISCOVER_POSTS")
    && requestedCap === undefined
    && options.clientFundedManual !== true
  const effectiveFullArchiveRun = options.fullArchiveRun === true || fullWebNewsRefresh
  if (requestedCap !== undefined && !options.requestedByUserId) {
    return { error: "paid_manual_run_actor_required" }
  }

  // A no-cap run normally goes through the tenant budget/quota policy. Bright
  // Data is the exception when the explicit profile action has confirmed a
  // provider-account-funded route: its own provider account is the billing
  // boundary, so LeadDrive must not reintroduce a local USD cap here.
  if (requestedCap === undefined && options.providerAccountFunded !== true) {
    const policy = parseTenantPaidRunPolicy(
      (await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }))?.settings,
    )
    if (policy.manualRunsEnabled) {
      if (policy.emergencyStopped) return { error: "paid_manual_run_emergency_stopped" }
      try {
        // A no-cap manual run (bulk "Run all", or a free source) still searches
        // deep: deepSearch lifts the per-run item ceiling, while paid sources
        // here stay bound by the automatic route budget (no manual per-click cap
        // was supplied).
        return await runMonitoringSource(source, {
          allowPausedSource: true,
          deepSearch: true,
          fullArchiveRun: effectiveFullArchiveRun,
          onlyCapability: options.onlyCapability,
          targetScenarioId: options.targetScenarioId,
          targetSubjectId: options.targetSubjectId,
          archiveStartAt: options.archiveStartAt,
          paidRunConfirmed: options.paidRunConfirmed,
        })
      } catch (error) {
        if (error instanceof MonitoringSourceClaimUnavailableError) {
          return { error: "already_running", retryAfterSeconds: error.retryAfterSeconds }
        }
        if (error instanceof MonitoringSourceIdentityBlockedError) {
          return { error: error.code }
        }
        throw error
      }
    }
  }

  const authorization = requestedCap === undefined
    ? null
    : await authorizeTenantManualPaidRun({
        organizationId,
        sourceId,
        requestedByUserId: options.requestedByUserId ?? "",
        maxTotalChargeUsd: requestedCap,
        clientFundedManual: options.clientFundedManual,
      })
  if (authorization?.status === "BLOCKED") return { error: authorization.reason }
  const effectiveManualCap = authorization?.status === "AUTHORIZED"
    ? authorization.maxTotalChargeUsd
    : requestedCap

  let result: CollectorRunSummary | null = null
  let thrown: unknown = null
  try {
    result = await runMonitoringSource(source, {
      manualRun: true,
      allowPausedSource: true,
      fullArchiveRun: effectiveFullArchiveRun,
      manualMaxTotalChargeUsd: effectiveManualCap,
      deepSearch: true,
      onlyCapability: options.onlyCapability,
      targetScenarioId: options.targetScenarioId,
      targetSubjectId: options.targetSubjectId,
      archiveStartAt: options.archiveStartAt,
      paidRunConfirmed: options.paidRunConfirmed,
      clientFundedManual: options.clientFundedManual,
      includeComments: options.includeComments,
    })
    return result
  } catch (error) {
    thrown = error
    if (error instanceof MonitoringSourceClaimUnavailableError) {
      return { error: "already_running", retryAfterSeconds: error.retryAfterSeconds }
    }
    if (error instanceof MonitoringSourceIdentityBlockedError) {
      return { error: error.code }
    }
    throw error
  } finally {
    if (authorization?.status === "AUTHORIZED") {
      // An unexpected exception after collector execution begins makes dispatch
      // state unknowable. Keep the full reservation in that case; release only
      // when we can positively prove there was no provider-side exposure.
      let providerRequestDispatched =
        thrown !== null && !(thrown instanceof MonitoringSourceIdentityBlockedError)
      if (result?.runId) {
        const providerRuns = await prisma.socialProviderRun.findMany({
          where: {
            organizationId,
            collectorRunId: result.runId,
          },
          select: {
            inputSnapshot: true,
            externalRunId: true,
            reservedChargeUsd: true,
            actualChargeUsd: true,
          },
        }).catch(() => null)
        providerRequestDispatched = providerRuns === null
          ? true
          : providerRuns.some(providerRunShowsDispatchExposure)
      }
      await finalizeTenantManualPaidRunAuthorization({
        organizationId,
        authorizationId: authorization.authorizationId,
        requestedByUserId: options.requestedByUserId ?? "",
        collectorRunId: result?.runId ?? null,
        outcome: result?.status ?? (thrown ? "exception" : "blocked"),
        providerRequestDispatched,
        maxTotalChargeUsd: authorization.maxTotalChargeUsd,
      }).catch(error => {
        console.error("[social-monitoring] paid-run authorization finalization failed", error)
      })
    }
  }
}
export async function findDueMonitoringSources(options: { organizationId?: string; limit?: number } = {}): Promise<MonitoringSourceForRun[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100))
  const candidates: Array<MonitoringSourceForRun & {
    organization: { settings: unknown }
    routePlans: AutomaticRoutePlan[]
    subjectSources: Array<{ relationType: string; scenarioId: string | null; subject: { status: string } }>
  }> = await prisma.monitoringSource.findMany({
    where: {
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      status: { in: ["active", "limited", "needs_setup"] },
    },
    include: {
      organization: { select: { settings: true } },
      routePlans: {
        where: { status: { not: "INVALIDATED" } },
        select: {
          status: true,
          capability: true,
          primaryAdapter: true,
          fallbackAdapters: true,
          capabilityProofId: true,
          budget: true,
          policyVersion: true,
          dependsOnCapability: true,
          lastFailureClass: true,
        },
      },
      subjectSources: {
        select: {
          relationType: true,
          scenarioId: true,
          subject: { select: { status: true } },
        },
      },
    },
    // PostgreSQL sorts NULL values last for ascending order by default. A new
    // source has lastCheckedAt=null, so the global bounded candidate window
    // could repeatedly fill with older checked sources and never admit the
    // new source at all. Make the first-run priority explicit; after one run
    // lastCheckedAt is populated and the source rejoins normal oldest-first
    // scheduling.
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "asc" }],
    take: Math.min(limit * 5, 500),
  })

  const due: MonitoringSourceForRun[] = []
  const selectedWebNewsRoutes = new Set<string>()
  const webNewsScenarioIds = (source: typeof candidates[number]): string[] => {
    if (source.platform !== "web") return []
    const settings = recordFromUnknown(source.settings)
    const scenarioLinks = Array.isArray(settings.scenarioLinks) ? settings.scenarioLinks : []
    const scenarioIds = [
      ...source.subjectSources.map(link => link.scenarioId),
      typeof settings.scenarioId === "string" ? settings.scenarioId : null,
      ...scenarioLinks.map(link => {
        const scenarioId = recordFromUnknown(link).scenarioId
        return typeof scenarioId === "string" ? scenarioId : null
      }),
    ].filter((scenarioId): scenarioId is string => Boolean(scenarioId))
    return Array.from(new Set(scenarioIds))
  }
  const webNewsRouteKeys = (source: typeof candidates[number]): string[] | null => {
    if (source.platform !== "web") return []
    const settings = recordFromUnknown(source.settings)
    const scenarioIds = webNewsScenarioIds(source)
    if (scenarioIds.length === 0) {
      return [`${source.organizationId}:${source.id}:independent`]
    }
    const routeKind = (
      source.sourceType === "notification_inbox"
      && source.collectionMode === "notification_inbox"
      && settings.managedBy === "google_alerts_rss"
    )
      ? "rss"
      : null
    // Историческим web-строкам расписание не положено. У сценария остался
    // ровно один web-слот — лента Google Alerts (решение владельца
    // 2026-08-01). Прежний «канонический прямой поиск» отбирался здесь по
    // статусу строки, ничего не зная о плане сценария, и продолжал бы
    // обходить издания даже после того, как сценарий перестал его создавать.
    if (!routeKind) return null
    return scenarioIds.map(scenarioId =>
      `${source.organizationId}:${scenarioId}:${routeKind}`)
  }
  const appendDue = (source: typeof candidates[number]): boolean => {
    const routeKeys = webNewsRouteKeys(source)
    if (routeKeys === null) return false
    if (routeKeys.some(key => selectedWebNewsRoutes.has(key))) return false
    routeKeys.forEach(key => selectedWebNewsRoutes.add(key))
    due.push(source)
    return true
  }
  const scheduleByOrganization = new Map<string, Awaited<ReturnType<typeof getSocialMonitoringSettings>>["schedule"]>()
  for (const source of candidates) {
    if (socialMonitoringCleanSlateBlocked(source.organization?.settings)) continue
    const webRouteKeys = webNewsRouteKeys(source)
    if (webRouteKeys === null) continue
    let schedule = scheduleByOrganization.get(source.organizationId)
    if (!schedule) {
      schedule = (await getSocialMonitoringSettings(source.organizationId)).schedule
      scheduleByOrganization.set(source.organizationId, schedule)
    }
    if (!schedule.enabled) continue
    const eligibility = automaticSourceCollectionDecision({
      settings: source.settings,
      platform: source.platform,
      sourceType: source.sourceType,
      url: source.url,
      handle: source.handle,
      ownership: source.ownership,
      linkedSubjectStatuses: source.subjectSources?.map(link => link.subject.status) ?? [],
      linkedSubjectRelations: source.subjectSources ?? [],
      routePlans: source.routePlans ?? [],
      organizationSettings: source.organization?.settings,
      currentRoutePolicyVersion: SOURCE_ROUTE_POLICY_VERSION,
    })
    if (!eligibility.allowed) continue
    // A legacy proofless META_GRAPH plan cannot repair itself until the
    // collector recompiles it. Bypass cadence/backoff exactly once for this
    // bounded migration; the new provider/manual plan is no longer classified
    // as legacy on the next scheduler pass.
    if (eligibility.reason === "legacy_route_migration_required") {
      appendDue(source)
      if (due.length >= limit) break
      continue
    }
    if (webRouteKeys.some(key => selectedWebNewsRoutes.has(key))) continue
    const recentRuns = await prisma.collectorRun.findMany({
      where: { organizationId: source.organizationId, sourceId: source.id },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { status: true, startedAt: true, error: true, foundCount: true },
    })
    if (monitoringSourceDueState(
      source,
      recentRuns,
      new Date(),
      schedule.cadenceMinutes,
    ).due) appendDue(source)
    if (due.length >= limit) break
  }
  return due
}

export async function runDueMonitoringSources(options: { organizationId?: string; limit?: number } = {}) {
  const sources = await findDueMonitoringSources(options)
  const results: Array<CollectorRunSummary | { sourceId: string; error: string }> = []
  for (const source of sources) {
    try {
      results.push(await runMonitoringSource(source))
    } catch (error) {
      results.push({ sourceId: source.id, error: error instanceof Error ? error.message : "collector_run_failed" })
    }
  }
  return {
    selected: sources.length,
    results,
    foundTotal: results.reduce((sum, item) => sum + ("foundCount" in item ? item.foundCount : 0), 0),
    newTotal: results.reduce((sum, item) => sum + ("newCount" in item ? item.newCount : 0), 0),
  }
}
