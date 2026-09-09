import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { decryptToken, hmacToken } from "@/lib/secure-token"
import { findMatchedKeyword, ingestMentionWithResult, type IngestInput, type ParentMatchContext } from "@/lib/social/ingest-mention"
import { parentMatchContextsForComments } from "@/lib/social/parent-match-context"
import {
  observationContextForCollector,
  routeExecutionMetadata,
  targetScopedObservationIdempotencyKey,
} from "@/lib/social/collector-observation-context"
import { getSocialMonitoringSettings, platformApifyToken, type ApifySearchActors } from "@/lib/social/monitoring-settings"
import {
  tenantClientFundedManualRunsEnabled,
  tenantPaidRunEmergencyStopped,
  tenantProviderAccountFundedRunPolicy,
} from "@/lib/social/paid-run-authorization"
import {
  socialMonitoringCleanSlateBlocked,
  socialMonitoringPaidEmergencyStopped,
  withSocialMonitoringImportFence,
} from "@/lib/social/monitoring-import-fence"
import {
  standardPaidProviderChargeTotalUsd,
  standardPaidProviderCollectorRunIdsSince,
} from "@/lib/social/paid-provider-run-scope"
import {
  allocateClientFundedSourceCapsUsd,
  boundedClientFundedManualChargeUsd,
  boundedPaidSocialRunChargeUsd,
  CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD,
  effectivePaidSocialPeriodLimits,
  PAID_SOCIAL_HARD_DAILY_BUDGET_USD,
  PAID_SOCIAL_HARD_MAX_PER_RUN_USD,
  PAID_SOCIAL_HARD_MONTHLY_BUDGET_USD,
} from "@/lib/social/provider-spend-limits"
import type { MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import {
  advanceMonitoringRouteProviderCursor,
  ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES,
  resolveArchiveProviderWindow,
  scenarioArchiveStartAtForSource,
  type ArchiveProviderCursorScope,
  type ArchiveProviderWindow,
  withArchiveProviderCursorOverlap,
} from "@/lib/social/archive-provider-window"
import {
  markCommentCheckpointsDispatched,
  recordCommentCheckpointBatch,
  registerAndSelectDueCommentCheckpoints,
} from "@/lib/social/comment-checkpoint-repo"
import {
  reconcileTikTokPublicationRevisitsForSource,
  recordTikTokPublicationRevisitByPost,
} from "@/lib/social/tiktok-publication-revisit-repo"
import {
  decideTikTokPublication,
  isTikTokPublicationEligibleForComments,
  persistTikTokPublicationDecision,
} from "@/lib/social/tiktok-publication-gate"
import {
  SOCIAL_COMMENT_RELEVANCE_VERSION,
  classifySocialCommentThread,
  hasCommentEngagementSignal,
} from "@/lib/social/tiktok-comment-relevance"
import { canonicalProviderUrl } from "@/lib/social/provider-capability-contract"
import { recordSourceRouteResult } from "@/lib/social/source-route-plan"
import { ownedWebSearchExclusionHosts } from "@/lib/social/mention-author-scope"
import { withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"
import {
  isMetaGlobalSearchSource,
  metaSearchUrlQueryTerm,
} from "@/lib/social/meta-global-search-source"

const APIFY_API = "https://api.apify.com/v2"
const APIFY_PROVIDER = "APIFY"
const NORMALIZED_SCHEMA_VERSION = "social-observation-v2.1"
const DEFINITE_APIFY_START_REJECTIONS = new Set([400, 401, 403, 404, 405, 413, 415, 422])
const WEB_DISCOVERY_SOURCE_TYPES = new Set(["search_url", "keyword", "campaign", "hashtag"])
const APIFY_IMPORT_PROGRESS_BATCH_SIZE = 25
const APIFY_COST_STABILITY_DELAY_MS = 15_000
const APIFY_IMPORT_LEASE_MIN_MS = 30 * 60_000
const DEPENDENT_COMMENT_DISPATCH_LEASE_MS = 5 * 60_000
const APIFY_START_REQUEST_TIMEOUT_MS = 60_000
const DEPENDENT_COMMENTS_PENDING_MARKER = "leadDriveDependentCommentsPending"
const DEPENDENT_INSTAGRAM_REELS_PENDING_MARKER = "leadDriveDependentInstagramReelsPending"
const DEPENDENT_FACEBOOK_FAN_OUT_PENDING_MARKER = "leadDriveDependentFacebookFanOutPending"
const APIFY_GOOGLE_SEARCH_ACTOR = "apify/google-search-scraper"
const APIFY_FACEBOOK_SEARCH_ACTOR = "scrapeforge/facebook-search-posts"
const APIFY_INSTAGRAM_HASHTAG_ACTOR = "apify/instagram-hashtag-scraper"
const APIFY_TIKTOK_SEARCH_ACTOR = "clockworks/tiktok-scraper"
const TIKTOK_SEARCH_QUERY_LIMIT = 10
// #638: every fan-out slot must keep at least this paid depth, so aliases can
// never starve the canonical brand term below a usable page of results.
const PROVIDER_FAN_OUT_MIN_ITEMS_PER_TERM = 15
const PROVIDER_FAN_OUT_MAX_ALIAS_TERMS = 3
const FACEBOOK_NATIVE_DISCOVERY_SOURCE_TYPES = new Set(["keyword", "campaign", "hashtag"])
const INSTAGRAM_KEYWORD_DISCOVERY_SOURCE_TYPES = new Set(["keyword", "campaign"])
const PINNED_ACTOR_BUILDS: Record<string, string> = {
  // Public actor metadata checked 2026-07-28. Discovery routes must use an
  // immutable build number; an internal route contract is not an Apify build.
  [APIFY_GOOGLE_SEARCH_ACTOR]: "0.0.409",
  "apify/instagram-scraper": "0.0.689",
  // 0.0.585 объявляло поле как «Hashtags» с шаблоном, запрещающим пробелы, —
  // многословный бренд приходилось склеивать в один токен, и «Araz Supermarket»
  // искался как «ArazSupermarket». В 0.0.596 поле стало «Hashtags or keywords»
  // и принимает фразы. Проверено вручную на боевом аккаунте 2026-08-01:
  // 0.0.585 отклоняет «araz supermarket» валидацией схемы, 0.0.596 принимает и
  // возвращает релевантные посты бренда.
  [APIFY_INSTAGRAM_HASHTAG_ACTOR]: "0.0.596",
  // Community Actor. Its public metadata and input/output schemas were checked
  // before pinning; never follow `latest` because this is the native Facebook
  // discovery boundary used for paid runs.
  [APIFY_FACEBOOK_SEARCH_ACTOR]: "1.0.19",
  "apify/facebook-posts-scraper": "0.0.351",
  "clockworks/tiktok-scraper": "0.0.561",
  // Controlled capability proof 2026-07-14: 15 top-level comments + 4 replies,
  // all reply parent links resolved, build id b9EFc61xQ6Qctn1wM.
  "apify/instagram-comment-scraper": "0.0.502",
  // Public actor metadata checked 2026-07-15. Comment routes fail closed when
  // a build is not pinned; these exact build numbers enable the already
  // budget-capped Facebook and TikTok fallbacks without following `latest`.
  "apify/facebook-comments-scraper": "0.0.322",
  "clockworks/tiktok-comments-scraper": "0.0.423",
}
const TERMINAL_SUCCESS = new Set(["SUCCEEDED"])
const TERMINAL_FAILURE = new Set(["FAILED", "ABORTED", "TIMED-OUT"])

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

type FrozenManualCommentAllocation = Readonly<{
  sourceAuthorizedUsd: number
  discoveryUsd: number
  commentsUsd: number
}>

function frozenManualCommentAllocation(snapshotValue: unknown): FrozenManualCommentAllocation | null {
  const snapshot = record(snapshotValue)
  if (
    snapshot.leadDriveManualPaidRun !== true
    || snapshot.leadDriveClientFundedManual !== true
    || snapshot.leadDriveDependentCommentsAuthorized !== true
  ) return null
  const sourceAuthorizedUsd = numberValue(snapshot.leadDriveSourceAuthorizedMaxTotalChargeUsd)
  const discoveryUsd = numberValue(snapshot.leadDriveDiscoveryMaxTotalChargeUsd)
  const commentsUsd = numberValue(snapshot.leadDriveDependentCommentsMaxTotalChargeUsd)
  const currentProviderCapUsd = numberValue(snapshot.operatorAuthorizedMaxTotalChargeUsd)
  if (
    sourceAuthorizedUsd === null
    || discoveryUsd === null
    || commentsUsd === null
    || currentProviderCapUsd === null
    || currentProviderCapUsd <= 0
  ) return null
  const expected = allocateClientFundedSourceCapsUsd({
    authorizedTotalUsd: sourceAuthorizedUsd,
    includeDependentComments: true,
  })
  const toMicroUsd = (value: number) => Math.round(value * 1_000_000)
  if (
    !expected
    || expected.commentsUsd === null
    || toMicroUsd(discoveryUsd) !== toMicroUsd(expected.discoveryUsd)
    || toMicroUsd(commentsUsd) !== toMicroUsd(expected.commentsUsd)
    || toMicroUsd(currentProviderCapUsd) > toMicroUsd(discoveryUsd)
  ) return null
  return Object.freeze({ sourceAuthorizedUsd, discoveryUsd, commentsUsd })
}

function databaseMoneyValue(value: unknown): number | null {
  const direct = numberValue(value)
  if (direct !== null) return direct >= 0 ? direct : null
  if (!value || typeof value !== "object") return null
  const toString = (value as { toString?: () => string }).toString
  if (typeof toString !== "function") return null
  try {
    const parsed = numberValue(toString.call(value))
    return parsed !== null && parsed >= 0 ? parsed : null
  } catch {
    return null
  }
}

function stableApifyActualCharge(remote: JsonRecord, observedAt: Date): number | null {
  const finishedAtRaw = stringValue(remote.finishedAt)
  if (!finishedAtRaw) return null
  const finishedAt = new Date(finishedAtRaw)
  if (
    !Number.isFinite(finishedAt.getTime())
    || observedAt.getTime() - finishedAt.getTime() < APIFY_COST_STABILITY_DELAY_MS
  ) return null
  const charge = numberValue(remote.usageTotalUsd)
    ?? numberValue(record(remote.usage).totalUsd)
  return charge !== null && charge >= 0 ? charge : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean) : []
}

function providerRunResult(run: { id: string; status: string; receivedCount: number; acceptedCount: number; duplicateCount: number; rejectedCount: number; reviewCount: number; lastError: string | null; purgedAt?: Date | null }): MonitoringCollectorResult {
  const inactive = run.status === "PURGED" || Boolean(run.purgedAt)
  return {
    status: inactive || ["FAILED", "BLOCKED"].includes(run.status) ? "failed" : "success",
    foundCount: run.receivedCount,
    newCount: run.acceptedCount,
    duplicateCount: run.duplicateCount,
    ignoredCount: run.rejectedCount + run.reviewCount,
    error: inactive ? "apify_run_purged" : run.lastError,
    rawStats: { providerRunId: run.id, providerStatus: run.status, queued: !inactive && !["IMPORTED", "FAILED", "BLOCKED"].includes(run.status) },
  }
}

async function retainUnknownApifyStart(providerRun: {
  id: string
  organizationId: string
}): Promise<MonitoringCollectorResult> {
  // Once the POST may have reached Apify, a missing acknowledgement is not
  // proof that no paid actor started. Keep the reservation and active row so a
  // retry cannot create overlapping spend. Reconciliation later terminalizes
  // the row without releasing that exposure automatically.
  await prisma.socialProviderRun.updateMany({
    where: {
      id: providerRun.id,
      organizationId: providerRun.organizationId,
      providerKey: APIFY_PROVIDER,
      purgedAt: null,
      status: "RUNNING",
      inputSnapshot: { path: ["providerRequestDispatched"], equals: true },
    },
    data: { status: "RUNNING", lastError: "apify_start_dispatch_unknown" },
  }).catch(() => undefined)
  return {
    status: "partial",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: "apify_start_dispatch_unknown",
    rawStats: {
      providerRunId: providerRun.id,
      providerStatus: "RUNNING",
      queued: true,
      providerRequestDispatched: true,
      dispatchUnknown: true,
    },
  }
}

async function claimApifyStartDispatch(providerRun: {
  id: string
  organizationId: string
}): Promise<boolean> {
  const changed = await prisma.$executeRaw`
    UPDATE "social_provider_runs"
    SET
      "status" = 'RUNNING',
      "startedAt" = COALESCE("startedAt", CURRENT_TIMESTAMP),
      "inputSnapshot" = jsonb_set(
        COALESCE("inputSnapshot", '{}'::jsonb),
        '{providerRequestDispatched}',
        'true'::jsonb,
        true
      ),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${providerRun.id}
      AND "organizationId" = ${providerRun.organizationId}
      AND "providerKey" = ${APIFY_PROVIDER}
      AND "purgedAt" IS NULL
      AND "status" = 'QUEUED'
      AND "externalRunId" IS NULL
      AND COALESCE("actualChargeUsd", 0) <= 0
      AND COALESCE("inputSnapshot", '{}'::jsonb)
        @> '{"providerRequestDispatched": false}'::jsonb
  `
  return Number(changed) === 1
}

async function releaseUndispatchedApifyReservation(providerRun: {
  id: string
  organizationId: string
}, error: string): Promise<boolean> {
  try {
    const released = await prisma.socialProviderRun.updateMany({
      where: {
        id: providerRun.id,
        organizationId: providerRun.organizationId,
        providerKey: APIFY_PROVIDER,
        purgedAt: null,
        status: "QUEUED",
        externalRunId: null,
        OR: [
          { actualChargeUsd: null },
          { actualChargeUsd: { lte: 0 } },
        ],
        inputSnapshot: { path: ["providerRequestDispatched"], equals: false },
      },
      data: {
        status: "BLOCKED",
        lastError: error,
        reservedChargeUsd: 0,
        finishedAt: new Date(),
      },
    })
    return released.count === 1
  } catch {
    // No provider I/O happened. If the database is unavailable, leave the
    // exact false reservation intact: it is safe and can be reaped later.
    return false
  }
}

function actorApiId(actorId: string): string {
  return actorId.replace("/", "~")
}

function actorBuild(actorId: string): string | null {
  return PINNED_ACTOR_BUILDS[actorId] ?? null
}

async function apifyToken(organizationId: string): Promise<string | null> {
  const settings = await getSocialMonitoringSettings(organizationId)
  if (!settings.searchIndex.enabled || settings.searchIndex.provider !== "apify") return null
  // Org token wins; a CORRUPT org token fails closed (no silent fallback to
  // the platform token — that would bill the platform account unnoticed).
  if (settings.searchIndex.encryptedToken) {
    try {
      return decryptToken(settings.searchIndex.encryptedToken, `social-search-index:${organizationId}`)
    } catch {
      return null
    }
  }
  return platformApifyToken()
}

async function settleStableApifyCharge(run: {
  id: string
  organizationId: string
  externalRunId: string | null
  reservedChargeUsd: unknown
}): Promise<boolean> {
  // Prisma represents Decimal columns as Decimal objects in production, while
  // tests and some adapters may return numbers or strings.
  if (!run.externalRunId || (databaseMoneyValue(run.reservedChargeUsd) ?? 0) <= 0) return false
  const token = await apifyToken(run.organizationId)
  if (!token) return false
  const response = await fetch(
    `${APIFY_API}/actor-runs/${encodeURIComponent(run.externalRunId)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  )
  if (!response.ok) return false
  const body = await response.json().catch(() => null) as { data?: JsonRecord } | null
  const remote = record(body?.data)
  const remoteStatus = stringValue(remote.status)
  if (!remoteStatus || (!TERMINAL_SUCCESS.has(remoteStatus) && !TERMINAL_FAILURE.has(remoteStatus))) return false
  const actualCharge = stableApifyActualCharge(remote, new Date())
  if (actualCharge === null) return false
  const updated = await prisma.socialProviderRun.updateMany({
    where: {
      id: run.id,
      organizationId: run.organizationId,
      providerKey: APIFY_PROVIDER,
      externalRunId: run.externalRunId,
    },
    data: {
      actualChargeUsd: actualCharge,
      reservedChargeUsd: 0,
    },
  })
  return updated.count === 1
}

function sourceTerms(source: MonitoringSourceForRun): string[] {
  const settings = record(source.settings)
  const expandedQueries = Array.isArray(settings.expandedQueries) ? settings.expandedQueries : []
  const expanded = expandedQueries.flatMap(value => {
    const item = record(value)
    return [
      stringValue(item.query),
      stringValue(item.term),
      stringValue(item.displayTerm),
      ...stringList(item.terms),
    ]
  }).filter((value): value is string => Boolean(value))
  const explicitKeywords = (source.keywords ?? []).map(value => value.trim()).filter(Boolean)
  const packedFacebookQueryTerms = source.platform === "facebook" && source.query?.includes("|")
    ? source.query.split("|").map(value => value.trim()).filter(Boolean)
    : []
  const sourceQuery = packedFacebookQueryTerms.length > 1
    || (explicitKeywords.length > 0 && source.query?.includes("|"))
    ? ""
    : source.query ?? ""
  return uniqueNormalizedTerms([
    ...explicitKeywords,
    ...packedFacebookQueryTerms,
    sourceQuery,
    metaSearchUrlQueryTerm(source) ?? "",
    source.handle ?? "",
    ...stringList(settings.keywords),
    ...stringList(settings.hashtags),
    ...stringList(settings.aliases),
    ...expanded,
  ])
}

function sourceScenarioIds(source: MonitoringSourceForRun): string[] {
  const settings = record(source.settings)
  const links = Array.isArray(settings.scenarioLinks) ? settings.scenarioLinks.map(record) : []
  return Array.from(new Set([
    source.routeExecution?.targetScenarioId?.trim() ?? "",
    ...links.map(link => stringValue(link.scenarioId) ?? ""),
  ].filter(Boolean)))
}

function uniqueNormalizedTerms(candidates: string[]): string[] {
  const seen = new Set<string>()
  return candidates
    .map(term => term.replace(/^@|^#/, "").trim())
    .filter(Boolean)
    .filter(term => {
      const identity = term.normalize("NFKC").toLocaleLowerCase()
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
}

function providerConfiguredTerms(source: MonitoringSourceForRun): string[] {
  const settings = record(source.settings)
  // Scenario-managed brand discovery deliberately issues one canonical query
  // per brand. Aliases remain in settings for local relevance matching, but
  // must never fan out into additional provider/Meta searches.
  if (settings.canonicalBrandQuery === true) {
    return uniqueNormalizedTerms([source.query ?? ""]).slice(0, 1)
  }
  const queryTerms = source.query?.includes("|")
    ? source.query.split("|")
    : [source.query ?? ""]
  // Provider requests must be driven only by operator/scenario inputs. The
  // expandedQueries list also contains generated variants of the entire
  // packed query (for example "term one term two"), which is useful for local
  // matching but is not an additional paid search target.
  return uniqueNormalizedTerms([
    ...(source.keywords ?? []),
    ...queryTerms,
    metaSearchUrlQueryTerm(source) ?? "",
    source.handle ?? "",
    ...stringList(settings.keywords),
    ...stringList(settings.hashtags),
    ...stringList(settings.aliases),
  ])
}

function providerDiscoveryTerms(source: MonitoringSourceForRun): string[] {
  return record(source.settings).canonicalBrandQuery === true
    ? providerConfiguredTerms(source)
    : sourceTerms(source)
}

/**
 * Платные поисковые слоты бренд-источника (#638): канонический термин всегда
 * в слоте 0, дальше — алиасы из `searchFanOutTerms`, ровно столько, сколько
 * бюджет прогона выдерживает при минимальной глубине на термин. Список
 * алиасов берётся ТОЛЬКО из searchFanOutTerms: сценарий перезаписывает его
 * при каждом сохранении, в отличие от вечно растущих `aliases`/легаси
 * `keywords`, из которых собирается providerConfiguredTerms.
 *
 * Осознанный трейд веера: порог насыщения канонического слота падает с
 * maxItems до floor(maxItems/N), то есть у очень активного бренда PARTIAL
 * (заморозка курсора и перекупка окна) наступает чаще. Петля ограничена
 * 30-дневным клампом окна, видна оператору как apify_result_limit_reached и
 * распадается, как только объём бренда в окне опускается ниже пер-слотовой
 * глубины. Межпрогонного состояния, чтобы схлопывать веер на ретрае, у
 * билдера нет — это цена слайса 1.
 */
function providerFanOutTerms(source: MonitoringSourceForRun, maxItems: number): string[] {
  // Легаси pipe-packed запрос: слот 0 — первый сегмент (операторский приоритет,
  // как у facebookPrimaryProviderTerm), остальные сегменты — первые кандидаты
  // веера, чтобы разбиение старой упаковки не терялось.
  const querySegments = source.query?.includes("|")
    ? source.query.split("|").map(segment => segment.trim())
    : [source.query ?? ""]
  const canonical = uniqueNormalizedTerms(querySegments).slice(0, 1)
  const settings = record(source.settings)
  if (settings.canonicalBrandQuery !== true || canonical.length === 0) return canonical
  const aliasBudget = Math.min(
    PROVIDER_FAN_OUT_MAX_ALIAS_TERMS,
    Math.floor(Math.max(0, Math.trunc(maxItems)) / PROVIDER_FAN_OUT_MIN_ITEMS_PER_TERM) - 1,
  )
  if (aliasBudget < 1) return canonical
  return uniqueNormalizedTerms([
    ...canonical,
    ...querySegments,
    ...stringList(settings.searchFanOutTerms),
  ]).slice(0, 1 + aliasBudget)
}

function isFacebookNativeDiscoverySource(source: MonitoringSourceForRun): boolean {
  return FACEBOOK_NATIVE_DISCOVERY_SOURCE_TYPES.has(source.sourceType)
    || (source.sourceType === "search_url" && isMetaGlobalSearchSource(source))
}

function isInstagramKeywordDiscoverySource(source: MonitoringSourceForRun): boolean {
  return INSTAGRAM_KEYWORD_DISCOVERY_SOURCE_TYPES.has(source.sourceType)
    || (source.sourceType === "search_url" && isMetaGlobalSearchSource(source))
}

/**
 * The native Facebook actor accepts exactly one query, so the term choice must
 * be deterministic and follow operator intent: the source's own query first
 * (first segment of a legacy pipe-packed query), then the pasted search URL's
 * term, then explicit keywords. Never `sourceTerms()` order — it puts keywords
 * before the query, and never derived `expandedQueries` variants — those are
 * import-time matching tolerances, not search intent.
 *
 * Дочерний прогон веера (#638) приносит собственный термин: родной поиск не
 * принимает список, поэтому алиасный слот — это отдельный прогон.
 */
function facebookPrimaryProviderTerm(source: MonitoringSourceForRun): string | null {
  const fanOutTerm = source.routeExecution?.providerSearchTermOverride?.trim()
  if (fanOutTerm) return uniqueNormalizedTerms([fanOutTerm])[0] ?? null
  const settings = record(source.settings)
  // Pre-trim pipe segments: uniqueNormalizedTerms strips a leading # before
  // trimming, so an untrimmed " #Tag" segment would keep its # in the query.
  const sourceQueryTerms = source.query?.includes("|")
    ? source.query.split("|").map(segment => segment.trim())
    : [source.query ?? ""]
  return uniqueNormalizedTerms([
    ...sourceQueryTerms,
    metaSearchUrlQueryTerm(source) ?? "",
    ...(source.keywords ?? []),
    ...stringList(settings.keywords),
    source.handle ?? "",
    ...stringList(settings.hashtags),
    ...stringList(settings.aliases),
  ])[0] ?? null
}

function normalizedTermIdentity(term: string): string {
  return term.replace(/^@|^#/, "").trim().normalize("NFKC").toLocaleLowerCase()
}

/**
 * Configured terms that the singular native Facebook query cannot carry. They
 * are recorded on the run's inputSnapshot so the coverage trade made by #635
 * (native search on the primary term instead of a Google SERP batch) stays
 * auditable per run instead of silently disappearing.
 */
function facebookUnsentProviderTerms(source: MonitoringSourceForRun, sentQuery: string): string[] {
  const sentIdentity = normalizedTermIdentity(sentQuery)
  // Expand legacy pipe-packed terms into their segments before comparing, so
  // a canonical "A|B" query whose first half WAS dispatched audits only "B"
  // as unsent rather than the whole pack.
  return uniqueNormalizedTerms(
    providerConfiguredTerms(source).flatMap(term => (
      term.includes("|") ? term.split("|").map(segment => segment.trim()) : [term]
    )),
  ).filter(term => normalizedTermIdentity(term) !== sentIdentity)
}

function compactInstagramActorKeywordTerm(sourceTerm: string): string {
  return sourceTerm.normalize("NFKC").replace(/[^\p{L}\p{N}_]+/gu, "")
}

/**
 * Термин, отправляемый актору Instagram в keyword-режиме.
 *
 * Схема поля (сборка 0.0.596) запрещает знаки препинания и служебные символы,
 * но пробелы допускает — многословный бренд ищется целой фразой. Схлопываем
 * повторные пробелы и срезаем запрещённые символы, не склеивая слова.
 */
function instagramActorKeywordTerm(sourceTerm: string): string {
  return sourceTerm
    .normalize("NFKC")
    .replace(/[!?.,:;\-+=*&%$#@/\\~^|<>()[\]{}"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function instagramActorKeywordTerms(source: MonitoringSourceForRun, maxItems = 20): string[] {
  const limit = Math.min(20, Math.max(1, Math.trunc(maxItems)))
  const seen = new Set<string>()
  const terms: string[] = []
  const canonicalBrand = record(source.settings).canonicalBrandQuery === true
  const configured = canonicalBrand
    ? providerFanOutTerms(source, maxItems)
    : providerConfiguredTerms(source)
  const variants = canonicalBrand ? [] : sourceTerms(source)
  for (const sourceTerm of [...configured, ...variants]) {
    // Начиная с закреплённой 0.0.596 актор принимает фразы в keyword-режиме,
    // поэтому бренд уходит как есть — «Araz Supermarket», а не слитный токен.
    // Пунктуация всё ещё вне разрешённого шаблона, её убираем.
    const term = instagramActorKeywordTerm(sourceTerm)
    const identity = term.toLocaleLowerCase()
    if (!term || seen.has(identity)) continue
    seen.add(identity)
    terms.push(term)
    if (terms.length >= limit) break
  }
  return terms
}

function instagramDiscoveryResultsType(source: MonitoringSourceForRun): "posts" | "reels" {
  if (source.routeExecution?.instagramResultsType === "reels") return "reels"
  const configured = stringValue(record(source.settings).instagramResultsType)
  return configured === "reels" ? "reels" : "posts"
}

function matchedApifySourceTerm(
  text: string,
  source: MonitoringSourceForRun,
  terms: string[],
): string | null {
  const directMatch = findMatchedKeyword(text, terms)
  if (directMatch) return directMatch
  if (
    source.platform !== "instagram"
    || !isInstagramKeywordDiscoverySource(source)
  ) return null

  // Instagram keyword search accepts compact hashtag-like inputs only. Match
  // the same dispatched variant during import, but return the original
  // authoritative phrase so reporting and subject attribution stay stable.
  for (const sourceTerm of terms) {
    const compactTerm = compactInstagramActorKeywordTerm(sourceTerm)
    if (!compactTerm || compactTerm.toLocaleLowerCase() === sourceTerm.toLocaleLowerCase()) continue
    const escapedTerm = compactTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const compactToken = new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])[#@]?${escapedTerm}(?=$|[^\\p{L}\\p{N}_])`,
      "iu",
    )
    if (compactToken.test(text.normalize("NFKC"))) return sourceTerm
  }
  return null
}

