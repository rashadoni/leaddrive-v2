import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

// Счётчики карточек считают то же, что покажет лента по умолчанию. Пока они
// были языконезависимы, переход по счётчику приходилось открывать без языкового
// фильтра — иначе клик по «158» приводил в ленту с другим числом строк.
//
// Должно совпадать с DEFAULT_LANGUAGE_FILTERS в social-monitoring/page.tsx —
// расхождение снова разведёт карточку и ленту; на это есть отдельный тест.
//
// Комментарии из-под этого фильтра выведены и здесь, и в ленте: их релевантность
// держится на родительском посте, а не на своём тексте, и метки у них часто нет.
const CARD_LANGUAGES = ["az", "ru"] as const
import {
  claimMonitoringSubjectIdentity,
  normalizeSubjectTerm,
  updateMonitoringSubject,
  type MonitoringSubjectAliasInput,
  type MonitoringSubjectAliasKind,
  type MonitoringSubjectType,
} from "@/lib/social/monitoring-subjects"
import {
  createMonitoringScenario,
  deleteMonitoringScenario,
  getMonitoringScenarios,
  MONITORING_SCENARIO_DIRECTIONS,
  updateMonitoringScenario,
  type MonitoringScenario,
  type MonitoringScenarioDirection,
  type MonitoringScenarioPlatform,
} from "@/lib/social/monitoring-scenarios"
import {
  monitoringProfileSharedSourceCanTargetScenario,
  monitoringProfileSourceBelongsToScenario,
  monitoringProfileSourceRunPolicy,
} from "@/lib/social/monitoring-profile-run-plan"
import { isMonitoringIdentityRelation } from "@/lib/social/monitoring-source-identity"
import { AUTOMATIC_REVIEW_DISCOVERY_REASONS } from "@/lib/social/automatic-review-triage"
import {
  AUTOMATIC_REVIEW_COMMENT_CONTENT_KINDS,
  AUTOMATIC_REVIEW_DISCOVERY_CONTENT_KINDS,
  INTERNAL_REVIEW_CONTEXT_REASON,
  TERMINAL_REVIEW_QUARANTINE_REASONS,
} from "@/lib/social/review-queue-policy"

/**
 * The Monitoring Profile is the ONLY monitoring entity an SMM/PR manager sees.
 * It is a facade over two storage shapes in the same database:
 *
 *   MonitoringSubject   — Prisma model (identity, vocabulary, archive anchor)
 *   MonitoringScenario  — JSON inside ChannelConfig.settings.scenarios
 *
 * Scenario writes serialize and commit their ChannelConfig + managed-source
 * rows atomically. Nothing here introduces a third store. See
 * docs/social-monitoring-unified-profile-spec.md.
 */

export const MONITORING_PROFILE_STATUSES = [
  "active",
  "paused",
  "needs_resume",
  "archived",
] as const

export type MonitoringProfileStatus = typeof MONITORING_PROFILE_STATUSES[number]

export type MonitoringProfileAlias = {
  kind: MonitoringSubjectAliasKind
  value: string
  normalizedValue: string
  isNegative: boolean
}

export type MonitoringProfileSource = {
  id: string
  platform: string
  sourceType: string
  label: string
  status: string
  isActive: boolean
  ownership: string
  relationType: string
  paid: boolean
  providerAccountFundedOnly: boolean
  commentsOnlyEligible: boolean
  maxTotalChargeUsd: number | null
  sharedAcrossMonitorings: boolean
}

export const MONITORING_PROFILE_COVERAGE_SCOPES = [
  "selected_sources",
  "broad_search",
  "mixed",
  "not_configured",
] as const

export const MONITORING_PROFILE_COLLECTION_STATES = [
  "configured",
  "limited",
  "needs_setup",
  "paused",
  "not_configured",
] as const

export const MONITORING_PROFILE_COMMENT_STATES = [
  "off",
  "configured",
  "limited",
  "needs_setup",
] as const

export const MONITORING_PROFILE_COMPLETENESS_STATES = [
  "confirmed_for_input",
  "partial",
  "pending",
  "blocked",
  "unknown",
] as const

export type MonitoringProfilePlatformCoverage = {
  platform: MonitoringScenarioPlatform
  scope: typeof MONITORING_PROFILE_COVERAGE_SCOPES[number]
  collectionState: typeof MONITORING_PROFILE_COLLECTION_STATES[number]
  commentState: typeof MONITORING_PROFILE_COMMENT_STATES[number]
  completeness: typeof MONITORING_PROFILE_COMPLETENESS_STATES[number]
  sourceCount: number
  activeSourceCount: number
  latestFoundCount: number
  latestAcceptedCount: number
  latestRejectedCount: number
  latestDuplicateCount: number
  latestRunStatuses: string[]
  latestCheckedAt: string | null
  lastSuccessfulAt: string | null
  lastError: string | null
  // This is deliberately structural. Even a COMPLETE_FOR_INPUT provider run
  // proves only the requested source/window, never an entire social network.
  fullPlatformCoverage: false
}

export type MonitoringProfileFindingSummary = {
  total: number
  new: number
  last24Hours: number
  last7Days: number
  posts: number
  comments: number
  media: number
  // Не-размеченные упоминания (sentiment IS NULL) считаются нейтральными,
  // как и в /api/v1/social/analytics — поэтому positive+neutral+negative = total.
  positive: number
  neutral: number
  negative: number
  needsReview: number
  // Находки, которых менеджер ещё не касался И которые несут риск: негатив либо
  // заведённый юридический кандидат. Это НЕ `new`: `new` совпадает с `total`
  // почти всегда и потому ничего не сообщает — см. карточку клиента.
  needsAction: number
}

export type MonitoringProfileView = {
  id: string
  // Null only for a legacy scenario that was never linked to a subject. Such a
  // profile still lists, so upgrading cannot make an operator's monitor vanish.
  subjectId: string | null
  scenarioId: string | null
  name: string
  logoUrl: string | null
  type: string
  status: MonitoringProfileStatus
  // Клиент CRM, если объект мониторинга к нему привязан. null — как у
  // легаси-профиля без субъекта, так и у непривязанного объекта.
  company: { id: string; name: string } | null
  aliases: MonitoringProfileAlias[]
  platforms: MonitoringScenarioPlatform[]
  directions: MonitoringScenarioDirection[]
  sources: MonitoringProfileSource[]
  coverage: MonitoringProfilePlatformCoverage[]
  commentsEnabled: boolean
  archive: MonitoringScenario["archive"] | null
  findings: MonitoringProfileFindingSummary
  findingsByPlatform: Record<string, number>
  lastCollectedAt: string | null
  lastUpdatedAt: string
  liveSendAllowed: false
}

type SubjectAliasRow = {
  kind: string
  value: string
  normalizedValue: string
  isNegative: boolean
}

