import { z } from "zod"
import { encryptToken } from "@/lib/secure-token"
import { expandMonitoringQueries, suggestedCadenceFromExpansions, type MonitoringQueryExpansion } from "@/lib/social/query-expansion"

export const MONITORING_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "twitter",
  "youtube",
  "telegram",
  "vkontakte",
  "linkedin",
  "web",
] as const

export const MONITORING_SOURCE_TYPES = [
  "profile",
  "page",
  "hashtag",
  "keyword",
  "search_url",
  "competitor",
  "influencer",
  "campaign",
  "notification_inbox",
  "manual",
] as const

export const MONITORING_COLLECTION_MODES = [
  "official_api",
  "provider_api",
  "search_index",
  "notification_inbox",
  "browser_capture",
  "manual",
] as const

export const MONITORING_OWNERSHIPS = ["owned", "external", "unknown"] as const
export const MONITORING_RISK_LEVELS = ["low", "medium", "high"] as const
export const MONITORING_STATUSES = ["active", "paused", "needs_setup", "limited", "blocked", "disabled"] as const

export type MonitoringPlatform = (typeof MONITORING_PLATFORMS)[number]
export type MonitoringSourceType = (typeof MONITORING_SOURCE_TYPES)[number]
export type MonitoringCollectionMode = (typeof MONITORING_COLLECTION_MODES)[number]
export type MonitoringOwnership = (typeof MONITORING_OWNERSHIPS)[number]
export type MonitoringRiskLevel = (typeof MONITORING_RISK_LEVELS)[number]
export type MonitoringStatus = (typeof MONITORING_STATUSES)[number]

export interface MonitoringClassification {
  collectionMode: MonitoringCollectionMode
  riskLevel: MonitoringRiskLevel
  statusHint: MonitoringStatus
  blockedReasons: string[]
}

export interface NormalizedMonitoringSourceInput {
  platform: MonitoringPlatform
  sourceType: MonitoringSourceType
  url: string | null
  handle: string | null
  query: string | null
  ownership: MonitoringOwnership
  collectionMode: MonitoringCollectionMode
  cadenceMinutes: number
  keywords: string[]
  riskLevel: MonitoringRiskLevel
  status: MonitoringStatus
  settings: Record<string, unknown>
  expandedQueries: MonitoringQueryExpansion[]
  safety: {
    blockedReasons: string[]
    liveExternalSendEnabled: false
    autoReplyEnabled: false
  }
}

export interface MonitoringProviderSetupSummary {
  collectionConfigured: boolean
  collectionApproved: boolean
  collectionEndpointHost: string | null
  collectionHasEncryptedToken: boolean
  replyConfigured: boolean
  replyApproved: boolean
  replyEndpointHost: string | null
}

export type MonitoringReadinessStepKey = "collection" | "reply" | "liveSend"
export type MonitoringReadinessState = "ready" | "needs_setup" | "manual_only" | "dry_run" | "blocked" | "disabled"

export interface MonitoringReadinessStep {
  key: MonitoringReadinessStepKey
  state: MonitoringReadinessState
  reason: string
  action: string
}

export interface MonitoringSourceReadiness {
  overall: MonitoringReadinessState
  canCollect: boolean
  canReplyLive: boolean
  externalSendsDisabled: boolean
  steps: MonitoringReadinessStep[]
  missing: string[]
}

export interface MonitoringReadinessEnvironment {
  searchIndexEnabled: boolean
  searchIndexEndpointConfigured: boolean
  searchIndexAllowlistConfigured: boolean
  providerAllowlistConfigured: boolean
  providerReplyAllowlistConfigured: boolean
  notificationInboxAllowlistConfigured: boolean
  browserCaptureEnabled: boolean
  youtubeApiKeyConfigured: boolean
  liveRepliesEnabled: boolean
}

export interface MonitoringReadinessAccount {
  id: string
  platform: string
  isActive: boolean
  accessToken: string | null
}

export interface MonitoringReadinessSource {
  platform: string
  sourceType: string
  ownership: string
  collectionMode: string
  status: string
  cadenceMinutes: number
  settings: unknown
  lastError?: string | null
}

const unsafeFlagPaths = [
  "liveExternalSendEnabled",
  "liveSendAllowed",
  "allowAutoReply",
  "autoReply",
  "autoReplyEnabled",
  "replyMode",
  "sendMode",
  "settings.liveExternalSendEnabled",
  "settings.liveSendAllowed",
  "settings.allowAutoReply",
  "settings.autoReply",
  "settings.autoReplyEnabled",
  "settings.replyMode",
  "settings.sendMode",
] as const

