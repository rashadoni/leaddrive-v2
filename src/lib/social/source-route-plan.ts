import crypto from "crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isBrightDataLiveRoutingAllowed } from "@/lib/social/bright-data-live-routing"
import { isApifySocialReadRouteAllowed, isApifyRouteReference, isBrightDataOnlyPlatform } from "@/lib/social/bright-data-policy"
import { parseTenantPaidRunPolicy } from "@/lib/social/paid-run-authorization"
import {
  getSocialMonitoringSettings,
  mergeMonitoringSettingsIntoSourceSettings,
  type SocialMonitoringSettings,
} from "@/lib/social/monitoring-settings"
import {
  classifyCollectorError,
  computeCircuitCooldownSeconds,
  deterministicJitterFraction,
} from "@/lib/social/collector-error-classifier"
import {
  GOOGLE_ALERTS_RSS_ADAPTER,
  GOOGLE_ALERTS_RSS_POLICY_VERSION,
  isGoogleAlertsRssSource,
} from "@/lib/social/google-alerts-rss"
import { isMetaGlobalSearchSource } from "@/lib/social/meta-global-search-source"

/** Порог последовательных неудач до открытия circuit для восстановимых классов. */
export const CIRCUIT_FAILURE_THRESHOLD = 3

// v4: tenant-wide route-budget defaults (paid-run policy routeDefaults) are
// baked into compiled plans — the version bump makes every source recompile
// once (existing staleness check) so the defaults apply without manual edits.
// v5: owner raised routeDefaults ($2/run, $100/day, $500/mo, 2026-07-20) —
// budgets live inside compiled plans, so only a version bump re-bakes them.
// v7: Instagram discovery and known-publication comments use pinned Apify
// actors (Bright Data remains the fallback).
// v8: known-publication comments use pinned Apify actors for Facebook,
// Instagram and TikTok. Facebook/TikTok discovery remained Bright Data-only.
// The bump recompiles persisted routes so the scoped comment path becomes
// executable without manual edits.
// v11: Facebook joins Instagram on the Apify-first external discovery path.
// v12: TikTok joins the same Apify-first external discovery path.
// For Facebook/Instagram/TikTok discovery and known-publication comments, Apify is
// selected whenever tenant Apify credentials are available. Bright Data is
// paused for those new routes (including its split enrichment/media/metrics
// phases) and becomes eligible again only when Apify is unavailable.
// v13: a general WEB keyword source uses the configured Apify web-search actor
// first, with the free Azerbaijan publisher adapter as its fail-closed fallback.
// Google Alerts RSS remains a separate additive route.
// Proofless META_GRAPH Business Discovery plans compiled under older versions
// are repaired by a targeted runtime staleness check. Keep this version stable
// until another persisted route contract actually changes.
export const SOURCE_ROUTE_POLICY_VERSION = "social-monitoring-v2-runtime-search-v13"

export const SOURCE_CAPABILITIES = [
  "DISCOVER_POSTS",
  "ENRICH_CONTENT",
  "READ_OWNED_COMMENTS",
  "READ_EXTERNAL_COMMENTS",
  "READ_THREAD",
  "REPLY_OWNED",
  "REPLY_EXTERNAL",
  "READ_MEDIA",
  "UPDATE_METRICS",
] as const

export type SourceCapability = (typeof SOURCE_CAPABILITIES)[number]
export type SourceContentScope = "OWNED" | "TAGGED" | "BRANDED" | "MENTIONED" | "PUBLIC" | "AD"
export type AcquisitionMode = "OFFICIAL_API" | "CONNECTED_ACCOUNT" | "LICENSED_PROVIDER" | "APIFY_FALLBACK" | "NEWS_INDEX" | "MANUAL_URL"

export const ROUTE_ADAPTERS = {
  META_GRAPH: "META_GRAPH",
  YOUTUBE_DATA_API: "YOUTUBE_DATA_API",
  VK_API: "VK_API",
  TELEGRAM_BOT_API: "TELEGRAM_BOT_API",
  TIKTOK_BUSINESS_API: "TIKTOK_BUSINESS_API",
  X_API: "X_API",
  LICENSED_PROVIDER: "LICENSED_PROVIDER",
  BRIGHT_DATA_SNAPSHOT: "BRIGHT_DATA_SNAPSHOT",
  APIFY_ASYNC: "APIFY_ASYNC",
  GOOGLE_ALERTS_RSS: GOOGLE_ALERTS_RSS_ADAPTER,
  AZERBAIJAN_NEWS_DIRECT: "AZERBAIJAN_NEWS_DIRECT",
  SEARCH_INDEX_GENERIC: "SEARCH_INDEX_GENERIC",
  NOTIFICATION_INBOX: "NOTIFICATION_INBOX",
  BROWSER_CAPTURE_READ_ONLY: "BROWSER_CAPTURE_READ_ONLY",
  MANUAL_TASK: "MANUAL_TASK",
} as const

export type RouteAdapter = (typeof ROUTE_ADAPTERS)[keyof typeof ROUTE_ADAPTERS] | string

function isGlobalMetaDiscoverySource(
  source: Pick<RouteSource, "platform" | "sourceType" | "ownership" | "url" | "query" | "keywords" | "settings">,
  capability: SourceCapability,
): boolean {
  return capability === "DISCOVER_POSTS"
    && source.ownership !== "owned"
    && isMetaGlobalSearchSource(source)
}

export type RouteSource = {
  id: string
  organizationId: string
  platform: string
  sourceType: string
  ownership: string
  collectionMode: string
  cadenceMinutes: number
  url?: string | null
  handle?: string | null
  query?: string | null
  keywords?: string[] | null
  settings: unknown
}

