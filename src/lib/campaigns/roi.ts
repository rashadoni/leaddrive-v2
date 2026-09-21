import { bucketByCurrency, type MoneyBucket } from "@/lib/deal-money"

/**
 * Campaign ROI arithmetic — shared by GET /api/v1/campaign-roi and every
 * screen that prints its figures, so no two of them can disagree.
 *
 * Money is grouped by currency, never added across currencies. Deals carry
 * their own `currency`; the product has no exchange rates (Currency
 * .exchangeRate is never written), so 5 000 USD + 3 000 AZN is not 8 000 of
 * anything. ROI is a ratio of revenue to cost, and is only computed when both
 * are in the same single currency — otherwise the verdict names why not.
 */

/**
 * The currency a campaign budget is in.
 *
 * `Campaign.budget` has no currency column and the form takes a bare number.
 * Every campaign screen already prints it as manat (the list, the detail page,
 * the «Analitika» tab), so that is what the owner has been entering. The
 * assumption is named here, once, instead of borrowing DEFAULT_CURRENCY — which
 * is USD in production and would print the same budget as dollars on this page
 * and as manat on the next one. A per-campaign currency column is the real fix
 * and belongs to its own change.
 */
export const CAMPAIGN_BUDGET_CURRENCY = "AZN"

/**
 * Statuses in which a campaign has gone out. A draft, a scheduled campaign that
 * has not fired yet and a cancelled one spent nothing, so their budget is a
 * plan, not a cost. `totalSent > 0` also counts: a campaign cancelled midway
 * still paid for what it sent.
 */
const LAUNCHED_STATUSES = new Set(["sending", "sent", "ab_testing"])

export function campaignLaunched(c: { status?: string | null; totalSent?: number | null }): boolean {
  return LAUNCHED_STATUSES.has(String(c.status ?? "")) || (c.totalSent ?? 0) > 0
}

/**
 * Cost = the campaign's budget, counted only once the campaign has gone out.
 *
 * `Campaign.actualCost` exists but nothing in the product writes it — the
 * campaign API and form accept only `budget` — so in a live tenant it is 0 and
 * ROI against it would never exist. The budget is the one cost figure people
 * enter; the screen says so next to the number.
 */
export function campaignCost(c: { status?: string | null; totalSent?: number | null; budget?: number | null }): number {
  if (!campaignLaunched(c)) return 0
  const budget = Number(c.budget)
  return Number.isFinite(budget) && budget > 0 ? budget : 0
}

export type RoiVerdict =
  | { kind: "value"; percent: number; currency: string }
  /** No won revenue at all — not −100%, which the formula gives for any cost with nothing won. */
  | { kind: "no-revenue" }
  /** The campaign has not gone out: its budget is a plan, not a cost. */
  | { kind: "not-launched" }
  /** Launched, but no budget entered, so there is nothing to divide by. */
  | { kind: "no-cost" }
  /** Revenue is in another currency than the cost, or in several. */
  | { kind: "currency-mismatch"; revenueCurrencies: string[]; costCurrency: string }

/** Buckets that actually hold money — a zero bucket names no currency. */
function nonZero(buckets: MoneyBucket[]): MoneyBucket[] {
  return buckets.filter((b) => b.value > 0)
}

export function roiVerdict(
  revenue: MoneyBucket[],
  cost: { currency: string; value: number },
  opts: { launched?: boolean } = {},
): RoiVerdict {
  const earned = nonZero(revenue)
  if (earned.length === 0) return { kind: "no-revenue" }
  if (opts.launched === false) return { kind: "not-launched" }
  if (!(cost.value > 0)) return { kind: "no-cost" }
  const costCurrency = cost.currency.toUpperCase()
  if (earned.length > 1 || earned[0].currency !== costCurrency) {
    return { kind: "currency-mismatch", revenueCurrencies: earned.map((b) => b.currency), costCurrency }
  }
  return { kind: "value", percent: ((earned[0].value - cost.value) / cost.value) * 100, currency: costCurrency }
}

/** Sums bucket lists per currency — the only way two money totals are ever combined here. */
export function mergeBuckets(lists: MoneyBucket[][]): MoneyBucket[] {
  const byCode = new Map<string, MoneyBucket>()
  for (const list of lists) {
    for (const b of list) {
      const prev = byCode.get(b.currency)
      if (prev) {
        prev.value += b.value
        prev.count += b.count
      } else {
        byCode.set(b.currency, { ...b })
      }
    }
  }
  // Same ordering as bucketByCurrency: largest first, stable ties.
  return [...byCode.values()].sort(
    (a, b) => b.value - a.value || b.count - a.count || a.currency.localeCompare(b.currency),
  )
}

/** Bucket rows with the budget currency as fallback, never DEFAULT_CURRENCY. */
export function revenueBuckets(rows: { valueAmount: number; currency?: string | null }[]): MoneyBucket[] {
  return bucketByCurrency(rows, CAMPAIGN_BUDGET_CURRENCY)
}