function ownedSocialProfileSearchExclusions(
  source: MonitoringSourceForRun,
  host: "facebook.com" | "instagram.com",
): string[] {
  const exclusions = new Set<string>()
  for (const rawUrl of source.ownedIdentity?.profileUrls ?? []) {
    try {
      const url = new URL(rawUrl)
      const normalizedHost = url.hostname.toLocaleLowerCase().replace(/^www\./, "")
      const normalizedPath = url.pathname.replace(/\/+$/, "").toLocaleLowerCase()
      if (normalizedHost === host && normalizedPath && normalizedPath !== "/") {
        exclusions.add(`-site:${host}${normalizedPath}`)
      }
    } catch {
      // Invalid historical profile URLs are ignored here. The dispatch guard
      // still blocks canonical identity collisions before any provider call.
    }
  }
  return [...exclusions].sort()
}

function routeBudget(value: unknown) {
  const budget = record(value)
  const maxTotalChargeUsd = numberValue(budget.maxTotalChargeUsd)
  const dailyBudgetUsd = numberValue(budget.dailyBudgetUsd)
  const monthlyBudgetUsd = numberValue(budget.monthlyBudgetUsd)
  return {
    maxItems: Math.max(1, Math.min(1000, Math.trunc(numberValue(budget.maxItems) ?? 100))),
    maxTotalChargeUsd: Math.max(0.01, maxTotalChargeUsd ?? 1),
    dailyBudgetUsd: Math.max(0.01, dailyBudgetUsd ?? 5),
    monthlyBudgetUsd: Math.max(0.01, monthlyBudgetUsd ?? 50),
    usdLimitsConfigured: budget.usdLimitsConfigured === true
      && maxTotalChargeUsd !== null
      && dailyBudgetUsd !== null
      && monthlyBudgetUsd !== null
      && maxTotalChargeUsd > 0
      && dailyBudgetUsd > 0
      && monthlyBudgetUsd > 0,
    timeoutSeconds: Math.max(30, Math.min(3600, Math.trunc(numberValue(budget.timeoutSeconds) ?? 900))),
  }
}

export function apifyActorForSource(source: MonitoringSourceForRun, capability: string, actors: ApifySearchActors): string | null {
  if (capability === "READ_EXTERNAL_COMMENTS") {
    if (source.platform === "instagram") return actors.instagramComments
    if (source.platform === "facebook") return actors.facebookComments
    if (source.platform === "tiktok") return actors.tiktokComments
    return null
  }
  if (source.platform === "web") return actors.webSearch
  if (source.platform === "facebook" && isFacebookNativeDiscoverySource(source)) {
    // Always Facebook's own search engine. The old multi-term escape to the
    // Google actor traded the platform's search for Google's index of
    // facebook.com — SERP rows without dates or post bodies that triage
    // almost entirely rejects (#635). One native row beats N terms of
    // guaranteed rejections; the terms the singular query cannot carry are
    // recorded on the run snapshot instead of silently rerouting the search.
    return actors.facebookSearch
  }
  if (source.platform === "instagram" && isInstagramKeywordDiscoverySource(source)) return actors.instagramHashtag
  if (source.platform === "instagram") return source.sourceType === "hashtag" ? actors.instagramHashtag : actors.instagramProfile
  if (source.platform === "facebook") return actors.facebookPosts
  if (source.platform === "tiktok") return actors.tiktokSearch
  return null
}

function webSearchDateOperators(window: ArchiveProviderWindow | null | undefined): string[] {
  if (!window) return []
  const since = window.since
  const until = window.until
  if (
    !Number.isFinite(since.getTime())
    || !Number.isFinite(until.getTime())
    || since.getTime() > until.getTime()
  ) return []

  // Google search date operators are day-granular and exclusive. Expand the
  // coarse provider request by one UTC day on both sides; the exact timestamp
  // gate at import remains authoritative.
  const after = new Date(since.getTime() - 86_400_000).toISOString().slice(0, 10)
  const before = new Date(until.getTime() + 86_400_000).toISOString().slice(0, 10)
  return [`after:${after}`, `before:${before}`]
}

type TikTokVideoSearchDateFilter =
  | "PAST_24_HOURS"
  | "PAST_WEEK"
  | "PAST_MONTH"
  | "LAST_3_MONTHS"
  | "LAST_6_MONTHS"
  | "ALL_TIME"

/**
 * The provider-side date filter is a recall floor, not the freshness boundary:
 * the exact lookback window is enforced locally and anything older is rejected
 * as `discovery_outside_lookback_window`. Deriving the filter straight from the
 * run window collapsed it to PAST_24_HOURS on normal cadence, and the actor
 * answers a day-empty brand with a hard "No videos found for the search query"
 * — surfaced to the operator as `apify_no_public_items` and read as a broken
 * search (prod, 2026-08-01: TikTok 0 findings across a full sweep).
 *
 * The floor stays deliberately tight, because widening it is not free.
 * clockworks/tiktok-scraper bills per returned result and the request asks for
 * `maxItems` rows sorted LATEST, so every extra day of provider window is a day
 * of backlog re-bought on each cadence and then discarded locally as
 * out-of-window or duplicate. A week buys back a quiet day or a weekend; a
 * quarter would buy a quarter of history on every run, for the same fresh-item
 * yield, against a daily provider budget shared with the other platforms.
 */
const TIKTOK_MIN_VIDEO_SEARCH_DATE_FILTER: TikTokVideoSearchDateFilter = "PAST_WEEK"

/**
 * Опциональная тройка параметров поиска TikTok (#657).
 *
 * По умолчанию НЕ отправляется: на проде она приводила к пустой выдаче на всех
 * брендах, тогда как прогоны без неё на тех же терминах возвращали по 100
 * записей. Оператор может вернуть её точечно — `settings.tiktokVideoSearch` —
 * чтобы проверить конкретную комбинацию, не выкатывая код.
 */
function tiktokVideoSearchOverrides(
  source: MonitoringSourceForRun,
  providerWindow: ArchiveProviderWindow | null | undefined,
): JsonRecord {
  const configured = record(record(source.settings).tiktokVideoSearch)
  const section = stringValue(configured.searchSection)
  const sorting = stringValue(configured.videoSearchSorting)
  const dateFilter = stringValue(configured.videoSearchDateFilter)
  return {
    ...(section ? { searchSection: section } : {}),
    ...(sorting ? { videoSearchSorting: sorting } : {}),
    // "auto" отдаёт прежнюю привязку фильтра к окну прогона; явное значение
    // из enum актора уходит как есть.
    ...(dateFilter
      ? {
          videoSearchDateFilter: dateFilter === "auto"
            ? tiktokVideoSearchDateFilter(providerWindow)
            : dateFilter,
        }
      : {}),
  }
}

function tiktokVideoSearchDateFilter(
  window: ArchiveProviderWindow | null | undefined,
): TikTokVideoSearchDateFilter {
  if (!window) return "ALL_TIME"
  const spanMs = Math.max(0, window.until.getTime() - window.since.getTime())
  if (spanMs <= 7 * 24 * 3_600_000) return TIKTOK_MIN_VIDEO_SEARCH_DATE_FILTER
  if (spanMs <= 30 * 24 * 3_600_000) return "PAST_MONTH"
  if (spanMs <= 90 * 24 * 3_600_000) return "LAST_3_MONTHS"
  if (spanMs <= 180 * 24 * 3_600_000) return "LAST_6_MONTHS"
  return "ALL_TIME"
}

