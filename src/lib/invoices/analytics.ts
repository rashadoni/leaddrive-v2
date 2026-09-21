/**
 * Invoices → «Analitika»: every figure on the tab's charts, computed from the
 * organisation's own records.
 *
 * Until 2026-09-21 the «Weekly collection» bars were
 * `totalPaid / 12 / 4 × (0.7 + Math.random() × 0.6 + i × 0.03)` — a new chart on
 * every render. «Auto-invoices» listed TechCorp Solutions, DataFlow Inc. and
 * CloudNet Systems, companies that exist nowhere, on every tenant: the page
 * never passed the field its real branch filtered on, while prod held 63 real
 * recurring rules. «Avg. days to pay» was outstanding ÷ (all-time invoiced ÷
 * 365), «Monthly avg.» was all-time invoiced ÷ 12, the month-on-month badge
 * divided by 1 when the previous month billed nothing, and every money figure
 * added AZN, USD, EUR and PLN together — on 2026-09-21 three of the four
 * organisations that invoice used more than one currency.
 *
 * The rule is the one in src/lib/campaigns/analytics.ts: no function may
 * return a figure that no record holds. When the records cannot answer, the
 * answer is `null` or an empty list and the tab prints «—» or says why.
 * Money is grouped by currency (src/lib/deal-money.ts) and never added across
 * currencies: the product has no exchange rates.
 */
import { bucketByCurrency, currencyOf } from "@/lib/deal-money"
import { calculateInvoiceTotals } from "@/lib/invoice-calculations"

export type PaymentAnalyticsRecord = {
  amount: number
  currency?: string | null
  paymentDate: string
}

export type InvoiceAnalyticsRecord = {
  id: string
  status: string
  /** The invoice total (`totalAmount`). */
  amount: number
  paidAmount?: number | null
  currency?: string | null
  issueDate?: string | null
  dueDate?: string | null
  createdAt: string
  /** The payments recorded against the invoice; absent when they were not loaded. */
  payments?: PaymentAnalyticsRecord[] | null
}

/** Money of one currency spread over slots — weeks, months or aging buckets. */
export type CurrencySeries = {
  currency: string
  /** The sum over every slot; currencies are ranked by it, largest first. */
  total: number
  /** How many records (payments or invoices) the sum is made of. */
  count: number
  values: number[]
}

const DAY_MS = 86_400_000

/** Invoices that bill nobody: not issued yet, voided, or given back. */
const NOT_BILLED = new Set(["draft", "cancelled", "refunded"])

export function isBilled(invoice: Pick<InvoiceAnalyticsRecord, "status">): boolean {
  return !NOT_BILLED.has(invoice.status.toLowerCase())
}

function money(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function cents(value: number): number {
  return Math.round(value * 100) / 100
}

function dateOf(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Days between two moments, counted in the viewer's calendar days. */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / DAY_MS)
}

/**
 * What the record says was paid on an invoice. An invoice marked «paid» by hand
 * carries no payment rows and sometimes no paidAmount either; its status is the
 * record, and it says the whole amount — the reading
 * POST /api/v1/invoices/fix-balances takes ("trust the status (paid offline)").
 */
export function paidOn(invoice: InvoiceAnalyticsRecord): number {
  const amount = Math.max(0, money(invoice.amount))
  if (invoice.status.toLowerCase() === "paid") return amount
  return Math.min(amount, Math.max(0, money(invoice.paidAmount)))
}

function seriesByCurrency(
  entries: readonly { currency: string; slot: number; amount: number }[],
  slots: number,
): CurrencySeries[] {
  return bucketByCurrency(entries.map((e) => ({ valueAmount: e.amount, currency: e.currency }))).map((bucket) => {
    const values: number[] = Array(slots).fill(0)
    for (const e of entries) if (e.currency === bucket.currency) values[e.slot] += e.amount
    return { currency: bucket.currency, total: cents(bucket.value), count: bucket.count, values: values.map(cents) }
  })
}

// ── Weekly collection ───────────────────────────────────────────────

/** Monday 00:00 of the week `date` falls in, in the viewer's time zone. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

export type WeeklyCollections = {
  /** The Monday each week starts on, oldest first; the last one is this week. */
  weeks: Date[]
  /** Money received per currency, largest first; empty when no payment falls in the window. */
  byCurrency: CurrencySeries[]
}

/**
 * Money received per calendar week, from the payments recorded against
 * invoices (InvoicePayment: amount, currency, payment date) — the only record
 * that says how much came in and when. An invoice marked «paid» without a
 * recorded payment has no such date, and `paidAt` is no substitute: it holds
 * when the last payment was *entered*, and on rows repaired by fix-balances,
 * when the repair ran (nine prod invoices share 2026-04-08 08:15).
 */
