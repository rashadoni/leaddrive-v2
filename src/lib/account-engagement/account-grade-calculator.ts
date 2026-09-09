/**
 * Account grade calculator — C5 slice 1.
 *
 * Computes the fit-based letter grade (A..F) from account demographics:
 *   • ICP tier (caller-determined; tier_1..tier_4 → high to low score)
 *   • Employee band (strategic > enterprise > mid_market > small > micro)
 *   • Industry match (in target list = full credit, else partial)
 *   • Revenue threshold (above minimum = credit, below = penalty)
 *
 * Grade mapping (rawScore 0..100):
 *   80..100 → A
 *   60..79  → B
 *   40..59  → C
 *   20..39  → D
 *   0..19   → F
 *   icpTier=unscored AND missing other data → unassigned
 *
 * Disqualification gates (always grade F):
 *   • industrySlug ∈ disqualifiedIndustries → F regardless of other factors.
 *
 * Pure synchronous.
 */
import {
  EMPLOYEE_BANDS,
  ICP_TIERS,
  type CalculateGradeInput,
  type CalculateGradeResult,
  type EmployeeBand,
  type GradeBreakdown,
  type IcpTier,
} from "./types"

const ICP_COMPONENT_BY_TIER: Readonly<Record<IcpTier, number>> = {
  tier_1: 30,
  tier_2: 22,
  tier_3: 14,
  tier_4: 6,
  unscored: 0,
}

const BAND_COMPONENT: Readonly<Record<EmployeeBand, number>> = {
  strategic: 25,
  enterprise: 20,
  mid_market: 14,
  small: 8,
  micro: 3,
}

function isIcpTier(v: unknown): v is IcpTier {
  return typeof v === "string" && (ICP_TIERS as readonly string[]).includes(v)
}

function isEmployeeBand(v: unknown): v is EmployeeBand {
  return (
    typeof v === "string" && (EMPLOYEE_BANDS as readonly string[]).includes(v)
  )
}

function rawToGrade(raw: number): "A" | "B" | "C" | "D" | "F" {
  if (raw >= 80) return "A"
  if (raw >= 60) return "B"
  if (raw >= 40) return "C"
  if (raw >= 20) return "D"
  return "F"
}

export function calculateAccountGrade(
  input: CalculateGradeInput
): CalculateGradeResult {
  if (!isIcpTier(input.icpTier)) {
    return { ok: false, error: `unknown icpTier "${String(input.icpTier)}"` }
  }
  if (input.employeeBand !== null && !isEmployeeBand(input.employeeBand)) {
    return {
      ok: false,
      error: `unknown employeeBand "${String(input.employeeBand)}"`,
    }
  }
  if (!Array.isArray(input.targetIndustries)) {
    return { ok: false, error: "targetIndustries must be an array" }
  }
  if (
    input.disqualifiedIndustries !== undefined &&
    !Array.isArray(input.disqualifiedIndustries)
  ) {
    return { ok: false, error: "disqualifiedIndustries must be an array" }
  }
  if (
    input.annualRevenueUsd !== null &&
    (typeof input.annualRevenueUsd !== "number" ||
      !Number.isFinite(input.annualRevenueUsd) ||
      input.annualRevenueUsd < 0)
  ) {
    return {
      ok: false,
      error:
        "annualRevenueUsd must be a finite non-negative number or null",
    }
  }
  if (
    input.minRevenueUsd !== undefined &&
    (!Number.isFinite(input.minRevenueUsd) || input.minRevenueUsd < 0)
  ) {
    return {
      ok: false,
      error: "minRevenueUsd must be a finite non-negative number",
    }
  }

  // Disqualification gate.
  if (
    input.disqualifiedIndustries !== undefined &&
    input.industrySlug !== null &&
    input.disqualifiedIndustries.includes(input.industrySlug)
  ) {
    const breakdown: GradeBreakdown = {
      grade: "F",
      rawScore: 0,
      icpComponent: 0,
      bandComponent: 0,
      industryComponent: 0,
      revenueComponent: 0,
      rationale: `industry "${input.industrySlug}" is in disqualified list → F`,
    }
    return { ok: true, breakdown }
  }

  const icpComponent = ICP_COMPONENT_BY_TIER[input.icpTier]
  const bandComponent =
    input.employeeBand !== null ? BAND_COMPONENT[input.employeeBand] : 0

  // Industry match — caller's list of target industries.
  let industryComponent = 0
  if (input.industrySlug !== null) {
    if (input.targetIndustries.length === 0) {
      // No target list = neutral credit
      industryComponent = 10
    } else if (input.targetIndustries.includes(input.industrySlug)) {
      industryComponent = 25
    } else {
      industryComponent = 5
    }
  }

  // Revenue component.
  const minRev = input.minRevenueUsd ?? 0
  let revenueComponent = 0
  if (input.annualRevenueUsd === null) {
    revenueComponent = 0
  } else if (input.annualRevenueUsd >= minRev) {
    revenueComponent = 20
  } else {
    // Partial credit scaled to ratio.
    revenueComponent =
      minRev > 0 ? Math.round((input.annualRevenueUsd / minRev) * 10) : 10
  }

  const rawScore = icpComponent + bandComponent + industryComponent + revenueComponent

  // Special-case unassigned when nothing is known.
  if (
    input.icpTier === "unscored" &&
    input.employeeBand === null &&
    input.industrySlug === null &&
    input.annualRevenueUsd === null
  ) {
    const breakdown: GradeBreakdown = {
      grade: "unassigned",
      rawScore: 0,
      icpComponent: 0,
      bandComponent: 0,
      industryComponent: 0,
      revenueComponent: 0,
      rationale: "no data — grade deferred until ICP / band / industry / revenue known",
    }
    return { ok: true, breakdown }
  }

  const grade = rawToGrade(rawScore)
  const breakdown: GradeBreakdown = {
    grade,
    rawScore,
    icpComponent,
    bandComponent,
    industryComponent,
    revenueComponent,
    rationale: `ICP=${icpComponent} + band=${bandComponent} + industry=${industryComponent} + revenue=${revenueComponent} = ${rawScore} → ${grade}`,
  }
  return { ok: true, breakdown }
}

/** Test-only — surfaces component tables. */
export const __GRADE_INTERNALS = {
  ICP_COMPONENT_BY_TIER,
  BAND_COMPONENT,
}
