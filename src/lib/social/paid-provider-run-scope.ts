import { Prisma } from "@prisma/client"

type RawQueryClient = Pick<Prisma.TransactionClient, "$queryRaw">

type ChargeTotalRow = {
  reservedChargeUsd: unknown
  actualChargeUsd: unknown
  resetNewValue?: unknown
  resetCreatedAt?: Date | string | null
}

type CollectorRunRow = {
  collectorRunId: string | null
  resetNewValue?: unknown
  resetCreatedAt?: Date | string | null
}

type ResetBoundaryRow = {
  resetNewValue: unknown
  resetCreatedAt: Date | string
}

export type MonitoringResetBudgetCarryForward = {
  schemaVersion: "social-monitoring-budget-carry-v1"
  capturedAt: Date
  utcDayStart: Date
  utcMonthStart: Date
  provider: {
    dayChargeUsd: number
    monthChargeUsd: number
    runsToday: number
  }
  paidRunAuthorization: {
    dayReservedUsd: number
    monthReservedUsd: number
    runsToday: number
  }
  media: {
    dayCostUsd: number
    monthCostUsd: number
  }
  ai: {
    dayCostUsd: number
    monthCostUsd: number
  }
}

const PRE_DISPATCH_ERRORS = [
  "bright_data_parent_targets_missing",
  "bright_data_discovery_input_missing",
]

const RESET_AUDIT_ENTITY = "social_paid_run_authorization"
const RESET_AUDIT_ACTION = "reset_boundary"
const RESET_AUDIT_ENTITY_NAME = "Social Monitoring clean slate"
const RESET_AUDIT_ENTITY_ID_PREFIX = "clean-slate:"
const RESET_CARRY_SCHEMA_VERSION = "social-monitoring-budget-carry-v1"

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function strictNonNegative(value: unknown, path: string): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`social_monitoring_reset_budget_carry_invalid:${path}`)
  }
  return parsed
}

function strictCount(value: unknown, path: string): number {
  const parsed = strictNonNegative(value, path)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`social_monitoring_reset_budget_carry_invalid:${path}`)
  }
  return parsed
}

function strictDate(value: unknown, path: string): Date {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`social_monitoring_reset_budget_carry_invalid:${path}`)
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`social_monitoring_reset_budget_carry_invalid:${path}`)
  }
  return parsed
}

function utcDayStart(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ))
}

function utcMonthStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1))
}

/**
 * Parse the cumulative, hidden enforcement snapshot written by a clean-slate
 * reset. Legacy reset boundaries have no carry block and intentionally return
 * null. Once the versioned block exists, malformed values fail closed instead
 * of silently reopening paid budgets after operational rows are removed.
 */
