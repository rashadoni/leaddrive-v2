/**
 * Financial Services types — R1 Phase 6 Block E (closes Block E).
 *
 * Salesforce FSC analogue. Shared shape between 5 pure helpers:
 *   1. state-machine             — household / account / goal / event lifecycles
 *   2. aum-calculator            — aggregate AUM with currency consistency
 *   3. goal-progress-calculator  — progress %, remaining months, on-track
 *   4. kyc-validator             — KYC field completeness + ownership-sum
 *   5. (re-exported)             — typed I/O for slice-2 caller code
 *
 * Pure — no Prisma imports. Money math uses integer minor units
 * (mirror M4 lesson — caller converts Decimal ↔ minor before/after).
 */

/* ─── Household status + transitions ──────────────────────────────────── */

export const HOUSEHOLD_STATUSES = [
  "prospect",
  "active",
  "inactive",
  "closed",
] as const

export type HouseholdStatus = (typeof HOUSEHOLD_STATUSES)[number]

/**
 *   prospect → active | closed
 *   active → inactive | closed
 *   inactive → active | closed   (paused relationship can resume)
 *   closed → []                  (terminal; reopening = new household row)
 */
export const HOUSEHOLD_TRANSITIONS: Readonly<
  Record<HouseholdStatus, readonly HouseholdStatus[]>
> = {
  prospect: ["active", "closed"],
  active: ["inactive", "closed"],
  inactive: ["active", "closed"],
  closed: [],
}

/* ─── KYC status ──────────────────────────────────────────────────────── */

export const KYC_STATUSES = [
  "not_started",
  "in_review",
  "approved",
  "rejected",
  "expired",
] as const

export type KycStatus = (typeof KYC_STATUSES)[number]

/**
 *   not_started → in_review
 *   in_review   → approved | rejected
 *   approved    → expired       (periodic re-verification)
 *   rejected    → in_review     (reapply with new docs)
 *   expired     → in_review     (renewal flow)
 */
export const KYC_TRANSITIONS: Readonly<Record<KycStatus, readonly KycStatus[]>> = {
  not_started: ["in_review"],
  in_review: ["approved", "rejected"],
  approved: ["expired"],
  rejected: ["in_review"],
  expired: ["in_review"],
}

/* ─── Member role ─────────────────────────────────────────────────────── */

export const MEMBER_ROLES = [
  "primary",
  "spouse",
  "child",
  "dependent",
  "trustee",
  "beneficiary",
] as const

export type MemberRole = (typeof MEMBER_ROLES)[number]

/* ─── Account type + status ───────────────────────────────────────────── */

export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "brokerage",
  "ira_traditional",
  "ira_roth",
  "401k",
  "529",
  "credit_card",
  "mortgage",
  "personal_loan",
  "hsa",
  "trust",
] as const

export type AccountType = (typeof ACCOUNT_TYPES)[number]

/**
 * Account types where balance contributes POSITIVELY to AUM (asset).
 * Loan/credit accounts contribute NEGATIVELY (liability) — the AUM
 * calculator nets them out per standard wealth-management convention.
 *
 * Mortgage + personal_loan + credit_card = liabilities.
 * Everything else = asset.
 */
export const LIABILITY_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  "mortgage",
  "personal_loan",
  "credit_card",
])

export const ACCOUNT_STATUSES = ["pending", "open", "frozen", "closed"] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

/**
 *   pending → open | closed
 *   open    → frozen | closed
 *   frozen  → open | closed
 *   closed  → []
 */
export const ACCOUNT_TRANSITIONS: Readonly<
  Record<AccountStatus, readonly AccountStatus[]>
> = {
  pending: ["open", "closed"],
  open: ["frozen", "closed"],
  frozen: ["open", "closed"],
  closed: [],
}

/* ─── Goal type + status ──────────────────────────────────────────────── */

export const GOAL_TYPES = [
  "retirement",
  "college",
  "home_purchase",
  "emergency_fund",
  "major_purchase",
  "debt_payoff",
  "custom",
] as const

export type GoalType = (typeof GOAL_TYPES)[number]

export const GOAL_STATUSES = ["active", "achieved", "abandoned", "paused"] as const
export type GoalStatus = (typeof GOAL_STATUSES)[number]

/**
 *   active   → achieved | abandoned | paused
 *   paused   → active | abandoned
 *   achieved → []   (re-targeting = new goal)
 *   abandoned → []
 */
export const GOAL_TRANSITIONS: Readonly<Record<GoalStatus, readonly GoalStatus[]>> = {
  active: ["achieved", "abandoned", "paused"],
  paused: ["active", "abandoned"],
  achieved: [],
  abandoned: [],
}

/* ─── Life event types ────────────────────────────────────────────────── */

export const LIFE_EVENT_TYPES = [
  "marriage",
  "divorce",
  "birth",
  "death",
  "retirement",
  "job_change",
  "inheritance",
  "home_purchase",
  "major_illness",
  "child_education_start",
  "other",
] as const

export type LifeEventType = (typeof LIFE_EVENT_TYPES)[number]

export const LIFE_EVENT_OUTREACH_STATUSES = [
  "logged",
  "acknowledged",
  "actioned",
  "dismissed",
] as const

