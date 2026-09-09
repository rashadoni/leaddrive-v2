"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  ExternalLink,
  Globe2,
  Hash,
  Loader2,
  MessageSquare,
  Newspaper,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { detectSocialPlatformFromUrl, detectSocialSourceTypeFromUrl } from "@/lib/social/url-detect"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/format-date"
import { expandMonitoringQueries } from "@/lib/social/query-expansion"
import { cn } from "@/lib/utils"
import { providerRunRollup } from "@/lib/social/provider-run-rollup"
import { monitoringSourcePresentationKind } from "@/lib/social/monitoring-source-presentation"
import {
  readSocialMonitoringRunJobResponse,
  socialMonitoringRunJobCanResume,
  socialMonitoringRunJobIsActive,
  socialMonitoringRunJobItemIsExecuting,
  type SocialMonitoringRunJob,
  type SocialMonitoringRunJobSourceScope,
} from "@/lib/social/monitoring-run-job-client"

type MonitoringSource = {
  id: string
  platform: string
  sourceType: string
  url: string | null
  handle: string | null
  query: string | null
  ownership: string
  identityRole?: "official" | "external" | "mixed"
  subjectSources?: Array<{
    subjectId: string
    scenarioId: string | null
    relationType: string
  }>
  collectionMode: string
  cadenceMinutes: number
  keywords: string[]
  riskLevel: string
  status: string
  lastCheckedAt: string | null
  lastSuccessfulAt: string | null
  lastError: string | null
  settings?: Record<string, unknown>
  routePlans?: Array<{
    id: string
    capability: string
    contentScope: string
    primaryAdapter: string
    fallbackAdapters: string[]
    acquisitionMode: string
    replyMode: string
    status: string
    reason: string
    capabilityProofId: string | null
    capabilityProof: {
      status: string
      verifiedAt: string | null
      expiresAt: string | null
    } | null
    circuitOpenUntil: string | null
    lastFailureClass: string | null
    budget?: {
      maxTotalChargeUsd?: string | number
      usdLimitsConfigured?: boolean
    }
  }>
  providerRuns?: Array<{
    id: string
    providerKey: string
    phase: string
    status: string
    receivedCount: number
    acceptedCount: number
    reviewCount: number
    duplicateCount: number
    reservedChargeUsd: string | number
    actualChargeUsd: string | number | null
    createdAt: string
  }>
  providerSetup?: {
    collectionConfigured: boolean
    collectionApproved: boolean
    collectionEndpointHost: string | null
    collectionHasEncryptedToken: boolean
    replyConfigured: boolean
    replyApproved: boolean
    replyEndpointHost: string | null
  }
  readiness?: {
    overall: MonitoringReadinessState
    canCollect: boolean
    canReplyLive: boolean
    externalSendsDisabled: boolean
    steps: Array<{
      key: "collection" | "reply" | "liveSend"
      state: MonitoringReadinessState
      reason: string
      action: string
    }>
    missing: string[]
  }
  health?: {
    state: string
    due: boolean
    dueAt: string | null
    lastCheckedAt: string | null
    lastSuccessfulAt: string | null
    lastError: string | null
    lastRun: {
      id: string
      status: string
      startedAt: string
      finishedAt: string | null
      foundCount: number
      newCount: number
      duplicateCount: number
      ignoredCount: number
      error: string | null
      rawStats?: unknown | null
    } | null
  }
  _count?: { collectorRuns: number; evidences: number }
}

type PaidRunReport = {
  policy: {
    manualRunsEnabled: boolean
    emergencyStopped: boolean
    maxPerRunUsd: number
    dailyBudgetUsd: number
    monthlyBudgetUsd: number
    dailyRunQuota: number
  }
  usage: {
    dayReservedUsd: number
    monthReservedUsd: number
    dayRemainingUsd: number
    monthRemainingUsd: number
    runsToday: number
    runsRemainingToday: number | null
  }
  globalEnforcementEnabled: boolean
  recentAuthorizations: Array<{ authorizationId: string; status: string }>
}

type PaidRunPolicyForm = {
  manualRunsEnabled: boolean
  emergencyStopped: boolean
  maxPerRunUsd: string
  dailyBudgetUsd: string
  monthlyBudgetUsd: string
  dailyRunQuota: string
}

const initialPaidRunPolicyForm: PaidRunPolicyForm = {
  manualRunsEnabled: false,
  emergencyStopped: true,
  maxPerRunUsd: "0",
  dailyBudgetUsd: "0",
  monthlyBudgetUsd: "0",
  dailyRunQuota: "0",
}

type MonitoringReadinessState = "ready" | "needs_setup" | "manual_only" | "dry_run" | "blocked" | "disabled"

type WatchlistStats = {
  total: number
  due: number
  degraded: number
  byStatus: Record<string, number>
  byMode: Record<string, number>
  byRisk: Record<string, number>
}

type CoverageAlert = {
  id: string
  type: string
  severity: string
  message: string
  createdAt: string
  isRead: boolean
}

type WatchlistCoverage = {
  activeSources: number
  health: {
    healthy: number
    due: number
    degraded: number
    needsSetup: number
    blocked: number
  }
  last24h: {
    found: number
    new: number
    duplicate: number
    ignored: number
    failed: number
    partial: number
  }
  latestRun: {
    id: string
    sourceId: string
    status: string
    startedAt: string
    finishedAt: string | null
    foundCount: number
    newCount: number
    error: string | null
    rawStats?: unknown | null
    source: { platform: string; sourceType: string; collectionMode: string } | null
  } | null
  trustTiers: Record<string, number>
  partialCoverage: boolean
  recentAlerts: CoverageAlert[]
}

type MonitoringSettings = {
  searchIndex: {
    enabled: boolean
    provider: string
    endpoint: string | null
    allowedHosts: string[]
    limit: number | null
    includeComments: boolean
    hasToken: boolean
    apifyActors: {
      webSearch: string
      instagramProfile: string
      instagramHashtag: string
      facebookSearch: string
      facebookPosts: string
      tiktokSearch: string
      instagramComments: string
      facebookComments: string
      tiktokComments: string
    }
  }
  provider: {
    allowedHosts: string[]
    replyAllowedHosts: string[]
  }
  schedule?: {
    enabled: boolean
    cadenceMinutes: number
  }
  scheduleStatus?: {
    enabled: boolean
    cadenceMinutes: number
    lastTickAt: string | null
    lastTickMinutesAgo: number | null
    responding: boolean
    scheduledSources: number
    excludedSources: number
    overdueSources: number
    maxOverdueMinutes: number | null
    neverCollectedSources: number
    failingSources: number
    nextDueAt: string | null
  } | null
}

type MonitoringSettingsForm = {
  searchIndexEnabled: boolean
  searchIndexProvider: string
  searchIndexEndpoint: string
  searchIndexAllowedHosts: string
  searchIndexLimit: string
  searchIndexIncludeComments: boolean
  searchIndexToken: string
  clearSearchIndexToken: boolean
  apifyWebSearchActor: string
  apifyInstagramProfileActor: string
  apifyInstagramHashtagActor: string
  apifyFacebookSearchActor: string
  apifyFacebookPostsActor: string
  apifyTikTokSearchActor: string
  apifyInstagramCommentsActor: string
  apifyFacebookCommentsActor: string
  apifyTikTokCommentsActor: string
  providerAllowedHosts: string
  providerReplyAllowedHosts: string
}

type SocialAccountOption = {
  id: string
  platform: string
  handle: string
  displayName: string | null
  isActive: boolean
  connected?: boolean
}

type CollectorRunSummary = {
  runId: string
  sourceId: string
  status: "success" | "partial" | "failed" | "skipped"
  foundCount: number
  newCount: number
  duplicateCount: number
  ignoredCount: number
  error?: string | null
  rawStats?: unknown | null
}

type SourceForm = {
  platform: string
  sourceType: string
  ownership: string
  collectionMode: string
  socialAccountId: string
  target: string
  keywords: string
  cadenceMinutes: string
  providerName: string
  providerEndpoint: string
  providerToken: string
  providerReplyEnabled: boolean
  providerReplyEndpoint: string
  providerReplyToken: string
}

const PLATFORMS = ["instagram", "facebook", "tiktok", "youtube", "twitter", "telegram", "vkontakte", "linkedin", "web"] as const
const SOURCE_TYPES = ["page", "profile", "competitor", "influencer", "campaign", "hashtag", "keyword", "search_url"] as const
const DIRECT_SOURCE_TYPES = ["page", "profile", "competitor", "influencer", "campaign", "search_url"] as const
const OWNERSHIPS = ["owned", "external", "unknown"] as const
const COLLECTION_MODES = ["auto", "official_api", "provider_api", "search_index", "notification_inbox", "browser_capture", "manual"] as const

const initialForm: SourceForm = {
  platform: "instagram",
  sourceType: "page",
  ownership: "external",
  collectionMode: "auto",
  socialAccountId: "",
  target: "",
  keywords: "",
  cadenceMinutes: "60",
  providerName: "",
  providerEndpoint: "",
  providerToken: "",
  providerReplyEnabled: false,
  providerReplyEndpoint: "",
  providerReplyToken: "",
}

const initialSettingsForm: MonitoringSettingsForm = {
  searchIndexEnabled: false,
  searchIndexProvider: "generic",
  searchIndexEndpoint: "",
  searchIndexAllowedHosts: "",
  searchIndexLimit: "50",
  searchIndexIncludeComments: false,
  searchIndexToken: "",
  clearSearchIndexToken: false,
  apifyWebSearchActor: "apify/google-search-scraper",
  apifyInstagramProfileActor: "apify/instagram-scraper",
  apifyInstagramHashtagActor: "apify/instagram-hashtag-scraper",
  apifyFacebookSearchActor: "scrapeforge/facebook-search-posts",
  apifyFacebookPostsActor: "apify/facebook-posts-scraper",
  apifyTikTokSearchActor: "clockworks/tiktok-scraper",
  apifyInstagramCommentsActor: "apify/instagram-comment-scraper",
  apifyFacebookCommentsActor: "apify/facebook-comments-scraper",
  apifyTikTokCommentsActor: "clockworks/tiktok-comments-scraper",
  providerAllowedHosts: "",
  providerReplyAllowedHosts: "",
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function hostLabelFromUrl(value: string | null | undefined): string {
  if (!value) return ""
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

function splitKeywords(value: string): string[] {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)))
}

function targetLabel(source: MonitoringSource): string {
  if (source.url) return source.url
  if (source.handle) return `@${source.handle}`
  if (source.query) return source.sourceType === "hashtag" ? `#${source.query}` : source.query
  return "-"
}

function sourceIsExternalMonitoringTarget(source: MonitoringSource): boolean {
  return source.ownership !== "owned" && (source.identityRole ?? "external") === "external"
}

