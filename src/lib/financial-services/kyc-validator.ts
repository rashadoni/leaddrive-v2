/**
 * KYC validator — R1 slice 1.
 *
 * Slice-1 validates DECLARED KYC fields per member + ownership-sum
 * invariant + primary-member presence. Slice-2 will verify actual
 * uploaded documents.
 *
 * Pure synchronous. Returns ok=true ONLY if:
 *   • Every member has all role-required KYC fields populated
 *   • At least one member has role='primary'
 *   • Ownership across all members sums to 100 (±0.05% — see
 *     OWNERSHIP_TOLERANCE_PCT for the Float-drift rationale)
 *
 * Defense-in-depth: KYC values themselves are NOT scrubbed for PII —
 * caller stores them as raw strings and slice-2 cryptographic flow
 * encrypts at rest. Helper only checks presence.
 */
import {
  DEFAULT_KYC_REQUIREMENTS,
  KYC_FIELDS,
  type KycField,
  type KycMemberData,
  type KycMemberIssue,
  type ValidateKycInput,
  type ValidateKycResult,
} from "./types"

/**
 * Tolerance in percentage points when checking ownership-sums-to-100.
 * Set to 0.05 (5 basis points) — tighter than typical rounding error in
 * Decimal(5,2) Prisma column storage, but loose enough to absorb
 * Float subtraction drift (e.g. `99.99 - 100 = -0.0100000000000051`
 * in IEEE-754 — abs would be just over 0.01 and fail a strict cap).
 */
const OWNERSHIP_TOLERANCE_PCT = 0.05

function isFieldPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === "string") return v.trim().length > 0
  if (v instanceof Date) return Number.isFinite(v.getTime())
  return true
}

function memberFieldValue(member: KycMemberData, field: KycField): unknown {
  switch (field) {
    case "legalFirstName":
      return member.legalFirstName
    case "legalLastName":
      return member.legalLastName
    case "dateOfBirth":
      return member.dateOfBirth
    case "taxId":
      return member.taxId
    case "addressLine1":
      return member.addressLine1
    case "city":
      return member.city
    case "postalCode":
      return member.postalCode
    case "country":
      return member.country
  }
}

export function validateKyc(input: ValidateKycInput): ValidateKycResult {
  const required = input.required ?? DEFAULT_KYC_REQUIREMENTS
  const memberIssues: KycMemberIssue[] = []
  let ownershipSumPct = 0
  let hasPrimary = false

  for (const m of input.members) {
    if (m.role === "primary") hasPrimary = true
    // Defensive: caller could send NaN / out-of-range. Use 0 as floor —
    // the ownershipBalanced check below will fail loudly.
    if (typeof m.ownershipPct === "number" && Number.isFinite(m.ownershipPct)) {
      ownershipSumPct += m.ownershipPct
    }
    const requiredForRole = required[m.role] ?? KYC_FIELDS
    const missing: KycField[] = []
    for (const f of requiredForRole) {
      if (!isFieldPresent(memberFieldValue(m, f))) {
        missing.push(f)
      }
    }
    if (missing.length > 0) {
      memberIssues.push({
        contactId: m.contactId,
        role: m.role,
        missingFields: missing,
      })
    }
  }

  const ownershipBalanced = Math.abs(ownershipSumPct - 100) <= OWNERSHIP_TOLERANCE_PCT

  return {
    ok: memberIssues.length === 0 && ownershipBalanced && hasPrimary,
    memberIssues,
    ownershipSumPct,
    ownershipBalanced,
    hasPrimary,
  }
}
