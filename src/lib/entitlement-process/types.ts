/**
 * B10 Entitlement Process — types + state machines.
 *
 * Salesforce Service Cloud Entitlement Process analogue. Granular
 * milestone layer on top of the existing SlaPolicy (which only tracks
 * coarse firstResponseHours + resolutionHours).
 *
 * Slice-1 contract. Mirrors Prisma schema + DB triggers
 * (prisma/migrations/20260520120000_entitlement_process/migration.sql).
 *
 * NOT a replacement for SlaPolicy — works WITH it. SlaPolicy stays the
 * coarse policy + business-hours config; this layer adds per-milestone
 * granularity for enterprise support contracts.
 */

// ── Support level ───────────────────────────────────────────────

export type SupportLevel = "basic" | "standard" | "premium" | "enterprise"

export const SUPPORT_LEVELS: readonly SupportLevel[] = [
  "basic",
  "standard",
  "premium",
  "enterprise",
] as const

/**
 * Default dueWithinSeconds multipliers per support level — slice-2
 * admin UI uses these as starter values when an operator creates a
 * new entitlement. Lower-tier multiplier means LONGER windows.
 *
 * E.g. if the policy says first_response = 14400s (4h):
 *   basic:      14400 * 1.5 = 6h
 *   standard:   14400 * 1.0 = 4h
 *   premium:    14400 * 0.5 = 2h
 *   enterprise: 14400 * 0.25 = 1h
 *
 * Slice-1 helpers don't apply these — they're catalog defaults only.
 */
export const SUPPORT_LEVEL_MULTIPLIERS: Readonly<Record<SupportLevel, number>> =
  {
    basic: 1.5,
    standard: 1.0,
    premium: 0.5,
    enterprise: 0.25,
  }

// ── Entitlement lifecycle ───────────────────────────────────────

export type EntitlementStatus =
  | "draft"
  | "active"
  | "suspended"
  | "expired"
  | "cancelled"

export const ENTITLEMENT_STATUSES: readonly EntitlementStatus[] = [
  "draft",
  "active",
  "suspended",
  "expired",
  "cancelled",
] as const

/**
 * Mirror of entitlements_lifecycle_fn DB trigger.
 *   draft     → active | cancelled
 *   active    → suspended | expired | cancelled
 *   suspended → active | expired | cancelled
 *   expired   → (terminal)
 *   cancelled → (terminal)
 */
export const ENTITLEMENT_STATUS_TRANSITIONS: Readonly<
  Record<EntitlementStatus, readonly EntitlementStatus[]>
> = {
  draft: ["active", "cancelled"],
  active: ["suspended", "expired", "cancelled"],
  suspended: ["active", "expired", "cancelled"],
  expired: [],
  cancelled: [],
}

// ── Milestone types ─────────────────────────────────────────────

export type MilestoneType =
  | "first_response"
  | "problem_identified"
  | "workaround_delivered"
  | "resolution"
  | "escalation"

export const MILESTONE_TYPES: readonly MilestoneType[] = [
  "first_response",
  "problem_identified",
  "workaround_delivered",
  "resolution",
  "escalation",
] as const

/**
 * Default dueWithinSeconds per milestone type (standard support level).
 * Slice-2 admin UI uses these as starter values when an operator adds
 * a new milestone definition. Slice-1 helpers don't apply automatically.
 */
export const DEFAULT_MILESTONE_DUE_SECONDS: Readonly<
  Record<MilestoneType, number>
> = {
  first_response: 4 * 60 * 60, // 4 hours
  problem_identified: 24 * 60 * 60, // 1 day
  workaround_delivered: 3 * 24 * 60 * 60, // 3 days
  resolution: 7 * 24 * 60 * 60, // 7 days
  escalation: 2 * 60 * 60, // 2 hours — internal handoff
}

// ── Severity tier ───────────────────────────────────────────────

export type SeverityTier = "critical" | "high" | "normal" | "low"

export const SEVERITY_TIERS: readonly SeverityTier[] = [
  "critical",
  "high",
  "normal",
  "low",
] as const

/**
 * Severity → due-window multiplier. Critical incidents get tighter
 * windows; low-priority get looser. Slice-1 helper milestone-due-
 * calculator uses these.
 */
export const SEVERITY_DUE_MULTIPLIERS: Readonly<Record<SeverityTier, number>> =
  {
    critical: 0.25,
    high: 0.5,
    normal: 1.0,
    low: 2.0,
  }

// ── Milestone instance lifecycle ────────────────────────────────

export type MilestoneStatus =
  | "pending"
  | "in_progress"
  | "met"
  | "missed"
  | "waived"

export const MILESTONE_STATUSES: readonly MilestoneStatus[] = [
  "pending",
  "in_progress",
  "met",
  "missed",
  "waived",
] as const

/**
 * Mirror of entitlement_ticket_milestones_lifecycle_fn.
 *   pending      → in_progress | waived
 *   in_progress  → met | missed | waived
 *   met          → (terminal)
 *   missed       → met | waived (operator override after-the-fact)
 *   waived       → (terminal)
 *
 * Important: "missed" is NOT terminal. After-the-fact corrections are
 * legitimate (customer late-acks, deal saved, etc.).
 */
export const MILESTONE_STATUS_TRANSITIONS: Readonly<
  Record<MilestoneStatus, readonly MilestoneStatus[]>
> = {
  pending: ["in_progress", "waived"],
  in_progress: ["met", "missed", "waived"],
  met: [],
  missed: ["met", "waived"],
  waived: [],
}

