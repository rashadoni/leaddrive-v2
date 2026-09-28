export const WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_VERSION = "v1" as const

export type WorkforceExceptionResponseCycleAuditStatus =
  | "NO_NON_NULL_DUPLICATES_AT_SNAPSHOT"
  | "DUPLICATE_CYCLES_DETECTED"

export type WorkforceExceptionResponseCycleAuditResult = {
  mode: "DRY_RUN"
  status: WorkforceExceptionResponseCycleAuditStatus
  observedAt: string
  duplicateCycleGroups: number
  duplicateResponseRows: number
  excessResponseRows: number
  legacyNullRevisionRows: number
  automaticAction: "NONE"
  uniquenessMigrationAuthorized: false
  version: typeof WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_VERSION
}

type QuerySqlTag = <T>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T>

type WorkforceExceptionResponseCycleAuditTransaction = {
  $queryRaw: QuerySqlTag
}

export type WorkforceExceptionResponseCycleAuditDb = {
  $transaction: <T>(
    action: (tx: WorkforceExceptionResponseCycleAuditTransaction) => Promise<T>,
    options: {
      isolationLevel: "RepeatableRead"
      maxWait: number
      timeout: number
    },
  ) => Promise<T>
}

type AggregateRow = {
  observedAt: Date | string
  duplicateCycleGroups: bigint | number | string
  duplicateResponseRows: bigint | number | string
  excessResponseRows: bigint | number | string
  legacyNullRevisionRows: bigint | number | string
}

function validatedOrganizationId(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized !== value || normalized.length > 191) {
    throw new RangeError("organizationId is invalid")
  }
  return value
}

function safeCount(value: bigint | number | string, field: string): number {
  let count: bigint
  if (typeof value === "bigint") {
    count = value
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${field} is invalid`)
    count = BigInt(value)
  } else if (/^\d+$/.test(value)) {
    count = BigInt(value)
  } else {
    throw new RangeError(`${field} is invalid`)
  }
  if (count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} is invalid`)
  }
  return Number(count)
}

function observedAtIso(value: Date | string): string {
  const observedAt = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(observedAt.getTime())) {
    throw new RangeError("observedAt is invalid")
  }
  return observedAt.toISOString()
}

function resultFromRow(row: AggregateRow): WorkforceExceptionResponseCycleAuditResult {
  const duplicateCycleGroups = safeCount(row.duplicateCycleGroups, "duplicateCycleGroups")
  const duplicateResponseRows = safeCount(row.duplicateResponseRows, "duplicateResponseRows")
  const excessResponseRows = safeCount(row.excessResponseRows, "excessResponseRows")
  const legacyNullRevisionRows = safeCount(row.legacyNullRevisionRows, "legacyNullRevisionRows")

  // Every duplicate group has at least two rows and contributes exactly one
  // fewer excess row than its total. Reject a malformed aggregate rather than
  // publishing a misleading all-clear or migration signal.
  if ((duplicateCycleGroups === 0
      && (duplicateResponseRows !== 0 || excessResponseRows !== 0))
    || duplicateCycleGroups > Math.floor(duplicateResponseRows / 2)
    || excessResponseRows !== duplicateResponseRows - duplicateCycleGroups) {
    throw new RangeError("exception response cycle aggregate is inconsistent")
  }

  return {
    mode: "DRY_RUN",
    status: duplicateCycleGroups === 0
      ? "NO_NON_NULL_DUPLICATES_AT_SNAPSHOT"
      : "DUPLICATE_CYCLES_DETECTED",
    observedAt: observedAtIso(row.observedAt),
    duplicateCycleGroups,
    duplicateResponseRows,
    excessResponseRows,
    legacyNullRevisionRows,
    automaticAction: "NONE",
    uniquenessMigrationAuthorized: false,
    version: WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_VERSION,
  }
}

/**
 * Inspect the complete tenant response ledger at one database snapshot. The
 * aggregate returns counts only: case, response, employee, workday and request
 * identifiers never leave PostgreSQL. This diagnostic neither repairs rows nor
 * authorizes the separately reviewed online uniqueness migration.
 */
export async function runWorkforceExceptionResponseCycleAudit(
  db: WorkforceExceptionResponseCycleAuditDb,
  input: { organizationId: string },
): Promise<WorkforceExceptionResponseCycleAuditResult> {
  const organizationId = validatedOrganizationId(input.organizationId)

  return db.$transaction(async (tx) => {
    await tx.$queryRaw<unknown[]>`
      SELECT
        set_config('lock_timeout', '1s', true),
        set_config('statement_timeout', '5s', true),
        set_config('work_mem', '4MB', true)
    `

    const rows = await tx.$queryRaw<AggregateRow[]>`
      WITH cycle_counts AS (
        SELECT
          "caseId",
          "observedCaseRevision",
          COUNT(*)::bigint AS response_count
        FROM "workforce_exception_employee_responses"
        WHERE "organizationId" = ${organizationId}
        GROUP BY "caseId", "observedCaseRevision"
      )
      SELECT
        transaction_timestamp() AS "observedAt",
        COUNT(*) FILTER (
          WHERE "observedCaseRevision" IS NOT NULL AND response_count > 1
        )::bigint AS "duplicateCycleGroups",
        COALESCE(SUM(response_count) FILTER (
          WHERE "observedCaseRevision" IS NOT NULL AND response_count > 1
        ), 0)::bigint AS "duplicateResponseRows",
        COALESCE(SUM(response_count - 1) FILTER (
          WHERE "observedCaseRevision" IS NOT NULL AND response_count > 1
        ), 0)::bigint AS "excessResponseRows",
        COALESCE(SUM(response_count) FILTER (
          WHERE "observedCaseRevision" IS NULL
        ), 0)::bigint AS "legacyNullRevisionRows"
      FROM cycle_counts
    `

    if (rows.length !== 1 || !rows[0]) {
      throw new RangeError("exception response cycle aggregate is unavailable")
    }
    return resultFromRow(rows[0])
  }, {
    isolationLevel: "RepeatableRead",
    maxWait: 2_000,
    timeout: 8_000,
  })
}