const unsafeFlagKeys = new Set(unsafeFlagPaths.map((path) => path.split(".").at(-1)).filter((key): key is string => Boolean(key)))
const sourceBaseSchema = z.object({
  platform: z.enum(MONITORING_PLATFORMS),
  sourceType: z.enum(MONITORING_SOURCE_TYPES),
  url: z.string().trim().url().max(2000).nullable().optional(),
  handle: z.string().trim().min(1).max(200).nullable().optional(),
  query: z.string().trim().min(1).max(500).nullable().optional(),
  ownership: z.enum(MONITORING_OWNERSHIPS).optional(),
  collectionMode: z.enum(MONITORING_COLLECTION_MODES).optional(),
  cadenceMinutes: z.coerce.number().int().min(15).max(10080).optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  riskLevel: z.enum(MONITORING_RISK_LEVELS).optional(),
  status: z.enum(MONITORING_STATUSES).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const createMonitoringSourceSchema = sourceBaseSchema.extend({
  // Rolling-upgrade compatibility only. These deprecated assignment fields are
  // accepted from older clients and intentionally ignored by the route.
  subjectId: z.string().trim().min(1).max(160).optional(),
  scenarioId: z.string().trim().min(1).max(160).optional(),
})

export const updateMonitoringSourceSchema = sourceBaseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required" },
)

export type CreateMonitoringSourceBody = z.infer<typeof createMonitoringSourceSchema>
export type UpdateMonitoringSourceBody = z.infer<typeof updateMonitoringSourceSchema>

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed ? trimmed : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  const raw = stringValue(value)
  if (!raw) return undefined
  return raw.slice(0, maxLength)
}

export function normalizeMonitoringUrl(value: string | null | undefined): string | null {
  const raw = nonBlank(value)
  if (!raw) return null
  const parsed = new URL(raw)
  parsed.hash = ""
  parsed.hostname = parsed.hostname.toLowerCase()
  const normalized = parsed.toString()
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
}

export function normalizeMonitoringHandle(value: string | null | undefined): string | null {
  const raw = nonBlank(value)
  if (!raw) return null
  return raw.replace(/^@+/, "").toLowerCase()
}

export function normalizeMonitoringQuery(value: string | null | undefined, sourceType: MonitoringSourceType): string | null {
  const raw = nonBlank(value)
  if (!raw) return null
  if (sourceType === "hashtag") return raw.replace(/^#+/, "").toLowerCase()
  return raw.toLowerCase()
}

function normalizeKeywords(keywords: string[] | undefined): string[] {
  if (!keywords) return []
  return Array.from(new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))).slice(0, 100)
}

function stringListFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
}

function searchIndexDomainForTarget(platform: MonitoringPlatform, url: string | null): string | null {
  if (url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase()
      if (hostname) return hostname
    } catch {
      // URL validation already runs before persistence; ignore here to keep settings sanitization defensive.
    }
  }

  if (platform === "instagram") return "instagram.com"
  if (platform === "facebook") return "facebook.com"
  if (platform === "tiktok") return "tiktok.com"
  if (platform === "youtube") return "youtube.com"
  if (platform === "twitter") return "x.com"
  if (platform === "linkedin") return "linkedin.com"
  if (platform === "telegram") return "t.me"
  if (platform === "vkontakte") return "vk.com"
  return null
}

function truthyUnsafe(value: unknown): boolean {
  if (value === true) return true
  if (typeof value !== "string") return false
  const normalized = value.trim().toLowerCase()
  return ["true", "enabled", "auto", "live", "send_live", "external_live"].includes(normalized)
}

function collectUnsafeLiveSendFlags(value: unknown, path: string, found: Set<string>): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key
    if (unsafeFlagKeys.has(key) && truthyUnsafe(entry)) found.add(nextPath)
    collectUnsafeLiveSendFlags(entry, nextPath, found)
  }
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cursor, part) => {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined
    return (cursor as Record<string, unknown>)[part]
  }, value)
}

export function findUnsafeLiveSendFlags(value: unknown): string[] {
  const found = new Set<string>()
  unsafeFlagPaths.forEach((path) => {
    if (truthyUnsafe(getPath(value, path))) found.add(path)
  })
  collectUnsafeLiveSendFlags(value, "", found)
  return Array.from(found)
}

export function classifyMonitoringSource(input: {
  platform: MonitoringPlatform
  sourceType: MonitoringSourceType
  ownership?: MonitoringOwnership
}): MonitoringClassification {
  const ownership = input.ownership ?? "unknown"
  const blockedReasons: string[] = []

  if (input.sourceType === "notification_inbox") {
    return {
      collectionMode: "notification_inbox",
      riskLevel: "low",
      statusHint: "active",
      blockedReasons,
    }
  }

  if (ownership === "owned" && ["facebook", "instagram", "youtube"].includes(input.platform)) {
    return {
      collectionMode: "official_api",
      riskLevel: "low",
      statusHint: "active",
      blockedReasons,
    }
  }

  if (ownership === "owned" && input.platform === "tiktok") {
    return {
      collectionMode: "provider_api",
      riskLevel: "medium",
      statusHint: "needs_setup",
      blockedReasons: ["tiktok_owned_monitoring_requires_provider_or_inbox_setup"],
    }
  }

  if (["hashtag", "keyword", "search_url"].includes(input.sourceType)) {
    blockedReasons.push("public_search_requires_approved_provider_or_search_index")
    return {
      collectionMode: "search_index",
      riskLevel: ["instagram", "facebook", "tiktok"].includes(input.platform) ? "high" : "medium",
      statusHint: "needs_setup",
      blockedReasons,
    }
  }

  if (["competitor", "influencer", "profile", "page", "campaign"].includes(input.sourceType)) {
    blockedReasons.push("external_page_monitoring_requires_approved_provider_or_search_index")
    return {
      collectionMode: "search_index",
      riskLevel: ownership === "external" ? "high" : "medium",
      statusHint: "needs_setup",
      blockedReasons,
    }
  }

  return {
    collectionMode: "manual",
    riskLevel: "medium",
    statusHint: "needs_setup",
    blockedReasons,
  }
}

