/**
 * Public Sector Cloud types — R8 slice 1.
 *
 * Salesforce Public Sector Cloud (PSCC) analogue. Shared shape between
 * 4 pure helpers:
 *   1. state-machine                  — citizen + case + license + grant lifecycle
 *   2. case-routing-classifier        — case type + jurisdiction → agency / queue
 *   3. license-expiration-calculator  — license type + issued date → expiresAt
 *   4. grant-disbursement-calculator  — approved amount + schedule → tranche plan
 *
 * Pure — no Prisma imports.
 */

/* ─── PublicSectorOfficial role + authority ───────────────────────────── */

export const OFFICIAL_ROLES = [
  "caseworker",
  "senior_caseworker",
  "inspector",
  "grant_officer",
  "supervisor",
  "director",
  "clerk",
] as const

export type OfficialRole = (typeof OFFICIAL_ROLES)[number]

export const AUTHORITY_LEVELS = ["line", "supervisor", "director"] as const
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number]

/* ─── Citizen status + transitions ────────────────────────────────────── */

export const CITIZEN_STATUSES = ["active", "inactive", "deceased"] as const
export type CitizenStatus = (typeof CITIZEN_STATUSES)[number]

/**
 *   active   → inactive | deceased
 *   inactive → active | deceased
 *   deceased → []                                (terminal)
 */
export const CITIZEN_TRANSITIONS: Readonly<
  Record<CitizenStatus, readonly CitizenStatus[]>
> = {
  active: ["inactive", "deceased"],
  inactive: ["active", "deceased"],
  deceased: [],
}

/* ─── Case type + priority + status + transitions ─────────────────────── */

export const CASE_TYPES = [
  "benefits_application",
  "benefits_recertification",
  "complaint",
  "inquiry",
  "inspection_request",
  "hearing_request",
  "records_request",
  "appeal",
  "grievance",
] as const

export type CaseType = (typeof CASE_TYPES)[number]

export const CASE_PRIORITIES = [
  "routine",
  "elevated",
  "urgent",
  "emergency",
] as const

export type CasePriority = (typeof CASE_PRIORITIES)[number]

export const CASE_STATUSES = [
  "submitted",
  "intake",
  "assigned",
  "in_progress",
  "escalated",
  "resolved",
  "denied",
  "withdrawn",
] as const

export type CaseStatus = (typeof CASE_STATUSES)[number]

/**
 *   submitted   → intake | denied | withdrawn
 *   intake      → assigned | denied | withdrawn
 *   assigned    → in_progress | denied | withdrawn
 *   in_progress → resolved | escalated | denied | withdrawn
 *   escalated   → resolved | denied
 *   resolved    — terminal
 *   denied      — terminal
 *   withdrawn   — terminal
 */
export const CASE_TRANSITIONS: Readonly<
  Record<CaseStatus, readonly CaseStatus[]>
> = {
  submitted: ["intake", "denied", "withdrawn"],
  intake: ["assigned", "denied", "withdrawn"],
  assigned: ["in_progress", "denied", "withdrawn"],
  in_progress: ["resolved", "escalated", "denied", "withdrawn"],
  escalated: ["resolved", "denied"],
  resolved: [],
  denied: [],
  withdrawn: [],
}

/* ─── License type + status + transitions ─────────────────────────────── */

export const LICENSE_TYPES = [
  "driver",
  "business",
  "building_permit",
  "food_service",
  "liquor",
  "professional",
  "hunting_fishing",
  "event_permit",
  "other",
] as const

export type LicenseType = (typeof LICENSE_TYPES)[number]

export const LICENSE_STATUSES = [
  "applied",
  "under_review",
  "issued",
  "denied",
  "expired",
  "suspended",
  "revoked",
] as const

export type LicenseStatus = (typeof LICENSE_STATUSES)[number]

/**
 *   applied      → under_review | denied
 *   under_review → issued | denied
 *   issued       → expired | suspended | revoked
 *   suspended    → issued (reinstated) | revoked
 *   denied       — terminal
 *   expired      — terminal
 *   revoked      — terminal
 */
export const LICENSE_TRANSITIONS: Readonly<
  Record<LicenseStatus, readonly LicenseStatus[]>
> = {
  applied: ["under_review", "denied"],
  under_review: ["issued", "denied"],
  issued: ["expired", "suspended", "revoked"],
  suspended: ["issued", "revoked"],
  denied: [],
  expired: [],
  revoked: [],
}

