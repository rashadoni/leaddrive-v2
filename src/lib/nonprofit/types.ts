/**
 * Nonprofit Cloud types — R9 Phase 5 slice 1.
 *
 * Salesforce NPSP analogue. Donor + Program + Donation + Grant +
 * VolunteerActivity primitives with pure helpers for:
 *   - donor giving roll-up (lifetime / period / by program)
 *   - grant utilisation % (disbursed/awarded, spent/disbursed)
 *   - volunteer-hours aggregation (by person / program / period)
 *
 * Slice 1 ships schema + helpers + CRUD routes. Slice 2 wires the
 * recurring-donation cron + grant-lifecycle workflows + impact-
 * reporting dashboards + N14 platform-events integration.
 */

export type DonorType = "individual" | "organization"
export type ProgramStatus = "planning" | "active" | "completed" | "paused"
export type DonationType = "one_time" | "recurring"
export type GrantStatus =
  | "applied"
  | "awarded"
  | "active"
  | "reporting"
  | "closed"
  | "declined"
export type VolunteerActivityType =
  | "event"
  | "office"
  | "fundraising"
  | "outreach"
  | "other"

/* ─── Donor roll-up ───────────────────────────────────────────────────── */

export interface DonationRow {
  id: string
  donorId: string
  programId?: string | null
  amount: number
  currency: string
  receivedAt: Date
  donationType: DonationType
}

export interface DonorRollup {
  donorId: string
  /** Total lifetime giving across all currencies (caller normalises if needed). */
  lifetimeTotal: number
  /** Number of donations across the donor's history. */
  donationCount: number
  /** Largest single gift. */
  largestGift: number
  /** First donation date — null when no donations recorded. */
  firstGiftAt: Date | null
  /** Most recent donation date — null when no donations recorded. */
  mostRecentGiftAt: Date | null
  /** Recurring vs one-time split. */
  recurringTotal: number
  oneTimeTotal: number
  /** Per-year giving for last 5 calendar years (descending by year). */
  byYear: Array<{ year: number; total: number; count: number }>
  /** Per-program giving (descending by total). */
  byProgram: Array<{ programId: string; total: number; count: number }>
}

/* ─── Grant utilisation ───────────────────────────────────────────────── */

export interface GrantRow {
  awardedAmount: number
  disbursedAmount: number
  spentAmount: number
  periodStart: Date | null
  periodEnd: Date | null
  status: GrantStatus
}

export interface GrantUtilisation {
  /** disbursedAmount / awardedAmount — null when awarded is 0. */
  disbursedPct: number | null
  /** spentAmount / disbursedAmount — null when disbursed is 0. */
  spentPct: number | null
  /** Overall: spentAmount / awardedAmount — null when awarded is 0. */
  overallUtilisationPct: number | null
  /** Amount still available to spend (disbursedAmount - spentAmount). */
  remainingFunds: number
  /** Amount still to be drawn from the funder (awardedAmount - disbursedAmount). */
  pendingDisbursement: number
  /** Days remaining in the period of performance — null when no end date. */
  daysRemainingInPeriod: number | null
  /** Caller-actionable flag — grant is at risk of underspend. */
  atRisk: boolean
}

/* ─── Volunteer roll-up ───────────────────────────────────────────────── */

export interface VolunteerActivityRow {
  contactId?: string | null
  volunteerName: string
  programId?: string | null
  hoursLogged: number
  activityType: VolunteerActivityType
  occurredAt: Date
}

export type VolunteerGroupBy = "volunteer" | "program" | "month" | "type"

export interface VolunteerAggregateBucket {
  /** Group key — depends on `groupBy`: volunteerName/contactId, programId, "YYYY-MM", or activityType. */
  key: string
  /** Human-readable label for the group. */
  label: string
  totalHours: number
  sessionCount: number
}
