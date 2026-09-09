/**
 * C5 Account Engagement — Company → MarketingAccount promotion mapping (Phase 1).
 *
 * Pure (no Prisma). Maps a CRM Company's demographics onto the
 * MarketingAccount field-set and computes the fit grade via the slice-1
 * `calculateAccountGrade` helper, using the per-tenant grade weights
 * (targetIndustries / disqualifiedIndustries) the caller loaded from
 * `config-loader.loadAccountGradeWeights`.
 *
 * `icpTier` defaults to "unscored" — Phase 6 (ICP auto-scoring) assigns a
 * real tier later; until then the grade is driven by employee band +
 * industry match + revenue, which still yields A..F (only an account with
 * NO known attribute at all stays "unassigned").
 */
import { calculateAccountGrade } from "./account-grade-calculator"
import type { EmployeeBand, Grade, IcpTier } from "./types"
import type { AccountGradeWeights } from "./config-loader"
import { scoreIcpTier } from "./icp-scoring"

/**
 * Employee-headcount → band. Standard B2B segmentation. An unknown count
 * (null / <1) maps to `null` band — the grade calculator gives null band
 * zero credit rather than guessing a wrong bucket.
 */
export const EMPLOYEE_BAND_THRESHOLDS: ReadonlyArray<{
  min: number
  band: EmployeeBand
}> = [
  { min: 1000, band: "strategic" },
  { min: 250, band: "enterprise" },
  { min: 50, band: "mid_market" },
  { min: 10, band: "small" },
  { min: 1, band: "micro" },
]

export function mapEmployeeCountToBand(
  count: number | null | undefined,
): EmployeeBand | null {
  if (count == null || !Number.isFinite(count) || count < 1) return null
  for (const { min, band } of EMPLOYEE_BAND_THRESHOLDS) {
    if (count >= min) return band
  }
  return null
}

/**
 * Free-text industry → slug: lowercase, runs of non-alphanumerics collapse
 * to a single "-", leading/trailing "-" trimmed. Empty / non-string → null.
 * The grade calculator compares this against the tenant's target /
 * disqualified industry slug lists.
 */
export function slugifyIndustry(
  industry: string | null | undefined,
): string | null {
  if (typeof industry !== "string") return null
  const slug = industry
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || null
}

/** The CRM Company demographics this mapper reads. */
export interface CompanyDemographics {
  name: string
  industry: string | null
  /** Company.employeeCount (Int). */
  employeeCount: number | null
  /** Company.annualRevenue (Float, in the org's currency). */
  annualRevenue: number | null
}

/** MarketingAccount field-set produced from a Company. */
export interface PromotedAccountFields {
  accountName: string
  industrySlug: string | null
  employeeBand: EmployeeBand | null
  /** Stored on MarketingAccount.annualRevenueUsd (BigInt). */
  annualRevenueUsd: bigint | null
  icpTier: IcpTier
  grade: Grade
  /** Human-readable breakdown — persisted into MarketingAccount.metadata. */
  gradeRationale: string
}

/**
 * Build the MarketingAccount field-set from a CRM Company + the tenant's
 * grade weights. The grade is always recomputed here — never trusted from
 * a client. `opts.icpTier` defaults to "unscored".
 */
export function buildAccountFromCompany(
  company: CompanyDemographics,
  weights: Pick<AccountGradeWeights, "targetIndustries" | "disqualifiedIndustries">,
  opts?: { icpTier?: IcpTier; minRevenueUsd?: number },
): PromotedAccountFields {
  const industrySlug = slugifyIndustry(company.industry)
  const employeeBand = mapEmployeeCountToBand(company.employeeCount)
  const revenueNum =
    company.annualRevenue != null &&
    Number.isFinite(company.annualRevenue) &&
    company.annualRevenue >= 0
      ? company.annualRevenue
      : null
  // Phase 6: auto-derive the ICP tier from firmographics UNLESS the caller
  // passed an explicit, real tier. The promote routes default `icpTier` to
  // "unscored" to mean "not specified" — so "unscored" must be treated as
  // absent here, otherwise `??` would short-circuit and the auto-scoring would
  // never run (the bug prod surfaced: companies with data still showed unscored).
  const explicitTier =
    opts?.icpTier && opts.icpTier !== "unscored" ? opts.icpTier : null
  const icpTier: IcpTier =
    explicitTier ??
    scoreIcpTier({
      employeeBand,
      industrySlug,
      annualRevenueUsd: revenueNum,
      targetIndustries: weights.targetIndustries,
    }).tier

  const graded = calculateAccountGrade({
    icpTier,
    employeeBand,
    industrySlug,
    targetIndustries: weights.targetIndustries,
    disqualifiedIndustries: weights.disqualifiedIndustries,
    annualRevenueUsd: revenueNum,
    minRevenueUsd: opts?.minRevenueUsd,
  })

  const grade: Grade = graded.ok ? graded.breakdown.grade : "unassigned"
  const gradeRationale = graded.ok
    ? graded.breakdown.rationale
    : `grade error: ${graded.error}`

  return {
    accountName: company.name,
    industrySlug,
    employeeBand,
    annualRevenueUsd: revenueNum != null ? BigInt(Math.round(revenueNum)) : null,
    icpTier,
    grade,
    gradeRationale,
  }
}