export type ProfileSubjectRow = {
  id: string
  name: string
  type: string
  status: string
  updatedAt: Date
  // Клиент CRM, если объект мониторинга к нему привязан.
  company?: { id: string; name: string } | null
  aliases: SubjectAliasRow[]
  visualReferences?: Array<{
    imageUrl: string
    updatedAt?: Date
  }>
  sources?: Array<{
    scenarioId?: string | null
    relationType?: string
    source: {
      id: string
      platform: string
      sourceType: string
      handle: string | null
      query: string | null
      url: string | null
      status: string
      ownership?: string
      collectionMode?: string
      settings?: unknown
      lastSuccessfulAt?: Date | null
      routePlans?: Array<{
        capability: string
        status: string
        scenarioId?: string | null
        primaryAdapter?: string
        fallbackAdapters?: string[]
        dependsOnCapability?: string | null
        budget?: unknown
      }>
      _count?: { subjectSources?: number }
      collectorRuns?: Array<{
        status: string
        startedAt: Date
        foundCount: number
        newCount?: number
        duplicateCount?: number
        ignoredCount?: number
        error?: string | null
        rawStats: unknown
      }>
    } | null
  }>
}

type ProfileCoverageSourceRow = NonNullable<NonNullable<ProfileSubjectRow["sources"]>[number]["source"]>
type ProfileCoverageSource = Omit<ProfileCoverageSourceRow, "lastSuccessfulAt" | "lastError"> & {
  lastSuccessfulAt?: Date | null
  lastError?: string | null
}

const DIRECT_SOURCE_TYPES = new Set(["profile", "page", "competitor", "influencer", "notification_inbox", "manual"])
const BROAD_SEARCH_SOURCE_TYPES = new Set(["keyword", "hashtag", "search_url", "campaign"])
const COMMENT_CAPABILITIES = new Set(["READ_OWNED_COMMENTS", "READ_EXTERNAL_COMMENTS", "READ_THREAD"])
const CONFIRMED_COVERAGE_CLASSES = new Set([
  "COMPLETE_FOR_INPUT",
  "COMPLETE_FOR_QUERY_WINDOW",
  "COMPLETE_FOR_DELIVERED_UPDATES",
])

function emptyFindingSummary(): MonitoringProfileFindingSummary {
  return { total: 0, new: 0, last24Hours: 0, last7Days: 0, posts: 0, comments: 0, media: 0, positive: 0, neutral: 0, negative: 0, needsReview: 0, needsAction: 0 }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function coverageClassState(value: unknown): MonitoringProfilePlatformCoverage["completeness"] | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toUpperCase()
  if (CONFIRMED_COVERAGE_CLASSES.has(normalized)) return "confirmed_for_input"
  if (normalized === "PARTIAL" || normalized === "SAMPLED") return "partial"
  if (normalized === "PENDING") return "pending"
  if (normalized === "BLOCKED") return "blocked"
  return null
}

function mostConservativeCompleteness(
  states: MonitoringProfilePlatformCoverage["completeness"][],
): MonitoringProfilePlatformCoverage["completeness"] {
  if (states.includes("blocked")) return "blocked"
  if (states.includes("partial")) return "partial"
  if (states.includes("pending")) return "pending"
  if (states.length > 0 && states.every(state => state === "confirmed_for_input")) return "confirmed_for_input"
  return "unknown"
}

function runCompleteness(source: ProfileCoverageSource): MonitoringProfilePlatformCoverage["completeness"] {
  const run = source.collectorRuns?.[0]
  if (!run) return "unknown"
  const stats = recordFromUnknown(run.rawStats)
  const routeResults = Array.isArray(stats.routeResults) ? stats.routeResults : []
  const explicitStates = [
    coverageClassState(stats.coverageClass),
    ...routeResults.map(result => coverageClassState(recordFromUnknown(result).coverageClass)),
  ].filter((state): state is MonitoringProfilePlatformCoverage["completeness"] => Boolean(state))
  if (explicitStates.length > 0) return mostConservativeCompleteness(explicitStates)
  if (run.status === "failed") return "blocked"
  if (run.status === "partial") return "partial"
  return "unknown"
}

function sourceHasRunnableApifyDiscoveryRoute(source: ProfileCoverageSource): boolean {
  return source.routePlans?.some(plan => (
    plan.capability === "DISCOVER_POSTS"
    && plan.primaryAdapter === "APIFY_ASYNC"
    && (plan.status === "ACTIVE" || plan.status === "DEGRADED")
  )) ?? false
}

function sourceIsRunnableForCoverage(source: ProfileCoverageSource): boolean {
  return source.status === "active"
    || source.status === "limited"
    || (source.status === "needs_setup" && sourceHasRunnableApifyDiscoveryRoute(source))
}

function collectionStateForSources(
  sources: ProfileCoverageSource[],
): MonitoringProfilePlatformCoverage["collectionState"] {
  if (sources.length === 0) return "not_configured"
  const sourceStatuses = sources.map(source => source.status)
  const routeStatuses = sources.flatMap(source => source.routePlans?.map(plan => plan.status) ?? [])
  const hasRunnableSource = sources.some(sourceIsRunnableForCoverage)
  const hasReadyRoute = routeStatuses.length === 0 || routeStatuses.some(status => status === "ACTIVE" || status === "DEGRADED")
  if (sourceStatuses.every(status => status === "paused" || status === "disabled")) return "paused"
  if (!hasRunnableSource || !hasReadyRoute) return "needs_setup"
  if (
    sourceStatuses.some(status => status === "limited" || status === "needs_setup" || status === "blocked")
    || routeStatuses.some(status => status === "DEGRADED" || status === "BLOCKED" || status === "INVALIDATED")
  ) return "limited"
  return "configured"
}

function commentStateForSources(
  sources: ProfileCoverageSource[],
  commentsEnabled: boolean,
): MonitoringProfilePlatformCoverage["commentState"] {
  if (!commentsEnabled) return "off"
  const plans = sources.flatMap(source => source.routePlans ?? []).filter(plan => COMMENT_CAPABILITIES.has(plan.capability))
  if (plans.length === 0) return "needs_setup"
  if (plans.every(plan => plan.status === "ACTIVE")) return "configured"
  if (plans.some(plan => plan.status === "ACTIVE" || plan.status === "DEGRADED")) return "limited"
  return "needs_setup"
}

