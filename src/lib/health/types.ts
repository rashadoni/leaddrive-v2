/**
 * Health Cloud types — R2 slice 1.
 *
 * Salesforce Health Cloud analogue. Shared shape between 4 pure helpers:
 *   1. state-machine                 — patient + encounter + care-plan lifecycle
 *   2. medical-record-validator      — per-type payload-shape gate
 *   3. care-plan-progress-calculator — goals + records → progress
 *   4. appointment-scheduler         — slot-fit against existing encounters
 *
 * Pure — no Prisma imports.
 *
 * Slice-1 deliberately excludes HIPAA enforcement (encryption + audit
 * log), AI triage (slice-3), telehealth/FHIR adapters, patient-portal,
 * provider admin UI. Schema annotations + DB triggers carry "what data
 * SHOULD look like"; this file carries "what state transitions are
 * legal + what payload shapes pass validation".
 */

/* ─── Patient status + transitions ────────────────────────────────────── */

export const PATIENT_STATUSES = [
  "active",
  "inactive",
  "discharged",
  "deceased",
] as const

export type PatientStatus = (typeof PATIENT_STATUSES)[number]

/**
 *   active     → inactive | discharged | deceased
 *   inactive   → active | discharged | deceased
 *   discharged → active (re-admit) | deceased
 *   deceased   → []                              (terminal)
 */
export const PATIENT_TRANSITIONS: Readonly<
  Record<PatientStatus, readonly PatientStatus[]>
> = {
  active: ["inactive", "discharged", "deceased"],
  inactive: ["active", "discharged", "deceased"],
  discharged: ["active", "deceased"],
  deceased: [],
}

/* ─── Provider role ───────────────────────────────────────────────────── */

export const PROVIDER_ROLES = [
  "physician",
  "nurse_practitioner",
  "physician_assistant",
  "registered_nurse",
  "specialist",
  "therapist",
  "technician",
  "admin",
] as const

export type ProviderRole = (typeof PROVIDER_ROLES)[number]

/* ─── Medical record type + severity + sensitivity ────────────────────── */

export const MEDICAL_RECORD_TYPES = [
  "visit_summary",
  "diagnosis",
  "lab_result",
  "procedure",
  "medication",
  "allergy",
  "immunization",
  "vital_signs",
  "imaging",
  "discharge_summary",
] as const

export type MedicalRecordType = (typeof MEDICAL_RECORD_TYPES)[number]

export const MEDICAL_RECORD_SEVERITIES = [
  "informational",
  "low",
  "moderate",
  "high",
  "critical",
] as const

export type MedicalRecordSeverity = (typeof MEDICAL_RECORD_SEVERITIES)[number]

export const MEDICAL_RECORD_SENSITIVITIES = [
  "normal",
  "sensitive",
  "restricted",
] as const

export type MedicalRecordSensitivity =
  (typeof MEDICAL_RECORD_SENSITIVITIES)[number]

/* ─── Encounter type + status + transitions ───────────────────────────── */

export const ENCOUNTER_TYPES = [
  "in_person",
  "telehealth",
  "phone",
  "home_visit",
  "inpatient",
] as const

export type EncounterType = (typeof ENCOUNTER_TYPES)[number]

export const ENCOUNTER_STATUSES = [
  "scheduled",
  "checked_in",
  "in_progress",
  "completed",
  "no_show",
  "cancelled",
] as const

export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number]

/**
 *   scheduled    → checked_in | no_show | cancelled
 *   checked_in   → in_progress | cancelled
 *   in_progress  → completed | cancelled
 *   completed    → []                            (terminal)
 *   no_show      → []                            (terminal)
 *   cancelled    → []                            (terminal)
 *
 * ⚠️ TIMESTAMP-WRITE CONTRACT (caller responsibility):
 * Every status transition MUST set the corresponding timestamp
 * column on the row in the same write:
 *   → checked_in   ⇒ set checkedInAt = now()
 *   → in_progress  ⇒ set startedAt   = now()
 *   → completed    ⇒ set completedAt = now()
 *   → cancelled    ⇒ set cancelledAt = now() (+ cancellationReason)
 *   → no_show      ⇒ set noShowAt    = now() (slice-2 coherence CHECK
 *                    enforces; existing rows from before the migration
 *                    keep NULL noShowAt by forward-only design)
 * DB CHECK constraints reject writes that violate the rule; this
 * comment surfaces the contract so route layer doesn't fight the CHECK
 * at runtime. Terminal timestamps are immutable once set (see
 * health_encounters_timestamps_immutable_trigger).
 */