function sourceIsOfficialIdentity(source: MonitoringSource): boolean {
  return source.ownership !== "owned" && (source.identityRole ?? "external") !== "external"
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

function formFromSource(source: MonitoringSource): SourceForm {
  const settings = recordFromUnknown(source.settings)
  const provider = recordFromUnknown(settings.provider)
  const reply = recordFromUnknown(provider.reply)
  return {
    platform: source.platform,
    sourceType: source.sourceType,
    ownership: source.ownership,
    collectionMode: source.collectionMode || "auto",
    socialAccountId: stringFromUnknown(settings.socialAccountId),
    target: source.url || (source.handle ? `@${source.handle}` : source.query || ""),
    keywords: source.keywords.join(", "),
    cadenceMinutes: String(source.cadenceMinutes || 60),
    providerName: stringFromUnknown(provider.name),
    providerEndpoint: stringFromUnknown(provider.endpoint),
    providerToken: "",
    providerReplyEnabled: reply.approved === true || Boolean(reply.endpoint),
    providerReplyEndpoint: stringFromUnknown(reply.endpoint),
    providerReplyToken: "",
  }
}

function statusVariant(status: string): "success" | "warning" | "destructive" | "outline" | "secondary" {
  if (status === "active") return "success"
  if (status === "needs_setup" || status === "limited") return "warning"
  if (status === "blocked" || status === "disabled") return "destructive"
  if (status === "paused") return "secondary"
  return "outline"
}

function uniqueRoutePlans(routePlans: MonitoringSource["routePlans"] = []) {
  const seen = new Set<string>()
  return routePlans.filter((route) => {
    const key = `${route.capability}:${route.contentScope}:${route.primaryAdapter}:${route.status}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const MONETARY_ROUTE_ADAPTERS = new Set([
  "APIFY_ASYNC",
  "BRIGHT_DATA_SNAPSHOT",
  "TIKTOK_BUSINESS_API",
  "X_API",
])

const MONITORING_RUN_JOB_POLL_MS = 2_000
const WATCHLIST_RUN_JOB_KINDS = ["SOURCE_FULL", "WEB_NEWS"] as const
type WatchlistRunJobKind = (typeof WATCHLIST_RUN_JOB_KINDS)[number]

function sourceHasPaidRoute(source: MonitoringSource): boolean {
  return (source.routePlans ?? []).some((route) =>
    [route.primaryAdapter, ...route.fallbackAdapters].some((adapter) => MONETARY_ROUTE_ADAPTERS.has(adapter)),
  )
}

function sourcePaidCapabilities(source: MonitoringSource): string[] {
  return Array.from(new Set(uniqueRoutePlans(source.routePlans).flatMap((route) => {
    const adapters = [route.primaryAdapter, ...route.fallbackAdapters]
    return adapters.some((adapter) => MONETARY_ROUTE_ADAPTERS.has(adapter)) ? [route.capability] : []
  })))
}

function sourceCapabilityHasPaidRoute(source: MonitoringSource, capability: string): boolean {
  if (!capability) return false
  return uniqueRoutePlans(source.routePlans).some((route) =>
    route.capability === capability
    && [route.primaryAdapter, ...route.fallbackAdapters].some((adapter) => MONETARY_ROUTE_ADAPTERS.has(adapter)),
  )
}

function suggestedManualRunCap(source: MonitoringSource, capability?: string): string {
  const caps = (source.routePlans ?? []).flatMap((route) => {
    if (capability && route.capability !== capability) return []
    const adapters = [route.primaryAdapter, ...route.fallbackAdapters]
    if (!adapters.some((adapter) => MONETARY_ROUTE_ADAPTERS.has(adapter))) return []
    if (route.budget?.usdLimitsConfigured !== true) return []
    const parsed = Number(route.budget.maxTotalChargeUsd)
    return Number.isFinite(parsed) && parsed > 0 ? [parsed] : []
  })
  return caps.length > 0 ? String(Math.min(...caps)) : ""
}

function sourceIcon(sourceType: string) {
  if (sourceType === "hashtag") return Hash
  if (sourceType === "keyword" || sourceType === "search_url") return Search
  return Globe2
}

function sourceNeedsKeywords(source: MonitoringSource): boolean {
  return source.ownership === "owned"
    && source.keywords.length === 0
    && (source.sourceType === "search_url" || Boolean(source.url))
}

async function readApiJson<T>(res: Response, fallbackMessage: string): Promise<{ success?: boolean; error?: string; data?: T; retryAfterSeconds?: number }> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { success: false, error: fallbackMessage }
  }
}

async function fetchLatestWatchlistRunJob(
  kind: WatchlistRunJobKind,
  sourceScope: SocialMonitoringRunJobSourceScope,
  headers: Record<string, string>,
): Promise<SocialMonitoringRunJob | null | undefined> {
  try {
    const response = await fetch(
      `/api/v1/social/monitoring-run-jobs?kind=${kind}&sourceScope=${sourceScope}&latest=1`,
      { headers },
    )
    const body = await readSocialMonitoringRunJobResponse(response)
    if (!response.ok || !body.success) return undefined
    if (
      body.data
      && (body.data.kind !== kind || body.data.sourceScope !== sourceScope)
    ) return undefined
    return body.data ?? null
  } catch {
    return undefined
  }
}

export function MonitoringSourceWatchlist({
  orgId,
  brandProtectionOnly = false,
  view = "external",
  canManagePaidPolicy = false,
}: {
  orgId: string | number | undefined
  brandProtectionOnly?: boolean
  view?: "owned" | "external"
  canManagePaidPolicy?: boolean
}) {
  const t = useTranslations("socialMonitoring.watchlist")
  const locale = useLocale()
  const sourceScope: SocialMonitoringRunJobSourceScope = view === "owned"
    ? "OWNED"
    : "EXTERNAL"
  const usdFormatter = useMemo(() => new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }), [locale])
  const [sources, setSources] = useState<MonitoringSource[]>([])
  const [accounts, setAccounts] = useState<SocialAccountOption[]>([])
  const [stats, setStats] = useState<WatchlistStats | null>(null)
  const [coverage, setCoverage] = useState<WatchlistCoverage | null>(null)
  const [monitoringSettings, setMonitoringSettings] = useState<MonitoringSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkJobs, setBulkJobs] = useState<Record<WatchlistRunJobKind, SocialMonitoringRunJob | null>>({
    SOURCE_FULL: null,
    WEB_NEWS: null,
  })
  const [bulkJobMutating, setBulkJobMutating] = useState(false)
  const bulkIdempotencyKeysRef = useRef<Record<string, string>>({})
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paidRunSource, setPaidRunSource] = useState<MonitoringSource | null>(null)
  const [paidRunCapability, setPaidRunCapability] = useState("")
  const [paidRunSubmitting, setPaidRunSubmitting] = useState(false)
  const [paidRunReport, setPaidRunReport] = useState<PaidRunReport | null>(null)
  const [paidRunReportLoading, setPaidRunReportLoading] = useState(false)
  const [paidRunPolicyForm, setPaidRunPolicyForm] = useState<PaidRunPolicyForm>(initialPaidRunPolicyForm)
  const [paidRunPolicyConfirmed, setPaidRunPolicyConfirmed] = useState(false)
  const [paidRunPolicySaving, setPaidRunPolicySaving] = useState(false)
  // A tenant governed by a run-count quota runs manual scans without a USD cap.
  const paidRunQuotaMode = Boolean(paidRunReport && paidRunReport.usage.runsRemainingToday !== null)
  const paidRunCapabilityRequiresUsdCap = Boolean(
    paidRunSource
    && paidRunCapability
    && sourceCapabilityHasPaidRoute(paidRunSource, paidRunCapability),
  )
  const paidRunUsesQuota = paidRunQuotaMode && !paidRunCapabilityRequiresUsdCap
  const paidRunQuotaReady = Boolean(paidRunQuotaMode
    && paidRunReport?.globalEnforcementEnabled
    && paidRunReport.policy.manualRunsEnabled
    && !paidRunReport.policy.emergencyStopped
    && (paidRunReport.usage.runsRemainingToday ?? 0) > 0)
  const paidRunPolicyReady = Boolean(paidRunReport?.globalEnforcementEnabled
    && paidRunReport.policy.manualRunsEnabled
    && !paidRunReport.policy.emergencyStopped
    && paidRunReport.policy.maxPerRunUsd > 0
    && paidRunReport.usage.dayRemainingUsd > 0
    && paidRunReport.usage.monthRemainingUsd > 0)
  const paidRunAvailableCapUsd = paidRunPolicyReady && paidRunReport
    ? Math.min(100, paidRunReport.policy.maxPerRunUsd, paidRunReport.usage.dayRemainingUsd, paidRunReport.usage.monthRemainingUsd)
    : 0
  const paidRunSuggestedCapUsd = paidRunSource
    ? Number(suggestedManualRunCap(paidRunSource, paidRunCapability || undefined))
    : Number.NaN
  const paidRunAutomaticCapUsd = paidRunPolicyReady
    ? Math.min(
        paidRunAvailableCapUsd,
        Number.isFinite(paidRunSuggestedCapUsd) && paidRunSuggestedCapUsd > 0
          ? paidRunSuggestedCapUsd
          : paidRunAvailableCapUsd,
      )
    : 0
  const paidRunAutomaticCapValid = Number.isFinite(paidRunAutomaticCapUsd)
    && paidRunAutomaticCapUsd > 0
  const [editingSource, setEditingSource] = useState<MonitoringSource | null>(null)
  const [search, setSearch] = useState("")
  const [form, setForm] = useState<SourceForm>(initialForm)
  const [settingsForm, setSettingsForm] = useState<MonitoringSettingsForm>(initialSettingsForm)
  const parsedSearchIndexLimit = Number(settingsForm.searchIndexLimit)
  const searchIndexLimitValid = Number.isInteger(parsedSearchIndexLimit)
    && parsedSearchIndexLimit >= 1
    && parsedSearchIndexLimit <= 100
  const [bulkUrls, setBulkUrls] = useState("")
  const [bulkAdding, setBulkAdding] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ added: number; duplicate: number; skipped: number } | null>(null)

  const headers = useMemo<Record<string, string>>(
    () => {
      const next: Record<string, string> = {}
      if (orgId) next["x-organization-id"] = String(orgId)
      return next
    },
    [orgId],
  )
  const orderedBulkJobs = useMemo(() => (
    WATCHLIST_RUN_JOB_KINDS
      .map(kind => bulkJobs[kind])
      .filter((job): job is SocialMonitoringRunJob => job?.sourceScope === sourceScope)
      .sort((left, right) => {
        const activeDifference = Number(socialMonitoringRunJobIsActive(right))
          - Number(socialMonitoringRunJobIsActive(left))
        if (activeDifference !== 0) return activeDifference
        return Date.parse(right.createdAt) - Date.parse(left.createdAt)
      })
  ), [bulkJobs, sourceScope])
  const activeBulkJob = orderedBulkJobs.find(socialMonitoringRunJobIsActive) ?? null
  const displayedBulkJob = activeBulkJob ?? orderedBulkJobs[0] ?? null
  const bulkRunning = Boolean(activeBulkJob)
  const sourceBulkJobActive = bulkJobs.SOURCE_FULL?.sourceScope === sourceScope
    && socialMonitoringRunJobIsActive(bulkJobs.SOURCE_FULL)
  const webNewsBulkJobActive = bulkJobs.WEB_NEWS?.sourceScope === sourceScope
    && socialMonitoringRunJobIsActive(bulkJobs.WEB_NEWS)
  const bulkRunningSourceIds = useMemo(() => new Set(
    orderedBulkJobs
      .filter(socialMonitoringRunJobIsActive)
      .flatMap(job => job.items)
      .filter(socialMonitoringRunJobItemIsExecuting)
      .flatMap(item => item.sourceId ? [item.sourceId] : []),
  ), [orderedBulkJobs])
  const visibleSources = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sources
    return sources.filter((source) => {
      const haystack = [
        source.platform,
        source.sourceType,
        source.collectionMode,
        source.status,
        source.riskLevel,
        targetLabel(source),
        ...source.keywords,
      ].join(" ").toLowerCase()
      return haystack.includes(q)
    })
  }, [search, sources])

  const runnableSources = useMemo(
    () => sources.filter((source) => {
      if (["paused", "draft", "disabled"].includes(source.status)) return false
      if (view === "owned") return source.ownership === "owned"
      if (
        brandProtectionOnly
        && source.platform !== "web"
        && monitoringSourcePresentationKind(source) === "direct"
      ) return false
      // «Run all» covers the whole external collection surface: the direct
      // page/profile/URL targets shown in the list AND the keyword/scenario
      // query routes (global search — e.g. YouTube keyword discovery) that the
      // list intentionally presents only through «Scenarios».
      return sourceIsExternalMonitoringTarget(source)
    }),
    [brandProtectionOnly, sources, view],
  )
  const runnableWebNewsSources = useMemo(() => {
    const byScenario = new Map<string, MonitoringSource>()
    for (const source of runnableSources) {
      if (source.platform !== "web") continue
      const scenarioId = source.subjectSources?.find(link => link.scenarioId)?.scenarioId
      // Один прогон коллектора покрывает весь сценарий целиком. Держим по
      // одному представителю на сценарий, чтобы клик не запускал один и тот
      // же сбор столько раз, сколько у сценария строк.
      const key = scenarioId || source.id
      if (!byScenario.has(key)) byScenario.set(key, source)
    }
    return Array.from(byScenario.values())
  }, [runnableSources])

  // Split the list along the ownership axis so clients see two distinct concepts:
  // their own connected channels (comments → leads/tasks → replies) vs external
  // pages they only watch (brand protection). Same data, no collection change.
  const ownedSources = useMemo(
    () => visibleSources.filter((source) => source.ownership === "owned" || sourceIsOfficialIdentity(source)),
    [visibleSources],
  )
  const externalSources = useMemo(
    () => visibleSources.filter(sourceIsExternalMonitoringTarget),
    [visibleSources],
  )
  const externalDirectSources = useMemo(
    () => externalSources.filter((source) => monitoringSourcePresentationKind(source) === "direct"),
    [externalSources],
  )
  const directExternalSourceCount = useMemo(
    () => sources.filter((source) => sourceIsExternalMonitoringTarget(source) && monitoringSourcePresentationKind(source) === "direct").length,
    [sources],
  )
  const viewSources = view === "owned" ? ownedSources : externalSources
  const hasSourcesInView = view === "owned"
    ? sources.some((source) => source.ownership === "owned" || sourceIsOfficialIdentity(source))
    : sources.some((source) => sourceIsExternalMonitoringTarget(source) && monitoringSourcePresentationKind(source) === "direct")
  const viewIsEmpty = view === "owned"
    ? viewSources.length === 0
    : externalDirectSources.length === 0

  const expansionPreview = useMemo(() => {
    const query = ["hashtag", "keyword", "campaign", "search_url"].includes(form.sourceType) ? form.target : ""
    return expandMonitoringQueries({
      sourceType: form.sourceType,
      query,
      keywords: splitKeywords(form.keywords),
    }).slice(0, 10)
  }, [form.keywords, form.sourceType, form.target])
  const latestRunStats = recordFromUnknown(coverage?.latestRun?.rawStats)
  const latestRunLookbackHours = numberFromUnknown(latestRunStats.lookbackHours)
  const latestRunRejectionHistogram = recordFromUnknown(latestRunStats.rejectionReasonHistogram)
  const latestRunRejectionReasons = Object.entries(recordFromUnknown(latestRunRejectionHistogram.byReason))
    .map(([reason, count]) => [reason, numberFromUnknown(count) ?? 0] as const)
    .filter(([, count]) => count > 0)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 5)

  const platformAccounts = useMemo(() => (
    accounts.filter((account) => account.platform === form.platform && account.isActive && account.connected !== false)
  ), [accounts, form.platform])

  const providerMode = form.collectionMode === "provider_api"

  const openSettingsDialog = () => {
    // Вкладка PWA живёт часами: без перечитывания панель показывала бы
    // состояние на момент загрузки страницы и снова обманывала бы тишиной.
    void loadMonitoringSettings()
    setSettingsForm({
      searchIndexEnabled: monitoringSettings?.searchIndex.enabled ?? false,
      searchIndexProvider: monitoringSettings?.searchIndex.provider ?? "generic",
      searchIndexEndpoint: monitoringSettings?.searchIndex.endpoint ?? "",
      searchIndexAllowedHosts: monitoringSettings?.searchIndex.allowedHosts.join("\n") ?? "",
      searchIndexLimit: String(monitoringSettings?.searchIndex.limit ?? 50),
      searchIndexIncludeComments: monitoringSettings?.searchIndex.includeComments ?? false,
      searchIndexToken: "",
      clearSearchIndexToken: false,
      apifyWebSearchActor: monitoringSettings?.searchIndex.apifyActors.webSearch ?? initialSettingsForm.apifyWebSearchActor,
      apifyInstagramProfileActor: monitoringSettings?.searchIndex.apifyActors.instagramProfile ?? initialSettingsForm.apifyInstagramProfileActor,
      apifyInstagramHashtagActor: monitoringSettings?.searchIndex.apifyActors.instagramHashtag ?? initialSettingsForm.apifyInstagramHashtagActor,
      apifyFacebookSearchActor: monitoringSettings?.searchIndex.apifyActors.facebookSearch ?? initialSettingsForm.apifyFacebookSearchActor,
      apifyFacebookPostsActor: monitoringSettings?.searchIndex.apifyActors.facebookPosts ?? initialSettingsForm.apifyFacebookPostsActor,
      apifyTikTokSearchActor: monitoringSettings?.searchIndex.apifyActors.tiktokSearch ?? initialSettingsForm.apifyTikTokSearchActor,
      apifyInstagramCommentsActor: monitoringSettings?.searchIndex.apifyActors.instagramComments ?? initialSettingsForm.apifyInstagramCommentsActor,
      apifyFacebookCommentsActor: monitoringSettings?.searchIndex.apifyActors.facebookComments ?? initialSettingsForm.apifyFacebookCommentsActor,
      apifyTikTokCommentsActor: monitoringSettings?.searchIndex.apifyActors.tiktokComments ?? initialSettingsForm.apifyTikTokCommentsActor,
      providerAllowedHosts: monitoringSettings?.provider.allowedHosts.join("\n") ?? "",
      providerReplyAllowedHosts: monitoringSettings?.provider.replyAllowedHosts.join("\n") ?? "",
    })
    setSettingsOpen(true)
    setPaidRunPolicyConfirmed(false)
    if (canManagePaidPolicy && view === "external") void loadPaidRunReport()
  }

  const openCreateDialog = () => {
    if (brandProtectionOnly) return
    setEditingSource(null)
    setForm(initialForm)
    setOpen(true)
  }

  const openEditDialog = (source: MonitoringSource) => {
    if (
      brandProtectionOnly
      && source.platform !== "web"
      && monitoringSourcePresentationKind(source) === "direct"
    ) return
    setEditingSource(source)
    setForm(formFromSource(source))
    setOpen(true)
  }

  const closeDialog = () => {
    setOpen(false)
    setEditingSource(null)
    setForm(initialForm)
  }

  const loadSources = async () => {
    setLoading(true)
    try {
      const [res, directRes] = await Promise.all([
        fetch("/api/v1/social/monitoring-sources?limit=200", { headers }),
        fetch("/api/v1/social/monitoring-sources?limit=200&targetKind=direct", { headers }),
      ])
      const [json, directJson] = await Promise.all([
        readApiJson<{ sources?: MonitoringSource[]; stats?: WatchlistStats; coverage?: WatchlistCoverage }>(res, t("loadFailed")),
        readApiJson<{ sources?: MonitoringSource[]; stats?: WatchlistStats; coverage?: WatchlistCoverage }>(directRes, t("loadFailed")),
      ])
      if (!res.ok || !json.success || !directRes.ok || !directJson.success) {
        throw new Error(json.error || directJson.error || t("loadFailed"))
      }
      const mergedSources = new Map<string, MonitoringSource>()
      for (const source of [...(json.data?.sources ?? []), ...(directJson.data?.sources ?? [])]) {
        mergedSources.set(source.id, source)
      }
      setSources(Array.from(mergedSources.values()))
      setStats(view === "external" ? directJson.data?.stats ?? null : json.data?.stats ?? null)
      setCoverage(view === "external" ? directJson.data?.coverage ?? null : json.data?.coverage ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }

  const loadAccounts = async () => {
    try {
      const res = await fetch("/api/v1/social/accounts", { headers })
      const json = await readApiJson<{ accounts?: SocialAccountOption[] }>(res, t("replyIdentityLoadFailed"))
      if (!res.ok || !json.success) throw new Error(json.error || t("replyIdentityLoadFailed"))
      setAccounts(json.data?.accounts ?? [])
    } catch {
      setAccounts([])
    }
  }

  const loadPaidRunReport = async () => {
    setPaidRunReportLoading(true)
    try {
      const res = await fetch("/api/v1/social/paid-run-policy", { headers })
      const json = await readApiJson<PaidRunReport>(res, t("paidRunPolicyLoadFailed"))
      if (!res.ok || !json.success || !json.data) throw new Error(json.error || t("paidRunPolicyLoadFailed"))
      setPaidRunReport(json.data)
      setPaidRunPolicyForm({
        manualRunsEnabled: json.data.policy.manualRunsEnabled,
        emergencyStopped: json.data.policy.emergencyStopped,
        maxPerRunUsd: String(json.data.policy.maxPerRunUsd),
        dailyBudgetUsd: String(json.data.policy.dailyBudgetUsd),
        monthlyBudgetUsd: String(json.data.policy.monthlyBudgetUsd),
        dailyRunQuota: String(json.data.policy.dailyRunQuota ?? 0),
      })
    } catch (error) {
      setPaidRunReport(null)
      toast.error(error instanceof Error ? error.message : t("paidRunPolicyLoadFailed"))
    } finally {
      setPaidRunReportLoading(false)
    }
  }

  const savePaidRunPolicy = async () => {
    if (!canManagePaidPolicy || !paidRunPolicyConfirmed) {
      toast.error(t("paidPolicyConfirmationRequired"))
      return
    }
    const maxPerRunUsd = Number(paidRunPolicyForm.maxPerRunUsd)
    const dailyBudgetUsd = Number(paidRunPolicyForm.dailyBudgetUsd)
    const monthlyBudgetUsd = Number(paidRunPolicyForm.monthlyBudgetUsd)
    const dailyRunQuota = Math.trunc(Number(paidRunPolicyForm.dailyRunQuota))
    // A tenant may be governed by USD budgets, a run-count quota, or both.
    const usdConfigured = maxPerRunUsd > 0 || dailyBudgetUsd > 0 || monthlyBudgetUsd > 0
    const quotaConfigured = dailyRunQuota >= 1
    const nonNegative = [maxPerRunUsd, dailyBudgetUsd, monthlyBudgetUsd].every((value) => Number.isFinite(value) && value >= 0)
      && Number.isFinite(dailyRunQuota) && dailyRunQuota >= 0
    const usdOk = !usdConfigured
      || (maxPerRunUsd > 0 && dailyBudgetUsd > 0 && monthlyBudgetUsd > 0 && maxPerRunUsd <= dailyBudgetUsd && dailyBudgetUsd <= monthlyBudgetUsd)
    const withinHardCeilings = maxPerRunUsd <= 100 && dailyBudgetUsd <= 10_000 && monthlyBudgetUsd <= 100_000 && dailyRunQuota <= 100
    const enabledLimitsPresent = !paidRunPolicyForm.manualRunsEnabled || usdConfigured || quotaConfigured
    if (!nonNegative || !usdOk || !withinHardCeilings || !enabledLimitsPresent) {
      toast.error(t("paidPolicyLimitsInvalid"))
      return
    }
    setPaidRunPolicySaving(true)
    try {
      const res = await fetch("/api/v1/social/paid-run-policy", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          manualRunsEnabled: paidRunPolicyForm.manualRunsEnabled,
          emergencyStopped: paidRunPolicyForm.emergencyStopped,
          maxPerRunUsd,
          dailyBudgetUsd,
          monthlyBudgetUsd,
          dailyRunQuota,
          authorizationConfirmed: true,
        }),
      })
      const json = await readApiJson<PaidRunReport["policy"]>(res, t("paidPolicySaveFailed"))
      if (!res.ok || !json.success) throw new Error(json.error || t("paidPolicySaveFailed"))
      setPaidRunPolicyConfirmed(false)
      await loadPaidRunReport()
      toast.success(t("paidPolicySaved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("paidPolicySaveFailed"))
    } finally {
      setPaidRunPolicySaving(false)
    }
  }

  const activatePaidRunEmergencyStop = async () => {
    if (!canManagePaidPolicy) return
    setPaidRunPolicySaving(true)
    try {
      const res = await fetch("/api/v1/social/paid-run-policy", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ emergencyStopped: true }),
      })
      const json = await readApiJson<PaidRunReport["policy"]>(res, t("paidPolicySaveFailed"))
      if (!res.ok || !json.success) throw new Error(json.error || t("paidPolicySaveFailed"))
      setPaidRunPolicyConfirmed(false)
      await loadPaidRunReport()
      toast.success(t("paidPolicyEmergencyActivated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("paidPolicySaveFailed"))
    } finally {
      setPaidRunPolicySaving(false)
    }
  }

  const scheduleStatus = monitoringSettings?.scheduleStatus ?? null
  // Три разных «плохо» не сваливаются в одно: выключено оператором, не
  // отвечает планировщик, и работает, но источники стоят (#665).
  const scheduleStatusTone = !scheduleStatus
    ? "warning" as const
    : !scheduleStatus.enabled
      ? "warning" as const
      : !scheduleStatus.responding
        ? "destructive" as const
        : scheduleStatus.overdueSources > 0
          || scheduleStatus.neverCollectedSources > 0
          || scheduleStatus.failingSources > 0
          ? "warning" as const
          : "success" as const
  const scheduleStatusLabel = !scheduleStatus
    ? t("scheduleStateUnknown")
    : !scheduleStatus.enabled
      ? t("scheduleStateOff")
      : !scheduleStatus.responding
        ? t("scheduleStateNotResponding")
        : scheduleStatus.overdueSources > 0 || scheduleStatus.neverCollectedSources > 0
          ? t("scheduleStateBehind")
          : scheduleStatus.failingSources > 0
            ? t("scheduleStateFailing")
            : t("scheduleStateRunning")

  const loadMonitoringSettings = async () => {
    try {
      const res = await fetch("/api/v1/social/monitoring-settings", { headers })
      const json = await readApiJson<MonitoringSettings>(res, t("settingsLoadFailed"))
      if (!res.ok || !json.success) throw new Error(json.error || t("settingsLoadFailed"))
      setMonitoringSettings(json.data ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settingsLoadFailed"))
      setMonitoringSettings(null)
    }
  }

  // Одна короткая строка на странице: показываем только то, что требует
  // действия, и в порядке серьёзности.
  const scheduleAlert = !scheduleStatus
    ? null
    : !scheduleStatus.enabled
      ? { tone: "warn" as const, message: t("scheduleAlertOff") }
      : !scheduleStatus.responding
        ? {
            tone: "error" as const,
            message: scheduleStatus.lastTickMinutesAgo === null
              ? t("scheduleNeverRan")
              : t("scheduleNotResponding", { minutes: scheduleStatus.lastTickMinutesAgo }),
          }
        : scheduleStatus.overdueSources > 0
          ? {
              tone: "warn" as const,
              message: t("scheduleOverdueSources", {
                count: scheduleStatus.overdueSources,
                hours: Math.max(1, Math.floor((scheduleStatus.maxOverdueMinutes ?? 60) / 60)),
              }),
            }
          : scheduleStatus.neverCollectedSources > 0
            ? {
                tone: "warn" as const,
                message: t("scheduleNeverCollectedSources", {
                  count: scheduleStatus.neverCollectedSources,
                }),
              }
            : scheduleStatus.failingSources > 0
              ? {
                  tone: "warn" as const,
                  message: t("scheduleFailingSources", { count: scheduleStatus.failingSources }),
                }
              : scheduleStatus.excludedSources > 0
                ? {
                    tone: "warn" as const,
                    message: t("scheduleExcludedSources", {
                      count: scheduleStatus.excludedSources,
                    }),
                  }
                : null

  const saveScheduleEnabled = async (enabled: boolean) => {
    setScheduleSaving(true)
    try {
      const res = await fetch("/api/v1/social/monitoring-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ schedule: { enabled } }),
      })
      const json = await readApiJson<MonitoringSettings>(res, t("scheduleSaveFailed"))
      if (!res.ok || !json.success) throw new Error(json.error || t("scheduleSaveFailed"))
      setMonitoringSettings(json.data ?? null)
      toast.success(enabled ? t("scheduleEnabledToast") : t("scheduleDisabledToast"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("scheduleSaveFailed"))
      await loadMonitoringSettings()
    } finally {
      setScheduleSaving(false)
    }
  }

  useEffect(() => {
    loadSources()
    loadAccounts()
    loadMonitoringSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers])

  useEffect(() => {
    let disposed = false
    void Promise.all(WATCHLIST_RUN_JOB_KINDS.map(async kind => ({
      kind,
      job: await fetchLatestWatchlistRunJob(kind, sourceScope, headers),
    }))).then(results => {
      if (disposed) return
      setBulkJobs(current => {
        const next = { ...current }
        for (const result of results) {
          if (result.job !== undefined) next[result.kind] = result.job
        }
        return next
      })
    })
    return () => { disposed = true }
  }, [headers, sourceScope])

  useEffect(() => {
    const activeKinds: WatchlistRunJobKind[] = []
    if (sourceBulkJobActive) activeKinds.push("SOURCE_FULL")
    if (webNewsBulkJobActive) activeKinds.push("WEB_NEWS")
    if (activeKinds.length === 0) return

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      const results = await Promise.all(activeKinds.map(async kind => ({
        kind,
        job: await fetchLatestWatchlistRunJob(kind, sourceScope, headers),
      })))
      if (disposed) return

      const continuePolling = results.some(result => (
        result.job === undefined || socialMonitoringRunJobIsActive(result.job)
      ))
      const reachedTerminal = results.some(result => (
        result.job !== undefined
        && result.job !== null
        && !socialMonitoringRunJobIsActive(result.job)
      ))
      setBulkJobs(current => {
        const next = { ...current }
        for (const result of results) {
          if (result.job === undefined) continue
          next[result.kind] = result.job
        }
        return next
      })
      if (reachedTerminal) void loadSources()
      if (!disposed && continuePolling) {
        timer = setTimeout(() => { void poll() }, MONITORING_RUN_JOB_POLL_MS)
      }
    }

    timer = setTimeout(() => { void poll() }, MONITORING_RUN_JOB_POLL_MS)
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
    // loadSources intentionally stays out of the dependency list: the poll is
    // keyed only by tenant headers and the two durable job activity states.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, sourceBulkJobActive, sourceScope, webNewsBulkJobActive])

  const saveMonitoringSettings = async () => {
    if (!searchIndexLimitValid) {
      toast.error(t("settingsLimitInvalid"))
      return
    }
    setSettingsSaving(true)
    try {
      const res = await fetch("/api/v1/social/monitoring-settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          searchIndex: {
            enabled: settingsForm.searchIndexEnabled,
            provider: settingsForm.searchIndexProvider,
            endpoint: settingsForm.searchIndexEndpoint.trim() || null,
            allowedHosts: settingsForm.searchIndexAllowedHosts,
            limit: parsedSearchIndexLimit,
            includeComments: settingsForm.searchIndexIncludeComments,
            token: settingsForm.searchIndexToken.trim() || null,
            clearToken: settingsForm.clearSearchIndexToken,
            apifyActors: {
              webSearch: settingsForm.apifyWebSearchActor.trim(),
              instagramProfile: settingsForm.apifyInstagramProfileActor.trim(),
              instagramHashtag: settingsForm.apifyInstagramHashtagActor.trim(),
              facebookSearch: settingsForm.apifyFacebookSearchActor.trim(),
              facebookPosts: settingsForm.apifyFacebookPostsActor.trim(),
              tiktokSearch: settingsForm.apifyTikTokSearchActor.trim(),
              instagramComments: settingsForm.apifyInstagramCommentsActor.trim(),
              facebookComments: settingsForm.apifyFacebookCommentsActor.trim(),
              tiktokComments: settingsForm.apifyTikTokCommentsActor.trim(),
            },
          },
          provider: {
            allowedHosts: settingsForm.providerAllowedHosts,
            replyAllowedHosts: settingsForm.providerReplyAllowedHosts,
          },
        }),
      })
      const json = await readApiJson<MonitoringSettings>(res, t("settingsSaveFailed"))
      if (!res.ok || !json.success) throw new Error(json.error || t("settingsSaveFailed"))
      setMonitoringSettings(json.data ?? null)
      setSettingsOpen(false)
      toast.success(t("settingsSaved"))
      await loadSources()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settingsSaveFailed"))
    } finally {
      setSettingsSaving(false)
    }
  }

  const saveSource = async () => {
    if (
      brandProtectionOnly
      && (
        !editingSource
        || editingSource.platform !== "web"
        || form.platform !== "web"
      )
    ) return
    const target = form.target.trim()
    const keywords = splitKeywords(form.keywords)
    if (!target) {
      toast.error(t("targetRequired"))
      return
    }
    if (providerMode && !form.providerEndpoint.trim()) {
      toast.error(t("providerEndpointRequired"))
      return
    }
    if (providerMode && form.providerReplyEnabled && !form.providerReplyEndpoint.trim()) {
      toast.error(t("providerReplyEndpointRequired"))
      return
    }

    const payload: Record<string, unknown> = {
      platform: form.platform,
      sourceType: form.sourceType,
      ownership: form.ownership,
      cadenceMinutes: Number(form.cadenceMinutes) || 60,
      keywords,
    }
    if (form.collectionMode !== "auto") payload.collectionMode = form.collectionMode

    if (form.sourceType === "search_url" || isUrl(target)) {
      payload.url = target
    } else if (form.sourceType === "hashtag" || form.sourceType === "keyword") {
      payload.query = target
    } else {
      payload.handle = target
    }
    const settings: Record<string, unknown> = {}
    if (form.socialAccountId) {
      settings.socialAccountId = form.socialAccountId
    }
    if (providerMode) {
      const provider: Record<string, unknown> = {
        approved: true,
        endpoint: form.providerEndpoint.trim(),
      }
      if (form.providerName.trim()) provider.name = form.providerName.trim()
      if (form.providerToken.trim()) provider.token = form.providerToken.trim()
      if (form.providerReplyEnabled) {
        provider.reply = {
          approved: true,
          endpoint: form.providerReplyEndpoint.trim(),
          ...(form.providerName.trim() ? { name: form.providerName.trim() } : {}),
          ...(form.providerReplyToken.trim() ? { token: form.providerReplyToken.trim() } : {}),
        }
      }
      settings.provider = provider
    }
    if (Object.keys(settings).length > 0) {
      payload.settings = settings
    }

    setSaving(true)
    try {
      const res = await fetch(editingSource ? `/api/v1/social/monitoring-sources/${editingSource.id}` : "/api/v1/social/monitoring-sources", {
        method: editingSource ? "PATCH" : "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
      })
      const json = await readApiJson<MonitoringSource>(res, t("saveFailed"))
      if (!res.ok || !json.success) throw new Error(json.error || t("saveFailed"))
      toast.success(t("saved"))
      closeDialog()
      await loadSources()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  // Paste-links quick-add: one URL per line → auto-detect platform + type, create
  // as external watch targets. The heavy dialog stays for advanced tuning.
  const bulkAddUrls = async () => {
    if (brandProtectionOnly) return
    const lines = Array.from(new Set(bulkUrls.split(/\n+/).map((s) => s.trim()).filter(Boolean)))
    if (lines.length === 0) return
    setBulkAdding(true)
    setBulkResult(null)
    let added = 0
    let duplicate = 0
    let skipped = 0
    for (const line of lines) {
      const platform = detectSocialPlatformFromUrl(line)
      if (!platform) {
        skipped++
        continue
      }
      try {
        const res = await fetch("/api/v1/social/monitoring-sources", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({
            platform,
            sourceType: detectSocialSourceTypeFromUrl(line),
            url: line,
            ownership: "external",
            keywords: [],
          }),
        })
        if (res.ok) {
          const json = await readApiJson<MonitoringSource & { reused?: boolean }>(res, t("saveFailed"))
          if (json.data?.reused) duplicate++
          else added++
        } else if (res.status === 409) {
          duplicate++
        } else {
          skipped++
        }
      } catch {
        skipped++
      }
    }
    setBulkAdding(false)
    setBulkResult({ added, duplicate, skipped })
    if (added > 0) {
      setBulkUrls("")
      toast.success(t("quickAdd.addedToast", { count: added }))
      await loadSources()
    }
    if (added === 0 && skipped > 0) toast.error(t("quickAdd.noneAddedToast"))
  }

  const patchSourceStatus = async (source: MonitoringSource, status: "active" | "paused") => {
    setBusyId(source.id)
    try {
      const res = await fetch(`/api/v1/social/monitoring-sources/${source.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ status }),
      })
      const json = await readApiJson<MonitoringSource>(res, t("saveFailed"))
      if (!res.ok || !json.success) throw new Error(json.error || t("saveFailed"))
      if (json.data) setSources((current) => current.map((item) => (item.id === source.id ? json.data as MonitoringSource : item)))
      toast.success(status === "active" ? t("resumed") : t("paused"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"))
    } finally {
      setBusyId(null)
    }
  }

  const deleteSource = async (source: MonitoringSource) => {
    if (!confirm(t("deleteConfirm", { target: targetLabel(source) }))) return
    setBusyId(source.id)
    try {
      const res = await fetch(`/api/v1/social/monitoring-sources/${source.id}`, {
        method: "DELETE",
        headers,
      })
      const json = await readApiJson<unknown>(res, t("deleteFailed"))
      if (!res.ok || !json.success) throw new Error(json.error || t("deleteFailed"))
      setSources((current) => current.filter((item) => item.id !== source.id))
      toast.success(t("deleted"))
      await loadSources()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("deleteFailed"))
    } finally {
      setBusyId(null)
    }
  }

  const collectorErrorLabel = (error: string | null | undefined): string => {
    if (error === "collector_not_configured") return t("runErrors.collector_not_configured")
    if (error === "collector_exception") return t("runErrors.collector_exception")
    if (error === "official_account_not_connected") return t("collectorErrors.official_account_not_connected")
    if (error === "official_token_unavailable") return t("collectorErrors.official_token_unavailable")
    if (error === "official_permission_error") return t("collectorErrors.official_permission_error")
    if (error === "official_rate_limited") return t("collectorErrors.official_rate_limited")
    if (error === "official_fetch_failed") return t("collectorErrors.official_fetch_failed")
    if (error === "official_tiktok_comments_require_webhook") return t("collectorErrors.official_tiktok_comments_require_webhook")
    if (error === "instagram_hashtag_query_required") return t("collectorErrors.instagram_hashtag_query_required")
    if (error === "official_collector_not_supported") return t("collectorErrors.official_collector_not_supported")
    if (error === "provider_not_approved") return t("collectorErrors.provider_not_approved")
    if (error === "provider_endpoint_missing") return t("collectorErrors.provider_endpoint_missing")
    if (error === "provider_endpoint_invalid") return t("collectorErrors.provider_endpoint_invalid")
    if (error === "provider_https_required") return t("collectorErrors.provider_https_required")
    if (error === "provider_host_not_allowed") return t("collectorErrors.provider_host_not_allowed")
    if (error === "provider_rate_limited") return t("collectorErrors.provider_rate_limited")
    if (error === "provider_fetch_failed") return t("collectorErrors.provider_fetch_failed")
    if (error === "provider_payload_invalid") return t("collectorErrors.provider_payload_invalid")
    if (error === "search_index_cadence_too_fast") return t("collectorErrors.search_index_cadence_too_fast")
    if (error === "search_index_not_approved") return t("collectorErrors.search_index_not_approved")
    if (error === "search_index_endpoint_missing") return t("collectorErrors.search_index_endpoint_missing")
    if (error === "search_index_endpoint_invalid") return t("collectorErrors.search_index_endpoint_invalid")
    if (error === "search_index_https_required") return t("collectorErrors.search_index_https_required")
    if (error === "search_index_host_not_allowed") return t("collectorErrors.search_index_host_not_allowed")
    if (error === "search_index_query_missing") return t("collectorErrors.search_index_query_missing")
    if (error === "search_index_rate_limited") return t("collectorErrors.search_index_rate_limited")
    if (error === "search_index_fetch_failed") return t("collectorErrors.search_index_fetch_failed")
    if (error === "search_index_payload_invalid") return t("collectorErrors.search_index_payload_invalid")
    if (error === "notification_inbox_not_approved") return t("collectorErrors.notification_inbox_not_approved")
    if (error === "notification_inbox_endpoint_missing") return t("collectorErrors.notification_inbox_endpoint_missing")
    if (error === "notification_inbox_endpoint_invalid") return t("collectorErrors.notification_inbox_endpoint_invalid")
    if (error === "notification_inbox_https_required") return t("collectorErrors.notification_inbox_https_required")
    if (error === "notification_inbox_host_not_allowed") return t("collectorErrors.notification_inbox_host_not_allowed")
    if (error === "notification_inbox_rate_limited") return t("collectorErrors.notification_inbox_rate_limited")
    if (error === "notification_inbox_fetch_failed") return t("collectorErrors.notification_inbox_fetch_failed")
    if (error === "notification_inbox_payload_invalid") return t("collectorErrors.notification_inbox_payload_invalid")
    if (error === "browser_capture_feature_disabled") return t("collectorErrors.browser_capture_feature_disabled")
    if (error === "browser_capture_not_approved") return t("collectorErrors.browser_capture_not_approved")
    if (error === "manual_collection_required") return t("collectorErrors.manual_collection_required")
    if (error === "source_route_plan_blocked") return t("collectorErrors.source_route_plan_blocked")
    if (error === "paid_route_budget_enforcement_disabled") return t("collectorErrors.paid_route_budget_enforcement_disabled")
    if (error === "paid_route_budget_unconfigured") return t("collectorErrors.paid_route_budget_unconfigured")
    if (error === "paid_manual_run_cap_required") return t("collectorErrors.paid_manual_run_cap_required")
    if (error === "paid_manual_runs_not_authorized") return t("collectorErrors.paid_manual_runs_not_authorized")
    if (error === "paid_manual_run_emergency_stopped") return t("collectorErrors.paid_manual_run_emergency_stopped")
    if (error === "paid_manual_run_cap_exceeds_tenant_limit") return t("collectorErrors.paid_manual_run_cap_exceeds_tenant_limit")
    if (error === "paid_manual_run_actor_required") return t("collectorErrors.paid_manual_run_actor_required")
    if (error === "paid_manual_run_cap_invalid") return t("collectorErrors.paid_manual_run_cap_invalid")
    if (error === "paid_manual_run_cap_exhausted") return t("collectorErrors.paid_manual_run_cap_exhausted")
    if (error === "paid_route_daily_budget_exhausted") return t("collectorErrors.paid_route_daily_budget_exhausted")
    if (error === "paid_route_monthly_budget_exhausted") return t("collectorErrors.paid_route_monthly_budget_exhausted")
    if (error === "paid_route_budget_guard_failed") return t("collectorErrors.paid_route_budget_guard_failed")
    if (error === "apify_start_402") return t("collectorErrors.apify_start_402")
    if (error === "apify_token_missing") return t("collectorErrors.apify_token_missing")
    if (error === "apify_no_public_items") return t("collectorErrors.apify_no_public_items")
    if (error === "apify_provider_item_errors") return t("collectorErrors.apify_provider_item_errors")
    if (error === "apify_schema_drift_threshold") return t("collectorErrors.apify_schema_drift_threshold")
    if (error === "source_routes_partial_or_pending") return t("collectorErrors.source_routes_partial_or_pending")
    return error || t("runErrors.unknown")
  }

  const runSourceRequest = async (
    source: MonitoringSource,
    maxTotalChargeUsd?: number,
    onlyCapability?: string,
    paidRunConfirmed = maxTotalChargeUsd !== undefined,
  ) => {
    const res = await fetch(`/api/v1/social/monitoring-sources/${source.id}/run`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(maxTotalChargeUsd === undefined ? {} : { maxTotalChargeUsd }),
        ...(onlyCapability ? { onlyCapability } : {}),
        ...(paidRunConfirmed ? { paidConfirmed: true } : {}),
      }),
    })
    const json = await readApiJson<CollectorRunSummary>(res, t("runFailed"))
    if (res.status === 429) {
      throw new Error(t("runRateLimited", { seconds: json.retryAfterSeconds ?? 60 }))
    }
    if (!res.ok || !json.success || !json.data) throw new Error(json.error || t("runFailed"))
    return json.data
  }

  const notifyRunResult = (result: CollectorRunSummary) => {
    if (result.status === "skipped") {
      toast.warning(t("runSkipped", { reason: collectorErrorLabel(result.error) }))
    } else if (result.status === "failed") {
      toast.error(t("runFailedWithReason", { reason: collectorErrorLabel(result.error) }))
    } else if (result.status === "partial") {
      toast.warning(t("runPartial", { found: result.foundCount, created: result.newCount, reason: collectorErrorLabel(result.error) }))
    } else {
      toast.success(t("runCompleted", { found: result.foundCount, created: result.newCount }))
    }
  }

  const executeSourceNow = async (
    source: MonitoringSource,
    maxTotalChargeUsd?: number,
    onlyCapability?: string,
    paidRunConfirmed = maxTotalChargeUsd !== undefined,
  ) => {
    setBusyId(source.id)
    try {
      const result = await runSourceRequest(source, maxTotalChargeUsd, onlyCapability, paidRunConfirmed)
      notifyRunResult(result)
      await loadSources()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("runFailed"))
      return false
    } finally {
      setBusyId(null)
    }
  }

  const runSourceNow = async (source: MonitoringSource) => {
    if (sourceHasPaidRoute(source)) {
      setPaidRunSource(source)
      setPaidRunCapability("")
      setPaidRunReport(null)
      void loadPaidRunReport()
      return
    }
    await executeSourceNow(source)
  }

  const closePaidRunDialog = () => {
    if (paidRunSubmitting) return
    setPaidRunSource(null)
    setPaidRunCapability("")
    setPaidRunReport(null)
  }

  const confirmPaidRun = async () => {
    if (!paidRunSource) return
    if (!paidRunReport?.globalEnforcementEnabled
      || !paidRunReport.policy.manualRunsEnabled
      || paidRunReport.policy.emergencyStopped) {
      toast.error(t("paidRunPolicyBlocked"))
      return
    }
    // Quota-governed tenants run without a USD cap; the daily scan quota bounds it.
    if (paidRunUsesQuota) {
      if (!paidRunQuotaReady) {
        toast.error(t("paidRunPolicyBlocked"))
        return
      }
      setPaidRunSubmitting(true)
      try {
        const completed = await executeSourceNow(
          paidRunSource,
          undefined,
          paidRunCapability || undefined,
          true,
        )
        if (completed) setPaidRunSource(null)
      } finally {
        setPaidRunSubmitting(false)
      }
      return
    }
    if (!paidRunAutomaticCapValid) {
      toast.error(t("paidRunPolicyBlocked"))
      return
    }
    setPaidRunSubmitting(true)
    try {
      const completed = await executeSourceNow(paidRunSource, paidRunAutomaticCapUsd, paidRunCapability || undefined)
      if (completed) {
        setPaidRunSource(null)
        setPaidRunCapability("")
      }
    } finally {
      setPaidRunSubmitting(false)
    }
  }

  const startBulkRun = async (kind: WatchlistRunJobKind) => {
    if (bulkRunning || bulkJobMutating) return
    setBulkJobMutating(true)
    try {
      const requestSlot = `${kind}:${sourceScope}`
      const requestKey = bulkIdempotencyKeysRef.current[requestSlot] ?? crypto.randomUUID()
      bulkIdempotencyKeysRef.current[requestSlot] = requestKey
      const response = await fetch("/api/v1/social/monitoring-run-jobs", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({
          kind,
          sourceScope,
          ...(kind === "SOURCE_FULL" ? { paidConfirmed: true } : {}),
        }),
      })
      const body = await readSocialMonitoringRunJobResponse(response)
      if (
        !response.ok
        || !body.success
        || !body.data
        || body.data.kind !== kind
        || body.data.sourceScope !== sourceScope
      ) {
        throw new Error(body.error || "monitoring_run_job_start_failed")
      }
      setBulkJobs(current => ({ ...current, [kind]: body.data! }))
      delete bulkIdempotencyKeysRef.current[requestSlot]
      toast.success(t("runJobQueued"))
    } catch (error) {
      console.error("Monitoring source bulk job failed to start", error)
      toast.error(t("runJobStartFailed"))
    } finally {
      setBulkJobMutating(false)
    }
  }

  const runAllSourcesNow = async () => {
    if (runnableSources.length === 0) {
      toast.warning(t("runAllEmpty"))
      return
    }
    await startBulkRun("SOURCE_FULL")
  }

  const runWebNewsNow = async () => {
    if (runnableWebNewsSources.length === 0) {
      toast.warning(t("runWebNewsEmpty"))
      return
    }
    await startBulkRun("WEB_NEWS")
  }

  const stopBulkRun = async () => {
    if (!activeBulkJob || bulkJobMutating) return
    if (activeBulkJob.kind === "PROFILE_FULL") return
    const kind = activeBulkJob.kind
    setBulkJobMutating(true)
    try {
      const response = await fetch(
        `/api/v1/social/monitoring-run-jobs/${encodeURIComponent(activeBulkJob.id)}/cancel`,
        { method: "POST", headers },
      )
      const body = await readSocialMonitoringRunJobResponse(response)
      if (
        !response.ok
        || !body.success
        || !body.data
        || body.data.kind !== kind
        || body.data.sourceScope !== activeBulkJob.sourceScope
      ) {
        throw new Error(body.error || "monitoring_run_job_cancel_failed")
      }
      setBulkJobs(current => ({ ...current, [kind]: body.data! }))
      if (!socialMonitoringRunJobIsActive(body.data)) await loadSources()
    } catch (error) {
      console.error("Monitoring source bulk job failed to cancel", error)
      toast.error(t("runJobCancelFailed"))
    } finally {
      setBulkJobMutating(false)
    }
  }

  const resumeBulkRun = async (job: SocialMonitoringRunJob) => {
    if (!socialMonitoringRunJobCanResume(job) || bulkJobMutating) return
    if (job.kind === "PROFILE_FULL") return
    const kind = job.kind
    setBulkJobMutating(true)
    try {
      const response = await fetch(
        `/api/v1/social/monitoring-run-jobs/${encodeURIComponent(job.id)}/resume`,
        { method: "POST", headers },
      )
      const body = await readSocialMonitoringRunJobResponse(response)
      if (
        !response.ok
        || !body.success
        || !body.data
        || body.data.kind !== kind
        || body.data.sourceScope !== job.sourceScope
      ) {
        throw new Error(body.error || "monitoring_run_job_resume_failed")
      }
      setBulkJobs(current => ({ ...current, [kind]: body.data! }))
    } catch (error) {
      console.error("Monitoring source bulk job failed to resume", error)
      toast.error(t("runJobResumeFailed"))
    } finally {
      setBulkJobMutating(false)
    }
  }

  const displayedBulkJobStatus = displayedBulkJob?.status === "QUEUED"
    ? t("runJobStatuses.queued")
    : displayedBulkJob?.status === "RUNNING"
      ? t("runJobStatuses.running")
      : displayedBulkJob?.status === "WAITING_PROVIDER"
        ? t("runJobStatuses.waitingProvider")
        : displayedBulkJob?.status === "CANCEL_REQUESTED"
          ? t("runJobStatuses.cancelRequested")
          : displayedBulkJob?.status === "COMPLETED"
            ? t("runJobStatuses.completed")
            : displayedBulkJob?.status === "COMPLETED_WITH_ISSUES"
              ? t("runJobStatuses.completedWithIssues")
              : displayedBulkJob?.status === "CANCELED"
                ? t("runJobStatuses.canceled")
                : t("runJobStatuses.failed")
  const displayedBulkJobLabel = displayedBulkJob
    ? t(displayedBulkJob.kind === "WEB_NEWS" ? "runWebNews" : "runAll")
    : ""
  const displayedBulkScopeLabel = displayedBulkJob?.sourceScope === "OWNED"
    ? t("titleOwned")
    : t("title")
  const displayedBulkItemLabel = displayedBulkJob
    && socialMonitoringRunJobIsActive(displayedBulkJob)
    ? displayedBulkJob.currentItem?.sourceLabel
      || displayedBulkJob.currentItem?.profileName
      || displayedBulkJobLabel
    : displayedBulkJobLabel

  const targetHint = form.sourceType === "search_url"
    ? t("targetSearchUrl")
    : form.sourceType === "hashtag"
      ? t("targetHashtag")
      : form.sourceType === "keyword"
        ? t("targetKeyword")
        : t("targetPage")

  return (
    <section data-tour-id="social-watchlist" data-testid="social-watchlist" className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              {view === "owned"
                ? <MessageSquare className="h-4 w-4 text-emerald-600" />
                : <ShieldCheck className="h-4 w-4 text-emerald-600" />}
              {t(view === "owned" ? "titleOwned" : "title")}
            </h3>
            <Badge variant="outline" className="text-[10px]">{t("safeMode")}</Badge>
            {view === "external" && <Badge variant="warning" className="text-[10px]">{t("noLiveReplies")}</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t(view === "owned" ? "subtitleOwned" : "subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={loadSources} disabled={loading || bulkRunning || bulkJobMutating}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {t("refresh")}
          </Button>
          {view === "external" ? (
            <Button
              data-testid="social-run-web-news"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={runWebNewsNow}
              disabled={loading || bulkRunning || bulkJobMutating || runnableWebNewsSources.length === 0}
              title={t("runWebNewsHint")}
            >
              {bulkRunning || bulkJobMutating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Newspaper className="h-3.5 w-3.5" />}
              {t("runWebNews")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={runAllSourcesNow}
            disabled={loading || bulkRunning || bulkJobMutating || runnableSources.length === 0}
            title={t("runAllHint")}
          >
            {bulkRunning || bulkJobMutating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {bulkRunning ? t("runAllRunning") : t("runAll")}
          </Button>
          {bulkRunning ? (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => { void stopBulkRun() }}
              disabled={bulkJobMutating || activeBulkJob?.status === "CANCEL_REQUESTED"}
              title={t("runAllStopHint")}
            >
              {t("runAllStop")}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={openSettingsDialog} disabled={bulkRunning || bulkJobMutating}>
            <Settings2 className="h-3.5 w-3.5" />
            {t("settings")}
          </Button>
          {!brandProtectionOnly ? (
            <Button data-testid="social-watchlist-add" size="sm" className="h-8 gap-1.5 text-xs" onClick={openCreateDialog} disabled={bulkRunning || bulkJobMutating}>
              <Plus className="h-3.5 w-3.5" />
              {t("addSource")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Полоса на самой странице, а не только в модалке настроек: смысл #665
          в том, чтобы оператор УВИДЕЛ молчание, не догадываясь открыть
          «Настройки». Показывается только когда есть о чём предупредить. */}
      {scheduleAlert && (
        <div
          data-testid="social-schedule-alert"
          className={scheduleAlert.tone === "error"
            ? "mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200"
            : "mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200"}
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{scheduleAlert.message}</span>
        </div>
      )}

      {displayedBulkJob && (
        <div
          data-testid="social-watchlist-run-progress"
          className="mt-3 rounded-lg border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900/40 dark:bg-orange-950/20"
        >
          <div className="flex items-center justify-between gap-2 text-xs font-medium">
            <span className="flex items-center gap-1.5 truncate">
              {socialMonitoringRunJobIsActive(displayedBulkJob) || bulkJobMutating
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-orange-600 motion-reduce:animate-none" />
                : displayedBulkJob.status === "COMPLETED"
                  ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
              <span className="truncate" role="status" aria-live="polite">
                {displayedBulkJobLabel} · {displayedBulkScopeLabel} · {displayedBulkJobStatus}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {displayedBulkJob.processedItems}/{displayedBulkJob.totalItems}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {t("runJobProgress", {
              completed: displayedBulkJob.processedItems,
              total: displayedBulkJob.totalItems,
              name: displayedBulkItemLabel,
              found: displayedBulkJob.foundCount,
              created: displayedBulkJob.newCount,
            })}
          </p>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-orange-100 dark:bg-orange-900/40"
            role="progressbar"
            aria-label={`${displayedBulkJobLabel}: ${displayedBulkJobStatus}`}
            aria-valuemin={0}
            aria-valuemax={displayedBulkJob.totalItems}
            aria-valuenow={displayedBulkJob.processedItems}
          >
            <div
              className="h-full w-full origin-left rounded-full bg-orange-500 transition-transform"
              style={{ transform: `scaleX(${Math.min(1, displayedBulkJob.processedItems / Math.max(1, displayedBulkJob.totalItems))})` }}
            />
          </div>
          {socialMonitoringRunJobCanResume(displayedBulkJob) && (
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                data-testid="social-watchlist-run-resume"
                onClick={() => { void resumeBulkRun(displayedBulkJob) }}
                disabled={bulkJobMutating}
              >
                {bulkJobMutating
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                  : <RefreshCw className="h-3.5 w-3.5" />}
                {t("runJobResume")}
              </Button>
            </div>
          )}
        </div>
      )}

      {view === "external" && (
      <>
      {!brandProtectionOnly ? (
        <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50/40 p-3 dark:border-orange-900/40 dark:bg-orange-950/10">
          {/* Fast path: paste one or many links, we auto-detect platform + type. */}
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-orange-600" />
            <span className="text-sm font-semibold">{t("quickAdd.title")}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("quickAdd.desc")}</p>
          <textarea
            data-testid="social-watchlist-quick-add"
            value={bulkUrls}
            onChange={(event) => setBulkUrls(event.target.value)}
            rows={3}
            placeholder={t("quickAdd.placeholder")}
            className="mt-2 w-full resize-y rounded-md border border-zinc-200 bg-background p-2 text-sm dark:border-zinc-700"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {bulkResult
                ? t("quickAdd.result", { added: bulkResult.added, duplicate: bulkResult.duplicate, skipped: bulkResult.skipped })
                : t("quickAdd.hint")}
            </span>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={bulkAddUrls}
              disabled={bulkAdding || bulkUrls.trim().length === 0}
            >
              {bulkAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {t("quickAdd.add")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Metric label={t("directSourceMetric")} value={directExternalSourceCount} />
        <Metric label={t("due")} value={stats?.due ?? 0} tone="amber" />
        <Metric label={t("degraded")} value={stats?.degraded ?? 0} tone="red" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-background px-3 py-2 text-xs dark:border-zinc-700">
        <Badge variant={monitoringSettings?.searchIndex.enabled ? "success" : "warning"} className="text-[10px]">
          {monitoringSettings?.searchIndex.enabled ? t("settingsSearchIndexOn") : t("settingsSearchIndexOff")}
        </Badge>
        <span className="min-w-0 break-words text-muted-foreground">
          {monitoringSettings?.searchIndex.provider === "apify"
            ? t("settingsSearchIndexApifyStatus")
            : monitoringSettings?.searchIndex.endpoint
            ? t("settingsSearchIndexEndpoint", { host: hostLabelFromUrl(monitoringSettings.searchIndex.endpoint) })
            : t("settingsSearchIndexMissing")}
        </span>
      </div>

      {coverage && (
        <div data-testid="social-coverage-dashboard" className="mt-4 rounded-lg border border-zinc-200 bg-background p-3 dark:border-zinc-700">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("coverageTitle")}</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {coverage.partialCoverage ? t("partialCoverageCopy") : t("fullCoverageCopy")}
              </p>
            </div>
            {coverage.latestRun && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={coverage.latestRun.status === "failed" ? "destructive" : coverage.latestRun.status === "partial" ? "warning" : "success"} className="w-fit text-[10px]">
                  {t("latestRun", { status: coverage.latestRun.status, found: coverage.latestRun.foundCount, created: coverage.latestRun.newCount })}
                </Badge>
                {latestRunLookbackHours && (
                  <Badge variant="outline" className="w-fit text-[10px]">
                    {t("lookbackWindow", { hours: latestRunLookbackHours })}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label={t("activeSources")} value={coverage.activeSources} />
            <Metric label={t("healthySources")} value={coverage.health.healthy} tone="green" />
            <Metric label={t("last24Found")} value={coverage.last24h.found} />
            <Metric label={t("last24New")} value={coverage.last24h.new} tone="green" />
            <Metric label={t("failedRuns")} value={coverage.last24h.failed + coverage.last24h.partial} tone={coverage.last24h.failed > 0 ? "red" : "amber"} />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <div className="text-[11px] font-medium uppercase text-muted-foreground">{t("trustTiers")}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["T1", "T2", "T3", "T4", "T5", "T6"].map((tier) => (
                  <Badge key={tier} variant="outline" className="text-[10px]">
                    {tier}: {coverage.trustTiers[tier] ?? 0}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <div className="text-[11px] font-medium uppercase text-muted-foreground">{t("rejectionReasons")}</div>
              {latestRunRejectionReasons.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">{t("noRejectionReasons")}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {latestRunRejectionReasons.map(([reason, count]) => (
                    <li key={reason} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate text-muted-foreground" title={reason}>{reason}</span>
                      <Badge variant="outline" className="text-[10px]">{count}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-md border border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <div className="text-[11px] font-medium uppercase text-muted-foreground">{t("recentAlerts")}</div>
              {coverage.recentAlerts.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">{t("noCoverageAlerts")}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {coverage.recentAlerts.slice(0, 3).map((alert) => (
                    <li key={alert.id} className="flex items-start gap-2 text-xs">
                      <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5", alert.severity === "critical" ? "text-red-500" : "text-amber-500")} />
                      <span className="min-w-0 flex-1 truncate">{alert.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 pl-9 text-sm"
            placeholder={t("searchPlaceholder")}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("replyPolicyHint")}</p>
      </div>

      {loading ? (
        <div className="mt-4 space-y-2">
          {[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-md bg-muted" />)}
        </div>
      ) : viewIsEmpty ? (
        <div className="mt-4 rounded-lg border border-dashed border-zinc-200 px-4 py-8 text-center dark:border-zinc-700">
          <Globe2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{hasSourcesInView ? t("noResults") : t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">{t("emptyHint")}</p>
          {!brandProtectionOnly ? (
            <Button size="sm" className="mt-4 h-8 gap-1.5 text-xs" onClick={openCreateDialog}>
              <Plus className="h-3.5 w-3.5" />
              {t("addSource")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {(() => {
            const renderSourceCard = (source: MonitoringSource) => {
            const Icon = sourceIcon(source.sourceType)
            const link = source.url
            const paused = source.status === "paused"
            const working = busyId === source.id || bulkRunningSourceIds.has(source.id)
            const actionDisabled = working || bulkRunning || bulkJobMutating
            const needsKeywords = sourceNeedsKeywords(source)
            const routePlans = uniqueRoutePlans(source.routePlans)
            const runRollup = providerRunRollup(source.providerRuns ?? [])
            const legacyDirectSocialLocked = brandProtectionOnly
              && source.platform !== "web"
              && monitoringSourcePresentationKind(source) === "direct"
            const collectionStatus = paused || source.status === "disabled"
              ? "paused"
              : source.readiness?.canCollect && !source.health?.lastError
                ? "active"
                : source.readiness?.canCollect || source.status === "limited"
                  ? "limited"
                  : source.readiness?.overall === "blocked" || source.status === "blocked"
                    ? "blocked"
                    : "needs_setup"
            return (
              <div
                key={source.id}
                data-testid={`social-source-card-${source.id}`}
                className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1.35fr)_0.75fr_0.8fr_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{targetLabel(source)}</span>
                    {link && (
                      <a href={link} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={t("openTarget")}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="uppercase">{source.platform}</span>
                    <span>/</span>
                    <span>{t(`sourceTypes.${source.sourceType}`)}</span>
                    <span>/</span>
                    <span>
                      {sourceIsOfficialIdentity(source)
                        ? t("ownership.officialIdentity")
                        : t(`ownership.${source.ownership}`)}
                    </span>
                    {source.ownership === "owned" && source.keywords.length > 0 && <span>{t("keywordCount", { count: source.keywords.length })}</span>}
                  </div>
                  {needsKeywords && (
                    <p className="mt-1 text-[11px] leading-4 text-amber-700 dark:text-amber-300">{t("keywordsMissingHint")}</p>
                  )}
                  {routePlans.length === 0 && (
                    <p className="mt-2 text-[11px] text-red-600 dark:text-red-300">{t("routePlanMissing")}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={statusVariant(collectionStatus)} className="text-[10px]">{t(`statuses.${collectionStatus}`)}</Badge>
                  {needsKeywords && <Badge variant="warning" className="text-[10px]">{t("keywordsMissingBadge")}</Badge>}
                  {source.providerSetup?.collectionConfigured && (
                    <Badge variant={source.providerSetup.collectionApproved ? "success" : "warning"} className="max-w-full text-[10px]">
                      {t("providerHost", { host: source.providerSetup.collectionEndpointHost || "-" })}
                    </Badge>
                  )}
                  {source.providerSetup?.replyConfigured && (
                    <Badge variant={source.providerSetup.replyApproved ? "success" : "warning"} className="max-w-full text-[10px]">
                      {t("providerReplyHost", { host: source.providerSetup.replyEndpointHost || "-" })}
                    </Badge>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  <div className="mt-0.5">
                    {source.health?.lastCheckedAt
                      ? t("lastChecked", { date: formatDateTime(source.health.lastCheckedAt, locale) })
                      : t("notCheckedYet")}
                  </div>
                  {source.health?.lastError && (
                    <div className="mt-0.5 break-words text-[11px] text-amber-600 dark:text-amber-300">
                      {collectorErrorLabel(source.health.lastError)}
                    </div>
                  )}
                  {routePlans.some((route) => route.capability === "READ_EXTERNAL_COMMENTS") && (
                    <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {t("externalCommentsCoverageHint")}
                    </div>
                  )}
                  {source.providerSetup?.collectionConfigured && !source.providerSetup.collectionApproved && (
                    <div className="mt-0.5 break-words text-[11px] text-amber-600 dark:text-amber-300">
                      {t("providerNotApproved")}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-start gap-1 md:max-w-[18rem] md:justify-end">
                  {!legacyDirectSocialLocked ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 whitespace-nowrap text-xs"
                      disabled={actionDisabled}
                      onClick={() => openEditDialog(source)}
                      title={t("configure")}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      {t("configure")}
                    </Button>
                  ) : null}
                  {sourceIsExternalMonitoringTarget(source) && !legacyDirectSocialLocked && (
                    <Button
                      data-testid={`social-source-run-${source.id}`}
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 whitespace-nowrap text-xs"
                      disabled={actionDisabled}
                      onClick={() => runSourceNow(source)}
                      title={t("runNowHint")}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", working && "animate-spin")} />
                      {t("runNow")}
                    </Button>
                  )}
                  {!legacyDirectSocialLocked ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2"
                      disabled={actionDisabled}
                      onClick={() => patchSourceStatus(source, paused ? "active" : "paused")}
                      title={paused ? t("resume") : t("pause")}
                    >
                      {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-muted-foreground hover:text-red-600"
                    disabled={actionDisabled}
                    onClick={() => deleteSource(source)}
                    title={t("delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <details className="border-t border-zinc-200 pt-2 text-xs md:col-span-4 dark:border-zinc-800">
                  <summary className="cursor-pointer select-none font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                    {t("providerEvidence")}
                  </summary>
                  <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.8fr)]">
                    <div className="min-w-0 space-y-2">
                      {routePlans.map((route) => (
                        <div key={`${route.id}:evidence`} className="grid gap-1 border-b border-zinc-100 pb-2 last:border-0 dark:border-zinc-800 lg:grid-cols-[minmax(9rem,0.7fr)_minmax(0,1.3fr)_auto] lg:items-start">
                          <div className="font-medium text-foreground">{t(`routeCapabilities.${route.capability}`)}</div>
                          <div className="min-w-0 text-muted-foreground">
                            <div className="break-words">
                              {t("primaryRoute", { adapter: route.primaryAdapter })}
                              {route.fallbackAdapters.length > 0 && ` · ${t("fallbackRoute", { adapters: route.fallbackAdapters.join(" → ") })}`}
                            </div>
                            <div className="mt-0.5 break-words text-[11px]">{route.reason}</div>
                          </div>
                          <Badge variant={route.capabilityProof?.status === "VERIFIED" ? "success" : route.capabilityProofId ? "warning" : "outline"} className="w-fit text-[10px]">
                            {route.capabilityProof
                              ? t("proofStatus", { status: route.capabilityProof.status })
                              : route.capabilityProofId
                                ? t("proofMissing")
                                : t("proofNotRequired")}
                          </Badge>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="font-medium text-foreground">{t("providerFunnel")}</div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Badge variant="outline">{t("funnelCandidates", { count: runRollup.candidates })}</Badge>
                          <Badge variant="outline">{t("funnelEnriched", { count: runRollup.enriched })}</Badge>
                          <Badge variant="warning">{t("funnelReview", { count: runRollup.review })}</Badge>
                          <Badge variant="success">{t("funnelAccepted", { count: runRollup.accepted })}</Badge>
                          <Badge variant="secondary">{t("funnelDuplicates", { count: runRollup.duplicates })}</Badge>
                        </div>
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{t("providerCost")}</div>
                        <p className="mt-1 text-muted-foreground">
                          {runRollup.hasActual
                            ? t("actualCost", { cost: usdFormatter.format(runRollup.actualUsd) })
                            : t("reservedExposure", { cost: usdFormatter.format(runRollup.reservedUsd) })}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {runRollup.accepted > 0
                            ? t("costPerAccepted", {
                              cost: usdFormatter.format((runRollup.hasActual ? runRollup.actualUsd : runRollup.reservedUsd) / runRollup.accepted),
                            })
                            : t("costPerAcceptedUnavailable")}
                        </p>
                      </div>
                      {source.health?.lastRun && (source.health.lastRun.error || ["failed", "partial"].includes(source.health.lastRun.status)) && (() => {
                        const lastRun = source.health.lastRun
                        const diag = recordFromUnknown(lastRun.rawStats)
                        const httpStatus = numberFromUnknown(diag.status)
                        const providerReason = typeof diag.reason === "string" && diag.reason ? diag.reason : null
                        const runCredential = typeof diag.credential === "string" && diag.credential ? diag.credential : null
                        const responseBody = typeof diag.body === "string" && diag.body ? diag.body : null
                        return (
                          <div>
                            <div className="font-medium text-foreground">{t("lastRunDiagnostics")}</div>
                            <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                              <div className="break-words">{t("lastRunDiagError", { error: lastRun.error ?? lastRun.status })}</div>
                              {httpStatus !== null && <div>{t("lastRunDiagHttp", { status: httpStatus })}</div>}
                              {providerReason && <div className="break-words">{t("lastRunDiagReason", { reason: providerReason })}</div>}
                              {runCredential && <div>{t("lastRunDiagCredential", { credential: runCredential })}</div>}
                              {responseBody && (
                                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-100 p-1.5 text-[10px] dark:bg-zinc-900">{responseBody}</pre>
                              )}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </details>
              </div>
              )
            }
            if (view === "owned") {
              return (
                <div className="space-y-2">
                  <p className="text-[11px] leading-4 text-muted-foreground">{t("groups.owned.desc")}</p>
                  {ownedSources.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center text-xs text-muted-foreground dark:border-zinc-700">{t("groups.owned.empty")}</div>
                  ) : (
                    <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
                      {ownedSources.map((source) => renderSourceCard(source))}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <div className="space-y-5">
                {!brandProtectionOnly || externalDirectSources.length > 0 ? (
                <section data-testid="external-direct-sources" className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold">{t("directSources.title")}</h4>
                      <p className="mt-1 max-w-3xl text-[11px] leading-4 text-muted-foreground">{t("directSources.desc")}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {t("directSources.count", { count: externalDirectSources.length })}
                    </Badge>
                  </div>
                  {externalDirectSources.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center dark:border-zinc-700">
                      <Globe2 className="mx-auto h-6 w-6 text-muted-foreground" />
                      <p className="mt-2 text-xs font-medium">{t("directSources.emptyTitle")}</p>
                      <p className="mx-auto mt-1 max-w-xl text-[11px] leading-4 text-muted-foreground">{t("directSources.emptyHint")}</p>
                      {!brandProtectionOnly ? (
                        <Button size="sm" className="mt-3 h-8 gap-1.5 text-xs" onClick={openCreateDialog}>
                          <Plus className="h-3.5 w-3.5" />
                          {t("addSource")}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
                      {externalDirectSources.map((source) => renderSourceCard(source))}
                    </div>
                  )}
                </section>
                ) : null}

              </div>
            )
          })()}
        </div>
      )}

      <Dialog open={Boolean(paidRunSource)} onOpenChange={(next) => (next ? undefined : closePaidRunDialog())} widthClassName="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("paidRunTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {paidRunUsesQuota
                ? t("paidRunQuotaDescription", { source: paidRunSource ? targetLabel(paidRunSource) : "-" })
                : t("paidRunDescription", { source: paidRunSource ? targetLabel(paidRunSource) : "-" })}
            </p>
            {paidRunSource && sourcePaidCapabilities(paidRunSource).length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="social-paid-run-capability">{t("paidRunCapabilityLabel")}</Label>
                <Select
                  id="social-paid-run-capability"
                  data-testid="social-paid-run-capability"
                  value={paidRunCapability}
                  onChange={(event) => setPaidRunCapability(event.target.value)}
                >
                  <option value="">{t("paidRunCapabilityAll")}</option>
                  {sourcePaidCapabilities(paidRunSource).map((capability) => (
                    <option key={capability} value={capability}>{t(`routeCapabilities.${capability}`)}</option>
                  ))}
                </Select>
                <p className="text-xs leading-5 text-muted-foreground">{t("paidRunCapabilityHelp")}</p>
              </div>
            ) : null}
            {!paidRunUsesQuota && paidRunAutomaticCapValid ? (
              <p className="rounded-md border px-3 py-2 text-xs leading-5 text-muted-foreground" data-testid="social-paid-run-automatic-cap">
                {t("paidRunAutomaticCap", { cap: usdFormatter.format(paidRunAutomaticCapUsd) })}
              </p>
            ) : null}
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              {t("paidRunWarning")}
            </div>
            {paidRunReportLoading ? (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground" data-testid="social-paid-run-policy-loading">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("paidRunPolicyLoading")}
              </div>
            ) : paidRunReport ? (
              <div
                className={cn(
                  "rounded-md border px-3 py-2 text-xs leading-5",
                  (paidRunUsesQuota ? paidRunQuotaReady : paidRunPolicyReady)
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200"
                    : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200",
                )}
                data-testid="social-paid-run-policy-status"
              >
                {paidRunUsesQuota
                  ? (paidRunQuotaReady
                      ? t("paidRunQuotaRemaining", {
                          remaining: paidRunReport.usage.runsRemainingToday ?? 0,
                          quota: paidRunReport.policy.dailyRunQuota,
                        })
                      : t("paidRunPolicyBlocked"))
                  : (paidRunPolicyReady
                      ? t("paidRunPolicyLimits", {
                          perRun: usdFormatter.format(paidRunReport.policy.maxPerRunUsd),
                          day: usdFormatter.format(paidRunReport.usage.dayRemainingUsd),
                          month: usdFormatter.format(paidRunReport.usage.monthRemainingUsd),
                        })
                      : t("paidRunPolicyBlocked"))}
              </div>
            ) : (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200">
                {t("paidRunPolicyLoadFailed")}
              </div>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={closePaidRunDialog} disabled={paidRunSubmitting}>{t("cancel")}</Button>
          <Button data-testid="social-paid-run-confirm" onClick={confirmPaidRun} disabled={paidRunSubmitting || paidRunReportLoading || (paidRunUsesQuota ? !paidRunQuotaReady : (!paidRunPolicyReady || !paidRunAutomaticCapValid))}>
            {paidRunSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {paidRunUsesQuota ? t("paidRunQuotaConfirm") : t("paidRunConfirm")}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())} widthClassName="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editingSource ? t("dialogEditTitle") : t("dialogTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("platform")}</Label>
              <Select value={form.platform} onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value, socialAccountId: "" }))}>
                {PLATFORMS.map((platform) => <option key={platform} value={platform}>{t(`platforms.${platform}`)}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("sourceType")}</Label>
              <Select data-testid="social-watchlist-source-type" value={form.sourceType} onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value }))}>
                {(view === "external" ? DIRECT_SOURCE_TYPES : SOURCE_TYPES).map((sourceType) => (
                  <option key={sourceType} value={sourceType}>{t(`sourceTypes.${sourceType}`)}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("ownershipLabel")}</Label>
              <Select value={form.ownership} onChange={(event) => setForm((current) => ({ ...current, ownership: event.target.value, socialAccountId: event.target.value === "owned" ? current.socialAccountId : "" }))}>
                {OWNERSHIPS.filter((ownership) => !brandProtectionOnly || ownership !== "owned").map((ownership) => <option key={ownership} value={ownership}>{t(`ownership.${ownership}`)}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("cadence")}</Label>
              <Select value={form.cadenceMinutes} onChange={(event) => setForm((current) => ({ ...current, cadenceMinutes: event.target.value }))}>
                <option value="15">{t("cadences.15")}</option>
                <option value="30">{t("cadences.30")}</option>
                <option value="60">{t("cadences.60")}</option>
                <option value="360">{t("cadences.360")}</option>
                <option value="1440">{t("cadences.1440")}</option>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>{t("collectionModeLabel")}</Label>
              <Select
                data-testid="social-watchlist-collection-mode"
                value={form.collectionMode}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  collectionMode: event.target.value,
                  providerName: event.target.value === "provider_api" && !current.providerName ? current.platform : current.providerName,
                }))}
              >
                {COLLECTION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === "auto" ? t("collectionModes.auto") : t(`modes.${mode}`)}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{providerMode ? t("providerModeHelp") : t("collectionModeHelp")}</p>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>{targetHint}</Label>
              <Input
                data-testid="social-watchlist-target"
                value={form.target}
                onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
                placeholder={t("targetPlaceholder")}
              />
              {form.platform === "youtube" && (
                <p className="text-xs leading-5 text-muted-foreground">{t("youtubeTargetHelp")}</p>
              )}
            </div>
            {form.ownership === "owned" && (
              <div className="space-y-1 md:col-span-2">
                <Label>{t("replyIdentityLabel")}</Label>
                <Select
                  value={form.socialAccountId}
                  onChange={(event) => {
                    const selected = platformAccounts.find((account) => account.id === event.target.value)
                    setForm((current) => ({
                      ...current,
                      socialAccountId: event.target.value,
                      target: current.target || selected?.handle || current.target,
                    }))
                  }}
                >
                  <option value="">{platformAccounts.length > 0 ? t("replyIdentityAuto") : t("replyIdentityNone")}</option>
                  {platformAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName || account.handle}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">{t("replyIdentityHelp")}</p>
              </div>
            )}
            {providerMode && (
              <div data-testid="social-watchlist-provider-setup" className="space-y-4 rounded-md border border-zinc-200 bg-muted/20 px-3 py-3 md:col-span-2 dark:border-zinc-700">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold">{t("providerSetupTitle")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t("providerSetupHelp")}</p>
                  </div>
                  <Badge variant="outline" className="w-fit text-[10px]">{t("providerReadOnly")}</Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>{t("providerName")}</Label>
                    <Input
                      value={form.providerName}
                      onChange={(event) => setForm((current) => ({ ...current, providerName: event.target.value }))}
                      placeholder={t("providerNamePlaceholder")}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>{t("providerToken")}</Label>
                    <Input
                      type="password"
                      value={form.providerToken}
                      onChange={(event) => setForm((current) => ({ ...current, providerToken: event.target.value }))}
                      placeholder={t("providerTokenPlaceholder")}
                    />
                    <p className="text-xs text-muted-foreground">{t("providerTokenHelp")}</p>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>{t("providerEndpoint")}</Label>
                    <Input
                      data-testid="social-watchlist-provider-endpoint"
                      value={form.providerEndpoint}
                      onChange={(event) => setForm((current) => ({ ...current, providerEndpoint: event.target.value }))}
                      placeholder={t("providerEndpointPlaceholder")}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-background px-3 py-2 dark:border-zinc-700">
                  <div className="min-w-0">
                    <Label className="text-xs font-medium">{t("providerReplyToggle")}</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("providerReplyHelp")}</p>
                  </div>
                  <Switch
                    checked={form.providerReplyEnabled}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, providerReplyEnabled: checked }))}
                  />
                </div>
                {form.providerReplyEnabled && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>{t("providerReplyEndpoint")}</Label>
                      <Input
                        data-testid="social-watchlist-provider-reply-endpoint"
                        value={form.providerReplyEndpoint}
                        onChange={(event) => setForm((current) => ({ ...current, providerReplyEndpoint: event.target.value }))}
                        placeholder={t("providerEndpointPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>{t("providerReplyToken")}</Label>
                      <Input
                        type="password"
                        value={form.providerReplyToken}
                        onChange={(event) => setForm((current) => ({ ...current, providerReplyToken: event.target.value }))}
                        placeholder={t("providerTokenPlaceholder")}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1 md:col-span-2">
              <Label>{t("keywords")}</Label>
              <Textarea
                data-testid="social-watchlist-keywords"
                value={form.keywords}
                onChange={(event) => setForm((current) => ({ ...current, keywords: event.target.value }))}
                rows={3}
                placeholder={t("keywordsPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("keywordsHelp")}</p>
            </div>
            <div data-testid="social-watchlist-query-preview" className="rounded-md border border-zinc-200 bg-muted/30 px-3 py-2 md:col-span-2 dark:border-zinc-700">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">{t("expandedPreviewTitle")}</p>
                <Badge variant="outline" className="text-[10px]">{expansionPreview.length}</Badge>
              </div>
              {expansionPreview.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">{t("expandedPreviewEmpty")}</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {expansionPreview.map((item) => (
                    <span key={`${item.reason}:${item.displayTerm}`} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-background px-2.5 py-1 text-[11px] dark:border-zinc-700">
                      <span className="font-medium">{item.displayTerm}</span>
                      <span className="text-muted-foreground">{t(`reasons.${item.reason}`)}</span>
                      <span className="tabular-nums text-muted-foreground">{t("priorityShort", { value: item.priority })}</span>
                      <span className="tabular-nums text-muted-foreground">{t("cadenceShort", { value: item.cadenceMinutes })}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 md:col-span-2 dark:border-amber-800/70 dark:bg-amber-950/25 dark:text-amber-200">
              {t("safetyNote")}
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={closeDialog}>{t("cancel")}</Button>
          <Button
            onClick={saveSource}
            disabled={saving || !form.target.trim()}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen} widthClassName="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("settingsTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-5">
            <div className="rounded-md border border-zinc-200 bg-muted/20 p-3 dark:border-zinc-700">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-sm font-medium">{t("settingsSearchIndexTitle")}</Label>
                  <p className="mt-1 text-xs text-muted-foreground">{t("settingsSearchIndexHelp")}</p>
                </div>
                <Switch
                  checked={settingsForm.searchIndexEnabled}
                  onCheckedChange={(checked) => setSettingsForm((current) => ({ ...current, searchIndexEnabled: checked }))}
                />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Select
                  label={t("settingsSearchProvider")}
                  value={settingsForm.searchIndexProvider}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, searchIndexProvider: event.target.value }))}
                >
                  <option value="generic">{t("settingsSearchProviderGeneric")}</option>
                  <option value="apify">{t("settingsSearchProviderApify")}</option>
                </Select>
                <div className="space-y-1">
                  <Label>{t("settingsLimit")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    aria-invalid={!searchIndexLimitValid}
                    value={settingsForm.searchIndexLimit}
                    onChange={(event) => setSettingsForm((current) => ({ ...current, searchIndexLimit: event.target.value }))}
                  />
                  {!searchIndexLimitValid && (
                    <p className="text-xs text-destructive">{t("settingsLimitInvalid")}</p>
                  )}
                </div>
                <div className="flex items-start justify-between gap-3 md:col-span-2">
                  <div>
                    <Label className="text-sm font-medium">{t("settingsIncludeComments")}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">{t("settingsIncludeCommentsHelp")}</p>
                  </div>
                  <Switch
                    checked={settingsForm.searchIndexIncludeComments}
                    onCheckedChange={(checked) => setSettingsForm((current) => ({ ...current, searchIndexIncludeComments: checked }))}
                  />
                </div>
                {settingsForm.searchIndexProvider === "generic" && (
                  <div className="space-y-1 md:col-span-2">
                    <Label>{t("settingsEndpoint")}</Label>
                    <Input
                      value={settingsForm.searchIndexEndpoint}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, searchIndexEndpoint: event.target.value }))}
                      placeholder="https://search-provider.example.com/search"
                    />
                  </div>
                )}
                {settingsForm.searchIndexProvider === "apify" && (
                  <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
                    <div className="space-y-1 md:col-span-2">
                      <Label>{t("settingsApifyWebSearchActor")}</Label>
                      <Input value={settingsForm.apifyWebSearchActor} onChange={(event) => setSettingsForm((current) => ({ ...current, apifyWebSearchActor: event.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("settingsApifyInstagramProfileActor")}</Label>
                      <Input value={settingsForm.apifyInstagramProfileActor} onChange={(event) => setSettingsForm((current) => ({ ...current, apifyInstagramProfileActor: event.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("settingsApifyInstagramHashtagActor")}</Label>
                      <Input value={settingsForm.apifyInstagramHashtagActor} onChange={(event) => setSettingsForm((current) => ({ ...current, apifyInstagramHashtagActor: event.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("settingsApifyFacebookSearchActor")}</Label>
                      <Input value={settingsForm.apifyFacebookSearchActor} onChange={(event) => setSettingsForm((current) => ({ ...current, apifyFacebookSearchActor: event.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("settingsApifyFacebookPostsActor")}</Label>
                      <Input value={settingsForm.apifyFacebookPostsActor} onChange={(event) => setSettingsForm((current) => ({ ...current, apifyFacebookPostsActor: event.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("settingsApifyTikTokSearchActor")}</Label>
                      <Input value={settingsForm.apifyTikTokSearchActor} onChange={(event) => setSettingsForm((current) => ({ ...current, apifyTikTokSearchActor: event.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("settingsApifyInstagramCommentsActor")}</Label>
                      <Input value={settingsForm.apifyInstagramCommentsActor} onChange={(event) => setSettingsForm((current) => ({ ...current, apifyInstagramCommentsActor: event.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("settingsApifyFacebookCommentsActor")}</Label>
                      <Input value={settingsForm.apifyFacebookCommentsActor} onChange={(event) => setSettingsForm((current) => ({ ...current, apifyFacebookCommentsActor: event.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("settingsApifyTikTokCommentsActor")}</Label>
                      <Input value={settingsForm.apifyTikTokCommentsActor} onChange={(event) => setSettingsForm((current) => ({ ...current, apifyTikTokCommentsActor: event.target.value }))} />
                    </div>
                    <p className="text-xs text-muted-foreground md:col-span-2">{t("settingsApifyHelp")}</p>
                  </div>
                )}
                <div className="space-y-1 md:col-span-2">
                  <Label>{t("settingsToken")}</Label>
                  <Input
                    type="password"
                    value={settingsForm.searchIndexToken}
                    onChange={(event) => setSettingsForm((current) => ({ ...current, searchIndexToken: event.target.value, clearSearchIndexToken: false }))}
                    placeholder={monitoringSettings?.searchIndex.hasToken ? t("settingsTokenStored") : t("settingsTokenPlaceholder")}
                  />
                </div>
                {settingsForm.searchIndexProvider === "generic" && (
                  <div className="space-y-1 md:col-span-2">
                    <Label>{t("settingsAllowedHosts")}</Label>
                    <Textarea
                      rows={3}
                      value={settingsForm.searchIndexAllowedHosts}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, searchIndexAllowedHosts: event.target.value }))}
                      placeholder="search-provider.example.com"
                    />
                  </div>
                )}
                {monitoringSettings?.searchIndex.hasToken && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground md:col-span-2">
                    <input
                      type="checkbox"
                      checked={settingsForm.clearSearchIndexToken}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, clearSearchIndexToken: event.target.checked, searchIndexToken: "" }))}
                    />
                    {t("settingsClearToken")}
                  </label>
                )}
              </div>
            </div>

            {scheduleStatus && (
              <div className="rounded-md border p-3" data-testid="social-schedule-status">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <Label className="text-sm font-medium">{t("scheduleStatusTitle")}</Label>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("scheduleStatusHelp")}</p>
                  </div>
                  <Badge
                    variant={scheduleStatusTone}
                    className="w-fit text-[10px]"
                    data-testid="social-schedule-status-badge"
                  >
                    {scheduleStatusLabel}
                  </Badge>
                </div>
                {/* Пульс важнее галочки: она показывает намерение, а он —
                    доходит ли планировщик до приложения (#665). */}
                {!scheduleStatus.responding && (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200">
                    {scheduleStatus.lastTickMinutesAgo === null
                      ? t("scheduleNeverRan")
                      : t("scheduleNotResponding", { minutes: scheduleStatus.lastTickMinutesAgo })}
                  </div>
                )}
                {/* Тревоги молчат, когда сбор выключен осознанно: иначе
                    страница спорит сама с собой. */}
                {scheduleStatus.enabled && scheduleStatus.overdueSources > 0 && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                    {t("scheduleOverdueSources", {
                      count: scheduleStatus.overdueSources,
                      hours: Math.max(1, Math.floor((scheduleStatus.maxOverdueMinutes ?? 60) / 60)),
                    })}
                  </div>
                )}
                {scheduleStatus.enabled && scheduleStatus.neverCollectedSources > 0 && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                    {t("scheduleNeverCollectedSources", { count: scheduleStatus.neverCollectedSources })}
                  </div>
                )}
                {scheduleStatus.excludedSources > 0 && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                    {t("scheduleExcludedSources", { count: scheduleStatus.excludedSources })}
                  </div>
                )}
                {scheduleStatus.enabled && scheduleStatus.failingSources > 0 && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                    {t("scheduleFailingSources", { count: scheduleStatus.failingSources })}
                  </div>
                )}
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">{t("scheduleLastTick")}</dt>
                    <dd className="tabular-nums">
                      {scheduleStatus.lastTickAt
                        ? new Date(scheduleStatus.lastTickAt).toLocaleString(locale)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("scheduleNextDue")}</dt>
                    <dd className="tabular-nums">
                      {scheduleStatus.nextDueAt
                        ? new Date(scheduleStatus.nextDueAt).toLocaleString(locale)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("scheduleSources")}</dt>
                    <dd className="tabular-nums">
                      {scheduleStatus.scheduledSources}
                      {scheduleStatus.excludedSources > 0 && (
                        <span className="ml-1 text-muted-foreground">
                          {t("scheduleExcludedShort", { count: scheduleStatus.excludedSources })}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("scheduleCadence")}</dt>
                    <dd className="tabular-nums">
                      {t("scheduleCadenceValue", { hours: Math.max(1, Math.round(scheduleStatus.cadenceMinutes / 60)) })}
                    </dd>
                  </div>
                </dl>
                {canManagePaidPolicy && (
                  <div className="mt-3 flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2">
                    <div>
                      <Label htmlFor="social-schedule-enabled" className="text-xs font-medium">{t("scheduleEnabledLabel")}</Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("scheduleEnabledHelp")}</p>
                    </div>
                    <Switch
                      id="social-schedule-enabled"
                      checked={scheduleStatus.enabled}
                      disabled={scheduleSaving}
                      onCheckedChange={(checked) => void saveScheduleEnabled(checked)}
                    />
                  </div>
                )}
              </div>
            )}
            {canManagePaidPolicy && view === "external" && (
              <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900/50 dark:bg-amber-950/10" data-testid="social-paid-policy-settings">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <Label className="text-sm font-medium">{t("paidPolicySettingsTitle")}</Label>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("paidPolicySettingsHelp")}</p>
                  </div>
                  <Badge variant={paidRunReport?.policy.emergencyStopped ? "destructive" : paidRunReport?.policy.manualRunsEnabled ? "success" : "warning"} className="w-fit text-[10px]">
                    {paidRunReport?.policy.emergencyStopped
                      ? t("paidPolicyEmergencyActive")
                      : paidRunReport?.policy.manualRunsEnabled
                        ? t("paidPolicyEnabled")
                        : t("paidPolicyDisabled")}
                  </Badge>
                </div>
                {paidRunReport && !paidRunReport.globalEnforcementEnabled && (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200">
                    {t("paidPolicyGlobalGuardOff")}
                  </div>
                )}
                <div className="mt-3 flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2">
                  <div>
                    <Label className="text-xs font-medium">{t("paidPolicyManualToggle")}</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("paidPolicyManualHelp")}</p>
                  </div>
                  <Switch
                    checked={paidRunPolicyForm.manualRunsEnabled}
                    onCheckedChange={(checked) => setPaidRunPolicyForm((current) => ({ ...current, manualRunsEnabled: checked }))}
                    disabled={paidRunPolicySaving || paidRunReportLoading}
                  />
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label>{t("paidPolicyPerRun")}</Label>
                    <Input type="number" min={0} max={100} step="0.01" value={paidRunPolicyForm.maxPerRunUsd} onChange={(event) => setPaidRunPolicyForm((current) => ({ ...current, maxPerRunUsd: event.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("paidPolicyDaily")}</Label>
                    <Input type="number" min={0} max={10000} step="0.01" value={paidRunPolicyForm.dailyBudgetUsd} onChange={(event) => setPaidRunPolicyForm((current) => ({ ...current, dailyBudgetUsd: event.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("paidPolicyMonthly")}</Label>
                    <Input type="number" min={0} max={100000} step="0.01" value={paidRunPolicyForm.monthlyBudgetUsd} onChange={(event) => setPaidRunPolicyForm((current) => ({ ...current, monthlyBudgetUsd: event.target.value }))} />
                  </div>
                </div>
                <div className="mt-3 rounded-md border bg-background px-3 py-2">
                  <Label htmlFor="social-paid-run-quota" className="text-xs font-medium">{t("paidPolicyRunQuota")}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("paidPolicyRunQuotaHelp")}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <Input
                      id="social-paid-run-quota"
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      className="max-w-[8rem]"
                      value={paidRunPolicyForm.dailyRunQuota}
                      onChange={(event) => setPaidRunPolicyForm((current) => ({ ...current, dailyRunQuota: event.target.value }))}
                    />
                    {paidRunReport && paidRunReport.usage.runsRemainingToday !== null ? (
                      <span className="text-xs text-muted-foreground">
                        {t("paidPolicyRunQuotaUsage", {
                          used: paidRunReport.usage.runsToday,
                          quota: paidRunReport.policy.dailyRunQuota,
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
                {paidRunPolicyForm.emergencyStopped ? (
                  <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setPaidRunPolicyForm((current) => ({ ...current, emergencyStopped: false }))} disabled={paidRunPolicySaving}>
                    {t("paidPolicyPrepareResume")}
                  </Button>
                ) : (
                  <Button type="button" variant="destructive" size="sm" className="mt-3" onClick={activatePaidRunEmergencyStop} disabled={paidRunPolicySaving}>
                    {t("paidPolicyActivateEmergency")}
                  </Button>
                )}
                <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <input type="checkbox" className="mt-1" checked={paidRunPolicyConfirmed} onChange={(event) => setPaidRunPolicyConfirmed(event.target.checked)} />
                  <span>{t("paidPolicyConfirmation")}</span>
                </label>
                <div className="mt-3 flex justify-end">
                  <Button type="button" size="sm" onClick={savePaidRunPolicy} disabled={paidRunPolicySaving || paidRunReportLoading || !paidRunPolicyConfirmed}>
                    {paidRunPolicySaving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    {t("paidPolicySave")}
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-md border border-zinc-200 bg-muted/20 p-3 dark:border-zinc-700">
              <Label className="text-sm font-medium">{t("settingsProviderTitle")}</Label>
              <p className="mt-1 text-xs text-muted-foreground">{t("settingsProviderHelp")}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>{t("settingsProviderAllowedHosts")}</Label>
                  <Textarea
                    rows={3}
                    value={settingsForm.providerAllowedHosts}
                    onChange={(event) => setSettingsForm((current) => ({ ...current, providerAllowedHosts: event.target.value }))}
                    placeholder="listener.example.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t("settingsProviderReplyAllowedHosts")}</Label>
                  <Textarea
                    rows={3}
                    value={settingsForm.providerReplyAllowedHosts}
                    onChange={(event) => setSettingsForm((current) => ({ ...current, providerReplyAllowedHosts: event.target.value }))}
                    placeholder="reply.example.com"
                  />
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSettingsOpen(false)}>{t("cancel")}</Button>
          <Button onClick={saveMonitoringSettings} disabled={settingsSaving}>
            {settingsSaving ? t("saving") : t("settingsSave")}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  )
}

function Metric({ label, value, tone = "zinc" }: { label: string; value: number; tone?: "zinc" | "amber" | "red" | "green" }) {
  const toneClass = tone === "amber"
    ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/25 dark:text-amber-200"
    : tone === "red"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-800/70 dark:bg-red-950/25 dark:text-red-200"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/25 dark:text-emerald-200"
        : "border-zinc-200 bg-muted/30 text-foreground dark:border-zinc-700"
  return (
    <div className={cn("rounded-md border px-3 py-2", toneClass)}>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