export function apifyDiscoveryInput(
  source: MonitoringSourceForRun,
  maxItems: number,
  providerWindow?: ArchiveProviderWindow | null,
  actorId?: string | null,
): JsonRecord | null {
  const target = (source.query || source.handle || source.url || "").trim()
  if (source.platform === "web") {
    const terms = providerDiscoveryTerms(source)
    if (terms.length === 0) return null
    const exclusions = ownedWebSearchExclusionHosts(
      source.ownedIdentity ?? { authorNames: [], sourceIds: [], webHosts: [], profileUrls: [] },
    ).map(host => `-site:${host}`).join(" ")
    const dateOperators = webSearchDateOperators(providerWindow)
    return {
      queries: terms
        .slice(0, 20)
        .map(term => [
          `\"${term.replace(/\"/g, "")}\"`,
          ...dateOperators,
          exclusions,
        ].filter(Boolean).join(" "))
        .join("\n"),
      maxPagesPerQuery: Math.max(1, Math.min(10, Math.ceil(maxItems / 10))),
      resultsPerPage: 10,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
    }
  }
  if (
    actorId === APIFY_GOOGLE_SEARCH_ACTOR
    && ["facebook", "instagram"].includes(source.platform)
    && (
      source.platform === "facebook"
        ? isFacebookNativeDiscoverySource(source)
        : isInstagramKeywordDiscoverySource(source) || source.sourceType === "hashtag"
    )
  ) {
    const host = source.platform === "instagram" ? "instagram.com" : source.platform === "facebook" ? "facebook.com" : null
    // The run-level maxItems cap is shared by every query. Allocate an exact
    // per-query page budget so early terms cannot consume all paid results
    // before later terms run. If even one result per configured term cannot
    // fit, fail closed instead of permanently truncating the same tail terms
    // on every cadence.
    const configuredTerms = providerConfiguredTerms(source)
    if (
      !host
      || configuredTerms.length === 0
      || configuredTerms.length > 20
      || maxItems < configuredTerms.length
      || maxItems > configuredTerms.length * 100
    ) return null
    const terms = configuredTerms
    const exclusions = ownedSocialProfileSearchExclusions(source, host)
    const dateOperators = webSearchDateOperators(providerWindow)
    const perQueryItems = Math.max(1, Math.floor(maxItems / terms.length))
    const maxPagesPerQuery = Math.max(1, Math.min(10, Math.ceil(perQueryItems / 10)))
    const resultsPerPage = Math.max(1, Math.min(10, Math.floor(perQueryItems / maxPagesPerQuery)))
    return {
      queries: terms
        .map(term => [
          `\"${term.replace(/\"/g, "")}\"`,
          ...dateOperators,
          `site:${host}`,
          ...exclusions,
        ].join(" "))
        .join("\n"),
      maxPagesPerQuery,
      resultsPerPage,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
    }
  }
  if (source.platform === "facebook" && isFacebookNativeDiscoverySource(source)) {
    // The Actor's verified public input contract accepts one query. Pick it
    // deterministically (operator intent first); the remaining configured
    // terms still participate in import-time matching and are recorded on the
    // run snapshot as leadDriveUnsentProviderTerms.
    const primary = facebookPrimaryProviderTerm(source)
    if (!primary) return null
    return {
      query: primary,
      search_type: "posts",
      max_results: maxItems,
      recent_posts: true,
      ...(providerWindow
        ? {
            start_date: providerWindow.since.toISOString().slice(0, 10),
            end_date: providerWindow.until.toISOString().slice(0, 10),
          }
        : {}),
    }
  }
  if (source.platform === "instagram" && isInstagramKeywordDiscoverySource(source)) {
    const configuredTerms = providerConfiguredTerms(source)
    if (
      configuredTerms.length === 0
      || configuredTerms.length > 20
      || maxItems < configuredTerms.length
    ) return null
    const terms = instagramActorKeywordTerms(source, maxItems)
    if (terms.length === 0) return null
    return {
      hashtags: terms,
      // Actor contract: resultsLimit applies to every keyword independently.
      // Floor the shared run cap across terms so the dataset import limit
      // cannot starve tail keywords.
      resultsLimit: Math.max(1, Math.floor(maxItems / terms.length)),
      resultsType: instagramDiscoveryResultsType(source),
      keywordSearch: true,
    }
  }
  if (source.platform === "instagram") {
    if (source.sourceType === "hashtag") {
      if (!target) return null
      return {
        hashtags: [target.replace(/^#/, "")],
        resultsLimit: maxItems,
        resultsType: instagramDiscoveryResultsType(source),
        keywordSearch: false,
      }
    }
    if (!source.url && !target) return null
    const url = source.url || `https://www.instagram.com/${target.replace(/^@/, "")}/`
    return {
      directUrls: [url],
      resultsLimit: maxItems,
      resultsType: instagramDiscoveryResultsType(source),
      ...(providerWindow
        ? {
            onlyPostsNewerThan: providerWindow.since.toISOString(),
            skipPinnedPosts: true,
          }
        : {}),
    }
  }
  if (source.platform === "facebook") {
    if (!source.url) return null
    return { startUrls: [{ url: source.url }], resultsLimit: maxItems }
  }
  if (source.platform === "tiktok") {
    if (source.url) return { postURLs: [source.url], maxItems, resultsPerPage: maxItems }
    if (source.sourceType === "hashtag") {
      if (!target) return null
      return { hashtags: [target.replace(/^#/, "")], maxItems, resultsPerPage: maxItems }
    }
    if (["profile", "page", "competitor", "influencer"].includes(source.sourceType)) {
      if (!target) return null
      return {
        profiles: [target.replace(/^@/, "")],
        maxItems,
        resultsPerPage: maxItems,
        ...(providerWindow
          ? {
              profileSorting: "latest",
              excludePinnedPosts: true,
              oldestPostDateUnified: providerWindow.since.toISOString(),
            }
          : {}),
      }
    }
    // TikTok displays the operator's query verbatim. Put it before legacy
    // keyword aliases so case/punctuation are not replaced by a normalized
    // duplicate, while still preserving packed legacy searches.
    const sourceQueryTerms = source.query?.includes("|")
      ? source.query.split("|")
      : [source.query ?? ""]
    const searchQueries = record(source.settings).canonicalBrandQuery === true
      ? providerFanOutTerms(source, maxItems)
      : uniqueNormalizedTerms([
          ...sourceQueryTerms,
          ...providerConfiguredTerms(source),
        ]).slice(0, TIKTOK_SEARCH_QUERY_LIMIT)
    if (searchQueries.length === 0) return null
    return {
      searchQueries,
      maxItems,
      // resultsPerPage — потолок актора на ОДИН запрос. Без деления первый
      // популярный термин выкупает весь maxItems, и хвостовые термины не
      // ищутся вовсе — зеркально аллокации Instagram (#638).
      resultsPerPage: Math.max(1, Math.floor(maxItems / searchQueries.length)),
      // Тройка «/video + LATEST + датовый фильтр» выглядит разумно, но на
      // проде она отдаёт пусто: с 29 июля КАЖДЫЙ прогон с ней возвращал одну
      // строку «No videos found for the search query», а прогоны без неё в тот
      // же день — по 100 записей на тех же терминах (#657). Пока причина на
      // стороне актора не разобрана, ведущим остаётся наблюдение: настройки по
      // умолчанию (вкладка Top, relevance, все даты) — единственная
      // конфигурация, которая реально что-то находит. Окно свежести это не
      // ослабляет: точная граница всё равно применяется локально, лишнее
      // отбраковывается как discovery_outside_lookback_window.
      ...tiktokVideoSearchOverrides(source, providerWindow),
    }
  }
  return null
}

function commentsInput(source: MonitoringSourceForRun, candidates: { urls: string[]; approvedParents: Array<Record<string, unknown>> }, maxItems: number): JsonRecord | null {
  const urls = candidates.urls
  if (urls.length === 0) return null
  if (source.platform === "instagram") return { directUrls: urls, resultsLimit: maxItems, includeNestedComments: true }
  // apify/facebook-comments-scraper does not accept the generic
  // maxComments/maxReplies fields. Keep this payload aligned with the pinned
  // actor's public input contract so the cap and reply collection are actually
  // applied instead of being silently ignored by the provider.
  if (source.platform === "facebook") return {
    startUrls: urls.map(url => ({ url })),
    resultsLimit: maxItems,
    includeNestedComments: true,
    viewOption: "RECENT_ACTIVITY",
  }
  if (source.platform === "tiktok") return { postURLs: urls, commentsPerPost: maxItems, maxRepliesPerComment: maxItems, maxItems, leadDriveApprovedParents: candidates.approvedParents, liveReplies: false }
  return null
}

function commentParentUrlsFromSnapshot(platform: string, value: unknown): string[] {
  const snapshot = record(value)
  const direct = platform === "instagram"
    ? stringList(snapshot.directUrls)
    : platform === "tiktok"
      ? stringList(snapshot.postURLs)
      : platform === "facebook" && Array.isArray(snapshot.startUrls)
        ? snapshot.startUrls.map(item => stringValue(record(item).url)).filter((url): url is string => Boolean(url))
        : []
  return Array.from(new Set(direct.map(canonicalProviderUrl)))
}

async function candidateUrls(
  source: MonitoringSourceForRun,
  maxItems: number,
  options: { prepareCheckpoints?: boolean; now?: Date } = {},
): Promise<{ urls: string[]; parentRunId: string | null; approvedParents: Array<Record<string, unknown>> }> {
  const clientFundedManual = source.routeExecution?.clientFundedManual === true
  const resultLimit = clientFundedManual
    ? Math.max(1, Math.trunc(maxItems))
    : Math.min(maxItems, 50)
  const now = options.now ?? new Date()
  // The dependency gate asks for a single usable target. Scan a small bounded
  // surplus before URL/content filtering so one newer profile URL or comment
  // evidence row cannot hide the valid post immediately behind it.
  const scanLimit = clientFundedManual
    ? Math.min(100_000, Math.max(10, resultLimit * 5))
    : Math.min(50, Math.max(10, resultLimit * 5))
  const candidateWindowStart = new Date(now.getTime() - 48 * 3_600_000)
  const parentRun = await prisma.socialProviderRun.findFirst({
    where: {
      organizationId: source.organizationId,
      sourceId: source.id,
      phase: "DISCOVER_CANDIDATE_POSTS",
      purgedAt: null,
      status: { in: ["IMPORTED", "PARTIAL"] },
      createdAt: { gte: candidateWindowStart },
    },
    orderBy: { importedAt: "desc" },
    select: {
      id: true,
      parentRunId: true,
      actorId: true,
      inputSnapshot: true,
      createdAt: true,
    },
  })
  const parentSnapshot = record(parentRun?.inputSnapshot)
  const pairedInstagramRootRunId = source.platform === "instagram"
    && parentRun?.actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR
    && stringValue(parentSnapshot.leadDriveInstagramResultsType) === "reels"
    ? parentRun.parentRunId
    : null
  const commentParentRunId = pairedInstagramRootRunId ?? parentRun?.id ?? null
  if (source.platform === "tiktok") {
    const reconciliation = await reconcileTikTokPublicationRevisitsForSource({
      organizationId: source.organizationId,
      sourceId: source.id,
      sourceSettings: source.settings,
      targetSubjectId: source.routeExecution?.targetSubjectId,
      now,
      limit: resultLimit,
    })
    if (reconciliation.subjectIds.length === 0) {
      return { urls: [], parentRunId: commentParentRunId, approvedParents: [] }
    }
    const revisits: Array<{
      canonicalUrl: string
      postExternalId: string
      ingestEnvelope: { subjectDecision: unknown }
    }> = await prisma.tikTokPublicationRevisit.findMany({
      where: {
        organizationId: source.organizationId,
        status: source.routeExecution?.manualPaidRun === true ? { in: ["ACTIVE", "INACTIVE"] } : "ACTIVE",
        ...(source.routeExecution?.manualPaidRun === true ? {} : { nextDueAt: { lte: now } }),
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
      orderBy: [{ nextDueAt: "asc" }, { approvedAt: "desc" }],
      take: resultLimit,
      select: {
        canonicalUrl: true,
        postExternalId: true,
        ingestEnvelope: { select: { subjectDecision: true } },
      },
    })
    return {
      urls: revisits.map(parent => parent.canonicalUrl),
      parentRunId: commentParentRunId,
      approvedParents: revisits.map(parent => {
        const decision = record(parent.ingestEnvelope.subjectDecision)
        return {
          canonicalVideoUrl: parent.canonicalUrl,
          videoId: parent.postExternalId,
          decision: stringValue(decision.status) ?? "MATCHED",
          reasonCode: stringValue(decision.reasonCode),
          scenarioIds: stringList(decision.scenarioIds),
          policySnapshot: record(decision.policySnapshot),
        }
      }),
    }
  }
  const envelopeProviderRunIds = parentRun
    ? Array.from(new Set([
        parentRun.id,
        ...(pairedInstagramRootRunId
          ? [pairedInstagramRootRunId]
          : []),
      ]))
    : []
  const rawEnvelopes: Array<{
    providerRunId?: string | null
    canonicalUrl: string | null
    url: string | null
  }> = parentRun ? await prisma.ingestEnvelope.findMany({
    where: {
      organizationId: source.organizationId,
      sourceId: source.id,
      providerRunId: envelopeProviderRunIds.length === 1
        ? envelopeProviderRunIds[0]
        : { in: envelopeProviderRunIds },
      relevanceStatus: "ACCEPTED",
      acceptedMentionId: { not: null },
      OR: [{ canonicalUrl: { not: null } }, { url: { not: null } }],
    },
    orderBy: { createdAt: "desc" },
    // A pair contains at most the posts and reels members, each bounded by its
    // half of the discovery cap. Fetch both bounded sets before interleaving so
    // the newer reels child cannot push every posts URL out of comment review.
    take: Math.min(200_000, scanLimit * Math.max(1, envelopeProviderRunIds.length)),
    select: { providerRunId: true, canonicalUrl: true, url: true },
  }) : []
  const envelopes = envelopeProviderRunIds.length <= 1
    ? rawEnvelopes
    : (() => {
        const queues = new Map(envelopeProviderRunIds.map(providerRunId => [
          providerRunId,
          [] as typeof rawEnvelopes,
        ]))
        for (const envelope of rawEnvelopes) {
          const providerRunId = stringValue(envelope.providerRunId)
          const queue = providerRunId ? queues.get(providerRunId) : undefined
          const targetQueue = queue ?? queues.get(envelopeProviderRunIds[0])
          targetQueue?.push(envelope)
        }
        const interleaved: typeof rawEnvelopes = []
        for (let index = 0; interleaved.length < rawEnvelopes.length; index += 1) {
          let appended = false
          for (const providerRunId of envelopeProviderRunIds) {
            const envelope = queues.get(providerRunId)?.[index]
            if (!envelope) continue
            interleaved.push(envelope)
            appended = true
          }
          if (!appended) break
        }
        return interleaved
      })()
  const envelopeUrls = envelopes
    .map(item => item.canonicalUrl || item.url)
    .filter((value: string | null): value is string => Boolean(value && isPlatformCandidateUrl(source.platform, value)))
  // Transit envelopes are intentionally purged quickly. Accepted mention
  // evidence remains the normalized discovery record, so a delayed comments
  // phase — or one whose discovery ran through an official adapter and thus
  // has no Apify parent run — can still continue without extending
  // raw-provider retention. Only fresh evidence with a platform post URL
  // qualifies, even if an older provider parent exists, so cron re-dispatches
  // cannot revive stale posts (the freshness-bucketed idempotency key dedupes
  // repeats anyway).
  const evidence = envelopeUrls.length >= resultLimit ? [] : await prisma.mentionEvidence.findMany({
    where: {
      organizationId: source.organizationId,
      sourceId: source.id,
      permalink: { not: null },
      capturedAt: { gte: candidateWindowStart },
    },
    orderBy: { capturedAt: "desc" },
    take: scanLimit,
    select: {
      permalink: true,
      mention: { select: { canonicalUrl: true, url: true, parentPostUrl: true, contentKind: true } },
    },
  })
  const evidenceUrls = evidence.flatMap((item: {
    permalink: string | null
    mention: { canonicalUrl: string | null; url: string | null; parentPostUrl: string | null; contentKind: string }
  }) => {
    if (["COMMENT", "REPLY"].includes(item.mention.contentKind)) return []
    const url = item.mention.canonicalUrl || item.mention.url || item.mention.parentPostUrl || item.permalink
    if (!url) return []
    if (!isPlatformCandidateUrl(source.platform, url)) return []
    return [url]
  })
  // Bright Data and official adapters persist accepted posts directly as
  // normalized mentions. Their short-lived ingest envelopes may already be
  // purged (or may not carry an acceptedMentionId), and not every adapter
  // creates a mentionEvidence row. Keep the dependent comments route moving
  // by reading the same fresh, source-scoped normalized posts the UI uses.
  // The JSON source id plus platform/post guards prevent unrelated monitor
  // terms from becoming comment targets.
  // A discovery rerun may only refresh provider envelopes without touching an
  // already-normalized duplicate mention. Keep a bounded 48-hour window so
  // those still-relevant, source-scoped post URLs remain eligible.
  const mentionCandidates = [...envelopeUrls, ...evidenceUrls].length >= resultLimit ? [] : await prisma.socialMention.findMany({
    where: {
      organizationId: source.organizationId,
      platform: source.platform,
      contentKind: { notIn: ["COMMENT", "REPLY"] },
      updatedAt: { gte: candidateWindowStart },
      sourceMetadata: { path: ["monitoringSourceId"], equals: source.id },
      OR: [
        { canonicalUrl: { not: null } },
        { url: { not: null } },
        { parentPostUrl: { not: null } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: scanLimit,
    select: { canonicalUrl: true, url: true, parentPostUrl: true },
  })
  const mentionUrls = mentionCandidates.flatMap((item: {
    canonicalUrl: string | null
    url: string | null
    parentPostUrl: string | null
  }) => {
    const url = item.canonicalUrl || item.url || item.parentPostUrl
    return url && isPlatformCandidateUrl(source.platform, url) ? [url] : []
  })
  const freshUrls = Array.from(new Set([...envelopeUrls, ...evidenceUrls, ...mentionUrls]))
  const selectedUrls = options.prepareCheckpoints && ["instagram", "facebook"].includes(source.platform)
    ? (await registerAndSelectDueCommentCheckpoints({
        organizationId: source.organizationId,
        sourceId: source.id,
        platform: source.platform,
        candidateUrls: freshUrls,
        now,
        limit: resultLimit,
        includeInactive: source.routeExecution?.manualPaidRun === true,
      })).map(item => item.canonicalUrl)
    : freshUrls.slice(0, resultLimit)
  return {
    urls: selectedUrls,
    parentRunId: commentParentRunId,
    approvedParents: [],
  }
}

export async function hasApifyCommentCandidates(source: MonitoringSourceForRun): Promise<boolean> {
  if (!["instagram", "facebook"].includes(source.platform)) return false
  const candidates = await candidateUrls(source, 1)
  return candidates.urls.length > 0
}

async function queueDependentCommentRun(run: {
  organizationId: string
  sourceId: string
  collectorRunId: string | null
  phase: string
  inputSnapshot?: unknown
  source: MonitoringSourceForRun
}): Promise<"complete" | "retry"> {
  if (run.phase !== "DISCOVER_CANDIDATE_POSTS") return "complete"
  const snapshot = record(run.inputSnapshot)
  if (snapshot.leadDriveSuppressDependentPaidRuns === true) return "complete"
  const manualPaidRun = snapshot.leadDriveManualPaidRun === true
  const frozenCommentsAllocation = manualPaidRun
    ? frozenManualCommentAllocation(snapshot)
    : null
  const dependentCommentsMaxTotalChargeUsd = frozenCommentsAllocation?.commentsUsd ?? null
  const clientFundedManual = manualPaidRun
    && snapshot.leadDriveClientFundedManual === true
  if (manualPaidRun && !frozenCommentsAllocation) return "complete"
  const eligibleSourceStatuses = snapshot.leadDriveManualSourceRun === true
    ? ["active", "limited", "needs_setup", "paused"]
    : ["active", "limited", "needs_setup"]
  // Hold the same short source lease used by collection while selecting the
  // dependent plan and dispatching its paid Actor. Scenario repair excludes
  // actively claimed rows, so it cannot invalidate the route between this
  // state check and the provider POST.
  const claimToken = crypto.randomUUID()
  const now = new Date()
  const claimed = await prisma.monitoringSource.updateMany({
    where: {
      organizationId: run.organizationId,
      id: run.sourceId,
      status: { in: eligibleSourceStatuses },
      OR: [
        { runClaimToken: null },
        { runClaimExpiresAt: null },
        { runClaimExpiresAt: { lte: now } },
      ],
    },
    data: {
      runClaimToken: claimToken,
      runClaimExpiresAt: new Date(now.getTime() + DEPENDENT_COMMENT_DISPATCH_LEASE_MS),
      runClaimVersion: { increment: 1 },
    },
  })
  if (claimed.count !== 1) {
    // A concurrent collector already protects the source from migration, but
    // it does not own this dependent phase. Persist a retry unless the source
    // has since become ineligible.
    const stillEligible = await prisma.monitoringSource.findFirst({
      where: {
        organizationId: run.organizationId,
        id: run.sourceId,
        status: { in: eligibleSourceStatuses },
      },
      select: { id: true },
    })
    return stillEligible ? "retry" : "complete"
  }
  try {
    const enabledSource = await prisma.monitoringSource.findFirst({
      where: {
        organizationId: run.organizationId,
        id: run.sourceId,
        runClaimToken: claimToken,
        status: { in: eligibleSourceStatuses },
      },
      select: { id: true },
    })
    if (!enabledSource) return "complete"
    const targetScenarioId = stringValue(snapshot.leadDriveTargetScenarioId) || null
    const targetSubjectId = stringValue(snapshot.leadDriveTargetSubjectId) || null
    const plans = await prisma.sourceRoutePlan.findMany({
      where: {
        organizationId: run.organizationId,
        sourceId: run.sourceId,
        ...(targetScenarioId ? { scenarioId: targetScenarioId } : {}),
        capability: "READ_EXTERNAL_COMMENTS",
        dependsOnCapability: "DISCOVER_POSTS",
        primaryAdapter: "APIFY_ASYNC",
        status: { in: ["ACTIVE", "DEGRADED"] },
      },
      orderBy: [{ executionOrder: "asc" }, { compiledAt: "desc" }],
      select: { id: true, capability: true, acquisitionMode: true },
    })
    const plan = plans[0]
    if (!plan) return "complete"
    const manualMaxTotalChargeUsd = manualPaidRun
      ? dependentCommentsMaxTotalChargeUsd ?? undefined
      : undefined
    const frozenCursorScope = providerCursorScopeFromSnapshot(run.inputSnapshot, {
      routePlanId: plan.id,
      adapterKey: "APIFY_ASYNC",
    })
    const frozenArchiveStartAt = frozenCursorScope.archiveStartAt instanceof Date
      ? frozenCursorScope.archiveStartAt.toISOString()
      : frozenCursorScope.archiveStartAt

    // Scenario aliases can produce multiple logical plans for one physical
    // source. Starting only the newest matching plan is sufficient: Apify's
    // freshness-bucketed idempotency key protects webhook retries as well.
    const childResult = await runApifyAsyncCollector({
      ...run.source,
      routeExecution: {
        collectorRunId: run.collectorRunId ?? "provider-reconcile",
        routePlanId: plan.id,
        capability: plan.capability,
        adapterKey: "APIFY_ASYNC",
        acquisitionMode: plan.acquisitionMode,
        providerKey: APIFY_PROVIDER,
        manualSourceRun: snapshot.leadDriveManualSourceRun === true,
        manualPaidRun,
        manualMaxTotalChargeUsd,
        clientFundedManual,
        fullArchiveRun: frozenCursorScope.fullArchiveRun === true,
        ...(targetScenarioId ? { targetScenarioId } : {}),
        ...(targetSubjectId ? { targetSubjectId } : {}),
        ...(frozenArchiveStartAt !== undefined
          ? { archiveStartAt: frozenArchiveStartAt }
          : {}),
      },
    })
    const childStats = record(childResult.rawStats)
    return Boolean(stringValue(childStats.providerRunId))
      || childResult.error === "apify_candidate_posts_missing"
      ? "complete"
      : "retry"
  } finally {
    await prisma.monitoringSource.updateMany({
      where: {
        organizationId: run.organizationId,
        id: run.sourceId,
        runClaimToken: claimToken,
      },
      data: {
        runClaimToken: null,
        runClaimExpiresAt: null,
      },
    }).catch(error => {
      console.error("[social-monitoring] dependent comment source lease release failed", error)
    })
  }
}

async function queueDependentInstagramReelsRun(run: {
  id: string
  organizationId: string
  sourceId: string
  collectorRunId: string | null
  routePlanId: string
  phase: string
  inputSnapshot?: unknown
  source: MonitoringSourceForRun
}): Promise<"complete" | "retry"> {
  if (run.phase !== "DISCOVER_CANDIDATE_POSTS") return "complete"
  const snapshot = record(run.inputSnapshot)
  if (snapshot[DEPENDENT_INSTAGRAM_REELS_PENDING_MARKER] !== true) return "complete"
  if (
    run.source.platform !== "instagram"
    || stringValue(snapshot.leadDriveInstagramResultsType) !== "posts"
  ) return "complete"

  const existingChild = await prisma.socialProviderRun.findFirst({
    where: {
      organizationId: run.organizationId,
      sourceId: run.sourceId,
      parentRunId: run.id,
      phase: "DISCOVER_CANDIDATE_POSTS",
      actorId: APIFY_INSTAGRAM_HASHTAG_ACTOR,
      purgedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  })
  if (
    existingChild
    && ["IMPORTED", "PARTIAL", "FAILED", "BLOCKED"].includes(existingChild.status)
  ) {
    // Both members have terminalized. Dispatch comments from the root so the
    // successfully imported posts remain actionable even when the reels
    // member failed. Candidate selection is source-scoped and checkpointed,
    // and manual comment extraction is idempotent per collector run, so a
    // successful child racing this recovery path still produces one comments
    // Actor.
    return queueDependentCommentRun(run)
  }
  if (existingChild) return "retry"

  const reelsBudget = record(snapshot.leadDriveInstagramReelsBudget)
  const maxItems = numberValue(reelsBudget.maxItems)
  const maxTotalChargeUsd = numberValue(reelsBudget.maxTotalChargeUsd)
  const rootProviderWindow = providerWindowFromSnapshot(snapshot)
  if (
    maxItems === null
    || maxItems < 1
    || maxTotalChargeUsd === null
    || maxTotalChargeUsd <= 0
    || !rootProviderWindow
  ) return "retry"

  const eligibleSourceStatuses = snapshot.leadDriveManualSourceRun === true
    ? ["active", "limited", "needs_setup", "paused"]
    : ["active", "limited", "needs_setup"]
  const claimToken = crypto.randomUUID()
  const now = new Date()
  const claimed = await prisma.monitoringSource.updateMany({
    where: {
      organizationId: run.organizationId,
      id: run.sourceId,
      status: { in: eligibleSourceStatuses },
      OR: [
        { runClaimToken: null },
        { runClaimExpiresAt: null },
        { runClaimExpiresAt: { lte: now } },
      ],
    },
    data: {
      runClaimToken: claimToken,
      runClaimExpiresAt: new Date(now.getTime() + DEPENDENT_COMMENT_DISPATCH_LEASE_MS),
      runClaimVersion: { increment: 1 },
    },
  })
  if (claimed.count !== 1) {
    const stillEligible = await prisma.monitoringSource.findFirst({
      where: {
        organizationId: run.organizationId,
        id: run.sourceId,
        status: { in: eligibleSourceStatuses },
      },
      select: { id: true },
    })
    return stillEligible ? "retry" : "complete"
  }

  try {
    const enabledSource = await prisma.monitoringSource.findFirst({
      where: {
        organizationId: run.organizationId,
        id: run.sourceId,
        runClaimToken: claimToken,
        status: { in: eligibleSourceStatuses },
      },
      select: { id: true },
    })
    if (!enabledSource) return "complete"
    const plan = await prisma.sourceRoutePlan.findFirst({
      where: {
        id: run.routePlanId,
        organizationId: run.organizationId,
        sourceId: run.sourceId,
        capability: "DISCOVER_POSTS",
        primaryAdapter: "APIFY_ASYNC",
        status: { in: ["ACTIVE", "DEGRADED"] },
      },
      select: {
        id: true,
        capability: true,
        acquisitionMode: true,
      },
    })
    if (!plan) return "complete"

    const targetScenarioId = stringValue(snapshot.leadDriveTargetScenarioId) || null
    const targetSubjectId = stringValue(snapshot.leadDriveTargetSubjectId) || null
    const manualPaidRun = snapshot.leadDriveManualPaidRun === true
    const clientFundedManual = manualPaidRun
      && snapshot.leadDriveClientFundedManual === true
    const frozenCursorScope = providerCursorScopeFromSnapshot(snapshot, {
      routePlanId: plan.id,
      adapterKey: "APIFY_ASYNC:posts",
    })
    const frozenArchiveStartAt = frozenCursorScope.archiveStartAt instanceof Date
      ? frozenCursorScope.archiveStartAt.toISOString()
      : frozenCursorScope.archiveStartAt
    const baseChildSource: MonitoringSourceForRun = {
      ...run.source,
      routeExecution: {
        collectorRunId: run.collectorRunId ?? "provider-reconcile",
        routePlanId: plan.id,
        capability: plan.capability,
        adapterKey: "APIFY_ASYNC",
        acquisitionMode: plan.acquisitionMode,
        providerKey: APIFY_PROVIDER,
        manualSourceRun: snapshot.leadDriveManualSourceRun === true,
        ...(manualPaidRun
          ? {
              manualPaidRun: true,
              manualMaxTotalChargeUsd: maxTotalChargeUsd,
              clientFundedManual,
            }
          : {}),
        fullArchiveRun: frozenCursorScope.fullArchiveRun === true,
        instagramResultsType: "reels",
        suppressFreshDiscoveryReuse: true,
        dependentProviderRun: true,
        parentProviderRunId: run.id,
        maxItems,
        suppressDependentPaidRuns: snapshot.leadDriveSuppressDependentPaidRuns === true,
        ...(snapshot.leadDriveDependentCommentsAuthorized === true
          && (numberValue(snapshot.leadDriveDependentCommentsMaxTotalChargeUsd) ?? 0) > 0
          ? {
              dependentCommentsAuthorized: true,
              dependentCommentsMaxTotalChargeUsd:
                numberValue(snapshot.leadDriveDependentCommentsMaxTotalChargeUsd) ?? undefined,
              sourceAuthorizedMaxTotalChargeUsd:
                numberValue(snapshot.leadDriveSourceAuthorizedMaxTotalChargeUsd) ?? undefined,
              discoveryMaxTotalChargeUsd:
                numberValue(snapshot.leadDriveDiscoveryMaxTotalChargeUsd) ?? undefined,
            }
          : {}),
        providerRunMaxItemsOverride: maxItems,
        providerRunMaxTotalChargeUsdOverride: maxTotalChargeUsd,
        ...(targetScenarioId ? { targetScenarioId } : {}),
        ...(targetSubjectId ? { targetSubjectId } : {}),
        ...(frozenArchiveStartAt !== undefined
          ? { archiveStartAt: frozenArchiveStartAt }
          : {}),
      },
    }
    // The posts and reels members have independent watermarks. Freeze the
    // child at the root's `until`, but resolve its lower bound from the reels
    // cursor so a failed earlier child is covered by the next root pair.
    const reelsCursorWindow = discoveryLookbackWindow(baseChildSource, rootProviderWindow.until)
    const reelsProviderWindow = discoveryProviderWindow(baseChildSource, reelsCursorWindow)
    const childResult = await runApifyAsyncCollector({
      ...baseChildSource,
      routeExecution: {
        ...baseChildSource.routeExecution!,
        providerWindowOverride: {
          cursorSince: reelsCursorWindow.since.toISOString(),
          since: reelsProviderWindow.since.toISOString(),
          until: reelsProviderWindow.until.toISOString(),
          resumedFromWatermark: reelsProviderWindow.resumedFromWatermark,
          clamped: reelsProviderWindow.clamped,
          overlapMinutes: reelsProviderWindow.resumedFromWatermark
            ? ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES
            : 0,
        },
      },
    })
    const childStats = record(childResult.rawStats)
    const childProviderStatus = stringValue(childStats.providerStatus)
    if (childProviderStatus === "IMPORTED") return "complete"
    if (["PARTIAL", "FAILED", "BLOCKED", "PURGED"].includes(childProviderStatus ?? "")) {
      // Incomplete terminal members keep their own reels watermark unchanged.
      // The next root cadence therefore rebuilds the child from that older
      // lower bound without letting this root monopolize reconciliation.
      return "complete"
    }
    return "retry"
  } finally {
    await prisma.monitoringSource.updateMany({
      where: {
        organizationId: run.organizationId,
        id: run.sourceId,
        runClaimToken: claimToken,
      },
      data: {
        runClaimToken: null,
        runClaimExpiresAt: null,
      },
    }).catch(error => {
      console.error("[social-monitoring] dependent reels source lease release failed", error)
    })
  }
}

/**
 * Алиасные слоты веера Facebook (#638). Родной актор принимает один запрос,
 * поэтому каждый алиас — отдельный дочерний прогон со своим бюджетом (доля
 * родительского, посчитана при создании родителя) и своим курсором. Диспатч
 * идемпотентен по термину: повторный проход видит уже созданного ребёнка по
 * parentRunId и его маркеру термина.
 */
async function queueDependentFacebookFanOutRuns(run: {
  id: string
  organizationId: string
  sourceId: string
  collectorRunId: string | null
  routePlanId: string
  phase: string
  inputSnapshot?: unknown
  source: MonitoringSourceForRun
}): Promise<"complete" | "retry"> {
  if (run.phase !== "DISCOVER_CANDIDATE_POSTS") return "complete"
  const snapshot = record(run.inputSnapshot)
  if (snapshot[DEPENDENT_FACEBOOK_FAN_OUT_PENDING_MARKER] !== true) return "complete"
  if (run.source.platform !== "facebook") return "complete"

  const plannedTerms = stringList(snapshot.leadDriveFacebookFanOutTerms)
  const fanOutBudget = record(snapshot.leadDriveFacebookFanOutBudget)
  const maxItems = numberValue(fanOutBudget.maxItems)
  const maxTotalChargeUsd = numberValue(fanOutBudget.maxTotalChargeUsd)
  const rootProviderWindow = providerWindowFromSnapshot(snapshot)
  if (
    plannedTerms.length === 0
    || maxItems === null
    || maxItems < 1
    || maxTotalChargeUsd === null
    || maxTotalChargeUsd <= 0
    || !rootProviderWindow
  ) return "complete"

  const existingChildren = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: run.organizationId,
      sourceId: run.sourceId,
      parentRunId: run.id,
      phase: "DISCOVER_CANDIDATE_POSTS",
      actorId: APIFY_FACEBOOK_SEARCH_ACTOR,
      purgedAt: null,
    },
    select: { id: true, status: true, inputSnapshot: true },
  })
  const dispatchedIdentities = new Set(existingChildren
    .map((child: { inputSnapshot: unknown }) =>
      stringValue(record(child.inputSnapshot).leadDriveFacebookFanOutTerm))
    .filter((term: string | null): term is string => Boolean(term))
    .map(normalizedTermIdentity))
  const pendingTerms = plannedTerms
    .filter(term => !dispatchedIdentities.has(normalizedTermIdentity(term)))
  if (pendingTerms.length === 0) {
    // Все дети созданы. Незавершённые дочерние прогоны дожидает реконсиляция
    // по их собственным дедлайнам, а не этот проход.
    return "complete"
  }

  const eligibleSourceStatuses = snapshot.leadDriveManualSourceRun === true
    ? ["active", "limited", "needs_setup", "paused"]
    : ["active", "limited", "needs_setup"]
  const claimToken = crypto.randomUUID()
  const now = new Date()
  const claimed = await prisma.monitoringSource.updateMany({
    where: {
      organizationId: run.organizationId,
      id: run.sourceId,
      status: { in: eligibleSourceStatuses },
      OR: [
        { runClaimToken: null },
        { runClaimExpiresAt: null },
        { runClaimExpiresAt: { lte: now } },
      ],
    },
    data: {
      runClaimToken: claimToken,
      runClaimExpiresAt: new Date(now.getTime() + DEPENDENT_COMMENT_DISPATCH_LEASE_MS),
      runClaimVersion: { increment: 1 },
    },
  })
  if (claimed.count !== 1) {
    const stillEligible = await prisma.monitoringSource.findFirst({
      where: {
        organizationId: run.organizationId,
        id: run.sourceId,
        status: { in: eligibleSourceStatuses },
      },
      select: { id: true },
    })
    return stillEligible ? "retry" : "complete"
  }

  try {
    const plan = await prisma.sourceRoutePlan.findFirst({
      where: {
        id: run.routePlanId,
        organizationId: run.organizationId,
        sourceId: run.sourceId,
        capability: "DISCOVER_POSTS",
        primaryAdapter: "APIFY_ASYNC",
        status: { in: ["ACTIVE", "DEGRADED"] },
      },
      select: { id: true, capability: true, acquisitionMode: true },
    })
    // Маршрут мог уйти в BLOCKED между стартом родителя и его импортом.
    // Это не повод объявить слоты покрытыми: держим маркер, пока прогон
    // родителя жив (его purgeAt ограничивает полосу сутками).
    if (!plan) return "retry"

    const targetScenarioId = stringValue(snapshot.leadDriveTargetScenarioId) || null
    const targetSubjectId = stringValue(snapshot.leadDriveTargetSubjectId) || null
    const manualPaidRun = snapshot.leadDriveManualPaidRun === true
    const clientFundedManual = manualPaidRun && snapshot.leadDriveClientFundedManual === true
    const frozenCursorScope = providerCursorScopeFromSnapshot(snapshot, {
      routePlanId: plan.id,
      adapterKey: "APIFY_ASYNC",
    })
    const frozenArchiveStartAt = frozenCursorScope.archiveStartAt instanceof Date
      ? frozenCursorScope.archiveStartAt.toISOString()
      : frozenCursorScope.archiveStartAt

    // Один слот за проход. Лиза источника живёт 5 минут, а каждый дочерний
    // прогон — это POST к провайдеру со своим таймаутом: цикл по трём
    // терминам успел бы её пережить и диспатчил бы хвост без защиты. Пока
    // остаются неотправленные слоты, маркер держится и полоса реконсиляции
    // возвращается за следующим.
    const term = pendingTerms[0]
    const childSource: MonitoringSourceForRun = {
      ...run.source,
      routeExecution: {
        collectorRunId: run.collectorRunId ?? "provider-reconcile",
        routePlanId: plan.id,
        capability: plan.capability,
        adapterKey: "APIFY_ASYNC",
        acquisitionMode: plan.acquisitionMode,
        providerKey: APIFY_PROVIDER,
        manualSourceRun: snapshot.leadDriveManualSourceRun === true,
        ...(manualPaidRun
          ? {
              manualPaidRun: true,
              manualMaxTotalChargeUsd: maxTotalChargeUsd,
              clientFundedManual,
            }
          : {}),
        fullArchiveRun: frozenCursorScope.fullArchiveRun === true,
        suppressFreshDiscoveryReuse: true,
        dependentProviderRun: true,
        parentProviderRunId: run.id,
        providerSearchTermOverride: term,
        maxItems,
        // Комментарии остаются работой родителя: их стоимость считается от
        // найденных им публикаций, и дублировать её на каждый алиасный слот
        // значило бы тратить бюджет источника кратно числу слотов.
        suppressDependentPaidRuns: true,
        providerRunMaxItemsOverride: maxItems,
        providerRunMaxTotalChargeUsdOverride: maxTotalChargeUsd,
        ...(targetScenarioId ? { targetScenarioId } : {}),
        ...(targetSubjectId ? { targetSubjectId } : {}),
        ...(frozenArchiveStartAt !== undefined
          ? { archiveStartAt: frozenArchiveStartAt }
          : {}),
      },
    }
    // Термин несёт только родной поиск площадки. Если тенант переставил актора
    // Facebook на Google/URL-инпут, билдер молча проигнорирует override и
    // ребёнок купил бы копию родительского запроса.
    const childActors = (await getSocialMonitoringSettings(run.organizationId))
      .searchIndex.apifyActors
    if (apifyActorForSource(childSource, "DISCOVER_POSTS", childActors) !== APIFY_FACEBOOK_SEARCH_ACTOR) {
      return "complete"
    }
    // У каждого термина свой курсор, поэтому нижняя граница берётся из его
    // собственной отметки, а верхняя морозится на окне родителя — иначе
    // слоты расползлись бы по разным «сейчас».
    const termCursorWindow = discoveryLookbackWindow(childSource, rootProviderWindow.until)
    const termProviderWindow = discoveryProviderWindow(childSource, termCursorWindow)
    const childResult = await runApifyAsyncCollector({
      ...childSource,
      routeExecution: {
        ...childSource.routeExecution!,
        providerWindowOverride: {
          cursorSince: termCursorWindow.since.toISOString(),
          since: termProviderWindow.since.toISOString(),
          until: termProviderWindow.until.toISOString(),
          resumedFromWatermark: termProviderWindow.resumedFromWatermark,
          clamped: termProviderWindow.clamped,
          overlapMinutes: termProviderWindow.resumedFromWatermark
            ? ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES
            : 0,
        },
      },
    })
    // Прогон создан — его судьбу дальше ведёт реконсиляция. Держим маркер,
    // пока строка провайдера не появилась (иначе слот потеряется) или пока
    // остаются неотправленные термины.
    const childDispatched = Boolean(stringValue(record(childResult.rawStats).providerRunId))
    return childDispatched && pendingTerms.length === 1 ? "complete" : "retry"
  } finally {
    await prisma.monitoringSource.updateMany({
      where: {
        organizationId: run.organizationId,
        id: run.sourceId,
        runClaimToken: claimToken,
      },
      data: {
        runClaimToken: null,
        runClaimExpiresAt: null,
      },
    }).catch((error: unknown) => {
      console.error("[social-monitoring] dependent Facebook fan-out source lease release failed", error)
    })
  }
}

async function dispatchDependentApifyRuns(run: {
  id: string
  organizationId: string
  sourceId: string
  collectorRunId: string | null
  routePlanId: string
  phase: string
  inputSnapshot?: unknown
  source: MonitoringSourceForRun
}, options: { includeUnmarkedComments?: boolean } = {}): Promise<void> {
  const snapshot = record(run.inputSnapshot)
  const commentsRequested = snapshot[DEPENDENT_COMMENTS_PENDING_MARKER] === true
    || options.includeUnmarkedComments === true
  const reelsRequested = snapshot[DEPENDENT_INSTAGRAM_REELS_PENDING_MARKER] === true
  const facebookFanOutRequested = snapshot[DEPENDENT_FACEBOOK_FAN_OUT_PENDING_MARKER] === true
  let commentsOutcome: "complete" | "retry" = "complete"
  let reelsOutcome: "complete" | "retry" = "complete"
  let facebookFanOutOutcome: "complete" | "retry" = "complete"
  if (commentsRequested) {
    commentsOutcome = "retry"
    try {
      commentsOutcome = await queueDependentCommentRun(run)
    } catch (error) {
      console.error("[social-monitoring] dependent comment dispatch failed", error)
    }
  }
  if (reelsRequested) {
    reelsOutcome = "retry"
    try {
      reelsOutcome = await queueDependentInstagramReelsRun(run)
    } catch (error) {
      console.error("[social-monitoring] dependent Instagram reels dispatch failed", error)
    }
  }
  if (facebookFanOutRequested) {
    facebookFanOutOutcome = "retry"
    try {
      facebookFanOutOutcome = await queueDependentFacebookFanOutRuns(run)
    } catch (error) {
      console.error("[social-monitoring] dependent Facebook fan-out dispatch failed", error)
    }
  }

  const commentsWerePending = snapshot[DEPENDENT_COMMENTS_PENDING_MARKER] === true
  const reelsWerePending = snapshot[DEPENDENT_INSTAGRAM_REELS_PENDING_MARKER] === true
  const facebookFanOutWerePending = snapshot[DEPENDENT_FACEBOOK_FAN_OUT_PENDING_MARKER] === true
  const commentsPending = commentsRequested && commentsOutcome === "retry"
  const reelsPending = reelsRequested && reelsOutcome === "retry"
  const facebookFanOutPending = facebookFanOutRequested && facebookFanOutOutcome === "retry"
  if (
    commentsWerePending === commentsPending
    && reelsWerePending === reelsPending
    && facebookFanOutWerePending === facebookFanOutPending
  ) return
  const nextSnapshot = { ...snapshot }
  if (commentsPending) nextSnapshot[DEPENDENT_COMMENTS_PENDING_MARKER] = true
  else delete nextSnapshot[DEPENDENT_COMMENTS_PENDING_MARKER]
  if (reelsPending) nextSnapshot[DEPENDENT_INSTAGRAM_REELS_PENDING_MARKER] = true
  else delete nextSnapshot[DEPENDENT_INSTAGRAM_REELS_PENDING_MARKER]
  if (facebookFanOutPending) nextSnapshot[DEPENDENT_FACEBOOK_FAN_OUT_PENDING_MARKER] = true
  else delete nextSnapshot[DEPENDENT_FACEBOOK_FAN_OUT_PENDING_MARKER]
  const updated = await prisma.socialProviderRun.updateMany({
    where: {
      id: run.id,
      organizationId: run.organizationId,
      providerKey: APIFY_PROVIDER,
      purgedAt: null,
      status: { in: ["IMPORTED", "PARTIAL"] },
    },
    data: { inputSnapshot: nextSnapshot },
  })
  // A clean-slate reset can purge and scrub the parent after the import fence
  // is released but before this dependent-marker cleanup runs. The CAS above
  // must lose silently in that case; never rehydrate a PURGED tombstone with
  // the pre-reset provider input snapshot.
  if (updated.count !== 1) return
}

type ApifyBudgetDecision =
  | { allowed: true }
  | { allowed: false; reason: "paid_route_budget_enforcement_disabled" | "paid_route_budget_unconfigured" | "paid_route_daily_budget_exhausted" | "paid_route_monthly_budget_exhausted" }

// Фазы, которые пишет сам Apify-адаптер. Суточная квота автосбора считает их
// вместе, по одному ключу прогона коллектора.
const APIFY_QUOTA_PHASES = ["DISCOVER_CANDIDATE_POSTS", "EXTRACT_COMMENTS_FROM_CANDIDATES"]

class ApifyBudgetGuardError extends Error {
  constructor() {
    super("paid_route_budget_guard_failed")
    this.name = "ApifyBudgetGuardError"
  }
}

function budgetConfigurationDecision(budget: ReturnType<typeof routeBudget>): ApifyBudgetDecision {
  if (process.env.SOCIAL_MONITORING_ENFORCE_USD_BUDGETS !== "1") {
    return { allowed: false, reason: "paid_route_budget_enforcement_disabled" }
  }
  if (!budget.usdLimitsConfigured) {
    return { allowed: false, reason: "paid_route_budget_unconfigured" }
  }
  return { allowed: true }
}

async function budgetDecision(
  client: Parameters<typeof standardPaidProviderChargeTotalUsd>[0],
  organizationId: string,
  budget: ReturnType<typeof routeBudget>,
  now: Date,
): Promise<ApifyBudgetDecision> {
  const configuration = budgetConfigurationDecision(budget)
  if (!configuration.allowed) return configuration
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [day, month] = await Promise.all([
    standardPaidProviderChargeTotalUsd(client, {
      organizationId,
      since: dayStart,
    }),
    standardPaidProviderChargeTotalUsd(client, {
      organizationId,
      since: monthStart,
    }),
  ])
  const periodLimits = effectivePaidSocialPeriodLimits({
    configuredDailyUsd: budget.dailyBudgetUsd,
    configuredMonthlyUsd: budget.monthlyBudgetUsd,
  })
  if (day + budget.maxTotalChargeUsd > periodLimits.dailyUsd) {
    return { allowed: false, reason: "paid_route_daily_budget_exhausted" }
  }
  if (month + budget.maxTotalChargeUsd > periodLimits.monthlyUsd) {
    return { allowed: false, reason: "paid_route_monthly_budget_exhausted" }
  }
  return { allowed: true }
}

function webhookUrl(runId: string): string | null {
  const base = process.env.NEXTAUTH_URL || process.env.APP_URL
  if (!base) return null
  try {
    const url = new URL("/api/v1/social/providers/apify/webhook", base)
    url.searchParams.set("runId", runId)
    return url.toString()
  } catch {
    return null
  }
}

export async function runApifyAsyncCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const routePlanId = source.routeExecution?.routePlanId
  const collectorRunId = source.routeExecution?.collectorRunId
  const capability = source.routeExecution?.capability
  if (!routePlanId || !collectorRunId || !capability) return { status: "failed", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "apify_route_context_missing" }
  const token = await apifyToken(source.organizationId)
  if (!token) return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "apify_token_missing" }
  const [route, settings] = await Promise.all([
    prisma.sourceRoutePlan.findFirst({ where: { id: routePlanId, organizationId: source.organizationId }, select: { budget: true, freshnessMinutes: true } }),
    getSocialMonitoringSettings(source.organizationId),
  ])
  if (!route) return { status: "failed", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "apify_route_not_found" }
  const configuredBudget = routeBudget(route.budget)
  const actorId = apifyActorForSource(source, capability, settings.searchIndex.apifyActors)
  if (!actorId) return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "apify_actor_not_configured" }
  const requestedActorBuild = actorBuild(actorId)
  if (!requestedActorBuild) return {
    status: "skipped",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: "apify_actor_build_not_pinned",
    rawStats: { providerRequestDispatched: false, failClosed: true },
  }
  const now = new Date()
  const manualPaidRun = source.routeExecution?.manualPaidRun === true
  const clientFundedManual = manualPaidRun && source.routeExecution?.clientFundedManual === true
  // Автосбор тенанта, который платит со своего счёта у провайдера. Решение
  // владельца 2026-08-01: раз ручной запуск по этой же настройке уже работает,
  // ночной обязан работать так же — иначе автоматика молча собирает только
  // бесплатные каналы. Условие !manualPaidRun гарантирует, что ручные ветки
  // (аудит, кошелёк, идемпотентность) не затронуты ни на байт.
  // Признак обязан означать ИМЕННО автоматический прогон. Пользовательский
  // запуск без явного долларового капа тоже приходит с manualPaidRun=false, и
  // без второго условия он утёк бы в эту ветку — то есть стал бы платным
  // прогоном мимо авторизации и аудита ручного пути.
  const userInitiatedRun = manualPaidRun || source.routeExecution?.manualSourceRun === true
  const providerAccountFundedPolicy = !userInitiatedRun
    && process.env.SOCIAL_MONITORING_ENFORCE_USD_BUDGETS === "1"
    ? await tenantProviderAccountFundedRunPolicy(source.organizationId)
    : { enabled: false, dailyRunQuota: 0 }
  // Маршрут с заданными владельцем долларовыми лимитами обязан их соблюдать:
  // тенантный признак не должен снимать контроль там, где владелец его сам
  // включил.
  const providerAccountFunded = providerAccountFundedPolicy.enabled
    && !configuredBudget.usdLimitsConfigured
  if (clientFundedManual && process.env.SOCIAL_MONITORING_ENFORCE_USD_BUDGETS !== "1") {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "paid_route_budget_enforcement_disabled",
      rawStats: { providerRequestDispatched: false, failClosed: true, budgetGuard: true },
    }
  }
  if (clientFundedManual && !(await tenantClientFundedManualRunsEnabled(source.organizationId))) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "paid_client_funded_manual_not_authorized",
      rawStats: { providerRequestDispatched: false, failClosed: true, tenantAuthorization: false },
    }
  }
  if (clientFundedManual && (await tenantPaidRunEmergencyStopped(source.organizationId))) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "paid_manual_run_emergency_stopped",
      rawStats: { providerRequestDispatched: false, failClosed: true, emergencyStopped: true },
    }
  }
  const configuredInstagramTermCount = source.platform === "instagram"
    && actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR
    ? providerConfiguredTerms(source).length
    : 0
  const requestedManualCapUsd = source.routeExecution?.manualMaxTotalChargeUsd
  if (manualPaidRun && (!Number.isFinite(requestedManualCapUsd) || (requestedManualCapUsd ?? 0) <= 0)) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "paid_manual_run_cap_required",
      rawStats: { providerRequestDispatched: false, failClosed: true, budgetGuard: true },
    }
  }
  const dependentProviderRun = source.routeExecution?.dependentProviderRun === true
  const dependentMaxItemsOverride = dependentProviderRun
    ? numberValue(source.routeExecution?.providerRunMaxItemsOverride)
    : null
  const dependentMaxTotalChargeUsdOverride = dependentProviderRun
    ? numberValue(source.routeExecution?.providerRunMaxTotalChargeUsdOverride)
    : null
  const authorizedTotalMaxItems = clientFundedManual || providerAccountFunded
    ? Math.max(1, Math.min(100_000, Math.trunc(source.routeExecution?.maxItems ?? configuredBudget.maxItems)))
    : configuredBudget.maxItems
  // Решение владельца: у автосбора со счёта провайдера тот же предохранитель,
  // что у ручного запуска ($100 на прогон), а не системный $4 — иначе прогон
  // резался бы по деньгам раньше, чем по числу находок, и паритет с ручным
  // был бы фикцией. Реальным потолком остаётся баланс тенанта в Apify:
  // предохранитель не может потратить денег, которых на счёте нет.
  const automaticTotalChargeUsd = providerAccountFunded && !configuredBudget.usdLimitsConfigured
    ? boundedClientFundedManualChargeUsd(CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD)
    : boundedPaidSocialRunChargeUsd(configuredBudget.maxTotalChargeUsd)
  const authorizedTotalChargeUsd = manualPaidRun
    ? clientFundedManual
      ? boundedClientFundedManualChargeUsd(requestedManualCapUsd ?? 0)
      : boundedPaidSocialRunChargeUsd(
          Math.min(
            requestedManualCapUsd ?? 0,
            configuredBudget.usdLimitsConfigured
              ? configuredBudget.maxTotalChargeUsd
              : requestedManualCapUsd ?? 0,
          ),
        )
    : automaticTotalChargeUsd
  const pairedInstagramDiscovery = !dependentProviderRun
    && capability === "DISCOVER_POSTS"
    && source.platform === "instagram"
    && actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR
    && instagramDiscoveryResultsType(source) === "posts"
  if (
    pairedInstagramDiscovery
    && (
      configuredInstagramTermCount === 0
      || authorizedTotalMaxItems < configuredInstagramTermCount * 2
      || authorizedTotalChargeUsd < 0.02
    )
  ) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: authorizedTotalMaxItems < configuredInstagramTermCount * 2
        ? "apify_paired_result_budget_too_small"
        : authorizedTotalChargeUsd < 0.02
          ? "apify_paired_charge_budget_too_small"
          : "apify_query_missing",
      rawStats: { providerRequestDispatched: false, failClosed: true },
    }
  }
  const pairedPostsMaxItems = pairedInstagramDiscovery
    ? Math.ceil(authorizedTotalMaxItems / 2)
    : null
  const pairedReelsMaxItems = pairedInstagramDiscovery
    ? Math.floor(authorizedTotalMaxItems / 2)
    : null
  const pairedPostsMaxTotalChargeUsd = pairedInstagramDiscovery
    ? authorizedTotalChargeUsd / 2
    : null
  const pairedReelsMaxTotalChargeUsd = pairedInstagramDiscovery
    ? authorizedTotalChargeUsd - (pairedPostsMaxTotalChargeUsd ?? 0)
    : null
  // Веер Facebook (#638): родной актор принимает один запрос, поэтому алиасные
  // слоты — отдельные дочерние прогоны. Бюджет источника ДЕЛИТСЯ между
  // родителем и детьми, иначе N терминов стоили бы N бюджетов: сумма
  // зарезервированного по всей семье не превышает авторизованного.
  const facebookFanOutAliasTerms = !dependentProviderRun
    && capability === "DISCOVER_POSTS"
    && source.platform === "facebook"
    && actorId === APIFY_FACEBOOK_SEARCH_ACTOR
    ? providerFanOutTerms(source, authorizedTotalMaxItems).slice(1)
    : []
  const facebookFanOutSlots = 1 + facebookFanOutAliasTerms.length
  const facebookFanOutChildMaxItems = facebookFanOutAliasTerms.length > 0
    ? Math.floor(authorizedTotalMaxItems / facebookFanOutSlots)
    : null
  const facebookFanOutChildMaxTotalChargeUsd = facebookFanOutAliasTerms.length > 0
    ? authorizedTotalChargeUsd / facebookFanOutSlots
    : null
  const facebookFanOutParentMaxItems = facebookFanOutChildMaxItems === null
    ? null
    : authorizedTotalMaxItems - facebookFanOutChildMaxItems * facebookFanOutAliasTerms.length
  const facebookFanOutParentMaxTotalChargeUsd = facebookFanOutChildMaxTotalChargeUsd === null
    ? null
    : authorizedTotalChargeUsd
      - facebookFanOutChildMaxTotalChargeUsd * facebookFanOutAliasTerms.length
  const budget = {
    ...configuredBudget,
    maxItems: pairedPostsMaxItems
      ?? facebookFanOutParentMaxItems
      ?? (
        dependentMaxItemsOverride !== null
          ? Math.max(
              1,
              Math.min(
                clientFundedManual || providerAccountFunded ? 100_000 : configuredBudget.maxItems,
                Math.trunc(dependentMaxItemsOverride),
              ),
            )
          : authorizedTotalMaxItems
      ),
  }
  const requestedRunMaxTotalChargeUsd = pairedPostsMaxTotalChargeUsd
    ?? facebookFanOutParentMaxTotalChargeUsd
    ?? (
      dependentMaxTotalChargeUsdOverride !== null
        ? Math.min(authorizedTotalChargeUsd, dependentMaxTotalChargeUsdOverride)
        : authorizedTotalChargeUsd
    )
  const runMaxTotalChargeUsd = clientFundedManual || providerAccountFunded
    ? boundedClientFundedManualChargeUsd(requestedRunMaxTotalChargeUsd)
    : boundedPaidSocialRunChargeUsd(requestedRunMaxTotalChargeUsd)
  const periodLimits = effectivePaidSocialPeriodLimits({
    configuredDailyUsd: budget.usdLimitsConfigured ? budget.dailyBudgetUsd : null,
    configuredMonthlyUsd: budget.usdLimitsConfigured ? budget.monthlyBudgetUsd : null,
  })
  const runBudget = {
    ...budget,
    // A manual authorization supplies a valid one-shot budget even when the
    // recurring route itself is disabled. It still shares the system ceilings.
    usdLimitsConfigured: budget.usdLimitsConfigured || manualPaidRun,
    maxTotalChargeUsd: runMaxTotalChargeUsd,
    dailyBudgetUsd: periodLimits.dailyUsd,
    monthlyBudgetUsd: periodLimits.monthlyUsd,
  }
  const frozenWindow = capability === "DISCOVER_POSTS"
    ? routeProviderWindowOverride(source)
    : null
  const cursorWindow = capability === "DISCOVER_POSTS"
    ? frozenWindow?.cursorWindow ?? discoveryLookbackWindow(source, now)
    : null
  const providerWindow = capability === "DISCOVER_POSTS"
    ? frozenWindow?.providerWindow ?? (cursorWindow ? discoveryProviderWindow(source, cursorWindow) : null)
    : null
  const providerCursorScope = capability === "DISCOVER_POSTS" ? discoveryCursorScope(source) : undefined
  const candidates = capability === "READ_EXTERNAL_COMMENTS"
    ? await candidateUrls(source, budget.maxItems, { prepareCheckpoints: true, now })
    : { urls: [], parentRunId: null, approvedParents: [] }
  const input = capability === "READ_EXTERNAL_COMMENTS"
    ? commentsInput(source, candidates, budget.maxItems)
    : apifyDiscoveryInput(source, budget.maxItems, providerWindow, actorId)
  if (!input) {
    const configuredGoogleTerms = capability === "DISCOVER_POSTS"
      && actorId === APIFY_GOOGLE_SEARCH_ACTOR
      && ["facebook", "instagram"].includes(source.platform)
      ? providerConfiguredTerms(source).length
      : 0
    const configuredInstagramActorTerms = capability === "DISCOVER_POSTS"
      && source.platform === "instagram"
      && isInstagramKeywordDiscoverySource(source)
      ? providerConfiguredTerms(source).length
      : 0
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: capability === "READ_EXTERNAL_COMMENTS"
        ? "apify_candidate_posts_missing"
        : configuredGoogleTerms > 20 || configuredInstagramActorTerms > 20
          ? "apify_term_count_exceeds_limit"
          : (
            configuredGoogleTerms > budget.maxItems
            || configuredInstagramActorTerms > budget.maxItems
          )
            ? "apify_term_budget_too_small"
            : (
              configuredGoogleTerms > 0
              && budget.maxItems > configuredGoogleTerms * 100
            )
              ? "apify_result_budget_exceeds_actor_limit"
              : "apify_query_missing",
    }
  }
  const phase = capability === "READ_EXTERNAL_COMMENTS" ? "EXTRACT_COMMENTS_FROM_CANDIDATES" : "DISCOVER_CANDIDATE_POSTS"
  // Audit companion to the singular native Facebook query (#635): every
  // configured term the dispatched query does not carry is recorded on the run
  // snapshot, so the operator can see what a run did NOT search.
  const unsentProviderTerms = capability === "DISCOVER_POSTS"
    && source.platform === "facebook"
    && actorId === APIFY_FACEBOOK_SEARCH_ACTOR
    && typeof input.query === "string"
    // Слоты веера (#638) из этого списка НЕ вычитаются: план запустить
    // дочерний прогон — ещё не покрытие. Диспатч может не состояться (маршрут
    // ушёл в BLOCKED, бюджет исчерпан), и тогда вычитание превратило бы аудит
    // непоисканного в отчёт «всё покрыто». Фактически уходящие термины видны
    // рядом, в leadDriveFacebookFanOutTerms.
    ? facebookUnsentProviderTerms(source, input.query)
    : []
  // #638: алиасные слоты веера, реально отправленные этим прогоном. Слот 0 —
  // канонический термин — в список не входит. Маркер читает детекция
  // насыщения: переполнение алиасного слота не должно замораживать общий
  // курсор бренда, переполнение канонического — должно, как и раньше.
  const fanOutAliasTerms = capability === "DISCOVER_POSTS"
    && record(source.settings).canonicalBrandQuery === true
    ? actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR
      ? stringList(input.hashtags).slice(1)
      : actorId === APIFY_TIKTOK_SEARCH_ACTOR
        ? stringList(input.searchQueries).slice(1)
        : []
    : []
  const inputHash = hmacToken(JSON.stringify(input), `apify-input:${source.organizationId}`)
  if (
    !manualPaidRun
    && capability === "DISCOVER_POSTS"
    && source.routeExecution?.suppressFreshDiscoveryReuse !== true
    && !pairedInstagramDiscovery
  ) {
    // Freshness reuse is valid only for the exact physical route, Actor and
    // normalized input. Reusing a prior query after keywords or routing change
    // would report false coverage and could advance the new cursor without a
    // provider request.
    const recentImported = await prisma.socialProviderRun.findFirst({
      where: {
        organizationId: source.organizationId,
        sourceId: source.id,
        routePlanId,
        providerKey: APIFY_PROVIDER,
        phase: "DISCOVER_CANDIDATE_POSTS",
        actorId,
        inputHash,
        purgedAt: null,
        status: "IMPORTED",
        importedAt: { gte: new Date(now.getTime() - Math.max(15, route.freshnessMinutes) * 60_000) },
      },
      orderBy: { importedAt: "desc" },
    })
    if (recentImported) {
      const reusedProviderWindow = providerWindowFromSnapshot(recentImported.inputSnapshot)
      const reusedCursorScope = providerCursorScopeFromSnapshot(recentImported.inputSnapshot, {
        routePlanId,
        adapterKey: "APIFY_ASYNC",
      })
      const sameCursorScope = JSON.stringify({
        routePlanId: reusedCursorScope.routePlanId,
        adapterKey: reusedCursorScope.adapterKey,
        fullArchiveRun: reusedCursorScope.fullArchiveRun === true,
        targetScenarioId: reusedCursorScope.targetScenarioId ?? null,
        archiveStartAt: reusedCursorScope.archiveStartAt instanceof Date
          ? reusedCursorScope.archiveStartAt.toISOString()
          : reusedCursorScope.archiveStartAt ?? null,
      }) === JSON.stringify({
        routePlanId: providerCursorScope?.routePlanId ?? routePlanId,
        adapterKey: providerCursorScope?.adapterKey ?? "APIFY_ASYNC",
        fullArchiveRun: providerCursorScope?.fullArchiveRun === true,
        targetScenarioId: providerCursorScope?.targetScenarioId ?? null,
        archiveStartAt: providerCursorScope?.archiveStartAt instanceof Date
          ? providerCursorScope.archiveStartAt.toISOString()
          : providerCursorScope?.archiveStartAt ?? null,
      })
      if (sameCursorScope) {
        return {
          status: "success",
          foundCount: 0,
          newCount: 0,
          duplicateCount: 0,
          ignoredCount: 0,
          error: null,
          rawStats: {
            providerRunId: recentImported.id,
            providerStatus: recentImported.status,
            queued: false,
            reusedFreshDiscovery: true,
            reusedReceivedCount: recentImported.receivedCount,
            reusedAcceptedCount: recentImported.acceptedCount,
            coverageClass: "COMPLETE_FOR_INPUT",
            ...(reusedProviderWindow
              ? { until: reusedProviderWindow.until.toISOString() }
              : { cursorAdvanceSuppressed: true }),
          },
        }
      }
    }
  }
  if (!clientFundedManual && !providerAccountFunded) {
    const budgetGuard = budgetConfigurationDecision(runBudget)
    if (!budgetGuard.allowed) return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: budgetGuard.reason,
      rawStats: { providerRequestDispatched: false, failClosed: true, budgetGuard: true },
    }
  }
  if (!clientFundedManual && (await tenantPaidRunEmergencyStopped(source.organizationId))) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "paid_run_emergency_stopped",
      rawStats: {
        providerRequestDispatched: false,
        failClosed: true,
        emergencyStopped: true,
      },
    }
  }
  const bucketMs = Math.max(15, route.freshnessMinutes) * 60_000
  const idempotencyKey = source.routeExecution?.dependentProviderRun === true
    && source.routeExecution.parentProviderRunId
    ? `apify:${routePlanId}:${phase}:parent:${source.routeExecution.parentProviderRunId}:${inputHash.slice(0, 16)}`
    : manualPaidRun && capability === "READ_EXTERNAL_COMMENTS"
      ? `apify:${routePlanId}:${phase}:manual:${collectorRunId}`
    : manualPaidRun
      ? `apify:${routePlanId}:${phase}:manual:${collectorRunId}:${inputHash.slice(0, 16)}`
      : `apify:${routePlanId}:${phase}:${Math.floor(now.getTime() / bucketMs)}:${collectorRunId}:${inputHash.slice(0, 16)}`
  const secret = crypto.randomBytes(24).toString("base64url")
  let providerRun
  try {
    const reservation = await prisma.$transaction(async tx => {
      let existing
      let quotaExhausted = false
      let budgetGuard: ApifyBudgetDecision = { allowed: true }
      try {
        // Share the same tenant-wide lock as the other locally budgeted social
        // providers. The spend totals and this reservation must be observed as
        // one serial operation, otherwise concurrent sources can all pass the
        // daily check before any of them persists its exposure.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${source.organizationId}:paid-social-spend`}, 0))`
        const lockedOrganization = await tx.organization.findUnique({
          where: { id: source.organizationId },
          select: { settings: true },
        })
        if (
          !lockedOrganization
          || socialMonitoringCleanSlateBlocked(lockedOrganization.settings)
          || socialMonitoringPaidEmergencyStopped(lockedOrganization.settings)
        ) {
          return {
            kind: "blocked" as const,
            reason: "paid_run_emergency_stopped",
          }
        }
        existing = await tx.socialProviderRun.findUnique({
          where: { organizationId_idempotencyKey: { organizationId: source.organizationId, idempotencyKey } },
        })
        if (!existing && !clientFundedManual && !providerAccountFunded) {
          budgetGuard = await budgetDecision(tx, source.organizationId, runBudget, now)
        }
        // Снятие долларового гейта убирает у автосбора единственное локальное
        // суточное ограничение, поэтому квота прогонов проверяется здесь же —
        // под тем же advisory-локом, что и расходы, иначе несколько
        // источников проскочат её одновременно.
        if (!existing && providerAccountFunded) {
          const dayStart = new Date(now)
          dayStart.setUTCHours(0, 0, 0, 0)
          // Обе фазы Apify считаются в ОДНУ корзину: иначе у обнаружения и у
          // сбора комментариев были бы отдельные квоты, и ночной расход вышел
          // бы вдвое за объявленный потолок.
          const runIdsToday = new Set((await Promise.all(
            APIFY_QUOTA_PHASES.map(quotaPhase => standardPaidProviderCollectorRunIdsSince(tx, {
              organizationId: source.organizationId,
              since: dayStart,
              phase: quotaPhase,
              includeResetCarry: true,
              // Свои же прогоны исключены из общего учёта расходов, поэтому квота
              // обязана считать их отдельно — иначе она декоративна.
              includeProviderAccountFunded: true,
            })),
          )).flat())
          if (
            !runIdsToday.has(collectorRunId)
            && runIdsToday.size >= providerAccountFundedPolicy.dailyRunQuota
          ) {
            quotaExhausted = true
          }
        }
      } catch {
        throw new ApifyBudgetGuardError()
      }
      if (existing?.purgedAt || existing?.status === "PURGED") {
        return { kind: "blocked" as const, reason: "apify_previous_period_run_purged" }
      }
      if (existing) return { kind: "existing" as const, run: existing }
      if (quotaExhausted) return { kind: "blocked" as const, reason: "paid_run_daily_quota_exhausted" }
      if (!budgetGuard.allowed) return { kind: "blocked" as const, reason: budgetGuard.reason }
      const created = await tx.socialProviderRun.create({
      data: {
      organizationId: source.organizationId,
      sourceId: source.id,
      routePlanId,
      collectorRunId,
      parentRunId: source.routeExecution?.parentProviderRunId ?? candidates.parentRunId,
      providerKey: APIFY_PROVIDER,
      adapterKey: "APIFY_ASYNC",
      phase,
      actorId,
      actorBuild: requestedActorBuild,
      schemaVersion: NORMALIZED_SCHEMA_VERSION,
      status: "QUEUED",
      idempotencyKey,
      inputHash,
      inputSnapshot: {
        ...input,
        // This exact durable false marker is the only proof that provider I/O
        // has not started. externalRunId remains null across ambiguous POSTs
        // and therefore must never be used as that proof by itself.
        providerRequestDispatched: false,
        ...(unsentProviderTerms.length > 0
          ? { leadDriveUnsentProviderTerms: unsentProviderTerms }
          : {}),
        ...(fanOutAliasTerms.length > 0
          ? { leadDriveSearchFanOutAliasTerms: fanOutAliasTerms }
          : {}),
        ...(providerWindow && cursorWindow
          ? {
              leadDriveProviderWindow: {
                cursorSince: cursorWindow.since.toISOString(),
                since: providerWindow.since.toISOString(),
                until: providerWindow.until.toISOString(),
                resumedFromWatermark: providerWindow.resumedFromWatermark,
                clamped: providerWindow.clamped,
                overlapMinutes: providerWindow.resumedFromWatermark ? ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES : 0,
              },
            }
          : {}),
        ...(providerCursorScope
          ? {
              leadDriveProviderCursorScope: {
                routePlanId: providerCursorScope.routePlanId,
                adapterKey: providerCursorScope.adapterKey,
                fullArchiveRun: providerCursorScope.fullArchiveRun === true,
                targetScenarioId: providerCursorScope.targetScenarioId ?? null,
                archiveStartAt: providerCursorScope.archiveStartAt instanceof Date
                  ? providerCursorScope.archiveStartAt.toISOString()
                  : providerCursorScope.archiveStartAt ?? null,
              },
              leadDriveFullArchiveRun: providerCursorScope.fullArchiveRun === true,
              leadDriveArchiveStartAt: providerCursorScope.archiveStartAt instanceof Date
                ? providerCursorScope.archiveStartAt.toISOString()
                : providerCursorScope.archiveStartAt ?? null,
            }
          : {}),
        ...(!providerCursorScope && source.routeExecution?.fullArchiveRun === true
          ? {
              leadDriveFullArchiveRun: true,
              leadDriveArchiveStartAt: source.routeExecution.archiveStartAt ?? null,
            }
          : {}),
        ...(source.routeExecution?.manualSourceRun === true
          ? { leadDriveManualSourceRun: true }
          : {}),
        // Отдельный маркер: прогон разрешён оплатой со счёта тенанта у
        // провайдера, а не заданными лимитами. Ручные маркеры при этом НЕ
        // ставятся — иначе прогон выпал бы из учёта расходов и подменил бы
        // ключ идемпотентности.
        ...(providerAccountFunded
          ? {
            leadDriveProviderAccountFunded: true,
            systemHardMaxPerRunUsd: CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD,
          }
          : {}),
        ...(manualPaidRun
          ? {
            leadDriveManualPaidRun: true,
            operatorAuthorizedMaxTotalChargeUsd: runMaxTotalChargeUsd,
            requestedMaxTotalChargeUsd: requestedRunMaxTotalChargeUsd,
            systemHardMaxPerRunUsd: clientFundedManual
              ? CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD
              : PAID_SOCIAL_HARD_MAX_PER_RUN_USD,
            systemHardDailyBudgetUsd: clientFundedManual ? null : PAID_SOCIAL_HARD_DAILY_BUDGET_USD,
            systemHardMonthlyBudgetUsd: clientFundedManual ? null : PAID_SOCIAL_HARD_MONTHLY_BUDGET_USD,
          }
          : {}),
        ...(clientFundedManual
          ? { leadDriveClientFundedManual: true }
          : {}),
        ...(source.routeExecution?.targetScenarioId
          ? { leadDriveTargetScenarioId: source.routeExecution.targetScenarioId }
          : {}),
        ...(source.routeExecution?.targetSubjectId
          ? { leadDriveTargetSubjectId: source.routeExecution.targetSubjectId }
          : {}),
        ...(source.routeExecution?.suppressDependentPaidRuns
          ? { leadDriveSuppressDependentPaidRuns: true }
          : {}),
        ...(source.routeExecution?.dependentCommentsAuthorized === true
          && typeof source.routeExecution.dependentCommentsMaxTotalChargeUsd === "number"
          && Number.isFinite(source.routeExecution.dependentCommentsMaxTotalChargeUsd)
          && source.routeExecution.dependentCommentsMaxTotalChargeUsd > 0
          && typeof source.routeExecution.sourceAuthorizedMaxTotalChargeUsd === "number"
          && Number.isFinite(source.routeExecution.sourceAuthorizedMaxTotalChargeUsd)
          && source.routeExecution.sourceAuthorizedMaxTotalChargeUsd > 0
          && typeof source.routeExecution.discoveryMaxTotalChargeUsd === "number"
          && Number.isFinite(source.routeExecution.discoveryMaxTotalChargeUsd)
          && source.routeExecution.discoveryMaxTotalChargeUsd > 0
          ? {
              leadDriveDependentCommentsAuthorized: true,
              leadDriveDependentCommentsMaxTotalChargeUsd:
                source.routeExecution.dependentCommentsMaxTotalChargeUsd,
              leadDriveSourceAuthorizedMaxTotalChargeUsd:
                source.routeExecution.sourceAuthorizedMaxTotalChargeUsd,
              leadDriveDiscoveryMaxTotalChargeUsd:
                source.routeExecution.discoveryMaxTotalChargeUsd,
            }
          : {}),
        ...(capability === "DISCOVER_POSTS"
          && source.platform === "instagram"
          && actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR
          ? { leadDriveInstagramResultsType: instagramDiscoveryResultsType(source) }
          : {}),
        ...(pairedInstagramDiscovery
          && pairedReelsMaxItems !== null
          && pairedReelsMaxTotalChargeUsd !== null
          ? {
              leadDriveInstagramReelsBudget: {
                maxItems: pairedReelsMaxItems,
                maxTotalChargeUsd: pairedReelsMaxTotalChargeUsd,
              },
            }
          : {}),
        ...(facebookFanOutAliasTerms.length > 0
          && facebookFanOutChildMaxItems !== null
          && facebookFanOutChildMaxTotalChargeUsd !== null
          ? {
              leadDriveFacebookFanOutTerms: facebookFanOutAliasTerms,
              leadDriveFacebookFanOutBudget: {
                maxItems: facebookFanOutChildMaxItems,
                maxTotalChargeUsd: facebookFanOutChildMaxTotalChargeUsd,
              },
            }
          : {}),
        ...(source.routeExecution?.providerSearchTermOverride
          ? { leadDriveFacebookFanOutTerm: source.routeExecution.providerSearchTermOverride }
          : {}),
      },
      webhookSecretHash: hmacToken(secret, `apify-webhook:${source.organizationId}:${idempotencyKey}`),
      reservedChargeUsd: runMaxTotalChargeUsd,
      maxTotalChargeUsd: runMaxTotalChargeUsd,
      dailyBudgetUsd: clientFundedManual || providerAccountFunded ? null : periodLimits.dailyUsd,
      monthlyBudgetUsd: clientFundedManual || providerAccountFunded ? null : periodLimits.monthlyUsd,
      maxItems: budget.maxItems,
      timeoutSeconds: budget.timeoutSeconds,
      purgeAt: new Date(now.getTime() + 24 * 3_600_000),
    },
      })
      return { kind: "created" as const, run: created }
    })
    if (reservation.kind === "existing") return providerRunResult(reservation.run)
    if (reservation.kind === "blocked") return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: reservation.reason,
      rawStats: { providerRequestDispatched: false, failClosed: true, budgetGuard: true },
    }
    providerRun = reservation.run
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const raced = await prisma.socialProviderRun.findUnique({ where: { organizationId_idempotencyKey: { organizationId: source.organizationId, idempotencyKey } } })
      if (raced && !raced.purgedAt && raced.status !== "PURGED") return providerRunResult(raced)
    }
    if (error instanceof ApifyBudgetGuardError) return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "paid_route_budget_guard_failed",
      rawStats: { providerRequestDispatched: false, failClosed: true, budgetGuard: true },
    }
    throw error
  }

  let emergencyStoppedBeforeDispatch = true
  let emergencyCheckFailed = false
  try {
    emergencyStoppedBeforeDispatch = await tenantPaidRunEmergencyStopped(source.organizationId)
  } catch {
    emergencyCheckFailed = true
  }
  if (emergencyStoppedBeforeDispatch) {
    const stopError = emergencyCheckFailed
      ? "paid_run_emergency_check_failed"
      : clientFundedManual
        ? "paid_manual_run_emergency_stopped"
        : "paid_run_emergency_stopped"
    await releaseUndispatchedApifyReservation(providerRun, stopError)
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: stopError,
      rawStats: {
        providerRunId: providerRun.id,
        providerRequestDispatched: false,
        failClosed: true,
        emergencyStopped: !emergencyCheckFailed,
        emergencyCheckFailed,
      },
    }
  }

  const endpoint = new URL(`${APIFY_API}/acts/${actorApiId(actorId)}/runs`)
  endpoint.searchParams.set("maxItems", String(budget.maxItems))
  endpoint.searchParams.set("maxTotalChargeUsd", String(runMaxTotalChargeUsd))
  endpoint.searchParams.set("timeout", String(budget.timeoutSeconds))
  endpoint.searchParams.set("restartOnError", "false")
  endpoint.searchParams.set("build", requestedActorBuild)
  const callback = webhookUrl(providerRun.id)
  if (callback) endpoint.searchParams.set("webhooks", Buffer.from(JSON.stringify([{
    eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.ABORTED", "ACTOR.RUN.TIMED_OUT"],
    requestUrl: callback,
    headersTemplate: JSON.stringify({
      "X-LeadDrive-Apify-Secret": secret,
    }),
  }]), "utf8").toString("base64"))
  let providerRequestClaimed = false
  const dispatchFence = await (async () => {
    try {
      return await withSocialMonitoringImportFence({
        organizationId: source.organizationId,
        providerRunId: providerRun.id,
        providerKey: APIFY_PROVIDER,
        expectedStatuses: ["QUEUED"],
        blockOnEmergencyStop: true,
      }, async () => {
        let claimed = false
        try {
          claimed = await claimApifyStartDispatch(providerRun)
        } catch {
          // The POST has not started. Release only the row whose durable marker
          // still proves that exact fact; a concurrent RUNNING row is untouchable.
          const released = await releaseUndispatchedApifyReservation(providerRun, "apify_start_dispatch_claim_failed")
          if (released) return { kind: "predispatch_failed" as const }
          // The claim acknowledgement itself can be lost after the database
          // commits. If exact-false cleanup cannot prove otherwise, fail as
          // dispatch-unknown even though this process has not called fetch.
          providerRequestClaimed = true
          return { kind: "unknown" as const }
        }
        if (!claimed) {
          const released = await releaseUndispatchedApifyReservation(providerRun, "apify_start_dispatch_claim_failed")
          if (released) return { kind: "predispatch_failed" as const }
          providerRequestClaimed = true
          return { kind: "unknown" as const }
        }
        providerRequestClaimed = true

        try {
          const { response, body } = await withSocialProviderTimeout("apify_start", async signal => {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(input),
              signal,
            })
            // Keep response-body I/O inside the same abort boundary. Apify can
            // send headers before the JSON body; clearing the deadline at that
            // point would let a stalled body outlive the source lease.
            const body = await response.json().catch(() => null) as { data?: JsonRecord; error?: JsonRecord } | null
            return { response, body }
          }, {
            timeoutMs: APIFY_START_REQUEST_TIMEOUT_MS,
            signal: source.providerRequestSignal,
          })
          if (!response.ok) {
            // Only an explicit client rejection proves the Actor did not
            // start. The request was still dispatched, so the durable marker
            // remains true and callers must not try another paid fallback.
            const explicitClientRejection = DEFINITE_APIFY_START_REJECTIONS.has(response.status)
            if (!explicitClientRejection) return { kind: "unknown" as const }
            const rejected = await prisma.socialProviderRun.updateMany({
              where: {
                id: providerRun.id,
                organizationId: source.organizationId,
                providerKey: APIFY_PROVIDER,
                purgedAt: null,
                status: "RUNNING",
                externalRunId: null,
                inputSnapshot: { path: ["providerRequestDispatched"], equals: true },
              },
              data: {
                status: "FAILED",
                lastError: `apify_start_${response.status}`,
                reservedChargeUsd: 0,
                finishedAt: new Date(),
              },
            })
            return rejected.count === 1
              ? { kind: "rejected" as const, error: `apify_start_${response.status}` }
              : { kind: "unknown" as const }
          }
          const data = body?.data
          const externalRunId = stringValue(data?.id)
          if (!data || !externalRunId) return { kind: "unknown" as const }
          const updated = await prisma.socialProviderRun.updateMany({
            where: {
              id: providerRun.id,
              organizationId: source.organizationId,
              providerKey: APIFY_PROVIDER,
              purgedAt: null,
              status: "RUNNING",
              externalRunId: null,
              inputSnapshot: { path: ["providerRequestDispatched"], equals: true },
            },
            data: {
              externalRunId,
              datasetId: stringValue(data.defaultDatasetId),
              actorBuild: stringValue(data.buildId) || requestedActorBuild,
              status: "RUNNING",
              startedAt: now,
            },
          })
          // The POST succeeded but its acknowledgement could not be made
          // durable. This is dispatch-unknown, never evidence for retrying.
          if (updated.count !== 1) return { kind: "unknown" as const }
          if (capability === "READ_EXTERNAL_COMMENTS") {
            if (["instagram", "facebook"].includes(source.platform)) {
              await markCommentCheckpointsDispatched({
                organizationId: source.organizationId,
                sourceId: source.id,
                urls: candidates.urls,
                providerRunId: providerRun.id,
                now,
                includeInactive: source.routeExecution?.manualPaidRun === true,
              }).catch(error => console.error("[social-monitoring] comment checkpoint dispatch lease failed", error))
            } else if (source.platform === "tiktok") {
              await prisma.tikTokPublicationRevisit.updateMany({
                where: {
                  organizationId: source.organizationId,
                  status: "ACTIVE",
                  canonicalUrl: { in: candidates.urls },
                },
                data: { nextDueAt: new Date(now.getTime() + 6 * 3_600_000) },
              }).catch((error: unknown) => console.error("[social-monitoring] TikTok revisit dispatch lease failed", error))
            }
          }
          return { kind: "started" as const, externalRunId }
        } catch {
          // Claiming RUNNING + true happened before POST. Any later exception,
          // including acknowledgement persistence, is conservatively unknown.
          return { kind: "unknown" as const }
        }
      })
    } catch {
      if (providerRequestClaimed) {
        return { allowed: true as const, value: { kind: "unknown" as const } }
      }
      const released = await releaseUndispatchedApifyReservation(providerRun, "apify_start_dispatch_claim_failed")
      return released
        ? { allowed: true as const, value: { kind: "predispatch_failed" as const } }
        : { allowed: true as const, value: { kind: "unknown" as const } }
    }
  })()
  if (!dispatchFence.allowed) {
    if (providerRequestClaimed) return retainUnknownApifyStart(providerRun)
    // The provider was never contacted: close only the exact undispatched
    // reservation we still own. externalRunId:null is deliberately
    // insufficient; the durable exact false marker is required as well.
    await releaseUndispatchedApifyReservation(providerRun, dispatchFence.reason)
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: dispatchFence.reason,
      rawStats: {
        providerRunId: providerRun.id,
        providerRequestDispatched: false,
        failClosed: true,
        collectionFence: true,
      },
    }
  }
  if (dispatchFence.value.kind === "unknown") {
    return retainUnknownApifyStart(providerRun)
  }
  if (dispatchFence.value.kind === "predispatch_failed") {
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "apify_start_dispatch_claim_failed",
      rawStats: {
        providerRunId: providerRun.id,
        providerRequestDispatched: false,
        failClosed: true,
      },
    }
  }
  if (dispatchFence.value.kind === "rejected") {
    return {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: dispatchFence.value.error,
      rawStats: { providerRunId: providerRun.id, providerRequestDispatched: true },
    }
  }
  const externalRunId = dispatchFence.value.externalRunId
  return {
    status: "success",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: null,
    rawStats: {
      providerRunId: providerRun.id,
      externalRunId,
      queued: true,
      providerRequestDispatched: true,
      phase,
      actorId,
      coverageClass: "PENDING",
      ...(providerWindow && cursorWindow
        ? {
            cursorSince: cursorWindow.since.toISOString(),
            since: providerWindow.since.toISOString(),
            until: providerWindow.until.toISOString(),
            resumedFromWatermark: providerWindow.resumedFromWatermark,
            providerWindowClamped: providerWindow.clamped,
            providerWindowOverlapMinutes: providerWindow.resumedFromWatermark ? ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES : 0,
          }
        : {}),
      manualPaidRun,
      providerAccountFunded,
      maxTotalChargeUsd: runMaxTotalChargeUsd,
    },
  }
}

