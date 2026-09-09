import {
  validateBrightDataPriceSnapshot,
  type BrightDataPriceSnapshot,
} from "@/lib/social/bright-data-cost-ledger"

export const BRIGHT_DATA_BUDGET_CAP_VERSION = "bright-data-budget-cap-v1"

const PRICE_ENV = {
  id: "BRIGHT_DATA_PRICE_SNAPSHOT_ID",
  effectiveAt: "BRIGHT_DATA_PRICE_EFFECTIVE_AT",
  usdPerThousandRecords: "BRIGHT_DATA_USD_PER_1000_RECORDS",
  sourceUrl: "BRIGHT_DATA_PRICE_SOURCE_URL",
} as const

export type BrightDataPriceSnapshotConfigResult =
  | { status: "READY"; snapshot: BrightDataPriceSnapshot }
  | {
    status: "BLOCKED"
    reason: "bright_data_price_snapshot_unconfigured" | "bright_data_price_snapshot_invalid"
  }

export interface BrightDataBudgetCapInput {
  hardCapUsd: number
  inputCount: number
  requestedLimitPerInput: number
  priceSnapshot?: BrightDataPriceSnapshot | null
}

export type BrightDataBudgetCapPlan =
  | {
    status: "BLOCKED"
    reason:
      | "bright_data_price_snapshot_unconfigured"
      | "bright_data_price_snapshot_invalid"
      | "bright_data_hard_cap_too_low"
  }
  | {
    status: "READY"
    schemaVersion: typeof BRIGHT_DATA_BUDGET_CAP_VERSION
    priceSnapshotId: string
    hardCapUsd: number
    inputCount: number
    requestedLimitPerInput: number
    limitPerInput: number
    requestedMaxRecords: number
    maxBillableRecords: number
    reservedRecords: number
    reservedChargeUsd: number
    headroomUsd: number
    clamped: boolean
  }

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`${field} must be a positive integer`)
  }
  return Number(value)
}

function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`)
  }
  return value
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

/**
 * Reads a versioned account price without logging raw environment values.
 * A partial or malformed configuration fails closed with a stable reason.
 */
export function brightDataPriceSnapshotFromEnv(
  environment: Record<string, string | undefined> = process.env,
): BrightDataPriceSnapshotConfigResult {
  const values = {
    id: environment[PRICE_ENV.id]?.trim(),
    effectiveAt: environment[PRICE_ENV.effectiveAt]?.trim(),
    usdPerThousandRecords: environment[PRICE_ENV.usdPerThousandRecords]?.trim(),
    sourceUrl: environment[PRICE_ENV.sourceUrl]?.trim(),
  }
  const configured = Object.values(values).some(Boolean)
  if (!configured) return { status: "BLOCKED", reason: "bright_data_price_snapshot_unconfigured" }
  if (!values.id || !values.effectiveAt || !values.usdPerThousandRecords || !values.sourceUrl) {
    return { status: "BLOCKED", reason: "bright_data_price_snapshot_invalid" }
  }

  const rate = Number(values.usdPerThousandRecords)
  try {
    const snapshot = validateBrightDataPriceSnapshot({
      id: values.id,
      effectiveAt: values.effectiveAt,
      usdPerThousandRecords: rate,
      sourceUrl: values.sourceUrl,
    })
    if (!snapshot || snapshot.usdPerThousandRecords <= 0) {
      return { status: "BLOCKED", reason: "bright_data_price_snapshot_invalid" }
    }
    return { status: "READY", snapshot }
  } catch {
    return { status: "BLOCKED", reason: "bright_data_price_snapshot_invalid" }
  }
}

/**
 * Converts an owner-approved USD cap into Bright Data's per-input record limit.
 * The calculation uses integer micro-dollars and rounds the per-record rate up,
 * so floating-point precision cannot make the request exceed the configured cap.
 * It does not dispatch a provider request.
 */
export function planBrightDataBudgetCap(input: BrightDataBudgetCapInput): BrightDataBudgetCapPlan {
  const hardCapUsd = positiveNumber(input.hardCapUsd, "hardCapUsd")
  const inputCount = positiveInteger(input.inputCount, "inputCount")
  const requestedLimitPerInput = positiveInteger(input.requestedLimitPerInput, "requestedLimitPerInput")
  if (!input.priceSnapshot) {
    return { status: "BLOCKED", reason: "bright_data_price_snapshot_unconfigured" }
  }

  let priceSnapshot: BrightDataPriceSnapshot
  try {
    const validated = validateBrightDataPriceSnapshot(input.priceSnapshot)
    if (!validated || validated.usdPerThousandRecords <= 0) {
      return { status: "BLOCKED", reason: "bright_data_price_snapshot_invalid" }
    }
    priceSnapshot = validated
  } catch {
    return { status: "BLOCKED", reason: "bright_data_price_snapshot_invalid" }
  }

  const hardCapMicros = Math.floor((hardCapUsd + Number.EPSILON) * 1_000_000)
  const pricePerRecordMicros = Math.ceil(priceSnapshot.usdPerThousandRecords * 1_000)
  const maxBillableRecords = Math.floor(hardCapMicros / pricePerRecordMicros)
  const maxLimitPerInput = Math.floor(maxBillableRecords / inputCount)
  if (maxLimitPerInput < 1) {
    return { status: "BLOCKED", reason: "bright_data_hard_cap_too_low" }
  }

  const limitPerInput = Math.min(requestedLimitPerInput, maxLimitPerInput)
  const requestedMaxRecords = inputCount * requestedLimitPerInput
  const reservedRecords = inputCount * limitPerInput
  const reservedChargeMicros = reservedRecords * pricePerRecordMicros

  return {
    status: "READY",
    schemaVersion: BRIGHT_DATA_BUDGET_CAP_VERSION,
    priceSnapshotId: priceSnapshot.id,
    hardCapUsd: roundUsd(hardCapMicros / 1_000_000),
    inputCount,
    requestedLimitPerInput,
    limitPerInput,
    requestedMaxRecords,
    maxBillableRecords,
    reservedRecords,
    reservedChargeUsd: roundUsd(reservedChargeMicros / 1_000_000),
    headroomUsd: roundUsd((hardCapMicros - reservedChargeMicros) / 1_000_000),
    clamped: limitPerInput !== requestedLimitPerInput,
  }
}