type ConnectedAccount = {
  id: string
  platform: string
  isActive: boolean
  accessToken: string | null
}

type CapabilityProof = {
  id: string
  providerKey: string
  adapterKey: string
  platform: string
  capability: string
  contentScopes: string[]
  contractVersion: string | null
  policyVersion: string
  readAllowed: boolean
  replyAllowed: boolean
  aiProcessingAllowed: boolean
  exportAllowed: boolean
  retentionDays: number | null
  status: string
  verifiedAt: Date | null
  sandboxVerifiedAt: Date | null
  expiresAt: Date | null
}

type RouteDraft = {
  routeKey: string
  scenarioId: string | null
  platform: string
  capability: SourceCapability
  contentScope: SourceContentScope
  primaryAdapter: RouteAdapter
  fallbackAdapters: string[]
  capabilityProofId: string | null
  connectionAccountId: string | null
  acquisitionMode: AcquisitionMode
  replyMode: string
  executionOrder: number
  dependsOnCapability: string | null
  budget: Prisma.InputJsonValue
  rateLimit: Prisma.InputJsonValue
  freshnessMinutes: number
  failoverConditions: string[]
  policyVersion: string
  contractVersion: string | null
  reason: string
  status: "ACTIVE" | "BLOCKED"
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function scenarioIdsForSource(source: RouteSource): Array<string | null> {
  const settings = recordFromUnknown(source.settings)
  const ids = new Set<string>()
  const direct = stringValue(settings.scenarioId)
  if (direct) ids.add(direct)
  const links = Array.isArray(settings.scenarioLinks) ? settings.scenarioLinks : []
  for (const link of links) {
    const id = stringValue(recordFromUnknown(link).scenarioId)
    if (id) ids.add(id)
  }
  return ids.size > 0 ? Array.from(ids) : [null]
}

function contentScopeForSource(source: RouteSource): SourceContentScope {
  if (source.ownership === "owned") return "OWNED"
  const settings = recordFromUnknown(source.settings)
  const configured = stringValue(settings.contentScope)?.toUpperCase()
  if (configured && ["TAGGED", "BRANDED", "MENTIONED", "PUBLIC", "AD"].includes(configured)) {
    return configured as SourceContentScope
  }
  return "PUBLIC"
}

function linkedAccount(source: RouteSource, accounts: ConnectedAccount[]): ConnectedAccount | null {
  const settings = recordFromUnknown(source.settings)
  const configuredId = stringValue(settings.socialAccountId) ?? stringValue(settings.accountId)
  if (configuredId) {
    return accounts.find(account => account.id === configuredId && account.platform === source.platform && account.isActive) ?? null
  }
  return accounts.find(account => account.platform === source.platform && account.isActive && Boolean(account.accessToken)) ?? null
}

function validProof(
  proofs: CapabilityProof[],
  source: RouteSource,
  capability: SourceCapability,
  scope: SourceContentScope,
  now: Date,
  adapterKey?: string,
): CapabilityProof | null {
  return proofs.find(proof => (
    (!adapterKey || proof.adapterKey === adapterKey)
    && proof.platform === source.platform
    && proof.capability === capability
    && proof.status === "VERIFIED"
    && Boolean(proof.verifiedAt)
    && (!proof.expiresAt || proof.expiresAt.getTime() > now.getTime())
    && proof.contentScopes.includes(scope)
    && (capability.startsWith("REPLY_") ? proof.replyAllowed && Boolean(proof.sandboxVerifiedAt) : proof.readAllowed)
    && (capability.startsWith("READ_") || capability === "DISCOVER_POSTS" ? proof.exportAllowed : true)
    && !(proof.adapterKey === ROUTE_ADAPTERS.TIKTOK_BUSINESS_API && (scope !== "OWNED" || capability !== "READ_OWNED_COMMENTS"))
    && !(proof.adapterKey === ROUTE_ADAPTERS.META_GRAPH && capability === "READ_EXTERNAL_COMMENTS")
    && !(proof.adapterKey === ROUTE_ADAPTERS.APIFY_ASYNC
      && isBrightDataOnlyPlatform(source.platform)
      && !isApifySocialReadRouteAllowed(source.platform, capability))
    && !(proof.adapterKey === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT && !isBrightDataLiveRoutingAllowed(source.organizationId))
  )) ?? null
}

function apifyEnabled(
  settings: SocialMonitoringSettings,
  source: RouteSource,
  capability: SourceCapability,
): boolean {
  if (!settings.searchIndex.enabled || settings.searchIndex.provider !== "apify" || !settings.searchIndex.hasToken) return false
  if (source.ownership === "owned") return false
  if (source.platform === "web") return capability === "DISCOVER_POSTS"
  return isApifySocialReadRouteAllowed(source.platform, capability)
}

function apifySupportsCapability(capability: SourceCapability): boolean {
  return capability === "DISCOVER_POSTS" || capability === "READ_EXTERNAL_COMMENTS"
}

function genericSearchEnabled(settings: SocialMonitoringSettings): boolean {
  return settings.searchIndex.enabled
    && settings.searchIndex.provider === "generic"
    && Boolean(settings.searchIndex.endpoint)
    && settings.searchIndex.allowedHosts.length > 0
}

function sourceWantsComments(settings: SocialMonitoringSettings, source: RouteSource): boolean {
  const effective = recordFromUnknown(source.settings)
  const search = recordFromUnknown(effective.searchIndex)
  if (typeof search.includeComments === "boolean") return search.includeComments
  return settings.searchIndex.includeComments
}

function officialAdapterFor(source: RouteSource): RouteAdapter | null {
  if (["facebook", "instagram"].includes(source.platform)) return ROUTE_ADAPTERS.META_GRAPH
  if (source.platform === "youtube") return ROUTE_ADAPTERS.YOUTUBE_DATA_API
  if (source.platform === "vkontakte") return ROUTE_ADAPTERS.VK_API
  if (source.platform === "telegram") return ROUTE_ADAPTERS.TELEGRAM_BOT_API
  if (source.platform === "tiktok") return ROUTE_ADAPTERS.TIKTOK_BUSINESS_API
  if (source.platform === "twitter") return ROUTE_ADAPTERS.X_API
  return null
}

function routeCapabilities(source: RouteSource, settings: SocialMonitoringSettings, splitProviderPipeline = false): Array<{
  capability: SourceCapability
  executionOrder: number
  dependsOnCapability: SourceCapability | null
}> {
  if (splitProviderPipeline && ["instagram", "facebook", "tiktok"].includes(source.platform)) {
    const routes: Array<{
      capability: SourceCapability
      executionOrder: number
      dependsOnCapability: SourceCapability | null
    }> = [
      { capability: "DISCOVER_POSTS", executionOrder: 0, dependsOnCapability: null },
      { capability: "ENRICH_CONTENT", executionOrder: 1, dependsOnCapability: "DISCOVER_POSTS" },
      { capability: "READ_MEDIA", executionOrder: 2, dependsOnCapability: "ENRICH_CONTENT" },
      { capability: "UPDATE_METRICS", executionOrder: 2, dependsOnCapability: "ENRICH_CONTENT" },
    ]
    if (sourceWantsComments(settings, source)) {
      routes.push({ capability: "READ_EXTERNAL_COMMENTS", executionOrder: 2, dependsOnCapability: "ENRICH_CONTENT" })
    }
    return routes
  }
  if (source.platform === "telegram") {
    return [{ capability: "READ_THREAD", executionOrder: 0, dependsOnCapability: null }]
  }
  if (["youtube", "vkontakte"].includes(source.platform)) {
    const capability = source.ownership === "owned" ? "READ_OWNED_COMMENTS" : "READ_EXTERNAL_COMMENTS"
    return [{ capability, executionOrder: 0, dependsOnCapability: null }]
  }
  if (source.collectionMode === "official_api" && source.platform === "twitter") {
    return [{ capability: "DISCOVER_POSTS", executionOrder: 0, dependsOnCapability: null }]
  }
  if (source.collectionMode === "official_api" && ["facebook", "instagram"].includes(source.platform)) {
    if (source.ownership === "owned") return [{ capability: "READ_OWNED_COMMENTS", executionOrder: 0, dependsOnCapability: null }]
    if (isMetaGlobalSearchSource(source)) {
      return [{ capability: "DISCOVER_POSTS", executionOrder: 0, dependsOnCapability: null }]
    }
    return [{ capability: "READ_EXTERNAL_COMMENTS", executionOrder: 0, dependsOnCapability: null }]
  }
  if (source.collectionMode === "official_api" && source.platform === "tiktok") {
    if (source.ownership === "owned") return [{ capability: "READ_OWNED_COMMENTS", executionOrder: 0, dependsOnCapability: null }]
    return [
      { capability: "DISCOVER_POSTS", executionOrder: 0, dependsOnCapability: null },
      ...(sourceWantsComments(settings, source)
        ? [{ capability: "READ_EXTERNAL_COMMENTS" as const, executionOrder: 1, dependsOnCapability: "DISCOVER_POSTS" as const }]
        : []),
    ]
  }
  if (source.collectionMode === "provider_api") {
    return [{
      capability: source.ownership === "owned" ? "READ_OWNED_COMMENTS" : "READ_EXTERNAL_COMMENTS",
      executionOrder: 0,
      dependsOnCapability: null,
    }]
  }
  const routes: Array<{ capability: SourceCapability; executionOrder: number; dependsOnCapability: SourceCapability | null }> = [
    { capability: "DISCOVER_POSTS", executionOrder: 0, dependsOnCapability: null },
  ]
  if (sourceWantsComments(settings, source) && ["facebook", "instagram", "tiktok"].includes(source.platform)) {
    routes.push({ capability: "READ_EXTERNAL_COMMENTS", executionOrder: 1, dependsOnCapability: "DISCOVER_POSTS" })
  }
  return routes
}

function routeBudget(
  source: RouteSource,
  settings: SocialMonitoringSettings,
  tenantRouteDefaults: { maxTotalChargeUsd: number; dailyBudgetUsd: number; monthlyBudgetUsd: number } | null = null,
): Prisma.InputJsonValue {
  const sourceSettings = recordFromUnknown(source.settings)
  const budget = recordFromUnknown(sourceSettings.budget)
  // An explicit per-source budget always wins; otherwise the owner-authorized
  // tenant-wide default (paid-run policy routeDefaults) applies, so automatic
  // collection covers every source/keyword without per-source configuration.
  const explicitRunCharge = numberValue(budget.maxTotalChargeUsd) ?? tenantRouteDefaults?.maxTotalChargeUsd ?? null
  const explicitDailyLimit = numberValue(budget.dailyBudgetUsd) ?? tenantRouteDefaults?.dailyBudgetUsd ?? null
  const explicitMonthlyLimit = numberValue(budget.monthlyBudgetUsd) ?? tenantRouteDefaults?.monthlyBudgetUsd ?? null
  return {
    maxItems: Math.max(1, Math.min(1000, Math.trunc(numberValue(budget.maxItems) ?? settings.searchIndex.limit ?? 100))),
    // Defaults are display/reporting values only. Paid adapters stay blocked
    // until the owner explicitly configures all three USD limits (per source or
    // tenant-wide) and enables the enforcement gate.
    maxTotalChargeUsd: Math.max(0.01, explicitRunCharge ?? 1),
    dailyBudgetUsd: Math.max(0.01, explicitDailyLimit ?? 5),
    monthlyBudgetUsd: Math.max(0.01, explicitMonthlyLimit ?? 50),
    usdLimitsConfigured: explicitRunCharge !== null
      && explicitDailyLimit !== null
      && explicitMonthlyLimit !== null
      && explicitRunCharge > 0
      && explicitDailyLimit > 0
      && explicitMonthlyLimit > 0,
    timeoutSeconds: Math.max(30, Math.min(3600, Math.trunc(numberValue(budget.timeoutSeconds) ?? 900))),
  }
}

function routeRateLimit(source: RouteSource): Prisma.InputJsonValue {
  const settings = recordFromUnknown(source.settings)
  const circuit = recordFromUnknown(settings.circuitBreaker)
  const cooldown = numberValue(circuit.cooldownSeconds)
  const overlap = numberValue(circuit.failbackOverlapMinutes)
  return {
    maxRequestsPerMinute: 30,
    failbackOverlapMinutes: Math.max(15, Math.min(1_440, Math.trunc(overlap ?? 60))),
    ...(cooldown !== null
      ? { circuitCooldownSeconds: Math.max(30, Math.min(21_600, Math.trunc(cooldown))) }
      : {}),
  }
}

const INSTAGRAM_USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._]{0,28}[a-z0-9_])?$/i
const INSTAGRAM_RESERVED_PATHS = new Set(["p", "reel", "reels", "tv", "explore", "stories", "accounts", "direct", "about", "legal", "web"])

