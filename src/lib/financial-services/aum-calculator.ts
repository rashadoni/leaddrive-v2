/**
 * AUM (Assets Under Management) calculator — R1 slice 1.
 *
 * Aggregates household-level AUM by netting assets minus liabilities
 * across all open/frozen accounts. Closed accounts are EXCLUDED
 * (treat as off-book); pending accounts are EXCLUDED (not yet active).
 *
 * Liability accounts (mortgage, personal_loan, credit_card) are
 * treated as NEGATIVE contributions per standard wealth-management
 * convention: a $200K mortgage reduces net worth even though its
 * balance is stored as a positive number (or already-negative,
 * depending on how the institution feed represents it).
 *
 * Slice-1 simplification: we accept whatever sign the caller stores
 * and apply a CONSISTENT convention via LIABILITY_ACCOUNT_TYPES.
 * Specifically: balance abs-value is used; liability types subtract.
 * Slice-2 may parameterise per tenant if Plaid feed semantics vary.
 *
 * Pure synchronous. Money math in integer minor units. No BigInt
 * needed — max realistic household AUM is $10B = 1e12 minor units,
 * well within Number.MAX_SAFE_INTEGER (9e15). Helper sums up to
 * ~1000 accounts × $1B each = 1e15, still under MAX_SAFE_INTEGER.
 */
import {
  LIABILITY_ACCOUNT_TYPES,
  type CalculateAumInput,
  type CalculateAumResult,
} from "./types"

const COUNTED_STATUSES = new Set(["open", "frozen"])

export function calculateAum(input: CalculateAumInput): CalculateAumResult {
  if (typeof input.baseCurrency !== "string" || !/^[A-Z]{3}$/.test(input.baseCurrency)) {
    return { ok: false, error: "baseCurrency must be a 3-letter ISO-4217 code" }
  }
  if (!Array.isArray(input.accounts)) {
    return { ok: false, error: "accounts must be an array" }
  }

  let totalAssetsMinor = 0
  let totalLiabilitiesMinor = 0
  let assetCount = 0
  let liabilityCount = 0

  for (let i = 0; i < input.accounts.length; i++) {
    const a = input.accounts[i]
    // Skip non-counted statuses.
    if (!COUNTED_STATUSES.has(a.status)) continue
    // Strict currency check — slice-1 doesn't do FX. Multi-currency
    // households surface as an error so the caller wires slice-3 FX.
    if (a.currency !== input.baseCurrency) {
      return {
        ok: false,
        error: `account ${i} currency "${a.currency}" differs from base "${input.baseCurrency}" — slice-3 FX translation required for multi-currency aggregation`,
      }
    }
    if (
      typeof a.balanceMinor !== "number" ||
      !Number.isInteger(a.balanceMinor) ||
      !Number.isFinite(a.balanceMinor)
    ) {
      return {
        ok: false,
        error: `account ${i} balanceMinor must be an integer (minor units)`,
      }
    }
    // Use absolute value to be sign-convention-tolerant — caller may
    // store mortgage as positive (debt amount owed) or negative
    // (institution-feed signed).
    const absBalance = Math.abs(a.balanceMinor)
    if (LIABILITY_ACCOUNT_TYPES.has(a.accountType)) {
      totalLiabilitiesMinor += absBalance
      liabilityCount += 1
    } else {
      totalAssetsMinor += absBalance
      assetCount += 1
    }
  }

  return {
    ok: true,
    aum: {
      totalAumMinor: totalAssetsMinor - totalLiabilitiesMinor,
      totalAssetsMinor,
      totalLiabilitiesMinor,
      assetCount,
      liabilityCount,
    },
  }
}
