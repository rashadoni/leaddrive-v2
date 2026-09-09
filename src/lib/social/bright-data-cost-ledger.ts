import type { ProviderCost } from "@/lib/social/provider-capability-contract"

export const BRIGHT_DATA_COST_LEDGER_VERSION = "bright-data-cost-ledger-v1"

const SUPPORTED_RECORD_UNITS = new Set([
  "record",
  "records",
  "successful_record",
  "successful_records",
])

export interface BrightDataPriceSnapshot {
  id: string
  effectiveAt: string
  usdPerThousandRecords: number
  sourceUrl: string
}

export interface BrightDataCostLedgerInput {
  requestedUnits: number
  deliveredRecords: number
  acceptedUnique: number
  reservedChargeUsd: number
  providerCost?: ProviderCost | null
  priceSnapshot?: BrightDataPriceSnapshot | null
}

export type BrightDataChargeSource =
  | "PROVIDER_AMOUNT"
  | "BILLING_UNITS_PRICE_SNAPSHOT"
  | "DELIVERED_RECORD_ESTIMATE"
  | "UNAVAILABLE"

export interface BrightDataCostLedgerEntry {
  schemaVersion: typeof BRIGHT_DATA_COST_LEDGER_VERSION
  requestedUnits: number
  deliveredRecords: number
  acceptedUnique: number
  billableUnits: number | null
  unitName: string | null
  chargeSource: BrightDataChargeSource
  actualChargeUsd: number | null
  estimatedChargeUsd: number | null
  reservedChargeUsd: number
  reservationReleasedUsd: number | null
  reservationOverrunUsd: number | null
  costPerAcceptedUniqueUsd: number | null
  estimatedCostPerAcceptedUniqueUsd: number | null
  priceSnapshotId: string | null
  warnings: string[]
}

