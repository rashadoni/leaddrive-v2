/**
 * Contract Lifecycle Management types — M5 Phase 6 Block C slice 1.
 *
 * Salesforce CLM analogue. Shared shape between four pure helpers:
 *   1. state-machine        — Contract.status transitions
 *   2. clause-substituter   — render template clauses with variables
 *   3. approval-router      — advance approval chain on a decision
 *   4. renewal-alert-scheduler — compute alert calendar from endDate
 *
 * Slice 2 wires API + cron; slice 3 wires E-Sign (M6) and Revenue
 * Recognition (M4) integrations.
 */

/* ─── Contract status enum ────────────────────────────────────────────── */

/**
 * Allowed lifecycle states. State-machine helper enforces transitions
 * at the application layer; slice-2 adds a DB CHECK after backfill.
 *
 *   draft            — being authored, no approval requested
 *   pending_approval — chain in flight; ContractApprovalStage rows exist
 *   approved         — all stages green, awaiting signature/activation
 *   active           — countersigned (E-Sign or manual), in effect
 *   renewing         — renewal flow opened; renewed/expired pending
 *   renewed          — superseded by a new contract; this one stays for audit
 *   expired          — auto: endDate has passed
 *   terminated       — early termination (cancellation post-active)
 *   rejected         — any approval stage rejected
 *   cancelled        — abandoned BEFORE the contract takes effect
 *                      (legal from draft / pending_approval / approved —
 *                      the "approved → cancelled" branch covers
 *                      "all sigs collected but client backed out before
 *                      countersign"). Post-active abandonment is
 *                      `terminated`, not `cancelled`.
 */
export const CONTRACT_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "active",
  "renewing",
  "renewed",
  "expired",
  "terminated",
  "rejected",
  "cancelled",
] as const

export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

/**
 * Allowed transitions — `from → [to1, to2, ...]`. Empty array = terminal.
 * Validated by state-machine.ts; UI should grey-out illegal moves.
 *
 * Notes on edge cases:
 *   • draft → cancelled is intentional (cancel before any approval was ever requested).
 *   • renewing → renewed requires the new (renewal-source-pointing) contract
 *     to already exist; helper does NOT verify the FK — it's a state-only check.
 *   • expired and terminated are end-states for the BODY of the contract;
 *     audit history rows persist. A renewal is a NEW contract row.
 *   • renewed is a soft-terminal — kept for reporting (contract value-loss
 *     analytics, renewal-rate metrics).
 */
export const CONTRACT_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: ["active", "cancelled"],
  active: ["renewing", "expired", "terminated"],
  renewing: ["renewed", "expired", "terminated"],
  renewed: [],
  expired: [],
  terminated: [],
  rejected: [],
  cancelled: [],
}

export interface TransitionInput {
  from: ContractStatus
  to: ContractStatus
}

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string }

/* ─── Template variables + clauses ────────────────────────────────────── */

export const VARIABLE_TYPES = ["string", "number", "date", "boolean"] as const
export type VariableType = (typeof VARIABLE_TYPES)[number]

export interface TemplateVariable {
  name: string
  type: VariableType
  required: boolean
  /**
   * Optional default. Coerced to `type` at render time. `undefined` (omitted)
   * differs from `null` (explicit null default — invalid; rejected by validator).
   */
  default?: string | number | boolean
}

export interface TemplateClauseConditional {
  /** Variable name referenced — must exist in TemplateVariable[]. */
  var: string
  /** Equality value — string/number/boolean only. Compared with === post-coercion. */
  equals: string | number | boolean
}

export interface TemplateClause {
  id: string
  title: string
  /** Substitution body. `{{varName}}` markers are replaced; unknown vars surface as missingVars. */
  body: string
  /** Optional render-gate. If present and !==, the clause is skipped. */
  conditional?: TemplateClauseConditional
}

export interface SubstituteInput {
  clauses: readonly TemplateClause[]
  variables: readonly TemplateVariable[]
  /** Caller-supplied variable values keyed by name. */
  values: Readonly<Record<string, string | number | boolean | Date>>
}

export interface RenderedClause {
  id: string
  title: string
  body: string
  /** True if this clause was conditional and the condition failed. */
  skipped: boolean
}

export type SubstituteResult =
  | {
      ok: true
      clauses: RenderedClause[]
      /** Concatenated body of non-skipped clauses, joined with "\n\n". */
      renderedBody: string
    }
  | {
      ok: false
      /** Variable names required by spec but missing/null in values. */
      missingVars: string[]
      /** Variable refs in clauses that aren't declared in spec. */
      unknownVars: string[]
      /** Variable values whose type doesn't match the declared spec. */
      typeMismatches: { name: string; expected: VariableType; got: string }[]
    }

/* ─── Approval router ─────────────────────────────────────────────────── */

export const STAGE_STATUSES = ["pending", "approved", "rejected", "skipped", "superseded"] as const
export type StageStatus = (typeof STAGE_STATUSES)[number]

export const STAGE_DECISIONS = ["approve", "reject"] as const
export type StageDecision = (typeof STAGE_DECISIONS)[number]

