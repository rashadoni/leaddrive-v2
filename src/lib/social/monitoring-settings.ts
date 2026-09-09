import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { encryptToken } from "@/lib/secure-token"
import { validateSocialOutboundEndpointForWrite } from "@/lib/social/social-outbound-http"

export const SOCIAL_MONITORING_SETTINGS_CHANNEL = "social_monitoring"
export const SOCIAL_MONITORING_SETTINGS_NAME = "Monitoring providers"
export const APIFY_SEARCH_HOST = "api.apify.com"
export const DEFAULT_SCHEDULE_CADENCE_MINUTES = 7 * 24 * 60
export const DEFAULT_REPORT_WINDOW_DAYS = 7

export const DEFAULT_APIFY_SEARCH_ACTORS = {
  webSearch: "apify/google-search-scraper",
  instagramProfile: "apify/instagram-scraper",
  instagramHashtag: "apify/instagram-hashtag-scraper",
  facebookSearch: "scrapeforge/facebook-search-posts",
  facebookPosts: "apify/facebook-posts-scraper",
  tiktokSearch: "clockworks/tiktok-scraper",
  instagramComments: "apify/instagram-comment-scraper",
  facebookComments: "apify/facebook-comments-scraper",
  tiktokComments: "clockworks/tiktok-comments-scraper",
} as const

export type SocialSearchProvider = "generic" | "apify"
export type ApifySearchActors = Record<keyof typeof DEFAULT_APIFY_SEARCH_ACTORS, string>

export type SocialMonitoringSettings = {
  schedule: {
    enabled: boolean
    cadenceMinutes: number
    reportWindowDays: number
    timeZone: string
  }
  searchIndex: {
    enabled: boolean
    provider: SocialSearchProvider
    endpoint: string | null
    allowedHosts: string[]
    limit: number | null
    includeComments: boolean
    encryptedToken: string | null
    hasToken: boolean
    apifyActors: ApifySearchActors
  }
  provider: {
    allowedHosts: string[]
    replyAllowedHosts: string[]
  }
}

export type PublicSocialMonitoringSettings = {
  schedule: {
    enabled: boolean
    cadenceMinutes: number
    reportWindowDays: number
    timeZone: string
  }
  searchIndex: {
    enabled: boolean
    provider: SocialSearchProvider
    endpoint: string | null
    allowedHosts: string[]
    limit: number | null
    includeComments: boolean
    hasToken: boolean
    apifyActors: ApifySearchActors
  }
  provider: {
    allowedHosts: string[]
    replyAllowedHosts: string[]
  }
}

export type SaveSocialMonitoringSettingsInput = {
  schedule?: {
    enabled?: boolean
    cadenceMinutes?: number
    reportWindowDays?: number
    timeZone?: string
  }
  searchIndex?: {
    enabled?: boolean
    provider?: SocialSearchProvider
    endpoint?: string | null
    allowedHosts?: string[] | string | null
    limit?: number | null
    includeComments?: boolean
    token?: string | null
    clearToken?: boolean
    apifyActors?: Partial<Record<keyof ApifySearchActors, string | null>>
  }
  provider?: {
    allowedHosts?: string[] | string | null
    replyAllowedHosts?: string[] | string | null
  }
}

type ChannelConfigForSettings = {
  id: string
  apiKey: string | null
  settings: unknown
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function searchProviderValue(value: unknown): SocialSearchProvider {
  return value === "apify" ? "apify" : "generic"
}

function normalizeActorId(value: unknown, fallback: string): string {
  const raw = stringValue(value)
  if (!raw) return fallback
  const normalized = raw.replace("~", "/")
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) return fallback
  return normalized
}

function normalizeApifyActors(value: unknown): ApifySearchActors {
  const record = recordFromUnknown(value)
  return {
    webSearch: normalizeActorId(record.webSearch, DEFAULT_APIFY_SEARCH_ACTORS.webSearch),
    instagramProfile: normalizeActorId(record.instagramProfile, DEFAULT_APIFY_SEARCH_ACTORS.instagramProfile),
    instagramHashtag: normalizeActorId(record.instagramHashtag, DEFAULT_APIFY_SEARCH_ACTORS.instagramHashtag),
    facebookSearch: normalizeActorId(record.facebookSearch, DEFAULT_APIFY_SEARCH_ACTORS.facebookSearch),
    facebookPosts: normalizeActorId(record.facebookPosts, DEFAULT_APIFY_SEARCH_ACTORS.facebookPosts),
    tiktokSearch: normalizeActorId(record.tiktokSearch, DEFAULT_APIFY_SEARCH_ACTORS.tiktokSearch),
    instagramComments: normalizeActorId(record.instagramComments, DEFAULT_APIFY_SEARCH_ACTORS.instagramComments),
    facebookComments: normalizeActorId(record.facebookComments, DEFAULT_APIFY_SEARCH_ACTORS.facebookComments),
    tiktokComments: normalizeActorId(record.tiktokComments, DEFAULT_APIFY_SEARCH_ACTORS.tiktokComments),
  }
}