export function buildMonitoringProfileCoverage(
  platforms: MonitoringScenarioPlatform[],
  linkedSources: ProfileCoverageSource[],
  commentsEnabled: boolean,
): MonitoringProfilePlatformCoverage[] {
  const orderedPlatforms = Array.from(new Set([
    ...platforms,
    ...linkedSources.map(source => source.platform as MonitoringScenarioPlatform),
  ]))

  return orderedPlatforms.map(platform => {
    // Disabled rows are historical scenario artifacts. Including them would
    // make a selected-profile monitor look like a mixed keyword search.
    const sources = linkedSources.filter(source => source.platform === platform && source.status !== "disabled")
    const directCount = sources.filter(source => DIRECT_SOURCE_TYPES.has(source.sourceType)).length
    const broadCount = sources.filter(source => BROAD_SEARCH_SOURCE_TYPES.has(source.sourceType)).length
    const scope: MonitoringProfilePlatformCoverage["scope"] = directCount > 0 && broadCount > 0
      ? "mixed"
      : broadCount > 0
        ? "broad_search"
        : directCount > 0
          ? "selected_sources"
          : "not_configured"
    const runs = sources.map(source => source.collectorRuns?.[0]).filter(Boolean)
    const latestCheckedAt = runs.length > 0
      ? new Date(Math.max(...runs.map(run => new Date(run!.startedAt).getTime()))).toISOString()
      : null
    const successfulDates = sources.map(source => source.lastSuccessfulAt).filter((value): value is Date => Boolean(value))
    const lastSuccessfulAt = successfulDates.length > 0
      ? new Date(Math.max(...successfulDates.map(value => new Date(value).getTime()))).toISOString()
      : null
    const lastError = Array.from(new Set(sources.map(source => source.lastError).filter((value): value is string => Boolean(value)))).join(", ") || null

    return {
      platform,
      scope,
      collectionState: collectionStateForSources(sources),
      commentState: commentStateForSources(sources, commentsEnabled),
      completeness: mostConservativeCompleteness(sources.map(runCompleteness)),
      sourceCount: sources.length,
      activeSourceCount: sources.filter(sourceIsRunnableForCoverage).length,
      latestFoundCount: runs.reduce((sum, run) => sum + (run?.foundCount ?? 0), 0),
      latestAcceptedCount: runs.reduce((sum, run) => sum + (run?.newCount ?? 0) + (run?.duplicateCount ?? 0), 0),
      latestRejectedCount: runs.reduce((sum, run) => sum + (run?.ignoredCount ?? 0), 0),
      latestDuplicateCount: runs.reduce((sum, run) => sum + (run?.duplicateCount ?? 0), 0),
      latestRunStatuses: Array.from(new Set(runs.map(run => run?.status).filter((status): status is string => Boolean(status)))),
      latestCheckedAt,
      lastSuccessfulAt,
      lastError,
      fullPlatformCoverage: false,
    }
  })
}

/**
 * Alias kinds that are QUERY terms vs match-only filters.
 *
 * NEGATIVE and CONTEXT never reach the collection query: a negative alias exists
 * to reject a match and required context exists to qualify one, so searching for
 * either would fetch the very thing we mean to exclude.
 *
 * DOMAIN is match-only too. Watching a specific page is an independent Sources
 * concern; scenario collection stays a global keyword/hashtag query.
 */
const QUERY_ALIAS_KINDS: Record<string, keyof MonitoringScenario["search"] | null> = {
  NAME: "keywords",
  TRANSLITERATION: "keywords",
  INFLECTION: "keywords",
  TYPO: "keywords",
  HASHTAG: "hashtags",
  // A real handle remains useful global-search vocabulary, but it must never
  // turn into a scenario-managed profile source.
  HANDLE: "keywords",
  DOMAIN: null,
  CONTEXT: null,
  NEGATIVE: null,
}

export const profileSubjectInclude = {
  aliases: true,
  company: { select: { id: true, name: true } },
  visualReferences: {
    where: {
      referenceType: "LOGO",
      status: "active",
    },
    orderBy: { updatedAt: "desc" },
    take: 1,
    select: {
      imageUrl: true,
      updatedAt: true,
    },
  },
  sources: {
    include: {
      source: {
        include: {
          routePlans: {
            where: { status: { not: "INVALIDATED" } },
            select: {
              capability: true,
              status: true,
              scenarioId: true,
              primaryAdapter: true,
              fallbackAdapters: true,
              dependsOnCapability: true,
              budget: true,
            },
          },
          _count: { select: { subjectSources: true } },
          collectorRuns: {
            orderBy: { startedAt: "desc" },
            take: 1,
            select: {
              status: true,
              startedAt: true,
              foundCount: true,
              newCount: true,
              duplicateCount: true,
              ignoredCount: true,
              error: true,
              rawStats: true,
            },
          },
        },
      },
    },
  },
} as const

/**
 * Profile status is DERIVED, never stored — a subject whose scenario was
 * deleted still looks "active" in the subject table, and that is exactly the
 * confusion this unified layer exists to remove. A subject with no active
 * collection plan is `needs_resume`: inert, archived in the UI, and unable to
 * start an external search by itself.
 */
export function deriveProfileStatus(
  subjectStatus: string,
  scenario: MonitoringScenario | null,
): MonitoringProfileStatus {
  if (subjectStatus === "archived") return "archived"
  if (!scenario || scenario.status === "draft") return "needs_resume"
  if (subjectStatus === "paused" || scenario.status === "paused") return "paused"
  return "active"
}

function sourceLabel(source: {
  handle: string | null
  query: string | null
  url: string | null
  settings?: unknown
}): string {
  const settings = recordFromUnknown(source.settings)
  if (settings.managedBy === "google_alerts_rss") {
    const scenarioName = typeof settings.scenarioName === "string"
      ? settings.scenarioName.trim()
      : ""
    return scenarioName ? `Google Alerts RSS · ${scenarioName}` : "Google Alerts RSS"
  }
  return source.handle ?? source.query ?? source.url ?? ""
}