function resolveMonitoringCollectionMode(
  requestedMode: MonitoringCollectionMode | undefined,
  classification: MonitoringClassification,
  sourceType: MonitoringSourceType,
): MonitoringCollectionMode {
  if (!requestedMode) return classification.collectionMode
  if (requestedMode === "manual" && classification.collectionMode !== "manual" && sourceType !== "manual") {
    return classification.collectionMode
  }
  return requestedMode
}

export function normalizeMonitoringSourceInput(
  body: CreateMonitoringSourceBody,
): NormalizedMonitoringSourceInput {
  const unsafeFlags = findUnsafeLiveSendFlags(body)
  if (unsafeFlags.length > 0) {
    throw new Error(`Unsafe live-send flags are not allowed: ${unsafeFlags.join(", ")}`)
  }

  const ownership = body.ownership ?? "unknown"
  const classification = classifyMonitoringSource({
    platform: body.platform,
    sourceType: body.sourceType,
    ownership,
  })
  const collectionMode = resolveMonitoringCollectionMode(body.collectionMode, classification, body.sourceType)
  const url = normalizeMonitoringUrl(body.url)
  const handle = normalizeMonitoringHandle(body.handle)
  const query = normalizeMonitoringQuery(body.query, body.sourceType)
  const keywords = normalizeKeywords(body.keywords)
  const rawSettings = recordFromUnknown(body.settings)
  const expandedQueries = expandMonitoringQueries({
    sourceType: body.sourceType,
    query,
    keywords,
    aliases: stringListFromUnknown(rawSettings.aliases),
  })
  const suggestedCadenceMinutes = suggestedCadenceFromExpansions(expandedQueries, body.cadenceMinutes ?? 60)
  const cadenceMinutes = collectionMode === "search_index" ? Math.max(360, suggestedCadenceMinutes) : suggestedCadenceMinutes
  const settings = sanitizeMonitoringSettings(rawSettings, classification.blockedReasons, expandedQueries, {
    collectionMode,
    platform: body.platform,
    url,
  })
  const providerSetup = summarizeMonitoringProviderSetup(settings)

  validateMonitoringTarget({
    sourceType: body.sourceType,
    url,
    handle,
    query,
    keywords,
  })

  return {
    platform: body.platform,
    sourceType: body.sourceType,
    url,
    handle,
    query,
    ownership,
    collectionMode,
    cadenceMinutes,
    keywords,
    riskLevel: body.riskLevel ?? classification.riskLevel,
    status: body.status ?? (
      collectionMode === "provider_api" && providerSetup.collectionConfigured && providerSetup.collectionApproved
        ? "active"
        : classification.statusHint
    ),
    settings,
    expandedQueries,
    safety: {
      blockedReasons: classification.blockedReasons,
      liveExternalSendEnabled: false,
      autoReplyEnabled: false,
    },
  }
}

export function normalizeMonitoringSourceUpdate(
  existing: {
    platform: string
    sourceType: string
    url: string | null
    handle: string | null
    query: string | null
    ownership: string
    collectionMode: string
    cadenceMinutes: number
    keywords: string[]
    riskLevel: string
    status: string
    settings: unknown
  },
  body: UpdateMonitoringSourceBody,
): NormalizedMonitoringSourceInput {
  const unsafeFlags = findUnsafeLiveSendFlags(body)
  if (unsafeFlags.length > 0) {
    throw new Error(`Unsafe live-send flags are not allowed: ${unsafeFlags.join(", ")}`)
  }

  const merged = {
    platform: (body.platform ?? existing.platform) as MonitoringPlatform,
    sourceType: (body.sourceType ?? existing.sourceType) as MonitoringSourceType,
    url: body.url !== undefined ? body.url : existing.url,
    handle: body.handle !== undefined ? body.handle : existing.handle,
    query: body.query !== undefined ? body.query : existing.query,
    ownership: (body.ownership ?? existing.ownership) as MonitoringOwnership,
    collectionMode: (body.collectionMode ?? existing.collectionMode) as MonitoringCollectionMode,
    cadenceMinutes: body.cadenceMinutes ?? existing.cadenceMinutes,
    keywords: body.keywords ?? existing.keywords,
    riskLevel: (body.riskLevel ?? existing.riskLevel) as MonitoringRiskLevel,
    status: (body.status ?? existing.status) as MonitoringStatus,
    settings: body.settings ?? recordFromUnknown(existing.settings),
  }

  const normalized = normalizeMonitoringSourceInput(merged)
  const providerSetup = summarizeMonitoringProviderSetup(normalized.settings)
  if (
    body.status === undefined &&
    existing.status === "needs_setup" &&
    normalized.collectionMode === "provider_api" &&
    providerSetup.collectionConfigured &&
    providerSetup.collectionApproved
  ) {
    return { ...normalized, status: "active" }
  }
  return normalized
}

