/**
 * Prisma Decimal boundary utilities.
 *
 * After the D5+D8 Float→Decimal migration (20260524210000_d5_d8_float_to_decimal),
 * several columns return `Prisma.Decimal` objects at runtime. The application
 * layer uses plain `number | null` throughout, so these helpers normalize at
 * the DB boundary — keeping business logic decimal-free.
 *
 * Rules:
 *   - Convert at the *outermost* read boundary (route or repository layer).
 *   - Never call `toNumber()` inside pure business logic — keep it testable
 *     with plain numbers.
 *   - Add new columns to `normalizeTierRow` / `normalizeEarnRuleRow` here as
 *     more Decimal columns land in future migrations.
 */

/** Convert a Prisma Decimal (or any value with .toNumber()) to a JS number. */
export function decimalToNumber(v: unknown): number {
  if (v == null) return 0
  if (typeof v === "number") return v
  if (typeof v === "object" && typeof (v as { toNumber?(): number }).toNumber === "function") {
    return (v as { toNumber(): number }).toNumber()
  }
  return Number(v)
}

/** Serialize an exact Decimal money value without forcing it through IEEE-754. */
export function decimalToFixed(v: unknown, scale = 4): string {
  if (v != null && typeof v === "object"
      && typeof (v as { toFixed?(places: number): string }).toFixed === "function") {
    return (v as { toFixed(places: number): string }).toFixed(scale)
  }
  const parsed = Number(v)
  if (!Number.isFinite(parsed)) throw new TypeError("decimal value is not finite")
  return parsed.toFixed(scale)
}

/** Convert a nullable Prisma Decimal to `number | null`. */
export function decimalToNumberNullable(v: unknown): number | null {
  if (v == null) return null
  return decimalToNumber(v)
}

/* ─── Model-specific normalizers ─────────────────────────────────────── */

/**
 * Normalize a LoyaltyTier row — converts Decimal(6,4) `multiplier` to `number`.
 * Use at every GET / POST / PATCH response boundary to prevent Prisma.Decimal
 * from serializing as a JSON string ("1.25") instead of a number (1.25).
 */
export function normalizeTierRow<T extends { multiplier: unknown }>(
  t: T,
): Omit<T, "multiplier"> & { multiplier: number } {
  return { ...t, multiplier: decimalToNumber(t.multiplier) }
}

/**
 * Normalize a LoyaltyEarnRule row — converts Decimal(18,4) `pointsRate` and
 * `minOrderAmount` to `number | null`.
 */
export function normalizeEarnRuleRow<
  T extends { pointsRate: unknown; minOrderAmount: unknown },
>(r: T): Omit<T, "pointsRate" | "minOrderAmount"> & { pointsRate: number | null; minOrderAmount: number | null } {
  return {
    ...r,
    pointsRate: decimalToNumberNullable(r.pointsRate),
    minOrderAmount: decimalToNumberNullable(r.minOrderAmount),
  }
}

/**
 * Normalize a PaymentIntent row — converts Decimal(18,4) `amount` to `number`.
 * Used at every GET / POST / PATCH response boundary to prevent Prisma.Decimal
 * from serializing as a JSON string instead of a number.
 */
export function normalizeIntentRow<T extends { amount: unknown }>(
  r: T,
): Omit<T, "amount"> & { amount: number } {
  return { ...r, amount: decimalToNumber(r.amount) }
}

/**
 * Normalize a PaymentRefund row — converts Decimal(18,4) `amount` to `number`.
 */
export function normalizeRefundRow<T extends { amount: unknown }>(
  r: T,
): Omit<T, "amount"> & { amount: number } {
  return { ...r, amount: decimalToNumber(r.amount) }
}

/**
 * Normalize a Deal row — converts Decimal(18,4) `valueAmount` to `number`.
 * Use at every GET / POST / PUT response boundary in deals routes to prevent
 * Prisma.Decimal from serializing as a JSON string ("1234.50") instead of a
 * number (1234.5).
 */
export function normalizeDealRow<T extends { valueAmount: unknown }>(
  r: T,
): Omit<T, "valueAmount"> & { valueAmount: number } {
  return { ...r, valueAmount: decimalToNumber(r.valueAmount) }
}

/**
 * Normalize a ForecastSnapshot row — converts Decimal(18,4) amount columns
 * (`committedAmount`, `bestCaseAmount`, `forecastAmount`) to `number`.
 */
export function normalizeForecastSnapshotRow<
  T extends { committedAmount: unknown; bestCaseAmount: unknown; forecastAmount: unknown },
>(
  r: T,
): Omit<T, "committedAmount" | "bestCaseAmount" | "forecastAmount"> & {
  committedAmount: number
  bestCaseAmount: number
  forecastAmount: number
} {
  return {
    ...r,
    committedAmount: decimalToNumber(r.committedAmount),
    bestCaseAmount: decimalToNumber(r.bestCaseAmount),
    forecastAmount: decimalToNumber(r.forecastAmount),
  }
}

/**
 * Normalize a PipelineStageTransition row — converts Decimal(18,4)
 * `fromAmount` (nullable) and `toAmount` to `number | null` and `number`.
 */
