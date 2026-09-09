import { monitoringDirectSourceKey } from "@/lib/social/monitoring-source-presentation"
import { isMonitoringIdentityRelation } from "@/lib/social/monitoring-source-identity"
import {
  monitoringSourceMatchesCurrentScenarioTarget,
  type MonitoringScenarioCollectionPlan,
} from "@/lib/social/monitoring-scenarios"

export const MONITORING_PROFILE_RUN_PAID_ADAPTERS = new Set([
  "APIFY_ASYNC",
  "BRIGHT_DATA_SNAPSHOT",
  "TIKTOK_BUSINESS_API",
  "X_API",
])

export type MonitoringProfileRunRoutePlan = {
  scenarioId?: string | null
  status: string
  primaryAdapter?: string
  fallbackAdapters?: string[]
  budget?: unknown
}

export type MonitoringProfileRunPlanSource = {
  platform: string
  sourceType?: string | null
  collectionMode?: string | null
  query?: string | null
  url: string | null
  handle: string | null
  settings?: unknown
  routePlans?: MonitoringProfileRunRoutePlan[]
  _count?: { subjectSources?: number }
}

export type MonitoringProfileRunPlanLink = {
  scenarioId?: string | null
  relationType?: string | null
  source: MonitoringProfileRunPlanSource
}

export type MonitoringProfileRunPlanScenario = MonitoringScenarioCollectionPlan

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function monitoringProfileSourceScenarioIds(
  link: MonitoringProfileRunPlanLink,
): string[] {
  const ids = new Set<string>()
  const linkedScenarioId = nonBlankString(link.scenarioId)
  if (linkedScenarioId) ids.add(linkedScenarioId)

  const settings = recordFromUnknown(link.source.settings)
  const directScenarioId = nonBlankString(settings.scenarioId)
  if (directScenarioId) ids.add(directScenarioId)
  const scenarioLinks = Array.isArray(settings.scenarioLinks) ? settings.scenarioLinks : []
  for (const item of scenarioLinks) {
    const scenarioId = nonBlankString(recordFromUnknown(item).scenarioId)
    if (scenarioId) ids.add(scenarioId)
  }

  for (const plan of link.source.routePlans ?? []) {
    const scenarioId = nonBlankString(plan.scenarioId)
    if (scenarioId) ids.add(scenarioId)
  }
  return Array.from(ids)
}

/**
 * Scenario markers only restrict a source that is still part of the current
 * collection plan. They never authorize a historical source by themselves.
 */
export function monitoringProfileSourceBelongsToScenario(
  link: MonitoringProfileRunPlanLink,
  scenario: MonitoringProfileRunPlanScenario,
): boolean {
  // A brand's own page is an identity/exclusion signal. It must never become
  // an external provider target merely because an old scenario still contains
  // the same URL.
  if (isMonitoringIdentityRelation(link.relationType)) return false
  if (!monitoringSourceMatchesCurrentScenarioTarget(scenario, link.source)) return false

  const scenarioIds = monitoringProfileSourceScenarioIds(link)
  if (scenarioIds.length > 0) return scenarioIds.includes(scenario.id)

  // A markerless legacy row is allowed only because the structural target
  // check above proved that it still exactly represents today's plan.
  return Boolean(monitoringDirectSourceKey(link.source))
    || Boolean(link.source.query?.trim())
}

/**
 * A shared publisher/watchlist source is intentionally neutral: it can scan
 * the same external page for several monitored brands. It may join a
 * profile-scoped manual run only when the selected subject is explicitly
 * linked to it, no source/route marker assigns it to another scenario, and
 * the selected scenario covers that platform. The API separately requires an
 * explicit full-run confirmation and scopes relevance to the selected subject.
 */
export function monitoringProfileSharedSourceCanTargetScenario(
  link: MonitoringProfileRunPlanLink,
  scenario: MonitoringProfileRunPlanScenario,
): boolean {
  if (isMonitoringIdentityRelation(link.relationType)) return false
  if (!monitoringSourceMatchesCurrentScenarioTarget(scenario, link.source)) return false
  if ((link.source._count?.subjectSources ?? 0) <= 1) return false
  if (monitoringProfileSourceScenarioIds(link).length > 0) return false

  const platform = link.source.platform.trim().toLowerCase()
  const scenarioPlatforms = new Set(scenario.platforms.map(value => value.trim().toLowerCase()))
  return scenarioPlatforms.has(platform)
    || (platform === "web" && scenarioPlatforms.has("web"))
}

/**
 * Route compilers may persist aliases for several scenarios on one physical
 * source. Prefer the requested scenario and neutral legacy plans, never plans
 * explicitly owned by a different scenario.
 */
export function monitoringProfileScenarioRoutePlans<T extends MonitoringProfileRunRoutePlan>(
  routePlans: T[],
  scenarioId: string,
): T[] {
  const scoped = routePlans.filter(plan => plan.scenarioId === scenarioId)
  const neutral = routePlans.filter(plan => !plan.scenarioId)
  return scoped.length > 0 ? [...scoped, ...neutral] : neutral
}

function routeUsesPaidAdapter(plan: MonitoringProfileRunRoutePlan): boolean {
  return [plan.primaryAdapter, ...(plan.fallbackAdapters ?? [])]
    .filter((adapter): adapter is string => typeof adapter === "string")
    .some(adapter => MONITORING_PROFILE_RUN_PAID_ADAPTERS.has(adapter))
}

function paidAdapters(plan: MonitoringProfileRunRoutePlan): string[] {
  return [plan.primaryAdapter, ...(plan.fallbackAdapters ?? [])]
    .filter((adapter): adapter is string => (
      typeof adapter === "string" && MONITORING_PROFILE_RUN_PAID_ADAPTERS.has(adapter)
    ))
}

export function monitoringProfileSourceRunPolicy(
  link: MonitoringProfileRunPlanLink,
  scenarioId: string,
): {
  paid: boolean
  providerAccountFundedOnly: boolean
  maxTotalChargeUsd: number | null
  sharedAcrossMonitorings: boolean
} {
  const executablePlans = monitoringProfileScenarioRoutePlans(
    (link.source.routePlans ?? []).filter(plan => ["ACTIVE", "DEGRADED"].includes(plan.status)),
    scenarioId,
  )
  const paidPlans = executablePlans.filter(routeUsesPaidAdapter)
  const selectedPaidAdapters = Array.from(new Set(paidPlans.flatMap(paidAdapters)))
  const configuredCaps = paidPlans.flatMap(plan => {
    const budget = recordFromUnknown(plan.budget)
    if (budget.usdLimitsConfigured !== true) return []
    const cap = positiveNumber(budget.maxTotalChargeUsd)
    return cap === null ? [] : [cap]
  })
  const scenarioIds = monitoringProfileSourceScenarioIds(link)

  return {
    paid: paidPlans.length > 0,
    providerAccountFundedOnly:
      selectedPaidAdapters.length > 0
      && selectedPaidAdapters.every(adapter => adapter === "BRIGHT_DATA_SNAPSHOT"),
    // Conservative source-wide click cap. A smaller cap fails closed before it
    // can silently expand spend when several paid capabilities are configured.
    maxTotalChargeUsd: configuredCaps.length > 0 ? Math.min(...configuredCaps) : null,
    sharedAcrossMonitorings:
      scenarioIds.some(id => id !== scenarioId)
      || (link.source._count?.subjectSources ?? 0) > 1,
  }
}
