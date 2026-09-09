import crypto from "node:crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  boundedClientFundedManualChargeUsd,
  boundedPaidSocialRunChargeUsd,
  CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD,
  effectivePaidSocialPeriodLimits,
  PAID_SOCIAL_HARD_MAX_PER_RUN_USD,
} from "@/lib/social/provider-spend-limits"
import {
  parseMonitoringResetBudgetCarryForward,
  standardPaidProviderCollectorRunIdsSince,
  type MonitoringResetBudgetCarryForward,
} from "@/lib/social/paid-provider-run-scope"

const SETTINGS_KEY = "socialMonitoringPaidRuns"
const AUTH_ENTITY = "social_paid_run_authorization"
const POLICY_ENTITY = "social_paid_run_policy"
const RESET_BOUNDARY_ENTITY_NAME = "Social Monitoring clean slate"
const RESET_BOUNDARY_ENTITY_ID_PREFIX = "clean-slate:"
const CLEAN_SLATE_LOCK_PREFIX = "social-monitoring-clean-slate:"

export const MAX_TENANT_PAID_RUN_CAP_USD = 100
export const MAX_TENANT_DAILY_PAID_RUN_BUDGET_USD = 10_000
export const MAX_TENANT_MONTHLY_PAID_RUN_BUDGET_USD = 100_000
// Hard ceiling for the run-count quota (paid scans per client per UTC day).
export const MAX_TENANT_DAILY_RUN_QUOTA = 100

// A paid scan reserves exactly one SocialProviderRun in this phase before any
// provider I/O, so counting distinct collector runs in this phase is the
// authoritative "paid scans today" metric for the run-count quota.
export const PAID_RUN_PHASE = "PAID_ROUTE_COLLECTION"

type JsonRecord = Record<string, unknown>

