/**
 * Return-quantity validator — D3 OMS Phase 6 Block A slice 1.
 *
 * Enforces the cumulative quantity-cap across sibling returns on the
 * same BuyerOrder. A single SQL CHECK can't span rows, so this helper
 * does the math.
 *
 * Rules:
 *   1. Each proposed line must reference an orderItemId that exists on
 *      the order.
 *   2. Each proposed quantity must be > 0 (DB CHECK also enforces).
 *   3. Sum of (proposed.qty + existingReturns.qty WHERE
 *      returnStatus NOT IN ('rejected', 'cancelled')) per orderItemId
 *      ≤ orderLine.quantity.
 *
 * Trust boundary: `existingReturns` is treated as TRUSTED DB input
 * (already validated at write time by the
 * `order_return_items_quantity_check` CHECK constraint, which forbids
 * non-positive quantities). The helper does NOT re-validate that
 * `existingReturns[i].quantity > 0`. If slice 2 ever bypasses Prisma
 * (raw SQL writes, ETL, etc.), it must preserve that invariant or
 * the cumulative-cap math under-counts.
 *
 * Pure synchronous. Caller (slice-2 POST /order-returns route) wraps
 * with the actual Prisma write inside a transaction whose pre-write
 * SELECT seeds `existingReturns`.
 */
import type {
  ExistingReturnLine,
  ReturnStatus,
  ValidateReturnInput,
  ValidateReturnResult,
} from "./types"

const COUNTS_AGAINST_CAP: ReadonlySet<ReturnStatus> = new Set([
  "requested",
  "approved",
  "received",
  "refunded",
  "closed",
])

export function validateReturnQuantities(
  input: ValidateReturnInput
): ValidateReturnResult {
  const errors: string[] = []
  const { orderLines, existingReturns, proposed } = input

  if (proposed.length === 0) {
    errors.push("Return must have at least one line")
    return { ok: false, errors }
  }

  // Index order lines by id for O(1) lookups.
  const lineById = new Map<string, number>()
  for (const line of orderLines) {
    lineById.set(line.id, line.quantity)
  }

  // Sum already-returned (active) quantities per orderItemId.
  const alreadyReturnedByLine = new Map<string, number>()
  for (const r of existingReturns) {
    if (!COUNTS_AGAINST_CAP.has(r.returnStatus)) continue
    const prev = alreadyReturnedByLine.get(r.orderItemId) ?? 0
    alreadyReturnedByLine.set(r.orderItemId, prev + r.quantity)
  }

  // Aggregate the proposed payload first — caller may have duplicate
  // proposed entries for the same orderItemId in edge cases (UI bug or
  // free-form input). DB uniqueness on (returnId, orderItemId) catches
  // it eventually, but we surface a clearer error here than a Prisma
  // P2002 constraint violation.
  const proposedByLine = new Map<string, number>()
  for (const p of proposed) {
    if (p.quantity <= 0 || !Number.isFinite(p.quantity)) {
      errors.push(
        `Proposed return for order item "${p.orderItemId}" has invalid quantity ${p.quantity}`
      )
      continue
    }
    const prev = proposedByLine.get(p.orderItemId) ?? 0
    if (prev > 0) {
      errors.push(
        `Proposed return lists order item "${p.orderItemId}" more than once — collapse client-side`
      )
      continue
    }
    proposedByLine.set(p.orderItemId, prev + p.quantity)
  }

  // Per-line cap check.
  for (const [orderItemId, proposedQty] of proposedByLine) {
    const original = lineById.get(orderItemId)
    if (original == null) {
      errors.push(
        `Proposed return references order item "${orderItemId}" not present on the order`
      )
      continue
    }
    const alreadyReturned = alreadyReturnedByLine.get(orderItemId) ?? 0
    const wouldBeTotal = alreadyReturned + proposedQty
    if (wouldBeTotal > original) {
      errors.push(
        `Order item "${orderItemId}" cumulative return ${wouldBeTotal} exceeds original quantity ${original} (already returned: ${alreadyReturned}, proposed: ${proposedQty})`
      )
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true }
}