export function weeklyCollections(
  invoices: readonly InvoiceAnalyticsRecord[],
  now: Date,
  weeks = 8,
): WeeklyCollections {
  const current = startOfWeek(now)
  const starts = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(current)
    d.setDate(d.getDate() - (weeks - 1 - i) * 7)
    return d
  })
  const end = new Date(current)
  end.setDate(end.getDate() + 7)

  const entries: { currency: string; slot: number; amount: number }[] = []
  for (const invoice of invoices) {
    for (const payment of invoice.payments ?? []) {
      const at = dateOf(payment.paymentDate)
      const amount = money(payment.amount)
      if (!at || amount <= 0 || at < starts[0] || at >= end) continue
      let slot = weeks - 1
      while (slot > 0 && at < starts[slot]) slot--
      entries.push({ currency: currencyOf({ valueAmount: amount, currency: payment.currency || invoice.currency }), slot, amount })
    }
  }
  return { weeks: starts, byCurrency: seriesByCurrency(entries, weeks) }
}

/**
 * Invoices marked paid with no payment recorded against them. Their money is
 * real but undated, so the weekly bars cannot hold it; the tab says how many.
 */
export function paidWithoutRecordedPayment(invoices: readonly InvoiceAnalyticsRecord[]): number {
  return invoices.filter(
    (invoice) => invoice.status.toLowerCase() === "paid" && Array.isArray(invoice.payments) && invoice.payments.length === 0,
  ).length
}

// ── Monthly billing ─────────────────────────────────────────────────

export type MonthSlot = { year: number; month: number }

export type MonthlyBilled = {
  /** The last `months` calendar months, oldest first; the last one is this month. */
  months: MonthSlot[]
  byCurrency: CurrencySeries[]
}

/**
 * Amounts billed per calendar month, by the invoice's own date (its creation
 * date when the issue date is missing). Drafts, cancelled and refunded
 * invoices bill nobody and are not counted.
 */
export function monthlyBilled(invoices: readonly InvoiceAnalyticsRecord[], now: Date, months = 12): MonthlyBilled {
  const slots: MonthSlot[] = []
  for (let i = months - 1; i >= 0; i--) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1)
    slots.push({ year: first.getFullYear(), month: first.getMonth() })
  }
  const entries: { currency: string; slot: number; amount: number }[] = []
  for (const invoice of invoices) {
    if (!isBilled(invoice)) continue
    const at = dateOf(invoice.issueDate) ?? dateOf(invoice.createdAt)
    if (!at) continue
    const slot = slots.findIndex((m) => m.year === at.getFullYear() && m.month === at.getMonth())
    if (slot < 0) continue
    entries.push({ currency: currencyOf({ valueAmount: 0, currency: invoice.currency }), slot, amount: money(invoice.amount) })
  }
  return { months: slots, byCurrency: seriesByCurrency(entries, months) }
}

/**
 * The last slot against the one before it, in percent — or null when the one
 * before holds nothing: a change from zero has no percentage.
 */
export function changeOnPrevious(values: readonly number[]): number | null {
  if (values.length < 2) return null
  const previous = values[values.length - 2]
  if (!(previous > 0)) return null
  return ((values[values.length - 1] - previous) / previous) * 100
}

/**
 * Average billed per month in one currency, over the months from its first
 * billed month in the window to this one — not the all-time total ÷ 12,
 * which is the same number for an organisation that invoiced for two months
 * and one that invoiced for three years.
 */
export function monthlyAverage(series: CurrencySeries): { value: number; months: number } | null {
  const first = series.values.findIndex((v) => v > 0)
  if (first < 0) return null
  const months = series.values.length - first
  return { value: cents(series.total / months), months }
}

// ── Receivables ─────────────────────────────────────────────────────

/** Current (not yet due, or no due date), 1–30, 31–60, 61–90 and 90+ days overdue. */
export const AGING_BUCKETS = 5

/** What customers still owe, per currency, spread over the aging buckets. */
export function receivablesAging(invoices: readonly InvoiceAnalyticsRecord[], now: Date): CurrencySeries[] {
  const entries: { currency: string; slot: number; amount: number }[] = []
  for (const invoice of invoices) {
    if (!isBilled(invoice)) continue
    const outstanding = money(invoice.amount) - paidOn(invoice)
    if (outstanding <= 0) continue
    const due = dateOf(invoice.dueDate)
    const daysOverdue = due ? Math.floor((now.getTime() - due.getTime()) / DAY_MS) : 0
    const slot = daysOverdue <= 0 ? 0 : daysOverdue <= 30 ? 1 : daysOverdue <= 60 ? 2 : daysOverdue <= 90 ? 3 : 4
    entries.push({ currency: currencyOf({ valueAmount: 0, currency: invoice.currency }), slot, amount: outstanding })
  }
  return seriesByCurrency(entries, AGING_BUCKETS)
}