function validateMonitoringTarget(input: {
  sourceType: MonitoringSourceType
  url: string | null
  handle: string | null
  query: string | null
  keywords: string[]
}): void {
  if (input.sourceType === "search_url" && !input.url) {
    throw new Error("Search URL sources require url")
  }
  if (["profile", "page", "competitor", "influencer", "campaign"].includes(input.sourceType) && !input.url && !input.handle) {
    throw new Error("Page/profile sources require url or handle")
  }
  if (["hashtag", "keyword"].includes(input.sourceType) && !input.query && input.keywords.length === 0) {
    throw new Error("Keyword and hashtag sources require query or keywords")
  }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
  const ipv6Host = host.replace(/^\[/, "").replace(/\]$/, "")
  if (ipv6Host.includes(":") && (ipv6Host === "::1" || ipv6Host.startsWith("fc") || ipv6Host.startsWith("fd") || ipv6Host.startsWith("fe80"))) return true
  return false
}

function normalizeProviderEndpoint(value: unknown, label: string): string | undefined {
  const raw = stringValue(value)
  if (!raw) return undefined

  let endpoint: URL
  try {
    endpoint = new URL(raw)
  } catch {
    throw new Error(`${label} is invalid`)
  }
  if (endpoint.protocol !== "https:") throw new Error(`${label} must use HTTPS`)
  if (isPrivateOrLocalHost(endpoint.hostname)) throw new Error(`${label} host is not allowed`)
  endpoint.hash = ""
  return endpoint.toString()
}