export type TenantPaidRunPolicy = {
  policyVersion: number
  manualRunsEnabled: boolean
  // Operator-only opt-in for the profile-scoped deep search that bills the
  // configured provider account outside recurring tenant budgets. It is not
  // exposed by the tenant policy PATCH endpoint.
  clientFundedManualRunsEnabled: boolean
  emergencyStopped: boolean
  maxPerRunUsd: number
  dailyBudgetUsd: number
  monthlyBudgetUsd: number
  // Owner decision 2026-07-19: paid social scans may be governed by a run-count
  // quota (scans per client per UTC day) instead of USD budgets. 0 = no quota
  // (USD budgets govern); >=1 = at most this many paid scans per day.
  dailyRunQuota: number
  // Owner decision 2026-07-20: tenant-wide default route budget. When set, every
  // monitoring source WITHOUT an explicit per-source budget compiles its paid
  // routes with these USD limits, so automatic collection runs across ALL
  // sources/keywords without per-source configuration. null = no default (paid
  // routes stay fail-closed unless the source configures its own budget).
  routeDefaults: { maxTotalChargeUsd: number; dailyBudgetUsd: number; monthlyBudgetUsd: number } | null
  authorizedAt: string | null
  authorizedBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export type TenantPaidRunUsage = {
  dayReservedUsd: number
  monthReservedUsd: number
  dayRemainingUsd: number
  monthRemainingUsd: number
  runsToday: number
  // null when no run-count quota is configured.
  runsRemainingToday: number | null
}

export type TenantPaidRunAuthorizationReportEntry = {
  authorizationId: string
  sourceId: string | null
  requestedByUserId: string | null
  maxTotalChargeUsd: number
  policyVersion: number | null
  status: "RESERVED" | "DISPATCHED" | "RELEASED"
  collectorRunId: string | null
  outcome: string | null
  createdAt: Date
}

export type TenantPaidRunReport = {
  policy: TenantPaidRunPolicy
  usage: TenantPaidRunUsage
  globalEnforcementEnabled: boolean
  recentAuthorizations: TenantPaidRunAuthorizationReportEntry[]
}

export type TenantPaidRunPolicyPatch = {
  manualRunsEnabled?: boolean
  emergencyStopped?: boolean
  maxPerRunUsd?: number
  dailyBudgetUsd?: number
  monthlyBudgetUsd?: number
  dailyRunQuota?: number
  // null clears the tenant-wide default route budget.
  routeDefaults?: { maxTotalChargeUsd: number; dailyBudgetUsd: number; monthlyBudgetUsd: number } | null
  authorizationConfirmed?: boolean
}

export type TenantPaidRunAuthorizationResult =
  | { status: "AUTHORIZED"; authorizationId: string; maxTotalChargeUsd: number; policyVersion: number }
  | { status: "BLOCKED"; reason: "paid_route_budget_enforcement_disabled" | "paid_manual_runs_not_authorized" | "paid_client_funded_manual_not_authorized" | "paid_manual_run_emergency_stopped" | "paid_manual_run_cap_invalid" | "paid_manual_run_cap_exceeds_tenant_limit" | "paid_route_daily_budget_exhausted" | "paid_route_monthly_budget_exhausted" | "paid_run_daily_quota_exhausted" }

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function nonNegative(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function positive(value: unknown): number | null {
  const parsed = nonNegative(value, NaN)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function starts(now: Date) {
  return {
    day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  }
}

export function usdBudgetsValid(policy: Pick<TenantPaidRunPolicy, "maxPerRunUsd" | "dailyBudgetUsd" | "monthlyBudgetUsd">): boolean {
  return policy.maxPerRunUsd > 0
    && policy.dailyBudgetUsd > 0
    && policy.monthlyBudgetUsd > 0
    && policy.maxPerRunUsd <= policy.dailyBudgetUsd
    && policy.dailyBudgetUsd <= policy.monthlyBudgetUsd
    && policy.maxPerRunUsd <= MAX_TENANT_PAID_RUN_CAP_USD
    && policy.dailyBudgetUsd <= MAX_TENANT_DAILY_PAID_RUN_BUDGET_USD
    && policy.monthlyBudgetUsd <= MAX_TENANT_MONTHLY_PAID_RUN_BUDGET_USD
}

export function runQuotaValid(policy: Pick<TenantPaidRunPolicy, "dailyRunQuota">): boolean {
  return policy.dailyRunQuota >= 1 && policy.dailyRunQuota <= MAX_TENANT_DAILY_RUN_QUOTA
}

export function parseTenantPaidRunPolicy(settings: unknown): TenantPaidRunPolicy {
  const raw = record(record(settings)[SETTINGS_KEY])
  const rawDefaults = record(raw.routeDefaults)
  const defaultRun = positive(rawDefaults.maxTotalChargeUsd)
  const defaultDaily = positive(rawDefaults.dailyBudgetUsd)
  const defaultMonthly = positive(rawDefaults.monthlyBudgetUsd)
  const policy: TenantPaidRunPolicy = {
    policyVersion: Math.max(1, Math.trunc(nonNegative(raw.policyVersion, 1))),
    manualRunsEnabled: raw.manualRunsEnabled === true,
    clientFundedManualRunsEnabled: raw.clientFundedManualRunsEnabled === true,
    emergencyStopped: raw.emergencyStopped !== false,
    maxPerRunUsd: roundUsd(nonNegative(raw.maxPerRunUsd)),
    dailyBudgetUsd: roundUsd(nonNegative(raw.dailyBudgetUsd)),
    monthlyBudgetUsd: roundUsd(nonNegative(raw.monthlyBudgetUsd)),
    dailyRunQuota: Math.trunc(nonNegative(raw.dailyRunQuota)),
    // All three limits must be valid positives, else the default is ignored
    // (fail-closed: a half-configured default must not unlock paid routes).
    routeDefaults: defaultRun !== null && defaultDaily !== null && defaultMonthly !== null
      ? {
          maxTotalChargeUsd: roundUsd(defaultRun),
          dailyBudgetUsd: roundUsd(defaultDaily),
          monthlyBudgetUsd: roundUsd(defaultMonthly),
        }
      : null,
    authorizedAt: text(raw.authorizedAt),
    authorizedBy: text(raw.authorizedBy),
    updatedAt: text(raw.updatedAt),
    updatedBy: text(raw.updatedBy),
  }
  // A policy may be enabled by valid USD budgets OR by a valid run-count quota;
  // either way an explicit authorization actor/time is required.
  const authorized = Boolean(policy.authorizedAt) && Boolean(policy.authorizedBy)
  const validEnabledPolicy = authorized && (usdBudgetsValid(policy) || runQuotaValid(policy))
  return policy.manualRunsEnabled && !validEnabledPolicy
    ? { ...policy, manualRunsEnabled: false, emergencyStopped: true }
    : policy
}

/**
 * Count distinct paid scans (collector runs that reserved a paid provider run)
 * for a tenant in the current UTC day. Pre-dispatch failures that never reached
 * the provider are excluded so a failed setup does not consume the quota.
 */
async function tenantPaidRunCollectorIdsToday(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date,
): Promise<string[]> {
  const dayStart = starts(now).day
  return standardPaidProviderCollectorRunIdsSince(tx, {
    organizationId,
    since: dayStart,
    phase: PAID_RUN_PHASE,
  })
}

export async function countTenantPaidRunsToday(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date,
): Promise<number> {
  return (await tenantPaidRunCollectorIdsToday(tx, organizationId, now)).length
}

async function lock(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`social-paid-runs:${organizationId}`}, 0))`
}

async function lockPolicyUpdate(tx: Prisma.TransactionClient, organizationId: string) {
  // Provider dispatch holds the clean-slate lock through provider I/O. Taking
  // it before the existing paid-run lock makes an emergency-stop update
  // linearizable with that boundary: either dispatch finishes first, or the
  // provider fence observes the committed stop before contacting the provider.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${CLEAN_SLATE_LOCK_PREFIX}${organizationId}`}, 0))`
  await lock(tx, organizationId)
}

type AuthorizationAuditEntry = {
  action: string
  entityId: string | null
  newValue: unknown
  createdAt: Date
}

type AuthorizationResetBoundaryAuditEntry = {
  newValue: unknown
  createdAt: Date
}

type AuthorizationResetBoundary = {
  at: Date
  carry: MonitoringResetBudgetCarryForward | null
}

type AuthorizationProviderRun = {
  collectorRunId: string | null
  status: string
  reservedChargeUsd: unknown
  actualChargeUsd: unknown
}

type AuthorizationReservation = {
  capUsd: number
  collectorRunId: string | null
  providerRequestDispatched: boolean | null
}

const ACTIVE_PROVIDER_RUN_STATUSES = new Set(["QUEUED", "RUNNING", "IMPORTING"])
const TERMINAL_PROVIDER_RUN_STATUSES = new Set(["SUCCEEDED", "PARTIAL", "FAILED", "BLOCKED", "IMPORTED", "PURGED"])

async function latestAuthorizationResetBoundary(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<AuthorizationResetBoundary | null> {
  const row = await tx.auditLog.findFirst({
    where: {
      organizationId,
      entityType: AUTH_ENTITY,
      action: "reset_boundary",
      userId: null,
      entityName: RESET_BOUNDARY_ENTITY_NAME,
      entityId: { startsWith: RESET_BOUNDARY_ENTITY_ID_PREFIX },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { newValue: true, createdAt: true },
  }) as AuthorizationResetBoundaryAuditEntry | null
  if (!row) return null

  const resetAtValue = text(record(row.newValue).resetAt)
  const resetAt = resetAtValue ? new Date(resetAtValue) : null
  // The append-only event itself is the minimum trustworthy boundary. A later
  // resetAt value is also honoured, while malformed/older payload timestamps
  // cannot reopen pre-reset reservations.
  return {
    at: resetAt && Number.isFinite(resetAt.getTime()) && resetAt > row.createdAt
      ? resetAt
      : row.createdAt,
    carry: parseMonitoringResetBudgetCarryForward(row.newValue),
  }
}

function periodStartAfterBoundary(periodStart: Date, resetBoundary: Date | null): Date {
  return resetBoundary && resetBoundary > periodStart ? resetBoundary : periodStart
}

function authorizationReservations(entries: AuthorizationAuditEntry[], since: Date) {
  const reservations = new Map<string, AuthorizationReservation>()
  const releases = new Map<string, number>()
  for (const entry of entries) {
    if (!entry.entityId || entry.createdAt < since) continue
    const value = record(entry.newValue)
    if (entry.action === "authorize") {
      if (value.clientFundedManual === true) continue
      const cap = positive(value.maxTotalChargeUsd) ?? 0
      reservations.set(entry.entityId, {
        // Legacy audit rows may pre-date the immutable global fuse. They must
        // not keep more than today's maximum exposure reserved forever.
        capUsd: roundUsd(boundedPaidSocialRunChargeUsd(cap)),
        collectorRunId: null,
        providerRequestDispatched: null,
      })
    }
    if (entry.action === "complete") {
      const reservation = reservations.get(entry.entityId)
      if (!reservation) continue
      reservation.collectorRunId = text(value.collectorRunId)
      reservation.providerRequestDispatched = typeof value.providerRequestDispatched === "boolean"
        ? value.providerRequestDispatched
        : null
    }
    if (entry.action === "release") releases.set(entry.entityId, positive(value.releasedChargeUsd) ?? 0)
  }
  for (const [id, reservation] of reservations) {
    reservation.capUsd = roundUsd(Math.max(0, reservation.capUsd - Math.min(
      reservation.capUsd,
      releases.get(id) ?? 0,
    )))
  }
  return reservations
}

function providerRunExposureUsd(run: AuthorizationProviderRun): number {
  return roundUsd(nonNegative(run.reservedChargeUsd) + nonNegative(run.actualChargeUsd))
}

function reconciledReservedUsd(
  reservations: Map<string, AuthorizationReservation>,
  providerRuns: AuthorizationProviderRun[],
): number {
  const runsByCollector = new Map<string, AuthorizationProviderRun[]>()
  for (const run of providerRuns) {
    if (!run.collectorRunId) continue
    const runs = runsByCollector.get(run.collectorRunId) ?? []
    runs.push(run)
    runsByCollector.set(run.collectorRunId, runs)
  }

  let total = 0
  for (const reservation of reservations.values()) {
    const cap = reservation.capUsd
    if (cap <= 0) continue

    // Missing completion metadata or an explicitly dispatched request without
    // a linked provider run remains fail-closed at the full bounded cap.
    if (reservation.providerRequestDispatched !== true || !reservation.collectorRunId) {
      total += reservation.providerRequestDispatched === false ? 0 : cap
      continue
    }
    const runs = runsByCollector.get(reservation.collectorRunId) ?? []
    if (runs.length === 0 || runs.some(run => ACTIVE_PROVIDER_RUN_STATUSES.has(run.status))) {
      total += cap
      continue
    }
    // Unknown future statuses also remain fail-closed. Only a completely
    // terminal collector can replace its reservation with settled exposure.
    if (runs.some(run => !TERMINAL_PROVIDER_RUN_STATUSES.has(run.status))) {
      total += cap
      continue
    }
    total += Math.min(cap, runs.reduce((sum, run) => sum + providerRunExposureUsd(run), 0))
  }
  return roundUsd(total)
}

async function usage(
  tx: Prisma.TransactionClient,
  organizationId: string,
  policy: TenantPaidRunPolicy,
  now: Date,
  resetBoundary: AuthorizationResetBoundary | null,
): Promise<TenantPaidRunUsage> {
  const period = starts(now)
  const monthStart = periodStartAfterBoundary(period.month, resetBoundary?.at ?? null)
  const dayStart = periodStartAfterBoundary(period.day, resetBoundary?.at ?? null)
  const entries = await tx.auditLog.findMany({
    where: {
      organizationId,
      entityType: AUTH_ENTITY,
      action: { in: ["authorize", "complete", "release"] },
      createdAt: { gte: monthStart },
    },
    select: { action: true, entityId: true, newValue: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })
  const monthReservations = authorizationReservations(entries, monthStart)
  const dayReservations = authorizationReservations(entries, dayStart)
  const collectorRunIds = Array.from(new Set(
    Array.from(monthReservations.values())
      .filter(item => item.capUsd > 0 && item.providerRequestDispatched === true && item.collectorRunId)
      .map(item => item.collectorRunId as string),
  ))
  const providerRuns = collectorRunIds.length === 0
    ? []
    : await tx.socialProviderRun.findMany({
        where: {
          organizationId,
          purgedAt: null,
          // Legacy paid calls were recorded directly in discovery/comment
          // phases before PAID_ROUTE_COLLECTION reservation rows existed.
          // collectorRunId is the authorization link; limiting this lookup to
          // the newer phase leaves those completed runs permanently reserved.
          collectorRunId: { in: collectorRunIds },
        },
        select: {
          collectorRunId: true,
          status: true,
          reservedChargeUsd: true,
          actualChargeUsd: true,
        },
      })
  const currentDayReservedUsd = reconciledReservedUsd(dayReservations, providerRuns)
  const currentMonthReservedUsd = reconciledReservedUsd(monthReservations, providerRuns)
  const dayCarryUsd = resetBoundary?.carry
    && resetBoundary.carry.utcDayStart.getTime() === period.day.getTime()
    && resetBoundary.carry.capturedAt.getTime() >= period.day.getTime()
    ? resetBoundary.carry.paidRunAuthorization.dayReservedUsd
    : 0
  const monthCarryUsd = resetBoundary?.carry
    && resetBoundary.carry.utcMonthStart.getTime() === period.month.getTime()
    && resetBoundary.carry.capturedAt.getTime() >= period.month.getTime()
    ? resetBoundary.carry.paidRunAuthorization.monthReservedUsd
    : 0
  const dayReservedUsd = roundUsd(dayCarryUsd + currentDayReservedUsd)
  const monthReservedUsd = roundUsd(monthCarryUsd + currentMonthReservedUsd)
  const providerCollectorRunIds = await standardPaidProviderCollectorRunIdsSince(tx, {
    organizationId,
    since: period.day,
    phase: PAID_RUN_PHASE,
    // The authorization carry is already the union of automatic provider rows
    // and manual authorization collector ids at the reset boundary.
    includeResetCarry: false,
  })
  const manualCollectorRunIds = Array.from(dayReservations.values()).flatMap(
    reservation => reservation.capUsd > 0 && reservation.collectorRunId
      ? [reservation.collectorRunId]
      : [],
  )
  // An authorization is committed before its collector/provider row is
  // created. Count that short reservation window so two tabs cannot both pass
  // the daily-run quota while neither provider row exists yet. Completed
  // manual Apify runs are represented by their authorization collector id,
  // since their provider phase is not PAID_ROUTE_COLLECTION.
  const pendingAuthorizedRuns = Array.from(dayReservations.values()).filter(
    reservation => reservation.capUsd > 0 && !reservation.collectorRunId,
  ).length
  const runsSinceReset = new Set([
    ...providerCollectorRunIds,
    ...manualCollectorRunIds,
  ]).size + pendingAuthorizedRuns
  const runsCarry = resetBoundary?.carry
    && resetBoundary.carry.utcDayStart.getTime() === period.day.getTime()
    && resetBoundary.carry.capturedAt.getTime() >= period.day.getTime()
    ? resetBoundary.carry.paidRunAuthorization.runsToday
    : 0
  const runsToday = runsCarry + runsSinceReset
  return {
    dayReservedUsd,
    monthReservedUsd,
    dayRemainingUsd: roundUsd(Math.max(0, policy.dailyBudgetUsd - dayReservedUsd)),
    monthRemainingUsd: roundUsd(Math.max(0, policy.monthlyBudgetUsd - monthReservedUsd)),
    runsToday,
    runsRemainingToday: runQuotaValid(policy) ? Math.max(0, policy.dailyRunQuota - runsToday) : null,
  }
}

export async function getTenantPaidRunReport(organizationId: string, now = new Date()): Promise<TenantPaidRunReport> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
    const policy = parseTenantPaidRunPolicy(organization?.settings)
    const resetBoundary = await latestAuthorizationResetBoundary(tx, organizationId)
    const currentUsage = await usage(tx, organizationId, policy, now, resetBoundary)
    const rows = await tx.auditLog.findMany({
      where: {
        organizationId,
        entityType: AUTH_ENTITY,
        action: { in: ["authorize", "complete", "release"] },
        ...(resetBoundary ? { createdAt: { gte: resetBoundary.at } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 150,
      select: { userId: true, action: true, entityId: true, entityName: true, newValue: true, createdAt: true },
    })
    const recent = new Map<string, TenantPaidRunAuthorizationReportEntry>()
    for (const row of [...rows].reverse()) {
      if (resetBoundary && row.createdAt < resetBoundary.at) continue
      if (!row.entityId) continue
      const value = record(row.newValue)
      if (row.action === "authorize") {
        recent.set(row.entityId, {
          authorizationId: row.entityId,
          sourceId: text(value.sourceId) ?? row.entityName,
          requestedByUserId: row.userId,
          maxTotalChargeUsd: positive(value.maxTotalChargeUsd) ?? 0,
          policyVersion: typeof value.policyVersion === "number" ? value.policyVersion : null,
          status: "RESERVED",
          collectorRunId: null,
          outcome: null,
          createdAt: row.createdAt,
        })
      } else {
        const item = recent.get(row.entityId)
        if (!item) continue
        if (row.action === "complete") {
          item.collectorRunId = text(value.collectorRunId)
          item.outcome = text(value.outcome)
          item.status = value.providerRequestDispatched === true ? "DISPATCHED" : "RESERVED"
        }
        if (row.action === "release") item.status = "RELEASED"
      }
    }
    return {
      policy,
      usage: currentUsage,
      globalEnforcementEnabled: process.env.SOCIAL_MONITORING_ENFORCE_USD_BUDGETS === "1",
      recentAuthorizations: Array.from(recent.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 50),
    }
  })
}

export async function updateTenantPaidRunPolicy(
  organizationId: string,
  userId: string,
  patch: TenantPaidRunPolicyPatch,
  now = new Date(),
): Promise<TenantPaidRunPolicy> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockPolicyUpdate(tx, organizationId)
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
    if (!organization) throw new Error("organization_not_found")
    const settings = record(organization.settings)
    const cleanSlate = record(settings.socialMonitoringCleanSlate)
    const cleanSlateBlocked = cleanSlate.collectionBlocked === true
    const current = parseTenantPaidRunPolicy(settings)
    const enabling = patch.manualRunsEnabled === true && !current.manualRunsEnabled
    const nextDefaults = patch.routeDefaults === undefined ? current.routeDefaults : patch.routeDefaults
    // Introducing or raising the tenant-wide route default unlocks automatic
    // paid collection across ALL sources — that is a spend-authorization change.
    const raisingDefaults = nextDefaults !== null && (
      current.routeDefaults === null
      || nextDefaults.maxTotalChargeUsd > current.routeDefaults.maxTotalChargeUsd
      || nextDefaults.dailyBudgetUsd > current.routeDefaults.dailyBudgetUsd
      || nextDefaults.monthlyBudgetUsd > current.routeDefaults.monthlyBudgetUsd
    )
    const raisingLimit = (patch.maxPerRunUsd ?? current.maxPerRunUsd) > current.maxPerRunUsd
      || (patch.dailyBudgetUsd ?? current.dailyBudgetUsd) > current.dailyBudgetUsd
      || (patch.monthlyBudgetUsd ?? current.monthlyBudgetUsd) > current.monthlyBudgetUsd
      || (patch.dailyRunQuota ?? current.dailyRunQuota) > current.dailyRunQuota
      || raisingDefaults
    const resuming = current.emergencyStopped
      && patch.emergencyStopped === false
      && (current.manualRunsEnabled || cleanSlateBlocked)
    const authorizationChange = enabling || raisingLimit || resuming
    const next: TenantPaidRunPolicy = {
      ...current,
      ...(patch.manualRunsEnabled !== undefined ? { manualRunsEnabled: patch.manualRunsEnabled } : {}),
      ...(patch.emergencyStopped !== undefined ? { emergencyStopped: patch.emergencyStopped } : {}),
      ...(patch.maxPerRunUsd !== undefined ? { maxPerRunUsd: roundUsd(patch.maxPerRunUsd) } : {}),
      ...(patch.dailyBudgetUsd !== undefined ? { dailyBudgetUsd: roundUsd(patch.dailyBudgetUsd) } : {}),
      ...(patch.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: roundUsd(patch.monthlyBudgetUsd) } : {}),
      ...(patch.dailyRunQuota !== undefined ? { dailyRunQuota: Math.trunc(nonNegative(patch.dailyRunQuota)) } : {}),
      ...(patch.routeDefaults !== undefined
        ? {
            routeDefaults: patch.routeDefaults === null
              ? null
              : {
                  maxTotalChargeUsd: roundUsd(patch.routeDefaults.maxTotalChargeUsd),
                  dailyBudgetUsd: roundUsd(patch.routeDefaults.dailyBudgetUsd),
                  monthlyBudgetUsd: roundUsd(patch.routeDefaults.monthlyBudgetUsd),
                },
          }
        : {}),
      policyVersion: current.policyVersion + 1,
      updatedAt: now.toISOString(),
      updatedBy: userId,
      ...(authorizationChange ? { authorizedAt: now.toISOString(), authorizedBy: userId } : {}),
    }
    if (authorizationChange && patch.authorizationConfirmed !== true) throw new Error("paid_manual_run_authorization_confirmation_required")
    if (next.manualRunsEnabled && next.emergencyStopped) throw new Error("paid_manual_run_emergency_stop_must_be_disabled")
    // A tenant may be governed by USD budgets, a run-count quota, or both. At
    // least one must be configured to enable paid runs.
    const usdConfigured = next.maxPerRunUsd > 0 || next.dailyBudgetUsd > 0 || next.monthlyBudgetUsd > 0
    const quotaConfigured = next.dailyRunQuota >= 1
    if (next.manualRunsEnabled && !usdConfigured && !quotaConfigured) {
      throw new Error("paid_manual_run_limits_required")
    }
    if (usdConfigured) {
      if (next.maxPerRunUsd <= 0 || next.dailyBudgetUsd <= 0 || next.monthlyBudgetUsd <= 0) {
        throw new Error("paid_manual_run_budget_limits_required")
      }
      if (next.maxPerRunUsd > next.dailyBudgetUsd || next.dailyBudgetUsd > next.monthlyBudgetUsd) {
        throw new Error("paid_manual_run_budget_limit_order_invalid")
      }
      if (next.maxPerRunUsd > MAX_TENANT_PAID_RUN_CAP_USD
        || next.dailyBudgetUsd > MAX_TENANT_DAILY_PAID_RUN_BUDGET_USD
        || next.monthlyBudgetUsd > MAX_TENANT_MONTHLY_PAID_RUN_BUDGET_USD) {
        throw new Error("paid_manual_run_budget_limit_too_high")
      }
    }
    if (next.dailyRunQuota > MAX_TENANT_DAILY_RUN_QUOTA) {
      throw new Error("paid_run_daily_quota_too_high")
    }
    if (next.routeDefaults) {
      const d = next.routeDefaults
      if (d.maxTotalChargeUsd <= 0 || d.dailyBudgetUsd <= 0 || d.monthlyBudgetUsd <= 0) {
        throw new Error("paid_route_default_limits_required")
      }
      if (d.maxTotalChargeUsd > d.dailyBudgetUsd || d.dailyBudgetUsd > d.monthlyBudgetUsd) {
        throw new Error("paid_route_default_limit_order_invalid")
      }
      if (d.maxTotalChargeUsd > MAX_TENANT_PAID_RUN_CAP_USD
        || d.dailyBudgetUsd > MAX_TENANT_DAILY_PAID_RUN_BUDGET_USD
        || d.monthlyBudgetUsd > MAX_TENANT_MONTHLY_PAID_RUN_BUDGET_USD) {
        throw new Error("paid_route_default_limit_too_high")
      }
    }
    const resumingCleanSlate = cleanSlateBlocked
      && patch.emergencyStopped === false
      && patch.authorizationConfirmed === true
    await tx.organization.update({
      where: { id: organizationId },
      data: {
        settings: {
          ...settings,
          [SETTINGS_KEY]: next,
          ...(resumingCleanSlate
            ? {
                socialMonitoringCleanSlate: {
                  ...cleanSlate,
                  collectionBlocked: false,
                  resumedAt: now.toISOString(),
                  resumedBy: userId,
                },
              }
            : {}),
        } as Prisma.InputJsonValue,
      },
    })
    await tx.auditLog.create({
      data: {
        organizationId,
        userId,
        action: "update",
        entityType: POLICY_ENTITY,
        entityId: organizationId,
        oldValue: current as unknown as Prisma.InputJsonValue,
        newValue: next as unknown as Prisma.InputJsonValue,
      },
    })
    return next
  }, {
    maxWait: 30_000,
    timeout: 90_000,
  })
}

export async function authorizeTenantManualPaidRun(input: {
  organizationId: string
  sourceId: string
  requestedByUserId: string
  maxTotalChargeUsd: number
  clientFundedManual?: boolean
  now?: Date
}): Promise<TenantPaidRunAuthorizationResult> {
  const cap = positive(input.maxTotalChargeUsd)
  const maximumAllowed = input.clientFundedManual === true
    ? CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD
    : MAX_TENANT_PAID_RUN_CAP_USD
  if (cap === null || cap > maximumAllowed) return { status: "BLOCKED", reason: "paid_manual_run_cap_invalid" }
  if (process.env.SOCIAL_MONITORING_ENFORCE_USD_BUDGETS !== "1") {
    return { status: "BLOCKED", reason: "paid_route_budget_enforcement_disabled" }
  }
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lock(tx, input.organizationId)
    const organization = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { settings: true } })
    const policy = parseTenantPaidRunPolicy(organization?.settings)
    if (input.clientFundedManual === true) {
      if (!policy.clientFundedManualRunsEnabled) {
        return { status: "BLOCKED" as const, reason: "paid_client_funded_manual_not_authorized" as const }
      }
      if (policy.emergencyStopped) {
        return { status: "BLOCKED" as const, reason: "paid_manual_run_emergency_stopped" as const }
      }
      // This path is reachable only from the profile-scoped admin endpoint
      // after an explicit paid-run confirmation. It deliberately ignores the
      // tenant's recurring USD budgets and run-count quota, but keeps a durable
      // authorization audit record and the provider-request fuse.
      const roundedCap = roundUsd(boundedClientFundedManualChargeUsd(cap))
      const authorizationId = crypto.randomUUID()
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.requestedByUserId,
          action: "authorize",
          entityType: AUTH_ENTITY,
          entityId: authorizationId,
          entityName: input.sourceId,
          newValue: {
            sourceId: input.sourceId,
            maxTotalChargeUsd: roundedCap,
            requestedMaxTotalChargeUsd: cap,
            clientFundedManual: true,
            automaticCollectionEnabled: false,
            providerRequestFuseUsd: CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD,
            requestedAt: now.toISOString(),
          },
        },
      })
      return {
        status: "AUTHORIZED" as const,
        authorizationId,
        maxTotalChargeUsd: roundedCap,
        policyVersion: 0,
      }
    }
    if (!policy.manualRunsEnabled || !policy.authorizedAt || !policy.authorizedBy) {
      return { status: "BLOCKED" as const, reason: "paid_manual_runs_not_authorized" as const }
    }
    if (policy.emergencyStopped) return { status: "BLOCKED" as const, reason: "paid_manual_run_emergency_stopped" as const }
    const requestedCap = roundUsd(cap)
    if (requestedCap > policy.maxPerRunUsd) {
      return { status: "BLOCKED" as const, reason: "paid_manual_run_cap_exceeds_tenant_limit" as const }
    }
    const roundedCap = roundUsd(boundedPaidSocialRunChargeUsd(requestedCap))
    const resetBoundary = await latestAuthorizationResetBoundary(tx, input.organizationId)
    const current = await usage(tx, input.organizationId, policy, now, resetBoundary)
    if (
      runQuotaValid(policy)
      && current.runsRemainingToday !== null
      && current.runsRemainingToday <= 0
    ) {
      return { status: "BLOCKED" as const, reason: "paid_run_daily_quota_exhausted" as const }
    }
    const periodLimits = effectivePaidSocialPeriodLimits({
      configuredDailyUsd: policy.dailyBudgetUsd,
      configuredMonthlyUsd: policy.monthlyBudgetUsd,
    })
    if (current.dayReservedUsd + roundedCap > periodLimits.dailyUsd) {
      return { status: "BLOCKED" as const, reason: "paid_route_daily_budget_exhausted" as const }
    }
    if (current.monthReservedUsd + roundedCap > periodLimits.monthlyUsd) {
      return { status: "BLOCKED" as const, reason: "paid_route_monthly_budget_exhausted" as const }
    }
    const authorizationId = crypto.randomUUID()
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.requestedByUserId,
        action: "authorize",
        entityType: AUTH_ENTITY,
        entityId: authorizationId,
        entityName: input.sourceId,
        newValue: {
          sourceId: input.sourceId,
          maxTotalChargeUsd: roundedCap,
          requestedMaxTotalChargeUsd: requestedCap,
          systemHardMaxPerRunUsd: PAID_SOCIAL_HARD_MAX_PER_RUN_USD,
          policyVersion: policy.policyVersion,
          tenantMaxPerRunUsd: policy.maxPerRunUsd,
          tenantDailyBudgetUsd: policy.dailyBudgetUsd,
          tenantMonthlyBudgetUsd: policy.monthlyBudgetUsd,
          dayReservedBeforeUsd: current.dayReservedUsd,
          monthReservedBeforeUsd: current.monthReservedUsd,
          requestedAt: now.toISOString(),
        },
      },
    })
    return { status: "AUTHORIZED" as const, authorizationId, maxTotalChargeUsd: roundedCap, policyVersion: policy.policyVersion }
  })
}

export async function tenantPaidRunEmergencyStopped(organizationId: string): Promise<boolean> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  })
  return parseTenantPaidRunPolicy(organization?.settings).emergencyStopped
}

export async function tenantClientFundedManualRunsEnabled(organizationId: string): Promise<boolean> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  })
  return parseTenantPaidRunPolicy(organization?.settings).clientFundedManualRunsEnabled
}

/**
 * Автосбор Apify, оплачиваемый со счёта тенанта у провайдера.
 *
 * Тенант, который управляет расходом балансом в самом Apify, не задаёт
 * локальных долларовых лимитов — и до сих пор его ночной сбор молча падал на
 * требовании этих лимитов, хотя ручной запуск по той же настройке работал.
 * Возвращаем и признак, и суточную квоту одним запросом: адаптеру нужны оба.
 */
export async function tenantProviderAccountFundedRunPolicy(organizationId: string): Promise<{
  enabled: boolean
  dailyRunQuota: number
}> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  })
  const policy = parseTenantPaidRunPolicy(organization?.settings)
  // Режим снимает суточный и месячный долларовые потолки, поэтому включается
  // ТОЛЬКО когда есть чем ограничить ночь: заданная квота прогонов. Без неё
  // fail-closed — иначе не остаётся ни одного локального ограничения расхода,
  // кроме баланса у провайдера.
  const quotaConfigured = runQuotaValid(policy)
  return {
    // Аварийная остановка сильнее разрешения платить: она обязана гасить
    // автосбор целиком, а не только локально лимитированный.
    enabled: policy.clientFundedManualRunsEnabled
      && !policy.emergencyStopped
      && quotaConfigured,
    dailyRunQuota: quotaConfigured ? policy.dailyRunQuota : 0,
  }
}

export async function finalizeTenantManualPaidRunAuthorization(input: {
  organizationId: string
  authorizationId: string
  requestedByUserId: string
  collectorRunId?: string | null
  outcome: string
  providerRequestDispatched: boolean
  maxTotalChargeUsd: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lock(tx, input.organizationId)
    const completed = await tx.auditLog.findFirst({
      where: { organizationId: input.organizationId, entityType: AUTH_ENTITY, entityId: input.authorizationId, action: "complete" },
      select: { id: true },
    })
    if (completed) return
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.requestedByUserId,
        action: "complete",
        entityType: AUTH_ENTITY,
        entityId: input.authorizationId,
        newValue: {
          collectorRunId: input.collectorRunId ?? null,
          outcome: input.outcome,
          providerRequestDispatched: input.providerRequestDispatched,
          completedAt: now.toISOString(),
        },
      },
    })
    if (!input.providerRequestDispatched) {
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.requestedByUserId,
          action: "release",
          entityType: AUTH_ENTITY,
          entityId: input.authorizationId,
          newValue: {
            releasedChargeUsd: roundUsd(input.maxTotalChargeUsd),
            reason: "provider_request_not_dispatched",
            releasedAt: now.toISOString(),
          },
        },
      })
    }
  })
}
