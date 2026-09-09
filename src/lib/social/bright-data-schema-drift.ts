export const BRIGHT_DATA_SCHEMA_DRIFT_VERSION = "bright-data-schema-drift-v1"

export type BrightDataBatchHealth = "TRUE_ZERO" | "HEALTHY" | "DEGRADED" | "FAILED"

export interface BrightDataSchemaDriftOptions {
  degradedRatio?: number
}

export interface BrightDataSchemaDriftReport<T> {
  schemaVersion: typeof BRIGHT_DATA_SCHEMA_DRIFT_VERSION
  health: BrightDataBatchHealth
  totalCount: number
  validCount: number
  invalidCount: number
  providerErrorCount: number
  invalidRatio: number | null
  failureCodes: Record<string, number>
  normalized: T[]
  warnings: string[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function providerErrorCode(value: unknown): string | null {
  const raw = record(value).error_code
  if (typeof raw !== "string" || !raw.trim()) return null
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 64)
  return normalized || "unknown"
}

function normalizationFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  if (message.includes("mismatch")) return "parent_identity_mismatch"
  if (message.includes("iso date") || message.includes("date is required")) return "invalid_or_missing_date"
  if (message.includes("url is required")) return "invalid_or_missing_url"
  if (message.includes("id is required")) return "missing_identity"
  if (message.includes("text is required")) return "missing_text"
  if (message.includes("required")) return "missing_required_field"
  return "normalization_failed"
}

function increment(counts: Record<string, number>, code: string) {
  counts[code] = (counts[code] ?? 0) + 1
}

/**
 * Evaluates rows already returned by Bright Data. It never performs provider
 * I/O and never returns raw error messages or payload samples.
 */
export function evaluateBrightDataSchemaDrift<T>(
  rows: readonly unknown[],
  normalize: (row: unknown, index: number) => T,
  options: BrightDataSchemaDriftOptions = {},
): BrightDataSchemaDriftReport<T> {
  const degradedRatio = options.degradedRatio ?? 0.2
  if (!Number.isFinite(degradedRatio) || degradedRatio < 0 || degradedRatio >= 1) {
    throw new Error("degradedRatio must be between 0 (inclusive) and 1 (exclusive)")
  }
  if (rows.length === 0) {
    return {
      schemaVersion: BRIGHT_DATA_SCHEMA_DRIFT_VERSION,
      health: "TRUE_ZERO",
      totalCount: 0,
      validCount: 0,
      invalidCount: 0,
      providerErrorCount: 0,
      invalidRatio: null,
      failureCodes: {},
      normalized: [],
      warnings: [],
    }
  }

  const normalized: T[] = []
  const failureCodes: Record<string, number> = {}
  let providerErrorCount = 0
  for (let index = 0; index < rows.length; index += 1) {
    const providerCode = providerErrorCode(rows[index])
    if (providerCode) {
      providerErrorCount += 1
      increment(failureCodes, `provider_error:${providerCode}`)
      continue
    }
    try {
      normalized.push(normalize(rows[index], index))
    } catch (error) {
      increment(failureCodes, normalizationFailureCode(error))
    }
  }

  const invalidCount = rows.length - normalized.length
  const invalidRatio = invalidCount / rows.length
  const health: BrightDataBatchHealth = normalized.length === 0
    ? "FAILED"
    : invalidRatio > degradedRatio
      ? "DEGRADED"
      : "HEALTHY"
  const warnings = Object.keys(failureCodes).sort().map(code => `bright_data_schema:${code}`)

  return {
    schemaVersion: BRIGHT_DATA_SCHEMA_DRIFT_VERSION,
    health,
    totalCount: rows.length,
    validCount: normalized.length,
    invalidCount,
    providerErrorCount,
    invalidRatio,
    failureCodes,
    normalized,
    warnings,
  }
}
