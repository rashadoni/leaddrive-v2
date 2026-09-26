/**
 * The figures GET /api/v1/invoices/stats serves to the cards, tiles and payment
 * bar at the top of the Invoices page — per currency.
 *
 * Until 2026-09-22 the route added totalAmount, paidAmount and balanceDue over
 * every invoice, whatever its currency, and labelled the sum with the product's
 * default currency (AZN on prod). A USD-only organisation read «1 082 600 AZN»
 * under «Total invoiced»; one billing in USD and EUR, with a PLN draft, read
 * «493 245 AZN». No invoice holds either number.
 *
 * Money is grouped by currency (src/lib/deal-money.ts) and never added across
 * currencies: the product has no exchange rates. «Invoiced» means billed —
 * drafts, cancelled and refunded invoices bill nobody — and «paid» counts an
 * invoice marked paid in full: the readings the charts below the cards use
 * (src/lib/invoices/analytics.ts), so a card and its chart cannot disagree.
 * The status counts are the route's as they always were.
 */
import { bucketByCurrency, currencyOf, type MoneyBucket } from "@/lib/deal-money"
import { isBilled, paidOn } from "@/lib/invoices/analytics"

export type InvoiceStatsRow = {
  status: string
  totalAmount: number
  paidAmount: number
  balanceDue: number
  currency?: string | null
  issueDate?: Date | null
  createdAt: Date
}

/** One bucket per currency, largest first; an empty list when nothing is there. */
export type InvoiceMoney = {
  /** Billed invoices' totals. */
  invoiced: MoneyBucket[]
  /** What has been paid on billed invoices. */
  paid: MoneyBucket[]
  /** Balance due on sent, viewed, overdue and partially paid invoices. */
  outstanding: MoneyBucket[]
  /** Balance due on overdue invoices. */
  overdue: MoneyBucket[]
  /** Billed invoices dated this month and this year (issue date, else creation date). */
  thisMonth: MoneyBucket[]
  thisYear: MoneyBucket[]
}

export type InvoiceCounts = {
  totalCount: number
  draftCount: number
  /** Sent and viewed. */
  sentCount: number
  paidCount: number
  overdueCount: number
  partiallyPaidCount: number
  cancelledCount: number
  /** Every invoice dated this month / this year, drafts included. */
  thisMonthCount: number
  thisYearCount: number
}

/**
 * The single-number fields the route returned before, for a page loaded before
 * this change: every figure is in `currency` — the one with the most invoiced —
 * and the other currencies are left out rather than added in.
 */
export type LegacyInvoiceTotals = {
  currency: string
  totalInvoiced: number
  totalPaid: number
  totalOutstanding: number
  totalOverdue: number
  thisMonthAmount: number
  thisYearAmount: number
  avgAmount: number
}

type Entry = { valueAmount: number; currency: string }

function buckets(entries: Entry[]): MoneyBucket[] {
  return bucketByCurrency(entries).map((b) => ({ ...b, value: Math.round(b.value * 100) / 100 }))
}

export function invoiceStats(
  rows: readonly InvoiceStatsRow[],
  now: Date,
  fallbackCurrency: string,
): InvoiceCounts & { money: InvoiceMoney } & LegacyInvoiceTotals {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)

  const counts: InvoiceCounts = {
    totalCount: rows.length,
    draftCount: 0,
    sentCount: 0,
    paidCount: 0,
    overdueCount: 0,
    partiallyPaidCount: 0,
    cancelledCount: 0,
    thisMonthCount: 0,
    thisYearCount: 0,
  }
  const invoiced: Entry[] = []
  const paid: Entry[] = []
  const outstanding: Entry[] = []
  const overdue: Entry[] = []
  const thisMonth: Entry[] = []
  const thisYear: Entry[] = []

  for (const row of rows) {
    const status = row.status
    const currency = currencyOf({ valueAmount: 0, currency: row.currency }, fallbackCurrency)
    const date = row.issueDate || row.createdAt
    const billed = isBilled(row)

    if (date >= startOfMonth) counts.thisMonthCount++
    if (date >= startOfYear) counts.thisYearCount++
    if (status === "draft") counts.draftCount++
    else if (status === "sent" || status === "viewed") counts.sentCount++
    else if (status === "paid") counts.paidCount++
    else if (status === "overdue") counts.overdueCount++
    else if (status === "partially_paid") counts.partiallyPaidCount++
    else if (status === "cancelled") counts.cancelledCount++

    if (!billed) continue
    invoiced.push({ valueAmount: row.totalAmount, currency })
    if (date >= startOfMonth) thisMonth.push({ valueAmount: row.totalAmount, currency })
    if (date >= startOfYear) thisYear.push({ valueAmount: row.totalAmount, currency })

    const received = paidOn({ status, amount: row.totalAmount, paidAmount: row.paidAmount })
    if (received > 0) paid.push({ valueAmount: received, currency })

    if (["sent", "viewed", "overdue", "partially_paid"].includes(status) && row.balanceDue > 0) {
      outstanding.push({ valueAmount: row.balanceDue, currency })
      if (status === "overdue") overdue.push({ valueAmount: row.balanceDue, currency })
    }
  }

  const money: InvoiceMoney = {
    invoiced: buckets(invoiced),
    paid: buckets(paid),
    outstanding: buckets(outstanding),
    overdue: buckets(overdue),
    thisMonth: buckets(thisMonth),
    thisYear: buckets(thisYear),
  }

  const currency = money.invoiced[0]?.currency ?? currencyOf({ valueAmount: 0, currency: null }, fallbackCurrency)
  const inCurrency = (list: MoneyBucket[]) => list.find((b) => b.currency === currency)
  const lead = inCurrency(money.invoiced)
  return {
    ...counts,
    money,
    currency,
    totalInvoiced: lead?.value ?? 0,
    totalPaid: inCurrency(money.paid)?.value ?? 0,
    totalOutstanding: inCurrency(money.outstanding)?.value ?? 0,
    totalOverdue: inCurrency(money.overdue)?.value ?? 0,
    thisMonthAmount: inCurrency(money.thisMonth)?.value ?? 0,
    thisYearAmount: inCurrency(money.thisYear)?.value ?? 0,
    avgAmount: lead && lead.count > 0 ? Math.round((lead.value / lead.count) * 100) / 100 : 0,
  }
}
