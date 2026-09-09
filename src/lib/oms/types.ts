/**
 * OMS (Order Management) types — D3 Phase 6 Block A slice 1.
 *
 * Salesforce OMS analogue. Post-submission fulfillment + RMA lifecycle
 * layered on top of D1 BuyerOrder. Pure helpers + types — slice 2
 * wraps with Prisma I/O, payment-provider integrations, and admin UI.
 *
 * Three workflows:
 *   1. Shipment state machine — pending → in_transit → delivered, with
 *      exception loop-back and cancel terminal.
 *   2. Return / RMA state machine — requested → approved → received →
 *      refunded → closed (or received → closed without refund), with
 *      reject / cancel terminal branches.
 *   3. Return-quantity validator — cumulative-cap math across sibling
 *      returns on the same order (the DB CHECK can't span rows).
 *   4. BuyerOrder → Invoice projection — turns a fulfilled / delivered
 *      order into the InvoiceItem shape ready to insert as a sibling
 *      Invoice record (idempotent on the caller side).
 */
import type { BuyerOrderStatus } from "@/lib/b2b-commerce/types"

/* ─── Shipment state machine ──────────────────────────────────────────── */

/**
 * Tuple of valid shipment statuses — exported so the route Zod
 * schemas + permission checks consume a single source of truth.
 * Order is documentation-only (no SM semantics).
 */
export const SHIPMENT_STATUSES = [
  "pending",
  "in_transit",
  "delivered",
  "exception",
  "cancelled",
] as const

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

/**
 * Forward + recovery transitions. `delivered` and `cancelled` are
 * terminal (empty target list).
 *
 *   pending → in_transit, cancelled
 *   in_transit → delivered, exception
 *   exception → in_transit (carrier resumed), delivered
 *   delivered, cancelled — terminal
 */
export const SHIPMENT_TRANSITIONS: Readonly<
  Record<ShipmentStatus, readonly ShipmentStatus[]>
> = {
  pending: ["in_transit", "cancelled"],
  in_transit: ["delivered", "exception"],
  exception: ["in_transit", "delivered"],
  delivered: [],
  cancelled: [],
}

export interface AdvanceShipmentInput {
  from: ShipmentStatus
  to: ShipmentStatus
}

export interface AdvanceShipmentOk {
  ok: true
  /**
   * Hints to the caller which timestamp columns the transition needs:
   *   shipping     — set shippedAt = now()
   *   delivering   — set deliveredAt = now()
   *   none         — no timestamp side effect (cancel / exception loop)
   */
  sideEffect: "shipping" | "delivering" | "none"
}

export interface AdvanceShipmentFail {
  ok: false
  error: string
}

export type AdvanceShipmentResult = AdvanceShipmentOk | AdvanceShipmentFail

/**
 * Shape of each entry in OrderShipment.lineItems (JSONB column).
 * Slice 2 multi-parcel UI lets the operator specify which order
 * lines ship in which parcel; this is the snapshot. Helpers should
 * cast the JSON read result to `readonly ShipmentLineSnapshot[]`.
 */
export interface ShipmentLineSnapshot {
  orderItemId: string
  /** Number of units in THIS shipment (≤ original line quantity). */
  quantity: number
  /** Optional product-name snapshot for invoice-style display. */
  productName?: string
}

/* ─── Return / RMA state machine ──────────────────────────────────────── */

/**
 * Tuple of valid return statuses — same single-source-of-truth pattern
 * as SHIPMENT_STATUSES above.
 */
export const RETURN_STATUSES = [
  "requested",
  "approved",
  "received",
  "refunded",
  "closed",
  "rejected",
  "cancelled",
] as const

export type ReturnStatus = (typeof RETURN_STATUSES)[number]

/**
 *   requested → approved, rejected
 *   approved → received, cancelled
 *   received → refunded, closed  (closed-without-refund = store-credit /
 *                                 RMA-of-record case; allowed because
 *                                 not every RMA terminates in money out)
 *   refunded → closed
 *   closed, rejected, cancelled — terminal
 *
 * Forward-only — once a return is approved you can't "un-approve" it;
 * use cancel instead (which is terminal). Mirrors Salesforce OMS
 * RMA semantics.
 *
 * Note: there is no `in_transit → cancelled` or `exception → cancelled`
 * edge on the shipment side machine. Mid-transit cancellation is
 * expected to flow through the Return workflow (carrier delivers,
 * customer immediately initiates RMA) rather than rewriting the
 * shipment state — preserves the SLA / fulfillment-time audit row.
 */
