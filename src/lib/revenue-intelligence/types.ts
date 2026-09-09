/**
 * A12 Revenue Intelligence — types + state machines.
 *
 * Slice-1 contract. Types mirror Prisma schema + DB triggers
 * (prisma/migrations/20260520100000_revenue_intelligence/migration.sql).
 *
 * Three measurement loops:
 *   1. Forecast snapshots — point-in-time captures of committed /
 *      best-case / weighted-forecast across an org/pipeline/user scope.
 *   2. Pipeline waterfall — every stage transition as append-only event.
 *   3. Deal velocity — per (pipeline, stage, period) duration percentiles
 *      with bottleneck detection.
 *
 * NOT to be confused with M4 RevenueRecognition (ASC 606 / IFRS 15
 * obligations + schedules) — that's accounting-side; this is sales-side
 * forecasting + measurement.
 */

// ── Forecast snapshot scope ─────────────────────────────────────

export type ForecastScope = "org" | "pipeline" | "user"

export const FORECAST_SCOPES: readonly ForecastScope[] = [
  "org",
  "pipeline",
  "user",
] as const

// ── Stage transition type ───────────────────────────────────────

export type TransitionType =
  | "created"
  | "advanced"
  | "regressed"
  | "won"
  | "lost"
  | "reopened"
  | "reassigned"

export const TRANSITION_TYPES: readonly TransitionType[] = [
  "created",
  "advanced",
  "regressed",
  "won",
  "lost",
  "reopened",
  "reassigned",
] as const

/**
 * Terminal transition types — deal is closed after these. waterfall-
 * analyzer uses this set to decide bucket counts.
 */
export const TERMINAL_TRANSITION_TYPES: readonly TransitionType[] = [
  "won",
  "lost",
] as const

// ── Velocity period bucket ──────────────────────────────────────

export type VelocityPeriodKey =
  | "last_30d"
  | "last_90d"
  | "last_180d"
  | "last_365d"

export const VELOCITY_PERIOD_KEYS: readonly VelocityPeriodKey[] = [
  "last_30d",
  "last_90d",
  "last_180d",
  "last_365d",
] as const

/**
 * Period → window length in days. Used by velocity-aggregator to filter.
 */
export const VELOCITY_PERIOD_DAYS: Readonly<Record<VelocityPeriodKey, number>> =
  {
    last_30d: 30,
    last_90d: 90,
    last_180d: 180,
    last_365d: 365,
  }

// ── Accuracy classification ─────────────────────────────────────

export type AccuracyClass =
  | "accurate"
  | "over_delivered"
  | "under_delivered"
  | "unknown"

export const ACCURACY_CLASSES: readonly AccuracyClass[] = [
  "accurate",
  "over_delivered",
  "under_delivered",
  "unknown",
] as const

/**
 * Variance tolerance: |variance| within this fraction → "accurate".
 * 0.05 = ±5%. forecast-accuracy-calculator uses this default; slice-2
 * may make it tenant-configurable.
 */
export const DEFAULT_ACCURACY_TOLERANCE = 0.05

// ── Slim shapes for helpers ─────────────────────────────────────

/**
 * Stage probability map fed to forecast-snapshot-builder. Maps stage
 * name → probability in [0, 1]. Slice-2 admin UI lets ops set this
 * per-pipeline; slice-1 helpers accept it as input.
 */
export type StageProbabilityMap = Record<string, number>

/**
 * Default stage probabilities for built-in pipelines. Used by slice-2
 * cron when no per-pipeline override exists. Stage names match the
 * existing schema's default Deal.stage values.
 */
export const DEFAULT_STAGE_PROBABILITIES: Readonly<StageProbabilityMap> = {
  LEAD: 0.05,
  QUALIFIED: 0.15,
  CONTACTED: 0.25,
  PROPOSAL: 0.5,
  NEGOTIATION: 0.75,
  COMMITTED: 0.9,
  WON: 1.0,
  LOST: 0,
}

