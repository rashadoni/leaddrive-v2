/**
 * The deposit a customer leaves to hold a time.
 *
 * It exists because of the no-show: a chair held for someone who never comes
 * is an hour the salon cannot sell twice. Booksy and Fresha both answer it the
 * same way — ask for part of the money up front — and the owner's rules here
 * are his own (2026-11-08): the salon asks a fixed sum or a share of the
 * visit, and the deposit is owed back only when the customer cancels in time.
 * Cancel late, or do not turn up, and it is kept.
 *
 * Money never moves by itself. This module decides what is owed and what is
 * kept; a person pays it back, and the CRM only says that they should.
 */

export type DepositStatus = "awaiting" | "paid" | "refund_due" | "kept" | "refunded"

/** What a person may do to a deposit by hand, from the meeting's card. */
export type DepositAction = "paid" | "refunded"

export interface DepositPolicy {
  /** A fixed sum, as text; null when the share is used or nothing is asked. */
  amount: string | null
  /** A share of the visit, 1–100; null when a fixed sum is used. */
  percent: number | null
  /** Cancel at least this many hours ahead and a paid deposit is owed back. */
  freeHours: number
}

const MAX_AMOUNT = 1_000_000_000
const MAX_FREE_HOURS = 720

function trimMoney(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text
}

function cleanAmount(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT) return trimMoney(value.toFixed(2))
  // The column is `Decimal`, and that is what the database hands back: a
  // fixed-sum deposit arrives here as a Decimal object, not as a string.
  // Reading only strings and numbers is how «15 ₼» quietly became «no deposit
  // at all» — the share worked, because its column is an integer. Anything
  // whose text is not a plain amount still falls through to null below.
  const raw = typeof value === "string" ? value
    : typeof value === "object" && value !== null ? String(value)
      : null
  if (raw === null) return null
  const text = raw.trim().replace(",", ".")
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null
  const amount = Number(text)
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT ? trimMoney(text) : null
}

/** The service's own rule, as it may be read back from a row of any age. */
export function depositPolicy(page: { depositAmount?: unknown; depositPercent?: unknown; depositFreeHours?: unknown }): DepositPolicy {
  const amount = cleanAmount(page.depositAmount)
  const rawPercent = typeof page.depositPercent === "number" ? Math.trunc(page.depositPercent) : null
  const percent = rawPercent !== null && Number.isFinite(rawPercent) && rawPercent > 0 && rawPercent <= 100 ? rawPercent : null
  const rawHours = typeof page.depositFreeHours === "number" ? Math.trunc(page.depositFreeHours) : 24
  const freeHours = Number.isFinite(rawHours) && rawHours >= 0 ? Math.min(rawHours, MAX_FREE_HOURS) : 24
  // A sum and a share at once is two answers to one question; the sum wins,
  // because it is the one a person typed as money.
  return { amount, percent: amount === null ? percent : null, freeHours }
}

export function asksDeposit(policy: DepositPolicy): boolean {
  return policy.amount !== null || policy.percent !== null
}

/**
 * What this visit must leave: the fixed sum, or the share of what the visit
 * actually costs — the price with the master's own rate and the extras on it,
 * which is the number the customer was shown.
 *
 * A share of a visit with no price is nothing to ask for: a salon that has not
 * priced the service cannot take a percentage of it.
 */
export function depositDue(policy: DepositPolicy, visitPrice: string | null): string | null {
  if (policy.amount !== null) return policy.amount
  if (policy.percent === null || visitPrice === null) return null
  const price = Number(visitPrice)
  if (!Number.isFinite(price) || price <= 0) return null
  const due = Math.round(price * policy.percent) / 100
  return due > 0 ? trimMoney(due.toFixed(2)) : null
}

/**
 * Where a cancelled visit leaves its deposit.
 *
 * Nothing was paid — nothing is owed, and the salon is not left chasing a
 * refund for money it never saw. Paid and cancelled in time — it is owed back,
 * and a person sends it. Paid and cancelled late — it is kept, which is what
 * the deposit was for.
 */
export function depositAfterCancel(
  booking: { depositStatus?: string | null; startsAt: Date },
  freeHours: number,
  now: Date,
): DepositStatus | null {
  if (booking.depositStatus !== "paid") return booking.depositStatus === "awaiting" ? "kept" : null
  const hoursLeft = (booking.startsAt.getTime() - now.getTime()) / 3_600_000
  return hoursLeft >= freeHours ? "refund_due" : "kept"
}

/** Whether the salon is still waiting for this visit's money. */
export function depositOutstanding(booking: { depositStatus?: string | null }): boolean {
  return booking.depositStatus === "awaiting"
}

/**
 * The deposit a manager marks by hand — cash on the counter, a transfer that
 * arrived, a refund they sent back.
 *
 * Each action has exactly one state it may start from, and the answer is
 * null everywhere else. That is the whole point: a second press of «received»
 * on a visit already paid, or «sent back» on a deposit the salon kept, must
 * change nothing rather than quietly rewrite what happened to the money.
 */
export function depositTransition(current: string | null | undefined, action: DepositAction): DepositStatus | null {
  if (action === "paid") return current === "awaiting" ? "paid" : null
  return current === "refund_due" ? "refunded" : null
}

/** Whether the salon still owes this cancelled visit's deposit back. */
export function depositRefundOwed(booking: { depositStatus?: string | null }): boolean {
  return booking.depositStatus === "refund_due"
}