export function normalizeTransitionRow<
  T extends { fromAmount: unknown; toAmount: unknown },
>(
  r: T,
): Omit<T, "fromAmount" | "toAmount"> & { fromAmount: number | null; toAmount: number } {
  return {
    ...r,
    fromAmount: decimalToNumberNullable(r.fromAmount),
    toAmount: decimalToNumber(r.toAmount),
  }
}

/**
 * Normalize a Contract row — converts Decimal(18,4) `valueAmount` to `number | null`.
 * Use at every GET response boundary in contracts routes to prevent Prisma.Decimal
 * from serializing as a JSON string instead of a number.
 */
export function normalizeContractRow<T extends { valueAmount: unknown }>(
  r: T,
): Omit<T, "valueAmount"> & { valueAmount: number | null } {
  return { ...r, valueAmount: decimalToNumberNullable(r.valueAmount) }
}

/**
 * Recursively walk `value` and convert Decimal / BigInt to safe JSON types.
 *
 * - Prisma.Decimal (duck-typed via `.toNumber()`) → JS `number`; non-finite → `null`
 * - BigInt → `number` (safe for export values; lossy above 2^53 but export amounts
 *   never reach that scale — included as future-proof guard for Contact/Campaign export)
 * - `Date` instances pass through unchanged (JSON.stringify handles them)
 * - Assumes no Prisma `Json` column contains a user-data object with a `toNumber` method
 *
 * Use at coarse export/snapshot boundaries where per-field enumeration is impractical.
 */
export function deepNormalizeDecimals(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === "bigint") return Number(value)
  if (typeof value !== "object") return value
  if (value instanceof Date) return value
  // Duck-type Prisma.Decimal: has .toNumber() method
  if (typeof (value as { toNumber?(): number }).toNumber === "function") {
    const n = (value as { toNumber(): number }).toNumber()
    return Number.isFinite(n) ? n : null
  }
  if (Array.isArray(value)) return value.map(deepNormalizeDecimals)
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = deepNormalizeDecimals(v)
  }
  return result
}

/**
 * Normalize a ForecastAccuracyReport row — converts 7 Decimal(18,4) money
 * and variance columns to `number`.
 * (variancePct* columns stay Float — percentages, not money.)
 */
export function normalizeForecastAccuracyRow<
  T extends {
    actualAmount: unknown
    forecastedAmount: unknown
    committedAmount: unknown
    bestCaseAmount: unknown
    varianceAbsForecast: unknown
    varianceAbsCommitted: unknown
    varianceAbsBestCase: unknown
  },
>(
  r: T,
): Omit<
  T,
  | "actualAmount"
  | "forecastedAmount"
  | "committedAmount"
  | "bestCaseAmount"
  | "varianceAbsForecast"
  | "varianceAbsCommitted"
  | "varianceAbsBestCase"
> & {
  actualAmount: number
  forecastedAmount: number
  committedAmount: number
  bestCaseAmount: number
  varianceAbsForecast: number
  varianceAbsCommitted: number
  varianceAbsBestCase: number
} {
  return {
    ...r,
    actualAmount: decimalToNumber(r.actualAmount),
    forecastedAmount: decimalToNumber(r.forecastedAmount),
    committedAmount: decimalToNumber(r.committedAmount),
    bestCaseAmount: decimalToNumber(r.bestCaseAmount),
    varianceAbsForecast: decimalToNumber(r.varianceAbsForecast),
    varianceAbsCommitted: decimalToNumber(r.varianceAbsCommitted),
    varianceAbsBestCase: decimalToNumber(r.varianceAbsBestCase),
  }
}

/**
 * Normalize a SubscriptionPlan row — converts Decimal(18,4) `unitAmount` to `number`.
 * Use at every GET/POST response boundary in subscription-plans routes.
 */
export function normalizeSubscriptionPlanRow<T extends { unitAmount: unknown }>(
  r: T,
): Omit<T, "unitAmount"> & { unitAmount: number } {
  return { ...r, unitAmount: decimalToNumber(r.unitAmount) }
}

/**
 * Normalize a Subscription row — converts Decimal(18,4) `unitAmount` to `number`.
 * Use at every GET/POST response boundary in subscriptions routes.
 */
export function normalizeSubscriptionRow<T extends { unitAmount: unknown }>(
  r: T,
): Omit<T, "unitAmount"> & { unitAmount: number } {
  return { ...r, unitAmount: decimalToNumber(r.unitAmount) }
}

/**
 * Normalize a SubscriptionEvent row — converts Decimal(18,4) `prorationAmount`
 * to `number | null`. Use at every GET response boundary for subscription events
 * to prevent Prisma.Decimal serializing as a JSON string.
 */
export function normalizeSubscriptionEventRow<T extends { prorationAmount: unknown }>(
  r: T,
): Omit<T, "prorationAmount"> & { prorationAmount: number | null } {
  return { ...r, prorationAmount: decimalToNumberNullable(r.prorationAmount) }
}