/**
 * Resolves the external professional-profile username an Instagram watchlist
 * source points at, or null when the source cannot be a Business Discovery
 * target (keyword/hashtag sources, post URLs, invalid handles). Keyword-ish
 * `handle` values are only trusted for profile-shaped source types; URL
 * sources must carry a parseable instagram.com/<username> URL.
 */
export function instagramBusinessDiscoveryUsername(
  source: Pick<RouteSource, "platform" | "sourceType" | "handle" | "url" | "settings">,
): string | null {
  if (source.platform !== "instagram") return null
  const normalize = (value: string | null | undefined): string | null => {
    const cleaned = (value ?? "").replace(/^@+/, "").trim().toLowerCase()
    return cleaned && INSTAGRAM_USERNAME_PATTERN.test(cleaned) ? cleaned : null
  }
  const fromUrl = (() => {
    const raw = stringValue(source.url)
    if (!raw) return null
    try {
      const url = new URL(raw)
      const host = url.hostname.toLowerCase().replace(/^www\./, "")
      if (host !== "instagram.com" && host !== "m.instagram.com") return null
      const parts = url.pathname.split("/").filter(Boolean)
      if (parts.length !== 1 || INSTAGRAM_RESERVED_PATHS.has(parts[0].toLowerCase())) return null
      return normalize(parts[0])
    } catch {
      return null
    }
  })()
  const settings = recordFromUnknown(source.settings)
  const explicit = normalize(stringValue(settings.businessDiscoveryUsername))
  if (explicit) return explicit
  if (["profile", "page", "competitor", "influencer", "account"].includes(source.sourceType)) {
    return normalize(source.handle) ?? fromUrl
  }
  if (["search_url", "url"].includes(source.sourceType)) return fromUrl
  return null
}