export const RETURN_TRANSITIONS: Readonly<
  Record<ReturnStatus, readonly ReturnStatus[]>
> = {
  requested: ["approved", "rejected"],
  approved: ["received", "cancelled"],
  received: ["refunded", "closed"],
  refunded: ["closed"],
  closed: [],
  rejected: [],
  cancelled: [],
}

export interface AdvanceReturnInput {
  from: ReturnStatus
  to: ReturnStatus
}

export interface AdvanceReturnOk {
  ok: true
  /**
   * Hints for which timestamp the caller should set:
   *   approving / receiving / refunding — set the corresponding column
   *   none — no timestamp side effect (reject / cancel / close)
   */
  sideEffect: "approving" | "receiving" | "refunding" | "none"
}

export interface AdvanceReturnFail {
  ok: false
  error: string
}

export type AdvanceReturnResult = AdvanceReturnOk | AdvanceReturnFail

/* ─── Return-quantity validator ───────────────────────────────────────── */

export interface OrderLineRow {
  /** BuyerOrderItem.id — primary key. */
  id: string
  /** Original quantity sold. */
  quantity: number
}

export interface ExistingReturnLine {
  orderItemId: string
  quantity: number
  /**
   * Status of the parent return. Lines from `rejected` / `cancelled`
   * returns DO NOT count against the cap — they were never effectively
   * returned. Active returns + completed refunds DO count.
   */
  returnStatus: ReturnStatus
}

export interface ProposedReturnLine {
  orderItemId: string
  quantity: number
}

export interface ValidateReturnInput {
  /** All BuyerOrderItems for the order. */
  orderLines: readonly OrderLineRow[]
  /** All OrderReturnItems already linked to non-terminal-reject returns. */
  existingReturns: readonly ExistingReturnLine[]
  /** Lines the caller wants to add to a new return. */
  proposed: readonly ProposedReturnLine[]
}

export interface ValidateReturnOk {
  ok: true
}

export interface ValidateReturnFail {
  ok: false
  errors: string[]
}

export type ValidateReturnResult = ValidateReturnOk | ValidateReturnFail

/* ─── BuyerOrder → Invoice projection ─────────────────────────────────── */

export interface OrderForInvoiceLine {
  id: string
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  discountPct: number
  totalPrice: number
}

export interface OrderForInvoice {
  id: string
  organizationId: string
  orderNumber: string
  currency: string
  /**
   * Order status — typed against the canonical D1 enum so adding a new
   * BuyerOrder lifecycle state forces a compile-time review of which
   * projector branch handles it. Helper rejects projection from
   * statuses that haven't fulfilled (draft / submitted / approved /
   * cancelled / rejected) — invoicing a not-yet-shipped order would
   * misrepresent goods owed.
   */
  status: BuyerOrderStatus
  items: readonly OrderForInvoiceLine[]
}

export interface InvoiceProjection {
  /** Snapshot for Invoice.invoiceNumber — caller may override. */
  invoiceNumber: string
  organizationId: string
  currency: string
  subtotal: number
  /** Source order id — caller links back via custom field / metadata. */
  sourceOrderId: string
  items: InvoiceProjectionItem[]
}

export interface InvoiceProjectionItem {
  productId: string
  name: string
  quantity: number
  unitPrice: number
  /**
   * Order-line discount expressed as a flat amount (unitPrice * qty *
   * discountPct/100) — Invoice schema uses Float `discount` not pct.
   * Always >= 0; rounded to 2 dp.
   */
  discount: number
  /** unitPrice * quantity - discount; equals OrderItem.totalPrice. */
  total: number
}

export interface ProjectInvoiceInput {
  order: OrderForInvoice
  /**
   * Optional invoice-number override. Defaults to "INV-<orderNumber>".
   * Slice 2 sequence generator wires a per-tenant numeric counter.
   */
  invoiceNumber?: string
}

export interface ProjectInvoiceOk {
  ok: true
  invoice: InvoiceProjection
}

export interface ProjectInvoiceFail {
  ok: false
  errors: string[]
}

export type ProjectInvoiceResult = ProjectInvoiceOk | ProjectInvoiceFail