/**
 * Normalize an InvoiceItem row — converts Decimal(18,4) `unitPrice` and `total`
 * to JS `number`. quantity / discount / taxRate stay as-is (rates/quantities, not money).
 * Use when returning items in any invoice response after migration
 * 20260525270000_invoice_item_payment_decimal.
 */
export function normalizeInvoiceItemRow<T extends { unitPrice: unknown; total: unknown }>(
  r: T,
): Omit<T, "unitPrice" | "total"> & { unitPrice: number; total: number } {
  return {
    ...r,
    unitPrice: decimalToNumber(r.unitPrice),
    total: decimalToNumber(r.total),
  }
}

/**
 * Normalize an InvoicePayment row — converts Decimal(18,4) `amount` to JS `number`.
 * Use at every GET/POST response boundary in invoice-payments routes and in
 * arithmetic that reads payment.amount from a Prisma query result.
 *
 * Migration: 20260525270000_invoice_item_payment_decimal
 */
export function normalizeInvoicePaymentRow<T extends { amount: unknown }>(
  r: T,
): Omit<T, "amount"> & { amount: number } {
  return { ...r, amount: decimalToNumber(r.amount) }
}

/**
 * Normalize a Bill row — converts Decimal(18,4) `totalAmount`, `paidAmount`,
 * and `balanceDue` to JS `number`. Use at every GET/POST response boundary
 * and before any payment arithmetic (paidAmount + paymentAmount etc.) to
 * prevent IEEE-754 drift and Decimal string-concat bugs.
 *
 * Migration: 20260525280000_bill_money_decimal
 */
export function normalizeBillRow<
  T extends { totalAmount: unknown; paidAmount: unknown; balanceDue: unknown },
>(
  r: T,
): Omit<T, "totalAmount" | "paidAmount" | "balanceDue"> & {
  totalAmount: number
  paidAmount: number
  balanceDue: number
} {
  return {
    ...r,
    totalAmount: decimalToNumber(r.totalAmount),
    paidAmount: decimalToNumber(r.paidAmount),
    balanceDue: decimalToNumber(r.balanceDue),
  }
}

/**
 * Normalize a BillPayment row — converts Decimal(18,4) `amount` to JS `number`.
 * Use at every GET/POST response boundary in bill-payments routes and before any
 * arithmetic on the payment amount.
 *
 * Migration: 20260525280000_bill_money_decimal
 */
export function normalizeBillPaymentRow<T extends { amount: unknown }>(
  r: T,
): Omit<T, "amount"> & { amount: number } {
  return { ...r, amount: decimalToNumber(r.amount) }
}

/** Normalize Fund NUMERIC(18,4) projection fields at the HTTP boundary. */
export function normalizeFundRow<
  T extends { targetAmount: unknown | null; currentBalance: unknown },
>(
  r: T,
): Omit<T, "targetAmount" | "currentBalance"> & {
  targetAmount: number | null
  currentBalance: number
  targetAmountExact: string | null
  currentBalanceExact: string
} {
  return {
    ...r,
    targetAmount: r.targetAmount == null ? null : decimalToNumber(r.targetAmount),
    currentBalance: decimalToNumber(r.currentBalance),
    targetAmountExact: r.targetAmount == null ? null : decimalToFixed(r.targetAmount, 4),
    currentBalanceExact: decimalToFixed(r.currentBalance, 4),
  }
}

/** Normalize the append-only FundTransaction amount for API consumers. */
export function normalizeFundTransactionRow<T extends { amount: unknown }>(
  r: T,
): Omit<T, "amount"> & { amount: number; amountExact: string } {
  return { ...r, amount: decimalToNumber(r.amount), amountExact: decimalToFixed(r.amount, 4) }
}

/**
 * Normalize an Invoice row — converts all 7 Decimal(18,4) money columns to
 * JS `number`. taxRate is intentionally Float and is left unchanged.
 * Use at every GET/POST response boundary AND before any arithmetic on these
 * fields (prevents NaN from Prisma.Decimal + number operations).
 *
 * Migration: 20260525260000_invoice_money_decimal
 */
export function normalizeInvoiceRow<
  T extends {
    subtotal: unknown
    discountValue: unknown
    discountAmount: unknown
    taxAmount: unknown
    totalAmount: unknown
    paidAmount: unknown
    balanceDue: unknown
  },
>(
  r: T,
): Omit<T, "subtotal" | "discountValue" | "discountAmount" | "taxAmount" | "totalAmount" | "paidAmount" | "balanceDue"> & {
  subtotal: number
  discountValue: number
  discountAmount: number
  taxAmount: number
  totalAmount: number
  paidAmount: number
  balanceDue: number
} {
  return {
    ...r,
    subtotal: decimalToNumber(r.subtotal),
    discountValue: decimalToNumber(r.discountValue),
    discountAmount: decimalToNumber(r.discountAmount),
    taxAmount: decimalToNumber(r.taxAmount),
    totalAmount: decimalToNumber(r.totalAmount),
    paidAmount: decimalToNumber(r.paidAmount),
    balanceDue: decimalToNumber(r.balanceDue),
  }
}
