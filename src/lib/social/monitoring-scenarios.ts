import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  buildMonitoringDuplicateWhere,
  normalizeMonitoringSourceInput,
  type CreateMonitoringSourceBody,
  type MonitoringPlatform,
} from "@/lib/social/monitoring-source"
import { defaultAliasAmbiguity, normalizeSubjectTerm } from "@/lib/social/monitoring-subjects"
import { isSocialBrandProtectionOnly } from "@/lib/social/brand-protection"
import { ensureSocialMonitoringTenantDefaults } from "@/lib/social/tenant-defaults"
import {
  findProtectedMonitoringIdentityCollision,
  OFFICIAL_IDENTITY_NOT_COLLECTABLE,
} from "@/lib/social/monitoring-source-protection"
import {
  isGoogleAlertsRssSource,
  syncGoogleAlertsRssSource,
} from "@/lib/social/google-alerts-rss"

export const SOCIAL_MONITORING_SCENARIOS_CHANNEL = "social_monitoring"
export const SOCIAL_MONITORING_SCENARIOS_NAME = "Monitoring scenarios"

export const MONITORING_SCENARIO_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "twitter",
  "youtube",
  "web",
] as const

export const MONITORING_SCENARIO_ACTIONS = [
  "show_only",
  "alert",
  "draft_reply",
  "create_lead",
  "escalate",
] as const

export const MONITORING_SCENARIO_REPLY_MODES = [
  "draft_only",
  "manual_approval",
  "safe_template_dry_run",
] as const

export const MONITORING_SCENARIO_SENTIMENTS = [
  "negative",
  "positive",
  "neutral",
  "question",
  "lead",
  "complaint",
] as const

/**
 * Analysis directions are CLASSIFICATION over one collected dataset, never a
 * collection input. They live under `ai` precisely because the two functions
 * that can cost money or invalidate stored work — scenarioSourceTargets() and
 * archiveMatchSignature() — read only `platforms` + `search`. Enabling a second
 * direction therefore cannot add a provider source or force a re-backfill.
 * Keep it that way: never read `ai.directions` from either of those.
 */
export const MONITORING_SCENARIO_DIRECTIONS = [
  "general_reputation",
  "customer_complaints",
] as const

export type MonitoringScenarioPlatform = typeof MONITORING_SCENARIO_PLATFORMS[number]
export type MonitoringScenarioAction = typeof MONITORING_SCENARIO_ACTIONS[number]
export type MonitoringScenarioReplyMode = typeof MONITORING_SCENARIO_REPLY_MODES[number]
export type MonitoringScenarioSentiment = typeof MONITORING_SCENARIO_SENTIMENTS[number]
export type MonitoringScenarioDirection = typeof MONITORING_SCENARIO_DIRECTIONS[number]
export type MonitoringScenarioStatus = "active" | "paused" | "draft"
export type MonitoringScenarioArchiveStatus = "pending" | "complete" | "partial" | "failed"

export type MonitoringScenario = {
  id: string
  subjectId: string | null
  subjectName: string | null
  name: string
  description: string | null
  status: MonitoringScenarioStatus
  platforms: MonitoringScenarioPlatform[]
  search: {
    topics: string[]
    keywords: string[]
    hashtags: string[]
    handles: string[]
    urls: string[]
    useHashtagFallback: boolean
    includeOwnedComments: boolean
    // Comments under OTHER people's posts, collected by the Apify comments pass
    // (instagram/facebook/tiktok). Three-state: true/false are explicit choices
    // stamped onto managed search sources as settings.searchIndex.includeComments;
    // null = not chosen (legacy scenarios) → inherit the org-global provider
    // toggle, so re-saving an old scenario can never silently start paid scraping.
    includeExternalComments: boolean | null
  }
  web?: {
    sourceMode: "direct_publishers" | "google_alerts_rss"
    googleAlertsRssConfigured: boolean
  }
  ai: {
    sentiments: MonitoringScenarioSentiment[]
    minConfidence: number
    action: MonitoringScenarioAction
    directions: MonitoringScenarioDirection[]
  }
  reply: {
    identityId: string | null
    identityLabel: string | null
    mode: MonitoringScenarioReplyMode
    autoReplyEnabled: boolean
    liveSendAllowed: false
  }
  archive: {
    startAt: string | null
    lastBackfilledAt: string | null
    scannedCount: number
    matchedCount: number
    status: MonitoringScenarioArchiveStatus
  }
  createdAt: string
  updatedAt: string
}

export type MonitoringScenarioCollectionPlan = Pick<
  MonitoringScenario,
  "id" | "platforms" | "search" | "web"
>

export type MonitoringScenarioInput = {
  subjectId?: string | null
  subjectName?: string | null
  name?: string | null
  description?: string | null
  status?: string | null
  platforms?: string[] | string | null
  topics?: string[] | string | null
  keywords?: string[] | string | null
  hashtags?: string[] | string | null
  /** @deprecated Accepted for rolling-client compatibility and always ignored. */
  handles?: string[] | string | null
  /** @deprecated Accepted for rolling-client compatibility and always ignored. */
  urls?: string[] | string | null
  useHashtagFallback?: boolean | null
  includeOwnedComments?: boolean | null
  includeExternalComments?: boolean | null
  sentiments?: string[] | string | null
  minConfidence?: number | string | null
  action?: string | null
  directions?: string[] | string | null
  replyIdentityId?: string | null
  replyIdentityLabel?: string | null
  replyMode?: string | null
  autoReplyEnabled?: boolean | null
  archiveStartAt?: string | null
  /**
   * Write-only. The feed URL is encrypted into its dedicated MonitoringSource
   * and is never persisted in, or returned with, the scenario JSON.
   *
   * undefined = keep the current binding; null = disconnect it.
   */
  googleAlertsRssUrl?: string | null
  /** Internal parser hint for the non-secret persisted scenario flag. */
  googleAlertsRssConfigured?: boolean | null
}

export const SOCIAL_SCENARIO_MATCH_VERSION = "social_scenario_match_v1"
export const SOCIAL_SCENARIO_SOURCE_MANAGER = "monitoring_scenario"
const LEGACY_SCENARIO_DIRECT_SOURCE_TYPES = new Set(["profile", "page", "competitor", "influencer"])

export type MonitoringScenarioTargetType = "topic" | "keyword" | "hashtag" | "handle" | "url"

export type MonitoringScenarioMentionInput = {
  organizationId: string
  platform: string
  sourceType?: string | null
  sourceProvider?: string | null
  sourceMetadata?: Record<string, unknown>
  text: string
  matchedTerm?: string | null
  url?: string | null
  authorHandle?: string | null
}

export type MonitoringScenarioMatch = {
  scenarioId: string
  scenarioName: string
  action: MonitoringScenarioAction
  sentiments: MonitoringScenarioSentiment[]
  minConfidence: number
  matchedConfidence: number
  matchedTargets: Array<{ type: MonitoringScenarioTargetType; value: string }>
  reply: MonitoringScenario["reply"]
}

type ScenarioConfigRow = {
  id: string
  settings: unknown
}

type ScenarioDbClient = Pick<
  Prisma.TransactionClient,
  | "channelConfig"
  | "monitoringSource"
  | "monitoringSubjectSource"
  | "monitoringSubject"
  | "monitoringSubjectAlias"
>

function scenarioWriteLockKey(organizationId: string): string {
  return `social-monitoring-scenarios:${organizationId}`
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function applySelectiveTikTokSourcePolicy<T extends { platform: string; ownership: string; cadenceMinutes: number; settings: unknown }>(source: T): T {
  if (source.platform !== "tiktok" || source.ownership !== "external") return source
  const existingSelective = recordFromUnknown(recordFromUnknown(source.settings).selectiveDiscovery)
  return {
    ...source,
    cadenceMinutes: 1440,
    settings: {
      ...recordFromUnknown(source.settings),
      selectiveDiscovery: {
        contractVersion: "tiktok-selective-query-pack-v1",
        candidateOnly: true,
        arbitraryVideoScanAllowed: false,
        // Раньше здесь безусловно стояло liveRoutingAllowed: false, и это
        // означало «TikTok не собирается по расписанию НИКОГДА» — сбор шёл
        // только по кнопке. На проде это было незаметно: источники активны,
        // частота задана, а обход их молча пропускал (прод, 2026-08-03: шесть
        // брендов, ноль автосборов). Пометка больше не ставится новым
        // источникам; уже выставленный оператором запрет уважается, чтобы
        // пересохранение сценария не начинало тратить чужие деньги само.
        ...(existingSelective.liveRoutingAllowed === false
          ? { liveRoutingAllowed: false }
          : {}),
      },
    },
  }
}

export function applySelectiveYouTubeSourcePolicy<T extends {
  platform: string
  ownership: string
  collectionMode?: string
  cadenceMinutes: number
  status?: string
  settings: unknown
}>(source: T): T {
  if (source.platform !== "youtube" || source.ownership !== "external") return source
  return {
    ...source,
    // External YouTube keyword discovery is implemented by the official
    // Data API adapter. Leaving the generic keyword classification intact
    // marks a freshly synced source as search_index/needs_setup, so cron never
    // reaches the already-configured YouTube route.
    collectionMode: "official_api",
    cadenceMinutes: 1440,
    status: "limited",
    settings: {
      ...recordFromUnknown(source.settings),
      selectiveDiscovery: {
        contractVersion: "youtube-selective-query-pack-v1",
        candidateOnly: true,
        commentsRequireMatched: true,
        arbitraryVideoScanAllowed: false,
        liveReplies: false,
      },
    },
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function parseStringList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : []
  return Array.from(new Set(
    raw
      .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 40),
  ))
}

function normalizeKeyword(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 120)
}

