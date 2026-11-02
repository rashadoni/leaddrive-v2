/**
 * What the finance screens count as money still owed — one rule for «İcmal»
 * and for «Debitor (A/R)» / «Kreditor (A/P)».
 *
 * They used to disagree (owner, 2026-10-26: «İcmal» 608,777 ₼ / 49 invoices,
 * «Debitor» 585,777 ₼ / 48). The overview took every invoice that was not a
 * draft or cancelled and trusted its balance; «Debitor» took the open statuses.
 * The extra invoice was marked «paid» through the status field, which leaves
 * `balanceDue` untouched — and the product's own repair
 * (`/api/v1/invoices/fix-balances`) reads a «paid» invoice without payment
 * rows as paid outside the system. So the status decides, and the balance only
 * says how much of an open item is still due.
 *
 * A balance is owed now, whatever year the document was issued in: the year
 * picker on the overview narrows revenue and expenses, not debts — otherwise
 * every unpaid invoice would drop out of the overview, overdue alert
 * included, on the first of January. Only an explicit date range narrows by
 * issue date, and it does so on every screen alike.
 */
export const OPEN_INVOICE_STATUSES = ["sent", "viewed", "partially_paid", "overdue"]
export const OPEN_BILL_STATUSES = ["pending", "partially_paid", "overdue"]

type IssueDateRange = { gte: Date; lte: Date } | undefined

export function openInvoicesWhere(organizationId: string, issueDate?: IssueDateRange) {
  return { organizationId, status: { in: OPEN_INVOICE_STATUSES }, ...(issueDate && { issueDate }) }
}

export function openBillsWhere(organizationId: string, issueDate?: IssueDateRange) {
  return { organizationId, status: { in: OPEN_BILL_STATUSES }, ...(issueDate && { issueDate }) }
}

/** Overdue: something is still due and the due date has passed. No due date — not overdue. */
export function isOverdueItem(balance: number, dueDate: Date | string | null | undefined, now: Date): boolean {
  return balance > 0 && dueDate != null && new Date(dueDate) < now
}
