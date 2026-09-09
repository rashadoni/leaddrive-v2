/**
 * Subscription Management types — D4 Phase 6 Block A slice 1.
 *
 * Salesforce Subscription Management analogue. Four pure-helper
 * workflows on top of the existing RecurringInvoice (which D4 does
 * not replace — RecurringInvoice = invoice-generation engine,
 * Subscription = customer lifecycle):
 *
 *   1. Subscription state machine — trial → active → past_due →
 *      cancelled, with paused / resumed branch and dunning recovery.
 *   2. Proration calculator — mid-cycle plan changes produce a net
 *      charge or credit based on days-remaining math.
 *   3. Dunning scheduler — failed-charge retry timestamps + final-
 *      attempt flag (cap-N retries → auto-cancel).
 *   4. Billing-period calculator — derive next currentPeriodStart /
 *      currentPeriodEnd / nextBillingAt from interval + count.
 */

/* ─── Subscription state machine ──────────────────────────────────────── */

/**
 * Tuple of valid subscription statuses — single source of truth so
 * route Zod schemas + permission checks all consume one constant.
 */
export const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "past_due",
  "paused",
  "cancelled",
] as const

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/**
 * Tuple of `SubscriptionEvent.eventType` values — keep in sync with
 * the DB CHECK at migration `subscription_events_type_check`. `cancelled`
 * is the terminal event — no `reactivated`, because the SM treats
 * cancellation as one-way. Win-back flows create a new Subscription.
 */
export const SUBSCRIPTION_EVENT_TYPES = [
  "created",
  "trial_ended",
  "activated",
  "paused",
  "resumed",
  "plan_changed",
  "dunning_started",
  "dunning_succeeded",
  "dunning_failed",
  "cancelled",
] as const

export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number]

/**
 * Forward transitions.
 *
 *   trial → active (paid first invoice / trial converted)
 *   trial → past_due (auto-charge at trial end failed)
 *   trial → cancelled (customer cancels during trial)
 *
 *   active → past_due (recurring charge failed)
 *   active → paused (admin pause — billing halts; current period runs out)
 *   active → cancelled (cancel — immediate; cancelAtPeriodEnd is a flag set
 *                       on the row, not a separate state)
 *
 *   past_due → active (payment recovered via dunning)
 *   past_due → cancelled (dunning exhausted)
 *
 *   paused → active (admin resume)
 *   paused → cancelled (admin cancel while paused)
 *
 *   cancelled → [terminal]
 */
export const SUBSCRIPTION_TRANSITIONS: Readonly<
  Record<SubscriptionStatus, readonly SubscriptionStatus[]>
> = {
  trial: ["active", "past_due", "cancelled"],
  active: ["past_due", "paused", "cancelled"],
  past_due: ["active", "cancelled"],
  paused: ["active", "cancelled"],
  cancelled: [],
}

export interface AdvanceSubscriptionInput {
  from: SubscriptionStatus
  to: SubscriptionStatus
}

export interface AdvanceSubscriptionOk {
  ok: true
  /**
   * Hints to the caller which timestamp side-effects + event-row to write:
   *   activating  — set status=active; emit "activated" event (only used for
   *                 past_due → active dunning-recovery; paused → active is
   *                 the `resuming` tag below)
   *   pausing     — set pausedAt = now(); emit "paused" event
   *   resuming    — set resumedAt = now(); emit "resumed" event
   *   suspending  — flip to past_due (no timestamp on the row beyond status);
   *                 emit "dunning_started" event
   *   cancelling  — set cancelledAt = now() + nextBillingAt=null; emit
   *                 "cancelled" event
   *   trialEnding — flip from trial; emit "trial_ended" event in addition
   *                 to "activated" / "dunning_started" as appropriate
   *
   * Cancellation is one-way — there is no "reactivated" event. Win-back
   * flows create a new Subscription row (link via metadata if needed).
   */
  sideEffect:
    | "activating"
    | "pausing"
    | "resuming"
    | "suspending"
    | "cancelling"
    | "trialEnding"
}

export interface AdvanceSubscriptionFail {
  ok: false
  error: string
}

export type AdvanceSubscriptionResult =
  | AdvanceSubscriptionOk
  | AdvanceSubscriptionFail

/* ─── Proration calculator ────────────────────────────────────────────── */

export interface ProrationInput {
  /**
   * Current (old) plan price per cycle. Stored as Float for
   * consistency with the DB schema; slice-3 may swap to Decimal.
   */
  currentUnitAmount: number
  /** New plan price per cycle. */
  newUnitAmount: number
  /**
   * Current billing period — used to compute days-elapsed + days-remaining.
   * Both must be valid Date instances with start ≤ now ≤ end.
   */
  currentPeriodStart: Date
  currentPeriodEnd: Date
  /** When the proration is being applied — caller-supplied (testability). */
  asOf: Date
}

export interface ProrationResult {
  /**
   * Net amount the customer owes today:
   *   positive = additional charge (upgrade)
   *   negative = credit (downgrade)
   *   zero     = no proration (lateral move / change applied at period end)
   * Rounded to 2 decimals.
   */
  prorationAmount: number
  /** Unused credit on the OLD plan for the remainder of the period. */
  unusedCredit: number
  /** Charge on the NEW plan for the remainder of the period. */
  newCharge: number
  /** Days remaining in the period (>= 0). */
  daysRemaining: number
  /** Total days in the period (> 0). */
  daysInPeriod: number
}

