/**
 * The life of a purchase order (docs/sales-procurement/README.md, task 3.5).
 *
 *   draft ─submit→ pending_approval ─(last step)→ approved ─send→ sent
 *     → in_production → in_transit → partially_received → received
 *   pending_approval ─reject→ rejected ─edit→ draft
 *   anything not yet received ─cancel→ cancelled
 *
 * Receipt moves an order to partially_received / received by itself from any
 * of approved, sent, in_production, in_transit and partially_received: goods
 * that arrive before anyone pressed «sent» are still a delivery.
 */
export const PURCHASE_ORDER_STATUSES = [
  "draft", "pending_approval", "approved", "rejected", "sent",
  "in_production", "in_transit", "partially_received", "received", "cancelled",
] as const
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number]

/** Statuses a person sets by hand on the order card, and where each may come from. */
export const MANUAL_TRANSITIONS: Record<"in_production" | "in_transit", readonly PurchaseOrderStatus[]> = {
  in_production: ["sent"],
  in_transit: ["sent", "in_production"],
}

/** Editable as a document: lines, supplier, prices. */
export const EDITABLE_STATUSES: readonly PurchaseOrderStatus[] = ["draft", "rejected"]
/** May still be cancelled. */
export const CANCELLABLE_STATUSES: readonly PurchaseOrderStatus[] = [
  "draft", "pending_approval", "approved", "rejected", "sent", "in_production", "in_transit",
]
/** Goods may arrive. */
export const RECEIVABLE_STATUSES: readonly PurchaseOrderStatus[] = ["approved", "sent", "in_production", "in_transit", "partially_received"]
/** Out of the supplier's hands — no longer counted as late. */
export const CLOSED_STATUSES: readonly PurchaseOrderStatus[] = ["received", "cancelled"]
/** Count towards the cost of the deal: the money is committed. */
export const COMMITTED_STATUSES: readonly PurchaseOrderStatus[] = [
  "approved", "sent", "in_production", "in_transit", "partially_received", "received",
]

export function isPurchaseOrderStatus(value: unknown): value is PurchaseOrderStatus {
  return typeof value === "string" && (PURCHASE_ORDER_STATUSES as readonly string[]).includes(value)
}

export const PURCHASE_REQUEST_STATUSES = ["draft", "submitted", "in_progress", "ordered", "closed", "cancelled"] as const
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number]