export function buildMonitoringProfileView(
  subject: ProfileSubjectRow,
  scenario: MonitoringScenario | null,
): MonitoringProfileView {
  const scenarioUpdatedAt = scenario ? new Date(scenario.updatedAt) : null
  const lastUpdatedAt = scenarioUpdatedAt && scenarioUpdatedAt > subject.updatedAt
    ? scenarioUpdatedAt
    : subject.updatedAt
  const linkedSourceRows = (subject.sources ?? []).filter(link =>
    Boolean(link.source)
    && !isMonitoringIdentityRelation(link.relationType)
    && (!scenario || (
      monitoringProfileSourceBelongsToScenario(
        {
          scenarioId: link.scenarioId,
          relationType: link.relationType,
          source: link.source!,
        },
        scenario,
      )
      || monitoringProfileSharedSourceCanTargetScenario(
        {
          scenarioId: link.scenarioId,
          relationType: link.relationType,
          source: link.source!,
        },
        scenario,
      )
    )),
  )
  const linkedSources = linkedSourceRows.flatMap(link => link.source ? [link.source] : [])
  const commentsEnabled = scenario?.search.includeExternalComments === true
  const coverage = buildMonitoringProfileCoverage(
    scenario?.platforms ?? [],
    linkedSources,
    commentsEnabled,
  )
  const lastCollectedAt = coverage
    .map(item => item.latestCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0] ?? null
  return {
    id: subject.id,
    subjectId: subject.id,
    scenarioId: scenario?.id ?? null,
    name: subject.name,
    logoUrl: subject.visualReferences?.[0]?.imageUrl ?? null,
    type: subject.type,
    status: deriveProfileStatus(subject.status, scenario),
    company: subject.company ? { id: subject.company.id, name: subject.company.name } : null,
    aliases: subject.aliases.map(alias => ({
      kind: alias.kind as MonitoringSubjectAliasKind,
      value: alias.value,
      normalizedValue: alias.normalizedValue,
      isNegative: alias.isNegative,
    })),
    platforms: scenario?.platforms ?? [],
    directions: scenario?.ai.directions ?? [],
    sources: linkedSourceRows.map(link => {
      const runPolicy = scenario
        ? monitoringProfileSourceRunPolicy(
            { scenarioId: link.scenarioId, source: link.source! },
            scenario.id,
          )
        : {
            paid: false,
            providerAccountFundedOnly: false,
            maxTotalChargeUsd: null,
            sharedAcrossMonitorings: false,
          }
      const commentsOnlyEligible = Boolean(
        scenario
        && commentsEnabled
        && runPolicy.paid
        && !runPolicy.providerAccountFundedOnly
        && link.source!.routePlans?.some(plan => (
          plan.scenarioId === scenario.id
          && ["ACTIVE", "DEGRADED"].includes(plan.status)
          && plan.capability === "READ_EXTERNAL_COMMENTS"
          && plan.primaryAdapter === "APIFY_ASYNC"
          && ["DISCOVER_POSTS", "ENRICH_CONTENT"].includes(
            plan.dependsOnCapability ?? "",
          )
        )),
      )
      return {
        id: link.source!.id,
        platform: link.source!.platform,
        sourceType: link.source!.sourceType,
        label: sourceLabel(link.source!),
        status: link.source!.status,
        isActive: !["paused", "disabled", "blocked"].includes(link.source!.status),
        ownership: link.source!.ownership ?? "unknown",
        relationType: link.relationType ?? "MONITORS",
        commentsOnlyEligible,
        ...runPolicy,
      }
    }),
    coverage,
    commentsEnabled,
    archive: scenario?.archive ?? null,
    findings: emptyFindingSummary(),
    findingsByPlatform: {},
    lastCollectedAt,
    lastUpdatedAt: lastUpdatedAt.toISOString(),
    // Structural, not a default: the profile layer has no code path that can set this.
    liveSendAllowed: false,
  }
}

/**
 * Single source of search terms (spec §5). The subject owns the vocabulary and
 * the collection query is derived from it — the operator types the brand name
 * once, in step 1, and never restates it as a scenario keyword.
 *
 * `extraKeywords` carries optional per-direction words from advanced settings.
 * Pages/profiles remain in the independent Sources registry and are never
 * copied into the scenario search payload.
 */
export function deriveScenarioSearchFromSubject(
  subject: { name: string; aliases: SubjectAliasRow[] },
  extraKeywords: string[] = [],
): Pick<MonitoringScenario["search"], "topics" | "keywords" | "hashtags" | "handles" | "urls"> {
  const buckets = { topics: [] as string[], keywords: [] as string[], hashtags: [] as string[], handles: [] as string[], urls: [] as string[] }
  const seen = new Set<string>()

  function push(bucket: keyof typeof buckets, value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    const key = `${bucket}:${normalizeSubjectTerm(trimmed)}`
    if (seen.has(key)) return
    seen.add(key)
    buckets[bucket].push(trimmed)
  }

  push("keywords", subject.name)
  for (const alias of subject.aliases) {
    if (alias.isNegative) continue
    const bucket = QUERY_ALIAS_KINDS[alias.kind]
    if (!bucket || bucket === "topics") continue
    push(bucket as keyof typeof buckets, alias.value)
  }
  for (const keyword of extraKeywords) push("keywords", keyword)

  return buckets
}

/**
 * Local-only spelling/handle/hashtag proposals. Deterministic string work over
 * the typed name plus rows this org already stores — no AI, no provider, no
 * network. Paid variant generation is explicitly out of scope (spec §12).
 */
export function suggestProfileAliases(name: string): MonitoringSubjectAliasInput[] {
  const trimmed = name.trim()
  if (!trimmed) return []
  const normalized = normalizeSubjectTerm(trimmed)
  const compact = normalized.replace(/[\s._-]+/g, "")
  const suggestions: MonitoringSubjectAliasInput[] = []
  const seen = new Set<string>()

  function push(kind: MonitoringSubjectAliasKind, value: string) {
    const candidate = value.trim()
    if (!candidate) return
    const key = `${kind}:${normalizeSubjectTerm(candidate)}`
    if (seen.has(key)) return
    seen.add(key)
    suggestions.push({ kind, value: candidate })
  }

  // Latin/Cyrillic-adjacent Azerbaijani letters are routinely typed as their
  // ASCII lookalikes on phones, so both spellings really do occur in the wild.
  const asciiFolded = normalized
    .replace(/ə/g, "e").replace(/ğ/g, "g").replace(/ş/g, "s")
    .replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ı/g, "i")

  if (asciiFolded !== normalized) push("TRANSLITERATION", asciiFolded)
  if (compact.length > 1) push("HASHTAG", compact)
  if (asciiFolded.replace(/[\s._-]+/g, "") !== compact) push("HASHTAG", asciiFolded.replace(/[\s._-]+/g, ""))

  // Deliberately no guessed HANDLE. A handle inferred from the name may not
  // exist; real handles come from independently verified sources.
  return suggestions
}

/**
 * Existing-profile lookup for step 1. Matches the typed name against subject
 * names AND aliases so "araz" finds the Araz Supermarket profile instead of
 * letting the operator create a duplicate. Archived subjects are included on
 * purpose — resuming one is the whole point.
 */
export async function findProfileCandidates(
  organizationId: string,
  name: string,
): Promise<ProfileSubjectRow[]> {
  const normalized = normalizeSubjectTerm(name)
  if (!normalized) return []
  const delegate = (prisma as unknown as { monitoringSubject?: typeof prisma.monitoringSubject }).monitoringSubject
  if (!delegate?.findMany) return []
  return delegate.findMany({
    where: {
      organizationId,
      OR: [
        { name: { contains: name.trim(), mode: "insensitive" } },
        { aliases: { some: { organizationId, normalizedValue: { contains: normalized } } } },
      ],
    },
    include: profileSubjectInclude,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: 10,
  }) as unknown as Promise<ProfileSubjectRow[]>
}

export function isMonitoringProfileDirection(value: string): value is MonitoringScenarioDirection {
  return (MONITORING_SCENARIO_DIRECTIONS as readonly string[]).includes(value)
}