export function parseMonitoringResetBudgetCarryForward(
  newValue: unknown,
): MonitoringResetBudgetCarryForward | null {
  const carryValue = record(newValue).budgetCarryForward
  if (carryValue === undefined || carryValue === null) return null
  const carry = record(carryValue)
  if (carry.schemaVersion !== RESET_CARRY_SCHEMA_VERSION) {
    throw new Error("social_monitoring_reset_budget_carry_invalid:schemaVersion")
  }
  const capturedAt = strictDate(carry.capturedAt, "capturedAt")
  const dayStart = strictDate(carry.utcDayStart, "utcDayStart")
  const monthStart = strictDate(carry.utcMonthStart, "utcMonthStart")
  if (dayStart.getTime() !== utcDayStart(capturedAt).getTime()) {
    throw new Error("social_monitoring_reset_budget_carry_invalid:utcDayStart")
  }
  if (monthStart.getTime() !== utcMonthStart(capturedAt).getTime()) {
    throw new Error("social_monitoring_reset_budget_carry_invalid:utcMonthStart")
  }
  const provider = record(carry.provider)
  const paidRunAuthorization = record(carry.paidRunAuthorization)
  const media = record(carry.media)
  const ai = record(carry.ai)
  const parsed: MonitoringResetBudgetCarryForward = {
    schemaVersion: RESET_CARRY_SCHEMA_VERSION,
    capturedAt,
    utcDayStart: dayStart,
    utcMonthStart: monthStart,
    provider: {
      dayChargeUsd: strictNonNegative(provider.dayChargeUsd, "provider.dayChargeUsd"),
      monthChargeUsd: strictNonNegative(provider.monthChargeUsd, "provider.monthChargeUsd"),
      runsToday: strictCount(provider.runsToday, "provider.runsToday"),
    },
    paidRunAuthorization: {
      dayReservedUsd: strictNonNegative(
        paidRunAuthorization.dayReservedUsd,
        "paidRunAuthorization.dayReservedUsd",
      ),
      monthReservedUsd: strictNonNegative(
        paidRunAuthorization.monthReservedUsd,
        "paidRunAuthorization.monthReservedUsd",
      ),
      runsToday: strictCount(
        paidRunAuthorization.runsToday,
        "paidRunAuthorization.runsToday",
      ),
    },
    media: {
      dayCostUsd: strictNonNegative(media.dayCostUsd, "media.dayCostUsd"),
      monthCostUsd: strictNonNegative(media.monthCostUsd, "media.monthCostUsd"),
    },
    ai: {
      dayCostUsd: strictNonNegative(ai.dayCostUsd, "ai.dayCostUsd"),
      monthCostUsd: strictNonNegative(ai.monthCostUsd, "ai.monthCostUsd"),
    },
  }
  if (parsed.provider.monthChargeUsd < parsed.provider.dayChargeUsd) {
    throw new Error("social_monitoring_reset_budget_carry_invalid:provider.monthChargeUsd")
  }
  if (
    parsed.paidRunAuthorization.monthReservedUsd
    < parsed.paidRunAuthorization.dayReservedUsd
  ) {
    throw new Error(
      "social_monitoring_reset_budget_carry_invalid:paidRunAuthorization.monthReservedUsd",
    )
  }
  if (parsed.media.monthCostUsd < parsed.media.dayCostUsd) {
    throw new Error("social_monitoring_reset_budget_carry_invalid:media.monthCostUsd")
  }
  if (parsed.ai.monthCostUsd < parsed.ai.dayCostUsd) {
    throw new Error("social_monitoring_reset_budget_carry_invalid:ai.monthCostUsd")
  }
  return parsed
}

export function monitoringResetProviderChargeCarrySince(
  carry: MonitoringResetBudgetCarryForward | null,
  since: Date,
): number {
  if (!carry || since.getTime() > carry.capturedAt.getTime()) return 0
  if (since.getTime() === carry.utcDayStart.getTime()) {
    return carry.provider.dayChargeUsd
  }
  if (since.getTime() === carry.utcMonthStart.getTime()) {
    return carry.provider.monthChargeUsd
  }
  return 0
}

export function monitoringResetProviderRunCarrySince(
  carry: MonitoringResetBudgetCarryForward | null,
  since: Date,
): number {
  if (
    !carry
    || since.getTime() > carry.capturedAt.getTime()
    || since.getTime() !== carry.utcDayStart.getTime()
  ) {
    return 0
  }
  return carry.provider.runsToday
}

export function monitoringResetAiCostCarrySince(
  carry: MonitoringResetBudgetCarryForward | null,
  since: Date,
): number {
  if (!carry || since.getTime() > carry.capturedAt.getTime()) return 0
  if (since.getTime() === carry.utcDayStart.getTime()) {
    return carry.ai.dayCostUsd
  }
  if (since.getTime() === carry.utcMonthStart.getTime()) {
    return carry.ai.monthCostUsd
  }
  return 0
}

function resetCarryFromRow(
  row: Pick<ChargeTotalRow, "resetNewValue" | "resetCreatedAt"> | undefined,
): MonitoringResetBudgetCarryForward | null {
  if (!row?.resetCreatedAt) return null
  return parseMonitoringResetBudgetCarryForward(row.resetNewValue)
}