function itemUrl(item: JsonRecord): string | null {
  return [
    item.commentUrl,
    item.postUrl,
    item.url,
    item.link,
    item.permalink,
    // clockworks/tiktok-comments-scraper 0.0.423 returns the submitted
    // candidate under submittedVideoUrl/input and the resolved URL under
    // videoWebUrl. Keep the submitted form first because it is the exact URL
    // stored on the matched parent mention (usually without www).
    item.submittedVideoUrl,
    item.input,
    item.videoWebUrl,
    item.webVideoUrl,
    item.videoUrl,
  ]
    .map(stringValue).find((value): value is string => Boolean(value)) ?? null
}

function tiktokVideoId(value: unknown): string | null {
  const raw = stringValue(value)
  if (!raw) return null
  try {
    const match = new URL(raw).pathname.match(/\/video\/(\d+)/i)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function instagramCommentIdentity(value: unknown): {
  commentId: string
  parentCommentId: string | null
  postExternalId: string | null
} | null {
  const raw = stringValue(value)
  if (!raw) return null
  try {
    const segments = new URL(raw).pathname.split("/").filter(Boolean)
    const postMarker = segments.findIndex(segment => ["p", "reel", "tv"].includes(segment.toLowerCase()))
    const commentMarker = segments.findIndex(segment => segment.toLowerCase() === "c")
    if (commentMarker < 0 || !segments[commentMarker + 1]) return null
    const parentOrCommentId = decodeURIComponent(segments[commentMarker + 1])
    const replyMarker = segments.findIndex((segment, index) => index > commentMarker && segment.toLowerCase() === "r")
    const replyId = replyMarker >= 0 && segments[replyMarker + 1]
      ? decodeURIComponent(segments[replyMarker + 1])
      : null
    return {
      commentId: replyId || parentOrCommentId,
      parentCommentId: replyId ? parentOrCommentId : null,
      postExternalId: postMarker >= 0 && segments[postMarker + 1]
        ? decodeURIComponent(segments[postMarker + 1])
        : null,
    }
  } catch {
    return null
  }
}

function itemText(item: JsonRecord): string | null {
  const body = [item.text, item.message, item.comment, item.commentText, item.caption, item.description, item.desc, item.snippet]
    .map(stringValue).find((value): value is string => Boolean(value))
  const title = stringValue(item.title)
  return [title, body].filter(Boolean).join("\n").trim() || null
}

function nestedString(item: JsonRecord, key: string, nestedKey: string): string | null {
  return stringValue(record(item[key])[nestedKey])
}

function itemMediaMetadata(item: JsonRecord): JsonRecord {
  const mediaUrls = Array.from(new Set([
    ...stringList(item.mediaUrls),
    item.mediaUrl,
    item.videoUrl,
    item.video,
    item.videoUrlNoWatermark,
    item.downloadUrl,
    nestedString(item, "video_files", "video_hd_file"),
    nestedString(item, "video_files", "video_sd_file"),
    nestedString(item, "video", "downloadAddr"),
    nestedString(item, "videoMeta", "downloadAddr"),
  ].map(stringValue).filter((value): value is string => Boolean(value))))
  const mediaUrl = mediaUrls[0] ?? null
  const thumbnailUrl = [
    item.thumbnailUrl,
    item.video_thumbnail,
    item.coverUrl,
    item.displayUrl,
    item.imageUrl,
    nestedString(item, "image", "uri"),
    nestedString(item, "video", "cover"),
    nestedString(item, "videoMeta", "coverUrl"),
  ]
    .map(stringValue).find((value): value is string => Boolean(value)) ?? null
  const explicitAudio = [item.audioUrl, item.musicUrl, nestedString(item, "musicMeta", "playUrl")]
    .map(stringValue).find((value): value is string => Boolean(value)) ?? null
  const frameUrls = stringList(item.frameUrls).slice(0, 24)
  const platformTranscript = stringValue(item.platformTranscript) || stringValue(item.transcript) || stringValue(item.subtitles)
  return {
    ...(mediaUrl ? { mediaUrl, videoUrl: mediaUrl, audioUrl: explicitAudio || mediaUrl, mediaType: "VIDEO" } : {}),
    ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
    ...(thumbnailUrl ? { thumbnailUrl, ...(!mediaUrl ? { mediaType: "IMAGE" } : {}) } : {}),
    ...(frameUrls.length > 0 ? { frameUrls } : {}),
    ...(platformTranscript ? { platformTranscript } : {}),
  }
}

function apifyContentKind(platform: string, item: JsonRecord, metadata: JsonRecord): "POST" | "VIDEO" | "IMAGE" | "AUDIO" {
  const normalizedPlatform = platform.toLowerCase()
  if (normalizedPlatform === "youtube" || normalizedPlatform === "tiktok") return "VIDEO"

  const declared = [
    item.type,
    item.contentType,
    item.postType,
    item.productType,
    metadata.mediaType,
  ].map(stringValue).filter((value): value is string => Boolean(value)).join(" ").toLowerCase()
  const url = itemUrl(item)?.toLowerCase() ?? ""
  if (declared.includes("video") || declared.includes("reel") || url.includes("/reel") || url.includes("/videos/")) return "VIDEO"
  if (declared.includes("audio")) return "AUDIO"
  if (declared.includes("image") || declared.includes("photo") || declared.includes("carousel")) return "IMAGE"
  return "POST"
}

/**
 * Google SERP results expose freshness as `lastUpdated: "N units ago"`
 * instead of a timestamp. Parse only the small, explicit grammar we know;
 * unknown and future-looking strings stay dateless so the freshness gate can
 * fail closed. Calendar subtraction keeps "1 month ago" deterministic around
 * short months without ever producing a future timestamp.
 */
export function parseApifyRelativeTimestamp(value: unknown, relativeTo: Date): Date | null {
  const raw = stringValue(value)?.toLowerCase().replace(/\s+/g, " ")
  if (!raw || !Number.isFinite(relativeTo.getTime())) return null
  const match = raw.match(/^(?:about )?(?:(\d{1,4})|a|an|one) (second|minute|hour|day|week|month|year)s? ago$/)
  if (!match) return null
  const amount = match[1] ? Number(match[1]) : 1
  if (!Number.isSafeInteger(amount) || amount < 0) return null
  const unit = match[2]
  const maximumByUnit: Record<string, number> = {
    second: 31_536_000,
    minute: 525_600,
    hour: 8_760,
    day: 3_650,
    week: 520,
    month: 120,
    year: 10,
  }
  if (amount > maximumByUnit[unit]) return null

  let parsed: Date
  if (unit === "month" || unit === "year") {
    const months = amount * (unit === "year" ? 12 : 1)
    const sourceMonth = relativeTo.getUTCFullYear() * 12 + relativeTo.getUTCMonth()
    const targetMonth = sourceMonth - months
    const targetYear = Math.floor(targetMonth / 12)
    const targetMonthOfYear = ((targetMonth % 12) + 12) % 12
    const lastTargetDay = new Date(Date.UTC(targetYear, targetMonthOfYear + 1, 0)).getUTCDate()
    parsed = new Date(relativeTo)
    parsed.setUTCFullYear(targetYear, targetMonthOfYear, Math.min(relativeTo.getUTCDate(), lastTargetDay))
  } else {
    const millisecondsByUnit: Record<string, number> = {
      second: 1_000,
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 7 * 86_400_000,
    }
    parsed = new Date(relativeTo.getTime() - amount * millisecondsByUnit[unit])
  }
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > relativeTo.getTime()) return null
  return parsed
}

function itemDate(item: JsonRecord, relativeTo?: Date): Date | null {
  for (const value of [item.publishedAt, item.createdAt, item.timestamp, item.createTimeISO, item.date]) {
    if (typeof value === "number") {
      const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
      if (Number.isFinite(date.getTime())) return date
    }
    const raw = stringValue(value)
    if (raw) {
      const date = new Date(raw)
      if (Number.isFinite(date.getTime())) return date
    }
  }
  if (relativeTo) return parseApifyRelativeTimestamp(item.lastUpdated, relativeTo)
  return null
}

function isPlatformCandidateUrl(platform: string, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    if (platform === "instagram") {
      return host === "instagram.com" && /^\/(p|reel|tv)\//i.test(url.pathname)
    }
    if (platform === "facebook") {
      if (host !== "facebook.com" && host !== "m.facebook.com") return false
      return /\/(posts|videos|reel|photos?)\//i.test(url.pathname)
        || /\/groups\/[^/]+\/posts\//i.test(url.pathname)
        || ["/story.php", "/permalink.php", "/photo.php"].includes(url.pathname.toLowerCase())
    }
    if (platform === "tiktok") {
      return (host === "tiktok.com" || host === "m.tiktok.com")
        && /^\/@[^/]+\/video\/\d+/i.test(url.pathname)
    }
    if (platform === "web") {
      return ["http:", "https:"].includes(url.protocol)
        && !["google.com", "googleusercontent.com"].some(domain => host === domain || host.endsWith(`.${domain}`))
    }
    return false
  } catch {
    return false
  }
}