/* ─── Grant status + transitions ──────────────────────────────────────── */

export const GRANT_STATUSES = [
  "submitted",
  "under_review",
  "approved",
  "disbursing",
  "disbursed",
  "denied",
  "withdrawn",
  "cancelled",
] as const

export type GrantStatus = (typeof GRANT_STATUSES)[number]

/**
 *   submitted    → under_review | withdrawn
 *   under_review → approved | denied | withdrawn
 *   approved     → disbursing | cancelled
 *   disbursing   → disbursed | cancelled
 *   disbursed    — terminal
 *   denied       — terminal
 *   withdrawn    — terminal
 *   cancelled    — terminal
 */
export const GRANT_TRANSITIONS: Readonly<
  Record<GrantStatus, readonly GrantStatus[]>
> = {
  submitted: ["under_review", "withdrawn"],
  under_review: ["approved", "denied", "withdrawn"],
  approved: ["disbursing", "cancelled"],
  disbursing: ["disbursed", "cancelled"],
  disbursed: [],
  denied: [],
  withdrawn: [],
  cancelled: [],
}

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult = { ok: true } | { ok: false; error: string }

/* ─── Case routing classifier I/O ─────────────────────────────────────── */

export interface RouteCaseInput {
  caseType: CaseType
  /** Optional caller-supplied priority override (operator escalates
   *  based on context not visible to the classifier — e.g. media
   *  attention on a complaint). */
  priorityOverride?: CasePriority
  /** Jurisdiction slug — slice-2 may use to vary agency assignment
   *  per region; slice-1 uses caseType→agency mapping only. */
  jurisdictionSlug?: string
}

export interface CaseRoute {
  agencySlug: string
  suggestedPriority: CasePriority
  /** Statutory deadline in days from intake (calculator caller adds
   *  to intakeStartedAt to compute statutoryDueAt). NULL = no
   *  statutory deadline. */
  statutoryResponseDays: number | null
}

export type RouteCaseResult =
  | { ok: true; route: CaseRoute }
  | { ok: false; error: string }

/* ─── License expiration calculator I/O ───────────────────────────────── */

export interface CalculateLicenseExpirationInput {
  licenseType: LicenseType
  /** When the license was actually issued (state transitioned to issued). */
  issuedAt: Date
  /** Optional override — caller passes a custom term (slice-2 may
   *  carve per-jurisdiction term lengths from a config table). */
  termYearsOverride?: number
}

export interface LicenseExpirationOutput {
  expiresAt: Date
  termYears: number
  /** Days of grace period after expiration before status flips to
   *  revoked (slice-2 cron checks this). */
  gracePeriodDays: number
}

export type CalculateLicenseExpirationResult =
  | { ok: true; expiration: LicenseExpirationOutput }
  | { ok: false; error: string }

/* ─── Grant disbursement calculator I/O ───────────────────────────────── */

export interface CalculateGrantDisbursementInput {
  /** Total approved grant amount. */
  approvedAmount: number
  /** Disbursement schedule (DB CHECK):
   *   lump_sum  — single disbursement
   *   quarterly — 4 equal tranches
   *   monthly   — 12 equal tranches
   *   milestone — caller supplies milestoneCount + per-milestone-pct */
  schedule: DisbursementSchedule
  /** For milestone schedule: number of milestones (2..100). */
  milestoneCount?: number
  /** For milestone schedule: per-milestone pct array — must sum to 100
   *  and have length == milestoneCount. */
  milestonePercentages?: readonly number[]
  /** Start date of disbursement (e.g. approvedAt or program start). */
  startDate: Date
}

export const DISBURSEMENT_SCHEDULES = [
  "lump_sum",
  "quarterly",
  "monthly",
  "milestone",
] as const

export type DisbursementSchedule = (typeof DISBURSEMENT_SCHEDULES)[number]

export interface DisbursementTranche {
  /** Tranche sequence number, 1-indexed. */
  sequence: number
  /** Scheduled disbursement date. */
  scheduledDate: Date
  /** Tranche amount (sum of all tranches == approvedAmount). */
  amount: number
}

export interface GrantDisbursementPlan {
  tranches: DisbursementTranche[]
  /** Sum of all tranche amounts (caller verifies == approvedAmount). */
  totalScheduled: number
}

export type CalculateGrantDisbursementResult =
  | { ok: true; plan: GrantDisbursementPlan }
  | { ok: false; error: string }