function sanitizeProviderSettings(value: unknown, collectionMode?: MonitoringCollectionMode): Record<string, unknown> | undefined {
  const provider = recordFromUnknown(value)
  if (Object.keys(provider).length === 0) return undefined
  if (collectionMode !== "provider_api") {
    throw new Error("Provider settings require provider_api collection mode")
  }

  const endpoint = normalizeProviderEndpoint(provider.endpoint, "Provider endpoint")
  const name = optionalString(provider.name, 80)
  const encryptedToken = optionalString(provider.encryptedToken, 4096)
  const rawToken = optionalString(provider.token, 4096)
  const allowedHosts = stringListFromUnknown(provider.allowedHosts)
  const reply = recordFromUnknown(provider.reply)
  const replyEndpoint = normalizeProviderEndpoint(reply.endpoint, "Provider reply endpoint")
  const replyEncryptedToken = optionalString(reply.encryptedToken, 4096)
  const replyRawToken = optionalString(reply.token, 4096)
  const replyName = optionalString(reply.name, 80)
  const replyAllowedHosts = stringListFromUnknown(reply.allowedHosts)

  if (!endpoint && (provider.approved === true || name || encryptedToken || Object.keys(reply).length > 0)) {
    throw new Error("Provider endpoint is required for provider_api collection")
  }
  if (!replyEndpoint && reply.approved === true) {
    throw new Error("Provider reply endpoint is required when provider reply is approved")
  }

  const sanitized: Record<string, unknown> = {}
  if (name) sanitized.name = name
  if (endpoint) {
    sanitized.approved = provider.approved === false ? false : true
    sanitized.endpoint = endpoint
  }
  if (encryptedToken) sanitized.encryptedToken = encryptedToken
  if (rawToken) sanitized.encryptedToken = encryptToken(rawToken, "social-provider")
  if (allowedHosts.length > 0) sanitized.allowedHosts = allowedHosts

  const sanitizedReply: Record<string, unknown> = {}
  if (replyName) sanitizedReply.name = replyName
  if (replyEndpoint) {
    sanitizedReply.approved = reply.approved === false ? false : true
    sanitizedReply.endpoint = replyEndpoint
  }
  if (replyEncryptedToken) sanitizedReply.encryptedToken = replyEncryptedToken
  if (replyRawToken) sanitizedReply.encryptedToken = encryptToken(replyRawToken, "social-provider-reply")
  if (replyAllowedHosts.length > 0) sanitizedReply.allowedHosts = replyAllowedHosts
  if (Object.keys(sanitizedReply).length > 0) sanitized.reply = sanitizedReply

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

function endpointHost(value: unknown): string | null {
  const raw = stringValue(value)
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function summarizeMonitoringProviderSetup(settings: unknown): MonitoringProviderSetupSummary {
  const provider = recordFromUnknown(recordFromUnknown(settings).provider)
  const reply = recordFromUnknown(provider.reply)
  const endpoint = stringValue(provider.endpoint)
  const replyEndpoint = stringValue(reply.endpoint)

  return {
    collectionConfigured: Boolean(endpoint),
    collectionApproved: provider.approved === true,
    collectionEndpointHost: endpointHost(endpoint),
    collectionHasEncryptedToken: Boolean(stringValue(provider.encryptedToken)),
    replyConfigured: Boolean(replyEndpoint),
    replyApproved: reply.approved === true,
    replyEndpointHost: endpointHost(replyEndpoint),
  }
}

function searchIndexSetup(settings: unknown, env: MonitoringReadinessEnvironment) {
  const searchIndex = recordFromUnknown(recordFromUnknown(settings).searchIndex)
  const allowedHosts = stringListFromUnknown(searchIndex.allowedHosts)
  const provider = stringValue(searchIndex.provider) || "generic"
  const apify = provider === "apify"
  return {
    provider,
    approved: searchIndex.approved === true || env.searchIndexEnabled,
    endpointConfigured: apify || Boolean(stringValue(searchIndex.endpoint)) || env.searchIndexEndpointConfigured,
    allowlistConfigured: apify || allowedHosts.length > 0 || env.searchIndexAllowlistConfigured,
    tokenConfigured: Boolean(stringValue(searchIndex.encryptedToken)),
  }
}

function providerAllowlistConfigured(settings: unknown, env: MonitoringReadinessEnvironment): boolean {
  const provider = recordFromUnknown(recordFromUnknown(settings).provider)
  return stringListFromUnknown(provider.allowedHosts).length > 0 || env.providerAllowlistConfigured
}

function providerReplyAllowlistConfigured(settings: unknown, env: MonitoringReadinessEnvironment): boolean {
  const provider = recordFromUnknown(recordFromUnknown(settings).provider)
  const reply = recordFromUnknown(provider.reply)
  return stringListFromUnknown(reply.allowedHosts).length > 0 || env.providerReplyAllowlistConfigured
}

function notificationInboxSetup(settings: unknown) {
  const notificationInbox = recordFromUnknown(recordFromUnknown(settings).notificationInbox)
  return {
    approved: notificationInbox.approved === true,
    endpointConfigured: Boolean(stringValue(notificationInbox.endpoint)),
  }
}

function browserCaptureSetup(settings: unknown) {
  const browserCapture = recordFromUnknown(recordFromUnknown(settings).browserCapture)
  return { approved: browserCapture.approved === true }
}

function linkedAccountForSource(source: MonitoringReadinessSource, accounts: MonitoringReadinessAccount[]): MonitoringReadinessAccount | null {
  const settings = recordFromUnknown(source.settings)
  const configuredId = stringValue(settings.socialAccountId)
  if (configuredId) return accounts.find((account) => account.id === configuredId && account.platform === source.platform) ?? null
  return accounts.find((account) => account.platform === source.platform && account.isActive && Boolean(account.accessToken)) ?? null
}

function officialCollectionStep(
  source: MonitoringReadinessSource,
  accounts: MonitoringReadinessAccount[],
  env: MonitoringReadinessEnvironment,
): MonitoringReadinessStep {
  if (source.platform === "tiktok") {
    return { key: "collection", state: "needs_setup", reason: "tiktok_provider_or_webhook_required", action: "connect_tiktok_provider_or_webhook" }
  }
  if (source.platform === "youtube" && env.youtubeApiKeyConfigured) {
    return { key: "collection", state: "ready", reason: "youtube_api_key_ready", action: "run_source_now" }
  }
  const linkedAccount = linkedAccountForSource(source, accounts)
  if (!linkedAccount) return { key: "collection", state: "needs_setup", reason: "official_account_missing", action: "connect_owned_account" }
  if (!linkedAccount.isActive) return { key: "collection", state: "needs_setup", reason: "official_account_inactive", action: "reconnect_owned_account" }
  if (!linkedAccount.accessToken) return { key: "collection", state: "needs_setup", reason: "official_token_missing", action: "reconnect_owned_account" }
  return { key: "collection", state: "ready", reason: "official_account_ready", action: "run_source_now" }
}

function providerCollectionStep(source: MonitoringReadinessSource, env: MonitoringReadinessEnvironment): MonitoringReadinessStep {
  const providerSetup = summarizeMonitoringProviderSetup(source.settings)
  if (!providerSetup.collectionConfigured) return { key: "collection", state: "needs_setup", reason: "provider_endpoint_missing", action: "configure_provider_endpoint" }
  if (!providerSetup.collectionApproved) return { key: "collection", state: "needs_setup", reason: "provider_not_approved", action: "approve_provider_source" }
  if (!providerAllowlistConfigured(source.settings, env)) return { key: "collection", state: "needs_setup", reason: "provider_allowlist_missing", action: "configure_provider_allowlist" }
  return { key: "collection", state: "ready", reason: "provider_ready", action: "run_source_now" }
}

function searchIndexCollectionStep(source: MonitoringReadinessSource, env: MonitoringReadinessEnvironment): MonitoringReadinessStep {
  const setup = searchIndexSetup(source.settings, env)
  if (source.cadenceMinutes < 360) return { key: "collection", state: "needs_setup", reason: "search_index_cadence_too_fast", action: "slow_search_index_cadence" }
  if (!setup.approved) return { key: "collection", state: "needs_setup", reason: "search_index_not_approved", action: "enable_search_index" }
  if (setup.provider === "apify" && !setup.tokenConfigured) return { key: "collection", state: "needs_setup", reason: "search_index_token_missing", action: "configure_search_index_token" }
  if (!setup.endpointConfigured) return { key: "collection", state: "needs_setup", reason: "search_index_endpoint_missing", action: "configure_search_index_endpoint" }
  if (!setup.allowlistConfigured) return { key: "collection", state: "needs_setup", reason: "search_index_allowlist_missing", action: "configure_search_index_allowlist" }
  return { key: "collection", state: "ready", reason: "search_index_ready", action: "run_source_now" }
}

function notificationInboxCollectionStep(source: MonitoringReadinessSource, env: MonitoringReadinessEnvironment): MonitoringReadinessStep {
  const settings = recordFromUnknown(source.settings)
  const googleAlertsRss = recordFromUnknown(settings.googleAlertsRss)
  if (settings.managedBy === "google_alerts_rss") {
    return stringValue(googleAlertsRss.encryptedFeedUrl) && googleAlertsRss.configured === true
      ? { key: "collection", state: "ready", reason: "google_alerts_rss_ready", action: "run_source_now" }
      : { key: "collection", state: "needs_setup", reason: "google_alerts_rss_not_configured", action: "configure_google_alerts_rss" }
  }
  const setup = notificationInboxSetup(source.settings)
  if (!setup.approved) return { key: "collection", state: "needs_setup", reason: "notification_inbox_not_approved", action: "approve_notification_inbox" }
  if (!setup.endpointConfigured) return { key: "collection", state: "needs_setup", reason: "notification_inbox_endpoint_missing", action: "configure_notification_inbox_endpoint" }
  if (!env.notificationInboxAllowlistConfigured) return { key: "collection", state: "needs_setup", reason: "notification_inbox_allowlist_missing", action: "configure_notification_inbox_allowlist" }
  return { key: "collection", state: "ready", reason: "notification_inbox_ready", action: "run_source_now" }
}

function browserCaptureCollectionStep(source: MonitoringReadinessSource, env: MonitoringReadinessEnvironment): MonitoringReadinessStep {
  const setup = browserCaptureSetup(source.settings)
  if (!env.browserCaptureEnabled) return { key: "collection", state: "needs_setup", reason: "browser_capture_feature_disabled", action: "enable_browser_capture" }
  if (!setup.approved) return { key: "collection", state: "needs_setup", reason: "browser_capture_not_approved", action: "approve_browser_capture" }
  return { key: "collection", state: "ready", reason: "browser_capture_ready", action: "run_source_now" }
}

function collectionReadinessStep(source: MonitoringReadinessSource, accounts: MonitoringReadinessAccount[], env: MonitoringReadinessEnvironment): MonitoringReadinessStep {
  if (source.status === "paused" || source.status === "disabled") {
    return { key: "collection", state: "disabled", reason: "source_inactive", action: "resume_source" }
  }
  if (source.status === "blocked") return { key: "collection", state: "blocked", reason: "source_blocked", action: "review_source_error" }
  if (source.collectionMode === "official_api") return officialCollectionStep(source, accounts, env)
  if (source.collectionMode === "provider_api") return providerCollectionStep(source, env)
  if (source.collectionMode === "search_index") return searchIndexCollectionStep(source, env)
  if (source.collectionMode === "notification_inbox") return notificationInboxCollectionStep(source, env)
  if (source.collectionMode === "browser_capture") return browserCaptureCollectionStep(source, env)
  return { key: "collection", state: "manual_only", reason: "manual_source", action: "add_manual_evidence" }
}

function replyReadinessStep(source: MonitoringReadinessSource, accounts: MonitoringReadinessAccount[], env: MonitoringReadinessEnvironment): MonitoringReadinessStep {
  if (source.collectionMode === "provider_api") {
    const providerSetup = summarizeMonitoringProviderSetup(source.settings)
    if (!providerSetup.replyConfigured) return { key: "reply", state: "manual_only", reason: "provider_reply_missing", action: "use_ai_draft_or_original" }
    if (!providerSetup.replyApproved) return { key: "reply", state: "needs_setup", reason: "provider_reply_not_approved", action: "approve_provider_reply" }
    if (!providerReplyAllowlistConfigured(source.settings, env)) return { key: "reply", state: "needs_setup", reason: "provider_reply_allowlist_missing", action: "configure_provider_reply_allowlist" }
    return { key: "reply", state: "ready", reason: "provider_reply_ready", action: "reply_after_policy" }
  }

  if (source.collectionMode === "official_api") {
    if (!["facebook", "instagram", "twitter"].includes(source.platform)) {
      return { key: "reply", state: "manual_only", reason: "unsupported_live_platform", action: "use_ai_draft_or_original" }
    }
    const linkedAccount = linkedAccountForSource(source, accounts)
    if (!linkedAccount?.accessToken) return { key: "reply", state: "needs_setup", reason: "official_reply_identity_missing", action: "connect_owned_account" }
    return { key: "reply", state: "ready", reason: "official_reply_ready", action: "reply_after_policy" }
  }

  return { key: "reply", state: "manual_only", reason: "source_requires_human_action", action: "use_ai_draft_or_original" }
}

function liveSendReadinessStep(replyStep: MonitoringReadinessStep, env: MonitoringReadinessEnvironment): MonitoringReadinessStep {
  if (replyStep.state !== "ready") {
    return { key: "liveSend", state: "dry_run", reason: "reply_path_not_live_ready", action: "finish_reply_setup_first" }
  }
  if (!env.liveRepliesEnabled) {
    return { key: "liveSend", state: "dry_run", reason: "live_reply_disabled", action: "enable_live_reply_gate" }
  }
  return { key: "liveSend", state: "ready", reason: "live_reply_ready", action: "reply_after_policy" }
}

function overallReadiness(steps: MonitoringReadinessStep[]): MonitoringReadinessState {
  const collection = steps.find((step) => step.key === "collection")
  if (steps.some((step) => step.state === "blocked")) return "blocked"
  if (collection?.state === "disabled") return "disabled"
  if (steps.some((step) => step.state === "needs_setup")) return "needs_setup"
  if (steps.some((step) => step.state === "dry_run")) return "dry_run"
  if (steps.some((step) => step.state === "manual_only")) return "manual_only"
  return "ready"
}

export function buildMonitoringReadinessEnvironment(
  options: { liveRepliesEnabled?: boolean } = {},
): MonitoringReadinessEnvironment {
  return {
    searchIndexEnabled: process.env.SOCIAL_SEARCH_INDEX_ENABLED === "1",
    searchIndexEndpointConfigured: Boolean(process.env.SOCIAL_SEARCH_INDEX_ENDPOINT),
    searchIndexAllowlistConfigured: Boolean(process.env.SOCIAL_SEARCH_INDEX_ALLOWED_HOSTS),
    providerAllowlistConfigured: Boolean(process.env.SOCIAL_PROVIDER_ALLOWED_HOSTS),
    providerReplyAllowlistConfigured: Boolean(process.env.SOCIAL_REPLY_PROVIDER_ALLOWED_HOSTS),
    notificationInboxAllowlistConfigured: Boolean(process.env.SOCIAL_NOTIFICATION_INBOX_ALLOWED_HOSTS),
    browserCaptureEnabled: process.env.SOCIAL_BROWSER_CAPTURE_ENABLED === "1",
    youtubeApiKeyConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
    liveRepliesEnabled: options.liveRepliesEnabled ?? process.env.SOCIAL_LIVE_REPLY_ENABLED === "1",
  }
}

export function summarizeMonitoringReadiness(
  source: MonitoringReadinessSource,
  options: {
    accounts?: MonitoringReadinessAccount[]
    env?: MonitoringReadinessEnvironment
  } = {},
): MonitoringSourceReadiness {
  const env = options.env ?? buildMonitoringReadinessEnvironment()
  const accounts = options.accounts ?? []
  const collection = collectionReadinessStep(source, accounts, env)
  const reply = replyReadinessStep(source, accounts, env)
  const liveSend = liveSendReadinessStep(reply, env)
  const steps = [collection, reply, liveSend]
  const missing = steps
    .filter((step) => !["ready", "manual_only"].includes(step.state))
    .map((step) => step.action)

  return {
    overall: overallReadiness(steps),
    canCollect: collection.state === "ready",
    canReplyLive: reply.state === "ready" && liveSend.state === "ready",
    externalSendsDisabled: liveSend.state !== "ready",
    steps,
    missing: Array.from(new Set(missing)),
  }
}

export function redactMonitoringSettingsForResponse(settings: unknown): Record<string, unknown> {
  const sanitized = { ...recordFromUnknown(settings) }
  const searchIndex = recordFromUnknown(sanitized.searchIndex)
  if (Object.keys(searchIndex).length > 0) {
    const redactedSearchIndex = { ...searchIndex }
    delete redactedSearchIndex.token
    delete redactedSearchIndex.encryptedToken
    delete redactedSearchIndex.tokenPurpose
    delete redactedSearchIndex.tokenEnv
    if (stringValue(searchIndex.encryptedToken)) redactedSearchIndex.hasToken = true
    sanitized.searchIndex = redactedSearchIndex
  }

  const googleAlertsRss = recordFromUnknown(sanitized.googleAlertsRss)
  if (Object.keys(googleAlertsRss).length > 0) {
    const redactedGoogleAlertsRss = { ...googleAlertsRss }
    const configured = Boolean(stringValue(googleAlertsRss.encryptedFeedUrl))
    delete redactedGoogleAlertsRss.encryptedFeedUrl
    delete redactedGoogleAlertsRss.fingerprint
    redactedGoogleAlertsRss.configured = googleAlertsRss.configured === true && configured
    sanitized.googleAlertsRss = redactedGoogleAlertsRss
  }

  const provider = recordFromUnknown(sanitized.provider)
  if (Object.keys(provider).length === 0) return sanitized

  const reply = recordFromUnknown(provider.reply)
  const redactedProvider: Record<string, unknown> = {}
  const name = stringValue(provider.name)
  const endpoint = stringValue(provider.endpoint)
  const allowedHosts = stringListFromUnknown(provider.allowedHosts)
  if (name) redactedProvider.name = name
  if (provider.approved === true || provider.approved === false) redactedProvider.approved = provider.approved
  if (endpoint) redactedProvider.endpoint = endpoint
  if (allowedHosts.length > 0) redactedProvider.allowedHosts = allowedHosts
  if (stringValue(provider.encryptedToken)) redactedProvider.hasEncryptedToken = true

  const redactedReply: Record<string, unknown> = {}
  const replyName = stringValue(reply.name)
  const replyEndpoint = stringValue(reply.endpoint)
  const replyAllowedHosts = stringListFromUnknown(reply.allowedHosts)
  if (replyName) redactedReply.name = replyName
  if (reply.approved === true || reply.approved === false) redactedReply.approved = reply.approved
  if (replyEndpoint) redactedReply.endpoint = replyEndpoint
  if (replyAllowedHosts.length > 0) redactedReply.allowedHosts = replyAllowedHosts
  if (stringValue(reply.encryptedToken)) redactedReply.hasEncryptedToken = true
  if (Object.keys(redactedReply).length > 0) redactedProvider.reply = redactedReply

  if (Object.keys(redactedProvider).length > 0) sanitized.provider = redactedProvider
  else delete sanitized.provider
  return sanitized
}

function sanitizeMonitoringSettings(
  settings: Record<string, unknown> | undefined,
  blockedReasons: string[],
  expandedQueries: MonitoringQueryExpansion[],
  options?: {
    collectionMode?: MonitoringCollectionMode
    platform?: MonitoringPlatform
    url?: string | null
  },
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    ...recordFromUnknown(settings),
    blockedReasons,
    expandedQueries,
    queryExpansion: {
      strategy: "heuristic_v1",
      generatedAt: new Date().toISOString(),
    },
    liveExternalSendEnabled: false,
    autoReplyEnabled: false,
  }

  if (options?.collectionMode === "search_index" && options.platform) {
    const searchIndex = recordFromUnknown(sanitized.searchIndex)
    const defaultDomain = searchIndexDomainForTarget(options.platform, options.url ?? null)
    // Tenant JSON must never select a process environment variable. Older
    // rows may still contain tokenEnv; drop it whenever the row is normalized.
    const { tokenEnv: _legacyTokenEnv, ...safeSearchIndex } = searchIndex
    sanitized.searchIndex = {
      ...safeSearchIndex,
      ...(searchIndex.domain || !defaultDomain ? {} : { domain: defaultDomain }),
    }
  }

  const provider = sanitizeProviderSettings(sanitized.provider, options?.collectionMode)
  if (provider) sanitized.provider = provider
  else delete sanitized.provider

  return sanitized
}

export function buildMonitoringDuplicateWhere(input: NormalizedMonitoringSourceInput) {
  const base = {
    platform: input.platform,
    sourceType: input.sourceType,
    collectionMode: input.collectionMode,
  }
  if (input.url) return { ...base, url: input.url }
  if (input.query) return { ...base, query: input.query }
  if (input.handle) return { ...base, handle: input.handle }
  return base
}

export function summarizeSourceHealth(source: {
  status: string
  cadenceMinutes: number
  lastCheckedAt: Date | string | null
  lastSuccessfulAt: Date | string | null
  lastError: string | null
  collectorRuns?: Array<{
    id: string
    status: string
    startedAt: Date | string
    finishedAt: Date | string | null
    foundCount: number
    newCount: number
    duplicateCount: number
    ignoredCount: number
    error: string | null
  }>
}) {
  const lastChecked = source.lastCheckedAt ? new Date(source.lastCheckedAt).getTime() : 0
  const dueAt = lastChecked > 0 ? new Date(lastChecked + source.cadenceMinutes * 60_000) : null
  const due = source.status === "active" && (!dueAt || dueAt.getTime() <= Date.now())
  const lastRun = source.collectorRuns?.[0] ?? null
  return {
    state: source.lastError ? "degraded" : due ? "due" : source.status,
    due,
    dueAt: dueAt ? dueAt.toISOString() : null,
    lastCheckedAt: source.lastCheckedAt ? new Date(source.lastCheckedAt).toISOString() : null,
    lastSuccessfulAt: source.lastSuccessfulAt ? new Date(source.lastSuccessfulAt).toISOString() : null,
    lastError: source.lastError,
    lastRun,
  }
}
