import { DEFAULT_CURRENCY, getCurrencySymbol } from "@/lib/currency"

/**
 * Money on the deals screen is grouped by currency, never added across
 * currencies.
 *
 * Before this file every total on the board was a plain
 * `reduce((s, d) => s + d.valueAmount, 0)` and was then printed with a single
 * hardcoded symbol — so a board holding 12 000 USD and 8 000 AZN showed
 * "20 000 ₼", a number that exists nowhere. The kanban column headers did the
 * same through `fmtAmount(total)`, which defaults the symbol rather than
 * asking what the deals were denominated in.
 *
 * Converting instead of grouping was considered and rejected: `Currency`
 * carries an `exchangeRate` column, but nothing in the product writes it (the
 * only reader is `tenant-export`), so every rate in a live tenant is the
 * `1.0` default. Multiplying by a stale 1.0 would produce the same wrong
 * number while looking authoritative. Grouping is honest with the data we
 * actually have; FX belongs to a separate change that also maintains rates.
 */
export interface MoneyBucket {
  currency: string
  value: number
  count: number
}

export interface MoneyRow {
  valueAmount: number
  currency?: string | null
}

/** The currency a row belongs to — one rule, used by every grouping here. */
export function currencyOf(row: MoneyRow, fallback: string = DEFAULT_CURRENCY): string {
  return (row.currency || fallback).toUpperCase()
}

/**
 * One bucket per currency, largest first. Ties break on count and then on the
 * code itself so the order is stable across renders (React keys, and a total
 * that must not swap places between two equal halves of a board).
 */
export function bucketByCurrency(rows: MoneyRow[], fallback: string = DEFAULT_CURRENCY): MoneyBucket[] {
  const byCode = new Map<string, MoneyBucket>()
  for (const row of rows) {
    const currency = currencyOf(row, fallback)
    const value = Number.isFinite(row.valueAmount) ? row.valueAmount : 0
    const bucket = byCode.get(currency)
    if (bucket) {
      bucket.value += value
      bucket.count++
    } else {
      byCode.set(currency, { currency, value, count: 1 })
    }
  }
  return [...byCode.values()].sort(
    (a, b) => b.value - a.value || b.count - a.count || a.currency.localeCompare(b.currency),
  )
}

/**
 * The bucket a screen leads with, plus the ones it has to mention afterwards.
 * `primary` is never null so callers can render a zero without branching.
 */
export function leadBucket(
  buckets: MoneyBucket[],
  fallback: string = DEFAULT_CURRENCY,
): { primary: MoneyBucket; extras: MoneyBucket[] } {
  if (buckets.length === 0) {
    return { primary: { currency: fallback.toUpperCase(), value: 0, count: 0 }, extras: [] }
  }
  return { primary: buckets[0], extras: buckets.slice(1) }
}

/** "1 735 782 ₼" — the symbol comes from the bucket, not from a default. */
export function formatBucket(bucket: MoneyBucket): string {
  return `${Math.round(bucket.value).toLocaleString()} ${getCurrencySymbol(bucket.currency)}`
}

/**
 * What to put next to the lead number when a board mixes currencies:
 * "+ 300 000 $ · 3". Returns null when there is nothing to add — a screen with
 * one currency must look exactly as it did before.
 */
export function formatExtras(extras: MoneyBucket[]): string | null {
  if (extras.length === 0) return null
  return extras.map((b) => `+ ${formatBucket(b)} · ${b.count}`).join("  ")
}

/**
 * Weighted (probability-adjusted) total for ONE currency. Kept next to the
 * bucketing so the two can never disagree about what "this currency" means —
 * a row with no currency belongs to `fallback` in both.
 */
export function weightedForCurrency(
  rows: (MoneyRow & { probability?: number | null })[],
  currency: string,
  fallback: string = DEFAULT_CURRENCY,
): number {
  const want = currency.toUpperCase()
  let sum = 0
  for (const row of rows) {
    if (currencyOf(row, fallback) !== want) continue
    const value = Number.isFinite(row.valueAmount) ? row.valueAmount : 0
    sum += value * ((row.probability || 0) / 100)
  }
  return Math.round(sum)
}

/**
 * One deal's own amount. Unlike `formatBucket` this keeps the cents: a total
 * of many deals reads better rounded, but a single card showing 1 500,50 as
 * "1 501" is telling the user the wrong number about one specific deal.
 * `valueAmount` is Decimal(18,4) in the database.
 */
export function formatAmount(value: number, currency?: string | null): string {
  const amount = Number.isFinite(value) ? value : 0
  const rounded = Math.round(amount * 100) / 100
  const text = Number.isInteger(rounded)
    ? rounded.toLocaleString()
    : rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${text} ${getCurrencySymbol(currency || undefined)}`
}