export const ENCOUNTER_TRANSITIONS: Readonly<
  Record<EncounterStatus, readonly EncounterStatus[]>
> = {
  scheduled: ["checked_in", "no_show", "cancelled"],
  checked_in: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  no_show: [],
  cancelled: [],
}

/* ─── Care plan status + transitions ──────────────────────────────────── */

export const CARE_PLAN_STATUSES = [
  "draft",
  "active",
  "paused",
  "completed",
  "cancelled",
] as const

export type CarePlanStatus = (typeof CARE_PLAN_STATUSES)[number]

/**
 *   draft     → active | cancelled
 *   active    → paused | completed | cancelled
 *   paused    → active | cancelled
 *   completed → []                              (terminal)
 *   cancelled → []                              (terminal)
 */
export const CARE_PLAN_TRANSITIONS: Readonly<
  Record<CarePlanStatus, readonly CarePlanStatus[]>
> = {
  draft: ["active", "cancelled"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: [],
  cancelled: [],
}

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult = { ok: true } | { ok: false; error: string }

/* ─── Medical record validator I/O ────────────────────────────────────── */

export interface ValidateMedicalRecordInput {
  recordType: MedicalRecordType
  details: unknown
  severity: MedicalRecordSeverity
  sensitivity: MedicalRecordSensitivity
}

export type ValidateMedicalRecordResult =
  | { ok: true }
  | { ok: false; error: string; field?: string }

/* ─── Care plan goal shape ────────────────────────────────────────────── */

export const GOAL_COMPARATORS = ["gte", "lte", "eq"] as const
export type GoalComparator = (typeof GOAL_COMPARATORS)[number]

export const GOAL_KPI_SOURCES = [
  "medical_record_count",
  "medication_adherence",
] as const

export type GoalKpiSource = (typeof GOAL_KPI_SOURCES)[number]

export interface CarePlanGoal {
  id: string
  label: string
  metric: string
  targetValue: number
  comparator: GoalComparator
  kpiSource: GoalKpiSource
}

export interface GoalProgress {
  goalId: string
  observedValue: number
  targetValue: number
  comparator: GoalComparator
  met: boolean
  /** 0-100, clamped. For lte, lower observed = higher progress. */
  progressPct: number
}

export interface CarePlanProgressInput {
  goals: readonly CarePlanGoal[]
  /** Per-source observations supplied by caller (slice-2 worker fetches from DB). */
  observations: Readonly<Record<GoalKpiSource, number>>
}

export interface CarePlanProgressSummary {
  perGoal: GoalProgress[]
  /** 0-100 — average over all goals. NaN if no goals. */
  overallPct: number
  goalsMet: number
  goalsTotal: number
}

export type CarePlanProgressResult =
  | { ok: true; summary: CarePlanProgressSummary }
  | { ok: false; error: string }

/* ─── Appointment scheduler I/O ───────────────────────────────────────── */

export interface AppointmentRequest {
  providerId: string
  patientId: string
  scheduledStartAt: Date
  scheduledEndAt: Date
}

/**
 * Existing encounter slot fetched by caller (slice-2 worker queries
 * DB for relevant provider's encounters in the same window).
 *
 * `id` is the encounter id (so caller can present "conflict with
 * encounter X"). `status` lets the scheduler ignore cancelled / no_show
 * slots (they don't block).
 */
export interface ExistingSlot {
  id: string
  providerId: string
  scheduledStartAt: Date
  scheduledEndAt: Date
  status: EncounterStatus
}

export interface ScheduleAppointmentInput {
  request: AppointmentRequest
  existingSlots: readonly ExistingSlot[]
  /**
   * Minimum gap (minutes) between adjacent encounters for the same
   * provider. Default 0 (back-to-back allowed).
   */
  minGapMinutes?: number
}

export interface AppointmentConflict {
  conflictingSlotId: string
  reason: "overlap" | "gap_too_small"
}

export type ScheduleAppointmentResult =
  | { ok: true }
  /** Hard input validation failure (bad Date, negative gap, end ≤ start). */
  | { ok: false; reason: "invalid_input"; error: string }
  /** Calendar conflicts — caller may present full list to user. */
  | { ok: false; reason: "conflicts"; conflicts: AppointmentConflict[] }
