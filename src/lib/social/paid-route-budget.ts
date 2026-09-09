import crypto from "crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { ROUTE_ADAPTERS } from "@/lib/social/source-route-plan"
import { PAID_RUN_PHASE, parseTenantPaidRunPolicy, runQuotaValid } from "@/lib/social/paid-run-authorization"
import { brightDataPriceSnapshotFromEnv } from "@/lib/social/bright-data-budget-cap"
import {
  boundedClientFundedManualChargeUsd,
  boundedPaidSocialRunChargeUsd,
  CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD,
  effectivePaidSocialPeriodLimits,
  PAID_SOCIAL_HARD_DAILY_BUDGET_USD,
  PAID_SOCIAL_HARD_MAX_PER_RUN_USD,
  PAID_SOCIAL_HARD_MONTHLY_BUDGET_USD,
} from "@/lib/social/provider-spend-limits"
import {
  standardPaidProviderChargeTotalUsd,
  standardPaidProviderCollectorRunIdsSince,
} from "@/lib/social/paid-provider-run-scope"

const GUARDED_ADAPTERS = new Set<string>([
  ROUTE_ADAPTERS.X_API,
  ROUTE_ADAPTERS.TIKTOK_BUSINESS_API,
  ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT,
])
const STALE_PAID_ROUTE_HANDOFF_MS = 20 * 60_000

type PaidRouteBudgetInput = {
  organizationId: string
  sourceId: string
  routePlanId: string
  collectorRunId: string
  adapterKey: string
  providerKey?: string | null
  budget: unknown
  maxItems: number
  timeoutSeconds: number
  manualMaxTotalChargeUsd?: number
  clientFundedManual?: boolean
  targetScenarioId?: string
  targetSubjectId?: string
  now?: Date
}

export type PaidRouteBudgetReservation =
  | { status: "NOT_REQUIRED" }
  | { status: "BLOCKED"; reason: "paid_route_budget_enforcement_disabled" | "paid_route_budget_unconfigured" | "paid_manual_run_cap_invalid" | "paid_client_funded_manual_not_authorized" | "paid_route_daily_budget_exhausted" | "paid_route_monthly_budget_exhausted" | "paid_run_daily_quota_exhausted" | "paid_run_emergency_stopped" | "paid_route_already_attempted" }
  | { status: "RESERVED"; providerRunId: string; reservedChargeUsd: number }

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function inputJsonRecord(value: unknown): Prisma.InputJsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Prisma.InputJsonObject
    : {}
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function utcPeriodStarts(now: Date) {
  return {
    day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  }
}

export function requiresPaidRouteBudget(adapterKey: string): boolean {
  return GUARDED_ADAPTERS.has(adapterKey)
}

/**
 * Bright Data is billed and hard-limited by the customer's provider account.
 * LeadDrive still creates an idempotent provider-run ledger and honours the
 * emergency stop, but it must not truncate coverage with a second local USD or
 * run-count budget.
 */
export function usesProviderAccountBudget(adapterKey: string): boolean {
  return adapterKey === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT
}

/**
 * Atomically records a potentially paid route before dispatch. X/TikTok routes
 * still require LeadDrive USD/quota authorization. Bright Data is audited and
 * idempotent here but uses the customer's provider-account billing boundary,
 * so local USD/run quotas cannot truncate its coverage.
 */