/**
 * A legacy scenario that was never linked to a subject still deserves a card —
 * dropping it would make an operator's monitor disappear at upgrade.
 */
export function buildLegacyScenarioProfileView(scenario: MonitoringScenario): MonitoringProfileView {
  return {
    id: `scenario:${scenario.id}`,
    subjectId: null,
    scenarioId: scenario.id,
    name: scenario.subjectName ?? scenario.name,
    logoUrl: null,
    type: "TOPIC",
    // У легаси-сценария нет субъекта, поэтому привязывать связь не к чему.
    status: deriveProfileStatus("active", scenario),
    company: null,
    aliases: [],
    platforms: scenario.platforms,
    directions: scenario.ai.directions,
    sources: [],
    coverage: buildMonitoringProfileCoverage(scenario.platforms, [], scenario.search.includeExternalComments === true),
    commentsEnabled: scenario.search.includeExternalComments === true,
    archive: scenario.archive,
    findings: emptyFindingSummary(),
    findingsByPlatform: {},
    lastCollectedAt: null,
    lastUpdatedAt: scenario.updatedAt,
    liveSendAllowed: false,
  }
}

/**
 * One scenario per subject is the shape the unified layer creates, but older
 * data may hold several. Pick a stable canonical one — active first, then most
 * recently updated — rather than silently pausing the rest, which would stop
 * collection the operator still expects.
 */
export function pickCanonicalScenario(scenarios: MonitoringScenario[]): MonitoringScenario | null {
  if (scenarios.length === 0) return null
  return [...scenarios].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === "active") return -1
      if (b.status === "active") return 1
    }
    return b.updatedAt.localeCompare(a.updatedAt)
  })[0]
}

type FindingSummaryRow = {
  subjectId: string
  total: number
  newCount: number
  last24Hours: number
  last7Days: number
  posts: number
  comments: number
  media: number
  positive: number
  neutral: number
  negative: number
  needsReview: number
  needsAction: number
}

type ReviewFindingSummaryRow = {
  subjectId: string
  needsReview: number
}

type PlatformFindingSummaryRow = {
  subjectId: string
  platform: string
  total: number
}

type FindingSummaries = {
  findings: Map<string, MonitoringProfileFindingSummary>
  findingsByPlatform: Map<string, Record<string, number>>
}