function chooseRoute(
  source: RouteSource,
  capability: SourceCapability,
  scope: SourceContentScope,
  account: ConnectedAccount | null,
  proof: CapabilityProof | null,
  businessDiscoveryProof: CapabilityProof | null,
  settings: SocialMonitoringSettings,
): Pick<RouteDraft, "primaryAdapter" | "fallbackAdapters" | "capabilityProofId" | "connectionAccountId" | "acquisitionMode" | "contractVersion" | "reason" | "status"> {
  if (
    source.platform === "web"
    && capability === "DISCOVER_POSTS"
    && isGoogleAlertsRssSource(source)
  ) {
    return {
      primaryAdapter: ROUTE_ADAPTERS.GOOGLE_ALERTS_RSS,
      fallbackAdapters: [ROUTE_ADAPTERS.MANUAL_TASK],
      capabilityProofId: null,
      connectionAccountId: null,
      acquisitionMode: "NEWS_INDEX",
      contractVersion: GOOGLE_ALERTS_RSS_POLICY_VERSION,
      reason: "The scenario-bound official Google Alerts RSS feed is the selected WEB news source.",
      status: "ACTIVE",
    }
  }
  // Решение владельца 2026-08-01: WEB покрывается ТОЛЬКО лентой Google Alerts
  // (ветка выше). Всё остальное на платформе web фейлится закрыто ЗДЕСЬ, а не
  // в сценарии: строки, созданные прежней политикой, живут на проде дальше, и
  // крон отбирает их по статусу, ничего не зная о плане сценария. Без этого
  // гейта прямой обход азербайджанских изданий продолжался бы вечно.
  if (source.platform === "web" && capability === "DISCOVER_POSTS") {
    return {
      primaryAdapter: ROUTE_ADAPTERS.MANUAL_TASK,
      fallbackAdapters: [],
      capabilityProofId: null,
      connectionAccountId: null,
      acquisitionMode: "MANUAL_URL",
      contractVersion: null,
      reason: "WEB discovery is limited to the scenario's Google Alerts RSS feed; no feed is connected, so this route fails closed.",
      status: "BLOCKED",
    }
  }
  const official = officialAdapterFor(source)
  const officialRequested = source.collectionMode === "official_api" || ["youtube", "vkontakte"].includes(source.platform)
  const globalMetaDiscovery = isGlobalMetaDiscoverySource(source, capability)
  // A persisted Meta proof can authorize profile-scoped Business Discovery,
  // never arbitrary public-post keyword/hashtag search.
  const providerProof = globalMetaDiscovery && proof?.adapterKey === ROUTE_ADAPTERS.META_GRAPH
    ? null
    : proof
  const sourceSettings = recordFromUnknown(source.settings)
  const officialScopeAllowed = source.platform === "tiktok"
    ? source.ownership === "owned" && capability === "READ_OWNED_COMMENTS"
    : ["facebook", "instagram"].includes(source.platform)
      ? capability !== "READ_EXTERNAL_COMMENTS"
      : source.platform === "twitter"
        ? capability === "DISCOVER_POSTS"
        : true
  const officialReady = Boolean(official && officialScopeAllowed && (
    source.platform === "vkontakte"
      ? process.env.VK_SERVICE_TOKEN && (proof?.adapterKey === ROUTE_ADAPTERS.VK_API || sourceSettings.vkScopesVerified === true)
      : source.platform === "youtube"
        ? account?.accessToken || process.env.YOUTUBE_API_KEY
        : source.platform === "telegram"
          ? account?.accessToken || process.env.TELEGRAM_BOT_TOKEN
          : source.platform === "tiktok"
            ? Boolean((stringValue(sourceSettings.socialAccountId) || stringValue(sourceSettings.accountId)) && account?.accessToken && proof)
            : account?.accessToken
  ))
  const apify = apifyEnabled(settings, source, capability)
  const brightDataPaused = Boolean(
    apify
    && source.ownership !== "owned"
    && ["facebook", "instagram", "tiktok"].includes(source.platform)
    && isApifySocialReadRouteAllowed(source.platform, capability),
  )
  const manual = ROUTE_ADAPTERS.MANUAL_TASK

  if (
    officialRequested
    && official
    && officialReady
    && !globalMetaDiscovery
    && (source.platform !== "tiktok" || proof)
  ) {
    const fallbacks = [
      ...(apify && apifySupportsCapability(capability) && !["youtube", "vkontakte", "twitter"].includes(source.platform) ? [ROUTE_ADAPTERS.APIFY_ASYNC] : []),
      ...(providerProof
        && providerProof.adapterKey !== official
        && !(brightDataPaused && providerProof.adapterKey === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT)
        ? [providerProof.adapterKey]
        : []),
      manual,
    ]
    return {
      primaryAdapter: official,
      fallbackAdapters: Array.from(new Set(fallbacks)),
      capabilityProofId: ["tiktok", "vkontakte"].includes(source.platform) ? providerProof?.id ?? null : null,
      connectionAccountId: account?.id ?? null,
      acquisitionMode: "OFFICIAL_API",
      contractVersion: providerProof?.contractVersion ?? null,
      reason: `Official ${source.platform} adapter selected from persisted source/account capability.`,
      status: "ACTIVE",
    }
  }

  // Official Instagram Business Discovery: dated posts of an EXTERNAL
  // professional profile through any connected IG account token. Official API
  // outranks provider/Apify per the architecture priority ladder; external
  // comments stay with the fallback adapters (Graph does not expose them).
  if (
    capability === "DISCOVER_POSTS"
    && source.platform === "instagram"
    && source.ownership === "external"
    && account?.accessToken
    && businessDiscoveryProof
    && instagramBusinessDiscoveryUsername(source)
    && !globalMetaDiscovery
  ) {
    return {
      primaryAdapter: ROUTE_ADAPTERS.META_GRAPH,
      // Apify ranks ABOVE Bright Data for Instagram: BD's IG dataset is
      // proxy-blocked and polls ~15 min before failing (owner live test
      // 2026-07-21), so it must never sit between the official API and Apify.
      fallbackAdapters: Array.from(new Set([
        ...(apify && apifySupportsCapability(capability) ? [ROUTE_ADAPTERS.APIFY_ASYNC] : []),
        ...(providerProof
          && providerProof.adapterKey !== ROUTE_ADAPTERS.META_GRAPH
          && !(brightDataPaused && providerProof.adapterKey === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT)
          ? [providerProof.adapterKey]
          : []),
        manual,
      ])),
      capabilityProofId: businessDiscoveryProof.id,
      connectionAccountId: account.id,
      acquisitionMode: "OFFICIAL_API",
      contractVersion: businessDiscoveryProof.contractVersion,
      reason: "Verified Instagram Business Discovery capability selected for an external professional profile.",
      status: "ACTIVE",
    }
  }

  // Facebook/Instagram/TikTok provider route: Apify is the selected paid collector
  // for external discovery and known-publication comments after any eligible
  // official path. Bright Data proofs are preserved but paused, so new routes
  // do not silently dispatch that provider while Apify is configured.
  if (apify && isApifySocialReadRouteAllowed(source.platform, capability)) {
    return {
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      fallbackAdapters: Array.from(new Set([
        ...(providerProof
          && providerProof.adapterKey !== ROUTE_ADAPTERS.APIFY_ASYNC
          && !(brightDataPaused && providerProof.adapterKey === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT)
          ? [providerProof.adapterKey]
          : []),
        manual,
      ])),
      capabilityProofId: providerProof?.adapterKey === ROUTE_ADAPTERS.APIFY_ASYNC ? providerProof.id : null,
      connectionAccountId: account?.id ?? null,
      acquisitionMode: "APIFY_FALLBACK",
      contractVersion: providerProof?.adapterKey === ROUTE_ADAPTERS.APIFY_ASYNC ? providerProof.contractVersion : null,
      reason: capability === "READ_EXTERNAL_COMMENTS"
        ? `Pinned Apify ${source.platform} comments actor selected for known subject-matched public post URLs and nested replies.`
        : `Pinned Apify ${source.platform} discovery actor selected after any eligible official path.`,
      status: "ACTIVE",
    }
  }

  if (providerProof) {
    return {
      primaryAdapter: providerProof.adapterKey || ROUTE_ADAPTERS.LICENSED_PROVIDER,
      fallbackAdapters: Array.from(new Set([
        ...(apify && apifySupportsCapability(capability) && !["youtube", "vkontakte", "twitter"].includes(source.platform) ? [ROUTE_ADAPTERS.APIFY_ASYNC] : []),
        manual,
      ])),
      capabilityProofId: providerProof.id,
      connectionAccountId: account?.id ?? null,
      acquisitionMode: "LICENSED_PROVIDER",
      contractVersion: providerProof.contractVersion,
      reason: `Verified provider capability proof ${providerProof.id} matched ${capability}/${scope}.`,
      status: "ACTIVE",
    }
  }

  if (apify && (capability === "DISCOVER_POSTS" || capability === "READ_EXTERNAL_COMMENTS")) {
    return {
      primaryAdapter: ROUTE_ADAPTERS.APIFY_ASYNC,
      fallbackAdapters: [manual],
      capabilityProofId: null,
      connectionAccountId: account?.id ?? null,
      acquisitionMode: "APIFY_FALLBACK",
      contractVersion: null,
      reason: "Approved tenant Apify configuration selected as read-only external fallback.",
      status: "ACTIVE",
    }
  }

  if (genericSearchEnabled(settings) && capability === "DISCOVER_POSTS" && source.platform !== "twitter") {
    return {
      primaryAdapter: ROUTE_ADAPTERS.SEARCH_INDEX_GENERIC,
      fallbackAdapters: [manual],
      capabilityProofId: null,
      connectionAccountId: account?.id ?? null,
      acquisitionMode: "MANUAL_URL",
      contractVersion: null,
      reason: "Approved generic search index selected for candidate-post discovery only.",
      status: "ACTIVE",
    }
  }

  return {
    primaryAdapter: manual,
    fallbackAdapters: [],
    capabilityProofId: null,
    connectionAccountId: account?.id ?? null,
    acquisitionMode: "MANUAL_URL",
    contractVersion: null,
    reason: source.platform === "twitter"
      ? "X requires official or licensed search access; no scraper fallback is allowed."
      : `No verified ${capability}/${scope} adapter is configured; manual task is fail-closed.`,
    status: "BLOCKED",
  }
}

