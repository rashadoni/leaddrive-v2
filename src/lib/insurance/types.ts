/**
 * Insurance Cloud types — R7 slice 1.
 *
 * Salesforce Insurance Cloud analogue. Shared shape between 4 pure helpers:
 *   1. state-machine                 — holder + policy + claim lifecycle
 *   2. premium-calculator            — coverage × line × tier → annual premium
 *   3. claim-severity-classifier     — amount × loss type → severity tier
 *   4. beneficiary-allocation-validator — per-tier sum ≤ 100, allocation rules
 *
 * Pure — no Prisma imports.
 */

/* ─── PolicyHolder status + transitions ───────────────────────────────── */

export const HOLDER_STATUSES = [
  "prospect",
  "active",
  "inactive",
  "deceased",
] as const

export type HolderStatus = (typeof HOLDER_STATUSES)[number]

/**
 *   prospect → active | deceased
 *   active   → inactive | deceased
 *   inactive → active | deceased
 *   deceased → []                                (terminal)
 */
export const HOLDER_TRANSITIONS: Readonly<
  Record<HolderStatus, readonly HolderStatus[]>
> = {
  prospect: ["active", "deceased"],
  active: ["inactive", "deceased"],
  inactive: ["active", "deceased"],
  deceased: [],
}

/* ─── Service team role ───────────────────────────────────────────────── */

export const SERVICE_TEAM_ROLES = [
  "underwriter",
  "senior_underwriter",
  "claims_adjuster",
  "senior_adjuster",
  "claims_examiner",
  "special_investigations",
] as const

export type ServiceTeamRole = (typeof SERVICE_TEAM_ROLES)[number]

/* ─── Line of business + billing frequency ────────────────────────────── */

export const LINES_OF_BUSINESS = [
  "auto",
  "home",
  "life",
  "health",
  "commercial",
  "umbrella",
  "marine",
] as const

export type LineOfBusiness = (typeof LINES_OF_BUSINESS)[number]

export const BILLING_FREQUENCIES = [
  "annual",
  "semi_annual",
  "quarterly",
  "monthly",
] as const

export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number]

/* ─── Policy status + transitions ─────────────────────────────────────── */

export const POLICY_STATUSES = [
  "quote",
  "bound",
  "active",
  "expired",
  "lapsed",
  "cancelled",
] as const

export type PolicyStatus = (typeof POLICY_STATUSES)[number]

/**
 *   quote     → bound | cancelled
 *   bound     → active | cancelled
 *   active    → expired | lapsed | cancelled
 *   expired   → []                              (terminal — renew = new policy)
 *   lapsed    → []                              (terminal — reinstate = new policy)
 *   cancelled → []                              (terminal)
 */
export const POLICY_TRANSITIONS: Readonly<
  Record<PolicyStatus, readonly PolicyStatus[]>
> = {
  quote: ["bound", "cancelled"],
  bound: ["active", "cancelled"],
  active: ["expired", "lapsed", "cancelled"],
  expired: [],
  lapsed: [],
  cancelled: [],
}

/* ─── Claim loss types + status + severity + transitions ──────────────── */

export const CLAIM_LOSS_TYPES = [
  "collision",
  "theft",
  "fire",
  "weather",
  "liability",
  "medical",
  "property_damage",
  "death",
  "disability",
  "other",
] as const

export type ClaimLossType = (typeof CLAIM_LOSS_TYPES)[number]

export const CLAIM_STATUSES = [
  "reported",
  "under_review",
  "approved",
  "settled",
  "denied",
  "closed_no_action",
] as const

export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

/**
 *   reported     → under_review | denied | closed_no_action
 *   under_review → approved | denied | closed_no_action
 *   approved     → settled | under_review (un-approve for mid-review
 *                  fraud discovery — adjuster reverts approval back
 *                  to review queue; subsequent path: under_review →
 *                  denied.
 *                  ⚠️ AUDIT-LOG ENFORCEMENT (caller responsibility):
 *                  every approved→under_review write MUST write a row
 *                  to compliance_audit_log (or the eventual slice-2
 *                  un_approve_audit_events table) with adjuster id +
 *                  reason. State machine cannot enforce this — route
 *                  layer is the contract. Slice-2-mini route reviewer
 *                  MUST grep for transitionClaim("approved", "under_review")
 *                  callsites and assert each one is preceded by an
 *                  audit-write call before merge.
 *                  Direct approved→denied is intentionally NOT allowed
 *                  — caller must explicitly walk back through
 *                  under_review for a fresh decision, audit-trail clarity.)
 *   settled      — terminal (payout disbursed)
 *   denied       — terminal (insured may appeal in slice-2)
 *   closed_no_action — terminal (no merit; duplicate, jurisdiction)
 */