/**
 * Threshold above which a stage probability counts toward "committed"
 * in the snapshot. Slice-1 default 0.9 (= "verbal commit / contract").
 */
export const COMMITTED_PROBABILITY_THRESHOLD = 0.9

/**
 * Threshold above which a stage probability counts toward "best case".
 * 0.7 = "strong possibility". Best-case includes committed.
 */
export const BEST_CASE_PROBABILITY_THRESHOLD = 0.7

// ── Deal input for snapshot builder ─────────────────────────────

export interface DealForSnapshot {
  dealId: string
  amount: number
  stage: string
  /** Won/Lost deals have a non-null close date. */
  closedAt?: Date | null
  /** When the deal is expected to close (drives period bucketing). */
  expectedCloseAt?: Date | null
}

export interface SnapshotBuildResult {
  committedAmount: number
  bestCaseAmount: number
  forecastAmount: number
  dealsCommitted: number
  dealsBestCase: number
  dealsTotal: number
  /** Deals filtered out (closed/lost/out-of-period). */
  dealsExcluded: number
}

// ── Waterfall types ─────────────────────────────────────────────

export interface WaterfallTransition {
  transitionId: string
  dealId: string
  fromStage: string | null
  toStage: string
  fromAmount: number | null
  toAmount: number
  transitionType: TransitionType
  transitionedAt: Date
  durationInPrevStageSeconds?: number | null
}

export interface WaterfallBucket {
  transitionType: TransitionType
  count: number
  totalAmountDelta: number
  dealIds: string[]
}

export interface WaterfallAnalysis {
  periodStart: Date
  periodEnd: Date
  /** All buckets, sorted by transitionType taxonomy order. */
  buckets: WaterfallBucket[]
  /** Net amount delta = sum across all buckets. */
  netAmountDelta: number
  /** Total transitions analyzed. */
  totalTransitions: number
}

// ── Velocity types ──────────────────────────────────────────────

export interface StageDurationSample {
  /** Seconds the deal spent in the stage. */
  durationSeconds: number
  /** Did the deal advance forward after this stage? */
  advanced: boolean
  /** Did the deal regress (move back) after this stage? */
  regressed: boolean
  /** Did the deal close-lose from this stage? */
  lost: boolean
  /** Did the deal close-win from this stage? */
  won: boolean
}

export interface VelocityResult {
  pipelineId: string
  stage: string
  periodKey: VelocityPeriodKey
  dealsEntered: number
  dealsExited: number
  dealsAdvanced: number
  dealsRegressed: number
  dealsLost: number
  dealsWon: number
  avgDurationSeconds: number | null
  p50DurationSeconds: number | null
  p90DurationSeconds: number | null
  conversionRate: number | null
  /** True if p90 duration > 30 days — flag for "deals stall here". */
  isBottleneck: boolean
}

/**
 * Bottleneck threshold — p90 duration in seconds above which the stage
 * is flagged. 30 days default; slice-2 may make tenant-configurable.
 */
export const BOTTLENECK_P90_THRESHOLD_SECONDS = 30 * 24 * 60 * 60

// ── Forecast accuracy types ─────────────────────────────────────

export interface AccuracyInput {
  snapshot: {
    forecastAmount: number
    committedAmount: number
    bestCaseAmount: number
  }
  actualAmount: number
  /** Tolerance for "accurate" class. Defaults to DEFAULT_ACCURACY_TOLERANCE. */
  tolerance?: number
}

export interface AccuracyResult {
  actualAmount: number
  forecastedAmount: number
  committedAmount: number
  bestCaseAmount: number
  varianceAbsForecast: number
  varianceAbsCommitted: number
  varianceAbsBestCase: number
  /** Pct vs forecast; null when forecast is 0. */
  variancePctForecast: number | null
  variancePctCommitted: number | null
  variancePctBestCase: number | null
  accuracyClass: AccuracyClass
}