/**
 * Defensive regression control for the external social provider policy.
 * Facebook and Instagram permit Apify discovery plus known-publication
 * comments. TikTok permits only the scoped comments path. Other capabilities
 * on the guarded platforms must never carry an Apify primary/fallback.
 *
 * This runs after route selection so that even a future change reintroducing an
 * Apify branch cannot leak onto an unapproved capability — an Apify primary
 * fails closed to a manual task, and any Apify fallback is stripped.
 */
export function enforceBrightDataOnlyPolicy<
  T extends Pick<
    RouteDraft,
    "primaryAdapter" | "fallbackAdapters" | "capabilityProofId" | "acquisitionMode" | "reason" | "status"
  >,
>(platform: string, chosen: T, capability?: SourceCapability): T {
  if (!isBrightDataOnlyPlatform(platform)) return chosen
  if (isApifySocialReadRouteAllowed(platform, capability ?? null)) return chosen
  const primaryIsApify = isApifyRouteReference(chosen.primaryAdapter) || chosen.acquisitionMode === "APIFY_FALLBACK"
  if (primaryIsApify) {
    return {
      ...chosen,
      primaryAdapter: ROUTE_ADAPTERS.MANUAL_TASK,
      fallbackAdapters: [],
      capabilityProofId: null,
      acquisitionMode: "MANUAL_URL",
      reason: `Apify is excluded for ${platform}; Bright Data-only policy fails this route closed to a manual task.`,
      status: "BLOCKED",
    }
  }
  const cleanFallbacks = chosen.fallbackAdapters.filter(adapter => !isApifyRouteReference(adapter))
  return cleanFallbacks.length === chosen.fallbackAdapters.length
    ? chosen
    : { ...chosen, fallbackAdapters: cleanFallbacks }
}

