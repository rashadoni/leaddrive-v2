/**
 * B2B Commerce types — D1 Phase 6 Block A slice 1.
 *
 * Salesforce B2B Commerce analogue. Three workflows on top of the
 * existing Product / PricingProfile / Company stack:
 *   - BuyerAccount lifecycle: per-company credit + payment terms +
 *     price-list pin + status
 *   - Order pricing: snapshot Product.price into BuyerOrderItem at
 *     create time, with per-buyer overrides via PricingProfile +
 *     per-line discounts
 *   - RFQ → Order conversion: quoted RFQ accepted → order with the
 *     quoted prices preserved
 *
 * Pure helpers are framework-agnostic — tests inject mocks, slice-2
 * routes wrap with Prisma I/O.
 */

export type BuyerAccountStatus = "active" | "suspended" | "closed"

export type BuyerOrderStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "shipped"
  | "delivered"
  | "closed"
  | "cancelled"
  | "rejected"

export type RfqStatus =
  | "draft"
  | "submitted"
  | "quoted"
  | "accepted"
  | "rejected"
  | "expired"

/* ─── Pricing engine ──────────────────────────────────────────────────── */

/**
 * Override entry from a PricingProfile (or any other rule source).
 * Slice 1 keeps the shape minimal — slice 2 may add tier / region /
 * customer-segment fields.
 */
export interface PriceListEntry {
  productId: string
  unitPrice: number
  /** Optional minimum order quantity for this price to apply. */
  minQuantity?: number
}

export interface ProductRow {
  id: string
  name: string
  /** List price (Product.price); used when no priceList override matches. */
  price: number
}

export interface PricingInputItem {
  productId: string
  quantity: number
  /** Optional per-line discount percentage 0..100. */
  discountPct?: number
}

export interface PricedOrderItem {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  discountPct: number
  /** unitPrice * quantity * (1 - discountPct/100); rounded to 2 dp. */
  totalPrice: number
  /**
   * Source flag for audit trail:
   *   "list"      — Product.price (catalog default)
   *   "priceList" — PricingProfile override matched on (product, qty)
   *   "rfq"       — manually-quoted price preserved from an accepted RFQ
   */
  priceSource: "list" | "priceList" | "rfq"
}

export interface PricedOrder {
  items: PricedOrderItem[]
  /** Sum of items[].totalPrice; rounded to 2 dp. */
  total: number
}

export interface BuildPricedOrderInput {
  items: readonly PricingInputItem[]
  products: readonly ProductRow[]
  /** Optional pin to a price list — overrides Product.price when matched. */
  priceList?: readonly PriceListEntry[]
}

/* ─── Credit check ────────────────────────────────────────────────────── */

export interface OutstandingOrder {
  totalAmount: number
  status: BuyerOrderStatus
}

export interface CreditCheckInput {
  creditLimit: number
  /** Open orders the buyer hasn't paid yet — caller fetches and sums elsewhere if needed. */
  outstanding: readonly OutstandingOrder[]
  /** Proposed new-order total. */
  proposedAmount: number
}

export interface CreditCheckResult {
  /** outstanding(non-terminal-status sum) + proposedAmount. */
  totalAfterOrder: number
  /** creditLimit - totalAfterOrder; negative when exceeding. */
  remainingHeadroom: number
  /**
   * True when totalAfterOrder ≤ creditLimit. Under creditLimit=0
   * (cash-only buyer), approval requires totalAfterOrder=0 too —
   * i.e. BOTH proposed=0 AND outstanding=0. See credit-checker.ts
   * header for the full contract.
   */
  approved: boolean
  /** Outstanding amount from non-terminal orders only. */
  currentOutstanding: number
}

/* ─── RFQ → Order conversion ──────────────────────────────────────────── */

export interface RfqItemRow {
  productId: string
  productName: string
  quantity: number
  /** Quoted unit price — must be set for conversion. */
  quotedUnitPrice: number | null
}

export interface RfqRow {
  id: string
  status: RfqStatus
  validUntil: Date | null
  items: readonly RfqItemRow[]
}

export interface ConvertRfqInput {
  rfq: RfqRow
  asOf?: Date
}

export interface ConvertRfqOk {
  ok: true
  items: PricedOrderItem[]
  total: number
}

export interface ConvertRfqFail {
  ok: false
  errors: string[]
}

export type ConvertRfqResult = ConvertRfqOk | ConvertRfqFail
