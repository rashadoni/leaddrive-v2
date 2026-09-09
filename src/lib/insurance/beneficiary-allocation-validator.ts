/**
 * Beneficiary allocation validator — R7 slice 1.
 *
 * Verifies a policy's beneficiary set against the per-tier allocation
 * rules. Skips revoked beneficiaries (revokedAt set).
 *
 * Rules:
 *   • Every active record has 0 ≤ allocationPct ≤ 100 (DB CHECK also fires).
 *   • Primary-tier sum = 100 for life-insurance policies (slim tolerance
 *     for floating-point noise = 0.01). For non-life: primary sum ≤ 100
 *     (no fixed pool — allocations are advisory).
 *   • Contingent-tier sum ≤ 100 (contingents may total to less; only
 *     paid out if all primaries deceased/disclaim).
 *   • Every record has a non-empty id (defensive).
 *   • Duplicate ids rejected (would conflate aggregation).
 *
 * Pure synchronous.
 */
import {
  BENEFICIARY_TIERS,
  BENEFICIARY_TYPES,
  type BeneficiaryAllocation,
  type ValidateBeneficiariesInput,
  type ValidateBeneficiariesResult,
} from "./types"

const ALLOCATION_TOLERANCE = 0.01 // 1 cent of percentage

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

function validateRecord(
  rec: BeneficiaryAllocation,
  index: number
): { ok: true } | { ok: false; error: string; field?: string } {
  if (rec === null || typeof rec !== "object") {
    return {
      ok: false,
      error: `beneficiaries[${index}] must be an object`,
    }
  }
  if (typeof rec.id !== "string" || rec.id.length === 0) {
    return {
      ok: false,
      error: `beneficiaries[${index}].id must be a non-empty string`,
      field: `beneficiaries[${index}].id`,
    }
  }
  if (!(BENEFICIARY_TIERS as readonly string[]).includes(rec.tier)) {
    return {
      ok: false,
      error: `beneficiaries[${index}] tier "${String(rec.tier)}" not in allow-list`,
      field: `beneficiaries[${index}].tier`,
    }
  }
  if (!(BENEFICIARY_TYPES as readonly string[]).includes(rec.beneficiaryType)) {
    return {
      ok: false,
      error: `beneficiaries[${index}] beneficiaryType "${String(rec.beneficiaryType)}" not in allow-list`,
      field: `beneficiaries[${index}].beneficiaryType`,
    }
  }
  if (!isFiniteNonNegative(rec.allocationPct) || rec.allocationPct > 100) {
    return {
      ok: false,
      error: `beneficiaries[${index}] allocationPct must be 0..100`,
      field: `beneficiaries[${index}].allocationPct`,
    }
  }
  return { ok: true }
}

export function validateBeneficiaries(
  input: ValidateBeneficiariesInput
): ValidateBeneficiariesResult {
  if (!Array.isArray(input.beneficiaries)) {
    return { ok: false, error: "beneficiaries must be an array" }
  }
  if (typeof input.isLifeLine !== "boolean") {
    return { ok: false, error: "isLifeLine must be a boolean" }
  }

  const seenIds = new Set<string>()
  let primarySum = 0
  let contingentSum = 0
  let activePrimary = 0
  let activeContingent = 0

  for (let i = 0; i < input.beneficiaries.length; i++) {
    const rec = input.beneficiaries[i]
    const recValid = validateRecord(rec, i)
    if (!recValid.ok) {
      return recValid
    }
    if (seenIds.has(rec.id)) {
      return {
        ok: false,
        error: `duplicate beneficiary id "${rec.id}"`,
        field: `beneficiaries[${i}].id`,
      }
    }
    seenIds.add(rec.id)
    if (rec.revokedAt !== null && rec.revokedAt !== undefined) {
      continue // skip revoked
    }
    if (rec.tier === "primary") {
      primarySum += rec.allocationPct
      activePrimary++
    } else {
      contingentSum += rec.allocationPct
      activeContingent++
    }
  }

  // For life policies, primary sum MUST equal 100 (within tolerance).
  if (input.isLifeLine && activePrimary > 0) {
    if (Math.abs(primarySum - 100) > ALLOCATION_TOLERANCE) {
      return {
        ok: false,
        error: `life policy primary-tier sum is ${primarySum}, must equal 100`,
        field: "beneficiaries[primary].allocationPct",
      }
    }
  } else {
    // For non-life policies, primary sum ≤ 100.
    if (primarySum > 100 + ALLOCATION_TOLERANCE) {
      return {
        ok: false,
        error: `primary-tier sum ${primarySum} exceeds 100`,
        field: "beneficiaries[primary].allocationPct",
      }
    }
  }

  // Contingent sum ≤ 100 always.
  if (contingentSum > 100 + ALLOCATION_TOLERANCE) {
    return {
      ok: false,
      error: `contingent-tier sum ${contingentSum} exceeds 100`,
      field: "beneficiaries[contingent].allocationPct",
    }
  }

  // Life policy must have at least one active primary beneficiary.
  if (input.isLifeLine && activePrimary === 0) {
    return {
      ok: false,
      error: "life policy requires at least one active primary beneficiary",
    }
  }

  return { ok: true, primarySumPct: primarySum, contingentSumPct: contingentSum }
}
