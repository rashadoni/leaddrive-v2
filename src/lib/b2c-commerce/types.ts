/**
 * B2C Commerce types — D2 Phase 6 Block A slice 1.
 *
 * Salesforce B2C Commerce analogue. Public storefront + session-
 * bound cart + checkout state machine. Slice 1 ships pure helpers
 * + admin-side routes; slice 2 adds public guest endpoints + payment-
 * provider integration + Cart → BuyerOrder conversion.
 */

export type CartStatus = "open" | "abandoned" | "checked_out" | "merged"

export type CheckoutStatus =
  | "shipping"
  | "payment"
  | "review"
  | "completed"
  | "failed"
  | "expired"

/* ─── Cart calculator ─────────────────────────────────────────────────── */

export interface CartItemRow {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
}

export interface CartTotalsInput {
  items: readonly CartItemRow[]
  /** Optional flat shipping fee in the cart's currency. Slice 2 wires
   * the rate-table lookup; slice 1 accepts a caller-supplied amount. */
  shippingFlat?: number
  /** Optional tax rate as a fraction 0..1 (e.g. 0.08 = 8%). Applied
   * to subtotal only, not shipping (slice 1 simplification). */
  taxRate?: number
}

export interface CartTotals {
  /** Sum of items[].quantity * unitPrice; rounded to 2 dp. */
  subtotal: number
  shipping: number
  /** subtotal * taxRate; rounded to 2 dp. */
  tax: number
  /** subtotal + shipping + tax; rounded to 2 dp. */
  total: number
  /** Sum of items[].quantity — useful for the "N items in cart" UI hint. */
  itemCount: number
}

/* ─── Checkout state machine ──────────────────────────────────────────── */

/**
 * Valid forward transitions. Backward moves (e.g. payment → shipping
 * when the user wants to edit address) are allowed via the second
 * map below — Salesforce-style: shopper can step back to fix data.
 */
export const FORWARD_TRANSITIONS: Readonly<Record<CheckoutStatus, readonly CheckoutStatus[]>> = {
  shipping: ["payment", "failed", "expired"],
  payment: ["review", "failed", "expired"],
  review: ["completed", "failed", "expired"],
  completed: [], // terminal
  failed: [], // terminal
  expired: [], // terminal
}

/**
 * Allowed backward edits — only contiguous downgrade within the
 * pre-completion flow. Once a session is in `review`, the buyer
 * can go back to fix shipping or payment; once `completed` /
 * `failed` / `expired`, no edits.
 */
export const BACKWARD_TRANSITIONS: Readonly<Record<CheckoutStatus, readonly CheckoutStatus[]>> = {
  shipping: [],
  payment: ["shipping"],
  review: ["shipping", "payment"],
  completed: [],
  failed: [],
  expired: [],
}

export interface AdvanceCheckoutInput {
  from: CheckoutStatus
  to: CheckoutStatus
}

export interface AdvanceCheckoutOk {
  ok: true
  /** "forward" | "backward" | "terminal" (e.g. failed/expired). */
  kind: "forward" | "backward" | "terminal"
}

export interface AdvanceCheckoutFail {
  ok: false
  error: string
}

export type AdvanceCheckoutResult = AdvanceCheckoutOk | AdvanceCheckoutFail

/* ─── Cart merger ─────────────────────────────────────────────────────── */

export interface MergeCartsInput {
  guestCart: { id: string; items: readonly CartItemRow[] }
  userCart: { id: string; items: readonly CartItemRow[] }
}

export interface MergedCart {
  /** Resulting cart items — guest items added to user cart; same-product
   * lines collapse quantities. unitPrice on collision keeps the
   * user-cart price (older snapshot wins — stability over freshness). */
  items: CartItemRow[]
}
