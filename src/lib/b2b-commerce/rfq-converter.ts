/**
 * RFQ → BuyerOrder converter — D1 Phase 6 Block A slice 1.
 *
 * Given an RFQ that's in `quoted` or `accepted` status with all
 * line items carrying a `quotedUnitPrice`, build the priced-order
 * shape ready to insert as a BuyerOrder + BuyerOrderItems.
 *
 * Rejects:
 *   - RFQ not in `quoted` or `accepted` status (caller must move it through workflow)
 *   - any line item missing `quotedUnitPrice`
 *   - RFQ past `validUntil` (use `asOf` to test; defaults to now)
 *   - empty item list
 *
 * Pure synchronous. No I/O. Slice-2 routes wrap with the actual
 * Prisma BuyerOrder.create call.
 */
import type {
  ConvertRfqInput,
  ConvertRfqResult,
  PricedOrderItem,
} from "./types"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function convertRfqToOrder(input: ConvertRfqInput): ConvertRfqResult {
  const errors: string[] = []
  const { rfq } = input
  const asOf = input.asOf ?? new Date()

  if (rfq.status !== "quoted" && rfq.status !== "accepted") {
    errors.push(
      `RFQ is in status "${rfq.status}"; must be "quoted" or "accepted" before conversion`
    )
  }

  if (rfq.validUntil && rfq.validUntil < asOf) {
    errors.push(`RFQ expired at ${rfq.validUntil.toISOString()} (asOf ${asOf.toISOString()})`)
  }

  if (rfq.items.length === 0) {
    errors.push("RFQ has no items")
  }

  const items: PricedOrderItem[] = []
  let total = 0
  for (let i = 0; i < rfq.items.length; i++) {
    const it = rfq.items[i]
    if (!it.productId) {
      errors.push(`RFQ item ${i} missing productId`)
      continue
    }
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
      errors.push(`RFQ item "${it.productId}" has invalid quantity ${it.quantity}`)
      continue
    }
    if (it.quotedUnitPrice == null) {
      errors.push(`RFQ item "${it.productId}" has no quotedUnitPrice — quote it before converting`)
      continue
    }
    if (!Number.isFinite(it.quotedUnitPrice) || it.quotedUnitPrice < 0) {
      errors.push(`RFQ item "${it.productId}" has invalid quotedUnitPrice ${it.quotedUnitPrice}`)
      continue
    }
    const unitPrice = round2(it.quotedUnitPrice)
    const lineTotal = round2(unitPrice * it.quantity)
    items.push({
      productId: it.productId,
      productName: it.productName,
      quantity: it.quantity,
      unitPrice,
      // RFQ converter snapshots the quoted price as-is — discount-pct
      // gets folded into `quotedUnitPrice` upstream during the
      // quote phase. Slice 2 may surface a separate discount field.
      discountPct: 0,
      totalPrice: lineTotal,
      // Distinct from "list" / "priceList" — RFQ pricing is
      // manually negotiated and preserved verbatim in the audit trail.
      priceSource: "rfq",
    })
    total += lineTotal
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    items,
    total: round2(total),
  }
}