function routeKey(sourceId: string, scenarioId: string | null, capability: SourceCapability, scope: SourceContentScope): string {
  const raw = `${sourceId}:${scenarioId ?? "none"}:${capability}:${scope}`
  return `source:${sourceId}:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 20)}`
}

export async function compileSourceRoutePlans(source: RouteSource, now = new Date()) {
  const [accounts, proofs, tenantSettings, organization] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { organizationId: source.organizationId, platform: source.platform, isActive: true },
      select: { id: true, platform: true, isActive: true, accessToken: true },
    }),
    prisma.socialProviderCapabilityProof.findMany({
      where: {
        organizationId: source.organizationId,
        platform: source.platform,
        status: "VERIFIED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ sandboxVerifiedAt: "desc" }, { verifiedAt: "desc" }],
    }),
    getSocialMonitoringSettings(source.organizationId),
    prisma.organization.findUnique({ where: { id: source.organizationId }, select: { settings: true } }),
  ])
  const tenantRouteDefaults = parseTenantPaidRunPolicy(organization?.settings).routeDefaults
  const effectiveSource = {
    ...source,
    settings: mergeMonitoringSettingsIntoSourceSettings(source.settings, tenantSettings, source),
  }
  const account = linkedAccount(effectiveSource, accounts)
  const scope = contentScopeForSource(effectiveSource)
  const apifyOwnsExternalSocialReads = ["facebook", "instagram", "tiktok"].includes(effectiveSource.platform)
    && apifyEnabled(tenantSettings, effectiveSource, "DISCOVER_POSTS")
  const splitProviderPipeline = !apifyOwnsExternalSocialReads
    && process.env.SOCIAL_BRIGHT_DATA_LIVE_ROUTING === "1"
    && proofs.some((proof: CapabilityProof) => proof.adapterKey === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT)
  const drafts: RouteDraft[] = []

  for (const scenarioId of scenarioIdsForSource(effectiveSource)) {
    for (const route of routeCapabilities(effectiveSource, tenantSettings, splitProviderPipeline)) {
      const apifyAvailable = apifyEnabled(tenantSettings, effectiveSource, route.capability)
      const eligibleProofs = proofs.filter(proof => (
        !(isGlobalMetaDiscoverySource(effectiveSource, route.capability)
          && proof.adapterKey === ROUTE_ADAPTERS.META_GRAPH)
        && !(proof.adapterKey === ROUTE_ADAPTERS.APIFY_ASYNC && !apifyAvailable)
      ))
      const proof = validProof(eligibleProofs, effectiveSource, route.capability, scope, now)
      const businessDiscoveryProof = route.capability === "DISCOVER_POSTS"
        && effectiveSource.platform === "instagram"
        ? validProof(proofs, effectiveSource, route.capability, scope, now, ROUTE_ADAPTERS.META_GRAPH)
        : null
      const chosen = enforceBrightDataOnlyPolicy(
        effectiveSource.platform,
        chooseRoute(effectiveSource, route.capability, scope, account, proof, businessDiscoveryProof, tenantSettings),
        route.capability,
      )
      drafts.push({
        routeKey: routeKey(source.id, scenarioId, route.capability, scope),
        scenarioId,
        platform: source.platform,
        capability: route.capability,
        contentScope: scope,
        ...chosen,
        replyMode: "NO_ACTION",
        executionOrder: route.executionOrder,
        dependsOnCapability: route.dependsOnCapability,
        budget: routeBudget(effectiveSource, tenantSettings, tenantRouteDefaults),
        rateLimit: routeRateLimit(effectiveSource),
        freshnessMinutes: Math.max(15, source.cadenceMinutes),
        failoverConditions: ["RATE_LIMIT", "TRANSIENT_ERROR", "PROVIDER_OUTAGE", "CIRCUIT_OPEN"],
        policyVersion: SOURCE_ROUTE_POLICY_VERSION,
      })
    }
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const keys = drafts.map(draft => draft.routeKey)
    await tx.sourceRoutePlan.updateMany({
      where: {
        organizationId: source.organizationId,
        sourceId: source.id,
        status: { not: "INVALIDATED" },
        ...(keys.length > 0 ? { routeKey: { notIn: keys } } : {}),
      },
      data: { status: "INVALIDATED", invalidatedAt: now },
    })

    const plans = []
    for (const draft of drafts) {
      plans.push(await tx.sourceRoutePlan.upsert({
        where: {
          organizationId_routeKey: {
            organizationId: source.organizationId,
            routeKey: draft.routeKey,
          },
        },
        create: {
          organizationId: source.organizationId,
          sourceId: source.id,
          ...draft,
          compiledAt: now,
        },
        update: {
          sourceId: source.id,
          ...draft,
          failureCount: 0,
          circuitOpenUntil: null,
          lastFailureClass: null,
          invalidatedAt: null,
          version: { increment: 1 },
          compiledAt: now,
        },
      }))
    }
    return plans
  }, { isolationLevel: "Serializable" })
}