/**
 * Parallel mode for a level (all stages sharing the same `order`).
 *
 *   all    — every stage must approve; any reject → level rejected.
 *   any    — first approval passes the level; all must reject to reject.
 *   quorum — approvedCount >= quorumThreshold passes; rejectedCount >
 *            (levelSize - quorumThreshold) rejects (quorum now impossible).
 *
 * Single-stage levels with mode "all" behave identically to the legacy
 * sequential router — backward-compat is structural.
 */
export const PARALLEL_MODES = ["all", "any", "quorum"] as const
export type ParallelMode = (typeof PARALLEL_MODES)[number]

export interface ApprovalStageState {
  /** DB id — used in updates so callers can apply by PK, not compound key. */
  stageId?: string | null
  order: number
  status: StageStatus
  /** User who closed the stage — required for approved/rejected. */
  decidedBy?: string | null
  decidedAt?: Date | null
  /**
   * Parallel mode for the level this stage belongs to.
   * All stages in a level MUST share the same parallelMode + quorumThreshold.
   * Defaults to "all" if absent — single-stage "all" level == sequential.
   */
  parallelMode?: ParallelMode | null
  /**
   * Required when parallelMode === "quorum". Ignored otherwise.
   * K = minimum approvals needed to pass the level.
   */
  quorumThreshold?: number | null
}

export interface RouteApprovalInput {
  /** Full current chain — order ascending. Helper does NOT re-sort. */
  stages: readonly ApprovalStageState[]
  /**
   * The stage being acted on — must exist in `stages` and be `pending`.
   * Identify by `stageId` (preferred for parallel levels) OR `stageOrder`
   * when there is exactly one stage per level (legacy sequential path).
   * If both are provided, `stageId` takes precedence.
   */
  stageId?: string | null
  stageOrder: number
  decision: StageDecision
  decidedBy: string
  /** Caller-supplied timestamp. Helper does NOT default to now() — testability. */
  at: Date
}

export interface ApprovalStageUpdate {
  /** DB id of the stage, when available. Used by callers to update by PK. */
  stageId?: string | null
  order: number
  status: StageStatus
  decidedBy?: string | null
  decidedAt?: Date | null
}

export type RouteApprovalResult =
  | {
      ok: true
      /**
       * The new state of ALL changed stages after the decision. Callers
       * should apply each update. Stages absent from this list are
       * intentionally unchanged.
       *
       * Each update includes `stageId` (when available) and `order`.
       * For backward-compat: callers that only use `order` continue to work
       * because `order` is always present. Callers that have migrated to
       * parallel levels should use `stageId` to avoid the Prisma compound-
       * unique accessor (which is removed when the unique is dropped).
       *
       * 3e-2 will update the approve route to use stageId for all updates.
       */
      updates: ApprovalStageUpdate[]
      /**
       * `true` if all-stages-approved post-decision (caller advances
       * Contract.status from pending_approval → approved).
       */
      chainApproved: boolean
      /**
       * `true` if this decision rejected the chain (caller advances
       * Contract.status to rejected).
       */
      chainRejected: boolean
      /**
       * The next level's order — caller writes to Contract.currentApprovalStage.
       * For parallel levels this is the lowest order > currentOrder that still
       * has pending stages. Null if chain is fully closed (approved or rejected).
       */
      nextPendingOrder: number | null
      /**
       * Whether the current level is now complete (all mode: all approved;
       * any mode: one approved; quorum: K reached). False means the level
       * is still in progress and the chain has NOT advanced.
       * Callers can use this to update UI "waiting for X more approvals" state.
       */
      levelComplete: boolean
    }
  | { ok: false; error: string }

/* ─── Renewal alert scheduler ─────────────────────────────────────────── */

/**
 * Alert windows in days-before-expiry. Pinned to a small ordered set
 * to keep DB CHECK constraint stable + to avoid spamming during the
 * last-mile crunch (we already have a tight 7-day alert).
 */
export const RENEWAL_ALERT_WINDOWS = [90, 60, 30, 14, 7] as const
export type RenewalAlertWindow = (typeof RENEWAL_ALERT_WINDOWS)[number]

export interface ScheduleAlertsInput {
  contractId: string
  /** Contract.endDate — if null/undefined, no alerts are produced. */
  endDate: Date | null | undefined
  /** Caller-supplied "now" for testability. Defaults to new Date() in caller, not helper. */
  asOf: Date
  /**
   * Optional subset of windows to emit. Defaults to ALL of
   * RENEWAL_ALERT_WINDOWS. Used to honour tenant config like
   * "skip 60-day pings for low-value contracts".
   */
  windows?: readonly RenewalAlertWindow[]
}

export interface ScheduledAlert {
  daysBeforeExpiry: RenewalAlertWindow
  dueAt: Date
}

export interface ScheduleAlertsResult {
  /**
   * Alerts whose `dueAt` is in the future relative to `asOf`. Caller
   * UPSERTs these. Past-due windows are intentionally omitted —
   * scheduling at-or-after the window has already missed its purpose.
   */
  alerts: ScheduledAlert[]
  /**
   * Windows that were past-due at `asOf` and therefore skipped.
   * Surfaced so the caller can log "contract X added 5 days before
   * expiry, 90/60/30/14-day alerts skipped".
   */
  skippedPastDue: RenewalAlertWindow[]
}