export function parseHostList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : []
  return Array.from(new Set(
    raw
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .map((item) => item.replace(/^https?:\/\//, "").replace(/\/.*$/, "")),
  ))
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

function normalizeEndpoint(value: unknown, label: string): string | null {
  const raw = stringValue(value)
  if (!raw) return null

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

function normalizeLimit(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() ? Number(value) : numberValue(value)
  if (!Number.isFinite(n as number)) return null
  return Math.max(1, Math.min(100, Math.trunc(n as number)))
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "string" && value.trim() ? Number(value) : numberValue(value)
  if (!Number.isFinite(number as number)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(number as number)))
}

function normalizeTimeZone(value: unknown): string {
  const raw = stringValue(value) ?? "UTC"
  try {
    new Intl.DateTimeFormat("en", { timeZone: raw }).format(new Date(0))
    return raw
  } catch {
    return "UTC"
  }
}

function normalizeSettings(row: ChannelConfigForSettings | null): SocialMonitoringSettings {
  const settings = recordFromUnknown(row?.settings)
  const schedule = recordFromUnknown(settings.schedule)
  const searchIndex = recordFromUnknown(settings.searchIndex)
  const provider = recordFromUnknown(settings.provider)
  const searchProvider = searchProviderValue(searchIndex.provider)
  const searchEnabled = searchIndex.enabled === true
  return {
    schedule: {
      // New tenants and legacy rows use a weekly incremental schedule unless
      // an administrator explicitly disables or changes it. Manual runs do
      // not read this cadence and therefore remain an explicit exception.
      enabled: schedule.enabled !== false,
      cadenceMinutes: boundedInteger(
        schedule.cadenceMinutes,
        DEFAULT_SCHEDULE_CADENCE_MINUTES,
        15,
        31 * 24 * 60,
      ),
      reportWindowDays: boundedInteger(schedule.reportWindowDays, DEFAULT_REPORT_WINDOW_DAYS, 1, 31),
      timeZone: normalizeTimeZone(schedule.timeZone),
    },
    searchIndex: {
      enabled: searchEnabled,
      provider: searchProvider,
      endpoint: stringValue(searchIndex.endpoint),
      allowedHosts: parseHostList(searchIndex.allowedHosts),
      limit: normalizeLimit(searchIndex.limit),
      // External comments are part of the default Apify monitoring contract.
      // An explicit false remains a supported cost/coverage opt-out; legacy
      // Apify rows where the field was absent are upgraded without a backfill.
      includeComments: searchIndex.includeComments === true
        || (searchIndex.includeComments === undefined && searchEnabled && searchProvider === "apify"),
      encryptedToken: row?.apiKey || null,
      // Platform-level fallback: new tenants work out of the box when the
      // operator sets APIFY_API_TOKEN in the environment; an org token always
      // overrides it (and budgets stay per-org either way).
      hasToken: Boolean(row?.apiKey) || platformApifyTokenAvailable(),
      apifyActors: normalizeApifyActors(searchIndex.apifyActors),
    },
    provider: {
      allowedHosts: parseHostList(provider.allowedHosts),
      replyAllowedHosts: parseHostList(provider.replyAllowedHosts),
    },
  }
}

export function publicSocialMonitoringSettings(settings: SocialMonitoringSettings): PublicSocialMonitoringSettings {
  return {
    schedule: settings.schedule,
    searchIndex: {
      enabled: settings.searchIndex.enabled,
      provider: settings.searchIndex.provider,
      endpoint: settings.searchIndex.endpoint,
      allowedHosts: settings.searchIndex.allowedHosts,
      limit: settings.searchIndex.limit,
      includeComments: settings.searchIndex.includeComments,
      hasToken: settings.searchIndex.hasToken,
      apifyActors: settings.searchIndex.apifyActors,
    },
    provider: settings.provider,
  }
}

export function platformApifyToken(): string | null {
  const token = process.env.APIFY_API_TOKEN?.trim()
  return token || null
}

export function platformApifyTokenAvailable(): boolean {
  return Boolean(platformApifyToken())
}

export async function getSocialMonitoringSettings(organizationId: string): Promise<SocialMonitoringSettings> {
  const row = await prisma.channelConfig.findFirst({
    where: {
      organizationId,
      channelType: SOCIAL_MONITORING_SETTINGS_CHANNEL,
      configName: SOCIAL_MONITORING_SETTINGS_NAME,
    },
    select: { id: true, apiKey: true, settings: true },
  })
  return normalizeSettings(row)
}

export async function saveSocialMonitoringSettings(
  organizationId: string,
  input: SaveSocialMonitoringSettingsInput,
): Promise<SocialMonitoringSettings> {
  const existing = await prisma.channelConfig.findFirst({
    where: {
      organizationId,
      channelType: SOCIAL_MONITORING_SETTINGS_CHANNEL,
      configName: SOCIAL_MONITORING_SETTINGS_NAME,
    },
    select: { id: true, apiKey: true, settings: true },
  })
  const current = normalizeSettings(existing)
  const scheduleInput = input.schedule ?? {}
  const searchInput = input.searchIndex ?? {}
  const providerInput = input.provider ?? {}
  const searchProvider = searchInput.provider ?? current.searchIndex.provider
  const endpoint = searchInput.endpoint !== undefined
    ? normalizeEndpoint(searchInput.endpoint, "Search-index endpoint")
    : current.searchIndex.endpoint
  if (searchInput.endpoint !== undefined && endpoint) {
    await validateSocialOutboundEndpointForWrite(endpoint, "Search-index endpoint")
  }
  const allowedHosts = searchInput.allowedHosts !== undefined
    ? parseHostList(searchInput.allowedHosts)
    : current.searchIndex.allowedHosts
  if (endpoint) {
    const host = new URL(endpoint).hostname.toLowerCase()
    if (!allowedHosts.includes(host)) allowedHosts.push(host)
  }
  if (searchProvider === "apify" && !allowedHosts.includes(APIFY_SEARCH_HOST)) allowedHosts.push(APIFY_SEARCH_HOST)

  const next: SocialMonitoringSettings = {
    schedule: {
      enabled: scheduleInput.enabled ?? current.schedule.enabled,
      cadenceMinutes: scheduleInput.cadenceMinutes !== undefined
        ? boundedInteger(scheduleInput.cadenceMinutes, current.schedule.cadenceMinutes, 15, 31 * 24 * 60)
        : current.schedule.cadenceMinutes,
      reportWindowDays: scheduleInput.reportWindowDays !== undefined
        ? boundedInteger(scheduleInput.reportWindowDays, current.schedule.reportWindowDays, 1, 31)
        : current.schedule.reportWindowDays,
      timeZone: scheduleInput.timeZone !== undefined
        ? normalizeTimeZone(scheduleInput.timeZone)
        : current.schedule.timeZone,
    },
    searchIndex: {
      enabled: searchInput.enabled ?? current.searchIndex.enabled,
      provider: searchProvider,
      endpoint,
      allowedHosts,
      limit: searchInput.limit !== undefined ? normalizeLimit(searchInput.limit) : current.searchIndex.limit,
      includeComments: searchInput.includeComments
        ?? (searchInput.provider === "apify" && current.searchIndex.provider !== "apify"
          ? true
          : current.searchIndex.includeComments),
      encryptedToken: current.searchIndex.encryptedToken,
      hasToken: current.searchIndex.hasToken,
      apifyActors: searchInput.apifyActors !== undefined
        ? normalizeApifyActors({ ...current.searchIndex.apifyActors, ...recordFromUnknown(searchInput.apifyActors) })
        : current.searchIndex.apifyActors,
    },
    provider: {
      allowedHosts: providerInput.allowedHosts !== undefined ? parseHostList(providerInput.allowedHosts) : current.provider.allowedHosts,
      replyAllowedHosts: providerInput.replyAllowedHosts !== undefined ? parseHostList(providerInput.replyAllowedHosts) : current.provider.replyAllowedHosts,
    },
  }

  let apiKey: string | null | undefined = existing?.apiKey ?? null
  if (searchInput.clearToken === true) apiKey = null
  if (typeof searchInput.token === "string" && searchInput.token.trim()) {
    apiKey = encryptToken(searchInput.token.trim(), `social-search-index:${organizationId}`)
  }

  const settingsJson = {
    schedule: next.schedule,
    searchIndex: {
      enabled: next.searchIndex.enabled,
      provider: next.searchIndex.provider,
      endpoint: next.searchIndex.endpoint,
      allowedHosts: next.searchIndex.allowedHosts,
      limit: next.searchIndex.limit,
      includeComments: next.searchIndex.includeComments,
      apifyActors: next.searchIndex.apifyActors,
    },
    provider: {
      allowedHosts: next.provider.allowedHosts,
      replyAllowedHosts: next.provider.replyAllowedHosts,
    },
  }

  const saved = existing
    ? await prisma.channelConfig.update({
        where: { id: existing.id },
        data: { apiKey, settings: settingsJson as Prisma.InputJsonValue, isActive: true },
        select: { id: true, apiKey: true, settings: true },
      })
    : await prisma.channelConfig.create({
        data: {
          organizationId,
          channelType: SOCIAL_MONITORING_SETTINGS_CHANNEL,
          configName: SOCIAL_MONITORING_SETTINGS_NAME,
          apiKey,
          settings: settingsJson as Prisma.InputJsonValue,
          isActive: true,
        },
        select: { id: true, apiKey: true, settings: true },
      })

  return normalizeSettings(saved)
}

export function mergeMonitoringSettingsIntoSourceSettings(
  sourceSettings: unknown,
  monitoringSettings: SocialMonitoringSettings,
  source: { organizationId: string; collectionMode: string },
): Record<string, unknown> {
  const settings = { ...recordFromUnknown(sourceSettings) }

  if (source.collectionMode === "search_index") {
    const searchIndex = { ...recordFromUnknown(settings.searchIndex) }
    if (monitoringSettings.searchIndex.enabled && searchIndex.approved !== false) searchIndex.approved = true
    if (!stringValue(searchIndex.provider)) searchIndex.provider = monitoringSettings.searchIndex.provider
    searchIndex.apifyActors = {
      ...monitoringSettings.searchIndex.apifyActors,
      ...recordFromUnknown(searchIndex.apifyActors),
    }
    if (!stringValue(searchIndex.endpoint) && monitoringSettings.searchIndex.endpoint) {
      searchIndex.endpoint = monitoringSettings.searchIndex.endpoint
    }
    if (!numberValue(searchIndex.limit) && monitoringSettings.searchIndex.limit) {
      searchIndex.limit = monitoringSettings.searchIndex.limit
    }
    if (searchIndex.includeComments === undefined && monitoringSettings.searchIndex.includeComments) {
      searchIndex.includeComments = true
    }
    if (!stringValue(searchIndex.encryptedToken) && monitoringSettings.searchIndex.encryptedToken) {
      searchIndex.encryptedToken = monitoringSettings.searchIndex.encryptedToken
      searchIndex.tokenPurpose = `social-search-index:${source.organizationId}`
    }
    const hosts = parseHostList(searchIndex.allowedHosts)
    for (const host of monitoringSettings.searchIndex.allowedHosts) {
      if (!hosts.includes(host)) hosts.push(host)
    }
    if (hosts.length > 0) searchIndex.allowedHosts = hosts
    settings.searchIndex = searchIndex
  }

  if (source.collectionMode === "provider_api") {
    const provider = { ...recordFromUnknown(settings.provider) }
    const hosts = parseHostList(provider.allowedHosts)
    for (const host of monitoringSettings.provider.allowedHosts) {
      if (!hosts.includes(host)) hosts.push(host)
    }
    if (hosts.length > 0) provider.allowedHosts = hosts

    const reply = { ...recordFromUnknown(provider.reply) }
    const replyHosts = parseHostList(reply.allowedHosts)
    for (const host of monitoringSettings.provider.replyAllowedHosts) {
      if (!replyHosts.includes(host)) replyHosts.push(host)
    }
    if (replyHosts.length > 0) reply.allowedHosts = replyHosts
    if (Object.keys(reply).length > 0) provider.reply = reply
    settings.provider = provider
  }

  return settings
}