function expandDiscoveryPayload(
  payload: unknown[],
  source: MonitoringSourceForRun,
  actorId?: string | null,
): JsonRecord[] {
  const webDiscovery = (
    source.platform === "web"
    || actorId === APIFY_GOOGLE_SEARCH_ACTOR
  )
    && ["facebook", "instagram", "web"].includes(source.platform)
    && WEB_DISCOVERY_SOURCE_TYPES.has(source.sourceType)
    && (
      source.sourceType !== "hashtag"
      || source.platform === "web"
      || actorId === APIFY_GOOGLE_SEARCH_ACTOR
    )
  if (!webDiscovery) return payload.map(record)

  return payload.flatMap(rawPage => {
    const page = record(rawPage)
    const searchTerm = stringValue(record(page.searchQuery).term)
    const organicResults = Array.isArray(page.organicResults) ? page.organicResults : []
    return organicResults
      .map(record)
      .filter(result => {
        const url = stringValue(result.url)
        return Boolean(url && isPlatformCandidateUrl(source.platform, url))
      })
      // Web-search organic results carry the search engine's title/snippet, not
      // the actual post body, and usually no publish date — mark them so import
      // can keep uncertain ones out of the accepted feed.
      .map(result => ({ ...result, __webDiscoveryOrganicResult: true, ...(searchTerm ? { searchTerm } : {}) }))
  })
}