export async function latestMonitoringResetBudgetCarryForward(
  client: RawQueryClient,
  organizationId: string,
): Promise<MonitoringResetBudgetCarryForward | null> {
  const rows = await client.$queryRaw<ResetBoundaryRow[]>(Prisma.sql`
    SELECT
      "newValue" AS "resetNewValue",
      "createdAt" AS "resetCreatedAt"
    FROM "audit_logs"
    WHERE "organizationId" = ${organizationId}
      AND "entityType" = ${RESET_AUDIT_ENTITY}
      AND action = ${RESET_AUDIT_ACTION}
      AND "userId" IS NULL
      AND "entityName" = ${RESET_AUDIT_ENTITY_NAME}
      AND "entityId" LIKE ${`${RESET_AUDIT_ENTITY_ID_PREFIX}%`}
    ORDER BY "createdAt" DESC, id DESC
    LIMIT 1
  `)
  return resetCarryFromRow(rows[0])
}

/**
 * Client-funded runs are tagged inside inputSnapshot so they remain visible in
 * the shared provider ledger. Prisma's JSON-path filters cannot distinguish a
 * missing nested key from SQL NULL reliably, so use an explicit PostgreSQL
 * COALESCE predicate. This keeps legacy rows with `{}` in the standard pool and
 * excludes only rows whose marker is exactly true.
 */
const STANDARD_RUN_PREDICATE = Prisma.sql`
  COALESCE("inputSnapshot"->>'clientFundedManual', 'false') <> 'true'
  AND COALESCE("inputSnapshot"->>'leadDriveClientFundedManual', 'false') <> 'true'
  AND COALESCE("inputSnapshot"->>'leadDriveProviderAccountFunded', 'false') <> 'true'
`

// Тот же охват, но БЕЗ исключения автосбора со счёта провайдера. Нужен его
// собственной суточной квоте: считать себя по общему учёту она не может —
// оттуда такие прогоны исключены, чтобы не глушить чужие платные пути, и
// квота получилась бы декоративной.
const PROVIDER_ACCOUNT_RUN_PREDICATE = Prisma.sql`
  COALESCE("inputSnapshot"->>'clientFundedManual', 'false') <> 'true'
  AND COALESCE("inputSnapshot"->>'leadDriveClientFundedManual', 'false') <> 'true'
`

const PRE_DISPATCH_EXCLUSION = Prisma.sql`
  AND NOT (
    "externalRunId" IS NULL
    AND COALESCE("actualChargeUsd", 0) <= 0
    AND (
      (
        "adapterKey" IN ('X_API', 'TIKTOK_BUSINESS_API', 'BRIGHT_DATA_SNAPSHOT')
        AND
        COALESCE("inputSnapshot", '{}'::jsonb)
          @> '{"providerRequestDispatched": false}'::jsonb
        AND "status" IN ('SUCCEEDED', 'FAILED', 'BLOCKED', 'PARTIAL', 'IMPORTED', 'PURGED')
      )
      OR (
        "phase" = 'PAID_ROUTE_COLLECTION'
        AND NOT COALESCE("inputSnapshot", '{}'::jsonb)
          @> '{"providerRequestDispatched": true}'::jsonb
        AND NOT COALESCE("inputSnapshot", '{}'::jsonb)
          @> '{"providerRequestDispatched": false}'::jsonb
        AND COALESCE("lastError" IN (${Prisma.join(PRE_DISPATCH_ERRORS)}), FALSE)
      )
    )
  )
`

