/**
 * C5 Account Engagement slice-2 — per-tenant config loader.
 *
 * Slice-1 ships hardcoded weight tables in:
 *   • account-grade-calculator.ts (ICP_COMPONENT_BY_TIER, BAND_COMPONENT,
 *     letter-grade thresholds)
 *   • intent-signal-classifier.ts (per-SignalKind weights,
 *     MQL-qualifying allow-list)
 *
 * Slice-2 ships the storage (account_grade_config + intent_signal_config
 * tables, migration `20260521080000_c5_per_tenant_config`) + this
 * loader module that merges per-org overrides on top of the slice-1
 * defaults. Route consumers (slice-2-mini admin UI + score/grade
 * recompute cron) call into the typed loaders below.
 *
 * Design:
 *   • Defaults baked in this module — single source of truth.
 *   • Per-org row optional. Absence of a row → defaults verbatim.
 *   • Override merge is shallow: each present key in the JSONB
 *     overrides the corresponding default; missing keys keep default.
 *   • Loaders return frozen objects so accidental caller-side
 *     mutation doesn't leak into other call sites.
 *
 * Pure-ish: takes an injectable Prisma client (any object with
 * findUnique on the two tables). Defaults to global prisma.
 */
import { prisma as defaultPrisma } from "@/lib/prisma"
import { ICP_TIERS, EMPLOYEE_BANDS } from "./types"
import type { IcpTier, EmployeeBand } from "./types"

/* ─── Defaults (single source of truth) ──────────────────────────── */

/**
 * Slice-1 hardcoded ICP tier weights. Mirrored from
 * `account-grade-calculator.ts:33-39`. Keep in sync if that file
 * changes — slice-3 may move the canonical defaults here entirely.
 */
export const DEFAULT_ICP_COMPONENT_BY_TIER: Readonly<Record<IcpTier, number>> = Object.freeze({
  tier_1: 30,
  tier_2: 22,
  tier_3: 14,
  tier_4: 6,
  unscored: 0,
})

export const DEFAULT_BAND_COMPONENT: Readonly<Record<EmployeeBand, number>> = Object.freeze({
  strategic: 25,
  enterprise: 20,
  mid_market: 14,
  small: 8,
  micro: 3,
})

/** Letter-grade letter → minimum raw score. Slice-1 rawToGrade. */
export const DEFAULT_GRADE_THRESHOLDS: Readonly<Record<"A" | "B" | "C" | "D", number>> = Object.freeze({
  A: 80,
  B: 60,
  C: 40,
  D: 20,
})

/** Default lookback window for intent-signal recency scoring. */
export const DEFAULT_LOOKBACK_DAYS = 30

/* ─── Resolved-config shapes ─────────────────────────────────────── */

export interface AccountGradeWeights {
  icpComponentByTier: Readonly<Record<IcpTier, number>>
  bandComponent: Readonly<Record<EmployeeBand, number>>
  targetIndustries: readonly string[]
  disqualifiedIndustries: readonly string[]
  gradeThresholds: Readonly<Record<"A" | "B" | "C" | "D", number>>
}

export interface IntentSignalWeights {
  /** Free-form SignalKind → weight map (keys are caller-validated). */
  signalWeights: Readonly<Record<string, number>>
  mqlQualifyingByKind: Readonly<Record<string, boolean>>
  lookbackDays: number
}

/* ─── Loaders ────────────────────────────────────────────────────── */

/**
 * Minimal Prisma surface — any client (global or transaction) that
 * exposes findUnique on the two config tables.
 */
type ConfigClient = {
  accountGradeConfig: {
    findUnique(args: {
      where: { organizationId: string }
      select?: never
    }): Promise<{
      icpComponentByTier: unknown
      bandComponent: unknown
      targetIndustries: string[]
      disqualifiedIndustries: string[]
      gradeThresholds: unknown
    } | null>
  }
  intentSignalConfig: {
    findUnique(args: {
      where: { organizationId: string }
      select?: never
    }): Promise<{
      signalWeights: unknown
      mqlQualifyingByKind: unknown
      lookbackDays: number | null
    } | null>
  }
}

/* ─── Merge utilities ────────────────────────────────────────────── */