export async function reservePaidRouteBudget(input: PaidRouteBudgetInput): Promise<PaidRouteBudgetReservation> {
  if (!requiresPaidRouteBudget(input.adapterKey)) return { status: "NOT_REQUIRED" }
  const providerAccountBudget = usesProviderAccountBudget(input.adapterKey)
  const manualRun = input.manualMaxTotalChargeUsd !== undefined || input.clientFundedManual === true
  const clientFundedManual = manualRun && input.clientFundedManual === true
  const manualRunCharge = manualRun ? positiveNumber(input.manualMaxTotalChargeUsd) : null
  if (manualRun && manualRunCharge === null && !providerAccountBudget) {
    return { status: "BLOCKED", reason: "paid_manual_run_cap_invalid" }
  }
  if (!providerAccountBudget && process.env.SOCIAL_MONITORING_ENFORCE_USD_BUDGETS !== "1") {
    return { status: "BLOCKED", reason: "paid_route_budget_enforcement_disabled" }
  }

  const budget = record(input.budget)
  const configuredRunCharge = positiveNumber(budget.maxTotalChargeUsd)
  const dailyLimit = positiveNumber(budget.dailyBudgetUsd)
  const monthlyLimit = positiveNumber(budget.monthlyBudgetUsd)
  const ownerLimitsConfigured = budget.usdLimitsConfigured === true
    && configuredRunCharge !== null
    && dailyLimit !== null
    && monthlyLimit !== null
  const requestedRunCharge = providerAccountBudget
    ? 0
    : manualRun
    ? clientFundedManual
      ? manualRunCharge ?? 0
      : Math.min(manualRunCharge ?? 0, ownerLimitsConfigured ? configuredRunCharge ?? manualRunCharge ?? 0 : manualRunCharge ?? 0)
    : configuredRunCharge ?? 0
  const runCharge = providerAccountBudget
    ? 0
    : clientFundedManual
    ? boundedClientFundedManualChargeUsd(requestedRunCharge)
    : boundedPaidSocialRunChargeUsd(requestedRunCharge)
  const periodLimits = effectivePaidSocialPeriodLimits({
    configuredDailyUsd: ownerLimitsConfigured ? dailyLimit : null,
    configuredMonthlyUsd: ownerLimitsConfigured ? monthlyLimit : null,
  })

  const now = input.now ?? new Date()
  const starts = utcPeriodStarts(now)
  const providerKey = input.providerKey?.trim() || input.adapterKey
  const idempotencyKey = `paid-route:${input.collectorRunId}:${input.routePlanId}:${input.adapterKey}`.slice(0, 500)

  // A paid run may be governed by USD budgets, a per-day run-count quota, or
  // both. Read the tenant quota so a quota-only tenant runs without any USD
  // budget while still being bounded per day; an auto run with neither USD nor
  // quota is unconfigured and fails closed before opening a transaction.
  const tenantPolicy = parseTenantPaidRunPolicy(
    (await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { settings: true } }))?.settings,
  )
  const quota = runQuotaValid(tenantPolicy) ? tenantPolicy.dailyRunQuota : 0
  if (clientFundedManual && !tenantPolicy.clientFundedManualRunsEnabled) {
    return { status: "BLOCKED", reason: "paid_client_funded_manual_not_authorized" }
  }
  if ((clientFundedManual || providerAccountBudget) && tenantPolicy.emergencyStopped) {
    return { status: "BLOCKED", reason: "paid_run_emergency_stopped" }
  }
  // Emergency stop is the kill switch for quota-governed paid runs (automatic or
  // manual). USD-governed runs keep their existing gates.
  if (quota > 0 && tenantPolicy.emergencyStopped) {
    return { status: "BLOCKED", reason: "paid_run_emergency_stopped" }
  }
  if (!providerAccountBudget && !ownerLimitsConfigured && quota <= 0 && !manualRun) {
    return { status: "BLOCKED", reason: "paid_route_budget_unconfigured" }
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Serialize reservations per tenant/provider so concurrent collectors
    // cannot both observe the same remaining budget and overspend it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:paid-social-spend`}, 0))`

    // The reset boundary acquires the same lock before enabling the tenant
    // emergency stop. Re-read inside this transaction after the lock so a
    // reservation that was waiting behind the reset cannot dispatch using the
    // stale policy snapshot read above.
    const lockedOrganization = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { settings: true },
    })
    if (parseTenantPaidRunPolicy(lockedOrganization?.settings).emergencyStopped) {
      return { status: "BLOCKED" as const, reason: "paid_run_emergency_stopped" as const }
    }

    // A process can die after reserving capacity but before it enters the
    // tenant dispatch fence. Once the 15-minute collector lease plus a small
    // handoff margin has elapsed, an exact QUEUED/false marker proves there was
    // no provider I/O and the stranded reservation can be released safely.
    const staleHandoffBefore = new Date(now.getTime() - STALE_PAID_ROUTE_HANDOFF_MS)
    await tx.$executeRaw`
      UPDATE "social_provider_runs"
      SET
        "status" = 'BLOCKED',
        "reservedChargeUsd" = 0,
        "actualChargeUsd" = 0,
        "lastError" = 'paid_route_dispatch_handoff_expired',
        "finishedAt" = ${now},
        "updatedAt" = ${now}
      WHERE "organizationId" = ${input.organizationId}
        AND "externalRunId" IS NULL
        AND COALESCE("actualChargeUsd", 0) <= 0
        AND "adapterKey" IN (
          ${ROUTE_ADAPTERS.X_API},
          ${ROUTE_ADAPTERS.TIKTOK_BUSINESS_API},
          ${ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT}
        )
        AND "status" = 'QUEUED'
        AND "updatedAt" <= ${staleHandoffBefore}
        AND COALESCE("inputSnapshot", '{}'::jsonb)
          @> '{"providerRequestDispatched": false}'::jsonb
    `

    const prior = await tx.socialProviderRun.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey,
        },
      },
      select: { id: true },
    })
    if (prior) return { status: "BLOCKED" as const, reason: "paid_route_already_attempted" as const }

    // Recurring automatic and capped manual routes share the tenant ceiling
    // across providers. Explicit client-funded profile runs are audited under
    // their own provider-request fuse and do not consume this recurring pool.
    if (!providerAccountBudget && runCharge > 0 && !clientFundedManual) {
      const [day, month] = await Promise.all([
        standardPaidProviderChargeTotalUsd(tx, {
          organizationId: input.organizationId,
          since: starts.day,
          excludePreDispatch: true,
        }),
        standardPaidProviderChargeTotalUsd(tx, {
          organizationId: input.organizationId,
          since: starts.month,
          excludePreDispatch: true,
        }),
      ])

      if (day + runCharge > periodLimits.dailyUsd) {
        return { status: "BLOCKED" as const, reason: "paid_route_daily_budget_exhausted" as const }
      }
      if (month + runCharge > periodLimits.monthlyUsd) {
        return { status: "BLOCKED" as const, reason: "paid_route_monthly_budget_exhausted" as const }
      }
    }

    // Automatic and ordinary capped manual runs share the daily run-count
    // quota. An explicitly confirmed client-funded profile run is outside that
    // recurring quota; its provider calls remain bounded by the per-request
    // emergency fuse and are still durably audited.
    if (!providerAccountBudget && quota > 0 && !clientFundedManual) {
      const paidRunsToday = await standardPaidProviderCollectorRunIdsSince(tx, {
        organizationId: input.organizationId,
        since: starts.day,
        phase: PAID_RUN_PHASE,
        // Operational rows are cleared by clean-slate, but the latest hidden
        // reset audit carries the already-consumed quota for this UTC day.
        includeResetCarry: true,
      })
      const distinctRunIds = new Set(paidRunsToday)
      if (!distinctRunIds.has(input.collectorRunId) && distinctRunIds.size >= quota) {
        return { status: "BLOCKED" as const, reason: "paid_run_daily_quota_exhausted" as const }
      }
    }

    const reservedChargeUsd = runCharge
    const run = await tx.socialProviderRun.create({
      data: {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        routePlanId: input.routePlanId,
        collectorRunId: input.collectorRunId,
        providerKey,
        adapterKey: input.adapterKey,
        phase: "PAID_ROUTE_COLLECTION",
        schemaVersion: providerAccountBudget
          ? "paid-route-provider-account-v1"
          : clientFundedManual
          ? "paid-route-client-funded-manual-v1"
          : manualRun
            ? "paid-route-manual-capped-v3"
            : "paid-route-budget-v2",
        // Every guarded provider stays explicitly QUEUED until its dispatch
        // path owns the tenant reset fence. Bright Data claims this state from
        // inside its own import fence; X/TikTok claim it in the collector.
        status: "QUEUED",
        idempotencyKey,
        inputHash: crypto.createHash("sha256").update(idempotencyKey).digest("hex"),
        inputSnapshot: {
          budgetConfiguredByOwner: ownerLimitsConfigured,
          providerAccountBudget,
          manualRun,
          clientFundedManual,
          operatorAuthorizedMaxTotalChargeUsd: manualRun ? manualRunCharge : null,
          requestedRunChargeUsd: requestedRunCharge,
          hardMaxPerRunUsd: providerAccountBudget
            ? null
            : clientFundedManual
            ? CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD
            : PAID_SOCIAL_HARD_MAX_PER_RUN_USD,
          hardDailyBudgetUsd: clientFundedManual || providerAccountBudget ? null : PAID_SOCIAL_HARD_DAILY_BUDGET_USD,
          hardMonthlyBudgetUsd: clientFundedManual || providerAccountBudget ? null : PAID_SOCIAL_HARD_MONTHLY_BUDGET_USD,
          providerRequestDispatched: false,
          maxItems: input.maxItems,
          timeoutSeconds: input.timeoutSeconds,
          ...(input.targetScenarioId ? { targetScenarioId: input.targetScenarioId } : {}),
          ...(input.targetSubjectId ? { targetSubjectId: input.targetSubjectId } : {}),
        },
        reservedChargeUsd,
        maxTotalChargeUsd: reservedChargeUsd,
        dailyBudgetUsd: clientFundedManual || providerAccountBudget ? null : periodLimits.dailyUsd,
        monthlyBudgetUsd: clientFundedManual || providerAccountBudget ? null : periodLimits.monthlyUsd,
        maxItems: input.maxItems,
        timeoutSeconds: input.timeoutSeconds,
        startedAt: null,
        purgeAt: new Date(now.getTime() + 30 * 86_400_000),
      },
      select: { id: true },
    })
    return { status: "RESERVED" as const, providerRunId: run.id, reservedChargeUsd }
  })
}

