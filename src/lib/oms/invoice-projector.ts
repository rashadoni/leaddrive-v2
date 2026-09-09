/**
 * BuyerOrder → Invoice projection — D3 OMS Phase 6 Block A slice 1.
 *
 * Given a fulfilled / delivered / closed BuyerOrder, build the
 * InvoiceCreateInput shape that's ready to insert as a sibling Invoice
 * record. Pure synchronous — slice-2 routes wrap this with the actual
 * Prisma write + invoice-number sequence allocation.
 *
 * Idempotency policy (caller's responsibility):
 *   We intentionally do NOT track "already-projected" state here.
 *   The slice-2 caller looks for an Invoice with metadata.sourceOrderId
 *   = order.id BEFORE calling project — if one exists, no projection.
 *   This keeps the helper pure (no I/O) while still preventing
 *   duplicate invoices in the live system.
 *
 * Rejects:
 *   - order in a status that hasn't progressed past "approved"
 *     (draft / submitted / approved / cancelled / rejected): invoicing
 *     a non-fulfilled order misrepresents goods owed.
 *   - empty item list (defensive — should be impossible per D1 schema,
 *     but cheap to assert).
 */
import type { BuyerOrderStatus } from "@/lib/b2b-commerce/types"
import type {
  InvoiceProjection,
  InvoiceProjectionItem,
  ProjectInvoiceInput,
  ProjectInvoiceResult,
} from "./types"

/**
 * Statuses ELIGIBLE for invoicing. Mirrors the BuyerOrder state machine:
 * shipped / delivered / closed = goods are out the door + customer
 * obligation is real. "approved" by itself is too early — the warehouse
 * may still cancel before shipment.
 *
 * Typed against `BuyerOrderStatus` so that adding a new BuyerOrder
 * lifecycle status forces a compile-time review of whether it should
 * be invoiceable.
 */
const ELIGIBLE_FOR_INVOICE: ReadonlySet<BuyerOrderStatus> = new Set<BuyerOrderStatus>([
  "shipped",
  "delivered",
  "closed",
])

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function projectInvoiceFromOrder(
  input: ProjectInvoiceInput
): ProjectInvoiceResult {
  const errors: string[] = []
  const { order } = input

  if (!ELIGIBLE_FOR_INVOICE.has(order.status)) {
    errors.push(
      `Order is in status "${order.status}"; must be "shipped", "delivered", or "closed" to invoice`
    )
  }

  if (order.items.length === 0) {
    errors.push("Order has no items")
  }

  const items: InvoiceProjectionItem[] = []
  let subtotal = 0
  for (let i = 0; i < order.items.length; i++) {
    const it = order.items[i]
    if (!it.productId) {
      errors.push(`Order item ${i} missing productId`)
      continue
    }
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
      errors.push(
        `Order item "${it.productId}" has invalid quantity ${it.quantity}`
      )
      continue
    }
    if (!Number.isFinite(it.unitPrice) || it.unitPrice < 0) {
      errors.push(
        `Order item "${it.productId}" has invalid unitPrice ${it.unitPrice}`
      )
      continue
    }
    if (
      !Number.isFinite(it.discountPct) ||
      it.discountPct < 0 ||
      it.discountPct > 100
    ) {
      errors.push(
        `Order item "${it.productId}" has invalid discountPct ${it.discountPct}`
      )
      continue
    }

    // Discount is stored as a flat amount in InvoiceItem.discount; we
    // project the percentage back to absolute.
    const grossLine = round2(it.unitPrice * it.quantity)
    const discount = round2(grossLine * (it.discountPct / 100))
    const total = round2(grossLine - discount)

    // Sanity-cross-check: D1 BuyerOrderItem.totalPrice should already
    // equal this — but if upstream rounding diverges we trust the
    // recomputed `total` and flag the order for audit.
    if (Math.abs(total - it.totalPrice) > 0.01) {
      errors.push(
        `Order item "${it.productId}" totalPrice ${it.totalPrice} does not match (unitPrice*qty - discount) ${total} — order needs re-pricing before invoicing`
      )
      continue
    }

    items.push({
      productId: it.productId,
      name: it.productName,
      quantity: it.quantity,
      unitPrice: round2(it.unitPrice),
      discount,
      total,
    })
    subtotal += total
  }

  if (errors.length > 0) return { ok: false, errors }

  const invoiceNumber = input.invoiceNumber ?? `INV-${order.orderNumber}`

  const invoice: InvoiceProjection = {
    invoiceNumber,
    organizationId: order.organizationId,
    currency: order.currency,
    subtotal: round2(subtotal),
    sourceOrderId: order.id,
    items,
  }

  return { ok: true, invoice }
}