function isPlainNumberRecord(v: unknown): v is Record<string, number> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every(
      (x) => typeof x === "number" && Number.isFinite(x),
    )
  )
}

function isPlainBoolRecord(v: unknown): v is Record<string, boolean> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every(
      (x) => typeof x === "boolean",
    )
  )
}

/**
 * Merge per-key: defaults first, then overrides for keys that are
 * present in `overrides` (and pass the type guard). Defaults wins
 * for any malformed override (defensive — if an admin puts garbage
 * in the JSONB we don't want the helper to throw).
 */
function mergeNumberRecord<K extends string>(
  defaults: Readonly<Record<K, number>>,
  overrides: unknown,
  keys: readonly K[],
): Record<K, number> {
  const out = { ...defaults } as Record<K, number>
  if (!isPlainNumberRecord(overrides)) return out
  for (const k of keys) {
    if (Object.hasOwn(overrides, k)) {
      const v = (overrides as Record<string, number>)[k]
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        out[k] = v
      }
    }
  }
  return out
}

/* ─── Public loaders ─────────────────────────────────────────────── */

export async function loadAccountGradeWeights(
  orgId: string,
  client: ConfigClient = defaultPrisma as unknown as ConfigClient,
): Promise<AccountGradeWeights> {
  if (typeof orgId !== "string" || !orgId) {
    throw new Error("loadAccountGradeWeights: orgId required")
  }
  const row = await client.accountGradeConfig.findUnique({
    where: { organizationId: orgId },
  })
  if (!row) {
    // No per-org override row — return defaults verbatim.
    return Object.freeze({
      icpComponentByTier: DEFAULT_ICP_COMPONENT_BY_TIER,
      bandComponent: DEFAULT_BAND_COMPONENT,
      targetIndustries: [],
      disqualifiedIndustries: [],
      gradeThresholds: DEFAULT_GRADE_THRESHOLDS,
    })
  }
  return Object.freeze({
    icpComponentByTier: Object.freeze(
      mergeNumberRecord(DEFAULT_ICP_COMPONENT_BY_TIER, row.icpComponentByTier, ICP_TIERS),
    ),
    bandComponent: Object.freeze(
      mergeNumberRecord(DEFAULT_BAND_COMPONENT, row.bandComponent, EMPLOYEE_BANDS),
    ),
    targetIndustries: Object.freeze([...row.targetIndustries]),
    disqualifiedIndustries: Object.freeze([...row.disqualifiedIndustries]),
    gradeThresholds: Object.freeze(
      mergeNumberRecord(DEFAULT_GRADE_THRESHOLDS, row.gradeThresholds, [
        "A",
        "B",
        "C",
        "D",
      ] as const),
    ),
  })
}

export async function loadIntentSignalWeights(
  orgId: string,
  client: ConfigClient = defaultPrisma as unknown as ConfigClient,
): Promise<IntentSignalWeights> {
  if (typeof orgId !== "string" || !orgId) {
    throw new Error("loadIntentSignalWeights: orgId required")
  }
  const row = await client.intentSignalConfig.findUnique({
    where: { organizationId: orgId },
  })
  if (!row) {
    return Object.freeze({
      signalWeights: Object.freeze({}),
      mqlQualifyingByKind: Object.freeze({}),
      lookbackDays: DEFAULT_LOOKBACK_DAYS,
    })
  }
  // Signal weights / MQL flags are free-form (caller validates SignalKind
  // strings). Surface whatever the JSONB contains as long as it's the
  // right shape.
  const signalWeights = isPlainNumberRecord(row.signalWeights)
    ? Object.freeze({ ...row.signalWeights })
    : Object.freeze({})
  const mqlQualifyingByKind = isPlainBoolRecord(row.mqlQualifyingByKind)
    ? Object.freeze({ ...row.mqlQualifyingByKind })
    : Object.freeze({})
  const lookbackDays =
    row.lookbackDays !== null && row.lookbackDays >= 1 && row.lookbackDays <= 365
      ? row.lookbackDays
      : DEFAULT_LOOKBACK_DAYS
  return Object.freeze({
    signalWeights,
    mqlQualifyingByKind,
    lookbackDays,
  })
}