export const CLAIM_TRANSITIONS: Readonly<
  Record<ClaimStatus, readonly ClaimStatus[]>
> = {
  reported: ["under_review", "denied", "closed_no_action"],
  under_review: ["approved", "denied", "closed_no_action"],
  approved: ["settled", "under_review"],
  settled: [],
  denied: [],
  closed_no_action: [],
}

export const CLAIM_SEVERITIES = [
  "minor",
  "moderate",
  "major",
  "catastrophic",
] as const

export type ClaimSeverity = (typeof CLAIM_SEVERITIES)[number]

/* ─── Beneficiary tier + type ─────────────────────────────────────────── */

export const BENEFICIARY_TIERS = ["primary", "contingent"] as const
export type BeneficiaryTier = (typeof BENEFICIARY_TIERS)[number]

export const BENEFICIARY_TYPES = [
  "person",
  "trust",
  "charity",
  "estate",
] as const
export type BeneficiaryType = (typeof BENEFICIARY_TYPES)[number]

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult = { ok: true } | { ok: false; error: string }

/* ─── Premium calculator I/O ──────────────────────────────────────────── */

export interface CalculatePremiumInput {
  lineOfBusiness: LineOfBusiness
  /** Face value / coverage limit (e.g. $250K liability, $500K life). */
  coverageLimit: number
  /** Deductible (P&C only; for life pass 0). */
  deductible?: number
  /**
   * Risk tier (DB-side caller computes from policyholder data):
   *   preferred — best risk class (e.g. clean driving record)
   *   standard  — average
   *   substandard — elevated (e.g. prior claims, age > 70)
   *   declined  — uninsurable; calculator returns ok:false
   */
  riskTier: RiskTier
  /** Term length in years (e.g. 1 for annual auto, 20 for term life). */
  termYears: number
  /** Caller-supplied multiplier overrides for tenant tariff customization
   *  (slice-2 wires to rating engine). */
  multiplierOverride?: number
}

export const RISK_TIERS = [
  "preferred",
  "standard",
  "substandard",
  "declined",
] as const

export type RiskTier = (typeof RISK_TIERS)[number]

export interface PremiumBreakdown {
  /** Base premium before risk adjustment + deductible credit. */
  basePremium: number
  /** Risk tier multiplier applied (1.0 = standard). */
  riskMultiplier: number
  /** Deductible credit (higher deductible = lower premium). */
  deductibleCredit: number
  /** Annual premium = max(0, base × multiplier − deductibleCredit). */
  annualPremium: number
}

export type CalculatePremiumResult =
  | { ok: true; breakdown: PremiumBreakdown }
  | { ok: false; error: string }

/* ─── Claim severity classifier I/O ───────────────────────────────────── */

export interface ClassifyClaimSeverityInput {
  /** Total claim value: paidAmount + currentReserveAmount, or just
   *  initialReserveAmount when not yet under review. */
  totalAmount: number
  lossType: ClaimLossType
  /** Caller-supplied policy face value — used for catastrophic-vs-policy
   *  ratio check. NULL = ignore (use bare-amount thresholds). */
  policyCoverageLimit?: number | null
}

export type ClassifyClaimSeverityResult =
  | { ok: true; severity: ClaimSeverity; rationale: string }
  | { ok: false; error: string }

/* ─── Beneficiary allocation validator I/O ────────────────────────────── */

/**
 * Active beneficiary record fed to the validator. revokedAt set ⇒
 * record skipped (slice-2 worker filters before passing, but defensive
 * here too).
 */
export interface BeneficiaryAllocation {
  tier: BeneficiaryTier
  allocationPct: number
  revokedAt?: Date | null
  beneficiaryType: BeneficiaryType
  /** Caller-supplied id for error reporting. */
  id: string
}

export interface ValidateBeneficiariesInput {
  beneficiaries: readonly BeneficiaryAllocation[]
  /** Whether the policy is life insurance (primary-tier sum must equal
   *  100; for non-life policies, beneficiaries may sum < 100 since
   *  payout has no fixed pool). */
  isLifeLine: boolean
}

export type ValidateBeneficiariesResult =
  | { ok: true; primarySumPct: number; contingentSumPct: number }
  | { ok: false; error: string; field?: string }