export type LifeEventOutreachStatus = (typeof LIFE_EVENT_OUTREACH_STATUSES)[number]

export const LIFE_EVENT_OUTREACH_TRANSITIONS: Readonly<
  Record<LifeEventOutreachStatus, readonly LifeEventOutreachStatus[]>
> = {
  logged: ["acknowledged", "actioned", "dismissed"],
  acknowledged: ["actioned", "dismissed"],
  actioned: [],
  dismissed: [],
}

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string }

/* ─── AUM calculator I/O ──────────────────────────────────────────────── */

/**
 * One account snapshot as input. `balanceMinor` is in minor units
 * (cents). Caller pre-converts from Prisma Decimal via the M4
 * `decimalToMinor` helper.
 */
export interface AccountSnapshot {
  accountType: AccountType
  status: AccountStatus
  balanceMinor: number
  currency: string
}

export interface CalculateAumInput {
  /** All accounts under the household. Mixed-currency rejected by helper. */
  accounts: readonly AccountSnapshot[]
  /** Household base currency for the aggregate. */
  baseCurrency: string
}

export interface AumResult {
  /** Total net AUM in minor units (assets - liabilities). May be negative. */
  totalAumMinor: number
  /** Sum of asset-account balances. */
  totalAssetsMinor: number
  /** Sum of liability-account balances (positive number; sign is in totalAum). */
  totalLiabilitiesMinor: number
  /** Account counts. */
  assetCount: number
  liabilityCount: number
}

export type CalculateAumResult =
  | { ok: true; aum: AumResult }
  | { ok: false; error: string }

/* ─── Goal progress calculator I/O ────────────────────────────────────── */

export interface CalculateGoalProgressInput {
  targetAmountMinor: number
  currentAmountMinor: number
  /** When the goal should be achieved. Null = no target date (open-ended). */
  targetDate: Date | null
  /** Caller-supplied "now" for testability. */
  asOf: Date
}

export interface GoalProgressResult {
  /** Progress as a percentage 0..100. */
  progressPct: number
  /** Remaining amount in minor units. May be 0 if already achieved. */
  remainingMinor: number
  /** Months until target date, integer-floored. Null if no target date. */
  monthsRemaining: number | null
  /**
   * Required monthly contribution to hit target. Null if no target date
   * OR already achieved OR target date is in the past.
   */
  requiredMonthlyMinor: number | null
  /** True if `currentAmount >= targetAmount`. */
  isAchieved: boolean
  /** True if `asOf > targetDate AND !isAchieved`. */
  isOverdue: boolean
}

export type CalculateGoalProgressResult =
  | { ok: true; progress: GoalProgressResult }
  | { ok: false; error: string }

/* ─── KYC validator I/O ───────────────────────────────────────────────── */

/**
 * Per-member declared KYC fields. Slice-1 validates field presence
 * + ownership-sum invariant; slice-2 verifies actual documents.
 */
export interface KycMemberData {
  contactId: string
  role: MemberRole
  /** Legal first + last name. */
  legalFirstName: string | null
  legalLastName: string | null
  dateOfBirth: Date | null
  /** SSN / TIN / national ID. Slice-1 just checks presence — no PII scrub. */
  taxId: string | null
  /** Address fields. */
  addressLine1: string | null
  city: string | null
  postalCode: string | null
  country: string | null
  /** Ownership 0..100. */
  ownershipPct: number
}

export interface ValidateKycInput {
  members: readonly KycMemberData[]
  /**
   * Per-role required fields. Slice-1 default: primary + spouse require
   * full KYC; child + dependent are de-minimis (only name + DoB);
   * trustee + beneficiary require full.
   */
  required?: Readonly<Record<MemberRole, readonly KycField[]>>
}

export type KycField =
  | "legalFirstName"
  | "legalLastName"
  | "dateOfBirth"
  | "taxId"
  | "addressLine1"
  | "city"
  | "postalCode"
  | "country"

export const KYC_FIELDS: readonly KycField[] = [
  "legalFirstName",
  "legalLastName",
  "dateOfBirth",
  "taxId",
  "addressLine1",
  "city",
  "postalCode",
  "country",
]

export const DEFAULT_KYC_REQUIREMENTS: Readonly<
  Record<MemberRole, readonly KycField[]>
> = {
  primary: KYC_FIELDS,
  spouse: KYC_FIELDS,
  trustee: KYC_FIELDS,
  beneficiary: KYC_FIELDS,
  child: ["legalFirstName", "legalLastName", "dateOfBirth"],
  dependent: ["legalFirstName", "legalLastName", "dateOfBirth"],
}

export interface KycMemberIssue {
  contactId: string
  role: MemberRole
  /** Field paths missing required values. */
  missingFields: KycField[]
}

export interface ValidateKycResult {
  /** True if all required fields present AND ownership sums to 100. */
  ok: boolean
  /** Issues per member with missing required fields. */
  memberIssues: KycMemberIssue[]
  /** Sum of ownership percentages across all members. */
  ownershipSumPct: number
  /** True if ownership sum is exactly 100 (within rounding tolerance). */
  ownershipBalanced: boolean
  /**
   * True if at least one member has role='primary'. Households
   * without a primary are incomplete.
   */
  hasPrimary: boolean
}