export async function loadFindingSummaries(organizationId: string, subjectIds: string[]): Promise<FindingSummaries> {
  if (subjectIds.length === 0) {
    return { findings: new Map(), findingsByPlatform: new Map() }
  }
  const [mentionRows, reviewRows, platformRows] = await Promise.all([
    prisma.$queryRaw<FindingSummaryRow[]>`
      SELECT
        msm."subjectId",
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match')::int AS total,
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match' AND sm.status = 'new')::int AS "newCount",
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match' AND sm."publishedAt" >= NOW() - INTERVAL '24 hours')::int AS "last24Hours",
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match' AND sm."publishedAt" >= NOW() - INTERVAL '7 days')::int AS "last7Days",
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match'
          AND NOT (
            UPPER(sm."contentKind"::text) IN ('COMMENT', 'REPLY')
            OR LOWER(BTRIM(COALESCE(sm."sourceType", ''))) IN ('comment', 'reply')
          )
          AND (
            UPPER(sm."contentKind"::text) IN ('POST', 'MENTION')
            OR LOWER(BTRIM(COALESCE(sm."sourceType", ''))) IN ('post', 'mention')
          ))::int AS posts,
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match' AND (
          UPPER(sm."contentKind"::text) IN ('COMMENT', 'REPLY')
          OR LOWER(BTRIM(COALESCE(sm."sourceType", ''))) IN ('comment', 'reply')
        ))::int AS comments,
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match' AND EXISTS (
          SELECT 1 FROM media_observations mo
          WHERE mo."organizationId" = msm."organizationId" AND mo."mentionId" = msm."mentionId" AND mo."purgedAt" IS NULL
        ))::int AS media,
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match' AND LOWER(BTRIM(COALESCE(sm.sentiment, ''))) = 'positive')::int AS positive,
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match' AND (LOWER(BTRIM(COALESCE(sm.sentiment, ''))) = 'neutral' OR sm.sentiment IS NULL))::int AS neutral,
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match' AND LOWER(BTRIM(COALESCE(sm.sentiment, ''))) = 'negative')::int AS negative,
        -- «Требуют реакции»: не тронутые менеджером находки, несущие риск —
        -- негатив либо не отклонённый юридический кандидат. Статусы здесь
        -- только читаются: авто-разбор ничего не закрывает.
        COUNT(*) FILTER (WHERE msm.status = 'MATCHED' AND msm.reason <> 'parent_post_match'
          AND sm.status = 'new'
          AND (
            LOWER(BTRIM(COALESCE(sm.sentiment, ''))) = 'negative'
            OR EXISTS (
              SELECT 1 FROM social_legal_candidates lc
              WHERE lc."organizationId" = sm."organizationId"
                AND lc."mentionId" = sm.id
                AND lc.status <> 'DISMISSED'
            )
          ))::int AS "needsAction",
        0::int AS "needsReview"
      FROM social_mention_subject_matches msm
      JOIN social_mentions sm ON sm."organizationId" = msm."organizationId" AND sm.id = msm."mentionId"
      WHERE msm."organizationId" = ${organizationId}
        AND msm."subjectId" = ANY(${subjectIds}::text[])
        AND sm."purgedAt" IS NULL
        AND sm."deletedAtSource" IS NULL
        AND (
          sm."sourceMetadata" -> 'socialTriage' ->> 'language' = ANY(${[...CARD_LANGUAGES]}::text[])
          -- Комментарии языковой фильтр ленты не отсекает (mentions/route.ts),
          -- поэтому и счётчик не должен: иначе карточка и лента разойдутся
          -- в числах, как до #651.
          OR UPPER(sm."contentKind"::text) IN ('COMMENT', 'REPLY')
          OR LOWER(BTRIM(COALESCE(sm."sourceType", ''))) IN ('comment', 'reply')
        )
        AND (
          NOT (
            UPPER(sm."contentKind"::text) IN ('COMMENT', 'REPLY')
            OR LOWER(BTRIM(COALESCE(sm."sourceType", ''))) IN ('comment', 'reply')
          )
          OR LOWER(BTRIM(COALESCE(sm.sentiment, ''))) IN ('negative', 'neutral')
        )
      GROUP BY msm."subjectId"
    `,
    prisma.$queryRaw<ReviewFindingSummaryRow[]>`
      SELECT
        decision_match.value->>'subjectId' AS "subjectId",
        COUNT(DISTINCT envelope.id)::int AS "needsReview"
      FROM ingest_envelopes envelope
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(envelope."subjectDecision"->'matches') = 'array'
            THEN envelope."subjectDecision"->'matches'
          ELSE '[]'::jsonb
        END
      ) AS decision_match(value)
      WHERE envelope."organizationId" = ${organizationId}
        AND envelope."relevanceStatus" = 'REVIEW'
        AND envelope."acceptedMentionId" IS NULL
        AND envelope."purgedAt" IS NULL
        AND envelope."deletedAtSource" IS NULL
        AND envelope."purgeAt" > NOW()
        AND NOT (
          COALESCE(envelope."contentKind"::text, '') = ANY(${[...AUTOMATIC_REVIEW_COMMENT_CONTENT_KINDS]}::text[])
          OR COALESCE(envelope."relevanceReason", '') = ${INTERNAL_REVIEW_CONTEXT_REASON}
          OR COALESCE(envelope."relevanceReason", '') = ANY(${[...TERMINAL_REVIEW_QUARANTINE_REASONS]}::text[])
          OR (
            COALESCE(envelope."relevanceReason", '') = ANY(${[...AUTOMATIC_REVIEW_DISCOVERY_REASONS]}::text[])
            AND COALESCE(envelope."contentKind"::text, '') = ANY(${[...AUTOMATIC_REVIEW_DISCOVERY_CONTENT_KINDS]}::text[])
          )
        )
        AND (
          envelope."reviewMutationUntil" IS NULL
          OR envelope."reviewMutationUntil" <= NOW()
        )
        AND NOT EXISTS (
          SELECT 1
          FROM discovery_auto_review_decisions active_auto_review
          WHERE active_auto_review."organizationId" = envelope."organizationId"
            AND active_auto_review."envelopeId" = envelope.id
            AND active_auto_review.state = 'SUPPRESSED'
        )
        AND decision_match.value->>'status' = 'MATCHED'
        AND decision_match.value->>'subjectId' = ANY(${subjectIds}::text[])
      GROUP BY decision_match.value->>'subjectId'
    `,
    prisma.$queryRaw<PlatformFindingSummaryRow[]>`
      SELECT
        msm."subjectId",
        LOWER(sm.platform::text) AS platform,
        COUNT(*)::int AS total
      FROM social_mention_subject_matches msm
      JOIN social_mentions sm
        ON sm."organizationId" = msm."organizationId"
        AND sm.id = msm."mentionId"
      WHERE msm."organizationId" = ${organizationId}
        AND msm."subjectId" = ANY(${subjectIds}::text[])
        AND msm.status = 'MATCHED'
        AND msm.reason <> 'parent_post_match'
        AND sm."purgedAt" IS NULL
        AND sm."deletedAtSource" IS NULL
        AND (
          sm."sourceMetadata" -> 'socialTriage' ->> 'language' = ANY(${[...CARD_LANGUAGES]}::text[])
          -- Комментарии языковой фильтр ленты не отсекает (mentions/route.ts),
          -- поэтому и счётчик не должен: иначе карточка и лента разойдутся
          -- в числах, как до #651.
          OR UPPER(sm."contentKind"::text) IN ('COMMENT', 'REPLY')
          OR LOWER(BTRIM(COALESCE(sm."sourceType", ''))) IN ('comment', 'reply')
        )
        AND (
          NOT (
            UPPER(sm."contentKind"::text) IN ('COMMENT', 'REPLY')
            OR LOWER(BTRIM(COALESCE(sm."sourceType", ''))) IN ('comment', 'reply')
          )
          OR LOWER(BTRIM(COALESCE(sm.sentiment, ''))) IN ('negative', 'neutral')
        )
      GROUP BY msm."subjectId", LOWER(sm.platform::text)
    `,
  ])
  const reviewsBySubject = new Map<string, number>(
    reviewRows.map((row: ReviewFindingSummaryRow) => [row.subjectId, row.needsReview]),
  )
  const summaries = new Map<string, MonitoringProfileFindingSummary>(
    mentionRows.map((row: FindingSummaryRow) => [row.subjectId, {
      total: row.total,
      new: row.newCount,
      last24Hours: row.last24Hours,
      last7Days: row.last7Days,
      posts: row.posts,
      comments: row.comments,
      media: row.media,
      positive: row.positive,
      neutral: row.neutral,
      negative: row.negative,
      needsReview: reviewsBySubject.get(row.subjectId) ?? 0,
      needsAction: row.needsAction,
    }]),
  )
  for (const row of reviewRows) {
    if (summaries.has(row.subjectId)) continue
    summaries.set(row.subjectId, {
      ...emptyFindingSummary(),
      needsReview: row.needsReview,
    })
  }
  const platformSummaries = new Map<string, Record<string, number>>()
  for (const row of platformRows) {
    const current = platformSummaries.get(row.subjectId) ?? {}
    current[row.platform] = row.total
    platformSummaries.set(row.subjectId, current)
  }
  return { findings: summaries, findingsByPlatform: platformSummaries }
}

export async function listMonitoringProfiles(organizationId: string): Promise<MonitoringProfileView[]> {
  const delegate = (prisma as unknown as { monitoringSubject?: typeof prisma.monitoringSubject }).monitoringSubject
  const [subjects, scenarios] = await Promise.all([
    delegate?.findMany
      ? delegate.findMany({
          where: { organizationId, status: { not: "deleted" } },
          include: profileSubjectInclude,
          orderBy: [{ name: "asc" }],
        }) as unknown as Promise<ProfileSubjectRow[]>
      : Promise.resolve([] as ProfileSubjectRow[]),
    getMonitoringScenarios(organizationId),
  ])

  const bySubject = new Map<string, MonitoringScenario[]>()
  const orphans: MonitoringScenario[] = []
  for (const scenario of scenarios) {
    if (!scenario.subjectId) {
      orphans.push(scenario)
      continue
    }
    const list = bySubject.get(scenario.subjectId) ?? []
    list.push(scenario)
    bySubject.set(scenario.subjectId, list)
  }

  // Finding counters are operational analytics, not the source of truth for
  // the monitoring registry. A stale rolling-deploy column or one malformed
  // legacy envelope must not make every monitoring disappear from the UI.
  // Keep the profiles usable and surface zero counters until the next healthy
  // refresh instead of failing the entire GET endpoint.
  const summaries = await loadFindingSummaries(organizationId, subjects.map(subject => subject.id))
    .catch(error => {
      console.error("[social-monitoring] profile finding summaries unavailable", {
        organizationId,
        error: error instanceof Error ? error.message : "unknown",
      })
      return {
        findings: new Map<string, MonitoringProfileFindingSummary>(),
        findingsByPlatform: new Map<string, Record<string, number>>(),
      }
    })
  return [
    ...subjects.map(subject => ({
      ...buildMonitoringProfileView(subject, pickCanonicalScenario(bySubject.get(subject.id) ?? [])),
      findings: summaries.findings.get(subject.id) ?? emptyFindingSummary(),
      findingsByPlatform: summaries.findingsByPlatform.get(subject.id) ?? {},
    })),
    ...orphans.map(buildLegacyScenarioProfileView),
  ]
}

