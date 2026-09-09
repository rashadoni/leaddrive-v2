/**
 * B2B credit checker — D1 Phase 6 Block A slice 1.
 *
 * Pure helper: given a buyer's `creditLimit`, their outstanding
 * orders (open invoices / non-terminal-status orders), and a
 * proposed new-order total, return whether the order can be approved
 * + a structured headroom breakdown.
 *
 * Terminal statuses (`closed`, `cancelled`, `rejected`, `delivered`)
 * don't count against credit — `delivered` is debatable (the goods
 * shipped but the invoice may still be open), but slice 1 follows
 * the Salesforce convention of counting only pre-delivery commitments.
 * Slice 2 wires an invoice-aware variant that draws from open
 * receivables instead.
 *
 * `creditLimit === 0` is treated as "cash-only" — approval requires
 * BOTH the proposed order AND the sum of outstanding commitments
 * to be 0. Any non-zero outstanding order OR non-zero proposed
 * amount produces remainingHeadroom < 0 → approved=false. Slice 2
 * may add a `cashOnly` flag for clearer UI semantics; for now,
 * callers should not gate cash-only buyers via this helper.
 */
import type {
  BuyerOrderStatus,
  CreditCheckInput,
  CreditCheckResult,
  OutstandingOrder,
} from "./types"

const TERMINAL_STATUSES: ReadonlySet<BuyerOrderStatus> = new Set([
  "closed",
  "cancelled",
  "rejected",
  "delivered",
])

function isOutstanding(s: BuyerOrderStatus): boolean {
  return !TERMINAL_STATUSES.has(s)
}

export function checkCredit(input: CreditCheckInput): CreditCheckResult {
  if (!Number.isFinite(input.creditLimit) || input.creditLimit < 0) {
    throw new Error(`creditLimit must be a non-negative finite number (got ${input.creditLimit})`)
  }
  if (!Number.isFinite(input.proposedAmount) || input.proposedAmount < 0) {
    throw new Error(`proposedAmount must be a non-negative finite number (got ${input.proposedAmount})`)
  }

  let currentOutstanding = 0
  for (const o of input.outstanding) {
    if (!isOutstanding(o.status)) continue
    if (!Number.isFinite(o.totalAmount) || o.totalAmount < 0) continue
    currentOutstanding += o.totalAmount
  }

  const totalAfterOrder = currentOutstanding + input.proposedAmount
  const remainingHeadroom = input.creditLimit - totalAfterOrder
  const approved = remainingHeadroom >= 0

  return {
    totalAfterOrder,
    remainingHeadroom,
    approved,
    currentOutstanding,
  }
}

/**
 * Convenience helper: build an `OutstandingOrder` array from a list
 * of (status, total) pairs. Mostly for tests + slice-2 route
 * adapters; production callers usually map straight from Prisma rows.
 */
export function asOutstanding(
  rows: ReadonlyArray<{ status: string; totalAmount: number }>
): OutstandingOrder[] {
  return rows.map(r => ({
    status: r.status as BuyerOrderStatus,
    totalAmount: r.totalAmount,
  }))
}