/* ─── Dunning scheduler ───────────────────────────────────────────────── */

export interface DunningConfig {
  /** Sequence of retry delays (in days) AFTER the initial failure. */
  retryDelayDays: readonly number[]
}

/**
 * Default dunning schedule mirrors common SaaS practice:
 *   attempt 1: 1 day after failure
 *   attempt 2: 3 days after first failure (delta 2)
 *   attempt 3: 7 days after first failure (delta 4)
 *   attempt 4: 14 days after first failure (delta 7) ← FINAL
 * After attempt 4 fails, slice-3 cron auto-cancels the subscription.
 */
export const DEFAULT_DUNNING_CONFIG: DunningConfig = {
  retryDelayDays: [1, 3, 7, 14],
}

export interface ScheduleDunningInput {
  /**
   * 1-indexed attempt number to schedule. attemptNumber=1 schedules the
   * FIRST retry after the initial failure.
   */
  attemptNumber: number
  /**
   * The timestamp of the original failure that put the subscription
   * into past_due. All retry deltas are measured from this anchor.
   */
  initialFailureAt: Date
  /** Override the default sequence if the tenant has a custom dunning policy. */
  config?: DunningConfig
}

export interface ScheduleDunningOk {
  ok: true
  /** Absolute scheduledAt for this attempt. */
  scheduledAt: Date
  /** True when this is the LAST allowed attempt — slice-3 cron auto-cancels on failure. */
  isFinalAttempt: boolean
}

export interface ScheduleDunningFail {
  ok: false
  error: string
}

export type ScheduleDunningResult = ScheduleDunningOk | ScheduleDunningFail

/* ─── Billing-period calculator ───────────────────────────────────────── */

/** Subset of SubscriptionPlan / Subscription billing config the calculator needs. */
export interface BillingIntervalConfig {
  /** "day" | "week" | "month" | "year" (matches DB CHECK). */
  billingInterval: "day" | "week" | "month" | "year"
  /** Positive integer. */
  billingIntervalCount: number
}

export interface NextPeriodInput {
  /** Anchor — usually the prior currentPeriodEnd (the next period starts there). */
  from: Date
  config: BillingIntervalConfig
}

export interface NextPeriodResult {
  currentPeriodStart: Date
  currentPeriodEnd: Date
  /**
   * When the next charge fires. Defaults to `currentPeriodStart`
   * (Stripe convention: charge at start of next cycle). Callers
   * who use net-30 or similar should adjust downstream.
   */
  nextBillingAt: Date
}

/* ─── Plan snapshot (route boundary) ──────────────────────────────────── */

/**
 * Shared shape for the `SubscriptionPlan` columns the slice-2 routes
 * SELECT before snapshotting onto a Subscription or running the
 * proration calculator. Two routes consume the snapshot — the create
 * path (full row including trialDays) and the plan-change path
 * (everything except trialDays, which only matters at create time).
 *
 * ⚠️ Keep in sync with the `select { ... }` clauses in
 * `src/app/api/v1/subscriptions/route.ts` and
 * `src/app/api/v1/subscriptions/[id]/plan-change/route.ts`.
 */
export interface PlanSnapshotCore {
  id: string
  unitAmount: unknown   // Decimal(18,4) from Prisma — use decimalToNumber() before arithmetic
  currency: string
  billingInterval: "day" | "week" | "month" | "year"
  billingIntervalCount: number
  isActive: boolean
}

/** Used by the create-subscription path — includes `trialDays`. */
export interface PlanSnapshotForCreate extends PlanSnapshotCore {
  trialDays: number
}

/* ─── Initial-period calculator (trial-aware) ─────────────────────────── */

/**
 * For a NEW subscription. When `trialDays > 0`:
 *   period 1 = trial period (currentPeriodStart=now, currentPeriodEnd=
 *              now+trialDays, trialEndsAt=now+trialDays, nextBillingAt=
 *              trialEndsAt — fires at trial conversion).
 *   period 2 = first paid period (created at trial conversion by the
 *              caller via calculateNextPeriod(trialEndsAt, planConfig)).
 *
 * When `trialDays = 0`:
 *   period 1 = first paid period directly (trialEndsAt=null,
 *              currentPeriodStart=now, end=now+interval, nextBillingAt=now).
 */
export interface InitialPeriodInput {
  /** Caller-supplied — usually now(). Testability anchor. */
  anchor: Date
  /** Trial days from SubscriptionPlan.trialDays. 0 = no trial. */
  trialDays: number
  /** Plan's billing config — applies to period 2 (post-trial). */
  config: BillingIntervalConfig
}

export interface InitialPeriodResult {
  /**
   * Initial subscription status — "trial" if trialDays > 0, else "active".
   * Caller writes to Subscription.status.
   */
  initialStatus: "trial" | "active"
  /** When the trial ends, or null when there's no trial. */
  trialEndsAt: Date | null
  currentPeriodStart: Date
  currentPeriodEnd: Date
  /**
   * When the FIRST charge fires:
   *   - trial: at trialEndsAt (when the trial converts)
   *   - no trial: at currentPeriodStart (immediate)
   */
  nextBillingAt: Date
}
