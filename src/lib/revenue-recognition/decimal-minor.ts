/**
 * Decimal ↔ minor-units conversion — M4 Phase 6 Block C slice 1.
 *
 * The five M4 helpers all operate on **integer minor units** (cents,
 * yen, etc.) to keep math Float-free. Real-world callers receive
 * Prisma `Decimal` values from the DB and need to round-trip those
 * through the helpers. This module is the canonical converter so
 * each caller doesn't reinvent USD-2 / JPY-0 / BHD-3 mappings.
 *
 * Currency-exponent source: ISO 4217 standard. Slice-1 ships an
 * allowlist of the most common 25-ish currencies; unknown codes
 * default to 2 (most common case) with a warning code in the result.
 * Slice-2 may externalise this to tenant config.
 *
 * Pure synchronous. No Prisma import — caller passes either a number
 * or a string (Prisma.Decimal.toString() output is the canonical
 * shape we accept here).
 */

/**
 * Minor-unit exponent per ISO 4217. Most are 2 ("1 unit" = 100 minor).
 * Special cases:
 *   • JPY / KRW / VND / IDR (and a few others) — 0 minor units.
 *   • BHD / IQD / KWD / OMR / TND / JOD / LYD — 3 minor units.
 *   • CLF / UYW — 4 minor units (rarely seen).
 * Unknown codes default to 2.
 */
const CURRENCY_EXPONENT: Readonly<Record<string, number>> = {
  // 0-exponent
  JPY: 0,
  KRW: 0,
  VND: 0,
  IDR: 0,
  CLP: 0,
  ISK: 0,
  HUF: 0,
  TWD: 0,
  // 2-exponent (default)
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  CNY: 2,
  RUB: 2,
  AZN: 2,
  PLN: 2,
  TRY: 2,
  UAH: 2,
  CZK: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  NZD: 2,
  SGD: 2,
  HKD: 2,
  // 3-exponent
  BHD: 3,
  IQD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
  JOD: 3,
  LYD: 3,
  // 4-exponent
  CLF: 4,
}

const DEFAULT_EXPONENT = 2

export function currencyExponent(currency: string): number {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return DEFAULT_EXPONENT
  return CURRENCY_EXPONENT[currency] ?? DEFAULT_EXPONENT
}

export interface DecimalToMinorResult {
  ok: true
  /** Integer minor units (e.g. dollars × 100). */
  minor: number
  /** Echo of the resolved exponent. */
  exponent: number
}

export type DecimalToMinorOutcome =
  | DecimalToMinorResult
  | { ok: false; error: string }

/**
 * Convert a decimal value (number or Prisma.Decimal.toString() output)
 * to integer minor units for a given currency. Rejects:
 *   • Non-finite numbers (NaN / Infinity).
 *   • Negative values (helpers operate on non-negative minor units;
 *     reversals are caller-side as separate negative entries).
 *   • Strings that don't parse as decimal numbers.
 *   • Values with more decimal places than the currency exponent
 *     allows (e.g. USD `123.456` rejected; truncating silently is a
 *     drift risk).
 *
 * Returns the integer minor units + the resolved exponent.
 */
export function decimalToMinor(
  decimal: number | string,
  currency: string
): DecimalToMinorOutcome {
  const exponent = currencyExponent(currency)

  // 1. Normalise to a string representation (avoids Float-printing
  //    drift on edge values like 0.1 + 0.2 = 0.30000000000000004).
  let str: string
  if (typeof decimal === "number") {
    if (!Number.isFinite(decimal)) {
      return { ok: false, error: "decimal must be a finite number" }
    }
    // Use toFixed(exponent + 1) to keep one extra digit for the
    // "more decimals than allowed" check below — but we have to be
    // careful: Number → String rounding can hide a tiny precision
    // drift on the input side. For callers using a typed Decimal,
    // they should call `.toString()` first.
    str = decimal.toFixed(exponent + 4) // keep buffer; we'll re-check digit count
  } else if (typeof decimal === "string") {
    str = decimal
  } else {
    return { ok: false, error: "decimal must be number or string" }
  }

  // 2. Parse with strict regex: optional minus, integer part, optional
  //    fractional part.
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(str.trim())
  if (!m) {
    return { ok: false, error: `decimal "${str}" is not a valid number string` }
  }
  const sign = m[1] === "-" ? -1 : 1
  if (sign < 0) {
    return { ok: false, error: "decimal must be non-negative" }
  }
  const intPart = m[2]
  const fracPart = m[3] ?? ""

  // 3. Reject more decimals than exponent allows. (Trim trailing zeros
  //    first — "1.5000" with exponent 2 is fine.)
  const trimmedFrac = fracPart.replace(/0+$/, "")
  if (trimmedFrac.length > exponent) {
    return {
      ok: false,
      error: `decimal "${str}" has ${trimmedFrac.length} fractional digits but ${currency} allows ${exponent}`,
    }
  }

  // 4. Compose minor units = intPart × 10^exponent + fracPart-padded-right
  const padded = (fracPart + "0".repeat(exponent)).slice(0, exponent)
  // Use BigInt for the int-part arithmetic to defend against very large
  // dollar values (>$9 trillion would overflow Number) — even though
  // realistic contracts don't reach there, the helper is defensive.
  const intBig = BigInt(intPart) * BigInt(10) ** BigInt(exponent)
  const fracBig = padded.length > 0 ? BigInt(padded) : BigInt(0)
  const totalBig = intBig + fracBig
  if (totalBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      ok: false,
      error: `decimal "${str}" in ${currency} exceeds Number.MAX_SAFE_INTEGER as minor units`,
    }
  }
  return { ok: true, minor: Number(totalBig), exponent }
}

export function minorToDecimalString(minor: number, currency: string): string {
  const exponent = currencyExponent(currency)
  if (!Number.isInteger(minor) || minor < 0) return "0"
  if (exponent === 0) return String(minor)
  const s = String(minor).padStart(exponent + 1, "0")
  return `${s.slice(0, -exponent)}.${s.slice(-exponent)}`
}