export interface BrightDataProviderRunCostFields {
  receivedCount: number
  acceptedCount: number
  actualChargeUsd?: number
  reservedChargeUsd?: number
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative integer`)
  }
  return Number(value)
}

function nonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`)
  }
  return value
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function normalizedUnitName(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return nonEmptyString(value, "providerCost.unitName").toLowerCase().replace(/[\s-]+/g, "_")
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

export function validateBrightDataPriceSnapshot(
  value: BrightDataPriceSnapshot | null | undefined,
): BrightDataPriceSnapshot | null {
  if (!value) return null
  const id = nonEmptyString(value.id, "priceSnapshot.id")
  const effectiveAt = nonEmptyString(value.effectiveAt, "priceSnapshot.effectiveAt")
  if (!Number.isFinite(new Date(effectiveAt).getTime())) {
    throw new Error("priceSnapshot.effectiveAt must be an ISO date")
  }
  const sourceUrl = nonEmptyString(value.sourceUrl, "priceSnapshot.sourceUrl")
  try {
    const url = new URL(sourceUrl)
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid protocol")
  } catch {
    throw new Error("priceSnapshot.sourceUrl must be an http(s) URL")
  }
  return {
    id,
    effectiveAt: new Date(effectiveAt).toISOString(),
    usdPerThousandRecords: nonNegativeNumber(value.usdPerThousandRecords, "priceSnapshot.usdPerThousandRecords"),
    sourceUrl,
  }
}

function costPerAccepted(cost: number | null, acceptedUnique: number): number | null {
  return cost === null || acceptedUnique === 0 ? null : roundUsd(cost / acceptedUnique)
}

/**
 * Builds an immutable accounting entry without making a billing API call.
 * Provider-reported USD is authoritative. Provider billing units become actual
 * cost only with a versioned price snapshot. Delivered-record pricing remains
 * an estimate and must never be persisted as SocialProviderRun.actualChargeUsd.
 */
export function buildBrightDataCostLedger(input: BrightDataCostLedgerInput): BrightDataCostLedgerEntry {
  const requestedUnits = nonNegativeInteger(input.requestedUnits, "requestedUnits")
  const deliveredRecords = nonNegativeInteger(input.deliveredRecords, "deliveredRecords")
  const acceptedUnique = nonNegativeInteger(input.acceptedUnique, "acceptedUnique")
  if (acceptedUnique > deliveredRecords) {
    throw new Error("acceptedUnique cannot exceed deliveredRecords")
  }
  const reservedChargeUsd = nonNegativeNumber(input.reservedChargeUsd, "reservedChargeUsd")
  const priceSnapshot = validateBrightDataPriceSnapshot(input.priceSnapshot)
  const providerCost = input.providerCost ?? null
  const hasAmount = providerCost?.amountUsd !== null && providerCost?.amountUsd !== undefined
  const hasUnits = providerCost?.units !== null && providerCost?.units !== undefined
  if (providerCost && !hasAmount && !hasUnits) {
    throw new Error("providerCost requires amountUsd or units")
  }
  const amountUsd = hasAmount
    ? nonNegativeNumber(providerCost?.amountUsd, "providerCost.amountUsd")
    : null
  const billableUnits = hasUnits
    ? nonNegativeNumber(providerCost?.units, "providerCost.units")
    : null
  const unitName = hasUnits ? normalizedUnitName(providerCost?.unitName) : null
  if (hasUnits && !SUPPORTED_RECORD_UNITS.has(unitName ?? "")) {
    throw new Error(`unsupported Bright Data billing unit ${unitName ?? "missing"}`)
  }

  let chargeSource: BrightDataChargeSource = "UNAVAILABLE"
  let actualChargeUsd: number | null = null
  let estimatedChargeUsd: number | null = null
  const warnings: string[] = []

  if (amountUsd !== null) {
    chargeSource = "PROVIDER_AMOUNT"
    actualChargeUsd = roundUsd(amountUsd)
  } else if (billableUnits !== null && priceSnapshot) {
    chargeSource = "BILLING_UNITS_PRICE_SNAPSHOT"
    actualChargeUsd = roundUsd((billableUnits * priceSnapshot.usdPerThousandRecords) / 1_000)
  } else if (billableUnits !== null) {
    warnings.push("bright_data_price_snapshot_missing")
  } else if (priceSnapshot) {
    chargeSource = "DELIVERED_RECORD_ESTIMATE"
    estimatedChargeUsd = roundUsd((deliveredRecords * priceSnapshot.usdPerThousandRecords) / 1_000)
    warnings.push("bright_data_cost_estimated_from_delivered_records")
  } else {
    warnings.push("bright_data_authoritative_cost_unavailable")
  }

  const reservationReleasedUsd = actualChargeUsd === null
    ? null
    : roundUsd(Math.max(0, reservedChargeUsd - actualChargeUsd))
  const reservationOverrunUsd = actualChargeUsd === null
    ? null
    : roundUsd(Math.max(0, actualChargeUsd - reservedChargeUsd))
  if ((reservationOverrunUsd ?? 0) > 0) warnings.push("bright_data_reservation_overrun")

  return {
    schemaVersion: BRIGHT_DATA_COST_LEDGER_VERSION,
    requestedUnits,
    deliveredRecords,
    acceptedUnique,
    billableUnits,
    unitName,
    chargeSource,
    actualChargeUsd,
    estimatedChargeUsd,
    reservedChargeUsd: roundUsd(reservedChargeUsd),
    reservationReleasedUsd,
    reservationOverrunUsd,
    costPerAcceptedUniqueUsd: costPerAccepted(actualChargeUsd, acceptedUnique),
    estimatedCostPerAcceptedUniqueUsd: costPerAccepted(estimatedChargeUsd, acceptedUnique),
    priceSnapshotId: priceSnapshot?.id ?? null,
    warnings,
  }
}

export function brightDataLedgerToProviderRunCostFields(
  ledger: BrightDataCostLedgerEntry,
): BrightDataProviderRunCostFields {
  const base = {
    receivedCount: ledger.deliveredRecords,
    acceptedCount: ledger.acceptedUnique,
  }
  // Authoritative actual settled: record it. The caller releases the reservation
  // in full (it zeroes reservedChargeUsd whenever actualChargeUsd is present).
  if (ledger.actualChargeUsd !== null) {
    return { ...base, actualChargeUsd: ledger.actualChargeUsd }
  }
  // No authoritative actual yet — only a delivered-record ESTIMATE. Bright Data
  // actuals settle asynchronously via webhook and the reconcile cron covers only
  // Apify, so without this the full per-run reservation ("maximum exposure") would
  // sit on the books until the UTC-midnight reset. The sum of those idle holds
  // burns the shared daily route budget and fails every later automatic run closed
  // (paid_route_daily_budget_exhausted) even though real spend is cents. Step the
  // reservation DOWN to the record-based estimate (never up — the estimate is
  // clamped to the reservation), mirroring the release-stale-reservations repair,
  // WITHOUT persisting the estimate as an authoritative actualChargeUsd.
  if (ledger.estimatedChargeUsd !== null) {
    return { ...base, reservedChargeUsd: Math.min(ledger.reservedChargeUsd, ledger.estimatedChargeUsd) }
  }
  return base
}