/**
 * Exact normalized-name match only. Deliberately stricter than the step-1
 * candidate search: "araz" should *offer* the Araz Supermarket profile to a
 * human, but must never silently absorb a genuinely new profile into an
 * existing one behind their back.
 */
async function findSubjectIdByName(organizationId: string, name: string): Promise<string | null> {
  const normalized = normalizeSubjectTerm(name)
  if (!normalized) return null
  const delegate = (prisma as unknown as { monitoringSubject?: typeof prisma.monitoringSubject }).monitoringSubject
  if (!delegate?.findMany) return null
  const rows = await delegate.findMany({
    where: { organizationId, status: { not: "deleted" } },
    select: { id: true, name: true },
  }) as unknown as Array<{ id: string; name: string }>
  return rows.find(row => normalizeSubjectTerm(row.name) === normalized)?.id ?? null
}

export type MonitoringProfileInput = {
  subjectId?: string | null
  name: string
  type?: MonitoringSubjectType
  aliases?: MonitoringSubjectAliasInput[]
  platforms: MonitoringScenarioPlatform[]
  directions: MonitoringScenarioDirection[]
  includeExternalComments?: boolean | null
  /** @deprecated Accepted only for rolling-client compatibility and ignored. */
  sourceIds?: string[]
  /** @deprecated Identity links are managed outside monitoring scenarios. */
  officialSourceIds?: string[]
  languages?: string[]
  geographies?: string[]
  requiredContext?: string[]
  exclusions?: string[]
  extraKeywords?: string[]
  minConfidence?: number
  action?: MonitoringScenario["ai"]["action"]
  replyIdentityId?: string | null
  replyMode?: MonitoringScenario["reply"]["mode"]
  archiveStartAt?: string | null
}

/**
 * Creates or reuses a whole monitoring profile from one wizard submission.
 *
 * Identity claiming is serialized by normalized name. Scenario JSON, managed
 * sources and scenario links are committed atomically by the scenario service.
 * The subject remains the outer provisioning anchor: a newly claimed row starts
 * paused and is returned to paused if its collection plan cannot be committed.
 */
export async function createOrUpdateMonitoringProfile(
  organizationId: string,
  userId: string | undefined,
  input: MonitoringProfileInput,
): Promise<MonitoringProfileView> {
  const subjectInput = {
    type: input.type ?? "COMPANY" as MonitoringSubjectType,
    name: input.name,
    status: "active" as const,
    aliases: input.aliases,
    languages: input.languages,
    geographies: input.geographies,
    requiredContext: input.requiredContext,
    exclusions: input.exclusions,
  }

  // "Never create a duplicate" cannot rest on the wizard passing subjectId back:
  // a double-submit, or a second operator typing the same brand, would otherwise
  // produce two subjects with the same name and split the archive between them.
  // Resolve by exact normalized name whenever the caller did not name a subject;
  // claimMonitoringSubjectIdentity closes the remaining concurrent-create race.
  const requestedSubjectId = input.subjectId?.trim() || null
  const nameMatchId = requestedSubjectId ? null : await findSubjectIdByName(organizationId, input.name)
  const claimed = requestedSubjectId || nameMatchId
    ? { subjectId: requestedSubjectId ?? nameMatchId!, created: false }
    : await claimMonitoringSubjectIdentity(organizationId, userId, {
        type: subjectInput.type,
        name: subjectInput.name,
        aliases: subjectInput.aliases,
      })
  const reusedSubjectId = claimed.created ? null : claimed.subjectId
  const rollbackSnapshot = reusedSubjectId
    ? await prisma.monitoringSubject.findFirst({
        where: { organizationId, id: reusedSubjectId },
        select: {
          type: true,
          name: true,
          status: true,
          languages: true,
          geographies: true,
          requiredContext: true,
          exclusions: true,
          aliases: {
            select: {
              kind: true,
              value: true,
              language: true,
              weight: true,
              isNegative: true,
              isAmbiguous: true,
            },
          },
        },
      })
    : null
  const subject = await updateMonitoringSubject(organizationId, claimed.subjectId, subjectInput)
  const createdSubjectId = claimed.created ? claimed.subjectId : null

  try {
    const search = deriveScenarioSearchFromSubject(subject, input.extraKeywords)
    const existing = pickCanonicalScenario(
      (await getMonitoringScenarios(organizationId)).filter(item => item.subjectId === subject.id),
    )
    const scenarioInput = {
      subjectId: subject.id,
      subjectName: subject.name,
      name: subject.name,
      status: "active",
      platforms: input.platforms,
      ...search,
      directions: input.directions,
      // Stays three-state: undefined leaves a legacy `null` alone instead of
      // coercing it to true and silently starting paid comment scraping.
      includeExternalComments: input.includeExternalComments,
      minConfidence: input.minConfidence,
      action: input.action,
      replyIdentityId: input.replyIdentityId,
      replyMode: input.replyMode,
      archiveStartAt: input.archiveStartAt,
    }
    const scenario = existing
      ? await updateMonitoringScenario(organizationId, existing.id, scenarioInput)
      : await createMonitoringScenario(organizationId, userId, scenarioInput)
    return buildMonitoringProfileView(subject as unknown as ProfileSubjectRow, scenario)
  } catch (error) {
    if (createdSubjectId) {
      await updateMonitoringSubject(organizationId, createdSubjectId, { status: "paused" }).catch(() => {})
    } else if (rollbackSnapshot && reusedSubjectId) {
      await updateMonitoringSubject(organizationId, reusedSubjectId, {
        type: rollbackSnapshot.type as MonitoringSubjectType,
        name: rollbackSnapshot.name,
        status: rollbackSnapshot.status as "active" | "paused" | "archived",
        languages: rollbackSnapshot.languages,
        geographies: rollbackSnapshot.geographies,
        requiredContext: rollbackSnapshot.requiredContext,
        exclusions: rollbackSnapshot.exclusions,
        aliases: rollbackSnapshot.aliases.map((alias: {
          kind: string
          value: string
          language: string | null
          weight: number
          isNegative: boolean
          isAmbiguous: boolean
        }) => ({
          kind: alias.kind as MonitoringSubjectAliasKind,
          value: alias.value,
          language: alias.language,
          weight: alias.weight,
          isNegative: alias.isNegative,
          isAmbiguous: alias.isAmbiguous,
        })),
      }).catch(() => {})
    }
    throw error
  }
}

/**
 * Resume a profile whose collection plan is gone (spec §9 — the Bahruz
 * Şiraliyev case). Rebuilds one scenario from the vocabulary the subject
 * already holds, so nothing is retyped and the existing archive is reused
 * before any external collection.
 */
