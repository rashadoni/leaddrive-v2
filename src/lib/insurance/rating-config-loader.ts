/**
 * R7 Insurance slice-2 — per-tenant premium rating config loader.
 *
 * Slice-1 `premium-calculator.ts` ships hardcoded BASE_RATES +
 * RISK_MULTIPLIERS + DEDUCTIBLE_CREDIT_RATES tables (lines 52-77).
 * Per-tenant overrides (table `insurance_rating_config`, migration
 * `20260521090000_r11_r7_config_primitives`) let regulated carriers
 * honor state DOI tariff filings without code changes — each state
 * has different baseline rates per line of business.
 *
 * Same defensive-merge pattern as PR #91 C5 / PR #92 R11 pacing:
 *   • Defaults baked here as the single source of truth.
 *   • Per-org row optional. Absent → defaults verbatim.
 *   • Malformed / negative / non-numeric overrides fall back to
 *     defaults per-key without throwing.
 *   • Result frozen.
 *
 * `rateTablesV2` JSONB is reserved for slice-3 actuarial granularity
 * (coverage-limit × age × territory tables). Surfaced verbatim
 * here so route consumers can read it once the slice-3 calculator
 * lands.
 *
 * Route consumer (admin UI + premium-calculator wiring) is
 * slice-2-mini follow-up.
 */
import { prisma as defaultPrisma } from "@/lib/prisma"
import { LINES_OF_BUSINESS, RISK_TIERS } from "./types"
import type { LineOfBusiness, RiskTier } from "./types"

/* ─── Defaults (single source of truth, mirror slice-1) ──────────── */

export const DEFAULT_BASE_RATES: Readonly<Record<LineOfBusiness, number>> = Object.freeze({
  auto: 0.015,
  home: 0.008,
  life: 0.002,
  health: 0.025,
  commercial: 0.012,
  umbrella: 0.001,
  marine: 0.014,
})

export const DEFAULT_RISK_MULTIPLIERS: Readonly<Record<Exclude<RiskTier, "declined">, number>> = Object.freeze({
  preferred: 0.8,
  standard: 1.0,
  substandard: 1.4,
  // "declined" intentionally excluded — slice-1 uses NaN sentinel +
  // calculator code path returns ok:false before lookup. Per-tenant
  // override of "declined" makes no semantic sense.
})

export const DEFAULT_DEDUCTIBLE_CREDIT_RATES: Readonly<Record<LineOfBusiness, number>> = Object.freeze({
  auto: 0.1,
  home: 0.1,
  commercial: 0.1,
  marine: 0.1,
  life: 0,
  health: 0,
  umbrella: 0,
})

/* ─── Resolved-config shape ──────────────────────────────────────── */

export interface InsuranceRatingWeights {
  baseRates: Readonly<Record<LineOfBusiness, number>>
  /** "declined" still maps to NaN at the calculator code path. */
  riskMultipliers: Readonly<Record<Exclude<RiskTier, "declined">, number>>
  deductibleCreditRates: Readonly<Record<LineOfBusiness, number>>
  /** Reserved JSONB for slice-3 actuarial tables. Surfaced verbatim. */
  rateTablesV2: Readonly<Record<string, unknown>>
}

/* ─── Loader ─────────────────────────────────────────────────────── */

type RatingConfigClient = {
  insuranceRatingConfig: {
    findUnique(args: {
      where: { organizationId: string }
      select?: never
    }): Promise<{
      baseRates: unknown
      riskMultipliers: unknown
      deductibleCreditRates: unknown
      rateTablesV2: unknown
    } | null>
  }
}

function mergePositiveNumberRecord<K extends string>(
  defaults: Readonly<Record<K, number>>,
  overrides: unknown,
  keys: readonly K[],
  allowZero = false,
): Record<K, number> {
  const out = { ...defaults } as Record<K, number>
  if (
    typeof overrides !== "object" ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    return out
  }
  const o = overrides as Record<string, unknown>
  for (const k of keys) {
    if (Object.hasOwn(o, k)) {
      const v = o[k]
      if (
        typeof v === "number" &&
        Number.isFinite(v) &&
        (allowZero ? v >= 0 : v > 0)
      ) {
        out[k] = v
      }
    }
  }
  return out
}

export async function loadInsuranceRatingWeights(
  orgId: string,
  client: RatingConfigClient = defaultPrisma as unknown as RatingConfigClient,
): Promise<InsuranceRatingWeights> {
  if (typeof orgId !== "string" || !orgId) {
    throw new Error("loadInsuranceRatingWeights: orgId required")
  }
  const row = await client.insuranceRatingConfig.findUnique({
    where: { organizationId: orgId },
  })
  if (!row) {
    return Object.freeze({
      baseRates: DEFAULT_BASE_RATES,
      riskMultipliers: DEFAULT_RISK_MULTIPLIERS,
      deductibleCreditRates: DEFAULT_DEDUCTIBLE_CREDIT_RATES,
      rateTablesV2: Object.freeze({}),
    })
  }

  const baseRates = Object.freeze(
    mergePositiveNumberRecord(
      DEFAULT_BASE_RATES,
      row.baseRates,
      LINES_OF_BUSINESS,
      false, // base rate of 0 is meaningless (no premium)
    ),
  )
  // Only override the 3 non-"declined" tiers.
  const overrideableTiers = RISK_TIERS.filter(
    (t): t is Exclude<RiskTier, "declined"> => t !== "declined",
  )
  const riskMultipliers = Object.freeze(
    mergePositiveNumberRecord(
      DEFAULT_RISK_MULTIPLIERS,
      row.riskMultipliers,
      overrideableTiers,
      false,
    ),
  )
  const deductibleCreditRates = Object.freeze(
    mergePositiveNumberRecord(
      DEFAULT_DEDUCTIBLE_CREDIT_RATES,
      row.deductibleCreditRates,
      LINES_OF_BUSINESS,
      true, // life/health/umbrella default to 0; override may legitimately be 0
    ),
  )
  const rateTablesV2 =
    row.rateTablesV2 !== null &&
    typeof row.rateTablesV2 === "object" &&
    !Array.isArray(row.rateTablesV2)
      ? Object.freeze({ ...(row.rateTablesV2 as Record<string, unknown>) })
      : Object.freeze({})

  return Object.freeze({
    baseRates,
    riskMultipliers,
    deductibleCreditRates,
    rateTablesV2,
  })
}
