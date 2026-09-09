/**
 * Revenue Recognition types — M4 Phase 6 Block C slice 1.
 *
 * Salesforce Revenue Cloud / ASC 606 analogue. Shared shape between
 * 5 pure helpers:
 *   1. state-machine          — PO + schedule lifecycle transitions
 *   2. allocation-engine      — split contract total across POs by SSP
 *   3. schedule-generator     — produce schedule lines from a PO + method
 *   4. recognition-calculator — given a schedule line + asOf, how much
 *                               should be recognized
 *   5. (re-exported)          — typed I/O for slice-2 caller code
 *
 * Money math uses *integer minor units* throughout to avoid floating-
 * point drift. Caller converts Prisma `Decimal` → integer minor units
 * (e.g. dollars → cents) before invoking helpers; helpers return
 * integer minor units; caller converts back to Decimal before write.
 * This keeps the helpers DI-free and deterministic, and matches the
 * Float→Decimal P0 discipline (no in-helper Float math).
 */

/* ─── PO recognition method ───────────────────────────────────────────── */

export const RECOGNITION_METHODS = [
  "point_in_time",
  "over_time_straight_line",
  "milestone",
  "usage_based",
] as const

export type RecognitionMethod = (typeof RECOGNITION_METHODS)[number]

/* ─── PO status + transitions ─────────────────────────────────────────── */

export const PO_STATUSES = [
  "draft",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const

export type PoStatus = (typeof PO_STATUSES)[number]

/**
 * Allowed lifecycle transitions.
 *
 *   draft → scheduled    (schedule-generator produced lines)
 *         → cancelled    (abandoned pre-schedule)
 *   scheduled → in_progress  (first entry posted)
 *             → cancelled
 *   in_progress → completed  (cumulative recognition == allocatedAmount)
 *               → cancelled
 *   completed / cancelled → []
 */
export const PO_TRANSITIONS: Readonly<Record<PoStatus, readonly PoStatus[]>> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
}

/* ─── Schedule status + transitions ───────────────────────────────────── */

export const SCHEDULE_STATUSES = [
  "scheduled",
  "partially_recognized",
  "recognized",
  "cancelled",
] as const

export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number]

/**
 *   scheduled → partially_recognized  (first non-full entry posted)
 *             → recognized            (full amount posted in one shot)
 *             → cancelled             (PO changed; line voided)
 *   partially_recognized → recognized → []
 *                       → cancelled
 *   recognized / cancelled → []
 */
export const SCHEDULE_TRANSITIONS: Readonly<
  Record<ScheduleStatus, readonly ScheduleStatus[]>
> = {
  scheduled: ["partially_recognized", "recognized", "cancelled"],
  partially_recognized: ["recognized", "cancelled"],
  recognized: [],
  cancelled: [],
}

export interface TransitionInput<T> {
  from: T
  to: T
}

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string }

/* ─── Allocation engine I/O ───────────────────────────────────────────── */

/**
 * One PO as input to the allocator. `ssp` is in **minor units** (e.g.
 * cents). NULL ssp means "use proportional to count" fallback — but
 * the allocator REJECTS a mix of NULL + non-NULL SSPs to avoid
 * ambiguous semantics. Either all POs have SSP, or none do.
 */
export interface PoAllocationInput {
  /** External identifier — passed through to output for caller mapping. */
  id: string
  /** Standalone selling price in minor units, or null. */
  ssp: number | null
}

export interface AllocateInput {
  /** Contract total in minor units (cents). MUST be a non-negative integer. */
  contractTotalMinor: number
  /** Currency — informational, not used in math. Helper does NOT do FX. */
  currency: string
  /** POs to allocate to. Order is preserved in output. Empty rejected. */
  obligations: readonly PoAllocationInput[]
}

export interface PoAllocationOutput {
  id: string
  /** Allocated amount in minor units. Sum across all POs == contractTotalMinor. */
  allocatedMinor: number
}

export type AllocateResult =
  | { ok: true; allocations: PoAllocationOutput[] }
  | { ok: false; error: string }

/* ─── Schedule generator I/O ──────────────────────────────────────────── */

export interface GenerateScheduleInput {
  /** PO id — passed through to each line for caller mapping. */
  performanceObligationId: string
  /** Method — gates which generator branch runs. */
  method: RecognitionMethod
  /** Allocated amount in minor units (output of allocation engine). */
  allocatedMinor: number
  currency: string
  /** Service period — periodEnd MUST be >= periodStart. */
  periodStart: Date
  periodEnd: Date
  /**
   * Optional milestone list (REQUIRED for `milestone` method). Each
   * milestone declares its label, dueAt, and weight (relative);
   * generator allocates by weight share of allocatedMinor.
   */
  milestones?: readonly {
    label: string
    dueAt: Date
    weight: number
  }[]
}

export interface GeneratedScheduleLine {
  performanceObligationId: string
  lineNumber: number
  periodStart: Date
  periodEnd: Date
  scheduledMinor: number
  currency: string
  label: string | null
}

export type GenerateScheduleResult =
  | { ok: true; lines: GeneratedScheduleLine[] }
  | { ok: false; error: string }

/* ─── Recognition calculator I/O ──────────────────────────────────────── */

export interface CalculateRecognitionInput {
  /** Total amount scheduled for this line, in minor units. */
  scheduledMinor: number
  /** Sum of previously-posted entries against this line, in minor units. */
  postedToDateMinor: number
  /** Schedule line period. */
  periodStart: Date
  periodEnd: Date
  /** Method gates pro-rata vs all-or-nothing semantics. */
  method: RecognitionMethod
  /** Caller-supplied "as of" for the calculation. */
  asOf: Date
}

export interface RecognitionCalculation {
  /**
   * Amount the caller SHOULD post in a new entry to bring posted-to-date
   * up to its target for this period. May be 0 if already at target.
   * Always >= 0; reversals are slice-2 caller-side.
   */
  postNowMinor: number
  /**
   * Cumulative amount that SHOULD be recognized by asOf (asOf vs
   * periodStart/End). Equal to postedToDateMinor + postNowMinor.
   */
  cumulativeMinor: number
  /**
   * What status the schedule line SHOULD have after this calc:
   *   scheduled            — nothing posted, period not yet started
   *   partially_recognized — within period, partial pro-rata target
   *   recognized           — cumulative == scheduledMinor (full)
   */
  suggestedStatus: ScheduleStatus | null
}

export type CalculateRecognitionResult =
  | { ok: true; calc: RecognitionCalculation }
  | { ok: false; error: string }