export async function compileOrganizationSourceRoutePlans(organizationId: string) {
  const sources = await prisma.monitoringSource.findMany({ where: { organizationId } })
  const results = []
  for (const source of sources) results.push(...await compileSourceRoutePlans(source))
  return results
}

export async function getExecutableSourceRoutePlans(organizationId: string, sourceId: string, now = new Date()) {
  void now
  return prisma.sourceRoutePlan.findMany({
    where: {
      organizationId,
      sourceId,
      status: { in: ["ACTIVE", "DEGRADED"] },
    },
    orderBy: [{ executionOrder: "asc" }, { compiledAt: "desc" }],
  })
}

export function selectedAdapterForPlan(plan: { primaryAdapter: string; fallbackAdapters: string[]; circuitOpenUntil: Date | null }, now = new Date()): string | null {
  if (!plan.circuitOpenUntil || plan.circuitOpenUntil.getTime() <= now.getTime()) return plan.primaryAdapter
  return plan.fallbackAdapters[0] ?? null
}

function circuitCooldownOverride(value: unknown): number | null {
  const configured = numberValue(recordFromUnknown(value).circuitCooldownSeconds)
  return configured === null ? null : Math.max(30, Math.min(21_600, Math.trunc(configured)))
}

export async function recordSourceRouteResult(
  organizationId: string,
  routePlanId: string,
  result: {
    ok: boolean
    degraded?: boolean
    failureClass?: string | null
    httpStatus?: number | null
    usedAdapter?: string | null
    primaryAdapter?: string | null
    primaryAttempted?: boolean
    primaryFailureClass?: string | null
    primaryHttpStatus?: number | null
    failbackReconciled?: boolean
    /** Provider already exhausted its own internal retries for this run. */
    forceCircuitOpen?: boolean
  },
  now = new Date(),
) {
  if (result.degraded) {
    return prisma.sourceRoutePlan.updateMany({
      where: { id: routePlanId, organizationId, status: { not: "INVALIDATED" } },
      data: {
        status: "DEGRADED",
        failureCount: { increment: 1 },
        circuitOpenUntil: null,
        lastFailureClass: "SCHEMA_DRIFT",
        ...(result.ok ? { lastSucceededAt: now } : {}),
      },
    })
  }
  if (result.ok) {
    const fallbackSucceeded = Boolean(
      result.usedAdapter
      && result.primaryAdapter
      && result.usedAdapter !== result.primaryAdapter,
    )
    if (fallbackSucceeded) {
      if (!result.primaryAttempted) {
        return prisma.sourceRoutePlan.updateMany({
          where: { id: routePlanId, organizationId, status: { not: "INVALIDATED" } },
          data: {
            status: "DEGRADED",
            lastSucceededAt: now,
          },
        })
      }
      const current = await prisma.sourceRoutePlan.findFirst({
        where: { id: routePlanId, organizationId, status: { not: "INVALIDATED" } },
        select: { failureCount: true, rateLimit: true },
      })
      if (!current) return { count: 0 }
      const failures = current.failureCount + 1
      const classification = classifyCollectorError(result.primaryFailureClass, {
        httpStatus: result.primaryHttpStatus,
      })
      const cooldownSeconds = computeCircuitCooldownSeconds(
        circuitCooldownOverride(current.rateLimit) ?? classification.cooldownSeconds,
        Math.max(1, failures - CIRCUIT_FAILURE_THRESHOLD + 1),
        deterministicJitterFraction(routePlanId),
      )
      return prisma.sourceRoutePlan.updateMany({
        where: {
          id: routePlanId,
          organizationId,
          status: { not: "INVALIDATED" },
          failureCount: current.failureCount,
        },
        data: {
          status: "DEGRADED",
          failureCount: failures,
          lastFailureClass: classification.class,
          circuitOpenUntil: new Date(now.getTime() + cooldownSeconds * 1000),
          lastSucceededAt: now,
        },
      })
    }
    if (result.failbackReconciled === false) {
      return prisma.sourceRoutePlan.updateMany({
        where: { id: routePlanId, organizationId, status: { not: "INVALIDATED" } },
        data: {
          status: "DEGRADED",
          lastFailureClass: "FAILBACK_RECONCILIATION_PENDING",
          lastSucceededAt: now,
        },
      })
    }
    return prisma.sourceRoutePlan.updateMany({
      where: { id: routePlanId, organizationId, status: { not: "INVALIDATED" } },
      data: {
        status: "ACTIVE",
        failureCount: 0,
        circuitOpenUntil: null,
        lastFailureClass: null,
        lastSucceededAt: now,
      },
    })
  }
  const classification = classifyCollectorError(result.failureClass, { httpStatus: result.httpStatus })
  const current = await prisma.sourceRoutePlan.findFirst({
    where: { id: routePlanId, organizationId, status: { not: "INVALIDATED" } },
    select: { failureCount: true, rateLimit: true },
  })
  if (!current) return { count: 0 }
  const failures = current.failureCount + 1

  // Auth/policy/permanent не самоизлечиваются повтором: выводим маршрут из
  // ротации (BLOCKED, fail-closed) до исправления и пересборки плана, чтобы не
  // долбить сломанный токен/квоту. getExecutableSourceRoutePlans его не выберет.
  if (classification.quarantine) {
    return prisma.sourceRoutePlan.updateMany({
      where: {
        id: routePlanId,
        organizationId,
        status: { not: "INVALIDATED" },
        failureCount: current.failureCount,
      },
      data: {
        status: "BLOCKED",
        failureCount: failures,
        lastFailureClass: classification.class,
        circuitOpenUntil: null,
      },
    })
  }

  // Восстановимые классы (transient/rate_limit/budget/unknown): открываем circuit
  // на пороге с экспоненциальным backoff и детерминированным jitter по маршруту.
  const openCircuit = result.forceCircuitOpen === true || failures >= CIRCUIT_FAILURE_THRESHOLD
  const cooldownSeconds = openCircuit
      ? computeCircuitCooldownSeconds(
        circuitCooldownOverride(current.rateLimit) ?? classification.cooldownSeconds,
        failures - CIRCUIT_FAILURE_THRESHOLD + 1,
        deterministicJitterFraction(routePlanId),
      )
    : 0
  return prisma.sourceRoutePlan.updateMany({
    where: {
      id: routePlanId,
      organizationId,
      status: { not: "INVALIDATED" },
      failureCount: current.failureCount,
    },
    data: {
      status: openCircuit ? "DEGRADED" : "ACTIVE",
      failureCount: failures,
      lastFailureClass: classification.class,
      ...(openCircuit ? { circuitOpenUntil: new Date(now.getTime() + cooldownSeconds * 1000) } : {}),
    },
  })
}