export async function resumeMonitoringProfile(
  organizationId: string,
  subjectId: string,
  userId: string | undefined,
  overrides: { platforms?: MonitoringScenarioPlatform[]; directions?: MonitoringScenarioDirection[] } = {},
): Promise<MonitoringProfileView> {
  const delegate = (prisma as unknown as { monitoringSubject?: typeof prisma.monitoringSubject }).monitoringSubject
  const subject = await delegate?.findFirst?.({
    where: { organizationId, id: subjectId },
    include: profileSubjectInclude,
  }) as unknown as ProfileSubjectRow | null
  if (!subject) throw new Error("Monitoring profile not found")

  const existing = pickCanonicalScenario(
    (await getMonitoringScenarios(organizationId)).filter(item => item.subjectId === subjectId),
  )
  const previousStatus = subject.status as "active" | "paused" | "archived"
  const restored = subject.status === "active"
    ? subject
    : (await updateMonitoringSubject(organizationId, subjectId, { status: "active" })) as unknown as ProfileSubjectRow

  try {
    if (existing) {
      const scenario = await updateMonitoringScenario(organizationId, existing.id, {
        status: "active",
        ...(overrides.platforms ? { platforms: overrides.platforms } : {}),
        ...(overrides.directions ? { directions: overrides.directions } : {}),
      })
      // Scenario synchronization can create or relink managed sources (for
      // example a missing YouTube or WEB source). Return a fresh subject graph
      // so the caller can run those repaired sources immediately.
      const refreshed = await delegate?.findFirst?.({
        where: { organizationId, id: subjectId },
        include: profileSubjectInclude,
      }) as unknown as ProfileSubjectRow | null
      return buildMonitoringProfileView(refreshed ?? restored, scenario)
    }

    const linkedPlatforms = Array.from(new Set(
      (restored.sources ?? [])
        .filter(link => !isMonitoringIdentityRelation(link.relationType))
        .map(link => link.source?.platform)
        .filter((platform): platform is MonitoringScenarioPlatform =>
          Boolean(platform) && ["instagram", "facebook", "tiktok", "twitter", "youtube", "web"].includes(platform!),
        ),
    ))
    return createOrUpdateMonitoringProfile(organizationId, userId, {
      subjectId,
      name: restored.name,
      type: restored.type as MonitoringSubjectType,
      platforms: overrides.platforms ?? (linkedPlatforms.length > 0
        ? linkedPlatforms
        : ["instagram", "facebook", "tiktok", "youtube", "web"]),
      directions: overrides.directions ?? ["general_reputation"],
    })
  } catch (error) {
    if (previousStatus !== "active") {
      await updateMonitoringSubject(organizationId, subjectId, { status: previousStatus }).catch(() => {})
    }
    throw error
  }
}

export async function setMonitoringProfileStatus(
  organizationId: string,
  subjectId: string,
  status: "active" | "paused" | "archived",
): Promise<void> {
  const scenarios = (await getMonitoringScenarios(organizationId)).filter(item => item.subjectId === subjectId)
  const scenario = pickCanonicalScenario(scenarios)
  if (scenario) {
    await updateMonitoringScenario(organizationId, scenario.id, {
      status: status === "active" ? "active" : "paused",
    })
  }
  await updateMonitoringSubject(organizationId, subjectId, { status })
}

/**
 * Removes an inert monitoring from the operator-facing product without
 * destroying collected mentions. Historical matches keep their subject row as
 * an audit anchor; the tombstone is excluded from profile lists and future
 * name matching, while scenarios and managed collectors are removed.
 *
 * By default a monitoring that is still collecting must be stopped first —
 * that keeps accidental one-click destruction impossible for API callers.
 * `force` is the explicit direct-delete path (UI shows a stronger confirm):
 * the transaction below already removes running scenarios atomically, so a
 * forced delete needs no intermediate archived state.
 */
export async function deleteMonitoringProfile(
  organizationId: string,
  subjectId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const subject = await prisma.monitoringSubject.findFirst({
    where: { organizationId, id: subjectId },
    select: { id: true, status: true },
  })
  if (!subject || subject.status === "deleted") throw new Error("Monitoring profile not found")

  const scenarios = (await getMonitoringScenarios(organizationId)).filter(item => item.subjectId === subjectId)
  const hasRunningPlan = scenarios.some(item => item.status === "active")
  if (!options.force && subject.status !== "archived" && hasRunningPlan) {
    throw new Error("Stop monitoring before deleting it")
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Scenario removal and the subject tombstone are one unit. Previously the
    // ChannelConfig was changed first and a later tombstone failure left a
    // visible, undeletable profile with its collection plan already removed.
    for (const scenario of scenarios) {
      await deleteMonitoringScenario(organizationId, scenario.id, tx)
    }
    await tx.monitoringSubjectAlias.deleteMany({ where: { organizationId, subjectId } })
    // Запоминаем источники ДО удаления связей: после него найти их будет уже
    // не по чему, а оставленный включённым источник продолжает платно
    // опрашивать провайдера по клиенту, которого больше нет.
    const linkedSourceIds = (await tx.monitoringSubjectSource.findMany({
      where: { organizationId, subjectId },
      select: { sourceId: true },
    })).map((link: { sourceId: string }) => link.sourceId)
    await tx.monitoringSubjectSource.deleteMany({ where: { organizationId, subjectId } })
    if (linkedSourceIds.length > 0) {
      // Гасим только осиротевшие: источник, оставшийся привязанным к другому
      // живому клиенту, обязан продолжать работать.
      await tx.monitoringSource.updateMany({
        where: {
          organizationId,
          id: { in: linkedSourceIds },
          status: { in: ["active", "limited", "needs_setup"] },
          subjectSources: { none: {} },
        },
        data: { status: "disabled" },
      })
      // Плюс снимаем платные маршруты, иначе они остаются ACTIVE на мёртвом
      // источнике и всплывут при любом ручном запуске из реестра источников.
      await tx.sourceRoutePlan.updateMany({
        where: {
          organizationId,
          sourceId: { in: linkedSourceIds },
          status: { not: "INVALIDATED" },
          source: { subjectSources: { none: {} } },
        },
        data: { status: "INVALIDATED" },
      })
    }
    await tx.monitoringSubjectRelation.deleteMany({
      where: { organizationId, OR: [{ subjectId }, { relatedSubjectId: subjectId }] },
    })
    await tx.monitoringSubject.update({
      where: { organizationId_id: { organizationId, id: subjectId } },
      data: {
        status: "deleted",
        description: null,
        languages: [],
        geographies: [],
        requiredContext: [],
        exclusions: [],
        sensitiveCategories: [],
        assignedAgentId: null,
        replyPolicy: {},
        legalPolicy: {},
      },
    })
  })
}