export async function standardPaidProviderChargeTotalUsd(
  client: RawQueryClient,
  input: {
    organizationId: string
    since: Date
    excludePreDispatch?: boolean
  },
): Promise<number> {
  const rows = await client.$queryRaw<ChargeTotalRow[]>(Prisma.sql`
    WITH latest_reset AS (
      SELECT "newValue", "createdAt"
      FROM "audit_logs"
      WHERE "organizationId" = ${input.organizationId}
        AND "entityType" = ${RESET_AUDIT_ENTITY}
        AND action = ${RESET_AUDIT_ACTION}
        AND "userId" IS NULL
        AND "entityName" = ${RESET_AUDIT_ENTITY_NAME}
        AND "entityId" LIKE ${`${RESET_AUDIT_ENTITY_ID_PREFIX}%`}
      ORDER BY "createdAt" DESC, id DESC
      LIMIT 1
    )
    SELECT
      COALESCE(SUM("reservedChargeUsd"), 0) AS "reservedChargeUsd",
      COALESCE(SUM("actualChargeUsd"), 0) AS "actualChargeUsd",
      (SELECT "newValue" FROM latest_reset) AS "resetNewValue",
      (SELECT "createdAt" FROM latest_reset) AS "resetCreatedAt"
    FROM "social_provider_runs"
    WHERE "organizationId" = ${input.organizationId}
      AND "createdAt" >= ${input.since}
      AND "purgedAt" IS NULL
      AND ${STANDARD_RUN_PREDICATE}
      ${input.excludePreDispatch ? PRE_DISPATCH_EXCLUSION : Prisma.empty}
  `)
  const row = rows[0]
  const live = numeric(row?.reservedChargeUsd) + numeric(row?.actualChargeUsd)
  const carry = monitoringResetProviderChargeCarrySince(
    resetCarryFromRow(row),
    input.since,
  )
  return live + carry
}

export async function standardPaidProviderCollectorRunIdsSince(
  client: RawQueryClient,
  input: {
    organizationId: string
    since: Date
    phase: string
    includeResetCarry?: boolean
    /** Считать и прогоны автосбора со счёта провайдера (для его квоты). */
    includeProviderAccountFunded?: boolean
  },
): Promise<string[]> {
  const rows = await client.$queryRaw<CollectorRunRow[]>(Prisma.sql`
    WITH latest_reset AS (
      SELECT "newValue", "createdAt"
      FROM "audit_logs"
      WHERE "organizationId" = ${input.organizationId}
        AND "entityType" = ${RESET_AUDIT_ENTITY}
        AND action = ${RESET_AUDIT_ACTION}
        AND "userId" IS NULL
        AND "entityName" = ${RESET_AUDIT_ENTITY_NAME}
        AND "entityId" LIKE ${`${RESET_AUDIT_ENTITY_ID_PREFIX}%`}
      ORDER BY "createdAt" DESC, id DESC
      LIMIT 1
    ),
    live_runs AS (
      SELECT DISTINCT "collectorRunId"
      FROM "social_provider_runs"
      WHERE "organizationId" = ${input.organizationId}
        AND "phase" = ${input.phase}
        AND "createdAt" >= ${input.since}
        AND "purgedAt" IS NULL
        AND "collectorRunId" IS NOT NULL
        AND ${input.includeProviderAccountFunded ? PROVIDER_ACCOUNT_RUN_PREDICATE : STANDARD_RUN_PREDICATE}
        ${PRE_DISPATCH_EXCLUSION}
    )
    SELECT
      "collectorRunId",
      NULL::jsonb AS "resetNewValue",
      NULL::timestamptz AS "resetCreatedAt"
    FROM live_runs
    UNION ALL
    SELECT
      NULL::text AS "collectorRunId",
      "newValue" AS "resetNewValue",
      "createdAt" AS "resetCreatedAt"
    FROM latest_reset
  `)
  const live = rows.flatMap(row => row.collectorRunId ? [row.collectorRunId] : [])
  if (input.includeResetCarry === false) return live
  const resetRow = rows.find(row => row.resetCreatedAt)
  const carryCount = monitoringResetProviderRunCarrySince(
    resetCarryFromRow(resetRow),
    input.since,
  )
  return [
    ...live,
    ...Array.from(
      { length: carryCount },
      (_, index) => `__reset_budget_carry__:${index}`,
    ),
  ]
}