export type CurrencyStanding = {
  currency: string
  billed: number
  paid: number
  outstanding: number
  /** Billed invoices in this currency. */
  count: number
  /** Paid out of billed, in percent; null when nothing of value was billed. */
  percent: number | null
}

/** Billed and paid per currency, largest billed first. */
export function billingByCurrency(invoices: readonly InvoiceAnalyticsRecord[]): CurrencyStanding[] {
  const billed = invoices.filter(isBilled)
  return bucketByCurrency(billed.map((i) => ({ valueAmount: money(i.amount), currency: i.currency }))).map((bucket) => {
    let paid = 0
    for (const invoice of billed) {
      if (currencyOf({ valueAmount: 0, currency: invoice.currency }) === bucket.currency) paid += paidOn(invoice)
    }
    return {
      currency: bucket.currency,
      billed: cents(bucket.value),
      paid: cents(paid),
      outstanding: cents(Math.max(0, bucket.value - paid)),
      count: bucket.count,
      percent: bucket.value > 0 ? (paid / bucket.value) * 100 : null,
    }
  })
}

/**
 * Days from an invoice's issue date to the payment that settled it, averaged
 * over the paid invoices whose recorded payments cover the amount. An invoice
 * marked paid by hand — outright, or after a partial payment — has no record
 * of when the rest of the money came, so it is not in the average.
 */
export function averageDaysToPay(invoices: readonly InvoiceAnalyticsRecord[]): { days: number; count: number } | null {
  let sum = 0
  let count = 0
  for (const invoice of invoices) {
    if (invoice.status.toLowerCase() !== "paid") continue
    const payments = invoice.payments ?? []
    const recorded = payments.reduce((total, p) => total + money(p.amount), 0)
    if (recorded + 0.005 < money(invoice.amount)) continue
    const issued = dateOf(invoice.issueDate) ?? dateOf(invoice.createdAt)
    const settled = payments
      .map((p) => dateOf(p.paymentDate))
      .filter((d): d is Date => d !== null)
      .reduce<Date | null>((latest, d) => (!latest || d > latest ? d : latest), null)
    if (!issued || !settled) continue
    sum += Math.max(0, calendarDaysBetween(issued, settled))
    count++
  }
  return count > 0 ? { days: Math.round(sum / count), count } : null
}

// ── Recurring rules ─────────────────────────────────────────────────

/** A row of GET /api/v1/recurring-invoices, as far as this tab reads it. */
export type RecurringRuleRecord = {
  id: string
  title: string
  frequency: string
  intervalCount?: number | null
  nextRunDate?: string | null
  isActive: boolean
  currency?: string | null
  taxRate?: number | null
  includeVat?: boolean | null
  company?: { name?: string | null } | null
  items?: { quantity: number; unitPrice: number; discount?: number | null }[] | null
}

export type UpcomingRecurring = {
  id: string
  name: string
  frequency: string
  intervalCount: number
  nextRunDate: string | null
  /** What the next generated invoice will carry. */
  amount: number
  currency: string
}

/**
 * Active recurring rules, soonest run first. The amount is the one the next
 * generated invoice will carry, from the call POST
 * /api/v1/recurring-invoices/generate makes — not a figure of this tab's own.
 */
export function recurringSummary(
  rules: readonly RecurringRuleRecord[],
  limit = 5,
): { active: number; upcoming: UpcomingRecurring[] } {
  const active = rules.filter((rule) => rule.isActive)
  const at = (rule: RecurringRuleRecord) => dateOf(rule.nextRunDate)?.getTime() ?? Number.POSITIVE_INFINITY
  const upcoming = [...active]
    .sort((a, b) => at(a) - at(b) || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((rule) => ({
      id: rule.id,
      name: rule.company?.name || rule.title,
      frequency: rule.frequency,
      intervalCount: Math.max(1, rule.intervalCount ?? 1),
      nextRunDate: rule.nextRunDate ?? null,
      amount: calculateInvoiceTotals(
        (rule.items ?? []).map((item) => ({
          quantity: money(item.quantity),
          unitPrice: money(item.unitPrice),
          discount: money(item.discount),
        })),
        "percentage",
        0,
        money(rule.taxRate),
        Boolean(rule.includeVat),
      ).totalAmount,
      currency: currencyOf({ valueAmount: 0, currency: rule.currency }),
    }))
  return { active: active.length, upcoming }
}