function normalizeHashtag(value: string): string {
  return value.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase().slice(0, 80)
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").toLowerCase().slice(0, 120)
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function normalizeLooseText(value: string | null | undefined): string {
  return (value ?? "").toLocaleLowerCase("az").replace(/\s+/g, " ").trim()
}

function normalizeCompactText(value: string | null | undefined): string {
  return normalizeLooseText(value).replace(/[^\p{L}\p{N}_@#./:-]+/gu, "")
}

function extractHashtags(value: string | null | undefined): string[] {
  const text = value ?? ""
  const tags = Array.from(text.matchAll(/#([\p{L}\p{N}_]+)/gu)).map((match) => normalizeHashtag(match[1] ?? ""))
  try {
    const url = new URL(text)
    const parts = url.pathname.split("/").map((part) => part.trim().toLowerCase()).filter(Boolean)
    const directTagIndex = parts.findIndex((part) => ["tag", "tags", "hashtag"].includes(part))
    const exploreTagIndex = parts.findIndex((part, index) => part === "explore" && ["tag", "tags", "hashtag"].includes(parts[index + 1] ?? ""))
    const tagValue = directTagIndex >= 0
      ? parts[directTagIndex + 1]
      : exploreTagIndex >= 0
        ? parts[exploreTagIndex + 2]
        : null
    const tag = normalizeHashtag(tagValue ?? "")
    if (tag) {
      tags.push(tag)
    }
  } catch {
    // Not a URL; text hashtags above are enough.
  }
  return Array.from(new Set(tags.filter(Boolean)))
}

function platformMatchesScenario(scenario: MonitoringScenario, input: MonitoringScenarioMentionInput): boolean {
  const platform = input.platform.toLowerCase()
  if (scenario.platforms.includes(platform as MonitoringScenarioPlatform)) return true
  return scenario.platforms.includes("web") && (platform === "web" || input.sourceProvider === "search_index")
}

function normalizeList(value: unknown, normalize: (item: string) => string | null): string[] {
  return Array.from(new Set(
    parseStringList(value)
      .map(normalize)
      .filter((item): item is string => Boolean(item)),
  ))
}

function normalizePlatforms(value: unknown): MonitoringScenarioPlatform[] {
  const allowed = new Set<string>(MONITORING_SCENARIO_PLATFORMS)
  const platforms = parseStringList(value)
    .map((item) => item.toLowerCase())
    .filter((item): item is MonitoringScenarioPlatform => allowed.has(item))
  return platforms.length > 0 ? Array.from(new Set(platforms)) : ["instagram", "facebook", "tiktok"]
}

function normalizeSentiments(value: unknown): MonitoringScenarioSentiment[] {
  const allowed = new Set<string>(MONITORING_SCENARIO_SENTIMENTS)
  const sentiments = parseStringList(value)
    .map((item) => item.toLowerCase())
    .filter((item): item is MonitoringScenarioSentiment => allowed.has(item))
  return sentiments.length > 0 ? Array.from(new Set(sentiments)) : ["negative", "complaint", "lead"]
}

/**
 * Legacy scenarios predate directions and fall back to general_reputation —
 * "everything said about this brand, no complaint-specific filter" is what they
 * already do, so the fallback describes them rather than changing them.
 */
function normalizeDirections(value: unknown): MonitoringScenarioDirection[] {
  const allowed = new Set<string>(MONITORING_SCENARIO_DIRECTIONS)
  const directions = parseStringList(value)
    .map((item) => item.toLowerCase())
    .filter((item): item is MonitoringScenarioDirection => allowed.has(item))
  return directions.length > 0 ? Array.from(new Set(directions)) : ["general_reputation"]
}

function normalizeAction(value: unknown): MonitoringScenarioAction {
  return MONITORING_SCENARIO_ACTIONS.includes(value as MonitoringScenarioAction)
    ? value as MonitoringScenarioAction
    : "draft_reply"
}

function normalizeReplyMode(value: unknown): MonitoringScenarioReplyMode {
  return MONITORING_SCENARIO_REPLY_MODES.includes(value as MonitoringScenarioReplyMode)
    ? value as MonitoringScenarioReplyMode
    : "manual_approval"
}

function normalizeStatus(value: unknown): MonitoringScenarioStatus {
  return value === "paused" || value === "draft" ? value : "active"
}

function normalizeConfidence(value: unknown): number {
  const raw = typeof value === "string" && value.trim() ? Number(value) : value
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 80
  return Math.max(1, Math.min(100, Math.trunc(raw)))
}

function normalizeArchiveStartAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const raw = value.trim()
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw)
  if (!Number.isFinite(parsed.getTime())) return null
  return new Date(Math.min(parsed.getTime(), Date.now())).toISOString()
}

/**
 * The archive-invalidation contract: which fields, when changed, force a
 * re-backfill. Exported so the direction-isolation regression can assert that
 * `ai.directions` is not one of them.
 */
export function archiveMatchSignature(input: Pick<MonitoringScenario, "platforms" | "search">): string {
  return JSON.stringify({
    platforms: input.platforms,
    topics: input.search.topics,
    keywords: input.search.keywords,
    hashtags: input.search.hashtags,
    includeOwnedComments: input.search.includeOwnedComments,
    includeExternalComments: input.search.includeExternalComments,
  })
}

export function suggestScenarioSearch(input: {
  topics?: unknown
  keywords?: unknown
  hashtags?: unknown
  /** @deprecated Ignored; direct targets belong to Sources. */
  handles?: unknown
  /** @deprecated Ignored; direct targets belong to Sources. */
  urls?: unknown
}): MonitoringScenario["search"] {
  const topics = normalizeList(input.topics, normalizeKeyword)
  const keywords = normalizeList(input.keywords, normalizeKeyword)
  const baseTerms = Array.from(new Set([...topics, ...keywords]))
  const generatedHashtags = baseTerms
    .map((term) => normalizeHashtag(term))
    .filter((term) => term.length > 1)

  return {
    topics,
    keywords,
    hashtags: Array.from(new Set([
      ...normalizeList(input.hashtags, normalizeHashtag),
      ...generatedHashtags,
    ])).slice(0, 40),
    // Direct pages, profiles and post URLs belong to the independent Sources
    // registry. Keep the legacy response fields empty so old clients can still
    // parse the scenario shape without being able to recreate direct sources.
    handles: [],
    urls: [],
    useHashtagFallback: true,
    includeOwnedComments: true,
    // No silent opt-in to paid comment scraping: an explicit choice comes from the UI.
    includeExternalComments: null,
  }
}

function matchScenarioTargets(
  scenario: MonitoringScenario,
  input: MonitoringScenarioMentionInput,
): MonitoringScenarioMatch["matchedTargets"] {
  const text = normalizeLooseText(input.text)
  const matchedTerm = normalizeLooseText(input.matchedTerm)
  const compact = normalizeCompactText([input.text, input.matchedTerm, input.authorHandle, input.url].filter(Boolean).join(" "))
  const hashtags = new Set([
    ...extractHashtags(input.text),
    ...extractHashtags(input.matchedTerm),
    ...extractHashtags(input.url),
  ])
  const matches: MonitoringScenarioMatch["matchedTargets"] = []

  for (const topic of scenario.search.topics) {
    const target = normalizeLooseText(topic)
    if (target && (text.includes(target) || matchedTerm.includes(target))) {
      matches.push({ type: "topic", value: topic })
    }
  }
  for (const keyword of scenario.search.keywords) {
    const target = normalizeLooseText(keyword)
    if (target && (text.includes(target) || matchedTerm.includes(target))) {
      matches.push({ type: "keyword", value: keyword })
    }
  }
  for (const hashtag of scenario.search.hashtags) {
    const target = normalizeHashtag(hashtag)
    if (target && (hashtags.has(target) || compact.includes(`#${target}`) || compact.includes(`/tags/${target}`) || matchedTerm === target)) {
      matches.push({ type: "hashtag", value: target })
    }
  }
  const seen = new Set<string>()
  return matches.filter((match) => {
    const key = `${match.type}:${match.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Per-scenario comment gates. EXTERNAL comments are the ones found by scrapers /
 * search providers (the "search" stream); everything else with sourceType "comment"
 * — native pollers, Meta webhook, Chatwoot bridge, tiktok-organic webhook — arrives
 * through the org's OWN connected accounts and honors includeOwnedComments.
 * includeExternalComments === null (legacy, no explicit choice) allows matching:
 * whether such comments exist at all is governed by the org-global collection toggle.
 * Posts/mentions/DMs are unaffected.
 */
const EXTERNAL_COMMENT_PROVIDERS = new Set(["search_index", "provider_api", "browser_capture", "notification_inbox"])

function scenarioAllowsInputSurface(scenario: MonitoringScenario, input: MonitoringScenarioMentionInput): boolean {
  if (input.sourceType !== "comment") return true
  if (EXTERNAL_COMMENT_PROVIDERS.has(input.sourceProvider ?? "")) {
    return scenario.search.includeExternalComments !== false
  }
  return scenario.search.includeOwnedComments
}

export function findMonitoringScenarioMatches(
  scenarios: MonitoringScenario[],
  input: MonitoringScenarioMentionInput,
): MonitoringScenarioMatch[] {
  return scenarios
    .filter((scenario) => scenario.status === "active" && platformMatchesScenario(scenario, input) && scenarioAllowsInputSurface(scenario, input))
    .map((scenario) => {
      const matchedTargets = matchScenarioTargets(scenario, input)
      if (matchedTargets.length === 0) return null
      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        action: scenario.ai.action,
        sentiments: scenario.ai.sentiments,
        minConfidence: scenario.ai.minConfidence,
        matchedConfidence: Math.min(100, 70 + matchedTargets.length * 10 + (input.matchedTerm ? 10 : 0)),
        matchedTargets,
        reply: scenario.reply,
      } satisfies MonitoringScenarioMatch
    })
    .filter((match): match is MonitoringScenarioMatch => Boolean(match))
}

export function mergeMonitoringScenarioMatchesIntoMetadata(
  sourceMetadata: unknown,
  matches: MonitoringScenarioMatch[],
  matchedAt = new Date().toISOString(),
  preserveExistingMatches = true,
): Record<string, unknown> {
  const metadata = recordFromUnknown(sourceMetadata)
  const currentScenario = recordFromUnknown(metadata.socialScenario)
  const currentMatches = preserveExistingMatches && Array.isArray(currentScenario.matches)
    ? currentScenario.matches.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : []
  const incomingIds = new Set(matches.map((match) => match.scenarioId))
  const combinedMatches = [
    ...matches.map((match) => ({
      scenarioId: match.scenarioId,
      scenarioName: match.scenarioName,
      action: match.action,
      sentiments: match.sentiments,
      minConfidence: match.minConfidence,
      matchedConfidence: match.matchedConfidence,
      matchedTargets: match.matchedTargets,
      reply: match.reply,
    })),
    ...currentMatches.filter((match) => typeof match.scenarioId !== "string" || !incomingIds.has(match.scenarioId)),
  ]
  const primary = combinedMatches.find((match) => match.action !== "show_only") ?? combinedMatches[0]
  return {
    ...metadata,
    socialScenario: {
      ...currentScenario,
      version: SOCIAL_SCENARIO_MATCH_VERSION,
      matchedAt,
      primaryScenarioId: typeof primary?.scenarioId === "string" ? primary.scenarioId : null,
      primaryScenarioName: typeof primary?.scenarioName === "string" ? primary.scenarioName : null,
      primaryAction: typeof primary?.action === "string" ? primary.action : "show_only",
      primaryReply: recordFromUnknown(primary?.reply),
      matches: combinedMatches,
      liveSendAllowed: false,
    },
  }
}

export async function applyMonitoringScenariosToMentionInput<T extends MonitoringScenarioMentionInput>(input: T): Promise<T> {
  const scenarios = await getMonitoringScenarios(input.organizationId)
  if (scenarios.length === 0) return input

  const targetScenarioId = stringValue(recordFromUnknown(input.sourceMetadata).targetScenarioId)
  const relevantScenarios = targetScenarioId
    ? scenarios.filter(scenario => scenario.id === targetScenarioId)
    : scenarios
  const matches = findMonitoringScenarioMatches(relevantScenarios, input)
  if (matches.length === 0) return input

  const sourceMetadata = mergeMonitoringScenarioMatchesIntoMetadata(input.sourceMetadata, matches, new Date().toISOString(), false)
  const firstTarget = matches[0]?.matchedTargets[0]?.value ?? null
  return {
    ...input,
    matchedTerm: input.matchedTerm ?? firstTarget,
    sourceMetadata,
  } as T
}

export type ScenarioMonitoringSourceTarget = {
  targetType: MonitoringScenarioTargetType
  targetValue: string
  input: CreateMonitoringSourceBody
}

type ScenarioManagedSourceRow = {
  id: string
  platform: string
  sourceType: string
  collectionMode: string
  url: string | null
  query: string | null
  handle: string | null
  settings: unknown
}

function scenarioSourceKey(input: {
  platform: string
  sourceType: string
  collectionMode: string
  url?: string | null
  query?: string | null
  handle?: string | null
}): string {
  return [
    input.platform,
    input.sourceType,
    input.collectionMode,
    input.url ?? "",
    input.query ?? "",
    input.handle ?? "",
  ].join("|")
}

function scenarioMonitoringPlatforms(scenario: MonitoringScenarioCollectionPlan): MonitoringScenarioPlatform[] {
  return scenario.platforms
}

function scenarioSourceLink(scenario: MonitoringScenario, target: ScenarioMonitoringSourceTarget): Record<string, unknown> {
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    subjectId: scenario.subjectId,
    subjectName: scenario.subjectName,
    targetType: target.targetType,
    targetValue: target.targetValue,
    action: scenario.ai.action,
    sentiments: scenario.ai.sentiments,
    minConfidence: scenario.ai.minConfidence,
    replyIdentityId: scenario.reply.identityId,
    replyIdentityLabel: scenario.reply.identityLabel,
    replyMode: scenario.reply.mode,
    liveSendAllowed: false,
    archiveStartAt: scenario.archive.startAt,
  }
}

export function mergeScenarioSourceLink(
  settings: unknown,
  scenario: MonitoringScenario,
  target: ScenarioMonitoringSourceTarget,
  managed: boolean,
): Record<string, unknown> {
  const current = recordFromUnknown(settings)
  const link = scenarioSourceLink(scenario, target)
  const existingLinks = Array.isArray(current.scenarioLinks)
    ? current.scenarioLinks.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : []
  const nextLinks = [
    link,
    ...existingLinks.filter((item) => (
      item.scenarioId !== scenario.id ||
      item.targetType !== target.targetType ||
      item.targetValue !== target.targetValue
    )),
  ].slice(0, 25)

  return {
    ...current,
    ...(managed ? {
      managedBy: SOCIAL_SCENARIO_SOURCE_MANAGER,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      scenarioTargetType: target.targetType,
      scenarioTargetValue: target.targetValue,
    } : {}),
    // Per-scenario external-comments choice rides on the source itself: the tenant
    // merge only fills searchIndex.includeComments when it is undefined, so without
    // this stamp the Apify comments pass would depend solely on the org-global
    // provider toggle. ONLY explicit choices are stamped — null (legacy scenario)
    // leaves the key alone so re-saving an old scenario can't start paid scraping.
    // A non-owning linked scenario may only turn comments ON (never override the
    // owner's explicit false with silence): collection is OR across scenarios,
    // per-scenario filtering happens at match time.
    ...(managed && scenario.search.includeExternalComments !== null ? {
      searchIndex: {
        ...recordFromUnknown(current.searchIndex),
        includeComments: scenario.search.includeExternalComments,
      },
    } : {}),
    ...(!managed && scenario.search.includeExternalComments === true ? {
      searchIndex: {
        ...recordFromUnknown(current.searchIndex),
        includeComments: true,
      },
    } : {}),
    scenarioLinks: nextLinks,
    liveExternalSendEnabled: false,
    autoReplyEnabled: false,
  }
}

/**
 * Provider cursors are runtime state, not scenario form state. Re-saving the
 * same managed acquisition target must preserve its route-scoped checkpoints,
 * while a changed archive/subject/target scope must start from the scenario's
 * newly requested lower bound.
 */
export function preserveManagedScenarioRouteProviderCursors(
  linkedSettings: unknown,
  existingSettings: unknown,
  scenario: MonitoringScenario,
  target: ScenarioMonitoringSourceTarget,
): Record<string, unknown> {
  const next = recordFromUnknown(linkedSettings)
  const current = recordFromUnknown(existingSettings)
  if (
    current.managedBy !== SOCIAL_SCENARIO_SOURCE_MANAGER
    || current.scenarioId !== scenario.id
  ) return next

  const existingLinks = Array.isArray(current.scenarioLinks)
    ? current.scenarioLinks
      .map(recordFromUnknown)
      .filter(link => (
        link.scenarioId === scenario.id
        && link.targetType === target.targetType
        && link.targetValue === target.targetValue
      ))
    : []
  const sameScope = existingLinks.some(link => (
    (stringValue(link.subjectId) ?? null) === (scenario.subjectId ?? null)
    && (stringValue(link.archiveStartAt) ?? null) === (scenario.archive.startAt ?? null)
  ))
  if (!sameScope) return next

  const routeProviderCursors = recordFromUnknown(
    recordFromUnknown(current.searchIndex).routeProviderCursors,
  )
  if (Object.keys(routeProviderCursors).length === 0) return next

  return {
    ...next,
    searchIndex: {
      ...recordFromUnknown(next.searchIndex),
      routeProviderCursors,
    },
  }
}

/**
 * Every managed provider source a scenario will create. Exported so the profile
 * layer can preview them and so the direction-isolation regression can assert
 * this output is byte-identical across direction sets.
 */
export function scenarioSourceTargets(scenario: MonitoringScenarioCollectionPlan): ScenarioMonitoringSourceTarget[] {
  const platforms = scenarioMonitoringPlatforms(scenario)
  const targets: ScenarioMonitoringSourceTarget[] = []
  const seen = new Set<string>()
  function push(platform: MonitoringPlatform, targetType: MonitoringScenarioTargetType, targetValue: string, input: CreateMonitoringSourceBody) {
    const key = `${platform}:${targetType}:${targetValue.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    targets.push({ targetType, targetValue, input })
  }

  for (const platform of platforms) {
    if (
      platform === "youtube"
      || platform === "tiktok"
      || platform === "facebook"
      || platform === "instagram"
    ) {
      const canonicalQuery = scenario.search.topics[0]?.trim()
        || scenario.search.keywords[0]?.trim()
      if (canonicalQuery) {
        const aliases = [
          ...scenario.search.topics.slice(1),
          ...scenario.search.keywords,
          ...scenario.search.hashtags.map(normalizeHashtag),
        ].filter(term => term.trim() && normalizeSubjectTerm(term) !== normalizeSubjectTerm(canonicalQuery))
        const query = canonicalQuery
        push(platform, "keyword", query, {
          platform,
          sourceType: "keyword",
          query,
          keywords: [],
          ownership: "external",
          settings: { canonicalBrandQuery: true, aliases, searchFanOutTerms: aliases },
        })
      }
    } else if (platform === "web") {
      // Решение владельца 2026-08-01: веб покрывается ТОЛЬКО лентами Google
      // Alerts. Прежний канонический источник обходил фиксированный список
      // азербайджанских изданий с нашей же инфраструктуры — это и рамки для
      // глобального по своей природе поиска, и лишняя нагрузка на площадки.
      // Google Alerts индексирует те же издания, поэтому покрытие не теряется,
      // а веб-находки клиента теперь зависят от подключённой ленты.
      continue
    } else {
      const canonicalQuery = scenario.search.topics[0]?.trim()
        || scenario.search.keywords[0]?.trim()
      if (canonicalQuery) {
        const aliases = [
          ...scenario.search.topics.slice(1),
          ...scenario.search.keywords,
          ...scenario.search.hashtags.map(normalizeHashtag),
        ].filter(term => term.trim() && normalizeSubjectTerm(term) !== normalizeSubjectTerm(canonicalQuery))
        push(platform, "topic", canonicalQuery, {
          platform,
          sourceType: "keyword",
          query: canonicalQuery,
          keywords: [],
          ownership: "external",
          settings: { canonicalBrandQuery: true, aliases, searchFanOutTerms: aliases },
        })
      }
    }
  }

  return targets
}

type ScenarioSourceCandidate = {
  platform: string
  sourceType?: string | null
  collectionMode?: string | null
  url?: string | null
  query?: string | null
  handle?: string | null
  settings?: unknown
}

function scenarioTargetNormalizedSource(target: ScenarioMonitoringSourceTarget) {
  return applySelectiveYouTubeSourcePolicy(
    applySelectiveTikTokSourcePolicy(
      normalizeMonitoringSourceInput(target.input),
    ),
  )
}

function normalizedScenarioSourceKey(source: ScenarioSourceCandidate): string {
  return scenarioSourceKey({
    platform: source.platform.trim().toLowerCase(),
    sourceType: source.sourceType?.trim() ?? "",
    collectionMode: source.collectionMode?.trim() ?? "",
    url: source.url ? normalizeUrl(source.url) : null,
    query: source.query?.trim().toLowerCase() || null,
    handle: source.handle ? normalizeHandle(source.handle) : null,
  })
}

/**
 * Current collection-plan membership is structural. Historical scenario IDs in
 * a source/link/route plan may restrict a matching source, but they can never
 * make a source that is absent from today's scenarioSourceTargets executable.
 *
 * Google Alerts RSS is synchronized outside scenarioSourceTargets(); for WEB
 * it is now the ONLY collectable source, so every other web row — including
 * the retired canonical direct-search query — is deliberately unmatched here.
 */
export function monitoringSourceMatchesCurrentScenarioTarget(
  scenario: MonitoringScenarioCollectionPlan,
  source: ScenarioSourceCandidate,
): boolean {
  const platform = source.platform.trim().toLowerCase()
  if (!scenario.platforms.includes(platform as MonitoringScenarioPlatform)) return false

  const settings = recordFromUnknown(source.settings)
  const googleAlertsRssConfigured = scenario.web?.googleAlertsRssConfigured === true
  if (platform === "web" && isGoogleAlertsRssSource(source)) {
    return googleAlertsRssConfigured
      && source.query === `google-alerts-rss:${scenario.id}`
      && settings.scenarioId === scenario.id
  }
  if (isGoogleAlertsRssSource(source)) return false

  const sourceKey = normalizedScenarioSourceKey(source)

  return scenarioSourceTargets(scenario).some((target) => {
    const normalized = scenarioTargetNormalizedSource(target)
    if (normalized.platform !== platform) return false

    return sourceKey === normalizedScenarioSourceKey(normalized)
  })
}

async function upsertScenarioMonitoringSource(
  organizationId: string,
  scenario: MonitoringScenario,
  target: ScenarioMonitoringSourceTarget,
  userId?: string,
  db: ScenarioDbClient = prisma,
): Promise<{ key: string; id: string }> {
  const normalized = applySelectiveYouTubeSourcePolicy(applySelectiveTikTokSourcePolicy(normalizeMonitoringSourceInput(target.input)))
  const protectedCollision = await findProtectedMonitoringIdentityCollision({
    organizationId,
    source: normalized,
    db,
  })
  if (protectedCollision) throw new Error(OFFICIAL_IDENTITY_NOT_COLLECTABLE)

  const linkedSettings = mergeScenarioSourceLink(normalized.settings, scenario, target, true)
  const duplicateWhere = buildMonitoringDuplicateWhere(normalized)
  let existing = await db.monitoringSource.findFirst({
    where: {
      organizationId,
      ...duplicateWhere,
    },
    select: {
      id: true,
      status: true,
      settings: true,
    },
  })

  // The duplicate key includes sourceType, so an operator's type override
  // (e.g. converting a scenario url-source to "profile") made re-saves spawn
  // a fresh search_url twin of the same URL. A same-URL source of another
  // type is REUSED instead: its operator-chosen type is left alone, and ITS
  // key is reported so the stale-source pass doesn't pause it.
  let typeLockedRow: { platform: string; sourceType: string; collectionMode: string; url: string | null; query: string | null; handle: string | null } | null = null
  if (!existing && normalized.url) {
    const sameUrl = await db.monitoringSource.findFirst({
      where: {
        organizationId,
        platform: normalized.platform,
        url: normalized.url,
        sourceType: { not: normalized.sourceType },
      },
      select: {
        id: true,
        status: true,
        settings: true,
        platform: true,
        sourceType: true,
        collectionMode: true,
        url: true,
        query: true,
        handle: true,
      },
    })
    if (sameUrl) {
      existing = { id: sameUrl.id, status: sameUrl.status, settings: sameUrl.settings }
      typeLockedRow = sameUrl
    }
  }

  if (existing) {
    const existingSettings = recordFromUnknown(existing.settings)
    const normalizedSettings = recordFromUnknown(normalized.settings)
    const managedByScenario =
      existingSettings.managedBy === SOCIAL_SCENARIO_SOURCE_MANAGER &&
      existingSettings.scenarioId === scenario.id
    const managedSettings = preserveManagedScenarioRouteProviderCursors(
      linkedSettings,
      existingSettings,
      scenario,
      target,
    )
    const managedSettingsWithSharedLinks = mergeScenarioSourceLink(
      {
        ...managedSettings,
        scenarioLinks: existingSettings.scenarioLinks,
      },
      scenario,
      target,
      true,
    )
    const linkedExistingSettings = mergeScenarioSourceLink(existingSettings, scenario, target, false)
    const reusedSettings = normalizedSettings.canonicalBrandQuery === true
      ? {
          ...linkedExistingSettings,
          canonicalBrandQuery: true,
          aliases: parseStringList([
            ...parseStringList(existingSettings.aliases),
            ...parseStringList(normalizedSettings.aliases),
          ]),
          // Import-time matching keeps every alias it has ever seen (merge
          // above), but paid search fan-out must follow the operator's CURRENT
          // scenario: replaced on every save, never merged, so retired aliases
          // stop costing search budget.
          searchFanOutTerms: parseStringList(normalizedSettings.searchFanOutTerms),
        }
      : linkedExistingSettings
    await db.monitoringSource.update({
      where: { id: existing.id },
      data: managedByScenario && !typeLockedRow
        ? {
          platform: normalized.platform,
          sourceType: normalized.sourceType,
          url: normalized.url,
          handle: normalized.handle,
          query: normalized.query,
          ownership: normalized.ownership,
          collectionMode: normalized.collectionMode,
          cadenceMinutes: normalized.cadenceMinutes,
          keywords: normalized.keywords,
          riskLevel: normalized.riskLevel,
          status: normalized.status,
          settings: managedSettingsWithSharedLinks as Prisma.InputJsonObject,
        }
        : {
          settings: reusedSettings as Prisma.InputJsonObject,
          ...(existingSettings.disabledByScenarioSyncAt && ["disabled", "paused"].includes(existing.status)
            ? { status: normalized.status }
            : {}),
        },
    })
    return { key: scenarioSourceKey(typeLockedRow ?? normalized), id: existing.id }
  }

  const created = await db.monitoringSource.create({
    data: {
      organizationId,
      platform: normalized.platform,
      sourceType: normalized.sourceType,
      url: normalized.url,
      handle: normalized.handle,
      query: normalized.query,
      ownership: normalized.ownership,
      collectionMode: normalized.collectionMode,
      cadenceMinutes: normalized.cadenceMinutes,
      keywords: normalized.keywords,
      riskLevel: normalized.riskLevel,
      status: normalized.status,
      settings: linkedSettings as Prisma.InputJsonObject,
      createdBy: userId,
    },
  })
  return { key: scenarioSourceKey(normalized), id: created.id }
}

async function disableStaleScenarioSources(
  organizationId: string,
  scenarioId: string,
  expectedKeys: Set<string>,
  disabledStatus: "paused" | "disabled",
  db: ScenarioDbClient = prisma,
): Promise<void> {
  const existing = await db.monitoringSource.findMany({
    where: { organizationId },
    select: {
      id: true,
      platform: true,
      sourceType: true,
      collectionMode: true,
      url: true,
      query: true,
      handle: true,
      settings: true,
    },
  }) as ScenarioManagedSourceRow[]

  const stale = existing.filter((source) => {
    const settings = recordFromUnknown(source.settings)
    const scenarioLinks = Array.isArray(settings.scenarioLinks)
      ? settings.scenarioLinks.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : []
    const belongsToScenario = settings.scenarioId === scenarioId
      || scenarioLinks.some(link => link.scenarioId === scenarioId)
    return belongsToScenario && !expectedKeys.has(scenarioSourceKey(source))
  })

  await Promise.all(stale.map((source) => {
    const current = recordFromUnknown(source.settings)
    const scenarioLinks = Array.isArray(current.scenarioLinks)
      ? current.scenarioLinks.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : []
    const directSource = Boolean(
      source.url
      || source.handle
      || LEGACY_SCENARIO_DIRECT_SOURCE_TYPES.has(source.sourceType),
    )
    if (directSource) {
      // URL/profile selection no longer belongs to scenarios. Remove every
      // legacy scenario binding in one pass so another old scenario link cannot
      // keep the row scenario-managed. Independently created Sources stay
      // active; rows originally provisioned by a scenario are disabled.
      const scenarioManaged = current.managedBy === SOCIAL_SCENARIO_SOURCE_MANAGER
      const scenarioBindingKeys = new Set([
        "scenarioId",
        "scenarioName",
        "scenarioTargetType",
        "scenarioTargetValue",
      ])
      const independentSettings = Object.fromEntries(
        Object.entries(current).filter(([key]) => (
          !scenarioBindingKeys.has(key)
          && !(scenarioManaged && key === "managedBy")
        )),
      )
      return db.monitoringSource.update({
        where: { id: source.id },
        data: {
          ...(scenarioManaged ? { status: "disabled" } : {}),
          settings: {
            ...independentSettings,
            scenarioLinks: [],
            ...(scenarioManaged ? { disabledByScenarioSyncAt: new Date().toISOString() } : {}),
            liveExternalSendEnabled: false,
            autoReplyEnabled: false,
          } as Prisma.InputJsonObject,
        },
      })
    }
    const remainingLinks = scenarioLinks.filter(link => link.scenarioId !== scenarioId)
    const ownedByScenario = current.managedBy === SOCIAL_SCENARIO_SOURCE_MANAGER
      && current.scenarioId === scenarioId
    if (remainingLinks.length > 0) {
      const nextOwner = remainingLinks[0]
      const settings = {
        ...current,
        scenarioLinks: remainingLinks,
        ...(ownedByScenario ? {
          scenarioId: nextOwner.scenarioId,
          scenarioName: nextOwner.scenarioName,
          scenarioTargetType: nextOwner.targetType,
          scenarioTargetValue: nextOwner.targetValue,
        } : {}),
        liveExternalSendEnabled: false,
        autoReplyEnabled: false,
      }
      return db.monitoringSource.update({
        where: { id: source.id },
        data: { settings: settings as Prisma.InputJsonObject },
      })
    }
    if (!ownedByScenario) {
      return db.monitoringSource.update({
        where: { id: source.id },
        data: {
          settings: {
            ...current,
            scenarioLinks: remainingLinks,
            liveExternalSendEnabled: false,
            autoReplyEnabled: false,
          } as Prisma.InputJsonObject,
        },
      })
    }
    const settings = {
      ...current,
      scenarioLinks: remainingLinks,
      disabledByScenarioSyncAt: new Date().toISOString(),
      liveExternalSendEnabled: false,
      autoReplyEnabled: false,
    }
    return db.monitoringSource.update({
      where: { id: source.id },
      data: {
        status: disabledStatus,
        settings: settings as Prisma.InputJsonObject,
      },
    })
  }))
}

export async function syncMonitoringScenarioSources(
  organizationId: string,
  scenario: MonitoringScenario,
  userId?: string,
  db: ScenarioDbClient = prisma,
): Promise<void> {
  const subjectSourceDelegate = db.monitoringSubjectSource
  if (subjectSourceDelegate) {
    if (scenario.subjectId) {
      // Old profile/scenario pickers created markerless MONITORS links to
      // pages and profiles. Remove only those collection links; the Source
      // records and OWNED/OFFICIAL/CONTEXT relations remain independent.
      await subjectSourceDelegate.deleteMany({
        where: {
          organizationId,
          subjectId: scenario.subjectId,
          relationType: "MONITORS",
          source: {
            OR: [
              { url: { not: null } },
              { handle: { not: null } },
              { sourceType: { in: [...LEGACY_SCENARIO_DIRECT_SOURCE_TYPES] } },
            ],
          },
        },
      })
    }
    await subjectSourceDelegate.deleteMany({ where: { organizationId, scenarioId: scenario.id } })
  }
  if (scenario.status !== "active") {
    await disableStaleScenarioSources(organizationId, scenario.id, new Set(), scenario.status === "paused" ? "paused" : "disabled", db)
    return
  }

  const expectedKeys = new Set<string>()
  const sourceIds: string[] = []
  for (const target of scenarioSourceTargets(scenario)) {
    const result = await upsertScenarioMonitoringSource(organizationId, scenario, target, userId, db)
    expectedKeys.add(result.key)
    sourceIds.push(result.id)
  }
  await disableStaleScenarioSources(organizationId, scenario.id, expectedKeys, "disabled", db)
  if (subjectSourceDelegate) {
    if (scenario.subjectId && sourceIds.length > 0) {
      await subjectSourceDelegate.createMany({
        data: sourceIds.map(sourceId => ({
          organizationId,
          subjectId: scenario.subjectId!,
          sourceId,
          scenarioId: scenario.id,
          relationType: "MONITORS",
          trustWeight: 0.85,
        })),
        skipDuplicates: true,
      })
    }
  }
}

export type LegacyFacebookScenarioSourceRepairResult = {
  scanned: number
  organizations: number
  scenarios: number
  failedOrganizations: number
  hasMore: boolean
}

/**
 * v11 changed Facebook scenario discovery from multi-keyword sources to one
 * source per native Actor query. Repair only legacy managed rows whose keyword
 * array still contains multiple terms, and cap each cron pass so a large
 * installation cannot turn source scheduling into an unbounded migration.
 *
 * Until repair, the adapter keeps a packed row off the single-query Actor and
 * uses the bounded Google fallback, so it cannot silently cover only one term.
 */
export async function repairLegacyFacebookScenarioSources(options: {
  organizationId?: string
  limit?: number
} = {}): Promise<LegacyFacebookScenarioSourceRepairResult> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100)
  const organizationFilter = options.organizationId
    ? Prisma.sql`AND "organizationId" = ${options.organizationId}`
    : Prisma.empty
  const candidates = await prisma.$queryRaw<Array<{
    id: string
    organizationId: string
    settings: unknown
  }>>(Prisma.sql`
    SELECT "id", "organizationId", "settings"
    FROM "monitoring_sources"
    WHERE "platform" = 'facebook'
      AND "sourceType" = 'keyword'
      AND "status" IN ('active', 'limited', 'needs_setup')
      AND cardinality("keywords") > 1
      AND "settings"->>'managedBy' = ${SOCIAL_SCENARIO_SOURCE_MANAGER}
      AND (
        "runClaimToken" IS NULL
        OR "runClaimExpiresAt" IS NULL
        OR "runClaimExpiresAt" <= NOW()
      )
      ${organizationFilter}
    ORDER BY "updatedAt" ASC, "id" ASC
    LIMIT ${limit}
  `)

  const candidatesByOrganization = new Map<string, {
    sourceIds: Set<string>
    scenarioIds: Set<string>
  }>()
  for (const candidate of candidates) {
    const settings = recordFromUnknown(candidate.settings)
    const scenarioLinks = Array.isArray(settings.scenarioLinks)
      ? settings.scenarioLinks.map(recordFromUnknown)
      : []
    const scenarioIds = [
      ...(settings.managedBy === SOCIAL_SCENARIO_SOURCE_MANAGER
        ? [stringValue(settings.scenarioId)]
        : []),
      ...scenarioLinks.map(link => stringValue(link.scenarioId)),
    ].filter((scenarioId): scenarioId is string => Boolean(scenarioId))
    const grouped = candidatesByOrganization.get(candidate.organizationId) ?? {
      sourceIds: new Set<string>(),
      scenarioIds: new Set<string>(),
    }
    grouped.sourceIds.add(candidate.id)
    for (const scenarioId of scenarioIds) grouped.scenarioIds.add(scenarioId)
    candidatesByOrganization.set(candidate.organizationId, grouped)
  }

  let repairedScenarios = 0
  let failedOrganizations = 0
  for (const [organizationId, grouped] of candidatesByOrganization) {
    try {
      repairedScenarios += await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scenarioWriteLockKey(organizationId)}, 0))`
        const scenarios = await getMonitoringScenariosUncached(organizationId, tx)
        const repairable = scenarios.filter(scenario => (
          scenario.platforms.includes("facebook")
          && grouped.scenarioIds.has(scenario.id)
        ))
        const repairableScenarioIds = repairable.map(scenario => scenario.id)
        const scenarioMembershipFilter = repairableScenarioIds.length > 0
          ? Prisma.sql`
              OR "settings"->>'scenarioId' IN (${Prisma.join(repairableScenarioIds)})
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof("settings"->'scenarioLinks') = 'array'
                      THEN "settings"->'scenarioLinks'
                    ELSE '[]'::jsonb
                  END
                ) AS link
                WHERE link->>'scenarioId' IN (${Prisma.join(repairableScenarioIds)})
              )
            `
          : Prisma.empty
        const lockedRows = await tx.$queryRaw<Array<{
          id: string
          runClaimToken: string | null
          runClaimExpiresAt: Date | null
        }>>(Prisma.sql`
          SELECT "id", "runClaimToken", "runClaimExpiresAt"
          FROM "monitoring_sources"
          WHERE "organizationId" = ${organizationId}
            AND (
              "id" IN (${Prisma.join([...grouped.sourceIds])})
              ${scenarioMembershipFilter}
            )
          FOR UPDATE
        `)
        const lockedSourceIds = new Set(lockedRows.map(row => row.id))
        const now = Date.now()
        const hasLiveClaim = lockedRows.some(row => {
          if (!row.runClaimToken || !row.runClaimExpiresAt) return false
          const expiresAt = new Date(row.runClaimExpiresAt).getTime()
          return Number.isFinite(expiresAt) && expiresAt > now
        })
        // syncMonitoringScenarioSources can update every source linked to one
        // of these scenarios, not only the bounded candidate row. Lock that
        // complete set and skip the tenant if any affected source is actively
        // collected or a candidate disappeared after the outer scan.
        if (
          hasLiveClaim
          || [...grouped.sourceIds].some(sourceId => !lockedSourceIds.has(sourceId))
        ) return 0
        // Expired claims are eligible for repair, but their old workers may
        // still finish late. Clear and version-fence every locked row before
        // provisioning replacements so no stale worker can reactivate or
        // overwrite any source the scenario synchronizer may touch.
        await tx.monitoringSource.updateMany({
          where: {
            organizationId,
            id: { in: [...lockedSourceIds] },
          },
          data: {
            runClaimToken: null,
            runClaimExpiresAt: null,
            runClaimVersion: { increment: 1 },
          },
        })
        // Active scenarios are split into one-query sources; paused/draft
        // scenarios flow through the same synchronizer and disable their old
        // managed rows. Missing scenario IDs are orphaned and handled by the
        // final bounded update below.
        for (const scenario of repairable) {
          await syncMonitoringScenarioSources(organizationId, scenario, undefined, tx)
        }
        await tx.monitoringSource.updateMany({
          where: {
            organizationId,
            id: { in: [...grouped.sourceIds] },
            status: { in: ["active", "limited", "needs_setup"] },
            OR: [
              { runClaimToken: null },
              { runClaimExpiresAt: null },
              { runClaimExpiresAt: { lte: new Date() } },
            ],
          },
          data: {
            status: "disabled",
            lastError: null,
          },
        })
        await tx.sourceRoutePlan.updateMany({
          where: {
            organizationId,
            OR: [
              { sourceId: { in: [...grouped.sourceIds] } },
              ...(repairableScenarioIds.length > 0
                ? [{
                    sourceId: { in: [...lockedSourceIds] },
                    scenarioId: { in: repairableScenarioIds },
                  }]
                : []),
            ],
            status: { not: "INVALIDATED" },
          },
          data: { status: "INVALIDATED" },
        })
        return repairable.length
      })
    } catch {
      failedOrganizations += 1
      // A transient repair failure must not remove working coverage. Keep the
      // packed source eligible for its bounded Google fallback, record the
      // failure, and rotate updatedAt so another tenant gets the next attempt.
      await prisma.monitoringSource.updateMany({
        where: {
          organizationId,
          id: { in: [...grouped.sourceIds] },
          OR: [
            { runClaimToken: null },
            { runClaimExpiresAt: null },
            { runClaimExpiresAt: { lte: new Date() } },
          ],
        },
        data: {
          lastError: "facebook_scenario_source_repair_failed",
        },
      }).catch(() => {})
    }
  }

  return {
    scanned: candidates.length,
    organizations: candidatesByOrganization.size,
    scenarios: repairedScenarios,
    failedOrganizations,
    hasMore: candidates.length === limit,
  }
}

function normalizeScenario(
  input: MonitoringScenarioInput,
  existing?: MonitoringScenario,
  options: { allowEmptyLegacySearch?: boolean } = {},
): MonitoringScenario {
  const now = new Date().toISOString()
  // PATCH-style callers (Pause/Resume/Stop) usually send status only. Preserve
  // every omitted collection target; treating undefined as an empty list would
  // erase the search plan and make lifecycle actions fail validation.
  const searchSuggestion = suggestScenarioSearch({
    topics: input.topics === undefined ? existing?.search.topics : input.topics,
    keywords: input.keywords === undefined ? existing?.search.keywords : input.keywords,
    hashtags: input.hashtags === undefined ? existing?.search.hashtags : input.hashtags,
    // Accepted by the API only for rolling-client compatibility. Direct
    // targets are intentionally not copied from either the request or a
    // previously stored scenario.
    handles: [],
    urls: [],
  })
  const search: MonitoringScenario["search"] = {
    ...searchSuggestion,
    useHashtagFallback: booleanValue(input.useHashtagFallback, existing?.search.useHashtagFallback ?? true),
    includeOwnedComments: booleanValue(input.includeOwnedComments, existing?.search.includeOwnedComments ?? true),
    // Three-state on purpose: only an explicit boolean is an explicit choice.
    includeExternalComments: typeof input.includeExternalComments === "boolean"
      ? input.includeExternalComments
      : existing?.search.includeExternalComments ?? null,
  }
  const name = normalizeKeyword(stringValue(input.name) ?? existing?.name ?? "")
  if (!name) throw new Error("Scenario name is required")
  const hasTarget =
    search.topics.length > 0 ||
    search.keywords.length > 0 ||
    search.hashtags.length > 0
  if (!hasTarget && !options.allowEmptyLegacySearch) {
    throw new Error("Scenario needs at least one topic, keyword, or hashtag")
  }
  const archiveStartAt = input.archiveStartAt === null
    ? null
    : input.archiveStartAt === undefined
      ? existing?.archive.startAt ?? null
      : normalizeArchiveStartAt(input.archiveStartAt)
  const archiveWindowChanged = archiveStartAt !== (existing?.archive.startAt ?? null)
  const normalizedPlatforms = normalizePlatforms(input.platforms ?? existing?.platforms)
  const requestedRssUrl = typeof input.googleAlertsRssUrl === "string"
    ? input.googleAlertsRssUrl.trim()
    : null
  const googleAlertsRssConfigured = normalizedPlatforms.includes("web") && (
    requestedRssUrl
      ? true
      : input.googleAlertsRssUrl === null
        ? false
        : typeof input.googleAlertsRssConfigured === "boolean"
          ? input.googleAlertsRssConfigured
          : existing?.web?.googleAlertsRssConfigured ?? false
  )
  const normalizedSubjectId = input.subjectId === null ? null : stringValue(input.subjectId) ?? existing?.subjectId ?? null
  const archiveSearchChanged = Boolean(existing) && (
    archiveMatchSignature({ platforms: normalizedPlatforms, search }) !== archiveMatchSignature(existing!) ||
    normalizedSubjectId !== existing?.subjectId
  )

  return {
    id: existing?.id ?? randomUUID(),
    subjectId: normalizedSubjectId,
    subjectName: input.subjectName === null ? null : stringValue(input.subjectName) ?? existing?.subjectName ?? null,
    name,
    description: input.description === null ? null : stringValue(input.description) ?? existing?.description ?? null,
    // A legacy scenario whose only targets were URLs/handles remains visible
    // for repair or deletion, but it cannot stay active without global terms.
    status: hasTarget ? normalizeStatus(input.status ?? existing?.status) : "draft",
    platforms: normalizedPlatforms,
    search,
    web: {
      sourceMode: googleAlertsRssConfigured ? "google_alerts_rss" : "direct_publishers",
      googleAlertsRssConfigured,
    },
    ai: {
      sentiments: normalizeSentiments(input.sentiments ?? existing?.ai.sentiments),
      minConfidence: normalizeConfidence(input.minConfidence ?? existing?.ai.minConfidence),
      action: normalizeAction(input.action ?? existing?.ai.action),
      directions: normalizeDirections(input.directions ?? existing?.ai.directions),
    },
    reply: {
      identityId: input.replyIdentityId === null ? null : stringValue(input.replyIdentityId) ?? existing?.reply.identityId ?? null,
      identityLabel: input.replyIdentityLabel === null ? null : stringValue(input.replyIdentityLabel) ?? existing?.reply.identityLabel ?? null,
      mode: normalizeReplyMode(input.replyMode ?? existing?.reply.mode),
      autoReplyEnabled: booleanValue(input.autoReplyEnabled, existing?.reply.autoReplyEnabled ?? false),
      liveSendAllowed: false,
    },
    archive: archiveWindowChanged || archiveSearchChanged || !existing
      ? {
          startAt: archiveStartAt,
          lastBackfilledAt: null,
          scannedCount: 0,
          matchedCount: 0,
          status: "pending",
        }
      : existing.archive,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function parseStoredScenario(value: unknown): MonitoringScenario | null {
  const record = recordFromUnknown(value)
  const search = recordFromUnknown(record.search)
  const ai = recordFromUnknown(record.ai)
  const reply = recordFromUnknown(record.reply)
  const archive = recordFromUnknown(record.archive)
  const web = recordFromUnknown(record.web)
  const fallbackDate = new Date().toISOString()
  const createdAt = stringValue(record.createdAt) ?? fallbackDate
  const updatedAt = stringValue(record.updatedAt) ?? createdAt
  try {
    const scenario = normalizeScenario({
      subjectId: stringValue(record.subjectId),
      subjectName: stringValue(record.subjectName),
      name: stringValue(record.name),
      description: stringValue(record.description),
      status: stringValue(record.status),
      platforms: parseStringList(record.platforms),
      topics: parseStringList(search.topics),
      keywords: parseStringList(search.keywords),
      hashtags: parseStringList(search.hashtags),
      handles: parseStringList(search.handles),
      urls: parseStringList(search.urls),
      useHashtagFallback: booleanValue(search.useHashtagFallback, true),
      includeOwnedComments: booleanValue(search.includeOwnedComments, true),
      includeExternalComments: typeof search.includeExternalComments === "boolean" ? search.includeExternalComments : null,
      sentiments: parseStringList(ai.sentiments),
      minConfidence: ai.minConfidence as number | string | null,
      action: stringValue(ai.action),
      directions: parseStringList(ai.directions),
      replyIdentityId: stringValue(reply.identityId),
      replyIdentityLabel: stringValue(reply.identityLabel),
      replyMode: stringValue(reply.mode),
      autoReplyEnabled: reply.autoReplyEnabled === true,
      archiveStartAt: stringValue(archive.startAt),
      googleAlertsRssConfigured: web.googleAlertsRssConfigured === true,
    }, {
      id: stringValue(record.id) ?? randomUUID(),
      subjectId: null,
      subjectName: null,
      name: "placeholder",
      description: null,
      status: "active",
      platforms: ["instagram"],
      search: {
        topics: [],
        keywords: [],
        hashtags: [],
        handles: [],
        urls: [],
        useHashtagFallback: true,
        includeOwnedComments: true,
        includeExternalComments: null,
      },
      web: {
        sourceMode: "direct_publishers",
        googleAlertsRssConfigured: false,
      },
      ai: {
        sentiments: ["negative"],
        minConfidence: 80,
        action: "draft_reply",
        directions: ["general_reputation"],
      },
      reply: {
        identityId: null,
        identityLabel: null,
        mode: "manual_approval",
        autoReplyEnabled: false,
        liveSendAllowed: false,
      },
      archive: {
        startAt: normalizeArchiveStartAt(archive.startAt),
        lastBackfilledAt: normalizeArchiveStartAt(archive.lastBackfilledAt),
        scannedCount: typeof archive.scannedCount === "number" ? Math.max(0, Math.trunc(archive.scannedCount)) : 0,
        matchedCount: typeof archive.matchedCount === "number" ? Math.max(0, Math.trunc(archive.matchedCount)) : 0,
        status: archive.status === "complete" || archive.status === "partial" || archive.status === "failed" ? archive.status : "pending",
      },
      createdAt,
      updatedAt,
    }, { allowEmptyLegacySearch: true })
    return { ...scenario, createdAt, updatedAt }
  } catch {
    return null
  }
}

function scenariosFromRow(row: ScenarioConfigRow | null): MonitoringScenario[] {
  const settings = recordFromUnknown(row?.settings)
  const scenarios = Array.isArray(settings.scenarios) ? settings.scenarios : []
  return scenarios
    .map(parseStoredScenario)
    .filter((scenario): scenario is MonitoringScenario => Boolean(scenario))
}

async function getScenarioConfig(
  organizationId: string,
  db: ScenarioDbClient = prisma,
): Promise<ScenarioConfigRow | null> {
  return db.channelConfig.findFirst({
    where: {
      organizationId,
      channelType: SOCIAL_MONITORING_SCENARIOS_CHANNEL,
      configName: SOCIAL_MONITORING_SCENARIOS_NAME,
    },
    select: { id: true, settings: true },
  })
}

async function persistScenarios(
  organizationId: string,
  scenarios: MonitoringScenario[],
  userId?: string,
  db: ScenarioDbClient = prisma,
): Promise<MonitoringScenario[]> {
  const existing = await getScenarioConfig(organizationId, db)
  const settings = { scenarios } as Prisma.InputJsonObject
  if (existing) {
    await db.channelConfig.update({
      where: { id: existing.id },
      data: { settings, isActive: true },
    })
  } else {
    await db.channelConfig.create({
      data: {
        organizationId,
        channelType: SOCIAL_MONITORING_SCENARIOS_CHANNEL,
        configName: SOCIAL_MONITORING_SCENARIOS_NAME,
        settings,
        isActive: true,
        createdBy: userId,
      },
    })
  }
  scenarioCache.delete(organizationId)
  return scenarios
}

// Pollers call ingestMention (→ scenario matching) once per item, up to ~50 items per
// account per run — without a memo that is 50 identical ChannelConfig reads. The TTL is
// short enough that scenario edits propagate within a minute even across processes;
// same-process edits invalidate immediately via persistScenarios. Disabled under vitest
// (checked at call time): dozens of test files re-mock the ChannelConfig read per case,
// and a module-level cache would leak scenarios across cases.
// READ-ONLY consumers only: the create/update/delete mutators below must use
// getMonitoringScenariosUncached — a read-modify-write off a stale cached list would
// silently resurrect deleted scenarios or drop ones created by another process.
const SCENARIO_CACHE_TTL_MS = 45_000
const scenarioCache = new Map<string, { scenarios: MonitoringScenario[]; expiresAt: number }>()

export async function getMonitoringScenariosUncached(
  organizationId: string,
  db: ScenarioDbClient = prisma,
): Promise<MonitoringScenario[]> {
  const row = await getScenarioConfig(organizationId, db)
  const scenarios = scenariosFromRow(row)
  return Promise.all(scenarios.map(scenario => resolveScenarioSubject(organizationId, scenario, db)))
}

async function resolveScenarioSubject(
  organizationId: string,
  scenario: MonitoringScenario,
  db: ScenarioDbClient = prisma,
): Promise<MonitoringScenario> {
  const delegate = db.monitoringSubject
  if (!delegate) return scenario
  const subject = await delegate.findFirst({
    where: {
      organizationId,
      ...(scenario.subjectId ? { id: scenario.subjectId } : { legacyScenarioId: scenario.id }),
    },
    select: { id: true, name: true },
  })
  if (scenario.subjectId && !subject) throw new Error("Monitoring subject not found")
  return subject ? { ...scenario, subjectId: subject.id, subjectName: subject.name } : scenario
}

export async function getMonitoringScenarios(organizationId: string): Promise<MonitoringScenario[]> {
  const cacheEnabled = process.env.NODE_ENV !== "test"
  if (cacheEnabled) {
    const cached = scenarioCache.get(organizationId)
    if (cached && cached.expiresAt > Date.now()) return cached.scenarios
  }
  const scenarios = await getMonitoringScenariosUncached(organizationId)
  if (cacheEnabled) {
    scenarioCache.set(organizationId, { scenarios, expiresAt: Date.now() + SCENARIO_CACHE_TTL_MS })
  }
  return scenarios
}

/**
 * Owner-facing rule: the scenario is the ONE place operators type search
 * words. Every save mirrors topics/keywords/hashtags into the linked
 * subject's aliases, so the acceptance matcher (feed gate, media OCR,
 * comment inheritance) can never silently drift from what the scenario
 * searches for. Additive only — operator-added aliases, negatives and
 * exclusions are never touched, and removing a scenario word deliberately
 * keeps its alias (delete it in the subject dialog to stop matching).
 */
export async function syncScenarioSubjectAliases(
  organizationId: string,
  scenario: MonitoringScenario,
  db: ScenarioDbClient = prisma,
): Promise<number> {
  if (!scenario.subjectId) return 0
  const aliasDelegate = db.monitoringSubjectAlias
  if (!aliasDelegate?.createMany) return 0
  const candidates = [
    ...[...scenario.search.topics, ...scenario.search.keywords].map(value => ({ kind: "NAME", value })),
    ...scenario.search.hashtags.map(value => ({ kind: "HASHTAG", value: value.replace(/^#/, "") })),
  ]
  const seen = new Set<string>()
  const rows = candidates.flatMap(({ kind, value }) => {
    const trimmed = value.trim()
    const normalizedValue = normalizeSubjectTerm(trimmed)
    if (!normalizedValue) return []
    const key = `${kind}:${normalizedValue}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      organizationId,
      subjectId: scenario.subjectId as string,
      kind,
      value: trimmed,
      normalizedValue,
      weight: 1,
      isNegative: false,
      // Mirrors the subject editor's convention: bare single-word names need
      // a second signal before they auto-accept.
      isAmbiguous: defaultAliasAmbiguity(kind, normalizedValue),
    }]
  })
  if (rows.length === 0) return 0
  const result = await aliasDelegate.createMany({ data: rows, skipDuplicates: true })
  return result.count
}