function expandCommentPayload(payload: unknown[], source: MonitoringSourceForRun, phase: string): JsonRecord[] {
  const items = payload.map(record)
  if (phase !== "EXTRACT_COMMENTS_FROM_CANDIDATES" || source.platform !== "instagram") return items

  return items.flatMap(rawParent => {
    const commentUrl = stringValue(rawParent.commentUrl) || itemUrl(rawParent)
    const commentIdentity = instagramCommentIdentity(commentUrl)
    const parentUrlIdentity = instagramCommentIdentity(rawParent.parentCommentUrl)
    const derivedParentId = commentIdentity?.parentCommentId || parentUrlIdentity?.commentId || null
    const derivedPostId = commentIdentity?.postExternalId
      || instagramCommentIdentity(rawParent.parentCommentUrl)?.postExternalId
      || null
    const parent: JsonRecord = {
      ...rawParent,
      ...(!stringValue(rawParent.id) && commentIdentity?.commentId ? { id: commentIdentity.commentId } : {}),
      ...(!stringValue(rawParent.parentCommentId) && derivedParentId ? { parentCommentId: derivedParentId } : {}),
      ...(derivedParentId ? { isReply: true } : {}),
      ...(!stringValue(rawParent.postId) && derivedPostId ? { postId: derivedPostId } : {}),
      ...(!stringValue(rawParent.threadId) && derivedPostId ? { threadId: derivedPostId } : {}),
    }
    const nested = Array.isArray(parent.replies) ? parent.replies.map(record) : []
    if (nested.length === 0) return [parent]

    const parentId = stringValue(parent.id) || stringValue(parent.commentId) || stringValue(parent.cid)
    // A nested row without a stable parent id cannot satisfy the canonical
    // reply contract. Keep the top-level comment and fail closed on those
    // children instead of ingesting them as unrelated comments.
    if (!parentId) return [parent]

    const inheritedPostUrl = stringValue(parent.postUrl)
      || stringValue(parent.facebookUrl)
      || stringValue(parent.videoWebUrl)
      || itemUrl(parent)
    const inheritedPostId = stringValue(parent.postId) || stringValue(parent.videoId)
    const inheritedThreadId = stringValue(parent.threadId) || inheritedPostId

    return [
      parent,
      ...nested.map(reply => ({
        ...reply,
        parentCommentId: stringValue(reply.parentCommentId) || stringValue(reply.parentId) || parentId,
        isReply: true,
        ...(!stringValue(reply.postUrl) && inheritedPostUrl ? { postUrl: inheritedPostUrl } : {}),
        ...(!itemUrl(reply) && inheritedPostUrl ? { url: inheritedPostUrl } : {}),
        ...(!stringValue(reply.postId) && inheritedPostId ? { postId: inheritedPostId } : {}),
        ...(!stringValue(reply.threadId) && inheritedThreadId ? { threadId: inheritedThreadId } : {}),
      })),
    ]
  })
}

// Mirrors DEFAULT_SEARCH_LOOKBACK_HOURS in search-index-adapter.ts (not imported
// to avoid a module cycle: the search-index collector chains into this adapter).
const DISCOVERY_LOOKBACK_HOURS_DEFAULT = 24

export const DISCOVERY_REVIEW_REASONS = {
  missingPublishedAt: "discovery_missing_published_at",
  outsideLookbackWindow: "discovery_outside_lookback_window",
  snippetOnlyMatch: "discovery_snippet_only_match",
  textlessTikTokVideo: "discovery_tiktok_video_without_caption",
} as const

function discoveryCursorScope(source: MonitoringSourceForRun): ArchiveProviderCursorScope | undefined {
  const route = source.routeExecution
  if (!route) return undefined
  const archiveStartAt = route.fullArchiveRun === true
    ? scenarioArchiveStartAtForSource(
        source.settings,
        route.targetScenarioId,
        route.archiveStartAt,
      )
    : null
  // Дочерний прогон веера Facebook ищет свой термин, а значит покрывает свой
  // поток контента. Общий курсор бренда он двигать не смеет: иначе следующая
  // каденция канонического термина стартовала бы с более поздней отметки и
  // навсегда пропустила бы окно, которое канонический запрос не искал.
  const fanOutTerm = source.platform === "facebook"
    ? route.providerSearchTermOverride?.trim()
    : null
  return {
    routePlanId: route.routePlanId,
    // Instagram's hashtag Actor exposes posts and reels as separate result
    // types. Keep independent watermarks so completion of one dataset never
    // represents the other as covered.
    adapterKey: fanOutTerm
      ? `${route.adapterKey}:term:${normalizedTermIdentity(fanOutTerm)}`
      : source.platform === "instagram"
        && (isInstagramKeywordDiscoverySource(source) || source.sourceType === "hashtag")
        ? `${route.adapterKey}:${instagramDiscoveryResultsType(source)}`
        : route.adapterKey,
    fullArchiveRun: route.fullArchiveRun === true,
    targetScenarioId: route.targetScenarioId,
    archiveStartAt,
  }
}

export function discoveryLookbackWindow(source: MonitoringSourceForRun, now = new Date()): { hours: number; since: Date; until: Date; resumedFromWatermark: boolean; clamped: boolean } {
  const settings = record(record(source.settings).searchIndex)
  const envHours = Number(process.env.SOCIAL_SEARCH_INDEX_LOOKBACK_HOURS || "")
  const configured = Number.isFinite(envHours) && envHours > 0 ? envHours : numberValue(settings.lookbackHours)
  const hours = Math.min(Math.max(configured ?? DISCOVERY_LOOKBACK_HOURS_DEFAULT, 1), 24 * 30)
  const route = source.routeExecution
  const archiveStartAt = route?.fullArchiveRun === true
    ? scenarioArchiveStartAtForSource(
        source.settings,
        route.targetScenarioId,
        route.archiveStartAt,
      )
    : null
  const scope = discoveryCursorScope(source)
  return resolveArchiveProviderWindow(source.settings, now, hours, 24 * 30, {
    ...(scope ? { scope } : {}),
    archiveStartAt,
  })
}

function discoveryProviderWindow(
  source: MonitoringSourceForRun,
  cursorWindow: ArchiveProviderWindow,
): ArchiveProviderWindow {
  const route = source.routeExecution
  const archiveStartAt = route?.fullArchiveRun === true
    ? scenarioArchiveStartAtForSource(
        source.settings,
        route.targetScenarioId,
        route.archiveStartAt,
      )
    : null
  return withArchiveProviderCursorOverlap(
    cursorWindow,
    ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES,
    archiveStartAt,
  )
}

function providerWindowFromSnapshot(value: unknown): ArchiveProviderWindow | null {
  const snapshot = record(record(value).leadDriveProviderWindow)
  const sinceValue = stringValue(snapshot.since)
  const untilValue = stringValue(snapshot.until)
  if (!sinceValue || !untilValue) return null
  const since = new Date(sinceValue)
  const until = new Date(untilValue)
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since > until) return null
  return {
    hours: Math.max(0, Math.ceil((until.getTime() - since.getTime()) / 3_600_000)),
    since,
    until,
    resumedFromWatermark: snapshot.resumedFromWatermark === true,
    clamped: snapshot.clamped === true,
  }
}

function routeProviderWindowOverride(source: MonitoringSourceForRun): {
  cursorWindow: ArchiveProviderWindow
  providerWindow: ArchiveProviderWindow
} | null {
  const override = source.routeExecution?.providerWindowOverride
  if (!override) return null
  const cursorSince = new Date(override.cursorSince)
  const since = new Date(override.since)
  const until = new Date(override.until)
  if (
    !Number.isFinite(cursorSince.getTime())
    || !Number.isFinite(since.getTime())
    || !Number.isFinite(until.getTime())
    || cursorSince > until
    || since > until
  ) return null
  const common = {
    hours: Math.max(0, Math.ceil((until.getTime() - cursorSince.getTime()) / 3_600_000)),
    until,
    resumedFromWatermark: override.resumedFromWatermark === true,
    clamped: override.clamped === true,
  }
  return {
    cursorWindow: { ...common, since: cursorSince },
    providerWindow: { ...common, since },
  }
}

function providerCursorScopeFromSnapshot(
  value: unknown,
  fallback: Pick<ArchiveProviderCursorScope, "routePlanId" | "adapterKey">,
): ArchiveProviderCursorScope {
  const input = record(value)
  const snapshot = record(input.leadDriveProviderCursorScope)
  const targetScenarioId = stringValue(snapshot.targetScenarioId)
    ?? stringValue(input.leadDriveTargetScenarioId)
  const snapshotHasArchiveStartAt = Object.prototype.hasOwnProperty.call(snapshot, "archiveStartAt")
  const inputHasArchiveStartAt = Object.prototype.hasOwnProperty.call(input, "leadDriveArchiveStartAt")
  const rawArchiveStartAt = snapshotHasArchiveStartAt
    ? snapshot.archiveStartAt
    : inputHasArchiveStartAt
      ? input.leadDriveArchiveStartAt
      : undefined
  // Preserve an explicit null. Without this, reconciliation could fall back
  // to a stale denormalized scenarioLinks value that the authorized scenario
  // explicitly replaced with "no lower bound".
  const archiveStartAt = rawArchiveStartAt === undefined
    ? undefined
    : rawArchiveStartAt === null
      ? null
      : stringValue(rawArchiveStartAt)
  return {
    routePlanId: stringValue(snapshot.routePlanId) ?? fallback.routePlanId,
    adapterKey: stringValue(snapshot.adapterKey) ?? fallback.adapterKey,
    fullArchiveRun: snapshot.fullArchiveRun === true || input.leadDriveFullArchiveRun === true,
    targetScenarioId,
    ...(archiveStartAt !== undefined ? { archiveStartAt } : {}),
  }
}

/**
 * Freshness gate for every discovery result. Provider-side filters are useful
 * but not authoritative, so every item with a known timestamp is checked
 * again at import and unknown timestamps fail safely into REVIEW. The
 * snippet/title precision rule remains specific to flattened web SERPs.
 */
export function discoveryReviewDecision(options: {
  phase: string
  platform: string
  webDiscoveryOrganicResult: boolean
  publishedAt: Date | null
  lookbackWindow: { since: Date; until: Date }
  title: string | null
  terms: string[]
  matchedTerm: string | null
  textlessTikTokVideo?: boolean
}): { relevanceStatus: "REVIEW" | "REJECTED"; reason: string } | null {
  if (options.phase !== "DISCOVER_CANDIDATE_POSTS") return null
  if (!options.publishedAt) {
    return {
      relevanceStatus: "REVIEW",
      reason: DISCOVERY_REVIEW_REASONS.missingPublishedAt,
    }
  }
  const ts = options.publishedAt.getTime()
  const clockSkewMs = 5 * 60_000
  if (ts < options.lookbackWindow.since.getTime() || ts > options.lookbackWindow.until.getTime() + clockSkewMs) {
    return {
      relevanceStatus: "REJECTED",
      reason: DISCOVERY_REVIEW_REASONS.outsideLookbackWindow,
    }
  }
  if (options.platform === "tiktok" && options.textlessTikTokVideo) {
    return {
      relevanceStatus: "REVIEW",
      reason: DISCOVERY_REVIEW_REASONS.textlessTikTokVideo,
    }
  }
  if (!options.webDiscoveryOrganicResult) return null
  if (options.matchedTerm) {
    const titleMatch = options.title ? findMatchedKeyword(options.title, options.terms) : null
    if (!titleMatch) {
      return {
        relevanceStatus: "REVIEW",
        reason: DISCOVERY_REVIEW_REASONS.snippetOnlyMatch,
      }
    }
  }
  return null
}

// apify/facebook-posts-scraper returns a page's own posts but names the page
// under fields normalizeApifyItem historically never read (pageName, user.name,
// facebookUrl/pageUrl = the page root). The author therefore came out NULL and
// the subject's own posts were classified "from others" (owner regression
// 2026-07-21). Derive the page slug ONLY from a page-root URL — a post URL
// (…/posts/pfbid…, /groups/…, /permalink.php, profile.php?id=…) has extra path
// segments or a reserved first segment and must never become an author handle.
const FACEBOOK_NON_PAGE_SEGMENTS = new Set([
  "groups", "watch", "events", "marketplace", "reel", "share", "stories",
  "permalink.php", "story.php", "profile.php", "photo.php", "people",
])

function facebookPageSlug(pageUrl: string | null): string | null {
  if (!pageUrl) return null
  try {
    const parsed = new URL(pageUrl.trim())
    if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return null
    const segments = parsed.pathname.split("/").filter(Boolean)
    if (segments.length !== 1) return null
    const slug = segments[0]
    if (FACEBOOK_NON_PAGE_SEGMENTS.has(slug.toLowerCase())) return null
    return slug
  } catch {
    return null
  }
}

function stableDiscoveryUrlId(url: string): string {
  return crypto.createHash("sha256").update(canonicalProviderUrl(url)).digest("hex").slice(0, 32)
}

/**
 * The term an item was actually found by, when the actor echoes only the
 * input URL it crawled: `?q=<term>` for Instagram keyword search and the
 * native Facebook search, `/explore/tags/<tag>/` for Instagram hashtag mode.
 * Profile and direct-post input URLs carry no term and yield null (#637).
 */
function apifyItemInputUrlTerm(item: JsonRecord): string | null {
  const inputUrl = stringValue(item.inputUrl)
  if (!inputUrl) return null
  try {
    const url = new URL(inputUrl)
    const query = url.searchParams.get("q")?.trim()
    if (query) return query
    const tagMatch = url.pathname.match(/\/explore\/tags\/([^/]+)/)
    if (tagMatch) return decodeURIComponent(tagMatch[1]).trim() || null
  } catch {
    return null
  }
  return null
}

function normalizeApifyItem(
  source: MonitoringSourceForRun,
  run: { phase: string; relativeTimestampBase?: Date; inputSnapshot?: unknown },
  item: JsonRecord,
  index: number,
  terms: string[],
): IngestInput | null {
  const rawText = itemText(item)
  const url = itemUrl(item)
  const comment = run.phase === "EXTRACT_COMMENTS_FROM_CANDIDATES"
  const textlessTikTokVideo = source.platform === "tiktok" && !comment && !rawText
  const text = rawText ?? (textlessTikTokVideo ? "[TikTok video without caption]" : null)
  if (!text || !url) return null
  // The provider query proves only how the candidate was discovered. It is
  // never promoted to matchedTerm when the video's own caption is absent.
  const matchedTerm = textlessTikTokVideo ? null : matchedApifySourceTerm(text, source, terms)
  // Search provenance must name a term the run actually dispatched. Items
  // that echo their own search term win; then the crawled input URL (the
  // Instagram actor's per-item attribution, #637); then the run's frozen
  // input (native actors such as Facebook search echo nothing per item); the
  // configured-term fallback comes last because its keywords-first order can
  // name a term the same run's snapshot records as unsent (#635 review).
  const providerQuery = !comment
    ? stringValue(item.searchQuery)
      || stringValue(record(item.searchQuery).term)
      || stringValue(item.searchTerm)
      || apifyItemInputUrlTerm(item)
      || stringValue(record(run.inputSnapshot).query)
      || providerConfiguredTerms(source)[0]
      || null
    : null
  const itemId = stringValue(item.id)
    || stringValue(item.post_id)
    || stringValue(item.commentId)
    || stringValue(item.cid)
    || (item.__webDiscoveryOrganicResult === true ? `url:${stableDiscoveryUrlId(url)}` : `${index}:${url}`)
  const postUrl = stringValue(item.postUrl)
    || stringValue(item.facebookUrl)
    || stringValue(item.submittedVideoUrl)
    || stringValue(item.input)
    || stringValue(item.videoWebUrl)
    || (comment ? url : null)
  const postExternalId = stringValue(item.postId)
    || stringValue(item.post_id)
    || stringValue(item.videoId)
    || tiktokVideoId(postUrl)
    || tiktokVideoId(url)
  const parentId = stringValue(item.parentCommentId) || stringValue(item.parentId)
  const reply = comment && Boolean(parentId || item.isReply === true)
  const mediaMetadata = itemMediaMetadata(item)
  const authorMeta = record(item.authorMeta)
  const authorProfileUrl = stringValue(authorMeta.profileUrl)
  // Facebook page posts: the page IS the author. Comments keep their commenter
  // fields — the page fallback must never label a commenter with the page name.
  const facebookPagePost = source.platform === "facebook" && !comment
  const pageAuthorName = facebookPagePost
    ? stringValue(item.pageName) || stringValue(record(item.user).name)
    : null
  const pageAuthorHandle = facebookPagePost
    ? facebookPageSlug(stringValue(item.facebookUrl) || stringValue(item.pageUrl))
    : null
  const facebookSearchAuthorHandle = source.platform === "facebook"
    ? facebookPageSlug(nestedString(item, "author", "url"))
    : null
  return {
    organizationId: source.organizationId,
    platform: source.platform,
    externalId: `apify:${itemId}`,
    sourceType: comment ? (reply ? "reply" : "comment") : "mention",
    contentKind: comment ? (reply ? "REPLY" : "COMMENT") : apifyContentKind(source.platform, item, mediaMetadata),
    postExternalId,
    parentExternalId: parentId,
    threadExternalId: stringValue(item.threadId) || postExternalId,
    replyToExternalId: reply ? parentId : null,
    depth: reply ? 1 : 0,
    canonicalUrl: comment && url !== postUrl ? url : null,
    parentPostUrl: comment ? postUrl : null,
    sourceProvider: "search_index",
    sourceMetadata: {
      provider: "apify",
      partialCoverage: true,
      ...mediaMetadata,
      ...(providerQuery ? {
        providerQuery,
        providerQueryProvenance: "apify_search_input",
      } : {}),
      ...(textlessTikTokVideo ? { captionMissing: true } : {}),
      ...(authorProfileUrl ? { authorUrl: authorProfileUrl, profileUrl: authorProfileUrl } : {}),
      ...routeExecutionMetadata(source),
    },
    text,
    sentiment: null,
    matchedTerm,
    engagement: numberValue(item.likesCount)
      ?? numberValue(item.likeCount)
      ?? numberValue(item.reactions_count)
      ?? numberValue(item.diggCount)
      ?? 0,
    reach: numberValue(item.viewCount)
      ?? numberValue(item.playCount)
      ?? numberValue(item.videoPlayCount)
      ?? numberValue(item.videoViewCount)
      ?? numberValue(item.fbPlayCount)
      ?? 0,
    url,
    authorName: stringValue(item.authorName)
      || stringValue(item.ownerFullName)
      || stringValue(record(item.author).name)
      || stringValue(authorMeta.nickName)
      || stringValue(authorMeta.name)
      || pageAuthorName,
    authorHandle: stringValue(item.authorHandle)
      || stringValue(item.ownerUsername)
      || stringValue(item.username)
      || stringValue(item.uniqueId)
      || stringValue(record(item.author).uniqueId)
      || stringValue(authorMeta.name)
      || facebookSearchAuthorHandle
      || pageAuthorHandle,
    authorAvatar: stringValue(item.authorAvatar)
      || stringValue(item.ownerProfilePicUrl)
      || stringValue(item.avatarThumbnail)
      || nestedString(item, "author", "profile_picture_url")
      || stringValue(authorMeta.avatar)
      || stringValue(authorMeta.originalAvatarUrl),
    publishedAt: itemDate(item, item.__webDiscoveryOrganicResult === true ? run.relativeTimestampBase : undefined),
  }
}

type NormalizedApifyDatasetItem = {
  item: JsonRecord
  normalized: IngestInput
  discoveryIdempotencyKey: string | null
}

type ExistingDiscoveryEnvelope = {
  idempotencyKey: string
  sourceId: string | null
  url: string | null
  canonicalUrl: string | null
  subjectDecision: unknown
  providerRun: { inputSnapshot: unknown } | null
}

function sourceTargetSubjectIds(source: MonitoringSourceForRun, targetScenarioId: string): Set<string> {
  const directSubjectId = source.routeExecution?.targetSubjectId?.trim()
  if (directSubjectId) return new Set([directSubjectId])
  const settings = record(source.settings)
  const links = Array.isArray(settings.scenarioLinks) ? settings.scenarioLinks.map(record) : []
  return new Set(links.flatMap(link => (
    stringValue(link.scenarioId) === targetScenarioId && stringValue(link.subjectId)
      ? [stringValue(link.subjectId)!]
      : []
  )))
}

function existingDiscoveryEnvelopeMatchesScope(
  envelope: ExistingDiscoveryEnvelope,
  source: MonitoringSourceForRun,
): boolean {
  if (envelope.sourceId === source.id) return true
  const targetScenarioId = source.routeExecution?.targetScenarioId?.trim()
  if (!targetScenarioId) return false

  const providerInput = record(envelope.providerRun?.inputSnapshot)
  if (stringValue(providerInput.leadDriveTargetScenarioId) === targetScenarioId) return true

  const decision = record(envelope.subjectDecision)
  if (
    stringValue(decision.scenarioId) === targetScenarioId
    || stringList(decision.scenarioIds).includes(targetScenarioId)
  ) return true

  const targetSubjectIds = sourceTargetSubjectIds(source, targetScenarioId)
  if (targetSubjectIds.size === 0 || !Array.isArray(decision.matches)) return false
  return decision.matches.some(rawMatch => {
    const subjectId = stringValue(record(rawMatch).subjectId)
    return Boolean(subjectId && targetSubjectIds.has(subjectId))
  })
}

function discoveryObservationIdempotencyKey(
  source: MonitoringSourceForRun,
  phase: string,
  item: JsonRecord,
  normalized: IngestInput,
): string | null {
  if (phase !== "DISCOVER_CANDIDATE_POSTS" || item.__webDiscoveryOrganicResult !== true || !normalized.url) return null
  // A profile-scoped manual run intentionally executes several spelling and
  // hashtag aliases. Scope the durable URL identity to that profile so those
  // aliases do not create duplicate REVIEW rows, while an unrelated profile
  // in the same tenant can still evaluate the same page independently.
  const scope = source.routeExecution?.targetScenarioId?.trim() || source.id
  const identity = [
    source.organizationId,
    scope,
    source.platform,
    canonicalProviderUrl(normalized.url),
  ].join("\u0000")
  return `apify-discovery-v1:${crypto.createHash("sha256").update(identity).digest("hex")}`
}

function discoveryEvidenceScore(entry: NormalizedApifyDatasetItem, terms: string[]): number {
  const title = stringValue(entry.item.title)
  const titleMatch = title ? findMatchedKeyword(title, terms) : null
  return (entry.normalized.publishedAt ? 1_000_000 : 0)
    + (titleMatch ? 100_000 : 0)
    + (entry.normalized.matchedTerm ? 10_000 : 0)
    + Math.min(entry.normalized.text.length, 9_999)
}

function deduplicateNormalizedDiscoveryItems(
  entries: NormalizedApifyDatasetItem[],
  terms: string[],
): { items: NormalizedApifyDatasetItem[]; duplicateCount: number } {
  const unique: NormalizedApifyDatasetItem[] = []
  const indexByIdentity = new Map<string, number>()
  let duplicateCount = 0
  for (const entry of entries) {
    const identity = entry.discoveryIdempotencyKey
    if (!identity) {
      unique.push(entry)
      continue
    }
    const existingIndex = indexByIdentity.get(identity)
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, unique.length)
      unique.push(entry)
      continue
    }
    duplicateCount += 1
    // Preserve the strongest observation for a repeated SERP URL: an actual
    // date beats a dateless snippet, then a title match beats a snippet-only
    // match. This prevents dedupe from discarding the evidence needed for the
    // freshness and subject gates.
    if (discoveryEvidenceScore(entry, terms) > discoveryEvidenceScore(unique[existingIndex], terms)) {
      unique[existingIndex] = entry
    }
  }
  return { items: unique, duplicateCount }
}

export function apifyDatasetItemError(item: JsonRecord): string | null {
  const error = stringValue(item.error)
  const code = (stringValue(item.errorCode) || error)?.toLowerCase().replace(/[^a-z0-9_]+/g, "_")
  if (!code) return null
  if (
    code === "no_items"
    || code === "search_query_not_found"
    || error?.toLowerCase() === "no videos found for the search query"
  ) {
    const requestErrors = Array.isArray(item.requestErrorMessages)
      ? item.requestErrorMessages.filter((value): value is string => typeof value === "string")
      : []
    if (requestErrors.some(message => /\bblocked\b/i.test(message))) {
      return "apify_provider_blocked"
    }
    return "apify_no_public_items"
  }
  return `apify_dataset_item_${code}`
}

function apifyActorResultCapReached(
  run: { actorId: string | null; maxItems: number },
  remote: JsonRecord,
  receivedCount: number,
): boolean {
  const statusMessage = stringValue(remote.statusMessage)?.toLocaleLowerCase() ?? ""
  if (!statusMessage) return false

  if (run.actorId === APIFY_FACEBOOK_SEARCH_ACTOR) {
    const freePlanRestriction = /(free plan|free tier)/.test(statusMessage)
      && /(limit|reduc|max_results|20 results|24 hours?|retry)/.test(statusMessage)
    const explicitCap = /max_results.{0,50}(?:reduc|limit|cap)/.test(statusMessage)
      || /(?:result|run).{0,30}(?:limit|quota).{0,30}(?:reach|exceed)/.test(statusMessage)
      || /(?:retry|next run).{0,50}(?:24 hours?|available|at )/.test(statusMessage)
    return freePlanRestriction
      || explicitCap
      || (run.maxItems > 20 && receivedCount === 20 && /\b20\b/.test(statusMessage))
  }

  if (run.actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR) {
    // This Actor's public contract says free usage only covers the first
    // results page. Apify can expose plan enforcement through statusMessage
    // even when the run itself terminalizes as SUCCEEDED. Preserve the cursor
    // on that signal so an upgraded/retried run covers the same window.
    const freeFirstPageRestriction = /(free plan|free tier|free usage)/.test(statusMessage)
      && /(first page|one page|upgrade|page limit|result limit|quota)/.test(statusMessage)
    const explicitPageCap = /(?:page|result).{0,40}(?:limit|quota).{0,40}(?:reach|exceed)/.test(statusMessage)
      || /upgrade.{0,50}(?:more|additional|all|next).{0,30}(?:page|result)/.test(statusMessage)
    return freeFirstPageRestriction || explicitPageCap
  }

  return false
}

export function apifyInputResultCeiling(
  actorId: string | null,
  inputSnapshot: unknown,
  runMaxItems: number,
): number {
  const input = record(inputSnapshot)
  if (actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR) {
    const termCount = stringList(input.hashtags).length
    const resultsLimit = numberValue(input.resultsLimit)
    if (termCount > 0 && resultsLimit !== null && resultsLimit > 0) {
      return Math.min(runMaxItems, termCount * Math.trunc(resultsLimit))
    }
  }
  if (actorId === APIFY_TIKTOK_SEARCH_ACTOR) {
    const termCount = stringList(input.searchQueries).length
    const resultsPerPage = numberValue(input.resultsPerPage)
    if (termCount > 0 && resultsPerPage !== null && resultsPerPage > 0) {
      return Math.min(runMaxItems, termCount * Math.trunc(resultsPerPage))
    }
  }
  if (actorId === APIFY_GOOGLE_SEARCH_ACTOR) {
    const queryCount = (stringValue(input.queries) ?? "")
      .split("\n")
      .map(query => query.trim())
      .filter(Boolean)
      .length
    const maxPagesPerQuery = numberValue(input.maxPagesPerQuery)
    const resultsPerPage = numberValue(input.resultsPerPage)
    if (
      queryCount > 0
      && maxPagesPerQuery !== null
      && maxPagesPerQuery > 0
      && resultsPerPage !== null
      && resultsPerPage > 0
    ) {
      return Math.min(
        runMaxItems,
        queryCount * Math.trunc(maxPagesPerQuery) * Math.trunc(resultsPerPage),
      )
    }
  }
  return runMaxItems
}

/**
 * Detect a provider-side ceiling before discovery payloads are flattened or
 * filtered to platform URLs. Aggregate counts are insufficient for batched
 * searches: one popular Instagram term can fill its own quota while every
 * other term is empty, and one full Google SERP can contain only a single
 * Facebook/Instagram URL.
 */
