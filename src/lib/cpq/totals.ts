/**
 * S6 CPQ — pure total-computation helpers.
 *
 * Computes line totals, quote subtotals, and quote final totals from
 * raw discount inputs. No Prisma, no I/O — designed for unit tests +
 * the slice-2 route layer to call before persisting.
 *
 * ## Discount semantics
 *
 * Both line items and the quote itself accept EITHER an absolute
 * discount amount OR a percentage discount, never both at once. The
 * pure helpers here accept both fields as input but the **route layer
 * enforces XOR** via Zod `.refine()` (`api/v1/quotes/route.ts` +
 * `api/v1/quotes/[id]/route.ts`) — 400 if both are non-zero.
 *
 * The DB CHECK constraint is intentionally permissive so a future
 * "absolute discount on top of percentage" feature wouldn't need a
 * second migration. When both happen to be non-null in legacy /
 * psql-injected data, these helpers fall through to the abs-wins
 * precedence below — that's belt-and-suspenders, not the contract.
 *
 * ## Rounding
 *
 * All return values are quantized to 4 decimal places (the Decimal(18, 4)
 * column precision). Half-up rounding (the standard accountant rule)
 * is used so 0.50005 → 0.5001 rather than 0.5000.
 *
 * ## Decimal vs number
 *
 * Inputs accept both `number` and `string` (the Prisma client returns
 * Decimal columns as `Decimal` objects which stringify cleanly). All
 * arithmetic goes through string→Decimal so IEEE-754 drift never
 * surfaces — see the D5 Payments Float→Decimal sweep memory for the
 * rationale (`memory/project_payments_slice2_p0.md`).
 *
 * The output `number` is safe to compare in tests but the route layer
 * passes a `Decimal.toString()` through to Prisma for persistence.
 */

import { Decimal } from "@prisma/client/runtime/library"

/** Numeric input — number, string, or Decimal. */
export type NumLike = number | string | Decimal

function toDecimal(v: NumLike | null | undefined, fallback = "0"): Decimal {
  if (v === null || v === undefined) return new Decimal(fallback)
  if (v instanceof Decimal) return v
  if (typeof v === "number") return new Decimal(v)
  return new Decimal(v)
}

/** Quantize to 4dp half-up. Matches the Decimal(18, 4) DB column precision. */
function quantize(d: Decimal): Decimal {
  return d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
}

/* ─── Line-item total ─────────────────────────────────────────────── */

export interface LineTotalInput {
  quantity: NumLike
  unitPrice: NumLike
  /** Absolute discount on the line (preferred — see XOR note). */
  lineDiscountAmount?: NumLike | null
  /** Percentage discount on the line (0..<100). */
  lineDiscountPct?: NumLike | null
}

/**
 * Compute a single line item's `lineTotal`.
 *
 * Formula:
 *   gross         = quantity * unitPrice
 *   amountAbs     = lineDiscountAmount (or 0)
 *   amountPct     = gross * (lineDiscountPct / 100)  // only if no abs
 *   discount      = amountAbs (preferred) OR amountPct
 *   lineTotal     = max(0, gross - discount)
 *
 * The `max(0, ...)` clamp prevents a negative line total when discount
 * exceeds gross (e.g. a per-line credit that's bigger than the line —
 * which the route layer should reject anyway, but defense in depth).
 */
export function computeLineTotal(input: LineTotalInput): Decimal {
  const quantity = toDecimal(input.quantity)
  const unitPrice = toDecimal(input.unitPrice)
  const gross = quantity.mul(unitPrice)

  // Discount precedence: absolute wins over percentage when both supplied.
  // The route layer enforces XOR, but we degrade gracefully.
  const absDiscount = toDecimal(input.lineDiscountAmount, "0")
  let discount: Decimal
  if (absDiscount.gt(0)) {
    discount = absDiscount
  } else if (input.lineDiscountPct !== null && input.lineDiscountPct !== undefined) {
    const pct = toDecimal(input.lineDiscountPct)
    discount = gross.mul(pct).div(100)
  } else {
    discount = new Decimal(0)
  }

  const net = gross.minus(discount)
  return quantize(net.lt(0) ? new Decimal(0) : net)
}

/* ─── Quote subtotal ──────────────────────────────────────────────── */

/**
 * Sum the `lineTotal` of every line item. Empty input → 0.
 *
 * Accepts either pre-computed `lineTotal` fields or raw line-item
 * specs (in which case `computeLineTotal` runs for each).
 */
export function computeSubtotal(
  lines: Array<{ lineTotal: NumLike } | LineTotalInput>,
): Decimal {
  let sum = new Decimal(0)
  for (const line of lines) {
    if ("lineTotal" in line) {
      sum = sum.plus(toDecimal(line.lineTotal))
    } else {
      sum = sum.plus(computeLineTotal(line))
    }
  }
  return quantize(sum)
}

/* ─── Quote total ─────────────────────────────────────────────────── */

export interface QuoteTotalInput {
  subtotal: NumLike
  /** Absolute quote-level discount (preferred — see XOR note). */
  discountAmount?: NumLike | null
  /** Percentage quote-level discount (0..<100). */
  discountPct?: NumLike | null
}

/**
 * Compute final `totalAmount` = subtotal - quoteDiscount, clamped to ≥0.
 *
 * Same precedence as line-level: absolute wins over percentage.
 */
export function computeQuoteTotal(input: QuoteTotalInput): Decimal {
  const subtotal = toDecimal(input.subtotal)
  const absDiscount = toDecimal(input.discountAmount, "0")
  let discount: Decimal
  if (absDiscount.gt(0)) {
    discount = absDiscount
  } else if (input.discountPct !== null && input.discountPct !== undefined) {
    const pct = toDecimal(input.discountPct)
    discount = subtotal.mul(pct).div(100)
  } else {
    discount = new Decimal(0)
  }
  const total = subtotal.minus(discount)
  return quantize(total.lt(0) ? new Decimal(0) : total)
}

/* ─── End-to-end convenience ──────────────────────────────────────── */

/**
 * Roll up a full quote from raw line-item specs + quote-level discount.
 *
 * Returns the computed subtotal + total in a single pass — useful for
 * the slice-2 route layer's POST/PATCH paths that persist all three
 * (`lineTotal` per line, then `subtotal` + `totalAmount` on quote).
 */
export function rollUpQuote(
  lines: LineTotalInput[],
  quoteDiscount: { discountAmount?: NumLike | null; discountPct?: NumLike | null } = {},
): { lineTotals: Decimal[]; subtotal: Decimal; totalAmount: Decimal } {
  const lineTotals = lines.map(computeLineTotal)
  const subtotal = computeSubtotal(lineTotals.map((lineTotal) => ({ lineTotal })))
  const totalAmount = computeQuoteTotal({
    subtotal,
    discountAmount: quoteDiscount.discountAmount,
    discountPct: quoteDiscount.discountPct,
  })
  return { lineTotals, subtotal, totalAmount }
}