// ── Audit event type ────────────────────────────────────────────

export type AuditEventType =
  | "entitlement_created"
  | "entitlement_updated"
  | "entitlement_activated"
  | "entitlement_suspended"
  | "entitlement_resumed"
  | "entitlement_expired"
  | "entitlement_cancelled"
  | "milestone_started"
  | "milestone_met"
  | "milestone_missed"
  | "milestone_waived"
  | "milestone_escalated"
  | "milestone_re_anchored"

export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  "entitlement_created",
  "entitlement_updated",
  "entitlement_activated",
  "entitlement_suspended",
  "entitlement_resumed",
  "entitlement_expired",
  "entitlement_cancelled",
  "milestone_started",
  "milestone_met",
  "milestone_missed",
  "milestone_waived",
  "milestone_escalated",
  "milestone_re_anchored",
] as const

// ── Slim shapes for helpers ─────────────────────────────────────

export interface MilestoneDefinitionInput {
  type: MilestoneType
  /** From the definition row. */
  dueWithinSeconds: number
  /** Definition's severity-tier (NULL means "all"). */
  severityTier?: SeverityTier | null
  isRequired: boolean
}

export interface MilestoneDueCalcInput {
  definition: MilestoneDefinitionInput
  /** Ticket creation time — usually the milestone-anchor. */
  ticketCreatedAt: Date
  /** Ticket's actual severity. Used to pick the right definition + apply multiplier. */
  ticketSeverity: SeverityTier
  /** Optional custom anchor (not ticket-create time) — e.g. resolution anchored to first-response complete. */
  anchorTime?: Date
  /** Optional per-call multiplier override (slice-2 may pass holiday adjustment). */
  multiplierOverride?: number
}

export interface MilestoneDueResult {
  dueAt: Date
  /** Effective seconds used (after multiplier). */
  effectiveDueWithinSeconds: number
  /**
   * True if the definition's severityTier matches the ticket's severity
   * (or definition has NULL severity meaning "all"). Slice-2 cron uses
   * this to pick the most-specific definition.
   */
  appliesTo: boolean
}

export interface MilestoneStatusEvaluationInput {
  milestone: {
    status: MilestoneStatus
    dueAt: Date
    completedAt?: Date | null
    missedAt?: Date | null
    waivedAt?: Date | null
  }
  /** "Now" — caller-supplied for deterministic tests. */
  asOf: Date
}

export interface MilestoneStatusEvaluationResult {
  /** Status that should be persisted (may differ from current if overdue). */
  effectiveStatus: MilestoneStatus
  /** True if status changed from input.milestone.status. */
  needsTransition: boolean
  /**
   * Seconds remaining until due (positive = ok, negative = overdue).
   * NULL when status is terminal.
   */
  secondsToDeadline: number | null
  /** True if overdue but not yet flipped to "missed". */
  isOverdueButNotMissed: boolean
}

// ── Entitlement validity check ──────────────────────────────────

export interface EntitlementValidityInput {
  entitlement: {
    status: EntitlementStatus
    validFrom: Date
    validTo: Date | null
  }
  asOf: Date
}

export interface EntitlementValidityResult {
  /** True if status=active AND now is within [validFrom, validTo). */
  isHonored: boolean
  /** Diagnostic for slice-2 UI. */
  reason:
    | "honored"
    | "not_yet_active"
    | "expired"
    | "suspended"
    | "cancelled"
    | "draft"
    | "outside_validity_window"
  /** Seconds until validTo (positive = remaining; null when validTo is null). */
  secondsUntilExpiry: number | null
}

// ── Escalation planner ─────────────────────────────────────────-

/**
 * Per-level escalation config. Slice-2 admin UI lets ops configure;
 * slice-1 helper accepts as input.
 */
export interface EscalationLevelConfig {
  level: number
  /** Seconds to wait after going overdue before this level fires. */
  delaySeconds: number
  /** Action description for audit trail (slice-2 wires the actual side-effect). */
  action: string
}

/**
 * Default escalation ladder. Slice-2 cron uses this when no per-
 * entitlement override is configured. Pessimistic — assumes 30-min,
 * 2h, 8h ladder typical for enterprise tickets.
 */
export const DEFAULT_ESCALATION_LADDER: ReadonlyArray<EscalationLevelConfig> = [
  { level: 1, delaySeconds: 30 * 60, action: "notify_assignee" },
  { level: 2, delaySeconds: 2 * 60 * 60, action: "notify_manager" },
  { level: 3, delaySeconds: 8 * 60 * 60, action: "page_oncall" },
] as const

export interface EscalationPlanInput {
  /** Milestone went overdue at this instant. NULL → not yet overdue. */
  overdueAt: Date | null
  /** Current escalation level (0 = none fired yet). */
  currentLevel: number
  asOf: Date
  /** Optional override ladder (per-entitlement). */
  ladder?: ReadonlyArray<EscalationLevelConfig>
}

export interface EscalationStep {
  level: number
  shouldFire: boolean
  /** When this level should fire (overdueAt + delaySeconds). */
  fireAt: Date
  action: string
}

export interface EscalationPlanResult {
  /** Steps that should fire now (asOf >= fireAt AND level > currentLevel). */
  toFireNow: EscalationStep[]
  /** Next-upcoming step (level > currentLevel + 1 that hasn't fired yet). */
  next: EscalationStep | null
  /** All ladder steps with their fireAt computed (for UI display). */
  allSteps: EscalationStep[]
}