export function apifyPerInputResultLimitReached(
  actorId: string | null,
  inputSnapshot: unknown,
  rawPayload: unknown[],
): boolean {
  const input = record(inputSnapshot)
  // #638: у бренд-веера насыщение алиасного слота — приемлемая потеря хвоста,
  // а не сигнал заморозить курсор. Иначе первый же алиас с бэклогом навсегда
  // оставляет прогоны в PARTIAL, и каждая каденция заново выкупает уже
  // покрытое окно канонического термина.
  const fanOutAliasIdentities = new Set(
    stringList(input.leadDriveSearchFanOutAliasTerms).map(normalizedTermIdentity),
  )
  if (actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR) {
    const resultsLimit = numberValue(input.resultsLimit)
    if (resultsLimit === null || resultsLimit <= 0) return false
    const perTermLimit = Math.max(1, Math.trunc(resultsLimit))
    const termCount = stringList(input.hashtags).length
    const perInputCounts = new Map<string, number>()
    let contentCount = 0
    let attributedCount = 0
    for (const rawItem of rawPayload) {
      const item = record(rawItem)
      if (apifyDatasetItemError(item)) continue
      contentCount += 1
      const inputUrl = stringValue(item.inputUrl)
      if (!inputUrl) continue
      attributedCount += 1
      const key = canonicalProviderUrl(inputUrl).normalize("NFKC").toLocaleLowerCase()
      const count = (perInputCounts.get(key) ?? 0) + 1
      if (count >= perTermLimit) {
        const term = apifyItemInputUrlTerm(item)
        if (!term || !fanOutAliasIdentities.has(normalizedTermIdentity(term))) return true
      }
      perInputCounts.set(key, count)
    }
    // Полная пер-элементная атрибуция уже дала точный ответ: насыщались только
    // алиасные слоты. Пигеонхол ниже сложил бы их обратно в общий счётчик.
    if (fanOutAliasIdentities.size > 0 && attributedCount === contentCount) return false
    // Older Actor output may omit inputUrl. This pigeonhole fallback is exact:
    // with N inputs capped at L, more than N*(L-1) content rows guarantees at
    // least one input reached L.
    return termCount > 0 && contentCount > termCount * (perTermLimit - 1)
  }

  if (actorId === APIFY_TIKTOK_SEARCH_ACTOR) {
    const termCount = stringList(input.searchQueries).length
    const resultsPerPage = numberValue(input.resultsPerPage)
    if (termCount === 0 || resultsPerPage === null || resultsPerPage <= 0) return false
    const perTermLimit = Math.max(1, Math.trunc(resultsPerPage))
    const perTermCounts = new Map<string, number>()
    let contentCount = 0
    let attributedCount = 0
    for (const rawItem of rawPayload) {
      const item = record(rawItem)
      if (apifyDatasetItemError(item)) continue
      contentCount += 1
      // Та же цепочка атрибуции термина, что у провенанса находок в
      // normalizeApifyItem: собственное эхо запроса, затем краулерный URL.
      const term = stringValue(item.searchQuery)
        || stringValue(record(item.searchQuery).term)
        || stringValue(item.searchTerm)
        || apifyItemInputUrlTerm(item)
      if (!term) continue
      attributedCount += 1
      const identity = normalizedTermIdentity(term)
      const count = (perTermCounts.get(identity) ?? 0) + 1
      if (count >= perTermLimit && !fanOutAliasIdentities.has(identity)) return true
      perTermCounts.set(identity, count)
    }
    if (fanOutAliasIdentities.size > 0 && attributedCount === contentCount) return false
    return contentCount > termCount * (perTermLimit - 1)
  }

  if (actorId === APIFY_GOOGLE_SEARCH_ACTOR) {
    const maxPagesPerQuery = numberValue(input.maxPagesPerQuery)
    const resultsPerPage = numberValue(input.resultsPerPage)
    if (
      maxPagesPerQuery === null
      || maxPagesPerQuery <= 0
      || resultsPerPage === null
      || resultsPerPage <= 0
    ) return false
    const pageLimit = Math.max(1, Math.trunc(maxPagesPerQuery))
    const resultLimit = Math.max(1, Math.trunc(resultsPerPage))
    const queryPages = new Map<string, Array<{
      page: number
      organicCount: number
      hasNextPage: boolean
    }>>()
    let totalRawOrganicCount = 0
    for (const rawPage of rawPayload) {
      const page = record(rawPage)
      const searchQuery = record(page.searchQuery)
      const organicCount = Array.isArray(page.organicResults) ? page.organicResults.length : 0
      totalRawOrganicCount += organicCount
      const term = stringValue(searchQuery.term)
        || stringValue(searchQuery.query)
        || stringValue(page.searchTerm)
      if (!term) continue
      const pages = queryPages.get(term) ?? []
      const pageNumber = numberValue(searchQuery.page)
      pages.push({
        page: pageNumber === null ? pages.length + 1 : Math.max(1, Math.trunc(pageNumber)),
        organicCount,
        hasNextPage: page.hasNextPage === true,
      })
      queryPages.set(term, pages)
    }
    for (const pages of queryPages.values()) {
      const lastConfiguredPage = pages
        .filter(page => page.page >= pageLimit)
        .sort((left, right) => right.page - left.page)[0]
      // A sparse final page without pagination evidence normally means the
      // query was exhausted. Keep the cursor only when the raw SERP filled its
      // per-page allowance or explicitly reports another page.
      if (
        lastConfiguredPage
        && (
          lastConfiguredPage.hasNextPage
          || lastConfiguredPage.organicCount >= resultLimit
        )
      ) return true
      const rawOrganicCount = pages.reduce((sum, page) => sum + page.organicCount, 0)
      if (rawOrganicCount >= pageLimit * resultLimit) return true
    }
    const queryCount = (stringValue(input.queries) ?? "")
      .split("\n")
      .map(query => query.trim())
      .filter(Boolean)
      .length
    if (
      queryCount > 0
      // Covers legacy and mixed payloads where only some rows identify their
      // query. Across N queries, more than N*(cap-1) raw results guarantees
      // that at least one query reached its configured ceiling.
      && totalRawOrganicCount > queryCount * (pageLimit * resultLimit - 1)
    ) return true
  }

  return false
}

type PhysicalRouteSignatureInput = {
  capability?: string | null
  contentScope?: string | null
  primaryAdapter?: string | null
  fallbackAdapters?: string[] | null
  capabilityProofId?: string | null
  connectionAccountId?: string | null
  acquisitionMode?: string | null
  dependsOnCapability?: string | null
  budget?: unknown
  rateLimit?: unknown
}

/**
 * Keep async route health aligned with the physical-route grouping used by the
 * synchronous collector. Scenario aliases may persist several logical plans
 * for one provider request; updating only the representative plan can let an
 * ACTIVE alias immediately bypass the newly opened circuit.
 */