async function applyTenantScenarioPolicy(
  organizationId: string,
  input: MonitoringScenarioInput,
): Promise<MonitoringScenarioInput> {
  // Legacy unit tests use deliberately narrow Prisma mocks — mirror the
  // resolveScenarioSubject delegate guard instead of throwing.
  const delegate = (prisma as unknown as { organization?: typeof prisma.organization }).organization
  if (!delegate?.findUnique) return input
  // Owner rule: brand-protection tenants monitor EXTERNAL pages only — their
  // own pages belong to the inbox. Forced here (not just defaulted) so a
  // client operator cannot re-enable own-page collection by accident.
  if (await isSocialBrandProtectionOnly(organizationId)) {
    return { ...input, includeOwnedComments: false }
  }
  return input
}

async function backfillAndPersistScenarioArchive(
  organizationId: string,
  scenario: MonitoringScenario,
  userId?: string,
): Promise<MonitoringScenario> {
  if (scenario.status !== "active" || scenario.archive.status !== "pending") return scenario
  const { backfillMonitoringScenarioFromArchive } = await import("@/lib/social/monitoring-scenario-archive")
  const result = await backfillMonitoringScenarioFromArchive(organizationId, scenario)
  if (!result.available) return scenario
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scenarioWriteLockKey(organizationId)}, 0))`
    const current = await getMonitoringScenariosUncached(organizationId, tx)
    const index = current.findIndex(item => item.id === scenario.id)
    if (index === -1) return scenario
    const latest = current[index]
    const updated: MonitoringScenario = {
      ...latest,
      archive: {
        ...latest.archive,
        lastBackfilledAt: result.lastBackfilledAt,
        scannedCount: result.scannedCount,
        matchedCount: result.matchedCount,
        status: result.status,
      },
      updatedAt: new Date().toISOString(),
    }
    const next = [...current]
    next[index] = updated
    await persistScenarios(organizationId, next, userId, tx)
    return updated
  })
}

export async function createMonitoringScenario(
  organizationId: string,
  userId: string | undefined,
  input: MonitoringScenarioInput,
): Promise<MonitoringScenario> {
  // First scenario save is the natural provisioning moment for a new tenant.
  await ensureSocialMonitoringTenantDefaults(organizationId).catch(() => {})
  const policyInput = await applyTenantScenarioPolicy(organizationId, input)
  const scenario = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scenarioWriteLockKey(organizationId)}, 0))`
    const scenarios = await getMonitoringScenariosUncached(organizationId, tx)
    // New unified profiles own one canonical scenario. If two create requests
    // race, the second request re-reads after the lock and updates the first
    // scenario instead of adding a duplicate collection plan.
    const existingIndex = policyInput.subjectId
      ? scenarios.findIndex(item => item.subjectId === policyInput.subjectId)
      : -1
    const created = await resolveScenarioSubject(
      organizationId,
      normalizeScenario(policyInput, existingIndex >= 0 ? scenarios[existingIndex] : undefined),
      tx,
    )
    const next = existingIndex >= 0
      ? scenarios.map((item, index) => index === existingIndex ? created : item)
      : [created, ...scenarios]
    // Config, managed sources and subject links are one atomic write. A failed
    // source upsert now rolls every provisioning row back instead of leaving a
    // visible scenario with only part of its collectors.
    await persistScenarios(organizationId, next, userId, tx)
    await syncMonitoringScenarioSources(organizationId, created, userId, tx)
    await syncGoogleAlertsRssSource(
      organizationId,
      created,
      policyInput.googleAlertsRssUrl,
      userId,
      tx,
    )
    await syncScenarioSubjectAliases(organizationId, created, tx)
    return created
  })
  return backfillAndPersistScenarioArchive(organizationId, scenario, userId)
}

