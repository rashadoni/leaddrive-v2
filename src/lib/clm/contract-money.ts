/**
 * Money on a contract — how much of it is invoiced, paid, owed and left to
 * invoice (owner 2026-11-26, mock «Деньги по договору», «Давай»). Until then
 * the card showed only the contract's value; an invoice without a price
 * protocol was always for the whole value, as many times as one clicked, even
 * on a draft.
 *
 *  - Cancelled and refunded invoices count for nothing.
 *  - A draft is not issued: it is shown apart, but it already takes its part of
 *    the value — the next invoice is for what is left after it.
 *  - Issued: invoiced = their totals, paid = what was paid on them, the
 *    customer's debt = what is still due; overdue = the debt of those whose
 *    status says so or whose due date is past.
 *  - Only invoices in the contract's own currency are set against its value;
 *    one in another currency is listed apart, never added (there are no rates).
 *
 * Amounts are summed in integer cents. Pure: the routes pass the rows in.
 */

export const NON_COUNTING_INVOICE_STATUSES = ["cancelled", "refunded"] as const

export interface MoneyInvoice {
  status: string
  totalAmount: number
  paidAmount: number
  balanceDue: number
  currency: string
  dueDate: string | Date | null
}

export interface CurrencyMoney {
  currency: string
  invoiced: number
  invoicedCount: number
  drafts: number
  draftCount: number
  paid: number
  debt: number
  overdue: number
}

export interface ContractMoney extends CurrencyMoney {
  /** The contract's value; null when it has none. */
  value: number | null
  /** What is left to invoice (value − invoiced − drafts, not below 0); null without a value. */
  remaining: number | null
  /** How far invoices and drafts go beyond the value; 0 without a value. */
  overInvoiced: number
  /** Invoices in other currencies, each listed on its own. */
  other: CurrencyMoney[]
}

const cents = (n: number | null | undefined) => Math.round((Number(n) || 0) * 100)
const amount = (c: number) => c / 100

function startOfUtcDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

function tally(currency: string, invoices: MoneyInvoice[], now: Date): { money: CurrencyMoney; usedCents: number } {
  let invoiced = 0, drafts = 0, paid = 0, debt = 0, overdue = 0, invoicedCount = 0, draftCount = 0
  const today = startOfUtcDay(now)
  for (const inv of invoices) {
    if ((NON_COUNTING_INVOICE_STATUSES as readonly string[]).includes(inv.status)) continue
    if (inv.status === "draft") {
      drafts += cents(inv.totalAmount)
      draftCount++
      continue
    }
    invoiced += cents(inv.totalAmount)
    invoicedCount++
    paid += cents(inv.paidAmount)
    const due = Math.max(0, cents(inv.balanceDue))
    if (inv.status !== "paid") {
      debt += due
      const pastDue = inv.dueDate ? new Date(inv.dueDate).getTime() < today : false
      if (due > 0 && (inv.status === "overdue" || pastDue)) overdue += due
    }
  }
  return {
    money: {
      currency,
      invoiced: amount(invoiced),
      invoicedCount,
      drafts: amount(drafts),
      draftCount,
      paid: amount(paid),
      debt: amount(debt),
      overdue: amount(overdue),
    },
    usedCents: invoiced + drafts,
  }
}

export function contractMoney(
  contract: { valueAmount: number | null; currency: string | null },
  invoices: MoneyInvoice[],
  now: Date = new Date(),
): ContractMoney {
  const currency = contract.currency || "AZN"
  const own = tally(currency, invoices.filter((i) => (i.currency || currency) === currency), now)
  const value = contract.valueAmount && contract.valueAmount > 0 ? cents(contract.valueAmount) : null
  const others = [...new Set(invoices.map((i) => i.currency).filter((c) => c && c !== currency))].sort()
  return {
    ...own.money,
    value: value === null ? null : amount(value),
    remaining: value === null ? null : amount(Math.max(0, value - own.usedCents)),
    overInvoiced: value === null ? 0 : amount(Math.max(0, own.usedCents - value)),
    other: others.map((c) => tally(c, invoices.filter((inv) => inv.currency === c), now).money),
  }
}

/** A contract that never took effect is not invoiced. */
export const NOT_INVOICEABLE_STATUSES = ["draft", "pending_approval", "rejected", "cancelled"] as const

export function invoiceRefusal(status: string | null | undefined): "CONTRACT_NOT_IN_FORCE" | null {
  return status && (NOT_INVOICEABLE_STATUSES as readonly string[]).includes(status) ? "CONTRACT_NOT_IN_FORCE" : null
}

/**
 * The amount of the next invoice without a price protocol: what is left of the
 * value after every counting invoice in its currency, drafts included. null —
 * the contract has no value (the invoice is filled in by hand, as before).
 */
/** An invoice set against the contract's value: not cancelled or refunded, in the contract's currency. */
export function countsTowardsValue(invoice: { status: string; currency: string | null }, contractCurrency: string | null): boolean {
  const currency = contractCurrency || "AZN"
  return !(NON_COUNTING_INVOICE_STATUSES as readonly string[]).includes(invoice.status) && (invoice.currency || currency) === currency
}

export function nextInvoiceAmount(
  contract: { valueAmount: number | null; currency: string | null },
  invoices: Array<Pick<MoneyInvoice, "status" | "totalAmount" | "currency">>,
): { ok: true; amount: number | null } | { ok: false; code: "FULLY_INVOICED" } {
  const currency = contract.currency || "AZN"
  if (!contract.valueAmount || contract.valueAmount <= 0) return { ok: true, amount: null }
  const used = invoices
    .filter((i) => countsTowardsValue(i, currency))
    .reduce((sum, i) => sum + cents(i.totalAmount), 0)
  const left = cents(contract.valueAmount) - used
  return left > 0 ? { ok: true, amount: amount(left) } : { ok: false, code: "FULLY_INVOICED" }
}