function physicalRouteSignature(plan: PhysicalRouteSignatureInput): string {
  return JSON.stringify({
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
}

async function physicalRoutePlanIds(run: {
  organizationId: string
  sourceId: string
  routePlanId: string
  routePlan: PhysicalRouteSignatureInput
}): Promise<string[]> {
  try {
    const candidates: Array<PhysicalRouteSignatureInput & { id: string }> = await prisma.sourceRoutePlan.findMany({
      where: {
        organizationId: run.organizationId,
        sourceId: run.sourceId,
        capability: run.routePlan.capability ?? undefined,
        status: { in: ["ACTIVE", "DEGRADED"] },
      },
      select: {
        id: true,
        capability: true,
        contentScope: true,
        primaryAdapter: true,
        fallbackAdapters: true,
        capabilityProofId: true,
        connectionAccountId: true,
        acquisitionMode: true,
        dependsOnCapability: true,
        budget: true,
        rateLimit: true,
      },
    })
    const expected = physicalRouteSignature(run.routePlan)
    return Array.from(new Set([
      run.routePlanId,
      ...candidates
        .filter(candidate => physicalRouteSignature(candidate) === expected)
        .map(candidate => candidate.id),
    ]))
  } catch (error) {
    console.error("[social-monitoring] Apify physical route alias lookup failed", error)
    return [run.routePlanId]
  }
}

export async function importApifyProviderRun(providerRunId: string): Promise<{ status: string; imported: number; error?: string }> {
  const run = await prisma.socialProviderRun.findUnique({
    where: { id: providerRunId },
    include: { source: true, routePlan: true },
  })
  if (!run || run.providerKey !== APIFY_PROVIDER) return { status: "BLOCKED", imported: 0, error: "apify_run_not_found" }
  if (run.status === "PARTIAL" && run.importedAt) {
    await settleStableApifyCharge(run).catch(error => {
      console.error("[social-monitoring] Apify charge settlement failed", error)
    })
    if (
      record(run.inputSnapshot)[DEPENDENT_COMMENTS_PENDING_MARKER] === true
      || record(run.inputSnapshot)[DEPENDENT_INSTAGRAM_REELS_PENDING_MARKER] === true
      || record(run.inputSnapshot)[DEPENDENT_FACEBOOK_FAN_OUT_PENDING_MARKER] === true
    ) {
      await dispatchDependentApifyRuns(run)
    }
    return {
      status: run.status,
      imported: run.acceptedCount,
      ...(run.lastError ? { error: run.lastError } : {}),
    }
  }
  if (run.status === "IMPORTED") {
    await settleStableApifyCharge(run).catch(error => {
      console.error("[social-monitoring] Apify charge settlement failed", error)
    })
    const importedSnapshot = record(run.inputSnapshot)
    const pairedPostsMember = run.source?.platform === "instagram"
      && run.actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR
      && stringValue(importedSnapshot.leadDriveInstagramResultsType) === "posts"
      && numberValue(record(importedSnapshot.leadDriveInstagramReelsBudget).maxItems) !== null
    await dispatchDependentApifyRuns(run, {
      includeUnmarkedComments: !pairedPostsMember,
    })
    return { status: run.status, imported: run.acceptedCount }
  }
  if (run.status === "FAILED" || run.status === "PURGED") {
    await settleStableApifyCharge(run).catch(error => {
      console.error("[social-monitoring] Apify charge settlement failed", error)
    })
    return {
      status: run.status,
      imported: run.acceptedCount,
      ...(run.lastError ? { error: run.lastError } : {}),
    }
  }
  if (run.status === "IMPORTING") {
    const leaseStartedAt = run.finishedAt ?? run.createdAt
    const leaseMs = Math.max(
      APIFY_IMPORT_LEASE_MIN_MS,
      Math.max(30, run.timeoutSeconds) * 2_000,
    )
    if (Date.now() < leaseStartedAt.getTime() + leaseMs) {
      return { status: "IMPORTING", imported: run.acceptedCount }
    }
  }
  if (!run.externalRunId) {
    if (run.status === "QUEUED") {
      const expiresAt = run.createdAt.getTime() + Math.max(30, run.timeoutSeconds) * 1_000 + 5 * 60_000
      if (Date.now() >= expiresAt) {
        // A process can die after reserving budget but before the fenced
        // dispatch claim. Only an exact durable false marker proves that no
        // paid request left LeadDrive, so only that shape may release money.
        // Legacy rows with a missing marker, or anomalous true/QUEUED rows,
        // keep their exposure conservatively.
        const exactUndispatched = record(run.inputSnapshot).providerRequestDispatched === false
          && (databaseMoneyValue(run.actualChargeUsd) ?? 0) <= 0
        if (exactUndispatched) {
          const released = await releaseUndispatchedApifyReservation(
            { id: run.id, organizationId: run.organizationId },
            "apify_queued_dispatch_unreconciled",
          )
          if (released) {
            return {
              status: "BLOCKED",
              imported: 0,
              error: "apify_queued_dispatch_unreconciled",
            }
          }
        }
        await prisma.socialProviderRun.updateMany({
          where: {
            id: run.id,
            organizationId: run.organizationId,
            providerKey: APIFY_PROVIDER,
            purgedAt: null,
            status: "QUEUED",
          },
          data: {
            status: "BLOCKED",
            lastError: "apify_queued_dispatch_unreconciled",
            finishedAt: new Date(),
          },
        })
        return {
          status: "BLOCKED",
          imported: 0,
          error: "apify_queued_dispatch_unreconciled",
        }
      }
    }
    if (run.lastError === "apify_start_dispatch_unknown") {
      const startedAt = run.startedAt ?? run.createdAt
      const expiresAt = startedAt.getTime() + Math.max(30, run.timeoutSeconds) * 1_000 + 5 * 60_000
      if (Date.now() >= expiresAt) {
        await prisma.socialProviderRun.updateMany({
          where: {
            id: run.id,
            organizationId: run.organizationId,
            providerKey: APIFY_PROVIDER,
            purgedAt: null,
            status: run.status,
          },
          data: {
            status: "BLOCKED",
            lastError: "apify_start_dispatch_unreconciled",
            finishedAt: new Date(),
          },
        })
        return {
          status: "BLOCKED",
          imported: 0,
          error: "apify_start_dispatch_unreconciled",
        }
      }
    }
    return { status: run.status, imported: 0, error: "apify_external_run_missing" }
  }
  const token = await apifyToken(run.organizationId)
  if (!token) return { status: "BLOCKED", imported: 0, error: "apify_token_missing" }
  const response = await fetch(`${APIFY_API}/actor-runs/${encodeURIComponent(run.externalRunId)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
  if (!response.ok) return { status: run.status, imported: 0, error: `apify_run_status_${response.status}` }
  const body = await response.json() as { data?: JsonRecord }
  const remote = record(body.data)
  // Cost freshness belongs to this provider response, not to the time spent
  // downloading and importing its dataset. Reusing a preliminary terminal
  // value after a long import could otherwise make a fresh zero look stable
  // and release the reservation too early.
  const remoteObservedAt = new Date()
  const remoteStatus = stringValue(remote.status) || "UNKNOWN"
  const datasetId = stringValue(remote.defaultDatasetId) || run.datasetId
  // Актор может умереть, успев собрать и выставить в счёт сотни записей
  // (прод 2026-08-03: пять прогонов по ~$1 каждый, набор данных на месте, а
  // мы его выбрасывали). Оплаченные записи забираем: прогон всё равно
  // останется PARTIAL, поэтому курсор не сдвинется и окно перечитается.
  // У фазы комментариев остаётся прежний путь: там отказ ведёт свой
  // чекпойнт-бэкофф, и подмешивать в него частичный набор нельзя.
  const recoverableProviderFailure = TERMINAL_FAILURE.has(remoteStatus)
    && Boolean(datasetId)
    && run.phase === "DISCOVER_CANDIDATE_POSTS"
    ? `apify_${remoteStatus.toLowerCase()}`
    : null
  if (TERMINAL_FAILURE.has(remoteStatus) && !recoverableProviderFailure) {
    const failedAt = new Date()
    const failure = `apify_${remoteStatus.toLowerCase()}`
    const actualCharge = stableApifyActualCharge(remote, remoteObservedAt)
    await prisma.socialProviderRun.updateMany({
      where: {
        id: run.id,
        organizationId: run.organizationId,
        providerKey: APIFY_PROVIDER,
        purgedAt: null,
        status: run.status,
      },
      data: {
        status: "FAILED",
        lastError: failure,
        finishedAt: failedAt,
        // Missing provider usage is not proof of a free run. Preserve the
        // bounded reservation so a malformed terminal payload cannot reopen
        // daily/monthly spend capacity.
        ...(actualCharge !== null
          ? { reservedChargeUsd: 0, actualChargeUsd: actualCharge }
          : {}),
      },
    })
    if (run.phase === "EXTRACT_COMMENTS_FROM_CANDIDATES" && ["instagram", "facebook"].includes(run.source.platform)) {
      await recordCommentCheckpointBatch({
        organizationId: run.organizationId,
        sourceId: run.sourceId,
        urls: commentParentUrlsFromSnapshot(run.source.platform, run.inputSnapshot),
        providerRunId: run.id,
        coverageClass: "FAILED",
        error: failure,
        successful: false,
        now: failedAt,
      }).catch(error => console.error("[social-monitoring] comment checkpoint failure backoff failed", error))
    }
    return { status: "FAILED", imported: 0, error: failure }
  }
  if (!TERMINAL_SUCCESS.has(remoteStatus) && !recoverableProviderFailure) {
    await prisma.socialProviderRun.updateMany({
      where: {
        id: run.id,
        organizationId: run.organizationId,
        providerKey: APIFY_PROVIDER,
        purgedAt: null,
        status: run.status,
      },
      data: { status: "RUNNING", datasetId },
    })
    return { status: "RUNNING", imported: 0 }
  }
  if (!datasetId) {
    const actualCharge = stableApifyActualCharge(remote, remoteObservedAt)
    await prisma.socialProviderRun.updateMany({
      where: {
        id: run.id,
        organizationId: run.organizationId,
        providerKey: APIFY_PROVIDER,
        purgedAt: null,
        status: run.status,
      },
      data: {
        status: "FAILED",
        lastError: "apify_dataset_missing",
        finishedAt: new Date(),
        ...(actualCharge !== null
          ? { actualChargeUsd: actualCharge, reservedChargeUsd: 0 }
          : {}),
      },
    })
    return { status: "FAILED", imported: 0, error: "apify_dataset_missing" }
  }
  const importClaimedAt = new Date()
  const claimFence = await withSocialMonitoringImportFence({
    organizationId: run.organizationId,
    providerRunId: run.id,
    providerKey: APIFY_PROVIDER,
    expectedStatuses: run.status === "IMPORTING"
      ? ["IMPORTING"]
      : ["QUEUED", "RUNNING", "SUCCEEDED"],
  }, async () => prisma.socialProviderRun.updateMany({
      where: run.status === "IMPORTING"
        ? {
            id: run.id,
            organizationId: run.organizationId,
            providerKey: APIFY_PROVIDER,
            purgedAt: null,
            status: "IMPORTING",
            finishedAt: run.finishedAt ?? null,
          }
        : {
            id: run.id,
            organizationId: run.organizationId,
            providerKey: APIFY_PROVIDER,
            purgedAt: null,
            status: { in: ["QUEUED", "RUNNING", "SUCCEEDED"] },
          },
      data: {
        status: "IMPORTING",
        datasetId,
        finishedAt: importClaimedAt,
      },
    }),
  )
  if (!claimFence.allowed) {
    return { status: "BLOCKED", imported: 0, error: claimFence.reason }
  }
  const importClaim = claimFence.value
  if (importClaim.count !== 1) {
    const current = await prisma.socialProviderRun.findUnique({
      where: { id: run.id },
      select: {
        status: true,
        acceptedCount: true,
        lastError: true,
      },
    })
    return {
      status: current?.status ?? "IMPORTING",
      imported: current?.acceptedCount ?? 0,
      ...(current?.lastError ? { error: current.lastError } : {}),
    }
  }
  const itemsResponse = await fetch(`${APIFY_API}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${run.maxItems}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
  if (!itemsResponse.ok) return { status: "IMPORTING", imported: 0, error: `apify_dataset_${itemsResponse.status}` }
  const payload = await itemsResponse.json()
  if (!Array.isArray(payload)) {
    const actualCharge = stableApifyActualCharge(remote, remoteObservedAt)
    await prisma.socialProviderRun.updateMany({
      where: {
        id: run.id,
        organizationId: run.organizationId,
        providerKey: APIFY_PROVIDER,
        purgedAt: null,
        status: "IMPORTING",
      },
      data: {
        status: "FAILED",
        lastError: "apify_schema_drift_non_array",
        finishedAt: new Date(),
        ...(actualCharge !== null
          ? { actualChargeUsd: actualCharge, reservedChargeUsd: 0 }
          : {}),
      },
    })
    return { status: "FAILED", imported: 0, error: "apify_schema_drift_non_array" }
  }
  const persistenceFence = await withSocialMonitoringImportFence({
    organizationId: run.organizationId,
    providerRunId: run.id,
    providerKey: APIFY_PROVIDER,
    expectedStatuses: ["IMPORTING"],
  }, async () => {
  const frozenCursorScope = providerCursorScopeFromSnapshot(run.inputSnapshot, {
    routePlanId: run.routePlanId,
    adapterKey: run.adapterKey,
  })
  const frozenArchiveStartAt = frozenCursorScope.archiveStartAt instanceof Date
    ? frozenCursorScope.archiveStartAt.toISOString()
    : frozenCursorScope.archiveStartAt
  const source = {
    ...run.source,
    routeExecution: {
      collectorRunId: run.collectorRunId ?? "provider-reconcile",
      routePlanId: run.routePlanId,
      capability: run.routePlan.capability,
      adapterKey: run.adapterKey,
      acquisitionMode: run.routePlan.acquisitionMode,
      providerKey: APIFY_PROVIDER,
      providerRunId: run.id,
      maxItems: run.maxItems,
      timeoutSeconds: run.timeoutSeconds,
      manualPaidRun: record(run.inputSnapshot).leadDriveManualPaidRun === true,
      manualMaxTotalChargeUsd: numberValue(record(run.inputSnapshot).operatorAuthorizedMaxTotalChargeUsd) ?? undefined,
      clientFundedManual: record(run.inputSnapshot).leadDriveClientFundedManual === true,
      fullArchiveRun: frozenCursorScope.fullArchiveRun === true,
      targetScenarioId: frozenCursorScope.targetScenarioId ?? undefined,
      targetSubjectId: stringValue(record(run.inputSnapshot).leadDriveTargetSubjectId) || undefined,
      ...(frozenArchiveStartAt !== undefined
        ? { archiveStartAt: frozenArchiveStartAt }
        : {}),
      suppressDependentPaidRuns: record(run.inputSnapshot).leadDriveSuppressDependentPaidRuns === true,
      dependentCommentsAuthorized:
        record(run.inputSnapshot).leadDriveDependentCommentsAuthorized === true,
      dependentCommentsMaxTotalChargeUsd:
        numberValue(record(run.inputSnapshot).leadDriveDependentCommentsMaxTotalChargeUsd) ?? undefined,
      sourceAuthorizedMaxTotalChargeUsd:
        numberValue(record(run.inputSnapshot).leadDriveSourceAuthorizedMaxTotalChargeUsd) ?? undefined,
      discoveryMaxTotalChargeUsd:
        numberValue(record(run.inputSnapshot).leadDriveDiscoveryMaxTotalChargeUsd) ?? undefined,
    },
  } as MonitoringSourceForRun
  const providerItems = expandCommentPayload(
    expandDiscoveryPayload(payload, source, stringValue(run.actorId)),
    source,
    run.phase,
  )
  const terms = sourceTerms(source)
  const lookbackWindow = providerWindowFromSnapshot(run.inputSnapshot)
    ?? discoveryProviderWindow(source, discoveryLookbackWindow(source, run.createdAt))
  let acceptedCount = 0
  let reviewCount = 0
  let rejectedCount = 0
  let duplicateCount = 0
  let invalidCount = 0
  let providerErrorCount = 0
  let noPublicItemsCount = 0
  let providerBlockedCount = 0
  const observedCommentCounts = new Map<string, number>()
  const latestCommentExternalIds = new Map<string, string>()
  const commentActivityUrls = new Set<string>()
  const rawNormalizedItems: NormalizedApifyDatasetItem[] = []
  for (let index = 0; index < providerItems.length; index += 1) {
    const item = providerItems[index]
    const providerError = apifyDatasetItemError(item)
    if (providerError) {
      providerErrorCount += 1
      if (providerError === "apify_no_public_items") noPublicItemsCount += 1
      if (providerError === "apify_provider_blocked") providerBlockedCount += 1
      continue
    }
    const normalized = normalizeApifyItem(source, {
      phase: run.phase,
      // Use the frozen provider window, not webhook/import wall time. A
      // delayed webhook must not make the same "2 days ago" result appear
      // newer or older depending on when reconciliation happened.
      relativeTimestampBase: lookbackWindow.until,
      // The frozen dispatched input is the authoritative record of what was
      // searched; provenance stamping reads its singular query.
      inputSnapshot: run.inputSnapshot,
    }, item, index, terms)
    if (!normalized) { invalidCount += 1; continue }
    if (run.phase === "EXTRACT_COMMENTS_FROM_CANDIDATES" && normalized.parentPostUrl) {
      const parentUrl = canonicalProviderUrl(normalized.parentPostUrl)
      observedCommentCounts.set(parentUrl, (observedCommentCounts.get(parentUrl) ?? 0) + 1)
      if (!latestCommentExternalIds.has(parentUrl)) latestCommentExternalIds.set(parentUrl, normalized.externalId)
    }
    rawNormalizedItems.push({
      item,
      normalized,
      discoveryIdempotencyKey: discoveryObservationIdempotencyKey(source, run.phase, item, normalized),
    })
  }
  const deduplicated = deduplicateNormalizedDiscoveryItems(rawNormalizedItems, terms)
  const normalizedItems = deduplicated.items
  duplicateCount += deduplicated.duplicateCount
  const durableDiscoveryKeys = normalizedItems
    .map(entry => entry.discoveryIdempotencyKey)
    .filter((value): value is string => Boolean(value))
  const discoveryUrls = Array.from(new Set(normalizedItems.flatMap(entry => {
    if (!entry.discoveryIdempotencyKey || !entry.normalized.url) return []
    return [entry.normalized.url, canonicalProviderUrl(entry.normalized.url)]
  })))
  const existingDiscoveryEnvelopes = durableDiscoveryKeys.length > 0
    ? await prisma.ingestEnvelope.findMany({
        where: {
          organizationId: run.organizationId,
          OR: [
            { idempotencyKey: { in: durableDiscoveryKeys } },
            { canonicalUrl: { in: discoveryUrls } },
            { url: { in: discoveryUrls } },
          ],
        },
        select: {
          idempotencyKey: true,
          sourceId: true,
          url: true,
          canonicalUrl: true,
          subjectDecision: true,
          providerRun: { select: { inputSnapshot: true } },
        },
      }) as ExistingDiscoveryEnvelope[]
    : []
  // New keys are already profile-scoped and remain duplicates even after
  // retention purge. URL matching additionally recognizes pre-v1 envelopes
  // (including the existing Baku REVIEW backlog) within the same source,
  // scenario or subject so the first post-deploy run cannot recreate them.
  const existingDiscoveryKeys = new Set(existingDiscoveryEnvelopes
    .filter(envelope => durableDiscoveryKeys.includes(envelope.idempotencyKey))
    .map(envelope => envelope.idempotencyKey))
  const existingScopedDiscoveryUrls = new Set(existingDiscoveryEnvelopes
    .filter(envelope => existingDiscoveryEnvelopeMatchesScope(envelope, source))
    .flatMap(envelope => [envelope.url, envelope.canonicalUrl])
    .filter((value): value is string => Boolean(value))
    .map(canonicalProviderUrl))
  const persistImportProgress = async (): Promise<void> => {
    try {
      await prisma.socialProviderRun.updateMany({
        where: {
          id: run.id,
          organizationId: run.organizationId,
          providerKey: APIFY_PROVIDER,
          purgedAt: null,
          status: "IMPORTING",
        },
        data: {
          status: "IMPORTING",
          // Heartbeat the compare-and-set import lease so a large
          // client-funded dataset cannot be reclaimed while its winner is
          // still durably ingesting rows.
          finishedAt: new Date(),
          receivedCount: providerItems.length,
          acceptedCount,
          reviewCount,
          rejectedCount: rejectedCount + invalidCount + providerErrorCount,
          duplicateCount,
        },
      })
    } catch (error) {
      // Progress is observational. A transient counter write must not discard
      // provider evidence; the terminal update below remains authoritative.
      console.error("[social-monitoring] Apify import progress update failed", error)
    }
  }
  await persistImportProgress()
  let processedNormalizedItems = 0
  const markNormalizedItemProcessed = async (): Promise<void> => {
    processedNormalizedItems += 1
    if (
      processedNormalizedItems % APIFY_IMPORT_PROGRESS_BATCH_SIZE === 0
      || processedNormalizedItems === normalizedItems.length
    ) {
      await persistImportProgress()
    }
  }
  // Resolve parent posts once per batch. Verified context gates signal-based
  // acceptance; a negative MATCHED parent authorizes complete thread capture
  // downstream, while other neutral comments stay in human review. Parent
  // context never fabricates the comment's matchedTerm.
  const parentContexts = run.phase === "EXTRACT_COMMENTS_FROM_CANDIDATES"
    ? await parentMatchContextsForComments(
        run.organizationId,
        source.platform,
        normalizedItems.map(entry => entry.normalized.parentPostUrl).filter((url): url is string => Boolean(url)),
        normalizedItems.map(entry => entry.normalized.postExternalId).filter((id): id is string => Boolean(id)),
      )
    : new Map<string, ParentMatchContext>()
  const parentContextFor = (
    parentPostUrl: string | null | undefined,
    postExternalId: string | null | undefined,
  ): ParentMatchContext | null => (
    (postExternalId ? parentContexts.get(postExternalId) : null)
    ?? (parentPostUrl
      ? parentContexts.get(parentPostUrl)
      ?? parentContexts.get(canonicalProviderUrl(parentPostUrl))
      ?? null
      : null)
  )
  const commentDecisions = new Map(run.phase === "EXTRACT_COMMENTS_FROM_CANDIDATES"
    ? classifySocialCommentThread(normalizedItems.map(({ normalized }) => ({
        externalId: normalized.externalId,
        parentExternalId: normalized.parentExternalId ? `apify:${normalized.parentExternalId.replace(/^apify:/, "")}` : null,
        matchedTerm: normalized.matchedTerm,
        // A complaint, question, urgency or lead signal is actionable without
        // repeating the brand only when the parent is a verified matched or
        // official-brand publication.
        engagementSignal: Boolean(parentContextFor(normalized.parentPostUrl, normalized.postExternalId))
          && hasCommentEngagementSignal(normalized.text),
      }))).map(decision => [decision.externalId, decision] as const)
    : [])
  for (const { item, normalized, discoveryIdempotencyKey } of normalizedItems) {
    if (
      discoveryIdempotencyKey
      && (
        existingDiscoveryKeys.has(discoveryIdempotencyKey)
        || (
          normalized.url
          && existingScopedDiscoveryUrls.has(canonicalProviderUrl(normalized.url))
        )
      )
    ) {
      duplicateCount += 1
      await markNormalizedItemProcessed()
      continue
    }
    const commentDecision = commentDecisions.get(normalized.externalId)
    const parentContext = parentContextFor(normalized.parentPostUrl, normalized.postExternalId)
    const reviewNeutralCommentOnVerifiedParent = Boolean(
      parentContext && commentDecision?.classification === "REJECTED",
    )
    const review = discoveryReviewDecision({
      phase: run.phase,
      platform: source.platform,
      webDiscoveryOrganicResult: item.__webDiscoveryOrganicResult === true,
      publishedAt: normalized.publishedAt ?? null,
      lookbackWindow,
      title: stringValue(item.title),
      terms,
      matchedTerm: normalized.matchedTerm ?? null,
      textlessTikTokVideo: normalized.sourceMetadata?.captionMissing === true,
    })
    const explicitReview = reviewNeutralCommentOnVerifiedParent
      || commentDecision?.classification === "CONTEXT"
      || review?.relevanceStatus === "REVIEW"
    const providerItemId = stringValue(item.id) || stringValue(item.commentId) || normalized.externalId
    const observation = observationContextForCollector(source, {
      providerItemId,
      idempotencyKey: discoveryIdempotencyKey
        ?? targetScopedObservationIdempotencyKey(source, providerItemId),
      rawPayload: item,
      requireMatchedTerm: commentDecision
        ? commentDecision.reason === "OWN_TENANT_TERM"
          || (commentDecision.classification === "REJECTED" && !reviewNeutralCommentOnVerifiedParent)
        : true,
      ...(commentDecision?.classification === "CONTEXT"
        ? { relevanceStatus: "REVIEW" as const, relevanceReason: "thread_context_for_actionable_descendant", relevanceConfidence: 1 }
        : commentDecision?.reason === "REPLY_TO_ACTIONABLE_COMMENT"
          ? { relevanceStatus: "ACCEPTED" as const, relevanceReason: "reply_to_actionable_comment", relevanceConfidence: 1 }
          : commentDecision?.reason === "ENGAGEMENT_SIGNAL"
            ? { relevanceStatus: "ACCEPTED" as const, relevanceReason: "engagement_signal_on_matched_parent", relevanceConfidence: 1 }
          : reviewNeutralCommentOnVerifiedParent
            ? { relevanceStatus: "REVIEW" as const, relevanceReason: "comment_on_verified_brand_parent", relevanceConfidence: 0.4 }
          : review
            ? {
              relevanceStatus: review.relevanceStatus,
              relevanceReason: review.reason,
              relevanceConfidence: review.relevanceStatus === "REVIEW" ? 0.4 : 1,
            }
            : {}),
      ...(commentDecision || run.phase === "DISCOVER_CANDIDATE_POSTS" ? {
        policySnapshot: {
          ...(commentDecision ? {
            version: SOCIAL_COMMENT_RELEVANCE_VERSION,
            commentRelevanceClassification: commentDecision.classification,
            commentRelevanceReason: commentDecision.reason,
          } : {
            version: "social-monitoring-v2-pr2",
            decisionSource: "observation-boundary",
          }),
          ...(run.phase === "DISCOVER_CANDIDATE_POSTS" ? {
            leadDriveProviderWindow: {
              since: lookbackWindow.since.toISOString(),
              until: lookbackWindow.until.toISOString(),
            },
          } : {}),
        },
      } : {}),
    })
    const result = await ingestMentionWithResult({
      ...normalized,
      ...(parentContext ? { parentMatchContext: parentContext } : {}),
      sentiment: null,
      observation,
    })
    if (result.accepted === false) {
      if (explicitReview || result.relevanceStatus === "REVIEW") reviewCount += 1
      else rejectedCount += 1
      await markNormalizedItemProcessed()
      continue
    }
    if (
      run.phase === "DISCOVER_CANDIDATE_POSTS"
      && source.platform === "tiktok"
    ) {
      const settings = record(source.settings)
      const negativeTerms = stringList(settings.negativeTerms)
      const decision = decideTikTokPublication({
        query: source.query ?? source.handle ?? "",
        scenarioIds: sourceScenarioIds(source),
        provider: "apify",
        observedAt: lookbackWindow.until,
        publishedAt: normalized.publishedAt ?? null,
        freshnessSince: lookbackWindow.since,
        caption: normalized.text,
        creator: normalized.authorHandle ?? normalized.authorName ?? null,
        positiveTerms: terms,
        negativeTerms,
      })
      if (isTikTokPublicationEligibleForComments(decision)) {
        const acceptedEnvelope = result.envelopeId
          ? { id: result.envelopeId }
          : await prisma.ingestEnvelope.findFirst({
              where: {
                organizationId: run.organizationId,
                providerRunId: run.id,
                platform: "tiktok",
                externalId: normalized.externalId,
                relevanceStatus: "ACCEPTED",
                acceptedMentionId: result.id,
              },
              select: { id: true },
            })
        if (!acceptedEnvelope) throw new Error("apify_tiktok_accepted_envelope_missing")
        const registered = await persistTikTokPublicationDecision({
          organizationId: run.organizationId,
          envelopeId: acceptedEnvelope.id,
          decision,
        })
        // Отказ записи по-прежнему валит импорт: молча потерять ревизит
        // комментариев нельзя. А вот терминально отклонённый конверт — не сбой:
        // продвигать его нечем и ревизита у него быть не может.
        if (registered === "failed") throw new Error("apify_tiktok_publication_revisit_not_registered")
      }
    }
    if (result.created) {
      acceptedCount += 1
      if (normalized.parentPostUrl) commentActivityUrls.add(canonicalProviderUrl(normalized.parentPostUrl))
    }
    else duplicateCount += 1
    const existingEvidence = await prisma.mentionEvidence.findFirst({
      where: { organizationId: run.organizationId, mentionId: result.id, sourceId: source.id, ...(normalized.url ? { permalink: normalized.url } : {}) },
      select: { id: true },
    })
    if (!existingEvidence) await prisma.mentionEvidence.create({
      data: {
        organizationId: run.organizationId,
        mentionId: result.id,
        sourceId: source.id,
        permalink: normalized.url ?? null,
        rawSnippet: normalized.text,
        rawPayload: item,
        confidence: 0.65,
        sourceTrustTier: "T3",
      },
    })
    await markNormalizedItemProcessed()
  }
  const contentItemCount = providerItems.length - providerErrorCount
  const schemaDrift = contentItemCount > 0 && invalidCount / contentItemCount > 0.2
  const providerCoverageGap = providerErrorCount > 0
  const fullyProviderBlocked = providerBlockedCount > 0 && contentItemCount === 0
  // A successful Actor status with no discovery rows is ambiguous: it can mean
  // a genuine zero-match window, but it is also how a silently blocked or
  // drifted search Actor can present. Keep the cursor unchanged so the next
  // bounded run can retry the same window instead of creating an unrecoverable
  // coverage gap. Empty comment datasets remain valid complete observations.
  const emptyDiscoveryDataset = run.phase === "DISCOVER_CANDIDATE_POSTS"
    && providerItems.length === 0
  const effectiveResultCeiling = apifyInputResultCeiling(
    run.actorId,
    run.inputSnapshot,
    run.maxItems,
  )
  const resultLimitReached = providerItems.length >= effectiveResultCeiling
    || apifyPerInputResultLimitReached(run.actorId, run.inputSnapshot, payload)
  const actorResultCapReached = apifyActorResultCapReached(
    { actorId: run.actorId, maxItems: run.maxItems },
    remote,
    providerItems.length,
  )
  // Упавший у провайдера прогон никогда не считается полным покрытием, даже
  // если забранные записи выглядят целыми: курсор обязан остаться на месте,
  // чтобы следующая каденция перечитала окно.
  const finalStatus = recoverableProviderFailure
    || schemaDrift
    || providerCoverageGap
    || emptyDiscoveryDataset
    || resultLimitReached
    || actorResultCapReached
    ? "PARTIAL"
    : "IMPORTED"
  const finalError = recoverableProviderFailure
    ?? (actorResultCapReached
    ? "apify_actor_result_cap_reached"
    : emptyDiscoveryDataset
      ? "apify_empty_discovery_dataset"
    : schemaDrift
      ? "apify_schema_drift_threshold"
      : resultLimitReached
        ? "apify_result_limit_reached"
        : providerBlockedCount > 0
          ? "apify_provider_blocked"
          : noPublicItemsCount === providerErrorCount && providerErrorCount > 0
            ? "apify_no_public_items"
            : providerCoverageGap
              ? "apify_provider_item_errors"
              : null)
  const runSnapshot = record(run.inputSnapshot)
  const frozenCommentsAllocation = frozenManualCommentAllocation(runSnapshot)
  const isInstagramPairPostsMember = run.source.platform === "instagram"
    && run.actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR
    && stringValue(runSnapshot.leadDriveInstagramResultsType) === "posts"
    && numberValue(record(runSnapshot.leadDriveInstagramReelsBudget).maxItems) !== null
  const isInstagramPairReelsMember = run.source.platform === "instagram"
    && run.actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR
    && stringValue(runSnapshot.leadDriveInstagramResultsType) === "reels"
    && Boolean(run.parentRunId)
  const manualDependentCommentsAuthorized = frozenCommentsAllocation !== null
  // A paired Instagram search launches comments only after the reels member
  // terminalizes. At that point candidate selection sees the source-scoped
  // normalized URLs from both datasets and checkpoint dedupe emits one actor.
  // If the posts member is fully blocked, however, no reels child can start;
  // an explicitly authorized manual comments run must then continue from any
  // fresh source-scoped candidates already stored in LeadDrive.
  const shouldDispatchDependentComments = run.phase === "DISCOVER_CANDIDATE_POSTS"
    && (
      !isInstagramPairPostsMember
      || (manualDependentCommentsAuthorized && fullyProviderBlocked)
    )
    && (
      manualDependentCommentsAuthorized
      ||
      (!fullyProviderBlocked && !emptyDiscoveryDataset)
      || isInstagramPairReelsMember
    )
    && runSnapshot.leadDriveSuppressDependentPaidRuns !== true
    && (
      runSnapshot.leadDriveManualPaidRun !== true
      || manualDependentCommentsAuthorized
    )
  const shouldDispatchDependentInstagramReels = run.phase === "DISCOVER_CANDIDATE_POSTS"
    && !fullyProviderBlocked
    && run.source.platform === "instagram"
    && run.actorId === APIFY_INSTAGRAM_HASHTAG_ACTOR
    && stringValue(runSnapshot.leadDriveInstagramResultsType) === "posts"
    && numberValue(record(runSnapshot.leadDriveInstagramReelsBudget).maxItems) !== null
  // Алиасные слоты веера Facebook (#638) ставятся в очередь даже когда сам
  // родитель вернулся частично: слоты ищут свой поток контента, и неудача
  // канонического термина не повод не искать алиасы. Полностью заблокированный
  // родитель — исключение: провайдер отказал источнику целиком.
  const shouldDispatchDependentFacebookFanOut = run.phase === "DISCOVER_CANDIDATE_POSTS"
    && !fullyProviderBlocked
    && run.source.platform === "facebook"
    && run.actorId === APIFY_FACEBOOK_SEARCH_ACTOR
    && stringList(runSnapshot.leadDriveFacebookFanOutTerms).length > 0
    && numberValue(record(runSnapshot.leadDriveFacebookFanOutBudget).maxItems) !== null
  // Persist the pending marker in the same write that terminalizes discovery.
  // If the process stops before either child Actor starts, the terminal
  // reconciliation lane still has a durable reason to retry both tasks.
  const terminalInputSnapshot = shouldDispatchDependentComments
    || shouldDispatchDependentInstagramReels
    || shouldDispatchDependentFacebookFanOut
    ? {
        ...record(run.inputSnapshot),
        ...(shouldDispatchDependentComments
          ? { [DEPENDENT_COMMENTS_PENDING_MARKER]: true }
          : {}),
        ...(shouldDispatchDependentInstagramReels
          ? { [DEPENDENT_INSTAGRAM_REELS_PENDING_MARKER]: true }
          : {}),
        ...(shouldDispatchDependentFacebookFanOut
          ? { [DEPENDENT_FACEBOOK_FAN_OUT_PENDING_MARKER]: true }
          : {}),
      }
    : run.inputSnapshot
  const actualCharge = stableApifyActualCharge(remote, remoteObservedAt)
  const terminalUpdate = await prisma.socialProviderRun.updateMany({
    where: {
      id: run.id,
      organizationId: run.organizationId,
      providerKey: APIFY_PROVIDER,
      purgedAt: null,
      status: "IMPORTING",
    },
    data: {
      status: finalStatus,
      receivedCount: providerItems.length,
      acceptedCount,
      reviewCount,
      rejectedCount: rejectedCount + invalidCount + providerErrorCount,
      duplicateCount,
      // Settle only from an explicit provider charge. When Apify omits usage,
      // retaining the pre-dispatch reservation is the conservative ledger.
      ...(actualCharge !== null
        ? { actualChargeUsd: actualCharge, reservedChargeUsd: 0 }
        : {}),
      importedAt: new Date(),
      lastError: finalError,
      actorBuild: stringValue(remote.buildId) || run.actorBuild,
      ...(shouldDispatchDependentComments
        || shouldDispatchDependentInstagramReels
        || shouldDispatchDependentFacebookFanOut
        ? { inputSnapshot: terminalInputSnapshot }
      : {}),
    },
  })
  if (terminalUpdate.count !== 1) throw new Error("apify_import_lease_lost")
  if (schemaDrift) await prisma.sourceRoutePlan.updateMany({
    where: { id: run.routePlanId, organizationId: run.organizationId },
    data: { status: "DEGRADED", lastFailureClass: "SCHEMA_DRIFT", failureCount: { increment: 1 } },
  })
  if (providerBlockedCount > 0) {
    // A fully blocked batch means the actor exhausted its own session retries:
    // open every physical alias immediately so the next explicitly authorized
    // run can select the configured fallback. Mixed batches retain usable
    // content, so they count as a normal recoverable failure without forcing
    // an immediate paid failover.
    const routePlanIds = await physicalRoutePlanIds(run)
    await Promise.all(routePlanIds.map(routePlanId => recordSourceRouteResult(run.organizationId, routePlanId, {
      ok: false,
      failureClass: "apify_provider_blocked",
      forceCircuitOpen: fullyProviderBlocked,
    }))).catch(error => console.error("[social-monitoring] Apify provider block route update failed", error))
  }
  if (run.phase === "DISCOVER_CANDIDATE_POSTS" && finalStatus === "IMPORTED") {
    await advanceMonitoringRouteProviderCursor({
      organizationId: run.organizationId,
      sourceId: run.sourceId,
      routePlanId: run.routePlanId,
      adapterKey: frozenCursorScope.adapterKey,
      fullArchiveRun: frozenCursorScope.fullArchiveRun,
      targetScenarioId: frozenCursorScope.targetScenarioId,
      archiveStartAt: frozenCursorScope.archiveStartAt,
      until: lookbackWindow.until,
      reason: "apify_discovery_imported",
    })
  }
  if (run.phase === "EXTRACT_COMMENTS_FROM_CANDIDATES") {
    const parentUrls = commentParentUrlsFromSnapshot(source.platform, run.inputSnapshot)
    if (["instagram", "facebook"].includes(source.platform)) {
      await recordCommentCheckpointBatch({
        organizationId: run.organizationId,
        sourceId: run.sourceId,
        urls: parentUrls,
        providerRunId: run.id,
        observedCommentCounts,
        latestCommentExternalIds,
        activityUrls: commentActivityUrls,
        coverageClass: finalStatus === "IMPORTED" ? "COMPLETE" : "PARTIAL",
        error: finalError,
        successful: finalStatus === "IMPORTED",
        now: new Date(),
      }).catch(error => console.error("[social-monitoring] comment checkpoint reconciliation failed", error))
    } else if (source.platform === "tiktok" && finalStatus === "IMPORTED") {
      await Promise.all(parentUrls.map(async parentUrl => {
        const postExternalId = tiktokVideoId(parentUrl)
        if (!postExternalId) return
        await recordTikTokPublicationRevisitByPost({
          organizationId: run.organizationId,
          postExternalId,
          observedCommentCount: observedCommentCounts.get(parentUrl) ?? 0,
          activityDetected: commentActivityUrls.has(parentUrl),
          coverageClass: "COMPLETE",
          now: new Date(),
        })
      })).catch(error => console.error("[social-monitoring] TikTok revisit reconciliation failed", error))
    }
  }
  // Discovery and comment extraction are two separate paid actors. Queue the
  // dependent phase immediately after candidate URLs are durable instead of
  // waiting for the source cadence (often six hours) or a second manual click.
  // The pending marker above is durable. Dependent paid work starts only after
  // this clean-slate lock is released so its reservation can acquire locks in
  // canonical order and re-check the tenant fence.
  return { status: finalStatus, imported: acceptedCount, ...(finalError ? { error: finalError } : {}) }
  })
  if (!persistenceFence.allowed) {
    return { status: "BLOCKED", imported: 0, error: persistenceFence.reason }
  }
  if (
    persistenceFence.value.status === "IMPORTED"
    || persistenceFence.value.status === "PARTIAL"
  ) {
    const current = await prisma.socialProviderRun.findFirst({
      where: {
        id: run.id,
        organizationId: run.organizationId,
        providerKey: APIFY_PROVIDER,
        purgedAt: null,
        status: { in: ["IMPORTED", "PARTIAL"] },
      },
      select: { inputSnapshot: true },
    })
    if (current && (
      record(current.inputSnapshot)[DEPENDENT_COMMENTS_PENDING_MARKER] === true
      || record(current.inputSnapshot)[DEPENDENT_INSTAGRAM_REELS_PENDING_MARKER] === true
      || record(current.inputSnapshot)[DEPENDENT_FACEBOOK_FAN_OUT_PENDING_MARKER] === true
    )) {
      await dispatchDependentApifyRuns({
        ...run,
        inputSnapshot: current.inputSnapshot,
      })
    }
  }
  return persistenceFence.value
}

export function verifyApifyWebhookSecret(input: { organizationId: string; idempotencyKey: string; webhookSecretHash: string | null }, secret: string): boolean {
  if (!input.webhookSecretHash || !secret) return false
  const expected = hmacToken(secret, `apify-webhook:${input.organizationId}:${input.idempotencyKey}`)
  const a = Buffer.from(expected, "hex")
  const b = Buffer.from(input.webhookSecretHash, "hex")
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function reconcileApifyProviderRuns(limit = 50) {
  const boundedLimit = Math.max(1, Math.min(limit, 200))
  const terminalQuota = Math.max(1, Math.floor(boundedLimit / 5))
  // Reserve reconciliation capacity for terminal runs whose preliminary cost
  // kept a budget reservation open. Query this lane first so a full page of
  // active imports cannot postpone accounting indefinitely.
  const terminalRuns = await prisma.socialProviderRun.findMany({
    where: {
      providerKey: APIFY_PROVIDER,
      status: { in: ["IMPORTED", "PARTIAL", "FAILED", "PURGED"] },
      externalRunId: { not: null },
      OR: [
        { reservedChargeUsd: { gt: 0 } },
        {
          status: { in: ["IMPORTED", "PARTIAL"] },
          inputSnapshot: {
            path: [DEPENDENT_COMMENTS_PENDING_MARKER],
            equals: true,
          },
        },
        {
          status: { in: ["IMPORTED", "PARTIAL"] },
          inputSnapshot: {
            path: [DEPENDENT_INSTAGRAM_REELS_PENDING_MARKER],
            equals: true,
          },
        },
        // Единственная полоса, которая возвращается к уже терминальному
        // прогону. Без этой ветки маркер веера Facebook некому перечитать:
        // сорванный диспатч алиасных слотов остался бы навсегда, и термины
        // не искались бы вообще (#638).
        {
          status: { in: ["IMPORTED", "PARTIAL"] },
          inputSnapshot: {
            path: [DEPENDENT_FACEBOOK_FAN_OUT_PENDING_MARKER],
            equals: true,
          },
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: terminalQuota,
    select: { id: true },
  })
  const activeCapacity = boundedLimit - terminalRuns.length
  const activeRuns = activeCapacity > 0
    ? await prisma.socialProviderRun.findMany({
        where: {
          providerKey: APIFY_PROVIDER,
          purgedAt: null,
          status: { in: ["QUEUED", "RUNNING", "IMPORTING"] },
        },
        orderBy: { updatedAt: "asc" },
        take: activeCapacity,
        select: { id: true },
      })
    : []
  const results: Array<{ id: string; status: string; imported: number; error?: string }> = []
  for (const run of [...terminalRuns, ...activeRuns]) {
    try {
      results.push({ id: run.id, ...await importApifyProviderRun(run.id) })
    } catch (error) {
      console.error("[social-monitoring] Apify reconciliation failed", error)
      results.push({
        id: run.id,
        status: "FAILED",
        imported: 0,
        error: "apify_reconcile_failed",
      })
    } finally {
      // Preliminary cost, missing provider identity and transient failures
      // must not let one oldest row monopolize either bounded retry lane.
      await prisma.socialProviderRun.updateMany({
        // PURGED rows can intentionally retain a financial reservation until
        // Apify exposes a stable final charge. Rotate those audit tombstones as
        // well so one unresolved oldest row cannot starve the terminal lane.
        where: { id: run.id, providerKey: APIFY_PROVIDER },
        data: { updatedAt: new Date() },
      }).catch(error => {
        console.error("[social-monitoring] Apify reconciliation rotation failed", error)
      })
    }
  }
  return results
}

export async function processApifyDatasetDeletion(limit = 50) {
  const entries = await prisma.socialDeletionLedgerEntry.findMany({
    where: { targetType: "PROVIDER_DATASET", storageScope: APIFY_PROVIDER, status: { in: ["PENDING", "FAILED"] }, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }] },
    orderBy: { dueAt: "asc" },
    take: Math.max(1, Math.min(limit, 200)),
  })
  let completed = 0
  let failed = 0
  for (const entry of entries) {
    const metadata = record(entry.metadata)
    const datasetId = stringValue(metadata.datasetId)
    const providerRunId = stringValue(metadata.providerRunId)
    const token = await apifyToken(entry.organizationId)
    if (!datasetId || !token) {
      failed += 1
      await prisma.socialDeletionLedgerEntry.update({ where: { id: entry.id }, data: { status: "FAILED", attempts: { increment: 1 }, lastAttemptAt: new Date(), nextRetryAt: new Date(Date.now() + 3_600_000), lastError: !datasetId ? "dataset_id_missing" : "apify_token_missing" } })
      continue
    }
    const response = await fetch(`${APIFY_API}/datasets/${encodeURIComponent(datasetId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
    if (response && (response.ok || response.status === 404)) {
      completed += 1
      const now = new Date()
      await prisma.$transaction([
        prisma.socialDeletionLedgerEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED", attempts: { increment: 1 }, lastAttemptAt: now, completedAt: now, nextRetryAt: null, lastError: null, metadata: providerRunId ? { providerRunId } : {} } }),
        ...(providerRunId ? [prisma.socialProviderRun.updateMany({ where: { id: providerRunId, organizationId: entry.organizationId }, data: { status: "PURGED", purgedAt: now, datasetId: null, inputSnapshot: {} } })] : []),
      ])
    } else {
      failed += 1
      await prisma.socialDeletionLedgerEntry.update({ where: { id: entry.id }, data: { status: "FAILED", attempts: { increment: 1 }, lastAttemptAt: new Date(), nextRetryAt: new Date(Date.now() + 3_600_000), lastError: response ? `apify_delete_${response.status}` : "apify_delete_network_error" } })
    }
  }
  return { completed, failed }
}