export async function updateMonitoringScenario(
  organizationId: string,
  id: string,
  input: MonitoringScenarioInput,
): Promise<MonitoringScenario> {
  await ensureSocialMonitoringTenantDefaults(organizationId).catch(() => {})
  const policyInput = await applyTenantScenarioPolicy(organizationId, input)
  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scenarioWriteLockKey(organizationId)}, 0))`
    // Re-read only after the org-scoped lock. This prevents two requests from
    // each writing a stale copy of ChannelConfig.settings.scenarios.
    const scenarios = await getMonitoringScenariosUncached(organizationId, tx)
    const index = scenarios.findIndex(scenario => scenario.id === id)
    if (index === -1) throw new Error("Scenario not found")
    const nextScenario = await resolveScenarioSubject(
      organizationId,
      normalizeScenario(policyInput, scenarios[index]),
      tx,
    )
    const next = [...scenarios]
    next[index] = nextScenario
    await persistScenarios(organizationId, next, undefined, tx)
    await syncMonitoringScenarioSources(organizationId, nextScenario, undefined, tx)
    await syncGoogleAlertsRssSource(
      organizationId,
      nextScenario,
      policyInput.googleAlertsRssUrl,
      undefined,
      tx,
    )
    await syncScenarioSubjectAliases(organizationId, nextScenario, tx)
    return nextScenario
  })
  return backfillAndPersistScenarioArchive(organizationId, updated)
}

async function deleteMonitoringScenarioWithTransaction(
  organizationId: string,
  id: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scenarioWriteLockKey(organizationId)}, 0))`
  const scenarios = await getMonitoringScenariosUncached(organizationId, tx)
  const removed = scenarios.find(scenario => scenario.id === id)
  const next = scenarios.filter(scenario => scenario.id !== id)
  if (next.length === scenarios.length) throw new Error("Scenario not found")
  await persistScenarios(organizationId, next, undefined, tx)
  await tx.monitoringSubjectSource.deleteMany({ where: { organizationId, scenarioId: id } })
  await disableStaleScenarioSources(organizationId, id, new Set(), "disabled", tx)
  if (removed) {
    await syncGoogleAlertsRssSource(
      organizationId,
      {
        ...removed,
        status: "paused",
        web: {
          sourceMode: "direct_publishers",
          googleAlertsRssConfigured: false,
        },
      },
      null,
      undefined,
      tx,
    )
  }
}

export async function deleteMonitoringScenario(
  organizationId: string,
  id: string,
  transaction?: Prisma.TransactionClient,
): Promise<void> {
  if (transaction) {
    await deleteMonitoringScenarioWithTransaction(organizationId, id, transaction)
    return
  }
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await deleteMonitoringScenarioWithTransaction(organizationId, id, tx)
  })
}
