import { parseTenantPaidRunPolicy, runQuotaValid } from "@/lib/social/paid-run-authorization"
import { monitoringSourceIdentityRole } from "@/lib/social/monitoring-source-identity"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Manual-only sources remain runnable from the explicit UI action, but cron
 * must never enqueue them. TikTok selective discovery stamps this flag so a
 * user click can authorize a capped paid run without turning it into a daily
 * provider charge.
 */
export function allowsAutomaticSourceCollection(settings: unknown): boolean {
  const sourceSettings = record(settings)
  const selectiveDiscovery = record(sourceSettings.selectiveDiscovery)
  const collectionPolicy = record(sourceSettings.collectionPolicy)
  return selectiveDiscovery.liveRoutingAllowed !== false
    && collectionPolicy.automaticCollectionAllowed !== false
    && collectionPolicy.manualOnly !== true
}

export type AutomaticRoutePlan = {
  status: string
  capability?: string
  primaryAdapter: string
  fallbackAdapters: string[]
  capabilityProofId?: string | null
  budget: unknown
  policyVersion?: string | null
  dependsOnCapability?: string | null
  lastFailureClass?: string | null
}

export type AutomaticCollectionDecisionReason =
  | "automatic_collection_enabled"
  | "explicitly_manual_only"
  | "legacy_scenario_direct_source"
  | "official_identity_not_collectable"
  | "no_active_linked_subject"
  | "route_plan_missing"
  | "route_plan_stale"
  | "route_plan_repair_required"
  | "legacy_route_migration_required"
  | "blocked_entry_route_requires_action"
  | "no_authorized_automatic_route"

export type AutomaticCollectionDecision = {
  allowed: boolean
  reason: AutomaticCollectionDecisionReason
}

const MANUAL_ADAPTER = "MANUAL_TASK"
const APIFY_ADAPTER = "APIFY_ASYNC"
const BRIGHT_DATA_ADAPTER = "BRIGHT_DATA_SNAPSHOT"
const BUDGET_OR_QUOTA_ADAPTERS = new Set([
  "X_API",
  "TIKTOK_BUSINESS_API",
  "BRIGHT_DATA_SNAPSHOT",
])
const LEGACY_SCENARIO_DIRECT_SOURCE_TYPES = new Set([
  "profile",
  "page",
  "competitor",
  "influencer",
  "search_url",
])

function routeBudgetConfigured(value: unknown): boolean {
  return record(value).usdLimitsConfigured === true
}

/**
 * Whether a persisted route adapter may be used by cron. This is intentionally
 * separate from manual-run authorization: a one-shot UI cap may unlock the
 * same adapter without silently enabling recurring provider spend.
 */
export function allowsAutomaticRouteAdapter(input: {
  adapter: string
  budget: unknown
  organizationSettings: unknown
}): boolean {
  if (input.adapter === MANUAL_ADAPTER) return false
  if (input.adapter === APIFY_ADAPTER) {
    const policy = parseTenantPaidRunPolicy(input.organizationSettings)
    if (policy.emergencyStopped) return false
    // Тенант может оплачивать сбор со своего счёта у провайдера — тогда
    // потолком служит его баланс (владелец пополняет Apify фиксированными
    // суммами), и дублировать его локальными долларовыми лимитами незачем.
    // Ровно этот принцип уже применён к Bright Data ниже; ручные прогоны
    // такого тенанта работают так с самого начала, а автосбор оставался
    // заблокированным и молча не запускался.
    if (policy.clientFundedManualRunsEnabled) return true
    return routeBudgetConfigured(input.budget)
  }
  if (input.adapter === BRIGHT_DATA_ADAPTER) {
    // Bright Data spend is governed by the customer's provider account. Keep
    // only the tenant emergency stop; local USD/run quotas must not truncate
    // search coverage.
    return !parseTenantPaidRunPolicy(input.organizationSettings).emergencyStopped
  }
  if (!BUDGET_OR_QUOTA_ADAPTERS.has(input.adapter)) return true

  if (routeBudgetConfigured(input.budget)) return true
  const policy = parseTenantPaidRunPolicy(input.organizationSettings)
  return runQuotaValid(policy) && !policy.emergencyStopped
}

/**
 * Runtime eligibility shared by cron selection and coverage SLOs.
 *
 * - A linked paused/archived/deleted subject cannot keep collecting.
 * - Legacy direct targets attached through the removed scenario/profile
 *   pickers stay parked until cleanup removes their MONITORS binding.
 * - Paid-only routes without recurring authorization are manual capability,
 *   not broken automatic coverage.
 * - Missing/stale/blocked plans are still admitted once so the collector can
 *   compile or self-heal them; otherwise a newly available free route could
 *   remain parked forever.
 */