/**
 * Claims a paid reservation immediately before provider I/O.
 *
 * Callers must hold the tenant collection/reset fence while this transition,
 * the adapter call, and final settlement execute. The durable marker lets
 * budget and reset accounting distinguish a true pre-dispatch outcome from a
 * quiesced request whose remote outcome is unknown.
 */
export async function beginPaidRouteBudgetDispatch(
  organizationId: string,
  providerRunId: string,
): Promise<boolean> {
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
    WHERE "id" = ${providerRunId}
      AND "organizationId" = ${organizationId}
      AND "purgedAt" IS NULL
      AND "externalRunId" IS NULL
      AND COALESCE("actualChargeUsd", 0) <= 0
      AND "adapterKey" IN (
        ${ROUTE_ADAPTERS.X_API},
        ${ROUTE_ADAPTERS.TIKTOK_BUSINESS_API},
        ${ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT}
      )
      AND "status" = 'QUEUED'
      AND COALESCE("inputSnapshot", '{}'::jsonb)
        @> '{"providerRequestDispatched": false}'::jsonb
  `
  return changed === 1
}

export async function finishPaidRouteBudgetReservation(
  organizationId: string,
  providerRunId: string,
  result: { status: string; foundCount: number; newCount: number; duplicateCount: number; ignoredCount: number; error?: string | null; rawStats?: Record<string, unknown> },
) {
  // A manual Bright Data request returns after recording its durable snapshot
  // id. Reconciliation must retain ownership of the RUNNING ledger row and the
  // full reservation until it downloads/imports the provider result.
  if (result.rawStats?.asyncPending === true) return

  // A timeout/network failure after dispatch can leave remote billing or quota
  // consumption unknown. Never mark that ledger row successful merely because
  // the adapter managed to persist a partial page before transport failed.
  const dispatchUnknown = result.rawStats?.dispatchUnknown === true
  const successful = !dispatchUnknown && (result.status === "success" || result.status === "partial")
  const providerRequestDispatched = dispatchUnknown
    ? true
    : result.rawStats?.providerRequestDispatched !== false
  const blockedBeforeDispatch = result.status === "skipped" && !providerRequestDispatched

  const run = await prisma.socialProviderRun.findFirst({
    where: { id: providerRunId, organizationId },
    select: { adapterKey: true, reservedChargeUsd: true, inputSnapshot: true },
  })

  // Bright Data's ledger keeps an estimated record-based reservation for cost
  // visibility. The provider account remains authoritative; this estimate is
  // not a local dispatch limit and the webhook can reconcile the exact actual.
  let reservedRelease: { reservedChargeUsd?: number } = {}
  if (providerRequestDispatched && !dispatchUnknown) {
    const price = run?.adapterKey === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT
      ? brightDataPriceSnapshotFromEnv()
      : { status: "BLOCKED" as const, reason: "bright_data_price_snapshot_unconfigured" as const }
    if (price.status === "READY") {
      const records = Math.max(0, Math.trunc(result.foundCount))
      const estimate = roundUsd((records * price.snapshot.usdPerThousandRecords) / 1000)
      const currentReserved = Number(run?.reservedChargeUsd ?? 0)
      reservedRelease = { reservedChargeUsd: Math.min(currentReserved, estimate) }
    }
  }

  if (!run) throw new Error("paid_route_budget_reservation_missing")
  // Bright Data snapshots remain remotely recoverable after a local
  // poll/download/import timeout. Keep the ledger active with its full
  // reservation so the GET-only reconciliation worker can resume it and a
  // concurrent clean-slate reset can still quiesce the remote snapshot.
  const brightDataRecoveryPending =
    run.adapterKey === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT
    && dispatchUnknown

  const finished = await prisma.socialProviderRun.updateMany({
    where: {
      id: providerRunId,
      organizationId,
      status: { in: ["QUEUED", "RUNNING"] },
      ...(!providerRequestDispatched
        ? {
            externalRunId: null,
            OR: [
              { actualChargeUsd: null },
              { actualChargeUsd: { lte: 0 } },
            ],
          }
        : {}),
    },
    data: {
      status: brightDataRecoveryPending
        ? "RUNNING"
        : blockedBeforeDispatch
          ? "BLOCKED"
          : successful
            ? "SUCCEEDED"
            : "FAILED",
      receivedCount: result.foundCount,
      acceptedCount: result.newCount,
      duplicateCount: result.duplicateCount,
      rejectedCount: result.ignoredCount,
      lastError: result.error ?? null,
      finishedAt: brightDataRecoveryPending ? null : new Date(),
      inputSnapshot: {
        ...inputJsonRecord(run.inputSnapshot),
        providerRequestDispatched,
      },
      // No provider I/O means no exposure. A dispatched Bright Data run releases
      // its idle over-reservation down to the record-based estimate (above).
      ...(!providerRequestDispatched ? { actualChargeUsd: 0, reservedChargeUsd: 0 } : reservedRelease),
    },
  })
  if (
    (run.adapterKey === ROUTE_ADAPTERS.X_API || run.adapterKey === ROUTE_ADAPTERS.TIKTOK_BUSINESS_API)
    && finished.count !== 1
  ) {
    throw new Error("paid_route_budget_settlement_state_changed")
  }
}
