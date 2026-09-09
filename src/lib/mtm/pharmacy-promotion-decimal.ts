/**
 * Exact input boundary shared by the SWM-09 server validators and browser
 * outbox. PostgreSQL stores promotion quantities and points as DECIMAL(18,4),
 * so accepting a wider client value would either fail late or change the
 * canonical idempotency hash after coercion.
 */
export const PHARMACY_PROMOTION_DECIMAL_SCALE = 4
export const PHARMACY_PROMOTION_DECIMAL_MAX = "99999999999999.9999"

const MAX_INTEGER_DIGITS = 14
const UNSIGNED_DECIMAL = /^(\d+)(?:\.(\d+))?$/

/**
 * Return the unique plain-decimal representation of an unsigned DECIMAL(18,4)
 * value. `null` means the value is negative, non-finite, over-scale or outside
 * the database range.
 */
export function normalizePharmacyPromotionDecimal18_4(
  value: string | number,
): string | null {
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return null

  const input = typeof value === "number"
    ? (Object.is(value, -0) ? "0" : value.toString())
    : value.trim()
  const match = UNSIGNED_DECIMAL.exec(input)
  if (!match) return null

  const integer = (match[1] ?? "").replace(/^0+(?=\d)/, "")
  const fraction = match[2] ?? ""
  if (fraction.length > PHARMACY_PROMOTION_DECIMAL_SCALE) return null
  if (integer.length > MAX_INTEGER_DIGITS) return null

  const canonicalFraction = fraction.replace(/0+$/, "")
  return canonicalFraction.length > 0 ? `${integer}.${canonicalFraction}` : integer
}

/**
 * Phone decimal keyboards in RU/AZ commonly emit a comma. Accept exactly one
 * decimal comma at the human-input boundary, but keep API/idempotency payloads
 * on the canonical dot representation used by PostgreSQL and signed hashes.
 */
export function normalizePharmacyPromotionHumanDecimal18_4(value: string): string | null {
  const input = value.trim()
  const canonicalInput = /^\d+,\d+$/.test(input) ? input.replace(",", ".") : input
  return normalizePharmacyPromotionDecimal18_4(canonicalInput)
}