export function automaticSourceCollectionDecision(input: {
  settings: unknown
  platform?: string
  sourceType?: string
  url?: string | null
  handle?: string | null
  ownership?: string
  linkedSubjectStatuses?: string[]
  linkedSubjectRelations?: Array<{
    relationType?: string | null
    scenarioId?: string | null
  }>
  routePlans?: AutomaticRoutePlan[]
  organizationSettings?: unknown
  currentRoutePolicyVersion?: string
}): AutomaticCollectionDecision {
  // Cron is unscoped: if a physical source is also an official/owned identity,
  // it cannot safely decide on whose behalf to scrape it. Explicit
  // profile-scoped collection uses a separate run path.
  if (
    input.linkedSubjectRelations
    && monitoringSourceIdentityRole(input.linkedSubjectRelations) !== "external"
  ) {
    return { allowed: false, reason: "official_identity_not_collectable" }
  }

  const sourceSettings = record(input.settings)
  const scenarioTargetType = typeof sourceSettings.scenarioTargetType === "string"
    ? sourceSettings.scenarioTargetType
    : ""
  const hasLegacyMonitorsLink = input.linkedSubjectRelations?.some(
    relation => relation.relationType === "MONITORS",
  ) === true
  if (
    (
      sourceSettings.managedBy === "monitoring_scenario"
      || hasLegacyMonitorsLink
    )
    && (
      LEGACY_SCENARIO_DIRECT_SOURCE_TYPES.has(input.sourceType ?? "")
      || Boolean(input.url)
      || Boolean(input.handle)
      || scenarioTargetType === "url"
      || scenarioTargetType === "handle"
    )
  ) {
    return { allowed: false, reason: "legacy_scenario_direct_source" }
  }

  if (!allowsAutomaticSourceCollection(input.settings)) {
    return { allowed: false, reason: "explicitly_manual_only" }
  }

  // Автосбор платит провайдеру, поэтому источник с МЁРТВЫМИ связями не
  // собираем: связи есть, живого клиента среди них нет — это пауза/архив/
  // удаление клиента.
  //
  // НО ноль связей ≠ мёртвый клиент. Так выглядят вполне живые источники:
  //  - добавленные вручную в реестре «Источники» (POST /monitoring-sources
  //    связь с клиентом не создаёт вообще),
  //  - источники сценария без клиента (`scenario.subjectId` может быть пуст —
  //    связи создаются только при наличии клиента, monitoring-scenarios).
  // Формулировка «любой источник без активной связи» (2026-08-01) выключила
  // им автосбор и заодно убрала их из SLO-проверок покрытия — то есть по ним
  // перестали приходить и алерты «покрытие просело».
  //
  // Деньги при этом защищены в правильном месте: удаление клиента само гасит
  // осиротевшие источники (status=disabled) и инвалидирует их платные
  // маршруты — см. deleteMonitoringSubject в monitoring-profiles.ts. Здесь
  // достаточно старого условия: блокируем, если связи БЫЛИ и живых нет, плюс
  // сценарные источники без связей (их жизненным циклом управляет сценарий).
  if (
    input.linkedSubjectStatuses
    && !input.linkedSubjectStatuses.includes("active")
    && (
      input.linkedSubjectStatuses.length > 0
      || sourceSettings.managedBy === "monitoring_scenario"
    )
  ) {
    return { allowed: false, reason: "no_active_linked_subject" }
  }

  const plans = input.routePlans
  if (!plans || plans.length === 0) {
    return { allowed: true, reason: "route_plan_missing" }
  }
  if (
    input.currentRoutePolicyVersion
    && plans.some(plan => plan.policyVersion !== input.currentRoutePolicyVersion)
  ) {
    return { allowed: true, reason: "route_plan_stale" }
  }

  // v7 briefly inferred Business Discovery from the mere presence of a
  // connected IG token. Admit only those legacy entry plans once so runtime
  // compilation can replace META_GRAPH with the approved provider/manual
  // route unless a VERIFIED Meta capability proof actually exists.
  const prooflessInstagramBusinessDiscovery = input.platform === "instagram"
    && input.ownership === "external"
    && plans.some(plan =>
      !plan.dependsOnCapability
      && plan.capability === "DISCOVER_POSTS"
      && plan.primaryAdapter === "META_GRAPH"
      && !plan.capabilityProofId,
    )
  if (prooflessInstagramBusinessDiscovery) {
    return { allowed: true, reason: "legacy_route_migration_required" }
  }

  // Eligibility is determined by entry capabilities. A healthy dependent
  // READ_MEDIA/COMMENTS plan cannot make collection runnable while its
  // DISCOVER_POSTS entry route is quarantined.
  const allEntryPlans = plans.some(plan => !plan.dependsOnCapability)
    ? plans.filter(plan => !plan.dependsOnCapability)
    : plans
  const entryPlans = allEntryPlans.filter(plan => ["ACTIVE", "DEGRADED"].includes(plan.status))
  if (entryPlans.length === 0) {
    const runtimeQuarantine = allEntryPlans.some(plan =>
      plan.status === "BLOCKED"
      && ["AUTH", "POLICY", "PERMANENT"].includes(plan.lastFailureClass ?? ""),
    )
    return runtimeQuarantine
      ? { allowed: false, reason: "blocked_entry_route_requires_action" }
      : { allowed: true, reason: "route_plan_repair_required" }
  }
  const hasAuthorizedRoute = entryPlans.some(plan => (
    [plan.primaryAdapter, ...(plan.fallbackAdapters ?? [])].some(adapter =>
      allowsAutomaticRouteAdapter({
        adapter,
        budget: plan.budget,
        organizationSettings: input.organizationSettings,
      }),
    )
  ))

  return hasAuthorizedRoute
    ? { allowed: true, reason: "automatic_collection_enabled" }
    : { allowed: false, reason: "no_authorized_automatic_route" }
}
